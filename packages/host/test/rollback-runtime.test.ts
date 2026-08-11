import { describe, expect, it, vi } from 'vitest';
import type { Interpreter, SaveSnapshot } from '@surdet/core';
import type { AudioHandle } from '@surdet/renderer';
import type { RollbackRendererPort } from '../src/rollback-runtime.js';
import { createRollbackRuntime } from '../src/rollback-runtime.js';

function createRollbackFixture(options: { failRestore?: boolean } = {}) {
  let pc = 0;
  let failRestore = options.failRestore === true;
  let runtime: ReturnType<typeof createRollbackRuntime>;
  const stateReset = vi.fn();
  const hostReset = vi.fn();
  const onSystemBoundary = vi.fn(() => runtime.clearForBoundary());
  const snapshotAt = (): SaveSnapshot => ({
    meta: { id: 'rollback-test', createdAt: 1, updatedAt: 1 },
    variables: {},
    position: { sceneId: 's1', pc, sceneHash: 'hash-1' },
    kind: 'manual',
    readSet: [],
    gallery: { cgs: [], music: [] },
  });
  const interpreter = {
    status: 'awaiting-advance',
    saveSnapshot: vi.fn(() => structuredClone(snapshotAt())),
    loadSnapshot: vi.fn((snapshot: SaveSnapshot) => {
      pc = snapshot.position?.pc ?? pc;
      runtime.captureText();
    }),
  } as unknown as Interpreter;
  const renderer = {
    status: 'awaiting',
    backlogOpen: false,
    snapshotPresentation: vi.fn(() => ({ visible: true })),
    restorePresentation: vi.fn(() => {
      if (failRestore) throw new Error('presentation restore failed');
    }),
    resetSession: vi.fn(() => {
      stateReset();
      hostReset();
      onSystemBoundary();
    }),
  } as unknown as RollbackRendererPort;
  const audio = {
    snapshotPlayback: vi.fn(() => ({ bgm: null, ambience: null })),
    restorePlayback: vi.fn(),
  } as unknown as AudioHandle;
  runtime = createRollbackRuntime({
    interpreter,
    renderer,
    audio,
    isBlocked: () => false,
    label: 'rollback-test',
    onRefresh: vi.fn(),
  });
  return {
    runtime,
    interpreter,
    renderer,
    stateReset,
    hostReset,
    onSystemBoundary,
    setPosition(nextPc: number): void { pc = nextPc; },
    setRestoreFailure(value: boolean): void { failRestore = value; },
  };
}

describe('rollback runtime — consecutive player rollback', () => {
  it('keeps earlier checkpoints while restore crosses the real state-reset boundary', async () => {
    const fixture = createRollbackFixture();
    for (let frame = 1; frame <= 10; frame += 1) {
      fixture.setPosition(frame);
      fixture.runtime.captureText();
      await Promise.resolve();
    }

    const restored: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(fixture.runtime.perform()).toBe(true);
      const current = fixture.interpreter.saveSnapshot();
      expect(current).not.toBeNull();
      restored.push(current?.position?.pc ?? -1);
      if (attempt < 4) expect(fixture.runtime.canRollback()).toBe(true);
    }

    expect(restored).toEqual([9, 8, 7, 6, 5]);
    expect(fixture.stateReset).toHaveBeenCalledTimes(5);
    expect(fixture.hostReset).toHaveBeenCalledTimes(5);
    expect(fixture.onSystemBoundary).toHaveBeenCalledTimes(5);
  });

  it('clears history at an explicit non-restore boundary', async () => {
    const fixture = createRollbackFixture();
    fixture.setPosition(1);
    fixture.runtime.captureText();
    await Promise.resolve();

    expect(fixture.runtime.canRollback()).toBe(true);
    fixture.runtime.clearForBoundary();
    expect(fixture.runtime.canRollback()).toBe(false);
  });

  it('puts a failed target frame back and retains the original cause', async () => {
    const fixture = createRollbackFixture({ failRestore: true });
    for (let frame = 1; frame <= 2; frame += 1) {
      fixture.setPosition(frame);
      fixture.runtime.captureText();
      await Promise.resolve();
    }
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      expect(fixture.runtime.perform()).toBe(false);
      expect(fixture.runtime.canRollback()).toBe(true);
      expect(warning).toHaveBeenCalledWith(
        '[rollback-test] 回退失败：',
        expect.objectContaining({ message: 'presentation restore failed' }),
      );
    } finally {
      warning.mockRestore();
    }
  });
});
