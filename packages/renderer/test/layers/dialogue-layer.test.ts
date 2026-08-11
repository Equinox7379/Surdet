import { Container, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { CommandRailItem } from '../../src/types.js';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';

interface DialogueRuntime {
  readonly root: Container;
  readonly layer: DialogueLayer;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
  readonly requestFrame: ReturnType<typeof vi.fn>;
}

const railItems: CommandRailItem[] = [
  { id: 'auto', label: '自动', icon: 'A' },
  { id: 'menu', label: '菜单', icon: 'M', enabled: false },
];

function makeRuntime(): DialogueRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requestFrame = vi.fn();
  const layer = new DialogueLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
    requestFrame,
  });
  return { root, layer, lifecycle, assets, requestFrame };
}

function disposeRuntime(runtime: DialogueRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function commandRailRoot(root: Container): Container {
  const dialogueRoot = root.children[0];
  expect(dialogueRoot).toBeInstanceOf(Container);
  const rail = (dialogueRoot as Container).children[6];
  expect(rail).toBeInstanceOf(Container);
  return rail as Container;
}

function alphaSnapshot(layer: DialogueLayer): number {
  return (layer.debugSnapshot() as unknown as { commandRailAlpha: number }).commandRailAlpha;
}

interface BacklogLayoutSnapshot {
  readonly headerY: number;
  readonly viewportTop: number;
  readonly viewportBottom: number;
  readonly scroll: number;
  readonly contentHeight: number;
  readonly hasMask: boolean;
  readonly searchVisible: boolean;
  readonly idleSearchHintVisible: boolean;
}

function backlogLayoutSnapshot(layer: DialogueLayer): BacklogLayoutSnapshot {
  return (layer.debugSnapshot() as unknown as { backlogLayout: BacklogLayoutSnapshot }).backlogLayout;
}

function backlogRoot(root: Container): Container {
  const overlayRoot = root.children[1];
  expect(overlayRoot).toBeInstanceOf(Container);
  const layer = (overlayRoot as Container).children[0];
  expect(layer).toBeInstanceOf(Container);
  return layer as Container;
}

describe('DialogueLayer command rail stability', () => {
  it('keeps the command rail fully visible and idle after show and a long wait', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);

      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);

      runtime.layer.update(5000);

      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.layer.needsUpdate()).toBe(false);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('does not wake a whole-rail tween when items are rebuilt repeatedly', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);
      runtime.requestFrame.mockClear();

      for (let index = 0; index < 20; index += 1) {
        runtime.layer.setCommandRailItems([
          { ...railItems[0]!, label: `自动-${index}` },
          railItems[1]!,
        ]);
      }

      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
      expect(runtime.layer.needsUpdate()).toBe(false);
      expect(runtime.requestFrame).toHaveBeenCalled();
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('limits hover changes to the target row without waking the rail', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);
      const rail = commandRailRoot(runtime.root);
      const row = rail.children[1] as Container;
      const label = row.children[2] as PText;
      expect(label.alpha).toBe(0);

      row.emit('pointerover', {} as FederatedPointerEvent);
      expect(label.alpha).toBe(1);
      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);

      row.emit('pointerout', {} as FederatedPointerEvent);
      expect(label.alpha).toBe(0);
      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('keeps a fixed backlog header and clips long Chinese/emoji entries below it', () => {
    const runtime = makeRuntime();
    try {
      const entries = Array.from({ length: 120 }, (_, index) => ({
        speaker: index % 2 === 0 ? '凛' : null,
        text: `第 ${index} 条记录：雨夜中的长文本🙂𠀀，用于验证正文裁剪。`,
        voice: index % 3 === 0 ? `voice-${index}` : undefined,
      }));
      runtime.layer.showBacklog(entries);

      const first = backlogLayoutSnapshot(runtime.layer);
      expect(first).toMatchObject({
        headerY: 30,
        viewportTop: 76,
        viewportBottom: 684,
        scroll: 0,
        hasMask: true,
        searchVisible: false,
        idleSearchHintVisible: false,
      });
      expect(first.contentHeight).toBeGreaterThan(first.viewportBottom - first.viewportTop);
      const layer = backlogRoot(runtime.root);
      expect(layer.children.some((child) => child instanceof PText && child.text === 'Ctrl+F 搜索')).toBe(false);
      const entriesLayer = layer.children.find((child) => child instanceof Container && child.mask) as Container | undefined;
      expect(entriesLayer?.mask).toBeDefined();

      runtime.layer.scrollBacklog(240);
      const afterScroll = backlogLayoutSnapshot(runtime.layer);
      expect(afterScroll.headerY).toBe(first.headerY);
      expect(afterScroll.scroll).toBeLessThan(0);
      expect(afterScroll.viewportTop).toBe(first.viewportTop);
      expect(afterScroll.viewportBottom).toBe(first.viewportBottom);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('shows only an active query in the backlog header', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showBacklog([{ speaker: '凛', text: '雨声继续🙂' }], undefined, '雨');

      const layout = backlogLayoutSnapshot(runtime.layer);
      expect(layout).toMatchObject({
        headerY: 30,
        viewportTop: 92,
        viewportBottom: 684,
        hasMask: true,
        searchVisible: true,
        idleSearchHintVisible: false,
      });
      const layer = backlogRoot(runtime.root);
      expect(layer.children.some((child) => child instanceof PText && child.text === '搜索：雨')).toBe(true);
      expect(layer.children.some((child) => child instanceof PText && child.text === 'Ctrl+F 搜索')).toBe(false);
    } finally {
      disposeRuntime(runtime);
    }
  });
});
