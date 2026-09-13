import type {
  ChangeRecord,
  CommitJournal,
  ProjectWriteStorage,
  RecoveryInspection,
} from './contracts.js';
import { AuthoringOperationError, stableStringify, type ChangeSession } from './change-session.js';

type FileState = RecoveryInspection['fileStates'][number];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseState(state: FileState['state']): boolean {
  return state === 'original' || state === 'absent-expected';
}

function projectState(fileStates: readonly FileState[]): RecoveryInspection['projectState'] {
  if (fileStates.some((file) => file.state === 'unexpected')) return 'ambiguous';
  if (fileStates.every((file) => baseState(file.state))) return 'base';
  if (fileStates.length > 0 && fileStates.every((file) => file.state === 'target')) return 'target';
  return 'mixed-known';
}

function validJournal(journal: CommitJournal | null, changeId: string): journal is CommitJournal | null {
  if (journal === null) return true;
  if (typeof journal !== 'object' || journal.formatVersion !== 2 || journal.changeId !== changeId
    || !Number.isInteger(journal.journalVersion) || journal.journalVersion < 1
    || !['STAGING', 'REPLACING', 'RECOVERED', 'RECOVERY_FAILED', 'COMMITTED'].includes(journal.status)
    || !Number.isInteger(journal.recordVersionAtCommitStart) || journal.recordVersionAtCommitStart < 0
    || typeof journal.projectRevisionAtCommitStart !== 'string' || !Array.isArray(journal.files)) return false;
  return journal.files.every((entry) => typeof entry === 'object' && entry !== null
    && typeof entry.path === 'string' && typeof entry.targetSha256 === 'string'
    && typeof entry.stagedIdentity === 'string' && typeof entry.replaced === 'boolean'
    && typeof entry.restored === 'boolean'
    && (entry.originalSha256 === undefined || typeof entry.originalSha256 === 'string'));
}

