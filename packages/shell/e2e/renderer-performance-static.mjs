import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as url from 'node:url';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../../..');
const defaultRoots = {
  m0: path.join(process.env.TEMP ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp'), 'surdet-m7-5-v3-20260809-1', 'baseline'),
  current: path.join(process.env.TEMP ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp'), 'surdet-m7-5-v3-20260809-1', 'current'),
  m6: path.join(process.env.TEMP ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp'), 'surdet-m7-ab-20260809-2', 'm6'),
  m7: path.join(process.env.TEMP ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp'), 'surdet-m7-ab-20260809-2', 'm7'),
};
const tokens = ['summarizeRendererMetricV3', 'pairedMedianRatio', 'packageLockSha256', 'historicalComparison', '__surdetDebug'];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function gitSha(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function bundle(root) {
  const files = fs.readdirSync(path.join(root, 'examples', 'starter', 'dist', 'assets'))
    .filter((name) => /^index-.*\.js$/.test(name));
  if (files.length !== 1) throw new Error(`${root} 的 starter 主 bundle 数量不是 1：${files.join(',')}`);
  const filePath = path.join(root, 'examples', 'starter', 'dist', 'assets', files[0]);
  const text = fs.readFileSync(filePath, 'utf8');
  return {
    file: path.relative(root, filePath).replaceAll('\\', '/'),
    bytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
    tokenPresence: Object.fromEntries(tokens.map((token) => [token, text.includes(token)])),
  };
}

function diffFiles(from, to) {
  return execFileSync('git', ['diff', '--name-only', `${gitSha(from)}..${gitSha(to)}`, '--', 'packages/renderer/src', 'packages/shell/e2e', 'examples/starter/src'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim().split(/\r?\n/).filter(Boolean);
}

const roots = Object.fromEntries(Object.entries(defaultRoots).map(([name, root]) => {
  if (!fs.existsSync(root)) throw new Error(`缺少性能静态检查 worktree：${root}`);
  return [name, root];
}));
const bundles = Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, { sourceSha: gitSha(root), ...bundle(root) }]));
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  roots,
  bundles,
  deltas: {
    m0ToCurrentBytes: bundles.current.bytes - bundles.m0.bytes,
    m6ToCurrentBytes: bundles.current.bytes - bundles.m6.bytes,
    m6ToM7Bytes: bundles.m7.bytes - bundles.m6.bytes,
    m7ToCurrentBytes: bundles.current.bytes - bundles.m7.bytes,
  },
  changedRuntimeFilesM0ToCurrent: diffFiles(roots.m0, roots.current),
  changedRuntimeFilesM6ToCurrent: diffFiles(roots.m6, roots.current),
  conclusion: {
    v3DiagnosticTokensInStarterBundle: bundles.current.tokenPresence.summarizeRendererMetricV3 === false
      && bundles.current.tokenPresence.pairedMedianRatio === false
      && bundles.current.tokenPresence.packageLockSha256 === false
      && bundles.current.tokenPresence.historicalComparison === false,
    debugProbePresentInM0AndCurrent: bundles.m0.tokenPresence.__surdetDebug === true
      && bundles.current.tokenPresence.__surdetDebug === true,
  },
};
const outputPath = path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-performance-static-2026-08-09.json');
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`已写入性能静态证据：${outputPath}`);
console.log(JSON.stringify({ bundles: output.bundles, deltas: output.deltas, conclusion: output.conclusion }, null, 2));
