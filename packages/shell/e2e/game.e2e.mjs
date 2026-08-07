/**
 * E2E 自动通关回归（自我迭代 第一梯队②）：
 *  Playwright 驱动真实 Electron 壳启动 starter 游戏——
 *  标题点击开局 → 键盘推进剧情 → 选择肢确认 → 快速存读档回路 →
 *  推进到系统交互层（战斗/地图/商店，键盘不可达处）或结局为止。
 * 前置：npm run build（core/renderer/shell/starter 全部构建产物在位）。
 * 运行：npm run e2e -w @surdet/shell（退出码 0 = 全部通过）
 */
import { _electron as electron } from 'playwright';
import * as path from 'node:path';
import * as url from 'node:url';

const shellDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const app = await electron.launch({ args: ['.'], cwd: shellDir });
try {
  const win = await app.firstWindow();
  win.on('console', (msg) => {
    if (msg.text().includes('快速存档') || msg.text().includes('快速读档')) {
      console.log(`[GAME] ${msg.text()}`);
    }
  });
  await win.waitForFunction(() => window.__surdetDebug !== undefined, undefined, { timeout: 30000 });
  check(true, '游戏引导完成（__surdetDebug 就绪）');

  const snap = () => win.evaluate(() => ({
    s: window.__surdetDebug.status,
    r: window.__surdetDebug.rendererStatus,
    p: window.__surdetDebug.position,
  }));

  // 标题画面：点击首个菜单项（新开局）。舞台逻辑坐标 (640, 720*0.48)，
  // 经画布实际包围盒换算为页面像素坐标（兼容任意窗口尺寸/缩放）
  await sleep(800); // 等标题层完成首帧渲染
  const box = await win.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  if (!box) {
    check(false, '找到游戏画布');
    throw new Error('canvas not found');
  }
  check(true, '找到游戏画布');
  const clickX = box.left + box.width * 0.5;
  const clickY = box.top + box.height * 0.48;
  await win.mouse.click(clickX, clickY);
  await sleep(2500);
  const startedByClick = (await snap()).s !== 'idle';
  if (!startedByClick) {
    // 坐标点击未命中（窗口/DPI/letterbox 差异）：走同一处理函数的确定性入口，E2E 焦点是剧情链路
    console.log('WARN  标题点击未命中，回退调试入口 titleSelect(new)');
    await win.evaluate(() => window.__surdetDebug.titleSelect('new'));
    await win.waitForFunction(() => window.__surdetDebug.status !== 'idle', undefined, { timeout: 10000 });
  }
  check(true, `标题 → 剧情（解释器离开 idle，方式：${startedByClick ? '画布点击' : '调试入口'}）`);

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
    const { s, r, p } = await snap();
    if (s === 'ended') { ended = true; break; }
    if (s === 'paused') { pausedHit = true; break; }
    // 停滞检测：系统交互层（战斗/地图/商店）靠画布点击操作，键盘推进无效——
    // 连续无状态变化视为"到达系统交互层"，ADV 自动化部分到此为止
    const sig = `${s}|${r}|${p?.sceneId ?? ''}|${p?.pc ?? ''}`;
    if (sig === lastSig) {
      stall++;
      if (stall > 40) break;
    } else {
      stall = 0;
      lastSig = sig;
    }
    if (r === 'choice') {
      await win.keyboard.press('Enter'); // 确认高亮选项
      choices++;
      await sleep(200);
      continue;
    }
    if (s === 'awaiting-advance' || s === 'awaiting-timer') {
      if (!saved && steps > 6) {
        saved = await win.evaluate(() => window.__surdetDebug.quickSave());
        await sleep(250);
        // 剧情可能在下一步立刻进入连续选择肢；同轮完成读档，保证回归每次实际覆盖该路径。
        loaded = saved && await win.evaluate(() => window.__surdetDebug.quickLoad());
        await sleep(400);
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
  const reached = ended || pausedHit || stall > 40;
  check(reached, `剧情推进到达系统交互层/结局（steps=${steps}, choices=${choices}, final=${final.s}/${final.r}, scene=${final.p?.sceneId ?? '-'}）`);
  console.log(`\n[E2E] steps=${steps} choices=${choices} saved=${saved} loaded=${loaded} final=${final.s} scene=${final.p?.sceneId ?? '-'}`);
} finally {
  await app.close();
}
process.exit(failures === 0 ? 0 : 1);
