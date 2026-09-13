import type { ProjectAssetKind } from '@surdet/authoring';
import { h } from '../state.js';
import type { AssetImportOperationDetail } from '../asset-import-client.js';
import type {
  AssetImportDraftItem,
  AssetImportWorkspace,
  AssetImportWorkspaceProjection,
} from '../asset-import-workspace.js';

const CATEGORY_LABELS: Readonly<Record<ProjectAssetKind, string>> = {
  background: '背景',
  portrait: '立绘',
  avatar: '头像',
  music: '音乐',
  ambience: '环境音',
  'sound-effect': '音效',
  voice: '语音',
  video: '视频',
  font: '字体',
  other: '其他',
};

const CATEGORY_ORDER: readonly ProjectAssetKind[] = [
  'background',
  'portrait',
  'avatar',
  'music',
  'ambience',
  'sound-effect',
  'voice',
  'video',
  'font',
  'other',
];

const ISSUE_LABELS: Readonly<Record<string, string>> = {
  IMPORT_NAME_INVALID: '文件名不符合安全要求。',
  IMPORT_FORMAT_UNSUPPORTED: '当前分类不支持这个文件格式。',
  IMPORT_PORTRAIT_NAME_INVALID: '立绘名称需要包含角色、服装和表情。',
  IMPORT_TARGET_DUPLICATE_IN_BATCH: '本次选择中有重复的目标位置。',
  IMPORT_TARGET_EXISTS: '目标位置已有同名文件，请换一个名称。',
  IMPORT_ASSET_KEY_CONFLICT: '这个素材名称已被其他图片使用，请换一个名称。',
  IMPORT_TARGET_UNSAFE: '目标位置不可用，请检查文件名。',
};

const FILE_NAME_ISSUES = new Set([
  'IMPORT_NAME_INVALID',
  'IMPORT_TARGET_UNSAFE',
  'IMPORT_TARGET_DUPLICATE_IN_BATCH',
  'IMPORT_TARGET_EXISTS',
  'IMPORT_ASSET_KEY_CONFLICT',
  'IMPORT_PORTRAIT_NAME_INVALID',
]);

const EMPTY_PROJECTION: AssetImportWorkspaceProjection = {
  entryState: 'unavailable',
  projectIdentity: null,
  projectName: null,
  bindingExpiresAt: null,
  recoveryBarrier: 'clear',
  pendingOperations: [],
  recentReceipts: [],
  activeOperation: null,
  draftItems: [],
  message: null,
};

export interface AssetImportWorkbenchHooks {
  workspace?: AssetImportWorkspace;
  busy?: boolean;
  onSelectFiles?: (files: readonly File[]) => void;
  onRemoveFile?: (itemId: string) => void;
  onUpdateFile?: (itemId: string, update: { fileName?: string; kind?: ProjectAssetKind | null }) => void;
  onBindProject?: () => void;
  onRecoverOperation?: (operationId: string, action: 'resume' | 'rollback') => void;
  onPrepareImport?: () => void;
  onCommitImport?: () => void;
  onCancelImport?: () => void;
  onOpenReceipt?: (operationId: string) => void;
  onViewImportedAssets?: () => void;
  onUndoImport?: (receiptId: string, receiptSha256: string) => void;
  refreshProjectAssetIntelligence?: () => void | Promise<void>;
}

type AssetDropTransfer = Pick<DataTransfer, 'items' | 'files' | 'types'>;

type EntryAwareDropItem = DataTransferItem & {
  webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
};

export function assetDropHasFiles(dataTransfer: AssetDropTransfer): boolean {
  const items = Array.from(dataTransfer.items);
  if (items.length > 0) {
    return items.some((item) => {
      if (item.kind !== 'file') return false;
      const entry = (item as EntryAwareDropItem).webkitGetAsEntry?.();
      return entry?.isDirectory !== true;
    });
  }
  return Array.from(dataTransfer.files).length > 0
    || Array.from(dataTransfer.types).includes('Files');
}

