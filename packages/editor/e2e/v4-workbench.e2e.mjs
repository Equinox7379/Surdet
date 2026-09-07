import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// Real source modules, in-memory project. Full app/runtime is a separate test below.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({ configFile: false, root, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: path.join(root, 'test/support/v4-workbench-cases.ts'), name: 'SurdetV4Checks', formats: ['iife'] },
} });
const chunks = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output ?? []).filter((item) => item.type === 'chunk' && item.isEntry);
if (chunks.length !== 1) throw new Error('Expected one V4 test entry');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1792, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  await page.addScriptTag({ content: chunks[0].code });
  const results = await page.evaluate(async () => {
    const results = [];
    for (const test of window.SurdetV4Checks.v4WorkbenchCases) {
      try { await test.run(); results.push({ name: test.name, ok: true }); }
      catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    }
    return results;
  });
  results.forEach((result) => console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`));
  if (results.some((result) => !result.ok) || errors.length) throw new Error(JSON.stringify({ results: results.filter((result) => !result.ok), errors }));
  await page.evaluate(() => window.SurdetV4Checks.mountV4Fixture());
  const dialogue = page.locator('.block[data-line="4"] .v4-dialogue-input');
  await dialogue.fill('实际浏览器输入，保留焦点。');
  if (!await dialogue.evaluate((node) => node === document.activeElement)) throw new Error('Input focus lost');
  const text = await page.evaluate(() => window.SurdetV4Checks.currentFixtureText());
  if (!text.includes('凛:实际浏览器输入，保留焦点。\r\n')) throw new Error('Real input did not reach source');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`V4 workbench: ${results.length}/${results.length} module cases plus real input/focus passed.`);
} finally { await browser?.close(); }
