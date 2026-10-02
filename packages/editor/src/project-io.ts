/**
 * 项目读写（E0 拆分：原 main.ts 纯搬移）。
 * File System Access 打开目录 / 递归读场景 / 保存回目录 / 下载导出兜底 / 内存演示项目。
 * UI 联动（renderAll/runValidate/renderSidebar）经钩子注入，保持模块无环。
 */
import { state, setStatus } from './state.js';
import { parseConfigSource, assertConfigSourcesReadable, type ConfigSourceName } from './config-source.js';
import { beginEditorWorkspaceWrite, finishEditorWorkspaceWrite, publishEditorWorkspaceFile,
  editorWorkspaceStatus } from './editor-workspace.js';
import { histories } from './history.js';
import { clearTimelineHistories, clearTimelineHistory, pushTimelineSnapshot } from './timeline-history.js';
import { resolveAutosaveProjectIdentity } from './autosave.js';
import type { AutosaveTimelineEntry } from './autosave.js';
import {
  inspectTimelineAutosaveIdentity,
  normalizeTimelineAutosaveDocument,
  type TimelineAutosaveDocument,
  type TimelineAutosaveIdentity,
} from './timeline-autosave-identity.js';
import { parseProjectConfigDocument, renameConfigReferences, applyConfigReferenceRename, sceneReferenceConfigPaths, serializeProjectConfigDocument, stableStringify, timelinePathFor } from '@surdet/authoring';
import { kindOfDir, parsePortraitFileName } from './assets.js';
import type { AssetKind, DirAsset } from './assets.js';

let renderAll: () => void = () => {};
let runValidate: () => void = () => {};
let renderSidebar: () => void = () => {};
/** 项目载入完成（崩溃保险恢复检查挂点；A1） */
let onProjectLoaded: () => void = () => {};
/** 换项目或进入演示项目前清理只属于当前目录的临时授权与预览资源。 */
let onProjectClosing: () => void = () => {};
/** 每次替换内存项目事实前失效上一项目的异步结果与页面缓存。 */
let onProjectStateReset: () => void = () => {};
let onProjectReading: (root: FileSystemDirectoryHandle, readProject: () => Promise<void>, reopen: boolean) => Promise<void>
  = async (_root, readProject) => readProject();
/** 无论项目载入成功或失败都必须收束切换状态。 */
let onProjectLoadSettled: (succeeded: boolean) => void = () => {};
/** 保存全部完成（清除崩溃备份挂点；A1） */
let onSaved: () => void = () => {};
/** 配置面板的 dirty 草稿事实与解锁保存入口；由 main 装配，避免 project-io 反向依赖面板。 */
let hasDirtyConfigDrafts: () => boolean = () => false;
let saveConfigDrafts: () => Promise<{ saved: number; failures: number; remainingDirty: boolean }> = async () => {
  const dirty = hasDirtyConfigDrafts();
  return { saved: 0, failures: dirty ? 1 : 0, remainingDirty: dirty };
};
/** 保存尝试完成后的 UI 事实投影；不改变任何写盘或恢复语义。 */
let onSaveSettled: (outcome: ProjectSaveOutcome) => void = () => {};
let onTimelineDeleted: (timelineId: string) => void = () => {};
/** 素材目录原子替换后，由装配层执行一次可等待的共享索引重建。 */
let onAssetsRefreshed: (() => Promise<void>) | null = null;
let onSceneMutationPlan: ((input: SceneMutationPlanInput) => Promise<SceneMutationPlanReference>) | null = null;
let onSceneMutationCommit: ((input: SceneMutationCommitInput) => Promise<SceneMutationCommitResult>) | null = null;
let onSceneCommitStateChanged: () => void = () => {};
let assetRefreshRevision = 0;
let activeProjectWriteOperations = 0;
let projectTransitionPending = false;
const projectWriteIdleWaiters = new Set<() => void>();
let projectWriteQueueTail: Promise<void> = Promise.resolve();

function notifyProjectWriteIdle(): void {
  if (activeProjectWriteOperations !== 0) return;
  for (const resolve of projectWriteIdleWaiters) resolve();
  projectWriteIdleWaiters.clear();
}

/**
 * 共享项目写侧门：项目切换会等待已开始的保存完整收束；新的保存不能插入切换过程。
 * 素材整理在取得独占锁前也等待这批写入排空，避免半途拒绝事务回滚。
 */
export async function runProjectWriteOperation<T>(operation: () => Promise<T>): Promise<T> {
  assertProjectWriteUnlocked();
  if (projectTransitionPending) throw new Error('项目正在切换，请稍后再保存');
  const previous = projectWriteQueueTail;
  let releaseQueue!: () => void;
  projectWriteQueueTail = new Promise<void>((resolve) => { releaseQueue = resolve; });
  activeProjectWriteOperations += 1;
  try {
    await previous;
    await beginEditorWorkspaceWrite();
    try {
      return await operation();
    } finally {
      const warning = await finishEditorWorkspaceWrite();
      if (warning) setStatus(warning, false, 8000);
    }
  } finally {
    activeProjectWriteOperations -= 1;
    releaseQueue();
    notifyProjectWriteIdle();
  }
}

export async function waitForProjectWritesToSettle(): Promise<void> {
  if (projectTransitionPending) throw new Error('项目正在切换，请稍后再整理素材');
  if (activeProjectWriteOperations > 0) {
    await new Promise<void>((resolve) => { projectWriteIdleWaiters.add(resolve); });
  }
  if (projectTransitionPending) throw new Error('项目正在切换，请稍后再整理素材');
}

async function beginProjectTransition(): Promise<void> {
  if (projectTransitionPending) throw new Error('项目正在切换');
  projectTransitionPending = true;
  if (activeProjectWriteOperations > 0) {
    await new Promise<void>((resolve) => { projectWriteIdleWaiters.add(resolve); });
  }
}

function endProjectTransition(): void {
  projectTransitionPending = false;
}

export interface ProjectSaveOutcome {
  hadPendingChanges: boolean;
  saved: number;
  removed: number;
  failures: number;
  remainingDirty: boolean;
}

export interface SceneMutationPlanInput {
  kind: 'rename' | 'delete';
  sourcePath: string;
  targetPath?: string;
}

export interface SceneMutationPlanReference {
  operationId: string;
  planFingerprint: string;
}

export interface SceneMutationCommitInput {
  requestId: string;
  configRenames?: Array<{ from: string; to: string; labelScene?: string }>;
  plans: SceneMutationPlanReference[];
  writes: Array<{ path: string; text: string; expectedSha256: string | null }>;
}

export interface SceneMutationCommitResult {
  writes: Array<{ path: string; sha256: string }>;
  deletedPaths: string[];
}

export function bindProjectIoHooks(opts: {
  renderAll: () => void;
  runValidate: () => void;
  renderSidebar: () => void;
  onProjectLoaded?: () => void;
  onProjectClosing?: () => void;
  onProjectStateReset?: () => void;
  onProjectReading?: (root: FileSystemDirectoryHandle, readProject: () => Promise<void>, reopen: boolean) => Promise<void>;
  onProjectLoadSettled?: (succeeded: boolean) => void;
  onSaved?: () => void;
  hasDirtyConfigDrafts?: () => boolean;
  saveConfigDrafts?: () => Promise<{ saved: number; failures: number; remainingDirty: boolean }>;
  onSaveSettled?: (outcome: ProjectSaveOutcome) => void;
  onTimelineDeleted?: (timelineId: string) => void;
  onAssetsRefreshed?: () => Promise<void>;
  onSceneMutationPlan?: (input: SceneMutationPlanInput) => Promise<SceneMutationPlanReference>;
  onSceneMutationCommit?: (input: SceneMutationCommitInput) => Promise<SceneMutationCommitResult>;
  onSceneCommitStateChanged?: () => void;
}): void {
  renderAll = opts.renderAll;
  runValidate = opts.runValidate;
  renderSidebar = opts.renderSidebar;
  onProjectLoaded = opts.onProjectLoaded ?? (() => {});
  onProjectClosing = opts.onProjectClosing ?? (() => {});
  onProjectStateReset = opts.onProjectStateReset ?? (() => {});
  onProjectReading = opts.onProjectReading ?? (async (_root, readProject) => readProject());
  onProjectLoadSettled = opts.onProjectLoadSettled ?? (() => {});
  onSaved = opts.onSaved ?? (() => {});
  hasDirtyConfigDrafts = opts.hasDirtyConfigDrafts ?? (() => false);
  saveConfigDrafts = opts.saveConfigDrafts ?? (async () => {
    const dirty = hasDirtyConfigDrafts();
    return { saved: 0, failures: dirty ? 1 : 0, remainingDirty: dirty };
  });
  onSaveSettled = opts.onSaveSettled ?? (() => {});
  onTimelineDeleted = opts.onTimelineDeleted ?? (() => {});
  onAssetsRefreshed = opts.onAssetsRefreshed ?? null;
  onSceneMutationPlan = opts.onSceneMutationPlan ?? null;
  onSceneMutationCommit = opts.onSceneMutationCommit ?? null;
  onSceneCommitStateChanged = opts.onSceneCommitStateChanged ?? (() => {});
}

