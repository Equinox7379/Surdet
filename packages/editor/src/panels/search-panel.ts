/** Search UI only. Documents and replacements keep the shared search/history paths. */
import { state, h, setStatus, type SceneEntry } from '../state.js';
import { buildMatcher, searchScenes, previewSceneReplacement, type SearchMode, type SearchResult } from '../search.js';
import { setSceneText } from '../history.js';
import { renderSidebar } from './sidebar.js';
import { renderEditor } from './editor.js';
import { allowedToEdit } from '../v4/ui.js';

let onJumpHook: (sceneKey: string, line: number) => void = () => {};
let onEditedHook: () => void = () => {};
export function bindSearchHooks(opts: { onJump: (sceneKey: string, line: number) => void; onEdited: () => void }): void {
  onJumpHook = opts.onJump; onEditedHook = opts.onEdited;
}

function initialView() {
  return { query: '', replacement: '', regex: false, scope: 'project', mode: 'visible' as SearchMode, expanded: false, replaceExpanded: false,
    active: null as Pick<SearchResult, 'sceneKey' | 'line'> | null };
}
const MODES: Record<SearchMode, { label: string; title: string; placeholder: string; empty: string }> = {
  visible: { label: '显示文字', title: '只查对白和选项文字，按玩家看到的文字匹配，可跨过样式标签；替换只写入文字。',
    placeholder: '查找对白和选项文字', empty: '没有匹配的对白或选项文字。要查说话人、指令、条件、跳转或标签，请改为按原文查找。' },
  source: { label: '原文（含标签）', title: '逐行查剧本原文，包括标签、说话人、指令、条件和跳转；替换按原样写入，会让对白或选项标签出错的行不替换。',
    placeholder: '查找剧本原文', empty: '没有匹配的原文。' },
};
let searchView = initialView();
/** Called only when a project is actually adopted, not on a failed open. */
export function resetSearchSession(): void { searchView = initialView(); }

