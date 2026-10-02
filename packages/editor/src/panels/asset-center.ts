import { enhanceAssetCenter } from '../v4/surfaces.js';
import type { ProjectAssetItem, ProjectAssetKind, ProjectAssetReference } from '@surdet/authoring';
import { state, h } from '../state.js';
import { portraitDisplayName } from '../assets.js';
import {
  renderAssetImportWorkbench,
  type AssetImportWorkbenchHooks,
} from './asset-import-workbench.js';
import {
  assetFolderBreadcrumbs,
  assetMatchesFolder,
  buildAssetFolderOptions,
} from './asset-center-folders.js';
import {
  beginAssetThumbnailSession,
  disposeAssetCenterThumbnails,
} from './asset-center-thumbnails.js';
import { PROJECT_ASSET_RELOCATION_KINDS } from '@surdet/authoring';
import type { AssetRelocationWorkspaceProjection } from '../asset-relocation-workspace.js';
import type { AssetRelocationOperationStatus } from '../asset-import-client.js';

const KIND_LABELS: Record<ProjectAssetKind, string> = {
  background: '背景',
  portrait: '立绘',
  avatar: '头像',
  music: '音乐',
  ambience: '环境音',
  'sound-effect': '音效',
  voice: '语音',
  video: '视频',
  font: '字体',
  license: '许可证/说明',
  other: '其他',
};

const KIND_FILTERS: readonly { value: 'all' | ProjectAssetKind; label: string }[] = [
  { value: 'all', label: '全部素材' },
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value: value as ProjectAssetKind, label })),
];

const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'referenced', label: '已引用' },
  { value: 'unused', label: '未引用' },
  { value: 'missing', label: '引用缺失' },
  { value: 'duplicate', label: '同名冲突' },
  { value: 'invalid-name', label: '命名异常' },
  { value: 'unsupported', label: '格式待确认' },
] as const;

const SORT_OPTIONS = [
  { value: 'path', label: '项目路径' },
  { value: 'name', label: '名称' },
  { value: 'size-desc', label: '文件大小' },
  { value: 'references-desc', label: '引用数量' },
  { value: 'attention', label: '需要处理' },
] as const;

type AssetStatus = Exclude<(typeof STATUS_FILTERS)[number]['value'], 'all'>;
type AssetCenterSort = (typeof SORT_OPTIONS)[number]['value'];

export interface AssetCenterHooks {
  onOpenProject: () => void;
  onOpenReference: (reference: ProjectAssetReference) => void;
  onSelectAsset: (item: ProjectAssetItem, restoreKeyboardFocus: boolean) => void;
  assetImportOpen: boolean;
  onToggleImport: () => void;
  assetImport: AssetImportWorkbenchHooks;
  assetRelocation: {
    workspace: AssetRelocationWorkspaceProjection;
    availabilityMessage: string | null;
    onReplace?: (item: ProjectAssetItem, file: File) => void;
    onBegin: (item: ProjectAssetItem, targetDirectory: string) => void;
    onBeginBatch: () => void;
    onSelectBatchItem: (item: ProjectAssetItem, selected: boolean) => void;
    onSetVisibleBatchItems: (assetIds: readonly string[]) => void;
    onOpenBatchEditor: () => void;
    onReturnToBatchSelection: () => void;
    onUpdateTarget: (update: { targetDirectory?: string; fileName?: string }) => void;
    onUpdateBatchTarget: (update: { targetDirectory?: string; assetId?: string; fileName?: string }) => void;
    onCheckImpact: () => void;
    onCommit: () => void;
    onModify: () => void;
    onCancel: () => void;
    onUndo: () => void;
    onRecover: (action: 'resume' | 'rollback') => void;
    onViewTarget: () => void;
  };
}

let previewObjectUrl: string | null = null;
let previewGeneration = 0;

export function disposeAssetCenterPreview(): void {
  previewGeneration += 1;
  if (previewObjectUrl !== null) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', disposeAssetCenterPreview);

export function assetStatusTokens(item: ProjectAssetItem): AssetStatus[] {
  const tokens: AssetStatus[] = [];
  if (!item.physical || item.issues.includes('ASSET_REFERENCE_MISSING')) tokens.push('missing');
  if (item.physical && item.references.length > 0) tokens.push('referenced');
  if (item.issues.includes('ASSET_UNUSED')) tokens.push('unused');
  if (item.issues.includes('ASSET_KEY_DUPLICATE')) tokens.push('duplicate');
  if (item.issues.includes('ASSET_NAME_INVALID')) tokens.push('invalid-name');
  if (item.issues.includes('ASSET_FORMAT_UNSUPPORTED')) tokens.push('unsupported');
  return tokens;
}

function normalizedSearchText(item: ProjectAssetItem): string {
  return [KIND_LABELS[item.kind], friendlyAssetName(item), item.key, item.variant, item.sourcePath, item.format]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLocaleLowerCase('zh-CN');
}

type AssetKindFilter = 'all' | ProjectAssetKind;
type AssetStatusFilter = 'all' | AssetStatus;

function matchesAssetFilters(
  item: ProjectAssetItem,
  filters: { query: string; kind: AssetKindFilter; status: AssetStatusFilter; folder: 'all' | string },
): boolean {
  if (!assetMatchesFolder(item, filters.folder)) return false;
  if (filters.kind !== 'all' && item.kind !== filters.kind) return false;
  if (filters.status !== 'all' && !assetStatusTokens(item).includes(filters.status)) return false;
  return filters.query.length === 0 || normalizedSearchText(item).includes(filters.query);
}

export function assetFacetCount(
  items: readonly ProjectAssetItem[],
  filters: { kind: AssetKindFilter; status: AssetStatusFilter },
): number {
  const query = state.assetCenterQuery.trim().toLocaleLowerCase('zh-CN');
  return items.filter((item) => matchesAssetFilters(item, {
    query,
    folder: state.assetCenterFolder,
    ...filters,
  })).length;
}

export function filterAssetItems(items: readonly ProjectAssetItem[]): ProjectAssetItem[] {
  const query = state.assetCenterQuery.trim().toLocaleLowerCase('zh-CN');
  return sortAssetItems(items.filter((item) => matchesAssetFilters(item, {
    query,
    kind: state.assetCenterKind,
    status: state.assetCenterStatus,
    folder: state.assetCenterFolder,
  })), state.assetCenterSort);
}

function stableAssetOrder(left: ProjectAssetItem, right: ProjectAssetItem): number {
  return (left.sourcePath ?? left.assetId).localeCompare(right.sourcePath ?? right.assetId, 'zh-CN');
}

function attentionRank(item: ProjectAssetItem): number {
  if (!item.physical || item.issues.includes('ASSET_REFERENCE_MISSING')) return 5;
  if (item.issues.includes('ASSET_NAME_INVALID')) return 4;
  if (item.issues.includes('ASSET_KEY_DUPLICATE')) return 3;
  if (item.issues.includes('ASSET_FORMAT_UNSUPPORTED')) return 2;
  if (item.issues.includes('ASSET_UNUSED')) return 1;
  return 0;
}

export function sortAssetItems(
  items: readonly ProjectAssetItem[],
  sort: AssetCenterSort,
): ProjectAssetItem[] {
  return [...items].sort((left, right) => {
    if (sort === 'name') {
      return friendlyAssetName(left).localeCompare(friendlyAssetName(right), 'zh-CN') || stableAssetOrder(left, right);
    }
    if (sort === 'size-desc') {
      return (right.bytes ?? -1) - (left.bytes ?? -1) || stableAssetOrder(left, right);
    }
    if (sort === 'references-desc') {
      return right.references.length - left.references.length || stableAssetOrder(left, right);
    }
    if (sort === 'attention') {
      return attentionRank(right) - attentionRank(left) || stableAssetOrder(left, right);
    }
    return stableAssetOrder(left, right);
  });
}

export function largestAssetItems(items: readonly ProjectAssetItem[], limit = 5): ProjectAssetItem[] {
  return [...items]
    .filter((item) => item.physical && item.bytes !== undefined)
    .sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0) || stableAssetOrder(left, right))
    .slice(0, Math.max(0, limit));
}

