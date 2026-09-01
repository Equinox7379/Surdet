import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from '../authoring/node-json-record.js';
import {
  absoluteAssetImportProjectPath,
  assetImportFileIdentity,
  assertAssetImportDataNamespace,
  assertAssetImportOperationWorkspace,
  createAssetImportOperationWorkspace,
} from './filesystem.js';
import {
  AssetImportAuthorityError,
  normalizeAssetImportSourceName,
  type AssetImportOperationManifest,
  type AssetImportOperationPlanRecord,
  type AssetImportPublicationRecord,
  type AssetImportUploadIntent,
  type AssetImportAuthorityPaths,
  type AssetImportChallengeJournal,
  type AssetImportJournal,
  type OperationRegistration,
  type RecoveryBarrierIncident,
  type RecoveryBarrierResolution,
  type ProjectAssetImportReceipt,
} from './types.js';
import { stableStringify, type ProjectAssetImportStagedItem } from '@surdet/authoring';

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{7,127}$/.test(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

const OPERATION_STATUSES = new Set([
  'UPLOADING',
  'STAGED',
  'READY',
  'PUBLISHING',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'RECOVERY_REQUIRED',
  'COMMITTED',
  'UNDOING',
  'UNDONE',
  'CANCELLED',
]);

const PUBLICATION_FILE_STATES = new Set([
  'UPLOADED',
  'PREPARE_INTENT',
  'PREPARED',
  'LINK_INTENT',
  'LINKED',
  'VERIFIED',
  'ROLLBACK_RENAME_INTENT',
  'ROLLBACK_QUARANTINED',
]);

function validFileIdentity(value: unknown): boolean {
  const identity = value as Record<string, unknown> | undefined;
  return identity !== undefined
    && typeof identity.device === 'string'
    && typeof identity.inode === 'string'
    && typeof identity.birthtimeNs === 'string'
    && Number.isSafeInteger(identity.size)
    && (identity.size as number) >= 0
    && typeof identity.mtimeNs === 'string';
}

function validReceiptFileIdentity(value: unknown): boolean {
  const identity = value as Record<string, unknown> | undefined;
  return identity !== undefined
    && typeof identity.device === 'string'
    && typeof identity.inode === 'string'
    && typeof identity.birthtimeNs === 'string';
}

function sameNodeIdentity(
  left: { device: string; inode: string; birthtimeNs: string },
  right: { device: string; inode: string; birthtimeNs: string },
): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs;
}

function validProjectRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\\') || path.isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function publicationSha256(record: Omit<AssetImportPublicationRecord, 'publicationSha256'>): string {
  return crypto.createHash('sha256').update(stableStringify(record), 'utf8').digest('hex');
}

function withPublicationSha256(
  record: Omit<AssetImportPublicationRecord, 'publicationSha256'>,
): AssetImportPublicationRecord {
  return { ...record, publicationSha256: publicationSha256(record) };
}

export class AssetImportRecordStore {
  constructor(readonly paths: AssetImportAuthorityPaths) {}

  private localRecoveryBlocked = false;

  private async readOperationJson<T>(file: string, operationId: string, label: string) {
    try {
      return await readJsonRecord<T>(file);
    } catch {
      this.localRecoveryBlocked = true;
      try {
        await this.ensureOperationRecoveryBarrier(operationId, undefined, `${label}-read`);
      } catch {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${label} 无法读取，且持久恢复屏障无法建立`);
      }
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${label} 无法安全读取`);
    }
  }

