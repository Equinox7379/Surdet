// Desktop: export the saved project as a portable Windows game folder. The main process owns the
// output folder, the project source and the export itself; this dialog holds the location id it was
// handed, the form, and the person's permission for each declared plugin, and shows the stage
// progress the main process reports.
import type { DesktopBridge, ExportGameInspection, ExportGameProgress, ExportGameRequest, ExportGameResult, ProjectCreationLocation } from '../../desktop/contracts.js';
import { h } from '../state.js';
import { desktopErrorMessage } from '../desktop.js';
import '../styles/game-export.css';

export type GameExportBridge = Pick<DesktopBridge, 'inspectGameExport' | 'chooseExportLocation' | 'exportGame' | 'cancelGameExport' | 'showGameExport' | 'onGameExportProgress'>;
type Message = { text: string; tone: 'info' | 'error' | 'success' };

export interface GameExportHooks {
  /** Whether the Editor holds edits that are not on disk; the export reads only the saved project. */
  hasDrafts(): boolean;
  /** Save every draft. */
  save(): Promise<void>;
  /** Why another Editor operation keeps the project busy, or null. */
  busy(): string | null;
  /** Hold the Editor's write and switch protection for the export; released only once the export settled. */
  setExporting(exporting: boolean): void;
}

export interface GameExportState {
  stage: 'drafts' | 'saving' | 'inspecting' | 'unavailable' | 'form' | 'exporting' | 'cancelling' | 'done';
  inspection: ExportGameInspection | null;
  title: string;
  version: string;
  icon: string;
  folderName: string;
  location: ProjectCreationLocation | null;
  choosing: boolean;
  /** Plugins the person allowed into this export; every declared one is needed. */
  allowed: Set<string>;
  progress: ExportGameProgress | null;
  result: ExportGameResult | null;
  message: Message | null;
}

export const EXPORT_PHASES: readonly { phase: ExportGameProgress['phase']; label: string }[] = [
  { phase: 'checking', label: '检查项目' },
  { phase: 'runtime', label: '复制游戏运行时' },
  { phase: 'content', label: '整理剧本与配置' },
  { phase: 'archive', label: '打包素材' },
  { phase: 'verify', label: '核对成品' },
  { phase: 'complete', label: '完成' },
];

const VERSION = /^\d+\.\d+\.\d+(?:\.\d+)?$/;

/**
 * What the form still needs before the export can be asked for. The main process checks every rule
 * again; these are the ones a person can fix here without a round trip.
 */
export function gameExportBlocker(state: Pick<GameExportState, 'inspection' | 'title' | 'version' | 'folderName' | 'location' | 'allowed'>): string | null {
  const inspection = state.inspection;
  if (inspection === null) return '还没有检查项目。';
  const errors = inspection.issues.filter(issue => issue.severity === 'error').length;
  if (errors > 0) return `检查发现 ${errors} 个错误，修正并保存后再导出。`;
  const title = state.title.trim();
  if (!title || title.length > 200) return '作品标题须为 1 至 200 字。';
  if (!VERSION.test(state.version.trim()) || state.version.trim().split('.').some(part => Number(part) > 65535)) return '版本须为三段或四段数字，每段 0 至 65535，例如 1.2.0。';
  const missing = inspection.plugins.filter(plugin => !state.allowed.has(plugin.id));
  if (missing.length) return `请逐个确认要打包的插件：${missing.map(plugin => plugin.id).join('、')}。`;
  if (state.location === null) return '请选择导出位置。';
  const folder = state.folderName.trim();
  if (!folder) return '请填写新文件夹的名称。';
  if (/[\\/]/.test(folder)) return '文件夹名称只填一个名字，不能包含路径。';
  return null;
}

