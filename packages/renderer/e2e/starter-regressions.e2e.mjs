import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { activate, advanceToChoice, state, waitTitle, waitOverlay } from './player-browser-helpers.mjs';

/** Vite 把 server.port=0 当缺省值并回退 5173；显式取一个空闲端口，
 *  避免落在 Windows 保留端口段（如 Hyper-V 排除区间）时以 EACCES 直接失败。 */
async function freeEphemeralPort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.resolve(process.env.SURDET_STARTER_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-starter-regressions-')));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root: path.join(repo, 'examples/starter'), configFile: path.join(repo, 'examples/starter/vite.config.ts'), cacheDir: path.join(output, '.vite'), logLevel: 'error', server: { host: '127.0.0.1', port: await freeEphemeralPort() } });
let browser;
const evidence = [];
const failures = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const run = async (name, check, prepare = async () => {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await prepare(page);
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
  await run('quickload-clears-hidden-and-overlay-state', async (page, errors) => {
    await activate(page, '开始游戏'); await advanceToChoice(page);
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
    await page.keyboard.press('l'); await waitOverlay(page, 'backlog');
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
    assert.equal((await state(page)).ui.overlay, 'backlog');
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickLoad()), true);
    await waitOverlay(page, 'none');
    await page.keyboard.press('l'); await waitOverlay(page, 'backlog');
    await page.keyboard.press('Escape'); await waitOverlay(page, 'none');
    await page.keyboard.press('h');
    assert.equal((await state(page)).ui.interfaceHidden, true);
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickLoad()), true);
    assert.equal((await state(page)).ui.interfaceHidden, false);
    assert.equal(await page.evaluate(() => window.__surdetDebug.commandRailVisible), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'quickload-interface-restored.png') });
  });
  await run('skipped-video-releases-input', async (page, errors) => {
    await activate(page, '开始游戏');
    await page.waitForFunction(() => window.__surdetDebug.position.sceneId === 'ch01_01');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('x');
    await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'choice');
    assert.equal((await state(page)).ui.videoActive, false);
    await activate(page, '继续检查');
    await page.waitForFunction(() => window.__surdetDebug.position.pc > 3);
    assert.equal((await state(page)).ui.videoActive, false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'skipped-video-input.png') });
  }, async page => {
    await page.route(/\/content\/scenario\/ch01_01\.gal\?.*raw/, route => route.fulfill({
      contentType: 'application/javascript', body: `export default ${JSON.stringify('@scene ch01_01\n旁白：快进前。\n@video deliberately_absent\n旁白：快进后。\n@choice\n  继续检查 -> @goto after\n@label after\n旁白：输入仍然有效。\n@choice\n  停留\n@end\n')};`,
    }));
  });
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
  await run('save-failure-preserves-slot-and-retry', async (page, errors) => {
    await activate(page, '开始游戏'); await advanceToChoice(page);
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '存档'); await waitOverlay(page, 'save-load');
    await activate(page, '保存到槽位 1：空槽位'); await waitOverlay(page, 'none');
    const before = await page.evaluate(() => localStorage.getItem('surdet:game:surdet-starter:save:1'));
    await page.evaluate(() => {
      window.restoreStorageWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('surdet:game:surdet-starter:save:')) throw new DOMException('维护测试：存储空间不足', 'QuotaExceededError');
        return window.restoreStorageWrite.call(this, key, value);
      };
    });
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), false);
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '存档'); await waitOverlay(page, 'save-load');
    const label = await page.getByRole('button', { name: /^保存到槽位 1：/ }).getAttribute('aria-label');
    await activate(page, label);
    await activate(page, '覆盖存档');
    await page.waitForFunction(() => window.__surdetDebug.uiSession.operation === 'idle');
    assert.equal((await state(page)).ui.overlay, 'save-load');
    assert.equal(await page.evaluate(() => localStorage.getItem('surdet:game:surdet-starter:save:1')), before);
    assert(errors.some(error => error.includes('维护测试：存储空间不足')));
    await page.evaluate(() => { Storage.prototype.setItem = window.restoreStorageWrite; });
    await activate(page, label); await activate(page, '覆盖存档'); await waitOverlay(page, 'none');
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
    await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem('surdet:game:surdet-starter:save:quick'));
      save.meta.playTimeSec = 600;
      localStorage.setItem('surdet:game:surdet-starter:save:quick', JSON.stringify(save));
    });
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickLoad()), true);
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
    assert((await page.evaluate(() => JSON.parse(localStorage.getItem('surdet:game:surdet-starter:save:quick')).meta.playTimeSec)) >= 600, 'loading lost prior play time');
  });
  await run('browser-save-backup-restore', async (page, errors) => {
    await activate(page, '开始游戏'); await advanceToChoice(page);
    const original = (await state(page)).position;
    const saveSlot = async () => {
      await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
      await activate(page, '存档'); await waitOverlay(page, 'save-load');
      const slot = page.getByRole('button', { name: /^保存到槽位 1：/ });
      await activate(page, await slot.getAttribute('aria-label'));
    };
    await saveSlot(); await waitOverlay(page, 'none');
    const choice = (await state(page)).dialogue.choiceLabels[0];
    assert(choice, 'the first authored choice is missing');
    await activate(page, choice);
    await page.waitForFunction((saved) => JSON.stringify(window.__surdetDebug.position) !== JSON.stringify(saved), original);
    await saveSlot(); await activate(page, '覆盖存档'); await waitOverlay(page, 'none');
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '读档'); await waitOverlay(page, 'save-load');
    await activate(page, '恢复槽位 1 的备份并读取');
    await activate(page, '恢复并读取'); await waitOverlay(page, 'none');
    assert.deepEqual((await state(page)).position, original);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'browser-backup-restored.png') });
  });
  await run('autosave-failure-and-hidden-interface', async (page, errors) => {
    const unhandled = [];
    page.on('pageerror', error => unhandled.push(error.message));
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('surdet:game:surdet-starter:save:')) throw new DOMException('维护测试：自动存档被拒绝', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await activate(page, '开始游戏'); await advanceToChoice(page);
    await page.waitForFunction(() => window.__surdetDebug.uiSession.operation === 'idle');
    assert(errors.some(error => error.includes('自动存档失败')));
    assert.deepEqual(unhandled, []);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('h');
    assert.equal((await state(page)).ui.interfaceHidden, true);
    assert.equal(await page.evaluate(() => window.__surdetDebug.commandRailVisible), false);
    await page.mouse.click(700, 500);
    await page.waitForFunction(() => window.__surdetDebug.uiSession.interfaceHidden === false);
    await page.screenshot({ path: path.join(output, 'interface-restored.png') });
  });
  await run('incompatible-save-recovery', async (page, errors) => {
    await activate(page, '开始游戏'); await advanceToChoice(page);
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '存档'); await waitOverlay(page, 'save-load');
    await activate(page, '保存到槽位 1：空槽位'); await waitOverlay(page, 'none');
    const saved = await page.evaluate(() => localStorage.getItem('surdet:game:surdet-starter:save:1'));
    assert(saved, 'actual save is missing');
    await page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('surdet:game:surdet-starter:save:1'));
      snapshot.meta.schemaVersion = 999;
      localStorage.setItem('surdet:game:surdet-starter:save:1', JSON.stringify(snapshot));
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
    await page.evaluate(value => localStorage.setItem('surdet:game:surdet-starter:save:1', value), saved);
    await activate(page, label); await waitOverlay(page, 'none');
    assert.equal((await state(page)).ui.base, 'game', 'retry did not restore the game');
  });
  await run('practice-completion', async (page, errors) => {
    await activate(page, '自由探索'); await advanceToChoice(page);
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
    await activate(page, '进行一次演练');
    for (let i = 0; i < 15 && await page.evaluate(() => window.__surdetDebug.queries.overlay.system().type !== 'battle'); i++) {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Space'); await page.waitForTimeout(80);
    }
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'battle');
    const beforeBattle = await page.evaluate(() => ({ ui: window.__surdetDebug.uiSession, save: localStorage.getItem('surdet:game:surdet-starter:save:quick') }));
    assert(beforeBattle.save, 'the pre-battle quick save must exist');
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), false);
    assert.equal(await page.evaluate(() => window.__surdetDebug.quickLoad()), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__surdetDebug.queries.overlay.system().type), 'battle');
    assert.deepEqual((await state(page)).ui, beforeBattle.ui);
    assert.equal(await page.evaluate(() => localStorage.getItem('surdet:game:surdet-starter:save:quick')), beforeBattle.save);
    await page.getByRole('button', { name: '向右移动', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '向左移动', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '向右移动', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.surdetDebug.store.get('trained')), false, 'practice completed before combat');
    await activate(page, '跳过行动');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === '跳过行动（不可用）' && button.getAttribute('aria-disabled') === 'true'));
    for (let i = 0; i < 20; i++) {
      await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type !== 'battle' || Array.from(document.querySelectorAll('button')).some(button => {
        const target = button.container;
        return button.getAttribute('aria-label') === '跳过行动' && button.getAttribute('aria-disabled') !== 'true' && target?.parent && !target.destroyed && target.accessibleHint === '跳过行动';
      }));
      if (await page.evaluate(() => window.__surdetDebug.queries.overlay.system().type !== 'battle')) break;
      await activate(page, '跳过行动');
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
