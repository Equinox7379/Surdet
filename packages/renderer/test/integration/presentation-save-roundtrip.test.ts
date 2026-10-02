import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { EventBus } from '@surdet/core';
import { Interpreter } from '@surdet/core';
import { SceneRegistry } from '@surdet/core';
import { VariableStore } from '@surdet/core';
import { TimelineRegistry } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';
import { NULL_AUDIO, type AudioHandle } from '../../src/types.js';

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

function makeHarness(audio?: AudioHandle): Harness {
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
  const controller = new PresentationController(ports.commands, ports.queries, audio, {
    commands: ports.commands,
    queries: ports.queries,
    validateStagePresentation: ports.validateStagePresentation,
    onWaitEnd: () => interpreter.finishWait(),
  });
  const bus = new EventBus<CoreEventMap>();
  const off = controller.connect(bus);
  const registry = new SceneRegistry();
  const interpreter = new Interpreter(new VariableStore([]), bus, registry);
  interpreter.setPresentationHooks({
    snapshot: (context) => controller.snapshotPresentation(context),
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
  it.each(['choice', 'wait'] as const)('restores the displayed ADV line without replaying it at a saved %s', kind => {
    const harness = makeHarness();
    let displayed = { speaker: null as string | null, value: '' };
    harness.stage.showText = (speaker: string | null, value: string) => { displayed = { speaker, value }; };
    harness.stage.beginText = (speaker: string | null) => { displayed = { speaker, value: '' }; };
    harness.stage.clearText = () => { displayed = { speaker: null, value: '' }; };
    try {
      const pause = kind === 'choice' ? '@choice\n  海港 -> @end\n  车站 -> @end' : '@wait 100000\n下一行。';
      harness.registry.register(compileScene(`凛：雨停后去哪里？\n${pause}\n@end`, 'adv.gal', 'adv'));
      let textEvents = 0;
      harness.bus.on('text', () => { textEvents++; });
      harness.interpreter.start('adv');
      harness.controller.update(10_000);
      const before = { ...displayed };
      harness.interpreter.advance();
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot())) as never;
      harness.controller.resetSession();
      expect(displayed.value).toBe('');
      harness.interpreter.loadSnapshot(saved);
      expect(displayed).toEqual(before);
      expect(before).toEqual({ speaker: '凛', value: '雨停后去哪里？' });
      expect(textEvents).toBe(1);
      expect(harness.interpreter.status).toBe(kind === 'choice' ? 'awaiting-choice' : 'awaiting-timer');
    } finally { harness.dispose(); }
  });

  it('rejects malformed saved ADV text before changing the live presentation', () => {
    const harness = makeHarness();
    try {
      harness.registry.register(compileScene('凛：选择前。\n@choice\n  继续 -> @end\n@end', 'adv.gal', 'adv'));
      harness.interpreter.start('adv');
      harness.controller.update(10_000);
      harness.interpreter.advance();
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot()));
      for (const advText of [null, [], { speaker: 42, text: '坏身份' }, { speaker: null }, { text: '缺身份' }]) {
        const invalid = structuredClone(saved);
        invalid.presentation.payload.dialogue.advText = advText;
        const { meta: _beforeMeta, ...before } = harness.interpreter.saveSnapshot()!;
        expect(() => harness.interpreter.loadSnapshot(invalid)).toThrow(/ADV text/);
        const { meta: _afterMeta, ...after } = harness.interpreter.saveSnapshot()!;
        expect(after).toEqual(before);
        expect(harness.interpreter.status).toBe('awaiting-choice');
      }
      const old = structuredClone(saved);
      delete old.presentation.payload.dialogue.advText;
      expect(() => harness.interpreter.loadSnapshot(old)).not.toThrow();
      expect(harness.interpreter.status).toBe('awaiting-choice');
    } finally { harness.dispose(); }
  });

  it('restores saved music and ambience through the presentation hook and rejects invalid audio before mutation', () => {
    let playback: { bgm: string | null; ambience: string | null } = { bgm: 'rain', ambience: 'street' };
    const audio: AudioHandle = {
      ...NULL_AUDIO,
      snapshotPlayback: () => ({ ...playback }),
      restorePlayback: snapshot => { playback = { ...snapshot }; },
      stopAll: () => { playback = { bgm: null, ambience: null }; },
    };
    const harness = makeHarness(audio);
    try {
      harness.interpreter.start('nvl_roundtrip');
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot())) as never;
      playback = { bgm: 'later-room', ambience: null };
      harness.interpreter.loadSnapshot(saved);
      expect(playback).toEqual({ bgm: 'rain', ambience: 'street' });
      const invalid = JSON.parse(JSON.stringify(saved));
      invalid.presentation.payload.audio.bgm = 42;
      const { meta: _beforeMeta, ...before } = harness.interpreter.saveSnapshot()!;
      expect(() => harness.interpreter.loadSnapshot(invalid)).toThrow(/audio/);
      const { meta: _afterMeta, ...after } = harness.interpreter.saveSnapshot()!;
      expect(after).toEqual(before);
      expect(playback).toEqual({ bgm: 'rain', ambience: 'street' });
    } finally { harness.dispose(); }
  });

  it('keeps a restored blocking timeline suspended until its completion, without replaying its start', () => {
    const harness = makeHarness();
    try {
      const timelines = new TimelineRegistry();
      timelines.register({ version: 1, id: 'intro', durationMs: 1000, tracks: [{ kind: 'camera', cues: [] }] });
      harness.interpreter.setTimelineCatalog(timelines);
      harness.registry.register(compileScene('@timeline intro @blocking\n时间轴之后。\n@end', 'timeline.gal', 'timeline'));
      let starts = 0;
      const texts: string[] = [];
      harness.bus.on('timeline', () => { starts++; });
      harness.bus.on('text', p => texts.push(p.value));
      harness.interpreter.start('timeline');
      harness.controller.update(350);
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot())) as never;
      harness.interpreter.loadSnapshot(saved);
      expect(harness.interpreter.status).toBe('awaiting-timer');
      expect(texts).toEqual([]);
      expect(starts).toBe(1);
      expect(() => harness.controller.update(651)).not.toThrow();
      expect(harness.interpreter.status).toBe('awaiting-advance');
      expect(texts).toEqual(['时间轴之后。']);
      expect(starts).toBe(1);
    } finally { harness.dispose(); }
  });

  it('retains the last NVL line when the saved instruction is a wait, not text', () => {
    const harness = makeHarness();
    try {
      harness.registry.register(compileScene('@nvl on\n凛：等待前的正文。\n@wait 100000\n凛：下一行。\n@end', 'wait.gal', 'wait'));
      harness.interpreter.start('wait');
      harness.interpreter.advance();
      const before = nvlEntries(harness);
      const saved = JSON.parse(JSON.stringify(harness.interpreter.saveSnapshot())) as never;
      harness.interpreter.loadSnapshot(saved);
      expect(harness.interpreter.status).toBe('awaiting-timer');
      expect(nvlEntries(harness)).toEqual(before);
      expect(before).toEqual([{ speaker: '凛', text: '等待前的正文。' }]);
    } finally { harness.dispose(); }
  });

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
