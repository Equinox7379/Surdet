import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCapabilityDocument } from '../lib/capability-matrix.mjs';

function record(overrides = {}) {
  return {
    id: 'sample',
    kind: 'ui',
    core: 'n/a',
    renderer: 'implemented',
    editor: 'n/a',
    host: 'n/a',
    tests: ['test/sample.test.ts'],
    docs: ['docs/sample.md'],
    ...overrides,
  };
}

test('implemented capability rejects a missing test evidence path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-capability-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/sample.md'), '# sample');

  assert.throws(
    () => validateCapabilityDocument({ version: 1, capabilities: [record()] }, root),
    /sample.*test\/sample\.test\.ts.*不存在/,
  );
});

test('capability rejects a missing documentation evidence path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-capability-'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'test/sample.test.ts'), '');

  assert.throws(
    () => validateCapabilityDocument({ version: 1, capabilities: [record()] }, root),
    /sample.*docs\/sample\.md.*不存在/,
  );
});
