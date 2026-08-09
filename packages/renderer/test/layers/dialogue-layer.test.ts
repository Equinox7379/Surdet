import { describe, expect, it } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { Backlog } from '../../src/backlog.js';
import { AdvStage, NULL_AUDIO, type ChoiceOptionView, type CommandRailItem, type PortraitView, type SpeakerProfile } from '../../src/types.js';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';

class DialogueStageHarness implements AdvStage {
  background: string | null = null;
  portraits = new Map<string, PortraitView>();
  texts: { speaker: string | null; value: string }[] = [];
  choices: ChoiceOptionView[] = [];
  choiceHighlight = -1;
  awaiting = false;
  pulseDeltas: number[] = [];
  backlogViews: { entries: { speaker: string | null; text: string; voice?: string }[]; query: string }[] = [];
  backlogReplay: ((voice: string) => void) | undefined;
  backlogScrolls: number[] = [];
  nvlMode = false;
  nvlEntries: { speaker: string | null; text: string }[] = [];
  banners: { text: string; variant: 'chapter' | 'tip' }[] = [];
  hidden = false;
  profiles: SpeakerProfile[] = [];
  activeSpeakerId: string | null = null;
  commandRailItems: CommandRailItem[] = [];
  commandRailOnSelect: ((id: string) => void) | null = null;
  commandRailHidden = false;
  resetCount = 0;
  destroyed = 0;
  onSelect: ((index: number) => void) | null = null;
  onBacklogClose: (() => void) | null = null;

  setBackground(key: string | null): void {
    this.background = key;
  }

  setPortrait(key: string, view: PortraitView): void {
    this.portraits.set(key, { ...view });
  }

  removePortrait(key: string): void {
    this.portraits.delete(key);
  }

  showText(speaker: string | null, value: string): void {
    this.texts.push({ speaker, value });
  }

  showChoices(options: ChoiceOptionView[]): void {
    this.choices = options.map((option) => ({ ...option }));
  }

  hideChoices(): void {
    this.choices = [];
  }

  setFade(): void {}

  setAwaiting(awaiting: boolean): void {
    this.awaiting = awaiting;
  }

  updateContinuePulse(deltaMs: number): void {
    this.pulseDeltas.push(deltaMs);
  }

  showBacklog(
    entries: readonly { speaker: string | null; text: string; voice?: string }[],
    onReplayVoice?: (voice: string) => void,
    query = '',
  ): void {
    this.backlogReplay = onReplayVoice;
    this.backlogViews.push({ entries: entries.map((entry) => ({ ...entry })), query });
  }

  hideBacklog(): void {}

  scrollBacklog(delta: number): void {
    this.backlogScrolls.push(delta);
  }

  setNvlMode(on: boolean): void {
    this.nvlMode = on;
  }

  appendNvlText(speaker: string | null, text: string): void {
    this.nvlEntries.push({ speaker, text });
  }

  clearNvlText(): void {
    this.nvlEntries = [];
  }

  showBanner(text: string, variant: 'chapter' | 'tip'): void {
    this.banners.push({ text, variant });
  }

  setChoiceHighlight(position: number): void {
    this.choiceHighlight = position;
  }

  hideInterface(hidden: boolean): void {
    this.hidden = hidden;
  }

  setSpeakerProfiles(profiles: SpeakerProfile[]): void {
    this.profiles = profiles.map((profile) => ({ ...profile }));
  }

  setActiveSpeaker(characterId: string | null): void {
    this.activeSpeakerId = characterId;
  }

  showCommandRail(items: CommandRailItem[], onSelect: (id: string) => void): void {
    this.commandRailItems = items.map((item) => ({ ...item }));
    this.commandRailOnSelect = onSelect;
    this.commandRailHidden = false;
  }

  setCommandRailItems(items: CommandRailItem[]): void {
    this.commandRailItems = items.map((item) => ({ ...item }));
  }

  hideCommandRail(): void {
    this.commandRailHidden = true;
  }

  needsUpdate(): boolean {
    return false;
  }

  resetSession(): void {
    this.resetCount++;
  }

  destroy(): void {
    this.destroyed++;
  }
}

class VoiceProbe {
  played: string[] = [];

  playVoice(source: string): void {
    this.played.push(source);
  }
}