export function formatAssetBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '大小未测量';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_:\-]+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function friendlyAssetName(item: ProjectAssetItem): string {
  if (item.kind === 'portrait' || item.kind === 'avatar') {
    const name = portraitDisplayName(item.key, state.gameConfigText);
    if (name !== item.key) return item.variant ? `${name} · ${item.variant}` : name;
  }
  const base = humanizeToken(item.key || item.sourcePath?.split('/').at(-1) || '');
  if (!base) return '未命名素材';
  if (item.kind === 'portrait' && item.variant) return `${base} · ${humanizeToken(item.variant)}`;
  return base;
}

function issueLabel(status: AssetStatus): string {
  return STATUS_FILTERS.find((entry) => entry.value === status)?.label ?? status;
}

function dirAssetFor(item: ProjectAssetItem) {
  return item.sourcePath
    ? state.dirAssets.find((asset) => asset.sourcePath === item.sourcePath && asset.handle !== null)
    : undefined;
}

function renderPreview(host: HTMLElement, item: ProjectAssetItem): void {
  disposeAssetCenterPreview();
  host.replaceChildren();
  host.dataset.previewState = 'loading';
  const generation = previewGeneration;
  const dirAsset = dirAssetFor(item);
  if (!item.physical || !dirAsset?.handle) {
    host.dataset.previewState = 'unavailable';
    host.appendChild(h('div', 'asset-center-preview-empty', item.physical ? '当前环境无法读取本地预览' : '引用的素材文件尚不存在'));
    return;
  }
  void dirAsset.handle.getFile().then((file) => {
    if (generation !== previewGeneration || !host.isConnected) return;
    const url = URL.createObjectURL(file);
    previewObjectUrl = url;
    host.dataset.previewState = 'ready';
    const failPreview = (): void => {
      if (generation !== previewGeneration || !host.isConnected) return;
      URL.revokeObjectURL(url);
      if (previewObjectUrl === url) previewObjectUrl = null;
      host.dataset.previewState = 'error';
      host.replaceChildren(h('div', 'asset-center-preview-empty', '素材文件无法预览，文件信息仍可查看'));
    };
    if ((item.kind === 'background' || item.kind === 'portrait' || item.kind === 'avatar') && dirAsset.isImage) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = `${KIND_LABELS[item.kind]}预览：${friendlyAssetName(item)}`;
      image.onload = () => { if (generation !== previewGeneration) URL.revokeObjectURL(url); };
      image.onerror = failPreview;
      host.replaceChildren(image);
      return;
    }
    if (item.kind === 'music' || item.kind === 'ambience' || item.kind === 'sound-effect' || item.kind === 'voice') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = url;
      audio.setAttribute('aria-label', `${KIND_LABELS[item.kind]}预览：${friendlyAssetName(item)}`);
      audio.onerror = failPreview;
      host.replaceChildren(audio);
      return;
    }
    if (item.kind === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = url;
      video.setAttribute('aria-label', `视频预览：${friendlyAssetName(item)}`);
      video.onerror = failPreview;
      host.replaceChildren(video);
      return;
    }
    URL.revokeObjectURL(url);
    if (previewObjectUrl === url) previewObjectUrl = null;
    host.dataset.previewState = 'unavailable';
    host.replaceChildren(h('div', 'asset-center-preview-empty', `${KIND_LABELS[item.kind]}暂不提供画面预览`));
  }).catch(() => {
    if (generation !== previewGeneration || !host.isConnected) return;
    host.dataset.previewState = 'error';
    host.replaceChildren(h('div', 'asset-center-preview-empty', '本地预览读取失败，素材信息仍可查看'));
  });
}

function metric(label: string, value: string, tone?: string): HTMLElement {
  const block = h('div', `asset-center-metric${tone ? ` ${tone}` : ''}`);
  block.append(h('strong', undefined, value), h('span', undefined, label));
  return block;
}

function insightPanel(title: string, copy: string): { panel: HTMLElement; body: HTMLElement } {
  const panel = h('section', 'asset-center-insight');
  const heading = h('div', 'asset-center-insight-heading');
  heading.append(h('h2', undefined, title), h('p', undefined, copy));
  const body = h('div', 'asset-center-insight-body');
  panel.append(heading, body);
  return { panel, body };
}

function filterButton(
  label: string,
  count: number,
  selected: boolean,
  onSelect: () => void,
): HTMLButtonElement {
  const button = h('button', 'asset-center-filter') as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-pressed', String(selected));
  button.append(h('span', undefined, label), h('span', 'asset-center-filter-count', String(count)));
  button.onclick = onSelect;
  return button;
}

const RELOCATION_KINDS = new Set<ProjectAssetKind>(PROJECT_ASSET_RELOCATION_KINDS);
const TERMINAL_RELOCATION_STATUSES = new Set<AssetRelocationOperationStatus>([
  'COMMITTED', 'UNDONE', 'ROLLED_BACK', 'CANCELLED',
]);
const RECOVERABLE_RELOCATION_STATUSES = new Set<AssetRelocationOperationStatus>([
  'RECOVERY_REQUIRED', 'PUBLISHING', 'ROLLING_BACK', 'UNDOING',
]);

function assetDirectory(sourcePath: string): string {
  return sourcePath.split('/').slice(0, -1).join('/');
}

function relocationDirectories(items: readonly ProjectAssetItem[], item: ProjectAssetItem): string[] {
  return relocationDirectoriesForKind(items, item.kind, item.sourcePath ?? undefined);
}

