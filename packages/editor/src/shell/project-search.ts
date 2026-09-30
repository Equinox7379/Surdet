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

/** Navigation only: search reads the same in-memory documents being edited. */
export function openProjectSearch(actions: SearchActions): void {
  if (activeDialog?.isConnected) { activeDialog.querySelector('input')?.focus(); return; }
  if (document.querySelector('dialog[open]')) return;
  const trigger = document.activeElement as HTMLElement | null;
  const dialog = h('dialog', 'project-search-dialog');
  activeDialog = dialog;
  dialog.setAttribute('aria-label', '搜索项目');
  const header = h('div', 'project-search-header');
  const input = h('input'); input.type = 'search'; input.placeholder = '搜索场景、正文、时间轴或工作区';
  input.setAttribute('aria-label', '搜索场景、正文、时间轴或工作区');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'project-search-results');
  input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
  const close = h('button', undefined, '关闭'); close.type = 'button'; close.setAttribute('aria-label', '关闭搜索');
  const results = h('div', 'project-search-results'); results.id = 'project-search-results'; results.setAttribute('role', 'listbox');
  const footer = h('div', 'project-search-footer', '↑ ↓ 选择　回车打开');
  footer.setAttribute('role', 'status');
  let entries: Array<{ title: string; location: string; icon: string; open(): void }> = [];
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
    navigating = true; dismiss();
    try { entry.open(); } catch (error) { setStatus(error instanceof Error ? error.message : String(error), false, 5000); }
  };
  const highlight = (): void => {
    for (const [index, row] of [...results.children].entries()) row.setAttribute('aria-selected', String(index === selected));
    const row = results.children[selected] as HTMLElement | undefined;
    if (row) { input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const render = (): void => {
    const query = input.value.trim(); const needle = query.toLocaleLowerCase();
    const includes = (text: string): boolean => text.toLocaleLowerCase().includes(needle);
    entries = [];
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
    entries = entries.slice(0, 70); selected = 0; results.replaceChildren();
    for (const [index, entry] of entries.entries()) {
      const row = h('div', 'project-search-result'); row.id = `project-search-result-${index}`; row.setAttribute('role', 'option');
      const label = h('span'); label.append(h('strong', undefined, entry.title), h('small', undefined, entry.location));
      row.append(workbenchIcon(entry.icon), label); row.onclick = () => activate(index); results.append(row);
    }
    footer.textContent = entries.length ? `↑ ↓ 选择　Enter 打开　·　${entries.length} 项结果` : '没有匹配内容，试试场景名或一句台词。';
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
