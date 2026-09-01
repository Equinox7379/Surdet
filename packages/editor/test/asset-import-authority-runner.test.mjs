import fs from 'node:fs';
import path from 'node:path';
import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/asset-import-authority.e2e.mjs');
const source = fs.existsSync(runnerPath) ? fs.readFileSync(runnerPath, 'utf8') : '';
const repositoryRoot = path.resolve(testDirectory, '../../..');
const rootPackagePath = path.join(repositoryRoot, 'package.json');
const ciWorkflowPath = path.join(repositoryRoot, '.github', 'workflows', 'ci.yml');
const verifyAllPath = path.join(repositoryRoot, 'scripts', 'verify-all.mjs');
const rootPackageSource = fs.existsSync(rootPackagePath) ? fs.readFileSync(rootPackagePath, 'utf8') : '';
const ciWorkflowSource = fs.existsSync(ciWorkflowPath) ? fs.readFileSync(ciWorkflowPath, 'utf8') : '';
const verifyAllSource = fs.existsSync(verifyAllPath) ? fs.readFileSync(verifyAllPath, 'utf8') : '';

test('asset import runner owns one isolated loopback fixture and strict non-reserved port', () => {
  assert.ok(source.length > 0, 'asset import authority runner must exist');
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /4173/);
  assert.match(source, /4175/);
  assert.match(source, /strict-isolated-port-selected/);
  assert.match(source, /cacheDir:/);
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
    '素材分类',
    '最终名称',
    '准备导入',
    '重新检查',
    '确认导入',
    '查看导入回执',
    '撤销本次导入',
  ]) assert.ok(source.includes(marker), `missing browser contract marker: ${marker}`);
  assert.match(source, /new DataTransfer\(\)/);
  assert.match(source, /dispatchEvent\(['"]dragenter/);
  assert.match(source, /dispatchEvent\(['"]dragover/);
  assert.match(source, /dispatchEvent\(['"]drop/);
  assert.match(source, /asset-import-picker/);
  assert.match(source, /text\/uri-list/);
  assert.match(source, /defaultPrevented/);
  assert.match(source, /lockedDropProbe/);
  assert.match(source, /page\.reload/);
  assert.match(source, /exposeFunction/);
  assert.doesNotMatch(source, /page\.waitForTimeout\(/);
});

test('asset import runner freezes collision, receipt reload, changed undo block and unchanged undo success', () => {
  for (const milestone of [
    'unsafe-project-tree-node-rejected',
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
  const expected409Classification = source.indexOf('if (channels.expectedBusinessResponses.length === 1');
  const emptyConsoleGate = source.indexOf('assert(channels.consoleErrors.length === 0');
  assert.ok(expected409Classification >= 0 && emptyConsoleGate > expected409Classification,
    'the expected 409 console line must be classified before the empty-console gate');
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

test('asset import runner hashes project trees with narrow registered exclusions and fails closed on unsafe nodes', () => {
  const walkerStart = source.indexOf('function hashCanonicalProjectTree');
  const walkerEnd = source.indexOf('\nfunction svgBytes', walkerStart);
  assert.ok(walkerStart >= 0 && walkerEnd > walkerStart, 'canonical project-tree walker must be present');
  const walker = source.slice(walkerStart, walkerEnd);
  assert.match(walker, /(?:registered|root)[A-Za-z]*(?:Challenge|Probe|Exclusion|Paths?)/i);
  assert.match(walker, /relativeDirectory\.length\s*===\s*0/);
  assert.match(walker, /portableRelative\s*===\s*['"]\.surdet\/asset-import['"]/);
  assert.doesNotMatch(walker, /entry\.name\.startsWith\(\s*['"]\.surdet-bind-/);
  assert.match(walker, /entry\.isSymbolicLink\(\)/);
  assert.match(walker, /(?:entry\.isDirectory\(\)|entry\.isFile\(\))[\s\S]{0,300}(?:throw|Error|fail|unsupported|other)/i);
  assert.match(source, /nested[\\/][^'"\n]*\.surdet-bind-|\.surdet-bind-[^'"\n]*nested/i);
  assert.match(source, /rejectedChallengeProbePaths[\s\S]{0,500}registeredRootChallengeNames\.add/);
  assert.match(source, /newProbePathsAfterBinding\.length\s*===\s*0/);
  assert.match(source, /fs\.symlinkSync\([\s\S]{0,500}unsafe-project-tree-node-rejected/);
});

test('asset import runner fails on any unexpected server stderr and drains the stream after child shutdown', () => {
  assert.match(source, /channels\.stderrLines\.length\s*===\s*0/);
  assert.match(
    source,
    /(?:server\.stderr|stream)\.(?:once|on)\(\s*['"]close['"]\s*[\s,)]/,
  );
  assert.match(source, /drainServerStderr[\s\S]{0,300}child\.stderr/);
  assert.match(source, /await[\s\S]{0,300}(?:stderr|child.*stream|stream.*close)/i);
});

test('asset import runner proves a ready plan is invalidated by editing its target and must be replanned', () => {
  assert.match(source, /ready-plan-invalidated-after-target-edit/);
  assert.match(source, /activeOperation\?\.plan\s*===\s*null/);
  assert.match(source, /asset-import-primary[^\n]{0,240}重新检查/);
  assert.match(source, /setFinalName\(|setCategory\(/);
  assert.match(source, /pass\(\s*['"]ready-plan-invalidated-after-target-edit['"]/);
  assert.match(source, /plan[\s\S]{0,500}status[\s\S]{0,500}ready/);
});

test('asset import runner verifies referenced relocation, preview reload, and exact undo', () => {
  for (const milestone of [
    'relocation-target-collision-blocked',
    'relocation-impact-previewed',
    'referenced-asset-relocated-and-reloaded',
    'relocated-scene-previewed',
    'asset-relocation-undo-succeeded',
  ]) assert.ok(source.includes(milestone), `missing relocation milestone: ${milestone}`);
  for (const label of ['移动或重命名', '检查影响', '修改目标', '撤销本次整理']) {
    assert.ok(source.includes(label), `missing relocation browser action: ${label}`);
  }
  assert.match(source, /castle_hall_arrival/);
  assert.match(source, /asset-relocation-blockers/);
  assert.match(source, /asset-relocation-impact/);
  assert.match(source, /asset-relocation-result/);
  assert.match(source, /projectWriteLock\s*===\s*null/);
  assert.match(source, /presentationSnapshot\?\.stage\?\.backgroundKey\s*===\s*backgroundKey/);
  assert.match(source, /source\?\.sceneId\s*===\s*['"]ch02['"][\s\S]{0,160}source\?\.op\s*===\s*['"]instr['"]/);
  assert.match(source, /relocation undo did not restore the isolated project baseline/);
});

test('CI or verify-all executes the real asset import Playwright runner', () => {
  const executionSources = `${rootPackageSource}\n${ciWorkflowSource}\n${verifyAllSource}`;
  assert.match(rootPackageSource, /"verify:asset-import"\s*:\s*"node\s+packages\/editor\/e2e\/asset-import-authority\.e2e\.mjs"/);
  assert.match(executionSources, /npm run verify:asset-import/);
  assert.match(
    executionSources,
    /(?:node|command|args|run:)[^\n]{0,240}(?:verify:asset-import|asset-import-authority\.e2e\.mjs)/,
  );
});
