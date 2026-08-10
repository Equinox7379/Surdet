import fs from 'node:fs';
import path from 'node:path';
import {
  validateRendererV4Artifact,
} from './renderer-baseline-v4.mjs';

export function validateRendererBaselineV4Artifact(value) {
  return validateRendererV4Artifact(value);
}

export function readRendererBaselineV4Artifact(filePath) {
  const absolutePath = path.resolve(filePath);
  const value = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  validateRendererBaselineV4Artifact(value);
  return value;
}

export function rebuildRendererBaselineV4Artifact(value, options = {}) {
  validateRendererBaselineV4Artifact(value);
  if (options.sampledAt !== undefined && options.sampledAt !== value.sampledAt) {
    throw new Error('离线 rebuild 不得修改 sampledAt');
  }
  if (typeof options.rebuiltAt !== 'string') throw new Error('离线 rebuild 必须显式提供 rebuiltAt');
  const rebuilt = JSON.parse(JSON.stringify(value));
  rebuilt.rebuiltAt = options.rebuiltAt;
  rebuilt.reportSha256 = options.reportSha256 ?? rebuilt.reportSha256;
  validateRendererBaselineV4Artifact(rebuilt);
  return rebuilt;
}

