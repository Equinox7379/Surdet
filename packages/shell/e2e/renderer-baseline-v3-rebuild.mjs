import fs from 'node:fs';
import path from 'node:path';
import * as url from 'node:url';
import {
  readSampledAtFromFrozenCandidate,
  rebuildRendererBaselineV3Artifact,
} from './renderer-baseline-v3-artifact.mjs';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../../..');
const candidatePath = path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-candidate-2026-08-09.json');
const v3ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline-v3.js');
const v2ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline.js');
const packageLockSha256 = process.argv[2];
if (!/^[0-9a-f]{64}$/i.test(packageLockSha256 ?? '')) {
  throw new Error('离线重建必须显式提供采样 worktree 的 package-lock SHA-256：node ... <64位SHA>');
}

const v3 = await import(url.pathToFileURL(v3ModulePath).href);
const v2 = await import(url.pathToFileURL(v2ModulePath).href);
const input = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const sampledAt = input.sampledAt ?? readSampledAtFromFrozenCandidate(repositoryRoot);
const output = rebuildRendererBaselineV3Artifact(input, {
  repositoryRoot,
  v3,
  v2,
  packageLockSha256,
  sampledAt,
});
fs.writeFileSync(candidatePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`已按 rawLaunches 离线重建：${candidatePath}`);
for (const metric of Object.values(output.comparison.metrics)) {
  console.log(`${metric.metric} gateRatio=${metric.gateRatio.toFixed(6)} pairedMedianRatio=${metric.pairedMedianRatio.toFixed(6)} ${metric.passed ? 'PASS' : 'FAIL'}`);
}
console.log(`historicalV2Failures=${output.historicalComparison.failures.map((item) => item.metric).join(',') || 'none'}`);
console.log(`sampledAt=${output.sampledAt}`);
console.log(`rebuiltAt=${output.rebuiltAt}`);
