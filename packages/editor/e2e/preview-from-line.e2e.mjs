import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Built Editor with the in-memory test file system and the real preview iframe. "从这一行试玩"
// runs the shared Authoring query on the content the preview plays, starts only from a reached
// result, replays real input up to a temporary Core breakpoint, and keeps a test start's stage empty.
const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(editorRoot, 'dist');
await fs.access(path.join(dist, 'index.html'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const target = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(dist, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403); response.end(); return; }
    try { const bytes = await fs.readFile(target); response.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream' }); response.end(bytes); }
    catch { response.writeHead(404); response.end('Not found'); }
  })().catch((error) => { response.writeHead(500); response.end(String(error)); });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/`;

function wav(seconds) {
  const bytes = Buffer.alloc(44 + 8000 * 2 * seconds);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
const config = JSON.stringify({ entryScene: 'entry', characters: { lynn: { name: '凛' } }, variables: { trust: { type: 'number', initial: 0 } } });
// The choice and the later targets follow a dialogue line directly, as most lines in a script do.
const entry = [
  '@scene entry', // 1
  '@bg harbor', // 2
  '@bgm theme', // 3
  '凛：开场。', // 4
  '@choice', // 5
  '  回家 -> @set trust = 1 @jump home', // 6
  '  留下 -> @end', // 7
  '@end', // 8
].join('\n');
const home = [
  '@scene home', // 1
  '凛：路上。', // 2
  '', // 3
  '@label arrival', // 4
  '@set trust += 2', // 5
  '凛：回家了。', // 6  ← target
  '凛：之后。', // 7
  '@end', // 8
].join('\n');
const side = '@scene side\n凛：没人来的地方。\n@end';
const files = [
  ...Object.entries({ 'game.config.json': config, 'content/scenario/entry.gal': entry, 'content/scenario/home.gal': home, 'content/scenario/side.gal': side,
    'content/assets/bg/harbor.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#246"/></svg>' })
    .map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') })),
  { path: 'content/assets/bgm/theme.wav', bytes: wav(4).toString('base64') },
];

const outDir = process.env.SURDET_FROM_LINE_E2E_OUTPUT;
const errors = [];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-from-line-test', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.scene-item[data-scene-id="home"]').click();
  await page.locator('.v4-authoring .block[data-line="5"]').waitFor();
  const row = (line) => page.locator(`.v4-authoring .block[data-line="${line}"]`);
  const fromLine = page.locator('[data-action="preview-from-line"]');
  const status = page.locator('.preview-target-status');
  const waitStatus = async (text) => {
    try { await status.filter({ hasText: text }).waitFor(); }
    catch {
      const read = async (selector) => page.locator(selector).first().innerText().catch(() => '');
      throw new Error(`target status never showed “${text}”: ${await read('.preview-target-status')} | ${await read('.preview-target-details')} | ${await read('.preview-diagnostics')}`);
    }
  };
  const debug = (read) => page.evaluate(`(() => { const debug = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return debug?.interp && debug?.runtime ? (${read})(debug) : null; })()`);
  const pausedAt = '(d) => { const s = d.interp.debugSnapshot(); return { paused: s.paused, reason: s.reason, sceneId: s.current?.sceneId, line: s.current?.line, trust: s.variables.trust }; }';
  const stage = '(d) => { const p = d.runtime.queries.presentation.snapshot(); return { bg: p.stage?.backgroundKey ?? null, bgm: p.audio?.bgm ?? null, history: (p.dialogue?.backlog ?? []).map((entry) => entry.text), text: d.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText ?? "" }; }';
  // Focusing a row selects it through the workbench's own focus handler, as clicking into it does.
  // Nothing starts: the preview has booted, had time to begin a load, and is still idle with no interpreter.
  const assertNotStarted = async (why) => {
    await page.waitForFunction(() => Boolean(document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.runtime));
    await page.waitForTimeout(800);
    assert.equal(await page.locator('[data-preview-source-state]').getAttribute('data-preview-source-state'), 'idle', why);
    assert.equal(await page.evaluate(() => document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.interp ?? null), null, why);
  };
  const select = async (line) => {
    await row(line).evaluate((node) => node.focus());
    await page.waitForFunction((line) => document.querySelector(`.v4-authoring .block[data-line="${line}"]`)?.classList.contains('v4-current'), line);
  };

  // 1. Search from the entry: real choice, then a pause before the target line, with the route's stage.
  await select(5);
  await fromLine.click();
  await waitStatus('已停在 home 第 6 行之前');
  assert.deepEqual(await debug(pausedAt), { paused: true, reason: 'breakpoint', sceneId: 'home', line: 6, trust: 3 });
  const searched = await debug(stage);
  assert.equal(searched.bg, 'harbor', 'the real route rebuilt the background');
  assert.equal(searched.bgm, 'theme', 'the real route started the music');
  assert.deepEqual(searched.history, ['开场。', '路上。'], 'the route was read line by line');
  assert.notEqual(searched.text, '回家了。', 'the target has not executed yet');
  const details = await page.locator('.preview-target-details li').allTextContents();
  assert(details.some((line) => line.includes('途中依次选择序号 0')), details.join('\n'));
  assert.match(await page.locator('.preview-debugger').innerText(), /trust = 3/);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'from-line-reached.png') });
  // 继续运行 executes the target line through the existing debug control.
  await page.locator('.preview-debugger').getByRole('button', { name: '继续运行' }).click();
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.runtime?.queries.diagnostics.projectionSnapshot().dialogue?.dialogText === '回家了。');
  console.log('PASS search: real route to home line 6, paused before it with trust 3, background and music; 继续运行 runs it');

  // 2. A test start: nearest label, temporary value, a new session with no earlier background or music.
  await page.locator('.preview-target').getByLabel('起点方式').selectOption('test');
  await page.locator('.preview-target').getByLabel('临时初值 trust').fill('8');
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await waitStatus('已停在 home 第 6 行之前');
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.interp?.debugSnapshot().variables.trust === 10);
  assert.deepEqual(await debug(pausedAt), { paused: true, reason: 'breakpoint', sceneId: 'home', line: 6, trust: 10 });
  assert.deepEqual(await debug(stage), { bg: null, bgm: null, history: [], text: '' }, 'test start does not keep the earlier background, music or text');
  assert.match(await page.locator('.preview-target-details').innerText(), /之前的背景、立绘和音乐没有重建/);
  assert.match(await page.locator('.preview-source-state').innerText(), /临时初值只用于本次试玩/);
  const configText = await page.evaluate(async () => {
    const root = await window.showDirectoryPicker();
    return (await (await root.getFileHandle('game.config.json')).getFile()).text();
  });
  assert.equal(configText, config, 'the work’s config is unchanged');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'from-line-test-start.png') });
  console.log('PASS test start: label arrival with trust 8 → 10, empty stage and music, config unchanged');

  // 3. Editing after the start marks the found start as old.
  await row(6).locator('.v4-dialogue-input').click();
  await page.keyboard.press('End');
  await page.keyboard.type('啊');
  await waitStatus('剧本已修改，这次起点属于旧版本');
  await page.keyboard.press('Backspace');
  console.log('PASS an edit after the start reports the start as old');

  // 4. A blank row is refused; nothing is played.
  await select(2);
  await fromLine.click();
  await waitStatus('不能从这一行开始');
  assert.match(await status.innerText(), /没有可执行内容/);
  await assertNotStarted('a refused row starts no run');
  console.log('PASS blank row refused without starting a run');

  // 5. A path that lacks a choice is not guessed.
  await select(5);
  await fromLine.click();
  await waitStatus('已停在 home 第 6 行之前');
  await page.locator('.preview-target').getByLabel('起点方式').selectOption('path');
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await waitStatus('给出的选择路径走不通');
  console.log('PASS path mode without the needed choice: path-mismatch, nothing guessed');

  // 6. An option row stops before the whole choice group; an unreachable scene is reported, not played.
  await page.locator('.scene-item[data-scene-id="entry"]').click();
  await page.locator('.v4-authoring .block[data-line="5"]').waitFor();
  await select(5);
  await fromLine.click();
  await waitStatus('已停在 entry 第 5 行之前');
  assert.match(await page.locator('.preview-target-details').innerText(), /第 6 行是选项，起点停在第 5 行的整组选项出现之前/);
  assert.deepEqual(await debug(pausedAt), { paused: true, reason: 'breakpoint', sceneId: 'entry', line: 5, trust: 0 });
  assert.equal(await debug('(d) => d.interp.status'), 'paused', 'paused before the choice is offered');
  await page.locator('.scene-item[data-scene-id="side"]').click();
  await page.locator('.v4-authoring .block[data-line="1"]').waitFor();
  await select(1);
  await fromLine.click();
  await waitStatus('按本次条件没有到达 side 第 2 行');
  await assertNotStarted('an unreachable target starts no run');
  console.log('PASS option row stops before its group; unreachable scene reported and not played');

  // 7. Source view: the caret row is the line. A dialogue line right after another, then @end after it.
  await page.locator('.scene-item[data-scene-id="home"]').click();
  await page.locator('[data-script-view="source"]').click();
  const source = page.locator('.v4-source-editor');
  const caretAt = (text) => source.evaluate((node, text) => { const at = node.value.indexOf(text); node.focus(); node.setSelectionRange(at + 1, at + 1); }, text);
  await caretAt('凛：之后');
  await fromLine.click();
  await waitStatus('已停在 home 第 7 行之前');
  assert.deepEqual(await debug(pausedAt), { paused: true, reason: 'breakpoint', sceneId: 'home', line: 7, trust: 3 });
  assert.equal((await debug(stage)).history.at(-1), '回家了。', 'the dialogue before it was read');
  await caretAt('@end');
  await fromLine.click();
  await waitStatus('已停在 home 第 8 行之前');
  await page.locator('.preview-target').getByLabel('起点方式').selectOption('path');
  await page.locator('.preview-target').getByLabel('选项序号').fill('0');
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await waitStatus('已停在 home 第 8 行之前');
  assert.deepEqual(await debug(pausedAt), { paused: true, reason: 'breakpoint', sceneId: 'home', line: 8, trust: 3 });
  console.log('PASS source view uses the caret row; dialogue after dialogue and @end after dialogue are reached');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS from-line preview');
} finally {
  await browser.close();
  server.close();
}