export async function prepareSceneMutation(input: SceneMutationPlanInput): Promise<SceneMutationPlanReference> {
  if (onSceneMutationPlan === null) throw new Error('场景安全保存服务未连接，未执行改名或删除');
  return onSceneMutationPlan(input);
}

export async function openProject(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const dir = await picker({ mode: 'readwrite' });
  await openProjectFromHandle(dir);
}

interface LoadedProjectData {
  dirName: string;
  dirHandle: FileSystemDirectoryHandle;
  reviewPreviewReadOnly: boolean;
  scenes: Map<string, import('./state.js').SceneEntry>;
  timelines: import('./state.js').TimelineEntry[];
  gameConfigText: string;
  entryScene: string;
  handles: typeof state.handles;
  configFiles: typeof state.configFiles;
  configReadErrors: typeof state.configReadErrors;
  dirAssets: DirAsset[];
  autosaveProjectId: string | null;
}

export async function openProjectFromHandle(
  dir: FileSystemDirectoryHandle,
  options: { source?: 'normal' | 'review-fixture'; preserveReviewWorkspace?: boolean } = {},
): Promise<void> {
  if (state.pendingSceneDeletes.length > 0 || state.pendingSceneCommit !== null) {
    throw new Error('当前仍有待保存的场景改名或删除，请先保存全部');
  }
  await beginProjectTransition();
  let succeeded = false;
  const previousProjectLoading = state.projectLoading;
  state.projectLoading = true;
  try {
    await loadProjectFromHandle(dir, options, true);
    succeeded = true;
  } finally {
    state.projectLoading = previousProjectLoading;
    try {
      onProjectLoadSettled(succeeded);
    } finally {
      endProjectTransition();
    }
  }
}

/**
 * 不再次弹出目录选择器，完整重读当前项目。
 * 供本机 authority 完成跨文件写入后刷新全部浏览器句柄与编辑历史。
 */
export async function reloadCurrentProjectFromHandle(options: {
  preserveReviewWorkspace?: boolean;
  mainTab?: typeof state.mainTab;
  selectedAssetId?: string | null;
  sceneKey?: string | null;
  sceneId?: string;
  timelineId?: string | null;
} = {}): Promise<void> {
  await beginProjectTransition();
  const dir = state.dirHandle;
  if (dir === null) {
    endProjectTransition();
    throw new Error('当前项目未连接可写目录');
  }
  let succeeded = false;
  const previousProjectLoading = state.projectLoading;
  state.projectLoading = true;
  try {
    await loadProjectFromHandle(dir, { source: 'normal', notifyProjectLoaded: false, preserveReviewWorkspace: options.preserveReviewWorkspace }, false);
    if (options.mainTab !== undefined) state.mainTab = options.mainTab;
    if (options.sceneKey && state.scenes.has(options.sceneKey)) state.current = options.sceneKey;
    else if (options.sceneId) state.current = [...state.scenes].find(([, scene]) => scene.id === options.sceneId)?.[0] ?? state.current;
    if (options.timelineId && state.timelines.some(timeline => timeline.id === options.timelineId)) state.currentTimeline = options.timelineId;
    if (options.selectedAssetId !== undefined) state.assetCenterSelectedId = options.selectedAssetId;
    renderAll();
    succeeded = true;
  } finally {
    state.projectLoading = previousProjectLoading;
    try {
      onProjectLoadSettled(succeeded);
    } finally {
      endProjectTransition();
    }
  }
}

async function loadProjectFromHandle(
  dir: FileSystemDirectoryHandle,
  options: { source?: 'normal' | 'review-fixture'; notifyProjectLoaded?: boolean; preserveReviewWorkspace?: boolean },
  closeOldRuntime: boolean,
): Promise<void> {
  const permissions = dir as FileSystemDirectoryHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  const reviewPreviewReadOnly = options.source === 'review-fixture'
    && await permissions.queryPermission?.({ mode: 'readwrite' }) === 'denied';
  const readAndCommit = async (): Promise<void> => {
    const loaded = await readProjectFromHandle(dir, reviewPreviewReadOnly);
    if (closeOldRuntime) onProjectClosing();
    assetRefreshRevision += 1;
    commitLoadedProject(loaded, options);
  };
  if (reviewPreviewReadOnly) await readAndCommit();
  else await onProjectReading(dir, readAndCommit, closeOldRuntime);
  state.projectLoading = false;
  renderAll();
  runValidate(); // 打开后立即校验
  if (!state.autosaveProjectId && options.source !== 'review-fixture') {
    setStatus('当前浏览器无法安全识别项目目录，自动备份未启用', false, 8000);
  }
  if (options.notifyProjectLoaded !== false) {
    onProjectLoaded(); // 崩溃保险：只在真正打开项目时检查同项目未保存快照（A1）
  }
}

/** 读取阶段只创建临时对象，不触碰当前项目状态或运行时。 */
async function readProjectFromHandle(
  dir: FileSystemDirectoryHandle,
  reviewPreviewReadOnly: boolean,
): Promise<LoadedProjectData> {
  const scenes = new Map<string, import('./state.js').SceneEntry>();
  const timelines: import('./state.js').TimelineEntry[] = [];
  const handles = { gameConfig: null, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null } as typeof state.handles;
  const configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null } as typeof state.configFiles;
  const configReadErrors: typeof state.configReadErrors = {};
  let gameConfigText = '';
  let entryScene = '';
  // content/config/*.json（E1a：流程图宿主入口与 CLI collectConfigSceneRoots 同源；
  // E2/E3：achievements/gallery 供素材清单与配置编辑器；解析失败保留句柄和错误）
  for (const name of ['events', 'growth', 'calendar', 'achievements', 'gallery', 'terminology'] as const) {
    try {
      const contentDir = await dir.getDirectoryHandle('content');
      const configDir = await contentDir.getDirectoryHandle('config');
      const fh = await configDir.getFileHandle(`${name}.json`);
      handles[name] = fh;
      const text = await readProjectSourceText(fh);
      try { configFiles[name] = parseConfigSource(name, text); }
      catch (error) { configReadErrors[name] = error instanceof Error ? error.message : String(error); }
    } catch (error) {
      if (handles[name] !== null || !isMissingDirectoryError(error)) throw error;
      configFiles[name] = null;
    }
  }
  // game.config.json（entryScene/变量表；句柄供变量编辑器写盘）
  try {
    const cfgHandle = await dir.getFileHandle('game.config.json');
    handles.gameConfig = cfgHandle;
    gameConfigText = await readProjectSourceText(cfgHandle);
    const cfg = parseProjectConfigDocument(gameConfigText);
    entryScene = typeof cfg['entryScene'] === 'string' ? cfg['entryScene'] : '';
  } catch (error) {
    if (!isMissingDirectoryError(error) && !(error instanceof SyntaxError)
      && !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'PROJECT_INVALID')) throw error;
    // Keep malformed source visible to validation and scene-reference guards;
    // a parse failure must not erase the difference from a missing config.
    if (handles.gameConfig) configReadErrors.gameConfig = error instanceof Error ? error.message : String(error);
    entryScene = '';
  }
  // 素材目录扫描（E2）：content/assets 与 public/，目录约定类型，无目录静默跳过
  const dirAssets = await collectProjectAssets(dir, true);
  // 递归读取 content/scenario/**/*.gal
  const contentDir = await optionalDirectory(dir, 'content', true);
  const scenarioDir = contentDir === null ? null : await optionalDirectory(contentDir, 'scenario', true);
  if (scenarioDir !== null) await readScenarioDir(scenarioDir, '', scenes);
  const timelineDir = contentDir === null ? null : await optionalDirectory(contentDir, 'timelines', true);
  if (timelineDir !== null) await readTimelineDir(timelineDir, '', timelines);
  return {
    dirName: dir.name,
    dirHandle: dir,
    reviewPreviewReadOnly,
    scenes,
    timelines,
    gameConfigText,
    entryScene,
    handles,
    configFiles,
    configReadErrors,
    dirAssets,
    autosaveProjectId: await resolveAutosaveProjectIdentity(dir),
  };
}

