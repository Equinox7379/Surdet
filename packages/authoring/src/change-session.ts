import type {
  ChangeRecord,
  ChangeRepository,
  ChangeStatus,
  ChangeWritePrecondition,
  CommitJournal,
  ChangeIntentMetadata,
  EvidenceFreshness,
  ProjectWriteStorage,
} from './contracts.js';
import type { JsonValue } from './composition-contracts.js';
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

/**
 * operation 输入的唯一 JSON 规范化：对象键按 code point 排序、数组保序；
 * undefined、函数、symbol、非有限 number 与非普通 object 一律 fail-loud，
 * 不静默丢弃或转换。严格 schema 进入的 payload 不含 undefined；
 * optional 字段应由调用者省略，而不是显式传 undefined。
 */
export function normalizeJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AuthoringOperationError('INVALID_REQUEST', 'operation input 包含非有限数字');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item));
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol'
    || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'operation input 不是 JSON value');
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, normalizeJsonValue((value as Record<string, unknown>)[key])]),
  );
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

  async write(record: ChangeRecord): Promise<void>;
  async write(record: ChangeRecord, precondition: ChangeWritePrecondition): Promise<void>;
  async write(record: ChangeRecord, precondition?: ChangeWritePrecondition): Promise<void> {
    const current = this.records.get(record.changeId);
    if (current === undefined) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${record.changeId}`);
    const expected = precondition ?? { expectedRecordVersion: current.recordVersion, expectedStatus: current.status };
    if (current.recordVersion !== expected.expectedRecordVersion
      || (expected.expectedStatus !== undefined && current.status !== expected.expectedStatus)) {
      throw recordConflict(record.changeId, expected, current);
    }
    if (record.recordVersion !== current.recordVersion + 1) {
      throw recordConflict(record.changeId, {
        expectedRecordVersion: current.recordVersion + 1,
        expectedStatus: current.status,
      }, current);
    }
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

  async readLatestJournal(changeId: string): Promise<unknown | null> {
    const value = this.journals.get(changeId);
    return value === undefined ? null : clone(value);
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

/** R5：change identity 的全局唯一随机段。Web Crypto 在 Node 19+ 与浏览器/Electron
 *  均为全局标准（editor preview 同源用法）；不引入 node:crypto 依赖，保持 authoring 跨平台。 */
function changeIdentityRandom(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID === undefined) {
    throw new Error('change identity 生成需要 Web Crypto（crypto.randomUUID）');
  }
  return cryptoApi.randomUUID();
}

export async function beginChange(
  snapshot: ProjectSnapshot,
  repository: ChangeRepository,
  storage?: ProjectWriteStorage,
  intent?: ChangeIntentMetadata,
): Promise<ChangeSession> {
  const boundedIntent = validateIntentMetadata(intent);
  changeSequence += 1;
  const baseFiles = Object.fromEntries(snapshot.files.map((file) => [file.path, { sha256: file.sha256 }]));
  const baseContents = Object.fromEntries(snapshot.files.map((file) => [file.path, file.text]));
  // R5：进程级序号只作可读前缀（decoration），唯一性由完整 UUID 承担——
  // 跨 project / process / restart 全局可解析，杜绝共享 data dir 下的 chg_0001 撞号。
  const record: ChangeRecord = {
    changeId: `chg_${String(changeSequence).padStart(4, '0')}_${changeIdentityRandom()}`,
    formatVersion: 2,
    recordVersion: 0,
    projectRootIdentity: snapshot.rootIdentity,
    baseRevision: snapshot.revision,
    workingRevision: 0,
    status: 'OPEN',
    baseFiles,
    baseContents,
    workingFiles: { ...baseContents },
    operations: {},
    ...(boundedIntent === undefined ? {} : { intent: boundedIntent }),
  };
  await repository.create(record);
  return new ChangeSession(record, repository, storage);
}

function validateIntentMetadata(intent: ChangeIntentMetadata | undefined): ChangeIntentMetadata | undefined {
  if (intent === undefined) return undefined;
  if (intent.intent !== undefined && (typeof intent.intent !== 'string' || intent.intent.length > 2000)) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'change intent 最长为 2,000 字符');
  }
  if (intent.acceptanceCriteria !== undefined) {
    if (!Array.isArray(intent.acceptanceCriteria) || intent.acceptanceCriteria.length > 20
      || intent.acceptanceCriteria.some((item) => typeof item !== 'string' || item.length > 500)) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'acceptanceCriteria 最多 20 项且每项最长 500 字符');
    }
  }
  if (intent.initiator !== undefined && !['external-agent', 'human', 'automation'].includes(intent.initiator)) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'initiator 不在允许的枚举内');
  }
  return {
    ...(intent.intent === undefined ? {} : { intent: intent.intent }),
    ...(intent.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: [...intent.acceptanceCriteria] }),
    ...(intent.initiator === undefined ? {} : { initiator: intent.initiator }),
  };
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

function recordConflict(
  changeId: string,
  precondition: ChangeWritePrecondition,
  actual: ChangeRecord,
): AuthoringOperationError {
  return new AuthoringOperationError(
    'CHANGE_RECORD_CONFLICT',
    `变更事务 '${changeId}' 的记录版本已变化：期望 ${precondition.expectedRecordVersion}，实际 ${actual.recordVersion}`,
    {
      changeId,
      expectedRecordVersion: precondition.expectedRecordVersion,
      actualRecordVersion: actual.recordVersion,
      expectedStatus: precondition.expectedStatus,
      actualStatus: actual.status,
      retryDisposition: 'after-refresh',
      repairAction: '重新 session.describe、change.diff 或重新打开 change 后，使用同一 operationId 重试',
    },
  );
}

async function persistRecord(change: ChangeSession, next: ChangeRecord): Promise<void> {
  const current = change.record;
  next.recordVersion = current.recordVersion + 1;
  await change.repository.write(next, {
    expectedRecordVersion: current.recordVersion,
    expectedStatus: current.status,
  });
  Object.assign(current, next);
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
  const normalizedInput = normalizeJsonValue(input);
  const requestHash = stableStringify(normalizedInput);
  const previous = change.record.operations[input.operationId];
  if (previous !== undefined) {
    if (previous.requestHash !== requestHash) {
      throw new AuthoringOperationError('OPERATION_ID_CONFLICT', `operationId 已用于不同负载：${input.operationId}`);
    }
    // 幂等回放：旧记录即使缺 normalizedInput 也只按 requestHash 返回，不重写历史。
    return previous.result as T;
  }

  const outcome = await handler(change.record);
  const next = clone(change.record);
  next.workingFiles = outcome.workingFiles === undefined ? { ...next.workingFiles } : { ...outcome.workingFiles };
  if (outcome.changed !== false) next.workingRevision += 1;
  next.operations[input.operationId] = { requestHash, normalizedInput, result: outcome.result };
  next.latestValidation = undefined;
  await persistRecord(change, next);
  return outcome.result;
}

export async function recordSimulationEvidence(
  change: ChangeSession,
  input: { evidenceId: string; status: 'passed' | 'failed' | 'incomplete' },
): Promise<void> {
  assertOpen(change);
  const next = clone(change.record);
  next.latestSimulation = {
    evidenceId: input.evidenceId,
    status: input.status,
    workingRevision: change.record.workingRevision,
  };
  await persistRecord(change, next);
}

export async function recordRuntimeTrace(
  change: ChangeSession,
  input: { traceId: string; status: 'passed' },
): Promise<void> {
  assertOpen(change);
  const next = clone(change.record);
  next.runtimeTraces = [
    ...(next.runtimeTraces ?? []).filter((trace) => trace.traceId !== input.traceId),
    { traceId: input.traceId, status: input.status, workingRevision: change.record.workingRevision },
  ];
  await persistRecord(change, next);
}

export async function recordDiffEvidence(
  change: ChangeSession,
  input: { evidenceId: string },
): Promise<void> {
  assertOpen(change);
  const next = clone(change.record);
  next.latestDiff = {
    evidenceId: input.evidenceId,
    workingRevision: change.record.workingRevision,
  };
  await persistRecord(change, next);
}

export function evidenceFreshness(
  evidence: { evidenceId?: string; workingRevision?: number; status?: 'passed' | 'failed' | 'incomplete'; errors?: number } | undefined,
  currentWorkingRevision: number,
): EvidenceFreshness {
  if (evidence === undefined) return { status: 'missing', currentWorkingRevision };
  const status = evidence.status === 'failed' || (evidence.errors ?? 0) > 0
    ? 'failed'
    : evidence.status === 'incomplete'
      ? 'incomplete'
      : evidence.workingRevision === currentWorkingRevision ? 'fresh' : 'stale';
  return {
    ...(evidence.evidenceId === undefined ? {} : { evidenceId: evidence.evidenceId }),
    status,
    ...(evidence.workingRevision === undefined ? {} : { workingRevision: evidence.workingRevision }),
    currentWorkingRevision,
  };
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
  await persistRecord(change, next);
}

export async function rollbackChange(change: ChangeSession): Promise<ChangeRecord> {
  assertOpen(change);
  const next = clone(change.record);
  next.status = 'ROLLED_BACK';
  next.workingFiles = { ...next.baseContents };
  await persistRecord(change, next);
  return change.record;
}

async function markStale(change: ChangeSession): Promise<void> {
  const next = clone(change.record);
  next.status = 'STALE';
  await persistRecord(change, next);
}

export async function assertBaseStillMatches(change: ChangeSession, snapshot: ProjectSnapshot): Promise<void> {
  assertOpen(change);
  if (snapshot.rootIdentity === change.record.projectRootIdentity && snapshot.revision === change.record.baseRevision) return;
  await markStale(change);
  throw new AuthoringOperationError(
    'PROJECT_CHANGED_SINCE_BEGIN',
    `项目 revision 已变化：基线 ${change.record.baseRevision}，当前 ${snapshot.revision}`,
    {
      changeId: change.record.changeId,
      baseRevision: change.record.baseRevision,
      currentRevision: snapshot.revision,
    },
  );
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

  let journal: CommitJournal = {
    formatVersion: 2,
    journalVersion: 0,
    changeId: change.record.changeId,
    recordVersionAtCommitStart: change.record.recordVersion,
    projectRevisionAtCommitStart: change.record.baseRevision,
    status: 'STAGING',
    files: [],
  };
  const writeJournal = async (status: CommitJournal['status']): Promise<void> => {
    journal = {
      ...clone(journal),
      journalVersion: journal.journalVersion + 1,
      status,
      files: clone(journal.files),
    };
    await change.repository.writeJournal(change.record.changeId, journal);
  };
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
    await writeJournal('STAGING');
  } catch (error) {
    for (const entry of journal.files) await storage.removeStage(entry.stagedIdentity);
    throw new AuthoringOperationError('COMMIT_FAILED_RECOVERED', `提交前 staging 失败：${String(error)}`);
  }

  await writeJournal('REPLACING');
  try {
    for (const entry of journal.files) {
      await storage.replaceFromStage(entry.path, entry.stagedIdentity);
      entry.replaced = true;
      await writeJournal('REPLACING');
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
        await writeJournal('REPLACING');
      } catch (restoreError) {
        recoveryError = restoreError;
      }
    }
    for (const entry of journal.files) {
      try { await storage.removeStage(entry.stagedIdentity); } catch { /* 失败证据由 journal 保留 */ }
    }
    if (recoveryError !== undefined) {
      await writeJournal('RECOVERY_FAILED');
      await markStale(change);
      throw new AuthoringOperationError('COMMIT_RECOVERY_FAILED', `提交失败且恢复失败：${String(recoveryError)}`, { cause: String(error) });
    }
    await writeJournal('RECOVERED');
    throw new AuthoringOperationError('COMMIT_FAILED_RECOVERED', `提交失败但已恢复：${String(error)}`);
  }

  await writeJournal('COMMITTED');
  const next = clone(change.record);
  next.status = 'COMMITTED';
  await persistRecord(change, next);

  for (const entry of journal.files) {
    try {
      await storage.removeStage(entry.stagedIdentity);
    } catch {
      // Content and transaction are already COMMITTED. The committed journal
      // retains the staged identity for later inspection; cleanup is best-effort.
    }
  }
  return { changeId: change.record.changeId, status: 'COMMITTED', files: paths };
}

export type {
  ChangeIntentMetadata,
  ChangeRecord,
  ChangeRepository,
  ChangeStatus,
  ChangeWritePrecondition,
  EvidenceFreshness,
} from './contracts.js';
