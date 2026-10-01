import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// Real source modules, in-memory project. Full app/runtime is a separate test below.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({ configFile: false, root, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: path.join(root, 'test/support/v4-workbench-cases.ts'), name: 'SurdetV4Checks', formats: ['iife'] },
} });
const output = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output ?? []);
const chunks = output.filter((item) => item.type === 'chunk' && item.isEntry);
if (chunks.length !== 1) throw new Error('Expected one V4 test entry');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1792, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  // Preview session IDs use the real secure-context browser crypto API.
  const fixtureUrl = 'http://127.0.0.1/__surdet-workbench-checks';
  await page.route(fixtureUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' }));
  // This harness observes parent messages; the full app test runs the real player.
  // Serve a stable child document instead of racing an unavailable iframe URL.
  await page.route('http://127.0.0.1/preview.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  // Workers and any imported build resources must come from this exact build, including hashed names.
  for (const asset of output) {
    await page.route(new URL(asset.fileName, fixtureUrl).href, route => route.fulfill({
      contentType: asset.fileName.endsWith('.js') ? 'text/javascript' : asset.fileName.endsWith('.css') ? 'text/css' : 'application/octet-stream',
      body: asset.type === 'chunk' ? asset.code : typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source),
    }));
  }
  await page.goto(fixtureUrl);
  await page.addScriptTag({ content: chunks[0].code });
  const filter = process.argv[2];
  const results = await page.evaluate(async filter => {
    const results = [];
    for (const test of window.SurdetV4Checks.v4WorkbenchCases.filter(test => !filter || new RegExp(filter).test(test.name))) {
      try { await test.run(); results.push({ name: test.name, ok: true }); }
      catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    }
    if (results.length === 0) throw new Error('No matching workbench cases');
    return results;
  }, filter);
  results.forEach((result) => console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`));
  if (results.some((result) => !result.ok) || errors.length) throw new Error(JSON.stringify({ results: results.filter((result) => !result.ok), errors }));
  if (!filter) {
    await page.evaluate(() => window.SurdetV4Checks.mountV4Fixture());
    const dialogue = page.locator('.block[data-line="4"] .v4-dialogue-input');
    await dialogue.fill('实际浏览器输入，保留焦点。');
    if (!await dialogue.evaluate((node) => node === document.activeElement)) throw new Error('Input focus lost');
    const text = await page.evaluate(() => window.SurdetV4Checks.currentFixtureText());
    if (!text.includes('凛:实际浏览器输入，保留焦点。\r\n')) throw new Error('Real input did not reach source');
    if (errors.length) throw new Error(errors.join('\n'));
  }
  console.log(`V4 workbench: ${results.length}/${results.length} module cases${filter ? '' : ' plus real input/focus'} passed.`);
} finally { await browser?.close(); }
