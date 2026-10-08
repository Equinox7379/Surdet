import { EDITOR_MODE_GROUPS, EDITOR_MODES, type EditorModeId } from './editor-modes.js';
import { workbenchIcon } from './icons.js';

export type ProjectSaveState = 'saved' | 'dirty' | 'partial-failure';
export type RelayProtectionState = 'unavailable' | 'connected' | 'lost';
export type RelayUpdateState = 'none' | 'pending' | 'conflict';

export interface ProjectBarProjection {
  projectName: string;
  objectLabel: string;
  saveState: ProjectSaveState;
  canUndo: boolean;
  canRedo: boolean;
  fsSupported?: boolean;
  hasScenes?: boolean;
  writeLocked?: boolean;
  writeLockLabel?: string;
  writeLockTitle?: string;
  relayProtection?: RelayProtectionState;
  relayUpdate?: RelayUpdateState;
  relayDirty?: boolean;
  problems?: ProblemSummary | null;
}

/** Latest validation counts; null while the first validation is still pending. */
export interface ProblemSummary { errors: number; warnings: number }

export interface ProjectBarActions {
  onOpenProject(): void;
  onOpenReview(): void;
  onUndo(): void;
  onRedo(): void;
  onSaveProject(): void;
  onLoadDemo?(): void;
  onExportCurrent?(): void;
  onViewProjectChanges?(): void;
  onSyncProject?(): void;
  onDiscardProjectDrafts?(): void;
  onKeepProjectDrafts?(): void;
  onSearch?(): void;
  onShowProblems?(): void;
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
  button.setAttribute('title', shortcut ? `${label} (${shortcut})` : label);
  if (['open-project', 'open-review', 'undo', 'redo', 'save-project'].includes(action)) button.appendChild(workbenchIcon(action));
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

function relayProtectionLabel(state: RelayProtectionState): string {
  if (state === 'connected') return '接力保护：已连接';
  if (state === 'lost') return '接力保护：连接中断';
  return '接力保护：未接入';
}

function relayUpdateLabel(state: RelayUpdateState): string {
  if (state === 'pending') return '外部变更已写入项目';
  if (state === 'conflict') return '项目磁盘已变化，未覆盖你的草稿';
  return '';
}

function setRelayActionState(
  button: HTMLButtonElement | null,
  visible: boolean,
  disabled: boolean,
): void {
  if (!button) return;
  button.hidden = !visible;
  button.setAttribute('aria-hidden', String(!visible));
  button.disabled = disabled;
}

function setRelayActionLabel(button: HTMLButtonElement | null, label: string): void {
  const labelElement = button?.querySelector<HTMLElement>('.editor-command-label');
  if (labelElement) labelElement.textContent = label;
}

function updateRelayProjection(
  projection: Pick<ProjectBarProjection, 'relayProtection' | 'relayUpdate' | 'relayDirty' | 'writeLocked'>,
  root: ParentNode,
): void {
  const relay = root.querySelector<HTMLElement>('.editor-relay-status');
  if (!relay) return;
  const protection = projection.relayProtection ?? 'unavailable';
  const update = projection.relayUpdate ?? 'none';
  const dirty = projection.relayDirty === true;
  const connected = protection === 'connected';
  const writeDisabled = projection.writeLocked === true;
  const protectionElement = relay.querySelector<HTMLElement>('.editor-relay-protection');
  const updateElement = relay.querySelector<HTMLElement>('.editor-relay-update');
  const viewChanges = relay.querySelector<HTMLButtonElement>('[data-action="view-project-changes"]');
  const syncProject = relay.querySelector<HTMLButtonElement>('[data-action="sync-project"]');
  const keepDrafts = relay.querySelector<HTMLButtonElement>('[data-action="keep-project-drafts"]');
  const discardDrafts = relay.querySelector<HTMLButtonElement>('[data-action="discard-project-drafts"]');

  relay.setAttribute('data-relay-protection', protection);
  relay.setAttribute('data-relay-update', update);
  relay.setAttribute('data-relay-dirty', String(dirty));
  if (protectionElement) protectionElement.textContent = relayProtectionLabel(protection);
  if (updateElement) {
    updateElement.textContent = relayUpdateLabel(update);
    updateElement.hidden = update === 'none';
  }

  const hasExternalUpdate = update === 'pending' || update === 'conflict';
  setRelayActionLabel(viewChanges, update === 'conflict' ? '查看变化' : '查看范围');
  setRelayActionState(viewChanges, hasExternalUpdate, false);
  setRelayActionState(syncProject, update === 'pending' && connected, writeDisabled);
  setRelayActionState(keepDrafts, update === 'conflict', false);
  setRelayActionState(
    discardDrafts,
    connected && (update === 'conflict' || (update === 'none' && dirty)),
    writeDisabled,
  );
}

/**
 * 只更新项目栏的事实投影，不重建命令按钮，也不复制任何业务状态。
 * 编辑、选择和保存回调都可以复用这一入口，让顶栏始终反映当前内存事实。
 */
export function updateProjectBarProjection(
  projection: Pick<
    ProjectBarProjection,
    | 'projectName'
    | 'objectLabel'
    | 'saveState'
    | 'writeLocked'
    | 'writeLockLabel'
    | 'writeLockTitle'
    | 'relayProtection'
    | 'relayUpdate'
    | 'relayDirty'
  >,
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
    saveState.textContent = projection.writeLocked
      ? projection.writeLockLabel ?? '素材整理进行中'
      : saveStateLabel(projection.saveState);
    saveState.setAttribute('data-save-state', projection.saveState);
  }
  if (saveButton) {
    saveButton.disabled = projection.writeLocked === true;
    saveButton.title = projection.writeLocked
      ? projection.writeLockTitle ?? '素材整理完成后才能保存其他修改'
      : '';
  }
  for (const button of lockedCommands) {
    button.disabled = projection.writeLocked === true;
  }
  updateRelayProjection(projection, root);
}

