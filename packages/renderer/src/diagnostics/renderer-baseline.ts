import type { RenderPerformanceSnapshot } from '../performance.js';

export const RENDERER_BASELINE_SCHEMA_VERSION = 2 as const;
export const RENDERER_BASELINE_MIN_SAMPLES = 5;

export type RendererMetricStatistic = 'median' | 'p95';

export interface RendererMetricSummary {
  coldStartMs: number;
  assetReadyMs: number;
  menuOpenP95Ms: number;
  sceneP95Ms: number;
}

export type RendererMetricName = keyof RendererMetricSummary;

export interface RendererMetric {
  name: RendererMetricName;
  samples: readonly number[];
  median: number;
  p95: number;
  summaryStatistic: RendererMetricStatistic;
}

export interface RendererEnvironment {
  node: string;
  npm: string;
  os: string;
  platform: string;
  arch: string;
  cpu: string;
  electron: string;
  playwright: string;
  buildMode: string;
}

export interface RendererResourceSnapshot {
  disposed: boolean;
  tickerCallbacks: number | null;
  listeners: number | null;
  activeTweens: number | null;
  activeAsyncTasks: number | null;
  blobUrls: number | null;
  pooledObjects: Readonly<Record<string, number>>;
  displayObjectsByOwner: Readonly<Record<string, number>>;
}

export interface RendererAssetSnapshot {
  total: number;
  completed: number;
  failed: number;
  durationMs: number;
}

export interface RendererVisualState {
  id: string;
  sha256: string;
  width: number;
  height: number;
}

export interface RendererDebugSnapshot {
  sessionId: string | null;
  resourceIds: Readonly<Record<string, string>> | null;
  fontFamilies: { body: string; title: string; ui: string } | null;
  activeBlobUrls: number | null;
  status: string | null;
  rendererStatus: string | null;
  position: { sceneId: string; pc: number; sceneHash?: string } | null;
  rawMetrics: Readonly<Record<string, unknown>> | null;
}

export interface RendererBaseline extends RendererMetricSummary {
  schemaVersion: typeof RENDERER_BASELINE_SCHEMA_VERSION;
  generatedAt: string;
  sourceSha: string;
  sourceEquivalentTo?: string;
  environment: RendererEnvironment;
  metrics: Readonly<Record<RendererMetricName, RendererMetric>>;
  assets: RendererAssetSnapshot;
  resources: RendererResourceSnapshot | null;
  performance: RenderPerformanceSnapshot | null;
  debug: RendererDebugSnapshot;
  measurementDefinitions: {
    menuOpen: string;
    sceneTransition: string;
  };
  bundle: {
    totalBytes: number;
    files: Readonly<Record<string, number>>;
    warnings: readonly string[];
  };
  errors: {
    page: number;
    console: number;
    failedRequests: number;
    messages: readonly string[];
  };
  visual: {
    states: readonly RendererVisualState[];
  };
}

export interface RendererBaselineFailure {
  metric: RendererMetricName;
  baseline: number;
  current: number;
  ratio: number;
  limit: number;
}

export interface RendererBaselineComparison {
  failures: RendererBaselineFailure[];
}

export const RENDERER_BASELINE_LIMITS: Readonly<Record<RendererMetricName, number>> = {
  coldStartMs: 1.10,
  assetReadyMs: 1.10,
  menuOpenP95Ms: 1.15,
  sceneP95Ms: 1.15,
};

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function rendererMetricSummaryStatistic(name: RendererMetricName): RendererMetricStatistic {
  return name === 'coldStartMs' || name === 'assetReadyMs' ? 'median' : 'p95';
}

export function rendererMetricSummaryValue(name: RendererMetricName, metric: RendererMetric): number {
  return metric[rendererMetricSummaryStatistic(name)];
}

function finiteSample(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`基线样本必须是非负有限数：${value}`);
  return value;
}

