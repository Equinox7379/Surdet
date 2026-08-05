/**
 * 侧栏（E0 拆分；E2 增加场景/素材标签页）。
 */
import { state, h, setStatus } from '../state.js';
import { renderAssetsPanel } from './assets.js';

export function renderSidebar(): void {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';
  // 侧栏标签页：场景 | 素材（E2）
  const tabs = h('div', 'side-tabs');
  const defs: { id: 'scenes' | 'assets'; label: string }[] = [
    { id: 'scenes', label: `场景（${state.scenes.size}）` },
    { id: 'assets', label: '素材' },
  ];
  for (const d of defs) {
    const btn = h('button', d.id === state.sidebarTab ? 'tab active' : 'tab', d.label);
    btn.onclick = () => { state.sidebarTab = d.id; renderSidebar(); };
    tabs.appendChild(btn);
  }
  sidebar.appendChild(tabs);
  if (state.sidebarTab === 'assets') {
    renderAssetsPanel(sidebar);
    return;
  }
  const newBtn = h('button', undefined, '＋ 新建场景');
  newBtn.onclick = newScene;
  sidebar.appendChild(newBtn);
  const list = h('div');
  for (const [id, sc] of state.scenes) {
    const item = h('div', 'scene-item' + (id === state.current ? ' active' : ''));
    item.appendChild(h('span', undefined, id));
    if (sc.dirty) item.appendChild(h('span', 'dirty', '●'));
    item.onclick = () => { state.current = id; renderSidebar(); renderEditorHook(); };
    list.appendChild(item);
  }
  sidebar.appendChild(list);
}

/** 编辑器刷新钩子（main.ts 注入，避免 panels 互相成环） */
let renderEditorHook: () => void = () => {};
export function bindSidebarHooks(opts: { renderEditor: () => void }): void {
  renderEditorHook = opts.renderEditor;
}

export function newScene(): void {
  const name = window.prompt('新场景 ID（文件名，不含 .gal）');
  if (!name || name.trim().length === 0) return;
  const id = name.trim();
  if (state.scenes.has(id)) {
    setStatus(`场景 '${id}' 已存在`, false);
    return;
  }
  state.scenes.set(id, {
    id,
    file: `${id}.gal`,
    text: `@scene ${id}\n凛：`,
    eol: '\n',
    dirty: true,
    handle: null,
  });
  state.current = id;
  renderAllHook();
}

/** 全量重渲染钩子（main.ts 注入） */
let renderAllHook: () => void = () => {};
export function bindSidebarRenderAll(fn: () => void): void {
  renderAllHook = fn;
}
