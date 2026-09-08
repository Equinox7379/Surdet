import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { chromium } from 'playwright';
import { cmdNew } from '../dist/new.js';
import { activate, advanceToChoice, finishToTitle, state, waitTitle, waitOverlay } from '../../renderer/e2e/player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.resolve(os.tmpdir());
const engine = await fs.mkdtemp(path.join(tempRoot, 'surdet-new-player-'));
const output = path.resolve(process.env.SURDET_NEW_PLAYER_OUTPUT ?? path.join(engine, 'review'));
let server;
let browser;
let page;
try {
  // A fresh engine-shaped fixture keeps cmdNew's workspace registration off the user's repository.
  await fs.mkdir(path.join(engine, 'examples'), { recursive: true });
  await fs.cp(path.join(repo, 'examples/shared'), path.join(engine, 'examples/shared'), { recursive: true });
  await fs.copyFile(path.join(repo, 'tsconfig.base.json'), path.join(engine, 'tsconfig.base.json'));
  await fs.writeFile(path.join(engine, 'package.json'), JSON.stringify({ name: 'surdet-new-player-fixture', private: true, type: 'module', workspaces: ['games/*'] }));
  await fs.symlink(path.join(repo, 'node_modules'), path.join(engine, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await cmdNew('first-letter', engine), 0);
  const game = path.join(engine, 'games/first-letter');
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
  await page.screenshot({ path: path.join(output, '01-new-project-title.png') });
  await activate(page, '开始游戏'); await advanceToChoice(page);
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
  await finishToTitle(page);
  await activate(page, '开始游戏'); await advanceToChoice(page);
  assert.equal(await page.evaluate(() => window.surdetDebug.store.get('opened')), false, 'new game did not reset project variables');
  await activate(page, '留到船上再读'); await finishToTitle(page);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ generatedBy: 'cmdNew', typecheck: true, build: true, branches: 2, savedPosition: saved, reloadedPosition: saved, returnedToTitle: true, errors }, null, 2));
  console.log(`PASS actual surdet new project: typecheck/build, two branches, menu save, reload/title load and both endings / ${output}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error('NEW_PROJECT_STATE', await state(page).catch(() => null));
  }
  if (error?.stdout) console.error(String(error.stdout));
  if (error?.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await browser?.close(); await server?.close();
  // Remove the dependency link before any recursive cleanup; never traverse the shared installation.
  const link = path.join(engine, 'node_modules');
  if (await fs.lstat(link).then(() => true, () => false)) await fs.unlink(link);
  if (path.dirname(path.resolve(engine)) !== tempRoot || !path.basename(engine).startsWith('surdet-new-player-')) throw new Error('new-project fixture cleanup escaped its temporary root');
  // Keep local default evidence with the fixture; CI uses an explicit external artifact directory.
  if (process.env.SURDET_NEW_PLAYER_OUTPUT) await fs.rm(engine, { recursive: true, force: true });
}
