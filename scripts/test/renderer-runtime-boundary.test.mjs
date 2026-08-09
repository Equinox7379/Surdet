import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');

test('formal renderer runtime is independent from legacy adapters', () => {
  const runtimeRoot = path.join(repositoryRoot, 'packages', 'renderer', 'src', 'runtime');
  const runtimeFiles = fs.readdirSync(runtimeRoot)
    .filter((name) => /\.(ts|tsx|js|jsx)$/.test(name))
    .sort();
  for (const name of runtimeFiles) {
    const source = fs.readFileSync(path.join(runtimeRoot, name), 'utf8');
    assert.doesNotMatch(source, /(?:from|import)\s*['"]\.\.\/legacy\//, `${name} imports a legacy module`);
    assert.doesNotMatch(source, /\b(?:PixiStage|AdvRenderer|AdvStage)\b/, `${name} names a legacy public type`);
  }

  const facade = fs.readFileSync(
    path.join(runtimeRoot, 'renderer-facade.ts'),
    'utf8',
  );
  assert.doesNotMatch(facade, /Partial<AdvStage>/, 'RendererStagePort must not be derived from AdvStage');
});
