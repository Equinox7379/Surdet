import { describe, expect, it } from 'vitest';
import {
  RENDERER_BASELINE_V4_SCHEMA_VERSION,
  RENDERER_V4_METRIC_NAMES,
  RENDERER_V4_PROTOCOL_ID,
  buildRendererV4Artifact,
  compareRendererV4Metrics,
  summarizeRendererV4Metric,
  validateRendererV4Artifact,
} from '../e2e/renderer-baseline-v4.mjs';
import { rebuildRendererBaselineV4Artifact } from '../e2e/renderer-baseline-v4-artifact.mjs';
import { parseRendererBaselineV4VerifyArgs } from '../e2e/renderer-baseline-v4-verify.mjs';

const OLD_COMMIT = '007438b569ec95350fdc9d7882ad49f55bbb7968';
const CURRENT_COMMIT = 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59';
const LOCK_SHA = 'b'.repeat(64);
const FILE_SHA = 'c'.repeat(64);

function environment() {
  return {
    node: 'v22.14.0',
    npm: '10.9.2',
    os: 'win32 10.0.26100',
    platform: 'win32',
    arch: 'x64',
    cpu: 'fixture cpu',
    electron: '43.2.0',
    playwright: '1.49.0',
    buildMode: 'electron-dev-shell-starter',
    packageLockSha256: LOCK_SHA,
  };
}

function buildManifest(sourceCommit) {
  return {
    schemaVersion: 1,
    artifactKind: 'renderer-build-manifest',
    sourceCommit,
    packageLockSha256: LOCK_SHA,
    buildCommand: ['npm', 'run', 'build'],
    installCommand: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    noMtime: true,
    worktreeStatus: '',
    environment: {
      node: 'v22.14.0', npm: '10.9.2', electron: '43.2.0', playwright: '1.49.0',
      os: 'win32 10.0.26100', platform: 'win32', arch: 'x64', cpu: 'fixture cpu',
    },
    roots: { shellDist: 'packages/shell/dist', starterDist: 'examples/starter/dist' },
    files: [
      { relativePath: 'examples/starter/dist/assets/index-test.js', size: 10, sha256: FILE_SHA },
      { relativePath: 'examples/starter/dist/index.html', size: 20, sha256: 'd'.repeat(64) },
      { relativePath: 'packages/shell/dist/main.js', size: 30, sha256: 'e'.repeat(64) },
      { relativePath: 'packages/shell/dist/preload.js', size: 40, sha256: 'f'.repeat(64) },
    ],
    bundleEntries: {
      'packages/shell/dist/main.js': 'e'.repeat(64),
      'packages/shell/dist/preload.js': 'f'.repeat(64),
      'examples/starter/dist/index.html': 'd'.repeat(64),
      'examples/starter/dist/assets/index-test.js': FILE_SHA,
    },
  };
}

function pageSnapshot() {
  return {
    schemaVersion: 1,
    timeOriginMs: 1000,
    navigationStartMs: 1000,
    markers: {
      starterModuleStartedAt: { available: true, monotonicMs: 1 },
      runtimeCreateStartedAt: { available: true, monotonicMs: 2 },
      runtimeCreateCompletedAt: { available: true, monotonicMs: 8 },
      debugPublishedAt: { available: true, monotonicMs: 9 },
      assetLoadStartedAt: { available: true, monotonicMs: 10 },
      assetLoadCompletedAt: { available: true, monotonicMs: 30 },
      fontsReadyAt: { available: false, reason: 'font loading is part of the asset queue' },
      titleReadyAt: { available: true, monotonicMs: 31 },
      firstStableFrameAt: { available: true, monotonicMs: 47 },
    },
    derived: {
      navigationToDebugMs: 9,
      runtimeCreateMs: 6,
      assetLoadMs: 20,
      debugToAssetDoneMs: 21,
      assetDoneToStableFrameMs: 17,
    },
    resourceTiming: {
      count: 1,
      byInitiatorType: { script: 1 },
      totalTransferSize: 80,
      entries: [{ name: 'starter.js', initiatorType: 'script', durationMs: 2, transferSize: 80, encodedBodySize: 80, decodedBodySize: 120 }],
    },
  };
}

function hostDurations() {
  return {
    hostLaunchToFirstWindowMs: 20,
    hostFirstWindowToDebugMs: 30,
    hostDebugToAssetDoneMs: 40,
  };
}

function launch(role, pair, sequenceIndex) {
  const base = 100 + pair;
  const metrics = Object.fromEntries(RENDERER_V4_METRIC_NAMES.map((name, index) => [
    name,
    base + index + (role === 'current' ? 2 : 0),
  ]));
  return {
    pair,
    role,
    sequenceIndex,
    metrics,
    hostDurations: hostDurations(),
    page: pageSnapshot(),
    observer: { lagMs: 19 },
    assetLoading: { total: 44, completed: 44, failed: 0, current: null, done: true },
    errors: { page: [], console: [], failedRequests: [] },
  };
}

function executionOrder() {
  const result = [];
  let sequenceIndex = 0;
  for (let pair = 1; pair <= 20; pair += 1) {
    const first = pair % 2 === 1 ? 'baseline' : 'current';
    const second = first === 'baseline' ? 'current' : 'baseline';
    result.push({ pair, sequenceIndex: ++sequenceIndex, role: first });
    result.push({ pair, sequenceIndex: ++sequenceIndex, role: second });
  }
  return result;
}

