import { assertValidSnapshot, type SaveStorage } from '@surdet/core';

/** Package identity, not title or development port, owns a browser game's data. */
export function gameStoragePrefix(gameId: string): string {
  if (gameId.trim().length === 0) throw new Error('游戏存储身份不能为空');
  return `surdet:game:${encodeURIComponent(gameId)}:`;
}

export function createBrowserSaveStorage(storage: Storage, prefix: string): SaveStorage {
  const savePrefix = `${prefix}save:`;
  return {
    read: (slot) => {
      const raw = storage.getItem(`${savePrefix}${slot}`);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      assertValidSnapshot(parsed, 'legacy');
      return parsed;
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
    listBackupMeta: () => Object.keys(storage)
      .filter((key) => key.startsWith(savePrefix) && key.endsWith('.bak'))
      .map((key) => {
        const parsed: unknown = JSON.parse(storage.getItem(key)!);
        assertValidSnapshot(parsed, 'legacy');
        return parsed.meta;
      }),
    restoreBackup: (slot) => {
      const key = `${savePrefix}${slot}`;
      const raw = storage.getItem(`${key}.bak`);
      if (raw === null) throw new Error(`存档槽位 '${slot}' 没有可恢复备份`);
      const parsed: unknown = JSON.parse(raw);
      assertValidSnapshot(parsed, 'legacy');
      storage.setItem(key, JSON.stringify(parsed));
    },
  };
}