function relocationDirectoriesForKind(
  items: readonly ProjectAssetItem[],
  kind: ProjectAssetKind,
  fallbackPath?: string,
): string[] {
  const directories = new Set<string>();
  for (const candidate of items) {
    if (candidate.physical && candidate.kind === kind && candidate.sourcePath) {
      directories.add(assetDirectory(candidate.sourcePath));
    }
  }
  if (fallbackPath) directories.add(assetDirectory(fallbackPath));
  return [...directories].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function relocationEntryIssue(item: ProjectAssetItem, hooks: AssetCenterHooks, operation: 'move' | 'replace' = 'move'): string | null {
  if (!item.physical || !item.sourcePath) return '只有项目中真实存在的素材文件可以整理。';
  if (!RELOCATION_KINDS.has(item.kind)) return '这种资源尚未接入安全整理。';
  if (item.issues.includes('ASSET_NAME_INVALID') || item.issues.includes('ASSET_FORMAT_UNSUPPORTED')) return '请先修正素材的名称或格式，再进行整理。';
  if (operation === 'move' && item.issues.includes('ASSET_KEY_DUPLICATE')) return '这个素材键对应多个文件，暂时无法安全移动或改名；仍可按完整路径替换文件内容。';
  return hooks.assetRelocation.availabilityMessage;
}

function relocationCurrentPath(status: AssetRelocationOperationStatus, sourcePath: string, targetPath: string): string {
  return status === 'COMMITTED' ? targetPath : sourcePath;
}

function renderRelocationStatus(
  projection: AssetRelocationWorkspaceProjection,
  hooks: AssetCenterHooks,
): HTMLElement | null {
  const detail = projection.detail;
  if (detail === null) return null;
  const status = detail.operation.status;
  const batch = projection.mode === 'batch' || detail.request.moves.length > 1;
  const moveCount = detail.request.moves.length;
  if (TERMINAL_RELOCATION_STATUSES.has(status)) {
    const labels: Record<Extract<AssetRelocationOperationStatus, 'COMMITTED' | 'UNDONE' | 'ROLLED_BACK' | 'CANCELLED'>, string> = {
      COMMITTED: '素材整理完成',
      UNDONE: '本次整理已撤销',
      ROLLED_BACK: '素材整理已安全回退',
      CANCELLED: '本次整理已取消',
    };
    const completed = h('div', 'asset-relocation-result');
    completed.dataset.relocationStatus = status;
    completed.dataset.relocationCount = String(moveCount);
    completed.appendChild(h('strong', undefined, batch
      ? `${labels[status as keyof typeof labels]}（${moveCount} 项）`
      : labels[status as keyof typeof labels]));
    completed.appendChild(h('p', undefined, batch
      ? status === 'COMMITTED'
        ? '所选素材已移动到新的位置。'
        : '所选素材已经恢复到整理前的位置。'
      : `当前位置：${relocationCurrentPath(status, detail.request.sourcePath, detail.request.targetPath)}`));
    if (status === 'COMMITTED') {
      completed.appendChild(h('p', undefined, `已更新 ${detail.plan.affectedReferenceCount} 处引用，涉及 ${detail.plan.affectedFileCount} 个项目文件。`));
    }
    const actions = h('div', 'asset-relocation-actions');
    const view = h('button', undefined, batch ? '查看整理结果' : '查看当前位置') as HTMLButtonElement;
    view.type = 'button';
    view.onclick = hooks.assetRelocation.onViewTarget;
    actions.appendChild(view);
    if (status === 'COMMITTED') {
      const undo = h('button', undefined, batch ? '撤销整批整理' : '撤销本次整理') as HTMLButtonElement;
      undo.type = 'button';
      undo.disabled = projection.busy;
      undo.onclick = hooks.assetRelocation.onUndo;
      actions.appendChild(undo);
    }
    const close = h('button', undefined, '关闭提示') as HTMLButtonElement;
    close.type = 'button';
    close.disabled = projection.busy;
    close.onclick = hooks.assetRelocation.onCancel;
    actions.appendChild(close);
    completed.appendChild(actions);
    if (projection.message) completed.appendChild(h('p', 'asset-relocation-message', projection.message));
    return completed;
  }

  if (RECOVERABLE_RELOCATION_STATUSES.has(status)) {
    const recovery = h('div', 'asset-relocation-recovery');
    recovery.appendChild(h('p', 'asset-relocation-warning', '上一次整理没有完整结束。请先恢复或安全回退，期间不会覆盖无法确认的文件。'));
    const actions = h('div', 'asset-relocation-actions');
    const resume = h('button', 'asset-relocation-primary', '继续恢复') as HTMLButtonElement;
    resume.type = 'button';
    resume.disabled = projection.busy;
    resume.onclick = () => hooks.assetRelocation.onRecover('resume');
    const rollback = h('button', undefined, '安全回退') as HTMLButtonElement;
    rollback.type = 'button';
    rollback.disabled = projection.busy;
    rollback.onclick = () => hooks.assetRelocation.onRecover('rollback');
    actions.append(resume, rollback);
    recovery.appendChild(actions);
    if (projection.message) recovery.appendChild(h('p', 'asset-relocation-message', projection.message));
    return recovery;
  }
  return null;
}

function renderDetachedRelocation(hooks: AssetCenterHooks): HTMLElement | null {
  const projection = hooks.assetRelocation.workspace;
  const detail = projection.detail;
  if (detail === null) return null;
  const section = h('section', 'asset-relocation asset-relocation-detached');
  section.dataset.assetRelocation = 'true';
  const heading = h('div', 'asset-relocation-heading');
  heading.append(h('h3', undefined, '整理素材'), h('p', undefined, '这项整理仍可在素材未显示时继续恢复或安全结束。'));
  section.appendChild(heading);
  const status = renderRelocationStatus(projection, hooks);
  if (status !== null) {
    section.appendChild(status);
    return section;
  }
  section.appendChild(h('p', 'asset-relocation-path-summary', `${detail.request.sourcePath} → ${detail.request.targetPath}`));
  section.appendChild(h('p', 'asset-relocation-note', '源素材当前不在列表中。为避免误操作，请取消这项计划后重新检查项目。'));
  const actions = h('div', 'asset-relocation-actions');
  const cancel = h('button', undefined, '取消本次整理') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.disabled = projection.busy;
  cancel.onclick = hooks.assetRelocation.onCancel;
  actions.appendChild(cancel);
  section.appendChild(actions);
  if (projection.message) section.appendChild(h('p', 'asset-relocation-message', projection.message));
  return section;
}

function renderRelocation(
  item: ProjectAssetItem,
  items: readonly ProjectAssetItem[],
  hooks: AssetCenterHooks,
): HTMLElement {
  const section = h('section', 'asset-relocation');
  section.dataset.assetRelocation = 'true';
  const heading = h('div', 'asset-relocation-heading');
  heading.append(h('h3', undefined, '整理素材'), h('p', undefined, '移动或重命名前会先列出需要同步更新的引用。'));
  section.appendChild(heading);
  const issue = relocationEntryIssue(item, hooks);
  const projection = hooks.assetRelocation.workspace;
  const active = projection.source?.assetId === item.assetId
    || projection.detail?.request.targetPath === item.sourcePath;
  if (!active) {
    const button = h('button', 'asset-relocation-entry', '移动或重命名') as HTMLButtonElement;
    button.type = 'button';
    button.disabled = issue !== null || projection.busy;
    if (issue) button.title = issue;
    button.onclick = () => hooks.assetRelocation.onBegin(item, assetDirectory(item.sourcePath!));
    section.appendChild(button);
    if (hooks.assetRelocation.onReplace && item.kind !== 'other' && item.format !== 'svg') {
      const pick = document.createElement('input'); pick.type = 'file'; pick.hidden = true; pick.multiple = false;
      if (item.format) pick.accept = `.${item.format}`;
      const replace = h('button', 'asset-relocation-entry', '替换文件内容') as HTMLButtonElement;
      const replacementIssue = relocationEntryIssue(item, hooks, 'replace');
      replace.type = 'button'; replace.disabled = replacementIssue !== null || projection.busy;
      if (replacementIssue) replace.title = replacementIssue;
      replace.onclick = () => { if (replace.isConnected && !replace.disabled) pick.click(); };
      pick.onchange = () => { const file = pick.files?.[0]; if (file && replace.isConnected && !replace.disabled) hooks.assetRelocation.onReplace!(item, file); };
      section.append(replace, pick);
    }
    if (issue) section.appendChild(h('p', 'asset-relocation-note', issue));
    return section;
  }

  const detail = projection.detail;
  const status = renderRelocationStatus(projection, hooks);
  if (status !== null) {
    section.appendChild(status);
    return section;
  }

  if (detail?.plan.replacement) {
    const facts = detail.plan.replacement;
    section.append(h('p', '', `原位替换：${detail.request.targetPath}`), h('p', 'hint', '保持路径、素材键和原许可证不变；不会用移动或普通导入冒充替换。'),
      h('p', 'mono', `原文件指纹： ${facts.beforeSha256}`), h('p', 'mono', `新文件指纹： ${facts.afterSha256}`),
      h('p', '', facts.noChange ? '内容相同，无需改变原文件。' : `${formatAssetBytes(facts.bytes)}；${facts.references.length} 处已知使用位置将读取新内容。`));
    const confirm = h('button', 'asset-relocation-primary', facts.noChange ? '确认无变化' : '确认替换文件内容') as HTMLButtonElement;
    confirm.type = 'button'; confirm.disabled = projection.busy; confirm.onclick = hooks.assetRelocation.onCommit;
    const cancel = h('button', '', '取消替换') as HTMLButtonElement; cancel.type = 'button'; cancel.disabled = projection.busy; cancel.onclick = hooks.assetRelocation.onCancel;
    section.append(confirm, cancel);
    if (projection.message) section.append(h('p', 'asset-relocation-message', projection.message));
    return section;
  }
  const lockedByPlan = detail !== null;
  const form = h('div', 'asset-relocation-form');
  const location = h('p', 'asset-relocation-current', `当前位置：${projection.source!.sourcePath}`);
  const targetLabel = h('label');
  targetLabel.appendChild(h('span', undefined, '放到'));
  const target = document.createElement('select');
  target.setAttribute('aria-label', '目标素材目录');
  target.disabled = lockedByPlan || projection.busy;
  for (const directory of relocationDirectories(items, item)) {
    const option = document.createElement('option');
    option.value = directory;
    option.textContent = directory;
    target.appendChild(option);
  }
  target.value = projection.targetDirectory;
  target.onchange = () => {
    hooks.assetRelocation.onUpdateTarget({ targetDirectory: target.value });
    updateSummary();
  };
  targetLabel.appendChild(target);
  const fileLabel = h('label');
  fileLabel.appendChild(h('span', undefined, '文件名'));
  const sourceFileName = projection.source!.fileName;
  const extensionOffset = sourceFileName.lastIndexOf('.');
  const fixedExtension = extensionOffset > 0 ? sourceFileName.slice(extensionOffset) : '';
  const editableFileName = fixedExtension.length > 0 && projection.fileName.endsWith(fixedExtension)
    ? projection.fileName.slice(0, -fixedExtension.length)
    : projection.fileName;
  const fileControl = h('span', 'asset-relocation-file-control');
  const fileName = document.createElement('input');
  fileName.value = editableFileName;
  fileName.disabled = lockedByPlan || projection.busy;
  fileName.setAttribute('aria-label', '整理后的文件名');
  fileName.spellcheck = false;
  fileControl.appendChild(fileName);
  if (fixedExtension) fileControl.appendChild(h('span', 'asset-relocation-extension', fixedExtension));
  fileLabel.appendChild(fileControl);
  const summary = h('p', 'asset-relocation-path-summary');
  const updateSummary = (): void => {
    const next = `${target.value}/${fileName.value.trim()}${fixedExtension}`;
    summary.textContent = `${projection.source!.sourcePath} → ${next}`;
  };
  fileName.oninput = () => {
    hooks.assetRelocation.onUpdateTarget({ fileName: `${fileName.value}${fixedExtension}` });
    updateSummary();
  };
  updateSummary();
  form.append(location, targetLabel, fileLabel, summary);
  section.appendChild(form);

  if (detail !== null) {
    if (detail.plan.status === 'blocked') {
      const blockers = h('div', 'asset-relocation-blockers');
      blockers.appendChild(h('strong', undefined, '当前目标不能安全执行'));
      const list = h('ul');
      for (const blocker of detail.plan.blockers) list.appendChild(h('li', undefined, blocker.message));
      blockers.appendChild(list);
      section.appendChild(blockers);
    } else {
      const impact = h('div', 'asset-relocation-impact');
      impact.appendChild(h('strong', undefined, `将更新 ${detail.plan.affectedReferenceCount} 处引用，涉及 ${detail.plan.affectedFileCount} 个项目文件`));
      const sourceLabels: Record<string, string> = {
        scene: '场景', timeline: '时间轴', character: '角色配置', gallery: '鉴赏配置', config: '展示配置',
      };
      for (const sourceKind of ['scene', 'timeline', 'character', 'gallery', 'config'] as const) {
        const changes = detail.plan.referenceChanges.filter((change) => change.sourceKind === sourceKind);
        if (changes.length === 0) continue;
        const disclosure = document.createElement('details');
        disclosure.appendChild(h('summary', undefined, `${sourceLabels[sourceKind]}（${changes.length}）`));
        const list = h('ul');
        for (const change of changes) {
          list.appendChild(h('li', undefined, `${change.sourceLabel}：${change.before} → ${change.after}`));
        }
        disclosure.appendChild(list);
        impact.appendChild(disclosure);
      }
      section.appendChild(impact);
    }
  }

  const actions = h('div', 'asset-relocation-actions');
  if (detail === null) {
    const check = h('button', 'asset-relocation-primary', '检查影响') as HTMLButtonElement;
    check.type = 'button';
    check.disabled = projection.busy;
    check.onclick = hooks.assetRelocation.onCheckImpact;
    actions.appendChild(check);
  } else if (detail.plan.status === 'ready') {
    const commit = h('button', 'asset-relocation-primary', `移动并更新 ${detail.plan.affectedReferenceCount} 处引用`) as HTMLButtonElement;
    commit.type = 'button';
    commit.disabled = projection.busy;
    commit.onclick = hooks.assetRelocation.onCommit;
    actions.appendChild(commit);
  }
  if (detail !== null) {
    const modify = h('button', undefined, '修改目标') as HTMLButtonElement;
    modify.type = 'button';
    modify.disabled = projection.busy;
    modify.onclick = hooks.assetRelocation.onModify;
    actions.appendChild(modify);
  }
  const cancel = h('button', undefined, '取消') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.disabled = projection.busy;
  cancel.onclick = hooks.assetRelocation.onCancel;
  actions.appendChild(cancel);
  section.appendChild(actions);
  if (projection.message) section.appendChild(h('p', 'asset-relocation-message', projection.message));
  return section;
}

function renderBatchRelocationWorkbench(
  items: readonly ProjectAssetItem[],
  hooks: AssetCenterHooks,
): HTMLElement {
  const projection = hooks.assetRelocation.workspace;
  const section = h('section', 'asset-relocation-batch');
  section.dataset.assetRelocationBatch = 'true';
  section.setAttribute('aria-live', 'polite');
  section.setAttribute('aria-busy', String(projection.busy));

  const kindLabel = projection.batchKind === null ? '素材' : KIND_LABELS[projection.batchKind];
  const heading = h('div', 'asset-relocation-batch-heading');
  const headingCopy = h('div');
  headingCopy.append(
    h('p', 'asset-center-eyebrow', '批量整理'),
    h('h2', undefined, `整理 ${projection.selection.length} 个${kindLabel}素材`),
    h('p', undefined, '先确认统一位置和每个文件名；检查影响后才会真正写入项目。'),
  );
  heading.appendChild(headingCopy);
  section.appendChild(heading);

  const status = renderRelocationStatus(projection, hooks);
  if (status !== null) {
    section.appendChild(status);
    return section;
  }

  const lockedByPlan = projection.detail !== null;
  const shared = h('div', 'asset-relocation-batch-shared');
  const directoryLabel = h('label');
  directoryLabel.appendChild(h('span', undefined, '统一放到'));
  const directory = document.createElement('select');
  directory.setAttribute('aria-label', '整批目标素材目录');
  directory.disabled = lockedByPlan || projection.busy;
  const directories = relocationDirectoriesForKind(items, projection.batchKind ?? 'other', projection.selection[0]?.sourcePath);
  if (projection.targetDirectory && !directories.includes(projection.targetDirectory)) directories.push(projection.targetDirectory);
  for (const path of directories.sort((left, right) => left.localeCompare(right, 'zh-CN'))) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path;
    directory.appendChild(option);
  }
  directory.value = projection.targetDirectory;
  directory.onchange = () => hooks.assetRelocation.onUpdateBatchTarget({ targetDirectory: directory.value });
  directoryLabel.appendChild(directory);
  shared.appendChild(directoryLabel);
  section.appendChild(shared);

  const perItem = document.createElement('details');
  perItem.className = 'asset-relocation-batch-items';
  perItem.open = projection.detail?.plan.status === 'blocked';
  perItem.appendChild(h('summary', undefined, `逐项调整文件名（${projection.selection.length}）`));
  const rows = h('div', 'asset-relocation-batch-rows');
  const plannedMoves = new Map(projection.plan?.moves.map((move) => [move.source.path, move.moveId] as const) ?? []);
  for (const source of projection.selection) {
    const row = h('div', 'asset-relocation-batch-row');
    row.dataset.assetId = source.assetId;
    const current = h('div', 'asset-relocation-batch-current');
    current.append(h('strong', undefined, source.fileName), h('small', undefined, `当前位置：${source.sourcePath}`));
    const fileLabel = h('label');
    fileLabel.appendChild(h('span', undefined, '整理后的文件名'));
    const extensionOffset = source.fileName.lastIndexOf('.');
    const extension = extensionOffset > 0 ? source.fileName.slice(extensionOffset) : '';
    const nextFileName = projection.fileNames[source.assetId] ?? source.fileName;
    const input = document.createElement('input');
    input.value = extension && nextFileName.endsWith(extension)
      ? nextFileName.slice(0, -extension.length)
      : nextFileName;
    input.disabled = lockedByPlan || projection.busy;
    input.spellcheck = false;
    input.setAttribute('aria-label', `${source.fileName} 整理后的文件名`);
    const control = h('span', 'asset-relocation-file-control');
    control.appendChild(input);
    if (extension) control.appendChild(h('span', 'asset-relocation-extension', extension));
    fileLabel.appendChild(control);
    const target = h('small', 'asset-relocation-batch-target');
    const updateTarget = (): void => {
      target.textContent = `新位置：${directory.value}/${input.value.trim()}${extension}`;
    };
    input.oninput = () => {
      hooks.assetRelocation.onUpdateBatchTarget({
        assetId: source.assetId,
        fileName: `${input.value}${extension}`,
      });
      updateTarget();
    };
    directory.addEventListener('change', updateTarget);
    updateTarget();
    row.append(current, fileLabel, target);
    const moveId = plannedMoves.get(source.sourcePath);
    const itemBlockers = moveId === undefined ? [] : projection.plan?.blockers.filter((blocker) => blocker.moveIds?.includes(moveId)) ?? [];
    if (itemBlockers.length > 0) {
      const issues = h('ul', 'asset-relocation-batch-row-issues');
      for (const blocker of itemBlockers) issues.appendChild(h('li', undefined, blocker.message));
      row.appendChild(issues);
    }
    rows.appendChild(row);
  }
  perItem.appendChild(rows);
  section.appendChild(perItem);

  const detail = projection.detail;
  if (detail !== null) {
    if (detail.plan.status === 'blocked') {
      const blockers = h('div', 'asset-relocation-blockers');
      blockers.appendChild(h('strong', undefined, '这批素材暂时不能安全整理'));
      const list = h('ul');
      for (const blocker of detail.plan.blockers) list.appendChild(h('li', undefined, blocker.message));
      blockers.appendChild(list);
      section.appendChild(blockers);
    } else {
      const impact = h('div', 'asset-relocation-impact');
      impact.appendChild(h('strong', undefined,
        `将整理 ${detail.plan.affectedAssetCount} 个素材，更新 ${detail.plan.affectedReferenceCount} 处引用，涉及 ${detail.plan.affectedFileCount} 个项目文件。`));
      const sourceLabels: Record<string, string> = {
        scene: '场景', timeline: '时间轴', character: '角色配置', gallery: '鉴赏配置', config: '展示配置',
      };
      for (const sourceKind of ['scene', 'timeline', 'character', 'gallery', 'config'] as const) {
        const changes = detail.plan.referenceChanges.filter((change) => change.sourceKind === sourceKind);
        if (changes.length === 0) continue;
        const disclosure = document.createElement('details');
        disclosure.appendChild(h('summary', undefined, `${sourceLabels[sourceKind]}（${changes.length}）`));
        const list = h('ul');
        for (const change of changes) list.appendChild(h('li', undefined, `${change.sourceLabel}：${change.before} → ${change.after}`));
        disclosure.appendChild(list);
        impact.appendChild(disclosure);
      }
      section.appendChild(impact);
    }
  }

  const actions = h('div', 'asset-relocation-actions asset-relocation-batch-actions');
  if (detail === null) {
    const check = h('button', 'asset-relocation-primary', '检查整批影响') as HTMLButtonElement;
    check.type = 'button';
    check.disabled = projection.busy || projection.selection.length === 0;
    check.onclick = hooks.assetRelocation.onCheckImpact;
    actions.appendChild(check);
    const back = h('button', undefined, '返回选择') as HTMLButtonElement;
    back.type = 'button';
    back.disabled = projection.busy;
    back.onclick = hooks.assetRelocation.onReturnToBatchSelection;
    actions.appendChild(back);
  } else if (detail.plan.status === 'ready') {
    const commit = h('button', 'asset-relocation-primary',
      `整理 ${detail.plan.affectedAssetCount} 个素材并更新 ${detail.plan.affectedReferenceCount} 处引用`) as HTMLButtonElement;
    commit.type = 'button';
    commit.disabled = projection.busy;
    commit.onclick = hooks.assetRelocation.onCommit;
    actions.appendChild(commit);
  }
  if (detail !== null) {
    const modify = h('button', undefined, '修改目标') as HTMLButtonElement;
    modify.type = 'button';
    modify.disabled = projection.busy;
    modify.onclick = hooks.assetRelocation.onModify;
    actions.appendChild(modify);
  }
  const exit = h('button', undefined, '退出批量整理') as HTMLButtonElement;
  exit.type = 'button';
  exit.disabled = projection.busy;
  exit.onclick = hooks.assetRelocation.onCancel;
  actions.appendChild(exit);
  section.appendChild(actions);
  if (projection.message) section.appendChild(h('p', 'asset-relocation-message', projection.message));
  return section;
}

