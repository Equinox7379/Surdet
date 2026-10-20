import { GAME_SETTING_DEFINITIONS, PROJECT_UI_TAB_BAR_HEIGHT, evalExprBoolean, parseInlineText, projectUiChildrenRect, projectUiContentRect, projectUiRect, resolveProjectUiInteractionStyle, resolveProjectUiMotion, resolveProjectUiStyle, type InlineStyle, type ProjectUiInteraction, type ProjectUiMotion, type VarValue, type ProjectUiAction, type ProjectUiBinding, type ProjectUiContentSource, type ProjectUiDocument, type ProjectUiNode, type ProjectUiPageId, type ProjectUiRect, type ProjectUiText } from '@surdet/core';
import type { RendererTheme } from './theme.js';
import { SETTING_STEPS } from './settings-store.js';
import { fontTextDiagnostics, isUiTextClipped, type ReadingDiagnostic } from './reading-diagnostics.js';
import type { BacklogEntry } from './backlog.js';
import { applyProjectUiTypography, createProjectUiDecor, createProjectUiImageSizes, projectUiInsetCss, projectUiLineStep, projectUiShadowCss, usesProjectUiBox, type ProjectUiDecorImage } from './project-ui-style-dom.js';
import type { ProjectUiMotionController, ProjectUiMotionPose } from './project-ui-motion.js';

export interface ProjectUiItem {
  id: string;
  source?: ProjectUiContentSource;
  label: string;
  /** Backlog items only: recorded plain speaker/text and optional static inline source. Not HTML. */
  backlog?: BacklogEntry;
  description?: string;
  value?: string | number | boolean;
  date?: string;
  disabled?: boolean;
  empty?: boolean;
  readError?: string;
  backupAvailable?: boolean;
}

export interface ProjectUiContext {
  mode?: 'save' | 'load';
  literal?(objectRef: string, original: string, field?: 'tab'): string;
  data(field: Extract<ProjectUiText, { kind: 'data' }>['field']): unknown;
  read(name: string, kind: 'variable' | 'setting'): unknown;
  write(binding: ProjectUiBinding, value: string | number | boolean): void | Promise<void>;
  bounds(binding: ProjectUiBinding): { min: number; max: number; step: number };
  content(source: ProjectUiContentSource): readonly ProjectUiItem[];
  select(source: ProjectUiContentSource, item: ProjectUiItem, restore?: boolean): void | boolean | Promise<void | boolean>;
  action(action: ProjectUiAction, item?: ProjectUiItem): void | Promise<void>;
}

export interface ProjectUiDomOptions {
  canvas: HTMLCanvasElement;
  document: ProjectUiDocument;
  theme: RendererTheme;
  fontFamily: (role: 'body' | 'title' | 'ui') => string;
  fontDiagnostics?: (role: 'body' | 'title' | 'ui', text: string, target: string) => readonly ReadingDiagnostic[];
  imageUrl: (key: string) => string | undefined;
  titleBackgroundUrl?: string;
  isPageVisible?: (page: ProjectUiPageId) => boolean;
  onError: (error: unknown) => void;
  /**
   * The one shared page-motion driver that is also passed to `createRendererRuntime({ projectUiMotion })`.
   * Runtime wiring only, not a work field; without it pages appear and close at once as before.
   */
  motion?: ProjectUiMotionController;
  /** The player's reduced-motion setting when the UI is created; later changes go through `setReducedMotion`. */
  reducedMotion?: boolean;
}

export interface ProjectUiDom {
  show(page: ProjectUiPageId, context: ProjectUiContext): void;
  hide(page: ProjectUiPageId): void;
  refresh(): void;
  readingDiagnostics(): ReadingDiagnostic[];
  resize(): void;
  ownsInput(target: EventTarget | null): boolean;
  showGalleryImage(assetKey: string, label: string): void;
  confirm(message: string): Promise<boolean>;
  /** Reduced motion on: every running page projection jumps to its end state now; later pages show statically. */
  setReducedMotion(reduce: boolean): void;
  /**
   * A new session (load, new game, replay, rollback): cancel this UI's page projections without their callbacks,
   * drop every closing page at once and put open pages at their stable pose.
   */
  resetMotion(): void;
  dispose(): void;
}

const MODAL_PAGES = new Set<ProjectUiPageId>(['title', 'system-menu', 'save-load', 'settings', 'gallery', 'backlog']);
const PAGE_LEVEL: Record<ProjectUiPageId, number> = { hud: 1, dialogue: 2, toolbar: 3, choices: 4, title: 10, 'system-menu': 11, 'save-load': 12, settings: 12, gallery: 12, backlog: 12 };
const DESIGN_FRAME: ProjectUiRect = { x: 0, y: 0, width: 1280, height: 720 };
const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
const isSwitchSetting = (name: string): boolean => Object.hasOwn(GAME_SETTING_DEFINITIONS, name)
  && GAME_SETTING_DEFINITIONS[name as keyof typeof GAME_SETTING_DEFINITIONS].type === 'boolean';

/**
 * Reading text follows the player's text scale: the dialogue body on the dialogue page and the
 * option text on the choices page. Speaker names and system pages keep the author's size.
 */
function readingScale(context: ProjectUiContext): number {
  const value = context.read('textScale', 'setting'), { min, max } = GAME_SETTING_DEFINITIONS.textScale;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 1;
}

function isReadingText(page: ProjectUiPageId, node: ProjectUiNode, item?: ProjectUiItem): boolean {
  if (page === 'dialogue') return node.text?.kind === 'data' && node.text.field === 'dialogue';
  return page === 'choices' && (item?.source === 'choices' || node.action?.kind === 'choice');
}

interface Display {
  page: ProjectUiPageId;
  node: ProjectUiNode;
  element: HTMLDivElement;
  context: ProjectUiContext;
  bindings: Array<() => void>;
  contents: Array<{ element: HTMLElement; source: ProjectUiContentSource; template: readonly ProjectUiNode[]; columns: 1 | 2; rect: ProjectUiRect; signature: string; bindings: Array<() => void> }>;
  pending: boolean;
  /** Set by hide: from then on the page is only a picture (inert, never refreshed or re-enabled). */
  closed: boolean;
  /** The page's own keyboard focus marker for state-bearing controls; never part of a node group. */
  marker: HTMLDivElement | null;
  /** Transparent stand-in for a modal page while it is still moving in, so nothing reaches the layers below. */
  blocker: HTMLDivElement | null;
  /** The last painted page pose; an exit started mid-entry continues from here. */
  pose: ProjectUiMotionPose;
  /**
   * True from the refresh that hid a page that was on screen until the next animation frame, i.e. before the hidden
   * page was ever painted. The Player Shell commits its session (whose listener refreshes this UI) before it asks the
   * provider to hide the page, so a page closing normally is already hidden when hide() runs; it is still the picture
   * on screen and plays its exit.
   */
  hiddenThisFrame: boolean;
}

const STABLE_POSE: ProjectUiMotionPose = { opacity: 1, x: 0, y: 0, scale: 1 };
const matches = (element: Element, selector: string): boolean => {
  try { return element.matches(selector); } catch { return selector === ':focus-visible' && element.matches(':focus'); }
};

