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
import { state, h, setStatus } from './state.js';
import { buildObjectIndex } from '@surdet/authoring';
import { loadEditorProjectSnapshot } from './authoring-project-storage.js';
import {
  listenForPreviewTraceSelection,
  locateObjectForTraceEvent,
  parseTimelineObjectRef,
  reconcileAuthoringSelection,
  selectAuthoringObject,
} from './causal-selection.js';
import { bindHistoryHooks, undo, redo } from './history.js';
import { takeTimelineRedo, takeTimelineUndo } from './timeline-history.js';
import {
  bindProjectIoHooks,
  openProject,
  saveAll,
  exportCurrent,
  loadDemoProject,
  quarantineTimelineAutosaveEntries,
  repairTimelineAutosaveConflict,
  restoreTimelineAutosaveEntries,
  type TimelineAutosaveRepairAction,
  type TimelineAutosaveRestoreConflict,
} from './project-io.js';
import { renderSidebar, bindSidebarHooks } from './panels/sidebar.js';
import { refreshEditorObjectRefs, refreshManuscriptFacts, renderEditor } from './panels/editor.js';
import { bindIssueNavigation, scheduleValidate, runValidate, renderIssues } from './panels/issues.js';
import { bindRightNavigation, refreshCurrentSceneContext, renderRightExtras, updateCausalPanel } from './panels/right.js';
import { bindAssetsPanelHooks } from './panels/assets.js';
import { renderFlow, bindFlowHooks } from './panels/flow.js';
import { renderConfig, bindConfigHooks, configUndo, configRedo, configHistoryDepth, addTerminologyVariant } from './panels/config.js';
import { renderPreviewPanel } from './panels/preview-panel.js';
import { clearTimelineViewState, clearTimelineViewStates, renderTimelinePanel, selectTimelineCue, bindTimelineHooks } from './panels/timeline-panel.js';
import { renderStatsPanel } from './panels/stats-panel.js';
import { renderSearchPanel, bindSearchHooks, focusSearchInput } from './panels/search-panel.js';
import { renderAuditPanel, bindAuditHooks } from './panels/audit-panel.js';
import { openReviewPanelWorkspace, renderReviewPanel } from './panels/review-panel.js';
import { renderTimelineAutosaveConflictPanel } from './panels/timeline-autosave-conflicts.js';
import {
  renderModeNavigation,
  renderProjectBar,
  updateProjectBarProjection,
  type ProjectBarProjection,
  type ProjectSaveState,
} from './shell/app-shell.js';
import { buildAuthoringWorkbench } from './shell/authoring-workbench.js';
import {
  AUTOSAVE_INTERVAL_MS, buildAutosave, readAutosave, pickRecoverable, pickRecoverableTimelines,
  preserveAutosaveTimelineConflicts, unresolvedAutosaveTimelineConflicts, writeAutosave, clearAutosave,
} from './autosave.js';

/* ============================ authoring 内存索引（单飞 + 防抖） ============================ */

let authoringRevision = 0;
let authoringTimer: ReturnType<typeof setTimeout> | null = null;
let authoringRunning = false;
let authoringQueued = false;
/** 最近一次磁盘保存尝试仍有失败项；只服务于顶栏回执，不复制编辑器业务状态。 */
let saveAttemptLeftDirty = false;
let pendingAutosaveTimelineConflicts: TimelineAutosaveRestoreConflict[] = [];

function hasDirtyProjectFiles(): boolean {
  return [...state.scenes.values()].some(({ dirty }) => dirty)
    || state.timelines.some(({ dirty }) => dirty)
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0;
}

function currentObjectLabel(): string {
  if (state.reviewWorkspace !== null) return '审阅任务';
  if (state.mainTab === 'config') return '项目配置';
  if (state.mainTab === 'stats') return '项目统计';
  if (state.mainTab === 'audit') return '项目审计';
  if (state.mainTab === 'timeline' && state.currentTimeline !== null) {
    return `时间轴 ${state.currentTimeline}`;
  }
  if (state.mainTab === 'preview' && state.previewTimelineId !== null) {
    return `时间轴 ${state.previewTimelineId}`;
  }
  if (state.current !== null) return `场景 ${state.current}`;
  if (state.currentTimeline !== null) return `时间轴 ${state.currentTimeline}`;
  return '未选择工作对象';
}

