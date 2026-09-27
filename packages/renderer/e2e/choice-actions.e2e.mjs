import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createStageFixture } from '../../editor/e2e/support/stage-fixture.mjs';
import { activate, waitTitle } from './player-browser-helpers.mjs';

// A normal built Player, with no parser replacement or runtime state injection.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
assert(process.argv[2], 'Provide a new output directory');
const output = path.resolve(process.argv[2]);
assert(!fs.existsSync(output), 'Preserve earlier evidence');
const project = path.join(output, 'project');
const entry = path.relative(path.join(project, 'src'), path.join(repo, 'examples/shared/player/player.ts')).split(path.sep).join('/');
const fixture = createStageFixture(project, entry);
const config = { ...fixture.config };
delete config.stage;
fs.writeFileSync(path.join(project, 'game.config.json'), JSON.stringify(config));
const cases = [
  { label: '未闭合的 "文案', action: '@bg "night"' },
  { label: "未闭合的 '文案", action: "@bg 'night'" },
  { label: '正常的 "文案"', action: '@bg "night"' },
  { label: "Don't stop", action: '@bg "night"' },
  { label: '选 "同意 -> @jump fake" 这项', action: '@bg "night"' },
];
fs.writeFileSync(path.join(project, 'content/scenario/start.gal'), '@scene start\n@bg dock\n@choice\n'
  + cases.map(({ label, action }) => `  ${label} [if:" -> " == " -> "] -> ${action} @jump accepted`).join('\n')
  + '\n错误分支。\n@end\n');
fs.writeFileSync(path.join(project, 'content/scenario/accepted.gal'), '@scene accepted\n正确分支。\n@end\n');
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(project, 'node_modules'), 'junction');
const evidence = { status: 'running', checks: [], pageErrors: [], consoleErrors: [], failedRequests: [] };
let server, browser, page;
try {
  fs.writeFileSync(path.join(output, 'build.log'), execFileSync(process.execPath,
    [path.join(repo, 'packages/cli/dist/index.js'), 'build', project, '--web'], { cwd: repo, encoding: 'utf8', timeout: 120000 }));
  const dist = path.join(output, 'isolated-dist');
  fs.cpSync(path.join(project, 'dist'), dist, { recursive: true });
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  for (const [index, { label }] of cases.entries()) {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await waitTitle(page);
    await activate(page, '开始游戏');
    await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'choice');
    const labels = await page.evaluate(() => window.__surdetDebug.dialogueProjection.choiceLabels);
    assert.deepEqual(labels, cases.map(value => value.label));
    await page.waitForFunction(expected => expected.every(label => [...document.querySelectorAll('button')].some(button => {
      if (button.getAttribute('aria-label') !== label || !button.container?.parent) return false;
      for (let node = button.container; node; node = node.parent) if (!node.visible || node.destroyed || node.alpha < .99) return false;
      return true;
    })), cases.map(value => value.label));
    if (index === 0) await page.screenshot({ path: path.join(output, 'choices.png') });
    // Accessibility nodes are behind Pixi's canvas; send a real pointer to
    // their projected bounds instead of forcing a DOM click through the canvas.
    const bounds = await page.getByRole('button', { name: label, exact: true }).boundingBox();
    assert(bounds && bounds.width > 0 && bounds.height > 0);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'awaiting'
      && window.__surdetDebug.dialogueProjection.dialogText === '正确分支。');
    const actual = await page.evaluate(() => ({ scene: window.__surdetDebug.position.sceneId,
      background: window.__surdetDebug.presentationSnapshot.stage.backgroundKey,
      dialogue: window.__surdetDebug.dialogueProjection.dialogText }));
    assert.deepEqual(actual, { scene: 'accepted', background: 'night', dialogue: '正确分支。' });
    if (index === 0) await page.screenshot({ path: path.join(output, 'accepted.png') });
    evidence.checks.push({ label, ...actual });
  }
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.consoleErrors, []);
  assert.deepEqual(evidence.failedRequests, []);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error.stack ?? String(error); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
