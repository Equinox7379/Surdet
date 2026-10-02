import * as crypto from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from '../authoring/node-json-record.js';
import { syncParentDirectories } from '../authoring/node-durable-file.js';
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
  type ProjectAssetImportUndoReceipt,
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

const JOURNAL_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
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

function validJournalGeneration(
  value: AssetImportJournal,
  operationId: string,
  itemCount: number,
): boolean {
  return value?.schemaVersion === 1
    && value.operationId === operationId
    && validUuid(value.operationId)
    && Number.isSafeInteger(value.journalVersion)
    && value.journalVersion >= 1
    && (value.previousGenerationSha256 === null || validSha256(value.previousGenerationSha256))
    && OPERATION_STATUSES.has(value.status)
    && value.itemCount === itemCount
    && typeof value.updatedAt === 'string';
}

interface AssetImportJournalHead {
  schemaVersion: 1;
  operationId: string;
  journalVersion: number;
  journalSha256: string;
}

const PUBLICATION_FILE_STATES = new Set([
  'UPLOADED',
  'PREPARE_INTENT',
  'PREPARED',
  'LINK_INTENT',
  'LINKED',
  'VERIFIED',
  'ROLLBACK_RENAME_INTENT',
  'ROLLBACK_QUARANTINED',
  'UNDO_RENAME_INTENT',
  'UNDO_QUARANTINED',
  'UNDO_VERIFIED',
]);

function validFileIdentity(value: unknown): boolean {
  const identity = value as Record<string, unknown> | undefined;
  return identity !== null && typeof identity === 'object'
    && typeof identity.device === 'string'
    && typeof identity.inode === 'string'
    && typeof identity.birthtimeNs === 'string'
    && Number.isSafeInteger(identity.size)
    && (identity.size as number) >= 0
    && typeof identity.mtimeNs === 'string';
}

function validReceiptFileIdentity(value: unknown): boolean {
  const identity = value as Record<string, unknown> | undefined;
  return identity !== null && typeof identity === 'object'
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

function sameFileIdentity(
  left: { device: string; inode: string; birthtimeNs: string; size: number; mtimeNs: string },
  right: { device: string; inode: string; birthtimeNs: string; size: number; mtimeNs: string },
): boolean {
  return sameNodeIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function validProjectRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\\') || path.isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function publicationSha256(record: Omit<AssetImportPublicationRecord, 'publicationSha256'>): string {
  return crypto.createHash('sha256').update(stableStringify(record), 'utf8').digest('hex');
}

function undoReceiptSha256(receipt: Omit<ProjectAssetImportUndoReceipt, 'undoReceiptSha256'>): string {
  return crypto.createHash('sha256').update(stableStringify(receipt), 'utf8').digest('hex');
}

function receiptSha256(receipt: Omit<ProjectAssetImportReceipt, 'receiptSha256'>): string {
  return crypto.createHash('sha256').update(stableStringify(receipt), 'utf8').digest('hex');
}

async function stableFileEvidence(file: string): Promise<{
  identity: Awaited<ReturnType<typeof assetImportFileIdentity>>;
  bytes: number;
  sha256: string;
}> {
  const before = await assetImportFileIdentity(file);
  const hasher = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    hasher.update(buffer);
  }
  const after = await assetImportFileIdentity(file);
  if (!sameFileIdentity(before, after) || bytes !== after.size) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '隔离证据读取期间发生变化');
  }
  return {
    identity: after,
    bytes,
    sha256: hasher.digest('hex'),
  };
}

function withPublicationSha256(
  record: Omit<AssetImportPublicationRecord, 'publicationSha256'>,
): AssetImportPublicationRecord {
  return { ...record, publicationSha256: publicationSha256(record) };
}

