/**
 * Player Shell Foundation Wave 3 — real Electron A–F matrix, plus Pass 9 restart case G.
 *
 * Every case uses an isolated userData root; G reuses its root across two fresh processes.
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
const pass9 = process.argv.includes('--pass9');
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

async function launchSession(caseId, userDataOverride = null) {
  const caseRoot = path.join(tempRoot, caseId);
  const userData = userDataOverride ?? path.join(caseRoot, 'user-data');
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
  app.context().setDefaultTimeout(20000);
  let page;
  try {
    page = await app.firstWindow();
  } catch (error) {
    await app.close();
    throw error;
  }
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

  try {
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
    session.identity = await app.evaluate(({ app, BrowserWindow }) => ({
      userData: app.getPath('userData'),
      windowCount: BrowserWindow.getAllWindows().length,
    }));
    session.identity.pid = app.process().pid;
    if (path.relative(userData, session.identity.userData) !== '' || session.identity.windowCount !== 1) {
      throw new Error(`Electron 启动身份不符：${JSON.stringify(session.identity)}`);
    }
    return session;
  } catch (error) {
    try { await closeSession(session); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `Electron ${caseId} 启动与清理失败`); }
    throw error;
  }
}

async function closeSession(session) {
  session.events.intentionalClose = true;
  session.markClosing();
  const child = session.app.process();
  await withWatchdog(`关闭 Electron ${session.caseId}`, () => session.app.close(), 20000);
  await withWatchdog(`等待 Electron ${session.caseId} 进程退出`, () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    return new Promise((resolve) => child.once('exit', resolve));
  });
  if (child.exitCode !== 0 || child.signalCode !== null) {
    throw new Error(`Electron ${session.caseId} 非正常退出：pid=${child.pid} code=${child.exitCode} signal=${child.signalCode}`);
  }
  await session.assertNoRuntimeError(`${session.caseId} 关闭期间`);
  return { pid: child.pid, exitCode: child.exitCode, signal: child.signalCode, closed: true };
}

async function runCase(caseId, label, action) {
  const startedAt = Date.now();
  let session = null;
  let result;
  try {
    session = await launchSession(caseId);
    const before = await session.snapshot();
    const details = await action(session);
    const after = await session.snapshot();
    const audit = await session.assertNoRuntimeError(label);
    result = {
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
    result = {
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
    if (session) {
      try {
        result.lifecycle = await closeSession(session);
        result.events = (await session.auditErrors(null)).events;
      } catch (error) {
        result.ok = false;
        result.cleanupError = errorText(error);
        result.events = (await session.auditErrors(null)).events;
      }
    }
  }
  return result;
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
  const before = await session.snapshot();
  session.allowExpectedError(/player shell operation failed|存档索引读取或解析失败|存档写入失败/i, 'controlled save rejection');
  await session.writeSaveIndex('{"broken":');
  await session.clickTarget('save-load:slot-1');
  await session.waitFor('保存拒绝后恢复 idle', () => {
    const snapshot = window.__surdetDebug?.playerShell?.snapshot;
    return snapshot?.overlay === 'save-load' && snapshot?.operation === 'idle';
  });
  const rejected = await session.snapshot();
  if (rejected.playerShell?.overlay !== 'save-load' || rejected.activeOverlay !== 'save-load') throw new Error('保存拒绝后页面未保留');
  if (positionKey(rejected.position) !== positionKey(before.position)) throw new Error('保存拒绝改变了原解释器位置');
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
  const defaultTheme = before.theme;
  if (!defaultTheme?.colors) throw new Error('无法读取进入 Case F 时的默认主题');
  const defaultAccent = defaultTheme.colors.accent;
  const defaultText = defaultTheme.colors.text;
  const beforeDialogueFills = before.themeProjection?.dialogue?.visibleTextFills ?? [];
  if (!beforeDialogueFills.includes(defaultText)) throw new Error('主题场景未找到已显示的正式对话文字');
  const collisionColor = 0x123456;
  if (collisionColor === defaultAccent || collisionColor === defaultText) throw new Error('碰撞测试色不得等于默认主题');
  await session.page.evaluate((color) => window.surdetDebug.commands.preferences.setTheme({ colors: { accent: color, text: color } }), collisionColor);
  await session.waitFor('同色主题投影', () => window.__surdetDebug?.theme?.colors?.accent === 0x123456
    && window.__surdetDebug?.theme?.colors?.text === 0x123456);
  const collision = await session.snapshot();
  const collisionDialogueFills = collision.themeProjection?.dialogue?.visibleTextFills ?? [];
  if (!collisionDialogueFills.includes(collisionColor)) throw new Error('已显示的正式对话文字未发生同色主题投影');
  await session.page.evaluate(() => window.surdetDebug.commands.preferences.setTheme({}));
  await session.waitFor('默认主题恢复', (expected) => {
    const colors = window.__surdetDebug?.theme?.colors;
    return colors?.accent === expected.accent && colors?.text === expected.text;
  }, { accent: defaultAccent, text: defaultText });
  const restored = await session.snapshot();
  const restoredDialogueFills = restored.themeProjection?.dialogue?.visibleTextFills ?? [];
  if (collision.theme?.colors?.accent !== collisionColor
    || collision.theme?.colors?.text !== collisionColor
    || restored.theme?.colors?.accent !== defaultAccent
    || restored.theme?.colors?.text !== defaultText) throw new Error('Theme command/query 未同步');
  if (!restoredDialogueFills.includes(defaultText)) throw new Error('默认主题恢复后正式对话文字未恢复');
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
async function runRestartCase() {
  const startedAt = Date.now();
  const caseId = 'G';
  const label = 'same userData save → close → relaunch → accessible title load';
  const caseRoot = path.join(tempRoot, caseId);
  const userData = path.join(caseRoot, 'user-data');
  const screenshots = {
    beforeRestart: path.join(caseRoot, 'pass9-before-restart.png'),
    afterRestart: path.join(caseRoot, 'pass9-after-restart.png'),
  };
  fs.mkdirSync(caseRoot, { recursive: true });
  let first = null;
  let second = null;
  let firstAudit = null;
  let secondAudit = null;
  let firstIdentity = null;
  let secondIdentity = null;
  let firstClosed = null;
  let secondClosed = null;
  try {
    first = await launchSession('G-first', userData);
    firstIdentity = first.identity;
    await startGame(first);
    await first.waitFor('Pass 8 正式对白已显示', () => {
      const debug = window.__surdetDebug;
      return Boolean(debug?.dialogueProjection?.dialogText?.length)
        && debug?.playerShell?.snapshot?.operation === 'idle';
    });
    const initialPosition = (await first.snapshot()).position;
    let saved = await first.snapshot();
    for (let attempt = 0; attempt < 4 && positionKey(saved.position) === positionKey(initialPosition); attempt += 1) {
      const point = await first.canvasPoint(640, 360);
      if (!point) throw new Error('找不到正式游戏画布');
      await first.page.mouse.click(point.x, point.y);
      await first.waitForPresentedFrame('推进到非初始保存点');
      await first.waitGame();
      saved = await first.snapshot();
    }
    if (positionKey(saved.position) === positionKey(initialPosition)) throw new Error('保存点仍是新游戏初始位置');
    await completeSaveLoad(first, 'save');
    await first.page.screenshot({ path: screenshots.beforeRestart });
    firstAudit = await first.assertNoRuntimeError('G first session');
    const savedFiles = fs.readdirSync(path.join(userData, 'saves')).filter((name) => name.endsWith('.json'));
    const savedSlot = savedFiles.filter((name) => name !== 'index.json')
      .map((name) => JSON.parse(fs.readFileSync(path.join(userData, 'saves', name), 'utf8')))
      .find((snapshot) => snapshot.meta?.id === '1');
    if (!savedSlot || JSON.stringify(savedSlot.position) !== JSON.stringify(saved.position)) {
      throw new Error('真实槽位 1 文件未保存当前剧情位置');
    }
    firstClosed = await closeSession(first);
    firstAudit = await first.auditErrors(null);
    first = null;

    second = await launchSession('G-second', userData);
    secondIdentity = second.identity;
    if (secondIdentity.pid === firstIdentity.pid || secondIdentity.userData !== firstIdentity.userData) {
      throw new Error(`Electron 重启身份不符：${JSON.stringify({ firstIdentity, secondIdentity })}`);
    }
    await second.waitTitle();
    if (second.app.windows().length !== 1) throw new Error(`重启后主窗口数量异常：${second.app.windows().length}`);
    await second.page.evaluate(() => {
      window.__pass9LoadClicks = [];
      document.addEventListener('click', (event) => {
        const label = event.target instanceof Element
          ? event.target.closest('button')?.getAttribute('aria-label') : null;
        if (label === '读取存档' || label?.startsWith('读取槽位 1：')) window.__pass9LoadClicks.push(label);
      }, true);
    });
    const loadTitle = second.page.getByRole('button', { name: '读取存档', exact: true });
    await loadTitle.waitFor();
    await loadTitle.focus();
    await second.press('Enter');
    await second.waitOverlay('save-load');
    const slot = second.page.getByRole('button', { name: /^读取槽位 1：/ });
    await slot.waitFor();
    await slot.focus();
    await second.press('Enter');
    await second.waitGame();
    const loaded = await second.snapshot();
    const keyboardClicks = await second.page.evaluate(() => window.__pass9LoadClicks);
    if (keyboardClicks.length !== 2 || keyboardClicks[0] !== '读取存档' || !keyboardClicks[1].startsWith('读取槽位 1：')) {
      throw new Error(`键盘读档控件未各激活一次：${JSON.stringify(keyboardClicks)}`);
    }
    if (second.app.windows().length !== 1 || await second.page.locator('canvas').count() !== 1) {
      throw new Error('重启读档后存在重复主窗口或渲染画布');
    }
    if (positionKey(loaded.position) !== positionKey(saved.position)
      || loaded.position?.sceneHash !== saved.position?.sceneHash) {
      throw new Error(`重启读档位置不一致：saved=${positionKey(saved.position)} loaded=${positionKey(loaded.position)}`);
    }
    if (loaded.playerShell?.returnStack?.length !== 0) throw new Error('重启读档后仍有旧返回栈');
    const bindings = loaded.bindingSnapshot?.bindings ?? [];
    const expectedSlots = ['title', 'system-menu', 'save-load', 'settings', 'gallery', 'backlog'];
    if (JSON.stringify(bindings.map((entry) => entry.slot)) !== JSON.stringify(expectedSlots)
      || bindings.some((entry) => entry.overridden !== false)) {
      throw new Error(`重启后的默认六槽注册表异常：${JSON.stringify(loaded.bindingSnapshot)}`);
    }

    await second.press('Escape');
    await second.waitOverlay('system-menu');
    await second.clickTarget('system:settings');
    await second.waitOverlay('settings');
    await second.page.screenshot({ path: screenshots.afterRestart });
    await second.clickTarget('settings:close');
    await second.waitOverlay('system-menu');
    await second.clickTarget('system:resume');
    await second.waitGame();
    const returned = await second.snapshot();
    if (!isIdleGame(returned) || returned.playerShell?.returnStack?.length !== 0) {
      throw new Error('重启读档后设置返回链没有回到干净的游戏状态');
    }
    secondAudit = await second.assertNoRuntimeError('G second session');
    secondClosed = await closeSession(second);
    secondAudit = await second.auditErrors(null);
    second = null;

    return {
      id: caseId,
      name: label,
      ok: true,
      durationMs: Date.now() - startedAt,
      userData,
      before: saved,
      after: returned,
      events: {
        first: firstAudit.events,
        second: secondAudit.events,
      },
      details: {
        initialPosition,
        savedPosition: saved.position,
        savedSlotPosition: savedSlot.position,
        loadedPosition: loaded.position,
        bindings: loaded.bindingSnapshot,
        screenshots,
        savedFiles,
        sessions: { first: firstIdentity, second: secondIdentity },
        shutdown: { first: firstClosed, second: secondClosed },
        sameUserData: firstIdentity.userData === secondIdentity.userData,
        accessibleKeyboardLoad: true,
        keyboardClicks,
      },
    };
  } catch (error) {
    const after = second ? await second.snapshot().catch(() => null)
      : first ? await first.snapshot().catch(() => null) : null;
    const cleanupErrors = [];
    for (const session of [first, second]) {
      if (!session || session.app.process().exitCode !== null) continue;
      try { await closeSession(session); }
      catch (cleanupError) { cleanupErrors.push(errorText(cleanupError)); }
    }
    return {
      id: caseId,
      name: label,
      ok: false,
      durationMs: Date.now() - startedAt,
      userData,
      error: errorText(error),
      after,
      cleanupErrors,
      events: {
        first: firstAudit?.events ?? cloneJson(first?.events ?? null),
        second: secondAudit?.events ?? cloneJson(second?.events ?? null),
      },
      details: { screenshots, sessions: { first: firstIdentity, second: secondIdentity }, shutdown: { first: firstClosed, second: secondClosed } },
    };
  }
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
    else console.error(`FAIL ${caseId} ${label}\n${result.error ?? result.cleanupError}`);
  }
  if (pass9 && !smoke) {
    console.log('BEGIN G same userData restart/load');
    const result = await runRestartCase();
    cases.push(result);
    if (result.ok) console.log(`PASS G ${result.name}`);
    else console.error(`FAIL G ${result.name}\n${result.error}`);
  }
  const evidence = {
    schemaVersion: 1,
    phase: pass9 ? 'Frontend Pass 9 Host/Shell consumer acceptance' : 'Task 7 isolated player shell foundation acceptance matrix',
    runKind: smoke ? 'smoke' : pass9 ? 'pass9' : 'formal',
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
    status: cases.length === selected.length + (pass9 && !smoke ? 1 : 0)
      && cases.every((entry) => entry.ok) ? 'PASSED' : 'FAILED',
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
