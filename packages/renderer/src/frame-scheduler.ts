import type { Application, Ticker } from 'pixi.js';
import type { FrameLoopTarget, FrameRequestSource } from './types.js';
import type { RenderPerformanceMonitor } from './performance.js';

export interface FrameSchedulerOptions {
  /** 每次实际推进后回调；可用于宿主诊断，不参与调度决策。 */
  onFrame?: (deltaMs: number, updateMs: number) => void;
  /** 可选性能采样器；不参与调度决策，避免诊断影响游戏逻辑。 */
  monitor?: RenderPerformanceMonitor;
  /** 帧失败时先停机再报告；未设置时继续抛出，后续由正常帧请求恢复。 */
  onError?: (error: unknown) => void;
}

/**
 * Pixi 帧调度器：静态画面停止 app ticker，状态事件/输入/舞台交互唤醒下一帧。
 * 业务状态仍由 AdvRenderer 管理，调度器只负责“跑一帧还是休眠”。
 */
export class FrameScheduler {
  #app: Pick<Application, 'ticker' | 'start' | 'stop'>;
  #target: FrameLoopTarget;
  #sources: FrameRequestSource[];
  #onFrame?: FrameSchedulerOptions['onFrame'];
  #monitor?: RenderPerformanceMonitor;
  #onError?: FrameSchedulerOptions['onError'];
  #disposed = false;
  #wake = (): void => {
    if (!this.#disposed) this.#app.start();
  };
  #tick = (ticker: Ticker): void => {
    if (this.#disposed) return;
    try {
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.#target.update(ticker.deltaMS);
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      this.#onFrame?.(ticker.deltaMS, elapsed);
      this.#monitor?.record(ticker.deltaMS, elapsed);
      if (!this.#target.needsUpdate) this.#app.stop();
    } catch (error) {
      // Pixi only renews RAF after listeners return; a throw otherwise strands
      // a started ticker with no pending frame, so start() cannot wake it again.
      this.#app.stop();
      if (this.#onError) this.#onError(error);
      else throw error;
    }
  };

  constructor(
    app: Pick<Application, 'ticker' | 'start' | 'stop'>,
    target: FrameLoopTarget,
    sources: readonly FrameRequestSource[] = [],
    options: FrameSchedulerOptions = {},
  ) {
    this.#app = app;
    this.#target = target;
    this.#sources = [target, ...sources];
    this.#onFrame = options.onFrame;
    this.#monitor = options.monitor;
    this.#onError = options.onError;
    for (const source of this.#sources) source.setFrameRequest(this.#wake);
    app.ticker.add(this.#tick);
    if (target.needsUpdate) app.start();
    else app.stop();
  }

  /** 主动唤醒一帧（宿主有自定义 DOM/系统事件时可调用）。 */
  requestFrame(): void {
    this.#wake();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#app.ticker.remove(this.#tick);
    for (const source of this.#sources) source.setFrameRequest(null);
    this.#app.stop();
  }
}
