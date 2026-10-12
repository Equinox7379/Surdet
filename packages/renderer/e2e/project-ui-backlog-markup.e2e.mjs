import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// The real shared Player feeds a work-authored backlog page; the default rows show the recorded
// static formatting. Only `backlog.markup` is parsed: speakers, variable values and the plain label
// stay literal, the label stays the row's accessible name and a voiced row still replays on click.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_BACKLOG_MARKUP_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-backlog-markup-'));
await fs.mkdir(output, { recursive: true });
const source = [
  '@scene intro',
  '<em><ruby=あめ>雨</ruby></em><wave>落下</wave><w=10>',
  '{name}：<b>{literal}</b>',
  '<color=accent><ruby=ひ>灯</ruby></color><color=#4fc3f7>亮</color><size=1.5>大</size><i>斜</i><em>强</em>\\<b>字面\\</b>',
  '@voice v1',
  '普通旁白',
  '@end',
].join('\n');
await fs.writeFile(path.join(output, 'index.html'), '<body style="margin:0"><div id="app"></div><script type="module" src="/main.ts"></script></body>');
await fs.writeFile(path.join(output, 'main.ts'), `
import { startPlayer } from '/@fs/${repo.replaceAll('\\', '/')}/examples/shared/player/player.ts';
await startPlayer({ id: 'backlog-markup-test', theme: { colors: { accent: 0xd04a8f } }, config: {
  title: '文字记录样式验证', entryScene: 'intro', player: { firstRunHint: '' },
  variables: {
    name: { type: 'string', initial: '<i>名字</i><img src=x onerror=window.pwned=1>' },
    literal: { type: 'string', initial: '<color=red>字面</color>' },
  },
  ui: { version: 1, pages: { backlog: { id: 'history', type: 'content', source: 'backlog', frame: { x: 30, y: 30, width: 1200, height: 650 } } } }
}, sceneFiles: { 'intro.gal': async () => ${JSON.stringify(source)} }, assetFiles: {}, fontFiles: {}, resolveSceneUrl: p => p });
window.ready = true;
`);
// Observe what the rows hand to the Player; the Player's own select (voice replay) still runs.
const observe = 'show(page, context) { if (page === "backlog" && !context.observed) { const select = context.select; context.observed = true;'
  + ' context.select = async (...args) => { const result = await select.apply(context, args); (window.selected ??= []).push({ source: args[0], item: JSON.parse(JSON.stringify(args[1])), result }); return result; }; }';
