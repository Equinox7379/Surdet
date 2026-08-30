export interface AuthoringWorkbenchElements {
  root: HTMLElement;
  outline: HTMLElement;
  search: HTMLElement;
  manuscript: HTMLElement;
  context: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Builds the script workspace topology only. Business state, project IO and
 * authoring callbacks stay in main.ts and the existing panels.
 */
export function buildAuthoringWorkbench(): AuthoringWorkbenchElements {
  const root = element('div', 'main-body authoring-workbench');
  root.setAttribute('data-editor-region', 'authoring-workbench');
  root.setAttribute('data-auxiliary-view', 'outline');

  const outline = element('aside', 'authoring-outline');
  outline.id = 'sidebar';
  outline.setAttribute('data-editor-region', 'outline');
  outline.setAttribute('aria-label', '场景与素材目录');

  const manuscriptColumn = element('section', 'editor-col authoring-manuscript-column');
  manuscriptColumn.setAttribute('data-editor-region', 'manuscript-column');
  manuscriptColumn.setAttribute('aria-label', '连续剧本稿件');

  const toolbar = element('div', 'authoring-workbench-toolbar');
  toolbar.setAttribute('data-editor-region', 'manuscript-toolbar');

  const auxiliaryToggle = element('button', 'authoring-context-toggle');
  auxiliaryToggle.type = 'button';
  auxiliaryToggle.textContent = '显示上下文';
  auxiliaryToggle.setAttribute('data-action', 'toggle-authoring-context');
  auxiliaryToggle.setAttribute('aria-controls', 'right');
  auxiliaryToggle.setAttribute('aria-expanded', 'false');
  auxiliaryToggle.onclick = () => {
    const showContext = root.getAttribute('data-auxiliary-view') !== 'context';
    root.setAttribute('data-auxiliary-view', showContext ? 'context' : 'outline');
    auxiliaryToggle.setAttribute('aria-expanded', String(showContext));
    auxiliaryToggle.textContent = showContext ? '返回目录' : '显示上下文';
  };

  const search = element('div', 'authoring-search');
  search.id = 'search-panel';
  search.setAttribute('data-editor-region', 'manuscript-search');
  toolbar.append(auxiliaryToggle, search);

  const manuscript = element('section', 'authoring-manuscript-scroll');
  manuscript.id = 'editor';
  manuscript.setAttribute('data-editor-region', 'manuscript');
  manuscript.setAttribute('aria-label', '当前场景连续稿件');
  manuscriptColumn.append(toolbar, manuscript);

  const context = element('aside', 'authoring-context');
  context.id = 'right';
  context.setAttribute('data-editor-region', 'context');
  context.setAttribute('aria-label', '当前对象与项目上下文');

  root.append(outline, manuscriptColumn, context);
  return { root, outline, search, manuscript, context };
}
