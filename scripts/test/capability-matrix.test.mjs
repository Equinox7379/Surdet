import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCapabilityDocument, renderCapabilityMatrix } from '../lib/capability-matrix.mjs';

test('matrix check accepts Windows EOLs but still rejects changed content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-capability-eol-'));
  const data = { version: 1, capabilities: [] };
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/capabilities.json'), JSON.stringify(data));
  const matrix = renderCapabilityMatrix(data).replace(/\r?\n/g, '\r\n');
  const target = path.join(root, 'docs/capability-matrix.md');
  fs.writeFileSync(target, matrix);
  const command = fileURLToPath(new URL('../render-capability-matrix.mjs', import.meta.url));
  const check = () => spawnSync(process.execPath, [command, '--check'], { cwd: root, encoding: 'utf8' });
  const accepted = check();
  assert.equal(accepted.status, 0, accepted.stderr);
  fs.appendFileSync(target, 'unrecorded change');
  assert.equal(check().status, 1);
});

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

test('capability rejects existing production source as test evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-capability-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'src/player.ts'), 'export const player = {};');
  fs.writeFileSync(path.join(root, 'docs/sample.md'), '# sample');
  assert.throws(
    () => validateCapabilityDocument({ version: 1, capabilities: [record({ tests: ['src/player.ts'] })] }, root),
    /测试证据必须指向测试文件/,
  );
});
