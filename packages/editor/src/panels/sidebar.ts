/**
 * 侧栏（E0 拆分；E2 增加场景/素材标签页）。
 */
import { state, h, setStatus, type SceneEntry } from '../state.js';
import { isSceneFilePathReserved, runProjectWriteOperation } from '../project-io.js';
import { renderAssetsPanel } from './assets.js';

export function renderSidebar(): void {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';
  const heading = h('div', 'outline-heading');
  heading.appendChild(h('h2', undefined, '项目内容'));
  sidebar.appendChild(heading);

  const tabs = h('div', 'side-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '目录类型');
  const defs: { id: 'scenes' | 'assets'; label: string }[] = [
    { id: 'scenes', label: `场景（${state.scenes.size}）` },
    { id: 'assets', label: '素材' },
  ];
  const activateTab = (id: 'scenes' | 'assets', focus = false): void => {
    state.sidebarTab = id;
    renderSidebar();
    if (focus) document.querySelector<HTMLElement>(`[data-sidebar-mode="${id}"]`)?.focus();
  };
  for (const [index, d] of defs.entries()) {
    const btn = h('button', d.id === state.sidebarTab ? 'tab active' : 'tab', d.label);
    btn.type = 'button';
    btn.tabIndex = d.id === state.sidebarTab ? 0 : -1;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-sidebar-mode', d.id);
    btn.setAttribute('aria-selected', String(d.id === state.sidebarTab));
    btn.setAttribute('aria-controls', d.id === 'scenes' ? 'scene-outline-list' : 'asset-catalog');
    btn.onclick = () => activateTab(d.id);
    btn.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? defs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + defs.length) % defs.length;
      activateTab(defs[nextIndex]!.id, true);
    };
    tabs.appendChild(btn);
  }
  sidebar.appendChild(tabs);
  if (state.sidebarTab === 'assets') {
    renderAssetsPanel(sidebar);
    return;
  }
  const newBtn = h('button', undefined, '＋ 新建场景');
  newBtn.type = 'button';
  newBtn.className = 'outline-new-scene';
  newBtn.setAttribute('data-action', 'create-scene');
  newBtn.onclick = () => { void newScene(); };
  sidebar.appendChild(newBtn);
  const list = h('div', 'scene-list');
  list.id = 'scene-outline-list';
  list.setAttribute('role', 'tabpanel');
  const groups = new Map<string, [string, SceneEntry][]>();
  for (const entry of state.scenes) {
    const directory = entry[0].split('/').slice(0, -1).join('/') || '项目场景';
    const group = groups.get(directory) ?? [];
    group.push(entry);
    groups.set(directory, group);
  }
  for (const [directory, scenes] of groups) {
    const group = h('section', 'scene-group');
    const groupHeading = h('h3', 'scene-group-heading', directory);
    groupHeading.title = directory;
    group.appendChild(groupHeading);
    for (const [id, sc] of scenes) {
      const selected = id === state.current;
      const row = h('div', 'scene-row');
      row.dataset.sceneKey = id;
      const item = h('button', 'scene-item' + (selected ? ' active' : ''));
      item.type = 'button';
      item.dataset.sceneId = id;
      item.setAttribute('aria-selected', String(selected));
      item.title = sc.file;
      const identity = h('span', 'scene-identity');
      identity.appendChild(h('span', 'scene-name', sc.id || id.split('/').pop() || id));
      if (sc.file !== `${sc.id}.gal`) identity.appendChild(h('span', 'scene-path', sc.file));
      item.appendChild(identity);
      const facts = h('span', 'scene-facts');
      if (selected) facts.appendChild(h('span', 'scene-current', '当前'));
      if (sc.dirty) facts.appendChild(h('span', 'dirty', '未保存'));
      facts.appendChild(h('span', 'scene-meta', `${sc.text.replace(/\s+/g, '').length} 字`));
      item.appendChild(facts);
      item.onclick = () => onSelectSceneHook(id);
      const actions = h('span', 'scene-row-actions');
      const rename = h('button', 'scene-row-action', '改名');
      rename.type = 'button';
      rename.dataset.action = 'rename-scene';
      rename.setAttribute('aria-label', `重命名场景 ${sc.file}`);
      rename.onclick = () => onRenameSceneHook(id);
      const move = h('button', 'scene-row-action', '移动');
      move.type = 'button';
      move.dataset.action = 'move-scene';
      move.setAttribute('aria-label', `移动场景 ${sc.file}`);
      move.onclick = () => onMoveSceneHook(id);
      const remove = h('button', 'scene-row-action', '删除');
      remove.type = 'button';
      remove.dataset.action = 'delete-scene';
      remove.setAttribute('aria-label', `删除场景 ${sc.file}`);
      remove.onclick = () => onDeleteSceneHook(id);
      actions.append(rename, move, remove);
      row.append(item, actions);
      group.appendChild(row);
    }
    list.appendChild(group);
  }
  sidebar.appendChild(list);
}

