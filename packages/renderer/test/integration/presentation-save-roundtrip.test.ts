import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { EventBus } from '@surdet/core';
import { Interpreter } from '@surdet/core';
import { SceneRegistry } from '@surdet/core';
import { VariableStore } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';

interface IntegrationStage extends Record<string, unknown> {
  readonly text: { speaker: string | null; value: string }[];
  setNvlMode(on: boolean): void;
  appendNvlText(speaker: string | null, text: string): void;
  setBackground(key: string | null): void;
}

interface Harness {
  readonly stage: IntegrationStage;
  readonly dialogue: DialogueLayer;
  readonly controller: PresentationController;
  readonly bus: EventBus<CoreEventMap>;
  readonly interpreter: Interpreter;
  readonly registry: SceneRegistry;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
  dispose(): void;
}

function makeHarness(): Harness {
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const root = new Container();
  const dialogue = new DialogueLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
  });
  const state = {
    background: null as string | null,
    text: [] as { speaker: string | null; value: string }[],
  };
  const stage = {
    text: state.text,
    setBackground: (key: string | null) => { state.background = key; },
    setPortrait: () => undefined,
    removePortrait: () => undefined,
    setFade: () => undefined,
    shake: () => undefined,
    transition: () => false,
    flash: () => undefined,
    zoom: () => undefined,
    wipe: () => undefined,
    movePortrait: () => undefined,
    setTint: () => undefined,
    clearTint: () => undefined,
    startParticles: () => undefined,
    stopParticles: () => undefined,
    applyTimelineFrame: () => undefined,
    setPortraitFocus: () => undefined,
    showText: (speaker: string | null, value: string) => { state.text.push({ speaker, value }); },
    beginText: () => undefined,
    clearText: () => undefined,
    showChoices: () => undefined,
    hideChoices: () => undefined,
    setAwaiting: () => undefined,
    showBacklog: () => undefined,
    hideBacklog: () => undefined,
    setNvlMode: (on: boolean) => dialogue.setNvlMode(on),
    appendNvlText: (speaker: string | null, text: string) => dialogue.appendNvlText(speaker, text),
    clearNvlText: () => dialogue.clearNvlText(),
    showBanner: () => undefined,
    setChoiceHighlight: () => undefined,
    scrollBacklog: () => undefined,
    hideInterface: () => undefined,
    setSpeakerProfiles: () => undefined,
    setActiveSpeaker: () => undefined,
    showCommandRail: () => undefined,
    setCommandRailItems: () => undefined,
    hideCommandRail: () => undefined,
    restoreCommandRail: () => undefined,
    snapshotPresentation: () => ({ background: state.background }),
    restorePresentation: (snapshot: unknown) => {
      state.background = (snapshot as { background?: string | null } | null)?.background ?? null;
    },
    clearPresentation: () => { state.background = null; },
    validatePresentation: () => undefined,
    needsUpdate: () => false,
  } as IntegrationStage;
  const ports = createPresentationPorts(stage as never, { dialogueLayer: dialogue });
  const controller = new PresentationController(ports.commands, ports.queries, undefined, {
    commands: ports.commands,
    queries: ports.queries,
    validateStagePresentation: ports.validateStagePresentation,
  });
  const bus = new EventBus<CoreEventMap>();
  const off = controller.connect(bus);
  const registry = new SceneRegistry();
  const interpreter = new Interpreter(new VariableStore([]), bus, registry);
  interpreter.setPresentationHooks({
    snapshot: () => controller.snapshotPresentation(),
    validate: (payload) => controller.validatePresentation(payload),
    restore: (payload) => controller.restorePresentation(payload),
  });
  registry.register(compileScene(
    '@scene nvl_roundtrip\n@nvl on\n凛：第一页第一行。\n凛：第一页第二行。\n凛：第三行保存后只能出现一次。\n凛：第四行在读档后应该消失。\n@end',
    'nvl_roundtrip.gal',
    'nvl_roundtrip',
  ));

  return {
    stage,
    dialogue,
    controller,
    bus,
    interpreter,
    registry,
    lifecycle,
    assets,
    dispose: () => {
      off();
      controller.dispose();
      dialogue.dispose();
      assets.dispose();
      lifecycle.dispose();
    },
  };
}

function nvlEntries(harness: Harness): { speaker: string | null; text: string }[] {
  return (
    (harness.dialogue as unknown as { nvlPresentationEntries: readonly { speaker: string | null; text: string }[] })
      .nvlPresentationEntries.map((entry) => ({ ...entry }))
  );
}

describe('Renderer presentation save/load integration', () => {
  it('loads an old save without outer presentation into neutral dialogue and replays the current line', () => {
    const harness = makeHarness();
    try {
      harness.interpreter.start('nvl_roundtrip');
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot())) as Record<string, unknown>;
      delete saved.presentation;
      harness.stage.setNvlMode?.(true);
      harness.stage.appendNvlText?.('旧', '残留页面');

      expect(() => harness.interpreter.loadSnapshot(saved as never)).not.toThrow();
      harness.controller.update(10_000);
      expect(harness.dialogue.debugSnapshot().nvlActive).toBe(false);
      expect(nvlEntries(harness)).toEqual([]);
      expect((harness.stage.text as { speaker: string | null; value: string }[]).at(-1)?.value).toBe('第一页第一行。');
    } finally {
      harness.dispose();
    }
  });

  it('roundtrips the visible NVL page without duplicating the current line', () => {
    const harness = makeHarness();
    try {
      harness.interpreter.start('nvl_roundtrip');
      harness.interpreter.advance();
      harness.interpreter.advance();
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot())) as never;
      harness.interpreter.advance();
      expect(nvlEntries(harness).map((entry) => entry.text)).toContain('第四行在读档后应该消失。');

      harness.interpreter.loadSnapshot(saved);
      const restored = nvlEntries(harness).map((entry) => entry.text);
      expect(harness.dialogue.debugSnapshot().nvlActive).toBe(true);
      expect(restored.filter((text) => text === '第一页第一行。')).toHaveLength(1);
      expect(restored.filter((text) => text === '第一页第二行。')).toHaveLength(1);
      expect(restored.filter((text) => text === '第三行保存后只能出现一次。')).toHaveLength(1);
      expect(restored.filter((text) => text === '第四行在读档后应该消失。')).toHaveLength(0);

      harness.interpreter.advance();
      const continued = nvlEntries(harness).map((entry) => entry.text);
      expect(continued.filter((text) => text === '第三行保存后只能出现一次。')).toHaveLength(1);
      expect(continued.filter((text) => text === '第四行在读档后应该消失。')).toHaveLength(1);
    } finally {
      harness.dispose();
    }
  });
});
