import { describe, expect, it } from 'vitest';
import { EventBus } from '@surdet/core';
import type { Texture } from 'pixi.js';
import { AsyncGeneration } from '../../src/lifecycle/async-generation.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import { NULL_AUDIO, type AdvStage } from '../../src/types.js';
import type {
  RendererControllerPort,
  RendererRuntimeInternals,
  RendererStagePort,
} from '../../src/runtime/create-renderer-runtime.js';
import { createRendererRuntimeFromInternals } from '../../src/runtime/create-renderer-runtime.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';

interface RealCycleResult {
  snapshot: ReturnType<RenderLifecycle['snapshot']>;
  unloaded: number;
  lateWasDiscarded: boolean;
}

async function runRealRuntimeCycle(): Promise<RealCycleResult> {
  const lifecycle = new RenderLifecycle();
  let lateResolve: ((texture: unknown) => void) | undefined;
  let unloaded = 0;
  const registry = new RenderAssetRegistry({
    lifecycle,
    load: async (source) => {
      if (source === 'late.png') {
        return await new Promise<unknown>((resolve) => { lateResolve = resolve; }) as Texture;
      }
      return { source } as unknown as Texture;
    },
    unload: async (sources) => { unloaded += sources.length; },
  });
  const stage = {
    setBackground: () => undefined,
    setPortrait: () => undefined,
    removePortrait: () => undefined,
    showText: () => undefined,
    showChoices: () => undefined,
    hideChoices: () => undefined,
    setFade: () => undefined,
    clearPresentation: () => undefined,
    snapshotPresentation: () => ({ version: 1 }),
    needsUpdate: () => false,
    resetSession: () => undefined,
    destroy: () => undefined,
  } as unknown as AdvStage & RendererStagePort;
  const ports = createPresentationPorts(stage, {
    assetRegistry: registry,
    resourceSnapshot: () => lifecycle.snapshot(),
  });
  const controller = new PresentationController(ports.commands, ports.queries, NULL_AUDIO, {
    commands: ports.commands,
    queries: ports.queries,
    lifecycle,
    resetProjection: (options) => registry.reset({
      clearAssets: options?.clearAssets,
      preserveAssets: options?.preserveWorld,
    }),
  });
  const runtime = await createRendererRuntimeFromInternals({
    canvas: {} as HTMLCanvasElement,
    stage,
    controller,
    scheduler: { dispose: () => undefined },
    monitor: new RenderPerformanceMonitor(),
    assetRegistry: registry,
    lifecycle,
    resourceSnapshot: () => lifecycle.snapshot(),
  });

  const bus = new EventBus<import('@surdet/core').CoreEventMap>();
  const unsubscribe = controller.connect(bus);
  expect(lifecycle.snapshot().listeners).toBe(2);
  await runtime.commands.assets.registerBackground('bg', 'bg.png');
  await runtime.commands.assets.registerPortrait('hero', 'normal', 'smile', 'hero.png');
  expect(registry.diagnosticSnapshot().backgrounds).toEqual(['bg']);
  expect(registry.diagnosticSnapshot().portraits).toEqual(['hero:normal:smile']);

  const lateLoad = runtime.commands.assets.registerBackground('late', 'late.png');
  controller.reset({ clearAssets: true });
  lateResolve?.({ source: 'late.png' });
  await lateLoad;
  const lateWasDiscarded = !registry.diagnosticSnapshot().backgrounds.includes('late');
  expect(lateWasDiscarded).toBe(true);
  expect(registry.diagnosticSnapshot().backgrounds).toEqual([]);

  unsubscribe();
  expect(lifecycle.snapshot().listeners).toBe(1);
  controller.disconnect();
  expect(lifecycle.snapshot().listeners).toBe(1);
  runtime.dispose();
  expect(lifecycle.snapshot()).toMatchObject({
    disposed: true,
    tickerCallbacks: 0,
    listeners: 0,
    activeTweens: 0,
    activeAsyncTasks: 0,
    blobUrls: 0,
    pooledObjects: {},
  });
  return { snapshot: lifecycle.snapshot(), unloaded, lateWasDiscarded };
}

async function runRealRuntimeBatch(): Promise<RealCycleResult[]> {
  const results: RealCycleResult[] = [];
  for (let cycle = 0; cycle < 50; cycle += 1) results.push(await runRealRuntimeCycle());
  return results;
}

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

  it('keeps two independent real runtime/registry/controller batches at the same 50-cycle stable point', async () => {
    const first = await runRealRuntimeBatch();
    const second = await runRealRuntimeBatch();

    expect(first).toHaveLength(50);
    expect(second).toHaveLength(50);
    expect(first.every((result) => result.lateWasDiscarded)).toBe(true);
    expect(second.every((result) => result.lateWasDiscarded)).toBe(true);
    expect(second.map((result) => result.snapshot)).toEqual(first.map((result) => result.snapshot));
    expect(second.map((result) => result.unloaded)).toEqual(first.map((result) => result.unloaded));
    expect(first.every((result) => result.snapshot.listeners === 0)).toBe(true);
    expect(first.every((result) => result.snapshot.activeAsyncTasks === 0)).toBe(true);
  });
});
