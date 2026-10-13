import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Capture the actual public context delivered to the custom UI, without replacing its producer.
// This tests the data contract, not Claude's pending rich-text DOM presentation.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_BACKLOG_DATA_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-backlog-data-'));
await fs.mkdir(output, { recursive: true });
const source = '@scene intro\n<em><ruby=あめ>雨</ruby></em><wave>落下</wave><w=10>\n{name}：<b>{literal}</b>\n普通旁白\n@end';
await fs.writeFile(path.join(output, 'index.html'), '<body><div id="app"></div><script type="module" src="/main.ts"></script></body>');
await fs.writeFile(path.join(output, 'main.ts'), `
import { startPlayer } from '/@fs/${repo.replaceAll('\\', '/')}/examples/shared/player/player.ts';
await startPlayer({ id: 'backlog-data-test', config: {
  title: '文字记录数据验证', entryScene: 'intro', player: { firstRunHint: '' },
  variables: { name: { type: 'string', initial: '<i>名字</i>' }, literal: { type: 'string', initial: '<color=red>字面</color>' } },
  ui: { version: 1, pages: { backlog: { id: 'history', type: 'content', source: 'backlog', frame: { x: 30, y: 30, width: 1200, height: 650 } } } }
}, sceneFiles: { 'intro.gal': async () => ${JSON.stringify(source)} }, assetFiles: {}, fontFiles: {}, resolveSceneUrl: p => p });
window.ready = true;
`);
const server = await createServer({ root: output, configFile: false, cacheDir: path.join(output, '.vite'), logLevel: 'error',
  resolve: { alias: [{ find: /^@surdet\/renderer$/, replacement: path.join(repo, 'packages/renderer/src/index.ts') }] },
  plugins: [{ name: 'observe-backlog-context', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/renderer/src/project-ui-dom.ts')) return;
    return code.replace('show(page, context) {', 'show(page, context) { if (page === "backlog") window.backlogContext = context;');
  } }], server: { host: '127.0.0.1', fs: { allow: [repo, output] } } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.backlogContext);
  const items = () => page.evaluate(() => window.backlogContext.content('backlog'));
  const first = await items();
  assert.deepEqual(first, [{ id: '0', label: '雨落下', description: undefined, disabled: true,
    backlog: { speaker: null, text: '雨落下', markup: '<em><ruby=あめ>雨</ruby></em>落下' } }]);
  await page.evaluate(() => { window.backlogContext.content('backlog')[0].backlog.text = '不能污染历史'; });
  assert.deepEqual(await items(), first, 'mutating a returned copy does not change runtime history');
  await page.keyboard.press('Escape');
  // Real shared Player save and load paths, not manually reconstructed history.
  assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
  await page.evaluate(() => window.surdetDebug.interp.advance());
  const second = (await items())[1];
  assert.equal(second.backlog.speaker, '<i>名字</i>');
  assert.equal(second.backlog.text, '<color=red>字面</color>');
  assert.equal(second.backlog.markup, '<b>\\<color=red>字面\\</color></b>');
  assert.equal(second.label, '<i>名字</i>：<color=red>字面</color>');
  await page.evaluate(() => window.surdetDebug.interp.advance());
  assert.deepEqual((await items())[2].backlog, { speaker: null, text: '普通旁白' });
  assert.equal(await page.evaluate(() => window.__surdetDebug.quickLoad()), true);
  assert.deepEqual(await items(), first, 'load replaces the projected history with the saved entries');
  await page.evaluate(() => window.surdetDebug.interp.advance());
  await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
  assert.deepEqual(await items(), first, 'new game clears old entries before recording the first line');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ first, second, errors }, null, 2));
  console.log('PASS actual Player custom backlog: static markup, plain speaker/variables, isolated copies, plain narration, save/load and new game');
} finally { await browser?.close(); await server.close(); }
