/**
 * Player Experience Hotfix Wave 2 — isolated real-player acceptance matrix.
 *
 * The formal game is built once, then every top-level case gets a fresh
 * Electron process and an isolated userData directory. A case may contain a
 * long same-session sequence (save/load/title), but cases never inherit UI,
 * renderer, or save state from one another.
 *
 * Semantic debug reads are immutable snapshots only. All tested actions use
 * real keyboard/mouse input; the debug API is used only for the explicit
 * return-to-title setup needed by a case, never to invoke a tested overlay
 * action.
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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-player-experience-wave-2-task7-'));
const evidencePath = path.join(tempRoot, 'task7-player-experience-matrix.json');

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

function cloneJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function isIdleGame(debug) {
  return debug?.uiSession?.base === 'game'
    && debug?.uiSession?.overlay === 'none'
    && debug?.uiSession?.operation === 'idle'
    && debug?.activeOverlay === null;
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

async function launchSession(caseId) {
  const caseRoot = path.join(tempRoot, caseId);
  const userData = path.join(caseRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: shellDir,
    env: {
      ...process.env,
      SURDET_E2E: '1',
      SURDET_E2E_GAME_DIR: gameDist,
    },
  });
  const page = await app.firstWindow();
  const events = {
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    unhandledRejections: [],
    unexpectedWindowClosed: false,
  };
  let closing = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    events.consoleErrors.push(text);
    if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
  });
  page.on('pageerror', (error) => events.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => {
    events.requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('close', () => {
    if (!closing) events.unexpectedWindowClosed = true;
  });

  const session = {
    caseId,
    caseRoot,
    userData,
    app,
    page,
    events,
    dialogueFrameEvidence: [],
    async snapshot() {
      if (page.isClosed()) return null;
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
    },
    async waitFor(label, predicate, arg = undefined, timeoutMs = 15000) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法等待：${label}`);
      return page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    },
    async waitForPresentedFrame(label) {
      await withWatchdog(`等待 ${label} 完成渲染提交`, () => page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })));
    },
    async canvasPoint(x, y) {
      return page.evaluate(({ logicalX, logicalY }) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (logicalX / 1280) * rect.width,
          y: rect.top + (logicalY / 720) * rect.height,
        };
      }, { logicalX: x, logicalY: y });
    },
    async clickTarget(id) {
      await this.waitForPresentedFrame(`${id} 目标`);
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
      console.log(`INFO ${this.caseId} semantic click ${id} @ (${target.x.toFixed(1)},${target.y.toFixed(1)})`);
      await withWatchdog(`点击 ${id}`, () => page.mouse.click(target.x, target.y));
      await this.waitForPresentedFrame(id);
    },
    async press(key) {
      await withWatchdog(`按键 ${key}`, () => page.keyboard.press(key));
    },
    async waitTitle() {
      await this.waitFor('正式游戏标题页', () => window.__surdetDebug?.uiSession?.base === 'title');
      await this.waitFor('标题覆盖层', () => window.__surdetDebug?.activeOverlay === 'title');
      await this.waitFor('标题交互目标', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:new'));
    },
    async waitGame() {
      await this.waitFor('正式游戏剧情入口', () => window.__surdetDebug?.uiSession?.base === 'game' && window.__surdetDebug?.position !== null);
      await this.waitFor('剧情可推进或等待', () => ['awaiting-advance', 'awaiting-timer', 'running', 'paused'].includes(window.__surdetDebug?.status));
      await this.waitFor('游戏会话空闲', () => {
        const d = window.__surdetDebug;
        return d?.uiSession?.overlay === 'none' && d?.uiSession?.operation === 'idle' && d?.activeOverlay === null;
      });
    },
    async waitOverlay(overlay) {
      await this.waitFor(`覆盖层 ${overlay}`, (expected) => window.__surdetDebug?.activeOverlay === expected, overlay);
    },
    async prepareTitle() {
      const current = await this.snapshot();
      if (current?.uiSession?.base !== 'title' || current?.activeOverlay !== 'title') {
        await page.evaluate(() => window.surdetDebug.showTitleScreen());
      }
      await this.waitTitle();
    },
    async sampleDialogueFrames(frameCount = 12) {
      return page.evaluate(async (count) => {
        const frames = [];
        for (let index = 0; index < count; index += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const projection = window.__surdetDebug?.dialogueProjection;
          frames.push({
            frame: index,
            panelVisible: projection?.panelVisible ?? null,
            dialogText: projection?.dialogText ?? null,
            position: window.__surdetDebug?.position ?? null,
          });
        }
        return frames;
      }, frameCount);
    },
    async assertNoRuntimeError(label) {
      const current = await this.snapshot();
      const releaseFailureEvidence = [...events.pageErrors, ...events.consoleErrors]
        .filter((entry) => /renderer resource release failed/i.test(entry));
      if (events.pageErrors.length || events.consoleErrors.length || events.requestFailures.length
        || events.unhandledRejections.length || events.unexpectedWindowClosed
        || current?.lastRendererError || releaseFailureEvidence.length) {
        throw new Error(`${label} 检测到运行时错误：${JSON.stringify({
          events,
          lastRendererError: current?.lastRendererError,
          releaseFailureEvidence,
        })}`);
      }
    },
    async completeGameSaveLoad(mode, slotTarget = 'save-load:slot-1') {
      const before = await this.snapshot();
      await this.press('Escape');
      await this.waitOverlay('system-menu');
      await this.clickTarget(`system:${mode}`);
      await this.waitOverlay('save-load');
      await this.clickTarget(slotTarget);
      await this.waitFor(`${mode} 完成`, () => {
        const d = window.__surdetDebug;
        return d?.uiSession?.base === 'game'
          && d?.uiSession?.overlay === 'none'
          && d?.uiSession?.operation === 'idle'
          && d?.activeOverlay === null;
      });
      await this.waitGame();
      const after = await this.snapshot();
      if (!isIdleGame(after) || after.commandRailVisible !== true) {
        throw new Error(`${mode} 后游戏上下文错误：${JSON.stringify(after)}`);
      }
      return { mode, before, after };
    },
    async advanceByKeyboard() {
      const before = await this.snapshot();
      const expected = positionKey(before.position);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await this.waitFor('等待可推进行', () => ['awaiting-advance', 'awaiting-timer'].includes(window.__surdetDebug?.status), undefined, 12000);
        await this.press('Space');
        try {
          await this.waitFor('解释器位置变化', (positionKeyExpected) => {
            const position = window.__surdetDebug?.position;
            return position ? `${position.sceneId}:${position.pc}` !== positionKeyExpected : positionKeyExpected !== 'null';
          }, expected, 5000);
          await this.waitGame();
          return { before, after: await this.snapshot(), attempts: attempt };
        } catch {
          // A real ADV input may first finish a typewriter/timer boundary;
          // continue with the same real key and retain the final failure.
        }
      }
      throw new Error(`连续 4 次真实 Space 后位置仍为 ${expected}`);
    },
    async advanceByCanvas() {
      const before = await this.snapshot();
      const point = await this.canvasPoint(640, 360);
      if (!point) throw new Error('找不到正式游戏画布');
      const expected = positionKey(before.position);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await this.waitFor('等待可推进行', () => ['awaiting-advance', 'awaiting-timer'].includes(window.__surdetDebug?.status), undefined, 12000);
        await withWatchdog('正常游戏面左键推进', () => page.mouse.click(point.x, point.y));
        try {
          await this.waitFor('解释器位置变化', (positionKeyExpected) => {
            const position = window.__surdetDebug?.position;
            return position ? `${position.sceneId}:${position.pc}` !== positionKeyExpected : positionKeyExpected !== 'null';
          }, expected, 5000);
          await this.waitGame();
          return { before, after: await this.snapshot(), attempts: attempt };
        } catch {
          // A real canvas click may first finish a typewriter/timer boundary;
          // continue with the same real click and retain the final failure.
        }
      }
      throw new Error(`连续 4 次正常游戏面左键后位置仍为 ${expected}`);
    },
    async restoreWithCanvasWithoutAdvance() {
      const before = await this.snapshot();
      const point = await this.canvasPoint(640, 360);
      if (!point) throw new Error('找不到正式游戏画布');
      await withWatchdog('隐藏界面状态下左键恢复', () => page.mouse.click(point.x, point.y));
      await this.waitFor('隐藏界面恢复', () => window.__surdetDebug?.uiSession?.interfaceHidden === false);
      const after = await this.snapshot();
      if (positionKey(after?.position) !== positionKey(before?.position)) {
        throw new Error(`隐藏界面恢复同时推进剧情：${JSON.stringify({ before, after })}`);
      }
      return { before, after };
    },
  };

  await page.evaluate(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      console.error(`[e2e-unhandledrejection] ${reason}`);
    });
  });
  await session.waitFor('正式游戏调试语义接口', () => window.__surdetDebug?.uiSession !== undefined, undefined, 30000);
  await session.waitFor('正式游戏素材完成', () => {
    const progress = window.__surdetDebug?.assetLoading;
    return progress?.done === true && progress.total > 0 && progress.completed === progress.total && progress.failed === 0;
  }, undefined, 120000);
  const title = await page.title();
  if (!title.includes('零点之后')) throw new Error(`Electron 未加载《零点之后》：${title}`);
  await session.waitTitle();
  return session;
}

async function closeSession(session) {
  session.events.intentionalClose = true;
  if (!session.app) return;
  await session.app.close().catch((error) => console.error(`Electron close failed: ${errorText(error)}`));
}

async function runCase(caseId, label, action) {
  const startedAt = Date.now();
  let session = null;
  try {
    session = await launchSession(caseId);
    const before = await session.snapshot();
    const details = await action(session);
    await session.assertNoRuntimeError(label);
    const after = await session.snapshot();
    return {
      id: caseId,
      name: label,
      ok: true,
      durationMs: Date.now() - startedAt,
      userData: session.userData,
      before,
      after,
      events: cloneJson(session.events),
      dialogueFrameEvidence: cloneJson(session.dialogueFrameEvidence),
      details: cloneJson(details),
    };
  } catch (error) {
    const after = session ? await session.snapshot().catch(() => null) : null;
    const events = session ? cloneJson(session.events) : null;
    return {
      id: caseId,
      name: label,
      ok: false,
      durationMs: Date.now() - startedAt,
      userData: session?.userData ?? null,
      error: errorText(error),
      after,
      events,
      dialogueFrameEvidence: cloneJson(session?.dialogueFrameEvidence ?? []),
    };
  } finally {
    if (session) await closeSession(session);
  }
}

async function caseA(session) {
  await session.prepareTitle();
  for (let round = 1; round <= 5; round += 1) {
    await session.clickTarget('title:gallery');
    await session.waitOverlay('gallery:cg');
    await session.clickTarget('gallery:music');
    await session.waitOverlay('gallery:music');
    await session.clickTarget('gallery:text');
    await session.waitOverlay('gallery:text');
    await session.clickTarget('gallery:close');
    await session.waitTitle();
    const returned = await session.snapshot();
    if (returned.uiSession?.base !== 'title' || returned.commandRailVisible !== false) {
      throw new Error(`标题鉴赏关闭后的 return context 错误：${JSON.stringify(returned)}`);
    }
  }
  return { rounds: 5, returnBase: 'title', commandRailVisible: false };
}

async function caseB(session) {
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  const initial = await session.snapshot();
  const checks = [];

  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:resume');
  await session.waitFor('系统菜单关闭', () => window.__surdetDebug?.activeOverlay === null);
  checks.push({ overlay: 'system-menu', position: positionKey((await session.snapshot()).position) });

  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:backlog');
  await session.waitOverlay('backlog');
  const backlogState = await session.snapshot();
  const backlogPosition = positionKey(backlogState.position);
  if (backlogState.dialogueProjection?.backlogVisible !== true
    || backlogState.dialogueProjection?.backlogAboveDialogueText !== true) {
    throw new Error(`真实 Backlog 合成层级未高于对白正文：${JSON.stringify(backlogState.dialogueProjection)}`);
  }
  await session.press('Space');
  if (positionKey((await session.snapshot()).position) !== backlogPosition) throw new Error('backlog 内 Space 推进了剧情');
  await session.clickTarget('backlog:close');
  await session.waitFor('backlog 关闭', () => window.__surdetDebug?.activeOverlay === null);
  checks.push({ overlay: 'backlog', position: backlogPosition, projection: backlogState.dialogueProjection });

  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:settings');
  await session.waitOverlay('settings');
  const settingsPosition = positionKey((await session.snapshot()).position);
  await session.press('Space');
  if (positionKey((await session.snapshot()).position) !== settingsPosition) throw new Error('settings 内 Space 推进了剧情');
  await session.clickTarget('settings:close');
  await session.waitFor('settings 关闭', () => window.__surdetDebug?.activeOverlay === null);
  checks.push({ overlay: 'settings', position: settingsPosition });

  await session.press('g');
  await session.waitOverlay('gallery:cg');
  const galleryPosition = positionKey((await session.snapshot()).position);
  await session.clickTarget('gallery:music');
  await session.waitOverlay('gallery:music');
  if (positionKey((await session.snapshot()).position) !== galleryPosition) throw new Error('gallery tab click 推进了剧情');
  await session.clickTarget('gallery:text');
  await session.waitOverlay('gallery:text');
  if (positionKey((await session.snapshot()).position) !== galleryPosition) throw new Error('gallery text tab click 推进了剧情');
  await session.clickTarget('gallery:close');
  await session.waitFor('gallery 关闭', () => window.__surdetDebug?.activeOverlay === null);
  checks.push({ overlay: 'gallery', position: galleryPosition });

  const final = await session.snapshot();
  if (positionKey(final.position) !== positionKey(initial.position)) throw new Error('阻塞覆盖层序列改变了解释器位置');
  return { initialPosition: initial.position, checks, finalPosition: final.position };
}

async function caseC(session) {
  const phases = [];
  const drainRollbackToNoOp = async (label, maxMoves = 12) => {
    const moves = [];
    let noOpStreak = 0;
    for (let attempt = 1; attempt <= maxMoves; attempt += 1) {
      await session.waitFor(`${label} 第 ${attempt} 次回退前稳定`, () => window.__surdetDebug?.status === 'awaiting-advance', undefined, 12000);
      const before = positionKey((await session.snapshot()).position);
      await session.clickTarget('rail:rollback');
      const after = positionKey((await session.snapshot()).position);
      moves.push({ attempt, before, after });
      noOpStreak = after === before ? noOpStreak + 1 : 0;
      if (noOpStreak >= 2) return moves;
    }
    throw new Error(`${label} 在 ${maxMoves} 次回退内没有进入无历史 no-op 状态`);
  };
  const assertNoOpRollbacks = async (label, count = 4) => {
    const noOp = [];
    for (let i = 0; i < count; i += 1) {
      await session.waitFor(`${label} 第 ${i + 1} 次回退前稳定`, () => window.__surdetDebug?.status === 'awaiting-advance', undefined, 12000);
      const before = positionKey((await session.snapshot()).position);
      await session.clickTarget('rail:rollback');
      const after = positionKey((await session.snapshot()).position);
      noOp.push({ before, after });
      if (after !== before) throw new Error(`${label} 第 ${i + 1} 次改变了位置`);
    }
    return noOp;
  };
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  const seed = await session.advanceByKeyboard();
  const availableTarget = positionKey(seed.after.position);
  await session.clickTarget('rail:rollback');
  await session.waitFor('可用回退完成', (expected) => {
    const position = window.__surdetDebug?.position;
    return position ? `${position.sceneId}:${position.pc}` !== expected : expected !== 'null';
  }, availableTarget, 12000);
  const afterFirstRollback = await session.snapshot();
  const drained = await drainRollbackToNoOp('已用历史回退');
  const availableNoOp = await assertNoOpRollbacks('已耗尽历史后的回退');
  phases.push({ kind: 'available-then-empty', seed: seed.before.position, afterFirstRollback: afterFirstRollback.position, drained, noOp: availableNoOp });

  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:title');
  await session.waitTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  const unavailableDrain = await drainRollbackToNoOp('新游戏回退');
  const unavailable = await assertNoOpRollbacks('新游戏无可用历史回退', 5);
  phases.push({ kind: 'unavailable', drained: unavailableDrain, noOp: unavailable });
  return { phases };
}

async function caseD(session) {
  const phases = [];
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  for (let i = 1; i <= 3; i += 1) {
    await session.press('h');
    await session.waitFor('H 隐藏界面', () => window.__surdetDebug?.uiSession?.interfaceHidden === true);
    const restored = await session.restoreWithCanvasWithoutAdvance();
    const advanced = await session.advanceByCanvas();
    phases.push({ source: 'H', round: i, restored, advanced });
  }
  for (let i = 1; i <= 3; i += 1) {
    await session.clickTarget('rail:hide');
    await session.waitFor('界面按钮隐藏', () => window.__surdetDebug?.uiSession?.interfaceHidden === true);
    const restored = await session.restoreWithCanvasWithoutAdvance();
    const advanced = await session.advanceByCanvas();
    phases.push({ source: 'rail:hide', round: i, restored, advanced });
  }
  return { phases };
}

async function caseE(session) {
  await session.prepareTitle();
  await session.clickTarget('title:load');
  await session.waitOverlay('save-load');
  const before = await session.snapshot();
  const clicks = [];
  for (let round = 1; round <= 5; round += 1) {
    await session.clickTarget('save-load:slot-2');
    await session.waitOverlay('save-load');
    const after = await session.snapshot();
    if (positionKey(after.position) !== positionKey(before.position)) throw new Error(`空槽点击第 ${round} 次改变了解释器位置`);
    if (after.lastRendererError) throw new Error(`空槽点击第 ${round} 次产生 RendererError`);
    clicks.push({ round, overlay: after.activeOverlay, position: after.position, rendererError: after.lastRendererError });
  }
  await session.clickTarget('save-load:close');
  await session.waitTitle();
  return { before, clicks, final: await session.snapshot() };
}

async function caseF(session) {
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  const transitions = [];
  for (let round = 1; round <= 3; round += 1) {
    transitions.push({ round, order: 'save-load', save: await session.completeGameSaveLoad('save'), load: await session.completeGameSaveLoad('load') });
  }
  for (let round = 1; round <= 3; round += 1) {
    transitions.push({ round, order: 'load-save', load: await session.completeGameSaveLoad('load'), save: await session.completeGameSaveLoad('save') });
  }
  const final = await session.snapshot();
  if (!isIdleGame(final) || final.commandRailVisible !== true) throw new Error('存读档交替最终命令栏/游戏上下文错误');
  return { transitions, final };
}

async function caseG(session) {
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  await session.completeGameSaveLoad('save');
  await session.completeGameSaveLoad('load');
  const returns = [];
  for (let round = 1; round <= 3; round += 1) {
    await session.press('Escape');
    await session.waitOverlay('system-menu');
    await session.clickTarget('system:title');
    await session.waitTitle();
    const title = await session.snapshot();
    if (title.commandRailVisible !== false || title.uiSession?.base !== 'title') throw new Error(`第 ${round} 次回标题上下文错误`);
    await session.clickTarget('title:new');
    await session.waitGame();
    const loaded = await session.completeGameSaveLoad('load');
    returns.push({ round, title, loaded });
  }
  return { returns, final: await session.snapshot() };
}

async function caseH(session) {
  await session.prepareTitle();
  // 对照 1：标题 → 鉴赏 → CG → 返回。
  await session.clickTarget('title:gallery');
  await session.waitOverlay('gallery:cg');
  await session.clickTarget('gallery:close');
  await session.waitTitle();
  const titleGallery = await session.snapshot();

  // 对照 2：新游戏 → 未读档直接返回标题。
  await session.clickTarget('title:new');
  await session.waitGame();
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:title');
  await session.waitTitle();
  const returnedTitle = await session.snapshot();

  // 对照 3：同一正式会话写入有效档后，从标题真实点击读取，命令栏恢复。
  await session.clickTarget('title:new');
  await session.waitGame();
  await session.completeGameSaveLoad('save');
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:title');
  await session.waitTitle();
  await session.clickTarget('title:load');
  await session.waitOverlay('save-load');
  await session.clickTarget('save-load:slot-1');
  await session.waitGame();
  const directLoad = await session.snapshot();
  if (!isIdleGame(directLoad) || directLoad.commandRailVisible !== true) throw new Error('有效读档对照路径命令栏未恢复');
  return { titleGallery, returnedTitle, directLoad };
}

async function caseI(session) {
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
  for (let line = 0; line < 10; line += 1) {
    await session.waitFor('等待对话行可推进', () => ['awaiting-advance', 'awaiting-timer'].includes(window.__surdetDebug?.status), undefined, 12000);
    const before = await session.snapshot();
    const framePromise = session.sampleDialogueFrames(12);
    await session.press('Space');
    const frames = await framePromise;
    const after = await session.snapshot();
    session.dialogueFrameEvidence.push({ line: line + 1, before, after, frames });
    const visibleValues = frames.map((frame) => frame.panelVisible).filter((value) => value !== null);
    for (let index = 0; index < visibleValues.length - 2; index += 1) {
      if (visibleValues[index] === true && visibleValues[index + 1] === false && visibleValues[index + 2] === true) {
        throw new Error(`对话行 ${line + 1} 出现非法 panel true → false → true：${JSON.stringify(frames)}`);
      }
    }
    if (visibleValues.length > 0 && visibleValues.some((value) => value !== true)) {
      throw new Error(`对话行 ${line + 1} 出现非设计性 panel 隐藏：${JSON.stringify(frames)}`);
    }
  }
  return { lines: 10, samplesPerLine: 12 };
}

async function main() {
  buildFormalGame();
  const cases = [];
  const specifications = [
    ['A', 'title → gallery → CG/music/text → close ×5', caseA],
    ['B', 'new → system menu/backlog/settings/gallery', caseB],
    ['C', 'rollback available/unavailable ×5', caseC],
    ['D', 'H 与界面按钮隐藏/左键恢复 ×3', caseD],
    ['E', 'load empty slot 连点 ×5', caseE],
    ['F', 'save/load 两种顺序各 ×3', caseF],
    ['G', 'load → title ×3 → new/load', caseG],
    ['H', '三条已知正常对照路径', caseH],
    ['I', '连续 10 句逐帧采样', caseI],
  ];
  for (const [caseId, label, action] of specifications) {
    console.log(`BEGIN ${caseId} ${label}`);
    const result = await runCase(caseId, label, action);
    cases.push(result);
    if (result.ok) console.log(`PASS ${caseId} ${label}`);
    else console.error(`FAIL ${caseId} ${label}\n${result.error}`);
  }
  const evidence = {
    schemaVersion: 2,
    phase: 'Task 7 isolated player experience acceptance matrix',
    generatedAt: new Date().toISOString(),
    formalGame: {
      sourceRoot: path.resolve(gameSourceRoot),
      distRoot: path.resolve(gameDist),
      title: '《零点之后》',
    },
    isolation: {
      tempRoot: path.resolve(tempRoot),
      topLevelCaseCount: cases.length,
      uniqueUserDataCount: new Set(cases.map((item) => item.userData).filter(Boolean)).size,
      sameSessionSequencesKeptWithinCase: true,
    },
    cases,
    status: cases.length === specifications.length && cases.every((entry) => entry.ok) ? 'PASSED' : 'FAILED',
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    evidencePath: path.resolve(evidencePath),
    status: evidence.status,
    cases: cases.map(({ id, name, ok, userData }) => ({ id, name, ok, userData })),
  }, null, 2));
  if (evidence.status !== 'PASSED') process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
