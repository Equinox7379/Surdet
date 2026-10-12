import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

// A bound project on disk that declares two plugins. The preview imports an entry only after a person
// confirms it for this directory and code text: until then the run stops at a plugin instruction. The
// confirmed plugin keeps a counter in its saved state and opens a blocking panel of its own; the
// counter-examples are a TypeScript entry, a changed entry, an entry with an import, a failing
// instruction, saves the current plugins cannot restore, another version of the content, and the
// headless story check, which runs no project code.

async function choosePort() {
  for (let port = 4591; port <= 4620; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('no free port for the project plugins test');
}

// The plugin counts its imports, disposals and aborted panels in localStorage, which the Editor page shares.
const ENTRY = `const count = (name) => localStorage.setItem('e2e:letters:' + name, String(Number(localStorage.getItem('e2e:letters:' + name) ?? 0) + 1));
// Runs when the module is imported: an entry nobody confirmed must never get here.
count('imported');
// Text that only looks like a module import: import('./a-comment.js') loads nothing.
const note = "import('./a-string.js') is a string, not a load";
export default () => ({
  apiVersion: 1,
  state: {
    initial: 0,
    validate(value) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('计数状态无效'); },
  },
  instructions: {
    letter_count({ amount }, context) {
      const next = context.getState() + amount;
      context.setState(next);
      context.setVariable('letterCount', next);
    },
    letter_panel(values, context) {
      return new Promise((resolve) => {
        const panel = document.createElement('section');
        panel.id = 'letters-panel';
        panel.style.cssText = 'position:fixed;left:30%;top:30%;padding:16px;background:#fff;color:#000;z-index:10';
        const heading = document.createElement('h3');
        heading.textContent = values.title ?? '信';
        const done = document.createElement('button');
        done.textContent = '读完了';
        const close = () => { count('aborted'); panel.remove(); resolve(); };
        context.signal.addEventListener('abort', close, { once: true });
        done.onclick = () => {
          context.signal.removeEventListener('abort', close);
          const next = context.getState() + 1;
          context.setState(next);
          context.setVariable('letterCount', next);
          panel.remove();
          resolve();
        };
        panel.append(heading, done);
        document.body.append(panel);
      });
    },
  },
  dispose() { count('disposed'); },
});
`;
const BROKEN = ENTRY.replace(/letter_panel\(values, context\) \{[\s\S]*?\n {4}\},\n {2}\},/, "async letter_panel() { throw new Error('信纸破了'); },\n  },");
assert.notEqual(BROKEN, ENTRY);
const IMPORTING = `import './helper.js';\n${ENTRY}`;
// Valid module code that loads another module through import() with a trailing comma or a second argument.
const DATA_MODULE = 'data:text/javascript,export default 42';
const DYNAMIC = [`${ENTRY}export const extra = await import('${DATA_MODULE}',);\n`, `${ENTRY}export const extra = await import('${DATA_MODULE}', {});\n`];
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-project-plugins-'));
const projectRoot = path.join(fixtureRoot, 'project');
const file = (relative) => path.join(projectRoot, ...relative.split('/'));
for (const dir of ['content/scenario', 'plugins']) await fs.mkdir(file(dir), { recursive: true });
await fs.writeFile(file('game.config.json'), `${JSON.stringify({
  title: 'Project Plugins', version: '0.1.0', entryScene: 'intro', characters: { lynn: { name: '凛' } },
  variables: { letterCount: { type: 'number', initial: 0 } },
  plugins: [
    { id: 'letters', entry: 'plugins/letters.js', apiVersion: 1, stateVersion: 1, instructions: [
      { name: 'letter_count', blocking: false, parameters: [{ name: 'amount', type: 'number' }] },
      { name: 'letter_panel', blocking: true, parameters: [], modifiers: [{ name: 'title', type: 'string', optional: true }] },
    ] },
    { id: 'notes', entry: 'plugins/notes.ts', apiVersion: 1, instructions: [{ name: 'margin_note', blocking: false, parameters: [] }] },
  ],
}, null, 2)}\n`);
await fs.writeFile(file('plugins/letters.js'), ENTRY);
await fs.writeFile(file('plugins/notes.ts'), 'export default () => ({ apiVersion: 1, instructions: { margin_note() {} } });\n');
await fs.writeFile(file('content/scenario/intro.gal'), ['@scene intro', '凛：开始。', '@letter_count 2', '凛：数过了。',
  '@letter_panel @title="来信"', '凛：读完了。', '@letter_count 3', '凛：又数过了。', '@end', ''].join('\n'));

