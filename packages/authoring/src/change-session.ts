import type {
  ChangeRecord,
  ChangeRepository,
  ChangeStatus,
  ProjectWriteStorage,
} from './contracts.js';
import type { ProjectSnapshot } from './project-snapshot.js';

export class AuthoringOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuthoringOperationError';
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export class InMemoryChangeRepository implements ChangeRepository {
  readonly records = new Map<string, ChangeRecord>();
  readonly evidence = new Map<string, unknown>();
  readonly journals = new Map<string, unknown>();

  async create(record: ChangeRecord): Promise<void> {
    if (this.records.has(record.changeId)) throw new Error(`change already exists: ${record.changeId}`);
    this.records.set(record.changeId, clone(record));
  }

  async read(changeId: string): Promise<ChangeRecord | null> {
    const record = this.records.get(changeId);
    return record === undefined ? null : clone(record);
  }

  async write(record: ChangeRecord): Promise<void> {
    this.records.set(record.changeId, clone(record));
  }

  async writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void> {
    this.evidence.set(`${changeId}:${evidenceId}`, clone(value));
  }

  async readEvidence(changeId: string, evidenceId: string): Promise<unknown | null> {
    const value = this.evidence.get(`${changeId}:${evidenceId}`);
    return value === undefined ? null : clone(value);
  }

  async writeJournal(changeId: string, value: unknown): Promise<void> {
    this.journals.set(changeId, clone(value));
  }
}

export class ChangeSession {
  constructor(
    readonly record: ChangeRecord,
    readonly repository: ChangeRepository,
    readonly storage?: ProjectWriteStorage,
  ) {}
}

let changeSequence = 0;

export async function beginChange(
  snapshot: ProjectSnapshot,
  repository: ChangeRepository,
  storage?: ProjectWriteStorage,
): Promise<ChangeSession> {
  changeSequence += 1;
  const baseFiles = Object.fromEntries(snapshot.files.map((file) => [file.path, { sha256: file.sha256 }]));
  const baseContents = Object.fromEntries(snapshot.files.map((file) => [file.path, file.text]));
  const record: ChangeRecord = {
    changeId: `chg_${String(changeSequence).padStart(4, '0')}`,
    projectRootIdentity: snapshot.rootIdentity,
    baseRevision: snapshot.revision,
    workingRevision: 0,
    status: 'OPEN',
    baseFiles,
    baseContents,
    workingFiles: { ...baseContents },
    operations: {},
  };
  await repository.create(record);
  return new ChangeSession(record, repository, storage);
}

export function openChange(
  record: ChangeRecord,
  repository: ChangeRepository,
  storage?: ProjectWriteStorage,
): ChangeSession {
  return new ChangeSession(record, repository, storage);
}

function assertOpen(change: ChangeSession): void {
  if (change.record.status !== 'OPEN') {
    throw new AuthoringOperationError('CHANGE_NOT_OPEN', `变更事务不是 OPEN：${change.record.status}`);
  }
}

export interface OperationOutcome<T> {
  result: T;
  workingFiles?: Record<string, string>;
  changed?: boolean;
}

export async function runOperation<T>(
  change: ChangeSession,
  input: { operationId: string },
  handler: (record: ChangeRecord) => Promise<OperationOutcome<T>> | OperationOutcome<T>,
): Promise<T> {
  assertOpen(change);
  if (input.operationId.length === 0) throw new AuthoringOperationError('INVALID_REQUEST', 'operationId 不能为空');
  const requestHash = stableStringify(input);
  const previous = change.record.operations[input.operationId];
  if (previous !== undefined) {
    if (previous.requestHash !== requestHash) {
      throw new AuthoringOperationError('OPERATION_ID_CONFLICT', `operationId 已用于不同负载：${input.operationId}`);
    }
    return previous.result as T;
  }

  const outcome = await handler(change.record);
  const next = clone(change.record);
  next.workingFiles = outcome.workingFiles === undefined ? { ...next.workingFiles } : { ...outcome.workingFiles };
  if (outcome.changed !== false) next.workingRevision += 1;
  next.operations[input.operationId] = { requestHash, result: outcome.result };
  next.latestValidation = undefined;
  await change.repository.write(next);
  Object.assign(change.record, next);
  return outcome.result;
}

export async function recordValidation(
  change: ChangeSession,
  input: { evidenceId: string; errors: number },
): Promise<void> {
  assertOpen(change);
  const next = clone(change.record);
  next.latestValidation = {
    evidenceId: input.evidenceId,
    errors: input.errors,
    workingRevision: change.record.workingRevision,
  };
  await change.repository.write(next);
  Object.assign(change.record, next);
}

export async function rollbackChange(change: ChangeSession): Promise<ChangeRecord> {
  assertOpen(change);
  const next = clone(change.record);
  next.status = 'ROLLED_BACK';
  next.workingFiles = { ...next.baseContents };
  await change.repository.write(next);
  Object.assign(change.record, next);
  return change.record;
}

interface CommitJournalEntry {
  path: string;
  originalSha256?: string;
  targetSha256: string;
  stagedIdentity: string;
  replaced: boolean;
  restored: boolean;
}

