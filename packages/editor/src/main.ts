import { desktopDirectory, desktopErrorMessage } from './desktop.js';
import { bindStageEditingHooks } from './stage-editing.js';
import { PROJECT_ASSET_RELOCATION_KINDS, AGENT_IMAGE_MAX_BYTES, parseProjectConfigDocument } from '@surdet/authoring';
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
import { bindEditorWorkspaceHooks, connectEditorWorkspace, disconnectEditorWorkspace, editorWorkspaceStatus,
  publishEditorWorkspaceState, pollEditorWorkspace, readEditorWorkspaceBaseline, currentEditorWorkspaceWrite,
  editorWorkspaceTextChanges, enqueueEditorAssetRequest, recordEditorSceneCommit } from './editor-workspace.js';
import type { ProjectDiskBaseline } from './project-disk-baseline.js';
import type { SourceRange } from '@surdet/core';
import { hasReviewDraft, hasPendingReviewReceipt, isReviewReceiptWriting, discardReviewDraft, openReviewWorkspace, type ReviewWorkspaceState } from './review-workspace.js';
import { isReviewApplyRunning } from './review-apply-controller.js';
import { createReviewPreparationClient, preparationErrorMessage } from './review-preparation-client.js';
import { disposeReviewPreparation } from './review-preparation-section.js';
import { isReviewPreparationReference, type ReviewPreparationReference } from '@surdet/authoring';
import type { ExistingEditorSyncPort } from './review-apply-controller.js';
import { openReviewPreview, refreshReviewFixtureIdentity } from './review-preview.js';
import {
  buildObjectIndex,
  buildProjectAssetIntelligence,
  loadProjectSnapshot,
  type ProjectAssetImportTargetRequest,
  type ProjectAssetItem,
  type ProjectAssetReference,
} from '@surdet/authoring';
import { loadEditorProjectSnapshot } from './authoring-project-storage.js';
import {
  listenForPreviewTraceSelection,
  locateObjectForTraceEvent,
  parseTimelineObjectRef,
  reconcileAuthoringSelection,
  selectAuthoringObject,
} from './causal-selection.js';
import { bindHistoryHooks, histories, undo, redo } from './history.js';
import { takeTimelineRedo, takeTimelineUndo, timelineHistoryDepth } from './timeline-history.js';
import {
  bindProjectIoHooks,
  openProject,
  openProjectFromHandle,
  reloadCurrentProjectFromHandle,
  prepareSceneConfigRecovery,
  waitForProjectWritesToSettle,
  refreshProjectAssetIntelligence,
  collectProjectAssets,
  sceneTextSha256,
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
import { bindIssueNavigation, invalidatePendingValidation, scheduleValidate, runValidate, renderIssues, problemSummary, stepProblem } from './panels/issues.js';
import { bindRightNavigation, refreshCurrentSceneContext, renderRightExtras, updateCausalPanel } from './panels/right.js';
import { bindAssetsPanelHooks, hideAssetPreview } from './panels/assets.js';
import { disposeAssetCenterPreview, renderAssetCenter } from './panels/asset-center.js';
import { disposeAssetCenterThumbnails } from './panels/asset-center-thumbnails.js';
import {
  bindFlowHooks,
  deleteScene,
  deleteSceneAtKey,
  renderFlow,
  renameScene,
  renameSceneAtKey,
  moveSceneAtKey,
} from './panels/flow.js';
import { renderConfig, bindConfigHooks, configUndo, configRedo, configHistoryDepth, addTerminologyVariant, resetConfigSession,
  inspectConfigDraftState, prepareConfigSceneRename, prepareConfigLabelRename, saveDirtyConfigSections } from './panels/config.js';
import { bindLabelEditingHooks } from './label-editing.js';
import { renderPreviewPanel, disposePreviewPanel, refreshPreviewSourceState } from './panels/preview-panel.js';
import { disposeScriptV4, revealScriptV4Line } from './v4/script-workbench.js';
import { bindV4Navigation, navigateMode, navigateTimeline } from './v4/ui.js';
import { openProjectSearch } from './shell/project-search.js';
import { workbenchIcon } from './shell/icons.js';
import { renderAssetInsights, disposeV4SurfaceViews } from './v4/surfaces.js';
import { disposeUiDesigner } from './ui-designer.js';
import { disposeUiPlayerPreview } from './ui-player-preview.js';
import './styles/v4-workbench.css';
import { clearTimelineViewState, clearTimelineViewStates, renderTimelinePanel, selectTimelineCue, bindTimelineHooks } from './panels/timeline-panel.js';
import { renderStatsPanel, bindStatsHooks } from './panels/stats-panel.js';
import { renderStoryCheckPanel, disposeStoryCheckPanel, resetStoryChecks, refreshStoryChecks } from './panels/story-check-panel.js';
import { renderContentHistoryPanel } from './panels/content-history-panel.js';
import { renderSearchPanel, bindSearchHooks, focusSearchInput, resetSearchSession } from './panels/search-panel.js';
import { renderAuditPanel, bindAuditHooks } from './panels/audit-panel.js';
import { openReviewPanelWorkspace, renderReviewPanel, disposeReviewApply } from './panels/review-panel.js';
import {
  openListedReviewTask, refreshReviewTasks, renderReviewTaskList, reviewTaskPendingCount, reviewTaskPreviewDirectory,
} from './panels/review-tasks.js';
import { renderTimelineAutosaveConflictPanel } from './panels/timeline-autosave-conflicts.js';
import { createProjectCreation, renderProjectCreation, type ProjectCreation } from './panels/project-creation.js';
import {
  AssetImportClientError,
  createAssetImportAuthorityClient,
  type AssetRelocationDetail,
} from './asset-import-client.js';
import { createAssetImportWorkspace } from './asset-import-workspace.js';
import {
  createAssetRelocationWorkspace,
  type AssetRelocationSource,
} from './asset-relocation-workspace.js';
import {
  renderModeNavigation,
  updateModeNavigationBadge,
  renderProjectBar,
  renderStatusBar,
  updateProjectBarProjection,
  type ProjectBarProjection,
  type ProjectSaveState,
} from './shell/app-shell.js';
import { buildAuthoringWorkbench, disposeAuthoringWorkbench } from './shell/authoring-workbench.js';
import {
  AUTOSAVE_INTERVAL_MS, buildAutosave, readAutosave, inspectSceneAutosaveRecovery, pickRecoverableTimelines,
  preserveAutosaveTimelineConflicts, settlePendingSceneCommit, unresolvedAutosaveTimelineConflicts, writeAutosave, clearAutosave,
  type AutosavePayload,
} from './autosave.js';

/* ============================ authoring 内存索引（单飞 + 防抖） ============================ */

let authoringRevision = 0;
let authoringTimer: ReturnType<typeof setTimeout> | null = null;
let authoringRunning = false;
let authoringQueued = false;
let authoringProjectChanging = false;
let boundReviewProject: { projectIdentity: string; handle: FileSystemDirectoryHandle } | null = null;
let renderedMainTab: typeof state.mainTab | null = null;
let returningFromReviewPreview = false;
// Desktop start page creation form: kept across redraws so a typed name and chosen location survive them.
let projectCreation: ProjectCreation | null = null;
let projectCreationView: ReturnType<typeof renderProjectCreation> | null = null;
let projectCreationOpen = false;
const PREPARATION_SESSION_KEY = 'surdet.review-preparation';
const authoringWaiters: Array<{
  revision: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];
/** 最近一次磁盘保存尝试仍有失败项；只服务于顶栏回执，不复制编辑器业务状态。 */
let saveAttemptLeftDirty = false;
/** 无法安全部分恢复的场景快照必须原样保留，直到用户显式处理。 */
let blockedSceneAutosave: AutosavePayload | null = null;
let pendingAutosaveTimelineConflicts: TimelineAutosaveRestoreConflict[] = [];
let assetImportGeneration = 0;
const assetRequestFetcher: typeof fetch = (input, init) => {
  // Workspace requests are already queued by editor-workspace; nesting them
  // would deadlock. Other requests must not race its preview/snapshot reads.
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/workspace/') ? fetch(input, init)
    : enqueueEditorAssetRequest(() => fetch(input, init));
};
let assetImportClient = createAssetImportAuthorityClient({ fetcher: assetRequestFetcher });
type SceneAutosaveRecoveryPhase = 'idle' | 'running' | 'blocked';
type SceneAutosaveRecoveryOutcome = 'complete' | 'blocked' | 'stale';
interface SceneAutosaveRecoveryContext {
  sequence: number;
  generation: number;
  client: typeof assetImportClient;
  projectRoot: FileSystemDirectoryHandle | null;
  projectId: string;
}
let sceneAutosaveRecoverySequence = 0;
let sceneAutosaveRecoveryPhase: SceneAutosaveRecoveryPhase = 'idle';
let assetImportActionRunning = false;
let sceneLifecycleActionRunning = false;
let loadedWorkspaceAssets = new Map<string, string>();
let assetImportPanelOpen = false;
let assetImportActionSequence = 0;
let assetImportCancelRequested = false;
let assetImportActionCancellable = false;
const assetImportWorkspace = createAssetImportWorkspace();
const assetRelocationWorkspace = createAssetRelocationWorkspace();
let assetRelocationActionSequence = 0;
assetImportWorkspace.subscribe((projection) => {
  state.assetImportWorkspace = projection;
  if (state.mainTab === 'assets') renderMainArea();
});

function resetAssetImportRuntime(): void {
  sceneAutosaveRecoverySequence += 1;
  setSceneAutosaveRecoveryPhase('idle');
  assetImportGeneration += 1;
  assetImportActionSequence += 1;
  assetImportActionRunning = false;
  assetImportCancelRequested = false;
  assetImportActionCancellable = false;
  assetImportPanelOpen = false;
  const closingClient = assetImportClient;
  void disconnectEditorWorkspace().finally(() => closingClient.dispose());
  assetImportClient = createAssetImportAuthorityClient({ fetcher: assetRequestFetcher });
  assetImportWorkspace.reset();
  assetRelocationActionSequence += 1;
  assetRelocationWorkspace.reset();
  state.projectWriteLock = null;
}

function sceneAutosaveRecoveryIsCurrent(context: SceneAutosaveRecoveryContext): boolean {
  return context.sequence === sceneAutosaveRecoverySequence
    && context.generation === assetImportGeneration
    && context.client === assetImportClient
    && context.projectRoot === state.dirHandle
    && context.projectId === state.autosaveProjectId;
}

function requireCurrentSceneAutosaveRecovery(context: SceneAutosaveRecoveryContext): void {
  if (!sceneAutosaveRecoveryIsCurrent(context)) {
    throw new Error('项目已经切换，旧的自动恢复已停止。');
  }
}

function setSceneAutosaveRecoveryPhase(phase: SceneAutosaveRecoveryPhase): void {
  sceneAutosaveRecoveryPhase = phase;
  const main = document.getElementById('main');
  if (main) {
    const locked = phase !== 'idle';
    main.toggleAttribute('inert', locked);
    main.setAttribute('data-autosave-recovery', phase);
    if (phase === 'running') main.setAttribute('aria-busy', 'true');
    else main.removeAttribute('aria-busy');
  }
  refreshProjectBarProjection();
  renderBlockedSceneRecovery();
}

function renderBlockedSceneRecovery(): void {
  document.getElementById('scene-recovery-actions')?.remove();
  const main = document.getElementById('main');
  if (sceneAutosaveRecoveryPhase !== 'blocked' || !main) return;
  const payload = blockedSceneAutosave;
  const projectId = state.autosaveProjectId;
  const panel = h('section', 'banner');
  panel.id = 'scene-recovery-actions';
  panel.setAttribute('aria-label', '处理未完成的自动恢复');
  panel.append(h('p', undefined, '自动恢复已暂停，原备份仍保留。可以下载备份或重试；没有待确认的磁盘保存时，也可以明确放弃备份并使用当前项目。'));
  const isCurrent = () => sceneAutosaveRecoveryPhase === 'blocked'
    && state.autosaveProjectId === projectId && blockedSceneAutosave === payload;
  const download = h('button', undefined, '下载完整备份');
  download.disabled = payload === null;
  download.dataset.action = 'download-scene-recovery';
  download.onclick = () => {
    if (!isCurrent() || !payload) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'surdet-scene-autosave.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const retry = h('button', undefined, '重试恢复');
  retry.dataset.action = 'retry-scene-recovery';
  retry.onclick = () => { if (isCurrent()) startCurrentProjectAutosaveRecovery(Promise.resolve()); };
  const discard = h('button', undefined, '放弃备份，使用当前项目');
  discard.dataset.action = 'discard-scene-recovery';
  discard.disabled = !payload || !!payload.pendingSceneCommit || state.pendingSceneCommit !== null;
  if (discard.disabled) discard.title = '保存结果尚未查明，不能丢弃原请求；请保留备份并重试恢复。';
  discard.onclick = () => {
    if (!isCurrent() || !projectId || !payload || payload.pendingSceneCommit || state.pendingSceneCommit) return;
    if (!window.confirm('确定放弃这份未保存备份？当前项目文件不会被修改。建议先下载完整备份。')) return;
    clearAutosave(projectId);
    if (readAutosave(projectId) !== null) { setStatus('备份未能清除，仍保持暂停。', false, 5000); return; }
    blockedSceneAutosave = null;
    setSceneAutosaveRecoveryPhase('idle');
    setStatus('已放弃备份，可以继续编辑当前项目。', true, 5000);
  };
  panel.append(download, retry, discard);
  main.before(panel);
}

function startCurrentProjectAutosaveRecovery(bindingReady: Promise<void>): void {
  const projectId = state.autosaveProjectId;
  if (!projectId) {
    setSceneAutosaveRecoveryPhase('idle');
    return;
  }
  const context: SceneAutosaveRecoveryContext = {
    sequence: sceneAutosaveRecoverySequence + 1,
    generation: assetImportGeneration,
    client: assetImportClient,
    projectRoot: state.dirHandle,
    projectId,
  };
  sceneAutosaveRecoverySequence = context.sequence;
  setSceneAutosaveRecoveryPhase('running');
  void tryAutosaveRecover(context, bindingReady).then((outcome) => {
    if (!sceneAutosaveRecoveryIsCurrent(context)) return;
    setSceneAutosaveRecoveryPhase(outcome === 'blocked' ? 'blocked' : 'idle');
    if (outcome === 'complete') persistCurrentAutosave(Date.now());
  }).catch((error) => {
    if (!sceneAutosaveRecoveryIsCurrent(context)) return;
    blockedSceneAutosave = readAutosave(context.projectId);
    setSceneAutosaveRecoveryPhase('blocked');
    setStatus(
      `自动恢复未完成，原备份已保留。请使用恢复面板处理：${error instanceof Error ? error.message : String(error)}`,
      false,
      12000,
    );
  });
}

function invalidateAuthoringForProjectChange(): void {
  authoringProjectChanging = true;
  authoringRevision += 1;
  if (authoringTimer) clearTimeout(authoringTimer);
  authoringTimer = null;
  authoringQueued = false;
  const error = new Error('项目已经切换，旧素材刷新已取消');
  for (const waiter of authoringWaiters.splice(0)) waiter.reject(error);
}

function closeCurrentProjectRuntime(): void {
  disposeScriptV4();
  disposePreviewPanel();
  disposeV4SurfaceViews();
  disposeUiDesigner();
  disposeUiPlayerPreview();
  invalidateAuthoringForProjectChange();
  resetAssetImportRuntime();
}

async function bindCurrentProjectAssetImport(preservedBaseline?: ProjectDiskBaseline | null): Promise<void> {
  const root = state.dirHandle;
  const client = assetImportClient;
  const generation = assetImportGeneration;
  const baseline = preservedBaseline !== undefined ? preservedBaseline
    : state.projectLoading ? undefined : editorWorkspaceStatus().baseline;
  if (root === null) {
    assetImportWorkspace.markUnavailable();
    return;
  }
  assetImportWorkspace.beginBinding();
  try {
    const binding = await client.bindProject(root);
    if (generation !== assetImportGeneration || client !== assetImportClient || state.dirHandle !== root) return;
    assetImportWorkspace.applyBinding(binding);
    await connectEditorWorkspace(client.workspace, root, baseline);
    if (generation !== assetImportGeneration || client !== assetImportClient || state.dirHandle !== root) return;
    const projectIdentity = editorWorkspaceStatus().latest?.projectIdentity;
    if (projectIdentity !== undefined) boundReviewProject = { projectIdentity, handle: root };
    // Read the pending count once per successful binding; the review page and 刷新 read it again.
    refreshReviewTasks(reviewTasksChanged);
    const pendingRelocation = binding.pendingRelocations[0];
    if (pendingRelocation !== undefined && assetRelocationWorkspace.snapshot().mode === 'idle') {
      const detail = await client.relocationQuery(pendingRelocation.operationId);
      if (generation !== assetImportGeneration || client !== assetImportClient || state.dirHandle !== root) return;
      if (detail.plan.moves.length > 1) {
        assetRelocationWorkspace.beginBatch();
        for (const move of detail.plan.moves) {
          if (!['background', 'portrait', 'avatar'].includes(move.source.kind)) continue;
          assetRelocationWorkspace.select({
            assetId: `file:${move.source.path}`,
            sourcePath: move.source.path,
            kind: move.source.kind as AssetRelocationSource['kind'],
            targetDirectory: move.target.directory,
            fileName: move.target.fileName,
          });
        }
        assetRelocationWorkspace.openBatchEditor();
        assetRelocationWorkspace.setBatchDetail(detail);
        assetRelocationWorkspace.setMessage('发现一批尚未结束的素材整理，请先恢复或安全回退。');
        state.projectWriteLock = 'asset-relocation';
        refreshProjectBarProjection();
      } else {
        const source = detail.plan.source;
        if (source === null || !['background', 'portrait', 'avatar'].includes(source.kind)) return;
        assetRelocationWorkspace.begin({
          assetId: `file:${source.path}`,
          sourcePath: source.path,
          kind: source.kind as 'background' | 'portrait' | 'avatar',
          targetDirectory: detail.plan.target?.directory ?? source.directory,
          fileName: detail.plan.target?.fileName ?? source.fileName,
        });
        assetRelocationWorkspace.setDetail(detail);
        assetRelocationWorkspace.setMessage('发现一项尚未结束的素材整理，请先恢复或安全回退。');
        state.projectWriteLock = 'asset-relocation';
        refreshProjectBarProjection();
      }
    }
  } catch (error) {
    if (generation !== assetImportGeneration || client !== assetImportClient || state.dirHandle !== root) return;
    if (error instanceof AssetImportClientError && error.code === 'PROJECT_IDENTITY_MISMATCH') {
      assetImportWorkspace.markProjectMismatch(error.message);
    } else {
      assetImportWorkspace.markUnavailable(error instanceof Error ? error.message : undefined);
    }
  }
}

function assetImportErrorMessage(error: unknown): string {
  if (error instanceof AssetImportClientError) return error.message;
  return error instanceof Error ? error.message : '素材导入未完成，请检查文件后重试。';
}

interface AssetImportActionContext {
  actionId: number;
  generation: number;
  client: typeof assetImportClient;
  projectRoot: FileSystemDirectoryHandle | null;
}

function assetImportActionIsCurrent(context: AssetImportActionContext): boolean {
  return context.actionId === assetImportActionSequence
    && context.generation === assetImportGeneration
    && context.client === assetImportClient
    && context.projectRoot === state.dirHandle;
}

function requireCurrentAssetImportAction(context: AssetImportActionContext): void {
  if (!assetImportActionIsCurrent(context)) throw new Error('项目已经切换，旧导入已停止。');
}

async function runAssetImportAction(
  message: string,
  action: (context: AssetImportActionContext) => Promise<void>,
  cancellable = false,
): Promise<void> {
  if (assetImportActionRunning) return;
  if (state.projectWriteLock === 'asset-relocation') {
    assetImportWorkspace.setMessage('素材整理进行中，完成后才能开始导入。');
    return;
  }
  const context: AssetImportActionContext = {
    actionId: ++assetImportActionSequence,
    generation: assetImportGeneration,
    client: assetImportClient,
    projectRoot: state.dirHandle,
  };
  assetImportActionRunning = true;
  assetImportActionCancellable = cancellable;
  assetImportWorkspace.setMessage(message);
  try {
    await action(context);
  } catch (error) {
    if (assetImportActionIsCurrent(context)) assetImportWorkspace.setMessage(assetImportErrorMessage(error));
  } finally {
    if (context.actionId === assetImportActionSequence) {
      assetImportActionRunning = false;
      assetImportActionCancellable = false;
      if (state.mainTab === 'assets') renderMainArea();
    }
  }
}

function currentAssetImportTargets(): ProjectAssetImportTargetRequest[] {
  const items = assetImportWorkspace.snapshot().draftItems;
  if (items.length === 0) throw new Error('请先选择要导入的素材文件。');
  return items.map((item) => {
    const fileName = item.fileName.trim();
    if (item.kind === null) throw new Error(`请为“${item.sourceName}”选择素材分类。`);
    if (fileName.length === 0) throw new Error(`请填写“${item.sourceName}”的最终文件名。`);
    return { itemId: item.itemId, kind: item.kind, fileName };
  });
}

function assetImportFileSetLocked(): boolean {
  return assetImportActionRunning
    || assetImportWorkspace.snapshot().activeOperation !== null;
}

async function finishRequestedAssetImportCancellation(
  context: AssetImportActionContext,
  operationId: string,
): Promise<boolean> {
  if (!assetImportCancelRequested) return false;
  await context.client.cancel(operationId);
  requireCurrentAssetImportAction(context);
  const cancelled = await context.client.queryOperation(operationId);
  requireCurrentAssetImportAction(context);
  assetImportWorkspace.setOperation(cancelled);
  assetImportWorkspace.clearDraft();
  assetImportWorkspace.setMessage('导入已取消，项目文件没有变化。');
  assetImportCancelRequested = false;
  return true;
}

async function prepareAssetImport(): Promise<void> {
  await runAssetImportAction('准备导入', async (context) => {
    assetImportCancelRequested = false;
    const snapshot = assetImportWorkspace.snapshot();
    if (snapshot.entryState !== 'ready' && snapshot.entryState !== 'recoverable') {
      throw new Error(snapshot.message ?? '当前项目还不能安全导入素材。');
    }
    currentAssetImportTargets();
    let operationId = snapshot.activeOperation?.operation.operationId ?? null;
    const currentStatus = snapshot.activeOperation?.operation.status ?? null;
    if (operationId !== null && !['STAGED'].includes(currentStatus ?? '')) {
      if (['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(currentStatus ?? '')) {
        assetImportWorkspace.setOperation(null);
        operationId = null;
      } else {
        throw new Error('已有一项导入正在处理中，请先完成、取消或恢复它。');
      }
    }

    if (operationId === null) {
      operationId = crypto.randomUUID();
      const draftItems = assetImportWorkspace.snapshot().draftItems;
      await context.client.createOperation({
        operationId,
        items: draftItems.map((item) => ({
          itemId: item.itemId,
          sourceName: item.sourceName,
          declaredBytes: item.bytes,
        })),
      });
      requireCurrentAssetImportAction(context);
      const createdDetail = await context.client.queryOperation(operationId);
      requireCurrentAssetImportAction(context);
      assetImportWorkspace.setOperation(createdDetail);
      if (await finishRequestedAssetImportCancellation(context, operationId)) return;
      assetImportWorkspace.setMessage('正在上传');
      for (const item of draftItems) {
        await context.client.uploadItem(operationId, item.itemId, item.file, (loaded, total) => {
          if (assetImportActionIsCurrent(context)) assetImportWorkspace.updateProgress(item.itemId, loaded, total);
        });
        requireCurrentAssetImportAction(context);
        if (await finishRequestedAssetImportCancellation(context, operationId)) return;
      }
    }

    const planned = await context.client.plan(operationId, { targets: currentAssetImportTargets() });
    requireCurrentAssetImportAction(context);
    if (await finishRequestedAssetImportCancellation(context, operationId)) return;
    const detail = await context.client.queryOperation(operationId);
    requireCurrentAssetImportAction(context);
    assetImportWorkspace.setOperation(detail);
    assetImportWorkspace.setMessage(planned.plan.status === 'ready'
      ? '检查完成。确认无误后即可写入项目。'
      : '发现同名或命名冲突。Surdet 不会覆盖现有文件，请修改名称后重新检查。');
  }, true);
}

async function commitAssetImport(): Promise<void> {
  await runAssetImportAction('正在写入项目', async (context) => {
    const detail = assetImportWorkspace.snapshot().activeOperation;
    if (detail === null || detail.plan === null || detail.plan.status !== 'ready') {
      throw new Error('请先完成导入检查并处理所有冲突。');
    }
    const operationId = detail.operation.operationId;
    const planFingerprint = detail.plan.planFingerprint;
    if (detail.operation.status === 'STAGED') {
      await context.client.seal(operationId, { planFingerprint });
      requireCurrentAssetImportAction(context);
      const sealed = await context.client.queryOperation(operationId);
      requireCurrentAssetImportAction(context);
      assetImportWorkspace.setOperation(sealed);
    }
    await context.client.commit(operationId, planFingerprint);
    requireCurrentAssetImportAction(context);
    const committed = await context.client.queryOperation(operationId);
    requireCurrentAssetImportAction(context);
    assetImportWorkspace.setOperation(committed);
    assetImportWorkspace.clearDraft();
    try {
      await refreshProjectAssetIntelligence();
      requireCurrentAssetImportAction(context);
    } catch {
      if (!assetImportActionIsCurrent(context)) return;
      assetImportWorkspace.setMessage('素材已经写入项目，但列表刷新未完成。请重新打开项目后查看。');
      return;
    }
    const firstImportedPath = committed.receipt?.files[0]?.targetPath ?? null;
    if (firstImportedPath !== null) state.assetCenterSelectedId = `file:${firstImportedPath.replaceAll('\\', '/')}`;
    assetImportWorkspace.setMessage('导入完成');
  });
}

async function cancelAssetImport(): Promise<void> {
  const detail = assetImportWorkspace.snapshot().activeOperation;
  if (assetImportActionRunning) {
    if (assetImportActionCancellable) {
      assetImportCancelRequested = true;
      assetImportWorkspace.setMessage('正在停止当前导入检查；已完成的数据不会写入项目。');
    } else {
      assetImportWorkspace.setMessage('正在写入项目，完成前不能中断。');
    }
    return;
  }
  if (detail === null || ['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(detail.operation.status)) {
    assetImportPanelOpen = false;
    assetImportWorkspace.clearDraft();
    assetImportWorkspace.setOperation(null);
    assetImportWorkspace.setMessage(null);
    return;
  }
  await runAssetImportAction('正在取消导入…', async (context) => {
    const operationId = detail.operation.operationId;
    try {
      await context.client.cancel(operationId);
    } catch (error) {
      if (!(error instanceof AssetImportClientError) || error.code !== 'IMPORT_OPERATION_NOT_AUTHORIZED') throw error;
      await context.client.resume(operationId);
      requireCurrentAssetImportAction(context);
      await context.client.cancel(operationId);
    }
    requireCurrentAssetImportAction(context);
    const cancelled = await context.client.queryOperation(operationId);
    requireCurrentAssetImportAction(context);
    assetImportWorkspace.setOperation(cancelled);
    assetImportWorkspace.clearDraft();
    assetImportWorkspace.setMessage('导入已取消，项目文件没有变化。');
  });
}

async function recoverAssetImport(operationId: string, action: 'resume' | 'rollback'): Promise<void> {
  await runAssetImportAction(action === 'resume' ? '正在恢复导入…' : '正在安全回退导入…', async (context) => {
    const resumed = await context.client.resume(operationId);
    requireCurrentAssetImportAction(context);
    assetImportWorkspace.setOperation(resumed);
    if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(resumed.operation.status)) {
      const recoveryAction = resumed.operation.status === 'UNDOING' ? 'resume' : action;
      const recovered = await context.client.recover(operationId, { action: recoveryAction });
      requireCurrentAssetImportAction(context);
      assetImportWorkspace.setOperation(recovered);
    }
    if (action === 'rollback') {
      await refreshProjectAssetIntelligence();
      requireCurrentAssetImportAction(context);
    }
    assetImportWorkspace.setMessage(action === 'resume' ? '导入已恢复，可以继续。' : '导入已回退，项目已重新核对。');
  });
}

async function undoAssetImport(): Promise<void> {
  const detail = assetImportWorkspace.snapshot().activeOperation;
  const receipt = detail?.receipt ?? null;
  if (detail === null || receipt === null) return;
  await runAssetImportAction('正在撤销本次导入…', async (context) => {
    const operationId = detail.operation.operationId;
    await context.client.resume(operationId);
    requireCurrentAssetImportAction(context);
    await context.client.undo(operationId, {
      receiptId: receipt.receiptId,
      receiptSha256: receipt.receiptSha256,
    });
    requireCurrentAssetImportAction(context);
    const undone = await context.client.queryOperation(operationId);
    requireCurrentAssetImportAction(context);
    assetImportWorkspace.setOperation(undone);
    try {
      await refreshProjectAssetIntelligence();
      requireCurrentAssetImportAction(context);
    } catch {
      if (!assetImportActionIsCurrent(context)) return;
      assetImportWorkspace.setMessage('素材已撤销，但列表刷新未完成。请重新打开项目后核对。');
      return;
    }
    assetImportWorkspace.setMessage('已撤销，恢复副本仍由 Surdet 保留。');
  });
}

async function openAssetImportReceipt(operationId: string): Promise<void> {
  await runAssetImportAction('正在读取导入回执…', async (context) => {
    const detail = await context.client.queryOperation(operationId);
    requireCurrentAssetImportAction(context);
    assetImportWorkspace.setOperation(detail);
    assetImportWorkspace.setMessage(detail.receipt === null ? '这次导入还没有完成回执。' : '已读取导入回执。');
  });
}

function openImportedAsset(): void {
  const targetPath = assetImportWorkspace.snapshot().activeOperation?.receipt?.files[0]?.targetPath;
  if (targetPath) state.assetCenterSelectedId = `file:${targetPath.replaceAll('\\', '/')}`;
  assetImportPanelOpen = false;
  if (state.mainTab === 'assets') renderMainArea();
}

function hasDirtyProjectFiles(): boolean {
  return [...state.scenes.values()].some(({ dirty }) => dirty)
    || state.timelines.some(({ dirty }) => dirty)
    || state.pendingSceneDeletes.length > 0
    || state.pendingSceneCommit !== null
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0
    || inspectConfigDraftState().dirty
    || hasReviewDraft(state.reviewWorkspace);
}

interface AssetRelocationActionContext {
  actionId: number;
  generation: number;
  client: typeof assetImportClient;
  projectRoot: FileSystemDirectoryHandle | null;
}

function assetRelocationActionIsCurrent(context: AssetRelocationActionContext): boolean {
  return context.actionId === assetRelocationActionSequence
    && context.generation === assetImportGeneration
    && context.client === assetImportClient
    && context.projectRoot === state.dirHandle;
}

function requireCurrentAssetRelocationAction(context: AssetRelocationActionContext): void {
  if (!assetRelocationActionIsCurrent(context)) throw new Error('项目已经切换，旧素材整理已停止。');
}

function setAssetRelocationWriteLock(locked: boolean): void {
  state.projectWriteLock = locked ? 'asset-relocation' : null;
  refreshProjectBarProjection();
}

async function runAssetRelocationAction(
  message: string,
  action: (context: AssetRelocationActionContext) => Promise<void>,
  options: { releaseOnError?: boolean } = {},
): Promise<void> {
  if (assetRelocationWorkspace.snapshot().busy) return;
  const context: AssetRelocationActionContext = {
    actionId: ++assetRelocationActionSequence,
    generation: assetImportGeneration,
    client: assetImportClient,
    projectRoot: state.dirHandle,
  };
  assetRelocationWorkspace.setBusy(true);
  assetRelocationWorkspace.setMessage(message);
  if (state.mainTab === 'assets') renderMainArea();
  try {
    await action(context);
  } catch (error) {
    if (assetRelocationActionIsCurrent(context)) {
      assetRelocationWorkspace.setMessage(assetImportErrorMessage(error));
      if (options.releaseOnError === true || assetRelocationWorkspace.snapshot().detail === null) {
        setAssetRelocationWriteLock(false);
      }
    }
  } finally {
    if (context.actionId === assetRelocationActionSequence) {
      assetRelocationWorkspace.setBusy(false);
      if (state.mainTab === 'assets') renderMainArea();
    }
  }
}

function assetRelocationAvailabilityMessage(): string | null {
  if (state.dirHandle === null) return '请先打开一个本地项目。';
  if (hasDirtyProjectFiles()) return '请先保存当前场景和时间轴修改，再整理素材。';
  if (assetImportActionRunning) return '素材导入正在进行，请完成后再整理素材。';
  const importProjection = assetImportWorkspace.snapshot();
  if (importProjection.entryState === 'ready') return null;
  if (importProjection.entryState === 'recoverable' || importProjection.entryState === 'manual-recovery') {
    return '项目中有尚未结束的素材写入，请先完成恢复。';
  }
  return importProjection.message ?? '本机素材权限服务尚未绑定当前项目。';
}

function assetRelocationSourceForItem(item: ProjectAssetItem, targetDirectory?: string): AssetRelocationSource | null {
  if (!item.sourcePath || !PROJECT_ASSET_RELOCATION_KINDS.includes(item.kind)) return null;
  return {
    assetId: item.assetId,
    sourcePath: item.sourcePath,
    kind: item.kind as AssetRelocationSource['kind'],
    targetDirectory: targetDirectory ?? item.sourcePath.split('/').slice(0, -1).join('/'),
    fileName: item.sourcePath.split('/').at(-1) ?? '',
  };
}

async function prepareAssetReplacement(item: ProjectAssetItem, file: File): Promise<void> {
  const source = assetRelocationSourceForItem(item);
  const root = state.dirHandle, generation = assetImportGeneration;
  if (!source || assetRelocationAvailabilityMessage() !== null || assetRelocationWorkspace.snapshot().busy || file.size <= 0 || file.size > AGENT_IMAGE_MAX_BYTES) {
    assetRelocationWorkspace.setMessage('请先保存项目、结束其他素材操作，并选择大小受支持的同格式文件。'); return;
  }
  await waitForProjectWritesToSettle();
  if (root !== state.dirHandle || generation !== assetImportGeneration || hasDirtyProjectFiles()) return;
  assetRelocationWorkspace.begin(source);
  setAssetRelocationWriteLock(true);
  await runAssetRelocationAction('正在读取新文件并准备原位替换…', async context => {
    if (!context.client.relocationReplace) throw new Error('当前素材服务尚未支持原位替换');
    const bytes = await file.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    requireCurrentAssetRelocationAction(context);
    const operationId = crypto.randomUUID();
    let planned: Awaited<ReturnType<NonNullable<typeof context.client.relocationReplace>>>;
    try { planned = await context.client.relocationReplace({ operationId, targetPath: source.sourcePath, sourcePath: file.name, sha256 }, new Blob([bytes])); }
    catch (error) {
      try { planned = await context.client.relocationResume(operationId); }
      catch { throw error; }
    }
    requireCurrentAssetRelocationAction(context);
    assetRelocationWorkspace.setDetail(planned.detail);
    assetRelocationWorkspace.setMessage(planned.detail.plan.replacement?.noChange
      ? '新旧文件内容相同，不会改动原素材。' : '替换计划已准备。原文件尚未改变；核对摘要及引用后再确认替换。');
  });
}

function beginAssetRelocation(item: ProjectAssetItem, targetDirectory: string): void {
  const source = assetRelocationSourceForItem(item, targetDirectory);
  if (source === null) return;
  const issue = assetRelocationAvailabilityMessage();
  if (issue !== null) {
    assetRelocationWorkspace.setMessage(issue);
    renderMainArea();
    return;
  }
  assetRelocationWorkspace.begin(source);
  renderMainArea();
}

function beginAssetRelocationBatch(): void {
  const issue = assetRelocationAvailabilityMessage();
  if (issue !== null) {
    assetRelocationWorkspace.setMessage(issue);
    renderMainArea();
    return;
  }
  assetRelocationWorkspace.beginBatch();
  renderMainArea();
}

function selectAssetRelocationBatchItem(item: ProjectAssetItem, selected: boolean): void {
  const source = assetRelocationSourceForItem(item);
  if (source === null || assetRelocationWorkspace.snapshot().mode !== 'batch') return;
  if (selected) assetRelocationWorkspace.select(source);
  else assetRelocationWorkspace.unselect(item.assetId);
  renderMainArea();
}

function openAssetRelocationBatchEditor(): void {
  assetRelocationWorkspace.openBatchEditor();
  renderMainArea();
}

function returnToAssetRelocationBatchSelection(): void {
  assetRelocationWorkspace.returnToBatchSelection();
  renderMainArea();
}

function batchRelocationMoves(snapshot = assetRelocationWorkspace.snapshot()): Array<{ sourcePath: string; targetPath: string }> {
  return snapshot.selection.map((source) => ({
    sourcePath: source.sourcePath,
    targetPath: `${snapshot.targetDirectory}/${snapshot.fileNames[source.assetId] ?? source.fileName}`,
  })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)
    || left.targetPath.localeCompare(right.targetPath));
}

function sameRelocationMoves(
  left: readonly { sourcePath: string; targetPath: string }[],
  right: readonly { sourcePath: string; targetPath: string }[],
): boolean {
  const normalizedLeft = [...left].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.targetPath.localeCompare(b.targetPath));
  const normalizedRight = [...right].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.targetPath.localeCompare(b.targetPath));
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((move, index) => move.sourcePath === normalizedRight[index]?.sourcePath
      && move.targetPath === normalizedRight[index]?.targetPath);
}

