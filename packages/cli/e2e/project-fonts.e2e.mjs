import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { openAgentPortSession } from '../dist/agent-port/session.js';
import { cmdNew } from '../dist/new.js';
import { startDevProject } from '../../editor/scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from '../../editor/e2e/asset-import-authority.e2e.mjs';
import { activate, waitTitle } from '../../renderer/e2e/player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.resolve(os.tmpdir());
const engine = await fs.mkdtemp(path.join(tempRoot, 'surdet-project-fonts-'));
const output = path.resolve(process.env.SURDET_FONT_OUTPUT ?? path.join(engine, 'review'));
const oldData = process.env.SURDET_AGENT_DATA_DIR;
const refreshOnly = process.argv.includes('--font-refresh-only');
const fontA = 'content/assets/fonts/甲/同名 字体.TTF';
const fontB = 'content/assets/fonts/乙/同名 字体.TTF';
const badFont = 'content/assets/fonts/损坏.TTF';
const portraitA = 'content/assets/portrait/lynn_uniform_normal.svg';
const portraitB = 'content/assets/portrait/library_casual_smile.svg';
const badPortrait = 'content/assets/portrait/broken_casual_smile.svg';
let browser, page, editorServer, playerServer, session;
const errors = [], loads = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const call = async (id, input = {}) => {
  let result;
  for (let attempt = 0; attempt < 40; attempt++) {
    result = await session.invoke(id, input);
    if (result.ok || result.error.code !== 'PROJECT_BUSY') break;
    // The preview publishes observed frames under the same project lease.
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(result.ok, JSON.stringify(result));
  return result.result;
};

async function verifyLoadedBody(target, expectedHash) {
  await target.waitForFunction(() => [...document.fonts].some(face => face.family === 'SurdetGameBodyFont' && face.status === 'loaded'));
  const loaded = await target.evaluate(async () => {
    const body = window.__fontLoads.filter(font => font.family === 'SurdetGameBodyFont').at(-1);
    const url = /^url\((.*)\)$/.exec(body.source)?.[1];
    const digest = await crypto.subtle.digest('SHA-256', await (await fetch(url)).arrayBuffer());
    return { source: body.source, hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      roles: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family) };
  });
  assert.equal(loaded.hash, expectedHash);
  assert.ok(!loaded.roles.includes('SurdetGameTitleFont') && !loaded.roles.includes('SurdetGameUiFont'));
  loads.push(loaded);
}

async function waitForVisibleStory(target) {
  await target.waitForFunction(() => {
    let root = [...document.querySelectorAll('button')].find(button => button.container?.parent)?.container;
    while (root?.parent) root = root.parent;
    const visible = node => node && node.visible && !node.destroyed
      && (String(node.text ?? '').includes('港口还没有醒来') || (node.children ?? []).some(visible));
    return visible(root);
  });
}

async function verifyMappedPortrait(target) {
  // Inspect the actual rendered world, not only configuration or registration keys.
  const pixels = await target.evaluate(async () => {
    const queries = window.surdetPreviewDebug?.runtime?.queries ?? window.__surdetDebug?.queries;
    const image = new Image(); image.src = queries.world.captureThumbnail(); await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0, red = 0, stageBlue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 40 && data[i + 1] < 65 && data[i + 2] > 210) {
        blue++;
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        if (x > canvas.width * .4 && x < canvas.width * .6 && y < canvas.height * .5) stageBlue++;
      }
      if (data[i] > 210 && data[i + 1] < 40 && data[i + 2] < 65) red++;
    }
    return { blue, red, stageBlue };
  });
  assert.ok(pixels.stageBlue > 100 && pixels.red === 0, `configured portrait not rendered: ${JSON.stringify(pixels)}`);
  loads.push({ mappedPortraitPixels: pixels });
}

