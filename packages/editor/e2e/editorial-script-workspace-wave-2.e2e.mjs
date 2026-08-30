import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
const starterRoot = path.join(repoRoot, 'examples', 'starter');
const forbiddenPorts = new Set([4173, 4175]);

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
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeSync(fd, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return readFileIdentity(file);
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
  for (let port = 4187; port <= 4210; port += 1) {
    if (forbiddenPorts.has(port)) continue;
    if (await portIsAvailable(port)) return port;
  }
  throw new Error('no strict Wave 2 browser port available in 4187..4210');
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server has not published the listener yet.
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
    try { child.kill('SIGTERM'); } catch (error) { cleanupFailures.push(`SIGTERM ${pid}: ${errorText(error)}`); }
  }
  if (await waitForExit(child)) return;
  if (process.platform === 'win32' && Number.isInteger(pid)) {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForExit(killer, 5_000);
  } else if (child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch (error) { cleanupFailures.push(`SIGKILL ${pid}: ${errorText(error)}`); }
  }
  if (!(await waitForExit(child))) cleanupFailures.push(`Vite child remained alive: ${pid}`);
}

function rectanglesOverlap(left, right) {
  return left.left < right.right - 0.5
    && left.right > right.left + 0.5
    && left.top < right.bottom - 0.5
    && left.bottom > right.top + 0.5;
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const inspect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector,
        display: style.display,
        position: style.position,
        overflowY: style.overflowY,
        visible: style.display !== 'none' && rect.width > 0 && rect.height > 0,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      workbench: inspect('.authoring-workbench'),
      outline: inspect('.authoring-outline'),
      manuscript: inspect('.authoring-manuscript-column'),
      context: inspect('.authoring-context'),
      toggle: inspect('[data-action="toggle-authoring-context"]'),
      auxiliaryView: document.querySelector('.authoring-workbench')?.getAttribute('data-auxiliary-view') ?? null,
    };
  });
}

function assertDesktopLayout(layout, expectedWidth) {
  assert(layout.viewport.width === expectedWidth, `viewport width ${layout.viewport.width} != ${expectedWidth}`);
  assert(layout.workbench?.visible, `${expectedWidth}: workbench not visible`);
  assert(layout.outline?.visible, `${expectedWidth}: outline not visible`);
  assert(layout.manuscript?.visible, `${expectedWidth}: manuscript not visible`);
  assert(layout.context?.visible, `${expectedWidth}: context not visible`);
  assert(layout.pageWidth.client === layout.pageWidth.scroll, `${expectedWidth}: horizontal page overflow`);
  assert(layout.outline.width >= 219 && layout.outline.width <= 265, `${expectedWidth}: outline width ${layout.outline.width}`);
  assert(layout.context.width >= 271 && layout.context.width <= 337, `${expectedWidth}: context width ${layout.context.width}`);
  assert(layout.manuscript.width >= 480, `${expectedWidth}: manuscript width ${layout.manuscript.width}`);
  assert(layout.manuscript.width > layout.outline.width && layout.manuscript.width > layout.context.width, `${expectedWidth}: manuscript is not the largest region`);
  assert(!rectanglesOverlap(layout.outline, layout.manuscript), `${expectedWidth}: outline overlaps manuscript`);
  assert(!rectanglesOverlap(layout.manuscript, layout.context), `${expectedWidth}: manuscript overlaps context`);
}

function assertCompactOutlineLayout(layout) {
  assert(layout.viewport.width === 1024, `compact viewport width ${layout.viewport.width}`);
  assert(layout.outline?.visible, '1024: outline not visible');
  assert(layout.manuscript?.visible, '1024: manuscript not visible');
  assert(layout.context && !layout.context.visible, '1024: context should be replaced in outline mode');
  assert(layout.toggle?.visible, '1024: in-flow context toggle not visible');
  assert(layout.pageWidth.client === layout.pageWidth.scroll, '1024: horizontal page overflow');
  assert(layout.outline.width >= 237 && layout.outline.width <= 239, `1024: outline width ${layout.outline.width}`);
  assert(!rectanglesOverlap(layout.outline, layout.manuscript), '1024: outline overlaps manuscript');
}

