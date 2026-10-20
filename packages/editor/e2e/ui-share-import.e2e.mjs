import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createProject } from '../../cli/dist/new.js';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';

// U3 public draft port over real Editor/Authoring storage. No import dialog or
// replacement write handler: preparation is read-only, explicit apply is one
// undo step, and normal Save All persists the result for reopening.
const output = process.env.SURDET_U3_E2E_OUTPUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-share-import-'));
const project = path.join(output, 'project'), configPath = path.join(project, 'game.config.json');
createProject('u3-import', { directory: project, template: 'blank', title: 'U3目标B' });
const frame = { x: 0, y: 0, width: 1280, height: 720 };
const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));
before.privateMarker = 'KEEP_B'; before.theme = { colors: { accent: 0x123456 }, privateMarker: 'KEEP_THEME' };
before.ui = { version: 1, pages: { title: { id: 'b_root', type: 'container', frame, children: [
  { id: 'b_start', type: 'button', frame: { x: 80, y: 120, width: 240, height: 48 }, text: { kind: 'literal', value: 'B原按钮' }, action: { kind: 'start' } },
] } } };
fs.writeFileSync(configPath, JSON.stringify(before, null, 2));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(path.join(project, 'content/assets/bg'), { recursive: true });
fs.writeFileSync(path.join(project, 'content/assets/bg/existing.png'), png);
const share = { format: 'surdet-ui', version: 1, kind: 'theme', config: { theme: { colors: { accent: 0x556677 } }, fonts: {}, player: {},
  ui: { version: 1, pages: { title: { id: 'a_root', type: 'container', frame, transition: { enter: { durationMs: 160, opacity: 0 } }, children: [
    { id: 'a_start', type: 'button', frame: { x: 80, y: 120, width: 240, height: 48 }, text: { kind: 'literal', value: 'A按钮' }, action: { kind: 'start' }, states: { hover: { background: 0xabcdef } } },
  ] } } } }, variables: {}, assets: [] };
