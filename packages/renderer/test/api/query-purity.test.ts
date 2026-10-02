import { describe, expect, it } from 'vitest';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import type { RenderLifecycleDiagnosticSnapshot } from '../../src/lifecycle/render-lifecycle.js';
import type {
  RendererControllerPort,
  RendererRuntimeInternals,
  RendererStagePort,
} from '../../src/runtime/create-renderer-runtime.js';
import { createRendererRuntimeFromInternals } from '../../src/runtime/create-renderer-runtime.js';

function pureInternals(): RendererRuntimeInternals & { observableSnapshot(): unknown } {
  const state = { reads: 0, writes: 0 };
  const stage = {
    captureThumbnail: () => 'thumbnail',
    snapshotPresentation: () => ({ version: 1, state: { visible: true } }),
    getQuality: () => 'balanced' as const,
    getPresentationPreferences: () => ({ reducedMotion: false, transitionScale: 1, particleEnabled: true }),
    getPostProcess: () => ({ enabled: false, saturation: 1, brightness: 1, contrast: 1 }),
    getFontFamily: () => 'system-ui',
    needsUpdate: () => false,
    destroy: () => { state.writes += 1; },
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
    reset: () => { state.writes += 1; },
    advance: () => false,
    select: () => false,
    dispatchInput: () => false,
    setTextSpeed: () => undefined,
    setAutoWait: () => undefined,
    backlogEntries: () => [],
    backlogSearchQuery: () => '',
    snapshotPresentation: () => ({ version: 1, state: { visible: true } }),
    dispose: () => { state.writes += 1; },
  } as unknown as RendererControllerPort;
  const monitor = new RenderPerformanceMonitor();
  return {
    canvas: {} as HTMLCanvasElement,
    stage,
    controller,
    scheduler: { dispose: () => { state.writes += 1; } },
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
    projectionSnapshot: () => ({
      dialogue: {
        activeSpeakerId: 'lynn',
        projectionVersion: 1,
        speakerText: '凛',
        dialogText: '夜色渐深。',
        choiceLabels: ['继续'],
        choiceBounds: [{ x: 300, y: 400, width: 200, height: 42 }],
        visibleChoiceCount: 1,
        rubyBaseCount: 0,
        rubyTextCount: 0,
        backlogVisible: false,
        backlogAboveDialogueText: true,
        commandRailVisible: true,
        commandRailSuppressed: false,
        nvlActive: false,
        nvlLines: [],
      },
      menu: { overlay: { type: 'none' }, titleItemCount: 0, systemMenuItemCount: 0, settingsRowCount: 0, saveLoadSlotCount: 0 },
      gallery: { overlay: { type: 'none' }, cgCount: 0, musicCount: 0, textCount: 0 },
      system: { overlay: { type: 'none' }, battleUnitCount: 0, mapNodeCount: 0, shopItemCount: 0, baseCommandCount: 0 },
      world: { activeSpeakerId: 'lynn', backgroundKey: 'night', particleKind: null },
      themeProjection: {
        dialogue: { visibleTextFills: [0xf2f6ff], visibleGraphicsColors: [0x5ac8ff] },
        menu: { visibleTextFills: [0xf2f6ff], visibleGraphicsColors: [0x5ac8ff] },
        gallery: { visibleTextFills: [], visibleGraphicsColors: [] },
        system: { visibleTextFills: [], visibleGraphicsColors: [] },
        loading: { visibleTextFills: [], visibleGraphicsColors: [] },
      },
    }),
    observableSnapshot: () => ({ ...state }),
  };
}

