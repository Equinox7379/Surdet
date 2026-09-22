import { Container, Graphics, Text as PText, Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RENDERER_THEME,
  createRendererTheme,
  type RendererThemeOverrides,
} from '../src/theme.js';
import { bindThemeTextProjection, repaintThemeProjection } from '../src/theme-projection.js';
import { DialogueLayer } from '../src/layers/dialogue/dialogue-layer.js';
import { GalleryLayer } from '../src/layers/gallery/gallery-layer.js';
import { MenuLayer } from '../src/layers/menu/menu-layer.js';
import { SystemPanelLayer } from '../src/layers/system-panel/system-panel-layer.js';
import { LoadingLayer } from '../src/loading-layer.js';
import { RenderLifecycle } from '../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../src/services/render-asset-registry.js';

function findText(root: Container, text: string): PText {
  const visit = (node: Container): PText | undefined => {
    if (node instanceof PText && node.text === text) return node;
    for (const child of node.children) {
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const found = visit(root);
  expect(found, `Pixi text ${text} should be visible`).toBeDefined();
  return found as PText;
}

function graphicsColors(graphics: Graphics): number[] {
  return graphics.context.instructions.flatMap((instruction) => {
    if (!('data' in instruction) || typeof instruction.data !== 'object' || instruction.data === null) return [];
    const data = instruction.data as { style?: unknown };
    if (typeof data.style !== 'object' || data.style === null || !('color' in data.style)) return [];
    const color = (data.style as { color?: unknown }).color;
    return typeof color === 'number' ? [color] : [];
  });
}

function findGraphicsWithColor(root: Container, color: number): Graphics {
  const visit = (node: Container): Graphics | undefined => {
    if (node instanceof Graphics && graphicsColors(node).includes(color)) return node;
    for (const child of node.children) {
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const found = visit(root);
  expect(found, `Pixi Graphics with color 0x${color.toString(16)} should be visible`).toBeDefined();
  return found as Graphics;
}

function makeProjectionHarness() {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requestFrame = vi.fn();
  return { root, lifecycle, assets, requestFrame };
}

function customTheme() {
  return createRendererTheme({
    colors: {
      canvas: 0x102030,
      panel: 0x203040,
      surface: 0x304050,
      surfaceStrong: 0x405060,
      line: 0x506070,
      accent: 0x123456,
      accentSoft: 0x234567,
      text: 0x345678,
      textMuted: 0x456789,
      textDisabled: 0x56789a,
      textOnAccent: 0x6789ab,
    },
  });
}

function collisionTheme() {
  return createRendererTheme({
    colors: {
      accent: 0x123456,
      text: 0x123456,
      textMuted: 0x234567,
      textDisabled: 0x234567,
    },
    typography: {
      bodySize: 28,
      uiSize: 28,
    },
  });
}

function secondCollisionTheme() {
  return createRendererTheme({
    colors: {
      accent: 0x345678,
      text: 0x345678,
      textMuted: 0x456789,
      textDisabled: 0x456789,
    },
    typography: {
      bodySize: 32,
      uiSize: 32,
    },
  });
}

describe('RendererTheme', () => {
  it('provides the complete immutable Surdet default token set', () => {
    expect(DEFAULT_RENDERER_THEME).toEqual({
      colors: {
        canvas: 0x11121c,
        scrim: 0x0d0e18,
        panel: 0x202230,
        surface: 0x272a3b,
        surfaceStrong: 0x36394b,
        line: 0xbca78d,
        accent: 0xf1cea3,
        accentSoft: 0xd7c6b7,
        text: 0xfff8ef,
        textMuted: 0xd3ccd0,
        textDisabled: 0x9c95a2,
        textOnAccent: 0x181923,
        danger: 0xf0b8b2,
      },
      opacity: { scrim: 0.68, panel: 0.94, surface: 0.88, line: 0.48, disabled: 0.64 },
      typography: {
        titleSize: 58,
        headingSize: 30,
        bodySize: 28,
        uiSize: 22,
        captionSize: 18,
        titleLetterSpacing: 5,
        uiLetterSpacing: 1,
      },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
      radius: { sm: 2, md: 4, lg: 6 },
    });
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.colors)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.opacity)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.typography)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.spacing)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.radius)).toBe(true);
  });

  it('deep merges overrides without freezing the caller input', () => {
    const overrides: RendererThemeOverrides = {
      colors: { accent: 0x47c8ff },
      opacity: { panel: 0.8 },
      typography: { uiSize: 22 },
      spacing: { md: 18 },
      radius: { lg: 20 },
    };
    const theme = createRendererTheme(overrides);

    expect(theme.colors.accent).toBe(0x47c8ff);
    expect(theme.colors.text).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(theme.opacity.panel).toBe(0.8);
    expect(theme.typography.uiSize).toBe(22);
    expect(theme.spacing.md).toBe(18);
    expect(theme.radius.lg).toBe(20);
    expect(Object.isFrozen(overrides)).toBe(false);
    expect(Object.isFrozen(overrides.colors)).toBe(false);
    expect(Object.isFrozen(theme.colors)).toBe(true);
  });

  it.each([
    ['unknown top-level key', { unknown: 1 }],
    ['unknown color key', { colors: { unknown: 1 } }],
    ['color below zero', { colors: { accent: -1 } }],
    ['color above 24-bit', { colors: { accent: 0x1000000 } }],
    ['color fractional', { colors: { accent: 1.5 } }],
    ['opacity below zero', { opacity: { panel: -0.1 } }],
    ['opacity above one', { opacity: { panel: 1.1 } }],
    ['opacity NaN', { opacity: { panel: Number.NaN } }],
    ['typography Infinity', { typography: { bodySize: Number.POSITIVE_INFINITY } }],
    ['spacing negative', { spacing: { md: -1 } }],
    ['radius non-number', { radius: { sm: 'round' } }],
  ] as const)('rejects %s', (_label, value) => {
    expect(() => createRendererTheme(value as never)).toThrow(/RENDERER_THEME_INVALID/);
  });

  it('does not mutate the default theme while rejecting malformed nested input', () => {
    const before = DEFAULT_RENDERER_THEME.colors.accent;
    const malformed = { colors: { accent: 0x123456 }, opacity: { panel: undefined } };

    expect(() => createRendererTheme(malformed as never)).toThrow(/RENDERER_THEME_INVALID/);
    expect(DEFAULT_RENDERER_THEME.colors.accent).toBe(before);
  });
});

