import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isValidSceneId } from '@surdet/core';
import { assertTextCatalogTargetRemovable, parseProjectConfigDocument, applyConfigReferenceRename, validateLabelRenameBatch, isValidLabelName, sceneReferenceConfigPaths as sceneConfigPaths, sceneDirectorySegments, stableStringify } from '@surdet/authoring';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from '../authoring/node-json-record.js';
import { syncFileAndParent, syncParentDirectories } from '../authoring/node-durable-file.js';
import { assertAssetImportDataNamespace, assertAssetImportProjectRootIdentity } from './filesystem.js';
import { AssetProjectMutationCoordinator } from './mutation-coordinator.js';
import {
  AssetImportAuthorityError,
  type AssetImportAuthorityPaths,
  type AssetRelocationFileEvidence,
  type SceneLifecycleCommitRequest,
  type SceneLifecycleCommitResponse,
  type SceneLifecyclePlanRequest,
  type SceneLifecyclePlanResponse,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function normalizeConfigRenames(value: unknown): Array<{ from: string; to: string; labelScene?: string }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new AssetImportAuthorityError('INVALID_REQUEST', '配置改名映射格式无效');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => key !== 'from' && key !== 'to' && key !== 'labelScene')
      || (item.labelScene === undefined ? !isValidSceneId(item.from) || !isValidSceneId(item.to) || item.from.toLowerCase() === item.to.toLowerCase()
        : !isValidSceneId(item.labelScene) || !isValidLabelName(item.from) || !isValidLabelName(item.to) || item.from === item.to)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '配置改名映射格式无效');
    }
    return { from: item.from as string, to: item.to as string, ...(item.labelScene === undefined ? {} : { labelScene: item.labelScene as string }) };
  });
}

interface ScenePlanRecord {
  schemaVersion: 1;
  projectIdentity: string;
  request: {
    operationId: string;
    kind: 'rename' | 'delete';
    sourcePath: string;
    targetPath: string | null;
  };
  source: AssetRelocationFileEvidence;
  planFingerprint: string;
  status: 'PLANNED' | 'COMMITTED' | 'CANCELLED';
  updatedAt: string;
  commitRequestId?: string;
  commitFingerprint?: string;
}

interface SceneCommitWriteRecord {
  path: string;
  text: string;
  expectedSha256: string | null;
  targetSha256: string;
  baseline: AssetRelocationFileEvidence | null;
  stageFileName: string | null;
  stageIdentity: AssetRelocationFileEvidence | null;
}

interface SceneCommitDeleteRecord {
  operationId: string;
  sourcePath: string;
  source: AssetRelocationFileEvidence;
}

interface SceneCommitRecord {
  schemaVersion: 1;
  projectIdentity: string;
  requestId: string;
  commitFingerprint: string;
  plans: Array<{ operationId: string; planFingerprint: string }>;
  configRenames?: Array<{ from: string; to: string; labelScene?: string }>;
  writes: SceneCommitWriteRecord[];
  deletes: SceneCommitDeleteRecord[];
  status: 'PREPARING' | 'PREPARED' | 'COMMITTED' | 'ROLLED_BACK' | 'RECOVERY_REQUIRED';
  updatedAt: string;
}

interface FileEvidence {
  identity: Omit<AssetRelocationFileEvidence, 'sha256'>;
  sha256: string;
}

export interface SceneLifecycleAuthorityOptions {
  assertLeaseHeld: () => void | Promise<void>;
  mutationCoordinator?: AssetProjectMutationCoordinator;
  faultInjector?: (point: SceneLifecycleFaultPoint) => void | Promise<void>;
  now?: () => Date;
  onRecovered?: (requestId: string, changedPaths: string[]) => Promise<void>;
  /** Image import must not recover unrelated scene writes as a readiness side effect. */
  recoverOnReadinessCheck?: boolean;
}

export type SceneLifecycleFaultPoint =
  | 'after_first_stage_before_record'
  | 'before_first_publish'
  | 'after_first_publish'
  | 'after_committed_record';

export class SceneLifecycleInjectedTermination extends Error {
  constructor(readonly point: SceneLifecycleFaultPoint) {
    super(`Injected scene lifecycle termination at ${point}`);
    this.name = 'SceneLifecycleInjectedTermination';
  }
}