interface CommitJournal {
  changeId: string;
  status: 'STAGING' | 'REPLACING' | 'RECOVERED' | 'RECOVERY_FAILED' | 'COMMITTED';
  files: CommitJournalEntry[];
}

async function markStale(change: ChangeSession): Promise<void> {
  const next = clone(change.record);
  next.status = 'STALE';
  await change.repository.write(next);
  Object.assign(change.record, next);
}

function changedPaths(record: ChangeRecord): string[] {
  const paths = new Set([...Object.keys(record.baseContents), ...Object.keys(record.workingFiles)]);
  return [...paths].filter((path) => record.baseContents[path] !== record.workingFiles[path]).sort();
}

export async function commitChange(
  change: ChangeSession,
  storage: ProjectWriteStorage = change.storage as ProjectWriteStorage,
): Promise<{ changeId: string; status: 'COMMITTED'; files: string[] }> {
  assertOpen(change);
  if (storage === undefined) throw new AuthoringOperationError('INVALID_REQUEST', 'change.commit 缺少 ProjectWriteStorage');
  const validation = change.record.latestValidation;
  if (validation === undefined || validation.workingRevision !== change.record.workingRevision) {
    throw new AuthoringOperationError('VALIDATION_REQUIRED', '提交前必须有当前 workingRevision 的新鲜校验');
  }
  if (validation.errors !== 0) {
    throw new AuthoringOperationError('VALIDATION_FAILED', '提交前校验仍有 error');
  }

  const paths = changedPaths(change.record);
  for (const path of paths) {
    const base = change.record.baseFiles[path]?.sha256;
    const exists = await storage.exists(path);
    if (base === undefined) {
      if (exists) {
        await markStale(change);
        throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', `新文件在事务外已存在：${path}`);
      }
      continue;
    }
    if (!exists) {
      await markStale(change);
      throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', `基线文件已消失：${path}`);
    }
    const current = await storage.readText(path);
    if (current.sha256 !== base) {
      await markStale(change);
      throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', `项目文件在事务外发生变化：${path}`);
    }
  }

  const journal: CommitJournal = { changeId: change.record.changeId, status: 'STAGING', files: [] };
  try {
    for (const path of paths) {
      const staged = await storage.stageText(path, change.record.workingFiles[path]!, change.record.changeId);
      journal.files.push({
        path,
        ...(change.record.baseFiles[path] === undefined ? {} : { originalSha256: change.record.baseFiles[path]!.sha256 }),
        targetSha256: staged.sha256,
        stagedIdentity: staged.stagedIdentity,
        replaced: false,
        restored: false,
      });
    }
    await change.repository.writeJournal(change.record.changeId, journal);
  } catch (error) {
    for (const entry of journal.files) await storage.removeStage(entry.stagedIdentity);
    throw new AuthoringOperationError('COMMIT_FAILED_RECOVERED', `提交前 staging 失败：${String(error)}`);
  }

  journal.status = 'REPLACING';
  await change.repository.writeJournal(change.record.changeId, journal);
  try {
    for (const entry of journal.files) {
      await storage.replaceFromStage(entry.path, entry.stagedIdentity);
      entry.replaced = true;
      await change.repository.writeJournal(change.record.changeId, journal);
      const finalFile = await storage.readText(entry.path);
      if (finalFile.sha256 !== entry.targetSha256) throw new Error(`最终文件身份不匹配：${entry.path}`);
    }
  } catch (error) {
    let recoveryError: unknown;
    for (const entry of [...journal.files].reverse()) {
      if (!entry.replaced) continue;
      try {
        const original = change.record.baseContents[entry.path];
        if (original === undefined) {
          if (storage.removePath === undefined) throw new Error(`无法恢复新文件：${entry.path}`);
          await storage.removePath(entry.path);
        } else {
          await storage.restoreText(entry.path, original);
        }
        entry.restored = true;
        await change.repository.writeJournal(change.record.changeId, journal);
      } catch (restoreError) {
        recoveryError = restoreError;
      }
    }
    for (const entry of journal.files) {
      try { await storage.removeStage(entry.stagedIdentity); } catch { /* 失败证据由 journal 保留 */ }
    }
    if (recoveryError !== undefined) {
      journal.status = 'RECOVERY_FAILED';
      await change.repository.writeJournal(change.record.changeId, journal);
      await markStale(change);
      throw new AuthoringOperationError('COMMIT_RECOVERY_FAILED', `提交失败且恢复失败：${String(recoveryError)}`, { cause: String(error) });
    }
    journal.status = 'RECOVERED';
    await change.repository.writeJournal(change.record.changeId, journal);
    throw new AuthoringOperationError('COMMIT_FAILED_RECOVERED', `提交失败但已恢复：${String(error)}`);
  }

  for (const entry of journal.files) await storage.removeStage(entry.stagedIdentity);
  journal.status = 'COMMITTED';
  await change.repository.writeJournal(change.record.changeId, journal);
  const next = clone(change.record);
  next.status = 'COMMITTED';
  await change.repository.write(next);
  Object.assign(change.record, next);
  return { changeId: change.record.changeId, status: 'COMMITTED', files: paths };
}

export type { ChangeRecord, ChangeRepository, ChangeStatus } from './contracts.js';
