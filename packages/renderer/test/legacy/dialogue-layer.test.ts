import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { Container, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { Backlog } from '../../src/backlog.js';
import { NULL_AUDIO, type AdvStage, type ChoiceOptionView, type CommandRailItem, type PortraitView, type SpeakerProfile } from '../../src/types.js';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';

class DialogueStageHarness implements AdvStage {
  background: string | null = null;
  portraits = new Map<string, PortraitView>();
  texts: { speaker: string | null; value: string }[] = [];
  begins: (string | null)[] = [];
  clears = 0;
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
  portraitFocusId: string | null = null;
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

  beginText(speaker: string | null): void {
    this.begins.push(speaker);
  }

  clearText(): void {
    this.clears += 1;
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
    // Mirror the legacy PixiStage contract: the old Stage method owns the
    // dialogue-state + world-focus combination when no Dialogue port is injected.
    this.setPortraitFocus(characterId);
  }

  setPortraitFocus(characterId: string | null): void {
    this.portraitFocusId = characterId;
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

beforeEach(() => {
  class FakeCanvasRenderingContext2D {
    font = '';

    measureText(text: string) {
      return {
        width: text.length * 10,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5,
      };
    }
  }
  const context = new FakeCanvasRenderingContext2D();
  vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => context }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function exerciseDialogueLayer(layer: DialogueLayer): void {
  layer.mountTextDisplays();
  layer.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
  layer.showText('凛', '同一句《どういつ》');
  layer.showChoices([{ index: 1, label: '继续' }, { index: 2, label: '返回' }]);
  layer.setChoiceHighlight(1);
  layer.setAwaiting(true);
  layer.updateContinuePulse(16);
  layer.showBacklog([{ speaker: '凛', text: '记录', voice: 'voice-001' }], () => undefined, '记录');
  layer.scrollBacklog(120);
  layer.setNvlMode(true);
  layer.appendNvlText('凛', 'NVL 行');
  layer.setNvlMode(false);
  layer.showBanner('第一章', 'chapter');
  layer.showCommandRail([{ id: 'auto', label: '自动' }], () => undefined);
  layer.hideInterface(true);
  layer.hideInterface(false);
  layer.reset();
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
  it('keeps a new empty line visible until explicit clear/reset', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    const layer = new DialogueLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
    });

    try {
      const dialogueRoot = root.children[0] as Container;
      const panel = dialogueRoot.children[0] as Container;
      const beginText = (layer as unknown as { beginText: (speaker: string | null) => void }).beginText;
      const clearText = (layer as unknown as { clearText: () => void }).clearText;

      beginText.call(layer, null);
      expect(panel.visible).toBe(true);

      layer.showText(null, '第一行逐字更新');
      expect(panel.visible).toBe(true);

      beginText.call(layer, null);
      expect(panel.visible).toBe(true);
      layer.showText(null, '第二行');
      expect(panel.visible).toBe(true);

      clearText.call(layer);
      expect(panel.visible).toBe(false);
      layer.reset();
      expect(panel.visible).toBe(false);

      layer.showCommandRail([{ id: 'menu', label: '菜单' }], () => undefined);
      expect(layer.debugSnapshot().commandRailVisible).toBe(true);
      expect(layer.debugSnapshot().commandRailSuppressed).toBe(false);
      layer.hideCommandRail();
      expect(layer.debugSnapshot().commandRailVisible).toBe(false);
      expect(layer.debugSnapshot().commandRailSuppressed).toBe(true);
      layer.restoreCommandRail();
      expect(layer.debugSnapshot().commandRailVisible).toBe(true);
      expect(layer.debugSnapshot().commandRailSuppressed).toBe(false);
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('does not produce a panel true-false-true transition across ten empty-to-typed lines', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    const layer = new DialogueLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
    });

    try {
      const dialogueRoot = root.children[0] as Container;
      const panel = dialogueRoot.children[0] as Container;
      const beginText = (layer as unknown as { beginText: (speaker: string | null) => void }).beginText;
      const visibility: boolean[] = [];
      for (let index = 0; index < 10; index += 1) {
        beginText.call(layer, null);
        visibility.push(panel.visible);
        layer.showText(null, `连续对话 ${index} 中文𠀀🙂`);
        visibility.push(panel.visible);
      }

      expect(visibility).toHaveLength(20);
      for (let index = 0; index < visibility.length - 2; index += 1) {
        expect(visibility.slice(index, index + 3)).not.toEqual([true, false, true]);
      }
      expect(visibility.every(Boolean)).toBe(true);
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('marks command rail and full-screen backlog pointer handlers as consumed', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    let consumed = 0;
    const selected: string[] = [];
    const layer = new DialogueLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      onPointerConsumed: () => { consumed += 1; },
    });

    try {
      const dialogueRoot = root.children[0] as Container;
      layer.showCommandRail([{ id: 'auto', label: '自动' }], (id) => selected.push(id));
      const commandRail = dialogueRoot.children[6] as Container;
      commandRail.children[1]?.emit('pointerdown', {} as FederatedPointerEvent);
      expect(selected).toEqual(['auto']);
      expect(consumed).toBe(1);

      layer.showBacklog([], undefined);
      const dialogueOverlayRoot = root.children[1] as Container;
      const backlogLayer = dialogueOverlayRoot.children[0] as Container;
      backlogLayer.emit('pointerdown', {} as FederatedPointerEvent);
      expect(consumed).toBe(2);
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('keeps the real Backlog overlay above dialogue text across repeated projection changes', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    const layer = new DialogueLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
    });
    try {
      const contentRoot = root.children[0] as Container;
      const findBacklogRoot = (): Container | undefined => root.children
        .filter((child): child is Container => child instanceof Container)
        .find((candidate) => candidate.children.some((child) => child instanceof Container
          && child.children.some((entry) => entry instanceof PText && String(entry.text).includes('文字记录'))));

      layer.mountTextDisplays();
      layer.showText('凛', '第一句');
      layer.showBacklog([{ speaker: '凛', text: '记录一' }]);
      const firstOverlayRoot = findBacklogRoot();
      expect(firstOverlayRoot).toBeDefined();
      const firstSpeakerText = contentRoot.children.find((child) => child instanceof PText && String(child.text).includes('凛'));
      const firstDialogText = contentRoot.children.find((child) => child instanceof PText && String(child.text).includes('第一句'));
      expect(firstSpeakerText).toBeDefined();
      expect(firstDialogText).toBeDefined();
      expect(root.getChildIndex(firstOverlayRoot!)).toBeGreaterThan(root.getChildIndex(contentRoot));
      expect(layer.debugSnapshot().backlogAboveDialogueText).toBe(true);

      for (let round = 0; round < 3; round += 1) {
        layer.bringTextDisplaysToFront();
        layer.showText('凛', `第二句-${round}`);
        layer.bringTextDisplaysToFront();
        layer.hideBacklog();
        layer.showBacklog([{ speaker: '凛', text: `记录-${round}` }]);
        const overlayRoot = findBacklogRoot();
        expect(overlayRoot).toBeDefined();
        expect(root.getChildIndex(overlayRoot!)).toBeGreaterThan(root.getChildIndex(contentRoot));
        expect(layer.debugSnapshot().backlogAboveDialogueText).toBe(true);
      }

      layer.hideBacklog();
      layer.showBacklog([{ speaker: null, text: '旁白记录' }]);
      expect(layer.debugSnapshot().backlogAboveDialogueText).toBe(true);
      layer.reset();
      layer.reset();
    } finally {
      layer.dispose();
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('owns its display and listener resources across two independent 50-cycle batches', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });

    const runBatch = (): ReturnType<RenderLifecycle['snapshot']> => {
      for (let cycle = 0; cycle < 50; cycle += 1) {
        const root = new Container();
        const layer = new DialogueLayer({
          uiLayer: root,
          width: 1280,
          height: 720,
          assets,
          lifecycle,
        });
        exerciseDialogueLayer(layer);
        layer.dispose();
        expect(root.children).toHaveLength(0);
      }
      return lifecycle.snapshot();
    };

    const first = runBatch();
    const second = runBatch();
    expect(second).toEqual(first);
    expect(second).toMatchObject({
      disposed: false,
      listeners: 0,
      activeTweens: 0,
      activeAsyncTasks: 1,
      pooledObjects: {},
      displayObjectsByOwner: { dialogue: 0 },
    });
    assets.dispose();
    lifecycle.dispose();
  });

  it('coordinates an injected DialogueLayer and World focus exactly once', () => {
    const stage = new DialogueStageHarness();
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const layer = new DialogueLayer({
      uiLayer: new Container(),
      width: 1280,
      height: 720,
      assets,
      lifecycle,
    });
    const ports = createPresentationPorts(stage);
    const controller = new PresentationController(ports.commands, ports.queries, NULL_AUDIO, {
      commands: ports.commands,
      queries: ports.queries,
    });
    const facade = new RendererFacade({
      stage,
      controller,
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: layer,
    });
    const dialogueSetActiveSpeaker = vi.spyOn(layer, 'setActiveSpeaker');
    const worldFocus = vi.spyOn(stage, 'setPortraitFocus');

    try {
      facade.commands.dialogue.setActiveSpeaker('lynn');

      expect(dialogueSetActiveSpeaker).toHaveBeenCalledTimes(1);
      expect(layer.activeSpeakerId).toBe('lynn');
      expect(worldFocus).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenLastCalledWith('lynn');
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('coordinates profile-derived speaker focus once and keeps narration/repeated text idempotent', () => {
    const stage = new DialogueStageHarness();
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const layer = new DialogueLayer({
      uiLayer: new Container(),
      width: 1280,
      height: 720,
      assets,
      lifecycle,
    });
    const ports = createPresentationPorts(stage);
    const controller = new PresentationController(ports.commands, ports.queries, NULL_AUDIO, {
      commands: ports.commands,
      queries: ports.queries,
    });
    const facade = new RendererFacade({
      stage,
      controller,
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: layer,
    });
    const dialogueSetActiveSpeaker = vi.spyOn(layer, 'setActiveSpeaker');
    const worldFocus = vi.spyOn(stage, 'setPortraitFocus');

    try {
      facade.commands.dialogue.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
      facade.commands.dialogue.showText('凛', '第一句');

      expect(dialogueSetActiveSpeaker).toHaveBeenCalledTimes(1);
      expect(layer.activeSpeakerId).toBe('lynn');
      expect(worldFocus).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenLastCalledWith('lynn');
      const versionAfterProfileText = layer.projectionVersion;
      expect(layer.activeSpeakerId).toBe('lynn');
      expect(layer.projectionVersion).toBe(versionAfterProfileText);
      expect(worldFocus).toHaveBeenCalledTimes(1);

      dialogueSetActiveSpeaker.mockClear();
      worldFocus.mockClear();
      facade.commands.dialogue.showText(null, '旁白');

      expect(dialogueSetActiveSpeaker).toHaveBeenCalledTimes(1);
      expect(layer.activeSpeakerId).toBeNull();
      expect(worldFocus).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenLastCalledWith(null);

      dialogueSetActiveSpeaker.mockClear();
      worldFocus.mockClear();
      facade.commands.dialogue.showText('未知说话人', '未知映射');

      expect(dialogueSetActiveSpeaker).toHaveBeenCalledTimes(1);
      expect(layer.activeSpeakerId).toBeNull();
      expect(worldFocus).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenLastCalledWith(null);

      dialogueSetActiveSpeaker.mockClear();
      worldFocus.mockClear();
      facade.commands.dialogue.showText('未知说话人', '未知映射');

      expect(dialogueSetActiveSpeaker).not.toHaveBeenCalled();
      expect(worldFocus).not.toHaveBeenCalled();
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('resolves dialogue speakers by stable ID first or by an unambiguous display name', () => {
    const stage = new DialogueStageHarness();
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const layer = new DialogueLayer({
      uiLayer: new Container(),
      width: 1280,
      height: 720,
      assets,
      lifecycle,
    });
    const ports = createPresentationPorts(stage);
    const controller = new PresentationController(ports.commands, ports.queries, NULL_AUDIO, {
      commands: ports.commands,
      queries: ports.queries,
    });
    const facade = new RendererFacade({
      stage,
      controller,
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: layer,
    });
    const worldFocus = vi.spyOn(stage, 'setPortraitFocus');

    try {
      facade.commands.dialogue.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
      facade.commands.dialogue.showText('lynn', '稳定 ID 台词');
      expect(layer.debugSnapshot()).toMatchObject({
        activeSpeakerId: 'lynn',
        speakerText: '凛',
      });
      expect(worldFocus).toHaveBeenLastCalledWith('lynn');

      facade.commands.dialogue.showText('凛', '唯一显示名台词');
      expect(layer.debugSnapshot()).toMatchObject({
        activeSpeakerId: 'lynn',
        speakerText: '凛',
      });
      expect(worldFocus).toHaveBeenLastCalledWith('lynn');

      facade.commands.dialogue.showText('未知说话人', '未知映射');
      expect(layer.debugSnapshot()).toMatchObject({
        activeSpeakerId: null,
        speakerText: '未知说话人',
      });
      expect(worldFocus).toHaveBeenLastCalledWith(null);

      facade.commands.dialogue.setSpeakerProfiles([
        { id: 'first', name: '同名' },
        { id: 'second', name: '同名' },
      ]);
      facade.commands.dialogue.showText('同名', '同名不得猜测');
      expect(layer.debugSnapshot()).toMatchObject({
        activeSpeakerId: null,
        speakerText: '同名',
      });
      expect(worldFocus).toHaveBeenLastCalledWith(null);

      facade.commands.dialogue.setSpeakerProfiles([
        { id: 'lynn', name: '凛' },
        { id: 'other', name: 'lynn' },
      ]);
      facade.commands.dialogue.showText('lynn', 'ID 与显示名冲突时 ID 优先');
      expect(layer.debugSnapshot()).toMatchObject({
        activeSpeakerId: 'lynn',
        speakerText: '凛',
      });
      expect(worldFocus).toHaveBeenLastCalledWith('lynn');
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

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
    expect(runtime.stage.portraitFocusId).toBe('lynn');
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