  private async assertOperationWorkspaceOrBarrier(operationId: string): Promise<void> {
    try {
      await assertAssetImportOperationWorkspace(this.paths, operationId);
    } catch {
      this.localRecoveryBlocked = true;
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'workspace-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入操作持久目录身份不安全');
    }
  }

  private async removeOperationFile(operationId: string, file: string): Promise<void> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    await fs.rm(file, { force: true });
    await this.assertOperationWorkspaceOrBarrier(operationId);
  }

  private operationIndexFile(operationId: string): string {
    if (!validId(operationId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'operationId 格式无效');
    return path.join(this.paths.projectNamespace, 'operation-index', `${operationId}.json`);
  }

  private operationDirectory(operationId: string): string {
    this.operationIndexFile(operationId);
    return path.join(this.paths.projectNamespace, 'operations', operationId);
  }

  private journalFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'journal.json');
  }

  private manifestFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'manifest.json');
  }

  private stagedItemRecordFile(operationId: string, itemId: string): string {
    if (!validId(itemId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'itemId 格式无效');
    return path.join(this.operationDirectory(operationId), 'items', `${itemId}.json`);
  }

  stagedItemBinaryFile(operationId: string, itemId: string): string {
    this.stagedItemRecordFile(operationId, itemId);
    return path.join(this.operationDirectory(operationId), 'staging', `${itemId}.bin`);
  }

  stagedItemTemporaryFile(operationId: string, itemId: string, nonce: string): string {
    if (!validId(nonce)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'upload nonce 格式无效');
    this.stagedItemRecordFile(operationId, itemId);
    return path.join(this.operationDirectory(operationId), 'staging', `.${itemId}.${nonce}.partial`);
  }

  private planFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'plan.json');
  }

  private publicationFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'publication.json');
  }

  private receiptFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'receipt.json');
  }

  private uploadIntentFile(operationId: string, nonce: string): string {
    if (!validUuid(nonce)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'upload nonce 格式无效');
    return path.join(this.operationDirectory(operationId), 'upload-intents', `${nonce}.json`);
  }

  private challengeIndexFile(challengeId: string): string {
    if (!validId(challengeId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'challengeId 格式无效');
    return path.join(this.paths.projectNamespace, 'challenge-index', `${challengeId}.json`);
  }

  private challengeJournalFile(challengeId: string): string {
    this.challengeIndexFile(challengeId);
    return path.join(this.paths.projectNamespace, 'challenges', challengeId, 'journal.json');
  }

  async registerOperation(record: OperationRegistration): Promise<void> {
    await assertAssetImportDataNamespace(this.paths);
    const file = this.operationIndexFile(record.operationId);
    const existing = await this.readOperationJson<OperationRegistration>(file, record.operationId, '导入登记');
    if (existing !== null) {
      if (equalJson(existing.value, record)) return;
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同导入');
    }
    try {
      await createJsonRecord(file, record);
      await createAssetImportOperationWorkspace(this.paths, record.operationId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.registerOperation(record);
      throw error;
    }
  }

  async readOperationRegistration(operationId: string): Promise<OperationRegistration | null> {
    const loaded = await this.readOperationJson<OperationRegistration>(
      this.operationIndexFile(operationId),
      operationId,
      '导入登记',
    );
    if (loaded === null) return null;
    const value = loaded.value;
    if (value?.operationId !== operationId || !validUuid(value.operationId)
      || !Number.isSafeInteger(value.itemCount) || value.itemCount < 1
      || typeof value.createdAt !== 'string') {
      await this.ensureOperationRecoveryBarrier(operationId);
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入登记语义损坏');
    }
    return value;
  }

  async ensureOperationRecoveryBarrier(
    operationId: string,
    createdAt = new Date().toISOString(),
    incidentKey = 'journal-state',
  ): Promise<void> {
    this.localRecoveryBlocked = true;
    const normalizedKey = incidentKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 48) || 'incident';
    const baseBarrierId = `operation-${operationId}-${normalizedKey}`;
    const priorResolution = path.join(this.paths.projectNamespace, 'recovery-resolutions', `${baseBarrierId}.json`);
    const barrierId = await fs.stat(priorResolution)
      .then(() => `${baseBarrierId}-${crypto.randomUUID().slice(0, 8)}`)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return baseBarrierId;
        throw error;
      });
    await this.writeBarrier({
      barrierId,
      operationId,
      reason: 'RECOVERY_REQUIRED',
      createdAt,
    });
  }

  async createInitialJournal(
    operationId: string,
    input: Pick<AssetImportJournal, 'status' | 'itemCount' | 'updatedAt'>,
  ): Promise<AssetImportJournal> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    if (await readJsonRecord<OperationRegistration>(this.operationIndexFile(operationId)) === null) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作未登记');
    }
    const journal: AssetImportJournal = {
      schemaVersion: 1,
      operationId,
      journalVersion: 1,
      previousGenerationSha256: null,
      ...input,
    };
    await createJsonRecord(this.journalFile(operationId), journal);
    return journal;
  }

  async createOperationManifest(manifest: AssetImportOperationManifest): Promise<void> {
    await this.assertOperationWorkspaceOrBarrier(manifest.operationId);
    const file = this.manifestFile(manifest.operationId);
    const existing = await this.readOperationJson<AssetImportOperationManifest>(file, manifest.operationId, '导入清单');
    if (existing !== null) {
      if (equalJson(existing.value, manifest)) return;
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '导入清单与已登记操作不一致');
    }
    await createJsonRecord(file, manifest);
  }

  async readOperationManifest(operationId: string): Promise<AssetImportOperationManifest> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<AssetImportOperationManifest>(
      this.manifestFile(operationId),
      operationId,
      '导入清单',
    );
    const registration = await this.readOperationRegistration(operationId);
    if (loaded === null) {
      if (registration === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作不存在');
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'manifest-missing');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '已登记导入缺少清单');
    }
    const value = loaded.value;
    const valid = value?.schemaVersion === 1
      && value.operationId === operationId
      && validUuid(value.operationId)
      && typeof value.createdAt === 'string'
      && validSha256(value.manifestFingerprint)
      && Array.isArray(value.items)
      && value.items.length > 0
      && registration !== null
      && registration.itemCount === value.items.length
      && value.items.every((item) => {
        if (!validUuid(item?.itemId) || !Number.isSafeInteger(item?.declaredBytes) || item.declaredBytes < 0) return false;
        try {
          return normalizeAssetImportSourceName(item.sourceName) === item.sourceName;
        } catch {
          return false;
        }
      })
      && new Set(value.items.map((item) => item.itemId)).size === value.items.length;
    if (!valid) {
      await this.ensureOperationRecoveryBarrier(operationId, value?.createdAt, 'manifest-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入清单语义损坏');
    }
    return value;
  }

  async createStagedItem(item: ProjectAssetImportStagedItem): Promise<void> {
    await this.assertOperationWorkspaceOrBarrier(item.operationId);
    const file = this.stagedItemRecordFile(item.operationId, item.itemId);
    const existing = await this.readOperationJson<ProjectAssetImportStagedItem>(file, item.operationId, '素材暂存事实');
    if (existing !== null) {
      if (equalJson(existing.value, item)) return;
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '同一素材项已记录不同内容');
    }
    await createJsonRecord(file, item);
  }

  async createUploadIntent(intent: AssetImportUploadIntent): Promise<void> {
    await this.assertOperationWorkspaceOrBarrier(intent.operationId);
    if (!validUuid(intent.operationId) || !validUuid(intent.itemId) || !validUuid(intent.nonce)
      || intent.partialFileName !== `.${intent.itemId}.${intent.nonce}.partial`) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'upload intent 格式无效');
    }
    await createJsonRecord(this.uploadIntentFile(intent.operationId, intent.nonce), intent);
  }

  async removeUploadIntent(operationId: string, nonce: string): Promise<void> {
    await this.removeOperationFile(operationId, this.uploadIntentFile(operationId, nonce));
  }

  async listUploadIntents(operationId: string): Promise<AssetImportUploadIntent[]> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const directory = path.join(this.operationDirectory(operationId), 'upload-intents');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const result: AssetImportUploadIntent[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        await this.ensureOperationRecoveryBarrier(operationId, undefined, 'upload-intent-entry-invalid');
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', 'upload intent 目录包含未知条目');
      }
      const nonce = entry.name.slice(0, -5);
      const loaded = await this.readOperationJson<AssetImportUploadIntent>(
        this.uploadIntentFile(operationId, nonce),
        operationId,
        'upload intent',
      );
      const value = loaded?.value;
      if (value?.schemaVersion !== 1 || value.operationId !== operationId
        || !validUuid(value.itemId) || value.nonce !== nonce || !validUuid(value.nonce)
        || value.partialFileName !== `.${value.itemId}.${value.nonce}.partial`
        || typeof value.createdAt !== 'string') {
        await this.ensureOperationRecoveryBarrier(operationId, undefined, `upload-intent-${nonce}-invalid`);
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', 'upload intent 语义损坏');
      }
      result.push(value);
    }
    return result;
  }

  async assertStagingEntriesKnown(manifest: AssetImportOperationManifest): Promise<AssetImportUploadIntent[]> {
    await this.assertOperationWorkspaceOrBarrier(manifest.operationId);
    const intents = await this.listUploadIntents(manifest.operationId);
    const allowed = new Set(manifest.items.map((item) => `${item.itemId}.bin`));
    for (const intent of intents) allowed.add(intent.partialFileName);
    const staging = path.join(this.operationDirectory(manifest.operationId), 'staging');
    const entries = await fs.readdir(staging, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !allowed.has(entry.name))) {
      await this.ensureOperationRecoveryBarrier(manifest.operationId, manifest.createdAt, 'staging-entry-unknown');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材暂存目录包含无法归属的条目');
    }
    return intents;
  }

  async removeStagedBinary(operationId: string, itemId: string): Promise<void> {
    await this.removeOperationFile(operationId, this.stagedItemBinaryFile(operationId, itemId));
  }

  async readStagedItem(operationId: string, itemId: string): Promise<ProjectAssetImportStagedItem | null> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<ProjectAssetImportStagedItem>(
      this.stagedItemRecordFile(operationId, itemId),
      operationId,
      '素材暂存事实',
    );
    if (loaded === null) return null;
    const value = loaded.value;
    let safeSourceName = false;
    try {
      safeSourceName = normalizeAssetImportSourceName(value?.sourceName) === value?.sourceName;
    } catch {
      safeSourceName = false;
    }
    if (value?.operationId !== operationId || value.itemId !== itemId
      || !validUuid(value.operationId) || !validUuid(value.itemId)
      || !safeSourceName
      || !Number.isSafeInteger(value.bytes) || value.bytes < 0
      || !validSha256(value.sha256) || !validSha256(value.stagedItemFingerprint)) {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, `staged-${itemId}-invalid`);
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材暂存事实语义损坏');
    }
    return value;
  }

  async listStagedItems(manifest: AssetImportOperationManifest): Promise<ProjectAssetImportStagedItem[]> {
    const result: ProjectAssetImportStagedItem[] = [];
    for (const item of manifest.items) {
      const staged = await this.readStagedItem(manifest.operationId, item.itemId);
      if (staged !== null) result.push(staged);
    }
    return result;
  }

  async writePlan(record: AssetImportOperationPlanRecord): Promise<void> {
    await this.assertOperationWorkspaceOrBarrier(record.operationId);
    const file = this.planFile(record.operationId);
    const existing = await this.readOperationJson<AssetImportOperationPlanRecord>(file, record.operationId, '导入计划');
    if (existing !== null && equalJson(existing.value, record)) return;
    if (existing === null) await createJsonRecord(file, record);
    else await replaceJsonRecord(file, record);
  }

  async readPlan(operationId: string): Promise<AssetImportOperationPlanRecord | null> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<AssetImportOperationPlanRecord>(
      this.planFile(operationId),
      operationId,
      '导入计划',
    );
    if (loaded === null) return null;
    const value = loaded.value;
    const manifest = await this.readOperationManifest(operationId);
    if (value?.schemaVersion !== 1 || value.operationId !== operationId || !Array.isArray(value.targets)
      || !Array.isArray(value.targetFacts)
      || value.targetFacts.some((fact) => typeof fact?.path !== 'string'
        || !['absent', 'exists-file', 'exists-directory', 'unsafe'].includes(fact?.state))
      || value.plan?.schemaVersion !== 1
      || value.plan.projectIdentity !== this.paths.projectIdentity
      || value.plan.manifestFingerprint !== manifest.manifestFingerprint
      || !validSha256(value.plan.planFingerprint)
      || typeof value.plan.planId !== 'string'
      || value.plan.planId !== `pln_${value.plan.planFingerprint.slice(0, 32)}`
      || !Array.isArray(value.plan.items) || !Array.isArray(value.plan.issues)) {
      await this.ensureOperationRecoveryBarrier(operationId, manifest.createdAt, 'plan-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入计划语义损坏');
    }
    return value;
  }

  async createPublication(
    record: Omit<AssetImportPublicationRecord, 'publicationSha256'>,
  ): Promise<AssetImportPublicationRecord> {
    await this.assertOperationWorkspaceOrBarrier(record.operationId);
    const normalized = withPublicationSha256(record);
    const file = this.publicationFile(record.operationId);
    const existing = await this.readOperationJson<AssetImportPublicationRecord>(file, record.operationId, '发布 journal');
    if (existing !== null) {
      if (equalJson(existing.value, normalized)) return existing.value;
      await this.ensureOperationRecoveryBarrier(record.operationId, undefined, 'publication-conflict');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '发布 journal 与既有记录冲突');
    }
    await createJsonRecord(file, normalized);
    return normalized;
  }

  async readPublication(operationId: string): Promise<AssetImportPublicationRecord | null> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<AssetImportPublicationRecord>(
      this.publicationFile(operationId),
      operationId,
      '发布 journal',
    );
    if (loaded === null) return null;
    const value = loaded.value;
    if (value?.schemaVersion !== 1 || value.operationId !== operationId
      || !Number.isSafeInteger(value.publicationVersion) || value.publicationVersion < 1
      || (value.previousGenerationSha256 !== null && !validSha256(value.previousGenerationSha256))
      || !validSha256(value.publicationSha256)
      || !validSha256(value.planFingerprint) || typeof value.planId !== 'string'
      || !Array.isArray(value.files) || !Array.isArray(value.parents)
      || typeof value.updatedAt !== 'string') {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'publication-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '发布 journal 语义损坏');
    }
    const { publicationSha256: storedPublicationSha256, ...publicationSemantic } = value;
    if (publicationSha256(publicationSemantic) !== storedPublicationSha256) {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'publication-hash-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '发布 journal 指纹不匹配');
    }
    const manifest = await this.readOperationManifest(operationId);
    const plan = await this.readPlan(operationId);
    const planItems = new Map(plan?.plan.items.map((item) => [item.itemId, item]) ?? []);
    const allowedParents = new Set<string>([
      '.surdet',
      '.surdet/asset-import',
      `.surdet/asset-import/${operationId}`,
      `.surdet/asset-import/${operationId}/prepared`,
      `.surdet/asset-import/${operationId}/rollback`,
      `.surdet/asset-import/${operationId}/undo`,
    ]);
    for (const item of plan?.plan.items ?? []) {
      const segments = path.posix.dirname(item.targetPath).split('/');
      let relative = '';
      for (const segment of segments) {
        relative = relative.length === 0 ? segment : `${relative}/${segment}`;
        allowedParents.add(relative);
      }
    }
    const manifestIds = new Set(manifest.items.map((item) => item.itemId));
    const seenFiles = new Set<string>();
    const filesValid = plan !== null
      && value.planId === plan.plan.planId
      && value.planFingerprint === plan.plan.planFingerprint
      && value.files.length === manifest.items.length
      && value.files.every((file) => {
        const planned = planItems.get(file?.itemId);
        if (planned === undefined || !manifestIds.has(file.itemId) || seenFiles.has(file.itemId)) return false;
        seenFiles.add(file.itemId);
        const prepared = `.surdet/asset-import/${operationId}/prepared/${file.itemId}.bin`;
        const rollback = `.surdet/asset-import/${operationId}/rollback/${file.itemId}.bin`;
        if (file.targetPath !== planned.targetPath || file.preparedRelativePath !== prepared
          || file.rollbackRelativePath !== rollback || file.bytes !== planned.bytes || file.sha256 !== planned.sha256
          || !validSha256(file.sha256) || !PUBLICATION_FILE_STATES.has(file.state)) return false;
        const preparedRequired = !['UPLOADED', 'PREPARE_INTENT'].includes(file.state);
        const finalRequired = ['LINKED', 'VERIFIED', 'ROLLBACK_RENAME_INTENT', 'ROLLBACK_QUARANTINED'].includes(file.state);
        const quarantineRequired = file.state === 'ROLLBACK_QUARANTINED';
        return (!preparedRequired || validFileIdentity(file.preparedIdentity))
          && (!finalRequired || validFileIdentity(file.finalIdentity))
          && (!quarantineRequired || validFileIdentity(file.quarantineIdentity));
      });
    const seenParents = new Set<string>();
    const parentsValid = value.parents.every((parent) => {
      if (!validProjectRelativePath(parent?.relativePath) || !allowedParents.has(parent.relativePath)
        || seenParents.has(parent.relativePath)
        || ![
          'CREATE_INTENT',
          'PREEXISTING',
          'CREATED',
          'ROLLBACK_REMOVE_INTENT',
          'ROLLBACK_REMOVED',
          'ROLLBACK_PRESERVED',
        ].includes(parent.state)) return false;
      seenParents.add(parent.relativePath);
      return ['CREATE_INTENT', 'ROLLBACK_REMOVED'].includes(parent.state)
        ? parent.identity === undefined || validFileIdentity(parent.identity)
        : validFileIdentity(parent.identity);
    });
    if (!filesValid || !parentsValid) {
      await this.ensureOperationRecoveryBarrier(operationId, manifest.createdAt, 'publication-semantic-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '发布 journal 文件或目录证据损坏');
    }
    return value;
  }

  async writePublication(
    previous: AssetImportPublicationRecord,
    next: AssetImportPublicationRecord,
  ): Promise<AssetImportPublicationRecord> {
    const loaded = await this.readOperationJson<AssetImportPublicationRecord>(
      this.publicationFile(previous.operationId),
      previous.operationId,
      '发布 journal',
    );
    if (loaded === null || !equalJson(loaded.value, previous)) {
      await this.ensureOperationRecoveryBarrier(previous.operationId, undefined, 'publication-race');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '发布 journal 已被另一状态更新');
    }
    const semantic: Omit<AssetImportPublicationRecord, 'publicationSha256'> = {
      ...next,
      schemaVersion: 1,
      operationId: previous.operationId,
      publicationVersion: previous.publicationVersion + 1,
      previousGenerationSha256: loaded.identity.sha256,
    };
    delete (semantic as Partial<AssetImportPublicationRecord>).publicationSha256;
    const record = withPublicationSha256(semantic);
    await replaceJsonRecord(this.publicationFile(previous.operationId), record);
    return record;
  }

  async writeReceipt(receipt: ProjectAssetImportReceipt): Promise<ProjectAssetImportReceipt> {
    await this.assertOperationWorkspaceOrBarrier(receipt.operationId);
    const file = this.receiptFile(receipt.operationId);
    const existing = await this.readOperationJson<ProjectAssetImportReceipt>(file, receipt.operationId, '导入回执');
    if (existing !== null) {
      if (equalJson(existing.value, receipt)) return existing.value;
      await this.ensureOperationRecoveryBarrier(receipt.operationId, undefined, 'receipt-conflict');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入回执与既有记录冲突');
    }
    await createJsonRecord(file, receipt);
    return receipt;
  }

  async readReceipt(operationId: string): Promise<ProjectAssetImportReceipt | null> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<ProjectAssetImportReceipt>(
      this.receiptFile(operationId),
      operationId,
      '导入回执',
    );
    if (loaded === null) return null;
    const value = loaded.value;
    if (value?.schemaVersion !== 1 || value.operationId !== operationId || value.status !== 'COMMITTED'
      || !validSha256(value.receiptSha256) || !validSha256(value.planFingerprint)
      || !validUuid(value.receiptId) || value.projectIdentity !== this.paths.projectIdentity
      || value.authorityContractVersion !== 1 || !Number.isSafeInteger(value.journalVersion) || value.journalVersion < 1
      || typeof value.committedAt !== 'string' || !Array.isArray(value.files)) {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'receipt-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入回执语义损坏');
    }
    const plan = await this.readPlan(operationId);
    const planItems = new Map(plan?.plan.items.map((item) => [item.itemId, item]) ?? []);
    const seen = new Set<string>();
    if (plan === null || value.planId !== plan.plan.planId || value.planFingerprint !== plan.plan.planFingerprint
      || value.files.length !== plan.plan.items.length
      || value.files.some((file) => {
        const planned = planItems.get(file?.itemId);
        if (planned === undefined || seen.has(file.itemId)) return true;
        seen.add(file.itemId);
        return file.targetPath !== planned.targetPath || file.bytes !== planned.bytes || file.sha256 !== planned.sha256
          || !validSha256(file.sha256) || !validReceiptFileIdentity(file.fileIdentity);
      })) {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'receipt-semantic-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入回执文件证据损坏');
    }
    return value;
  }

  async removePrePublicationArtifacts(manifest: AssetImportOperationManifest): Promise<void> {
    await this.assertOperationWorkspaceOrBarrier(manifest.operationId);
    const allowedItemIds = new Set(manifest.items.map((item) => item.itemId));
    for (const intent of await this.assertStagingEntriesKnown(manifest)) {
      if (!allowedItemIds.has(intent.itemId)) {
        await this.ensureOperationRecoveryBarrier(manifest.operationId, manifest.createdAt, 'upload-intent-item-mismatch');
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', 'upload intent 不属于创建清单');
      }
      await this.removeOperationFile(
        manifest.operationId,
        path.join(this.operationDirectory(manifest.operationId), 'staging', intent.partialFileName),
      );
      await this.removeUploadIntent(manifest.operationId, intent.nonce);
    }
    for (const item of manifest.items) {
      await this.removeStagedBinary(manifest.operationId, item.itemId);
      await this.removeOperationFile(manifest.operationId, this.stagedItemRecordFile(manifest.operationId, item.itemId));
    }
    await this.removeOperationFile(manifest.operationId, this.planFile(manifest.operationId));
    if ((await fs.readdir(path.join(this.operationDirectory(manifest.operationId), 'staging'))).length !== 0
      || (await fs.readdir(path.join(this.operationDirectory(manifest.operationId), 'upload-intents'))).length !== 0) {
      await this.ensureOperationRecoveryBarrier(manifest.operationId, manifest.createdAt, 'cancel-cleanup-incomplete');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '取消导入后暂存目录仍有内容');
    }
  }

  async readOperation(operationId: string): Promise<{ journal: AssetImportJournal; sha256: string }> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<AssetImportJournal>(this.journalFile(operationId), operationId, '导入 journal');
    const registration = await this.readOperationRegistration(operationId);
    if (registration === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作不存在');
    if (loaded === null) {
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-missing');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '已登记导入缺少 journal');
    }
    const value = loaded.value;
    if (value?.schemaVersion !== 1 || value.operationId !== operationId || !validUuid(value.operationId)
      || !Number.isSafeInteger(value.journalVersion) || value.journalVersion < 1
      || (value.previousGenerationSha256 !== null && !validSha256(value.previousGenerationSha256))
      || !OPERATION_STATUSES.has(value.status)
      || value.itemCount !== registration.itemCount
      || typeof value.updatedAt !== 'string') {
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入 journal 语义损坏');
    }
    return { journal: value, sha256: loaded.identity.sha256 };
  }

  async writeJournal(previous: AssetImportJournal, next: AssetImportJournal): Promise<AssetImportJournal> {
    const current = await this.readOperation(previous.operationId);
    if (!equalJson(current.journal, previous)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'journal 已被另一状态更新');
    }
    const journal: AssetImportJournal = {
      ...next,
      schemaVersion: 1,
      operationId: previous.operationId,
      journalVersion: previous.journalVersion + 1,
      previousGenerationSha256: current.sha256,
    };
    await replaceJsonRecord(this.journalFile(previous.operationId), journal);
    return journal;
  }

  async listOperations(): Promise<AssetImportJournal[]> {
    await assertAssetImportDataNamespace(this.paths);
    const directory = path.join(this.paths.projectNamespace, 'operation-index');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const operations: AssetImportJournal[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const operationId = entry.name.slice(0, -5);
      const loaded = await this.readOperation(operationId);
      await this.readOperationManifest(operationId);
      operations.push(loaded.journal);
    }
    return operations;
  }

  async registerChallenge(journal: AssetImportChallengeJournal): Promise<void> {
    const registration = { challengeId: journal.challengeId, relativeProbePath: journal.relativeProbePath };
    const indexFile = this.challengeIndexFile(journal.challengeId);
    const existing = await readJsonRecord<typeof registration>(indexFile);
    if (existing !== null && !equalJson(existing.value, registration)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'challengeId 已被占用');
    }
    if (existing === null) await createJsonRecord(indexFile, registration);
    const journalFile = this.challengeJournalFile(journal.challengeId);
    const current = await readJsonRecord<AssetImportChallengeJournal>(journalFile);
    if (current === null) await createJsonRecord(journalFile, journal);
  }

  async readChallenge(challengeId: string): Promise<{ journal: AssetImportChallengeJournal; sha256: string }> {
    const loaded = await readJsonRecord<AssetImportChallengeJournal>(this.challengeJournalFile(challengeId));
    if (loaded === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '绑定 challenge 不存在');
    return { journal: loaded.value, sha256: loaded.identity.sha256 };
  }

  async writeChallengeJournal(
    previous: AssetImportChallengeJournal,
    status: AssetImportChallengeJournal['status'],
  ): Promise<AssetImportChallengeJournal> {
    const current = await this.readChallenge(previous.challengeId);
    if (!equalJson(current.journal, previous)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '绑定 challenge 已被更新');
    }
    const next: AssetImportChallengeJournal = {
      ...previous,
      journalVersion: previous.journalVersion + 1,
      previousGenerationSha256: current.sha256,
      status,
    };
    await replaceJsonRecord(this.challengeJournalFile(previous.challengeId), next);
    return next;
  }

  async listChallenges(): Promise<AssetImportChallengeJournal[]> {
    const directory = path.join(this.paths.projectNamespace, 'challenge-index');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const result: AssetImportChallengeJournal[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const challengeId = entry.name.slice(0, -5);
      const challenge = await this.readChallenge(challengeId);
      result.push(challenge.journal);
    }
    return result;
  }

  async writeBarrier(incident: RecoveryBarrierIncident): Promise<void> {
    this.localRecoveryBlocked = true;
    await assertAssetImportDataNamespace(this.paths);
    if (!validId(incident.barrierId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'barrierId 格式无效');
    const file = path.join(this.paths.projectNamespace, 'recovery-barriers', `${incident.barrierId}.json`);
    const existing = await readJsonRecord<RecoveryBarrierIncident>(file);
    if (existing !== null) {
      if (existing.value.operationId === incident.operationId && existing.value.reason === incident.reason) return;
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '恢复屏障身份冲突');
    }
    try {
      await createJsonRecord(file, incident);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.writeBarrier(incident);
      throw error;
    }
  }

  async resolveBarrier(input: Pick<RecoveryBarrierResolution, 'barrierId' | 'resolvedAt'>): Promise<void> {
    if (!validId(input.barrierId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'barrierId 格式无效');
    await assertAssetImportDataNamespace(this.paths);
    const incident = await readJsonRecord<RecoveryBarrierIncident>(
      path.join(this.paths.projectNamespace, 'recovery-barriers', `${input.barrierId}.json`),
    );
    if (incident === null) throw new AssetImportAuthorityError('INVALID_REQUEST', '恢复屏障不存在');
    const journal = await this.readOperation(incident.value.operationId);
    if (!['ROLLED_BACK', 'CANCELLED', 'COMMITTED', 'UNDONE'].includes(journal.journal.status)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入操作尚未达到可解除恢复屏障的终态');
    }
    const publication = await this.readPublication(incident.value.operationId);
    const quarantined = publication?.files
      .filter((file) => file.state === 'ROLLBACK_QUARANTINED')
      .sort((left, right) => left.itemId.localeCompare(right.itemId)) ?? [];
    for (const file of quarantined) {
      const current = await assetImportFileIdentity(absoluteAssetImportProjectPath(this.paths, file.rollbackRelativePath));
      if (file.quarantineIdentity === undefined || !sameNodeIdentity(current, file.quarantineIdentity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '回滚隔离证据身份不匹配');
      }
    }
    const resolution: RecoveryBarrierResolution = {
      barrierId: input.barrierId,
      incidentSha256: incident.identity.sha256,
      operationId: incident.value.operationId,
      journalVersion: journal.journal.journalVersion,
      publicationVersion: publication?.publicationVersion ?? null,
      publicationSha256: publication?.publicationSha256 ?? null,
      quarantinedPaths: quarantined.map((file) => file.rollbackRelativePath),
      resolvedAt: input.resolvedAt,
    };
    await createJsonRecord(
      path.join(this.paths.projectNamespace, 'recovery-resolutions', `${input.barrierId}.json`),
      resolution,
    );
  }

  async resolveOperationBarriers(operationId: string): Promise<void> {
    const directory = path.join(this.paths.projectNamespace, 'recovery-barriers');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const incident = await readJsonRecord<RecoveryBarrierIncident>(path.join(directory, entry.name));
      if (incident === null || incident.value.operationId !== operationId) continue;
      const resolutionFile = path.join(this.paths.projectNamespace, 'recovery-resolutions', entry.name);
      if (await fs.stat(resolutionFile).then(() => true).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      })) continue;
      await this.resolveBarrier({ barrierId: incident.value.barrierId, resolvedAt: new Date().toISOString() });
    }
    this.localRecoveryBlocked = false;
    this.localRecoveryBlocked = await this.hasUnresolvedBarrier();
  }

  async hasUnresolvedBarrier(): Promise<boolean> {
    if (this.localRecoveryBlocked) return true;
    await assertAssetImportDataNamespace(this.paths);
    const barrierDirectory = path.join(this.paths.projectNamespace, 'recovery-barriers');
    const entries = await fs.readdir(barrierDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const incident = await readJsonRecord<RecoveryBarrierIncident>(path.join(barrierDirectory, entry.name));
      if (incident === null || incident.value.barrierId !== entry.name.slice(0, -5)) return true;
      const resolution = await readJsonRecord<RecoveryBarrierResolution>(
        path.join(this.paths.projectNamespace, 'recovery-resolutions', entry.name),
      );
      if (resolution === null || resolution.value.barrierId !== incident.value.barrierId
        || resolution.value.incidentSha256 !== incident.identity.sha256
        || resolution.value.operationId !== incident.value.operationId) return true;
      const journal = await this.readOperation(incident.value.operationId).catch(() => null);
      if (journal === null || journal.journal.journalVersion !== resolution.value.journalVersion
        || !['ROLLED_BACK', 'CANCELLED', 'COMMITTED', 'UNDONE'].includes(journal.journal.status)) return true;
      const publication = await this.readPublication(incident.value.operationId).catch(() => null);
      if ((publication?.publicationVersion ?? null) !== resolution.value.publicationVersion) return true;
      if ((publication?.publicationSha256 ?? null) !== resolution.value.publicationSha256) return true;
      const quarantinedPaths = publication?.files
        .filter((file) => file.state === 'ROLLBACK_QUARANTINED')
        .sort((left, right) => left.itemId.localeCompare(right.itemId))
        .map((file) => file.rollbackRelativePath) ?? [];
      if (!equalJson(quarantinedPaths, resolution.value.quarantinedPaths)) return true;
    }
    return this.localRecoveryBlocked;
  }
}
