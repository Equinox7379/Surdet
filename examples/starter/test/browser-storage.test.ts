import { describe, expect, it, vi } from 'vitest';
import { SaveManager, type SaveSnapshot } from '@surdet/core';
import { LocalStorageProfileStorage } from '@surdet/host';
import { createBrowserSaveStorage, gameStoragePrefix } from '../../shared/player/browser-save-storage.js';
import { listPlayerSaveSlots } from '../../shared/player/save-slot-list.js';
import { createSettingsStorage } from '../../shared/settings-storage.js';

function memoryStorage(): Storage {
  const data: Record<string, string> = {};
  return Object.defineProperties(data, {
    getItem: { value: (key: string) => data[key] ?? null, configurable: true },
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

describe('browser damaged-slot menu projection', () => {
  function fixture() {
    const storage = memoryStorage();
    const prefix = gameStoragePrefix('recovery');
    const adapter = createBrowserSaveStorage(storage, prefix);
    const saves = new SaveManager(adapter);
    return {
      storage, adapter, saves,
      key: (slot: string) => `${prefix}save:${slot}`,
      slots: (mode: 'load' | 'save' = 'load') => listPlayerSaveSlots(saves, adapter, ['1', '2', '3'], mode),
    };
  }

  it('keeps healthy main slots accessible when a backup is invalid JSON', async () => {
    const f = fixture();
    await f.saves.save('1', snapshot(1));
    await f.saves.save('2', snapshot(2));
    f.storage.setItem(f.key('1.bak'), '{bad-backup');
    const before = { ...f.storage };
    expect(await f.slots()).toMatchObject([
      { id: '1', empty: false, readError: undefined, backupAvailable: false, backupError: expect.stringContaining('备份损坏') },
      { id: '2', empty: false, readError: undefined },
      { id: '3', empty: true },
    ]);
    expect((await f.saves.load('1')).variables.value).toBe(1);
    expect((await f.saves.load('2')).variables.value).toBe(2);
    await expect(f.saves.restoreBackup('1')).rejects.toThrow();
    expect({ ...f.storage }).toEqual(before);
  });

  it('keeps a corrupt main occupied, exposes its healthy backup, and clears the error after explicit restore', async () => {
    const f = fixture();
    await f.saves.save('1', snapshot(1));
    await f.saves.save('1', snapshot(2));
    f.storage.setItem(f.key('1'), '{bad-main');
    const before = { ...f.storage };
    expect((await f.slots())[0]).toMatchObject({ empty: false, readError: expect.stringContaining('存档损坏'), backupAvailable: true });
    expect((await f.slots('save'))[0]).toMatchObject({ empty: false, readError: expect.any(String), backupAvailable: false });
    await expect(f.saves.load('1')).rejects.toThrow();
    expect({ ...f.storage }).toEqual(before);
    await f.saves.restoreBackup('1');
    expect((await f.saves.load('1')).variables.value).toBe(1);
    expect((await f.slots())[0]).toMatchObject({ empty: false, readError: undefined, backupAvailable: true });
    expect(f.storage.getItem(f.key('1.bak'))).toBe(before[f.key('1.bak')]);
  });

  it.each(['{bad-json', '{}', 'null', JSON.stringify({ ...snapshot(1), meta: { ...snapshot(1).meta, id: 'other' } })])(
    'isolates invalid main and backup content without erasing it: %s', async (bad) => {
      const f = fixture();
      await f.saves.save('2', snapshot(2));
      f.storage.setItem(f.key('1'), bad);
      f.storage.setItem(f.key('1.bak'), bad);
      const before = { ...f.storage };
      expect(await f.slots()).toMatchObject([
        { id: '1', empty: false, readError: expect.any(String), backupError: expect.any(String), backupAvailable: false },
        { id: '2', empty: false, readError: undefined },
        { id: '3', empty: true },
      ]);
      await expect(f.saves.restoreBackup('1')).rejects.toThrow();
      expect({ ...f.storage }).toEqual(before);
    },
  );

  it('offers a valid backup even when its main is absent', async () => {
    const f = fixture();
    await f.saves.save('1', snapshot(1));
    await f.saves.save('1', snapshot(2));
    f.storage.removeItem(f.key('1'));
    expect((await f.slots())[0]).toMatchObject({ empty: true, readError: undefined, backupAvailable: true });
    await f.saves.restoreBackup('1');
    expect((await f.saves.load('1')).variables.value).toBe(1);
  });

  it.each(['main', 'backup'])('propagates backend access failure while inspecting %s', async (target) => {
    const f = fixture();
    await f.saves.save('1', snapshot(1));
    await f.saves.save('1', snapshot(2));
    const read = f.storage.getItem;
    vi.spyOn(f.storage, 'getItem').mockImplementation(key => {
      if (target === 'main' || key.endsWith('.bak')) throw new DOMException('Storage denied', 'SecurityError');
      return read(key);
    });
    await expect(f.slots()).rejects.toThrow('Storage denied');
  });

  it('propagates enumeration failure instead of returning empty slots', async () => {
    const storage = new Proxy(memoryStorage(), { ownKeys() { throw new Error('Storage enumeration denied'); } });
    const adapter = createBrowserSaveStorage(storage, gameStoragePrefix('unavailable'));
    await expect(listPlayerSaveSlots(new SaveManager(adapter), adapter, ['1'], 'load')).rejects.toThrow('Storage enumeration denied');
  });

  it('retains the normal metadata/backup projection for non-browser backends', async () => {
    const saves = new SaveManager();
    await saves.save('1', snapshot(1));
    await saves.save('1', snapshot(2));
    expect(await listPlayerSaveSlots(saves, null, ['1', '2'], 'load')).toMatchObject([
      { id: '1', empty: false, readError: undefined, backupAvailable: true },
      { id: '2', empty: true, backupAvailable: false },
    ]);
  });
});
