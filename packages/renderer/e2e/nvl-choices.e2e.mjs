import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { activate, advanceToChoice, state, waitTitle, waitOverlay } from './player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_NVL_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-nvl-choices-'));
await fs.mkdir(output, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const server = await createServer({ root: path.join(repo, 'examples/starter'), configFile: path.join(repo, 'examples/starter/vite.config.ts'),
  cacheDir: path.join(output, '.vite'), logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true } });
let browser;
const result = { cases: [], cleanup: false };
async function point(page, label) {
  return page.getByRole('button', { name: label, exact: true }).evaluate(button => {
    const bounds = button.container.getBounds(), canvas = document.querySelector('canvas').getBoundingClientRect();
    return { x: canvas.x + (bounds.x + bounds.width / 2) / 1280 * canvas.width,
      y: canvas.y + (bounds.y + bounds.height / 2) / 720 * canvas.height };
  });
}
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const variant of ['adv-mouse', 'nvl-mouse', 'nvl-hide-restore', 'nvl-keyboard', 'nvl-long-overlays-load']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [], networkErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`); });
    const paragraphs = variant.includes('long') ? `旁白：长篇阅读。${'保留正文并可以滚动。'.repeat(100)}` : '旁白：全屏阅读与选择。';
    const source = `@scene ch01_01\n${variant.startsWith('nvl') ? '@nvl\n' : ''}${paragraphs}\n@choice\n  选择第一项 -> @goto first\n  选择第二项 -> @goto second\n@label first\n@set lynn.trust = 1\n旁白：第一项已选择。\n@end\n@label second\n@set lynn.trust = 2\n旁白：第二项已选择。\n@end\n`;
    try {
      await page.route(/\/content\/scenario\/ch01_01\.gal\?.*raw/, route => route.fulfill({ contentType: 'application/javascript', body: `export default ${JSON.stringify(source)};` }));
      await page.goto(`http://127.0.0.1:${port}/`); await waitTitle(page);
      await activate(page, '开始游戏'); await advanceToChoice(page);
      // Wait for the actual choice entrance to finish, not an arbitrary click delay.
      await page.waitForFunction(() => {
        const card = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '选择第一项')?.container;
        if (!card?.parent) return false;
        let alpha = 1;
        for (let node = card; node; node = node.parent) { if (!node.visible) return false; alpha *= node.alpha; }
        return alpha >= 0.99;
      });
      const before = await state(page), target = await point(page, '选择第一项');
      await page.evaluate(() => document.activeElement?.blur());
      if (variant === 'nvl-hide-restore') {
        await page.keyboard.press('h'); assert.equal((await state(page)).ui.interfaceHidden, true);
        await page.mouse.click(target.x, target.y);
        await page.waitForFunction(() => !window.__surdetDebug.uiSession.interfaceHidden);
        assert.deepEqual((await state(page)).position, before.position);
        assert.deepEqual((await state(page)).dialogue.choiceLabels, before.dialogue.choiceLabels);
        assert.equal((await state(page)).dialogue.nvlActive, true);
        assert.equal((await state(page)).dialogue.panelVisible, false);
      }
      if (variant === 'nvl-long-overlays-load') {
        const nvlY = () => page.evaluate(() => {
          let root = [...document.querySelectorAll('button')].find(b => b.container?.parent)?.container;
          while (root?.parent) root = root.parent;
          const find = node => typeof node?.text === 'string' && node.text.includes('长篇阅读') ? node.y
            : (node?.children ?? []).map(find).find(y => y !== undefined);
          return find(root);
        });
        const y = await nvlY(); assert.equal(typeof y, 'number');
        await page.mouse.move(280, 130); await page.mouse.wheel(0, 1500);
        await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
        assert.notEqual(await nvlY(), y, 'NVL text did not scroll through the real canvas');
        const railSettings = await point(page, '打开设置'); await page.mouse.click(railSettings.x, railSettings.y); await waitOverlay(page, 'settings');
        await page.keyboard.press('Escape'); await waitOverlay(page, 'none');
        await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
        const settings = await point(page, '设置'); await page.mouse.click(settings.x, settings.y); await waitOverlay(page, 'settings');
        await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
        await page.keyboard.press('Escape'); await waitOverlay(page, 'none');
        await page.keyboard.press('l'); await waitOverlay(page, 'backlog');
        await page.mouse.click(target.x, target.y);
        assert.equal(await page.evaluate(() => window.surdetDebug.store.get('lynn.trust')), 0);
        await waitOverlay(page, 'none'); // Clicking Backlog closes it without selecting the card underneath.
        await page.keyboard.press('F5');
        await page.waitForFunction(() => window.__surdetDebug.uiSession.operation === 'idle' && localStorage.getItem('surdet:game:surdet-starter:save:quick') !== null);
        await page.mouse.click(target.x, target.y);
        await page.waitForFunction(() => window.surdetDebug.store.get('lynn.trust') === 1);
        await page.keyboard.press('F9');
        await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'choice' && window.surdetDebug.store.get('lynn.trust') === 0);
        assert.deepEqual((await state(page)).dialogue.choiceLabels, before.dialogue.choiceLabels);
        assert.equal((await state(page)).dialogue.nvlActive, true);
      }
      if (variant.startsWith('nvl')) await page.screenshot({ path: path.join(output, `${variant}.png`) });
      if (variant === 'nvl-keyboard') await activate(page, '选择第一项');
      else { const current = await point(page, '选择第一项'); await page.mouse.click(current.x, current.y); }
      await page.waitForFunction(() => window.surdetDebug.store.get('lynn.trust') === 1, null, { timeout: 4000 });
      assert.notDeepEqual((await state(page)).position, before.position);
      if (variant === 'nvl-long-overlays-load') {
        await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
        await activate(page, '回到标题'); await waitTitle(page);
        await activate(page, '开始游戏'); await advanceToChoice(page);
        assert.equal(await page.evaluate(() => window.surdetDebug.store.get('lynn.trust')), 0);
        assert.deepEqual((await state(page)).dialogue.nvlLines, before.dialogue.nvlLines);
      }
      assert.deepEqual(errors, []); assert.deepEqual(networkErrors, []);
      result.cases.push({ variant, before: before.position, after: (await state(page)).position, errors, networkErrors });
      console.log(`PASS ${variant}`);
    } catch (error) {
      result.cases.push({ variant, failure: String(error), state: await state(page), errors, networkErrors }); throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close(); await server.close(); result.cleanup = true;
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
