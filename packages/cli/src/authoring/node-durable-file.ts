import * as fs from 'node:fs/promises';
import * as path from 'node:path';

function isUnsupportedDirectorySync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return process.platform === 'win32' && (code === 'EPERM' || code === 'EINVAL' || code === 'EISDIR');
}

export async function syncDirectory(directory: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
    return true;
  } catch (error) {
    if (isUnsupportedDirectorySync(error)) return false;
    throw error;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

async function reconcileDirectoryAfterUnsupportedSync(directory: string): Promise<void> {
  // Windows does not expose a directory handle that Node can FlushFileBuffers.
  // Reopen and enumerate the directory so callers never silently discard the
  // degraded guarantee; restart reconciliation remains the durable authority.
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`directory durability reconciliation rejected an unsafe path: ${directory}`);
  }
  await fs.readdir(directory);
}

async function syncDirectoryOrReconcile(directory: string): Promise<void> {
  if (!await syncDirectory(directory)) await reconcileDirectoryAfterUnsupportedSync(directory);
}

export async function syncFileAndParent(file: string): Promise<void> {
  // Windows requires a writable handle for FlushFileBuffers/fsync.
  const handle = await fs.open(file, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectoryOrReconcile(path.dirname(file));
}

export async function syncParentDirectories(...directories: string[]): Promise<void> {
  for (const directory of [...new Set(directories.map((entry) => path.resolve(entry)))]) {
    await syncDirectoryOrReconcile(directory);
  }
}
