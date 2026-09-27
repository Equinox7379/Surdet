export interface AuthoringWorkbenchElements {
  root: HTMLElement; outline: HTMLElement; search: HTMLElement;
  manuscript: HTMLElement; context: HTMLElement;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
let dockWidth = 0;
let outlineWidth = 210;
let outlineCollapsed = false;
let disposeLayout: (() => void) | null = null;
export function disposeAuthoringWorkbench(): void { disposeLayout?.(); disposeLayout = null; }

export function toggleAuthoringOutline(root: HTMLElement): boolean {
  outlineCollapsed = root.dataset.outlineCollapsed !== 'true';
  root.dataset.outlineCollapsed = String(outlineCollapsed);
  return !outlineCollapsed;
}

/** Layout only. The original sidebar, search, validation, history and IO retain ownership. */
export function buildAuthoringWorkbench(): AuthoringWorkbenchElements {
  disposeAuthoringWorkbench();
  const root = element('div', 'main-body authoring-workbench v4-authoring');
  root.dataset.editorRegion = 'authoring-workbench'; root.dataset.auxiliaryView = 'outline';
  root.dataset.outlineCollapsed = String(outlineCollapsed);
  root.dataset.mobilePanel = 'editor'; root.style.setProperty('--v4-dock-width', dockWidth ? `${dockWidth}px` : '34%');
  root.style.setProperty('--studio-outline-width', `${outlineWidth}px`);
  const outline = element('aside', 'authoring-outline');
  outline.id = 'sidebar'; outline.dataset.editorRegion = 'outline'; outline.setAttribute('aria-label', '场景与素材目录');
  const center = element('section', 'editor-col authoring-manuscript-column');
  center.dataset.editorRegion = 'manuscript-column'; center.setAttribute('aria-label', '剧情编排与稿件');
  const navigation = element('nav', 'v4-mobile-nav'); navigation.setAttribute('aria-label', '剧本工作区');
  const panels = [['outline', '目录'], ['editor', '编排'], ['picture', '画面'], ['inspector', '属性'], ['context', '引用与问题']] as const;
  for (const [key, label] of panels) {
    const control = element('button', 'v4-button', label); control.type = 'button'; control.dataset.workbenchPanel = key;
    control.setAttribute('aria-pressed', String(key === 'editor'));
    control.onclick = () => {
      root.dataset.mobilePanel = key; root.dataset.auxiliaryView = key === 'context' ? 'context' : 'outline';
      for (const item of navigation.querySelectorAll<HTMLElement>('[data-workbench-panel]')) item.setAttribute('aria-pressed', String(item.dataset.workbenchPanel === key));
      if (key === 'context') (root.querySelector('.v4-project-context') as HTMLDetailsElement).open = true;
    };
    navigation.append(control);
  }
  const toolbar = element('div', 'authoring-workbench-toolbar'); toolbar.dataset.editorRegion = 'manuscript-toolbar';
  const viewToolbar = element('div', 'v4-script-toolbar'); viewToolbar.id = 'script-v4-toolbar';
  const search = element('div', 'authoring-search'); search.id = 'search-panel'; search.dataset.editorRegion = 'manuscript-search';
  const searchDrawer = element('details', 'authoring-search-drawer');
  searchDrawer.append(element('summary', '', '查找和替换'), search);
  toolbar.append(viewToolbar, searchDrawer);
  const manuscript = element('section', 'authoring-manuscript-scroll'); manuscript.id = 'editor';
  manuscript.dataset.editorRegion = 'manuscript'; manuscript.setAttribute('aria-label', '当前场景');
  center.append(toolbar, manuscript);
  const cleanups: Array<() => void> = [];
  const separator = (side: 'outline' | 'dock'): HTMLElement => {
    const control = element('div', side === 'dock' ? 'v4-resizer' : 'studio-outline-resizer');
    control.tabIndex = 0; control.setAttribute('role', 'separator'); control.setAttribute('aria-orientation', 'vertical');
    control.setAttribute('aria-label', side === 'dock' ? '调整画面与属性区宽度' : '调整目录宽度');
    const measured = (): number => (side === 'dock' ? dock : outline).getBoundingClientRect().width;
    const limits = (): { min: number; max: number } => {
      const min = side === 'dock' ? 320 : 170;
      const reserved = side === 'dock' ? outline.getBoundingClientRect().width : dock.getBoundingClientRect().width;
      const max = Math.max(min, Math.min(side === 'dock' ? 960 : 330, root.clientWidth - reserved - 332));
      return { min, max };
    };
    const reportSize = (): void => {
      const { min, max } = limits();
      control.setAttribute('aria-valuemin', String(min)); control.setAttribute('aria-valuemax', String(max));
      control.setAttribute('aria-valuenow', String(Math.round(measured())));
    };
    const resize = (width: number): void => {
      const { min, max } = limits();
      const value = Math.max(min, Math.min(max, Math.round(width)));
      if (side === 'dock') dockWidth = value; else outlineWidth = value;
      root.style.setProperty(side === 'dock' ? '--v4-dock-width' : '--studio-outline-width', `${value}px`);
      reportSize();
    };
    control.onkeydown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); resize(measured() + (event.key === 'ArrowLeft' ? -20 : 20) * (side === 'dock' ? -1 : 1));
    };
    control.onpointerdown = (event) => {
      if (event.button !== 0) return; event.preventDefault();
      const start = measured(); control.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent): void => resize(start + (next.clientX - event.clientX) * (side === 'dock' ? -1 : 1));
      const end = (): void => {
        control.removeEventListener('pointermove', move); control.removeEventListener('pointerup', end); control.removeEventListener('pointercancel', cancel); control.removeEventListener('lostpointercapture', end);
        if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
        const index = cleanups.indexOf(end); if (index >= 0) cleanups.splice(index, 1);
      };
      const cancel = (): void => { resize(start); end(); };
      cleanups.push(end);
      control.addEventListener('pointermove', move); control.addEventListener('pointerup', end); control.addEventListener('pointercancel', cancel);
      control.addEventListener('lostpointercapture', end);
    };
    control.ondblclick = () => resize(side === 'dock' ? root.clientWidth * .4 : 210);
    requestAnimationFrame(() => {
      if (!root.isConnected) return;
      reportSize();
      const observer = new ResizeObserver(reportSize);
      observer.observe(root); observer.observe(dock); observer.observe(outline);
      cleanups.push(() => observer.disconnect());
    });
    return control;
  };
  const divider = separator('dock');
  const outlineDivider = separator('outline');
  const dock = element('aside', 'v4-script-dock'); dock.setAttribute('aria-label', '画面与当前对象属性');
  const picture = element('section', 'v4-script-picture');
  const stageTools = element('div', 'v4-stage-tools'); stageTools.id = 'script-v4-stage-tools';
  const layout = element('div'); layout.id = 'script-v4-edit-layout';
  const runtime = element('div'); runtime.id = 'script-v4-runtime'; runtime.hidden = true;
  const status = element('p', 'v4-source-status'); status.id = 'script-v4-source-status'; status.setAttribute('aria-live', 'polite');
  picture.append(stageTools, layout, runtime, status);
  const inspector = element('section', 'v4-script-inspector'); inspector.id = 'script-v4-inspector'; inspector.setAttribute('aria-label', '当前步骤属性');
  const contextual = element('details', 'v4-project-context');
  const summary = element('summary', '', '引用、问题与项目'); summary.dataset.action = 'toggle-authoring-context';
  const context = element('aside', 'authoring-context'); context.id = 'right'; context.dataset.editorRegion = 'context'; context.setAttribute('aria-label', '当前对象与项目上下文');
  contextual.append(summary, context); dock.append(picture, inspector, contextual);
  root.append(navigation, outline, outlineDivider, center, divider, dock);
  disposeLayout = () => { for (const cleanup of [...cleanups]) cleanup(); };
  return { root, outline, search, manuscript, context };
}