/** 读取完整成功后一次提交项目事实；之后才接入新项目运行时。 */
function commitLoadedProject(
  loaded: LoadedProjectData,
  options: { source?: 'normal' | 'review-fixture'; notifyProjectLoaded?: boolean; preserveReviewWorkspace?: boolean },
): void {
  state.projectLoading = true;
  onProjectStateReset();
  if ((options.source ?? 'normal') === 'normal' && !options.preserveReviewWorkspace) {
    state.reviewWorkspace = null;
    state.mainTab = 'editor';
  } else {
    state.mainTab = 'review';
  }
  state.dirName = loaded.dirName;
  state.dirHandle = loaded.dirHandle;
  state.reviewPreviewReadOnly = loaded.reviewPreviewReadOnly;
  state.scenes.clear();
  for (const [key, scene] of loaded.scenes) state.scenes.set(key, scene);
  state.pendingSceneDeletes = [];
  state.pendingSceneCommit = null;
  state.pendingSceneConfigWrites = [];
  state.pendingSceneConfigRenames = [];
  state.lastValidation = null;
  state.lastEdges = [];
  state.timelines = loaded.timelines;
  state.pendingTimelineDeletes = [];
  state.pendingTimelineRestores.clear();
  state.currentTimeline = null;
  state.currentTimelineCue = null;
  state.previewTimelineId = null;
  histories.clear(); // 换项目：历史栈失效
  clearTimelineHistories();
  state.handles = loaded.handles;
  state.dirAssets = loaded.dirAssets;
  state.assetIntelligence = null;
  state.assetIntelligenceState = 'loading';
  state.assetCenterSelectedId = null;
  state.assetCenterQuery = '';
  state.assetCenterKind = 'all';
  state.assetCenterStatus = 'all';
  state.assetCenterFolder = 'all';
  // content/config/*.json（E1a：流程图宿主入口与 CLI collectConfigSceneRoots 同源；
  // E2/E3：achievements/gallery 供素材清单与配置编辑器；错误投影与当前项目一并切换）
  state.configFiles = loaded.configFiles;
  state.configReadErrors = loaded.configReadErrors;
  state.gameConfigText = loaded.gameConfigText;
  state.entryScene = loaded.entryScene;
  const first = state.scenes.keys().next().value as string | undefined;
  state.current = first ?? null;
  state.currentTimeline = state.timelines[0]?.id ?? null;
  state.autosaveProjectId = loaded.autosaveProjectId;
}

/** 素材目录扫描（E2）：顶层目录定类型（bg/portrait/avatar/bgm/se/voice/video），子目录继承类型；
 *  未知类型的目录/文件跳过（不强制素材约定） */
const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

/** handle → 项目相对路径（'/' 分隔；供共享 asset catalog 的路径元数据枚举，不读文件内容）。 */
const assetPathByHandle = new WeakMap<FileSystemFileHandle, string>();

export function recordAssetPath(handle: FileSystemFileHandle, relativePath: string): void {
  assetPathByHandle.set(handle, relativePath);
}

export function assetPathForHandle(handle: FileSystemFileHandle): string | undefined {
  return assetPathByHandle.get(handle);
}

async function walkAssetDir(
  root: FileSystemDirectoryHandle,
  basePath: string,
  target: DirAsset[],
): Promise<void> {
  const walk = async (dh: FileSystemDirectoryHandle, kind: AssetKind | null, relative: string): Promise<void> => {
    const entries = (dh as unknown as {
      values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
    }).values();
    for await (const ent of entries) {
      if (ent.kind === 'directory') {
        const classified = kind ?? kindOfDir(ent.name) ?? (basePath === 'content/assets' ? 'other' : null);
        await walk(ent, classified, relative.length === 0 ? ent.name : `${relative}/${ent.name}`);
      } else if (ent.kind === 'file' && (kind !== null || basePath === 'content/assets')) {
        const assetKind = kind ?? 'other';
        const filePath = relative.length === 0 ? ent.name : `${relative}/${ent.name}`;
        const sourcePath = `${basePath}/${filePath}`;
        recordAssetPath(ent, sourcePath);
        let bytes: number | undefined;
        let lastModified: number | undefined;
        try {
          const file = await ent.getFile();
          bytes = file.size;
          lastModified = file.lastModified;
        } catch {
          // 预览句柄仍保留；文件事实缺失由共享投影如实表示为未测量。
        }
        if (assetKind === 'portrait') {
          const identity = parsePortraitFileName(ent.name);
          target.push({
            key: identity?.key ?? ent.name, kind: assetKind, ...(identity ? { expr: identity.expr } : {}), handle: ent, isImage: IMG_RE.test(ent.name), sourcePath,
            ...(bytes === undefined ? {} : { bytes }),
            ...(lastModified === undefined ? {} : { lastModified }),
          });
        } else {
          const key = ent.name.replace(/\.[^.]+$/, '');
          target.push({
            key, kind: assetKind, handle: ent, isImage: IMG_RE.test(ent.name), sourcePath,
            ...(bytes === undefined ? {} : { bytes }),
            ...(lastModified === undefined ? {} : { lastModified }),
          });
        }
      }
    }
  };
  await walk(root, null, '');
}

function isMissingDirectoryError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'NotFoundError';
}

async function optionalDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
  strict: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch (error) {
    if (!strict || isMissingDirectoryError(error)) return null;
    throw error;
  }
}

export async function collectProjectAssets(
  root: FileSystemDirectoryHandle,
  strict: boolean,
): Promise<DirAsset[]> {
  const nextAssets: DirAsset[] = [];
  const contentDir = await optionalDirectory(root, 'content', strict);
  if (contentDir !== null) {
    const assetsDir = await optionalDirectory(contentDir, 'assets', strict);
    if (assetsDir !== null) {
      try {
        await walkAssetDir(assetsDir, 'content/assets', nextAssets);
      } catch (error) {
        if (strict) throw error;
      }
    }
  }
  const publicDir = await optionalDirectory(root, 'public', strict);
  if (publicDir !== null) {
    try {
      await walkAssetDir(publicDir, 'public', nextAssets);
    } catch (error) {
      if (strict) throw error;
    }
  }
  return nextAssets;
}

/**
 * 重新读取素材物理事实并等待共享素材智能完成更新。
 * 不经过完整项目打开流程；扫描失败或过期结果都不会留下半份清单。
 */
export async function refreshProjectAssetIntelligence(): Promise<void> {
  const root = state.dirHandle;
  if (root === null) throw new Error('当前项目未连接可写目录');
  if (onAssetsRefreshed === null) throw new Error('素材智能刷新尚未接入编辑器装配层');
  const revision = ++assetRefreshRevision;
  const previousAssets = state.dirAssets;
  const previousIntelligence = state.assetIntelligence;
  const previousIntelligenceState = state.assetIntelligenceState;
  const previousSelectedId = state.assetCenterSelectedId;
  const nextAssets = await collectProjectAssets(root, true);
  if (revision !== assetRefreshRevision || state.dirHandle !== root) return;
  state.dirAssets = nextAssets;
  state.assetIntelligenceState = 'loading';
  try {
    await onAssetsRefreshed();
    if (revision !== assetRefreshRevision || state.dirHandle !== root) return;
  } catch (error) {
    if (revision === assetRefreshRevision && state.dirHandle === root) {
      state.dirAssets = previousAssets;
      state.assetIntelligence = previousIntelligence;
      state.assetIntelligenceState = previousIntelligenceState;
      state.assetCenterSelectedId = previousSelectedId;
    }
    throw error;
  }
}

