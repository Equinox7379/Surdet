import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  fingerprintProjectAssetRelocationInventory,
  fingerprintProjectAssetRelocationOpaqueScan,
  isSnapshotPath,
  loadProjectSnapshot,
  planProjectAssetRelocationBatch,
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
  type AssetRelocationRequest,
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
  | 'after_plan_record_before_workspace'
  | 'after_workspace_text_before_record'
  | 'after_cancel_workspace_before_record'
  | 'after_binary_backup_intent'
  | 'after_binary_backup_before_journal'
  | 'after_binary_backups_before_targets'
  | 'before_source_remove'
  | 'after_target_link_intent'
  | 'before_target_publish'
  | 'after_target_link_before_journal'
  | 'after_text_replace_intent'
  | 'before_text_publish'
  | 'after_text_displaced_before_publish'
  | 'after_text_replace_before_journal'
  | 'before_receipt_persist'
  | 'after_receipt_before_committed'
  | 'after_rollback_target_intent'
  | 'after_undo_target_intent';

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
  prepared: Awaited<ReturnType<typeof planProjectAssetRelocationBatch>>;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 必须是小写 UUID`);
  return value;
}

function normalizeRelocationRequest(input: PlanAssetRelocationRequest): AssetRelocationRequest {
  const operationId = requireUuid(input.operationId, 'operationId');
  const rawMoves = input.moves ?? (typeof input.sourcePath === 'string' && typeof input.targetPath === 'string'
    ? [{ sourcePath: input.sourcePath, targetPath: input.targetPath }]
    : []);
  if (rawMoves.length === 0 || rawMoves.length > 100) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '素材整理数量必须在 1 到 100 之间');
  }
  const moves = rawMoves.map((move) => {
    if (typeof move?.sourcePath !== 'string' || typeof move.targetPath !== 'string') {
      throw new AssetImportAuthorityError('INVALID_REQUEST', '素材整理路径格式无效');
    }
    return { sourcePath: move.sourcePath, targetPath: move.targetPath };
  }).sort((left, right) => portableFold(left.sourcePath).localeCompare(portableFold(right.sourcePath))
    || left.sourcePath.localeCompare(right.sourcePath) || left.targetPath.localeCompare(right.targetPath));
  return {
    operationId,
    moves,
    sourcePath: moves[0]!.sourcePath,
    targetPath: moves[0]!.targetPath,
  };
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

function sameDirectoryNodeIdentity(
  left: { device: string; inode: string; birthtimeNs: string },
  right: { device: string; inode: string; birthtimeNs: string },
): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs;
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

async function writeExclusiveText(
  file: string,
  text: string,
  expectedSha256: string,
  expectedIdentity?: AssetRelocationFileEvidence,
  mode = 0o600,
): Promise<AssetRelocationFileEvidence> {
  const bytes = Buffer.from(text, 'utf8');
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '准备文本指纹不一致');
  let created = false;
  try {
    const handle = await fs.open(file, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(bytes);
      if (process.platform !== 'win32') await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectories(path.dirname(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const evidence = relocationEvidence(await stableBinaryEvidence(file));
  if (evidence.sha256 !== expectedSha256
    || (!created && (expectedIdentity === undefined || !sameFileIdentity(evidence, expectedIdentity)))) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '准备文本路径身份无法证明属于当前操作');
  }
  return evidence;
}

async function removeExactFile(file: string): Promise<void> {
  await fs.unlink(file);
  await syncParentDirectories(path.dirname(file));
}

async function removeOwnedExactFile(file: string, expected: AssetRelocationFileEvidence): Promise<void> {
  const quarantine = path.join(path.dirname(file), `.${path.basename(file)}.surdet-relocation-removing`);
  const filePresent = await fileExists(file);
  const quarantinePresent = await fileExists(quarantine);
  if (!filePresent) {
    if (!quarantinePresent) return;
    const interrupted = await stableBinaryEvidence(quarantine).catch(() => null);
    if (interrupted === null || interrupted.sha256 !== expected.sha256
      || !sameFileIdentity(interrupted.identity, expected)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理中断清理文件身份不一致');
    }
    await removeExactFile(quarantine);
    return;
  }
  if (quarantinePresent) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理安全清理路径已被占用');
  }
  await fs.rename(file, quarantine);
  await syncParentDirectories(path.dirname(file));
  const moved = await stableBinaryEvidence(quarantine).catch(() => null);
  if (moved === null || moved.sha256 !== expected.sha256
    || !sameFileIdentity(moved.identity, expected)) {
    if (!await fileExists(file)) {
      await fs.rename(quarantine, file).catch(() => undefined);
      await syncParentDirectories(path.dirname(file)).catch(() => undefined);
    }
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理安全清理时文件身份发生变化');
  }
  await removeExactFile(quarantine);
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

  private async updateBinaryItem(
    previous: AssetRelocationStoredOperation,
    index: number,
    state: AssetRelocationStoredOperation['journal']['binaryItems'][number]['state'],
    evidence: {
      backupIdentity?: AssetRelocationFileEvidence | null;
      targetIdentity?: AssetRelocationFileEvidence | null;
    } = {},
  ): Promise<AssetRelocationStoredOperation> {
    const binaryItems = previous.journal.binaryItems.map((item, itemIndex) => itemIndex === index
      ? {
        ...item,
        state,
        ...(evidence.backupIdentity === undefined ? {} : { backupIdentity: evidence.backupIdentity }),
        ...(evidence.targetIdentity === undefined ? {} : { targetIdentity: evidence.targetIdentity }),
      }
      : item);
    const first = binaryItems[0]!;
    return this.update(previous, {
      journal: {
        binaryItems,
        binaryState: first.state,
        binaryBackupRelativePath: first.backupRelativePath,
        binaryBackupIdentity: first.backupIdentity,
        binaryTargetIdentity: first.targetIdentity,
      },
    });
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

  private async capture(request: AssetRelocationRequest): Promise<CapturedPlan> {
    await this.assertLeaseHeld();
    await assertAssetImportProjectRootIdentity(this.paths);
    const storage = await NodeProjectStorage.open(this.paths.projectRoot);
    const snapshot = await loadProjectSnapshot(storage, this.textHasher);
    const listed = await storage.listFiles();
    const assetPaths = listed.filter((file) => file.startsWith('content/assets/'));
    const assetFiles = await storage.inspectFileFacts(assetPaths);
    const sourceEvidence = new Map<string, BinaryEvidence>();
    for (const move of request.moves) {
      const source = await projectFileEvidence(this.paths, move.sourcePath);
      if (source === null) throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `源素材不存在：${move.sourcePath}`);
      const sourceFact = assetFiles.find((file) => file.path === move.sourcePath);
      if (sourceFact === undefined) throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `源素材不在项目素材清单中：${move.sourcePath}`);
      sourceFact.sha256 = source.sha256;
      sourceEvidence.set(move.sourcePath, source);
    }
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
    const moves = [];
    for (const move of request.moves) {
      const source = sourceEvidence.get(move.sourcePath)!;
      const target = await projectFileEvidence(this.paths, move.targetPath);
      const targetDirectoryPath = move.targetPath.slice(0, move.targetPath.lastIndexOf('/'));
      const targetParent = await safeProjectParent(this.paths, move.targetPath);
      const targetDirectory = await assetImportDirectoryIdentity(targetParent.parent);
      moves.push({
        sourcePath: move.sourcePath,
        targetPath: move.targetPath,
        binaryBaseline: {
          source: { path: move.sourcePath, ...source.identity, sha256: source.sha256 },
          target: { path: move.targetPath, state: target === null ? 'absent' as const : 'exists' as const },
          targetDirectory: { path: targetDirectoryPath, ...targetDirectory },
          assetInventoryFingerprint,
        },
      });
    }
    return {
      prepared: await planProjectAssetRelocationBatch({
        operationId: request.operationId,
        snapshot,
        assetFiles,
        assetDirectories: await this.assetDirectories(this.paths.projectRoot),
        moves,
        galleryFile,
        opaqueFiles: opaque.files,
        scanCoverage: {
          gallery: galleryFile === null ? 'absent' : 'included',
          opaqueRoots: opaque.roots,
          opaqueInventoryFingerprint,
        },
      }, this.textHasher),
    };
  }

  private async assertRecoveryReferencesFresh(record: AssetRelocationStoredOperation): Promise<void> {
    await this.assertLeaseHeld();
    await assertAssetImportProjectRootIdentity(this.paths);
    const storage = await NodeProjectStorage.open(this.paths.projectRoot);
    const opaque = await this.opaqueScan(storage);
    const currentPaths = new Set([
      ...(await storage.listFiles()).filter(isSnapshotPath),
      ...opaque.files.map((file) => file.path),
    ]);
    // A journalled replacement may have displaced its original file already.
    // continueCommit still verifies the displaced/prepared file identities.
    for (const [index, file] of record.textFiles.entries()) {
      if (record.journal.textStates[index] === 'REPLACE_INTENT') currentPaths.add(file.path);
    }
    if (currentPaths.size !== record.scannedFiles.length
      || record.scannedFiles.some((file) => !currentPaths.has(file.path))) {
      throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', '恢复前引用文件清单已变化，请保留现场并回滚原操作');
    }
    for (const file of record.scannedFiles) {
      const index = record.textFiles.findIndex((change) => change.path === file.path);
      const change = record.textFiles[index];
      if (!await storage.exists(file.path) && change !== undefined
        && record.journal.textStates[index] === 'REPLACE_INTENT') continue;
      const current = await storage.readText(file.path);
      if (current.sha256 !== file.sha256 && current.sha256 !== change?.afterSha256) {
        throw new AssetImportAuthorityError('IMPORT_PLAN_STALE', `恢复前引用文件已变化：${file.path}`);
      }
    }
  }

  private async captureTextFiles(
    request: AssetRelocationRequest,
    captured: CapturedPlan,
  ): Promise<AssetRelocationStoredOperation['textFiles']> {
    const textFiles: AssetRelocationStoredOperation['textFiles'] = [];
    for (const [index, change] of captured.prepared.textChanges.entries()) {
      const name = `text-${String(index).padStart(4, '0')}.txt`;
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
    return textFiles;
  }

  private async materializeWorkspace(
    recordInput: AssetRelocationStoredOperation,
  ): Promise<{ record: AssetRelocationStoredOperation; workspace: AssetRelocationOperationWorkspace }> {
    let record = recordInput;
    const workspace = await createAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    for (let index = 0; index < record.textFiles.length; index += 1) {
      const file = record.textFiles[index]!;
      const mode = (await fs.stat(absoluteAssetImportProjectPath(this.paths, file.path))).mode & 0o777;
      const preparedIdentity = await writeExclusiveText(
        absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath),
        file.afterText,
        file.afterSha256,
        file.preparedIdentity,
        mode,
      );
      const backupIdentity = await writeExclusiveText(
        absoluteAssetImportProjectPath(this.paths, file.backupRelativePath),
        file.beforeText,
        file.beforeSha256,
        file.backupIdentity,
        mode,
      );
      if (sameJson(preparedIdentity, file.preparedIdentity)
        && sameJson(backupIdentity, file.backupIdentity)) continue;
      await this.fault('after_workspace_text_before_record');
      const textFiles = record.textFiles.map((candidate, candidateIndex) => (
        candidateIndex === index ? { ...candidate, preparedIdentity, backupIdentity } : candidate
      ));
      const next: AssetRelocationStoredOperation = {
        ...record,
        textFiles,
        journal: {
          ...record.journal,
          journalVersion: record.journal.journalVersion + 1,
          updatedAt: this.timestamp(),
        },
      };
      record = await this.store.replace(record, next);
    }
    return { record, workspace };
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
    const request = normalizeRelocationRequest(requestInput);
    return this.serialize(request.operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      const existing = await this.store.read(request.operationId);
      if (existing !== null) {
        if (!sameJson(existing.request, request)) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同素材整理');
        }
        if (existing.journal.status === 'PLANNED') {
          return this.detail((await this.materializeWorkspace(existing)).record);
        }
        return this.detail(existing);
      }
      const own = await this.store.list();
      if (own.some((operation) => !TERMINAL.has(operation.journal.status))) {
        throw new AssetImportAuthorityError('PROJECT_BUSY', '已有素材整理尚未结束');
      }
      const captured = await this.capture(request);
      const textFiles = await this.captureTextFiles(request, captured);
      const timestamp = this.timestamp();
      const record: AssetRelocationStoredOperation = {
        schemaVersion: 1,
        request,
        plan: captured.prepared.plan,
        scannedFiles: captured.prepared.scannedFiles,
        binaryBaseline: captured.prepared.binaryBaselines[0]!,
        binaryBaselines: captured.prepared.binaryBaselines,
        textFiles,
        journal: {
          schemaVersion: 1,
          operationId: request.operationId,
          journalVersion: 1,
          status: 'PLANNED',
          recoveryPhase: null,
          binaryState: 'SOURCE',
          binaryBackupRelativePath: relativeWorkspacePath(request.operationId, 'backup', 'source-0000.bin'),
          binaryBackupIdentity: null,
          binaryTargetIdentity: null,
          binaryItems: captured.prepared.plan.moves.map((move, index) => ({
            moveId: move.moveId,
            sourcePath: move.source.path,
            targetPath: move.target.path,
            state: 'SOURCE' as const,
            backupRelativePath: relativeWorkspacePath(request.operationId, 'backup', `source-${String(index).padStart(4, '0')}.bin`),
            backupIdentity: null,
            targetIdentity: null,
          })),
          textStates: textFiles.map(() => 'PENDING'),
          textResultIdentities: textFiles.map(() => null),
          updatedAt: timestamp,
        },
        receipt: null,
        undoReceipt: null,
      };
      let stored = await this.store.create(record);
      await this.fault('after_plan_record_before_workspace');
      stored = (await this.materializeWorkspace(stored)).record;
      return this.detail(stored);
    }));
  }

  private async assertFresh(record: AssetRelocationStoredOperation): Promise<void> {
    const captured = await this.capture(record.request);
    if (captured.prepared.plan.status !== 'ready'
      || captured.prepared.plan.planFingerprint !== record.plan.planFingerprint
      || !sameJson(captured.prepared.scannedFiles, record.scannedFiles)
      || !sameJson(captured.prepared.binaryBaselines, record.binaryBaselines)
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
      if (file.preparedIdentity === undefined || file.backupIdentity === undefined) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理准备文本缺少可证明的文件身份');
      }
      const prepared = await stableBinaryEvidence(
        absoluteAssetImportProjectPath(this.paths, file.preparedRelativePath),
      );
      const backup = await stableBinaryEvidence(
        absoluteAssetImportProjectPath(this.paths, file.backupRelativePath),
      );
      if (prepared.sha256 !== file.afterSha256
        || backup.sha256 !== file.beforeSha256
        || !sameFileIdentity(prepared.identity, file.preparedIdentity)
        || !sameFileIdentity(backup.identity, file.backupIdentity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理准备文本发生变化');
      }
    }
  }

  private async removePlannedWorkspace(record: AssetRelocationStoredOperation): Promise<void> {
    await assertAssetImportProjectRootIdentity(this.paths);
    const workspaceRoot = path.join(this.paths.relocationWorkspace, record.request.operationId);
    const rootStat = await fs.lstat(workspaceRoot).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (rootStat === null) return;
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消工作区身份不安全');
    }
    // A crash may leave a completed file before its node identity reaches the
    // durable operation record. Content equality is not ownership proof, so a
    // cancellation closes the registered plan but deliberately preserves the
    // whole workspace rather than risking deletion of an external replacement.
    if (record.textFiles.some((file) => file.preparedIdentity === undefined
      || file.backupIdentity === undefined)) return;
    const expected = {
      prepared: new Map(record.textFiles.map((file) => [path.posix.basename(file.preparedRelativePath), file.preparedIdentity])),
      backup: new Map(record.textFiles.map((file) => [path.posix.basename(file.backupRelativePath), file.backupIdentity])),
    };
    const rootEntries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    if (rootEntries.some((entry) => !['prepared', 'backup'].includes(entry.name)
      || !entry.isDirectory() || entry.isSymbolicLink())) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消工作区包含未知内容');
    }
    for (const group of ['prepared', 'backup'] as const) {
      const groupPath = path.join(workspaceRoot, group);
      const groupStat = await fs.lstat(groupPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (groupStat === null) continue;
      if (!groupStat.isDirectory() || groupStat.isSymbolicLink()) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消目录身份不安全');
      }
      let entries = await fs.readdir(groupPath, { withFileTypes: true });
      for (const [name, expectedIdentity] of expected[group]) {
        const interruptedName = `.${name}.surdet-relocation-removing`;
        if (!entries.some((entry) => entry.name === interruptedName)) continue;
        if (entries.some((entry) => entry.name === name) || expectedIdentity === undefined) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消目录包含冲突清理现场');
        }
        await removeOwnedExactFile(path.join(groupPath, name), expectedIdentity);
      }
      entries = await fs.readdir(groupPath, { withFileTypes: true });
      for (const entry of entries) {
        const expectedIdentity = expected[group].get(entry.name);
        if (expectedIdentity === undefined || !entry.isFile() || entry.isSymbolicLink()) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消目录包含未知文件');
        }
        const evidence = await stableBinaryEvidence(path.join(groupPath, entry.name));
        if (!sameFileIdentity(evidence.identity, expectedIdentity) || evidence.sha256 !== expectedIdentity.sha256) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消文件身份不一致');
        }
      }
      for (const entry of entries) {
        await removeOwnedExactFile(path.join(groupPath, entry.name), expected[group].get(entry.name)!);
      }
      await fs.rmdir(groupPath);
    }
    const remaining = await fs.readdir(workspaceRoot);
    if (remaining.length > 0) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理取消工作区未能安全清空');
    }
    await fs.rmdir(workspaceRoot);
    await syncParentDirectories(path.dirname(workspaceRoot));
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
    const { parent } = await safeProjectParent(this.paths, relativePath);
    const target = absoluteAssetImportProjectPath(this.paths, relativePath);
    const temporary = path.join(parent, `.surdet-relocation-${nonce}.tmp`);
    const displaced = path.join(parent, `.surdet-relocation-${nonce}.previous`);
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
      await this.fault('before_text_publish');
      let displacedEvidence = await fs.lstat(displaced).then(() => stableBinaryEvidence(displaced)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      let beforePublish = await projectFileEvidence(this.paths, relativePath);
      const resultIdentityMatches = beforePublish !== null && (knownResultIdentity === null
        ? sameNodeIdentity(beforePublish.identity, durableEvidence.identity)
        : sameFileIdentity(beforePublish.identity, knownResultIdentity));
      if (beforePublish !== null && beforePublish.sha256 === expectedResultSha256 && resultIdentityMatches) {
        if (displacedEvidence !== null) {
          if (displacedEvidence.sha256 !== expectedCurrentSha256
            || !sameFileIdentity(displacedEvidence.identity, expectedCurrentIdentity)) {
            throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布保留文件身份不一致：${relativePath}`);
          }
          await removeExactFile(displaced);
        }
        return relocationEvidence(beforePublish);
      }
      if (displacedEvidence === null) {
        if (beforePublish === null || beforePublish.sha256 !== expectedCurrentSha256
          || !sameFileIdentity(beforePublish.identity, expectedCurrentIdentity)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布前发生变化：${relativePath}`);
        }
        await fs.rename(target, displaced);
        await syncParentDirectories(parent);
        displacedEvidence = await stableBinaryEvidence(displaced);
        if (displacedEvidence.sha256 !== expectedCurrentSha256
          || !sameFileIdentity(displacedEvidence.identity, expectedCurrentIdentity)) {
          if (await projectFileEvidence(this.paths, relativePath) === null) {
            await fs.link(displaced, target);
            await syncFileAndParent(target);
          }
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布时捕获到外部修改：${relativePath}`);
        }
        beforePublish = null;
      } else if (displacedEvidence.sha256 !== expectedCurrentSha256
        || !sameFileIdentity(displacedEvidence.identity, expectedCurrentIdentity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布保留文件身份不一致：${relativePath}`);
      }
      if (beforePublish !== null) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布目标被外部占用：${relativePath}`);
      }
      await this.fault('after_text_displaced_before_publish');
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      await syncFileAndParent(target);
      const published = await projectFileEvidence(this.paths, relativePath);
      if (published === null || published.sha256 !== expectedResultSha256
        || !sameNodeIdentity(published.identity, durableEvidence.identity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布后身份不一致：${relativePath}`);
      }
      const beforeDiscard = await stableBinaryEvidence(displaced);
      if (beforeDiscard.sha256 !== expectedCurrentSha256
        || !sameFileIdentity(beforeDiscard.identity, expectedCurrentIdentity)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `文本发布保留文件在清理前发生变化：${relativePath}`);
      }
      await removeExactFile(displaced);
      return relocationEvidence(published);
    } finally {
      // Only discard the link belonging to this publication. In particular,
      // the occupied-path error above must not delete the unknown occupant.
      const remaining = await stableBinaryEvidence(temporary).catch(() => null);
      if (remaining !== null && sameNodeIdentity(remaining.identity, durableEvidence.identity)
        && remaining.sha256 === expectedResultSha256) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
    }
  }

  private async moveSourceToBackup(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
      let item = record.journal.binaryItems[index]!;
      const baseline = record.binaryBaselines[index]!;
      const backup = absoluteAssetImportProjectPath(this.paths, item.backupRelativePath);
      const source = absoluteAssetImportProjectPath(this.paths, item.sourcePath);
      if (item.state === 'SOURCE') {
        const evidence = await projectFileEvidence(this.paths, item.sourcePath);
        if (evidence === null || !sameFileIdentity(evidence.identity, baseline.source)
          || evidence.sha256 !== baseline.source.sha256 || await fileExists(backup)) {
          return this.enterRecovery(record.request.operationId, 'commit', `素材移动前身份已经变化：${item.sourcePath}`);
        }
        record = await this.updateBinaryItem(record, index, 'BACKUP_INTENT');
        item = record.journal.binaryItems[index]!;
        await this.fault('after_binary_backup_intent');
      }
      if (item.state !== 'BACKUP_INTENT') continue;
      const sourceEvidence = await projectFileEvidence(this.paths, item.sourcePath);
      const backupEvidence = await fs.lstat(backup).then(() => stableBinaryEvidence(backup)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (sourceEvidence !== null && backupEvidence === null) {
        if (!sameFileIdentity(sourceEvidence.identity, baseline.source)
          || sourceEvidence.sha256 !== baseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', `源素材不再匹配计划基线：${item.sourcePath}`);
        }
        await fs.link(source, backup);
        await syncFileAndParent(backup);
        const linked = await stableBinaryEvidence(backup);
        await this.fault('before_source_remove');
        const sourceBeforeRemove = await projectFileEvidence(this.paths, item.sourcePath);
        if (!sameFileIdentity(linked.identity, baseline.source) || linked.sha256 !== baseline.source.sha256
          || sourceBeforeRemove === null || !sameFileIdentity(sourceBeforeRemove.identity, baseline.source)
          || !sameNodeIdentity(sourceBeforeRemove.identity, linked.identity)
          || sourceBeforeRemove.sha256 !== baseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', `素材备份建立后源文件发生变化：${item.sourcePath}`);
        }
        await removeExactFile(source);
        await syncParentDirectories(path.dirname(backup));
      } else if (sourceEvidence !== null && backupEvidence !== null) {
        if (!sameFileIdentity(sourceEvidence.identity, baseline.source)
          || !sameFileIdentity(backupEvidence.identity, baseline.source)
          || !sameNodeIdentity(sourceEvidence.identity, backupEvidence.identity)
          || sourceEvidence.sha256 !== baseline.source.sha256 || backupEvidence.sha256 !== baseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', `素材备份中间状态身份不一致：${item.sourcePath}`);
        }
        await this.fault('before_source_remove');
        const sourceBeforeRemove = await projectFileEvidence(this.paths, item.sourcePath);
        const backupBeforeRemove = await stableBinaryEvidence(backup);
        if (sourceBeforeRemove === null || !sameFileIdentity(sourceBeforeRemove.identity, baseline.source)
          || !sameFileIdentity(backupBeforeRemove.identity, baseline.source)
          || !sameNodeIdentity(sourceBeforeRemove.identity, backupBeforeRemove.identity)
          || sourceBeforeRemove.sha256 !== baseline.source.sha256
          || backupBeforeRemove.sha256 !== baseline.source.sha256) {
          return this.enterRecovery(record.request.operationId, 'commit', `素材删除前身份发生变化：${item.sourcePath}`);
        }
        await removeExactFile(source);
        await syncParentDirectories(path.dirname(backup));
      } else if (backupEvidence === null || !sameFileIdentity(backupEvidence.identity, baseline.source)
        || backupEvidence.sha256 !== baseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'commit', `素材备份状态无法安全恢复：${item.sourcePath}`);
      }
      await this.fault('after_binary_backup_before_journal');
      const persistedBackup = await stableBinaryEvidence(backup);
      record = await this.updateBinaryItem(record, index, 'BACKUP', {
        backupIdentity: relocationEvidence(persistedBackup),
      });
    }
    return record;
  }

  private async publishTarget(recordInput: AssetRelocationStoredOperation): Promise<AssetRelocationStoredOperation> {
    let record = recordInput;
    await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
      let item = record.journal.binaryItems[index]!;
      const baseline = record.binaryBaselines[index]!;
      const backup = absoluteAssetImportProjectPath(this.paths, item.backupRelativePath);
      const target = absoluteAssetImportProjectPath(this.paths, item.targetPath);
      if (item.state === 'BACKUP') {
        if (await projectFileEvidence(this.paths, item.targetPath) !== null) {
          return this.enterRecovery(record.request.operationId, 'commit', `目标发布前项目路径状态不为空：${item.targetPath}`);
        }
        record = await this.updateBinaryItem(record, index, 'TARGET_INTENT');
        item = record.journal.binaryItems[index]!;
        await this.fault('after_target_link_intent');
      }
      if (item.state !== 'TARGET_INTENT') continue;
      const targetParent = await safeProjectParent(this.paths, item.targetPath);
      const currentTargetDirectory = await assetImportDirectoryIdentity(targetParent.parent);
      if (!sameDirectoryNodeIdentity(currentTargetDirectory, baseline.targetDirectory)) {
        return this.enterRecovery(record.request.operationId, 'commit', `目标目录身份发生变化：${item.targetPath}`);
      }
      const backupEvidence = await stableBinaryEvidence(backup);
      if (!sameFileIdentity(backupEvidence.identity, baseline.source)
        || backupEvidence.sha256 !== baseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'commit', `目标发布前备份身份发生变化：${item.targetPath}`);
      }
      let targetEvidence = await projectFileEvidence(this.paths, item.targetPath);
      if (targetEvidence === null) {
        await this.fault('before_target_publish');
        const publishParent = await safeProjectParent(this.paths, item.targetPath);
        const publishDirectory = await assetImportDirectoryIdentity(publishParent.parent);
        if (!sameDirectoryNodeIdentity(publishDirectory, baseline.targetDirectory)) {
          return this.enterRecovery(record.request.operationId, 'commit', `目标发布前目录身份发生变化：${item.targetPath}`);
        }
        try {
          await fs.link(backup, target);
          await syncFileAndParent(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        targetEvidence = await projectFileEvidence(this.paths, item.targetPath);
      }
      const targetDirectoryAfter = await safeProjectParent(this.paths, item.targetPath)
        .then(({ parent }) => assetImportDirectoryIdentity(parent));
      if (!sameDirectoryNodeIdentity(targetDirectoryAfter, baseline.targetDirectory)
        || targetEvidence === null || !sameNodeIdentity(targetEvidence.identity, backupEvidence.identity)
        || !sameFileIdentity(targetEvidence.identity, baseline.source)
        || targetEvidence.sha256 !== baseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'commit', `目标素材发布身份不一致：${item.targetPath}`);
      }
      await this.fault('after_target_link_before_journal');
      record = await this.updateBinaryItem(record, index, 'TARGET', {
        backupIdentity: relocationEvidence(backupEvidence),
        targetIdentity: relocationEvidence(targetEvidence),
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
    const targetPaths = new Set(record.journal.binaryItems.map((item) => portableFold(item.targetPath)));
    for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
      const item = record.journal.binaryItems[index]!;
      const baseline = record.binaryBaselines[index]!;
      const target = await projectFileEvidence(this.paths, item.targetPath);
      if (target === null || target.sha256 !== baseline.source.sha256
        || (item.targetIdentity !== null && !sameFileIdentity(target.identity, item.targetIdentity))) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `素材整理后的二进制状态不一致：${item.targetPath}`);
      }
      if (!targetPaths.has(portableFold(item.sourcePath))
        && await projectFileEvidence(this.paths, item.sourcePath) !== null) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `素材整理后的源路径仍存在：${item.sourcePath}`);
      }
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
      if (record.receipt === null
        || record.journal.binaryItems.some((item) => item.state !== 'TARGET'
          || item.backupIdentity === null || item.targetIdentity === null)
        || record.journal.textStates.some((state) => state !== 'REPLACED')
        || record.journal.textResultIdentities.some((identity) => identity === null)) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理成功终态记录不完整');
      }
      for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
        const item = record.journal.binaryItems[index]!;
        const receiptMove = record.receipt.moves[index];
        if (receiptMove === undefined
          || !sameFileIdentity(receiptMove.targetIdentity, item.targetIdentity!)) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `素材整理成功终态记录身份不一致：${item.targetPath}`);
        }
      }
    } else if (record.journal.status === 'ROLLED_BACK' || record.journal.status === 'CANCELLED') {
      if (record.receipt !== null || record.undoReceipt !== null
        || (record.journal.status === 'ROLLED_BACK'
          && record.journal.binaryItems.some((item) => item.state !== 'ROLLED_BACK'))
        || (record.journal.status === 'CANCELLED'
          && record.journal.binaryItems.some((item) => item.state !== 'SOURCE'))) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理回退终态记录不完整');
      }
    } else {
      if (record.receipt === null || record.undoReceipt === null
        || record.journal.binaryItems.some((item) => item.state !== 'UNDONE')
        || record.journal.textStates.some((state) => state !== 'UNDONE')) {
        throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材整理撤销终态记录不完整');
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
      const moves = [];
      for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
        const item = record.journal.binaryItems[index]!;
        const baseline = record.binaryBaselines[index]!;
        const target = await projectFileEvidence(this.paths, item.targetPath);
        if (target === null || item.targetIdentity === null
          || target.sha256 !== baseline.source.sha256
          || !sameFileIdentity(target.identity, item.targetIdentity)) {
          return this.enterRecovery(record.request.operationId, 'commit', `完成回执缺少可信目标素材：${item.targetPath}`);
        }
        moves.push({
          moveId: item.moveId,
          sourcePath: item.sourcePath,
          targetPath: item.targetPath,
          targetIdentity: relocationEvidence(target),
        });
      }
      const textFiles = [];
      for (let index = 0; index < record.textFiles.length; index += 1) {
        const file = record.textFiles[index]!;
        const identity = record.journal.textResultIdentities[index];
        if (identity === null || identity === undefined) {
          throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', `完成回执缺少文本身份：${file.path}`);
        }
        const current = await projectFileEvidence(this.paths, file.path);
        if (current === null || current.sha256 !== file.afterSha256
          || !sameFileIdentity(current.identity, identity)) {
          return this.enterRecovery(record.request.operationId, 'commit', `完成回执缺少可信文本结果：${file.path}`);
        }
        textFiles.push({ path: file.path, sha256: file.afterSha256, identity });
      }
      const semantic = {
        schemaVersion: 1 as const,
        receiptId: crypto.randomUUID(),
        operationId: record.request.operationId,
        planId: record.plan.planId,
        planFingerprint: record.plan.planFingerprint,
        projectIdentity: this.paths.projectIdentity,
        sourcePath: record.request.sourcePath,
        targetPath: record.request.targetPath,
        targetIdentity: moves[0]!.targetIdentity,
        moves,
        textFiles,
        committedAt: this.timestamp(),
      };
      const receipt: AssetRelocationReceipt = {
        ...semantic,
        receiptFingerprint: await this.textHasher.sha256(stableStringify(semantic)),
      };
      await this.fault('before_receipt_persist');
      await this.verifyCommittedFiles(record);
      record = await this.update(record, { receipt });
    }
    await this.verifyCommittedFiles(record);
    await this.fault('after_receipt_before_committed');
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
    await this.fault('after_binary_backups_before_targets');
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
        if (state === 'ROLLBACK_INTENT') {
          const afterIdentity = record.journal.textResultIdentities[index];
          if (afterIdentity !== null && afterIdentity !== undefined) {
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
            continue;
          }
        }
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
      if (state !== 'ROLLBACK_INTENT' || record.journal.textResultIdentities[index] === null) {
        record = await this.updateText(record, index, 'ROLLBACK_INTENT', afterIdentity);
      }
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

    await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
    let binaryRecoveryMessage: string | null = null;
    for (let index = record.journal.binaryItems.length - 1; index >= 0; index -= 1) {
      let item = record.journal.binaryItems[index]!;
      if (item.state === 'SOURCE' || item.state === 'ROLLED_BACK' || item.state === 'BACKUP_INTENT' || item.state === 'BACKUP') continue;
      const baseline = record.binaryBaselines[index]!;
      const backup = absoluteAssetImportProjectPath(this.paths, item.backupRelativePath);
      const targetParent = await safeProjectParent(this.paths, item.targetPath);
      const targetDirectory = await assetImportDirectoryIdentity(targetParent.parent);
      if (!sameDirectoryNodeIdentity(targetDirectory, baseline.targetDirectory)) {
        binaryRecoveryMessage ??= `目标目录在回滚前发生变化：${item.targetPath}`;
        continue;
      }
      const target = await projectFileEvidence(this.paths, item.targetPath);
      if (target !== null) {
        const backupEvidence = await stableBinaryEvidence(backup);
        if (!sameNodeIdentity(target.identity, backupEvidence.identity)
          || !sameFileIdentity(target.identity, baseline.source)
          || target.sha256 !== baseline.source.sha256) {
          binaryRecoveryMessage ??= `外部修改阻止素材目标回滚：${item.targetPath}`;
          continue;
        }
        if (item.state !== 'ROLLBACK_INTENT') {
          record = await this.updateBinaryItem(record, index, 'ROLLBACK_INTENT');
          item = record.journal.binaryItems[index]!;
        }
        await this.fault('after_rollback_target_intent');
        const targetParentBeforeRemove = await safeProjectParent(this.paths, item.targetPath);
        const targetDirectoryBeforeRemove = await assetImportDirectoryIdentity(targetParentBeforeRemove.parent);
        const targetBeforeRemove = await projectFileEvidence(this.paths, item.targetPath);
        if (!sameDirectoryNodeIdentity(targetDirectoryBeforeRemove, baseline.targetDirectory)
          || targetBeforeRemove === null || !sameNodeIdentity(targetBeforeRemove.identity, backupEvidence.identity)
          || !sameFileIdentity(targetBeforeRemove.identity, baseline.source)
          || targetBeforeRemove.sha256 !== baseline.source.sha256) {
          binaryRecoveryMessage ??= `目标素材在回滚删除前发生变化：${item.targetPath}`;
          continue;
        }
        await removeExactFile(absoluteAssetImportProjectPath(this.paths, item.targetPath));
      }
    }
    for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
      const item = record.journal.binaryItems[index]!;
      const baseline = record.binaryBaselines[index]!;
      const backup = absoluteAssetImportProjectPath(this.paths, item.backupRelativePath);
      let source = await projectFileEvidence(this.paths, item.sourcePath);
      const backupExists = await fileExists(backup);
      if (source === null && backupExists) {
        await fs.link(backup, absoluteAssetImportProjectPath(this.paths, item.sourcePath));
        await syncFileAndParent(absoluteAssetImportProjectPath(this.paths, item.sourcePath));
        source = await projectFileEvidence(this.paths, item.sourcePath);
      }
      if (source === null || source.sha256 !== baseline.source.sha256) {
        return this.enterRecovery(record.request.operationId, 'rollback', `素材源路径无法安全恢复：${item.sourcePath}`);
      }
      if (backupExists) {
        const backupEvidence = await stableBinaryEvidence(backup);
        if (!sameNodeIdentity(source.identity, backupEvidence.identity)) {
          return this.enterRecovery(record.request.operationId, 'rollback', `素材源路径恢复后身份不一致：${item.sourcePath}`);
        }
      } else if (!sameFileIdentity(source.identity, baseline.source)) {
        return this.enterRecovery(record.request.operationId, 'rollback', `未移动素材身份已经变化：${item.sourcePath}`);
      }
      record = await this.updateBinaryItem(record, index, 'ROLLED_BACK', {
        backupIdentity: backupExists ? relocationEvidence(await stableBinaryEvidence(backup)) : null,
        targetIdentity: null,
      });
    }
    if (binaryRecoveryMessage !== null) {
      return this.enterRecovery(record.request.operationId, 'rollback', binaryRecoveryMessage);
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
        await this.barrierStore.resolveRelocationBarriers(operationId);
        return this.detail(record);
      }
      if (record.journal.status !== 'PLANNED') throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '当前状态不能提交素材整理');
      if (record.plan.status !== 'ready') throw new AssetImportAuthorityError('IMPORT_PLAN_BLOCKED', '素材整理计划仍有阻断项');
      if (record.plan.planFingerprint !== request.planFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '计划指纹不匹配');
      }
      record = (await this.materializeWorkspace(record)).record;
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
    if (record.receipt === null) throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', '成功回执缺失，不能撤销');
    try {
      await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
      const targetPaths = new Set(record.journal.binaryItems.map((item) => portableFold(item.targetPath)));
      for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
        const item = record.journal.binaryItems[index]!;
        const baseline = record.binaryBaselines[index]!;
        const backup = await stableBinaryEvidence(absoluteAssetImportProjectPath(this.paths, item.backupRelativePath));
        const target = await projectFileEvidence(this.paths, item.targetPath);
        const receiptMove = record.receipt.moves[index];
        if (target === null || receiptMove === undefined
          || !sameNodeIdentity(target.identity, backup.identity)
          || !sameFileIdentity(target.identity, receiptMove.targetIdentity)
          || target.sha256 !== baseline.source.sha256) {
          throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', `目标素材已经变化，不能撤销：${item.targetPath}`);
        }
        if (!targetPaths.has(portableFold(item.sourcePath))
          && await projectFileEvidence(this.paths, item.sourcePath) !== null) {
          throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', `源路径已被占用，不能撤销：${item.sourcePath}`);
        }
      }
      for (const [index, file] of record.textFiles.entries()) {
        const current = await projectFileEvidence(this.paths, file.path);
        const expected = record.journal.textResultIdentities[index];
        if (current === null || expected == null || current.sha256 !== file.afterSha256
          || !sameFileIdentity(current.identity, expected)) {
          throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', `引用文件已经变化，不能撤销：${file.path}`);
        }
      }
    } catch (error) {
      if (error instanceof AssetImportAuthorityError) throw error;
      throw new AssetImportAuthorityError('IMPORT_UNDO_BLOCKED_CHANGED', '撤销所需的操作备份缺失或身份不安全');
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
        if (state === 'UNDO_INTENT') {
          const afterIdentity = record.journal.textResultIdentities[index];
          if (afterIdentity !== null && afterIdentity !== undefined) {
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
            continue;
          }
        }
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

    if (record.journal.binaryItems.some((item) => item.state !== 'UNDONE')) {
      await assertAssetRelocationProjectWorkspace(this.paths, record.request.operationId);
      for (let index = record.journal.binaryItems.length - 1; index >= 0; index -= 1) {
        let item = record.journal.binaryItems[index]!;
        const baseline = record.binaryBaselines[index]!;
        const backup = await stableBinaryEvidence(absoluteAssetImportProjectPath(this.paths, item.backupRelativePath));
        const targetParent = await safeProjectParent(this.paths, item.targetPath);
        const targetDirectory = await assetImportDirectoryIdentity(targetParent.parent);
        if (!sameDirectoryNodeIdentity(targetDirectory, baseline.targetDirectory)) {
          return this.enterRecovery(record.request.operationId, 'undo', `目标目录在撤销前发生变化：${item.targetPath}`);
        }
        const target = await projectFileEvidence(this.paths, item.targetPath);
        if (target !== null && (!sameNodeIdentity(target.identity, backup.identity)
          || !sameFileIdentity(target.identity, baseline.source)
          || target.sha256 !== baseline.source.sha256)) {
          return this.enterRecovery(record.request.operationId, 'undo', `目标素材已被外部修改：${item.targetPath}`);
        }
        if (item.state !== 'UNDO_INTENT' && item.state !== 'UNDONE') {
          record = await this.updateBinaryItem(record, index, 'UNDO_INTENT');
          item = record.journal.binaryItems[index]!;
        }
        if (target !== null) {
          await this.fault('after_undo_target_intent');
          const targetParentBeforeRemove = await safeProjectParent(this.paths, item.targetPath);
          const targetDirectoryBeforeRemove = await assetImportDirectoryIdentity(targetParentBeforeRemove.parent);
          const targetBeforeRemove = await projectFileEvidence(this.paths, item.targetPath);
          if (!sameDirectoryNodeIdentity(targetDirectoryBeforeRemove, baseline.targetDirectory)
            || targetBeforeRemove === null || !sameNodeIdentity(targetBeforeRemove.identity, backup.identity)
            || !sameFileIdentity(targetBeforeRemove.identity, baseline.source)
            || targetBeforeRemove.sha256 !== baseline.source.sha256) {
            return this.enterRecovery(record.request.operationId, 'undo', `目标素材在撤销删除前发生变化：${item.targetPath}`);
          }
          await removeExactFile(absoluteAssetImportProjectPath(this.paths, item.targetPath));
        }
      }
      for (let index = 0; index < record.journal.binaryItems.length; index += 1) {
        const item = record.journal.binaryItems[index]!;
        const backup = await stableBinaryEvidence(absoluteAssetImportProjectPath(this.paths, item.backupRelativePath));
        let source = await projectFileEvidence(this.paths, item.sourcePath);
        if (source === null) {
          await fs.link(absoluteAssetImportProjectPath(this.paths, item.backupRelativePath), absoluteAssetImportProjectPath(this.paths, item.sourcePath));
          await syncFileAndParent(absoluteAssetImportProjectPath(this.paths, item.sourcePath));
          source = await projectFileEvidence(this.paths, item.sourcePath);
        }
        if (source === null || !sameNodeIdentity(source.identity, backup.identity)) {
          return this.enterRecovery(record.request.operationId, 'undo', `源素材撤销身份不一致：${item.sourcePath}`);
        }
        record = await this.updateBinaryItem(record, index, 'UNDONE', {
          backupIdentity: relocationEvidence(backup),
          targetIdentity: null,
        });
      }
    }

    if (record.undoReceipt === null) {
      const moves = [];
      for (const item of record.journal.binaryItems) {
        const restoredSource = await projectFileEvidence(this.paths, item.sourcePath);
        if (restoredSource === null) {
          return this.enterRecovery(record.request.operationId, 'undo', `撤销回执缺少恢复后的源素材：${item.sourcePath}`);
        }
        moves.push({
          moveId: item.moveId,
          sourcePath: item.sourcePath,
          targetPath: item.targetPath,
          sourceIdentity: relocationEvidence(restoredSource),
        });
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
        sourceIdentity: moves[0]!.sourceIdentity,
        moves,
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
        await this.barrierStore.resolveRelocationBarriers(operationId);
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
      try {
        if (phase === 'undo') {
          if (request.action === 'rollback') {
            throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '撤销已经开始，只能继续完成');
          }
          if (record.journal.status === 'RECOVERY_REQUIRED') {
            record = await this.update(record, { journal: { status: 'UNDOING', recoveryPhase: 'undo' } });
          }
          return this.detail(await this.continueUndo(record));
        }
        if (record.receipt !== null) return this.detail(await this.finishCommit(record));
        if (request.action === 'rollback' || phase === 'rollback') {
          return this.detail(await this.continueRollback(record));
        }
        await this.assertRecoveryReferencesFresh(record);
        if (record.journal.status === 'RECOVERY_REQUIRED') {
          record = await this.update(record, { journal: { status: 'PUBLISHING', recoveryPhase: 'commit' } });
        }
        return this.detail(await this.continueCommit(record));
      } catch (error) {
        if (error instanceof AssetRelocationInjectedTermination || error instanceof AssetImportAuthorityError) throw error;
        const recoveryPhase = phase === 'undo' ? 'undo'
          : record.receipt !== null ? 'commit'
            : request.action === 'rollback' || phase === 'rollback' ? 'rollback' : 'commit';
        return this.enterRecovery(operationId, recoveryPhase, error instanceof Error ? error.message : '素材整理恢复失败');
      }
    }));
  }

  async cancel(operationIdInput: string): Promise<AssetRelocationDetailResponse> {
    const operationId = requireUuid(operationIdInput, 'operationId');
    return this.serialize(operationId, () => this.mutationCoordinator.run('asset-relocation', async () => {
      let record = await this.store.read(operationId);
      if (record === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '素材整理操作不存在');
      if (record.journal.status === 'CANCELLED') {
        await this.verifyTerminalResolution(operationId);
        await this.barrierStore.resolveRelocationBarriers(operationId);
        return this.detail(record);
      }
      if (record.journal.status !== 'PLANNED') {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '只有未提交的整理计划可以取消');
      }
      await this.removePlannedWorkspace(record);
      await this.fault('after_cancel_workspace_before_record');
      record = await this.update(record, { journal: { status: 'CANCELLED', recoveryPhase: null } });
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
    if (TERMINAL.has(record.journal.status)) {
      await this.verifyTerminalResolution(operationId);
      await this.barrierStore.resolveRelocationBarriers(operationId);
    }
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
      if (TERMINAL.has(record.journal.status)) {
        await this.verifyTerminalResolution(record.request.operationId);
        await this.barrierStore.resolveRelocationBarriers(record.request.operationId);
      }
    }
    return {
      operations: records.map((record) => ({
        operationId: record.request.operationId,
        status: record.journal.status,
        sourcePath: record.request.sourcePath,
        targetPath: record.request.targetPath,
        moves: record.request.moves,
        updatedAt: record.journal.updatedAt,
        manualRecoveryRequired: record.journal.status === 'RECOVERY_REQUIRED',
      })),
      recentReceipts: records.flatMap((record) => record.receipt === null ? [] : [record.receipt]),
    };
  }
}
