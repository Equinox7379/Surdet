import { h } from '../state.js';
import type { TimelineAutosaveRestoreConflict } from '../project-io.js';
import { normalizeTimelineAutosaveDocument } from '../timeline-autosave-identity.js';

export interface TimelineAutosaveConflictPanelActions {
  onReplaceCurrent: (key: string) => void;
  onSaveAsNew: (key: string, newId: string) => void;
  onDiscard: (key: string) => void;
  onDownload: (key: string) => void;
}

type TimelineAutosaveConflictReason = TimelineAutosaveRestoreConflict['reason'] | 'quarantined-backup';

const REASON_LABELS: Record<string, string> = {
  'recovered-json-invalid': '自动备份配置文本 无法解析',
  'recovered-id-mismatch': '自动备份的名称、文件与内部标识 不一致',
  'current-json-invalid': '当前项目配置文本 无法解析',
  'current-id-mismatch': '当前项目的名称、文件与内部标识 不一致',
  'same-file-different-id': '同一文件对应了不同名称',
  'same-id-different-file': '同一名称对应了不同文件',
  'definition-id-collision': '内部标识 与其他时间轴冲突',
  'quarantined-backup': '这份备份此前发生过身份冲突，需要重新确认',
};

function reasonLabel(reason: TimelineAutosaveConflictReason): string {
  return REASON_LABELS[reason] ?? '时间轴身份需要重新确认';
}

function setButtonType(button: HTMLButtonElement): void {
  button.type = 'button';
  button.setAttribute('type', 'button');
}

function actionButton(
  label: string,
  className: string | undefined,
  action: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = h('button', className, label);
  setButtonType(button);
  button.setAttribute('data-conflict-action', action);
  button.disabled = disabled;
  button.onclick = onClick;
  return button;
}

function askForConfirmation(message: string): boolean {
  const confirmFn = (globalThis as typeof globalThis & {
    confirm?: (confirmationMessage: string) => boolean;
  }).confirm;
  if (typeof confirmFn !== 'function') return false;
  return confirmFn(message);
}

function displayIdentityValue(value: string | null | undefined, fallback = '未能解析'): string {
  return value && value.length > 0 ? value : fallback;
}

function appendIdentityField(container: HTMLElement, label: string, value: string): void {
  const row = h('div', 'timeline-autosave-conflict-field');
  row.append(
    h('span', 'timeline-autosave-conflict-field-label', label),
    h('code', 'timeline-autosave-conflict-field-value', value),
  );
  container.appendChild(row);
}

function appendIdentitySide(
  container: HTMLElement,
  side: 'current' | 'backup',
  document: TimelineAutosaveRestoreConflict['current'] | TimelineAutosaveRestoreConflict['recovered'],
  identity: TimelineAutosaveRestoreConflict['currentIdentity'] | TimelineAutosaveRestoreConflict['recoveredIdentity'],
): void {
  const section = h('section', `timeline-autosave-conflict-side ${side}`);
  section.setAttribute('data-conflict-side', side);
  section.appendChild(h('h3', undefined, side === 'current' ? '当前项目' : '自动备份'));
  if (document === null || identity === null) {
    section.appendChild(h('p', 'timeline-autosave-conflict-missing', '未找到对应的当前项目'));
    container.appendChild(section);
    return;
  }
  appendIdentityField(section, '文件', document.file);
  appendIdentityField(section, '稳定标识', document.id);
  appendIdentityField(section, 'JSON 内部标识', displayIdentityValue(identity.definitionId));
  appendIdentityField(section, '换行', document.eol === '\r\n' ? 'CRLF' : 'LF');
  container.appendChild(section);
}

function appendTechnicalDetails(
  card: HTMLElement,
  conflict: TimelineAutosaveRestoreConflict,
): void {
  const details = document.createElement('details');
  details.className = 'timeline-autosave-conflict-technical';
  details.setAttribute('data-conflict-technical', 'true');
  details.open = false;
  details.appendChild(h('summary', undefined, '技术详情'));

  const technicalBody = h('div', 'timeline-autosave-conflict-technical-body');
  technicalBody.appendChild(h('div', undefined, `冲突键：${conflict.key}`));
  technicalBody.appendChild(h('div', undefined, `机器原因：${conflict.reason}`));
  if (conflict.current !== null) {
    technicalBody.appendChild(h('h4', undefined, '当前项目配置文本'));
    technicalBody.appendChild(h('pre', undefined, conflict.current.text));
  }
  technicalBody.appendChild(h('h4', undefined, '自动备份配置文本'));
  technicalBody.appendChild(h('pre', undefined, conflict.recovered.text));
  details.appendChild(technicalBody);
  card.appendChild(details);
}