/** 场景导航钩子（main.ts 注入，确保所有跳转共享同一选择协调器）。 */
let onSelectSceneHook: (sceneKey: string) => void = () => {};
let onRenameSceneHook: (sceneKey: string) => void = () => {};
let onMoveSceneHook: (sceneKey: string) => void = () => {};
let onDeleteSceneHook: (sceneKey: string) => void = () => {};
export function bindSidebarHooks(opts: {
  onSelectScene: (sceneKey: string) => void;
  onRenameScene?: (sceneKey: string) => void;
  onMoveScene?: (sceneKey: string) => void;
  onDeleteScene?: (sceneKey: string) => void;
}): void {
  onSelectSceneHook = opts.onSelectScene;
  onRenameSceneHook = opts.onRenameScene ?? (() => {});
  onMoveSceneHook = opts.onMoveScene ?? (() => {});
  onDeleteSceneHook = opts.onDeleteScene ?? (() => {});
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

async function newSceneUnlocked(): Promise<void> {
  if (state.pendingSceneCommit !== null) {
    setStatus('上一次场景保存正在收束，请先重试“保存全部”', false, 6000);
    return;
  }
  const name = window.prompt('新场景 ID（文件名，不含 .gal）');
  if (!name || name.trim().length === 0) return;
  const id = name.trim();
  if (!/^[^\s.<>:"/\\|?*\u0000-\u001f]+$/u.test(id)) {
    setStatus('场景 ID 不能包含空格、点号或文件名保留字符', false, 5000);
    return;
  }
  if ([...state.scenes.values()].some((scene) => scene.id === id)) {
    setStatus(`场景 '${id}' 已存在`, false);
    return;
  }
  if (isSceneFilePathReserved(`${id}.gal`)) {
    setStatus('该场景文件正等待删除，请先保存全部', false, 5000);
    return;
  }
  const tplChoice = window.prompt('选择模板：0 空白 / 1 纯对话 / 2 选择分支 / 3 演出制作 / 4 结局（取消 = 空白）');
  const idx = tplChoice === null ? 0 : Number(tplChoice.trim());
  const tpl = Number.isInteger(idx) && idx >= 0 && idx < SCENE_TEMPLATES.length ? SCENE_TEMPLATES[idx]! : SCENE_TEMPLATES[0]!;
  const pendingCreateOperationId = [...state.scenes.values()].find((scene) => (
    scene.handle === null && !scene.persistedSha256 && scene.pendingCreateOperationId
  ))?.pendingCreateOperationId ?? crypto.randomUUID();
  state.scenes.set(id, {
    id,
    file: `${id}.gal`,
    text: tpl.body.replace(/\{id\}/g, id),
    eol: '\n',
    dirty: true,
    handle: null,
    pendingCreateOperationId,
  });
  onSelectSceneHook(id);
}

export async function newScene(): Promise<void> {
  await runProjectWriteOperation(newSceneUnlocked);
}
