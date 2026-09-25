import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  buildProjectAssetImportPlan,
  AGENT_LICENSE_MAX_BYTES,
  describeProjectAssetPath,
  isProjectAssetFormatSupported,
  destinationDirectoryForAssetKind,
  stableStringify,
  type ProjectAssetImportPlan,
  type ProjectAssetImportStagedItem,
  type ProjectAssetImportTargetFact,
  type ProjectAssetImportTargetRequest,
  type TextHasher,
} from '@surdet/authoring';
import { syncFileAndParent, syncParentDirectories } from '../authoring/node-durable-file.js';
import { validateAssetSourceFormat } from '../authoring/asset-source-format.js';
import {
  absoluteAssetImportProjectPath,
  assetImportDirectoryIdentity,
  assetImportFileIdentity,
  assertAssetImportOperationWorkspace,
  assertAssetImportProjectOperationWorkspace,
  assertAssetImportProjectRootIdentity,
  inspectAssetImportTarget,
} from './filesystem.js';
import { AssetImportRecordStore } from './record-store.js';
import { AssetProjectMutationCoordinator } from './mutation-coordinator.js';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import {
  AssetImportAuthorityError,
  normalizeAssetImportSourceName,
  type AssetImportAuthorityPaths,
  type AssetImportJournal,
  type AssetImportOperationManifest,
  type AssetImportOperationManifestItem,
  type AssetImportOperationPlanRecord,
  type AssetImportPublicationFile,
  type AssetImportPublicationRecord,
  type AssetImportUploadIntent,
  type AssetImportOperationStatus,
  type CreateImportOperationRequest,
  type CreateImportOperationResponse,
  type CommitOperationRequest,
  type CommitOperationResponse,
  type ListOperationsResponse,
  type OperationDetailResponse,
  type PlanOperationRequest,
  type PlanOperationResponse,
  type ProjectAssetImportReceipt,
  type ProjectAssetImportUndoReceipt,
  type RecoverOperationRequest,
  type RecoverOperationResponse,
  type SealOperationRequest,
  type SealOperationResponse,
  type UndoOperationRequest,
  type UndoOperationResponse,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ProjectAssetImportAuthorityLimits {
  maxFiles: number;
  maxBytesPerFile: number;
  maxBytesPerOperation: number;
  maxConcurrentUploads: number;
  uploadIdleMs: number;
}

export interface ProjectAssetImportAuthorityOptions {
  textHasher: TextHasher;
  assertLeaseHeld: () => void | Promise<void>;
  now?: () => number;
  limits?: Partial<ProjectAssetImportAuthorityLimits>;
  faultInjector?: (point: AssetImportFaultPoint) => void | Promise<void>;
  mutationCoordinator?: AssetProjectMutationCoordinator;
}

export type AssetImportFaultPoint =
  | 'after_prepare_intent_before_file'
  | 'after_prepare_file_before_journal'
  | 'after_parent_intent_before_mkdir'
  | 'after_mkdir_before_parent_journal'
  | 'after_link_intent_before_link'
  | 'after_final_link_before_linked_journal'
  | 'after_linked_journal_before_verify'
  | 'after_verify_before_verified_journal'
  | 'after_receipt_create_before_committed_journal'
  | 'after_rollback_rename_intent_before_rename'
  | 'after_rollback_final_rename_before_quarantined_journal'
  | 'after_undo_rename_intent_before_rename'
  | 'after_undo_final_rename_before_quarantined_journal'
  | 'after_undo_quarantine_verify_before_undo_receipt';

export class AssetImportInjectedTermination extends Error {
  constructor(readonly point: AssetImportFaultPoint, options?: ErrorOptions) {
    super(`Injected asset import termination at ${point}`, options);
    this.name = 'AssetImportInjectedTermination';
  }
}

const DEFAULT_LIMITS: ProjectAssetImportAuthorityLimits = Object.freeze({
  maxFiles: 512,
  maxBytesPerFile: 2 * 1024 * 1024 * 1024,
  maxBytesPerOperation: 8 * 1024 * 1024 * 1024,
  maxConcurrentUploads: 2,
  uploadIdleMs: 30_000,
});

const LEGAL_TRANSITIONS: Readonly<Record<AssetImportOperationStatus, readonly AssetImportOperationStatus[]>> = {
  UPLOADING: ['STAGED', 'CANCELLED', 'RECOVERY_REQUIRED'],
  STAGED: ['READY', 'CANCELLED', 'RECOVERY_REQUIRED'],
  READY: ['PUBLISHING', 'CANCELLED', 'RECOVERY_REQUIRED'],
  PUBLISHING: ['COMMITTED', 'ROLLING_BACK', 'RECOVERY_REQUIRED'],
  ROLLING_BACK: ['ROLLED_BACK', 'RECOVERY_REQUIRED'],
  ROLLED_BACK: [],
  RECOVERY_REQUIRED: ['PUBLISHING', 'ROLLING_BACK', 'UNDOING'],
  COMMITTED: ['UNDOING', 'RECOVERY_REQUIRED'],
  UNDOING: ['UNDONE', 'RECOVERY_REQUIRED'],
  UNDONE: ['RECOVERY_REQUIRED'],
  CANCELLED: [],
};

function now(): string {
  return new Date().toISOString();
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 必须是小写 UUID`);
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameFileIdentity(
  left: Awaited<ReturnType<typeof assetImportFileIdentity>>,
  right: Awaited<ReturnType<typeof assetImportFileIdentity>>,
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.birthtimeNs === right.birthtimeNs
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

function sameNodeIdentity(
  left: { device: string; inode: string; birthtimeNs: string },
  right: { device: string; inode: string; birthtimeNs: string },
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.birthtimeNs === right.birthtimeNs;
}

function identityFromOpenFileStat(stat: Awaited<ReturnType<fs.FileHandle['stat']>>): {
  device: string;
  inode: string;
  birthtimeNs: string;
  size: number;
  mtimeNs: string;
} {
  const value = stat as unknown as {
    dev: bigint | number;
    ino: bigint | number;
    birthtimeNs?: bigint;
    birthtimeMs: number;
    size: bigint | number;
    mtimeNs?: bigint;
    mtimeMs: number;
    isFile(): boolean;
  };
  if (!value.isFile()) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '打开的素材句柄不是普通文件');
  return {
    device: String(value.dev),
    inode: String(value.ino),
    birthtimeNs: String(value.birthtimeNs ?? BigInt(Math.trunc(value.birthtimeMs * 1_000_000))),
    size: Number(value.size),
    mtimeNs: String(value.mtimeNs ?? BigInt(Math.trunc(value.mtimeMs * 1_000_000))),
  };
}

function targetRelativePath(target: ProjectAssetImportTargetRequest): string | null {
  const fileName = target.fileName.normalize('NFC');
  if (fileName.length === 0 || /[\\/\u0000]/u.test(fileName) || fileName === '.' || fileName === '..') return null;
  return `content/assets/${destinationDirectoryForAssetKind(target.kind)}/${fileName}`;
}

async function writeWhole(handle: fs.FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten <= 0) throw new AssetImportAuthorityError('IMPORT_UPLOAD_MISMATCH', '上传流无法继续写入');
    offset += result.bytesWritten;
  }
}

async function nextWithTimeout<T>(iterator: AsyncIterator<T>, timeoutMs: number): Promise<IteratorResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AssetImportAuthorityError('IMPORT_UPLOAD_TIMEOUT', '上传长时间没有进度')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class ProjectAssetImportAuthority {
  private readonly limits: ProjectAssetImportAuthorityLimits;
  private readonly textHasher: TextHasher;
  private readonly assertLeaseHeld: () => void | Promise<void>;
  private readonly nowMs: () => number;
  private readonly faultInjector?: ProjectAssetImportAuthorityOptions['faultInjector'];
  private readonly mutationCoordinator: AssetProjectMutationCoordinator;
  private readonly operationTokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private readonly activeUploadOperations = new Map<string, number>();
  private projectRecoveryBlocked = false;
  private recoveryEpoch = 0;
  private activeProjectMutationEpoch: number | null = null;
  private activeUploads = 0;

  constructor(
    readonly paths: AssetImportAuthorityPaths,
    readonly store: AssetImportRecordStore,
    options: ProjectAssetImportAuthorityOptions,
  ) {
    if (!options.textHasher || typeof options.textHasher.sha256 !== 'function') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '缺少素材导入哈希器');
    }
    this.textHasher = options.textHasher;
    if (typeof options.assertLeaseHeld !== 'function') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '缺少素材导入项目租约守卫');
    }
    this.assertLeaseHeld = options.assertLeaseHeld;
    this.nowMs = options.now ?? (() => Date.now());
    this.faultInjector = options.faultInjector;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.mutationCoordinator = options.mutationCoordinator ?? new AssetProjectMutationCoordinator();
    this.mutationCoordinator.register('asset-import', () => this.assertImportParticipantAvailable());
  }

  private async fault(point: AssetImportFaultPoint): Promise<void> {
    if (this.faultInjector === undefined) return;
    try {
      await this.faultInjector(point);
    } catch (cause) {
      throw new AssetImportInjectedTermination(point, { cause });
    }
  }

  private async serialize<T>(operationId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(operationId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.operationTails.set(operationId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.operationTails.get(operationId) === tail) this.operationTails.delete(operationId);
    }
  }

  private serializeProjectMutation<T>(work: () => Promise<T>): Promise<T> {
    return this.mutationCoordinator.run('asset-import', async () => {
      const previousEpoch = this.activeProjectMutationEpoch;
      this.activeProjectMutationEpoch = this.recoveryEpoch;
      try {
        return await work();
      } finally {
        this.activeProjectMutationEpoch = previousEpoch;
      }
    });
  }

  private async assertProjectMutationFence(operationId: string): Promise<void> {
    await this.assertLeaseHeld();
    await assertAssetImportProjectRootIdentity(this.paths);
    if (this.activeProjectMutationEpoch === null || this.activeProjectMutationEpoch !== this.recoveryEpoch) {
      return this.enterRecovery(operationId, '项目在写入期间进入了新的恢复状态');
    }
  }

  private createOperationToken(operationId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.operationTokens.set(operationId, { token, expiresAt: this.nowMs() + 30 * 60_000 });
    return token;
  }

  private async assertOwnRecoveryClear(): Promise<void> {
    await this.assertLeaseHeld();
    const operations = await this.store.listOperations();
    for (const operation of operations) {
      await this.verifyTerminalInvariants(operation.operationId, operation.status);
      if (operation.status === 'UPLOADING' && !this.activeUploadOperations.has(operation.operationId)) {
        const manifest = await this.readVerifiedManifest(operation.operationId);
        const discovery = await this.store.inspectStagedItemsForDiscovery(manifest);
        if (discovery.recoveryRequired) return this.enterRecovery(operation.operationId, '素材上传重启对账需要人工恢复');
        if (discovery.complete) {
          await this.transition((await this.store.readOperation(operation.operationId)).journal, 'STAGED');
        }
      }
      if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(operation.status)) {
        this.projectRecoveryBlocked = true;
        await this.store.ensureOperationRecoveryBarrier(
          operation.operationId,
          operation.updatedAt,
          `journal-${operation.journalVersion}`,
        );
      }
    }
    if (this.projectRecoveryBlocked) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材导入进程已进入恢复阻断状态');
    }
    if (await this.store.hasUnresolvedBarrier('asset-import')) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材导入需要先完成恢复');
    }
  }

  private async assertImportParticipantAvailable(): Promise<void> {
    await this.assertOwnRecoveryClear();
    const operations = await this.store.listOperations();
    if (operations.some((operation) => !['COMMITTED', 'CANCELLED', 'ROLLED_BACK', 'UNDONE'].includes(operation.status))) {
      throw new AssetImportAuthorityError('PROJECT_BUSY', '已有素材导入尚未结束');
    }
  }

  private async requireNoRecoveryBarrier(): Promise<void> {
    await this.mutationCoordinator.assertOtherReady('asset-import');
    await this.assertOwnRecoveryClear();
  }

  private normalizedItems(items: AssetImportOperationManifestItem[]): AssetImportOperationManifestItem[] {
    if (!Array.isArray(items) || items.length < 1 || items.length > this.limits.maxFiles) {
      throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', `一次最多导入 ${this.limits.maxFiles} 个文件`);
    }
    const seen = new Set<string>();
    let total = 0;
    return items.map((item) => {
      const itemId = requireUuid(item.itemId, 'itemId');
      if (seen.has(itemId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'itemId 不能重复');
      seen.add(itemId);
      if (!Number.isSafeInteger(item.declaredBytes) || item.declaredBytes < 0) {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '文件字节数必须是非负安全整数');
      }
      if (item.declaredBytes > this.limits.maxBytesPerFile) {
        throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '单个文件超过导入上限');
      }
      total += item.declaredBytes;
      if (total > this.limits.maxBytesPerOperation) {
        throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '本次导入总大小超过上限');
      }
      return { itemId, sourceName: normalizeAssetImportSourceName(item.sourceName), declaredBytes: item.declaredBytes };
    });
  }

  private async transition(journal: AssetImportJournal, status: AssetImportOperationStatus): Promise<AssetImportJournal> {
    if (journal.status === status) {
      if (['COMMITTED', 'CANCELLED', 'ROLLED_BACK', 'UNDONE'].includes(status)) {
        this.operationTokens.delete(journal.operationId);
      }
      return journal;
    }
    if (!LEGAL_TRANSITIONS[journal.status].includes(status)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', `导入状态不能从 ${journal.status} 变为 ${status}`);
    }
    const written = await this.store.writeJournal(journal, { ...journal, status, updatedAt: now() });
    if (['COMMITTED', 'CANCELLED', 'ROLLED_BACK', 'UNDONE'].includes(status)) {
      this.operationTokens.delete(journal.operationId);
    }
    return written;
  }

  private async enterRecovery(operationId: string, message: string): Promise<never> {
    this.recoveryEpoch += 1;
    this.projectRecoveryBlocked = true;
    let createdAt = now();
    let incidentKey = 'journal-state';
    try {
      createdAt = (await this.store.readOperationRegistration(operationId))?.createdAt ?? createdAt;
      const current = await this.store.readOperation(operationId);
      if (current.journal.status !== 'RECOVERY_REQUIRED'
        && LEGAL_TRANSITIONS[current.journal.status]?.includes('RECOVERY_REQUIRED')) {
        const recoveryJournal = await this.store.writeJournal(current.journal, {
          ...current.journal,
          status: 'RECOVERY_REQUIRED',
          updatedAt: now(),
        });
        incidentKey = `journal-${recoveryJournal.journalVersion}`;
      } else {
        incidentKey = `journal-${current.journal.journalVersion}`;
      }
    } catch {
      // The barrier below is the durable fail-closed signal even when the
      // journal itself is the damaged record.
    }
    try {
      await this.store.ensureOperationRecoveryBarrier(operationId, createdAt, incidentKey);
    } catch {
      throw new AssetImportAuthorityError(
        'IMPORT_RECOVERY_REQUIRED',
        `${message}；持久恢复屏障无法建立，本进程保持阻断`,
      );
    }
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', message);
  }

  private async assertOperationWorkspace(operationId: string): Promise<void> {
    try {
      await assertAssetImportOperationWorkspace(this.paths, operationId);
    } catch {
      return this.enterRecovery(operationId, '素材导入持久目录身份不安全');
    }
  }

  private async removeTemporaryUpload(operationId: string, file: string): Promise<void> {
    await this.assertOperationWorkspace(operationId);
    await fs.rm(file, { force: true });
    await syncParentDirectories(path.dirname(file));
    await this.assertOperationWorkspace(operationId);
  }

  private async verifyStagedBinary(item: ProjectAssetImportStagedItem, licenseFileName?: string): Promise<void> {
    if (licenseFileName !== undefined && item.bytes > AGENT_LICENSE_MAX_BYTES) throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', `许可证/说明不能超过 1 MiB：${licenseFileName}`);
    const licenseChunks: Buffer[] = [];
    const file = this.store.stagedItemBinaryFile(item.operationId, item.itemId);
    let handle: fs.FileHandle | undefined;
    try {
      const link = await fs.lstat(file);
      if (!link.isFile() || link.isSymbolicLink()) return this.enterRecovery(item.operationId, '素材暂存文件身份不安全');
      handle = await fs.open(file, 'r');
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size !== BigInt(item.bytes)) {
        return this.enterRecovery(item.operationId, '素材暂存文件大小与事实不一致');
      }
      const digest = crypto.createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      while (position < item.bytes) {
        const length = Math.min(buffer.byteLength, item.bytes - position);
        const read = await handle.read(buffer, 0, length, position);
        if (read.bytesRead <= 0) return this.enterRecovery(item.operationId, '素材暂存文件读取不完整');
        digest.update(buffer.subarray(0, read.bytesRead));
        if (licenseFileName !== undefined) licenseChunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
        position += read.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || digest.digest('hex') !== item.sha256) {
        return this.enterRecovery(item.operationId, '素材暂存文件内容与事实不一致');
      }
    } catch (error) {
      if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') throw error;
      return this.enterRecovery(item.operationId, '素材暂存文件缺失或无法验证');
    } finally {
      if (handle !== undefined) await handle.close().catch(() => undefined);
    }
    if (licenseFileName !== undefined) {
      try { validateAssetSourceFormat(Buffer.concat(licenseChunks), licenseFileName); }
      catch (error) { throw new AssetImportAuthorityError('IMPORT_PLAN_BLOCKED', error instanceof Error ? error.message : String(error)); }
    }
  }

  private async verifiedStagedItems(
    manifest: AssetImportOperationManifest,
    requireComplete: boolean,
    targets?: readonly ProjectAssetImportTargetRequest[],
  ): Promise<ProjectAssetImportStagedItem[]> {
    if ((await this.store.assertStagingEntriesKnown(manifest)).length > 0) {
      return this.enterRecovery(manifest.operationId, '发现未完成的素材上传意图');
    }
    const result: ProjectAssetImportStagedItem[] = [];
    for (const declared of manifest.items) {
      const fact = await this.store.readStagedItem(manifest.operationId, declared.itemId);
      if (fact === null) {
        const orphan = await fs.lstat(this.store.stagedItemBinaryFile(manifest.operationId, declared.itemId))
          .then(() => true)
          .catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
          });
        if (orphan) return this.enterRecovery(manifest.operationId, '发现没有事实记录的素材暂存文件');
        if (requireComplete) return this.enterRecovery(manifest.operationId, '素材暂存事实不完整');
        continue;
      }
      if (fact.sourceName !== declared.sourceName || fact.bytes !== declared.declaredBytes) {
        return this.enterRecovery(manifest.operationId, '素材暂存事实与创建清单不一致');
      }
      await this.verifyStagedBinary(fact, targets?.find(target => target.itemId === fact.itemId && target.kind === 'license')?.fileName);
      result.push(fact);
    }
    return result;
  }

  private async readVerifiedManifest(operationId: string): Promise<AssetImportOperationManifest> {
    const manifest = await this.store.readOperationManifest(operationId);
    const fingerprint = await this.textHasher.sha256(stableStringify({
      schemaVersion: 1,
      operationId: manifest.operationId,
      items: manifest.items,
      ...(manifest.agentRequestFingerprint === undefined ? {} : { agentRequestFingerprint: manifest.agentRequestFingerprint }),
    }));
    if (fingerprint !== manifest.manifestFingerprint) {
      return this.enterRecovery(operationId, '持久导入清单内容与清单指纹不一致');
    }
    return manifest;
  }

  async createOperation(request: CreateImportOperationRequest): Promise<CreateImportOperationResponse> {
    const operationId = requireUuid(request.operationId, 'operationId');
    if (request.agentRequestFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(request.agentRequestFingerprint)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'Agent 素材来源请求指纹无效');
    }
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.requireNoRecoveryBarrier();
      await assertAssetImportProjectRootIdentity(this.paths);
      const items = this.normalizedItems(request.items);
      const registration = await this.store.readOperationRegistration(operationId);
      const existing = registration === null ? null : await this.readVerifiedManifest(operationId);
      if (existing !== null) {
        if (!sameJson(existing.items, items) || existing.agentRequestFingerprint !== request.agentRequestFingerprint) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同导入清单');
        }
        const operation = await this.store.readOperation(operationId);
        if (operation.journal.status !== 'UPLOADING') {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '导入操作已经进入后续阶段');
        }
        const existingToken = this.operationTokens.get(operationId);
        const operationToken = existingToken !== undefined && this.nowMs() < existingToken.expiresAt
          ? existingToken.token
          : this.createOperationToken(operationId);
        return { operationId, status: 'UPLOADING', operationToken, itemCount: items.length };
      }

      const createdAt = now();
      const agentRequest = request.agentRequestFingerprint === undefined ? {} : { agentRequestFingerprint: request.agentRequestFingerprint };
      const manifestFingerprint = await this.textHasher.sha256(stableStringify({
        schemaVersion: 1,
        operationId,
        items,
        ...agentRequest,
      }));
      if (!/^[0-9a-f]{64}$/.test(manifestFingerprint)) {
        throw new AssetImportAuthorityError('IMPORT_AUTHORITY_NOT_READY', '素材导入哈希器返回了无效摘要');
      }
      const manifest: AssetImportOperationManifest = {
        schemaVersion: 1,
        operationId,
        createdAt,
        manifestFingerprint,
        items,
        ...agentRequest,
      };
      try {
        await this.store.registerOperation({ operationId, itemCount: items.length, createdAt });
        await this.store.createOperationManifest(manifest);
        await this.store.createInitialJournal(operationId, { status: 'UPLOADING', itemCount: items.length, updatedAt: createdAt });
      } catch {
        return this.enterRecovery(operationId, '导入操作创建未完整落盘');
      }
      const operationToken = this.createOperationToken(operationId);
      return { operationId, status: 'UPLOADING', operationToken, itemCount: items.length };
    }));
  }

  async uploadItem(
    operationIdInput: string,
    itemIdInput: string,
    body: NodeJS.ReadableStream,
  ): Promise<ProjectAssetImportStagedItem> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    const itemId = requireUuid(itemIdInput, 'itemId');
    if (this.activeUploads >= this.limits.maxConcurrentUploads) {
      throw new AssetImportAuthorityError('IMPORT_UPLOAD_BUSY', '并行上传数量已达上限');
    }
    this.activeUploads += 1;
    this.activeUploadOperations.set(operationId, (this.activeUploadOperations.get(operationId) ?? 0) + 1);
    try {
      await this.mutationCoordinator.run('asset-import', () => this.requireNoRecoveryBarrier());
      return await this.serialize(operationId, async () => {
        const manifest = await this.readVerifiedManifest(operationId);
        const declared = manifest.items.find((item) => item.itemId === itemId);
        if (declared === undefined) throw new AssetImportAuthorityError('INVALID_REQUEST', 'itemId 不属于该导入操作');
        const current = await this.store.readOperation(operationId);
        if (!['UPLOADING', 'STAGED'].includes(current.journal.status)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不允许上传');
        }

        const nonce = crypto.randomUUID();
        const temporary = this.store.stagedItemTemporaryFile(operationId, itemId, nonce);
        const intent: AssetImportUploadIntent = {
          schemaVersion: 1,
          operationId,
          itemId,
          nonce,
          partialFileName: path.basename(temporary),
          createdAt: now(),
        };
        await this.store.createUploadIntent(intent);
        let handle: fs.FileHandle | undefined;
        let linked = false;
        let factCreated = false;
        let measuredBytes = 0;
        const digest = crypto.createHash('sha256');
        try {
          await this.assertOperationWorkspace(operationId);
          handle = await fs.open(temporary, 'wx', 0o600);
          const iterator = (body as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
          while (true) {
            const next = await nextWithTimeout(iterator, this.limits.uploadIdleMs);
            if (next.done) break;
            const chunk = typeof next.value === 'string' ? Buffer.from(next.value) : Buffer.from(next.value as Uint8Array);
            measuredBytes += chunk.byteLength;
            if (measuredBytes > declared.declaredBytes) {
              throw new AssetImportAuthorityError('IMPORT_UPLOAD_MISMATCH', '上传内容长于创建清单');
            }
            if (measuredBytes > this.limits.maxBytesPerFile) {
              throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '上传内容超过单文件上限');
            }
            digest.update(chunk);
            await writeWhole(handle, chunk);
          }
          if (measuredBytes !== declared.declaredBytes) {
            throw new AssetImportAuthorityError('IMPORT_UPLOAD_MISMATCH', '上传内容短于创建清单');
          }
          await handle.sync();
          await handle.close();
          handle = undefined;

          const sha256 = digest.digest('hex');
          const stagedItemFingerprint = await this.textHasher.sha256(stableStringify({
            schemaVersion: 1,
            operationId,
            itemId,
            sourceName: declared.sourceName,
            bytes: measuredBytes,
            sha256,
          }));
          if (!/^[0-9a-f]{64}$/.test(stagedItemFingerprint)) {
            throw new AssetImportAuthorityError('IMPORT_AUTHORITY_NOT_READY', '素材导入哈希器返回了无效摘要');
          }
          const staged: ProjectAssetImportStagedItem = {
            operationId,
            itemId,
            sourceName: declared.sourceName,
            bytes: measuredBytes,
            sha256,
            stagedItemFingerprint,
          };
          const existing = await this.store.readStagedItem(operationId, itemId);
          if (existing !== null) {
            await this.removeTemporaryUpload(operationId, temporary);
            await this.store.removeUploadIntent(operationId, nonce);
            if (sameJson(existing, staged)) {
              await this.verifyStagedBinary(existing);
              return existing;
            }
            throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '同一素材项重试了不同内容');
          }

          try {
            await this.assertOperationWorkspace(operationId);
            await fs.link(temporary, this.store.stagedItemBinaryFile(operationId, itemId));
            await syncFileAndParent(this.store.stagedItemBinaryFile(operationId, itemId));
            linked = true;
            await this.assertOperationWorkspace(operationId);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
              return this.enterRecovery(operationId, '素材暂存文件缺少可信事实');
            }
            throw error;
          }
          await this.removeTemporaryUpload(operationId, temporary);
          await this.store.createStagedItem(staged);
          factCreated = true;
          await this.verifyStagedBinary(staged);
          await this.store.removeUploadIntent(operationId, nonce);
          const allStaged = (await this.verifiedStagedItems(manifest, false)).length === manifest.items.length;
          if (allStaged && current.journal.status === 'UPLOADING') {
            try {
              await this.transition(current.journal, 'STAGED');
            } catch {
              return this.enterRecovery(operationId, '素材已完整暂存，但状态迁移无法落盘');
            }
          }
          return staged;
        } catch (error) {
          if (handle !== undefined) await handle.close().catch(() => undefined);
          let cleanupFailed = false;
          try {
            await this.removeTemporaryUpload(operationId, temporary);
          } catch {
            cleanupFailed = true;
          }
          if (linked && !factCreated) {
            try {
              await this.store.removeStagedBinary(operationId, itemId);
            } catch {
              cleanupFailed = true;
            }
          }
          try {
            await this.store.removeUploadIntent(operationId, nonce);
          } catch {
            cleanupFailed = true;
          }
          (body as unknown as { destroy?: () => void }).destroy?.();
          if (cleanupFailed) return this.enterRecovery(operationId, '上传失败后无法证明暂存内容已安全清理');
          throw error;
        }
      });
    } finally {
      this.activeUploads -= 1;
      const remaining = (this.activeUploadOperations.get(operationId) ?? 1) - 1;
      if (remaining <= 0) this.activeUploadOperations.delete(operationId);
      else this.activeUploadOperations.set(operationId, remaining);
    }
  }

  async expectedUploadBytes(operationIdInput: string, itemIdInput: string): Promise<number> {
    await this.assertLeaseHeld();
    const operationId = requireUuid(operationIdInput, 'operationId');
    const itemId = requireUuid(itemIdInput, 'itemId');
    const manifest = await this.readVerifiedManifest(operationId);
    const item = manifest.items.find((entry) => entry.itemId === itemId);
    if (item === undefined) throw new AssetImportAuthorityError('INVALID_REQUEST', 'itemId 不属于该导入操作');
    return item.declaredBytes;
  }

  private async targetFacts(targets: ProjectAssetImportTargetRequest[]): Promise<ProjectAssetImportTargetFact[]> {
    const facts: ProjectAssetImportTargetFact[] = [];
    const storage = await NodeProjectStorage.open(this.paths.projectRoot);
    const files = [...new Set([
      ...(await storage.listFiles()).filter(file => file.startsWith('content/assets/')),
      ...targets.flatMap(target => { const file = targetRelativePath(target); return file === null ? [] : [file]; }),
    ])];
    const entries = files.flatMap(file => {
      const entry = describeProjectAssetPath(file);
      return entry !== null && !entry.invalidName && isProjectAssetFormatSupported(entry.kind, entry.format) ? [entry] : [];
    });
    const key = (entry: typeof entries[number]): string => `${entry.kind}:${entry.key}:${entry.variant ?? ''}`.normalize('NFC').toLowerCase();
    for (const target of targets) {
      const relativePath = targetRelativePath(target);
      if (relativePath === null) continue;
      const entry = entries.find(item => item.path === relativePath);
      const conflicts = entry === undefined ? [] : entries.filter(item => item.path !== relativePath && key(item) === key(entry)).map(item => item.path).sort();
      facts.push({ ...await inspectAssetImportTarget(this.paths, relativePath), ...(conflicts.length === 0 ? {} : { conflictingAssetPaths: conflicts }) });
    }
    return facts;
  }

  private async buildPlan(
    manifest: AssetImportOperationManifest,
    targets: ProjectAssetImportTargetRequest[],
    suppliedFacts?: ProjectAssetImportTargetFact[],
  ): Promise<{ plan: ProjectAssetImportPlan; targetFacts: ProjectAssetImportTargetFact[] }> {
    const manifestIds = manifest.items.map((item) => item.itemId).sort();
    const targetIds = targets.map((target) => target.itemId).sort();
    if (!sameJson(manifestIds, targetIds)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '每个导入文件必须且只能指定一个目标');
    }
    const stagedItems = await this.verifiedStagedItems(manifest, true, targets);
    const targetFacts = suppliedFacts ?? await this.targetFacts(targets);
    const plan = await buildProjectAssetImportPlan({
      projectIdentity: this.paths.projectIdentity,
      manifestFingerprint: manifest.manifestFingerprint,
      stagedItems,
      targets,
      targetFacts,
    }, this.textHasher);
    return { plan, targetFacts };
  }

  private async verifyStoredPlan(
    manifest: AssetImportOperationManifest,
    record: AssetImportOperationPlanRecord,
  ): Promise<void> {
    const rebuilt = await this.buildPlan(manifest, record.targets, record.targetFacts);
    if (!sameJson(rebuilt.plan, record.plan)) {
      return this.enterRecovery(manifest.operationId, '持久导入计划内容与计划指纹不一致');
    }
  }

  private async verifyStoredTerminalPlan(
    manifest: AssetImportOperationManifest,
    record: AssetImportOperationPlanRecord,
  ): Promise<void> {
    const planItems = new Map(record.plan.items.map((item) => [item.itemId, item]));
    const stagedItems: ProjectAssetImportStagedItem[] = [];
    for (const declared of manifest.items) {
      const planned = planItems.get(declared.itemId);
      if (planned === undefined
        || planned.sourceName !== declared.sourceName
        || planned.bytes !== declared.declaredBytes) {
        return this.enterRecovery(manifest.operationId, '终态导入计划与创建清单不一致');
      }
      const stagedItemFingerprint = await this.textHasher.sha256(stableStringify({
        schemaVersion: 1,
        operationId: manifest.operationId,
        itemId: declared.itemId,
        sourceName: planned.sourceName,
        bytes: planned.bytes,
        sha256: planned.sha256,
      }));
      stagedItems.push({
        operationId: manifest.operationId,
        itemId: declared.itemId,
        sourceName: planned.sourceName,
        bytes: planned.bytes,
        sha256: planned.sha256,
        stagedItemFingerprint,
      });
    }
    const rebuilt = await buildProjectAssetImportPlan({
      projectIdentity: this.paths.projectIdentity,
      manifestFingerprint: manifest.manifestFingerprint,
      stagedItems,
      targets: record.targets,
      targetFacts: record.targetFacts,
    }, this.textHasher);
    if (!sameJson(rebuilt, record.plan)) {
      return this.enterRecovery(manifest.operationId, '持久终态导入计划内容与计划指纹不一致');
    }
  }

  private async readFileEvidence(file: string): Promise<{
    bytes: number;
    sha256: string;
    identity: Awaited<ReturnType<typeof assetImportFileIdentity>>;
  }> {
    const before = await assetImportFileIdentity(file);
    const handle = await fs.open(file, 'r');
    const openedBefore = identityFromOpenFileStat(await handle.stat({ bigint: true }));
    if (!sameFileIdentity(before, openedBefore)) {
      await handle.close();
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材路径在打开窗口发生替换');
    }
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    let openedAfter = openedBefore;
    try {
      while (position < before.size) {
        const read = await handle.read(buffer, 0, Math.min(buffer.byteLength, before.size - position), position);
        if (read.bytesRead <= 0) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材文件读取不完整');
        digest.update(buffer.subarray(0, read.bytesRead));
        position += read.bytesRead;
      }
      openedAfter = identityFromOpenFileStat(await handle.stat({ bigint: true }));
    } finally {
      await handle.close();
    }
    const after = await assetImportFileIdentity(file);
    if (!sameFileIdentity(before, openedAfter) || !sameFileIdentity(before, after)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材文件在验证期间发生变化');
    }
    return { bytes: position, sha256: digest.digest('hex'), identity: after };
  }

  private async updatePublication(
    previous: AssetImportPublicationRecord,
    update: (next: AssetImportPublicationRecord) => void,
  ): Promise<AssetImportPublicationRecord> {
    const next = structuredClone(previous);
    update(next);
    next.updatedAt = now();
    return this.store.writePublication(previous, next);
  }

  private async updatePublicationFile(
    previous: AssetImportPublicationRecord,
    itemId: string,
    update: (file: AssetImportPublicationFile) => void,
  ): Promise<AssetImportPublicationRecord> {
    return this.updatePublication(previous, (next) => {
      const file = next.files.find((entry) => entry.itemId === itemId);
      if (file === undefined) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '发布 journal 缺少素材项');
      update(file);
    });
  }

  private async ensurePublicationParent(
    previous: AssetImportPublicationRecord,
    relativePath: string,
  ): Promise<AssetImportPublicationRecord> {
    const existingRecord = previous.parents.find((entry) => entry.relativePath === relativePath);
    if (existingRecord?.state === 'PREEXISTING' || existingRecord?.state === 'CREATED') return previous;
    if (existingRecord?.state === 'CREATE_INTENT') {
      return this.enterRecovery(previous.operationId, '目标父目录只留下创建意图，无法证明目录归属');
    }
    const absolute = absoluteAssetImportProjectPath(this.paths, relativePath);
    const parent = path.dirname(absolute);
    await assetImportDirectoryIdentity(parent);
    const name = path.basename(absolute);
    const siblings = await fs.readdir(parent, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (siblings === null) throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', '目标父目录的上级目录不存在');
    const folded = name.normalize('NFC').toUpperCase().toLowerCase();
    const matches = siblings.filter((entry) => entry.name.normalize('NFC').toUpperCase().toLowerCase() === folded);
    if (matches.length > 1 || (matches.length === 1 && matches[0]!.name !== name)) {
      throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', '目标父目录存在大小写歧义');
    }
    if (matches.length === 1) {
      const identity = await assetImportDirectoryIdentity(absolute);
      return this.updatePublication(previous, (next) => {
        next.parents.push({ relativePath, state: 'PREEXISTING', identity });
      });
    }

    let current = await this.updatePublication(previous, (next) => {
      next.parents.push({ relativePath, state: 'CREATE_INTENT' });
    });
    await this.fault('after_parent_intent_before_mkdir');
    await this.assertProjectMutationFence(previous.operationId);
    try {
      await fs.mkdir(absolute);
      await syncParentDirectories(parent, absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return this.enterRecovery(previous.operationId, '目标父目录在创建窗口被其他写入者占用');
      }
      throw error;
    }
    const identity = await assetImportDirectoryIdentity(absolute);
    await this.fault('after_mkdir_before_parent_journal');
    current = await this.updatePublication(current, (next) => {
      const record = next.parents.find((entry) => entry.relativePath === relativePath);
      if (record === undefined) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '目标父目录 journal 缺失');
      record.state = 'CREATED';
      record.identity = identity;
    });
    return current;
  }

  private async ensurePublicationParents(
    previous: AssetImportPublicationRecord,
  ): Promise<AssetImportPublicationRecord> {
    let current = previous;
    for (const file of current.files) {
      const segments = path.posix.dirname(file.targetPath).split('/');
      let relative = '';
      for (const segment of segments) {
        relative = relative.length === 0 ? segment : `${relative}/${segment}`;
        current = await this.ensurePublicationParent(current, relative);
      }
    }
    return current;
  }

  private async ensureProjectOperationWorkspace(
    previous: AssetImportPublicationRecord,
  ): Promise<AssetImportPublicationRecord> {
    const operationId = previous.operationId;
    const directories = [
      '.surdet',
      '.surdet/asset-import',
      `.surdet/asset-import/${operationId}`,
      `.surdet/asset-import/${operationId}/prepared`,
      `.surdet/asset-import/${operationId}/rollback`,
      `.surdet/asset-import/${operationId}/undo`,
    ];
    let current = previous;
    for (const directory of directories) current = await this.ensurePublicationParent(current, directory);
    await assertAssetImportProjectOperationWorkspace(this.paths, operationId).catch(() => this.enterRecovery(
      operationId,
      '项目内部发布工作区无法按 journal 身份复核',
    ));
    return current;
  }

  private async copyPreparedFile(
    operationId: string,
    staged: ProjectAssetImportStagedItem,
    prepared: string,
  ): Promise<Awaited<ReturnType<typeof assetImportFileIdentity>>> {
    const source = this.store.stagedItemBinaryFile(operationId, staged.itemId);
    const sourceEvidence = await this.readFileEvidence(source);
    if (sourceEvidence.bytes !== staged.bytes || sourceEvidence.sha256 !== staged.sha256) {
      return this.enterRecovery(operationId, '暂存素材在发布前发生变化');
    }
    const input = await fs.open(source, 'r');
    let output: fs.FileHandle | undefined;
    let created = false;
    try {
      await this.assertProjectMutationFence(operationId);
      output = await fs.open(prepared, 'wx', 0o600);
      created = true;
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      while (position < staged.bytes) {
        const read = await input.read(buffer, 0, Math.min(buffer.byteLength, staged.bytes - position), position);
        if (read.bytesRead <= 0) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', 'prepared 素材复制不完整');
        await writeWhole(output, buffer.subarray(0, read.bytesRead));
        position += read.bytesRead;
      }
      await output.sync();
      await output.close();
      output = undefined;
      await syncParentDirectories(path.dirname(prepared));
    } catch (error) {
      if (output !== undefined) await output.close().catch(() => undefined);
      if (created) return this.enterRecovery(operationId, 'prepared 复制未完成，已保留本次创建的部分证据');
      throw error;
    } finally {
      await input.close();
    }
    const evidence = await this.readFileEvidence(prepared);
    if (evidence.bytes !== staged.bytes || evidence.sha256 !== staged.sha256) {
      return this.enterRecovery(operationId, 'prepared 素材与暂存事实不一致');
    }
    return evidence.identity;
  }

  private async verifyHardLinkCapability(
    operationId: string,
    preparedFile: string,
  ): Promise<void> {
    const workspace = await assertAssetImportProjectOperationWorkspace(this.paths, operationId);
    const probe = path.join(workspace.prepared, `.hard-link-probe-${crypto.randomUUID()}`);
    let probeCreated = false;
    try {
      await this.assertProjectMutationFence(operationId);
      await fs.link(preparedFile, probe);
      probeCreated = true;
      const sourceIdentity = await assetImportFileIdentity(preparedFile);
      const probeIdentity = await assetImportFileIdentity(probe);
      if (sourceIdentity.device !== probeIdentity.device || sourceIdentity.inode !== probeIdentity.inode) {
        throw new AssetImportAuthorityError('IMPORT_FILESYSTEM_UNSUPPORTED', '项目文件系统无法证明硬链接身份');
      }
    } catch (error) {
      if (error instanceof AssetImportAuthorityError) throw error;
      throw new AssetImportAuthorityError('IMPORT_FILESYSTEM_UNSUPPORTED', '项目文件系统不支持安全硬链接');
    } finally {
      if (probeCreated) {
        await fs.rm(probe, { force: true }).catch(() => undefined);
        await syncParentDirectories(path.dirname(probe)).catch(() => undefined);
      }
    }
  }

  private async verifyReceipt(receipt: ProjectAssetImportReceipt): Promise<void> {
    const { receiptSha256, ...semantic } = receipt;
    const actual = await this.textHasher.sha256(stableStringify(semantic));
    if (actual !== receiptSha256) return this.enterRecovery(receipt.operationId, '导入回执内容与回执指纹不一致');
  }

  private async verifyTerminalInvariants(
    operationId: string,
    status: AssetImportOperationStatus,
  ): Promise<void> {
    if (status !== 'COMMITTED' && status !== 'UNDONE') return;
    const manifest = await this.readVerifiedManifest(operationId);
    const plan = await this.store.readPlan(operationId);
    if (plan === null) return this.enterRecovery(operationId, `${status} 操作缺少导入计划`);
    await this.verifyStoredTerminalPlan(manifest, plan);
    const publication = await this.store.readPublication(operationId);
    if (publication === null) return this.enterRecovery(operationId, `${status} 操作缺少发布 journal`);
    const receipt = await this.store.readReceipt(operationId);
    if (receipt === null) return this.enterRecovery(operationId, `${status} 操作缺少成功回执`);
    await this.verifyReceipt(receipt);
    if (publication.planId !== plan.plan.planId
      || publication.planFingerprint !== plan.plan.planFingerprint
      || publication.files.length !== receipt.files.length) {
      return this.enterRecovery(operationId, `${status} 操作的计划、发布 journal 与回执不一致`);
    }
    const receiptFiles = new Map(receipt.files.map((file) => [file.itemId, file]));
    for (const file of publication.files) {
      const expected = receiptFiles.get(file.itemId);
      if (expected === undefined
        || expected.targetPath !== file.targetPath
        || expected.bytes !== file.bytes
        || expected.sha256 !== file.sha256
        || (file.finalIdentity !== undefined && !sameNodeIdentity(file.finalIdentity, expected.fileIdentity))) {
        return this.enterRecovery(operationId, `${status} 操作的文件证据不一致`);
      }
      if (status === 'COMMITTED' && file.state !== 'VERIFIED') {
        return this.enterRecovery(operationId, 'COMMITTED 操作的发布 journal 未处于 VERIFIED');
      }
    }
    if (status === 'COMMITTED') return;

    const undoReceipt = await this.store.readUndoReceipt(operationId);
    if (undoReceipt === null) return this.enterRecovery(operationId, 'UNDONE 操作缺少撤销回执');
    await this.verifyUndoReceipt(undoReceipt);
    for (const file of publication.files) {
      if (file.state !== 'UNDO_VERIFIED' || file.undoIdentity === undefined) {
        return this.enterRecovery(operationId, 'UNDONE 操作的撤销证据状态不完整');
      }
      // A completed undo releases the target path. Later imports or author
      // edits may legitimately reuse it; the retained undo evidence, not its
      // continued absence, proves this historical operation completed.
      const quarantine = absoluteAssetImportProjectPath(this.paths, file.undoRelativePath);
      const evidence = await this.readFileEvidence(quarantine).catch(() => this.enterRecovery(
        operationId,
        'UNDONE 操作的恢复副本缺失或不安全',
      ));
      if (!sameFileIdentity(evidence.identity, file.undoIdentity)
        || !sameNodeIdentity(evidence.identity, receiptFiles.get(file.itemId)!.fileIdentity)
        || evidence.bytes !== file.bytes
        || evidence.sha256 !== file.sha256) {
        return this.enterRecovery(operationId, 'UNDONE 操作的恢复副本发生变化');
      }
    }
  }

  private async fileIdentityOrNull(
    file: string,
  ): Promise<Awaited<ReturnType<typeof assetImportFileIdentity>> | null> {
    try {
      return await assetImportFileIdentity(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private initialPublication(
    operationId: string,
    plan: ProjectAssetImportPlan,
  ): Omit<AssetImportPublicationRecord, 'publicationSha256'> {
    return {
      schemaVersion: 1,
      operationId,
      publicationVersion: 1,
      previousGenerationSha256: null,
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      files: plan.items.map((item) => ({
        itemId: item.itemId,
        targetPath: item.targetPath,
        preparedRelativePath: `.surdet/asset-import/${operationId}/prepared/${item.itemId}.bin`,
        rollbackRelativePath: `.surdet/asset-import/${operationId}/rollback/${item.itemId}.bin`,
        undoRelativePath: `.surdet/asset-import/${operationId}/undo/${item.itemId}.bin`,
        bytes: item.bytes,
        sha256: item.sha256,
        state: 'UPLOADED' as const,
      })),
      parents: [],
      updatedAt: now(),
    };
  }

  private async verifyPreparedFile(
    operationId: string,
    file: AssetImportPublicationFile,
  ): Promise<Awaited<ReturnType<typeof assetImportFileIdentity>>> {
    const prepared = absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath);
    let evidence: Awaited<ReturnType<ProjectAssetImportAuthority['readFileEvidence']>>;
    try {
      evidence = await this.readFileEvidence(prepared);
    } catch {
      return this.enterRecovery(operationId, 'prepared 素材缺失、重定向或无法稳定读取');
    }
    if (evidence.bytes !== file.bytes || evidence.sha256 !== file.sha256
      || (file.preparedIdentity !== undefined && !sameFileIdentity(evidence.identity, file.preparedIdentity))) {
      return this.enterRecovery(operationId, 'prepared 素材证据与发布 journal 不一致');
    }
    return evidence.identity;
  }

  private async preparedNodeIdentity(
    operationId: string,
    file: AssetImportPublicationFile,
  ): Promise<Awaited<ReturnType<typeof assetImportFileIdentity>>> {
    if (file.preparedIdentity === undefined) {
      return this.enterRecovery(operationId, '发布 journal 缺少 prepared 身份');
    }
    const prepared = absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath);
    const current = await this.fileIdentityOrNull(prepared).catch(() => this.enterRecovery(
      operationId,
      'prepared 路径身份不安全',
    ));
    if (current === null || !sameNodeIdentity(current, file.preparedIdentity)) {
      return this.enterRecovery(operationId, 'prepared inode 缺失或被替换');
    }
    return current;
  }

  private async preparePublication(
    previous: AssetImportPublicationRecord,
    stagedItems: ProjectAssetImportStagedItem[],
  ): Promise<AssetImportPublicationRecord> {
    const stagedById = new Map(stagedItems.map((item) => [item.itemId, item]));
    let current = previous;
    for (const itemId of current.files.map((file) => file.itemId)) {
      let file = current.files.find((entry) => entry.itemId === itemId)!;
      const staged = stagedById.get(itemId);
      if (staged === undefined) return this.enterRecovery(current.operationId, '发布 journal 引用了未知暂存素材');
      if (file.state === 'UPLOADED') {
        current = await this.updatePublicationFile(current, itemId, (entry) => { entry.state = 'PREPARE_INTENT'; });
        file = current.files.find((entry) => entry.itemId === itemId)!;
        await this.fault('after_prepare_intent_before_file');
      }
      if (file.state === 'PREPARE_INTENT') {
        const prepared = absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath);
        let identity = await this.fileIdentityOrNull(prepared).catch(() => this.enterRecovery(
          current.operationId,
          'prepared 素材路径身份不安全',
        ));
        if (identity === null) {
          try {
            identity = await this.copyPreparedFile(current.operationId, staged, prepared);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
              return this.enterRecovery(current.operationId, 'prepared 素材在独占创建窗口被占用');
            }
            throw error;
          }
        } else {
          const evidence = await this.readFileEvidence(prepared).catch(() => this.enterRecovery(
            current.operationId,
            'prepared 素材无法稳定读取',
          ));
          if (evidence.bytes !== staged.bytes || evidence.sha256 !== staged.sha256) {
            return this.enterRecovery(current.operationId, 'prepared 素材与暂存事实不一致');
          }
          identity = evidence.identity;
        }
        await this.fault('after_prepare_file_before_journal');
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'PREPARED';
          entry.preparedIdentity = identity!;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
      }
      if (!['UPLOADED', 'PREPARE_INTENT'].includes(file.state)) {
        await this.verifyPreparedFile(current.operationId, file);
      }
    }
    return current;
  }

  private async verifyPublicationParents(record: AssetImportPublicationRecord): Promise<void> {
    await assertAssetImportProjectRootIdentity(this.paths);
    for (const parent of record.parents) {
      if (parent.state === 'CREATE_INTENT') {
        return this.enterRecovery(record.operationId, '目标父目录只留下创建意图');
      }
      if (parent.state === 'ROLLBACK_REMOVED') continue;
      const absolute = absoluteAssetImportProjectPath(this.paths, parent.relativePath);
      const current = await assetImportDirectoryIdentity(absolute).catch(() => this.enterRecovery(
        record.operationId,
        '目标父目录缺失、被替换或发生重定向',
      ));
      if (parent.identity === undefined || !sameNodeIdentity(current, parent.identity)) {
        return this.enterRecovery(record.operationId, '目标父目录身份与发布 journal 不一致');
      }
    }
  }

  private async linkAndVerifyPublication(
    previous: AssetImportPublicationRecord,
  ): Promise<AssetImportPublicationRecord> {
    let current = await this.ensurePublicationParents(previous);
    await this.verifyPublicationParents(current);
    for (const itemId of current.files.map((file) => file.itemId)) {
      let file = current.files.find((entry) => entry.itemId === itemId)!;
      if (file.state === 'PREPARED') {
        const targetFact = await inspectAssetImportTarget(this.paths, file.targetPath);
        if (targetFact.state !== 'absent') {
          throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '发布前目标路径已不再为空');
        }
        await this.verifyPublicationParents(current);
        current = await this.updatePublicationFile(current, itemId, (entry) => { entry.state = 'LINK_INTENT'; });
        file = current.files.find((entry) => entry.itemId === itemId)!;
        await this.fault('after_link_intent_before_link');
      }
      if (file.state === 'LINK_INTENT') {
        const prepared = absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath);
        const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
        const preparedIdentity = await this.preparedNodeIdentity(current.operationId, file);
        let finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
          current.operationId,
          '目标路径在链接窗口变得不安全',
        ));
        if (finalIdentity === null) {
          try {
            await this.assertProjectMutationFence(current.operationId);
            await fs.link(prepared, target);
            await syncFileAndParent(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              throw new AssetImportAuthorityError('IMPORT_PUBLICATION_FAILED', '素材文件无法发布到项目');
            }
          }
          finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
            current.operationId,
            '发布后的目标路径身份不安全',
          ));
          await this.fault('after_final_link_before_linked_journal');
        }
        if (finalIdentity === null || !sameNodeIdentity(preparedIdentity, finalIdentity)) {
          return this.enterRecovery(current.operationId, '目标路径被其他写入者占用，已保留现场');
        }
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'LINKED';
          entry.finalIdentity = finalIdentity!;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
        await this.fault('after_linked_journal_before_verify');
      }
      if (file.state === 'LINKED') {
        const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
        const evidence = await this.readFileEvidence(target).catch(() => this.enterRecovery(
          current.operationId,
          '已链接素材无法稳定读取',
        ));
        const preparedIdentity = await this.preparedNodeIdentity(current.operationId, file);
        if (!sameNodeIdentity(preparedIdentity, evidence.identity)) {
          return this.enterRecovery(current.operationId, '已链接素材不再指向 prepared 证据');
        }
        if (evidence.bytes !== file.bytes || evidence.sha256 !== file.sha256) {
          throw new AssetImportAuthorityError('IMPORT_PUBLICATION_FAILED', '已链接素材内容校验失败');
        }
        await this.fault('after_verify_before_verified_journal');
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'VERIFIED';
          entry.finalIdentity = evidence.identity;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
      }
      if (file.state === 'VERIFIED') {
        const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
        const evidence = await this.readFileEvidence(target).catch(() => this.enterRecovery(
          current.operationId,
          '已验证素材无法再次稳定读取',
        ));
        const preparedIdentity = await this.preparedNodeIdentity(current.operationId, file);
        if (!sameNodeIdentity(preparedIdentity, evidence.identity)
          || file.finalIdentity === undefined) {
          return this.enterRecovery(current.operationId, '已验证素材身份发生变化');
        }
        if (!sameFileIdentity(file.finalIdentity, evidence.identity)
          || evidence.bytes !== file.bytes || evidence.sha256 !== file.sha256) {
          throw new AssetImportAuthorityError('IMPORT_PUBLICATION_FAILED', '已验证素材内容发生变化');
        }
      } else if (!['PREPARED', 'LINK_INTENT', 'LINKED'].includes(file.state)) {
        return this.enterRecovery(current.operationId, '发布 journal 处于不能继续提交的文件状态');
      }
      await this.verifyPublicationParents(current);
    }
    return current;
  }

  private async verifyFullPublication(record: AssetImportPublicationRecord): Promise<void> {
    await this.verifyPublicationParents(record);
    for (const file of record.files) {
      if (file.state !== 'VERIFIED' || file.finalIdentity === undefined) {
        return this.enterRecovery(record.operationId, '整批发布尚未达到 VERIFIED');
      }
      const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
      const evidence = await this.readFileEvidence(target).catch(() => this.enterRecovery(
        record.operationId,
        '整批复核时素材缺失或无法稳定读取',
      ));
      const preparedIdentity = await this.preparedNodeIdentity(record.operationId, file);
      if (!sameNodeIdentity(preparedIdentity, evidence.identity)) {
        return this.enterRecovery(record.operationId, '整批复核时素材身份发生变化');
      }
      if (!sameFileIdentity(file.finalIdentity, evidence.identity)
        || evidence.bytes !== file.bytes || evidence.sha256 !== file.sha256) {
        throw new AssetImportAuthorityError('IMPORT_PUBLICATION_FAILED', '整批复核时素材内容发生变化');
      }
    }
    await this.verifyPublicationParents(record);
  }

  private async createCommittedReceipt(
    publication: AssetImportPublicationRecord,
    journal: AssetImportJournal,
  ): Promise<ProjectAssetImportReceipt> {
    const existing = await this.store.readReceipt(publication.operationId);
    if (existing !== null) {
      await this.verifyReceipt(existing);
      return existing;
    }
    const semantic = {
      schemaVersion: 1 as const,
      receiptId: crypto.randomUUID(),
      operationId: publication.operationId,
      planId: publication.planId,
      planFingerprint: publication.planFingerprint,
      projectIdentity: this.paths.projectIdentity,
      status: 'COMMITTED' as const,
      journalVersion: journal.journalVersion,
      authorityContractVersion: 1 as const,
      files: publication.files.map((file) => {
        if (file.state !== 'VERIFIED' || file.finalIdentity === undefined) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '不能为未验证素材创建回执');
        }
        return {
          itemId: file.itemId,
          targetPath: file.targetPath,
          bytes: file.bytes,
          sha256: file.sha256,
          fileIdentity: {
            device: file.finalIdentity.device,
            inode: file.finalIdentity.inode,
            birthtimeNs: file.finalIdentity.birthtimeNs,
          },
        };
      }),
      committedAt: now(),
    };
    const receipt: ProjectAssetImportReceipt = {
      ...semantic,
      receiptSha256: await this.textHasher.sha256(stableStringify(semantic)),
    };
    const written = await this.store.writeReceipt(receipt);
    await this.verifyReceipt(written);
    await this.fault('after_receipt_create_before_committed_journal');
    return written;
  }

  private async cleanupCommittedPrepared(publication: AssetImportPublicationRecord): Promise<void> {
    for (const file of publication.files) {
      if (file.preparedIdentity === undefined) continue;
      const prepared = absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath);
      const current = await this.fileIdentityOrNull(prepared).catch(() => null);
      if (current !== null && sameNodeIdentity(current, file.preparedIdentity)) {
        await fs.unlink(prepared).catch(() => undefined);
        await syncParentDirectories(path.dirname(prepared));
      }
    }
  }

  private async removeRollbackParents(
    previous: AssetImportPublicationRecord,
  ): Promise<AssetImportPublicationRecord> {
    let current = previous;
    const ordered = [...current.parents].sort((left, right) =>
      right.relativePath.split('/').length - left.relativePath.split('/').length);
    for (const snapshot of ordered) {
      let parent = current.parents.find((entry) => entry.relativePath === snapshot.relativePath)!;
      if (['PREEXISTING', 'ROLLBACK_REMOVED', 'ROLLBACK_PRESERVED'].includes(parent.state)) continue;
      if (parent.state === 'CREATE_INTENT') {
        return this.enterRecovery(current.operationId, '目标父目录仅有创建意图，不能自动删除');
      }
      if (parent.state === 'CREATED') {
        current = await this.updatePublication(current, (next) => {
          const entry = next.parents.find((candidate) => candidate.relativePath === parent.relativePath)!;
          entry.state = 'ROLLBACK_REMOVE_INTENT';
        });
        parent = current.parents.find((entry) => entry.relativePath === snapshot.relativePath)!;
      }
      const absolute = absoluteAssetImportProjectPath(this.paths, parent.relativePath);
      const identity = await assetImportDirectoryIdentity(absolute).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        return this.enterRecovery(current.operationId, '回滚父目录缺失或身份不安全');
      });
      if (identity === null) {
        current = await this.updatePublication(current, (next) => {
          const entry = next.parents.find((candidate) => candidate.relativePath === parent.relativePath)!;
          entry.state = 'ROLLBACK_REMOVED';
          delete entry.identity;
        });
        continue;
      }
      if (parent.identity === undefined || !sameNodeIdentity(identity, parent.identity)) {
        current = await this.updatePublication(current, (next) => {
          const entry = next.parents.find((candidate) => candidate.relativePath === parent.relativePath)!;
          entry.state = 'ROLLBACK_PRESERVED';
          entry.identity = identity;
        });
        continue;
      }
      const entries = await fs.readdir(absolute);
      if (entries.length !== 0) {
        current = await this.updatePublication(current, (next) => {
          const entry = next.parents.find((candidate) => candidate.relativePath === parent.relativePath)!;
          entry.state = 'ROLLBACK_PRESERVED';
          entry.identity = identity;
        });
        continue;
      }
      try {
        await this.assertProjectMutationFence(current.operationId);
        await fs.rmdir(absolute);
        await syncParentDirectories(path.dirname(absolute));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
          const preservedIdentity = await assetImportDirectoryIdentity(absolute);
          current = await this.updatePublication(current, (next) => {
            const entry = next.parents.find((candidate) => candidate.relativePath === parent.relativePath)!;
            entry.state = 'ROLLBACK_PRESERVED';
            entry.identity = preservedIdentity;
          });
          continue;
        }
        throw error;
      }
      current = await this.updatePublication(current, (next) => {
        const entry = next.parents.find((candidate) => candidate.relativePath === parent.relativePath)!;
        entry.state = 'ROLLBACK_REMOVED';
        delete entry.identity;
      });
    }
    return current;
  }

  private async rollbackPublication(
    operationId: string,
    publication: AssetImportPublicationRecord | null,
  ): Promise<AssetImportJournal> {
    let journal = (await this.store.readOperation(operationId)).journal;
    if (journal.status === 'ROLLED_BACK') return journal;
    if (journal.status === 'PUBLISHING' || journal.status === 'RECOVERY_REQUIRED') {
      journal = await this.transition(journal, 'ROLLING_BACK');
    }
    if (journal.status !== 'ROLLING_BACK') {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能回滚素材发布');
    }
    if (publication === null) return this.transition(journal, 'ROLLED_BACK');
    await assertAssetImportProjectOperationWorkspace(this.paths, operationId).catch(() => this.enterRecovery(
      operationId,
      '回滚所需的项目内部工作区缺失或不安全',
    ));
    let current = publication;
    for (const itemId of [...current.files].reverse().map((file) => file.itemId)) {
      let file = current.files.find((entry) => entry.itemId === itemId)!;
      if (['UPLOADED', 'PREPARE_INTENT', 'PREPARED'].includes(file.state)) continue;
      const preparedIdentity = await this.preparedNodeIdentity(operationId, file);
      const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
      const quarantine = absoluteAssetImportProjectPath(this.paths, file.rollbackRelativePath);
      if (file.state === 'LINK_INTENT') {
        const finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
          operationId,
          '回滚分类时目标路径身份不安全',
        ));
        if (finalIdentity === null) continue;
        if (!sameNodeIdentity(finalIdentity, preparedIdentity)) {
          return this.enterRecovery(operationId, '目标路径不是本次发布的 inode，已保留外部文件');
        }
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'LINKED';
          entry.finalIdentity = finalIdentity;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
        await this.fault('after_rollback_rename_intent_before_rename');
      }
      if (file.state === 'LINKED' || file.state === 'VERIFIED') {
        const finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
          operationId,
          '回滚前目标路径身份不安全',
        ));
        if (finalIdentity === null || !sameNodeIdentity(finalIdentity, preparedIdentity)
          || (file.finalIdentity !== undefined && !sameNodeIdentity(finalIdentity, file.finalIdentity))) {
          return this.enterRecovery(operationId, '已发布目标缺失或被替换，不能自动回滚');
        }
        const quarantineIdentity = await this.fileIdentityOrNull(quarantine).catch(() => this.enterRecovery(
          operationId,
          '回滚隔离路径身份不安全',
        ));
        if (quarantineIdentity !== null) {
          return this.enterRecovery(operationId, '回滚隔离路径已被占用');
        }
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'ROLLBACK_RENAME_INTENT';
          entry.finalIdentity = finalIdentity;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
      }
      if (file.state === 'ROLLBACK_RENAME_INTENT') {
        const finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
          operationId,
          '回滚重启分类时目标路径不安全',
        ));
        const quarantineIdentity = await this.fileIdentityOrNull(quarantine).catch(() => this.enterRecovery(
          operationId,
          '回滚重启分类时隔离路径不安全',
        ));
        if ((finalIdentity === null) === (quarantineIdentity === null)) {
          return this.enterRecovery(operationId, '回滚重启时目标与隔离路径状态存在歧义');
        }
        if (finalIdentity !== null) {
          if (!sameNodeIdentity(finalIdentity, preparedIdentity)) {
            return this.enterRecovery(operationId, '回滚重启时目标已被替换');
          }
          await this.assertProjectMutationFence(operationId);
          await fs.rename(target, quarantine).catch(() => this.enterRecovery(
            operationId,
            '目标文件无法原子移入回滚隔离区',
          ));
          await syncFileAndParent(quarantine);
          await syncParentDirectories(path.dirname(target));
          await this.fault('after_rollback_final_rename_before_quarantined_journal');
        }
        const evidence = await this.readFileEvidence(quarantine).catch(() => this.enterRecovery(
          operationId,
          '回滚隔离证据无法稳定读取',
        ));
        if (!sameNodeIdentity(evidence.identity, preparedIdentity)
          || evidence.bytes !== file.bytes || evidence.sha256 !== file.sha256) {
          const restoredTarget = await this.fileIdentityOrNull(target).catch(() => null);
          if (restoredTarget === null) {
            await fs.link(quarantine, target).catch(() => undefined);
            await syncFileAndParent(target).catch(() => undefined);
          }
          return this.enterRecovery(operationId, '回滚隔离内容与本次发布证据不一致');
        }
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'ROLLBACK_QUARANTINED';
          entry.quarantineIdentity = evidence.identity;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
      }
      if (file.state === 'ROLLBACK_QUARANTINED') {
        if (await this.fileIdentityOrNull(target) !== null) {
          return this.enterRecovery(operationId, '已回滚目标路径再次被占用');
        }
        const evidence = await this.readFileEvidence(quarantine).catch(() => this.enterRecovery(
          operationId,
          '回滚隔离证据缺失或无法稳定读取',
        ));
        if (file.quarantineIdentity === undefined || !sameFileIdentity(evidence.identity, file.quarantineIdentity)
          || evidence.bytes !== file.bytes || evidence.sha256 !== file.sha256) {
          return this.enterRecovery(operationId, '回滚隔离证据发生变化');
        }
      }
    }
    current = await this.removeRollbackParents(current);
    journal = (await this.store.readOperation(operationId)).journal;
    if (journal.status !== 'ROLLING_BACK') {
      return this.enterRecovery(operationId, '回滚结束前操作 journal 状态发生变化');
    }
    return this.transition(journal, 'ROLLED_BACK');
  }

  private async finishCommittedPublication(
    publication: AssetImportPublicationRecord,
  ): Promise<CommitOperationResponse> {
    await this.verifyFullPublication(publication);
    let journal = (await this.store.readOperation(publication.operationId)).journal;
    const receipt = await this.createCommittedReceipt(publication, journal);
    journal = (await this.store.readOperation(publication.operationId)).journal;
    if (journal.status === 'RECOVERY_REQUIRED') journal = await this.transition(journal, 'PUBLISHING');
    if (journal.status === 'PUBLISHING') journal = await this.transition(journal, 'COMMITTED');
    if (journal.status !== 'COMMITTED') {
      return this.enterRecovery(publication.operationId, '成功回执已存在，但 COMMITTED 状态无法落盘');
    }
    await this.cleanupCommittedPrepared(publication);
    return { operation: journal, receipt };
  }

  private async verifyUndoReceipt(receipt: ProjectAssetImportUndoReceipt): Promise<void> {
    const { undoReceiptSha256, ...semantic } = receipt;
    const actual = await this.textHasher.sha256(stableStringify(semantic));
    if (actual !== undoReceiptSha256) {
      return this.enterRecovery(receipt.operationId, '撤销回执内容与回执指纹不一致');
    }
  }

  private async assertUndoTargetMatchesReceipt(
    operationId: string,
    targetPath: string,
    expected: ProjectAssetImportReceipt['files'][number],
    changedIsBlocked: boolean,
  ): Promise<Awaited<ReturnType<ProjectAssetImportAuthority['readFileEvidence']>>> {
    const target = absoluteAssetImportProjectPath(this.paths, targetPath);
    let evidence: Awaited<ReturnType<ProjectAssetImportAuthority['readFileEvidence']>>;
    try {
      evidence = await this.readFileEvidence(target);
    } catch {
      if (changedIsBlocked) {
        throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', '至少一个已导入素材缺失或无法稳定读取');
      }
      return this.enterRecovery(operationId, '撤销窗口中的目标素材缺失或无法稳定读取');
    }
    if (!sameNodeIdentity(evidence.identity, expected.fileIdentity)
      || evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
      if (changedIsBlocked) {
        throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', '至少一个已导入素材已被修改或替换');
      }
      return this.enterRecovery(operationId, '撤销预检后目标素材发生变化');
    }
    return evidence;
  }

  private async preflightUndo(
    publication: AssetImportPublicationRecord,
    receipt: ProjectAssetImportReceipt,
  ): Promise<void> {
    await assertAssetImportProjectOperationWorkspace(this.paths, publication.operationId).catch(() => this.enterRecovery(
      publication.operationId,
      '撤销工作区缺失或身份不安全',
    ));
    await this.verifyPublicationParents(publication);
    const receiptByItemId = new Map(receipt.files.map((file) => [file.itemId, file]));
    for (const file of publication.files) {
      if (file.state !== 'VERIFIED') {
        return this.enterRecovery(publication.operationId, 'COMMITTED 发布 journal 不是可撤销的 VERIFIED 状态');
      }
      const expected = receiptByItemId.get(file.itemId);
      if (expected === undefined || expected.targetPath !== file.targetPath) {
        return this.enterRecovery(publication.operationId, '成功回执与发布 journal 不一致');
      }
      await this.assertUndoTargetMatchesReceipt(publication.operationId, file.targetPath, expected, true);
      const undo = absoluteAssetImportProjectPath(this.paths, file.undoRelativePath);
      const undoIdentity = await this.fileIdentityOrNull(undo).catch(() => this.enterRecovery(
        publication.operationId,
        '撤销隔离路径身份不安全',
      ));
      if (undoIdentity !== null) return this.enterRecovery(publication.operationId, '撤销隔离路径已被占用');
    }
    await this.verifyPublicationParents(publication);
  }

  private async createUndoReceipt(
    publication: AssetImportPublicationRecord,
    journal: AssetImportJournal,
  ): Promise<ProjectAssetImportUndoReceipt> {
    const existing = await this.store.readUndoReceipt(publication.operationId);
    if (existing !== null) {
      await this.verifyUndoReceipt(existing);
      return existing;
    }
    const semantic = {
      schemaVersion: 1 as const,
      undoReceiptId: crypto.randomUUID(),
      operationId: publication.operationId,
      projectIdentity: this.paths.projectIdentity,
      status: 'UNDONE' as const,
      journalVersion: journal.journalVersion,
      removedPaths: publication.files.map((file) => file.targetPath).sort(),
      quarantinePaths: publication.files.map((file) => file.undoRelativePath).sort(),
      undoneAt: now(),
    };
    const receipt: ProjectAssetImportUndoReceipt = {
      ...semantic,
      undoReceiptSha256: await this.textHasher.sha256(stableStringify(semantic)),
    };
    const written = await this.store.writeUndoReceipt(receipt);
    await this.verifyUndoReceipt(written);
    return written;
  }

  private async assertUndoMutationBoundary(publication: AssetImportPublicationRecord): Promise<void> {
    try {
      await this.assertProjectMutationFence(publication.operationId);
      await assertAssetImportProjectOperationWorkspace(this.paths, publication.operationId);
      await this.verifyPublicationParents(publication);
    } catch (error) {
      if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') throw error;
      return this.enterRecovery(publication.operationId, '撤销前项目根、工作区或目标父目录身份不安全');
    }
  }

  private async preflightUndoContinuation(
    publication: AssetImportPublicationRecord,
    receipt: ProjectAssetImportReceipt,
  ): Promise<void> {
    await this.assertUndoMutationBoundary(publication);
    const receiptByItemId = new Map(receipt.files.map((file) => [file.itemId, file]));
    for (const file of publication.files) {
      const expected = receiptByItemId.get(file.itemId);
      if (expected === undefined || expected.targetPath !== file.targetPath) {
        return this.enterRecovery(publication.operationId, '撤销恢复时成功回执与发布 journal 不一致');
      }
      const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
      const undo = absoluteAssetImportProjectPath(this.paths, file.undoRelativePath);
      const finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
        publication.operationId,
        '撤销恢复整批预检时目标路径不安全',
      ));
      const undoIdentity = await this.fileIdentityOrNull(undo).catch(() => this.enterRecovery(
        publication.operationId,
        '撤销恢复整批预检时隔离路径不安全',
      ));
      if (file.state === 'VERIFIED') {
        if (undoIdentity !== null) return this.enterRecovery(publication.operationId, '撤销隔离路径已被占用');
        await this.assertUndoTargetMatchesReceipt(publication.operationId, file.targetPath, expected, false);
        continue;
      }
      if (file.state === 'UNDO_RENAME_INTENT') {
        if ((finalIdentity === null) === (undoIdentity === null)) {
          return this.enterRecovery(publication.operationId, '撤销恢复整批预检发现路径状态歧义');
        }
        if (finalIdentity !== null) {
          await this.assertUndoTargetMatchesReceipt(publication.operationId, file.targetPath, expected, false);
        } else {
          const evidence = await this.readFileEvidence(undo).catch(() => this.enterRecovery(
            publication.operationId,
            '撤销恢复整批预检无法读取待确认隔离证据',
          ));
          if (!sameNodeIdentity(evidence.identity, expected.fileIdentity)
            || evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
            await this.restoreUndoQuarantineIfFinalAbsent(publication, target, undo);
            return this.enterRecovery(publication.operationId, '撤销恢复整批预检发现待确认隔离内容变化');
          }
        }
        continue;
      }
      if (file.state === 'UNDO_QUARANTINED' || file.state === 'UNDO_VERIFIED') {
        if (finalIdentity !== null || undoIdentity === null || file.undoIdentity === undefined) {
          return this.enterRecovery(publication.operationId, '撤销恢复整批预检发现隔离状态不一致');
        }
        const evidence = await this.readFileEvidence(undo).catch(() => this.enterRecovery(
          publication.operationId,
          '撤销恢复整批预检无法读取隔离证据',
        ));
        if (!sameFileIdentity(evidence.identity, file.undoIdentity)
          || !sameNodeIdentity(evidence.identity, expected.fileIdentity)
          || evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
          return this.enterRecovery(publication.operationId, '撤销恢复整批预检发现隔离证据变化');
        }
        continue;
      }
      return this.enterRecovery(publication.operationId, '撤销恢复整批预检发现非法文件状态');
    }
    await this.assertUndoMutationBoundary(publication);
  }

  private async restoreUndoQuarantineIfFinalAbsent(
    publication: AssetImportPublicationRecord,
    target: string,
    undo: string,
  ): Promise<void> {
    await this.assertUndoMutationBoundary(publication);
    if (await this.fileIdentityOrNull(target).catch(() => null) !== null) return;
    try {
      await this.assertUndoMutationBoundary(publication);
      await fs.link(undo, target);
      await syncFileAndParent(target);
      await this.assertUndoMutationBoundary(publication);
      const targetIdentity = await assetImportFileIdentity(target);
      const undoIdentity = await assetImportFileIdentity(undo);
      if (sameNodeIdentity(targetIdentity, undoIdentity)) {
        await fs.unlink(undo);
        await syncParentDirectories(path.dirname(undo));
      }
    } catch {
      // A concurrent writer or interrupted restore leaves every extant path intact for manual recovery.
    }
  }

  private async continueUndo(
    operationId: string,
    previous: AssetImportPublicationRecord,
    receipt: ProjectAssetImportReceipt,
  ): Promise<UndoOperationResponse> {
    await this.preflightUndoContinuation(previous, receipt);
    let journal = (await this.store.readOperation(operationId)).journal;
    if (journal.status === 'RECOVERY_REQUIRED') journal = await this.transition(journal, 'UNDOING');
    if (journal.status !== 'UNDOING') {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能继续撤销');
    }
    const receiptByItemId = new Map(receipt.files.map((file) => [file.itemId, file]));
    let current = previous;
    for (const itemId of current.files.map((file) => file.itemId)) {
      await this.assertUndoMutationBoundary(current);
      let file = current.files.find((entry) => entry.itemId === itemId)!;
      const expected = receiptByItemId.get(itemId);
      if (expected === undefined || expected.targetPath !== file.targetPath) {
        return this.enterRecovery(operationId, '撤销时成功回执与发布 journal 不一致');
      }
      const target = absoluteAssetImportProjectPath(this.paths, file.targetPath);
      const undo = absoluteAssetImportProjectPath(this.paths, file.undoRelativePath);
      if (file.state === 'VERIFIED') {
        await this.assertUndoTargetMatchesReceipt(operationId, file.targetPath, expected, false);
        if (await this.fileIdentityOrNull(undo).catch(() => this.enterRecovery(
          operationId,
          '撤销隔离路径身份不安全',
        )) !== null) return this.enterRecovery(operationId, '撤销隔离路径已被占用');
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'UNDO_RENAME_INTENT';
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
        await this.fault('after_undo_rename_intent_before_rename');
      }
      if (file.state === 'UNDO_RENAME_INTENT') {
        const finalIdentity = await this.fileIdentityOrNull(target).catch(() => this.enterRecovery(
          operationId,
          '撤销重启分类时目标路径不安全',
        ));
        const undoIdentity = await this.fileIdentityOrNull(undo).catch(() => this.enterRecovery(
          operationId,
          '撤销重启分类时隔离路径不安全',
        ));
        if ((finalIdentity === null) === (undoIdentity === null)) {
          return this.enterRecovery(operationId, '撤销重启时目标与隔离路径状态存在歧义');
        }
        if (finalIdentity !== null) {
          await this.assertUndoMutationBoundary(current);
          await this.assertUndoTargetMatchesReceipt(operationId, file.targetPath, expected, false);
          await fs.rename(target, undo).catch(() => this.enterRecovery(
            operationId,
            '目标文件无法原子移入撤销隔离区',
          ));
          await syncFileAndParent(undo);
          await syncParentDirectories(path.dirname(target));
          await this.fault('after_undo_final_rename_before_quarantined_journal');
        }
        const evidence = await this.readFileEvidence(undo).catch(() => this.enterRecovery(
          operationId,
          '撤销隔离证据无法稳定读取',
        ));
        if (!sameNodeIdentity(evidence.identity, expected.fileIdentity)
          || evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
          await this.restoreUndoQuarantineIfFinalAbsent(current, target, undo);
          return this.enterRecovery(operationId, '撤销隔离内容与成功回执不一致');
        }
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'UNDO_QUARANTINED';
          entry.undoIdentity = evidence.identity;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
      }
      if (file.state === 'UNDO_QUARANTINED') {
        if (await this.fileIdentityOrNull(target) !== null) {
          return this.enterRecovery(operationId, '已撤销目标路径再次被占用');
        }
        const evidence = await this.readFileEvidence(undo).catch(() => this.enterRecovery(
          operationId,
          '撤销隔离证据缺失或无法稳定读取',
        ));
        if (file.undoIdentity === undefined || !sameFileIdentity(evidence.identity, file.undoIdentity)
          || !sameNodeIdentity(evidence.identity, expected.fileIdentity)
          || evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
          return this.enterRecovery(operationId, '撤销隔离证据发生变化');
        }
        current = await this.updatePublicationFile(current, itemId, (entry) => {
          entry.state = 'UNDO_VERIFIED';
          entry.undoIdentity = evidence.identity;
        });
        file = current.files.find((entry) => entry.itemId === itemId)!;
      }
      if (file.state === 'UNDO_VERIFIED') {
        if (await this.fileIdentityOrNull(target) !== null) {
          return this.enterRecovery(operationId, '撤销完成前目标路径被重新占用');
        }
        const evidence = await this.readFileEvidence(undo).catch(() => this.enterRecovery(
          operationId,
          '撤销完成前隔离证据无法读取',
        ));
        if (file.undoIdentity === undefined || !sameFileIdentity(evidence.identity, file.undoIdentity)
          || !sameNodeIdentity(evidence.identity, expected.fileIdentity)
          || evidence.bytes !== expected.bytes || evidence.sha256 !== expected.sha256) {
          return this.enterRecovery(operationId, '撤销完成前隔离证据发生变化');
        }
      } else if (!['VERIFIED', 'UNDO_RENAME_INTENT', 'UNDO_QUARANTINED'].includes(file.state)) {
        return this.enterRecovery(operationId, '发布 journal 处于不能继续撤销的文件状态');
      }
    }
    await this.fault('after_undo_quarantine_verify_before_undo_receipt');
    journal = (await this.store.readOperation(operationId)).journal;
    const undoReceipt = await this.createUndoReceipt(current, journal);
    journal = (await this.store.readOperation(operationId)).journal;
    if (journal.status === 'RECOVERY_REQUIRED') journal = await this.transition(journal, 'UNDOING');
    if (journal.status === 'UNDOING') journal = await this.transition(journal, 'UNDONE');
    if (journal.status !== 'UNDONE') {
      return this.enterRecovery(operationId, '撤销回执已存在，但 UNDONE 状态无法落盘');
    }
    return { operation: journal, undoReceipt };
  }

  async plan(operationIdInput: string, request: PlanOperationRequest): Promise<PlanOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.requireNoRecoveryBarrier();
      const current = await this.store.readOperation(operationId);
      if (!['STAGED', 'READY'].includes(current.journal.status)) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能创建导入计划');
      }
      const manifest = await this.readVerifiedManifest(operationId);
      const built = await this.buildPlan(manifest, request.targets);
      const plan = built.plan;
      const previous = await this.store.readPlan(operationId);
      if (previous !== null) await this.verifyStoredPlan(manifest, previous);
      if (current.journal.status === 'READY' && previous?.plan.planFingerprint !== plan.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '已封存计划不能替换');
      }
      const record: AssetImportOperationPlanRecord = {
        schemaVersion: 1,
        operationId,
        targets: request.targets.map((target) => ({ ...target, fileName: target.fileName.normalize('NFC') })),
        targetFacts: built.targetFacts,
        plan,
      };
      await this.store.writePlan(record);
      return { operationId, status: plan.status === 'ready' ? 'READY' : 'STAGED', plan };
    }));
  }

  async seal(operationIdInput: string, request: SealOperationRequest): Promise<SealOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.requireNoRecoveryBarrier();
      const current = await this.store.readOperation(operationId);
      if (!['STAGED', 'READY'].includes(current.journal.status)) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能封存计划');
      }
      const record = await this.store.readPlan(operationId);
      if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '尚未创建导入计划');
      if (record.plan.planFingerprint !== request.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '计划指纹不匹配');
      }
      if (record.plan.status !== 'ready') throw new AssetImportAuthorityError('IMPORT_PLAN_BLOCKED', '导入计划仍有阻断项');
      const manifest = await this.readVerifiedManifest(operationId);
      await this.verifyStoredPlan(manifest, record);
      const fresh = (await this.buildPlan(manifest, record.targets)).plan;
      if (fresh.planFingerprint !== record.plan.planFingerprint || fresh.status !== 'ready') {
        throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '项目内容已变化，请重新规划');
      }
      if (current.journal.status === 'STAGED') await this.transition(current.journal, 'READY');
      return {
        operationId,
        status: 'READY',
        planId: record.plan.planId,
        planFingerprint: record.plan.planFingerprint,
      };
    }));
  }

  async commit(operationIdInput: string, request: CommitOperationRequest): Promise<CommitOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.requireNoRecoveryBarrier();
      let current = await this.store.readOperation(operationId);
      if (current.journal.status === 'COMMITTED') {
        const receipt = await this.store.readReceipt(operationId);
        if (receipt === null) return this.enterRecovery(operationId, 'COMMITTED 操作缺少成功回执');
        await this.verifyReceipt(receipt);
        return { operation: current.journal, receipt };
      }
      if (current.journal.status !== 'READY') {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能提交素材导入');
      }
      const planRecord = await this.store.readPlan(operationId);
      if (planRecord === null || planRecord.plan.status !== 'ready') {
        throw new AssetImportAuthorityError('IMPORT_PLAN_BLOCKED', '没有可提交的封存计划');
      }
      if (request.planFingerprint !== planRecord.plan.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '计划指纹不匹配');
      }
      const manifest = await this.readVerifiedManifest(operationId);
      await this.verifyStoredPlan(manifest, planRecord);
      const fresh = (await this.buildPlan(manifest, planRecord.targets)).plan;
      if (fresh.status !== 'ready' || fresh.planFingerprint !== planRecord.plan.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '项目内容已变化，请重新规划');
      }
      const stagedItems = await this.verifiedStagedItems(manifest, true);
      let publication = await this.store.readPublication(operationId);
      if (publication === null) {
        publication = await this.store.createPublication(this.initialPublication(operationId, planRecord.plan));
      }
      current = { ...current, journal: await this.transition(current.journal, 'PUBLISHING') };
      try {
        publication = await this.ensureProjectOperationWorkspace(publication);
        publication = await this.preparePublication(publication, stagedItems);
        const prepared = absoluteAssetImportProjectPath(this.paths, publication.files[0]!.preparedRelativePath);
        await this.verifyHardLinkCapability(operationId, prepared);
        publication = await this.linkAndVerifyPublication(publication);
        return await this.finishCommittedPublication(publication);
      } catch (error) {
        if (error instanceof AssetImportInjectedTermination) throw error;
        if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') {
          const status = (await this.store.readOperation(operationId).catch(() => null))?.journal.status;
          if (status === 'RECOVERY_REQUIRED') throw error;
          return this.enterRecovery(operationId, error.message);
        }
        const receipt = await this.store.readReceipt(operationId).catch(() => null);
        if (receipt !== null) return this.enterRecovery(operationId, '成功回执已落盘，需恢复完成 COMMITTED');
        const latestPublication = await this.store.readPublication(operationId).catch(() => publication);
        await this.rollbackPublication(operationId, latestPublication);
        throw error;
      }
    }));
  }

  async undo(operationIdInput: string, request: UndoOperationRequest): Promise<UndoOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    const receiptId = requireUuid(request.receiptId, 'receiptId');
    if (!/^[0-9a-f]{64}$/.test(request.receiptSha256)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'receiptSha256 格式无效');
    }
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.requireNoRecoveryBarrier();
      let journal = (await this.store.readOperation(operationId)).journal;
      const receipt = await this.store.readReceipt(operationId);
      if (receipt === null) return this.enterRecovery(operationId, '撤销操作缺少成功回执');
      await this.verifyReceipt(receipt);
      if (receipt.receiptId !== receiptId || receipt.receiptSha256 !== request.receiptSha256) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '撤销请求与成功回执身份不匹配');
      }
      if (journal.status === 'UNDONE') {
        const undoReceipt = await this.store.readUndoReceipt(operationId);
        if (undoReceipt === null) return this.enterRecovery(operationId, 'UNDONE 操作缺少撤销回执');
        await this.verifyUndoReceipt(undoReceipt);
        return { operation: journal, undoReceipt };
      }
      if (journal.status !== 'COMMITTED') {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能撤销素材导入');
      }
      if (await this.store.readUndoReceipt(operationId) !== null) {
        return this.enterRecovery(operationId, 'COMMITTED 操作意外存在撤销回执');
      }
      const publication = await this.store.readPublication(operationId);
      if (publication === null) return this.enterRecovery(operationId, '撤销操作缺少发布 journal');
      await this.preflightUndo(publication, receipt);
      journal = await this.transition(journal, 'UNDOING');
      try {
        return await this.continueUndo(operationId, publication, receipt);
      } catch (error) {
        if (error instanceof AssetImportInjectedTermination) throw error;
        if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') {
          const status = (await this.store.readOperation(operationId).catch(() => null))?.journal.status;
          if (status === 'RECOVERY_REQUIRED') throw error;
        }
        return this.enterRecovery(operationId, error instanceof Error ? error.message : '撤销中断');
      }
    }));
  }

  async recover(operationIdInput: string, request: RecoverOperationRequest): Promise<RecoverOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.assertLeaseHeld();
      const current = await this.store.readOperation(operationId);
      let journal = current.journal;
      if (request.manifestFingerprint !== undefined) {
        const manifest = await this.readVerifiedManifest(operationId);
        if (request.action !== 'rollback' || manifest.manifestFingerprint !== request.manifestFingerprint
          || current.hasSealedPlan || await this.store.readPlan(operationId) !== null
          || await this.store.readPublication(operationId) !== null
          || await this.store.readReceipt(operationId) !== null || await this.store.readUndoReceipt(operationId) !== null
          || !['RECOVERY_REQUIRED', 'ROLLING_BACK', 'ROLLED_BACK'].includes(journal.status)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '清单指纹只能用于放弃同一未封存上传，不能恢复或撤销已封存计划');
        }
        if (journal.status !== 'ROLLED_BACK') {
          // Only remove artifacts owned by this manifest. Unknown entries and unsafe
          // paths remain blocked; an interruption can retry the same manifest.
          await this.store.removePrePublicationArtifacts(manifest);
          await this.rollbackPublication(operationId, null);
        }
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      if (journal.status === 'UNDONE') {
        await this.verifyTerminalInvariants(operationId, journal.status);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      if (journal.status === 'COMMITTED') {
        await this.verifyTerminalInvariants(operationId, journal.status);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      if (journal.status === 'ROLLED_BACK') {
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      if (!['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(journal.status)) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不需要发布恢复');
      }
      await this.store.ensureOperationRecoveryBarrier(
        operationId,
        journal.updatedAt,
        `journal-${journal.journalVersion}`,
      );
      this.projectRecoveryBlocked = true;
      let publication = await this.store.readPublication(operationId);
      const receipt = await this.store.readReceipt(operationId);
      const undoReceipt = await this.store.readUndoReceipt(operationId);
      const hasUndoState = publication?.files.some((file) => [
        'UNDO_RENAME_INTENT',
        'UNDO_QUARANTINED',
        'UNDO_VERIFIED',
      ].includes(file.state)) ?? false;
      if (journal.status === 'UNDOING' || undoReceipt !== null || hasUndoState) {
        if (request.action === 'rollback') {
          throw new AssetImportAuthorityError(
            'IMPORT_OPERATION_CONFLICT',
            '撤销已经开始，只能恢复完成，不能切换为发布回滚',
          );
        }
        if (publication === null || receipt === null) {
          return this.enterRecovery(operationId, '撤销恢复缺少成功回执或发布 journal');
        }
        await this.verifyReceipt(receipt);
        await this.continueUndo(operationId, publication, receipt);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      if (receipt !== null) {
        await this.verifyReceipt(receipt);
        if (request.action === 'rollback') {
          throw new AssetImportAuthorityError(
            'IMPORT_OPERATION_CONFLICT',
            '成功回执已经落盘，只能恢复完成 COMMITTED，不能回滚',
          );
        }
      }
      if (request.action === 'rollback') {
        await this.rollbackPublication(operationId, publication);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }

      if (receipt !== null) {
        if (publication === null) return this.enterRecovery(operationId, '成功回执存在但发布 journal 缺失');
        await this.finishCommittedPublication(publication);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      if (publication === null) {
        await this.rollbackPublication(operationId, null);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      const states = publication.files.map((file) => file.state);
      const allVerified = states.every((state) => state === 'VERIFIED');
      const partialPublication = states.some((state) => [
        'LINK_INTENT',
        'LINKED',
        'ROLLBACK_RENAME_INTENT',
        'ROLLBACK_QUARANTINED',
      ].includes(state));
      if (journal.status === 'ROLLING_BACK' || (partialPublication && !allVerified)) {
        await this.rollbackPublication(operationId, publication);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }
      // No receipt exists yet: recovery must obey the live catalog collision gate.
      // Check keys only, since this operation may already own its exact target files.
      const recoveryPlan = await this.store.readPlan(operationId);
      if (recoveryPlan === null) return this.enterRecovery(operationId, '恢复发布缺少持久导入计划');
      const recoveryFacts = await this.targetFacts(recoveryPlan.targets);
      if (recoveryFacts.some(fact => (fact.conflictingAssetPaths?.length ?? 0) > 0)) {
        throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '恢复发布时素材标识已被其他文件占用，已保留原操作和文件');
      }
      if (allVerified) {
        await this.finishCommittedPublication(publication);
        await this.store.resolveOperationBarriers(operationId);
        this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
        return { detail: await this.query(operationId) };
      }

      if (journal.status === 'RECOVERY_REQUIRED') journal = await this.transition(journal, 'PUBLISHING');
      if (journal.status !== 'PUBLISHING') {
        return this.enterRecovery(operationId, '恢复提交前 journal 状态不一致');
      }
      const manifest = await this.readVerifiedManifest(operationId);
      const stagedItems = await this.verifiedStagedItems(manifest, true);
      try {
        publication = await this.ensureProjectOperationWorkspace(publication);
        publication = await this.preparePublication(publication, stagedItems);
        const prepared = absoluteAssetImportProjectPath(this.paths, publication.files[0]!.preparedRelativePath);
        await this.verifyHardLinkCapability(operationId, prepared);
        publication = await this.linkAndVerifyPublication(publication);
        await this.finishCommittedPublication(publication);
      } catch (error) {
        if (error instanceof AssetImportInjectedTermination) throw error;
        if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') throw error;
        await this.rollbackPublication(operationId, await this.store.readPublication(operationId));
        throw error;
      }
      await this.store.resolveOperationBarriers(operationId);
      this.projectRecoveryBlocked = await this.store.hasUnresolvedBarrier('asset-import');
      return { detail: await this.query(operationId) };
    }));
  }

  async query(operationIdInput: string): Promise<OperationDetailResponse> {
    await this.assertLeaseHeld();
    const operationId = requireUuid(operationIdInput, 'operationId');
    const operation = await this.store.readOperation(operationId);
    await this.verifyTerminalInvariants(operationId, operation.journal.status);
    if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(operation.journal.status)) {
      this.projectRecoveryBlocked = true;
      await this.store.ensureOperationRecoveryBarrier(
        operationId,
        operation.journal.updatedAt,
        `journal-${operation.journal.journalVersion}`,
      );
    }
    const manifest = await this.readVerifiedManifest(operationId);
    const plan = await this.store.readPlan(operationId);
    if (plan !== null && operation.journal.status !== 'COMMITTED' && operation.journal.status !== 'UNDONE') {
      await this.verifyStoredPlan(manifest, plan);
    }
    const requireComplete = ['STAGED', 'READY', 'PUBLISHING', 'UNDOING'].includes(operation.journal.status);
    const receipt = await this.store.readReceipt(operationId);
    if (receipt !== null) await this.verifyReceipt(receipt);
    const undoReceipt = await this.store.readUndoReceipt(operationId);
    if (operation.journal.status === 'UNDONE' && undoReceipt === null) {
      return this.enterRecovery(operationId, 'UNDONE 操作缺少撤销回执');
    }
    if (undoReceipt !== null) await this.verifyUndoReceipt(undoReceipt);
    let stagedItems: ProjectAssetImportStagedItem[] = [];
    if (!['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(operation.journal.status)) {
      try {
        stagedItems = await this.verifiedStagedItems(manifest, requireComplete);
      } catch (error) {
        if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED'
          && !operation.hasSealedPlan && plan === null && receipt === null && undoReceipt === null
          && await this.store.readPublication(operationId) === null) {
          throw new AssetImportAuthorityError(error.code, error.message, {
            ...error.details, operationId, manifestFingerprint: manifest.manifestFingerprint,
            recoveryAction: 'discard-unpublished',
          });
        }
        throw error;
      }
    }
    return {
      operation: operation.journal,
      manifest,
      stagedItems,
      plan: plan?.plan ?? null,
      receipt,
      undoReceipt,
    };
  }

  async list(): Promise<ListOperationsResponse> {
    await this.assertLeaseHeld();
    const operations = await this.store.listOperations();
    const reconciled: AssetImportJournal[] = [];
    for (const discovered of operations) {
      let operation = discovered;
      try {
        await this.verifyTerminalInvariants(operation.operationId, operation.status);
        if (operation.status === 'UPLOADING' && !this.activeUploadOperations.has(operation.operationId)) {
          const manifest = await this.readVerifiedManifest(operation.operationId);
          const discovery = await this.store.inspectStagedItemsForDiscovery(manifest);
          if (discovery.recoveryRequired) {
            await this.enterRecovery(operation.operationId, '素材上传重启对账需要人工恢复');
          }
          if (discovery.complete) {
            operation = await this.transition((await this.store.readOperation(operation.operationId)).journal, 'STAGED');
          }
        }
      } catch (error) {
        if (!(error instanceof AssetImportAuthorityError) || error.code !== 'IMPORT_RECOVERY_REQUIRED') throw error;
        operation = (await this.store.readOperation(operation.operationId)).journal;
      }
      if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(operation.status)) {
        this.projectRecoveryBlocked = true;
        await this.store.ensureOperationRecoveryBarrier(
          operation.operationId,
          operation.updatedAt,
          `journal-${operation.journalVersion}`,
        );
      }
      reconciled.push(operation);
    }
    return { operations: reconciled };
  }

  async cancel(operationIdInput: string): Promise<OperationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.serializeProjectMutation(async () => {
      await this.requireNoRecoveryBarrier();
      const current = await this.store.readOperation(operationId);
      if (current.journal.status === 'CANCELLED') return this.query(operationId);
      if (!['UPLOADING', 'STAGED', 'READY'].includes(current.journal.status)) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能取消');
      }
      const manifest = await this.readVerifiedManifest(operationId);
      try {
        await this.store.removePrePublicationArtifacts(manifest);
        await this.transition(current.journal, 'CANCELLED');
      } catch {
        return this.enterRecovery(operationId, '取消导入时无法证明暂存区已安全清理');
      }
      this.operationTokens.delete(operationId);
      return this.query(operationId);
    }));
  }

  verifyOperationToken(operationId: string, operationToken: string): void {
    const expected = this.operationTokens.get(operationId);
    if (expected === undefined || this.nowMs() >= expected.expiresAt || !/^[0-9a-f]{64}$/.test(operationToken)) {
      if (expected !== undefined && this.nowMs() >= expected.expiresAt) this.operationTokens.delete(operationId);
      throw new AssetImportAuthorityError('IMPORT_AUTH_REQUIRED', '导入操作授权无效');
    }
    const actual = Buffer.from(operationToken, 'utf8');
    const expectedBytes = Buffer.from(expected.token, 'utf8');
    if (actual.length !== expectedBytes.length || !crypto.timingSafeEqual(actual, expectedBytes)) {
      throw new AssetImportAuthorityError('IMPORT_AUTH_REQUIRED', '导入操作授权无效');
    }
  }

  async issueOperationToken(operationIdInput: string): Promise<string> {
    await this.assertLeaseHeld();
    const operationId = requireUuid(operationIdInput, 'operationId');
    const operation = await this.store.readOperation(operationId);
    if (['CANCELLED', 'ROLLED_BACK', 'UNDONE'].includes(operation.journal.status)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '该导入操作不再需要操作授权');
    }
    if (operation.journal.status === 'COMMITTED') {
      const receipt = await this.store.readReceipt(operationId);
      if (receipt === null) return this.enterRecovery(operationId, 'COMMITTED 操作缺少成功回执');
      await this.verifyReceipt(receipt);
    }
    const operationToken = this.createOperationToken(operationId);
    return operationToken;
  }
}
