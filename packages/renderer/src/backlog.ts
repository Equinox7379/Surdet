import { inlinePlainText, inlineStaticText } from '@surdet/core';
/**
 * Backlog（文字记录）：已播放文本的环形缓冲，供历史回看界面展示。
 * 由 AdvRenderer 在收到 text 事件时记录（可选注入）；宿主可另记选项/分支。
 * 引擎内核保持 headless 纯净：记录与展示都在渲染层完成。
 */

/** 一条历史记录 */
export interface BacklogEntry {
  readonly speaker: string | null;
  readonly text: string;
  /** 该行伴随的语音 key（@voice 紧跟的文本行；回看点击可重播） */
  readonly voice?: string;
  /** Static inline source, when display formatting differs from plain text. */
  readonly markup?: string;
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
  add(speaker: string | null, text: string, voice?: string, markup?: string): void {
    this.#entries.push(Object.freeze({ speaker, text, ...(voice !== undefined ? { voice } : {}), ...(markup === undefined ? {} : { markup }) }));
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
  restore(entries: readonly BacklogEntry[]): void { this.#entries = entries.slice(-this.#capacity).map(entry => Object.freeze({ ...entry })); }
}

/** Read-only save preflight. Omitted history means there was no recorded history in this snapshot. */
export function prepareBacklog(value: unknown): readonly BacklogEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > DEFAULT_BACKLOG_CAPACITY) throw new Error('文字记录必须是最多200条的数组');
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || (entry.speaker !== null && typeof entry.speaker !== 'string') || typeof entry.text !== 'string'
      || entry.voice !== undefined && typeof entry.voice !== 'string' || entry.markup !== undefined && typeof entry.markup !== 'string'
      || entry.markup !== undefined && (inlinePlainText(entry.markup) !== entry.text || inlineStaticText(entry.markup) !== entry.markup)) throw new Error('文字记录条目或标记正文不合法');
    return Object.freeze({ speaker: entry.speaker, text: entry.text, ...(entry.voice === undefined ? {} : { voice: entry.voice }), ...(entry.markup === undefined ? {} : { markup: entry.markup }) });
  });
}