/** 配置文件写盘（E3 共用：创建可写流 → 写入 → 关闭） */
export function assertProjectWriteUnlocked(): void {
  if (state.projectWriteLock === 'asset-relocation') {
    throw new Error('素材整理进行中，完成后才能保存其他修改');
  }
}

export async function writeFileHandle(fh: FileSystemFileHandle, text: string): Promise<void> {
  assertProjectWriteUnlocked();
  if (editorWorkspaceStatus().protection !== 'unavailable') {
    const parts = await state.dirHandle?.resolve(fh);
    if (!parts) throw new Error('文件不属于当前绑定项目，未执行保存');
    await publishEditorWorkspaceFile(parts.join('/'), text);
    return;
  }
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/** New bound files are created by Node under the save lease, before refreshing the browser handle. */
export async function writeProjectText(path: string, text: string, handle: FileSystemFileHandle | null): Promise<FileSystemFileHandle> {
  assertProjectWriteUnlocked();
  const coordinated = await publishEditorWorkspaceFile(path, text);
  if (!coordinated && handle !== null) {
    await writeFileHandle(handle, text);
    return handle;
  }
  if (state.dirHandle === null) throw new Error('未连接项目目录，不能保存');
  const parts = path.split('/');
  const fileName = parts.pop()!;
  let directory = state.dirHandle;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: !coordinated });
  const savedHandle = await directory.getFileHandle(fileName, { create: !coordinated });
  if (!coordinated) await writeFileHandle(savedHandle, text);
  return savedHandle;
}

export async function sceneTextSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Blob.text strips a UTF-8 BOM; source hashes and relocation must preserve it. */
export async function readProjectSourceText(handle: FileSystemFileHandle): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await (await handle.getFile()).arrayBuffer());
}

export async function readScenarioDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  target: Map<string, import('./state.js').SceneEntry> = state.scenes,
): Promise<void> {
  // values() 异步迭代器未包含在默认 DOM lib 类型中，显式断言
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values();
  for await (const ent of entries) {
    if (ent.kind === 'directory') {
      await readScenarioDir(ent, prefix + ent.name + '/', target);
    } else if (ent.kind === 'file' && /\.gal$/i.test(ent.name)) {
      const id = ent.name.replace(/\.gal$/i, '');
      const text = await readProjectSourceText(ent);
      // key = 相对路径：子目录同名 .gal 各占一条，同名冲突由校验 LINT_DUP 显式报错（M4）
      const key = prefix + id;
      target.set(key, {
        id,
        file: prefix + ent.name,
        text,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        dirty: false,
        handle: ent,
        persistedSha256: await sceneTextSha256(text),
      });
    }
  }
}

/** 递归读取 content/timelines 下的 JSON；文本原样保留，预览发送时再解析。 */
export async function readTimelineDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  target: import('./state.js').TimelineEntry[] = state.timelines,
): Promise<void> {
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values();
  for await (const ent of entries) {
    if (ent.kind === 'directory') {
      await readTimelineDir(ent, prefix + ent.name + '/', target);
    } else if (ent.kind === 'file' && ent.name.toLowerCase().endsWith('.json')) {
      const text = await readProjectSourceText(ent);
      target.push({
        id: ent.name.replace(/\.json$/, ''),
        file: prefix + ent.name,
        text,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        dirty: false,
        handle: ent,
        persistedSha256: await sceneTextSha256(text),
      });
    }
  }
}

function scenarioPathParts(file: string): string[] {
  let relative = file.replaceAll('\\', '/');
  if (relative.startsWith('content/scenario/')) relative = relative.slice('content/scenario/'.length);
  if (relative.length === 0 || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) {
    throw new Error(`场景路径无效：${file}`);
  }
  const parts = relative.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`场景路径无效：${file}`);
  }
  const fileName = parts.at(-1);
  if (!fileName?.toLowerCase().endsWith('.gal')) throw new Error(`场景文件必须使用 .gal：${file}`);
  return parts;
}

/** Windows 磁盘身份按大小写不敏感比较；同时复用同一套越级路径校验。 */
export function sceneFileIdentity(file: string): string {
  return scenarioPathParts(file).join('/').toLocaleLowerCase('en-US');
}

export function sceneProjectPath(file: string): string {
  return `content/scenario/${scenarioPathParts(file).join('/')}`;
}

/** Project reads see the pinned implicit entry while its scene move is a draft;
 * gameConfigText remains the last config source used for the write precondition. */
export function workingGameConfigText(source = state): string {
  const entry = [...source.scenes.values()].find(scene => scene.pendingEntryScene)?.pendingEntryScene;
  if (!entry) return source.gameConfigText;
  const config = parseProjectConfigDocument(source.gameConfigText || '{}');
  if (config['entryScene'] !== undefined && config['entryScene'] !== '') return source.gameConfigText;
  return serializeProjectConfigDocument({ ...config, entryScene: entry }, source.gameConfigText);
}

function sceneWriteIdentity(file: string): string {
  return sceneReferenceConfigPaths.includes(file) ? file : sceneFileIdentity(file);
}

function configNameForPath(path: string): ConfigSourceName {
  return path === 'game.config.json' ? 'gameConfig' : path.slice('content/config/'.length, -5) as ConfigSourceName;
}

/** Prepare all disk baselines and working projections before changing any scene identity. */
export async function prepareSceneConfigRename(from: string, to: string, fallbackEntry: string): Promise<() => void> {
  assertConfigSourcesReadable(['gameConfig', 'events', 'growth', 'calendar', 'gallery']);
  const before: Record<string, string> = {};
  const baselines = new Map<string, string | null>();
  for (const path of sceneReferenceConfigPaths) {
    const pending = state.pendingSceneConfigWrites.find(write => write.path === path);
    const name = configNameForPath(path);
    const handle = state.handles[name];
    if (pending) { before[path] = pending.text; baselines.set(path, pending.expectedSha256); }
    else if (handle) {
      before[path] = await readProjectSourceText(handle);
      baselines.set(path, await sceneTextSha256(before[path]!));
    }
  }
  const after = { ...before };
  renameConfigReferences(after, from, to, fallbackEntry);
  const writes = new Map(state.pendingSceneConfigWrites.map(write => [write.path, { ...write }]));
  for (const path of sceneReferenceConfigPaths) if (after[path] !== before[path]) {
    writes.set(path, { path, text: after[path]!, expectedSha256: baselines.get(path) ?? null });
  }
  // Row drafts have their own history. Only their backing source references are
  // changed here; unrelated row edits are saved by the normal config save later.
  const memory: Record<string, string> = { 'game.config.json': workingGameConfigText() || '{}' };
  for (const name of ['events', 'growth', 'calendar', 'gallery'] as const) {
    if (state.configFiles[name] !== null) memory[`content/config/${name}.json`] = JSON.stringify(state.configFiles[name]);
  }
  renameConfigReferences(memory, from, to, fallbackEntry);
  return () => {
    state.gameConfigText = memory['game.config.json']!;
    state.entryScene = String(parseProjectConfigDocument(state.gameConfigText)['entryScene'] ?? '');
    for (const name of ['events', 'growth', 'calendar', 'gallery'] as const) {
      const text = memory[`content/config/${name}.json`];
      if (text !== undefined) state.configFiles[name] = parseConfigSource(name, text);
    }
    state.pendingSceneConfigWrites = [...writes.values()];
    state.pendingSceneConfigRenames.push({ from, to });
  };
}