async function checkAssetRelocationImpact(): Promise<void> {
  const snapshot = assetRelocationWorkspace.snapshot();
  const batch = snapshot.mode === 'batch';
  if ((!batch && snapshot.source === null) || (batch && (!snapshot.batchEditing || snapshot.selection.length === 0))) return;
  if (hasDirtyProjectFiles()) {
    assetRelocationWorkspace.setMessage('请先保存当前项目修改，再检查整理影响。');
    renderMainArea();
    return;
  }
  try {
    await waitForProjectWritesToSettle();
  } catch (error) {
    assetRelocationWorkspace.setMessage(error instanceof Error ? error.message : String(error));
    renderMainArea();
    return;
  }
  const requestedMoves = batch ? batchRelocationMoves(snapshot) : [];
  const current = assetRelocationWorkspace.snapshot();
  if (batch) {
    if (current.mode !== 'batch' || !current.batchEditing || !sameRelocationMoves(requestedMoves, batchRelocationMoves(current))) return;
  } else if (current.source?.sourcePath !== snapshot.source!.sourcePath
    || current.targetDirectory !== snapshot.targetDirectory || current.fileName.trim() !== snapshot.fileName.trim()) return;
  if (hasDirtyProjectFiles()) {
    assetRelocationWorkspace.setMessage('等待期间项目内容发生变化，请先保存后重新检查。');
    renderMainArea();
    return;
  }
  setAssetRelocationWriteLock(true);
  await runAssetRelocationAction(batch ? '正在检查整批引用影响…' : '正在检查引用影响…', async (context) => {
    let planned: Awaited<ReturnType<typeof context.client.relocationPlan>>;
    const operationId = crypto.randomUUID();
    try {
      planned = await context.client.relocationPlan(batch
        ? { operationId, moves: requestedMoves }
        : {
          operationId,
          sourcePath: snapshot.source!.sourcePath,
          targetDirectory: snapshot.targetDirectory,
          fileName: snapshot.fileName.trim(),
        });
    } catch (error) {
      try {
        const discovery = await context.client.relocationList();
        const pending = discovery.operations.find((operation) => (
          operation.operationId === operationId
          || (batch
            ? sameRelocationMoves(operation.moves, requestedMoves)
            : operation.sourcePath === snapshot.source!.sourcePath
              && operation.targetPath === `${snapshot.targetDirectory}/${snapshot.fileName.trim()}`)
        ));
        if (pending === undefined) throw error;
        planned = await context.client.relocationResume(pending.operationId);
      } catch {
        throw error;
      }
    }
    requireCurrentAssetRelocationAction(context);
    if (batch) assetRelocationWorkspace.setBatchDetail(planned.detail);
    else assetRelocationWorkspace.setDetail(planned.detail);
    assetRelocationWorkspace.setMessage(planned.detail.plan.status === 'ready'
      ? batch
        ? '检查完成。确认无误后即可一次整理所选素材并更新引用。'
        : '检查完成。确认无误后即可移动素材并更新引用。'
      : '发现不能自动处理的内容，请查看原因或修改目标。');
  });
}

