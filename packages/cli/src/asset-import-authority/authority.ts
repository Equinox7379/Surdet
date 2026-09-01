import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  buildProjectAssetImportPlan,
  destinationDirectoryForAssetKind,
  stableStringify,
  type ProjectAssetImportPlan,
  type ProjectAssetImportStagedItem,
  type ProjectAssetImportTargetFact,
  type ProjectAssetImportTargetRequest,
  type TextHasher,
} from '@surdet/authoring';
import {
  assertAssetImportOperationWorkspace,
  assertAssetImportProjectRootIdentity,
  inspectAssetImportTarget,
} from './filesystem.js';
import { AssetImportRecordStore } from './record-store.js';
import {
  AssetImportAuthorityError,
  normalizeAssetImportSourceName,
  type AssetImportAuthorityPaths,
  type AssetImportJournal,
  type AssetImportOperationManifest,
  type AssetImportOperationManifestItem,
  type AssetImportOperationPlanRecord,
  type AssetImportUploadIntent,
  type AssetImportOperationStatus,
  type CreateImportOperationRequest,
  type CreateImportOperationResponse,
  type ListOperationsResponse,
  type OperationDetailResponse,
  type PlanOperationRequest,
  type PlanOperationResponse,
  type SealOperationRequest,
  type SealOperationResponse,
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
  limits?: Partial<ProjectAssetImportAuthorityLimits>;
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
  RECOVERY_REQUIRED: [],
  COMMITTED: ['UNDOING', 'RECOVERY_REQUIRED'],
  UNDOING: ['UNDONE', 'RECOVERY_REQUIRED'],
  UNDONE: [],
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
  private readonly operationTokens = new Map<string, string>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private projectRecoveryBlocked = false;
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
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
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

  private async requireNoRecoveryBarrier(): Promise<void> {
    await this.assertLeaseHeld();
    if (this.projectRecoveryBlocked) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材导入进程已进入恢复阻断状态');
    }
    if (await this.store.hasUnresolvedBarrier()) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材导入需要先完成恢复');
    }
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
    if (journal.status === status) return journal;
    if (!LEGAL_TRANSITIONS[journal.status].includes(status)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', `导入状态不能从 ${journal.status} 变为 ${status}`);
    }
    return this.store.writeJournal(journal, { ...journal, status, updatedAt: now() });
  }

  private async enterRecovery(operationId: string, message: string): Promise<never> {
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
    await this.assertOperationWorkspace(operationId);
  }

  private async verifyStagedBinary(item: ProjectAssetImportStagedItem): Promise<void> {
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
  }

  private async verifiedStagedItems(
    manifest: AssetImportOperationManifest,
    requireComplete: boolean,
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
      await this.verifyStagedBinary(fact);
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
    }));
    if (fingerprint !== manifest.manifestFingerprint) {
      return this.enterRecovery(operationId, '持久导入清单内容与清单指纹不一致');
    }
    return manifest;
  }

  async createOperation(request: CreateImportOperationRequest): Promise<CreateImportOperationResponse> {
    const operationId = requireUuid(request.operationId, 'operationId');
    return this.serialize(operationId, async () => {
      await this.requireNoRecoveryBarrier();
      await assertAssetImportProjectRootIdentity(this.paths);
      const items = this.normalizedItems(request.items);
      const registration = await this.store.readOperationRegistration(operationId);
      const existing = registration === null ? null : await this.readVerifiedManifest(operationId);
      if (existing !== null) {
        if (!sameJson(existing.items, items)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同导入清单');
        }
        const operation = await this.store.readOperation(operationId);
        if (operation.journal.status !== 'UPLOADING') {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '导入操作已经进入后续阶段');
        }
        const operationToken = this.operationTokens.get(operationId) ?? crypto.randomBytes(32).toString('hex');
        this.operationTokens.set(operationId, operationToken);
        return { operationId, status: 'UPLOADING', operationToken, itemCount: items.length };
      }

      const createdAt = now();
      const manifestFingerprint = await this.textHasher.sha256(stableStringify({
        schemaVersion: 1,
        operationId,
        items,
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
      };
      try {
        await this.store.registerOperation({ operationId, itemCount: items.length, createdAt });
        await this.store.createOperationManifest(manifest);
        await this.store.createInitialJournal(operationId, { status: 'UPLOADING', itemCount: items.length, updatedAt: createdAt });
      } catch {
        return this.enterRecovery(operationId, '导入操作创建未完整落盘');
      }
      const operationToken = crypto.randomBytes(32).toString('hex');
      this.operationTokens.set(operationId, operationToken);
      return { operationId, status: 'UPLOADING', operationToken, itemCount: items.length };
    });
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
    try {
      return await this.serialize(operationId, async () => {
        await this.requireNoRecoveryBarrier();
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
    }
  }

  private async targetFacts(targets: ProjectAssetImportTargetRequest[]): Promise<ProjectAssetImportTargetFact[]> {
    const facts: ProjectAssetImportTargetFact[] = [];
    for (const target of targets) {
      const relativePath = targetRelativePath(target);
      if (relativePath !== null) facts.push(await inspectAssetImportTarget(this.paths, relativePath));
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
    const stagedItems = await this.verifiedStagedItems(manifest, true);
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

  async plan(operationIdInput: string, request: PlanOperationRequest): Promise<PlanOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, async () => {
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
    });
  }

  async seal(operationIdInput: string, request: SealOperationRequest): Promise<SealOperationResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, async () => {
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
    });
  }

  async query(operationIdInput: string): Promise<OperationDetailResponse> {
    await this.assertLeaseHeld();
    const operationId = requireUuid(operationIdInput, 'operationId');
    const operation = await this.store.readOperation(operationId);
    const manifest = await this.readVerifiedManifest(operationId);
    const plan = await this.store.readPlan(operationId);
    if (plan !== null) await this.verifyStoredPlan(manifest, plan);
    const requireComplete = ['STAGED', 'READY', 'PUBLISHING', 'COMMITTED'].includes(operation.journal.status);
    return {
      operation: operation.journal,
      manifest,
      stagedItems: operation.journal.status === 'CANCELLED'
        ? []
        : await this.verifiedStagedItems(manifest, requireComplete),
      plan: plan?.plan ?? null,
    };
  }

  async list(): Promise<ListOperationsResponse> {
    await this.assertLeaseHeld();
    return { operations: await this.store.listOperations() };
  }

  async cancel(operationIdInput: string): Promise<OperationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, async () => {
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
    });
  }

  verifyOperationToken(operationId: string, operationToken: string): void {
    const expected = this.operationTokens.get(operationId);
    if (expected === undefined || !/^[0-9a-f]{64}$/.test(operationToken)) {
      throw new AssetImportAuthorityError('IMPORT_AUTH_REQUIRED', '导入操作授权无效');
    }
    const actual = Buffer.from(operationToken, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    if (actual.length !== expectedBytes.length || !crypto.timingSafeEqual(actual, expectedBytes)) {
      throw new AssetImportAuthorityError('IMPORT_AUTH_REQUIRED', '导入操作授权无效');
    }
  }
}