function fixtureArtifact() {
  const order = executionOrder();
  const rawLaunches = order.map((step) => launch(step.role, step.pair, step.sequenceIndex));
  const warmups = [launch('baseline', 0, 0), launch('current', 0, 0)];
  return buildRendererV4Artifact({
    group: 'q1-007-a-b',
    sampledAt: '2026-08-10T10:00:00.000Z',
    rebuiltAt: '2026-08-10T10:00:00.000Z',
    baselineCommit: OLD_COMMIT,
    currentCommit: OLD_COMMIT,
    roles: {
      baseline: { root: 'C:/Temp/renderer-v4/q1/a', commit: OLD_COMMIT, role: 'baseline' },
      current: { root: 'C:/Temp/renderer-v4/q1/b', commit: OLD_COMMIT, role: 'current' },
    },
    pairCount: 20,
    warmupOrder: ['baseline', 'current'],
    executionOrder: order,
    environment: { baseline: environment(), current: environment(), differences: [] },
    buildManifest: { baseline: buildManifest(OLD_COMMIT), current: buildManifest(OLD_COMMIT), sameCommitEquivalent: true },
    warmups,
    rawLaunches,
    reportSha256: 'not-generated',
  });
}

describe('renderer baseline v4 protocol and comparison', () => {
  it('summarizes raw values without mutating the input and uses linear p95', () => {
    const raw = [1, 4, 2, 3];
    const summary = summarizeRendererV4Metric('coldStartMs', raw);
    expect(raw).toEqual([1, 4, 2, 3]);
    expect(summary.median).toBe(2.5);
    expect(summary.p95).toBeCloseTo(3.85, 10);
  });

  it('computes paired ratios, signed differences, absolute log ratios, and order strata', () => {
    const result = compareRendererV4Metrics({
      name: 'assetReadyMs',
      baseline: [100, 100, 100, 100],
      current: [110, 90, 100, 125],
      orderByPair: ['baseline-first', 'current-first', 'baseline-first', 'current-first'],
    });
    expect(result.pairedRatios).toHaveLength(4);
    expect(result.pairedMedianRatio).toBe(1.05);
    expect(result.medianAbsLogRatio).toBeGreaterThan(0);
    expect(result.p95AbsLogRatio).toBeGreaterThan(result.medianAbsLogRatio);
    expect(result.orderStrata.baselineFirst.sampleCount).toBe(2);
    expect(result.orderStrata.currentFirst.sampleCount).toBe(2);
    expect(result.primaryPassed).toBe(false);
  });

  it('validates a complete same-commit artifact and recomputes every derived section', () => {
    const artifact = fixtureArtifact();
    expect(artifact.schemaVersion).toBe(RENDERER_BASELINE_V4_SCHEMA_VERSION);
    expect(artifact.protocolId).toBe(RENDERER_V4_PROTOCOL_ID);
    expect(() => validateRendererV4Artifact(artifact)).not.toThrow();
    expect(artifact.v4.groupGates.primaryMetricGate).toBe(true);
    expect(artifact.v4.groupGates.pairedMedianRatioIsDiagnosticOnly).toBe(true);
  });

  it.each([
    ['schema version', (value) => { value.schemaVersion = 3; }],
    ['protocol id', (value) => { value.protocolId = 'other'; }],
    ['invalid current commit', (value) => { value.currentCommit = 'f'.repeat(39); }],
    ['role commit mismatch', (value) => { value.roles.current.commit = CURRENT_COMMIT; }],
    ['raw count', (value) => { value.rawLaunches.pop(); }],
    ['duplicate order pair', (value) => { value.executionOrder[1].pair = 2; }],
    ['asset total zero', (value) => { value.rawLaunches[0].assetLoading.total = 0; }],
    ['asset incomplete', (value) => { value.rawLaunches[0].assetLoading.completed = 43; }],
    ['asset failed', (value) => { value.rawLaunches[0].assetLoading.failed = 1; }],
    ['page marker missing', (value) => { delete value.rawLaunches[0].page.markers.debugPublishedAt; }],
    ['negative metric', (value) => { value.rawLaunches[0].metrics.sceneP95Ms = -1; }],
    ['summary tampered', (value) => { value.baseline.metrics.assetReadyMs.median += 1; }],
    ['paired section tampered', (value) => { value.v4.paired.assetReadyMs.pairedMedianRatio += 0.1; }],
    ['v3 comparison tampered', (value) => { value.v3Compatible.comparison.metrics.assetReadyMs.gateRatio += 0.1; }],
  ])('rejects tampered artifact: %s', (_label, mutate) => {
    const artifact = fixtureArtifact();
    mutate(artifact);
    expect(() => validateRendererV4Artifact(artifact)).toThrow();
  });

  it('does not use paired median alone as the primary qualification gate', () => {
    const artifact = fixtureArtifact();
    artifact.v4.paired.assetReadyMs.pairedMedianRatio = 1;
    artifact.v4.groupGates.primaryMetricGate = true;
    expect(() => validateRendererV4Artifact(artifact)).toThrow();
  });

  it('preserves sampledAt while offline rebuild updates only rebuiltAt', () => {
    const artifact = fixtureArtifact();
    const rebuilt = rebuildRendererBaselineV4Artifact(artifact, { rebuiltAt: '2026-08-10T11:00:00.000Z' });
    expect(rebuilt.sampledAt).toBe(artifact.sampledAt);
    expect(rebuilt.rebuiltAt).toBe('2026-08-10T11:00:00.000Z');
    expect(() => validateRendererV4Artifact(rebuilt)).not.toThrow();
  });

  it('requires an explicit artifact path for the official verifier', () => {
    expect(() => parseRendererBaselineV4VerifyArgs([])).toThrow(/--artifact/);
    expect(() => parseRendererBaselineV4VerifyArgs(['--unknown', 'x'])).toThrow(/未知参数/);
    expect(parseRendererBaselineV4VerifyArgs(['--artifact', 'docs/baselines/q1.json']).artifactPath).toContain('q1.json');
  });
});