function projectBarProjection(): ProjectBarProjection {
  const hasDirtyFiles = hasDirtyProjectFiles();
  const saveState: ProjectSaveState = hasDirtyFiles
    ? saveAttemptLeftDirty ? 'partial-failure' : 'dirty'
    : 'saved';
  return {
    projectName: state.dirName || '未打开项目',
    objectLabel: currentObjectLabel(),
    saveState,
    canUndo: true,
    canRedo: true,
    fsSupported: state.fsSupported,
    hasScenes: state.scenes.size > 0,
  };
}

function refreshProjectBarProjection(): void {
  updateProjectBarProjection(projectBarProjection());
}

function markProjectEdited(): void {
  saveAttemptLeftDirty = false;
  refreshProjectBarProjection();
}

function handleTimelineEdited(): void {
  markProjectEdited();
  scheduleValidate();
  scheduleAuthoringIndexRebuild();
}

async function saveProject(): Promise<void> {
  await saveAll();
  refreshProjectBarProjection();
}

function scheduleAuthoringIndexRebuild(): void {
  authoringRevision += 1;
  if (authoringRunning) {
    authoringQueued = true;
    return;
  }
  if (authoringTimer) clearTimeout(authoringTimer);
  authoringTimer = setTimeout(() => {
    authoringTimer = null;
    void rebuildAuthoringIndex();
  }, 80);
}

async function rebuildAuthoringIndex(): Promise<void> {
  if (authoringRunning) {
    authoringQueued = true;
    return;
  }
  authoringRunning = true;
  const revision = authoringRevision;
  try {
    const snapshot = await loadEditorProjectSnapshot();
    const index = buildObjectIndex(snapshot);
    if (revision === authoringRevision) {
      const previousIndex = state.authoringIndex;
      state.selectedObjectRef = reconcileAuthoringSelection(state.selectedObjectRef, previousIndex, index);
      state.authoringIndex = index;
      refreshEditorObjectRefs();
      updateCausalPanel();
    } else {
      authoringQueued = true;
    }
  } catch {
    if (revision === authoringRevision) {
      state.authoringIndex = null;
      refreshEditorObjectRefs();
      updateCausalPanel();
    }
  } finally {
    authoringRunning = false;
    if (authoringQueued || revision !== authoringRevision) {
      authoringQueued = false;
      scheduleAuthoringIndexRebuild();
    }
  }
}

function resetAuthoringState(): void {
  state.selectedObjectRef = null;
  state.authoringIndex = null;
  state.previewTrace = [];
  state.selectedTraceStep = null;
  scheduleAuthoringIndexRebuild();
}

/* ============================ 模块装配（钩子注入，保持无环） ============================ */

bindHistoryHooks({
  onEdited: () => {
    markProjectEdited();
    renderSidebar();
    refreshManuscriptFacts();
    refreshCurrentSceneContext();
    scheduleValidate();
    scheduleAuthoringIndexRebuild();
  },
  onHistoryNav: () => { renderEditor(); renderSidebar(); refreshProjectBarProjection(); },
});
bindProjectIoHooks({
  renderAll,
  runValidate: () => { runValidate(); scheduleAuthoringIndexRebuild(); },
  renderSidebar,
  onProjectLoaded: () => {
    saveAttemptLeftDirty = false;
    pendingAutosaveTimelineConflicts = [];
    clearTimelineViewStates();
    resetAuthoringState();
    refreshProjectBarProjection();
    tryAutosaveRecover();
  },
  onSaved: () => {
    persistCurrentAutosave(Date.now());
  },
  onTimelineDeleted: clearTimelineViewState,
  onSaveSettled: ({ failures, remainingDirty }) => {
    saveAttemptLeftDirty = failures > 0 && remainingDirty;
    refreshProjectBarProjection();
    refreshManuscriptFacts();
    refreshCurrentSceneContext();
  },
});
bindSidebarHooks({
  onSelectScene: (sceneKey) => jumpToScene(sceneKey),
});
bindAssetsPanelHooks({
  onInserted: () => renderEditor(),
});
bindRightNavigation({
  onJumpScene: (sceneKey) => jumpToScene(sceneKey),
});
bindFlowHooks({
  // 流程图导航：切回块编辑标签页并选中场景；双击标签节点时滚动到该 @label 行
  openScene: (sceneKey, line) => jumpToScene(sceneKey, line !== undefined ? Math.max(0, line - 1) : undefined),
  // 流程图结构变更（重命名/删除）后重新调度校验
  requestValidate: () => {
    markProjectEdited();
    scheduleValidate();
    scheduleAuthoringIndexRebuild();
  },
});
bindConfigHooks({
  // 配置保存后重新调度校验（新变量/成就即刻参与 lint）
  requestValidate: () => { scheduleValidate(); scheduleAuthoringIndexRebuild(); },
});
bindTimelineHooks({
  onPreview: (timelineId) => {
    state.previewTimelineId = timelineId;
    state.mainTab = 'preview';
    renderMainArea();
  },
  onOpenAssets: () => {
    state.mainTab = 'editor';
    state.sidebarTab = 'assets';
    renderMainArea();
  },
  onEdited: handleTimelineEdited,
  onSelectionChanged: refreshProjectBarProjection,
});

