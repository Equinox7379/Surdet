import { describe, expect, it, vi } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap, type SaveSnapshot } from '@surdet/core';
import type { AudioHandle } from '@surdet/renderer';
import type { RollbackRendererPort } from '../src/rollback-runtime.js';
import { createRollbackRuntime } from '../src/rollback-runtime.js';

function createRollbackFixture(options: {
  failRestore?: boolean;
  reenterOnReset?: boolean;
  checkpointSafe?: boolean;
  presentationHooks?: boolean;
} = {}) {
  let pc = 0;
  let failRestore = options.failRestore === true;
  let checkpointSafe = options.checkpointSafe !== false;
  let runtime: ReturnType<typeof createRollbackRuntime>;
  const reentrantResults: boolean[] = [];
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
    ...(options.presentationHooks ? { presentation: { version: 1 as const, payload: { visible: true } } } : {}),
  });
  const interpreter = {
    status: 'awaiting-advance',
    saveSnapshot: vi.fn(() => structuredClone(snapshotAt())),
    loadSnapshot: vi.fn((snapshot: SaveSnapshot, beforeCommit?: () => void) => {
      beforeCommit?.();
      pc = snapshot.position?.pc ?? pc;
      if (snapshot.presentation) renderer.restorePresentation(snapshot.presentation.payload);
      runtime.captureText();
    }),
  } as unknown as Interpreter;
  const renderer = {
    status: 'awaiting',
    backlogOpen: false,
    canCaptureRollbackCheckpoint: vi.fn(() => checkpointSafe),
    snapshotPresentation: vi.fn(() => ({ visible: true })),
    restorePresentation: vi.fn(() => {
      if (failRestore) throw new Error('presentation restore failed');
    }),
    resetSession: vi.fn(() => {
      stateReset();
      hostReset();
      onSystemBoundary();
      if (options.reenterOnReset) reentrantResults.push(runtime.perform());
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
    reentrantResults,
    setPosition(nextPc: number): void { pc = nextPc; },
    setRestoreFailure(value: boolean): void { failRestore = value; },
    setCheckpointSafe(value: boolean): void { checkpointSafe = value; },
  };
}

describe('rollback runtime — consecutive player rollback', () => {
  function realFixture() {
    const store = new VariableStore([{ name: 'score', type: 'number', initial: 0 }]);
    const scenes = new SceneRegistry();
    scenes.register(compileScene('第一句\n@inc score\n第二句', 'rollback.gal', 'rollback'));
    const bus = new EventBus<CoreEventMap>();
    const interpreter = new Interpreter(store, bus, scenes);
    let presentation = { visible: true, text: '' };
    const failures = { preflight: false, targetRestore: false, currentRestore: false, capture: false };
    bus.on('text', event => { presentation = { visible: true, text: event.value }; });
    interpreter.setPresentationHooks({
      snapshot: () => {
        if (failures.capture) throw new Error('snapshot unavailable');
        return { ...presentation };
      },
      validate: () => { if (failures.preflight) throw new Error('preflight refused'); },
      restore: payload => {
        presentation = { ...(payload as typeof presentation) };
        if (failures.targetRestore && presentation.text === '第一句') {
          presentation.visible = false;
          throw new Error('target restore failed');
        }
        if (failures.currentRestore && presentation.text === '第二句') throw new Error('current restore failed');
      },
    });
    const renderer: RollbackRendererPort = {
      status: 'awaiting', backlogOpen: false,
      canCaptureRollbackCheckpoint: () => true,
      resetSession: vi.fn(() => { presentation = { visible: false, text: '' }; runtime.clearForBoundary(); }),
      snapshotPresentation: () => ({ ...presentation }),
      restorePresentation: payload => { presentation = { ...(payload as typeof presentation) }; },
    };
    const runtime = createRollbackRuntime({ interpreter, renderer, audio: {} as AudioHandle,
      isBlocked: () => false, label: 'real-rollback', onRefresh: () => undefined });
    interpreter.start('rollback');
    return { runtime, interpreter, store, renderer, failures, presentation: () => ({ ...presentation }) };
  }

  async function capturePair(fixture: ReturnType<typeof realFixture>) {
    fixture.runtime.captureText(); await Promise.resolve();
    fixture.interpreter.advance();
    fixture.runtime.captureText(); await Promise.resolve();
  }

  it('preserves the visible scene when real Core preflight refuses rollback', async () => {
    const fixture = realFixture();
    await capturePair(fixture);
    const before = fixture.presentation(), position = fixture.interpreter.position;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      fixture.failures.preflight = true;
      expect(fixture.runtime.perform()).toBe(false);
      expect(fixture.renderer.resetSession).not.toHaveBeenCalled();
      expect(fixture.presentation()).toEqual(before);
      expect(fixture.interpreter.position).toEqual(position);
      expect(fixture.store.getNumber('score')).toBe(1);
      fixture.failures.preflight = false;
      expect(fixture.runtime.perform()).toBe(true);
      expect(fixture.presentation()).toEqual({ visible: true, text: '第一句' });
      expect(fixture.store.getNumber('score')).toBe(0);
    } finally { warning.mockRestore(); }
  });

  it('restores the current scene and variables after a target restore partially changes them', async () => {
    const fixture = realFixture();
    await capturePair(fixture);
    const position = fixture.interpreter.position;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      fixture.failures.targetRestore = true;
      expect(fixture.runtime.perform()).toBe(false);
      expect(fixture.presentation()).toEqual({ visible: true, text: '第二句' });
      expect(fixture.store.getNumber('score')).toBe(1);
      expect(fixture.interpreter.position).toEqual(position);
      expect(warning).toHaveBeenCalledWith('[real-rollback] 回退失败：', expect.objectContaining({ message: 'target restore failed' }));
      fixture.failures.targetRestore = false;
      expect(fixture.runtime.perform()).toBe(true);
      expect(fixture.presentation().text).toBe('第一句');
    } finally { warning.mockRestore(); }
  });

  it('reports both a restore failure and a failed compensation without claiming success', async () => {
    const fixture = realFixture();
    await capturePair(fixture);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      fixture.failures.targetRestore = fixture.failures.currentRestore = true;
      expect(fixture.runtime.perform()).toBe(false);
      expect(warning).toHaveBeenCalledWith('[real-rollback] 回退失败：', expect.objectContaining({ message: 'target restore failed' }));
      expect(warning).toHaveBeenCalledWith('[real-rollback] 回退后的当前状态恢复失败：', expect.objectContaining({ message: 'current restore failed' }));
      expect(fixture.runtime.isRestoring()).toBe(false);
    } finally { warning.mockRestore(); }
  });

  it('handles Core snapshot failure in a checkpoint microtask and allows a later capture', async () => {
    const fixture = realFixture();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      fixture.failures.capture = true;
      fixture.runtime.captureText(); await Promise.resolve(); await Promise.resolve();
      expect(fixture.runtime.canRollback()).toBe(false);
      expect(warning).toHaveBeenCalledWith('[real-rollback] 回退检查点创建失败：', expect.objectContaining({ message: 'snapshot unavailable' }));
      fixture.failures.capture = false;
      await capturePair(fixture);
      fixture.failures.capture = true;
      expect(fixture.runtime.perform()).toBe(false);
      expect(fixture.renderer.resetSession).not.toHaveBeenCalled();
      fixture.failures.capture = false;
      expect(fixture.runtime.perform()).toBe(true);
    } finally { warning.mockRestore(); }
  });

  it('restores presentation only once when Core already owns presentation hooks', async () => {
    const fixture = createRollbackFixture({ presentationHooks: true });
    for (const pc of [1, 2]) { fixture.setPosition(pc); fixture.runtime.captureText(); await Promise.resolve(); }
    expect(fixture.runtime.perform()).toBe(true);
    expect(fixture.renderer.restorePresentation).toHaveBeenCalledOnce();
  });
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
      expect(fixture.renderer.resetSession).toHaveBeenCalledWith({ preserveWorld: false, preserveReadingHistory: true });
      expect(fixture.runtime.canRollback()).toBe(true);
      expect(warning).toHaveBeenCalledWith(
        '[rollback-test] 回退失败：',
        expect.objectContaining({ message: 'presentation restore failed' }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('rejects a synchronous perform reentry while the outer restore owns the transaction', async () => {
    const fixture = createRollbackFixture({ reenterOnReset: true });
    for (let frame = 1; frame <= 3; frame += 1) {
      fixture.setPosition(frame);
      fixture.runtime.captureText();
      await Promise.resolve();
    }

    expect(fixture.runtime.perform()).toBe(true);
    expect(fixture.reentrantResults).toEqual([false]);
    expect(fixture.stateReset).toHaveBeenCalledTimes(1);
    expect(fixture.hostReset).toHaveBeenCalledTimes(1);
  });

  it('retains the restored cycle boundary so four advances can feed four valid rollbacks again', async () => {
    const fixture = createRollbackFixture();

    fixture.setPosition(0);
    fixture.runtime.captureText();
    await Promise.resolve();
    for (let frame = 1; frame <= 4; frame += 1) {
      fixture.setPosition(frame);
      fixture.runtime.captureText();
      await Promise.resolve();
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(fixture.runtime.perform()).toBe(true);
    }
    expect(fixture.interpreter.saveSnapshot()?.position?.pc).toBe(0);

    for (let frame = 1; frame <= 4; frame += 1) {
      fixture.setPosition(frame);
      fixture.runtime.captureText();
      await Promise.resolve();
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(fixture.runtime.perform()).toBe(true);
    }
    expect(fixture.interpreter.saveSnapshot()?.position?.pc).toBe(0);
  });

  it('skips unstable presentation checkpoints and captures the next stable text only', async () => {
    const fixture = createRollbackFixture({ checkpointSafe: false });

    fixture.setPosition(1);
    fixture.runtime.captureText();
    await Promise.resolve();

    expect(fixture.interpreter.saveSnapshot).not.toHaveBeenCalled();
    expect(fixture.renderer.snapshotPresentation).not.toHaveBeenCalled();
    expect(fixture.runtime.canRollback()).toBe(false);

    fixture.setCheckpointSafe(true);
    fixture.setPosition(2);
    fixture.runtime.captureText();
    await Promise.resolve();

    expect(fixture.interpreter.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(fixture.renderer.snapshotPresentation).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.canRollback()).toBe(true);
  });
});
