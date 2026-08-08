import { describe, expect, it } from 'vitest';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import type {
  RendererControllerPort,
  RendererRuntimeInternals,
  RendererStagePort,
} from '../../src/runtime/create-renderer-runtime.js';
import { createRendererRuntimeFromInternals } from '../../src/runtime/create-renderer-runtime.js';

interface PresentationInternals extends RendererRuntimeInternals {
  calls: Array<{ method: string; args: readonly unknown[] }>;
  advanceFrame(deltaMs: number): void;
}

function presentationInternals(): PresentationInternals {
  const calls: Array<{ method: string; args: readonly unknown[] }> = [];
  const state: {
    stage: { background: string } | null;
    timelines: Array<{ id: string; cue: string }>;
  } = {
    stage: { background: 'old-background' },
    timelines: [{ id: 'old-timeline', cue: 'old-cue' }],
  };
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const stage = {
    clearPresentation: () => {
      state.stage = null;
      record('stage.clearPresentation');
    },
    snapshotPresentation: () => state.stage,
    needsUpdate: () => state.stage !== null,
    destroy: () => record('stage.destroy'),
  } as unknown as RendererStagePort;
  const controller = {
    status: 'idle' as const,
    autoPlay: false,
    skipMode: false,
    skipAll: false,
    backlogOpen: false,
    interfaceHidden: false,
    needsUpdate: true,
    update: (deltaMs: number) => {
      if (state.timelines.length > 0) record('controller.timeline.cue', deltaMs);
    },
    setFrameRequest: () => undefined,
    connect: () => () => undefined,
    reset: () => undefined,
    advance: () => false,
    select: () => false,
    dispatchInput: () => false,
    setTextSpeed: () => undefined,
    setAutoWait: () => undefined,
    backlogEntries: () => [],
    backlogSearchQuery: () => '',
    snapshotPresentation: () => ({
      version: 1,
      stage: state.stage,
      timelines: state.timelines.slice(),
    }),
    restorePresentation: () => undefined,
    clearPresentation: () => {
      state.timelines = [];
      record('controller.clearPresentation');
    },
    dispose: () => record('controller.dispose'),
  } as unknown as RendererControllerPort;
  const monitor = new RenderPerformanceMonitor();
  return {
    canvas: {} as HTMLCanvasElement,
    stage,
    controller,
    scheduler: { dispose: () => record('scheduler.dispose') },
    monitor,
    resourceSnapshot: () => ({
      disposed: false,
      tickerCallbacks: 0,
      listeners: 0,
      activeTweens: 0,
      activeAsyncTasks: 0,
      blobUrls: 0,
      pooledObjects: {},
      displayObjectsByOwner: {},
    }),
    calls,
    advanceFrame: (deltaMs: number) => controller.update(deltaMs),
  };
}

describe('Renderer v2 presentation transaction', () => {
  it('clear removes controller timelines and stage state, then stays inert and idempotent', async () => {
    const internals = presentationInternals();
    const runtime = await createRendererRuntimeFromInternals(internals);

    runtime.commands.presentation.clear();
    const afterFirstClear = runtime.queries.presentation.snapshot();
    expect(afterFirstClear).toEqual({ version: 1, stage: null, timelines: [] });

    internals.advanceFrame(16);
    expect(internals.calls.some((entry) => entry.method === 'controller.timeline.cue')).toBe(false);

    runtime.commands.presentation.clear();
    const afterSecondClear = runtime.queries.presentation.snapshot();
    expect(afterSecondClear).toEqual(afterFirstClear);
    internals.advanceFrame(16);
    expect(internals.calls.some((entry) => entry.method === 'controller.timeline.cue')).toBe(false);
    expect(internals.calls.filter((entry) => entry.method === 'controller.clearPresentation')).toHaveLength(2);
    expect(internals.calls.filter((entry) => entry.method === 'stage.clearPresentation')).toHaveLength(2);
  });
});