try {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(engine, 'package.json'), JSON.stringify({ name: 'font-fixture', private: true, type: 'module', workspaces: ['games/*'] }));
  await fs.symlink(path.join(repo, 'node_modules'), path.join(engine, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await cmdNew('font-story', { engineRoot: engine }), 0);
  const game = path.join(engine, 'games/font-story');
  const mainBefore = await fs.readFile(path.join(game, 'src/main.ts'), 'utf8');
  let bytesA = await fs.readFile(path.join(repo, 'examples/zero-after-midnight/content/assets/fonts/NotoSerifSC-Variable.ttf'));
  const sans = await fs.readFile(path.join(repo, 'examples/zero-after-midnight/content/assets/fonts/NotoSansSC-Variable.ttf'));
  let bytesB = sans;
  if (refreshOnly) {
    // Focused mode uses locally installed fontTools, without adding a production
    // dependency. Small real glyphs keep filesystem-bridge transport out of this test.
    const encoded = JSON.parse(execFileSync('python', ['-c', `
import base64, io, json
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
result = []
for width in (400, 600):
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(['.notdef', 'M'])
    fb.setupCharacterMap({77: 'M'})
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0)); pen.lineTo((width, 0)); pen.lineTo((width, 700)); pen.lineTo((0, 700)); pen.closePath()
    fb.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), 'M': pen.glyph()})
    fb.setupHorizontalMetrics({'.notdef': (700, 0), 'M': (700, 0)})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': 'Surdet Refresh Test', 'styleName': 'Regular', 'uniqueFontIdentifier': 'SurdetRefreshTest', 'fullName': 'Surdet Refresh Test', 'psName': 'SurdetRefreshTest'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost(); fb.setupMaxp()
    buffer = io.BytesIO(); fb.save(buffer)
    result.append(base64.b64encode(buffer.getvalue()).decode())
print(json.dumps(result))
`], { encoding: 'utf8' }));
    [bytesA, bytesB] = encoded.map(value => Buffer.from(value, 'base64'));
    assert.equal(bytesA.length, bytesB.length);
    assert.notEqual(hash(bytesA), hash(bytesB));
  }
  for (const [relative, bytes] of [[fontA, bytesA], [fontB, refreshOnly ? bytesA : bytesB], [badFont, bytesB.subarray(0, 64)]]) {
    await fs.mkdir(path.dirname(path.join(game, relative)), { recursive: true }); await fs.writeFile(path.join(game, relative), bytes);
  }
  if (refreshOnly) await fs.utimes(path.join(game, fontB), new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
  // Fixture setup only. All subsequent config changes go through public authoring.
  const configPath = path.join(game, 'game.config.json');
  const sourceConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  sourceConfig.font = fontA; sourceConfig.fonts = { body: fontA, title: '', ui: '' };
  sourceConfig.characters.lynn = { name: '凛', avatar: 'lynn', portraits: { uniform: { normal: portraitA } }, custom: 'preserve' };
  await fs.mkdir(path.dirname(path.join(game, portraitA)), { recursive: true });
  await fs.mkdir(path.join(game, 'content/assets/avatar'), { recursive: true });
  const marker = fill => `<svg xmlns="http://www.w3.org/2000/svg" width="257" height="389"><rect width="257" height="389" fill="${fill}"/></svg>`;
  await fs.writeFile(path.join(game, portraitA), marker('#f01020'));
  await fs.writeFile(path.join(game, portraitB), marker('#1020f0'));
  await fs.writeFile(path.join(game, badPortrait), 'not an SVG');
  await fs.writeFile(path.join(game, 'content/assets/avatar/lynn.svg'), marker('#1020f0'));
  const storyPath = path.join(game, 'content/scenario/ch01_01.gal');
  await fs.writeFile(storyPath, (await fs.readFile(storyPath, 'utf8')).replace('@bg harbor', '@bg harbor\n@show lynn:uniform normal @ pos=center').replace('旁白：港口还没有醒来', 'lynn：港口还没有醒来'));
  await fs.writeFile(configPath, JSON.stringify(sourceConfig));
  const sourceBefore = await fs.readFile(configPath, 'utf8');
  process.env.SURDET_AGENT_DATA_DIR = path.join(engine, 'agent-data');
  const sourceRoot = path.join(engine, 'prepared-font-license');
  await fs.mkdir(sourceRoot);
  const licenses = [
    ['OFL-NotoSansSC.txt', await fs.readFile(path.join(repo, 'examples/zero-after-midnight/content/assets/fonts/OFL-NotoSansSC.txt'))],
    ['LICENSE-正文', await fs.readFile(path.join(repo, 'examples/zero-after-midnight/content/assets/fonts/OFL-NotoSerifSC.txt'))],
  ];
  await fs.writeFile(path.join(sourceRoot, '带授权字体.TTF'), bytesB);
  for (const [name, bytes] of licenses) await fs.writeFile(path.join(sourceRoot, name), bytes);
  session = await openAgentPortSession({ projectRoot: game, policy: 'apply', assetSources: [sourceRoot], assetImportDataRoot: path.join(engine, 'import-data') });
  const sourceId = (await call('asset.sources')).roots[0].sourceId;
  const items = [];
  for (const [name, kind] of [['带授权字体.TTF', 'font'], ...licenses.map(([name]) => [name, 'license'])]) {
    const { file } = await call('asset.sources', { sourceId, path: name });
    items.push({ itemId: randomUUID(), sourceId, sourcePath: name, sha256: file.sha256, kind, fileName: name });
  }
  const importId = randomUUID();
  const ready = await call('asset.import.stage', { operationId: importId, items });
  await assert.rejects(fs.access(path.join(game, 'content/assets/licenses')), { code: 'ENOENT' });
  await call('asset.import.commit', { operationId: importId, planFingerprint: ready.plan.planFingerprint });
  for (const [name, bytes] of licenses) assert.deepEqual(await fs.readFile(path.join(game, 'content/assets/licenses', name)), bytes);
  await session.close();
  session = await openAgentPortSession({ projectRoot: game, policy: 'stage' });
  await call('change.begin', { compositionMode: 'direct' });
  const changeId = session.activeChangeId;
  const patchFont = async body => {
    const { playerConfig } = await call('project.inspect', { view: 'working' });
    await call('project.player-config.patch', { operationId: `font-${body === fontB ? 'good' : 'bad'}-${Date.now()}`, expectedFingerprint: playerConfig.fingerprint, patch: { fonts: { body, title: '', ui: null } } });
  };
  await patchFont(fontB);
  const patchPortrait = async sourcePath => {
    const inspected = await call('project.inspect', { view: 'working' });
    await call('character.ensure', { operationId: `portrait-${Date.now()}`, id: 'lynn', name: '澪', avatar: 'lynn',
      portraits: { uniform: { normal: sourcePath, smile: sourcePath } }, expectedFingerprint: inspected.charactersFingerprint });
    const reread = await call('project.inspect', { view: 'working' });
    assert.deepEqual(reread.characters.find(c => c.id === 'lynn').declaration.portraits, { uniform: { normal: sourcePath, smile: sourcePath } });
  };
  await patchPortrait(portraitB);
  assert.equal(await fs.readFile(configPath, 'utf8'), sourceBefore);
  const portProbe = net.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  editorServer = await startDevProject(['--project', game, '--data-root', path.join(engine, 'editor-data'), '--port', String(port)], { registerSignals: false, cacheDir: path.join(output, '.editor-vite') });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    window.__fontLoads = [];
    const Font = window.FontFace;
    window.FontFace = class extends Font { constructor(family, source, descriptors) { super(family, source, descriptors); window.__fontLoads.push({ family, source, face: this }); } };
    window.__previewMessages = [];
    window.addEventListener('message', event => { if (event.data?.type?.startsWith('surdet-preview')) window.__previewMessages.push(event.data); });
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
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
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && document.querySelector('[data-action="save-project"]')?.disabled === false);
  await page.keyboard.press('Control+p');
  const selectWorking = async () => {
    await page.getByRole('button', { name: '刷新试玩列表', exact: true }).click();
    const select = page.getByRole('combobox', { name: '试玩内容', exact: true });
    await page.waitForFunction(changeId => [...document.querySelectorAll('select[aria-label="试玩内容"] option')].some(option => option.textContent.includes(changeId)), changeId);
    const value = await select.locator('option').evaluateAll((options, changeId) => options.find(option => option.textContent.includes(changeId)).value, changeId);
    await select.selectOption(value);
    await page.locator('[data-action="reload-preview"]').click();
  };
  await selectWorking();
  const frame = page.frames().find(frame => frame.url().includes('/preview.html'));
  assert.ok(frame);
  await verifyLoadedBody(frame, hash(refreshOnly ? bytesA : bytesB));
  await waitForVisibleStory(frame);
  await verifyMappedPortrait(frame);
  assert.equal(await fs.readFile(configPath, 'utf8'), sourceBefore);
  assert.equal(JSON.parse(await page.evaluate(() => window.surdetEditorDebug.state.gameConfigText)).fonts.body, fontA);
  await page.screenshot({ path: path.join(output, 'working-font.png') });
  if (refreshOnly) {
    const filePath = path.join(game, fontB);
    const before = await fs.stat(filePath);
    await page.evaluate(() => { window.__fontRootBefore = window.surdetEditorDebug.state.dirHandle; });
    const loadCount = await frame.evaluate(() => window.__fontLoads.length);
    await fs.writeFile(filePath, bytesB);
    await fs.utimes(filePath, before.atime, before.mtime);
    const after = await fs.stat(filePath);
    assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
    await page.locator('[data-action="reload-preview"]').click();
    await frame.waitForFunction(count => {
      const next = window.__fontLoads.filter(font => font.family === 'SurdetGameBodyFont').at(-1);
      return window.__fontLoads.length > count && next?.face.status === 'loaded' && document.fonts.has(next.face);
    }, loadCount);
    await verifyLoadedBody(frame, hash(bytesB)); await waitForVisibleStory(frame);
    assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.dirHandle === window.__fontRootBefore), true);
    assert.match(await page.locator('.preview-source-state').textContent(), /Agent 可读取本次实际播放记录/);
    assert.equal(await page.locator('.preview-source-state').getAttribute('data-preview-source-state'), 'fresh');
    const payload = await frame.evaluate(() => {
      const message = window.__previewMessages.filter(message => message.type === 'surdet-preview-load').at(-1);
      return { path: message.payload.fonts.body.sourcePath, version: message.payload.fonts.body.version };
    });
    assert.deepEqual(payload, { path: fontB, version: hash(bytesB) });
    assert.equal(await fs.readFile(configPath, 'utf8'), sourceBefore);
    assert.equal(await fs.readFile(path.join(game, 'src/main.ts'), 'utf8'), mainBefore);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'same-metadata-font-refreshed.png') });
    await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ samePath: fontB, bytes: after.size, mtimeMs: after.mtimeMs,
      hashBefore: hash(bytesA), hashAfter: hash(bytesB), sameRoot: true, sameWorkingChange: changeId,
      formalSourceCheckAccepted: true, payload, loads, errors }, null, 2));
    console.log(`PASS same-path same-metadata font refresh through bound working preview / ${output}`);
  } else {
  await patchFont(badFont);
  await selectWorking();
  await page.waitForFunction(bad => window.__previewMessages.some(message => message.type === 'surdet-preview-trace-complete' && message.status === 'failed' && JSON.stringify(message).includes(bad)), badFont);
  await page.screenshot({ path: path.join(output, 'bad-font.png') });
  await patchFont(fontB);
  await selectWorking(); await verifyLoadedBody(frame, hash(bytesB)); await waitForVisibleStory(frame);
  await patchPortrait(badPortrait);
  await selectWorking();
  await page.waitForFunction(bad => window.__previewMessages.some(message => message.type === 'surdet-preview-trace-complete' && message.status === 'failed' && JSON.stringify(message).includes(bad)), badPortrait);
  await patchPortrait(portraitB);
  await selectWorking(); await waitForVisibleStory(frame); await verifyMappedPortrait(frame);
  await page.screenshot({ path: path.join(output, 'working-portrait.png') });
  await page.close(); await editorServer.close(); editorServer = null;
  await session.close(); session = await openAgentPortSession({ projectRoot: game, policy: 'apply', resumeChangeId: changeId });
  await call('project.validate'); await call('project.simulate'); await call('runtime.run-from', { sceneId: sourceConfig.entryScene, choices: [0] });
  await call('change.diff'); await call('change.commit');
  await session.close(); session = null;
  assert.equal(await fs.readFile(path.join(game, 'src/main.ts'), 'utf8'), mainBefore);
  await build({ root: game, configFile: path.join(game, 'vite.config.ts'), logLevel: 'error' });
  const builtAssets = await fs.readdir(path.join(game, 'dist/assets'));
  const builtLicenses = [];
  for (const [name, bytes] of licenses) {
    let found;
    for (const asset of builtAssets.filter(asset => asset.startsWith(name.replace(/\.txt$/, '') + '-'))) {
      if ((await fs.readFile(path.join(game, 'dist/assets', asset))).equals(bytes)) { found = asset; break; }
    }
    assert.ok(found, `license missing or rewritten in built output: ${name}`);
    assert.ok(!found.endsWith('.'), `Windows-incompatible generated license filename: ${found}`);
    builtLicenses.push(found);
  }
  playerServer = await preview({ root: game, configFile: path.join(game, 'vite.config.ts'), logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${playerServer.httpServer.address().port}/`); await waitTitle(page);
  await verifyLoadedBody(page, hash(bytesB));
  // The intentionally broken, now-unused portrait remains on disk; the loader
  // still reports that physical file while the configured slot uses the valid image.
  assert.equal(await page.evaluate(() => window.__surdetDebug.assetLoading.failed), 1);
  await activate(page, '开始游戏');
  await waitForVisibleStory(page);
  await verifyMappedPortrait(page);
  await page.screenshot({ path: path.join(output, 'built-player-font.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ workingUsesUnpublishedConfig: true, sourceUnchangedBeforeCommit: true,
    badFontReportedAsFailed: true, badConfiguredPortraitReportedAsFailed: true, workingAndBuiltPortraitRendered: true, retainedUnusedBrokenPortraitFailures: 1,
    recoveredSameChange: true, unchangedMain: true, builtPlayerLoadedExactFont: true, licenseBatchImported: true, builtLicenses, loads, errors }, null, 2));
  console.log(`PASS project fonts: working preview, bad font recovery, authorized commit, built Player / ${output}`);
  }
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, `failure-${Date.now()}.png`) }).catch(() => {});
    console.error(await page.evaluate(() => ({ status: document.getElementById('status')?.textContent, preview: document.querySelector('.preview-source-state')?.textContent,
      options: [...document.querySelectorAll('select[aria-label="试玩内容"] option')].map(option => option.textContent), messages: window.__previewMessages?.slice(-4) })).catch(() => null));
  }
  throw error;
} finally {
  await session?.close(); await browser?.close(); await editorServer?.close();
  if (playerServer) await new Promise(resolve => playerServer.httpServer.close(resolve));
  if (oldData === undefined) delete process.env.SURDET_AGENT_DATA_DIR; else process.env.SURDET_AGENT_DATA_DIR = oldData;
  const link = path.join(engine, 'node_modules');
  if (await fs.lstat(link).then(() => true, () => false)) await fs.unlink(link);
  if (path.dirname(path.resolve(engine)) !== tempRoot || !path.basename(engine).startsWith('surdet-project-fonts-')) throw new Error('font fixture cleanup escaped its temporary root');
  if (process.env.SURDET_FONT_OUTPUT) await fs.rm(engine, { recursive: true, force: true });
}