function projectPathIsSafe(value: string): boolean {
  if (value.length === 0 || value.includes('\0')) return false;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

function recoveryDisposition(
  journal: CommitJournal | null,
  project: RecoveryInspection['projectState'],
  changeStatus: ChangeRecord['status'],
  lockState: RecoveryInspection['lockState'],
): RecoveryInspection['disposition'] {
  if (lockState !== 'free' || project === 'ambiguous') return 'MANUAL_RECOVERY_REQUIRED';
  if (journal === null) return changeStatus === 'STALE' ? 'MANUAL_RECOVERY_REQUIRED' : 'NO_ACTION';
  switch (journal.status) {
    case 'STAGING':
      return project === 'base' ? 'REOPEN_OPEN' : 'MANUAL_RECOVERY_REQUIRED';
    case 'REPLACING':
    case 'RECOVERY_FAILED':
      return 'ROLL_BACK_TO_BASE';
    case 'COMMITTED':
      if (project !== 'target') return 'MANUAL_RECOVERY_REQUIRED';
      return changeStatus === 'COMMITTED' ? 'NO_ACTION' : 'FINALIZE_COMMITTED';
    case 'RECOVERED':
      return project === 'base' ? 'REOPEN_OPEN' : 'MANUAL_RECOVERY_REQUIRED';
    default:
      return 'MANUAL_RECOVERY_REQUIRED';
  }
}

function stageIsLegal(storage: ProjectWriteStorage, stagedIdentity: string): boolean {
  if (stagedIdentity.length === 0 || stagedIdentity.includes('\0')) return false;
  const normalized = stagedIdentity.replaceAll('\\', '/');
  if (normalized.includes('/../') || normalized.endsWith('/..') || normalized.startsWith('../')) return false;
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (!basename.startsWith('.surdet-')) return false;
  const root = storage.rootIdentity.replaceAll('\\', '/').replace(/\/$/, '');
  const absoluteRoot = root.startsWith('/') || /^[A-Za-z]:\//.test(root);
  if (!absoluteRoot) return true;
  const candidate = normalized.toLowerCase();
  const expectedPrefix = `${root.toLowerCase()}/`;
  return candidate.startsWith(expectedPrefix);
}

function operationHash(operationId: string, recoveryToken: string, disposition: RecoveryInspection['disposition']): string {
  return stableStringify({ operationId, recoveryToken, disposition });
}

async function webSha256(value: string): Promise<string> {
  const globalCrypto = (globalThis as unknown as {
    crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  }).crypto;
  const textEncoder = (globalThis as unknown as {
    TextEncoder?: new () => { encode(input: string): Uint8Array };
  }).TextEncoder;
  if (globalCrypto?.subtle === undefined || textEncoder === undefined) {
    throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', '恢复 token 计算需要 Web Crypto SHA-256');
  }
  const digest = await globalCrypto.subtle.digest('SHA-256', new textEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function classifyFile(storage: ProjectWriteStorage, entry: CommitJournal['files'][number]): Promise<FileState> {
  if (!projectPathIsSafe(entry.path)) return { path: entry.path, state: 'unexpected' };
  let exists: boolean;
  try {
    exists = await storage.exists(entry.path);
  } catch (error) {
    return { path: entry.path, state: 'unexpected' };
  }
  if (!exists) {
    return entry.originalSha256 === undefined
      ? { path: entry.path, state: 'absent-expected' }
      : { path: entry.path, state: 'unexpected' };
  }
  try {
    const current = await storage.readText(entry.path);
    if (current.sha256 === entry.targetSha256) return { path: entry.path, state: 'target', actualSha256: current.sha256 };
    if (entry.originalSha256 !== undefined && current.sha256 === entry.originalSha256) {
      return { path: entry.path, state: 'original', actualSha256: current.sha256 };
    }
    return { path: entry.path, state: 'unexpected', actualSha256: current.sha256 };
  } catch (error) {
    return { path: entry.path, state: 'unexpected' };
  }
}

export async function inspectTransactionRecovery(input: {
  record: ChangeRecord;
  journal: CommitJournal | null;
  storage: ProjectWriteStorage;
  leaseState: RecoveryInspection['lockState'];
  sha256(value: string): Promise<string>;
}): Promise<RecoveryInspection> {
  const journalValid = validJournal(input.journal, input.record.changeId);
  const journal = journalValid ? input.journal : null;
  const fileStates = journal === null
    ? []
    : await Promise.all(journal.files.map((entry) => classifyFile(input.storage, entry)));
  const state = journalValid ? projectState(fileStates) : 'ambiguous';
  const disposition = journalValid
    ? recoveryDisposition(journal, state, input.record.status, input.leaseState)
    : 'MANUAL_RECOVERY_REQUIRED';
  const reasons: string[] = [];
  if (input.journal === null) reasons.push('没有可验证的 commit journal');
  if (!journalValid) reasons.push('commit journal 格式、身份或版本无效');
  if (state === 'ambiguous') reasons.push('项目包含无法与 original/target 身份匹配的文件');
  if (input.leaseState !== 'free') reasons.push(`lock state '${input.leaseState}' 不允许自动恢复`);
  if (disposition === 'REOPEN_OPEN') reasons.push('已知项目状态允许恢复为 OPEN');
  if (disposition === 'ROLL_BACK_TO_BASE') reasons.push('项目状态已知，可逆序恢复到 base');
  if (disposition === 'FINALIZE_COMMITTED') reasons.push('全部文件已是 target，可补记 COMMITTED');
  if (disposition === 'NO_ACTION') reasons.push('record 已处于闭合状态');
  if (disposition === 'MANUAL_RECOVERY_REQUIRED') reasons.push('当前事实不足以安全自动恢复');

  const base: Omit<RecoveryInspection, 'recoveryToken'> = {
    changeId: input.record.changeId,
    recordState: journalValid ? 'readable' : 'corrupt',
    changeStatus: input.record.status,
    ...(journal === null ? {} : { journalStatus: journal.status }),
    lockState: input.leaseState,
    projectState: state,
    fileStates,
    disposition,
    manualRecoveryRequired: disposition === 'MANUAL_RECOVERY_REQUIRED' || input.leaseState !== 'free' || !journalValid,
    reasons,
  };
  const recoveryFacts = {
    record: {
      changeId: input.record.changeId,
      recordVersion: input.record.recordVersion,
      status: input.record.status,
      baseRevision: input.record.baseRevision,
      workingRevision: input.record.workingRevision,
    },
    journal: input.journal,
    inspection: base,
  };
  const recoveryToken = await input.sha256(stableStringify(recoveryFacts));
  return { ...base, recoveryToken };
}

async function persistRecord(
  change: ChangeSession,
  status: 'OPEN' | 'COMMITTED' | 'STALE',
  operationId: string,
  requestHash: string,
  result: { changeId: string; status: 'OPEN' | 'COMMITTED'; disposition: string },
): Promise<void> {
  const current = change.record;
  const next = clone(current);
  next.status = status;
  next.recordVersion = current.recordVersion + 1;
  next.operations = { ...next.operations, [operationId]: { requestHash, sequence: Object.keys(current.operations).length, result } };
  await change.repository.write(next, {
    expectedRecordVersion: current.recordVersion,
    expectedStatus: current.status,
  });
  Object.assign(current, next);
}

async function writeJournal(change: ChangeSession, journal: CommitJournal, status: CommitJournal['status']): Promise<CommitJournal> {
  const next: CommitJournal = {
    ...clone(journal),
    journalVersion: journal.journalVersion + 1,
    status,
    files: clone(journal.files),
  };
  await change.repository.writeJournal(change.record.changeId, next);
  return next;
}

async function verifyRestored(storage: ProjectWriteStorage, entry: CommitJournal['files'][number]): Promise<void> {
  if (entry.originalSha256 === undefined) {
    if (await storage.exists(entry.path)) throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `新文件未删除：${entry.path}`);
    return;
  }
  if (!await storage.exists(entry.path)) throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `原文件恢复后缺失：${entry.path}`);
  const restored = await storage.readText(entry.path);
  if (restored.sha256 !== entry.originalSha256) {
    throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `原文件恢复后身份不匹配：${entry.path}`);
  }
}

