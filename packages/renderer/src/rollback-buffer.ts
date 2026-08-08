export interface AudioPlaybackSnapshot {
  bgm: string | null;
  ambience: string | null;
}

export interface RollbackFrame<TSnapshot> {
  snapshot: TSnapshot;
  presentation: unknown;
  audio: AudioPlaybackSnapshot;
}

function clone<T>(value: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    throw new TypeError('回退帧包含不可克隆的数据', { cause: error });
  }
}

export class RollbackBuffer<TSnapshot> {
  readonly #capacity: number;
  #frames: RollbackFrame<TSnapshot>[] = [];

  constructor(capacity = 50) {
    this.#capacity = Math.max(1, Math.floor(capacity));
  }

  push(frame: RollbackFrame<TSnapshot>): void {
    const copy = clone(frame);
    this.#frames.push(copy);
    while (this.#frames.length > this.#capacity) this.#frames.shift();
  }

  pop(): RollbackFrame<TSnapshot> | null {
    return this.#frames.pop() ?? null;
  }

  clear(): void {
    this.#frames = [];
  }

  get size(): number {
    return this.#frames.length;
  }
}