export function updateProblemIndicator(summary: ProblemSummary | null, root: ParentNode = document): void {
  const control = root.querySelector<HTMLButtonElement>('.editor-status-problems');
  if (!control) return;
  const total = summary === null ? 0 : summary.errors + summary.warnings;
  const label = summary === null ? '等待校验'
    : total === 0 ? '没有问题'
    : [summary.errors ? `${summary.errors} 个错误` : '', summary.warnings ? `${summary.warnings} 条警告` : ''].filter(Boolean).join(' · ');
  control.textContent = label;
  control.setAttribute('data-problem-state', summary === null ? 'pending' : summary.errors ? 'error' : summary.warnings ? 'warning' : 'clean');
  control.setAttribute('aria-label', total === 0 ? `问题：${label}` : `问题：${label}，打开问题列表`);
  control.title = total === 0 ? label : `${label}：打开问题列表（F8 下一条，Shift+F8 上一条）`;
  control.disabled = total === 0;
}

export function renderProjectBar(
  projection: ProjectBarProjection,
  actions: ProjectBarActions,
): HTMLElement {
  const header = element('header', 'editor-project-bar');
  header.setAttribute('data-editor-region', 'project-bar');

  const identity = element('div', 'editor-product-identity');
  identity.setAttribute('data-editor-region', 'product-identity');
  identity.append(element('strong', 'editor-product-name', 'Surdet'));

  const context = element('div', 'editor-project-context');
  context.setAttribute('data-editor-region', 'project-context');
  context.append(
    contextItem('当前项目', 'editor-project-name', projection.projectName),
    contextItem('当前工作', 'editor-current-object', projection.objectLabel),
  );

  const search = element('div', 'editor-project-search');
  search.setAttribute('data-editor-region', 'project-search');
  if (actions.onSearch) {
    const control = actionButton('搜索场景、台词、角色和素材', 'search-project', actions.onSearch, false, 'Ctrl+K');
    control.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    control.prepend(workbenchIcon('search'));
    search.appendChild(control);
  }

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
  save.setAttribute(
    'title',
    projection.writeLocked
      ? projection.writeLockTitle ?? '素材整理完成后才能保存其他修改'
      : '',
  );
  saveCommands.appendChild(save);
  commands.append(projectCommands, editCommands, saveCommands);

  header.append(identity, context, search, commands);
  return header;
}

/**
 * Save state, operation messages and relay protection share one bottom status bar.
 * It is a separate landmark so long messages never push the title bar or navigation.
 */
