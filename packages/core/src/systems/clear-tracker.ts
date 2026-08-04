/**
 * 通关记录系统（Clear Tracker）。
 * @clear [结局ID] 指令由 Interpreter 驱动：记录本周目达成的结局集合，
 * 状态随存档持久化；宿主另可经 clear 事件把通关事实写入全局记录（跨周目继承判定）。
 */

/** 通关状态快照（随存档保存） */
export interface ClearSnapshot {
  /** 本周目达成的结局标识列表（去重，保持首次达成顺序） */
  endings: string[];
}

/**
 * 通关记录器：结局收集 + 是否通关判定。
 * 兰斯式多结局：同一周目可达成多个结局（各结局场景各放一条 @clear），
 * 全部结局收集常用于解锁真结局/特典内容。
 */
export class ClearTracker {
  #endings: string[] = [];

  /** 标记达成一个结局，返回是否首次达成（用于"新结局解锁"提示）。
   *  ending 为空时由调用方兜底（解释器用当前场景 ID）。 */
  markClear(ending: string): boolean {
    if (this.#endings.includes(ending)) return false;
    this.#endings.push(ending);
    return true;
  }

  /** 是否达成过至少一个结局（本周目/存档视角） */
  isCleared(): boolean {
    return this.#endings.length > 0;
  }

  /** 已达成的结局列表（副本） */
  endings(): string[] {
    return [...this.#endings];
  }

  /** 结局收集进度（供 UI：已收集 n / 总数 m） */
  get count(): number {
    return this.#endings.length;
  }

  snapshot(): ClearSnapshot {
    return { endings: [...this.#endings] };
  }

  restore(snap: ClearSnapshot | undefined): void {
    this.#endings = [...(snap?.endings ?? [])];
  }
}
