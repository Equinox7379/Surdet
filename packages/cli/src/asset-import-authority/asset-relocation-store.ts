import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { stableStringify } from '@surdet/authoring';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from '../authoring/node-json-record.js';
import {
  assertAssetImportDataNamespace,
  assertAssetRelocationDataWorkspace,
  createAssetRelocationDataWorkspace,
} from './filesystem.js';
import {
  AssetImportAuthorityError,
  type AssetImportAuthorityPaths,
  type AssetRelocationStoredOperation,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TERMINAL = new Set(['COMMITTED', 'CANCELLED', 'ROLLED_BACK', 'UNDONE']);
const STATUSES = new Set(['PLANNED', 'PUBLISHING', 'ROLLING_BACK', 'ROLLED_BACK', 'RECOVERY_REQUIRED', 'COMMITTED', 'UNDOING', 'UNDONE', 'CANCELLED']);
const BINARY_STATES = new Set(['SOURCE', 'BACKUP_INTENT', 'BACKUP', 'TARGET_INTENT', 'TARGET', 'ROLLBACK_INTENT', 'ROLLED_BACK', 'UNDO_INTENT', 'UNDONE']);
const TEXT_STATES = new Set(['PENDING', 'REPLACE_INTENT', 'REPLACED', 'ROLLBACK_INTENT', 'ROLLED_BACK', 'UNDO_INTENT', 'UNDONE']);

interface RelocationRegistration {
  schemaVersion: 1;
  operationId: string;
  createdAt: string;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireOperationId(operationId: string): string {
  if (!UUID.test(operationId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'operationId 格式无效');
  return operationId;
}

function validRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.startsWith('/')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

function validEvidence(value: unknown): boolean {
  const evidence = value as Record<string, unknown> | null;
  return evidence !== null
    && typeof evidence === 'object'
    && typeof evidence.device === 'string'
    && typeof evidence.inode === 'string'
    && typeof evidence.birthtimeNs === 'string'
    && Number.isSafeInteger(evidence.size)
    && (evidence.size as number) >= 0
    && typeof evidence.mtimeNs === 'string'
    && SHA256.test(String(evidence.sha256));
}

function semanticSha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function validateRecord(operationId: string, value: AssetRelocationStoredOperation): AssetRelocationStoredOperation {
  const request = value?.request;
  const journal = value?.journal;
  const plan = value?.plan;
  const textFiles = value?.textFiles;
  const scannedFiles = value?.scannedFiles;
  const legacyRequest = !Array.isArray(request?.moves);
  const legacyReceipt = value?.receipt !== null && !Array.isArray(value?.receipt?.moves);
  const legacyUndoReceipt = value?.undoReceipt !== null && !Array.isArray(value?.undoReceipt?.moves);
  if (request !== undefined && legacyRequest) {
    request.moves = [{ sourcePath: request.sourcePath, targetPath: request.targetPath }];
  }
  if (!Array.isArray(value?.binaryBaselines) && value?.binaryBaseline !== undefined) {
    value.binaryBaselines = [value.binaryBaseline];
  }
  if (journal !== undefined && !Array.isArray(journal.binaryItems)) {
    journal.binaryItems = [{
      moveId: 'relocation-move-legacy',
      sourcePath: request.sourcePath,
      targetPath: request.targetPath,
      state: journal.binaryState,
      backupRelativePath: journal.binaryBackupRelativePath,
      backupIdentity: journal.binaryBackupIdentity,
      targetIdentity: journal.binaryTargetIdentity,
    }];
  }
  if (value?.receipt !== null && legacyReceipt) {
    value.receipt.moves = [{
      moveId: journal.binaryItems[0]?.moveId ?? 'relocation-move-legacy',
      sourcePath: value.receipt.sourcePath,
      targetPath: value.receipt.targetPath,
      targetIdentity: value.receipt.targetIdentity,
    }];
  }
  if (value?.undoReceipt !== null && legacyUndoReceipt) {
    value.undoReceipt.moves = [{
      moveId: journal.binaryItems[0]?.moveId ?? 'relocation-move-legacy',
      sourcePath: value.undoReceipt.sourcePath,
      targetPath: value.undoReceipt.targetPath,
      sourceIdentity: value.undoReceipt.sourceIdentity,
    }];
  }
  const replacement = value?.schemaVersion === 2 && request?.replacement !== undefined && value?.replacement !== undefined;
  const replacementFacts = plan?.schemaVersion === 2 ? plan.replacement : undefined;
  let valid = (value?.schemaVersion === 1 && value.replacement === undefined && request?.replacement === undefined && replacementFacts === undefined)
    || (replacement && request.moves?.length === 1 && request.sourcePath === request.targetPath
      && typeof request.replacement!.sourceId === 'string' && request.replacement!.sourceId.length > 0
      && validRelativePath(request.replacement!.sourcePath) && SHA256.test(request.replacement!.sha256)
      && value.replacement!.preparedRelativePath === `.surdet/asset-relocation/${operationId}/prepared/replacement.bin`
      && (value.replacement!.preparedIdentity === null || validEvidence(value.replacement!.preparedIdentity))
      && replacementFacts !== undefined && replacementFacts.afterSha256 === request.replacement!.sha256
      && replacementFacts.beforeSha256 === value.binaryBaseline?.source.sha256
      && replacementFacts.sourcePath === request.replacement!.sourcePath && replacementFacts.sourceId === request.replacement!.sourceId
      && Number.isSafeInteger(replacementFacts.bytes) && replacementFacts.bytes > 0
      && replacementFacts.noChange === (replacementFacts.beforeSha256 === replacementFacts.afterSha256)
      && Array.isArray(replacementFacts.references)
      && value.textFiles?.length === 0);
  valid = valid
    && request.operationId === operationId
    && Array.isArray(request.moves)
    && request.moves.length >= 1
    && request.moves.length <= 100
    && request.moves.every((move) => validRelativePath(move.sourcePath)
      && validRelativePath(move.targetPath)
      && move.sourcePath.startsWith('content/assets/')
      && move.targetPath.startsWith('content/assets/')
      && (replacement ? move.sourcePath === move.targetPath : move.sourcePath !== move.targetPath))
    && request.sourcePath === request.moves[0]?.sourcePath
    && request.targetPath === request.moves[0]?.targetPath
    && validRelativePath(request.sourcePath)
    && validRelativePath(request.targetPath)
    && request.sourcePath.startsWith('content/assets/')
    && request.targetPath.startsWith('content/assets/')
    && (replacement || request.sourcePath !== request.targetPath)
    && journal?.operationId === operationId
    && journal.schemaVersion === 1
    && Number.isSafeInteger(journal.journalVersion)
    && journal.journalVersion >= 1
    && STATUSES.has(journal.status)
    && (journal.recoveryPhase === null || ['commit', 'rollback', 'undo'].includes(journal.recoveryPhase))
    && BINARY_STATES.has(journal.binaryState)
    && Array.isArray(journal.binaryItems)
    && journal.binaryItems.length === request.moves.length
    && journal.binaryItems.every((item, index) => item.sourcePath === request.moves[index]?.sourcePath
      && item.targetPath === request.moves[index]?.targetPath
      && BINARY_STATES.has(item.state)
      && item.backupRelativePath === (legacyRequest && request.moves.length === 1
        ? `.surdet/asset-relocation/${operationId}/backup/source.bin`
        : `.surdet/asset-relocation/${operationId}/backup/source-${String(index).padStart(4, '0')}.bin`)
      && (item.backupIdentity === null || validEvidence(item.backupIdentity))
      && (item.targetIdentity === null || validEvidence(item.targetIdentity)))
    && journal.binaryBackupRelativePath === journal.binaryItems[0]?.backupRelativePath
    && journal.binaryState === journal.binaryItems[0]?.state
    && (journal.binaryBackupIdentity === null || validEvidence(journal.binaryBackupIdentity))
    && (journal.binaryTargetIdentity === null || validEvidence(journal.binaryTargetIdentity))
    && typeof journal.updatedAt === 'string'
    && Array.isArray(journal.textStates)
    && Array.isArray(journal.textResultIdentities)
    && Array.isArray(textFiles)
    && journal.textStates.length === textFiles.length
    && journal.textResultIdentities.length === textFiles.length
    && journal.textStates.every((state) => TEXT_STATES.has(state))
    && journal.textResultIdentities.every((identity) => identity === null || validEvidence(identity))
    && plan?.operationId === operationId
    && /^relocation-(?:batch-)?plan-[0-9a-f]{32}$/u.test(plan.planId)
    && SHA256.test(plan.planFingerprint)
    && (plan.schemaVersion === 1 || (plan.schemaVersion === 2
      && Array.isArray(plan.moves)
      && plan.moves.length === request.moves.length
      && plan.moves.every((move, index) => move.source.path === request.moves[index]?.sourcePath
        && move.target.path === request.moves[index]?.targetPath)))
    && (plan.source === null || plan.source.path === request.sourcePath)
    && (plan.target === null || plan.target.path === request.targetPath)
    && Array.isArray(scannedFiles)
    && scannedFiles.every((file) => validRelativePath(file.path) && SHA256.test(file.sha256))
    && new Set(scannedFiles.map((file) => file.path)).size === scannedFiles.length
    && Array.isArray(value.binaryBaselines)
    && value.binaryBaselines.length === request.moves.length
    && sameJson(value.binaryBaseline, value.binaryBaselines[0])
    && value.binaryBaselines.every((baseline, index) => baseline?.source?.path === request.moves[index]?.sourcePath
      && baseline?.target?.path === request.moves[index]?.targetPath
      && ['absent', 'exists'].includes(baseline?.target?.state)
      && validEvidence(baseline?.source)
      && validRelativePath(baseline?.targetDirectory?.path)
      && SHA256.test(baseline?.assetInventoryFingerprint ?? ''))
    && textFiles.every((file, index) => validRelativePath(file.path)
      && SHA256.test(file.beforeSha256)
      && SHA256.test(file.afterSha256)
      && validEvidence(file.beforeIdentity)
      && (file.preparedIdentity === undefined || validEvidence(file.preparedIdentity))
      && (file.backupIdentity === undefined || validEvidence(file.backupIdentity))
      && file.preparedRelativePath === `.surdet/asset-relocation/${operationId}/prepared/text-${String(index).padStart(4, '0')}.txt`
      && file.backupRelativePath === `.surdet/asset-relocation/${operationId}/backup/text-${String(index).padStart(4, '0')}.txt`)
    && new Set(textFiles.map((file) => file.path)).size === textFiles.length;

  if (valid && value.receipt !== null) {
    const { receiptFingerprint, ...semanticWithMoves } = value.receipt;
    const semantic = legacyReceipt
      ? Object.fromEntries(Object.entries(semanticWithMoves).filter(([key]) => key !== 'moves'))
      : semanticWithMoves;
    valid = UUID.test(value.receipt.receiptId)
      && SHA256.test(receiptFingerprint)
      && semanticSha256(semantic) === receiptFingerprint
      && value.receipt.operationId === operationId
      && value.receipt.planId === plan.planId
      && value.receipt.planFingerprint === plan.planFingerprint
      && value.receipt.projectIdentity.length > 0
      && value.receipt.sourcePath === request.sourcePath
      && value.receipt.targetPath === request.targetPath
      && validEvidence(value.receipt.targetIdentity)
      && value.receipt.moves.length === request.moves.length
      && value.receipt.moves.every((move, index) => move.sourcePath === request.moves[index]?.sourcePath
        && move.targetPath === request.moves[index]?.targetPath
        && move.moveId === journal.binaryItems[index]?.moveId
        && validEvidence(move.targetIdentity))
      && Array.isArray(value.receipt.textFiles)
      && value.receipt.textFiles.length === textFiles.length
      && value.receipt.textFiles.every((file, index) => file.path === textFiles[index]!.path
        && file.sha256 === textFiles[index]!.afterSha256
        && validEvidence(file.identity)
        && (['UNDOING', 'UNDONE'].includes(journal.status)
          || (journal.status === 'RECOVERY_REQUIRED' && journal.recoveryPhase === 'undo')
          || (journal.textResultIdentities[index] !== null
            && sameJson(file.identity, journal.textResultIdentities[index]))))
      && typeof value.receipt.committedAt === 'string';
  }
  if (valid && value.undoReceipt !== null) {
    const { undoReceiptFingerprint, ...semanticWithMoves } = value.undoReceipt;
    const semantic = legacyUndoReceipt
      ? Object.fromEntries(Object.entries(semanticWithMoves).filter(([key]) => key !== 'moves'))
      : semanticWithMoves;
    valid = UUID.test(value.undoReceipt.undoReceiptId)
      && SHA256.test(undoReceiptFingerprint)
      && semanticSha256(semantic) === undoReceiptFingerprint
      && value.undoReceipt.operationId === operationId
      && value.receipt !== null
      && value.undoReceipt.receiptId === value.receipt.receiptId
      && value.undoReceipt.sourcePath === request.sourcePath
      && value.undoReceipt.targetPath === request.targetPath
      && validEvidence(value.undoReceipt.sourceIdentity)
      && value.undoReceipt.moves.length === request.moves.length
      && value.undoReceipt.moves.every((move, index) => move.sourcePath === request.moves[index]?.sourcePath
        && move.targetPath === request.moves[index]?.targetPath
        && move.moveId === journal.binaryItems[index]?.moveId
        && validEvidence(move.sourceIdentity))
      && value.undoReceipt.restoredTextFiles.length === textFiles.length
      && value.undoReceipt.restoredTextFiles.every((file, index) => file.path === textFiles[index]!.path
        && file.sha256 === textFiles[index]!.beforeSha256
        && validEvidence(file.identity)
        && journal.textResultIdentities[index] !== null
        && sameJson(file.identity, journal.textResultIdentities[index]))
      && typeof value.undoReceipt.undoneAt === 'string';
  }
  valid = valid
    && (!['COMMITTED', 'UNDOING', 'UNDONE'].includes(journal.status) || value.receipt !== null)
    && (journal.status !== 'UNDONE' || value.undoReceipt !== null)
    && (!TERMINAL.has(journal.status) || journal.recoveryPhase === null);
  if (!valid) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理记录语义损坏');
  }
  return value;
}

export class AssetRelocationStore {
  private recoveryReporter?: (operationId: string, incidentKey: string) => void | Promise<void>;

  constructor(readonly paths: AssetImportAuthorityPaths) {}

  setRecoveryReporter(reporter: (operationId: string, incidentKey: string) => void | Promise<void>): void {
    this.recoveryReporter = reporter;
  }

  private async recoveryRequired(operationId: string, incidentKey: string, message: string): Promise<never> {
    if (this.recoveryReporter !== undefined) {
      await Promise.resolve(this.recoveryReporter(operationId, incidentKey)).catch(() => undefined);
    }
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', message);
  }

  private indexFile(operationId: string): string {
    return path.join(this.paths.projectNamespace, 'relocation-index', `${requireOperationId(operationId)}.json`);
  }

  private operationDirectory(operationId: string): string {
    return path.join(this.paths.projectNamespace, 'relocations', requireOperationId(operationId));
  }

  private recordFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'record.json');
  }

  private async closedEntries(directory: string, kind: 'file' | 'directory'): Promise<string[]> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      if (entries.some((entry) => /^\..+\.tmp$/u.test(entry.name))) {
        if (attempt < 4) {
          await wait(10);
          continue;
        }
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理索引存在未完成写入');
      }
      const names: string[] = [];
      for (const entry of entries) {
        const name = kind === 'file' && entry.name.endsWith('.json') ? entry.name.slice(0, -5) : entry.name;
        const validKind = kind === 'file' ? entry.isFile() : entry.isDirectory();
        if (!validKind || entry.isSymbolicLink() || !UUID.test(name)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理索引包含未知条目');
        }
        names.push(name);
      }
      return names.sort();
    }
    return [];
  }

  async create(record: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    const operationId = requireOperationId(record.request.operationId);
    await assertAssetImportDataNamespace(this.paths);
    const existing = await this.read(operationId);
    if (existing !== null) {
      if (sameJson(existing.request, record.request) && existing.plan.planFingerprint === record.plan.planFingerprint) {
        return existing;
      }
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同素材整理');
    }
    await createAssetRelocationDataWorkspace(this.paths, operationId);
    try {
      await createJsonRecord(this.recordFile(operationId), record);
      await createJsonRecord(this.indexFile(operationId), {
        schemaVersion: 1,
        operationId,
        createdAt: record.journal.updatedAt,
      } satisfies RelocationRegistration);
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const concurrent = await this.read(operationId);
        if (concurrent !== null && sameJson(concurrent.request, record.request)
          && concurrent.plan.planFingerprint === record.plan.planFingerprint) return concurrent;
      }
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理操作未完整登记');
    }
  }

  async read(operationIdInput: string): Promise<AssetRelocationStoredOperation | null> {
    const operationId = requireOperationId(operationIdInput);
    try {
      await assertAssetImportDataNamespace(this.paths);
      const index = await readJsonRecord<RelocationRegistration>(this.indexFile(operationId));
      const operationExists = await fs.lstat(this.operationDirectory(operationId)).then((stat) => stat.isDirectory() && !stat.isSymbolicLink())
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        });
      if (index === null && !operationExists) return null;
      if (index === null || !operationExists || index.value.operationId !== operationId || index.value.schemaVersion !== 1) {
        return this.recoveryRequired(operationId, 'registration-invalid', '素材整理登记与持久目录不一致');
      }
      await assertAssetRelocationDataWorkspace(this.paths, operationId);
      const loaded = await readJsonRecord<AssetRelocationStoredOperation>(this.recordFile(operationId));
      if (loaded === null) return this.recoveryRequired(operationId, 'record-missing', '素材整理记录缺失');
      return validateRecord(operationId, loaded.value);
    } catch (error) {
      if (error instanceof AssetImportAuthorityError && error.code === 'INVALID_REQUEST') throw error;
      if (error instanceof AssetImportAuthorityError && error.message !== '素材整理记录语义损坏') throw error;
      return this.recoveryRequired(operationId, 'record-invalid', '素材整理记录无法安全读取');
    }
  }

  async replace(
    previous: AssetRelocationStoredOperation,
    next: AssetRelocationStoredOperation,
  ): Promise<AssetRelocationStoredOperation> {
    const operationId = requireOperationId(previous.request.operationId);
    const current = await this.read(operationId);
    if (current === null || !sameJson(current, previous)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '素材整理操作已被更新');
    }
    if (next.request.operationId !== operationId
      || next.journal.journalVersion !== previous.journal.journalVersion + 1) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '素材整理状态迁移无效');
    }
    validateRecord(operationId, next);
    await replaceJsonRecord(this.recordFile(operationId), next);
    return next;
  }

  async list(): Promise<AssetRelocationStoredOperation[]> {
    await assertAssetImportDataNamespace(this.paths);
    const index = await this.closedEntries(path.join(this.paths.projectNamespace, 'relocation-index'), 'file');
    const operations = await this.closedEntries(path.join(this.paths.projectNamespace, 'relocations'), 'directory');
    if (!sameJson(index, operations)) {
      const mismatch = [...new Set([...index, ...operations])]
        .find((operationId) => !index.includes(operationId) || !operations.includes(operationId));
      if (mismatch !== undefined) {
        return this.recoveryRequired(mismatch, 'namespace-mismatch', '素材整理索引与持久目录不一致');
      }
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理索引与持久目录不一致');
    }
    const result: AssetRelocationStoredOperation[] = [];
    for (const operationId of index) {
      const operation = await this.read(operationId);
      if (operation === null) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理索引指向空记录');
      result.push(operation);
    }
    return result.sort((left, right) => left.journal.updatedAt.localeCompare(right.journal.updatedAt));
  }
}
