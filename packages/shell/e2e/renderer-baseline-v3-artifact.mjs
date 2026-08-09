import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const METRIC_NAMES = ['coldStartMs', 'assetReadyMs', 'menuOpenP95Ms', 'sceneP95Ms'];
const HISTORICAL_BASELINE_PATH = 'docs/baselines/renderer-v2-cab200b.json';

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertUnder(parent, candidate, label) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${parentPath} 下：${candidatePath}`);
  }
}

function historicalFilePath(repositoryRoot, baselinePath) {
  if (baselinePath !== HISTORICAL_BASELINE_PATH) {
    throw new Error(`historicalComparison.baselinePath 必须是 ${HISTORICAL_BASELINE_PATH}`);
  }
  const filePath = path.resolve(repositoryRoot, baselinePath);
  assertUnder(repositoryRoot, filePath, '历史 v2 文件');
  return filePath;
}

function rawSamples(rawLaunches, role, pairCount) {
  const selected = rawLaunches
    .filter((sample) => sample.role === role)
    .sort((left, right) => left.pair - right.pair);
  if (selected.length !== pairCount || selected.some((sample, index) => sample.pair !== index + 1)) {
    throw new Error(`rawLaunches 的 ${role} 角色必须每个 pair 恰好出现一次`);
  }
  return Object.fromEntries(METRIC_NAMES.map((name) => [name, selected.map((sample) => sample[name])]));
}

function healthFromSamples(warmups, rawLaunches) {
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

function currentSummary(current) {
  return {
    coldStartMs: current.metrics.coldStartMs.median,
    assetReadyMs: current.metrics.assetReadyMs.median,
    menuOpenP95Ms: current.metrics.menuOpenP95Ms.p95,
    sceneP95Ms: current.metrics.sceneP95Ms.p95,
  };
}

function readHistorical(repositoryRoot, historicalComparison, v2) {
  const filePath = historicalFilePath(repositoryRoot, historicalComparison.baselinePath);
  const bytesSha256 = sha256File(filePath);
  if (bytesSha256.toLowerCase() !== historicalComparison.baselineSha256.toLowerCase()) {
    throw new Error('historicalComparison.baselineSha256 与磁盘文件不一致');
  }
  const historical = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  v2.validateRendererBaseline(historical);
  if (historical.sourceSha !== historicalComparison.baselineSourceSha) {
    throw new Error('historicalComparison.baselineSourceSha 与 v2 文件 sourceSha 不一致');
  }
  return { historical, filePath };
}

function expectedHistoricalComparison(repositoryRoot, candidate, v2) {
  const { historical } = readHistorical(repositoryRoot, candidate.historicalComparison, v2);
  const comparison = v2.compareRendererBaseline(
    {
      coldStartMs: historical.coldStartMs,
      assetReadyMs: historical.assetReadyMs,
      menuOpenP95Ms: historical.menuOpenP95Ms,
      sceneP95Ms: historical.sceneP95Ms,
    },
    currentSummary(candidate.current),
  );
  return {
    baselinePath: candidate.historicalComparison.baselinePath,
    baselineSha256: candidate.historicalComparison.baselineSha256,
    baselineSourceSha: historical.sourceSha,
    failures: comparison.failures,
  };
}

export function validateRendererBaselineV3Artifact(candidate, { repositoryRoot, v3, v2 }) {
  v3.validateRendererBaselineV3(candidate);
  const expected = expectedHistoricalComparison(repositoryRoot, candidate, v2);
  if (JSON.stringify(candidate.historicalComparison) !== JSON.stringify(expected)) {
    throw new Error('historicalComparison 与磁盘 v2 文件和当前正式统计重算结果不一致');
  }
  return candidate;
}

export function rebuildRendererBaselineV3Artifact(input, {
  repositoryRoot,
  v3,
  v2,
  generatedAt = new Date().toISOString(),
  packageLockSha256 = sha256File(path.join(repositoryRoot, 'package-lock.json')),
}) {
  const pairCount = input.pairCount;
  const baseline = v3.buildRendererV3Run(
    input.baselineCommit,
    rawSamples(input.rawLaunches, 'baseline', pairCount),
  );
  const current = v3.buildRendererV3Run(
    input.currentCommit,
    rawSamples(input.rawLaunches, 'current', pairCount),
  );
  const baselineEnvironment = { ...input.environment.baseline, packageLockSha256 };
  const currentEnvironment = { ...input.environment.current, packageLockSha256 };
  const result = v3.compareRendererBaselineV3({
    baselineCommit: input.baselineCommit,
    currentCommit: input.currentCommit,
    pairCount,
    warmupOrder: input.warmupOrder,
    executionOrder: input.executionOrder,
    baselineEnvironment,
    currentEnvironment,
    baseline,
    current,
    generatedAt,
  });
  const historicalPath = path.join(repositoryRoot, HISTORICAL_BASELINE_PATH);
  const historical = JSON.parse(fs.readFileSync(historicalPath, 'utf8'));
  v2.validateRendererBaseline(historical);
  const historicalComparison = v2.compareRendererBaseline(
    {
      coldStartMs: historical.coldStartMs,
      assetReadyMs: historical.assetReadyMs,
      menuOpenP95Ms: historical.menuOpenP95Ms,
      sceneP95Ms: historical.sceneP95Ms,
    },
    currentSummary(current),
  );
  const output = {
    ...result,
    warmups: input.warmups,
    rawLaunches: input.rawLaunches,
    health: healthFromSamples(input.warmups, input.rawLaunches),
    historicalComparison: {
      baselinePath: HISTORICAL_BASELINE_PATH,
      baselineSha256: sha256File(historicalPath),
      baselineSourceSha: historical.sourceSha,
      failures: historicalComparison.failures,
    },
  };
  return validateRendererBaselineV3Artifact(output, { repositoryRoot, v3, v2 });
}
