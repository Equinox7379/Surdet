import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { activate, advanceToChoice, canvasTexts, state, waitTitle, waitOverlay } from './player-browser-helpers.mjs';

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
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-browser-save-recovery-'));
const browser = await chromium.launch({ headless: true });
try {
  for (const [directory, gameId] of [['starter', 'surdet-starter'], ['zero-after-midnight', 'zero-after-midnight']]) {
    const root = path.join(repo, 'examples', directory);
    const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: await freeEphemeralPort() } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const prefix = `surdet:game:${gameId}:save:`;
    try {
      await server.listen();
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
      await waitTitle(page);
      await activate(page, '开始游戏');
      if (directory === 'starter') await advanceToChoice(page);
      else await page.waitForFunction(() => window.__surdetDebug.status === 'awaiting-advance');
      assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
      const original = await page.evaluate(prefix => JSON.parse(localStorage.getItem(`${prefix}quick`)), prefix);
      await page.evaluate(({ prefix, original }) => {
        for (const id of ['1', '2']) localStorage.setItem(`${prefix}${id}`, JSON.stringify({ ...original, meta: { ...original.meta, id } }));
        localStorage.setItem(`${prefix}1.bak`, '{broken-backup');
      }, { prefix, original });
      await page.reload(); await waitTitle(page);
      await activate(page, '读取存档'); await waitOverlay(page, 'save-load');
      await page.getByRole('button', { name: /^读取槽位 1：/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^读取槽位 1：/ }).count(), 1);
      assert.equal(await page.getByRole('button', { name: '恢复槽位 1的备份并读取', exact: true }).count(), 0);
      assert((await canvasTexts(page)).some(text => text.includes('备份损坏')));
      const healthy = await page.getByRole('button', { name: /^读取槽位 2：/ }).getAttribute('aria-label');
      await activate(page, healthy); await waitOverlay(page, 'none');
      assert.deepEqual((await state(page)).position, original.position);
      assert.equal(await page.evaluate(prefix => localStorage.getItem(`${prefix}1.bak`), prefix), '{broken-backup');
      console.log(`PASS ${directory}: bad backup does not block healthy main slots`);

      await page.evaluate(({ prefix, original }) => {
        localStorage.setItem(`${prefix}1`, '{broken-main');
        localStorage.setItem(`${prefix}1.bak`, JSON.stringify({ ...original, meta: { ...original.meta, id: '1' } }));
        localStorage.setItem(`${prefix}3`, '{broken-main-and-backup');
        localStorage.setItem(`${prefix}3.bak`, '{}');
        localStorage.setItem(`${prefix}4.bak`, JSON.stringify({ ...original, meta: { ...original.meta, id: '4' } }));
      }, { prefix, original });
      await page.reload(); await waitTitle(page);
      await activate(page, '读取存档'); await waitOverlay(page, 'save-load');
      await page.getByRole('button', { name: '恢复槽位 1的备份并读取', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^读取槽位 [13]：/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /^读取槽位 2：/ }).count(), 1);
      assert.equal(await page.getByRole('button', { name: '恢复槽位 3的备份并读取', exact: true }).count(), 0);
      const texts = await canvasTexts(page);
      assert(texts.some(text => text.includes('存档损坏')));
      assert(texts.some(text => text.includes('备份损坏')));
      await page.screenshot({ path: path.join(output, `${directory}-damaged-slots.png`) });
      await activate(page, '恢复槽位 1的备份并读取');
      await activate(page, '取消');
      assert.equal(await page.evaluate(prefix => localStorage.getItem(`${prefix}1`), prefix), '{broken-main');
      await activate(page, '恢复槽位 1的备份并读取');
      await activate(page, '恢复并读取'); await waitOverlay(page, 'none');
      assert.deepEqual((await state(page)).position, original.position);
      await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
      await activate(page, '读档'); await waitOverlay(page, 'save-load');
      await page.getByRole('button', { name: /^读取槽位 1：/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^读取槽位 1：/ }).count(), 1);
      await activate(page, '恢复槽位 4的备份并读取');
      await activate(page, '恢复并读取'); await waitOverlay(page, 'none');
      assert.deepEqual((await state(page)).position, original.position);
      await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
      await activate(page, '读档'); await waitOverlay(page, 'save-load');
      await page.getByRole('button', { name: /^读取槽位 4：/ }).waitFor();
      await activate(page, '关闭存读档'); await waitOverlay(page, 'none');
      console.log(`PASS ${directory}: damaged or absent main restores through confirmation and reopens healthy`);

      await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
      await activate(page, '存档'); await waitOverlay(page, 'save-load');
      await page.getByRole('button', { name: /^保存到槽位 3：/ }).waitFor();
      const damaged = await page.getByRole('button', { name: /^保存到槽位 3：/ }).getAttribute('aria-label');
      assert(damaged.includes('存档损坏'));
      await activate(page, damaged);
      assert.equal(await page.evaluate(prefix => localStorage.getItem(`${prefix}3`), prefix), '{broken-main-and-backup');
      await activate(page, '取消');
      assert.equal(await page.evaluate(prefix => localStorage.getItem(`${prefix}3`), prefix), '{broken-main-and-backup');
      await activate(page, '关闭存读档'); await waitOverlay(page, 'none');
      assert.deepEqual(errors, []);
      console.log(`PASS ${directory}: damaged slot is not empty and overwrite cancellation preserves bytes`);

      await page.reload(); await waitTitle(page);
      await page.evaluate(() => {
        window.restoreStorageRead = Storage.prototype.getItem;
        Storage.prototype.getItem = function() { throw new DOMException('定向回归：存储访问被拒绝', 'SecurityError'); };
      });
      const readFailure = page.waitForEvent('console', { predicate: message => message.type() === 'error' && message.text().includes('存档列表读取失败') });
      await activate(page, '读取存档');
      await readFailure;
      await page.waitForFunction(() => window.__surdetDebug.uiSession.base === 'title' && window.__surdetDebug.uiSession.overlay === 'none');
      // A text node can exist yet be hidden behind the opaque title background.
      await page.waitForFunction(() => {
        const button = Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '读取存档');
        const titleControl = button?.container;
        if (!titleControl?.parent) return false;
        let root = titleControl; while (root.parent) root = root.parent;
        const find = node => typeof node.text === 'string' && node.text.includes('存档列表读取失败')
          ? node : (node.children ?? []).map(find).find(Boolean);
        const bannerText = find(root); if (!bannerText) return false;
        const path = node => {
          const indices = []; let alpha = 1;
          for (let current = node; current; current = current.parent) {
            if (!current.visible || !current.renderable || current.destroyed) return null;
            alpha *= current.alpha;
            if (current.parent) indices.unshift(current.parent.children.indexOf(current));
          }
          return alpha >= .8 ? indices : null;
        };
        const bannerPath = path(bannerText), titlePath = path(titleControl);
        if (!bannerPath || !titlePath) return false;
        const differing = bannerPath.findIndex((index, i) => index !== titlePath[i]);
        return differing >= 0 && bannerPath[differing] > titlePath[differing];
      });
      await page.screenshot({ path: path.join(output, `${directory}-visible-read-failure.png`) });
      assert.equal(errors.length, 1);
      assert(errors[0].includes('存档列表读取失败') && errors[0].includes('存储访问被拒绝'));
      await page.evaluate(() => { Storage.prototype.getItem = window.restoreStorageRead; });
      await activate(page, '读取存档'); await waitOverlay(page, 'save-load');
      await page.getByRole('button', { name: /^读取槽位 1：/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^读取槽位 1：/ }).count(), 1);
      console.log(`PASS ${directory}: backend failure stays explicit and retry opens the real slots`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${directory}-failure.png`) });
      console.error(directory, errors);
      throw error;
    } finally { await context.close(); await server.close(); }
  }
  console.log(`PASS browser save recovery / ${output}`);
} finally { await browser.close(); }
