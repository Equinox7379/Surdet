import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(testPath), '..', '..');
const planPath = path.join(root, 'docs/superpowers/plans/2026-08-10-renderer-performance-measurement-qualification.md');
const specPath = path.join(root, 'docs/superpowers/specs/2026-08-10-renderer-performance-measurement-v4-protocol.md');
const files = [
  'packages/shell/e2e/renderer-baseline-v4.mjs',
  'packages/shell/e2e/renderer-baseline-v4-artifact.mjs',
  'packages/shell/e2e/renderer-baseline-v4-verify.mjs',
  'packages/shell/e2e/renderer-build-equivalence.mjs',
  'packages/shell/e2e/renderer-startup-diagnostic.mjs',
  'packages/shell/e2e/renderer-startup-diagnostic-runner.mjs',
  'packages/shell/e2e/renderer-v4-worktree.mjs',
  'packages/shell/e2e/renderer-v4-qualification-runner.mjs',
  'packages/shell/e2e/renderer-v4-qualification-summary.mjs',
];

test('qualification tooling resolves the repository from its module location', () => {
  assert.equal(fs.existsSync(path.join(root, 'package.json')), true);
  const source = fs.readFileSync(testPath, 'utf8');
  assert.doesNotMatch(source, /path\.resolve\(['"]E:\/surdet['"]\)/i);
});

test('qualification plan and v4 protocol freeze the fixed Q matrix and outputs', () => {
  const plan = fs.readFileSync(planPath, 'utf8');
  const spec = fs.readFileSync(specPath, 'utf8');
  for (const group of ['q1-007-a-b', 'q2-007-b-a', 'q3-f7-a-b', 'q4-f7-b-a', 'q5-f7-same-root']) {
    assert.match(plan, new RegExp(group));
    assert.match(spec, new RegExp(group));
  }
  for (const output of [
    'renderer-v4-q1-007-a-b-2026-08-10.json',
    'renderer-v4-q2-007-b-a-2026-08-10.json',
    'renderer-v4-q3-f7-a-b-2026-08-10.json',
    'renderer-v4-q4-f7-b-a-2026-08-10.json',
    'renderer-v4-q5-f7-same-root-2026-08-10.json',
  ]) {
    assert.match(plan, new RegExp(output));
    assert.match(spec, new RegExp(output));
  }
  assert.match(spec, /log\(1\.10\)/);
  assert.match(spec, /log\(1\.25\)/);
  assert.match(spec, /配对中位数比只记录为诊断/);
  assert.match(plan, /renderer-v4-aggregate-qualification-2026-08-10/);
  assert.match(plan, /renderer-v4-qualification-summary-2026-08-10\.json/);
  assert.match(plan, /roleSwapMedianLogDrift/);
});

test('v4 implementation remains diagnostic-only and shell-free', () => {
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /shell:\s*true/);
    assert.doesNotMatch(source, /createRendererRuntime|PixiStage|AdvRenderer|RendererFacade|__rendererV2Debug\.layers/);
  }
});

test('protected files are not part of the v4 implementation path', () => {
  for (const protectedPath of [
    'USER.md',
    'SESSION-HANDOFF.md',
    'docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md',
    'docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md',
  ]) {
    assert.equal(files.includes(protectedPath), false);
  }
});
