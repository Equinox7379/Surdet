export const SEEDED_RANDOM_ALGORITHM = 'mulberry32-v1' as const;
const UINT32_MAX = 0xffff_ffff;

export interface RandomState {
  readonly algorithm: typeof SEEDED_RANDOM_ALGORITHM;
  readonly state: number;
}

export interface RandomSource {
  next(): number;
  snapshot?(): RandomState;
  validateSnapshot?(value: RandomState): void;
  restore?(value: RandomState): void;
}

export function assertValidRandomSeed(seed: unknown): asserts seed is number {
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new Error(`随机 seed 必须是 0..${UINT32_MAX} 的整数`);
  }
}

export function assertValidRandomState(value: unknown): asserts value is RandomState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('随机状态必须是对象');
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.algorithm !== SEEDED_RANDOM_ALGORITHM) {
    throw new Error(`不支持的随机算法：${String(snapshot.algorithm)}`);
  }
  if (typeof snapshot.state !== 'number' || !Number.isInteger(snapshot.state) || snapshot.state < 0 || snapshot.state > UINT32_MAX) {
    throw new Error(`随机状态 state 必须是 0..${UINT32_MAX} 的整数`);
  }
}

export interface SeededRandomSource extends RandomSource {
  readonly algorithm: typeof SEEDED_RANDOM_ALGORITHM;
  readonly seed: number;
  snapshot(): RandomState;
  validateSnapshot(value: RandomState): void;
  restore(value: RandomState): void;
}

class Mulberry32RandomSource implements SeededRandomSource {
  readonly algorithm = SEEDED_RANDOM_ALGORITHM;
  #seed: number;
  #state: number;

  constructor(seed: number) {
    assertValidRandomSeed(seed);
    this.#seed = seed;
    this.#state = seed >>> 0;
  }

  get seed(): number {
    return this.#seed;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  snapshot(): RandomState {
    return { algorithm: this.algorithm, state: this.#state };
  }

  validateSnapshot(value: RandomState): void {
    assertValidRandomState(value);
  }

  restore(value: RandomState): void {
    this.validateSnapshot(value);
    this.#state = value.state;
  }
}

export function createSeededRandomSource(seed: number): SeededRandomSource {
  return new Mulberry32RandomSource(seed);
}
