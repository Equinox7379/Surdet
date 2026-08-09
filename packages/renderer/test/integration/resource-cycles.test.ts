import { describe, expect, it } from 'vitest';
import { AsyncGeneration } from '../../src/lifecycle/async-generation.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import type {
  RendererControllerPort,
  RendererRuntimeInternals,
  RendererStagePort,
} from '../../src/runtime/create-renderer-runtime.js';
import { createRendererRuntimeFromInternals } from '../../src/runtime/create-renderer-runtime.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';

function runCycleBatch(lifecycle: RenderLifecycle, batch: number): void {
  for (let cycle = 0; cycle < 50; cycle += 1) {
    lifecycle.register('runtime', 'ticker', 'frame-scheduler', () => undefined);
    lifecycle.register('runtime', 'listener', 'core-events', () => undefined);
    lifecycle.register('dialogue', 'tween', `dialogue-fade-${cycle}`, () => undefined);
    lifecycle.register('dialogue', 'async', `dialogue-load-${cycle}`, () => undefined);
    lifecycle.register('world', 'blob', `world-blob-${cycle}`, () => undefined);
    lifecycle.register('world', 'pool', `ruby-${cycle % 4}`, () => undefined);
    lifecycle.register('world', 'display', `portrait-${cycle % 3}`, () => undefined);
    if (batch > 0) lifecycle.register('world', 'pool', `batch-${batch}-${cycle % 4}`, () => undefined);

    lifecycle.releaseOwner('dialogue');
    lifecycle.releaseOwner('world');
  }
  lifecycle.releaseOwner('runtime');
}

describe('Renderer M2 resource lifecycle integration', () => {
  it('keeps the second independent 50-cycle batch at the same stable resource point', () => {
    const lifecycle = new RenderLifecycle();
    runCycleBatch(lifecycle, 0);
    const first = lifecycle.snapshot();
    runCycleBatch(lifecycle, 1);
    const second = lifecycle.snapshot();

    expect(second).toEqual(first);
    expect(second).toMatchObject({
      tickerCallbacks: 0,
      listeners: 0,
      activeTweens: 0,
      activeAsyncTasks: 0,
      blobUrls: 0,
      pooledObjects: {},
      displayObjectsByOwner: { world: 0 },
    });
    lifecycle.dispose();
  });

  it('invalidates late async work after a cycle reset and after runtime disposal', () => {
    const generation = new AsyncGeneration();
    const stale = generation.token();
    generation.advance();
    expect(stale.current).toBe(false);
    expect(stale.signal.aborted).toBe(true);
    const current = generation.token();
    generation.dispose();
    expect(current.current).toBe(false);
    expect(current.signal.aborted).toBe(true);
  });

  it('registers scheduler/controller ownership and disposes the runtime in order', async () => {
    const calls: string[] = [];
    const lifecycle = new RenderLifecycle();
    const stage = {
      destroy: () => calls.push('stage'),
    } as unknown as RendererStagePort;
    const controller = {
      status: 'idle' as const,
      autoPlay: false,
      skipMode: false,
      skipAll: false,
      backlogOpen: false,
      interfaceHidden: false,
      needsUpdate: false,
      update: () => undefined,
      setFrameRequest: () => undefined,
      connect: () => () => undefined,
      reset: () => undefined,
      advance: () => false,
      select: () => false,
      dispatchInput: () => false,
      setTextSpeed: () => undefined,
      setAutoWait: () => undefined,
      dispose: () => calls.push('controller'),
      snapshotPresentation: () => null,
    } as unknown as RendererControllerPort;
    const internals: RendererRuntimeInternals = {
      canvas: {} as HTMLCanvasElement,
      stage,
      controller,
      scheduler: { dispose: () => calls.push('scheduler') },
      monitor: new RenderPerformanceMonitor(),
      lifecycle,
    };

    const runtime = await createRendererRuntimeFromInternals(internals);
    expect(lifecycle.snapshot()).toMatchObject({ tickerCallbacks: 1, listeners: 1 });
    runtime.dispose();
    runtime.dispose();

    expect(calls).toEqual(['scheduler', 'controller', 'stage']);
    expect(lifecycle.snapshot()).toMatchObject({ disposed: true, tickerCallbacks: 0, listeners: 0 });
    expect(runtime.queries.diagnostics.isDisposed()).toBe(true);
  });
});
