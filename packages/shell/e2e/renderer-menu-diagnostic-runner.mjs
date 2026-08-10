import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { applyMenuDiagnosticInstrumentation } from './renderer-menu-diagnostic-instrumentation.mjs';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../../..');
const diagnosticScript = path.join(scriptDir, 'renderer-menu-diagnostic.mjs');
const instrumentationScript = path.join(scriptDir, 'renderer-menu-diagnostic-instrumentation.mjs');
const defaultSampleCount = 10;

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['m75-root', 'original-m8-root', 'current-m8-root', 'out', 'sample-count']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || !allowed.has(argument.slice(2))) throw new Error('未知参数：' + argument);
    const name = argument.slice(2);
    if (values.has(name)) throw new Error('参数只能出现一次：--' + name);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('参数缺少值：--' + name);
    values.set(name, value);
    index += 1;
  }
  const roots = {
    m75: path.resolve(values.get('m75-root') ?? ''),
    originalM8: path.resolve(values.get('original-m8-root') ?? ''),
    currentM8: path.resolve(values.get('current-m8-root') ?? ''),
  };
  const outputPath = path.resolve(values.get('out') ?? path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-menu-diagnostic-repro-2026-08-10.json'));
  const sampleCount = Number(values.get('sample-count') ?? defaultSampleCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('sample-count 必须是正整数');
  if (!Number.isInteger(sampleCount) || sampleCount > defaultSampleCount) throw new Error('本 runner 最多执行预声明的 10 个正式样本');
  if (!fs.existsSync(path.join(repositoryRoot, 'package-lock.json'))) throw new Error('当前仓库缺少 package-lock.json');
  return { roots, outputPath, sampleCount };
}

function npmCommand() {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return { executable: process.execPath, prefix: [npmCli] };
}

function runNpm(root, args) {
  const command = npmCommand();
  execFileSync(command.executable, [...command.prefix, ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
}

function assertSameLockfile(instrumentation) {
  const values = new Set(Object.values(instrumentation).map((value) => value.lockfileSha256.toLowerCase()));
  if (values.size !== 1) {
    throw new Error('三个 worktree 的 package-lock 字节 SHA 不一致：' + JSON.stringify(instrumentation));
  }
}

async function main() {
  const { roots, outputPath, sampleCount } = parseArgs(process.argv.slice(2));
  const roles = ['m75', 'originalM8', 'currentM8'];
  const instrumentation = {};
  for (const role of roles) {
    const root = roots[role];
    instrumentation[role] = applyMenuDiagnosticInstrumentation(root);
    runNpm(root, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    runNpm(root, ['run', 'build']);
  }
  assertSameLockfile(instrumentation);

  const manifest = {
    schemaVersion: 1,
    runnerScriptPath: 'packages/shell/e2e/renderer-menu-diagnostic-runner.mjs',
    buildCommand: ['npm', 'run', 'build'],
    installCommand: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    sampleCount,
    roles,
    instrumentationScript: {
      path: path.relative(repositoryRoot, instrumentationScript).replace(/\\/g, '/'),
      sha256: instrumentation.m75.instrumentationScriptSha256,
    },
    worktrees: instrumentation,
  };
  const manifestPath = path.join(os.tmpdir(), 'surdet-menu-diagnostic-instrumentation-' + process.pid + '-' + Date.now() + '.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  try {
    const args = [
      diagnosticScript,
      '--m75-root', roots.m75,
      '--original-m8-root', roots.originalM8,
      '--current-m8-root', roots.currentM8,
      '--sample-count', String(sampleCount),
      '--out', outputPath,
      '--instrumentation-manifest', manifestPath,
    ];
    const result = spawnSync(process.execPath, args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(manifestPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
