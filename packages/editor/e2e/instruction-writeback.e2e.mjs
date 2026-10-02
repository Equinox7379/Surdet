import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { build } from 'vite';
import { chromium } from 'playwright';

// Bundle the actual production modules and shared test cases in memory. There
// is no dev server, main.ts, project authority or write to a game directory.
const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  configFile: false,
  root: editorRoot,
  publicDir: false,
  logLevel: 'error',
  build: {
    write: false,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: path.join(editorRoot, 'test/support/instruction-writeback-cases.ts'),
      name: 'SurdetInstructionWriteback',
      formats: ['iife'],
    },
  },
});
const outputs = Array.isArray(result) ? result : [result];
const chunks = outputs.flatMap((output) => 'output' in output ? output.output : [])
  .filter((output) => output.type === 'chunk' && output.isEntry);
if (chunks.length !== 1) throw new Error('Expected one in-memory browser entry chunk');
let browser, server;
try {
  server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><title>Instruction writeback regression</title><body></body>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack ?? error.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: chunks[0].code });
  const results = await page.evaluate(() => window.SurdetInstructionWriteback.instructionWritebackCases.map((testCase) => {
    try { testCase.run(); return { name: testCase.name, ok: true }; }
    catch (error) { return { name: testCase.name, ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }));
  const failures = results.filter((entry) => !entry.ok);
  for (const entry of results) console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.error ? `: ${entry.error}` : ''}`);
  if (failures.length || errors.length) throw new Error(`${failures.length} case failures; browser errors: ${errors.join('; ')}`);

  // One actual browser input path in addition to the source/DOM event cases.
  await page.evaluate(() => {
    const fixture = window.SurdetInstructionWriteback.instructionWritebackCases.find(testCase => testCase.name === 'B01 keeps the modifier when editing the expression field');
    if (!fixture) throw new Error('Missing show instruction fixture');
    fixture.run();
  });
  const controls = page.locator('#editor .fields input');
  await controls.nth(0).fill('lynn:night');
  await controls.nth(1).fill('happy');
  const source = await page.locator('#editor .raw input').inputValue();
  if (source !== '@show lynn:night happy @ right') throw new Error(`Keyboard/fill path lost source: ${source}`);
  if (!await controls.nth(1).evaluate((element) => element === document.activeElement)) throw new Error('Typing lost focus');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(`Instruction writeback: ${results.length}/${results.length} cases and browser input/focus passed (in-memory project).`);
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}