const outDir = process.env.SURDET_PLUGINS_E2E_OUTPUT;
const errors = [];
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
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  const refused = [];
  page.on('response', async (response) => { if (response.status() >= 400) refused.push(`${response.status()} ${new URL(response.url()).pathname} ${await response.text().catch(() => '')}`); });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: projectRoot }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  // The preview frame keeps the plugin ids of each load the Editor sends it.
  await page.addInitScript(() => {
    window.__pluginLoads = [];
    addEventListener('message', (event) => {
      if (event.data?.type === 'surdet-preview-load') window.__pluginLoads.push((event.data.payload?.plugins ?? []).map((plugin) => plugin.id));
    });
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('intro'));

  const preview = () => page.frames().find((frame) => /preview\.html/.test(frame.url()));
  const debug = (read) => page.waitForFunction(`(() => { const d = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return d?.interp && d?.runtime ? (${read})(d) : false; })()`);
  const shown = '(d) => d.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText ?? ""';
  // On a timeout, say what the preview shows instead.
  const report = () => page.evaluate(() => {
    const d = document.querySelector('iframe.preview-frame')?.contentWindow;
    return JSON.stringify({ source: document.querySelector('.preview-source-state')?.textContent, diagnostics: document.querySelector('.preview-diagnostics')?.textContent,
      error: d?.document.getElementById('preview-error')?.textContent, status: d?.surdetPreviewDebug?.interp?.status,
      text: d?.surdetPreviewDebug?.runtime?.queries.diagnostics.projectionSnapshot().dialogue?.dialogText, loads: d?.__pluginLoads });
  }).catch((error) => String(error));
  const waitText = async (text) => {
    try { await debug(`(d) => (${shown})(d) === ${JSON.stringify(text)} && d.interp.status === 'awaiting-advance'`); }
    catch (error) { throw new Error(`the preview never showed ${JSON.stringify(text)}: ${await report()}`, { cause: error }); }
  };
  const variables = () => preview().evaluate(() => window.surdetPreviewDebug.interp.debugSnapshot().variables);
  const status = () => preview().evaluate(() => window.surdetPreviewDebug.interp.status);
  const counter = (name) => page.evaluate((name) => Number(localStorage.getItem(`e2e:letters:${name}`) ?? 0), name);
  const lastLoad = () => preview().evaluate(() => window.__pluginLoads.at(-1));
  const previewError = () => preview().evaluate(() => document.getElementById('preview-error')?.textContent ?? '');
  const checkpoints = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('surdet:preview:checkpoint:')));
  const press = async (key) => { await page.locator('iframe.preview-frame').focus(); await page.keyboard.press(key); };
  const section = page.locator('.preview-plugins');
  const row = (id) => section.locator(`[data-plugin-id="${id}"]`);
  // The list is a closed disclosure until a stop opens it; a person opens it to act.
  const pluginStatus = (id) => row(id).locator('.preview-plugin-status').textContent();
  const stopText = () => section.locator('.preview-plugins-stop').textContent();
  const openList = async () => { if (!await section.evaluate((node) => node.open)) await section.locator('summary').click(); };
  const pluginButton = async (id, name) => { await openList(); return row(id).getByRole('button', { name: `${name} ${id}` }); };
  const recordBanners = () => preview().evaluate(() => {
    const dialogue = window.surdetPreviewDebug.runtime.commands.dialogue;
    if (window.__banners) return;
    window.__banners = [];
    const show = dialogue.showBanner.bind(dialogue);
    dialogue.showBanner = (text, variant) => { window.__banners.push(text); show(text, variant); };
  });
  /** Act, then wait for the Editor to send a new load and for that run to show its first line. */
  const newRun = async (action) => {
    const before = await preview().evaluate(() => window.__pluginLoads.length);
    await action();
    await page.waitForFunction((before) => (document.querySelector('iframe.preview-frame')?.contentWindow?.__pluginLoads.length ?? 0) > before, before);
    await waitText('开始。');
  };
  const replay = () => newRun(() => page.locator('[data-action="reload-preview"]').click());
  const openPreview = async () => {
    await page.locator('[data-editor-mode="preview"]').click();
    await waitText('开始。');
  };
  const confirmTrust = async (id, expectedSha) => {
    await (await pluginButton(id, '查看并启用插件')).click();
    const dialog = page.locator('dialog.preview-plugin-dialog');
    await dialog.getByRole('button', { name: '确认运行这份代码' }).waitFor();
    assert.match(await dialog.innerText(), new RegExp(`SHA-256 ${expectedSha}`), 'the dialog shows the hash of the code on disk');
    await newRun(() => dialog.getByRole('button', { name: '确认运行这份代码' }).click());
    await dialog.waitFor({ state: 'detached' });
  };

  // The Windows export belongs to the desktop Editor; the browser Editor and its preview offer none.
  assert.equal(await page.locator('[data-action="export-game"]').count(), 0, 'the browser Editor offers no Windows export');

  // 1. The declaration alone loads nothing: the run stops at the first plugin instruction.
  await openPreview();
  assert.equal(await section.locator('summary').textContent(), '项目插件（2 个 · 已启用 0）');
  assert.equal(await section.evaluate((node) => node.open), false, 'the list stays folded until needed');
  assert.match(await pluginStatus('letters'), /未启用/);
  assert.match(await row('letters').textContent(), /@letter_count amount（数字） — 立即完成/);
  assert.match(await row('letters').textContent(), /@letter_panel @title（文字，可省略） — 等插件界面完成后继续/);
  assert.match(await row('letters').textContent(), /插件接口 1 · 状态版本 1/);
  assert.deepEqual(await lastLoad(), []);
  assert.equal((await checkpoints()).length, 1, 'the run keeps a position to resume before it stops');
  await press('Enter');
  await debug("(d) => d.interp.status === 'error'");
  assert.match(await previewError(), /PLUGIN_REQUIRED：指令 @letter_count 需要明确启用插件 letters/);
  assert.equal(await counter('imported'), 0, 'an entry nobody confirmed is never imported');
  await page.waitForFunction(() => /PLUGIN_REQUIRED/.test(document.querySelector('.preview-plugins-stop')?.textContent ?? ''));
  assert.match(await stopText(), /^本次试玩因项目插件停止：.*PLUGIN_REQUIRED/);
  assert.equal(await section.evaluate((node) => node.open), true, 'the stop opens the plugin list');
  assert.deepEqual(await checkpoints(), [], 'a plugin stop leaves no position to resume');
  await page.getByRole('button', { name: '回到上次位置' }).click();
  await page.waitForFunction(() => /还没有可续接的实际试玩位置/.test(document.querySelector('.preview-source-state')?.textContent ?? ''));
  if (outDir) await page.screenshot({ path: path.join(outDir, 'plugin-required.png') });
  console.log('PASS an unconfirmed plugin is never imported; its instruction stops the run and clears the resume position');

  // 2. A TypeScript entry is refused, not compiled.
  await (await pluginButton('notes', '查看并启用插件')).click();
  const tsDialog = page.locator('dialog.preview-plugin-dialog');
  await tsDialog.getByText(/^不能启用：TypeScript 入口需要先编译/).waitFor();
  assert.equal(await tsDialog.getByRole('button', { name: '确认运行这份代码' }).count(), 0);
  await tsDialog.getByRole('button', { name: '取消' }).click();
  await tsDialog.waitFor({ state: 'detached' });
  console.log('PASS a TypeScript entry is refused in the confirmation');

  // 3. The confirmation names source, code, dependencies and the same-origin environment; then the run imports it.
  await (await pluginButton('letters', '查看并启用插件')).click();
  const dialog = page.locator('dialog.preview-plugin-dialog');
  await dialog.getByRole('button', { name: '确认运行这份代码' }).waitFor();
  const facts = await dialog.innerText();
  assert.match(facts, /你打开的项目目录「project」中的 plugins\/letters\.js/);
  assert.match(facts, new RegExp(`SHA-256 ${sha256(ENTRY)}`));
  // The entry's comment and string mention import() but load nothing.
  assert.match(facts, /依赖\s*代码中没有 import \/ export … from \/ import\(\) 模块导入（单个 \.js 模块）/);
  assert.match(facts, /代码运行时自行取得并执行其他代码，不在这项检查之内/);
  assert.match(facts, /与 Editor 同源/);
  assert.match(facts, /这不是沙箱/);
  assert.match(facts, /作品配置和智能体的请求都不能替你启用/);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'plugin-confirmation.png') });
  await newRun(() => dialog.getByRole('button', { name: '确认运行这份代码' }).click());
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await lastLoad(), ['letters']);
  assert.equal(await counter('imported'), 1);
  assert.match(await pluginStatus('letters'), new RegExp(`^已启用：本次 Editor 会话运行这份代码（SHA-256 ${sha256(ENTRY).slice(0, 12)}…）`));
  assert.equal(await section.locator('summary').textContent(), '项目插件（2 个 · 已启用 1）');
  assert.equal(await stopText(), '', 'a new run clears the last stop');
  console.log('PASS the confirmation shows the entry facts and environment; the next run imports exactly that code');

  // 4. A non-blocking instruction completes at once and writes the declared variable.
  await recordBanners();
  await press('Enter');
  await waitText('数过了。');
  assert.equal((await variables()).letterCount, 2);

  // 5. A blocking instruction waits for the plugin's own panel; nothing advances or saves meanwhile.
  await press('Enter');
  await preview().locator('#letters-panel').waitFor();
  assert.equal(await preview().locator('#letters-panel h3').innerText(), '来信');
  assert.equal(await status(), 'paused');
  await press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await status(), 'paused', 'reading input does not skip the plugin panel');
  await press('F5');
  await preview().waitForFunction(() => window.__banners.some((text) => /^当前不能存档：PLUGIN_BUSY/.test(text)));
  if (outDir) await page.screenshot({ path: path.join(outDir, 'plugin-panel.png') });
  await preview().locator('#letters-panel button').click();
  await waitText('读完了。');
  assert.equal(await preview().locator('#letters-panel').count(), 0);
  assert.equal((await variables()).letterCount, 3);
  console.log('PASS the blocking panel holds the story until it completes; a save meanwhile is refused with PLUGIN_BUSY');

  // 6. The plugin state is saved and restored with the run.
  await press('F5');
  await preview().waitForFunction(() => window.__banners.includes('快速存档已保存'));
  await press('Enter');
  await waitText('又数过了。');
  assert.equal((await variables()).letterCount, 6);
  await press('F9');
  await waitText('读完了。');
  assert.equal((await variables()).letterCount, 3);
  await press('Enter');
  await waitText('又数过了。');
  assert.equal((await variables()).letterCount, 6, 'the restored plugin state counted on from 3, not from 6');
  console.log('PASS the plugin state round-trips through a quick save');

  // 7. A restore or a new run while the panel is open aborts it; the plugin closes its panel and is disposed.
  // After the restore the same run can open the panel again: the system router was reset with it.
  await replay();
  await press('Enter'); await waitText('数过了。');
  await press('F5');
  await preview().waitForFunction(() => window.__banners.filter((text) => text === '快速存档已保存').length === 2);
  await press('Enter'); await preview().locator('#letters-panel').waitFor();
  const aborted = await counter('aborted');
  await press('F9');
  await waitText('数过了。');
  assert.equal(await preview().locator('#letters-panel').count(), 0, 'the restore aborted the open panel');
  assert.equal(await counter('aborted'), aborted + 1);
  assert.equal((await variables()).letterCount, 2);
  await press('Enter'); await preview().locator('#letters-panel').waitFor();
  await preview().locator('#letters-panel button').click();
  await waitText('读完了。');
  assert.equal((await variables()).letterCount, 3, 'the panel ran again from the restored state');
  const disposed = await counter('disposed');
  await replay();
  await press('Enter'); await waitText('数过了。');
  await press('Enter'); await preview().locator('#letters-panel').waitFor();
  await replay();
  assert.equal(await preview().locator('#letters-panel').count(), 0, 'the new run disposed the old one and its panel');
  await page.waitForTimeout(300);
  const traced = await page.evaluate(() => window.surdetEditorDebug.state.previewTrace.map((event) => event.source.line));
  assert.deepEqual(traced.filter((line) => line > 2), [], `the replaced run did not continue into the new run's record: lines ${traced}`);
  assert.equal(await counter('aborted'), aborted + 2);
  assert.ok(await counter('disposed') >= disposed + 2, 'each replaced run disposed its plugin');
  console.log('PASS a restore aborts the open panel; a new run disposes the old plugin');

  // 8. Leaving the preview disposes the run; the confirmation lasts for this Editor session.
  await press('Enter'); await waitText('数过了。');
  await press('Enter'); await preview().locator('#letters-panel').waitFor();
  const disposedBeforeClose = await counter('disposed');
  await page.locator('[data-editor-mode="editor"]').click();
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame') === null);
  await page.waitForFunction((count) => Number(localStorage.getItem('e2e:letters:disposed') ?? 0) > count, disposedBeforeClose);
  await openPreview();
  assert.deepEqual(await lastLoad(), ['letters'], 'the confirmation is kept while the Editor session lasts');
  console.log('PASS closing the preview disposes the plugin; the session keeps the confirmation');

  // 9. A save from another plugin state version is refused before anything changes, and stops the run.
  await recordBanners();
  await press('Enter'); await waitText('数过了。');
  const quickKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith('surdet:preview:save:') && key.endsWith(':quick')));
  assert.ok(quickKey, 'the quick save is in preview storage');
  const saved = await page.evaluate((key) => localStorage.getItem(key), quickKey);
  assert.deepEqual(JSON.parse(saved).plugins, { letters: { version: 1, value: 2 } });
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: quickKey, text: JSON.stringify({ ...JSON.parse(saved), plugins: { letters: { version: 2, value: 2 } } }) });
  assert.equal((await checkpoints()).length, 1);
  await press('F9');
  await page.waitForFunction(() => /PLUGIN_VERSION/.test(document.querySelector('.preview-plugins-stop')?.textContent ?? ''));
  assert.match(await previewError(), /快速读档失败：PLUGIN_VERSION：插件 letters 状态版本 2 不受支持/);
  assert.equal(await preview().evaluate(() => window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText), '数过了。',
    'the refused restore changed nothing');
  assert.equal((await variables()).letterCount, 2);
  assert.deepEqual(await checkpoints(), []);
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: quickKey, text: saved });
  console.log('PASS a save with another plugin state version is refused atomically and reported as the stop');

  // 10. Turning the plugin off: its code is not loaded, and a save that needs its state is refused.
  const importsBeforeOff = await counter('imported');
  await newRun(async () => (await pluginButton('letters', '停用插件')).click());
  assert.deepEqual(await lastLoad(), []);
  assert.match(await pluginStatus('letters'), /未启用/);
  await press('F9');
  await page.waitForFunction(() => /PLUGIN_REQUIRED/.test(document.querySelector('.preview-plugins-stop')?.textContent ?? ''));
  assert.match(await previewError(), /快速读档失败：PLUGIN_REQUIRED：存档需要插件 letters/);
  assert.equal(await counter('imported'), importsBeforeOff);
  console.log('PASS a turned-off plugin loads no code, and its saved state cannot be restored without it');

  // 11. Changing the entry on disk withdraws the confirmation.
  await confirmTrust('letters', sha256(ENTRY));
  assert.deepEqual(await lastLoad(), ['letters']);
  await fs.writeFile(file('plugins/letters.js'), BROKEN);
  const importsBeforeChange = await counter('imported');
  await replay();
  assert.deepEqual(await lastLoad(), []);
  assert.equal(await counter('imported'), importsBeforeChange);
  assert.match(await pluginStatus('letters'), /入口代码在确认后改变，已自动停用/);
  console.log('PASS a changed entry loses its confirmation and is not imported');

  // 12. A failing blocking instruction stops the run with the plugin's reason.
  await confirmTrust('letters', sha256(BROKEN));
  await press('Enter'); await waitText('数过了。');
  await press('Enter');
  await debug("(d) => d.interp.status === 'error'");
  await page.waitForFunction(() => /PLUGIN_EXECUTION/.test(document.querySelector('.preview-plugins-stop')?.textContent ?? ''));
  assert.match(await previewError(), /PLUGIN_EXECUTION：插件 letters 执行失败：信纸破了/);
  await press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await status(), 'error', 'reading input does not continue past the failure');
  assert.deepEqual(await checkpoints(), []);
  console.log('PASS a failing plugin instruction stops the run with its reason');

  // 13. A confirmed entry that gains a module import, static or import() in any call form, is withdrawn,
  // not imported, and cannot be confirmed (31-REV-01).
  const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [source, named] of [[IMPORTING, './helper.js'], ...DYNAMIC.map((code) => [code, DATA_MODULE])]) {
    // The next run reads the entry again: a confirmation of other code is withdrawn first.
    await fs.writeFile(file('plugins/letters.js'), ENTRY);
    await replay();
    await confirmTrust('letters', sha256(ENTRY));
    assert.deepEqual(await lastLoad(), ['letters']);
    await fs.writeFile(file('plugins/letters.js'), source);
    const importsBefore = await counter('imported');
    await replay();
    assert.deepEqual(await lastLoad(), [], `no code is sent for ${named}`);
    assert.equal(await counter('imported'), importsBefore, `nothing is imported for ${named}`);
    assert.match(await pluginStatus('letters'), new RegExp(`^已停用，无法在 Editor 试玩中运行：入口引用了 ${literal(named)}；`));
    await (await pluginButton('letters', '查看并启用插件')).click();
    await dialog.getByText(new RegExp(`^不能启用：入口引用了 ${literal(named)}；`)).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '确认运行这份代码' }).count(), 0);
    await dialog.getByRole('button', { name: '取消' }).click();
    await dialog.waitFor({ state: 'detached' });
  }
  console.log('PASS an entry with a static import or an import() with a trailing comma or second argument is refused');

  // 14. Another version of the content runs no plugin code, whatever was confirmed here.
  await fs.writeFile(file('plugins/letters.js'), ENTRY);
  await confirmTrust('letters', sha256(ENTRY));
  await newRun(() => page.locator('.preview-workspace').getByLabel('试玩内容').selectOption({ label: '来源项目（已保存）' }));
  await page.waitForFunction(() => /来源项目（已保存）/.test(document.querySelector('.preview-source-state')?.textContent ?? ''));
  assert.deepEqual(await lastLoad(), []);
  assert.match(await section.locator('.preview-plugins-blocked').textContent(), /所选版本不运行项目插件代码/);
  assert.equal(await row('letters').getByRole('button', { name: '查看并启用插件 letters' }).isDisabled(), true);
  await newRun(() => page.locator('.preview-workspace').getByLabel('试玩内容').selectOption({ index: 0 }));
  assert.deepEqual(await lastLoad(), ['letters']);
  console.log('PASS a selected version of the content runs no plugin code');

  // 15. The headless story check runs no project code and says so.
  await page.locator('[data-editor-mode="stats"]').click();
  await page.getByRole('button', { name: '运行剧情检查' }).click();
  await page.getByText('检查未走完：途中需要项目插件', { exact: false }).waitFor();
  const stops = page.locator('.story-check-list').filter({ hasText: '中断与错误' });
  await stops.locator('summary').click();
  assert.match(await stops.innerText(), /需要扩展，未运行：/);
  console.log('PASS the story check reports the plugin instruction as 需要扩展，未运行');

  assert.deepEqual(errors, [], `page errors; refused requests: ${refused.join('\n')}`);
  console.log('PASS project plugins');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