function renderInspector(host: HTMLElement, item: ProjectAssetItem | null, items: readonly ProjectAssetItem[], hooks: AssetCenterHooks): void {
  host.replaceChildren();
  host.className = 'asset-center-inspector';
  host.setAttribute('aria-label', '素材详情');
  if (item === null) {
    const detachedRelocation = hooks.assetRelocation.workspace.mode === 'batch'
      ? null
      : renderDetachedRelocation(hooks);
    host.append(
      h('p', 'asset-center-eyebrow', '素材详情'),
      h('h2', undefined, '选择一项素材'),
      h('p', 'asset-center-empty-copy', '这里会固定显示预览、文件信息和引用位置，不需要把鼠标停在条目上。'),
    );
    if (detachedRelocation !== null) host.appendChild(detachedRelocation);
    return;
  }
  host.dataset.assetId = item.assetId;
  const preview = h('div', 'asset-center-preview');
  renderPreview(preview, item);
  const statuses = assetStatusTokens(item);
  const statusRow = h('div', 'asset-center-status-list');
  if (statuses.length === 0) statusRow.appendChild(h('span', 'asset-center-status', '状态正常'));
  else for (const status of statuses) statusRow.appendChild(h('span', `asset-center-status ${status}`, issueLabel(status)));

  const facts = h('dl', 'asset-center-facts');
  const addFact = (term: string, value: string): void => {
    facts.append(h('dt', undefined, term), h('dd', undefined, value));
  };
  addFact('类别', KIND_LABELS[item.kind]);
  addFact('文件大小', formatAssetBytes(item.bytes));
  addFact('文件格式', item.format ? item.format.toUpperCase() : item.kind === 'license' ? '文本（无扩展名）' : '未识别');
  addFact('引用情况', item.kind === 'license' ? '随素材保留，无需剧本引用' : item.references.length > 0 ? `${item.references.length} 处` : '未发现引用');

  const references = h('section', 'asset-center-references');
  references.appendChild(h('h3', undefined, '引用位置'));
  if (item.references.length === 0) {
    references.appendChild(h('p', 'asset-center-empty-copy', item.kind === 'license' ? '这是随素材交付的许可证或说明文件，无需插入剧本。' : '当前项目结构中没有发现引用。'));
  } else {
    const list = h('div', 'asset-center-reference-list');
    for (const reference of item.references) {
      const button = h('button', 'asset-center-reference') as HTMLButtonElement;
      button.type = 'button';
      button.dataset.sourcePath = reference.sourcePath;
      if (reference.line !== undefined) button.dataset.sourceLine = String(reference.line);
      if (reference.objectRef) button.dataset.objectRef = reference.objectRef;
      button.append(
        h('span', 'asset-center-reference-label', reference.sourceLabel),
        h('span', 'asset-center-reference-location', reference.line ? `${reference.sourcePath} · 第 ${reference.line} 行` : reference.sourcePath),
      );
      button.onclick = () => hooks.onOpenReference(reference);
      list.appendChild(button);
    }
    references.appendChild(list);
  }

  const technical = document.createElement('details');
  technical.className = 'asset-center-technical';
  technical.appendChild(h('summary', undefined, '技术信息'));
  const technicalFacts = h('dl', 'asset-center-technical-facts');
  const addTechnical = (term: string, value: string): void => {
    technicalFacts.append(h('dt', undefined, term), h('dd', undefined, value));
  };
  addTechnical('素材键', item.key);
  addTechnical('项目路径', item.sourcePath ?? '无物理文件');
  addTechnical('素材标识', item.assetId);
  addTechnical('问题代码', item.issues.length > 0 ? item.issues.join('、') : '无');
  technical.appendChild(technicalFacts);

  host.append(
    h('p', 'asset-center-eyebrow', '素材详情'),
    h('h2', undefined, friendlyAssetName(item)),
    statusRow,
    preview,
    facts,
    references,
  );
  if (hooks.assetRelocation.workspace.mode !== 'batch') host.appendChild(renderRelocation(item, items, hooks));
  host.appendChild(technical);
}