function makeRuntime() {
  const stage = new DialogueStageHarness();
  const ports = createPresentationPorts(stage);
  const backlog = new Backlog();
  const voice = new VoiceProbe();
  const selected: number[] = [];
  const controller = new PresentationController(ports.commands, ports.queries, {
    ...NULL_AUDIO,
    playVoice: (source: string) => voice.playVoice(source),
  }, {
    commands: ports.commands,
    queries: ports.queries,
    backlog,
    onSelect: (index) => selected.push(index),
    bindStageCallbacks: (handlers) => {
      stage.onSelect = handlers.onSelect;
      stage.onBacklogClose = handlers.onBacklogClose;
      return () => {
        stage.onSelect = null;
        stage.onBacklogClose = null;
      };
    },
    updateProjection: (deltaMs) => stage.updateContinuePulse(deltaMs),
    canScrollBacklog: () => true,
    resetProjection: () => stage.resetSession(),
  });
  const facade = new RendererFacade({
    stage,
    controller,
    monitor: new RenderPerformanceMonitor(),
  });
  const bus = new EventBus<CoreEventMap>();
  return { stage, controller, facade, bus, backlog, voice, selected };
}

describe('DialogueLayer v2 projection contract', () => {
  it('keeps text, narration, and repeated text observable through dialogue commands', () => {
    const runtime = makeRuntime();
    runtime.facade.commands.dialogue.showText('凛', '同一句');
    runtime.facade.commands.dialogue.showText(null, '旁白');
    runtime.facade.commands.dialogue.showText(null, '旁白');

    expect(runtime.stage.texts).toEqual([
      { speaker: '凛', value: '同一句' },
      { speaker: null, value: '旁白' },
      { speaker: null, value: '旁白' },
    ]);

    runtime.controller.connect(runtime.bus);
    runtime.bus.emit('text', { speaker: null, value: '事件旁白' });
    runtime.controller.update(1000);
    expect(runtime.stage.texts.at(-1)).toEqual({ speaker: null, value: '事件旁白' });
    runtime.controller.destroy();
  });

  it('preserves choices, highlight, hide, and selection callback semantics', () => {
    const runtime = makeRuntime();
    const options: ChoiceOptionView[] = [
      { index: 4, label: '留下' },
      { index: 9, label: '离开' },
    ];
    runtime.facade.commands.dialogue.showChoices(options);
    options[0]!.label = '外部修改不得回写';
    expect(runtime.stage.choices).toEqual([
      { index: 4, label: '留下' },
      { index: 9, label: '离开' },
    ]);

    runtime.controller.connect(runtime.bus);
    runtime.bus.emit('choice', { options });
    runtime.controller.choiceDown();
    expect(runtime.stage.choiceHighlight).toBe(0);
    expect(runtime.controller.choiceConfirm()).toBe(true);
    expect(runtime.selected).toEqual([4]);
    expect(runtime.stage.choices).toEqual([]);
    runtime.controller.destroy();
  });

  it('keeps awaiting and continue-pulse projection separate from text state', () => {
    const runtime = makeRuntime();
    runtime.facade.commands.dialogue.setAwaiting(true);
    expect(runtime.stage.awaiting).toBe(true);
    runtime.controller.connect(runtime.bus);
    runtime.bus.emit('text', { speaker: '凛', value: '等待脉冲' });
    runtime.controller.update(16);
    expect(runtime.stage.pulseDeltas).toContain(16);
    runtime.facade.commands.dialogue.setAwaiting(false);
    expect(runtime.stage.awaiting).toBe(false);
    runtime.controller.destroy();
  });

  it('keeps backlog entries, search, scroll, voice replay, close callback, and safe queries', () => {
    const runtime = makeRuntime();
    runtime.controller.connect(runtime.bus);
    runtime.bus.emit('instr', {
      name: 'voice',
      args: ['voice-001'],
      modifiers: new Map(),
      pos: { file: 'contract', line: 1, col: 1 },
    });
    runtime.bus.emit('text', { speaker: '凛', value: '第一句' });
    runtime.bus.emit('text', { speaker: null, value: '第二句' });

    expect(runtime.facade.queries.dialogue.backlogEntries().map((entry) => entry.text)).toEqual(['第一句', '第二句']);
    const safeCopy = runtime.facade.queries.dialogue.backlogEntries();
    (safeCopy[0] as { text: string }).text = '外部修改';
    expect(runtime.facade.queries.dialogue.backlogEntries()[0]?.text).toBe('第一句');

    expect(runtime.controller.toggleBacklog()).toBe(true);
    expect(runtime.stage.backlogViews.at(-1)?.entries.map((entry) => entry.text)).toEqual(['第一句', '第二句']);
    expect(runtime.controller.focusBacklogSearch()).toBe(true);
    expect(runtime.controller.appendBacklogSearch('第二')).toBe(true);
    expect(runtime.facade.queries.dialogue.backlogSearchQuery()).toBe('第二');
    expect(runtime.stage.backlogViews.at(-1)?.entries.map((entry) => entry.text)).toEqual(['第二句']);
    expect(runtime.controller.scrollBacklog(120)).toBe(true);
    expect(runtime.stage.backlogScrolls).toEqual([120]);

    expect(runtime.controller.handleBacklogEscape()).toBe(true);
    runtime.stage.onBacklogClose?.();
    expect(runtime.controller.backlogOpen).toBe(false);
    runtime.controller.toggleBacklog();
    const voiceEntry = runtime.stage.backlogViews.at(-1)?.entries.find((entry) => entry.voice);
    expect(voiceEntry?.voice).toBe('voice-001');
    runtime.voice.played = [];
    runtime.stage.backlogReplay?.(voiceEntry!.voice!);
    expect(runtime.voice.played).toEqual(['voice-001']);
    runtime.controller.destroy();
  });

  it('keeps NVL, banner, and command rail projections independently addressable', () => {
    const runtime = makeRuntime();
    runtime.facade.commands.dialogue.setNvlMode(true);
    runtime.facade.commands.dialogue.appendNvlText('凛', '全屏一行');
    runtime.facade.commands.dialogue.appendNvlText(null, '旁白一行');
    expect(runtime.stage.nvlMode).toBe(true);
    expect(runtime.stage.nvlEntries).toEqual([
      { speaker: '凛', text: '全屏一行' },
      { speaker: null, text: '旁白一行' },
    ]);
    runtime.facade.commands.dialogue.clearNvlText();
    expect(runtime.stage.nvlEntries).toEqual([]);
    runtime.facade.commands.dialogue.setNvlMode(false);

    runtime.facade.commands.dialogue.showBanner('第一章', 'chapter');
    runtime.facade.commands.dialogue.showBanner('提示', 'tip');
    expect(runtime.stage.banners).toEqual([
      { text: '第一章', variant: 'chapter' },
      { text: '提示', variant: 'tip' },
    ]);

    const rail: CommandRailItem[] = [{ id: 'backlog', label: '记录', active: true }];
    const selectedRail: string[] = [];
    runtime.facade.commands.dialogue.showCommandRail(rail, (id) => selectedRail.push(id));
    rail[0]!.label = '外部修改不得回写';
    expect(runtime.stage.commandRailItems).toEqual([{ id: 'backlog', label: '记录', active: true }]);
    runtime.stage.commandRailOnSelect?.('backlog');
    expect(selectedRail).toEqual(['backlog']);
    runtime.facade.commands.dialogue.setCommandRailItems([{ id: 'auto', label: '自动', active: false }]);
    expect(runtime.stage.commandRailItems).toEqual([{ id: 'auto', label: '自动', active: false }]);
    runtime.facade.commands.dialogue.hideCommandRail();
    expect(runtime.stage.commandRailHidden).toBe(true);
    runtime.controller.destroy();
  });

  it('hides only the interface, preserves world projection, and forwards speaker profiles', () => {
    const runtime = makeRuntime();
    const portrait: PortraitView = { charId: 'lynn', costume: 'uniform', expression: 'normal', pos: 'left' };
    runtime.facade.commands.world.setBackground('hall');
    runtime.facade.commands.world.setPortrait('lynn:uniform', portrait);
    runtime.facade.commands.dialogue.hideInterface(true);
    expect(runtime.stage.background).toBe('hall');
    expect(runtime.stage.portraits.get('lynn:uniform')).toEqual(portrait);
    expect(runtime.stage.hidden).toBe(true);

    const profiles: SpeakerProfile[] = [{ id: 'lynn', name: '凛', avatarKey: 'avatar-lynn' }];
    runtime.facade.commands.dialogue.setSpeakerProfiles(profiles);
    profiles[0]!.name = '外部修改不得回写';
    runtime.facade.commands.dialogue.setActiveSpeaker('lynn');
    expect(runtime.stage.profiles).toEqual([{ id: 'lynn', name: '凛', avatarKey: 'avatar-lynn' }]);
    expect(runtime.stage.activeSpeakerId).toBe('lynn');
    runtime.facade.commands.dialogue.hideInterface(false);
    expect(runtime.stage.hidden).toBe(false);
    runtime.controller.destroy();
  });

  it('keeps resetSession explicit and repeated controller destruction idempotent', () => {
    const runtime = makeRuntime();
    runtime.facade.resetSession({ preserveWorld: true });
    expect(runtime.stage.resetCount).toBe(1);
    expect(runtime.facade.queries.dialogue.backlogSearchQuery()).toBe('');
    expect(() => {
      runtime.controller.destroy();
      runtime.controller.destroy();
    }).not.toThrow();
    expect(runtime.stage.destroyed).toBe(0);
  });
});
