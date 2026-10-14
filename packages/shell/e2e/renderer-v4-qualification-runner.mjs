import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import {
  buildRendererV4Artifact,
  validateRendererV4Artifact,
} from './renderer-baseline-v4.mjs';
import {
  collectBuildManifest,
  compareBuildManifests,
} from './renderer-build-equivalence.mjs';
import {
  applyRendererStartupInstrumentation,
  validateRendererStartupDiagnosticSnapshot,
} from './renderer-startup-diagnostic-instrumentation.mjs';
import {
  buildCleanupManifest,
  buildQualificationMatrix,
  createQualificationWorktrees,
  parseRendererV4QualificationArgs,
  QUALIFICATION_TEMP_ROOT,
  validateRepositoryRoot,
} from './renderer-v4-worktree.mjs';

const scriptPath = url.fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultRepositoryRoot = path.resolve(scriptDir, '../../..');
const readyTimeout = 120000;
const pairCount = 20;
const frameBudgetMs = 16.67;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
}

function npmCommand() {
  return { executable: process.execPath, prefix: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')] };
}

function runNpm(root, args) {
  const command = npmCommand();
  execFileSync(command.executable, [...command.prefix, ...args], { cwd: root, stdio: 'inherit', shell: false });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isoNow() {
  return new Date().toISOString();
}

function stamp() {
  return { at: isoNow(), monotonicMs: performance.now() };
}

function duration(start, end) {
  return end.monotonicMs - start.monotonicMs;
}

function assertUnder(parent, candidate, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} 必须位于 ${path.resolve(parent)} 内：${path.resolve(candidate)}`);
}

function readPackageVersion(root, packageName) {
  try {
    const packagePath = path.join(root, 'node_modules', ...packageName.split('/'), 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function environmentFor(root, buildManifest) {
  return {
    node: process.version,
    npm: readPackageVersion(root, 'npm'),
    os: `${os.platform()} ${os.release()}`,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    electron: readPackageVersion(root, 'electron'),
    playwright: readPackageVersion(root, 'playwright'),
    buildMode: 'electron-dev-shell-starter',
    packageLockSha256: buildManifest.packageLockSha256,
  };
}

async function waitForDiagnostic(page) {
  await page.waitForFunction(() => window.__surdetRendererStartupDiagnostic !== undefined, undefined, { timeout: readyTimeout });
  await page.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: readyTimeout });
}

async function waitForReady(page) {
  await waitForDiagnostic(page);
  await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true, undefined, { timeout: readyTimeout });
  await page.waitForTimeout(50);
}

async function reloadForReady(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReady(page);
}

async function measureMenu(page) {
  return page.evaluate(async ({ frameBudget }) => {
    const startedAt = performance.now();
    await window.__surdetDebug.titleSelect('settings');
    const syncDoneAt = performance.now();
    const nextFrameAt = await new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    return {
      elapsed: nextFrameAt - startedAt,
      commandSyncMs: syncDoneAt - startedAt,
      commandToNextRafMs: nextFrameAt - syncDoneAt,
      missedFrame: nextFrameAt - startedAt > frameBudget,
      frameBudgetMs: frameBudget,
    };
  }, { frameBudget: frameBudgetMs });
}

async function measureScene(page) {
  return page.evaluate(async ({ frameBudget }) => {
    const startedAt = performance.now();
    await window.__surdetDebug.titleSelect('new');
    const syncDoneAt = performance.now();
    const nextFrameAt = await new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    const deadline = performance.now() + 10000;
    while (window.__surdetDebug?.position?.sceneId === undefined) {
      if (performance.now() > deadline) throw new Error('入口场景位置未在诊断窗口内可观测');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      elapsed: nextFrameAt - startedAt,
      commandSyncMs: syncDoneAt - startedAt,
      commandToNextRafMs: nextFrameAt - syncDoneAt,
      missedFrame: nextFrameAt - startedAt > frameBudget,
      frameBudgetMs: frameBudget,
    };
  }, { frameBudget: frameBudgetMs });
}

function phaseMetrics(diagnostic, hostDurations, menu, scene) {
  return {
    coldStartMs: hostDurations.hostLaunchToDebugMs,
    assetReadyMs: hostDurations.hostLaunchToAssetDoneMs,
    menuOpenP95Ms: menu.elapsed,
    sceneP95Ms: scene.elapsed,
    hostLaunchToFirstWindowMs: hostDurations.hostLaunchToFirstWindowMs,
    hostFirstWindowToDebugMs: hostDurations.hostFirstWindowToDebugMs,
    hostDebugToAssetDoneMs: hostDurations.hostDebugToAssetDoneMs,
    pageNavigationToDebugMs: diagnostic.derived.navigationToDebugMs,
    pageRuntimeCreateMs: diagnostic.derived.runtimeCreateMs,
    pageAssetLoadMs: diagnostic.derived.assetLoadMs,
    pageDebugToAssetDoneMs: diagnostic.derived.debugToAssetDoneMs,
    pageAssetDoneToStableFrameMs: diagnostic.derived.assetDoneToStableFrameMs,
  };
}

async function collectLaunch(workspaceRoot, role, pair, sequenceIndex) {
  const shellRoot = path.join(workspaceRoot, 'packages', 'shell');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v4-launch-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, 'Electron 临时根');
  assertUnder(tempRoot, userData, 'Electron userData');
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const launchStarted = stamp();
  let app = null;
  let sample = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellRoot });
    const electronLaunchResolved = stamp();
    const page = await app.firstWindow();
    const firstWindowResolved = stamp();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));
    await waitForDiagnostic(page);
    const debugObserved = stamp();
    await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true, undefined, { timeout: readyTimeout });
    const assetDoneObserved = stamp();
    await page.waitForTimeout(50);
    const diagnostic = await page.evaluate(() => window.__surdetRendererStartupDiagnostic.getSnapshot());
    validateRendererStartupDiagnosticSnapshot(diagnostic);
    const assetLoading = await page.evaluate(() => ({ ...window.__surdetDebug.assetLoading }));

    // 首次菜单操作仅用于预热 UI 投影，不进入正式样本；随后每次动作使用 reload 后的独立页面状态。
    await measureMenu(page);
    await reloadForReady(page);
    const menu = await measureMenu(page);
    await reloadForReady(page);
    const scene = await measureScene(page);
    const errors = { page: [...pageErrors], console: [...consoleErrors], failedRequests: [...failedRequests] };
    const hostDurations = {
      hostLaunchToFirstWindowMs: duration(launchStarted, firstWindowResolved),
      hostFirstWindowToDebugMs: duration(firstWindowResolved, debugObserved),
      hostDebugToAssetDoneMs: duration(debugObserved, assetDoneObserved),
      hostLaunchToDebugMs: duration(launchStarted, debugObserved),
      hostLaunchToAssetDoneMs: duration(launchStarted, assetDoneObserved),
    };
    sample = {
      pair,
      role,
      sequenceIndex,
      metrics: phaseMetrics(diagnostic, hostDurations, menu, scene),
      hostTimestamps: {
        hostLaunchStartedAt: launchStarted,
        electronLaunchResolvedAt: electronLaunchResolved,
        firstWindowResolvedAt: firstWindowResolved,
        debugObservedAt: debugObserved,
        assetDoneObservedAt: assetDoneObserved,
      },
      hostDurations: {
        hostLaunchToFirstWindowMs: hostDurations.hostLaunchToFirstWindowMs,
        hostFirstWindowToDebugMs: hostDurations.hostFirstWindowToDebugMs,
        hostDebugToAssetDoneMs: hostDurations.hostDebugToAssetDoneMs,
      },
      page: diagnostic,
      observer: {
        // Either observation can arrive late; retain the discrepancy in both directions.
        lagMs: diagnostic.derived.debugToAssetDoneMs === null ? 0 : Math.abs(hostDurations.hostDebugToAssetDoneMs - diagnostic.derived.debugToAssetDoneMs),
      },
      interactionDiagnostics: { menu, scene },
      assetLoading,
      errors,
    };
    if (assetLoading.total <= 0 || assetLoading.completed !== assetLoading.total || assetLoading.failed !== 0 || assetLoading.done !== true) throw new Error(`素材健康失败：${JSON.stringify(sample)}`);
    if (errors.page.length > 0 || errors.console.length > 0 || errors.failedRequests.length > 0) throw new Error(`运行时健康失败：${JSON.stringify(sample)}`);
    return sample;
  } catch (error) {
    return {
      pair,
      role,
      sequenceIndex,
      failed: true,
      failure: { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null },
      partial: sample,
      errors: { page: [...pageErrors], console: [...consoleErrors], failedRequests: [...failedRequests] },
    };
  } finally {
    try {
      if (app) await app.close();
    } finally {
      const processCloseCompleted = stamp();
      if (sample) sample.hostTimestamps.processCloseCompletedAt = processCloseCompleted;
      assertUnder(os.tmpdir(), tempRoot, 'Electron 临时根');
      assertUnder(tempRoot, userData, 'Electron userData');
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

async function collectGroup(group, roots, instrumentation, buildManifest, environment) {
  const warmups = [];
  const rawLaunches = [];
  warmups.push(await collectLaunch(roots.baseline.root, 'baseline', 0, 0));
  warmups.push(await collectLaunch(roots.current.root, 'current', 0, 0));
  let sequenceIndex = 0;
  for (let pair = 1; pair <= pairCount; pair += 1) {
    const first = pair % 2 === 1 ? 'baseline' : 'current';
    const second = first === 'baseline' ? 'current' : 'baseline';
    for (const role of [first, second]) {
      sequenceIndex += 1;
      rawLaunches.push(await collectLaunch(roots[role].root, role, pair, sequenceIndex));
    }
  }
  const failures = [...warmups, ...rawLaunches].filter((sample) => sample.failed);
  const sampledAt = isoNow();
  if (failures.length > 0) {
    return {
      failed: true,
      artifact: {
        schemaVersion: 4,
        artifactKind: 'renderer-performance-qualification-failure',
        protocolId: 'renderer-v4-qualification-2026-08-10',
        sampledAt,
        rebuiltAt: sampledAt,
        group: group.id,
        baselineCommit: roots.baseline.commit,
        currentCommit: roots.current.commit,
        roles: { baseline: roots.baseline, current: roots.current },
        warmups,
        rawLaunches,
        buildManifest,
        environment,
        instrumentation,
        failures: failures.map((sample) => sample.failure ?? { message: 'sample failed' }),
        qualification: { valid: false, status: 'not-qualified', reasons: ['raw launch failure'] },
        reportSha256: 'not-generated',
      },
    };
  }
  const artifact = buildRendererV4Artifact({
    group: group.id,
    sampledAt,
    rebuiltAt: sampledAt,
    baselineCommit: roots.baseline.commit,
    currentCommit: roots.current.commit,
    roles: { baseline: roots.baseline, current: roots.current },
    pairCount,
    warmupOrder: ['baseline', 'current'],
    executionOrder: rawLaunches.map(({ pair, role, sequenceIndex: index }) => ({ pair, role, sequenceIndex: index })),
    environment,
    buildManifest,
    instrumentation,
    warmups,
    rawLaunches,
    reportSha256: 'not-generated',
  });
  validateRendererV4Artifact(artifact);
  return { failed: false, artifact };
}

function uniqueRootDescriptors(group) {
  const result = [];
  const seen = new Set();
  for (const role of ['baseline', 'current']) {
    if (seen.has(group[role].root)) continue;
    seen.add(group[role].root);
    result.push(group[role]);
  }
  return result;
}

function buildEquivalenceRecord(group, baselineManifest, currentManifest) {
  const comparison = compareBuildManifests(baselineManifest, currentManifest);
  return { group: group.id, baseline: baselineManifest, current: currentManifest, comparison, qualified: comparison.equivalent };
}

function writeBuildEvidence(artifactDir, commit, records) {
  const label = commit === '007438b569ec95350fdc9d7882ad49f55bbb7968' ? '007' : 'f7';
  writeJson(path.join(artifactDir, `renderer-v4-build-equivalence-${label}-2026-08-10.json`), {
    schemaVersion: 1,
    artifactKind: 'renderer-v4-build-equivalence-batch',
    sourceCommit: commit,
    generatedAt: isoNow(),
    groups: records,
    qualified: records.length > 0 && records.every((record) => record.qualified),
  });
}

async function main() {
  const parsed = parseRendererV4QualificationArgs(process.argv.slice(2));
  const repositoryRoot = path.resolve(parsed.repositoryRoot || defaultRepositoryRoot);
  validateRepositoryRoot(repositoryRoot, defaultRepositoryRoot);
  const artifactDir = path.resolve(parsed.artifactDir);
  assertUnder(repositoryRoot, artifactDir, 'artifact-dir');
  const requestedTempRoot = path.resolve(parsed.tempRoot);
  const tempRoot = fs.existsSync(requestedTempRoot)
    ? (() => { let index = 1; while (fs.existsSync(`${requestedTempRoot}-${index}`)) index += 1; return `${requestedTempRoot}-${index}`; })()
    : requestedTempRoot;
  fs.mkdirSync(tempRoot, { recursive: true });
  const matrix = buildQualificationMatrix(tempRoot);
  const cleanupManifestPath = path.join(artifactDir, 'renderer-v4-qualification-cleanup-2026-08-10.json');
  const cleanup = buildCleanupManifest(matrix, { tempRoot, stage: 'started', artifact: null });
  writeJson(cleanupManifestPath, cleanup);
  const buildEvidence = { '007': [], f7: [] };
  let fatalBuildFailure = null;
  for (const group of matrix) {
    if (fatalBuildFailure) break;
    const created = createQualificationWorktrees(group, repositoryRoot, tempRoot);
    const byRoot = new Map(created.map((item) => [item.root, item]));
    const roleRoots = {
      baseline: { ...group.baseline, ...(byRoot.get(group.baseline.root) ?? {}), role: 'baseline' },
      current: { ...group.current, ...(byRoot.get(group.current.root) ?? {}), role: 'current' },
    };
    const manifests = {};
    for (const descriptor of uniqueRootDescriptors(group)) {
      runNpm(descriptor.root, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
      runNpm(descriptor.root, ['run', 'build']);
      manifests[descriptor.root] = collectBuildManifest(descriptor.root);
    }
    const baselineManifest = manifests[group.baseline.root];
    const currentManifest = manifests[group.current.root];
    const equivalence = buildEquivalenceRecord(group, baselineManifest, currentManifest);
    const label = group.baseline.commit === '007438b569ec95350fdc9d7882ad49f55bbb7968' ? '007' : 'f7';
    buildEvidence[label].push(equivalence);
    writeBuildEvidence(artifactDir, group.baseline.commit, buildEvidence[label]);
    if (!equivalence.qualified) {
      fatalBuildFailure = { group: group.id, differences: equivalence.comparison.differences };
      break;
    }
    const instrumentationByRoot = {};
    for (const descriptor of uniqueRootDescriptors(group)) {
      instrumentationByRoot[descriptor.root] = applyRendererStartupInstrumentation(descriptor.root);
      runNpm(descriptor.root, ['run', 'build']);
    }
    const instrumentation = {
      baseline: instrumentationByRoot[group.baseline.root],
      current: instrumentationByRoot[group.current.root],
    };
    const environment = {
      baseline: environmentFor(group.baseline.root, baselineManifest),
      current: environmentFor(group.current.root, currentManifest),
      differences: [],
    };
    const result = await collectGroup(group, roleRoots, instrumentation, { baseline: baselineManifest, current: currentManifest, sameCommitEquivalent: true }, environment);
    writeJson(path.join(artifactDir, group.artifact.replace(/^docs\\baselines[\\/]/, '').replace(/^docs[\\/]baselines[\\/]/, '')), result.artifact);
    if (result.failed || result.artifact.qualification.status !== 'candidate-qualified') process.exitCode = 1;
    cleanup.stage = 'samples-written';
    cleanup.worktrees = cleanup.worktrees.map((entry) => entry.group === group.id ? { ...entry, stage: 'samples-written', artifact: group.artifact, createdAt: byRoot.get(entry.path)?.createdAt ?? entry.createdAt } : entry);
    writeJson(cleanupManifestPath, cleanup);
  }
  if (fatalBuildFailure) {
    writeJson(path.join(artifactDir, 'renderer-v4-qualification-build-failure-2026-08-10.json'), { schemaVersion: 1, artifactKind: 'renderer-v4-build-failure', generatedAt: isoNow(), failure: fatalBuildFailure });
    process.exitCode = 1;
  }
  cleanup.stage = fatalBuildFailure ? 'build-failure' : 'all-samples-written';
  writeJson(cleanupManifestPath, cleanup);
  console.log(JSON.stringify({ tempRoot, groups: matrix.map((group) => group.id), fatalBuildFailure }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
