import { state, h, setStatus } from '../state.js';
import { button, ImageScope, revealAsset } from './ui.js';

let activeImageDialog: { dialog: HTMLDialogElement; scope: ImageScope } | null = null;
/** Release view-owned media before changing modes or replacing a material list. */
export function disposeV4SurfaceViews(): void {
  if (!activeImageDialog) return;
  activeImageDialog.scope.dispose();
  activeImageDialog.dialog.close();
  activeImageDialog.dialog.remove();
  activeImageDialog = null;
}

const KIND_LABELS: Record<string, string> = { background: '背景', portrait: '立绘', avatar: '头像', music: '音乐', ambience: '环境音', 'sound-effect': '音效', voice: '语音', video: '视频', font: '字体', other: '其他' };
export function displayBytes(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未测量';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** Reorganize the real controls, never recreate import/relocation callbacks or their workspace. */
export function enhanceAssetCenter(root: HTMLElement): void {
  disposeV4SurfaceViews();
  const shell = root.querySelector<HTMLElement>('.asset-center-shell');
  if (!shell || !state.assetIntelligence) return;
  root.classList.add('v4-asset-center');
  root.querySelector('.asset-center-insights')?.remove();
  const tools = root.querySelector('.asset-center-tools');
  const libraryHeader = root.querySelector('.asset-center-library-header');
  const search = root.querySelector('.asset-center-search');
  const viewSwitch = root.querySelector('.asset-center-view-switch');
  const browsing = h('div', 'v4-asset-browsing');
  if (search) browsing.append(search);
  if (viewSwitch) browsing.append(viewSwitch);
  libraryHeader?.prepend(browsing);
  // Import remains at the page header, including the existing aria-expanded state.
  if (tools && !tools.childElementCount) tools.remove();
  const overview = root.querySelector<HTMLElement>('.asset-center-overview');
  if (overview) overview.setAttribute('aria-label', '素材数量与处理摘要');
  for (const row of root.querySelectorAll<HTMLElement>('.asset-center-item[data-asset-id]')) {
    const path = row.querySelector<HTMLElement>('.asset-center-item-path');
    const name = row.querySelector('.asset-center-item-name');
    if (path && name) {
      const full = path.textContent ?? '';
      path.title = full;
      path.textContent = full.replace(/^content\/assets\//, '');
      const kind = name.querySelector('small');
      const context = row.querySelector('.asset-center-item-context');
      if (kind && context) context.prepend(kind);
      name.append(path);
    }
  }
  const inspector = root.querySelector<HTMLElement>('.asset-center-inspector');
  const selected = state.assetIntelligence.items.find((item) => item.assetId === state.assetCenterSelectedId);
  if (inspector && selected?.physical) {
    const controls = h('div', 'v4-asset-detail-actions');
    if (selected.sourcePath) controls.append(button('复制完整路径', () => {
      if (!navigator.clipboard) { setStatus('此环境无法自动复制，可在技术信息中选择完整路径', false, 5000); return; }
      void navigator.clipboard.writeText(selected.sourcePath!).then(
        () => setStatus('已复制完整路径', true, 2500),
        () => setStatus('复制未完成，可在技术信息中选择完整路径', false, 5000),
      );
    }));
    const source = state.dirAssets.find((asset) => asset.sourcePath === selected.sourcePath);
    if (source?.isImage && source.handle) controls.append(button('放大图像', () => {
      const scope = new ImageScope();
      const dialog = h('dialog', 'v4-image-dialog');
      const picture = h('div', 'v4-image-dialog-content');
      disposeV4SurfaceViews();
      activeImageDialog = { dialog, scope };
      const close = (): void => { disposeV4SurfaceViews(); };
      dialog.append(button('关闭图像', close), picture);
      dialog.oncancel = (event) => { event.preventDefault(); close(); };
      root.append(dialog); dialog.showModal();
      void scope.image(picture, source, selected.key, 'contain');
    }));
    inspector.append(controls);
  }
}

const selections = new WeakMap<object, Map<string, number>>();
const demoSelectionKey = {};
function selectionState(): Map<string, number> {
  const key = state.dirHandle ?? state.scenes.values().next().value ?? demoSelectionKey;
  let value = selections.get(key);
  if (!value) { value = new Map(); selections.set(key, value); }
  return value;
}

/** Original fields, row closures, JSON drafts, deletion and local save remain mounted. */
export function enhanceConfigTables(root: HTMLElement): void {
  root.classList.add('v4-config');
  const memory = selectionState();
  for (const [ordinal, table] of [...root.querySelectorAll<HTMLTableElement>('.config-table')].entries()) {
    if (table.dataset.objectEditor === 'true') continue;
    table.dataset.objectEditor = 'true';
    const wrapper = table.parentElement;
    if (!wrapper) continue;
    wrapper.classList.add('v4-object-workspace');
    const labels = [...table.querySelectorAll('thead th')].map((cell) => cell.querySelector('.config-label > span')?.textContent ?? cell.textContent ?? '字段');
    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    const section = table.closest<HTMLElement>('[data-config-section]')?.dataset.configSection ?? 'config';
    const key = `${section}:${ordinal}`;
    const sectionName = table.closest('[data-config-section]')?.querySelector('.config-section-heading')?.textContent ?? '配置';
    const nav = h('nav', 'v4-object-index'); nav.setAttribute('aria-label', `${sectionName}对象`);
    const heading = table.closest('.config-subsection')?.querySelector('h2')?.textContent ?? '对象';
    nav.append(h('h3', undefined, heading));
    const controls: HTMLButtonElement[] = [];
    const titleFor = (row: HTMLTableRowElement, index: number): string => {
      const input = row.querySelector<HTMLInputElement>('input:not([type="checkbox"]),select');
      return input?.value || row.querySelector('code')?.textContent || `未命名对象 ${index + 1}`;
    };
    const select = (index: number): void => {
      memory.set(key, index);
      rows.forEach((row, i) => { row.hidden = index !== i; controls[i]?.setAttribute('aria-current', index === i ? 'true' : 'false'); });
    };
    rows.forEach((row, index) => {
      const control = button(titleFor(row, index), () => select(index), 'v4-object-link');
      controls.push(control); nav.append(control);
      row.addEventListener('input', () => { control.textContent = titleFor(row, index); });
      [...row.cells].forEach((cell, column) => {
        const label = h('span', 'v4-cell-label', labels[column] ?? '操作');
        cell.prepend(label);
        // JSON fields are native textareas in the original renderer. Do not mirror
        // multiline JSON through an <input>, which strips physical newlines.
        const json = cell.querySelector<HTMLTextAreaElement>('textarea.mono');
        if (json) { json.classList.add('v4-config-json'); json.rows = 4; }

      });
    });
    if (!rows.length) nav.append(h('p', 'v4-muted', '还没有对象，可使用下方新增操作。'));
    wrapper.prepend(nav);
    select(Math.min(memory.get(key) ?? 0, Math.max(0, rows.length - 1)));
  }
}

/** Asset metrics consume the shared projection, even when text statistics cannot compile. */
export function renderAssetInsights(root: HTMLElement): void {
  root.querySelector('.v4-asset-analysis')?.remove();
  const section = h('section', 'v4-asset-analysis'); section.setAttribute('aria-label', '素材空间分析');
  section.append(h('h2', undefined, '素材与空间'));
  const intelligence = state.assetIntelligence;
  if (!intelligence || state.assetIntelligenceState !== 'ready') {
    section.append(h('p', 'v4-muted', state.assetIntelligenceState === 'loading' ? '素材事实仍在读取。' : '素材事实当前不可用；未测量不表示零。'));
    root.append(section); return;
  }
  const { summary, items } = intelligence;
  section.append(h('p', 'v4-muted', `${summary.fileCount} 个真实文件 · 已测量 ${summary.measuredFileCount} 个 · ${summary.measuredFileCount ? displayBytes(summary.measuredBytes) : '大小未测量'}`));
  const body = h('div', 'v4-analysis-columns');
  const distribution = h('section'); distribution.append(h('h3', undefined, '空间分布'));
  for (const [kind, value] of Object.entries(summary.byKind)) {
    if (value.files === 0) continue;
    const row = h('div', 'v4-analysis-row');
    row.append(h('span', undefined, KIND_LABELS[kind] ?? kind), h('span', undefined, `${value.files} 个文件`));
    // Per-kind fields are not guessed: aggregate directly from shared item bytes.
    const measured = items.filter((item) => item.kind === kind && item.physical && typeof item.bytes === 'number');
    const size = measured.length ? measured.reduce((sum, item) => sum + item.bytes!, 0) : undefined;
    row.append(h('strong', undefined, displayBytes(size)));
    distribution.append(row);
  }
  const largest = h('section'); largest.append(h('h3', undefined, '大文件'));
  const ranked = items.filter((item) => item.physical && typeof item.bytes === 'number').sort((left, right) => right.bytes! - left.bytes!).slice(0, 8);
  for (const item of ranked) {
    const link = button('', () => revealAsset(item.assetId), 'v4-analysis-file');
    link.dataset.revealAsset = item.assetId;
    link.append(h('span', undefined, item.key), h('small', undefined, item.sourcePath ?? ''), h('strong', undefined, displayBytes(item.bytes)));
    largest.append(link);
  }
  if (!ranked.length) largest.append(h('p', 'v4-muted', '还没有测量到文件大小。'));
  body.append(distribution, largest); section.append(body); root.append(section);
}