async function cancelRemoteAssetRelocation(keepEditor: boolean): Promise<void> {
  const snapshot = assetRelocationWorkspace.snapshot();
  const detail = snapshot.detail;
  if (detail === null) {
    setAssetRelocationWriteLock(false);
    if (!keepEditor) assetRelocationWorkspace.reset();
    if (state.mainTab === 'assets') renderMainArea();
    return;
  }
  if (['COMMITTED', 'UNDONE', 'ROLLED_BACK', 'CANCELLED'].includes(detail.operation.status)) {
    setAssetRelocationWriteLock(false);
    if (keepEditor) {
      assetRelocationWorkspace.setDetail(null);
      assetRelocationWorkspace.setMessage(null);
    } else {
      assetRelocationWorkspace.reset();
    }
    if (state.mainTab === 'assets') renderMainArea();
    return;
  }
  await runAssetRelocationAction('正在取消素材整理…', async (context) => {
    try {
      await context.client.relocationCancel(detail.operation.operationId);
    } catch (error) {
      if (!(error instanceof AssetImportClientError) || error.code !== 'IMPORT_OPERATION_NOT_AUTHORIZED') throw error;
      await context.client.relocationResume(detail.operation.operationId);
      requireCurrentAssetRelocationAction(context);
      await context.client.relocationCancel(detail.operation.operationId);
    }
    requireCurrentAssetRelocationAction(context);
    setAssetRelocationWriteLock(false);
    if (keepEditor) {
      assetRelocationWorkspace.setDetail(null);
      assetRelocationWorkspace.setMessage(null);
    } else {
      assetRelocationWorkspace.reset();
    }
  }, { releaseOnError: false });
}

