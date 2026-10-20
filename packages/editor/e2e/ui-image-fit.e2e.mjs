import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const entry = '\0ui-image-fit-fixture';
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', plugins: [{
  name: 'ui-image-fit-fixture',
  resolveId: id => id === 'ui-image-fit-fixture' || id.replaceAll('\\', '/') === `${root.replaceAll('\\', '/')}/ui-image-fit-fixture` ? entry : undefined,
  load: id => id === entry ? `export {renderUiDesigner,disposeUiDesigner} from ${JSON.stringify(path.join(root, 'packages/editor/src/ui-designer.ts'))};export {state} from ${JSON.stringify(path.join(root, 'packages/editor/src/state.ts'))};` : undefined,
}], build: { write: false, minify: false, lib: { entry: 'ui-image-fit-fixture', name: 'UiImageFit', formats: ['iife'] } } });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(value => value.output ?? []).filter(value => value.type === 'chunk' && value.isEntry);
assert.equal(chunks.length, 1);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await page.addStyleTag({ content: await fs.readFile(path.join(root, 'packages/editor/src/styles/config-workspace.css'), 'utf8') });
  await page.addScriptTag({ content: chunks[0].code });
  await page.evaluate(() => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw4kAAAAASUVORK5CYII='), value => value.charCodeAt(0));
    const file = new File([png], 'fit.png', { type: 'image/png' });
    UiImageFit.state.dirAssets = [{ kind: 'bg', key: 'fit', sourcePath: 'content/assets/bg/fit.png', isImage: true, handle: { getFile: async () => file } }];
    const document = { version: 1, pages: { title: { id: 'root', type: 'container', frame: { x: 0, y: 0, width: 1280, height: 720 }, children:
      ['contain', 'cover', 'fill', 'default'].map((fit, index) => ({ id: `fit-${fit}`, type: 'image', asset: 'fit', frame: { x: 20 + index * 220, y: 100, width: 200, height: 100 }, ...(fit === 'default' ? {} : { style: { imageFit: fit } }) })),
    } } };
    const designer = UiImageFit.renderUiDesigner({ read: () => document, edit: () => document, replace: () => {}, reload: () => document,
      save: async () => {}, preview: async () => {}, exportShare: async () => {}, importShare: async () => {}, undo: () => {}, redo: () => {}, onStatus: () => {} });
    window.document.body.appendChild(designer);
  });
  for (const mode of ['contain', 'cover', 'fill', 'default']) {
    const image = page.locator(`.ui-designer-canvas [data-ui-node="fit-${mode}"] img`);
    await image.waitFor({ state: 'visible' });
    await image.evaluate(image => image.decode());
    assert.equal(await image.evaluate(image => getComputedStyle(image).objectFit), mode === 'default' ? 'contain' : mode);
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => UiImageFit.disposeUiDesigner());
  await page.close();
  console.log('PASS UI designer: decoded images honor contain/cover/fill and the default mode');
} finally { await browser.close(); }
