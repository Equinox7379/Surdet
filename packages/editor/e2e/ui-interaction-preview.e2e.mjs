import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// Actual designer DOM: composited state opacity, independent keyboard-focus
// preview, and state ownership after closing/recreating the designer.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_U2_PREVIEW_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-u2-preview-'));
await fs.mkdir(output, { recursive: true });
const entry = '\0ui-interaction-preview';
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', plugins: [{
  name: 'u2-preview',
  resolveId: id => id === 'ui-interaction-preview' || id.replaceAll('\\', '/') === `${root.replaceAll('\\', '/')}/ui-interaction-preview` ? entry : undefined,
  load: id => id === entry ? `
    export { renderUiDesigner, disposeUiDesigner } from ${JSON.stringify(path.join(root, 'packages/editor/src/ui-designer.ts'))};
    export { state } from ${JSON.stringify(path.join(root, 'packages/editor/src/state.ts'))};
  ` : undefined,
}], build: { write: false, minify: false, lib: { entry: 'ui-interaction-preview', name: 'PreviewUi', formats: ['iife'] } } });
const chunk = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).find(item => item.type === 'chunk' && item.isEntry);
assert(chunk);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><body style="margin:0"><div id="designer"></div></body>');
  await page.addStyleTag({ path: path.join(root, 'packages/editor/src/styles/config-workspace.css') });
  await page.addStyleTag({ content: ':root{--surdet-text-primary:#123456;--surdet-surface-panel:#fff}.ui-designer-canvas{width:1000px}' });
  await page.addScriptTag({ content: chunk.code });
  await page.evaluate(() => {
    const frame = (x, y, width, height) => ({ x, y, width, height });
    const ui = { version: 1, pages: { title: { id: 'root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
      { id: 'go', type: 'button', frame: frame(120, 120, 320, 80), text: { kind: 'literal', value: '状态预览' }, action: { kind: 'start' },
        style: { background: 0xff0000 }, states: { disabled: { opacity: 0.5 }, focus: { opacity: 0 } } },
    ] } } };
    PreviewUi.state.gameConfigText = JSON.stringify({ ui });
    PreviewUi.state.dirAssets = []; PreviewUi.state.dirHandle = null;
    const unused = () => { throw new Error('Rendering-only U2 preview must not write'); };
    window.mount = () => document.querySelector('#designer').replaceChildren(PreviewUi.renderUiDesigner({
      read: () => ui, edit: unused, replace: unused, reload: () => ui, save: unused, preview: unused,
      exportShare: unused, importShare: unused, undo: unused, redo: unused, onStatus: unused,
    }));
    window.mount();
  });
  await page.locator('.ui-designer-tree [data-ui-node="go"]').click();
  await page.locator('[data-ui-style-control="state:disabled"]').click();
  const state = await page.evaluate(() => {
    const item = document.querySelector('.ui-designer-canvas [data-ui-node="go"]');
    const decor = item.previousElementSibling;
    const opacity = element => getComputedStyle(element).opacity;
    return { group: item.parentElement.contains(decor) && item.parentElement !== item.closest('[data-ui-canvas-page]'),
      opacity: opacity(item.parentElement), content: opacity(item), decor: opacity(decor) };
  });
  assert.deepEqual(state, { group: true, opacity: '0.225', content: '1', decor: '1' });
  await page.locator('[data-ui-style-control="state:focus"]').click();
  const focus = await page.evaluate(() => {
    const item = document.querySelector('.ui-designer-canvas [data-ui-node="go"]');
    const ring = document.querySelector('[data-ui-focus-preview]');
    let alpha = 1;
    for (let element = ring; element; element = element.parentElement) alpha *= Number(getComputedStyle(element).opacity);
    const a = item.getBoundingClientRect(), b = ring.getBoundingClientRect();
    return { outside: !item.parentElement.contains(ring), alpha, width: b.width, position: [a.x, a.y, a.width, a.height].map((value, i) => Math.abs(value - [b.x, b.y, b.width, b.height][i])) };
  });
  assert.equal(focus.outside, true); assert.equal(focus.alpha, 1); assert(focus.width > 0);
  assert(focus.position.every(delta => delta < 1), `focus ring follows the control: ${JSON.stringify(focus)}`);
  await page.screenshot({ path: path.join(output, 'focus-at-zero-opacity.png') });
  await page.evaluate(() => { PreviewUi.disposeUiDesigner(); window.mount(); });
  assert.equal(await page.locator('[data-ui-style-key="state"] [aria-pressed="true"]').getAttribute('data-ui-style-control'), 'state:normal');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, state, focus, reopenedState: 'normal', errors }));
} finally { await browser.close(); }
