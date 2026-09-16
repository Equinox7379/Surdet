import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  createNodeFsBridge,
  nodeBackedFileSystemInit,
} from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSourceRoot = path.join(editorRoot, 'e2e', 'fixtures', 'asset-authority-project');
const forbiddenPorts = new Set([4173, 4175]);
const sceneSource = '@scene start\n@bg castle_hall\n凛：分数是 {score}。\n@end\n';
const renamedCharacter = '凛·维护';
const renamedSceneSource = sceneSource.replace('凛：', `${renamedCharacter}：`);
const expectedInjectedError = 'EACCES: permission denied, read content/scenario/start.gal';

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function choosePort() {
  for (let port = 4431; port <= 4470; port += 1) {
    if (!forbiddenPorts.has(port) && await portIsAvailable(port)) return port;
  }
  throw new Error('no isolated maintenance-save-load port available');
}

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Vite listener may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dev-project readiness timeout: ${url}`);
}

async function writeFixtureProject(projectRoot) {
  const scenarioRoot = path.join(projectRoot, 'content', 'scenario');
  const configRoot = path.join(projectRoot, 'content', 'config');
  const backgroundRoot = path.join(projectRoot, 'content', 'assets', 'bg');
  const avatarRoot = path.join(projectRoot, 'content', 'assets', 'avatar');
  await fs.mkdir(scenarioRoot, { recursive: true });
  await fs.mkdir(configRoot, { recursive: true });
  await fs.mkdir(backgroundRoot, { recursive: true });
  await fs.mkdir(avatarRoot, { recursive: true });
  await fs.copyFile(
    path.join(fixtureSourceRoot, 'content', 'assets', 'bg', 'castle_hall.svg'),
    path.join(backgroundRoot, 'castle_hall.svg'),
  );
  await fs.copyFile(
    path.join(fixtureSourceRoot, 'content', 'assets', 'avatar', 'lynn.svg'),
    path.join(avatarRoot, 'lynn.svg'),
  );
  await fs.writeFile(path.join(projectRoot, 'game.config.json'), `${JSON.stringify({
    title: 'Maintenance Save Load',
    version: '0.1.0',
    entryScene: 'start',
    characters: { lynn: { name: '凛', avatar: 'lynn' } },
    variables: {
      score: { type: 'number', initial: 12, description: '剧情分数' },
      line: { type: 'string', initial: '原始文案', description: '文案变量' },
    },
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(scenarioRoot, 'start.gal'), sceneSource, 'utf8');
  await fs.writeFile(path.join(configRoot, 'terminology.json'), `${JSON.stringify({
    terms: [{ canonical: '城堡大厅', variants: ['大厅'] }],
  }, null, 2)}\n`, 'utf8');
}

function observePage(page, channels) {
  page.on('console', (message) => {
    if (message.type() === 'error') channels.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => channels.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => channels.requestFailures.push(
    `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const failure = {
        status: response.status(),
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        phase: channels.phase,
        rootKey: channels.rootKey,
        code: null,
        message: null,
        messageKey: null,
      };
      channels.responseFailures.push(failure);
      channels.pendingResponseReads.push(response.text().then((body) => {
        try {
          const error = JSON.parse(body)?.error;
          failure.code = error?.code ?? null;
          failure.message = error?.message ?? null;
          failure.messageKey = error?.messageKey ?? null;
          failure.details = error?.details ?? null;
        } catch {
          // Keep the public error record fields null when the body is not JSON.
        }
      }).catch(() => undefined));
    }
  });
}

async function openBrowserPage(browser, baseUrl, bridge, channels) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(20_000);
  const page = await context.newPage();
  observePage(page, channels);
  page.on('dialog', (dialog) => {
    channels.dialogs.push({ type: dialog.type(), message: dialog.message() });
    void dialog.accept();
  });
  await page.exposeFunction('__surdetNodeFs', bridge);
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  // Native handles are structured-cloneable; the Node bridge uses functions.
  // Persist only its identity fields, which the bridge's isSameEntry consumes.
  // The actual IndexedDB registry and production recovery path remain in use.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...keys) {
      if (this.name === 'project-handles' && value?.handle?.__surdetRootKey) {
        const handle = value.handle;
        value = { ...value, handle: { kind: handle.kind, name: handle.name,
          __surdetRootKey: handle.__surdetRootKey, __surdetRelativePath: handle.__surdetRelativePath } };
      }
      return put.call(this, value, ...keys);
    };
  });
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').waitFor({ state: 'visible' });
  return { context, page };
}

async function openProject(page, rootKey, expectedName, channels) {
  channels.phase = 'open-project';
  channels.rootKey = rootKey;
  await page.evaluate((key) => window.__surdetE2eSetPickerRoot(key), rootKey);
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => (
    window.surdetEditorDebug?.state?.projectLoading === false
      && window.surdetEditorDebug?.state?.scenes?.has('start')
      && window.surdetEditorDebug?.state?.authoringIndex !== null
      && window.surdetEditorDebug?.state?.assetIntelligenceState === 'ready'
      && window.surdetEditorDebug?.state?.assetImportWorkspace?.entryState === 'ready'
  ));
  await page.waitForFunction((name) => (
    document.querySelector('.editor-project-name')?.textContent === name
  ), expectedName);
  channels.phase = 'idle';
  channels.rootKey = null;
}

async function openConfigSection(page, label, id) {
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('#config-view .config-workspace').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: label, exact: true }).click();
  const section = page.locator(`[data-config-section="${id}"]`);
  await section.waitFor({ state: 'visible' });
  return section;
}

async function waitForSaved(page) {
  await page.waitForFunction(() => (
    document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved'
      && document.querySelector('[data-save-state]')?.textContent === '已保存'
      && (document.getElementById('status')?.textContent ?? '').includes('全部成功')
  ));
}

async function waitForSoleLiveWorkspace(page) {
  // Closing a browser context can abort its asynchronous revoke request. Respect
  // the real authority's grace period before this single-Editor save regression;
  // do not delete its records, force a clean state, or weaken the write gate.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await page.waitForResponse(response => response.ok()
      && new URL(response.url()).pathname.endsWith('/workspace/snapshot'), { timeout: 6_000 });
    const summary = (await response.json()).data.humanWorkspace;
    if (summary.activeSessions === 1 && summary.graceSessions === 0) return;
  }
  assert.fail('previous browser workspace did not revoke or leave the authority grace period');
}

async function waitForPreview(page, score) {
  const frameElement = page.locator('iframe.preview-frame');
  await frameElement.waitFor({ state: 'visible' });
  const frameHandle = await frameElement.elementHandle();
  const frame = await frameHandle?.contentFrame();
  assert(frame, 'preview iframe was not connected');
  await frame.waitForFunction(() => (
    window.surdetPreviewDebug?.interp !== null
      && window.surdetPreviewDebug?.runtime !== null
      && document.querySelector('canvas')?.getBoundingClientRect().width > 0
  ));
  await frame.waitForFunction((expectedScore) => {
    const debug = window.surdetPreviewDebug;
    const background = debug?.presentationSnapshot?.stage?.backgroundKey;
    const diagnostics = debug?.runtime?.queries?.diagnostics?.projectionSnapshot?.();
    return background === 'castle_hall'
      && JSON.stringify(diagnostics ?? {}).includes(`分数是 ${expectedScore}。`);
  }, score);
  return { frameElement, frame };
}

function isExpectedInjectedError(value) {
  const firstLine = String(value).split(/\r?\n/, 1)[0];
  return firstLine === expectedInjectedError || firstLine === `Error: ${expectedInjectedError}`;
}

async function main() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-maintenance-save-load-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const blockedRoot = path.join(fixtureRoot, 'new-project-with-read-failure');
  const dataRoot = path.join(fixtureRoot, 'agent-data');
  const cacheDir = path.join(fixtureRoot, 'vite-cache');
  const screenshotPath = path.join(fixtureRoot, 'preview.png');
  await writeFixtureProject(projectRoot);
  await fs.cp(projectRoot, blockedRoot, { recursive: true });

  let blockedSceneReadCount = 0;
  let repeatReadFailureArmed = false;
  let repeatedSceneReadCount = 0;
  let syncFailureArmed = false;
  let syncReadFailures = 0;
  const bridgeBase = createNodeFsBridge({ project: projectRoot, blocked: blockedRoot });
  const bridge = async (request) => {
    if (syncFailureArmed && request.rootKey === 'project' && request.op === 'read'
      && request.path === 'content/scenario/start.gal') {
      syncFailureArmed = false; syncReadFailures += 1;
      throw Object.assign(new Error(expectedInjectedError), { code: 'EACCES', path: request.path });
    }
    if (request.rootKey === 'blocked'
      && request.op === 'read'
      && request.path === 'content/scenario/start.gal'
      && blockedSceneReadCount === 0) {
      blockedSceneReadCount += 1;
      const error = new Error(expectedInjectedError);
      error.code = 'EACCES';
      error.path = request.path;
      throw error;
    }
    if (request.rootKey === 'project'
      && repeatReadFailureArmed
      && request.op === 'read'
      && request.path === 'content/scenario/start.gal'
      && repeatedSceneReadCount === 0) {
      repeatedSceneReadCount += 1;
      const error = new Error(expectedInjectedError);
      error.code = 'EACCES';
      error.path = request.path;
      throw error;
    }
    return bridgeBase(request);
  };

  const channels = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseFailures: [],
    pendingResponseReads: [],
    dialogs: [],
    phase: 'idle',
    rootKey: null,
  };
  let browser = null;
  let server = null;
  let activeContext = null;
  let activePage = null;
  const port = await choosePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const previousAgentDataRoot = process.env.SURDET_AGENT_DATA_DIR;

  try {
    process.env.SURDET_AGENT_DATA_DIR = dataRoot;
    server = await startDevProject([
      '--project', projectRoot,
      '--data-root', dataRoot,
      '--port', String(port),
    ], { registerSignals: false, cacheDir });
    await waitForHttp(`${baseUrl}/index.html`);
    browser = await chromium.launch({ headless: true });

    ({ context: activeContext, page: activePage } = await openBrowserPage(browser, baseUrl, bridge, channels));
    await openProject(activePage, 'project', path.basename(projectRoot), channels);
    await waitForSoleLiveWorkspace(activePage);

    await openConfigSection(activePage, '角色', 'characters');
    await activePage.getByRole('textbox', { name: 'lynn 的显示名称', exact: true }).fill(renamedCharacter);
    await openConfigSection(activePage, '变量', 'variables');
    await activePage.getByRole('textbox', { name: '初始值，第 1 行', exact: true }).fill('42');
    await activePage.getByRole('button', { name: '名词表', exact: true }).click();
    await activePage.getByRole('textbox', { name: '规范词，第 1 行', exact: true }).fill('新城堡大厅');
    await activePage.getByRole('textbox', { name: '变体列表，第 1 行', exact: true }).fill('["新大厅","大厅"]');
    await activePage.locator('[data-editor-mode="editor"]').click();
    await openConfigSection(activePage, '变量', 'variables');
    assert.equal(
      await activePage.getByRole('textbox', { name: '初始值，第 1 行', exact: true }).inputValue(),
      '42',
      'variable draft was lost when moving across workspaces',
    );
    await activePage.getByRole('button', { name: '名词表', exact: true }).click();
    assert.equal(
      await activePage.getByRole('textbox', { name: '规范词，第 1 行', exact: true }).inputValue(),
      '新城堡大厅',
      'terminology draft was lost when moving across workspaces',
    );
    await activePage.waitForFunction(() => (
      document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'dirty'
    ));

    await activePage.keyboard.press('Control+S');
    await waitForSaved(activePage);
    const savedConfig = JSON.parse(await fs.readFile(path.join(projectRoot, 'game.config.json'), 'utf8'));
    const savedTerminology = JSON.parse(await fs.readFile(path.join(projectRoot, 'content', 'config', 'terminology.json'), 'utf8'));
    assert.equal(savedConfig.variables.score.initial, 42, 'global save did not write score to game.config.json');
    assert.equal(savedConfig.variables.line.initial, '原始文案', 'global save changed the string variable unexpectedly');
    assert.equal(savedTerminology.terms[0].canonical, '新城堡大厅', 'global save did not write terminology.json');
    assert.deepEqual(savedTerminology.terms[0].variants, ['新大厅', '大厅']);
    assert.deepEqual(savedConfig.characters.lynn, { name: renamedCharacter, avatar: 'lynn' });
    assert.equal(
      await fs.readFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), 'utf8'),
      renamedSceneSource,
      'global save did not migrate the renamed character speaker in the same transaction',
    );

    await activeContext.close();
    activeContext = null;
    activePage = null;

    ({ context: activeContext, page: activePage } = await openBrowserPage(browser, baseUrl, bridge, channels));
    await openProject(activePage, 'project', path.basename(projectRoot), channels);
    await openConfigSection(activePage, '角色', 'characters');
    assert.equal(
      await activePage.getByRole('textbox', { name: 'lynn 的显示名称', exact: true }).inputValue(),
      renamedCharacter,
      'saved character name did not survive a fresh browser context',
    );
    await openConfigSection(activePage, '变量', 'variables');
    assert.equal(
      await activePage.getByRole('textbox', { name: '初始值，第 1 行', exact: true }).inputValue(),
      '42',
      'saved number variable did not survive a fresh browser context',
    );
    await activePage.getByRole('button', { name: '名词表', exact: true }).click();
    assert.equal(
      await activePage.getByRole('textbox', { name: '规范词，第 1 行', exact: true }).inputValue(),
      '新城堡大厅',
      'saved terminology did not survive a fresh browser context',
    );

    await activePage.locator('[data-editor-mode="preview"]').click();
    const firstPreview = await waitForPreview(activePage, 42);
    await firstPreview.frameElement.screenshot({ path: screenshotPath, animations: 'disabled' });
    assert((await fs.stat(screenshotPath)).size > 0, 'preview screenshot was empty');
    await activePage.locator('[data-action="reload-preview"]').click();
    await waitForPreview(activePage, 42);

    await activePage.reload({ waitUntil: 'networkidle' });
    await activePage.locator('[data-action="open-project"]').waitFor({ state: 'visible' });
    await openProject(activePage, 'project', path.basename(projectRoot), channels);
    await waitForSoleLiveWorkspace(activePage);
    await activePage.locator('[data-editor-mode="preview"]').click();
    await waitForPreview(activePage, 42);

    await activePage.locator('[data-editor-mode="editor"]').click();
    await activePage.locator('[data-script-view="source"]').click();
    const sourceEditor = activePage.locator('.v4-source-editor');
    await sourceEditor.waitFor({ state: 'visible' });
    const draftSource = renamedSceneSource.replace('分数是 {score}', '草稿分数是 {score}');
    await sourceEditor.fill(draftSource);
    await activePage.waitForFunction((expected) => (
      window.surdetEditorDebug?.state?.scenes?.get('start')?.text === expected
        && window.surdetEditorDebug?.state?.scenes?.get('start')?.dirty === true
    ), draftSource);
    await openConfigSection(activePage, '变量', 'variables');
    await activePage.getByRole('textbox', { name: '初始值，第 1 行', exact: true }).fill('77');
    await activePage.waitForFunction(() => (
      document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'dirty'
    ));
    const beforeFailedOpen = await activePage.evaluate(() => ({
      sceneText: window.surdetEditorDebug.state.scenes.get('start')?.text ?? null,
      sceneDirty: window.surdetEditorDebug.state.scenes.get('start')?.dirty ?? null,
      scoreOnDiskInMemory: JSON.parse(window.surdetEditorDebug.state.gameConfigText).variables.score.initial,
      draftScore: document.querySelector('[data-config-section="variables"] input[aria-label="初始值，第 1 行"]')?.value ?? null,
      saveState: document.querySelector('[data-save-state]')?.getAttribute('data-save-state') ?? null,
      projectName: window.surdetEditorDebug.state.dirName,
    }));
    assert.equal(beforeFailedOpen.sceneText, draftSource);
    assert.equal(beforeFailedOpen.sceneDirty, true);
    assert.equal(beforeFailedOpen.scoreOnDiskInMemory, 42);
    assert.equal(beforeFailedOpen.draftScore, '77');
    assert.equal(beforeFailedOpen.saveState, 'dirty');

    channels.phase = 'open-project';
    channels.rootKey = 'blocked';
    await activePage.evaluate(() => window.__surdetE2eSetPickerRoot('blocked'));
    await activePage.locator('[data-action="open-project"]').click();
    await activePage.waitForFunction((message) => (
      (document.getElementById('status')?.textContent ?? '').includes(message)
    ), expectedInjectedError);
    assert.equal(blockedSceneReadCount, 1, 'the bridge did not inject exactly one targeted scene read failure');
    const afterFailedOpen = await activePage.evaluate(() => ({
      sceneText: window.surdetEditorDebug.state.scenes.get('start')?.text ?? null,
      sceneDirty: window.surdetEditorDebug.state.scenes.get('start')?.dirty ?? null,
      scoreOnDiskInMemory: JSON.parse(window.surdetEditorDebug.state.gameConfigText).variables.score.initial,
      draftScore: document.querySelector('[data-config-section="variables"] input[aria-label="初始值，第 1 行"]')?.value ?? null,
      saveState: document.querySelector('[data-save-state]')?.getAttribute('data-save-state') ?? null,
      projectName: window.surdetEditorDebug.state.dirName,
      currentScene: window.surdetEditorDebug.state.current,
    }));
    assert.deepEqual(afterFailedOpen, {
      ...beforeFailedOpen,
      currentScene: 'start',
    });
    assert.equal(afterFailedOpen.projectName, path.basename(projectRoot));
    assert.equal(
      JSON.parse(await fs.readFile(path.join(projectRoot, 'game.config.json'), 'utf8')).variables.score.initial,
      42,
      'failed project open changed the old project on disk',
    );

    // 同一物理目录的新 picker handle：第一次读取场景时注入一次 EACCES，
    // 失败打开必须继续保留旧项目的 source/config 草稿与 dirty 状态。
    repeatReadFailureArmed = true;
    await activePage.evaluate(() => window.__surdetE2eSetPickerRoot('project'));
    const samePhysicalDirectory = await activePage.evaluate(async () => {
      const previousHandle = window.surdetEditorDebug.state.dirHandle;
      const nextHandle = await window.showDirectoryPicker();
      return previousHandle !== null
        && nextHandle !== previousHandle
        && await nextHandle.isSameEntry(previousHandle);
    });
    assert.equal(samePhysicalDirectory, true, 'same-directory picker did not return an independent isSameEntry handle');
    channels.phase = 'open-project';
    channels.rootKey = 'project';
    await activePage.locator('[data-action="open-project"]').click();
    const repeatReadDeadline = Date.now() + 20_000;
    while (repeatedSceneReadCount === 0 && Date.now() < repeatReadDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(repeatedSceneReadCount, 1, 'the same-root handle did not receive exactly one targeted scene read failure');
    await activePage.waitForFunction((message) => (
      (document.getElementById('status')?.textContent ?? '').includes(message)
    ), expectedInjectedError);
    const afterRepeatedFailedOpen = await activePage.evaluate(() => ({
      sceneText: window.surdetEditorDebug.state.scenes.get('start')?.text ?? null,
      sceneDirty: window.surdetEditorDebug.state.scenes.get('start')?.dirty ?? null,
      scoreOnDiskInMemory: JSON.parse(window.surdetEditorDebug.state.gameConfigText).variables.score.initial,
      draftScore: document.querySelector('[data-config-section="variables"] input[aria-label="初始值，第 1 行"]')?.value ?? null,
      saveState: document.querySelector('[data-save-state]')?.getAttribute('data-save-state') ?? null,
      projectName: window.surdetEditorDebug.state.dirName,
      currentScene: window.surdetEditorDebug.state.current,
    }));
    assert.deepEqual(afterRepeatedFailedOpen, {
      ...beforeFailedOpen,
      currentScene: 'start',
    });
    assert.equal(afterRepeatedFailedOpen.projectName, path.basename(projectRoot));

    // 失败选择之后仍能使用旧项目 workspace 保存；磁盘必须收到两个 dirty 文件。
    await activePage.keyboard.press('Control+S');
    await waitForSaved(activePage);
    const recoveredConfig = JSON.parse(await fs.readFile(path.join(projectRoot, 'game.config.json'), 'utf8'));
    const recoveredScene = await fs.readFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), 'utf8');
    assert.equal(recoveredConfig.variables.score.initial, 77, 'save after same-root read failure did not write the config draft');
    assert.equal(recoveredScene, draftSource, 'save after same-root read failure did not write the scene draft');

    // 同一物理目录的 project handle 此时不再注入错误，正常绑定后应读回刚保存的内容。
    await openProject(activePage, 'project', path.basename(projectRoot), channels);
    await openConfigSection(activePage, '变量', 'variables');
    assert.equal(
      await activePage.getByRole('textbox', { name: '初始值，第 1 行', exact: true }).inputValue(),
      '77',
      'saved config draft did not survive a normal reopen after the failed same-root open',
    );
    await activePage.locator('[data-editor-mode="editor"]').click();
    await activePage.locator('[data-script-view="source"]').click();
    const reopenedSourceEditor = activePage.locator('.v4-source-editor');
    await reopenedSourceEditor.waitFor({ state: 'visible' });
    assert.equal(
      await reopenedSourceEditor.inputValue(),
      draftSource,
      'saved scene draft did not survive a normal reopen after the failed same-root open',
    );

    const syncDraft = draftSource.replace('@end', '同步失败也必须保留。\n@end');
    await reopenedSourceEditor.fill(syncDraft);
    await activePage.waitForFunction(() => {
      const state = window.surdetEditorDebug.state;
      return (localStorage.getItem(`surdet-editor:autosave:${encodeURIComponent(state.autosaveProjectId)}`) ?? '').includes('同步失败也必须保留');
    });
    syncFailureArmed = true;
    await activePage.locator('[data-action="discard-project-drafts"]').click();
    await activePage.waitForFunction(message => document.getElementById('status')?.textContent.includes(message), expectedInjectedError);
    assert.equal(syncReadFailures, 1);
    assert.equal(await activePage.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text), syncDraft);
    assert.equal(await activePage.evaluate(() => {
      const state = window.surdetEditorDebug.state;
      return (localStorage.getItem(`surdet-editor:autosave:${encodeURIComponent(state.autosaveProjectId)}`) ?? '').includes('同步失败也必须保留');
    }), true, 'failed explicit sync destroyed the persistent draft backup');
    await activePage.locator('[data-action="discard-project-drafts"]').click();
    await activePage.waitForFunction(text => window.surdetEditorDebug.state.scenes.get('start').text === text, draftSource);

    // Search updates only the material list. The real input remains mounted
    // through a composition sequence; no native IME is claimed here.
    await activePage.locator('[data-editor-mode="assets"]').click();
    await activePage.locator('[data-asset-filter="search"]').waitFor();
    assert.equal(await activePage.evaluate(() => {
      const search = document.querySelector('[data-asset-filter="search"]');
      search.focus(); search.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
      search.value = '城'; search.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '城' }));
      const stable = search.isConnected && search === document.activeElement;
      search.value = ''; search.dispatchEvent(new CompositionEvent('compositionend', { data: '城' }));
      search.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return stable && document.querySelector('[data-asset-filter="search"]') === search;
    }), true, 'asset search replaced its active input');

    // A real stored recovery entry for a missing scene used to lock the whole
    // Editor permanently. Download keeps its exact content; explicit discard
    // only abandons the backup, leaving the project files intact.
    const backup = await activePage.evaluate(() => {
      const state = window.surdetEditorDebug.state;
      const payload = { projectId: state.autosaveProjectId, dirName: state.dirName, savedAt: Date.now(), scenes: [{ key: 'missing', text: '@scene missing\n备份正文\n@end\n' }] };
      if (!payload.projectId) throw new Error('fixture has no persistent project identity');
      localStorage.setItem(`surdet-editor:autosave:${encodeURIComponent(payload.projectId)}`, JSON.stringify(payload));
      return payload;
    });
    await openProject(activePage, 'project', path.basename(projectRoot), channels);
    await activePage.locator('[data-action="download-scene-recovery"]').waitFor();
    const downloading = activePage.waitForEvent('download');
    await activePage.locator('[data-action="download-scene-recovery"]').click();
    const downloaded = await downloading;
    assert.deepEqual(JSON.parse(await fs.readFile(await downloaded.path(), 'utf8')), backup);
    await activePage.locator('[data-action="discard-scene-recovery"]').click();
    await activePage.waitForFunction(() => document.querySelector('#main')?.getAttribute('data-autosave-recovery') === 'idle');
    assert.equal(await fs.readFile(path.join(projectRoot, 'content/scenario/start.gal'), 'utf8'), draftSource);
    assert.equal(await activePage.evaluate(id => localStorage.getItem(`surdet-editor:autosave:${encodeURIComponent(id)}`), backup.projectId), null);

    await Promise.all(channels.pendingResponseReads);
    const expectedBindingFailures = channels.responseFailures.filter((entry) => (
      entry.status === 409
        && entry.method === 'POST'
        && entry.path.startsWith('/__surdet/project-asset-import/v1/binding/challenges/')
        && entry.path.endsWith('/confirm')
        && entry.phase === 'open-project'
        && entry.rootKey === 'blocked'
        && entry.code === 'PROJECT_IDENTITY_MISMATCH'
        && entry.messageKey === 'assetImport.PROJECT_IDENTITY_MISMATCH'
    ));
    assert(expectedBindingFailures.length <= 1,
      `expected blocked-project identity rejection more than once: ${JSON.stringify(expectedBindingFailures)}`);
    const expectedStalePreviews = channels.responseFailures.filter(entry => entry.status === 409
      && entry.method === 'POST' && entry.path === '/__surdet/project-asset-import/v1/workspace/preview'
      && entry.code === 'PREVIEW_OBSERVATION_STALE'
      && entry.messageKey === 'assetImport.PREVIEW_OBSERVATION_STALE');
    assert(expectedStalePreviews.length <= 2, 'unexpected repeated stale preview publication');
    const expectedResponseFailures = [...expectedBindingFailures, ...expectedStalePreviews];
    const expectedErrors = [...channels.consoleErrors, ...channels.pageErrors];
    assert(
      expectedErrors.filter(isExpectedInjectedError).length <= 2,
      `injected EACCES surfaced more than once: ${JSON.stringify(expectedErrors)}`,
    );
    let allowedResponseConsoleErrors = expectedResponseFailures.length;
    assert.deepEqual(
      expectedErrors.filter((entry) => {
        if (isExpectedInjectedError(entry)) return false;
        if (entry === 'Failed to load resource: the server responded with a status of 409 (Conflict)'
          && allowedResponseConsoleErrors > 0) {
          allowedResponseConsoleErrors -= 1;
          return false;
        }
        return true;
      }),
      [],
      `unexpected browser errors: ${JSON.stringify(expectedErrors)}`,
    );
    assert.deepEqual(channels.requestFailures, [], `browser request failures: ${JSON.stringify(channels.requestFailures)}`);
    assert.deepEqual(
      channels.responseFailures.filter((entry) => !expectedResponseFailures.includes(entry)),
      [],
      `unexpected browser response failures: ${JSON.stringify(channels.responseFailures)}`,
    );
    console.log(JSON.stringify({
      status: 'PASSED',
      fixtureRoot,
      projectRoot,
      screenshotPath,
      savedScore: 42,
      savedTerminology: '新城堡大厅',
      savedCharacterName: renamedCharacter,
      characterSpeakerMigrationSaved: true,
      previewBackground: 'castle_hall',
      previewText: '分数是 42。',
      failedOpenPreservedDirtyDraft: true,
      targetedEaccesReadCount: blockedSceneReadCount,
      repeatedSceneReadCount,
      samePhysicalDirectory,
      recoveredScore: 77,
      reopenedAfterSameRootFailure: true,
      failedExplicitSyncPreservedBackup: syncReadFailures === 1,
      browserErrors: expectedErrors.filter(isExpectedInjectedError),
      expectedBrowserResponseErrors: expectedResponseFailures,
    }, null, 2));
  } catch (error) {
    await Promise.all(channels.pendingResponseReads);
    console.error(JSON.stringify({
      status: 'FAILED',
      fixtureRoot,
      screenshotPath,
      failure: errorText(error),
      targetedEaccesReadCount: blockedSceneReadCount,
      editorStatus: await activePage?.evaluate(() => ({ status: document.getElementById('status')?.textContent, save: document.querySelector('[data-save-state]')?.textContent })).catch(() => null),
      channels,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await activeContext?.close().catch((error) => {
      console.error(`context cleanup failed: ${errorText(error)}`);
      process.exitCode = 1;
    });
    await browser?.close().catch((error) => {
      console.error(`browser cleanup failed: ${errorText(error)}`);
      process.exitCode = 1;
    });
    await server?.close().catch((error) => {
      console.error(`server cleanup failed: ${errorText(error)}`);
      process.exitCode = 1;
    });
    if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
    else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  }
}

await main();
