import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { syncParentDirectories } from '../authoring/node-durable-file.js';
import type { AssetImportAuthorityPaths } from './types.js';
import { assertAssetImportProjectRootIdentity } from './filesystem.js';
import {
  AssetImportAuthorityError,
  type AssetImportChallengeJournal,
  type ConfirmBindingChallengeRequest,
  type ConfirmBindingChallengeResponse,
  type CreateBindingChallengeResponse,
} from './types.js';
import { AssetImportRecordStore } from './record-store.js';

interface BindingServiceOptions {
  now?: () => number;
  challengeCleanupIntervalMs?: number;
}

interface ProbeRecord {
  schemaVersion: 1;
  authority: 'surdet-asset-import';
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

interface BindingTokenRecord {
  browserSessionId: string;
  idleExpiresAt: number;
  maximumExpiresAt: number;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validBrowserSession(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f\\/]/.test(value);
}

export class AssetImportBindingService {
  private readonly now: () => number;
  private readonly challengeCleanupIntervalMs: number;
  private readonly bindings = new Map<string, BindingTokenRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private cleanupFailure: unknown;
  private cleanupTail: Promise<void> = Promise.resolve();

  constructor(
    readonly paths: AssetImportAuthorityPaths,
    readonly store: AssetImportRecordStore,
    options: BindingServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.challengeCleanupIntervalMs = options.challengeCleanupIntervalMs ?? 30_000;
  }

