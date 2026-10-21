import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const [container, primary] of [
  ['asset-center-batch-controls', 'asset-center-batch-primary'],
  ['asset-relocation-actions', 'asset-relocation-primary'],
  ['asset-relocation', 'asset-relocation-primary'],
]) {
  test(`${primary} in ${container} keeps the theme's accent foreground and hover background`, async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
    try {
      const tokens = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
      const styles = await readFile(new URL('../src/styles/asset-center.css', import.meta.url), 'utf8');
      await page.setContent(`<style>${tokens}\n${styles}</style><div class="${container}">
        <button class="${primary}" id="primary">整理所选</button>
        <button class="${primary}" id="disabled" disabled>整理所选</button>
        <button id="secondary">取消</button></div>`);
      const colors = await page.evaluate(() => {
        const probe = document.createElement('span'); document.body.append(probe);
        const color = variable => { probe.style.color = `var(${variable})`; return getComputedStyle(probe).color; };
        const result = { primary: color('--surdet-action-primary'), hover: color('--surdet-action-primary-hover'),
          ink: color('--surdet-text-on-accent'), subtle: color('--surdet-surface-subtle') };
        probe.remove(); return result;
      });
      const appearance = id => page.locator(id).evaluate(button => {
        const style = getComputedStyle(button);
        return { background: style.backgroundColor, color: style.color };
      });
      assert.deepEqual(await appearance('#primary'), { background: colors.primary, color: colors.ink });
      await page.locator('#primary').hover();
      assert.deepEqual(await appearance('#primary'), { background: colors.hover, color: colors.ink });
      await page.locator('#disabled').hover();
      assert.deepEqual(await appearance('#disabled'), { background: colors.primary, color: colors.ink });
      await page.locator('#secondary').hover();
      const secondary = (await appearance('#secondary')).background;
      if (container === 'asset-relocation') {
        // Direct replacement controls did not have the action-row's secondary styling.
        assert.notEqual(secondary, colors.primary); assert.notEqual(secondary, colors.hover);
      } else assert.equal(secondary, colors.subtle);
    } finally { await page.close(); }
  });
}
