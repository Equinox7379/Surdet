import type { Interpreter, SaveSnapshot } from '@surdet/core';
import type { AudioHandle, RenderStatus } from '@surdet/renderer';
import { RollbackBuffer } from '@surdet/renderer';

export interface RollbackRendererPort {
  readonly status: RenderStatus;
  readonly backlogOpen: boolean;
  resetSession(options?: { preserveWorld?: boolean; clearAssets?: boolean }): void;
  snapshotPresentation(): unknown;
  restorePresentation(snapshot: unknown): void;
}

export interface RollbackRuntimeOptions {
  interpreter: Interpreter;
  renderer: RollbackRendererPort;
  audio: AudioHandle;
  isBlocked: () => boolean;
  label: string;
  onRefresh: () => void;
}

export interface RollbackRuntime {
  clear(): void;
  canRollback(): boolean;
  perform(): boolean;
  captureText(): void;
  isRestoring(): boolean;
}

function checkpointKey(snapshot: SaveSnapshot): string | null {
  const position = snapshot.position;
  return position ? `${position.sceneId}:${position.pc}:${position.sceneHash ?? ''}` : null;
}

export function createRollbackRuntime(options: RollbackRuntimeOptions): RollbackRuntime {
  const rollback = new RollbackBuffer<SaveSnapshot>();
  let lastRollbackKey: string | null = null;
  let restoring = false;
  let captureGeneration = 0;

  const clear = (): void => {
    captureGeneration += 1;
    rollback.clear();
    lastRollbackKey = null;
  };

  const canRollback = (): boolean => options.interpreter.status === 'awaiting-advance'
    && options.renderer.status !== 'choice'
    && !options.renderer.backlogOpen
    && !options.isBlocked()
    && rollback.size > 0;

  const perform = (): boolean => {
    if (!canRollback()) return false;
    const current = options.interpreter.saveSnapshot();
    const currentKey = current ? checkpointKey(current) : null;
    const first = rollback.pop();
    if (!first) return false;
    const frame = currentKey !== null && checkpointKey(first.snapshot) === currentKey
      ? rollback.pop()
      : first;
    if (!frame) {
      rollback.push(first);
      return false;
    }
    restoring = true;
    try {
      options.renderer.resetSession({ preserveWorld: false });
      options.interpreter.loadSnapshot(frame.snapshot);
      options.renderer.restorePresentation(frame.presentation);
      options.audio.restorePlayback?.(frame.audio);
      lastRollbackKey = checkpointKey(frame.snapshot);
      return true;
    } catch (error) {
      rollback.push(frame);
      console.warn(`[${options.label}] 回退失败：`, error);
      return false;
    } finally {
      restoring = false;
      options.onRefresh();
    }
  };

  const captureText = (): void => {
    if (restoring) return;
    const generation = captureGeneration;
    queueMicrotask(() => {
      if (restoring || generation !== captureGeneration) return;
      const snapshot = options.interpreter.saveSnapshot();
      if (!snapshot || options.interpreter.status === 'running'
        || options.interpreter.status === 'paused' || options.interpreter.status === 'awaiting-timer') return;
      const key = checkpointKey(snapshot);
      if (key === null || key === lastRollbackKey) return;
      try {
        rollback.push({
          snapshot,
          presentation: options.renderer.snapshotPresentation(),
          audio: options.audio.snapshotPlayback?.() ?? { bgm: null, ambience: null },
        });
        lastRollbackKey = key;
        options.onRefresh();
      } catch (error) {
        console.warn(`[${options.label}] 回退检查点创建失败：`, error);
      }
    });
  };

  return { clear, canRollback, perform, captureText, isRestoring: () => restoring };
}
