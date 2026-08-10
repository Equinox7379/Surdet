import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { applyRendererStartupInstrumentation } from './renderer-startup-diagnostic-instrumentation.mjs';

const scriptPath = url.fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repositoryRoot = path.resolve(scriptDir, '../../..');
const diagnosticScript = path.join(scriptDir, 'renderer-startup-diagnostic.mjs');
const instrumentationScript = path.join(scriptDir, 'renderer-startup-diagnostic-instrumentation.mjs');
const defaultSampleCount = 10;

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

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['root', 'out', 'sample-count', 'instrumentation-out']);
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
  const instrumentationOutputPath = path.resolve(values.get('instrumentation-out') ?? path.join(os.tmpdir(), `surdet-renderer-startup-instrumentation-${process.pid}.json`));
  const sampleCount = Number(values.get('sample-count') ?? defaultSampleCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > defaultSampleCount) throw new Error(`sample-count 必须是 1-${defaultSampleCount} 的预声明整数`);
  return { root, outputPath, instrumentationOutputPath, sampleCount };
}

async function main() {
  const { root, outputPath, instrumentationOutputPath, sampleCount } = parseArgs(process.argv.slice(2));
  const instrumentation = applyRendererStartupInstrumentation(root);
  fs.mkdirSync(path.dirname(instrumentationOutputPath), { recursive: true });
  fs.writeFileSync(instrumentationOutputPath, `${JSON.stringify(instrumentation, null, 2)}\n`, 'utf8');
  runNpm(root, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  runNpm(root, ['run', 'build']);
  const result = spawnSync(process.execPath, [
    diagnosticScript,
    '--root', root,
    '--out', outputPath,
    '--sample-count', String(sampleCount),
    '--instrumentation-manifest', instrumentationOutputPath,
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
