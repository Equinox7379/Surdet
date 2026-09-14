import {
  Container,
  Graphics,
  Sprite,
  Text as PText,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type {
  MenuProjectionPort,
  RendererFontRole,
  SaveLoadCommandOptions,
  SaveLoadSelectionHandler,
  SaveLoadSelectionResult,
} from '../../api/renderer-commands.js';
import type { MenuOverlayState } from '../../api/renderer-queries.js';
import { DEFAULT_PRESENTATION_PREFERENCES, presentationDuration, type PresentationPreferences } from '../../presentation.js';
import type { FrameRequestHandler } from '../../types.js';
import { RenderLifecycle } from '../../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import {
  formatSlotTime,
  type SaveLoadView,
  type SystemMenuItemView,
  type TitleView,
} from '../../ui-views.js';
import type { SettingsRowView } from '../../settings-store.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from '../../theme.js';
import { drawPlayerDivider, drawPlayerFrame } from '../../ui-decoration.js';
import { bindPlayerControl, markPlayerModal } from '../../player-controls.js';
import {
  bindThemeGraphicsProjection,
  bindThemeTextProjection,
  readThemeProjection,
  repaintThemeProjection,
  type LayerThemeProjectionSnapshot,
} from '../../theme-projection.js';

/** Menu-only rendering port. Cross-layer visibility decisions stay in the Facade. */
export interface MenuLayerOptions {
  readonly uiLayer: Container;
  readonly width: number;
  readonly height: number;
  readonly assets: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
  readonly presentation?: () => PresentationPreferences;
  readonly fontFamily?: (role: RendererFontRole) => string;
  readonly requestFrame?: () => void;
  readonly onPointerConsumed?: (() => void) | null;
}

/** Read-only evidence emitted for the local renderer acceptance harness. */
export interface MenuLayerDebugSnapshot {
  readonly overlay: MenuOverlayState;
  readonly titleItemCount: number;
  readonly systemMenuItemCount: number;
  readonly settingsRowCount: number;
  readonly saveLoadSlotCount: number;
}

interface MenuHandlers {
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
}

function isPromiseLike(value: SaveLoadSelectionResult): value is Promise<void | boolean> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

interface ThumbnailEntry {
  readonly texture: Texture;
  readonly dispose: () => void;
}

/**
 * Owns the title, ending, system-menu, settings, and save/load projections.
 * It deliberately has no persistence, profile, settings-store, or other Layer
 * dependency; callers provide already prepared view models and callbacks.
 */
export class MenuLayer implements MenuProjectionPort {
  readonly owner = 'menu' as const;

  readonly #root: Container;
  readonly #w: number;
  readonly #h: number;
  readonly #assets: RenderAssetRegistry;
  readonly #lifecycle: RenderLifecycle;
  readonly #ownsLifecycle: boolean;
  readonly #presentation: () => PresentationPreferences;
  readonly #fontFamily: (role: RendererFontRole) => string;
  readonly #requestFrameCallback?: () => void;
  readonly #onPointerConsumed: (() => void) | null;
  #frameRequest: FrameRequestHandler | null = null;
  #disposed = false;
  #theme: RendererTheme = DEFAULT_RENDERER_THEME;
  readonly #surfacePaints = new WeakMap<Graphics, () => void>();

  #titleLayer: Container;
  #titleHandler: ((id: string) => void) | null = null;
  #endingLayer: Container;
  #menuLayer: Container;
  #menuPanel: Container | null = null;
  #titleItemCount = 0;
  #systemMenuItemCount = 0;
  #menuMotionRemain = 0;
  #menuMotionDur = 260;
  #menuMotionOffset = 46;
  #menuHandlers: MenuHandlers | null = null;
  #settingsLayer: Container;
  #settingsRows: SettingsRowView[] = [];
  #settingsGroup = '阅读';
  #settingsPage = 0;
  #settingsHandlers: { onChange: (id: string, dir: -1 | 1) => void; onClose: () => void } | null = null;
  #saveLoadLayer: Container;
  #saveLoadHandlers: { onSelect: SaveLoadSelectionHandler; onClose: () => void } | null = null;
  #saveLoadOptions: SaveLoadCommandOptions = {};
  #saveLoadTransactionPending = false;
  #saveLoadMode: 'save' | 'load' | null = null;
  #saveLoadSlotCount = 0;
  #saveLoadNotice: PText | null = null;
  #saveLoadPage = 0;
  #confirmation: Container | null = null;
  #thumbCache = new Map<string, ThumbnailEntry>();

  constructor(options: MenuLayerOptions) {
    this.#root = options.uiLayer;
    this.#w = options.width;
    this.#h = options.height;
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#presentation = options.presentation ?? (() => DEFAULT_PRESENTATION_PREFERENCES);
    this.#fontFamily = options.fontFamily ?? ((role) => this.#assets.fontFamily(role));
    this.#requestFrameCallback = options.requestFrame;
    this.#onPointerConsumed = options.onPointerConsumed ?? null;

    this.#titleLayer = new Container();
    this.#endingLayer = new Container();
    this.#menuLayer = new Container();
    this.#settingsLayer = new Container();
    this.#saveLoadLayer = new Container();
    for (const layer of [this.#titleLayer, this.#endingLayer, this.#menuLayer, this.#settingsLayer, this.#saveLoadLayer]) {
      layer.visible = false;
    }
    this.#root.addChild(
      this.#titleLayer,
      this.#endingLayer,
      this.#menuLayer,
      this.#settingsLayer,
      this.#saveLoadLayer,
    );
    this.#registerDisplay('title-layer', this.#titleLayer);
    this.#registerDisplay('ending-layer', this.#endingLayer);
    this.#registerDisplay('system-menu-layer', this.#menuLayer);
    this.#registerDisplay('settings-layer', this.#settingsLayer);
    this.#registerDisplay('save-load-layer', this.#saveLoadLayer);
  }

