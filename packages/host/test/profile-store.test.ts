import { describe, expect, it } from 'vitest';
import { LocalStorageProfileStorage, MemoryProfileStorage } from '../src/profile-store.js';
import type { BrowserKeyValueStorage } from '../src/types.js';

function fakeStorage(): { storage: BrowserKeyValueStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } satisfies BrowserKeyValueStorage;
  return { storage, values };
}

describe('ProfileStorage', () => {
  it('roundtrips with defensive cloning', async () => {
    const storage = new MemoryProfileStorage();
    await storage.write('clear-record', { endings: ['a'] });
    const first = await storage.read<{ endings: string[] }>('clear-record');
    first!.endings.push('b');
    expect(await storage.read('clear-record')).toEqual({ endings: ['a'] });
  });

  it('deletes values and rejects invalid keys', async () => {
    const storage = new MemoryProfileStorage();
    await storage.write('clear-record', { ok: true });
    await storage.delete('clear-record');
    expect(await storage.read('clear-record')).toBeNull();
    await expect(storage.read('bad key')).rejects.toThrow(/key/i);
    await expect(storage.write('bad/key', {})).rejects.toThrow(/key/i);
  });

  it('rejects non-JSON values, cycles and oversized payloads', async () => {
    const storage = new MemoryProfileStorage();
    await expect(storage.write('fn', () => undefined)).rejects.toThrow(/JSON/i);
    await expect(storage.write('bigint', 1n)).rejects.toThrow(/JSON/i);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(storage.write('cycle', cyclic)).rejects.toThrow(/JSON/i);
    await expect(storage.write('huge', 'x'.repeat(1024 * 1024))).rejects.toThrow(/1 MiB/i);
  });

  it('roundtrips a versioned localStorage envelope and returns null for corruption', async () => {
    const { storage, values } = fakeStorage();
    const profiles = new LocalStorageProfileStorage(storage, 'surdet:profile:');
    await profiles.write('clear-record', { endings: ['a'] });
    const envelope = JSON.parse(values.get('surdet:profile:clear-record')!);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.value).toEqual({ endings: ['a'] });
    expect(await profiles.read('clear-record')).toEqual({ endings: ['a'] });
    values.set('surdet:profile:clear-record', '{broken');
    expect(await profiles.read('clear-record')).toBeNull();
  });

  it('does not confuse legacy clear-record storage with the versioned prefix', async () => {
    const { storage } = fakeStorage();
    storage.setItem('surdet:clearRecord', JSON.stringify({ endings: ['legacy'] }));
    const profiles = new LocalStorageProfileStorage(storage, 'surdet:profile:');
    expect(await profiles.read('clear-record')).toBeNull();
    expect(storage.getItem('surdet:clearRecord')).toContain('legacy');
  });
});
