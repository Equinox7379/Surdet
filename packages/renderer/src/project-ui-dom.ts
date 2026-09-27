import { PROJECT_UI_TAB_BAR_HEIGHT, projectUiChildrenRect, projectUiRect, type ProjectUiAction, type ProjectUiBinding, type ProjectUiContentSource, type ProjectUiDocument, type ProjectUiNode, type ProjectUiPageId, type ProjectUiRect, type ProjectUiText } from '@surdet/core';
import type { RendererTheme } from './theme.js';

export interface ProjectUiItem {
  id: string;
  source?: ProjectUiContentSource;
  label: string;
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
  imageUrl: (key: string) => string | undefined;
  titleBackgroundUrl?: string;
  isPageVisible?: (page: ProjectUiPageId) => boolean;
  onError: (error: unknown) => void;
}

export interface ProjectUiDom {
  show(page: ProjectUiPageId, context: ProjectUiContext): void;
  hide(page: ProjectUiPageId): void;
  refresh(): void;
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

interface Display {
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

  const report = (error: unknown): void => { errorStatus.textContent = error instanceof Error ? error.message : String(error); options.onError(error); };
  const color = (value: number | undefined, fallback: number): string => hex(value ?? fallback);
  const wrap = (promise: void | Promise<void>): void => { void Promise.resolve(promise).catch(report); };
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
  const visibleText = (binding: ProjectUiText | undefined, context: ProjectUiContext, item?: ProjectUiItem): string => {
    if (!binding) return '';
    if (binding.kind === 'literal') return binding.value;
    if (binding.kind === 'data') return String(item?.[binding.field as keyof ProjectUiItem] ?? context.data(binding.field) ?? '');
    return String(context.read(binding.name, binding.kind) ?? '');
  };

