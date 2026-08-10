import { validateBuildManifest, compareBuildManifests } from './renderer-build-equivalence.mjs';
import { validateRendererStartupDiagnosticSnapshot } from './renderer-startup-diagnostic-instrumentation.mjs';

export const RENDERER_BASELINE_V4_SCHEMA_VERSION = 4;
export const RENDERER_V4_PROTOCOL_ID = 'renderer-v4-qualification-2026-08-10';
export const RENDERER_V4_PAIR_COUNT = 20;
export const RENDERER_V4_WARMUP_COUNT_PER_ROLE = 1;
export const RENDERER_V4_MIN_SAMPLE_COUNT = 20;
export const RENDERER_V4_METRIC_NAMES = Object.freeze([
  'coldStartMs',
  'assetReadyMs',
  'menuOpenP95Ms',
  'sceneP95Ms',
  'hostLaunchToFirstWindowMs',
  'hostFirstWindowToDebugMs',
  'hostDebugToAssetDoneMs',
  'pageNavigationToDebugMs',
  'pageRuntimeCreateMs',
  'pageAssetLoadMs',
  'pageDebugToAssetDoneMs',
  'pageAssetDoneToStableFrameMs',
]);
export const RENDERER_V4_V3_METRIC_NAMES = Object.freeze(['coldStartMs', 'assetReadyMs', 'menuOpenP95Ms', 'sceneP95Ms']);
export const RENDERER_V4_PRIMARY_LIMITS = Object.freeze({
  medianAbsLogRatio: Math.log(1.10),
  p95AbsLogRatio: Math.log(1.25),
  orderMedianRelativeDifference: 0.10,
  roleSwapMedianLogDrift: Math.log(1.10),
});
export const RENDERER_V4_GROUPS = Object.freeze({
  'q1-007-a-b': { baselineCommit: '007438b569ec95350fdc9d7882ad49f55bbb7968', currentCommit: '007438b569ec95350fdc9d7882ad49f55bbb7968', sameRoot: false },
  'q2-007-b-a': { baselineCommit: '007438b569ec95350fdc9d7882ad49f55bbb7968', currentCommit: '007438b569ec95350fdc9d7882ad49f55bbb7968', sameRoot: false },
  'q3-f7-a-b': { baselineCommit: 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59', currentCommit: 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59', sameRoot: false },
  'q4-f7-b-a': { baselineCommit: 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59', currentCommit: 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59', sameRoot: false },
  'q5-f7-same-root': { baselineCommit: 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59', currentCommit: 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59', sameRoot: true },
});

const sourceShaPattern = /^[0-9a-f]{40}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const v3Limits = Object.freeze({ coldStartMs: 1.10, assetReadyMs: 1.10, menuOpenP95Ms: 1.15, sceneP95Ms: 1.15 });
const v3SummaryStatistic = Object.freeze({ coldStartMs: 'median', assetReadyMs: 'median', menuOpenP95Ms: 'p95', sceneP95Ms: 'p95' });

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`);
}

function assertSourceSha(value, label) {
  if (typeof value !== 'string' || !sourceShaPattern.test(value)) throw new Error(`${label} 必须是完整 40 位 SHA`);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) throw new Error(`${label} 必须是完整 64 位 SHA-256`);
}

function assertIso(value, label) {
  if (typeof value !== 'string' || !isoPattern.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} 必须是合法 ISO 时间戳`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
}

function assertFiniteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} 必须是非负有限数：${String(value)}`);
}

function assertFinitePositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} 必须是正有限数：${String(value)}`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} 必须是字符串数组`);
}

export function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

export function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) throw new Error('percentile 不接受空数组');
  const position = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

export function summarizeRendererV4Metric(name, samples) {
  if (!RENDERER_V4_METRIC_NAMES.includes(name)) throw new Error(`未知 v4 指标：${name}`);
  if (!Array.isArray(samples) || samples.length === 0) throw new Error(`v4 指标 ${name} 不能为空`);
  const raw = samples.map((value, index) => {
    assertFinitePositive(value, `v4 ${name}[${index}]`);
    return value;
  });
  const sortedSamples = [...raw].sort((left, right) => left - right);
  return {
    name,
    samples: raw,
    sortedSamples,
    sampleCount: raw.length,
    median: median(sortedSamples),
    p95: percentile(sortedSamples, 0.95),
  };
}

function ratioFor(baseline, current) {
  if (baseline === 0 && current === 0) return 1;
  if (baseline <= 0 || current <= 0) return Number.POSITIVE_INFINITY;
  return current / baseline;
}

function logRatioFor(baseline, current) {
  const ratio = ratioFor(baseline, current);
  return Number.isFinite(ratio) ? Math.log(ratio) : Number.POSITIVE_INFINITY;
}

function summarizeOrderStratum(values, label, metricName) {
  if (values.length === 0) throw new Error(`${label} 不能没有样本`);
  const summary = summarizeRendererV4Metric(metricName, values);
  return {
    sampleCount: values.length,
    median: summary.median,
    p95: summary.p95,
  };
}

export function compareRendererV4Metrics({ name, baseline, current, orderByPair }) {
  if (baseline.length !== current.length || baseline.length === 0) throw new Error(`v4 ${name} baseline/current 样本数不一致`);
  if (orderByPair.length !== baseline.length) throw new Error(`v4 ${name} order strata 数量不一致`);
  const baselineSummary = summarizeRendererV4Metric(name, baseline);
  const currentSummary = summarizeRendererV4Metric(name, current);
  const pairedRatios = baseline.map((value, index) => ratioFor(value, current[index]));
  const pairedLogRatios = baseline.map((value, index) => logRatioFor(value, current[index]));
  const absoluteLogRatios = pairedLogRatios.map((value) => Math.abs(value));
  const signedDifferences = baseline.map((value, index) => current[index] - value);
  const sortedAbsoluteLogRatios = [...absoluteLogRatios].sort((left, right) => left - right);
  const orderStrata = {};
  for (const order of ['baseline-first', 'current-first']) {
    const indexes = orderByPair.flatMap((value, index) => value === order ? [index] : []);
    const baselineValues = indexes.map((index) => baseline[index]);
    const currentValues = indexes.map((index) => current[index]);
    const baselineStratum = summarizeOrderStratum(baselineValues, `${name}.${order}.baseline`, name);
    const currentStratum = summarizeOrderStratum(currentValues, `${name}.${order}.current`, name);
    const relativeMedianDifference = baselineStratum.median === 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(currentStratum.median - baselineStratum.median) / baselineStratum.median;
    orderStrata[order === 'baseline-first' ? 'baselineFirst' : 'currentFirst'] = {
      sampleCount: indexes.length,
      baseline: baselineStratum,
      current: currentStratum,
      relativeMedianDifference,
      passed: relativeMedianDifference <= RENDERER_V4_PRIMARY_LIMITS.orderMedianRelativeDifference,
    };
  }
  const medianAbsLogRatio = median(sortedAbsoluteLogRatios);
  const p95AbsLogRatio = percentile(sortedAbsoluteLogRatios, 0.95);
  const primaryPassed = Number.isFinite(medianAbsLogRatio)
    && Number.isFinite(p95AbsLogRatio)
    && medianAbsLogRatio <= RENDERER_V4_PRIMARY_LIMITS.medianAbsLogRatio
    && p95AbsLogRatio <= RENDERER_V4_PRIMARY_LIMITS.p95AbsLogRatio;
  const orderBiasPassed = orderStrata.baselineFirst.passed && orderStrata.currentFirst.passed;
  return {
    name,
    baseline: baselineSummary,
    current: currentSummary,
    pairedRatios,
    pairedLogRatios,
    absoluteLogRatios,
    signedDifferences,
    pairedMedianRatio: median([...pairedRatios].sort((left, right) => left - right)),
    pairedMedianDifference: median([...signedDifferences].sort((left, right) => left - right)),
    medianAbsLogRatio,
    p95AbsLogRatio,
    orderStrata,
    primaryLimits: RENDERER_V4_PRIMARY_LIMITS,
    primaryPassed,
    orderBiasPassed,
    passed: primaryPassed && orderBiasPassed,
  };
}

function metricSamples(rawLaunches, role, name) {
  const selected = rawLaunches.filter((sample) => sample.role === role).sort((left, right) => left.pair - right.pair);
  if (selected.length !== RENDERER_V4_PAIR_COUNT || selected.some((sample, index) => sample.pair !== index + 1)) {
    throw new Error(`v4 ${role}.${name} 必须每个 pair 恰好出现一次`);
  }
  return selected.map((sample) => sample.metrics[name]);
}

function orderByPair(executionOrder) {
  const result = [];
  for (let pair = 1; pair <= RENDERER_V4_PAIR_COUNT; pair += 1) {
    const first = executionOrder[(pair - 1) * 2];
    result.push(first.role === 'baseline' ? 'baseline-first' : 'current-first');
  }
  return result;
}

function buildV3Run(sourceSha, rawLaunches, role) {
  const metrics = {};
  for (const name of RENDERER_V4_V3_METRIC_NAMES) {
    const summary = summarizeRendererV4Metric(name, metricSamples(rawLaunches, role, name));
    metrics[name] = {
      ...summary,
      summaryStatistic: v3SummaryStatistic[name],
      minimumSamples: RENDERER_V4_MIN_SAMPLE_COUNT,
    };
  }
  return { sourceSha, sampleCount: Object.fromEntries(RENDERER_V4_V3_METRIC_NAMES.map((name) => [name, RENDERER_V4_PAIR_COUNT])), metrics };
}

function buildV3Comparison(baseline, current) {
  const metrics = {};
  for (const name of RENDERER_V4_V3_METRIC_NAMES) {
    const summaryStatistic = v3SummaryStatistic[name];
    const baselineSummary = baseline.metrics[name][summaryStatistic];
    const currentSummary = current.metrics[name][summaryStatistic];
    const gateRatio = currentSummary / baselineSummary;
    metrics[name] = {
      metric: name,
      summaryStatistic,
      baselineSummary,
      currentSummary,
      gateRatio,
      limit: v3Limits[name],
      passed: gateRatio <= v3Limits[name],
    };
  }
  return { metrics, failures: Object.values(metrics).filter((metric) => !metric.passed) };
}

function healthFromSamples(warmups, rawLaunches) {
  const all = [...warmups, ...rawLaunches];
  return {
    warmups: warmups.length,
    formalSamples: rawLaunches.length,
    assetsFailed: all.reduce((sum, sample) => sum + sample.assetLoading.failed, 0),
    pageErrors: all.reduce((sum, sample) => sum + sample.errors.page.length, 0),
    consoleErrors: all.reduce((sum, sample) => sum + sample.errors.console.length, 0),
    failedRequests: all.reduce((sum, sample) => sum + sample.errors.failedRequests.length, 0),
  };
}

function validateErrors(errors, label) {
  assertRecord(errors, `${label}.errors`);
  for (const key of ['page', 'console', 'failedRequests']) assertStringArray(errors[key], `${label}.errors.${key}`);
}

function validateAssetLoading(assetLoading, label) {
  assertRecord(assetLoading, `${label}.assetLoading`);
  if (!Number.isInteger(assetLoading.total) || assetLoading.total <= 0) throw new Error(`${label}.assetLoading.total 必须大于 0`);
  if (!Number.isInteger(assetLoading.completed) || assetLoading.completed !== assetLoading.total) throw new Error(`${label}.assetLoading.completed 必须等于 total`);
  if (!Number.isInteger(assetLoading.failed) || assetLoading.failed !== 0) throw new Error(`${label}.assetLoading.failed 必须为 0`);
  if (assetLoading.done !== true) throw new Error(`${label}.assetLoading.done 必须为 true`);
  if (assetLoading.current !== undefined && assetLoading.current !== null && typeof assetLoading.current !== 'string') throw new Error(`${label}.assetLoading.current 类型无效`);
}

function validatePhaseProjection(sample, label) {
  assertRecord(sample.hostDurations, `${label}.hostDurations`);
  assertRecord(sample.page, `${label}.page`);
  validateRendererStartupDiagnosticSnapshot(sample.page);
  assertRecord(sample.observer, `${label}.observer`);
  assertFiniteNonNegative(sample.observer.lagMs, `${label}.observer.lagMs`);
  for (const name of ['hostLaunchToFirstWindowMs', 'hostFirstWindowToDebugMs', 'hostDebugToAssetDoneMs']) {
    assertFinitePositive(sample.hostDurations[name], `${label}.hostDurations.${name}`);
  }
}

function validateRawLaunch(sample, label, expectedPair) {
  assertRecord(sample, label);
  if (!Number.isInteger(sample.pair) || sample.pair !== expectedPair || sample.pair < 0 || sample.pair > RENDERER_V4_PAIR_COUNT) throw new Error(`${label}.pair 无效`);
  if (sample.role !== 'baseline' && sample.role !== 'current') throw new Error(`${label}.role 无效`);
  if (!Number.isInteger(sample.sequenceIndex) || sample.sequenceIndex < 0) throw new Error(`${label}.sequenceIndex 无效`);
  assertRecord(sample.metrics, `${label}.metrics`);
  for (const name of RENDERER_V4_METRIC_NAMES) assertFinitePositive(sample.metrics[name], `${label}.metrics.${name}`);
  validateAssetLoading(sample.assetLoading, label);
  validateErrors(sample.errors, label);
  validatePhaseProjection(sample, label);
}

function environmentDifferences(baseline, current) {
  const differences = [];
  for (const key of Object.keys(baseline)) if (baseline[key] !== current[key]) differences.push(`${key}: ${baseline[key]} !== ${current[key]}`);
  return differences;
}

function validateEnvironment(environment) {
  assertRecord(environment, 'environment');
  for (const key of ['node', 'npm', 'os', 'platform', 'arch', 'cpu', 'electron', 'playwright', 'buildMode']) assertNonEmptyString(environment[key], `environment.${key}`);
  assertSha256(environment.packageLockSha256, 'environment.packageLockSha256');
}

function validateInstrumentation(value, label) {
  assertRecord(value, label);
  assertNonEmptyString(value.instrumentationScriptPath, `${label}.instrumentationScriptPath`);
  assertSha256(value.instrumentationScriptSha256, `${label}.instrumentationScriptSha256`);
  assertSha256(value.instrumentationDiffSha256, `${label}.instrumentationDiffSha256`);
  assertSha256(value.fullDiffSha256, `${label}.fullDiffSha256`);
  if (value.instrumentationDiffSha256 !== value.fullDiffSha256) throw new Error(`${label} instrumentation/full diff SHA 必须一致`);
  if (value.onlyUnifiedInstrumentationDiff !== true) throw new Error(`${label} 必须声明 onlyUnifiedInstrumentationDiff=true`);
}

function validateRolesAndGroup(value) {
  const spec = RENDERER_V4_GROUPS[value.group];
  if (!spec) throw new Error(`未知 v4 group：${value.group}`);
  assertSourceSha(value.baselineCommit, 'baselineCommit');
  assertSourceSha(value.currentCommit, 'currentCommit');
  if (value.baselineCommit !== spec.baselineCommit || value.currentCommit !== spec.currentCommit) throw new Error('group commit 与冻结矩阵不一致');
  assertRecord(value.roles, 'roles');
  for (const role of ['baseline', 'current']) {
    assertRecord(value.roles[role], `roles.${role}`);
    assertNonEmptyString(value.roles[role].root, `roles.${role}.root`);
    assertSourceSha(value.roles[role].commit, `roles.${role}.commit`);
    if (value.roles[role].commit !== value[`${role}Commit`]) throw new Error(`roles.${role}.commit 与顶层 commit 不一致`);
    if (value.roles[role].role !== role) throw new Error(`roles.${role}.role 不一致`);
  }
  if (spec.sameRoot !== (value.roles.baseline.root === value.roles.current.root)) throw new Error('Q5 必须同一构建根，Q1-Q4 必须不同构建根');
}

function validateExecutionOrder(value) {
  if (!Array.isArray(value.executionOrder) || value.executionOrder.length !== RENDERER_V4_PAIR_COUNT * 2) throw new Error('executionOrder 必须恰好 40 步');
  let lastSequence = 0;
  for (let pair = 1; pair <= RENDERER_V4_PAIR_COUNT; pair += 1) {
    const first = value.executionOrder[(pair - 1) * 2];
    const second = value.executionOrder[(pair - 1) * 2 + 1];
    if (!isRecord(first) || !isRecord(second) || first.pair !== pair || second.pair !== pair) throw new Error(`executionOrder pair ${pair} 无效`);
    const firstRole = pair % 2 === 1 ? 'baseline' : 'current';
    const secondRole = firstRole === 'baseline' ? 'current' : 'baseline';
    if (first.role !== firstRole || second.role !== secondRole) throw new Error(`executionOrder pair ${pair} 不是 counterbalanced 顺序`);
    if (first.sequenceIndex !== ++lastSequence || second.sequenceIndex !== ++lastSequence) throw new Error(`executionOrder pair ${pair} sequenceIndex 不连续`);
  }
}

function validateWarmupOrder(value) {
  if (JSON.stringify(value.warmupOrder) !== JSON.stringify(['baseline', 'current'])) throw new Error('warmupOrder 必须为 baseline,current');
  if (!Array.isArray(value.warmups) || value.warmups.length !== 2) throw new Error('warmups 必须包含两个角色');
  value.warmups.forEach((sample, index) => {
    validateRawLaunch(sample, `warmups[${index}]`, 0);
    if (sample.role !== value.warmupOrder[index] || sample.sequenceIndex !== 0) throw new Error(`warmups[${index}] 顺序无效`);
  });
}

function reportHashValid(value) {
  return value === 'not-generated' || (typeof value === 'string' && sha256Pattern.test(value));
}

export function buildRendererV4Artifact(input) {
  assertRecord(input, 'v4 build input');
  const v3Baseline = buildV3Run(input.baselineCommit, input.rawLaunches, 'baseline');
  const v3Current = buildV3Run(input.currentCommit, input.rawLaunches, 'current');
  const v3Comparison = buildV3Comparison(v3Baseline, v3Current);
  const strata = orderByPair(input.executionOrder);
  const paired = {};
  for (const name of RENDERER_V4_METRIC_NAMES) paired[name] = compareRendererV4Metrics({
    name,
    baseline: metricSamples(input.rawLaunches, 'baseline', name),
    current: metricSamples(input.rawLaunches, 'current', name),
    orderByPair: strata,
  });
  const primaryMetricGate = Object.values(paired).every((metric) => metric.primaryPassed);
  const orderBiasGate = Object.values(paired).every((metric) => metric.orderBiasPassed);
  const health = healthFromSamples(input.warmups, input.rawLaunches);
  const healthGate = Object.values(health).every((value, index) => index < 2 || value === 0);
  const buildEquivalenceGate = input.buildManifest.sameCommitEquivalent === true;
  const groupGates = {
    primaryMetricGate,
    orderBiasGate,
    healthGate,
    buildEquivalenceGate,
    pairedMedianRatioIsDiagnosticOnly: true,
    passed: primaryMetricGate && orderBiasGate && healthGate && buildEquivalenceGate,
    failures: [
      ...Object.values(paired).filter((metric) => !metric.passed).map((metric) => `${metric.name}: primary/order gate failed`),
      ...(healthGate ? [] : ['health gate failed']),
      ...(buildEquivalenceGate ? [] : ['build equivalence gate failed']),
    ],
  };
  return {
    schemaVersion: RENDERER_BASELINE_V4_SCHEMA_VERSION,
    artifactKind: 'renderer-performance-qualification',
    protocolId: RENDERER_V4_PROTOCOL_ID,
    sampledAt: input.sampledAt,
    rebuiltAt: input.rebuiltAt,
    group: input.group,
    baselineCommit: input.baselineCommit,
    currentCommit: input.currentCommit,
    roles: input.roles,
    pairCount: RENDERER_V4_PAIR_COUNT,
    warmupCountPerRole: RENDERER_V4_WARMUP_COUNT_PER_ROLE,
    warmupOrder: input.warmupOrder,
    executionOrder: input.executionOrder,
    environment: input.environment,
    buildManifest: input.buildManifest,
    instrumentation: input.instrumentation ?? null,
    baseline: v3Baseline,
    current: v3Current,
    v3Compatible: { baseline: v3Baseline, current: v3Current, comparison: v3Comparison },
    warmups: input.warmups,
    rawLaunches: input.rawLaunches,
    health,
    v4: {
      phaseMetrics: Object.fromEntries(Object.entries(paired).map(([name, metric]) => [name, { baseline: metric.baseline, current: metric.current }])),
      paired,
      orderStrata: Object.fromEntries(Object.entries(paired).map(([name, metric]) => [name, metric.orderStrata])),
      groupGates,
    },
    failures: groupGates.failures,
    qualification: {
      valid: true,
      status: groupGates.passed ? 'candidate-qualified' : 'not-qualified',
      reasons: groupGates.failures,
    },
    reportSha256: input.reportSha256 ?? 'not-generated',
  };
}

export function validateRendererV4Artifact(value) {
  assertRecord(value, 'Renderer v4 artifact');
  if (value.schemaVersion !== RENDERER_BASELINE_V4_SCHEMA_VERSION) throw new Error(`Renderer v4 schemaVersion 必须为 ${RENDERER_BASELINE_V4_SCHEMA_VERSION}`);
  if (value.artifactKind !== 'renderer-performance-qualification') throw new Error('Renderer v4 artifactKind 无效');
  if (value.protocolId !== RENDERER_V4_PROTOCOL_ID) throw new Error('Renderer v4 protocolId 不匹配');
  assertIso(value.sampledAt, 'sampledAt');
  assertIso(value.rebuiltAt, 'rebuiltAt');
  validateRolesAndGroup(value);
  if (value.pairCount !== RENDERER_V4_PAIR_COUNT || value.warmupCountPerRole !== RENDERER_V4_WARMUP_COUNT_PER_ROLE) throw new Error('pair/warmup 固定数量不匹配');
  validateEnvironment(value.environment?.baseline);
  validateEnvironment(value.environment?.current);
  const environmentDiffs = environmentDifferences(value.environment.baseline, value.environment.current);
  if (environmentDiffs.length !== 0 || JSON.stringify(value.environment.differences) !== JSON.stringify(environmentDiffs)) throw new Error('environment 不一致');
  if (value.environment.baseline.packageLockSha256 !== value.environment.current.packageLockSha256) throw new Error('baseline/current lockfile SHA 不一致');
  validateBuildManifest(value.buildManifest?.baseline);
  validateBuildManifest(value.buildManifest?.current);
  const buildComparison = compareBuildManifests(value.buildManifest.baseline, value.buildManifest.current);
  if (value.buildManifest.sameCommitEquivalent !== buildComparison.equivalent) throw new Error('buildManifest.sameCommitEquivalent 与重算结果不一致');
  if (!Array.isArray(value.executionOrder)) throw new Error('executionOrder 必须是数组');
  validateExecutionOrder(value);
  validateWarmupOrder(value);
  if (!Array.isArray(value.rawLaunches) || value.rawLaunches.length !== RENDERER_V4_PAIR_COUNT * 2) throw new Error('rawLaunches 必须恰好 40 个');
  value.rawLaunches.forEach((sample, index) => {
    const expected = value.executionOrder[index];
    validateRawLaunch(sample, `rawLaunches[${index}]`, expected.pair);
    if (sample.role !== expected.role || sample.sequenceIndex !== expected.sequenceIndex) throw new Error(`rawLaunches[${index}] 与 executionOrder 不一致`);
  });
  if (!reportHashValid(value.reportSha256)) throw new Error('reportSha256 必须是 64 位 SHA 或 not-generated');
  if (!isRecord(value.instrumentation) && value.instrumentation !== null) throw new Error('instrumentation 必须是对象或 null');
  if (value.instrumentation) {
    validateInstrumentation(value.instrumentation.baseline, 'instrumentation.baseline');
    validateInstrumentation(value.instrumentation.current, 'instrumentation.current');
  }
  const expected = buildRendererV4Artifact(value);
  for (const key of ['baseline', 'current', 'v3Compatible', 'health', 'v4', 'failures', 'qualification']) {
    if (JSON.stringify(value[key]) !== JSON.stringify(expected[key])) throw new Error(`Renderer v4 ${key} 与 raw 样本重算结果不一致`);
  }
  return value;
}
