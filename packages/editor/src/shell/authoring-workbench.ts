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

/** Layout only. The original sidebar, search, validation, history and IO retain ownership. */
export function buildAuthoringWorkbench(): AuthoringWorkbenchElements {
  const root = element('div', 'main-body authoring-workbench v4-authoring');
  root.dataset.editorRegion = 'authoring-workbench'; root.dataset.auxiliaryView = 'outline';
  root.dataset.mobilePanel = 'editor'; root.style.setProperty('--v4-dock-width', dockWidth ? `${dockWidth}px` : '46%');
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
  toolbar.append(viewToolbar, search);
  const manuscript = element('section', 'authoring-manuscript-scroll'); manuscript.id = 'editor';
  manuscript.dataset.editorRegion = 'manuscript'; manuscript.setAttribute('aria-label', '当前场景');
  center.append(toolbar, manuscript);
  const divider = element('div', 'v4-resizer'); divider.tabIndex = 0; divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical'); divider.setAttribute('aria-label', '调整画面与属性区宽度');
  divider.setAttribute('aria-valuemin', '320'); divider.setAttribute('aria-valuemax', '960'); divider.setAttribute('aria-valuenow', String(dockWidth || 480));
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    if (root.isConnected) {
      const measured = root.querySelector<HTMLElement>('.v4-script-dock')!.getBoundingClientRect().width;
      if (measured > 0) divider.setAttribute('aria-valuenow', String(Math.round(measured)));
    }
  });
  const resize = (width: number): void => {
    dockWidth = Math.max(320, Math.min(960, Math.round(width), root.clientWidth * 0.55));
    root.style.setProperty('--v4-dock-width', `${dockWidth}px`); divider.setAttribute('aria-valuenow', String(dockWidth));
  };
  divider.onkeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); resize((dockWidth || root.querySelector<HTMLElement>('.v4-script-dock')!.getBoundingClientRect().width) + (event.key === 'ArrowLeft' ? 20 : -20));
  };
  divider.onpointerdown = (event) => {
    if (event.button !== 0) return; event.preventDefault();
    const start = dockWidth || root.querySelector<HTMLElement>('.v4-script-dock')!.getBoundingClientRect().width; divider.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent): void => resize(start + event.clientX - next.clientX);
    const end = (): void => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', end); divider.removeEventListener('pointercancel', cancel); if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId); };
    const cancel = (): void => { resize(start); end(); };
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', cancel);
  };
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
  root.append(navigation, outline, center, divider, dock);
  return { root, outline, search, manuscript, context };
}