/** 跳转定位（流程图导航与搜索结果共用）：切块编辑标签页 + 选中场景 + 滚动到指定行 */
function jumpToScene(sceneKey: string, line?: number): void {
  if (!state.scenes.has(sceneKey)) return;
  const changedScene = state.current !== sceneKey;
  state.mainTab = 'editor';
  state.current = sceneKey;
  if (changedScene) state.selectedObjectRef = null;
  renderMainArea();
  if (line !== undefined) {
    const target = document.querySelector<HTMLElement>(`.block[data-line="${Math.max(0, line)}"]`);
    const objectRef = target?.dataset.objectRef || null;
    state.selectedObjectRef = selectAuthoringObject(objectRef);
    document.dispatchEvent(new CustomEvent('surdet-authoring-selection'));
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }
}

/** 时间轴/轨道/Cue 引用 → 切到时间轴页签并选中对应 cue；返回是否已处理。 */
function jumpToTimelineObjectIfNeeded(ref: string | null): boolean {
  if (!ref) return false;
  const parsed = parseTimelineObjectRef(ref);
  if (!parsed) return false;
  state.mainTab = 'timeline';
  renderMainArea();
  selectTimelineCue(parsed.timelineId, parsed.trackIndex ?? undefined, parsed.cueIndex ?? undefined);
  return true;
}

document.addEventListener('surdet-authoring-selection', () => {
  refreshEditorObjectRefs();
  jumpToTimelineObjectIfNeeded(state.selectedObjectRef);
  updateCausalPanel();
});

