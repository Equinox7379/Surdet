import type { ProjectAssetItem, ProjectAssetKind, ProjectAssetReference } from '@surdet/authoring';
import { state, h } from '../state.js';
import {
  renderAssetImportWorkbench,
  type AssetImportWorkbenchHooks,
} from './asset-import-workbench.js';
import {
  assetFolderBreadcrumbs,
  assetMatchesFolder,
  buildAssetFolderOptions,
} from './asset-center-folders.js';

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
  assetImportOpen: boolean;
  onToggleImport: () => void;
  assetImport: AssetImportWorkbenchHooks;
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
  return [KIND_LABELS[item.kind], item.key, item.variant, item.sourcePath, item.format]
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

function renderInspector(host: HTMLElement, item: ProjectAssetItem | null, hooks: AssetCenterHooks): void {
  host.replaceChildren();
  host.className = 'asset-center-inspector';
  host.setAttribute('aria-label', '素材详情');
  if (item === null) {
    host.append(
      h('p', 'asset-center-eyebrow', '素材详情'),
      h('h2', undefined, '选择一项素材'),
      h('p', 'asset-center-empty-copy', '这里会固定显示预览、文件信息和引用位置，不需要把鼠标停在条目上。'),
    );
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
  addFact('文件格式', item.format ? item.format.toUpperCase() : '未识别');
  addFact('引用情况', item.references.length > 0 ? `${item.references.length} 处` : '未发现引用');

  const references = h('section', 'asset-center-references');
  references.appendChild(h('h3', undefined, '引用位置'));
  if (item.references.length === 0) {
    references.appendChild(h('p', 'asset-center-empty-copy', '当前项目结构中没有发现引用。'));
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
  addTechnical('素材 ID', item.assetId);
  addTechnical('问题代码', item.issues.length > 0 ? item.issues.join('、') : '无');
  technical.appendChild(technicalFacts);

  host.append(
    h('p', 'asset-center-eyebrow', '素材详情'),
    h('h2', undefined, friendlyAssetName(item)),
    statusRow,
    preview,
    facts,
    references,
    technical,
  );
}

export function renderAssetCenter(container: HTMLElement, hooks: AssetCenterHooks): void {
  disposeAssetCenterPreview();
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
  const folderOptions = buildAssetFolderOptions(items);
  if (state.assetCenterFolder !== 'all' && !folderOptions.some((option) => option.path === state.assetCenterFolder)) {
    state.assetCenterFolder = 'all';
  }
  const filtered = filterAssetItems(items);
  if (state.assetCenterSelectedId && !items.some((item) => item.assetId === state.assetCenterSelectedId)) {
    state.assetCenterSelectedId = null;
  }
  const selected = items.find((item) => item.assetId === state.assetCenterSelectedId) ?? null;
  container.dataset.assetQuery = state.assetCenterQuery;
  container.dataset.assetKindFilter = state.assetCenterKind;
  container.dataset.assetStatusFilter = state.assetCenterStatus;
  container.dataset.assetView = state.assetCenterView;
  container.dataset.assetSort = state.assetCenterSort;
  container.dataset.assetFolder = state.assetCenterFolder;
  container.dataset.visibleCount = String(filtered.length);
  container.dataset.totalCount = String(items.length);

  const revealAsset = (item: ProjectAssetItem, restoreKeyboardFocus = true): void => {
    state.assetCenterQuery = '';
    state.assetCenterKind = 'all';
    state.assetCenterStatus = 'all';
    state.assetCenterFolder = 'all';
    state.assetCenterSelectedId = item.assetId;
    renderAssetCenter(container, hooks);
    if (restoreKeyboardFocus) {
      requestAnimationFrame(() => {
        const selectedRow = [...container.querySelectorAll<HTMLButtonElement>('[role="option"][data-asset-id]')]
          .find((candidate) => candidate.dataset.assetId === item.assetId);
        selectedRow?.focus();
      });
    }
  };

  const restoreControlFocus = (selector: string): void => {
    requestAnimationFrame(() => container.querySelector<HTMLElement>(selector)?.focus());
  };

  const header = h('header', 'asset-center-header');
  const title = h('div', 'asset-center-title');
  title.append(
    h('p', 'asset-center-eyebrow', '项目素材'),
    h('h1', undefined, '素材中心'),
    h('p', undefined, '查看真实文件、引用位置与健康提示；本页不会改动任何素材。'),
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
    state.assetCenterQuery = search.value;
    renderAssetCenter(container, hooks);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-asset-filter="search"]')?.focus());
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

  const library = h('section', `asset-center-library ${state.assetCenterView}`);
  library.setAttribute('aria-label', '素材列表');
  library.dataset.visibleCount = String(filtered.length);
  library.dataset.totalCount = String(items.length);
  const libraryHeader = h('div', 'asset-center-library-header');
  const libraryTitle = h('div', 'asset-center-library-title');
  const scopeLabel = state.assetCenterFolder === 'all' ? '当前显示' : '当前目录显示';
  libraryTitle.append(h('h2', undefined, '素材库'), h('p', undefined, `${scopeLabel} ${filtered.length} 项，共 ${items.length} 项`));

  const libraryControls = h('div', 'asset-center-library-controls');
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
  libraryControls.append(folderLabel, sortLabel);
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
  const list = h('div', 'asset-center-items');
  list.id = 'asset-center-library-items';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '项目素材');
  if (filtered.length === 0) {
    list.appendChild(h('div', 'asset-center-no-results', '当前筛选下没有素材。可以清除搜索，或切换位置、分类与状态。'));
  }
  for (const item of filtered) {
    const row = h('button', 'asset-center-item') as HTMLButtonElement;
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(item.assetId === state.assetCenterSelectedId));
    row.dataset.assetId = item.assetId;
    row.dataset.assetKind = item.kind;
    row.dataset.assetStatus = assetStatusTokens(item).join(' ');
    const name = h('span', 'asset-center-item-name');
    name.append(h('strong', undefined, friendlyAssetName(item)), h('small', undefined, KIND_LABELS[item.kind]));
    const format = item.format ? `${item.format.toUpperCase()} 文件` : item.physical ? '格式未识别' : '素材文件尚不存在';
    const context = h('span', 'asset-center-item-context');
    context.append(
      h('span', undefined, format),
      h('small', 'asset-center-item-path', item.sourcePath ?? item.assetId),
    );
    const usage = item.references.length > 0 ? `${item.references.length} 处引用` : item.physical ? '未发现引用' : '引用缺失';
    const meta = h('span', 'asset-center-item-meta');
    meta.append(h('span', undefined, formatAssetBytes(item.bytes)), h('span', undefined, usage));
    row.append(name, context, meta);
    const selectItem = (restoreKeyboardFocus: boolean): void => {
      state.assetCenterSelectedId = item.assetId;
      renderAssetCenter(container, hooks);
      if (restoreKeyboardFocus) {
        requestAnimationFrame(() => {
          const selectedRow = [...container.querySelectorAll<HTMLButtonElement>('[role="option"][data-asset-id]')]
            .find((candidate) => candidate.dataset.assetId === item.assetId);
          selectedRow?.focus();
        });
      }
    };
    row.onclick = () => selectItem(false);
    row.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectItem(true);
      }
    };
    list.appendChild(row);
  }
  library.appendChild(list);

  const inspector = h('aside', 'asset-center-inspector');
  renderInspector(inspector, selected, hooks);
  shell.append(rail, library, inspector);
  const importHost = h('section');
  importHost.id = 'asset-import-workbench';
  importHost.hidden = !hooks.assetImportOpen;
  if (hooks.assetImportOpen) renderAssetImportWorkbench(importHost, state.assetImportWorkspace, hooks.assetImport);
  container.append(header, importHost, overview, insights, shell);

}
