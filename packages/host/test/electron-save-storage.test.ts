import { describe, expect, it, vi } from 'vitest';
import { SaveManager, type SaveSnapshot } from '@surdet/core';
import { createElectronSaveStorage, type ElectronSaveBridge } from '../src/electron-save-storage.js';
import { createPlayerUiSession } from '../src/player-ui.js';

const snapshot: SaveSnapshot = {
  meta: { id: 'slot-1', createdAt: 1, updatedAt: 1 },
  variables: {},
  position: { sceneId: 'prologue', pc: 1 },
  kind: 'manual',
  readSet: [],
  gallery: { cgs: [], music: [] },
};

describe('Electron SaveStorage bridge', () => {
  it('preserves missing reads as null and propagates every bridge rejection', async () => {
    const readFailure = new Error('read denied');
    const writeFailure = new Error('write denied');
    const deleteFailure = new Error('delete denied');
    const listFailure = new Error('list denied');
    const listMetaFailure = new Error('list-meta denied');
    const bridge = {
      read: vi.fn(async (slot: string) => slot === 'missing' ? null : Promise.reject(readFailure)),
      write: vi.fn(async () => { throw writeFailure; }),
      delete: vi.fn(async () => { throw deleteFailure; }),
      list: vi.fn(async () => { throw listFailure; }),
      listMeta: vi.fn(async () => { throw listMetaFailure; }),
    };
    const storage = createElectronSaveStorage(bridge);

    await expect(storage.read('missing')).resolves.toBeNull();
    await expect(storage.read('occupied')).rejects.toBe(readFailure);
    await expect(storage.write('slot-1', snapshot)).rejects.toBe(writeFailure);
    await expect(storage.delete('slot-1')).rejects.toBe(deleteFailure);
    await expect(storage.list()).rejects.toBe(listFailure);
    await expect(storage.listMeta?.()).rejects.toBe(listMetaFailure);
  });

  it('keeps a failed save transaction from claiming success and allows the next save', async () => {
    const writeFailure = new Error('permission denied');
    let write: ElectronSaveBridge['write'] = async () => { throw writeFailure; };
    const bridge: ElectronSaveBridge = {
      read: async () => null,
      write: (slot, data) => write(slot, data),
      delete: async () => undefined,
      list: async () => [],
      listMeta: async () => [],
    };
    const saves = new SaveManager(createElectronSaveStorage(bridge));
    const session = createPlayerUiSession({
      base: 'game',
      overlay: 'save-load',
      interfaceHidden: false,
      videoActive: false,
    });
    const before = session.snapshot();
    const completeOperation = vi.spyOn(session, 'completeOperation');
    const failOperation = vi.spyOn(session, 'failOperation');
    const savedNotice = vi.fn();

    session.beginOperation('saving');
    await expect(saves.save('slot-1', snapshot)).rejects.toBe(writeFailure);
    session.failOperation();

    expect(completeOperation).not.toHaveBeenCalled();
    expect(failOperation).toHaveBeenCalledOnce();
    expect(savedNotice).not.toHaveBeenCalled();
    expect(session.snapshot()).toEqual(before);

    write = async () => undefined;
    session.beginOperation('saving');
    await saves.save('slot-1', snapshot);
    session.completeOperation({ base: 'game', overlay: 'none' });
    savedNotice('slot-1');

    expect(savedNotice).toHaveBeenCalledWith('slot-1');
    expect(session.snapshot()).toMatchObject({ base: 'game', overlay: 'none', operation: 'idle' });
  });
});
