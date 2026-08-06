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
  const list = h('div', 'scene-list');
  for (const [id, sc] of state.scenes) {
    // UI 第二阶段：场景卡片化（卡底 + 未保存点 + 字数徽章）
    const item = h('div', 'scene-item' + (id === state.current ? ' active' : ''));
    item.appendChild(h('span', 'scene-name', id));
    if (sc.dirty) item.appendChild(h('span', 'dirty', '●'));
    item.appendChild(h('span', 'scene-meta', `${sc.text.replace(/\s+/g, '').length} 字`));
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

/** 新建场景模板（M6 E5-4）：带注释的 .gal 片段，{id} 占位替换为场景 ID */
const SCENE_TEMPLATES: { name: string; body: string }[] = [
  { name: '空白', body: '@scene {id}\n凛：' },
  {
    name: '纯对话',
    body: '@scene {id}\n@bg 背景key\n@bgm 音乐key\n凛：……\n主角：……\n',
  },
  {
    name: '选择分支',
    body: '@scene {id}\n凛：……\n@choice\n  选项A -> @goto a\n  选项B -> @goto b\n@label a\n凛：A 线。\n@jump 下一场景\n@label b\n凛：B 线。\n@jump 下一场景\n',
  },
  {
    name: '演出制作',
    body: '@scene {id}\n@bg 背景key\n@bgm 音乐key\n@shake 400 8\n@flash 250\n@wait 500\n凛：……\n',
  },
  {
    name: '结局',
    body: '@scene {id}\n凛：……\n@clear\n@end\n',
  },
];

export function newScene(): void {
  const name = window.prompt('新场景 ID（文件名，不含 .gal）');
  if (!name || name.trim().length === 0) return;
  const id = name.trim();
  if (state.scenes.has(id)) {
    setStatus(`场景 '${id}' 已存在`, false);
    return;
  }
  const tplChoice = window.prompt('选择模板：0 空白 / 1 纯对话 / 2 选择分支 / 3 演出制作 / 4 结局（取消 = 空白）');
  const idx = tplChoice === null ? 0 : Number(tplChoice.trim());
  const tpl = Number.isInteger(idx) && idx >= 0 && idx < SCENE_TEMPLATES.length ? SCENE_TEMPLATES[idx]! : SCENE_TEMPLATES[0]!;
  state.scenes.set(id, {
    id,
    file: `${id}.gal`,
    text: tpl.body.replace(/\{id\}/g, id),
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
