import fs from 'node:fs';
import path from 'node:path';
import * as url from 'node:url';
import { sha256File, validateRendererBaselineV3Artifact } from './renderer-baseline-v3-artifact.mjs';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../../..');
const allowedArtifactRoot = path.join(repositoryRoot, 'docs', 'baselines');
const v3ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline-v3.js');
const v2ModulePath = path.join(repositoryRoot, 'packages', 'renderer', 'dist', 'diagnostics', 'renderer-baseline.js');

function parseArgs(argv) {
  let artifactArgument = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--artifact') {
      throw new Error('未知参数或位置参数：' + argument);
    }
    if (artifactArgument !== null) {
      throw new Error('参数只能出现一次：--artifact');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('参数缺少值：--artifact');
    }
    artifactArgument = value;
    index += 1;
  }
  if (artifactArgument === null) {
    throw new Error('缺少必需参数：--artifact <path>');
  }
  return artifactArgument;
}

function resolveArtifactPath(argument) {
  const artifactPath = path.isAbsolute(argument)
    ? path.resolve(argument)
    : path.resolve(process.cwd(), argument);
  const relative = path.relative(allowedArtifactRoot, artifactPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('artifact 路径必须位于 ' + allowedArtifactRoot + ' 下：' + artifactPath);
  }
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    throw new Error('artifact 文件不存在：' + artifactPath);
  }
  return artifactPath;
}

function rawLaunchCount(artifact) {
  if (Array.isArray(artifact.rawLaunches)) return artifact.rawLaunches.length;
  if (artifact.rawLaunches && typeof artifact.rawLaunches === 'object') return Object.keys(artifact.rawLaunches).length;
  return 0;
}

async function main() {
  const artifactArgument = parseArgs(process.argv.slice(2));
  const artifactPath = resolveArtifactPath(artifactArgument);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const v3 = await import(url.pathToFileURL(v3ModulePath).href);
  const v2 = await import(url.pathToFileURL(v2ModulePath).href);

  validateRendererBaselineV3Artifact(artifact, { repositoryRoot, v3, v2 });

  const formalFailures = artifact.comparison.failures.map((item) => item.metric);
  const historicalFailures = artifact.historicalComparison.failures.map((item) => item.metric);
  console.log('artifactPath=' + artifactPath);
  console.log('artifactSha256=' + sha256File(artifactPath));
  console.log('baselineCommit=' + artifact.baselineCommit);
  console.log('currentCommit=' + artifact.currentCommit);
  console.log('pairCount=' + artifact.pairCount);
  console.log('rawLaunches=' + rawLaunchCount(artifact));
  console.log('formalFailures=' + (formalFailures.join(',') || 'none'));
  console.log('historicalFailures=' + (historicalFailures.join(',') || 'none'));
  console.log('VALID ARTIFACT');
  if (formalFailures.length > 0) {
    console.log('FORMAL GATE FAIL');
    process.exitCode = 2;
    return;
  }
  console.log('FORMAL GATE PASS');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
