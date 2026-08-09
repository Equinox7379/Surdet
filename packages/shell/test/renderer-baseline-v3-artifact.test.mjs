import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as v2 from '../../renderer/src/diagnostics/renderer-baseline.js';
import * as v3 from '../../renderer/src/diagnostics/renderer-baseline-v3.js';
import {
  rebuildRendererBaselineV3Artifact,
  validateRendererBaselineV3Artifact,
} from '../e2e/renderer-baseline-v3-artifact.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const candidatePath = path.join(repositoryRoot, 'docs/baselines/renderer-v3-candidate-2026-08-09.json');

function candidate() {
  return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
}

describe('renderer baseline v3 artifact evidence', () => {
  it('cross-validates the candidate against the exact historical v2 file', () => {
    expect(() => validateRendererBaselineV3Artifact(candidate(), { repositoryRoot, v3, v2 })).not.toThrow();
  });

  it.each([
    ['historical hash', (value) => { value.historicalComparison.baselineSha256 = 'f'.repeat(64); }],
    ['historical source', (value) => { value.historicalComparison.baselineSourceSha = 'f'.repeat(40); }],
    ['historical failures', (value) => { value.historicalComparison.failures = []; }],
    ['historical path', (value) => { value.historicalComparison.baselinePath = 'docs/baselines/other.json'; }],
  ])('rejects tampered historical evidence: %s', (_label, mutate) => {
    const value = candidate();
    mutate(value);
    expect(() => validateRendererBaselineV3Artifact(value, { repositoryRoot, v3, v2 })).toThrow();
  });

  it.each([
    ['completed=0', (value) => { value.rawLaunches[0].assetLoading.completed = 0; }],
    ['completed<total', (value) => { value.rawLaunches[0].assetLoading.completed = value.rawLaunches[0].assetLoading.total - 1; }],
    ['total=0', (value) => { value.rawLaunches[0].assetLoading.total = 0; }],
    ['done=false', (value) => { value.rawLaunches[0].assetLoading.done = false; }],
    ['done deleted', (value) => { delete value.rawLaunches[0].assetLoading.done; }],
    ['failed>0', (value) => { value.rawLaunches[0].assetLoading.failed = 1; }],
  ])('rejects tampered asset completion evidence: %s', (_label, mutate) => {
    const value = candidate();
    mutate(value);
    expect(() => validateRendererBaselineV3Artifact(value, { repositoryRoot, v3, v2 })).toThrow();
  });

  it('preserves sampledAt while repeated offline rebuilds update only rebuiltAt', () => {
    const input = candidate();
    const packageLockSha256 = input.environment.baseline.packageLockSha256;
    const first = rebuildRendererBaselineV3Artifact(input, {
      repositoryRoot,
      v3,
      v2,
      packageLockSha256,
      sampledAt: '2026-08-09T13:31:47.300Z',
      rebuiltAt: '2026-08-09T14:00:00.000Z',
    });
    const second = rebuildRendererBaselineV3Artifact(first, {
      repositoryRoot,
      v3,
      v2,
      packageLockSha256,
      rebuiltAt: '2026-08-09T14:01:00.000Z',
    });

    expect(first.sampledAt).toBe('2026-08-09T13:31:47.300Z');
    expect(second.sampledAt).toBe(first.sampledAt);
    expect(first.rebuiltAt).toBe('2026-08-09T14:00:00.000Z');
    expect(second.rebuiltAt).toBe('2026-08-09T14:01:00.000Z');
    expect(() => validateRendererBaselineV3Artifact(second, { repositoryRoot, v3, v2 })).not.toThrow();
  });
});
