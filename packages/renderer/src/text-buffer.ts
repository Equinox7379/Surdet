/**
 * 打字机文本缓冲：管理逐字显示进度。
 * 与渲染解耦，可 headless 测试。
 */
export interface TypewriterOptions {
  /** 每秒显示字符数 */
  charsPerSecond?: number;
}

export class Typewriter {
  #full = '';
  #shown = 0;
  #done = true;
  #cps: number;
  /** 小数字符进位累积：避免低帧率下每帧推进 0 字符导致文本停滞 */
  #carry = 0;
  onComplete: (() => void) | null = null;

  constructor(options: TypewriterOptions = {}) {
    this.#cps = options.charsPerSecond ?? 24;
  }

  /** 设置新文本（重置进度）。空文本视为立即完成并触发 onComplete。 */
  set text(value: string) {
    this.#full = value;
    this.#shown = 0;
    this.#carry = 0;
    if (value.length === 0) {
      this.#done = true;
      this.onComplete?.();
    } else {
      this.#done = false;
    }
  }

  get full(): string {
    return this.#full;
  }

  /** 当前已显示的文本 */
  get text(): string {
    return this.#full.slice(0, this.#shown);
  }

  get shown(): number {
    return this.#shown;
  }

  get isDone(): boolean {
    return this.#done;
  }

  /** 按流逝时间推进（毫秒）；小数部分进位累积 */
  update(deltaMs: number): void {
    if (this.#done) return;
    this.#carry += (deltaMs / 1000) * this.#cps;
    const chars = Math.floor(this.#carry);
    if (chars <= 0) return;
    this.#carry -= chars;
    this.#shown = Math.min(this.#full.length, this.#shown + chars);
    if (this.#shown >= this.#full.length) {
      this.#done = true;
      this.#carry = 0;
      this.onComplete?.();
    }
  }

  /** 瞬时完成全部显示 */
  skip(): void {
    if (this.#done) return;
    this.#shown = this.#full.length;
    this.#done = true;
    this.onComplete?.();
  }
}
