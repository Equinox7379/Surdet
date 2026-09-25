import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { openAgentPortSession } from '../dist/agent-port/session.js';
import { createAgentPortServer } from '../dist/agent-port/server.js';
import { cmdNew } from '../dist/new.js';
import { startDevProject } from '../../editor/scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from '../../editor/e2e/asset-import-authority.e2e.mjs';
import { activate, advanceToChoice, finishToTitle, state, waitTitle, waitOverlay, canvasTexts } from '../../renderer/e2e/player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.resolve(os.tmpdir());
const engine = await fs.mkdtemp(path.join(tempRoot, 'surdet-new-player-'));
const output = path.resolve(process.env.SURDET_NEW_PLAYER_OUTPUT ?? path.join(engine, 'review'));
let server;
let browser;
let page;
let agent;
let editorServer;
const previousDataRoot = process.env.SURDET_AGENT_DATA_DIR;

async function authorChapter(game) {
  process.env.SURDET_AGENT_DATA_DIR = path.join(engine, 'agent-data');
  const main = await fs.readFile(path.join(game, 'src/main.ts'), 'utf8');
  const configBefore = await fs.readFile(path.join(game, 'game.config.json'), 'utf8');
  const connect = async (policy, resumeChangeId) => {
    const session = await openAgentPortSession({ projectRoot: game, policy,
      assetSources: [path.join(repo, 'examples/starter/content/assets')], assetImportDataRoot: path.join(engine, 'asset-data'),
      ...(resumeChangeId ? { resumeChangeId } : {}) });
    const server = createAgentPortServer(session);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'default-authoring-path', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    agent = { client, close: async () => { await client.close(); await server.close(); await session.close(); } };
  };
  const call = async (name, args = {}) => {
    const response = await agent.client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.equal(response.structuredContent.ok, true, JSON.stringify(response));
    return response.structuredContent.result;
  };
  await connect('apply');
  const sourceId = (await call('surdet_asset_sources')).roots[0].sourceId;
  const items = [];
  for (const [sourcePath, kind] of [['bg/post_office.png', 'background'], ['portrait/lynn_coat_normal.png', 'portrait'], ['portrait/lynn_coat_smile.png', 'portrait']]) {
    const { file } = await call('surdet_asset_sources', { sourceId, path: sourcePath });
    items.push({ itemId: randomUUID(), sourceId, sourcePath, sha256: file.sha256, kind, fileName: path.basename(sourcePath) });
  }
  const operationId = randomUUID();
  const staged = await call('surdet_asset_import_stage', { operationId, items });
  await call('surdet_asset_import_commit', { operationId, planFingerprint: staged.plan.planFingerprint });
  await agent.close(); agent = null;
  await connect('stage');
  const assets = await call('surdet_project_assets', { view: 'project' });
  const harbor = assets.backgrounds.find(asset => asset.key === 'harbor');
  const office = assets.backgrounds.find(asset => asset.key === 'post_office');
  const normal = assets.portraits.find(asset => asset.expression === 'normal');
  const smile = assets.portraits.find(asset => asset.expression === 'smile');
  assert.ok(harbor.usage && office.usage && normal.usage && smile.usage);
  const { changeId } = await call('surdet_change_begin', { compositionMode: 'direct' });
  const { charactersFingerprint } = await call('surdet_project_inspect', { view: 'working' });
  await call('surdet_character_ensure', { operationId: 'speaker', id: normal.role, name: '凛', expectedFingerprint: charactersFingerprint });
  await call('surdet_variable_ensure', { operationId: 'visited', name: 'visited', type: 'flag', initial: false });
  await call('surdet_timeline_create', { operationId: 'intro', timelineId: 'intro', definition: {
    version: 1, id: 'intro', durationMs: 600,
    tracks: [office.usage.timeline, normal.usage.timeline,
      { kind: 'camera', cues: [{ atMs: 0, durationMs: 600, easing: 'inOutSine', action: 'pan', x: -8, y: 0 }] }],
  } });
  const timeline = await call('surdet_object_inspect', { view: 'working', objectRef: 'timeline:intro' });
  const tracks = await Promise.all(timeline.childRefs.map(objectRef => call('surdet_object_inspect', { view: 'working', objectRef })));
  const camera = tracks.find(track => track.details.kind === 'camera');
  const cue = await call('surdet_object_inspect', { view: 'working', objectRef: camera.childRefs[0] });
  const patch = { kind: 'replaceCue', cueRef: cue.objectRef, expectedFingerprint: cue.fingerprint,
    cue: { ...cue.details, x: -24 } };
  await call('surdet_timeline_patch', { operationId: 'refine-pan', timelineId: 'intro', patch });
  const stale = await agent.client.callTool({ name: 'surdet_timeline_patch', arguments: { operationId: 'stale-pan', timelineId: 'intro', patch } });
  assert.equal(stale.structuredContent.error.code, 'OBJECT_REF_STALE');
  for (const [sceneId, value] of [['end_a', '你拆开信封，故乡的风从纸页间吹来。'], ['end_b', '你把信放进行囊，留给航程里的一个清晨。']]) {
    await call('surdet_scene_create', { operationId: sceneId, sceneId, blocks: [{ kind: 'text', speaker: '旁白', value }, { kind: 'instruction', name: 'end' }] });
  }
  await call('surdet_scene_create', { operationId: 'shop', sceneId: 'shop_scene', blocks: [
    { kind: 'label', name: 'greeting' }, { kind: 'text', speaker: '旁白', value: '邮局的门还开着。' },
    { kind: 'instruction', name: 'set', args: ['visited', '=', 'true'] }, { kind: 'instruction', name: 'return' },
  ] });
  await call('surdet_scene_create', { operationId: 'hub', sceneId: 'hub_scene', blocks: [
    harbor.usage.scene, normal.usage.scene,
    { kind: 'text', speaker: '凛', value: '港口的风停了，去邮局看看吧。' },
    { kind: 'instruction', name: 'timeline', args: ['intro'], modifiers: { blocking: '' } },
    { kind: 'text', speaker: '凛', value: '邮局到了，你的信就在里面。' },
    smile.usage.scene,
    { kind: 'condition', branches: [{ kind: 'if', expr: '!visited', blocks: [{ kind: 'instruction', name: 'call', args: ['shop_scene.greeting'] }] }] },
    { kind: 'text', speaker: '旁白', value: '待续写的句子。' },
    { kind: 'choice', options: [
      { label: '现在打开', when: 'visited', effects: [{ name: 'set', args: ['opened', '=', 'true'] }], target: { kind: 'jump', value: 'end_a' } },
      { label: '留到船上再读', target: { kind: 'jump', value: 'end_b' } },
    ] },
  ] });
  const scene = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:hub_scene', fragment: {} });
  const children = await Promise.all(scene.childRefs.map(objectRef => call('surdet_object_inspect', { view: 'working', objectRef })));
  const text = children.find(object => object.kind === 'text' && object.source.raw === '旁白：待续写的句子。');
  assert.ok(text, 'the authored revision target must be found by its actual content');
  await call('surdet_scene_patch', { operationId: 'rewrite', patch: { kind: 'replaceText', target: text.objectRef, expectedFingerprint: text.fingerprint, value: '你回到码头，手中多了一封没有署名的信。' } });
  const label = await call('surdet_object_inspect', { view: 'working', objectRef: 'label:shop_scene.greeting' });
  await call('surdet_scene_patch', { operationId: 'rename', patch: { kind: 'renameLabel', target: label.objectRef, expectedFingerprint: label.fingerprint, name: 'arrival' } });
  const shop = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:shop_scene' });
  const relocated = await call('surdet_scene_rename', { operationId: 'rename-shop-scene', sceneId: 'shop_scene', newSceneId: 'post_office_visit', expectedFingerprint: shop.fingerprint });
  assert.equal(relocated.continuation.sceneRef, 'scene:post_office_visit');
  const visit = await call('surdet_object_inspect', { view: 'working', objectRef: relocated.continuation.sceneRef });
  const moved = await call('surdet_scene_move', { operationId: 'move-visit-to-chapter', sceneId: 'post_office_visit', directory: '第一章/邮局', expectedPath: visit.source.path, expectedFingerprint: visit.fingerprint });
  assert.equal(moved.continuation.sceneRef, 'scene:post_office_visit');
  assert.equal(moved.path, 'content/scenario/第一章/邮局/post_office_visit.gal');
  assert.equal((await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:post_office_visit' })).fingerprint, visit.fingerprint);
  const entry = await call('surdet_object_inspect', { view: 'working', objectRef: 'config:entryScene' });
  await call('surdet_project_entry_scene_set', { operationId: 'entry', sceneId: 'hub_scene', expectedFingerprint: entry.fingerprint });
  const { playerConfig } = await call('surdet_project_inspect', { view: 'working' });
  const rejected = await agent.client.callTool({ name: 'surdet_project_player_config_patch', arguments: { operationId: 'bad-bg', expectedFingerprint: playerConfig.fingerprint, patch: { titleBackground: 'missing' } } });
  assert.equal(rejected.structuredContent.error.code, 'VALIDATION_FAILED');
  await call('surdet_project_player_config_patch', { operationId: 'display', expectedFingerprint: playerConfig.fingerprint, patch: {
    title: '风停之后', subtitle: '一封信，两段航程', titleBackground: 'post_office', endScenes: ['end_a', 'end_b'], firstRunHint: '',
  } });
  assert.equal(await fs.readFile(path.join(game, 'game.config.json'), 'utf8'), configBefore, 'stage changed source configuration');
  assert.equal((await call('surdet_delivery_capsule')).composition.eligibility, 'unavailable');
  await agent.close(); agent = null;
  await connect('apply', changeId);
  assert.equal((await call('surdet_session_describe')).activeChange.compositionMode, 'direct');
  await call('surdet_project_validate'); await call('surdet_project_simulate', { sceneId: 'hub_scene' });
  for (const choice of [0, 1]) assert.equal((await call('surdet_runtime_run_from', { sceneId: 'hub_scene', choices: [choice] })).status, 'passed');
  await call('surdet_change_diff'); await call('surdet_change_commit');
  await agent.close(); agent = null;
  assert.equal(await fs.readFile(path.join(game, 'src/main.ts'), 'utf8'), main, 'authoring altered the player entrypoint');
  assert.match(await fs.readFile(path.join(game, 'content/scenario/hub_scene.gal'), 'utf8'), /@call post_office_visit\.arrival/);
  await assert.rejects(fs.access(path.join(game, 'content/scenario/shop_scene.gal')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(game, 'content/scenario/post_office_visit.gal')), { code: 'ENOENT' });
  assert.match(await fs.readFile(path.join(game, 'content/scenario/第一章/邮局/post_office_visit.gal'), 'utf8'), /@label arrival/);
  return main;
}

async function continueInEditor(game, errors) {
  let port;
  for (let candidate = 4431; candidate <= 4470; candidate++) {
    const probe = net.createServer();
    const available = await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(candidate, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (available) { port = candidate; break; }
  }
  assert.ok(port, 'no browser-safe Editor test port available');
  editorServer = await startDevProject(['--project', game, '--data-root', path.join(engine, 'editor-data'), '--port', String(port)], {
    registerSignals: false, cacheDir: path.join(output, '.editor-vite'),
  });
  const reopenProject = async () => {
    await page.locator('[data-action="open-project"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false
      && window.surdetEditorDebug.state.scenes.has('hub_scene')
      && window.surdetEditorDebug.state.assetImportWorkspace?.entryState === 'ready'
      && document.querySelector('[data-action="save-project"]')?.disabled === false);
    await page.locator('[data-editor-mode="config"]').click();
    await page.getByRole('button', { name: '角色', exact: true }).click();
    await page.getByRole('textbox', { name: 'narrator 的显示名称', exact: true }).waitFor();
  };
  const open = async () => {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', message => { if (message.type() === 'error') errors.push(`Editor: ${message.text()}`); });
    page.on('pageerror', error => errors.push(`Editor: ${error.message}`));
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).pathname.includes('/workspace/')) {
        void response.text().then(body => errors.push(`Workspace ${response.status()} ${new URL(response.url()).pathname}: ${body}`));
      }
    });
    await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: game }));
    await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...keys) {
        if (this.name === 'project-handles' && value?.handle?.__surdetRootKey) {
          const h = value.handle;
          value = { ...value, handle: { kind: h.kind, name: h.name, __surdetRootKey: h.__surdetRootKey, __surdetRelativePath: h.__surdetRelativePath } };
        }
        return put.call(this, value, ...keys);
      };
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await reopenProject();
  };
  const configBefore = JSON.parse((await fs.readFile(path.join(game, 'game.config.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const eventsPath = path.join(game, 'content/config/events.json');
  const eventsBefore = JSON.stringify({ events: [{ id: 'ending-event', scene: 'end_a', when: 'false', priority: 0, note: 'end_a' }], scheduled: [] });
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.writeFile(eventsPath, '{');
  await open();
  await page.getByRole('button', { name: '事件', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'events.json' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存事件配置', exact: true }).count(), 0);
  assert.equal(await fs.readFile(eventsPath, 'utf8'), '{');
  await page.screenshot({ path: path.join(output, '04b-config-read-error.png') });
  await page.locator('[data-editor-mode="editor"]').click();
  const failedRename = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.locator('.scene-row').filter({ has: page.locator('[data-scene-id="第一章/邮局/post_office_visit"]') }).hover();
  await page.getByRole('button', { name: '重命名场景 第一章/邮局/post_office_visit.gal', exact: true }).click();
  await failedRename;
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('events.json')
    && document.querySelector('[data-action="save-project"]')?.disabled === false);
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.pendingSceneDeletes.length), 0);
  await fs.writeFile(eventsPath, eventsBefore);
  await reopenProject();
  assert.deepEqual(await page.evaluate(() => window.surdetEditorDebug.state.configReadErrors), {});
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('第一章/邮局/post_office_visit')?.id), 'post_office_visit');
  await page.locator('[data-editor-mode="editor"]').click();
  const visitBefore = await fs.readFile(path.join(game, 'content/scenario/第一章/邮局/post_office_visit.gal'), 'utf8');
  const handleMove = async dialog => { assert.match(dialog.message(), /移动到章节/); await dialog.accept('第二章/邮局 归来'); };
  page.once('dialog', handleMove);
  await page.locator('.scene-row').filter({ has: page.locator('[data-scene-id="第一章/邮局/post_office_visit"]') }).hover();
  const moveSettled = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.getByRole('button', { name: '移动场景 第一章/邮局/post_office_visit.gal', exact: true }).click();
  await moveSettled;
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.has('第二章/邮局 归来/post_office_visit')), true,
    await page.locator('#status').textContent());
  await page.waitForFunction(() => window.surdetEditorDebug.state.scenes.has('第二章/邮局 归来/post_office_visit'));
  assert.equal(await fs.readFile(path.join(game, 'content/scenario/第一章/邮局/post_office_visit.gal'), 'utf8'), visitBefore);
  await assert.rejects(fs.access(path.join(game, 'content/scenario/第二章')), { code: 'ENOENT' });
  await page.screenshot({ path: path.join(output, '04a-chapter-move-draft.png') });
  await page.keyboard.press('Control+S');
  await page.waitForFunction(() => window.surdetEditorDebug.state.pendingSceneCommit === null
    && window.surdetEditorDebug.state.pendingSceneDeletes.length === 0
    && window.surdetEditorDebug.state.scenes.get('第二章/邮局 归来/post_office_visit')?.dirty === false
    && document.querySelector('[data-action="save-project"]')?.disabled === false);
  assert.equal(await fs.readFile(path.join(game, 'content/scenario/第二章/邮局 归来/post_office_visit.gal'), 'utf8'), visitBefore);
  await assert.rejects(fs.access(path.join(game, 'content/scenario/第一章/邮局/post_office_visit.gal')), { code: 'ENOENT' });
  await reopenProject();
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('第二章/邮局 归来/post_office_visit')?.text), visitBefore);
  await page.locator('[data-editor-mode="editor"]').click();
  const workingBefore = await page.evaluate(() => {
    const s = window.surdetEditorDebug.state;
    return { config: s.gameConfigText, scenes: [...s.scenes].map(([key, scene]) => ({ key, id: scene.id, file: scene.file, text: scene.text, dirty: scene.dirty })), pending: s.pendingSceneDeletes };
  });
  const configTextBefore = await fs.readFile(path.join(game, 'game.config.json'), 'utf8');
  page.on('dialog', dialog => { errors.push(`Unexpected scene-operation dialog: ${dialog.message()}`); void dialog.dismiss(); });
  for (const action of ['删除']) {
    await page.locator('.scene-row').filter({ has: page.locator('[data-scene-id="end_a"]') }).hover();
    const settled = page.waitForResponse(response => response.ok() && new URL(response.url()).pathname.endsWith('/workspace/finish'));
    await page.getByRole('button', { name: `${action}场景 end_a.gal`, exact: true }).click();
    await settled;
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('player.endScenes')
      && document.querySelector('[data-action="save-project"]')?.disabled === false);
    const workingAfter = await page.evaluate(() => {
      const s = window.surdetEditorDebug.state;
      return { config: s.gameConfigText, scenes: [...s.scenes].map(([key, scene]) => ({ key, id: scene.id, file: scene.file, text: scene.text, dirty: scene.dirty })), pending: s.pendingSceneDeletes };
    });
    assert.deepEqual(workingAfter, workingBefore, `${action} changed the protected ending draft`);
  }
  assert.equal(await fs.readFile(path.join(game, 'game.config.json'), 'utf8'), configTextBefore);
  await page.screenshot({ path: path.join(output, '04-ending-scene-protected.png') });
  page.removeAllListeners('dialog');
  await page.locator('[data-editor-mode="config"]').click();
  await page.getByRole('button', { name: '事件', exact: true }).click();
  await page.getByRole('textbox', { name: '优先级，第 1 行', exact: true }).fill('7');
  await page.locator('[data-editor-mode="editor"]').click();
  const endingBefore = await fs.readFile(path.join(game, 'content/scenario/end_a.gal'), 'utf8');
  assert.ok(endingBefore.startsWith('\uFEFF\t@scene end_a\r\n'));
  await page.locator('.scene-item[data-scene-id="end_a"]').focus();
  await page.keyboard.press('Enter');
  const endingLine = page.locator('.block-text').getByRole('textbox', { name: '台词内容', exact: true });
  const endingDialogue = await endingLine.inputValue();
  await endingLine.fill(endingDialogue + '返修。');
  await endingLine.blur();
  await page.keyboard.press('Control+Z');
  page.once('dialog', dialog => dialog.accept('final_a'));
  const renameSettled = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.locator('.scene-row').filter({ has: page.locator('[data-scene-id="end_a"]') }).hover();
  await page.getByRole('button', { name: '重命名场景 end_a.gal', exact: true }).click();
  await renameSettled;
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.has('final_a')), true, await page.locator('#status').textContent());
  const renamedEnding = endingBefore.replace('@scene end_a', '@scene final_a');
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('final_a').text), renamedEnding);
  await page.keyboard.press('Control+Shift+Z');
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('final_a').text), renamedEnding.replace(endingDialogue, endingDialogue + '返修。'));
  await page.keyboard.press('Control+Z');
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('final_a').text), renamedEnding);
  assert.equal(await fs.readFile(path.join(game, 'game.config.json'), 'utf8'), configTextBefore, 'rename saved config before Save All');
  assert.equal(await fs.readFile(eventsPath, 'utf8'), eventsBefore, 'rename saved the unfinished event draft');
  await page.locator('[data-editor-mode="config"]').click();
  await page.getByRole('button', { name: '事件', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '场景，第 1 行', exact: true }).inputValue(), 'final_a');
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Shift+Z');
  assert.equal(await page.getByRole('textbox', { name: '场景，第 1 行', exact: true }).inputValue(), 'final_a');
  assert.equal(await page.getByRole('textbox', { name: '优先级，第 1 行', exact: true }).inputValue(), '7');
  await page.screenshot({ path: path.join(output, '04c-scene-config-rename-draft.png') });
  const configSaveFinished = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.keyboard.press('Control+S');
  await configSaveFinished;
  console.log('CONFIG_RENAME_SAVE', await page.evaluate(() => ({ status: document.getElementById('status')?.textContent,
    pending: window.surdetEditorDebug.state.pendingSceneCommit, saveState: document.querySelector('[data-save-state]')?.getAttribute('data-save-state') })), errors);
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved'
    && document.querySelector('[data-action="save-project"]')?.disabled === false);
  assert.deepEqual(JSON.parse((await fs.readFile(path.join(game, 'game.config.json'), 'utf8')).replace(/^\uFEFF/, '')).player.endScenes, ['final_a', 'end_b']);
  const eventAfter = JSON.parse(await fs.readFile(eventsPath, 'utf8')).events[0];
  assert.equal(eventAfter.scene, 'final_a');
  assert.equal(eventAfter.priority, 7);
  assert.equal(eventAfter.note, 'end_a');
  await assert.rejects(fs.access(path.join(game, 'content/scenario/end_a.gal')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(game, 'content/scenario/final_a.gal'), 'utf8'), renamedEnding);
  await reopenProject();
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('final_a').text), renamedEnding);
  await page.waitForFunction(() => window.surdetEditorDebug.state.lastValidation !== null);
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.lastValidation.issues.some(issue => issue.code === 'SCENE_ID')), false);
  await page.locator('[data-editor-mode="config"]').click();
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.getByRole('textbox', { name: 'narrator 的显示名称', exact: true }).fill('引路人');
  await page.waitForFunction(() => document.querySelector('[data-action="save-project"]')?.disabled === false);
  const roleSaveFinished = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.keyboard.press('Control+S');
  const roleSaveResponse = await roleSaveFinished;
  assert.ok(roleSaveResponse.ok(), await roleSaveResponse.text());
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved'
    && document.querySelector('[data-save-state]')?.textContent === '已保存'
    && document.querySelector('[data-action="save-project"]')?.disabled === false);
  const savedConfigText = await fs.readFile(path.join(game, 'game.config.json'), 'utf8');
  assert.ok(savedConfigText.startsWith('\uFEFF'), 'Editor stripped the source configuration BOM');
  const configAfter = JSON.parse(savedConfigText.replace(/^\uFEFF/, ''));
  assert.deepEqual(configAfter.player, { ...configBefore.player, endScenes: ['final_a', 'end_b'] }, 'Editor dropped player settings');
  assert.equal(configAfter.characters.narrator.name, '引路人');
  assert.match(await fs.readFile(path.join(game, 'content/scenario/hub_scene.gal'), 'utf8'), /引路人：你回到码头/);
  await reopenProject();
  assert.equal(await page.getByRole('textbox', { name: 'narrator 的显示名称', exact: true }).inputValue(), '引路人');
  await page.screenshot({ path: path.join(output, '04-editor-continued.png') });
  await page.locator('[data-editor-mode="editor"]').click();
  await page.locator('.scene-item[data-scene-id="hub_scene"]').click();
  for (const dialogue of await page.locator('.v4-dialogue-input').all()) {
    if ((await dialogue.inputValue()) === '港口的风停了，去邮局看看吧。') { await dialogue.click(); break; }
  }
  await page.locator('.v4-edit-stage img').evaluateAll(async images => { for (const image of images) await image.decode(); });
  await page.screenshot({ path: path.join(output, '04e-editor-script.png') });
  const priorSceneNames = await fs.readdir(path.join(game, 'content/scenario'));
  await page.getByRole('button', { name: '导入剧本', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: '导入剧本', exact: true });
  await importDialog.getByLabel('新场景 ID', { exact: true }).fill('imported_dialogue');
  await importDialog.getByLabel('选择 UTF-8 文件', { exact: true }).setInputFiles({
    name: '中文 稿件.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFFspeaker,text\r\n引路人,"这封信,终于送到了。"\r\n引路人,"@jump secret 只是印在信上的字。"\r\n', 'utf8'),
  });
  await page.waitForFunction(() => document.querySelector('.script-import-dialog textarea')?.value.includes('这封信'));
  await importDialog.getByRole('button', { name: '预览导入', exact: true }).click();
  assert.match(await importDialog.innerText(), /2 条台词/);
  assert.deepEqual(await fs.readdir(path.join(game, 'content/scenario')), priorSceneNames, 'import preview wrote a source file');
  await importDialog.getByRole('button', { name: '确认导入新草稿', exact: true }).click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.scenes.has('imported_dialogue'));
  assert.equal(await fs.access(path.join(game, 'content/scenario/imported_dialogue.gal')).then(() => true, () => false), false, 'import confirmation saved implicitly');
  const importedBeforeEdit = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('imported_dialogue').text);
  const firstImportedLine = page.locator('.block[data-line="1"] .v4-dialogue-input');
  await firstImportedLine.fill('导入后的一次返修。');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('imported_dialogue').text), importedBeforeEdit);
  const importSaveFinished = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.locator('[data-action="save-project"]').click();
  const importSaved = await importSaveFinished; assert.ok(importSaved.ok(), await importSaved.text());
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved'
    && document.querySelector('[data-action="save-project"]')?.disabled === false);
  assert.equal(await fs.readFile(path.join(game, 'content/scenario/imported_dialogue.gal'), 'utf8'), importedBeforeEdit);
  await reopenProject();
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('imported_dialogue').text), importedBeforeEdit);
  assert.match(importedBeforeEdit, /引路人：@jump secret 只是印在信上的字。/);
  console.log('PASS CSV: UTF-8 file -> mapped preview -> new unsaved scene -> edit/undo -> normal save -> project reopen; literal instructions remain dialogue');
}