listenForPreviewTraceSelection((detail) => {
  if (!detail || !detail.event) return;
  const ref = selectAuthoringObject(detail.objectRef ?? locateObjectForTraceEvent(detail.event, state.authoringIndex ?? undefined));
  state.selectedObjectRef = ref;
  const object = ref && state.authoringIndex
    ? state.authoringIndex.objects.find((candidate) => candidate.objectRef === ref || candidate.semanticId === ref)
    : undefined;
  if (object?.source) {
    const sceneKey = [...state.scenes.keys()].find((key) => {
      const scene = state.scenes.get(key)!;
      const file = scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`;
      return file === object.source!.path || file.endsWith(`/${object.source!.path}`) || object.source!.path.endsWith(`/${file}`);
    });
    if (sceneKey) {
      jumpToScene(sceneKey, object.source.line - 1);
      return;
    }
  }
  if (jumpToTimelineObjectIfNeeded(ref)) return;
  updateCausalPanel();
});
bindSearchHooks({
  onJump: (sceneKey, line) => jumpToScene(sceneKey, line),
  onEdited: () => {
    markProjectEdited();
    scheduleValidate();
  },
});
bindIssueNavigation({
  onJump: (sceneKey, line) => jumpToScene(sceneKey, line),
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
  const header = renderProjectBar(projectBarProjection(), {
    onOpenProject: () => { void openProject(); },
    onOpenReview: () => {
      void (async () => {
        try {
          await openReviewPanelWorkspace();
          renderAll();
          setStatus('已打开审阅任务', true, 4000);
        } catch (error) {
          setStatus(`打开审阅任务失败：${error instanceof Error ? error.message : String(error)}`, false, 6000);
        }
      })();
    },
    onUndo: doUndo,
    onRedo: doRedo,
    onSaveProject: () => { void saveProject(); },
    onLoadDemo: loadDemoProject,
    onExportCurrent: exportCurrent,
  });
  appEl.appendChild(header);

  if (!state.fsSupported && state.scenes.size === 0) {
    const banner = h('div', 'banner');
    banner.textContent = '未检测到 File System Access 支持：请使用 Chrome/Edge 打开并点击「打开游戏目录」选择游戏项目根目录（如 examples/starter）；当前环境可先加载演示项目体验编辑与校验。';
    appEl.appendChild(banner);
  }

  const main = h('main');
  main.id = 'main';
  main.className = 'editor-application-frame';
  appEl.appendChild(main);
  renderMainArea();
}

/** 主区：标签页（块编辑 / 流程图 / 时间轴 / 配置 / 预览 / 统计 / 审计）+ 对应内容 */
function renderMainArea(): void {
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '';
  const navigation = renderModeNavigation(state.mainTab, (mode) => {
      state.previewTimelineId = null;
      state.mainTab = mode;
      renderMainArea();
  });
  const col = h('div', 'main-col editor-mode-surface');
  const conflictHost = h('div', 'timeline-autosave-conflict-host');
  col.setAttribute('data-editor-mode-surface', state.mainTab);
  if (state.mainTab === 'editor') col.id = 'editor-workspace';
  main.append(navigation, conflictHost, col);
  renderTimelineAutosaveConflictPanel(conflictHost, pendingAutosaveTimelineConflicts, {
    onReplaceCurrent: (key) => handleTimelineAutosaveRepair(key, { kind: 'replace-current' }),
    onSaveAsNew: (key, newId) => handleTimelineAutosaveRepair(key, { kind: 'save-as-new', newId }),
    onDiscard: discardTimelineAutosaveConflict,
    onDownload: downloadTimelineAutosaveConflict,
  });

  if (state.mainTab === 'editor') {
    const workbench = buildAuthoringWorkbench();
    col.appendChild(workbench.root);
    renderSidebar();
    renderSearchPanel(workbench.search);
    renderEditor();
    renderIssues();
    renderRightExtras();
  } else if (state.mainTab === 'flow') {
    const flowEl = h('section');
    flowEl.id = 'flow-view';
    col.appendChild(flowEl);
    renderFlow(flowEl);
  } else if (state.mainTab === 'timeline') {
    const timelineEl = h('section');
    timelineEl.id = 'timeline-view';
    col.appendChild(timelineEl);
    renderTimelinePanel(timelineEl);
  } else if (state.mainTab === 'preview') {
    const pvEl = h('section');
    pvEl.id = 'preview-view';
    col.appendChild(pvEl);
    renderPreviewPanel(pvEl);
  } else if (state.mainTab === 'stats') {
    const stEl = h('section');
    stEl.id = 'stats-view';
    col.appendChild(stEl);
    renderStatsPanel(stEl);
  } else if (state.mainTab === 'audit') {
    const auEl = h('section');
    auEl.id = 'audit-view';
    col.appendChild(auEl);
    renderAuditPanel(auEl);
  } else if (state.mainTab === 'review') {
    const reviewEl = h('section');
    reviewEl.id = 'review-view';
    col.appendChild(reviewEl);
    renderReviewPanel(reviewEl);
  } else {
    const cfgEl = h('section');
    cfgEl.id = 'config-view';
    col.appendChild(cfgEl);
    renderConfig(cfgEl);
  }
  refreshProjectBarProjection();
}

/* ============================ 撤销/重做路由（剧本栈 vs 配置栈） ============================ */

function applyTimelineHistory(direction: 'undo' | 'redo'): void {
  const timelineId = state.currentTimeline;
  if (!timelineId) return;
  const entry = state.timelines.find((candidate) => candidate.id === timelineId);
  if (!entry) return;
  const restored = direction === 'undo'
    ? takeTimelineUndo(timelineId, entry.text, state.currentTimelineCue)
    : takeTimelineRedo(timelineId, entry.text, state.currentTimelineCue);
  if (restored === null) return;
  entry.text = restored.text;
  entry.dirty = true;
  state.currentTimelineCue = restored.selection;
  renderTimelinePanel(document.getElementById('timeline-view'));
  if (restored.selection) {
    document.querySelector<HTMLElement>(
      `[data-timeline-focus="cue-${restored.selection.trackIndex}-${restored.selection.cueIndex}"]`,
    )?.focus({ preventScroll: true });
  }
  handleTimelineEdited();
}

/** 配置、时间轴和剧本分别使用独立历史栈。 */
function doUndo(): void {
  if (state.mainTab === 'config') configUndo();
  else if (state.mainTab === 'timeline') applyTimelineHistory('undo');
  else undo();
}
function doRedo(): void {
  if (state.mainTab === 'config') configRedo();
  else if (state.mainTab === 'timeline') applyTimelineHistory('redo');
  else redo();
}

/* ============================ 快捷键 ============================ */

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    void saveProject();
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
  if (state.timelines.some((timeline) => timeline.dirty)
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 调试探针（对齐 starter surdetDebug 惯例）：devtools/自动化验收只读驱动用，生产可裁剪
(window as unknown as Record<string, unknown>).surdetEditorDebug = {
  state,
  configUndo,
  configRedo,
  configHistoryDepth,
};

/* ============================ 崩溃保险（A1：定时快照 + 同项目恢复提示） ============================ */

function timelineConflictEvidenceKey(conflict: TimelineAutosaveRestoreConflict): string {
  const recovered = conflict.recovered;
  return `${recovered.id}\0${recovered.file}\0${recovered.eol}\0${recovered.text}`;
}

function mergeTimelineAutosaveConflicts(
  conflicts: readonly TimelineAutosaveRestoreConflict[],
): TimelineAutosaveRestoreConflict[] {
  const byEvidence = new Map<string, TimelineAutosaveRestoreConflict>();
  for (const conflict of conflicts) byEvidence.set(timelineConflictEvidenceKey(conflict), conflict);
  return [...byEvidence.values()];
}

function persistCurrentAutosave(now: number): void {
  if (!state.autosaveProjectId) return;
  const unresolvedEntries = unresolvedAutosaveTimelineConflicts(
    pendingAutosaveTimelineConflicts.map((conflict) => conflict.recovered),
    state.timelines,
  );
  const unresolvedEvidence = new Set(unresolvedEntries.map((entry) => (
    `${entry.id}\0${entry.file}\0${entry.eol}\0${entry.text}`
  )));
  pendingAutosaveTimelineConflicts = pendingAutosaveTimelineConflicts.filter((conflict) => (
    unresolvedEvidence.has(timelineConflictEvidenceKey(conflict))
  ));
  const fresh = buildAutosave(state.dirName, state.scenes, state.timelines, now, state.autosaveProjectId);
  const payload = preserveAutosaveTimelineConflicts(
    fresh,
    state.dirName,
    pendingAutosaveTimelineConflicts.map((conflict) => conflict.recovered),
    now,
    state.autosaveProjectId,
  );
  if (payload) writeAutosave(payload);
  else clearAutosave(state.autosaveProjectId);
}

function handleTimelineAutosaveRepair(key: string, action: TimelineAutosaveRepairAction): void {
  const conflict = pendingAutosaveTimelineConflicts.find((candidate) => candidate.key === key);
  if (!conflict) {
    setStatus('这份演出备份已不在待处理列表中', false, 5000);
    return;
  }
  const result = repairTimelineAutosaveConflict(conflict, action);
  if (!result.ok) {
    setStatus(`演出备份处理失败：${result.error}`, false, 8000);
    return;
  }
  pendingAutosaveTimelineConflicts = pendingAutosaveTimelineConflicts
    .filter((candidate) => candidate.key !== key);
  persistCurrentAutosave(Date.now());
  renderMainArea();
  renderSidebar();
  runValidate();
  scheduleAuthoringIndexRebuild();
  setStatus(`已恢复演出 ${result.timelineId}，请保存项目`, true, 6000);
}

function discardTimelineAutosaveConflict(key: string): void {
  const before = pendingAutosaveTimelineConflicts.length;
  pendingAutosaveTimelineConflicts = pendingAutosaveTimelineConflicts
    .filter((candidate) => candidate.key !== key);
  if (pendingAutosaveTimelineConflicts.length === before) {
    setStatus('这份演出备份已不在待处理列表中', false, 5000);
    return;
  }
  persistCurrentAutosave(Date.now());
  renderMainArea();
  setStatus('已保留当前项目并放弃这份演出备份', true, 5000);
}

function downloadTimelineAutosaveConflict(key: string): void {
  const conflict = pendingAutosaveTimelineConflicts.find((candidate) => candidate.key === key);
  if (!conflict) {
    setStatus('这份演出备份已不在待处理列表中', false, 5000);
    return;
  }
  const safeId = conflict.recovered.id.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'timeline';
  const url = URL.createObjectURL(new Blob([conflict.recovered.text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeId}-autosave.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus('已下载演出自动备份，待处理记录仍保留', true, 5000);
}

/** 项目载入后检查同项目未保存快照：存在且与当前内存不同时询问恢复 */
function tryAutosaveRecover(): void {
  if (!state.autosaveProjectId) return;
  const payload = readAutosave(state.autosaveProjectId);
  const recoverable = pickRecoverable(payload, state.autosaveProjectId, state.scenes);
  const recoverableTimelines = pickRecoverableTimelines(payload, state.autosaveProjectId, state.timelines);
  const quarantinedEntries = payload?.projectId === state.autosaveProjectId
    ? unresolvedAutosaveTimelineConflicts(payload.timelineConflicts ?? [], state.timelines)
    : [];
  const quarantinedConflicts = quarantineTimelineAutosaveEntries(quarantinedEntries);
  if (recoverable.length === 0 && recoverableTimelines.length === 0 && quarantinedConflicts.length === 0) {
    if ((payload?.timelineConflicts?.length ?? 0) > 0) persistCurrentAutosave(Date.now());
    return;
  }
  const when = new Date(payload!.savedAt).toLocaleString();
  const names = recoverable.map((e) => e.key).join('、');
  const timelineNames = recoverableTimelines.map((entry) => entry.id).join('、');
  const details = [
    recoverable.length > 0 ? `${recoverable.length} 个场景：${names}` : '',
    recoverableTimelines.length > 0 ? `${recoverableTimelines.length} 个演出：${timelineNames}` : '',
    quarantinedConflicts.length > 0 ? `${quarantinedConflicts.length} 个演出身份冲突需要确认` : '',
  ].filter(Boolean).join('\n');
  if (!window.confirm(`检测到「${state.dirName}」的未保存自动备份（${when}）：\n${details}\n是否恢复这些未保存的编辑？（取消则丢弃备份内容）`)) {
    pendingAutosaveTimelineConflicts = [];
    clearAutosave(state.autosaveProjectId);
    return;
  }
  for (const e of recoverable) {
    const sc = state.scenes.get(e.key);
    if (sc) {
      sc.text = e.text;
      sc.dirty = true;
    }
  }
  const timelineRecovery = restoreTimelineAutosaveEntries(recoverableTimelines);
  pendingAutosaveTimelineConflicts = mergeTimelineAutosaveConflicts([
    ...quarantinedConflicts,
    ...timelineRecovery.conflicts,
  ]);
  persistCurrentAutosave(Date.now());
  if (pendingAutosaveTimelineConflicts.length > 0) {
    setStatus(`有 ${pendingAutosaveTimelineConflicts.length} 个演出备份需要你确认处理`, false, 8000);
  }
  renderAll();
  runValidate();
  scheduleAuthoringIndexRebuild();
  renderSidebar();
}

/** 定时快照：有 dirty 场景就写备份，全部干净则清除旧备份（存储不可用时静默降级） */
setInterval(() => {
  if (state.projectLoading || !state.autosaveProjectId) return;
  persistCurrentAutosave(Date.now());
}, AUTOSAVE_INTERVAL_MS);

renderAll();
runValidate();
scheduleAuthoringIndexRebuild();
