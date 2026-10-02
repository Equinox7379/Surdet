import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  stableStringify,
  type ChangeRecord,
  type ChangeRepository,
  type ChangeWritePrecondition,
  type CommitJournal,
} from '@surdet/authoring';
import type { InvocationRecord } from '../agent-port/invocation-ledger.js';
import { defaultAgentDataRoot, NodeLocalLeaseManager, type LeaseHandle } from './node-local-lease.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from './node-json-record.js';

export interface ArtifactIdentity {
  path: string;
  bytes: number;
  sha256: string;
}

interface ChangeManifest {
  formatVersion: 2;
  changeId: string;
  projectRootIdentity: string;
  createdAt: string;
}

interface RecordHead {
  formatVersion: 2;
  recordVersion: number;
  recordSha256: string;
}

interface LeaseBinding {
  manager: NodeLocalLeaseManager;
  handle: LeaseHandle;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function corrupt(message: string, details: Record<string, unknown> = {}): AuthoringOperationError {
  return new AuthoringOperationError('CHANGE_STORE_CORRUPT', message, details);
}

function unsupported(changeId: string, file: string): AuthoringOperationError {
  return new AuthoringOperationError(
    'CHANGE_STORE_FORMAT_UNSUPPORTED',
    `变更事务 '${changeId}' 使用不受支持的 V1 store；不会迁移或删除旧文件`,
    { changeId, path: file, formatVersion: 1, repairAction: '保留原始记录，另行人工迁移或归档' },
  );
}

function sameRootIdentity(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function versionFile(version: number): string {
  return `${String(version).padStart(10, '0')}.json`;
}

function validateManifest(value: unknown, changeId: string, file: string): ChangeManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw corrupt(`manifest 不是对象：${file}`, { path: file });
  const manifest = value as Partial<ChangeManifest>;
  if (manifest.formatVersion !== 2) throw unsupported(changeId, file);
  if (manifest.changeId !== changeId || typeof manifest.projectRootIdentity !== 'string' || typeof manifest.createdAt !== 'string') {
    throw corrupt(`manifest 身份不匹配：${file}`, { path: file, changeId, actualChangeId: manifest.changeId });
  }
  return manifest as ChangeManifest;
}

function validateHead(value: unknown, changeId: string, file: string): RecordHead {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw corrupt(`record head 不是对象：${file}`, { path: file, changeId });
  const head = value as Partial<RecordHead>;
  const recordVersion = head.recordVersion;
  if (head.formatVersion !== 2 || typeof recordVersion !== 'number' || !Number.isInteger(recordVersion) || recordVersion < 0
    || typeof head.recordSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(head.recordSha256)) {
    throw corrupt(`record head 格式无效：${file}`, { path: file, changeId });
  }
  return head as RecordHead;
}

function validateRecord(record: ChangeRecord, changeId: string, rootIdentity: string, file: string, head: RecordHead): void {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw corrupt(`record 不是对象：${file}`, { path: file, changeId });
  }
  if (record.formatVersion !== 2 || !Number.isInteger(record.recordVersion) || record.recordVersion < 0
    || typeof record.projectRootIdentity !== 'string') {
    throw corrupt(`record 格式无效：${file}`, { path: file, changeId });
  }
  if (record.changeId !== changeId || record.recordVersion !== head.recordVersion
    || !sameRootIdentity(record.projectRootIdentity, rootIdentity)) {
    throw corrupt(`record 身份或版本不匹配：${file}`, {
      path: file,
      changeId,
      actualChangeId: record.changeId,
      recordVersion: record.recordVersion,
      headRecordVersion: head.recordVersion,
    });
  }
}

const JOURNAL_STATUSES = ['STAGING', 'REPLACING', 'RECOVERED', 'RECOVERY_FAILED', 'COMMITTED'] as const;

function unsupportedJournal(changeId: string, file: string): AuthoringOperationError {
  return new AuthoringOperationError(
    'CHANGE_STORE_FORMAT_UNSUPPORTED',
    `变更事务 '${changeId}' 的 commit journal 使用不受支持的 V1 格式；不会迁移或删除旧文件`,
    { changeId, path: file, formatVersion: 1, component: 'commit-journal', repairAction: '保留原始 journal，另行人工迁移或归档' },
  );
}

