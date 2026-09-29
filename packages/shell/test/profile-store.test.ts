import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileProfileStore } from '../src/profile-store.js';

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-profile-store-'));
}

describe('FileProfileStore', () => {
  it('keeps legal case-sensitive keys and Windows device names independent on disk', async () => {
    const dir = makeDir();
    try {
      const store = new FileProfileStore(dir);
      for (const key of ['Route', 'route', 'ROUTE', 'con', 'con.settings']) await store.write(key, { key });
      for (const key of ['Route', 'route', 'ROUTE', 'con', 'con.settings']) {
        expect(await store.read(key)).toEqual({ key });
      }
      await store.delete('route');
      expect(await store.read('Route')).toEqual({ key: 'Route' });
      expect(await store.read('ROUTE')).toEqual({ key: 'ROUTE' });
      expect(await store.read('route')).toBeNull();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes versioned envelopes atomically and roundtrips defensively', async () => {
    const dir = makeDir();
    const store = new FileProfileStore(path.join(dir, 'profile'));
    await store.write('clear-record', { endings: ['a'] });
    const file = path.join(dir, 'profile', 'clear-record.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion).toBe(1);
    const first = await store.read<{ endings: string[] }>('clear-record');
    first!.endings.push('b');
    expect(await store.read('clear-record')).toEqual({ endings: ['a'] });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('returns null for missing/corrupt data and logs without blocking startup', async () => {
    const dir = makeDir();
    const warnings: string[] = [];
    const store = new FileProfileStore(path.join(dir, 'profile'), (message) => warnings.push(message));
    expect(await store.read('clear-record')).toBeNull();
    fs.mkdirSync(path.join(dir, 'profile'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'profile', 'clear-record.json'), '{broken');
    expect(await store.read('clear-record')).toBeNull();
    expect(warnings).toHaveLength(1);
    await expect(store.read('clear-record', { strict: true })).rejects.toThrow('损坏');
    expect(fs.readFileSync(path.join(dir, 'profile', 'clear-record.json'), 'utf8')).toBe('{broken');
  });

  it('deletes only the requested profile key and rejects invalid keys', async () => {
    const dir = makeDir();
    const store = new FileProfileStore(path.join(dir, 'profile'));
    await store.write('clear-record', { ok: true });
    await store.write('settings.v1', { ok: true });
    await store.delete('clear-record');
    expect(await store.read('clear-record')).toBeNull();
    expect(await store.read('settings.v1')).toEqual({ ok: true });
    await expect(store.read('bad/key')).rejects.toThrow(/Profile key/);
  });
});
