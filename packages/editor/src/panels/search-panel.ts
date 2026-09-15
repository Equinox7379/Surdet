/** Search UI only. Documents and replacements keep the shared search/history paths. */
import { state, h, setStatus, type SceneEntry } from '../state.js';
import { buildMatcher, searchScenes, replaceInSceneText, type SearchResult } from '../search.js';
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
  return { query: '', replacement: '', regex: false, scope: 'project', expanded: false, replaceExpanded: false,
    active: null as Pick<SearchResult, 'sceneKey' | 'line'> | null };
}
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
  const scope = h('select'); scope.setAttribute('aria-label', '查找范围');
  for (const [value, label] of [['project', '整个项目'], ['scene', '当前场景']] as const) {
    const option = h('option', undefined, label); option.value = value; scope.append(option);
  }
  scope.value = view.scope;
  const regexLabel = h('label', 'search-regex');
  regexLabel.title = '按正文行匹配：^ 为行首，$ 为行尾，不跨行';
  const regex = h('input'); regex.type = 'checkbox'; regex.checked = view.regex;
  regexLabel.append(regex, document.createTextNode('正则'));
  const replaceToggle = button('替换', '展开或收起替换', () => {
    view.replaceExpanded = !view.replaceExpanded; updateReplacement();
    if (view.replaceExpanded) replacement.focus();
  });
  replaceToggle.setAttribute('aria-controls', 'search-replacement');
  const count = h('span', 'search-count'); count.setAttribute('role', 'status');
  options.append(scope, regexLabel, replaceToggle, count);
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
    replace.title = `${replace.textContent}中的全部匹配，可在各场景撤销`;
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
    const matches = matcher ? searchScenes(sceneEntries(), view.query, view.regex, 501) : [];
    found = matches.slice(0, 200);
    snapshots = new Map([...state.scenes].map(([key, scene]) => [key, { scene, text: scene.text }]));
    results.replaceChildren();
    const selected = found.findIndex(match => match.sceneKey === view.active?.sceneKey && match.line === view.active.line);
    previous.disabled = next.disabled = found.length === 0;
    replace.disabled = view.query.length === 0 || matcher === null || !allowedToEdit(container) || state.reviewPreviewReadOnly;
    count.textContent = !view.query ? 'Enter 定位' : !matcher ? '正则表达式无效'
      : selected < 0 ? matches.length > 200 ? '显示前 200 行' : `${matches.length} 行匹配`
      : `${selected + 1} / ${matches.length > 200 ? '前 200' : matches.length} 行`;
    if (view.query && matcher && !found.length) results.append(h('p', 'search-empty', '没有匹配的正文。'));
    for (const [index, match] of found.entries()) {
      const item = button('', `${match.sceneId}，第 ${match.line + 1} 行：${match.text}`, () => activate(index, false));
      item.className = 'search-item'; item.setAttribute('aria-current', String(index === selected));
      const scene = state.scenes.get(match.sceneKey)!;
      item.append(h('span', 'search-location', `${scene.file} · ${match.line + 1}${scene.dirty ? ' · 未保存' : ''}`));
      const excerpt = h('span', 'search-excerpt');
      const matchText = buildMatcher(view.query, view.regex)!.exec(match.text);
      const start = matchText?.index ?? 0, length = matchText?.[0].length ?? 0;
      const from = Math.max(0, start - 28), to = Math.min(match.text.length, Math.max(start + length, from + 100));
      excerpt.append(document.createTextNode((from ? '…' : '') + match.text.slice(from, start)));
      excerpt.append(length ? h('mark', undefined, match.text.slice(start, start + length)) : document.createTextNode(''));
      excerpt.append(document.createTextNode(match.text.slice(start + length, to) + (to < match.text.length ? '…' : '')));
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
    // Use current documents, the selected scope and existing per-scene undo points.
    let total = 0, touched = 0;
    for (const scene of sceneEntries()) {
      const result = replaceInSceneText(scene.text, view.query, view.replacement, view.regex);
      if (!result) { refresh(); return; }
      if (result.count && result.text !== scene.text) {
        setSceneText(scene.key, result.text); total += result.count; touched++;
      }
    }
    if (total) {
      onEditedHook(); renderSidebar(); renderEditor();
      setStatus(`已替换 ${total} 处（${touched} 个场景，可逐场景撤销；尚未保存）`, true, 5000);
    } else setStatus('没有需要替换的内容', true, 2500);
    view.active = null; refresh();
  }
  query.oninput = () => { if (usable(query)) { view.query = query.value; view.active = null; refresh(); } };
  replacement.oninput = () => { if (usable(replacement)) view.replacement = replacement.value; };
  regex.onchange = () => { if (usable(regex)) { view.regex = regex.checked; view.active = null; refresh(); } };
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
