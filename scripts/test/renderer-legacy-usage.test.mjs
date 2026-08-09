import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkLegacyUsage } from '../check-renderer-legacy-usage.mjs';

function createFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-legacy-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      const filePath = path.join(root, relative);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, source, 'utf8');
    }
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test('allows adapters/tests but rejects production imports', () => {
  const root = createFixture({
    'examples/game/src/main.ts': "import { PixiStage } from '@surdet/renderer';\n",
    'packages/renderer/src/legacy/legacy-stage-adapter.ts': "import type { AdvStage } from '../types.js';\n",
  });
  try {
    assert.deepEqual(checkLegacyUsage(root), [
      'examples/game/src/main.ts imports legacy renderer symbol PixiStage',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('returns every production symbol use in stable path order', () => {
  const root = createFixture({
    'packages/host/src/create-host.ts': "import type { AdvRenderer, AdvStage } from '@surdet/renderer';\n",
    'packages/cli/templates/game/src/main.ts': 'const stage = new PixiStage();\nconst renderer = new AdvRenderer(stage);\n',
  });
  try {
    assert.deepEqual(checkLegacyUsage(root), [
      'packages/cli/templates/game/src/main.ts uses legacy renderer symbol AdvRenderer',
      'packages/cli/templates/game/src/main.ts uses legacy renderer symbol PixiStage',
      'packages/host/src/create-host.ts imports legacy renderer symbol AdvRenderer',
      'packages/host/src/create-host.ts imports legacy renderer symbol AdvStage',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not grant blanket exemptions to renderer runtime or non-legacy tests', () => {
  const root = createFixture({
    'packages/renderer/src/runtime/bad.ts': [
      "import type { AdvStage } from '../../types.js';",
      "import '../legacy/legacy-renderer-adapter.js';",
    ].join('\n'),
    'packages/renderer/test/not-legacy.test.ts': 'const stage = new PixiStage();\n',
    'examples/game/src/main.ts': 'const renderer = new AdvRenderer(stage);\n',
    'packages/renderer/src/legacy/legacy-stage-adapter.ts': 'export class LegacyStageAdapter {}\n',
    'packages/renderer/test/legacy/legacy-stage-contract.test.ts': 'const stage = new PixiStage();\n',
    'packages/renderer/src/pixi-stage.ts': 'export class PixiStage {}\n',
  });
  try {
    assert.deepEqual(checkLegacyUsage(root), [
      'examples/game/src/main.ts uses legacy renderer symbol AdvRenderer',
      'packages/renderer/src/runtime/bad.ts imports legacy module ../legacy/legacy-renderer-adapter',
      'packages/renderer/src/runtime/bad.ts imports legacy renderer symbol AdvStage',
      'packages/renderer/test/not-legacy.test.ts uses legacy renderer symbol PixiStage',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