/** Runtime projection only. The caller retains every game, save and Shell controller. */
export function createProjectUiDom(options: ProjectUiDomOptions): ProjectUiDom {
  const canvas = options.canvas;
  const theme = options.theme;
  const root = document.createElement('div');
  root.dataset.surdetProjectUi = 'true';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;overflow:hidden';
  canvas.parentElement?.appendChild(root);
  const design = document.createElement('div');
  design.style.cssText = 'position:absolute;width:1280px;height:720px;transform-origin:top left;pointer-events:none';
  root.appendChild(design);
  const errorStatus = document.createElement('div'); errorStatus.setAttribute('role', 'alert');
  errorStatus.style.cssText = `position:absolute;left:24px;right:24px;bottom:16px;z-index:200;pointer-events:none;background:${hex(theme.colors.panel)};color:${hex(theme.colors.text)};font:20px sans-serif;white-space:pre-wrap`;
  root.appendChild(errorStatus);
  const pages = new Map<ProjectUiPageId, Display>();
  let disposed = false;
  let frame = 0;
  let confirmation: { element: HTMLElement; finish(accepted: boolean): void } | null = null;
  let refreshFailure: string | null = null;
  const motion = options.motion;
  let reduceMotion = options.reducedMotion === true;
  /** Closed pages still playing their visual exit, one per page slot. */
  const ghosts = new Map<ProjectUiPageId, HTMLDivElement>();
  /** Page slots with a projection on the shared driver (an entering page or a closing ghost). */
  const running = new Set<ProjectUiPageId>();

  const report = (error: unknown): void => { const message = error instanceof Error ? error.message : String(error);
    if (errorStatus.textContent !== message) { errorStatus.textContent = message; options.onError(error); } };
  const color = (value: number | undefined, fallback: number): string => hex(value ?? fallback);
  const imageSizes = createProjectUiImageSizes();
  const px = (value: number): string => `${value}px`;
  const wrap = (promise: void | Promise<void>): void => { void Promise.resolve(promise).catch(report); };
  // Static formatting only, as in the built-in backlog: speed and shake/wave are never drawn.
  const styled = (style: InlineStyle, content: Node): Node => {
    if (!style.bold && !style.italic && style.color === undefined && style.size === undefined) return content;
    const span = document.createElement('span');
    if (style.bold) span.style.fontWeight = '700';
    if (style.italic) span.style.fontStyle = 'italic';
    if (style.color !== undefined) span.style.color = style.color.startsWith('#') ? style.color
      : color(theme.colors[style.color as keyof RendererTheme['colors']], theme.colors.text);
    if (style.size !== undefined) span.style.fontSize = `${style.size}em`;
    span.appendChild(content);
    return span;
  };
  /**
   * The recorded plain label stays the row's accessible name; the styled copy is visual only.
   * Only `entry.markup` is parsed: the speaker and plain text are never read as tags.
   */
  const appendBacklogText = (title: HTMLElement, label: string, entry: BacklogEntry): void => {
    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    const shown = document.createElement('span');
    shown.dataset.uiBacklogText = 'true';
    shown.setAttribute('aria-hidden', 'true');
    // The built-in backlog's body weight, so <b> stays distinguishable from ordinary text.
    title.style.fontWeight = '500';
    if (entry.speaker) shown.append(`${entry.speaker}：`);
    if (entry.markup === undefined) shown.append(entry.text);
    else {
      let run: { style: InlineStyle; text: Text } | null = null;
      for (const unit of parseInlineText(entry.markup).units) {
        if (unit.ruby === undefined && run?.style === unit.style) { run.text.appendData(unit.text); continue; }
        const text = document.createTextNode(unit.text);
        let content: Node = text;
        if (unit.style.emphasis) {
          // Chromium paints no emphasis dots on the same side as a ruby reading, so those go below.
          const marks = document.createElement('span');
          marks.style.setProperty('text-emphasis', 'filled dot');
          marks.style.setProperty('text-emphasis-position', unit.ruby === undefined ? 'over right' : 'under right');
          marks.appendChild(text);
          content = marks;
        }
        if (unit.ruby === undefined) run = { style: unit.style, text };
        else {
          const ruby = document.createElement('ruby'), reading = document.createElement('rt');
          reading.textContent = unit.ruby;
          ruby.append(content, reading);
          content = ruby; run = null;
        }
        shown.appendChild(styled(unit.style, content));
      }
    }
    title.append(name, shown);
  };
  const syncFocusMarkers = (): void => { if (!disposed) for (const display of pages.values()) updateFocusMarker(display); };
  root.addEventListener('focusin', syncFocusMarkers);
  root.addEventListener('focusout', syncFocusMarkers);
  root.addEventListener('keydown', event => {
    refresh();
    const active = [...pages].filter(([, display]) => !display.element.hidden).sort(([a], [b]) => PAGE_LEVEL[b] - PAGE_LEVEL[a])[0];
    if (!confirmation && (!active || !MODAL_PAGES.has(active[0]))) return;
    const viewer = confirmation?.element ?? active?.[1].element.querySelector<HTMLElement>('[data-ui-viewer]');
    if (event.key === 'Tab') {
      const focusable = Array.from((viewer ?? active![1].element).querySelectorAll<HTMLElement>('button,input,[tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && !element.closest('[hidden]'));
      event.preventDefault(); event.stopPropagation();
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? focusable.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next]?.focus();
      return;
    }
    if (event.key === 'Escape' && confirmation) { event.preventDefault(); event.stopPropagation(); confirmation.finish(false); return; }
    if (event.key !== 'Escape' || !active || active[0] === 'title') return;
    if (viewer) { viewer.remove(); event.preventDefault(); event.stopPropagation(); return; }
    event.preventDefault(); event.stopPropagation();
    wrap(active[1].context.action({ kind: 'back' }));
  });
  const visibleText = (binding: ProjectUiText | undefined, context: ProjectUiContext, item?: ProjectUiItem, objectRef?: string): string => {
    if (!binding) return '';
    if (binding.kind === 'literal') return objectRef ? context.literal?.(objectRef, binding.value) ?? binding.value : binding.value;
    if (binding.kind === 'data') {
      const value = item?.[binding.field as keyof ProjectUiItem] ?? context.data(binding.field) ?? '';
      if (binding.field === 'mode') return value === 'save' ? '存档' : value === 'load' ? '读档' : String(value);
      return String(value);
    }
    const value = context.read(binding.name, binding.kind);
    if (binding.kind === 'setting') {
      if (binding.name === 'keyPreset') return value === 'standard' ? '标准键位' : value === 'left-handed' ? '左手键位' : String(value ?? '');
      if (binding.name === 'locale') return ({ '': '作品原文', 'zh-CN': '中文', en: '英语', ja: '日语' } as Record<string, string>)[String(value ?? '')] ?? String(value);
      const setting = SETTING_STEPS.find(setting => setting.key === binding.name);
      if (setting && (typeof value === 'number' || value === null)) return setting.format(value);
      if (isSwitchSetting(binding.name)) return value === true ? '开启' : '关闭';
      if (binding.name === 'autoPerCharMs' && typeof value === 'number') return `${value} 毫秒 / 字`;
    }
    if (binding.kind === 'variable' && binding.format) {
      if (!Array.isArray(value)) throw new Error(`界面数组变量类型不符：${binding.name}`);
      return binding.format === 'count' ? String(value.length) : value.join('、');
    }
    return typeof value === 'boolean' ? (value ? '是' : '否') : String(value ?? '');
  };

  /** Reading bodies that are longer than their box, with how the reader scrolls each one. */
  const readingScrollers = new Map<HTMLElement, (delta: number) => boolean>();

  /**
   * A body longer than its box: a new sentence starts at its top, growing text (typing) or a new
   * text size keeps the tail in view only while the reader is at the end, and a refresh with the
   * same text and size never moves the reader. The reader scrolls back with the wheel over the
   * body or, once it is focused, with the arrow, Page and Home/End keys; clicks still reach the stage.
   */
  function followReading(element: HTMLElement, bindings: Array<() => void>): void {
    element.style.overflow = 'hidden';
    let text: string | null = null, size = '', atEnd = true;
    const max = (): number => Math.max(0, element.scrollHeight - element.clientHeight);
    const edges = (): void => {
      const overflow = max() > 1, above = element.scrollTop > 1, below = element.scrollTop < max() - 1;
      element.tabIndex = overflow ? 0 : -1;
      const mask = overflow && (above || below)
        ? `linear-gradient(to bottom, ${above ? 'transparent 0, #000 0.9em' : '#000 0'}, ${below ? '#000 calc(100% - 0.9em), transparent 100%' : '#000 100%'})` : '';
      element.style.maskImage = mask;
      element.style.setProperty('-webkit-mask-image', mask);
    };
    const scrollBy = (delta: number): boolean => {
      const before = element.scrollTop;
      element.scrollTop = Math.max(0, Math.min(max(), before + delta));
      atEnd = element.scrollTop >= max() - 1;
      edges();
      return element.scrollTop !== before;
    };
    readingScrollers.set(element, scrollBy);
    element.addEventListener('keydown', event => {
      if (max() <= 1) return;
      const line = projectUiLineStep(element);
      // A page keeps one line of overlap, but a box shorter than a line (a small body at a large text
      // size) still pages forward by most of its own height, never backwards or by nothing.
      const page = Math.max(element.clientHeight - line, element.clientHeight * 0.875, 1);
      const delta = { ArrowUp: -line, ArrowDown: line, PageUp: -page, PageDown: page, Home: -element.scrollHeight, End: element.scrollHeight }[event.key];
      if (delta === undefined) return;
      event.preventDefault(); event.stopPropagation();
      scrollBy(delta);
    });
    element.addEventListener('focus', () => { element.style.outline = `2px solid ${hex(theme.colors.accent)}`; element.style.outlineOffset = '2px'; });
    element.addEventListener('blur', () => { element.style.outline = ''; });
    bindings.push(() => {
      const nextText = element.textContent ?? '', nextSize = element.style.fontSize;
      if (nextText === text && nextSize === size) return;
      if (text === null || !nextText.startsWith(text)) {
        // A new sentence: start from its top; follow it only if it does not overflow yet.
        element.scrollTop = 0;
        atEnd = max() <= 1;
      }
      text = nextText; size = nextSize;
      if (atEnd) element.scrollTop = max();
      edges();
    });
  }

  // The body takes no pointer events, so the wheel over it is routed here before the stage sees it;
  // it is consumed only when the body can still scroll that way.
  const onWheel = (event: WheelEvent): void => {
    for (const [element, scrollBy] of readingScrollers) {
      if (!element.isConnected) { readingScrollers.delete(element); continue; }
      if (element.closest('[hidden],[inert]')) continue;
      const box = element.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) continue;
      const unit = event.deltaMode === 1 ? projectUiLineStep(element) : event.deltaMode === 2 ? element.clientHeight : 1;
      if (scrollBy(event.deltaY * unit)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
  };
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });

  function applyStyle(element: HTMLElement, node: ProjectUiNode, boxed: boolean): void {
    const style = node.style;
    element.style.color = color(style?.color, theme.colors.text);
    element.style.fontFamily = options.fontFamily(style?.fontRole ?? 'ui');
    element.style.fontSize = `${style?.fontSize ?? theme.typography.uiSize}px`;
    element.style.textAlign = style?.align ?? 'left';
    // With U1 box fields the background is painted by the decoration layer instead (see renderNode).
    if (style?.background !== undefined && !boxed) element.style.backgroundColor = color(style.background, theme.colors.surface);
  }

  /**
   * U1 decoration for a node whose author set a box field: Core resolves the effective values, the
   * layer is painted in the outer layout box, and the node itself keeps only its content box.
   */
  function renderDecor(node: ProjectUiNode, rect: ProjectUiRect, parentRect: ProjectUiRect, interaction?: ProjectUiInteraction): HTMLDivElement {
    // U2: a state-bearing control takes Core's whole effective value for its current interaction (0.45 included).
    const effective = interaction ? resolveProjectUiInteractionStyle(node, {}, interaction, theme) : resolveProjectUiStyle(node, {}, theme);
    const explicit = new Set([node.style, ...Object.values(node.states ?? {})].flatMap(style => style?.backgroundImage ? [style.backgroundImage.asset] : []));
    const image = (asset: string): ProjectUiDecorImage | null => {
      const url = options.imageUrl(asset);
      if (url) return { url, size: () => imageSizes(url) };
      // An inherited theme button skin that is not loaded is skipped exactly as before U1; an author image is reported.
      if (!explicit.has(asset) && asset === theme.skins.buttonSkin) return null;
      throw new Error(`界面图片未加载：${asset}`);
    };
    const decor = createProjectUiDecor(effective, rect, { unit: px, image, onError: error =>
      report(new Error(`界面组件 ${node.id} 的背景：${error instanceof Error ? error.message : String(error)}`)) });
    place(decor, rect, parentRect);
    return decor;
  }

  function place(element: HTMLElement, rect: ProjectUiRect, parent: ProjectUiRect): void {
    element.style.position = 'absolute';
    element.style.left = `${rect.x - parent.x}px`;
    element.style.top = `${rect.y - parent.y}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.boxSizing = 'border-box';
  }

  function applyButtonSkin(element: HTMLElement): boolean {
    if (!theme.skins.buttonSkin) return false;
    const url = options.imageUrl(theme.skins.buttonSkin);
    if (!url) return false;
    element.style.backgroundImage = `url(${JSON.stringify(url)})`;
    element.style.backgroundSize = '100% 100%';
    element.style.backgroundColor = 'transparent';
    element.style.border = '0';
    return true;
  }

  function renderNode(display: Display, node: ProjectUiNode, parent: HTMLElement, parentRect: ProjectUiRect, item?: ProjectUiItem, bindings = display.bindings): HTMLElement {
    const rect = projectUiRect(parentRect, node.frame);
    const control = node.type === 'toggle' || node.type === 'slider' || node.type === 'input';
    // U2: a control with interaction states always draws through the decoration group, so each state can be
    // repainted whole from Core's effective value. Nodes without states keep their exact previous DOM.
    const stateful = node.states !== undefined && (node.type === 'button' || control);
    // Drawing, child placement, clipping, scrolling and input all share Core's content box.
    const boxed = stateful || usesProjectUiBox(node.style), content = boxed ? projectUiContentRect(rect, node.style) : rect;
    // A decorated node is one group in its outer box: decoration and content are assembled first and the node's
    // opacity (and visibility) apply to that group once, so text is never composited over an already-faded background.
    const group = boxed ? document.createElement('div') : null;
    if (group) { group.dataset.uiGroup = node.id; place(group, rect, parentRect); group.style.pointerEvents = 'none'; }
    const origin = group ? rect : parentRect;
    let decor = boxed ? renderDecor(node, rect, origin) : null;
    let field: HTMLInputElement | null = null;
    const element = document.createElement(node.type === 'button' ? 'button' : 'div');
    element.dataset.uiNode = node.id;
    if (node.type === 'text' || node.type === 'button') element.dataset.uiReadingRole = node.style?.fontRole ?? 'ui';
    // Buttons and native controls keep their outer hit box; explicit border/padding become transparent
    // CSS insets, so the native control itself fills exactly Core's content box.
    place(element, node.type === 'button' || control ? rect : content, origin);
    if (control && boxed) element.style.padding = projectUiInsetCss(rect, content, px);
    applyStyle(element, node, boxed);
    const faded = group ?? element;
    faded.style.opacity = String(node.style?.opacity ?? 1);
    if ((node.type === 'text' || node.type === 'button') && isReadingText(display.page, node, item)) {
      const base = node.style?.fontSize ?? theme.typography.uiSize;
      element.dataset.uiReadingScaled = 'true';
      bindings.push(() => { element.style.fontSize = `${base * readingScale(display.context)}px`; });
    }
    element.style.whiteSpace = 'pre-wrap';
    element.style.overflowWrap = 'anywhere';
    const condition = (expression: string | undefined): boolean => expression === undefined || evalExprBoolean(expression, {
      getVariable: name => display.context.read(name, 'variable') as VarValue,
    });
    if (node.visibleWhen !== undefined) bindings.push(() => { element.hidden = !condition(node.visibleWhen); });
    const acceptsInput = (): boolean => {
      refresh();
      return !display.closed && element.isConnected && !element.closest('[hidden]') && !item?.disabled && condition(node.enabledWhen);
    };
    if (node.type === 'container') element.style.pointerEvents = 'none';
    else element.style.pointerEvents = 'auto';
    if (node.type === 'button') {
      const button = element as HTMLButtonElement;
      button.type = 'button';
      if (boxed) {
        const style = node.style ?? {};
        button.style.border = `${style.border?.width ?? 0}px solid transparent`;
        button.style.borderRadius = `${style.borderRadius ?? theme.radius.md}px`;
        button.style.backgroundColor = 'transparent';
        if (style.padding) button.style.padding = `${style.padding.top}px ${style.padding.right}px ${style.padding.bottom}px ${style.padding.left}px`;
      } else {
        button.style.border = `1px solid ${hex(theme.colors.line)}`;
        button.style.borderRadius = `${theme.radius.md}px`;
        button.style.backgroundColor = color(node.style?.background, theme.colors.surface);
      }
      button.style.cursor = 'pointer';
      button.style.fontWeight = '600';
      button.textContent = visibleText(node.text, display.context, item, `ui:${node.id}`);
      if (node.text) bindings.push(() => { button.textContent = visibleText(node.text, display.context, item, `ui:${node.id}`); });
      bindings.push(() => { button.disabled = Boolean(item?.disabled) || !condition(node.enabledWhen);
        // A state-bearing button takes its whole opacity (disabled 0.45 included once) from Core in its state binding.
        if (!stateful) faded.style.opacity = String((node.style?.opacity ?? 1) * (button.disabled ? 0.45 : 1));
        button.style.cursor = button.disabled ? 'not-allowed' : 'pointer'; });
      if (!boxed) applyButtonSkin(button);
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (!node.action || display.pending || !acceptsInput()) return;
        errorStatus.textContent = '';
        display.pending = true;
        void Promise.resolve(display.context.action(node.action, item)).catch(report).finally(() => { display.pending = false; });
      });
    } else if (node.type === 'text') {
      element.textContent = visibleText(node.text, display.context, item, `ui:${node.id}`);
      element.style.lineHeight = '1.45';
      element.style.pointerEvents = 'none';
      if (node.text) bindings.push(() => { element.textContent = visibleText(node.text, display.context, item, `ui:${node.id}`); });
      if (element.dataset.uiReadingScaled) followReading(element, bindings);
    } else if (node.type === 'image') {
      const url = options.imageUrl(node.asset!);
      if (!url) throw new Error(`界面图片未加载：${node.asset}`);
      const image = document.createElement('img');
      image.src = url;
      image.alt = visibleText(node.text, display.context, item, `ui:${node.id}`);
      if (node.text) bindings.push(() => { image.alt = visibleText(node.text, display.context, item, `ui:${node.id}`); });
      image.style.cssText = `width:100%;height:100%;object-fit:${node.style?.imageFit ?? 'contain'};pointer-events:none`;
      element.appendChild(image);
      element.style.pointerEvents = 'none';
    } else if (node.type === 'progress') {
      element.style.pointerEvents = 'none'; element.style.overflow = 'hidden';
      if (boxed) {
        // The decoration paints the track; the fill is clipped to the track's inner corners.
        element.style.borderRadius = `${Math.max(0, (node.style!.borderRadius ?? theme.radius.sm) - (node.style!.border?.width ?? 0))}px`;
      } else {
        element.style.borderRadius = `${theme.radius.sm}px`;
        element.style.backgroundColor = color(node.style?.background, theme.colors.surface);
      }
      element.setAttribute('role', 'progressbar');
      const fill = document.createElement('div'); fill.style.cssText = `height:100%;background:${hex(theme.colors.accent)};pointer-events:none`;
      element.appendChild(fill);
      const update = (): void => {
        const { min, max } = display.context.bounds(node.binding!);
        const value = Number(display.context.read(node.binding!.name, node.binding!.kind));
        fill.style.width = `${Math.max(0, Math.min(1, (value - min) / (max - min))) * 100}%`;
        element.setAttribute('aria-label', node.text ? visibleText(node.text, display.context, item, `ui:${node.id}`) : node.binding!.name);
        element.setAttribute('aria-valuemin', String(min)); element.setAttribute('aria-valuemax', String(max)); element.setAttribute('aria-valuenow', String(value));
      };
      update(); bindings.push(update);
    } else if (node.type === 'toggle' || node.type === 'slider' || node.type === 'input') {
      const binding = node.binding!;
      const input = document.createElement('input');
      field = input;
      input.type = node.type === 'toggle' ? 'checkbox' : node.type === 'slider' ? 'range' : 'text';
      const label = (): string => node.text ? visibleText(node.text, display.context, item, `ui:${node.id}`) : binding.name;
      input.setAttribute('aria-label', label());
      bindings.push(() => input.setAttribute('aria-label', label()));
      input.style.cssText = 'width:100%;height:100%;box-sizing:border-box;font:inherit;color:inherit;accent-color:' + hex(theme.colors.accent);
      // Boxed inputs fill Core's content box without UA margins or inline baseline offsets, including tiny boxes.
      // Unboxed legacy controls keep their existing native layout.
      if (boxed) { input.style.margin = '0'; input.style.display = 'block'; }
      if (node.type === 'input') {
        // Each native layer of the field gives way only to an author layer that replaces or clears it;
        // unrelated box fields (padding, shadows, a null skin) keep the native field box.
        const style = node.style;
        if (style && (style.background !== undefined || style.backgroundGradient || style.backgroundImage)) input.style.background = 'transparent';
        if (style?.border !== undefined) input.style.border = '0';
        // A kept native field follows the author's corner, inside any author border.
        if (style?.borderRadius !== undefined) input.style.borderRadius = px(Math.max(0, style.borderRadius - (style.border?.width ?? 0)));
        applyProjectUiTypography(input, node.style, px);
      }
      const range = node.type === 'slider' ? display.context.bounds(binding) : undefined;
      if (range) {
        // Valid confirmed values need not be on min + n * step (55% BGM, 24 CPS).
        input.min = String(range.min); input.max = String(range.max); input.step = 'any';
        input.addEventListener('keydown', event => {
          const direction = ({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 } as Record<string, number>)[event.key];
          if (direction === undefined && event.key !== 'Home' && event.key !== 'End') return;
          const current = Number(input.value);
          event.preventDefault();
          if (!acceptsInput()) return;
          const next = event.key === 'Home' ? range.min : event.key === 'End' ? range.max : current + direction! * range.step;
          const value = Math.max(range.min, Math.min(range.max, next));
          input.value = String(value);
          wrap(display.context.write(binding, value));
        });
      }
      const sync = (): void => {
        if (document.activeElement === input && input.type === 'text') return;
        const value = display.context.read(binding.name, binding.kind);
        if (node.type === 'toggle') input.checked = Boolean(value);
        else input.value = String(value ?? '');
      };
      sync();
      bindings.push(sync);
      bindings.push(() => { input.disabled = Boolean(item?.disabled) || !condition(node.enabledWhen); });
      input.addEventListener(node.type === 'input' ? 'change' : 'input', () => {
        const value = node.type === 'toggle' ? input.checked : range
          ? Math.max(range.min, Math.min(range.max, range.min + Math.round((Number(input.value) - range.min) / range.step) * range.step))
          : input.value;
        if (!acceptsInput()) { sync(); return; }
        wrap(display.context.write(binding, value));
      });
      // A press on the control's border/padding frame operates the control instead of reaching the stage.
      element.addEventListener('click', event => {
        if (event.target !== element || input.disabled) return;
        if (node.type === 'toggle') input.click(); else input.focus();
      });
      element.appendChild(input);
    } else if (node.type === 'scroll') {
      element.style.overflow = 'auto';
      element.style.pointerEvents = 'auto';
    } else if (node.type === 'content') {
      element.style.overflow = 'auto';
      element.style.pointerEvents = 'auto';
      const columns = node.style?.columns ?? 1;
      if (columns === 2) {
        element.style.display = 'grid';
        element.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        element.style.gap = `${theme.spacing.md}px`;
        element.style.alignContent = 'start';
      }
      display.contents.push({ element, source: node.source!, template: node.children ?? [], columns, rect: content, signature: '', bindings: [] });
    } else if (node.type === 'tabs') {
      element.style.pointerEvents = 'auto';
      const tabs = [...new Set((node.children ?? []).map(child => child.tab).filter((name): name is string => !!name))];
      if (tabs.length === 0 && node.children?.length) tabs.push('页面 1');
      if (tabs.length > 0) {
        const bar = document.createElement('div');
        bar.setAttribute('role', 'tablist');
        bar.style.cssText = `display:flex;gap:8px;height:${PROJECT_UI_TAB_BAR_HEIGHT}px;position:relative;z-index:1`;
        const panels = document.createElement('div');
        panels.style.cssText = `position:absolute;inset:${PROJECT_UI_TAB_BAR_HEIGHT}px 0 0`;
        const select = (name: string): void => {
          for (const child of Array.from(panels.children) as HTMLElement[]) child.hidden = child.dataset.uiTab !== name;
          for (const tab of Array.from(bar.children) as HTMLButtonElement[]) {
            const selected = tab.dataset.uiTab === name;
            tab.setAttribute('aria-selected', String(selected));
            tab.style.textDecoration = selected ? 'underline' : 'none';
            tab.style.textUnderlineOffset = '4px';
          }
        };
        for (const tab of tabs) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = tab; button.dataset.uiTab = tab;
          const source = node.children?.find(child => child.tab === tab);
          if (source) {
            const refresh = (): void => { button.textContent = display.context.literal?.(`ui:${source.id}`, tab, 'tab') ?? tab; };
            refresh(); bindings.push(refresh);
          }
          button.setAttribute('role', 'tab');
          button.style.cssText = `border:1px solid ${hex(theme.colors.line)};border-radius:${theme.radius.sm}px;background:${hex(theme.colors.surface)};color:${color(node.style?.color, theme.colors.text)};padding:4px 14px;cursor:pointer`;
          button.style.fontFamily = options.fontFamily('ui');
          button.style.fontSize = `${Math.min(theme.typography.uiSize, 22)}px`;
          button.style.lineHeight = '1';
          button.style.boxSizing = 'border-box';
          applyButtonSkin(button);
          button.onclick = () => select(tab);
          bar.appendChild(button);
        }
        element.append(bar, panels);
        const tabPanels = new Map<string, HTMLDivElement>();
        for (const child of node.children ?? []) {
          const name = child.tab ?? tabs[0]!;
          let panel = tabPanels.get(name);
          if (!panel) {
            panel = document.createElement('div');
            panel.dataset.uiTab = name;
            panel.style.cssText = 'position:absolute;inset:0';
            panels.appendChild(panel);
            tabPanels.set(name, panel);
          }
          renderNode(display, child, panel, projectUiChildrenRect(rect, node.type, node.style), item, bindings);
        }
        select(tabs[0]!);
      }
    }
    // Typography never reaches containers: CSS inheritance would leak it into child nodes.
    if (node.type === 'text' || node.type === 'button' || node.type === 'input' || (node.type === 'content' && !node.children?.length)) {
      applyProjectUiTypography(element, node.style, px);
    }
    // A boxed parent clips its children to Core's content box (scroll/content already do so by scrolling); the
    // decoration and shadows stay outside that clip in the group. Unboxed legacy containers keep overflow visible.
    if (boxed && (node.type === 'container' || node.type === 'tabs')) element.style.overflow = 'hidden';
    if (group && decor) {
      // An interactive node's border/padding frame stays its own: it never falls through to the stage.
      decor.style.pointerEvents = element.style.pointerEvents === 'auto' ? 'auto' : 'none';
      // The group follows the node's visibility.
      const sync = (): void => { group.hidden = element.hidden; };
      sync(); bindings.push(sync);
      group.append(decor, element);
      parent.appendChild(group);
    } else parent.appendChild(element);
    if (stateful && group) {
      // U2: the real pointer, keyboard-focus and disabled state go to Core's interaction algorithm and every change
      // repaints the node whole (decoration, text colour and shadow, group opacity, native field fill), so nothing of
      // the previous state survives. Keyboard focus is shown by the page's own marker, outside the node group.
      const target = field ?? element;
      const operable = field ?? element as HTMLButtonElement;
      target.dataset.uiFocusTarget = node.id;
      target.style.outline = 'none';
      element.dataset.uiFocusRadius = px(resolveProjectUiStyle(node, {}, theme).borderRadius);
      element.dataset.uiState = 'normal';
      let painted = '0000';
      const repaint = (): void => {
        if (display.closed || !element.isConnected || !decor) return;
        const interaction: ProjectUiInteraction = { hovered: matches(element, ':hover'), focused: matches(target, ':focus-visible'),
          pressed: matches(element, ':active'), disabled: operable.disabled };
        const signature = [interaction.hovered, interaction.focused, interaction.pressed, interaction.disabled].map(Number).join('');
        if (signature === painted) return;
        painted = signature;
        try {
          const effective = resolveProjectUiInteractionStyle(node, {}, interaction, theme);
          const next = renderDecor(node, rect, origin, interaction);
          next.style.pointerEvents = decor.style.pointerEvents;
          decor.replaceWith(next);
          decor = next;
          element.style.color = hex(effective.color);
          const shadow = projectUiShadowCss(effective.textShadows, px);
          element.style.textShadow = shadow;
          if (node.type === 'input' && field) {
            field.style.textShadow = shadow;
            // The native field box gives way only while the current state paints its own fill (as U1 rules).
            field.style.background = effective.background !== null || effective.backgroundGradient || effective.backgroundImage ? 'transparent' : '';
          }
          group.style.opacity = String(effective.opacity);
          element.dataset.uiState = [interaction.hovered && 'hover', interaction.focused && 'focus', interaction.pressed && 'pressed',
            interaction.disabled && 'disabled'].filter(Boolean).join(' ') || 'normal';
        } catch (error) { report(error); }
      };
      bindings.push(repaint);
      for (const type of ['pointerenter', 'pointerleave', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'focusout', 'keydown', 'keyup']) {
        element.addEventListener(type, repaint);
      }
    }
    if (node.type !== 'tabs' && node.type !== 'content') node.children?.forEach(child => renderNode(display, child, element, content, item, bindings));
    return element;
  }

  function renderContent(display: Display, content: Display['contents'][number]): void {
    const items = display.context.content(content.source).map(item => ({ ...item, source: content.source }));
    const signature = JSON.stringify(items);
    if (signature === content.signature) return;
    const scrollTop = content.element.scrollTop;
    // Re-rendering after a setting changes must not drop keyboard focus from the row or its control.
    const active = document.activeElement instanceof HTMLElement && content.element.contains(document.activeElement) ? document.activeElement : null;
    const focusedItem = active?.closest<HTMLElement>('[data-ui-item]')?.dataset.uiItem, focusedControl = active?.dataset.uiControl;
    content.signature = signature;
    content.bindings = [];
    content.element.replaceChildren();
    const rowHeight = content.template.length > 0
      ? Math.max(54, ...content.template.map(node => node.frame.y + node.frame.height + 8)) : 62;
    const hasImage = (node: ProjectUiNode): boolean => node.type === 'image' || Boolean(node.children?.some(hasImage));
    const imageTemplate = content.template.some(hasImage);
    const skinnedSettings = content.source === 'settings' && content.template.length === 0
      && Boolean(theme.skins.buttonSkin && options.imageUrl(theme.skins.buttonSkin));
    const gap = content.columns === 2 ? theme.spacing.md : 0;
    const columnWidth = (content.rect.width - gap) / content.columns;
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.dataset.uiItem = item.id;
      row.style.cssText = `position:relative;box-sizing:border-box;min-height:${rowHeight}px;border-bottom:1px solid ${hex(theme.colors.line)};padding:8px 12px;cursor:${item.disabled ? 'default' : 'pointer'};background:${index % 2 ? hex(theme.colors.surface) : hex(theme.colors.panel)};color:inherit`;
      if (content.columns === 2) row.style.minWidth = '0';
      if (imageTemplate || skinnedSettings) { row.style.backgroundColor = 'transparent'; row.style.borderBottom = '0'; }
      else if (content.template.length === 0) applyButtonSkin(row);
      if (skinnedSettings) { row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.columnGap = '16px'; row.style.paddingRight = '138px'; }
      if (content.template.length > 0) {
        const rowRect = { x: content.rect.x + (index % content.columns) * (columnWidth + gap),
          y: content.rect.y + Math.floor(index / content.columns) * (rowHeight + gap), width: columnWidth, height: rowHeight };
        content.template.forEach(node => renderNode(display, node, row, rowRect, item, content.bindings));
      } else {
        const title = document.createElement('span');
        title.style.cssText = 'display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        if (skinnedSettings) { title.style.fontWeight = '400'; title.style.flex = '1'; title.style.minWidth = '0'; }
        if (item.backlog) appendBacklogText(title, item.label, item.backlog);
        else title.textContent = item.label;
        row.appendChild(title);
        if (item.description) {
          const description = document.createElement('small');
          description.textContent = item.description;
          description.style.cssText = 'display:block;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
          if (skinnedSettings) { description.style.marginLeft = 'auto'; description.style.textAlign = 'right'; }
          row.appendChild(description);
        }
      }
      row.tabIndex = item.disabled ? -1 : 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-disabled', String(Boolean(item.disabled)));
      const activate = async (restore = false): Promise<void> => {
        if (display.closed || (item.disabled && !restore)) return;
        if (display.pending) return;
        errorStatus.textContent = '';
        try {
          display.pending = true;
          const accepted = await display.context.select(content.source, item, restore);
          if (accepted === false) {
            row.setAttribute('data-ui-error', 'true');
            row.title = '操作未完成，请重试或返回';
            errorStatus.textContent = row.title;
            return;
          }
        } catch (error) { report(error); }
        finally { display.pending = false; }
      };
      row.addEventListener('click', event => { if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return; void activate(); });
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void activate(); } });
      if (content.source === 'save-slots' && display.context.mode === 'load' && item.backupAvailable) {
        const restore = document.createElement('button');
        restore.type = 'button'; restore.textContent = '恢复备份并读取';
        restore.style.cssText = `position:absolute;right:12px;top:12px;border:1px solid ${hex(theme.colors.line)};background:${hex(theme.colors.surface)};color:${hex(theme.colors.text)};cursor:pointer`;
        restore.style.color = 'inherit';
        applyButtonSkin(restore);
        restore.onclick = event => { event.stopPropagation(); void activate(true); };
        row.appendChild(restore);
      }
      if (content.source === 'choices' && content.template.length === 0) {
        content.bindings.push(() => { row.style.fontSize = `${readingScale(display.context)}em`; });
      }
      if (content.source === 'settings' && content.template.length === 0 && isSwitchSetting(item.id)) {
        const on = display.context.read(item.id, 'setting') === true;
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.dataset.uiControl = 'switch'; toggle.textContent = on ? '开启' : '关闭';
        toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(on)); toggle.setAttribute('aria-label', item.label);
        toggle.style.cssText = `position:absolute;right:12px;top:12px;width:102px;height:34px;border-radius:17px;border:1px solid ${hex(on ? theme.colors.accent : theme.colors.line)};background:${hex(on ? theme.colors.accent : theme.colors.surface)};color:${hex(on ? theme.colors.textOnAccent : theme.colors.text)};font-weight:600;cursor:pointer`;
        if (applyButtonSkin(toggle) || !on) toggle.style.color = 'inherit';
        toggle.onclick = event => { event.stopPropagation(); wrap(display.context.action({ kind: 'setting-step', name: item.id, direction: 1 })); };
        row.appendChild(toggle);
      } else if (content.source === 'settings' && content.template.length === 0) {
        for (const [direction, label] of [[-1, '−'], [1, '+']] as const) {
          const step = document.createElement('button');
          step.type = 'button'; step.textContent = label; step.dataset.uiControl = `step${direction}`;
          step.setAttribute('aria-label', `${item.label}${direction < 0 ? '减少' : '增加'}`);
          step.style.cssText = `position:absolute;right:${direction < 0 ? 72 : 12}px;top:12px;width:42px;height:34px;border:1px solid ${hex(theme.colors.line)};background:${hex(theme.colors.surface)};color:${hex(theme.colors.text)};cursor:pointer`;
          step.style.color = 'inherit';
          applyButtonSkin(step);
          step.onclick = event => { event.stopPropagation(); wrap(display.context.action({ kind: 'setting-step', name: item.id, direction })); };
          row.appendChild(step);
        }
      }
      content.element.appendChild(row);
    });
    content.element.scrollTop = scrollTop;
    if (focusedItem !== undefined) {
      const row = Array.from(content.element.children as HTMLCollectionOf<HTMLElement>).find(element => element.dataset.uiItem === focusedItem);
      (focusedControl ? row?.querySelector<HTMLElement>(`[data-ui-control="${focusedControl}"]`) : row)?.focus();
    }
  }

  /**
   * Keyboard focus on a state-bearing control: one marker per page, drawn above the page's nodes so author states,
   * skins, group opacity and container clipping can never hide it. It follows the page's motion pose.
   */
  function updateFocusMarker(display: Display): void {
    const active = document.activeElement;
    const target = !display.closed && !display.element.hidden && active instanceof HTMLElement && active.dataset.uiFocusTarget !== undefined
      && display.element.contains(active) && !active.closest('[hidden]') && matches(active, ':focus-visible') ? active.closest<HTMLElement>('[data-ui-node]') : null;
    const page = target ? display.element.getBoundingClientRect() : null;
    let left = 0, top = 0, right = 0, bottom = 0;
    if (target && page && page.width > 0) {
      ({ left, top, right, bottom } = target.getBoundingClientRect());
      // Only what a scrolling or clipping ancestor still shows; a control scrolled fully out of view has no marker.
      for (let parent = target.parentElement; parent && parent !== display.element; parent = parent.parentElement) {
        const computed = getComputedStyle(parent);
        if (computed.overflowX === 'visible' && computed.overflowY === 'visible') continue;
        const box = parent.getBoundingClientRect();
        left = Math.max(left, box.left); top = Math.max(top, box.top); right = Math.min(right, box.right); bottom = Math.min(bottom, box.bottom);
      }
    }
    if (!target || !page || right - left < 1 || bottom - top < 1) { if (display.marker) display.marker.hidden = true; return; }
    let marker = display.marker;
    if (!marker) {
      marker = display.marker = document.createElement('div');
      marker.dataset.uiFocusMarker = 'true';
      marker.setAttribute('aria-hidden', 'true');
      // Two rings (panel colour inside, accent outside) stay visible on light, dark and accent-coloured skins alike.
      marker.style.cssText = `position:absolute;z-index:40;box-sizing:border-box;pointer-events:none;outline:2px solid ${hex(theme.colors.accent)};outline-offset:2px;box-shadow:0 0 0 2px ${hex(theme.colors.panel)}`;
      display.element.appendChild(marker);
    }
    const scale = DESIGN_FRAME.width / page.width;
    marker.hidden = false;
    marker.dataset.uiFocusFor = target.dataset.uiNode;
    marker.style.left = px((left - page.left) * scale);
    marker.style.top = px((top - page.top) * scale);
    marker.style.width = px((right - left) * scale);
    marker.style.height = px((bottom - top) * scale);
    marker.style.borderRadius = target.dataset.uiFocusRadius ?? '0px';
  }

  /** A closed page is only a picture from now on: no pointer, Tab, refresh or marker can reach it again. */
  function closeDisplay(display: Display): void {
    display.closed = true;
    const element = display.element;
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
    element.style.pointerEvents = 'none';
    element.dataset.uiClosing = 'true';
    if (display.marker) display.marker.hidden = true;
    display.blocker?.remove(); display.blocker = null;
  }

  function paintPose(element: HTMLElement, pose: ProjectUiMotionPose): void {
    element.style.opacity = pose.opacity === 1 ? '' : String(pose.opacity);
    element.style.transform = pose.x === 0 && pose.y === 0 && pose.scale === 1 ? '' : `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`;
  }

  const motionKey = (page: ProjectUiPageId): string => `project-ui:${page}`;
  const pageMotion = (node: ProjectUiNode, direction: 'enter' | 'exit'): Required<ProjectUiMotion> | null =>
    motion ? resolveProjectUiMotion(node, direction, reduceMotion) : null;

  /**
   * One visual projection on the shared driver. Paint and completion never throw into the Runtime ticker: a failure
   * is reported here and the page simply stays where it is. A driver already disposed with its Runtime gives the
   * static end state at once.
   */
  function animate(page: ProjectUiPageId, resolved: Required<ProjectUiMotion>, direction: 'enter' | 'exit',
    paint: (pose: ProjectUiMotionPose) => void, complete: () => void): void {
    const safePaint = (pose: ProjectUiMotionPose): void => { try { paint(pose); } catch (error) { report(error); } };
    const safeComplete = (): void => { running.delete(page); try { complete(); } catch (error) { report(error); } };
    running.add(page);
    try { motion!.play(motionKey(page), resolved, direction, safePaint, safeComplete,
      () => { safePaint(STABLE_POSE); safeComplete(); }); return; } catch { /* disposed driver */ }
    safePaint(STABLE_POSE); safeComplete();
  }

  function dropGhost(page: ProjectUiPageId): void {
    const ghost = ghosts.get(page);
    if (ghost) { ghosts.delete(page); ghost.remove(); }
  }

  /** Cancels this UI's projections (no callbacks), removes closing pages and settles open pages at their stable pose. */
  function settleMotion(): void {
    for (const page of running) motion?.cancel(motionKey(page));
    running.clear();
    for (const page of [...ghosts.keys()]) dropGhost(page);
    for (const display of pages.values()) {
      display.blocker?.remove(); display.blocker = null;
      display.pose = STABLE_POSE; paintPose(display.element, STABLE_POSE);
    }
  }

  function refresh(): void {
    if (disposed) return;
    const previousFailure = refreshFailure; refreshFailure = null;
    for (const [page, display] of pages) {
      const wasHidden = display.element.hidden;
      display.element.hidden = options.isPageVisible?.(page) === false;
      if (display.blocker) display.blocker.hidden = display.element.hidden;
      if (display.element.hidden) {
        if (!wasHidden && !display.hiddenThisFrame) { display.hiddenThisFrame = true; window.requestAnimationFrame(() => { display.hiddenThisFrame = false; }); }
        if (display.marker) display.marker.hidden = true;
        continue;
      }
      try {
        display.bindings.forEach(update => update());
        display.contents.forEach(content => { renderContent(display, content); content.bindings.forEach(update => update()); });
      } catch (error) {
        display.element.hidden = true;
        refreshFailure = error instanceof Error ? error.message : String(error); report(error);
      }
      updateFocusMarker(display);
    }
    if (previousFailure !== null && refreshFailure === null && errorStatus.textContent === previousFailure) errorStatus.textContent = '';
  }

  function resize(): void {
    if (disposed) return;
    const box = canvas.getBoundingClientRect();
    const scale = box.width / 1280;
    design.style.left = `${box.left}px`;
    design.style.top = `${box.top}px`;
    design.style.transform = `scale(${scale})`;
  }

  const tick = (): void => {
    if (disposed) return;
    refresh(); resize();
    frame = window.requestAnimationFrame(tick);
  };
  frame = window.requestAnimationFrame(tick);

  return {
    readingDiagnostics() {
      if (disposed) return [];
      const issues: ReadingDiagnostic[] = [];
      for (const [page, display] of pages) {
        if (display.element.hidden) continue;
        for (const element of Array.from(display.element.querySelectorAll<HTMLElement>('[data-ui-reading-role]'))) {
          if (element.closest('[hidden]') || !element.getClientRects().length) continue;
          const text = element.textContent ?? '';
          const target = `ui:${page}.${element.dataset.uiNode}`;
          const role = element.dataset.uiReadingRole as 'body' | 'title' | 'ui';
          issues.push(...(options.fontDiagnostics?.(role, text, target)
            ?? fontTextDiagnostics(undefined, role, options.fontFamily(role), text, target)));
          if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
            issues.push({ code: 'TEXT_OVERFLOW', severity: 'warning', target, text,
              message: '文字超过作品界面节点的可用区域，请调整该节点尺寸、字号或文案。' });
          }
          if (isUiTextClipped(element, root)) {
            issues.push({ code: 'TEXT_CLIPPED', severity: 'warning', target, text,
              message: '部分文字被画面或上层区域裁掉，请调整节点位置或上层可见范围。' });
          }
        }
      }
      return issues;
    },
    show(page, context) {
      if (disposed) throw new Error('Project UI disposed');
      errorStatus.textContent = '';
      const node = options.document.pages[page];
      if (!node) return;
      // Re-showing an open page replaces it at once (no exit picture, no second entry); a page still closing is
      // dropped. Either way the old projection is cancelled without its callback.
      const replaced = pages.get(page);
      if (replaced) { pages.delete(page); closeDisplay(replaced); replaced.element.remove(); }
      dropGhost(page);
      if (running.delete(page)) motion?.cancel(motionKey(page));
      const element = document.createElement('div');
      element.dataset.uiPage = page;
      element.style.cssText = `position:absolute;inset:0;z-index:${PAGE_LEVEL[page]};pointer-events:${MODAL_PAGES.has(page) ? 'auto' : 'none'};color:${hex(theme.colors.text)};font-family:${options.fontFamily('ui')}`;
      if (MODAL_PAGES.has(page)) {
        element.style.backgroundColor = hex(theme.colors.panel);
        if (page === 'title' && options.titleBackgroundUrl) {
          element.style.backgroundImage = `url(${JSON.stringify(options.titleBackgroundUrl)})`;
          element.style.backgroundSize = 'cover';
          element.style.backgroundPosition = 'center';
        }
      }
      const display: Display = { page, node, element, context, bindings: [], contents: [], pending: false, closed: false, marker: null, blocker: null, pose: STABLE_POSE, hiddenThisFrame: false };
      // A page shown while it may not be visible starts hidden, so it never counts as having just left the screen.
      element.hidden = options.isPageVisible?.(page) === false;
      if (context.mode) element.dataset.uiMode = context.mode;
      // Nothing addressed to a closed page (even a synthetic event) reaches its controls.
      for (const type of ['click', 'pointerdown', 'pointerup', 'keydown', 'input', 'change', 'wheel']) {
        element.addEventListener(type, event => { if (display.closed) { event.stopImmediatePropagation(); if (event.cancelable) event.preventDefault(); } }, true);
      }
      pages.set(page, display);
      design.appendChild(element);
      renderNode(display, node, element, DESIGN_FRAME);
      refresh(); resize();
      // The Shell has already given this page the pause and input; the entry is visual only and starts now.
      const enter = replaced ? null : pageMotion(node, 'enter');
      if (enter) {
        if (MODAL_PAGES.has(page)) {
          // While a modal page is still offset or scaled, the strip it does not cover yet must not reach the stage.
          const blocker = display.blocker = document.createElement('div');
          blocker.dataset.uiMotionBlocker = page;
          blocker.setAttribute('aria-hidden', 'true');
          blocker.hidden = element.hidden;
          blocker.style.cssText = `position:absolute;inset:0;z-index:${PAGE_LEVEL[page]};pointer-events:auto`;
          design.insertBefore(blocker, element);
        }
        animate(page, enter, 'enter', pose => {
          if (pages.get(page) !== display) return;
          display.pose = pose; paintPose(element, pose);
        }, () => {
          if (pages.get(page) !== display) return;
          display.blocker?.remove(); display.blocker = null;
        });
      }
      if (MODAL_PAGES.has(page)) element.querySelector<HTMLElement>('button,input,[tabindex]')?.focus();
    },
    hide(page) {
      errorStatus.textContent = '';
      const display = pages.get(page);
      if (!display) return;
      // Leaves the active registry synchronously: from here the page takes no pointer, Tab or refresh.
      pages.delete(page);
      closeDisplay(display);
      if (running.delete(page)) motion?.cancel(motionKey(page));
      dropGhost(page);
      // Only a page still on screen leaves with its exit; one hidden since an earlier frame simply goes.
      const onScreen = !display.element.hidden || display.hiddenThisFrame;
      const exit = disposed || !onScreen ? null : pageMotion(display.node, 'exit');
      if (!exit) { display.element.remove(); return; }
      const element = display.element, from = display.pose;
      element.hidden = false;
      ghosts.set(page, element);
      // An exit started mid-entry continues from the pose already on screen instead of jumping.
      animate(page, exit, 'exit', pose => {
        if (ghosts.get(page) !== element) return;
        paintPose(element, { opacity: from.opacity * pose.opacity, x: from.x + pose.x, y: from.y + pose.y, scale: from.scale * pose.scale });
      }, () => { if (ghosts.get(page) === element) dropGhost(page); });
    },
    refresh,
    resize,
    ownsInput(target) { return target instanceof Node && root.contains(target); },
    confirm(message) {
      if (disposed || confirmation) return Promise.resolve(false);
      return new Promise(resolve => {
        const previous = document.activeElement as HTMLElement | null;
        const element = document.createElement('div'); element.setAttribute('role', 'dialog'); element.setAttribute('aria-label', '确认存档操作');
        element.style.cssText = `position:absolute;inset:0;z-index:100;pointer-events:auto;background:${hex(theme.colors.panel)};display:flex;align-items:center;justify-content:center;gap:24px;color:${hex(theme.colors.text)};font-size:24px`;
        const label = document.createElement('p'); label.textContent = message;
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
        const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = '确认';
        for (const button of [cancel, accept]) {
          button.style.color = 'inherit';
          button.style.backgroundColor = hex(theme.colors.surface);
          applyButtonSkin(button);
        }
        const finish = (accepted: boolean): void => { confirmation = null; element.remove(); if (previous?.isConnected) previous.focus(); resolve(accepted); };
        cancel.onclick = () => finish(false); accept.onclick = () => finish(true);
        element.append(label, cancel, accept); design.appendChild(element);
        confirmation = { element, finish }; cancel.focus();
      });
    },
    setReducedMotion(reduce) {
      reduceMotion = reduce;
      if (!reduce || running.size === 0) return;
      // Every current projection reaches its end state now (exits remove their pictures), without waiting for a frame.
      try { motion?.finishAll(); } catch (error) { report(error); }
      if (running.size > 0) settleMotion();
    },
    resetMotion() {
      if (!disposed) settleMotion();
    },
    showGalleryImage(assetKey, label) {
      const display = pages.get('gallery');
      if (!display) return;
      const url = options.imageUrl(assetKey);
      if (!url) throw new Error(`鉴赏图片未加载：${assetKey}`);
      display.element.querySelector('[data-ui-viewer]')?.remove();
      const viewer = document.createElement('div');
      viewer.dataset.uiViewer = assetKey;
      viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-label', label);
      viewer.style.cssText = `position:absolute;inset:0;z-index:20;background:${hex(theme.colors.scrim)};display:flex;align-items:center;justify-content:center;cursor:pointer`;
      const image = document.createElement('img');
      image.src = url; image.alt = label;
      image.style.cssText = 'max-width:92%;max-height:90%;object-fit:contain';
      viewer.onclick = () => viewer.remove();
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '关闭图片';
      close.style.cssText = `position:absolute;right:16px;top:16px;color:inherit;background:${hex(theme.colors.surface)}`;
      applyButtonSkin(close);
      close.onclick = () => viewer.remove();
      viewer.append(image, close);
      display.element.appendChild(viewer);
      close.focus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      confirmation?.finish(false);
      for (const page of running) motion?.cancel(motionKey(page));
      running.clear(); ghosts.clear();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('wheel', onWheel, { capture: true });
      readingScrollers.clear();
      pages.clear();
      root.remove();
    },
  };
}
