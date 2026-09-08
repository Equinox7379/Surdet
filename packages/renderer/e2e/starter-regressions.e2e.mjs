import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { activate, advanceToChoice, state, waitTitle, waitOverlay } from './player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.resolve(process.env.SURDET_STARTER_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-starter-regressions-')));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root: path.join(repo, 'examples/starter'), configFile: path.join(repo, 'examples/starter/vite.config.ts'), cacheDir: path.join(output, '.vite'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let browser;
const evidence = [];
const failures = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const run = async (name, check) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`); await waitTitle(page);
      await check(page, errors);
      evidence.push({ name, passed: true }); console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      evidence.push({ name, passed: false, error: error.message, errors });
      await page.screenshot({ path: path.join(output, `${name}-failure.png`) });
      console.error(`FAIL ${name}: ${error.message}`, errors);
    } finally { await context.close(); }
  };
  await run('title-text-replay', async (page, errors) => {
    await activate(page, '开始游戏'); await advanceToChoice(page);
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '回到标题'); await waitTitle(page);
    const session = (await state(page)).session;
    await activate(page, '鉴赏'); await waitOverlay(page, 'gallery');
    await activate(page, '文本'); await activate(page, '回想 退回三次的信');
    assert.equal((await state(page)).ui.base, 'game', 'replay retained the title input boundary');
    await advanceToChoice(page);
    assert.equal((await state(page)).session, session);
    assert.deepEqual(errors, []);
  });
  await run('incompatible-save-recovery', async (page, errors) => {
    await activate(page, '开始游戏'); await advanceToChoice(page);
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '存档'); await waitOverlay(page, 'save-load');
    await activate(page, '保存到槽位 1：空槽位'); await waitOverlay(page, 'none');
    const saved = await page.evaluate(() => localStorage.getItem('surdet:save:1'));
    assert(saved, 'actual save is missing');
    await page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('surdet:save:1'));
      snapshot.meta.schemaVersion = 999;
      localStorage.setItem('surdet:save:1', JSON.stringify(snapshot));
    });
    await page.reload(); await waitTitle(page);
    await activate(page, '读取存档'); await waitOverlay(page, 'save-load');
    const label = await page.getByRole('button', { name: /^读取槽位 1：/ }).getAttribute('aria-label');
    await activate(page, label);
    await page.waitForFunction(() => window.__surdetDebug.uiSession.operation === 'idle');
    const ui = (await state(page)).ui;
    assert.equal(ui.overlay, 'save-load', 'failed load lost its retry panel');
    assert.equal(ui.base, 'title', 'failed load changed its origin');
    assert(!errors.some(error => error.includes('requires a busy operation')), 'original save error was replaced by a UI operation error');
    assert.equal(errors.length, 2, 'the shell and entrypoint should each report the deliberate failure');
    assert(errors[0].includes('player shell operation failed:') && errors[1].includes('读档失败:'), 'unexpected error reporting path');
    assert(errors.every(error => error.includes('存档 schema 版本 999')), 'original incompatible-version error was not reported');
    await page.evaluate(value => localStorage.setItem('surdet:save:1', value), saved);
    await activate(page, label); await waitOverlay(page, 'none');
    assert.equal((await state(page)).ui.base, 'game', 'retry did not restore the game');
  });
  await run('practice-completion', async (page, errors) => {
    await activate(page, '自由探索'); await advanceToChoice(page);
    await activate(page, '进行一次演练');
    for (let i = 0; i < 15 && await page.evaluate(() => window.__surdetDebug.queries.overlay.system().type !== 'battle'); i++) {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Space'); await page.waitForTimeout(80);
    }
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'battle');
    await page.getByRole('button', { name: '向右移动', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '向左移动', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '向右移动', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.surdetDebug.store.get('trained')), false, 'practice completed before combat');
    await activate(page, '跳过行动');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === '跳过行动（不可用）' && button.getAttribute('aria-disabled') === 'true'));
    for (let i = 0; i < 20 && await page.evaluate(() => window.__surdetDebug.queries.overlay.system().type === 'battle'); i++) {
      await activate(page, '跳过行动'); await page.waitForTimeout(700);
    }
    await advanceToChoice(page);
    assert.equal(await page.evaluate(() => window.surdetDebug.store.get('trained')), true, 'completed practice was not recorded');
    assert.equal(await page.getByRole('button', { name: '进行一次演练', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  });
  await fs.writeFile(path.join(output, 'regressions.json'), JSON.stringify(evidence, null, 2));
  assert.deepEqual(failures, []);
  console.log(`PASS Starter review regressions / ${output}`);
} finally { await browser?.close(); await server.close(); }