export function assetDropFiles(dataTransfer: AssetDropTransfer): File[] {
  const items = Array.from(dataTransfer.items);
  if (items.length === 0) return Array.from(dataTransfer.files);
  return items.flatMap((item) => {
    if (item.kind !== 'file') return [];
    const entry = (item as EntryAwareDropItem).webkitGetAsEntry?.();
    if (entry?.isDirectory) return [];
    const file = item.getAsFile();
    return file === null ? [] : [file];
  });
}

export function assetFileTypeLabel(file: File): string {
  const family = file.type.split('/')[0];
  if (family === 'image') return '图片';
  if (family === 'audio') return '音频';
  if (family === 'video') return '视频';
  if (family === 'font') return '字体';
  if (family === 'text') return '文本';
  return '文件';
}

function entryStateCopy(state: AssetImportWorkspaceProjection['entryState']): string {
  if (state === 'unavailable') return '本机素材导入服务未连接；素材浏览仍可使用。';
  if (state === 'unbound') return '先确认当前项目目录，确认后才能导入素材。';
  if (state === 'mismatch') return '当前打开的目录与导入服务绑定的项目不一致。';
  if (state === 'manual-recovery') return '这次导入需要人工恢复，新的导入已暂停。';
  if (state === 'recoverable') return '发现一项未完成的导入，可以从安全位置继续。';
  return '当前项目已确认，可以选择要导入的素材。';
}

function destinationDirectory(kind: ProjectAssetKind): string {
  const directories: Readonly<Record<ProjectAssetKind, string>> = {
    background: '背景',
    portrait: '立绘',
    avatar: '头像',
    music: '音乐',
    ambience: '环境音',
    'sound-effect': '音效',
    voice: '语音',
    video: '视频',
    font: '字体',
    other: '其他',
  };
  return directories[kind];
}

