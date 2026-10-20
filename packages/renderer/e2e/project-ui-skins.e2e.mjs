import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_SKINS_E2E_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-project-ui-skins-'));
await fs.mkdir(output, { recursive: true });
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: path.join(root, 'packages/renderer/src/project-ui-dom.ts'), name: 'SkinnedUi', formats: ['iife'] },
} });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).filter(item => item.type === 'chunk' && item.isEntry);
assert.equal(chunks.length, 1);

const frame = (x, y, width, height) => ({ x, y, width, height });
const literal = value => ({ kind: 'literal', value });
// Synthetic public fixtures only; the same resolved resource serves every button family.
const skinUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="48"><rect x="4" y="4" width="136" height="40" rx="12" fill="#ded0aa" stroke="#795c36" stroke-width="4"/></svg>');
const uiDocument = { version: 1, pages: { gallery: {
  id: 'page', type: 'container', frame: frame(0, 0, 1280, 720), style: { fontSize: 22 }, children: [
    { id: 'authored', type: 'button', frame: frame(24, 20, 240, 54), text: literal('自定义按钮'), style: { background: 0x778899 }, action: { kind: 'close' } },
    { id: 'disabled', type: 'button', frame: frame(300, 20, 240, 54), text: literal('禁用按钮'), enabledWhen: 'false', action: { kind: 'close' } },
    { id: 'tabs', type: 'tabs', style: { color: 0x213943 }, frame: frame(24, 110, 1200, 550), children: [
      { id: 'settings', type: 'content', source: 'settings', style: { color: 0x213943 }, tab: '设置', frame: frame(0, 0, 1100, 300) },
      { id: 'slots', type: 'content', source: 'save-slots', tab: '存档', frame: frame(0, 0, 1100, 300) },
      { id: 'pictures', type: 'content', source: 'gallery-cgs', tab: '图片模板', frame: frame(0, 0, 1100, 300), children: [
        { id: 'card', type: 'container', frame: frame(0, 0, 1000, 90), children: [
          { id: 'card-image', type: 'image', asset: 'card', frame: frame(0, 0, 1000, 90) },
          { id: 'card-label', type: 'text', text: { kind: 'data', field: 'label' }, frame: frame(24, 8, 600, 36) },
          { id: 'card-description', type: 'text', text: { kind: 'data', field: 'description' }, frame: frame(24, 46, 600, 36) },
        ] },
      ] },
      { id: 'plain', type: 'content', source: 'gallery-terms', tab: '文字模板', frame: frame(0, 0, 1100, 300), children: [
        { id: 'plain-label', type: 'text', text: { kind: 'data', field: 'label' }, frame: frame(0, 0, 600, 54) },
      ] },
      { id: 'direct-picture', type: 'content', source: 'gallery-profiles', tab: '直接图片', frame: frame(0, 0, 1100, 300), children: [
        { id: 'direct-image', type: 'image', asset: 'card', frame: frame(0, 0, 1000, 90) },
      ] },
    ] },
  ],
} } };

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['available', 'absent', 'unresolved']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.setContent('<!doctype html><body style="margin:0"><canvas width="1280" height="720"></canvas></body>');
    await page.addScriptTag({ content: chunks[0].code });
    await page.evaluate(async ({ uiDocument, skinUrl, mode }) => {
      const image = new Image(); image.src = skinUrl; await image.decode();
      window.skinState = { readAloud: true, textScale: 1, actions: [], selections: [] };
      window.skinUi = SkinnedUi.createProjectUiDom({
        canvas: document.querySelector('canvas'), document: uiDocument,
        theme: { colors: { text: 0xf4efe6, panel: 0x1b1d22, surface: 0x272a31, line: 0x5b6070, accent: 0xd98b4a, textOnAccent: 0x111111, scrim: 0x111111 }, typography: { uiSize: mode === 'unresolved' ? 34 : 22 }, radius: { md: 4, sm: 2 }, skins: mode === 'absent' ? {} : { buttonSkin: 'button' } },
        fontFamily: () => 'Arial', imageUrl: key => key === 'button' && mode !== 'available' ? undefined : skinUrl,
        onError: error => { throw error; },
      });
      window.skinContext = {
        mode: 'load', data: () => undefined, read: name => window.skinState[name], write: () => {}, bounds: () => ({ min: 0, max: 2, step: 0.1 }),
        content: source => source === 'settings' ? [
          { id: 'readAloud', label: '朗读', value: window.skinState.readAloud ? '开启' : '关闭', ...(mode === 'available' ? { description: window.skinState.readAloud ? '开启' : '关闭' } : {}) },
          { id: 'textScale', label: '文字大小', value: window.skinState.textScale, ...(mode === 'available' ? { description: `${Math.round(window.skinState.textScale * 100)}%` } : {}) },
        ] : source === 'save-slots' ? [
          { id: 'bad', label: '损坏主档', disabled: true, backupAvailable: true, readError: '损坏' },
          { id: 'empty', label: '仅备份', disabled: true, empty: true, backupAvailable: true },
        ] : [{ id: 'one', label: '第一项', description: '第一项的真实说明' }, { id: 'two', label: '第二项', description: '第二项的真实说明' }],
        select: (source, item, restore) => { window.skinState.selections.push({ source, id: item.id, restore }); },
        action: action => {
          window.skinState.actions.push(action);
          if (action.kind !== 'setting-step') return;
          if (action.name === 'readAloud') window.skinState.readAloud = !window.skinState.readAloud;
          else window.skinState.textScale = Math.round((window.skinState.textScale + action.direction * 0.1) * 10) / 10;
        },
      };
      window.skinUi.show('gallery', window.skinContext);
    }, { uiDocument, skinUrl, mode });
    const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const styles = locator => locator.evaluateAll(elements => elements.map(element => {
      const css = getComputedStyle(element);
      return { text: element.textContent, image: css.backgroundImage, background: css.backgroundColor, color: css.color,
        borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => css[`border${side}Width`]), size: css.backgroundSize };
    }));
    const buttons = await styles(page.locator('[data-surdet-project-ui] button'));
    const rows = {};
    for (const id of ['settings', 'pictures', 'plain', 'direct-picture']) rows[id] = await styles(page.locator(`[data-ui-node="${id}"] > [data-ui-item]`));
    await page.evaluate(() => { window.skinConfirmation = window.skinUi.confirm('测试确认'); });
    const confirmation = await styles(page.getByRole('dialog').getByRole('button'));
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => window.skinConfirmation), false);
    await page.evaluate(() => window.skinUi.showGalleryImage('cg', '测试图片'));
    const close = await styles(page.getByRole('button', { name: '关闭图片', exact: true }));
    for (const button of [...confirmation, ...close]) assert.equal(button.color, 'rgb(244, 239, 230)', 'auxiliary controls use the configured theme text color');
    await page.getByRole('button', { name: '关闭图片', exact: true }).click();
    assert.equal(await page.locator('[data-ui-viewer]').count(), 0);
    const observed = { mode, buttons, confirmation, close, rows };
    await fs.writeFile(path.join(output, `${mode}-styles.json`), JSON.stringify(observed, null, 2));
    await page.screenshot({ path: path.join(output, `${mode}-settings.png`) });

    for (const button of [...buttons, ...confirmation, ...close]) {
      if (mode === 'available') {
        assert(button.image.includes(skinUrl), `${mode}: ${button.text} uses the resolved button skin, got ${button.image}`);
        assert.equal(button.background, 'rgba(0, 0, 0, 0)', `${button.text}: skin has no solid fill`);
        assert.deepEqual(button.borders, ['0px', '0px', '0px', '0px'], `${button.text}: skin has no rectangular border`);
        assert.equal(button.size, '100% 100%');
      } else {
        assert.equal(button.image, 'none', `${mode}: no image is invented`);
        assert.notEqual(button.background, 'rgba(0, 0, 0, 0)', `${mode}: ${button.text} keeps its fill`);
        assert(button.borders.every(width => parseFloat(width) > 0), `${mode}: ${button.text} keeps its border`);
      }
    }
    if (mode === 'available') for (const row of rows.settings) {
      assert.equal(row.image, 'none', 'settings let the generated page show through rather than stretching a button image');
      assert.equal(row.background, 'rgba(0, 0, 0, 0)');
      assert.deepEqual(row.borders, ['0px', '0px', '0px', '0px']);
    }
    if (mode !== 'available') {
      assert.equal(buttons.find(button => button.text === '自定义按钮').background, 'rgb(119, 136, 153)');
      assert.equal(buttons.find(button => button.text === '设置').background, 'rgb(39, 42, 49)');
      assert.equal(buttons.find(button => button.text === '开启').background, 'rgb(217, 139, 74)');
    }
    for (const id of ['pictures', 'direct-picture']) for (const row of rows[id]) {
      assert.equal(row.background, 'rgba(0, 0, 0, 0)', `${id}: image template has no striping`);
      assert.equal(row.borders[2], '0px', `${id}: image template has no underline`);
    }
    for (const id of mode === 'available' ? ['plain'] : ['settings', 'plain']) {
      assert.deepEqual(rows[id].map(row => row.background), ['rgb(27, 29, 34)', 'rgb(39, 42, 49)'], `${id}: ordinary rows retain striping`);
      assert(rows[id].every(row => row.borders[2] === '1px'), `${id}: ordinary rows retain underlines`);
    }
    const tabs = await page.getByRole('tab').evaluateAll(elements => elements.map(element => {
      const css = getComputedStyle(element), bar = element.parentElement.getBoundingClientRect(), box = element.getBoundingClientRect();
      const row = document.createRange(); row.selectNodeContents(element); const text = row.getBoundingClientRect();
      return { family: css.fontFamily, size: css.fontSize, barHeight: bar.height,
        selected: element.getAttribute('aria-selected') === 'true', decoration: css.textDecorationLine,
        fits: box.top >= bar.top && box.bottom <= bar.bottom && text.top >= box.top && text.bottom <= box.bottom };
    }));
    assert(tabs.every(tab => tab.family === 'Arial' && tab.size === '22px' && tab.barHeight === 38 && tab.fits), `theme tab text fits its fixed bar: ${JSON.stringify(tabs)}`);
    assert.equal(tabs.filter(tab => tab.selected).length, 1);
    assert(tabs.every(tab => tab.decoration.includes('underline') === tab.selected), 'the selected tab has a visible marker, not only an ARIA state');
    assert(await page.getByRole('tab', { name: '设置', exact: true }).evaluate(element => getComputedStyle(element).color === 'rgb(33, 57, 67)'), 'tabs honor the authored text color on pale artwork');
    assert(await page.locator('[data-ui-item="readAloud"] > span').evaluate(element => getComputedStyle(element).color === 'rgb(33, 57, 67)'), 'content rows honor the authored text color');
    const settingGeometry = await page.locator('[data-ui-node="settings"] > [data-ui-item]').evaluateAll(elements => elements.map(element => {
      const row = element.getBoundingClientRect(), css = getComputedStyle(element), title = element.querySelector(':scope > span'), value = element.querySelector(':scope > small');
      const titleBox = title.getBoundingClientRect(), valueBox = value?.getBoundingClientRect(), controls = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return { width: row.width, height: row.height, cursor: css.cursor, disabled: element.getAttribute('aria-disabled'),
        titleWeight: getComputedStyle(title).fontWeight, singleLine: !!valueBox && Math.abs((titleBox.top + titleBox.bottom) / 2 - (valueBox.top + valueBox.bottom) / 2) <= 1,
        separated: !!valueBox && titleBox.right <= valueBox.left && valueBox.right + 16 <= Math.min(...controls.map(box => box.left)),
        controlsFit: [...element.querySelectorAll('button')].every(button => { const box = button.getBoundingClientRect(); return box.left >= row.left && box.right <= row.right && box.top >= row.top && box.bottom <= row.bottom; }) };
    }));
    assert(settingGeometry.every(row => row.width === 1100 && row.height === 62 && row.cursor === 'pointer' && row.disabled === 'false' && row.controlsFit), `settings retain their row geometry and controls stay inside: ${JSON.stringify(settingGeometry)}`);
    if (mode === 'available') assert(settingGeometry.every(row => row.singleLine && row.separated && row.titleWeight === '400'), `settings label/value share a line and reserve control space: ${JSON.stringify(settingGeometry)}`);
    else assert(settingGeometry.every(row => row.titleWeight === '600'), 'unskinned setting labels retain their existing weight');

    const toggle = page.getByRole('switch', { name: '朗读' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    if (mode === 'available') {
      assert(await toggle.evaluate(element => getComputedStyle(element).color === getComputedStyle(element.parentElement).color),
        'a skinned enabled switch uses the ordinary text color rather than text intended for an accent fill');
    }
    await toggle.focus(); await page.keyboard.press('Space'); await nextFrame();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(await toggle.innerText(), '关闭');
    assert(await toggle.evaluate(element => document.activeElement === element), 'switch retains focus after row refresh');
    const [refreshedSwitch] = await styles(toggle);
    assert.equal(refreshedSwitch.image.includes(skinUrl), mode === 'available');
    if (mode === 'available') {
      const refreshedRows = await styles(page.locator('[data-ui-node="settings"] > [data-ui-item]'));
      assert(refreshedRows.every(row => row.image === 'none' && row.background === 'rgba(0, 0, 0, 0)' && row.borders.every(width => width === '0px')), 'settings stay transparent without a row image after refresh');
      assert.equal(await page.locator('[data-ui-item="readAloud"] > small').innerText(), '关闭');
    }
    for (const [label, expected] of [['文字大小增加', 1.1], ['文字大小减少', 1]]) {
      const step = page.getByRole('button', { name: label, exact: true });
      await step.focus(); await page.keyboard.press('Enter'); await nextFrame();
      assert.equal(await page.evaluate(() => window.skinState.textScale), expected);
      if (mode === 'available') assert.equal(await page.locator('[data-ui-item="textScale"] > small').innerText(), `${Math.round(expected * 100)}%`);
      assert(await step.evaluate(element => document.activeElement === element), `${label} retains focus after row refresh`);
      const [style] = await styles(step);
      assert.equal(style.image.includes(skinUrl), mode === 'available', 'refreshed control retains the same skin policy');
    }
    assert.deepEqual(await page.evaluate(() => window.skinState.actions), [
      { kind: 'setting-step', name: 'readAloud', direction: 1 },
      { kind: 'setting-step', name: 'textScale', direction: 1 },
      { kind: 'setting-step', name: 'textScale', direction: -1 },
    ]);
    const disabled = page.getByRole('button', { name: '禁用按钮' });
    assert(await disabled.isDisabled());
    assert.equal(await disabled.evaluate(element => getComputedStyle(element).opacity), '0.45');
    await disabled.evaluate(element => element.click());
    assert.equal(await page.evaluate(() => window.skinState.actions.length), 3, 'disabled button dispatches no action');
    await page.getByRole('button', { name: '自定义按钮' }).click();
    assert.deepEqual(await page.evaluate(() => window.skinState.actions.at(-1)), { kind: 'close' });

    const slotsTab = page.getByRole('tab', { name: '存档', exact: true });
    await slotsTab.focus(); await page.keyboard.press('Enter');
    assert.equal(await slotsTab.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('tab', { name: '设置', exact: true }).getAttribute('aria-selected'), 'false');
    assert.equal(await toggle.isVisible(), false);
    const backup = page.locator('[data-ui-item="empty"]').getByRole('button', { name: '恢复备份并读取' });
    assert(await backup.isVisible());
    assert.equal(await backup.evaluate(element => element.disabled), false, 'the recovery button itself remains enabled inside a disabled primary row');
    await backup.focus(); await page.keyboard.press('Enter'); await nextFrame();
    assert.deepEqual(await page.evaluate(() => window.skinState.selections), [{ source: 'save-slots', id: 'empty', restore: true }]);
    await page.screenshot({ path: path.join(output, `${mode}-backup.png`) });

    await page.getByRole('tab', { name: '图片模板', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: '图片模板', exact: true }).getAttribute('aria-selected'), 'true');
    const card = page.locator('[data-ui-node="pictures"] img').first();
    assert(await card.isVisible());
    assert(await card.evaluate(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator('[data-ui-node="pictures"] [data-ui-node="card-label"]').first().innerText(), '第一项');
    assert.equal(await page.locator('[data-ui-node="pictures"] [data-ui-node="card-description"]').first().innerText(), '第一项的真实说明');
    await page.screenshot({ path: path.join(output, `${mode}-image-template.png`) });
    await page.evaluate(() => { window.skinConfirmation = window.skinUi.confirm('测试确认'); });
    await page.getByRole('button', { name: '确认', exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.skinConfirmation), true);
    await page.evaluate(() => {
      window.skinUi.show('gallery', { ...window.skinContext, mode: 'save' });
    });
    assert.equal(await page.locator('[data-ui-node="slots"] button').count(), 0, 'save mode never offers backup loading');
    if (mode !== 'available') {
      await page.evaluate(() => window.skinUi.show('gallery', { ...window.skinContext, content: source => window.skinContext.content(source).map(item => source === 'settings' ? { ...item, description: String(item.value) } : item) }));
      const legacy = await page.locator('[data-ui-node="settings"] > [data-ui-item]').evaluateAll(rows => rows.map(row => {
        const label = row.querySelector(':scope > span').getBoundingClientRect(), value = row.querySelector(':scope > small').getBoundingClientRect(), css = getComputedStyle(row);
        return { below: value.top >= label.bottom, image: css.backgroundImage, background: css.backgroundColor, border: css.borderBottomWidth };
      }));
      assert(legacy.every(row => row.below && row.image === 'none' && row.border === '1px'), 'unskinned descriptions retain the original second line and row borders');
      assert.deepEqual(legacy.map(row => row.background), ['rgb(27, 29, 34)', 'rgb(39, 42, 49)']);
    }
    await page.evaluate(() => { window.skinConfirmation = window.skinUi.confirm('销毁中的确认'); window.skinUi.dispose(); window.skinUi.refresh(); window.skinUi.resize(); });
    assert.equal(await page.evaluate(() => window.skinConfirmation), false, 'dispose resolves an outstanding confirmation');
    await nextFrame();
    assert.equal(await page.locator('[data-surdet-project-ui]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: computed image/fill/borders; tabs; setting actions and focus; backup; image templates; dialogs; disabled; dispose`);
    await page.close();
  }
  const gridPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const gridErrors = [];
  gridPage.on('pageerror', error => gridErrors.push(error.message));
  gridPage.on('requestfailed', request => gridErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await gridPage.setContent('<!doctype html><body style="margin:0"><canvas width="1280" height="720"></canvas></body>');
  await gridPage.addScriptTag({ content: chunks[0].code });
  await gridPage.evaluate(({ skinUrl }) => {
    const frame = (x, y, width, height) => ({ x, y, width, height });
    const card = id => ({ id, type: 'container', frame: frame(8, 0, 464, 232), children: [
      { id: `${id}-image`, type: 'image', asset: 'card', frame: frame(0, 0, 464, 232), style: { imageFit: 'fill' } },
      { id: `${id}-label`, type: 'text', frame: frame(24, 112, 416, 36), text: { kind: 'data', field: 'label' }, style: { fontSize: 22 } },
      { id: `${id}-description`, type: 'text', frame: frame(24, 152, 416, 64), text: { kind: 'data', field: 'description' }, style: { fontSize: 20 } },
    ] });
    window.gridItems = Array.from({ length: 8 }, (_, index) => ({ id: `cg${index}`, label: `图片 ${index + 1}`, description: `图片 ${index + 1} 的真实说明`, disabled: index === 0 }));
    window.gridSelections = [];
    const document_ = { version: 1, pages: { gallery: { id: 'grid-page', type: 'container', frame: frame(0, 0, 1280, 720), children: [
      { id: 'grid-tabs', type: 'tabs', frame: frame(40, 40, 1000, 500), children: [
        { id: 'ending-grid', type: 'content', source: 'gallery-endings', tab: '结局', frame: frame(0, 0, 1000, 420),
          style: { columns: 2, border: { width: 2, color: 0x446688, opacity: 1 }, padding: { top: 10, right: 10, bottom: 10, left: 10 } }, children: [card('ending-card')] },
        { id: 'cg-grid', type: 'content', source: 'gallery-cgs', tab: '图片', frame: frame(0, 0, 1000, 420), style: { columns: 2 }, children: [card('cg-card')] },
      ] },
      { id: 'default-fit', type: 'image', asset: 'card', frame: frame(1080, 80, 144, 96) },
      { id: 'cover-fit', type: 'image', asset: 'card', frame: frame(1080, 200, 144, 96), style: { imageFit: 'cover' } },
    ] } } };
    window.gridUi = SkinnedUi.createProjectUiDom({
      canvas: document.querySelector('canvas'), document: document_,
      theme: { colors: { text: 0x17222c, panel: 0xffffff, surface: 0xeeeeee, line: 0x446688, accent: 0x446688 }, typography: { uiSize: 22 }, spacing: { md: 16 }, radius: { md: 4, sm: 2 }, skins: { buttonSkin: 'button' } },
      fontFamily: () => 'Arial', imageUrl: () => skinUrl, onError: error => { throw error; },
    });
    window.gridContext = {
      data: () => undefined, read: () => undefined, write: () => {}, bounds: () => ({ min: 0, max: 1, step: 1 }), action: () => {},
      content: source => source === 'gallery-endings'
        ? window.gridItems.map((item, index) => ({ ...item, id: `ending${index}`, label: `结局 ${index + 1}`, disabled: true })) : window.gridItems,
      select: (source, item) => { window.gridSelections.push({ source, id: item.id }); },
    };
    window.gridUi.show('gallery', window.gridContext);
  }, { skinUrl });
  const grid = gridPage.locator('[data-ui-node="ending-grid"]');
  const layout = await grid.evaluate(element => {
    const bounds = element.getBoundingClientRect(), css = getComputedStyle(element);
    return { display: css.display, columns: css.gridTemplateColumns, gap: css.gap, outerWidth: bounds.width, outerHeight: bounds.height, width: element.clientWidth, scrollWidth: element.scrollWidth,
      height: element.clientHeight, scrollHeight: element.scrollHeight,
      rows: [...element.children].map(row => {
        const box = row.getBoundingClientRect();
        return { id: row.dataset.uiItem, x: box.left - bounds.left, y: box.top - bounds.top, width: box.width, height: box.height,
          tabIndex: row.tabIndex, disabled: row.getAttribute('aria-disabled'),
          text: row.querySelector('[data-ui-node="ending-card-label"]').textContent,
          description: row.querySelector('[data-ui-node="ending-card-description"]').textContent,
          fit: getComputedStyle(row.querySelector('img')).objectFit,
          textFits: [...row.querySelectorAll('[data-ui-node$="label"],[data-ui-node$="description"]')].every(text => {
            const rect = text.getBoundingClientRect(); return rect.left >= box.left && rect.right <= box.right && text.scrollWidth <= text.clientWidth && text.scrollHeight <= text.clientHeight;
          }),
        };
      }),
    };
  });
  await fs.writeFile(path.join(output, 'grid-layout.json'), JSON.stringify(layout, null, 2));
  await gridPage.screenshot({ path: path.join(output, 'grid-cards.png') });
  assert.equal(layout.display, 'grid');
  assert.equal(layout.outerWidth, 976, 'U1 border and padding are removed once before laying out the two columns');
  assert.equal(layout.outerHeight, 396);
  assert.equal(layout.columns.split(' ').length, 2);
  assert.equal(layout.gap, '16px');
  assert.equal(layout.rows.length, 8);
  assert.equal(new Set(layout.rows.map(row => row.id)).size, 8, 'each item renders exactly once');
  assert(layout.scrollWidth <= layout.width, 'two-column cards never introduce horizontal scrolling');
  assert(layout.scrollHeight > layout.height, 'all four card rows contribute to scroll height');
  for (const [index, row] of layout.rows.entries()) {
    assert.equal(row.text, `结局 ${index + 1}`);
    assert.equal(row.description, `图片 ${index + 1} 的真实说明`);
    assert.equal(row.fit, 'fill');
    assert(row.textFits, 'real labels and descriptions stay inside the card');
    assert.equal(row.tabIndex, -1); assert.equal(row.disabled, 'true');
    assert(Math.abs(row.x - layout.rows[index % 2].x) < 0.1, 'each item uses its own column');
    if (index % 2) {
      assert(Math.abs(row.y - layout.rows[index - 1].y) < 0.1, 'each pair shares a row');
      assert(Math.abs(row.x - layout.rows[index - 1].x - layout.rows[index - 1].width - 16) < 0.1);
    }
    if (index >= 2) assert(Math.abs(row.y - layout.rows[index - 2].y - layout.rows[index - 2].height - 16) < 0.1, 'row index includes the theme gap');
  }
  assert.equal(await gridPage.locator('[data-ui-node="default-fit"] img').evaluate(image => getComputedStyle(image).objectFit), 'contain');
  assert.equal(await gridPage.locator('[data-ui-node="cover-fit"] img').evaluate(image => getComputedStyle(image).objectFit), 'cover');
  await grid.locator('[data-ui-item="ending0"]').focus(); await gridPage.keyboard.press('Enter');
  assert.deepEqual(await gridPage.evaluate(() => window.gridSelections), [], 'readonly endings do not dispatch a selection');
  await grid.hover(); await gridPage.mouse.wheel(0, 600);
  await gridPage.waitForFunction(() => document.querySelector('[data-ui-node="ending-grid"]').scrollTop > 0);
  assert(await grid.locator('[data-ui-item="ending6"]').isVisible());
  await gridPage.screenshot({ path: path.join(output, 'grid-scrolled.png') });
  await gridPage.getByRole('tab', { name: '图片', exact: true }).click();
  const cgs = gridPage.locator('[data-ui-node="cg-grid"]');
  await cgs.locator('[data-ui-item="cg1"]').focus(); await gridPage.keyboard.press('Tab');
  assert.equal(await gridPage.evaluate(() => document.activeElement?.dataset.uiItem), 'cg2', 'Tab follows item order across the next grid row');
  await gridPage.keyboard.press('Enter');
  assert.deepEqual(await gridPage.evaluate(() => window.gridSelections), [{ source: 'gallery-cgs', id: 'cg2' }]);
  const scrollBeforeRefresh = await cgs.evaluate(element => element.scrollTop);
  await gridPage.evaluate(() => { window.gridItems[2].description = '刷新后的真实说明'; window.gridUi.refresh(); });
  assert.equal(await gridPage.evaluate(() => document.activeElement?.dataset.uiItem), 'cg2', 'grid refresh retains focused item');
  assert.equal(await cgs.evaluate(element => element.scrollTop), scrollBeforeRefresh, 'grid refresh retains scroll position');
  assert.equal(await cgs.locator('[data-ui-item="cg2"] [data-ui-node="cg-card-description"]').innerText(), '刷新后的真实说明');
  assert.equal(await cgs.locator('[data-ui-item]').count(), 8);
  await gridPage.keyboard.press('Space');
  assert.deepEqual(await gridPage.evaluate(() => window.gridSelections), [{ source: 'gallery-cgs', id: 'cg2' }, { source: 'gallery-cgs', id: 'cg2' }]);
  await gridPage.evaluate(() => window.gridUi.dispose());
  assert.equal(await gridPage.locator('[data-surdet-project-ui]').count(), 0);
  assert.deepEqual(gridErrors, []);
  await gridPage.close();
  console.log('PASS grid: eight unique cards in two scrollable columns; text bounds; readonly; keyboard selection and refresh focus; fill/default contain/cover');
  const sliderPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sliderErrors = [];
  sliderPage.on('pageerror', error => sliderErrors.push(error.message));
  await sliderPage.setContent('<!doctype html><body style="margin:0"><canvas width="1280" height="720"></canvas></body>');
  await sliderPage.addScriptTag({ content: chunks[0].code });
  await sliderPage.evaluate(() => {
    window.sliderValues = { bgmVolume: 0.55, textSpeedCps: 24, permit: true };
    window.sliderWrites = [];
    window.sliderUi = SkinnedUi.createProjectUiDom({
      canvas: document.querySelector('canvas'),
      document: { version: 1, pages: { settings: { id: 'range-page', type: 'container', frame: { x: 0, y: 0, width: 1280, height: 720 }, children: [
        { id: 'volume-range', type: 'slider', text: { kind: 'literal', value: '背景音乐' }, binding: { kind: 'setting', name: 'bgmVolume' }, frame: { x: 80, y: 80, width: 500, height: 40 } },
        { id: 'speed-range', type: 'slider', text: { kind: 'literal', value: '文字速度' }, binding: { kind: 'setting', name: 'textSpeedCps' }, enabledWhen: 'permit', frame: { x: 80, y: 160, width: 500, height: 40 } },
      ] } } },
      theme: { colors: { text: 0x213943, panel: 0xffffff, accent: 0x2799c0 }, typography: { uiSize: 22 }, skins: {} },
      fontFamily: () => 'Arial', imageUrl: () => undefined, onError: error => { throw error; },
    });
    window.sliderUi.show('settings', {
      read: name => window.sliderValues[name], data: () => undefined, content: () => [], action: () => {}, select: () => {},
      bounds: binding => binding.name === 'bgmVolume' ? { min: 0, max: 1, step: 0.1 } : { min: 1, max: 199, step: 6 },
      write: (binding, value) => { window.sliderWrites.push({ name: binding.name, value }); window.sliderValues[binding.name] = value; },
    });
  });
  const volumeRange = sliderPage.getByRole('slider', { name: '背景音乐' });
  const speedRange = sliderPage.getByRole('slider', { name: '文字速度' });
  assert.equal(await volumeRange.inputValue(), '0.55', 'show the confirmed 55%, not a browser-rounded 60%');
  assert.equal(await speedRange.inputValue(), '24', 'show the confirmed 24 CPS, not 25');
  assert.deepEqual(await sliderPage.evaluate(() => window.sliderWrites), [], 'rendering must not change settings');
  await volumeRange.focus(); await sliderPage.keyboard.press('ArrowRight');
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.bgmVolume), 0.65, 'keyboard steps from the actual confirmed value');
  await sliderPage.keyboard.press('ArrowLeft');
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.bgmVolume), 0.55);
  await sliderPage.keyboard.press('Home');
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.bgmVolume), 0);
  await sliderPage.keyboard.press('End');
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.bgmVolume), 1);
  await volumeRange.click({ position: { x: 250, y: 20 } });
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.bgmVolume), 0.5, 'pointer input still follows the public step');
  await speedRange.focus(); await sliderPage.keyboard.press('ArrowRight');
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.textSpeedCps), 30);
  await sliderPage.keyboard.press('ArrowLeft');
  assert.equal(await sliderPage.evaluate(() => window.sliderValues.textSpeedCps), 24);
  await sliderPage.evaluate(() => { window.sliderValues.bgmVolume = 0.57; window.sliderValues.permit = false; window.sliderUi.refresh(); });
  assert.equal(await volumeRange.inputValue(), '0.57', 'external confirmed updates remain exact');
  assert(await speedRange.isDisabled());
  const writesBeforeDisabled = await sliderPage.evaluate(() => window.sliderWrites.length);
  await speedRange.evaluate(input => { input.value = '90'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  assert.equal(await sliderPage.evaluate(() => window.sliderWrites.length), writesBeforeDisabled, 'disabled controls cannot write via pointer or key handlers');
  assert.deepEqual(sliderErrors, []);
  await sliderPage.close();
  console.log('PASS sliders: confirmed off-grid defaults; stepped keys and pointer; endpoints; refresh; disabled guards');
  console.log(`PASS project UI button skins / ${output}`);
} finally { await browser.close(); }
