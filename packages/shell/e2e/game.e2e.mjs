/**
 * E2E 自动通关回归（自我迭代 第一梯队②）：
 *  Playwright 驱动真实 Electron 壳启动 starter 游戏——
 *  标题点击开局 → 键盘推进剧情 → 选择肢确认 → 快速存读档回路 →
 *  推进到系统交互层（战斗/地图/商店，键盘不可达处）或结局为止。
 * 前置：npm run build（core/renderer/shell/starter 全部构建产物在位）。
 * 运行：npm run e2e -w @surdet/shell（退出码 0 = 全部通过）
 */
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { QUICK_SLOT } from '@surdet/core';
import * as path from 'node:path';
import * as url from 'node:url';

const shellDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-electron-game-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellDir,
  env: { ...process.env, SURDET_E2E: '1', SURDET_E2E_GAME_DIR: path.resolve(shellDir, '../../examples/starter/dist') } });
let win;
console.log(`E2E_USER_DATA=${userData}`);
try {
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(userData));
  win = await app.firstWindow();
  await win.bringToFront();
  const pageErrors = [];
  win.on('pageerror', error => pageErrors.push(error.message));
  win.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
    if (msg.text().includes('快速存档') || msg.text().includes('快速读档') || msg.text().startsWith('E2E_POINTER_DOWN')) {
      console.log(`[GAME] ${msg.text()}`);
    }
  });
  await win.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: 30000 });
  console.log('PASS  游戏引导完成（__surdetDebug 就绪）');
  await win.waitForFunction(() => window.__surdetDebug.assetLoading.done);

  const snap = () => win.evaluate(() => ({
    s: window.__surdetDebug.status,
    r: window.__surdetDebug.rendererStatus,
    p: window.__surdetDebug.position,
    system: window.__surdetDebug.queries.overlay.system().type,
  }));

  await win.locator('canvas').waitFor({ state: 'visible' });
  await win.evaluate(() => document.addEventListener('pointerdown', event => {
    console.info('E2E_POINTER_DOWN', JSON.stringify({ x: event.clientX, y: event.clientY, target: event.target?.tagName, trusted: event.isTrusted }));
  }, { capture: true, once: true }));
  // 点击当前真实控件，不猜测旧版菜单坐标；点击失败直接使本项失败。
  const startButton = win.getByRole('button', { name: '开始游戏', exact: true });
  await startButton.waitFor({ state: 'visible' });
  const startBounds = await startButton.boundingBox();
  assert(startBounds && startBounds.width > 0 && startBounds.height > 0);
  console.log('TITLE_INPUT', JSON.stringify(await win.evaluate(() => ({
    focused: document.hasFocus(), dpr: devicePixelRatio, loading: window.__surdetDebug.assetLoading,
    canvas: document.querySelector('canvas')?.getBoundingClientRect().toJSON(),
    button: Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '开始游戏')?.getBoundingClientRect().toJSON(),
  }))));
  await win.mouse.click(startBounds.x + startBounds.width / 2, startBounds.y + startBounds.height / 2);
  await win.waitForFunction(() => window.__surdetDebug.status !== 'idle', undefined, { timeout: 10000 });
  console.log('PASS  真实鼠标点击开始游戏，解释器离开 idle');
  await win.waitForFunction(() => window.__surdetDebug.rendererStatus === 'awaiting');
  // Windows CI 的虚拟桌面截图调用可能不返回；本地保留画面，CI 验证下方实际输入和文件回路。
  if (!process.env.CI) await win.screenshot({ path: path.join(userData, 'playing.png') });

  let steps = 0;
  let choices = 0;
  let saved = false;
  let loaded = false;
  let lastSig = '';
  let stall = 0;
  let ended = false;
  let pausedHit = false;

  while (steps < 500) {
    steps++;
    const { s, r, p, system } = await snap();
    if (s === 'ended') { ended = true; break; }
    if (s === 'paused') { pausedHit = true; break; }
    if (['map', 'base', 'battle', 'shop'].includes(system)) break;
    // 无进展时停止循环，由结尾检查实际面板/结局；不能把卡住当作通关。
    const sig = `${s}|${r}|${p?.sceneId ?? ''}|${p?.pc ?? ''}`;
    if (sig === lastSig) {
      stall++;
      if (stall > 40) break;
    } else {
      stall = 0;
      lastSig = sig;
    }
    if (r === 'choice') {
      await win.keyboard.press('1'); // 玩家数字键选择首项
      choices++;
      await sleep(200);
      continue;
    }
    if (s === 'awaiting-advance' || s === 'awaiting-timer') {
      if (!saved && steps > 6) {
        await win.waitForFunction(() => window.__surdetDebug.rendererStatus === 'awaiting');
        await win.keyboard.press('F5');
        await win.waitForFunction(async slot => (await window.surdetSave.list()).includes(slot), QUICK_SLOT);
        const stored = await win.evaluate(slot => window.surdetSave.read(slot), QUICK_SLOT);
        saved = stored !== null;
        const savedPosition = stored.position;
        await win.keyboard.press('Space');
        await win.waitForFunction(position => JSON.stringify(window.__surdetDebug.position) !== JSON.stringify(position), savedPosition);
        await win.keyboard.press('F9');
        await win.waitForFunction(position => JSON.stringify(window.__surdetDebug.position) === JSON.stringify(position), savedPosition);
        loaded = true;
        continue;
      }
      await win.keyboard.press('Space');
      await sleep(120);
      continue;
    }
    await sleep(120); // running/其他瞬态：等待
  }

  const final = await snap();
  check(saved, 'F5 快速存档已触发');
  check(loaded, 'F9 快速读档已触发');
  check(final.s !== 'idle', '读档后未回退 idle（存档回路健康）');
  const reached = ended || pausedHit || ['map', 'base', 'battle', 'shop'].includes(final.system);
  check(reached, `剧情推进到达系统交互层/结局（steps=${steps}, choices=${choices}, final=${final.s}/${final.r}, scene=${final.p?.sceneId ?? '-'}）`);
  console.log(`\n[E2E] steps=${steps} choices=${choices} saved=${saved} loaded=${loaded} final=${final.s} scene=${final.p?.sceneId ?? '-'}`);
  assert.deepEqual(pageErrors, []);
} catch (error) {
  console.error('NATIVE_FAILURE_STATE', await win?.evaluate(() => ({
    focused: document.hasFocus(), visibility: document.visibilityState,
    status: window.__surdetDebug?.status, rendererStatus: window.__surdetDebug?.rendererStatus,
    position: window.__surdetDebug?.position, menu: window.__surdetDebug?.queries.overlay.menu(),
    startButton: Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '开始游戏')?.getBoundingClientRect().toJSON(),
  })).catch(() => null));
  console.error('NATIVE_WINDOW_STATE', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), contentBounds: window.getContentBounds(),
  }))).catch(() => null));
  if (!process.env.CI) await win?.screenshot({ path: path.join(userData, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
process.exit(failures === 0 ? 0 : 1);