  function applyStyle(element: HTMLElement, node: ProjectUiNode): void {
    const style = node.style;
    element.style.color = color(style?.color, theme.colors.text);
    element.style.fontFamily = options.fontFamily(style?.fontRole ?? 'ui');
    element.style.fontSize = `${style?.fontSize ?? theme.typography.uiSize}px`;
    element.style.textAlign = style?.align ?? 'left';
    element.style.opacity = String(style?.opacity ?? 1);
    if (style?.background !== undefined) element.style.backgroundColor = color(style.background, theme.colors.surface);
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
    const element = document.createElement(node.type === 'button' ? 'button' : 'div');
    element.dataset.uiNode = node.id;
    place(element, rect, parentRect);
    applyStyle(element, node);
    element.style.whiteSpace = 'pre-wrap';
    element.style.overflowWrap = 'anywhere';
    if (node.type === 'container') element.style.pointerEvents = 'none';
    else element.style.pointerEvents = 'auto';
    if (node.type === 'button') {
      const button = element as HTMLButtonElement;
      button.type = 'button';
      button.style.border = `1px solid ${hex(theme.colors.line)}`;
      button.style.borderRadius = `${theme.radius.md}px`;
      button.style.backgroundColor = color(node.style?.background, theme.colors.surface);
      button.style.cursor = 'pointer';
      button.style.fontWeight = '600';
      button.textContent = visibleText(node.text, display.context, item);
      if (node.text && node.text.kind !== 'literal') bindings.push(() => { button.textContent = visibleText(node.text, display.context, item); });
      if (theme.skins.buttonSkin) {
        const url = options.imageUrl(theme.skins.buttonSkin);
        if (url) { button.style.backgroundImage = `url(${JSON.stringify(url)})`; button.style.backgroundSize = '100% 100%'; }
      }
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (!node.action || display.pending || item?.disabled) return;
        errorStatus.textContent = '';
        display.pending = true;
        void Promise.resolve(display.context.action(node.action, item)).catch(report).finally(() => { display.pending = false; });
      });
    } else if (node.type === 'text') {
      element.textContent = visibleText(node.text, display.context, item);
      element.style.lineHeight = '1.45';
      element.style.pointerEvents = 'none';
      if (node.text && node.text.kind !== 'literal') bindings.push(() => { element.textContent = visibleText(node.text, display.context, item); });
    } else if (node.type === 'image') {
      const url = options.imageUrl(node.asset!);
      if (!url) throw new Error(`UI 图片未加载：${node.asset}`);
      const image = document.createElement('img');
      image.src = url;
      image.alt = node.text?.kind === 'literal' ? node.text.value : '';
      image.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none';
      element.appendChild(image);
      element.style.pointerEvents = 'none';
    } else if (node.type === 'toggle' || node.type === 'slider' || node.type === 'input') {
      const binding = node.binding!;
      const input = document.createElement('input');
      input.type = node.type === 'toggle' ? 'checkbox' : node.type === 'slider' ? 'range' : 'text';
      input.setAttribute('aria-label', node.text?.kind === 'literal' ? node.text.value : binding.name);
      input.style.cssText = 'width:100%;height:100%;box-sizing:border-box;font:inherit;color:inherit;accent-color:' + hex(theme.colors.accent);
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
      input.addEventListener(node.type === 'input' ? 'change' : 'input', () => {
        const value = node.type === 'toggle' ? input.checked : node.type === 'slider' ? Number(input.value) : input.value;
        wrap(display.context.write(binding, value));
      });
      element.appendChild(input);
    } else if (node.type === 'scroll') {
      element.style.overflow = 'auto';
      element.style.pointerEvents = 'auto';
    } else if (node.type === 'content') {
      element.style.overflow = 'auto';
      element.style.pointerEvents = 'auto';
      display.contents.push({ element, source: node.source!, template: node.children ?? [], rect, signature: '', bindings: [] });
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
          renderNode(display, child, panel, projectUiChildrenRect(rect, node.type), item, bindings);
        }
        select(tabs[0]!);
      }
    }
    parent.appendChild(element);
    if (node.type !== 'tabs' && node.type !== 'content') node.children?.forEach(child => renderNode(display, child, element, rect, item, bindings));
    return element;
  }

  function renderContent(display: Display, content: Display['contents'][number]): void {
    const items = display.context.content(content.source).map(item => ({ ...item, source: content.source }));
    const signature = JSON.stringify(items);
    if (signature === content.signature) return;
    const scrollTop = content.element.scrollTop;
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
        title.textContent = item.label;
        title.style.cssText = 'display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
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
      if (item.backupAvailable && item.readError) {
        const restore = document.createElement('button');
        restore.type = 'button'; restore.textContent = '恢复备份并读取';
        restore.style.cssText = `position:absolute;right:12px;top:12px;border:1px solid ${hex(theme.colors.line)};background:${hex(theme.colors.surface)};color:${hex(theme.colors.text)};cursor:pointer`;
        restore.onclick = event => { event.stopPropagation(); void activate(true); };
        row.appendChild(restore);
      }
      if (content.source === 'settings' && content.template.length === 0) {
        for (const [direction, label] of [[-1, '−'], [1, '+']] as const) {
          const step = document.createElement('button');
          step.type = 'button'; step.textContent = label;
          step.setAttribute('aria-label', `${item.label}${direction < 0 ? '减少' : '增加'}`);
          step.style.cssText = `position:absolute;right:${direction < 0 ? 72 : 12}px;top:12px;width:42px;height:34px;border:1px solid ${hex(theme.colors.line)};background:${hex(theme.colors.surface)};color:${hex(theme.colors.text)};cursor:pointer`;
          step.onclick = event => { event.stopPropagation(); wrap(display.context.action({ kind: 'setting-step', name: item.id, direction })); };
          row.appendChild(step);
        }
      }
      content.element.appendChild(row);
    });
    content.element.scrollTop = scrollTop;
  }

  function refresh(): void {
    if (disposed) return;
    for (const [page, display] of pages) {
      display.element.hidden = options.isPageVisible?.(page) === false;
      if (display.element.hidden) continue;
      display.bindings.forEach(update => update());
      display.contents.forEach(content => { renderContent(display, content); content.bindings.forEach(update => update()); });
    }
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
      const display: Display = { element, context, bindings: [], contents: [], pending: false };
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
      pages.clear();
      root.remove();
    },
  };
}
