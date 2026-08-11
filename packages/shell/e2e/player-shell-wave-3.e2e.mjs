/**
 * Player Shell Foundation Wave 3 — real Electron A–F matrix.
 *
 * Every case launches a fresh Electron process with a fresh userData root.
 * The formal game is always the built Zero dist; Starter is never an implicit
 * fallback. The debug surface is read-only for semantic evidence, except for
 * the already-public Renderer theme command and the explicit title setup used
 * by the cases.
 */
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
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
const smoke = process.argv.includes('--smoke');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-player-shell-wave-3-'));
const evidencePath = path.join(tempRoot, smoke ? 'task7-player-shell-wave-3-smoke.json' : 'task7-player-shell-wave-3-matrix.json');

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
  return npmCli
    ? { command: process.execPath, args: [npmCli, ...args] }
    : { command: npmExecutable(), args };
}

function buildFormalGame() {
  for (const args of buildSteps) {
    const invocation = npmInvocation(args);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: repoRoot,
      env: { ...process.env },
      shell: false,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`构建步骤失败：npm ${args.join(' ')}（exit=${result.status}）`);
  }
  const entry = path.join(gameDist, 'index.html');
  if (!fs.existsSync(entry)) throw new Error(`正式游戏构建缺少入口：${entry}`);
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function cloneJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function positionKey(position) {
  return position ? `${position.sceneId}:${position.pc}` : 'null';
}

function isIdleGame(snapshot) {
  return snapshot?.playerShell?.base === 'game'
    && snapshot.playerShell.overlay === 'none'
    && snapshot.playerShell.operation === 'idle'
    && snapshot.activeOverlay === null;
}

