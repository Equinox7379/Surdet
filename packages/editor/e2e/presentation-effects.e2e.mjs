import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

// A bound project on disk with transition masks in content/assets/rule. The script inspector and
// 添加剧情 write @transition / @filter through the scene history, the preview registers the masks the
// script uses, the timeline screen track edits a mask cue, and after 保存全部 the CLI lint accepts it.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = path.join(repoRoot, 'packages/cli/dist/index.js');
const run = promisify(execFile);

async function choosePort() {
  for (let port = 4561; port <= 4590; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('no free port for the presentation effects test');
}

/** A real RGBA PNG, so the preview decodes and registers it like a project image. */
function png(width, height, pixel) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-presentation-effects-'));
const projectRoot = path.join(fixtureRoot, 'project');
const file = (relative) => path.join(projectRoot, ...relative.split('/'));
for (const dir of ['content/scenario', 'content/timelines', 'content/assets/bg', 'content/assets/rule']) await fs.mkdir(file(dir), { recursive: true });
await fs.writeFile(file('game.config.json'), `${JSON.stringify({
  title: 'Presentation Effects', version: '0.1.0', entryScene: 'intro', characters: { lynn: { name: '凛' } },
}, null, 2)}\n`);
await fs.writeFile(file('content/assets/bg/room_a.png'), png(64, 36, () => [200, 60, 60, 255]));
await fs.writeFile(file('content/assets/bg/room_b.png'), png(64, 36, () => [60, 80, 200, 255]));
await fs.writeFile(file('content/assets/rule/百叶窗 遮罩.png'), png(64, 36, (x, y) => { const v = (y % 6) * 42; return [v, v, v, 255]; }));
await fs.writeFile(file('content/assets/rule/radial.png'), png(64, 36, (x, y) => { const v = Math.min(255, Math.hypot(x - 32, y - 18) * 7); return [v, v, v, 255]; }));
const intro = ['@scene intro', '@bg room_a', '凛：旧房间。', '@bg room_b', '@transition fade 600', '凛：新房间。', '@filter grayscale 600', '凛：回忆。', '@end', ''].join('\n');
await fs.writeFile(file('content/scenario/intro.gal'), intro);
const cut = { version: 1, id: 'cut', durationMs: 1200, tracks: [
  { kind: 'background', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'set', key: 'room_b' }] },
  { kind: 'screen', cues: [] },
] };
await fs.writeFile(file('content/timelines/cut.json'), `${JSON.stringify(cut, null, 2)}\n`);

