import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export type JsonFileOps = Pick<typeof fs, 'openSync' | 'closeSync' | 'writeFileSync' | 'renameSync' | 'lstatSync' | 'unlinkSync'>;

/** Store roots and final entries may not redirect user-data operations through links. */
export function assertOrdinaryDirectory(directory: string, ops: Pick<typeof fs, 'lstatSync'> = fs): fs.Stats {
  const stat = ops.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`数据目录不是普通目录：${directory}`);
  return stat;
}

export function assertOrdinaryFile(file: string, ops: Pick<typeof fs, 'lstatSync'> = fs): void {
  try {
    const stat = ops.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`数据文件不是普通文件：${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** An exclusive temporary belongs to this call, never to another writer or an old .tmp entry. */
export function writeFileAtomic(filePath: string, data: string | Uint8Array, ops: JsonFileOps = fs): void {
  const directory = path.dirname(filePath);
  const parent = assertOrdinaryDirectory(directory, ops);
  assertOrdinaryFile(filePath, ops);
  const tmp = path.join(directory, `.surdet-${randomUUID()}.tmp`);
  let fd: number | undefined = ops.openSync(tmp, 'wx', 0o600);
  let published = false;
  try {
    ops.writeFileSync(fd, data);
    ops.closeSync(fd); fd = undefined;
    const current = assertOrdinaryDirectory(directory, ops);
    if (parent.dev !== current.dev || parent.ino !== current.ino) throw new Error('写入期间数据目录已被替换');
    assertOrdinaryFile(filePath, ops);
    ops.renameSync(tmp, filePath);
    published = true;
  } finally {
    if (fd !== undefined) ops.closeSync(fd);
    if (!published) {
      try { ops.unlinkSync(tmp); } catch { /* Preserve the write/publish error. */ }
    }
  }
}

export function writeJsonAtomic(filePath: string, value: unknown, ops: JsonFileOps = fs): void {
  writeFileAtomic(filePath, JSON.stringify(value), ops);
}
