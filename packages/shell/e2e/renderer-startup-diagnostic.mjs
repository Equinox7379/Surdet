import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import {
  validateRendererStartupDiagnosticSnapshot,
} from './renderer-startup-diagnostic-instrumentation.mjs';

const scriptPath = url.fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repositoryRoot = path.resolve(scriptDir, '../../..');
const readyTimeout = 120000;
const defaultSampleCount = 10;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function gitSha(workspaceRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8', shell: false }).trim();
}

function npmVersion() {
  try {
    const packagePath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function packageVersion(workspaceRoot, packageName) {
  try {
    const packagePath = path.join(workspaceRoot, 'node_modules', ...packageName.split('/'), 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['root', 'out', 'sample-count', 'instrumentation-manifest']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || !allowed.has(argument.slice(2))) throw new Error(`未知参数：${argument}`);
    const name = argument.slice(2);
    if (values.has(name)) throw new Error(`参数只能出现一次：--${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${name}`);
    values.set(name, value);
    index += 1;
  }
  const root = path.resolve(values.get('root') ?? '');
  const outputPath = path.resolve(values.get('out') ?? path.join(repositoryRoot, 'docs', 'baselines', 'renderer-startup-diagnostic-2026-08-10.json'));
  const sampleCount = Number(values.get('sample-count') ?? defaultSampleCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > defaultSampleCount) {
    throw new Error(`sample-count 必须是 1-${defaultSampleCount} 的预声明整数`);
  }
  if (!fs.existsSync(path.join(root, 'packages', 'shell', 'dist'))) throw new Error(`root 缺少 packages/shell/dist：${root}`);
  if (!fs.existsSync(path.join(root, 'examples', 'starter', 'dist'))) throw new Error(`root 缺少 examples/starter/dist：${root}`);
  const instrumentationManifestPath = values.has('instrumentation-manifest')
    ? path.resolve(values.get('instrumentation-manifest'))
    : null;
  if (instrumentationManifestPath && !fs.existsSync(instrumentationManifestPath)) {
    throw new Error(`instrumentation manifest 不存在：${instrumentationManifestPath}`);
  }
  return { root, outputPath, sampleCount, instrumentationManifestPath };
}

function isoNow() {
  return new Date().toISOString();
}

function hostStamp() {
  return { at: isoNow(), monotonicMs: performance.now() };
}

function duration(start, end) {
  return end.monotonicMs - start.monotonicMs;
}

function assertUnder(parent, candidate, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${path.resolve(parent)} 内：${path.resolve(candidate)}`);
  }
}

async function waitForDiagnostic(page) {
  await page.waitForFunction(() => window.__surdetRendererStartupDiagnostic !== undefined, undefined, { timeout: readyTimeout });
  await page.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: readyTimeout });
}

async function collectSample(workspaceRoot, ordinal) {
  const shellRoot = path.join(workspaceRoot, 'packages', 'shell');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-startup-diagnostic-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, '诊断临时根目录');
  assertUnder(tempRoot, userData, '诊断 userData');
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  let app = null;
  const launchStarted = hostStamp();
  let sample;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellRoot });
    const electronLaunchResolved = hostStamp();
    const page = await app.firstWindow();
    const firstWindowResolved = hostStamp();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));
    await waitForDiagnostic(page);
    const debugObserved = hostStamp();
    await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true, undefined, { timeout: readyTimeout });
    const assetDoneObserved = hostStamp();
    const diagnostic = await page.evaluate(() => window.__surdetRendererStartupDiagnostic.getSnapshot());
    validateRendererStartupDiagnosticSnapshot(diagnostic);
    const assetLoading = await page.evaluate(() => ({ ...window.__surdetDebug.assetLoading }));
    const errors = {
      page: [...pageErrors],
      console: [...consoleErrors],
      failedRequests: [...failedRequests],
    };
    const health = {
      assetsFailed: assetLoading.failed,
      pageErrors: errors.page.length,
      consoleErrors: errors.console.length,
      failedRequests: errors.failedRequests.length,
    };
    sample = {
      ordinal,
      hostTimestamps: {
        hostLaunchStartedAt: launchStarted,
        electronLaunchResolvedAt: electronLaunchResolved,
        firstWindowResolvedAt: firstWindowResolved,
        debugObservedAt: debugObserved,
        assetDoneObservedAt: assetDoneObserved,
      },
      hostDurations: {
        hostLaunchToFirstWindowMs: duration(launchStarted, firstWindowResolved),
        hostFirstWindowToDebugMs: duration(firstWindowResolved, debugObserved),
        hostDebugToAssetDoneMs: duration(debugObserved, assetDoneObserved),
      },
      page: diagnostic,
      observer: {
        hostDebugToAssetDoneMs: duration(debugObserved, assetDoneObserved),
        pageDebugToAssetDoneMs: diagnostic.derived.debugToAssetDoneMs,
        lagMs: diagnostic.derived.debugToAssetDoneMs === null
          ? null
          : duration(debugObserved, assetDoneObserved) - diagnostic.derived.debugToAssetDoneMs,
      },
      v3Compatible: {
        coldStartMs: duration(launchStarted, debugObserved),
        assetReadyMs: duration(launchStarted, assetDoneObserved),
        menuOpenP95Ms: null,
        sceneP95Ms: null,
      },
      assetLoading,
      health,
      errors,
    };
    if (assetLoading.total <= 0 || assetLoading.completed !== assetLoading.total || assetLoading.failed !== 0 || assetLoading.done !== true) {
      throw new Error(`诊断样本素材状态不健康：${JSON.stringify(sample)}`);
    }
    if (errors.page.length > 0 || errors.console.length > 0 || errors.failedRequests.length > 0) {
      throw new Error(`诊断样本运行时不健康：${JSON.stringify(sample)}`);
    }
    return sample;
  } catch (error) {
    return {
      ordinal,
      failed: true,
      failure: { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null },
      errors: { page: [...pageErrors], console: [...consoleErrors], failedRequests: [...failedRequests] },
    };
  } finally {
    try {
      if (app) await app.close();
    } finally {
      const processCloseCompleted = hostStamp();
      if (sample) sample.hostTimestamps.processCloseCompletedAt = processCloseCompleted;
      assertUnder(os.tmpdir(), tempRoot, '诊断临时根目录');
      assertUnder(tempRoot, userData, '诊断 userData');
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const { root, outputPath, sampleCount, instrumentationManifestPath } = parseArgs(process.argv.slice(2));
  const samples = [];
  for (let ordinal = 1; ordinal <= sampleCount; ordinal += 1) samples.push(await collectSample(root, ordinal));
  const output = {
    schemaVersion: 1,
    artifactKind: 'renderer-startup-resource-diagnostic',
    generatedAt: isoNow(),
    sourceCommit: gitSha(root),
    environment: {
      node: process.version,
      npm: npmVersion(),
      os: `${os.platform()} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      electron: packageVersion(root, 'electron'),
      playwright: packageVersion(root, 'playwright'),
      packageLockSha256: sha256File(path.join(root, 'package-lock.json')),
      buildMode: 'electron-dev-shell-starter-diagnostic-only',
    },
    protocol: {
      sampleCount,
      isolatedUserData: true,
      noParallelElectron: true,
      noFormalGate: true,
      diagnosticOnly: true,
    },
    instrumentation: instrumentationManifestPath
      ? JSON.parse(fs.readFileSync(instrumentationManifestPath, 'utf8'))
      : null,
    samples,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`已写入启动/资源阶段诊断：${outputPath}`);
  if (samples.some((sample) => sample.failed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
