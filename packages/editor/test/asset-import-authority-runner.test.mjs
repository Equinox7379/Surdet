import fs from 'node:fs';
import path from 'node:path';
import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/asset-import-authority.e2e.mjs');
const source = fs.existsSync(runnerPath) ? fs.readFileSync(runnerPath, 'utf8') : '';

test('asset import runner owns one isolated loopback fixture and strict non-reserved port', () => {
  assert.ok(source.length > 0, 'asset import authority runner must exist');
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /4173/);
  assert.match(source, /4175/);
  assert.match(source, /strict-isolated-port-selected/);
  assert.match(source, /dev-project\.mjs/);
  assert.match(source, /--project/);
  assert.match(source, /--data-root/);
  assert.match(source, /--port/);
  assert.match(source, /mkdtempSync|mkdtemp/);
  assert.match(source, /examples[\\/]+starter/);
});

test('asset import runner drives the real Chinese workbench through a node-backed directory handle', () => {
  for (const marker of [
    'window.showDirectoryPicker',
    'getFileHandle',
    'getDirectoryHandle',
    'isSameEntry',
    '选择素材文件',
    '素材分类',
    '最终名称',
    '准备导入',
    '重新检查',
    '确认导入',
    '查看导入回执',
    '撤销本次导入',
  ]) assert.ok(source.includes(marker), `missing browser contract marker: ${marker}`);
  assert.match(source, /setInputFiles/);
  assert.match(source, /page\.reload/);
  assert.match(source, /exposeFunction/);
  assert.doesNotMatch(source, /page\.waitForTimeout\(/);
});

test('asset import runner freezes collision, receipt reload, changed undo block and unchanged undo success', () => {
  for (const milestone of [
    'wrong-directory-rejected',
    'project-bound-cleanly',
    'multi-file-selected',
    'collision-blocked-without-overwrite',
    'multi-file-import-committed',
    'asset-facts-refreshed',
    'receipt-reopened-after-reload',
    'modified-file-undo-blocked',
    'unchanged-file-undo-succeeded',
    'undo-quarantine-retained',
  ]) assert.ok(source.includes(milestone), `missing milestone: ${milestone}`);
  assert.match(source, /IMPORT_TARGET_EXISTS|目标位置已有同名文件/);
  assert.match(source, /IMPORT_UNDO_BLOCKED_CHANGED|文件已被修改/);
  assert.match(source, /receiptSha256/);
  assert.match(source, /bindingTokenHashes/);
  assert.match(source, /operationTokenHashes/);
  assert.match(source, /old tokens|旧令牌|tokenRotated/);
});

test('asset import runner proves no repository or Starter mutation and retains every failure channel', () => {
  for (const channel of [
    'errors',
    'consoleErrors',
    'pageErrors',
    'requestFailures',
    'responseFailures',
    'stderrLines',
    'childCleanupFailures',
    'activeLeaseDirectories',
  ]) assert.ok(source.includes(channel), `missing evidence channel: ${channel}`);
  assert.match(source, /hashProjectTree/);
  assert.match(source, /originalStarterBefore/);
  assert.match(source, /originalStarterAfter/);
  assert.match(source, /repositoryTreeBefore/);
  assert.match(source, /repositoryTreeAfter/);
  assert.match(source, /projectMutation/);
  assert.match(source, /stopServer/);
  assert.match(source, /portReleased/);
  assert.match(source, /evidence\.json/);
  assert.match(source, /identity\.json/);
  assert.match(source, /fs\.openSync\([^)]*['"]wx['"]/);
  assert.match(source, /expectedConsoleErrors/);
  assert.match(source, /Failed to load resource: the server responded with a status of 409 \(Conflict\)/);
  assert.match(source, /expectedBusinessResponses\.length === 1/);
});

test('asset import runner records an exact ordered completion contract', () => {
  assert.match(source, /MILESTONE_IDS/);
  assert.match(source, /lastPassedNode/);
  assert.match(source, /firstFailedNode/);
  assert.match(source, /completedMilestoneNames/);
  assert.match(source, /milestone sequence mismatch/);
  assert.match(source, /runnerSha256/);
  assert.match(source, /runHead/);
});
