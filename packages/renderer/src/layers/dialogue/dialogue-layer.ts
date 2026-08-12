import {
  Container,
  Graphics,
  Sprite,
  Text as PText,
  TextStyle,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type { BacklogEntry } from '../../backlog.js';
import { parseRuby, stripRuby } from '../../ruby.js';
import { layoutRuby, type RubyGlyphLayout } from '../../ruby-layout.js';
import { wrapCjk, wrapCjkMeasure } from '../../text-wrap.js';
import type { PresentationPreferences } from '../../presentation.js';
import { DEFAULT_PRESENTATION_PREFERENCES } from '../../presentation.js';
import { RenderLifecycle } from '../../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import type { DialogueProjectionPort } from '../../api/renderer-commands.js';
import type {
  ChoiceOptionView,
  CommandRailItem,
  FrameRequestHandler,
  SpeakerProfile,
} from '../../types.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from '../../theme.js';
import {
  bindThemeGraphicsProjection,
  bindThemeTextProjection,
  readThemeProjection,
  repaintThemeProjection,
  type LayerThemeProjectionSnapshot,
} from '../../theme-projection.js';

const BACKLOG_HEADER_Y = 30;
const BACKLOG_SEARCH_Y = 58;
const BACKLOG_VIEWPORT_TOP_IDLE = 76;
const BACKLOG_VIEWPORT_TOP_SEARCH = 92;
const BACKLOG_VIEWPORT_BOTTOM_INSET = 36;

export interface DialogueBacklogLayoutSnapshot {
  readonly headerY: number;
  readonly viewportTop: number;
  readonly viewportBottom: number;
  readonly scroll: number;
  readonly contentHeight: number;
  readonly hasMask: boolean;
  readonly searchVisible: boolean;
  readonly idleSearchHintVisible: boolean;
}

export interface DialogueChoiceBoundsSnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** DialogueLayer owns only dialogue-facing display objects and projection state. */
export interface DialogueLayerOptions {
  readonly uiLayer: Container;
  readonly width: number;
  readonly height: number;
  readonly assets: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
  readonly preferences?: PresentationPreferences;
  readonly requestFrame?: () => void;
  /** Marks the synchronous pointer event as consumed by a Dialogue UI target. */
  readonly onPointerConsumed?: (() => void) | null;
}

/** Read-only evidence emitted for the local renderer acceptance harness. */
export interface DialogueLayerDebugSnapshot {
  readonly activeSpeakerId: string | null;
  readonly projectionVersion: number;
  readonly speakerText: string;
  readonly dialogText: string;
  readonly panelVisible: boolean;
  readonly choiceLabels: readonly string[];
  /** Local logical bounds of the currently projected choice cards. */
  readonly choiceBounds: readonly DialogueChoiceBoundsSnapshot[];
  readonly visibleChoiceCount: number;
  readonly rubyBaseCount: number;
  readonly rubyTextCount: number;
  readonly backlogVisible: boolean;
  readonly backlogAboveDialogueText: boolean;
  /** Real projected visibility; false while an overlay suppresses the rail. */
  readonly commandRailVisible: boolean;
  /** Command-rail root stays fully visible; hover is projected per row. */
  readonly commandRailAlpha: number;
  readonly commandRailSuppressed: boolean;
  readonly backlogLayout: DialogueBacklogLayoutSnapshot;
  readonly nvlActive: boolean;
  readonly nvlLines: readonly string[];
}

interface ChoiceView {
  readonly holder: Container;
  readonly bg: Graphics;
  readonly bar: Graphics;
  readonly label: PText;
}

interface DestroyableDisplay {
  parent?: Container | null;
  destroy: (options?: { children?: boolean }) => void;
}

let dialogMeasureCtx: CanvasRenderingContext2D | null = null;

function getDialogMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!dialogMeasureCtx) dialogMeasureCtx = document.createElement('canvas').getContext('2d');
  return dialogMeasureCtx;
}

/**
 * The dialogue projection is deliberately independent from PixiStage. It only
 * receives a display root, shared asset/lifecycle services, and a narrow frame
 * request callback. It has no World callback and imports no other Renderer Layer.
 */
export class DialogueLayer implements DialogueProjectionPort {
  readonly owner = 'dialogue' as const;

  readonly #root: Container;
  /** Dialogue-owned normal content root; sibling overlays remain above this node. */
  readonly #dialogueRoot: Container;
  /** Dialogue-owned overlay root; Backlog is always above normal dialogue content. */
  readonly #dialogueOverlayRoot: Container;
  readonly #w: number;
  readonly #h: number;
  readonly #assets: RenderAssetRegistry;
  readonly #lifecycle: RenderLifecycle;
  readonly #ownsLifecycle: boolean;
  readonly #requestFrameCallback?: () => void;
  #frameRequest: FrameRequestHandler | null = null;
  #disposed = false;
  #projectionVersion = 0;

  #speakerText: PText;
  #dialogText: PText;
  #lastShownSpeaker: string | null | undefined;
  #lastShownDialog = '';
  #lineActive = false;
  #speakerPlate: Graphics;
  #dialogCharsPerLine = 40;
  #dialogPanel: Graphics;
  #dialogRubyLayer: Container;
  #rubyBasePool: PText[] = [];
  #rubyTextPool: PText[] = [];

  #choiceLayer: Container;
  #choiceViews: ChoiceView[] = [];
  #choiceHighlight = -1;
  #choiceFadeRemain = 0;
  #choiceFadeDur = 280;

  #continueIndicator: Graphics;
  #continuePhase = 0;
  #backlogEntriesLayer: Container | null = null;
  #backlogMask: Graphics | null = null;
  #backlogViewportTop = BACKLOG_VIEWPORT_TOP_IDLE;
  #backlogSearchVisible = false;
  #backlogIdleSearchHintVisible = false;
  #backlogScroll = 0;
  #backlogContentH = 0;
  #backlogLayer: Container;
  #backlogBuilt = false;

  #nvlLayer: Container;
  #nvlBackground: Graphics;
  #nvlLines: PText[] = [];
  #nvlLineCounts: number[] = [];
  #nvlActive = false;
  #nvlCharsPerLine = 50;

  #bannerLayer: Container;
  #bannerText: PText;
  #bannerBars: Graphics;
  #bannerTipBg: Graphics;
  #bannerRemain = 0;
  #bannerDur = 1;