async function resumePublicAuthoring(game) {
  const session = await openAgentPortSession({ projectRoot: game, policy: 'stage' });
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'post-editor-bom-revision', version: '1.0.0' });
  agent = { client, close: async () => { await client.close(); await server.close(); await session.close(); } };
  await server.connect(serverTransport); await client.connect(clientTransport);
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    assert.equal(response.structuredContent.ok, true, JSON.stringify(response));
    return response.structuredContent.result;
  };
  const before = await fs.readFile(path.join(game, 'content/scenario/final_a.gal'), 'utf8');
  await call('surdet_change_begin', { compositionMode: 'direct' });
  const scene = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:final_a', fragment: {} });
  const children = await Promise.all(scene.childRefs.map(objectRef => call('surdet_object_inspect', { view: 'working', objectRef })));
  const text = children.find(object => object.kind === 'text' && object.source.raw.includes('你拆开信封，故乡的风从纸页间吹来。'));
  assert.ok(text);
  await call('surdet_scene_patch', { operationId: 'post-editor-revision', patch: { kind: 'replaceText', target: text.objectRef, expectedFingerprint: text.fingerprint, value: '你拆开信封，故乡的风翻过纸页。' } });
  await call('surdet_project_validate');
  await call('surdet_project_simulate', { sceneId: 'final_a' });
  assert.equal((await call('surdet_runtime_run_from', { sceneId: 'final_a', choices: [] })).status, 'passed');
  assert.equal(await fs.readFile(path.join(game, 'content/scenario/final_a.gal'), 'utf8'), before, 'stage revision changed the saved source');
  await agent.close(); agent = null;
}
try {
  // A fresh engine-shaped fixture keeps cmdNew's workspace registration off the user's repository.
  await fs.mkdir(engine, { recursive: true });
  await fs.writeFile(path.join(engine, 'package.json'), JSON.stringify({ name: 'surdet-new-player-fixture', private: true, type: 'module', workspaces: ['games/*'] }));
  await fs.symlink(path.join(repo, 'node_modules'), path.join(engine, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await cmdNew('first-letter', { engineRoot: engine }), 0);
  const game = path.join(engine, 'games/first-letter');
  const main = await authorChapter(game);
  // Exercise native File reads and byte fingerprints, not a text-only mock.
  for (const file of ['game.config.json', 'content/scenario/第一章/邮局/post_office_visit.gal']) {
    const filePath = path.join(game, file);
    await fs.writeFile(filePath, '\uFEFF' + await fs.readFile(filePath, 'utf8'));
  }
  const endingPath = path.join(game, 'content/scenario/end_a.gal');
  await fs.writeFile(endingPath, '\uFEFF\t' + (await fs.readFile(endingPath, 'utf8')).replace(/\r?\n/g, '\r\n'));
  execFileSync(process.execPath, [path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', path.join(game, 'tsconfig.json'), '--noEmit'], { cwd: engine, stdio: 'pipe', shell: false });
  await build({ root: game, configFile: path.join(game, 'vite.config.ts'), logLevel: 'error' });
  server = await createServer({ root: game, configFile: path.join(game, 'vite.config.ts'), cacheDir: path.join(output, '.vite'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`); await waitTitle(page);
  await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  assert.ok((await canvasTexts(page)).includes('风停之后'));
  assert.ok((await canvasTexts(page)).includes('一封信，两段航程'));
  await page.screenshot({ path: path.join(output, '01-new-project-title.png') });
  await activate(page, '开始游戏');
  await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'awaiting'
    && window.__surdetDebug.presentationSnapshot.stage.portraits.some(p => p.key === 'lynn:coat' && p.view.expression === 'normal'));
  assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.backgroundKey), 'harbor');
  await page.screenshot({ path: path.join(output, '01a-normal-harbor.png') });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__surdetDebug.presentationSnapshot.stage.cameraPan.x === -24
    && window.__surdetDebug.rendererStatus === 'awaiting');
  assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.backgroundKey), 'post_office');
  await page.screenshot({ path: path.join(output, '01b-authored-timeline.png') });
  await advanceToChoice(page);
  assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.portraits.find(p => p.key === 'lynn:coat')?.view.expression), 'smile');
  await page.screenshot({ path: path.join(output, '01c-smile-choice.png') });
  assert.equal(await page.evaluate(() => window.surdetDebug.store.get('visited')), true, 'cross-scene call did not return');
  assert.ok(!(await canvasTexts(page)).includes('点击或空格继续 · Esc 打开菜单 · ↑ 回看上一句'), 'empty hint fell back to the template hint');
  await activate(page, '现在打开');
  await page.waitForFunction(() => window.surdetDebug.store.get('opened') === true);
  const saved = (await state(page)).position;
  await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
  await activate(page, '存档'); await waitOverlay(page, 'save-load');
  await activate(page, '保存到槽位 1：空槽位'); await waitOverlay(page, 'none');
  assert.deepEqual((await state(page)).position, saved);
  await page.screenshot({ path: path.join(output, '02-new-project-reading.png') });
  await page.reload(); await waitTitle(page);
  await activate(page, '读取存档'); await waitOverlay(page, 'save-load');
  const savedSlot = await page.getByRole('button', { name: /^读取槽位 1：/ }).getAttribute('aria-label');
  await activate(page, savedSlot); await waitOverlay(page, 'none');
  assert.deepEqual((await state(page)).position, saved, 'generated project did not restore the actual saved position');
  assert.equal(await page.evaluate(() => window.surdetDebug.store.get('opened')), true);
  assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.portraits.find(p => p.key === 'lynn:coat')?.view.expression), 'smile');
  assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.cameraPan.x), -24);
  await finishToTitle(page);
  await activate(page, '开始游戏'); await advanceToChoice(page);
  assert.equal(await page.evaluate(() => window.surdetDebug.store.get('opened')), false, 'new game did not reset project variables');
  await activate(page, '留到船上再读'); await finishToTitle(page);
  // A separate entry proves existing explicit consumers still override the new config.
  // The generated src/main.ts remains untouched throughout the authoring path.
  await fs.writeFile(path.join(game, 'explicit.html'), (await fs.readFile(path.join(game, 'index.html'), 'utf8')).replace('/src/main.ts', '/src/explicit.ts'));
  await fs.writeFile(path.join(game, 'src/explicit.ts'), main.replace('config: gameConfig,', "config: gameConfig,\n  subtitle: '显式副标题', titleBackground: '', firstRunHint: '显式提示', endScenes: [],"));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/explicit.html`); await waitTitle(page);
  await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  assert.ok((await canvasTexts(page)).includes('显式副标题'));
  assert.ok(!(await canvasTexts(page)).includes('一封信，两段航程'));
  await page.screenshot({ path: path.join(output, '03-explicit-options.png') });
  // Reading mode has no accessible menu buttons. Retain the live render root
  // while title buttons exist, instead of treating an empty lookup as a frame.
  await page.evaluate(() => {
    let root = Array.from(document.querySelectorAll('button')).find(button => button.container?.parent).container;
    while (root.parent) root = root.parent;
    window.__authoringRenderRoot = root;
  });
  await activate(page, '开始游戏');
  await page.waitForFunction(() => sessionStorage.getItem('surdet:controls-seen') === '1');
  await page.waitForFunction(() => {
    const visible = node => node && node.visible && node.alpha > 0.5 && !node.destroyed
      && (node.text === '显式提示' || (node.children ?? []).some(visible));
    return visible(window.__authoringRenderRoot);
  });
  await page.screenshot({ path: path.join(output, '03-explicit-hint.png') });
  await advanceToChoice(page); await activate(page, '现在打开');
  for (let step = 0; step < 12; step++) { await page.keyboard.press('Space'); await page.waitForTimeout(80); }
  assert.notEqual((await state(page)).ui.base, 'title', 'explicit empty endings fell back to config');
  await page.close();
  await continueInEditor(game, errors);
  await page.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`); await waitTitle(page);
  await activate(page, '开始游戏'); await advanceToChoice(page); await activate(page, '现在打开');
  await page.waitForFunction(() => window.__surdetDebug.position?.sceneId === 'final_a');
  await finishToTitle(page);
  await page.screenshot({ path: path.join(output, '05-ending-after-editor-save.png') });
  await resumePublicAuthoring(game);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ generatedBy: 'cmdNew + public MCP', typecheck: true, build: true, unchangedMain: true, explicitOptions: true, editorContinued: true, endingSceneProtected: true, endingAfterEditorSave: true, branches: 2, savedPosition: saved, reloadedPosition: saved, returnedToTitle: true, errors }, null, 2));
  console.log(`PASS actual surdet new project: typecheck/build, two branches, menu save, reload/title load and both endings / ${output}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, `failure-${Date.now()}.png`) }).catch(() => {});
    console.error('NEW_PROJECT_STATE', await state(page).catch(() => null));
    console.error('EDITOR_STATE', await page.evaluate(() => ({ loading: window.surdetEditorDebug?.state?.projectLoading,
      workspace: window.surdetEditorDebug?.state?.assetImportWorkspace, status: document.getElementById('status')?.textContent })).catch(() => null));
  }
  if (error?.stdout) console.error(String(error.stdout));
  if (error?.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await agent?.close();
  if (previousDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousDataRoot;
  await browser?.close(); await server?.close(); await editorServer?.close();
  // Remove the dependency link before any recursive cleanup; never traverse the shared installation.
  const link = path.join(engine, 'node_modules');
  if (await fs.lstat(link).then(() => true, () => false)) await fs.unlink(link);
  if (path.dirname(path.resolve(engine)) !== tempRoot || !path.basename(engine).startsWith('surdet-new-player-')) throw new Error('new-project fixture cleanup escaped its temporary root');
  // Keep local default evidence with the fixture; CI uses an explicit external artifact directory.
  if (process.env.SURDET_NEW_PLAYER_OUTPUT) await fs.rm(engine, { recursive: true, force: true });
}
