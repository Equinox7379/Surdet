import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-project-ui-backup-'));
const result = await build({ root: root, configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: path.join(root, 'packages/renderer/src/project-ui-dom.ts'), name: 'AuditUi', formats: ['iife'] },
} });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).filter(item => item.type === 'chunk' && item.isEntry);
assert.equal(chunks.length, 1);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><body style="margin:0"><canvas width="1280" height="720"></canvas></body>');
  await page.addScriptTag({ content: chunks[0].code });
  await page.evaluate(() => {
    window.auditSelections = [];
    window.auditUi = AuditUi.createProjectUiDom({
      canvas: document.querySelector('canvas'),
      document: { version: 1, pages: { 'save-load': { id: 'slots', type: 'content', source: 'save-slots', frame: { x: 24, y: 24, width: 1000, height: 500 } } } },
      theme: { colors: { text: 0x17222c, panel: 0xffffff, surface: 0xeeeeee, line: 0x446688 }, typography: { uiSize: 20 }, radius: { md: 4, sm: 2 }, skins: {} },
      fontFamily: () => 'Arial', imageUrl: () => undefined, onError: error => { throw error; },
    });
    window.auditContext = {
      mode: 'load', data: () => undefined, read: () => undefined, write: () => {}, bounds: () => ({ min: 0, max: 1, step: 1 }),
      content: () => [
        { id: '1', label: '坏主档', disabled: true, empty: false, readError: '存档损坏', backupAvailable: true },
        { id: '2', label: '仅有好备份', disabled: true, empty: true, backupAvailable: true },
      ],
      select: async (source, item, restore) => { window.auditSelections.push({ source, id: item.id, restore }); }, action: () => {},
    };
    window.auditUi.show('save-load', window.auditContext);
  });
  const counts = await page.evaluate(() => [...document.querySelectorAll('[data-ui-item]')].map(row => ({ id: row.dataset.uiItem, restores: row.querySelectorAll('button').length })));
  console.log(JSON.stringify({ counts, errors }));
  await page.screenshot({ path: path.join(output, 'backup-only.png') });
  assert.deepEqual(counts, [{ id: '1', restores: 1 }, { id: '2', restores: 1 }]);
  await page.locator('[data-ui-item="2"] button').focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.auditSelections), [{ source: 'save-slots', id: '2', restore: true }]);
  await page.evaluate(() => window.auditUi.show('save-load', { ...window.auditContext, mode: 'save' }));
  assert.equal(await page.locator('[data-ui-item] button').count(), 0);
  await page.evaluate(() => window.auditUi.dispose());
  assert.equal(await page.locator('[data-surdet-project-ui]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS custom UI backup-only recovery, keyboard selection, save mode, disposal / ${output}`);
} finally { await browser.close(); }
