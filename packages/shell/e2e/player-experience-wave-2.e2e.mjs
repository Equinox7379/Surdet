/**
 * Player Experience Hotfix Wave 2 — Task 1 reproduction harness.
 *
 * This is intentionally a red-first probe. It builds the formal game, launches
 * the Electron shell with an explicit isolated userData and formal-game dist,
 * then uses real mouse/keyboard input. Semantic debug reads are snapshots only;
 * no tested close/load/gallery action is invoked through the debug API.
 */
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(shellDir, '../..');
const gameSourceRoot = path.join(repoRoot, 'examples', 'zero-after-midnight');
const gameDist = path.join(gameSourceRoot, 'dist');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-player-experience-wave-2-task1-'));
const userData = path.join(tempRoot, 'user-data');
const evidencePath = path.join(tempRoot, 'task1-failure-matrix.json');
fs.mkdirSync(userData, { recursive: true });

const buildSteps = [
  ['run', 'build', '-w', '@surdet/core'],
  ['run', 'build', '-w', '@surdet/renderer'],
  ['run', 'build', '-w', '@surdet/host'],
  ['run', 'build', '-w', '@surdet/shell'],
  ['run', 'build', '-w', 'zero-after-midnight'],
];

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmInvocation(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return { command: process.execPath, args: [npmCli, ...args], shell: false };
  return { command: npmExecutable(), args, shell: false };
}

function buildFormalGame() {
  for (const args of buildSteps) {
    const invocation = npmInvocation(args);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: repoRoot,
      env: { ...process.env },
      shell: invocation.shell,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`构建步骤失败：npm ${args.join(' ')}（exit=${result.status}）`);
  }
  if (!fs.existsSync(path.join(gameDist, 'index.html'))) {
    throw new Error(`正式游戏构建缺少入口：${path.join(gameDist, 'index.html')}`);
  }
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function positionKey(position) {
  return position ? `${position.sceneId}:${position.pc}` : 'null';
}

let app = null;
let page = null;
let intentionalClose = false;
const events = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  windowClosed: false,
};
const cases = [];

async function snapshot() {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => {
    const d = window.__surdetDebug;
    return {
      status: d?.status ?? null,
      rendererStatus: d?.rendererStatus ?? null,
      position: d?.position ?? null,
      uiSession: d?.uiSession ?? null,
      activeOverlay: d?.activeOverlay ?? null,
      commandRailVisible: d?.commandRailVisible ?? null,
      dialogueProjection: d?.dialogueProjection ?? null,
      resources: d?.resourceSnapshot ?? null,
      lastRendererError: d?.lastRendererError ?? null,
      assetLoading: d?.assetLoading ?? null,
    };
  });
}

