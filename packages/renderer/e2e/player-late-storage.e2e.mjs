import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { activate, waitTitle, waitOverlay } from './player-browser-helpers.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const browser = await chromium.launch({ headless: true });
const cases = [
  { id: 'quick-load', method: 'read' },
  { id: 'quick-save', method: 'write' },
  { id: 'manual-load', method: 'read' },
  { id: 'manual-save', method: 'write' },
  { id: 'restore-backup', method: 'restoreBackup' },
  { id: 'restored-load', method: 'read' },
  { id: 'list', method: 'listMeta' },
  { id: 'new-game', method: 'profile' },
];
try {
  for (const directory of ['starter', 'zero-after-midnight']) {
  const root = path.join(repo, 'examples', directory);
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 18083, strictPort: true } });
  try {
  await server.listen();
  for (const testCase of cases) for (const reject of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        const slots = new Map();
        const backups = new Map();
        const metadata = records => [...records].map(([id, value]) => ({ ...value.meta, id, kind: value.kind, sceneId: value.position?.sceneId }));
        const gate = async (method, value) => {
          if (window.auditDelayMethod !== method) return value;
          return new Promise((resolve, reject) => {
            window.auditRelease = () => {
              window.auditReleased = true;
              if (window.auditReject) reject(new Error('delayed storage rejection'));
              else resolve(value);
            };
          });
        };
        window.auditSlots = slots;
        window.auditBackups = backups;
        window.surdetSave = {
          list: async () => [...slots.keys()],
          write: async (id, value) => { await gate('write'); slots.set(id, structuredClone(value)); },
          read: async id => gate('read', slots.has(id) ? structuredClone(slots.get(id)) : null),
          delete: async id => { slots.delete(id); },
          listMeta: async () => gate('listMeta', metadata(slots)),
          listBackupMeta: async () => metadata(backups),
          restoreBackup: async id => { await gate('restoreBackup'); slots.set(id, structuredClone(backups.get(id))); },
        };
        window.surdetProfile = { read: async () => gate('profile', null), write: async () => {}, delete: async () => {} };
      });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
      await waitTitle(page);
      await activate(page, '开始游戏');
      await page.waitForFunction(() => window.__surdetDebug.status === 'awaiting-advance');
      assert.equal(await page.evaluate(() => window.__surdetDebug.quickSave()), true);
      await page.evaluate(() => {
        const saved = window.auditSlots.get('quick');
        window.auditSlots.set('1', { ...structuredClone(saved), meta: { ...saved.meta, id: '1' } });
        window.auditBackups.set('1', { ...structuredClone(saved), meta: { ...saved.meta, id: '1' } });
        const flag = Object.entries(window.surdetDebug.store.snapshot()).find(([, value]) => typeof value === 'boolean');
        if (!flag) throw new Error('fixture project must contain a writable flag');
        window.surdetDebug.store.set(flag[0], !flag[1]);
      });
      if (testCase.id.startsWith('manual') || testCase.id.startsWith('restore')) {
        await page.evaluate(mode => window.surdetDebug.openSaveLoad(mode), testCase.id === 'manual-save' ? 'save' : 'load');
        await waitOverlay(page, 'save-load');
      }
      await page.evaluate(({ method, reject }) => { window.auditDelayMethod = method; window.auditReject = reject; }, { method: testCase.method, reject });
      if (testCase.id === 'quick-load' || testCase.id === 'quick-save' || testCase.id === 'list' || testCase.id === 'new-game') {
        await page.evaluate(id => {
          const task = id === 'quick-load' ? window.__surdetDebug.quickLoad()
            : id === 'quick-save' ? window.__surdetDebug.quickSave()
            : id === 'new-game' ? window.__surdetDebug.titleSelect('new') : window.surdetDebug.openSaveLoad('load');
          window.auditTask = task.then(value => ({ value }), error => ({ error: error.message }));
        }, testCase.id);
      } else if (testCase.id === 'manual-save') {
        // Empty slot avoids conflating overwrite confirmation with the delayed write.
        await activate(page, await page.getByRole('button', { name: /^保存到槽位 2：/ }).getAttribute('aria-label'));
      } else if (testCase.id === 'manual-load') {
        await activate(page, await page.getByRole('button', { name: /^读取槽位 1：/ }).getAttribute('aria-label'));
      } else {
        await activate(page, '恢复槽位 1的备份并读取');
        await activate(page, '恢复并读取');
      }
      await page.waitForFunction(() => typeof window.auditRelease === 'function');
      const result = await page.evaluate(async () => {
        const semantic = ({ meta, ...snapshot }) => snapshot;
        window.dispatchEvent(new Event('beforeunload'));
        const before = semantic(window.surdetDebug.interp.saveSnapshot());
        const disposed = window.surdetDebug.queries.diagnostics.isDisposed();
        window.auditRelease();
        const completion = window.auditTask ? await window.auditTask : null;
        // Let the real Menu selection handler's promise settle too.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { disposed, completion, preserved: JSON.stringify(before) === JSON.stringify(semantic(window.surdetDebug.interp.saveSnapshot())), fatal: Boolean(document.getElementById('surdet-fatal')) };
      });
      assert.equal(result.disposed, true, testCase.id);
      assert.equal(result.preserved, true, testCase.id);
      assert.equal(result.fatal, false, testCase.id);
      if (testCase.id.startsWith('quick')) assert.deepEqual(result.completion, { value: false }, testCase.id);
      if (testCase.id === 'list' || testCase.id === 'new-game') assert.deepEqual(result.completion, { value: undefined }, testCase.id);
      assert.deepEqual(errors, [], testCase.id);
      console.log(`PASS ${directory} ${testCase.id}: delayed ${reject ? 'rejection' : 'success'} after owner disposal`);
    } finally { await context.close(); }
  }
  } finally { await server.close(); }
  }
} finally {
  await browser.close();
}
