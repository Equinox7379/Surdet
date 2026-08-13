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
  #settingsHandlers: { onChange: (id: string, dir: -1 | 1) => void; onClose: () => void } | null = null;
  #saveLoadLayer: Container;
  #saveLoadHandlers: { onSelect: SaveLoadSelectionHandler; onClose: () => void } | null = null;
  #saveLoadOptions: SaveLoadCommandOptions = {};
  #saveLoadTransactionPending = false;
  #saveLoadMode: 'save' | 'load' | null = null;
  #saveLoadSlotCount = 0;
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
    const titleTexture = this.#assets.resolveBackground(view.backgroundKey ?? 'title_bg');
    if (titleTexture) {
      const titleBg = new Sprite(titleTexture);
      const scale = Math.max(this.#w / Math.max(1, titleTexture.width), this.#h / Math.max(1, titleTexture.height));
      titleBg.width = titleTexture.width * scale;
      titleBg.height = titleTexture.height * scale;
      titleBg.position.set((this.#w - titleBg.width) / 2, (this.#h - titleBg.height) / 2);
      layer.addChild(titleBg);
      layer.addChild(bindThemeGraphicsProjection(
        new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.canvas, alpha: 0.48 }),
        ['canvas'],
      ));
    } else {
      layer.addChild(bindThemeGraphicsProjection(
        new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.97 }),
        ['panel'],
      ));
    }
    const vignette = new Graphics();
    for (let i = 1; i <= 5; i++) {
      vignette.ellipse(this.#w / 2, this.#h / 2, this.#w * (0.42 + i * 0.16), this.#h * (0.4 + i * 0.17))
        .stroke({ width: 60, color: this.#theme.colors.canvas, alpha: 0.05 * i });
    }
    layer.addChild(bindThemeGraphicsProjection(vignette, ['canvas', 'canvas', 'canvas', 'canvas', 'canvas']));
    const title = bindThemeTextProjection(new PText({
      text: view.title,
      style: {
        fontSize: 58,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        letterSpacing: 8,
        fontFamily: this.#fontFamily('title'),
      } satisfies TextStyleOptions,
    }), { fill: 'text' });
    title.anchor.set(0.5);
    title.position.set(this.#w / 2, this.#h * 0.28);
    layer.addChild(title);
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(this.#w / 2 - 210, this.#h * 0.28 + 47, 420, 1, 0.5)
      .fill({ color: this.#theme.colors.accent, alpha: 0.55 }), ['accent']));
    if (view.subtitle) {
      const subtitle = bindThemeTextProjection(new PText({
        text: view.subtitle,
        style: { fontSize: 18, fill: this.#theme.colors.textMuted, letterSpacing: 3, fontFamily: this.#fontFamily('ui') } satisfies TextStyleOptions,
      }), { fill: 'textMuted' });
      subtitle.anchor.set(0.5);
      subtitle.position.set(this.#w / 2, this.#h * 0.28 + 76);
      layer.addChild(subtitle);
    }
    const startY = this.#h * 0.52;
    view.items.forEach((item, i) => {
      const enabled = item.enabled !== false;
      const baseX = this.#w / 2;
      const baseY = startY + i * 52;
      const label = bindThemeTextProjection(new PText({
        text: item.label,
        style: {
          fontSize: 20,
          fill: enabled ? this.#theme.colors.text : this.#theme.colors.textDisabled,
          letterSpacing: 4,
          fontFamily: this.#fontFamily('ui'),
        } satisfies TextStyleOptions,
      }), { fill: enabled ? 'text' : 'textDisabled' });
      label.anchor.set(0.5);
      label.position.set(baseX, baseY);
      if (enabled) {
        const line = bindThemeGraphicsProjection(new Graphics()
          .roundRect(baseX - 70, baseY + 20, 140, 1, 0.5)
          .fill({ color: this.#theme.colors.accent, alpha: 0.9 }), ['accent']);
        line.visible = false;
        layer.addChild(line);
        label.eventMode = 'static';
        label.cursor = 'pointer';
        label.on('pointerdown', () => {
          this.#titleHandler?.(item.id);
        });
        label.on('pointerover', () => {
          line.visible = true;
          label.style = { fontSize: 20, fill: this.#theme.colors.text, letterSpacing: 4, fontFamily: this.#fontFamily('ui') } satisfies TextStyleOptions;
        });
        label.on('pointerout', () => {
          line.visible = false;
          label.style = { fontSize: 20, fill: this.#theme.colors.text, letterSpacing: 4, fontFamily: this.#fontFamily('ui') } satisfies TextStyleOptions;
        });
      }
      layer.addChild(label);
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
        fontSize: 30,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        letterSpacing: 9,
        fontFamily: this.#fontFamily('title'),
      } satisfies TextStyleOptions,
    }), { fill: 'text' });
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
    layer.alpha = 0;
    const bg = bindThemeGraphicsProjection(new Graphics()
      .rect(0, 0, this.#w, this.#h)
      .fill({ color: this.#theme.colors.scrim, alpha: 0.62 }), ['scrim']);
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
    panel.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(px, py, pw, panelH, 6)
      .fill({ color: this.#theme.colors.surface, alpha: 0.97 })
      .stroke({ width: 1, color: this.#theme.colors.line, alpha: 0.52 }), ['surface', 'line']));
    panel.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(px, py, 3, panelH)
      .fill({ color: this.#theme.colors.accentSoft, alpha: 0.94 }), ['accentSoft']));
    panel.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(px + 28, py + headerH - 1, pw - 54, 1)
      .fill({ color: this.#theme.colors.line, alpha: 0.32 }), ['line']));
    panel.addChild(bindThemeTextProjection(new PText({
      text: 'SYSTEM',
      style: { fontSize: 13, fill: this.#theme.colors.accentSoft, letterSpacing: 4, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'accentSoft' })).position.set(px + 28, py + 19);
    panel.addChild(bindThemeTextProjection(new PText({
      text: '系统菜单',
      style: { fontSize: 27, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text' })).position.set(px + 27, py + 42);

    items.forEach((item, i) => {
      const row = new Container();
      const rowY = py + headerH + i * rowH;
      row.position.set(px + 16, rowY);
      const hover = bindThemeGraphicsProjection(new Graphics()
        .roundRect(0, 4, pw - 32, rowH - 8, 3)
        // Transparent interaction geometry is a fixed hit-area color, not a theme token.
        .fill({ color: 0x173149, alpha: 0 }), [null]);
      const marker = bindThemeGraphicsProjection(new Graphics()
        .rect(0, 13, 3, rowH - 26)
        .fill({ color: this.#theme.colors.accentSoft, alpha: 0 }), ['accentSoft']);
      const index = bindThemeTextProjection(new PText({
        text: String(i + 1).padStart(2, '0'),
        style: { fontSize: 13, fill: this.#theme.colors.textMuted, letterSpacing: 1 } satisfies TextStyleOptions,
      }), { fill: 'textMuted' });
      index.position.set(22, 19);
      const label = bindThemeTextProjection(new PText({
        text: item.label,
        style: { fontSize: 21, fill: this.#theme.colors.text, fontWeight: 'normal' } satisfies TextStyleOptions,
      }), { fill: 'text' });
      label.position.set(62, 14);
      row.addChild(hover, marker, index, label);
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointerover', () => {
        hover.alpha = 1;
        marker.alpha = 1;
        label.style = { fontSize: 21, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions;
      });
      row.on('pointerout', () => {
        hover.alpha = 0;
        marker.alpha = 0;
        label.style = { fontSize: 21, fill: this.#theme.colors.text, fontWeight: 'normal' } satisfies TextStyleOptions;
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
    const bg = bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.scrim, alpha: 0.66 }),
      ['scrim'],
    );
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
    const headerH = 106;
    const rowH = 58;
    const panelH = headerH + this.#settingsRows.length * rowH + 34;
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(px + 10, py + 12, pw, panelH, 6)
      .fill({ color: this.#theme.colors.canvas, alpha: 0.28 }), ['canvas']));
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(px, py, pw, panelH, 6)
      .fill({ color: this.#theme.colors.surface, alpha: 0.98 })
      .stroke({ width: 1, color: this.#theme.colors.line, alpha: 0.52 }), ['surface', 'line']));
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(px, py, 3, panelH)
      .fill({ color: this.#theme.colors.accentSoft, alpha: 0.94 }), ['accentSoft']));
    layer.addChild(bindThemeTextProjection(new PText({
      text: 'SETTINGS',
      style: { fontSize: 13, fill: this.#theme.colors.accentSoft, letterSpacing: 4, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'accentSoft' })).position.set(px + 30, py + 20);
    layer.addChild(bindThemeTextProjection(new PText({
      text: '设置',
      style: { fontSize: 28, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text' })).position.set(px + 28, py + 44);
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(px + 28, py + headerH - 1, pw - 56, 1)
      .fill({ color: this.#theme.colors.line, alpha: 0.32 }), ['line']));
    const close = bindThemeTextProjection(new PText({ text: '×', style: { fontSize: 30, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }), { fill: 'textMuted' });
    close.position.set(px + pw - 52, py + 26);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerover', () => { close.style = { fontSize: 30, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
    close.on('pointerout', () => { close.style = { fontSize: 30, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions; });
    close.on('pointerdown', () => {
      const handler = this.#settingsHandlers?.onClose;
      this.hideSettings();
      handler?.();
    });
    layer.addChild(close);

    this.#settingsRows.forEach((row, i) => {
      const y = py + headerH + i * rowH;
      layer.addChild(bindThemeGraphicsProjection(new Graphics()
        .rect(px + 28, y + rowH - 1, pw - 56, 1)
        .fill({ color: this.#theme.colors.line, alpha: i === this.#settingsRows.length - 1 ? 0.18 : 0.26 }), ['line']));
      layer.addChild(bindThemeTextProjection(new PText({
        text: row.label,
        style: { fontSize: 21, fill: this.#theme.colors.text } satisfies TextStyleOptions,
      }), { fill: 'text' })).position.set(px + 32, y + 16);
      const controls = new Container();
      controls.position.set(px + pw - 300, y + 9);
      const value = bindThemeTextProjection(new PText({
        text: row.display,
        style: { fontSize: 19, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
      }), { fill: 'text' });
      value.anchor.set(0.5, 0);
      value.position.set(150, 7);
      const left = bindThemeTextProjection(new PText({ text: '‹', style: { fontSize: 32, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions }), { fill: 'accentSoft' });
      left.position.set(52, -3);
      const right = bindThemeTextProjection(new PText({ text: '›', style: { fontSize: 32, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions }), { fill: 'accentSoft' });
      right.position.set(230, -3);
      for (const control of [left, right]) {
        control.eventMode = 'static';
        control.cursor = 'pointer';
        control.on('pointerover', () => { control.style = { fontSize: 32, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
        control.on('pointerout', () => { control.style = { fontSize: 32, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions; });
      }
      left.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, -1));
      right.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, 1));
      controls.addChild(left, value, right);
      layer.addChild(controls);
    });
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
    this.#saveLoadHandlers = { onSelect, onClose };
    this.#saveLoadOptions = options;
    this.#saveLoadMode = view.mode;
    this.#saveLoadSlotCount = view.slots.length;
    const layer = this.#saveLoadLayer;
    const bg = bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.scrim, alpha: 0.84 }),
      ['scrim'],
    );
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
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .rect(86, 68, 3, 78)
      .fill({ color: this.#theme.colors.accentSoft, alpha: 0.94 }), ['accentSoft']));
    layer.addChild(bindThemeTextProjection(new PText({
      text: view.mode === 'save' ? 'SAVE DATA' : 'LOAD DATA',
      style: { fontSize: 13, fill: this.#theme.colors.accentSoft, letterSpacing: 4, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'accentSoft' })).position.set(108, 70);
    layer.addChild(bindThemeTextProjection(new PText({
      text: view.mode === 'save' ? '存档' : '读档',
      style: { fontSize: 34, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text' })).position.set(106, 91);
    layer.addChild(bindThemeTextProjection(new PText({
      text: '记录当前剧情进度',
      style: { fontSize: 16, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions,
    }), { fill: 'textMuted' })).position.set(255, 110);
    const close = bindThemeTextProjection(new PText({ text: '×', style: { fontSize: 30, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions }), { fill: 'textMuted' });
    close.position.set(this.#w - 106, 76);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerover', () => { close.style = { fontSize: 30, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
    close.on('pointerout', () => { close.style = { fontSize: 30, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions; });
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

    const cols = 2;
    const cardW = 480;
    const cardH = 104;
    const gapX = 22;
    const gapY = 16;
    const startX = 150;
    const startY = 180;
    view.slots.forEach((slot, i) => {
      const x = startX + (i % cols) * (cardW + gapX);
      const y = startY + Math.floor(i / cols) * (cardH + gapY);
      const selectable = view.mode === 'save' || !slot.empty;
      const card = new Container();
      card.position.set(x, y);
      const surface = bindThemeGraphicsProjection(new Graphics()
        .roundRect(0, 0, cardW, cardH, 4)
        .fill({ color: selectable ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: 0.92 })
        .stroke({ width: 1, color: selectable ? this.#theme.colors.line : this.#theme.colors.textDisabled, alpha: selectable ? 0.68 : 0.38 }),
        [selectable ? 'surfaceStrong' : 'panel', selectable ? 'line' : 'textDisabled'],
      );
      const hover = bindThemeGraphicsProjection(new Graphics()
        .roundRect(0, 0, cardW, cardH, 4)
        // Transparent interaction geometry is a fixed hit-area color, not a theme token.
        .fill({ color: 0x173149, alpha: 0 }), [null]);
      const marker = bindThemeGraphicsProjection(new Graphics()
        .rect(0, 13, 3, cardH - 26)
        .fill({ color: this.#theme.colors.accentSoft, alpha: 0 }), ['accentSoft']);
      card.addChild(surface, hover, marker);
      let textX = 28;
      if (slot.thumbnail) {
        const thumb = new Sprite(this.#thumbTexture(slot.thumbnail));
        thumb.width = 128;
        thumb.height = 72;
        thumb.position.set(18, 16);
        card.addChild(thumb);
        textX = 166;
      }
      card.addChild(bindThemeTextProjection(new PText({
        text: String(i + 1).padStart(2, '0'),
        style: { fontSize: 13, fill: selectable ? this.#theme.colors.accentSoft : this.#theme.colors.textDisabled, letterSpacing: 1 } satisfies TextStyleOptions,
      }), { fill: selectable ? 'accentSoft' : 'textDisabled' })).position.set(textX, 14);
      const kindLabel = slot.kind === 'auto' ? '自动' : slot.kind === 'quick' ? '快速' : '手动';
      card.addChild(bindThemeTextProjection(new PText({
        text: slot.empty ? '空槽位' : (slot.label ?? '未命名场景'),
        style: { fontSize: 21, fill: selectable ? this.#theme.colors.text : this.#theme.colors.textDisabled, fontWeight: 'bold' } satisfies TextStyleOptions,
      }), { fill: selectable ? 'text' : 'textDisabled' })).position.set(textX, 34);
      if (!slot.empty) {
        const playtime = slot.playTimeSec !== undefined && slot.playTimeSec > 0
          ? ` · ${Math.floor(slot.playTimeSec / 60)}分钟`
          : '';
        card.addChild(bindThemeTextProjection(new PText({
          text: `${kindLabel}　${formatSlotTime(slot.updatedAt)}${playtime}`,
          style: { fontSize: 15, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions,
        }), { fill: 'textMuted' })).position.set(textX, 70);
      } else {
        card.addChild(bindThemeTextProjection(new PText({
          text: `${kindLabel}　等待记录`,
          style: { fontSize: 15, fill: this.#theme.colors.textDisabled } satisfies TextStyleOptions,
        }), { fill: 'textDisabled' })).position.set(textX, 70);
      }
      if (view.mode === 'load' && slot.backupAvailable) {
        const restore = bindThemeTextProjection(new PText({
          text: '恢复备份并读取',
          style: { fontSize: 14, fill: this.#theme.colors.accentSoft, fontWeight: 'bold' } satisfies TextStyleOptions,
        }), { fill: 'accentSoft' });
        restore.position.set(cardW - 174, 70);
        restore.eventMode = 'static';
        restore.cursor = 'pointer';
        restore.on('pointerover', () => { restore.style = { fontSize: 14, fill: this.#theme.colors.text } satisfies TextStyleOptions; });
        restore.on('pointerout', () => { restore.style = { fontSize: 14, fill: this.#theme.colors.accentSoft, fontWeight: 'bold' } satisfies TextStyleOptions; });
        restore.on('pointerdown', (event) => {
          event.stopPropagation?.();
          const handler = this.#saveLoadOptions.onRestore;
          if (this.#saveLoadOptions.completion === 'host-transaction') {
            if (this.#saveLoadTransactionPending) {
              this.#onPointerConsumed?.();
              return;
            }
            this.#saveLoadTransactionPending = true;
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
                  }
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
          const handler = this.#saveLoadHandlers?.onSelect;
          if (this.#saveLoadOptions.completion === 'host-transaction') {
          if (this.#saveLoadTransactionPending) {
              this.#onPointerConsumed?.();
              event.stopPropagation?.();
              return;
            }
            this.#saveLoadTransactionPending = true;
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
                  }
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

  #handleSaveLoadTransactionError(error: unknown, report = this.#saveLoadOptions.onTransactionError): void {
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
        image.src = url;
        const texture = Texture.from(image);
        entry = { texture, dispose: () => texture.destroy(true) };
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
