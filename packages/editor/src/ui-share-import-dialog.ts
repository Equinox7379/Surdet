import { projectThemeAssetKeys, projectUiAssetKeys, resolveProjectFontPaths, resolveProjectTheme, type ProjectFontRole, type ProjectUiPageId } from '@surdet/core';
import type { UiShareImportTarget } from './authoring-project-storage.js';
import type { PreparedUiShareImport } from './panels/config.js';
import { state } from './state.js';
import { disposeUiPlayerPreview, openUiPlayerPreview } from './ui-player-preview.js';
import type { UiPagePreviewLoad, UiPagePreviewView } from './ui-page-preview.js';
import {
  UI_SHARE_PAGE_NAMES, defaultPreviewView, fragmentPlacements, newUiShareImportPrefix, peekUiShare, restoredDefaultPages,
  summarizeUiShareImpact, uiPreviewViews, type UiShareImportPlacement, type UiShareImportRequest, type UiSharePeek,
} from './ui-share-import-model.js';

/**
 * U3 import dialog: choose → read → prepare (read-only) → look → explicit asset staging →
 * one confirmed `apply()`. It only owns its own display lifecycle; whether a proposal may
 * still be applied is decided by the proposal itself.
 */
export interface UiShareImportDialogOptions {
  prepare(text: string, target?: UiShareImportTarget): Promise<PreparedUiShareImport>;
  readDraft(): import('@surdet/core').ProjectUiDocument | null;
  /** Called after a successful `apply()`: only the draft changed. */
  onApplied(result: { kind: 'theme' | 'fragment'; page?: ProjectUiPageId; nodeId?: string }): void;
  onStatus(message: string, ok?: boolean): void;
}

interface PendingImport {
  root: FileSystemDirectoryHandle | null;
  name: string; text: string; request: UiShareImportRequest; prefix: string; placement: UiShareImportPlacement['key'] | null;
}

interface PagePreview { show(view: UiPagePreviewView): void; dispose(): void }

interface Session {
  dialog: HTMLDialogElement;
  closed: boolean;
  options: UiShareImportDialogOptions;
  request: UiShareImportRequest;
  returnFocus: HTMLElement | null;
  name: string;
  text: string | null;
  /** Bumped by every read/prepare: a later answer replaces an earlier one, never the reverse. */
  generation: number;
  prefix: string;
  peek: UiSharePeek | null;
  placements: UiShareImportPlacement[];
  placement: UiShareImportPlacement['key'] | null;
  proposal: PreparedUiShareImport | null;
  /** The proposal was used or refused: a new preview is required. */
  spent: boolean;
  busy: null | 'reading' | 'preparing' | 'staging' | 'applying';
  error: string | null;
  note: { message: string; ok: boolean } | null;
  viewKey: string | null;
  empty: boolean;
  reducedMotion: boolean;
  preview: PagePreview | null;
  playerOpened: boolean;
  render(): void;
}

let session: Session | null = null;
let pending: PendingImport | null = null;

/** The share file whose missing assets were staged; the designer offers to continue it. */
export function pendingUiShareImport(): { name: string } | null {
  if (pending && pending.root !== state.dirHandle) pending = null;
  return pending ? { name: pending.name } : null;
}
export function discardPendingUiShareImport(): void { pending = null; }

/** Close without applying, e.g. the main area or the project changes. A staged import stays resumable. */
export function disposeUiShareImportDialog(): void { if (session) closeSession(session, 'disposed'); }
export function resetUiShareImportForProjectChange(): void { disposeUiShareImportDialog(); pending = null; }
export function isUiShareImportDialogOpen(): boolean { return session !== null; }

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const origin = (): string => location.origin === 'null' ? '*' : location.origin;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label: string, focusKey: string, className = ''): HTMLButtonElement {
  const node = element('button', className, label); node.type = 'button'; node.dataset.focusKey = focusKey; return node;
}

