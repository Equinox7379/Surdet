import assert from 'node:assert/strict';

export async function activate(page, name) {
  await page.waitForFunction((name) => Array.from(document.querySelectorAll('button')).some((button) => {
    const target = button.container;
    if (button.getAttribute('aria-label') !== name || !target?.parent || target.destroyed || target.accessibleHint !== name) return false;
    for (let node = target; node; node = node.parent) if (!node.visible || node.destroyed) return false;
    return button.getAttribute('aria-disabled') !== 'true';
  }), name);
  await page.getByRole('button', { name, exact: true }).focus();
  await page.keyboard.press('Enter');
}

export const state = (page) => page.evaluate(() => ({ position: window.__surdetDebug.position, session: window.__surdetDebug.sessionId, status: window.__surdetDebug.rendererStatus, dialogue: window.__surdetDebug.dialogueProjection, ui: window.__surdetDebug.uiSession }));

export async function advanceToChoice(page) {
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(70);
    if ((await state(page)).status === 'choice') return;
    assert.notEqual((await state(page)).ui.base, 'title', 'story returned to title before the expected choice');
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.keyboard.press('Space');
  }
  throw new Error('story did not reach a choice within its authored input budget');
}

export async function finishToTitle(page) {
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(70);
    const current = await state(page);
    if (current.ui.base === 'title') return;
    assert.notEqual(current.status, 'choice', 'unexpected unresolved choice before the ending');
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.keyboard.press('Space');
  }
  throw new Error('ending did not return to title');
}

export const waitTitle = (page) => page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done && window.__surdetDebug.uiSession.base === 'title');
export const waitOverlay = (page, overlay) => page.waitForFunction((value) => window.__surdetDebug.uiSession.overlay === value, overlay);
export async function canvasTexts(page) {
  return page.evaluate(() => {
    let root = Array.from(document.querySelectorAll('button')).find((button) => button.container?.parent)?.container;
    if (!root) return [];
    while (root.parent) root = root.parent;
    const texts = [];
    const visit = (node) => {
      if (!node.visible || node.destroyed) return;
      if (typeof node.text === 'string') texts.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return texts;
  });
}
