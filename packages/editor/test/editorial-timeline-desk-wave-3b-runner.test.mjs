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
} from '../e2e/editorial-timeline-desk-wave-3b.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/editorial-timeline-desk-wave-3b.e2e.mjs');
const source = fs.readFileSync(runnerPath, 'utf8');

test('Frontend Pass 3B runner reserves strict ports and freezes the three execution modes', () => {
  assert.deepEqual(FORBIDDEN_PORTS, [4173, 4175]);
  assert.deepEqual(SEARCH_RANGE, { from: 4251, to: 4290 });
  assert.deepEqual(MODES, ['preflight', 'diagnostic', 'formal']);
  assert.deepEqual(VIEWPORTS, [
    { id: '1440', width: 1440, height: 900 },
    { id: '1280', width: 1280, height: 800 },
    { id: '1024', width: 1024, height: 768 },
    { id: '800', width: 800, height: 900 },
    { id: '720', width: 720, height: 900 },
  ]);
  assert.match(source, /for \(let port = SEARCH_RANGE\.from; port <= SEARCH_RANGE\.to; port \+= 1\)/);
  assert.match(source, /--strictPort/);
  assert.doesNotMatch(source, /4211|4250/);
});

test('Frontend Pass 3B runner freezes the complete 29-node fail-closed sequence', () => {
  assert.deepEqual(MILESTONE_IDS, [
    'strict-isolated-port-selected',
    'isolated-vite-ready',
    'fixture-opened-through-picker',
    'screenplay-dock-absent',
    'timeline-surface-single-truth',
    'timeline-identity-consistent',
    'localized-stable-enums',
    'cue-selection-scoped',
    'timeline-only-dirty',
    'timeline-history-scene-isolated',
    'destructive-cancel-noop',
    'destructive-confirm-undo-restore',
    'selected-timeline-preview-handoff',
    'layout-1440',
    'layout-1280',
    'layout-1024',
    'layout-800',
    'layout-720',
    'page-scale-command-reachability',
    'save-writes-expected-timeline-only',
    'crlf-preserved',
    'saved-fake-tree-dumped',
    'first-browser-context-closed',
    'fresh-context-injected-from-saved-tree',
    'edited-value-survives-cold-reopen',
    'reopened-project-clean',
    'original-starter-unchanged',
    'browser-error-channels-empty',
    'isolated-process-cleanup',
  ]);
  assert.equal(MILESTONE_IDS.length, 29);
  assert.match(source, /missing required milestones/);
  assert.match(source, /milestones\.filter/);
});

