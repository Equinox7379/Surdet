import { EDITOR_MODE_GROUPS, EDITOR_MODES, type EditorModeId } from './editor-modes.js';

export type ProjectSaveState = 'saved' | 'dirty' | 'partial-failure';

export interface ProjectBarProjection {
  projectName: string;
  objectLabel: string;
  saveState: ProjectSaveState;
  canUndo: boolean;
  canRedo: boolean;
  fsSupported?: boolean;
  hasScenes?: boolean;
  writeLocked?: boolean;
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
  shortcut?: string,
): HTMLButtonElement {
  const button = element('button', 'editor-command');
  button.type = 'button';
  button.disabled = disabled;
  button.setAttribute('data-action', action);
  button.setAttribute('data-action-scope', 'global');
  button.onclick = onClick;
  button.appendChild(element('span', 'editor-command-label', label));
  if (shortcut !== undefined) button.appendChild(element('kbd', 'editor-command-shortcut', shortcut));
  return button;
}

function contextItem(label: string, valueClass: string, value: string): HTMLElement {
  const item = element('span', 'editor-context-item');
  item.append(
    element('span', 'editor-context-label', label),
    element('strong', valueClass, value),
  );
  return item;
}

function commandGroup(id: string, label: string): HTMLElement {
  const group = element('div', 'editor-command-group');
  group.setAttribute('data-command-group', id);
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  return group;
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
  projection: Pick<ProjectBarProjection, 'projectName' | 'objectLabel' | 'saveState'> & { writeLocked?: boolean },
  root: ParentNode = document,
): void {
  const projectName = root.querySelector<HTMLElement>('.editor-project-name');
  const currentObject = root.querySelector<HTMLElement>('.editor-current-object');
  const saveState = root.querySelector<HTMLElement>('.editor-save-state');
  const saveButton = root.querySelector<HTMLButtonElement>('[data-action="save-project"]');
  const lockedCommands = root.querySelectorAll<HTMLButtonElement>(
    '[data-action="open-project"], [data-action="open-review"], [data-action="undo"], [data-action="redo"]',
  );
  if (projectName) projectName.textContent = projection.projectName;
  if (currentObject) currentObject.textContent = projection.objectLabel;
  if (saveState) {
    saveState.textContent = projection.writeLocked ? '素材整理进行中' : saveStateLabel(projection.saveState);
    saveState.setAttribute('data-save-state', projection.saveState);
  }
  if (saveButton) {
    saveButton.disabled = projection.writeLocked === true;
    saveButton.title = projection.writeLocked ? '素材整理完成后才能保存其他修改' : '';
  }
  for (const button of lockedCommands) {
    button.disabled = projection.writeLocked === true;
  }
}

export function renderProjectBar(
  projection: ProjectBarProjection,
  actions: ProjectBarActions,
): HTMLElement {
  const header = element('header', 'editor-project-bar');
  header.setAttribute('data-editor-region', 'project-bar');

  const identity = element('div', 'editor-product-identity');
  identity.setAttribute('data-editor-region', 'product-identity');
  const productMark = element('span', 'editor-product-mark', '述');
  productMark.setAttribute('aria-hidden', 'true');
  const productText = element('span', 'editor-product-text');
  productText.append(
    element('strong', 'editor-product-name', 'Surdet'),
    element('span', 'editor-product-kind', '剧情创作'),
  );
  identity.append(
    productMark,
    productText,
  );

  const context = element('div', 'editor-project-context');
  context.setAttribute('data-editor-region', 'project-context');
  context.append(
    contextItem('当前项目', 'editor-project-name', projection.projectName),
    contextItem('当前工作', 'editor-current-object', projection.objectLabel),
  );

  const saveState = element('span', 'editor-save-state', saveStateLabel(projection.saveState));
  saveState.setAttribute('data-save-state', projection.saveState);

  const commands = element('div', 'editor-project-commands');
  commands.setAttribute('data-editor-region', 'global-commands');
  commands.setAttribute('aria-label', '项目命令');
  const projectCommands = commandGroup('project', '项目');
  const editCommands = commandGroup('edit', '编辑');
  const saveCommands = commandGroup('save', '保存');
  const fsSupported = projection.fsSupported ?? true;
  if (fsSupported) {
    projectCommands.append(
      actionButton('打开项目', 'open-project', actions.onOpenProject, projection.writeLocked === true),
      actionButton('打开审阅任务', 'open-review', actions.onOpenReview, projection.writeLocked === true),
    );
  } else if (actions.onLoadDemo) {
    projectCommands.appendChild(actionButton('加载演示项目', 'load-demo', actions.onLoadDemo));
  }
  if (!fsSupported && projection.hasScenes && actions.onExportCurrent) {
    projectCommands.appendChild(actionButton('导出当前场景', 'export-current', actions.onExportCurrent));
  }
  editCommands.append(
    actionButton('撤销', 'undo', actions.onUndo, projection.writeLocked === true || !projection.canUndo, 'Ctrl+Z'),
    actionButton('重做', 'redo', actions.onRedo, projection.writeLocked === true || !projection.canRedo, 'Ctrl+Y'),
  );
  const save = actionButton('保存全部', 'save-project', actions.onSaveProject, projection.writeLocked === true, 'Ctrl+S');
  save.className = 'editor-command editor-global-primary';
  save.setAttribute('aria-keyshortcuts', 'Control+S Meta+S');
  saveCommands.appendChild(save);
  commands.append(projectCommands, editCommands, saveCommands);

  const status = element('span', 'editor-operation-status');
  status.id = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const feedback = element('div', 'editor-operation-feedback');
  feedback.setAttribute('data-editor-region', 'operation-feedback');
  feedback.append(saveState, status);

  header.append(identity, context, commands, feedback);
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

  for (const group of EDITOR_MODE_GROUPS) {
    const groupElement = element('div', 'editor-mode-group');
    groupElement.setAttribute('data-mode-group', group.id);
    groupElement.setAttribute('role', 'group');
    groupElement.setAttribute('aria-label', group.label);
    groupElement.appendChild(element('span', 'editor-mode-group-label', group.label));
    for (const mode of EDITOR_MODES.filter(({ group: modeGroup }) => modeGroup === group.id)) {
      const button = element('button', 'editor-mode-button', mode.label);
      button.type = 'button';
      button.setAttribute('data-editor-mode', mode.id);
      button.setAttribute('aria-controls', mode.panelId);
      if (mode.id === activeMode) button.setAttribute('aria-current', 'page');
      button.onclick = () => onSelect(mode.id);
      groupElement.appendChild(button);
    }
    navigation.appendChild(groupElement);
  }

  return navigation;
}
