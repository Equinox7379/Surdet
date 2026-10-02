import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { RendererError } from '../../src/api/renderer-errors.js';
import { RendererStageHost } from '../../src/pixi-stage-host.js';
import { LoadingLayer } from '../../src/loading-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';
import type {
  RendererControllerPort,
  RendererRuntimeInternals,
  RendererStagePort,
} from '../../src/runtime/create-renderer-runtime.js';
import { createRendererRuntime, createRendererRuntimeFromInternals } from '../../src/runtime/create-renderer-runtime.js';

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
    canCaptureRollbackCheckpoint: () => true,
    snapshotPresentation: () => ({ version: 1, source: 'controller' }),
    restorePresentation: (snapshot: unknown) => record('controller.restorePresentation', snapshot),
    clearPresentation: () => record('controller.clearPresentation'),
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

  it('does not expose concrete Layer instances through Runtime or hidden properties', async () => {
    const internals = fakeInternals();
    const layerSentinel = { layerSentinel: true };
    (internals as unknown as { dialogueLayer: unknown }).dialogueLayer = layerSentinel;
    (internals as unknown as { projectionSnapshot: () => unknown }).projectionSnapshot = () => ({
      dialogue: {
        activeSpeakerId: null,
        projectionVersion: 0,
        speakerText: '',
        dialogText: '',
        choiceLabels: [],
        choiceBounds: [],
        visibleChoiceCount: 0,
        rubyBaseCount: 0,
        rubyTextCount: 0,
        backlogVisible: false,
        backlogAboveDialogueText: true,
        commandRailVisible: true,
        commandRailSuppressed: false,
        nvlActive: false,
        nvlLines: [],
      },
      menu: null,
      gallery: null,
      system: null,
      world: null,
    });

    const runtime = await createRendererRuntimeFromInternals(internals);
    const ownKeys = Reflect.ownKeys(runtime).map(String);

    expect(ownKeys).not.toContain('__rendererV2Debug');
    expect((runtime as unknown as { __rendererV2Debug?: unknown }).__rendererV2Debug).toBeUndefined();
    expect(runtime.queries.diagnostics.projectionSnapshot().dialogue).not.toBe(layerSentinel);
    expect(runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText).toBe('');
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
      'controller.clearPresentation',
      'stage.clearPresentation',
    ]);
  });

  it('preserves literal keys when cloning supported legacy opaque presentation data', async () => {
    const internals = fakeInternals();
    const payload = { ...JSON.parse('{"__proto__":{"frame":2}}'), callback: () => {} };
    internals.controller.snapshotPresentation = () => payload;
    const runtime = await createRendererRuntimeFromInternals(internals);
    const snapshot = runtime.queries.presentation.snapshot() as Record<string, unknown>;
    expect(Object.keys(snapshot)).toEqual(['__proto__', 'callback']);
    expect(snapshot['__proto__']).toEqual({ frame: 2 });
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    runtime.dispose();
  });

  it.each([
    ['setPortraitSpeaking', 'legacy'], ['setPortraitSkipping', 'legacy'],
    ['setPortraitSpeaking', 'layer'], ['setPortraitSkipping', 'layer'],
  ] as const)('rejects optional %s after runtime disposal (%s port)', async (command, port) => {
    const internals = fakeInternals();
    const update = vi.fn();
    const legacyUpdate = vi.fn();
    internals.stage[command] = port === 'legacy' ? update : legacyUpdate;
    const runtime = await createRendererRuntimeFromInternals(port === 'legacy' ? internals : {
      ...internals, worldLayer: { [command]: update, dispose: vi.fn() } as unknown as NonNullable<RendererRuntimeInternals['worldLayer']>,
    });
    runtime.commands.world[command]!(true);
    expect(update).toHaveBeenCalledWith(true);
    expect(update).toHaveBeenCalledTimes(1);
    runtime.dispose();
    expect(() => runtime.commands.world[command]!(false)).toThrowError(expect.objectContaining({ code: 'RENDERER_DISPOSED', domain: 'world', command }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(legacyUpdate).not.toHaveBeenCalled();
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

  it('exposes the stable rollback boundary as a pure public query', async () => {
    const internals = fakeInternals();
    let safe = false;
    (internals.controller as unknown as { canCaptureRollbackCheckpoint: () => boolean })
      .canCaptureRollbackCheckpoint = () => safe;
    const runtime = await createRendererRuntimeFromInternals(internals);
    const before = internals.observableSnapshot();

    expect(runtime.queries.presentation.canCaptureRollbackCheckpoint()).toBe(false);
    expect(internals.observableSnapshot()).toEqual(before);

    safe = true;
    expect(runtime.queries.presentation.canCaptureRollbackCheckpoint()).toBe(true);
    expect(internals.observableSnapshot()).toEqual(before);
  });

  it('projects a theme through Runtime to all five real Layers exactly once', async () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new RendererStageHost(assets, lifecycle);
    let frameRequests = 0;
    stage.setFrameRequest(() => { frameRequests += 1; });
    const base = fakeInternals();
    const internals = {
      ...base,
      stage,
      assetRegistry: assets,
      lifecycle,
      resourceSnapshot: () => lifecycle.snapshot(),
      dialogueLayer: stage.dialogueLayer,
      menuLayer: stage.menuLayer,
      galleryLayer: stage.galleryLayer,
      systemPanelLayer: stage.systemPanelLayer,
      worldLayer: stage.worldLayer,
    } as unknown as RendererRuntimeInternals;
    const layers = [
      stage.dialogueLayer,
      stage.menuLayer,
      stage.galleryLayer,
      stage.systemPanelLayer,
    ];
    const themeSpies = layers.map((layer) => vi.spyOn(layer, 'setTheme'));
    const loadingThemeSpy = vi.spyOn(LoadingLayer.prototype, 'setTheme');

    const runtime = await createRendererRuntimeFromInternals(internals);
    const resourcesBefore = runtime.queries.diagnostics.resourceSnapshot();
    runtime.commands.preferences.setTheme({ colors: { accent: 0x47c8ff } });

    expect(themeSpies).toHaveLength(4);
    expect(themeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(themeSpies.every((spy) => spy.mock.calls[0]?.[0].colors.accent === 0x47c8ff)).toBe(true);
    expect(loadingThemeSpy).toHaveBeenCalledTimes(1);
    expect(loadingThemeSpy.mock.calls[0]?.[0].colors.accent).toBe(0x47c8ff);
    expect(runtime.queries.preferences.theme().colors.accent).toBe(0x47c8ff);
    expect(frameRequests).toBe(1);

    runtime.commands.preferences.setTheme({ colors: { accent: 0x47c8ff } });
    expect(themeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(loadingThemeSpy).toHaveBeenCalledTimes(1);
    expect(frameRequests).toBe(1);

    expect(() => runtime.commands.preferences.setTheme({ colors: { accent: -1 } } as never))
      .toThrow(/RENDERER_THEME_INVALID/);
    expect(runtime.queries.preferences.theme().colors.accent).toBe(0x47c8ff);
    expect(themeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(loadingThemeSpy).toHaveBeenCalledTimes(1);
    expect(runtime.queries.diagnostics.resourceSnapshot()).toMatchObject({
      listeners: resourcesBefore.listeners,
      activeTweens: resourcesBefore.activeTweens,
      displayObjectsByOwner: resourcesBefore.displayObjectsByOwner,
    });

    runtime.dispose();
    expect(() => runtime.commands.preferences.setTheme({ colors: { accent: 0x123456 } }))
      .toThrow(RendererError);
  });

  it('attempts every runtime disposer after failures and reports RendererError with AggregateError', async () => {
    const calls: string[] = [];
    const disposers = new Map<string, () => void>();
    const lifecycle = {
      register: (_owner: string, _kind: string, key: string, dispose: () => void) => { disposers.set(key, dispose); },
      release: (_owner: string, _kind: string, key: string) => {
        const dispose = disposers.get(key);
        disposers.delete(key);
        if (dispose) dispose();
        return Boolean(dispose);
      },
      forget: (_owner: string, _kind: string, key: string) => disposers.delete(key),
      snapshot: () => ({ disposed: false, tickerCallbacks: 0, listeners: 0, activeTweens: 0, activeAsyncTasks: 0, blobUrls: 0, pooledObjects: {}, displayObjectsByOwner: {} }),
      dispose: () => { calls.push('lifecycle'); throw new Error('lifecycle failure'); },
    };
    const internals = fakeInternals();
    (internals as unknown as { lifecycle: unknown }).lifecycle = lifecycle;
    internals.scheduler.dispose = () => { calls.push('scheduler'); throw new Error('scheduler failure'); };
    internals.controller.dispose = () => { calls.push('controller'); throw new Error('controller failure'); };
    internals.stage.destroy = () => { calls.push('stage'); throw new Error('stage failure'); };
    (internals as unknown as { assetRegistry?: unknown }).assetRegistry = { dispose: () => { calls.push('asset-registry'); throw new Error('asset failure'); } };
    const markDisposed = vi.spyOn(RendererFacade.prototype, 'markDisposed').mockImplementation(() => {
      calls.push('facade');
      throw new Error('facade failure');
    });
    try {
      const runtime = await createRendererRuntimeFromInternals(internals);
      expect(() => runtime.dispose()).toThrow(RendererError);
      expect(calls).toEqual(['scheduler', 'controller', 'stage', 'asset-registry', 'lifecycle', 'facade']);
      try {
        runtime.dispose();
      } catch {
        // The first failed disposal is terminal and idempotent; no second cleanup is allowed.
      }
      const error = (() => {
        try { runtime.dispose(); return null; } catch (cause) { return cause; }
      })();
      expect(error).toBeNull();
    } finally {
      markDisposed.mockRestore();
    }
  });

  it('cleans all initialized resources when composition initialization fails', async () => {
    const calls: string[] = [];
    const lifecycle = {
      register: () => { throw new Error('registration failure'); },
      release: () => false,
      forget: () => false,
      snapshot: () => ({ disposed: false, tickerCallbacks: 0, listeners: 0, activeTweens: 0, activeAsyncTasks: 0, blobUrls: 0, pooledObjects: {}, displayObjectsByOwner: {} }),
      dispose: () => calls.push('lifecycle'),
    };
    const internals = fakeInternals();
    (internals as unknown as { lifecycle: unknown }).lifecycle = lifecycle;
    internals.stage.destroy = () => calls.push('stage');
    (internals as unknown as { assetRegistry?: unknown }).assetRegistry = { dispose: () => calls.push('asset-registry') };

    await expect(createRendererRuntimeFromInternals(internals)).rejects.toThrow();
    expect(calls).toEqual(['stage', 'asset-registry', 'lifecycle']);
  });

  it('cleans the real stage and registry when Pixi runtime initialization fails', async () => {
    const init = vi.spyOn(RendererStageHost.prototype, 'init').mockRejectedValue(new Error('stage init failure'));
    const stageDestroy = vi.spyOn(RendererStageHost.prototype, 'destroy');
    const registryDispose = vi.spyOn(RenderAssetRegistry.prototype, 'dispose');
    try {
      await expect(createRendererRuntime()).rejects.toBeInstanceOf(RendererError);
      expect(stageDestroy).toHaveBeenCalledTimes(1);
      expect(registryDispose).toHaveBeenCalled();
    } finally {
      init.mockRestore();
      stageDestroy.mockRestore();
      registryDispose.mockRestore();
    }
  });
});