test('Frontend Pass 3B runner uses exclusive artifacts and binds them to source and Git identity', () => {
  assert.match(source, /fs\.openSync\(file, 'wx'\)/);
  assert.match(source, /surdet-editorial-timeline-desk-3b-/);
  assert.match(source, /runnerSha256/);
  assert.match(source, /runHead/);
  assert.match(source, /trackedCodeDiffPaths/);
  assert.match(source, /SURDET_CODE_EVIDENCE_HEAD/);
  assert.match(source, /runHead === codeEvidenceHead/);
  assert.match(source, /trackedCodeDiffPaths\.length === 0/);
  assert.match(source, /git', \['ls-files', '--error-unmatch'/);
  assert.match(source, /git', \['show', `HEAD:\$\{runnerRelativePath\}`/);
  assert.match(source, /runnerHeadIdentity\.sha256 === runnerSha256/);
  assert.match(source, /runnerHeadIdentity/);
  assert.match(source, /identity\.json/);
  assert.match(source, /evidence\.json/);
});

test('Frontend Pass 3B runner derives the fixture from Starter and adds one CRLF timeline only in memory', () => {
  assert.match(source, /path\.join\(repoRoot, 'examples', 'starter'\)/);
  assert.match(source, /fileMapForDirectory\(starterRoot\)/);
  assert.match(source, /browserFileMapTreeIdentity/);
  assert.match(source, /content\/timelines\/harbor_arrival\.json/);
  assert.match(source, /replace\(\/\\r\?\\n\/g, '\\r\\n'\)/);
  assert.match(source, /fixtureAugmentations/);
  assert.match(source, /originalStarterUnchanged/);
});

test('Frontend Pass 3B runner performs a real cold reopen from the saved fake tree', () => {
  assert.match(source, /window\.__surdetDumpFakeRoot\(\)/);
  assert.match(source, /await firstPage\.close\(\)/);
  assert.match(source, /await firstContext\.close\(\)/);
  assert.match(source, /secondContext = await browser\.newContext/);
  assert.match(source, /fakeFileSystemInit, \{ rootName: 'starter', files: savedFiles \}/);
  assert.doesNotMatch(source, /page\.reload\(/);
});

test('Frontend Pass 3B runner proves the Timeline Desk UI rather than an internal-only state path', () => {
  for (const selector of [
    '#timeline-view',
    '.timeline-shell',
    '.timeline-library',
    '.timeline-header',
    '.timeline-toolbar',
    '.timeline-ruler',
    '.timeline-tracks',
    '.timeline-inspector',
  ]) assert.ok(source.includes(selector), `missing selector contract ${selector}`);
  for (const phrase of ['演出片段库', '当前演出', '背景', '角色立绘', '片段设置', '预览演出']) {
    assert.ok(source.includes(phrase), `missing Chinese projection ${phrase}`);
  }
  assert.match(source, /Emulation\.setPageScaleFactor/);
  assert.match(source, /pageScaleFactor: 2/);
  assert.match(source, /timeline ticks overlap/);
  assert.match(source, /timeline tick labels repeat/);
});

test('Frontend Pass 3B runner passes outer selectors into browser evaluation explicitly', () => {
  assert.match(source, /return locator\.evaluate\(\(element, evaluatedSelector\) =>[\s\S]*selector: evaluatedSelector,[\s\S]*\}, selector\);/);
});

test('Frontend Pass 3B runner settles the Preview iframe before intentional navigation teardown', () => {
  const previewClick = source.indexOf("getByRole('button', { name: '▶ 预览演出'");
  const returnToTimeline = source.indexOf("await firstPage.locator('[data-editor-mode=\"timeline\"]'", previewClick);
  const settled = source.lastIndexOf("previewFrame.waitForLoadState('networkidle', { timeout: 10_000 })", returnToTimeline);
  const replayClick = source.indexOf("getByRole('button', { name: '重新播放', exact: true }).click()", settled);
  assert.ok(previewClick >= 0 && settled > previewClick && settled < returnToTimeline, 'Preview iframe is torn down before its module graph settles');
  assert.ok(replayClick > settled && replayClick < returnToTimeline, 'Preview replay identity is not exercised before returning to Timeline');
  assert.match(source, /#preview-view iframe\.preview-frame\[title="剧情预览"\]/);
  assert.match(source, /surdet-preview-ready/);
  assert.match(source, /event\.source !== frame\?\.contentWindow/);
  assert.match(source, /waitForURL\(\(url\) => url\.pathname\.endsWith\('\/preview\.html'\), \{ timeout: 10_000 \}\)/);
  assert.match(source, /waitForLoadState\('networkidle', \{ timeout: 10_000 \}\)/);
  assert.match(source, /runtimeReady: Boolean\(window\.surdetPreviewDebug\?\.runtime\)/);
  assert.match(source, /canvasCount: document\.querySelectorAll\('#preview-root canvas'\)\.length/);
  assert.match(source, /previewFrameEvidence\.readySignal/);
  assert.match(source, /replayPreservedTimelineId/);
  assert.match(source, /initialTimelineTraceEvidence/);
  assert.match(source, /event\.source\?\.op === 'timeline'/);
  assert.match(source, /replayTraceEventCount/);
  assert.match(source, /replayTimelineInstructionCount/);
  assert.match(source, /__surdetTimelineDeskPreviewMessages/);
  assert.match(source, /previewReceiptProbeEvidence/);
  assert.match(source, /initial direct-Timeline receipt missing/);
  assert.doesNotMatch(source, /requestFailures\s*=\s*requestFailures\.filter|ERR_ABORTED.*(?:ignore|allow|whitelist)/i);
});

test('Frontend Pass 3B runner proves independent history, cancel, restore, save and preview handoff', () => {
  assert.match(source, /sceneBytesBefore/);
  assert.match(source, /sceneBytesAfterUndo/);
  assert.match(source, /sceneBytesAfterRedo/);
  assert.match(source, /dialog\.dismiss\(\)/);
  assert.match(source, /dialog\.accept\(\)/);
  assert.match(source, /撤销删除/);
  assert.match(source, /data-action="undo"/);
  assert.match(source, /data-action="redo"/);
  assert.match(source, /data-action="save-project"/);
  assert.match(source, /previewTimelineId/);
});

test('Frontend Pass 3B runner closes the independent interaction-review seams', () => {
  for (const proof of [
    'searchFilteringEvidence',
    'newCueFocusEvidence',
    'cueDeleteUndoEvidence',
    'longScrollEvidence',
    'sameKeyExpressionEvidence',
    'trackDeleteUndoEvidence',
    'resizeConsistencyEvidence',
    'pointerCancelEvidence',
    'instantMarkerEvidence',
    'compactDisclosureEvidence',
    'wideAfterCompactEvidence',
    'compactPreferenceAfterWideEvidence',
    'modeRoundTripScrollEvidence',
    'localizedPositionEvidence',
    'standardPositionEvidence',
  ]) assert.ok(source.includes(proof), `missing independent-review proof ${proof}`);
  assert.match(source, /activeElementIsBody === false/);
  assert.match(source, /selectedOption.*normal/s);
  assert.match(source, /serializedPosition === '3000'/);
  assert.match(source, /serializedPosition === 'center'/);
  assert.match(source, /customPortraitPosition: '3000'/);
  assert.match(source, /inspector-position-custom/);
  assert.match(source, /modeValue === 'custom'/);
  assert.match(source, /modeLabel === '自定义横坐标'/);
  assert.match(source, /instant.*durationMs.*0/s);
  assert.match(source, /0ms cue incorrectly occupies the full Timeline lane/);
  assert.match(source, /pointercancel/);
  assert.match(source, /scrollLeft/);
  assert.match(source, /preModeRoundTripScrollEvidence/);
  assert.match(source, /timelineEditScrollProbeEvidence/);
  assert.match(source, /Timeline redo did not restore scrollLeft before mode round-trip/);
  assert.match(source, /expectedModeRoundTripScrollLeft/);
  assert.match(source, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(source, /timeline search did not filter/);
  assert.match(source, /compact Timeline disclosures reopened after edit/);
  assert.match(source, /compactLayoutProbeEvidence/);
  assert.match(source, /afterExplicitClose/);
  assert.match(source, /details\.timeline-library'\)\?\.open === false/);
  assert.match(source, /compact Timeline duration edit did not commit/);
});

test('Frontend Pass 3B runner captures screenshots, error channels and process cleanup', () => {
  assert.match(source, /page\.screenshot/);
  for (const channel of [
    'errors',
    'consoleErrors',
    'pageErrors',
    'requestFailures',
    'responseFailures',
    'stderrLines',
    'childCleanupFailures',
  ]) assert.ok(source.includes(channel), `missing evidence channel ${channel}`);
  assert.match(source, /strict port remained occupied/);
  assert.match(source, /portReleased/);
});