  private assertChallengeCleanupHealthy(): void {
    if (this.cleanupFailure !== undefined) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '过期绑定探针清理失败，项目写入已阻断', {
        cause: this.cleanupFailure instanceof Error ? this.cleanupFailure.message : String(this.cleanupFailure),
      });
    }
  }

  startExpiredChallengeCleanup(): () => void {
    if (this.cleanupTimer === undefined) {
      this.cleanupTimer = setInterval(() => {
        void this.recoverExpiredChallenges().catch((error) => { this.cleanupFailure = error; });
      }, this.challengeCleanupIntervalMs);
      this.cleanupTimer.unref?.();
    }
    return () => {
      if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    };
  }

  async createChallenge(browserSessionId: string): Promise<CreateBindingChallengeResponse> {
    this.assertChallengeCleanupHealthy();
    await assertAssetImportProjectRootIdentity(this.paths);
    await this.recoverExpiredChallenges();
    if (!validBrowserSession(browserSessionId)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'browserSessionId 格式无效');
    }
    const challengeId = crypto.randomUUID();
    const relativeProbePath = `.surdet-bind-${challengeId}.json`;
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(this.now() + 60_000).toISOString();
    let journal: AssetImportChallengeJournal = {
      schemaVersion: 1,
      challengeId,
      journalVersion: 1,
      previousGenerationSha256: null,
      browserSessionId,
      relativeProbePath,
      nonceSha256: sha256(nonce),
      expiresAt,
      status: 'PROBE_CREATE_INTENT',
    };
    await this.store.registerChallenge(journal);

    const probeFile = path.join(this.paths.projectRoot, relativeProbePath);
    const handle = await fs.open(probeFile, 'wx', 0o600).catch((error: unknown) => {
      throw new AssetImportAuthorityError('PROJECT_BUSY', '项目绑定探针无法创建', {
        cause: (error as NodeJS.ErrnoException).code,
      });
    });
    try {
      const probe: ProbeRecord = { schemaVersion: 1, authority: 'surdet-asset-import', challengeId, nonce, expiresAt };
      await handle.writeFile(`${JSON.stringify(probe)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectories(this.paths.projectRoot);
    journal = await this.store.writeChallengeJournal(journal, 'PROBE_CREATED');
    return { challengeId: journal.challengeId, relativeProbePath, expiresAt };
  }

  async confirmChallenge(
    challengeId: string,
    request: ConfirmBindingChallengeRequest,
  ): Promise<ConfirmBindingChallengeResponse> {
    this.assertChallengeCleanupHealthy();
    await assertAssetImportProjectRootIdentity(this.paths);
    await this.recoverExpiredChallenges();
    const loaded = await this.store.readChallenge(challengeId);
    let journal = loaded.journal;
    if (journal.status !== 'PROBE_CREATED'
      || journal.browserSessionId !== request.browserSessionId
      || this.now() > Date.parse(journal.expiresAt)
      || sha256(request.nonce) !== journal.nonceSha256) {
      throw new AssetImportAuthorityError('PROJECT_IDENTITY_MISMATCH', '当前目录与本机写入服务不匹配');
    }
    const probeFile = path.join(this.paths.projectRoot, journal.relativeProbePath);
    const stat = await fs.lstat(probeFile).catch(() => null);
    if (stat === null || !stat.isFile() || stat.isSymbolicLink()) {
      throw new AssetImportAuthorityError('PROJECT_IDENTITY_MISMATCH', '项目绑定探针不可验证');
    }
    const probe = JSON.parse(await fs.readFile(probeFile, 'utf8')) as Partial<ProbeRecord>;
    if (probe.authority !== 'surdet-asset-import'
      || probe.challengeId !== challengeId
      || probe.nonce !== request.nonce
      || probe.expiresAt !== journal.expiresAt) {
      throw new AssetImportAuthorityError('PROJECT_IDENTITY_MISMATCH', '项目绑定探针内容不匹配');
    }
    await fs.unlink(probeFile);
    await syncParentDirectories(this.paths.projectRoot);
    journal = await this.store.writeChallengeJournal(journal, 'PROBE_REMOVED');
    const token = crypto.randomBytes(32).toString('hex');
    const idleExpiresAt = this.now() + 30 * 60_000;
    const maximumExpiresAt = this.now() + 8 * 60 * 60_000;
    // A project authority has one current browser binding generation. A fresh
    // physical directory proof revokes every older page, including pages that
    // used a different browserSessionId before a reload.
    this.bindings.clear();
    this.bindings.set(token, { browserSessionId: request.browserSessionId, idleExpiresAt, maximumExpiresAt });
    const discoveredOperations = await this.store.listOperations();
    for (const operation of discoveredOperations) {
      if (operation.status !== 'UPLOADING') continue;
      const manifest = await this.store.readOperationManifest(operation.operationId);
      await this.store.inspectStagedItemsForDiscovery(manifest);
    }
    const pendingOperations = discoveredOperations.filter((operation) => ![
      'COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK',
    ].includes(operation.status));
    return {
      projectIdentity: this.paths.projectIdentity,
      projectName: path.basename(this.paths.projectRoot),
      bindingToken: token,
      bindingExpiresAt: new Date(Math.min(idleExpiresAt, maximumExpiresAt)).toISOString(),
      recoveryBarrier: await this.store.hasUnresolvedBarrier() ? 'manual-recovery' : 'clear',
      pendingOperations,
      recentReceipts: [],
    };
  }

  async validateBinding(token: string, browserSessionId: string): Promise<boolean> {
    if (this.cleanupFailure !== undefined) return false;
    const binding = this.bindings.get(token);
    if (binding === undefined || binding.browserSessionId !== browserSessionId) return false;
    const now = this.now();
    if (now > binding.idleExpiresAt || now > binding.maximumExpiresAt) {
      this.bindings.delete(token);
      return false;
    }
    try {
      await assertAssetImportProjectRootIdentity(this.paths);
    } catch {
      this.bindings.delete(token);
      return false;
    }
    const validatedAt = this.now();
    if (validatedAt > binding.idleExpiresAt || validatedAt > binding.maximumExpiresAt) {
      this.bindings.delete(token);
      return false;
    }
    binding.idleExpiresAt = Math.min(validatedAt + 30 * 60_000, binding.maximumExpiresAt);
    return true;
  }

  async validateBindingToken(token: string): Promise<boolean> {
    if (this.cleanupFailure !== undefined) return false;
    const binding = this.bindings.get(token);
    if (binding === undefined) return false;
    const now = this.now();
    if (now > binding.idleExpiresAt || now > binding.maximumExpiresAt) {
      this.bindings.delete(token);
      return false;
    }
    try {
      await assertAssetImportProjectRootIdentity(this.paths);
    } catch {
      this.bindings.delete(token);
      return false;
    }
    const validatedAt = this.now();
    if (validatedAt > binding.idleExpiresAt || validatedAt > binding.maximumExpiresAt) {
      this.bindings.delete(token);
      return false;
    }
    binding.idleExpiresAt = Math.min(validatedAt + 30 * 60_000, binding.maximumExpiresAt);
    return true;
  }

  revoke(browserSessionId: string): void {
    for (const [token, binding] of this.bindings) {
      if (binding.browserSessionId === browserSessionId) this.bindings.delete(token);
    }
  }

  async recoverExpiredChallenges(): Promise<void> {
    const run = this.cleanupTail.then(() => this.recoverExpiredChallengesNow());
    this.cleanupTail = run.catch(() => undefined);
    return run;
  }

  private async recoverExpiredChallengesNow(): Promise<void> {
    await assertAssetImportProjectRootIdentity(this.paths);
    for (const current of await this.store.listChallenges()) {
      if (current.status === 'PROBE_REMOVED' || this.now() <= Date.parse(current.expiresAt)) continue;
      const probeFile = path.join(this.paths.projectRoot, current.relativeProbePath);
      const stat = await fs.lstat(probeFile).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (stat === null) {
        await this.store.writeChallengeJournal(current, 'PROBE_REMOVED');
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '过期绑定探针路径不安全');
      }
      const probe = JSON.parse(await fs.readFile(probeFile, 'utf8')) as Partial<ProbeRecord>;
      if (probe.authority !== 'surdet-asset-import'
        || probe.challengeId !== current.challengeId
        || typeof probe.nonce !== 'string'
        || sha256(probe.nonce) !== current.nonceSha256) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '过期绑定探针身份不匹配');
      }
      await fs.unlink(probeFile);
      await syncParentDirectories(this.paths.projectRoot);
      await this.store.writeChallengeJournal(current, 'PROBE_REMOVED');
    }
  }
}
