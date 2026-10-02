import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { activate, advanceToChoice, finishToTitle, state, waitTitle, waitOverlay, canvasTexts } from './player-browser-helpers.mjs';

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
const output = path.resolve(process.env.SURDET_STARTER_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-starter-player-')));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root: path.join(repo, 'examples/starter'), configFile: path.join(repo, 'examples/starter/vite.config.ts'), cacheDir: path.join(output, '.vite'), logLevel: 'error', server: { host: '127.0.0.1', port: await freeEphemeralPort() } });
let browser;
const contexts = [];
const evidence = [];
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await chromium.launch({ headless: true });
  const open = async (viewport = { width: 1440, height: 900 }) => {
    const context = await browser.newContext({ viewport }); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url); await waitTitle(page);
    return { page, context, errors };
  };

  // A new play session must reset optional systems, not merely their visible panels.
  {
    const { page, context, errors } = await open();
    await activate(page, '自由探索'); await advanceToChoice(page);
    await activate(page, '查看雾港地图');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
    const dateBefore = (await canvasTexts(page)).find(text => text.includes('雾港日程'));
    assert(dateBefore, 'actual map date is missing');
    await activate(page, '结束回合'); await advanceToChoice(page);
    await page.keyboard.press('Escape'); await waitOverlay(page, 'system-menu');
    await activate(page, '回到标题'); await waitTitle(page);
    await activate(page, '自由探索'); await advanceToChoice(page);
    await activate(page, '查看雾港地图');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
    const dateAfter = (await canvasTexts(page)).find(text => text.includes('雾港日程'));
    assert.equal(dateAfter, dateBefore, 'new game retained the previous calendar session');
    assert.deepEqual(errors, []);
    evidence.push({ case: 'new-game-system-reset', dateBefore, dateAfter });
    console.log('PASS new game resets the visible calendar to its initial date');
    await context.close();
  }

  // Exercise normal reverse navigation in the real map modal. The transient
  // no-active-control boundary is covered deterministically by player-controls.test.ts.
  {
    const { page, context, errors } = await open();
    await activate(page, '自由探索'); await advanceToChoice(page);
    await activate(page, '查看雾港地图');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
    const focusResults = [];
    for (const key of ['Shift+Tab', 'ArrowUp']) {
      await page.getByRole('button', { name: '进入 旧邮局', exact: true }).focus();
      await page.keyboard.press(key);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '结束回合');
      const focusAfter = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
      assert.equal(focusAfter, '结束回合', `${key} did not wrap to the last enabled map control`);
      if (key === 'Shift+Tab') await page.screenshot({ path: path.join(output, '05-modal-reverse-focus.png') });
      focusResults.push({ key, focusBefore: '进入 旧邮局', focusAfter });
    }
    assert.deepEqual(errors, []);
    evidence.push({ case: 'modal-reverse-focus-wrap', focusResults });
    console.log('PASS modal reverse focus: real Shift+Tab and ArrowUp wrap to the last enabled map control');
    await context.close();
  }

  const routes = [
    { ending: 'ending_open_door', choices: ['先问凛和沈岳的关系', '把信交给她，等她准备好', '让凛亲自把信交出去'] },
    { ending: 'ending_unanswered', choices: ['先收下信，等她自己开口', '请她拆开信，在档案室看清楚再走', '让凛亲自把信交出去'] },
    { ending: 'ending_delivered', choices: ['在窗口查退回章的理由', '核对旧地址和灯塔登记', '只把信递出，不替任何人解释'] },
  ];
  for (const [index, route] of routes.entries()) {
    const { page, context, errors } = await open();
    const session = (await state(page)).session;
    if (index === 0) await page.screenshot({ path: path.join(output, '01-title.png') });
    await activate(page, '开始游戏');
    for (const [choiceIndex, label] of route.choices.entries()) {
      await advanceToChoice(page);
      if (index === 0 && choiceIndex === 0) {
        assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.portraits.find(p => p.key === 'lynn:coat')?.view.expression), 'hesitant');
        await page.screenshot({ path: path.join(output, '02-choice.png') });
      }
      await activate(page, label);
    }
    await page.waitForFunction(ending => window.__surdetDebug.position?.sceneId === ending, route.ending);
    assert.equal(await page.evaluate(() => window.surdetDebug.store.get('cleared')), true);
    assert.equal((await state(page)).session, session, 'story route replaced the runtime');
    if (index === 0) {
      for (let input = 0; input < 30 && !await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.portraits.some(p => p.key === 'lynn:coat' && p.view.expression === 'smile')); input++) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Space'); await page.waitForTimeout(70);
      }
      assert.equal(await page.evaluate(() => window.__surdetDebug.presentationSnapshot.stage.portraits.find(p => p.key === 'lynn:coat')?.view.expression), 'smile');
      await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'awaiting');
      await page.waitForFunction(() => window.__surdetDebug.dialogueProjection.dialogText.endsWith('。'));
      await page.screenshot({ path: path.join(output, '03-ending.png') });
    }
    await finishToTitle(page);
    await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    evidence.push({ case: route.ending, returnedToTitle: true, sameRuntime: true });
    console.log(`PASS ${route.ending}: actual choices, same runtime and return to title`);
    await context.close();
  }

  {
    const { page, context, errors } = await open({ width: 800, height: 600 });
    for (const button of await page.getByRole('button').all()) {
      const rect = await button.boundingBox(); if (!rect) continue;
      assert(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= 801 && rect.y + rect.height <= 601, 'title control is outside the small viewport');
    }
    await page.screenshot({ path: path.join(output, '04-title-compact.png') });
    await activate(page, '自由探索'); await advanceToChoice(page);
    await activate(page, '去柜台补给');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'shop');
    await activate(page, '购买 铁剑');
    assert.equal(await page.evaluate(() => window.surdetDebug.store.get('gold')), 40);
    await activate(page, '离开商店'); await advanceToChoice(page);
    assert.equal(await page.evaluate(() => window.surdetDebug.store.get('hasSword')), true);
    await activate(page, '返回标题'); await finishToTitle(page);
    assert.deepEqual(errors, []);
    evidence.push({ case: 'optional-shop-and-compact-title', purchaseChangedState: true, returnedToTitle: true });
    console.log('PASS compact title and actual optional purchase/return');
    await context.close();
  }
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`PASS modern Starter: ${evidence.length} real player flows / ${output}`);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await server.close();
}
