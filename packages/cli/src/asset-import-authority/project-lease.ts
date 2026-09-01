import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NodeLocalLeaseManager, type LeaseHandle } from '../authoring/node-local-lease.js';
import { AssetImportAuthorityError } from './types.js';

export interface AssetImportProjectLease {
  ownerToken: string;
  release(): Promise<void>;
}

export async function acquireAssetImportProjectLease(options: {
  projectRoot: string;
  dataRoot: string;
}): Promise<AssetImportProjectLease> {
  if (!path.isAbsolute(options.projectRoot) || !path.isAbsolute(options.dataRoot)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'lease 路径必须是绝对路径');
  }
  const canonicalProjectRoot = await fs.realpath(options.projectRoot);
  const manager = new NodeLocalLeaseManager(options.dataRoot);
  let handle: LeaseHandle;
  try {
    handle = await manager.acquire({ scope: 'project', resourceId: canonicalProjectRoot });
  } catch (error) {
    if ((error as { code?: string }).code === 'PROJECT_BUSY') throw error;
    throw error;
  }
  return { ownerToken: handle.ownerToken, release: () => handle.release() };
}
