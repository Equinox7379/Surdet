import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createJsonRecord, readJsonRecord } from '../authoring/node-json-record.js';
import { AssetImportAuthorityError, type AssetImportAuthorityPaths, type ProjectRootBindingIdentity } from './types.js';
import type { ProjectAssetImportTargetFact } from '@surdet/authoring';

interface StoredRootIdentity {
  schemaVersion: 1;
  authority: 'asset-import-authority';
  platform: NodeJS.Platform;
  canonicalRealPath: string;
  device: string;
  inode: string;
  birthtimeNs: string;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function ensurePlainChildDirectory(parent: string, name: string): Promise<string> {
  const target = path.join(parent, name);
  try {
    await fs.mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', '素材导入持久目录身份不安全', { field: name });
  }
  const real = await fs.realpath(target);
  if (real !== target) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', '素材导入持久目录发生了重定向', { field: name });
  }
  return target;
}

async function assertPlainDirectory(directory: string, field: string): Promise<void> {
  const stat = await fs.lstat(directory).catch((error: unknown) => {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材导入持久目录缺失', {
      field,
      cause: errorCode(error),
    });
  });
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '素材导入持久目录身份不安全', { field });
  }
}

const AUTHORITY_NAMESPACE_DIRECTORIES = [
  'operation-index',
  'operations',
  'challenge-index',
  'challenges',
  'recovery-barriers',
  'recovery-resolutions',
] as const;

