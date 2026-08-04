/**
 * Backlog（文字记录）：已播放文本的环形缓冲，供历史回看界面展示。
 * 由 AdvRenderer 在收到 text 事件时记录（可选注入）；宿主可另记选项/分支。
 * 引擎内核保持 headless 纯净：记录与展示都在渲染层完成。
 */

/** 一条历史记录 */
export interface BacklogEntry {
  speaker: string | null;
  text: string;
  /** 该行伴随的语音 key（@voice 紧跟的文本行；回看点击可重播） */
  voice?: string;
}

/** 默认容量：ADV 常规体量下足够回看，内存占用可忽略 */
export const DEFAULT_BACKLOG_CAPACITY = 200;

export class Backlog {
  #entries: BacklogEntry[] = [];
  #capacity: number;

  constructor(capacity = DEFAULT_BACKLOG_CAPACITY) {
    this.#capacity = Math.max(1, capacity | 0);
  }

  /** 追加一条记录（超容量淘汰最旧） */
  add(speaker: string | null, text: string, voice?: string): void {
    this.#entries.push({ speaker, text, ...(voice !== undefined ? { voice } : {}) });
    if (this.#entries.length > this.#capacity) this.#entries.shift();
  }

  /** 全部记录（旧 → 新）。返回副本防外部篡改内部缓冲。 */
  entries(): BacklogEntry[] {
    return [...this.#entries];
  }

  /** 最近 n 条（旧 → 新） */
  latest(n: number): BacklogEntry[] {
    return this.#entries.slice(-n);
  }

  get size(): number {
    return this.#entries.length;
  }

  clear(): void {
    this.#entries = [];
  }
}