export function createGameExport(bridge: GameExportBridge, hooks: GameExportHooks, onChange: () => void) {
  const state: GameExportState = { stage: 'inspecting', inspection: null, title: '', version: '', icon: '', folderName: '', location: null,
    choosing: false, allowed: new Set(), progress: null, result: null, message: null };
  const update = (patch: Partial<GameExportState>) => { Object.assign(state, patch); onChange(); };
  /** The stage after an await, which control flow narrowing cannot see. */
  const stageNow = (): GameExportState['stage'] => state.stage;
  let cancelRequested = false;

  const inspect = async (): Promise<void> => {
    update({ stage: 'inspecting', message: { text: '正在检查已保存的项目…', tone: 'info' } });
    try {
      const inspection = await bridge.inspectGameExport();
      // Permission is never carried over from an earlier inspection or from the declaration.
      update({ stage: 'form', inspection, title: inspection.title, version: inspection.version, folderName: state.folderName || `${inspection.id}-windows`,
        allowed: new Set(), message: inspection.version ? null : { text: '项目还没有版本号，请填写 Windows 版本。', tone: 'info' } });
    } catch (error) {
      update({ stage: 'unavailable', message: { text: desktopErrorMessage(error, '无法检查项目'), tone: 'error' } });
    }
  };

  return {
    state,
    blocker: () => gameExportBlocker(state),
    /** The dialog cannot close while an export is running or settling. */
    canClose: () => state.stage !== 'exporting' && state.stage !== 'cancelling' && state.stage !== 'saving',
    async start(): Promise<void> {
      if (hooks.hasDrafts()) { update({ stage: 'drafts', message: { text: '有尚未保存的修改。导出只使用磁盘上已保存的版本，请先保存。', tone: 'info' } }); return; }
      await inspect();
    },
    async saveAndContinue(): Promise<void> {
      if (state.stage !== 'drafts') return;
      update({ stage: 'saving', message: { text: '正在保存…', tone: 'info' } });
      try { await hooks.save(); }
      catch (error) { update({ stage: 'drafts', message: { text: `保存没有完成：${error instanceof Error ? error.message : String(error)}`, tone: 'error' } }); return; }
      if (hooks.hasDrafts()) { update({ stage: 'drafts', message: { text: '仍有修改没有保存（例如保存失败的文件或审阅草稿），处理后再导出。', tone: 'error' } }); return; }
      await inspect();
    },
    recheck: inspect,
    setTitle(title: string) { state.title = title; onChange(); },
    setVersion(version: string) { state.version = version; onChange(); },
    setIcon(icon: string) { state.icon = icon; onChange(); },
    setFolderName(folderName: string) { state.folderName = folderName; onChange(); },
    setAllowed(id: string, allowed: boolean) {
      if (allowed) state.allowed.add(id); else state.allowed.delete(id);
      onChange();
    },
    async chooseLocation(): Promise<void> {
      if (state.stage !== 'form' || state.choosing) return;
      update({ choosing: true });
      try {
        // null means cancelled (or another folder dialog is open): the previous choice stays.
        const location = await bridge.chooseExportLocation();
        update({ choosing: false, ...(location ? { location } : {}) });
      } catch (error) {
        update({ choosing: false, message: { text: desktopErrorMessage(error, '无法选择导出位置'), tone: 'error' } });
      }
    },
    async exportGame(): Promise<void> {
      if (state.stage !== 'form' || gameExportBlocker(state) !== null) return;
      const busy = hooks.busy();
      if (busy !== null) { update({ message: { text: busy, tone: 'error' } }); return; }
      if (hooks.hasDrafts()) { update({ stage: 'drafts', message: { text: '检查之后又有修改没有保存。导出只使用已保存的版本，请先保存。', tone: 'info' } }); return; }
      const request: ExportGameRequest = { locationId: state.location!.id, folderName: state.folderName.trim(), title: state.title.trim(), version: state.version.trim(),
        ...(state.icon ? { icon: state.icon } : {}), trustedPlugins: state.inspection!.plugins.map(plugin => plugin.id).filter(id => state.allowed.has(id)) };
      cancelRequested = false;
      const unsubscribe = bridge.onGameExportProgress(progress => { if (state.stage === 'exporting' || state.stage === 'cancelling') update({ progress }); });
      hooks.setExporting(true);
      update({ stage: 'exporting', progress: null, result: null, message: null });
      try {
        const result = await bridge.exportGame(request);
        // A finished export spends the location choice.
        update({ stage: 'done', result, location: null, message: { text: `已导出「${result.title}」${result.version}。`, tone: 'success' } });
      } catch (error) {
        const reason = desktopErrorMessage(error, '导出失败');
        // Shown only now that the main process finished: a requested cancel is not reported before it happened.
        update({ stage: 'form', progress: null, message: cancelRequested ? { text: /取消/.test(reason) ? reason : `已请求取消，导出停止：${reason}`, tone: 'info' }
          : { text: `导出没有完成：${reason}`, tone: 'error' } });
      } finally {
        unsubscribe();
        hooks.setExporting(false);
        onChange();
      }
    },
    async cancel(): Promise<void> {
      if (state.stage !== 'exporting') return;
      cancelRequested = true;
      // The export promise settles only after the main process stopped and cleaned up; until then it is not cancelled.
      update({ stage: 'cancelling', message: { text: '正在取消，等待当前文件操作和清理结束…', tone: 'info' } });
      try { await bridge.cancelGameExport(); }
      catch (error) {
        cancelRequested = false;
        if (stageNow() === 'cancelling') update({ stage: 'exporting', message: { text: `取消请求没有送达，导出仍在进行：${desktopErrorMessage(error, '无法取消')}`, tone: 'error' } });
      }
    },
    async showResult(): Promise<void> {
      if (state.stage !== 'done') return;
      try { await bridge.showGameExport(); }
      catch (error) { update({ message: { text: `成品已导出，但无法打开所在文件夹：${desktopErrorMessage(error, '无法打开文件夹')}`, tone: 'error' } }); }
    },
    /** Start another export from the form; a new location must be chosen. */
    again() { if (state.stage === 'done') void inspect(); },
  };
}