/** Prepare catalog/gallery backing sources and memory without publishing either. */
export async function prepareSceneLabelConfigRename(sceneId: string, from: string, to: string): Promise<() => void> {
  assertConfigSourcesReadable(['gameConfig', 'gallery']);
  const before: Record<string, string> = {};
  const baselines = new Map<string, string | null>();
  for (const path of ['game.config.json', 'content/config/gallery.json']) {
    const pending = state.pendingSceneConfigWrites.find(write => write.path === path);
    const handle = state.handles[configNameForPath(path)];
    const text = pending?.text ?? (handle ? await readProjectSourceText(handle) : undefined);
    if (text !== undefined) before[path] = text;
    baselines.set(path, pending ? pending.expectedSha256 : (text === undefined ? null : await sceneTextSha256(text)));
  }
  const rename = { from, to, labelScene: sceneId };
  const after = { ...before };
  applyConfigReferenceRename(after, rename, sceneId);
  const writes = new Map(state.pendingSceneConfigWrites.map(write => [write.path, write]));
  for (const path of baselines.keys()) if (after[path] !== before[path]) {
    writes.set(path, { path, text: after[path]!, expectedSha256: baselines.get(path)! });
  }
  const memory: Record<string, string> = { 'game.config.json': workingGameConfigText() || '{}' };
  if (state.configFiles.gallery !== null) memory['content/config/gallery.json'] = JSON.stringify(state.configFiles.gallery);
  applyConfigReferenceRename(memory, rename, sceneId);
  const gallery = memory['content/config/gallery.json'] === undefined ? null : parseConfigSource('gallery', memory['content/config/gallery.json']!);
  return () => {
    state.gameConfigText = memory['game.config.json']!;
    state.configFiles.gallery = gallery;
    state.pendingSceneConfigWrites = [...writes.values()];
    state.pendingSceneConfigRenames.push(rename);
  };
}

/** A path transaction may only restore its config draft onto the original disk baseline. */
export async function prepareSceneConfigRecovery(
  writes: typeof state.pendingSceneConfigWrites,
  renames: typeof state.pendingSceneConfigRenames,
): Promise<() => void> {
  const parsed = new Map<ConfigSourceName, unknown>();
  const before: Record<string, string> = {};
  for (const path of sceneReferenceConfigPaths) {
    const handle = state.handles[configNameForPath(path)];
    if (handle) before[path] = await readProjectSourceText(handle);
  }
  const expected = { ...before };
  const first = [...state.scenes.values()].sort((a, b) => sceneProjectPath(a.file) < sceneProjectPath(b.file) ? -1 : 1)[0];
  const rootWrite = writes.find(write => write.path === 'game.config.json');
  const fallback = first?.id ?? String(parseProjectConfigDocument(rootWrite?.text ?? '{}')['entryScene'] ?? '');
  for (const rename of renames) applyConfigReferenceRename(expected, rename, fallback);
  for (const path of sceneReferenceConfigPaths) {
    const write = writes.find(entry => entry.path === path);
    if ((expected[path] !== before[path] && !write) || (write && (expected[path] === undefined
      || stableStringify(parseProjectConfigDocument(write.text, path)) !== stableStringify(parseProjectConfigDocument(expected[path]!, path))))) {
      throw new Error(`${path} 的改名备份不完整或不再对应当前来源，不能部分恢复`);
    }
  }
  for (const write of writes) {
    if (!sceneReferenceConfigPaths.includes(write.path)) throw new Error('自动备份中的场景配置路径无效');
    const name = configNameForPath(write.path);
    const fingerprint = before[write.path] === undefined ? null : await sceneTextSha256(before[write.path]!);
    if (fingerprint !== write.expectedSha256) throw new Error(`${write.path} 已在备份后变化，不能部分恢复场景改名`);
    parsed.set(name, parseConfigSource(name, write.text));
  }
  return () => {
    for (const write of writes) {
      const name = configNameForPath(write.path);
      if (name === 'gameConfig') {
        state.gameConfigText = write.text;
        state.entryScene = String((parsed.get(name) as Record<string, unknown>)['entryScene'] ?? '');
      } else state.configFiles[name] = parsed.get(name);
    }
    state.pendingSceneConfigWrites = writes.map(entry => ({ ...entry }));
    state.pendingSceneConfigRenames = renames.map(entry => ({ ...entry }));
  };
}

export function isSceneFilePathReserved(file: string, ignoredSceneKey?: string): boolean {
  const identity = sceneFileIdentity(file);
  return [...state.scenes].some(([key, scene]) => (
    key !== ignoredSceneKey && sceneFileIdentity(scene.file) === identity
  )) || state.pendingSceneDeletes.some((pending) => sceneFileIdentity(pending.file) === identity);
}

async function scenarioParentDirectory(
  root: FileSystemDirectoryHandle,
  file: string,
  create: boolean,
): Promise<{ directory: FileSystemDirectoryHandle; fileName: string; relativeFile: string }> {
  const parts = scenarioPathParts(file);
  const fileName = parts.pop()!;
  const contentDir = await root.getDirectoryHandle('content', { create });
  let directory = await contentDir.getDirectoryHandle('scenario', { create });
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return { directory, fileName, relativeFile: [...parts, fileName].join('/') };
}

export interface TimelineAutosaveRestoreResult {
  restored: number;
  conflicts: TimelineAutosaveRestoreConflict[];
}

export type TimelineAutosaveConflictReason =
  | 'recovered-json-invalid'
  | 'recovered-id-mismatch'
  | 'current-json-invalid'
  | 'current-id-mismatch'
  | 'same-file-different-id'
  | 'same-id-different-file'
  | 'definition-id-collision'
  | 'quarantined-backup';

export interface TimelineAutosaveRestoreConflict {
  key: string;
  reason: TimelineAutosaveConflictReason;
  recovered: AutosaveTimelineEntry;
  recoveredIdentity: TimelineAutosaveIdentity;
  current: TimelineAutosaveDocument | null;
  currentIdentity: TimelineAutosaveIdentity | null;
}

export type TimelineAutosaveRepairAction =
  | { kind: 'replace-current' }
  | { kind: 'save-as-new'; newId: string };

export type TimelineAutosaveRepairResult =
  | { ok: true; timelineId: string }
  | { ok: false; error: string };

function timelineDocument(entry: TimelineAutosaveDocument): TimelineAutosaveDocument {
  return { id: entry.id, file: entry.file, text: entry.text, eol: entry.eol };
}

function timelineRestoreConflict(
  recovered: AutosaveTimelineEntry,
  recoveredIdentity: TimelineAutosaveIdentity,
  reason: TimelineAutosaveConflictReason,
  index: number,
  current: TimelineAutosaveDocument | null = null,
): TimelineAutosaveRestoreConflict {
  const currentSnapshot = current ? timelineDocument(current) : null;
  return {
    key: `${recovered.id}\0${recovered.file}\0${index}`,
    reason,
    recovered: timelineDocument(recovered),
    recoveredIdentity,
    current: currentSnapshot,
    currentIdentity: currentSnapshot ? inspectTimelineAutosaveIdentity(currentSnapshot) : null,
  };
}

type TimelineAutosaveRestoreDecision =
  | { kind: 'conflict'; conflict: TimelineAutosaveRestoreConflict }
  | { kind: 'replace'; target: (typeof state.timelines)[number] }
  | { kind: 'insert' };

function classifyTimelineAutosaveEntry(
  recovered: AutosaveTimelineEntry,
  index: number,
): TimelineAutosaveRestoreDecision {
  const recoveredIdentity = inspectTimelineAutosaveIdentity(recovered);
  if (recoveredIdentity.parseError !== null) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(recovered, recoveredIdentity, 'recovered-json-invalid', index),
    };
  }
  if (!recoveredIdentity.canonical) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(recovered, recoveredIdentity, 'recovered-id-mismatch', index),
    };
  }

  const sameFile = state.timelines.find((entry) => entry.file === recovered.file);
  if (sameFile && sameFile.id !== recovered.id) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(
        recovered, recoveredIdentity, 'same-file-different-id', index, sameFile,
      ),
    };
  }
  const sameId = state.timelines.find((entry) => entry.id === recovered.id);
  if (sameId && sameId.file !== recovered.file) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(
        recovered, recoveredIdentity, 'same-id-different-file', index, sameId,
      ),
    };
  }

  const exact = state.timelines.find((entry) => entry.id === recovered.id && entry.file === recovered.file);
  if (exact) {
    const currentIdentity = inspectTimelineAutosaveIdentity(exact);
    if (currentIdentity.parseError !== null) {
      return {
        kind: 'conflict',
        conflict: timelineRestoreConflict(
          recovered, recoveredIdentity, 'current-json-invalid', index, exact,
        ),
      };
    }
    if (!currentIdentity.canonical) {
      return {
        kind: 'conflict',
        conflict: timelineRestoreConflict(
          recovered, recoveredIdentity, 'current-id-mismatch', index, exact,
        ),
      };
    }
    return { kind: 'replace', target: exact };
  }

  const definitionCollision = state.timelines.find((entry) => (
    inspectTimelineAutosaveIdentity(entry).definitionId === recoveredIdentity.definitionId
  ));
  if (definitionCollision) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(
        recovered, recoveredIdentity, 'definition-id-collision', index, definitionCollision,
      ),
    };
  }
  return { kind: 'insert' };
}

