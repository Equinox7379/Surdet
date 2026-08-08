import { describe, expect, it } from 'vitest';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import type {
  RendererControllerPort,
  RendererRuntimeInternals,
  RendererStagePort,
} from '../../src/runtime/create-renderer-runtime.js';
import { createRendererRuntimeFromInternals } from '../../src/runtime/create-renderer-runtime.js';

interface FakeInternals extends RendererRuntimeInternals {
  calls: Array<{ method: string; args: readonly unknown[] }>;
  disposeOrder: string[];
  observableSnapshot(): unknown;
}

function fakeInternals(): FakeInternals {
  const calls: Array<{ method: string; args: readonly unknown[] }> = [];
  const disposeOrder: string[] = [];
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const stage = {
    registerBackground: async (key: string, source: string) => record('stage.registerBackground', key, source),
    setBackground: (key: string | null) => record('stage.setBackground', key),
    setPortrait: (key: string, view: unknown) => record('stage.setPortrait', key, view),
    showText: (speaker: string | null, value: string) => record('stage.showText', speaker, value),
    showChoices: (options: readonly unknown[]) => record('stage.showChoices', options),
    showTitle: (view: unknown, onSelect: unknown) => record('stage.showTitle', view, onSelect),
    showGallery: (options: unknown) => record('stage.showGallery', options),
    showBattle: (view: unknown, handlers: unknown, message?: string) => record('stage.showBattle', view, handlers, message),
    showLoading: (progress: unknown) => record('stage.showLoading', progress),
    setQuality: (quality: unknown) => record('stage.setQuality', quality),
    setPresentationPreferences: (preferences: unknown) => record('stage.setPresentationPreferences', preferences),
    setPostProcess: (settings: unknown) => record('stage.setPostProcess', settings),
    clearPresentation: () => record('stage.clearPresentation'),
    snapshotPresentation: () => ({ version: 1, source: 'stage' }),
    captureThumbnail: () => 'data:image/png;base64,fake',
    getQuality: () => 'balanced' as const,
    getPresentationPreferences: () => ({ reducedMotion: false, transitionScale: 1, particleEnabled: true }),
    getPostProcess: () => ({ enabled: false, saturation: 1, brightness: 1, contrast: 1 }),
    getFontFamily: () => 'system-ui',
    needsUpdate: () => false,
    fitWindow: () => record('stage.fitWindow'),
    destroy: () => { disposeOrder.push('stage'); record('stage.destroy'); },
  } as unknown as RendererStagePort;
  const controller = {
    status: 'idle' as const,
    autoPlay: false,
    skipMode: false,
    skipAll: false,
    backlogOpen: false,
    interfaceHidden: false,
    needsUpdate: false,
    update: (deltaMs: number) => record('controller.update', deltaMs),
    setFrameRequest: () => undefined,
    connect: () => () => undefined,
    reset: (options?: unknown) => record('controller.reset', options),
    advance: () => true,
    select: () => true,
    dispatchInput: () => true,
    setTextSpeed: () => undefined,
    setAutoWait: () => undefined,
    backlogEntries: () => [],
    backlogSearchQuery: () => '',
    snapshotPresentation: () => ({ version: 1, source: 'controller' }),
    restorePresentation: (snapshot: unknown) => record('controller.restorePresentation', snapshot),
    dispose: () => { disposeOrder.push('controller'); record('controller.dispose'); },
  } as unknown as RendererControllerPort;
  const scheduler = {
    dispose: () => { disposeOrder.push('scheduler'); record('scheduler.dispose'); },
  };
  const monitor = new RenderPerformanceMonitor();
  const resourceSnapshot = () => ({
    disposed: false,
    tickerCallbacks: 0,
    listeners: 0,
    activeTweens: 0,
    activeAsyncTasks: 0,
    blobUrls: 0,
    pooledObjects: {},
    displayObjectsByOwner: {},
  });

  return {
    canvas: {} as HTMLCanvasElement,
    stage,
    controller,
    scheduler,
    monitor,
    resourceSnapshot,
    calls,
    disposeOrder,
    observableSnapshot: () => ({ calls: calls.slice(), disposeOrder: disposeOrder.slice() }),
  };
}

describe('Renderer v2 runtime facade', () => {
  it('constructs one runtime and disposes it idempotently', async () => {
    const internals = fakeInternals();
    const runtime = await createRendererRuntimeFromInternals(internals);

    expect(runtime.canvas).toBe(internals.canvas);
    runtime.dispose();
    runtime.dispose();

    expect(internals.disposeOrder).toEqual(['scheduler', 'controller', 'stage']);
  });

  it('delegates representative methods once across every command domain', async () => {
    const internals = fakeInternals();
    const runtime = await createRendererRuntimeFromInternals(internals);
    const onSelect = (): void => undefined;
    const handlers = { onAttack: onSelect, onPass: onSelect };

    await runtime.commands.assets.registerBackground('bg', 'bg.png');
    runtime.commands.world.setBackground('bg');
    runtime.commands.dialogue.showText('林恩', '你好');
    runtime.commands.menu.showTitle({ title: 'Surdet', items: [] }, onSelect);
    runtime.commands.gallery.showGallery({ cgs: [], music: [] });
    runtime.commands.system.showBattle({ turn: 1, actingTeam: 'a', finished: false, winner: null, units: [] }, handlers);
    runtime.commands.loading.showLoading({ total: 1, completed: 0, failed: 0, current: 'bg', done: false });
    runtime.commands.preferences.setQuality('high');
    runtime.commands.presentation.clear();

    expect(internals.calls.map((entry) => entry.method)).toEqual([
      'stage.registerBackground',
      'stage.setBackground',
      'stage.showText',
      'stage.showTitle',
      'stage.showGallery',
      'stage.showBattle',
      'stage.showLoading',
      'stage.setQuality',
      'stage.clearPresentation',
    ]);
  });

  it('preserves reset and presentation restore delegation', async () => {
    const internals = fakeInternals();
    const runtime = await createRendererRuntimeFromInternals(internals);
    const snapshot = { version: 1, source: 'test' };

    runtime.resetSession({ preserveWorld: true });
    runtime.commands.presentation.restore(snapshot);

    expect(internals.calls).toContainEqual({ method: 'controller.reset', args: [{ preserveWorld: true }] });
    expect(internals.calls).toContainEqual({ method: 'controller.restorePresentation', args: [snapshot] });
  });
});
