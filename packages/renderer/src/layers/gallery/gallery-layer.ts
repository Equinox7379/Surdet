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
  readonly endings: GalleryItemView[];
  readonly profiles: GalleryItemView[];
  readonly terms: GalleryItemView[];
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
  #galleryTab: 'cg' | 'music' | 'text' | 'ending' | 'profile' | 'term' = 'cg';
  #galleryMode: 'grid' | 'viewer' = 'grid';
  #galleryViews: GalleryViews | null = null;
  #galleryOnPlayMusic: ((id: string, src?: string) => void) | null = null;
  #galleryOnReplayText: ((item: GalleryItemView) => void) | null = null;
  #galleryOnClose: (() => void) | null = null;
  #galleryViewerKey: string | null = null;
  #galleryHeader: Container | null = null;
  #galleryContent: Container | null = null;
  #galleryTabs: { cg: PText; music: PText; text: PText; ending: PText; profile: PText; term: PText } | null = null;
  #tabBorders = new Map<string, Graphics>();
  #tabAccents = new Map<string, Graphics>();
  #galleryTitle: PText | null = null;
  #sectionTitle: PText | null = null;
  #progress: PText | null = null;
  #closeControl: PText | null = null;
  #headerDivider: Graphics | null = null;
  #viewportMask: Graphics | null = null;
  #contentTop = 0;
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
    this.#layoutHeader();
    this.#layoutContent?.();
    this.#scrollGallery(0);
    this.#requestFrame();
  }

  showGallery(options: {
    cgs: readonly GalleryItemView[];
    music: readonly GalleryItemView[];
    texts?: readonly GalleryItemView[];
    endings?: readonly GalleryItemView[];
    profiles?: readonly GalleryItemView[];
    terms?: readonly GalleryItemView[];
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
      endings: (options.endings ?? []).map((item) => ({ ...item })),
      profiles: (options.profiles ?? []).map((item) => ({ ...item })),
      terms: (options.terms ?? []).map((item) => ({ ...item })),
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
      const blocker = drawPlayerFrame(new Graphics(), this.#theme, 0, 0, this.#w, this.#h, { alpha: 1, ornament: true });
      blocker.eventMode = 'static';
      layer.addChild(blocker);

      const header = new Container();
      this.#galleryHeader = header;
      layer.addChild(header);
      this.#galleryTitle = this.#text('回忆鉴赏', this.#w - this.#margin * 2 - 128, 'text', 'headingSize');
      this.#sectionTitle = this.#text('', this.#w / 2, 'text');
      this.#progress = this.#text('', this.#w / 2, 'textMuted', 'captionSize');
      this.#headerDivider = drawPlayerDivider(new Graphics(), this.#theme, 0, 0, 1);
      header.addChild(this.#galleryTitle, this.#sectionTitle, this.#progress, this.#headerDivider);
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
        const accent = bindThemeGraphicsProjection(new Graphics(), ['accent']);
        accent.eventMode = 'none';
        header.addChild(accent);
        this.#tabAccents.set(label, accent);
        t.cursor = 'pointer';
        t.on('pointerdown', onTap);
        return t;
      };
      this.#galleryTabs = {
        cg: mkBtn('图片', this.#margin, 80, () => this.#selectGalleryTab('cg')),
        music: mkBtn('音乐', this.#margin + 96, 80, () => this.#selectGalleryTab('music')),
        text: mkBtn('文本', this.#margin + 192, 80, () => this.#selectGalleryTab('text')),
        ending: mkBtn('结局', this.#margin + 288, 80, () => this.#selectGalleryTab('ending')),
        profile: mkBtn('人物', this.#margin + 384, 80, () => this.#selectGalleryTab('profile')),
        term: mkBtn('词典', this.#margin + 480, 80, () => this.#selectGalleryTab('term')),
      };
      const close = mkBtn('关闭', this.#w - 150, 120, () => this.#closeGallery());
      close.eventMode = 'static';
      this.#closeControl = close;
    }
    this.#updateTabStyles();
    this.#layoutHeader();

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
    const mask = bindThemeGraphicsProjection(new Graphics(), [null]);
    this.#viewportMask = mask;
    list.mask = mask;
    content.addChild(list, mask);
    const items = this.#galleryTab === 'cg' ? views.cgs : this.#galleryTab === 'music' ? views.music : this.#galleryTab === 'ending' ? views.endings
      : this.#galleryTab === 'profile' ? views.profiles : this.#galleryTab === 'term' ? views.terms : views.texts;
    if (!items.length) {
      const empty = this.#galleryTab === 'cg' ? '暂无鉴赏图片' : this.#galleryTab === 'music' ? '暂无音乐条目' : this.#galleryTab === 'ending' ? '已收集 0/0 个结局 · 暂无结局条目'
        : this.#galleryTab === 'profile' ? '已收集 0/0 项人物资料' : this.#galleryTab === 'term' ? '已收集 0/0 个词条' : '暂无文本回想条目';
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
        const border = this.#controlBorder(cell, cw, ch, 0, 0, item.unlocked);
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
    } else if (this.#galleryTab === 'ending') {
      this.#buildEndingCards(list, items);
    } else {
      const isMusic = this.#galleryTab === 'music';
      const isReadOnly = this.#galleryTab === 'profile' || this.#galleryTab === 'term';
      const width = Math.min(920, this.#w - this.#margin * 2);
      const rows = items.map((item) => {
        const row = new Container();
        const background = bindThemeGraphicsProjection(new Graphics(), [item.unlocked ? 'surfaceStrong' : 'panel']);
        row.addChild(background);
        const label = this.#text(item.unlocked ? item.name : '???', width - 40, item.unlocked ? 'text' : 'textDisabled');
        label.position.set(20, 14);
        row.addChild(label);
        const enabled = !isReadOnly && item.unlocked && Boolean(isMusic ? this.#galleryOnPlayMusic : this.#galleryOnReplayText);
        const note = !item.unlocked ? '未解锁' : isReadOnly ? item.description ?? '' : !enabled ? (isMusic ? '当前无法播放' : '当前无法回想') : '';
        const status = note ? this.#text(note, width - 40, item.unlocked ? 'textMuted' : 'textDisabled') : null;
        if (status) row.addChild(status);
        const border = this.#controlBorder(row, width, 58, 0, 0, enabled);
        bindPlayerControl(row, { label: item.unlocked ? `${isReadOnly ? this.#galleryTab === 'profile' ? '人物资料' : '词条' : isMusic ? '播放' : '回想'} ${item.name}${isReadOnly && note ? `：${note}` : ''}` : '未解锁条目', width, height: 58, enabled, reveal: () => this.#reveal(row) });
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

  #selectGalleryTab(tab: 'cg' | 'music' | 'text' | 'ending' | 'profile' | 'term'): void {
    this.#galleryTab = tab;
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#scrollOffset = 0;
    this.#rebuildGallery();
  }

  #layoutHeader(): void {
    if (!this.#galleryTabs || !this.#galleryTitle || !this.#sectionTitle || !this.#progress || !this.#closeControl) return;
    const available = this.#w - this.#margin * 2;
    const closeWidth = Math.max(100, this.#theme.typography.uiSize * 2 + 32);
    const title = this.#galleryTitle;
    title.style.wordWrapWidth = available - closeWidth - 16;
    title.position.set(this.#margin, 20);
    const close = this.#closeControl;
    close.position.set(this.#w - this.#margin - closeWidth + 12, 24);
    close.hitArea = new Rectangle(-12, -8, closeWidth, 44);
    const closeBorder = this.#tabBorders.get(close.text)!;
    closeBorder.position.copyFrom(close.position);
    closeBorder.clear().rect(-12, -8, closeWidth, 44).stroke({ color: this.#theme.colors.line, width: 2 });
    const gap = this.#w < 680 ? this.#theme.spacing.xs : this.#theme.spacing.md;
    const columns = available >= 6 * Math.max(72, this.#theme.typography.uiSize * 2 + 24) + gap * 5 ? 6 : 3;
    const width = columns === 6 ? Math.min(96, (available - gap * 5) / 6) : (available - gap * 2) / 3;
    const height = Math.max(44, this.#theme.typography.uiSize * 1.4 + 16);
    const top = 20 + Math.max(44, this.#textHeight(title)) + 8;
    Object.values(this.#galleryTabs).forEach((tab, index) => {
      const x = this.#margin + index % columns * (width + gap), y = top + Math.floor(index / columns) * (height + 6);
      tab.position.set(x + 12, y + 8);
      tab.style.wordWrapWidth = width - 24;
      tab.hitArea = new Rectangle(-12, -8, width, height);
      const border = this.#tabBorders.get(tab.text)!;
      border.position.copyFrom(tab.position);
      border.clear().rect(-12, -8, width, height).stroke({ color: this.#theme.colors.line, width: 2 });
      this.#tabAccents.get(tab.text)!.clear().moveTo(x + 12, y + height).lineTo(x + width - 12, y + height)
        .stroke({ color: this.#theme.colors.accent, width: 2 });
    });
    const sectionY = top + Math.ceil(6 / columns) * (height + 6) + 8;
    const names = { cg: '图片珍藏', music: '音乐鉴赏', text: '文本回想', ending: '结局收藏', profile: '人物档案', term: '词典拾遗' };
    const views = this.#galleryViews;
    const items = views ? ({ cg: views.cgs, music: views.music, text: views.texts, ending: views.endings, profile: views.profiles, term: views.terms })[this.#galleryTab] : [];
    const unit = this.#galleryTab === 'ending' ? '个结局' : this.#galleryTab === 'profile' ? '项人物资料' : this.#galleryTab === 'term' ? '个词条' : '项';
    this.#sectionTitle.text = names[this.#galleryTab];
    this.#sectionTitle.style.wordWrapWidth = available * 0.4;
    this.#sectionTitle.position.set(this.#margin, sectionY);
    this.#progress.text = `已收集 ${items.filter(item => item.unlocked).length}/${items.length} ${unit}`;
    this.#progress.style.wordWrapWidth = available * 0.6;
    this.#progress.style.align = 'right';
    this.#progress.position.set(this.#w - this.#margin - this.#textWidth(this.#progress), sectionY);
    this.#contentTop = sectionY + Math.max(this.#textHeight(this.#sectionTitle), this.#textHeight(this.#progress)) + 20;
    drawPlayerDivider(this.#headerDivider!, this.#theme, this.#margin, this.#contentTop - 10, available);
  }

  #buildEndingCards(list: Container, items: readonly GalleryItemView[]): void {
    const cards = items.map((item, index) => {
      const card = new Container();
      const background = new Graphics();
      const divider = new Graphics();
      const spine = bindThemeGraphicsProjection(new Graphics(), ['line', 'accentSoft']);
      const number = this.#text(String(index + 1).padStart(2, '0'), 80, item.unlocked ? 'accentSoft' : 'textDisabled', 'titleSize');
      number.style.wordWrap = false;
      number.alpha = item.unlocked ? 0.12 : 0.06;
      const status = this.#text(item.unlocked ? '已完成' : '未解锁', 100, item.unlocked ? 'accentSoft' : 'textDisabled', 'captionSize');
      const title = this.#text(item.unlocked ? item.name : '未书写的结局', 100, item.unlocked ? 'text' : 'textDisabled', 'headingSize');
      const description = this.#text(item.unlocked ? item.description ?? '这一页的回忆已被珍藏。' : '故事尚未抵达此页。', 100, item.unlocked ? 'textMuted' : 'textDisabled');
      card.addChild(background, divider, spine, number, status, title, description);
      const border = this.#controlBorder(card, 1, 1, 0, 0, false);
      bindPlayerControl(card, {
        label: item.unlocked ? `结局 ${String(index + 1).padStart(2, '0')} ${item.name}：${description.text}` : `结局 ${String(index + 1).padStart(2, '0')} 未解锁`,
        width: 1, height: 1, enabled: false, reveal: () => this.#reveal(card),
      });
      list.addChild(card);
      return { card, background, divider, spine, number, status, title, description, border, item };
    });
    this.#layoutContent = () => {
      const gap = this.#h < 600 ? this.#theme.spacing.md : this.#theme.spacing.lg;
      const available = this.#w - this.#margin * 2;
      const columns = available >= 680 ? 2 : 1;
      const width = (available - gap * (columns - 1)) / columns;
      const padding = this.#h < 600 ? this.#theme.spacing.md : this.#theme.spacing.lg;
      const heights = cards.map(({ number, status, title, description }) => {
        status.style.wordWrapWidth = width / 2;
        status.style.align = 'right';
        status.position.set(width - padding - this.#textWidth(status), padding);
        title.style.wordWrapWidth = width - padding * 2;
        // The watermark owns the lower-right column; body copy never flows beneath it.
        description.style.wordWrapWidth = Math.max(1, width - padding * 3 - this.#textWidth(number));
        const headingY = padding + this.#textHeight(status) + this.#theme.spacing.md;
        title.position.set(padding, headingY);
        description.position.set(padding, headingY + this.#textHeight(title) + 12);
        return Math.max(160, (this.#viewportHeight - gap) / 2,
          description.y + this.#textHeight(description) + padding,
          title.y + this.#textHeight(title) + this.#theme.spacing.sm + this.#textHeight(number) + padding);
      });
      let y = 0;
      for (let i = 0; i < cards.length; i += columns) {
        const height = Math.max(...heights.slice(i, i + columns));
        cards.slice(i, i + columns).forEach(({ card, background, divider, spine, number, border, item }, column) => {
          card.position.set(this.#margin + column * (width + gap), y);
          (card.hitArea as Rectangle).width = width;
          (card.hitArea as Rectangle).height = height;
          const paper = item.unlocked ? 'surface' : 'panel';
          background.clear().roundRect(0, 0, width, height, this.#theme.radius.sm)
            .fill({ color: this.#theme.colors[paper], alpha: item.unlocked ? this.#theme.opacity.panel : this.#theme.opacity.surface })
            .stroke({ color: this.#theme.colors.line, alpha: item.unlocked ? 0.24 : 0.12, width: 0.7 });
          bindThemeGraphicsProjection(background, [paper, 'line']);
          divider.clear().moveTo(padding, padding + this.#theme.typography.captionSize / 2)
            .lineTo(padding + Math.min(64, width * 0.16), padding + this.#theme.typography.captionSize / 2)
            .stroke({ color: this.#theme.colors.accentSoft, alpha: item.unlocked ? 0.65 : 0.2, width: 1 });
          bindThemeGraphicsProjection(divider, ['accentSoft']);
          spine.clear().moveTo(9, 14).lineTo(9, height - 14)
            .stroke({ color: this.#theme.colors.line, alpha: item.unlocked ? 0.35 : 0.12, width: 0.7 })
            .moveTo(12, 14).lineTo(12, height - 7).lineTo(width - 12, height - 7)
            .stroke({ color: this.#theme.colors.accentSoft, alpha: item.unlocked ? 0.12 : 0.05, width: 1 });
          number.position.set(width - padding - this.#textWidth(number), height - padding - this.#textHeight(number));
          border.clear().roundRect(0, 0, width, height, this.#theme.radius.sm).stroke({ color: this.#theme.colors.line, width: 2 });
        });
        y += height + gap;
      }
      this.#scrollHeight = Math.max(0, y - gap);
      this.#scrollGallery(0);
    };
  }

  #updateTabStyles(): void {
    const tabs = this.#galleryTabs;
    if (!tabs) return;
    for (const [tab, text] of Object.entries(tabs) as Array<['cg' | 'music' | 'text' | 'ending' | 'profile' | 'term', PText]>) {
      const active = this.#galleryTab === tab;
      text.style = {
        fontFamily: this.#assets.fontFamily('ui'),
        fontSize: this.#theme.typography.uiSize,
        fill: active ? this.#theme.colors.accent : this.#theme.colors.textMuted,
        fontWeight: active ? 'bold' : 'normal',
      } satisfies TextStyleOptions;
      bindThemeTextProjection(text, { fill: active ? 'accent' : 'textMuted', fontSize: 'uiSize' });
      const accent = this.#tabAccents.get(text.text);
      if (accent) accent.visible = active;
    }
  }

  #buildGalleryViewer(content: Container, key: string): void {
    const width = this.#w - this.#margin * 2;
    const image = new Container();
    image.position.set(this.#margin, this.#contentTop);
    const texture = this.#assets.resolveBackground(key);
    if (texture) this.#addImage(image, texture, width, this.#viewportHeight);
    else image.addChild(this.#text('图像不可用', width, 'textMuted'));
    content.addChild(image);
    const hint = this.#text('点击任意处返回列表', width, 'text');
    content.addChild(hint);
    bindPlayerControl(content, { label: '返回画廊列表', x: this.#margin, y: this.#contentTop, width, height: this.#viewportHeight });
    const border = this.#controlBorder(content, width, this.#viewportHeight, this.#margin, this.#contentTop);
    this.#layoutContent = () => {
      image.y = this.#contentTop;
      const height = Math.max(1, this.#viewportHeight - this.#textHeight(hint) - 12);
      const picture = image.children[0];
      if (picture instanceof Sprite && texture) {
        const scale = Math.min(width / Math.max(1, texture.width), height / Math.max(1, texture.height));
        picture.width = texture.width * scale;
        picture.height = texture.height * scale;
        picture.position.set((width - picture.width) / 2, (height - picture.height) / 2);
      } else if (picture) picture.y = height / 2;
      hint.position.set(this.#margin, this.#h - 20 - this.#textHeight(hint));
      (content.hitArea as Rectangle).y = this.#contentTop;
      (content.hitArea as Rectangle).height = this.#viewportHeight;
      border.clear().rect(this.#margin, this.#contentTop, width, this.#viewportHeight).stroke({ color: this.#theme.colors.line, width: 2 });
    };
    this.#layoutContent();
    content.on('pointerdown', () => this.#returnToGrid());
    markPlayerModal(content, { close: () => this.#returnToGrid() });
  }

  #returnToGrid(): void {
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#rebuildGallery();
  }

  get #margin(): number { return Math.max(20, this.#w * 0.047); }
  get #viewportHeight(): number { return Math.max(1, this.#h - this.#contentTop - 20); }

  #text(value: string, width: number, role: 'text' | 'textMuted' | 'textDisabled' | 'accentSoft', size: 'uiSize' | 'headingSize' | 'captionSize' | 'titleSize' = 'uiSize'): PText {
    return bindThemeTextProjection(new PText({ text: value, style: {
      fontFamily: this.#assets.fontFamily('ui'), fontSize: this.#theme.typography[size],
      fill: this.#theme.colors[role], wordWrap: true, breakWords: true, wordWrapWidth: width,
    } }), { fill: role, fontSize: size });
  }

  #textHeight(text: PText): number {
    if (typeof document !== 'undefined') return text.height;
    // Headless projection has no canvas font metrics. Browser layout always uses Pixi's measured height.
    const size = Number(text.style.fontSize);
    const width = text.style.wordWrap ? text.style.wordWrapWidth : Infinity;
    return text.text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length * size / width)), 0) * size * 1.4;
  }

  #textWidth(text: PText): number {
    if (typeof document !== 'undefined') return text.width;
    // Same headless-only metric estimate as #textHeight; the Player uses measured Pixi bounds.
    const width = Math.max(...text.text.split('\n').map(line => line.length * Number(text.style.fontSize)));
    return text.style.wordWrap ? Math.min(text.style.wordWrapWidth, width) : width;
  }

  #addImage(target: Container, texture: Texture, width: number, height: number): void {
    const sprite = new Sprite(texture);
    const scale = Math.min(width / Math.max(1, texture.width), height / Math.max(1, texture.height));
    sprite.width = texture.width * scale;
    sprite.height = texture.height * scale;
    sprite.position.set((width - sprite.width) / 2, (height - sprite.height) / 2);
    target.addChild(sprite);
  }

  #controlBorder(target: Container, width: number, height: number, x = 0, y = 0, enabled = true): Graphics {
    const border = bindThemeGraphicsProjection(new Graphics().rect(x, y, width, height).stroke({ color: this.#theme.colors.line, width: 2 }), ['line']);
    border.visible = false;
    border.eventMode = 'none';
    if (target instanceof PText) {
      target.parent!.addChild(border);
      border.position.copyFrom(target.position);
    } else target.addChild(border);
    if (enabled) {
      target.on('pointerover', (event) => {
        border.visible = true;
        border.alpha = event && 'pointerId' in event ? 0.55 : 1;
        this.#requestFrame();
      });
      target.on('pointerout', () => { border.visible = false; this.#requestFrame(); });
    }
    return border;
  }

  #scrollGallery(delta: number): void {
    if (!this.#scrollContent) return;
    this.#scrollOffset = Math.max(0, Math.min(Math.max(0, this.#scrollHeight - this.#viewportHeight), this.#scrollOffset + delta));
    this.#scrollContent.y = this.#contentTop - this.#scrollOffset;
    this.#viewportMask?.clear().rect(this.#margin - 4, this.#contentTop, this.#w - this.#margin * 2 + 8, this.#viewportHeight).fill(0xffffff);
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
      layer.destroy({ children: true, context: true });
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
    this.#tabAccents.clear();
    this.#galleryTitle = null;
    this.#sectionTitle = null;
    this.#progress = null;
    this.#closeControl = null;
    this.#headerDivider = null;
    this.#galleryLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  }

  #clearContent(): void {
    this.#lifecycle.release('gallery', 'listener', 'gallery');
    this.#galleryLayer.removeAllListeners();
    this.#galleryContent?.removeAllListeners();
    const content = this.#galleryContent;
    if (content?.parent) content.parent.removeChild(content);
    content?.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    content?.destroy({ children: false });
    this.#galleryContent = null;
    this.#scrollContent = null;
    this.#viewportMask = null;
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