  #commandRail: Container;
  #commandRailItems: CommandRailItem[] = [];
  #commandRailOnSelect: ((id: string) => void) | null = null;
  #commandRailSuppressed = false;
  #onPointerConsumed: (() => void) | null = null;

  #speakerProfiles = new Map<string, SpeakerProfile>();
  #activeSpeakerId: string | null = null;
  #speakerAvatar: Sprite | null = null;
  #interfaceHidden = false;
  #preferences: PresentationPreferences = { ...DEFAULT_PRESENTATION_PREFERENCES };
  #theme: RendererTheme = DEFAULT_RENDERER_THEME;

  constructor(options: DialogueLayerOptions) {
    this.#root = options.uiLayer;
    this.#dialogueRoot = new Container();
    this.#dialogueOverlayRoot = new Container();
    this.#w = options.width;
    this.#h = options.height;
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#requestFrameCallback = options.requestFrame;
    this.#onPointerConsumed = options.onPointerConsumed ?? null;
    if (options.preferences) this.#preferences = { ...options.preferences };

    this.#root.addChild(this.#dialogueRoot, this.#dialogueOverlayRoot);

    this.#choiceLayer = new Container();
    this.#commandRail = new Container();
    this.#commandRail.visible = false;

    this.#dialogRubyLayer = new Container();
    this.#nvlLayer = new Container();
    this.#nvlLayer.visible = false;
    this.#nvlBackground = bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.86 }),
      ['panel'],
    );
    this.#nvlLayer.addChild(this.#nvlBackground);

