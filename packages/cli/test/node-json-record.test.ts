import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from '../src/authoring/node-json-record.js';
vi.mock('node:fs/promises', async () => ({ ...await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises') }));

const temporaryRoots: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('node JSON record writer', () => {
  it('re-reads a concurrently replaced record without reporting healthy bytes as corruption', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-record-race-'));
    temporaryRoots.push(root);
    const file = path.join(root, 'record.json');
    await createJsonRecord(file, { version: 1 });
    const open = fsp.open;
    let replaced = false;
    const spy = vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      if (args[0] === file && !replaced) {
        replaced = true;
        const next = path.join(root, 'next.json');
        await fsp.writeFile(next, '{"version":2}\n');
        await fsp.rename(next, file);
      }
      return open(...args);
    });
    try { expect((await readJsonRecord(file))?.value).toEqual({ version: 2 }); }
    finally { spy.mockRestore(); }
  });
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates, replaces and reads complete JSON with LF and verified identity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-json-record-'));
    temporaryRoots.push(root);
    const file = path.join(root, 'records', '0000000000.json');
    const created = await createJsonRecord(file, { formatVersion: 2, recordVersion: 0 });
    const createdBytes = await fsp.readFile(file);
    expect(createdBytes.toString('utf8')).toBe('{\n  "formatVersion": 2,\n  "recordVersion": 0\n}\n');
    expect(created.bytes).toBe(createdBytes.byteLength);
    expect(created.sha256).toBe(sha256(createdBytes));

    const replaced = await replaceJsonRecord(file, { formatVersion: 2, recordVersion: 1, marker: 'next' });
    const read = await readJsonRecord<{ recordVersion: number; marker: string }>(file);
    expect(read?.value).toEqual({ formatVersion: 2, recordVersion: 1, marker: 'next' });
    expect(read?.identity).toEqual(replaced);
    expect((await fsp.readFile(file)).toString('utf8').endsWith('\n')).toBe(true);
  });

  it('keeps the old target complete and cleans the temporary file when replacement fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-json-record-failure-'));
    temporaryRoots.push(root);
    const file = path.join(root, 'record.json');
    await createJsonRecord(file, { version: 'old' });
    const before = await fsp.readFile(file);
    const destinationDirectory = path.join(root, 'destination-directory');
    await fsp.mkdir(destinationDirectory);

    await expect(replaceJsonRecord(destinationDirectory, { version: 'new' })).rejects.toBeDefined();
    expect(await fsp.readFile(file)).toEqual(before);
    expect((await fsp.readdir(root)).filter((name) => name.includes('.record.json.') || name.endsWith('.tmp'))).toEqual([]);
  });

  it('converts malformed JSON to a structured store corruption error with identity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-json-record-corrupt-'));
    temporaryRoots.push(root);
    const file = path.join(root, 'broken.json');
    const bytes = Buffer.from('{broken\n', 'utf8');
    await fsp.writeFile(file, bytes);
    await expect(readJsonRecord(file)).rejects.toMatchObject({
      code: 'CHANGE_STORE_CORRUPT',
      details: { path: file, sha256: sha256(bytes) },
    });
  });
});
