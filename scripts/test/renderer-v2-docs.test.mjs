import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const guidePath = join(root, 'docs', 'renderer-v2-migration.md');
const fixturePath = join(root, 'docs', 'examples', 'renderer-v2-migration.ts');

test('Renderer v2 migration examples have a complete typechecked fixture', () => {
  const guide = readFileSync(guidePath, 'utf8');
  const fencedExamples = [...guide.matchAll(/```ts\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.ok(fencedExamples.length >= 5, 'migration guide should contain the required TypeScript examples');
  for (const example of fencedExamples) {
    assert.doesNotMatch(example, /\.\.\./, 'TypeScript examples must not hide omitted code');
  }

  const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [
    compiler,
    '--noEmit',
    '--target', 'ES2022',
    '--module', 'ESNext',
    '--moduleResolution', 'bundler',
    '--lib', 'ES2022,DOM',
    '--strict',
    '--skipLibCheck',
    fixturePath,
  ], { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
