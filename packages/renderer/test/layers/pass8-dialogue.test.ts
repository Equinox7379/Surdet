import { Container, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { createRendererTheme } from '../../src/theme.js';

beforeEach(() => {
  class Context {
    font = '28px sans-serif';
    measureText(text: string) {
      const size = Number.parseFloat(this.font) || 28;
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
  return { root, layer, texts, dispose: () => { layer.dispose(); assets.dispose(); } };
}

describe('Pass 8 active dialogue presentation', () => {
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
      expect(body.y + body.height).toBeLessThanOrEqual(650);
      r.layer.showText('读者', '读音《du yin》的正文。');
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
      const choice = r.root.children[0]!.children[5]!.children[0]!;
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
      expect(nvl.style.fontSize).toBe(32);
      expect(nvl.x).toBeCloseTo(1280 * 0.16, 0);
      expect(r.layer.nvlPresentationEntries).toEqual([{ speaker: '旁白', text: '真实的全屏文字，继续使用原 NVL 模式。' }]);
      r.layer.setNvlMode(false);
      expect(r.layer.debugSnapshot().nvlActive).toBe(false);
    } finally { r.dispose(); }
  });
});
