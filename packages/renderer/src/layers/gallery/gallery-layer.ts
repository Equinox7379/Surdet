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
import { bindPlayerControl, markPlayerModal } from '../../player-controls.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from '../../theme.js';
import { drawPlayerDivider, drawPlayerFrame } from '../../ui-decoration.js';
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
  /** Retained for the stage compatibility constructor; missing images use an explicit placeholder. */
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
  #tabBorders = new Map<string, Graphics>();
  #scrollOffset = 0;
  #scrollContent: Container | null = null;
  #scrollHeight = 0;
  #layoutContent: (() => void) | null = null;

  constructor(options: GalleryLayerOptions) {
    this.#root = options.uiLayer;
    this.#w = options.width;
    this.#h = options.height;
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#requestFrameCallback = options.requestFrame;

    this.#galleryLayer = new Container();
    this.#galleryLayer.visible = false;
    this.#galleryLayer.eventMode = 'none';
    this.#root.addChild(this.#galleryLayer);
    this.#registerDisplay('gallery-layer', this.#galleryLayer);
    markPlayerModal(this.#galleryLayer, {
      close: () => this.#galleryMode === 'viewer' ? this.#returnToGrid() : this.#closeGallery(),
      scroll: (delta) => this.#scrollGallery(delta),
    });
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

  setDeclarativeUiSuppression(suppressed: boolean): void {
    this.#galleryLayer.renderable = !suppressed;
    this.#galleryLayer.accessibleChildren = !suppressed;
    this.#galleryLayer.interactiveChildren = !suppressed;
    this.#requestFrame();
  }

  setTheme(theme: RendererTheme): void {
    if (this.#disposed) return;
    const previous = this.#theme;
    this.#theme = theme;
    this.#updateTabStyles();
    repaintThemeProjection(this.#galleryLayer, previous, theme);
    this.#layoutContent?.();
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
    this.#scrollOffset = 0;
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

    // Rebuilds replace the visible Pixi subtree synchronously, but a static
    // title screen may have an idle FrameScheduler. Wake one frame at the
    // single rebuild boundary so tab switches and viewer return cannot leave
    // the semantic projection ahead of the committed canvas.
    this.#requestFrame();

    // Keep the tab controls alive across content rebuilds. Replacing the
    // active pointer target during its own dispatch leaves the Pixi event
    // boundary with a stale hit tree in the title-page path.
    this.#clearContent();
    layer.eventMode = 'auto';

    if (!this.#galleryHeader) {
      const blocker = drawPlayerFrame(new Graphics(), this.#theme, 16, 12, this.#w - 32, this.#h - 24, { ornament: true });
      blocker.eventMode = 'static';
      layer.addChild(blocker);

      const header = new Container();
      this.#galleryHeader = header;
      layer.addChild(header);
      header.addChild(drawPlayerDivider(new Graphics(), this.#theme, this.#margin, 77, this.#w - this.#margin * 2));
      const mkBtn = (label: string, x: number, width: number, onTap: () => void): PText => {
        const t = bindThemeTextProjection(new PText({
          text: label,
          style: { fontSize: this.#theme.typography.uiSize, fontFamily: this.#assets.fontFamily('ui'), fill: this.#theme.colors.textMuted, fontWeight: 'normal' } satisfies TextStyleOptions,
        }), { fill: 'textMuted', fontSize: 'uiSize' });
        t.position.set(x, 30);
        header.addChild(t);
        bindPlayerControl(t, { label, x: -12, y: -12, width, height: 52 });
        const border = this.#controlBorder(t, width, 52, -12, -12);
        this.#tabBorders.set(label, border);
        t.on('pointerout', () => { border.visible = this.#galleryTabs?.[this.#galleryTab] === t; });
        t.cursor = 'pointer';
        t.on('pointerdown', onTap);
        return t;
      };
      this.#galleryTabs = {
        cg: mkBtn('图片', this.#margin, 80, () => this.#selectGalleryTab('cg')),
        music: mkBtn('音乐', this.#margin + 96, 80, () => this.#selectGalleryTab('music')),
        text: mkBtn('文本', this.#margin + 192, 80, () => this.#selectGalleryTab('text')),
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

    const list = new Container();
    this.#scrollContent = list;
    const mask = bindThemeGraphicsProjection(new Graphics().rect(this.#margin - 4, 92, this.#w - this.#margin * 2 + 8, this.#viewportHeight).fill(0xffffff), [null]);
    list.mask = mask;
    content.addChild(list, mask);
    const items = this.#galleryTab === 'cg' ? views.cgs : this.#galleryTab === 'music' ? views.music : views.texts;
    if (!items.length) {
      const empty = this.#galleryTab === 'cg' ? '暂无鉴赏图片' : this.#galleryTab === 'music' ? '暂无音乐条目' : '暂无文本回想条目';
      list.addChild(this.#text(empty, this.#w - this.#margin * 2, 'textMuted')).position.set(this.#margin, 8);
      this.#scrollHeight = 64;
    } else if (this.#galleryTab === 'cg') {
      const gap = this.#theme.spacing.lg;
      const cols = Math.max(1, Math.min(4, Math.floor((this.#w - this.#margin * 2 + gap) / 280)));
      const cw = (this.#w - this.#margin * 2 - (cols - 1) * gap) / cols;
      const ch = cw * 9 / 16;
      const rows = items.map((item) => {
        const cell = new Container();
        cell.addChild(drawPlayerFrame(new Graphics(), this.#theme, 0, 0, cw, ch, { color: 'surfaceStrong' }));
        const key = item.src ?? item.id;
        const texture = item.unlocked ? this.#assets.resolveBackground(key) : null;
        if (texture) this.#addImage(cell, texture, cw, ch);
        else {
          const placeholder = this.#text(item.unlocked ? '图像不可用' : '未解锁', cw - 32, item.unlocked ? 'textMuted' : 'textDisabled');
          placeholder.position.set(16, ch / 2 - 16);
          cell.addChild(placeholder);
        }
        const label = this.#text(item.unlocked ? item.name : '???', cw, item.unlocked ? 'text' : 'textDisabled');
        label.position.set(0, ch + 12);
        cell.addChild(label);
        const border = this.#controlBorder(cell, cw, ch);
        bindPlayerControl(cell, {
          label: item.unlocked ? `查看 ${item.name}` : '未解锁的图片', width: cw, height: ch + 48, enabled: item.unlocked,
          reveal: () => this.#reveal(cell),
        });
        if (item.unlocked) {
          cell.cursor = 'pointer';
          cell.on('pointerdown', () => {
            this.#galleryMode = 'viewer';
            this.#galleryViewerKey = key;
            this.#rebuildGallery();
          });
        }
        list.addChild(cell);
        return { cell, label, border };
      });
      this.#layoutContent = () => {
        let y = 0;
        for (let i = 0; i < rows.length; i += cols) {
          const group = rows.slice(i, i + cols);
          const rowHeight = ch + 12 + Math.max(...group.map(({ label }) => this.#textHeight(label))) + 24;
          group.forEach(({ cell, border }, col) => {
            cell.position.set(this.#margin + col * (cw + gap), y);
            (cell.hitArea as Rectangle).height = rowHeight - 8;
            border.clear().rect(0, 0, cw, rowHeight - 8).stroke({ color: this.#theme.colors.line, width: 2 });
          });
          y += rowHeight;
        }
        this.#scrollHeight = y;
        this.#scrollGallery(0);
      };
    } else {
      const isMusic = this.#galleryTab === 'music';
      const width = Math.min(920, this.#w - this.#margin * 2);
      const rows = items.map((item) => {
        const row = new Container();
        const background = bindThemeGraphicsProjection(new Graphics(), [item.unlocked ? 'surfaceStrong' : 'panel']);
        row.addChild(background);
        const label = this.#text(`${item.unlocked ? isMusic ? '♪' : '❐' : '?'}  ${item.unlocked ? item.name : '???'}`, width - 40, item.unlocked ? 'text' : 'textDisabled');
        label.position.set(20, 14);
        row.addChild(label);
        const enabled = item.unlocked && Boolean(isMusic ? this.#galleryOnPlayMusic : this.#galleryOnReplayText);
        const note = !item.unlocked ? '未解锁' : !enabled ? (isMusic ? '当前无法播放' : '当前无法回想') : '';
        const status = note ? this.#text(note, width - 40, 'textDisabled') : null;
        if (status) row.addChild(status);
        const border = this.#controlBorder(row, width, 58);
        bindPlayerControl(row, { label: item.unlocked ? `${isMusic ? '播放' : '回想'} ${item.name}` : '未解锁条目', width, height: 58, enabled, reveal: () => this.#reveal(row) });
        if (enabled) {
          row.cursor = 'pointer';
          row.on('pointerdown', () => isMusic ? this.#galleryOnPlayMusic?.(item.id, item.src) : this.#galleryOnReplayText?.({ ...item }));
        }
        list.addChild(row);
        return { row, background, label, status, border, item };
      });
      this.#layoutContent = () => {
        let y = 0;
        for (const { row, background, label, status, border, item } of rows) {
          const labelHeight = this.#textHeight(label);
          if (status) status.position.set(20, labelHeight + 20);
          const height = Math.max(58, labelHeight + (status ? this.#textHeight(status) + 6 : 0) + 28);
          row.position.set(this.#margin, y);
          (row.hitArea as Rectangle).height = height;
          background.clear().roundRect(0, 0, width, height, this.#theme.radius.md).fill({ color: item.unlocked ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: this.#theme.opacity.surface });
          border.clear().roundRect(0, 0, width, height, this.#theme.radius.md).stroke({ color: this.#theme.colors.line, width: 2 });
          y += height + this.#theme.spacing.sm;
        }
        this.#scrollHeight = y;
        this.#scrollGallery(0);
      };
    }
    this.#layoutContent?.();
    this.#scrollGallery(0);
    this.#registerListener();
  }

  #selectGalleryTab(tab: 'cg' | 'music' | 'text'): void {
    this.#galleryTab = tab;
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#scrollOffset = 0;
    this.#rebuildGallery();
  }

  #updateTabStyles(): void {
    const tabs = this.#galleryTabs;
    if (!tabs) return;
    for (const [tab, text] of Object.entries(tabs) as Array<['cg' | 'music' | 'text', PText]>) {
      const active = this.#galleryTab === tab;
      text.style = {
        fontFamily: this.#assets.fontFamily('ui'),
        fontSize: this.#theme.typography.uiSize,
        fill: active ? this.#theme.colors.accent : this.#theme.colors.textMuted,
        fontWeight: active ? 'bold' : 'normal',
      } satisfies TextStyleOptions;
      bindThemeTextProjection(text, { fill: active ? 'accent' : 'textMuted', fontSize: 'uiSize' });
      const border = this.#tabBorders.get(text.text);
      if (border) border.visible = active;
    }
  }

  #buildGalleryViewer(content: Container, key: string): void {
    const width = this.#w - this.#margin * 2;
    const height = this.#h - 156;
    const image = new Container();
    image.position.set(this.#margin, 92);
    const texture = this.#assets.resolveBackground(key);
    if (texture) this.#addImage(image, texture, width, height);
    else image.addChild(this.#text('图像不可用', width, 'textMuted')).position.set(0, height / 2);
    content.addChild(image);
    content.addChild(this.#text('点击任意处返回列表', width, 'text')).position.set(this.#margin, this.#h - 48);
    bindPlayerControl(content, { label: '返回画廊列表', x: this.#margin, y: 88, width, height: this.#h - 112 });
    this.#controlBorder(content, width, this.#h - 112, this.#margin, 88);
    content.on('pointerdown', () => this.#returnToGrid());
    markPlayerModal(content, { close: () => this.#returnToGrid() });
  }

  #returnToGrid(): void {
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#rebuildGallery();
  }

  get #margin(): number { return Math.max(32, this.#w * 0.047); }
  get #viewportHeight(): number { return Math.max(80, this.#h - 116); }

  #text(value: string, width: number, role: 'text' | 'textMuted' | 'textDisabled'): PText {
    return bindThemeTextProjection(new PText({ text: value, style: {
      fontFamily: this.#assets.fontFamily('ui'), fontSize: this.#theme.typography.uiSize,
      fill: this.#theme.colors[role], wordWrap: true, breakWords: true, wordWrapWidth: width,
    } }), { fill: role, fontSize: 'uiSize' });
  }

  #textHeight(text: PText): number {
    if (typeof document !== 'undefined') return text.height;
    // Headless projection has no canvas font metrics. Browser layout always uses Pixi's measured height.
    const size = Number(text.style.fontSize);
    return text.text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length * size / text.style.wordWrapWidth)), 0) * size * 1.4;
  }

  #addImage(target: Container, texture: Texture, width: number, height: number): void {
    const sprite = new Sprite(texture);
    const scale = Math.min(width / Math.max(1, texture.width), height / Math.max(1, texture.height));
    sprite.width = texture.width * scale;
    sprite.height = texture.height * scale;
    sprite.position.set((width - sprite.width) / 2, (height - sprite.height) / 2);
    target.addChild(sprite);
  }

  #controlBorder(target: Container, width: number, height: number, x = 0, y = 0): Graphics {
    const border = bindThemeGraphicsProjection(new Graphics().rect(x, y, width, height).stroke({ color: this.#theme.colors.line, width: 2 }), ['line']);
    border.visible = false;
    border.eventMode = 'none';
    if (target instanceof PText) {
      target.parent!.addChild(border);
      border.position.copyFrom(target.position);
    } else target.addChild(border);
    target.on('pointerover', () => { border.visible = true; this.#requestFrame(); });
    target.on('pointerout', () => { border.visible = false; this.#requestFrame(); });
    return border;
  }

  #scrollGallery(delta: number): void {
    if (!this.#scrollContent) return;
    this.#scrollOffset = Math.max(0, Math.min(Math.max(0, this.#scrollHeight - this.#viewportHeight), this.#scrollOffset + delta));
    this.#scrollContent.y = 92 - this.#scrollOffset;
    this.#requestFrame();
  }

  #reveal(target: Container): void {
    const bottom = target.y + (target.hitArea as Rectangle).height;
    if (target.y < this.#scrollOffset) this.#scrollGallery(target.y - this.#scrollOffset);
    else if (bottom > this.#scrollOffset + this.#viewportHeight) this.#scrollGallery(Math.min(target.y, bottom - this.#viewportHeight) - this.#scrollOffset);
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
    this.#tabBorders.clear();
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
    this.#scrollContent = null;
    this.#layoutContent = null;
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
