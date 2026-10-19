import { GAME_SETTING_DEFINITIONS, PROJECT_UI_TAB_BAR_HEIGHT, evalExprBoolean, parseInlineText, projectUiChildrenRect, projectUiContentRect, projectUiRect, resolveProjectUiStyle, type InlineStyle, type VarValue, type ProjectUiAction, type ProjectUiBinding, type ProjectUiContentSource, type ProjectUiDocument, type ProjectUiNode, type ProjectUiPageId, type ProjectUiRect, type ProjectUiText } from '@surdet/core';
import type { RendererTheme } from './theme.js';
import { SETTING_STEPS } from './settings-store.js';
import { fontTextDiagnostics, isUiTextClipped, type ReadingDiagnostic } from './reading-diagnostics.js';
import type { BacklogEntry } from './backlog.js';
import { applyProjectUiTypography, createProjectUiDecor, createProjectUiImageSizes, projectUiDecorStyle, projectUiInsetCss, projectUiLineStep, usesProjectUiBox, type ProjectUiDecorImage } from './project-ui-style-dom.js';

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
  element: HTMLDivElement;
  context: ProjectUiContext;
  bindings: Array<() => void>;
  contents: Array<{ element: HTMLElement; source: ProjectUiContentSource; template: readonly ProjectUiNode[]; rect: ProjectUiRect; signature: string; bindings: Array<() => void> }>;
  pending: boolean;
}

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
      if (element.closest('[hidden]')) continue;
      const box = element.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) continue;
      const unit = event.deltaMode === 1 ? projectUiLineStep(element) : event.deltaMode === 2 ? element.clientHeight : 1;
      if (scrollBy(event.deltaY * unit)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
  };
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });

  function applyStyle(element: HTMLElement, node: ProjectUiNode): void {
    const style = node.style;
    element.style.color = color(style?.color, theme.colors.text);
    element.style.fontFamily = options.fontFamily(style?.fontRole ?? 'ui');
    element.style.fontSize = `${style?.fontSize ?? theme.typography.uiSize}px`;
    element.style.textAlign = style?.align ?? 'left';
    element.style.opacity = String(style?.opacity ?? 1);
    // With U1 box fields the background is painted by the decoration layer instead (see renderNode).
    if (style?.background !== undefined && !usesProjectUiBox(style)) element.style.backgroundColor = color(style.background, theme.colors.surface);
  }

  /**
   * U1 decoration for a node whose author set a box field: Core resolves the effective values, the
   * layer is painted in the outer layout box, and the node itself keeps only its content box.
   */
  function renderDecor(node: ProjectUiNode, rect: ProjectUiRect, parentRect: ProjectUiRect): HTMLDivElement {
    const style = node.style!, effective = projectUiDecorStyle(node, resolveProjectUiStyle(node, {}, theme), theme);
    const image = (asset: string): ProjectUiDecorImage | null => {
      const url = options.imageUrl(asset);
      if (url) return { url, size: () => imageSizes(url) };
      // An inherited theme button skin that is not loaded is skipped exactly as before U1.
      if (style.backgroundImage === undefined) return null;
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

  function renderNode(display: Display, node: ProjectUiNode, parent: HTMLElement, parentRect: ProjectUiRect, item?: ProjectUiItem, bindings = display.bindings): HTMLElement {
    const rect = projectUiRect(parentRect, node.frame);
    // Drawing, child placement, clipping, scrolling and input all share Core's content box.
    const boxed = usesProjectUiBox(node.style), content = boxed ? projectUiContentRect(rect, node.style) : rect;
    const decor = boxed ? renderDecor(node, rect, parentRect) : null;
    const element = document.createElement(node.type === 'button' ? 'button' : 'div');
    element.dataset.uiNode = node.id;
    if (node.type === 'text' || node.type === 'button') element.dataset.uiReadingRole = node.style?.fontRole ?? 'ui';
    // Buttons and native controls keep their outer hit box; explicit border/padding become transparent
    // CSS insets, so the native control itself fills exactly Core's content box.
    const control = node.type === 'toggle' || node.type === 'slider' || node.type === 'input';
    place(element, node.type === 'button' || control ? rect : content, parentRect);
    if (control && boxed) element.style.padding = projectUiInsetCss(rect, content, px);
    applyStyle(element, node);
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
      return element.isConnected && !element.closest('[hidden]') && !item?.disabled && condition(node.enabledWhen);
    };
    if (node.type === 'container') element.style.pointerEvents = 'none';
    else element.style.pointerEvents = 'auto';
    if (node.type === 'button') {
      const button = element as HTMLButtonElement;
      button.type = 'button';
      if (boxed) {
        const style = node.style!;
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
        button.style.opacity = String((node.style?.opacity ?? 1) * (button.disabled ? 0.45 : 1)); button.style.cursor = button.disabled ? 'not-allowed' : 'pointer'; });
      if (theme.skins.buttonSkin && !boxed) {
        const url = options.imageUrl(theme.skins.buttonSkin);
        if (url) { button.style.backgroundImage = `url(${JSON.stringify(url)})`; button.style.backgroundSize = '100% 100%'; }
      }
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
      image.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none';
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
      if (node.type === 'slider') {
        const bounds = display.context.bounds(binding);
        input.min = String(bounds.min); input.max = String(bounds.max); input.step = String(bounds.step);
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
        const value = node.type === 'toggle' ? input.checked : node.type === 'slider' ? Number(input.value) : input.value;
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
      display.contents.push({ element, source: node.source!, template: node.children ?? [], rect: content, signature: '', bindings: [] });
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
          for (const tab of Array.from(bar.children) as HTMLButtonElement[]) tab.setAttribute('aria-selected', String(tab.dataset.uiTab === name));
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
          button.style.cssText = `border:1px solid ${hex(theme.colors.line)};border-radius:${theme.radius.sm}px;background:${hex(theme.colors.surface)};color:${hex(theme.colors.text)};padding:4px 14px;cursor:pointer`;
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
    if (decor) {
      // An interactive node's border/padding frame stays its own: it never falls through to the stage.
      decor.style.pointerEvents = element.style.pointerEvents === 'auto' ? 'auto' : 'none';
      // The layer follows the node's visibility and whole-node/disabled opacity.
      const sync = (): void => { decor.hidden = element.hidden; decor.style.opacity = element.style.opacity; };
      sync(); bindings.push(sync);
      parent.appendChild(decor);
    }
    parent.appendChild(element);
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
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.dataset.uiItem = item.id;
      row.style.cssText = `position:relative;box-sizing:border-box;min-height:${rowHeight}px;border-bottom:1px solid ${hex(theme.colors.line)};padding:8px 12px;cursor:${item.disabled ? 'default' : 'pointer'};background:${index % 2 ? hex(theme.colors.surface) : hex(theme.colors.panel)};color:${hex(theme.colors.text)}`;
      if (content.template.length > 0) {
        const rowRect = { x: content.rect.x, y: content.rect.y + index * rowHeight, width: content.rect.width, height: rowHeight };
        content.template.forEach(node => renderNode(display, node, row, rowRect, item, content.bindings));
      } else {
        const title = document.createElement('span');
        title.style.cssText = 'display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        if (item.backlog) appendBacklogText(title, item.label, item.backlog);
        else title.textContent = item.label;
        row.appendChild(title);
        if (item.description) {
          const description = document.createElement('small');
          description.textContent = item.description;
          description.style.cssText = 'display:block;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
          row.appendChild(description);
        }
      }
      row.tabIndex = item.disabled ? -1 : 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-disabled', String(Boolean(item.disabled)));
      const activate = async (restore = false): Promise<void> => {
        if (item.disabled && !restore) return;
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
        toggle.onclick = event => { event.stopPropagation(); wrap(display.context.action({ kind: 'setting-step', name: item.id, direction: 1 })); };
        row.appendChild(toggle);
      } else if (content.source === 'settings' && content.template.length === 0) {
        for (const [direction, label] of [[-1, '−'], [1, '+']] as const) {
          const step = document.createElement('button');
          step.type = 'button'; step.textContent = label; step.dataset.uiControl = `step${direction}`;
          step.setAttribute('aria-label', `${item.label}${direction < 0 ? '减少' : '增加'}`);
          step.style.cssText = `position:absolute;right:${direction < 0 ? 72 : 12}px;top:12px;width:42px;height:34px;border:1px solid ${hex(theme.colors.line)};background:${hex(theme.colors.surface)};color:${hex(theme.colors.text)};cursor:pointer`;
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

  function refresh(): void {
    if (disposed) return;
    const previousFailure = refreshFailure; refreshFailure = null;
    for (const [page, display] of pages) {
      display.element.hidden = options.isPageVisible?.(page) === false;
      if (display.element.hidden) continue;
      try {
        display.bindings.forEach(update => update());
        display.contents.forEach(content => { renderContent(display, content); content.bindings.forEach(update => update()); });
      } catch (error) {
        display.element.hidden = true;
        refreshFailure = error instanceof Error ? error.message : String(error); report(error);
      }
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
      this.hide(page);
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
      const display: Display = { page, element, context, bindings: [], contents: [], pending: false };
      if (context.mode) element.dataset.uiMode = context.mode;
      pages.set(page, display);
      design.appendChild(element);
      renderNode(display, node, element, DESIGN_FRAME);
      refresh(); resize();
      if (MODAL_PAGES.has(page)) element.querySelector<HTMLElement>('button,input,[tabindex]')?.focus();
    },
    hide(page) { errorStatus.textContent = ''; const display = pages.get(page); if (display) { display.element.remove(); pages.delete(page); } },
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
        const finish = (accepted: boolean): void => { confirmation = null; element.remove(); if (previous?.isConnected) previous.focus(); resolve(accepted); };
        cancel.onclick = () => finish(false); accept.onclick = () => finish(true);
        element.append(label, cancel, accept); design.appendChild(element);
        confirmation = { element, finish }; cancel.focus();
      });
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
      close.style.cssText = 'position:absolute;right:16px;top:16px';
      close.onclick = () => viewer.remove();
      viewer.append(image, close);
      display.element.appendChild(viewer);
      close.focus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      confirmation?.finish(false);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('wheel', onWheel, { capture: true });
      readingScrollers.clear();
      pages.clear();
      root.remove();
    },
  };
}
