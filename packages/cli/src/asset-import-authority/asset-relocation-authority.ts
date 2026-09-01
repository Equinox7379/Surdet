import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  fingerprintProjectAssetRelocationInventory,
  fingerprintProjectAssetRelocationOpaqueScan,
  loadProjectSnapshot,
  planProjectAssetRelocation,
  stableStringify,
  type ProjectAssetFileFact,
  type ProjectAssetRelocationOpaqueRootScan,
  type ProjectFile,
  type TextHasher,
} from '@surdet/authoring';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { syncFileAndParent, syncParentDirectories } from '../authoring/node-durable-file.js';
import {
  absoluteAssetImportProjectPath,
  assetImportDirectoryIdentity,
  assetImportFileIdentity,
  assertAssetImportProjectRootIdentity,
  assertAssetRelocationProjectWorkspace,
  createAssetRelocationProjectWorkspace,
  type AssetRelocationOperationWorkspace,
} from './filesystem.js';
import { AssetRelocationStore } from './asset-relocation-store.js';
import { AssetProjectMutationCoordinator } from './mutation-coordinator.js';
import { AssetImportRecordStore } from './record-store.js';
import {
  AssetImportAuthorityError,
  type AssetImportAuthorityPaths,
  type AssetImportFileIdentity,
  type AssetRelocationDetailResponse,
  type AssetRelocationFileEvidence,
  type AssetRelocationReceipt,
  type AssetRelocationStoredOperation,
  type AssetRelocationUndoReceipt,
  type CommitAssetRelocationRequest,
  type ListAssetRelocationsResponse,
  type PlanAssetRelocationRequest,
  type RecoverAssetRelocationRequest,
  type UndoAssetRelocationRequest,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OPAQUE_ROOTS = ['src', 'scripts', 'test', 'tests'] as const;
const OPAQUE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json']);
const TERMINAL = new Set(['COMMITTED', 'CANCELLED', 'ROLLED_BACK', 'UNDONE']);

export type AssetRelocationFaultPoint =
  | 'after_binary_backup_intent'
  | 'after_binary_backup_before_journal'
  | 'after_target_link_intent'
  | 'after_target_link_before_journal'
  | 'after_text_replace_intent'
  | 'after_text_replace_before_journal';

export class AssetRelocationInjectedTermination extends Error {
  constructor(readonly point: AssetRelocationFaultPoint, options?: ErrorOptions) {
    super(`Injected asset relocation termination at ${point}`, options);
    this.name = 'AssetRelocationInjectedTermination';
  }
}

export interface ProjectAssetRelocationAuthorityOptions {
  textHasher: TextHasher;
  assertLeaseHeld: () => void | Promise<void>;
  mutationCoordinator?: AssetProjectMutationCoordinator;
  faultInjector?: (point: AssetRelocationFaultPoint) => void | Promise<void>;
  now?: () => Date;
}

interface BinaryEvidence {
  identity: AssetImportFileIdentity;
  sha256: string;
}

interface CapturedPlan {
  prepared: Awaited<ReturnType<typeof planProjectAssetRelocation>>;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 必须是小写 UUID`);
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameNodeIdentity(left: AssetImportFileIdentity, right: AssetImportFileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs;
}

function sameFileIdentity(left: AssetImportFileIdentity, right: AssetImportFileIdentity): boolean {
  return sameNodeIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function portableFold(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase();
}

function extensionOf(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function relativeWorkspacePath(operationId: string, group: 'prepared' | 'backup', name: string): string {
  return `.surdet/asset-relocation/${operationId}/${group}/${name}`;
}

async function stableBinaryEvidence(file: string): Promise<BinaryEvidence> {
  const pathBefore = await fs.lstat(file, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材路径不是安全的普通文件');
  }
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== pathBefore.dev || before.ino !== pathBefore.ino) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材打开身份与路径不一致');
    }
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const read = await handle.read(buffer, 0, Math.min(buffer.byteLength, Number(before.size) - position), position);
      if (read.bytesRead <= 0) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材读取不完整');
      digest.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(file, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || pathAfter.dev !== after.dev || pathAfter.ino !== after.ino
      || pathAfter.size !== after.size || pathAfter.mtimeNs !== after.mtimeNs) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材读取期间发生变化');
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
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

async function safeProjectParent(
  paths: AssetImportAuthorityPaths,
  relativeFile: string,
): Promise<{ parent: string; fileName: string }> {
  const absolute = absoluteAssetImportProjectPath(paths, relativeFile);
  const segments = relativeFile.split('/');
  const fileName = segments.pop()!;
  let current = paths.projectRoot;
  for (const segment of segments) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const folded = entries.filter((entry) => portableFold(entry.name) === portableFold(segment));
    if (folded.length !== 1 || folded[0]!.name !== segment || !folded[0]!.isDirectory() || folded[0]!.isSymbolicLink()) {
      throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `项目目录不安全：${relativeFile}`);
    }
    current = path.join(current, segment);
    if (await fs.realpath(current) !== current) {
      throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `项目目录发生了重定向：${relativeFile}`);
    }
  }
  if (path.dirname(absolute) !== current) throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', '项目路径解析不一致');
  return { parent: current, fileName };
}

async function projectFileEvidence(
  paths: AssetImportAuthorityPaths,
  relativeFile: string,
): Promise<BinaryEvidence | null> {
  const { parent, fileName } = await safeProjectParent(paths, relativeFile);
  const entries = await fs.readdir(parent, { withFileTypes: true });
  const folded = entries.filter((entry) => portableFold(entry.name) === portableFold(fileName));
  if (folded.length === 0) return null;
  if (folded.length !== 1 || folded[0]!.name !== fileName || !folded[0]!.isFile() || folded[0]!.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `项目文件身份不安全：${relativeFile}`);
  }
  return stableBinaryEvidence(path.join(parent, fileName));
}

async function writeExclusiveText(file: string, text: string, expectedSha256: string): Promise<void> {
  const bytes = Buffer.from(text, 'utf8');
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '准备文本指纹不一致');
  try {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectories(path.dirname(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await fs.readFile(file);
    if (crypto.createHash('sha256').update(existing).digest('hex') !== expectedSha256) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '准备文本路径已被不同内容占用');
    }
  }
}

async function removeExactFile(file: string): Promise<void> {
  await fs.unlink(file);
  await syncParentDirectories(path.dirname(file));
}

function relocationEvidence(evidence: BinaryEvidence): AssetRelocationFileEvidence {
  return { ...evidence.identity, sha256: evidence.sha256 };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export class ProjectAssetRelocationAuthority {
  private readonly textHasher: TextHasher;
  private readonly assertLeaseHeld: () => void | Promise<void>;
  private readonly mutationCoordinator: AssetProjectMutationCoordinator;
  private readonly faultInjector?: ProjectAssetRelocationAuthorityOptions['faultInjector'];
  private readonly now: () => Date;
  private readonly operationTails = new Map<string, Promise<void>>();

  constructor(
    readonly paths: AssetImportAuthorityPaths,
    readonly store: AssetRelocationStore,
    readonly barrierStore: AssetImportRecordStore,
    options: ProjectAssetRelocationAuthorityOptions,
  ) {
    if (!options.textHasher || typeof options.textHasher.sha256 !== 'function') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '缺少素材整理哈希器');
    }
    if (typeof options.assertLeaseHeld !== 'function') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '缺少素材整理项目租约守卫');
    }
    this.textHasher = options.textHasher;
    this.assertLeaseHeld = options.assertLeaseHeld;
    this.mutationCoordinator = options.mutationCoordinator ?? new AssetProjectMutationCoordinator();
    this.faultInjector = options.faultInjector;
    this.now = options.now ?? (() => new Date());
    this.store.setRecoveryReporter((operationId, incidentKey) => this.barrierStore.ensureRelocationRecoveryBarrier(
      operationId,
      this.timestamp(),
      incidentKey,
    ));
    this.barrierStore.registerRelocationTerminalVerifier((operationId) => this.verifyTerminalResolution(operationId));
    this.mutationCoordinator.register('asset-relocation', () => this.assertParticipantAvailable());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async fault(point: AssetRelocationFaultPoint): Promise<void> {
    if (this.faultInjector === undefined) return;
    try {
      await this.faultInjector(point);
    } catch (cause) {
      throw new AssetRelocationInjectedTermination(point, { cause });
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

  private async assertParticipantAvailable(): Promise<void> {
    await this.assertLeaseHeld();
    await assertAssetImportProjectRootIdentity(this.paths);
    const operations = await this.store.list();
    const interrupted = operations.find((operation) => ['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED']
      .includes(operation.journal.status));
    if (interrupted !== undefined) {
      await this.barrierStore.ensureRelocationRecoveryBarrier(
        interrupted.request.operationId,
        interrupted.journal.updatedAt,
        `journal-${interrupted.journal.journalVersion}`,
      );
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理需要先完成恢复');
    }
    if (await this.barrierStore.hasUnresolvedBarrier('asset-relocation')) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理需要先完成恢复');
    }
    if (operations.some((operation) => operation.journal.status === 'PLANNED')) {
      throw new AssetImportAuthorityError('PROJECT_BUSY', '已有素材整理计划尚未结束');
    }
  }

  private async update(
    previous: AssetRelocationStoredOperation,
    patch: Partial<Omit<AssetRelocationStoredOperation, 'schemaVersion' | 'request' | 'plan' | 'scannedFiles' | 'binaryBaseline' | 'textFiles' | 'journal'>> & {
      journal?: Partial<AssetRelocationStoredOperation['journal']>;
    },
  ): Promise<AssetRelocationStoredOperation> {
    const next: AssetRelocationStoredOperation = {
      ...previous,
      ...patch,
      journal: {
        ...previous.journal,
        ...patch.journal,
        journalVersion: previous.journal.journalVersion + 1,
        updatedAt: this.timestamp(),
      },
    };
    return this.store.replace(previous, next);
  }

  private async updateBinary(
    previous: AssetRelocationStoredOperation,
    binaryState: AssetRelocationStoredOperation['journal']['binaryState'],
    evidence: {
      binaryBackupIdentity?: AssetRelocationFileEvidence | null;
      binaryTargetIdentity?: AssetRelocationFileEvidence | null;
    } = {},
  ): Promise<AssetRelocationStoredOperation> {
    return this.update(previous, { journal: { binaryState, ...evidence } });
  }

  private async updateText(
    previous: AssetRelocationStoredOperation,
    index: number,
    state: AssetRelocationStoredOperation['journal']['textStates'][number],
    resultIdentity: AssetRelocationFileEvidence | null = previous.journal.textResultIdentities[index] ?? null,
  ): Promise<AssetRelocationStoredOperation> {
    const textStates = [...previous.journal.textStates];
    const textResultIdentities = [...previous.journal.textResultIdentities];
    textStates[index] = state;
    textResultIdentities[index] = resultIdentity;
    return this.update(previous, { journal: { textStates, textResultIdentities } });
  }

  private async enterRecovery(
    operationId: string,
    phase: 'commit' | 'rollback' | 'undo',
    message: string,
  ): Promise<never> {
    const current = await this.store.read(operationId).catch(() => null);
    let latest = current;
    if (current !== null && current.journal.status !== 'RECOVERY_REQUIRED') {
      latest = await this.update(current, { journal: { status: 'RECOVERY_REQUIRED', recoveryPhase: phase } }).catch(() => current);
    }
    await this.barrierStore.ensureRelocationRecoveryBarrier(
      operationId,
      latest?.journal.updatedAt,
      latest === null ? 'record-unreadable' : `journal-${latest.journal.journalVersion}`,
    );
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', message);
  }

  private async assetDirectories(root: string): Promise<string[]> {
    const assetRoot = path.join(root, 'content', 'assets');
    const result: string[] = [];
    const walk = async (directory: string, relative: string): Promise<void> => {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
        throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `素材目录不安全：${relative}`);
      }
      result.push(relative);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `素材目录包含符号链接：${relative}/${entry.name}`);
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/${entry.name}`);
      }
    };
    await walk(assetRoot, 'content/assets');
    return result.sort();
  }

  private async opaqueScan(
    storage: NodeProjectStorage,
  ): Promise<{ roots: ProjectAssetRelocationOpaqueRootScan[]; files: ProjectFile[] }> {
    const roots: ProjectAssetRelocationOpaqueRootScan[] = [];
    const files: ProjectFile[] = [];
    for (const root of OPAQUE_ROOTS) {
      const absoluteRoot = path.join(this.paths.projectRoot, root);
      const state = await fs.lstat(absoluteRoot).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (state === null) {
        roots.push({ root, state: 'missing', filePaths: [] });
        continue;
      }
      if (!state.isDirectory() || state.isSymbolicLink() || await fs.realpath(absoluteRoot) !== absoluteRoot) {
        throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `项目扫描目录不安全：${root}`);
      }
      const rootFiles: string[] = [];
      const walk = async (directory: string, relative: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `项目扫描目录包含符号链接：${relative}/${entry.name}`);
          const child = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
          if (entry.isDirectory()) {
            if (!['node_modules', 'dist', '.surdet'].includes(entry.name)) await walk(path.join(directory, entry.name), child);
          } else if (entry.isFile() && OPAQUE_EXTENSIONS.has(extensionOf(child))) {
            const relativePath = `${root}/${child}`;
            rootFiles.push(relativePath);
            files.push(await storage.readText(relativePath));
          }
        }
      };
      await walk(absoluteRoot, '');
      roots.push({ root, state: 'scanned', filePaths: rootFiles.sort() });
    }
    return { roots, files: files.sort((left, right) => left.path.localeCompare(right.path)) };
  }

  private async capture(request: PlanAssetRelocationRequest): Promise<CapturedPlan> {
    await this.assertLeaseHeld();
    await assertAssetImportProjectRootIdentity(this.paths);
    const storage = await NodeProjectStorage.open(this.paths.projectRoot);
    const snapshot = await loadProjectSnapshot(storage, this.textHasher);
    const listed = await storage.listFiles();
    const assetPaths = listed.filter((file) => file.startsWith('content/assets/'));
    const assetFiles = await storage.inspectFileFacts(assetPaths);
    const source = await projectFileEvidence(this.paths, request.sourcePath);
    if (source === null) throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '源素材不存在');
    const sourceFact = assetFiles.find((file) => file.path === request.sourcePath);
    if (sourceFact === undefined) throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '源素材不在项目素材清单中');
    sourceFact.sha256 = source.sha256;

    const target = await projectFileEvidence(this.paths, request.targetPath);
    const targetDirectoryPath = request.targetPath.slice(0, request.targetPath.lastIndexOf('/'));
    const targetParent = await safeProjectParent(this.paths, request.targetPath);
    const targetDirectory = await assetImportDirectoryIdentity(targetParent.parent);
    const galleryFile = await storage.exists('content/config/gallery.json')
      ? await storage.readText('content/config/gallery.json')
      : null;
    const opaque = await this.opaqueScan(storage);
    const opaqueInventoryFingerprint = await fingerprintProjectAssetRelocationOpaqueScan(
      opaque.roots,
      opaque.files,
      this.textHasher,
    );
    const assetInventoryFingerprint = await fingerprintProjectAssetRelocationInventory(assetFiles, this.textHasher);
    const binaryBaseline = {
      source: { path: request.sourcePath, ...source.identity, sha256: source.sha256 },
      target: { path: request.targetPath, state: target === null ? 'absent' as const : 'exists' as const },
      targetDirectory: { path: targetDirectoryPath, ...targetDirectory },
      assetInventoryFingerprint,
    };
    return {
      prepared: await planProjectAssetRelocation({
        operationId: request.operationId,
        snapshot,
        assetFiles,
        assetDirectories: await this.assetDirectories(this.paths.projectRoot),
        sourcePath: request.sourcePath,
        targetPath: request.targetPath,
        galleryFile,
        opaqueFiles: opaque.files,
        scanCoverage: {
          gallery: galleryFile === null ? 'absent' : 'included',
          opaqueRoots: opaque.roots,
          opaqueInventoryFingerprint,
        },
        binaryBaseline,
      }, this.textHasher),
    };
  }

  private async prepareWorkspace(
    request: PlanAssetRelocationRequest,
    captured: CapturedPlan,
  ): Promise<{ workspace: AssetRelocationOperationWorkspace; textFiles: AssetRelocationStoredOperation['textFiles'] }> {
    const workspace = await createAssetRelocationProjectWorkspace(this.paths, request.operationId);
    const textFiles: AssetRelocationStoredOperation['textFiles'] = [];
    for (const [index, change] of captured.prepared.textChanges.entries()) {
      const name = `text-${String(index).padStart(4, '0')}.txt`;
      const prepared = path.join(workspace.prepared, name);
      const backup = path.join(workspace.backup, name);
      await writeExclusiveText(prepared, change.afterText, change.afterSha256);
      await writeExclusiveText(backup, change.beforeText, change.beforeSha256);
      const before = await projectFileEvidence(this.paths, change.path);
      if (before === null || before.sha256 !== change.beforeSha256) {
        throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `引用文件在计划期间发生变化：${change.path}`);
      }
      textFiles.push({
        ...change,
        beforeIdentity: relocationEvidence(before),
        preparedRelativePath: relativeWorkspacePath(request.operationId, 'prepared', name),
        backupRelativePath: relativeWorkspacePath(request.operationId, 'backup', name),
      });
    }
    return { workspace, textFiles };
  }

  private detail(record: AssetRelocationStoredOperation): AssetRelocationDetailResponse {
    return {
      request: record.request,
      operation: record.journal,
      plan: record.plan,
      receipt: record.receipt,
      undoReceipt: record.undoReceipt,
    };
  }

  async plan(requestInput: PlanAssetRelocationRequest): Promise<AssetRelocationDetailResponse> {
    const request: PlanAssetRelocationRequest = {
      operationId: requireUuid(requestInput.operationId, 'operationId'),
      sourcePath: requestInput.sourcePath,
      targetPath: requestInput.targetPath,
    };
    return this.serialize(request.operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      const existing = await this.store.read(request.operationId);
      if (existing !== null) {
        if (!sameJson(existing.request, request)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同素材整理');
        }
        return this.detail(existing);
      }
      const own = await this.store.list();
      if (own.some((operation) => !TERMINAL.has(operation.journal.status))) {
        throw new AssetImportAuthorityError('PROJECT_BUSY', '已有素材整理尚未结束');
      }
      const captured = await this.capture(request);
      const prepared = await this.prepareWorkspace(request, captured);
      const timestamp = this.timestamp();
      const record: AssetRelocationStoredOperation = {
        schemaVersion: 1,
        request,
        plan: captured.prepared.plan,
        scannedFiles: captured.prepared.scannedFiles,
        binaryBaseline: captured.prepared.binaryBaseline,
        textFiles: prepared.textFiles,
        journal: {
          schemaVersion: 1,
          operationId: request.operationId,
          journalVersion: 1,
          status: 'PLANNED',
          recoveryPhase: null,
          binaryState: 'SOURCE',
          binaryBackupRelativePath: relativeWorkspacePath(request.operationId, 'backup', 'source.bin'),
          binaryBackupIdentity: null,
          binaryTargetIdentity: null,
          textStates: prepared.textFiles.map(() => 'PENDING'),
          textResultIdentities: prepared.textFiles.map(() => null),
          updatedAt: timestamp,
        },
        receipt: null,
        undoReceipt: null,
      };
      try {
        return this.detail(await this.store.create(record));
      } catch (error) {
        await fs.rm(prepared.workspace.root, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }));
  }

  private async assertFresh(record: AssetRelocationStoredOperation): Promise<void> {
    const captured = await this.capture(record.request);
    if (captured.prepared.plan.status !== 'ready'
      || captured.prepared.plan.planFingerprint !== record.plan.planFingerprint
      || !sameJson(captured.prepared.scannedFiles, record.scannedFiles)
      || !sameJson(captured.prepared.binaryBaseline, record.binaryBaseline)
      || !sameJson(captured.prepared.textChanges, record.textFiles.map((file) => ({
        path: file.path,
        beforeSha256: file.beforeSha256,
        afterSha256: file.afterSha256,
        beforeText: file.beforeText,
        afterText: file.afterText,
      })))) {
      throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '项目内容已变化，请重新检查整理影响');
    }
    for (const file of record.textFiles) {
      const current = await projectFileEvidence(this.paths, file.path);
      if (current === null || !sameFileIdentity(current.identity, file.beforeIdentity)
        || current.sha256 !== file.beforeSha256) {
        throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `引用文件已变化：${file.path}`);
      }
    }
  }

  private async verifyWorkspaceTexts(record: AssetRelocationStoredOperation): Promise<void> {
    await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    for (const file of record.textFiles) {
      const prepared = await fs.readFile(absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath));
      const backup = await fs.readFile(absoluteAssetImportProjectPath(this.paths, file.backupRelativePath));
      if (crypto.createHash('sha256').update(prepared).digest('hex') !== file.afterSha256
        || crypto.createHash('sha256').update(backup).digest('hex') !== file.beforeSha256) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理准备文本发生变化');
      }
    }
  }

  private async replaceTextDurably(
    relativePath: string,
    durableSourceRelativePath: string,
    expectedCurrentIdentity: AssetRelocationFileEvidence,
    expectedCurrentSha256: string,
    expectedResultSha256: string,
    knownResultIdentity: AssetRelocationFileEvidence | null,
    nonce: string,
  ): Promise<AssetRelocationFileEvidence> {
    const durableSource = absoluteAssetImportProjectPath(this.paths, durableSourceRelativePath);
    const durableEvidence = await stableBinaryEvidence(durableSource);
    if (durableEvidence.sha256 !== expectedResultSha256) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `持久文本副本身份不一致：${relativePath}`);
    }
    const current = await projectFileEvidence(this.paths, relativePath);
    if (current === null) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本文件缺失：${relativePath}`);
    }
    if (current.sha256 === expectedResultSha256) {
      if (knownResultIdentity !== null && sameFileIdentity(current.identity, knownResultIdentity)) {
        return relocationEvidence(current);
      }
      if (knownResultIdentity === null && sameNodeIdentity(current.identity, durableEvidence.identity)) {
        return relocationEvidence(current);
      }
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本结果被同内容外部文件替换：${relativePath}`);
    }
    if (current.sha256 !== expectedCurrentSha256
      || !sameFileIdentity(current.identity, expectedCurrentIdentity)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本内容已被外部修改：${relativePath}`);
    }
    const { parent } = await safeProjectParent(this.paths, relativePath);
    const target = absoluteAssetImportProjectPath(this.paths, relativePath);
    const temporary = path.join(parent, `.surdet-relocation-${nonce}.tmp`);
    try {
      if (!await fileExists(temporary)) {
        await fs.link(durableSource, temporary);
        await syncFileAndParent(temporary);
      } else {
        const temporaryEvidence = await stableBinaryEvidence(temporary);
        if (!sameNodeIdentity(temporaryEvidence.identity, durableEvidence.identity)
          || temporaryEvidence.sha256 !== expectedResultSha256) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布暂存路径被占用：${relativePath}`);
        }
      }
      const beforePublish = await projectFileEvidence(this.paths, relativePath);
      if (beforePublish === null || beforePublish.sha256 !== expectedCurrentSha256
        || !sameFileIdentity(beforePublish.identity, expectedCurrentIdentity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布前发生变化：${relativePath}`);
      }
      await fs.rename(temporary, target);
      await syncFileAndParent(target);
      const published = await projectFileEvidence(this.paths, relativePath);
      if (published === null || published.sha256 !== expectedResultSha256
        || !sameNodeIdentity(published.identity, durableEvidence.identity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布后身份不一致：${relativePath}`);
      }
      return relocationEvidence(published);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async moveSourceToBackup(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    const workspace = await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    const backup = path.join(workspace.backup, 'source.bin');
    const source = absoluteAssetImportProjectPath(this.paths, record.request.sourcePath);
    if (record.journal.binaryState === 'SOURCE') {
      const evidence = await projectFileEvidence(this.paths, record.request.sourcePath);
      if (evidence === null || !sameFileIdentity(evidence.identity, record.binaryBaseline.source)
        || evidence.sha256 !== record.binaryBaseline.source.sha256
        || await projectFileEvidence(this.paths, record.request.targetPath) !== null
        || await fileExists(backup)) {
        return this.enterRecovery(record.request.operationId, 'commit', '素材移动前身份已经变化');
      }
      record = await this.updateBinary(record, 'BACKUP_INTENT');
      await this.fault('after_binary_backup_intent');
    }
    if (record.journal.binaryState === 'BACKUP_INTENT') {
      if (await projectFileEvidence(this.paths, record.request.targetPath) !== null) {
        return this.enterRecovery(record.request.operationId, 'commit', '素材备份期间目标路径被占用');
      }
      const sourceEvidence = await projectFileEvidence(this.paths, record.request.sourcePath);
      const backupEvidence = await fs.lstat(backup).then(() => stableBinaryEvidence(backup)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (sourceEvidence !== null && backupEvidence === null) {
        if (!sameFileIdentity(sourceEvidence.identity, record.binaryBaseline.source)
          || sourceEvidence.sha256 !== record.binaryBaseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', '源素材不再匹配计划基线');
        }
        await fs.link(source, backup);
        await syncFileAndParent(backup);
        const linked = await stableBinaryEvidence(backup);
        const sourceBeforeRemove = await projectFileEvidence(this.paths, record.request.sourcePath);
        if (sourceBeforeRemove === null
          || !sameNodeIdentity(sourceBeforeRemove.identity, linked.identity)
          || sourceBeforeRemove.sha256 !== linked.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', '素材备份建立后源文件发生变化');
        }
        await removeExactFile(source);
        await syncParentDirectories(path.dirname(backup));
      } else if (sourceEvidence !== null && backupEvidence !== null) {
        if (!sameFileIdentity(sourceEvidence.identity, record.binaryBaseline.source)
          || !sameFileIdentity(backupEvidence.identity, record.binaryBaseline.source)
          || !sameNodeIdentity(sourceEvidence.identity, backupEvidence.identity)
          || sourceEvidence.sha256 !== record.binaryBaseline.source.sha256
          || backupEvidence.sha256 !== record.binaryBaseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', '素材备份中间状态身份不一致');
        }
        await removeExactFile(source);
        await syncParentDirectories(path.dirname(backup));
      } else if (backupEvidence === null
        || !sameFileIdentity(backupEvidence.identity, record.binaryBaseline.source)
        || backupEvidence.sha256 !== record.binaryBaseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'commit', '素材备份状态无法安全恢复');
      }
      await this.fault('after_binary_backup_before_journal');
      const persistedBackup = await stableBinaryEvidence(backup);
      record = await this.updateBinary(record, 'BACKUP', {
        binaryBackupIdentity: relocationEvidence(persistedBackup),
      });
    }
    return record;
  }

  private async publishTarget(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    const workspace = await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    const backup = path.join(workspace.backup, 'source.bin');
    const target = absoluteAssetImportProjectPath(this.paths, record.request.targetPath);
    if (record.journal.binaryState === 'BACKUP') {
      if (await projectFileEvidence(this.paths, record.request.sourcePath) !== null
        || await projectFileEvidence(this.paths, record.request.targetPath) !== null) {
        return this.enterRecovery(record.request.operationId, 'commit', '目标发布前项目路径状态不再为空');
      }
      record = await this.updateBinary(record, 'TARGET_INTENT');
      await this.fault('after_target_link_intent');
    }
    if (record.journal.binaryState === 'TARGET_INTENT') {
      if (await projectFileEvidence(this.paths, record.request.sourcePath) !== null) {
        return this.enterRecovery(record.request.operationId, 'commit', '目标发布期间源路径重新出现');
      }
      const backupEvidence = await stableBinaryEvidence(backup);
      let targetEvidence = await projectFileEvidence(this.paths, record.request.targetPath);
      if (targetEvidence === null) {
        try {
          await fs.link(backup, target);
          await syncFileAndParent(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        targetEvidence = await projectFileEvidence(this.paths, record.request.targetPath);
      }
      if (targetEvidence === null || !sameNodeIdentity(targetEvidence.identity, backupEvidence.identity)
        || targetEvidence.sha256 !== record.binaryBaseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'commit', '目标素材发布身份不一致');
      }
      await this.fault('after_target_link_before_journal');
      record = await this.updateBinary(record, 'TARGET', {
        binaryBackupIdentity: relocationEvidence(backupEvidence),
        binaryTargetIdentity: relocationEvidence(targetEvidence),
      });
    }
    return record;
  }

  private async replaceTexts(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    for (let index = 0; index < record.textFiles.length; index++) {
      const file = record.textFiles[index]!;
      let state = record.journal.textStates[index]!;
      if (state === 'PENDING') {
        const current = await projectFileEvidence(this.paths, file.path);
        if (current === null || current.sha256 !== file.beforeSha256
          || !sameFileIdentity(current.identity, file.beforeIdentity)) {
          return this.enterRecovery(record.request.operationId, 'commit', `文本在替换前发生变化：${file.path}`);
        }
        record = await this.updateText(record, index, 'REPLACE_INTENT');
        state = 'REPLACE_INTENT';
        await this.fault('after_text_replace_intent');
      }
      if (state === 'REPLACE_INTENT') {
        const resultIdentity = await this.replaceTextDurably(
          file.path,
          file.preparedRelativePath,
          file.beforeIdentity,
          file.beforeSha256,
          file.afterSha256,
          record.journal.textResultIdentities[index] ?? null,
          `${record.request.operationId}-${index}`,
        );
        await this.fault('after_text_replace_before_journal');
        record = await this.updateText(record, index, 'REPLACED', resultIdentity);
      }
    }
    return record;
  }

  private async verifyCommittedFiles(record: AssetRelocationStoredOperation): Promise<void> {
    const source = await projectFileEvidence(this.paths, record.request.sourcePath);
    const target = await projectFileEvidence(this.paths, record.request.targetPath);
    if (source !== null || target === null || target.sha256 !== record.binaryBaseline.source.sha256
      || (record.journal.binaryTargetIdentity !== null
        && !sameFileIdentity(target.identity, record.journal.binaryTargetIdentity))) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理后的二进制状态不一致');
    }
    for (const [index, file] of record.textFiles.entries()) {
      const current = await projectFileEvidence(this.paths, file.path);
      const expected = record.journal.textResultIdentities[index];
      const receiptExpected = record.receipt?.textFiles[index]?.identity;
      if (current === null || expected == null || current.sha256 !== file.afterSha256
        || !sameFileIdentity(current.identity, expected)
        || (receiptExpected !== undefined && !sameFileIdentity(current.identity, receiptExpected))) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `素材整理后的文本状态不一致：${file.path}`);
      }
    }
  }

  private async verifyTerminalResolution(
    operationId: string,
  ): Promise<{ journalVersion: number; terminalFingerprint: string }> {
    const record = await this.store.read(operationId);
    if (record === null || !TERMINAL.has(record.journal.status)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理尚未达到可验证终态');
    }
    if (record.journal.status === 'COMMITTED') {
      if (record.receipt === null || record.journal.binaryState !== 'TARGET'
        || record.journal.binaryBackupIdentity === null
        || record.journal.binaryTargetIdentity === null
        || record.journal.textStates.some((state) => state !== 'REPLACED')
        || record.journal.textResultIdentities.some((identity) => identity === null)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理成功终态记录不完整');
      }
      await this.verifyCommittedFiles(record);
      const target = await projectFileEvidence(this.paths, record.request.targetPath);
      const backup = await stableBinaryEvidence(absoluteAssetImportProjectPath(
        this.paths,
        record.journal.binaryBackupRelativePath,
      ));
      if (target === null
        || !sameFileIdentity(target.identity, record.receipt.targetIdentity)
        || !sameFileIdentity(target.identity, record.journal.binaryTargetIdentity!)
        || !sameFileIdentity(backup.identity, record.journal.binaryBackupIdentity!)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理成功终态文件身份不一致');
      }
    } else if (record.journal.status === 'ROLLED_BACK' || record.journal.status === 'CANCELLED') {
      if (record.receipt !== null || record.undoReceipt !== null
        || (record.journal.status === 'ROLLED_BACK' && record.journal.binaryState !== 'ROLLED_BACK')
        || (record.journal.status === 'CANCELLED' && record.journal.binaryState !== 'SOURCE')) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理回退终态记录不完整');
      }
      const source = await projectFileEvidence(this.paths, record.request.sourcePath);
      const target = await projectFileEvidence(this.paths, record.request.targetPath);
      if (source === null || target !== null
        || !sameFileIdentity(source.identity, record.binaryBaseline.source)
        || source.sha256 !== record.binaryBaseline.source.sha256) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理回退终态文件身份不一致');
      }
      for (const [index, file] of record.textFiles.entries()) {
        const current = await projectFileEvidence(this.paths, file.path);
        const expected = record.journal.textResultIdentities[index] ?? file.beforeIdentity;
        if (current === null || current.sha256 !== file.beforeSha256
          || !sameFileIdentity(current.identity, expected)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `素材整理回退文本不一致：${file.path}`);
        }
      }
      if (record.journal.status === 'CANCELLED') {
        const projectWorkspace = path.join(
          this.paths.relocationWorkspace,
          record.request.operationId,
        );
        if (await fileExists(projectWorkspace)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '已取消的素材整理仍残留项目工作区');
        }
      }
    } else {
      if (record.receipt === null || record.undoReceipt === null
        || record.journal.binaryState !== 'UNDONE'
        || record.journal.textStates.some((state) => state !== 'UNDONE')) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理撤销终态记录不完整');
      }
      const source = await projectFileEvidence(this.paths, record.request.sourcePath);
      const target = await projectFileEvidence(this.paths, record.request.targetPath);
      if (source === null || target !== null
        || !sameFileIdentity(source.identity, record.undoReceipt.sourceIdentity)
        || source.sha256 !== record.binaryBaseline.source.sha256) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理撤销终态文件身份不一致');
      }
      for (const [index, file] of record.textFiles.entries()) {
        const current = await projectFileEvidence(this.paths, file.path);
        const expected = record.journal.textResultIdentities[index];
        if (current === null || expected == null || current.sha256 !== file.beforeSha256
          || !sameFileIdentity(current.identity, expected)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `素材整理撤销文本不一致：${file.path}`);
        }
      }
    }
    const terminalFingerprint = await this.textHasher.sha256(stableStringify({
      status: record.journal.status,
      journalVersion: record.journal.journalVersion,
      receipt: record.receipt,
      undoReceipt: record.undoReceipt,
    }));
    return { journalVersion: record.journal.journalVersion, terminalFingerprint };
  }

  private async finishCommit(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    await this.verifyCommittedFiles(record);
    if (record.receipt === null) {
      const target = await projectFileEvidence(this.paths, record.request.targetPath);
      if (target === null) return this.enterRecovery(record.request.operationId, 'commit', '完成回执缺少目标素材');
      const textFiles = record.textFiles.map((file, index) => {
        const identity = record.journal.textResultIdentities[index];
        if (identity === null || identity === undefined) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `完成回执缺少文本身份：${file.path}`);
        }
        return { path: file.path, sha256: file.afterSha256, identity };
      });
      const semantic = {
        schemaVersion: 1 as const,
        receiptId: crypto.randomUUID(),
        operationId: record.request.operationId,
        planId: record.plan.planId,
        planFingerprint: record.plan.planFingerprint,
        projectIdentity: this.paths.projectIdentity,
        sourcePath: record.request.sourcePath,
        targetPath: record.request.targetPath,
        targetIdentity: relocationEvidence(target),
        textFiles,
        committedAt: this.timestamp(),
      };
      const receipt: AssetRelocationReceipt = {
        ...semantic,
        receiptFingerprint: await this.textHasher.sha256(stableStringify(semantic)),
      };
      record = await this.update(record, { receipt });
    }
    if (record.journal.status !== 'COMMITTED') {
      record = await this.update(record, { journal: { status: 'COMMITTED', recoveryPhase: null } });
    }
    await this.barrierStore.resolveRelocationBarriers(record.request.operationId);
    return record;
  }

  private async continueCommit(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    await this.verifyWorkspaceTexts(record);
    record = await this.moveSourceToBackup(record);
    record = await this.publishTarget(record);
    record = await this.replaceTexts(record);
    return this.finishCommit(record);
  }

  private async continueRollback(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    if (record.journal.status !== 'ROLLING_BACK') {
      record = await this.update(record, { journal: { status: 'ROLLING_BACK', recoveryPhase: 'rollback' } });
    }
    for (let index = record.textFiles.length - 1; index >= 0; index--) {
      const file = record.textFiles[index]!;
      const state = record.journal.textStates[index]!;
      if (state === 'PENDING' || state === 'ROLLED_BACK') continue;
      const current = await projectFileEvidence(this.paths, file.path);
      if (current === null) {
        return this.enterRecovery(record.request.operationId, 'rollback', `回滚文本缺失：${file.path}`);
      }
      if (current.sha256 === file.beforeSha256) {
        const durableBefore = await stableBinaryEvidence(absoluteAssetImportProjectPath(this.paths, file.backupRelativePath));
        if (!sameFileIdentity(current.identity, file.beforeIdentity)
          && !sameNodeIdentity(current.identity, durableBefore.identity)) {
          return this.enterRecovery(record.request.operationId, 'rollback', `同内容外部文件阻止文本回滚：${file.path}`);
        }
        record = await this.updateText(record, index, 'ROLLED_BACK', relocationEvidence(current));
        continue;
      }
      if (current.sha256 !== file.afterSha256) {
        return this.enterRecovery(record.request.operationId, 'rollback', `外部修改阻止文本回滚：${file.path}`);
      }
      let afterIdentity = record.journal.textResultIdentities[index] ?? null;
      if (afterIdentity === null) {
        const prepared = await stableBinaryEvidence(absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath));
        if (!sameNodeIdentity(current.identity, prepared.identity)) {
          return this.enterRecovery(record.request.operationId, 'rollback', `文本替换结果身份无法确认：${file.path}`);
        }
        afterIdentity = relocationEvidence(current);
      }
      if (state !== 'ROLLBACK_INTENT') record = await this.updateText(record, index, 'ROLLBACK_INTENT');
      const restoredIdentity = await this.replaceTextDurably(
        file.path,
        file.backupRelativePath,
        afterIdentity,
        file.afterSha256,
        file.beforeSha256,
        null,
        `rollback-${record.request.operationId}-${index}`,
      );
      record = await this.updateText(record, index, 'ROLLED_BACK', restoredIdentity);
    }

    const workspace = await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    const backup = path.join(workspace.backup, 'source.bin');
    if (!['SOURCE', 'ROLLED_BACK'].includes(record.journal.binaryState)) {
      if (record.journal.binaryState !== 'ROLLBACK_INTENT') record = await this.updateBinary(record, 'ROLLBACK_INTENT');
      const target = await projectFileEvidence(this.paths, record.request.targetPath);
      if (target !== null) {
        const backupEvidence = await stableBinaryEvidence(backup);
        if (!sameNodeIdentity(target.identity, backupEvidence.identity)
          || target.sha256 !== record.binaryBaseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'rollback', '外部修改阻止素材目标回滚');
        }
        await removeExactFile(absoluteAssetImportProjectPath(this.paths, record.request.targetPath));
      }
      const source = await projectFileEvidence(this.paths, record.request.sourcePath);
      const backupExists = await fileExists(backup);
      if (source === null && backupExists) {
        await fs.link(backup, absoluteAssetImportProjectPath(this.paths, record.request.sourcePath));
        await syncFileAndParent(absoluteAssetImportProjectPath(this.paths, record.request.sourcePath));
      } else if (source === null || !backupExists || source.sha256 !== record.binaryBaseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'rollback', '素材源路径无法安全恢复');
      }
      const restored = await projectFileEvidence(this.paths, record.request.sourcePath);
      const backupEvidence = await stableBinaryEvidence(backup);
      if (restored === null || !sameNodeIdentity(restored.identity, backupEvidence.identity)
        || restored.sha256 !== record.binaryBaseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'rollback', '素材源路径恢复后身份不一致');
      }
      record = await this.updateBinary(record, 'ROLLED_BACK');
    }
    record = await this.update(record, { journal: { status: 'ROLLED_BACK', recoveryPhase: null } });
    await this.barrierStore.resolveRelocationBarriers(record.request.operationId);
    return record;
  }

  async commit(
    operationIdInput: string,
    request: CommitAssetRelocationRequest,
  ): Promise<AssetRelocationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    if (!SHA256.test(request.planFingerprint)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'planFingerprint 格式无效');
    return this.serialize(operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      let record = await this.store.read(operationId);
      if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '素材整理操作不存在');
      if (record.journal.status === 'COMMITTED') {
        await this.verifyTerminalResolution(operationId);
        return this.detail(record);
      }
      if (record.journal.status !== 'PLANNED') throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能提交素材整理');
      if (record.plan.status !== 'ready') throw new AssetImportAuthorityError('IMPORT_PLAN_BLOCKED', '素材整理计划仍有阻断项');
      if (record.plan.planFingerprint !== request.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '计划指纹不匹配');
      }
      await this.assertFresh(record);
      record = await this.update(record, { journal: { status: 'PUBLISHING', recoveryPhase: 'commit' } });
      try {
        return this.detail(await this.continueCommit(record));
      } catch (error) {
        if (error instanceof AssetRelocationInjectedTermination) throw error;
        const latest = await this.store.read(operationId);
        if (latest?.receipt !== null && latest?.receipt !== undefined) {
          return this.enterRecovery(operationId, 'commit', '成功回执已落盘，需要恢复完成');
        }
        try {
          if (latest !== null) await this.continueRollback(latest);
        } catch {
          return this.enterRecovery(operationId, 'rollback', '素材整理失败且无法安全回滚');
        }
        throw error;
      }
    }));
  }

  private async preflightUndo(record: AssetRelocationStoredOperation): Promise<void> {
    const workspace = await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    const backup = await stableBinaryEvidence(path.join(workspace.backup, 'source.bin'));
    const source = await projectFileEvidence(this.paths, record.request.sourcePath);
    const target = await projectFileEvidence(this.paths, record.request.targetPath);
    if (source !== null || target === null || record.receipt === null
      || !sameNodeIdentity(target.identity, backup.identity)
      || !sameFileIdentity(target.identity, record.receipt.targetIdentity)) {
      throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', '目标素材已经变化，不能撤销');
    }
    for (const [index, file] of record.textFiles.entries()) {
      const current = await projectFileEvidence(this.paths, file.path);
      const expected = record.journal.textResultIdentities[index];
      if (current === null || expected == null || current.sha256 !== file.afterSha256
        || !sameFileIdentity(current.identity, expected)) {
        throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', `引用文件已经变化，不能撤销：${file.path}`);
      }
    }
  }

  private async continueUndo(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    for (let index = record.textFiles.length - 1; index >= 0; index--) {
      const file = record.textFiles[index]!;
      const state = record.journal.textStates[index]!;
      if (state === 'UNDONE') continue;
      const current = await projectFileEvidence(this.paths, file.path);
      if (current === null) {
        return this.enterRecovery(record.request.operationId, 'undo', `撤销文本缺失：${file.path}`);
      }
      if (current.sha256 === file.afterSha256) {
        const afterIdentity = record.journal.textResultIdentities[index];
        if (afterIdentity == null || !sameFileIdentity(current.identity, afterIdentity)) {
          return this.enterRecovery(record.request.operationId, 'undo', `撤销文本身份已变化：${file.path}`);
        }
        if (state !== 'UNDO_INTENT') record = await this.updateText(record, index, 'UNDO_INTENT');
        const restoredIdentity = await this.replaceTextDurably(
          file.path,
          file.backupRelativePath,
          afterIdentity,
          file.afterSha256,
          file.beforeSha256,
          null,
          `undo-${record.request.operationId}-${index}`,
        );
        record = await this.updateText(record, index, 'UNDONE', restoredIdentity);
      } else if (current.sha256 !== file.beforeSha256) {
        return this.enterRecovery(record.request.operationId, 'undo', `外部修改阻止文本撤销：${file.path}`);
      } else {
        const durableBefore = await stableBinaryEvidence(absoluteAssetImportProjectPath(this.paths, file.backupRelativePath));
        if (!sameNodeIdentity(current.identity, durableBefore.identity)) {
          return this.enterRecovery(record.request.operationId, 'undo', `撤销后的文本被外部替换：${file.path}`);
        }
        record = await this.updateText(record, index, 'UNDONE', relocationEvidence(current));
      }
    }

    if (record.journal.binaryState !== 'UNDONE') {
      if (record.journal.binaryState !== 'UNDO_INTENT') record = await this.updateBinary(record, 'UNDO_INTENT');
      const workspace = await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
      const backup = path.join(workspace.backup, 'source.bin');
      const backupEvidence = await stableBinaryEvidence(backup);
      let source = await projectFileEvidence(this.paths, record.request.sourcePath);
      if (source === null) {
        await fs.link(backup, absoluteAssetImportProjectPath(this.paths, record.request.sourcePath));
        await syncFileAndParent(absoluteAssetImportProjectPath(this.paths, record.request.sourcePath));
        source = await projectFileEvidence(this.paths, record.request.sourcePath);
      }
      if (source === null || !sameNodeIdentity(source.identity, backupEvidence.identity)) {
        return this.enterRecovery(record.request.operationId, 'undo', '源素材撤销身份不一致');
      }
      const target = await projectFileEvidence(this.paths, record.request.targetPath);
      if (target !== null) {
        if (!sameNodeIdentity(target.identity, backupEvidence.identity)) {
          return this.enterRecovery(record.request.operationId, 'undo', '目标素材已被外部修改');
        }
        await removeExactFile(absoluteAssetImportProjectPath(this.paths, record.request.targetPath));
      }
      record = await this.updateBinary(record, 'UNDONE');
    }

    if (record.undoReceipt === null) {
      const restoredSource = await projectFileEvidence(this.paths, record.request.sourcePath);
      if (restoredSource === null) {
        return this.enterRecovery(record.request.operationId, 'undo', '撤销回执缺少恢复后的源素材');
      }
      const restoredTextFiles = record.textFiles.map((file, index) => {
        const identity = record.journal.textResultIdentities[index];
        if (identity === null || identity === undefined) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `撤销回执缺少文本身份：${file.path}`);
        }
        return { path: file.path, sha256: file.beforeSha256, identity };
      });
      const semantic = {
        schemaVersion: 1 as const,
        undoReceiptId: crypto.randomUUID(),
        operationId: record.request.operationId,
        receiptId: record.receipt!.receiptId,
        sourcePath: record.request.sourcePath,
        targetPath: record.request.targetPath,
        sourceIdentity: relocationEvidence(restoredSource),
        restoredTextFiles,
        undoneAt: this.timestamp(),
      };
      const undoReceipt: AssetRelocationUndoReceipt = {
        ...semantic,
        undoReceiptFingerprint: await this.textHasher.sha256(stableStringify(semantic)),
      };
      record = await this.update(record, { undoReceipt });
    }
    record = await this.update(record, { journal: { status: 'UNDONE', recoveryPhase: null } });
    await this.barrierStore.resolveRelocationBarriers(record.request.operationId);
    return record;
  }

  async undo(
    operationIdInput: string,
    request: UndoAssetRelocationRequest,
  ): Promise<AssetRelocationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    if (!UUID.test(request.receiptId) || !SHA256.test(request.receiptFingerprint)) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '撤销回执身份格式无效');
    }
    return this.serialize(operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      let record = await this.store.read(operationId);
      if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '素材整理操作不存在');
      if (record.journal.status === 'UNDONE') {
        await this.verifyTerminalResolution(operationId);
        return this.detail(record);
      }
      if (record.journal.status !== 'COMMITTED' || record.receipt === null) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能撤销素材整理');
      }
      if (record.receipt.receiptId !== request.receiptId
        || record.receipt.receiptFingerprint !== request.receiptFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '撤销请求与成功回执不匹配');
      }
      await this.preflightUndo(record);
      record = await this.update(record, { journal: { status: 'UNDOING', recoveryPhase: 'undo' } });
      try {
        return this.detail(await this.continueUndo(record));
      } catch (error) {
        if (error instanceof AssetRelocationInjectedTermination) throw error;
        return this.enterRecovery(operationId, 'undo', error instanceof Error ? error.message : '素材整理撤销中断');
      }
    }));
  }

  async recover(
    operationIdInput: string,
    request: RecoverAssetRelocationRequest,
  ): Promise<AssetRelocationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    if (request.action !== 'resume' && request.action !== 'rollback') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '恢复动作无效');
    }
    return this.serialize(operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      let record = await this.store.read(operationId);
      if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '素材整理操作不存在');
      if (TERMINAL.has(record.journal.status)) {
        await this.verifyTerminalResolution(operationId);
        await this.barrierStore.resolveRelocationBarriers(operationId);
        return this.detail(record);
      }
      if (!['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(record.journal.status)) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不需要恢复');
      }
      await this.barrierStore.ensureRelocationRecoveryBarrier(
        operationId,
        record.journal.updatedAt,
        `journal-${record.journal.journalVersion}`,
      );
      const phase = record.journal.status === 'UNDOING' ? 'undo'
        : record.journal.status === 'ROLLING_BACK' ? 'rollback'
          : record.journal.recoveryPhase ?? 'commit';
      if (phase === 'undo') {
        if (request.action === 'rollback') {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '撤销已经开始，只能继续完成');
        }
        if (record.journal.status === 'RECOVERY_REQUIRED') {
          record = await this.update(record, { journal: { status: 'UNDOING', recoveryPhase: 'undo' } });
        }
        return this.detail(await this.continueUndo(record));
      }
      if (request.action === 'rollback' || phase === 'rollback') {
        return this.detail(await this.continueRollback(record));
      }
      if (record.receipt !== null) return this.detail(await this.finishCommit(record));
      if (record.journal.status === 'RECOVERY_REQUIRED') {
        record = await this.update(record, { journal: { status: 'PUBLISHING', recoveryPhase: 'commit' } });
      }
      return this.detail(await this.continueCommit(record));
    }));
  }

  async cancel(operationIdInput: string): Promise<AssetRelocationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      let record = await this.store.read(operationId);
      if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '素材整理操作不存在');
      if (record.journal.status === 'CANCELLED') return this.detail(record);
      if (record.journal.status !== 'PLANNED') {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '只有未提交的整理计划可以取消');
      }
      record = await this.update(record, { journal: { status: 'CANCELLED', recoveryPhase: null } });
      const workspace = await assertAssetRelocationProjectWorkspace(this.paths, operationId);
      await fs.rm(workspace.root, { recursive: true, force: true });
      await syncParentDirectories(path.dirname(workspace.root));
      return this.detail(record);
    }));
  }

  async query(operationIdInput: string): Promise<AssetRelocationDetailResponse> {
    await this.assertLeaseHeld();
    const operationId = requireUuid(operationIdInput, 'operationId');
    const record = await this.store.read(operationId);
    if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '素材整理操作不存在');
    if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(record.journal.status)) {
      await this.barrierStore.ensureRelocationRecoveryBarrier(
        operationId,
        record.journal.updatedAt,
        `journal-${record.journal.journalVersion}`,
      );
    }
    if (TERMINAL.has(record.journal.status)) await this.verifyTerminalResolution(operationId);
    return this.detail(record);
  }

  async list(): Promise<ListAssetRelocationsResponse> {
    await this.assertLeaseHeld();
    const records = await this.store.list();
    for (const record of records) {
      if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(record.journal.status)) {
        await this.barrierStore.ensureRelocationRecoveryBarrier(
          record.request.operationId,
          record.journal.updatedAt,
          `journal-${record.journal.journalVersion}`,
        );
      }
      if (TERMINAL.has(record.journal.status)) await this.verifyTerminalResolution(record.request.operationId);
    }
    return {
      operations: records.map((record) => ({
        operationId: record.request.operationId,
        status: record.journal.status,
        sourcePath: record.request.sourcePath,
        targetPath: record.request.targetPath,
        updatedAt: record.journal.updatedAt,
        manualRecoveryRequired: record.journal.status === 'RECOVERY_REQUIRED',
      })),
      recentReceipts: records.flatMap((record) => record.receipt === null ? [] : [record.receipt]),
    };
  }
}
