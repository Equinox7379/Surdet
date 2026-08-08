import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { parseRendererBaselineArgs } from '../../packages/shell/e2e/renderer-baseline-options.mjs';

const root = 'E:/surdet';

test('requires an output path and omits source equivalence by default', () => {
  assert.throws(() => parseRendererBaselineArgs([], root), /--out/);
  const parsed = parseRendererBaselineArgs(['--out', 'docs/baselines/current.json'], root);
  assert.equal(parsed.outputPath, path.resolve(root, 'docs/baselines/current.json'));
  assert.equal(parsed.sourceEquivalentTo, undefined);
});

test('accepts only a complete 40-character source equivalence SHA', () => {
  const sha = 'CAB200B5AAED49B053B18FF05907AAC4D02FB731';
  const parsed = parseRendererBaselineArgs(['--out', 'current.json', '--source-equivalent-to', sha], root);
  assert.equal(parsed.sourceEquivalentTo, sha.toLowerCase());
  assert.throws(
    () => parseRendererBaselineArgs(['--out', 'current.json', '--source-equivalent-to', 'a'.repeat(39)], root),
    /40 位 SHA/,
  );
  assert.throws(
    () => parseRendererBaselineArgs(['--out', 'current.json', '--source-equivalent-to', 'g'.repeat(40)], root),
    /40 位 SHA/,
  );
});
