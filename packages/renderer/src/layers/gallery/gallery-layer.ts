import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text as PText,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type { GalleryProjectionPort } from '../../api/renderer-commands.js';
import type { GalleryOverlayState } from '../../api/renderer-queries.js';
import type { GalleryItemView } from '../../gallery.js';
import { RenderLifecycle } from '../../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from '../../theme.js';
import {
  bindThemeGraphicsProjection,
  bindThemeTextProjection,
  readThemeProjection,
  repaintThemeProjection,
  type LayerThemeProjectionSnapshot,
} from '../../theme-projection.js';

/** Gallery-only rendering port. Cross-layer visibility decisions stay in the Facade. */
export interface GalleryLayerOptions {
  readonly uiLayer: Container;
  readonly width: number;
  readonly height: number;
  readonly assets: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
  /** The compatibility stage supplies the existing deterministic background fallback. */
  readonly createBackgroundTexture: (key: string, width: number, height: number) => Texture;
  readonly requestFrame?: () => void;
}

/** Read-only evidence emitted for the local renderer acceptance harness. */
export interface GalleryLayerDebugSnapshot {
  readonly overlay: GalleryOverlayState;
  readonly cgCount: number;
  readonly musicCount: number;
  readonly textCount: number;
}

interface GalleryViews {
  readonly cgs: GalleryItemView[];
  readonly music: GalleryItemView[];
  readonly texts: GalleryItemView[];
}

/**
 * Owns CG, music, and text-replay gallery projection.
 *
 * The layer receives already prepared view models and only dispatches callbacks;
 * unlock rules, persistence, and scene jumps remain outside the renderer.
 */
export class GalleryLayer implements GalleryProjectionPort {
  readonly owner = 'gallery' as const;

  readonly #root: Container;
  readonly #w: number;
  readonly #h: number;
  readonly #assets: RenderAssetRegistry;
  readonly #lifecycle: RenderLifecycle;
  readonly #ownsLifecycle: boolean;
  readonly #createBackgroundTexture: (key: string, width: number, height: number) => Texture;
  readonly #requestFrameCallback?: () => void;
  #disposed = false;

  readonly #galleryLayer: Container;
  #theme: RendererTheme = DEFAULT_RENDERER_THEME;
  #galleryTab: 'cg' | 'music' | 'text' = 'cg';
  #galleryMode: 'grid' | 'viewer' = 'grid';
  #galleryViews: GalleryViews | null = null;
  #galleryOnPlayMusic: ((id: string, src?: string) => void) | null = null;
  #galleryOnReplayText: ((item: GalleryItemView) => void) | null = null;
  #galleryOnClose: (() => void) | null = null;
  #galleryViewerKey: string | null = null;
  #galleryHeader: Container | null = null;
  #galleryContent: Container | null = null;
  #galleryTabs: { cg: PText; music: PText; text: PText } | null = null;

  constructor(options: GalleryLayerOptions) {
    this.#root = options.uiLayer;
    this.#w = options.width;
    this.#h = options.height;
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#createBackgroundTexture = options.createBackgroundTexture;
    this.#requestFrameCallback = options.requestFrame;

    this.#galleryLayer = new Container();
    this.#galleryLayer.visible = false;
    this.#galleryLayer.eventMode = 'none';
    this.#root.addChild(this.#galleryLayer);
    this.#registerDisplay('gallery-layer', this.#galleryLayer);
  }