export function restoreTimelineAutosaveEntries(entries: readonly AutosaveTimelineEntry[]): TimelineAutosaveRestoreResult {
  let restored = 0;
  const conflicts: TimelineAutosaveRestoreResult['conflicts'] = [];
  for (const [index, recovered] of entries.entries()) {
    const decision = classifyTimelineAutosaveEntry(recovered, index);
    if (decision.kind === 'conflict') {
      conflicts.push(decision.conflict);
      continue;
    }
    if (decision.kind === 'replace') {
      decision.target.text = recovered.text;
      decision.target.eol = recovered.eol;
      decision.target.dirty = true;
    } else {
      state.timelines.push({
        id: recovered.id,
        file: recovered.file,
        text: recovered.text,
        eol: recovered.eol,
        dirty: true,
        handle: null,
      });
    }
    restored++;
  }
  if (!state.currentTimeline && state.timelines.length > 0) {
    state.currentTimeline = state.timelines[0]!.id;
  }
  return { restored, conflicts };
}

export function quarantineTimelineAutosaveEntries(
  entries: readonly AutosaveTimelineEntry[],
): TimelineAutosaveRestoreConflict[] {
  return entries.map((recovered, index) => {
    const decision = classifyTimelineAutosaveEntry(recovered, index);
    const conflict = decision.kind === 'conflict'
      ? decision.conflict
      : timelineRestoreConflict(
        recovered,
        inspectTimelineAutosaveIdentity(recovered),
        'quarantined-backup',
        index,
        decision.kind === 'replace' ? decision.target : null,
      );
    return { ...conflict, key: `quarantine:${conflict.key}` };
  });
}

function repairFailure(error: string): TimelineAutosaveRepairResult {
  return { ok: false, error };
}

function timelineDefinitionId(entry: TimelineAutosaveDocument): string | null {
  return inspectTimelineAutosaveIdentity(entry).definitionId;
}

export function repairTimelineAutosaveConflict(
  conflict: TimelineAutosaveRestoreConflict,
  action: TimelineAutosaveRepairAction,
): TimelineAutosaveRepairResult {
  if (action.kind === 'replace-current') {
    const current = conflict.current;
    if (current === null) return repairFailure('当前项目中没有可替换的演出');

    const targets = state.timelines.filter((entry) => entry.id === current.id && entry.file === current.file);
    if (targets.length !== 1) return repairFailure('当前演出已变化或不唯一，请重新打开项目后再处理');
    const target = targets[0]!;
    if (target.text !== current.text || target.eol !== current.eol) {
      return repairFailure('当前演出已在冲突出现后发生变化，未执行替换');
    }

    const normalized = normalizeTimelineAutosaveDocument(conflict.recovered, target.id, target.file);
    if (!normalized.ok) return repairFailure(normalized.error);
    if (!inspectTimelineAutosaveIdentity(normalized.entry).canonical) {
      return repairFailure('自动备份规范化后身份仍不一致');
    }

    pushTimelineSnapshot(
      target.id,
      target.text,
      state.currentTimeline === target.id && state.currentTimelineCue
        ? { ...state.currentTimelineCue }
        : null,
    );
    target.text = normalized.entry.text;
    target.eol = normalized.entry.eol;
    target.dirty = true;
    if (state.currentTimeline === target.id) state.currentTimelineCue = null;
    return { ok: true, timelineId: target.id };
  }

  const newId = action.newId.trim();
  let projectPath: string;
  try {
    projectPath = timelinePathFor(newId);
  } catch (error) {
    return repairFailure(error instanceof Error ? error.message : String(error));
  }
  const newFile = projectPath.slice('content/timelines/'.length);
  const currentCollision = state.timelines.some((entry) => (
    entry.id === newId
    || entry.file === newFile
    || timelineDefinitionId(entry) === newId
  ));
  if (currentCollision) return repairFailure(`演出标识 或文件已存在：${newId}`);

  const deletedCollision = state.pendingTimelineDeletes.some((entry) => (
    entry.id === newId || entry.file === newFile
  ));
  if (deletedCollision) return repairFailure(`演出仍在待删除列表中：${newId}`);

  const restoreCollision = [...state.pendingTimelineRestores.entries()].some(([id, restore]) => (
    id === newId
    || restore.entry.id === newId
    || restore.entry.file === newFile
    || timelineDefinitionId(restore.entry) === newId
  ));
  if (restoreCollision) return repairFailure(`演出仍在可恢复列表中：${newId}`);

  const normalized = normalizeTimelineAutosaveDocument(conflict.recovered, newId, newFile);
  if (!normalized.ok) return repairFailure(normalized.error);
  if (!inspectTimelineAutosaveIdentity(normalized.entry).canonical) {
    return repairFailure('另存后的演出身份仍不一致');
  }

  state.timelines.push({
    ...normalized.entry,
    dirty: true,
    handle: null,
  });
  return { ok: true, timelineId: newId };
}

