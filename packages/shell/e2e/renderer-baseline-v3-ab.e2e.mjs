import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import {
  sha256File,
  validateRendererBaselineV3Artifact,
} from './renderer-baseline-v3-artifact.mjs';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(shellDir, '../..');
const readyTimeout = 120000;
const defaultPairCount = 20;
const v3ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline-v3.js');
const v2ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline.js');

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    const name = argument.slice(2);
    if (values.has(name)) throw new Error(`参数只能出现一次：--${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${name}`);
    values.set(name, value);
    index += 1;
  }
  const baselineRoot = path.resolve(values.get('baseline-root') ?? '');
  const currentRoot = path.resolve(values.get('current-root') ?? '');
  const outputPath = path.resolve(values.get('out') ?? path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-candidate-2026-08-09.json'));
  const pairCount = Number(values.get('pair-count') ?? defaultPairCount);
  if (!fs.existsSync(path.join(baselineRoot, 'packages', 'shell', 'dist'))) throw new Error(`baseline-root 缺少 shell/dist：${baselineRoot}`);
  if (!fs.existsSync(path.join(currentRoot, 'packages', 'shell', 'dist'))) throw new Error(`current-root 缺少 shell/dist：${currentRoot}`);
  if (!Number.isInteger(pairCount) || pairCount < 20) throw new Error('pair-count 必须是至少 20 的整数');
  assertUnder(repositoryRoot, outputPath, '输出路径');
  return { baselineRoot, currentRoot, outputPath, pairCount };
}