describe('Renderer v2 query purity', () => {
  it('isolates public performance samples from later host edits', async () => {
    const internals = pureInternals();
    internals.monitor!.record(16, 5);
    const runtime = await createRendererRuntimeFromInternals(internals);
    try {
      const sample = runtime.queries.diagnostics.performanceSnapshot()!.samples[0]!;
      sample.deltaMs = 0; sample.updateMs = 999; sample.slow = true;
      expect(runtime.queries.diagnostics.performanceSnapshot()).toMatchObject({
        averageDeltaMs: 16, averageUpdateMs: 5, slowFrames: 0, samples: [{ deltaMs: 16, updateMs: 5, slow: false }],
      });
    } finally { runtime.dispose(); }
  });

  it('diagnostic, presentation, visual, and preference queries do not mutate state', async () => {
    const internals = pureInternals();
    const runtime = await createRendererRuntimeFromInternals(internals);
    const before = internals.observableSnapshot();

    runtime.queries.diagnostics.resourceSnapshot();
    runtime.queries.diagnostics.performanceSnapshot();
    const projection = runtime.queries.diagnostics.projectionSnapshot();
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.dialogue)).toBe(true);
    expect(Object.isFrozen(projection.dialogue?.choiceLabels)).toBe(true);
    expect(Object.isFrozen(projection.dialogue?.nvlLines)).toBe(true);
    expect(Object.isFrozen(projection.menu)).toBe(true);
    expect(Object.isFrozen(projection.menu?.overlay)).toBe(true);
    expect(Object.isFrozen(projection.gallery)).toBe(true);
    expect(Object.isFrozen(projection.gallery?.overlay)).toBe(true);
    expect(Object.isFrozen(projection.system)).toBe(true);
    expect(Object.isFrozen(projection.system?.overlay)).toBe(true);
    expect(Object.isFrozen(projection.world)).toBe(true);
    expect(Object.isFrozen(projection.themeProjection)).toBe(true);
    expect(Object.isFrozen(projection.themeProjection?.dialogue)).toBe(true);
    expect(Object.isFrozen(projection.themeProjection?.dialogue.visibleTextFills)).toBe(true);
    const mutableThemeProjection = projection.themeProjection!.dialogue as unknown as { visibleTextFills: number[] };
    expect(() => mutableThemeProjection.visibleTextFills.push(0xdeadbe)).toThrow();
    expect(runtime.queries.diagnostics.projectionSnapshot().themeProjection?.dialogue.visibleTextFills)
      .toEqual([0xf2f6ff]);
    const mutableDialogue = projection.dialogue as unknown as { choiceLabels: string[]; dialogText: string };
    expect(() => mutableDialogue.choiceLabels.push('宿主篡改')).toThrow();
    expect(() => { mutableDialogue.dialogText = '宿主篡改'; }).toThrow();
    expect(runtime.queries.diagnostics.projectionSnapshot().dialogue?.choiceLabels).toEqual(['继续']);
    expect(runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText).toBe('夜色渐深。');
    runtime.queries.diagnostics.needsUpdate();
    runtime.queries.world.captureThumbnail();
    runtime.queries.presentation.snapshot();
    runtime.queries.overlay.menu();
    runtime.queries.overlay.gallery();
    runtime.queries.preferences.quality();
    runtime.queries.preferences.presentationPreferences();
    runtime.queries.preferences.postProcess();
    runtime.queries.preferences.fontFamily('body');
    const theme = runtime.queries.preferences.theme();
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.colors)).toBe(true);

    expect(internals.observableSnapshot()).toEqual(before);
  });

  it('freezes only the cloned projection and never the provider snapshot', async () => {
    const baseInternals = pureInternals();
    const source = baseInternals.projectionSnapshot!();
    const internals = {
      ...baseInternals,
      projectionSnapshot: () => source,
    };
    const runtime = await createRendererRuntimeFromInternals(internals);
    const projection = runtime.queries.diagnostics.projectionSnapshot();

    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.themeProjection)).toBe(false);
    expect(projection).not.toBe(source);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.dialogue)).toBe(true);
  });

  it('returns an immutable, isolated resource ledger without changing lifecycle state', async () => {
    const baseInternals = pureInternals();
    const source: RenderLifecycleDiagnosticSnapshot = {
      active: [{ owner: 'menu', kind: 'listener', key: 'title', source: 'menu.ts:1', active: true }],
      events: [{
        owner: 'menu',
        kind: 'listener',
        key: 'title',
        source: 'menu.ts:1',
        action: 'dispose',
        path: 'release',
        outcome: 'failure',
        cause: 'title listener failed',
      }],
    };
    let reads = 0;
    const internals = {
      ...baseInternals,
      resourceLedger: () => {
        reads += 1;
        return source;
      },
    };
    const runtime = await createRendererRuntimeFromInternals(internals);
    const before = internals.observableSnapshot();

    const ledger = runtime.queries.diagnostics.resourceLedger!();
    expect(reads).toBe(1);
    expect(ledger).not.toBe(source);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger.active)).toBe(true);
    expect(Object.isFrozen(ledger.events)).toBe(true);
    expect(Object.isFrozen(ledger.active[0])).toBe(true);
    expect(Object.isFrozen(ledger.events[0])).toBe(true);
    expect(() => (ledger.active as unknown as unknown[]).push({})).toThrow();
    expect(() => (ledger.events[0] as unknown as { cause: string }).cause = 'tampered').toThrow();

    const second = runtime.queries.diagnostics.resourceLedger!();
    expect(reads).toBe(2);
    expect(second).toEqual(ledger);
    expect(source.active[0]?.key).toBe('title');
    expect(source.events[0]?.cause).toBe('title listener failed');
    expect(internals.observableSnapshot()).toEqual(before);
  });
});
