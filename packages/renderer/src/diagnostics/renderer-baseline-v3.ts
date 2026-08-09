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

export interface RendererV3SceneDiagnostics {
  readonly titleSelectMs: number;
  readonly positionReadyMs: number;
  readonly nextFrameMs: number;
  readonly positionWaitAfterCommandMs: number;
}

export interface RendererV3RawLaunch {
  readonly pair: number;
  readonly role: RendererV3RunRole;
  readonly coldStartMs: number;
  readonly assetReadyMs: number;
  readonly menuOpenP95Ms: number;
  readonly sceneP95Ms: number;
  readonly assetLoading: {
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly current?: string | null;
    readonly done?: boolean;
  };
  readonly errors: {
    readonly page: readonly string[];
    readonly console: readonly string[];
    readonly failedRequests: readonly string[];
  };
  readonly sceneDiagnostics?: RendererV3SceneDiagnostics;
}

export interface RendererV3Health {
  readonly warmups: number;
  readonly formalSamples: number;
  readonly assetsFailed: number;
  readonly pageErrors: number;
  readonly consoleErrors: number;
  readonly failedRequests: number;
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
  readonly baseline: RendererV3Environment;
  readonly current: RendererV3Environment;
  readonly differences: readonly string[];
}

export interface RendererV3Environment extends RendererEnvironment {
  readonly packageLockSha256: string;
}

export interface RendererV3MetricComparison {
  readonly metric: RendererMetricName;
  readonly summaryStatistic: RendererMetricStatistic;
  readonly baselineSummary: number;
  readonly currentSummary: number;
  /** Formal gate ratio: current summary / baseline summary. */
  readonly gateRatio: number;
  /** Diagnostic ratios; never used as the formal gate. */
  readonly pairedRatios: readonly number[];
  readonly pairedMedianRatio: number;
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
  readonly warmups: readonly RendererV3RawLaunch[];
  readonly rawLaunches: readonly RendererV3RawLaunch[];
  readonly health: RendererV3Health;
  readonly comparison: {
    readonly metrics: Readonly<Record<RendererMetricName, RendererV3MetricComparison>>;
    readonly failures: readonly RendererV3MetricComparison[];
  };
  readonly historicalComparison: RendererV3HistoricalComparison;
}

export type RendererV3ComparisonResult = Omit<RendererBaselineV3, 'warmups' | 'rawLaunches' | 'health' | 'historicalComparison'>;

export interface RendererV3HistoricalComparison {
  readonly baselinePath: string;
  readonly baselineSha256: string;
  readonly baselineSourceSha: string;
  readonly failures: readonly RendererV3HistoricalFailure[];
}

export interface RendererV3HistoricalFailure {
  readonly metric: RendererMetricName;
  readonly baseline: number;
  readonly current: number;
  readonly ratio: number;
  readonly limit: number;
}

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
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

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} 必须是完整 64 位 SHA-256`);
  }
}

function assertRole(value: unknown, label: string): asserts value is RendererV3RunRole {
  if (value !== 'baseline' && value !== 'current') {
    throw new Error(`${label} 只能是 baseline 或 current`);
  }
}

function assertNonNegativeFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须是非负有限数：${String(value)}`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} 必须是非负整数：${String(value)}`);
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
  baseline: RendererV3Environment,
  current: RendererV3Environment,
): string[] {
  const differences: string[] = [];
  for (const key of Object.keys(baseline) as (keyof RendererV3Environment)[]) {
    if (baseline[key] !== current[key]) differences.push(`${key}: ${baseline[key]} !== ${current[key]}`);
  }
  return differences;
}

function assertEnvironment(value: unknown, label: string): asserts value is RendererV3Environment {
  if (!isRecord(value)) throw new Error(`v3 ${label} environment 必须是对象`);
  for (const key of ['node', 'npm', 'os', 'platform', 'arch', 'cpu', 'electron', 'playwright', 'buildMode'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`v3 ${label}.${key} 必须是非空字符串`);
    }
  }
  assertSha256(value.packageLockSha256, `${label}.packageLockSha256`);
}

function assertWarmupOrder(value: unknown): asserts value is readonly RendererV3RunRole[] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('v3 warmupOrder 必须恰好包含 2 个角色');
  }
  value.forEach((role, index) => assertRole(role, `warmupOrder[${index}]`));
  if (value[0] === value[1]) throw new Error('v3 warmupOrder 必须包含 baseline/current 各一次');
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
    if (!isRecord(first) || !isRecord(second)) {
      throw new Error(`v3 executionOrder 在 pair ${index + 1} 缺少合法步骤`);
    }
    if (!Number.isInteger(first.pair) || !Number.isInteger(second.pair)) {
      throw new Error(`v3 executionOrder 在 pair ${index + 1} 的 pair 必须是整数`);
    }
    assertRole(first.role, `executionOrder[${index * 2}].role`);
    assertRole(second.role, `executionOrder[${index * 2 + 1}].role`);
    if (first?.pair !== index + 1 || first.role !== firstRole
      || second?.pair !== index + 1 || second.role !== secondRole) {
      throw new Error(`v3 executionOrder 在 pair ${index + 1} 不是预期的 counterbalanced 顺序`);
    }
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} 必须是非空字符串`);
  }
}

