/**
 * 编辑器全局状态（E0 拆分：原 main.ts 纯搬移）。
 * state 是唯一共享可变状态；各面板/IO 模块经此协作。
 */
import type { ValidateResult } from './validate.js';
import type { DirAsset } from './assets.js';
import type { ObjectIndex, ProjectAssetIntelligence, ProjectAssetKind, RuntimeTraceEvent } from '@surdet/authoring';
import type { ReviewWorkspaceState } from './review-workspace.js';
import type { EditorModeId } from './shell/editor-modes.js';
import type { AssetImportWorkspaceProjection } from './asset-import-workspace.js';

export interface SceneEntry {
  /** 场景 ID（basename；引擎运行时语义） */
  id: string;
  file: string;
  text: string;
  /** 源文件换行风格（保存时保持，避免 CRLF→LF 静默改写） */
  eol: string;
  dirty: boolean;
  handle: FileSystemFileHandle | null;
  /** 最近一次从磁盘读取或安全保存的正文指纹；用于本机服务提交前拒绝外部覆盖。 */
  persistedSha256?: string;
  /** 新场景首次安全写入的稳定请求身份；响应丢失后可重放同一提交。 */
  pendingCreateOperationId?: string;
  /** Moving an implicit-entry project must pin this identity with the file save. */
  pendingEntryScene?: string;
}

export interface TimelineEntry {
  id: string;
  file: string;
  text: string;
  eol: '\r\n' | '\n';
  dirty: boolean;
  handle: FileSystemFileHandle | null;
  /** 最近一次成功读取或保存的磁盘正文指纹。 */
  persistedSha256?: string;
}

export interface PendingSceneDelete {
  /** 用户意图；rename 只有在 replacementKey 已成功落盘后才可删除旧文件。 */
  kind: 'rename' | 'delete';
  id: string;
  /** content/scenario 下的安全相对路径。 */
  file: string;
  replacementKey?: string;
  /** 本机服务在用户作出操作时冻结的源文件身份。 */
  operationId?: string;
  planFingerprint?: string;
  /** 重命名时必须与新场景一起提交的全部场景 key。 */
  affectedSceneKeys?: string[];
}

export interface PendingSceneCommit {
  /** 首次提交前冻结；网络中断后必须原样重放，不能用后续编辑改写。 */
  requestId: string;
  plans: Array<{ operationId: string; planFingerprint: string }>;
  configRenames?: Array<{ from: string; to: string; labelScene?: string }>;
  writes: Array<{ path: string; text: string; expectedSha256: string | null }>;
  /** 只用于 Editor 核验服务回执，不发送给 authority。 */
  deletedPaths: string[];
}

export interface TimelineCueSelection {
  trackIndex: number;
  cueIndex: number;
}

export interface PendingTimelineRestore {
  entry: TimelineEntry;
  index: number;
  previousTimelineId: string | null;
  previousCue: TimelineCueSelection | null;
}