function journalCorrupt(message: string, details: Record<string, unknown> = {}): AuthoringOperationError {
  return new AuthoringOperationError('JOURNAL_CORRUPT', message, {
    ...details,
    manualRecoveryRequired: true,
    repairAction: '保留 journal 原始文件，人工检查后再恢复；工具不会猜测或删除 journal',
  });
}

function validateJournal(value: unknown, changeId: string, file: string): CommitJournal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw journalCorrupt(`commit journal 不是对象：${file}`, { path: file, changeId });
  }
  const journal = value as Partial<CommitJournal>;
  if ((journal as { formatVersion?: unknown }).formatVersion === 1) throw unsupportedJournal(changeId, file);
  if (journal.formatVersion !== 2
    || journal.changeId !== changeId
    || typeof journal.journalVersion !== 'number'
    || !Number.isInteger(journal.journalVersion)
    || journal.journalVersion < 1
    || typeof journal.recordVersionAtCommitStart !== 'number'
    || !Number.isInteger(journal.recordVersionAtCommitStart)
    || journal.recordVersionAtCommitStart < 0
    || typeof journal.projectRevisionAtCommitStart !== 'string'
    || !JOURNAL_STATUSES.includes(journal.status as typeof JOURNAL_STATUSES[number])
    || !Array.isArray(journal.files)) {
    throw journalCorrupt(`commit journal 格式或身份无效：${file}`, { path: file, changeId });
  }
  const paths = new Set<string>();
  for (const [index, rawEntry] of journal.files.entries()) {
    if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) {
      throw journalCorrupt(`commit journal 文件条目无效：${file}`, { path: file, changeId, index });
    }
    const entry = rawEntry as Partial<CommitJournal['files'][number]>;
    if (typeof entry.path === 'string' && paths.has(entry.path)) {
      throw journalCorrupt(`commit journal 存在重复文件路径：${file}`, { path: file, changeId, index });
    }
    if (typeof entry.path === 'string') paths.add(entry.path);
    if (typeof entry.path !== 'string'
      || entry.path.length === 0
      || (entry.originalSha256 !== undefined && (typeof entry.originalSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.originalSha256)))
      || (entry.kind === 'delete'
        ? typeof entry.originalSha256 !== 'string' || entry.targetSha256 !== undefined || entry.stagedIdentity !== undefined
        : (entry.kind !== undefined && entry.kind !== 'write') || typeof entry.targetSha256 !== 'string'
          || !/^[0-9a-f]{64}$/i.test(entry.targetSha256) || typeof entry.stagedIdentity !== 'string' || entry.stagedIdentity.length === 0)
      || typeof entry.replaced !== 'boolean'
      || typeof entry.restored !== 'boolean') {
      throw journalCorrupt(`commit journal 文件条目字段无效：${file}`, { path: file, changeId, index });
    }
  }
  return journal as CommitJournal;
}

function validateJournalContinuation(previous: CommitJournal, journal: CommitJournal, file: string): void {
  // A recovered attempt is closed. An explicit retry appends a new STAGING
  // attempt; its newly staged files must not be compared with the old attempt.
  if (journal.status === 'STAGING') {
    if (previous.status === 'RECOVERED'
      && journal.recordVersionAtCommitStart >= previous.recordVersionAtCommitStart
      && journal.projectRevisionAtCommitStart === previous.projectRevisionAtCommitStart
      && journal.files.every((entry) => !entry.replaced && !entry.restored)) return;
    throw journalCorrupt(`commit journal 在恢复完成前重启提交：${file}`, { path: file, changeId: journal.changeId });
  }
  if (journal.recordVersionAtCommitStart !== previous.recordVersionAtCommitStart
    || journal.projectRevisionAtCommitStart !== previous.projectRevisionAtCommitStart) {
    throw journalCorrupt(`commit journal 起始身份前后矛盾：${file}`, { path: file, changeId: journal.changeId });
  }
  const previousFiles = new Map(previous.files.map((entry) => [entry.path, entry]));
  if (journal.files.length !== previous.files.length
    || journal.files.some((entry) => {
      const baseline = previousFiles.get(entry.path);
      return baseline === undefined
        || (baseline.kind ?? 'write') !== (entry.kind ?? 'write')
        || baseline.originalSha256 !== entry.originalSha256
        || baseline.targetSha256 !== entry.targetSha256
        || baseline.stagedIdentity !== entry.stagedIdentity;
    })) {
    throw journalCorrupt(`commit journal 文件身份前后矛盾：${file}`, { path: file, changeId: journal.changeId });
  }
}

