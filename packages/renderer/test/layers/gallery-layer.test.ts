import { Container, Graphics, Rectangle, Sprite, Text as PText, Texture, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { DialogueProjectionPort, MenuProjectionPort } from '../../src/api/renderer-commands.js';
import { RendererFacade, type RendererControllerPort, type RendererStagePort } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { GalleryLayer } from '../../src/layers/gallery/gallery-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { DEFAULT_RENDERER_THEME, createRendererTheme } from '../../src/theme.js';
import type { GalleryItemView } from '../../src/gallery.js';

const pointerEvent = {} as FederatedPointerEvent;

interface GalleryRuntime {
  readonly root: Container;
  readonly layer: GalleryLayer;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
  readonly requestFrame: ReturnType<typeof vi.fn>;
}

function makeGalleryRuntime(): GalleryRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requestFrame = vi.fn();
  const layer = new GalleryLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
    createBackgroundTexture: () => new Texture(),
    requestFrame,
  });
  return { root, layer, lifecycle, assets, requestFrame };
}

function disposeGalleryRuntime(runtime: GalleryRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function findText(root: Container, value: string): PText {
  const visit = (container: Container): PText | undefined => {
    for (const child of container.children) {
      if (child instanceof PText && child.text === value) return child;
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const found = visit(root);
  expect(found, `text ${value} should be projected`).toBeDefined();
  return found as PText;
}

function findParentWithText(root: Container, value: string): Container {
  const visit = (container: Container): Container | undefined => {
    if (container.children.some((child) => child instanceof PText && child.text === value)) return container;
    for (const child of container.children) {
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const parent = visit(root);
  expect(parent, `container containing ${value} should be projected`).toBeDefined();
  return parent as Container;
}

function findGraphicsWithColor(root: Container, color: number): Graphics {
  const colors = (graphics: Graphics): number[] => graphics.context.instructions.flatMap((instruction) => {
    if (!('data' in instruction) || typeof instruction.data !== 'object' || instruction.data === null) return [];
    const data = instruction.data as { style?: unknown };
    if (typeof data.style !== 'object' || data.style === null || !('color' in data.style)) return [];
    const value = (data.style as { color?: unknown }).color;
    return typeof value === 'number' ? [value] : [];
  });
  const visit = (node: Container): Graphics | undefined => {
    if (node instanceof Graphics && colors(node).includes(color)) return node;
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

function collisionTheme(color: number) {
  return createRendererTheme({
    colors: {
      canvas: color,
      panel: color,
      surface: color,
      surfaceStrong: color,
      line: color,
      accent: color,
      accentSoft: color,
      text: color,
      textMuted: color,
      textDisabled: color,
      textOnAccent: color,
    },
  });
}

function exerciseGalleryLayer(layer: GalleryLayer): void {
  layer.showGallery({
    cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' }],
    music: [{ id: 'music-1', name: '主题曲', unlocked: true, src: 'theme.mp3' }],
    texts: [{ id: 'text-1', name: '第一夜', unlocked: true, scene: 'prologue', label: 'start' }],
  });
  layer.hideGallery();
  layer.reset();
}

function makeController(): RendererControllerPort {
  return {
    status: 'idle',
    autoPlay: false,
    skipMode: false,
    skipAll: false,
    backlogOpen: false,
    interfaceHidden: false,
    needsUpdate: false,
    update: () => undefined,
    setFrameRequest: () => undefined,
    connect: () => () => undefined,
    disconnect: () => undefined,
    reset: () => undefined,
    advance: () => false,
    select: () => false,
    dispatchInput: () => false,
    setTextSpeed: () => undefined,
    setAutoWait: () => undefined,
    dispose: () => undefined,
    snapshotPresentation: () => null,
  } as unknown as RendererControllerPort;
}

describe('GalleryLayer direct contract', () => {
  it('preserves every real Gallery text and Graphics token through strong collisions', () => {
    const runtime = makeGalleryRuntime();
    const collision = collisionTheme(0x123456);
    const secondCollision = collisionTheme(0x345678);

    const cycleTheme = (): void => {
      const before = runtime.lifecycle.snapshot();
      runtime.layer.setTheme(collision);
      runtime.layer.setTheme(secondCollision);
      runtime.layer.setTheme(secondCollision);
      runtime.layer.setTheme(DEFAULT_RENDERER_THEME);
      expect(runtime.lifecycle.snapshot()).toEqual(before);
    };

    try {
      runtime.layer.showGallery({
        cgs: [
          { id: 'cg-unlocked', name: '夜景', unlocked: true, src: 'cg-unlocked' },
          { id: 'cg-locked', name: '未解锁 CG', unlocked: false, src: 'cg-locked' },
        ],
        music: [
          { id: 'music-unlocked', name: '主题曲', unlocked: true, src: 'theme.mp3' },
          { id: 'music-locked', name: '终章', unlocked: false, src: 'ending.mp3' },
        ],
        texts: [
          { id: 'text-unlocked', name: '第一夜', unlocked: true, scene: 'prologue', label: 'start' },
          { id: 'text-locked', name: '终夜', unlocked: false, scene: 'ending' },
        ],
      });
      cycleTheme();
      expect(findText(runtime.root, '夜景').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
      expect(findText(runtime.root, '???').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.textDisabled);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.panel);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.surfaceStrong);

      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findParentWithText(runtime.root, '♪  主题曲').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.text }),
      });
      expect(findParentWithText(runtime.root, '?  ???').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.textDisabled }),
      });
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.panel);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.surfaceStrong);

      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findParentWithText(runtime.root, '❐  第一夜').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.text }),
      });
      expect(findParentWithText(runtime.root, '?  ???').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.textDisabled }),
      });
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.panel);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.surfaceStrong);

      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findText(runtime.root, '暂无音乐条目（gallery.json 未配置）').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.textMuted);

      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findText(runtime.root, '暂无文本回想条目（gallery.json 未配置 texts）').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.textMuted);

      runtime.layer.showGallery({ cgs: [{ id: 'cg-viewer', name: 'viewer', unlocked: true, src: 'cg-viewer' }], music: [], texts: [] });
      findParentWithText(runtime.root, 'viewer').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findText(runtime.root, '点击任意处返回列表').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.text);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.panel);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('projects CG, music, and text tabs from already-filtered view models', () => {
    const runtime = makeGalleryRuntime();
    const onPlayMusic = vi.fn();
    const onReplayText = vi.fn();
    const onClose = vi.fn();
    const textItem: GalleryItemView = {
      id: 'text-1',
      name: '第一夜',
      unlocked: true,
      scene: 'prologue',
      label: 'start',
    };
    try {
      runtime.layer.showGallery({
        cgs: [
          { id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' },
          { id: 'cg-locked', name: '告别', unlocked: false, src: 'cg-locked' },
        ],
        music: [
          { id: 'music-1', name: '主题曲', unlocked: true, src: 'theme.mp3' },
          { id: 'music-locked', name: '终章', unlocked: false, src: 'ending.mp3' },
        ],
        texts: [textItem, { id: 'text-locked', name: '终夜', unlocked: false, scene: 'ending' }],
        onPlayMusic,
        onReplayText,
        onClose,
      });

      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });
      expect(findText(runtime.root, '初遇').text).toBe('初遇');
      expect(findText(runtime.root, '???').text).toBe('???');

      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'music', mode: 'grid', viewerKey: null });
      findParentWithText(runtime.root, '♪  主题曲').emit('pointerdown', pointerEvent);
      expect(onPlayMusic).toHaveBeenCalledOnce();
      expect(onPlayMusic).toHaveBeenCalledWith('music-1', 'theme.mp3');
      findParentWithText(runtime.root, '?  ???').emit('pointerdown', pointerEvent);
      expect(onPlayMusic).toHaveBeenCalledOnce();

      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'text', mode: 'grid', viewerKey: null });
      findParentWithText(runtime.root, '❐  第一夜').emit('pointerdown', pointerEvent);
      expect(onReplayText).toHaveBeenCalledOnce();
      expect(onReplayText).toHaveBeenCalledWith(textItem);

      findText(runtime.root, '✕ 关闭').emit('pointerdown', pointerEvent);
      expect(onClose).toHaveBeenCalledOnce();
      expect(runtime.layer.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('requests a frame for every visible tab rebuild after the initial projection', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' }],
        music: [{ id: 'music-1', name: '主题曲', unlocked: true, src: 'theme.mp3' }],
        texts: [{ id: 'text-1', name: '第一夜', unlocked: true, scene: 'prologue', label: 'start' }],
      });
      runtime.requestFrame.mockClear();

      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ type: 'gallery', tab: 'music', mode: 'grid' });
      expect(findText(runtime.root, '♪  主题曲').text).toBe('♪  主题曲');
      expect(runtime.requestFrame).toHaveBeenCalled();

      runtime.requestFrame.mockClear();
      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ type: 'gallery', tab: 'text', mode: 'grid' });
      expect(findText(runtime.root, '❐  第一夜').text).toBe('❐  第一夜');
      expect(runtime.requestFrame).toHaveBeenCalled();

      runtime.requestFrame.mockClear();
      findText(runtime.root, 'CG').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ type: 'gallery', tab: 'cg', mode: 'grid' });
      expect(findText(runtime.root, '初遇').text).toBe('初遇');
      expect(runtime.requestFrame).toHaveBeenCalled();
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('requests a frame when the CG viewer returns to the gallery list', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-asset' }],
        music: [],
        texts: [],
      });
      runtime.requestFrame.mockClear();

      findParentWithText(runtime.root, '初遇').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ type: 'gallery', tab: 'cg', mode: 'viewer', viewerKey: 'cg-asset' });
      expect(findText(runtime.root, '点击任意处返回列表').text).toBe('点击任意处返回列表');

      runtime.requestFrame.mockClear();
      findParentWithText(runtime.root, '点击任意处返回列表').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });
      expect(findText(runtime.root, '初遇').text).toBe('初遇');
      expect(runtime.requestFrame).toHaveBeenCalled();
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('uses the gallery root as a full-viewport input blocker while visible', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });

      const galleryRoot = runtime.root.children[0] as Container;
      const blocker = galleryRoot.children[0];
      expect(blocker).toBeInstanceOf(Graphics);
      expect(blocker?.eventMode).toBe('static');

      runtime.layer.hideGallery();
      expect(galleryRoot.eventMode).toBe('none');
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('gives gallery tabs explicit hit areas independent of glyph bounds', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });

      const textTab = findText(runtime.root, '文本');
      expect(textTab.hitArea).toEqual(expect.objectContaining(new Rectangle(0, -18, 60, 62)));
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('keeps the tab controls stable while rebuilding gallery content', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      const textTab = findText(runtime.root, '文本');

      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);

      expect(findText(runtime.root, '文本')).toBe(textTab);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('keeps the tab controls stable across hide and re-entry', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      const textTab = findText(runtime.root, '文本');

      runtime.layer.hideGallery();
      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });

      expect(findText(runtime.root, '文本')).toBe(textTab);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('opens and closes the CG viewer without exposing display objects through queries', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-asset' }],
        music: [],
      });

      findParentWithText(runtime.root, '初遇').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'viewer', viewerKey: 'cg-asset' });
      expect(runtime.root.children.some((child) => child instanceof Sprite)).toBe(false);
      expect(findText(runtime.root, '点击任意处返回列表').text).toBe('点击任意处返回列表');

      findParentWithText(runtime.root, '点击任意处返回列表').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('uses the Facade as the v2 cross-layer coordinator while the Layer owns Gallery state', () => {
    const runtime = makeGalleryRuntime();
    const stage = {
      destroy: vi.fn(),
      hideCommandRail: vi.fn(),
      restoreCommandRail: vi.fn(),
      showGallery: vi.fn(),
    } as unknown as RendererStagePort;
    const dialogue = { hideCommandRail: vi.fn() };
    const menu = { hideSettings: vi.fn(), hideSaveLoad: vi.fn() };
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: dialogue as unknown as DialogueProjectionPort,
      menuLayer: menu as unknown as MenuProjectionPort,
      galleryLayer: runtime.layer,
    });
    try {
      facade.commands.gallery.showGallery({ cgs: [], music: [] });

      expect(menu.hideSettings).toHaveBeenCalledOnce();
      expect(menu.hideSaveLoad).toHaveBeenCalledOnce();
      expect(dialogue.hideCommandRail).toHaveBeenCalledOnce();
      expect(stage.showGallery).not.toHaveBeenCalled();
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });

      facade.commands.gallery.hideGallery();
      expect(stage.restoreCommandRail).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('coordinates an interactive v2 close after the Layer has cleared its local projection', () => {
    const runtime = makeGalleryRuntime();
    const order: string[] = [];
    let facade!: RendererFacade;
    const restoreCommandRail = vi.fn(() => {
      order.push('restore-rail');
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
    });
    const onClose = vi.fn(() => {
      order.push('host-close');
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
    });
    const stage = {
      destroy: vi.fn(),
      hideCommandRail: vi.fn(),
      restoreCommandRail,
      showGallery: vi.fn(),
    } as unknown as RendererStagePort;
    facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: { hideCommandRail: vi.fn() } as unknown as DialogueProjectionPort,
      galleryLayer: runtime.layer,
    });
    try {
      facade.commands.gallery.showGallery({ cgs: [], music: [], onClose });
      findText(runtime.root, '✕ 关闭').emit('pointerdown', pointerEvent);

      expect(runtime.layer.gallery()).toEqual({ type: 'none' });
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      expect(order).toEqual(['restore-rail', 'host-close']);
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('restores the v2 command rail when an interactive close has no host callback', () => {
    const runtime = makeGalleryRuntime();
    const restoreCommandRail = vi.fn();
    const stage = {
      destroy: vi.fn(),
      hideCommandRail: vi.fn(),
      restoreCommandRail,
      showGallery: vi.fn(),
    } as unknown as RendererStagePort;
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: { hideCommandRail: vi.fn() } as unknown as DialogueProjectionPort,
      galleryLayer: runtime.layer,
    });
    try {
      facade.commands.gallery.showGallery({ cgs: [], music: [] });
      expect(() => findText(runtime.root, '✕ 关闭').emit('pointerdown', pointerEvent)).not.toThrow();

      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('preserves v2 close cleanup and re-entry when the host callback throws', () => {
    const runtime = makeGalleryRuntime();
    const failure = new Error('gallery host close failure');
    const restoreCommandRail = vi.fn();
    const stage = {
      destroy: vi.fn(),
      hideCommandRail: vi.fn(),
      restoreCommandRail,
      showGallery: vi.fn(),
    } as unknown as RendererStagePort;
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: { hideCommandRail: vi.fn() } as unknown as DialogueProjectionPort,
      galleryLayer: runtime.layer,
    });
    try {
      facade.commands.gallery.showGallery({ cgs: [], music: [], onClose: () => { throw failure; } });
      expect(() => findText(runtime.root, '✕ 关闭').emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);

      facade.commands.gallery.showGallery({ cgs: [], music: [] });
      findText(runtime.root, '✕ 关闭').emit('pointerdown', pointerEvent);
      expect(restoreCommandRail).toHaveBeenCalledTimes(2);
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('handles empty lists, repeated show/hide/reset, and callback exceptions transactionally', () => {
    const runtime = makeGalleryRuntime();
    const failure = new Error('gallery close callback');
    try {
      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      expect(findText(runtime.root, '暂无 CG 条目（gallery.json 未配置）').text).toContain('暂无 CG 条目');
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });

      runtime.layer.showGallery({ cgs: [], music: [{ id: 'music-1', name: '主题曲', unlocked: true }] });
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      expect(findText(runtime.root, '♪  主题曲').text).toBe('♪  主题曲');
      runtime.layer.hideGallery();
      expect(runtime.layer.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);

      runtime.layer.showGallery({ cgs: [], music: [], onClose: () => { throw failure; } });
      expect(() => findText(runtime.root, '✕ 关闭').emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(runtime.layer.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);

      runtime.layer.showGallery({ cgs: [], music: [] });
      runtime.layer.reset();
      expect(runtime.layer.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('keeps two independent 50-cycle batches at the same disposed gallery stable point', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const runBatch = (): ReturnType<RenderLifecycle['snapshot']> => {
      for (let i = 0; i < 50; i++) {
        const root = new Container();
        const layer = new GalleryLayer({
          uiLayer: root,
          width: 1280,
          height: 720,
          assets,
          lifecycle,
          createBackgroundTexture: () => new Texture(),
        });
        exerciseGalleryLayer(layer);
        layer.dispose();
        expect(root.children).toHaveLength(0);
      }
      return lifecycle.snapshot();
    };
    try {
      const first = runBatch();
      const second = runBatch();
      expect(second).toEqual(first);
      expect(second.listeners).toBe(0);
      expect(second.activeTweens).toBe(0);
      expect(second.displayObjectsByOwner.gallery).toBe(0);
    } finally {
      assets.dispose();
      lifecycle.dispose();
    }
  });
});