function appendActions(
  card: HTMLElement,
  conflict: TimelineAutosaveRestoreConflict,
  actions: TimelineAutosaveConflictPanelActions,
): void {
  const parseableBackup = conflict.recoveredIdentity.parseError === null;
  const hasCurrentTarget = conflict.current !== null;
  const replacement = conflict.current
    ? normalizeTimelineAutosaveDocument(conflict.recovered, conflict.current.id, conflict.current.file)
    : null;
  const canReplace = parseableBackup && replacement?.ok === true;
  const actionRow = h('div', 'timeline-autosave-conflict-actions');
  actionRow.setAttribute('role', 'group');
  actionRow.setAttribute('aria-label', '备份处理操作');

  const replace = actionButton(
    '替换当前时间轴',
    'primary',
    'replace-current',
    !canReplace,
    () => {
      if (!hasCurrentTarget || !canReplace) return;
      if (!askForConfirmation('确认用自动备份替换当前时间轴内容？')) return;
      actions.onReplaceCurrent(conflict.key);
    },
  );
  actionRow.appendChild(replace);

  const newIdLabel = h('label', 'timeline-autosave-conflict-new-id-label', '新时间轴标识');
  const newId = h('input', 'timeline-autosave-conflict-new-id') as HTMLInputElement;
  newId.type = 'text';
  newId.setAttribute('type', 'text');
  newId.setAttribute('data-conflict-new-id', 'true');
  newId.placeholder = '例如 opening-copy';
  newId.disabled = !parseableBackup;
  newIdLabel.appendChild(newId);
  actionRow.appendChild(newIdLabel);

  const saveAsNew = actionButton(
    '另存为新时间轴',
    undefined,
    'save-as-new',
    !parseableBackup,
    () => {
      if (!parseableBackup) return;
      actions.onSaveAsNew(conflict.key, newId.value.trim());
    },
  );
  actionRow.appendChild(saveAsNew);

  const download = actionButton(
    '下载自动备份',
    'timeline-autosave-conflict-secondary',
    'download',
    false,
    () => actions.onDownload(conflict.key),
  );
  actionRow.appendChild(download);

  const discard = actionButton(
    '放弃此备份',
    'timeline-autosave-conflict-secondary timeline-autosave-conflict-discard',
    'discard',
    false,
    () => {
      if (!askForConfirmation('确认保留当前项目并放弃这份自动备份？')) return;
      actions.onDiscard(conflict.key);
    },
  );
  actionRow.appendChild(discard);
  card.appendChild(actionRow);
}

function renderConflictCard(
  conflict: TimelineAutosaveRestoreConflict,
  actions: TimelineAutosaveConflictPanelActions,
): HTMLElement {
  const card = h('article', 'timeline-autosave-conflict-card');
  card.setAttribute('data-conflict-key', conflict.key);
  card.setAttribute('data-conflict-reason', conflict.reason);

  const title = h('h3', 'timeline-autosave-conflict-title', '时间轴身份冲突');
  const reason = h('p', 'timeline-autosave-conflict-reason');
  reason.append(h('span', 'timeline-autosave-conflict-reason-label', '需要确认：'), h('strong', undefined, reasonLabel(conflict.reason)));
  card.append(title, reason);

  const identities = h('div', 'timeline-autosave-conflict-identities');
  appendIdentitySide(identities, 'current', conflict.current, conflict.currentIdentity);
  appendIdentitySide(identities, 'backup', conflict.recovered, conflict.recoveredIdentity);
  card.appendChild(identities);
  appendTechnicalDetails(card, conflict);
  appendActions(card, conflict, actions);
  return card;
}

export function renderTimelineAutosaveConflictPanel(
  container: HTMLElement,
  conflicts: readonly TimelineAutosaveRestoreConflict[],
  actions: TimelineAutosaveConflictPanelActions,
): void {
  container.textContent = '';
  container.hidden = false;
  if (conflicts.length === 0) return;

  const panel = h('section', 'timeline-autosave-conflicts');
  panel.setAttribute('data-editor-panel', 'timeline-autosave-conflicts');
  panel.appendChild(h('h2', undefined, '演出备份需要处理'));
  panel.appendChild(h('p', 'timeline-autosave-conflicts-summary', `发现 ${conflicts.length} 条自动备份，需要你确认处理方式。`));
  const later = actionButton(
    '稍后处理',
    'timeline-autosave-conflict-later',
    'later',
    false,
    () => { container.hidden = true; },
  );
  panel.appendChild(later);
  for (const conflict of conflicts) panel.appendChild(renderConflictCard(conflict, actions));
  container.appendChild(panel);
}
