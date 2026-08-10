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
const defaultSampleCount = 10;
const nominalFrameBudgetMs = 16.67;

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
  const roots = {
    m75: path.resolve(values.get('m75-root') ?? ''),
    originalM8: path.resolve(values.get('original-m8-root') ?? ''),
    currentM8: path.resolve(values.get('current-m8-root') ?? ''),
  };
  const outputPath = path.resolve(values.get('out') ?? path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-menu-diagnostic-2026-08-10.json'));
  const sampleCount = Number(values.get('sample-count') ?? defaultSampleCount);
  for (const [role, root] of Object.entries(roots)) {
    if (!fs.existsSync(path.join(root, 'packages', 'shell', 'dist'))) throw new Error(`${role} 缺少 shell/dist：${root}`);
    if (!fs.existsSync(path.join(root, 'examples', 'starter', 'dist'))) throw new Error(`${role} 缺少 starter/dist：${root}`);
  }
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('sample-count 必须是正整数');
  assertUnder(repositoryRoot, outputPath, '输出路径');
  return { roots, outputPath, sampleCount };
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

async function measureSettings(page) {
  return page.evaluate(async ({ frameBudgetMs }) => {
    const startedAt = performance.now();
    const operation = window.__surdetDebug.titleSelect('settings');
    const syncDoneAt = performance.now();
    const diagnostic = window.__surdetDebug.menuDiagnostic;
    const nextFrameAt = await new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    await operation;
    if (!diagnostic || typeof diagnostic.projectionCommitMs !== 'number') {
      throw new Error('menuDiagnostic 未提供 projectionCommitMs；临时探针没有进入实际入口');
    }
    const syncCommandMs = syncDoneAt - startedAt;
    const commandToNextRafMs = nextFrameAt - syncDoneAt;
    const totalToNextRafMs = nextFrameAt - startedAt;
    return {
      syncCommandMs,
      projectionCommitMs: diagnostic.projectionCommitMs,
      commandToNextRafMs,
      totalToNextRafMs,
      missedFrame: totalToNextRafMs > frameBudgetMs,
      frameBudgetMs,
    };
  }, { frameBudgetMs: nominalFrameBudgetMs });
}

async function collectSample(workspaceRoot, role, ordinal, sequenceIndex, warmup) {
  const shellRoot = path.join(workspaceRoot, 'packages', 'shell');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v3-menu-'));
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
    const metrics = await measureSettings(page);
    const assetLoading = await page.evaluate(() => ({ ...window.__surdetDebug.assetLoading }));
    const sample = {
      role,
      ordinal,
      sequenceIndex,
      warmup,
      metrics,
      assetLoading,
      errors: {
        page: [...pageErrors],
        console: [...consoleErrors],
        failedRequests: [...failedRequests],
      },
    };
    if (sample.assetLoading.failed > 0 || sample.errors.page.length > 0 || sample.errors.console.length > 0 || sample.errors.failedRequests.length > 0) {
      throw new Error(`${role} menu diagnostic ${ordinal} 不健康：${JSON.stringify(sample)}`);
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

function summarize(samples) {
  const metrics = samples.map((sample) => sample.metrics);
  const metric = (name) => metrics.map((value) => value[name]);
  return {
    sampleCount: samples.length,
    syncCommandMedianMs: percentile(metric('syncCommandMs'), 0.5),
    syncCommandP95Ms: percentile(metric('syncCommandMs'), 0.95),
    projectionCommitMedianMs: percentile(metric('projectionCommitMs'), 0.5),
    projectionCommitP95Ms: percentile(metric('projectionCommitMs'), 0.95),
    commandToNextRafMedianMs: percentile(metric('commandToNextRafMs'), 0.5),
    commandToNextRafP95Ms: percentile(metric('commandToNextRafMs'), 0.95),
    totalToNextRafMedianMs: percentile(metric('totalToNextRafMs'), 0.5),
    totalToNextRafP95Ms: percentile(metric('totalToNextRafMs'), 0.95),
    missedFrameCount: metrics.filter((value) => value.missedFrame).length,
    missedFrameRate: metrics.filter((value) => value.missedFrame).length / metrics.length,
  };
}

async function main() {
  const { roots, outputPath, sampleCount } = parseArgs(process.argv.slice(2));
  const roles = ['m75', 'originalM8', 'currentM8'];
  const executionOrder = [];
  const warmups = [];
  const rawSamples = [];
  let sequenceIndex = 0;

  for (const role of roles) {
    sequenceIndex += 1;
    executionOrder.push({ sequenceIndex, ordinal: 0, role, warmup: true });
    warmups.push(await collectSample(roots[role], role, 0, sequenceIndex, true));
  }

  for (let ordinal = 1; ordinal <= sampleCount; ordinal += 1) {
    const roundRoles = ordinal % 2 === 1
      ? ['m75', 'originalM8', 'currentM8']
      : ['currentM8', 'originalM8', 'm75'];
    for (const role of roundRoles) {
      sequenceIndex += 1;
      executionOrder.push({ sequenceIndex, ordinal, role, warmup: false });
      rawSamples.push(await collectSample(roots[role], role, ordinal, sequenceIndex, false));
    }
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    protocol: {
      sampleCountPerRole: sampleCount,
      warmupsPerRole: 1,
      roleCount: roles.length,
      executionOrder: 'odd rounds m75 -> originalM8 -> currentM8; even rounds currentM8 -> originalM8 -> m75',
      isolatedUserData: true,
      fixedFrameBudgetMs: nominalFrameBudgetMs,
      missedFrameDefinition: `totalToNextRafMs > ${nominalFrameBudgetMs}ms`,
      noFormalGateRebuild: true,
      diagnosticOnly: true,
    },
    environment: Object.fromEntries(roles.map((role) => [role, collectEnvironment(roots[role])])),
    source: Object.fromEntries(roles.map((role) => [role, gitSha(roots[role])])),
    summaries: Object.fromEntries(roles.map((role) => [role, summarize(rawSamples.filter((sample) => sample.role === role))])),
    warmups,
    executionOrder,
    rawSamples,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`已写入菜单尾延迟诊断：${outputPath}`);
  console.log(JSON.stringify(output.summaries, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
