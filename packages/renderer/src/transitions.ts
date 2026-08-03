/**
 * 转场补间：通用数值/透明度缓动。
 * 与渲染解耦，可 headless 测试。
 */
export type Easing = (t: number) => number;

export const EASINGS: Record<string, Easing> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeIn: (t) => t * t * t,
};

export interface TweenState {
  value: number;
  done: boolean;
}

/**
 * 单段数值补间：from → to，按时长 + 缓动。
 * update(dtMs) 返回当前值并推进；done 后值固定。
 */
export class ValueTween {
  #from: number;
  #to: number;
  #durMs: number;
  #elapsed = 0;
  #easing: Easing;
  #done = false;
  onDone: (() => void) | null = null;

  constructor(from: number, to: number, durMs: number, easing: Easing = EASINGS['easeInOut']!) {
    this.#from = from;
    this.#to = to;
    this.#durMs = Math.max(0, durMs);
    this.#easing = easing;
  }

  get done(): boolean {
    return this.#done;
  }

  get value(): number {
    if (this.#done) return this.#to;
    if (this.#durMs === 0) return this.#to;
    const t = Math.min(1, this.#elapsed / this.#durMs);
    return this.#from + (this.#to - this.#from) * this.#easing(t);
  }

  update(deltaMs: number): number {
    if (this.#done) return this.#to;
    this.#elapsed += deltaMs;
    if (this.#elapsed >= this.#durMs) {
      this.#done = true;
      this.onDone?.();
      return this.#to;
    }
    return this.value;
  }
}

/** 黑场淡入淡出：fadeout = alpha 0→1，fadein = 1→0（叠加在舞台之上） */
export class FadeTween extends ValueTween {
  /** 当前不透明度 */
  get alpha(): number {
    return this.value;
  }
}
