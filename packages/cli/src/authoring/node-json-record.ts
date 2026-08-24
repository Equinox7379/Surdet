import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthoringOperationError } from '@surdet/authoring';
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

async function readBytes(file: string): Promise<{ bytes: Buffer; identity: JsonRecordIdentity } | null> {
  try {
    const bytes = await fs.readFile(file);
    return { bytes, identity: identity(file, bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
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
    await fs.rm(temporary, { force: true });
    return identity(file, await fs.readFile(file));
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
    return identity(file, await fs.readFile(file));
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