describe('live Pixi player-layer theme projection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repaints an already visible Menu title and accent decoration', () => {
    const { root, lifecycle, assets, requestFrame } = makeProjectionHarness();
    const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle, requestFrame });
    const theme = customTheme();

    layer.showTitle({ title: 'Surdet', items: [{ id: 'start', label: '开始' }] }, vi.fn());
    const title = findText(root, 'Surdet');
    expect(title.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(findGraphicsWithColor(root, DEFAULT_RENDERER_THEME.colors.accent)).toBeDefined();
    const frameCount = requestFrame.mock.calls.length;

    layer.setTheme(theme);

    expect(title.style.fill).toBe(theme.colors.text);
    expect(findGraphicsWithColor(root, theme.colors.accent)).toBeDefined();
    expect(requestFrame).toHaveBeenCalledTimes(frameCount);
    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('restores Menu text and accent to their own defaults after a same-value collision', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    layer.showTitle({ title: 'Surdet', items: [{ id: 'start', label: '开始' }] }, vi.fn());
    const title = findText(root, 'Surdet');

    layer.setTheme(collisionTheme());
    expect(title.style.fill).toBe(0x123456);
    layer.setTheme(DEFAULT_RENDERER_THEME);

    expect(title.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(findGraphicsWithColor(root, DEFAULT_RENDERER_THEME.colors.accent)).toBeDefined();
    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('restores Gallery text and disabled text after same-value collisions', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new GalleryLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      createBackgroundTexture: () => Texture.EMPTY,
    });
    layer.showGallery({
      cgs: [
        { id: 'cg-1', name: '已解锁', unlocked: true },
        { id: 'cg-2', name: '未解锁', unlocked: false },
      ],
      music: [],
      texts: [],
    });
    const unlocked = findText(root, '已解锁');
    const disabled = findText(root, '???');

    layer.setTheme(collisionTheme());
    layer.setTheme(DEFAULT_RENDERER_THEME);

    expect(unlocked.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(disabled.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.textDisabled);
    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('restores Dialogue and SystemPanel text identities after same-value collisions', () => {
    const dialogueHarness = makeProjectionHarness();
    const dialogue = new DialogueLayer({
      uiLayer: dialogueHarness.root,
      width: 1280,
      height: 720,
      assets: dialogueHarness.assets,
      lifecycle: dialogueHarness.lifecycle,
    });
    class FakeCanvasRenderingContext2D {
      font = '';
      letterSpacing = '';
      textLetterSpacing = '';

      measureText(value: string) {
        return { width: value.length * 20, actualBoundingBoxAscent: 16, actualBoundingBoxDescent: 4 };
      }
    }
    vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => new FakeCanvasRenderingContext2D() }) });
    dialogue.mountTextDisplays();
    dialogue.showText('Lynn', 'Collision dialogue');
    const dialogueText = findText(dialogueHarness.root, 'Collision dialogue');
    dialogue.setTheme(collisionTheme());
    dialogue.setTheme(DEFAULT_RENDERER_THEME);
    expect(dialogueText.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);

    const systemHarness = makeProjectionHarness();
    const system = new SystemPanelLayer({
      uiLayer: systemHarness.root,
      width: 1280,
      height: 720,
      assets: systemHarness.assets,
      lifecycle: systemHarness.lifecycle,
    });
    system.showBattle({ turn: 1, actingTeam: 'player', finished: false, winner: null, units: [] }, {
      onAttack: vi.fn(),
      onPass: vi.fn(),
    });
    const heading = findText(systemHarness.root, '回合 1 —— 当前行动：player');
    system.setTheme(collisionTheme());
    system.setTheme(DEFAULT_RENDERER_THEME);
    expect(heading.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);

    dialogue.dispose();
    dialogueHarness.assets.dispose();
    dialogueHarness.lifecycle.dispose();
    system.dispose();
    systemHarness.assets.dispose();
    systemHarness.lifecycle.dispose();
  });

  it('keeps Loading text and progress identities stable under a same-value collision', () => {
    const loading = new LoadingLayer(1280, 720);
    loading.show({ total: 2, completed: 0, failed: 0, done: false, current: 'background' });
    const title = findText(loading.container, '正在加载资源');

    loading.setTheme(collisionTheme());
    loading.setTheme(DEFAULT_RENDERER_THEME);

    expect(title.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(findGraphicsWithColor(loading.container, DEFAULT_RENDERER_THEME.colors.accent)).toBeDefined();
    loading.destroy();
  });

  it('does not infer typography token identity from equal numeric values', () => {
    const root = new Container();
    const text = new PText({ style: { fontSize: DEFAULT_RENDERER_THEME.typography.uiSize, letterSpacing: DEFAULT_RENDERER_THEME.typography.uiLetterSpacing } });
    bindThemeTextProjection(text, { fontSize: 'uiSize', letterSpacing: 'uiLetterSpacing' });
    root.addChild(text);
    const collision = collisionTheme();
    repaintThemeProjection(root, DEFAULT_RENDERER_THEME, collision);
    expect(text.style.fontSize).toBe(collision.typography.uiSize);
    expect(text.style.letterSpacing).toBe(collision.typography.uiLetterSpacing);
    const second = secondCollisionTheme();
    repaintThemeProjection(root, collision, second);
    repaintThemeProjection(root, second, DEFAULT_RENDERER_THEME);
    expect(text.style.fontSize).toBe(DEFAULT_RENDERER_THEME.typography.uiSize);
    expect(text.style.letterSpacing).toBe(DEFAULT_RENDERER_THEME.typography.uiLetterSpacing);
  });

  it('fails closed when a color-bearing object has no semantic or explicit fixed-color binding', () => {
    const root = new Container();
    root.addChild(new PText({ text: 'unbound', style: { fill: 0x123456 } }));
    expect(() => repaintThemeProjection(root, DEFAULT_RENDERER_THEME, collisionTheme()))
      .toThrow(/theme projection binding audit failed/);
  });

  it('binds objects created while a colliding custom theme is active', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    const collision = collisionTheme();
    const second = secondCollisionTheme();
    layer.setTheme(collision);
    layer.showTitle({ title: 'New under collision', items: [{ id: 'start', label: '开始' }] }, vi.fn());
    const title = findText(root, 'New under collision');
    const resources = lifecycle.snapshot();

    layer.setTheme(collision);
    layer.setTheme(collision);
    layer.setTheme(second);
    layer.setTheme(DEFAULT_RENDERER_THEME);

    expect(title.style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(lifecycle.snapshot()).toEqual(resources);
    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('repaints already visible Menu system/settings/save-load objects', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    const theme = customTheme();

    layer.showSystemMenu([{ id: 'settings', label: '设置' }], vi.fn(), vi.fn());
    const systemTitle = findText(root, '菜单');
    layer.setTheme(theme);
    expect(systemTitle.style.fill).toBe(theme.colors.text);
    layer.hideSystemMenu();

    layer.setTheme(DEFAULT_RENDERER_THEME);
    layer.showSettings([{ id: 'textSpeed', label: '文本速度', display: '普通' }], vi.fn(), vi.fn());
    const settingsLabel = findText(root, '文本速度');
    layer.setTheme(theme);
    expect(settingsLabel.style.fill).toBe(theme.colors.text);
    layer.hideSettings();

    layer.setTheme(DEFAULT_RENDERER_THEME);
    layer.showSaveLoad({ mode: 'save', slots: [{ id: 'slot-1', empty: true, label: '空槽位' }] }, vi.fn(), vi.fn());
    const saveLoadLabel = findText(root, '空槽位');
    layer.setTheme(theme);
    expect(saveLoadLabel.style.fill).toBe(theme.colors.text);

    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('repaints already visible Dialogue text, command rail, and backlog', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new DialogueLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    const theme = customTheme();
    class FakeCanvasRenderingContext2D {
      font = '';
      letterSpacing = '';
      textLetterSpacing = '';

      measureText(value: string) {
        return {
          width: value.length * 20,
          actualBoundingBoxAscent: 16,
          actualBoundingBoxDescent: 4,
        };
      }
    }
    vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => new FakeCanvasRenderingContext2D(),
      }),
    });

    layer.mountTextDisplays();
    layer.showText('Lynn', 'Hello dialogue');
    const dialogText = findText(root, 'Hello dialogue');
    layer.setTheme(theme);
    expect(dialogText.style.fill).toBe(theme.colors.text);

    layer.setTheme(DEFAULT_RENDERER_THEME);
    layer.showCommandRail([{ id: 'auto', label: 'AUTO' }], vi.fn());
    const commandText = findText(root, 'AUTO');
    layer.setTheme(theme);
    expect(commandText.style.fill).toBe(theme.colors.textMuted);

    layer.setTheme(DEFAULT_RENDERER_THEME);
    layer.showBacklog([{ speaker: 'Lynn', text: 'Backlog line' }]);
    const backlogText = findText(root, 'Lynn：Backlog line');
    layer.setTheme(theme);
    expect(backlogText.style.fill).toBe(theme.colors.accent);

    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('repaints already visible Gallery labels and content', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new GalleryLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      createBackgroundTexture: () => Texture.EMPTY,
    });
    const theme = customTheme();

    layer.showGallery({
      cgs: [{ id: 'cg-1', name: '夜景', unlocked: true }],
      music: [],
      texts: [],
    });
    const tab = findText(root, 'CG');
    const content = findText(root, '夜景');
    layer.setTheme(theme);
    expect(tab.style.fill).toBe(theme.colors.accent);
    expect(content.style.fill).toBe(theme.colors.text);

    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('repaints an already visible SystemPanel battle object', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new SystemPanelLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    const theme = customTheme();

    layer.showBattle({
      turn: 1,
      actingTeam: 'player',
      finished: false,
      winner: null,
      units: [],
    }, { onAttack: vi.fn(), onPass: vi.fn() });
    const heading = findText(root, '回合 1 —— 当前行动：player');
    layer.setTheme(theme);
    expect(heading.style.fill).toBe(theme.colors.text);

    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('keeps fixed battle HP colors when a previous theme used the same numeric color', () => {
    const { root, lifecycle, assets } = makeProjectionHarness();
    const layer = new SystemPanelLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    const previous = createRendererTheme({ colors: { accent: 0x57c26a } });
    const next = createRendererTheme({ colors: { accent: 0x2244cc } });

    layer.showBattle({
      turn: 1,
      actingTeam: 'player',
      finished: false,
      winner: null,
      units: [{
        uid: 'hero',
        name: '林恩',
        team: 'player',
        hp: 10,
        maxHp: 10,
        hpRatio: 1,
        alive: true,
        skills: [],
        canMove: false,
      }],
    }, { onAttack: vi.fn(), onPass: vi.fn() });
    const fixedHp = findGraphicsWithColor(root, 0x57c26a);

    layer.setTheme(previous);
    layer.setTheme(next);

    expect(graphicsColors(fixedHp)).toContain(0x57c26a);

    layer.dispose();
    assets.dispose();
    lifecycle.dispose();
  });

  it('repaints an already visible Loading overlay without replacing its objects', () => {
    const loading = new LoadingLayer(1280, 720);
    const theme = customTheme();
    loading.show({ total: 2, completed: 0, failed: 0, done: false, current: 'background' });
    const title = findText(loading.container, '正在加载资源');
    const originalTitle = title;
    loading.setTheme(theme);
    expect(title.style.fill).toBe(theme.colors.text);
    expect(findGraphicsWithColor(loading.container, theme.colors.accent)).toBeDefined();
    expect(title).toBe(originalTitle);
    loading.destroy();
  });
});
