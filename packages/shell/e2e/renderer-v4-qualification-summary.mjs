import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RENDERER_V4_GROUPS,
  RENDERER_V4_METRIC_NAMES,
  RENDERER_V4_PRIMARY_LIMITS,
  RENDERER_V4_PROTOCOL_ID,
  median,
} from './renderer-baseline-v4.mjs';
import { validateRendererBaselineV4Artifact } from './renderer-baseline-v4-artifact.mjs';

export const RENDERER_V4_QUALIFICATION_SUMMARY_SCHEMA_VERSION = 1;
export const RENDERER_V4_QUALIFICATION_SUMMARY_ARTIFACT_KIND = 'renderer-v4-qualification-summary';
export const RENDERER_V4_QUALIFICATION_SUMMARY_PROTOCOL_ID = 'renderer-v4-aggregate-qualification-2026-08-10';
export const RENDERER_V4_QUALIFICATION_SUMMARY_PATH = 'docs/baselines/renderer-v4-qualification-summary-2026-08-10.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AUTHORITY_DIRECTORY = path.join(ROOT, 'docs', 'baselines');
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const INPUT_KEYS = Object.freeze(['q1', 'q2', 'q3', 'q4', 'q5']);
const EXPECTED_GROUPS = Object.freeze({
  q1: 'q1-007-a-b',
  q2: 'q2-007-b-a',
  q3: 'q3-f7-a-b',
  q4: 'q4-f7-b-a',
  q5: 'q5-f7-same-root',
});
const ROLE_SWAP_PAIRS = Object.freeze({
  q1q2: { forward: 'q1', reverse: 'q2' },
  q3q4: { forward: 'q3', reverse: 'q4' },
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`);
}

function assertIso(value, label) {
  if (typeof value !== 'string' || !ISO_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} 必须是合法 ISO 时间戳`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`${label} 必须是 64 位 SHA-256`);
}

function assertSourceSha(value, label) {
  if (typeof value !== 'string' || !SOURCE_SHA_PATTERN.test(value)) throw new Error(`${label} 必须是完整 40 位 SHA`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
}

function assertFiniteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} 必须是非负有限数`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} 必须是字符串数组`);
}

function normalizedPath(value, label) {
  assertNonEmptyString(value, label);
  return path.resolve(value);
}

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertInputKeys(value, label) {
  assertRecord(value, label);
  const actual = Object.keys(value).sort().join(',');
  const expected = [...INPUT_KEYS].sort().join(',');
  if (actual !== expected) throw new Error(`${label} 必须恰好包含 q1、q2、q3、q4、q5`);
}

function readJsonArtifact(filePath) {
  const absolutePath = normalizedPath(filePath, 'artifact path');
  const artifact = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  validateRendererBaselineV4Artifact(artifact);
  return { path: absolutePath, sha256: sha256File(absolutePath), artifact };
}

export function sha256File(filePath) {
  const absolutePath = normalizedPath(filePath, 'file path');
  return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

export function parseRendererV4QualificationSummaryArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('argv 必须是数组');
  const paths = {};
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      if (outputPath !== undefined) throw new Error('--output 只能出现一次');
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output 缺少值');
      outputPath = normalizedPath(value, '--output');
      index += 1;
      continue;
    }
    if (!INPUT_KEYS.some((key) => `--${key}` === argument)) throw new Error(`未知参数：${argument}`);
    const key = argument.slice(2);
    if (paths[key] !== undefined) throw new Error(`--${key} 只能出现一次`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} 缺少值`);
    paths[key] = normalizedPath(value, `--${key}`);
    index += 1;
  }
  for (const key of INPUT_KEYS) if (paths[key] === undefined) throw new Error(`必须显式提供 --${key} <path>`);
  if (outputPath === undefined) throw new Error('必须显式提供 --output <path>');
  return {
    q1Path: paths.q1,
    q2Path: paths.q2,
    q3Path: paths.q3,
    q4Path: paths.q4,
    q5Path: paths.q5,
    outputPath,
  };
}

export function roleSwapDrift(forwardArtifact, reverseArtifact, metricName) {
  if (!RENDERER_V4_METRIC_NAMES.includes(metricName)) throw new Error(`未知 v4 指标：${metricName}`);
  const forwardValues = forwardArtifact?.v4?.paired?.[metricName]?.pairedLogRatios;
  const reverseValues = reverseArtifact?.v4?.paired?.[metricName]?.pairedLogRatios;
  if (!Array.isArray(forwardValues) || !Array.isArray(reverseValues) || forwardValues.length !== 20 || reverseValues.length !== 20) {
    throw new Error(`${metricName} 角色互换输入必须各有 20 个 pairedLogRatios`);
  }
  for (const [label, values] of [['forward', forwardValues], ['reverse', reverseValues]]) {
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${label}.${metricName} pairedLogRatios 必须为有限数`);
  }
  const forwardMedian = median([...forwardValues].sort((left, right) => left - right));
  const reverseMedian = median([...reverseValues].sort((left, right) => left - right));
  return Math.abs(forwardMedian + reverseMedian);
}