async function executeRollback(
  input: {
    change: ChangeSession;
    journal: CommitJournal;
    storage: ProjectWriteStorage;
    inspection: RecoveryInspection;
    operationId: string;
    requestHash: string;
  },
): Promise<{ changeId: string; status: 'OPEN'; disposition: 'ROLL_BACK_TO_BASE' }> {
  let journal = clone(input.journal);
  const stateByPath = new Map(input.inspection.fileStates.map((file) => [file.path, file.state]));
  try {
    for (const entry of [...journal.files].reverse()) {
      const state = stateByPath.get(entry.path);
      if (state !== 'target') continue;
      if (entry.originalSha256 === undefined) {
        if (input.storage.removePath === undefined) throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `无法删除恢复新文件：${entry.path}`);
        await input.storage.removePath(entry.path);
      } else {
        const original = input.change.record.baseContents[entry.path];
        if (original === undefined) throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `baseContents 缺少原文件：${entry.path}`);
        await input.storage.restoreText(entry.path, original);
      }
      await verifyRestored(input.storage, entry);
      const currentEntry = journal.files.find((candidate) => candidate.path === entry.path);
      if (currentEntry !== undefined) currentEntry.restored = true;
      journal = await writeJournal(input.change, journal, 'REPLACING');
    }
    journal = await writeJournal(input.change, journal, 'RECOVERED');
    const result = { changeId: input.change.record.changeId, status: 'OPEN' as const, disposition: 'ROLL_BACK_TO_BASE' as const };
    await persistRecord(input.change, 'OPEN', input.operationId, input.requestHash, result);
    return result;
  } catch (error) {
    try {
      await writeJournal(input.change, journal, 'RECOVERY_FAILED');
      const failed = { changeId: input.change.record.changeId, status: 'OPEN' as const, disposition: 'MANUAL_RECOVERY_REQUIRED' as const };
      await persistRecord(input.change, 'STALE', input.operationId, input.requestHash, failed);
    } catch {
      // 保留原始恢复错误与已有 journal 证据。
    }
    if (error instanceof AuthoringOperationError && error.code === 'RECOVERY_EXECUTION_FAILED') throw error;
    throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `恢复到 base 失败：${String(error)}`);
  }
}

