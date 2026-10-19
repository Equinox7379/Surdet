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

function makeGalleryRuntime(width = 1280, height = 720): GalleryRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requestFrame = vi.fn();
  const layer = new GalleryLayer({
    uiLayer: root,
    width,
    height,
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

it('shows ending progress and descriptions without invoking replay or music', () => {
  const runtime = makeGalleryRuntime();
  const replay = vi.fn(); const music = vi.fn();
  const facade = new RendererFacade({ stage: { destroy: vi.fn(), hideCommandRail: vi.fn() } as unknown as RendererStagePort,
    controller: makeController(), monitor: new RenderPerformanceMonitor(), galleryLayer: runtime.layer });
  try {
    facade.commands.gallery.showGallery({ cgs: [], music: [], endings: [
      { id: 'home', name: '归途', description: '雨停了。', unlocked: true },
      { id: 'secret', name: '剧透名称', description: '剧透说明', unlocked: false },
    ], onReplayText: replay, onPlayMusic: music });
    findText(runtime.root, '结局').emit('pointerdown', pointerEvent);
    expect(runtime.layer.debugSnapshot()).toMatchObject({ overlay: { tab: 'ending' } });
    expect(findText(runtime.root, '已收集 1/2 个结局').text).toContain('1/2');
    expect(findText(runtime.root, '雨停了。').text).toBe('雨停了。');
    const row = findParentWithText(runtime.root, '归途');
    row.emit('pointerdown', pointerEvent);
    expect(replay).not.toHaveBeenCalled(); expect(music).not.toHaveBeenCalled();
    expect(findText(runtime.root, '未解锁').text).toBe('未解锁');
  } finally { disposeGalleryRuntime(runtime); }
});

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

function allText(root: Container): PText[] {
  return root.children.flatMap(child => child instanceof PText ? [child] : child instanceof Container ? allText(child) : []);
}

function controlBounds(node: Container): Rectangle {
  const area = node.hitArea as Rectangle;
  let x = area.x, y = area.y;
  for (let current: Container | null = node; current; current = current.parent) { x += current.x; y += current.y; }
  return new Rectangle(x, y, area.width, area.height);
}

describe('Gallery collection layout', () => {
  it('repositions an empty list and its mask when live typography grows the header', () => {
    const runtime = makeGalleryRuntime(500, 320);
    try {
      runtime.layer.showGallery({ cgs: [], music: [] });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      const message = findText(runtime.root, '暂无音乐条目');
      const list = message.parent!;
      const mask = list.parent!.children.find(child => child instanceof Graphics) as Graphics;
      const previousTop = list.y;
      runtime.layer.setTheme(createRendererTheme({ typography: { headingSize: 40, uiSize: 30, captionSize: 24 } }));
      expect(list.y).toBeGreaterThan(previousTop);
      expect(mask.getLocalBounds().y).toBe(list.y);
      expect(list.y + message.y).toBeGreaterThan(controlBounds(findText(runtime.root, '词典')).bottom);
      expect(findText(runtime.root, '暂无音乐条目')).toBe(message);
    } finally { disposeGalleryRuntime(runtime); }
  });

  it.each(['结局', '人物', '词典'])('does not advertise read-only %s cards as actionable keyboard buttons', (tabName) => {
    const runtime = makeGalleryRuntime(), play = vi.fn(), replay = vi.fn();
    const entry = { id: 'collected', name: '已经收集的内容', description: '仍然可读的说明', unlocked: true };
    try {
      runtime.layer.showGallery({ cgs: [], music: [], endings: [entry], profiles: [entry], terms: [entry], onPlayMusic: play, onReplayText: replay });
      findText(runtime.root, tabName).emit('pointerdown', pointerEvent);
      const row = findParentWithText(runtime.root, entry.name);
      expect(row.tabIndex).toBe(-1);
      expect(row.accessibleTitle).toContain(entry.name);
      expect(findText(runtime.root, entry.description).text).toBe(entry.description);
      row.emit('pointerover', pointerEvent);
      expect((row.children.at(-1) as Graphics).visible).toBe(false);
      row.emit('pointerdown', pointerEvent);
      expect(play).not.toHaveBeenCalled(); expect(replay).not.toHaveBeenCalled();
      expect(findText(runtime.root, tabName).tabIndex).toBe(0);
      expect(findText(runtime.root, '关闭').tabIndex).toBe(0);
    } finally { disposeGalleryRuntime(runtime); }
  });

  it.each([[1280, 720], [960, 540], [500, 320]])('lays out readable ending cards and keeps navigation reachable at %ix%i', (width, height) => {
    const runtime = makeGalleryRuntime(width, height);
    const onClose = vi.fn(), onReplayText = vi.fn(), onPlayMusic = vi.fn();
    const resolve = vi.spyOn(runtime.assets, 'resolveBackground');
    const names = ['归途', '第二篇回忆', '尚未完结的故事', '第四页'];
    try {
      runtime.layer.showGallery({ cgs: [], music: [], endings: names.map((name, index) => ({
        id: `ending-${index}`, name: index === 1 ? '不能泄露的结局名称' : name,
        description: index === 1 ? '不能泄露的秘密内容' : '走过漫长的旅途后，回忆终于有了自己的归处。',
        src: index === 1 ? 'secret-image.png' : undefined, unlocked: index !== 1,
      })), onClose, onReplayText, onPlayMusic });
      const tabs = ['图片', '音乐', '文本', '结局', '人物', '词典'].map(label => findText(runtime.root, label));
      const close = findText(runtime.root, '关闭');
      const navigation = [...tabs, close].map(controlBounds);
      for (const rect of navigation) {
        expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width); expect(rect.bottom).toBeLessThan(height);
      }
      navigation.forEach((rect, index) => navigation.slice(index + 1).forEach(other => {
        expect(rect.x < other.right && rect.right > other.x && rect.y < other.bottom && rect.bottom > other.y).toBe(false);
      }));
      tabs[3]!.emit('pointerdown', pointerEvent);
      expect(findText(runtime.root, '回忆鉴赏').style.fontSize).toBe(DEFAULT_RENDERER_THEME.typography.headingSize);
      expect(findText(runtime.root, '结局收藏').text).toBe('结局收藏');
      expect(findText(runtime.root, '已收集 3/4 个结局').text).toContain('3/4');
      const cards = ['归途', '未书写的结局', '尚未完结的故事', '第四页'].map(name => findParentWithText(runtime.root, name));
      const first = cards[0]!, second = cards[1]!, third = cards[2]!;
      expect(controlBounds(first).y).toBeGreaterThan(Math.max(...navigation.map(rect => rect.bottom)));
      if (width >= 960) {
        expect(first.y).toBe(second.y); expect(second.x).toBeGreaterThan(first.x + (first.hitArea as Rectangle).width);
        expect(third.y).toBeGreaterThanOrEqual(first.y + (first.hitArea as Rectangle).height);
      } else {
        expect(first.x).toBe(second.x); expect(second.y).toBeGreaterThan(first.y + (first.hitArea as Rectangle).height);
      }
      expect(allText(runtime.root).map(text => text.text).join('\n')).not.toMatch(/不能泄露|secret-image/);
      expect(second.accessibleTitle).toBe('结局 02 未解锁');
      const lockedBorder = second.children.at(-1) as Graphics;
      second.emit('pointerover', pointerEvent); expect(lockedBorder.visible).toBe(false);
      first.emit('pointerdown', pointerEvent); second.emit('pointerdown', pointerEvent);
      expect(onPlayMusic).not.toHaveBeenCalled(); expect(onReplayText).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      const list = first.parent!;
      const initialY = list.y;
      cards[3]!.emit('mouseover', {} as FederatedPointerEvent);
      if (width === 500) expect(list.y).toBeLessThan(initialY);
      tabs[5]!.emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ tab: 'term' });
      expect(findText(runtime.root, '结局')).toBe(tabs[3]);
      close.emit('pointerdown', pointerEvent); expect(onClose).toHaveBeenCalledOnce();
    } finally { disposeGalleryRuntime(runtime); }
  });

  it('reflows long unlocked names and descriptions under a live theme without replacing tabs or leaking locks', () => {
    const runtime = makeGalleryRuntime(960, 540);
    const longName = '写给未来的一封很长很长的信'.repeat(5), description = '每一段未说出口的往事，都应当能够完整阅读。'.repeat(20);
    try {
      runtime.layer.showGallery({ cgs: [], music: [], endings: [
        { id: 'a', name: longName, description, unlocked: true },
        { id: 'b', name: '不能显示', description: '不能显示的描述', unlocked: false },
        { id: 'c', name: '下一行', unlocked: true },
      ] });
      const tab = findText(runtime.root, '结局'); tab.emit('pointerdown', pointerEvent);
      const card = findParentWithText(runtime.root, longName), title = findText(runtime.root, longName), body = findText(runtime.root, description);
      const previousHeight = (card.hitArea as Rectangle).height;
      runtime.layer.setTheme(createRendererTheme({ typography: { headingSize: 36, uiSize: 28, captionSize: 22 }, colors: { text: 0x112244, accent: 0x445588 } }));
      expect(findText(runtime.root, '结局')).toBe(tab);
      expect(findText(runtime.root, longName)).toBe(title); expect(findText(runtime.root, description)).toBe(body);
      expect(title.style.fill).toBe(0x112244); expect(title.style.fontSize).toBe(36);
      expect((card.hitArea as Rectangle).height).toBeGreaterThan(previousHeight);
      expect(body.y).toBeGreaterThan(title.y);
      const next = findParentWithText(runtime.root, '下一行');
      expect(next.y).toBeGreaterThanOrEqual(card.y + (card.hitArea as Rectangle).height);
      expect(runtime.layer.themeProjectionSnapshot().visibleTextFills).not.toContain(DEFAULT_RENDERER_THEME.colors.text);
      expect(allText(runtime.root).map(text => text.text).join('\n')).not.toContain('不能显示');
    } finally { disposeGalleryRuntime(runtime); }
  });

  it('keeps real CG thumbnails and viewer below the same compact header and never resolves locked resources', async () => {
    const runtime = makeGalleryRuntime(500, 320);
    await runtime.assets.registerBackground('visible', Texture.WHITE);
    const resolve = vi.spyOn(runtime.assets, 'resolveBackground');
    try {
      runtime.layer.showGallery({ cgs: [
        { id: 'a', name: '真实图像', src: 'visible', unlocked: true },
        { id: 'b', name: '隐藏图像名', src: 'secret', unlocked: false },
      ], music: [] });
      const cell = findParentWithText(runtime.root, '真实图像');
      expect(cell.children.some(child => child instanceof Sprite && child.texture === Texture.WHITE)).toBe(true);
      expect(resolve).toHaveBeenCalledWith('visible'); expect(resolve).not.toHaveBeenCalledWith('secret');
      const viewportY = cell.parent!.y, tabs = ['图片', '音乐', '文本', '结局', '人物', '词典'].map(label => findText(runtime.root, label));
      cell.emit('pointerdown', pointerEvent);
      const viewer = findParentWithText(runtime.root, '点击任意处返回列表');
      expect((viewer.hitArea as Rectangle).y).toBe(viewportY);
      expect(controlBounds(viewer).y).toBeGreaterThan(Math.max(...tabs.map(tab => controlBounds(tab).bottom)));
      runtime.layer.setTheme(createRendererTheme({ typography: { uiSize: 24, headingSize: 32 } }));
      expect(controlBounds(viewer).bottom).toBeLessThanOrEqual(320);
      viewer.emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ mode: 'grid' });
      tabs.forEach(tab => expect(findText(runtime.root, tab.text)).toBe(tab));
      expect(resolve).not.toHaveBeenCalledWith('secret');
    } finally { disposeGalleryRuntime(runtime); }
  });

  it('gives hover and keyboard focus distinct feedback while disabled rows stay still', () => {
    const runtime = makeGalleryRuntime();
    try {
      runtime.layer.showGallery({ cgs: [], music: [{ id: 'a', name: '曲目', unlocked: true }, { id: 'b', name: '隐藏', unlocked: false }], onPlayMusic: vi.fn() });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      const row = findParentWithText(runtime.root, '曲目'), border = row.children.at(-1) as Graphics;
      row.emit('pointerover', { pointerId: 1 } as FederatedPointerEvent);
      expect(border.visible).toBe(true); const hoverAlpha = border.alpha;
      row.emit('pointerout', pointerEvent); expect(border.visible).toBe(false);
      row.emit('mouseover', {} as FederatedPointerEvent);
      expect(border.visible).toBe(true); expect(border.alpha).toBeGreaterThan(hoverAlpha);
      const locked = findParentWithText(runtime.root, '???'), lockedBorder = locked.children.at(-1) as Graphics;
      locked.emit('pointerover', pointerEvent); expect(lockedBorder.visible).toBe(false);
      expect(locked.tabIndex).toBe(-1);
    } finally { disposeGalleryRuntime(runtime); }
  });

  it.each(['音乐', '文本', '人物', '词典'])('keeps %s entries readable, scrollable and correctly owned on a small canvas', (tabName) => {
    const runtime = makeGalleryRuntime(500, 320), play = vi.fn(), replay = vi.fn();
    const entries = Array.from({ length: 20 }, (_, index) => ({
      id: `entry-${index}`, name: `能够完整阅读的收藏条目 ${index}`, description: '一段不会被固定行高截掉的资料说明。'.repeat(5),
      unlocked: true, scene: 'memory', src: `track-${index}.mp3`,
    }));
    try {
      runtime.layer.showGallery({ cgs: [], music: entries, texts: entries, profiles: entries, terms: entries, onPlayMusic: play, onReplayText: replay });
      const tab = findText(runtime.root, tabName); tab.emit('pointerdown', pointerEvent);
      const last = findParentWithText(runtime.root, entries[19]!.name), list = last.parent!;
      const before = list.y;
      last.emit('mouseover', {} as FederatedPointerEvent); expect(list.y).toBeLessThan(before);
      expect((last.hitArea as Rectangle).width).toBeLessThan(500);
      expect(last.accessibleTitle).toContain(entries[19]!.name);
      last.emit('pointerdown', pointerEvent);
      if (tabName === '音乐') expect(play).toHaveBeenCalledWith('entry-19', 'track-19.mp3');
      else if (tabName === '文本') expect(replay).toHaveBeenCalledWith(entries[19]);
      else { expect(play).not.toHaveBeenCalled(); expect(replay).not.toHaveBeenCalled(); }
      runtime.layer.setTheme(createRendererTheme({ typography: { uiSize: 26, headingSize: 32 } }));
      expect(findText(runtime.root, tabName)).toBe(tab);
      const first = findParentWithText(runtime.root, entries[0]!.name); first.emit('mouseover', {} as FederatedPointerEvent);
      const tabBottom = Math.max(...['图片', '音乐', '文本', '结局', '人物', '词典'].map(name => controlBounds(findText(runtime.root, name)).bottom));
      expect(controlBounds(first).y).toBeGreaterThan(tabBottom);
      if (tabName === '人物' || tabName === '词典') expect(allText(last).some(text => text.text === entries[19]!.description)).toBe(true);
    } finally { disposeGalleryRuntime(runtime); }
  });
});

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
      expect(findParentWithText(runtime.root, '主题曲').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.text }),
      });
      expect(findParentWithText(runtime.root, '???').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.textDisabled }),
      });
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.panel);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.surfaceStrong);

      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findParentWithText(runtime.root, '第一夜').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.text }),
      });
      expect(findParentWithText(runtime.root, '???').children.find((child) => child instanceof PText)).toMatchObject({
        style: expect.objectContaining({ fill: DEFAULT_RENDERER_THEME.colors.textDisabled }),
      });
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.panel);
      findGraphicsWithColor(runtime.root, DEFAULT_RENDERER_THEME.colors.surfaceStrong);

      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findText(runtime.root, '暂无音乐条目').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.textMuted);

      runtime.layer.showGallery({ cgs: [], music: [], texts: [] });
      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      cycleTheme();
      expect(findText(runtime.root, '暂无文本回想条目').style.fill).toBe(DEFAULT_RENDERER_THEME.colors.textMuted);

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
      findParentWithText(runtime.root, '主题曲').emit('pointerdown', pointerEvent);
      expect(onPlayMusic).toHaveBeenCalledOnce();
      expect(onPlayMusic).toHaveBeenCalledWith('music-1', 'theme.mp3');
      findParentWithText(runtime.root, '???').emit('pointerdown', pointerEvent);
      expect(onPlayMusic).toHaveBeenCalledOnce();

      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'text', mode: 'grid', viewerKey: null });
      findParentWithText(runtime.root, '第一夜').emit('pointerdown', pointerEvent);
      expect(onReplayText).toHaveBeenCalledOnce();
      expect(onReplayText).toHaveBeenCalledWith(textItem);

      findText(runtime.root, '关闭').emit('pointerdown', pointerEvent);
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
      expect(findText(runtime.root, '主题曲').text).toBe('主题曲');
      expect(runtime.requestFrame).toHaveBeenCalled();

      runtime.requestFrame.mockClear();
      findText(runtime.root, '文本').emit('pointerdown', pointerEvent);
      expect(runtime.layer.gallery()).toMatchObject({ type: 'gallery', tab: 'text', mode: 'grid' });
      expect(findText(runtime.root, '第一夜').text).toBe('第一夜');
      expect(runtime.requestFrame).toHaveBeenCalled();

      runtime.requestFrame.mockClear();
      findText(runtime.root, '图片').emit('pointerdown', pointerEvent);
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

  it('scrolls long lists and reveals keyboard focused entries without changing unlock or callback ownership', () => {
    const runtime = makeGalleryRuntime();
    const onPlayMusic = vi.fn();
    const music = Array.from({ length: 24 }, (_, index) => ({
      id: `music-${index}`,
      name: `一首需要完整阅读的长曲目 ${index}`,
      unlocked: index % 3 !== 0,
      src: `music-${index}.mp3`,
    }));
    try {
      runtime.layer.showGallery({ cgs: [], music, onPlayMusic });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      const last = findParentWithText(runtime.root, '一首需要完整阅读的长曲目 23');
      expect(last.hitArea).toEqual(expect.objectContaining({ width: 920, height: expect.any(Number) }));
      expect(last.accessibleTitle).toContain('播放');
      expect(last.children.some((child) => child instanceof PText && child.text.includes('一首需要完整阅读'))).toBe(true);
      const list = last.parent;
      expect(list).toBeInstanceOf(Container);
      const before = (list as Container).y;

      // The helper emits a generic mouseover for DOM accessibility focus; the
      // Gallery layer must reveal the corresponding row inside its viewport.
      last.emit('mouseover', {} as FederatedPointerEvent);
      expect((list as Container).y).toBeLessThan(before);

      // The locked first item remains visible as disabled text and cannot
      // invoke the owner callback even when a raw pointer event is emitted.
      const locked = findParentWithText(runtime.root, '???');
      expect(locked.accessibleTitle).toBe('未解锁条目');
      locked.emit('pointerdown', pointerEvent);
      expect(onPlayMusic).not.toHaveBeenCalled();
    } finally {
      disposeGalleryRuntime(runtime);
    }
  });

  it('uses an explicit missing-image placeholder and never creates a generated CG texture', () => {
    const root = new Container();
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const createBackgroundTexture = vi.fn(() => new Texture());
    const layer = new GalleryLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      createBackgroundTexture,
    });
    try {
      layer.showGallery({ cgs: [{ id: 'missing', name: '缺失图片', unlocked: true, src: 'missing' }], music: [] });
      expect(createBackgroundTexture).not.toHaveBeenCalled();
      expect(findText(root, '图像不可用').text).toBe('图像不可用');
      findParentWithText(root, '缺失图片').emit('pointerdown', pointerEvent);
      expect(findText(root, '图像不可用').text).toBe('图像不可用');
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
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
      expect(textTab.hitArea).toBeInstanceOf(Rectangle);
      expect((textTab.hitArea as Rectangle).width).toBeGreaterThanOrEqual(80);
      expect((textTab.hitArea as Rectangle).height).toBeGreaterThanOrEqual(44);
      expect(textTab.accessibleTitle).toBe('文本');
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
      findText(runtime.root, '关闭').emit('pointerdown', pointerEvent);

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
      expect(() => findText(runtime.root, '关闭').emit('pointerdown', pointerEvent)).not.toThrow();

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
      expect(() => findText(runtime.root, '关闭').emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);

      facade.commands.gallery.showGallery({ cgs: [], music: [] });
      findText(runtime.root, '关闭').emit('pointerdown', pointerEvent);
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
      expect(findText(runtime.root, '暂无鉴赏图片').text).toContain('暂无鉴赏图片');
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });

      runtime.layer.showGallery({ cgs: [], music: [{ id: 'music-1', name: '主题曲', unlocked: true }] });
      expect(runtime.layer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });
      findText(runtime.root, '音乐').emit('pointerdown', pointerEvent);
      expect(findText(runtime.root, '主题曲').text).toBe('主题曲');
      runtime.layer.hideGallery();
      expect(runtime.layer.gallery()).toEqual({ type: 'none' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(0);

      runtime.layer.showGallery({ cgs: [], music: [], onClose: () => { throw failure; } });
      expect(() => findText(runtime.root, '关闭').emit('pointerdown', pointerEvent)).toThrow(failure);
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
