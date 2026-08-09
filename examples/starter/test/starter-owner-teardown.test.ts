import { describe, expect, it, vi } from 'vitest';
import { createStarterOwnerTeardown } from '../src/starter-owner-teardown.js';

function target(): EventTarget & { listenerCount(type: string): number } {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, listener: EventListener): void {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: EventListener): void {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: () => true,
    listenerCount(type: string): number { return listeners.get(type)?.size ?? 0; },
  } as EventTarget & { listenerCount(type: string): number };
}

describe('starter owner teardown', () => {
  it('creates one runtime owner and releases every resource exactly once', () => {
    const runtime = { dispose: vi.fn() };
    const audio = { dispose: vi.fn() };
    const gamepad = { stop: vi.fn() };
    const revoke = vi.fn();
    const fontBlobUrls = new Set(['blob:font']);
    const assetBlobUrls = new Set(['blob:asset']);
    const canvas = target();
    const windowTarget = target();
    const owner = createStarterOwnerTeardown({
      runtime,
      audioManager: audio,
      gamepad,
      fontBlobUrls,
      assetBlobUrls,
      revokeObjectUrl: revoke,
    });
    const windowListener = (() => undefined) as EventListener;
    const canvasListener = (() => undefined) as EventListener;
    windowTarget.addEventListener('keydown', windowListener);
    owner.trackListener(() => windowTarget.removeEventListener('keydown', windowListener));
    canvas.addEventListener('pointerdown', canvasListener);
    owner.trackListener(() => canvas.removeEventListener('pointerdown', canvasListener));

    owner.dispose();
    owner.dispose();

    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(gamepad.stop).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(fontBlobUrls).toHaveLength(0);
    expect(assetBlobUrls).toHaveLength(0);
    expect(windowTarget.listenerCount('keydown')).toBe(0);
    expect(canvas.listenerCount('pointerdown')).toBe(0);
  });

  it('runs synchronous teardown without creating an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const owner = createStarterOwnerTeardown({
        runtime: { dispose: vi.fn() },
        audioManager: { dispose: vi.fn() },
        gamepad: { stop: vi.fn() },
        fontBlobUrls: new Set<string>(),
        assetBlobUrls: new Set<string>(),
        revokeObjectUrl: vi.fn(),
      });
      owner.dispose();
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