function assertCompactContextLayout(layout) {
  assert(layout.viewport.width === 1024, `compact context viewport width ${layout.viewport.width}`);
  assert(layout.outline && !layout.outline.visible, '1024 context mode: outline should be replaced');
  assert(layout.context?.visible, '1024 context mode: context not visible');
  assert(layout.manuscript?.visible, '1024 context mode: manuscript not visible');
  assert(layout.pageWidth.client === layout.pageWidth.scroll, '1024 context mode: horizontal page overflow');
  assert(layout.context.width >= 237 && layout.context.width <= 239, `1024: context width ${layout.context.width}`);
  assert(!rectanglesOverlap(layout.context, layout.manuscript), '1024 context mode: context overlaps manuscript');
}

function assertZoomEquivalentLayout(layout, auxiliaryView) {
  assert(layout.viewport.width === 800, `zoom-equivalent viewport width ${layout.viewport.width}`);
  assert(layout.pageWidth.client === layout.pageWidth.scroll, '800: horizontal page overflow');
  assert(layout.manuscript?.visible, '800: manuscript not visible');
  assert(layout.toggle?.visible, '800: auxiliary toggle not visible');
  if (auxiliaryView === 'outline') {
    assert(layout.outline?.visible, '800: outline not visible');
    assert(layout.context && !layout.context.visible, '800: context should be hidden in outline mode');
    assert(!rectanglesOverlap(layout.outline, layout.manuscript), '800: outline overlaps manuscript');
  } else {
    assert(layout.outline && !layout.outline.visible, '800 context mode: outline should be hidden');
    assert(layout.context?.visible, '800 context mode: context not visible');
    assert(!rectanglesOverlap(layout.context, layout.manuscript), '800 context mode: context overlaps manuscript');
  }
}

