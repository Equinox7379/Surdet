import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateRendererV4QualificationSummary,
  parseRendererV4QualificationSummaryArgs,
  roleSwapDrift,
  validateRendererV4QualificationSummary,
} from '../e2e/renderer-v4-qualification-summary.mjs';
import {
  RENDERER_V4_METRIC_NAMES,
  RENDERER_V4_PRIMARY_LIMITS,
  buildRendererV4Artifact,
} from '../e2e/renderer-baseline-v4.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AGGREGATE_SCRIPT = path.join(ROOT, 'packages', 'shell', 'e2e', 'renderer-v4-qualification-summary.mjs');
const SINGLE_VERIFY_SCRIPT = path.join(ROOT, 'packages', 'shell', 'e2e', 'renderer-baseline-v4-verify.mjs');
const OLD_COMMIT = '007438b569ec95350fdc9d7882ad49f55bbb7968';
const CURRENT_COMMIT = 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59';
const LOCK_SHA = 'b'.repeat(64);
const FILE_SHA = 'c'.repeat(64);
const Q_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5'];
const Q_FILES = {
  q1: 'renderer-v4-q1-007-a-b-2026-08-10.json',
  q2: 'renderer-v4-q2-007-b-a-2026-08-10.json',
  q3: 'renderer-v4-q3-f7-a-b-2026-08-10.json',
  q4: 'renderer-v4-q4-f7-b-a-2026-08-10.json',
  q5: 'renderer-v4-q5-f7-same-root-2026-08-10.json',
};
const GROUPS = {
  q1: 'q1-007-a-b',
  q2: 'q2-007-b-a',
  q3: 'q3-f7-a-b',
  q4: 'q4-f7-b-a',
  q5: 'q5-f7-same-root',
};
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function realQPaths() {
  return Object.fromEntries(Q_KEYS.map((key) => [key, path.join(ROOT, 'docs', 'baselines', Q_FILES[key])]));
}

