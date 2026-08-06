/**
 * Surdet 可视化剧本编辑器入口（E0 拆分后：仅装配与事件路由）。
 * 功能：打开游戏目录（File System Access）→ 场景列表 → 块式可视化编辑（raw 行为事实来源，
 * 类型化控件为编辑糖）→ 实时校验（编译器即校验器 + 跨场景引用）→ 保存回目录。
 * 无 File System Access 的环境提供内存演示项目 + 下载导出兜底。
 *
 * 模块布局（E0）：
 *   state.ts        全局状态 + DOM 助手
 *   project-io.ts   项目读写（openProject/saveAll/演示项目）
 *   history.ts      撤销/重做（200 条上限 + 600ms 打字合并）
 *   panels/sidebar  场景列表　panels/editor 块编辑区　panels/issues 校验编排+结果　panels/right 变量/拓扑/引用
 */
import { state, h } from './state.js';
import { bindHistoryHooks, undo, redo } from './history.js';
import { bindProjectIoHooks, openProject, saveAll, exportCurrent, loadDemoProject } from './project-io.js';
import { renderSidebar, bindSidebarHooks, bindSidebarRenderAll } from './panels/sidebar.js';
import { renderEditor } from './panels/editor.js';
import { scheduleValidate, runValidate, renderIssues } from './panels/issues.js';
import { renderRightExtras } from './panels/right.js';
import { renderFlow, bindFlowHooks } from './panels/flow.js';
import { renderConfig, bindConfigHooks, configUndo, configRedo, addTerminologyVariant } from './panels/config.js';
import { renderPreviewPanel } from './panels/preview-panel.js';
import { renderStatsPanel } from './panels/stats-panel.js';
import { renderSearchPanel, bindSearchHooks, focusSearchInput } from './panels/search-panel.js';
import { renderAuditPanel, bindAuditHooks } from './panels/audit-panel.js';

/* ============================ 模块装配（钩子注入，保持无环） ============================ */

bindHistoryHooks({
  onEdited: scheduleValidate,
  onHistoryNav: () => { renderEditor(); renderSidebar(); },
});
bindProjectIoHooks({ renderAll, runValidate, renderSidebar });
bindSidebarHooks({ renderEditor });
bindSidebarRenderAll(renderAll);
bindFlowHooks({
  // 流程图导航：切回块编辑标签页并选中场景；双击标签节点时滚动到该 @label 行
  openScene: (sceneKey, line) => jumpToScene(sceneKey, line !== undefined ? Math.max(0, line - 1) : undefined),
  // 流程图结构变更（重命名/删除）后重新调度校验
  requestValidate: scheduleValidate,
});
bindConfigHooks({
  // 配置保存后重新调度校验（新变量/成就即刻参与 lint）
  requestValidate: scheduleValidate,
});

/** 跳转定位（流程图导航与搜索结果共用）：切块编辑标签页 + 选中场景 + 滚动到指定行 */
function jumpToScene(sceneKey: string, line?: number): void {
  state.mainTab = 'editor';
  state.current = sceneKey;
  renderMainArea();
  if (line !== undefined) {
    const target = document.querySelector(`.block[data-line="${Math.max(0, line)}"]`);
    target?.scrollIntoView({ block: 'center' });
    target?.classList.add('selected');
  }
}
bindSearchHooks({
  onJump: (sceneKey, line) => jumpToScene(sceneKey, line),
  onEdited: scheduleValidate,
});
bindAuditHooks({
  // 审计条目点击 → 跳转定位（与搜索/流程图导航同一入口）
  onJump: (sceneKey, line) => jumpToScene(sceneKey, line),
  // 称谓问题一键加变体 → 路由到配置页的 terminology 写盘入口（保持面板无环依赖）
  onAddVariant: (canonical, variant) => { void addTerminologyVariant(canonical, variant); },
});

/* ============================ 布局渲染 ============================ */

const appEl = document.getElementById('app')!;