function closeSession(s: Session, reason: 'cancel' | 'applied' | 'disposed' | 'staged'): void {
  if (s.closed) return;
  s.closed = true; s.generation += 1;
  if (session === s) session = null;
  s.preview?.dispose(); s.preview = null;
  if (s.playerOpened) disposeUiPlayerPreview();
  if (s.dialog.open) s.dialog.close();
  s.dialog.remove();
  if (reason === 'cancel') pending = null;
  if (reason !== 'disposed') {
    const target = document.querySelector<HTMLElement>('[data-ui-share-import]') ?? (s.returnFocus?.isConnected ? s.returnFocus : null);
    target?.focus();
  }
}

/** Open the dialog for a chosen file, or continue the import whose assets were staged. */
export function openUiShareImportDialog(source: { file: File } | 'pending', request: UiShareImportRequest, options: UiShareImportDialogOptions): void {
  disposeUiShareImportDialog();
  const resumed = source === 'pending' ? pending : null;
  if (source === 'pending' && (!resumed || resumed.root !== state.dirHandle)) { pending = null; options.onStatus('没有可继续的界面导入。', false); return; }
  pending = null;
  const dialog = element('dialog', 'ui-share-import');
  dialog.dataset.uiShareImportDialog = 'true';
  const s: Session = {
    dialog, closed: false, options, request: resumed?.request ?? request,
    returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    name: resumed?.name ?? (source as { file: File }).file.name, text: resumed?.text ?? null, generation: 0,
    prefix: resumed?.prefix ?? newUiShareImportPrefix(), peek: null, placements: [], placement: resumed?.placement ?? null,
    proposal: null, spent: false, busy: null, error: null, note: null, viewKey: null, empty: false,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    preview: null, playerOpened: false, render: () => undefined,
  };
  session = s;
  const current = (generation: number): boolean => session === s && !s.closed && s.generation === generation;

  const heading = element('h2', undefined, '导入主题或片段'); heading.id = `ui-share-import-title-${crypto.randomUUID()}`; heading.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', heading.id);
  const fileLine = element('p', 'ui-share-import-file');
  const head = element('header'); head.append(heading, fileLine);
  const info = element('section', 'ui-share-import-info'); info.setAttribute('aria-label', '导入内容和影响');
  const previewPane = element('section', 'ui-share-import-preview'); previewPane.setAttribute('aria-label', '效果预览');
  const body = element('div', 'ui-share-import-body'); body.append(info, previewPane);
  const footNote = element('p', 'ui-share-import-footnote', '应用后只修改当前草稿，可用“撤销”一次恢复主题和界面；用“保存全部”（Ctrl+S）才写回项目。');
  const chooseOther = button('选择其他文件…', 'choose');
  const fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
  fileInput.dataset.uiShareImportFile = 'true';
  const cancel = button('取消', 'cancel');
  const repreview = button('重新预览', 'repreview');
  const apply = button('应用到草稿', 'apply', 'primary');
  apply.dataset.uiShareImportApply = 'true';
  const actions = element('div', 'ui-share-import-actions'); actions.append(chooseOther, fileInput, cancel, repreview, apply);
  const foot = element('footer'); foot.append(footNote, actions);
  dialog.append(head, body, foot);

  // Editor shortcuts (save, undo, search) do not act behind an open import.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
  });
  // Esc and 取消 never interrupt an apply or a staging request that is already running.
  const cancellable = (): boolean => s.busy !== 'applying' && s.busy !== 'staging';
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (cancellable()) closeSession(s, 'cancel'); });
  cancel.onclick = () => { if (cancellable()) closeSession(s, 'cancel'); };
  chooseOther.onclick = () => { if (cancellable()) fileInput.click(); };
  fileInput.onchange = () => {
    const file = fileInput.files?.[0]; fileInput.value = '';
    if (!file || !cancellable() || s.closed) return;
    // A new file is a new session for its prefix and placement; the old proposal is abandoned.
    s.name = file.name; s.prefix = newUiShareImportPrefix(); s.placement = null; s.viewKey = null; read(file);
  };
  repreview.onclick = () => { if (s.text !== null && s.busy !== 'applying' && s.busy !== 'staging') void prepare(); };

  function setPreview(next: PagePreview | null): void { s.preview?.dispose(); s.preview = next; }

  function read(file: File): void {
    const generation = ++s.generation;
    s.text = null; s.proposal = null; s.spent = false; s.error = null; s.note = null; s.busy = 'reading'; setPreview(null); render();
    file.text().then(text => {
      if (!current(generation)) return;
      s.text = text; void prepare();
    }, error => {
      if (!current(generation)) return;
      s.busy = null; s.error = `无法读取文件：${message(error)}`; render();
    });
  }

  async function prepare(): Promise<void> {
    const text = s.text; if (text === null) return;
    const generation = ++s.generation;
    s.proposal = null; s.spent = false; s.error = null; s.note = null; s.busy = 'preparing'; render();
    const peek = peekUiShare(text); s.peek = peek;
    let target: UiShareImportTarget | undefined;
    if (peek.kind === 'fragment' && peek.fragmentPage) {
      s.placements = fragmentPlacements(peek.fragmentPage, s.request, options.readDraft());
      const chosen = s.placements.find(item => item.key === s.placement) ?? s.placements[0]!;
      s.placement = chosen.key;
      target = { page: peek.fragmentPage, prefix: s.prefix, ...(chosen.parentId !== undefined ? { parentId: chosen.parentId } : {}) };
    } else s.placements = [];
    try {
      const proposal = await options.prepare(text, target);
      if (!current(generation)) return;
      s.proposal = proposal; s.busy = null;
      const views = uiPreviewViews(proposal.preview.value);
      if (!s.viewKey || !views.some(view => view.key === s.viewKey)) s.viewKey = defaultPreviewView(views, proposal.preview, peek.fragmentPage);
      render();
      await mountPreview(proposal, generation);
    } catch (error) {
      if (!current(generation)) return;
      s.proposal = null; s.busy = null; s.error = message(error); setPreview(null); render();
    }
  }

  async function mountPreview(proposal: PreparedUiShareImport, generation: number): Promise<void> {
    setPreview(null);
    const value = proposal.preview.value;
    if (!value) return;
    const urls: string[] = [];
    const release = (): void => { for (const url of urls) URL.revokeObjectURL(url); urls.length = 0; };
    try {
      const { images, titleBackground, fonts } = await previewResources(proposal, urls);
      if (!current(generation)) { release(); return; }
      const host = previewPane.querySelector<HTMLElement>('[data-ui-share-import-screen]');
      if (!host) { release(); return; }
      setPreview(mountPagePreview(host, { config: proposal.preview.config, ui: value, images, ...(titleBackground ? { titleBackground } : {}), fonts, view: view() }, release, note => {
        if (session !== s || s.closed) return;
        s.note = note; renderNote();
      }));
      renderStageState();
    } catch (error) {
      release();
      if (!current(generation)) return;
      s.note = { message: `效果预览无法读取素材：${message(error)}`, ok: false }; renderNote();
    }
  }

  function view(): UiPagePreviewView {
    const views = uiPreviewViews(s.proposal?.preview.value ?? null);
    const selected = views.find(item => item.key === s.viewKey) ?? views[0]!;
    return { page: selected.page, ...(selected.mode ? { mode: selected.mode } : {}), empty: s.empty, reducedMotion: s.reducedMotion };
  }

  async function stageMissing(): Promise<void> {
    const proposal = s.proposal;
    if (!proposal || s.busy || s.spent) return;
    s.busy = 'staging'; render();
    pending = { root: state.dirHandle, name: s.name, text: s.text!, request: s.request, prefix: s.prefix, placement: s.placement };
    try {
      const count = await proposal.stageMissingAssets();
      if (session === s && !s.closed) {
        // Nothing is missing any more (imported meanwhile): this preview simply refreshes.
        if (count === 0) { pending = null; s.busy = null; await prepare(); return; }
        closeSession(s, 'staged');
      }
      options.onStatus(`已把 ${count} 个缺失文件放入素材导入待选区，尚未导入。请在素材导入工作台完成导入，再回到“配置 → 作品界面”点“继续导入「${s.name}」”。`, true);
    } catch (error) {
      pending = null;
      if (session !== s || s.closed) { options.onStatus(message(error), false); return; }
      s.busy = null; s.error = message(error); render();
    }
  }

  async function confirm(): Promise<void> {
    const proposal = s.proposal;
    if (!proposal || s.busy || s.spent || proposal.resources.some(item => item.state === 'missing')) return;
    s.busy = 'applying'; s.spent = true; render();
    const kind = proposal.preview.share.kind, patch = proposal.preview.patch;
    const page = patch?.page, nodeId = patch?.type === 'node.insert' ? patch.node.id : patch?.type === 'page.set' ? patch.root.id : undefined;
    try {
      await proposal.apply();
    } catch (error) {
      if (session !== s || s.closed) { options.onStatus(`界面导入未应用：${message(error)}`, false); return; }
      // The refused plan is never replayed; a new preview is the only way on.
      s.busy = null; s.error = `未应用，草稿保持原样：${message(error)}`; render();
      repreview.focus();
      return;
    }
    pending = null;
    if (session === s) closeSession(s, 'applied');
    options.onApplied({ kind, ...(page ? { page } : {}), ...(nodeId ? { nodeId } : {}) });
    // onApplied redraws the designer: return the keyboard to its (new) import button.
    document.querySelector<HTMLElement>('[data-ui-share-import]')?.focus();
  }
  apply.onclick = () => { void confirm(); };

  function renderNote(): void {
    const target = previewPane.querySelector<HTMLElement>('[data-ui-share-import-note]');
    if (!target) return;
    target.textContent = s.note?.message ?? '预览只读：按钮不会执行，存档和阅读设置不会写入本作品。';
    target.classList.toggle('error', s.note?.ok === false);
  }

  function renderStageState(): void {
    const stage = previewPane.querySelector<HTMLElement>('[data-ui-share-import-screen]');
    const placeholder = previewPane.querySelector<HTMLElement>('[data-ui-share-import-placeholder]');
    if (!stage || !placeholder) return;
    const current = view(), custom = Boolean(s.proposal?.preview.value?.pages[current.page]);
    placeholder.hidden = custom && s.preview !== null;
    placeholder.textContent = !s.proposal ? (s.busy ? '正在准备效果预览…' : '没有可预览的内容。')
      : !custom ? `「${UI_SHARE_PAGE_NAMES[current.page]}」导入后使用 Player 默认页，这里不绘制默认页；可点“在 Player 中试玩”查看。`
        : '正在载入效果预览…';
  }

  function renderInfo(): void {
    const focusKey = document.activeElement instanceof HTMLElement && info.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    info.replaceChildren();
    const status = element('p', 'ui-share-import-status'); status.setAttribute('role', 'status');
    status.textContent = s.busy === 'reading' ? '正在读取文件…' : s.busy === 'preparing' ? '正在准备只读预览…'
      : s.busy === 'staging' ? '正在核对缺失素材…' : s.busy === 'applying' ? '正在应用到草稿…'
        : s.proposal && !s.spent ? '预览已就绪。确认前不会改变草稿、文件或素材待选区。' : '';
    info.append(status);
    if (s.error) {
      const alert = element('div', 'ui-share-import-error'); alert.setAttribute('role', 'alert');
      alert.dataset.uiShareImportError = 'true';
      alert.append(element('strong', undefined, s.spent ? '应用被拒绝' : '无法预览'), element('p', undefined, s.error));
      if (s.spent) alert.append(element('p', undefined, '请点“重新预览”生成新的预览后再确认。'));
      info.append(alert);
    }
    const proposal = s.proposal, kind = proposal?.preview.share.kind ?? s.peek?.kind ?? null;
    if (kind) {
      const section = element('section', 'ui-share-import-kind');
      section.append(element('h3', undefined, kind === 'theme' ? '完整主题' : '界面片段'));
      section.dataset.uiShareImportKind = kind;
      section.append(element('p', undefined, kind === 'theme'
        ? '替换作品主题（颜色、字号、间距、圆角、对白框与按钮皮肤）、标题 Logo 与背景、字体，以及全部自定义页面。不包含剧情、变量取值、存档、游戏设置或项目私有字段。'
        : `只把一组组件放进「${s.peek?.fragmentPage ? UI_SHARE_PAGE_NAMES[s.peek.fragmentPage] : '对应'}」页；沿用本作品现有主题与字体。组件标识统一加前缀 ${s.prefix}_，避免与本作品重复。`));
      info.append(section);
    }
    if (s.placements.length) {
      const fieldset = element('fieldset', 'ui-share-import-placement');
      fieldset.append(element('legend', undefined, '放到哪里'));
      if (s.peek?.fragmentPage && s.peek.fragmentPage !== s.request.page) {
        fieldset.append(element('p', 'dim', `片段来自「${UI_SHARE_PAGE_NAMES[s.peek.fragmentPage]}」页，将放入本作品的同名页面（设计器当前是「${UI_SHARE_PAGE_NAMES[s.request.page]}」）。`));
      }
      for (const placement of s.placements) {
        const label = element('label', 'ui-share-import-choice');
        const radio = element('input'); radio.type = 'radio'; radio.name = 'ui-share-import-placement'; radio.value = placement.key;
        radio.dataset.focusKey = `placement:${placement.key}`;
        radio.checked = s.placement === placement.key; radio.disabled = s.busy === 'applying' || s.busy === 'staging';
        radio.onchange = () => { if (radio.checked && s.placement !== placement.key) { s.placement = placement.key; void prepare(); } };
        const text = element('span'); text.append(element('strong', undefined, placement.label), element('small', undefined, placement.detail));
        label.append(radio, text); fieldset.append(label);
      }
      info.append(fieldset);
    }
    if (proposal) {
      const impact = element('section', 'ui-share-import-impact');
      impact.append(element('h3', undefined, '页面影响'));
      const placement = s.placements.find(item => item.key === s.placement);
      const rows = summarizeUiShareImpact(proposal.preview.pages, placement?.key === 'container' ? '所选容器' : placement?.key === 'root' ? '页面根组件' : undefined);
      const restored = restoredDefaultPages(proposal.preview.pages);
      if (kind === 'theme' && restored.length) {
        const callout = element('p', 'ui-share-import-callout');
        callout.dataset.uiShareImportRestored = restored.join(',');
        callout.textContent = `这个主题没有携带「${restored.map(page => UI_SHARE_PAGE_NAMES[page]).join('」「')}」的自定义页：应用后这些页面恢复为 Player 默认页，原自定义组件移出草稿（可撤销）。游戏功能不受影响。`;
        impact.append(callout);
      }
      const list = element('ul');
      for (const row of rows) {
        const item = element('li', `change-${row.change}`); item.dataset.uiShareImportPage = row.page; item.dataset.change = row.change;
        const title = element('div'); title.append(element('strong', undefined, row.name), element('span', 'ui-share-import-badge', row.badge));
        item.append(title, element('p', undefined, row.detail));
        if (row.added.length || row.removed.length) {
          const details = element('details');
          details.append(element('summary', undefined, '组件标识'));
          if (row.added.length) details.append(element('p', undefined, `加入：${row.added.join('、')}`));
          if (row.removed.length) details.append(element('p', undefined, `移出：${row.removed.join('、')}`));
          item.append(details);
        }
        list.append(item);
      }
      impact.append(list);
      info.append(impact);
      if (kind === 'theme') {
        const config = proposal.preview.share.config as { theme?: Record<string, unknown>; player?: Record<string, unknown>; fonts?: Record<string, string> };
        const theme = element('section', 'ui-share-import-theme');
        theme.append(element('h3', undefined, '主题内容'));
        const groups = Object.keys(config.theme ?? {});
        const fontRoles = Object.entries(config.fonts ?? {});
        const roleName: Record<string, string> = { body: '正文', title: '标题', ui: '界面' };
        theme.append(element('p', undefined, groups.length ? `主题字段：${groups.join('、')}` : '主题字段：无（恢复 Player 默认主题）'));
        const absent = '本包未设置，应用后不再使用';
        theme.append(element('p', undefined, `标题 Logo：${String(config.player?.titleLogo ?? absent)}；标题背景：${String(config.player?.titleBackground ?? absent)}`));
        theme.append(element('p', undefined, fontRoles.length
          ? `字体（替换本作品的字体设置）：${fontRoles.map(([role, path]) => `${roleName[role] ?? role} ${path}`).join('；')}`
          : '字体：本包不带字体，应用后本作品改用 Player 默认字体；需要时可在“主题配置”重新选择。'));
        info.append(theme);
      }
      const variables = Object.entries(proposal.preview.share.variables);
      if (variables.length) {
        const section = element('section', 'ui-share-import-variables');
        section.append(element('h3', undefined, '使用的剧情变量'), element('p', undefined, `${variables.map(([name, declaration]) => `${name}（${declaration.type}）`).join('、')}：本作品已声明同类型变量，变量初值和剧情不变。`));
        info.append(section);
      }
      const resources = element('section', 'ui-share-import-resources');
      resources.append(element('h3', undefined, '图片与字体'));
      if (!proposal.resources.length) resources.append(element('p', 'dim', '共享包不携带图片或字体。'));
      else {
        const list = element('ul');
        for (const resource of proposal.resources) {
          const item = element('li', resource.state); item.dataset.uiShareImportResource = resource.path; item.dataset.state = resource.state;
          item.append(element('code', undefined, resource.path), element('span', undefined, resource.state === 'present' ? '本作品已有，内容一致' : '缺少，需先导入'));
          list.append(item);
        }
        resources.append(list);
      }
      const missing = proposal.resources.filter(item => item.state === 'missing');
      if (missing.length) {
        resources.append(element('p', 'ui-share-import-callout', `缺少 ${missing.length} 个文件。效果预览暂用共享包内的文件；应用前必须通过素材导入工作台真正导入。加入待选区不等于已经导入。`));
        const stage = button(`加入素材导入（${missing.length}）`, 'stage');
        stage.dataset.uiShareImportStageAssets = 'true';
        stage.disabled = s.busy !== null || s.spent;
        stage.onclick = () => { void stageMissing(); };
        resources.append(stage);
      }
      info.append(resources);
    }
    const restore = focusKey ? info.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : null;
    if (focusKey) (restore && !(restore as HTMLButtonElement).disabled ? restore : heading).focus();
  }

  function renderPreviewPane(): void {
    if (previewPane.childElementCount) { syncPreviewControls(); return; }
    const controls = element('div', 'ui-share-import-preview-controls');
    const pageLabel = element('label'); pageLabel.append(element('span', undefined, '预览页面'));
    const select = element('select'); select.dataset.uiShareImportView = 'true'; select.dataset.focusKey = 'view';
    pageLabel.append(select);
    const empty = element('label'); const emptyBox = element('input'); emptyBox.type = 'checkbox'; emptyBox.dataset.uiShareImportEmpty = 'true';
    empty.append(emptyBox, element('span', undefined, '空内容与禁用状态'));
    const reduce = element('label'); const reduceBox = element('input'); reduceBox.type = 'checkbox'; reduceBox.dataset.uiShareImportReduce = 'true';
    reduce.append(reduceBox, element('span', undefined, '减少动态'));
    const replay = button('重播进场', 'replay');
    const player = button('在 Player 中试玩', 'player'); player.dataset.uiShareImportPlayer = 'true';
    controls.append(pageLabel, empty, reduce, replay, player);
    const stage = element('div', 'ui-share-import-screen'); stage.dataset.uiShareImportScreen = 'true';
    const placeholder = element('p', 'ui-share-import-placeholder'); placeholder.dataset.uiShareImportPlaceholder = 'true';
    stage.append(placeholder);
    const note = element('p', 'ui-share-import-note'); note.dataset.uiShareImportNote = 'true'; note.setAttribute('aria-live', 'polite');
    previewPane.append(controls, stage, note);
    const update = (): void => { s.preview?.show(view()); renderStageState(); };
    select.onchange = () => { s.viewKey = select.value; update(); };
    emptyBox.onchange = () => { s.empty = emptyBox.checked; update(); };
    reduceBox.onchange = () => { s.reducedMotion = reduceBox.checked; update(); };
    replay.onclick = update;
    player.onclick = () => {
      const proposal = s.proposal;
      if (!proposal) return;
      s.playerOpened = true;
      const files = proposal.preview.share.assets.map(asset => ({ path: asset.path, blob: new Blob([base64Bytes(asset.base64)]) }));
      void openUiPlayerPreview(JSON.stringify(proposal.preview.config), undefined, { label: '导入效果试玩 · 尚未应用，进度和设置不保存', files })
        .catch(error => { if (session === s && !s.closed) { s.note = { message: `试玩未启动：${message(error)}`, ok: false }; renderNote(); } });
    };
    syncPreviewControls();
  }

  function syncPreviewControls(): void {
    const select = previewPane.querySelector<HTMLSelectElement>('[data-ui-share-import-view]')!;
    const views = uiPreviewViews(s.proposal?.preview.value ?? null);
    const signature = views.map(item => `${item.key}:${item.label}`).join('|');
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...views.map(item => { const option = element('option', undefined, item.label); option.value = item.key; return option; }));
      select.dataset.signature = signature;
    }
    if (s.viewKey) select.value = s.viewKey;
    const ready = s.proposal !== null;
    select.disabled = !ready;
    previewPane.querySelector<HTMLInputElement>('[data-ui-share-import-empty]')!.checked = s.empty;
    previewPane.querySelector<HTMLInputElement>('[data-ui-share-import-reduce]')!.checked = s.reducedMotion;
    for (const control of previewPane.querySelectorAll<HTMLButtonElement>('button')) control.disabled = !ready || s.busy === 'applying';
    renderStageState(); renderNote();
  }

  function render(): void {
    if (s.closed) return;
    fileLine.textContent = `文件：${s.name}`;
    renderInfo(); renderPreviewPane();
    const missing = s.proposal?.resources.some(item => item.state === 'missing') ?? false;
    apply.disabled = !s.proposal || s.busy !== null || s.spent || missing;
    apply.title = missing ? '先导入缺失的图片或字体' : s.spent ? '请重新预览' : '';
    repreview.disabled = s.text === null || s.busy === 'applying' || s.busy === 'staging';
    cancel.disabled = s.busy === 'applying' || s.busy === 'staging';
    chooseOther.disabled = s.busy === 'applying' || s.busy === 'staging';
  }
  s.render = render;

  document.body.append(dialog);
  dialog.showModal();
  render();
  heading.focus();
  if (resumed) void prepare(); else read((source as { file: File }).file);
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