function makeOutputDirectory() {
  const directory = fs.mkdtempSync(path.join(ROOT, 'docs', 'baselines', '.renderer-v4-summary-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function makeExternalDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v4-summary-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

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

function launch(role, pair, sequenceIndex, delta) {
  const base = 100 + Math.max(pair, 1);
  const metrics = Object.fromEntries(RENDERER_V4_METRIC_NAMES.map((name, index) => [
    name,
    (base + index) * (role === 'current' ? Math.exp(delta) : 1),
  ]));
  return {
    pair,
    role,
    sequenceIndex,
    metrics,
    hostDurations: { hostLaunchToFirstWindowMs: 20, hostFirstWindowToDebugMs: 30, hostDebugToAssetDoneMs: 40 },
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

function fixtureArtifact(key, delta) {
  const group = GROUPS[key];
  const commit = key === 'q1' || key === 'q2' ? OLD_COMMIT : CURRENT_COMMIT;
  const rootA = `C:/Temp/renderer-v4-summary/${key}/a`;
  const rootB = key === 'q5' ? rootA : `C:/Temp/renderer-v4-summary/${key}/b`;
  const swap = key === 'q2' || key === 'q4';
  const roles = {
    baseline: { label: swap ? 'B' : 'A', root: swap ? rootB : rootA, commit, role: 'baseline' },
    current: { label: swap ? 'A' : 'B', root: swap ? rootA : rootB, commit, role: 'current' },
  };
  const order = executionOrder();
  const rawLaunches = order.map((step) => launch(step.role, step.pair, step.sequenceIndex, delta));
  const warmups = [launch('baseline', 0, 0, delta), launch('current', 0, 0, delta)];
  return buildRendererV4Artifact({
    group,
    sampledAt: '2026-08-10T10:00:00.000Z',
    rebuiltAt: '2026-08-10T10:00:00.000Z',
    baselineCommit: commit,
    currentCommit: commit,
    roles,
    pairCount: 20,
    warmupOrder: ['baseline', 'current'],
    executionOrder: order,
    environment: { baseline: environment(), current: environment(), differences: [] },
    buildManifest: { baseline: buildManifest(commit), current: buildManifest(commit), sameCommitEquivalent: true },
    warmups,
    rawLaunches,
    reportSha256: 'not-generated',
  });
}

function candidateArtifacts(deltas = { q1: 0.01, q2: -0.01, q3: 0.02, q4: -0.02, q5: 0.005 }) {
  return Object.fromEntries(Q_KEYS.map((key) => [key, fixtureArtifact(key, deltas[key])]));
}

function writeArtifacts(directory, artifacts) {
  return Object.fromEntries(Q_KEYS.map((key) => {
    const filePath = path.join(directory, `${key}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(artifacts[key], null, 2)}\n`);
    return [key, filePath];
  }));
}

function recordsFromArtifacts(artifacts, directory = makeExternalDirectory()) {
  const paths = writeArtifacts(directory, artifacts);
  return Object.fromEntries(Q_KEYS.map((key) => [key, {
    path: paths[key],
    sha256: sha256File(paths[key]),
    artifact: artifacts[key],
  }]));
}

function runCli(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    shell: false,
    encoding: 'utf8',
  });
}

function aggregateArgs(paths, outputPath) {
  return Q_KEYS.flatMap((key) => [`--${key}`, paths[key]]).concat(['--output', outputPath]);
}

function summaryFromRealArtifacts() {
  const paths = realQPaths();
  const records = Object.fromEntries(Q_KEYS.map((key) => {
    const artifact = JSON.parse(fs.readFileSync(paths[key], 'utf8'));
    return [key, { path: paths[key], sha256: sha256File(paths[key]), artifact }];
  }));
  return { paths, records };
}

describe('renderer v4 qualification aggregate', () => {
  it('requires all five explicit Q artifact paths and an output path', () => {
    expect(() => parseRendererV4QualificationSummaryArgs([])).toThrow(/--q1/);
    expect(() => parseRendererV4QualificationSummaryArgs(['--unknown', 'x'])).toThrow(/未知参数/);
    expect(() => parseRendererV4QualificationSummaryArgs(['--q1', 'a', '--q1', 'b'])).toThrow(/--q1 只能出现一次/);
    expect(() => parseRendererV4QualificationSummaryArgs(['--q1', 'a'])).toThrow(/--q2/);
    const parsed = parseRendererV4QualificationSummaryArgs([
      '--q1', 'a', '--q2', 'b', '--q3', 'c', '--q4', 'd', '--q5', 'e', '--output', 'summary.json',
    ]);
    expect(parsed.q1Path).toContain(`${path.sep}a`);
    expect(parsed.outputPath).toContain(`${path.sep}summary.json`);
  });

  it('uses the fixed role-swap formula at, below, and above the threshold', () => {
    const makeMetricArtifact = (value) => ({ v4: { paired: { coldStartMs: { pairedLogRatios: Array(20).fill(value) } } } });
    const threshold = RENDERER_V4_PRIMARY_LIMITS.roleSwapMedianLogDrift;
    expect(roleSwapDrift(makeMetricArtifact(threshold), makeMetricArtifact(0), 'coldStartMs')).toBeCloseTo(threshold, 12);
    expect(roleSwapDrift(makeMetricArtifact(threshold * 0.99), makeMetricArtifact(0), 'coldStartMs')).toBeLessThan(threshold);
    expect(roleSwapDrift(makeMetricArtifact(threshold * 1.01), makeMetricArtifact(0), 'coldStartMs')).toBeGreaterThan(threshold);
  });

  it('builds and validates a candidate-qualified aggregate without mutating inputs', () => {
    const artifacts = candidateArtifacts();
    const records = recordsFromArtifacts(artifacts);
    const summary = aggregateRendererV4QualificationSummary(records, { generatedAt: '2026-08-10T11:00:00.000Z' });
    expect(summary.aggregate).toMatchObject({ valid: true, status: 'candidate-qualified' });
    expect(summary.resampled).toBe(false);
    expect(summary.counts).toEqual({ rawLaunches: 200, warmups: 10 });
    expect(summary.roleSwap.q1q2.passed).toBe(true);
    expect(summary.roleSwap.q3q4.passed).toBe(true);
    expect(() => validateRendererV4QualificationSummary(summary)).not.toThrow();
    expect(artifacts.q1.qualification.status).toBe('candidate-qualified');
    expect(summary.inputs.q1.sha256).toBe(records.q1.sha256);
  });

  it('aggregates the five real Q artifacts as valid but not-qualified and preserves their hashes', () => {
    const { records, paths } = summaryFromRealArtifacts();
    const before = Object.fromEntries(Q_KEYS.map((key) => [key, sha256File(paths[key])]));
    const summary = aggregateRendererV4QualificationSummary(records, { generatedAt: '2026-08-10T11:01:00.000Z' });
    expect(summary.aggregate.status).toBe('not-qualified');
    expect(summary.aggregate.reasons.length).toBeGreaterThan(0);
    expect(summary.resampled).toBe(false);
    expect(Object.fromEntries(Q_KEYS.map((key) => [key, sha256File(paths[key])]))).toEqual(before);
  });

  it('rejects a summary whose recorded input SHA no longer matches the source record', () => {
    const records = recordsFromArtifacts(candidateArtifacts());
    const summary = aggregateRendererV4QualificationSummary(records, { generatedAt: '2026-08-10T11:02:00.000Z' });
    const tampered = JSON.parse(JSON.stringify(summary));
    tampered.inputs.q1.sha256 = '0'.repeat(64);
    expect(() => validateRendererV4QualificationSummary(tampered, { records })).toThrow(/sha256|SHA|源 artifact/i);
  });

  it('returns exit 2 for the real not-qualified aggregate and leaves Q artifacts unchanged', () => {
    const { paths } = summaryFromRealArtifacts();
    const before = Object.fromEntries(Q_KEYS.map((key) => [key, sha256File(paths[key])]));
    const outputDirectory = makeOutputDirectory();
    const outputPath = path.join(outputDirectory, 'summary.json');
    const result = runCli(AGGREGATE_SCRIPT, aggregateArgs(paths, outputPath));
    expect(result.status).toBe(2);
    const summary = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(summary.aggregate.status).toBe('not-qualified');
    expect(summary.resampled).toBe(false);
    expect(Object.fromEntries(Q_KEYS.map((key) => [key, sha256File(paths[key])]))).toEqual(before);
  });

  it('returns exit 0 for an explicit candidate-qualified aggregate', () => {
    const inputDirectory = makeExternalDirectory();
    const paths = writeArtifacts(inputDirectory, candidateArtifacts());
    const outputPath = path.join(makeOutputDirectory(), 'candidate-summary.json');
    const result = runCli(AGGREGATE_SCRIPT, aggregateArgs(paths, outputPath));
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).aggregate.status).toBe('candidate-qualified');
  });

  it.each([
    ['missing input file', ['--q1', 'missing.json'], 1],
    ['unknown argument', ['--unknown', 'x'], 1],
  ])('returns exit 1 for %s', (_label, args, expectedStatus) => {
    const outputPath = path.join(makeOutputDirectory(), 'invalid-summary.json');
    const result = runCli(AGGREGATE_SCRIPT, [...args, '--output', outputPath]);
    expect(result.status).toBe(expectedStatus);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('returns exit 1 for Q group swaps, invalid Q5 roots, and an output path outside the repository', () => {
    const inputDirectory = makeExternalDirectory();
    const artifacts = candidateArtifacts();
    const paths = writeArtifacts(inputDirectory, artifacts);
    const outputPath = path.join(makeOutputDirectory(), 'invalid-group.json');
    const swapped = runCli(AGGREGATE_SCRIPT, aggregateArgs({ ...paths, q2: paths.q1 }, outputPath));
    expect(swapped.status).toBe(1);

    const invalidQ5 = { ...artifacts.q5, roles: { ...artifacts.q5.roles, current: { ...artifacts.q5.roles.current, root: 'C:/Temp/renderer-v4-summary/q5/other' } } };
    const invalidQ5Path = path.join(inputDirectory, 'q5-invalid.json');
    fs.writeFileSync(invalidQ5Path, `${JSON.stringify(invalidQ5, null, 2)}\n`);
    const invalidRoot = runCli(AGGREGATE_SCRIPT, aggregateArgs({ ...paths, q5: invalidQ5Path }, path.join(makeOutputDirectory(), 'invalid-q5.json')));
    expect(invalidRoot.status).toBe(1);

    const outside = runCli(AGGREGATE_SCRIPT, aggregateArgs(paths, path.join(os.tmpdir(), 'renderer-v4-summary-outside.json')));
    expect(outside.status).toBe(1);
  });

  it('uses three-state exit codes for the existing single-artifact verifier', () => {
    const realQ1 = realQPaths().q1;
    const notQualified = runCli(SINGLE_VERIFY_SCRIPT, ['--artifact', realQ1]);
    expect(notQualified.status).toBe(2);

    const inputDirectory = makeExternalDirectory();
    const candidatePath = path.join(inputDirectory, 'candidate-q1.json');
    fs.writeFileSync(candidatePath, `${JSON.stringify(fixtureArtifact('q1', 0.01), null, 2)}\n`);
    const candidate = runCli(SINGLE_VERIFY_SCRIPT, ['--artifact', candidatePath]);
    expect(candidate.status).toBe(0);

    const invalidPath = path.join(inputDirectory, 'invalid.json');
    fs.writeFileSync(invalidPath, '{"schemaVersion": 4}\n');
    expect(runCli(SINGLE_VERIFY_SCRIPT, ['--artifact', invalidPath]).status).toBe(1);
  });
});