function renderAll(): void {
  appEl.innerHTML = '';
  const header = h('header');
  header.appendChild(h('h1', undefined, 'Surdet 剧本编辑器'));
  header.appendChild(h('span', 'proj', state.dirName ? `项目：${state.dirName}` : '未打开项目'));
  header.appendChild(h('span', 'spacer'));
  if (state.fsSupported) {
    const openBtn = h('button', undefined, '打开游戏目录');
    openBtn.onclick = () => { void openProject(); };
    header.appendChild(openBtn);
  } else {
    const demoBtn = h('button', undefined, '加载演示项目');
    demoBtn.onclick = loadDemoProject;
    header.appendChild(demoBtn);
  }
  if (!state.fsSupported && state.scenes.size > 0) {
    const expBtn = h('button', undefined, '导出当前场景 .gal');
    expBtn.onclick = exportCurrent;
    header.appendChild(expBtn);
  }
  const undoBtn = h('button', undefined, '↩ 撤销 (Ctrl+Z)');
  undoBtn.onclick = doUndo;
  const redoBtn = h('button', undefined, '↪ 重做 (Ctrl+Y)');
  redoBtn.onclick = doRedo;
  header.appendChild(undoBtn);
  header.appendChild(redoBtn);
  const saveBtn = h('button', 'primary', '保存全部 (Ctrl+S)');
  saveBtn.onclick = () => { void saveAll(); };
  header.appendChild(saveBtn);
  header.appendChild(h('span', undefined, ''));
  const status = h('span', undefined, '');
  status.id = 'status';
  header.appendChild(status);
  appEl.appendChild(header);

  if (!state.fsSupported && state.scenes.size === 0) {
    const banner = h('div', 'banner');
    banner.textContent = '未检测到 File System Access 支持：请使用 Chrome/Edge 打开并点击「打开游戏目录」选择游戏项目根目录（如 examples/starter）；当前环境可先加载演示项目体验编辑与校验。';
    appEl.appendChild(banner);
  }

  const main = h('main');
  main.id = 'main';
  appEl.appendChild(main);
  renderMainArea();
}

/** 主区：标签页（块编辑 / 流程图 / 配置 / 预览 / 统计 / 审计）+ 对应内容 */
function renderMainArea(): void {
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '';
  const col = h('div', 'main-col');
  const tabs = h('div', 'tabs');
  const defs: { id: 'editor' | 'flow' | 'config' | 'preview' | 'stats' | 'audit'; label: string }[] = [
    { id: 'editor', label: '块编辑' },
    { id: 'flow', label: '流程图' },
    { id: 'config', label: '配置' },
    { id: 'preview', label: '预览' },
    { id: 'stats', label: '统计' },
    { id: 'audit', label: '审计' },
  ];
  for (const d of defs) {
    const btn = h('button', d.id === state.mainTab ? 'tab active' : 'tab', d.label);
    btn.onclick = () => { state.mainTab = d.id; renderMainArea(); };
    tabs.appendChild(btn);
  }
  col.appendChild(tabs);

  if (state.mainTab === 'editor') {
    const body = h('div', 'main-body');
    const sidebar = h('aside');
    sidebar.id = 'sidebar';
    const editorCol = h('div', 'editor-col');
    const searchPanel = h('div');
    searchPanel.id = 'search-panel';
    editorCol.appendChild(searchPanel);
    const editor = h('section');
    editor.id = 'editor';
    editorCol.appendChild(editor);
    const right = h('aside');
    right.id = 'right';
    body.append(sidebar, editorCol, right);
    col.appendChild(body);
    main.appendChild(col);
    renderSidebar();
    renderSearchPanel(searchPanel);
    renderEditor();
    renderIssues();
    renderRightExtras();
  } else if (state.mainTab === 'flow') {
    const flowEl = h('section');
    flowEl.id = 'flow-view';
    col.appendChild(flowEl);
    main.appendChild(col);
    renderFlow(flowEl);
  } else if (state.mainTab === 'preview') {
    const pvEl = h('section');
    pvEl.id = 'preview-view';
    col.appendChild(pvEl);
    main.appendChild(col);
    renderPreviewPanel(pvEl);
  } else if (state.mainTab === 'stats') {
    const stEl = h('section');
    stEl.id = 'stats-view';
    col.appendChild(stEl);
    main.appendChild(col);
    renderStatsPanel(stEl);
  } else if (state.mainTab === 'audit') {
    const auEl = h('section');
    auEl.id = 'audit-view';
    col.appendChild(auEl);
    main.appendChild(col);
    renderAuditPanel(auEl);
  } else {
    const cfgEl = h('section');
    cfgEl.id = 'config-view';
    col.appendChild(cfgEl);
    main.appendChild(col);
    renderConfig(cfgEl);
  }
}

/* ============================ 撤销/重做路由（剧本栈 vs 配置栈） ============================ */

/** 配置标签页走配置快照栈，其余标签页走剧本文本栈 */
function doUndo(): void {
  if (state.mainTab === 'config') configUndo();
  else undo();
}
function doRedo(): void {
  if (state.mainTab === 'config') configRedo();
  else redo();
}

/* ============================ 快捷键 ============================ */

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    void saveAll();
    return;
  }
  // 撤销/重做（自我迭代①a）：Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z；配置页走配置栈
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    doRedo();
  }
  // Ctrl+F 聚焦搜索（M6 E5）；Ctrl+P 预览标签页
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (state.mainTab !== 'editor') {
      state.mainTab = 'editor';
      renderMainArea();
    }
    focusSearchInput();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    state.mainTab = 'preview';
    renderMainArea();
  }
});

// 关页保护：存在未保存改动时提示（防误关丢失编辑）
window.addEventListener('beforeunload', (e) => {
  for (const sc of state.scenes.values()) {
    if (sc.dirty) {
      e.preventDefault();
      e.returnValue = '';
      return;
    }
  }
});

renderAll();