export function summarizeRendererMetric(name: RendererMetricName, samples: readonly number[]): RendererMetric {
  if (samples.length < RENDERER_BASELINE_MIN_SAMPLES) {
    throw new Error(`基线指标 ${name} 至少需要 ${RENDERER_BASELINE_MIN_SAMPLES} 个样本`);
  }
  const normalized = samples.map(finiteSample).sort((a, b) => a - b);
  const middle = Math.floor(normalized.length / 2);
  const median = normalized.length % 2 === 0
    ? (normalized[middle - 1]! + normalized[middle]!) / 2
    : normalized[middle]!;
  const p95Index = Math.min(normalized.length - 1, Math.max(0, Math.ceil(normalized.length * 0.95) - 1));
  return {
    name,
    samples: normalized,
    median,
    p95: normalized[p95Index]!,
    summaryStatistic: rendererMetricSummaryStatistic(name),
  };
}

export function validateRendererBaseline(input: unknown): asserts input is RendererBaseline {
  if (!isRecord(input) || input.schemaVersion !== RENDERER_BASELINE_SCHEMA_VERSION) {
    throw new Error(`Renderer 基线 schemaVersion 必须为 ${RENDERER_BASELINE_SCHEMA_VERSION}`);
  }
  if (typeof input.sourceSha !== 'string' || !SOURCE_SHA_PATTERN.test(input.sourceSha)) {
    throw new Error('Renderer 基线 sourceSha 必须是完整 40 位 SHA');
  }
  if (input.sourceEquivalentTo !== undefined
    && (typeof input.sourceEquivalentTo !== 'string' || !SOURCE_SHA_PATTERN.test(input.sourceEquivalentTo))) {
    throw new Error('Renderer 基线 sourceEquivalentTo 必须是完整 40 位 SHA');
  }
  if (!isRecord(input.metrics)) throw new Error('Renderer 基线 metrics 必须是对象');

  for (const name of Object.keys(RENDERER_BASELINE_LIMITS) as RendererMetricName[]) {
    const metricValue = input.metrics[name];
    if (!isRecord(metricValue) || metricValue.name !== name || !Array.isArray(metricValue.samples)) {
      throw new Error(`Renderer 基线缺少指标 ${name} 的完整 schema`);
    }
    const numericSamples = metricValue.samples.map((value) => {
      if (typeof value !== 'number') throw new Error(`基线指标 ${name} 的样本必须是数字`);
      return value;
    });
    const expected = summarizeRendererMetric(name, numericSamples);
    if (metricValue.summaryStatistic !== expected.summaryStatistic
      || metricValue.median !== expected.median
      || metricValue.p95 !== expected.p95
      || JSON.stringify(metricValue.samples) !== JSON.stringify(expected.samples)) {
      throw new Error(`Renderer 基线指标 ${name} 的统计字段与原始样本不一致`);
    }
    if (input[name] !== rendererMetricSummaryValue(name, expected)) {
      throw new Error(`Renderer 基线顶层指标 ${name} 未使用 ${expected.summaryStatistic}`);
    }
  }
}

function ratioFor(baseline: number, current: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline < 0 || current < 0) return Number.POSITIVE_INFINITY;
  if (baseline === 0) return current === 0 ? 1 : Number.POSITIVE_INFINITY;
  return current / baseline;
}

export function compareRendererBaseline(
  baseline: RendererMetricSummary,
  current: RendererMetricSummary,
): RendererBaselineComparison {
  const failures: RendererBaselineFailure[] = [];
  for (const metric of Object.keys(RENDERER_BASELINE_LIMITS) as RendererMetricName[]) {
    const baselineValue = baseline[metric];
    const currentValue = current[metric];
    const ratio = ratioFor(baselineValue, currentValue);
    const limit = RENDERER_BASELINE_LIMITS[metric];
    if (ratio > limit) failures.push({ metric, baseline: baselineValue, current: currentValue, ratio, limit });
  }
  return { failures };
}