async function saveAllUnlocked(): Promise<void> {
  assertProjectWriteUnlocked();
  if (state.pendingSceneConfigRenames.some(rename => rename.labelScene !== undefined) && (!state.dirHandle || onSceneMutationCommit === null)) throw new Error('标签改名需要安全保存服务，未写入任何关联场景或配置');
  const hadPendingChanges = [...state.scenes.values()].some((scene) => scene.dirty)
    || state.timelines.some((timeline) => timeline.dirty)
    || state.pendingSceneDeletes.length > 0
    || state.pendingSceneCommit !== null
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0
    || hasDirtyConfigDrafts();
  let saved = 0;
  let removed = 0;
  let failures = 0;
  const failureMessages: string[] = [];
  const recordFailure = (label: string, err: unknown): void => {
    failures++;
    const message = err instanceof Error ? err.message : String(err);
    failureMessages.push(`${label}：${message}`);
    setStatus(`${label}失败：${message}`, false, 6000);
  };
  const saveConfigDraftsForProject = async (): Promise<boolean> => {
    try {
      const result = await saveConfigDrafts();
      saved += result.saved;
      failures += result.failures;
      if (result.failures > 0) failureMessages.push(`配置草稿：${result.failures} 个区块未保存`);
      return result.remainingDirty;
    } catch (error) {
      recordFailure('配置草稿保存', error);
      return true;
    }
  };
  if (!state.fsSupported) {
    const timeline = state.currentTimeline
      ? state.timelines.find((entry) => entry.id === state.currentTimeline)
      : undefined;
    if (timeline) exportTimeline(timeline.id, timeline.text);
    else exportCurrent();
    const configRemainingDirty = await saveConfigDraftsForProject();
    const remainingDirty = [...state.scenes.values()].some((scene) => scene.dirty)
      || state.timelines.some((entry) => entry.dirty)
      || state.pendingSceneDeletes.length > 0
      || state.pendingSceneCommit !== null
      || state.pendingTimelineDeletes.length > 0
      || state.pendingTimelineRestores.size > 0
      || configRemainingDirty
      || hasDirtyConfigDrafts();
    onSaveSettled({
      hadPendingChanges,
      saved,
      removed,
      failures,
      remainingDirty,
    });
    return;
  }
  if (state.dirHandle) {
    const remaining: typeof state.pendingTimelineDeletes = [];
    for (const pending of state.pendingTimelineDeletes) {
      try {
        const projectPath = pending.file.startsWith('content/timelines/') ? pending.file : `content/timelines/${pending.file}`;
        if (!await publishEditorWorkspaceFile(projectPath, null)) {
          throw new Error('安全保存服务未连接，请重新打开项目后再删除时间轴');
        }
        state.pendingTimelineRestores.delete(pending.id);
        clearTimelineHistory(pending.id);
        onTimelineDeleted(pending.id);
        removed++;
      } catch (err) {
        remaining.push(pending);
        recordFailure(`时间轴 '${pending.id}' 删除`, err);
      }
    }
    state.pendingTimelineDeletes = remaining;
    for (const [timelineId, restore] of [...state.pendingTimelineRestores]) {
      if (restore.entry.handle !== null) continue;
      state.pendingTimelineRestores.delete(timelineId);
      clearTimelineHistory(timelineId);
      onTimelineDeleted(timelineId);
      removed++;
    }
  }
  const authoritySceneKeys = new Set<string>();
  const newSceneKeys = [...state.scenes]
    .filter(([, scene]) => scene.dirty && scene.handle === null && !scene.persistedSha256)
    .map(([key]) => key);
  let authoritySceneCommitAttempted = false;
  if (state.dirHandle && onSceneMutationCommit !== null
    && (state.pendingSceneDeletes.length > 0 || newSceneKeys.length > 0 || state.pendingSceneCommit !== null || state.pendingSceneConfigRenames.length > 0)) {
    authoritySceneCommitAttempted = true;
    try {
      let pendingCommit = state.pendingSceneCommit;
      if (pendingCommit === null) {
        for (const key of newSceneKeys) authoritySceneKeys.add(key);
        if (newSceneKeys.length > 0 || state.pendingSceneConfigRenames.some(rename => rename.labelScene !== undefined)) {
          for (const [key, scene] of state.scenes) {
            if (scene.dirty) authoritySceneKeys.add(key);
          }
        }
        for (const pending of state.pendingSceneDeletes) {
          for (const key of pending.affectedSceneKeys ?? []) authoritySceneKeys.add(key);
          if (pending.replacementKey) authoritySceneKeys.add(pending.replacementKey);
        }
        const plans = state.pendingSceneDeletes.map((pending) => {
          if (!pending.operationId || !pending.planFingerprint) {
            throw new Error(`场景“${pending.id}”缺少安全保存计划，请重新打开项目后再试`);
          }
          return { operationId: pending.operationId, planFingerprint: pending.planFingerprint };
        });
        const writes = await Promise.all([...authoritySceneKeys].map(async (key) => {
          const scene = state.scenes.get(key);
          if (!scene) throw new Error(`场景“${key}”不在当前保存集合中`);
          const renameTarget = state.pendingSceneDeletes.some((pending) => (
            pending.kind === 'rename' && pending.replacementKey === key
          ));
          if (scene.handle !== null && !scene.persistedSha256) {
            throw new Error(`场景“${scene.id}”缺少磁盘基线，请重新打开项目后再试`);
          }
          if (scene.handle === null && scene.persistedSha256 && !renameTarget) {
            throw new Error(`场景“${scene.id}”磁盘句柄已失效，请重新打开项目后再试`);
          }
          return {
            path: sceneProjectPath(scene.file),
            text: scene.text,
            expectedSha256: renameTarget || !scene.persistedSha256 ? null : scene.persistedSha256,
          };
        }));
        writes.push(...state.pendingSceneConfigWrites.map(write => ({ ...write })));
        const configText = workingGameConfigText();
        if (configText !== state.gameConfigText && !writes.some(write => write.path === 'game.config.json')) {
          writes.push({ path: 'game.config.json', text: configText,
            expectedSha256: state.handles.gameConfig === null ? null : await sceneTextSha256(state.gameConfigText) });
        }
        const createRequestId = newSceneKeys
          .map((key) => state.scenes.get(key)?.pendingCreateOperationId)
          .find((value): value is string => typeof value === 'string');
        const requestId = plans[0]?.operationId ?? createRequestId ?? (state.pendingSceneConfigRenames.some(rename => rename.labelScene !== undefined) ? crypto.randomUUID() : undefined);
        if (!requestId) throw new Error('场景保存缺少可重试的请求身份');
        pendingCommit = {
          requestId,
          ...(state.pendingSceneConfigRenames.length === 0 ? {} : { configRenames: state.pendingSceneConfigRenames.map(rename => ({ ...rename })) }),
          plans: plans.map((entry) => ({ ...entry })),
          writes: writes.map((entry) => ({ ...entry })),
          deletedPaths: state.pendingSceneDeletes.map((pending) => sceneProjectPath(pending.file)),
        };
        state.pendingSceneCommit = pendingCommit;
        onSceneCommitStateChanged();
      } else {
        for (const write of pendingCommit.writes) {
          if (sceneReferenceConfigPaths.includes(write.path)) continue;
          const matching = [...state.scenes].find(([, scene]) => (
            sceneFileIdentity(sceneProjectPath(scene.file)) === sceneFileIdentity(write.path)
          ));
          if (!matching) throw new Error(`待收束场景“${write.path}”已不在当前工作集中`);
          authoritySceneKeys.add(matching[0]);
        }
      }
      const result = await onSceneMutationCommit({
        requestId: pendingCommit.requestId,
        ...(pendingCommit.configRenames === undefined ? {} : { configRenames: pendingCommit.configRenames }),
        plans: pendingCommit.plans,
        writes: pendingCommit.writes,
      });
      const expectedWritePaths = new Set(pendingCommit.writes.map((entry) => sceneWriteIdentity(entry.path)));
      const resultByPath = new Map<string, { path: string; sha256: string }>();
      for (const entry of result.writes) {
        const identity = sceneWriteIdentity(entry.path);
        if (!expectedWritePaths.has(identity) || resultByPath.has(identity)) {
          throw new Error('安全保存回执包含意外或重复的场景路径');
        }
        resultByPath.set(identity, entry);
      }
      if (resultByPath.size !== expectedWritePaths.size) {
        throw new Error('安全保存回执缺少场景写入结果');
      }
      const expectedDeletedPaths = new Set(pendingCommit.deletedPaths.map(sceneFileIdentity));
      const actualDeletedPaths = new Set<string>();
      for (const deletedPath of result.deletedPaths) {
        const identity = sceneFileIdentity(deletedPath);
        if (!expectedDeletedPaths.has(identity) || actualDeletedPaths.has(identity)) {
          throw new Error('安全保存回执包含意外或重复的删除路径');
        }
        actualDeletedPaths.add(identity);
      }
      if (actualDeletedPaths.size !== expectedDeletedPaths.size) {
        throw new Error('安全保存回执缺少场景删除结果');
      }
      const refreshedConfigs = new Map<ConfigSourceName, { text: string; handle: FileSystemFileHandle }>();
      for (const file of sceneReferenceConfigPaths) {
        const configWrite = resultByPath.get(file);
        if (!configWrite) continue;
        const name = configNameForPath(file);
        const parent = name === 'gameConfig' ? state.dirHandle : await (await state.dirHandle.getDirectoryHandle('content')).getDirectoryHandle('config');
        const handle = await parent.getFileHandle(name === 'gameConfig' ? 'game.config.json' : `${name}.json`);
        const text = await readProjectSourceText(handle);
        if (await sceneTextSha256(text) !== configWrite.sha256) throw new Error(`${file} 回读与保存回执不一致`);
        parseConfigSource(name, text);
        refreshedConfigs.set(name, { text, handle });
      }
      const refreshed = new Map<string, { handle: FileSystemFileHandle; file: string; sha256: string }>();
      for (const key of authoritySceneKeys) {
        const scene = state.scenes.get(key);
        if (!scene) continue;
        const written = resultByPath.get(sceneFileIdentity(sceneProjectPath(scene.file)));
        if (!written) throw new Error(`场景“${scene.id}”缺少安全保存回执`);
        const target = await scenarioParentDirectory(state.dirHandle, scene.file, false);
        const handle = await target.directory.getFileHandle(target.fileName);
        const diskText = await readProjectSourceText(handle);
        if (await sceneTextSha256(diskText) !== written.sha256) {
          throw new Error(`场景“${scene.id}”写入后回读与服务回执不一致`);
        }
        refreshed.set(key, { handle, file: target.relativeFile, sha256: written.sha256 });
      }
      for (const key of authoritySceneKeys) {
        const scene = state.scenes.get(key);
        const disk = refreshed.get(key);
        if (!scene || !disk) continue;
        scene.handle = disk.handle;
        scene.file = disk.file;
        scene.persistedSha256 = disk.sha256;
        scene.dirty = await sceneTextSha256(scene.text) !== disk.sha256;
        delete scene.pendingCreateOperationId;
        delete scene.pendingEntryScene;
      }
      for (const [name, config] of refreshedConfigs) {
        state.handles[name] = config.handle;
        if (name === 'gameConfig') {
          state.gameConfigText = config.text;
          state.entryScene = String(parseProjectConfigDocument(config.text)['entryScene'] ?? '');
        } else state.configFiles[name] = parseConfigSource(name, config.text);
      }
      saved += result.writes.length;
      removed += result.deletedPaths.length;
      state.pendingSceneDeletes = [];
      state.pendingSceneCommit = null;
      state.pendingSceneConfigWrites = [];
      state.pendingSceneConfigRenames = [];
      onSceneCommitStateChanged();
    } catch (err) {
      recordFailure('场景改名、移动或删除安全保存', err);
    }
  }
  for (const [key, sc] of state.scenes) {
    if (!sc.dirty) continue;
    if (authoritySceneKeys.has(key)) continue;
    const handle = sc.handle;
    if (!handle) {
      // 新建和重命名必须由本机 authority 独占创建；浏览器句柄不得退回可覆盖写入。
      if (state.dirHandle) {
        try {
          sceneProjectPath(sc.file || `${sc.id}.gal`);
          recordFailure(`场景 '${sc.id}' 保存`, new Error('安全保存服务未连接，请重新打开项目后再保存'));
        } catch (err) {
          recordFailure(`场景 '${sc.id}' 保存`, err);
        }
        continue;
      }
      // 演示项目（无目录句柄）：下载导出 + 保留脏标记，诚实提示（不冒充已保存）
      exportScene(sc.id, sc.text);
      recordFailure(`演示项目场景 '${sc.id}' 保存`, new Error(`已下载 ${sc.id}.gal，请手动放入 content/scenario/（脏标记保留）`));
      continue;
    }
    try {
      const submittedText = sc.text;
      await writeFileHandle(handle, submittedText);
      sc.persistedSha256 = await sceneTextSha256(submittedText);
      sc.dirty = sc.text !== submittedText;
      saved++;
    } catch (err) {
      recordFailure(`场景 '${sc.id}' 保存`, err);
    }
    void key;
  }
  if (state.dirHandle && !authoritySceneCommitAttempted) {
    for (const pending of state.pendingSceneDeletes) {
      const pendingIdentity = sceneFileIdentity(pending.file);
      const pathReused = [...state.scenes.values()].some((scene) => (
        sceneFileIdentity(scene.file) === pendingIdentity
      ));
      recordFailure(
        `场景 '${pending.id}' 旧文件清理`,
        new Error(pathReused
          ? '旧路径已被当前场景重新占用，未执行删除'
          : '安全保存服务未连接，请重新打开项目后再保存'),
      );
    }
  }
  let timelineSaved = false;
  for (const timeline of state.timelines) {
    if (!timeline.dirty) continue;
    try {
      if (!timeline.handle && !state.dirHandle) {
          exportTimeline(timeline.id, timeline.text);
          recordFailure(`演示项目时间轴 '${timeline.id}' 保存`, new Error(`已下载 ${timeline.id}.json（脏标记保留）`));
          continue;
      }
      const submittedText = timeline.text;
      const projectPath = timeline.file.startsWith('content/timelines/') ? timeline.file : `content/timelines/${timeline.file}`;
      timeline.handle = await writeProjectText(projectPath, submittedText, timeline.handle);
      timeline.persistedSha256 = await sceneTextSha256(submittedText);
      timeline.dirty = timeline.text !== submittedText;
      timelineSaved = true;
      saved++;
    } catch (err) {
      recordFailure(`时间轴 '${timeline.id}' 保存`, err);
    }
  }
  const configRemainingDirty = await saveConfigDraftsForProject();
  const remainingDirty = [...state.scenes.values()].some((scene) => scene.dirty)
    || state.timelines.some((timeline) => timeline.dirty)
    || state.pendingSceneDeletes.length > 0
    || state.pendingSceneCommit !== null
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0
    || configRemainingDirty
    || hasDirtyConfigDrafts();
  const changed = saved + removed;
  if (!hadPendingChanges) {
    setStatus('无待保存改动', true, 4000);
  } else if (failures === 0 && !remainingDirty) {
    setStatus(`全部成功：已保存 ${saved} 项${removed > 0 ? `，清理 ${removed} 个旧文件` : ''}`, true, 4000);
  } else if (changed > 0) {
    setStatus(`部分成功：已保存 ${saved} 项${removed > 0 ? `，清理 ${removed} 个旧文件` : ''}，失败 ${failures} 项`, false, 6000);
  } else {
    const firstFailure = failureMessages[0] ? `；${failureMessages[0]}` : '';
    setStatus(`全部失败：${failures} 项操作失败${firstFailure}`, false, 6000);
  }
  if (timelineSaved) renderAll();
  else renderSidebar();
  if (failures === 0 && !remainingDirty) {
    onSaved(); // 崩溃保险：仅在磁盘已最新时清除备份
  }
  onSaveSettled({ hadPendingChanges, saved, removed, failures, remainingDirty });
}

