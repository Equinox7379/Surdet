import * as crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthoringOperationError } from '@surdet/authoring';
import { syncFileAndParent, syncParentDirectories } from './node-durable-file.js';
import { replaceFileByRename } from './node-file-replacement.js';

export interface JsonRecordIdentity {
  path: string;
  bytes: number;
  sha256: string;
}

function identity(file: string, bytes: Uint8Array): JsonRecordIdentity {
  return {
    path: file,
    bytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function serialize(value: unknown): Buffer {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new AuthoringOperationError('INVALID_REQUEST', 'JSON record 不能序列化 undefined');
  return Buffer.from(`${json}\n`, 'utf8');
}

async function writeSyncedTemporary(file: string, bytes: Uint8Array): Promise<string> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.write(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const reread = await fs.readFile(temporary);
    const expected = identity(temporary, bytes);
    const actual = identity(temporary, reread);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new AuthoringOperationError('CHANGE_STORE_CORRUPT', `临时 JSON record 回读身份不匹配：${file}`, {
        path: file,
        temporary,
        expectedBytes: expected.bytes,
        actualBytes: actual.bytes,
        expectedSha256: expected.sha256,
        actualSha256: actual.sha256,
      });
    }
    return temporary;
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function sameOpenedFile(
  left: Awaited<ReturnType<fs.FileHandle['stat']>>,
  right: Awaited<ReturnType<fs.FileHandle['stat']>>,
): boolean {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function corruptRecord(file: string, message: string): AuthoringOperationError {
  return new AuthoringOperationError('CHANGE_STORE_CORRUPT', `${message}：${file}`, { path: file });
}

async function readBytes(file: string): Promise<{ bytes: Buffer; identity: JsonRecordIdentity } | null> {
  let pathBefore: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    pathBefore = await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw corruptRecord(file, 'JSON record 不是普通文件');
  }

  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | noFollow);
    const openedBefore = await handle.stat();
    if (!openedBefore.isFile()
      || openedBefore.dev !== pathBefore.dev
      || openedBefore.ino !== pathBefore.ino) {
      throw corruptRecord(file, 'JSON record 打开对象与路径身份不一致');
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat();
    const pathAfter = await fs.lstat(file).catch(() => null);
    if (!sameOpenedFile(openedBefore, openedAfter)
      || pathAfter === null
      || !pathAfter.isFile()
      || pathAfter.isSymbolicLink()
      || pathAfter.dev !== openedAfter.dev
      || pathAfter.ino !== openedAfter.ino
      || pathAfter.size !== openedAfter.size
      || pathAfter.mtimeMs !== openedAfter.mtimeMs
      || pathAfter.ctimeMs !== openedAfter.ctimeMs) {
      throw corruptRecord(file, 'JSON record 读取期间发生替换');
    }
    return { bytes, identity: identity(file, bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw corruptRecord(file, 'JSON record 拒绝符号链接');
    throw error;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

export async function createJsonRecord(file: string, value: unknown): Promise<JsonRecordIdentity> {
  const bytes = serialize(value);
  const temporary = await writeSyncedTemporary(file, bytes);
  try {
    if (await fs.stat(file).then(() => true).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    })) {
      const error = new Error(`JSON record already exists: ${file}`) as NodeJS.ErrnoException;
      error.code = 'EEXIST';
      throw error;
    }
    await fs.link(temporary, file);
    await syncFileAndParent(file);
    await fs.rm(temporary, { force: true });
    await syncParentDirectories(path.dirname(file));
    const persisted = await readBytes(file);
    if (persisted === null) throw corruptRecord(file, 'JSON record 创建后缺失');
    return persisted.identity;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function replaceJsonRecord(file: string, value: unknown): Promise<JsonRecordIdentity> {
  const bytes = serialize(value);
  const temporary = await writeSyncedTemporary(file, bytes);
  try {
    await replaceFileByRename(temporary, file);
    await syncFileAndParent(file);
    const persisted = await readBytes(file);
    if (persisted === null) throw corruptRecord(file, 'JSON record 替换后缺失');
    return persisted.identity;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readJsonRecord<T>(file: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
  const loaded = await readBytes(file);
  if (loaded === null) return null;
  try {
    return { value: JSON.parse(loaded.bytes.toString('utf8')) as T, identity: loaded.identity };
  } catch (error) {
    throw new AuthoringOperationError('CHANGE_STORE_CORRUPT', `JSON record 无法解析：${file}`, {
      path: file,
      sha256: loaded.identity.sha256,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
