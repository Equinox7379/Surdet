import type { BacklogEntry } from './backlog.js';

export interface BacklogSearchResult {
  index: number;
  entry: BacklogEntry;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function searchBacklog(entries: readonly BacklogEntry[], query: string): BacklogSearchResult[] {
  const needle = normalize(query);
  return entries.reduce<BacklogSearchResult[]>((result, entry, index) => {
    const haystack = `${entry.speaker ?? ''}\n${entry.text}`.toLowerCase();
    if (!needle || haystack.includes(needle)) result.push({ index, entry });
    return result;
  }, []);
}

/** Backlog 查询状态；不依赖舞台、解释器、存档或宿主。 */
export class BacklogSearchController {
  #query = '';
  #focused = false;

  get query(): string {
    return this.#query;
  }

  get focused(): boolean {
    return this.#focused;
  }

  focus(): void {
    this.#focused = true;
  }

  blur(): void {
    this.#focused = false;
  }

  append(value: string): void {
    if (!value) return;
    this.#focused = true;
    this.#query += value;
  }

  backspace(): void {
    this.#query = Array.from(this.#query).slice(0, -1).join('');
  }

  clear(): void {
    this.#query = '';
  }

  /** Escape 优先清除查询/退出搜索焦点；返回 true 表示已消费。 */
  handleEscape(): boolean {
    if (this.#query.length > 0) {
      this.clear();
      return true;
    }
    if (this.#focused) {
      this.blur();
      return true;
    }
    return false;
  }

  results(entries: readonly BacklogEntry[]): BacklogSearchResult[] {
    return searchBacklog(entries, this.#query);
  }
}
