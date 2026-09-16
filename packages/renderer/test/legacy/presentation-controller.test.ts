import { describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { Texture } from 'pixi.js';
import { Backlog } from '../../src/backlog.js';
import { AdvRenderer } from '../../src/adv-renderer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { WorldLayer } from '../../src/layers/world/world-layer.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { PixiStage } from '../../src/pixi-stage.js';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import type { AdvStage } from '../../src/types.js';

function stageHarness(): AdvStage & {
  texts: string[];
  begins: (string | null)[];
  clears: number;
  highlights: number[];
  choices: { index: number; label: string }[];
  fades: number[];
  hidden: boolean[];
  scrolls: number[];
  backlogShown: number;
  nvlActive: boolean;
  nvlEntries: { speaker: string | null; text: string }[];
  worldBackground: string | null;
  presentationClears: number;
} {
  const stage = {
    texts: [] as string[],
    begins: [] as (string | null)[],
    clears: 0,
    highlights: [] as number[],
    choices: [] as { index: number; label: string }[],
    fades: [] as number[],
    hidden: [] as boolean[],
    scrolls: [] as number[],
    backlogShown: 0,
    nvlActive: false,
    nvlEntries: [] as { speaker: string | null; text: string }[],
    worldBackground: null as string | null,
    presentationClears: 0,
    setPortrait: () => undefined,
    removePortrait: () => undefined,
    showText: (_speaker: string | null, value: string) => { stage.texts.push(value); },
    beginText: (speaker: string | null) => { stage.begins.push(speaker); },
    clearText: () => { stage.clears += 1; },
    showChoices: (options: { index: number; label: string }[]) => { stage.choices = options.map((option) => ({ ...option })); },
    hideChoices: () => { stage.choices = []; },
    setFade: (alpha: number) => { stage.fades.push(alpha); },
    setChoiceHighlight: (position: number) => { stage.highlights.push(position); },
    hideInterface: (hidden: boolean) => { stage.hidden.push(hidden); },
    showBacklog: () => { stage.backlogShown += 1; },
    hideBacklog: () => undefined,
    scrollBacklog: (delta: number) => { stage.scrolls.push(delta); },
    setAwaiting: () => undefined,
    setNvlMode: (on: boolean) => {
      stage.nvlActive = on;
      if (on) stage.nvlEntries = [];
    },
    appendNvlText: (speaker: string | null, text: string) => {
      stage.nvlEntries.push({ speaker, text });
    },
    clearNvlText: () => { stage.nvlEntries = []; },
    setBackground: (key: string | null) => { stage.worldBackground = key; },
    snapshotPresentation: () => ({ background: stage.worldBackground }),
    restorePresentation: (snapshot: unknown) => {
      stage.worldBackground = (snapshot as { background?: string | null } | null)?.background ?? null;
    },
    clearPresentation: () => {
      stage.presentationClears += 1;
      stage.worldBackground = null;
    },
    validatePresentation: (snapshot: unknown) => {
      if (snapshot !== null && typeof snapshot !== 'object') throw new Error('invalid stage');
    },
    updateEffects: () => undefined,
    needsUpdate: () => true,
  } as unknown as AdvStage & {
    texts: string[];
    begins: (string | null)[];
    clears: number;
    highlights: number[];
    choices: { index: number; label: string }[];
    fades: number[];
    hidden: boolean[];
    scrolls: number[];
    backlogShown: number;
    nvlActive: boolean;
    nvlEntries: { speaker: string | null; text: string }[];
    worldBackground: string | null;
    presentationClears: number;
  };
  return stage;
}

function choiceEvent(): CoreEventMap['choice'] {
  return { options: [{ index: 10, label: '左' }, { index: 20, label: '右' }] };
}

function controllerFor(
  stage: AdvStage,
  options: Record<string, unknown> = {},
): PresentationController {
  const ports = createPresentationPorts(stage);
  return new PresentationController(ports.commands, ports.queries, undefined, {
      ...options,
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
    bindStageCallbacks: (handlers) => {
      stage.onSelect = handlers.onSelect;
      stage.onBacklogClose = handlers.onBacklogClose;
      return () => {
        stage.onSelect = null;
        stage.onBacklogClose = null;
      };
    },
  });
}

describe('PresentationController', () => {
  it('state reset clears hidden interface state in both controller and stage', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    controller.toggleHideInterface();
    expect(controller.interfaceHidden).toBe(true);
    bus.emit('stateReset', { reason: 'load' });
    expect(controller.interfaceHidden).toBe(false);
    expect(stage.hidden.at(-1)).toBe(false);
    off(); controller.dispose();
  });
  it('does not replace a restored timeline when starting another on a fresh controller', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    const definition = { version: 1 as const, id: 'running', durationMs: 1000, tracks: [{ kind: 'screen' as const,
      cues: [{ atMs: 0, durationMs: 1000, easing: 'linear' as const, action: 'fade', alpha: 1 }] }] };
    try {
      bus.emit('timeline', { id: 'running', blocking: false, definition });
      const saved = controller.snapshotPresentation() as { timelines: { id: number }[] };
      saved.timelines[0]!.id = 2;
      const second = controllerFor(stageHarness());
      const nextBus = new EventBus<CoreEventMap>();
      const disconnect = second.connect(nextBus);
      try {
        second.restorePresentation(saved);
        nextBus.emit('timeline', { id: 'another', blocking: false, definition: { ...definition, id: 'another' } });
        const restored = second.snapshotPresentation() as { timelines: { id: number }[] };
        expect(restored.timelines).toHaveLength(2);
        expect(new Set(restored.timelines.map(run => run.id)).size).toBe(2);
      } finally { disconnect(); second.dispose(); }
    } finally { off(); controller.dispose(); }
  });
  it('is an independent state machine and does not inherit AdvRenderer', () => {
    expect(Object.getPrototypeOf(PresentationController.prototype)).not.toBe(AdvRenderer.prototype);
  });

  it('keeps AdvRenderer as a pure compatibility delegate', () => {
    const stage = stageHarness();
    const advance = vi.spyOn(PresentationController.prototype, 'advance');
    try {
      const legacy = new AdvRenderer(stage);
      expect(legacy.advance()).toBe(false);
      expect(advance).toHaveBeenCalledTimes(1);
      legacy.destroy();
    } finally {
      advance.mockRestore();
    }
  });

  it('routes choice movement only while choosing and selects the visible choice index', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    bus.emit('choice', choiceEvent());

    expect(controller.status).toBe('choice');
    expect(controller.dispatchInput({ type: 'choice.move', delta: -1 })).toBe(true);
    expect(stage.highlights.at(-1)).toBe(1);
    expect(controller.dispatchInput({ type: 'choice.select', index: 20 })).toBe(true);
    expect(controller.status).toBe('idle');
    expect(controller.dispatchInput({ type: 'choice.move', delta: 1 })).toBe(false);

    off();
    controller.dispose();
  });

  it('does not carry all-text skip across a choice into read-only skip', () => {
    const controller = controllerFor(stageHarness());
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    try {
      controller.toggleSkipAll();
      bus.emit('choice', choiceEvent());
      expect(controller.skipAll).toBe(false);
      controller.toggleSkip();
      bus.emit('text', { speaker: null, value: '未读正文', wasRead: false });
      expect(controller.skipMode).toBe(false);
    } finally { off(); controller.dispose(); }
  });

  it('blocks rollback checkpoint capture while a real FadeTween is active', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    let frameRequests = 0;
    controller.setFrameRequest(() => { frameRequests += 1; });

    bus.emit('instr', { name: 'fadeout', args: ['100'], modifiers: new Map(), pos: { file: 'test', line: 1, col: 1 } });
    const requestsAfterStart = frameRequests;
    const fadesBeforeQuery = [...stage.fades];

    expect(controller.canCaptureRollbackCheckpoint()).toBe(false);
    expect(frameRequests).toBe(requestsAfterStart);
    expect(stage.fades).toEqual(fadesBeforeQuery);

    controller.update(50);
    expect(controller.canCaptureRollbackCheckpoint()).toBe(false);
    expect(stage.fades.at(-1)).toBeCloseTo(0.5, 5);

    controller.update(50);
    expect(controller.canCaptureRollbackCheckpoint()).toBe(true);
    expect(stage.fades.at(-1)).toBeCloseTo(1, 5);

    off();
    controller.dispose();
  });

  it('clears choice projection and transient choice state through the public stateReset event', () => {
    const stage = stageHarness();
    const selected: number[] = [];
    const controller = controllerFor(stage, { onSelect: (index: number) => selected.push(index) });
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);

    try {
      bus.emit('choice', choiceEvent());
      controller.choiceDown();
      expect(controller.status).toBe('choice');
      expect(stage.choices).toEqual([{ index: 10, label: '左' }, { index: 20, label: '右' }]);

      bus.emit('stateReset', { reason: 'load' });
      expect(controller.status).toBe('idle');
      expect(stage.choices).toEqual([]);
      expect(controller.choiceConfirm()).toBe(false);

      bus.emit('text', { speaker: null, value: '恢复后的普通文本' });
      controller.update(10_000);
      expect(controller.status).toBe('awaiting');
      expect(stage.texts.at(-1)).toBe('恢复后的普通文本');

      bus.emit('choice', choiceEvent());
      expect(controller.status).toBe('choice');
      expect(stage.choices).toHaveLength(2);
      expect(controller.selectChoiceAt(1)).toBe(true);
      expect(selected).toEqual([20]);
      expect(stage.choices).toEqual([]);
    } finally {
      off();
      controller.dispose();
    }
  });

  it('accepts a missing presentation payload as neutral state', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    const timeline = {
      version: 1 as const,
      id: 'neutral-state',
      durationMs: 100,
      tracks: [],
    };

    try {
      stage.setNvlMode?.(true);
      stage.appendNvlText?.('凛', '旧页面');
      stage.setBackground('before-load');
      bus.emit('timeline', { id: 'neutral-state', blocking: false, definition: timeline });
      expect(stage.nvlActive).toBe(true);
      expect(stage.nvlEntries).toEqual([{ speaker: '凛', text: '旧页面' }]);
      expect(stage.worldBackground).toBe('before-load');

      expect(() => controller.validatePresentation(null)).not.toThrow();
      controller.restorePresentation(null);

      expect(stage.nvlActive).toBe(false);
      expect(stage.nvlEntries).toEqual([]);
      expect(stage.worldBackground).toBeNull();
      expect(controller.snapshotPresentation()).toMatchObject({ timelines: [] });
    } finally {
      off();
      controller.dispose();
    }
  });

  it('accepts missing presentation in the facade fallback without a controller validator', () => {
    const stage = stageHarness() as unknown as Record<string, unknown>;
    const validateStage = vi.fn(stage.validatePresentation as (snapshot: unknown) => void);
    stage.validatePresentation = validateStage;
    stage.destroy = () => undefined;
    const controller = {
      status: 'idle',
      needsUpdate: false,
      presentationOwnsStage: true,
      dispose: () => undefined,
    };
    const facade = new RendererFacade({
      stage: stage as never,
      controller: controller as never,
      monitor: new RenderPerformanceMonitor(),
    });

    expect(() => facade.commands.presentation.validate(null)).not.toThrow();
    expect(validateStage).toHaveBeenCalledWith(null);
  });

  it('rejects invalid dialogue before changing world, timelines, or the current NVL page', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    const timeline = {
      version: 1 as const,
      id: 'atomic-dialogue',
      durationMs: 100,
      tracks: [],
    };

    try {
      stage.setNvlMode?.(true);
      stage.appendNvlText?.('凛', '保留页面');
      stage.setBackground('keep-world');
      bus.emit('timeline', { id: 'atomic-dialogue', blocking: false, definition: timeline });
      const before = controller.snapshotPresentation();
      const invalid = {
        version: 1,
        stage: (before as { stage: unknown }).stage,
        timelines: [],
        dialogue: { nvlActive: true, nvlEntries: [{ speaker: 42, text: 'bad' }] },
      };

      expect(() => controller.validatePresentation(invalid)).toThrowError(
        expect.objectContaining({ code: 'PRESENTATION_SNAPSHOT_INVALID' }),
      );
      expect(() => controller.restorePresentation(invalid)).toThrowError(
        expect.objectContaining({ code: 'PRESENTATION_SNAPSHOT_INVALID' }),
      );
      expect(stage.worldBackground).toBe('keep-world');
      expect(stage.nvlActive).toBe(true);
      expect(stage.nvlEntries).toEqual([{ speaker: '凛', text: '保留页面' }]);
      expect(controller.snapshotPresentation()).toEqual(before);
    } finally {
      off();
      controller.dispose();
    }
  });

  it('routes advance, backlog, auto, skip, interface, scroll, and escape actions', () => {
    const stage = stageHarness();
    const advanceCalls: number[] = [];
    const controller = controllerFor(stage, {
      backlog: new Backlog(),
      onAdvance: () => advanceCalls.push(1),
    });
    const bus = new EventBus<CoreEventMap>();
    controller.connect(bus);
    bus.emit('text', { speaker: null, value: '下一句' });
    controller.update(10_000);

    expect(controller.status).toBe('awaiting');
    expect(controller.dispatchInput({ type: 'auto.toggle' })).toBe(true);
    expect(controller.dispatchInput({ type: 'skip.toggle', scope: 'all' })).toBe(true);
    expect(controller.dispatchInput({ type: 'interface.toggle' })).toBe(true);
    expect(stage.hidden).toEqual([true]);
    expect(controller.dispatchInput({ type: 'backlog.toggle' })).toBe(true);
    expect(stage.backlogShown).toBe(1);
    expect(controller.dispatchInput({ type: 'backlog.scroll', delta: 120 })).toBe(true);
    expect(stage.scrolls).toEqual([120]);
    controller.focusBacklogSearch();
    controller.appendBacklogSearch('下');
    expect(controller.dispatchInput({ type: 'escape' })).toBe(true);
    expect(controller.dispatchInput({ type: 'advance' })).toBe(true);
    expect(advanceCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('uses explicit begin-line and clear-text commands instead of empty showText for lifecycle boundaries', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage, { typewriter: undefined });
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);

    try {
      bus.emit('text', { speaker: null, value: '第一句中文𠀀🙂' });
      expect(stage.begins).toEqual([null]);
      expect(stage.texts).toEqual([]);

      controller.update(1_000);
      expect(stage.texts.at(-1)).toBe('第一句中文𠀀🙂');
      expect(stage.begins).toHaveLength(1);

      controller.resetSession({ preserveWorld: true });
      expect(stage.clears).toBe(1);
      expect(stage.texts).toEqual(['第一句中文𠀀🙂']);
    } finally {
      off();
      controller.dispose();
    }
  });

  it('connect returns an idempotent unsubscribe and dispose blocks later input', () => {
    const stage = stageHarness();
    const controller = controllerFor(stage);
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    off();
    off();
    bus.emit('text', { speaker: null, value: '不会投影' });
    expect(stage.texts).toEqual([]);

    controller.dispose();
    controller.dispose();
    expect(controller.dispatchInput({ type: 'advance' })).toBe(false);
  });

  it('shares one idempotent lifecycle cleanup path across disconnect, unsubscribe, reconnect, and dispose', () => {
    const stage = stageHarness();
    const lifecycle = new RenderLifecycle();
    const controller = controllerFor(stage, { lifecycle });
    const bus = new EventBus<CoreEventMap>();

    const firstOff = controller.connect(bus);
    expect(lifecycle.snapshot().listeners).toBe(1);
    controller.disconnect();
    expect(lifecycle.snapshot().listeners).toBe(0);
    firstOff();
    expect(lifecycle.snapshot().listeners).toBe(0);

    const secondOff = controller.connect(bus);
    expect(lifecycle.snapshot().listeners).toBe(1);
    const thirdOff = controller.connect(bus);
    expect(lifecycle.snapshot().listeners).toBe(1);
    secondOff();
    expect(lifecycle.snapshot().listeners).toBe(1);
    thirdOff();
    expect(lifecycle.snapshot().listeners).toBe(0);
    controller.connect(bus);
    expect(lifecycle.snapshot().listeners).toBe(1);
    controller.dispose();
    controller.dispose();
    expect(lifecycle.snapshot().listeners).toBe(0);
    lifecycle.dispose();
  });

  it('validates the complete presentation snapshot without changing state', () => {
    const stage = new PixiStage();
    const ports = createPresentationPorts(stage, { worldLayer: stage.worldLayer });
    const controller = new PresentationController(ports.commands, ports.queries, undefined, {
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
    });
    const facade = new RendererFacade({
      stage,
      controller,
      monitor: new RenderPerformanceMonitor(),
      worldLayer: stage.worldLayer,
    });
    const validTimeline = {
      id: 1,
      blocking: false,
      definition: {
        version: 1 as const,
        id: 'validate-complete',
        durationMs: 100,
        tracks: [],
      },
      snapshot: {
        version: 1 as const,
        cursorMs: 0,
      },
    };
    const before = controller.snapshotPresentation();
    const invalidCases: readonly unknown[] = [
      { version: 2, stage: null, timelines: [] },
      { version: 1, stage: null, timelines: 'not-an-array' },
      { version: 1, stage: null, timelines: [{ ...validTimeline, definition: { ...validTimeline.definition, version: 2 } }] },
      { version: 1, stage: null, timelines: [{ ...validTimeline, snapshot: { version: 1, cursorMs: 'not-a-number' } }] },
      {
        version: 1,
        stage: null,
        timelines: [validTimeline, { ...validTimeline, id: 1 }],
      },
      {
        version: 1,
        stage: { ...(before as { stage: Record<string, unknown> }).stage, cameraScale: 99 },
        timelines: [],
      },
    ];

    try {
      expect(() => facade.commands.presentation.validate({
        version: 1,
        stage: null,
        timelines: [],
      })).not.toThrow();
      for (const payload of invalidCases) {
        expect(() => facade.commands.presentation.validate(payload)).toThrowError(
          expect.objectContaining({ code: 'PRESENTATION_SNAPSHOT_INVALID' }),
        );
        expect(controller.snapshotPresentation()).toEqual(before);
      }
    } finally {
      controller.dispose();
      stage.destroy();
    }
  });

  it('fails closed when a direct Controller has no Stage validator instead of skipping nested validation', () => {
    const stage = stageHarness();
    const ports = createPresentationPorts(stage);
    const validateCommand = vi.fn(ports.commands.presentation.validate);
    const commands = {
      ...ports.commands,
      presentation: {
        ...ports.commands.presentation,
        validate: validateCommand,
      },
    };
    const controller = new PresentationController(commands, ports.queries);
    const invalid = {
      version: 1,
      stage: { version: 1, cameraScale: 99 },
      timelines: [],
    };

    try {
      expect(() => controller.validatePresentation(invalid)).toThrowError(
        expect.objectContaining({ code: 'PRESENTATION_SNAPSHOT_INVALID' }),
      );
      expect(validateCommand).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('keeps the existing presentation transaction intact when nested World restore is invalid', async () => {
    const stage = stageHarness();
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const world = new WorldLayer({ width: 1280, height: 720, assets, lifecycle });
    await assets.registerBackground('hall', Texture.EMPTY);
    world.setBackground('hall');

    const ports = createPresentationPorts(stage, { worldLayer: world });
    const controller = new PresentationController(ports.commands, ports.queries, undefined, {
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
      lifecycle,
    });
    const bus = new EventBus<CoreEventMap>();
    const off = controller.connect(bus);
    const definition = {
      version: 1 as const,
      id: 'restore-atomicity',
      durationMs: 1000,
      tracks: [{
        kind: 'audio' as const,
        cues: [{ atMs: 0, durationMs: 1000, easing: 'linear' as const, action: 'bgm', key: 'restore-atomicity' }],
      }],
    };

    try {
      bus.emit('timeline', { id: 'restore-atomicity', blocking: false, definition });
      const before = controller.snapshotPresentation();
      const stageSnapshot = (before as { stage: Record<string, unknown> }).stage;
      const invalid = {
        ...(before as Record<string, unknown>),
        stage: { ...stageSnapshot, cameraScale: 99 },
      };

      expect(() => controller.restorePresentation(invalid)).toThrowError(
        expect.objectContaining({ code: 'PRESENTATION_SNAPSHOT_INVALID' }),
      );
      expect(controller.snapshotPresentation()).toEqual(before);

      controller.restorePresentation(before);
      expect(controller.snapshotPresentation()).toEqual(before);
    } finally {
      off();
      controller.dispose();
      world.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });
});