function defaultDataRoot(): string {
  if (process.platform === 'win32') {
    const base = process.env['LOCALAPPDATA'];
    if (base) return path.join(base, 'Surdet', 'asset-import-authority', 'v1');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Surdet', 'asset-import-authority', 'v1');
  const stateRoot = process.env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state');
  return path.join(stateRoot, 'surdet', 'asset-import-authority', 'v1');
}

function statIdentity(stat: Awaited<ReturnType<typeof fs.lstat>>): { device: string; inode: string; birthtimeNs: string } {
  const bigint = stat as unknown as { dev: bigint | number; ino: bigint | number; birthtimeNs?: bigint; birthtimeMs: number };
  const birthtimeNs = bigint.birthtimeNs ?? BigInt(Math.trunc(bigint.birthtimeMs * 1_000_000));
  return { device: String(bigint.dev), inode: String(bigint.ino), birthtimeNs: String(birthtimeNs) };
}

async function openRealDirectory(input: string, field: string): Promise<{ realPath: string; identity: ReturnType<typeof statIdentity> }> {
  const stat = await fs.lstat(input).catch((error: unknown) => {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 不是可读取目录`, { field, cause: errorCode(error) });
  });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `${field} 必须是真实目录`, { field });
  }
  const realPath = await fs.realpath(input);
  const realStat = await fs.lstat(realPath);
  if (!realStat.isDirectory() || realStat.isSymbolicLink()) {
    throw new AssetImportAuthorityError('IMPORT_TARGET_UNSAFE', `${field} 解析后不是安全目录`, { field });
  }
  return { realPath, identity: statIdentity(realStat) };
}

function canonicalSha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameStoredIdentity(left: StoredRootIdentity, right: StoredRootIdentity): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.authority === right.authority
    && left.platform === right.platform
    && left.canonicalRealPath === right.canonicalRealPath
    && left.device === right.device
    && left.inode === right.inode
    && left.birthtimeNs === right.birthtimeNs;
}

function portableFold(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase();
}

export async function assertAssetImportProjectRootIdentity(paths: AssetImportAuthorityPaths): Promise<void> {
  const current = await openRealDirectory(paths.projectRoot, 'projectRoot');
  const expected = paths.rootIdentity;
  if (current.realPath !== expected.canonicalRootRealPath
    || current.identity.device !== expected.device
    || current.identity.inode !== expected.inode
    || current.identity.birthtimeNs !== expected.birthtimeNs) {
    throw new AssetImportAuthorityError('IMPORT_PROJECT_STALE', '项目目录身份已变化');
  }
}

export async function assertAssetImportDataNamespace(paths: AssetImportAuthorityPaths): Promise<void> {
  await assertPlainDirectory(paths.dataRoot, 'dataRoot');
  const projects = path.join(paths.dataRoot, 'projects');
  await assertPlainDirectory(projects, 'projects');
  await assertPlainDirectory(paths.projectNamespace, 'projectNamespace');
  for (const directory of AUTHORITY_NAMESPACE_DIRECTORIES) {
    await assertPlainDirectory(path.join(paths.projectNamespace, directory), directory);
  }
}

export async function createAssetImportOperationWorkspace(
  paths: AssetImportAuthorityPaths,
  operationId: string,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'operationId 格式无效');
  }
  await assertAssetImportDataNamespace(paths);
  const operation = await ensurePlainChildDirectory(path.join(paths.projectNamespace, 'operations'), operationId);
  await ensurePlainChildDirectory(operation, 'items');
  await ensurePlainChildDirectory(operation, 'staging');
  await ensurePlainChildDirectory(operation, 'upload-intents');
}

export async function assertAssetImportOperationWorkspace(
  paths: AssetImportAuthorityPaths,
  operationId: string,
): Promise<void> {
  await assertAssetImportDataNamespace(paths);
  const operation = path.join(paths.projectNamespace, 'operations', operationId);
  await assertPlainDirectory(operation, 'operation');
  await assertPlainDirectory(path.join(operation, 'items'), 'items');
  await assertPlainDirectory(path.join(operation, 'staging'), 'staging');
  await assertPlainDirectory(path.join(operation, 'upload-intents'), 'upload-intents');
}

export async function inspectAssetImportTarget(
  paths: AssetImportAuthorityPaths,
  relativePath: string,
): Promise<ProjectAssetImportTargetFact> {
  const normalized = relativePath.normalize('NFC');
  const segments = normalized.split('/');
  const unsafe = (): ProjectAssetImportTargetFact => ({ path: normalized, state: 'unsafe' });
  if (segments.length !== 4 || segments[0] !== 'content' || segments[1] !== 'assets'
    || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return unsafe();

  await assertAssetImportProjectRootIdentity(paths);
  let current = paths.projectRoot;
  for (const segment of segments.slice(0, -1)) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error: unknown) => {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    });
    if (entries === null) return { path: normalized, state: 'absent' };
    const matches = entries.filter((entry) => portableFold(entry.name) === portableFold(segment));
    if (matches.length === 0) return { path: normalized, state: 'absent' };
    if (matches.length !== 1 || matches[0]!.name !== segment) return unsafe();
    const next = path.join(current, matches[0]!.name);
    const stat = await fs.lstat(next);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return unsafe();
    current = next;
  }

  const finalName = segments.at(-1)!;
  const entries = await fs.readdir(current, { withFileTypes: true }).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  });
  if (entries === null) return { path: normalized, state: 'absent' };
  const matches = entries.filter((entry) => portableFold(entry.name) === portableFold(finalName));
  if (matches.length === 0) return { path: normalized, state: 'absent' };
  if (matches.length !== 1) return unsafe();
  const target = path.join(current, matches[0]!.name);
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) return unsafe();
  if (stat.isFile()) return { path: normalized, state: 'exists-file' };
  if (stat.isDirectory()) return { path: normalized, state: 'exists-directory' };
  return unsafe();
}

async function ensureStoredIdentity(file: string, expected: StoredRootIdentity): Promise<void> {
  try {
    const existing = await readJsonRecord<StoredRootIdentity>(file);
    if (existing === null) {
      await createJsonRecord(file, expected);
      return;
    }
    if (!sameStoredIdentity(existing.value, expected)) {
      throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '持久目录身份发生变化', { field: path.basename(file) });
    }
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return ensureStoredIdentity(file, expected);
    if (error instanceof AssetImportAuthorityError) throw error;
    throw new AssetImportAuthorityError('IMPORT_RECOVERY_REQUIRED', '持久目录身份无法验证', {
      field: path.basename(file),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function openAssetImportAuthorityPaths(options: {
  projectRoot: string;
  dataRoot?: string;
}): Promise<AssetImportAuthorityPaths> {
  if (!path.isAbsolute(options.projectRoot)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'projectRoot 必须是绝对路径', { field: 'projectRoot' });
  }
  const requestedDataRoot = options.dataRoot ?? defaultDataRoot();
  if (!path.isAbsolute(requestedDataRoot)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'dataRoot 必须是绝对路径', { field: 'dataRoot' });
  }

  const project = await openRealDirectory(options.projectRoot, 'projectRoot');
  await fs.mkdir(requestedDataRoot, { recursive: true, mode: 0o700 });
  const data = await openRealDirectory(requestedDataRoot, 'dataRoot');
  const dataIdentity: StoredRootIdentity = {
    schemaVersion: 1,
    authority: 'asset-import-authority',
    platform: process.platform,
    canonicalRealPath: data.realPath,
    ...data.identity,
  };
  await ensureStoredIdentity(path.join(data.realPath, 'data-root-identity.json'), dataIdentity);

  const publicProjectIdentity = canonicalSha256({
    schemaVersion: 1,
    platform: process.platform,
    canonicalRootRealPath: project.realPath,
    ...project.identity,
  });
  const rootIdentity: ProjectRootBindingIdentity = {
    canonicalRootRealPath: project.realPath,
    platform: process.platform,
    ...project.identity,
    publicProjectIdentity,
  };
  const projectsDirectory = await ensurePlainChildDirectory(data.realPath, 'projects');
  const projectNamespace = await ensurePlainChildDirectory(projectsDirectory, publicProjectIdentity);
  await ensureStoredIdentity(path.join(projectNamespace, 'project-identity.json'), {
    schemaVersion: 1,
    authority: 'asset-import-authority',
    platform: process.platform,
    canonicalRealPath: project.realPath,
    ...project.identity,
  });
  for (const directory of AUTHORITY_NAMESPACE_DIRECTORIES) {
    await ensurePlainChildDirectory(projectNamespace, directory);
  }

  return {
    dataRoot: data.realPath,
    projectRoot: project.realPath,
    projectIdentity: publicProjectIdentity,
    projectNamespace,
    internalWorkspace: path.join(project.realPath, '.surdet', 'asset-import'),
    rootIdentity,
  };
}
