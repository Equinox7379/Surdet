import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { sha256File } from './renderer-baseline-v3-artifact.mjs';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(shellDir, '../..');
const readyTimeout = 120000;
const defaultSampleCount = 5;

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
  const outputPath = path.resolve(values.get('out') ?? path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-scene-diagnostic-2026-08-09.json'));
  const sampleCount = Number(values.get('sample-count') ?? defaultSampleCount);
  if (!fs.existsSync(path.join(baselineRoot, 'packages', 'shell', 'dist'))) throw new Error(`baseline-root 缺少 shell/dist：${baselineRoot}`);
  if (!fs.existsSync(path.join(currentRoot, 'packages', 'shell', 'dist'))) throw new Error(`current-root 缺少 shell/dist：${currentRoot}`);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('sample-count 必须是正整数');
  assertUnder(repositoryRoot, outputPath, '输出路径');
  return { baselineRoot, currentRoot, outputPath, sampleCount };
}

function assertUnder(parent, candidate, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${path.resolve(parent)} 下：${path.resolve(candidate)}`);
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
      formalSceneElapsedMs: nextFrameAt - startedAt,
      diagnostics: {
        titleSelectMs: titleSelectDoneAt - startedAt,
        positionReadyMs: positionReadyAt - startedAt,
        nextFrameMs: nextFrameAt - startedAt,
        positionWaitAfterCommandMs: Math.max(0, positionReadyAt - titleSelectDoneAt),
      },
    };
  });
}

async function collectSceneSample(workspaceRoot, role, ordinal) {
  const shellRoot = path.join(workspaceRoot, 'packages', 'shell');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v3-scene-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, '临时根目录');
  assertUnder(tempRoot, userData, 'Electron userData');
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  let app = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellRoot });
    const page = await app.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));
    await waitForReady(page);
    // 与正式 runner 相同：一次不计入统计的 UI 投影后重新加载，再执行场景探针。
    await measureTitleSettings(page);
    await reloadForReady(page);
    const scene = await measureSceneStart(page);
    const assetLoading = await page.evaluate(() => ({ ...window.__surdetDebug.assetLoading }));
    const sample = {
      role,
      ordinal,
      formalSceneElapsedMs: scene.formalSceneElapsedMs,
      diagnostics: scene.diagnostics,
      assetLoading,
      errors: {
        page: [...pageErrors],
        console: [...consoleErrors],
        failedRequests: [...failedRequests],
      },
    };
    if (sample.assetLoading.failed > 0 || sample.errors.page.length > 0 || sample.errors.console.length > 0 || sample.errors.failedRequests.length > 0) {
      throw new Error(`${role} diagnostic ${ordinal} 不健康：${JSON.stringify(sample)}`);
    }
    return sample;
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

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function summary(samples) {
  const values = samples.map((sample) => sample.formalSceneElapsedMs);
  return {
    sampleCount: values.length,
    sceneMedianMs: percentile(values, 0.5),
    sceneP95Ms: percentile(values, 0.95),
    titleSelectMedianMs: percentile(samples.map((sample) => sample.diagnostics.titleSelectMs), 0.5),
    positionReadyP95Ms: percentile(samples.map((sample) => sample.diagnostics.positionReadyMs), 0.95),
    positionWaitAfterCommandP95Ms: percentile(samples.map((sample) => sample.diagnostics.positionWaitAfterCommandMs), 0.95),
    nextFrameP95Ms: percentile(samples.map((sample) => sample.diagnostics.nextFrameMs), 0.95),
  };
}

async function main() {
  const { baselineRoot, currentRoot, outputPath, sampleCount } = parseArgs(process.argv.slice(2));
  const samples = [];
  const executionOrder = [];
  for (let ordinal = 1; ordinal <= sampleCount; ordinal += 1) {
    for (const [role, root] of [['baseline', baselineRoot], ['current', currentRoot]]) {
      executionOrder.push({ ordinal, role });
      samples.push(await collectSceneSample(root, role, ordinal));
    }
  }
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    probeDefinition: {
      formalScene: '从 titleSelect("new") 开始，到命令完成并提交下一帧；与 v2 等价。',
      position: 'position.sceneId 只作为健康确认，绝不进入 formalSceneElapsedMs。',
      probe: '对 baseline/current 使用完全相同的外部只读页面探针；内部 reset/load/start 没有公开端口，因此不伪造不可观测的私有阶段耗时。',
    },
    sampleCount,
    executionOrder,
    environment: {
      baseline: collectEnvironment(baselineRoot),
      current: collectEnvironment(currentRoot),
    },
    source: {
      baseline: gitSha(baselineRoot),
      current: gitSha(currentRoot),
    },
    summaries: {
      baseline: summary(samples.filter((sample) => sample.role === 'baseline')),
      current: summary(samples.filter((sample) => sample.role === 'current')),
    },
    rawSamples: samples,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`已写入场景定向诊断：${outputPath}`);
  console.log(JSON.stringify(output.summaries, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
