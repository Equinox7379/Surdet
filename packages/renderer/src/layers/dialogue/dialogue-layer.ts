import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text as PText,
  TextStyle,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type { BacklogEntry } from '../../backlog.js';
import { parseInlineText, inlinePlainText, escapeInlineText, type InlineTextDocument } from '@surdet/core';
import { InlineTextView } from './inline-text-view.js';
import type { ReadingDiagnostic } from '../../reading-diagnostics.js';
import { DEFAULT_READING_PREFERENCES, normalizeReadingPreferences, type ReadingPreferences } from '../../presentation.js';
import { wrapCjk, wrapCjkMeasure } from '../../text-wrap.js';
import type { PresentationPreferences } from '../../presentation.js';
import { DEFAULT_PRESENTATION_PREFERENCES } from '../../presentation.js';
import { RenderLifecycle } from '../../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import type { DialogueProjectionPort } from '../../api/renderer-commands.js';
import type { NvlPresentationEntry } from '../../api/renderer-queries.js';
import type {
  ChoiceOptionView,
  CommandRailItem,
  FrameRequestHandler,
  SpeakerProfile,
} from '../../types.js';
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
  readonly commandRailTargets: readonly { id: string; x: number; y: number; width: number; height: number }[];
  /** Command-rail root stays fully visible; hover is projected per row. */
  readonly commandRailAlpha: number;
  readonly commandRailSuppressed: boolean;
  readonly backlogLayout: DialogueBacklogLayoutSnapshot;
  readonly nvlActive: boolean;
  readonly nvlLines: readonly string[];
  readonly readingDiagnostics: readonly ReadingDiagnostic[];
}

interface ChoiceView {
  readonly document: InlineTextDocument;
  readonly rich: InlineTextView | null;
  skin?: Sprite;
  readonly holder: Container;
  readonly bg: Graphics;
  readonly bar: Graphics;
  readonly label: PText;
  width: number;
  height: number;
}

interface CommandRailLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DestroyableDisplay {
  parent?: Container | null;
  destroy: (options?: { children?: boolean; context?: boolean }) => void;
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
  #visibleUnits = Infinity;
  #visibleDialogText = '';
  #inlineDocument = parseInlineText('');
  #plainWrap?: { document: InlineTextDocument; width: number; theme: RendererTheme; family: unknown; lines: string[] };
  #dialogContentHeight = 0;
  #lineActive = false;
  #speakerPlate: Graphics;
  #dialogCharsPerLine = 40;
  #dialogPanel: Container;
  #dialogPanelFill: Graphics;
  #dialogSkinSprite: Sprite | null = null;
  #dialogMask: Graphics;
  #choiceMask: Graphics;
  #nvlMask: Graphics;
  #advScroll = 0;
  #choiceScroll = 0;
  #nvlScroll = 0;
  #choiceBottom = 720;
  #dialogRubyLayer: InlineTextView;

  #choiceLayer: Container;
  #choiceViews: ChoiceView[] = [];
  #choiceHighlight = -1;
  #choiceCommitted = false;
  #dialogTop = 466;
  #choiceFadeRemain = 0;
  #choiceFadeDur = 280;

  #continueIndicator: Graphics;
  #continuePhase = 0;
  #continueAwaiting = false;
  #continueIndicatorAnchorX = 0;
  #continueIndicatorAnchorY = 0;
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
  #nvlTextLayer: Container;
  #nvlBackground: Graphics;
  #nvlLines: (PText | InlineTextView)[] = [];
  #nvlLineCounts: number[] = [];
  #nvlEntries: NvlPresentationEntry[] = [];
  #nvlActive = false;

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
  #customUiToolbar = false;
  #commandRailLayout: CommandRailLayout | null = null;
  #commandRailTargets: { id: string; x: number; y: number; width: number; height: number }[] = [];
  #onPointerConsumed: (() => void) | null = null;

