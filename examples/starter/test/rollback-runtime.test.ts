import { describe, expect, it, vi } from 'vitest';
import type { Interpreter, SaveSnapshot } from '@surdet/core';
import type { AudioHandle } from '@surdet/renderer';
import type { RollbackRendererPort } from '@surdet/host';
import { createRollbackRuntime } from '@surdet/host';

function createTestRuntime() {
  let pc = 1;
  const snapshot: SaveSnapshot = {
    meta: { id: 'test', createdAt: 1, updatedAt: 1 },
    variables: {},
    position: { sceneId: 's1', pc, sceneHash: 'hash-1' },
    kind: 'manual',
    status: 'awaiting-advance',
    readSet: [],
    gallery: { cgs: [], music: [] },
  };
  const interpreter = {
    status: 'awaiting-advance',
    saveSnapshot: vi.fn(() => structuredClone({ ...snapshot, position: { ...snapshot.position!, pc } })),
    loadSnapshot: vi.fn(),
  } as unknown as Interpreter;
  const renderer = {
    status: 'awaiting',
    backlogOpen: false,
    canCaptureRollbackCheckpoint: () => true,
    snapshotPresentation: vi.fn(() => ({ visible: true })),
    restorePresentation: vi.fn(),
    resetSession: vi.fn(),
  } as unknown as RollbackRendererPort;
  const audio = {
    snapshotPlayback: vi.fn(() => ({ bgm: null, ambience: null })),
    restorePlayback: vi.fn(),
  } as unknown as AudioHandle;
  const runtime = createRollbackRuntime({
    interpreter,
    renderer,
    audio,
    isBlocked: () => false,
    label: 'rollback-test',
    onRefresh: vi.fn(),
  });
  return {
    runtime,
    setPosition(nextPc: number): void { pc = nextPc; },
  };
}

describe('rollback runtime boundaries', () => {
  it('does not recreate a cleared text checkpoint after a system boundary', async () => {
    const fixture = createTestRuntime();
    fixture.runtime.captureText();
    fixture.runtime.clear();

    await Promise.resolve();

    expect(fixture.runtime.canRollback()).toBe(false);
  });

  it('captures new checkpoints after a system boundary', async () => {
    const fixture = createTestRuntime();
    fixture.runtime.captureText();
    fixture.runtime.clear();
    await Promise.resolve();

    fixture.setPosition(2);
    fixture.runtime.captureText();
    await Promise.resolve();

    expect(fixture.runtime.canRollback()).toBe(true);
  });
});