function validateExpectedGroup(key, record) {
  if (record.artifact.group !== EXPECTED_GROUPS[key]) throw new Error(`${key} group 与聚合矩阵不一致`);
  if (RENDERER_V4_GROUPS[record.artifact.group] === undefined) throw new Error(`${key} 使用未知 v4 group`);
}

function validateRoleSwapRoots(forwardKey, reverseKey, records) {
  const forward = records[forwardKey].artifact;
  const reverse = records[reverseKey].artifact;
  const labels = [
    forward.roles.baseline.label,
    forward.roles.current.label,
    reverse.roles.baseline.label,
    reverse.roles.current.label,
  ];
  if (JSON.stringify(labels) !== JSON.stringify(['A', 'B', 'B', 'A'])) {
    throw new Error(`${forwardKey}/${reverseKey} 必须交换 A/B 角色标签`);
  }
}

function validateAggregateInputs(records) {
  assertInputKeys(records, 'aggregate inputs');
  for (const key of INPUT_KEYS) {
    const record = records[key];
    assertRecord(record, `inputs.${key}`);
    normalizedPath(record.path, `inputs.${key}.path`);
    assertSha256(record.sha256, `inputs.${key}.sha256`);
    assertRecord(record.artifact, `inputs.${key}.artifact`);
    validateRendererBaselineV4Artifact(record.artifact);
    validateExpectedGroup(key, record);
  }
  validateRoleSwapRoots('q1', 'q2', records);
  validateRoleSwapRoots('q3', 'q4', records);
  const q5 = records.q5.artifact;
  if (q5.roles.baseline.root !== q5.roles.current.root) throw new Error('q5 必须使用同一构建根');
}

function inputSummary(key, record) {
  const artifact = record.artifact;
  return {
    path: path.resolve(record.path),
    sha256: record.sha256,
    group: artifact.group,
    qualificationStatus: artifact.qualification.status,
    sampledAt: artifact.sampledAt,
    rebuiltAt: artifact.rebuiltAt,
    baselineCommit: artifact.baselineCommit,
    currentCommit: artifact.currentCommit,
    baselineLabel: artifact.roles.baseline.label,
    currentLabel: artifact.roles.current.label,
    baselineRoot: artifact.roles.baseline.root,
    currentRoot: artifact.roles.current.root,
    pairCount: artifact.pairCount,
    warmupCount: artifact.warmups.length,
    rawLaunchCount: artifact.rawLaunches.length,
    health: artifact.health,
    buildEquivalent: artifact.buildManifest.sameCommitEquivalent,
  };
}

function roleSwapSummary(pairName, records) {
  const { forward: forwardKey, reverse: reverseKey } = ROLE_SWAP_PAIRS[pairName];
  const forward = records[forwardKey].artifact;
  const reverse = records[reverseKey].artifact;
  const metrics = {};
  for (const metricName of RENDERER_V4_METRIC_NAMES) {
    const forwardValues = [...forward.v4.paired[metricName].pairedLogRatios].sort((left, right) => left - right);
    const reverseValues = [...reverse.v4.paired[metricName].pairedLogRatios].sort((left, right) => left - right);
    const forwardMedian = median(forwardValues);
    const reverseMedian = median(reverseValues);
    const drift = Math.abs(forwardMedian + reverseMedian);
    const threshold = RENDERER_V4_PRIMARY_LIMITS.roleSwapMedianLogDrift;
    metrics[metricName] = {
      forwardMedian,
      reverseMedian,
      drift,
      threshold,
      passed: Number.isFinite(drift) && drift <= threshold,
    };
  }
  return {
    forward: forward.group,
    reverse: reverse.group,
    metrics,
    passed: Object.values(metrics).every((metric) => metric.passed),
  };
}