async function takeScreenshot(page, artifactDirectory, name, screenshots) {
  const file = path.join(artifactDirectory, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  screenshots.push(readFileIdentity(file));
}

async function run() {
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-editorial-script-workspace-wave2-'));
  const evidencePath = path.join(artifactDirectory, 'evidence.json');
  const milestones = [];
  const screenshots = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const childCleanupFailures = [];
  const serverStdout = [];
  const serverStderr = [];
  const starterBefore = hashProjectTree(starterRoot);
  const browserFiles = fileMapForDirectory(starterRoot);
  const injectedBefore = browserFileMapTreeIdentity(browserFiles);
  let browser = null;
  let page = null;
  let server = null;
  let port = null;
  let failure = null;
  let layoutEvidence = null;
  let interactionEvidence = null;
  let injectedAfter = null;
  let portReleased = false;

  const pass = (name, evidence = {}) => milestones.push({ name, status: 'passed', evidence });
  try {
    port = await chooseStrictPort();
    assert(!forbiddenPorts.has(port), `forbidden port selected: ${port}`);
    pass('strict-isolated-port-selected', { port, forbiddenPorts: [...forbiddenPorts] });

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
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(server, `${baseUrl}/index.html`);
    pass('isolated-vite-ready', { baseUrl, pid: server.pid });

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(errorText(error)));
    page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
    await page.addInitScript(fakeFileSystemInit, {
      rootName: 'starter',
      files: browserFiles,
    });
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.locator('[data-action="open-project"]').waitFor({ state: 'visible' });
    await page.locator('[data-action="open-project"]').click();
    await page.locator('.manuscript-sheet[data-scene-id="ch01_01"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.authoringIndex !== null);
    const opened = await page.evaluate(() => ({
      projectName: document.querySelector('.editor-project-name')?.textContent ?? null,
      sceneCount: window.surdetEditorDebug?.state?.scenes?.size ?? null,
      current: window.surdetEditorDebug?.state?.current ?? null,
      timelineCount: window.surdetEditorDebug?.state?.timelines?.length ?? null,
      assetCount: window.surdetEditorDebug?.state?.dirAssets?.length ?? null,
    }));
    assert(opened.projectName === 'starter', `project bar did not show Starter: ${opened.projectName}`);
    assert(opened.sceneCount === 4, `expected 4 real Starter scenes, got ${opened.sceneCount}`);
    assert(opened.timelineCount === 3, `expected 3 real Starter timelines, got ${opened.timelineCount}`);
    assert(opened.assetCount >= 6, `expected real Starter assets, got ${opened.assetCount}`);
    pass('real-starter-opened-through-picker', opened);

    const exclusiveScriptMode = await page.evaluate(() => ({
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      previewTimelineId: window.surdetEditorDebug?.state?.previewTimelineId ?? null,
      previewTraceLength: window.surdetEditorDebug?.state?.previewTrace?.length ?? null,
      editorWorkspaceCount: document.querySelectorAll('#editor-workspace').length,
      workbenchCount: document.querySelectorAll('[data-editor-region="authoring-workbench"]').length,
      manuscriptCount: document.querySelectorAll('.manuscript-sheet').length,
      previewViewCount: document.querySelectorAll('#preview-view').length,
      timelineViewCount: document.querySelectorAll('#timeline-view').length,
      iframeCount: document.querySelectorAll('iframe').length,
    }));
    assert(exclusiveScriptMode.mainTab === 'editor', `unexpected main tab: ${exclusiveScriptMode.mainTab}`);
    assert(exclusiveScriptMode.previewTimelineId === null, 'script mode retained a preview timeline target');
    assert(exclusiveScriptMode.previewTraceLength === 0, 'script mode retained a preview trace');
    assert(exclusiveScriptMode.editorWorkspaceCount === 1, 'script workspace topology duplicated');
    assert(exclusiveScriptMode.workbenchCount === 1, 'authoring workbench topology duplicated');
    assert(exclusiveScriptMode.manuscriptCount === 1, 'manuscript truth duplicated');
    assert(exclusiveScriptMode.previewViewCount === 0, 'preview view rendered in script mode');
    assert(exclusiveScriptMode.timelineViewCount === 0, 'timeline view rendered in script mode');
    assert(exclusiveScriptMode.iframeCount === 0, 'preview iframe rendered in script mode');
    pass('script-mode-has-no-preview-trace-timeline-duplicate', exclusiveScriptMode);

    const layout1440 = await inspectLayout(page);
    assertDesktopLayout(layout1440, 1440);
    await takeScreenshot(page, artifactDirectory, 'workspace-1440', screenshots);
    pass('layout-1440', layout1440);

    await page.setViewportSize({ width: 1280, height: 900 });
    const layout1280 = await inspectLayout(page);
    assertDesktopLayout(layout1280, 1280);
    await takeScreenshot(page, artifactDirectory, 'workspace-1280', screenshots);
    pass('layout-1280', layout1280);

    await page.setViewportSize({ width: 1024, height: 820 });
    const layout1024Outline = await inspectLayout(page);
    assertCompactOutlineLayout(layout1024Outline);
    await takeScreenshot(page, artifactDirectory, 'workspace-1024-outline', screenshots);
    pass('layout-1024-outline', layout1024Outline);

    await page.locator('[data-action="toggle-authoring-context"]').click();
    const layout1024Context = await inspectLayout(page);
    assertCompactContextLayout(layout1024Context);
    await takeScreenshot(page, artifactDirectory, 'workspace-1024-context', screenshots);
    pass('layout-1024-context-replacement', layout1024Context);
    layoutEvidence = { layout1440, layout1280, layout1024Outline, layout1024Context };

    await page.setViewportSize({ width: 800, height: 900 });
    await page.locator('[data-action="toggle-authoring-context"]').click();
    const layout800Outline = await inspectLayout(page);
    assertZoomEquivalentLayout(layout800Outline, 'outline');
    await takeScreenshot(page, artifactDirectory, 'workspace-800-outline', screenshots);
    pass('layout-800-outline-accessible', layout800Outline);
    await page.locator('[data-action="toggle-authoring-context"]').click();
    const layout800Context = await inspectLayout(page);
    assertZoomEquivalentLayout(layout800Context, 'context');
    await takeScreenshot(page, artifactDirectory, 'workspace-800-context', screenshots);
    pass('layout-800-context-accessible', layout800Context);
    layoutEvidence = { ...layoutEvidence, layout800Outline, layout800Context };

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-scene-id="ch01_02"]').click();
    await page.locator('.manuscript-sheet[data-scene-id="ch01_02"]').waitFor({ state: 'visible' });
    const sceneSwitch = await page.evaluate(() => ({
      current: window.surdetEditorDebug?.state?.current ?? null,
      selectedSceneIds: [...document.querySelectorAll('[data-scene-id][aria-selected="true"]')]
        .map((element) => element.getAttribute('data-scene-id')),
      manuscriptSceneId: document.querySelector('.manuscript-sheet')?.getAttribute('data-scene-id') ?? null,
    }));
    assert(sceneSwitch.current === 'ch01_02', `scene switch current ${sceneSwitch.current}`);
    assert(sceneSwitch.selectedSceneIds.length === 1 && sceneSwitch.selectedSceneIds[0] === 'ch01_02', 'scene outline selection diverged');
    assert(sceneSwitch.manuscriptSceneId === 'ch01_02', 'manuscript did not follow scene selection');
    pass('scene-switch-keeps-single-scene-truth', sceneSwitch);

    await page.locator('#search-input').fill('CalendarRunner');
    await page.locator('#search-panel button', { hasText: '搜索' }).click();
    const searchResult = page.locator('.search-item', { hasText: 'CalendarRunner' }).first();
    await searchResult.waitFor({ state: 'visible' });
    await searchResult.click();
    await page.locator('.manuscript-sheet[data-scene-id="ch02"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const selected = document.querySelector('#editor .block[aria-selected="true"]');
      return selected?.getAttribute('data-object-ref')?.length > 0
        && selected.querySelector('.current-segment:not([hidden])') !== null;
    });
    const searchSelection = await page.evaluate(() => {
      const selected = document.querySelector('#editor .block[aria-selected="true"]');
      return {
        current: window.surdetEditorDebug?.state?.current ?? null,
        line: selected?.getAttribute('data-line') ?? null,
        objectRef: selected?.getAttribute('data-object-ref') ?? null,
        currentMarker: selected?.querySelector('.current-segment:not([hidden])')?.textContent ?? null,
        selectedObjectRef: window.surdetEditorDebug?.state?.selectedObjectRef ?? null,
      };
    });
    assert(searchSelection.current === 'ch02', `search did not switch to ch02: ${searchSelection.current}`);
    assert(searchSelection.line === '6', `search selected line ${searchSelection.line}`);
    assert(searchSelection.objectRef === searchSelection.selectedObjectRef, 'search selection diverged from shared selected object truth');
    assert(searchSelection.currentMarker === '当前段', 'search destination did not show full-surface current marker');
    pass('search-selects-real-object-in-manuscript', searchSelection);

    const lineInput = page.locator('#editor .block[data-line="6"] .fields input.wide');
    const originalLine = await lineInput.inputValue();
    const originalSceneText = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('ch02').text);
    const selectedBeforeEdit = searchSelection.selectedObjectRef;
    await lineInput.fill(`${originalLine}【临时验收】`);
    const editedSceneText = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('ch02').text);
    assert(editedSceneText.includes('【临时验收】'), 'typed manuscript edit did not reach shared scene text');
    await page.waitForFunction((previousRef) => {
      const selected = document.querySelector('#editor .block[aria-selected="true"]');
      const selectedRef = window.surdetEditorDebug.state.selectedObjectRef;
      return selectedRef !== null
        && selectedRef !== previousRef
        && selected?.getAttribute('data-object-ref') === selectedRef
        && document.querySelector('[data-manuscript-fact="save-state"]')?.textContent === '未保存'
        && document.querySelector('[data-editor-region="current-scene-context"]')?.textContent?.includes('未保存');
    }, selectedBeforeEdit);
    const reconciledSelection = await page.evaluate(() => ({
      selectedObjectRef: window.surdetEditorDebug.state.selectedObjectRef,
      visibleObjectRef: document.querySelector('#editor .block[aria-selected="true"]')?.getAttribute('data-object-ref') ?? null,
      manuscriptSaveState: document.querySelector('[data-manuscript-fact="save-state"]')?.textContent ?? null,
      contextSaveState: document.querySelector('[data-editor-region="current-scene-context"]')?.textContent ?? null,
    }));
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction((expected) => window.surdetEditorDebug.state.scenes.get('ch02').text === expected, originalSceneText);
    const restoredLine = await page.locator('#editor .block[data-line="6"] .fields input.wide').inputValue();
    assert(restoredLine === originalLine, 'undo did not restore the visible dialogue input');
    pass('manuscript-edit-and-undo', {
      sceneId: 'ch02',
      line: 6,
      originalLine,
      editedMarkerObserved: true,
      selectionReconciledAfterIndexRebuild: reconciledSelection.selectedObjectRef === reconciledSelection.visibleObjectRef,
      manuscriptSaveState: reconciledSelection.manuscriptSaveState,
      contextShowsUnsaved: reconciledSelection.contextSaveState?.includes('未保存') ?? false,
      sceneTextRestored: true,
      visibleInputRestored: true,
    });

    const beforeAssetInsert = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('ch02').text);
    await page.locator('[data-sidebar-mode="assets"]').click();
    await page.locator('#asset-catalog').waitFor({ state: 'visible' });
    const assetFacts = await page.evaluate(() => ({
      itemCount: document.querySelectorAll('#asset-catalog [data-asset-key]').length,
      kinds: [...new Set([...document.querySelectorAll('#asset-catalog [data-asset-kind]')]
        .map((element) => element.getAttribute('data-asset-kind')))].sort(),
      castleHallCount: document.querySelectorAll('#asset-catalog [data-asset-key="castle_hall"]').length,
    }));
    assert(assetFacts.itemCount > 0, 'real Starter asset catalog is empty');
    assert(assetFacts.castleHallCount === 1, `castle_hall catalog count ${assetFacts.castleHallCount}`);
    await page.locator('#asset-catalog [data-asset-key="castle_hall"] [data-action="insert-asset"]').click();
    const afterAssetInsert = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('ch02').text);
    assert(afterAssetInsert !== beforeAssetInsert && afterAssetInsert.includes('@bg castle_hall'), 'asset insertion did not update shared scene text');
    await page.waitForFunction(() => {
      const blocks = [...document.querySelectorAll('#editor .block')];
      const last = blocks.at(-1);
      return last !== undefined && [...last.querySelectorAll('input, textarea, select')]
        .some((control) => 'value' in control && control.value.includes('castle_hall'));
    });
    const visibleInsertedAssetLine = await page.locator('#editor .block').last().evaluate((block) => ({
      line: block.getAttribute('data-line'),
      values: [...block.querySelectorAll('input, textarea, select')]
        .map((control) => 'value' in control ? control.value : ''),
    }));
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction((expected) => window.surdetEditorDebug.state.scenes.get('ch02').text === expected, beforeAssetInsert);
    pass('real-asset-catalog-insert-and-undo', {
      ...assetFacts,
      insertedInstruction: '@bg castle_hall',
      visibleInsertedAssetLine,
      sceneTextRestored: true,
    });

    const dumpedFiles = await page.evaluate(() => window.__surdetDumpFakeRoot());
    injectedAfter = browserFileMapTreeIdentity(dumpedFiles);
    assert(injectedAfter.sha256 === injectedBefore.sha256, 'fake Starter file tree changed without save');
    interactionEvidence = {
      opened,
      exclusiveScriptMode,
      sceneSwitch,
      searchSelection,
      assetFacts,
      fakeTreeBefore: injectedBefore,
      fakeTreeAfter: injectedAfter,
    };
    pass('fake-project-remains-byte-identical', {
      before: injectedBefore.sha256,
      after: injectedAfter.sha256,
    });

    assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
    assert(requestFailures.length === 0, `browser request failures: ${requestFailures.join(' | ')}`);
    pass('browser-error-channels-empty');
  } catch (error) {
    failure = errorText(error);
  } finally {
    try { await page?.close(); } catch (error) { childCleanupFailures.push(`page close: ${errorText(error)}`); }
    try { await browser?.close(); } catch (error) { childCleanupFailures.push(`browser close: ${errorText(error)}`); }
    await stopServer(server, childCleanupFailures);
    if (port !== null) portReleased = await portIsAvailable(port);
    if (!portReleased) childCleanupFailures.push(`strict port remained occupied: ${port}`);
  }

  const starterAfter = hashProjectTree(starterRoot);
  if (starterAfter.sha256 !== starterBefore.sha256 && failure === null) {
    failure = `original Starter changed: ${starterBefore.sha256} -> ${starterAfter.sha256}`;
  }
  if (childCleanupFailures.length > 0 && failure === null) {
    failure = `cleanup failures: ${childCleanupFailures.join(' | ')}`;
  }
  const evidence = {
    schemaVersion: 1,
    evidenceClass: 'EDITOR_BROWSER_DIAGNOSTIC',
    status: failure === null ? 'PASSED' : 'FAILED',
    runner: readFileIdentity(runnerPath),
    repoRoot,
    editorRoot,
    starterRoot,
    artifactDirectory,
    port,
    forbiddenPorts: [...forbiddenPorts],
    portReleased,
    starterBefore,
    starterAfter,
    originalStarterUnchanged: starterBefore.sha256 === starterAfter.sha256,
    screenshots,
    milestones,
    layoutEvidence,
    interactionEvidence,
    errors: failure === null ? [] : [failure],
    consoleErrors,
    pageErrors,
    requestFailures,
    childCleanupFailures,
    serverStdout: serverStdout.join('').split(/\r?\n/).filter(Boolean),
    serverStderr: serverStderr.join('').split(/\r?\n/).filter(Boolean),
  };
  const evidenceIdentity = writeExclusiveJson(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    artifactDirectory,
    evidence: evidenceIdentity,
    port,
    portReleased,
    milestones: milestones.map(({ name, status }) => ({ name, status })),
    screenshots,
    error: failure,
  }, null, 2)}\n`);
  if (failure !== null) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(runnerPath)) {
  await run();
}
