import { Container, Graphics, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererTheme, DEFAULT_RENDERER_THEME } from '../../src/theme.js';
import type { ChoiceOptionView, CommandRailItem } from '../../src/types.js';
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

beforeEach(() => {
  class FakeCanvasRenderingContext2D {
    font = '';
    letterSpacing = '';
    textLetterSpacing = '';

    measureText(text: string) {
      return { width: text.length * 10, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5 };
    }
  }
  vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => new FakeCanvasRenderingContext2D() }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRuntime(height = 720): DialogueRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requestFrame = vi.fn();
  const layer = new DialogueLayer({
    uiLayer: root,
    width: 1280,
    height,
    assets,
    lifecycle,
    requestFrame,
  });
  return { root, layer, lifecycle, assets, requestFrame };
}

it('shows tips above an existing menu without raising dialogue, and resets and disposes them', () => {
  const runtime = makeRuntime();
  const menu = new Container(); runtime.root.addChild(menu);
  try {
    runtime.layer.showBanner('存档列表读取失败，请重试。', 'tip'); runtime.layer.update(500);
    const texts = (node: Container): PText[] => [...(node instanceof PText ? [node] : []), ...node.children.flatMap(texts)];
    const tip = texts(runtime.root).find(text => text.text.includes('存档列表读取失败'))!;
    const topBranch = (node: Container): Container => node.parent === runtime.root ? node : topBranch(node.parent!);
    expect(runtime.root.getChildIndex(topBranch(tip))).toBeGreaterThan(runtime.root.getChildIndex(menu));
    expect(runtime.root.getChildIndex(dialogueRoot(runtime.root))).toBeLessThan(runtime.root.getChildIndex(menu));
    expect(tip.parent!.visible).toBe(true); expect(tip.parent!.alpha).toBe(1);
    runtime.layer.setTheme(createRendererTheme({ colors: { text: 0x123456, surface: 0xabcdef } }));
    expect(runtime.layer.themeProjectionSnapshot().visibleTextFills).toContain(0x123456);
    expect(runtime.layer.themeProjectionSnapshot().visibleGraphicsColors).toContain(0xabcdef);
    runtime.layer.reset(); expect(tip.parent!.visible).toBe(false);
    runtime.layer.showBanner('下一章', 'chapter');
    expect(runtime.root.getChildIndex(topBranch(tip))).toBeLessThan(runtime.root.getChildIndex(menu));
    runtime.layer.showBanner('重试提示', 'tip'); runtime.layer.update(1800);
    expect(tip.parent!.visible).toBe(false);
  } finally { disposeRuntime(runtime); }
  runtime.layer.showBanner('销毁后的提示不应重新挂载', 'tip');
  expect(runtime.root.children).toEqual([menu]);
});

it('advances paused menu feedback without advancing choices or chapter presentation', () => {
  const runtime = makeRuntime();
  try {
    runtime.layer.showChoices([{ index: 0, label: '继续' }, { index: 1, label: '停留' }]);
    const choices = runtime.layer.debugSnapshot().visibleChoiceCount;
    runtime.layer.showBanner('设置保存失败，已保留原设置', 'tip');
    const texts = (node: Container): PText[] => [...(node instanceof PText ? [node] : []), ...node.children.flatMap(texts)];
    const tip = texts(runtime.root).find(text => text.text.includes('设置保存失败'))!;
    expect(tip.parent!.alpha).toBe(0);
    expect(runtime.layer.updateFeedback(300)).toBe(true);
    expect(tip.parent!.alpha).toBe(1);
    expect(runtime.layer.debugSnapshot().visibleChoiceCount).toBe(choices);
    expect(runtime.layer.updateFeedback(1500)).toBe(false);
    expect(tip.parent!.visible).toBe(false);
    runtime.layer.showBanner('暂停中的章节', 'chapter');
    expect(runtime.layer.updateFeedback(1000)).toBe(false);
    expect(tip.parent!.alpha).toBe(0);
    runtime.layer.update(300); expect(tip.parent!.alpha).toBe(1);
  } finally { disposeRuntime(runtime); }
});

