/**
 * 已读文本记录（快进跳过用）。
 * key 约定由调用方生成（Interpreter 用 sceneId#文本值）。
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
