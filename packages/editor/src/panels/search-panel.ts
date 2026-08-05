/**
 * 搜索面板（M6 E5-1，UI）：跨场景搜索/替换。
 * 替换走 history（setSceneText 独立撤销点，每场景一个撤销点），替换后重调度校验。
 */
import { state, h, setStatus } from '../state.js';
import { searchScenes, replaceInSceneText } from '../search.js';
import type { SearchResult } from '../search.js';
import { setSceneText } from '../history.js';
import { renderSidebar } from './sidebar.js';
import { renderEditor } from './editor.js';

/** 跳转钩子由 main.ts 注入（切场景 + 滚动到行） */
let onJumpHook: (sceneKey: string, line: number) => void = () => {};
let onEditedHook: () => void = () => {};
export function bindSearchHooks(opts: { onJump: (sceneKey: string, line: number) => void; onEdited: () => void }): void {
  onJumpHook = opts.onJump;
  onEditedHook = opts.onEdited;
}

function sceneEntries(): { key: string; id: string; text: string }[] {
  return [...state.scenes.entries()].map(([key, sc]) => ({ key, id: sc.id, text: sc.text }));
}

export function renderSearchPanel(container: HTMLElement): void {
  container.innerHTML = '';
  const bar = h('div', 'search-bar');

  const queryInput = h('input', 'search-input');
  queryInput.placeholder = '搜索（Ctrl+F 聚焦）';
  queryInput.id = 'search-input';
  bar.appendChild(queryInput);

  const regexWrap = h('label', 'search-regex');
  const regexChk = h('input');
  regexChk.type = 'checkbox';
  regexWrap.append(regexChk, document.createTextNode(' 正则'));
  bar.appendChild(regexWrap);

  const replaceInput = h('input', 'search-input');
  replaceInput.placeholder = '替换为（可空）';
  bar.appendChild(replaceInput);

  const searchBtn = h('button', undefined, '搜索');
  const replaceBtn = h('button', undefined, '全部替换');
  bar.append(searchBtn, replaceBtn);
  container.appendChild(bar);

  const results = h('div', 'search-results');
  container.appendChild(results);

  const doSearch = (): SearchResult[] => {
    const q = queryInput.value;
    results.innerHTML = '';
    if (q.length === 0) return [];
    const found = searchScenes(sceneEntries(), q, regexChk.checked);
    if (found.length === 0) {
      results.appendChild(h('div', 'empty', `无匹配：${q}`));
      return [];
    }
    for (const r of found.slice(0, 200)) {
      const item = h('div', 'search-item');
      const loc = h('span', 'dim', `${r.sceneId}:${r.line + 1}`);
      const txt = h('span', undefined, r.text.length > 60 ? r.text.slice(0, 59) + '…' : r.text);
      item.append(loc, txt);
      item.onclick = () => onJumpHook(r.sceneKey, r.line);
      results.appendChild(item);
    }
    if (found.length > 200) results.appendChild(h('div', 'dim', `…共 ${found.length} 条，仅显示前 200`));
    setStatus(`搜索到 ${found.length} 处匹配`, true, 2500);
    return found;
  };

  searchBtn.onclick = () => { void doSearch(); };
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doSearch();
  });

  replaceBtn.onclick = () => {
    const q = queryInput.value;
    if (q.length === 0) return;
    let total = 0;
    let touchedScenes = 0;
    for (const sc of sceneEntries()) {
      const r = replaceInSceneText(sc.text, q, replaceInput.value, regexChk.checked);
      if (!r) {
        setStatus('替换失败：正则表达式非法', false, 4000);
        return;
      }
      if (r.count > 0) {
        setSceneText(sc.key, r.text); // 每场景一个独立撤销点
        total += r.count;
        touchedScenes++;
      }
    }
    if (total > 0) {
      onEditedHook(); // 重新调度校验
      renderSidebar();
      renderEditor();
      setStatus(`已替换 ${total} 处（${touchedScenes} 个场景，可 Ctrl+Z 逐场景撤销）`, true, 5000);
      results.innerHTML = '';
    } else {
      setStatus('无匹配，未替换', true, 2500);
    }
  };
}

/** 聚焦搜索框（Ctrl+F 用） */
export function focusSearchInput(): void {
  const el = document.getElementById('search-input') as HTMLInputElement | null;
  el?.focus();
}
