import { h, state, setStatus } from '../state.js';
import { searchScenes } from '../search.js';
import { EDITOR_MODES, type EditorModeId } from './editor-modes.js';
import { workbenchIcon } from './icons.js';

interface SearchActions {
  onScene(key: string, line?: number): void;
  onMode(mode: EditorModeId): void;
  onTimeline(id: string): void;
}
let activeDialog: HTMLDialogElement | null = null;

/**
 * Command mode (query starting with >) runs the real on-page button, so its disabled
 * state, busy guards and draft protection apply exactly as for a pointer click.
 * A command with a mode is offered from other workspaces and navigates there first.
 */
interface PaletteCommand { label: string; selector: string; icon: string; mode?: EditorModeId; shortcut?: string; keywords?: string }
const COMMANDS: readonly PaletteCommand[] = [
  { label: '保存全部', selector: '[data-action="save-project"]', icon: 'save-project', shortcut: 'Ctrl+S', keywords: 'save' },
  { label: '撤销', selector: '[data-action="undo"]', icon: 'undo', shortcut: 'Ctrl+Z', keywords: 'undo' },
  { label: '重做', selector: '[data-action="redo"]', icon: 'redo', shortcut: 'Ctrl+Y', keywords: 'redo' },
  { label: '查看问题列表', selector: '[data-action="show-problems"]', icon: 'audit', shortcut: 'F8', keywords: '错误 警告 校验 problems' },
  { label: '打开项目…', selector: '[data-action="open-project"]', icon: 'open-project', keywords: 'open' },
  { label: '打开审阅任务', selector: '[data-action="open-review"]', icon: 'open-review', keywords: 'review' },
  { label: '加载演示项目', selector: '[data-action="load-demo"]', icon: 'folder', keywords: 'demo' },
  { label: '导出当前场景', selector: '[data-action="export-current"]', icon: 'blank', keywords: 'export gal' },
  { label: '导出 Windows 游戏…', selector: '[data-action="export-game"]', icon: 'blank', keywords: 'export windows exe 打包 发布' },
  { label: '查看外部改动范围', selector: '[data-action="view-project-changes"]', icon: 'history', keywords: '接力 同步' },
  { label: '同步项目', selector: '[data-action="sync-project"]', icon: 'history', keywords: '接力 sync' },
  { label: '新建场景', selector: '[data-action="create-scene"]', icon: 'editor', mode: 'editor', keywords: 'new scene' },
  { label: '导入剧本', selector: '[data-action="import-script"]', icon: 'editor', mode: 'editor', keywords: 'import csv' },
  { label: '添加剧情', selector: '[data-action="add-story-step"]', icon: 'editor', mode: 'editor', keywords: '插入 指令 insert' },
  { label: '在末尾追加台词', selector: '[data-action="append-dialogue-line"]', icon: 'editor', mode: 'editor', keywords: '对白' },
  { label: '导出 .gal', selector: '[data-action="download-scene"]', icon: 'blank', mode: 'editor', keywords: 'export download' },
  { label: '剧本视图：编排', selector: 'button[data-script-view="arrange"]', icon: 'editor', mode: 'editor' },
  { label: '剧本视图：稿件', selector: 'button[data-script-view="manuscript"]', icon: 'editor', mode: 'editor' },
  { label: '剧本视图：源码', selector: 'button[data-script-view="source"]', icon: 'editor', mode: 'editor', keywords: 'source' },
  { label: '重新播放预览', selector: '[data-action="reload-preview"]', icon: 'preview', mode: 'preview', keywords: 'play replay' },
  { label: '流程图：查看全图', selector: '[data-flow-action="fit-canvas"]', icon: 'flow', mode: 'flow', keywords: 'fit' },
  { label: '流程图：回到当前', selector: '[data-flow-action="focus-current"]', icon: 'flow', mode: 'flow' },
];

