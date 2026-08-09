import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as v2 from '../../renderer/src/diagnostics/renderer-baseline.js';
import * as v3 from '../../renderer/src/diagnostics/renderer-baseline-v3.js';
import { validateRendererBaselineV3Artifact } from '../e2e/renderer-baseline-v3-artifact.mjs';

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
});