/** Images and fonts of the proposal: bundled bytes first, then the identical files the project already has. */
async function previewResources(proposal: PreparedUiShareImport, urls: string[]): Promise<{ images: Record<string, string>; titleBackground?: string; fonts: Partial<Record<ProjectFontRole, string>> }> {
  const { config, share, value } = proposal.preview;
  const root = state.dirHandle;
  const url = (blob: Blob): string => { const created = URL.createObjectURL(blob); urls.push(created); return created; };
  const bundled = new Map(share.assets.map(asset => [asset.path, asset.base64]));
  const player = config.player && typeof config.player === 'object' ? config.player as Record<string, unknown> : {};
  const titleKey = typeof player.titleBackground === 'string' && player.titleBackground ? player.titleBackground : undefined;
  const keys = new Set([...projectUiAssetKeys(value), ...projectThemeAssetKeys(resolveProjectTheme(config)), ...(titleKey ? [titleKey] : [])]);
  const images: Record<string, string> = {};
  for (const key of keys) {
    const path = [...bundled.keys()].find(item => item.startsWith('content/assets/bg/') && item.split('/').at(-1)!.replace(/\.[^.]+$/, '') === key);
    if (path) { images[key] = url(new Blob([base64Bytes(bundled.get(path)!)])); continue; }
    const asset = state.dirAssets.find(item => item.kind === 'bg' && item.key === key && item.handle);
    if (!asset?.handle) continue;
    const file = await asset.handle.getFile();
    if (state.dirHandle !== root) throw new Error('项目已切换');
    images[key] = url(file);
  }
  const fonts: Partial<Record<ProjectFontRole, string>> = {};
  for (const [role, path] of Object.entries(resolveProjectFontPaths(config)) as Array<[ProjectFontRole, string]>) {
    if (bundled.has(path)) { fonts[role] = url(new Blob([base64Bytes(bundled.get(path)!)])); continue; }
    if (!root) continue;
    try {
      const segments = path.split('/'), filename = segments.pop()!;
      let directory = root;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
      const file = await (await directory.getFileHandle(filename)).getFile();
      if (state.dirHandle !== root) throw new Error('项目已切换');
      fonts[role] = url(file);
    } catch (error) { if (state.dirHandle !== root) throw error; /* the page preview reports the default font */ }
  }
  return { images, ...(titleKey && images[titleKey] ? { titleBackground: images[titleKey] } : {}), fonts };
}

