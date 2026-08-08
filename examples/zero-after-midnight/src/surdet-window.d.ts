import type { SaveSnapshot, SaveSlotMeta } from '@surdet/core';

declare global {
  interface Window {
    surdetSave?: {
      list(): Promise<string[]>;
      read(slot: string): Promise<SaveSnapshot | null>;
      write(slot: string, data: SaveSnapshot): Promise<void>;
      delete(slot: string): Promise<void>;
      listMeta(): Promise<SaveSlotMeta[]>;
    };
    surdetSettings?: { read(): Promise<unknown>; write(data: unknown): Promise<void> };
    surdetProfile?: {
      read(key: string): Promise<unknown | null>;
      write(key: string, value: unknown): Promise<void>;
      delete(key: string): Promise<void>;
    };
    surdetApp?: {
      quit(): Promise<void>;
      toggleFullscreen(): Promise<void>;
      log(level: string, msg: string): Promise<void>;
      reportError(context: string, message: string): Promise<string | null>;
    };
    surdetAsset?: { list(): Promise<string[]>; read(relPath: string): Promise<Uint8Array> };
  }
}

export {};
