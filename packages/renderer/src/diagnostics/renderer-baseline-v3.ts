import {
  RENDERER_BASELINE_LIMITS,
  type RendererEnvironment,
  type RendererMetricName,
  type RendererMetricStatistic,
} from './renderer-baseline.js';

export const RENDERER_BASELINE_V3_SCHEMA_VERSION = 3 as const;
export const RENDERER_V3_MIN_STARTUP_SAMPLES = 5;
export const RENDERER_V3_MIN_INTERACTION_SAMPLES = 20;

export type RendererV3RunRole = 'baseline' | 'current';

export interface RendererV3ExecutionStep {
  readonly pair: number;
  readonly role: RendererV3RunRole;
}

export interface RendererV3RawSamples {
  readonly coldStartMs: readonly number[];
  readonly assetReadyMs: readonly number[];
  readonly menuOpenP95Ms: readonly number[];
  readonly sceneP95Ms: readonly number[];
}

export interface RendererV3Metric {
  readonly name: RendererMetricName;
  /** Raw samples in execution/pair order; this array is never sorted in-place. */
  readonly samples: readonly number[];
  readonly sortedSamples: readonly number[];
  readonly median: number;
  readonly p95: number;
  readonly summaryStatistic: RendererMetricStatistic;
  readonly minimumSamples: number;
}

export interface RendererV3Run {
  readonly sourceSha: string;
  readonly sampleCount: Readonly<Record<RendererMetricName, number>>;
  readonly metrics: Readonly<Record<RendererMetricName, RendererV3Metric>>;
}

export interface RendererV3EnvironmentComparison {
  readonly baseline: RendererEnvironment;
  readonly current: RendererEnvironment;
  readonly differences: readonly string[];
}

export interface RendererV3MetricComparison {
  readonly metric: RendererMetricName;
  readonly baseline: number;
  readonly current: number;
  /** Informational ratio of the two summary statistics. */
  readonly summaryRatio: number;
  /** Gate ratio: median of same-pair current/baseline ratios. */
  readonly ratio: number;
  readonly pairedRatios: readonly number[];
  readonly limit: number;
  readonly passed: boolean;
  readonly baselineSampleCount: number;
  readonly currentSampleCount: number;
}

export interface RendererBaselineV3 {
  readonly schemaVersion: typeof RENDERER_BASELINE_V3_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly baselineCommit: string;
  readonly currentCommit: string;
  readonly pairCount: number;
  readonly warmupOrder: readonly RendererV3RunRole[];
  readonly executionOrder: readonly RendererV3ExecutionStep[];
  readonly environment: RendererV3EnvironmentComparison;
  readonly baseline: RendererV3Run;
  readonly current: RendererV3Run;
  readonly comparison: {
    readonly metrics: Readonly<Record<RendererMetricName, RendererV3MetricComparison>>;
    readonly failures: readonly RendererV3MetricComparison[];
  };
}

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const METRIC_NAMES: readonly RendererMetricName[] = [
  'coldStartMs',
  'assetReadyMs',
  'menuOpenP95Ms',
  'sceneP95Ms',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSourceSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SOURCE_SHA_PATTERN.test(value)) {
    throw new Error(`${label} 必须是完整 40 位 SHA`);
  }
}

function finiteSample(value: number, name: RendererMetricName): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`v3 基线样本 ${name} 必须是非负有限数：${value}`);
  }
  return value;
}