export async function saveAll(): Promise<void> {
  await runProjectWriteOperation(saveAllUnlocked);
}

export function exportScene(id: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.gal`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportCurrent(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  if (sc) exportScene(state.current, sc.text);
}

export function exportTimeline(id: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 无 FS API 环境的内存演示项目 */
export function loadDemoProject(): void {
  if (state.pendingSceneDeletes.length > 0 || state.pendingSceneCommit !== null) {
    throw new Error('当前仍有待保存的场景改名或删除，请先保存全部');
  }
  if (projectTransitionPending || activeProjectWriteOperations > 0) {
    throw new Error('当前项目仍在保存，请稍后再切换');
  }
  projectTransitionPending = true;
  let succeeded = false;
  try {
    onProjectClosing();
    assetRefreshRevision += 1;
    state.projectLoading = true;
  onProjectStateReset();
  state.reviewWorkspace = null;
  state.mainTab = 'editor';
  state.dirName = '（演示项目·未连接目录）';
  state.dirHandle = null;
  state.reviewPreviewReadOnly = false;
  state.scenes.clear();
  state.pendingSceneDeletes = [];
  state.pendingSceneCommit = null;
  state.pendingSceneConfigWrites = [];
  state.pendingSceneConfigRenames = [];
  state.lastValidation = null;
  state.lastEdges = [];
  state.timelines = [];
  state.pendingTimelineDeletes = [];
  state.pendingTimelineRestores.clear();
  state.currentTimeline = null;
  state.currentTimelineCue = null;
  state.previewTimelineId = null;
  histories.clear();
  clearTimelineHistories();
  state.gameConfigText = '';
  state.entryScene = 'demo';
  state.handles = { gameConfig: null, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null };
  state.dirAssets = [];
  state.assetIntelligence = null;
  state.assetIntelligenceState = 'loading';
  state.assetCenterSelectedId = null;
  state.assetCenterQuery = '';
  state.assetCenterKind = 'all';
  state.assetCenterStatus = 'all';
  state.assetCenterFolder = 'all';
  state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
  state.configReadErrors = {};
  state.scenes.set('demo', {
    id: 'demo',
    file: 'demo.gal',
    text: '@scene demo\n@bg hall\n凛：你好，这里是演示场景。\n@choice\n  打个招呼 -> @goto greet\n  沉默离开 -> @goto bye\n@label greet\n凛：很高兴见到你。\n@end\n@label bye\n凛：……下次见。\n@end',
    eol: '\n',
    dirty: false,
    handle: null,
  });
  state.timelines.push({
    id: 'demo_intro',
    file: 'demo_intro.json',
    text: JSON.stringify({
      version: 1,
      id: 'demo_intro',
      durationMs: 1200,
      tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 800, easing: 'inOutSine', action: 'fade', alpha: 0 }] }],
    }, null, 2) + '\n',
    eol: '\n',
    dirty: false,
    handle: null,
  });
  state.current = 'demo';
  state.currentTimeline = 'demo_intro';
  state.autosaveProjectId = 'demo-project';
  state.projectLoading = false;
  renderAll();
  runValidate();
    onProjectLoaded(); // 崩溃保险：演示项目同样支持恢复（dirName 区分）
    succeeded = true;
  } finally {
    state.projectLoading = false;
    try {
      onProjectLoadSettled(succeeded);
    } finally {
      endProjectTransition();
    }
  }
}
