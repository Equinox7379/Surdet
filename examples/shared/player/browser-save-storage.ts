import { assertValidSnapshot, type SaveSlotMeta, type SaveStorage } from '@surdet/core';

export interface BrowserSaveSlot {
  id: string;
  meta?: SaveSlotMeta;
  error?: string;
  backupMeta?: SaveSlotMeta;
  backupError?: string;
}

export interface BrowserSaveStorage extends SaveStorage {
  /** Menu-only projection: damaged content remains occupied, but does not hide other slots. */
  inspectSlots(includeBackups: boolean): BrowserSaveSlot[];
}

/** Package identity, not title or development port, owns a browser game's data. */
export function gameStoragePrefix(gameId: string): string {
  if (gameId.trim().length === 0) throw new Error('游戏存储身份不能为空');
  return `surdet:game:${encodeURIComponent(gameId)}:`;
}

export function createBrowserSaveStorage(storage: Storage, prefix: string): BrowserSaveStorage {
  const savePrefix = `${prefix}save:`;
  function parseSnapshot(raw: string, slot: string) {
    const parsed: unknown = JSON.parse(raw);
    assertValidSnapshot(parsed, 'legacy');
    if (parsed.meta.id !== slot) throw new Error(`存档内容不属于槽位 '${slot}'`);
    return parsed;
  }
  function inspectMeta(slot: string, backup: boolean): { meta?: SaveSlotMeta; error?: string } {
    // Storage access/permission failures are backend errors, never corrupt or empty slots.
    const raw = storage.getItem(`${savePrefix}${slot}${backup ? '.bak' : ''}`);
    if (raw === null) return {};
    try {
      return { meta: parseSnapshot(raw, slot).meta };
    } catch {
      return { error: backup ? '备份损坏，原始数据已保留' : '存档损坏，原始数据已保留' };
    }
  }
  return {
    read: (slot) => {
      const raw = storage.getItem(`${savePrefix}${slot}`);
      if (raw === null) return null;
      return parseSnapshot(raw, slot);
    },
    write: (slot, data) => {
      const key = `${savePrefix}${slot}`;
      const current = storage.getItem(key);
      if (current !== null) storage.setItem(`${key}.bak`, current);
      storage.setItem(key, JSON.stringify(data));
    },
    delete: (slot) => {
      const key = `${savePrefix}${slot}`;
      storage.removeItem(key);
      storage.removeItem(`${key}.bak`);
    },
    list: () => Object.keys(storage)
      .filter((key) => key.startsWith(savePrefix) && !key.endsWith('.bak'))
      .map((key) => key.slice(savePrefix.length)),
    inspectSlots: (includeBackups) => {
      const ids = new Set(Object.keys(storage)
        .filter((key) => key.startsWith(savePrefix))
        .map((key) => key.slice(savePrefix.length).replace(/\.bak$/, '')));
      return [...ids].map((id) => {
        const main = inspectMeta(id, false);
        const backup = includeBackups ? inspectMeta(id, true) : {};
        return { id, ...main, backupMeta: backup.meta, backupError: backup.error };
      });
    },
    listBackupMeta: () => Object.keys(storage)
      .filter((key) => key.startsWith(savePrefix) && key.endsWith('.bak'))
      .map((key) => {
        return parseSnapshot(storage.getItem(key)!, key.slice(savePrefix.length, -4)).meta;
      }),
    restoreBackup: (slot) => {
      const key = `${savePrefix}${slot}`;
      const raw = storage.getItem(`${key}.bak`);
      if (raw === null) throw new Error(`存档槽位 '${slot}' 没有可恢复备份`);
      const parsed = parseSnapshot(raw, slot);
      storage.setItem(key, JSON.stringify(parsed));
    },
  };
}
