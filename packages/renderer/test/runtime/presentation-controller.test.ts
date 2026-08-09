import { describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { Backlog } from '../../src/backlog.js';
import { AdvRenderer } from '../../src/adv-renderer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import type { AdvStage } from '../../src/types.js';

function stageHarness(): AdvStage & {
  texts: string[];
  highlights: number[];
  hidden: boolean[];
  scrolls: number[];
  backlogShown: number;
} {
  const stage = {
    texts: [] as string[],
    highlights: [] as number[],
    hidden: [] as boolean[],
    scrolls: [] as number[],
    backlogShown: 0,
    setBackground: () => undefined,
    setPortrait: () => undefined,
    removePortrait: () => undefined,
    showText: (_speaker: string | null, value: string) => { stage.texts.push(value); },
    showChoices: () => undefined,
    hideChoices: () => undefined,
    setFade: () => undefined,
    setChoiceHighlight: (position: number) => { stage.highlights.push(position); },
    hideInterface: (hidden: boolean) => { stage.hidden.push(hidden); },
    showBacklog: () => { stage.backlogShown += 1; },
    hideBacklog: () => undefined,
    scrollBacklog: (delta: number) => { stage.scrolls.push(delta); },
    setAwaiting: () => undefined,
    updateEffects: () => undefined,
    needsUpdate: () => true,
  } as unknown as AdvStage & {
    texts: string[];
    highlights: number[];
    hidden: boolean[];
    scrolls: number[];
    backlogShown: number;
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
});
