import { describe, expect, it, vi } from 'vitest';
import { SaveManager, type SaveSnapshot } from '@surdet/core';
import { LocalStorageProfileStorage } from '@surdet/host';
import { createBrowserSaveStorage, gameStoragePrefix } from '../../shared/player/browser-save-storage.js';
import { createSettingsStorage } from '../../shared/settings-storage.js';

function memoryStorage(): Storage {
  const data: Record<string, string> = {};
  return Object.defineProperties(data, {
    getItem: { value: (key: string) => data[key] ?? null },
    setItem: { value: (key: string, value: string) => { data[key] = value; }, configurable: true },
    removeItem: { value: (key: string) => { delete data[key]; } },
    clear: { value: () => { for (const key of Object.keys(data)) delete data[key]; } },
    key: { value: (index: number) => Object.keys(data)[index] ?? null },
    length: { get: () => Object.keys(data).length },
  }) as unknown as Storage;
}

function snapshot(value: number): SaveSnapshot {
  return {
    meta: { id: '1', createdAt: 1, updatedAt: 1 }, kind: 'manual',
    position: { sceneId: 'start', pc: 0 }, variables: { value },
    readSet: [], gallery: { cgs: [], music: [] },
  };
}

describe('browser game ownership', () => {
  it('isolates saves, backups, settings and profiles while retaining unowned old data', async () => {
    const storage = memoryStorage();
    storage.setItem('surdet:save:1', 'unowned legacy data');
    const aPrefix = gameStoragePrefix('game-a'), bPrefix = gameStoragePrefix('game-b');
    const a = new SaveManager(createBrowserSaveStorage(storage, aPrefix));
    const b = new SaveManager(createBrowserSaveStorage(storage, bPrefix));
    await a.save('1', snapshot(1));
    await a.save('1', snapshot(2));
    expect(await b.list()).toEqual([]);
    await b.save('1', snapshot(3));
    await a.restoreBackup('1');
    expect((await a.load('1')).variables.value).toBe(1);
    expect((await b.load('1')).variables.value).toBe(3);
    expect(await a.listBackupMeta()).toHaveLength(1);
    expect(await b.listBackupMeta()).toEqual([]);
    const profileA = new LocalStorageProfileStorage(storage, `${aPrefix}profile:`);
    const profileB = new LocalStorageProfileStorage(storage, `${bPrefix}profile:`);
    await profileA.write('clear-record', { endings: ['a'] });
    expect(await profileB.read('clear-record')).toBeNull();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
    try {
      storage.setItem(`${aPrefix}settings`, JSON.stringify({ masterVolume: 0.2 }));
      expect(await createSettingsStorage('a', aPrefix).load()).toEqual({ masterVolume: 0.2 });
      expect(await createSettingsStorage('b', bPrefix).load()).toBeNull();
    } finally { vi.unstubAllGlobals(); }
    expect(storage.getItem('surdet:save:1')).toBe('unowned legacy data');
  });

  it('does not report a failed write or restore as success', async () => {
    const storage = memoryStorage();
    const saves = new SaveManager(createBrowserSaveStorage(storage, gameStoragePrefix('game')));
    await saves.save('1', snapshot(1));
    await saves.save('1', snapshot(2));
    const fail = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(saves.save('1', snapshot(3))).rejects.toThrow('quota');
    await expect(saves.restoreBackup('1')).rejects.toThrow('quota');
    fail.mockRestore();
    expect((await saves.load('1')).variables.value).toBe(2);
  });
});