async function withWatchdog(label, operation, timeoutMs = 5000) {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`玩家路径 5 秒无响应：${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), watchdog]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(label, predicate, arg = undefined, timeoutMs = 15000) {
  if (!page || page.isClosed()) throw new Error(`窗口已关闭，无法等待：${label}`);
  return page.waitForFunction(predicate, arg, { timeout: timeoutMs });
}

async function canvasPoint(x, y) {
  return page.evaluate(({ x: logicalX, y: logicalY }) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (logicalX / 1280) * rect.width,
      y: rect.top + (logicalY / 720) * rect.height,
    };
  }, { x, y });
}

async function clickTarget(id) {
  const target = await page.evaluate((targetId) => {
    const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === targetId);
    const canvas = document.querySelector('canvas');
    if (!target || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
      y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
      target,
    };
  }, id);
  if (!target) throw new Error(`找不到语义交互目标：${id}`);
  console.log(`INFO semantic click ${id} @ (${target.x.toFixed(1)},${target.y.toFixed(1)})`);
  await withWatchdog(`点击 ${id}`, () => page.mouse.click(target.x, target.y));
}

async function press(key) {
  await withWatchdog(`按键 ${key}`, () => page.keyboard.press(key));
}

async function waitTitle() {
  await waitFor('正式游戏标题页', () => window.__surdetDebug?.uiSession?.base === 'title');
  await waitFor('标题交互目标', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:new'));
}

async function waitGame() {
  await waitFor('正式游戏剧情入口', () => window.__surdetDebug?.uiSession?.base === 'game' && window.__surdetDebug?.position !== null);
  await waitFor('剧情可推进或等待', () => ['awaiting-advance', 'awaiting-timer', 'running', 'paused'].includes(window.__surdetDebug?.status));
}

async function waitOverlay(overlay) {
  await waitFor(`覆盖层 ${overlay}`, (expected) => window.__surdetDebug?.activeOverlay === expected, overlay);
}

async function assertNoRuntimeError(label) {
  const current = await snapshot();
  const releaseEvents = [...events.pageErrors, ...events.consoleErrors]
    .filter((entry) => entry.includes('renderer resource release failed') || entry.includes('Renderer resource release failed'));
  if (events.pageErrors.length || events.consoleErrors.length || events.requestFailures.length || current?.lastRendererError || releaseEvents.length) {
    throw new Error(`${label} 检测到运行时错误：${JSON.stringify({ events, lastRendererError: current?.lastRendererError, releaseEvents })}`);
  }
}

async function prepareTitle() {
  const current = await snapshot();
  if (current?.uiSession?.base !== 'title' || current?.activeOverlay !== null) {
    await page.evaluate(() => window.surdetDebug.showTitleScreen());
  }
  await waitTitle();
}

async function runCase(name, action) {
  const startedAt = Date.now();
  try {
    await action();
    cases.push({ name, ok: true, durationMs: Date.now() - startedAt, snapshot: await snapshot() });
    console.log(`PASS ${name}`);
  } catch (error) {
    const failure = { name, ok: false, durationMs: Date.now() - startedAt, error: errorText(error), snapshot: await snapshot() };
    cases.push(failure);
    console.error(`FAIL ${name}\n${failure.error}`);
  }
}

async function main() {
  buildFormalGame();
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: shellDir,
    env: {
      ...process.env,
      SURDET_E2E: '1',
      SURDET_E2E_GAME_DIR: gameDist,
    },
  });
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') events.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => events.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => events.requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));
  page.on('close', () => { events.windowClosed = true; });

  await waitFor('正式游戏调试语义接口', () => window.__surdetDebug?.uiSession !== undefined, undefined, 30000);
  await waitFor('正式游戏素材完成', () => {
    const progress = window.__surdetDebug?.assetLoading;
    return progress?.done === true && progress.total > 0 && progress.completed === progress.total && progress.failed === 0;
  }, undefined, 120000);
  if (!(await page.title()).includes('零点之后')) throw new Error(`Electron 未加载《零点之后》：${await page.title()}`);
  if (!fs.existsSync(path.join(userData, 'saves'))) {
    console.log('INFO userData 尚未创建 saves，等待玩家首个存档动作');
  }
  await waitTitle();

  await runCase('UX-01 title → gallery → music → text → close ×5', async () => {
    for (let round = 1; round <= 5; round++) {
      await clickTarget('title:gallery');
      await waitOverlay('gallery:cg');
      await clickTarget('gallery:music');
      await waitOverlay('gallery:music');
      await clickTarget('gallery:text');
      await waitOverlay('gallery:text');
      await clickTarget('gallery:close');
      await waitTitle();
      const titleReturn = await snapshot();
      if (titleReturn?.uiSession?.base !== 'title' || titleReturn?.commandRailVisible !== false) {
        throw new Error(`标题鉴赏关闭后的 return context 错误：${JSON.stringify(titleReturn)}`);
      }
      console.log(`INFO UX-01 round=${round} completed`);
    }
    await assertNoRuntimeError('UX-01');
  });

  await runCase('UX-09 new game → save → load → save', async () => {
    await prepareTitle();
    await clickTarget('title:new');
    await waitGame();
    await press('F5');
    await waitFor('quick save IPC', () => window.surdetSave?.list().then((slots) => slots.includes('quick')), undefined, 15000);
    if (!fs.existsSync(path.join(userData, 'saves', 'quick.json'))) throw new Error('独立 userData 未收到 quick.json，无法证明 Electron 存档路径隔离');
    await press('F9');
    await waitGame();
    await press('F5');
    await waitFor('second quick save IPC', () => window.surdetSave?.list().then((slots) => slots.includes('quick')), undefined, 15000);
    await assertNoRuntimeError('UX-09');
  });

  await runCase('UX-01 game → gallery → music/text → close ×3', async () => {
    await prepareTitle();
    await clickTarget('title:new');
    await waitGame();
    for (let round = 1; round <= 3; round++) {
      await press('g');
      await waitOverlay('gallery:cg');
      await clickTarget('gallery:music');
      await waitOverlay('gallery:music');
      await clickTarget('gallery:text');
      await waitOverlay('gallery:text');
      await clickTarget('gallery:close');
      await waitFor('鉴赏返回游戏', () => {
        const debug = window.__surdetDebug;
        return debug?.uiSession?.base === 'game'
          && debug?.activeOverlay === null
          && debug?.commandRailVisible === true;
      });
      const gameReturn = await snapshot();
      if (gameReturn?.uiSession?.base !== 'game' || gameReturn?.commandRailVisible !== true) {
        throw new Error(`游戏鉴赏关闭后的 return context 错误：${JSON.stringify(gameReturn)}`);
      }
      console.log(`INFO UX-01 game round=${round} completed`);
    }
    await assertNoRuntimeError('UX-01 game');
  });

  await runCase('UX-04 load → system menu → title', async () => {
    await press('F9');
    await waitGame();
    const point = await canvasPoint(640, 360);
    if (!point) throw new Error('找不到正式游戏画布');
    await withWatchdog('打开系统菜单', () => page.mouse.click(point.x, point.y, { button: 'right' }));
    await waitFor('系统菜单标题按钮', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'system:title'));
    await clickTarget('system:title');
    await waitTitle();
    await assertNoRuntimeError('UX-04');
  });

  await runCase('UX-03 load 页面点击 empty slot', async () => {
    await prepareTitle();
    await clickTarget('title:load');
    await waitOverlay('save-load');
    const before = await snapshot();
    await clickTarget('save-load:slot-1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await snapshot();
    if (after?.activeOverlay !== 'save-load') throw new Error(`空槽点击错误地关闭了读档页：${JSON.stringify({ before, after })}`);
    if (positionKey(after?.position) !== positionKey(before?.position)) throw new Error(`空槽点击改变了解释器位置：${JSON.stringify({ before, after })}`);
    if (after?.lastRendererError) throw new Error(`空槽点击产生 RendererError：${JSON.stringify(after.lastRendererError)}`);
    await clickTarget('save-load:close');
    await waitTitle();
    await assertNoRuntimeError('UX-03');
  });

  await runCase('UX-05/07/08 backlog、rollback、interface 的位置前后', async () => {
    await prepareTitle();
    await clickTarget('title:new');
    await waitGame();
    const advanceUntilPositionChanges = async (before) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await waitFor('等待可推进行', () => ['awaiting-advance', 'awaiting-timer'].includes(window.__surdetDebug?.status), undefined, 12000);
        await press('Space');
        try {
          await waitFor('解释器位置变化', (expected) => {
            const current = window.__surdetDebug?.position;
            return current && `${current.sceneId}:${current.pc}` !== expected;
          }, positionKey(before), 5000);
          return await snapshot();
        } catch {
          // A timer/transition may consume the first input; continue with the
          // same real keyboard path and preserve any final failure below.
        }
      }
      return await snapshot();
    };

    const firstBefore = await snapshot();
    const firstAfter = await advanceUntilPositionChanges(firstBefore.position);
    await press('l');
    await waitOverlay('backlog');
    const backlogBefore = await snapshot();
    await clickTarget('backlog:close');
    await waitFor('关闭 backlog', () => window.__surdetDebug?.activeOverlay === null);
    const backlogAfter = await snapshot();
    if (positionKey(backlogAfter?.position) !== positionKey(backlogBefore?.position)) {
      throw new Error(`记录页点击穿透推进剧情：${JSON.stringify({ before: backlogBefore, after: backlogAfter })}`);
    }

    const rollbackBefore = await snapshot();
    await press('ArrowUp');
    await new Promise((resolve) => setTimeout(resolve, 160));
    const rollbackAfter = await snapshot();
    console.log(`INFO rollback ${JSON.stringify({ before: rollbackBefore.position, after: rollbackAfter?.position })}`);

    await press('h');
    await waitFor('界面隐藏', () => window.__surdetDebug?.uiSession?.interfaceHidden === true);
    const hiddenBefore = await snapshot();
    const point = await canvasPoint(640, 360);
    if (!point) throw new Error('找不到正式游戏画布');
    await withWatchdog('隐藏界面状态下左键', () => page.mouse.click(point.x, point.y));
    await waitFor('隐藏界面恢复', () => window.__surdetDebug?.uiSession?.interfaceHidden === false);
    const hiddenAfter = await snapshot();
    if (positionKey(hiddenAfter?.position) !== positionKey(hiddenBefore?.position)) {
      throw new Error(`隐藏界面后的第一次左键同时推进了剧情：${JSON.stringify({ before: hiddenBefore, after: hiddenAfter })}`);
    }
    await assertNoRuntimeError('UX-05/07/08');
    console.log(`INFO first advance ${JSON.stringify({ before: firstBefore.position, after: firstAfter?.position })}`);
  });

  const finalSnapshot = await snapshot();
  const releaseFailureEvidence = [...events.pageErrors, ...events.consoleErrors].filter((entry) => /renderer resource release failed/i.test(entry));
  const evidence = {
    schemaVersion: 1,
    phase: 'Task 1 red-first reproduction',
    generatedAt: new Date().toISOString(),
    formalGame: {
      sourceRoot: path.resolve(gameSourceRoot),
      distRoot: path.resolve(gameDist),
      title: await page.title().catch(() => null),
    },
    userData: path.resolve(userData),
    cases,
    events,
    releaseFailureEvidence,
    finalSnapshot,
    status: cases.some((entry) => !entry.ok) ? 'RED_REPRODUCED' : 'REPRODUCTION_BLOCKED',
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ evidencePath: path.resolve(evidencePath), status: evidence.status, cases: cases.map(({ name, ok }) => ({ name, ok })), releaseFailureEvidence }, null, 2));
}

try {
  await main();
} catch (error) {
  cases.push({ name: 'harness', ok: false, error: errorText(error), snapshot: await snapshot() });
  console.error(errorText(error));
} finally {
  intentionalClose = true;
  if (app) await app.close().catch((error) => console.error(`Electron close failed: ${errorText(error)}`));
  const evidence = {
    schemaVersion: 1,
    phase: 'Task 1 red-first reproduction',
    generatedAt: new Date().toISOString(),
    formalGame: { sourceRoot: path.resolve(gameSourceRoot), distRoot: path.resolve(gameDist) },
    userData: path.resolve(userData),
    cases,
    events: { ...events, intentionalClose },
    releaseFailureEvidence: [...events.pageErrors, ...events.consoleErrors].filter((entry) => /renderer resource release failed/i.test(entry)),
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Task 1 evidence retained at ${path.resolve(evidencePath)}`);
}

const hasRed = cases.some((entry) => !entry.ok);
if (!hasRed) {
  console.error('REPRODUCTION_BLOCKED: 当前基线未捕获 UX 红灯；不得凭猜测修改生命周期生产代码。');
  process.exitCode = 2;
} else {
  process.exitCode = 1;
}
