import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { Texture } from 'pixi.js';
import { AdvRenderer, Backlog, NULL_AUDIO, PixiStage } from '../../src/index.js';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';
import type { DialogueProjectionPort, WorldProjectionPort } from '../../src/api/renderer-commands.js';

describe('legacy dialogue stage contract', () => {
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

  it('keeps the existing PixiStage dialogue surface callable and repeatable', async () => {
    const stage = new PixiStage();
    const focusSpy = vi.spyOn(stage, 'setPortraitFocus');
    try {
      await stage.registerBackground('hall', Texture.EMPTY);
      await stage.registerPortrait('lynn', 'uniform', 'normal', Texture.WHITE);
      await stage.registerAvatar('avatar-lynn', Texture.WHITE);

      stage.setBackground('hall');
      stage.setPortrait('lynn:uniform', {
        charId: 'lynn', costume: 'uniform', expression: 'normal', pos: 'left',
      });
      const beforeReset = stage.snapshotPresentation() as {
        backgroundKey: string | null;
        portraits: unknown[];
      };
      expect(beforeReset.backgroundKey).toBe('hall');
      expect(beforeReset.portraits).toHaveLength(1);

      stage.setSpeakerProfiles([{ id: 'lynn', name: '凛', avatarKey: 'avatar-lynn' }]);
      stage.setActiveSpeaker('lynn');
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith('lynn');
      focusSpy.mockClear();
      stage.showText('凛', '对白');
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith('lynn');
      focusSpy.mockClear();
      stage.showText(null, '旁白');
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith(null);
      focusSpy.mockClear();
      stage.showText(null, '旁白');
      expect(focusSpy).not.toHaveBeenCalled();
      stage.showChoices([{ index: 3, label: '继续' }]);
      stage.setChoiceHighlight(0);
      stage.hideChoices();
      stage.setAwaiting(true);
      stage.updateContinuePulse(16);
      stage.setAwaiting(false);

      let replayed = '';
      stage.showBacklog(
        [{ speaker: '凛', text: '语音行', voice: 'voice-001' }],
        (voice) => { replayed = voice; },
        '语音',
      );
      stage.scrollBacklog(120);
      stage.hideBacklog();
      expect(replayed).toBe(''); // callback remains owned by the legacy overlay until its row is clicked

      stage.setNvlMode(true);
      stage.appendNvlText('凛', 'NVL 一行');
      expect(stage.nvlLines).toHaveLength(1);
      stage.clearNvlText();
      expect(stage.nvlLines).toHaveLength(0);
      stage.setNvlMode(false);

      stage.showBanner('第一章', 'chapter');
      stage.showBanner('提示', 'tip');
      const railItems = [{ id: 'backlog', label: '记录', active: true }];
      stage.showCommandRail(railItems, () => undefined);
      stage.setCommandRailItems([{ id: 'auto', label: '自动' }]);
      stage.hideCommandRail();
      stage.hideInterface(true);
      stage.hideInterface(false);

      stage.resetSession({ preserveWorld: true });
      const afterReset = stage.snapshotPresentation() as {
        backgroundKey: string | null;
        portraits: unknown[];
      };
      expect(afterReset.backgroundKey).toBe('hall');
      expect(afterReset.portraits).toHaveLength(1);
    } finally {
      stage.destroy();
      stage.destroy();
    }
  });

  it('does not duplicate legacy speaker focus through the RendererFacade fallback', () => {
    const stage = new PixiStage();
    const ports = createPresentationPorts(stage);
    const controller = new PresentationController(ports.commands, ports.queries, NULL_AUDIO, {
      commands: ports.commands,
      queries: ports.queries,
    });
    const facade = new RendererFacade({
      stage,
      controller,
      monitor: new RenderPerformanceMonitor(),
      // Intentionally omit dialogueLayer/dialoguePort to exercise the real legacy fallback.
    });
    const stageSpeaker = vi.spyOn(stage, 'setActiveSpeaker');
    const focusSpy = vi.spyOn(stage, 'setPortraitFocus');

    try {
      facade.commands.dialogue.setActiveSpeaker('lynn');
      expect(stageSpeaker).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith('lynn');

      stageSpeaker.mockClear();
      focusSpy.mockClear();
      facade.commands.dialogue.setActiveSpeaker(null);
      expect(stageSpeaker).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenLastCalledWith(null);
    } finally {
      controller.destroy();
      stage.destroy();
    }
  });

  it('routes v2 speaker focus through an independent World port exactly once and keeps the legacy fallback', () => {
    const stage = new PixiStage();
    const stageFocus = vi.spyOn(stage, 'setPortraitFocus');
    const stageSpeaker = vi.spyOn(stage, 'setActiveSpeaker');
    const ports = createPresentationPorts(stage);
    const controller = new PresentationController(ports.commands, ports.queries, NULL_AUDIO, {
      commands: ports.commands,
      queries: ports.queries,
    });
    let activeSpeakerId: string | null = null;
    let projectionVersion = 0;
    const dialoguePort = {
      get activeSpeakerId() { return activeSpeakerId; },
      get projectionVersion() { return projectionVersion; },
      showText: vi.fn((_speaker: string | null, _value: string) => {
        activeSpeakerId = 'lynn';
        projectionVersion += 1;
      }),
      setActiveSpeaker: vi.fn((characterId: string | null) => {
        activeSpeakerId = characterId;
        projectionVersion += 1;
      }),
    } as unknown as DialogueProjectionPort;
    const worldFocus = vi.fn();
    const worldPort = { setPortraitFocus: worldFocus } as unknown as WorldProjectionPort;
    const facade = new RendererFacade({
      stage,
      controller,
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: dialoguePort,
      worldLayer: worldPort,
    });

    try {
      facade.commands.dialogue.showText('凛', '对白');
      expect(dialoguePort.showText).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenLastCalledWith('lynn');
      expect(stageFocus).not.toHaveBeenCalled();

      worldFocus.mockClear();
      facade.commands.dialogue.setActiveSpeaker(null);
      expect(dialoguePort.setActiveSpeaker).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenCalledTimes(1);
      expect(worldFocus).toHaveBeenLastCalledWith(null);
      expect(stageFocus).not.toHaveBeenCalled();

      const fallback = new RendererFacade({
        stage,
        controller,
        monitor: new RenderPerformanceMonitor(),
      });
      stageFocus.mockClear();
      stageSpeaker.mockClear();
      fallback.commands.dialogue.setActiveSpeaker('lynn');
      expect(stageSpeaker).toHaveBeenCalledTimes(1);
      expect(stageFocus).toHaveBeenCalledTimes(1);
      expect(stageFocus).toHaveBeenLastCalledWith('lynn');
    } finally {
      controller.dispose();
      stage.destroy();
    }
  });

  it('keeps AdvRenderer callback binding and legacy lifecycle behavior', () => {
    const stage = new PixiStage();
    const focusSpy = vi.spyOn(stage, 'setPortraitFocus');
    const bus = new EventBus<CoreEventMap>();
    const selected: number[] = [];
    const backlog = new Backlog();
    const renderer = new AdvRenderer(stage, NULL_AUDIO, {
      backlog,
      onSelect: (index) => selected.push(index),
    });

    renderer.subscribe(bus);
    stage.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
    bus.emit('text', { speaker: '凛', value: '来自 AdvRenderer 的对白' });
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenLastCalledWith('lynn');
    focusSpy.mockClear();
    bus.emit('choice', { options: [{ index: 7, label: '选择' }] });
    stage.onSelect?.(7);
    expect(selected).toEqual([7]);

    expect(renderer.toggleBacklog()).toBe(true);
    stage.onBacklogClose?.();
    expect(renderer.backlogOpen).toBe(false);

    expect(() => {
      renderer.destroy();
      renderer.destroy();
      stage.destroy();
      stage.destroy();
    }).not.toThrow();
  });

  it('keeps cleared dialogue and NVL focus consistent through the legacy adapter', () => {
    const stage = new PixiStage();
    try {
      stage.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
      stage.showText('凛', '普通对白。');
      stage.clearText();
      expect(stage.snapshotPresentation()).toMatchObject({ activeSpeakerId: null });
      stage.setNvlMode(true);
      stage.appendNvlText('凛', '全屏对白。');
      expect(stage.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'lynn' });
      stage.clearNvlText();
      expect(stage.snapshotPresentation()).toMatchObject({ activeSpeakerId: null });
    } finally { stage.destroy(); }
  });
});