function assertSceneDiagnostics(value: unknown, label: string): asserts value is RendererV3SceneDiagnostics {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`);
  for (const key of [
    'titleSelectMs',
    'positionReadyMs',
    'nextFrameMs',
    'positionWaitAfterCommandMs',
  ] as const) {
    assertNonNegativeFinite(value[key], `${label}.${key}`);
  }
}

function assertRawLaunch(value: unknown, label: string, pairCount: number, expectedPair?: number): asserts value is RendererV3RawLaunch {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`);
  assertNonNegativeInteger(value.pair, `${label}.pair`);
  if (expectedPair !== undefined && value.pair !== expectedPair) {
    throw new Error(`${label}.pair 与 executionOrder 不一致`);
  }
  if (value.pair > pairCount) throw new Error(`${label}.pair 超出 pairCount`);
  assertRole(value.role, `${label}.role`);
  for (const name of METRIC_NAMES) assertNonNegativeFinite(value[name], `${label}.${name}`);
  if (!isRecord(value.assetLoading)) throw new Error(`${label}.assetLoading 必须是对象`);
  assertNonNegativeInteger(value.assetLoading.total, `${label}.assetLoading.total`);
  assertNonNegativeInteger(value.assetLoading.completed, `${label}.assetLoading.completed`);
  assertNonNegativeInteger(value.assetLoading.failed, `${label}.assetLoading.failed`);
  if (value.assetLoading.current !== undefined
    && value.assetLoading.current !== null
    && typeof value.assetLoading.current !== 'string') {
    throw new Error(`${label}.assetLoading.current 必须是字符串或 null`);
  }
  if (value.assetLoading.done !== undefined && typeof value.assetLoading.done !== 'boolean') {
    throw new Error(`${label}.assetLoading.done 必须是布尔值`);
  }
  if (value.assetLoading.failed !== 0) {
    throw new Error(`${label}.assetLoading.failed 必须为 0 才能作为绿色候选`);
  }
  if (!isRecord(value.errors)) throw new Error(`${label}.errors 必须是对象`);
  assertStringArray(value.errors.page, `${label}.errors.page`);
  assertStringArray(value.errors.console, `${label}.errors.console`);
  assertStringArray(value.errors.failedRequests, `${label}.errors.failedRequests`);
  if (value.sceneDiagnostics !== undefined) assertSceneDiagnostics(value.sceneDiagnostics, `${label}.sceneDiagnostics`);
}

function rawSamplesFromLaunches(launches: readonly RendererV3RawLaunch[], role: RendererV3RunRole, pairCount: number): RendererV3RawSamples {
  const selected = launches.filter((sample) => sample.role === role).sort((a, b) => a.pair - b.pair);
  if (selected.length !== pairCount || selected.some((sample, index) => sample.pair !== index + 1)) {
    throw new Error(`v3 ${role} rawLaunches 必须每个 pair 恰好出现一次并按 pair 连续`);
  }
  return {
    coldStartMs: selected.map((sample) => sample.coldStartMs),
    assetReadyMs: selected.map((sample) => sample.assetReadyMs),
    menuOpenP95Ms: selected.map((sample) => sample.menuOpenP95Ms),
    sceneP95Ms: selected.map((sample) => sample.sceneP95Ms),
  };
}

function assertRunMatches(actual: unknown, expected: RendererV3Run, label: string): asserts actual is RendererV3Run {
  assertRun(actual, label);
  if (actual.sourceSha !== expected.sourceSha
    || JSON.stringify(actual.sampleCount) !== JSON.stringify(expected.sampleCount)) {
    throw new Error(`v3 ${label} 与 rawLaunches 重算的 source/sampleCount 不一致`);
  }
  for (const name of METRIC_NAMES) {
    if (JSON.stringify(actual.metrics[name]) !== JSON.stringify(expected.metrics[name])) {
      throw new Error(`v3 ${label}.${name} 与 rawLaunches 重算结果不一致`);
    }
  }
}

