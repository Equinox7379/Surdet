import type { SaveSnapshot, SaveSlotMeta } from '@surdet/core';
import type { RenderLifecycleDiagnosticSnapshot, RendererResourceSnapshot } from '@surdet/renderer';

interface SurdetDebugApi {
  readonly status: string;
  readonly rendererStatus: string;
  readonly sessionId: string;
  readonly resourceIds: Readonly<Record<string, string>>;
  readonly position: { sceneId: string; pc: number; sceneHash?: string } | null;
  readonly activeBlobUrls: number;
  readonly resourceSnapshot?: RendererResourceSnapshot | null;
  readonly resourceLedger?: RenderLifecycleDiagnosticSnapshot | null;
  readonly presentationSnapshot?: unknown;
  titleSelect(id: string): unknown;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __surdetDebug: SurdetDebugApi;
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