  menu(): MenuOverlayState {
    if (this.#disposed) return { type: 'none' };
    for (let i = this.#root.children.length - 1; i >= 0; i--) {
      const layer = this.#root.children[i];
      if (layer === this.#titleLayer && layer.visible) return { type: 'title' };
      if (layer === this.#endingLayer && layer.visible) return { type: 'ending' };
      if (layer === this.#menuLayer && layer.visible) return { type: 'system-menu' };
      if (layer === this.#settingsLayer && layer.visible) return { type: 'settings' };
      if (layer === this.#saveLoadLayer && layer.visible && this.#saveLoadMode) {
        return { type: 'save-load', mode: this.#saveLoadMode };
      }
    }
    return { type: 'none' };
  }

  /**
   * Test-only read model. It reads the already projected menu data and never
   * creates display objects, registers resources, or requests a frame.
   */
  debugSnapshot(): MenuLayerDebugSnapshot {
    return {
      overlay: this.menu(),
      titleItemCount: this.#titleItemCount,
      systemMenuItemCount: this.#systemMenuItemCount,
      settingsRowCount: this.#settingsRows.length,
      saveLoadSlotCount: this.#saveLoadSlotCount,
    };
  }

  themeProjectionSnapshot(): LayerThemeProjectionSnapshot {
    return readThemeProjection(
      this.#titleLayer,
      this.#endingLayer,
      this.#menuLayer,
      this.#settingsLayer,
      this.#saveLoadLayer,
    );
  }

  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate) handler();
  }

  setTheme(theme: RendererTheme): void {
    if (this.#disposed) return;
    const previous = this.#theme;
    this.#theme = theme;
    repaintThemeProjection(
      this.#titleLayer,
      previous,
      theme,
    );
    repaintThemeProjection(this.#endingLayer, previous, theme);
    repaintThemeProjection(this.#menuLayer, previous, theme);
    repaintThemeProjection(this.#settingsLayer, previous, theme);
    repaintThemeProjection(this.#saveLoadLayer, previous, theme);
    const repaintSurface = (node: Container): void => {
      if (node instanceof Graphics) this.#surfacePaints.get(node)?.();
      for (const child of node.children) repaintSurface(child);
    };
    for (const layer of [this.#titleLayer, this.#endingLayer, this.#menuLayer, this.#settingsLayer, this.#saveLoadLayer]) repaintSurface(layer);
  }

  get needsUpdate(): boolean {
    return this.#menuMotionRemain > 0 && this.#menuLayer.visible;
  }

  update(deltaMs: number): void {
    if (this.#disposed || !this.needsUpdate) return;
    this.#menuMotionRemain = Math.max(0, this.#menuMotionRemain - deltaMs);
    const progress = 1 - this.#menuMotionRemain / this.#menuMotionDur;
    const eased = 1 - Math.pow(1 - progress, 3);
    this.#menuLayer.alpha = Math.min(1, progress / 0.72);
    if (this.#menuPanel) this.#menuPanel.x = this.#menuMotionOffset * (1 - eased);
    if (this.#menuMotionRemain === 0) {
      this.#menuLayer.alpha = 1;
      if (this.#menuPanel) this.#menuPanel.x = 0;
    }
  }

  showTitle(view: TitleView, onSelect: (id: string) => void): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#titleLayer, 'title');
    this.#titleHandler = onSelect;
    this.#titleItemCount = view.items.length;
    const layer = this.#titleLayer;
    markPlayerModal(layer, {});
    const titleTexture = this.#assets.resolveBackground(view.backgroundKey ?? 'title_bg');
    if (titleTexture) {
      const titleBg = new Sprite(titleTexture);
      const scale = Math.max(this.#w / Math.max(1, titleTexture.width), this.#h / Math.max(1, titleTexture.height));
      titleBg.width = titleTexture.width * scale;
      titleBg.height = titleTexture.height * scale;
      titleBg.position.set((this.#w - titleBg.width) / 2, (this.#h - titleBg.height) / 2);
      layer.addChild(titleBg);
      for (let index = 0; index < 64; index++) {
        const shade = new Graphics();
        const paint = (): void => {
          shade.clear().rect(index * this.#w / 64, 0, this.#w / 64, this.#h)
            .fill({ color: this.#theme.colors.canvas, alpha: this.#theme.opacity.scrim * Math.max(0.12, 1.25 - index / 48) });
          bindThemeGraphicsProjection(shade, ['canvas']);
        };
        this.#surfacePaints.set(shade, paint);
        paint();
        layer.addChild(shade);
      }
    } else {
      layer.addChild(this.#surface(0, 0, this.#w, this.#h, 'panel', 'panel'));
    }
    const title = bindThemeTextProjection(new PText({
      text: view.title,
      style: {
        fontSize: this.#theme.typography.titleSize,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        letterSpacing: this.#theme.typography.titleLetterSpacing,
        wordWrap: true, wordWrapWidth: this.#w * 0.60, breakWords: true,
        fontFamily: this.#fontFamily('title'),
      } satisfies TextStyleOptions,
    }), { fill: 'text', fontSize: 'titleSize', letterSpacing: 'titleLetterSpacing' });
    title.position.set(this.#w * 0.09, this.#h * 0.22);
    layer.addChild(title);
    const ruleY = title.y + (typeof document === 'undefined' ? this.#theme.typography.titleSize * 1.25 : title.height) + 24;
    layer.addChild(drawPlayerDivider(new Graphics(), this.#theme, title.x, ruleY, 332));
    if (view.subtitle) {
      const subtitle = bindThemeTextProjection(new PText({
        text: view.subtitle,
        style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted, letterSpacing: this.#theme.typography.uiLetterSpacing, fontFamily: this.#fontFamily('ui') } satisfies TextStyleOptions,
      }), { fill: 'textMuted', fontSize: 'captionSize', letterSpacing: 'uiLetterSpacing' });
      subtitle.position.set(title.x + 2, ruleY + 22);
      layer.addChild(subtitle);
    }
    const startY = Math.min(ruleY + 94, this.#h - view.items.length * 58 - 48);
    view.items.forEach((item, i) => {
      const enabled = item.enabled !== false;
      const rowY = startY + i * 58;
      const frame = drawPlayerFrame(new Graphics(), this.#theme, title.x, rowY, 332, 46,
        { alpha: 0.56, ornament: i === 0 });
      const label = bindThemeTextProjection(new PText({
        text: item.label,
        style: {
          fontSize: this.#theme.typography.uiSize,
          fill: enabled ? this.#theme.colors.text : this.#theme.colors.textDisabled,
          letterSpacing: this.#theme.typography.uiLetterSpacing,
          fontFamily: this.#fontFamily('ui'),
        } satisfies TextStyleOptions,
      }), { fill: enabled ? 'text' : 'textDisabled', fontSize: 'uiSize', letterSpacing: 'uiLetterSpacing' });
      label.anchor.set(0.5);
      label.position.set(title.x + 166, rowY + 23);
      frame.alpha = label.alpha = enabled ? 1 : this.#theme.opacity.disabled;
      bindPlayerControl(label, { label: item.label, width: 332, height: 46, x: -166, y: -23, enabled });
      if (enabled) {
        label.cursor = 'pointer';
        label.on('pointerdown', () => {
          this.#titleHandler?.(item.id);
        });
        label.on('pointerover', () => {
          drawPlayerFrame(frame, this.#theme, title.x, rowY, 332, 46, { color: 'surfaceStrong', alpha: 0.86, active: true, ornament: i === 0 });
          label.style.fill = this.#theme.colors.accent;
        });
        label.on('pointerout', () => {
          drawPlayerFrame(frame, this.#theme, title.x, rowY, 332, 46, { alpha: 0.56, ornament: i === 0 });
          label.style.fill = this.#theme.colors.text;
        });
      }
      layer.addChild(frame, label);
    });
    this.#bringToFront(layer);
    layer.visible = true;
    this.#registerListener('title', layer);
  }

  hideTitle(_restoreCommandRail = true): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#titleLayer, 'title');
    this.#titleLayer.visible = false;
    this.#titleHandler = null;
    this.#titleItemCount = 0;
  }

  showEnding(text = 'THE END'): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#endingLayer, 'ending');
    const label = bindThemeTextProjection(new PText({
      text,
      style: {
        fontSize: this.#theme.typography.headingSize,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        letterSpacing: this.#theme.typography.uiLetterSpacing,
        fontFamily: this.#fontFamily('title'),
      } satisfies TextStyleOptions,
    }), { fill: 'text', fontSize: 'headingSize', letterSpacing: 'uiLetterSpacing' });
    label.anchor.set(0.5);
    label.position.set(this.#w / 2, this.#h / 2);
    this.#endingLayer.addChild(bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill(this.#theme.colors.canvas),
      ['canvas'],
    ), label);
    this.#bringToFront(this.#endingLayer);
    this.#endingLayer.visible = true;
  }

  hideEnding(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#endingLayer, 'ending');
    this.#endingLayer.visible = false;
  }

  showSystemMenu(items: readonly SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#menuLayer, 'system-menu');
    this.#menuHandlers = { onSelect, onClose };
    this.#systemMenuItemCount = items.length;
    const layer = this.#menuLayer;
    markPlayerModal(layer, { close: () => {
      const handler = this.#menuHandlers?.onClose;
      this.hideSystemMenu();
      handler?.();
    } });
    layer.alpha = 0;
    const bg = this.#surface(0, 0, this.#w, this.#h, 'scrim', 'scrim');
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      const handler = this.#menuHandlers?.onClose;
      this.hideSystemMenu();
      handler?.();
    });
    layer.addChild(bg);

    const panel = new Container();
    const px = this.#w - 398;
    const py = 34;
    const pw = 348;
    const headerH = 94;
    const rowH = 54;
    const panelH = headerH + items.length * rowH + 28;
    panel.position.set(this.#menuMotionOffset, 0);
    this.#menuPanel = panel;
    panel.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(px + 10, py + 12, pw, panelH, 6)
      .fill({ color: this.#theme.colors.canvas, alpha: 0.28 }), ['canvas']));
    panel.addChild(this.#surface(px, py, pw, panelH, 'panel', 'panel', 'md', true));
    panel.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(px + 28, py + headerH - 1, pw - 54, 1)
      .fill({ color: this.#theme.colors.line, alpha: 0.32 }), ['line']));
    panel.addChild(bindThemeTextProjection(new PText({
      text: '暂停阅读',
      style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.accentSoft, letterSpacing: this.#theme.typography.uiLetterSpacing, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'accentSoft', fontSize: 'captionSize', letterSpacing: 'uiLetterSpacing' })).position.set(px + 28, py + 19);
    panel.addChild(bindThemeTextProjection(new PText({
      text: '菜单',
      style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text', fontSize: 'headingSize' })).position.set(px + 27, py + 42);

    items.forEach((item, i) => {
      const row = new Container();
      const rowY = py + headerH + i * rowH;
      row.position.set(px + 16, rowY);
      const hover = bindThemeGraphicsProjection(new Graphics()
        .roundRect(0, 4, pw - 32, rowH - 8, 3)
        // Transparent interaction geometry is a fixed hit-area color, not a theme token.
        .fill({ color: 0x173149, alpha: 0 }), [null]);
      const marker = bindThemeGraphicsProjection(new Graphics()
        .roundRect(0, 4, pw - 32, rowH - 8, this.#theme.radius.sm)
        .stroke({ width: 1.5, color: this.#theme.colors.accentSoft, alpha: 0.9 }), ['accentSoft']);
      marker.alpha = 0;
      const index = bindThemeTextProjection(new PText({
        text: '◇',
        style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted, letterSpacing: 1 } satisfies TextStyleOptions,
      }), { fill: 'textMuted', fontSize: 'captionSize' });
      index.position.set(22, 19);
      const label = bindThemeTextProjection(new PText({
        text: item.label,
        style: { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text, fontWeight: 'normal' } satisfies TextStyleOptions,
      }), { fill: 'text', fontSize: 'uiSize' });
      label.position.set(62, 14);
      row.addChild(hover, marker, index, label);
      bindPlayerControl(row, { label: item.label, width: pw - 32, height: rowH - 8, y: 4 });
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointerover', () => {
        hover.alpha = 1;
        marker.alpha = 1;
        label.style = { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions;
      });
      row.on('pointerout', () => {
        hover.alpha = 0;
        marker.alpha = 0;
        label.style = { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text, fontWeight: 'normal' } satisfies TextStyleOptions;
      });
      row.on('pointerdown', () => {
        const handler = this.#menuHandlers?.onSelect;
        this.hideSystemMenu();
        handler?.(item.id);
      });
      panel.addChild(row);
    });
    layer.addChild(panel);
    this.#bringToFront(layer);
    layer.visible = true;
    this.#menuMotionDur = presentationDuration(260, this.#presentation());
    this.#menuMotionRemain = this.#menuMotionDur;
    this.#registerListener('system-menu', layer);
  }

  hideSystemMenu(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#menuLayer, 'system-menu');
    this.#menuLayer.visible = false;
    this.#menuLayer.alpha = 1;
    this.#menuPanel = null;
    this.#menuHandlers = null;
    this.#systemMenuItemCount = 0;
    this.#menuMotionRemain = 0;
  }

  showSettings(rows: readonly SettingsRowView[], onChange: (id: string, dir: -1 | 1) => void, onClose: () => void): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#settingsLayer, 'settings');
    this.#settingsRows = rows.map((row) => ({ ...row }));
    this.#settingsHandlers = { onChange, onClose };
    const layer = this.#settingsLayer;
    const closeSettings = (): void => { const handler = this.#settingsHandlers?.onClose; this.hideSettings(); handler?.(); };
    const groups = [
      { label: '阅读', rows: this.#settingsRows.filter((row) => /^(textSpeedCps|autoBaseDelayMs|autoPerCharMs|skipStrategy)$/.test(row.id)) },
      { label: '声音', rows: this.#settingsRows.filter((row) => /Volume$/.test(row.id)) },
      { label: '显示与输入', rows: this.#settingsRows.filter((row) => !/^(textSpeedCps|autoBaseDelayMs|autoPerCharMs|skipStrategy)$|Volume$/.test(row.id)) },
    ].filter((group) => group.rows.length > 0);
    const group = groups.find((item) => item.label === this.#settingsGroup) ?? groups[0];
    this.#settingsGroup = group?.label ?? '阅读';
    const pageSize = 6;
    const pageCount = Math.max(1, Math.ceil((group?.rows.length ?? 0) / pageSize));
    this.#settingsPage = Math.min(this.#settingsPage, pageCount - 1);
    const shownRows = group?.rows.slice(this.#settingsPage * pageSize, (this.#settingsPage + 1) * pageSize) ?? [];
    const changePage = (direction: number): void => {
      this.#settingsPage = Math.max(0, Math.min(pageCount - 1, this.#settingsPage + direction));
      this.showSettings(rows, onChange, onClose);
    };
    markPlayerModal(layer, { close: closeSettings, scroll: (delta) => { if (delta) changePage(Math.sign(delta)); } });
    const bg = this.#surface(0, 0, this.#w, this.#h, 'scrim', 'scrim');
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      const handler = this.#settingsHandlers?.onClose;
      this.hideSettings();
      handler?.();
    });
    layer.addChild(bg);

    const px = 240;
    const py = 54;
    const pw = 800;
    const headerH = 150;
    const rowH = Math.max(62, this.#theme.typography.uiSize * 2 + 18);
    const panelH = Math.min(this.#h - py * 2, headerH + shownRows.length * rowH + 72);
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(px + 10, py + 12, pw, panelH, 6)
      .fill({ color: this.#theme.colors.canvas, alpha: 0.28 }), ['canvas']));
    layer.addChild(this.#surface(px, py, pw, panelH, 'panel', 'panel', 'md', true));
    layer.addChild(bindThemeTextProjection(new PText({
      text: '即时生效',
      style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.accentSoft, letterSpacing: this.#theme.typography.uiLetterSpacing, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'accentSoft', fontSize: 'captionSize', letterSpacing: 'uiLetterSpacing' })).position.set(px + 30, py + 20);
    layer.addChild(bindThemeTextProjection(new PText({
      text: '设置',
      style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text', fontSize: 'headingSize' })).position.set(px + 28, py + 44);
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(px + 28, py + headerH - 1, pw - 56, 1)
      .fill({ color: this.#theme.colors.line, alpha: 0.32 }), ['line']));
    const close = bindThemeTextProjection(new PText({ text: '×', style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }), { fill: 'textMuted', fontSize: 'headingSize' });
    close.position.set(px + pw - 52, py + 26);
    bindPlayerControl(close, { label: '关闭设置', width: 48, height: 48, x: -10, y: -8 });
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerover', () => { close.style = { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
    close.on('pointerout', () => { close.style = { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions; });
    close.on('pointerdown', () => {
      const handler = this.#settingsHandlers?.onClose;
      this.hideSettings();
      handler?.();
    });
    layer.addChild(close);

    groups.forEach((item, index) => {
      const tab = new PText({ text: item.label, style: { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.textMuted, fontFamily: this.#fontFamily('ui') } });
      tab.position.set(px + 32 + index * 190, py + 102);
      bindThemeTextProjection(tab, { fill: 'textMuted', fontSize: 'uiSize' });
      bindPlayerControl(tab, { label: `${item.label}设置`, width: 170, height: 40, x: -8, y: -6 });
      if (item === group) {
        layer.addChild(bindThemeGraphicsProjection(new Graphics().roundRect(tab.x - 8, tab.y - 6, 170, 40, this.#theme.radius.sm)
          .stroke({ width: 1.5, color: this.#theme.colors.accent }), ['accent']));
      }
      tab.on('pointerdown', () => { this.#settingsGroup = item.label; this.#settingsPage = 0; this.showSettings(rows, onChange, onClose); });
      layer.addChild(tab);
    });
    shownRows.forEach((row, i) => {
      const y = py + headerH + i * rowH;
      layer.addChild(bindThemeGraphicsProjection(new Graphics()
        .rect(px + 28, y + rowH - 1, pw - 56, 1)
        .fill({ color: this.#theme.colors.line, alpha: i === this.#settingsRows.length - 1 ? 0.18 : 0.26 }), ['line']));
      layer.addChild(bindThemeTextProjection(new PText({
        text: row.label,
        style: { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text } satisfies TextStyleOptions,
      }), { fill: 'text', fontSize: 'uiSize' })).position.set(px + 32, y + 16);
      const controls = new Container();
      controls.position.set(px + pw - 300, y + 9);
      const value = bindThemeTextProjection(new PText({
        text: row.display,
        style: { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
      }), { fill: 'text', fontSize: 'uiSize' });
      value.anchor.set(0.5, 0);
      value.position.set(150, 7);
      const left = bindThemeTextProjection(new PText({ text: '‹', style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions }), { fill: 'accentSoft', fontSize: 'headingSize' });
      left.position.set(52, -3);
      const right = bindThemeTextProjection(new PText({ text: '›', style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions }), { fill: 'accentSoft', fontSize: 'headingSize' });
      right.position.set(230, -3);
      bindPlayerControl(left, { label: `减小${row.label}`, width: 48, height: 48, x: -12, y: 0, adjust: (dir) => this.#settingsHandlers?.onChange(row.id, dir) });
      bindPlayerControl(right, { label: `增大${row.label}`, width: 48, height: 48, x: -12, y: 0, adjust: (dir) => this.#settingsHandlers?.onChange(row.id, dir) });
      for (const control of [left, right]) {
        control.eventMode = 'static';
        control.cursor = 'pointer';
        control.on('pointerover', () => { control.style = { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
        control.on('pointerout', () => { control.style = { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions; });
      }
      left.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, -1));
      right.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, 1));
      controls.addChild(left, value, right);
      layer.addChild(controls);
    });
    if (pageCount > 1) {
      const pager = new PText({ text: `${this.#settingsPage + 1} / ${pageCount}　下一页`, style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.text } });
      pager.position.set(px + pw - 230, py + panelH - 48);
      bindThemeTextProjection(pager, { fill: 'text', fontSize: 'captionSize' });
      bindPlayerControl(pager, { label: '下一页设置', width: 200, height: 40 });
      pager.on('pointerdown', () => changePage(this.#settingsPage + 1 < pageCount ? 1 : -this.#settingsPage));
      layer.addChild(pager);
    }
    this.#bringToFront(layer);
    layer.visible = true;
    this.#registerListener('settings', layer);
  }

  hideSettings(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#settingsLayer, 'settings');
    this.#settingsLayer.visible = false;
    this.#settingsHandlers = null;
    this.#settingsRows = [];
    this.#settingsPage = 0;
  }

  showSaveLoad(
    view: SaveLoadView,
    onSelect: SaveLoadSelectionHandler,
    onClose: () => void,
    options: SaveLoadCommandOptions = {},
  ): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#saveLoadLayer, 'save-load');
    this.#saveLoadNotice = null;
    this.#saveLoadHandlers = { onSelect, onClose };
    this.#saveLoadOptions = options;
    this.#saveLoadMode = view.mode;
    this.#saveLoadSlotCount = view.slots.length;
    const layer = this.#saveLoadLayer;
    const closeSaveLoad = (): void => {
      if (this.#saveLoadTransactionPending) return;
      const handler = this.#saveLoadHandlers?.onClose;
      this.hideSaveLoad();
      handler?.();
    };
    const pageCount = Math.max(1, Math.ceil(view.slots.length / 6));
    this.#saveLoadPage = Math.min(this.#saveLoadPage, pageCount - 1);
    const changePage = (direction: number): void => {
      if (this.#saveLoadTransactionPending) return;
      this.#saveLoadPage = Math.max(0, Math.min(pageCount - 1, this.#saveLoadPage + direction));
      this.showSaveLoad(view, onSelect, onClose, options);
    };
    markPlayerModal(layer, { close: closeSaveLoad, scroll: (delta) => { if (delta) changePage(Math.sign(delta)); } });
    const bg = this.#surface(0, 0, this.#w, this.#h, 'scrim', 'scrim');
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      if (this.#saveLoadTransactionPending) {
        this.#onPointerConsumed?.();
        return;
      }
      const handler = this.#saveLoadHandlers?.onClose;
      this.hideSaveLoad();
      handler?.();
    });
    layer.addChild(bg);
    layer.addChild(this.#surface(20, 20, this.#w - 40, this.#h - 40, 'panel', 'panel', 'md', true));
    layer.addChild(bindThemeTextProjection(new PText({
      text: view.mode === 'save' ? 'SAVE DATA' : 'LOAD DATA',
      style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.accentSoft, letterSpacing: this.#theme.typography.uiLetterSpacing, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'accentSoft', fontSize: 'captionSize', letterSpacing: 'uiLetterSpacing' })).position.set(108, 70);
    layer.addChild(bindThemeTextProjection(new PText({
      text: view.mode === 'save' ? '存档' : '读档',
      style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text', fontSize: 'headingSize' })).position.set(106, 91);
    layer.addChild(bindThemeTextProjection(new PText({
      text: view.mode === 'save' ? '选择槽位，记录当前剧情进度' : '选择记录，继续阅读',
      style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions,
    }), { fill: 'textMuted', fontSize: 'captionSize' })).position.set(255, 110);
    const close = bindThemeTextProjection(new PText({ text: '×', style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }), { fill: 'textMuted', fontSize: 'headingSize' });
    close.position.set(this.#w - 106, 76);
    bindPlayerControl(close, { label: '关闭存读档', width: 48, height: 48, x: -10, y: -8 });
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerover', () => { close.style = { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
    close.on('pointerout', () => { close.style = { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions; });
    close.on('pointerdown', () => {
      if (this.#saveLoadTransactionPending) {
        this.#onPointerConsumed?.();
        return;
      }
      const handler = this.#saveLoadHandlers?.onClose;
      this.hideSaveLoad();
      handler?.();
    });
    layer.addChild(close);

    this.#saveLoadNotice = bindThemeTextProjection(new PText({ text: '', style: {
      fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted,
      wordWrap: true, breakWords: true, wordWrapWidth: this.#w - 540,
    } }), { fill: 'textMuted', fontSize: 'captionSize' });
    this.#saveLoadNotice.position.set(420, 76);
    layer.addChild(this.#saveLoadNotice);

    const cols = 2;
    const cardW = (this.#w - 180 - 22) / cols;
    const cardH = 144;
    const gapX = 22;
    const gapY = 16;
    const startX = 90;
    const startY = 160;
    view.slots.slice(this.#saveLoadPage * 6, (this.#saveLoadPage + 1) * 6).forEach((slot, i) => {
      const x = startX + (i % cols) * (cardW + gapX);
      const y = startY + Math.floor(i / cols) * (cardH + gapY);
      const selectable = view.mode === 'save' || !slot.empty;
      const card = new Container();
      card.position.set(x, y);
      const surface = this.#surface(0, 0, cardW, cardH, selectable ? 'surfaceStrong' : 'panel', 'surface', 'md', true);
      const hover = bindThemeGraphicsProjection(new Graphics()
        .roundRect(0, 0, cardW, cardH, 4)
        // Transparent interaction geometry is a fixed hit-area color, not a theme token.
        .fill({ color: 0x173149, alpha: 0 }), [null]);
      const marker = bindThemeGraphicsProjection(new Graphics()
        .roundRect(1, 1, cardW - 2, cardH - 2, this.#theme.radius.md)
        .stroke({ width: 2, color: this.#theme.colors.accentSoft, alpha: 0.95 }), ['accentSoft']);
      marker.alpha = 0;
      card.addChild(surface, hover, marker);
      let textX = 28;
      if (slot.thumbnail) {
        const texture = this.#thumbTexture(slot.thumbnail);
        const thumb = new Sprite(texture);
        const sizeThumbnail = () => { thumb.width = 128; thumb.height = 72; };
        sizeThumbnail();
        texture.on('update', sizeThumbnail);
        thumb.once('destroyed', () => texture.off('update', sizeThumbnail));
        thumb.position.set(18, 16);
        card.addChild(thumb);
        textX = 166;
      }
      card.addChild(bindThemeTextProjection(new PText({
        text: String(this.#saveLoadPage * 6 + i + 1).padStart(2, '0'),
        style: { fontSize: this.#theme.typography.captionSize, fill: selectable ? this.#theme.colors.accentSoft : this.#theme.colors.textDisabled, letterSpacing: 1 } satisfies TextStyleOptions,
      }), { fill: selectable ? 'accentSoft' : 'textDisabled', fontSize: 'captionSize' })).position.set(textX, 14);
      const kindLabel = slot.kind === 'auto' ? '自动' : slot.kind === 'quick' ? '快速' : '手动';
      card.addChild(bindThemeTextProjection(new PText({
        text: slot.empty ? '空槽位' : (slot.label ?? '未命名场景'),
        style: { fontSize: this.#theme.typography.uiSize, fill: selectable ? this.#theme.colors.text : this.#theme.colors.textDisabled, fontWeight: 'bold', wordWrap: true, breakWords: true, wordWrapWidth: cardW - textX - 20 } satisfies TextStyleOptions,
      }), { fill: selectable ? 'text' : 'textDisabled', fontSize: 'uiSize' })).position.set(textX, 34);
      if (!slot.empty) {
        const playtime = slot.playTimeSec !== undefined && slot.playTimeSec > 0
          ? ` · ${Math.floor(slot.playTimeSec / 60)}分钟`
          : '';
        card.addChild(bindThemeTextProjection(new PText({
          text: `${kindLabel}　${formatSlotTime(slot.updatedAt) || '时间未提供'}${playtime}`,
          style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions,
        }), { fill: 'textMuted', fontSize: 'captionSize' })).position.set(textX, 112);
      } else {
        card.addChild(bindThemeTextProjection(new PText({
          text: `${kindLabel}　等待记录`,
          style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textDisabled } satisfies TextStyleOptions,
        }), { fill: 'textDisabled', fontSize: 'captionSize' })).position.set(textX, 112);
      }
      if (view.mode === 'load' && slot.backupAvailable) {
        let restoreConfirmed = false;
        const restore = bindThemeTextProjection(new PText({
          text: '恢复备份并读取',
          style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.accentSoft, fontWeight: 'bold' } satisfies TextStyleOptions,
        }), { fill: 'accentSoft', fontSize: 'captionSize' });
        restore.position.set(cardW - 210, 80);
        bindPlayerControl(restore, { label: `恢复槽位 ${slot.id} 的备份并读取`, width: 204, height: 34, x: -4, y: -4 });
        restore.eventMode = 'static';
        restore.cursor = 'pointer';
        restore.on('pointerover', () => { restore.style = { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
        restore.on('pointerout', () => { restore.style = { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.accentSoft, fontWeight: 'bold' } satisfies TextStyleOptions; });
        restore.on('pointerdown', (event) => {
          event.stopPropagation?.();
          if (this.#saveLoadTransactionPending) { this.#onPointerConsumed?.(); return; }
          if (!restoreConfirmed) {
            this.#confirmAction(layer, `恢复槽位 ${slot.id} 的备份并读取？当前进度将被替换。`, '恢复并读取', () => {
              restoreConfirmed = true;
              try { restore.emit('pointerdown', event); } finally { restoreConfirmed = false; }
            });
            return;
          }
          const handler = this.#saveLoadOptions.onRestore;
          if (this.#saveLoadOptions.completion === 'host-transaction') {
            if (this.#saveLoadTransactionPending) {
              this.#onPointerConsumed?.();
              return;
            }
            this.#saveLoadTransactionPending = true;
            this.#saveLoadMessage('正在恢复并读取…');
            const onTransactionComplete = this.#saveLoadOptions.onTransactionComplete;
            const onTransactionError = this.#saveLoadOptions.onTransactionError;
            try {
              const accepted = handler?.(slot.id);
              if (!isPromiseLike(accepted)) throw new Error('host-transaction save/load handlers must return a Promise');
              void Promise.resolve(accepted).then(
                (result) => {
                  this.#saveLoadTransactionPending = false;
                  if (result !== false) {
                    this.hideSaveLoad();
                    onTransactionComplete?.();
                  } else this.#saveLoadMessage('读取未完成，可重试或返回。');
                },
                (error) => {
                  this.#saveLoadTransactionPending = false;
                  this.#handleSaveLoadTransactionError(error, onTransactionError);
                },
              );
            } catch (error) {
              this.#saveLoadTransactionPending = false;
              this.#handleSaveLoadTransactionError(error, onTransactionError);
            }
          } else {
            try {
              const accepted = handler?.(slot.id);
              if (accepted !== false) this.hideSaveLoad();
            } catch (error) {
              this.hideSaveLoad();
              throw error;
            }
          }
        });
        card.addChild(restore);
      }
      if (selectable) {
        let overwriteConfirmed = false;
        bindPlayerControl(card, { label: `${view.mode === 'save' ? '保存到' : '读取'}槽位 ${slot.id}：${slot.empty ? '空槽位' : (slot.label ?? '场景未提供')}`, width: cardW, height: cardH });
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointerover', () => {
          hover.alpha = 1;
          marker.alpha = 1;
        });
        card.on('pointerout', () => {
          hover.alpha = 0;
          marker.alpha = 0;
        });
        card.on('pointerdown', (event) => {
          if (this.#saveLoadTransactionPending) { this.#onPointerConsumed?.(); event.stopPropagation?.(); return; }
          if (view.mode === 'save' && !slot.empty && !overwriteConfirmed) {
            event.stopPropagation?.();
            this.#confirmAction(layer, `覆盖槽位 ${slot.id} 的现有存档？`, '覆盖存档', () => {
              overwriteConfirmed = true;
              try { card.emit('pointerdown', event); } finally { overwriteConfirmed = false; }
            });
            return;
          }
          const handler = this.#saveLoadHandlers?.onSelect;
          if (this.#saveLoadOptions.completion === 'host-transaction') {
          if (this.#saveLoadTransactionPending) {
              this.#onPointerConsumed?.();
              event.stopPropagation?.();
              return;
            }
            this.#saveLoadTransactionPending = true;
            this.#saveLoadMessage(view.mode === 'save' ? '正在保存…' : '正在读取…');
            const onTransactionComplete = this.#saveLoadOptions.onTransactionComplete;
            const onTransactionError = this.#saveLoadOptions.onTransactionError;
            try {
              const accepted = handler?.(slot.id);
              if (!isPromiseLike(accepted)) {
                throw new Error('host-transaction save/load handlers must return a Promise');
              }
              void Promise.resolve(accepted).then(
                (result) => {
                  this.#saveLoadTransactionPending = false;
                  if (result !== false) {
                    this.hideSaveLoad();
                    onTransactionComplete?.();
                  } else this.#saveLoadMessage(view.mode === 'save' ? '存档未完成，可重试或返回。' : '读取未完成，可重试或返回。');
                },
                (error) => {
                  this.#saveLoadTransactionPending = false;
                  this.#handleSaveLoadTransactionError(error, onTransactionError);
                },
              );
            } catch (error) {
              this.#saveLoadTransactionPending = false;
              this.#handleSaveLoadTransactionError(error, onTransactionError);
            }
            return;
          }
          try {
            const accepted = handler?.(slot.id);
            if (accepted !== false) this.hideSaveLoad();
          } catch (error) {
            this.hideSaveLoad();
            throw error;
          }
        });
      } else {
        bindPlayerControl(card, { label: `槽位 ${slot.id}：空槽位`, width: cardW, height: cardH, enabled: false });
        // Empty load slots are real hit targets so their click cannot fall
        // through to the full-screen close surface. They intentionally do
        // not have an onSelect handler: the event is consumed and is a no-op.
        card.eventMode = 'static';
        card.on('pointerdown', (event) => {
          this.#onPointerConsumed?.();
          event.stopPropagation?.();
        });
      }
      layer.addChild(card);
    });
    if (pageCount > 1) {
      for (const [label, direction, x] of [['上一页', -1, 90], ['下一页', 1, this.#w - 210]] as const) {
        const pager = bindThemeTextProjection(new PText({ text: label, style: { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text } }), { fill: 'text', fontSize: 'uiSize' });
        pager.position.set(x, this.#h - 54);
        const enabled = direction < 0 ? this.#saveLoadPage > 0 : this.#saveLoadPage + 1 < pageCount;
        bindPlayerControl(pager, { label: `${label}存档`, width: 120, height: 40, enabled });
        pager.alpha = enabled ? 1 : this.#theme.opacity.disabled;
        pager.on('pointerdown', () => { if (enabled) changePage(direction); });
        layer.addChild(pager);
      }
      layer.addChild(bindThemeTextProjection(new PText({ text: `${this.#saveLoadPage + 1} / ${pageCount}`, style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted } }), { fill: 'textMuted', fontSize: 'captionSize' })).position.set(this.#w / 2 - 24, this.#h - 50);
    }
    this.#bringToFront(layer);
    layer.visible = true;
    this.#registerListener('save-load', layer);
  }

  hideSaveLoad(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#clearLayer(this.#saveLoadLayer, 'save-load');
    this.#saveLoadLayer.visible = false;
    this.#saveLoadHandlers = null;
    this.#saveLoadOptions = {};
    this.#saveLoadTransactionPending = false;
    this.#saveLoadMode = null;
    this.#saveLoadSlotCount = 0;
  }

  reset(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.hideTitle(false);
    this.hideEnding();
    this.hideSystemMenu();
    this.hideSettings();
    this.hideSaveLoad();
    this.#clearThumbnailCache();
    this.#menuMotionRemain = 0;
    this.#settingsRows = [];
    this.#titleItemCount = 0;
    this.#systemMenuItemCount = 0;
    this.#saveLoadSlotCount = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#frameRequest = null;
    this.#clearLayer(this.#titleLayer, 'title');
    this.#clearLayer(this.#endingLayer, 'ending');
    this.#clearLayer(this.#menuLayer, 'system-menu');
    this.#clearLayer(this.#settingsLayer, 'settings');
    this.#clearLayer(this.#saveLoadLayer, 'save-load');
    this.#clearThumbnailCache();
    this.#menuPanel = null;
    this.#menuHandlers = null;
    this.#settingsHandlers = null;
    this.#saveLoadHandlers = null;
    this.#saveLoadOptions = {};
    this.#saveLoadTransactionPending = false;
    this.#saveLoadMode = null;
    this.#titleItemCount = 0;
    this.#systemMenuItemCount = 0;
    this.#saveLoadSlotCount = 0;
    try {
      this.#lifecycle.releaseOwner('menu');
    } finally {
      for (const layer of [this.#titleLayer, this.#endingLayer, this.#menuLayer, this.#settingsLayer, this.#saveLoadLayer]) {
        if (layer.parent) layer.parent.removeChild(layer);
      }
      if (this.#ownsLifecycle) this.#lifecycle.dispose();
    }
  }

  #confirmAction(parent: Container, message: string, actionLabel: string, action: () => void): void {
    if (this.#saveLoadTransactionPending || !parent.visible || (this.#confirmation && !this.#confirmation.destroyed)) return;
    const panel = new Container();
    this.#confirmation = panel;
    const close = (): void => { this.#confirmation = null; parent.removeChild(panel); panel.destroy({ children: true }); this.#requestFrame(); };
    markPlayerModal(panel, { close });
    panel.addChild(this.#surface(0, 0, this.#w, this.#h, 'scrim', 'scrim'));
    panel.eventMode = 'static';
    panel.on('pointerdown', (event) => { this.#onPointerConsumed?.(); event.stopPropagation?.(); });
    const x = (this.#w - 600) / 2;
    const y = (this.#h - 230) / 2;
    panel.addChild(this.#surface(x, y, 600, 230, 'panel', 'panel', 'md', true));
    panel.addChild(bindThemeTextProjection(new PText({ text: message, style: { fontSize: this.#theme.typography.bodySize, fill: this.#theme.colors.text, wordWrap: true, wordWrapWidth: 536, breakWords: true } }), { fill: 'text', fontSize: 'bodySize' })).position.set(x + 32, y + 32);
    for (const [label, index, activate] of [['取消', 0, close], [actionLabel, 1, () => { close(); action(); }]] as const) {
      const button = new Container();
      button.position.set(x + 32 + index * 280, y + 158);
      const border = bindThemeGraphicsProjection(new Graphics().roundRect(0, 0, 256, 48, this.#theme.radius.sm)
        .stroke({ width: 1.5, color: this.#theme.colors.line }), ['line']);
      const text = bindThemeTextProjection(new PText({ text: label, style: { fontSize: this.#theme.typography.uiSize, fill: index === 1 ? this.#theme.colors.danger : this.#theme.colors.text } }), { fill: index === 1 ? 'danger' : 'text', fontSize: 'uiSize' });
      text.anchor.set(0.5); text.position.set(128, 24);
      button.addChild(border, text);
      bindPlayerControl(button, { label, width: 256, height: 48 });
      button.on('pointerover', () => { border.alpha = 1; this.#requestFrame(); });
      button.on('pointerout', () => { border.alpha = 0.5; this.#requestFrame(); });
      button.on('pointerdown', (event) => { event.stopPropagation?.(); activate(); });
      panel.addChild(button);
    }
    parent.addChild(panel);
    this.#requestFrame();
  }

  #surface(x: number, y: number, width: number, height: number, color: keyof RendererTheme['colors'], opacity: keyof RendererTheme['opacity'], radius?: keyof RendererTheme['radius'], border = false): Graphics {
    const graphic = bindThemeGraphicsProjection(new Graphics(), border ? [color, 'line'] : [color]);
    const paint = (): void => {
      if (border) {
        drawPlayerFrame(graphic, this.#theme, x, y, width, height,
          { color, alpha: this.#theme.opacity[opacity], ornament: height > 120 });
        return;
      }
      graphic.clear();
      if (radius) graphic.roundRect(x, y, width, height, this.#theme.radius[radius]);
      else graphic.rect(x, y, width, height);
      graphic.fill({ color: this.#theme.colors[color], alpha: this.#theme.opacity[opacity] });
    };
    this.#surfacePaints.set(graphic, paint);
    paint();
    return graphic;
  }

  #saveLoadMessage(message: string): void {
    if (!this.#saveLoadNotice || this.#saveLoadNotice.destroyed) return;
    this.#saveLoadNotice.text = message;
    this.#requestFrame();
  }

  #handleSaveLoadTransactionError(error: unknown, report = this.#saveLoadOptions.onTransactionError): void {
    this.#saveLoadMessage(this.#saveLoadMode === 'save' ? '存档失败，可重试或返回。' : '读取失败，可重试或返回。');
    if (report) {
      report(error);
      return;
    }
    // Do not silently consume a rejected transaction.  Without an explicit
    // host error boundary, rethrow on the microtask so the shell reports it.
    queueMicrotask(() => { throw error; });
  }

  #registerDisplay(key: string, layer: Container): void {
    this.#lifecycle.register('menu', 'display', key, () => {
      if (layer.parent) layer.parent.removeChild(layer);
      layer.destroy({ children: true });
    });
  }

  #registerListener(key: string, layer: Container): void {
    this.#lifecycle.release('menu', 'listener', key);
    this.#lifecycle.register('menu', 'listener', key, () => layer.removeAllListeners());
  }

  #clearLayer(layer: Container, listenerKey: string): void {
    this.#lifecycle.release('menu', 'listener', listenerKey);
    layer.removeAllListeners();
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  #bringToFront(layer: Container): void {
    const index = this.#root.children.length - 1;
    if (index >= 0 && this.#root.getChildIndex(layer) !== index) this.#root.setChildIndex(layer, index);
  }

  #thumbTexture(url: string): Texture {
    const hit = this.#thumbCache.get(url);
    if (hit) {
      this.#thumbCache.delete(url);
      this.#thumbCache.set(url, hit);
      return hit.texture;
    }

    // Pixi v8 treats a string passed to Texture.from() as an already cached
    // asset id. Save thumbnails are raw data URLs, not Assets-cache entries;
    // calling Texture.from(dataUrl) therefore returns undefined and leaves a
    // disposer that fails later during reset/release. Create an owned image
    // texture for data URLs, while retaining the cache-owned path for normal
    // asset ids. The non-DOM test/runtime fallback uses the shared white
    // texture and deliberately does not destroy it.
    let entry: ThumbnailEntry;
    if (url.startsWith('data:')) {
      if (typeof Image !== 'undefined') {
        const image = new Image();
        const texture = Texture.from(image);
        texture.dynamic = true;
        image.onload = () => {
          texture.source.update();
          texture.update();
          this.#requestFrame();
        };
        image.src = url;
        entry = { texture, dispose: () => { image.onload = null; image.onerror = null; texture.destroy(true); } };
      } else {
        entry = { texture: Texture.WHITE, dispose: () => undefined };
      }
    } else {
      const cached = Texture.from(url) as Texture | undefined;
      if (cached) {
        entry = { texture: cached, dispose: () => undefined };
      } else {
        entry = { texture: Texture.WHITE, dispose: () => undefined };
      }
    }
    this.#thumbCache.set(url, entry);
    this.#lifecycle.register('menu', 'pool', `thumbnail:${url}`, entry.dispose);
    if (this.#thumbCache.size > 16) {
      const oldest = this.#thumbCache.keys().next().value;
      if (oldest !== undefined) {
        this.#thumbCache.delete(oldest);
        this.#lifecycle.release('menu', 'pool', `thumbnail:${oldest}`);
      }
    }
    return entry.texture;
  }

  #clearThumbnailCache(): void {
    const urls = [...this.#thumbCache.keys()];
    this.#thumbCache.clear();
    for (const url of urls) this.#lifecycle.release('menu', 'pool', `thumbnail:${url}`);
  }

  #requestFrame(): void {
    this.#requestFrameCallback?.();
  }
}
