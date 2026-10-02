/**
 * 渲染运行时性能采样与预算诊断。
 * 该模块只记录数据，不改变剧情状态，也不依赖 Pixi，宿主和编辑器可以复用。
 */
export interface RenderPerformanceBudget {
  updateBudgetMs: number;
  maxSlowFrames: number;
  sampleWindowSize: number;
}

export const DEFAULT_RENDER_PERFORMANCE_BUDGET: RenderPerformanceBudget = {
  updateBudgetMs: 8,
  maxSlowFrames: 3,
  sampleWindowSize: 120,
};

export interface RenderPerformanceSample {
  deltaMs: number;
  updateMs: number;
  slow: boolean;
}

export interface RenderPerformanceSnapshot {
  frames: number;
  slowFrames: number;
  averageDeltaMs: number;
  averageUpdateMs: number;
  maxUpdateMs: number;
  withinBudget: boolean;
  budget: RenderPerformanceBudget;
  samples: readonly RenderPerformanceSample[];
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeBudget(input: Partial<RenderPerformanceBudget> = {}): RenderPerformanceBudget {
  const updateBudgetMs = Math.max(0.1, finiteNonNegative(input.updateBudgetMs ?? DEFAULT_RENDER_PERFORMANCE_BUDGET.updateBudgetMs, DEFAULT_RENDER_PERFORMANCE_BUDGET.updateBudgetMs));
  const sampleWindowSize = Math.max(1, Math.floor(finiteNonNegative(input.sampleWindowSize ?? DEFAULT_RENDER_PERFORMANCE_BUDGET.sampleWindowSize, DEFAULT_RENDER_PERFORMANCE_BUDGET.sampleWindowSize)));
  const maxSlowFrames = Math.max(0, Math.floor(finiteNonNegative(input.maxSlowFrames ?? DEFAULT_RENDER_PERFORMANCE_BUDGET.maxSlowFrames, DEFAULT_RENDER_PERFORMANCE_BUDGET.maxSlowFrames)));
  return { updateBudgetMs, maxSlowFrames, sampleWindowSize };
}

export class RenderPerformanceMonitor {
  readonly budget: RenderPerformanceBudget;
  #samples: RenderPerformanceSample[] = [];

  constructor(budget: Partial<RenderPerformanceBudget> = {}) {
    this.budget = normalizeBudget(budget);
  }

  record(deltaMs: number, updateMs: number): RenderPerformanceSample {
    const safeUpdateMs = finiteNonNegative(updateMs, 0);
    const sample: RenderPerformanceSample = {
      deltaMs: finiteNonNegative(deltaMs, 0),
      updateMs: safeUpdateMs,
      slow: safeUpdateMs > this.budget.updateBudgetMs,
    };
    this.#samples.push(sample);
    if (this.#samples.length > this.budget.sampleWindowSize) this.#samples.shift();
    return { ...sample };
  }

  snapshot(): RenderPerformanceSnapshot {
    const frames = this.#samples.length;
    const sumDelta = this.#samples.reduce((sum, sample) => sum + sample.deltaMs, 0);
    const sumUpdate = this.#samples.reduce((sum, sample) => sum + sample.updateMs, 0);
    const slowFrames = this.#samples.reduce((sum, sample) => sum + (sample.slow ? 1 : 0), 0);
    return {
      frames,
      slowFrames,
      averageDeltaMs: frames > 0 ? sumDelta / frames : 0,
      averageUpdateMs: frames > 0 ? sumUpdate / frames : 0,
      maxUpdateMs: this.#samples.reduce((max, sample) => Math.max(max, sample.updateMs), 0),
      withinBudget: slowFrames <= this.budget.maxSlowFrames,
      budget: { ...this.budget },
      samples: this.#samples.map(sample => ({ ...sample })),
    };
  }

  reset(): void {
    this.#samples = [];
  }
}
