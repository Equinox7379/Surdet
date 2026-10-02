import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '@surdet/core';
import * as Renderer from '@surdet/renderer';
import type { RendererRuntime } from '@surdet/renderer';
import { startV2Renderer } from '../../../../docs/examples/renderer-v2-migration.js';

afterEach(() => { vi.restoreAllMocks(); });

async function migrationExample() {
  const registry = new SceneRegistry();
  registry.register(compileScene('原进度。', 'main.gal', 'main'));
  const store = new VariableStore([{ name: 'score', type: 'number', initial: 7 }]);
  const bus = new EventBus<CoreEventMap>();
  const interpreter = new Interpreter(store, bus, registry);
  interpreter.start('main');
  let disposed = false;
  const failure = new Error('invalid presentation');
  const snapshot = vi.fn((_context?: unknown) => {
    if (disposed) throw new Error('renderer disposed');
    return { stage: 'current' };
  });
  const validate = vi.fn((payload: unknown) => {
    if ((payload as { stage?: unknown }).stage === 'invalid') throw failure;
  });
  const restore = vi.fn((payload: unknown) => { validate(payload); });
  const unsubscribe = vi.fn();
  const runtime = { canvas: {}, resize: vi.fn(), controller: { connect: vi.fn(() => unsubscribe) },
    queries: { presentation: { snapshot } }, commands: { presentation: { validate, restore } },
    dispose: vi.fn(() => { disposed = true; }) };
  const audio = { dispose: vi.fn() };
  vi.spyOn(Renderer, 'AudioManager').mockImplementation(function () { return audio as never; });
  vi.spyOn(Renderer, 'createRendererRuntime').mockResolvedValue(runtime as unknown as RendererRuntime);
  const cleanup = await startV2Renderer({ appendChild: vi.fn() } as unknown as HTMLElement, interpreter, bus);
  return { interpreter, store, runtime, snapshot, restore, unsubscribe, audio, cleanup, failure };
}

describe('public v2 migration example', () => {
  it('validates presentation before changing actual Core variables', async () => {
    const fixture = await migrationExample();
    try {
      const incoming = fixture.interpreter.saveSnapshot()!;
      incoming.variables.score = 99;
      incoming.presentation = { version: 1, payload: { stage: 'invalid' } };
      expect(() => fixture.interpreter.loadSnapshot(incoming)).toThrow(fixture.failure);
      expect(fixture.store.get('score')).toBe(7);
      expect(fixture.restore).not.toHaveBeenCalled();
    } finally { fixture.cleanup(); }
  });

  it('forwards the real Core reading-point context to Renderer snapshots', async () => {
    const fixture = await migrationExample();
    try {
      fixture.interpreter.saveSnapshot();
      expect(fixture.snapshot).toHaveBeenLastCalledWith({ replayCurrentText: true });
    } finally { fixture.cleanup(); }
  });

  it('disconnects the Core hooks before disposing the returned runtime', async () => {
    const fixture = await migrationExample();
    fixture.cleanup();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.runtime.dispose).toHaveBeenCalledOnce();
    expect(fixture.audio.dispose).toHaveBeenCalledOnce();
    expect(() => fixture.interpreter.saveSnapshot()).not.toThrow();
    expect(fixture.interpreter.saveSnapshot()!.presentation).toBeUndefined();
  });
});