const outDir = process.env.SURDET_PRESENTATION_E2E_OUTPUT;
const errors = [], frameWarnings = [];
const previousAgentDataRoot = process.env.SURDET_AGENT_DATA_DIR;
let server = null, browser = null;
try {
  const dataRoot = path.join(fixtureRoot, 'agent-data');
  process.env.SURDET_AGENT_DATA_DIR = dataRoot;
  const port = await choosePort();
  server = await startDevProject(['--project', projectRoot, '--data-root', dataRoot, '--port', String(port)],
    { registerSignals: false, cacheDir: path.join(fixtureRoot, 'vite-cache') });
  const url = `http://127.0.0.1:${port}/index.html`;
  for (const deadline = Date.now() + 30_000; ;) {
    if (await fetch(url).then((response) => response.ok, () => false)) break;
    if (Date.now() > deadline) throw new Error('dev project did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning' && message.text().includes('[surdet]')) frameWarnings.push(message.text());
  });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: projectRoot }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  // The preview frame keeps the mask keys of each load the Editor sends it.
  await page.addInitScript(() => {
    window.__previewRuleKeys = [];
    addEventListener('message', (event) => {
      if (event.data?.type === 'surdet-preview-load') window.__previewRuleKeys.push((event.data.payload?.assets?.rules ?? []).map((rule) => rule.key).sort());
    });
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('intro'));
  const sceneText = () => page.evaluate(() => window.surdetEditorDebug.state.scenes.get('intro').text);
  const lineAt = async (index) => (await sceneText()).split('\n')[index];
  const row = (line) => page.locator(`.v4-authoring .block[data-line="${line}"]`);
  const select = async (line) => {
    await row(line).evaluate((node) => node.focus());
    await page.waitForFunction((line) => document.querySelector(`.v4-authoring .block[data-line="${line}"]`)?.classList.contains('v4-current'), line);
  };
  const inspector = page.locator('#script-v4-inspector');
  const commit = async (locator, value) => { await locator.fill(value); await locator.dispatchEvent('change'); };
  const waitLine = async (index, text) => {
    try { await page.waitForFunction(({ index, text }) => window.surdetEditorDebug.state.scenes.get('intro').text.split('\n')[index] === text, { index, text }); }
    catch { throw new Error(`line ${index + 1} never became ${JSON.stringify(text)}; it is ${JSON.stringify(await lineAt(index))}`); }
  };
  await row(4).waitFor();
  // The shared asset catalog lists masks in the page's localeCompare order of their paths (a Chinese
  // locale puts 百叶窗 first). The expected list and the default mask follow that order, derived the same way.
  const masks = await page.evaluate(() => ['content/assets/rule/百叶窗 遮罩.png', 'content/assets/rule/radial.png']
    .sort((a, b) => a.localeCompare(b)).map((path) => path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.'))));
  assert.deepEqual([...masks].sort(), ['radial', '百叶窗 遮罩']);
  const ruleOption = { radial: '@rule=radial', '百叶窗 遮罩': '@rule="百叶窗 遮罩"' };

  // 1. The transition inspector lists the Core names in Chinese and writes the mask options.
  await select(4);
  const effect = inspector.getByLabel('转场效果');
  assert.deepEqual(await effect.locator('option').allTextContents(), ['淡入淡出', '向左滑动', '向右滑动', '圆形展开', '溶解', '遮罩']);
  assert.equal(await effect.inputValue(), 'fade');
  await effect.selectOption('rule');
  await waitLine(4, `@transition rule 600 ${ruleOption[masks[0]]}`);
  const mask = inspector.getByLabel('遮罩素材');
  assert.deepEqual(await mask.locator('option').allTextContents(), masks);
  // Choosing the other mask writes it, whichever came first.
  await mask.selectOption(masks[1]);
  await waitLine(4, `@transition rule 600 ${ruleOption[masks[1]]}`);
  await mask.selectOption('百叶窗 遮罩');
  await waitLine(4, '@transition rule 600 @rule="百叶窗 遮罩"');
  await commit(inspector.getByLabel('边缘柔和度（0 为硬边）'), '0.3');
  await waitLine(4, '@transition rule 600 @rule="百叶窗 遮罩" @soft=0.3');
  await inspector.getByLabel('反向揭示').check();
  await waitLine(4, '@transition rule 600 @rule="百叶窗 遮罩" @soft=0.3 @reverse');
  await commit(inspector.getByLabel('时长（毫秒）'), '800');
  const ruleLine = '@transition rule 800 @rule="百叶窗 遮罩" @soft=0.3 @reverse';
  await waitLine(4, ruleLine);
  // Out of range is refused and the line stays.
  await commit(inspector.getByLabel('边缘柔和度（0 为硬边）'), '1.5');
  await page.waitForTimeout(300);
  assert.equal(await lineAt(4), ruleLine);
  assert.equal(await inspector.getByLabel('边缘柔和度（0 为硬边）').inputValue(), '0.3', 'the refused value is not kept in the form');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'transition-inspector.png') });
  // The edits are scene history: undo goes back to the original line, redo returns.
  for (let step = 0; step < 8 && (await lineAt(4)) !== '@transition fade 600'; step += 1) await page.locator('[data-action="undo"]').click();
  assert.equal(await lineAt(4), '@transition fade 600');
  for (let step = 0; step < 8 && (await lineAt(4)) !== ruleLine; step += 1) await page.locator('[data-action="redo"]').click();
  assert.equal(await lineAt(4), ruleLine);
  // Another effect drops the mask options it would not consume; the mask choice comes back with rule.
  await select(4);
  await inspector.getByLabel('转场效果').selectOption('dissolve');
  await waitLine(4, '@transition dissolve 800');
  await inspector.getByLabel('转场效果').selectOption('rule');
  await waitLine(4, `@transition rule 800 ${ruleOption[masks[0]]}`);
  await inspector.getByLabel('遮罩素材').selectOption('百叶窗 遮罩');
  await commit(inspector.getByLabel('边缘柔和度（0 为硬边）'), '0.3');
  await inspector.getByLabel('反向揭示').check();
  await waitLine(4, ruleLine);
  console.log('PASS the transition inspector writes the Core effect, length and mask options, refuses bad values and is undoable');

  // 2. The filter inspector: Chinese names, English values, the second number is a length.
  await select(6);
  const filter = inspector.getByLabel('画面滤镜');
  assert.deepEqual(await filter.locator('option').allTextContents(), ['模糊', '灰度', '怀旧', '暗角', '清除']);
  await filter.selectOption({ label: '怀旧' });
  await waitLine(6, '@filter sepia 600');
  await commit(inspector.getByLabel('过渡时长（毫秒）'), '1200');
  await waitLine(6, '@filter sepia 1200');
  console.log('PASS the filter inspector writes the Core filter name and its fade length');

  // 3. 添加剧情 adds a filter and a mask transition after the selected step.
  await select(7);
  const addStep = async (kind, fill) => {
    await page.locator('[data-action="add-story-step"]').click();
    const dialog = page.locator('dialog.v4-insert-dialog');
    await dialog.getByLabel('内容类型').selectOption(kind);
    await fill(dialog);
    await dialog.getByRole('button', { name: '插入到当前步骤之后' }).click();
    await dialog.waitFor({ state: 'detached' });
  };
  await addStep('filter', async (dialog) => {
    await dialog.getByLabel('画面滤镜').selectOption('off');
    await dialog.getByLabel('过渡时长（毫秒，可空）').fill('400');
  });
  await addStep('transition', async (dialog) => {
    await dialog.getByLabel('转场效果').selectOption('rule');
    await dialog.getByLabel('遮罩素材').selectOption('radial');
  });
  const scripted = ['@scene intro', '@bg room_a', '凛：旧房间。', '@bg room_b', ruleLine, '凛：新房间。', '@filter sepia 1200', '凛：回忆。',
    '@filter off 400', '@transition rule 800 @rule=radial', '@end', ''].join('\n');
  assert.equal(await sceneText(), scripted);
  console.log('PASS 添加剧情 inserts a filter and a mask transition');

  // 4. The preview registers the masks the script uses; the transition does not fall back to a fade.
  await page.locator('[data-editor-mode="preview"]').click();
  const shown = '(d) => d.runtime?.queries.diagnostics.projectionSnapshot().dialogue?.dialogText ?? ""';
  const waitDebug = async (read) => page.waitForFunction(`(() => { const d = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return d?.interp && d?.runtime ? (${read})(d) : false; })()`);
  await waitDebug(`(d) => (${shown})(d) === '旧房间。' && d.interp.status === 'awaiting-advance'`);
  const sent = await page.evaluate(() => document.querySelector('iframe.preview-frame').contentWindow.__previewRuleKeys.at(-1));
  assert.deepEqual(sent, ['radial', '百叶窗 遮罩'], 'the masks the script uses are sent with the load');
  frameWarnings.length = 0;
  await page.locator('iframe.preview-frame').focus();
  await page.keyboard.press('Enter');
  await waitDebug(`(d) => (${shown})(d) === '新房间。'`);
  await page.waitForTimeout(500);
  assert.deepEqual(frameWarnings.filter((text) => text.includes('遮罩')), [], 'the mask transition ran with its mask');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'preview-rule.png') });
  console.log('PASS the preview sends the used masks and plays the mask transition without a fade fallback');

  // 5. Timeline screen track: dissolve and mask actions, with the mask's edge and direction.
  await page.locator('[data-editor-mode="timeline"]').click();
  await page.locator('[data-timeline-focus="timeline-cut"]').click();
  const addAction = page.locator('[data-timeline-focus="track-1-add-action"]');
  const actions = await addAction.locator('option').evaluateAll((options) => options.map((option) => [option.value, option.textContent]));
  assert.deepEqual(actions.slice(-2), [['dissolve', '溶解转场'], ['rule', '遮罩转场']]);
  await addAction.selectOption('rule');
  await page.locator('[data-timeline-focus="track-1-add"]').click();
  const timelineCue = async () => JSON.parse(await page.evaluate(() => window.surdetEditorDebug.state.timelines.find((entry) => entry.id === 'cut').text)).tracks[1].cues[0];
  await page.locator('[data-timeline-focus="inspector-rule"]').waitFor();
  assert.equal((await timelineCue()).rule, masks[0]);
  await page.locator('[data-timeline-focus="inspector-rule"]').selectOption('百叶窗 遮罩');
  await commit(page.locator('[data-timeline-focus="inspector-soft"]'), '0.2');
  await page.locator('[data-timeline-focus="inspector-reverse"]').check();
  await page.waitForFunction(() => {
    const cue = JSON.parse(window.surdetEditorDebug.state.timelines.find((entry) => entry.id === 'cut').text).tracks[1].cues[0];
    return cue.rule === '百叶窗 遮罩' && cue.soft === 0.2 && cue.reverse === true;
  });
  assert.deepEqual(await timelineCue(), { atMs: 0, durationMs: 600, easing: 'outCubic', action: 'rule', rule: '百叶窗 遮罩', soft: 0.2, reverse: true });
  if (outDir) await page.screenshot({ path: path.join(outDir, 'timeline-rule.png') });
  console.log('PASS the timeline screen track adds a mask cue and edits its mask, edge and direction');

  // 6. The asset centre counts the masks under their own kind.
  await page.locator('[data-editor-mode="assets"]').click();
  const maskFilter = page.locator('[data-asset-filter-axis="kind"][data-asset-filter-value="rule"]');
  assert.match(await maskFilter.innerText(), /转场遮罩[\s\S]*2/);
  await maskFilter.click();
  await page.getByText('百叶窗 遮罩', { exact: false }).first().waitFor();
  if (outDir) await page.screenshot({ path: path.join(outDir, 'asset-center-rule.png') });
  console.log('PASS the asset centre lists the masks as 转场遮罩');

  // 7. 保存全部 writes the same source; the CLI lint finds nothing to report about it.
  const finished = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/workspace/finish'));
  await page.locator('[data-action="save-project"]').click();
  assert.ok((await finished).ok());
  assert.equal(await fs.readFile(file('content/scenario/intro.gal'), 'utf8'), scripted);
  const savedCue = JSON.parse(await fs.readFile(file('content/timelines/cut.json'), 'utf8')).tracks[1].cues[0];
  assert.deepEqual(savedCue, { atMs: 0, durationMs: 600, easing: 'outCubic', action: 'rule', rule: '百叶窗 遮罩', soft: 0.2, reverse: true });
  const lint = JSON.parse((await run(process.execPath, [cli, 'lint', projectRoot, '--json']).catch((error) => error)).stdout);
  assert.ok(Array.isArray(lint.issues), 'the CLI lint reported its issue list');
  const reported = lint.issues.filter((issue) => ['RULE_ASSET_UNRESOLVED', 'TRANSITION_INVALID', 'FILTER_INVALID', 'TL009', 'W003'].includes(issue.code));
  assert.deepEqual(reported, [], 'the saved effects are valid for the shared lint');
  console.log('PASS 保存全部 writes the edited script and timeline; the CLI lint reports nothing about them');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS presentation effects');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
