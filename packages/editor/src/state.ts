/**
 * 编辑器全局状态（E0 拆分：原 main.ts 纯搬移）。
 * state 是唯一共享可变状态；各面板/IO 模块经此协作。
 */
import type { ValidateResult } from './validate.js';

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

export const state = {
  dirName: '',
  /** 项目根目录句柄（保存新建场景时写入 content/scenario/） */
  dirHandle: null as FileSystemDirectoryHandle | null,
  scenes: new Map<string, SceneEntry>(),
  gameConfigText: '',
  entryScene: '',
  current: null as string | null,
  lastValidation: null as ValidateResult | null,
  /** 场景引用图谱（Worker 或同步校验产出；自我迭代①b） */
  lastEdges: [] as { from: string; to: string; kind: 'jump' | 'call' }[],
  /** content/config/*.json 原始对象（E1a：流程图宿主入口与 CLI collectConfigSceneRoots 同源） */
  configFiles: { events: null as unknown, growth: null as unknown, calendar: null as unknown },
  /** 主区标签页：块编辑 / 流程图（E1a） */
  mainTab: 'editor' as 'editor' | 'flow',
  fsSupported: typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
};

/** 极简 DOM 构建助手（各面板共用） */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function setStatus(text: string, ok: boolean): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
}
