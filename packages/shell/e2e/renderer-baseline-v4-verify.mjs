import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRendererBaselineV4Artifact } from './renderer-baseline-v4-artifact.mjs';

function parseArgs(argv) {
  let artifactPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--artifact') throw new Error(`未知参数：${argument}`);
    if (artifactPath !== undefined) throw new Error('--artifact 只能出现一次');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--artifact 缺少值');
    artifactPath = path.resolve(value);
    index += 1;
  }
  if (artifactPath === undefined) throw new Error('必须显式提供 --artifact <path>');
  return { artifactPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const { artifactPath } = parseArgs(process.argv.slice(2));
    const value = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    validateRendererBaselineV4Artifact(value);
    console.log(JSON.stringify({ valid: true, group: value.group, status: value.qualification.status }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}

export { parseArgs as parseRendererBaselineV4VerifyArgs };