function conflict(
  changeId: string,
  precondition: ChangeWritePrecondition,
  actual: ChangeRecord,
): AuthoringOperationError {
  return new AuthoringOperationError(
    'CHANGE_RECORD_CONFLICT',
    `变更事务 '${changeId}' 的记录版本或状态已变化：期望 v${precondition.expectedRecordVersion}，实际 v${actual.recordVersion}`,
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

export interface OpenChangeResult {
  store: NodeChangeStore;
  record: ChangeRecord;
}

/**
 * V2 文件系统变更仓库。manifest/head/record 共同定义可读的 commit point；
 * V1 transaction.json/working-files.json 只保留为历史证据，不参与新写入。
 */
export class NodeChangeStore implements ChangeRepository {
  private constructor(
    readonly rootDirectory: string,
    readonly rootIdentity: string,
    readonly projectDirectory: string,
    private readonly leaseBinding?: LeaseBinding,
  ) {}

  static async forProject(rootIdentity: string, root = defaultAgentDataRoot()): Promise<NodeChangeStore> {
    const projectDirectory = path.join(root, projectIdentityFromRoot(rootIdentity));
    await fs.mkdir(projectDirectory, { recursive: true });
    return new NodeChangeStore(root, rootIdentity, projectDirectory);
  }

  static async openByChangeId(changeId: string, root = defaultAgentDataRoot()): Promise<OpenChangeResult | null> {
    const projects = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const matches: OpenChangeResult[] = [];
    const legacyPaths: string[] = [];
    const corruptCandidates: AuthoringOperationError[] = [];
    const directoryName = safeId(changeId);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const projectDirectory = path.join(root, project.name);
      const changeDirectory = path.join(projectDirectory, directoryName);
      if (!(await isDirectory(changeDirectory))) continue;
      const legacyTransaction = path.join(changeDirectory, 'transaction.json');
      const manifestFile = path.join(changeDirectory, 'manifest.json');
      if (!(await exists(manifestFile))) {
        if (await exists(legacyTransaction)) {
          legacyPaths.push(legacyTransaction);
          continue;
        }
        corruptCandidates.push(corrupt(`V2 manifest 缺失：${manifestFile}`, { path: manifestFile, changeId }));
        continue;
      }
      try {
        const manifest = await readJsonRecord<ChangeManifest>(manifestFile);
        if (manifest === null) throw corrupt(`V2 manifest 缺失：${manifestFile}`, { path: manifestFile, changeId });
        const validated = validateManifest(manifest.value, changeId, manifestFile);
        const store = new NodeChangeStore(root, validated.projectRootIdentity, projectDirectory);
        const record = await store.read(changeId);
        if (record === null) throw corrupt(`V2 record 不存在：${changeDirectory}`, { path: changeDirectory, changeId });
        matches.push({ store, record });
      } catch (error) {
        if (error instanceof AuthoringOperationError
          && (error.code === 'CHANGE_STORE_CORRUPT' || error.code === 'JOURNAL_CORRUPT')) {
          corruptCandidates.push(error);
          continue;
        }
        throw error;
      }
    }
    if (legacyPaths.length + matches.length > 1) {
      throw new AuthoringOperationError(
        'CHANGE_ID_AMBIGUOUS',
        `变更事务 '${changeId}' 在 ${legacyPaths.length + matches.length} 个项目中存在同名记录——请为各项目隔离 SURDET_AGENT_DATA_DIR，或人工归档冲突的旧事务后重试`,
        { changeId, matchCount: legacyPaths.length + matches.length, legacyPaths },
      );
    }
    if (legacyPaths.length === 1) throw unsupported(changeId, legacyPaths[0]!);
    if (matches.length === 0) {
      if (corruptCandidates.length > 0) throw corruptCandidates[0]!;
      return null;
    }
    if (matches.length > 1) {
      throw new AuthoringOperationError(
        'CHANGE_ID_AMBIGUOUS',
        `变更事务 '${changeId}' 在 ${matches.length} 个项目中存在同名记录——请为各项目隔离 SURDET_AGENT_DATA_DIR，或人工归档冲突的旧事务后重试`,
        { changeId, matchCount: matches.length, projectRootIdentities: matches.map((match) => match.record.projectRootIdentity) },
      );
    }
    return matches[0]!;
  }

  static async openForProject(
    changeId: string,
    projectRootIdentity: string,
    options: { allowTerminal?: boolean; allowStale?: boolean; dataRoot?: string } = {},
  ): Promise<OpenChangeResult | null> {
    const root = options.dataRoot ?? defaultAgentDataRoot();
    const projectDirectory = path.join(root, projectIdentityFromRoot(projectRootIdentity));
    const changeDirectory = path.join(projectDirectory, safeId(changeId));
    if (!(await isDirectory(changeDirectory))) return null;

    const manifestPath = path.join(changeDirectory, 'manifest.json');
    const legacyTransaction = path.join(changeDirectory, 'transaction.json');
    if (!(await exists(manifestPath))) {
      if (await exists(legacyTransaction)) throw unsupported(changeId, legacyTransaction);
      throw corrupt(`V2 manifest 缺失：${manifestPath}`, { path: manifestPath, changeId, projectRootIdentity });
    }
    const manifestRead = await readJsonRecord<ChangeManifest>(manifestPath);
    if (manifestRead === null) throw corrupt(`V2 manifest 缺失：${manifestPath}`, { path: manifestPath, changeId });
    const manifest = validateManifest(manifestRead.value, changeId, manifestPath);
    if (!sameRootIdentity(manifest.projectRootIdentity, projectRootIdentity)) {
      throw new AuthoringOperationError(
        'PROJECT_IDENTITY_MISMATCH',
        `变更事务 '${changeId}' 的 manifest 不属于当前项目`,
        { changeId, expected: projectRootIdentity, actual: manifest.projectRootIdentity },
      );
    }
    const store = new NodeChangeStore(root, projectRootIdentity, projectDirectory);
    const record = await store.read(changeId);
    if (record === null) throw corrupt(`V2 record 不存在：${changeDirectory}`, { path: changeDirectory, changeId });
    if (record.status === 'STALE' && !options.allowStale) {
      throw new AuthoringOperationError('CHANGE_NOT_OPEN', `变更事务不是 OPEN：${record.status}`, { changeId, status: record.status });
    }
    if ((record.status === 'COMMITTED' || record.status === 'ROLLED_BACK') && !options.allowTerminal) {
      throw new AuthoringOperationError('CHANGE_NOT_OPEN', `变更事务不是 OPEN：${record.status}`, { changeId, status: record.status });
    }
    return { store, record };
  }

  static async openOwnedChange(changeId: string, projectRootIdentity: string): Promise<OpenChangeResult | null> {
    const opened = await NodeChangeStore.openForProject(changeId, projectRootIdentity);
    if (opened === null) return null;
    return opened;
  }

  static async withChangeLeaseForProject<T>(
    changeId: string,
    projectRootIdentity: string,
    callback: (leased: NodeChangeStore) => Promise<T>,
    options: {
      allowTerminal?: boolean;
      allowStale?: boolean;
      leaseManager?: NodeLocalLeaseManager;
    } = {},
  ): Promise<T> {
    const manager = options.leaseManager ?? new NodeLocalLeaseManager();
    return manager.withLease({ scope: 'change', resourceId: changeId }, async (handle) => {
      const opened = await NodeChangeStore.openForProject(changeId, projectRootIdentity, { ...options, dataRoot: manager.dataRoot });
      if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
      const leased = new NodeChangeStore(opened.store.rootDirectory, opened.store.rootIdentity, opened.store.projectDirectory, {
        manager,
        handle,
      });
      return callback(leased);
    });
  }

  static async withChangeLease<T>(changeId: string, callback: (leased: NodeChangeStore) => Promise<T>, manager = new NodeLocalLeaseManager()): Promise<T> {
    return manager.withLease({ scope: 'change', resourceId: changeId }, async (handle) => {
      const opened = await NodeChangeStore.openByChangeId(changeId, manager.dataRoot);
      if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
      const leased = new NodeChangeStore(opened.store.rootDirectory, opened.store.rootIdentity, opened.store.projectDirectory, {
        manager,
        handle,
      });
      return callback(leased);
    });
  }

  private changeDirectory(changeId: string): string {
    return path.join(this.projectDirectory, safeId(changeId));
  }

  private manifestFile(changeId: string): string {
    return path.join(this.changeDirectory(changeId), 'manifest.json');
  }

  private headFile(changeId: string): string {
    return path.join(this.changeDirectory(changeId), 'record-head.json');
  }

  private recordFile(changeId: string, recordVersion: number): string {
    return path.join(this.changeDirectory(changeId), 'records', versionFile(recordVersion));
  }

  private async readV2(changeId: string): Promise<ChangeRecord | null> {
    const directory = this.changeDirectory(changeId);
    if (!(await isDirectory(directory))) return null;
    const legacyTransaction = path.join(directory, 'transaction.json');
    const manifestPath = this.manifestFile(changeId);
    if (!(await exists(manifestPath))) {
      if (await exists(legacyTransaction)) throw unsupported(changeId, legacyTransaction);
      throw corrupt(`V2 manifest 缺失：${manifestPath}`, { path: manifestPath, changeId });
    }
    const manifestRead = await readJsonRecord<ChangeManifest>(manifestPath);
    if (manifestRead === null) throw corrupt(`V2 manifest 缺失：${manifestPath}`, { path: manifestPath, changeId });
    const manifest = validateManifest(manifestRead.value, changeId, manifestPath);
    if (!sameRootIdentity(manifest.projectRootIdentity, this.rootIdentity)) {
      throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', `变更事务 '${changeId}' 不属于当前项目`, {
        changeId,
        expected: this.rootIdentity,
        actual: manifest.projectRootIdentity,
      });
    }
    const headPath = this.headFile(changeId);
    const headRead = await readJsonRecord<RecordHead>(headPath);
    if (headRead === null) throw corrupt(`record head 缺失：${headPath}`, { path: headPath, changeId });
    const head = validateHead(headRead.value, changeId, headPath);
    const recordPath = this.recordFile(changeId, head.recordVersion);
    const recordRead = await readJsonRecord<ChangeRecord>(recordPath);
    if (recordRead === null) throw corrupt(`head 指向的 record 缺失：${recordPath}`, { path: recordPath, changeId });
    validateRecord(recordRead.value, changeId, manifest.projectRootIdentity, recordPath, head);
    if (recordRead.identity.sha256.toLowerCase() !== head.recordSha256.toLowerCase()) {
      throw corrupt(`record SHA-256 与 head 不匹配：${recordPath}`, {
        path: recordPath,
        changeId,
        expectedSha256: head.recordSha256,
        actualSha256: recordRead.identity.sha256,
      });
    }
    return clone(recordRead.value);
  }

  async create(record: ChangeRecord): Promise<void> {
    if (record.projectRootIdentity !== this.rootIdentity) throw new Error('change project identity mismatch');
    if (record.formatVersion !== 2 || record.recordVersion !== 0) throw new AuthoringOperationError('CHANGE_STORE_FORMAT_UNSUPPORTED', '新 change 必须使用 V2 record');
    const requested = record.changeId;
    let candidate = requested;
    for (;;) {
      const directory = this.changeDirectory(candidate);
      try {
        await fs.mkdir(directory, { recursive: false });
        record.changeId = candidate;
        await fs.mkdir(path.join(directory, 'records'), { recursive: true });
        await fs.mkdir(path.join(directory, 'journals'), { recursive: true });
        await fs.mkdir(path.join(directory, 'evidence'), { recursive: true });
        await fs.mkdir(path.join(directory, 'traces'), { recursive: true });
        await fs.mkdir(path.join(directory, 'invocations'), { recursive: true });
        await fs.mkdir(path.join(directory, 'capsules'), { recursive: true });
        await createJsonRecord(path.join(directory, 'manifest.json'), {
          formatVersion: 2,
          changeId: candidate,
          projectRootIdentity: record.projectRootIdentity,
          createdAt: new Date().toISOString(),
        } satisfies ChangeManifest);
        const recordIdentity = await createJsonRecord(this.recordFile(candidate, record.recordVersion), record);
        await createJsonRecord(path.join(directory, 'record-head.json'), {
          formatVersion: 2,
          recordVersion: record.recordVersion,
          recordSha256: recordIdentity.sha256,
        } satisfies RecordHead);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        candidate = `${requested}_${crypto.randomUUID().slice(0, 12)}`;
      }
    }
  }

  async read(changeId: string): Promise<ChangeRecord | null> {
    const record = await this.readV2(changeId);
    return record === null ? null : clone(record);
  }

  private async assertMutationLease(): Promise<void> {
    if (this.leaseBinding === undefined) {
      throw new AuthoringOperationError('CHANGE_BUSY', '变更事务写入必须通过 NodeChangeStore.withChangeLease() 持有本地 lease', {
        manualRecoveryRequired: false,
        retryDisposition: 'after-refresh',
        repairAction: '通过 change lease 重新打开事务后重试',
      });
    }
    await this.leaseBinding.manager.assertOwned(this.leaseBinding.handle);
  }

  async write(record: ChangeRecord): Promise<void>;
  async write(record: ChangeRecord, precondition: ChangeWritePrecondition): Promise<void>;
  async write(record: ChangeRecord, precondition?: ChangeWritePrecondition): Promise<void> {
    await this.assertMutationLease();
    if (record.projectRootIdentity !== this.rootIdentity) throw new Error('change project identity mismatch');
    if (precondition === undefined) {
      throw new AuthoringOperationError('CHANGE_RECORD_CONFLICT', 'V2 record write 必须声明 expectedRecordVersion 与 expectedStatus');
    }
    const current = await this.read(record.changeId);
    if (current === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${record.changeId}`);
    if (current.recordVersion !== precondition.expectedRecordVersion
      || (precondition.expectedStatus !== undefined && current.status !== precondition.expectedStatus)
      || record.recordVersion !== current.recordVersion + 1) {
      throw conflict(record.changeId, precondition, current);
    }
    const recordPath = this.recordFile(record.changeId, record.recordVersion);
    let recordIdentity;
    try {
      recordIdentity = await createJsonRecord(recordPath, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // create-only record 已经落盘而 head 尚未发布，是进程在两个 commit-point
        // 步骤之间退出时的合法恢复窗口。只接管语义完全相同且身份有效的孤儿
        // record；任何不同内容仍 fail-loud，绝不覆盖既有 bytes。
        const existing = await readJsonRecord<ChangeRecord>(recordPath);
        // Compare the JSON value that createJsonRecord actually persists. Optional
        // properties explicitly set to undefined are omitted by JSON.stringify and
        // must not turn an otherwise identical crash-recovery record into a conflict.
        if (existing === null || stableStringify(existing.value) !== stableStringify(clone(record))) {
          throw conflict(record.changeId, precondition, current);
        }
        validateRecord(existing.value, record.changeId, this.rootIdentity, recordPath, {
          formatVersion: 2,
          recordVersion: record.recordVersion,
          recordSha256: existing.identity.sha256,
        });
        recordIdentity = existing.identity;
      } else {
        throw error;
      }
    }
    await replaceJsonRecord(this.headFile(record.changeId), {
      formatVersion: 2,
      recordVersion: record.recordVersion,
      recordSha256: recordIdentity.sha256,
    } satisfies RecordHead);
  }

  async writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void> {
    await this.assertMutationLease();
    await createJsonRecord(path.join(this.changeDirectory(changeId), 'evidence', `${safeId(evidenceId)}.json`), value);
  }

  async readEvidence(changeId: string, evidenceId: string): Promise<unknown | null> {
    const value = await readJsonRecord<unknown>(path.join(this.changeDirectory(changeId), 'evidence', `${safeId(evidenceId)}.json`));
    return value?.value ?? null;
  }

  async writeJournal(changeId: string, value: unknown): Promise<void> {
    await this.assertMutationLease();
    const journalDirectory = path.join(this.changeDirectory(changeId), 'journals');
    const journalPath = path.join(journalDirectory, 'pending-validation.json');
    const journal = validateJournal(value, changeId, journalPath);
    const latest = await this.readLatestJournal(changeId);
    const expectedVersion = latest === null ? 1 : latest.journalVersion + 1;
    if (journal.journalVersion !== expectedVersion) {
      throw journalCorrupt(`commit journal 版本不连续：期望 ${expectedVersion}，实际 ${journal.journalVersion}`, {
        path: journalDirectory,
        changeId,
        expectedVersion,
        actualVersion: journal.journalVersion,
      });
    }
    if (latest !== null) validateJournalContinuation(latest, journal, journalPath);
    await createJsonRecord(path.join(journalDirectory, versionFile(journal.journalVersion)), journal);
  }

  async readLatestJournal(changeId: string): Promise<CommitJournal | null> {
    const directory = path.join(this.changeDirectory(changeId), 'journals');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const candidates = entries.filter((entry) => entry.name.endsWith('.json'));
    if (candidates.length === 0) return null;
    const files = candidates.sort((left, right) => left.name.localeCompare(right.name));
    const journals: CommitJournal[] = [];
    for (const [index, entry] of files.entries()) {
      if (!entry.isFile() || !/^\d{10}\.json$/.test(entry.name)) {
        throw journalCorrupt(`commit journal 文件名无效：${entry.name}`, { path: path.join(directory, entry.name), changeId });
      }
      const expectedName = versionFile(index + 1);
      if (entry.name !== expectedName) {
        throw journalCorrupt(`commit journal 版本缺失或不连续：${entry.name}`, { path: path.join(directory, entry.name), changeId, expectedName });
      }
      const file = path.join(directory, entry.name);
      let value;
      try {
        value = await readJsonRecord<unknown>(file);
      } catch (error) {
        if (error instanceof AuthoringOperationError && error.code === 'CHANGE_STORE_CORRUPT') {
          throw journalCorrupt(`commit journal JSON 无法解析：${file}`, {
            path: file,
            changeId,
            cause: error.message,
          });
        }
        throw error;
      }
      if (value === null) throw journalCorrupt(`commit journal 文件缺失：${file}`, { path: file, changeId });
      const journal = validateJournal(value.value, changeId, file);
      if (journal.journalVersion !== index + 1) {
        throw journalCorrupt(`commit journal 文件名与内容版本不匹配：${file}`, {
          path: file,
          changeId,
          expectedVersion: index + 1,
          actualVersion: journal.journalVersion,
        });
      }
      if (journals.length > 0) {
        validateJournalContinuation(journals.at(-1)!, journal, file);
      }
      journals.push(journal);
    }
    return clone(journals.at(-1)!);
  }

  async writeDiff(changeId: string, value: unknown): Promise<void> {
    await this.assertMutationLease();
    await replaceJsonRecord(path.join(this.changeDirectory(changeId), 'diff.json'), value);
  }

  async writeTrace(changeId: string, traceId: string, value: unknown): Promise<void> {
    await this.assertMutationLease();
    await createJsonRecord(path.join(this.changeDirectory(changeId), 'traces', `${safeId(traceId)}.json`), value);
  }

  async readTrace(changeId: string, traceId: string): Promise<unknown | null> {
    const value = await readJsonRecord<unknown>(path.join(this.changeDirectory(changeId), 'traces', `${safeId(traceId)}.json`));
    return value?.value ?? null;
  }

  async writeInvocation(changeId: string, record: InvocationRecord): Promise<string> {
    await this.assertMutationLease();
    const directory = path.join(this.changeDirectory(changeId), 'invocations');
    await fs.mkdir(directory, { recursive: true });
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let nextSequence = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = /^(\d+)-[^/]+\.json$/.exec(entry.name);
      if (match !== null) nextSequence = Math.max(nextSequence, Number(match[1]));
    }
    const file = path.join(directory, `${String(nextSequence + 1).padStart(8, '0')}-${record.invocationId}-${crypto.randomUUID()}.json`);
    await createJsonRecord(file, record);
    return record.invocationId;
  }

  async readInvocations(changeId: string): Promise<InvocationRecord[]> {
    const directory = path.join(this.changeDirectory(changeId), 'invocations');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).sort((left, right) => left.name.localeCompare(right.name));
    const records: InvocationRecord[] = [];
    for (const file of files) {
      const value = await readJsonRecord<InvocationRecord>(path.join(directory, file.name));
      if (value !== null) records.push(value.value);
    }
    return records;
  }

  async readAllEvidence(changeId: string): Promise<unknown[]> {
    const directory = path.join(this.changeDirectory(changeId), 'evidence');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).sort((left, right) => left.name.localeCompare(right.name));
    const values: unknown[] = [];
    for (const file of files) {
      const value = await readJsonRecord<unknown>(path.join(directory, file.name));
      if (value !== null) values.push(value.value);
    }
    return values;
  }

  async readDiff(changeId: string): Promise<unknown | null> {
    const value = await readJsonRecord<unknown>(path.join(this.changeDirectory(changeId), 'diff.json'));
    return value?.value ?? null;
  }

  async writeCapsulePayload(changeId: string, capsuleId: string, payload: unknown): Promise<ArtifactIdentity> {
    await this.assertMutationLease();
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
      || Object.prototype.hasOwnProperty.call(payload, 'artifactIdentity')) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'delivery capsule payload 不得包含 artifactIdentity');
    }
    const capsuleDirectory = path.join(this.changeDirectory(changeId), 'capsules', safeId(capsuleId));
    const payloadPath = path.join(capsuleDirectory, 'payload.json');
    // create-only：随机 capsuleId 理论碰撞时 fail-loud，绝不覆盖已封存 artifact。
    const artifactIdentity = await createJsonRecord(payloadPath, payload);
    await replaceJsonRecord(path.join(capsuleDirectory, 'identity.json'), artifactIdentity);
    return artifactIdentity;
  }

  async readCapsulePayload(
    changeId: string,
    capsuleId: string,
    expectedSha256: string,
  ): Promise<{ payload: unknown; identity: ArtifactIdentity }> {
    assertCanonicalArtifactId(changeId, 'changeId');
    assertCanonicalArtifactId(capsuleId, 'capsuleId');
    if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
      throw new AuthoringOperationError('INVALID_REQUEST', `artifactSha256 必须是 64 位小写十六进制：${changeId}/${capsuleId}`);
    }
    // 派生路径必须落在当前 project namespace 内；非法 ID 已在上方拒绝，不做静默替换。
    const capsuleDirectory = path.join(this.changeDirectory(changeId), 'capsules', safeId(capsuleId));
    const payloadPath = path.join(capsuleDirectory, 'payload.json');
    const loaded = await readJsonRecord<unknown>(payloadPath);
    if (loaded === null) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `delivery capsule 不存在：${changeId}/${capsuleId}`, {
        changeId,
        capsuleId,
      });
    }
    const sidecar = await readJsonRecord<ArtifactIdentity>(path.join(capsuleDirectory, 'identity.json'));
    if (sidecar === null) {
      throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `delivery capsule 缺少 identity sidecar：${changeId}/${capsuleId}`);
    }
    if (typeof sidecar.value !== 'object' || sidecar.value === null || Array.isArray(sidecar.value)
      || typeof sidecar.value.path !== 'string') {
      throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `delivery capsule identity sidecar 格式无效：${changeId}/${capsuleId}`);
    }
    const sameWindowsPath = (left: string, right: string): boolean => (
      process.platform === 'win32'
        ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
        : path.normalize(left) === path.normalize(right)
    );
    if (!sameWindowsPath(sidecar.value.path, payloadPath)
      || sidecar.value.bytes !== loaded.identity.bytes
      || sidecar.value.sha256 !== loaded.identity.sha256
      || loaded.identity.sha256 !== expectedSha256) {
      throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `delivery capsule 身份不成立：${changeId}/${capsuleId}`, {
        changeId,
        capsuleId,
        expectedSha256,
        actualSha256: loaded.identity.sha256,
        identityPath: sidecar.value.path,
      });
    }
    return { payload: loaded.value, identity: sidecar.value };
  }
}

/** capsule/plan 外部引用的规范 artifact ID：只允许安全字符，先校验后拼路径，杜绝别名碰撞。 */
export function assertCanonicalArtifactId(value: string, field: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuthoringOperationError('INVALID_REQUEST', `${field} 含有非法字符：${value}`);
  }
}