/** Navigation only: search reads the same in-memory documents being edited. */
export function openProjectSearch(actions: SearchActions): void {
  if (activeDialog?.isConnected) { activeDialog.querySelector('input')?.focus(); return; }
  if (document.querySelector('dialog[open]')) return;
  const trigger = document.activeElement as HTMLElement | null;
  const dialog = h('dialog', 'project-search-dialog');
  activeDialog = dialog;
  dialog.setAttribute('aria-label', '搜索项目');
  const header = h('div', 'project-search-header');
  const input = h('input'); input.type = 'search'; input.placeholder = '搜索场景、正文、时间轴或工作区；输入 > 执行命令';
  input.setAttribute('aria-label', '搜索场景、正文、时间轴或工作区');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'project-search-results');
  input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
  const close = h('button', undefined, '关闭'); close.type = 'button'; close.setAttribute('aria-label', '关闭搜索');
  const results = h('div', 'project-search-results'); results.id = 'project-search-results'; results.setAttribute('role', 'listbox');
  const footer = h('div', 'project-search-footer', '↑ ↓ 选择　回车打开');
  footer.setAttribute('role', 'status');
  let entries: Array<{ title: string; location: string; icon: string; unavailable?: string; open(): void }> = [];
  let selected = 0;
  let navigating = false;
  const dismiss = (): void => { dialog.close(); };
  close.onclick = dismiss;
  dialog.addEventListener('close', () => {
    dialog.remove(); if (activeDialog === dialog) activeDialog = null;
    if (!navigating && trigger?.isConnected) trigger.focus();
  }, { once: true });
  const activate = (index: number): void => {
    const entry = entries[index]; if (!entry) return;
    if (entry.unavailable) { footer.textContent = `「${entry.title}」当前不可用：${entry.unavailable}`; return; }
    navigating = true; dismiss();
    try { entry.open(); } catch (error) { setStatus(error instanceof Error ? error.message : String(error), false, 5000); }
  };
  const highlight = (): void => {
    for (const [index, row] of [...results.children].entries()) row.setAttribute('aria-selected', String(index === selected));
    const row = results.children[selected] as HTMLElement | undefined;
    if (row) { input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const runCommand = (command: PaletteCommand): void => {
    if (command.mode && state.mainTab !== command.mode) actions.onMode(command.mode);
    const target = document.querySelector<HTMLButtonElement>(command.selector);
    if (!target) throw new Error(`当前不能执行「${command.label}」`);
    if (target.disabled) throw new Error(`当前不能执行「${command.label}」`);
    target.click();
  };
  const commandEntries = (needle: string): typeof entries => {
    const list: typeof entries = [];
    const matches = (text: string): boolean => !needle || text.toLocaleLowerCase().includes(needle);
    for (const command of COMMANDS) {
      if (!matches(`${command.label} ${command.keywords ?? ''}`)) continue;
      const target = document.querySelector<HTMLButtonElement>(command.selector);
      // Offer a command only where its button is shown, or in another workspace that has it.
      if (target ? target.closest('[hidden]') !== null : !(command.mode && command.mode !== state.mainTab)) continue;
      // Command titles usually just repeat the label; only a specific title explains why.
      const reason = target?.title && !target.title.startsWith(command.label.replace('…', '')) ? target.title : '当前状态下不可用';
      const unavailable = target && (target.disabled || target.closest('[inert]')) ? reason : '';
      const where = !target && command.mode ? EDITOR_MODES.find((mode) => mode.id === command.mode)?.label : '';
      list.push({ title: command.label, icon: command.icon, unavailable: unavailable || undefined,
        location: unavailable ? `不可用 · ${unavailable}` : [where && `前往${where}`, command.shortcut].filter(Boolean).join(' · '),
        open: () => runCommand(command) });
    }
    for (const mode of EDITOR_MODES) if (matches(`${mode.label} ${mode.id}`)) {
      list.push({ title: `前往${mode.label}`, location: '工作区', icon: mode.id, open: () => actions.onMode(mode.id) });
    }
    return list;
  };
  const render = (): void => {
    const query = input.value.trim(); const needle = query.toLocaleLowerCase();
    const includes = (text: string): boolean => text.toLocaleLowerCase().includes(needle);
    entries = [];
    if (query.startsWith('>')) { entries = commandEntries(needle.slice(1).trim()); show(); return; }
    for (const [key, scene] of state.scenes) if (includes(`${scene.id} ${scene.file}`)) {
      entries.push({ title: scene.id, location: `场景 · ${scene.file}${scene.dirty ? ' · 未保存' : ''}`, icon: 'editor', open: () => {
        if (state.scenes.get(key) !== scene) throw new Error('项目已经变化，请重新搜索');
        actions.onScene(key);
      } });
      if (entries.length === 30) break;
    }
    for (const timeline of state.timelines) if (includes(`${timeline.id} ${timeline.file}`)) {
      entries.push({ title: timeline.id, location: `时间轴 · ${timeline.file}`, icon: 'timeline', open: () => {
        if (!state.timelines.includes(timeline)) throw new Error('项目已经变化，请重新搜索');
        actions.onTimeline(timeline.id);
      } });
      if (entries.length >= 40) break;
    }
    if (query) for (const match of searchScenes([...state.scenes].map(([key, scene]) => ({ key, id: scene.id, text: scene.text })), query, false, 40)) {
      const scene = state.scenes.get(match.sceneKey)!; const text = scene.text;
      entries.push({ title: match.text, location: `${scene.file} · 第 ${match.line + 1} 行`, icon: 'search', open: () => {
        if (state.scenes.get(match.sceneKey) !== scene || scene.text !== text) throw new Error('搜索后正文已变化，请重新搜索再定位');
        actions.onScene(match.sceneKey, match.line);
      } });
    }
    for (const mode of EDITOR_MODES) if (includes(mode.label)) entries.push({ title: mode.label, location: '打开工作区', icon: mode.id, open: () => actions.onMode(mode.id) });
    show();
  };
  const show = (): void => {
    const commands = input.value.trim().startsWith('>');
    entries = entries.slice(0, 70); selected = 0; results.replaceChildren();
    results.dataset.mode = commands ? 'commands' : 'search';
    for (const [index, entry] of entries.entries()) {
      const row = h('div', 'project-search-result'); row.id = `project-search-result-${index}`; row.setAttribute('role', 'option');
      if (entry.unavailable) row.setAttribute('aria-disabled', 'true');
      const label = h('span'); label.append(h('strong', undefined, entry.title), h('small', undefined, entry.location));
      row.append(workbenchIcon(entry.icon), label); row.onclick = () => activate(index); results.append(row);
    }
    footer.textContent = entries.length ? `↑ ↓ 选择　Enter ${commands ? '执行' : '打开'}　·　${entries.length} 项${commands ? '命令' : '结果'}`
      : commands ? '没有匹配的命令。' : '没有匹配内容，试试场景名或一句台词；输入 > 查看命令。';
    highlight();
  };
  input.oninput = render;
  dialog.addEventListener('keydown', (event) => {
    // Editing a search query must not save or undo the project underneath a modal.
    event.stopPropagation();
    if (event.isComposing || event.target !== input) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % Math.max(1, entries.length); highlight();
    } else if (event.key === 'Enter') { event.preventDefault(); activate(selected); }
  });
  header.append(workbenchIcon('search'), input, close); dialog.append(header, results, footer);
  document.body.append(dialog); dialog.showModal(); render(); input.focus();
}