  #speakerProfiles = new Map<string, SpeakerProfile>();
  #activeSpeakerId: string | null = null;
  #speakerAvatar: Sprite | null = null;
  #interfaceHidden = false;
  #preferences: PresentationPreferences = { ...DEFAULT_PRESENTATION_PREFERENCES };
  #textSkipping = false;
  #theme: RendererTheme = DEFAULT_RENDERER_THEME;
  #workTheme: RendererTheme = DEFAULT_RENDERER_THEME;
  #reading: ReadingPreferences = { ...DEFAULT_READING_PREFERENCES };
  #backlogContent: { entries: readonly BacklogEntry[]; onReplayVoice?: (voice: string) => void; query: string } | null = null;

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
    this.#dialogMask = bindThemeGraphicsProjection(new Graphics(), [null]);
    this.#choiceMask = bindThemeGraphicsProjection(new Graphics(), [null]);
    this.#nvlMask = bindThemeGraphicsProjection(new Graphics().rect(this.#w * 0.16, 48, this.#w * 0.68, this.#h - 108).fill(0xffffff), [null]);
    this.#choiceLayer.mask = this.#choiceMask;
    this.#choiceLayer.eventMode = 'static';
    this.#choiceLayer.on('wheel', (event) => {
      if (!this.#choiceViews.length) return;
      event.stopPropagation();
      this.#choiceScroll += event.deltaY;
      this.layout();
      this.#requestFrame();
    });
    this.#commandRail = new Container();
    this.#commandRail.visible = false;

    this.#dialogRubyLayer = new InlineTextView();
    this.#nvlLayer = new Container();
    this.#nvlTextLayer = new Container();
    // Keep one permanent mask owner even when no NVL paragraph exists.
    this.#nvlTextLayer.mask = this.#nvlMask;
    this.#nvlLayer.visible = false;
    this.#nvlLayer.eventMode = 'static';
    this.#nvlLayer.on('wheel', (event) => {
      event.stopPropagation();
      this.#nvlScroll += event.deltaY;
      this.#layoutNvl();
      this.#requestFrame();
    });
    this.#nvlBackground = bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.86 }),
      ['panel'],
    );
    this.#nvlLayer.addChild(this.#nvlBackground, this.#nvlTextLayer);

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

    this.#dialogPanel = new Container();
    this.#dialogPanelFill = bindThemeGraphicsProjection(new Graphics(), ['panel', 'line']);
    this.#dialogPanel.addChild(this.#dialogPanelFill);
    this.#drawDialogPanel();
    this.#speakerPlate = bindThemeGraphicsProjection(new Graphics(), ['line']);
    this.#speakerAvatar = new Sprite(Texture.EMPTY);
    this.#speakerAvatar.anchor.set(0.5, 1);
    this.#speakerAvatar.visible = false;

    this.#continueIndicator = bindThemeGraphicsProjection(new Graphics()
      .moveTo(-10, -4).quadraticCurveTo(-3, -3, 0, 4).quadraticCurveTo(3, -3, 10, -4)
      .stroke({ color: this.#theme.colors.line, alpha: 1, width: 2 }), ['line']);
    this.#continueIndicator.visible = false;
    this.#continueIndicator.x = this.#w - 68;
    this.#continueIndicator.y = this.#h - 46;

    this.#backlogLayer = new Container();
    this.#backlogLayer.visible = false;

    this.#speakerText = bindThemeTextProjection(new PText({
      text: '',
      style: {
        fontSize: this.#theme.typography.uiSize,
        fill: this.#theme.colors.accent,
        fontWeight: '600',
        letterSpacing: 1,
        wordWrap: true,
        breakWords: true,
        fontFamily: this.#assets.fontFamily('body'),
        stroke: { width: 0, color: this.#theme.colors.textOnAccent },
      } satisfies TextStyleOptions,
    }), { fill: 'accent', stroke: 'textOnAccent' });
    this.#dialogText = bindThemeTextProjection(new PText({
      text: '',
      style: {
        fontSize: this.#theme.typography.bodySize,
        fill: this.#theme.colors.text,
        fontWeight: '500',
        fontFamily: this.#assets.fontFamily('body'),
        letterSpacing: 0.3,
        lineHeight: this.#theme.typography.bodySize * 1.6,
        stroke: { width: 0, color: this.#theme.colors.textOnAccent },
      } satisfies TextStyleOptions,
    }), { fill: 'text', stroke: 'textOnAccent' });
    this.#dialogText.mask = this.#dialogMask;
    this.#dialogRubyLayer.mask = this.#dialogMask;
    for (const textRoot of [this.#dialogText, this.#dialogRubyLayer]) {
      textRoot.eventMode = 'static';
      textRoot.on('wheel', (event) => {
        event.stopPropagation();
        this.#advScroll += event.deltaY;
        this.layout();
        this.#requestFrame();
      });
    }
    this.#dialogCharsPerLine = Math.max(10, Math.floor((this.#w - 184) / this.#theme.typography.bodySize));

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

  get nvlLines(): readonly (PText | InlineTextView)[] {
    return this.#nvlLines;
  }

  get nvlPresentationEntries(): readonly NvlPresentationEntry[] {
    return this.#nvlEntries.map((entry) => ({ ...entry }));
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
      dialogText: this.#visibleDialogText,
      panelVisible: this.#dialogPanel.visible,
      choiceLabels: this.#choiceViews.map((view) => String(view.label.text)),
      choiceBounds: this.#choiceViews.map((view) => ({
        x: view.holder.x,
        y: view.holder.y,
        width: view.holder.width,
        height: view.holder.height,
      })),
      visibleChoiceCount: this.#interfaceHidden ? 0 : this.#choiceViews.filter((view) => view.holder.visible && view.holder.alpha > 0).length,
      rubyBaseCount: this.#dialogRubyLayer.baseCount,
      rubyTextCount: this.#dialogRubyLayer.rubyCount,
      backlogVisible: this.#backlogLayer.visible,
      backlogAboveDialogueText: this.#backlogAboveDialogueText(),
      commandRailVisible: this.#commandRail.visible,
      commandRailTargets: this.#commandRail.visible && this.#commandRail.alpha > 0
        ? this.#commandRailTargets.map((target) => ({ ...target })) : [],
      commandRailAlpha: this.#commandRail.alpha,
      commandRailSuppressed: this.#commandRailSuppressed,
      backlogLayout: this.#backlogLayoutSnapshot(),
      nvlActive: this.#nvlActive,
      nvlLines: this.#nvlLines.map((line) => String(line.text)),
      readingDiagnostics: this.readingDiagnostics(),
    };
  }

  themeProjectionSnapshot(): LayerThemeProjectionSnapshot {
    return readThemeProjection(this.#dialogueRoot, this.#dialogueOverlayRoot,
      ...(this.#bannerLayer.parent === this.#root ? [this.#bannerLayer] : []));
  }

  readingDiagnostics(): ReadingDiagnostic[] {
    if (this.#disposed) return [];
    if (typeof document === 'undefined') return [{ code: 'TEXT_MEASUREMENT_UNAVAILABLE', severity: 'info',
      target: 'dialogue', text: '', message: '当前环境没有文字测量画布，未执行阅读排版检查。' }];
    const issues: ReadingDiagnostic[] = [];
    const inspect = (text: string, target: string, width: number, available: number): void => {
      issues.push(...this.#assets.fontDiagnostics('body', text, target));
      if (width > available + 1) issues.push({ code: 'TEXT_OVERFLOW', severity: 'warning', target, text,
        message: '文字超过可用宽度，请缩短不可分的注音段、调整字号或作品布局。' });
    };
    const scroll = (target: string, text: string): void => {
      issues.push({ code: 'TEXT_SCROLL', severity: 'info', target, text, message: '本段超过阅读区域，需滚轮翻阅；可缩短段落或调整字号。' });
    };
    if (!this.#interfaceHidden && this.#nvlActive && this.#nvlLayer.renderable) {
      this.#nvlLines.forEach((line, index) => inspect(line.text, `nvl:${index}`, line.width, this.#w * 0.68));
      if (this.#nvlTotalHeight() > this.#h - 120) scroll('nvl', this.#nvlLines.map(line => line.text).join('\n'));
    } else if (!this.#interfaceHidden && this.#lineActive && this.#dialogPanel.renderable) {
      inspect(this.#speakerText.text, 'speaker', this.#speakerText.width, this.#dialogWidth() - 42);
      if (this.#speakerText.y - this.#speakerText.height / 2 < 0) issues.push({ code: 'TEXT_OVERFLOW', severity: 'warning',
        target: 'speaker', text: this.#speakerText.text, message: '名字栏超过画面顶部，请缩短显示名或调整字号。' });
      const textNodes = this.#dialogText.visible ? [this.#dialogText] : this.#dialogRubyLayer.displayTexts;
      const width = this.#dialogText.visible ? this.#dialogText.width
        : Math.max(0, ...textNodes.map(text => text.x + text.width * (1 - text.anchor.x)));
      inspect(textNodes.map(text => text.text).join(''), 'dialogue', width, this.#dialogWidth());
      const height = this.#dialogText.visible ? this.#dialogText.height
        : Math.max(0, ...textNodes.map(text => text.y + text.height * (1 - text.anchor.y)));
      if (height > this.#dialogBottom() - this.#dialogTop - 118 + 1) scroll('dialogue', this.#lastShownDialog);
    }
    if (!this.#interfaceHidden && this.#choiceLayer.renderable && this.#choiceViews.length) {
      this.#choiceViews.forEach((view, index) => inspect(view.label.text, `choice:${index}`, view.label.width, view.width - 80));
      const total = this.#choiceViews.reduce((height, view) => height + view.height + 12, -12);
      if (total > this.#choiceBottom - 24) scroll('choices', this.#choiceViews.map(view => view.label.text).join('\n'));
    }
    return issues;
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
    this.#workTheme = theme;
    theme = { ...theme, typography: { ...theme.typography, bodySize: theme.typography.bodySize * this.#reading.textScale } };
    const previous = this.#theme;
    this.#theme = theme;
    this.#drawDialogPanel();
    this.#drawSpeakerPlate();
    this.#continueIndicator.clear()
      .moveTo(-10, -4).quadraticCurveTo(-3, -3, 0, 4).quadraticCurveTo(3, -3, 10, -4)
      .stroke({ color: theme.colors.line, alpha: 1, width: 2 });
    this.#speakerText.style.fill = theme.colors.accent;
    this.#speakerText.style.stroke = { width: 0, color: theme.colors.textOnAccent };
    this.#dialogText.style.fill = theme.colors.text;
    this.#dialogText.style.stroke = { width: 0, color: theme.colors.textOnAccent };
    this.#nvlBackground.clear().rect(0, 0, this.#w, this.#h).fill({ color: theme.colors.panel, alpha: this.#reading.dialogueOpacity === null ? 0.86
      : Math.min(1, 0.86 * this.#reading.dialogueOpacity / (theme.opacity.panel || 1)) });
    this.#bannerText.style.fill = theme.colors.text;
    for (const view of this.#choiceViews) this.#drawChoiceCard(view, view === this.#choiceViews[this.#choiceHighlight]);
    repaintThemeProjection(this.#dialogueRoot, previous, theme);
    repaintThemeProjection(this.#dialogueOverlayRoot, previous, theme);
    if (this.#bannerLayer.parent === this.#root) repaintThemeProjection(this.#bannerLayer, previous, theme);
    this.#speakerText.style.fontSize = theme.typography.uiSize;
    this.#dialogText.style.fontSize = theme.typography.bodySize;
    this.#dialogText.style.lineHeight = theme.typography.bodySize * 1.6;
    this.#dialogCharsPerLine = Math.max(10, Math.floor(this.#dialogWidth() / theme.typography.bodySize));
    this.#renderDialogText(this.#lastShownDialog);
    if (this.#nvlActive || this.#interfaceHidden) {
      this.#dialogText.visible = false;
      this.#dialogRubyLayer.visible = false;
    }
    this.#reflowNvl();
    for (const view of this.#choiceViews) {
      view.label.style.fontSize = theme.typography.bodySize;
      view.label.style.letterSpacing = theme.typography.uiLetterSpacing;
    }
    this.layout();
    // Entries are laid out with the theme's colours and sizes: refill an open backlog, keeping its scroll.
    const backlog = this.#backlogLayer.visible ? this.#backlogContent : null, entriesLayer = this.#backlogEntriesLayer;
    if (backlog && entriesLayer) {
      entriesLayer.removeChildren().forEach(child => child.destroy({ children: true }));
      this.#backlogContentH = this.#fillBacklogEntries(entriesLayer, backlog.entries, backlog.onReplayVoice);
      this.scrollBacklog(0);
    }
  }

  setReadingPreferences(preferences: Partial<ReadingPreferences>): void {
    this.#reading = normalizeReadingPreferences({ ...this.#reading, ...preferences });
    this.setTheme(this.#workTheme);
    this.#requestFrame();
  }

  /** Hide only the default drawing and hit targets; projection and controller state remain live. */
  setDeclarativeUiSuppression(pages: Partial<Record<import('@surdet/core').ProjectUiPageId, boolean>>): void {
    this.#customUiToolbar = Boolean(pages.toolbar);
    for (const target of [this.#dialogPanel, this.#speakerAvatar!, this.#speakerPlate, this.#speakerText,
      this.#dialogText, this.#dialogRubyLayer, this.#continueIndicator, this.#nvlLayer]) {
      target.alpha = pages.dialogue ? 0 : 1;
      target.renderable = !pages.dialogue;
      target.accessibleChildren = !pages.dialogue;
      target.eventMode = pages.dialogue ? 'none'
        : target === this.#dialogText || target === this.#dialogRubyLayer || target === this.#nvlLayer ? 'static' : 'auto';
    }
    this.#choiceLayer.alpha = pages.choices ? 0 : 1;
    this.#choiceLayer.renderable = !pages.choices;
    this.#choiceLayer.accessibleChildren = !pages.choices;
    this.#choiceLayer.eventMode = pages.choices ? 'none' : 'static';
    this.#commandRail.alpha = pages.toolbar ? 0 : 1;
    this.#commandRail.renderable = !pages.toolbar;
    this.#commandRail.accessibleChildren = !pages.toolbar;
    this.#commandRail.eventMode = pages.toolbar ? 'none' : 'auto';
    this.#backlogLayer.renderable = !pages.backlog;
    this.#backlogLayer.accessibleChildren = !pages.backlog;
    this.#backlogLayer.interactiveChildren = !pages.backlog;
    this.#requestFrame();
  }

  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void {
    this.#preferences = { ...this.#preferences, ...preferences };
    this.#dialogRubyLayer.setAnimationEnabled(!this.#textSkipping && !this.#preferences.reducedMotion);
    if (this.#preferences.reducedMotion) {
      this.#choiceFadeRemain = 0;
      for (const view of this.#choiceViews) view.holder.alpha = 1;
      this.#lifecycle.release('dialogue', 'tween', 'choice-fade');
      this.#continueIndicator.y = this.#continueIndicatorAnchorY; this.#continueIndicator.alpha = 1;
      if (this.#bannerRemain > 0) this.#bannerLayer.alpha = 1;
    }
    this.#requestFrame();
  }

  setTextSkipping(skipping: boolean): void {
    this.#textSkipping = skipping;
    this.#dialogRubyLayer.setAnimationEnabled(!skipping && !this.#preferences.reducedMotion);
    this.#requestFrame();
  }

  refreshSpeakerAvatar(): void {
    this.#updateSpeakerAvatar();
    if (!this.#interfaceHidden && !this.#nvlActive) {
      this.#renderDialogText(this.#lastShownDialog);
      this.layout();
    }
    this.#requestFrame();
  }

  applyTypography(): void {
    this.#plainWrap = undefined;
    this.#dialogRubyLayer.clearText();
    TextStyle.defaultTextStyle.fontFamily = this.#assets.fontFamily('body');
    this.#dialogText.style.fontFamily = this.#assets.fontFamily('body');
    this.#speakerText.style.fontFamily = this.#assets.fontFamily('body');
    this.#bannerText.style.fontFamily = this.#assets.fontFamily('title');
    this.#lastShownSpeaker = undefined;
    this.#renderDialogText(this.#lastShownDialog);
    if (this.#nvlActive || this.#interfaceHidden) {
      this.#dialogText.visible = false;
      this.#dialogRubyLayer.visible = false;
    }
    this.#reflowNvl();
    for (const view of this.#choiceViews) view.label.style.fontFamily = this.#assets.fontFamily('body');
    this.layout();
  }

  layout(): void {
    const textHeight = this.#dialogContentHeight;
    // Keep the stage visible even for a long paragraph; the existing scroll path exposes every line.
    const heightRatio = this.#theme.layout.dialogHeightRatio;
    const panelBottom = this.#dialogBottom();
    this.#dialogTop = heightRatio === null
      ? Math.max(0, Math.min(panelBottom - 188, panelBottom * 0.50), panelBottom - Math.max(188, textHeight + 118))
      : Math.max(0, panelBottom - Math.max(188, this.#h * heightRatio));
    const left = this.#dialogLeft();
    this.#advScroll = Math.max(0, Math.min(Math.max(0, textHeight + this.#dialogTop + 48 - (panelBottom - 70)), this.#advScroll));
    this.#speakerText.position.set(left, this.#dialogTop + 6);
    this.#dialogText.position.set(left, this.#dialogTop + 48 - this.#advScroll);
    this.#dialogRubyLayer.position.set(left, this.#dialogTop + 48 - this.#advScroll);
    this.#dialogMask.clear().rect(left, this.#dialogTop + 44, this.#dialogWidth(), Math.max(1, panelBottom - 114 - this.#dialogTop)).fill(0xffffff);
    this.#speakerAvatar?.position.set(this.#w * 0.025 + this.#dialogMarginX() + 94, panelBottom - 62);
    this.#drawDialogPanel();
    this.#drawSpeakerPlate();
    const gap = 12;
    for (const view of this.#choiceViews) view.rich?.setContent(view.document, this.#w * 0.68 - 80, this.#theme, this.#assets.fontFamily('body'), Infinity, view === this.#choiceViews[this.#choiceHighlight] ? 'accent' : 'text');
    const width = Math.min(this.#w * 0.68, Math.max(440, ...this.#choiceViews.map((view) => (view.rich?.contentWidth ?? view.label.width) + 80)));
    const heights = this.#choiceViews.map((view) => Math.max(56, (view.rich?.contentHeight ?? view.label.height) + 24));
    const totalHeight = heights.reduce((sum, height) => sum + height, 0)
      + Math.max(0, heights.length - 1) * gap;
    const nameHeight = this.#speakerPlate.visible ? Math.max(40, this.#speakerText.height + 12) : 0;
    const bottom = this.#lineActive ? Math.max(80, this.#dialogTop - nameHeight - 20) : this.#h;
    this.#choiceBottom = bottom;
    this.#choiceScroll = Math.max(0, Math.min(Math.max(0, totalHeight - (bottom - 24)), this.#choiceScroll));
    this.#choiceMask.clear().rect(0, 24, this.#w, Math.max(1, bottom - 24)).fill(0xffffff);
    let y = Math.max(24, Math.min((this.#h - totalHeight) / 2, bottom - totalHeight)) - this.#choiceScroll;
    for (const [index, view] of this.#choiceViews.entries()) {
      const height = heights[index]!;
      view.width = width;
      view.height = height;
      view.holder.position.set((this.#w - width) / 2, y);
      view.holder.hitArea = new Rectangle(0, 0, width, height);
      this.#drawChoiceCard(view, index === this.#choiceHighlight);
      y += height + gap;
    }
    this.#applyContinueIndicatorAnchor();
  }

  needsUpdate(): boolean {
    return this.#continueIndicator.visible && !this.#preferences.reducedMotion || this.#dialogRubyLayer.needsUpdate || this.#hasEffectWork();
  }

  update(deltaMs: number): void {
    if (this.#dialogRubyLayer.needsUpdate) this.#dialogRubyLayer.updateAnimation(deltaMs);
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
    this.#updateBanner(deltaMs);
  }

  /** Menu feedback may animate while story dialogue/choices stay frozen. */
  updateFeedback(deltaMs: number): boolean {
    if (this.#disposed || this.#bannerLayer.parent !== this.#root) return false;
    return this.#updateBanner(deltaMs);
  }

  #updateBanner(deltaMs: number): boolean {
    if (this.#bannerRemain > 0) {
      this.#bannerRemain = Math.max(0, this.#bannerRemain - deltaMs);
      const elapsed = this.#bannerDur - this.#bannerRemain;
      this.#bannerLayer.alpha = this.#preferences.reducedMotion ? 1 : Math.min(1, elapsed / 300, this.#bannerRemain / 400);
      if (this.#bannerRemain === 0) {
        this.#bannerLayer.visible = false;
        this.#lifecycle.release('dialogue', 'tween', 'banner');
      }
    }
    return this.#bannerRemain > 0;
  }

  showText(speaker: string | null, value: string, visibleUnits = Infinity): void {
    if (this.#lastShownSpeaker === speaker && this.#lastShownDialog === value && this.#visibleUnits === visibleUnits) return;
    this.#requestFrame();
    if ((speaker ?? '').length > 0 || value.length > 0) this.#lineActive = true;
    this.#lastShownSpeaker = speaker;
    this.#lastShownDialog = value;
    this.#visibleUnits = visibleUnits;
    this.#projectionVersion += 1;
    const profile = speaker ? this.#speakerProfiles.get(speaker.trim()) : undefined;
    this.setActiveSpeaker(profile?.id ?? null);
    this.#speakerText.text = speaker !== null && speaker.length > 0 ? (profile?.name ?? speaker) : '';
    this.#drawSpeakerPlate();
    this.#updateSpeakerAvatar();
    this.#renderDialogText(value);
    this.layout();
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
  beginText(speaker: string | null, value = '', visibleUnits = Infinity): void {
    this.#advScroll = 0;
    this.#lineActive = true;
    this.#lastShownSpeaker = undefined;
    this.#lastShownDialog = '';
    this.showText(speaker, value, visibleUnits);
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
    this.#continueAwaiting = false;
    this.#continueIndicator.visible = false;
  }

  showChoices(options: ChoiceOptionView[]): void {
    this.#requestFrame();
    this.#commandRail.visible = false;
    this.#clearChoices();
    this.#choiceScroll = 0;
    this.#choiceCommitted = false;
    options.forEach((option, index) => {
      const holder = new Container();
      const document = parseInlineText(option.label, 'choice');
      const label = bindThemeTextProjection(new PText({
        text: document.plainText,
        style: { fontSize: this.#theme.typography.bodySize, fill: this.#theme.colors.text, fontFamily: this.#assets.fontFamily('body'), letterSpacing: this.#theme.typography.uiLetterSpacing, wordWrap: true, breakWords: true, wordWrapWidth: this.#w * 0.68 - 80 } satisfies TextStyleOptions,
      }), { fill: 'text' });
      label.position.set(40, 12);
      const bg = bindThemeGraphicsProjection(new Graphics(), ['surface', 'line']);
      const bar = bindThemeGraphicsProjection(new Graphics(), ['line']);
      holder.addChild(bg, bar, label);
      const rich = document.units.some(unit => unit.ruby || unit.style.bold || unit.style.italic || unit.style.size || unit.style.color || unit.style.emphasis) ? new InlineTextView() : null;
      if (rich) { holder.addChild(rich); label.visible = false; }
      const view = { holder, bg, bar, label, document, rich, width: 0, height: 0 };
      this.#choiceViews.push(view);
      this.#registerDisplay(`choice:${index}`, holder);
      this.#drawChoiceCard(view, false);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      bindPlayerControl(holder, { label: document.plainText, width: 1, height: 1, reveal: () => {
        const delta = holder.y < 24 ? holder.y - 24 : Math.max(0, holder.y + view.height - this.#choiceBottom);
        this.#choiceScroll += delta;
        this.layout();
      } });
      holder.on('pointerdown', () => {
        this.#onPointerConsumed?.();
        if (this.#choiceCommitted) return;
        this.#choiceCommitted = true;
        try { this.#onSelect?.(option.index); } catch (error) { this.#choiceCommitted = false; throw error; }
      });
      holder.on('pointerover', () => this.#drawChoiceCard(view, true));
      holder.on('pointerout', () => {
        this.#drawChoiceCard(view, this.#choiceHighlight === this.#choiceViews.indexOf(view));
      });
      this.#choiceLayer.addChild(holder);
    });
    this.#choiceHighlight = -1;
    this.layout();
    if (this.#choiceViews.length > 0 && !this.#preferences.reducedMotion) {
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
    const selected = this.#choiceViews[position];
    if (selected) {
      this.#choiceScroll += selected.holder.y < 24 ? selected.holder.y - 24
        : Math.max(0, selected.holder.y + selected.height - this.#choiceBottom);
    }
    this.layout();
  }

  setAwaiting(awaiting: boolean): void {
    this.#continueAwaiting = awaiting;
    if (this.#nvlActive || this.#interfaceHidden) return;
    this.#continueIndicator.visible = awaiting;
    if (awaiting) this.#dialogPanel.visible = true;
    else if (!this.#lineActive && this.#speakerText.text.length === 0 && this.#dialogText.text.length === 0) this.#dialogPanel.visible = false;
    this.#applyContinueIndicatorAnchor();
    this.#requestFrame();
  }

  updateContinuePulse(deltaMs: number): void {
    if (!this.#continueIndicator.visible) return;
    if (this.#preferences.reducedMotion) { this.#continueIndicator.y = this.#continueIndicatorAnchorY; this.#continueIndicator.alpha = 1; return; }
    this.#continuePhase = (this.#continuePhase + deltaMs / 1000 * 3) % (Math.PI * 2);
    this.#continueIndicator.y = this.#continueIndicatorAnchorY + Math.sin(this.#continuePhase) * 3;
    this.#continueIndicator.alpha = 0.7 + Math.sin(this.#continuePhase) * 0.28;
  }

  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query = ''): void {
    this.#backlogContent = { entries: entries.map(entry => ({ ...entry })), onReplayVoice, query };
    const layer = this.#backlogLayer;
    markPlayerModal(layer, {
      scroll: (delta) => this.scrollBacklog(delta),
      // Search input/escape remain owned by the existing presentation controller and host route.
      allowKey: (event) => event.key === 'Escape' || event.key === 'Backspace'
        || (!event.altKey && !event.metaKey && (event.key.length === 1 || (event.ctrlKey && event.code === 'KeyF'))),
    });
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
    layer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    this.#backlogMask = null;
    layer.addChild(drawPlayerFrame(new Graphics(), this.#theme, 16, 12, this.#w - 32, this.#h - 24, { ornament: true }));
    layer.addChild(bindThemeTextProjection(new PText({
      text: '文字记录 · Ctrl+F 搜索 · 滚轮翻阅',
      style: { fontSize: 22, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text' })).position.set(60, BACKLOG_HEADER_Y);
    const close = bindThemeTextProjection(new PText({ text: '返回', style: { fontSize: this.#theme.typography.uiSize, fill: this.#theme.colors.text } }), { fill: 'text', fontSize: 'uiSize' });
    close.position.set(this.#w - 120, BACKLOG_HEADER_Y);
    bindPlayerControl(close, { label: '返回正文', width: 80, height: 40, x: -8, y: -4 });
    close.on('pointerdown', (event) => { event.stopPropagation?.(); this.#onPointerConsumed?.(); this.hideBacklog(); this.#onBacklogClose?.(); });
    layer.addChild(close);
    const normalizedQuery = query.trim();
    this.#backlogSearchVisible = normalizedQuery.length > 0;
    this.#backlogIdleSearchHintVisible = false;
    this.#backlogViewportTop = this.#backlogSearchVisible
      ? BACKLOG_VIEWPORT_TOP_SEARCH
      : BACKLOG_VIEWPORT_TOP_IDLE;
    layer.addChild(drawPlayerDivider(new Graphics(), this.#theme, 60, this.#backlogViewportTop - 10, this.#w - 120));
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
    const y = this.#fillBacklogEntries(entriesLayer, entries, onReplayVoice);
    this.#backlogContentH = y;
    this.#backlogScroll = 0;
    this.#applyBacklogScroll();
    layer.addChild(entriesLayer, mask);
    layer.visible = true;
    this.#requestFrame();
  }

  /** Plain and styled entries share one view, so their weight, colour and spacing match. Returns the content height. */
  #fillBacklogEntries(entriesLayer: Container, entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void): number {
    let y = 0;
    for (const entry of entries.slice(-120)) {
      const body = entry.markup ?? (entry.text.length > 0 ? escapeInlineText(entry.text) : '（无文本）');
      const view = new InlineTextView(); view.setAnimationEnabled(false);
      const name = entry.speaker ? `<color=accent>${escapeInlineText(`${entry.speaker}：`)}</color>` : '';
      view.setContent(parseInlineText((entry.voice ? '▶ ' : '') + name + body), this.#w * .68, this.#theme, this.#assets.fontFamily('body'), Infinity, 'textMuted');
      view.position.set(this.#w * .16, this.#backlogViewportTop + y);
      if (entry.voice && onReplayVoice) { view.eventMode = 'static'; view.cursor = 'pointer'; view.on('pointerdown', event => {
        this.#onPointerConsumed?.(); event.stopPropagation(); onReplayVoice(entry.voice!);
      }); }
      entriesLayer.addChild(view); y += view.contentHeight;
    }
    return y;
  }

  hideBacklog(): void {
    this.#backlogContent = null;
    this.#backlogLayer.visible = false;
    this.#backlogLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
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
    // Hide the shared root as well: choices and NVL must stop drawing and
    // receiving control input while the canvas is reserved for restoring UI.
    this.#dialogueRoot.visible = !hidden;
    const showAdv = !hidden && !this.#nvlActive;
    this.#dialogPanel.visible = showAdv;
    this.#speakerText.visible = showAdv;
    this.#dialogText.visible = showAdv;
    this.#dialogRubyLayer.visible = showAdv;
    this.#continueIndicator.visible = !hidden && !this.#nvlActive && this.#continueAwaiting;
    this.#commandRail.visible = !hidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#drawSpeakerPlate();
    this.#updateSpeakerAvatar();
    if (!hidden && !this.#nvlActive) {
      this.#renderDialogText(this.#lastShownDialog);
      this.layout();
    }
    this.#requestFrame();
  }

  setSpeakerProfiles(profiles: SpeakerProfile[]): void {
    this.#speakerProfiles.clear();
    const profilesByName = new Map<string, SpeakerProfile[]>();
    for (const profile of profiles) {
      const id = profile.id.trim();
      const name = profile.name.trim();
      if (name.length === 0 || id.length === 0) continue;
      const stored = { ...profile };
      this.#speakerProfiles.set(id, stored);
      const alias = profile.sourceName?.trim() || name;
      const named = profilesByName.get(alias) ?? [];
      named.push(stored);
      profilesByName.set(alias, named);
    }
    for (const [name, named] of profilesByName) {
      if (named.length === 1 && !this.#speakerProfiles.has(name)) {
        this.#speakerProfiles.set(name, named[0]!);
      }
    }
    // A name-only locale change still needs a fresh projection of an unchanged line.
    this.#lastShownSpeaker = undefined;
    this.#reflowNvl();
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
    this.#applyContinueIndicatorAnchor();
    this.#requestFrame();
  }

  setCommandRailItems(items: CommandRailItem[]): void {
    this.#commandRailItems = items.map((item) => ({ ...item }));
    this.#rebuildCommandRail();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#applyContinueIndicatorAnchor();
    this.#requestFrame();
  }

  hideCommandRail(): void {
    this.#commandRailSuppressed = true;
    this.#commandRail.visible = false;
    this.#lifecycle.release('dialogue', 'tween', 'command-rail');
    this.#applyContinueIndicatorAnchor();
    this.#requestFrame();
  }

  restoreCommandRail(): void {
    this.#commandRailSuppressed = false;
    this.#commandRail.visible = !this.#interfaceHidden && this.#commandRailItems.length > 0;
    this.#commandRail.alpha = this.#customUiToolbar ? 0 : 1;
    this.#applyContinueIndicatorAnchor();
    this.#requestFrame();
  }

  showBanner(text: string, variant: 'chapter' | 'tip'): void {
    if (this.#disposed || text.length === 0) return;
    // Tips must remain visible over menus; chapter presentation stays below them.
    (variant === 'tip' ? this.#root : this.#dialogueRoot).addChild(this.#bannerLayer);
    this.#bannerText.text = text;
    this.#bannerText.style = variant === 'chapter'
      ? { fontSize: 38, fill: this.#theme.colors.text, fontWeight: 'normal', letterSpacing: 6, fontFamily: this.#assets.fontFamily('title') } satisfies TextStyleOptions
      : { fontSize: 20, fill: this.#theme.colors.text, fontFamily: this.#assets.fontFamily('ui'),
        wordWrap: true, breakWords: true, wordWrapWidth: Math.max(120, this.#w - 120) } satisfies TextStyleOptions;
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
    this.#bannerLayer.alpha = this.#preferences.reducedMotion ? 1 : 0;
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

  appendNvlText(speaker: string | null, text: string, markup?: string): void {
    const normalizedSpeaker = speaker !== null && speaker.length > 0 ? speaker : null;
    const profile = normalizedSpeaker ? this.#speakerProfiles.get(normalizedSpeaker.trim()) : undefined;
    this.setActiveSpeaker(profile?.id ?? null);
    this.#projectionVersion += 1;
    const wrapped = this.#wrapNvlText(normalizedSpeaker, text);
    let textNode: PText | InlineTextView;
    if (markup !== undefined) {
      textNode = new InlineTextView(); textNode.setAnimationEnabled(false);
      const name = normalizedSpeaker ? this.#speakerProfiles.get(normalizedSpeaker.trim())?.name ?? normalizedSpeaker : null;
      textNode.setContent(parseInlineText((name ? escapeInlineText(`${name}：`) : '') + markup), this.#w * .68, this.#theme, this.#assets.fontFamily('body'));
    } else {
      textNode = bindThemeTextProjection(new PText({
        text: wrapped.join('\n'),
        style: { fontSize: this.#theme.typography.bodySize, lineHeight: this.#theme.typography.bodySize * 1.6, fill: this.#theme.colors.text, fontFamily: this.#assets.fontFamily('body') } satisfies TextStyleOptions,
      }), { fill: 'text' });
    }
    this.#nvlTextLayer.addChild(textNode);
    this.#nvlLines.push(textNode);
    this.#nvlLineCounts.push(textNode instanceof InlineTextView ? textNode.contentHeight / (this.#theme.typography.bodySize * 1.6) : Math.max(1, wrapped.length));
    this.#nvlEntries.push({ speaker: normalizedSpeaker, text, ...(markup === undefined ? {} : { markup }) });
    const budget = this.#h - 120;
    while (this.#nvlTotalHeight() > budget && this.#nvlLines.length > 1) {
      const old = this.#nvlLines.shift()!;
      this.#nvlLineCounts.shift();
      this.#nvlEntries.shift();
      this.#nvlTextLayer.removeChild(old);
      old.destroy({ children: true });
    }
    this.#nvlScroll = 0;
    this.#layoutNvl();
    this.#requestFrame();
  }

  clearNvlText(): void {
    this.#nvlScroll = 0;
    for (const line of this.#nvlLines) {
      this.#nvlTextLayer.removeChild(line);
      line.destroy({ children: true });
    }
    this.#nvlLines = [];
    this.#nvlLineCounts = [];
    this.#nvlEntries = [];
    if (this.#nvlActive) {
      this.setActiveSpeaker(null);
      this.#projectionVersion += 1;
    }
    this.#requestFrame();
  }

  reset(): void {
    if (this.#disposed) return;
    this.#requestFrame();
    this.#lastShownSpeaker = undefined;
    this.#lastShownDialog = '';
    this.#visibleDialogText = ''; this.#visibleUnits = Infinity; this.#dialogContentHeight = 0;
    this.#advScroll = 0;
    this.#choiceScroll = 0;
    this.#lineActive = false;
    this.#clearChoices();
    this.hideBacklog();
    this.#lifecycle.release('dialogue', 'listener', 'backlog-overlay');
    this.#backlogLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
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
    this.#continueAwaiting = false;
    this.#continueIndicator.visible = false;
    this.#continuePhase = 0;
    this.#interfaceHidden = false;
    this.#dialogueRoot.visible = true;
    this.#commandRailSuppressed = false;
    this.#commandRail.visible = this.#commandRailItems.length > 0;
    this.#commandRail.alpha = this.#customUiToolbar ? 0 : 1;
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
      this.#nvlTextLayer.removeChild(line);
      line.destroy({ children: true });
    }
    this.#nvlLines = [];
    this.#nvlLineCounts = [];
    this.#nvlEntries = [];
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
      // The full-screen reading surface receives scrolls, but must stay below interactive controls.
      ['nvl-layer', this.#nvlLayer],
      ['choice-layer', this.#choiceLayer],
      ['command-rail', this.#commandRail],
      ['banner-layer', this.#bannerLayer],
      ['dialog-reading-mask', this.#dialogMask],
      ['choice-reading-mask', this.#choiceMask],
      ['nvl-reading-mask', this.#nvlMask],
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
      display.destroy({ children: true, context: true });
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
    if (plain.length === 0) return [];
    this.#dialogCharsPerLine = Math.max(10, Math.floor(this.#dialogWidth() / this.#theme.typography.bodySize));
    const ctx = getDialogMeasureCtx();
    if (!ctx) return wrapCjk(plain, this.#dialogCharsPerLine);
    const style = this.#dialogText.style;
    const family = style.fontFamily;
    const familyText = Array.isArray(family) ? family.join(', ') : String(family);
    ctx.font = `${style.fontWeight} ${style.fontSize}px ${familyText}`;
    return wrapCjkMeasure(plain, this.#dialogWidth() - Number(style.fontSize), (text) =>
      ctx.measureText(text).width + Math.max(0, Array.from(text).length - 1) * style.letterSpacing);
  }

  #dialogLeft(): number {
    return this.#w * 0.025 + this.#dialogMarginX() + (this.#speakerAvatar?.visible ? 200 : 46);
  }
  #dialogMarginX(): number { return Math.min(Math.max(0, this.#w / 2 - 240), this.#theme.layout.dialogMarginX ?? 0); }
  #dialogBottom(): number { return Math.max(188, this.#h - (this.#theme.layout.dialogMarginBottom ?? 0)); }
  #dialogWidth(): number { return Math.max(120, this.#w - this.#dialogLeft() - this.#dialogMarginX() - 78); }

  #drawDialogPanel(): void {
    const opacity = this.#reading.dialogueOpacity ?? this.#theme.opacity.panel;
    const skinKey = this.#theme.skins.dialogSkin;
    const skinTexture = skinKey ? this.#assets.resolveBackground(skinKey) : null;
    if (skinTexture) {
      if (!this.#dialogSkinSprite) {
        this.#dialogSkinSprite = new Sprite(skinTexture);
        this.#dialogPanel.addChild(this.#dialogSkinSprite);
      } else {
        this.#dialogSkinSprite.texture = skinTexture;
      }
      const top = this.#dialogTop;
      this.#dialogSkinSprite.visible = true;
      this.#dialogSkinSprite.position.set(this.#dialogMarginX(), top);
      this.#dialogSkinSprite.width = this.#w - 2 * this.#dialogMarginX();
      this.#dialogSkinSprite.height = Math.max(1, this.#dialogBottom() - top);
      this.#dialogSkinSprite.alpha = opacity;
      this.#dialogPanelFill.clear();
      bindThemeGraphicsProjection(this.#dialogPanelFill, []);
      return;
    }
    if (this.#dialogSkinSprite) {
      this.#dialogSkinSprite.visible = false;
    }
    const panel = this.#dialogPanelFill.clear();
    const top = this.#dialogTop;
    // Fade into the scenery above the text, keeping the actual reading area stable.
    const fadeHeight = 44;
    for (let step = 0; step < 22; step++) {
      panel.rect(this.#dialogMarginX(), top - fadeHeight + step * 2, this.#w - 2 * this.#dialogMarginX(), 2)
        .fill({ color: this.#theme.colors.panel, alpha: opacity * step / 22 });
    }
    panel.rect(this.#dialogMarginX(), top, this.#w - 2 * this.#dialogMarginX(), this.#dialogBottom() - top).fill({ color: this.#theme.colors.panel, alpha: opacity });
    panel.moveTo(this.#dialogMarginX(), top + 1).lineTo(this.#w - this.#dialogMarginX(), top + 1).stroke({ color: this.#theme.colors.line, width: 1.5, alpha: 0.85 });
    bindThemeGraphicsProjection(panel, [...Array<keyof RendererTheme['colors']>(23).fill('panel'), 'line']);
  }

  #drawSpeakerPlate(): void {
    this.#speakerPlate.clear();
    const show = this.#speakerText.text.length > 0 && !this.#interfaceHidden && !this.#nvlActive;
    this.#speakerPlate.visible = show;
    if (!show) return;
    this.#speakerText.style.wordWrapWidth = Math.max(1, this.#dialogWidth() - 42);
    const w = Math.min(this.#dialogWidth(), Math.max(176, this.#speakerText.width + 42));
    const height = Math.max(40, this.#speakerText.height + 12);
    const x = this.#dialogLeft() - 18, y = this.#dialogTop;
    this.#speakerPlate.poly([x + 10, y - height + 2, x + w, y - height + 2, x + w - 10, y + 2, x, y + 2])
      .fill({ color: this.#theme.colors.panel, alpha: this.#reading.dialogueOpacity ?? this.#theme.opacity.panel });
    this.#speakerPlate.moveTo(x + 8, y + 1).lineTo(x + w * 0.42, y + 1)
      .bezierCurveTo(x + w * 0.66, y + 2, x + w * 0.73, y - 20, x + w - 4, y - 9)
      .stroke({ color: this.#theme.colors.line, width: 1.5, alpha: 0.9 });
    bindThemeGraphicsProjection(this.#speakerPlate, ['panel', 'line']);
    this.#speakerText.anchor.set(0.5);
    this.#speakerText.position.set(x + w / 2, y + 2 - height / 2);
  }

  #renderDialogText(value: string): void {
    if (this.#inlineDocument.source !== value) this.#inlineDocument = parseInlineText(value);
    const doc = this.#inlineDocument;
    this.#visibleDialogText = doc.units.slice(0, this.#visibleUnits).map(unit => unit.text).join('');
    const family = this.#dialogText.style.fontFamily;
    const familyText = Array.isArray(family) ? family.join(', ') : String(family);
    const rich = doc.units.some(unit => unit.ruby || unit.style.bold || unit.style.italic || unit.style.color || unit.style.size || unit.style.effect || unit.style.emphasis);
    this.#dialogText.visible = !rich;
    this.#dialogRubyLayer.visible = rich;
    if (rich) {
      this.#dialogText.text = '';
      this.#dialogRubyLayer.setContent(doc, this.#dialogWidth(), this.#theme, familyText, this.#visibleUnits);
      this.#dialogRubyLayer.setAnimationEnabled(!this.#preferences.reducedMotion && !this.#textSkipping);
      this.#dialogContentHeight = this.#dialogRubyLayer.contentHeight;
      return;
    }
    this.#hideRubyPool();
    if (!this.#plainWrap || this.#plainWrap.document !== doc || this.#plainWrap.width !== this.#dialogWidth()
      || this.#plainWrap.theme !== this.#theme || this.#plainWrap.family !== familyText) {
      this.#plainWrap = { document: doc, width: this.#dialogWidth(), theme: this.#theme, family: familyText, lines: this.#wrapDialogText(doc.plainText) };
    }
    const lines = this.#plainWrap.lines, shown = this.#visibleDialogText.length;
    const revealed: string[] = [];
    let cursor = 0;
    for (const line of lines) {
      if (cursor >= shown) break;
      revealed.push(line.slice(0, Math.max(0, shown - cursor)));
      cursor += line.length;
      if (doc.plainText.startsWith('\r\n', cursor)) cursor += 2;
      else if (doc.plainText[cursor] === '\n' || doc.plainText[cursor] === '\r') cursor++;
    }
    this.#dialogText.text = revealed.join('\n');
    this.#dialogContentHeight = doc.units.length ? lines.length * this.#theme.typography.bodySize * 1.6 : 0;
  }

  #hideRubyPool(): void { this.#dialogRubyLayer.clearText(); }

  #destroyRubyPools(): void {
    // Child display resources are owned and destroyed with the registered layer root.
    this.#dialogRubyLayer.clearText();
  }

  #drawChoiceCard(view: ChoiceView, selected: boolean): void {
    view.rich?.setContent(view.document, this.#w * 0.68 - 80, this.#theme, this.#assets.fontFamily('body'), Infinity, selected ? 'accent' : 'text');
    view.label.style.fontSize = this.#theme.typography.bodySize;
    view.label.style.fill = selected ? this.#theme.colors.accent : this.#theme.colors.text;
    bindThemeTextProjection(view.label, { fill: selected ? 'accent' : 'text', fontSize: 'bodySize' });
    const w = view.width;
    const h = view.height;
    drawPlayerFrame(view.bg, this.#theme, 0, 0, w, h,
      { color: selected ? 'surfaceStrong' : 'panel', alpha: this.#theme.opacity.surface, active: selected });
    const key = this.#theme.skins.buttonSkin;
    const texture = key ? this.#assets.resolveBackground(key) : null;
    let skin = view.skin;
    if (texture) {
      if (!skin) { skin = new Sprite(texture); view.holder.addChildAt(skin, 1); view.skin = skin; }
      skin.texture = texture;
      skin.visible = true;
      skin.width = w; skin.height = h;
      skin.alpha = this.#theme.opacity.surface;
      skin.eventMode = 'none';
    } else if (skin) skin.visible = false;
    view.bar.clear();
    if (selected) view.bar.moveTo(16, h / 2 - 5).lineTo(23, h / 2).lineTo(16, h / 2 + 5)
      .stroke({ color: this.#theme.colors.accent, width: 1.5, alpha: 0.95 });
    bindThemeGraphicsProjection(view.bar, ['accent']);
    view.label.position.set(40, Math.max(12, (h - view.label.height) / 2));
    view.rich?.position.set(40, Math.max(12, (h - view.rich.contentHeight) / 2));
    this.#requestFrame();
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

  #wrapNvlText(speaker: string | null, text: string): string[] {
    const name = speaker ? this.#speakerProfiles.get(speaker.trim())?.name ?? speaker : null;
    const raw = name ? `${name}：${text}` : text;
    const size = this.#theme.typography.bodySize;
    const width = this.#w * 0.68 - size;
    const ctx = getDialogMeasureCtx();
    if (!ctx) return wrapCjk(raw, Math.max(1, Math.floor(width / size)));
    ctx.font = `400 ${size}px ${this.#assets.fontFamily('body')}`;
    return wrapCjkMeasure(raw, width, value => ctx.measureText(value).width);
  }

  #reflowNvl(): void {
    this.#nvlEntries.forEach((entry, index) => {
      const wrapped = this.#wrapNvlText(entry.speaker, entry.text);
      const node = this.#nvlLines[index]!;
      if (node instanceof InlineTextView) {
        const name = entry.speaker ? this.#speakerProfiles.get(entry.speaker.trim())?.name ?? entry.speaker : null;
        node.setContent(parseInlineText((name ? escapeInlineText(`${name}：`) : '') + (entry.markup ?? escapeInlineText(entry.text))), this.#w * .68, this.#theme, this.#assets.fontFamily('body'));
        this.#nvlLineCounts[index] = node.contentHeight / (this.#theme.typography.bodySize * 1.6); return;
      }
      node.text = wrapped.join('\n');
      node.style.fontFamily = this.#assets.fontFamily('body');
      node.style.fontSize = this.#theme.typography.bodySize;
      node.style.lineHeight = this.#theme.typography.bodySize * 1.6;
      this.#nvlLineCounts[index] = Math.max(1, wrapped.length);
    });
    this.#layoutNvl();
  }

  #nvlTotalHeight(): number {
    let height = 0;
    for (const count of this.#nvlLineCounts) height += count * this.#theme.typography.bodySize * 1.6 + this.#theme.spacing.md;
    return height;
  }

  #layoutNvl(): void {
    this.#nvlScroll = Math.max(0, Math.min(Math.max(0, this.#nvlTotalHeight() - (this.#h - 120)), this.#nvlScroll));
    let y = 60 - this.#nvlScroll;
    this.#nvlLines.forEach((line, index) => {
      line.position.set(this.#w * 0.16, y);
      y += this.#nvlLineCounts[index]! * this.#theme.typography.bodySize * 1.6 + this.#theme.spacing.md;
    });
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
    const size = Math.min(160, 196 * texture.width / Math.max(1, texture.height));
    sprite.width = size;
    sprite.height = size * (texture.height / Math.max(1, texture.width));
    sprite.position.set(this.#w * 0.025 + this.#dialogMarginX() + 94, this.#dialogBottom() - 62);
    sprite.alpha = 1;
    sprite.visible = true;
  }

  #rebuildCommandRail(): void {
    const layer = this.#commandRail;
    this.#commandRailTargets = [];
    layer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    if (this.#commandRailItems.length === 0) {
      this.#commandRailLayout = null;
      return;
    }
    const railH = 38;
    const count = this.#commandRailItems.length;
    const slotW = 62;
    const slotGap = 8;
    const railPad = 8;
    const railW = railPad * 2 + count * slotW + (count - 1) * slotGap;
    const startX = Math.max(12, this.#w - railW - 48);
    const top = this.#h - railH - 20;
    this.#commandRailLayout = { x: startX, y: top, width: railW, height: railH };
    const separators = new Graphics();
    for (let index = 1; index < count; index++) {
      const x = startX + railPad + index * (slotW + slotGap) - slotGap / 2;
      separators.moveTo(x, top + 12).lineTo(x, top + 25)
        .stroke({ width: 0.6, color: this.#theme.colors.line, alpha: 0.65 });
    }
    layer.addChild(bindThemeGraphicsProjection(separators, Array<keyof RendererTheme['colors']>(Math.max(0, count - 1)).fill('line')));

    this.#commandRailItems.forEach((item, index) => {
      const row = new Container();
      row.position.set(startX + railPad + index * (slotW + slotGap), top + 3);
      this.#commandRailTargets.push({ id: item.id, x: row.x, y: row.y, width: slotW, height: railH - 6 });
      const hit = new Graphics();
      const paintHit = (active: boolean): void => {
        bindThemeGraphicsProjection(hit.clear().rect(0, 0, slotW, railH - 6)
          .fill({ color: this.#theme.colors.panel, alpha: active ? 0.6 : 0.001 }), ['panel']);
      };
      paintHit(item.active === true);
      const label = bindThemeTextProjection(new PText({
        text: item.label,
        style: {
          fontSize: 18,
          fontWeight: '600',
          fill: item.enabled === false ? this.#theme.colors.textDisabled : item.active ? this.#theme.colors.text : this.#theme.colors.textMuted,
          letterSpacing: 0,
          fontFamily: this.#assets.fontFamily('ui'),
        } satisfies TextStyleOptions,
      }), { fill: item.enabled === false ? 'textDisabled' : item.active ? 'text' : 'textMuted' });
      label.anchor.set(0.5);
      label.position.set(slotW / 2, (railH - 6) / 2);
      label.alpha = 1;
      const underline = bindThemeGraphicsProjection(new Graphics()
        .rect(10, railH - 8, slotW - 20, 1.5)
        .fill({ color: this.#theme.colors.line, alpha: item.active ? 0.9 : 0 }), ['line']);
      row.addChild(hit, label, underline);
      bindPlayerControl(row, { label: item.tooltip ?? item.label, width: slotW, height: railH - 6, enabled: item.enabled !== false });
      row.alpha = item.enabled === false ? 0.38 : 1;
      if (item.enabled !== false) {
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointerover', () => {
          label.alpha = 1;
          underline.clear().rect(10, railH - 8, slotW - 20, 1.5)
            .fill({ color: this.#theme.colors.line, alpha: 0.9 });
          label.style.fill = this.#theme.colors.accent;
          paintHit(true);
        });
        row.on('pointerout', () => {
          label.alpha = 1;
          underline.clear().rect(10, railH - 8, slotW - 20, 1.5)
            .fill({ color: this.#theme.colors.line, alpha: item.active ? 0.9 : 0 });
          label.style.fill = item.active ? this.#theme.colors.text : this.#theme.colors.textMuted;
          paintHit(item.active === true);
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

  #applyContinueIndicatorAnchor(): void {
    if (!this.#continueAwaiting || this.#interfaceHidden || this.#nvlActive) {
      this.#continueIndicator.visible = false;
      return;
    }

    const rail = this.#commandRail.visible ? this.#commandRailLayout : null;
    if (rail) {
      this.#continueIndicatorAnchorX = this.#w - 68;
      this.#continueIndicatorAnchorY = Math.min(this.#dialogTop + 70, rail.y - 24);
    } else {
      this.#continueIndicatorAnchorX = this.#w - 68;
      this.#continueIndicatorAnchorY = this.#dialogBottom() - 46;
    }
    this.#continueIndicator.position.set(this.#continueIndicatorAnchorX, this.#continueIndicatorAnchorY);
    this.#continueIndicator.visible = true;
  }

  #hasEffectWork(): boolean {
    return (this.#choiceFadeRemain > 0 && this.#choiceViews.length > 0)
      || this.#bannerRemain > 0;
  }
}
