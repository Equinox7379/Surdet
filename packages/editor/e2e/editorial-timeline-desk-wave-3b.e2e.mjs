import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  browserFileMapTreeIdentity,
  fakeFileSystemInit,
  fileMapForDirectory,
  hashProjectTree,
} from './support/fake-file-system.mjs';

const runnerPath = fileURLToPath(import.meta.url);
const editorRoot = path.resolve(path.dirname(runnerPath), '..');
const repoRoot = path.resolve(editorRoot, '..', '..');
const runnerRelativePath = path.relative(repoRoot, runnerPath).split(path.sep).join('/');
const starterRoot = path.join(repoRoot, 'examples', 'starter');
const crlfTimelinePath = 'content/timelines/harbor_arrival.json';
const editedTimelineId = 'harbor_arrival';
const deletedTimelineId = 'harbor_steps_forward';
const editedDurationMs = 1375;
const originalEditedDurationMs = 900;

export const FORBIDDEN_PORTS = Object.freeze([4173, 4175]);
export const SEARCH_RANGE = Object.freeze({ from: 4251, to: 4290 });
export const MODES = Object.freeze(['preflight', 'diagnostic', 'formal']);
export const VIEWPORTS = Object.freeze([
  { id: '1440', width: 1440, height: 900 },
  { id: '1280', width: 1280, height: 800 },
  { id: '1024', width: 1024, height: 768 },
  { id: '800', width: 800, height: 900 },
  { id: '720', width: 720, height: 900 },
]);
export const MILESTONE_IDS = Object.freeze([
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

const forbiddenPorts = new Set(FORBIDDEN_PORTS);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return {
    path: path.resolve(file),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function writeExclusiveJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const descriptor = fs.openSync(file, 'wx');
  try {
    fs.writeSync(descriptor, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return readFileIdentity(file);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function gitOutput(args) {
  const result = runCommand('git', args);
  assert(result.status === 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function trackedCodePaths() {
  const commands = [
    ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--', 'packages'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--', 'packages'],
  ];
  return [...new Set(commands.flatMap((args) => {
    const output = gitOutput(args);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  }))].sort();
}

function runnerIdentityAtHead() {
  const tracked = runCommand('git', ['ls-files', '--error-unmatch', '--', runnerRelativePath]);
  assert(tracked.status === 0, `FORMAL runner is not tracked by Git: ${runnerRelativePath}`);
  const blob = runCommand('git', ['show', `HEAD:${runnerRelativePath}`], { encoding: null });
  assert(blob.status === 0, `FORMAL runner is absent from HEAD: ${runnerRelativePath}`);
  return {
    path: runnerRelativePath,
    bytes: blob.stdout.byteLength,
    sha256: sha256(blob.stdout),
  };
}

function parseMode(argv) {
  const index = argv.indexOf('--mode');
  const mode = index >= 0 ? argv[index + 1] : null;
  assert(typeof mode === 'string' && MODES.includes(mode), `--mode must be one of ${MODES.join(', ')}`);
  return mode;
}

function augmentStarterFixture() {
  const files = fileMapForDirectory(starterRoot);
  const target = files.find((file) => file.path === crlfTimelinePath);
  assert(target, `Starter timeline missing: ${crlfTimelinePath}`);
  const beforeBytes = Buffer.from(target.bytes, 'base64');
  const beforeText = beforeBytes.toString('utf8');
  const augmentedDefinition = JSON.parse(beforeText);
  augmentedDefinition.tracks[1].cues[0].position = '3000';
  const augmentedLfText = `${JSON.stringify(augmentedDefinition, null, 2)}\n`;
  const crlfText = augmentedLfText.replace(/\r?\n/g, '\r\n');
  const afterBytes = Buffer.from(crlfText, 'utf8');
  assert(!/(^|[^\r])\n/.test(crlfText), 'fixture CRLF conversion left a bare LF');
  target.bytes = afterBytes.toString('base64');
  const fixtureAugmentations = [{
    path: crlfTimelinePath,
    kind: 'lf-to-crlf-with-custom-portrait-coordinate-in-memory',
    customPortraitPosition: '3000',
    before: { bytes: beforeBytes.byteLength, sha256: sha256(beforeBytes), eol: 'LF' },
    after: { bytes: afterBytes.byteLength, sha256: sha256(afterBytes), eol: 'CRLF' },
  }];
  const syntheticTimelines = [
    {
      path: 'content/timelines/harbor_cinematic.json',
      definition: {
        version: 1,
        id: 'harbor_cinematic',
        durationMs: 1050,
        tracks: [
          { kind: 'background', cues: [{ atMs: 0, durationMs: 720, easing: 'outCubic', action: 'set', key: 'harbor' }] },
          { kind: 'portrait', target: 'lynn:coat', cues: [{ atMs: 160, durationMs: 620, easing: 'outCubic', action: 'show', expression: 'normal', position: 'right' }] },
          { kind: 'screen', cues: [
            { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
            { atMs: 20, durationMs: 740, easing: 'inOutSine', action: 'fade', alpha: 0 },
          ] },
        ],
      },
    },
    {
      path: 'content/timelines/harbor_steps_forward.json',
      definition: {
        version: 1,
        id: 'harbor_steps_forward',
        durationMs: 880,
        tracks: [
          { kind: 'portrait', target: 'lynn:coat', cues: [
            { atMs: 0, durationMs: 574, easing: 'inOutSine', action: 'expression', expression: 'hesitant' },
            { atMs: 131, durationMs: 620, easing: 'inOutCubic', action: 'move', position: 'center' },
          ] },
          { kind: 'screen', cues: [{ atMs: 0, durationMs: 700, easing: 'inOutSine', action: 'tint', color: 226050, alpha: 0.12 }] },
        ],
      },
    },
  ];
  for (const fixture of syntheticTimelines) {
    const bytes = Buffer.from(`${JSON.stringify(fixture.definition, null, 2)}\n`, 'utf8');
    files.push({ path: fixture.path, bytes: bytes.toString('base64') });
    fixtureAugmentations.push({
      path: fixture.path,
      kind: 'in-memory-harbor-timeline-selection-fixture',
      timelineId: fixture.definition.id,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    fixtureAugmentations,
  };
}

function mapFileText(files, filePath) {
  const found = files.find((file) => file.path === filePath);
  assert(found, `fake file missing: ${filePath}`);
  return Buffer.from(found.bytes, 'base64').toString('utf8');
}

function changedFilePaths(beforeFiles, afterFiles) {
  const before = new Map(beforeFiles.map((file) => [file.path, file.bytes]));
  const after = new Map(afterFiles.map((file) => [file.path, file.bytes]));
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((filePath) => before.get(filePath) !== after.get(filePath)).sort();
}

function sceneTextIdentity(entries) {
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
  const serialized = sorted.map((entry) => `${entry.id}\0${entry.text}`).join('\n');
  return {
    count: sorted.length,
    bytes: sorted.reduce((total, entry) => total + Buffer.byteLength(entry.text, 'utf8'), 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
  };
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function chooseStrictPort() {
  for (let port = SEARCH_RANGE.from; port <= SEARCH_RANGE.to; port += 1) {
    if (forbiddenPorts.has(port)) continue;
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`no strict Timeline Desk port available in ${SEARCH_RANGE.from}..${SEARCH_RANGE.to}`);
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Listener has not been published yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite readiness timeout: ${url}`);
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopServer(child, cleanupFailures) {
  if (!child) return;
  const pid = child.pid;
  if (child.exitCode === null) {
    try {
      child.kill('SIGTERM');
    } catch (error) {
      cleanupFailures.push(`SIGTERM ${pid}: ${errorText(error)}`);
    }
  }
  if (await waitForExit(child)) return;
  if (process.platform === 'win32' && Number.isInteger(pid)) {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForExit(killer, 5_000);
  } else if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch (error) {
      cleanupFailures.push(`SIGKILL ${pid}: ${errorText(error)}`);
    }
  }
  if (!(await waitForExit(child))) cleanupFailures.push(`Vite child remained alive: ${pid}`);
}

function observePage(page, channels) {
  page.on('console', (message) => {
    if (message.type() === 'error') channels.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => channels.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => {
    channels.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      channels.responseFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
}

async function takeScreenshot(page, artifactDirectory, name, screenshots) {
  const file = path.join(artifactDirectory, `${name}.png`);
  assert(!fs.existsSync(file), `screenshot already exists: ${file}`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  screenshots.push(readFileIdentity(file));
}

async function openFixture(page) {
  await page.locator('[data-action="open-project"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.manuscript-sheet[data-scene-id="ch01_01"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.authoringIndex !== null);
  return page.evaluate(() => ({
    projectName: document.querySelector('.editor-project-name')?.textContent ?? null,
    sceneCount: window.surdetEditorDebug?.state?.scenes?.size ?? null,
    timelineCount: window.surdetEditorDebug?.state?.timelines?.length ?? null,
    assetCount: window.surdetEditorDebug?.state?.dirAssets?.length ?? null,
    currentScene: window.surdetEditorDebug?.state?.current ?? null,
  }));
}

async function enterTimelineDesk(page) {
  await page.locator('[data-editor-mode="timeline"]').click();
  await page.locator('#timeline-view .timeline-shell').waitFor({ state: 'visible' });
}

async function selectTimeline(page, timelineId) {
  const item = page.locator(`.timeline-item[data-timeline-id="${timelineId}"]`);
  await item.click();
  await page.waitForFunction((expected) => (
    window.surdetEditorDebug?.state?.currentTimeline === expected
      && document.querySelector('.timeline-title h2')?.textContent === expected
  ), timelineId);
}

async function stateSnapshot(page, timelineId = editedTimelineId) {
  return page.evaluate((id) => {
    const debug = window.surdetEditorDebug;
    const timeline = debug.state.timelines.find((entry) => entry.id === id);
    return {
      timeline: timeline ? {
        id: timeline.id,
        file: timeline.file,
        text: timeline.text,
        eol: timeline.eol,
        dirty: timeline.dirty,
      } : null,
      timelines: debug.state.timelines.map((entry) => ({
        id: entry.id,
        file: entry.file,
        text: entry.text,
        eol: entry.eol,
        dirty: entry.dirty,
      })),
      scenes: [...debug.state.scenes.values()].map((scene) => ({
        id: scene.id,
        text: scene.text,
        dirty: scene.dirty,
      })),
      currentTimeline: debug.state.currentTimeline,
      currentTimelineCue: debug.state.currentTimelineCue ? { ...debug.state.currentTimelineCue } : null,
      previewTimelineId: debug.state.previewTimelineId,
      mainTab: debug.state.mainTab,
      pendingTimelineDeletes: debug.state.pendingTimelineDeletes.map((entry) => ({ ...entry })),
      pendingTimelineRestoreIds: [...debug.state.pendingTimelineRestores.keys()],
    };
  }, timelineId);
}

async function timelineIdentity(page, timelineId) {
  return page.evaluate((id) => {
    const currentItem = document.querySelector('.timeline-item[aria-current="true"]');
    return {
      stateId: window.surdetEditorDebug?.state?.currentTimeline ?? null,
      listId: currentItem?.getAttribute('data-timeline-id') ?? null,
      listLabel: currentItem?.querySelector('.timeline-item-name')?.textContent ?? null,
      headerId: document.querySelector('.timeline-title h2')?.textContent ?? null,
      projectBar: document.querySelector('.editor-current-object')?.textContent ?? null,
      expected: id,
    };
  }, timelineId);
}

async function localizedProjection(page) {
  await page.locator('.timeline-cue').first().click();
  await page.locator('[data-timeline-focus="inspector-action"]').waitFor({ state: 'visible' });
  const primary = await page.evaluate(() => {
    const valueAndLabel = (selector) => {
      const select = document.querySelector(selector);
      return select ? {
        value: select.value,
        label: select.selectedOptions[0]?.textContent ?? '',
      } : null;
    };
    return {
      background: valueAndLabel('[data-timeline-focus="track-0-kind"]'),
      portrait: valueAndLabel('[data-timeline-focus="track-1-kind"]'),
      addAction: valueAndLabel('[data-timeline-focus="track-0-add-action"]'),
      inspectorAction: valueAndLabel('[data-timeline-focus="inspector-action"]'),
      inspectorEasing: valueAndLabel('[data-timeline-focus="inspector-easing"]'),
      shellText: document.querySelector('.timeline-shell')?.textContent ?? '',
    };
  });
  await page.locator('.timeline-cue[data-track-index="1"][data-cue-index="0"]').click();
  await page.locator('[data-timeline-focus="inspector-resource"]').waitFor({ state: 'visible' });
  const sameKeyExpressionEvidence = await page.evaluate(() => {
    const resource = document.querySelector('[data-timeline-focus="inspector-resource"]');
    return {
      selectedOption: resource?.selectedOptions[0]?.textContent ?? null,
      sameKeyOptions: resource
        ? [...resource.options].map((option) => option.textContent ?? '').filter((label) => label.startsWith('lynn:coat'))
        : [],
      actionValue: document.querySelector('[data-timeline-focus="inspector-action"]')?.value ?? null,
    };
  });
  const position = page.locator('[data-timeline-focus="inspector-position"]');
  const localizedPositionBefore = await page.evaluate(() => {
    const mode = document.querySelector('[data-timeline-focus="inspector-position"]');
    const custom = document.querySelector('[data-timeline-focus="inspector-position-custom"]');
    return {
      modeValue: mode?.value ?? null,
      modeLabel: mode?.selectedOptions[0]?.textContent ?? null,
      customValue: custom?.value ?? null,
    };
  });
  await position.evaluate((select) => select.dispatchEvent(new Event('change', { bubbles: true })));
  const localizedPositionEvidence = await page.evaluate((id) => {
    const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
    const mode = document.querySelector('[data-timeline-focus="inspector-position"]');
    const custom = document.querySelector('[data-timeline-focus="inspector-position-custom"]');
    return {
      modeValue: mode?.value ?? null,
      modeLabel: mode?.selectedOptions[0]?.textContent ?? null,
      customValue: custom?.value ?? null,
      serializedPosition: JSON.parse(entry.text).tracks[1].cues[0].position,
    };
  }, editedTimelineId);
  assert(localizedPositionEvidence.serializedPosition === '3000', 'custom portrait coordinate was clamped or rewritten');
  await selectTimeline(page, 'harbor_cinematic');
  const instantMarkerEvidence = await page.evaluate(() => {
    const instant = document.querySelector('.timeline-cue.instant[data-duration-ms="0"]');
    const box = instant?.getBoundingClientRect();
    const laneBox = instant?.closest('.timeline-lane')?.getBoundingClientRect();
    return {
      count: document.querySelectorAll('.timeline-cue.instant[data-duration-ms="0"]').length,
      durationMs: instant?.getAttribute('data-duration-ms') ?? null,
      width: box?.width ?? 0,
      laneWidth: laneBox?.width ?? 0,
      widthRatio: box && laneBox?.width ? box.width / laneBox.width : null,
      className: instant?.className ?? null,
    };
  });
  await selectTimeline(page, deletedTimelineId);
  await page.locator('.timeline-cue[data-track-index="0"][data-cue-index="1"]').click();
  await page.locator('[data-timeline-focus="inspector-position"]').waitFor({ state: 'visible' });
  const standardPositionEvidence = await page.evaluate((id) => {
    const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
    const control = document.querySelector('[data-timeline-focus="inspector-position"]');
    return {
      value: control?.value ?? null,
      label: control?.selectedOptions[0]?.textContent ?? null,
      serializedPosition: JSON.parse(entry.text).tracks[0].cues[1].position,
    };
  }, deletedTimelineId);
  await selectTimeline(page, editedTimelineId);
  return {
    ...primary,
    sameKeyExpressionEvidence,
    localizedPositionBefore,
    localizedPositionEvidence,
    instantMarkerEvidence,
    standardPositionEvidence,
  };
}

async function verifyCueInteractionSeams(page) {
  const beforeNewCue = await stateSnapshot(page);
  await page.locator('[data-timeline-focus="track-0-add"]').click();
  await page.waitForFunction((id) => {
    const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
    return JSON.parse(entry.text).tracks[0].cues.length === 2;
  }, editedTimelineId);
  const newCueFocusEvidence = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      activeElementIsBody: active === document.body,
      activeTimelineFocus: active?.getAttribute('data-timeline-focus') ?? null,
      selection: window.surdetEditorDebug.state.currentTimelineCue
        ? { ...window.surdetEditorDebug.state.currentTimelineCue }
        : null,
      selectedDom: [...document.querySelectorAll('.timeline-cue.selected')].map((cue) => ({
        trackIndex: Number(cue.getAttribute('data-track-index')),
        cueIndex: Number(cue.getAttribute('data-cue-index')),
      })),
    };
  });
  assert(newCueFocusEvidence.activeElementIsBody === false, 'new cue rerender dropped focus on BODY');
  assert(newCueFocusEvidence.activeTimelineFocus === 'track-0-add', `new cue focus moved to ${newCueFocusEvidence.activeTimelineFocus}`);
  assert(newCueFocusEvidence.selection?.trackIndex === 0 && newCueFocusEvidence.selection?.cueIndex === 1, 'new cue did not become the shared selection');
  assert(newCueFocusEvidence.selectedDom.some((cue) => cue.trackIndex === 0 && cue.cueIndex === 1), 'new cue selection is not visible in the DOM');
  const afterNewCue = await stateSnapshot(page);
  await page.locator('[data-timeline-focus="inspector-delete"]').click();
  await page.waitForFunction(({ id, text }) => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text === text, {
    id: editedTimelineId,
    text: beforeNewCue.timeline.text,
  });
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(({ id, text }) => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text === text, {
    id: editedTimelineId,
    text: afterNewCue.timeline.text,
  });
  const cueDeleteUndoEvidence = await page.evaluate(() => ({
    selection: window.surdetEditorDebug.state.currentTimelineCue
      ? { ...window.surdetEditorDebug.state.currentTimelineCue }
      : null,
    activeTimelineFocus: document.activeElement?.getAttribute('data-timeline-focus') ?? null,
    selectedCueCount: document.querySelectorAll('.timeline-cue.selected[data-track-index="0"][data-cue-index="1"]').length,
  }));
  assert(cueDeleteUndoEvidence.selection?.trackIndex === 0 && cueDeleteUndoEvidence.selection?.cueIndex === 1, 'cue delete undo did not restore the exact shared selection');
  assert(cueDeleteUndoEvidence.activeTimelineFocus === 'cue-0-1' && cueDeleteUndoEvidence.selectedCueCount === 1, 'cue delete undo did not restore exact DOM focus/selection');
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(({ id, text }) => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text === text, {
    id: editedTimelineId,
    text: beforeNewCue.timeline.text,
  });

  const beforeResize = await stateSnapshot(page);
  const resizeHandle = page.locator('.timeline-cue[data-track-index="0"][data-cue-index="0"] .timeline-cue-resize');
  const resizeBox = await resizeHandle.boundingBox();
  assert(resizeBox, 'cue resize handle has no pointer geometry');
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 42, resizeBox.y + resizeBox.height / 2);
  await page.mouse.up();
  await page.waitForFunction(({ id, text }) => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text !== text, {
    id: editedTimelineId,
    text: beforeResize.timeline.text,
  });
  const resizeConsistencyEvidence = await page.evaluate((id) => {
    const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
    const definition = JSON.parse(entry.text);
    const cue = definition.tracks[0].cues[0];
    const block = document.querySelector('.timeline-cue[data-track-index="0"][data-cue-index="0"]');
    const inspectorDuration = document.querySelector('[data-timeline-focus="inspector-duration"]');
    const expectedWidth = Math.max(2, Math.min(100 - cue.atMs / definition.durationMs * 100, Math.max(1, cue.durationMs / definition.durationMs * 100)));
    return {
      selection: window.surdetEditorDebug.state.currentTimelineCue
        ? { ...window.surdetEditorDebug.state.currentTimelineCue }
        : null,
      selected: block?.classList.contains('selected') ?? false,
      durationMs: cue.durationMs,
      inspectorDuration: Number(inspectorDuration?.value),
      widthPercent: Number.parseFloat(block?.style.width ?? ''),
      expectedWidth,
    };
  }, editedTimelineId);
  assert(resizeConsistencyEvidence.selection?.trackIndex === 0 && resizeConsistencyEvidence.selection?.cueIndex === 0, 'unselected resize did not establish shared cue selection');
  assert(resizeConsistencyEvidence.selected, 'unselected resize did not update selected DOM state');
  assert(resizeConsistencyEvidence.inspectorDuration === resizeConsistencyEvidence.durationMs, 'resize Inspector disagrees with serialized cue duration');
  assert(Math.abs(resizeConsistencyEvidence.widthPercent - resizeConsistencyEvidence.expectedWidth) < 0.2, 'resize DOM width disagrees with serialized cue duration');
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(({ id, text }) => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text === text, {
    id: editedTimelineId,
    text: beforeResize.timeline.text,
  });

  const cancelResizeHandle = page.locator('.timeline-cue[data-track-index="0"][data-cue-index="0"] .timeline-cue-resize');
  const cancelResizeBlock = page.locator('.timeline-cue[data-track-index="0"][data-cue-index="0"]');
  const cancelResizeBox = await cancelResizeHandle.boundingBox();
  const widthBeforeCancel = await cancelResizeBlock.evaluate((block) => block.style.width);
  assert(cancelResizeBox, 'cue resize handle has no pointercancel geometry');
  await page.mouse.move(cancelResizeBox.x + cancelResizeBox.width / 2, cancelResizeBox.y + cancelResizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelResizeBox.x + cancelResizeBox.width / 2 + 36, cancelResizeBox.y + cancelResizeBox.height / 2);
  await cancelResizeHandle.dispatchEvent('pointercancel', { pointerId: 1, button: 0, buttons: 0 });
  await page.mouse.up();
  await page.waitForFunction(({ id, text, width }) => {
    const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
    const block = document.querySelector('.timeline-cue[data-track-index="0"][data-cue-index="0"]');
    return entry.text === text && block?.style.width === width;
  }, { id: editedTimelineId, text: beforeResize.timeline.text, width: widthBeforeCancel });
  const pointerCancelEvidence = await page.evaluate(() => ({
    selection: window.surdetEditorDebug.state.currentTimelineCue
      ? { ...window.surdetEditorDebug.state.currentTimelineCue }
      : null,
    selected: document.querySelector('.timeline-cue[data-track-index="0"][data-cue-index="0"]')?.classList.contains('selected') ?? false,
  }));
  assert(pointerCancelEvidence.selection?.trackIndex === 0 && pointerCancelEvidence.selected, 'pointercancel left DOM/state selection inconsistent');
  return { newCueFocusEvidence, cueDeleteUndoEvidence, resizeConsistencyEvidence, pointerCancelEvidence };
}

async function inspectTimelineLayout(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const ticks = [...document.querySelectorAll('.timeline-tick')].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: element.textContent ?? '',
        valueMs: Number(element.getAttribute('data-value-ms')),
        left: box.left,
        right: box.right,
        width: box.width,
      };
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      timelineView: rect('#timeline-view'),
      shell: rect('.timeline-shell'),
      library: rect('.timeline-library'),
      content: rect('.timeline-content'),
      header: rect('.timeline-header'),
      toolbar: rect('.timeline-toolbar'),
      ruler: rect('.timeline-ruler'),
      tracks: rect('.timeline-tracks'),
      canvas: rect('.timeline-canvas'),
      inspector: rect('.timeline-inspector'),
      scroll: rect('.timeline-scroll'),
      summaryVisible: getComputedStyle(document.querySelector('.timeline-library > summary')).display !== 'none',
      timelineClientWidth: document.querySelector('#timeline-view')?.clientWidth ?? 0,
      timelineScrollWidth: document.querySelector('#timeline-view')?.scrollWidth ?? 0,
      ticks,
    };
  });
}

function assertTimelineLayout(layout, expectedWidth) {
  assert(layout.viewport.width === expectedWidth, `viewport width ${layout.viewport.width} != ${expectedWidth}`);
  for (const [name, box] of Object.entries({
    timelineView: layout.timelineView,
    shell: layout.shell,
    library: layout.library,
    content: layout.content,
    header: layout.header,
    toolbar: layout.toolbar,
    ruler: layout.ruler,
    tracks: layout.tracks,
    canvas: layout.canvas,
    inspector: layout.inspector,
    scroll: layout.scroll,
  })) {
    assert(box && box.width > 0 && box.height > 0, `${name} has no usable geometry`);
  }
  assert(layout.timelineScrollWidth <= layout.timelineClientWidth + 1, 'Timeline Desk leaks horizontal overflow outside its own timeline scroller');
  if (expectedWidth > 800) {
    assert(layout.library.right <= layout.content.left + 1, 'wide Timeline library overlaps content');
    assert(layout.canvas.right <= layout.inspector.left + 1, 'wide Timeline canvas overlaps inspector');
    assert(layout.summaryVisible === false, 'wide Timeline disclosure summary should be hidden');
  } else {
    assert(layout.library.bottom <= layout.content.top + 1, 'compact Timeline library overlaps content');
    assert(layout.canvas.bottom <= layout.inspector.top + 1, 'compact Timeline canvas overlaps inspector');
    assert(layout.summaryVisible === true, 'compact Timeline disclosure summary is not visible');
  }
  const labels = layout.ticks.map((tick) => tick.label);
  const values = layout.ticks.map((tick) => tick.valueMs);
  assert(new Set(labels).size === labels.length, `timeline tick labels repeat: ${labels.join(', ')}`);
  assert(new Set(values).size === values.length, `timeline tick values repeat: ${values.join(', ')}`);
  for (let index = 1; index < layout.ticks.length; index += 1) {
    const previous = layout.ticks[index - 1];
    const current = layout.ticks[index];
    assert(current.valueMs > previous.valueMs, 'timeline ticks are not strictly increasing');
    assert(previous.right <= current.left + 0.5, `timeline ticks overlap: ${previous.label} / ${current.label}`);
  }
}

async function inspectPageScaleControl(page, selector) {
  const locator = page.locator(selector);
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await locator.focus();
  return locator.evaluate((element, evaluatedSelector) => {
    const box = element.getBoundingClientRect();
    const visual = window.visualViewport;
    const bounds = {
      left: visual?.offsetLeft ?? 0,
      top: visual?.offsetTop ?? 0,
      right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
      bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
    };
    return {
      selector: evaluatedSelector,
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      visualBounds: bounds,
      focused: document.activeElement === element,
      horizontallyVisible: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
      verticallyVisible: box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1,
    };
  }, selector);
}

async function verifyPageScaleCommands(page, cdp) {
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.waitForFunction(() => Math.abs((window.visualViewport?.scale ?? 1) - 2) < 0.05);
  const selectors = [
    '[data-action="undo"]',
    '.timeline-new',
    '[data-timeline-focus="timeline-duration"]',
    '.timeline-header-actions .primary',
    '[data-timeline-focus="view-fit"]',
    '[data-timeline-focus="add-track"]',
  ];
  const controls = [];
  for (const selector of selectors) {
    const evidence = await inspectPageScaleControl(page, selector);
    assert(evidence.focused, `page-scale command did not receive keyboard focus: ${selector}`);
    assert(evidence.horizontallyVisible && evidence.verticallyVisible, `page-scale command is outside the visual viewport: ${selector}`);
    controls.push(evidence);
  }
  const zoomIn = page.locator('[data-timeline-focus="view-zoom-in"]');
  await zoomIn.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await zoomIn.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.timeline-zoom-value')?.textContent === '125%');
  const fit = page.locator('[data-timeline-focus="view-fit"]');
  await fit.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await fit.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.timeline-zoom-value')?.textContent === '100%');
  const viewport = await page.evaluate(() => ({
    layoutWidth: window.innerWidth,
    layoutHeight: window.innerHeight,
    visualWidth: window.visualViewport?.width ?? window.innerWidth,
    visualHeight: window.visualViewport?.height ?? window.innerHeight,
    visualScale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
  }));
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.waitForFunction(() => Math.abs((window.visualViewport?.scale ?? 1) - 1) < 0.05);
  return { controls, viewport, activated: ['view-zoom-in', 'view-fit'] };
}

function evidenceClassFor(mode) {
  if (mode === 'formal') return 'EDITOR_TIMELINE_DESK_BROWSER_FORMAL';
  if (mode === 'diagnostic') return 'EDITOR_TIMELINE_DESK_BROWSER_DIAGNOSTIC';
  return 'EDITOR_TIMELINE_DESK_BROWSER_PREFLIGHT';
}

async function run() {
  const mode = parseMode(process.argv.slice(2));
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-editorial-timeline-desk-3b-${mode}-`));
  const evidencePath = path.join(artifactDirectory, 'evidence.json');
  const identityPath = path.join(artifactDirectory, 'identity.json');
  const runner = readFileIdentity(runnerPath);
  const runnerSha256 = runner.sha256;
  const runHead = gitOutput(['rev-parse', 'HEAD']);
  const codeEvidenceHead = process.env.SURDET_CODE_EVIDENCE_HEAD ?? null;
  const trackedCodeDiffPaths = trackedCodePaths();
  let runnerHeadIdentity = null;
  const syntax = runCommand(process.execPath, ['--check', runnerPath], { cwd: repoRoot });
  assert(syntax.status === 0, `runner syntax failed: ${syntax.stderr || syntax.stdout}`);
  if (mode === 'formal') {
    assert(typeof codeEvidenceHead === 'string' && codeEvidenceHead.length > 0, 'FORMAL requires SURDET_CODE_EVIDENCE_HEAD');
    assert(runHead === codeEvidenceHead, `FORMAL runHead ${runHead} != code evidence ${codeEvidenceHead}`);
    assert(trackedCodeDiffPaths.length === 0, `FORMAL tracked code diff is not empty: ${trackedCodeDiffPaths.join(', ')}`);
    runnerHeadIdentity = runnerIdentityAtHead();
    assert(runnerHeadIdentity.sha256 === runnerSha256, `FORMAL runner bytes differ from HEAD: ${runnerSha256} != ${runnerHeadIdentity.sha256}`);
  }

  const starterBefore = hashProjectTree(starterRoot);
  const { files: fixtureFiles, fixtureAugmentations } = augmentStarterFixture();
  const expectedProjectName = JSON.parse(mapFileText(fixtureFiles, 'game.config.json')).title;
  const injectedBefore = browserFileMapTreeIdentity(fixtureFiles);
  const milestones = [];
  const preflightChecks = [];
  const screenshots = [];
  const errors = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseFailures = [];
  const childCleanupFailures = [];
  const serverStdout = [];
  const serverStderr = [];
  const channels = { consoleErrors, pageErrors, requestFailures, responseFailures };
  const pass = (name, evidence = {}) => milestones.push({ name, status: 'passed', evidence });
  const preflightPass = (name, evidence = {}) => preflightChecks.push({ name, status: 'passed', evidence });
  let browser = null;
  let firstContext = null;
  let secondContext = null;
  let firstPage = null;
  let secondPage = null;
  let cdp = null;
  let server = null;
  let port = null;
  let portReleased = false;
  let baseUrl = null;
  let opened = null;
  let savedFiles = null;
  let injectedAfterSave = null;
  let layoutEvidence = null;
  let historyEvidence = null;
  let timelineEditScrollProbeEvidence = null;
  let previewReceiptProbeEvidence = null;
  let compactLayoutProbeEvidence = null;
  let saveEvidence = null;
  let coldReopenEvidence = null;
  let failure = null;

  try {
    port = await chooseStrictPort();
    assert(!forbiddenPorts.has(port), `forbidden port selected: ${port}`);
    if (mode === 'preflight') preflightPass('strict-isolated-port-selected', { port, forbiddenPorts: FORBIDDEN_PORTS, searchRange: SEARCH_RANGE });
    else pass('strict-isolated-port-selected', { port, forbiddenPorts: FORBIDDEN_PORTS, searchRange: SEARCH_RANGE });

    const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    assert(fs.existsSync(viteBin), `Vite launcher missing: ${viteBin}`);
    server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: editorRoot,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    server.stdout.setEncoding('utf8');
    server.stderr.setEncoding('utf8');
    server.stdout.on('data', (chunk) => serverStdout.push(chunk));
    server.stderr.on('data', (chunk) => serverStderr.push(chunk));
    baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(server, `${baseUrl}/index.html`);
    if (mode === 'preflight') preflightPass('isolated-vite-ready', { baseUrl, pid: server.pid });
    else pass('isolated-vite-ready', { baseUrl, pid: server.pid });

    browser = await chromium.launch({ headless: true });
    firstContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    firstPage = await firstContext.newPage();
    observePage(firstPage, channels);
    await firstPage.addInitScript(fakeFileSystemInit, { rootName: 'starter', files: fixtureFiles });
    await firstPage.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    assert(await firstPage.title() === 'Surdet 剧本编辑器', `unexpected Editor title: ${await firstPage.title()}`);

    if (mode === 'preflight') {
      const preflightDump = await firstPage.evaluate(() => window.__surdetDumpFakeRoot());
      const preflightIdentity = browserFileMapTreeIdentity(preflightDump);
      assert(preflightIdentity.sha256 === injectedBefore.sha256, 'preflight fake fixture changed before project open');
      preflightPass('runner-syntax-valid', { exitCode: syntax.status });
      preflightPass('starter-derived-fixture-ready', { injectedBefore, fixtureAugmentations });
      preflightPass('editor-title-confirmed', { title: await firstPage.title() });
    } else {
      opened = await openFixture(firstPage);
      assert(opened.projectName === expectedProjectName, `project bar did not show configured title: ${opened.projectName}`);
      assert(opened.sceneCount === 7, `expected seven Starter scenes, got ${opened.sceneCount}`);
      assert(opened.timelineCount === 3, `expected three current harbor timeline fixtures, got ${opened.timelineCount}`);
      assert(opened.assetCount >= 6, `expected real Starter assets, got ${opened.assetCount}`);
      pass('fixture-opened-through-picker', opened);

      const screenplayBoundary = await firstPage.evaluate(() => ({
        mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
        editorWorkspaceCount: document.querySelectorAll('#editor-workspace').length,
        timelineShellCount: document.querySelectorAll('.timeline-shell').length,
        timelineViewCount: document.querySelectorAll('#timeline-view').length,
      }));
      assert(screenplayBoundary.mainTab === 'editor', `unexpected initial mode ${screenplayBoundary.mainTab}`);
      assert(screenplayBoundary.editorWorkspaceCount === 1, 'screenplay workbench is not singular');
      assert(screenplayBoundary.timelineShellCount === 0 && screenplayBoundary.timelineViewCount === 0, 'screenplay mode mounted a Timeline Dock');
      pass('screenplay-dock-absent', screenplayBoundary);

      await enterTimelineDesk(firstPage);
      const singleTruth = await firstPage.evaluate(() => ({
        mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
        timelineViewCount: document.querySelectorAll('#timeline-view').length,
        shellCount: document.querySelectorAll('#timeline-view .timeline-shell').length,
        libraryCount: document.querySelectorAll('#timeline-view .timeline-library').length,
        headerCount: document.querySelectorAll('#timeline-view .timeline-header').length,
        inspectorCount: document.querySelectorAll('#timeline-view .timeline-inspector').length,
        previewCount: document.querySelectorAll('#preview-view, #timeline-view iframe').length,
      }));
      assert(singleTruth.mainTab === 'timeline', `unexpected Timeline mode ${singleTruth.mainTab}`);
      assert(singleTruth.timelineViewCount === 1 && singleTruth.shellCount === 1, 'Timeline surface is not singular');
      assert(singleTruth.libraryCount === 1 && singleTruth.headerCount === 1 && singleTruth.inspectorCount === 1, 'Timeline Desk semantic regions are incomplete');
      assert(singleTruth.previewCount === 0, 'Timeline Desk embedded a second Preview surface');
      pass('timeline-surface-single-truth', singleTruth);

      await selectTimeline(firstPage, editedTimelineId);
      const identityEvidence = await timelineIdentity(firstPage, editedTimelineId);
      assert(identityEvidence.stateId === editedTimelineId, 'state current Timeline disagrees');
      assert(identityEvidence.listId === editedTimelineId && identityEvidence.listLabel === editedTimelineId, 'Timeline list identity disagrees');
      assert(identityEvidence.headerId === editedTimelineId, 'Timeline header identity disagrees');
      assert(identityEvidence.projectBar === `时间轴 ${editedTimelineId}`, `Project Bar identity disagrees: ${identityEvidence.projectBar}`);
      const timelineSearch = firstPage.locator('.timeline-search');
      await timelineSearch.fill('cinematic');
      const searchFilteringEvidence = await firstPage.evaluate(() => [...document.querySelectorAll('.timeline-item[data-timeline-id]')].map((item) => ({
        id: item.getAttribute('data-timeline-id'),
        hidden: item.hidden,
      })));
      assert(searchFilteringEvidence.find((item) => item.id === 'harbor_cinematic')?.hidden === false, 'timeline search hid its exact match');
      assert(searchFilteringEvidence.filter((item) => item.id !== 'harbor_cinematic').every((item) => item.hidden), 'timeline search did not filter non-matching entries');
      await timelineSearch.fill('');
      assert(await firstPage.locator('.timeline-item:not([hidden])').count() === opened.timelineCount, 'clearing timeline search did not restore the library');
      pass('timeline-identity-consistent', { ...identityEvidence, searchFilteringEvidence });

      const localized = await localizedProjection(firstPage);
      assert(localized.background?.value === 'background' && localized.background.label === '背景', 'background enum/display projection failed');
      assert(localized.portrait?.value === 'portrait' && localized.portrait.label === '角色立绘', 'portrait enum/display projection failed');
      assert(localized.addAction?.value === 'set' && localized.addAction.label === '设置背景', 'action enum/display projection failed');
      assert(localized.inspectorAction?.value === 'set' && localized.inspectorAction.label === '设置背景', 'Inspector action projection failed');
      assert(localized.inspectorEasing?.value === 'linear' && localized.inspectorEasing.label === '匀速', 'easing enum/display projection failed');
      assert(localized.sameKeyExpressionEvidence.selectedOption?.endsWith('normal'), `same-key portrait expression drifted: ${localized.sameKeyExpressionEvidence.selectedOption}`);
      assert(localized.sameKeyExpressionEvidence.sameKeyOptions.length >= 3, 'same-key portrait expression choices are incomplete');
      assert(localized.localizedPositionBefore.modeValue === 'custom' && localized.localizedPositionBefore.modeLabel === '自定义横坐标', 'custom portrait coordinate mode is not localized');
      assert(localized.localizedPositionBefore.customValue === '3000', 'custom portrait coordinate is not displayed exactly');
      assert(localized.localizedPositionEvidence.modeValue === 'custom' && localized.localizedPositionEvidence.customValue === '3000' && localized.localizedPositionEvidence.serializedPosition === '3000', 'custom portrait coordinate did not write back canonically');
      assert(localized.standardPositionEvidence.value === 'center' && localized.standardPositionEvidence.label === '中央', 'standard portrait position is not localized');
      assert(localized.standardPositionEvidence.serializedPosition === 'center', 'standard portrait position did not retain its stable English enum');
      assert(localized.instantMarkerEvidence.count >= 1 && localized.instantMarkerEvidence.durationMs === '0' && localized.instantMarkerEvidence.width >= 30, '0ms cue has no usable instant marker');
      assert(localized.instantMarkerEvidence.widthRatio > 0 && localized.instantMarkerEvidence.widthRatio < 0.5, '0ms cue incorrectly occupies the full Timeline lane');
      for (const phrase of ['演出片段库', '当前演出', '演出轨道', '片段设置']) {
        assert(localized.shellText.includes(phrase), `Timeline Desk missing Chinese phrase: ${phrase}`);
      }
      pass('localized-stable-enums', localized);

      await firstPage.locator('.timeline-cue').first().click();
      const selectedBeforeSwitch = await stateSnapshot(firstPage);
      assert(selectedBeforeSwitch.currentTimelineCue?.trackIndex === 0 && selectedBeforeSwitch.currentTimelineCue?.cueIndex === 0, 'cue selection did not bind to the current Timeline');
      await selectTimeline(firstPage, 'harbor_cinematic');
      const afterTimelineSwitch = await stateSnapshot(firstPage, 'harbor_cinematic');
      assert(afterTimelineSwitch.currentTimelineCue === null, 'cue selection leaked across Timeline selection');
      await selectTimeline(firstPage, editedTimelineId);
      await firstPage.locator('.timeline-cue').first().click();
      const selectedAgain = await stateSnapshot(firstPage);
      assert(selectedAgain.currentTimeline === editedTimelineId && selectedAgain.currentTimelineCue?.trackIndex === 0, 'cue selection did not return to the selected Timeline');
      pass('cue-selection-scoped', {
        selectedBeforeSwitch: selectedBeforeSwitch.currentTimelineCue,
        afterTimelineSwitch: afterTimelineSwitch.currentTimelineCue,
        selectedAgain: selectedAgain.currentTimelineCue,
      });

      const beforeEdit = await stateSnapshot(firstPage);
      assert(beforeEdit.timeline?.eol === '\r\n', `fixture Timeline EOL is ${JSON.stringify(beforeEdit.timeline?.eol)}`);
      assert(beforeEdit.timelines.every((entry) => entry.dirty === false), 'Timeline edit baseline was already dirty');
      assert(beforeEdit.scenes.every((scene) => scene.dirty === false), 'screenplay edit baseline was already dirty');
      const sceneBytesBefore = sceneTextIdentity(beforeEdit.scenes);
      const otherTimelinesBefore = beforeEdit.timelines
        .filter((entry) => entry.id !== editedTimelineId)
        .map((entry) => ({ id: entry.id, sha256: sha256(Buffer.from(entry.text, 'utf8')), dirty: entry.dirty }));
      for (let index = 0; index < 8; index += 1) {
        await firstPage.locator('[data-timeline-focus="view-zoom-in"]').click();
      }
      await firstPage.waitForFunction(() => document.querySelector('.timeline-zoom-value')?.textContent === '300%');
      const scrollBeforeEdit = await firstPage.locator('.timeline-scroll').evaluate((scroll) => {
        scroll.scrollLeft = scroll.scrollWidth;
        return {
          scrollLeft: scroll.scrollLeft,
          maxScrollLeft: Math.max(0, scroll.scrollWidth - scroll.clientWidth),
          scrollWidth: scroll.scrollWidth,
          clientWidth: scroll.clientWidth,
        };
      });
      assert(scrollBeforeEdit.scrollLeft > 0 && scrollBeforeEdit.maxScrollLeft > 0, 'long Timeline did not expose a horizontal editing range');
      const duration = firstPage.locator('[data-timeline-focus="timeline-duration"]');
      await duration.fill(String(editedDurationMs));
      await duration.press('Tab');
      await firstPage.waitForFunction(({ id, expected }) => {
        const entry = window.surdetEditorDebug?.state?.timelines?.find((candidate) => candidate.id === id);
        return Boolean(entry?.dirty && JSON.parse(entry.text).durationMs === expected);
      }, { id: editedTimelineId, expected: editedDurationMs });
      const afterEdit = await stateSnapshot(firstPage);
      const sceneBytesAfterEdit = sceneTextIdentity(afterEdit.scenes);
      assert(sceneBytesAfterEdit.sha256 === sceneBytesBefore.sha256, 'Timeline edit changed screenplay scene bytes');
      assert(afterEdit.scenes.every((scene) => scene.dirty === false), 'Timeline edit marked a screenplay scene dirty');
      assert(afterEdit.timelines.filter((entry) => entry.id !== editedTimelineId).every((entry) => entry.dirty === false), 'Timeline edit marked another Timeline dirty');
      assert(afterEdit.timeline?.eol === '\r\n', 'Timeline edit normalized CRLF');
      const longScrollEvidence = await firstPage.locator('.timeline-scroll').evaluate(async (scroll, expectedScrollLeft) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          expectedScrollLeft,
          scrollLeft: scroll.scrollLeft,
          maxScrollLeft: Math.max(0, scroll.scrollWidth - scroll.clientWidth),
          scrollWidth: scroll.scrollWidth,
          clientWidth: scroll.clientWidth,
        };
      }, scrollBeforeEdit.scrollLeft);
      timelineEditScrollProbeEvidence = longScrollEvidence;
      assert(longScrollEvidence.scrollLeft === scrollBeforeEdit.scrollLeft, 'long Timeline edit did not preserve scrollLeft');
      const dirtyProjection = await firstPage.evaluate(() => ({
        header: document.querySelector('.timeline-title-meta')?.textContent ?? '',
        saveState: document.querySelector('.editor-save-state')?.getAttribute('data-save-state') ?? null,
        projectBar: document.querySelector('.editor-current-object')?.textContent ?? null,
      }));
      assert(dirtyProjection.header.includes('尚未保存') && dirtyProjection.saveState === 'dirty', 'Timeline-only dirty state is not visible');
      pass('timeline-only-dirty', {
        sceneBytesBefore,
        sceneBytesAfterEdit,
        otherTimelinesBefore,
        longScrollEvidence,
        dirtyProjection,
        timeline: { id: afterEdit.timeline.id, eol: 'CRLF', dirty: afterEdit.timeline.dirty },
      });

      await firstPage.locator('[data-action="undo"]').click();
      await firstPage.waitForFunction(({ id, expected }) => (
        JSON.parse(window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text).durationMs === expected
      ), { id: editedTimelineId, expected: originalEditedDurationMs });
      const afterUndo = await stateSnapshot(firstPage);
      const sceneBytesAfterUndo = sceneTextIdentity(afterUndo.scenes);
      assert(sceneBytesAfterUndo.sha256 === sceneBytesBefore.sha256, 'Timeline undo changed screenplay scene bytes');
      assert(afterUndo.timeline.text === beforeEdit.timeline.text, 'Timeline undo did not restore exact CRLF text');
      await firstPage.locator('[data-action="redo"]').click();
      await firstPage.waitForFunction(({ id, expected }) => JSON.parse(window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text).durationMs === expected, {
        id: editedTimelineId,
        expected: editedDurationMs,
      });
      const afterRedo = await stateSnapshot(firstPage);
      const sceneBytesAfterRedo = sceneTextIdentity(afterRedo.scenes);
      assert(sceneBytesAfterRedo.sha256 === sceneBytesBefore.sha256, 'Timeline redo changed screenplay scene bytes');
      assert(afterRedo.timeline.eol === '\r\n', 'Timeline redo normalized CRLF');
      const scrollBeforeModeRoundTrip = await firstPage.locator('.timeline-scroll').evaluate(async (scroll) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return scroll.scrollLeft;
      });
      historyEvidence = {
        preModeRoundTripScrollEvidence: {
          expectedScrollLeft: longScrollEvidence.scrollLeft,
          actualScrollLeft: scrollBeforeModeRoundTrip,
        },
      };
      assert(scrollBeforeModeRoundTrip === longScrollEvidence.scrollLeft, 'Timeline redo did not restore scrollLeft before mode round-trip');
      await firstPage.locator('[data-editor-mode="config"]').click();
      await firstPage.locator('#config-view').waitFor({ state: 'visible' });
      await firstPage.locator('[data-editor-mode="timeline"]').click();
      await firstPage.locator('#timeline-view .timeline-shell').waitFor({ state: 'visible' });
      const modeRoundTripScrollEvidence = await firstPage.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          currentTimeline: window.surdetEditorDebug.state.currentTimeline,
          scrollLeft: document.querySelector('.timeline-scroll')?.scrollLeft ?? null,
          zoom: document.querySelector('.timeline-zoom-value')?.textContent ?? null,
        };
      });
      historyEvidence = {
        ...historyEvidence,
        expectedModeRoundTripScrollLeft: scrollBeforeModeRoundTrip,
        modeRoundTripScrollEvidence,
      };
      assert(modeRoundTripScrollEvidence.currentTimeline === editedTimelineId, 'Timeline→Configuration→Timeline changed the selected Timeline');
      assert(modeRoundTripScrollEvidence.scrollLeft === scrollBeforeModeRoundTrip, 'Timeline→Configuration→Timeline did not preserve scrollLeft');
      assert(modeRoundTripScrollEvidence.zoom === '300%', 'Timeline→Configuration→Timeline did not preserve zoom');
      longScrollEvidence.modeRoundTripScrollEvidence = modeRoundTripScrollEvidence;
      historyEvidence = {
        ...historyEvidence,
        sceneBytesBefore,
        sceneBytesAfterUndo,
        sceneBytesAfterRedo,
        beforeTimelineSha256: sha256(Buffer.from(beforeEdit.timeline.text, 'utf8')),
        afterUndoTimelineSha256: sha256(Buffer.from(afterUndo.timeline.text, 'utf8')),
        afterRedoDurationMs: JSON.parse(afterRedo.timeline.text).durationMs,
      };
      await firstPage.locator('[data-timeline-focus="view-fit"]').click();
      await firstPage.waitForFunction(() => document.querySelector('.timeline-zoom-value')?.textContent === '100%');
      const { newCueFocusEvidence, cueDeleteUndoEvidence, resizeConsistencyEvidence, pointerCancelEvidence } = await verifyCueInteractionSeams(firstPage);
      historyEvidence.interactionSeams = {
        newCueFocusEvidence,
        cueDeleteUndoEvidence,
        resizeConsistencyEvidence,
        pointerCancelEvidence,
      };
      pass('timeline-history-scene-isolated', historyEvidence);

      await selectTimeline(firstPage, deletedTimelineId);
      const beforeCancel = await stateSnapshot(firstPage, deletedTimelineId);
      const cancelDialog = firstPage.waitForEvent('dialog').then(async (dialog) => {
        const message = dialog.message();
        await dialog.dismiss();
        return message;
      });
      await firstPage.getByRole('button', { name: '删除演出', exact: true }).click();
      const cancelMessage = await cancelDialog;
      const afterCancel = await stateSnapshot(firstPage, deletedTimelineId);
      assert(afterCancel.timelines.map((entry) => entry.id).join('\0') === beforeCancel.timelines.map((entry) => entry.id).join('\0'), 'cancelled Timeline deletion changed list order');
      assert(afterCancel.timeline.text === beforeCancel.timeline.text, 'cancelled Timeline deletion changed bytes');
      assert(afterCancel.pendingTimelineRestoreIds.length === 0, 'cancelled Timeline deletion created a tombstone');
      pass('destructive-cancel-noop', { dialog: cancelMessage, timelineId: deletedTimelineId });

      const acceptDialog = firstPage.waitForEvent('dialog').then(async (dialog) => {
        const message = dialog.message();
        await dialog.accept();
        return message;
      });
      await firstPage.getByRole('button', { name: '删除演出', exact: true }).click();
      const acceptMessage = await acceptDialog;
      await firstPage.getByRole('button', { name: '撤销删除', exact: true }).waitFor({ state: 'visible' });
      const afterConfirm = await stateSnapshot(firstPage, deletedTimelineId);
      assert(afterConfirm.timeline === null, 'confirmed Timeline deletion left the Timeline active');
      assert(afterConfirm.pendingTimelineRestoreIds.includes(deletedTimelineId), 'confirmed Timeline deletion did not create a tombstone');
      await firstPage.getByRole('button', { name: '撤销删除', exact: true }).click();
      const afterRestore = await stateSnapshot(firstPage, deletedTimelineId);
      assert(afterRestore.timeline?.text === beforeCancel.timeline.text, 'Timeline deletion recovery did not restore exact bytes');
      assert(afterRestore.timeline?.eol === beforeCancel.timeline.eol, 'Timeline deletion recovery did not restore EOL');
      assert(afterRestore.timelines.map((entry) => entry.id).join('\0') === beforeCancel.timelines.map((entry) => entry.id).join('\0'), 'Timeline deletion recovery did not restore list order');
      assert(afterRestore.pendingTimelineRestoreIds.length === 0 && afterRestore.pendingTimelineDeletes.length === 0, 'Timeline deletion recovery left pending state');
      await selectTimeline(firstPage, editedTimelineId);
      const trackTimelineBeforeDelete = await stateSnapshot(firstPage, editedTimelineId);
      const trackTextBeforeDelete = trackTimelineBeforeDelete.timeline.text;
      const trackCountBeforeDelete = JSON.parse(trackTextBeforeDelete).tracks.length;
      const trackDeleteDialog = firstPage.waitForEvent('dialog').then(async (dialog) => {
        const message = dialog.message();
        await dialog.accept();
        return message;
      });
      await firstPage.locator('.track-remove').last().click();
      const trackDeleteMessage = await trackDeleteDialog;
      await firstPage.waitForFunction(({ id, expected }) => {
        const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
        return JSON.parse(entry.text).tracks.length === expected;
      }, { id: editedTimelineId, expected: trackCountBeforeDelete - 1 });
      const trackDeleteFocus = await firstPage.evaluate(() => ({
        activeElementIsBody: document.activeElement === document.body,
        activeTimelineFocus: document.activeElement?.getAttribute('data-timeline-focus') ?? null,
      }));
      assert(!trackDeleteFocus.activeElementIsBody && trackDeleteFocus.activeTimelineFocus?.endsWith('-add'), 'deleting the last removable track dropped keyboard focus');
      await firstPage.locator('[data-action="undo"]').click();
      await firstPage.waitForFunction(({ id, text }) => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === id).text === text, {
        id: editedTimelineId,
        text: trackTextBeforeDelete,
      });
      const trackDeleteUndoEvidence = {
        dialog: trackDeleteMessage,
        timelineId: editedTimelineId,
        trackCountBeforeDelete,
        trackCountAfterDelete: trackCountBeforeDelete - 1,
        trackDeleteFocus,
        exactTextRestored: true,
      };
      pass('destructive-confirm-undo-restore', {
        dialog: acceptMessage,
        timelineId: deletedTimelineId,
        restoredSha256: sha256(Buffer.from(afterRestore.timeline.text, 'utf8')),
        restoredOrder: afterRestore.timelines.map((entry) => entry.id),
        trackDeleteUndoEvidence,
      });

      await selectTimeline(firstPage, editedTimelineId);
      await firstPage.evaluate(() => {
        window.__surdetTimelineDeskPreviewReady = false;
        window.__surdetTimelineDeskPreviewMessages = [];
        const collector = (event) => {
          const frame = document.querySelector('#preview-view iframe.preview-frame[title="剧情预览"]');
          const data = event.data;
          if (event.source !== frame?.contentWindow || !data || typeof data.type !== 'string' || !data.type.startsWith('surdet-preview-')) return;
          window.__surdetTimelineDeskPreviewMessages.push({
            type: data.type,
            traceId: typeof data.traceId === 'string' ? data.traceId : null,
            generation: Number.isInteger(data.generation) ? data.generation : Number.isInteger(data.diagnostic?.generation) ? data.diagnostic.generation : null,
            sequence: Number.isInteger(data.sequence) ? data.sequence : null,
            eventKind: typeof data.event?.kind === 'string' ? data.event.kind : null,
            sourceOp: typeof data.event?.source?.op === 'string' ? data.event.source.op : null,
            phase: typeof data.diagnostic?.phase === 'string' ? data.diagnostic.phase : null,
            level: typeof data.diagnostic?.level === 'string' ? data.diagnostic.level : null,
            message: typeof data.diagnostic?.message === 'string' ? data.diagnostic.message : null,
          });
        };
        window.__surdetTimelineDeskPreviewCollector = collector;
        window.addEventListener('message', collector);
        const listener = (event) => {
          const frame = document.querySelector('#preview-view iframe.preview-frame[title="剧情预览"]');
          if (event.data?.type !== 'surdet-preview-ready' || event.source !== frame?.contentWindow) return;
          window.__surdetTimelineDeskPreviewReady = true;
          window.removeEventListener('message', listener);
        };
        window.addEventListener('message', listener);
      });
      await firstPage.getByRole('button', { name: '▶ 预览演出', exact: true }).click();
      await firstPage.waitForFunction((id) => (
        window.surdetEditorDebug?.state?.mainTab === 'preview'
          && window.surdetEditorDebug?.state?.previewTimelineId === id
      ), editedTimelineId);
      const previewFrameElement = await firstPage.locator('#preview-view iframe.preview-frame[title="剧情预览"]').elementHandle();
      assert(previewFrameElement, 'preview handoff did not create an iframe');
      const previewFrame = await previewFrameElement.contentFrame();
      assert(previewFrame, 'preview iframe has no browser frame');
      await previewFrame.waitForURL((url) => url.pathname.endsWith('/preview.html'), { timeout: 10_000 });
      await firstPage.waitForFunction(() => window.__surdetTimelineDeskPreviewReady === true, undefined, { timeout: 10_000 });
      await previewFrame.waitForLoadState('networkidle', { timeout: 10_000 });
      const previewFrameEvidence = await previewFrame.evaluate(() => ({
        url: location.href,
        readyState: document.readyState,
        bodyPresent: document.body !== null,
        runtimeReady: Boolean(window.surdetPreviewDebug?.runtime),
        canvasCount: document.querySelectorAll('#preview-root canvas').length,
      }));
      previewFrameEvidence.readySignal = await firstPage.evaluate(() => window.__surdetTimelineDeskPreviewReady === true);
      assert(
        new URL(previewFrameEvidence.url).pathname.endsWith('/preview.html')
          && previewFrameEvidence.readyState === 'complete'
          && previewFrameEvidence.bodyPresent
          && previewFrameEvidence.runtimeReady
          && previewFrameEvidence.canvasCount === 1
          && previewFrameEvidence.readySignal,
        'preview iframe module graph/runtime did not settle',
      );
      const capturePreviewReceiptProbe = async (stage) => ({
        stage,
        parent: await firstPage.evaluate(() => ({
          previewTimelineId: window.surdetEditorDebug?.state?.previewTimelineId ?? null,
          previewTrace: (window.surdetEditorDebug?.state?.previewTrace ?? []).map((event) => ({
            kind: event.kind,
            sourceOp: event.source?.op ?? null,
            sourceSceneId: event.source?.sceneId ?? null,
            sourceLine: event.source?.line ?? null,
          })),
          diagnosticsText: document.querySelector('.preview-diagnostics')?.textContent ?? null,
          traceText: document.querySelector('.preview-trace-list')?.textContent ?? null,
          messages: [...(window.__surdetTimelineDeskPreviewMessages ?? [])],
        })),
        child: await previewFrame.evaluate(() => ({
          url: location.href,
          interpreterPresent: Boolean(window.surdetPreviewDebug?.interp),
          runtimePresent: Boolean(window.surdetPreviewDebug?.runtime),
          rendererStatus: window.surdetPreviewDebug?.rendererStatus ?? null,
          canvasCount: document.querySelectorAll('#preview-root canvas').length,
          errorText: document.querySelector('#preview-error')?.textContent ?? null,
        })),
      });
      try {
        await firstPage.waitForFunction((id) => (
          window.surdetEditorDebug?.state?.previewTimelineId === id
            && window.surdetEditorDebug?.state?.previewTrace?.some((event) => event.source?.op === 'timeline')
        ), editedTimelineId, { timeout: 10_000 });
      } catch (error) {
        previewReceiptProbeEvidence = await capturePreviewReceiptProbe('initial-timeline-trace-timeout');
        throw new Error(`initial direct-Timeline receipt missing: ${JSON.stringify(previewReceiptProbeEvidence)}`, { cause: error });
      }
      const initialTimelineTraceEvidence = await firstPage.evaluate(() => ({
        eventCount: window.surdetEditorDebug.state.previewTrace.length,
        timelineInstructionCount: window.surdetEditorDebug.state.previewTrace.filter((event) => event.source?.op === 'timeline').length,
      }));
      await firstPage.getByRole('button', { name: '重新播放', exact: true }).click();
      try {
        await firstPage.waitForFunction((id) => (
          window.surdetEditorDebug?.state?.mainTab === 'preview'
            && window.surdetEditorDebug?.state?.previewTimelineId === id
            && window.surdetEditorDebug?.state?.previewTrace?.some((event) => event.source?.op === 'timeline')
        ), editedTimelineId, { timeout: 10_000 });
      } catch (error) {
        previewReceiptProbeEvidence = await capturePreviewReceiptProbe('replay-timeline-trace-timeout');
        throw new Error(`replayed direct-Timeline receipt missing: ${JSON.stringify(previewReceiptProbeEvidence)}`, { cause: error });
      }
      previewReceiptProbeEvidence = await capturePreviewReceiptProbe('replay-timeline-trace-received');
      const previewHandoff = await firstPage.evaluate(() => ({
        mainTab: window.surdetEditorDebug.state.mainTab,
        previewTimelineId: window.surdetEditorDebug.state.previewTimelineId,
        replayTraceEventCount: window.surdetEditorDebug.state.previewTrace.length,
        replayTimelineInstructionCount: window.surdetEditorDebug.state.previewTrace.filter((event) => event.source?.op === 'timeline').length,
        previewViewCount: document.querySelectorAll('#preview-view').length,
        timelineViewCount: document.querySelectorAll('#timeline-view').length,
        projectBar: document.querySelector('.editor-current-object')?.textContent ?? null,
      }));
      previewHandoff.previewFrame = previewFrameEvidence;
      previewHandoff.initialTimelineTrace = initialTimelineTraceEvidence;
      previewHandoff.replayPreservedTimelineId = previewHandoff.previewTimelineId === editedTimelineId;
      assert(previewHandoff.previewViewCount === 1 && previewHandoff.timelineViewCount === 0, 'preview handoff duplicated Timeline/Preview surfaces');
      assert(previewHandoff.projectBar === `时间轴 ${editedTimelineId}`, 'Preview project bar lost selected Timeline identity');
      assert(previewHandoff.replayPreservedTimelineId, 'Preview replay lost selected Timeline identity');
      assert(previewHandoff.replayTraceEventCount > 0, 'Preview replay did not reach a fresh runtime trace event');
      assert(previewHandoff.replayTimelineInstructionCount > 0, 'Preview replay did not execute the direct Timeline instruction');
      pass('selected-timeline-preview-handoff', previewHandoff);
      await firstPage.evaluate(() => {
        if (window.__surdetTimelineDeskPreviewCollector) {
          window.removeEventListener('message', window.__surdetTimelineDeskPreviewCollector);
          window.__surdetTimelineDeskPreviewCollector = null;
        }
      });
      await firstPage.locator('[data-editor-mode="timeline"]').click();
      await firstPage.locator('#timeline-view .timeline-shell').waitFor({ state: 'visible' });
      await selectTimeline(firstPage, editedTimelineId);

      layoutEvidence = {};
      for (const viewport of VIEWPORTS) {
        await firstPage.setViewportSize({ width: viewport.width, height: viewport.height });
        let compactDisclosureEvidence = null;
        if (viewport.id === '800') {
          const libraryDetails = firstPage.locator('details.timeline-library');
          const inspectorDetails = firstPage.locator('details.timeline-inspector');
          const afterResize = await firstPage.evaluate(async () => {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {
              libraryOpen: document.querySelector('details.timeline-library')?.open ?? null,
              inspectorOpen: document.querySelector('details.timeline-inspector')?.open ?? null,
            };
          });
          if (await libraryDetails.getAttribute('open') !== null) await libraryDetails.locator(':scope > summary').click();
          if (await inspectorDetails.getAttribute('open') !== null) await inspectorDetails.locator(':scope > summary').click();
          await firstPage.waitForFunction(() => (
            document.querySelector('details.timeline-library')?.open === false
              && document.querySelector('details.timeline-inspector')?.open === false
          ));
          const afterExplicitClose = await firstPage.evaluate(() => ({
            libraryOpen: document.querySelector('details.timeline-library')?.open ?? null,
            inspectorOpen: document.querySelector('details.timeline-inspector')?.open ?? null,
          }));
          const compactDuration = firstPage.locator('[data-timeline-focus="timeline-duration"]');
          await compactDuration.fill(String(editedDurationMs + 25));
          await compactDuration.press('Tab');
          const afterEdit = await firstPage.evaluate(async ({ id, expectedDurationMs }) => {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {
              expectedDurationMs,
              libraryOpen: document.querySelector('details.timeline-library')?.open ?? null,
              inspectorOpen: document.querySelector('details.timeline-inspector')?.open ?? null,
              durationMs: JSON.parse(window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id).text).durationMs,
            };
          }, { id: editedTimelineId, expectedDurationMs: editedDurationMs + 25 });
          compactDisclosureEvidence = { afterResize, afterExplicitClose, afterEdit };
          compactLayoutProbeEvidence = compactDisclosureEvidence;
          assert(afterEdit.durationMs === editedDurationMs + 25, 'compact Timeline duration edit did not commit');
          assert(!afterEdit.libraryOpen && !afterEdit.inspectorOpen, 'compact Timeline disclosures reopened after edit');
          await firstPage.locator('[data-action="undo"]').click();
          await firstPage.waitForFunction(({ expected, id }) => {
            const entry = window.surdetEditorDebug.state.timelines.find((candidate) => candidate.id === id);
            return JSON.parse(entry.text).durationMs === expected;
          }, { expected: editedDurationMs, id: editedTimelineId });
        }
        const layout = await inspectTimelineLayout(firstPage);
        assertTimelineLayout(layout, viewport.width);
        layoutEvidence[viewport.id] = { ...layout, compactDisclosureEvidence };
        await takeScreenshot(firstPage, artifactDirectory, `timeline-desk-${viewport.id}`, screenshots);
        pass(`layout-${viewport.id}`, { ...layout, compactDisclosureEvidence });
      }

      await firstPage.setViewportSize({ width: 1440, height: 900 });
      await firstPage.waitForFunction(() => {
        const libraryBody = document.querySelector('.timeline-library-body');
        const inspectorBody = document.querySelector('.timeline-inspector-body');
        return Boolean(
          libraryBody && inspectorBody
            && getComputedStyle(libraryBody).display !== 'none'
            && getComputedStyle(inspectorBody).display !== 'none'
            && libraryBody.getBoundingClientRect().height > 0
            && inspectorBody.getBoundingClientRect().height > 0,
        );
      });
      const wideAfterCompactEvidence = await firstPage.evaluate(() => ({
        libraryOpen: document.querySelector('details.timeline-library')?.open ?? null,
        inspectorOpen: document.querySelector('details.timeline-inspector')?.open ?? null,
        libraryBodyHeight: document.querySelector('.timeline-library-body')?.getBoundingClientRect().height ?? 0,
        inspectorBodyHeight: document.querySelector('.timeline-inspector-body')?.getBoundingClientRect().height ?? 0,
      }));
      assert(wideAfterCompactEvidence.libraryBodyHeight > 0 && wideAfterCompactEvidence.inspectorBodyHeight > 0, 'wide Timeline did not automatically reveal compact disclosures');
      layoutEvidence.wideAfterCompactEvidence = wideAfterCompactEvidence;

      await firstPage.setViewportSize({ width: 800, height: 700 });
      await firstPage.waitForFunction(() => {
        const library = document.querySelector('details.timeline-library');
        const inspector = document.querySelector('details.timeline-inspector');
        return library && inspector && !library.open && !inspector.open;
      });
      const compactPreferenceAfterWideEvidence = await firstPage.evaluate(() => ({
        libraryOpen: document.querySelector('details.timeline-library')?.open ?? null,
        inspectorOpen: document.querySelector('details.timeline-inspector')?.open ?? null,
      }));
      assert(!compactPreferenceAfterWideEvidence.libraryOpen && !compactPreferenceAfterWideEvidence.inspectorOpen, 'wide layout overwrote the user compact disclosure preference');
      layoutEvidence.compactPreferenceAfterWideEvidence = compactPreferenceAfterWideEvidence;
      const pageScaleLibrary = firstPage.locator('details.timeline-library');
      if (await pageScaleLibrary.getAttribute('open') === null) {
        await pageScaleLibrary.locator(':scope > summary').click();
      }
      cdp = await firstContext.newCDPSession(firstPage);
      const pageScaleEvidence = await verifyPageScaleCommands(firstPage, cdp);
      await takeScreenshot(firstPage, artifactDirectory, 'timeline-desk-page-scale-200', screenshots);
      pass('page-scale-command-reachability', pageScaleEvidence);
      await cdp.detach();
      cdp = null;

      await firstPage.setViewportSize({ width: 1440, height: 900 });
      await selectTimeline(firstPage, editedTimelineId);
      await firstPage.locator('[data-action="save-project"]').click();
      await firstPage.waitForFunction(() => (
        window.surdetEditorDebug.state.timelines.every((entry) => entry.dirty === false)
          && [...window.surdetEditorDebug.state.scenes.values()].every((scene) => scene.dirty === false)
      ));
      savedFiles = await firstPage.evaluate(() => window.__surdetDumpFakeRoot());
      injectedAfterSave = browserFileMapTreeIdentity(savedFiles);
      const changedPaths = changedFilePaths(fixtureFiles, savedFiles);
      assert(changedPaths.length === 1 && changedPaths[0] === crlfTimelinePath, `save changed unexpected fake files: ${changedPaths.join(', ')}`);
      const savedTimelineText = mapFileText(savedFiles, crlfTimelinePath);
      assert(JSON.parse(savedTimelineText).durationMs === editedDurationMs, 'saved Timeline lost edited duration');
      saveEvidence = {
        changedPaths,
        before: injectedBefore,
        after: injectedAfterSave,
        editedTimeline: {
          path: crlfTimelinePath,
          bytes: Buffer.byteLength(savedTimelineText, 'utf8'),
          sha256: sha256(Buffer.from(savedTimelineText, 'utf8')),
        },
      };
      pass('save-writes-expected-timeline-only', saveEvidence);
      const crlfCount = (savedTimelineText.match(/\r\n/g) ?? []).length;
      const bareLfCount = (savedTimelineText.match(/(^|[^\r])\n/g) ?? []).length;
      assert(crlfCount > 0 && bareLfCount === 0, `saved Timeline EOL is not CRLF (${crlfCount} CRLF / ${bareLfCount} bare LF)`);
      pass('crlf-preserved', { path: crlfTimelinePath, crlfCount, bareLfCount });
      pass('saved-fake-tree-dumped', injectedAfterSave);
      await takeScreenshot(firstPage, artifactDirectory, 'timeline-desk-saved', screenshots);

      await firstPage.close();
      firstPage = null;
      await firstContext.close();
      firstContext = null;
      pass('first-browser-context-closed', { pageClosed: true, contextClosed: true });

      secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      secondPage = await secondContext.newPage();
      observePage(secondPage, channels);
      await secondPage.addInitScript(fakeFileSystemInit, { rootName: 'starter', files: savedFiles });
      await secondPage.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
      const secondInitialDump = await secondPage.evaluate(() => window.__surdetDumpFakeRoot());
      const secondInitialIdentity = browserFileMapTreeIdentity(secondInitialDump);
      assert(secondInitialIdentity.sha256 === injectedAfterSave.sha256, 'fresh context did not receive the saved fake tree');
      pass('fresh-context-injected-from-saved-tree', { saved: injectedAfterSave, injected: secondInitialIdentity });

      const reopened = await openFixture(secondPage);
      assert(reopened.projectName === expectedProjectName, 'fresh context did not reopen the configured Starter fixture');
      await enterTimelineDesk(secondPage);
      await selectTimeline(secondPage, editedTimelineId);
      const reopenedState = await stateSnapshot(secondPage);
      const reopenedDuration = JSON.parse(reopenedState.timeline.text).durationMs;
      assert(reopenedDuration === editedDurationMs, `cold reopen duration ${reopenedDuration} != ${editedDurationMs}`);
      assert(reopenedState.timeline.eol === '\r\n', 'cold reopen lost CRLF identity');
      coldReopenEvidence = {
        durationMs: reopenedDuration,
        eol: 'CRLF',
        timelineSha256: sha256(Buffer.from(reopenedState.timeline.text, 'utf8')),
        projectName: reopened.projectName,
      };
      pass('edited-value-survives-cold-reopen', coldReopenEvidence);

      const reopenedProjection = await secondPage.evaluate(() => ({
        timelineDirty: window.surdetEditorDebug.state.timelines.filter((entry) => entry.dirty).map((entry) => entry.id),
        sceneDirty: [...window.surdetEditorDebug.state.scenes.values()].filter((entry) => entry.dirty).map((entry) => entry.id),
        pendingDeletes: window.surdetEditorDebug.state.pendingTimelineDeletes.length,
        pendingRestores: window.surdetEditorDebug.state.pendingTimelineRestores.size,
        saveState: document.querySelector('.editor-save-state')?.getAttribute('data-save-state') ?? null,
      }));
      assert(reopenedProjection.timelineDirty.length === 0 && reopenedProjection.sceneDirty.length === 0, 'cold reopened project is dirty');
      assert(reopenedProjection.pendingDeletes === 0 && reopenedProjection.pendingRestores === 0, 'cold reopened project retained pending deletion state');
      assert(reopenedProjection.saveState === 'saved', `cold reopened project save state is ${reopenedProjection.saveState}`);
      pass('reopened-project-clean', reopenedProjection);
      await takeScreenshot(secondPage, artifactDirectory, 'timeline-desk-cold-reopen', screenshots);

      const starterAfterBrowser = hashProjectTree(starterRoot);
      assert(starterAfterBrowser.sha256 === starterBefore.sha256, 'original Starter changed during browser evidence');
      pass('original-starter-unchanged', { before: starterBefore, after: starterAfterBrowser });
      assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(' | ')}`);
      assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
      assert(requestFailures.length === 0, `browser request failures: ${requestFailures.join(' | ')}`);
      assert(responseFailures.length === 0, `browser HTTP response failures: ${responseFailures.join(' | ')}`);
      pass('browser-error-channels-empty', {
        errors: [],
        consoleErrors: [],
        pageErrors: [],
        requestFailures: [],
        responseFailures: [],
        stderrLines: [],
        childCleanupFailures: [],
      });
    }
  } catch (error) {
    failure = errorText(error);
    errors.push(failure);
  } finally {
    try {
      if (cdp) await cdp.detach();
    } catch (error) {
      childCleanupFailures.push(`CDP detach: ${errorText(error)}`);
    }
    for (const [label, page] of [['first page', firstPage], ['second page', secondPage]]) {
      try {
        if (page && !page.isClosed()) await page.close();
      } catch (error) {
        childCleanupFailures.push(`${label} close: ${errorText(error)}`);
      }
    }
    for (const [label, context] of [['first context', firstContext], ['second context', secondContext]]) {
      try {
        if (context) await context.close();
      } catch (error) {
        childCleanupFailures.push(`${label} close: ${errorText(error)}`);
      }
    }
    try {
      await browser?.close();
    } catch (error) {
      childCleanupFailures.push(`browser close: ${errorText(error)}`);
    }
    await stopServer(server, childCleanupFailures);
    if (port !== null) portReleased = await portIsAvailable(port);
    if (!portReleased) childCleanupFailures.push(`strict port remained occupied: ${port}`);
    if (portReleased && childCleanupFailures.length === 0) {
      if (mode === 'preflight') preflightPass('isolated-process-cleanup', { port, portReleased, childCleanupFailures: [] });
      else pass('isolated-process-cleanup', { port, portReleased, childCleanupFailures: [] });
    }
  }

  const starterAfter = hashProjectTree(starterRoot);
  const stderrLines = serverStderr.join('').split(/\r?\n/).filter(Boolean);
  if (starterAfter.sha256 !== starterBefore.sha256 && failure === null) {
    failure = `original Starter changed: ${starterBefore.sha256} -> ${starterAfter.sha256}`;
    errors.push(failure);
  }
  if (consoleErrors.length > 0 && failure === null) {
    failure = `browser console errors: ${consoleErrors.join(' | ')}`;
    errors.push(failure);
  }
  if (pageErrors.length > 0 && failure === null) {
    failure = `browser page errors: ${pageErrors.join(' | ')}`;
    errors.push(failure);
  }
  if (requestFailures.length > 0 && failure === null) {
    failure = `browser request failures: ${requestFailures.join(' | ')}`;
    errors.push(failure);
  }
  if (responseFailures.length > 0 && failure === null) {
    failure = `browser HTTP response failures: ${responseFailures.join(' | ')}`;
    errors.push(failure);
  }
  if (stderrLines.length > 0 && failure === null) {
    failure = `Vite stderr was not empty: ${stderrLines.join(' | ')}`;
    errors.push(failure);
  }
  if (childCleanupFailures.length > 0 && failure === null) {
    failure = `cleanup failures: ${childCleanupFailures.join(' | ')}`;
    errors.push(failure);
  }
  if (mode !== 'preflight') {
    const passedMilestones = new Set(milestones.filter((milestone) => milestone.status === 'passed').map((milestone) => milestone.name));
    const missingMilestones = MILESTONE_IDS.filter((id) => !passedMilestones.has(id));
    if (missingMilestones.length > 0 && failure === null) {
      failure = `missing required milestones: ${missingMilestones.join(', ')}`;
      errors.push(failure);
    }
  }

  const passedNames = mode === 'preflight'
    ? preflightChecks.map((check) => check.name)
    : milestones.filter((milestone) => milestone.status === 'passed').map((milestone) => milestone.name);
  const firstFailedNode = mode === 'preflight'
    ? failure === null ? null : 'preflight'
    : MILESTONE_IDS.find((id) => !passedNames.includes(id)) ?? null;
  const firstFailedIndex = firstFailedNode === null ? -1 : MILESTONE_IDS.indexOf(firstFailedNode);
  const lastPassedNode = mode === 'preflight'
    ? passedNames.at(-1) ?? null
    : firstFailedIndex > 0 ? MILESTONE_IDS[firstFailedIndex - 1] : null;

  const evidence = {
    schemaVersion: 1,
    evidenceClass: evidenceClassFor(mode),
    mode,
    status: failure === null ? 'PASSED' : 'FAILED',
    runHead,
    codeEvidenceHead,
    runner,
    runnerSha256,
    runnerHeadIdentity,
    trackedCodeDiffPaths,
    repoRoot,
    editorRoot,
    starterRoot,
    artifactDirectory,
    port,
    forbiddenPorts: FORBIDDEN_PORTS,
    searchRange: SEARCH_RANGE,
    portReleased,
    starterBefore,
    starterAfter,
    originalStarterUnchanged: starterBefore.sha256 === starterAfter.sha256,
    fixtureAugmentations,
    injectedBefore,
    injectedAfterSave,
    opened,
    layoutEvidence,
    historyEvidence,
    timelineEditScrollProbeEvidence,
    previewReceiptProbeEvidence,
    compactLayoutProbeEvidence,
    saveEvidence,
    coldReopenEvidence,
    screenshots,
    preflightChecks,
    milestones,
    lastPassedNode,
    firstFailedNode,
    errors,
    consoleErrors,
    pageErrors,
    requestFailures,
    responseFailures,
    stderrLines,
    childCleanupFailures,
    serverStdout: serverStdout.join('').split(/\r?\n/).filter(Boolean),
  };
  const evidenceIdentity = writeExclusiveJson(evidencePath, evidence);
  const identity = writeExclusiveJson(identityPath, {
    schemaVersion: 1,
    evidenceClass: evidence.evidenceClass,
    mode,
    status: evidence.status,
    runHead,
    runnerSha256,
    evidence: evidenceIdentity,
    originalStarterUnchanged: evidence.originalStarterUnchanged,
    portReleased,
  });
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    mode,
    runHead,
    runnerSha256,
    trackedCodeDiffPaths,
    artifactDirectory,
    evidence: evidenceIdentity,
    identity,
    port,
    portReleased,
    passedMilestones: milestones.filter((milestone) => milestone.status === 'passed').length,
    requiredMilestones: mode === 'preflight' ? null : MILESTONE_IDS.length,
    preflightChecks,
    lastPassedNode,
    firstFailedNode,
    screenshots,
    error: failure,
  }, null, 2)}\n`);
  if (failure !== null) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(runnerPath)) {
  await run();
}