async function withWatchdog(label, operation, timeoutMs = 8000) {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`玩家路径无响应：${label}`)), timeoutMs);
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
      SURDET_E2E_GAME_DIR: path.resolve(gameDist),
    },
  });
  const page = await app.firstWindow();
  const events = {
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    unhandledRejections: [],
    releaseFailures: [],
    unexpectedWindowClosed: false,
  };
  const expectedPatterns = [];
  let closing = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
    else if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
    else events.consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    const text = errorText(error);
    if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
    else events.pageErrors.push(text);
  });
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
    markClosing() {
      closing = true;
    },
    allowExpectedError(pattern, label) {
      expectedPatterns.push({ pattern, label });
    },
    async snapshot() {
      if (page.isClosed()) return null;
      return page.evaluate(() => {
        const semantic = window.__surdetDebug;
        const debug = window.surdetDebug;
        return {
          status: semantic?.status ?? null,
          rendererStatus: semantic?.rendererStatus ?? null,
          position: semantic?.position ?? null,
          playerShell: semantic?.playerShell?.snapshot ?? null,
          bindingSnapshot: semantic?.playerShell?.slots ?? null,
          uiSession: semantic?.uiSession ?? null,
          activeOverlay: semantic?.activeOverlay ?? null,
          dialogueProjection: semantic?.dialogueProjection ?? null,
          commandRailVisible: semantic?.dialogueProjection?.commandRailVisible ?? null,
          themeProjection: semantic?.themeProjection ?? null,
          resources: semantic?.resourceSnapshot ?? null,
          lastRendererError: semantic?.lastRendererError ?? null,
          assetLoading: semantic?.assetLoading ?? null,
          theme: semantic?.theme ?? debug?.queries?.preferences?.theme?.() ?? null,
        };
      });
    },
    async waitFor(label, predicate, arg = undefined, timeoutMs = 20000) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法等待：${label}`);
      return page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    },
    async waitForPresentedFrame(label) {
      await withWatchdog(`等待 ${label} 完成渲染提交`, () => page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })));
    },
    async waitForPresentationToSettle(label) {
      await withWatchdog(`等待 ${label} 动画完成`, () => page.evaluate(async () => {
        // MenuLayer publishes its semantic state before its presentation
        // motion finishes. Synchronize on real frames so hit testing uses the
        // settled rendered target rather than an arbitrary wall-clock sleep.
        for (let index = 0; index < 20; index += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }));
    },
    async waitForEvent(label, predicate, timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`等待事件超时：${label}`);
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
      await this.waitForPresentationToSettle(`${id} 目标`);
      const target = await page.evaluate((targetId) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === targetId);
        const canvas = document.querySelector('canvas');
        if (!target || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
          y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
        };
      }, id);
      if (!target) throw new Error(`找不到语义交互目标：${id}`);
      await withWatchdog(`点击 ${id}`, () => page.mouse.click(target.x, target.y));
      await this.waitForPresentedFrame(id);
    },
    async press(key) {
      await withWatchdog(`按键 ${key}`, () => page.keyboard.press(key));
    },
    async waitTitle() {
      await this.waitFor('正式游戏标题页', () => window.__surdetDebug?.playerShell?.snapshot?.base === 'title');
      await this.waitFor('标题覆盖层', () => window.__surdetDebug?.activeOverlay === 'title');
      await this.waitFor('标题交互目标', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:new'));
    },
    async waitGame() {
      await this.waitFor('正式游戏剧情入口', () => window.__surdetDebug?.playerShell?.snapshot?.base === 'game' && window.__surdetDebug?.position !== null);
      await this.waitFor('游戏会话空闲', () => {
        const snapshot = window.__surdetDebug?.playerShell?.snapshot;
        return snapshot?.overlay === 'none' && snapshot?.operation === 'idle' && window.__surdetDebug?.activeOverlay === null;
      });
    },
    async waitOverlay(overlay) {
      await this.waitFor(`覆盖层 ${overlay}`, (expected) => window.__surdetDebug?.activeOverlay === expected, overlay);
    },
    async prepareTitle() {
      const current = await this.snapshot();
      if (current?.playerShell?.base !== 'title' || current?.activeOverlay !== 'title') {
        await page.evaluate(() => window.surdetDebug.showTitleScreen());
      }
      await this.waitTitle();
    },
    async auditErrors(current) {
      const matches = (value) => expectedPatterns.some(({ pattern }) => pattern.test(value));
      const expectedConsoleErrors = events.consoleErrors.filter((value) => matches(value));
      const unexpectedConsoleErrors = events.consoleErrors.filter((value) => !matches(value));
      const expectedRendererErrors = current?.lastRendererError && matches(`${current.lastRendererError.name}: ${current.lastRendererError.message}`)
        ? [current.lastRendererError]
        : [];
      return {
        events: {
          ...cloneJson(events),
          consoleErrors: cloneJson(unexpectedConsoleErrors),
          expectedErrors: cloneJson(expectedConsoleErrors),
          expectedRendererErrors: cloneJson(expectedRendererErrors),
        },
        unexpectedConsoleErrors,
        expectedConsoleErrors,
        expectedRendererErrors,
      };
    },
    async assertNoRuntimeError(label) {
      const current = await this.snapshot();
      const audit = await this.auditErrors(current);
      if (audit.unexpectedConsoleErrors.length || events.pageErrors.length || events.requestFailures.length
        || events.unhandledRejections.length || events.releaseFailures.length || events.unexpectedWindowClosed
        || (current?.lastRendererError && audit.expectedRendererErrors.length === 0)) {
        throw new Error(`${label} 检测到未预期运行时错误：${JSON.stringify({
          events: audit.events,
          lastRendererError: current?.lastRendererError,
        })}`);
      }
      return audit;
    },
    async writeSaveIndex(value) {
      const saveRoot = path.resolve(session.userData, 'saves');
      const indexPath = path.join(saveRoot, 'index.json');
      const relative = path.relative(saveRoot, indexPath);
      if (relative !== 'index.json') throw new Error(`拒绝越界写入 save index：${indexPath}`);
      fs.mkdirSync(saveRoot, { recursive: true });
      fs.writeFileSync(indexPath, value, 'utf8');
    },
  };

  await page.evaluate(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      console.error(`[e2e-unhandledrejection] ${reason}`);
    });
  });
  await session.waitFor('正式游戏调试语义接口', () => window.__surdetDebug?.playerShell !== undefined, undefined, 30000);
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
  session.markClosing();
  if (session.app) await session.app.close().catch((error) => console.error(`Electron close failed: ${errorText(error)}`));
}

async function runCase(caseId, label, action) {
  const startedAt = Date.now();
  let session = null;
  try {
    session = await launchSession(caseId);
    const before = await session.snapshot();
    const details = await action(session);
    const after = await session.snapshot();
    const audit = await session.assertNoRuntimeError(label);
    return {
      id: caseId,
      name: label,
      ok: true,
      durationMs: Date.now() - startedAt,
      userData: session.userData,
      before,
      after,
      events: audit.events,
      details: cloneJson(details),
    };
  } catch (error) {
    const after = session ? await session.snapshot().catch(() => null) : null;
    const audit = session ? await session.auditErrors(after).catch(() => ({ events: cloneJson(session.events) })) : null;
    return {
      id: caseId,
      name: label,
      ok: false,
      durationMs: Date.now() - startedAt,
      userData: session?.userData ?? null,
      error: errorText(error),
      after,
      events: audit?.events ?? null,
    };
  } finally {
    if (session) await closeSession(session);
  }
}

async function startGame(session) {
  await session.prepareTitle();
  await session.clickTarget('title:new');
  await session.waitGame();
}

async function openSaveLoad(session, mode) {
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget(`system:${mode}`);
  await session.waitOverlay('save-load');
}

async function completeSaveLoad(session, mode) {
  await openSaveLoad(session, mode);
  await session.clickTarget('save-load:slot-1');
  await session.waitGame();
}

async function caseA(session) {
  await session.prepareTitle();
  const rounds = [];
  for (let round = 1; round <= 2; round += 1) {
    await session.clickTarget('title:gallery');
    await session.waitOverlay('gallery:cg');
    const open = await session.snapshot();
    await session.clickTarget('gallery:close');
    await session.waitTitle();
    const close = await session.snapshot();
    if (close.playerShell?.base !== 'title' || close.playerShell?.overlay !== 'none') throw new Error('标题 Gallery 关闭未回到 title root');
    rounds.push({ round, open: open.playerShell, close: close.playerShell });
  }
  return { rounds };
}

async function caseB(session) {
  await startGame(session);
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:settings');
  await session.waitOverlay('settings');
  const settings = await session.snapshot();
  await session.clickTarget('settings:close');
  await session.waitOverlay('system-menu');
  const returnedToMenu = await session.snapshot();
  if (returnedToMenu.playerShell?.overlay !== 'system-menu') throw new Error('settings 关闭未回 system-menu');
  await session.clickTarget('system:resume');
  await session.waitGame();
  const returnedToGame = await session.snapshot();
  if (!isIdleGame(returnedToGame)) throw new Error('system-menu 关闭未回 game root');
  return { settings: settings.playerShell, returnedToMenu: returnedToMenu.playerShell, returnedToGame: returnedToGame.playerShell };
}

async function caseC(session) {
  await startGame(session);
  await openSaveLoad(session, 'save');
  session.allowExpectedError(/player shell operation failed|存档索引读取或解析失败|存档写入失败/i, 'controlled save rejection');
  await session.writeSaveIndex('{"broken":');
  await session.clickTarget('save-load:slot-1');
  await session.waitFor('保存拒绝后恢复 idle', () => {
    const snapshot = window.__surdetDebug?.playerShell?.snapshot;
    return snapshot?.overlay === 'save-load' && snapshot?.operation === 'idle';
  });
  const rejected = await session.snapshot();
  if (rejected.playerShell?.overlay !== 'save-load' || rejected.activeOverlay !== 'save-load') throw new Error('保存拒绝后页面未保留');
  await session.writeSaveIndex('{}\n');
  await session.clickTarget('save-load:slot-1');
  await session.waitGame();
  const retried = await session.snapshot();
  if (!isIdleGame(retried)) throw new Error('保存重试成功后未清除 save-load');
  return {
    rejected: rejected.playerShell,
    retried: retried.playerShell,
    expectedFailureCount: session.events.consoleErrors.filter((value) => /player shell operation failed|存档索引读取或解析失败|存档写入失败/i.test(value)).length,
  };
}

async function caseD(session) {
  await startGame(session);
  await completeSaveLoad(session, 'save');
  await completeSaveLoad(session, 'load');
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:title');
  await session.waitTitle();
  const title = await session.snapshot();
  if (title.playerShell?.base !== 'title' || title.playerShell?.overlay !== 'none') throw new Error('load success → title 未清理旧 menu');
  return { title: title.playerShell, activeOverlay: title.activeOverlay };
}

async function caseE(session) {
  await session.prepareTitle();
  const snapshot = await session.snapshot();
  const bindings = snapshot.bindingSnapshot?.bindings ?? [];
  if (bindings.length !== 6 || bindings.some((binding) => binding.overridden !== false)) {
    throw new Error(`默认六槽注册表不满足：${JSON.stringify(snapshot.bindingSnapshot)}`);
  }
  return { bindingSnapshot: snapshot.bindingSnapshot };
}

async function caseF(session) {
  await startGame(session);
  const before = await session.snapshot();
  const beforeDialogueFills = before.themeProjection?.dialogue?.visibleTextFills ?? [];
  if (!beforeDialogueFills.includes(0xf2f6ff)) throw new Error('主题场景未找到已显示的正式对话文字');
  const collisionColor = 0x123456;
  await session.page.evaluate((color) => window.surdetDebug.commands.preferences.setTheme({ colors: { accent: color, text: color } }), collisionColor);
  await session.waitFor('同色主题投影', () => window.__surdetDebug?.theme?.colors?.accent === collisionColor
    && window.__surdetDebug?.theme?.colors?.text === collisionColor);
  const collision = await session.snapshot();
  const collisionDialogueFills = collision.themeProjection?.dialogue?.visibleTextFills ?? [];
  if (!collisionDialogueFills.includes(collisionColor)) throw new Error('已显示的正式对话文字未发生同色主题投影');
  await session.page.evaluate(() => window.surdetDebug.commands.preferences.setTheme({}));
  await session.waitFor('默认主题恢复', () => window.__surdetDebug?.theme?.colors?.accent === 0x5ac8ff
    && window.__surdetDebug?.theme?.colors?.text === 0xf2f6ff);
  const restored = await session.snapshot();
  const restoredDialogueFills = restored.themeProjection?.dialogue?.visibleTextFills ?? [];
  if (collision.theme?.colors?.accent !== collisionColor
    || collision.theme?.colors?.text !== collisionColor
    || restored.theme?.colors?.accent !== 0x5ac8ff
    || restored.theme?.colors?.text !== 0xf2f6ff) throw new Error('Theme command/query 未同步');
  if (!restoredDialogueFills.includes(0xf2f6ff)) throw new Error('默认主题恢复后正式对话文字未恢复');
  if (JSON.stringify(before.resources) !== JSON.stringify(collision.resources)
    || JSON.stringify(before.resources) !== JSON.stringify(restored.resources)) {
    throw new Error('Theme 切换增长了 Renderer 资源计数');
  }
  return {
    before: before.theme,
    collision: collision.theme,
    restored: restored.theme,
    themeProjection: {
      before: before.themeProjection?.dialogue,
      collision: collision.themeProjection?.dialogue,
      restored: restored.themeProjection?.dialogue,
    },
    resources: restored.resources,
  };
}

async function main() {
  buildFormalGame();
  const specifications = [
    ['A', 'title → gallery → close', caseA],
    ['B', 'game → system-menu → settings → close ×2', caseB],
    ['C', 'save reject → retry success', caseC],
    ['D', 'load success → title', caseD],
    ['E', 'default six-slot registry without override', caseE],
    ['F', 'colliding theme text/accent → restore default', caseF],
  ];
  const selected = smoke ? specifications.slice(0, 1) : specifications;
  const cases = [];
  for (const [caseId, label, action] of selected) {
    console.log(`BEGIN ${caseId} ${label}`);
    const result = await runCase(caseId, label, action);
    cases.push(result);
    if (result.ok) console.log(`PASS ${caseId} ${label}`);
    else console.error(`FAIL ${caseId} ${label}\n${result.error}`);
  }
  const evidence = {
    schemaVersion: 1,
    phase: 'Task 7 isolated player shell foundation acceptance matrix',
    runKind: smoke ? 'smoke' : 'formal',
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
      eachCaseFreshElectron: true,
      eachCaseFreshUserData: true,
    },
    cases,
    status: cases.length === selected.length && cases.every((entry) => entry.ok) ? 'PASSED' : 'FAILED',
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const evidenceSha256 = sha256File(evidencePath);
  const output = {
    evidencePath: path.resolve(evidencePath),
    evidenceBytes: fs.statSync(evidencePath).size,
    evidenceSha256,
    status: evidence.status,
    formalGame: evidence.formalGame,
    isolation: evidence.isolation,
    cases: cases.map(({ id, name, ok, userData }) => ({ id, name, ok, userData })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (evidence.status !== 'PASSED') process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