export function renderSearchPanel(container: HTMLElement): void {
  const view = searchView;
  const current = (): boolean => container.isConnected && searchView === view;
  const usable = (node: HTMLElement): boolean => current() && node.isConnected && container.contains(node) && !node.closest('[inert]');
  container.replaceChildren();
  const drawer = container.closest<HTMLDetailsElement>('.authoring-search-drawer');
  const summary = drawer?.querySelector<HTMLElement>('summary');
  if (drawer) {
    drawer.open = view.expanded;
    drawer.ontoggle = () => {
      if (!current()) return;
      view.expanded = drawer.open;
      if (drawer.open && document.activeElement === summary) query.focus();
    };
  }
  const button = (label: string, name: string, action: () => void): HTMLButtonElement => {
    const item = h('button', 'search-control', label); item.type = 'button';
    item.setAttribute('aria-label', name); item.title = name;
    item.onclick = () => { if (usable(item)) action(); };
    return item;
  };
  const bar = h('div', 'search-query-row');
  const query = h('input', 'search-input'); query.type = 'search'; query.id = 'search-input';
  query.placeholder = '查找正文'; query.setAttribute('aria-label', '查找正文'); query.value = view.query;
  const previous = button('↑', '上一个匹配行（Shift+Enter）', () => navigate(-1, true));
  const next = button('↓', '下一个匹配行（Enter）', () => navigate(1, true));
  const dismiss = (): void => {
    view.expanded = false;
    if (drawer) { drawer.open = false; summary?.focus(); }
  };
  bar.append(query, previous, next, button('×', '关闭查找（Esc）', dismiss));

  const options = h('div', 'search-options');
  const mode = h('select'); mode.setAttribute('aria-label', '查找方式');
  for (const value of ['visible', 'source'] as const) {
    const option = h('option', undefined, MODES[value].label); option.value = value; option.title = MODES[value].title; mode.append(option);
  }
  mode.value = view.mode;
  const scope = h('select'); scope.setAttribute('aria-label', '查找范围');
  for (const [value, label] of [['project', '整个项目'], ['scene', '当前场景']] as const) {
    const option = h('option', undefined, label); option.value = value; scope.append(option);
  }
  scope.value = view.scope;
  const regexLabel = h('label', 'search-regex');
  const regex = h('input'); regex.type = 'checkbox'; regex.checked = view.regex;
  regexLabel.append(regex, document.createTextNode('正则'));
  const replaceToggle = button('替换', '展开或收起替换', () => {
    view.replaceExpanded = !view.replaceExpanded; updateReplacement();
    if (view.replaceExpanded) replacement.focus();
  });
  replaceToggle.setAttribute('aria-controls', 'search-replacement');
  const count = h('span', 'search-count'); count.setAttribute('role', 'status');
  options.append(mode, scope, regexLabel, replaceToggle, count);
  const replacementRow = h('div', 'search-replacement'); replacementRow.id = 'search-replacement';
  const replacement = h('input', 'search-input'); replacement.placeholder = '替换为（可空）';
  replacement.setAttribute('aria-label', '替换为（可空）'); replacement.value = view.replacement;
  const replace = button('替换整个项目', '替换整个项目', replaceAll);
  replacementRow.append(replacement, replace);
  const updateReplacement = (): void => {
    replacementRow.hidden = !view.replaceExpanded;
    replaceToggle.setAttribute('aria-expanded', String(view.replaceExpanded));
    replace.textContent = view.scope === 'scene' ? '替换当前场景' : '替换整个项目';
    replace.setAttribute('aria-label', replace.textContent);
    replace.title = `${replace.textContent}：先查看差异，确认后可在各场景撤销`;
  };
  const results = h('div', 'search-results'); results.setAttribute('role', 'region'); results.setAttribute('aria-label', '查找结果');
  container.append(bar, options, replacementRow, results);
  let found: SearchResult[] = [];
  let snapshots = new Map<string, { scene: SceneEntry; text: string }>();
  const sceneEntries = () => [...state.scenes].filter(([key]) => view.scope === 'project' || key === state.current)
    .map(([key, scene]) => ({ key, id: scene.id, text: scene.text }));
  const refresh = (): void => {
    if (!current()) return;
    const matcher = buildMatcher(view.query, view.regex);
    query.setAttribute('aria-invalid', String(matcher === null));
    query.placeholder = MODES[view.mode].placeholder;
    mode.title = MODES[view.mode].title;
    regexLabel.title = view.mode === 'visible' ? '按每句对白或选项文字匹配：^ 为文字开头，$ 为结尾' : '按原文行匹配：^ 为行首，$ 为行尾，不跨行';
    const matches = matcher ? searchScenes(sceneEntries(), view.query, view.regex, view.mode, 501) : [];
    found = matches.slice(0, 200);
    snapshots = new Map([...state.scenes].map(([key, scene]) => [key, { scene, text: scene.text }]));
    results.replaceChildren();
    const selected = found.findIndex(match => match.sceneKey === view.active?.sceneKey && match.line === view.active.line);
    previous.disabled = next.disabled = found.length === 0;
    replace.disabled = view.query.length === 0 || matcher === null || !allowedToEdit(container) || state.reviewPreviewReadOnly;
    count.textContent = !view.query ? 'Enter 定位' : !matcher ? '正则表达式无效'
      : selected < 0 ? matches.length > 200 ? '显示前 200 行' : `${matches.length} 行匹配`
      : `${selected + 1} / ${matches.length > 200 ? '前 200' : matches.length} 行`;
    if (view.query && matcher && !found.length) results.append(h('p', 'search-empty', MODES[view.mode].empty));
    for (const [index, match] of found.entries()) {
      const item = button('', `${match.sceneId}，第 ${match.line + 1} 行：${match.text}`, () => activate(index, false));
      item.className = 'search-item'; item.setAttribute('aria-current', String(index === selected));
      const scene = state.scenes.get(match.sceneKey)!;
      item.append(h('span', 'search-location', `${scene.file} · ${match.line + 1}${scene.dirty ? ' · 未保存' : ''}`));
      const excerpt = h('span', 'search-excerpt');
      // A match found only in the visible text (across style tags) is shown as the player reads it.
      const shown = match.visible?.text ?? match.text;
      const matchText = match.visible ? null : buildMatcher(view.query, view.regex)!.exec(match.text);
      const start = match.visible?.start ?? matchText?.index ?? 0;
      const length = match.visible ? match.visible.end - match.visible.start : matchText?.[0].length ?? 0;
      const from = Math.max(0, start - 28), to = Math.min(shown.length, Math.max(start + length, from + 100));
      excerpt.append(document.createTextNode((from ? '…' : '') + shown.slice(from, start)));
      excerpt.append(length ? h('mark', undefined, shown.slice(start, start + length)) : document.createTextNode(''));
      excerpt.append(document.createTextNode(shown.slice(start + length, to) + (to < shown.length ? '…' : '')));
      excerpt.title = !match.visible ? '按原文匹配' : match.visible.acrossTags ? '按显示文字匹配（跨过了样式标签）' : '按显示文字匹配';
      item.append(excerpt); results.append(item);
    }
    if (matches.length > 200) results.append(h('p', 'search-empty', matches.length > 500
      ? '超过 500 行匹配，仅列出前 200 行；可缩小查找范围。' : `共 ${matches.length} 行匹配，仅列出前 200 行。`));
    updateReplacement();
    const selectedItem = results.querySelector<HTMLElement>('[aria-current="true"]');
    if (selectedItem) {
      const viewport = results.getBoundingClientRect(), hit = selectedItem.getBoundingClientRect();
      if (hit.top < viewport.top) results.scrollTop += hit.top - viewport.top;
      else if (hit.bottom > viewport.bottom) results.scrollTop += hit.bottom - viewport.bottom;
    }
  };
  function activate(index: number, keepSearchFocus: boolean): void {
    if (!current()) return;
    const match = found[index]; if (!match) return;
    const snapshot = snapshots.get(match.sceneKey), scene = state.scenes.get(match.sceneKey);
    if (!snapshot || scene !== snapshot.scene || scene.text !== snapshot.text) {
      view.active = null; refresh(); setStatus('正文已变化，已更新查找结果，请重新选择', false, 5000); return;
    }
    view.active = { sceneKey: match.sceneKey, line: match.line }; view.expanded = true;
    onJumpHook(match.sceneKey, match.line);
    if (keepSearchFocus) document.getElementById('search-input')?.focus({ preventScroll: true });
  }
  function navigate(direction: number, keepSearchFocus: boolean): void {
    const selected = found.findIndex(match => match.sceneKey === view.active?.sceneKey && match.line === view.active.line);
    activate(selected < 0 ? direction > 0 ? 0 : found.length - 1 : (selected + direction + found.length) % found.length, keepSearchFocus);
  }
  function replaceAll(): void {
    if (!current() || !allowedToEdit(container) || state.reviewPreviewReadOnly || !view.query) return;
    if (container.querySelector('.search-replace-dialog')) return;
    const request = { query: view.query, replacement: view.replacement, regex: view.regex, scope: view.scope, mode: view.mode, current: state.current };
    // Include unchanged scoped documents, so adding/removing a scene cannot silently widen a preview.
    const originals = sceneEntries().map(scene => ({ ...scene, entry: state.scenes.get(scene.key)!, file: state.scenes.get(scene.key)!.file }));
    const previews = originals.map(scene => ({ ...scene, result: previewSceneReplacement(scene.text, request.query, request.replacement, request.regex, request.mode) }));
    const skipped = previews.reduce((sum, scene) => sum + (scene.result?.skipped ?? 0), 0);
    const refused = previews.reduce((sum, scene) => sum + (scene.result?.refused ?? 0), 0);
    const changes = previews.filter(scene => scene.result !== null && scene.result.changes.length > 0);
    const skippedNote = [
      skipped ? `另有 ${skipped} 处跨过或位于行内标签内，不能安全替换，已保持原样，请手动修改。` : '',
      refused ? `另有 ${refused} 行替换后会让对白或选项的标签出错，已保持原样，请手动修改。` : '',
    ].join('');
    if (!changes.length) { setStatus(skippedNote || '没有需要替换的内容', !skippedNote, skippedNote ? 6000 : 2500); refresh(); return; }
    const total = changes.reduce((sum, scene) => sum + scene.result!.changes.reduce((count, line) => count + line.count, 0), 0);
    const dialog = h('dialog', 'v4-insert-dialog search-replace-dialog'); dialog.setAttribute('aria-label', '替换预览');
    const summary = request.scope === 'scene' ? `当前场景 ${originals[0]?.file ?? ''}` : `整个项目（检查 ${originals.length} 个场景）`;
    dialog.append(h('h2', undefined, '替换预览'), h('p', undefined, `${summary}；将修改 ${changes.length} 个场景、${total} 处。确认后仅改变草稿，可逐场景撤销。`),
      h('p', undefined, `${request.regex ? '正则' : '查找'}（按${MODES[request.mode].label}）：${request.query} → ${request.replacement || '（清空）'}`));
    if (skippedNote) dialog.append(h('p', 'search-replace-skipped', skippedNote));
    for (const [index, scene] of changes.entries()) {
      const section = h('details'); section.open = index === 0;
      section.append(h('summary', undefined, `${scene.file} · ${scene.result!.changes.length} 行`));
      for (const line of scene.result!.changes) {
        const row = h('div'); row.dataset.replacementLine = String(line.line);
        row.append(h('p', undefined, `第 ${line.line + 1} 行`));
        for (const [label, text] of [['替换前', line.before], ['替换后', line.after]]) {
          const content = h('pre', undefined, text); content.setAttribute('aria-label', label!);
          content.style.whiteSpace = 'pre-wrap'; content.style.overflowWrap = 'anywhere';
          row.append(h('strong', undefined, label), content);
        }
        section.append(row);
      }
      dialog.append(section);
    }
    const message = h('p'); message.setAttribute('role', 'alert');
    const close = (): void => { dialog.close(); dialog.remove(); if (current()) replace.focus(); };
    const confirm = button('确认替换', '确认替换', () => {
      if (!allowedToEdit(container) || state.reviewPreviewReadOnly) { message.textContent = '当前项目不可编辑，请关闭预览后重试。'; return; }
      const latest = sceneEntries();
      const stale = request.query !== view.query || request.replacement !== view.replacement || request.regex !== view.regex || request.scope !== view.scope || request.mode !== view.mode
        || (request.scope === 'scene' && request.current !== state.current) || latest.length !== originals.length
        || originals.some((scene, index) => latest[index]?.key !== scene.key || state.scenes.get(scene.key) !== scene.entry
          || scene.entry.text !== scene.text || scene.entry.id !== scene.id || scene.entry.file !== scene.file);
      if (stale) { message.textContent = '正文、范围或替换条件已变化，请关闭后重新预览；本次未应用。'; confirm.disabled = true; return; }
      for (const scene of changes) setSceneText(scene.key, scene.result!.text);
      close();
      onEditedHook(); renderSidebar(); renderEditor();
      setStatus(`已替换 ${total} 处（${changes.length} 个场景，可逐场景撤销；尚未保存）${skipped ? `；${skipped} 处跨标签未替换` : ''}${refused ? `；${refused} 行会让标签出错未替换` : ''}`, true, 5000);
      view.active = null; refresh();
    });
    const footer = h('footer'); footer.append(button('取消', '取消替换', close), confirm);
    dialog.append(message, footer); container.append(dialog);
    dialog.oncancel = event => { event.preventDefault(); close(); };
    dialog.onkeydown = event => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault();
    };
    dialog.showModal();
  }
  query.oninput = () => { if (usable(query)) { view.query = query.value; view.active = null; refresh(); } };
  replacement.oninput = () => { if (usable(replacement)) view.replacement = replacement.value; };
  regex.onchange = () => { if (usable(regex)) { view.regex = regex.checked; view.active = null; refresh(); } };
  mode.onchange = () => { if (usable(mode)) { view.mode = mode.value as SearchMode; view.active = null; refresh(); } };
  scope.onchange = () => { if (usable(scope)) { view.scope = scope.value; view.active = null; refresh(); } };
  if (drawer) drawer.onkeydown = event => {
    if (current() && !drawer.closest('[inert]') && event.target === summary && !event.isComposing && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); dismiss();
    }
  };
  container.onkeydown = (event) => {
    if (!usable(container) || !(event.target instanceof Node) || !container.contains(event.target)) return;
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
      event.stopPropagation(); if (event.key.toLowerCase() === 's') event.preventDefault(); return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    else if (event.key === 'Enter' && event.target === query) {
      event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1, true);
    }
  };
  refresh();
}

export function focusSearchInput(): void {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const drawer = input?.closest<HTMLDetailsElement>('.authoring-search-drawer');
  searchView.expanded = true;
  if (drawer) drawer.open = true;
  input?.focus(); input?.select();
}
