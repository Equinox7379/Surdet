/**
 * 已读文本记录（快进跳过用）。
 * key 由调用方生成，约定为 `场景ID#指令索引`（Interpreter 用 `sceneId#instr.index`，
 * 见 interpreter.ts text 分支）——开发期编辑剧本会导致指令索引变化、已读标记失效，属预期。
 */
export class ReadTracker {
  #seen = new Set<string>();

  mark(key: string): void {
    this.#seen.add(key);
  }

  has(key: string): boolean {
    return this.#seen.has(key);
  }

  get size(): number {
    return this.#seen.size;
  }

  snapshot(): string[] {
    return [...this.#seen];
  }

  restore(keys: readonly string[]): void {
    this.#seen = new Set(keys);
  }
}