function aggregateReasons(records, roleSwap) {
  const reasons = [];
  for (const key of INPUT_KEYS) {
    const artifact = records[key].artifact;
    if (artifact.qualification.status !== 'candidate-qualified') reasons.push(`${key}: artifact qualification status is ${artifact.qualification.status}`);
    if (artifact.buildManifest.sameCommitEquivalent !== true) reasons.push(`${key}: build equivalence is false`);
    if (artifact.health.assetsFailed !== 0 || artifact.health.pageErrors !== 0 || artifact.health.consoleErrors !== 0 || artifact.health.failedRequests !== 0) {
      reasons.push(`${key}: health gate has failures`);
    }
  }
  for (const [pairName, pair] of Object.entries(roleSwap)) {
    for (const [metricName, metric] of Object.entries(pair.metrics)) {
      if (!metric.passed) reasons.push(`${pairName}.${metricName}: role-swap median log drift exceeded threshold`);
    }
  }
  return reasons;
}

export function aggregateRendererV4QualificationSummary(records, options = {}) {
  validateAggregateInputs(records);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertIso(generatedAt, 'generatedAt');
  const roleSwap = {
    q1q2: roleSwapSummary('q1q2', records),
    q3q4: roleSwapSummary('q3q4', records),
  };
  const reasons = aggregateReasons(records, roleSwap);
  const summary = {
    schemaVersion: RENDERER_V4_QUALIFICATION_SUMMARY_SCHEMA_VERSION,
    artifactKind: RENDERER_V4_QUALIFICATION_SUMMARY_ARTIFACT_KIND,
    protocolId: RENDERER_V4_QUALIFICATION_SUMMARY_PROTOCOL_ID,
    generatedAt,
    resampled: false,
    inputs: Object.fromEntries(INPUT_KEYS.map((key) => [key, inputSummary(key, records[key])])),
    commits: Object.fromEntries(INPUT_KEYS.map((key) => [key, {
      baseline: records[key].artifact.baselineCommit,
      current: records[key].artifact.currentCommit,
    }])),
    buildEquivalence: {
      allEquivalent: INPUT_KEYS.every((key) => records[key].artifact.buildManifest.sameCommitEquivalent === true),
      byGroup: Object.fromEntries(INPUT_KEYS.map((key) => [key, records[key].artifact.buildManifest.sameCommitEquivalent === true])),
    },
    counts: {
      rawLaunches: INPUT_KEYS.reduce((sum, key) => sum + records[key].artifact.rawLaunches.length, 0),
      warmups: INPUT_KEYS.reduce((sum, key) => sum + records[key].artifact.warmups.length, 0),
    },
    roleSwap: {
      threshold: RENDERER_V4_PRIMARY_LIMITS.roleSwapMedianLogDrift,
      q1q2: roleSwap.q1q2,
      q3q4: roleSwap.q3q4,
      passed: roleSwap.q1q2.passed && roleSwap.q3q4.passed,
    },
    aggregate: {
      valid: true,
      status: reasons.length === 0 ? 'candidate-qualified' : 'not-qualified',
      reasons,
    },
  };
  validateRendererV4QualificationSummary(summary);
  return summary;
}