    this.#bannerLayer = new Container();
    this.#bannerLayer.visible = false;
    this.#bannerBars = bindThemeGraphicsProjection(new Graphics(), ['scrim', 'scrim']);
    this.#bannerBars.rect(0, 0, this.#w, 90).fill({ color: this.#theme.colors.scrim, alpha: 0.85 });
    this.#bannerBars.rect(0, this.#h - 90, this.#w, 90).fill({ color: this.#theme.colors.scrim, alpha: 0.85 });
    this.#bannerTipBg = bindThemeGraphicsProjection(new Graphics(), ['surface', 'line']);
    this.#bannerText = bindThemeTextProjection(new PText({
      text: '',
      style: {
        fontSize: 40,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        fontFamily: this.#assets.fontFamily('title'),
      } satisfies TextStyleOptions,
    }), { fill: 'text' });
    this.#bannerText.anchor.set(0.5);
    this.#bannerLayer.addChild(this.#bannerBars, this.#bannerTipBg, this.#bannerText);

    this.#dialogPanel = bindThemeGraphicsProjection(new Graphics(), ['scrim', 'scrim', 'scrim']);
    this.#drawDialogPanel();
    this.#speakerPlate = bindThemeGraphicsProjection(new Graphics(), ['line']);
    this.#speakerAvatar = new Sprite(Texture.EMPTY);
    this.#speakerAvatar.anchor.set(0.5, 1);
    this.#speakerAvatar.visible = false;

    this.#continueIndicator = bindThemeGraphicsProjection(new Graphics()
      .circle(0, 0, 9).fill({ color: this.#theme.colors.accent, alpha: 0.22 })
      .circle(0, 0, 4.5).fill({ color: this.#theme.colors.text, alpha: 0.95 }), ['accent', 'text']);
    this.#continueIndicator.visible = false;
    this.#continueIndicator.x = this.#w - 68;

    this.#backlogLayer = new Container();
    this.#backlogLayer.visible = false;

    this.#speakerText = bindThemeTextProjection(new PText({
      text: '',
      style: {
        fontSize: 18,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        letterSpacing: 1,
        fontFamily: this.#assets.fontFamily('body'),
        stroke: { width: 1.2, color: this.#theme.colors.textOnAccent },
      } satisfies TextStyleOptions,
    }), { fill: 'text', stroke: 'textOnAccent' });
    this.#dialogText = bindThemeTextProjection(new PText({
      text: '',
      style: {
        fontSize: 25,
        fill: this.#theme.colors.text,
        fontWeight: 'normal',
        fontFamily: this.#assets.fontFamily('body'),
        letterSpacing: 0.3,
        lineHeight: 41,
        stroke: { width: 1.35, color: this.#theme.colors.textOnAccent },
      } satisfies TextStyleOptions,
    }), { fill: 'text', stroke: 'textOnAccent' });
    this.#dialogCharsPerLine = Math.max(10, Math.floor((this.#w - 220) / 25));
    this.#nvlCharsPerLine = Math.max(10, Math.floor((this.#w - 160) / 20));

    this.#mountInitialDisplays();
  }

  get onSelect(): ((index: number) => void) | null {
    return this.#onSelect;
  }

  set onSelect(handler: ((index: number) => void) | null) {
    this.#onSelect = handler;
  }

  get onBacklogClose(): (() => void) | null {
    return this.#onBacklogClose;
  }

  set onBacklogClose(handler: (() => void) | null) {
    this.#onBacklogClose = handler;
  }

  get onPointerConsumed(): (() => void) | null {
    return this.#onPointerConsumed;
  }

  set onPointerConsumed(handler: (() => void) | null) {
    this.#onPointerConsumed = handler;
  }

  get nvlLines(): readonly PText[] {
    return this.#nvlLines;
  }

  get activeSpeakerId(): string | null {
    return this.#activeSpeakerId;
  }

  get projectionVersion(): number {
    return this.#projectionVersion;
  }

  /**
   * Test-only read model. It reads projection state without creating display
   * objects, registering resources, requesting a frame, or changing visibility.
   */
  debugSnapshot(): DialogueLayerDebugSnapshot {
    return {
      activeSpeakerId: this.#activeSpeakerId,
      projectionVersion: this.#projectionVersion,
      speakerText: String(this.#speakerText.text),
      dialogText: String(this.#dialogText.text),
      panelVisible: this.#dialogPanel.visible,
      choiceLabels: this.#choiceViews.map((view) => String(view.label.text)),
      choiceBounds: this.#choiceViews.map((view) => ({
        x: view.holder.x,
        y: view.holder.y,
        width: view.holder.width,
        height: view.holder.height,
      })),
      visibleChoiceCount: this.#choiceViews.filter((view) => view.holder.visible && view.holder.alpha > 0).length,
      rubyBaseCount: this.#rubyBasePool.filter((text) => text.visible).length,
      rubyTextCount: this.#rubyTextPool.filter((text) => text.visible).length,
      backlogVisible: this.#backlogLayer.visible,
      backlogAboveDialogueText: this.#backlogAboveDialogueText(),
      commandRailVisible: this.#commandRail.visible,
      commandRailAlpha: this.#commandRail.alpha,
      commandRailSuppressed: this.#commandRailSuppressed,
      backlogLayout: this.#backlogLayoutSnapshot(),
      nvlActive: this.#nvlActive,
      nvlLines: this.#nvlLines.map((line) => String(line.text)),
    };
  }

  themeProjectionSnapshot(): LayerThemeProjectionSnapshot {
    return readThemeProjection(this.#dialogueRoot, this.#dialogueOverlayRoot);
  }

  #onSelect: ((index: number) => void) | null = null;
  #onBacklogClose: (() => void) | null = null;

  /** Mount text inside the Dialogue-owned composition root. */
  mountTextDisplays(): void {
    if (this.#disposed || this.#dialogText.parent) return;
    this.#dialogueRoot.addChild(this.#speakerText, this.#dialogText);
    this.#registerDisplay('speaker-text', this.#speakerText);
    this.#registerDisplay('dialog-text', this.#dialogText);
    this.layout();
  }

  /**
   * Keep legacy text above other Dialogue displays without reordering sibling
   * Menu/Gallery/System layers in the shared UI root.
   */
  bringTextDisplaysToFront(): void {
    if (this.#disposed || !this.#dialogText.parent) return;
    this.#dialogueRoot.addChild(this.#speakerText, this.#dialogText);
  }

  attachPointerTarget(_target: { addEventListener: (type: string, listener: () => void) => void; removeEventListener: (type: string, listener: () => void) => void }): void {
    // Retain the legacy composition hook, but do not attach a permanent
    // canvas listener merely to wake a whole command rail. Pointerover/out on
    // each row owns its local visual projection.
  }

  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate()) handler();
  }

  setTheme(theme: RendererTheme): void {
    if (this.#disposed) return;
    const previous = this.#theme;
    this.#theme = theme;
    this.#drawDialogPanel();
    this.#drawSpeakerPlate();
    this.#continueIndicator.clear()
      .circle(0, 0, 9).fill({ color: theme.colors.accent, alpha: 0.22 })
      .circle(0, 0, 4.5).fill({ color: theme.colors.text, alpha: 0.95 });
    this.#speakerText.style.fill = theme.colors.text;
    this.#speakerText.style.stroke = { width: 1.2, color: theme.colors.textOnAccent };
    this.#dialogText.style.fill = theme.colors.text;
    this.#dialogText.style.stroke = { width: 1.35, color: theme.colors.textOnAccent };
    for (const ruby of [...this.#rubyBasePool, ...this.#rubyTextPool]) {
      ruby.style.fill = theme.colors.text;
      ruby.style.stroke = { width: 0.8, color: theme.colors.textOnAccent };
    }
    this.#nvlBackground.clear().rect(0, 0, this.#w, this.#h).fill({ color: theme.colors.panel, alpha: 0.86 });
    this.#bannerText.style.fill = theme.colors.text;
    for (const view of this.#choiceViews) this.#drawChoiceCard(view, view === this.#choiceViews[this.#choiceHighlight]);
    repaintThemeProjection(this.#dialogueRoot, previous, theme);
    repaintThemeProjection(this.#dialogueOverlayRoot, previous, theme);
  }

  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void {
    this.#preferences = { ...this.#preferences, ...preferences };
    this.#requestFrame();
  }

  refreshSpeakerAvatar(): void {
    this.#updateSpeakerAvatar();
    this.#requestFrame();
  }

  applyTypography(): void {
    TextStyle.defaultTextStyle.fontFamily = this.#assets.fontFamily('body');
    this.#dialogText.style.fontFamily = this.#assets.fontFamily('body');
    this.#speakerText.style.fontFamily = this.#assets.fontFamily('body');
    this.#bannerText.style.fontFamily = this.#assets.fontFamily('title');
    this.#lastShownSpeaker = undefined;
  }

  layout(): void {
    this.#speakerText.position.set(92, this.#h - 226);
    this.#dialogText.position.set(92, this.#h - 174);
    this.#dialogRubyLayer.position.set(92, this.#h - 174);
    this.#speakerAvatar?.position.set(58, this.#h - 54);
    const gap = 12;
    const heights = this.#choiceViews.map((view) => view.label.height + 16);
    const totalHeight = heights.reduce((sum, height) => sum + height, 0)
      + Math.max(0, heights.length - 1) * gap;
    let y = (this.#h - totalHeight) / 2;
    for (const [index, view] of this.#choiceViews.entries()) {
      const width = view.label.width + 60;
      const height = heights[index]!;
      view.holder.position.set((this.#w - width) / 2, y);
      y += height + gap;
    }
  }

  needsUpdate(): boolean {
    return this.#continueIndicator.visible || this.#hasEffectWork();
  }

  update(deltaMs: number): void {
    if (!this.#hasEffectWork()) return;
    if (this.#choiceFadeRemain > 0 && this.#choiceViews.length > 0) {
      this.#choiceFadeRemain = Math.max(0, this.#choiceFadeRemain - deltaMs);
      const total = this.#choiceFadeDur + (this.#choiceViews.length - 1) * 80;
      const elapsed = total - this.#choiceFadeRemain;
      this.#choiceViews.forEach((view, i) => {
        view.holder.alpha = Math.max(0, Math.min(1, (elapsed - i * 80) / this.#choiceFadeDur));
      });
      if (this.#choiceFadeRemain === 0) this.#lifecycle.release('dialogue', 'tween', 'choice-fade');
    }
    if (this.#bannerRemain > 0) {
      this.#bannerRemain = Math.max(0, this.#bannerRemain - deltaMs);
      const elapsed = this.#bannerDur - this.#bannerRemain;
      this.#bannerLayer.alpha = Math.min(1, elapsed / 300, this.#bannerRemain / 400);
      if (this.#bannerRemain === 0) {
        this.#bannerLayer.visible = false;
        this.#lifecycle.release('dialogue', 'tween', 'banner');
      }
    }
  }

  showText(speaker: string | null, value: string): void {
    if (this.#lastShownSpeaker === speaker && this.#lastShownDialog === value) return;
    this.#requestFrame();
    if ((speaker ?? '').length > 0 || value.length > 0) this.#lineActive = true;
    this.#lastShownSpeaker = speaker;
    this.#lastShownDialog = value;
    this.#projectionVersion += 1;
    const profile = speaker ? this.#speakerProfiles.get(speaker.trim()) : undefined;
    this.setActiveSpeaker(profile?.id ?? null);
    this.#speakerText.text = speaker !== null && speaker.length > 0 ? `「${speaker}」` : '';
    this.#drawSpeakerPlate();
    this.#updateSpeakerAvatar();
    this.#renderDialogText(value);
    this.#dialogPanel.visible = (speaker ?? '').length > 0 || value.length > 0 || this.#continueIndicator.visible;
    if (this.#interfaceHidden) {
      this.#dialogPanel.visible = false;
      this.#speakerPlate.visible = false;
      this.#speakerText.visible = false;
      this.#dialogText.visible = false;
      this.#dialogRubyLayer.visible = false;
    }
  }

  /** Begin a new ADV line without exposing a transient empty-panel frame. */
  beginText(speaker: string | null): void {
    this.#lineActive = true;
    this.#lastShownSpeaker = undefined;
    this.#lastShownDialog = '';
    this.showText(speaker, '');
    if (!this.#interfaceHidden && !this.#nvlActive) this.#dialogPanel.visible = true;
  }

  /** Explicitly clear the current line; unlike beginText this is allowed to hide the panel. */
  clearText(): void {
    if (this.#disposed) return;
    this.#lineActive = false;
    this.#lastShownSpeaker = undefined;
    this.#lastShownDialog = '';
    this.showText(null, '');
    this.#dialogPanel.visible = false;
    this.#continueIndicator.visible = false;
  }

  showChoices(options: ChoiceOptionView[]): void {
    this.#requestFrame();
    this.#commandRail.visible = false;
    this.#clearChoices();
    options.forEach((option, index) => {
      const holder = new Container();
      const label = bindThemeTextProjection(new PText({
        text: option.label,
        style: { fontSize: 24, fill: this.#theme.colors.text, letterSpacing: 1 } satisfies TextStyleOptions,
      }), { fill: 'text' });
      label.position.set(26, 6);
      const bg = bindThemeGraphicsProjection(new Graphics(), ['textOnAccent', 'line']);
      const bar = bindThemeGraphicsProjection(new Graphics(), ['line']);
      holder.addChild(bg, bar, label);
      const view = { holder, bg, bar, label };
      this.#choiceViews.push(view);
      this.#registerDisplay(`choice:${index}`, holder);
      this.#drawChoiceCard(view, false);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      holder.on('pointerdown', () => {
        this.#onPointerConsumed?.();
        this.#onSelect?.(option.index);
      });
      holder.on('pointerover', () => this.#drawChoiceCard(view, true));
      holder.on('pointerout', () => {
        this.#drawChoiceCard(view, this.#choiceHighlight === this.#choiceViews.indexOf(view));
      });
      this.#choiceLayer.addChild(holder);
    });
    this.#choiceHighlight = -1;
    this.layout();
    if (this.#choiceViews.length > 0) {
      this.#choiceFadeRemain = this.#choiceFadeDur + (this.#choiceViews.length - 1) * 80;
      for (const view of this.#choiceViews) view.holder.alpha = 0;
      this.#lifecycle.register('dialogue', 'tween', 'choice-fade', () => undefined);
    }
  }

  hideChoices(): void {
    this.#requestFrame();
    this.#clearChoices();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
  }

  setChoiceHighlight(position: number): void {
    this.#requestFrame();
    this.#choiceHighlight = position;
    this.#choiceViews.forEach((view, index) => this.#drawChoiceCard(view, index === position));
  }

  setAwaiting(awaiting: boolean): void {
    if (this.#nvlActive || this.#interfaceHidden) return;
    this.#continueIndicator.visible = awaiting;
    if (awaiting) this.#dialogPanel.visible = true;
    else if (!this.#lineActive && this.#speakerText.text.length === 0 && this.#dialogText.text.length === 0) this.#dialogPanel.visible = false;
    this.#requestFrame();
  }

  updateContinuePulse(deltaMs: number): void {
    if (!this.#continueIndicator.visible) return;
    this.#continuePhase = (this.#continuePhase + deltaMs / 1000 * 3) % (Math.PI * 2);
    this.#continueIndicator.y = this.#h - 46 + Math.sin(this.#continuePhase) * 3;
    this.#continueIndicator.alpha = 0.7 + Math.sin(this.#continuePhase) * 0.28;
  }

  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query = ''): void {
    const layer = this.#backlogLayer;
    if (!this.#backlogBuilt) {
      layer.eventMode = 'static';
      layer.on('pointerdown', () => {
        this.#onPointerConsumed?.();
        this.hideBacklog();
        this.#onBacklogClose?.();
      });
      this.#backlogBuilt = true;
      this.#lifecycle.register('dialogue', 'listener', 'backlog-overlay', () => {
        layer.removeAllListeners();
        this.#backlogBuilt = false;
      });
    }
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.#backlogMask = null;
    layer.addChild(bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.94 }),
      ['panel'],
    ));
    layer.addChild(bindThemeTextProjection(new PText({
      text: '文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）',
      style: { fontSize: 22, fill: this.#theme.colors.textOnAccent, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'textOnAccent' })).position.set(60, BACKLOG_HEADER_Y);
    const normalizedQuery = query.trim();
    this.#backlogSearchVisible = normalizedQuery.length > 0;
    this.#backlogIdleSearchHintVisible = false;
    this.#backlogViewportTop = this.#backlogSearchVisible
      ? BACKLOG_VIEWPORT_TOP_SEARCH
      : BACKLOG_VIEWPORT_TOP_IDLE;
    if (this.#backlogSearchVisible) {
      layer.addChild(bindThemeTextProjection(new PText({
        text: `搜索：${normalizedQuery}`,
        style: { fontSize: 17, fill: this.#theme.colors.accent } satisfies TextStyleOptions,
      }), { fill: 'accent' })).position.set(60, BACKLOG_SEARCH_Y);
    }
    const entriesLayer = new Container();
    this.#backlogEntriesLayer = entriesLayer;
    const viewportBottom = this.#h - BACKLOG_VIEWPORT_BOTTOM_INSET;
    const viewportHeight = Math.max(0, viewportBottom - this.#backlogViewportTop);
    const mask = bindThemeGraphicsProjection(
      new Graphics().rect(0, this.#backlogViewportTop, this.#w, viewportHeight).fill(0xffffff),
      [null],
    );
    entriesLayer.mask = mask;
    this.#backlogMask = mask;
    const perLine = 40;
    let y = 0;
    for (const entry of entries.slice(-120)) {
      const text = entry.text.length > 0 ? entry.text : '（无文本）';
      let first = true;
      for (const line of wrapCjk(text, perLine)) {
        const lineText = (first && entry.speaker ? `${entry.speaker}：` : '') + line;
        const textNode = bindThemeTextProjection(new PText({
          text: first && entry.voice ? `▶ ${lineText}` : lineText,
          style: {
            fontSize: 20,
            fill: first && entry.speaker ? this.#theme.colors.accent : this.#theme.colors.textMuted,
            fontWeight: first && entry.speaker ? 'bold' : 'normal',
          } satisfies TextStyleOptions,
        }), { fill: first && entry.speaker ? 'accent' : 'textMuted' });
        textNode.position.set(60, this.#backlogViewportTop + y);
        if (first && entry.voice && onReplayVoice) {
          textNode.eventMode = 'static';
          textNode.cursor = 'pointer';
          textNode.on('pointerdown', (event) => {
            this.#onPointerConsumed?.();
            event.stopPropagation();
            onReplayVoice(entry.voice!);
          });
        }
        entriesLayer.addChild(textNode);
        y += 34;
        first = false;
      }
    }
    this.#backlogContentH = y;
    this.#backlogScroll = 0;
    this.#applyBacklogScroll();
    layer.addChild(entriesLayer, mask);
    layer.visible = true;
    this.#requestFrame();
  }

  hideBacklog(): void {
    this.#backlogLayer.visible = false;
    this.#backlogLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.#backlogEntriesLayer = null;
    this.#backlogMask = null;
    this.#backlogViewportTop = BACKLOG_VIEWPORT_TOP_IDLE;
    this.#backlogSearchVisible = false;
    this.#backlogIdleSearchHintVisible = false;
    this.#backlogContentH = 0;
    this.#backlogScroll = 0;
  }

  scrollBacklog(delta: number): void {
    if (!this.#backlogEntriesLayer || !this.#backlogLayer.visible) return;
    const viewH = this.#h - BACKLOG_VIEWPORT_BOTTOM_INSET - this.#backlogViewportTop;
    const maxScroll = Math.max(0, this.#backlogContentH - viewH);
    this.#backlogScroll = Math.max(-maxScroll, Math.min(0, this.#backlogScroll - delta));
    this.#applyBacklogScroll();
    this.#requestFrame();
  }

  hideInterface(hidden: boolean): void {
    this.#interfaceHidden = hidden;
    this.#dialogPanel.visible = !hidden;
    this.#speakerText.visible = !hidden;
    this.#dialogText.visible = !hidden;
    this.#dialogRubyLayer.visible = !hidden;
    this.#continueIndicator.visible = !hidden;
    this.#commandRail.visible = !hidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#drawSpeakerPlate();
    this.#updateSpeakerAvatar();
    this.#requestFrame();
  }

  setSpeakerProfiles(profiles: SpeakerProfile[]): void {
    this.#speakerProfiles.clear();
    for (const profile of profiles) {
      if (profile.name.trim().length > 0 && profile.id.trim().length > 0) {
        this.#speakerProfiles.set(profile.name.trim(), { ...profile });
      }
    }
    this.#updateSpeakerAvatar();
    this.#requestFrame();
  }

  setActiveSpeaker(characterId: string | null): void {
    this.#activeSpeakerId = characterId;
    this.#updateSpeakerAvatar();
    this.#requestFrame();
  }

  showCommandRail(items: CommandRailItem[], onSelect: (id: string) => void): void {
    this.#commandRailSuppressed = false;
    this.#commandRailOnSelect = onSelect;
    this.#commandRailItems = items.map((item) => ({ ...item }));
    this.#rebuildCommandRail();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#requestFrame();
  }

  setCommandRailItems(items: CommandRailItem[]): void {
    this.#commandRailItems = items.map((item) => ({ ...item }));
    this.#rebuildCommandRail();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#requestFrame();
  }

  hideCommandRail(): void {
    this.#commandRailSuppressed = true;
    this.#commandRail.visible = false;
    this.#lifecycle.release('dialogue', 'tween', 'command-rail');
    this.#requestFrame();
  }

  restoreCommandRail(): void {
    this.#commandRailSuppressed = false;
    this.#commandRail.visible = !this.#interfaceHidden && this.#commandRailItems.length > 0;
    this.#commandRail.alpha = 1;
    this.#requestFrame();
  }

  showBanner(text: string, variant: 'chapter' | 'tip'): void {
    if (text.length === 0) return;
    this.#bannerText.text = text;
    this.#bannerText.style = variant === 'chapter'
      ? { fontSize: 38, fill: this.#theme.colors.text, fontWeight: 'normal', letterSpacing: 6, fontFamily: this.#assets.fontFamily('title') } satisfies TextStyleOptions
      : { fontSize: 20, fill: this.#theme.colors.text, fontFamily: this.#assets.fontFamily('ui') } satisfies TextStyleOptions;
    this.#bannerBars.visible = variant === 'chapter';
    this.#bannerTipBg.clear();
    if (variant === 'chapter') {
      this.#bannerText.anchor.set(0.5);
      this.#bannerText.position.set(this.#w / 2, this.#h * 0.4);
    } else {
      this.#bannerText.anchor.set(1, 0);
      this.#bannerText.position.set(this.#w - 60, 40);
      const tw = this.#bannerText.width;
      const th = this.#bannerText.height;
      this.#bannerTipBg.roundRect(this.#w - 60 - tw - 20, 32, tw + 40, th + 16, (th + 16) / 2)
        .fill({ color: this.#theme.colors.surface, alpha: 0.8 })
        .stroke({ width: 1, color: this.#theme.colors.line, alpha: 0.9 });
    }
    this.#bannerDur = variant === 'chapter' ? 2200 : 1800;
    this.#bannerRemain = this.#bannerDur;
    this.#bannerLayer.visible = true;
    this.#bannerLayer.alpha = 0;
    this.#lifecycle.register('dialogue', 'tween', 'banner', () => undefined);
    this.#requestFrame();
  }

  setNvlMode(on: boolean): void {
    this.#nvlActive = on;
    if (on) {
      this.clearNvlText();
      this.#nvlLayer.visible = true;
      this.#dialogPanel.visible = false;
      this.#speakerPlate.visible = false;
      this.#speakerText.visible = false;
      this.#dialogText.visible = false;
      this.#dialogRubyLayer.visible = false;
      this.#continueIndicator.visible = false;
    } else {
      this.#nvlLayer.visible = false;
      this.#speakerText.visible = true;
      this.#dialogText.visible = true;
      this.#dialogRubyLayer.visible = true;
      this.#drawSpeakerPlate();
    }
    this.#requestFrame();
  }

  appendNvlText(speaker: string | null, text: string): void {
    const raw = speaker !== null && speaker.length > 0 ? `${speaker}：${text}` : text;
    const wrapped = wrapCjk(raw, this.#nvlCharsPerLine);
    const textNode = bindThemeTextProjection(new PText({
      text: wrapped.join('\n'),
      style: { fontSize: 20, fill: this.#theme.colors.text, fontFamily: this.#assets.fontFamily('body') } satisfies TextStyleOptions,
    }), { fill: 'text' });
    this.#nvlLayer.addChild(textNode);
    this.#nvlLines.push(textNode);
    this.#nvlLineCounts.push(Math.max(1, wrapped.length));
    const budget = this.#h - 120;
    while (this.#nvlTotalHeight() > budget && this.#nvlLines.length > 1) {
      const old = this.#nvlLines.shift()!;
      this.#nvlLineCounts.shift();
      this.#nvlLayer.removeChild(old);
      old.destroy();
    }
    const lineHeight = 28;
    const entryGap = 6;
    let y = 60;
    this.#nvlLines.forEach((line, index) => {
      line.position.set(80, y);
      y += this.#nvlLineCounts[index]! * lineHeight + entryGap;
    });
    this.#requestFrame();
  }

  clearNvlText(): void {
    for (const line of this.#nvlLines) {
      this.#nvlLayer.removeChild(line);
      line.destroy();
    }
    this.#nvlLines = [];
    this.#nvlLineCounts = [];
    this.#requestFrame();
  }

  reset(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#lastShownSpeaker = undefined;
    this.#lastShownDialog = '';
    this.#lineActive = false;
    this.#clearChoices();
    this.hideBacklog();
    this.#lifecycle.release('dialogue', 'listener', 'backlog-overlay');
    this.#backlogLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.#backlogBuilt = false;
    this.#nvlActive = false;
    this.clearNvlText();
    this.#nvlLayer.visible = false;
    this.#hideRubyPool();
    this.#speakerText.text = '';
    this.#dialogText.text = '';
    this.#speakerText.visible = true;
    this.#dialogText.visible = true;
    this.#dialogRubyLayer.visible = true;
    this.#speakerPlate.clear();
    this.#speakerPlate.visible = false;
    if (this.#speakerAvatar) this.#speakerAvatar.visible = false;
    this.#activeSpeakerId = null;
    this.#dialogPanel.visible = false;
    this.#continueIndicator.visible = false;
    this.#continuePhase = 0;
    this.#interfaceHidden = false;
    this.#commandRailSuppressed = false;
    this.#commandRail.visible = this.#commandRailItems.length > 0;
    this.#commandRail.alpha = 1;
    this.#lifecycle.release('dialogue', 'tween', 'command-rail');
    this.#choiceHighlight = -1;
    this.#bannerRemain = 0;
    this.#lifecycle.release('dialogue', 'tween', 'banner');
    this.#bannerLayer.visible = false;
    this.#bannerLayer.alpha = 1;
    this.#bannerText.text = '';
    this.#bannerBars.visible = false;
    this.#bannerTipBg.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#frameRequest = null;
    this.#clearChoices();
    for (const line of this.#nvlLines) {
      this.#nvlLayer.removeChild(line);
      line.destroy();
    }
    this.#nvlLines = [];
    this.#nvlLineCounts = [];
    this.#destroyRubyPools();
    try {
      this.#lifecycle.releaseOwner('dialogue');
    } finally {
      for (const child of [
        this.#dialogPanel,
        this.#speakerAvatar,
        this.#speakerPlate,
        this.#dialogRubyLayer,
        this.#continueIndicator,
        this.#choiceLayer,
        this.#commandRail,
        this.#backlogLayer,
        this.#nvlLayer,
        this.#bannerLayer,
        this.#speakerText,
        this.#dialogText,
      ]) {
        if (child?.parent) child.parent.removeChild(child);
      }
      if (this.#dialogueRoot.parent) this.#dialogueRoot.parent.removeChild(this.#dialogueRoot);
      this.#dialogueRoot.destroy({ children: false });
      if (this.#dialogueOverlayRoot.parent) this.#dialogueOverlayRoot.parent.removeChild(this.#dialogueOverlayRoot);
      this.#dialogueOverlayRoot.destroy({ children: false });
      if (this.#ownsLifecycle) this.#lifecycle.dispose();
    }
  }

  #mountInitialDisplays(): void {
    const displays: [string, DestroyableDisplay][] = [
      ['dialog-panel', this.#dialogPanel],
      ['speaker-avatar', this.#speakerAvatar!],
      ['speaker-plate', this.#speakerPlate],
      ['dialog-ruby', this.#dialogRubyLayer],
      ['continue-indicator', this.#continueIndicator],
      ['choice-layer', this.#choiceLayer],
      ['command-rail', this.#commandRail],
      ['nvl-layer', this.#nvlLayer],
      ['banner-layer', this.#bannerLayer],
    ];
    this.#dialogueRoot.addChild(...displays.map(([, display]) => display as unknown as Container));
    for (const [key, display] of displays) this.#registerDisplay(key, display);
    this.#dialogueOverlayRoot.addChild(this.#backlogLayer);
    this.#registerDisplay('backlog-layer', this.#backlogLayer);
  }

  #backlogAboveDialogueText(): boolean {
    if (this.#dialogueRoot.parent !== this.#root || this.#dialogueOverlayRoot.parent !== this.#root) return false;
    return this.#root.getChildIndex(this.#dialogueOverlayRoot) > this.#root.getChildIndex(this.#dialogueRoot)
      && this.#backlogLayer.parent === this.#dialogueOverlayRoot;
  }

  #backlogLayoutSnapshot(): DialogueBacklogLayoutSnapshot {
    return {
      headerY: BACKLOG_HEADER_Y,
      viewportTop: this.#backlogViewportTop,
      viewportBottom: this.#h - BACKLOG_VIEWPORT_BOTTOM_INSET,
      scroll: this.#backlogScroll,
      contentHeight: this.#backlogContentH,
      hasMask: this.#backlogMask !== null,
      searchVisible: this.#backlogSearchVisible,
      idleSearchHintVisible: this.#backlogIdleSearchHintVisible,
    };
  }

  #registerDisplay(key: string, display: DestroyableDisplay): void {
    this.#lifecycle.register('dialogue', 'display', key, () => {
      if (display.parent) display.parent.removeChild(display as unknown as Container);
      display.destroy({ children: true });
    });
  }

  #requestFrame(): void {
    this.#requestFrameCallback?.();
    this.#frameRequest?.();
  }

  #scaledDuration(durationMs: number): number {
    if (this.#preferences.reducedMotion || this.#preferences.transitionScale === 0) return 1;
    return Math.max(1, durationMs * this.#preferences.transitionScale);
  }

  #wrapDialogText(plain: string): string[] {
    const ctx = getDialogMeasureCtx();
    if (!ctx) return wrapCjk(plain, this.#dialogCharsPerLine);
    const style = this.#dialogText.style;
    const family = style.fontFamily;
    const familyText = Array.isArray(family) ? family.join(', ') : String(family);
    ctx.font = `${style.fontSize}px ${familyText}`;
    return wrapCjkMeasure(plain, this.#w - 220, (text) => ctx.measureText(text).width);
  }

  #drawDialogPanel(): void {
    this.#dialogPanel.clear();
    this.#dialogPanel.rect(0, this.#h - 282, this.#w, 88).fill({ color: this.#theme.colors.scrim, alpha: 0.10 });
    this.#dialogPanel.rect(0, this.#h - 194, this.#w, 112).fill({ color: this.#theme.colors.scrim, alpha: 0.25 });
    this.#dialogPanel.rect(0, this.#h - 82, this.#w, 82).fill({ color: this.#theme.colors.scrim, alpha: 0.52 });
  }

  #drawSpeakerPlate(): void {
    this.#speakerPlate.clear();
    const show = this.#speakerText.text.length > 0 && !this.#interfaceHidden && !this.#nvlActive;
    this.#speakerPlate.visible = show;
    if (!show) return;
    const w = Math.max(56, this.#speakerText.width + 14);
    this.#speakerPlate.rect(92, this.#h - 198, w, 1.5).fill({ color: this.#theme.colors.line, alpha: 0.78 });
  }

  #renderDialogText(value: string): void {
    const unclosed = value.split('《').length !== value.split('》').length;
    const segs = unclosed ? [] : parseRuby(value);
    const hasRuby = segs.some((segment) => segment.ruby !== undefined);
    if (!hasRuby) {
      this.#hideRubyPool();
      this.#dialogText.visible = true;
      const plain = unclosed ? stripRuby(value) : value;
      this.#dialogText.text = this.#wrapDialogText(plain).join('\n');
      return;
    }
    this.#dialogText.visible = false;
    this.#dialogText.text = '';
    this.#hideRubyPool();
    const ctx = getDialogMeasureCtx();
    const family = this.#dialogText.style.fontFamily;
    const familyText = Array.isArray(family) ? family.join(', ') : String(family);
    const measure = {
      base: (text: string): number => {
        if (!ctx) return text.length * 25;
        ctx.font = `25px ${familyText}`;
        return ctx.measureText(text).width;
      },
      ruby: (text: string): number => {
        if (!ctx) return text.length * 12;
        ctx.font = `12px ${familyText}`;
        return ctx.measureText(text).width;
      },
    };
    const layouts = layoutRuby(segs, this.#w - 220, measure, 41);
    const baseStyle = {
      fontSize: 25,
      fill: this.#theme.colors.text,
      fontWeight: 'normal',
      fontFamily: family,
      letterSpacing: 0.3,
      lineHeight: 41,
      stroke: { width: 1.35, color: this.#theme.colors.textOnAccent },
    } satisfies TextStyleOptions;
    const rubyStyle = {
      fontSize: 12,
      fill: this.#theme.colors.text,
      fontFamily: family,
      stroke: { width: 0.8, color: this.#theme.colors.textOnAccent },
    } satisfies TextStyleOptions;
    let rubyIndex = 0;
    layouts.forEach((layout: RubyGlyphLayout, index) => {
      const base = this.#takeRubyText(this.#rubyBasePool, index, layout.base, baseStyle);
      base.position.set(layout.x + (layout.width - base.width) / 2, layout.y);
      if (layout.ruby !== undefined) {
        const ruby = this.#takeRubyText(this.#rubyTextPool, rubyIndex++, layout.ruby, rubyStyle);
        ruby.anchor.set(0.5, 1);
        ruby.position.set(layout.x + layout.width / 2, layout.y - 2);
      }
    });
  }

  #takeRubyText(pool: PText[], index: number, text: string, style: TextStyleOptions): PText {
    let object = pool[index];
    if (!object) {
      object = new PText({ text, style });
      bindThemeTextProjection(object, { fill: 'text', stroke: 'textOnAccent' });
      pool[index] = object;
      this.#dialogRubyLayer.addChild(object);
      this.#registerDisplay(`ruby-${pool === this.#rubyBasePool ? 'base' : 'text'}:${index}`, object);
    } else {
      object.text = text;
      object.style = style;
      bindThemeTextProjection(object, { fill: 'text', stroke: 'textOnAccent' });
    }
    object.visible = true;
    return object;
  }

  #hideRubyPool(): void {
    for (const object of this.#rubyBasePool) object.visible = false;
    for (const object of this.#rubyTextPool) object.visible = false;
  }

  #destroyRubyPools(): void {
    this.#dialogRubyLayer.removeChildren();
    for (let i = 0; i < this.#rubyBasePool.length; i++) this.#lifecycle.release('dialogue', 'display', `ruby-base:${i}`);
    for (let i = 0; i < this.#rubyTextPool.length; i++) this.#lifecycle.release('dialogue', 'display', `ruby-text:${i}`);
    this.#rubyBasePool = [];
    this.#rubyTextPool = [];
  }

  #drawChoiceCard(view: ChoiceView, selected: boolean): void {
    view.label.style = selected
      ? { fontSize: this.#theme.typography.bodySize, fill: this.#theme.colors.text, fontWeight: 'bold', letterSpacing: 1 } satisfies TextStyleOptions
      : { fontSize: this.#theme.typography.bodySize, fill: this.#theme.colors.textMuted, letterSpacing: 1 } satisfies TextStyleOptions;
    bindThemeTextProjection(view.label, { fill: selected ? 'text' : 'textMuted' });
    const w = view.label.width + 60;
    const h = view.label.height + 16;
    view.bg.clear();
    view.bg.rect(0, 0, w, h).fill({ color: this.#theme.colors.textOnAccent, alpha: selected ? 0.12 : 0.015 });
    view.bg.rect(0, h - 1, w, 1).fill({ color: this.#theme.colors.line, alpha: selected ? 0.9 : 0.22 });
    view.bar.clear();
    if (selected) view.bar.rect(0, h - 3, w, 2).fill({ color: this.#theme.colors.line, alpha: 0.95 });
  }

  #clearChoices(): void {
    this.#lifecycle.release('dialogue', 'tween', 'choice-fade');
    for (let index = 0; index < this.#choiceViews.length; index++) {
      this.#lifecycle.release('dialogue', 'display', `choice:${index}`);
    }
    this.#choiceViews = [];
    this.#choiceFadeRemain = 0;
  }

  #applyBacklogScroll(): void {
    this.#backlogEntriesLayer?.position.set(0, this.#backlogScroll);
  }

  #nvlTotalHeight(): number {
    let height = 0;
    for (const count of this.#nvlLineCounts) height += count * 28 + 6;
    return height;
  }

  #updateSpeakerAvatar(): void {
    const sprite = this.#speakerAvatar;
    if (!sprite) return;
    const profile = [...this.#speakerProfiles.values()].find((item) => item.id === this.#activeSpeakerId);
    const key = profile?.avatarKey;
    const texture = key ? this.#assets.resolveAvatar(key) : null;
    if (!texture || !profile || this.#interfaceHidden || this.#nvlActive) {
      sprite.visible = false;
      return;
    }
    sprite.texture = texture;
    const size = 96;
    sprite.width = size;
    sprite.height = size * (texture.height / Math.max(1, texture.width));
    sprite.position.set(54, this.#h - 52);
    sprite.alpha = 0.94;
    sprite.visible = true;
  }

  #rebuildCommandRail(): void {
    const layer = this.#commandRail;
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (this.#commandRailItems.length === 0) return;
    const railH = 46;
    const count = this.#commandRailItems.length;
    const slotW = 44;
    const slotGap = 4;
    const railPad = 8;
    const railW = railPad * 2 + count * slotW + (count - 1) * slotGap;
    const startX = Math.max(12, this.#w - railW - 18);
    const top = this.#h - railH - 10;
    layer.addChild(bindThemeGraphicsProjection(new Graphics()
      .roundRect(startX, top, railW, railH, 5)
      .fill({ color: this.#theme.colors.surfaceStrong, alpha: 0.82 })
      .stroke({ width: 1, color: this.#theme.colors.line, alpha: 0.3 }), ['surfaceStrong', 'line']));

    this.#commandRailItems.forEach((item, index) => {
      const row = new Container();
      row.position.set(startX + railPad + index * (slotW + slotGap), top + 3);
      const hit = bindThemeGraphicsProjection(
        new Graphics().roundRect(0, 0, slotW, railH - 6, 3).fill({ color: 0xffffff, alpha: 0.001 }),
        [null],
      );
      const icon = bindThemeTextProjection(new PText({
        text: item.icon ?? '·',
        style: {
          fontSize: 20,
          fill: item.active ? this.#theme.colors.line : this.#theme.colors.textMuted,
          fontWeight: item.active ? 'bold' : 'normal',
          fontFamily: this.#assets.fontFamily('ui'),
        } satisfies TextStyleOptions,
      }), { fill: item.active ? 'line' : 'textMuted' });
      icon.anchor.set(0.5);
      icon.position.set(slotW / 2, (railH - 6) / 2);
      const label = bindThemeTextProjection(new PText({
        text: item.label,
        style: {
          fontSize: 12,
          fill: item.enabled === false ? this.#theme.colors.textDisabled : item.active ? this.#theme.colors.text : this.#theme.colors.textMuted,
          letterSpacing: 1,
          fontFamily: this.#assets.fontFamily('ui'),
        } satisfies TextStyleOptions,
      }), { fill: item.enabled === false ? 'textDisabled' : item.active ? 'text' : 'textMuted' });
      label.anchor.set(0.5, 1);
      label.position.set(slotW / 2, -4);
      label.alpha = 0;
      const underline = bindThemeGraphicsProjection(new Graphics()
        .rect(10, railH - 8, slotW - 20, 1.5)
        .fill({ color: this.#theme.colors.line, alpha: item.active ? 0.9 : 0 }), ['line']);
      row.addChild(hit, icon, label, underline);
      row.alpha = item.enabled === false ? 0.38 : 1;
      if (item.enabled !== false) {
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointerover', () => {
          label.alpha = 1;
          underline.clear().rect(10, railH - 8, slotW - 20, 1.5)
            .fill({ color: this.#theme.colors.line, alpha: 0.9 });
          label.style = { fontSize: 12, fill: this.#theme.colors.text, letterSpacing: 1, fontFamily: this.#assets.fontFamily('ui') } satisfies TextStyleOptions;
        });
        row.on('pointerout', () => {
          label.alpha = 0;
          underline.clear().rect(10, railH - 8, slotW - 20, 1.5)
            .fill({ color: this.#theme.colors.line, alpha: item.active ? 0.9 : 0 });
          label.style = {
            fontSize: 12,
            fill: item.active ? this.#theme.colors.text : this.#theme.colors.textMuted,
            letterSpacing: 1,
            fontFamily: this.#assets.fontFamily('ui'),
          } satisfies TextStyleOptions;
        });
        row.on('pointerdown', () => {
          this.#onPointerConsumed?.();
          this.#commandRailOnSelect?.(item.id);
        });
      }
      layer.addChild(row);
    });
    layer.alpha = 1;
  }

  #hasEffectWork(): boolean {
    return (this.#choiceFadeRemain > 0 && this.#choiceViews.length > 0)
      || this.#bannerRemain > 0;
  }
}
