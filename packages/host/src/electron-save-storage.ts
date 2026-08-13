import type { SaveSlotMeta, SaveSnapshot, SaveStorage } from '@surdet/core';

/**
 * The typed shape exposed by the Electron preload bridge.  The bridge owns
 * IPC and filesystem details; this adapter deliberately forwards every
 * promise without converting failures into empty data or successful writes.
 */
export interface ElectronSaveBridge {
  read(slot: string): Promise<SaveSnapshot | null>;
  write(slot: string, data: SaveSnapshot): Promise<void>;
  delete(slot: string): Promise<void>;
  list(): Promise<string[]>;
  listMeta(): Promise<SaveSlotMeta[]>;
  listBackupMeta(): Promise<SaveSlotMeta[]>;
  restoreBackup(slot: string): Promise<void>;
}

/**
 * Adapt the desktop bridge to Core's SaveStorage contract.
 *
 * Missing slots are represented by the bridge as `null`.  All other bridge
 * failures intentionally remain rejected so the host transaction can restore
 * its pre-operation UI state and report the original cause.
 */
export function createElectronSaveStorage(bridge: ElectronSaveBridge): SaveStorage {
  return {
    read: (slot) => bridge.read(slot),
    write: (slot, data) => bridge.write(slot, data),
    delete: (slot) => bridge.delete(slot),
    list: () => bridge.list(),
    listMeta: () => bridge.listMeta(),
    listBackupMeta: () => bridge.listBackupMeta(),
    restoreBackup: (slot) => bridge.restoreBackup(slot),
  };
}
