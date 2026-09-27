import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createStageFixture } from '../../editor/e2e/support/stage-fixture.mjs';
import { startDevProject } from '../../editor/scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from '../../editor/e2e/asset-import-authority.e2e.mjs';
import { activate, waitTitle } from './player-browser-helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
assert(process.argv[2], 'Pass a new D-drive output directory');
const output = path.resolve(process.argv[2]);
assert(!fs.existsSync(output), 'Preserve earlier evidence; use a new output directory');
const root = path.join(output, 'project');
const entry = path.relative(path.join(root, 'src'), path.join(repo, 'examples/shared/player/player.ts')).split(path.sep).join('/');
const fixture = createStageFixture(root, entry);
const write = (name, value) => fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const config = { ...fixture.config }; delete config.stage;
write('game.config.json', config);
const menu = '@scene start\n@choice\n  旧角色转新姿态 -> @jump legacy\n  屏幕淡入 -> @jump screen_fade\n  屏幕染色 -> @jump screen_tint\n  混合淡入 -> @jump mixed_fade\n  混合染色 -> @jump mixed_tint\n  改名后的角色 -> @jump renamed\n@end\n';
write('content/scenario/start.gal', menu);
const legacy = '@scene legacy\n@bg dock\n@show rin:coat normal @left\n先保持旧式立绘。\n@show rin:coat smile @x=400\n同时换表情并改变站位。\n@end\n';
write('content/scenario/legacy.gal', legacy);
const renamed = '@scene renamed\n@bg dock\n@show mio:coat normal @x=100 @y=680 @baseHeight=510\n@pose portrait:mio:coat @x=500\n改名后的姿态仍然有效。\n@end\n';
write('content/scenario/renamed.gal', renamed);
for (const action of ['fade', 'tint']) {
  write(`content/scenario/mixed_${action}.gal`, `@scene mixed_${action}\n@bg dock\n@timeline screen_${action}\n先运行时间轴。\n${action === 'fade' ? '@fadein 20000' : '@tint off 20000'}\n场景指令接管。\n@end\n`);
  write(`content/scenario/screen_${action}.gal`, `@scene screen_${action}\n@bg dock\n@show rin:coat normal @x=400\n@timeline screen_${action} @blocking\n完成。\n@end\n`);
  write(`content/timelines/screen_${action}.json`, { version: 2, id: `screen_${action}`, durationMs: 20000, tracks: [{ kind: 'screen', cues: [
    { atMs: 0, durationMs: 20000, easing: 'linear', action, alpha: 1, ...(action === 'tint' ? { color: 0x33aa55 } : {}) },
  ] }] });
}
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'junction');
const evidence = { status: 'running', checks: [], pageErrors: [], consoleErrors: [], failedRequests: [] };
const pass = (name, values = {}) => { evidence.checks.push({ name, ...values }); console.log('PASS ' + name); };
let browser, server, editor, page, client;
try {
  client = new Client({ name: 'stage-recovery-regression', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [path.join(repo, 'packages/cli/dist/agent-port/main.js'), '--project', root, '--policy', 'apply', '--asset-import-data-root', path.join(output, 'authority')],
    env: { ...process.env, SURDET_AGENT_DATA_DIR: path.join(output, 'agent-data') }, stderr: 'pipe' }));
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert(!result.isError, JSON.stringify(result)); assert(result.structuredContent.ok, JSON.stringify(result)); return result.structuredContent.result; };
  const sourcePath = 'content/assets/portrait/mio_coat_normal.png', targetPath = 'content/assets/portrait/kei_coat_normal.png';
  const bytes = fs.readFileSync(path.join(root, sourcePath));
  const operationId = randomUUID();
  const planned = await call('surdet_asset_relocation_plan', { operationId, moves: [{ sourcePath, targetPath }] });
  assert.equal(planned.plan.status, 'ready');
  assert.equal(fs.readFileSync(path.join(root, 'content/scenario/renamed.gal'), 'utf8'), renamed);
  const committed = await call('surdet_asset_relocation_commit', { operationId, planFingerprint: planned.plan.planFingerprint });
  assert.equal(committed.operation.status, 'COMMITTED');
  assert(fs.readFileSync(path.join(root, targetPath)).equals(bytes));
  assert.equal(fs.readFileSync(path.join(root, 'content/scenario/renamed.gal'), 'utf8'), renamed.replaceAll('mio:coat', 'kei:coat'));
  pass('public-stdio-plan-and-commit-preserve-png-bytes-and-rewrite-prefixed-pose');
  fs.writeFileSync(path.join(output, 'build.log'), execFileSync(process.execPath, [path.join(repo, 'packages/cli/dist/index.js'), 'build', root, '--web'], { cwd: repo, encoding: 'utf8', timeout: 120000 }));
  let dist = path.join(output, 'isolated-dist'); fs.cpSync(path.join(root, 'dist'), dist, { recursive: true });
  server = http.createServer((req, res) => {
    const relative = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.resolve(dist, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] ?? 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const snapshot = () => page.evaluate(() => window.__surdetDebug.presentationSnapshot);
  const enter = async name => { await page.goto(url); await waitTitle(page); await activate(page, '开始游戏'); await page.waitForFunction(() => window.__surdetDebug.rendererStatus === 'choice'); await activate(page, name); };
  await enter('旧角色转新姿态');
  await page.waitForFunction(() => window.__surdetDebug.status === 'awaiting-advance');
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Space');
    if ((await snapshot()).stage.portraits[0]?.view.expression === 'smile') break;
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay === 'system-menu');
  const before = await snapshot(); assert.equal(before.stage.transitions?.portraits?.length, 1);
  assert(await page.evaluate(() => window.__surdetDebug.quickSave()));
  const restoredLegacy = await page.evaluate(async () => ({ ok: await window.__surdetDebug.quickLoad(), snapshot: window.__surdetDebug.presentationSnapshot }));
  assert(restoredLegacy.ok); assert.deepEqual(restoredLegacy.snapshot.stage, before.stage);
  await page.screenshot({ path: path.join(output, 'legacy-loaded.png') });
  pass('actual-player-menu-frozen-legacy-expression-transition-roundtrips');
  for (const action of ['fade', 'tint']) {
    await enter(action === 'fade' ? '屏幕淡入' : '屏幕染色');
    await page.waitForFunction(action => { const s = window.__surdetDebug.presentationSnapshot.stage; const value = action === 'fade' ? s.fadeAlpha : s.tint.alpha; return value >= .2 && value < .65; }, action);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay === 'system-menu');
    const saved = await snapshot(); assert(await page.evaluate(() => window.__surdetDebug.quickSave()));
    const restored = await page.evaluate(async () => ({ ok: await window.__surdetDebug.quickLoad(), snapshot: window.__surdetDebug.presentationSnapshot }));
    assert(restored.ok); const loaded = restored.snapshot;
    assert.deepEqual(loaded.timelines[0].snapshot, saved.timelines[0].snapshot);
    assert.equal(loaded.stage.fadeAlpha, saved.stage.fadeAlpha); assert.deepEqual(loaded.stage.tint, saved.stage.tint);
    pass(`actual-player-${action}-restores-exact-saved-value-and-cursor`);
  }
  await enter('改名后的角色');
  await page.waitForFunction(() => window.__surdetDebug.presentationSnapshot.stage.portraits[0]?.view.pose?.x === 500);
  assert.equal((await snapshot()).stage.portraits[0].view.charId, 'kei');
  await page.screenshot({ path: path.join(output, 'renamed-rendered.png') });
  pass('independent-dist-decodes-renamed-png-and-executes-prefixed-pose');
  for (const action of ['fade', 'tint']) {
    await enter(action === 'fade' ? '混合淡入' : '混合染色');
    await page.waitForFunction(() => window.__surdetDebug.presentationSnapshot.timelines[0]?.snapshot.cursorMs >= 4000);
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Space');
      if ((await snapshot()).stage.motions.direct.some(m => m.target === `screen:${action}`)) break;
    }
    await page.waitForFunction(action => window.__surdetDebug.presentationSnapshot.stage.motions.direct.some(m => m.target === `screen:${action}` && m.elapsed >= 400), action);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay === 'system-menu');
    const saved = await snapshot(); assert(await page.evaluate(() => window.__surdetDebug.quickSave()));
    const restored = await page.evaluate(async () => ({ ok: await window.__surdetDebug.quickLoad(), snapshot: window.__surdetDebug.presentationSnapshot }));
    assert(restored.ok); assert.deepEqual(restored.snapshot, saved);
    const motion = saved.stage.motions.direct.find(m => m.target === `screen:${action}`);
    await page.waitForFunction(([target, elapsed]) => window.__surdetDebug.presentationSnapshot.stage.motions.direct.some(m => m.target === target && m.elapsed >= elapsed + 500), [motion.target, motion.elapsed]);
    const continued = await snapshot(), current = continued.stage.motions.direct.find(m => m.target === motion.target);
    const t = current.elapsed / motion.duration, progress = action === 'fade' ? (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) : t;
    const actual = action === 'fade' ? continued.stage.fadeAlpha : continued.stage.tint.alpha;
    assert(Math.abs(actual - (motion.from.opacity + (motion.to.opacity - motion.from.opacity) * progress)) < 1e-10);
    pass(`actual-player-mixed-${action}-restores-owner-and-continues-scene-trajectory`);
  }
  const undone = await call('surdet_asset_relocation_undo', { operationId, receiptId: committed.receipt.receiptId, receiptFingerprint: committed.receipt.receiptFingerprint });
  assert.equal(undone.operation.status, 'UNDONE');
  assert(fs.readFileSync(path.join(root, sourcePath)).equals(bytes));
  assert.equal(fs.readFileSync(path.join(root, 'content/scenario/renamed.gal'), 'utf8'), renamed);
  pass('public-stdio-undo-restores-original-source-and-png');

  const custom = '@scene custom\n@bg dock\n@show mio:coat normal @instance=mio:coat @x=100\n@pose portrait:mio:coat @x=500\n合法实例。\n@end\n';
  const grouped = '@scene grouped\n@bg dock\n@show mio:coat normal @x=100\n@timeline parent @blocking\n@pose portrait:mio @x=500\n合法角色组。\n@end\n';
  const free = '@scene free\n@show mio:coat normal @instance=hero @x=100\n@pose portrait:hero @x=500\n无歧义实例。\n@end\n';
  write('content/scenario/custom.gal', custom); write('content/scenario/grouped.gal', grouped); write('content/scenario/free.gal', free);
  write('content/scenario/start.gal', menu.replace('@end', '  自定义实例 -> @jump custom\n  片段角色组 -> @jump grouped\n  无歧义实例 -> @jump free\n@end'));
  write('content/timelines/child.json', { version: 2, id: 'child', durationMs: 1, tracks: [{ kind: 'portrait', target: 'guest', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', source: 'rin:coat', expression: 'normal', x: 100 }] }] });
  write('content/timelines/parent.json', { version: 2, id: 'parent', durationMs: 1, tracks: [], clips: [{ timelineId: 'child', atMs: 0, targets: { guest: 'mio:guest' } }] });
  fs.writeFileSync(path.join(output, 'instance-build.log'), execFileSync(process.execPath, [path.join(repo, 'packages/cli/dist/index.js'), 'build', root, '--web'], { cwd: repo, encoding: 'utf8', timeout: 120000 }));
  dist = path.join(output, 'instance-dist'); fs.cpSync(path.join(root, 'dist'), dist, { recursive: true });
  const actors = () => page.evaluate(() => Object.fromEntries(window.__surdetDebug.queries.world.inspectStage().objects.map(o => [o.target, o.pose.x])));
  await enter('自定义实例'); await page.waitForFunction(() => window.__surdetDebug.status === 'awaiting-advance'); assert.equal((await actors())['mio:coat'], 500);
  await enter('片段角色组'); await page.waitForFunction(() => window.__surdetDebug.status === 'awaiting-advance'); assert.deepEqual(await actors(), { 'mio:coat': 500, 'mio:guest': 500 });
  await enter('无歧义实例'); await page.waitForFunction(() => window.__surdetDebug.status === 'awaiting-advance'); assert.equal((await actors()).hero, 500);
  const blockedId = randomUUID(), blocked = await call('surdet_asset_relocation_plan', { operationId: blockedId, moves: [{ sourcePath, targetPath }] });
  assert.notEqual(blocked.plan.status, 'ready');
  assert(blocked.plan.blockers.some(b => b.sourcePath === 'content/scenario/custom.gal'));
  assert(blocked.plan.blockers.some(b => b.sourcePath === 'content/timelines/parent.json'));
  const refused = await client.callTool({ name: 'surdet_asset_relocation_commit', arguments: { operationId: blockedId, planFingerprint: blocked.plan.planFingerprint } });
  assert(refused.isError); assert(!fs.existsSync(path.join(root, targetPath))); assert(fs.readFileSync(path.join(root, sourcePath)).equals(bytes));
  assert.equal(fs.readFileSync(path.join(root, 'content/scenario/custom.gal'), 'utf8'), custom); assert.equal(fs.readFileSync(path.join(root, 'content/scenario/grouped.gal'), 'utf8'), grouped);
  pass('core-and-player-run-real-instance-and-targets-before-public-plan-and-commit-refuse-ambiguity');
  await page.screenshot({ path: path.join(output, 'valid-instance-before-refused-rename.png') });
  const cancelled = await call('surdet_asset_relocation_cancel', { operationId: blockedId, planFingerprint: blocked.plan.planFingerprint });
  assert.equal(cancelled.operation.status, 'CANCELLED');
  await client.close(); client = undefined;

  write('game.config.json', { ...config, entryScene: 'legacy' });
  editor = await startDevProject(['--project', root, '--data-root', path.join(output, 'authority'), '--port', '4437'], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: root }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto('http://127.0.0.1:4437/index.html', { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug?.state?.assetIntelligenceState === 'ready');
  await page.locator('[data-scene-id="legacy"]').click();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  const frame = page.frames().find(frame => /preview\.html/.test(frame.url())); assert(frame);
  await frame.waitForFunction(() => window.surdetPreviewDebug?.interp?.status === 'awaiting-advance');
  // Freeze the specific 260ms transition atomically; interaction under test is
  // the normal parent adjustment/cancel flow, not a replacement renderer.
  await frame.evaluate(() => { const d = window.surdetPreviewDebug; d.interp.advance(); d.runtime.controller.update(100); d.runtime.controller.setPresentationPaused(true); });
  const frozen = await frame.evaluate(() => window.surdetPreviewDebug.runtime.controller.snapshotPresentation());
  assert.equal(frozen.stage.transitions.portraits.length, 1);
  await page.locator('.stage-adjustment-workspace > summary').click();
  await page.getByRole('button', { name: '暂停并读取舞台', exact: true }).click();
  await page.getByLabel('舞台对象列表', { exact: true }).selectOption('portrait:rin:coat');
  const x = page.getByLabel('舞台横坐标', { exact: true }); await x.fill('520'); await x.dispatchEvent('change');
  await frame.waitForFunction(() => window.surdetPreviewDebug.runtime.queries.world.inspectStage().objects[0].pose.x === 520);
  await page.getByRole('button', { name: '取消调整', exact: true }).click();
  await frame.waitForFunction(() => window.surdetPreviewDebug.runtime.queries.world.inspectStage().objects[0].pose.x === 400);
  assert.deepEqual(await frame.evaluate(() => window.surdetPreviewDebug.runtime.controller.snapshotPresentation().stage), frozen.stage);
  assert.equal(fs.readFileSync(path.join(root, 'content/scenario/legacy.gal'), 'utf8'), legacy);
  await page.screenshot({ path: path.join(output, 'editor-cancel-restored.png'), fullPage: true });
  pass('actual-editor-temporary-pose-cancel-restores-promoted-crossfade-without-source-write');
  assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.consoleErrors, []); assert.deepEqual(evidence.failedRequests, []);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error(evidence.failure);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  await client?.close(); await browser?.close(); await editor?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