export async function executeTransactionRecovery(input: {
  change: ChangeSession;
  journal: CommitJournal;
  storage: ProjectWriteStorage;
  inspection: RecoveryInspection;
  recoveryToken: string;
  operationId: string;
}): Promise<{ changeId: string; status: 'OPEN' | 'COMMITTED'; disposition: string }> {
  if (input.operationId.length === 0) throw new AuthoringOperationError('INVALID_REQUEST', 'operationId 不能为空');
  if (input.recoveryToken.length === 0) throw new AuthoringOperationError('INVALID_REQUEST', 'recoveryToken 不能为空');
  const existing = Object.prototype.hasOwnProperty.call(input.change.record.operations, input.operationId)
    ? input.change.record.operations[input.operationId]
    : undefined;
  const requestedHash = operationHash(input.operationId, input.recoveryToken, input.inspection.disposition);
  if (existing !== undefined) {
    if (existing.requestHash !== requestedHash) {
      throw new AuthoringOperationError('OPERATION_ID_CONFLICT', `operationId 已用于不同恢复请求：${input.operationId}`);
    }
    return existing.result as { changeId: string; status: 'OPEN' | 'COMMITTED'; disposition: string };
  }
  if (input.inspection.recoveryToken !== input.recoveryToken) {
    throw new AuthoringOperationError('RECOVERY_PLAN_STALE', '恢复计划 token 与 inspect 事实不匹配');
  }

  const fresh = await inspectTransactionRecovery({
    record: input.change.record,
    journal: input.journal,
    storage: input.storage,
    leaseState: input.inspection.lockState,
    sha256: webSha256,
  });
  if (fresh.recoveryToken !== input.recoveryToken) {
    throw new AuthoringOperationError('RECOVERY_PLAN_STALE', '项目、record 或 journal 事实已变化');
  }
  if (fresh.manualRecoveryRequired || fresh.disposition === 'MANUAL_RECOVERY_REQUIRED') {
    throw new AuthoringOperationError('RECOVERY_AMBIGUOUS', '当前恢复事实包含 unexpected 或不可接管 lock');
  }
  if (fresh.disposition === 'NO_ACTION') {
    throw new AuthoringOperationError('RECOVERY_NOT_REQUIRED', '当前事务不需要恢复');
  }

  const requestHash = operationHash(input.operationId, input.recoveryToken, fresh.disposition);
  if (fresh.disposition === 'REOPEN_OPEN') {
    let journal = input.journal;
    if (journal.status === 'STAGING') {
      for (const entry of journal.files) {
        if (!stageIsLegal(input.storage, entry.stagedIdentity)) {
          throw new AuthoringOperationError('RECOVERY_AMBIGUOUS', `stagedIdentity 不在合法范围：${entry.stagedIdentity}`);
        }
      }
      try {
        for (const entry of journal.files) await input.storage.removeStage(entry.stagedIdentity);
      } catch (error) {
        try {
          await writeJournal(input.change, journal, 'RECOVERY_FAILED');
          const failed = { changeId: input.change.record.changeId, status: 'OPEN' as const, disposition: 'MANUAL_RECOVERY_REQUIRED' as const };
          await persistRecord(input.change, 'STALE', input.operationId, requestHash, failed);
        } catch {
          // 保留已有 journal 与原始失败证据。
        }
        if (error instanceof AuthoringOperationError && error.code === 'RECOVERY_EXECUTION_FAILED') throw error;
        throw new AuthoringOperationError('RECOVERY_EXECUTION_FAILED', `清理 staged 文件失败：${String(error)}`);
      }
      journal = await writeJournal(input.change, journal, 'RECOVERED');
    }
    const result = { changeId: input.change.record.changeId, status: 'OPEN' as const, disposition: 'REOPEN_OPEN' as const };
    await persistRecord(input.change, 'OPEN', input.operationId, requestHash, result);
    return result;
  }
  if (fresh.disposition === 'ROLL_BACK_TO_BASE') {
    return executeRollback({ ...input, inspection: fresh, requestHash });
  }
  if (fresh.disposition === 'FINALIZE_COMMITTED') {
    for (const entry of input.journal.files) {
      if (!stageIsLegal(input.storage, entry.stagedIdentity)) continue;
      await input.storage.removeStage(entry.stagedIdentity).catch(() => undefined);
    }
    const result = { changeId: input.change.record.changeId, status: 'COMMITTED' as const, disposition: 'FINALIZE_COMMITTED' as const };
    await persistRecord(input.change, 'COMMITTED', input.operationId, requestHash, result);
    return result;
  }
  throw new AuthoringOperationError('RECOVERY_AMBIGUOUS', '恢复状态没有唯一安全动作');
}