  gallery(): GalleryOverlayState {
    if (this.#disposed || !this.#galleryLayer.visible || !this.#galleryViews) return { type: 'none' };
    return {
      type: 'gallery',
      tab: this.#galleryTab,
      mode: this.#galleryMode,
      viewerKey: this.#galleryViewerKey,
    };
  }

  /**
   * Test-only read model. It reads projected gallery views without touching
   * Pixi state or requesting a frame.
   */
  debugSnapshot(): GalleryLayerDebugSnapshot {
    return {
      overlay: this.gallery(),
      cgCount: this.#galleryViews?.cgs.length ?? 0,
      musicCount: this.#galleryViews?.music.length ?? 0,
      textCount: this.#galleryViews?.texts.length ?? 0,
    };
  }

  themeProjectionSnapshot(): LayerThemeProjectionSnapshot {
    return readThemeProjection(this.#galleryLayer);
  }

  setTheme(theme: RendererTheme): void {
    if (this.#disposed) return;
    const previous = this.#theme;
    this.#theme = theme;
    this.#updateTabStyles();
    repaintThemeProjection(this.#galleryLayer, previous, theme);
  }

  showGallery(options: {
    cgs: readonly GalleryItemView[];
    music: readonly GalleryItemView[];
    texts?: readonly GalleryItemView[];
    onPlayMusic?: (id: string, source?: string) => void;
    onReplayText?: (item: GalleryItemView) => void;
    onClose?: () => void;
  }): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearContent();
    this.#galleryViews = {
      cgs: options.cgs.map((item) => ({ ...item })),
      music: options.music.map((item) => ({ ...item })),
      texts: (options.texts ?? []).map((item) => ({ ...item })),
    };
    this.#galleryOnPlayMusic = options.onPlayMusic ?? null;
    this.#galleryOnReplayText = options.onReplayText ?? null;
    this.#galleryOnClose = options.onClose ?? null;
    this.#galleryTab = 'cg';
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#rebuildGallery();
    this.#bringToFront();
    this.#galleryLayer.eventMode = 'auto';
    this.#galleryLayer.visible = true;
  }

  hideGallery(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearContent();
    this.#galleryLayer.eventMode = 'none';
    this.#galleryLayer.visible = false;
    this.#galleryOnPlayMusic = null;
    this.#galleryOnReplayText = null;
    this.#galleryOnClose = null;
  }

  reset(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.hideGallery();
    this.#galleryViews = null;
    this.#galleryTab = 'cg';
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#galleryLayer.eventMode = 'none';
    this.#clearLayer();
    this.#galleryViews = null;
    this.#galleryOnPlayMusic = null;
    this.#galleryOnReplayText = null;
    this.#galleryOnClose = null;
    this.#galleryViewerKey = null;
    try {
      this.#lifecycle.releaseOwner('gallery');
    } finally {
      if (this.#galleryLayer.parent) this.#galleryLayer.parent.removeChild(this.#galleryLayer);
      if (this.#ownsLifecycle) this.#lifecycle.dispose();
    }
  }

  #rebuildGallery(): void {
    const layer = this.#galleryLayer;
    const views = this.#galleryViews;
    if (!views) return;

    // Keep the tab controls alive across content rebuilds. Replacing the
    // active pointer target during its own dispatch leaves the Pixi event
    // boundary with a stale hit tree in the title-page path.
    this.#clearContent();
    layer.eventMode = 'auto';

    if (!this.#galleryHeader) {
      const blocker = bindThemeGraphicsProjection(
        new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.95 }),
        ['panel'],
      );
      blocker.eventMode = 'static';
      layer.addChild(blocker);

      const header = new Container();
      this.#galleryHeader = header;
      layer.addChild(header);
      const mkBtn = (label: string, x: number, width: number, onTap: () => void): PText => {
        const t = bindThemeTextProjection(new PText({
          text: label,
          style: { fontSize: 24, fill: this.#theme.colors.textMuted, fontWeight: 'normal' } satisfies TextStyleOptions,
        }), { fill: 'textMuted' });
        t.position.set(x, 30);
        // Use a stable logical hit box instead of relying on the rendered glyph
        // bounds, which vary with font loading and can miss a real player click.
        t.hitArea = new Rectangle(0, -18, width, 62);
        t.eventMode = 'static';
        t.cursor = 'pointer';
        t.on('pointerdown', onTap);
        header.addChild(t);
        return t;
      };
      this.#galleryTabs = {
        cg: mkBtn('CG', 60, 96, () => this.#selectGalleryTab('cg')),
        music: mkBtn('音乐', 150, 112, () => this.#selectGalleryTab('music')),
        text: mkBtn('文本', 240, 60, () => this.#selectGalleryTab('text')),
      };
      const close = mkBtn('✕ 关闭', this.#w - 150, 150, () => this.#closeGallery());
      close.eventMode = 'static';
    }
    this.#updateTabStyles();

    const content = new Container();
    this.#galleryContent = content;
    layer.addChild(content);

    if (this.#galleryMode === 'viewer' && this.#galleryViewerKey !== null) {
      this.#buildGalleryViewer(content, this.#galleryViewerKey);
      this.#registerListener();
      return;
    }

    if (this.#galleryTab === 'cg') {
      const items = views.cgs;
      if (items.length === 0) {
        content.addChild(bindThemeTextProjection(
          new PText({ text: '暂无 CG 条目（gallery.json 未配置）', style: { fontSize: 20, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }),
          { fill: 'textMuted' },
        )).position.set(60, 100);
        this.#registerListener();
        return;
      }
      const cols = 4;
      const cw = 270;
      const ch = 152;
      items.forEach((item, i) => {
        const x = 60 + (i % cols) * (cw + 20);
        const y = 96 + Math.floor(i / cols) * (ch + 48);
        const cell = new Container();
        cell.position.set(x, y);
        if (item.unlocked) {
          const key = item.src ?? item.id;
          const tex = this.#assets.resolveBackground(key)
            ?? this.#assets.getOrCreateBackground(key, () => this.#createBackgroundTexture(key, 320, 180));
          const sp = new Sprite(tex);
          sp.width = cw;
          sp.height = ch;
          cell.addChild(sp);
          cell.eventMode = 'static';
          cell.cursor = 'pointer';
          cell.on('pointerdown', () => {
            this.#galleryMode = 'viewer';
            this.#galleryViewerKey = key;
            this.#rebuildGallery();
          });
        } else {
          cell.addChild(bindThemeGraphicsProjection(
            new Graphics().rect(0, 0, cw, ch).fill({ color: this.#theme.colors.surfaceStrong, alpha: 1 }),
            ['surfaceStrong'],
          ));
          const question = bindThemeTextProjection(
            new PText({ text: '?', style: { fontSize: 42, fill: this.#theme.colors.textDisabled } satisfies TextStyleOptions }),
            { fill: 'textDisabled' },
          );
          cell.addChild(question).position.set(cw / 2 - 12, ch / 2 - 30);
        }
        const itemLabel = bindThemeTextProjection(new PText({
          text: item.unlocked ? item.name : '???',
          style: { fontSize: 18, fill: item.unlocked ? this.#theme.colors.text : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
        }), { fill: item.unlocked ? 'text' : 'textDisabled' });
        cell.addChild(itemLabel).position.set(0, ch + 10);
        content.addChild(cell);
      });
      this.#registerListener();
      return;
    }

    if (this.#galleryTab === 'music') {
      const items = views.music;
      if (items.length === 0) {
        content.addChild(bindThemeTextProjection(
          new PText({ text: '暂无音乐条目（gallery.json 未配置）', style: { fontSize: 20, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }),
          { fill: 'textMuted' },
        )).position.set(60, 100);
        this.#registerListener();
        return;
      }
      items.forEach((item, i) => {
        const y = 96 + i * 58;
        const row = new Container();
        row.position.set(60, y);
        row.addChild(bindThemeGraphicsProjection(
          new Graphics().roundRect(0, 0, 720, 46, 8).fill({ color: item.unlocked ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: 0.95 }),
          [item.unlocked ? 'surfaceStrong' : 'panel'],
        ));
        row.addChild(bindThemeTextProjection(new PText({
          text: `${item.unlocked ? '♪' : '?'}  ${item.unlocked ? item.name : '???'}`,
          style: { fontSize: 20, fill: item.unlocked ? this.#theme.colors.text : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
        }), { fill: item.unlocked ? 'text' : 'textDisabled' })).position.set(18, 10);
        if (item.unlocked) {
          row.eventMode = 'static';
          row.cursor = 'pointer';
          row.on('pointerdown', () => this.#galleryOnPlayMusic?.(item.id, item.src));
        }
        content.addChild(row);
      });
      this.#registerListener();
      return;
    }

    const items = views.texts;
    if (items.length === 0) {
      content.addChild(bindThemeTextProjection(
        new PText({ text: '暂无文本回想条目（gallery.json 未配置 texts）', style: { fontSize: 20, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }),
        { fill: 'textMuted' },
      )).position.set(60, 100);
      this.#registerListener();
      return;
    }
    items.forEach((item, i) => {
      const y = 96 + i * 58;
      const row = new Container();
      row.position.set(60, y);
      row.addChild(bindThemeGraphicsProjection(
        new Graphics().roundRect(0, 0, 720, 46, 8).fill({ color: item.unlocked ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: 0.95 }),
        [item.unlocked ? 'surfaceStrong' : 'panel'],
      ));
      row.addChild(bindThemeTextProjection(new PText({
        text: `${item.unlocked ? '❐' : '?'}  ${item.unlocked ? item.name : '???'}`,
        style: { fontSize: 20, fill: item.unlocked ? this.#theme.colors.text : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      }), { fill: item.unlocked ? 'text' : 'textDisabled' })).position.set(18, 10);
      if (item.unlocked) {
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointerdown', () => this.#galleryOnReplayText?.({ ...item }));
      }
      content.addChild(row);
    });
    this.#registerListener();
  }

  #selectGalleryTab(tab: 'cg' | 'music' | 'text'): void {
    this.#galleryTab = tab;
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#rebuildGallery();
  }

  #updateTabStyles(): void {
    const tabs = this.#galleryTabs;
    if (!tabs) return;
    for (const [tab, text] of Object.entries(tabs) as Array<['cg' | 'music' | 'text', PText]>) {
      const active = this.#galleryTab === tab;
      text.style = {
        fontSize: 24,
        fill: active ? this.#theme.colors.accent : this.#theme.colors.textMuted,
        fontWeight: active ? 'bold' : 'normal',
      } satisfies TextStyleOptions;
      bindThemeTextProjection(text, { fill: active ? 'accent' : 'textMuted' });
    }
  }

  #buildGalleryViewer(content: Container, key: string): void {
    const tex = this.#assets.resolveBackground(key)
      ?? this.#assets.getOrCreateBackground(key, () => this.#createBackgroundTexture(key, this.#w, this.#h));
    const sp = new Sprite(tex);
    sp.width = this.#w;
    sp.height = this.#h;
    content.addChild(sp);
    content.addChild(bindThemeTextProjection(new PText({
      text: '点击任意处返回列表',
      style: { fontSize: 20, fill: this.#theme.colors.text } satisfies TextStyleOptions,
    }), { fill: 'text' })).position.set(this.#w - 250, this.#h - 44);
    content.eventMode = 'static';
    content.on('pointerdown', () => {
      this.#galleryMode = 'grid';
      this.#galleryViewerKey = null;
      this.#rebuildGallery();
    });
  }

  #closeGallery(): void {
    const callback = this.#galleryOnClose;
    this.hideGallery();
    callback?.();
  }

  #registerDisplay(key: string, layer: Container): void {
    this.#lifecycle.register('gallery', 'display', key, () => {
      if (layer.parent) layer.parent.removeChild(layer);
      layer.destroy({ children: true });
    });
  }

  #registerListener(): void {
    this.#lifecycle.release('gallery', 'listener', 'gallery');
    this.#lifecycle.register('gallery', 'listener', 'gallery', () => {
      this.#galleryLayer.removeAllListeners();
      this.#galleryContent?.removeAllListeners();
    });
    // Every tab/viewer rebuild replaces the child hit targets. Reassert the
    // sibling-layer order at the same boundary so a legacy/menu projection
    // cannot become the next real pointer target.
    this.#bringToFront();
  }

  #clearLayer(): void {
    this.#clearContent();
    this.#galleryLayer.removeAllListeners();
    this.#galleryHeader = null;
    this.#galleryTabs = null;
    this.#galleryLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  #clearContent(): void {
    this.#lifecycle.release('gallery', 'listener', 'gallery');
    this.#galleryLayer.removeAllListeners();
    this.#galleryContent?.removeAllListeners();
    const content = this.#galleryContent;
    if (content?.parent) content.parent.removeChild(content);
    content?.removeChildren().forEach((child) => child.destroy({ children: true }));
    content?.destroy({ children: false });
    this.#galleryContent = null;
  }

  #bringToFront(): void {
    const index = this.#root.children.length - 1;
    if (index >= 0 && this.#root.getChildIndex(this.#galleryLayer) !== index) {
      this.#root.setChildIndex(this.#galleryLayer, index);
    }
  }

  #requestFrame(): void {
    this.#requestFrameCallback?.();
  }
}