export function renderAssetCenter(container: HTMLElement, hooks: AssetCenterHooks): void {
  disposeAssetCenterPreview();
  disposeAssetCenterThumbnails();
  container.replaceChildren();
  container.className = 'asset-center';
  container.dataset.assetCenterState = state.assetIntelligenceState;

  if (!state.dirName && state.dirHandle === null) {
    const empty = h('div', 'asset-center-start');
    empty.append(
      h('p', 'asset-center-eyebrow', '素材中心'),
      h('h1', undefined, '先打开一个项目'),
      h('p', undefined, '打开项目后，这里会整理真实素材、引用位置和需要留意的问题。'),
    );
    const open = h('button', 'asset-center-primary', '打开项目') as HTMLButtonElement;
    open.type = 'button';
    open.onclick = hooks.onOpenProject;
    empty.appendChild(open);
    container.appendChild(empty);
    return;
  }
  if (state.assetIntelligenceState === 'loading' || state.assetIntelligenceState === 'idle') {
    container.appendChild(h('div', 'asset-center-start', '正在整理素材…'));
    return;
  }
  if (state.assetIntelligenceState === 'error' || state.assetIntelligence === null) {
    container.appendChild(h('div', 'asset-center-start', '素材事实暂时不可用。项目内容没有被修改，请稍后重试。'));
    return;
  }

  const intelligence = state.assetIntelligence;
  const items = intelligence.items;
  const relocationProjection = hooks.assetRelocation.workspace;
  const folderOptions = buildAssetFolderOptions(items);
  if (state.assetCenterFolder !== 'all' && !folderOptions.some((option) => option.path === state.assetCenterFolder)) {
    state.assetCenterFolder = 'all';
  }
  let filtered = filterAssetItems(items);
  let refreshSearchResults = (): void => {};
  const effectiveAssetView = relocationProjection.mode === 'batch' ? 'list' : state.assetCenterView;
  const thumbnailSession = beginAssetThumbnailSession();
  if (relocationProjection.mode === 'batch') hooks.assetRelocation.onSetVisibleBatchItems(filtered.map((item) => item.assetId));
  if (state.assetCenterSelectedId && !items.some((item) => item.assetId === state.assetCenterSelectedId)) {
    state.assetCenterSelectedId = null;
  }
  const selected = items.find((item) => item.assetId === state.assetCenterSelectedId) ?? null;
  container.dataset.assetQuery = state.assetCenterQuery;
  container.dataset.assetKindFilter = state.assetCenterKind;
  container.dataset.assetStatusFilter = state.assetCenterStatus;
  container.dataset.assetView = effectiveAssetView;
  container.dataset.assetSort = state.assetCenterSort;
  container.dataset.assetFolder = state.assetCenterFolder;
  container.dataset.visibleCount = String(filtered.length);
  container.dataset.totalCount = String(items.length);

  const revealAsset = (item: ProjectAssetItem, restoreKeyboardFocus = true): void => {
    state.assetCenterQuery = '';
    state.assetCenterKind = 'all';
    state.assetCenterStatus = 'all';
    state.assetCenterFolder = 'all';
    hooks.onSelectAsset(item, restoreKeyboardFocus);
  };

  const restoreControlFocus = (selector: string): void => {
    requestAnimationFrame(() => container.querySelector<HTMLElement>(selector)?.focus());
  };
  const restoreAssetRowControl = (assetId: string, selector: string): void => {
    requestAnimationFrame(() => {
      [...container.querySelectorAll<HTMLElement>('[data-asset-id]')]
        .find((candidate) => candidate.dataset.assetId === assetId)
        ?.querySelector<HTMLElement>(selector)
        ?.focus();
    });
  };

  const header = h('header', 'asset-center-header');
  const title = h('div', 'asset-center-title');
  title.append(
    h('p', 'asset-center-eyebrow', '项目素材'),
    h('h1', undefined, '素材中心'),
    h('p', undefined, '查看真实文件与引用位置；整理素材会先显示影响，确认后才执行。'),
  );
  const tools = h('div', 'asset-center-tools');
  const importButton = h('button', 'asset-import-entry', '导入素材') as HTMLButtonElement;
  importButton.type = 'button';
  importButton.setAttribute('aria-controls', 'asset-import-workbench');
  importButton.setAttribute('aria-expanded', String(hooks.assetImportOpen));
  importButton.onclick = hooks.onToggleImport;
  const searchLabel = document.createElement('label');
  searchLabel.className = 'asset-center-search';
  searchLabel.appendChild(h('span', undefined, '搜索素材'));
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '名称、素材键或项目路径';
  search.value = state.assetCenterQuery;
  search.dataset.assetFilter = 'search';
  search.oninput = () => {
    if (!search.isConnected || state.assetIntelligence !== intelligence) return;
    state.assetCenterQuery = search.value;
    refreshSearchResults();
  };
  searchLabel.appendChild(search);
  const viewSwitch = h('div', 'asset-center-view-switch');
  viewSwitch.setAttribute('aria-label', '显示方式');
  for (const [value, label] of [['list', '列表'], ['grid', '网格']] as const) {
    const button = h('button', undefined, label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.assetViewSwitch = value;
    button.setAttribute('aria-pressed', String(state.assetCenterView === value));
    button.onclick = () => {
      state.assetCenterView = value;
      renderAssetCenter(container, hooks);
      restoreControlFocus(`[data-asset-view-switch="${value}"]`);
    };
    viewSwitch.appendChild(button);
  }
  tools.append(importButton, searchLabel, viewSwitch);
  header.append(title, tools);

  const problems = items.filter((item) => (
    !item.physical
    || item.issues.includes('ASSET_KEY_DUPLICATE')
    || item.issues.includes('ASSET_NAME_INVALID')
    || item.issues.includes('ASSET_FORMAT_UNSUPPORTED')
  )).length;
  const overview = h('section', 'asset-center-overview');
  overview.setAttribute('aria-label', '素材概览');
  overview.dataset.fileCount = String(intelligence.summary.fileCount);
  overview.dataset.measuredFileCount = String(intelligence.summary.measuredFileCount);
  overview.dataset.measuredBytes = String(intelligence.summary.measuredBytes);
  overview.dataset.referencedCount = String(intelligence.summary.referencedCount);
  overview.dataset.unusedCount = String(intelligence.summary.unusedCount);
  overview.dataset.attentionCount = String(problems);
  const measuredSize = intelligence.summary.measuredFileCount === 0
    ? '大小未测量'
    : formatAssetBytes(intelligence.summary.measuredBytes);
  const measuredLabel = intelligence.summary.measuredFileCount === 0
    ? '文件大小'
    : intelligence.summary.measuredFileCount === intelligence.summary.fileCount
      ? '已统计大小'
      : `已统计 ${intelligence.summary.measuredFileCount} 个文件`;
  overview.append(
    metric('文件', String(intelligence.summary.fileCount)),
    metric(measuredLabel, measuredSize),
    metric('已引用', String(intelligence.summary.referencedCount)),
    metric('未引用', String(intelligence.summary.unusedCount)),
    metric('需处理素材', String(problems), problems > 0 ? 'attention' : undefined),
  );

  const insights = h('section', 'asset-center-insights');
  insights.setAttribute('aria-label', '素材洞察');

  const distribution = insightPanel('空间占用', '按素材类别查看已测量的项目体积。');
  const measuredKinds = Object.entries(intelligence.summary.byKind)
    .map(([kind, summary]) => ({ kind: kind as ProjectAssetKind, ...summary }))
    .filter((entry) => entry.files > 0)
    .sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0) || right.files - left.files);
  if (measuredKinds.length === 0) {
    distribution.body.appendChild(h('p', 'asset-center-insight-empty', '当前还没有可统计的素材文件。'));
  }
  for (const entry of measuredKinds) {
    const button = h('button', 'asset-center-distribution-row') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.assetInsightKind = entry.kind;
    button.setAttribute('aria-controls', 'asset-center-library-items');
    button.setAttribute('aria-pressed', String(
      state.assetCenterQuery === '' && state.assetCenterKind === entry.kind
        && state.assetCenterStatus === 'all' && state.assetCenterFolder === 'all'
    ));
    const amount = entry.measuredFiles > 0 ? formatAssetBytes(entry.bytes) : '大小未测量';
    const label = h('span', 'asset-center-distribution-label');
    label.append(h('strong', undefined, KIND_LABELS[entry.kind]), h('small', undefined, `${entry.files} 个文件 · ${amount}`));
    button.appendChild(label);
    if (intelligence.summary.measuredBytes > 0 && entry.measuredFiles > 0) {
      const progress = document.createElement('progress');
      progress.max = intelligence.summary.measuredBytes;
      progress.value = entry.bytes ?? 0;
      progress.setAttribute('aria-label', `${KIND_LABELS[entry.kind]}占用 ${amount}`);
      button.appendChild(progress);
    } else {
      button.classList.add('unmeasured');
    }
    button.onclick = () => {
      state.assetCenterQuery = '';
      state.assetCenterKind = entry.kind;
      state.assetCenterStatus = 'all';
      state.assetCenterFolder = 'all';
      renderAssetCenter(container, hooks);
      restoreControlFocus(`[data-asset-insight-kind="${entry.kind}"]`);
    };
    distribution.body.appendChild(button);
  }

  const largest = insightPanel('大文件', '优先找到最占空间的素材。');
  const largestItems = largestAssetItems(items);
  if (largestItems.length === 0) {
    largest.body.appendChild(h('p', 'asset-center-insight-empty', '文件大小尚未测量。'));
  }
  for (const [index, item] of largestItems.entries()) {
    const button = h('button', 'asset-center-largest-row') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.assetInsightId = item.assetId;
    const description = item.sourcePath ? `${KIND_LABELS[item.kind]} · ${item.sourcePath}` : KIND_LABELS[item.kind];
    const details = h('span', 'asset-center-largest-details');
    details.append(
      h('strong', 'asset-center-largest-name', friendlyAssetName(item)),
      h('small', 'asset-center-largest-path', description),
    );
    button.setAttribute('aria-label', `${friendlyAssetName(item)}，${description}，${formatAssetBytes(item.bytes)}`);
    button.append(
      h('span', 'asset-center-largest-rank', String(index + 1).padStart(2, '0')),
      details,
      h('span', 'asset-center-largest-size', formatAssetBytes(item.bytes)),
    );
    button.onclick = () => revealAsset(item);
    largest.body.appendChild(button);
  }

  const attention = insightPanel('项目状态', '问题可直接筛选；未引用单独统计，不计入需处理素材。');
  const attentionStatuses = STATUS_FILTERS.filter((entry): entry is (typeof STATUS_FILTERS)[number] & { value: AssetStatus } => (
    ['missing', 'duplicate', 'invalid-name', 'unsupported', 'unused'].includes(entry.value)
  ));
  for (const entry of attentionStatuses) {
    const count = items.filter((item) => assetStatusTokens(item).includes(entry.value)).length;
    const button = h('button', 'asset-center-attention-row') as HTMLButtonElement;
    button.type = 'button';
    button.disabled = count === 0;
    button.dataset.assetInsightStatus = entry.value;
    button.setAttribute('aria-controls', 'asset-center-library-items');
    button.setAttribute('aria-pressed', String(
      state.assetCenterQuery === '' && state.assetCenterKind === 'all'
        && state.assetCenterStatus === entry.value && state.assetCenterFolder === 'all'
    ));
    button.append(h('span', undefined, entry.label), h('strong', undefined, String(count)));
    button.onclick = () => {
      state.assetCenterQuery = '';
      state.assetCenterKind = 'all';
      state.assetCenterStatus = entry.value;
      state.assetCenterFolder = 'all';
      renderAssetCenter(container, hooks);
      restoreControlFocus(`[data-asset-insight-status="${entry.value}"]`);
    };
    attention.body.appendChild(button);
  }
  insights.append(distribution.panel, largest.panel, attention.panel);

  const shell = h('div', 'asset-center-shell');
  const rail = h('aside', 'asset-center-rail');
  rail.setAttribute('aria-label', '素材筛选');
  rail.appendChild(h('h2', undefined, '分类'));
  for (const entry of KIND_FILTERS) {
    const count = assetFacetCount(items, { kind: entry.value, status: state.assetCenterStatus });
    const button = filterButton(entry.label, count, state.assetCenterKind === entry.value, () => {
      state.assetCenterKind = entry.value;
      renderAssetCenter(container, hooks);
      restoreControlFocus(`[data-asset-filter-axis="kind"][data-asset-filter-value="${entry.value}"]`);
    });
    button.dataset.assetFilterAxis = 'kind';
    button.dataset.assetFilterValue = entry.value;
    button.dataset.assetFilterCount = String(count);
    rail.appendChild(button);
  }
  rail.appendChild(h('h2', 'asset-center-filter-section', '状态'));
  for (const entry of STATUS_FILTERS) {
    const count = assetFacetCount(items, { kind: state.assetCenterKind, status: entry.value });
    const button = filterButton(entry.label, count, state.assetCenterStatus === entry.value, () => {
      state.assetCenterStatus = entry.value;
      renderAssetCenter(container, hooks);
      restoreControlFocus(`[data-asset-filter-axis="status"][data-asset-filter-value="${entry.value}"]`);
    });
    button.dataset.assetFilterAxis = 'status';
    button.dataset.assetFilterValue = entry.value;
    button.dataset.assetFilterCount = String(count);
    rail.appendChild(button);
  }

  const library = h('section', `asset-center-library ${effectiveAssetView}`);
  library.setAttribute('aria-label', '素材列表');
  library.dataset.visibleCount = String(filtered.length);
  library.dataset.totalCount = String(items.length);
  const libraryHeader = h('div', 'asset-center-library-header');
  const libraryTitle = h('div', 'asset-center-library-title');
  const scopeLabel = state.assetCenterFolder === 'all' ? '当前显示' : '当前目录显示';
  const resultCount = h('p', undefined, `${scopeLabel} ${filtered.length} 项，共 ${items.length} 项`);
  libraryTitle.append(h('h2', undefined, '素材库'), resultCount);

  const libraryControls = h('div', 'asset-center-library-controls');
  const batchControls = h('div', 'asset-center-batch-controls');
  if (relocationProjection.mode === 'idle') {
    const beginBatch = h('button', undefined, '批量整理') as HTMLButtonElement;
    beginBatch.type = 'button';
    beginBatch.disabled = hooks.assetRelocation.availabilityMessage !== null;
    if (hooks.assetRelocation.availabilityMessage) beginBatch.title = hooks.assetRelocation.availabilityMessage;
    beginBatch.onclick = hooks.assetRelocation.onBeginBatch;
    batchControls.appendChild(beginBatch);
  } else if (relocationProjection.mode === 'batch') {
    batchControls.appendChild(h('strong', undefined, `已选 ${relocationProjection.selection.length} 项`));
    if (!relocationProjection.batchEditing) {
      const organize = h('button', 'asset-center-batch-primary', '整理所选') as HTMLButtonElement;
      organize.type = 'button';
      organize.disabled = relocationProjection.selection.length === 0 || relocationProjection.busy;
      organize.onclick = hooks.assetRelocation.onOpenBatchEditor;
      const exit = h('button', undefined, '退出选择') as HTMLButtonElement;
      exit.type = 'button';
      exit.disabled = relocationProjection.busy;
      exit.onclick = hooks.assetRelocation.onCancel;
      batchControls.append(organize, exit);
    }
  }
  const folderLabel = h('label', 'asset-center-folder-controls');
  folderLabel.appendChild(h('span', undefined, '位置'));
  const folderSelect = document.createElement('select');
  folderSelect.dataset.assetFolderControl = 'true';
  folderSelect.setAttribute('aria-label', '素材位置');
  const allFolders = document.createElement('option');
  allFolders.value = 'all';
  allFolders.textContent = `全部位置（${items.length}）`;
  folderSelect.appendChild(allFolders);
  for (const option of folderOptions) {
    const element = document.createElement('option');
    element.value = option.path;
    element.textContent = `${'　'.repeat(option.depth)}${option.label}（${option.count}）`;
    folderSelect.appendChild(element);
  }
  folderSelect.value = state.assetCenterFolder;
  folderSelect.onchange = () => {
    state.assetCenterFolder = folderSelect.value;
    renderAssetCenter(container, hooks);
    restoreControlFocus('[data-asset-folder-control]');
  };
  folderLabel.appendChild(folderSelect);

  const sortLabel = h('label', 'asset-center-sort');
  sortLabel.appendChild(h('span', undefined, '排序'));
  const sort = document.createElement('select');
  sort.dataset.assetSort = 'control';
  sort.setAttribute('aria-label', '素材排序');
  for (const option of SORT_OPTIONS) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    sort.appendChild(element);
  }
  sort.value = state.assetCenterSort;
  sort.onchange = () => {
    state.assetCenterSort = sort.value as AssetCenterSort;
    renderAssetCenter(container, hooks);
    requestAnimationFrame(() => container.querySelector<HTMLSelectElement>('[data-asset-sort="control"]')?.focus());
  };
  sortLabel.appendChild(sort);
  libraryControls.append(batchControls, folderLabel, sortLabel);
  libraryHeader.append(libraryTitle, libraryControls);
  library.appendChild(libraryHeader);

  if (state.assetCenterFolder !== 'all') {
    const breadcrumbs = h('nav', 'asset-center-folder-breadcrumbs');
    breadcrumbs.setAttribute('aria-label', '当前素材位置');
    for (const [index, breadcrumb] of assetFolderBreadcrumbs(state.assetCenterFolder).entries()) {
      if (index > 0) {
        const separator = h('span', 'asset-center-folder-separator', '›');
        separator.setAttribute('aria-hidden', 'true');
        breadcrumbs.appendChild(separator);
      }
      const button = h('button', 'asset-center-folder-crumb', breadcrumb.label) as HTMLButtonElement;
      button.type = 'button';
      button.dataset.assetFolderCrumb = breadcrumb.path;
      if (breadcrumb.path === state.assetCenterFolder) button.setAttribute('aria-current', 'location');
      button.onclick = () => {
        state.assetCenterFolder = breadcrumb.path;
        renderAssetCenter(container, hooks);
        if (breadcrumb.path === 'all') {
          restoreControlFocus('[data-asset-folder-control]');
          return;
        }
        requestAnimationFrame(() => {
          [...container.querySelectorAll<HTMLButtonElement>('[data-asset-folder-crumb]')]
            .find((candidate) => candidate.dataset.assetFolderCrumb === breadcrumb.path)
            ?.focus();
        });
      };
      breadcrumbs.appendChild(button);
    }
    library.appendChild(breadcrumbs);
  }
  if (relocationProjection.mode === 'batch' && relocationProjection.batchEditing) {
    library.appendChild(renderBatchRelocationWorkbench(items, hooks));
  } else {
    const batchSelecting = relocationProjection.mode === 'batch';
    const list = h('div', 'asset-center-items');
    list.id = 'asset-center-library-items';
    list.setAttribute('role', batchSelecting ? 'list' : 'listbox');
    list.setAttribute('aria-label', batchSelecting ? '选择要批量整理的素材' : '项目素材');
    const rowCache = new Map<string, HTMLElement>();
    refreshSearchResults = () => {
    filtered = filterAssetItems(items);
    container.dataset.assetQuery = state.assetCenterQuery;
    container.dataset.visibleCount = library.dataset.visibleCount = String(filtered.length);
    resultCount.textContent = `${scopeLabel} ${filtered.length} 项，共 ${items.length} 项`;
    for (const button of rail.querySelectorAll<HTMLButtonElement>('.asset-center-filter')) {
      const kind = button.dataset.assetFilterAxis === 'kind'
        ? button.dataset.assetFilterValue as AssetKindFilter : state.assetCenterKind;
      const status = button.dataset.assetFilterAxis === 'status'
        ? button.dataset.assetFilterValue as AssetStatusFilter : state.assetCenterStatus;
      const count = assetFacetCount(items, { kind, status });
      button.dataset.assetFilterCount = String(count);
      button.querySelector<HTMLElement>('.asset-center-filter-count')!.textContent = String(count);
    }
    for (const button of distribution.body.querySelectorAll<HTMLButtonElement>('[data-asset-insight-kind]')) {
      button.setAttribute('aria-pressed', String(state.assetCenterQuery === ''
        && state.assetCenterKind === button.dataset.assetInsightKind
        && state.assetCenterStatus === 'all' && state.assetCenterFolder === 'all'));
    }
    for (const button of attention.body.querySelectorAll<HTMLButtonElement>('[data-asset-insight-status]')) {
      button.setAttribute('aria-pressed', String(state.assetCenterQuery === ''
        && state.assetCenterKind === 'all'
        && state.assetCenterStatus === button.dataset.assetInsightStatus && state.assetCenterFolder === 'all'));
    }
    if (batchSelecting) hooks.assetRelocation.onSetVisibleBatchItems(filtered.map(item => item.assetId));
    list.replaceChildren();
    if (filtered.length === 0) {
      list.appendChild(h('div', 'asset-center-no-results', '当前筛选下没有素材。可以清除搜索，或切换位置、分类与状态。'));
    }
    for (const item of filtered) {
      const cached = rowCache.get(item.assetId);
      if (cached) { list.appendChild(cached); continue; }
      const row = batchSelecting
        ? h('div', 'asset-center-item asset-center-item-selecting')
        : h('button', 'asset-center-item') as HTMLElement;
      if (row instanceof HTMLButtonElement) row.type = 'button';
      row.setAttribute('role', batchSelecting ? 'listitem' : 'option');
      if (!batchSelecting) row.setAttribute('aria-selected', String(item.assetId === state.assetCenterSelectedId));
      else row.dataset.batchSelected = String(relocationProjection.selection.some((source) => source.assetId === item.assetId));
      row.dataset.assetId = item.assetId;
      row.dataset.assetKind = item.kind;
      row.dataset.assetStatus = assetStatusTokens(item).join(' ');
      const thumbnail = h('span', 'asset-center-thumbnail');
      thumbnail.setAttribute('aria-hidden', 'true');
      const name = h('span', 'asset-center-item-name');
      name.append(h('strong', undefined, friendlyAssetName(item)), h('small', undefined, KIND_LABELS[item.kind]));
      const format = item.format ? `${item.format.toUpperCase()} 文件` : item.kind === 'license' ? '文本（无扩展名）' : item.physical ? '格式未识别' : '素材文件尚不存在';
      const context = h('span', 'asset-center-item-context');
      context.append(
        h('span', undefined, format),
        h('small', 'asset-center-item-path', item.sourcePath ?? item.assetId),
      );
      const usage = item.kind === 'license' ? '随素材保留' : item.references.length > 0 ? `${item.references.length} 处引用` : item.physical ? '未发现引用' : '引用缺失';
      const meta = h('span', 'asset-center-item-meta');
      meta.append(h('span', undefined, formatAssetBytes(item.bytes)), h('span', undefined, usage));
      if (batchSelecting) {
        const selection = h('label', 'asset-center-select-control');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = relocationProjection.selection.some((source) => source.assetId === item.assetId);
        const issue = relocationEntryIssue(item, hooks);
        const wrongKind = relocationProjection.batchKind !== null && relocationProjection.batchKind !== item.kind;
        checkbox.disabled = issue !== null || wrongKind || relocationProjection.busy;
        const disabledReason = wrongKind ? '一个批次只能整理同类素材。' : issue;
        checkbox.setAttribute('aria-label', disabledReason
          ? `无法选择 ${friendlyAssetName(item)}：${disabledReason}`
          : `选择 ${friendlyAssetName(item)}`);
        if (disabledReason) checkbox.title = disabledReason;
        checkbox.onchange = () => {
          hooks.assetRelocation.onSelectBatchItem(item, checkbox.checked);
          restoreAssetRowControl(item.assetId, 'input[type="checkbox"]');
        };
        selection.append(checkbox, h('span', undefined, '选择'));
        const details = h('button', 'asset-center-detail-button', '查看详情') as HTMLButtonElement;
        details.type = 'button';
        details.onclick = () => {
          hooks.onSelectAsset(item, false);
          restoreAssetRowControl(item.assetId, '.asset-center-detail-button');
        };
        row.append(selection, thumbnail, name, context, meta, details);
      } else {
        row.append(thumbnail, name, context, meta);
      }
      const selectItem = (restoreKeyboardFocus: boolean): void => {
        hooks.onSelectAsset(item, restoreKeyboardFocus);
      };
      if (!batchSelecting) {
        row.onclick = () => selectItem(false);
        row.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectItem(true);
          }
        };
      }
      list.appendChild(row);
      rowCache.set(item.assetId, row);
      if (thumbnailSession) thumbnailSession.mount(thumbnail, item, dirAssetFor(item));
    }
    };
    refreshSearchResults();
    library.appendChild(list);
  }

  const inspector = h('aside', 'asset-center-inspector');
  renderInspector(inspector, selected, items, hooks);
  shell.append(rail, library, inspector);
  const importHost = h('section');
  importHost.id = 'asset-import-workbench';
  importHost.hidden = !hooks.assetImportOpen;
  if (hooks.assetImportOpen) renderAssetImportWorkbench(importHost, state.assetImportWorkspace, hooks.assetImport);
  container.append(header, importHost, overview, insights, shell);
  enhanceAssetCenter(container);

}
