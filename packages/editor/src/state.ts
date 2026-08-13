/**
 * 编辑器全局状态（E0 拆分：原 main.ts 纯搬移）。
 * state 是唯一共享可变状态；各面板/IO 模块经此协作。
 */
import type { ValidateResult } from './validate.js';
import type { DirAsset } from './assets.js';
import type { ObjectIndex, RuntimeTraceEvent } from '@surdet/authoring';

export interface SceneEntry {
  /** 场景 ID（basename；引擎运行时语义） */
  id: string;
  file: string;
  text: string;
  /** 源文件换行风格（保存时保持，避免 CRLF→LF 静默改写） */
  eol: string;
  dirty: boolean;
  handle: FileSystemFileHandle | null;
}

export interface TimelineEntry {
  id: string;
  file: string;
  text: string;
  dirty: boolean;
  handle: FileSystemFileHandle | null;
}

export const state = {
  dirName: '',
  /** 项目根目录句柄（保存新建场景时写入 content/scenario/） */
  dirHandle: null as FileSystemDirectoryHandle | null,
  scenes: new Map<string, SceneEntry>(),
  /** content/timelines/*.json（预览运行时与 starter 共用的演出定义） */
  timelines: [] as TimelineEntry[],
  /** 由时间轴面板删除、待下一次“保存全部”从 content/timelines 移除的文件。 */
  pendingTimelineDeletes: [] as { id: string; file: string }[],
  gameConfigText: '',
  entryScene: '',
  current: null as string | null,
  currentTimeline: null as string | null,
  /** 从时间轴面板发起的独立直演目标；普通剧情预览时为空。 */
  previewTimelineId: null as string | null,
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
  /** 侧栏标签页：场景 | 素材（E2） */
  sidebarTab: 'scenes' as 'scenes' | 'assets',
  /** 主区标签页：块编辑 / 流程图 / 时间轴 / 配置 / 预览 / 统计 / 审计 */
  mainTab: 'editor' as 'editor' | 'flow' | 'timeline' | 'config' | 'preview' | 'stats' | 'audit',
  fsSupported: typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
};

/** 极简 DOM 构建助手（各面板共用） */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 状态栏：holdMs>0 的提示（操作反馈）驻留展示，期间不被常规校验状态覆盖（验收反馈：提示转瞬即逝）；
 *  驻留到期后自动恢复为最新校验摘要 */
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
      if (!sel || !state.lastValidation) return;
      const issues = state.lastValidation.issues;
      const errors = issues.filter((i) => i.severity === 'error').length;
      const warnings = issues.length - errors;
      sel.textContent = errors === 0 ? `校验通过（${warnings} 条警告）` : `${errors} 个错误 / ${warnings} 条警告`;
      sel.className = errors === 0 ? 'ok' : 'err';
    }, holdMs);
  } else if (ok && now < statusHoldUntil) {
    return; // 驻留期内常规状态不覆盖操作提示
  }
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
}
