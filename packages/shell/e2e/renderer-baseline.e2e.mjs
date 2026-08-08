import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

const shellDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(shellDir, '../..');
const sourceEquivalentTo = 'cab200b5aaed49b053b18ff05907aac4d02fb731';
const sampleCount = 5;
const readyTimeout = 120000;

function requireOutputPath(args) {
  const index = args.indexOf('--out');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error('必须显式指定输出路径：--out <path>');
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repositoryRoot, value);
}

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
  if (sorted.length === 0 || sorted.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`指标 ${name} 的样本必须是非负有限数`);
  }
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return { name, samples: sorted, median, p95: sorted[p95Index] };
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

async function main() {
  const outputPath = requireOutputPath(process.argv.slice(2));
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

    const titleVisual = await captureVisual(page, 'title');

    // 一个暖机样本不计入正式 p95 样本。
    await measureTitleSettings(page);
    await reloadForReady(page);
    await measureSceneStart(page);

    const menuSamples = [];
    for (let index = 0; index < sampleCount; index++) {
      await reloadForReady(page);
      menuSamples.push(await measureTitleSettings(page));
    }

    const sceneSamples = [];
    let storyVisual = null;
    let finalDebug = null;
    for (let index = 0; index < sampleCount; index++) {
      await reloadForReady(page);
      sceneSamples.push(await measureSceneStart(page));
      if (index === 0) storyVisual = await captureVisual(page, 'story-entry');
      finalDebug = await readDebug(page);
    }

    const coldMetric = summarizeMetric('coldStartMs', [coldStartMs]);
    const assetMetric = summarizeMetric('assetReadyMs', [assetReadyMs]);
    const menuMetric = summarizeMetric('menuOpenP95Ms', menuSamples);
    const sceneMetric = summarizeMetric('sceneP95Ms', sceneSamples);
    const metrics = {
      coldStartMs: coldMetric,
      assetReadyMs: assetMetric,
      menuOpenP95Ms: menuMetric,
      sceneP95Ms: sceneMetric,
    };
    const assetLoading = finalDebug?.assetLoading ?? { total: 0, completed: 0, failed: 0 };
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
    const baseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceSha: gitSha(),
      sourceEquivalentTo,
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
      coldStartMs: coldMetric.p95,
      assetReadyMs: assetMetric.p95,
      menuOpenP95Ms: menuMetric.p95,
      sceneP95Ms: sceneMetric.p95,
      metrics,
      assets: {
        total: Number(assetLoading.total ?? 0),
        completed: Number(assetLoading.completed ?? 0),
        failed: Number(assetLoading.failed ?? 0),
        durationMs: assetReadyMs,
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
        menuOpen: '标题页调用 __surdetDebug.titleSelect("settings") 到下一帧提交的耗时。',
        sceneTransition: '标题页调用 __surdetDebug.titleSelect("new") 到入口场景位置可观测且下一帧提交的耗时。',
      },
      bundle: {
        ...collectBundleSnapshot(),
        warnings: [...consoleWarnings],
      },
      errors: {
        page: pageErrors.length,
        console: consoleErrors.length,
        failedRequests: failedRequests.length,
        messages: [...pageErrors, ...consoleErrors, ...failedRequests].slice(0, 100),
      },
      visual: {
        states: [titleVisual, ...(storyVisual ? [storyVisual] : [])],
      },
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`已写入 Renderer 基线：${outputPath}`);
    console.log(`cold=${baseline.coldStartMs.toFixed(2)}ms asset=${baseline.assetReadyMs.toFixed(2)}ms menuP95=${baseline.menuOpenP95Ms.toFixed(2)}ms sceneP95=${baseline.sceneP95Ms.toFixed(2)}ms`);
    console.log(`assets=${baseline.assets.completed}/${baseline.assets.total} failed=${baseline.assets.failed} pageErrors=${baseline.errors.page} consoleErrors=${baseline.errors.console}`);
    if (baseline.assets.failed > 0 || baseline.errors.page > 0 || baseline.errors.console > 0 || baseline.errors.failedRequests > 0) {
      throw new Error('Renderer 基线包含素材、页面、控制台或请求失败，不能作为绿色基线');
    }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
