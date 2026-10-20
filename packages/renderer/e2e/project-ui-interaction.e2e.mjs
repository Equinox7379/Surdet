import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// U2 in the real Project UI DOM with the real shared page-motion driver (advanced by hand here, as the Runtime
// ticker does in the Player): interaction states come from real Chromium pointer/keyboard state and Core's merge,
// each change repaints the whole node, focus has its own page-level marker, and page enter/exit is visual only
// (a closing page is an inert picture, re-show/reset/reduced motion settle at once, paint failures stay contained).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_UI_INTERACTION_E2E_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-project-ui-interaction-'));
await fs.mkdir(output, { recursive: true });
const entry = path.join(output, 'entry.ts');
await fs.writeFile(entry, `export { createProjectUiDom } from ${JSON.stringify(path.join(root, 'packages/renderer/src/project-ui-dom.ts'))};
export { ProjectUiMotionController } from ${JSON.stringify(path.join(root, 'packages/renderer/src/project-ui-motion.ts'))};\n`);
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry, name: 'InteractionUi', formats: ['iife'] },
} });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).filter(item => item.type === 'chunk' && item.isEntry);
assert.equal(chunks.length, 1);

const frame = (x, y, width, height) => ({ x, y, width, height });
const literal = value => ({ kind: 'literal', value });
const line = width => ({ width, color: 0x335577, opacity: 1 });
const shadow = { x: 0, y: 4, blur: 8, color: 0x000000, opacity: 0.5 };
const uiDocument = { version: 1, pages: {
  hud: { id: 'hud_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'go', type: 'button', frame: frame(40, 40, 200, 60), text: literal('出发'), enabledWhen: 'ready', action: { kind: 'variable-set', name: 'went', value: true },
      style: { background: 0x202020, color: 0xffffff, border: line(2), borderRadius: 6 },
      states: {
        hover: { background: 0x0000ff, backgroundGradient: { from: 0x00ff00, to: 0x00ffff, angle: 90 }, shadows: [shadow], textShadows: [shadow] },
        focus: { color: 0xffff00 },
        pressed: { background: 0xff0000, opacity: 0.8 },
        disabled: { background: 0x808080, color: 0x999999 },
      } },
    { id: 'legacy', type: 'button', frame: frame(280, 40, 160, 60), text: literal('旧按钮'), enabledWhen: 'ready', action: { kind: 'variable-set', name: 'legacy', value: true } },
    { id: 'flag', type: 'toggle', frame: frame(480, 40, 160, 60), binding: { kind: 'variable', name: 'flag' }, text: literal('开关'),
      style: { background: 0xffffff }, states: { hover: { background: 0x00ff00 }, pressed: { background: 0xff00ff } } },
    { id: 'name', type: 'input', frame: frame(680, 40, 220, 44), binding: { kind: 'variable', name: 'nickname' },
      states: { focus: { background: 0xffffcc } } },
    { id: 'skin_missing', type: 'button', frame: frame(940, 40, 200, 60), text: literal('缺图'),
      states: { hover: { backgroundImage: { asset: 'missing_hover', fit: 'stretch' } } } },
    { id: 'clip', type: 'container', frame: frame(40, 400, 300, 120), style: { border: line(2), padding: { top: 16, right: 16, bottom: 16, left: 16 }, background: 0xeeeeee }, children: [
      { id: 'edge', type: 'button', frame: frame(-40, 20, 120, 40), text: literal('边缘'), states: { focus: { background: 0x00aa00 } } },
    ] },
  ] },
  'system-menu': { id: 'menu_root', type: 'container', frame: frame(0, 0, 1280, 720),
    transition: { enter: { durationMs: 200, opacity: 0, y: 40, easing: 'linear' }, exit: { durationMs: 200, opacity: 0, scale: 0.9, easing: 'linear' } },
    style: { background: 0x101010 }, children: [
      { id: 'menu_close', type: 'button', frame: frame(540, 300, 200, 60), text: literal('关闭'), action: { kind: 'close' }, states: { hover: { background: 0x0000ff } } },
      { id: 'menu_flag', type: 'text', frame: frame(540, 400, 200, 40), visibleWhen: 'shown', text: literal('出现') },
    ] },
  settings: { id: 'settings_root', type: 'container', frame: frame(0, 0, 1280, 720), transition: { enter: { durationMs: 0, opacity: 0 } }, children: [
    { id: 'settings_back', type: 'button', frame: frame(40, 40, 200, 60), text: literal('返回'), action: { kind: 'back' } },
  ] },
  toolbar: { id: 'toolbar_root', type: 'container', frame: frame(0, 600, 1280, 120), transition: { enter: { durationMs: 100, x: -64 } }, children: [
    { id: 'tool', type: 'button', frame: frame(20, 20, 120, 60), text: literal('工具'), action: { kind: 'auto' } },
  ] },
} };

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.setContent('<!doctype html><body style="margin:0;background:#111"><canvas width="1280" height="720" style="width:1280px;height:720px;display:block"></canvas></body>');
  await page.addScriptTag({ content: chunks[0].code });
  await page.evaluate((document_) => {
    window.values = { ready: false, flag: false, nickname: '凛', shown: true };
    window.actions = []; window.writes = []; window.reported = []; window.stageClicks = 0;
    document.querySelector('canvas').addEventListener('click', () => { window.stageClicks++; });
    window.motion = new InteractionUi.ProjectUiMotionController();
    window.ctx = () => ({
      data: () => undefined,
      read: name => window.values[name],
      write: (binding, value) => { window.writes.push([binding.name, value]); window.values[binding.name] = value; window.ui.refresh(); },
      bounds: () => ({ min: 0, max: 1, step: 0.1 }),
      content: () => [], select: () => true,
      action: action => { window.actions.push(action.kind === 'variable-set' ? action.name : action.kind); },
    });
    window.makeUi = (motion, reducedMotion = false) => InteractionUi.createProjectUiDom({
      canvas: document.querySelector('canvas'), document: document_,
      theme: { colors: { text: 0xf4efe6, panel: 0x1b1d22, surface: 0x272a31, line: 0x5b6070, accent: 0xd98b4a, textOnAccent: 0x111111 }, typography: { uiSize: 20 }, radius: { md: 4, sm: 2 }, skins: {} },
      fontFamily: () => 'sans-serif', imageUrl: () => undefined,
      onError: error => { window.reported.push(error instanceof Error ? error.message : String(error)); },
      isPageVisible: page => !(window.hiddenPages ?? []).includes(page),
      motion, reducedMotion,
    });
    window.ui = window.makeUi(window.motion);
    window.ui.show('hud', window.ctx());
  }, uiDocument);
  const frames = (count = 2) => page.evaluate(count => new Promise(resolve => {
    const step = left => left ? requestAnimationFrame(() => step(left - 1)) : resolve();
    step(count);
  }), count);
  await frames();

  // ---- Interaction states -------------------------------------------------------------------------------------
  const look = id => page.evaluate(id => {
    const element = document.querySelector(`[data-ui-node="${id}"]`), group = document.querySelector(`[data-ui-group="${id}"]`);
    const decor = group?.querySelector(':scope > [data-ui-decor]'), fill = decor?.querySelector('[data-ui-decor-background]');
    const css = value => value && getComputedStyle(value);
    return { state: element.dataset.uiState, groupOpacity: group ? Number(css(group).opacity) : null, ownOpacity: Number(css(element).opacity),
      decors: group?.querySelectorAll('[data-ui-decor]').length ?? 0, background: fill ? css(fill).backgroundColor : null,
      gradient: fill ? css(fill).backgroundImage : null, boxShadow: decor ? css(decor).boxShadow : null,
      color: css(element).color, textShadow: css(element).textShadow, disabled: element.disabled ?? null };
  }, id);
  const center = id => page.evaluate(id => { const r = document.querySelector(`[data-ui-node="${id}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
  const setValue = async (name, value) => { await page.evaluate(([name, value]) => { window.values[name] = value; window.ui.refresh(); }, [name, value]); };

  let go = await look('go');
  // Disabled from enabledWhen: Core's disabled state, whole-node opacity 0.45 applied once on the group only.
  assert.deepEqual([go.state, go.groupOpacity, go.ownOpacity, go.background, go.color, go.decors], ['disabled', 0.45, 1, 'rgb(128, 128, 128)', 'rgb(153, 153, 153)', 1]);
  const goAt = await center('go');
  await page.mouse.move(goAt.x, goAt.y); await frames();
  go = await look('go');
  assert.equal(go.state, 'hover disabled'); assert.equal(go.background, 'rgb(128, 128, 128)', 'hover never applies to a disabled control');
  await page.mouse.down(); await page.mouse.up(); await frames();
  assert.deepEqual(await page.evaluate(() => window.actions), [], 'a disabled state button never activates');

  // Dynamic enabledWhen: the next refresh repaints from Core (hover now applies, whole re-apply incl. gradient/shadows).
  await setValue('ready', true); await frames();
  go = await look('go');
  assert.equal(go.state, 'hover'); assert.equal(go.groupOpacity, 1); assert.equal(go.background, 'rgb(0, 0, 255)');
  assert.match(go.gradient, /linear-gradient/); assert.notEqual(go.boxShadow, 'none'); assert.notEqual(go.textShadow, 'none'); assert.equal(go.decors, 1);
  await page.mouse.down(); await frames();
  go = await look('go');
  assert.equal(go.state, 'hover pressed'); assert.equal(go.background, 'rgb(255, 0, 0)'); assert.equal(go.groupOpacity, 0.8);
  await page.mouse.up(); await frames();
  assert.deepEqual(await page.evaluate(() => window.actions), ['went'], 'one mouse press is one activation');
  assert.equal((await look('go')).state, 'hover');
  // Leaving repaints everything back to the normal state: no gradient, element or text shadow survives.
  await page.mouse.move(640, 300); await frames();
  go = await look('go');
  assert.deepEqual([go.state, go.background, go.gradient, go.boxShadow, go.textShadow, go.color, go.groupOpacity, go.decors],
    ['normal', 'rgb(32, 32, 32)', 'none', 'none', 'none', 'rgb(255, 255, 255)', 1, 1]);
  // A mouse click focuses the button without keyboard focus: no focus state, no marker.
  const marker = () => page.evaluate(() => [...document.querySelectorAll('[data-ui-focus-marker]')].filter(item => !item.hidden && item.isConnected).map(item => {
    const r = item.getBoundingClientRect(), css = getComputedStyle(item);
    return { for: item.dataset.uiFocusFor, x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
      inGroup: Boolean(item.closest('[data-ui-group]')), page: item.parentElement.dataset.uiPage, z: css.zIndex, outline: css.outlineStyle };
  }));
  await page.mouse.click(goAt.x, goAt.y); await page.mouse.move(640, 300); await frames();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.uiNode), 'go');
  assert.equal((await look('go')).state, 'normal'); assert.deepEqual(await marker(), []);
  await page.evaluate(() => { window.actions.length = 0; document.activeElement.blur(); });

  // Keyboard focus: Core focus state plus the page's own marker (outside every node group, above it, unclipped).
  const tabTo = async id => {
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(id => document.activeElement?.closest('[data-ui-node]')?.dataset.uiNode === id, id)) return;
    }
    throw new Error(`Tab never reached ${id}`);
  };
  await tabTo('go'); await frames();
  go = await look('go');
  assert.deepEqual([go.state, go.color], ['focus', 'rgb(255, 255, 0)']);
  assert.deepEqual(await marker(), [{ for: 'go', x: 40, y: 40, width: 200, height: 60, inGroup: false, page: 'hud', z: '40', outline: 'solid' }]);
  // Space and Enter each activate once; Space shows the pressed state while held.
  await page.keyboard.down(' '); await frames();
  assert.equal((await look('go')).state, 'focus pressed');
  await page.keyboard.up(' '); await frames();
  await page.keyboard.press('Enter'); await frames();
  assert.deepEqual(await page.evaluate(() => window.actions), ['went', 'went']);
  assert.equal((await look('go')).state, 'focus');
  await page.evaluate(() => { window.actions.length = 0; });
  // Legacy (stateless) nodes keep their exact previous DOM: no group, state or focus target; 0.45 on the element.
  await setValue('ready', false); await frames();
  const legacy = await page.evaluate(() => { const element = document.querySelector('[data-ui-node="legacy"]');
    return { group: Boolean(document.querySelector('[data-ui-group="legacy"]')), state: element.dataset.uiState ?? null, target: element.dataset.uiFocusTarget ?? null, opacity: element.style.opacity }; });
  assert.deepEqual(legacy, { group: false, state: null, target: null, opacity: '0.45' });
  await setValue('ready', true); await frames();

  // Toggle: Chromium's :active reaches the wrapper from the native checkbox; one press toggles once.
  const flagAt = await center('flag');
  await page.mouse.move(flagAt.x, flagAt.y); await frames();
  assert.equal((await look('flag')).background, 'rgb(0, 255, 0)');
  await page.mouse.down(); await frames();
  assert.deepEqual([(await look('flag')).state, (await look('flag')).background], ['hover pressed', 'rgb(255, 0, 255)']);
  await page.mouse.up(); await frames();
  assert.deepEqual(await page.evaluate(() => window.writes), [['flag', true]]);
  await page.mouse.move(640, 300); await frames();
  assert.deepEqual([(await look('flag')).state, (await look('flag')).background], ['normal', 'rgb(255, 255, 255)']);

  // Input: its focus state paints the fill, so the native box gives way only while focused.
  const nativeFill = () => page.evaluate(() => document.querySelector('[data-ui-node="name"] input').style.background);
  assert.equal(await nativeFill(), '');
  await tabTo('name'); await frames();
  assert.deepEqual([(await look('name')).state, (await look('name')).background, await nativeFill()], ['focus', 'rgb(255, 255, 204)', 'transparent']);
  assert.equal((await marker())[0]?.for, 'name');
  await page.keyboard.press('Shift+Tab'); await frames();
  assert.deepEqual([(await look('name')).state, await nativeFill()], ['normal', '']);

  // Marker for a control partly outside its clipping container shows only the visible part, still outside the group.
  await tabTo('edge'); await frames();
  assert.equal((await look('edge')).background, 'rgb(0, 170, 0)');
  // Content box of the clipping container starts at x 40 + 2 + 16 = 58; the button's outer box spans x 18..138.
  assert.deepEqual(await marker(), [{ for: 'edge', x: 58, y: 438, width: 80, height: 40, inGroup: false, page: 'hud', z: '40', outline: 'solid' }]);
  await page.evaluate(() => document.activeElement.blur()); await frames();
  assert.deepEqual(await marker(), []);

  // An author image in a state that is not loaded is reported (an inherited theme skin would stay silent).
  const missingAt = await center('skin_missing');
  await page.mouse.move(missingAt.x, missingAt.y); await frames();
  assert.deepEqual(await page.evaluate(() => window.reported), ['界面组件 skin_missing 的背景：界面图片未加载：missing_hover']);
  await page.mouse.move(640, 300); await frames();
  await page.evaluate(() => { window.reported.length = 0; });

  // ---- Page enter / exit ----------------------------------------------------------------------------------------
  const menu = () => page.evaluate(() => [...document.querySelectorAll('[data-ui-page="system-menu"]')].map(element => ({
    opacity: element.style.opacity, transform: element.style.transform, closing: element.dataset.uiClosing ?? null, inert: element.inert,
  })));
  const blockers = () => page.evaluate(() => document.querySelectorAll('[data-ui-motion-blocker]').length);
  const step = ms => page.evaluate(ms => { window.motion.update(ms); }, ms);
  const busy = () => page.evaluate(() => window.motion.needsUpdate);

  await page.evaluate(() => window.ui.show('system-menu', window.ctx()));
  assert.deepEqual(await menu(), [{ opacity: '0', transform: 'translate(0px, 40px) scale(1)', closing: null, inert: false }]);
  assert.equal(await blockers(), 1, 'a modal page moving in shields the uncovered strip');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-ui-node]')?.dataset.uiNode), 'menu_close', 'modal focus is given at once');
  await page.mouse.click(640, 10); await frames();
  assert.equal(await page.evaluate(() => window.stageClicks), 0, 'the strip a moving modal page does not cover yet never reaches the stage');
  await step(100);
  assert.deepEqual(await menu(), [{ opacity: '0.5', transform: 'translate(0px, 20px) scale(1)', closing: null, inert: false }]);
  // Input is never held back by the visual entry.
  await page.evaluate(() => document.querySelector('[data-ui-node="menu_close"]').click());
  assert.deepEqual(await page.evaluate(() => window.actions.splice(0)), ['close']);
  await step(100);
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]);
  assert.equal(await blockers(), 0); assert.equal(await busy(), false);

  // Exit: the page leaves the registry at once and becomes an inert picture that is never refreshed or operated.
  await page.evaluate(() => window.ui.hide('system-menu'));
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: 'true', inert: true }]);
  const ghostState = () => page.evaluate(() => {
    const ghost = document.querySelector('[data-ui-page="system-menu"]');
    return { hidden: ghost.querySelector('[data-ui-node="menu_flag"]').hidden, focusInside: ghost.contains(document.activeElement), ariaHidden: ghost.getAttribute('aria-hidden') };
  });
  await setValue('shown', false); await frames();
  assert.deepEqual(await ghostState(), { hidden: false, focusInside: false, ariaHidden: 'true' });
  await page.evaluate(() => document.querySelector('[data-ui-node="menu_close"]').click());
  const closeAt = await center('menu_close');
  await page.mouse.click(closeAt.x, closeAt.y);
  for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-ui-closing]'))), false, 'Tab never enters a closing page');
  assert.deepEqual(await page.evaluate(() => window.actions), [], 'a closing page never activates');
  await step(100);
  assert.deepEqual(await menu(), [{ opacity: '0.5', transform: 'translate(0px, 0px) scale(0.95)', closing: 'true', inert: true }]);
  await step(100);
  assert.deepEqual(await menu(), []); assert.equal(await busy(), false);
  await setValue('shown', true);
  await page.evaluate(() => document.activeElement?.blur());

  // Exit started mid-entry continues from the pose on screen; re-showing during the exit drops the picture at once.
  await page.evaluate(() => { window.ui.show('system-menu', window.ctx()); window.motion.update(150); window.ui.hide('system-menu'); });
  assert.deepEqual(await menu(), [{ opacity: '0.75', transform: 'translate(0px, 10px) scale(1)', closing: 'true', inert: true }]);
  await step(100);
  await page.evaluate(() => window.ui.show('system-menu', window.ctx()));
  assert.deepEqual(await menu(), [{ opacity: '0', transform: 'translate(0px, 40px) scale(1)', closing: null, inert: false }]);
  await step(200);
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }], 'the old exit completion never removes the reopened page');
  // Same-page replace while open: no exit picture and no second entry.
  await page.evaluate(() => window.ui.show('system-menu', window.ctx()));
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]); assert.equal(await busy(), false);
  // Rapid toggling always ends in one consistent page (or none) with nothing left on the driver.
  await page.evaluate(() => { for (let index = 0; index < 10; index++) { if (index % 2) window.ui.show('system-menu', window.ctx()); else window.ui.hide('system-menu'); window.motion.update(30); } });
  assert.equal((await menu()).length, 1);
  await step(400);
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]); assert.equal(await blockers(), 0); assert.equal(await busy(), false);
  await page.evaluate(() => { for (let index = 0; index < 11; index++) { if (index % 2) window.ui.show('system-menu', window.ctx()); else window.ui.hide('system-menu'); window.motion.update(30); } });
  await step(400);
  assert.deepEqual(await menu(), []); assert.equal(await blockers(), 0); assert.equal(await busy(), false);

  // Cancel notifications are synchronous, even when a different page still keeps the driver busy.
  const cancelledMenu = await page.evaluate(() => {
    window.ui.show('toolbar', window.ctx());
    window.ui.show('system-menu', window.ctx()); window.motion.update(50);
    window.motion.cancel('project-ui:system-menu');
    const element = document.querySelector('[data-ui-page="system-menu"]');
    return { opacity: element.style.opacity, transform: element.style.transform,
      blocker: Boolean(document.querySelector('[data-ui-motion-blocker="system-menu"]')), busy: window.motion.needsUpdate };
  });
  assert.deepEqual(cancelledMenu, { opacity: '', transform: '', blocker: false, busy: true });
  const cancelledGhost = await page.evaluate(() => {
    window.ui.hide('system-menu'); window.motion.cancel('project-ui:system-menu');
    return Boolean(document.querySelector('[data-ui-page="system-menu"]'));
  });
  assert.equal(cancelledGhost, false, 'cancelled exit is removed without waiting for UI refresh');
  await step(100);
  await page.evaluate(() => window.ui.hide('toolbar'));

  // A new session (resetMotion) and a driver cancelled behind the UI's back both settle at once.
  await page.evaluate(() => { window.ui.show('system-menu', window.ctx()); window.motion.update(50); window.ui.resetMotion(); });
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]); assert.equal(await blockers(), 0); assert.equal(await busy(), false);
  await page.evaluate(() => { window.ui.hide('system-menu'); window.motion.update(50); window.ui.resetMotion(); });
  assert.deepEqual(await menu(), []); assert.equal(await busy(), false);
  await page.evaluate(() => { window.ui.show('system-menu', window.ctx()); window.motion.update(50); window.motion.cancelAll(); });
  await frames();
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]); assert.equal(await blockers(), 0);
  await page.evaluate(() => { window.ui.hide('system-menu'); window.motion.update(50); window.motion.cancelAll(); });
  await frames();
  assert.deepEqual(await menu(), []);

  // The Player Shell commits its session (whose listener refreshes this UI and hides the page) before it asks for
  // hide(): a page still on screen this frame plays its exit; one hidden since an earlier frame simply goes.
  const clicksBeforeNested = await page.evaluate(() => window.stageClicks);
  await page.evaluate(() => {
    window.ui.show('system-menu', window.ctx()); window.motion.update(50);
    window.hiddenPages = ['system-menu']; window.ui.refresh();
  });
  await page.mouse.click(1000, 500);
  assert.equal(await page.evaluate(() => window.stageClicks), clicksBeforeNested + 1,
    'the hidden parent menu must not block a built-in child page on the renderer canvas');
  await page.evaluate(() => {
    window.hiddenPages = []; window.ui.refresh();
  });
  assert.equal(await page.evaluate(() => !document.querySelector('[data-ui-motion-blocker]').hidden), true,
    'returning to the entering parent restores its own blocker');
  await page.evaluate(() => window.ui.resetMotion());
  await page.evaluate(() => { window.ui.show('system-menu', window.ctx()); window.motion.update(400); });
  await page.evaluate(() => { window.hiddenPages = ['system-menu']; window.ui.refresh(); window.ui.hide('system-menu'); });
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: 'true', inert: true }], 'a page hidden by the closing session still leaves with its exit');
  assert.equal(await page.evaluate(() => document.querySelector('[data-ui-page="system-menu"]').hidden), false, 'the exit picture is shown');
  await step(100);
  assert.deepEqual(await menu(), [{ opacity: '0.5', transform: 'translate(0px, 0px) scale(0.95)', closing: 'true', inert: true }]);
  await step(400);
  assert.deepEqual(await menu(), []); assert.equal(await busy(), false);
  await page.evaluate(() => { window.hiddenPages = []; window.ui.show('system-menu', window.ctx()); window.motion.update(400); window.hiddenPages = ['system-menu']; window.ui.refresh(); });
  await frames(3);
  await page.evaluate(() => window.ui.hide('system-menu'));
  assert.deepEqual(await menu(), [], 'a page hidden since an earlier frame goes without an exit'); assert.equal(await busy(), false);
  await page.evaluate(() => { window.hiddenPages = []; });

  // Reduced motion: on from the start shows/closes statically; switched on mid-way every projection ends now.
  await page.evaluate(() => { window.ui.setReducedMotion(true); window.ui.show('system-menu', window.ctx()); });
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]); assert.equal(await busy(), false);
  await page.evaluate(() => window.ui.hide('system-menu'));
  assert.deepEqual(await menu(), []);
  await page.evaluate(() => { window.ui.setReducedMotion(false); window.ui.show('system-menu', window.ctx()); window.motion.update(50); window.ui.setReducedMotion(true); });
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]); assert.equal(await blockers(), 0); assert.equal(await busy(), false);
  await page.evaluate(() => { window.ui.setReducedMotion(false); window.ui.hide('system-menu'); window.motion.update(50); window.ui.setReducedMotion(true); });
  assert.deepEqual(await menu(), []); assert.equal(await busy(), false);
  await page.evaluate(() => window.ui.setReducedMotion(false));

  // durationMs 0 is static; a non-modal page moves without a shield.
  await page.evaluate(() => window.ui.show('settings', window.ctx()));
  assert.deepEqual(await page.evaluate(() => document.querySelector('[data-ui-page="settings"]').style.opacity), ''); assert.equal(await busy(), false);
  await page.evaluate(() => window.ui.hide('settings'));
  await page.evaluate(() => window.ui.show('toolbar', window.ctx()));
  assert.deepEqual(await page.evaluate(() => document.querySelector('[data-ui-page="toolbar"]').style.transform), 'translate(-64px, 0px) scale(1)');
  assert.equal(await blockers(), 0);
  await step(100);
  assert.equal(await page.evaluate(() => document.querySelector('[data-ui-page="toolbar"]').style.transform), '');

  // A paint failure is reported by the UI and never thrown into the ticker; the projection still finishes.
  await page.evaluate(() => {
    window.ui.show('system-menu', window.ctx());
    const element = document.querySelector('[data-ui-page="system-menu"]');
    Object.defineProperty(element.style, 'transform', { configurable: true, set() { throw new Error('paint broke'); }, get() { return ''; } });
    window.motion.update(50); window.motion.update(200);
    delete element.style.transform;
  });
  assert.deepEqual(await page.evaluate(() => window.reported), ['paint broke']);
  assert.equal(await busy(), false); assert.equal(await blockers(), 0);
  await page.evaluate(() => { window.reported.length = 0; window.ui.hide('system-menu'); window.ui.dispose(); window.motion.update(500); });
  assert.equal(await busy(), false, 'dispose cancels this UI\'s projections without callbacks');

  // A driver already disposed with its Runtime gives the static end state; no motion option keeps the old behaviour.
  await page.evaluate(() => {
    const disposed = new InteractionUi.ProjectUiMotionController(); disposed.dispose();
    window.ui = window.makeUi(disposed); window.ui.show('system-menu', window.ctx());
  });
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]);
  await page.evaluate(() => { window.ui.hide('system-menu'); window.ui.dispose(); window.ui = window.makeUi(undefined); window.ui.show('system-menu', window.ctx()); });
  assert.deepEqual(await menu(), [{ opacity: '', transform: '', closing: null, inert: false }]);
  await page.evaluate(() => window.ui.hide('system-menu'));
  assert.deepEqual(await menu(), []);
  assert.deepEqual(await page.evaluate(() => window.reported), []);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(output, 'project-ui-interaction.png') });
  console.log(`project UI interaction e2e passed: ${output}`);
} finally {
  await browser.close();
}