async function projectAssetRelocationDetail(
  context: AssetRelocationActionContext,
  detail: AssetRelocationDetail,
): Promise<boolean> {
  requireCurrentAssetRelocationAction(context);
  const batch = detail.request.moves.length > 1 || assetRelocationWorkspace.snapshot().mode === 'batch';
  if (batch) assetRelocationWorkspace.setBatchDetail(detail);
  else assetRelocationWorkspace.setDetail(detail);
  const status = detail.operation.status;
  if (['RECOVERY_REQUIRED', 'PUBLISHING', 'ROLLING_BACK', 'UNDOING'].includes(status)) {
    setAssetRelocationWriteLock(true);
    assetRelocationWorkspace.setMessage('素材整理尚未完整结束，请继续恢复或安全回退。');
    return true;
  }
  if (!['COMMITTED', 'UNDONE', 'ROLLED_BACK', 'CANCELLED'].includes(status)) return false;
  const firstMove = detail.request.moves[0];
  const selectedPath = status === 'COMMITTED'
    ? firstMove?.targetPath ?? detail.request.targetPath
    : firstMove?.sourcePath ?? detail.request.sourcePath;
  await reloadCurrentProjectFromHandle({ mainTab: 'assets', selectedAssetId: `file:${selectedPath}` });
  requireCurrentAssetRelocationAction(context);
  setAssetRelocationWriteLock(false);
  const messages: Record<string, string> = {
    COMMITTED: '整理完成，项目已经重新载入。',
    UNDONE: '已撤销本次整理，项目已经重新载入。',
    ROLLED_BACK: '素材整理已安全回退，项目已经重新载入。',
    CANCELLED: '本次素材整理已取消。',
  };
  assetRelocationWorkspace.setMessage(messages[status] ?? '素材整理状态已更新。');
  return true;
}

async function reconcileAssetRelocationMutation(
  context: AssetRelocationActionContext,
  operationId: string,
): Promise<boolean> {
  try {
    const refreshed = await context.client.relocationResume(operationId);
    requireCurrentAssetRelocationAction(context);
    return await projectAssetRelocationDetail(context, refreshed.detail);
  } catch {
    return false;
  }
}

async function commitAssetRelocation(): Promise<void> {
  const detail = assetRelocationWorkspace.snapshot().detail;
  if (detail === null || detail.plan.status !== 'ready') return;
  await runAssetRelocationAction(detail.plan.replacement ? '正在原位替换素材字节…' : '正在移动素材并更新引用…', async (context) => {
    await context.client.relocationResume(detail.operation.operationId);
    requireCurrentAssetRelocationAction(context);
    try {
      const committed = await context.client.relocationCommit(
        detail.operation.operationId,
        detail.plan.planFingerprint,
      );
      await projectAssetRelocationDetail(context, committed);
    } catch (error) {
      if (await reconcileAssetRelocationMutation(context, detail.operation.operationId)) return;
      throw error;
    }
  });
}

async function undoAssetRelocation(): Promise<void> {
  const detail = assetRelocationWorkspace.snapshot().detail;
  if (detail?.receipt === null || detail?.receipt === undefined) return;
  setAssetRelocationWriteLock(true);
  await runAssetRelocationAction('正在撤销本次素材整理…', async (context) => {
    await context.client.relocationResume(detail.operation.operationId);
    requireCurrentAssetRelocationAction(context);
    try {
      const undone = await context.client.relocationUndo(detail.operation.operationId, {
        receiptId: detail.receipt!.receiptId,
        receiptFingerprint: detail.receipt!.receiptFingerprint,
      });
      await projectAssetRelocationDetail(context, undone);
    } catch (error) {
      if (await reconcileAssetRelocationMutation(context, detail.operation.operationId)) return;
      throw error;
    }
  }, { releaseOnError: false });
}

async function recoverAssetRelocation(action: 'resume' | 'rollback'): Promise<void> {
  const detail = assetRelocationWorkspace.snapshot().detail;
  if (detail === null) return;
  setAssetRelocationWriteLock(true);
  await runAssetRelocationAction(action === 'resume' ? '正在恢复素材整理…' : '正在安全回退素材整理…', async (context) => {
    const resumed = await context.client.relocationResume(detail.operation.operationId);
    requireCurrentAssetRelocationAction(context);
    assetRelocationWorkspace.setDetail(resumed.detail);
    try {
      const recovered = await context.client.relocationRecover(detail.operation.operationId, { action });
      await projectAssetRelocationDetail(context, recovered);
    } catch (error) {
      if (await reconcileAssetRelocationMutation(context, detail.operation.operationId)) return;
      throw error;
    }
  });
}

function relocationMatchesItem(item: ProjectAssetItem): boolean {
  const snapshot = assetRelocationWorkspace.snapshot();
  if (snapshot.source?.assetId === item.assetId) return true;
  if (snapshot.selection.some((source) => source.assetId === item.assetId)) return true;
  return snapshot.detail?.request.moves.some((move) => move.targetPath === item.sourcePath) === true;
}

async function selectAssetCenterItem(item: ProjectAssetItem, restoreKeyboardFocus: boolean): Promise<void> {
  const snapshot = assetRelocationWorkspace.snapshot();
  if (snapshot.busy) return;
  if (snapshot.mode === 'single' && snapshot.source !== null && !relocationMatchesItem(item)) {
    if (snapshot.detail !== null && !['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(snapshot.detail.operation.status)) {
      await cancelRemoteAssetRelocation(false);
      if (assetRelocationWorkspace.snapshot().detail !== null) return;
    } else {
      assetRelocationWorkspace.reset();
      setAssetRelocationWriteLock(false);
    }
  }
  state.assetCenterSelectedId = item.assetId;
  renderMainArea();
  if (restoreKeyboardFocus) {
    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-asset-id]')]
        .find((candidate) => candidate.dataset.assetId === item.assetId);
      if (row?.matches('[role="option"]')) row.focus();
      else row?.querySelector<HTMLButtonElement>('.asset-center-detail-button')?.focus();
    });
  }
}

function viewAssetRelocationTarget(): void {
  const detail = assetRelocationWorkspace.snapshot().detail;
  if (detail === null) return;
  const firstMove = detail.request.moves[0];
  const path = detail.operation.status === 'COMMITTED'
    ? firstMove?.targetPath ?? detail.request.targetPath
    : firstMove?.sourcePath ?? detail.request.sourcePath;
  state.assetCenterSelectedId = `file:${path}`;
  renderMainArea();
}

function currentObjectLabel(): string {
  if (state.reviewWorkspace !== null) return '审阅任务';
  if (state.mainTab === 'assets') return '素材中心';
  if (state.mainTab === 'config') return '项目配置';
  if (state.mainTab === 'stats') return '项目统计';
  if (state.mainTab === 'history') return '内容历史';
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
  let projectName = state.dirName || '未打开项目';
  try {
    const title = parseProjectConfigDocument(state.gameConfigText || '{}').title;
    if (typeof title === 'string' && title.trim()) projectName = title;
  } catch { /* Keep the directory identity when source configuration cannot be read. */ }
  const hasDirtyFiles = hasDirtyProjectFiles();
  const saveState: ProjectSaveState = hasDirtyFiles
    ? saveAttemptLeftDirty ? 'partial-failure' : 'dirty'
    : 'saved';
  const sceneRecoveryLocked = sceneAutosaveRecoveryPhase !== 'idle';
  const relay = editorWorkspaceStatus();
  const sceneHistory = state.current === null ? undefined : histories.get(state.current);
  let depth = { past: sceneHistory?.past.length ?? 0, future: sceneHistory?.future.length ?? 0 };
  if (state.mainTab === 'config') depth = configHistoryDepth();
  else if (state.mainTab === 'timeline') {
    const timeline = state.currentTimeline === null ? { undo: 0, redo: 0 } : timelineHistoryDepth(state.currentTimeline);
    depth = { past: timeline.undo, future: timeline.redo };
  }
  return {
    relayProtection: relay.protection,
    relayUpdate: relay.update,
    relayDirty: relay.dirty,
    problems: problemSummary(),
    projectName,
    objectLabel: currentObjectLabel(),
    saveState,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
    fsSupported: state.fsSupported,
    hasScenes: state.scenes.size > 0,
    writeLocked: state.projectWriteLock !== null || sceneRecoveryLocked || relay.saving || sceneLifecycleActionRunning
      || state.reviewWorkspace?.authority.state === 'submitting',
    ...(relay.saving ? { writeLockLabel: '正在保存', writeLockTitle: '保存完成后可继续操作' } : {}),
    ...(sceneRecoveryLocked ? {
      writeLockLabel: sceneAutosaveRecoveryPhase === 'running'
        ? '正在恢复上次未完成的保存'
        : '自动恢复需要重试',
      writeLockTitle: sceneAutosaveRecoveryPhase === 'running'
        ? '恢复完成前暂停编辑和项目切换'
        : '请在自动恢复面板下载备份、重试或处理冲突',
    } : {}),
  };
}

function refreshProjectBarProjection(): void {
  publishEditorWorkspaceState();
  updateProjectBarProjection(projectBarProjection());
}

function markProjectEdited(): void {
  saveAttemptLeftDirty = false;
  refreshProjectBarProjection();
  refreshStoryChecks();
}

function handleTimelineEdited(): void {
  markProjectEdited();
  scheduleValidate();
  scheduleAuthoringIndexRebuild();
}

async function saveProject(): Promise<void> {
  if (sceneAutosaveRecoveryPhase !== 'idle') {
    setStatus('自动恢复尚未收束，现在不能保存', false, 5000);
    return;
  }
  try {
    await saveAll();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '当前不能保存项目', false, 5000);
  }
  refreshProjectBarProjection();
}

