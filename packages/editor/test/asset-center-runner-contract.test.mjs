import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_PORTS,
  MILESTONE_IDS,
  MODES,
  SEARCH_RANGE,
  VIEWPORTS,
} from '../e2e/asset-center-read-only.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/asset-center-read-only.e2e.mjs');
const source = fs.readFileSync(runnerPath, 'utf8');
const fakeFileSystemSource = fs.readFileSync(path.resolve(testDirectory, '../e2e/support/fake-file-system.mjs'), 'utf8');

test('Asset Center runner reserves an isolated loopback port and freezes responsive widths', () => {
  assert.deepEqual(FORBIDDEN_PORTS, [4173, 4175]);
  assert.deepEqual(SEARCH_RANGE, { from: 4331, to: 4370 });
  assert.deepEqual(MODES, ['preflight', 'diagnostic', 'formal']);
  assert.deepEqual(VIEWPORTS, [
    { id: '1440', width: 1440, height: 900 },
    { id: '1024', width: 1024, height: 768 },
    { id: '800', width: 800, height: 900 },
  ]);
  assert.match(source, /for \(let port = SEARCH_RANGE\.from; port <= SEARCH_RANGE\.to; port \+= 1\)/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /--strictPort/);
  assert.doesNotMatch(source, /page\.waitForTimeout\(/);
});

test('Asset Center runner freezes a complete fail-closed milestone sequence', () => {
  assert.deepEqual(MILESTONE_IDS, [
    'strict-isolated-port-selected',
    'isolated-vite-ready',
    'fixture-opened-through-picker',
    'asset-center-mode-opened',
    'asset-summary-matches-fixture',
    'category-rail-complete',
    'search-filter-consistent',
    'status-filter-consistent',
    'keyboard-selection',
    'image-inspector-preview',
    'audio-inspector-preview',
    'audio-preview-fallback-safe',
    'video-inspector-preview',
    'video-preview-fallback-safe',
    'missing-asset-visible',
    'duplicate-key-visible',
    'unused-asset-visible',
    'invalid-name-visible',
    'unsupported-format-visible',
    'reference-navigation',
    'layout-1440',
    'layout-1024',
    'layout-800',
    'fixture-remains-byte-identical',
    'browser-error-channels-empty',
    'isolated-process-cleanup',
  ]);
  assert.equal(MILESTONE_IDS.length, 26);
  assert.match(source, /milestone sequence mismatch/);
  assert.match(source, /JSON\.stringify\(completedMilestoneNames\)\s*===\s*JSON\.stringify\(MILESTONE_IDS\)/);
  assert.match(source, /evidenceClassForMode/);
  assert.match(source, /milestones\.filter/);
});

test('Asset Center runner uses the fake picker, isolated fixture and read-only project proof', () => {
  for (const helper of [
    'fileMapForDirectory',
    'browserFileMapTreeIdentity',
    'fakeFileSystemInit',
    'hashProjectTree',
  ]) assert.ok(source.includes(helper), `missing fixture helper ${helper}`);
  for (const fixturePath of [
    'content/assets/bg/asset-center-harbor.svg',
    'content/assets/bgm/theme.wav',
    'content/assets/bgm/broken.wav',
    'content/assets/ambience/rain.ogg',
    'content/assets/video/teaser.webm',
    'content/assets/video/broken.webm',
    'content/assets/fonts/asset-center-font.otf',
    'content/assets/portrait/alternate/lynn_uniform_normal.svg',
    'content/assets/portrait/bad-portrait.svg',
    'content/assets/bg/unknown-format.xyz',
  ]) assert.ok(source.includes(fixturePath), `missing fixture path ${fixturePath}`);
  for (const label of [
    '素材中心', '素材库', '全部状态', '已引用', '未引用', '引用缺失', '同名冲突', '命名异常', '格式待确认',
  ]) assert.ok(source.includes(label), `missing Chinese Asset Center proof ${label}`);
  assert.match(source, /window\.showDirectoryPicker/);
  assert.match(source, /addInitScript\(fakeFileSystemInit/);
  assert.match(source, /originalStarterUnchanged/);
  assert.match(source, /fixtureTreeBefore/);
  assert.match(source, /fixtureTreeAfter/);
  assert.match(source, /projectMutation/);
  assert.match(source, /projectionCounts/);
  assert.doesNotMatch(source, /expectedPhysicalCount \+ 1/);
  assert.match(source, /const centerText/);
  assert.match(source, /projectionCounts\.missingIds\.length/);
  assert.doesNotMatch(source, /createWritable|writeFileHandle|save-project/);
});

test('Asset Center runner proves search, filters, keyboard, previews and reference navigation through the UI', () => {
  for (const selector of [
    '#asset-center-view',
    '.asset-center-header',
    '.asset-center-overview',
    '.asset-center-rail',
    '.asset-center-library',
    '.asset-center-inspector',
    '[data-asset-filter="search"]',
    '[data-asset-id]',
    '[data-asset-kind]',
    '[data-asset-status]',
    '[data-source-path]',
    '[data-source-line]',
  ]) assert.ok(source.includes(selector), `missing browser selector ${selector}`);
  assert.match(source, /keyboardRow\.press\(['"](Enter|Space)/);
  assert.doesNotMatch(source, /const keyboardId = await selectAsset/);
  assert.match(source, /aria-selected/);
  assert.match(source, /asset-center-preview/);
  assert.match(source, /data-preview-state|previewState/);
  assert.match(source, /reference\.click|click\(\).*data-source-path/s);
  assert.match(source, /mainTab === ['"]editor/);
  assert.match(source, /selectedObjectRef|data-line/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /__surdetAssetPreviewDebug/);
  assert.match(source, /seenElements/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /audioEvidence\.state === 'ready'/);
  assert.match(source, /videoEvidence\.state === 'ready'/);
  assert.match(source, /audio-preview-fallback-safe/);
  assert.match(source, /video-preview-fallback-safe/);
  assert.match(fakeFileSystemSource, /audio\/wav/);
  assert.match(fakeFileSystemSource, /video\/webm/);
  assert.match(source, /initialSelection === null/);
  assert.match(source, /initialPreviewCount === 0/);
  assert.match(source, /data-asset-filter-count/);
  assert.match(source, /assetQuery/);
  assert.match(source, /visibleCount/);
  assert.match(source, /asset-center-library-header/);
  assert.match(source, /filteredSummaryText/);
});

test('Asset Center runner captures real browser errors, object URL cleanup and process cleanup', () => {
  for (const channel of [
    'errors',
    'consoleErrors',
    'pageErrors',
    'requestFailures',
    'responseFailures',
    'childCleanupFailures',
    'serverStdout',
    'serverStderr',
  ]) assert.ok(source.includes(channel), `missing evidence channel ${channel}`);
  assert.match(source, /page\.on\(['"]console/);
  assert.match(source, /page\.on\(['"]pageerror/);
  assert.match(source, /page\.on\(['"]requestfailed/);
  assert.match(source, /response\.status\(\) >= 400/);
  assert.match(source, /await page\.close\(\)/);
  assert.match(source, /await browser\.close\(\)/);
  assert.match(source, /stopServer\(server/);
  assert.match(source, /portReleased/);
  assert.match(source, /strict port remained occupied/);
  assert.match(source, /fs\.openSync\(file, 'wx'\)/);
  assert.match(source, /identity\.json/);
  assert.match(source, /evidence\.json/);
});

test('Asset Center runner binds artifacts to source and frozen Git identity', () => {
  assert.match(source, /runnerSha256/);
  assert.match(source, /runHead/);
  assert.match(source, /trackedCodeDiffPaths/);
  assert.match(source, /SURDET_CODE_EVIDENCE_HEAD/);
  assert.match(source, /runHead === codeEvidenceHead/);
  assert.match(source, /trackedCodeDiffPaths\.length > 0/);
  assert.match(source, /rev-parse/);
  assert.match(source, /diff.*name-only/);
  assert.match(source, /committedRunnerIdentity/);
  assert.match(source, /runnerCommitMatches/);
  assert.match(source, /git.*show/s);
  assert.doesNotMatch(source, /C:\\Users\\|cli\.config\.json/);
  assert.match(source, /const runnerIdentity = readFileIdentity\(runnerPath\)/);
});