function publicationQuarantines(publication: AssetImportPublicationRecord | null): Array<{
  path: string;
  identity: AssetImportPublicationRecord['files'][number]['quarantineIdentity'];
  bytes: number;
  sha256: string;
}> {
  if (publication === null) return [];
  return publication.files.flatMap((file) => {
    if (file.state === 'ROLLBACK_QUARANTINED') {
      return [{
        path: file.rollbackRelativePath,
        identity: file.quarantineIdentity,
        bytes: file.bytes,
        sha256: file.sha256,
      }];
    }
    if (file.state === 'UNDO_QUARANTINED' || file.state === 'UNDO_VERIFIED') {
      return [{
        path: file.undoRelativePath,
        identity: file.undoIdentity,
        bytes: file.bytes,
        sha256: file.sha256,
      }];
    }
    return [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export class AssetImportRecordStore {
  constructor(readonly paths: AssetImportAuthorityPaths) {}

  private localRecoveryBlocked = false;
  private relocationTerminalVerifier?: (
    operationId: string,
  ) => Promise<{ journalVersion: number; terminalFingerprint: string }>;

  registerRelocationTerminalVerifier(
    verifier: (operationId: string) => Promise<{ journalVersion: number; terminalFingerprint: string }>,
  ): void {
    this.relocationTerminalVerifier = verifier;
  }

  private async closedJsonEntries(
    directory: string,
    label: string,
    validBasename: (value: string) => boolean = validId,
  ): Promise<Dirent[]> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      });
      const names = new Set<string>();
      let transientWriterRecord = false;
      for (const entry of entries) {
        if (/^\..+\.[0-9a-f]{8}-[0-9a-f-]{27}\.tmp$/.test(entry.name)) {
          transientWriterRecord = true;
          continue;
        }
        const basename = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
        const folded = entry.name.normalize('NFC').toUpperCase().toLowerCase();
        if (!entry.isFile() || entry.isSymbolicLink() || !validBasename(basename) || names.has(folded)) {
          this.localRecoveryBlocked = true;
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${label} 包含未知、重复或非普通记录`);
        }
        names.add(folded);
      }
      if (!transientWriterRecord) return entries.sort((left, right) => left.name.localeCompare(right.name));
      if (attempt < 4) await wait(10);
    }
    this.localRecoveryBlocked = true;
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${label} 存在未完成的临时记录`);
  }

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
    await syncParentDirectories(path.dirname(file));
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

  private journalHeadFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'journal-head.json');
  }

  private journalGenerationDirectory(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'journal-generations');
  }

  private journalGenerationFile(operationId: string, journalVersion: number): string {
    if (!Number.isSafeInteger(journalVersion) || journalVersion < 1) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'journalVersion 格式无效');
    }
    return path.join(this.journalGenerationDirectory(operationId), `${String(journalVersion).padStart(12, '0')}.json`);
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

  private undoReceiptFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'undo-receipt.json');
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
    // Unknown IDs carry no publication evidence and must not poison the project.
    // Read only existence here: parsing registration would recurse on corrupt records.
    const registration = await fs.lstat(this.operationIndexFile(operationId)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (registration === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作不存在');
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
      operationKind: 'asset-import',
      reason: 'RECOVERY_REQUIRED',
      createdAt,
    });
  }

  async ensureRelocationRecoveryBarrier(
    operationId: string,
    createdAt = new Date().toISOString(),
    incidentKey = 'journal-state',
  ): Promise<void> {
    this.localRecoveryBlocked = true;
    if (!validUuid(operationId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'operationId 格式无效');
    const normalizedKey = incidentKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 48) || 'incident';
    const baseBarrierId = `relocation-${operationId}-${normalizedKey}`;
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
      operationKind: 'asset-relocation',
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
    const generation = await createJsonRecord(this.journalGenerationFile(operationId, 1), journal);
    await createJsonRecord(this.journalFile(operationId), journal);
    await createJsonRecord(this.journalHeadFile(operationId), {
      schemaVersion: 1,
      operationId,
      journalVersion: 1,
      journalSha256: generation.sha256,
    } satisfies AssetImportJournalHead);
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
      && (value.agentRequestFingerprint === undefined || validSha256(value.agentRequestFingerprint))
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

  async inspectStagedItemsForDiscovery(manifest: AssetImportOperationManifest): Promise<{
    items: ProjectAssetImportStagedItem[];
    complete: boolean;
    recoveryRequired: boolean;
  }> {
    if ((await this.assertStagingEntriesKnown(manifest)).length > 0) {
      await this.ensureOperationRecoveryBarrier(manifest.operationId, manifest.createdAt, 'upload-restart-incomplete');
      return { items: [], complete: false, recoveryRequired: true };
    }
    const items: ProjectAssetImportStagedItem[] = [];
    for (const declared of manifest.items) {
      const fact = await this.readStagedItem(manifest.operationId, declared.itemId);
      const binary = this.stagedItemBinaryFile(manifest.operationId, declared.itemId);
      const stat = await fs.lstat(binary).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (fact === null) {
        if (stat !== null) {
          await this.ensureOperationRecoveryBarrier(manifest.operationId, manifest.createdAt, 'staged-binary-orphaned');
          return { items, complete: false, recoveryRequired: true };
        }
        continue;
      }
      if (fact.sourceName !== declared.sourceName
        || fact.bytes !== declared.declaredBytes
        || stat === null
        || !stat.isFile()
        || stat.isSymbolicLink()
        || stat.size !== fact.bytes) {
        await this.ensureOperationRecoveryBarrier(manifest.operationId, manifest.createdAt, 'staged-discovery-mismatch');
        return { items, complete: false, recoveryRequired: true };
      }
      items.push(fact);
    }
    return {
      items,
      complete: items.length === manifest.items.length,
      recoveryRequired: false,
    };
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
        || !['absent', 'exists-file', 'exists-directory', 'unsafe'].includes(fact?.state)
        || (fact.conflictingAssetPaths !== undefined && (!Array.isArray(fact.conflictingAssetPaths) || fact.conflictingAssetPaths.some(file => typeof file !== 'string'))))
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
        const undo = `.surdet/asset-import/${operationId}/undo/${file.itemId}.bin`;
        if (file.targetPath !== planned.targetPath || file.preparedRelativePath !== prepared
          || file.rollbackRelativePath !== rollback || file.undoRelativePath !== undo
          || file.bytes !== planned.bytes || file.sha256 !== planned.sha256
          || !validSha256(file.sha256) || !PUBLICATION_FILE_STATES.has(file.state)) return false;
        const preparedRequired = !['UPLOADED', 'PREPARE_INTENT'].includes(file.state);
        const finalRequired = [
          'LINKED',
          'VERIFIED',
          'ROLLBACK_RENAME_INTENT',
          'ROLLBACK_QUARANTINED',
          'UNDO_RENAME_INTENT',
          'UNDO_QUARANTINED',
          'UNDO_VERIFIED',
        ].includes(file.state);
        const quarantineRequired = file.state === 'ROLLBACK_QUARANTINED';
        const undoRequired = file.state === 'UNDO_QUARANTINED' || file.state === 'UNDO_VERIFIED';
        return (!preparedRequired || validFileIdentity(file.preparedIdentity))
          && (!finalRequired || validFileIdentity(file.finalIdentity))
          && (!quarantineRequired || validFileIdentity(file.quarantineIdentity))
          && (!undoRequired || validFileIdentity(file.undoIdentity));
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

  async writeUndoReceipt(receipt: ProjectAssetImportUndoReceipt): Promise<ProjectAssetImportUndoReceipt> {
    await this.assertOperationWorkspaceOrBarrier(receipt.operationId);
    const file = this.undoReceiptFile(receipt.operationId);
    const existing = await this.readOperationJson<ProjectAssetImportUndoReceipt>(file, receipt.operationId, '撤销回执');
    if (existing !== null) {
      if (equalJson(existing.value, receipt)) return existing.value;
      await this.ensureOperationRecoveryBarrier(receipt.operationId, undefined, 'undo-receipt-conflict');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '撤销回执与既有记录冲突');
    }
    await createJsonRecord(file, receipt);
    return receipt;
  }

  async readUndoReceipt(operationId: string): Promise<ProjectAssetImportUndoReceipt | null> {
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<ProjectAssetImportUndoReceipt>(
      this.undoReceiptFile(operationId),
      operationId,
      '撤销回执',
    );
    if (loaded === null) return null;
    const value = loaded.value;
    const publication = await this.readPublication(operationId);
    const expectedRemoved = publication?.files.map((file) => file.targetPath).sort() ?? [];
    const expectedQuarantine = publication?.files.map((file) => file.undoRelativePath).sort() ?? [];
    if (value?.schemaVersion !== 1 || !validUuid(value.undoReceiptId)
      || !validSha256(value.undoReceiptSha256) || value.operationId !== operationId
      || value.projectIdentity !== this.paths.projectIdentity || value.status !== 'UNDONE'
      || !Number.isSafeInteger(value.journalVersion) || value.journalVersion < 1
      || typeof value.undoneAt !== 'string' || !Array.isArray(value.removedPaths)
      || !Array.isArray(value.quarantinePaths)
      || !equalJson([...value.removedPaths].sort(), expectedRemoved)
      || !equalJson([...value.quarantinePaths].sort(), expectedQuarantine)) {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'undo-receipt-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '撤销回执语义损坏');
    }
    const { undoReceiptSha256: recordedSha256, ...semantic } = value;
    if (undoReceiptSha256(semantic) !== recordedSha256) {
      await this.ensureOperationRecoveryBarrier(operationId, undefined, 'undo-receipt-hash-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '撤销回执内容与回执指纹不一致');
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

  async readOperation(operationId: string): Promise<{ journal: AssetImportJournal; sha256: string; hasSealedPlan: boolean }> {
    const registration = await this.readOperationRegistration(operationId);
    if (registration === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作不存在');
    await this.assertOperationWorkspaceOrBarrier(operationId);
    const loaded = await this.readOperationJson<AssetImportJournal>(this.journalFile(operationId), operationId, '导入 journal');
    if (loaded === null) {
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-missing');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '已登记导入缺少 journal');
    }
    const head = await this.readOperationJson<AssetImportJournalHead>(
      this.journalHeadFile(operationId),
      operationId,
      'journal head',
    );
    const generationEntries = await this.closedJsonEntries(
      this.journalGenerationDirectory(operationId),
      'journal generation',
      (value) => /^\d{12}$/.test(value) && Number(value) >= 1,
    );
    if (head === null || generationEntries.length === 0) {
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-anchor-missing');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入 journal 缺少可验证 generation anchor');
    }
    let previousJournal: AssetImportJournal | null = null;
    let previousSha256: string | null = null;
    let latestJournal: AssetImportJournal | null = null;
    let latestSha256: string | null = null;
    let hasSealedPlan = false;
    for (const [index, entry] of generationEntries.entries()) {
      const expectedVersion = index + 1;
      if (entry.name !== `${String(expectedVersion).padStart(12, '0')}.json`) {
        await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-generation-gap');
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入 journal generation 不连续');
      }
      const generation = await this.readOperationJson<AssetImportJournal>(
        path.join(this.journalGenerationDirectory(operationId), entry.name),
        operationId,
        `journal generation ${expectedVersion}`,
      );
      if (generation === null
        || !validJournalGeneration(generation.value, operationId, registration.itemCount)
        || generation.value.operationId !== operationId
        || generation.value.journalVersion !== expectedVersion
        || generation.value.previousGenerationSha256 !== previousSha256
        || (expectedVersion === 1 && generation.value.status !== 'UPLOADING')
        || (previousJournal !== null
          && !(JOURNAL_TRANSITIONS[previousJournal.status] ?? []).includes(generation.value.status))) {
        await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-generation-invalid');
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入 journal generation 链损坏');
      }
      previousJournal = generation.value;
      hasSealedPlan ||= ['READY', 'PUBLISHING', 'COMMITTED', 'UNDOING', 'UNDONE'].includes(generation.value.status);
      previousSha256 = generation.identity.sha256;
      latestJournal = generation.value;
      latestSha256 = generation.identity.sha256;
    }
    if (head.value?.schemaVersion !== 1
      || head.value.operationId !== operationId
      || head.value.journalVersion !== latestJournal!.journalVersion
      || head.value.journalSha256 !== latestSha256
      || !equalJson(loaded.value, latestJournal)
      || loaded.identity.sha256 !== latestSha256) {
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-head-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入 journal 当前记录与 generation head 不一致');
    }
    const value = loaded.value;
    if (!validJournalGeneration(value, operationId, registration.itemCount)) {
      await this.ensureOperationRecoveryBarrier(operationId, registration.createdAt, 'journal-invalid');
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入 journal 语义损坏');
    }
    return { journal: value, sha256: latestSha256!, hasSealedPlan };
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
    const generation = await createJsonRecord(
      this.journalGenerationFile(previous.operationId, journal.journalVersion),
      journal,
    );
    await replaceJsonRecord(this.journalFile(previous.operationId), journal);
    await replaceJsonRecord(this.journalHeadFile(previous.operationId), {
      schemaVersion: 1,
      operationId: previous.operationId,
      journalVersion: journal.journalVersion,
      journalSha256: generation.sha256,
    } satisfies AssetImportJournalHead);
    return journal;
  }

  async listOperations(): Promise<AssetImportJournal[]> {
    await assertAssetImportDataNamespace(this.paths);
    const directory = path.join(this.paths.projectNamespace, 'operation-index');
    const entries = await this.closedJsonEntries(directory, '导入登记索引');
    const operations: AssetImportJournal[] = [];
    for (const entry of entries) {
      const operationId = entry.name.slice(0, -5);
      const loaded = await this.readOperation(operationId);
      await this.readOperationManifest(operationId);
      operations.push(loaded.journal);
    }
    return operations;
  }

  async registerChallenge(journal: AssetImportChallengeJournal): Promise<void> {
    await assertAssetImportDataNamespace(this.paths);
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
    await assertAssetImportDataNamespace(this.paths);
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
    await assertAssetImportDataNamespace(this.paths);
    const directory = path.join(this.paths.projectNamespace, 'challenge-index');
    const entries = await this.closedJsonEntries(directory, '绑定 challenge 索引');
    const result: AssetImportChallengeJournal[] = [];
    for (const entry of entries) {
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
      if (existing.value.operationId === incident.operationId
        && (existing.value.operationKind ?? 'asset-import') === (incident.operationKind ?? 'asset-import')
        && existing.value.reason === incident.reason) return;
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '恢复屏障身份冲突');
    }
    try {
      await createJsonRecord(file, incident);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.writeBarrier(incident);
      throw error;
    }
  }

  private async terminalBarrierPublication(
    operationId: string,
    status: AssetImportJournal['status'],
  ): Promise<AssetImportPublicationRecord | null> {
    const publication = await this.readPublication(operationId);
    if (status !== 'COMMITTED' && status !== 'UNDONE') return publication;
    const receipt = await this.readReceipt(operationId);
    if (publication === null || receipt === null) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${status} 操作缺少发布 journal 或成功回执`);
    }
    const { receiptSha256: recordedReceiptSha256, ...receiptSemantic } = receipt;
    if (receiptSha256(receiptSemantic) !== recordedReceiptSha256
      || publication.planId !== receipt.planId
      || publication.planFingerprint !== receipt.planFingerprint
      || publication.files.length !== receipt.files.length) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${status} 操作的发布证据与成功回执不一致`);
    }
    const receiptFiles = new Map(receipt.files.map((file) => [file.itemId, file]));
    for (const file of publication.files) {
      const expected = receiptFiles.get(file.itemId);
      if (expected === undefined
        || expected.targetPath !== file.targetPath
        || expected.bytes !== file.bytes
        || expected.sha256 !== file.sha256
        || (status === 'COMMITTED' && file.state !== 'VERIFIED')
        || (status === 'UNDONE' && file.state !== 'UNDO_VERIFIED')) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `${status} 操作的发布文件证据不完整`);
      }
      if (status === 'UNDONE') {
        // A completed undo releases its target for later imports or author edits.
        // The retained quarantine and immutable receipt prove this operation;
        // their bytes are verified by the barrier resolution/discovery callers.
        if (file.undoIdentity === undefined || !sameNodeIdentity(file.undoIdentity, expected.fileIdentity)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', 'UNDONE 操作的隔离身份与成功回执不一致');
        }
      }
    }
    if (status === 'UNDONE' && await this.readUndoReceipt(operationId) === null) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', 'UNDONE 操作缺少撤销回执');
    }
    return publication;
  }

  async resolveBarrier(input: Pick<RecoveryBarrierResolution, 'barrierId' | 'resolvedAt'>): Promise<void> {
    if (!validId(input.barrierId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'barrierId 格式无效');
    await assertAssetImportDataNamespace(this.paths);
    const incident = await readJsonRecord<RecoveryBarrierIncident>(
      path.join(this.paths.projectNamespace, 'recovery-barriers', `${input.barrierId}.json`),
    );
    if (incident === null) throw new AssetImportAuthorityError('INVALID_REQUEST', '恢复屏障不存在');
    if ((incident.value.operationKind ?? 'asset-import') !== 'asset-import') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '该恢复屏障不属于素材导入');
    }
    const journal = await this.readOperation(incident.value.operationId);
    if (!['ROLLED_BACK', 'CANCELLED', 'COMMITTED', 'UNDONE'].includes(journal.journal.status)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '导入操作尚未达到可解除恢复屏障的终态');
    }
    const publication = await this.terminalBarrierPublication(incident.value.operationId, journal.journal.status);
    const quarantined = publicationQuarantines(publication);
    for (const file of quarantined) {
      const current = await stableFileEvidence(absoluteAssetImportProjectPath(this.paths, file.path));
      if (file.identity === undefined || !sameFileIdentity(current.identity, file.identity)
        || current.bytes !== file.bytes || current.sha256 !== file.sha256) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '回滚隔离证据身份不匹配');
      }
    }
    const resolution: RecoveryBarrierResolution = {
      barrierId: input.barrierId,
      incidentSha256: incident.identity.sha256,
      operationId: incident.value.operationId,
      operationKind: 'asset-import',
      journalVersion: journal.journal.journalVersion,
      publicationVersion: publication?.publicationVersion ?? null,
      publicationSha256: publication?.publicationSha256 ?? null,
      quarantinedPaths: quarantined.map((file) => file.path),
      resolvedAt: input.resolvedAt,
    };
    await createJsonRecord(
      path.join(this.paths.projectNamespace, 'recovery-resolutions', `${input.barrierId}.json`),
      resolution,
    );
  }

  async resolveOperationBarriers(operationId: string): Promise<void> {
    const directory = path.join(this.paths.projectNamespace, 'recovery-barriers');
    const entries = await this.closedJsonEntries(directory, '恢复屏障索引');
    await this.closedJsonEntries(
      path.join(this.paths.projectNamespace, 'recovery-resolutions'),
      '恢复决议索引',
    );
    for (const entry of entries) {
      const incident = await readJsonRecord<RecoveryBarrierIncident>(path.join(directory, entry.name));
      if (incident === null || incident.value.operationId !== operationId
        || (incident.value.operationKind ?? 'asset-import') !== 'asset-import') continue;
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

  async resolveRelocationBarriers(
    operationId: string,
  ): Promise<void> {
    if (!validUuid(operationId)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '素材整理 operationId 格式无效');
    }
    if (this.relocationTerminalVerifier === undefined) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理终态验证器尚未就绪');
    }
    const { journalVersion, terminalFingerprint } = await this.relocationTerminalVerifier(operationId);
    const directory = path.join(this.paths.projectNamespace, 'recovery-barriers');
    const entries = await this.closedJsonEntries(directory, '恢复屏障索引');
    await this.closedJsonEntries(path.join(this.paths.projectNamespace, 'recovery-resolutions'), '恢复决议索引');
    for (const entry of entries) {
      const incident = await readJsonRecord<RecoveryBarrierIncident>(path.join(directory, entry.name));
      if (incident === null || incident.value.operationId !== operationId
        || incident.value.operationKind !== 'asset-relocation') continue;
      const resolutionFile = path.join(this.paths.projectNamespace, 'recovery-resolutions', entry.name);
      const resolution = {
        barrierId: incident.value.barrierId,
        incidentSha256: incident.identity.sha256,
        operationId,
        operationKind: 'asset-relocation',
        journalVersion,
        publicationVersion: null,
        publicationSha256: null,
        quarantinedPaths: [],
        terminalFingerprint,
        resolvedAt: new Date().toISOString(),
      } satisfies RecoveryBarrierResolution;
      const existing = await readJsonRecord<RecoveryBarrierResolution>(resolutionFile);
      if (existing !== null
        && existing.value.barrierId === resolution.barrierId
        && existing.value.incidentSha256 === resolution.incidentSha256
        && existing.value.operationId === operationId
        && existing.value.operationKind === 'asset-relocation'
        && existing.value.journalVersion === journalVersion
        && existing.value.terminalFingerprint === terminalFingerprint) continue;
      if (existing === null) await createJsonRecord(resolutionFile, resolution);
      else await replaceJsonRecord(resolutionFile, resolution);
    }
    this.localRecoveryBlocked = false;
    this.localRecoveryBlocked = await this.hasUnresolvedBarrier();
  }

  async hasUnresolvedBarrier(operationKind?: 'asset-import' | 'asset-relocation'): Promise<boolean> {
    if (operationKind === undefined && this.localRecoveryBlocked) return true;
    await assertAssetImportDataNamespace(this.paths);
    const barrierDirectory = path.join(this.paths.projectNamespace, 'recovery-barriers');
    let entries: Dirent[];
    let resolutions: Dirent[];
    try {
      entries = await this.closedJsonEntries(barrierDirectory, '恢复屏障索引');
      resolutions = await this.closedJsonEntries(
        path.join(this.paths.projectNamespace, 'recovery-resolutions'),
        '恢复决议索引',
      );
    } catch (error) {
      if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') return true;
      throw error;
    }
    const barrierNames = new Set(entries.map((entry) => entry.name));
    if (operationKind === undefined && resolutions.some((entry) => !barrierNames.has(entry.name))) return true;
    for (const entry of entries) {
      const incident = await readJsonRecord<RecoveryBarrierIncident>(path.join(barrierDirectory, entry.name));
      if (incident === null || incident.value.barrierId !== entry.name.slice(0, -5)) return true;
      const incidentKind = incident.value.operationKind ?? 'asset-import';
      if (operationKind !== undefined && incidentKind !== operationKind) continue;
      const resolution = await readJsonRecord<RecoveryBarrierResolution>(
        path.join(this.paths.projectNamespace, 'recovery-resolutions', entry.name),
      );
      if (resolution === null || resolution.value.barrierId !== incident.value.barrierId
        || resolution.value.incidentSha256 !== incident.identity.sha256
        || resolution.value.operationId !== incident.value.operationId) return true;
      if (incident.value.operationKind === 'asset-relocation') {
        if (resolution.value.operationKind !== 'asset-relocation'
          || !Number.isSafeInteger(resolution.value.journalVersion)
          || resolution.value.journalVersion < 1
          || !/^[0-9a-f]{64}$/u.test(resolution.value.terminalFingerprint ?? '')) return true;
        if (this.relocationTerminalVerifier === undefined) return true;
        const terminal = await this.relocationTerminalVerifier(incident.value.operationId).catch(() => null);
        if (terminal === null
          || terminal.journalVersion !== resolution.value.journalVersion
          || terminal.terminalFingerprint !== resolution.value.terminalFingerprint) return true;
        continue;
      }
      const journal = await this.readOperation(incident.value.operationId).catch(() => null);
      if (journal === null || journal.journal.journalVersion !== resolution.value.journalVersion
        || !['ROLLED_BACK', 'CANCELLED', 'COMMITTED', 'UNDONE'].includes(journal.journal.status)) return true;
      const publication = await this.terminalBarrierPublication(
        incident.value.operationId,
        journal.journal.status,
      ).catch(() => null);
      if ((journal.journal.status === 'COMMITTED' || journal.journal.status === 'UNDONE')
        && publication === null) return true;
      if ((publication?.publicationVersion ?? null) !== resolution.value.publicationVersion) return true;
      if ((publication?.publicationSha256 ?? null) !== resolution.value.publicationSha256) return true;
      const quarantined = publicationQuarantines(publication);
      for (const file of quarantined) {
        const current = await stableFileEvidence(absoluteAssetImportProjectPath(this.paths, file.path)).catch(() => null);
        if (current === null || file.identity === undefined || !sameFileIdentity(current.identity, file.identity)
          || current.bytes !== file.bytes || current.sha256 !== file.sha256) return true;
      }
      const quarantinedPaths = quarantined.map((file) => file.path);
      if (!equalJson(quarantinedPaths, resolution.value.quarantinedPaths)) return true;
    }
    return operationKind === undefined ? this.localRecoveryBlocked : false;
  }
}