async function viewProjectChanges(): Promise<void> {
  const root = state.dirHandle;
  if (root === null) return;
  try {
    const snapshot = await pollEditorWorkspace(true);
    const freshAssets = await collectProjectAssets(root, true);
    if (state.dirHandle !== root) return;
    if (snapshot === null) throw new Error('工作区尚未连接');
    const diskFiles = new Map<string, { path: string; text: string; bytes: number; sha256: string }>();
    const diskStorage = {
      rootIdentity: 'bound-editor-change-inspection',
      listFiles: async () => snapshot.diskBaseline.files.map(file => file.path),
      exists: async (path: string) => snapshot.diskBaseline.files.some(file => file.path === path),
      readText: async (path: string) => {
        const existing = diskFiles.get(path);
        if (existing) return existing;
        const parts = path.split('/');
        const name = parts.pop()!;
        let directory = root;
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        const file = await (await directory.getFileHandle(name)).getFile();
        const bytes = await file.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const result = { path, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), bytes: bytes.byteLength,
          sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
        diskFiles.set(path, result);
        return result;
      },
    };
    const freshSnapshot = await loadProjectSnapshot(diskStorage, { sha256: sceneTextSha256 });
    const gallery = await diskStorage.exists('content/config/gallery.json')
      ? JSON.parse((await diskStorage.readText('content/config/gallery.json')).text) : undefined;
    const freshIntelligence = buildProjectAssetIntelligence(freshSnapshot, freshAssets.flatMap(asset => asset.sourcePath?.startsWith('content/assets/')
      ? [{ path: asset.sourcePath, bytes: asset.bytes }] : []), { gallery });
    if (state.dirHandle !== root) return;
    const changes = editorWorkspaceTextChanges();
    const freshFacts = new Map(freshAssets.filter(asset => asset.sourcePath !== undefined)
      .map(asset => [asset.sourcePath!, `${asset.bytes}:${asset.lastModified}:${asset.kind}`]));
    const assetChanges = [...new Set([...loadedWorkspaceAssets.keys(), ...freshFacts.keys()])]
      .filter(path => loadedWorkspaceAssets.get(path) !== freshFacts.get(path)).sort();
    document.getElementById('editor-project-changes')?.remove();
    const dialog = h('dialog', 'editor-project-changes-dialog');
    dialog.id = 'editor-project-changes';
    dialog.append(h('h2', undefined, '项目变化范围'));
    dialog.append(h('p', 'dim', `已重新扫描 ${freshIntelligence.summary.fileCount} 个素材文件。`));
    const textChanges = changes?.all ?? [];
    if (changes === null) dialog.append(h('p', undefined, '尚未记录读取基线，请显式同步项目后继续编辑。'));
    const groups: Array<[string, string[]]> = [['新增文本', changes?.created ?? []], ['修改文本', changes?.modified ?? []],
      ['删除文本', changes?.deleted ?? []], ['素材变化', assetChanges]];
    for (const [label, paths] of groups) {
      if (paths.length === 0) continue;
      dialog.append(h('h3', undefined, `${label}（${paths.length}）`));
      const list = h('ul');
      for (const path of paths) list.append(h('li', undefined, path));
      dialog.append(list);
    }
    if (changes !== null && textChanges.length === 0 && assetChanges.length === 0) {
      dialog.append(h('p', undefined, '与当前读取基线相比，没有检测到文件变化。'));
    }
    const latest = editorWorkspaceStatus().latest?.mutationNotice;
    if (latest) {
      const initiator = latest.initiator === 'external-agent' ? 'Agent' : latest.initiator === 'human-editor' ? '编辑器' : '项目操作';
      dialog.append(h('p', 'dim', `最近一次写入来自${initiator}；以上范围按完整读取基线比较。`));
    }
    const close = h('button', undefined, '关闭');
    close.onclick = () => dialog.close();
    dialog.append(close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  } catch (error) {
    setStatus(`无法读取变化范围：${error instanceof Error ? error.message : String(error)}`, false, 6000);
  }
}

async function syncProject(discardDrafts = false): Promise<boolean> {
  if (editorWorkspaceStatus().protection === 'unavailable' || state.dirHandle === null) return false;
  try {
    await waitForProjectWritesToSettle();
    if (state.projectWriteLock !== null || sceneAutosaveRecoveryPhase !== 'idle' || sceneLifecycleActionRunning
      || pendingAutosaveTimelineConflicts.length > 0) {
      throw new Error('当前操作尚未完成，请稍后同步项目。');
    }
    if (state.pendingSceneCommit !== null) throw new Error('上次保存的结果尚未确认，请先重试保存或完成恢复；当前草稿会保留。');
    if (hasDirtyProjectFiles() && !discardDrafts) throw new Error('草稿仍未保存，请选择保留或放弃草稿。');
    if (discardDrafts && hasDirtyProjectFiles() && !window.confirm('要放弃未保存的修改，重新读取硬盘上的项目吗？')) return false;
    const previous = { mainTab: state.mainTab, sceneKey: state.current,
      sceneId: state.current === null ? undefined : state.scenes.get(state.current)?.id,
      timelineId: state.currentTimeline, selectedAssetId: state.assetCenterSelectedId };
    const previousSelection = state.selectedObjectRef;
    const previousIndex = state.authoringIndex;
    const reviewWorkspace = state.reviewWorkspace;
    disposePreviewPanel();
    disposeScriptV4();
    document.getElementById('main')?.setAttribute('inert', '');
    state.selectedObjectRef = null;
    await reloadCurrentProjectFromHandle({ ...previous, preserveReviewWorkspace: reviewWorkspace !== null });
    if (discardDrafts && reviewWorkspace !== null) discardReviewDraft(reviewWorkspace);
    state.reviewWorkspace = reviewWorkspace;
    if (reviewWorkspace !== null) await refreshReviewFixtureIdentity(reviewWorkspace);
    await refreshAuthoringIndexImmediately();
    if (state.authoringIndex !== null) {
      state.selectedObjectRef = reconcileAuthoringSelection(previousSelection, previousIndex, state.authoringIndex, true);
    }
    saveAttemptLeftDirty = false;
    blockedSceneAutosave = null;
    pendingAutosaveTimelineConflicts = [];
    if (state.autosaveProjectId) clearAutosave(state.autosaveProjectId);
    renderAll();
    await pollEditorWorkspace(true);
    setStatus(previousSelection !== null && state.selectedObjectRef === null
      ? '项目已同步；原选中对象已变化，已清空选择。' : '项目已同步，可以继续编辑。', true, 6000);
    return true;
  } catch (error) {
    document.getElementById('main')?.toggleAttribute('inert', sceneAutosaveRecoveryPhase !== 'idle');
    setStatus(`项目未同步：${error instanceof Error ? error.message : String(error)}`, false, 8000);
    return false;
  }
}

function rememberReviewPreparation(decision: ReviewPreparationReference): void {
  sessionStorage.setItem(PREPARATION_SESSION_KEY, JSON.stringify(decision));
}

async function openPreparedReview(source: ReviewWorkspaceState, decision: ReviewPreparationReference): Promise<void> {
  const config = globalThis.__SURDET_REVIEW_AUTHORITY__;
  if (!config) throw new Error('本机审阅服务未连接。');
  const client = createReviewPreparationClient({ token: config.token });
  const prepared = await openReviewWorkspace(client.directory(decision, 'result'));
  if (state.reviewWorkspace !== source || state.mainTab !== 'review') throw new Error('审阅页面已切换，结果已保留，回到原审阅后可以打开。');
  if (prepared.projection.finalResult?.plan.review.reviewState !== 'human-reviewed'
    || prepared.projection.finalResult.plan.review.decisionFingerprint !== decision.decisionFingerprint) {
    throw new Error('生成结果与保存决定不一致，未打开。');
  }
  // Switching only the review leaves the current source buffers and their drafts intact.
  state.reviewWorkspace = prepared;
  state.selectedObjectRef = null;
  renderMainArea();
  document.querySelector<HTMLElement>('[data-action="preview-result"]')?.focus();
  setStatus('试玩结果已准备好，可以查看和试玩。', true, 6000);
}

async function restoreReviewPreparation(): Promise<void> {
  const config = globalThis.__SURDET_REVIEW_AUTHORITY__;
  if (!config) return;
  try {
    const saved = sessionStorage.getItem(PREPARATION_SESSION_KEY);
    if (!saved) return;
    const decision: unknown = JSON.parse(saved);
    if (!isReviewPreparationReference(decision)) throw new Error('保存的准备入口无法核对。');
    const client = createReviewPreparationClient({ token: config.token });
    const progress = await client.status(decision, 'inspect-preparation');
    const ready = progress.stage === 'ready' && !progress.working;
    const workspace = await openReviewWorkspace(client.directory(decision, ready ? 'result' : 'comparison'));
    if (state.dirHandle !== null || state.reviewWorkspace !== null || hasDirtyProjectFiles() || state.projectLoading) return;
    state.reviewWorkspace = workspace; state.mainTab = 'review'; renderMainArea();
    setStatus(ready ? '已打开此前准备的试玩结果。' : '已找回准备进度，可以继续。', true, 6000);
  } catch (error) { setStatus(preparationErrorMessage(error), false, 8000); }
}

function reviewApplyEditor(workspace: ReviewWorkspaceState): ExistingEditorSyncPort {
  const identity = (): string | null => boundReviewProject?.handle === state.dirHandle
    && editorWorkspaceStatus().protection === 'connected' ? boundReviewProject.projectIdentity : null;
  const transitioning = (): boolean => state.projectLoading || authoringProjectChanging
    || state.projectWriteLock !== null || sceneAutosaveRecoveryPhase !== 'idle'
    || sceneLifecycleActionRunning || editorWorkspaceStatus().saving || pendingAutosaveTimelineConflicts.length > 0;
  const assertWorkspace = (): void => {
    if (state.reviewWorkspace !== workspace) throw new Error('审阅任务已经切换，未继续操作旧项目。');
  };
  return {
    async inspect() {
      assertWorkspace();
      return { projectIdentity: identity(), hasUnsavedDrafts: hasDirtyProjectFiles(), transitioning: transitioning() };
    },
    async synchronize(projectIdentity) {
      assertWorkspace();
      if (hasDirtyProjectFiles() || transitioning()) throw new Error('请先处理当前草稿或正在进行的操作。');
      let root = boundReviewProject?.projectIdentity === projectIdentity ? boundReviewProject.handle : null;
      if (root === null) {
        const picker = (window as unknown as { showDirectoryPicker: (options: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
        root = await picker({ id: 'surdet-source-project', mode: 'readwrite' });
        assertWorkspace();
        const probe = createAssetImportAuthorityClient();
        try {
          // The existing challenge proves the handle is the server's bound source
          // directory. Asset-import identities use a separate inode-based scheme.
          await probe.bindProject(root);
        } finally { probe.dispose(); }
      }
      assertWorkspace();
      await waitForProjectWritesToSettle();
      assertWorkspace();
      if (hasDirtyProjectFiles() || transitioning()) throw new Error('工作区出现新的草稿或操作，未加载项目。');
      if (root === state.dirHandle) {
        if (!await syncProject()) throw new Error('项目同步未成功，请检查工作区提示。');
      } else {
        const sceneId = state.current === null ? undefined : state.scenes.get(state.current)?.id;
        await openProjectFromHandle(root, { preserveReviewWorkspace: true });
        state.current = [...state.scenes].find(([, scene]) => scene.id === (sceneId ?? state.entryScene))?.[0]
          ?? state.current;
        await refreshAuthoringIndexImmediately();
        await pollEditorWorkspace(true);
      }
      assertWorkspace();
      const currentIdentity = identity();
      if (currentIdentity !== projectIdentity || transitioning() || editorWorkspaceStatus().update !== 'none') {
        throw new Error('未确认完整加载了目标项目的当前内容，请重新检查。');
      }
      return { projectIdentity: currentIdentity, loadedCurrentDisk: true };
    },
    async continueWriting(projectIdentity) {
      assertWorkspace();
      if (identity() !== projectIdentity || transitioning()) throw new Error('当前编辑器不是这次写回的项目，未进入剧本。');
      const key = state.current !== null && state.scenes.has(state.current) ? state.current
        : [...state.scenes].find(([, scene]) => scene.id === state.entryScene)?.[0];
      if (key === undefined) throw new Error('项目中没有可继续编辑的入口场景。');
      jumpToScene(key);
      if (state.mainTab !== 'editor' || state.current !== key) throw new Error('剧本工作面尚未打开。');
      sessionStorage.removeItem(PREPARATION_SESSION_KEY);
    },
  };
}

function reviewTaskBadge() {
  const count = reviewTaskPendingCount();
  return count > 0 ? { count, hint: `${count} 个待审阅任务` } : undefined;
}

function reviewTaskListFor(workspace: ReviewWorkspaceState | null): HTMLElement | null {
  return renderReviewTaskList({
    workspace,
    onRefresh: () => refreshReviewTasks(reviewTasksChanged),
    onSettled: reviewTasksChanged,
    onOpen: async (task, open) => {
      try {
        setStatus(task.kind === 'integration-result' ? '正在读取最终结果…' : '正在打开审阅任务…', true);
        if (!await openListedReviewTask(open, message => window.confirm(message))) {
          setStatus('已保留当前审阅及其修改，未打开其他任务', true, 5000);
          return;
        }
        renderAll();
        setStatus('已打开审阅任务', true, 4000);
        refreshReviewTasks(reviewTasksChanged);
      } catch (error) {
        setStatus(`打开审阅任务失败：${error instanceof Error ? error.message : String(error)}`, false, 6000);
      }
    },
    onReturnToSource: async () => {
      const workspace = state.reviewWorkspace;
      if (workspace === null || returningFromReviewPreview) return;
      returningFromReviewPreview = true;
      try {
        // The existing protected path back from a result preview; the review stays open.
        await reviewApplyEditor(workspace).synchronize(workspace.identity.projectIdentity);
        if (state.reviewWorkspace !== workspace) return;
        state.mainTab = 'review';
        renderAll();
        setStatus('已回到来源项目，可以重新检查或批准正式结果', true, 5000);
        refreshReviewTasks(reviewTasksChanged);
      } catch (error) {
        setStatus(`回到来源项目失败：${error instanceof Error ? error.message : String(error)}`, false, 6000);
        reviewTasksChanged();
      } finally {
        returningFromReviewPreview = false;
      }
    },
  });
}

/** Updates the rail count in place and redraws only the task list, never an open review's inputs. */
function reviewTasksChanged(): void {
  updateModeNavigationBadge('review', reviewTaskBadge());
  if (state.mainTab !== 'review') return;
  const view = document.getElementById('review-view');
  if (view === null) return;
  if (state.reviewWorkspace === null) {
    renderReviewPanel(view, null, { taskList: reviewTaskListFor });
    return;
  }
  const existing = view.querySelector<HTMLDetailsElement>('.review-discovery');
  const next = reviewTaskListFor(state.reviewWorkspace);
  if (next instanceof HTMLDetailsElement && existing?.open) next.open = true;
  if (existing !== null && next !== null) existing.replaceWith(next);
  else if (existing !== null) existing.remove();
  else if (next !== null) view.querySelector('.review-workspace-header')?.appendChild(next);
}

function confirmProjectSwitch(): boolean {
  if (sceneAutosaveRecoveryPhase !== 'idle') {
    setStatus('自动恢复尚未收束，现在不能切换项目', false, 5000);
    return false;
  }
  if (state.pendingSceneDeletes.length > 0 || state.pendingSceneCommit !== null) {
    setStatus('当前仍有待保存的场景改名或删除，请先保存全部', false, 5000);
    return false;
  }
  return !hasDirtyProjectFiles()
    || window.confirm('当前项目还有未保存修改。切换项目会放弃这些修改，确定继续吗？');
}

/** Only the real desktop main page offers creation; the browser build and preview frames never do. */
function desktopProjectCreation(): ProjectCreation | null {
  const bridge = window.surdetDesktop;
  if (!bridge || typeof bridge.createProject !== 'function' || typeof bridge.chooseProjectLocation !== 'function') return null;
  projectCreation ??= createProjectCreation(bridge, () => { if (projectCreationView?.root.isConnected) projectCreationView.refresh(); });
  return projectCreation;
}

function setProjectCreationOpen(open: boolean): void {
  projectCreationOpen = open;
  renderMainArea();
  if (open) document.getElementById('new-project-name')?.focus();
  else document.querySelector<HTMLButtonElement>('.editor-welcome-actions [data-welcome-action="new-project"]')?.focus();
}

/** Desktop start page: directories the person already opened, resolved by the main process. */
function renderRecentProjects(bridge: NonNullable<Window['surdetDesktop']>): HTMLElement {
  const section = h('section', 'editor-welcome-recent');
  section.setAttribute('aria-label', '最近项目');
  const list = h('div', 'editor-welcome-recent-list');
  section.append(h('h2', undefined, '最近项目'), list);
  void bridge.recentProjects().then((projects) => {
    if (!section.isConnected) return;
    if (projects.length === 0) { list.append(h('p', 'editor-welcome-recent-empty', '打开过的项目会显示在这里。')); return; }
    for (const project of projects) {
      const control = h('button', 'editor-welcome-recent-item');
      control.type = 'button';
      control.title = project.location;
      const when = new Date(project.openedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      control.append(h('strong', undefined, project.name), h('small', undefined, project.location), h('time', undefined, when));
      control.onclick = () => {
        void bridge.openRecentProject(project.id).catch((error: unknown) => {
          setStatus(desktopErrorMessage(error, '无法打开最近项目'), false, 6000);
        });
      };
      list.append(control);
    }
  }, () => { if (section.isConnected) list.append(h('p', 'editor-welcome-recent-empty', '暂时无法读取最近项目。')); });
  return section;
}

async function openProjectSafely(): Promise<void> {
  if (window.surdetDesktop) {
    try { await window.surdetDesktop.openProject(); }
    catch (error) { setStatus(error instanceof Error ? error.message : '无法打开项目', false, 5000); }
    return;
  }
  if (!confirmProjectSwitch()) return;
  try {
    await openProject();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setStatus(error instanceof Error ? error.message : '当前无法打开项目', false, 5000);
  }
}

function loadDemoProjectSafely(): void {
  if (!confirmProjectSwitch()) return;
  try {
    loadDemoProject();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '当前无法切换演示项目', false, 5000);
  }
}

async function runSceneLifecycleAction(operation: () => Promise<void>): Promise<void> {
  sceneLifecycleActionRunning = true;
  refreshProjectBarProjection();
  try {
    await operation();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '当前无法修改场景', false, 5000);
  } finally {
    sceneLifecycleActionRunning = false;
    renderMainArea();
    refreshProjectBarProjection();
  }
}

function scheduleAuthoringIndexRebuild(): void {
  authoringRevision += 1;
  state.assetIntelligenceState = 'loading';
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

function waitForAuthoringRevision(revision: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    authoringWaiters.push({ revision, resolve, reject });
  });
}

function settleAuthoringWaiters(
  revision: number,
  outcome: { ok: true } | { ok: false; error: unknown },
): void {
  for (let index = authoringWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = authoringWaiters[index]!;
    if (waiter.revision > revision) continue;
    authoringWaiters.splice(index, 1);
    if (outcome.ok) waiter.resolve();
    else waiter.reject(outcome.error);
  }
}

/** 导入提交后使用：跳过防抖，但仍服从既有单飞与过期结果丢弃规则。 */
async function refreshAuthoringIndexImmediately(): Promise<void> {
  authoringRevision += 1;
  const revision = authoringRevision;
  state.assetIntelligenceState = 'loading';
  const settled = waitForAuthoringRevision(revision);
  if (authoringRunning) {
    authoringQueued = true;
  } else {
    if (authoringTimer) clearTimeout(authoringTimer);
    authoringTimer = null;
    void rebuildAuthoringIndex();
  }
  await settled;
}

async function rebuildAuthoringIndex(): Promise<void> {
  if (authoringProjectChanging) {
    authoringQueued = true;
    return;
  }
  if (authoringRunning) {
    authoringQueued = true;
    return;
  }
  authoringRunning = true;
  const revision = authoringRevision;
  try {
    const snapshot = await loadEditorProjectSnapshot();
    const index = buildObjectIndex(snapshot);
    const assetFiles = state.dirAssets.flatMap((asset) => (
      asset.sourcePath?.startsWith('content/assets/')
        ? [{ path: asset.sourcePath, ...(asset.bytes === undefined ? {} : { bytes: asset.bytes }) }]
        : []
    ));
    const assetIntelligence = buildProjectAssetIntelligence(snapshot, assetFiles, { gallery: state.configFiles.gallery });
    if (revision === authoringRevision && !authoringProjectChanging) {
      const previousIndex = state.authoringIndex;
      state.selectedObjectRef = reconcileAuthoringSelection(state.selectedObjectRef, previousIndex, index);
      state.authoringIndex = index;
      state.assetIntelligence = assetIntelligence;
      state.assetIntelligenceState = 'ready';
      if (state.assetCenterSelectedId && !assetIntelligence.items.some((item) => item.assetId === state.assetCenterSelectedId)) {
        state.assetCenterSelectedId = null;
      }
      refreshEditorObjectRefs();
      updateCausalPanel();
      if (state.mainTab === 'assets') renderMainArea();
      settleAuthoringWaiters(revision, { ok: true });
    } else {
      authoringQueued = true;
    }
  } catch (error) {
    if (revision === authoringRevision && !authoringProjectChanging) {
      state.authoringIndex = null;
      state.assetIntelligence = null;
      state.assetIntelligenceState = 'error';
      refreshEditorObjectRefs();
      updateCausalPanel();
      if (state.mainTab === 'assets') renderMainArea();
      settleAuthoringWaiters(revision, { ok: false, error });
    }
  } finally {
    authoringRunning = false;
    if (!authoringProjectChanging && (authoringQueued || revision !== authoringRevision)) {
      authoringQueued = false;
      scheduleAuthoringIndexRebuild();
    }
  }
}

function resetAuthoringState(): void {
  resetStoryChecks();
  state.selectedObjectRef = null;
  state.authoringIndex = null;
  state.assetIntelligence = null;
  state.assetIntelligenceState = 'loading';
  state.assetCenterSelectedId = null;
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
bindEditorWorkspaceHooks({
  facts: () => ({
    sceneDirty: [...state.scenes.values()].some(scene => scene.dirty) || state.pendingSceneDeletes.length > 0 || state.pendingSceneCommit !== null,
    timelineDirty: state.timelines.some(timeline => timeline.dirty) || state.pendingTimelineDeletes.length > 0 || state.pendingTimelineRestores.size > 0,
    configDirty: inspectConfigDraftState().dirty,
    reviewDirty: hasReviewDraft(state.reviewWorkspace),
    projectTransition: state.projectLoading,
    assetImportWriting: assetImportActionRunning,
    assetRelocationWriting: assetRelocationWorkspace.snapshot().busy || state.projectWriteLock === 'asset-relocation',
    sceneLifecycleWriting: sceneLifecycleActionRunning,
    autosaveRecoveryBlocked: sceneAutosaveRecoveryPhase !== 'idle' || pendingAutosaveTimelineConflicts.length > 0,
  }),
  onChanged: refreshProjectBarProjection,
});
bindProjectIoHooks({
  renderAll,
  runValidate: () => { runValidate(); scheduleAuthoringIndexRebuild(); },
  renderSidebar,
  onAssetsRefreshed: refreshAuthoringIndexImmediately,
  onSceneMutationPlan: async (input) => {
    const planned = await assetImportClient.scenePlan({
      operationId: crypto.randomUUID(),
      kind: input.kind,
      sourcePath: input.sourcePath,
      ...(input.kind === 'rename' ? { targetPath: input.targetPath } : {}),
    }, currentEditorWorkspaceWrite());
    return { operationId: planned.operationId, planFingerprint: planned.planFingerprint };
  },
  onSceneMutationCommit: async (input) => {
    const write = currentEditorWorkspaceWrite();
    const result = await assetImportClient.sceneCommit({
      requestId: input.requestId,
      ...(input.configRenames === undefined ? {} : { configRenames: input.configRenames }),
      plans: input.plans,
      writes: input.writes,
    }, write);
    recordEditorSceneCommit(write, result);
    return result;
  },
  onSceneCommitStateChanged: () => persistCurrentAutosave(Date.now()),
  onProjectClosing: closeCurrentProjectRuntime,
  onProjectStateReset: () => {
    invalidatePendingValidation();
    resetConfigSession();
    resetSearchSession();
  },
  onProjectReading: async (root, readProject, reopen) => {
    if (state.dirHandle !== null && editorWorkspaceStatus().protection !== 'unavailable'
      && (root === state.dirHandle || await root.isSameEntry(state.dirHandle))) {
      const baseline = await readEditorWorkspaceBaseline(readProject);
      if (reopen) await bindCurrentProjectAssetImport(baseline);
      return;
    }
    // 新目录先独立核验并取基线；读取失败时不拆掉旧项目的连接和草稿。
    const probe = createAssetImportAuthorityClient();
    let baseline: ProjectDiskBaseline | null = null;
    try {
      await probe.bindProject(root);
      baseline = (await probe.workspace.snapshot(crypto.randomUUID())).diskBaseline;
    } catch {
      // 普通未绑定目录仍可打开；未知基线不能在随后绑定成功时冒充已读取的版本。
    } finally { probe.dispose(); }
    await readProject();
    await bindCurrentProjectAssetImport(baseline);
  },
  onProjectLoadSettled: (succeeded) => {
    authoringProjectChanging = false;
    authoringQueued = false;
    if (!succeeded && authoringTimer) {
      clearTimeout(authoringTimer);
      authoringTimer = null;
    }
    if (succeeded) loadedWorkspaceAssets = new Map(state.dirAssets.filter(asset => asset.sourcePath !== undefined)
      .map(asset => [asset.sourcePath!, `${asset.bytes}:${asset.lastModified}:${asset.kind}`]));
    refreshProjectBarProjection();
    if (succeeded) void pollEditorWorkspace().catch(() => {});
  },
  onProjectLoaded: () => {
    authoringProjectChanging = false;
    saveAttemptLeftDirty = false;
    blockedSceneAutosave = null;
    pendingAutosaveTimelineConflicts = [];
    clearTimelineViewStates();
    resetAuthoringState();
    refreshProjectBarProjection();
    startCurrentProjectAutosaveRecovery(Promise.resolve());
  },
  hasDirtyConfigDrafts: () => inspectConfigDraftState().dirty,
  saveConfigDrafts: saveDirtyConfigSections,
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
  onRenameScene: (sceneKey) => { void runSceneLifecycleAction(() => renameSceneAtKey(sceneKey)); },
  onMoveScene: (sceneKey) => { void runSceneLifecycleAction(() => moveSceneAtKey(sceneKey)); },
  onDeleteScene: (sceneKey) => { void runSceneLifecycleAction(() => deleteSceneAtKey(sceneKey)); },
});
bindAssetsPanelHooks({
  onInserted: () => renderEditor(),
  onOpenCenter: () => {
    state.mainTab = 'assets';
    renderMainArea();
  },
});
bindRightNavigation({
  onJumpScene: (sceneKey) => jumpToScene(sceneKey),
});
bindFlowHooks({
  prepareConfigRename: prepareConfigSceneRename,
  // 流程图导航：切回块编辑标签页并选中场景；双击标签节点时滚动到该 @label 行
  openScene: (sceneKey, line) => jumpToScene(sceneKey, line !== undefined ? Math.max(0, line - 1) : undefined),
  // 流程图结构变更（重命名/删除）后重新调度校验
  requestValidate: () => {
    markProjectEdited();
    scheduleValidate();
    scheduleAuthoringIndexRebuild();
  },
  onRenameScene: (sceneId) => { void runSceneLifecycleAction(() => renameScene(sceneId)); },
  onDeleteScene: (sceneId) => { void runSceneLifecycleAction(() => deleteScene(sceneId)); },
});
bindConfigHooks({
  stageSharedAssets: files => {
    if (assetImportFileSetLocked()) throw new Error('当前素材导入尚未结束，请完成或取消后重试');
    const added = assetImportWorkspace.addFiles(files);
    for (const item of added) assetImportWorkspace.updateFile(item.itemId, { kind: /\.(?:ttf|otf|woff2)$/i.test(item.fileName) ? 'font' : 'background' });
    assetImportWorkspace.setMessage('来自界面共享文件的依赖。保持文件名称，完成导入后再次导入该共享文件。');
    assetImportPanelOpen = true; state.mainTab = 'assets'; renderMainArea();
  },
  // 配置保存后重新调度校验（新变量/成就即刻参与 lint）
  requestValidate: () => { scheduleValidate(); scheduleAuthoringIndexRebuild(); },
  onDraftStateChanged: () => { refreshProjectBarProjection(); refreshPreviewSourceState(); refreshStoryChecks(); },
});
bindLabelEditingHooks({ prepareConfig: prepareConfigLabelRename, onEdited: () => {
  markProjectEdited(); renderSidebar(); refreshManuscriptFacts(); refreshCurrentSceneContext();
  scheduleValidate(); scheduleAuthoringIndexRebuild();
} });
bindStageEditingHooks({ onTimelineEdited: handleTimelineEdited });
bindTimelineHooks({
  onPreview: (timelineId) => {
    state.previewTimelineId = timelineId;
    state.mainTab = 'preview';
    renderMainArea();
  },
  onOpenAssets: () => {
    state.mainTab = 'assets';
    renderMainArea();
  },
  onEdited: handleTimelineEdited,
  onSelectionChanged: refreshProjectBarProjection,
});

/** 跳转定位（流程图导航与搜索结果共用）：切块编辑标签页 + 选中场景 + 滚动到指定行 */
function jumpToScene(sceneKey: string, line?: number, range?: SourceRange): void {
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
    if (!revealScriptV4Line(Math.max(0, line), range)) {
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    }
  }
}

function openAssetReference(reference: ProjectAssetReference): void {
  if (reference.sourceKind === 'scene') {
    const sceneKey = [...state.scenes.entries()].find(([, scene]) => {
      const path = scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`;
      return path === reference.sourcePath;
    })?.[0];
    if (sceneKey) {
      jumpToScene(sceneKey, reference.line === undefined ? undefined : Math.max(0, reference.line - 1));
      return;
    }
  }
  if (reference.sourceKind === 'timeline' && jumpToTimelineObjectIfNeeded(reference.objectRef ?? null)) return;
  if (reference.sourceKind === 'character' || reference.sourceKind === 'gallery') {
    state.mainTab = 'config';
    renderMainArea();
    setStatus('已打开项目配置；当前版本暂时无法精确定位到该配置行', true, 4500);
    return;
  }
  setStatus('这处引用暂时无法精确定位，素材信息仍可继续查看', false, 4500);
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
  onJump: (sceneKey, line, range) => jumpToScene(sceneKey, line, range),
  onTimeline: (id) => navigateTimeline(id),
  onConfig: () => navigateMode('config'),
  onValidationApplied: () => {
    if (state.mainTab !== 'audit') return;
    const audit = document.getElementById('audit-view');
    if (audit) renderAuditPanel(audit);
  },
});
bindStatsHooks({
  onJump: (sceneKey) => jumpToScene(sceneKey),
});
bindAuditHooks({
  // 审计条目点击 → 跳转定位（与搜索/流程图导航同一入口）
  onJump: (sceneKey, line) => jumpToScene(sceneKey, line),
  // 称谓问题一键加变体 → 路由到配置页的 terminology 写盘入口（保持面板无环依赖）
  onAddVariant: (canonical, variant) => { void addTerminologyVariant(canonical, variant); },
});

/* ============================ 布局渲染 ============================ */

const appEl = document.getElementById('app')!;

bindV4Navigation({
  onMode: (mode) => {
    if (state.projectLoading || sceneAutosaveRecoveryPhase !== 'idle' || state.projectWriteLock !== null) {
      setStatus('请先完成当前恢复或素材整理操作', false, 5000); return;
    }
    state.previewTimelineId = null;
    state.mainTab = mode;
    renderMainArea();
  },
  onTimeline: (id, cue) => {
    if (state.projectLoading || sceneAutosaveRecoveryPhase !== 'idle' || state.projectWriteLock !== null) return;
    if (!state.timelines.some((entry) => entry.id === id)) {
      setStatus('引用的时间轴不存在，请先检查项目内容', false, 5000); return;
    }
    state.currentTimeline = id;
    state.currentTimelineCue = cue ?? null;
    state.previewTimelineId = null;
    state.mainTab = 'timeline';
    renderMainArea();
  },
  onAsset: (id) => {
    if (state.projectLoading || sceneAutosaveRecoveryPhase !== 'idle' || state.projectWriteLock !== null) return;
    const item = state.assetIntelligence?.items.find((candidate) => candidate.assetId === id);
    if (!item) { setStatus('素材事实已变化，请重新读取', false, 5000); return; }
    state.assetCenterQuery = '';
    state.assetCenterKind = 'all';
    state.assetCenterStatus = 'all';
    state.assetCenterFolder = 'all';
    state.mainTab = 'assets';
    state.assetCenterSelectedId = id;
    renderMainArea();
    void selectAssetCenterItem(item, true);
  },
});

function renderAll(): void {
  disposeAuthoringWorkbench();
  disposeScriptV4();
  disposePreviewPanel();
  disposeV4SurfaceViews();
  disposeUiDesigner();
  disposeUiPlayerPreview();
  appEl.innerHTML = '';
  const header = renderProjectBar(projectBarProjection(), {
    onOpenProject: () => { void openProjectSafely(); },
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
    onLoadDemo: loadDemoProjectSafely,
    onExportCurrent: exportCurrent,
    onSearch: searchProject,
  });
  appEl.appendChild(header);

  if (!state.fsSupported && state.scenes.size === 0) {
    const banner = h('div', 'banner');
    banner.textContent = '当前浏览器不支持直接读写本地目录。请使用 Chrome 或 Edge 浏览器打开，点击「打开项目」选择游戏项目根目录；也可先加载演示项目体验编辑与校验。';
    appEl.appendChild(banner);
  }

  const main = h('main');
  main.id = 'main';
  main.className = 'editor-application-frame';
  main.toggleAttribute('inert', sceneAutosaveRecoveryPhase !== 'idle');
  main.setAttribute('data-autosave-recovery', sceneAutosaveRecoveryPhase);
  if (sceneAutosaveRecoveryPhase === 'running') main.setAttribute('aria-busy', 'true');
  appEl.appendChild(main);
  appEl.appendChild(renderStatusBar(projectBarProjection(), {
    onViewProjectChanges: () => { void viewProjectChanges(); },
    onSyncProject: () => { void syncProject(); },
    onDiscardProjectDrafts: () => { void syncProject(true); },
    onKeepProjectDrafts: () => setStatus('草稿已保留，可继续编辑或导出当前场景。', true, 5000),
    onShowProblems: showProblems,
  }));
  renderMainArea();
  renderBlockedSceneRecovery();
}

/** 主区：标签页（块编辑 / 流程图 / 时间轴 / 配置 / 预览 / 统计 / 审计）+ 对应内容 */
function renderMainArea(): void {
  disposeAuthoringWorkbench();
  hideAssetPreview();
  disposeStoryCheckPanel();
  const main = document.getElementById('main');
  if (!main) return;
  if (state.reviewPreviewReadOnly && ['editor', 'assets', 'flow', 'timeline', 'config', 'audit', 'history'].includes(state.mainTab)) {
    const requestedMode = state.mainTab;
    const workspace = state.reviewWorkspace;
    state.mainTab = 'review';
    if (workspace !== null && !returningFromReviewPreview) {
      returningFromReviewPreview = true;
      const editor = reviewApplyEditor(workspace);
      void editor.synchronize(workspace.identity.projectIdentity).then(async () => {
        if (state.reviewWorkspace !== workspace) return;
        if (requestedMode === 'editor') await editor.continueWriting(workspace.identity.projectIdentity);
        else { state.mainTab = requestedMode; renderMainArea(); }
      }).catch((error) => {
        setStatus(`尚未返回来源项目：${error instanceof Error ? error.message : String(error)}`, false, 8000);
      }).finally(() => { returningFromReviewPreview = false; });
    }
    // Never mount editable controls against an immutable generated result,
    // including navigation from trace links and other panels.
  }
  if (state.reviewWorkspace === null) { disposeReviewApply(); disposeReviewPreparation(); }
  disposeScriptV4();
  disposePreviewPanel();
  disposeV4SurfaceViews();
  disposeUiDesigner();
  disposeUiPlayerPreview();
  if (state.mainTab !== 'assets') {
    disposeAssetCenterPreview();
    disposeAssetCenterThumbnails();
  }
  main.innerHTML = '';
  const navigation = renderModeNavigation(state.mainTab, (mode) => {
      if (state.projectLoading) return;
      if (state.projectWriteLock === 'asset-relocation' && mode !== 'assets') {
        setStatus('素材整理进行中，完成或取消后才能离开素材中心', false, 5000);
        return;
      }
      state.previewTimelineId = null;
      state.mainTab = mode;
      renderMainArea();
  }, { review: reviewTaskBadge() });
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
    if (state.scenes.size === 0 && state.dirHandle === null) {
      const welcome = h('section', 'editor-welcome');
      welcome.setAttribute('aria-label', '开始创作');
      const creation = desktopProjectCreation();
      const introduction = h('div', 'editor-welcome-intro');
      const shortcuts = h('dl', 'editor-welcome-shortcuts');
      for (const [key, label] of [['Ctrl+K', '搜索场景、台词、角色和素材'], ['Ctrl+S', '保存全部修改'], ['Ctrl+Z / Ctrl+Y', '撤销与重做']]) {
        shortcuts.append(h('dt', undefined, key), h('dd', undefined, label));
      }
      introduction.append(
        h('h1', undefined, '开始创作'),
        h('p', undefined, creation ? '新建一个作品，或打开已有的项目文件夹。' : '打开一个游戏项目文件夹继续写作。'),
        shortcuts,
      );
      const actions = h('div', 'editor-welcome-actions');
      if (creation && projectCreationOpen) {
        projectCreationView = renderProjectCreation(creation, () => setProjectCreationOpen(false));
        actions.append(projectCreationView.root);
        welcome.append(introduction, actions); col.append(welcome); refreshProjectBarProjection(); return;
      }
      if (creation) {
        const control = h('button'); control.type = 'button'; control.dataset['welcomeAction'] = 'new-project'; const label = h('span');
        label.append(h('strong', undefined, '新建项目'), h('small', undefined, '示例或空白模板'));
        control.append(workbenchIcon('blank'), label);
        control.onclick = () => setProjectCreationOpen(true);
        actions.append(control);
      }
      for (const [action, icon, title, description] of [
        [state.fsSupported ? 'open-project' : 'load-demo', 'folder', state.fsSupported ? '打开项目文件夹' : '加载演示项目', state.fsSupported ? '包含 game.config.json 的目录' : '当前浏览器不能直接读写本地目录，可先体验编辑与校验'],
        ...(state.fsSupported ? [['open-review', 'open-review', '打开审阅任务', '比较 Agent 交付的候选']] : []),
      ]) {
        const control = h('button'); control.type = 'button'; const label = h('span');
        label.append(h('strong', undefined, title), h('small', undefined, description));
        control.append(workbenchIcon(icon!), label);
        control.onclick = () => document.querySelector<HTMLButtonElement>(`.editor-project-bar [data-action="${action}"]`)?.click();
        actions.append(control);
      }
      if (window.surdetDesktop) actions.append(renderRecentProjects(window.surdetDesktop));
      welcome.append(introduction, actions); col.append(welcome); refreshProjectBarProjection(); return;
    }
    const workbench = buildAuthoringWorkbench();
    col.appendChild(workbench.root);
    renderSidebar();
    renderSearchPanel(workbench.search);
    renderEditor();
    renderIssues();
    renderRightExtras();
  } else if (state.mainTab === 'assets') {
    const assetsEl = h('section');
    assetsEl.id = 'asset-center-view';
    col.appendChild(assetsEl);
    renderAssetCenter(assetsEl, {
      onOpenProject: () => { void openProjectSafely(); },
      onOpenReference: (reference) => {
        if (state.projectWriteLock === 'asset-relocation') {
          assetRelocationWorkspace.setMessage('请先完成或取消素材整理，再打开引用位置。');
          renderMainArea();
          return;
        }
        openAssetReference(reference);
      },
      onSelectAsset: (item, restoreKeyboardFocus) => { void selectAssetCenterItem(item, restoreKeyboardFocus); },
      assetImportOpen: assetImportPanelOpen,
      onToggleImport: () => {
        if (state.projectWriteLock === 'asset-relocation') {
          assetRelocationWorkspace.setMessage('请先完成或取消素材整理。');
          renderMainArea();
          return;
        }
        assetImportPanelOpen = !assetImportPanelOpen;
        renderMainArea();
      },
      assetImport: {
        workspace: assetImportWorkspace,
        busy: assetImportActionRunning,
        onSelectFiles: (files) => {
          if (assetImportFileSetLocked()) return;
          const added = assetImportWorkspace.addFiles(files);
          assetImportWorkspace.setMessage(`已加入 ${added.length} 个文件，请继续检查分类和名称。`);
        },
        onRemoveFile: (itemId) => {
          if (!assetImportFileSetLocked()) assetImportWorkspace.removeFile(itemId);
        },
        onUpdateFile: (itemId, update) => {
          if (assetImportActionRunning) return;
          const status = assetImportWorkspace.snapshot().activeOperation?.operation.status;
          if (status !== undefined && status !== 'STAGED') return;
          assetImportWorkspace.updateFile(itemId, update);
          const active = assetImportWorkspace.snapshot().activeOperation;
          if (active?.operation.status === 'STAGED' && active.plan !== null) {
            assetImportWorkspace.setOperation({ ...active, plan: null });
            assetImportWorkspace.setMessage('分类或名称已修改，请重新检查导入位置。');
          }
        },
        onBindProject: () => { void bindCurrentProjectAssetImport(); },
        onRecoverOperation: (operationId, action) => { void recoverAssetImport(operationId, action); },
        onPrepareImport: () => { void prepareAssetImport(); },
        onCommitImport: () => { void commitAssetImport(); },
        onCancelImport: () => { void cancelAssetImport(); },
        onOpenReceipt: (operationId) => { void openAssetImportReceipt(operationId); },
        onViewImportedAssets: openImportedAsset,
        onUndoImport: () => { void undoAssetImport(); },
        refreshProjectAssetIntelligence,
      },
      assetRelocation: {
        workspace: assetRelocationWorkspace.snapshot(),
        availabilityMessage: assetRelocationAvailabilityMessage(),
        onBegin: beginAssetRelocation,
        onReplace: (item, file) => { void prepareAssetReplacement(item, file); },
        onBeginBatch: beginAssetRelocationBatch,
        onSelectBatchItem: selectAssetRelocationBatchItem,
        onSetVisibleBatchItems: (assetIds) => assetRelocationWorkspace.setVisibleAssetIds(assetIds),
        onOpenBatchEditor: openAssetRelocationBatchEditor,
        onReturnToBatchSelection: returnToAssetRelocationBatchSelection,
        onUpdateTarget: (update) => assetRelocationWorkspace.updateTarget(update),
        onUpdateBatchTarget: (update) => assetRelocationWorkspace.updateBatchTarget(update),
        onCheckImpact: () => { void checkAssetRelocationImpact(); },
        onCommit: () => { void commitAssetRelocation(); },
        onModify: () => { void cancelRemoteAssetRelocation(true); },
        onCancel: () => { void cancelRemoteAssetRelocation(false); },
        onUndo: () => { void undoAssetRelocation(); },
        onRecover: (action) => { void recoverAssetRelocation(action); },
        onViewTarget: viewAssetRelocationTarget,
      },
    });
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
    pvEl.dataset['editorPanel'] = 'preview';
    col.appendChild(pvEl);
    renderPreviewPanel(pvEl, { onDebugSource: source => {
      const target = [...state.scenes.entries()].find(([, scene]) => scene.id === source.sceneId);
      if (target) jumpToScene(target[0], source.line - 1);
    } });
  } else if (state.mainTab === 'history') {
    const historyEl = h('section'); historyEl.id = 'history-view'; historyEl.dataset['editorPanel'] = 'history';
    col.appendChild(historyEl);
    renderContentHistoryPanel(historyEl, {
      assertReady: () => {
        if (hasDirtyProjectFiles() || state.projectLoading || authoringProjectChanging || state.projectWriteLock !== null
          || sceneAutosaveRecoveryPhase !== 'idle' || sceneLifecycleActionRunning || editorWorkspaceStatus().saving
          || state.reviewPreviewReadOnly || state.reviewWorkspace !== null) {
          throw new Error('请先保存或撤销当前草稿，并完成正在进行的操作，再记录或恢复历史。');
        }
      },
      onRestored: () => { scheduleValidate(); persistCurrentAutosave(Date.now()); publishEditorWorkspaceState(); renderAll(); setStatus('已恢复为草稿，保存全部后写入项目。', true, 5000); },
    });
  } else if (state.mainTab === 'stats') {
    const stEl = h('section');
    stEl.id = 'stats-view';
    stEl.dataset['editorPanel'] = 'stats';
    col.appendChild(stEl);
    renderStatsPanel(stEl);
    renderStoryCheckPanel(stEl, (file, line) => {
      const scene = [...state.scenes.entries()].find(([, entry]) =>
        (entry.file.startsWith('content/scenario/') ? entry.file : `content/scenario/${entry.file}`) === file);
      if (scene) jumpToScene(scene[0], line);
    });
    renderAssetInsights(stEl);
  } else if (state.mainTab === 'audit') {
    const auEl = h('section');
    auEl.id = 'audit-view';
    auEl.dataset['editorPanel'] = 'audit';
    col.appendChild(auEl);
    renderAuditPanel(auEl);
  } else if (state.mainTab === 'review') {
    const reviewEl = h('section');
    reviewEl.id = 'review-view';
    reviewEl.dataset['editorPanel'] = 'review';
    col.appendChild(reviewEl);
    renderReviewPanel(reviewEl, state.reviewWorkspace,
      state.reviewWorkspace === null ? { taskList: reviewTaskListFor } : {
        taskList: reviewTaskListFor,
        reviewApplyEditor: reviewApplyEditor(state.reviewWorkspace),
        onRememberPreparation: rememberReviewPreparation,
        onOpenPreparedResult: openPreparedReview,
        onPreview: async (workspace, request) => {
          if (hasDirtyProjectFiles() || state.projectLoading || authoringProjectChanging
              || state.projectWriteLock !== null || sceneAutosaveRecoveryPhase !== 'idle'
              || sceneLifecycleActionRunning || editorWorkspaceStatus().saving) {
            throw new Error('请先保存当前草稿并完成正在进行的操作，再预览审阅结果。');
          }
          // A listed result is shown from a checked display copy; checks keep reading the formal directory.
          await openReviewPreview(workspace, request, undefined, reviewTaskPreviewDirectory(workspace) ?? undefined);
        },
      });
  } else {
    const cfgEl = h('section');
    cfgEl.id = 'config-view';
    col.appendChild(cfgEl);
    renderConfig(cfgEl);
  }
  refreshProjectBarProjection();
  // Entering the review page re-reads the directory; the list is never kept as a content snapshot.
  const enteringReview = state.mainTab === 'review' && renderedMainTab !== 'review';
  renderedMainTab = state.mainTab;
  if (enteringReview) refreshReviewTasks(reviewTasksChanged);
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
  if (sceneAutosaveRecoveryPhase !== 'idle') {
    setStatus('自动恢复尚未收束，现在不能撤销', false, 5000);
    return;
  }
  if (state.projectWriteLock === 'asset-relocation') {
    setStatus('素材整理进行中，完成后才能撤销其他编辑', false, 5000);
    return;
  }
  if (state.mainTab === 'config') configUndo();
  else if (state.mainTab === 'timeline') applyTimelineHistory('undo');
  else undo();
}
function doRedo(): void {
  if (sceneAutosaveRecoveryPhase !== 'idle') {
    setStatus('自动恢复尚未收束，现在不能重做', false, 5000);
    return;
  }
  if (state.projectWriteLock === 'asset-relocation') {
    setStatus('素材整理进行中，完成后才能重做其他编辑', false, 5000);
    return;
  }
  if (state.mainTab === 'config') configRedo();
  else if (state.mainTab === 'timeline') applyTimelineHistory('redo');
  else redo();
}

/* ============================ 快捷键 ============================ */

function searchProject(): void {
  if (state.projectLoading || sceneAutosaveRecoveryPhase !== 'idle' || state.projectWriteLock !== null) {
    setStatus('请先完成当前项目操作，再使用搜索导航', false, 5000); return;
  }
  openProjectSearch({ onScene: jumpToScene, onMode: navigateMode, onTimeline: navigateTimeline });
}

/** Status bar problems: open the existing list in the script workspace and focus its first entry. */
function showProblems(): void {
  if (state.mainTab !== 'editor') navigateMode('editor');
  const context = document.querySelector<HTMLDetailsElement>('details.v4-project-context');
  const box = document.getElementById('issues-box');
  if (state.mainTab !== 'editor' || !context || !box) return;
  context.open = true;
  // Narrow windows show one workbench panel at a time.
  const panel = document.querySelector<HTMLButtonElement>('[data-workbench-panel="context"]');
  if (panel && panel.offsetParent !== null && panel.getAttribute('aria-pressed') !== 'true') panel.click();
  box.scrollIntoView({ block: 'nearest' });
  (box.querySelector<HTMLElement>('button.issue') ?? box).focus({ preventScroll: true });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'F8' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (state.projectLoading || sceneAutosaveRecoveryPhase !== 'idle' || state.projectWriteLock !== null) {
      setStatus('请先完成当前恢复或素材整理操作', false, 5000); return;
    }
    stepProblem(e.shiftKey ? -1 : 1); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); searchProject(); return;
  }
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
    if (sceneAutosaveRecoveryPhase !== 'idle') {
      setStatus('自动恢复尚未收束，现在不能切换工作区', false, 5000);
      return;
    }
    if (state.projectWriteLock === 'asset-relocation') {
      setStatus('素材整理进行中，完成或取消后才能离开素材中心', false, 5000);
      return;
    }
    if (state.mainTab !== 'editor') {
      state.mainTab = 'editor';
      renderMainArea();
    }
    focusSearchInput();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    if (sceneAutosaveRecoveryPhase !== 'idle') {
      setStatus('自动恢复尚未收束，现在不能切换工作区', false, 5000);
      return;
    }
    if (state.projectWriteLock === 'asset-relocation') {
      setStatus('素材整理进行中，完成或取消后才能离开素材中心', false, 5000);
      return;
    }
    state.mainTab = 'preview';
    renderMainArea();
  }
});

// 关页保护：存在未保存改动时提示（防误关丢失编辑）
window.addEventListener('beforeunload', (e) => {
  const reviewBusy = isReviewApplyRunning() || isReviewReceiptWriting() || hasPendingReviewReceipt(state.reviewWorkspace);
  if (window.surdetDesktop) {
    const busy = state.projectLoading || assetImportActionRunning || sceneLifecycleActionRunning
      || state.projectWriteLock !== null || sceneAutosaveRecoveryPhase !== 'idle' || editorWorkspaceStatus().saving || reviewBusy;
    window.surdetDesktop.reportUnloadState(busy);
    if (busy) { e.preventDefault(); e.returnValue = ''; return; }
  }
  if (reviewBusy || inspectConfigDraftState().dirty || hasReviewDraft(state.reviewWorkspace)) {
    e.preventDefault();
    e.returnValue = '';
    return;
  }
  if (state.projectWriteLock === 'asset-relocation' || sceneAutosaveRecoveryPhase !== 'idle'
    || editorWorkspaceStatus().saving) {
    e.preventDefault();
    e.returnValue = '';
    return;
  }
  for (const sc of state.scenes.values()) {
    if (sc.dirty) {
      e.preventDefault();
      e.returnValue = '';
      return;
    }
  }
  if (state.timelines.some((timeline) => timeline.dirty)
    || state.pendingSceneDeletes.length > 0
    || state.pendingSceneCommit !== null
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

let suspendedWorkspaceBaseline: ProjectDiskBaseline | null = null;
window.addEventListener('pagehide', (event) => {
  suspendedWorkspaceBaseline = editorWorkspaceStatus().baseline;
  if (event.persisted) resetAssetImportRuntime();
  else {
    const closingClient = assetImportClient;
    void disconnectEditorWorkspace().finally(() => closingClient.dispose());
    assetImportWorkspace.dispose();
    assetRelocationWorkspace.dispose();
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    const bindingReady = bindCurrentProjectAssetImport(suspendedWorkspaceBaseline);
    startCurrentProjectAutosaveRecovery(bindingReady);
  }
});

window.addEventListener('focus', () => {
  publishEditorWorkspaceState(true);
  void pollEditorWorkspace(true).catch(() => {});
});

// 调试探针（对齐 starter surdetDebug 惯例）：devtools/自动化验收只读驱动用，生产可裁剪
(window as unknown as Record<string, unknown>).surdetEditorDebug = {
  state,
  runValidate,
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
  if (sceneAutosaveRecoveryPhase !== 'idle') return;
  if (blockedSceneAutosave?.projectId === state.autosaveProjectId) {
    writeAutosave(blockedSceneAutosave);
    return;
  }
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
  const fresh = buildAutosave(
    state.dirName,
    state.scenes,
    state.timelines,
    now,
    state.autosaveProjectId,
    state.pendingSceneDeletes,
    state.pendingSceneCommit,
    state.pendingSceneConfigWrites,
    state.pendingSceneConfigRenames,
  );
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
async function tryAutosaveRecover(
  context: SceneAutosaveRecoveryContext,
  bindingReady: Promise<void>,
): Promise<SceneAutosaveRecoveryOutcome> {
  requireCurrentSceneAutosaveRecovery(context);
  let payload = readAutosave(context.projectId);
  if (payload?.pendingSceneCommit) {
    const original = payload;
    try {
      await bindingReady;
      requireCurrentSceneAutosaveRecovery(context);
      const pending = payload.pendingSceneCommit;
      const result = await context.client.sceneCommit({
        requestId: pending.requestId,
        ...(pending.configRenames === undefined ? {} : { configRenames: pending.configRenames }),
        plans: pending.plans,
        writes: pending.writes,
      });
      requireCurrentSceneAutosaveRecovery(context);
      const settled = settlePendingSceneCommit(payload, result);
      if (settled === null) throw new Error('场景保存回执与自动备份不一致');
      requireCurrentSceneAutosaveRecovery(context);
      await reloadCurrentProjectFromHandle();
      requireCurrentSceneAutosaveRecovery(context);
      payload = settled;
      writeAutosave(settled);
      setStatus('已收束上次中断的场景保存，未提交的后续编辑仍可恢复', true, 7000);
    } catch (error) {
      if (!sceneAutosaveRecoveryIsCurrent(context)) return 'stale';
      state.pendingSceneCommit = {
        requestId: original.pendingSceneCommit!.requestId,
        ...(original.pendingSceneCommit!.configRenames === undefined ? {} : { configRenames: original.pendingSceneCommit!.configRenames!.map(entry => ({ ...entry })) }),
        plans: original.pendingSceneCommit!.plans.map((entry) => ({ ...entry })),
        writes: original.pendingSceneCommit!.writes.map((entry) => ({ ...entry })),
        deletedPaths: [...original.pendingSceneCommit!.deletedPaths],
      };
      blockedSceneAutosave = original;
      setStatus(`上次场景保存尚未收束，自动备份已完整保留且编辑已暂停：${error instanceof Error ? error.message : String(error)}`, false, 12000);
      return 'blocked';
    }
  }
  requireCurrentSceneAutosaveRecovery(context);
  const sceneRecovery = inspectSceneAutosaveRecovery(payload, context.projectId, state.scenes);
  if (sceneRecovery.status === 'blocked') {
    blockedSceneAutosave = payload;
    setStatus('场景自动备份包含不完整的改名或删除操作，已保留原备份并暂停编辑', false, 12000);
    return 'blocked';
  }
  const recoverable = sceneRecovery.status === 'recoverable' ? sceneRecovery.scenes : [];
  let restoreSceneConfigs = () => {};
  if (sceneRecovery.status === 'recoverable' && payload?.sceneTransaction?.configRenames) {
    try {
      restoreSceneConfigs = await prepareSceneConfigRecovery(payload.sceneTransaction.configWrites ?? [], payload.sceneTransaction.configRenames);
      requireCurrentSceneAutosaveRecovery(context);
    } catch (error) {
      if (!sceneAutosaveRecoveryIsCurrent(context)) return 'stale';
      blockedSceneAutosave = payload;
      setStatus(`场景与配置备份尚未恢复，原备份已保留：${error instanceof Error ? error.message : String(error)}`, false, 12000);
      return 'blocked';
    }
  }
  const recoverableSceneTransaction = sceneRecovery.status === 'recoverable'
    ? sceneRecovery.pendingDeletes
    : [];
  const recoverableTimelines = pickRecoverableTimelines(payload, context.projectId, state.timelines);
  const quarantinedEntries = payload?.projectId === context.projectId
    ? unresolvedAutosaveTimelineConflicts(payload.timelineConflicts ?? [], state.timelines)
    : [];
  const quarantinedConflicts = quarantineTimelineAutosaveEntries(quarantinedEntries);
  if (
    recoverable.length === 0
    && recoverableSceneTransaction.length === 0
    && recoverableTimelines.length === 0
    && quarantinedConflicts.length === 0
  ) {
    if ((payload?.timelineConflicts?.length ?? 0) > 0) persistCurrentAutosave(Date.now());
    return 'complete';
  }
  const when = new Date(payload!.savedAt).toLocaleString();
  const names = recoverable.map((e) => e.key).join('、');
  const timelineNames = recoverableTimelines.map((entry) => entry.id).join('、');
  const details = [
    recoverable.length > 0 ? `${recoverable.length} 个场景：${names}` : '',
    recoverableSceneTransaction.length > 0
      ? `${recoverableSceneTransaction.length} 个未完成的场景改名、移动或删除（将整组恢复）`
      : '',
    recoverableTimelines.length > 0 ? `${recoverableTimelines.length} 个演出：${timelineNames}` : '',
    quarantinedConflicts.length > 0 ? `${quarantinedConflicts.length} 个演出身份冲突需要确认` : '',
  ].filter(Boolean).join('\n');
  if (!window.confirm(`检测到「${state.dirName}」的未保存自动备份（${when}）：\n${details}\n是否恢复这些未保存的编辑？（取消则丢弃备份内容）`)) {
    requireCurrentSceneAutosaveRecovery(context);
    pendingAutosaveTimelineConflicts = [];
    blockedSceneAutosave = null;
    clearAutosave(context.projectId);
    return 'complete';
  }
  requireCurrentSceneAutosaveRecovery(context);
  for (const pending of recoverableSceneTransaction) {
    const normalized = pending.file.replaceAll('\\', '/').replace(/^content\/scenario\//, '');
    const sourceKey = normalized.replace(/\.gal$/i, '');
    state.scenes.delete(sourceKey);
  }
  for (const e of recoverable) {
    const sc = state.scenes.get(e.key);
    if (sc) {
      sc.text = e.text;
      sc.eol = e.eol;
      if (e.persistedSha256) sc.persistedSha256 = e.persistedSha256;
      sc.dirty = true;
      if (e.pendingEntryScene) sc.pendingEntryScene = e.pendingEntryScene;
    } else {
      state.scenes.set(e.key, {
        id: e.id,
        file: e.file,
        text: e.text,
        eol: e.eol,
        dirty: true,
        handle: null,
        ...(e.persistedSha256 ? { persistedSha256: e.persistedSha256 } : {}),
        ...(e.pendingCreateOperationId ? { pendingCreateOperationId: e.pendingCreateOperationId } : {}),
        ...(e.pendingEntryScene ? { pendingEntryScene: e.pendingEntryScene } : {}),
      });
    }
  }
  state.pendingSceneDeletes = recoverableSceneTransaction.map((pending) => ({
    ...pending,
    ...(pending.affectedSceneKeys ? { affectedSceneKeys: [...pending.affectedSceneKeys] } : {}),
  }));
  restoreSceneConfigs();
  state.entryScene ||= [...state.scenes.values()].find(scene => scene.pendingEntryScene)?.pendingEntryScene ?? '';
  blockedSceneAutosave = null;
  if (state.current && !state.scenes.has(state.current)) {
    state.current = recoverableSceneTransaction.find((pending) => pending.replacementKey)?.replacementKey
      ?? [...state.scenes.keys()][0]
      ?? null;
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
  return 'complete';
}

/** 定时快照：有 dirty 场景就写备份，全部干净则清除旧备份（存储不可用时静默降级） */
setInterval(() => {
  if (state.projectLoading || !state.autosaveProjectId || sceneAutosaveRecoveryPhase !== 'idle') return;
  persistCurrentAutosave(Date.now());
}, AUTOSAVE_INTERVAL_MS);

renderAll();
runValidate();
scheduleAuthoringIndexRebuild();
if (window.surdetDesktop) {
  void window.surdetDesktop.context().then(async grant => {
    if (grant) await openProjectFromHandle(desktopDirectory(grant));
    else await restoreReviewPreparation();
  }).catch(error => setStatus(error instanceof Error ? error.message : '无法读取项目', false, 8000));
} else void restoreReviewPreparation();