export type GameExport = ReturnType<typeof createGameExport>;

/** The inspection reports absolute paths; the project-relative part is what an author recognizes. */
export function projectRelativeFile(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  for (const top of ['content/', 'plugins/', 'src/']) {
    if (normalized.startsWith(top)) return normalized;
    const index = normalized.indexOf(`/${top}`);
    if (index >= 0) return normalized.slice(index + 1);
  }
  return /^(?:.*\/)?(game\.config\.json|package\.json)$/.exec(normalized)?.[1] ?? normalized;
}

/** Lint text can open with the issue's own location, which the row already shows. */
export function issueMessage(issue: Pick<ExportGameInspection['issues'][number], 'file' | 'text'>): string {
  return issue.file && issue.text.startsWith(issue.file) ? issue.text.slice(issue.file.length).replace(/^(?::\d+)*:\s*/, '') || issue.text : issue.text;
}

/** Where the new folder will go, for display only; the request carries the location id. */
function targetPreview(location: ProjectCreationLocation, folder: string): string {
  const separator = location.location.includes('\\') ? '\\' : '/';
  return `${location.location.replace(/[\\/]+$/, '')}${separator}${folder.trim()}`;
}

/** The form keeps its controls across updates so typing and focus are never interrupted. */
/** `icons` are the project-relative PNG and ICO files under content/assets. */
export function renderGameExport(exporter: GameExport, icons: readonly string[], onClosed: () => void): { dialog: HTMLDialogElement; refresh: () => void } {
  const dialog = h('dialog', 'v4-insert-dialog game-export-dialog');
  dialog.setAttribute('aria-label', '导出 Windows 游戏');
  const header = h('header', 'game-export-header');
  const close = h('button', 'v4-button', '关闭'); close.type = 'button';
  close.onclick = () => { if (exporter.canClose()) dialog.close(); };
  header.append(h('h2', undefined, '导出 Windows 游戏'), close);
  const intro = h('p', 'game-export-intro', '生成免安装的 Windows 游戏文件夹（x64），只使用磁盘上已保存的版本。不生成安装器，也不签名。');
  const status = h('p', 'game-export-status'); status.setAttribute('role', 'status');

  const drafts = h('section', 'game-export-drafts');
  const save = h('button', 'v4-button v4-primary', '保存全部并继续'); save.type = 'button';
  save.onclick = () => { void exporter.saveAndContinue(); };
  drafts.append(save);

  const unavailable = h('section', 'game-export-unavailable');
  const retry = h('button', 'v4-button', '重新检查'); retry.type = 'button';
  retry.onclick = () => { void exporter.recheck(); };
  unavailable.append(retry);

  const identity = h('p', 'game-export-identity');
  const issuesBox = h('section', 'game-export-issues');
  const pluginsBox = h('section', 'game-export-plugins');

  const form = h('form', 'game-export-form'); form.noValidate = true;
  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement => {
    // A label would rename a button inside it; a group of controls is named instead.
    const grouped = control.tagName === 'DIV';
    const wrap = h(grouped ? 'div' : 'label', 'game-export-field');
    if (grouped) { wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label); }
    wrap.append(h('span', 'game-export-label', label), control);
    if (hint) wrap.append(h('small', undefined, hint));
    return wrap;
  };
  const title = h('input'); title.type = 'text'; title.maxLength = 200; title.autocomplete = 'off'; title.setAttribute('aria-label', '游戏标题');
  title.oninput = () => exporter.setTitle(title.value);
  const version = h('input'); version.type = 'text'; version.placeholder = '1.0.0'; version.autocomplete = 'off'; version.setAttribute('aria-label', 'Windows 版本');
  version.oninput = () => exporter.setVersion(version.value);
  const icon = h('select'); icon.setAttribute('aria-label', '程序图标');
  const defaultIcon = h('option', undefined, '默认图标'); defaultIcon.value = ''; icon.append(defaultIcon);
  for (const path of icons) { const option = h('option', undefined, path.replace(/^content\/assets\//, '')); option.value = path; icon.append(option); }
  icon.onchange = () => exporter.setIcon(icon.value);
  const chooser = h('div', 'game-export-location');
  const choose = h('button', 'v4-button', '选择位置…'); choose.type = 'button';
  choose.onclick = () => { void exporter.chooseLocation(); };
  const where = h('span', 'game-export-where');
  chooser.append(choose, where);
  const folder = h('input'); folder.type = 'text'; folder.autocomplete = 'off'; folder.spellcheck = false; folder.setAttribute('aria-label', '新文件夹名称');
  folder.oninput = () => exporter.setFolderName(folder.value);
  const target = h('small', 'game-export-target');
  const folderField = field('新文件夹名称', folder);
  folderField.append(target);
  form.append(
    field('游戏标题', title, '显示在窗口标题和程序信息里。'),
    field('Windows 版本', version, '三段或四段数字，每段 0 至 65535，例如 1.2.0。'),
    field('程序图标', icon, '只能用项目素材里的 PNG 或 ICO；PNG 须为 16 至 256 像素的正方形。'),
    field('导出位置', chooser),
    folderField,
  );

  const progressBox = h('section', 'game-export-progress'); progressBox.setAttribute('aria-label', '导出进度');
  const phases = h('ol', 'game-export-phases');
  progressBox.append(phases, h('small', undefined, '按阶段显示进度，不代表剩余时间。'));

  const resultBox = h('section', 'game-export-result');
  const resultFacts = h('dl', 'game-export-facts');
  const show = h('button', 'v4-button', '在文件夹中显示'); show.type = 'button';
  show.onclick = () => { void exporter.showResult(); };
  const again = h('button', 'v4-button', '再导出一份'); again.type = 'button';
  again.onclick = () => exporter.again();
  resultBox.append(resultFacts, show, again);

  const footer = h('footer');
  const blocker = h('small', 'game-export-blocker');
  const cancel = h('button', 'v4-button', '取消导出'); cancel.type = 'button';
  cancel.onclick = () => { void exporter.cancel(); };
  const run = h('button', 'v4-button v4-primary', '导出'); run.type = 'button';
  run.onclick = () => { void exporter.exportGame(); };
  footer.append(blocker, cancel, run);
  form.onsubmit = event => { event.preventDefault(); void exporter.exportGame(); };

  // Progress and the result sit at the top, where they stay in view without scrolling past the form.
  dialog.append(header, intro, status, progressBox, resultBox, drafts, unavailable, identity, issuesBox, pluginsBox, form, footer);
  // Escape cannot close the dialog while the export runs or settles.
  dialog.addEventListener('cancel', event => { if (!exporter.canClose()) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); onClosed(); });

  let shownInspection: ExportGameInspection | null = null;
  let shownStage: GameExportState['stage'] | null = null;
  const renderInspection = (inspection: ExportGameInspection): void => {
    identity.replaceChildren(document.createTextNode('作品身份 '), h('code', undefined, inspection.id),
      document.createTextNode('：决定玩家存档存放的位置。改标题、版本或文件夹都不会改变它，这里也不能修改。'));
    const errors = inspection.issues.filter(issue => issue.severity === 'error'), others = inspection.issues.filter(issue => issue.severity !== 'error');
    issuesBox.replaceChildren(h('h3', undefined, inspection.issues.length ? `检查结果：${errors.length} 个错误，${others.length} 条提示` : '检查结果'));
    if (inspection.issues.length === 0) issuesBox.append(h('p', undefined, '没有发现问题。'));
    else {
      issuesBox.append(h('p', 'game-export-note', errors.length ? '有错误时不能导出；提示不阻止导出，但请确认。' : '这些提示不阻止导出，但请确认。'));
      const list = h('ul', 'game-export-issue-list');
      for (const issue of [...errors, ...others]) {
        const item = h('li', `game-export-issue game-export-issue--${issue.severity === 'error' ? 'error' : 'warning'}`);
        item.dataset.issueCode = issue.code;
        const file = projectRelativeFile(issue.file);
        const where = h('code', undefined, issue.line > 0 ? `${file}:${issue.line}:${issue.col}` : file);
        where.title = issue.file;
        const detail = h('small');
        detail.append(where, ...(issue.hint ? [document.createTextNode(` · ${issue.hint}`)] : []));
        item.append(h('strong', undefined, issue.severity === 'error' ? '错误' : '提示'), h('span', undefined, issueMessage(issue)), detail);
        list.append(item);
      }
      issuesBox.append(list);
    }
    pluginsBox.replaceChildren();
    pluginsBox.hidden = inspection.plugins.length === 0;
    if (inspection.plugins.length) {
      pluginsBox.append(h('h3', undefined, `项目插件（${inspection.plugins.length}）`),
        h('p', 'game-export-note', '插件代码会随游戏一起发给玩家，在玩家电脑上运行。作品配置里的声明不算同意，请逐个确认；'
          + '导出时只检查和转换插件代码，不执行它。这里的确认只用于这一次导出，与试玩页的确认互不相通。'));
      for (const plugin of inspection.plugins) {
        const row = h('label', 'game-export-plugin');
        const box = h('input'); box.type = 'checkbox';
        box.setAttribute('aria-label', `允许把插件 ${plugin.id} 打包进游戏`);
        box.dataset.pluginId = plugin.id;
        box.onchange = () => exporter.setAllowed(plugin.id, box.checked);
        row.append(box, h('span', undefined, `允许把插件 ${plugin.id} 打包进游戏`), h('code', undefined, plugin.entry));
        pluginsBox.append(row);
      }
    }
    title.value = exporter.state.title;
    version.value = exporter.state.version;
    folder.value = exporter.state.folderName;
  };

  const refresh = (): void => {
    const state = exporter.state;
    const exporting = state.stage === 'exporting' || state.stage === 'cancelling';
    // Progress and the result are at the top; bring them into view when they appear.
    if (state.stage !== shownStage && (state.stage === 'exporting' || state.stage === 'done')) dialog.scrollTop = 0;
    shownStage = state.stage;
    status.textContent = state.message?.text ?? '';
    status.dataset.tone = state.message?.tone ?? '';
    close.disabled = !exporter.canClose();
    drafts.hidden = state.stage !== 'drafts' && state.stage !== 'saving';
    save.disabled = state.stage === 'saving';
    unavailable.hidden = state.stage !== 'unavailable';
    const inspected = state.inspection !== null && !['drafts', 'saving', 'inspecting', 'unavailable'].includes(state.stage);
    for (const part of [identity, issuesBox, form]) part.hidden = !inspected || state.stage === 'done';
    pluginsBox.hidden = !inspected || state.stage === 'done' || (state.inspection?.plugins.length ?? 0) === 0;
    if (inspected && state.inspection !== shownInspection) { shownInspection = state.inspection; renderInspection(state.inspection!); }
    for (const box of pluginsBox.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.checked = state.allowed.has(box.dataset.pluginId!);
      box.disabled = exporting;
    }
    for (const control of [title, version, icon, folder]) control.disabled = exporting;
    if (icon.value !== state.icon) icon.value = state.icon;
    choose.disabled = exporting || state.choosing;
    where.textContent = state.location?.location ?? '尚未选择';
    target.textContent = state.location && state.folderName.trim() ? `将新建：${targetPreview(state.location, state.folderName)}（已有同名文件夹时不会覆盖）` : '';
    progressBox.hidden = !exporting;
    if (exporting) {
      const current = EXPORT_PHASES.findIndex(item => item.phase === state.progress?.phase);
      phases.replaceChildren(...EXPORT_PHASES.map((item, index) => {
        const row = h('li', undefined, item.label);
        row.dataset.phaseState = current === -1 ? (index === 0 ? 'current' : 'waiting') : index < current ? 'done' : index === current ? 'current' : 'waiting';
        if (index === current && state.progress && state.progress.total > 1) row.append(h('small', undefined, ` ${state.progress.completed}/${state.progress.total}`));
        if (row.dataset.phaseState === 'current') row.setAttribute('aria-current', 'step');
        return row;
      }));
    }
    resultBox.hidden = state.stage !== 'done';
    if (state.result) {
      resultFacts.replaceChildren(h('dt', undefined, '游戏'), h('dd', undefined, `${state.result.title} ${state.result.version}`),
        h('dt', undefined, '作品身份'), h('dd', undefined, state.result.id),
        h('dt', undefined, '文件夹'), h('dd', undefined, state.result.directory),
        h('dt', undefined, '程序'), h('dd', undefined, state.result.executable));
    }
    const reason = state.stage === 'form' ? exporter.blocker() : null;
    blocker.textContent = reason ?? '';
    cancel.hidden = !exporting;
    cancel.disabled = state.stage === 'cancelling';
    run.hidden = state.stage !== 'form' && !exporting;
    run.disabled = state.stage !== 'form' || reason !== null;
    run.textContent = exporting ? '正在导出…' : '导出';
  };
  refresh();
  return { dialog, refresh };
}