const results = { steps: [], errors: [] };
let server, browser;
async function open() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', error => results.errors.push(error.message));
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto('http://127.0.0.1:18083/index.html');
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState === 'ready');
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('[data-config-section-target="ui"]').click();
  return page;
}
const draft = page => page.evaluate(async () => {
  const config = await import('/src/panels/config.ts');
  return { ui: config.readUiConfigDraft(), theme: config.readThemeConfigDraft(), dirty: config.inspectConfigDraftState(), history: config.configHistoryDepth() };
});
const prepare = (page, packet, target) => page.evaluate(async ({ packet, target }) => {
  const config = await import('/src/panels/config.ts');
  window.proposal = await config.prepareUiShareImportDraft(JSON.stringify(packet), target);
  return { preview: window.proposal.preview, resources: window.proposal.resources };
}, { packet, target });
try {
  browser = await chromium.launch({ headless: true });
  server = await startDevProject(['--project', project, '--data-root', path.join(output, 'authority'), '--port', '18083'], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') });
  let page = await open();
  const initial = await draft(page);
  const preview = await prepare(page, share);
  assert.deepEqual(await draft(page), initial); assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), before);
  assert.equal(preview.preview.config.title, 'U3目标B'); assert.equal(preview.preview.config.privateMarker, 'KEEP_B');
  assert.equal(preview.preview.config.theme.privateMarker, 'KEEP_THEME');
  assert.deepEqual(preview.preview.pages.find(page => page.page === 'title').before, ['b_root', 'b_start']);
  await page.evaluate(() => { window.proposal = null; });
  assert.deepEqual(await draft(page), initial);
  results.steps.push('只读预览、取消不改草稿或文件，影响范围来自公共投影');

  const imageShare = structuredClone(share);
  imageShare.config.ui.pages.title.children[0].states.hover.backgroundImage = { asset: 'missing', fit: 'stretch' };
  imageShare.assets = [{ path: 'content/assets/bg/missing.png', base64: png.toString('base64') }];
  const missing = await prepare(page, imageShare);
  assert.deepEqual(missing.resources, [{ path: 'content/assets/bg/missing.png', state: 'missing' }]);
  await assert.rejects(page.evaluate(() => window.proposal.apply()), /缺少共享素材/);
  assert.equal(await page.evaluate(() => window.proposal.stageMissingAssets()), 1);
  assert.deepEqual(await draft(page), initial); assert(!fs.existsSync(path.join(project, 'content/assets/bg/missing.png')));
  results.steps.push('缺资源时禁止应用，显式加入原导入待选区仍不改草稿或写入素材');

  const conflict = structuredClone(imageShare);
  conflict.config.ui.pages.title.children[0].states.hover.backgroundImage.asset = 'existing';
  conflict.assets[0].path = 'content/assets/bg/existing.png';
  await prepare(page, conflict);
  fs.writeFileSync(path.join(project, 'content/assets/bg/existing.png'), 'changed after preview');
  await assert.rejects(page.evaluate(() => window.proposal.apply()), /冲突/);
  fs.writeFileSync(path.join(project, 'content/assets/bg/existing.png'), png);
  assert.deepEqual(await draft(page), initial);
  results.steps.push('预览后素材改变，确认时重新读取并拒绝冲突');

  await prepare(page, share);
  await page.evaluate(async () => {
    const config = await import('/src/panels/config.ts');
    config.editUiConfigDraft({ type: 'node.update', page: 'title', id: 'b_start', patch: { style: { opacity: 0.5 } } });
  });
  await assert.rejects(page.evaluate(() => window.proposal.apply()), /草稿已变化/);
  await page.evaluate(async () => (await import('/src/panels/config.ts')).configUndo());
  const beforeApply = await draft(page);
  await prepare(page, share);
  await page.evaluate(() => {
    window.proposal.preview.value.pages.title.id = 'MUTATED_PUBLIC_PREVIEW';
    window.proposal.preview.config.title = 'MUTATED';
  });
  await page.evaluate(() => window.proposal.apply());
  const applied = await draft(page);
  assert.equal(applied.ui.pages.title.id, 'a_root');
  assert.equal(applied.history.past, beforeApply.history.past + 1);
  await assert.rejects(page.evaluate(() => window.proposal.apply()), /已经应用/);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), before);
  await page.evaluate(async () => (await import('/src/panels/config.ts')).configUndo());
  const undone = await draft(page); assert.deepEqual(undone.ui, initial.ui); assert.equal(undone.theme, initial.theme);
  await page.evaluate(async () => (await import('/src/panels/config.ts')).configRedo());
  assert.deepEqual((await draft(page)).ui, applied.ui);
  results.steps.push('过期拒绝、预览对象不可篡改实际应用、一次撤销同时回退主题和界面');

  const outcome = await page.evaluate(async () => {
    const config = await import('/src/panels/config.ts'), io = await import('/src/project-io.ts');
    return io.runProjectWriteOperation(() => config.saveDirtyConfigSections());
  });
  assert.equal(outcome.failures, 0); assert.equal(outcome.remainingDirty, false);
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(saved.privateMarker, 'KEEP_B'); assert.equal(saved.theme.privateMarker, 'KEEP_THEME');
  assert.equal(saved.title, before.title); assert.deepEqual(saved.player, before.player);
  assert.deepEqual(saved.ui, share.config.ui); assert.equal(saved.theme.colors.accent, 0x556677);
  await page.close(); page = await open();
  assert.deepEqual((await draft(page)).ui, share.config.ui);
  const second = await draft(page);
  await prepare(page, share); await page.evaluate(() => { window.olderProposal = window.proposal; });
  await prepare(page, share);
  await assert.rejects(page.evaluate(() => window.olderProposal.apply()), /草稿已变化/);
  // Preparing the second proposal must not itself create another history step.
  assert.deepEqual(await draft(page), second);
  await page.evaluate(async () => (await import('/src/panels/config.ts')).resetConfigSession());
  await assert.rejects(page.evaluate(() => window.proposal.apply()), /草稿已变化/);
  results.steps.push('原保存边界落盘、私有字段及游戏设置保留、重新打开一致');
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify(results, null, 2));
} catch (error) { results.failure = String(error.stack ?? error); throw error; }
finally { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2)); await browser?.close(); await server?.close(); }
