/** Run with node packages/cli/e2e/independent-project.e2e.mjs.
 * Set npm_execpath only if npm is not beside the installed Node runtime.
 * Local package archives are the declared runtime distribution. No source links,
 * engine workspace, tsconfig inheritance or Vite dev server in the game fixture.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cmdNew } from '../dist/new.js';
import { activate, advanceToChoice, finishToTitle, state, waitTitle, canvasTexts } from '../../renderer/e2e/player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-independent-'));
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await fs.access(npmCli);
console.log(`Independent fixture: ${root}`);
function npm(cwd, args) {
  return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function node(cwd, entry, args = []) {
  return execFileSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8' });
}
const archives = path.join(root, 'packages');
await fs.mkdir(archives);
const packages = ['core', 'renderer', 'host', 'player', 'authoring', 'cli'];
const packed = JSON.parse(npm(repo, ['pack', '--ignore-scripts', '--json', '--pack-destination', archives,
  ...packages.flatMap(name => ['--workspace', `@surdet/${name}`])]));
const tarballs = packed.map(item => path.join(archives, item.filename));
assert.equal(tarballs.length, packages.length);
const example = path.join(root, '中文 示例');
assert.equal(await cmdNew('independent-example', { directory: example }), 0);

let browser;
let server;
try {
  browser = await chromium.launch({ headless: true });
  for (const [template, game] of [['example', example], ['blank', path.join(root, 'blank')]]) {
    if (template === 'blank') {
      // The installed CLI must default to the caller's directory, not any engine root.
      node(root, path.join(example, 'node_modules/@surdet/cli/dist/index.js'), ['new', 'blank', '--template', 'blank']);
    }
    npm(game, ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs]);
    const installed = path.join(game, 'node_modules');
    for (const name of packages) {
      const packagePath = path.join(installed, '@surdet', name);
      assert.equal((await fs.lstat(packagePath)).isSymbolicLink(), false, `linked ${name}`);
      assert.ok((await fs.realpath(packagePath)).startsWith(await fs.realpath(game)), `external ${name}`);
    }
    assert.equal(JSON.parse(await fs.readFile(path.join(game, 'tsconfig.json'), 'utf8')).extends, undefined);
    npm(game, ['run', 'typecheck']);
    npm(game, ['run', 'lint']);
    npm(game, ['run', 'simulate']);
    npm(game, ['run', 'build']);
    const dist = path.join(game, 'dist');
    const requestErrors = [];
    server = http.createServer(async (request, response) => {
      try {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
        const target = path.resolve(dist, relative);
        if (!target.startsWith(`${dist}${path.sep}`)) throw new Error('outside dist');
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
        response.setHeader('Content-Type', types[path.extname(target)] ?? 'application/octet-stream');
        response.end(await fs.readFile(target));
      } catch {
        requestErrors.push(request.url);
        response.writeHead(404); response.end();
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await waitTitle(page);
    await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
    assert.equal(await page.title(), template === 'blank' ? '未命名作品' : '第一封信');
    assert.ok((await canvasTexts(page)).includes(template === 'blank' ? '未命名作品' : '第一封信'));
    await activate(page, '开始游戏');
    await page.waitForFunction(() => window.__surdetDebug?.rendererStatus === 'awaiting');
    if (template === 'example') {
      await advanceToChoice(page);
      await activate(page, '现在打开');
      await page.waitForFunction(() => window.__surdetDebug?.rendererStatus === 'awaiting');
    }
    const saved = (await state(page)).position;
    await page.keyboard.press('F5');
    await page.waitForFunction(() => Object.keys(localStorage).some(key => key.endsWith(':quick')));
    await page.reload();
    await waitTitle(page);
    await activate(page, '继续游戏');
    await page.waitForFunction(() => window.__surdetDebug?.rendererStatus === 'awaiting');
    assert.deepEqual((await state(page)).position, saved);
    await page.screenshot({ path: path.join(root, `${template}-resumed.png`) });
    await finishToTitle(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(requestErrors, []);
    await page.close();
    await new Promise(resolve => server.close(resolve)); server = undefined;
    console.log(`${template}: standalone typecheck/lint/simulate/build; static Player, save/reload, ending passed`);
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