function disposeRuntime(runtime: DialogueRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function commandRailRoot(root: Container): Container {
  const dialogueRoot = root.children[0];
  expect(dialogueRoot).toBeInstanceOf(Container);
  const rail = (dialogueRoot as Container).children[7];
  expect(rail).toBeInstanceOf(Container);
  return rail as Container;
}

function dialogueRoot(root: Container): Container {
  const dialogueRoot = root.children[0];
  expect(dialogueRoot).toBeInstanceOf(Container);
  return dialogueRoot as Container;
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

function boundsOverlap(
  left: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  right: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

describe('DialogueLayer visual layout contracts', () => {
  it('renders style runs and explicit ruby, keeps reveal positions fixed, and exposes plain dialogue/choice labels', () => {
    const runtime = makeRuntime();
    const texts = (node: Container): PText[] => [...(node instanceof PText ? [node] : []), ...node.children.flatMap(texts)];
    try {
      runtime.layer.mountTextDisplays();
      const source = '甲<color=#ff0000><size=2>乙丙</size></color><ruby=うみ>海</ruby>《书》';
      runtime.layer.showText(null, source, 2);
      const styled = texts(runtime.root).find(text => text.visible && text.text === '乙')!;
      expect(styled.style.fontSize).toBe(56); expect(styled.style.fill).toBe('#ff0000');
      const position = { x: styled.x, y: styled.y };
      expect(runtime.layer.debugSnapshot().dialogText).toBe('甲乙');
      runtime.layer.showText(null, source);
      const complete = texts(runtime.root).find(text => text.visible && text.text === '乙丙')!;
      expect({ x: complete.x, y: complete.y }).toEqual(position);
      expect(runtime.layer.debugSnapshot().dialogText).toBe('甲乙丙海《书》');
      expect(runtime.layer.debugSnapshot().rubyTextCount).toBe(1);
      runtime.layer.showChoices([{ index: 4, label: '<b><size=2>选择</size></b>' }]);
      expect(runtime.layer.debugSnapshot().choiceLabels).toEqual(['选择']);
      const choiceText = texts(runtime.root).find(text => text.visible && text.text === '选择')!;
      expect(choiceText.style.fontWeight).toBe('700'); expect(choiceText.style.fontSize).toBe(56);
      runtime.layer.reset(); expect(runtime.layer.debugSnapshot().dialogText).toBe('');
    } finally { disposeRuntime(runtime); }
  });

  it('reports unreadable overflow separately from scrollable long text, and suppresses native issues under work UI', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.mountTextDisplays(); runtime.layer.beginText('凛');
      runtime.layer.showText('凛', '<ruby=うみ>' + '海'.repeat(200) + '</ruby>');
      expect(runtime.layer.readingDiagnostics()).toContainEqual(expect.objectContaining({ code: 'TEXT_OVERFLOW', target: 'dialogue' }));
      runtime.layer.showText('凛', '海'.repeat(1500));
      expect(runtime.layer.readingDiagnostics()).toContainEqual(expect.objectContaining({ code: 'TEXT_SCROLL', target: 'dialogue', severity: 'info' }));
      expect(runtime.layer.readingDiagnostics().some(issue => issue.code === 'TEXT_OVERFLOW')).toBe(false);
      runtime.layer.setDeclarativeUiSuppression({ dialogue: true });
      expect(runtime.layer.readingDiagnostics()).toEqual([]);
    } finally { disposeRuntime(runtime); }
  });
  it('keeps the first ruby reading inside the dialogue mask', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.mountTextDisplays();
      runtime.layer.showText('凛', '<ruby=うみ>海</ruby>の向こう。');
      const texts = (node: Container): PText[] => [...(node instanceof PText ? [node] : []), ...node.children.flatMap(texts)];
      const ruby = texts(runtime.root).find(text => text.text === 'うみ')!;
      const mask = ruby.parent!.mask as Graphics;
      expect(ruby.getBounds().minY).toBeGreaterThanOrEqual(mask.context.bounds.minY);
      expect(ruby.getBounds().maxY).toBeLessThanOrEqual(mask.context.bounds.maxY);
    } finally { disposeRuntime(runtime); }
  });

  it('wraps long speaker names within the plate without shrinking the configured font', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.mountTextDisplays();
      const name = 'Long Name '.repeat(24);
      runtime.layer.showText(name, '台词');
      const speaker = dialogueRoot(runtime.root).children.find(child => child instanceof PText && child.text === name) as PText;
      expect(speaker.width).toBeLessThanOrEqual(1082);
      expect(speaker.style.fontSize).toBe(DEFAULT_RENDERER_THEME.typography.uiSize);
      expect(speaker.getBounds().minX).toBeGreaterThanOrEqual(0);
      expect(speaker.getBounds().maxX).toBeLessThanOrEqual(1280);
      runtime.layer.showChoices([{ index: 2, label: '第一项'.repeat(50) }, { index: 4, label: '第二项' }]);
      const choices = dialogueRoot(runtime.root).children[6] as Container;
      expect((choices.mask as Graphics).context.bounds.maxY).toBeLessThan(speaker.getBounds().minY);
    } finally { disposeRuntime(runtime); }
  });

  it('measures NVL with the actual font and retains translated names through size changes', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.setSpeakerProfiles([{ id: 'rin', sourceName: '凛', name: 'Rin' }]);
      runtime.layer.setNvlMode(true);
      runtime.layer.appendNvlText('凛', 'i'.repeat(60));
      expect(runtime.layer.nvlLines[0]!.text).toBe(`Rin：${'i'.repeat(60)}`);
      runtime.layer.setTheme(createRendererTheme({ typography: { bodySize: 40 } }));
      expect(runtime.layer.nvlLines[0]!.text).toContain('Rin：');
      expect(runtime.layer.nvlLines[0]!.text).not.toContain('凛：');
    } finally { disposeRuntime(runtime); }
  });
  it('translates speaker display names without changing identity, including unchanged ADV text and NVL', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.setSpeakerProfiles([{ id: 'rin', name: '凛' }]);
      runtime.layer.showText('凛', 'same');
      runtime.layer.setSpeakerProfiles([{ id: 'rin', sourceName: '凛', name: 'Rin' }, { id: 'other', name: 'Rin' }]);
      runtime.layer.showText('凛', 'same');
      expect(runtime.layer.activeSpeakerId).toBe('rin');
      expect(runtime.layer.debugSnapshot()).toMatchObject({ speakerText: 'Rin' });
      runtime.layer.setNvlMode(true); runtime.layer.appendNvlText('凛', 'paragraph');
      expect(runtime.layer.activeSpeakerId).toBe('rin');
      expect(runtime.layer.nvlLines.map(line => line.text)).toContain('Rin：paragraph');
    } finally { disposeRuntime(runtime); }
  });
  it('centers choice groups around the logical canvas midpoint', () => {
    const runtime = makeRuntime();
    try {
      const onSelect = vi.fn();
      runtime.layer.onSelect = onSelect;
      const cases: readonly ChoiceOptionView[][] = [
        [{ index: 0, label: '单项选择' }],
        [
          { index: 0, label: '双项选择：短' },
          { index: 1, label: '双项选择：较长的中文文本' },
        ],
        [
          { index: 0, label: '三项：左' },
          { index: 1, label: '三项：这是一条明显更长的中文选项，用来验证卡片高度差异' },
          { index: 2, label: '三项：右' },
        ],
      ];

      for (const options of cases) {
        runtime.layer.showChoices(options);
        const bounds = runtime.layer.debugSnapshot().choiceBounds;
        const top = Math.min(...bounds.map((item) => item.y));
        const bottom = Math.max(...bounds.map((item) => item.y + item.height));
        const groupCenterY = (top + bottom) / 2;

        expect(Math.abs(groupCenterY - 720 / 2)).toBeLessThanOrEqual(1);
        expect(bounds.every((item) => item.x >= 0 && item.y >= 0
          && item.x + item.width <= 1280 && item.y + item.height <= 720)).toBe(true);
        expect(bounds.every((item) => Math.abs(item.x + item.width / 2 - 1280 / 2) <= 1)).toBe(true);
        for (let index = 1; index < bounds.length; index += 1) {
          const previous = bounds[index - 1]!;
          const current = bounds[index]!;
          expect(current.y - (previous.y + previous.height)).toBeCloseTo(12, 5);
        }

        const choiceLayer = dialogueRoot(runtime.root).children[6] as Container;
        (choiceLayer.children[0] as Container).emit('pointerdown', {} as FederatedPointerEvent);
        expect(onSelect).toHaveBeenLastCalledWith(options[0]!.index);
        const lifecycle = runtime.lifecycle.snapshot();
        expect(lifecycle.tickerCallbacks).toBe(0);
        expect(lifecycle.listeners).toBe(0);
        expect(lifecycle.activeTweens).toBe(1);
      }
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('remembers awaiting changes while hidden and does not invent a continue indicator', () => {
    const runtime = makeRuntime();
    try {
      const indicator = dialogueRoot(runtime.root).children[4]!;
      runtime.layer.setAwaiting(true);
      runtime.layer.hideInterface(true);
      runtime.layer.setAwaiting(false);
      runtime.layer.hideInterface(false);
      expect(indicator.visible).toBe(false);
      runtime.layer.hideInterface(true);
      runtime.layer.setAwaiting(true);
      runtime.layer.showCommandRail(railItems, () => undefined);
      runtime.layer.layout();
      expect(indicator.visible).toBe(false);
      runtime.layer.hideInterface(false);
      expect(indicator.visible).toBe(true);
      runtime.layer.setNvlMode(true);
      runtime.layer.showCommandRail(railItems, () => undefined);
      runtime.layer.layout();
      expect(indicator.visible).toBe(false);
    } finally { disposeRuntime(runtime); }
  });

  it('keeps the continue indicator clear of the visible command rail', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);
      runtime.layer.setAwaiting(true);
      runtime.layer.updateContinuePulse(0);

      const root = dialogueRoot(runtime.root);
      const indicator = root.children[4];
      const rail = root.children[7];
      expect(indicator).toBeInstanceOf(Container);
      expect(rail).toBeInstanceOf(Container);

      const indicatorBounds = indicator!.getBounds();
      const railBounds = rail!.getBounds();
      expect(boundsOverlap(indicatorBounds, railBounds)).toBe(false);
      expect(railBounds.y - (indicatorBounds.y + indicatorBounds.height)).toBeGreaterThanOrEqual(9);

      const anchoredX = (indicator as Container).x;
      const anchoredY = (indicator as Container).y;
      for (const deltaMs of [16, 16, 16, 16]) {
        runtime.layer.updateContinuePulse(deltaMs);
        expect((indicator as Container).x).toBe(anchoredX);
        expect(Math.abs((indicator as Container).y - anchoredY)).toBeLessThanOrEqual(3);
      }

      const visibleChildCount = rail!.children.length;
      const beforeLifecycle = runtime.lifecycle.snapshot();
      runtime.layer.setCommandRailItems([
        { id: 'auto', label: '自动-更新', icon: 'A' },
        { id: 'menu', label: '菜单', icon: 'M', enabled: false },
      ]);
      runtime.layer.hideCommandRail();
      expect((indicator as Container).visible).toBe(true);
      expect((indicator as Container).x).toBe(1280 - 68);
      expect((indicator as Container).y).toBe(720 - 46);
      runtime.layer.restoreCommandRail();
      expect((indicator as Container).visible).toBe(true);
      expect((indicator as Container).x).toBe(1280 - 68);
      expect(boundsOverlap(indicator!.getBounds(), rail!.getBounds())).toBe(false);
      expect(rail!.children.length).toBe(visibleChildCount);
      const afterLifecycle = runtime.lifecycle.snapshot();
      expect(afterLifecycle.tickerCallbacks).toBe(beforeLifecycle.tickerCallbacks);
      expect(afterLifecycle.listeners).toBe(beforeLifecycle.listeners);
      expect(afterLifecycle.activeTweens).toBe(beforeLifecycle.activeTweens);
      expect(afterLifecycle.displayObjectsByOwner.dialogue).toBe(beforeLifecycle.displayObjectsByOwner.dialogue);

      runtime.layer.setCommandRailItems(Array.from({ length: 60 }, (_, index) => ({
        id: `item-${index}`,
        label: `项${index}`,
      })));
      expect((indicator as Container).visible).toBe(true);
      expect(boundsOverlap(indicator!.getBounds(), rail!.getBounds())).toBe(false);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('uses the white text theme token for the backlog header', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showBacklog(Array.from({ length: 120 }, (_, index) => ({
        speaker: '凛',
        text: `记录内容 ${index}：用于验证标题与正文滚动层级。`,
      })));
      const layer = backlogRoot(runtime.root);
      const header = layer.children.find(
        (child) => child instanceof PText
          && child.text === '文字记录 · Ctrl+F 搜索 · 滚轮翻阅',
      );
      expect(header).toBeInstanceOf(PText);
      expect((header as PText).style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
      expect((header as PText).y).toBe(30);
      expect(runtime.layer.debugSnapshot().backlogAboveDialogueText).toBe(true);
      expect(backlogLayoutSnapshot(runtime.layer)).toMatchObject({
        headerY: 30,
        viewportTop: 76,
        hasMask: true,
      });
      const entriesLayer = layer.children.find((child) => child instanceof Container && child.mask) as Container | undefined;
      expect(entriesLayer?.mask).toBeDefined();

      runtime.layer.scrollBacklog(240);
      expect((header as PText).y).toBe(30);
      expect(backlogLayoutSnapshot(runtime.layer).scroll).toBeLessThan(0);

      const customText = 0xffffff;
      runtime.layer.setTheme(createRendererTheme({ colors: { text: customText } }));
      expect((header as PText).style.fill).toBe(customText);
      runtime.layer.setTheme(DEFAULT_RENDERER_THEME);
      expect((header as PText).style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
    } finally {
      disposeRuntime(runtime);
    }
  });
});

describe('DialogueLayer command rail stability', () => {
  it('projects current command identities and drawn hit regions across rebuild and visibility changes', () => {
    const runtime = makeRuntime();
    const onSelect = vi.fn();
    try {
      runtime.layer.showCommandRail(railItems, onSelect);
      const targets = runtime.layer.debugSnapshot().commandRailTargets;
      expect(targets.map(target => target.id)).toEqual(['auto', 'menu']);
      const rail = commandRailRoot(runtime.root);
      const row = rail.children[1] as Container;
      const hit = row.children[0] as Graphics;
      expect(targets[0]).toMatchObject({ x: row.x + hit.context.bounds.x, y: row.y + hit.context.bounds.y,
        width: hit.context.bounds.width, height: hit.context.bounds.height });
      row.emit('pointerdown', {} as FederatedPointerEvent);
      expect(onSelect).toHaveBeenCalledWith('auto');
      targets[0]!.x = -100;
      expect(runtime.layer.debugSnapshot().commandRailTargets[0]!.x).not.toBe(-100);
      runtime.layer.setCommandRailItems([{ id: 'rollback', label: '回退' }]);
      expect(runtime.layer.debugSnapshot().commandRailTargets.map(target => target.id)).toEqual(['rollback']);
      runtime.layer.hideCommandRail();
      expect(runtime.layer.debugSnapshot().commandRailTargets).toEqual([]);
      runtime.layer.restoreCommandRail();
      expect(runtime.layer.debugSnapshot().commandRailTargets).toHaveLength(1);
    } finally { disposeRuntime(runtime); }
  });

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

  it('keeps command labels readable and limits hover changes to the target row', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);
      const rail = commandRailRoot(runtime.root);
      const row = rail.children[1] as Container;
      const label = row.children.find((child) => child instanceof PText) as PText;
      expect(label.alpha).toBe(1);
      const originalFill = label.style.fill;

      row.emit('pointerover', {} as FederatedPointerEvent);
      expect(label.alpha).toBe(1);
      expect(label.style.fill).not.toBe(originalFill);
      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);

      row.emit('pointerout', {} as FederatedPointerEvent);
      expect(label.alpha).toBe(1);
      expect(label.style.fill).toBe(originalFill);
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

  it('retains clone-safe raw NVL entries and evicts them with visible lines', () => {
    const runtime = makeRuntime(260);
    const nvlEntries = (): { speaker: string | null; text: string }[] => (
      (runtime.layer as unknown as { nvlPresentationEntries: readonly { speaker: string | null; text: string }[] })
        .nvlPresentationEntries.map((entry) => ({ ...entry }))
    );
    try {
      runtime.layer.setNvlMode(true);
      runtime.layer.appendNvlText('凛', '第一页');
      runtime.layer.appendNvlText(null, '第二页');
      const returned = nvlEntries();
      expect(returned).toEqual([
        { speaker: '凛', text: '第一页' },
        { speaker: null, text: '第二页' },
      ]);

      returned[0]!.text = '外部修改';
      returned.push({ speaker: '伪造', text: '不应进入内部' });
      expect(nvlEntries()).toEqual([
        { speaker: '凛', text: '第一页' },
        { speaker: null, text: '第二页' },
      ]);

      runtime.layer.appendNvlText('凛', '第三页');
      expect(nvlEntries()).toEqual([
        { speaker: null, text: '第二页' },
        { speaker: '凛', text: '第三页' },
      ]);
      expect(runtime.layer.debugSnapshot().nvlLines).toHaveLength(2);

      runtime.layer.clearNvlText();
      expect(nvlEntries()).toEqual([]);
      runtime.layer.appendNvlText(null, '旧页');
      runtime.layer.setNvlMode(true);
      expect(nvlEntries()).toEqual([]);
    } finally {
      disposeRuntime(runtime);
    }
  });
});
