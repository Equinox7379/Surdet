import { describe, expect, it } from 'vitest';
import { RenderPerformanceMonitor } from '../../src/performance.js';
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
        visibleChoiceCount: 1,
        rubyBaseCount: 0,
        rubyTextCount: 0,
        backlogVisible: false,
        nvlActive: false,
        nvlLines: [],
      },
      menu: { overlay: { type: 'none' }, titleItemCount: 0, systemMenuItemCount: 0, settingsRowCount: 0, saveLoadSlotCount: 0 },
      gallery: { overlay: { type: 'none' }, cgCount: 0, musicCount: 0, textCount: 0 },
      system: { overlay: { type: 'none' }, battleUnitCount: 0, mapNodeCount: 0, shopItemCount: 0, baseCommandCount: 0 },
      world: { activeSpeakerId: 'lynn', backgroundKey: 'night', particleKind: null },
    }),
    observableSnapshot: () => ({ ...state }),
  };
}

describe('Renderer v2 query purity', () => {
  it('diagnostic, presentation, visual, and preference queries do not mutate state', async () => {
    const internals = pureInternals();
    const runtime = await createRendererRuntimeFromInternals(internals);
    const before = internals.observableSnapshot();

    runtime.queries.diagnostics.resourceSnapshot();
    runtime.queries.diagnostics.performanceSnapshot();
    const projection = runtime.queries.diagnostics.projectionSnapshot();
    const mutableDialogue = projection.dialogue as unknown as { choiceLabels: string[]; dialogText: string };
    mutableDialogue.choiceLabels.push('宿主篡改');
    mutableDialogue.dialogText = '宿主篡改';
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

    expect(internals.observableSnapshot()).toEqual(before);
  });
});
