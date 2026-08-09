import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { Texture } from 'pixi.js';
import { AdvRenderer, Backlog, NULL_AUDIO, PixiStage } from '../../src/index.js';

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
      stage.showText('凛', '对白');
      stage.showText(null, '旁白');
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

  it('keeps AdvRenderer callback binding and legacy lifecycle behavior', () => {
    const stage = new PixiStage();
    const bus = new EventBus<CoreEventMap>();
    const selected: number[] = [];
    const backlog = new Backlog();
    const renderer = new AdvRenderer(stage, NULL_AUDIO, {
      backlog,
      onSelect: (index) => selected.push(index),
    });

    renderer.subscribe(bus);
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
});