export const state = {
  dirName: '',
  /** autosave 专用的持久项目身份；真实目录优先来自 FileSystemHandle.isSameEntry 登记表。 */
  autosaveProjectId: null as string | null,
  /** 打开目录期间暂停定时快照，避免把上一项目的冲突写进正在装载的新项目。 */
  projectLoading: false,
  /** 项目根目录句柄（保存新建场景时写入 content/scenario/） */
  dirHandle: null as FileSystemDirectoryHandle | null,
  /** 正式结果的只读预览不能作为创作工作区。 */
  reviewPreviewReadOnly: false,
  scenes: new Map<string, SceneEntry>(),
  /** 场景删除与重命名旧文件清理统一在“保存全部”边界执行。 */
  pendingSceneDeletes: [] as PendingSceneDelete[],
  /** 已发出但尚未完成本地回执核验的场景保存批次。 */
  pendingSceneCommit: null as PendingSceneCommit | null,
  /** Scene identity and config references remain a single unsaved/recoverable edit. */
  pendingSceneConfigWrites: [] as Array<{ path: string; text: string; expectedSha256: string | null }>,
  pendingSceneConfigRenames: [] as Array<{ from: string; to: string; labelScene?: string }>,
  /** content/timelines/*.json（预览运行时与 starter 共用的演出定义） */
  timelines: [] as TimelineEntry[],
  /** 由时间轴面板删除、待下一次“保存全部”从 content/timelines 移除的文件。 */
  pendingTimelineDeletes: [] as { id: string; file: string }[],
  /** 保存前仍可逐项恢复的完整时间轴删除墓碑。 */
  pendingTimelineRestores: new Map<string, PendingTimelineRestore>(),
  gameConfigText: '',
  entryScene: '',
  current: null as string | null,
  currentTimeline: null as string | null,
  /** 当前时间轴中的唯一 cue 选择真相；timeline 切换或结构失效时清空。 */
  currentTimelineCue: null as TimelineCueSelection | null,
  /** 从时间轴面板发起的独立直演目标；普通剧情预览时为空。 */
  previewTimelineId: null as string | null,
  /** 结果审阅的显式 choices；普通项目预览不携带 review 选择。 */
  previewChoices: null as Record<string, string> | null,
  lastValidation: null as ValidateResult | null,
  /** 当前 authoring 内存快照的共享对象索引；不生成 editor 私有对象 ID。 */
  selectedObjectRef: null as string | null,
  authoringIndex: null as ObjectIndex | null,
  previewTrace: [] as RuntimeTraceEvent[],
  selectedTraceStep: null as number | null,
  /** 场景引用图谱（Worker 或同步校验产出；自我迭代①b） */
  lastEdges: [] as { from: string; to: string; kind: 'jump' | 'call' }[],
  /** content/config/*.json 原始对象（E1a：流程图宿主入口与 CLI collectConfigSceneRoots 同源；
   *  E2/E3：achievements/gallery 供素材清单与配置编辑器） */
  configFiles: { events: null as unknown, growth: null as unknown, calendar: null as unknown, achievements: null as unknown, gallery: null as unknown, terminology: null as unknown },
  /** 读取/解析失败不等同于缺失配置；保留路径级错误，阻止旧值或空表覆盖来源。 */
  configReadErrors: {} as Partial<Record<'gameConfig' | 'events' | 'growth' | 'calendar' | 'achievements' | 'gallery' | 'terminology', string>>,
  /** 配置文件句柄（E3：写盘需要；无 FS API 环境为 null，保存入口置灰） */
  handles: {
    gameConfig: null as FileSystemFileHandle | null,
    achievements: null as FileSystemFileHandle | null,
    calendar: null as FileSystemFileHandle | null,
    events: null as FileSystemFileHandle | null,
    growth: null as FileSystemFileHandle | null,
    gallery: null as FileSystemFileHandle | null,
    terminology: null as FileSystemFileHandle | null,
  },
  /** content/assets（及 public/）扫描出的素材文件条目（E2） */
  dirAssets: [] as DirAsset[],
  /** 与 Agent/CLI 同源的只读素材事实；FileSystemHandle 仅保留在 dirAssets 视图适配层。 */
  assetIntelligence: null as ProjectAssetIntelligence | null,
  assetIntelligenceState: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  assetCenterSelectedId: null as string | null,
  assetCenterQuery: '',
  assetCenterKind: 'all' as 'all' | ProjectAssetKind,
  assetCenterStatus: 'all' as 'all' | 'referenced' | 'unused' | 'missing' | 'duplicate' | 'invalid-name' | 'unsupported',
  assetCenterView: 'list' as 'list' | 'grid',
  /** 只读目录筛选；值为规范化的 content/assets 相对目录。 */
  assetCenterFolder: 'all' as 'all' | string,
  /** 纯显示偏好，和列表/网格视图一样在本次编辑器会话内跨项目保留。 */
  assetCenterSort: 'path' as 'path' | 'name' | 'size-desc' | 'references-desc' | 'attention',
  /** 仅含可展示投影与本页 File；授权令牌和浏览器会话永不进入全局 state。 */
  assetImportWorkspace: null as AssetImportWorkspaceProjection | null,
  /** 本页面的共享写入冻结；本机 authority 整理素材时阻止 File System Access 并发写盘。 */
  /** A project-wide operation that owns writes and project switching until it settles. */
  projectWriteLock: null as null | 'asset-relocation' | 'game-export',
  /** 侧栏标签页：场景 | 素材（E2） */
  sidebarTab: 'scenes' as 'scenes' | 'assets',
  /** 当前已打开的 human review workspace；普通项目打开时必须清空。 */
  reviewWorkspace: null as ReviewWorkspaceState | null,
  /** 主工作区：剧本 / 流程 / 时间轴 / 配置 / 预览 / 审阅 / 统计 / 审计 */
  mainTab: 'editor' as EditorModeId,
  fsSupported: typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
};

/** 极简 DOM 构建助手（各面板共用） */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 状态栏：holdMs>0 的提示（操作反馈）驻留展示，期间不被常规状态覆盖（验收反馈：提示转瞬即逝）；
 *  驻留到期后清空。校验摘要由状态栏常驻的问题按钮显示，不再占用这一行。 */
let statusHoldUntil = 0;
let statusHoldTimer: ReturnType<typeof setTimeout> | null = null;

export function setStatus(text: string, ok: boolean, holdMs = 0): void {
  const el = document.getElementById('status');
  if (!el) return;
  const now = Date.now();
  if (holdMs > 0) {
    statusHoldUntil = now + holdMs;
    if (statusHoldTimer) clearTimeout(statusHoldTimer);
    statusHoldTimer = setTimeout(() => {
      statusHoldUntil = 0;
      const sel = document.getElementById('status');
      if (!sel) return;
      sel.textContent = '';
      sel.title = '';
      sel.className = 'ok';
    }, holdMs);
  } else if (ok && now < statusHoldUntil) {
    return; // 驻留期内常规状态不覆盖操作提示
  }
  el.textContent = text;
  el.title = text;
  el.className = ok ? 'ok' : 'err';
}