export function renderStatusBar(
  projection: ProjectBarProjection,
  actions: Pick<ProjectBarActions, 'onViewProjectChanges' | 'onSyncProject' | 'onKeepProjectDrafts' | 'onDiscardProjectDrafts' | 'onShowProblems'>,
): HTMLElement {
  const footer = element('footer', 'editor-status-bar');
  footer.setAttribute('data-editor-region', 'status-bar');

  const saveState = element(
    'span',
    'editor-save-state',
    projection.writeLocked
      ? projection.writeLockLabel ?? '素材整理进行中'
      : saveStateLabel(projection.saveState),
  );
  saveState.setAttribute('data-save-state', projection.saveState);

  const status = element('span', 'editor-operation-status');
  status.id = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  // Validation counts stay visible here; operation messages keep the #status line.
  const problems = element('button', 'editor-status-problems');
  problems.type = 'button';
  problems.setAttribute('data-action', 'show-problems');
  problems.setAttribute('aria-keyshortcuts', 'F8 Shift+F8');
  if (actions.onShowProblems) problems.onclick = actions.onShowProblems;

  const feedback = element('div', 'editor-operation-feedback');
  feedback.setAttribute('data-editor-region', 'operation-feedback');
  feedback.append(saveState, problems, status);

  const relayStatus = element('div', 'editor-relay-status');
  relayStatus.setAttribute('aria-live', 'polite');
  const relayProtection = element('span', 'editor-relay-protection');
  const relayUpdate = element('span', 'editor-relay-update');
  const relayActions = element('span', 'editor-relay-actions');
  if (actions.onViewProjectChanges) {
    relayActions.appendChild(actionButton('查看范围', 'view-project-changes', actions.onViewProjectChanges));
  }
  if (actions.onSyncProject) {
    relayActions.appendChild(actionButton('同步项目', 'sync-project', actions.onSyncProject));
  }
  if (actions.onKeepProjectDrafts) {
    relayActions.appendChild(actionButton('保留草稿', 'keep-project-drafts', actions.onKeepProjectDrafts));
  }
  if (actions.onDiscardProjectDrafts) {
    relayActions.appendChild(actionButton('放弃草稿并同步', 'discard-project-drafts', actions.onDiscardProjectDrafts));
  }
  relayStatus.append(relayProtection, relayUpdate, relayActions);
  footer.append(feedback, relayStatus);
  updateRelayProjection(projection, footer);
  updateProblemIndicator(projection.problems ?? null, footer);
  return footer;
}

export interface ModeBadge { count: number; hint: string }

function applyModeBadge(button: HTMLElement, label: string, badge: ModeBadge | undefined): void {
  let mark = button.querySelector<HTMLElement>('.editor-mode-badge');
  if (badge === undefined || badge.count <= 0) {
    if (mark !== null) {
      mark.remove();
      button.title = label;
      button.removeAttribute('aria-label');
    }
    return;
  }
  if (mark === null) {
    mark = element('span', 'editor-mode-badge');
    mark.setAttribute('aria-hidden', 'true');
    button.appendChild(mark);
  }
  mark.textContent = badge.count > 99 ? '99+' : String(badge.count);
  button.title = `${label}：${badge.hint}`;
  button.setAttribute('aria-label', `${label}，${badge.hint}`);
}

/** A count on a mode is only a hint to look; the mode's own page holds the facts. */
export function updateModeNavigationBadge(mode: EditorModeId, badge: ModeBadge | undefined, root: ParentNode = document): void {
  const button = root.querySelector<HTMLElement>(`.editor-mode-button[data-editor-mode="${mode}"]`);
  const definition = EDITOR_MODES.find(({ id }) => id === mode);
  if (button !== null && definition !== undefined) applyModeBadge(button, definition.label, badge);
}

export function renderModeNavigation(
  activeMode: EditorModeId,
  onSelect: (mode: EditorModeId) => void,
  badges: Partial<Record<EditorModeId, ModeBadge>> = {},
): HTMLElement {
  const navigation = element('nav', 'editor-mode-navigation');
  navigation.setAttribute('aria-label', '创作模式');
  navigation.setAttribute('data-editor-region', 'mode-navigation');

  navigation.appendChild(element('div', 'editor-mode-navigation-title', '工作区'));

  for (const group of EDITOR_MODE_GROUPS) {
    const groupElement = element('div', 'editor-mode-group');
    groupElement.setAttribute('data-mode-group', group.id);
    groupElement.setAttribute('role', 'group');
    groupElement.setAttribute('aria-label', group.label);
    groupElement.appendChild(element('span', 'editor-mode-group-label', group.label));
    for (const mode of EDITOR_MODES.filter(({ group: modeGroup }) => modeGroup === group.id)) {
      const button = element('button', 'editor-mode-button');
      button.append(workbenchIcon(mode.id), element('span', 'editor-mode-label', mode.label));
      button.title = mode.label;
      button.type = 'button';
      button.setAttribute('data-editor-mode', mode.id);
      button.setAttribute('aria-controls', mode.panelId);
      if (mode.id === activeMode) button.setAttribute('aria-current', 'page');
      button.onclick = () => onSelect(mode.id);
      applyModeBadge(button, mode.label, badges[mode.id]);
      groupElement.appendChild(button);
    }
    navigation.appendChild(groupElement);
  }

  return navigation;
}