function portableFold(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase();
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 必须是小写 UUID`, { field });
  }
  return value;
}

function normalizeScenePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_024
    || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 格式无效`, { field });
  }
  const normalized = value.normalize('NFC');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    || path.posix.normalize(normalized) !== normalized
    || !normalized.startsWith('content/scenario/')
    || !normalized.toLowerCase().endsWith('.gal')) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 必须是 content/scenario 下的 .gal 文件`, { field });
  }
  return normalized;
}

function normalizePlanRequest(input: SceneLifecyclePlanRequest): ScenePlanRecord['request'] {
  const operationId = requireUuid(input.operationId, 'operationId');
  if (input.kind !== 'rename' && input.kind !== 'delete') {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '场景操作类型无效', { field: 'kind' });
  }
  const sourcePath = normalizeScenePath(input.sourcePath, 'sourcePath');
  const targetPath = input.kind === 'rename' ? normalizeScenePath(input.targetPath, 'targetPath') : null;
  if (input.kind === 'delete' && input.targetPath !== undefined) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '删除场景不能包含 targetPath', { field: 'targetPath' });
  }
  if (targetPath !== null) {
    if (portableFold(sourcePath) === portableFold(targetPath)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '场景重命名目标必须使用不同路径');
    }
    if (portableFold(path.posix.dirname(sourcePath)) !== portableFold(path.posix.dirname(targetPath))) {
      if (path.posix.basename(sourcePath) !== path.posix.basename(targetPath)) {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '章节移动不能同时改文件名');
      }
      try { sceneDirectorySegments(path.posix.dirname(targetPath).replace(/^content\/scenario\/?/, '')); }
      catch { throw new AssetImportAuthorityError('INVALID_REQUEST', '章节目标目录无效'); }
    }
  }
  return { operationId, kind: input.kind, sourcePath, targetPath };
}

function normalizeWritePath(value: unknown, field: string): string {
  if (typeof value === 'string' && sceneConfigPaths.includes(value)) return value;
  const normalized = normalizeScenePath(value, field);
  try { sceneDirectorySegments(path.posix.dirname(normalized).replace(/^content\/scenario\/?/, '')); }
  catch { throw new AssetImportAuthorityError('INVALID_REQUEST', '章节目标目录无效', { field }); }
  return normalized;
}

function sameNodeIdentity(
  left: Omit<AssetRelocationFileEvidence, 'sha256'>,
  right: Omit<AssetRelocationFileEvidence, 'sha256'>,
): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs;
}

function sameFileIdentity(
  left: Omit<AssetRelocationFileEvidence, 'sha256'>,
  right: Omit<AssetRelocationFileEvidence, 'sha256'>,
): boolean {
  return sameNodeIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function publicEvidence(evidence: FileEvidence): AssetRelocationFileEvidence {
  return { ...evidence.identity, sha256: evidence.sha256 };
}

function privateEvidence(evidence: AssetRelocationFileEvidence): FileEvidence {
  const { sha256, ...identity } = evidence;
  return { identity, sha256 };
}

async function safeParent(
  paths: AssetImportAuthorityPaths,
  relativePath: string,
  options: { allowMissing?: boolean; createMissing?: boolean } = {},
): Promise<{ parent: string; fileName: string; absolutePath: string; missing?: boolean }> {
  await assertAssetImportProjectRootIdentity(paths);
  const segments = relativePath.split('/');
  const fileName = segments.pop()!;
  let current = paths.projectRoot;
  for (const [index, segment] of segments.entries()) {
    let entries = await fs.readdir(current, { withFileTypes: true });
    let matches = entries.filter((entry) => portableFold(entry.name) === portableFold(segment));
    if (matches.length === 0 && options.createMissing) {
      try { await fs.mkdir(path.join(current, segment)); await syncParentDirectories(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      entries = await fs.readdir(current, { withFileTypes: true });
      matches = entries.filter((entry) => portableFold(entry.name) === portableFold(segment));
    }
    if (matches.length === 0 && options.allowMissing) {
      const parent = path.join(current, ...segments.slice(index));
      return { parent, fileName, absolutePath: path.join(parent, fileName), missing: true };
    }
    if (matches.length !== 1 || matches[0]!.name !== segment
      || !matches[0]!.isDirectory() || matches[0]!.isSymbolicLink()) {
      throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `场景目录身份不安全：${relativePath}`);
    }
    current = path.join(current, segment);
    if (await fs.realpath(current) !== current) {
      throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `场景目录发生了重定向：${relativePath}`);
    }
  }
  return { parent: current, fileName, absolutePath: path.join(current, fileName) };
}

async function stableFileEvidence(file: string): Promise<FileEvidence> {
  const pathBefore = await fs.lstat(file, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', '场景路径不是安全的普通文件');
  }
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== pathBefore.dev || before.ino !== pathBefore.ino) {
      throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '场景打开身份与路径不一致');
    }
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const read = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - position), position);
      if (read.bytesRead <= 0) throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '场景读取不完整');
      digest.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(file, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || pathAfter.dev !== after.dev || pathAfter.ino !== after.ino
      || pathAfter.size !== after.size || pathAfter.mtimeNs !== after.mtimeNs) {
      throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '场景读取期间发生变化');
    }
    return {
      identity: {
        device: String(after.dev),
        inode: String(after.ino),
        birthtimeNs: String(after.birthtimeNs),
        size: Number(after.size),
        mtimeNs: String(after.mtimeNs),
      },
      sha256: digest.digest('hex'),
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function fileEvidence(
  paths: AssetImportAuthorityPaths,
  relativePath: string,
): Promise<FileEvidence | null> {
  const target = await safeParent(paths, relativePath, { allowMissing: true });
  if (target.missing) return null;
  const entries = await fs.readdir(target.parent, { withFileTypes: true });
  const matches = entries.filter((entry) => portableFold(entry.name) === portableFold(target.fileName));
  if (matches.length === 0) return null;
  if (matches.length !== 1 || matches[0]!.name !== target.fileName
    || !matches[0]!.isFile() || matches[0]!.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `场景文件身份不安全：${relativePath}`);
  }
  return stableFileEvidence(target.absolutePath);
}

async function writeStage(file: string, text: string): Promise<FileEvidence> {
  const bytes = Buffer.from(text, 'utf8');
  const expectedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncParentDirectories(path.dirname(file));
  const actual = await stableFileEvidence(file);
  if (actual.sha256 !== expectedSha256) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景暂存内容回读不一致');
  }
  return actual;
}

async function pathExists(file: string): Promise<boolean> {
  return fs.lstat(file).then(() => true).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  });
}

function sameEvidence(left: FileEvidence, right: FileEvidence): boolean {
  return left.sha256 === right.sha256 && sameFileIdentity(left.identity, right.identity);
}

async function removeOwnedFile(file: string, expected: FileEvidence): Promise<boolean> {
  const quarantine = path.join(path.dirname(file), `.${path.basename(file)}.surdet-removing`);
  let current = await stableFileEvidence(file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  const quarantineExists = await pathExists(quarantine);
  if (quarantineExists) {
    const interrupted = await stableFileEvidence(quarantine).catch(() => null);
    if (interrupted === null || !sameEvidence(interrupted, expected)) return false;
    if (current !== null) {
      if (!sameEvidence(current, expected) || !sameNodeIdentity(current.identity, interrupted.identity)) return false;
      await fs.unlink(file);
      await syncParentDirectories(path.dirname(file));
      current = null;
    }
    const finalQuarantine = await stableFileEvidence(quarantine).catch(() => null);
    if (finalQuarantine === null || !sameEvidence(finalQuarantine, expected)) return false;
    await fs.unlink(quarantine);
    await syncParentDirectories(path.dirname(file));
    return true;
  }
  if (current === null) return true;
  if (!sameEvidence(current, expected)) return false;
  try {
    await fs.link(file, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  await syncFileAndParent(quarantine);
  const moved = await stableFileEvidence(quarantine).catch(() => null);
  const beforeUnlink = await stableFileEvidence(file).catch(() => null);
  if (moved === null || beforeUnlink === null || !sameEvidence(moved, expected)
    || !sameEvidence(beforeUnlink, expected) || !sameNodeIdentity(moved.identity, beforeUnlink.identity)) return false;
  await fs.unlink(file);
  await syncParentDirectories(path.dirname(file));
  const finalQuarantine = await stableFileEvidence(quarantine).catch(() => null);
  if (finalQuarantine === null || !sameEvidence(finalQuarantine, expected)) return false;
  await fs.unlink(quarantine);
  await syncParentDirectories(path.dirname(file));
  return true;
}

async function moveOwnedFile(source: string, target: string, expected: FileEvidence): Promise<FileEvidence> {
  let moved = await pathExists(target) ? await stableFileEvidence(target).catch(() => null) : null;
  if (moved === null) {
    try {
      await fs.link(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保留路径已被占用');
      }
      throw error;
    }
    await syncFileAndParent(target);
    moved = await stableFileEvidence(target).catch(() => null);
  }
  if (moved === null || !sameEvidence(moved, expected)) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保留路径身份不一致');
  }
  const currentSource = await stableFileEvidence(source).catch(() => null);
  if (currentSource !== null && (!sameEvidence(currentSource, expected)
    || !sameNodeIdentity(currentSource.identity, moved.identity))) {
    throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '场景文件在移动窗口被外部替换');
  }
  if (!await removeOwnedFile(source, expected) && await pathExists(source)) {
    throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '场景文件在移动窗口被外部替换');
  }
  return moved;
}

function validEvidence(value: unknown): value is AssetRelocationFileEvidence {
  const evidence = value as Partial<AssetRelocationFileEvidence> | null;
  return evidence !== null && typeof evidence === 'object'
    && typeof evidence.device === 'string'
    && typeof evidence.inode === 'string'
    && typeof evidence.birthtimeNs === 'string'
    && Number.isSafeInteger(evidence.size)
    && typeof evidence.mtimeNs === 'string'
    && typeof evidence.sha256 === 'string' && SHA256.test(evidence.sha256);
}

function commitSemantic(record: Pick<SceneCommitRecord, 'requestId' | 'plans' | 'writes' | 'configRenames'>): unknown {
  return {
    requestId: record.requestId,
    plans: record.plans,
    ...(record.configRenames === undefined ? {} : { configRenames: record.configRenames }),
    writes: record.writes.map(({ path: file, text, expectedSha256 }) => ({
      path: file,
      text,
      expectedSha256,
    })),
  };
}

function commitResponse(record: SceneCommitRecord): SceneLifecycleCommitResponse {
  return {
    requestId: record.requestId,
    status: 'COMMITTED',
    writes: record.writes.map((write) => ({ path: write.path, sha256: write.targetSha256 })),
    deletedPaths: record.deletes.map((deletion) => deletion.sourcePath),
  };
}

function planSemantic(
  projectIdentity: string,
  request: ScenePlanRecord['request'],
  source: AssetRelocationFileEvidence,
): unknown {
  return { schemaVersion: 1, projectIdentity, request, source };
}

function planResponse(record: ScenePlanRecord): SceneLifecyclePlanResponse {
  return {
    operationId: record.request.operationId,
    kind: record.request.kind,
    sourcePath: record.request.sourcePath,
    targetPath: record.request.targetPath,
    planFingerprint: record.planFingerprint,
    status: record.status,
  };
}

export class ProjectSceneLifecycleAuthority {
  private readonly assertLeaseHeld: () => void | Promise<void>;
  private readonly mutationCoordinator: AssetProjectMutationCoordinator;
  private readonly faultInjector?: SceneLifecycleAuthorityOptions['faultInjector'];
  private readonly now: () => Date;
  private readonly onRecovered?: SceneLifecycleAuthorityOptions['onRecovered'];

  constructor(readonly paths: AssetImportAuthorityPaths, options: SceneLifecycleAuthorityOptions) {
    this.assertLeaseHeld = options.assertLeaseHeld;
    this.mutationCoordinator = options.mutationCoordinator ?? new AssetProjectMutationCoordinator();
    this.faultInjector = options.faultInjector;
    this.now = options.now ?? (() => new Date());
    this.onRecovered = options.onRecovered;
    this.mutationCoordinator.register('scene-lifecycle', async () => {
      await this.assertLeaseHeld();
      await assertAssetImportProjectRootIdentity(this.paths);
      if (options.recoverOnReadinessCheck !== false) {
        await this.recoverPendingCommitsInternal();
        return;
      }
      for (const requestId of await this.commitIds()) {
        const record = await this.readCommit(requestId);
        if (record !== null && record.status !== 'COMMITTED' && record.status !== 'ROLLED_BACK') {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保存尚未完成；请先通过场景保存服务恢复，图像导入不会代为修改剧情。', {
            authority: 'scene-lifecycle', requestId,
          });
        }
      }
    });
  }

  private async fault(point: SceneLifecycleFaultPoint): Promise<void> {
    await this.faultInjector?.(point);
  }

  private recordPath(operationId: string): string {
    return path.join(this.paths.projectNamespace, 'scene-plans', `${operationId}.json`);
  }

  private commitPath(requestId: string): string {
    return path.join(this.paths.projectNamespace, 'scene-commits', `${requestId}.json`);
  }

  private createStageFileName(requestId: string, index: number): string {
    return `.surdet-scene-${requestId}-${String(index).padStart(4, '0')}-${crypto.randomUUID()}.tmp`;
  }

  private stagePath(parent: string, stageFileName: string): string {
    return path.join(parent, stageFileName);
  }

  private displacedPath(requestId: string, index: number, parent: string): string {
    return path.join(parent, `.surdet-scene-${requestId}-${String(index).padStart(4, '0')}.previous`);
  }

  private quarantinePath(requestId: string, index: number, parent: string): string {
    return path.join(parent, `.surdet-scene-${requestId}-delete-${String(index).padStart(4, '0')}.previous`);
  }

  private async read(operationId: string): Promise<ScenePlanRecord | null> {
    await assertAssetImportDataNamespace(this.paths);
    const loaded = await readJsonRecord<ScenePlanRecord>(this.recordPath(operationId));
    if (loaded === null) return null;
    const record = loaded.value;
    try {
      const request = normalizePlanRequest(record.request.targetPath === null
        ? {
          operationId: record.request.operationId,
          kind: record.request.kind,
          sourcePath: record.request.sourcePath,
        }
        : {
          operationId: record.request.operationId,
          kind: record.request.kind,
          sourcePath: record.request.sourcePath,
          targetPath: record.request.targetPath,
        });
      const source = record.source;
      const validSource = source !== null && typeof source === 'object'
        && typeof source.device === 'string' && typeof source.inode === 'string'
        && typeof source.birthtimeNs === 'string' && Number.isSafeInteger(source.size)
        && typeof source.mtimeNs === 'string' && SHA256.test(source.sha256);
      const expectedFingerprint = crypto.createHash('sha256')
        .update(stableStringify(planSemantic(record.projectIdentity, request, source)), 'utf8').digest('hex');
      if (record.schemaVersion !== 1 || record.projectIdentity !== this.paths.projectIdentity
        || request.operationId !== operationId || !validSource
        || !['PLANNED', 'COMMITTED', 'CANCELLED'].includes(record.status)
        || record.planFingerprint !== expectedFingerprint || typeof record.updatedAt !== 'string') {
        throw new Error('invalid scene plan');
      }
      if (record.status === 'COMMITTED'
        && (!record.commitRequestId || !UUID.test(record.commitRequestId)
          || !record.commitFingerprint || !SHA256.test(record.commitFingerprint))) {
        throw new Error('invalid scene commit identity');
      }
      return record;
    } catch {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保存计划无法安全读取', { operationId });
    }
  }

  private async readCommit(requestIdInput: string): Promise<SceneCommitRecord | null> {
    const requestId = requireUuid(requestIdInput, 'requestId');
    await assertAssetImportDataNamespace(this.paths);
    const loaded = await readJsonRecord<SceneCommitRecord>(this.commitPath(requestId));
    if (loaded === null) return null;
    const record = loaded.value;
    try {
      if (record.schemaVersion !== 1 || record.projectIdentity !== this.paths.projectIdentity
        || record.requestId !== requestId
        || !Array.isArray(record.plans) || record.plans.length > 100
        || !Array.isArray(record.writes) || record.writes.length > 512
        || !Array.isArray(record.deletes) || record.deletes.length !== record.plans.length
        || !['PREPARING', 'PREPARED', 'COMMITTED', 'ROLLED_BACK', 'RECOVERY_REQUIRED'].includes(record.status)
        || typeof record.updatedAt !== 'string') {
        throw new Error('invalid scene commit');
      }
      const planIds = new Set<string>();
      if (record.configRenames !== undefined) normalizeConfigRenames(record.configRenames);
      for (const plan of record.plans) {
        if (!UUID.test(plan.operationId) || !SHA256.test(plan.planFingerprint) || planIds.has(plan.operationId)) {
          throw new Error('invalid scene commit plans');
        }
        planIds.add(plan.operationId);
      }
      const writePaths = new Set<string>();
      for (const [index, write] of record.writes.entries()) {
        const normalizedPath = normalizeWritePath(write.path, 'writes.path');
        const folded = portableFold(normalizedPath);
        const stagePrefix = `.surdet-scene-${requestId}-${String(index).padStart(4, '0')}-`;
        const stageUuid = typeof write.stageFileName === 'string'
          && write.stageFileName.startsWith(stagePrefix) && write.stageFileName.endsWith('.tmp')
          ? write.stageFileName.slice(stagePrefix.length, -4)
          : null;
        if (write.path !== normalizedPath || writePaths.has(folded) || typeof write.text !== 'string'
          || write.expectedSha256 !== null && !SHA256.test(write.expectedSha256)
          || !SHA256.test(write.targetSha256)
          || crypto.createHash('sha256').update(write.text, 'utf8').digest('hex') !== write.targetSha256
          || write.baseline !== null && !validEvidence(write.baseline)
          || write.stageFileName !== null && (stageUuid === null || !UUID.test(stageUuid))
          || write.stageIdentity !== null && !validEvidence(write.stageIdentity)
          || (write.stageFileName === null) !== (write.stageIdentity === null)) {
          throw new Error('invalid scene commit writes');
        }
        writePaths.add(folded);
      }
      if ((record.status === 'PREPARED' || record.status === 'COMMITTED')
        && record.writes.some((write) => write.stageFileName === null || write.stageIdentity === null)) {
        throw new Error('prepared scene commit is missing staged identity');
      }
      const deleteIds = new Set<string>();
      for (const deletion of record.deletes) {
        const sourcePath = normalizeScenePath(deletion.sourcePath, 'deletes.sourcePath');
        if (!UUID.test(deletion.operationId) || !planIds.has(deletion.operationId)
          || deleteIds.has(deletion.operationId) || sourcePath !== deletion.sourcePath
          || !validEvidence(deletion.source)) {
          throw new Error('invalid scene commit deletes');
        }
        deleteIds.add(deletion.operationId);
      }
      const expectedFingerprint = crypto.createHash('sha256')
        .update(stableStringify(commitSemantic(record)), 'utf8').digest('hex');
      if (record.commitFingerprint !== expectedFingerprint) throw new Error('invalid scene commit fingerprint');
      return record;
    } catch (error) {
      if (error instanceof AssetImportAuthorityError && error.code === 'INVALID_REQUEST') {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景提交记录包含不安全路径', { requestId });
      }
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景提交记录无法安全读取', { requestId });
    }
  }

  private async replaceCommit(
    record: SceneCommitRecord,
    patch: Partial<Pick<SceneCommitRecord, 'writes' | 'status'>>,
  ): Promise<SceneCommitRecord> {
    const next: SceneCommitRecord = {
      ...record,
      ...patch,
      updatedAt: this.now().toISOString(),
    };
    await replaceJsonRecord(this.commitPath(record.requestId), next);
    return next;
  }

  private async commitIds(): Promise<string[]> {
    await assertAssetImportDataNamespace(this.paths);
    const directory = path.join(this.paths.projectNamespace, 'scene-commits');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      const id = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
      if (!entry.isFile() || entry.isSymbolicLink() || !UUID.test(id)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景提交目录包含未知内容');
      }
      ids.push(id);
    }
    return ids.sort();
  }

  private async removeStoredFile(
    file: string,
    evidence: AssetRelocationFileEvidence,
    message: string,
    missingIsAlreadyRemoved = false,
  ): Promise<void> {
    if (!await removeOwnedFile(file, privateEvidence(evidence))
      && !(missingIsAlreadyRemoved && !await pathExists(file))) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', message);
    }
  }

  private async restoreIncompleteCommit(recordInput: SceneCommitRecord): Promise<SceneCommitRecord> {
    let record = recordInput;
    const changedPaths = new Set<string>();
    try {
      for (let index = record.deletes.length - 1; index >= 0; index -= 1) {
        const deletion = record.deletes[index]!;
        const source = await safeParent(this.paths, deletion.sourcePath);
        const quarantine = this.quarantinePath(record.requestId, index, source.parent);
        if (await pathExists(quarantine)) {
          const evidence = await stableFileEvidence(quarantine);
          const currentSource = await fileEvidence(this.paths, deletion.sourcePath);
          if (!sameEvidence(evidence, privateEvidence(deletion.source))) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景删除恢复现场包含外部文件');
          }
          if (currentSource === null) {
            await moveOwnedFile(quarantine, source.absolutePath, privateEvidence(deletion.source));
            changedPaths.add(deletion.sourcePath);
          } else if (sameEvidence(currentSource, privateEvidence(deletion.source))
            && sameNodeIdentity(currentSource.identity, evidence.identity)) {
            await this.removeStoredFile(quarantine, deletion.source, '场景删除恢复保留文件身份发生变化');
          } else {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景删除恢复现场包含外部文件');
          }
        } else {
          const current = await fileEvidence(this.paths, deletion.sourcePath);
          if (current === null || !sameEvidence(current, privateEvidence(deletion.source))) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景删除恢复缺少可信源文件');
          }
        }
      }

      for (let index = record.writes.length - 1; index >= 0; index -= 1) {
        const write = record.writes[index]!;
        const target = await safeParent(this.paths, write.path, { allowMissing: true });
        if (target.missing && write.baseline === null) continue;
        const stage = write.stageFileName === null ? null : this.stagePath(target.parent, write.stageFileName);
        const displaced = this.displacedPath(record.requestId, index, target.parent);
        const stageEvidence = write.stageIdentity === null ? null : privateEvidence(write.stageIdentity);
        const baseline = write.baseline === null ? null : privateEvidence(write.baseline);
        let current = await fileEvidence(this.paths, write.path);
        if (current !== null && stageEvidence !== null
          && current.sha256 === stageEvidence.sha256
          && sameNodeIdentity(current.identity, stageEvidence.identity)) {
          await this.removeStoredFile(target.absolutePath, publicEvidence(current), '场景回退目标身份发生变化');
          changedPaths.add(write.path);
          current = null;
        }
        const displacedExists = await pathExists(displaced);
        if (displacedExists) {
          if (baseline === null) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景回退保留路径状态冲突');
          }
          const displacedEvidence = await stableFileEvidence(displaced);
          if (!sameEvidence(displacedEvidence, baseline)) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景回退保留文件身份不一致');
          }
          if (current === null) {
            current = await moveOwnedFile(displaced, target.absolutePath, baseline);
            changedPaths.add(write.path);
          } else if (sameEvidence(current, baseline)
            && sameNodeIdentity(current.identity, displacedEvidence.identity)) {
            await this.removeStoredFile(displaced, publicEvidence(displacedEvidence), '场景回退保留文件身份发生变化');
          } else {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景回退保留路径状态冲突');
          }
        }
        if (baseline === null) {
          if (current !== null) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景回退目标被外部占用');
        } else if (current === null || !sameEvidence(current, baseline)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景回退无法恢复原文件');
        }
        if (stageEvidence === null) {
          // A crash may occur after exclusive stage creation but before its
          // random name and identity become durable. The unrecorded file is
          // never adopted or removed; a retry uses a fresh unguessable name.
        } else {
          await this.removeStoredFile(stage!, write.stageIdentity!, '场景暂存文件身份发生变化', true);
        }
      }
      record = await this.replaceCommit(record, { status: 'ROLLED_BACK' });
    } catch (error) {
      if (record.status !== 'RECOVERY_REQUIRED') {
        await this.replaceCommit(record, { status: 'RECOVERY_REQUIRED' }).catch(() => undefined);
      }
      if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_RECOVERY_REQUIRED') throw error;
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保存中断且无法安全回退');
    }
    if (changedPaths.size > 0) await this.onRecovered?.(record.requestId, [...changedPaths]);
    return record;
  }

  private async finalizeCommitted(record: SceneCommitRecord): Promise<void> {
    for (const reference of record.plans) {
      const plan = await this.read(reference.operationId);
      if (plan === null || plan.planFingerprint !== reference.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景提交对应的计划记录缺失');
      }
      if (plan.status === 'COMMITTED') {
        if (plan.commitRequestId !== record.requestId || plan.commitFingerprint !== record.commitFingerprint) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景计划与提交回执不一致');
        }
      } else if (plan.status === 'PLANNED') {
        await replaceJsonRecord(this.recordPath(plan.request.operationId), {
          ...plan,
          status: 'COMMITTED',
          updatedAt: this.now().toISOString(),
          commitRequestId: record.requestId,
          commitFingerprint: record.commitFingerprint,
        } satisfies ScenePlanRecord);
      } else {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景计划已进入冲突终态');
      }
    }
    for (const [index, write] of record.writes.entries()) {
      const target = await safeParent(this.paths, write.path);
      if (write.stageIdentity !== null) {
        await this.removeStoredFile(
          this.stagePath(target.parent, write.stageFileName!),
          write.stageIdentity,
          '场景提交暂存文件身份发生变化',
          true,
        );
      }
      if (write.baseline !== null) {
        await this.removeStoredFile(
          this.displacedPath(record.requestId, index, target.parent),
          write.baseline,
          '场景提交保留文件身份发生变化',
          true,
        );
      }
    }
    for (const [index, deletion] of record.deletes.entries()) {
      const source = await safeParent(this.paths, deletion.sourcePath);
      await this.removeStoredFile(
        this.quarantinePath(record.requestId, index, source.parent),
        deletion.source,
        '场景删除保留文件身份发生变化',
        true,
      );
    }
  }

  private async recoverCommit(record: SceneCommitRecord): Promise<SceneCommitRecord> {
    if (record.status === 'COMMITTED') {
      await this.finalizeCommitted(record);
      return record;
    }
    if (record.status === 'PREPARING' || record.status === 'PREPARED') {
      return this.restoreIncompleteCommit(record);
    }
    if (record.status === 'RECOVERY_REQUIRED') {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保存需要人工恢复');
    }
    return record;
  }

  private async recoverPendingCommitsInternal(): Promise<void> {
    for (const requestId of await this.commitIds()) {
      const record = await this.readCommit(requestId);
      if (record !== null) await this.recoverCommit(record);
    }
  }

  async recoverPending(): Promise<void> {
    await this.mutationCoordinator.run('scene-lifecycle', async () => {
      await this.assertLeaseHeld();
      await assertAssetImportProjectRootIdentity(this.paths);
      await this.recoverPendingCommitsInternal();
    });
  }

  async plan(input: SceneLifecyclePlanRequest): Promise<SceneLifecyclePlanResponse> {
    const request = normalizePlanRequest(input);
    return this.mutationCoordinator.run('scene-lifecycle', async () => {
      await this.assertLeaseHeld();
      await this.recoverPendingCommitsInternal();
      const existing = await this.read(request.operationId);
      if (existing !== null) {
        if (stableStringify(existing.request) !== stableStringify(request)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同场景操作');
        }
        return planResponse(existing);
      }
      const source = await fileEvidence(this.paths, request.sourcePath);
      if (source === null) throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '场景源文件已不存在');
      if (request.targetPath !== null && await fileEvidence(this.paths, request.targetPath) !== null) {
        throw new AssetImportAuthorityError('IMPORT_TARGET_EXISTS', '场景目标文件已存在');
      }
      const sourcePublic = publicEvidence(source);
      const semantic = planSemantic(this.paths.projectIdentity, request, sourcePublic);
      const record: ScenePlanRecord = {
        schemaVersion: 1,
        projectIdentity: this.paths.projectIdentity,
        request,
        source: sourcePublic,
        planFingerprint: crypto.createHash('sha256').update(stableStringify(semantic), 'utf8').digest('hex'),
        status: 'PLANNED',
        updatedAt: this.now().toISOString(),
      };
      try {
        await createJsonRecord(this.recordPath(request.operationId), record);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const concurrent = await this.read(request.operationId);
          if (concurrent !== null && stableStringify(concurrent.request) === stableStringify(request)) {
            return planResponse(concurrent);
          }
        }
        throw error;
      }
      return planResponse(record);
    });
  }

  async commit(input: SceneLifecycleCommitRequest): Promise<SceneLifecycleCommitResponse> {
    const requestId = requireUuid(input.requestId, 'requestId');
    if (!Array.isArray(input.plans) || input.plans.length > 100
      || !Array.isArray(input.writes) || input.writes.length > 512
      || input.plans.length === 0 && input.writes.length === 0) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '场景保存批次为空或过大');
    }
    const plans = input.plans.map((entry, index) => ({
      operationId: requireUuid(entry?.operationId, `plans[${index}].operationId`),
      planFingerprint: typeof entry?.planFingerprint === 'string' && SHA256.test(entry.planFingerprint)
        ? entry.planFingerprint
        : (() => { throw new AssetImportAuthorityError('INVALID_REQUEST', '场景计划指纹无效'); })(),
    }));
    const writes = input.writes.map((entry, index) => ({
      path: normalizeWritePath(entry?.path, `writes[${index}].path`),
      text: typeof entry?.text === 'string' ? entry.text
        : (() => { throw new AssetImportAuthorityError('INVALID_REQUEST', '场景正文格式无效'); })(),
      expectedSha256: entry?.expectedSha256 === null ? null
        : typeof entry?.expectedSha256 === 'string' && SHA256.test(entry.expectedSha256) ? entry.expectedSha256
          : (() => { throw new AssetImportAuthorityError('INVALID_REQUEST', '场景基线指纹无效'); })(),
    }));
    if (new Set(plans.map((entry) => entry.operationId)).size !== plans.length
      || new Set(writes.map((entry) => portableFold(entry.path))).size !== writes.length) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '场景保存批次包含重复路径或计划');
    }
    const configRenames = input.configRenames === undefined ? undefined : normalizeConfigRenames(input.configRenames);
    const normalizedCommit = { requestId, plans, writes, ...(configRenames === undefined ? {} : { configRenames }) };
    const commitFingerprint = crypto.createHash('sha256')
      .update(stableStringify(normalizedCommit), 'utf8').digest('hex');

    return this.mutationCoordinator.run('scene-lifecycle', async () => {
      await this.assertLeaseHeld();
      await assertAssetImportProjectRootIdentity(this.paths);
      await this.recoverPendingCommitsInternal();

      let existingCommit = await this.readCommit(requestId);
      if (existingCommit !== null && existingCommit.status !== 'ROLLED_BACK'
        && existingCommit.commitFingerprint !== commitFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'requestId 已用于不同场景保存请求');
      }
      if (existingCommit?.status === 'COMMITTED') {
        await this.finalizeCommitted(existingCommit);
        return commitResponse(existingCommit);
      }
      if (existingCommit?.status === 'RECOVERY_REQUIRED') {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保存需要人工恢复');
      }

      const records: ScenePlanRecord[] = [];
      for (const reference of plans) {
        const record = await this.read(reference.operationId);
        if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '场景保存计划不存在');
        if (record.planFingerprint !== reference.planFingerprint) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '场景保存计划已变化或已经结束');
        }
        records.push(record);
      }
      if (records.length > 0 && records.every((record) => record.status === 'COMMITTED')) {
        if (records.some((record) => record.commitRequestId !== requestId
          || record.commitFingerprint !== commitFingerprint)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '已提交的场景保存请求与本次请求不同');
        }
        return {
          requestId,
          status: 'COMMITTED',
          writes: writes.map((write) => ({
            path: write.path,
            sha256: crypto.createHash('sha256').update(write.text, 'utf8').digest('hex'),
          })),
          deletedPaths: records.map((record) => record.request.sourcePath),
        };
      }
      if (records.some((record) => record.status !== 'PLANNED')) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '场景保存计划状态不一致');
      }
      const writeByPath = new Map(writes.map((entry) => [portableFold(entry.path), entry]));
      const sourcePaths = new Set(records.map((record) => portableFold(record.request.sourcePath)));
      for (const record of records) {
        if (record.request.kind === 'rename') {
          const target = writeByPath.get(portableFold(record.request.targetPath!));
          if (target === undefined || target.expectedSha256 !== null) {
            throw new AssetImportAuthorityError('INVALID_REQUEST', '重命名目标必须作为独占创建写入');
          }
        }
      }
      if (writes.some((write) => sourcePaths.has(portableFold(write.path)))) {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '待删除源路径不能同时写入');
      }

      const deletions = records.filter(record => record.request.kind === 'delete');
      if (deletions.length > 0) {
        // Plans pin scene bytes, not the catalog: check the current source again before publishing.
        const configPath = 'game.config.json';
        const config = parseProjectConfigDocument(await fileEvidence(this.paths, configPath)
          ? await fs.readFile((await safeParent(this.paths, configPath)).absolutePath, 'utf8') : '{}');
        try {
          for (const record of deletions) assertTextCatalogTargetRemovable(config, path.posix.basename(record.request.sourcePath).slice(0, -4));
        } catch (error) {
          throw new AssetImportAuthorityError('INVALID_REQUEST', error instanceof Error ? error.message : String(error));
        }
      }

      if (configRenames !== undefined) {
        const labelEdits = configRenames.filter(rename => rename.labelScene !== undefined);
        if (labelEdits.length > 0 && (labelEdits.length !== configRenames.length || records.length > 0)) throw new AssetImportAuthorityError('INVALID_REQUEST', '请分别保存标签改名和场景路径变更');
        const existingScenes = (await (await NodeProjectStorage.open(this.paths.projectRoot)).listFiles())
          .filter(file => file.startsWith('content/scenario/') && /\.gal$/i.test(file)).sort();
        const id = (file: string) => path.posix.basename(file).slice(0, -4);
        if (labelEdits.length > 0) {
          const sourceFiles: Record<string, string> = {};
          for (const file of existingScenes) sourceFiles[file] = await fs.readFile((await safeParent(this.paths, file)).absolutePath, 'utf8');
          const sceneWrites = Object.fromEntries(writes.filter(write => write.path.startsWith('content/scenario/')).map(write => [write.path, write.text]));
          try { validateLabelRenameBatch(sourceFiles, sceneWrites, labelEdits); }
          catch (error) { throw new AssetImportAuthorityError('INVALID_REQUEST', `标签改名结果无效：${error instanceof Error ? error.message : String(error)}`); }
        }
        for (const [index, rename] of configRenames.entries()) {
          if (rename.labelScene !== undefined) continue;
          const original = existingScenes.filter(file => id(file) === rename.from);
          if (original.length > 1 || (original.length === 1 && !records.some(record => record.request.sourcePath === original[0]
            && record.request.kind === 'rename' && id(record.request.targetPath!) === rename.to))) {
            throw new AssetImportAuthorityError('INVALID_REQUEST', '配置改名必须对应本批场景改名，不能替换其他场景的引用');
          }
          let finalId = rename.to;
          for (const later of configRenames.slice(index + 1)) if (later.from === finalId) finalId = later.to;
          if (!writes.some(write => write.path.startsWith('content/scenario/') && id(write.path) === finalId)) {
            throw new AssetImportAuthorityError('INVALID_REQUEST', '配置改名的目标必须在同批场景写入中');
          }
        }
        const beforeFiles: Record<string, string> = {};
        for (const file of sceneConfigPaths) {
          if (await fileEvidence(this.paths, file)) beforeFiles[file] = await fs.readFile((await safeParent(this.paths, file)).absolutePath, 'utf8');
        }
        const expected = { ...beforeFiles };
        const requestedEntry = writes.find(write => write.path === 'game.config.json');
        const fallback = existingScenes[0] ? id(existingScenes[0])
          : String(parseProjectConfigDocument(requestedEntry?.text ?? '{}')['entryScene'] ?? '');
        for (const rename of configRenames) applyConfigReferenceRename(expected, rename, fallback);
        const originalEntry = parseProjectConfigDocument(beforeFiles['game.config.json'] ?? '{}')['entryScene'];
        if (labelEdits.length === 0 && (originalEntry === undefined || originalEntry === '')) {
          const pinnedEntry = parseProjectConfigDocument(expected['game.config.json'] ?? '{}')['entryScene'];
          const finalScenes = [...existingScenes.filter(file => !sourcePaths.has(portableFold(file))),
            ...writes.filter(write => write.path.startsWith('content/scenario/')).map(write => write.path)];
          if (!finalScenes.some(file => id(file) === pinnedEntry)) {
            throw new AssetImportAuthorityError('INVALID_REQUEST', '缺省入口必须指向本批保存后仍存在的场景');
          }
        }
        for (const file of sceneConfigPaths) {
          const write = writes.find(entry => entry.path === file);
          if ((expected[file] !== beforeFiles[file] && !write)
            || (write && (expected[file] === undefined
              || stableStringify(parseProjectConfigDocument(write.text, file)) !== stableStringify(parseProjectConfigDocument(expected[file]!, file))))) {
            throw new AssetImportAuthorityError('INVALID_REQUEST', `配置必须完整提交本次场景引用改写，不能伴随其他修改：${file}`);
          }
        }
      } else if (writes.some(write => sceneConfigPaths.includes(write.path) && write.path !== 'game.config.json')) {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '场景配置写入缺少改名映射');
      }

      const storedWrites: SceneCommitWriteRecord[] = [];
      for (const write of writes) {
        const baseline = await fileEvidence(this.paths, write.path);
        if (write.expectedSha256 === null) {
          if (baseline !== null) throw new AssetImportAuthorityError('IMPORT_TARGET_EXISTS', `场景目标已被占用：${write.path}`);
        } else if (baseline === null || baseline.sha256 !== write.expectedSha256) {
          throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `场景文件已在编辑器外变化：${write.path}`);
        }
        if (write.path === 'game.config.json' && configRenames === undefined) {
          try {
            const before = baseline === null ? {} : parseProjectConfigDocument(await fs.readFile((await safeParent(this.paths, write.path)).absolutePath, 'utf8'));
            const after = parseProjectConfigDocument(write.text);
            const existingScenes = (await (await NodeProjectStorage.open(this.paths.projectRoot)).listFiles())
              .filter(file => file.startsWith('content/scenario/') && /\.gal$/i.test(file)).sort();
            const first = existingScenes[0];
            const entryRelocation = records.find(record => record.request.sourcePath === first);
            const entryPath = entryRelocation ? entryRelocation.request.targetPath : first;
            const finalScenes = [...existingScenes.filter(file => !sourcePaths.has(portableFold(file))),
              ...writes.filter(entry => entry.path.startsWith('content/scenario/')).map(entry => entry.path)];
            if ((before['entryScene'] !== undefined && before['entryScene'] !== '')
              || typeof after['entryScene'] !== 'string' || !isValidSceneId(after['entryScene'])
              || !writes.some(entry => entry.path.startsWith('content/scenario/'))
              || (first !== undefined && (!entryPath || after['entryScene'] !== path.posix.basename(entryPath).slice(0, -4)))
              || !finalScenes.some(file => path.posix.basename(file).slice(0, -4) === after['entryScene'])
              || stableStringify({ ...before, entryScene: after['entryScene'] }) !== stableStringify(after)) throw new Error('not an entry pin');
          } catch {
            throw new AssetImportAuthorityError('INVALID_REQUEST', '场景保存只允许同时固定原缺省入口，不能修改其他配置');
          }
        }
        storedWrites.push({
          ...write,
          targetSha256: crypto.createHash('sha256').update(write.text, 'utf8').digest('hex'),
          baseline: baseline === null ? null : publicEvidence(baseline),
          stageFileName: null,
          stageIdentity: null,
        });
      }
      const deletes: SceneCommitDeleteRecord[] = [];
      for (const record of records) {
        const current = await fileEvidence(this.paths, record.request.sourcePath);
        if (current === null || current.sha256 !== record.source.sha256
          || !sameFileIdentity(current.identity, record.source)) {
          throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `场景源文件已被替换：${record.request.sourcePath}`);
        }
        if (record.request.targetPath !== null && await fileEvidence(this.paths, record.request.targetPath) !== null) {
          throw new AssetImportAuthorityError('IMPORT_TARGET_EXISTS', `场景目标已被占用：${record.request.targetPath}`);
        }
        deletes.push({
          operationId: record.request.operationId,
          sourcePath: record.request.sourcePath,
          source: record.source,
        });
      }

      let commitRecord: SceneCommitRecord = {
        schemaVersion: 1,
        projectIdentity: this.paths.projectIdentity,
        requestId,
        commitFingerprint,
        plans,
        ...(configRenames === undefined ? {} : { configRenames }),
        writes: storedWrites,
        deletes,
        status: 'PREPARING',
        updatedAt: this.now().toISOString(),
      };
      if (existingCommit === null) {
        await createJsonRecord(this.commitPath(requestId), commitRecord);
      } else {
        await replaceJsonRecord(this.commitPath(requestId), commitRecord);
      }

      try {
        for (let index = 0; index < commitRecord.writes.length; index += 1) {
          const write = commitRecord.writes[index]!;
          const target = await safeParent(this.paths, write.path, { createMissing: true });
          const displaced = this.displacedPath(requestId, index, target.parent);
          if (await pathExists(displaced)) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景保存保留路径已被占用');
          }
          if (write.stageIdentity === null) {
            const stageFileName = this.createStageFileName(requestId, index);
            const stage = this.stagePath(target.parent, stageFileName);
            const stageIdentity = publicEvidence(await writeStage(stage, write.text));
            if (index === 0) await this.fault('after_first_stage_before_record');
            const nextWrites = commitRecord.writes.map((candidate, candidateIndex) => (
              candidateIndex === index ? { ...candidate, stageFileName, stageIdentity } : candidate
            ));
            commitRecord = await this.replaceCommit(commitRecord, { writes: nextWrites });
          } else {
            const stage = this.stagePath(target.parent, write.stageFileName!);
            const currentStage = await stableFileEvidence(stage);
            if (!sameEvidence(currentStage, privateEvidence(write.stageIdentity))) {
              throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景暂存文件身份发生变化');
            }
          }
        }
        commitRecord = await this.replaceCommit(commitRecord, { status: 'PREPARED' });

        for (const [index, write] of commitRecord.writes.entries()) {
          const target = await safeParent(this.paths, write.path);
          const stage = this.stagePath(target.parent, write.stageFileName!);
          const displaced = this.displacedPath(requestId, index, target.parent);
          const current = await fileEvidence(this.paths, write.path);
          if (write.baseline === null) {
            if (current !== null) throw new AssetImportAuthorityError('IMPORT_TARGET_EXISTS', `场景目标已被占用：${write.path}`);
          } else {
            if (current === null || !sameEvidence(current, privateEvidence(write.baseline))) {
              throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `场景文件已在发布前变化：${write.path}`);
            }
            await moveOwnedFile(target.absolutePath, displaced, privateEvidence(write.baseline));
          }
          if (index === 0) await this.fault('before_first_publish');
          const publishTarget = await safeParent(this.paths, write.path);
          try {
            await fs.link(stage, publishTarget.absolutePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
              throw new AssetImportAuthorityError('IMPORT_TARGET_EXISTS', `场景目标在发布窗口被占用：${write.path}`);
            }
            throw error;
          }
          await syncFileAndParent(publishTarget.absolutePath);
          const verifiedTarget = await safeParent(this.paths, write.path);
          const published = await stableFileEvidence(verifiedTarget.absolutePath);
          if (write.stageIdentity === null
            || published.sha256 !== write.targetSha256
            || !sameNodeIdentity(published.identity, write.stageIdentity)) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `场景发布结果不一致：${write.path}`);
          }
          if (index === 0) await this.fault('after_first_publish');
        }

        for (const [index, deletion] of commitRecord.deletes.entries()) {
          const source = await safeParent(this.paths, deletion.sourcePath);
          const current = await fileEvidence(this.paths, deletion.sourcePath);
          if (current === null || !sameEvidence(current, privateEvidence(deletion.source))) {
            throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `场景源文件在删除前被替换：${deletion.sourcePath}`);
          }
          await moveOwnedFile(
            source.absolutePath,
            this.quarantinePath(requestId, index, source.parent),
            privateEvidence(deletion.source),
          );
        }

        // A multi-file publish can overlap an external editor. Re-read every
        // published target immediately before making COMMITTED durable.
        for (const write of commitRecord.writes) {
          const current = await fileEvidence(this.paths, write.path);
          if (current === null || write.stageIdentity === null
            || !sameEvidence(current, privateEvidence(write.stageIdentity))) {
            throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `场景在提交完成前被外部修改：${write.path}`);
          }
        }

        commitRecord = await this.replaceCommit(commitRecord, { status: 'COMMITTED' });
        await this.fault('after_committed_record');
        await this.finalizeCommitted(commitRecord);
        return commitResponse(commitRecord);
      } catch (error) {
        if (error instanceof SceneLifecycleInjectedTermination) throw error;
        const latest = await this.readCommit(requestId).catch(() => null);
        if (latest?.status === 'COMMITTED') {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '场景文件已提交，请重试同一保存请求完成收尾');
        }
        if (latest !== null && (latest.status === 'PREPARING' || latest.status === 'PREPARED')) {
          await this.restoreIncompleteCommit(latest);
        }
        throw error;
      }
    });
  }
}