function assertHealthMatches(actual: unknown, expected: RendererV3Health): asserts actual is RendererV3Health {
  if (!isRecord(actual)) throw new Error('v3 health 必须是对象');
  for (const key of ['warmups', 'formalSamples', 'assetsFailed', 'pageErrors', 'consoleErrors', 'failedRequests'] as const) {
    assertNonNegativeInteger(actual[key], `health.${key}`);
    if (actual[key] !== expected[key]) throw new Error(`health.${key} 与 warmups/rawLaunches 重算结果不一致`);
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
  if (baseline.summaryStatistic !== current.summaryStatistic) {
    throw new Error(`v3 指标 ${name} 的 baseline/current summaryStatistic 不一致`);
  }
  const pairedRatios = baseline.samples.map((value, index) => ratioFor(value, current.samples[index]!));
  const pairedMedianRatio = median([...pairedRatios].sort((a, b) => a - b));
  const baselineSummary = baseline[baseline.summaryStatistic];
  const currentSummary = current[current.summaryStatistic];
  const gateRatio = ratioFor(
    baselineSummary,
    currentSummary,
  );
  const limit = RENDERER_BASELINE_LIMITS[name];
  return {
    metric: name,
    summaryStatistic: baseline.summaryStatistic,
    baselineSummary,
    currentSummary,
    gateRatio,
    pairedRatios,
    pairedMedianRatio,
    limit,
    passed: gateRatio <= limit,
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
  readonly baselineEnvironment: RendererV3Environment;
  readonly currentEnvironment: RendererV3Environment;
  readonly baseline: RendererV3Run;
  readonly current: RendererV3Run;
  readonly generatedAt?: string;
}): RendererV3ComparisonResult {
  assertSourceSha(input.baselineCommit, 'baselineCommit');
  assertSourceSha(input.currentCommit, 'currentCommit');
  if (input.baseline.sourceSha !== input.baselineCommit) {
    throw new Error('baseline.sourceSha 必须等于 baselineCommit');
  }
  if (input.current.sourceSha !== input.currentCommit) {
    throw new Error('current.sourceSha 必须等于 currentCommit');
  }
  if (!Number.isInteger(input.pairCount) || input.pairCount < RENDERER_V3_MIN_INTERACTION_SAMPLES) {
    throw new Error(`v3 pairCount 至少需要 ${RENDERER_V3_MIN_INTERACTION_SAMPLES} 对样本`);
  }
  assertWarmupOrder(input.warmupOrder);
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

function assertHistoricalComparison(value: unknown): asserts value is RendererV3HistoricalComparison {
  if (!isRecord(value) || typeof value.baselinePath !== 'string' || value.baselinePath.length === 0) {
    throw new Error('v3 historicalComparison.baselinePath 必须是非空相对路径');
  }
  assertSha256(value.baselineSha256, 'historicalComparison.baselineSha256');
  assertSourceSha(value.baselineSourceSha, 'historicalComparison.baselineSourceSha');
  if (!Array.isArray(value.failures)) throw new Error('v3 historicalComparison.failures 必须是数组');
  value.failures.forEach((failure, index) => {
    if (!isRecord(failure) || !METRIC_NAMES.includes(failure.metric as RendererMetricName)) {
      throw new Error(`historicalComparison.failures[${index}] metric 无效`);
    }
    assertNonNegativeFinite(failure.baseline, `historicalComparison.failures[${index}].baseline`);
    assertNonNegativeFinite(failure.current, `historicalComparison.failures[${index}].current`);
    assertNonNegativeFinite(failure.ratio, `historicalComparison.failures[${index}].ratio`);
    if (failure.limit !== RENDERER_BASELINE_LIMITS[failure.metric as RendererMetricName]) {
      throw new Error(`historicalComparison.failures[${index}].limit 不匹配`);
    }
  });
}

function healthFromSamples(
  warmups: readonly RendererV3RawLaunch[],
  rawLaunches: readonly RendererV3RawLaunch[],
): RendererV3Health {
  const samples = [...warmups, ...rawLaunches];
  return {
    warmups: warmups.length,
    formalSamples: rawLaunches.length,
    assetsFailed: samples.reduce((sum, sample) => sum + sample.assetLoading.failed, 0),
    pageErrors: samples.reduce((sum, sample) => sum + sample.errors.page.length, 0),
    consoleErrors: samples.reduce((sum, sample) => sum + sample.errors.console.length, 0),
    failedRequests: samples.reduce((sum, sample) => sum + sample.errors.failedRequests.length, 0),
  };
}

export function validateRendererBaselineV3(input: unknown): asserts input is RendererBaselineV3 {
  if (!isRecord(input) || input.schemaVersion !== RENDERER_BASELINE_V3_SCHEMA_VERSION) {
    throw new Error(`Renderer v3 基线 schemaVersion 必须为 ${RENDERER_BASELINE_V3_SCHEMA_VERSION}`);
  }
  assertSourceSha(input.baselineCommit, 'baselineCommit');
  assertSourceSha(input.currentCommit, 'currentCommit');
  assertNonEmptyString(input.generatedAt, 'generatedAt');
  if (typeof input.pairCount !== 'number' || !Number.isInteger(input.pairCount) || input.pairCount < RENDERER_V3_MIN_INTERACTION_SAMPLES) {
    throw new Error(`Renderer v3 pairCount 至少需要 ${RENDERER_V3_MIN_INTERACTION_SAMPLES}`);
  }
  const pairCount = input.pairCount;
  if (!Array.isArray(input.warmupOrder) || !Array.isArray(input.executionOrder)) {
    throw new Error('Renderer v3 缺少 warmupOrder/executionOrder');
  }
  const warmupOrder = input.warmupOrder as RendererV3RunRole[];
  const executionOrder = input.executionOrder as RendererV3ExecutionStep[];
  assertWarmupOrder(warmupOrder);
  validateExecutionOrder(executionOrder, pairCount);
  if (!Array.isArray(input.rawLaunches) || input.rawLaunches.length !== executionOrder.length) {
    throw new Error('v3 rawLaunches 数量必须等于 executionOrder 数量');
  }
  if (!Array.isArray(input.warmups) || input.warmups.length !== input.warmupOrder.length) {
    throw new Error('v3 warmups 数量必须等于 warmupOrder 数量');
  }
  input.rawLaunches.forEach((sample, index) => {
    const expected = executionOrder[index];
    assertRawLaunch(sample, `rawLaunches[${index}]`, pairCount, expected?.pair);
    if (!isRecord(expected) || sample.role !== expected.role || sample.pair !== expected.pair) {
      throw new Error(`rawLaunches[${index}] 与 executionOrder[${index}] 不一致`);
    }
  });
  input.warmups.forEach((sample, index) => {
    assertRawLaunch(sample, `warmups[${index}]`, pairCount, 0);
    if (sample.role !== warmupOrder[index]) {
      throw new Error(`warmups[${index}] 与 warmupOrder 不一致`);
    }
  });
  if (!isRecord(input.environment)
    || !Array.isArray(input.environment.differences)) {
    throw new Error('Renderer v3 environment schema 无效');
  }
  assertEnvironment(input.environment.baseline, 'environment.baseline');
  assertEnvironment(input.environment.current, 'environment.current');
  const differences = environmentDifferences(
    input.environment.baseline,
    input.environment.current,
  );
  if (differences.length > 0 || JSON.stringify(input.environment.differences) !== JSON.stringify(differences)) {
    throw new Error('Renderer v3 环境不一致，拒绝作为硬门禁');
  }
  if (input.environment.baseline.packageLockSha256 !== input.environment.current.packageLockSha256) {
    throw new Error('Renderer v3 baseline/current lockfile SHA-256 不一致');
  }
  const baselineRaw = rawSamplesFromLaunches(input.rawLaunches, 'baseline', pairCount);
  const currentRaw = rawSamplesFromLaunches(input.rawLaunches, 'current', pairCount);
  const expectedBaseline = buildRendererV3Run(input.baselineCommit, baselineRaw);
  const expectedCurrent = buildRendererV3Run(input.currentCommit, currentRaw);
  assertRunMatches(input.baseline, expectedBaseline, 'baseline');
  assertRunMatches(input.current, expectedCurrent, 'current');
  assertHealthMatches(input.health, healthFromSamples(input.warmups, input.rawLaunches));
  assertHistoricalComparison(input.historicalComparison);
  const recomputed = compareRendererBaselineV3({
    baselineCommit: input.baselineCommit,
    currentCommit: input.currentCommit,
    pairCount,
    warmupOrder: input.warmupOrder as RendererV3RunRole[],
    executionOrder: input.executionOrder as RendererV3ExecutionStep[],
    baselineEnvironment: input.environment.baseline,
    currentEnvironment: input.environment.current,
    baseline: input.baseline,
    current: input.current,
    generatedAt: input.generatedAt as string,
  });
  if (JSON.stringify(input.comparison) !== JSON.stringify(recomputed.comparison)) {
    throw new Error('Renderer v3 comparison 与 raw 样本重算结果不一致');
  }
}