function destinationPreview(item: AssetImportDraftItem): string {
  if (item.kind === null) return '素材 / 请选择分类 / 尚未命名';
  return `素材 / ${destinationDirectory(item.kind)} / ${item.fileName || '尚未命名'}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function operationStage(operation: AssetImportOperationDetail | null): string {
  const status = operation?.operation.status;
  if (status === 'UPLOADING') return '正在上传';
  if (status === 'PUBLISHING' || status === 'ROLLING_BACK' || status === 'UNDOING') return '正在写入项目';
  if (status === 'COMMITTED') return '导入完成';
  if (status === 'RECOVERY_REQUIRED') return '需要人工恢复';
  if (status === 'UNDONE') return '已撤销';
  return '准备导入';
}

function operationIsBusy(operation: AssetImportOperationDetail | null): boolean {
  return operation?.operation.status === 'UPLOADING'
    || operation?.operation.status === 'PUBLISHING'
    || operation?.operation.status === 'ROLLING_BACK'
    || operation?.operation.status === 'UNDOING';
}

function operationIsTerminal(operation: AssetImportOperationDetail | null): boolean {
  return operation !== null
    && ['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(operation.operation.status);
}

function operationIssues(
  operation: AssetImportOperationDetail | null,
  itemId: string,
): readonly string[] {
  return operation?.plan?.items.find((item) => item.itemId === itemId)?.issues ?? [];
}

function issueCopy(issues: readonly string[], kind: ProjectAssetKind | null): string {
  if (kind === null) return '请选择素材分类。';
  if (issues.length === 0) return '等待计划检查。';
  return issues.map((issue) => ISSUE_LABELS[issue] ?? '这项素材需要处理。').join(' ');
}

function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/');
}

function callWorkspaceOrHook(
  workspace: AssetImportWorkspace | undefined,
  hook: (() => void) | undefined,
): void {
  if (hook !== undefined) hook();
  else workspace?.clearDraft();
}

function callUpdateFile(
  workspace: AssetImportWorkspace | undefined,
  hook: AssetImportWorkbenchHooks['onUpdateFile'],
  itemId: string,
  update: { fileName?: string; kind?: ProjectAssetKind | null },
): void {
  if (hook !== undefined) hook(itemId, update);
  else workspace?.updateFile(itemId, update);
}

function renderFilePreview(host: HTMLElement, item: AssetImportDraftItem): void {
  host.replaceChildren();
  host.dataset.previewState = item.previewUrl === null ? 'unavailable' : 'ready';
  if (item.previewUrl === null) {
    host.appendChild(h('span', 'asset-import-preview-empty', '暂无本地预览'));
    return;
  }
  if (item.file.type.startsWith('image/')) {
    const image = document.createElement('img');
    image.src = item.previewUrl;
    image.alt = `素材预览：${item.sourceName}`;
    host.appendChild(image);
    return;
  }
  if (item.file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'metadata';
    video.src = item.previewUrl;
    video.setAttribute('aria-label', `视频预览：${item.sourceName}`);
    host.appendChild(video);
    return;
  }
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = item.previewUrl;
  audio.setAttribute('aria-label', `音频预览：${item.sourceName}`);
  host.appendChild(audio);
}

function renderSelectedInspector(
  host: HTMLElement,
  selected: AssetImportDraftItem | null,
  operation: AssetImportOperationDetail | null,
): void {
  host.replaceChildren();
  host.className = 'asset-import-inspector';
  host.setAttribute('aria-label', '预览与问题说明');
  host.appendChild(h('p', 'asset-import-eyebrow', '预览与问题'));
  if (selected === null) {
    host.append(
      h('h3', undefined, '选择一项素材'),
      h('p', 'asset-import-muted', '选中的文件会在这里显示预览、目标位置和需要处理的问题。'),
    );
    return;
  }
  host.appendChild(h('h3', undefined, selected.sourceName));
  const preview = h('div', 'asset-import-inspector-preview');
  renderFilePreview(preview, selected);
  host.appendChild(preview);
  const issues = operationIssues(operation, selected.itemId);
  const issue = h('p', `asset-import-item-message${issues.length > 0 || selected.kind === null ? ' warning' : ''}`);
  issue.textContent = issueCopy(issues, selected.kind);
  host.appendChild(issue);
  const destination = h('p', 'asset-import-destination');
  destination.append(h('strong', undefined, '目标位置'), h('span', undefined, destinationPreview(selected)));
  host.appendChild(destination);

  const technical = document.createElement('details');
  technical.className = 'asset-import-technical';
  technical.appendChild(h('summary', undefined, '技术信息'));
  const technicalList = h('dl', 'asset-import-technical-list');
  technicalList.append(
    h('dt', undefined, '原文件'),
    h('dd', undefined, selected.sourceName),
    h('dt', undefined, '文件大小'),
    h('dd', undefined, formatBytes(selected.bytes)),
    h('dt', undefined, '文件格式'),
    h('dd', undefined, selected.file.type || '未声明'),
    h('dt', undefined, '素材 ID'),
    h('dd', undefined, selected.itemId),
  );
  technical.appendChild(technicalList);
  host.appendChild(technical);
}

function renderFileList(
  host: HTMLElement,
  items: readonly AssetImportDraftItem[],
  workspace: AssetImportWorkspace | undefined,
  hooks: AssetImportWorkbenchHooks,
  selectedItemId: string | null,
  filesLocked: boolean,
  onSelect: (itemId: string) => void,
): void {
  host.replaceChildren();
  host.className = 'asset-import-file-list';
  host.setAttribute('role', 'list');
  host.setAttribute('aria-label', '待导入文件');
  if (items.length === 0) {
    host.appendChild(h('p', 'asset-import-empty', '还没有选择文件。请选择要导入的素材。'));
    return;
  }
  for (const item of items) {
    const row = h('article', 'asset-import-file-row');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-item-id', item.itemId);
    row.dataset.selected = String(selectedItemId === item.itemId);
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'asset-import-file-select';
    select.setAttribute('aria-pressed', String(selectedItemId === item.itemId));
    select.setAttribute('aria-label', `查看 ${item.sourceName}`);
    select.append(
      h('strong', undefined, item.sourceName),
      h('span', undefined, formatBytes(item.bytes)),
      h('span', 'asset-import-file-state', item.kind === null ? '待分类' : CATEGORY_LABELS[item.kind]),
    );
    select.onclick = () => onSelect(item.itemId);
    const preview = h('span', 'asset-import-file-preview');
    if (item.previewUrl !== null && item.file.type.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = item.previewUrl;
      image.alt = '';
      preview.appendChild(image);
    } else preview.appendChild(h('span', undefined, assetFileTypeLabel(item.file)));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'asset-import-remove';
    remove.textContent = '移除';
    remove.disabled = filesLocked;
    if (filesLocked) remove.title = '导入检查开始后不能增删文件；可以继续修改分类和名称。';
    remove.onclick = () => {
      if (hooks.onRemoveFile !== undefined) hooks.onRemoveFile(item.itemId);
      else workspace?.removeFile(item.itemId);
    };
    const progressWrap = h('div', 'asset-import-progress');
    const progress = document.createElement('progress');
    progress.max = 1;
    progress.value = item.upload.ratio;
    progress.setAttribute('aria-label', `${item.sourceName} 上传进度`);
    progressWrap.append(
      progress,
      h('span', undefined, item.upload.loaded === 0
        ? '等待上传'
        : `已上传 ${Math.round(item.upload.ratio * 100)}%`),
    );
    row.append(preview, select, remove, progressWrap);
    host.appendChild(row);
  }
}

function renderSettings(
  host: HTMLElement,
  items: readonly AssetImportDraftItem[],
  operation: AssetImportOperationDetail | null,
  workspace: AssetImportWorkspace | undefined,
  hooks: AssetImportWorkbenchHooks,
  fieldsLocked: boolean,
): void {
  host.replaceChildren();
  host.className = 'asset-import-settings';
  host.setAttribute('aria-label', '文件分类与目标设置');
  host.append(
    h('p', 'asset-import-eyebrow', '文件设置'),
    h('h3', undefined, '归类与最终名称'),
    h('p', 'asset-import-muted', '每个文件都需要一个明确分类和安全的最终名称。'),
  );
  if (items.length === 0) {
    host.appendChild(h('p', 'asset-import-empty', '选择文件后，可以在这里调整分类和名称。'));
    return;
  }
  for (const item of items) {
    const group = h('section', 'asset-import-setting-row');
    group.setAttribute('data-item-id', item.itemId);
    const nameId = `asset-import-name-${item.itemId}`;
    const kindId = `asset-import-kind-${item.itemId}`;
    const errorId = `asset-import-error-${item.itemId}`;
    const issues = operationIssues(operation, item.itemId);
    const invalid = item.kind === null || issues.length > 0;

    const categoryLabel = document.createElement('label');
    categoryLabel.htmlFor = kindId;
    categoryLabel.textContent = '素材分类';
    const category = document.createElement('select');
    category.id = kindId;
    category.className = 'asset-import-category';
    category.disabled = fieldsLocked;
    category.name = `category-${item.itemId}`;
    category.setAttribute('aria-describedby', errorId);
    category.setAttribute('aria-invalid', String(item.kind === null));
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择分类';
    category.appendChild(placeholder);
    for (const kind of CATEGORY_ORDER) {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = CATEGORY_LABELS[kind];
      option.selected = item.kind === kind;
      category.appendChild(option);
    }
    category.onchange = () => {
      const kind = category.value === '' ? null : category.value as ProjectAssetKind;
      callUpdateFile(workspace, hooks.onUpdateFile, item.itemId, { kind });
    };

    const nameLabel = document.createElement('label');
    nameLabel.htmlFor = nameId;
    nameLabel.textContent = '最终名称';
    const name = document.createElement('input');
    name.type = 'text';
    name.id = nameId;
    name.className = 'asset-import-file-name';
    name.disabled = fieldsLocked;
    name.value = item.fileName;
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.setAttribute('aria-describedby', errorId);
    name.setAttribute('aria-invalid', String(issues.some((issue) => FILE_NAME_ISSUES.has(issue))));
    name.onchange = () => callUpdateFile(workspace, hooks.onUpdateFile, item.itemId, { fileName: name.value });

    const target = h('p', 'asset-import-target-preview');
    target.append(h('span', undefined, '目标位置'), h('strong', undefined, destinationPreview(item)));
    target.dataset.targetPreview = destinationPreview(item);

    const message = h('p', `asset-import-row-message${invalid ? ' warning' : ' ready'}`);
    message.id = errorId;
    message.textContent = issueCopy(issues, item.kind);
    message.setAttribute('aria-live', 'polite');
    group.append(categoryLabel, category, nameLabel, name, target, message);
    host.appendChild(group);
  }
}

function renderResult(
  host: HTMLElement,
  projection: AssetImportWorkspaceProjection,
  hooks: AssetImportWorkbenchHooks,
): void {
  host.replaceChildren();
  const operation = projection.activeOperation;
  if (operation !== null && ['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(operation.operation.status)) {
    const recovery = h('section', 'asset-import-recovery');
    recovery.setAttribute('aria-label', '导入恢复');
    recovery.append(
      h('h3', undefined, '需要完成恢复'),
      h('p', undefined, '上一次写入没有完整结束。请先恢复到可确认状态，再继续其他操作。'),
    );
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'asset-import-secondary';
    button.textContent = operation.operation.status === 'UNDOING'
      ? '继续完成撤销'
      : operation.operation.status === 'ROLLING_BACK' ? '继续安全回退' : '继续导入';
    button.onclick = () => hooks.onRecoverOperation?.(operation.operation.operationId, 'resume');
    recovery.appendChild(button);
    if (operation.receipt === null
      && operation.operation.status !== 'UNDOING'
      && operation.operation.status !== 'ROLLING_BACK') {
      const rollback = document.createElement('button');
      rollback.type = 'button';
      rollback.className = 'asset-import-secondary';
      rollback.textContent = '安全回退';
      rollback.onclick = () => hooks.onRecoverOperation?.(operation.operation.operationId, 'rollback');
      recovery.appendChild(rollback);
    }
    host.appendChild(recovery);
    return;
  }
  if (operation?.receipt !== null && operation?.receipt !== undefined) {
    const undone = operation.operation.status === 'UNDONE' || operation.undoReceipt !== null;
    const result = h('section', 'asset-import-result');
    result.setAttribute('aria-label', '导入回执');
    const bytes = operation.receipt.files.reduce((sum, file) => sum + file.bytes, 0);
    result.append(
      h('h3', undefined, undone ? '导入已撤销' : '导入完成'),
      h('p', undefined, undone
        ? `已从素材库移出 ${operation.receipt.files.length} 个文件，恢复副本仍由 Surdet 保留。`
        : `已导入 ${operation.receipt.files.length} 个文件，共 ${formatBytes(bytes)}。`),
    );
    if (!undone) {
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'asset-import-secondary';
      view.textContent = '查看已导入素材';
      view.onclick = () => hooks.onViewImportedAssets?.();
      result.appendChild(view);
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'asset-import-secondary';
      undo.textContent = '撤销本次导入';
      undo.onclick = () => hooks.onUndoImport?.(operation.receipt!.receiptId, operation.receipt!.receiptSha256);
      result.appendChild(undo);
      result.appendChild(h('p', 'asset-import-undo-note', '撤销会把这些文件移出素材库，并由 Surdet 保留恢复副本；不会改动后来修改过的文件。'));
    } else {
      result.appendChild(h('p', 'asset-import-undo-note', '已撤销，恢复副本仍由 Surdet 保留。'));
    }
    host.appendChild(result);
    return;
  }
  if (projection.activeOperation === null
    && projection.draftItems.length === 0
    && projection.recentReceipts.length > 0) {
    const recent = h('section', 'asset-import-result asset-import-recent');
    recent.setAttribute('aria-label', '最近导入回执');
    recent.append(
      h('h3', undefined, '最近导入'),
      h('p', undefined, '可以重新读取已经写入项目的回执，并在文件未变化时安全撤销。'),
    );
    const list = h('div', 'asset-import-receipt-list');
    list.setAttribute('role', 'list');
    for (const receipt of projection.recentReceipts) {
      const row = h('div', 'asset-import-receipt-row');
      row.setAttribute('role', 'listitem');
      row.dataset.operationId = receipt.operationId;
      row.append(
        h('span', undefined, `${receipt.fileCount} 个文件 · ${receipt.status === 'UNDONE' ? '已撤销' : '已导入'}`),
      );
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'asset-import-secondary';
      open.textContent = '查看导入回执';
      open.onclick = () => hooks.onOpenReceipt?.(receipt.operationId);
      row.appendChild(open);
      list.appendChild(row);
    }
    recent.appendChild(list);
    host.appendChild(recent);
  }
}

function renderActions(
  host: HTMLElement,
  projection: AssetImportWorkspaceProjection,
  readyCount: number,
  blockedCount: number,
  hooks: AssetImportWorkbenchHooks,
): void {
  host.replaceChildren();
  host.className = 'asset-import-actions';
  host.setAttribute('aria-label', '导入操作');
  const summary = h('p', 'asset-import-action-summary');
  summary.append(h('strong', undefined, `已就绪 ${readyCount}`), h('span', undefined, `需处理 ${blockedCount}`));
  const controls = h('div', 'asset-import-action-controls');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'asset-import-secondary';
  cancel.textContent = operationIsTerminal(projection.activeOperation)
    || projection.activeOperation?.receipt !== null && projection.activeOperation?.receipt !== undefined
    ? '关闭'
    : '取消导入';
  cancel.onclick = () => callWorkspaceOrHook(hooks.workspace, hooks.onCancelImport);
  controls.appendChild(cancel);

  const busy = hooks.busy === true || operationIsBusy(projection.activeOperation);
  const operation = projection.activeOperation;
  const plan = operation?.plan ?? null;
  const hasCompleteTargets = projection.draftItems.length > 0
    && projection.draftItems.every((item) => item.kind !== null && item.fileName.trim().length > 0);
  const canCommit = (operation?.operation.status === 'STAGED' || operation?.operation.status === 'READY')
    && plan?.status === 'ready';
  const canPlan = operation === null || operation.operation.status === 'STAGED';
  const stage = canCommit ? '确认导入' : plan?.status === 'blocked' ? '重新检查' : operationStage(operation);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'asset-import-primary';
  action.dataset.action = 'prepare-import';
  action.textContent = stage;
  action.disabled = busy || (!canCommit && (!canPlan || !hasCompleteTargets
    || !['ready', 'recoverable'].includes(projection.entryState)));
  action.onclick = () => {
    if (canCommit) hooks.onCommitImport?.();
    else hooks.onPrepareImport?.();
  };
  action.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === 'Space' || event.key === ' ') action.click();
  };
  controls.appendChild(action);
  host.append(summary, controls);
  const live = h('div', 'asset-import-live', stage === '准备导入' ? `${readyCount} 个文件已就绪。` : stage);
  live.setAttribute('aria-live', 'polite');
  host.appendChild(live);
}

function renderUnavailableAction(
  host: HTMLElement,
  projection: AssetImportWorkspaceProjection,
  hooks: AssetImportWorkbenchHooks,
): void {
  if (projection.entryState === 'ready') return;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'asset-import-secondary';
  if (projection.entryState === 'recoverable') {
    if (projection.activeOperation !== null
      && !['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(projection.activeOperation.operation.status)) return;
    action.textContent = '处理未完成的导入';
    const operation = projection.pendingOperations[0];
    action.onclick = () => operation && hooks.onRecoverOperation?.(operation.operationId, 'resume');
  } else if (projection.entryState === 'manual-recovery') {
    action.textContent = '继续恢复';
    const operation = projection.activeOperation?.operation.operationId ?? projection.pendingOperations[0]?.operationId;
    action.onclick = () => operation && hooks.onRecoverOperation?.(operation, 'resume');
  } else if (projection.entryState === 'unbound') {
    action.textContent = '确认当前项目';
    action.onclick = () => hooks.onBindProject?.();
  } else {
    action.textContent = '重新检查项目授权';
    action.onclick = () => hooks.onBindProject?.();
  }
  host.appendChild(action);
}

/**
 * Render the Asset Center's in-place import workbench.
 *
 * This module only projects state and emits narrow UI actions. The authority
 * client remains responsible for binding, planning, publication, receipts,
 * recovery, and refreshing the shared asset intelligence after a commit.
 */
export function renderAssetImportWorkbench(
  container: HTMLElement,
  projection: AssetImportWorkspaceProjection | null | undefined,
  hooks: AssetImportWorkbenchHooks = {},
): void {
  const value = projection ?? EMPTY_PROJECTION;
  const workspace = hooks.workspace;
  const existingSelected = container.dataset.selectedItemId ?? null;
  const selectedItemId = value.draftItems.some((item) => item.itemId === existingSelected)
    ? existingSelected
    : value.draftItems[0]?.itemId ?? null;
  container.replaceChildren();
  container.className = 'asset-import-workbench';
  container.dataset.entryState = value.entryState;
  container.dataset.assetImportState = value.entryState;
  container.setAttribute('aria-label', '素材导入工作台');
  if (selectedItemId !== null) container.dataset.selectedItemId = selectedItemId;
  else delete container.dataset.selectedItemId;

  const header = h('header', 'asset-import-header');
  const heading = h('div', 'asset-import-heading');
  heading.append(
    h('p', 'asset-import-eyebrow', '素材中心 / 导入素材'),
    h('h2', undefined, '导入素材'),
    h('p', 'asset-import-lede', entryStateCopy(value.entryState)),
  );
  const status = h('div', 'asset-import-status');
  status.dataset.status = value.entryState;
  status.append(h('strong', undefined, value.projectName ?? '当前项目'), h('span', undefined, value.message ?? entryStateCopy(value.entryState)));
  header.append(heading, status);
  renderUnavailableAction(header, value, hooks);

  const content = h('div', 'asset-import-content');
  const files = h('section', 'asset-import-files');
  files.append(
    h('p', 'asset-import-eyebrow', '第一步 · 选择文件'),
    h('h3', undefined, '待导入文件'),
    h('p', 'asset-import-muted', '最终确认前不会写入项目素材目录。'),
  );
  const pickerLabel = document.createElement('label');
  pickerLabel.className = 'asset-import-picker';
  const pickerTitle = h('span', 'asset-import-picker-title', '选择文件，或拖到这里');
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = '*/*';
  const filesLocked = hooks.busy === true || value.activeOperation !== null;
  const terminalOperationVisible = operationIsTerminal(value.activeOperation);
  const lockedDropMessage = terminalOperationVisible
    ? '请先关闭当前结果，再开始下一次导入'
    : '当前导入已开始，暂时不能加入文件';
  const acceptedMessage = value.activeOperation === null && value.message?.startsWith('已加入 ')
    ? value.message
    : null;
  const idleDropMessage = filesLocked
    ? lockedDropMessage
    : acceptedMessage ?? '支持一次加入多个本机文件';
  const dropStatus = h('small', 'asset-import-drop-status', idleDropMessage);
  dropStatus.setAttribute('aria-live', 'polite');
  pickerLabel.dataset.dropState = filesLocked ? 'blocked' : 'idle';
  let dragDepth = 0;
  const setDropState = (state: 'idle' | 'ready' | 'blocked', message: string): void => {
    if (pickerLabel.dataset.dropState !== state) pickerLabel.dataset.dropState = state;
    if (dropStatus.textContent !== message) dropStatus.textContent = message;
  };
  picker.disabled = filesLocked;
  picker.setAttribute('aria-label', '选择素材文件');
  picker.onchange = () => {
    const selected = picker.files === null ? [] : [...picker.files];
    if (selected.length > 0) hooks.onSelectFiles?.(selected);
    picker.value = '';
  };
  pickerLabel.ondragenter = (event) => {
    event.preventDefault();
    dragDepth += 1;
    const transfer = event.dataTransfer;
    const hasFiles = transfer !== null && assetDropHasFiles(transfer);
    if (filesLocked) {
      if (transfer !== null) transfer.dropEffect = 'none';
      setDropState('blocked', lockedDropMessage);
      return;
    }
    if (!hasFiles) {
      if (transfer !== null) transfer.dropEffect = 'none';
      setDropState('blocked', '这里只接受本机文件');
      return;
    }
    if (transfer !== null) transfer.dropEffect = 'copy';
    setDropState('ready', '松开即可加入待导入列表');
  };
  pickerLabel.ondragover = (event) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    const hasFiles = transfer !== null && assetDropHasFiles(transfer);
    if (!hasFiles || filesLocked) {
      if (transfer !== null) transfer.dropEffect = 'none';
      setDropState('blocked', filesLocked
        ? lockedDropMessage
        : '这里只接受本机文件');
      return;
    }
    transfer.dropEffect = 'copy';
    setDropState('ready', '松开即可加入待导入列表');
  };
  pickerLabel.ondragleave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDropState(filesLocked ? 'blocked' : 'idle', idleDropMessage);
  };
  pickerLabel.ondrop = (event) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    dragDepth = 0;
    if (filesLocked) {
      setDropState('blocked', lockedDropMessage);
      return;
    }
    const dropped = transfer === null ? [] : assetDropFiles(transfer);
    if (dropped.length === 0) {
      setDropState('blocked', '这里只接受本机文件');
      return;
    }
    setDropState('idle', `已加入 ${dropped.length} 个文件，请继续检查分类和名称`);
    hooks.onSelectFiles?.(dropped);
  };
  pickerLabel.append(pickerTitle, dropStatus, picker);
  if (filesLocked) {
    pickerLabel.classList.add('disabled');
    pickerLabel.title = lockedDropMessage;
  }
  files.appendChild(pickerLabel);
  const selectedRef = { value: selectedItemId };
  const fileList = h('div');
  renderFileList(fileList, value.draftItems, workspace, hooks, selectedRef.value, filesLocked, (itemId) => {
    selectedRef.value = itemId;
    container.dataset.selectedItemId = itemId;
    for (const row of container.querySelectorAll<HTMLElement>('[data-item-id]')) {
      row.dataset.selected = String(row.dataset.itemId === itemId);
      row.querySelector<HTMLElement>('.asset-import-file-select')?.setAttribute('aria-pressed', String(row.dataset.itemId === itemId));
    }
    const next = value.draftItems.find((item) => item.itemId === itemId) ?? null;
    const inspector = container.querySelector<HTMLElement>('.asset-import-inspector');
    if (inspector) renderSelectedInspector(inspector, next, value.activeOperation);
  });
  files.appendChild(fileList);

  const settings = h('section');
  const fieldsLocked = hooks.busy === true || (value.activeOperation !== null
    && value.activeOperation.operation.status !== 'STAGED');
  renderSettings(settings, value.draftItems, value.activeOperation, workspace, hooks, fieldsLocked);
  const inspector = h('aside');
  const selected = value.draftItems.find((item) => item.itemId === selectedRef.value) ?? null;
  renderSelectedInspector(inspector, selected, value.activeOperation);
  content.append(files, settings, inspector);

  const readyCount = value.draftItems.filter((item) => item.kind !== null && operationIssues(value.activeOperation, item.itemId).length === 0).length;
  const blockedCount = Math.max(0, value.draftItems.length - readyCount);
  const result = h('div');
  renderResult(result, value, hooks);
  const actions = h('footer');
  renderActions(actions, value, readyCount, blockedCount, hooks);
  actions.appendChild(result);
  container.append(header, content, actions);
}