function assertUnder(parent, candidate, label) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${parentPath} 下：${candidatePath}`);
  }
}

function readPackageVersion(workspaceRoot, packageName) {
  const packagePath = path.join(workspaceRoot, 'node_modules', ...packageName.split('/'), 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function npmVersion() {
  const npmPackagePath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(npmPackagePath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function gitSha(workspaceRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).trim();
}

function collectEnvironment(workspaceRoot) {
  return {
    node: process.version,
    npm: npmVersion(),
    os: `${os.platform()} ${os.release()}`,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    electron: readPackageVersion(workspaceRoot, 'electron'),
    playwright: readPackageVersion(workspaceRoot, 'playwright'),
    buildMode: 'electron-dev-shell-starter',
    packageLockSha256: sha256File(path.join(workspaceRoot, 'package-lock.json')),
  };
}

async function waitForReady(page) {
  await page.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: readyTimeout });
  await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true, undefined, { timeout: readyTimeout });
  await page.waitForTimeout(50);
}

async function reloadForReady(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReady(page);
}

async function measureTitleSettings(page) {
  return page.evaluate(async () => {
    const startedAt = performance.now();
    await window.__surdetDebug.titleSelect('settings');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - startedAt;
  });
}

async function measureSceneStart(page) {
  // v3 正式口径 A：从 titleSelect("new") 开始，到命令完成并提交下一帧。
  // position.sceneId 只在正式 elapsed 捕获之后作为健康确认，不进入 sceneP95Ms。
  return page.evaluate(async () => {
    const startedAt = performance.now();
    await window.__surdetDebug.titleSelect('new');
    const titleSelectDoneAt = performance.now();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const nextFrameAt = performance.now();
    const positionDeadline = nextFrameAt + 10000;
    let positionReadyAt = performance.now();
    while (window.__surdetDebug?.position?.sceneId === undefined) {
      if (performance.now() > positionDeadline) throw new Error('入口场景位置未在诊断窗口内可观测');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    positionReadyAt = performance.now();
    return {
      elapsed: nextFrameAt - startedAt,
      diagnostics: {
        titleSelectMs: titleSelectDoneAt - startedAt,
        positionReadyMs: positionReadyAt - startedAt,
        nextFrameMs: nextFrameAt - startedAt,
        positionWaitAfterCommandMs: Math.max(0, positionReadyAt - titleSelectDoneAt),
      },
    };
  });
}

async function collectLaunchSample(workspaceRoot, role, pair) {
  const shellDir = path.join(workspaceRoot, 'packages', 'shell');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v3-ab-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, '临时根目录');
  assertUnder(tempRoot, userData, 'Electron userData');
  let app = null;
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  try {
    const startedAt = performance.now();
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellDir });
    const page = await app.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));

    await page.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: readyTimeout });
    const coldStartMs = performance.now() - startedAt;
    await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true, undefined, { timeout: readyTimeout });
    const assetReadyMs = performance.now() - startedAt;
    await page.waitForTimeout(50);

    // 每个 pair 都是隔离 userData 的独立启动；首个菜单动作只用于暖 UI 投影，不计入样本。
    await measureTitleSettings(page);
    await reloadForReady(page);
    const menuOpenP95Ms = await measureTitleSettings(page);
    await reloadForReady(page);
    const sceneMeasurement = await measureSceneStart(page);
    const assetLoading = await page.evaluate(() => ({ ...window.__surdetDebug.assetLoading }));
    return {
      pair,
      role,
      coldStartMs,
      assetReadyMs,
      menuOpenP95Ms,
      sceneP95Ms: sceneMeasurement.elapsed,
      sceneDiagnostics: sceneMeasurement.diagnostics,
      assetLoading,
      errors: {
        page: [...pageErrors],
        console: [...consoleErrors],
        failedRequests: [...failedRequests],
      },
    };
  } finally {
    try {
      if (app) await app.close();
    } finally {
      assertUnder(os.tmpdir(), tempRoot, '临时根目录');
      assertUnder(tempRoot, userData, 'Electron userData');
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function assertHealthy(sample, label) {
  const errors = sample.errors;
  if (sample.assetLoading.failed > 0 || errors.page.length > 0 || errors.console.length > 0 || errors.failedRequests.length > 0) {
    throw new Error(`${label} 不健康：${JSON.stringify(sample)}`);
  }
}

function rawSamples(samples, role) {
  const selected = samples.filter((sample) => sample.role === role).sort((a, b) => a.pair - b.pair);
  return {
    coldStartMs: selected.map((sample) => sample.coldStartMs),
    assetReadyMs: selected.map((sample) => sample.assetReadyMs),
    menuOpenP95Ms: selected.map((sample) => sample.menuOpenP95Ms),
    sceneP95Ms: selected.map((sample) => sample.sceneP95Ms),
  };
}

async function main() {
  const { baselineRoot, currentRoot, outputPath, pairCount } = parseArgs(process.argv.slice(2));
  const v3 = await import(url.pathToFileURL(v3ModulePath).href);
  const v2 = await import(url.pathToFileURL(v2ModulePath).href);
  const baselineCommit = gitSha(baselineRoot);
  const currentCommit = gitSha(currentRoot);
  const warmupOrder = ['baseline', 'current'];
  const sampledAt = new Date().toISOString();
  const warmups = [];
  for (const role of warmupOrder) {
    const root = role === 'baseline' ? baselineRoot : currentRoot;
    const sample = await collectLaunchSample(root, role, 0);
    assertHealthy(sample, `${role} warmup`);
    warmups.push(sample);
  }

  const rawLaunches = [];
  const executionOrder = [];
  for (let pair = 1; pair <= pairCount; pair += 1) {
    const firstRole = pair % 2 === 1 ? 'baseline' : 'current';
    const secondRole = firstRole === 'baseline' ? 'current' : 'baseline';
    for (const role of [firstRole, secondRole]) {
      executionOrder.push({ pair, role });
      const root = role === 'baseline' ? baselineRoot : currentRoot;
      const sample = await collectLaunchSample(root, role, pair);
      assertHealthy(sample, `${role} pair ${pair}`);
      rawLaunches.push(sample);
    }
  }

  const baseline = v3.buildRendererV3Run(baselineCommit, rawSamples(rawLaunches, 'baseline'));
  const current = v3.buildRendererV3Run(currentCommit, rawSamples(rawLaunches, 'current'));
  const baselineEnvironment = collectEnvironment(baselineRoot);
  const currentEnvironment = collectEnvironment(currentRoot);
  const result = v3.compareRendererBaselineV3({
    baselineCommit,
    currentCommit,
    pairCount,
    warmupOrder,
    executionOrder,
    baselineEnvironment,
    currentEnvironment,
    baseline,
    current,
  });
  const historical = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v2-cab200b.json'), 'utf8'));
  const historicalComparison = v2.compareRendererBaseline(
    {
      coldStartMs: historical.coldStartMs,
      assetReadyMs: historical.assetReadyMs,
      menuOpenP95Ms: historical.menuOpenP95Ms,
      sceneP95Ms: historical.sceneP95Ms,
    },
    {
      coldStartMs: current.metrics.coldStartMs.median,
      assetReadyMs: current.metrics.assetReadyMs.median,
      menuOpenP95Ms: current.metrics.menuOpenP95Ms.p95,
      sceneP95Ms: current.metrics.sceneP95Ms.p95,
    },
  );
  const output = {
    ...result,
    sampledAt,
    rebuiltAt: new Date().toISOString(),
    warmups,
    rawLaunches,
    health: {
      warmups: warmups.length,
      formalSamples: rawLaunches.length,
      assetsFailed: [...warmups, ...rawLaunches].reduce((sum, sample) => sum + Number(sample.assetLoading.failed ?? 0), 0),
      pageErrors: [...warmups, ...rawLaunches].reduce((sum, sample) => sum + sample.errors.page.length, 0),
      consoleErrors: [...warmups, ...rawLaunches].reduce((sum, sample) => sum + sample.errors.console.length, 0),
      failedRequests: [...warmups, ...rawLaunches].reduce((sum, sample) => sum + sample.errors.failedRequests.length, 0),
    },
    historicalComparison: {
      baselinePath: 'docs/baselines/renderer-v2-cab200b.json',
      baselineSha256: sha256File(path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v2-cab200b.json')),
      baselineSourceSha: historical.sourceSha,
      failures: historicalComparison.failures,
    },
  };
  validateRendererBaselineV3Artifact(output, { repositoryRoot, v3, v2 });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`已写入 Renderer v3 候选 A/B 基线：${outputPath}`);
  console.log(`pairCount=${pairCount} formalSamples=${rawLaunches.length} warmupOrder=${warmupOrder.join('->')}`);
  console.log(`baseline=${baselineCommit} current=${currentCommit}`);
  for (const metric of Object.values(result.comparison.metrics)) {
    console.log(`${metric.metric} ${metric.summaryStatistic} baseline=${metric.baselineSummary.toFixed(3)} current=${metric.currentSummary.toFixed(3)} gateRatio=${metric.gateRatio.toFixed(6)} pairedMedianRatio=${metric.pairedMedianRatio.toFixed(6)} limit=${metric.limit} ${metric.passed ? 'PASS' : 'FAIL'}`);
  }
  console.log(`historicalV2Failures=${historicalComparison.failures.map((item) => item.metric).join(',') || 'none'}`);
  if (result.comparison.failures.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