const server = await createServer({ root: output, configFile: false, cacheDir: path.join(output, '.vite'), logLevel: 'error',
  resolve: { alias: [{ find: /^@surdet\/renderer$/, replacement: path.join(repo, 'packages/renderer/src/index.ts') }] },
  plugins: [{ name: 'observe-backlog-select', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/renderer/src/project-ui-dom.ts')) return;
    assert.ok(code.includes('show(page, context) {'));
    return code.replace('show(page, context) {', observe);
  } }], server: { host: '127.0.0.1', fs: { allow: [repo, output] } } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
  assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
  for (let line = 0; line < 3; line++) await page.evaluate(() => window.surdetDebug.interp.advance());
  await page.keyboard.press('KeyL');
  const rows = page.locator('[data-surdet-project-ui] [data-ui-item]');
  await rows.nth(3).waitFor();
  assert.equal(await rows.count(), 4);
  await page.screenshot({ path: path.join(output, 'backlog-markup.png') });

  // The accessibility tree is the one plain rows had before: recorded label (+ description), no ruby readings.
  assert.equal(await page.locator('[data-surdet-project-ui]').ariaSnapshot(), [
    '- button "雨落下" [disabled]',
    '- button "<i>名字</i><img src=x onerror=window.pwned=1>：<color=red>字面</color>" [disabled]',
    '- button "灯亮大斜强<b>字面</b>" [disabled]',
    '- button "普通旁白 点击重播语音"',
    '- alert',
  ].join('\n'));
  const rowsInfo = await page.evaluate(() => [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-item]')].map(row => {
    const shown = row.querySelector('[data-ui-backlog-text]');
    const styleOf = element => { const style = getComputedStyle(element); return { weight: style.fontWeight, italic: style.fontStyle, color: style.color, size: style.fontSize, emphasis: style.textEmphasisStyle }; };
    const visible = node => node.nodeType === Node.TEXT_NODE ? node.data : node.localName === 'rt' ? '' : [...node.childNodes].map(visible).join('');
    return {
      id: row.dataset.uiItem, disabled: row.getAttribute('aria-disabled'), hidden: shown?.getAttribute('aria-hidden'),
      visible: shown ? visible(shown) : null, tags: [...row.querySelectorAll('*')].map(element => element.localName),
      base: styleOf(shown), animations: row.getAnimations({ subtree: true }).length,
      pieces: [...shown.childNodes].map(node => node.nodeType === Node.TEXT_NODE ? { text: node.data }
        : { tag: node.localName, text: visible(node), style: styleOf(node),
          marks: [node, ...node.querySelectorAll('span')].filter(element => getComputedStyle(element).textEmphasisStyle !== 'none').map(visible),
          ruby: [...node.querySelectorAll('rt')].map(rt => ({ text: rt.textContent, emphasis: getComputedStyle(rt).textEmphasisStyle, color: getComputedStyle(rt).color })) }),
    };
  }));
  await fs.writeFile(path.join(output, 'rows.json'), JSON.stringify(rowsInfo, null, 2));
  const [rain, named, colors, plain] = rowsInfo;
  for (const row of rowsInfo) {
    assert.equal(row.hidden, 'true');
    assert.equal(row.animations, 0, 'history never replays motion');
    assert.ok(row.tags.every(tag => ['span', 'small', 'ruby', 'rt'].includes(tag)), `only controlled elements: ${row.tags}`);
  }
  // Static ruby and emphasis survive; <wave> and <w> were already removed from the record.
  assert.equal(rain.visible, '雨落下');
  assert.deepEqual(rain.pieces.map(piece => piece.text), ['雨', '落下']);
  assert.equal(rain.pieces[0].tag, 'ruby');
  assert.deepEqual(rain.pieces[0].marks, ['雨'], 'emphasis dots on the ruby base');
  assert.deepEqual(rain.pieces[0].ruby, [{ text: 'あめ', emphasis: 'none', color: rain.base.color }]);
  // Speaker and variable values are literal text: no italic, no image, no red.
  assert.equal(named.visible, '<i>名字</i><img src=x onerror=window.pwned=1>：<color=red>字面</color>');
  assert.deepEqual(named.pieces[0], { text: '<i>名字</i><img src=x onerror=window.pwned=1>：' });
  assert.equal(named.pieces[1].text, '<color=red>字面</color>');
  assert.equal(named.pieces[1].style.weight, '700');
  assert.equal(named.pieces[1].style.color, named.base.color);
  assert.equal(named.base.weight, '500');
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  // Theme and literal colours, relative size, italic; escaped tags stay text.
  assert.equal(colors.visible, '灯亮大斜强<b>字面</b>');
  assert.deepEqual(colors.pieces.map(piece => piece.text), ['灯', '亮', '大', '斜', '强', '<b>字面</b>']);
  assert.equal(colors.pieces[0].style.color, 'rgb(208, 74, 143)');
  assert.deepEqual(colors.pieces[0].ruby, [{ text: 'ひ', emphasis: 'none', color: 'rgb(208, 74, 143)' }], 'the reading takes the base colour');
  assert.deepEqual(colors.pieces[0].marks, []);
  assert.equal(colors.pieces[1].style.color, 'rgb(79, 195, 247)');
  assert.equal(parseFloat(colors.pieces[2].style.size), parseFloat(colors.base.size) * 1.5);
  assert.equal(colors.pieces[3].style.italic, 'italic');
  assert.deepEqual(colors.pieces[4].marks, ['强']);
  assert.equal(colors.pieces[5].tag, undefined, 'escaped tag is plain text, not bold');
  // Emphasis dots are actually painted, including on a ruby base: hiding only the dots (same layout) changes the pixels.
  for (const index of [0, 2]) {
    const before = await rows.nth(index).screenshot();
    const marked = await page.evaluate(index => {
      const shown = document.querySelectorAll('[data-surdet-project-ui] [data-ui-backlog-text]')[index];
      const marks = [...shown.querySelectorAll('span')].filter(span => getComputedStyle(span).textEmphasisStyle !== 'none');
      for (const span of marks) span.style.setProperty('text-emphasis-color', 'transparent');
      return marks.length;
    }, index);
    assert.equal(marked, 1);
    assert.equal(before.equals(await rows.nth(index).screenshot()), false, `row ${index} paints its emphasis dots`);
  }
  // A record without markup is shown as its plain text, and its voice row still replays.
  assert.deepEqual(plain.pieces, [{ text: '普通旁白' }]);
  assert.equal(plain.disabled, 'false');
  assert.equal(rain.disabled, 'true');
  await rows.nth(0).click({ force: true });
  assert.equal(await page.evaluate(() => window.selected?.length ?? 0), 0, 'a row without voice stays inert');
  await rows.nth(3).click();
  await page.waitForFunction(() => window.selected?.length === 1);
  const [selected] = await page.evaluate(() => window.selected);
  assert.equal(selected.source, 'backlog');
  assert.equal(selected.item.id, '3');
  assert.equal(selected.item.label, '普通旁白');
  assert.equal(selected.item.backlog.voice, 'v1');
  assert.equal(selected.result, true);

  // Loading earlier history re-renders the rows from the actual records.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-surdet-project-ui] [data-ui-item]')?.checkVisibility());
  assert.equal(await page.evaluate(() => window.__surdetDebug.quickLoad()), true);
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-item]')].filter(row => row.checkVisibility()).length === 1);
  assert.equal(await page.getByRole('button', { name: '雨落下', exact: true }).count(), 1);
  assert.equal(await page.locator('[data-surdet-project-ui] [data-ui-item] rt').textContent(), 'あめ');
  assert.deepEqual(errors, []);
  console.log('PASS custom backlog rows: static ruby/emphasis/colour/size/italic/bold, literal speaker and variables, unchanged accessibility tree, voice select, load re-render');
} finally { await browser?.close(); await server.close(); }