export function validateRendererV4QualificationSummary(value, options = {}) {
  assertRecord(value, 'qualification summary');
  if (value.schemaVersion !== RENDERER_V4_QUALIFICATION_SUMMARY_SCHEMA_VERSION) throw new Error('summary schemaVersion 无效');
  if (value.artifactKind !== RENDERER_V4_QUALIFICATION_SUMMARY_ARTIFACT_KIND) throw new Error('summary artifactKind 无效');
  if (value.protocolId !== RENDERER_V4_QUALIFICATION_SUMMARY_PROTOCOL_ID) throw new Error('summary protocolId 无效');
  assertIso(value.generatedAt, 'summary.generatedAt');
  if (value.resampled !== false) throw new Error('summary.resampled 必须为 false');
  assertInputKeys(value.inputs, 'summary.inputs');
  assertInputKeys(value.commits, 'summary.commits');
  assertInputKeys(value.buildEquivalence?.byGroup, 'summary.buildEquivalence.byGroup');
  if (typeof value.buildEquivalence.allEquivalent !== 'boolean') throw new Error('summary.buildEquivalence.allEquivalent 无效');
  if (value.counts?.rawLaunches !== 200 || value.counts?.warmups !== 10) throw new Error('summary raw/warmup 总数无效');
  for (const key of INPUT_KEYS) {
    const input = value.inputs[key];
    assertRecord(input, `summary.inputs.${key}`);
    if (!path.isAbsolute(input.path)) throw new Error(`summary.inputs.${key}.path 必须是绝对路径`);
    assertSha256(input.sha256, `summary.inputs.${key}.sha256`);
    if (input.group !== EXPECTED_GROUPS[key]) throw new Error(`summary.inputs.${key}.group 无效`);
    if (input.qualificationStatus !== 'candidate-qualified' && input.qualificationStatus !== 'not-qualified') throw new Error(`summary.inputs.${key}.qualificationStatus 无效`);
    assertIso(input.sampledAt, `summary.inputs.${key}.sampledAt`);
    assertIso(input.rebuiltAt, `summary.inputs.${key}.rebuiltAt`);
    assertSourceSha(input.baselineCommit, `summary.inputs.${key}.baselineCommit`);
    assertSourceSha(input.currentCommit, `summary.inputs.${key}.currentCommit`);
    assertNonEmptyString(input.baselineLabel, `summary.inputs.${key}.baselineLabel`);
    assertNonEmptyString(input.currentLabel, `summary.inputs.${key}.currentLabel`);
    assertNonEmptyString(input.baselineRoot, `summary.inputs.${key}.baselineRoot`);
    assertNonEmptyString(input.currentRoot, `summary.inputs.${key}.currentRoot`);
    if (input.pairCount !== 20 || input.warmupCount !== 2 || input.rawLaunchCount !== 40) throw new Error(`summary.inputs.${key} sample count 无效`);
    assertRecord(input.health, `summary.inputs.${key}.health`);
    for (const healthKey of ['warmups', 'formalSamples', 'assetsFailed', 'pageErrors', 'consoleErrors', 'failedRequests']) {
      if (!Number.isInteger(input.health[healthKey]) || input.health[healthKey] < 0) throw new Error(`summary.inputs.${key}.health.${healthKey} 无效`);
    }
    if (input.health.warmups !== 2 || input.health.formalSamples !== 40) throw new Error(`summary.inputs.${key}.health sample count 不一致`);
    if (typeof input.buildEquivalent !== 'boolean') throw new Error(`summary.inputs.${key}.buildEquivalent 无效`);
    if (value.commits[key].baseline !== input.baselineCommit || value.commits[key].current !== input.currentCommit) throw new Error(`summary.commits.${key} 不一致`);
    if (value.buildEquivalence.byGroup[key] !== input.buildEquivalent) throw new Error(`summary.buildEquivalence.${key} 不一致`);
  }
  if (JSON.stringify([value.inputs.q1.baselineLabel, value.inputs.q1.currentLabel, value.inputs.q2.baselineLabel, value.inputs.q2.currentLabel]) !== JSON.stringify(['A', 'B', 'B', 'A'])) throw new Error('summary Q1/Q2 A/B 角色未交换');
  if (JSON.stringify([value.inputs.q3.baselineLabel, value.inputs.q3.currentLabel, value.inputs.q4.baselineLabel, value.inputs.q4.currentLabel]) !== JSON.stringify(['A', 'B', 'B', 'A'])) throw new Error('summary Q3/Q4 A/B 角色未交换');
  if (value.inputs.q5.baselineRoot !== value.inputs.q5.currentRoot) throw new Error('summary Q5 必须同根');
  if (value.roleSwap?.threshold !== RENDERER_V4_PRIMARY_LIMITS.roleSwapMedianLogDrift) throw new Error('summary role-swap threshold 被修改');
  if (typeof value.roleSwap.passed !== 'boolean') throw new Error('summary.roleSwap.passed 无效');
  for (const [pairName, pairDefinition] of Object.entries(ROLE_SWAP_PAIRS)) {
    const pair = value.roleSwap[pairName];
    assertRecord(pair, `summary.roleSwap.${pairName}`);
    if (pair.forward !== EXPECTED_GROUPS[pairDefinition.forward] || pair.reverse !== EXPECTED_GROUPS[pairDefinition.reverse]) throw new Error(`summary.roleSwap.${pairName} 映射无效`);
    if (typeof pair.passed !== 'boolean') throw new Error(`summary.roleSwap.${pairName}.passed 无效`);
    for (const metricName of RENDERER_V4_METRIC_NAMES) {
      const metric = pair.metrics?.[metricName];
      assertRecord(metric, `summary.roleSwap.${pairName}.${metricName}`);
      if (!Number.isFinite(metric.forwardMedian)) throw new Error(`${pairName}.${metricName}.forwardMedian 必须有限`);
      if (!Number.isFinite(metric.reverseMedian)) throw new Error(`${pairName}.${metricName}.reverseMedian 必须有限`);
      assertFiniteNonNegative(metric.drift, `${pairName}.${metricName}.drift`);
      if (metric.threshold !== RENDERER_V4_PRIMARY_LIMITS.roleSwapMedianLogDrift) throw new Error(`${pairName}.${metricName}.threshold 被修改`);
      if (typeof metric.passed !== 'boolean' || metric.passed !== (metric.drift <= metric.threshold)) throw new Error(`${pairName}.${metricName}.passed 与 drift 不一致`);
    }
    if (pair.passed !== Object.values(pair.metrics).every((metric) => metric.passed)) throw new Error(`${pairName}.passed 与 metrics 不一致`);
  }
  if (value.roleSwap.passed !== (value.roleSwap.q1q2.passed && value.roleSwap.q3q4.passed)) throw new Error('summary.roleSwap.passed 与子组不一致');
  assertRecord(value.aggregate, 'summary.aggregate');
  if (value.aggregate.valid !== true) throw new Error('summary.aggregate.valid 必须为 true');
  if (value.aggregate.status !== 'candidate-qualified' && value.aggregate.status !== 'not-qualified') throw new Error('summary.aggregate.status 无效');
  assertStringArray(value.aggregate.reasons, 'summary.aggregate.reasons');
  if (value.aggregate.status === 'candidate-qualified' && value.aggregate.reasons.length !== 0) throw new Error('candidate-qualified summary 不得包含失败原因');
  if (value.aggregate.status === 'not-qualified' && value.aggregate.reasons.length === 0) throw new Error('not-qualified summary 必须保留失败原因');
  const expectedAllEquivalent = INPUT_KEYS.every((key) => value.inputs[key].buildEquivalent);
  if (value.buildEquivalence.allEquivalent !== expectedAllEquivalent) throw new Error('summary.buildEquivalence.allEquivalent 不一致');

  if (options.records !== undefined) {
    validateAggregateInputs(options.records);
    for (const key of INPUT_KEYS) {
      const source = options.records[key];
      if (path.resolve(source.path) !== value.inputs[key].path || source.sha256 !== value.inputs[key].sha256) throw new Error(`summary.inputs.${key} SHA/path 与源 artifact 不一致`);
    }
    const rebuilt = aggregateRendererV4QualificationSummary(options.records, { generatedAt: value.generatedAt });
    if (JSON.stringify(rebuilt) !== JSON.stringify(value)) throw new Error('summary 与源 artifact 重算结果不一致');
  }
  return value;
}

function validateOutputPath(outputPath, inputPaths) {
  if (!isWithin(AUTHORITY_DIRECTORY, outputPath)) throw new Error('--output 必须位于 docs/baselines 内');
  if (inputPaths.some((inputPath) => path.resolve(inputPath) === outputPath)) throw new Error('--output 不得覆盖输入 artifact');
  const parent = path.dirname(outputPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('--output 父目录不存在');
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) throw new Error('--output 不能是目录');
}

function runCli() {
  try {
    const args = parseRendererV4QualificationSummaryArgs(process.argv.slice(2));
    const inputPaths = Object.fromEntries(INPUT_KEYS.map((key) => [key, args[`${key}Path`]]));
    validateOutputPath(args.outputPath, Object.values(inputPaths));
    const records = Object.fromEntries(INPUT_KEYS.map((key) => [key, readJsonArtifact(inputPaths[key])]));
    const summary = aggregateRendererV4QualificationSummary(records);
    validateRendererV4QualificationSummary(summary, { records });
    fs.writeFileSync(args.outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ valid: true, status: summary.aggregate.status, output: args.outputPath }, null, 2));
    process.exitCode = summary.aggregate.status === 'candidate-qualified' ? 0 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) runCli();
