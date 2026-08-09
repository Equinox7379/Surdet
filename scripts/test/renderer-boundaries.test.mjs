import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRendererBoundaries } from '../check-renderer-boundaries.mjs';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-layer-boundary-'));
  const dialogue = path.join(root, 'packages/renderer/src/layers/dialogue');
  fs.mkdirSync(dialogue, { recursive: true });
  return { root, dialogue };
}

function removeFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('rejects a Layer importing another Layer', () => {
  const { root, dialogue } = makeFixture();
  try {
    fs.writeFileSync(path.join(dialogue, 'dialogue-layer.ts'), "import '../world/world-layer.js';\n");
    assert.deepEqual(checkRendererBoundaries(root), [
      'packages/renderer/src/layers/dialogue/dialogue-layer.ts imports another Layer: ../world/world-layer.js',
    ]);
  } finally {
    removeFixture(root);
  }
});
test('allows static and dynamic imports within the same Layer', () => {
  const { root, dialogue } = makeFixture();
  try {
    fs.writeFileSync(
      path.join(dialogue, 'dialogue-layer.ts'),
      "import './dialogue-helpers.js';\nexport async function load() { return import('./dialogue-more.js'); }\n",
    );
    assert.deepEqual(checkRendererBoundaries(root), []);
  } finally {
    removeFixture(root);
  }
});

test('rejects legacy and direct example/game imports', () => {
  const { root, dialogue } = makeFixture();
  try {
    fs.writeFileSync(
      path.join(dialogue, 'dialogue-layer.ts'),
      "import '../../legacy/legacy-stage.js';\nimport '../../../../examples/starter/src/main.ts';\n",
    );
    assert.deepEqual(checkRendererBoundaries(root), [
      'packages/renderer/src/layers/dialogue/dialogue-layer.ts imports example/game code: ../../../../examples/starter/src/main.ts',
      'packages/renderer/src/layers/dialogue/dialogue-layer.ts imports legacy renderer code: ../../legacy/legacy-stage.js',
    ]);
  } finally {
    removeFixture(root);
  }
});