function minimumSamplesFor(name: RendererMetricName): number {
  return name === 'coldStartMs' || name === 'assetReadyMs'
    ? RENDERER_V3_MIN_STARTUP_SAMPLES
    : RENDERER_V3_MIN_INTERACTION_SAMPLES;
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/** Linear-interpolated nearest-rank equivalent; unlike v2, n=20 is not max(). */
function percentile(sorted: readonly number[], quantile: number): number {
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
}

export function summarizeRendererMetricV3(
  name: RendererMetricName,
  samples: readonly number[],
): RendererV3Metric {
  const minimumSamples = minimumSamplesFor(name);
  if (samples.length < minimumSamples) {
    throw new Error(`v3 指标 ${name} 至少需要 ${minimumSamples} 个样本`);
  }
  const rawSamples = samples.map((value) => finiteSample(value, name));
  const sortedSamples = [...rawSamples].sort((a, b) => a - b);
  return {
    name,
    samples: rawSamples,
    sortedSamples,
    median: median(sortedSamples),
    p95: percentile(sortedSamples, 0.95),
    summaryStatistic: name === 'coldStartMs' || name === 'assetReadyMs' ? 'median' : 'p95',
    minimumSamples,
  };
}

export function buildRendererV3Run(sourceSha: string, rawSamples: RendererV3RawSamples): RendererV3Run {
  assertSourceSha(sourceSha, 'sourceSha');
  const metrics = {
    coldStartMs: summarizeRendererMetricV3('coldStartMs', rawSamples.coldStartMs),
    assetReadyMs: summarizeRendererMetricV3('assetReadyMs', rawSamples.assetReadyMs),
    menuOpenP95Ms: summarizeRendererMetricV3('menuOpenP95Ms', rawSamples.menuOpenP95Ms),
    sceneP95Ms: summarizeRendererMetricV3('sceneP95Ms', rawSamples.sceneP95Ms),
  } satisfies Record<RendererMetricName, RendererV3Metric>;
  return {
    sourceSha,
    sampleCount: Object.fromEntries(METRIC_NAMES.map((name) => [name, metrics[name].samples.length])) as Record<RendererMetricName, number>,
    metrics,
  };
}

function environmentDifferences(
  baseline: RendererEnvironment,
  current: RendererEnvironment,
): string[] {
  const differences: string[] = [];
  for (const key of Object.keys(baseline) as (keyof RendererEnvironment)[]) {
    if (baseline[key] !== current[key]) differences.push(`${key}: ${baseline[key]} !== ${current[key]}`);
  }
  return differences;
}

function validateExecutionOrder(order: readonly RendererV3ExecutionStep[], pairCount: number): void {
  if (order.length !== pairCount * 2) {
    throw new Error(`v3 executionOrder 必须包含 ${pairCount * 2} 个步骤`);
  }
  for (let index = 0; index < pairCount; index += 1) {
    const firstRole: RendererV3RunRole = index % 2 === 0 ? 'baseline' : 'current';
    const secondRole: RendererV3RunRole = firstRole === 'baseline' ? 'current' : 'baseline';
    const first = order[index * 2];
    const second = order[index * 2 + 1];
    if (first?.pair !== index + 1 || first.role !== firstRole
      || second?.pair !== index + 1 || second.role !== secondRole) {
      throw new Error(`v3 executionOrder 在 pair ${index + 1} 不是预期的 counterbalanced 顺序`);
    }
  }
}

function ratioFor(baseline: number, current: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline < 0 || current < 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (baseline === 0) return current === 0 ? 1 : Number.POSITIVE_INFINITY;
  return current / baseline;
}

function compareMetric(
  name: RendererMetricName,
  baseline: RendererV3Metric,
  current: RendererV3Metric,
): RendererV3MetricComparison {
  if (baseline.samples.length !== current.samples.length) {
    throw new Error(`v3 指标 ${name} 缺少配对样本：baseline=${baseline.samples.length} current=${current.samples.length}`);
  }
  const pairedRatios = baseline.samples.map((value, index) => ratioFor(value, current.samples[index]!));
  const ratio = median([...pairedRatios].sort((a, b) => a - b));
  const summaryRatio = ratioFor(
    baseline[baseline.summaryStatistic],
    current[current.summaryStatistic],
  );
  const limit = RENDERER_BASELINE_LIMITS[name];
  return {
    metric: name,
    baseline: baseline[baseline.summaryStatistic],
    current: current[current.summaryStatistic],
    summaryRatio,
    ratio,
    pairedRatios,
    limit,
    passed: ratio <= limit,
    baselineSampleCount: baseline.samples.length,
    currentSampleCount: current.samples.length,
  };
}

export function compareRendererBaselineV3(input: {
  readonly baselineCommit: string;
  readonly currentCommit: string;
  readonly pairCount: number;
  readonly warmupOrder: readonly RendererV3RunRole[];
  readonly executionOrder: readonly RendererV3ExecutionStep[];
  readonly baselineEnvironment: RendererEnvironment;
  readonly currentEnvironment: RendererEnvironment;
  readonly baseline: RendererV3Run;
  readonly current: RendererV3Run;
  readonly generatedAt?: string;
}): RendererBaselineV3 {
  assertSourceSha(input.baselineCommit, 'baselineCommit');
  assertSourceSha(input.currentCommit, 'currentCommit');
  if (!Number.isInteger(input.pairCount) || input.pairCount < RENDERER_V3_MIN_INTERACTION_SAMPLES) {
    throw new Error(`v3 pairCount 至少需要 ${RENDERER_V3_MIN_INTERACTION_SAMPLES} 对样本`);
  }
  if (input.warmupOrder.length !== 2 || input.warmupOrder[0] === input.warmupOrder[1]) {
    throw new Error('v3 warmupOrder 必须包含 baseline/current 各一次');
  }
  validateExecutionOrder(input.executionOrder, input.pairCount);
  const differences = environmentDifferences(input.baselineEnvironment, input.currentEnvironment);
  if (differences.length > 0) {
    throw new Error(`v3 环境不一致，拒绝作为硬门禁：${differences.join('; ')}`);
  }
  for (const name of METRIC_NAMES) {
    if (input.baseline.metrics[name].samples.length !== input.pairCount
      || input.current.metrics[name].samples.length !== input.pairCount) {
      throw new Error(`v3 指标 ${name} 的样本数必须等于 pairCount=${input.pairCount}`);
    }
  }
  const metricComparisons = Object.fromEntries(
    METRIC_NAMES.map((name) => [name, compareMetric(name, input.baseline.metrics[name], input.current.metrics[name])]),
  ) as Record<RendererMetricName, RendererV3MetricComparison>;
  const failures = METRIC_NAMES.map((name) => metricComparisons[name]).filter((item) => !item.passed);
  return {
    schemaVersion: RENDERER_BASELINE_V3_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baselineCommit: input.baselineCommit,
    currentCommit: input.currentCommit,
    pairCount: input.pairCount,
    warmupOrder: [...input.warmupOrder],
    executionOrder: [...input.executionOrder],
    environment: {
      baseline: input.baselineEnvironment,
      current: input.currentEnvironment,
      differences,
    },
    baseline: input.baseline,
    current: input.current,
    comparison: { metrics: metricComparisons, failures },
  };
}

function assertMetric(name: RendererMetricName, value: unknown): asserts value is RendererV3Metric {
  if (!isRecord(value) || value.name !== name || !Array.isArray(value.samples) || !Array.isArray(value.sortedSamples)) {
    throw new Error(`v3 基线缺少指标 ${name} 的 raw/sorted 样本`);
  }
  const expected = summarizeRendererMetricV3(name, value.samples.map((sample) => {
    if (typeof sample !== 'number') throw new Error(`v3 指标 ${name} 的样本必须是数字`);
    return sample;
  }));
  if (JSON.stringify(value.samples) !== JSON.stringify(expected.samples)
    || JSON.stringify(value.sortedSamples) !== JSON.stringify(expected.sortedSamples)
    || value.median !== expected.median
    || value.p95 !== expected.p95
    || value.summaryStatistic !== expected.summaryStatistic
    || value.minimumSamples !== expected.minimumSamples) {
    throw new Error(`v3 指标 ${name} 的统计字段与 raw 样本不一致`);
  }
}

function assertRun(value: unknown, label: string): asserts value is RendererV3Run {
  if (!isRecord(value)) throw new Error(`v3 ${label} 必须是对象`);
  assertSourceSha(value.sourceSha, `${label}.sourceSha`);
  if (!isRecord(value.metrics) || !isRecord(value.sampleCount)) throw new Error(`v3 ${label} 缺少 metrics/sampleCount`);
  for (const name of METRIC_NAMES) {
    assertMetric(name, value.metrics[name]);
    if (value.sampleCount[name] !== value.metrics[name].samples.length) {
      throw new Error(`v3 ${label}.${name} sampleCount 不一致`);
    }
  }
}

export function validateRendererBaselineV3(input: unknown): asserts input is RendererBaselineV3 {
  if (!isRecord(input) || input.schemaVersion !== RENDERER_BASELINE_V3_SCHEMA_VERSION) {
    throw new Error(`Renderer v3 基线 schemaVersion 必须为 ${RENDERER_BASELINE_V3_SCHEMA_VERSION}`);
  }
  assertSourceSha(input.baselineCommit, 'baselineCommit');
  assertSourceSha(input.currentCommit, 'currentCommit');
  if (typeof input.pairCount !== 'number' || !Number.isInteger(input.pairCount) || input.pairCount < RENDERER_V3_MIN_INTERACTION_SAMPLES) {
    throw new Error(`Renderer v3 pairCount 至少需要 ${RENDERER_V3_MIN_INTERACTION_SAMPLES}`);
  }
  if (!Array.isArray(input.warmupOrder) || !Array.isArray(input.executionOrder)) {
    throw new Error('Renderer v3 缺少 warmupOrder/executionOrder');
  }
  assertRun(input.baseline, 'baseline');
  assertRun(input.current, 'current');
  if (!isRecord(input.environment)
    || !isRecord(input.environment.baseline)
    || !isRecord(input.environment.current)
    || !Array.isArray(input.environment.differences)) {
    throw new Error('Renderer v3 environment schema 无效');
  }
  const differences = environmentDifferences(
    input.environment.baseline as unknown as RendererEnvironment,
    input.environment.current as unknown as RendererEnvironment,
  );
  if (differences.length > 0 || input.environment.differences.length > 0) {
    throw new Error('Renderer v3 环境不一致，拒绝作为硬门禁');
  }
  const recomputed = compareRendererBaselineV3({
    baselineCommit: input.baselineCommit,
    currentCommit: input.currentCommit,
    pairCount: input.pairCount,
    warmupOrder: input.warmupOrder as RendererV3RunRole[],
    executionOrder: input.executionOrder as RendererV3ExecutionStep[],
    baselineEnvironment: input.environment.baseline as unknown as RendererEnvironment,
    currentEnvironment: input.environment.current as unknown as RendererEnvironment,
    baseline: input.baseline,
    current: input.current,
    generatedAt: input.generatedAt as string,
  });
  if (JSON.stringify(input.comparison) !== JSON.stringify(recomputed.comparison)) {
    throw new Error('Renderer v3 comparison 与 raw 样本重算结果不一致');
  }
}
