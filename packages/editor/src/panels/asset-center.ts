import type { ProjectAssetItem, ProjectAssetKind, ProjectAssetReference } from '@surdet/authoring';
import { state, h } from '../state.js';

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

type AssetStatus = Exclude<(typeof STATUS_FILTERS)[number]['value'], 'all'>;

export interface AssetCenterHooks {
  onOpenProject: () => void;
  onOpenReference: (reference: ProjectAssetReference) => void;
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
  filters: { query: string; kind: AssetKindFilter; status: AssetStatusFilter },
): boolean {
  if (filters.kind !== 'all' && item.kind !== filters.kind) return false;
  if (filters.status !== 'all' && !assetStatusTokens(item).includes(filters.status)) return false;
  return filters.query.length === 0 || normalizedSearchText(item).includes(filters.query);
}

export function assetFacetCount(
  items: readonly ProjectAssetItem[],
  filters: { kind: AssetKindFilter; status: AssetStatusFilter },
): number {
  const query = state.assetCenterQuery.trim().toLocaleLowerCase('zh-CN');
  return items.filter((item) => matchesAssetFilters(item, { query, ...filters })).length;
}

export function filterAssetItems(items: readonly ProjectAssetItem[]): ProjectAssetItem[] {
  const query = state.assetCenterQuery.trim().toLocaleLowerCase('zh-CN');
  return items.filter((item) => matchesAssetFilters(item, {
    query,
    kind: state.assetCenterKind,
    status: state.assetCenterStatus,
  }));
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
  const filtered = filterAssetItems(items);
  if (state.assetCenterSelectedId && !items.some((item) => item.assetId === state.assetCenterSelectedId)) {
    state.assetCenterSelectedId = null;
  }
  const selected = items.find((item) => item.assetId === state.assetCenterSelectedId) ?? null;
  container.dataset.assetQuery = state.assetCenterQuery;
  container.dataset.assetKindFilter = state.assetCenterKind;
  container.dataset.assetStatusFilter = state.assetCenterStatus;
  container.dataset.assetView = state.assetCenterView;
  container.dataset.visibleCount = String(filtered.length);
  container.dataset.totalCount = String(items.length);

  const header = h('header', 'asset-center-header');
  const title = h('div', 'asset-center-title');
  title.append(
    h('p', 'asset-center-eyebrow', '项目素材'),
    h('h1', undefined, '素材中心'),
    h('p', undefined, '查看真实文件、引用位置与健康提示；本页不会改动任何素材。'),
  );
  const tools = h('div', 'asset-center-tools');
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
    button.setAttribute('aria-pressed', String(state.assetCenterView === value));
    button.onclick = () => { state.assetCenterView = value; renderAssetCenter(container, hooks); };
    viewSwitch.appendChild(button);
  }
  tools.append(searchLabel, viewSwitch);
  header.append(title, tools);

  const problems = intelligence.summary.missingCount
    + intelligence.summary.duplicateCount
    + intelligence.summary.invalidNameCount
    + intelligence.summary.unsupportedCount;
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
  overview.append(
    metric('文件', String(intelligence.summary.fileCount)),
    metric(
      intelligence.summary.measuredFileCount === intelligence.summary.fileCount ? '已统计大小' : `已统计 ${intelligence.summary.measuredFileCount} 个文件`,
      measuredSize,
    ),
    metric('已引用', String(intelligence.summary.referencedCount)),
    metric('未引用', String(intelligence.summary.unusedCount)),
    metric('需要留意', String(problems), problems > 0 ? 'attention' : undefined),
  );

  const shell = h('div', 'asset-center-shell');
  const rail = h('aside', 'asset-center-rail');
  rail.setAttribute('aria-label', '素材筛选');
  rail.appendChild(h('h2', undefined, '分类'));
  for (const entry of KIND_FILTERS) {
    const count = assetFacetCount(items, { kind: entry.value, status: state.assetCenterStatus });
    const button = filterButton(entry.label, count, state.assetCenterKind === entry.value, () => {
      state.assetCenterKind = entry.value;
      renderAssetCenter(container, hooks);
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
  libraryHeader.append(
    h('h2', undefined, '素材库'),
    h('p', undefined, `当前显示 ${filtered.length} 项，共 ${items.length} 项`),
  );
  library.appendChild(libraryHeader);
  const list = h('div', 'asset-center-items');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '项目素材');
  if (filtered.length === 0) {
    list.appendChild(h('div', 'asset-center-no-results', '当前筛选下没有素材。可以清除搜索或切换分类与状态。'));
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
    const context = h('span', 'asset-center-item-context', format);
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
  container.append(header, overview, shell);

}
