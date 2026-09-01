import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createJsonRecord, readJsonRecord } from '../authoring/node-json-record.js';
import { AssetImportAuthorityError, type AssetImportAuthorityPaths, type ProjectRootBindingIdentity } from './types.js';

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
  const projectNamespace = path.join(data.realPath, 'projects', publicProjectIdentity);
  await fs.mkdir(projectNamespace, { recursive: true, mode: 0o700 });
  await ensureStoredIdentity(path.join(projectNamespace, 'project-identity.json'), {
    schemaVersion: 1,
    authority: 'asset-import-authority',
    platform: process.platform,
    canonicalRealPath: project.realPath,
    ...project.identity,
  });

  return {
    dataRoot: data.realPath,
    projectRoot: project.realPath,
    projectIdentity: publicProjectIdentity,
    projectNamespace,
    internalWorkspace: path.join(project.realPath, '.surdet', 'asset-import'),
    rootIdentity,
  };
}
