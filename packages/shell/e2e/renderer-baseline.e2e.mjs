import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { parseRendererBaselineArgs } from './renderer-baseline-options.mjs';

const shellDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(shellDir, '../..');
const sampleCount = 5;
const readyTimeout = 120000;

function readPackageVersion(packageName) {
  const packagePath = path.join(repositoryRoot, 'node_modules', ...packageName.split('/'), 'package.json');
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

function gitSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function assertUnder(parent, candidate, label) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${parentPath} 下：${candidatePath}`);
  }
}

function listFiles(root, base = root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, base));
    else if (entry.isFile()) files.push({ path: path.relative(base, full).replace(/\\/g, '/'), bytes: fs.statSync(full).size });
  }
  return files;
}

function collectBundleSnapshot() {
  const roots = [
    path.join(repositoryRoot, 'packages', 'shell', 'dist'),
    path.join(repositoryRoot, 'examples', 'starter', 'dist'),
  ];
  const files = {};
  for (const root of roots) {
    for (const file of listFiles(root)) {
      const relativeRoot = path.relative(repositoryRoot, root).replace(/\\/g, '/');
      files[`${relativeRoot}/${file.path}`] = file.bytes;
    }
  }
  return {
    totalBytes: Object.values(files).reduce((sum, bytes) => sum + bytes, 0),
    files,
  };
}

function summarizeMetric(name, samples) {
  const sorted = [...samples].map((value) => Number(value)).sort((a, b) => a - b);
  if (sorted.length < sampleCount || sorted.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`指标 ${name} 至少需要 ${sampleCount} 个非负有限样本`);
  }
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    name,
    samples: sorted,
    median,
    p95: sorted[p95Index],
    summaryStatistic: name === 'coldStartMs' || name === 'assetReadyMs' ? 'median' : 'p95',
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
  const elapsed = await page.evaluate(async () => {
    const startedAt = performance.now();
    await window.__surdetDebug.titleSelect('new');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - startedAt;
  });
  await page.waitForFunction(() => window.__surdetDebug?.position?.sceneId !== undefined, undefined, { timeout: 10000 });
  return elapsed;
}

async function readDebug(page) {
  return page.evaluate(() => {
    const debug = window.__surdetDebug;
    return {
      sessionId: typeof debug.sessionId === 'string' ? debug.sessionId : null,
      resourceIds: debug.resourceIds ?? null,
      fontFamilies: debug.fontFamilies ?? null,
      activeBlobUrls: typeof debug.activeBlobUrls === 'number' ? debug.activeBlobUrls : null,
      status: typeof debug.status === 'string' ? debug.status : null,
      rendererStatus: typeof debug.rendererStatus === 'string' ? debug.rendererStatus : null,
      position: debug.position ?? null,
      assetLoading: debug.assetLoading ?? null,
      resourceSnapshot: debug.resourceSnapshot ?? null,
      rawMetrics: debug.metrics ?? null,
    };
  });
}

async function captureVisual(page, id) {
  const image = await page.screenshot({ type: 'png' });
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  return {
    id,
    sha256: crypto.createHash('sha256').update(image).digest('hex'),
    width: viewport.width,
    height: viewport.height,
  };
}

async function collectLaunchSample({ captureVisuals }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-baseline-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, '临时根目录');
  assertUnder(tempRoot, userData, 'Electron userData');
  let app = null;
  const pageErrors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const failedRequests = [];

  try {
    const startedAt = performance.now();
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellDir });
    const page = await app.firstWindow();
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error') consoleErrors.push(text);
      else if (message.type() === 'warning') consoleWarnings.push(text);
    });
    page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));

    await page.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: readyTimeout });
    const coldStartMs = performance.now() - startedAt;
    await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true, undefined, { timeout: readyTimeout });
    const assetReadyMs = performance.now() - startedAt;
    await page.waitForTimeout(50);

    const titleVisual = captureVisuals ? await captureVisual(page, 'title') : null;
    // 每个独立 Electron 正式样本先丢弃一次菜单动作，隔离首个 UI 投影的冷路径抖动。
    await measureTitleSettings(page);
    await reloadForReady(page);
    const menuOpenMs = await measureTitleSettings(page);
    await reloadForReady(page);
    const sceneTransitionMs = await measureSceneStart(page);
    const storyVisual = captureVisuals ? await captureVisual(page, 'story-entry') : null;
    const finalDebug = await readDebug(page);
    return {
      coldStartMs,
      assetReadyMs,
      menuOpenMs,
      sceneTransitionMs,
      titleVisual,
      storyVisual,
      finalDebug,
      assetLoading: finalDebug?.assetLoading ?? { total: 0, completed: 0, failed: 0 },
      errors: {
        page: [...pageErrors],
        console: [...consoleErrors],
        warnings: [...consoleWarnings],
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
  const { errors } = sample;
  if (errors.page.length > 0 || errors.console.length > 0 || errors.failedRequests.length > 0 || sample.assetLoading.failed > 0) {
    throw new Error(`${label} 包含素材、页面、控制台或请求失败：${JSON.stringify({
      assetsFailed: sample.assetLoading.failed,
      pageErrors: errors.page,
      consoleErrors: errors.console,
      failedRequests: errors.failedRequests,
    })}`);
  }
}

async function main() {
  const { outputPath, sourceEquivalentTo } = parseRendererBaselineArgs(process.argv.slice(2), repositoryRoot);

  // 暖机启动使用独立 Electron 和独立临时 userData，但不进入正式统计样本。
  const warmup = await collectLaunchSample({ captureVisuals: false });
  assertHealthy(warmup, 'Renderer 基线暖机');

  const samples = [];
  for (let index = 0; index < sampleCount; index++) {
    const sample = await collectLaunchSample({ captureVisuals: index === 0 });
    assertHealthy(sample, `Renderer 基线正式样本 ${index + 1}`);
    samples.push(sample);
  }

  const coldMetric = summarizeMetric('coldStartMs', samples.map((sample) => sample.coldStartMs));
  const assetMetric = summarizeMetric('assetReadyMs', samples.map((sample) => sample.assetReadyMs));
  const menuMetric = summarizeMetric('menuOpenP95Ms', samples.map((sample) => sample.menuOpenMs));
  const sceneMetric = summarizeMetric('sceneP95Ms', samples.map((sample) => sample.sceneTransitionMs));
  const metrics = {
    coldStartMs: coldMetric,
    assetReadyMs: assetMetric,
    menuOpenP95Ms: menuMetric,
    sceneP95Ms: sceneMetric,
  };
  const finalSample = samples.at(-1);
  const finalDebug = finalSample.finalDebug;
  const assetLoading = finalSample.assetLoading;
  const resourceSnapshot = finalDebug?.resourceSnapshot ?? {
    disposed: false,
    tickerCallbacks: null,
    listeners: null,
    activeTweens: null,
    activeAsyncTasks: null,
    blobUrls: finalDebug?.activeBlobUrls ?? null,
    pooledObjects: {},
    displayObjectsByOwner: {},
  };
  const allErrors = [warmup, ...samples].flatMap((sample) => sample.errors);
  const baseline = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceSha: gitSha(),
    ...(sourceEquivalentTo === undefined ? {} : { sourceEquivalentTo }),
    environment: {
      node: process.version,
      npm: npmVersion(),
      os: `${os.platform()} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      electron: readPackageVersion('electron'),
      playwright: readPackageVersion('playwright'),
      buildMode: 'electron-dev-shell-starter',
    },
    coldStartMs: coldMetric.median,
    assetReadyMs: assetMetric.median,
    menuOpenP95Ms: menuMetric.p95,
    sceneP95Ms: sceneMetric.p95,
    metrics,
    assets: {
      total: Number(assetLoading.total ?? 0),
      completed: Number(assetLoading.completed ?? 0),
      failed: Number(assetLoading.failed ?? 0),
      durationMs: assetMetric.median,
    },
    resources: resourceSnapshot,
    performance: null,
    debug: {
      sessionId: finalDebug?.sessionId ?? null,
      resourceIds: finalDebug?.resourceIds ?? null,
      fontFamilies: finalDebug?.fontFamilies ?? null,
      activeBlobUrls: finalDebug?.activeBlobUrls ?? null,
      status: finalDebug?.status ?? null,
      rendererStatus: finalDebug?.rendererStatus ?? null,
      position: finalDebug?.position ?? null,
      rawMetrics: finalDebug?.rawMetrics ?? null,
    },
    measurementDefinitions: {
      startup: '暖机后，每个正式样本均由独立 Electron 启动和独立临时 userData 采集；coldStart/assetReady 保存 5 个原始样本，顶层使用中位数。',
      menuOpen: '每个独立 Electron 正式样本先执行一次不计入统计的设置动作并重新加载，再测量 __surdetDebug.titleSelect("settings") 到下一帧提交的耗时；顶层使用 5 个独立样本的 p95。',
      sceneTransition: '每个独立 Electron 样本在标题页调用 __surdetDebug.titleSelect("new") 到命令完成及下一次 requestAnimationFrame 回调的耗时；入口位置可观测性另做健康确认，不计入计时。顶层使用 5 个样本的 p95。',
    },
    bundle: {
      ...collectBundleSnapshot(),
      warnings: [...new Set(allErrors.flatMap((errors) => errors.warnings))],
    },
    errors: {
      page: allErrors.reduce((sum, errors) => sum + errors.page.length, 0),
      console: allErrors.reduce((sum, errors) => sum + errors.console.length, 0),
      failedRequests: allErrors.reduce((sum, errors) => sum + errors.failedRequests.length, 0),
      messages: allErrors.flatMap((errors) => [...errors.page, ...errors.console, ...errors.failedRequests]).slice(0, 100),
    },
    visual: {
      states: [samples[0].titleVisual, ...(samples[0].storyVisual ? [samples[0].storyVisual] : [])],
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`已写入 Renderer 基线：${outputPath}`);
  console.log(`warmup=1 independentLaunches=${sampleCount} coldMedian=${baseline.coldStartMs.toFixed(2)}ms assetMedian=${baseline.assetReadyMs.toFixed(2)}ms menuP95=${baseline.menuOpenP95Ms.toFixed(2)}ms sceneP95=${baseline.sceneP95Ms.toFixed(2)}ms`);
  console.log(`coldSamples=${coldMetric.samples.map((value) => value.toFixed(2)).join(',')} assetSamples=${assetMetric.samples.map((value) => value.toFixed(2)).join(',')}`);
  console.log(`assets=${baseline.assets.completed}/${baseline.assets.total} failed=${baseline.assets.failed} pageErrors=${baseline.errors.page} consoleErrors=${baseline.errors.console} failedRequests=${baseline.errors.failedRequests}`);
  if (baseline.assets.failed > 0 || baseline.errors.page > 0 || baseline.errors.console > 0 || baseline.errors.failedRequests > 0) {
    throw new Error('Renderer 基线包含素材、页面、控制台或请求失败，不能作为绿色基线');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