/** The read-only page view runs in the ordinary preview frame; URLs are released with it. */
function mountPagePreview(host: HTMLElement, load: Omit<UiPagePreviewLoad, 'type'>, release: () => void, onNote: (note: { message: string; ok: boolean }) => void): PagePreview {
  const frame = element('iframe');
  frame.title = '导入效果预览（只读）';
  frame.dataset.uiShareImportFrame = 'true';
  frame.src = './ui-preview.html';
  host.append(frame);
  let posted = false, disposed = false, latest = load.view;
  const onMessage = (event: MessageEvent): void => {
    if (disposed || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    // Every new document in the frame announces itself once; a reloaded frame gets the load again.
    if (event.data?.type === 'surdet-ui-player-ready') {
      posted = true; delete frame.dataset.ready;
      frame.contentWindow?.postMessage({ type: 'surdet-ui-page-preview-load', ...load, view: latest } satisfies UiPagePreviewLoad, origin());
    } else if (event.data?.type === 'surdet-ui-page-preview-ready') frame.dataset.ready = 'true';
    else if (event.data?.type === 'surdet-ui-page-preview-note') onNote({ message: String(event.data.message), ok: event.data.ok !== false });
  };
  window.addEventListener('message', onMessage);
  return {
    show(view) {
      latest = view;
      if (posted && !disposed) frame.contentWindow?.postMessage({ type: 'surdet-ui-page-preview-show', view }, origin());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('message', onMessage);
      frame.contentWindow?.dispatchEvent(new Event('surdet-ui-preview-close'));
      frame.src = 'about:blank'; frame.remove();
      release();
    },
  };
}
