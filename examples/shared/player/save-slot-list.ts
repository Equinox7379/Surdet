import { AUTO_SLOT, QUICK_SLOT, type SaveManager } from '@surdet/core';
import type { SaveSlotView } from '@surdet/renderer';
import type { BrowserSaveSlot, BrowserSaveStorage } from './browser-save-storage.js';

/** Shared Player and Zero use the same menu projection; normal load/restore stay strict. */
export async function listPlayerSaveSlots(
  saves: SaveManager,
  browserStorage: BrowserSaveStorage | null,
  slotIds: readonly string[],
  mode: 'save' | 'load',
): Promise<SaveSlotView[]> {
  let entries: BrowserSaveSlot[];
  if (browserStorage) {
    entries = browserStorage.inspectSlots(mode === 'load');
  } else {
    const metas = await saves.list();
    const backups = mode === 'load' ? await saves.listBackupMeta() : [];
    const byId = new Map<string, BrowserSaveSlot>(metas.map(meta => [meta.id, { id: meta.id, meta }]));
    for (const backupMeta of backups) {
      const entry = byId.get(backupMeta.id) ?? { id: backupMeta.id };
      entry.backupMeta = backupMeta;
      byId.set(entry.id, entry);
    }
    entries = [...byId.values()];
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return slotIds.map(id => {
    const entry = byId.get(id);
    return {
      id,
      empty: !entry?.meta && !entry?.error,
      label: entry?.meta?.chapter,
      updatedAt: entry?.meta?.updatedAt,
      thumbnail: entry?.meta?.thumbnail,
      playTimeSec: entry?.meta?.playTimeSec,
      readError: entry?.error,
      backupError: entry?.backupError,
      backupAvailable: mode === 'load' && !!entry?.backupMeta,
      kind: id === QUICK_SLOT ? 'quick' : id === AUTO_SLOT ? 'auto' : 'manual',
    };
  });
}
