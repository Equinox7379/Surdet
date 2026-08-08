import type { RenderPerformanceSnapshot } from '../performance.js';

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
  schemaVersion: 1;
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

function finiteSample(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`基线样本必须是非负有限数：${value}`);
  return value;
}

export function summarizeRendererMetric(name: RendererMetricName, samples: readonly number[]): RendererMetric {
  if (samples.length === 0) throw new Error(`基线指标 ${name} 至少需要一个样本`);
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
  };
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
