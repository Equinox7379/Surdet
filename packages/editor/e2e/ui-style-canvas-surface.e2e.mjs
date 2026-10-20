import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// The real designer canvas and Player DOM must agree on text drawn on an author's legacy background.
// No project storage or stage fixture is needed for this rendering-only regression.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_UI_SURFACE_E2E_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-ui-surface-'));
await fs.mkdir(output, { recursive: true });
const entry = '\0ui-style-canvas-surface';
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', plugins: [{
  name: 'ui-surface-check',
  resolveId: id => id === 'ui-style-canvas-surface' || id.replaceAll('\\', '/') === `${root.replaceAll('\\', '/')}/ui-style-canvas-surface` ? entry : undefined,
  load: id => id === entry ? `
    export { renderUiDesigner, disposeUiDesigner } from ${JSON.stringify(path.join(root, 'packages/editor/src/ui-designer.ts'))};
    export { state } from ${JSON.stringify(path.join(root, 'packages/editor/src/state.ts'))};
    export { createProjectUiDom } from ${JSON.stringify(path.join(root, 'packages/renderer/src/project-ui-dom.ts'))};
  ` : undefined,
}], build: { write: false, minify: false, lib: { entry: 'ui-style-canvas-surface', name: 'SurfaceUi', formats: ['iife'] } } });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).filter(item => item.type === 'chunk' && item.isEntry);
assert.equal(chunks.length, 1);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><body style="margin:0"><div id="designer"></div><canvas width="1280" height="720" style="display:block;width:1280px;height:720px"></canvas></body>');
  await page.addStyleTag({ path: path.join(root, 'packages/editor/src/styles/config-workspace.css') });
  await page.addStyleTag({ content: ':root{--surdet-text-primary:#123456;--surdet-surface-panel:#fff}.ui-designer-canvas{width:1000px}' });
  await page.addScriptTag({ content: chunks[0].code });
  await page.evaluate(() => {
    const frame = (x, y, width, height) => ({ x, y, width, height });
    const text = (id, x, style) => ({ id, type: 'text', frame: frame(x, 0, 180, 40), text: { kind: 'literal', value: '作品文字' }, ...(style ? { style } : {}) });
    const document_ = { version: 1, pages: { title: { id: 'root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
      text('own_background', 0, { background: 0 }),
      { id: 'legacy_parent', type: 'container', frame: frame(0, 80, 500, 100), style: { background: 0 }, children: [
        text('nested_background', 0), text('explicit_color', 200, { color: 0xabcdef }),
      ] },
      text('bare_canvas', 200),
      text('transparent_background', 400, { background: 0, backgroundOpacity: 0 }),
    ] } } };
    const config = { theme: { colors: { text: 0xf4efe6 } }, ui: document_ };
    SurfaceUi.state.gameConfigText = JSON.stringify(config);
    SurfaceUi.state.dirAssets = [];
    SurfaceUi.state.dirHandle = null;
    const unused = () => { throw new Error('This rendering check must not write a project'); };
    document.querySelector('#designer').appendChild(SurfaceUi.renderUiDesigner({
      read: () => document_, edit: unused, replace: unused, reload: () => document_, save: unused, preview: unused,
      exportShare: unused, importShare: unused, undo: unused, redo: unused, onStatus: message => { throw new Error(message); },
    }));
    window.surfacePlayer = SurfaceUi.createProjectUiDom({canvas:document.querySelector('canvas'), document:document_,
      theme:{colors:{text:0xf4efe6,panel:0x1b1d22,surface:0x272a31,line:0x5b6070,accent:0xd98b4a,textOnAccent:0x111111},typography:{uiSize:20},radius:{md:4,sm:2},skins:{}},
      fontFamily: () => 'sans-serif', imageUrl: () => undefined, onError: error => {throw error;},
    });
    window.surfacePlayer.show('title', {data:()=>undefined,read:()=>false,write:unused,bounds:()=>({min:0,max:1,step:1}),content:()=>[],select:()=>true,action:unused});
  });
  const colors = await page.evaluate(() => Object.fromEntries(['own_background','nested_background','explicit_color','bare_canvas','transparent_background'].map(id => [id, {
    canvas: getComputedStyle(document.querySelector(`.ui-designer-canvas [data-ui-node="${id}"]`)).color,
    player: getComputedStyle(document.querySelector(`[data-surdet-project-ui] [data-ui-node="${id}"]`)).color,
  }])));
  await fs.writeFile(path.join(output, 'colors.json'), JSON.stringify(colors, null, 2));
  for (const id of ['own_background', 'nested_background']) assert.equal(colors[id].canvas, colors[id].player, `${id}: project surface uses Player text colour`);
  assert.equal(colors.explicit_color.canvas, 'rgb(171, 205, 239)');
  assert.equal(colors.explicit_color.canvas, colors.explicit_color.player);
  assert.equal(colors.bare_canvas.canvas, 'rgb(18, 52, 86)', 'bare canvas retains the readable Editor colour');
  assert.equal(colors.transparent_background.canvas, 'rgb(18, 52, 86)', 'a fully transparent background is not a painted project surface');
  assert.deepEqual(errors, []);
  console.log(`PASS real designer and Player legacy background text ${JSON.stringify(colors)}`);
  await page.evaluate(() => { window.surfacePlayer.dispose(); SurfaceUi.disposeUiDesigner(); });
} finally { await browser.close(); }
