import { Container, Text as PText, Texture, type FederatedPointerEvent } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { createRendererTheme } from '../../src/theme.js';

beforeEach(() => {
  class Context {
    font = '28px sans-serif';
    measureText(text: string) {
      const size = Number(this.font.match(/([\d.]+)px\b/)?.[1] ?? 28);
      return { width: Array.from(text).length * size, actualBoundingBoxAscent: size, actualBoundingBoxDescent: 4 };
    }
  }
  vi.stubGlobal('CanvasRenderingContext2D', Context);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => new Context() }) });
});
afterEach(() => vi.unstubAllGlobals());

function make() {
  const root = new Container();
  const assets = new RenderAssetRegistry();
  const layer = new DialogueLayer({ uiLayer: root, width: 1280, height: 720, assets });
  layer.mountTextDisplays();
  const texts = (): PText[] => {
    const visit = (node: Container): PText[] => [ ...(node instanceof PText ? [node] : []), ...node.children.flatMap(visit) ];
    return visit(root);
  };
  return { root, layer, assets, texts, dispose: () => { layer.dispose(); assets.dispose(); } };
}

describe('Pass 8 active dialogue presentation', () => {
  it('keeps NVL reading behind choices and the command rail, with Backlog above all dialogue content', () => {
    const r = make();
    try {
      const contentRoot = r.root.children[0]!;
      const directLayer = (node: Container): Container => {
        while (node.parent && node.parent !== contentRoot) node = node.parent;
        return node;
      };
      r.layer.setNvlMode(true); r.layer.appendNvlText(null, '全屏正文');
      r.layer.showChoices([{ index: 0, label: '鼠标选项' }]);
      r.layer.showCommandRail([{ id: 'menu', label: '菜单控件' }], () => {});
      const reading = directLayer(r.layer.nvlLines[0]!);
      const choices = directLayer(r.texts().find(text => text.text === '鼠标选项')!);
      const controls = directLayer(r.texts().find(text => text.text === '菜单控件')!);
      expect(contentRoot.getChildIndex(choices)).toBeGreaterThan(contentRoot.getChildIndex(reading));
      expect(contentRoot.getChildIndex(controls)).toBeGreaterThan(contentRoot.getChildIndex(reading));
      expect(reading.eventMode).toBe('static'); // Reading still owns its wheel input.
      r.layer.showBacklog([{ speaker: null, text: '文字记录' }]);
      expect(r.layer.debugSnapshot().backlogAboveDialogueText).toBe(true);
      r.layer.hideInterface(true);
      expect(contentRoot.visible).toBe(false);
      expect(r.layer.debugSnapshot().backlogVisible).toBe(true);
    } finally { r.dispose(); }
  });
  it('hides choice and NVL descendants together, preserving them for restore and resetting visibility for a new session', () => {
    const r = make();
    const visiblyMounted = (node: Container): boolean => {
      for (let current: Container | null = node; current; current = current.parent) if (!current.visible) return false;
      return true;
    };
    try {
      r.layer.setNvlMode(true);
      r.layer.appendNvlText(null, '隐藏时保留的全屏正文');
      r.layer.showChoices([{ index: 7, label: '不能暗中选择' }]);
      r.layer.update(1000);
      const nvl = r.layer.nvlLines[0]!;
      const choice = r.texts().find(text => text.text === '不能暗中选择')!;
      expect(visiblyMounted(nvl)).toBe(true);
      expect(visiblyMounted(choice)).toBe(true);
      r.layer.hideInterface(true);
      expect(visiblyMounted(nvl)).toBe(false);
      expect(visiblyMounted(choice)).toBe(false);
      expect(r.layer.debugSnapshot().visibleChoiceCount).toBe(0);
      r.layer.hideInterface(false);
      expect(visiblyMounted(nvl)).toBe(true);
      expect(visiblyMounted(choice)).toBe(true);
      expect(r.layer.nvlLines[0]).toBe(nvl);
      expect(r.layer.debugSnapshot().panelVisible).toBe(false);
      r.layer.hideInterface(true);
      r.layer.reset();
      r.layer.showText(null, '新会话可见');
      expect(visiblyMounted(r.texts().find(text => text.text === '新会话可见')!)).toBe(true);
    } finally { r.dispose(); }
  });

  it('centers short and long speaker names inside the nameplate', () => {
    const r = make();
    try {
      for (const name of ['林汀', '这是一位名字比较长的人物']) {
        r.layer.showText(name, '姓名牌中的名字应居中。');
        const nameText = r.texts().find((text) => text.text === name)!;
        const plate = r.root.children[0]!.children[2]!.getBounds();
        const text = nameText.getBounds();
        expect(text.x + text.width / 2).toBeCloseTo(plate.x + plate.width / 2, 1);
        expect(text.y + text.height / 2).toBeCloseTo(plate.y + plate.height / 2, 1);
      }
    } finally { r.dispose(); }
  });

  it('reflows around a late avatar without exposing hidden dialogue or changing its content', () => {
    const r = make();
    try {
      const resolve = vi.spyOn(r.assets, 'resolveAvatar').mockReturnValue(null);
      r.layer.setSpeakerProfiles([{ id: 'lynn', name: '林汀', avatarKey: 'lynn' }]);
      const source = '有头像时应当为正文保留空间。'.repeat(8);
      r.layer.showText('林汀', source);
      const body = r.texts().find((text) => text.text.startsWith('有头像'))!;
      const withoutAvatarX = body.x;
      r.layer.hideInterface(true);
      resolve.mockReturnValue(Texture.EMPTY);
      r.layer.refreshSpeakerAvatar();
      expect(body.visible).toBe(false);
      r.layer.hideInterface(false);
      const avatar = r.root.children[0]!.children[1]!;
      expect(avatar.visible).toBe(true);
      expect(body.x).toBeGreaterThan(avatar.getBounds().right);
      expect(body.x).toBeGreaterThan(withoutAvatarX);
      expect(body.text.replaceAll('\n', '')).toBe(source);
      r.layer.showText(null, source);
      expect(avatar.visible).toBe(false);
      expect(body.x).toBe(withoutAvatarX);
    } finally { r.dispose(); }
  });

  it('never paints the NVL clipping rectangle before, between, or after NVL paragraphs', () => {
    const r = make();
    try {
      const mask = r.root.children[0]!.children[11]!;
      expect(mask.includeInBuild).toBe(false);
      r.layer.setNvlMode(true);
      r.layer.appendNvlText(null, '全屏正文');
      expect(r.layer.nvlLines[0]!.parent!.mask).toBe(mask);
      r.layer.clearNvlText();
      expect(mask.includeInBuild).toBe(false);
      r.layer.setNvlMode(false);
      expect(mask.includeInBuild).toBe(false);
    } finally { r.dispose(); }
  });

  it('keeps oversized ADV paragraphs readable by scrolling without changing the presented text', () => {
    const r = make();
    try {
      r.layer.showText(null, '长篇中文。'.repeat(120));
      const body = r.texts().find((text) => text.text.startsWith('长篇'))!;
      const content = r.layer.debugSnapshot().dialogText;
      expect(body.mask).toBeTruthy();
      const start = body.y;
      body.emit('wheel', { deltaY: 10000, stopPropagation: () => undefined } as never);
      expect(body.y).toBeLessThan(start);
      expect(body.y + body.height).toBeLessThanOrEqual(652);
      expect(r.layer.debugSnapshot().dialogText).toBe(content);
      body.emit('wheel', { deltaY: -10000, stopPropagation: () => undefined } as never);
      expect(body.y).toBe(start);
    } finally { r.dispose(); }
  });

  it('reflows long Chinese and ruby with the project body size while reserving the command rail', () => {
    const r = make();
    try {
      r.layer.setTheme(createRendererTheme({ typography: { bodySize: 36 } }));
      r.layer.showText('读者', '这是一段需要完整阅读的中文，标点和换行都应保留。'.repeat(5));
      const body = r.texts().find((text) => text.text.startsWith('这是一段'))!;
      expect(body.style.fontSize).toBe(36);
      expect(body.y).toBeGreaterThanOrEqual(40);
      expect(body.mask).toBeTruthy();
      const content = body.text;
      body.emit('wheel', { deltaY: 10000, stopPropagation: () => undefined } as never);
      expect(body.y + body.height).toBeLessThanOrEqual(650);
      expect(body.text).toBe(content);
      r.layer.showText('读者', '<ruby=duyin>读音</ruby>的正文。');
      const rubyBase = r.texts().find((text) => text.visible && text.text === '读音');
      expect(rubyBase).toBeDefined();
      expect(rubyBase!.style.fontSize).toBe(36);
    } finally { r.dispose(); }
  });

  it('uses one bounded choice column and dispatches the selected original index only once', () => {
    const r = make();
    try {
      const select = vi.fn(); r.layer.onSelect = select;
      r.layer.showChoices([{ index: 3, label: '短选项' }, { index: 7, label: '一个较长的选项，需要与短选项对齐，并且不能超出画面。'.repeat(3) }]);
      const bounds = r.layer.debugSnapshot().choiceBounds;
      expect(bounds[0]!.width).toBeCloseTo(bounds[1]!.width, 1);
      expect(bounds.every((bound) => bound.width <= 900 && bound.x >= 40)).toBe(true);
      const choice = r.texts().find(text => text.text === '短选项')!.parent!;
      expect(choice.hitArea).toBeTruthy();
      choice.emit('pointerdown', {} as FederatedPointerEvent);
      choice.emit('pointerdown', {} as FederatedPointerEvent);
      expect(select.mock.calls).toEqual([[3]]);
    } finally { r.dispose(); }
  });

  it('uses a centered NVL reading column and retains the original presentation entries', () => {
    const r = make();
    try {
      r.layer.setTheme(createRendererTheme({ typography: { bodySize: 32 } }));
      r.layer.setNvlMode(true);
      r.layer.appendNvlText('旁白', '真实的全屏文字，继续使用原 NVL 模式。');
      const nvl = r.layer.nvlLines[0]!;
      expect(nvl).toBeInstanceOf(PText);
      expect((nvl as PText).style.fontSize).toBe(32);
      expect(nvl.x).toBeCloseTo(1280 * 0.16, 0);
      expect(r.layer.nvlPresentationEntries).toEqual([{ speaker: '旁白', text: '真实的全屏文字，继续使用原 NVL 模式。' }]);
      r.layer.setNvlMode(false);
      expect(r.layer.debugSnapshot().nvlActive).toBe(false);
    } finally { r.dispose(); }
  });
});
