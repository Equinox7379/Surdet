import { EDITOR_MODES, type EditorModeId } from './editor-modes.js';

export type ProjectSaveState = 'saved' | 'dirty' | 'partial-failure';

export interface ProjectBarProjection {
  projectName: string;
  objectLabel: string;
  saveState: ProjectSaveState;
  canUndo: boolean;
  canRedo: boolean;
  fsSupported?: boolean;
  hasScenes?: boolean;
}

export interface ProjectBarActions {
  onOpenProject(): void;
  onOpenReview(): void;
  onUndo(): void;
  onRedo(): void;
  onSaveProject(): void;
  onLoadDemo?(): void;
  onExportCurrent?(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const target = document.createElement(tag);
  if (className) target.className = className;
  if (text !== undefined) target.textContent = text;
  return target;
}

function actionButton(
  label: string,
  action: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = element('button', 'editor-command', label);
  button.type = 'button';
  button.disabled = disabled;
  button.setAttribute('data-action', action);
  button.setAttribute('data-action-scope', 'global');
  button.onclick = onClick;
  return button;
}

function saveStateLabel(state: ProjectSaveState): string {
  if (state === 'dirty') return '有未保存修改';
  if (state === 'partial-failure') return '保存后仍有未保存修改';
  return '已保存';
}

/**
 * 只更新项目栏的事实投影，不重建命令按钮，也不复制任何业务状态。
 * 编辑、选择和保存回调都可以复用这一入口，让顶栏始终反映当前内存事实。
 */
export function updateProjectBarProjection(
  projection: Pick<ProjectBarProjection, 'projectName' | 'objectLabel' | 'saveState'>,
  root: ParentNode = document,
): void {
  const projectName = root.querySelector<HTMLElement>('.editor-project-name');
  const currentObject = root.querySelector<HTMLElement>('.editor-current-object');
  const saveState = root.querySelector<HTMLElement>('.editor-save-state');
  if (projectName) projectName.textContent = projection.projectName;
  if (currentObject) currentObject.textContent = projection.objectLabel;
  if (saveState) {
    saveState.textContent = saveStateLabel(projection.saveState);
    saveState.setAttribute('data-save-state', projection.saveState);
  }
}

export function renderProjectBar(
  projection: ProjectBarProjection,
  actions: ProjectBarActions,
): HTMLElement {
  const header = element('header', 'editor-project-bar');
  header.setAttribute('data-editor-region', 'project-bar');

  const identity = element('div', 'editor-product-identity');
  identity.append(
    element('strong', 'editor-product-name', 'Surdet'),
    element('span', 'editor-product-kind', '剧本编辑器'),
  );

  const context = element('div', 'editor-project-context');
  context.append(
    element('span', 'editor-context-label', '当前项目'),
    element('strong', 'editor-project-name', projection.projectName),
    element('span', 'editor-current-object', projection.objectLabel),
  );

  const saveState = element('span', 'editor-save-state', saveStateLabel(projection.saveState));
  saveState.setAttribute('data-save-state', projection.saveState);
  context.appendChild(saveState);

  const commands = element('div', 'editor-project-commands');
  commands.setAttribute('aria-label', '项目命令');
  const fsSupported = projection.fsSupported ?? true;
  if (fsSupported) {
    commands.append(
      actionButton('打开项目', 'open-project', actions.onOpenProject),
      actionButton('打开审阅任务', 'open-review', actions.onOpenReview),
    );
  } else if (actions.onLoadDemo) {
    commands.appendChild(actionButton('加载演示项目', 'load-demo', actions.onLoadDemo));
  }
  if (!fsSupported && projection.hasScenes && actions.onExportCurrent) {
    commands.appendChild(actionButton('导出当前场景', 'export-current', actions.onExportCurrent));
  }
  commands.append(
    actionButton('撤销 Ctrl+Z', 'undo', actions.onUndo, !projection.canUndo),
    actionButton('重做 Ctrl+Y', 'redo', actions.onRedo, !projection.canRedo),
  );
  const save = actionButton('保存全部 Ctrl+S', 'save-project', actions.onSaveProject);
  save.className = 'editor-command editor-global-primary';
  save.setAttribute('aria-keyshortcuts', 'Control+S Meta+S');
  commands.appendChild(save);

  const status = element('span', 'editor-operation-status');
  status.id = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  header.append(identity, context, commands, status);
  return header;
}

export function renderModeNavigation(
  activeMode: EditorModeId,
  onSelect: (mode: EditorModeId) => void,
): HTMLElement {
  const navigation = element('nav', 'editor-mode-navigation');
  navigation.setAttribute('aria-label', '创作模式');
  navigation.setAttribute('data-editor-region', 'mode-navigation');

  const heading = element('div', 'editor-mode-navigation-title', '工作区');
  navigation.appendChild(heading);

  for (const mode of EDITOR_MODES) {
    const button = element('button', 'editor-mode-button', mode.label);
    button.type = 'button';
    button.setAttribute('data-editor-mode', mode.id);
    button.setAttribute('aria-controls', mode.panelId);
    if (mode.id === activeMode) button.setAttribute('aria-current', 'page');
    button.onclick = () => onSelect(mode.id);
    navigation.appendChild(button);
  }

  return navigation;
}
