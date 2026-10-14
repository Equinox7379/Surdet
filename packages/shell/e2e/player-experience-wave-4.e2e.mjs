/**
 * Surdet Player Experience Wave 4 — real-player acceptance matrix.
 *
 * This runner is deliberately pinned to the formal Zero dist. Every case gets
 * a fresh Electron process and an isolated userData directory. Semantic debug
 * reads are evidence only; tested actions are implemented with real keyboard
 * and mouse input in the case functions below.
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
const caseArgumentIndex = process.argv.indexOf('--case');
const selectedCase = caseArgumentIndex >= 0 ? process.argv[caseArgumentIndex + 1] : null;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-player-experience-wave-4-'));
const evidencePath = path.join(
  tempRoot,
  smoke ? 'player-experience-wave-4-smoke.json' : `player-experience-wave-4-${Date.now()}.json`,
);

const buildSteps = [
  ['run', 'build', '-w', '@surdet/core'],
  ['run', 'build', '-w', '@surdet/renderer'],
  ['run', 'build', '-w', '@surdet/host'],
  ['run', 'build', '-w', '@surdet/shell'],
  ['run', 'build', '-w', 'zero-after-midnight'],
];

const caseIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

function currentGitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    env: { ...process.env },
    shell: false,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`无法读取当前 Git HEAD（exit=${result.status}）：${result.stderr ?? ''}`);
  const head = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(head)) throw new Error(`git rev-parse HEAD 返回非法值：${head}`);
  return head;
}

const runHead = currentGitHead();

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmInvocation(args) {
  const configuredNpmCli = process.env.npm_execpath;
  const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = configuredNpmCli || (fs.existsSync(bundledNpmCli) ? bundledNpmCli : null);
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

function positionKey(position) {
  return position ? `${position.sceneId}:${position.pc}` : 'null';
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function emptyEvents() {
  return {
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    unhandledRejections: [],
    rendererErrors: [],
    releaseFailures: [],
    unexpectedWindowClosed: false,
  };
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
  const events = emptyEvents();
  const screenshots = [];
  let closing = false;

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
    else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
    else if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
    else events.consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    const text = errorText(error);
    if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
    else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
    else events.pageErrors.push(text);
  });
  page.on('requestfailed', (request) => {
    events.requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('close', () => {
    if (!closing) events.unexpectedWindowClosed = true;
  });

  await page.evaluate(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      console.error(`[e2e-unhandledrejection] ${reason}`);
    });
  });

  const session = {
    caseId,
    caseRoot,
    userData,
    app,
    page,
    events,
    identity: null,
    lastSnapshot: null,
    async snapshot() {
      if (page.isClosed()) return null;
      const snapshot = await page.evaluate(() => {
        const debug = window.__surdetDebug;
        return {
          title: document.title,
          status: debug?.status ?? null,
          rendererStatus: debug?.rendererStatus ?? null,
          position: debug?.position ?? null,
          uiSession: debug?.uiSession ?? null,
          activeOverlay: debug?.activeOverlay ?? null,
          dialogueProjection: debug?.dialogueProjection ?? null,
          presentationSnapshot: debug?.presentationSnapshot ?? null,
          commandRailVisible: debug?.dialogueProjection?.commandRailVisible ?? null,
          galleryProjection: debug?.galleryProjection ?? null,
          resources: debug?.resourceSnapshot ?? null,
          lastRendererError: debug?.lastRendererError ?? null,
          assetLoading: debug?.assetLoading ?? null,
          interactionTargets: debug?.interactionTargets ?? null,
        };
      });
      this.lastSnapshot = snapshot;
      return snapshot;
    },
    async waitFor(label, predicate, arg = undefined, timeoutMs = 15000) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法等待：${label}`);
      return page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    },
    async waitForAssets() {
      await this.waitFor('Renderer semantic debug surface', () => window.__surdetDebug?.uiSession !== undefined, undefined, 30000);
      await this.waitFor('formal Zero assets', () => {
        const progress = window.__surdetDebug?.assetLoading;
        return progress?.done === true && progress.total > 0
          && progress.completed === progress.total && progress.failed === 0;
      }, undefined, 120000);
    },
    async waitTitle() {
      await this.waitFor('formal Zero title', () => window.__surdetDebug?.uiSession?.base === 'title');
      await this.waitFor('title overlay', () => window.__surdetDebug?.activeOverlay === 'title');
      await this.waitFor('title gallery target', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:gallery'));
    },
    async waitOverlay(expected) {
      await this.waitFor(`overlay ${expected}`, (value) => window.__surdetDebug?.activeOverlay === value, expected);
    },
    async waitForPresentedFrame(label) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (page.isClosed()) throw new Error(`窗口已关闭：${label}`);
    },
    async canvasPoint(logicalX, logicalY) {
      return page.evaluate(({ logicalX: x, logicalY: y }) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + (x / 1280) * rect.width, y: rect.top + (y / 720) * rect.height };
      }, { logicalX, logicalY });
    },
    async clickLogical(logicalX, logicalY, label) {
      const point = await this.canvasPoint(logicalX, logicalY);
      if (!point) throw new Error(`找不到正式游戏画布：${label}`);
      await page.mouse.click(point.x, point.y);
      await this.waitForPresentedFrame(label);
    },
    async clickTarget(targetId) {
      const target = await page.evaluate((id) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === id);
        const canvas = document.querySelector('canvas');
        if (!target || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
          y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
        };
      }, targetId);
      if (!target) throw new Error(`找不到语义交互目标：${targetId}`);
      await page.mouse.click(target.x, target.y);
      await this.waitForPresentedFrame(targetId);
    },
    async hoverTarget(targetId) {
      const target = await page.evaluate((id) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === id);
        const canvas = document.querySelector('canvas');
        if (!target || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
          y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
        };
      }, targetId);
      if (!target) throw new Error(`找不到语义交互目标：${targetId}`);
      await page.mouse.move(target.x, target.y);
      await this.waitForPresentedFrame(`悬停 ${targetId}`);
    },
    async press(key) {
      if (key === 'F11') {
        await app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.focus();
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
        });
      } else {
        await page.keyboard.press(key);
      }
      await this.waitForPresentedFrame(`按键 ${key}`);
    },
    async wheel(deltaY, label) {
      await page.mouse.wheel(0, deltaY);
      await this.waitForPresentedFrame(label);
    },
    async advanceStoryStep(label) {
      const before = await this.snapshot();
      const expectedPosition = positionKey(before?.position);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await this.waitFor(`${label} 等待剧情输入`, () => {
          const debug = window.__surdetDebug;
          return ['awaiting-advance', 'awaiting-timer', 'choice'].includes(debug?.status)
            || debug?.rendererStatus === 'choice';
        }, undefined, 12000);
        const inputKey = await page.evaluate(() => {
          const debug = window.__surdetDebug;
          // A fresh choice has no highlighted cursor yet; select the first
          // visible option through the same real keyboard contract a player
          // can use, instead of repeatedly sending an unbound confirmation.
          return debug?.status === 'choice' || debug?.rendererStatus === 'choice' ? '1' : 'Space';
        });
        await this.press(inputKey);
        try {
          await this.waitFor(`${label} 解释器位置变化`, (positionKeyExpected) => {
            const position = window.__surdetDebug?.position;
            return position
              ? `${position.sceneId}:${position.pc}` !== positionKeyExpected
              : positionKeyExpected !== 'null';
          }, expectedPosition, 5000);
          await this.waitFor('剧情空闲或等待', () => {
            const debug = window.__surdetDebug;
            return debug?.uiSession?.base === 'game'
              && debug?.uiSession?.overlay === 'none'
              && debug?.uiSession?.operation === 'idle'
              && debug?.activeOverlay === null;
          }, undefined, 12000);
          await this.waitFor('剧情表现投影完成', () => window.__surdetDebug?.rendererStatus !== 'typing', undefined, 20000);
          return { before, after: await this.snapshot(), attempts: attempt };
        } catch {
          // A real ADV input can first finish a typewriter/timer boundary.
          // Keep the same real key path and retain the final failure if it never advances.
        }
      }
      throw new Error(`${label} 连续 4 次真实 Space 后位置仍为 ${expectedPosition}`);
    },
    async captureCanvas(label) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法截图：${label}`);
      const canvas = await page.locator('canvas').boundingBox();
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        throw new Error(`找不到可见正式游戏画布：${label}`);
      }
      const screenshotDir = path.join(caseRoot, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const safeLabel = String(label).replace(/[^a-z0-9._-]+/gi, '-');
      const screenshotPath = path.join(screenshotDir, `${safeLabel}.png`);
      await page.screenshot({ path: screenshotPath, clip: canvas, animations: 'disabled' });
      const pixelDataUrl = await page.evaluate(() => {
        const target = document.querySelector('canvas');
        return target ? target.toDataURL('image/png') : null;
      });
      const screenshotSha256 = sha256File(screenshotPath);
      const evidence = {
        label,
        path: screenshotPath,
        bytes: fs.statSync(screenshotPath).size,
        screenshotSha256,
        // The clip is exactly the rendered game canvas, so the PNG byte hash
        // is the stable raster/pixel hash for this evidence. Keep the browser
        // canvas data-url hash separately: Electron's WebGL readback can stay
        // stale even when the composited canvas screenshot has changed.
        pixelHash: screenshotSha256,
        pixelHashMethod: 'sha256(clipped-rendered-canvas-PNG-bytes)',
        canvasDataUrlHash: pixelDataUrl
          ? crypto.createHash('sha256').update(pixelDataUrl).digest('hex')
          : null,
      };
      screenshots.push(evidence);
      return evidence;
    },
    async captureCanvasRegion(label, logicalX, logicalY, logicalWidth, logicalHeight) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法局部截图：${label}`);
      const canvas = await page.locator('canvas').boundingBox();
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        throw new Error(`找不到可见正式游戏画布：${label}`);
      }
      const scaleX = canvas.width / 1280;
      const scaleY = canvas.height / 720;
      const clip = {
        x: canvas.x + logicalX * scaleX,
        y: canvas.y + logicalY * scaleY,
        width: logicalWidth * scaleX,
        height: logicalHeight * scaleY,
      };
      const screenshotDir = path.join(caseRoot, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const safeLabel = String(label).replace(/[^a-z0-9._-]+/gi, '-');
      const screenshotPath = path.join(screenshotDir, `${safeLabel}.png`);
      await page.screenshot({ path: screenshotPath, clip, animations: 'disabled' });
      const screenshotSha256 = sha256File(screenshotPath);
      const evidence = {
        label,
        path: screenshotPath,
        bytes: fs.statSync(screenshotPath).size,
        screenshotSha256,
        pixelHash: screenshotSha256,
        pixelHashMethod: 'sha256(clipped-rendered-canvas-PNG-bytes)',
        logicalRect: { x: logicalX, y: logicalY, width: logicalWidth, height: logicalHeight },
        viewportRect: clip,
      };
      screenshots.push(evidence);
      return evidence;
    },
    async viewportEvidence(label) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法读取 viewport：${label}`);
      return page.evaluate((evidenceLabel) => {
        const canvas = document.querySelector('canvas');
        const rect = canvas?.getBoundingClientRect() ?? null;
        return {
          label: evidenceLabel,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio,
          canvas: rect ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            aspectRatio: rect.width / Math.max(1, rect.height),
          } : null,
        };
      }, label);
    },
    async targetBounds(targetId) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法读取交互目标：${targetId}`);
      return page.evaluate((id) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === id);
        const canvas = document.querySelector('canvas');
        if (!target || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          id,
          logical: { x: target.x, y: target.y, width: target.width, height: target.height },
          viewport: {
            x: rect.left + (target.x / 1280) * rect.width,
            y: rect.top + (target.y / 720) * rect.height,
            width: (target.width / 1280) * rect.width,
            height: (target.height / 720) * rect.height,
          },
        };
      }, targetId);
    },
    async waitForStableCanvas(label) {
      let previous = null;
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        await this.waitForPresentedFrame(`${label}-settle-${attempt}`);
        const current = await this.captureCanvas(`${label}-${attempt}`);
        if (previous && current.pixelHash === previous.pixelHash) return current;
        previous = current;
      }
      if (previous) {
        throw new Error(`画布在点击前未稳定：${label}（最后 pixelHash=${previous.pixelHash}）`);
      }
      throw new Error(`画布在点击前没有可用截图：${label}`);
    },
    screenshots,
    async close() {
      closing = true;
      await app.close();
    },
  };

  return session;
}

async function prepareSession(session) {
  await session.waitForAssets();
  session.identity = await session.snapshot();
  return session.identity;
}

function caseEvidence(session, caseId, ok, assertions, error = null) {
  const identity = session?.identity ?? { title: null, assetLoading: null };
  const assetLoading = identity.assetLoading ?? null;
  const assetComplete = assetLoading?.done === true
    && assetLoading.total > 0
    && assetLoading.completed === assetLoading.total
    && assetLoading.failed === 0;
  const evidence = {
    id: caseId,
    ok: ok && assetComplete,
    title: identity.title ?? null,
    sourceRoot: gameSourceRoot,
    distRoot: path.resolve(gameDist),
    userData: session?.userData ?? path.join(tempRoot, caseId, 'user-data'),
    assetLoading: identity.assetLoading,
    assetComplete,
    assertions: {
      ...cloneJson(assertions),
      lastSnapshot: cloneJson(session?.lastSnapshot),
    },
    events: cloneJson(session?.events ?? emptyEvents()),
    screenshots: cloneJson(session?.screenshots ?? []),
  };
  if (error) {
    evidence.error = errorText(error);
    evidence.errorStack = error instanceof Error ? error.stack ?? null : null;
  }
  return evidence;
}

async function finalizeCase(session, evidence) {
  if (!session) return;
  try { await session.close(); }
  catch (error) { session.events.consoleErrors.push(`close: ${errorText(error)}`); }
  if (!evidence) return;
  evidence.events = cloneJson(session.events);
  const eventsClear = Object.entries(evidence.events).every(([key, value]) => key === 'unexpectedWindowClosed' ? value === false : value.length === 0);
  evidence.ok = evidence.ok && eventsClear;
}

async function runSmokeCase() {
  let session;
  let evidence;
  try {
    session = await launchSession('smoke');
    await prepareSession(session);
    await session.waitTitle();
    return evidence = caseEvidence(session, 'A', true, { smoke: true, formalGame: true });
  } catch (error) {
    return evidence = caseEvidence(session, 'A', false, { smoke: true, formalGame: true }, error);
  } finally {
    await finalizeCase(session, evidence);
  }
}

async function startFormalGame(session) {
  await session.waitTitle();
  await session.clickTarget('title:new');
  await session.waitFor('正式游戏剧情入口', () => window.__surdetDebug?.uiSession?.base === 'game'
    && window.__surdetDebug?.position !== null
    && window.__surdetDebug?.activeOverlay === null);
  return session.snapshot();
}

async function openGameSaveLoad(session, mode) {
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget(`system:${mode}`);
  await session.waitOverlay(`save-load`);
}

async function selectSaveLoadSlot(session, mode, slotId = '1') {
  await openGameSaveLoad(session, mode);
  await session.clickTarget(`save-load:slot-${slotId}`);
  if (mode === 'save') {
    const confirmation = session.page.getByRole('button', { name: '覆盖存档', exact: true });
    if (await confirmation.isVisible()) await confirmation.press('Enter');
  }
  await session.waitFor(`${mode} 槽位完成`, (expectedMode) => {
    const debug = window.__surdetDebug;
    return debug?.activeOverlay === null
      && debug?.uiSession?.operation === 'idle'
      && (expectedMode !== 'load' || debug?.uiSession?.base === 'game');
  }, mode, 20000);
  if (mode === 'load') {
    // The host transaction can become idle before the restored dialogue
    // projection finishes its typewriter transition. Capture only after the
    // public renderer state leaves that transient phase; this is a semantic
    // readiness condition, not a fixed delay.
    await session.waitFor('读档表现投影完成', () => {
      const debug = window.__surdetDebug;
      return debug?.rendererStatus !== 'typing';
    }, undefined, 20000);
  }
  return session.snapshot();
}

async function openTitleLoad(session) {
  await session.waitTitle();
  await session.clickTarget('title:load');
  await session.waitOverlay('save-load');
  await session.clickTarget('save-load:slot-1');
  await session.waitFor('标题读档进入游戏', () => window.__surdetDebug?.uiSession?.base === 'game'
    && window.__surdetDebug?.uiSession?.overlay === 'none'
    && window.__surdetDebug?.position !== null);
  return session.snapshot();
}

function presentationWorld(snapshot) {
  const stage = snapshot?.presentationSnapshot?.stage ?? null;
  return {
    backgroundKey: stage?.backgroundKey ?? null,
    portraits: cloneJson(stage?.portraits ?? []),
    portraitProjection: portraitProjection(snapshot),
    dialogueText: snapshot?.dialogueProjection?.dialogText ?? null,
    speakerText: snapshot?.dialogueProjection?.speakerText ?? null,
  };
}

function portraitProjection(snapshot) {
  const portraits = snapshot?.presentationSnapshot?.stage?.portraits;
  if (!Array.isArray(portraits)) return [];
  return portraits.map((portrait) => ({
    key: portrait?.key ?? null,
    character: portrait?.view?.charId ?? null,
    costume: portrait?.view?.costume ?? null,
    expression: portrait?.view?.expression ?? null,
    position: portrait?.view?.pos ?? null,
    // WorldPresentationSnapshot contains projected portraits only; an entry
    // therefore represents a visible World portrait in the public query.
    visible: true,
  }));
}

function visualWorldKey(snapshot) {
  const world = presentationWorld(snapshot);
  return JSON.stringify({ backgroundKey: world.backgroundKey, portraitProjection: world.portraitProjection });
}

function assertWorldWithPortraits(snapshot, label) {
  const world = presentationWorld(snapshot);
  if (world.backgroundKey === null) {
    throw new Error(`${label} 缺少背景：${JSON.stringify(world)}`);
  }
  if (!Array.isArray(world.portraits) || world.portraits.length < 1) {
    throw new Error(`${label} 没有真实立绘投影：${JSON.stringify({ snapshot, world })}`);
  }
  if (world.portraitProjection.some((portrait) => Object.values(portrait).some((value) => value === null))) {
    throw new Error(`${label} 立绘投影字段不完整：${JSON.stringify(world.portraitProjection)}`);
  }
  return world;
}

function assertRestoredState(before, after, label) {
  const beforeWorld = presentationWorld(before);
  const afterWorld = presentationWorld(after);
  if (JSON.stringify(afterWorld) !== JSON.stringify(beforeWorld)) {
    throw new Error(`${label} World/Dialogue/portrait projection 未完整恢复：${JSON.stringify({ beforeWorld, afterWorld })}`);
  }
  if (positionKey(after?.position) !== positionKey(before?.position)) {
    throw new Error(`${label} 剧情位置未恢复：${JSON.stringify({ before: before?.position, after: after?.position })}`);
  }
  if (after?.commandRailVisible !== before?.commandRailVisible
    || after?.activeOverlay !== before?.activeOverlay
    || after?.uiSession?.base !== before?.uiSession?.base
    || after?.uiSession?.overlay !== before?.uiSession?.overlay
    || after?.uiSession?.operation !== 'idle'
    || after?.lastRendererError !== null) {
    throw new Error(`${label} command rail/overlay/session 未恢复或未收敛：${JSON.stringify({ before, after })}`);
  }
}

async function advanceUntilPortraits(session, label, maxSteps = 80) {
  const progression = [];
  let current = await session.snapshot();
  if (presentationWorld(current).portraits.length >= 1) {
    return { snapshot: current, progression, advances: 0 };
  }
  for (let index = 0; index < maxSteps; index += 1) {
    const step = await session.advanceStoryStep(`${label} ${index + 1}`);
    progression.push(step);
    current = step.after;
    if (presentationWorld(current).portraits.length >= 1) {
      assertWorldWithPortraits(current, `${label} 完成`);
      return { snapshot: current, progression, advances: index + 1 };
    }
  }
  throw new Error(`${label} 在 ${maxSteps} 次真实推进后仍没有立绘：${JSON.stringify(current)}`);
}

async function advanceUntilVisualChange(session, referenceSnapshot, label, maxSteps = 80) {
  const referenceKey = visualWorldKey(referenceSnapshot);
  const progression = [];
  let current = referenceSnapshot;
  for (let index = 0; index < maxSteps; index += 1) {
    const step = await session.advanceStoryStep(`${label} ${index + 1}`);
    progression.push(step);
    current = step.after;
    if (visualWorldKey(current) !== referenceKey) {
      return { snapshot: current, progression, advances: index + 1 };
    }
  }
  throw new Error(`${label} 在 ${maxSteps} 次真实推进后没有改变背景或立绘：${JSON.stringify(current)}`);
}

function assertWorldPresent(snapshot, label) {
  const world = presentationWorld(snapshot);
  if (world.backgroundKey === null && world.portraits.length === 0 && !world.dialogueText) {
    throw new Error(`${label} 没有可验证的 World/Dialogue 表现：${JSON.stringify({ snapshot, world })}`);
  }
  return world;
}

async function returnToTitleFromGame(session) {
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:title');
  await session.waitTitle();
  return session.snapshot();
}

async function runBacklogCase(session) {
  await session.waitTitle();
  await session.clickTarget('title:new');
  await session.waitFor('正式游戏剧情入口', () => window.__surdetDebug?.uiSession?.base === 'game'
    && window.__surdetDebug?.position !== null);
  const initial = await session.snapshot();
  const progression = [];
  for (let index = 0; index < 18; index += 1) {
    progression.push(await session.advanceStoryStep(`Backlog 种子文本 ${index + 1}`));
  }

  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:backlog');
  await session.waitOverlay('backlog');
  const before = await session.snapshot();
  const beforeCanvas = await session.captureCanvas('backlog-before-scroll');
  const beforeLayout = before?.dialogueProjection?.backlogLayout ?? null;
  if (before?.dialogueProjection?.backlogVisible !== true) {
    throw new Error(`真实 Backlog 未显示：${JSON.stringify(before?.dialogueProjection)}`);
  }
  if (!beforeLayout || beforeLayout.hasMask !== true || beforeLayout.viewportTop <= beforeLayout.headerY) {
    throw new Error(`Backlog fixed-header/layout projection 无效：${JSON.stringify(beforeLayout)}`);
  }
  if (beforeLayout.contentHeight <= beforeLayout.viewportBottom - beforeLayout.viewportTop) {
    throw new Error(`Backlog 种子不足以验证正文裁剪：${JSON.stringify(beforeLayout)}`);
  }

  await session.wheel(720, '真实 Backlog 滚轮');
  await session.press('PageDown');
  const after = await session.snapshot();
  const afterCanvas = await session.captureCanvas('backlog-after-scroll');
  const afterLayout = after?.dialogueProjection?.backlogLayout ?? null;
  if (!afterLayout) throw new Error('Backlog 滚动后缺少布局投影');
  if (afterLayout.headerY !== beforeLayout.headerY
    || afterLayout.viewportTop !== beforeLayout.viewportTop
    || afterLayout.viewportBottom !== beforeLayout.viewportBottom) {
    throw new Error(`Backlog header/viewport 滚动后发生位移：${JSON.stringify({ beforeLayout, afterLayout })}`);
  }
  if (afterLayout.scroll >= beforeLayout.scroll) {
    throw new Error(`Backlog 真实滚轮/PageDown 未改变正文滚动：${JSON.stringify({ beforeLayout, afterLayout })}`);
  }

  const backlogPosition = positionKey(before.position);
  await session.clickTarget('backlog:close');
  await session.waitFor('Backlog 关闭', () => window.__surdetDebug?.activeOverlay === null);
  const afterClose = await session.snapshot();
  if (positionKey(afterClose?.position) !== backlogPosition) {
    throw new Error(`Backlog 关闭推进了剧情：${JSON.stringify({ backlogPosition, afterClose })}`);
  }
  return {
    source: 'game',
    path: ['title:new', 'story:advance×18', 'system:backlog', 'backlog:wheel', 'backlog:PageDown', 'backlog:close'],
    initialPosition: initial?.position ?? null,
    progression: progression.map((step) => ({
      before: step.before?.position ?? null,
      after: step.after?.position ?? null,
      text: step.after?.dialogueProjection?.dialogText ?? null,
      attempts: step.attempts,
    })),
    beforeLayout,
    afterLayout,
    beforeCanvas,
    afterCanvas,
    backlogPosition,
    closePosition: afterClose?.position ?? null,
    closeDidNotAdvance: true,
  };
}

async function runRollbackCase(session) {
  await session.waitTitle();
  await session.clickTarget('title:new');
  await session.waitFor('正式游戏剧情入口', () => window.__surdetDebug?.uiSession?.base === 'game'
    && window.__surdetDebug?.position !== null);
  const progression = [];
  for (let index = 0; index < 8; index += 1) {
    progression.push(await session.advanceStoryStep(`连续回退种子文本 ${index + 1}`));
  }

  const rollbacks = [];
  for (let index = 0; index < 4; index += 1) {
    await session.waitFor(`第 ${index + 1} 次回退前稳定`, () => {
      const debug = window.__surdetDebug;
      return debug?.status === 'awaiting-advance'
        && debug?.activeOverlay === null
        && debug?.dialogueProjection?.commandRailVisible === true;
    }, undefined, 12000);
    const before = await session.snapshot();
    const expected = progression[progression.length - 2 - index]?.after?.position ?? null;
    await session.clickTarget('rail:rollback');
    await session.waitFor(`第 ${index + 1} 次回退完成`, (positionKeyExpected) => {
      const position = window.__surdetDebug?.position;
      return position ? `${position.sceneId}:${position.pc}` === positionKeyExpected : positionKeyExpected === 'null';
    }, positionKey(expected), 12000);
    const after = await session.snapshot();
    if (positionKey(after?.position) !== positionKey(expected)) {
      throw new Error(`第 ${index + 1} 次回退没有回到恰好前一状态：${JSON.stringify({ before, expected, after })}`);
    }
    rollbacks.push({
      attempt: index + 1,
      before: before?.position ?? null,
      expected,
      after: after?.position ?? null,
      overlay: after?.activeOverlay ?? null,
    });
  }

  return {
    source: 'game',
    path: ['title:new', 'story:advance×8', 'rail:rollback×4'],
    progression: progression.map((step) => ({
      before: step.before?.position ?? null,
      after: step.after?.position ?? null,
    })),
    rollbacks,
    consecutiveWithoutAdvance: true,
  };
}

async function runGameGalleryCase(session) {
  const initial = await startFormalGame(session);
  const positionBefore = positionKey(initial?.position);
  await session.press('Escape');
  await session.waitOverlay('system-menu');
  await session.clickTarget('system:gallery');
  await session.waitOverlay('gallery:cg');

  await session.waitForPresentedFrame('game-gallery-cg');
  const cg = await session.captureCanvas('game-gallery-cg');
  await session.clickTarget('gallery:music');
  await session.waitOverlay('gallery:music');
  const music = await session.captureCanvas('game-gallery-music');
  await session.clickTarget('gallery:text');
  await session.waitOverlay('gallery:text');
  const text = await session.captureCanvas('game-gallery-text');
  await session.clickTarget('gallery:cg');
  await session.waitOverlay('gallery:cg');
  const cgRestored = await session.captureCanvas('game-gallery-cg-restored');
  await session.clickTarget('gallery:close');
  await session.waitFor('游戏 Gallery 关闭', () => window.__surdetDebug?.uiSession?.base === 'game'
    && window.__surdetDebug?.activeOverlay === null);
  const finalSnapshot = await session.snapshot();

  if (music.pixelHash === cg.pixelHash || text.pixelHash === music.pixelHash) {
    throw new Error(`游戏来源 Gallery 画面切换未保持：${JSON.stringify({ cg, music, text, cgRestored })}`);
  }
  if (positionKey(finalSnapshot?.position) !== positionBefore) {
    throw new Error(`游戏来源 Gallery 关闭推进了剧情：${JSON.stringify({ positionBefore, finalSnapshot })}`);
  }
  return {
    source: 'game',
    path: ['title:new', 'system:gallery', 'gallery:music', 'gallery:text', 'gallery:cg', 'gallery:close'],
    initialPosition: initial?.position ?? null,
    finalPosition: finalSnapshot?.position ?? null,
    overlays: ['gallery:cg', 'gallery:music', 'gallery:text', 'gallery:cg'],
    closeDidNotAdvance: true,
    cg,
    music,
    text,
    cgRestored,
  };
}

async function runSaveLoadCase(session, mode) {
  const initial = await startFormalGame(session);
  const portraitSeed = await advanceUntilPortraits(session, `${mode} 立绘种子`);
  const before = portraitSeed.snapshot;
  const beforeWorld = assertWorldWithPortraits(before, `${mode} 存档前`);
  const saveResult = await selectSaveLoadSlot(session, 'save');
  const perturbation = await advanceUntilVisualChange(session, before, `${mode} World 扰动`);
  const loadResult = await selectSaveLoadSlot(session, 'load');
  const after = loadResult ?? await session.snapshot();
  const afterWorld = assertWorldWithPortraits(after, `${mode} 读档后`);
  assertRestoredState(before, after, `${mode} 读档后`);
  return {
    source: 'game',
    mode,
    path: ['title:new', `story:advance×${portraitSeed.advances}→portrait`, 'save→slot-1', `world:perturb×${perturbation.advances}`, 'load→slot-1'],
    initialPosition: initial?.position ?? null,
    beforePosition: before?.position ?? null,
    afterPosition: after?.position ?? null,
    beforeWorld,
    afterWorld,
    saveResult: saveResult?.uiSession ?? null,
    portraitSeedProgression: portraitSeed.progression.map((step) => ({
      before: step.before?.position ?? null,
      after: step.after?.position ?? null,
      world: presentationWorld(step.after),
    })),
    perturbationProgression: perturbation.progression.map((step) => ({
      before: step.before?.position ?? null,
      after: step.after?.position ?? null,
      world: presentationWorld(step.after),
    })),
    perturbationWorld: presentationWorld(perturbation.snapshot),
    commandRailVisible: after?.commandRailVisible ?? null,
    overlay: after?.activeOverlay ?? null,
  };
}

async function runSaveLoadRoundTripCase(session) {
  const initial = await startFormalGame(session);
  const portraitSeed = await advanceUntilPortraits(session, '多轮读档立绘种子');
  const saved = portraitSeed.snapshot;
  const savedWorld = assertWorldWithPortraits(saved, '多轮读档首次存档前');
  await selectSaveLoadSlot(session, 'save');
  const firstPerturbation = await advanceUntilVisualChange(session, saved, '多轮读档第一次扰动');
  const firstLoaded = await selectSaveLoadSlot(session, 'load');
  const firstWorld = assertWorldWithPortraits(firstLoaded, '多轮读档第一次恢复');
  assertRestoredState(saved, firstLoaded, '多轮读档第一次恢复');
  await selectSaveLoadSlot(session, 'save');
  const secondPerturbation = await advanceUntilVisualChange(session, firstLoaded, '多轮读档第二次扰动');
  const secondLoaded = await selectSaveLoadSlot(session, 'load');
  const secondWorld = assertWorldWithPortraits(secondLoaded, '多轮读档第二次恢复');
  assertRestoredState(saved, secondLoaded, '多轮读档第二次恢复');
  return {
    source: 'game',
    path: ['title:new', `story:advance×${portraitSeed.advances}→portrait`, 'save→load', `world:perturb×${firstPerturbation.advances}`, 'save→load', `world:perturb×${secondPerturbation.advances}`, 'save→load'],
    initialPosition: initial?.position ?? null,
    savedPosition: saved?.position ?? null,
    firstLoadedPosition: firstLoaded?.position ?? null,
    secondLoadedPosition: secondLoaded?.position ?? null,
    savedWorld,
    firstWorld,
    secondWorld,
    portraitSeedProgression: portraitSeed.progression.map((step) => ({
      before: step.before?.position ?? null,
      after: step.after?.position ?? null,
      world: presentationWorld(step.after),
    })),
    firstPerturbation: {
      advances: firstPerturbation.advances,
      world: presentationWorld(firstPerturbation.snapshot),
    },
    secondPerturbation: {
      advances: secondPerturbation.advances,
      world: presentationWorld(secondPerturbation.snapshot),
    },
    finalSession: secondLoaded?.uiSession ?? null,
  };
}

async function runTitleCleanupCase(session, withTitleLoad = false) {
  const initial = await startFormalGame(session);
  for (let index = 0; index < 3; index += 1) await session.advanceStoryStep(`标题清理种子 ${index + 1}`);
  const gameSnapshot = await session.snapshot();
  const gameWorld = assertWorldPresent(gameSnapshot, '标题清理前');
  if (withTitleLoad) await selectSaveLoadSlot(session, 'save');
  const firstTitle = await returnToTitleFromGame(session);
  const firstTitleWorld = presentationWorld(firstTitle);
  if (firstTitleWorld.backgroundKey !== null || firstTitleWorld.portraits.length !== 0) {
    throw new Error(`返回标题后仍残留 World：${JSON.stringify({ gameWorld, firstTitleWorld, firstTitle })}`);
  }
  if (withTitleLoad) {
    await openTitleLoad(session);
    const loadedGame = await session.snapshot();
    assertWorldPresent(loadedGame, '标题读档后');
    const secondTitle = await returnToTitleFromGame(session);
    const secondTitleWorld = presentationWorld(secondTitle);
    if (secondTitleWorld.backgroundKey !== null || secondTitleWorld.portraits.length !== 0) {
      throw new Error(`标题读档后返回标题仍残留 World：${JSON.stringify({ secondTitleWorld, secondTitle })}`);
    }
    return {
      source: 'title',
      path: ['title:new', 'story:advance×3', 'save', 'game→title', 'title:load→game', 'game→title'],
      gameWorld,
      firstTitleWorld,
      secondTitleWorld,
      finalSession: secondTitle?.uiSession ?? null,
    };
  }
  return {
    source: 'game',
    path: ['title:new', 'story:advance×3', 'game→title'],
    gameWorld,
    firstTitleWorld,
    finalSession: firstTitle?.uiSession ?? null,
  };
}

async function runCommandRailCase(session) {
  const initial = await startFormalGame(session);
  const commandRailAlphaSamples = [];
  const progression = [];
  const recordRail = (label, snapshot) => {
    const projection = snapshot?.dialogueProjection ?? null;
    const alpha = projection?.commandRailAlpha ?? null;
    const visible = snapshot?.commandRailVisible ?? null;
    const transientChoice = snapshot?.status === 'choice' || snapshot?.rendererStatus === 'choice';
    commandRailAlphaSamples.push({
      label,
      alpha,
      visible,
      status: snapshot?.status ?? null,
      position: snapshot?.position ?? null,
      dialogText: projection?.dialogText ?? null,
    });
    if (alpha !== 1) throw new Error(`${label} commandRailAlpha 不是 1：${JSON.stringify(snapshot)}`);
    if (visible !== true && !transientChoice) {
      throw new Error(`${label} commandRailVisible 意外变为 false：${JSON.stringify(snapshot)}`);
    }
  };

  recordRail('initial', initial);
  await session.page.waitForTimeout(5000);
  const settled = await session.snapshot();
  recordRail('after-wait-5s', settled);

  for (let index = 0; index < 20; index += 1) {
    const step = await session.advanceStoryStep(`命令栏真实对话推进 ${index + 1}`);
    const beforePosition = positionKey(step.before?.position);
    const afterPosition = positionKey(step.after?.position);
    const beforeText = step.before?.dialogueProjection?.dialogText ?? null;
    const afterText = step.after?.dialogueProjection?.dialogText ?? null;
    if (beforePosition === afterPosition && beforeText === afterText) {
      throw new Error(`第 ${index + 1} 次推进没有位置或当前文本变化：${JSON.stringify(step)}`);
    }
    progression.push(step);
    recordRail(`story-advance-${index + 1}`, step.after);
  }

  // If the twentieth input landed on an allowed choice transient, keep using
  // real player input until the ordinary dialogue rail is visible again.
  let final = await session.snapshot();
  for (let extra = 0; extra < 4 && final?.commandRailVisible !== true; extra += 1) {
    const step = await session.advanceStoryStep(`命令栏结束态恢复 ${extra + 1}`);
    progression.push(step);
    recordRail(`story-recovery-${extra + 1}`, step.after);
    final = step.after;
  }
  if (final?.commandRailVisible !== true) {
    throw new Error(`20 次真实推进后命令栏没有回到普通对话态：${JSON.stringify(final)}`);
  }

  const beforeHover = await session.snapshot();
  recordRail('before-hover', beforeHover);
  const hoverTarget = await session.targetBounds('rail:auto');
  if (!hoverTarget) throw new Error('缺少真实 rail:auto 截图区域');
  const { x, y, width, height } = hoverTarget.logical;
  const targetBefore = await session.captureCanvasRegion('rail-auto-before-hover', x, y, width, height);
  const outsideLeftBefore = await session.captureCanvasRegion('rail-outside-left-before-hover', x - 6, y, 4, height);
  const outsideRightBefore = await session.captureCanvasRegion('rail-outside-right-before-hover', x + width + 2, y, 4, height);
  await session.hoverTarget('rail:auto');
  const afterHover = await session.snapshot();
  recordRail('after-hover', afterHover);
  const targetAfter = await session.captureCanvasRegion('rail-auto-after-hover', x, y, width, height);
  const outsideLeftAfter = await session.captureCanvasRegion('rail-outside-left-after-hover', x - 6, y, 4, height);
  const outsideRightAfter = await session.captureCanvasRegion('rail-outside-right-after-hover', x + width + 2, y, 4, height);
  if (targetBefore.pixelHash === targetAfter.pixelHash) {
    throw new Error(`rail:auto 悬停没有可观察的局部投影变化：${JSON.stringify({ targetBefore, targetAfter })}`);
  }
  if (outsideLeftBefore.pixelHash !== outsideLeftAfter.pixelHash
    || outsideRightBefore.pixelHash !== outsideRightAfter.pixelHash) {
    throw new Error(`rail:auto 悬停改变了目标按钮之外的 rail：${JSON.stringify({ outsideLeftBefore, outsideLeftAfter, outsideRightBefore, outsideRightAfter })}`);
  }
  return {
    source: 'game',
    path: ['title:new', 'wait:5s', `story:advance×${progression.length}`, 'hover:rail:auto'],
    initialPosition: initial?.position ?? null,
    settledPosition: settled?.position ?? null,
    finalPosition: final?.position ?? null,
    progressionCount: progression.length,
    progression: progression.map((step) => ({
      before: step.before?.position ?? null,
      after: step.after?.position ?? null,
      beforeText: step.before?.dialogueProjection?.dialogText ?? null,
      afterText: step.after?.dialogueProjection?.dialogText ?? null,
    })),
    commandRailAlphaSamples,
    beforeRail: beforeHover?.dialogueProjection ?? null,
    afterHoverRail: afterHover?.dialogueProjection ?? null,
    hoverEvidence: {
      targetBefore,
      targetAfter,
      outsideLeftBefore,
      outsideLeftAfter,
      outsideRightBefore,
      outsideRightAfter,
    },
  };
}

async function readNativeFullscreen(session) {
  return session.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { fullScreen: win.isFullScreen(), contentBounds: win.getContentBounds() };
  });
}

async function runFullscreenCase(session) {
  const initial = await startFormalGame(session);
  const before = await session.snapshot();
  const beforeNative = await readNativeFullscreen(session);
  if (beforeNative.fullScreen) throw new Error('独立全屏病例应从普通窗口开始');
  const beforeViewport = await session.viewportEvidence('before-F11');
  const beforeCanvas = await session.captureCanvas('fullscreen-before');
  const beforeMenuTarget = await session.targetBounds('rail:menu');
  const beforeTargets = (before?.interactionTargets ?? []).map((target) => target.id);
  if (!beforeMenuTarget) throw new Error('F11 前缺少 rail:menu 可点击坐标');
  await session.press('F11');
  const enteredNative = await readNativeFullscreen(session);
  if (!enteredNative.fullScreen) throw new Error('F11 未使原生窗口进入全屏');
  await session.page.waitForFunction(({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    enteredNative.contentBounds, { timeout: 10000 });
  await session.waitForPresentedFrame('F11-entered');
  const entered = await session.snapshot();
  const enteredViewport = await session.viewportEvidence('after-F11-enter');
  const enteredCanvas = await session.captureCanvas('fullscreen-entered');
  const enteredMenuTarget = await session.targetBounds('rail:menu');
  const enteredTargets = (entered?.interactionTargets ?? []).map((target) => target.id);
  if (!enteredMenuTarget) throw new Error('F11 后缺少 rail:menu 可点击坐标');
  await session.clickTarget('rail:menu');
  await session.waitOverlay('system-menu');
  const fullscreenMenu = await session.snapshot();
  const fullscreenMenuPosition = positionKey(fullscreenMenu?.position);
  await session.clickTarget('system:resume');
  await session.waitFor('全屏 system-menu 关闭', () => window.__surdetDebug?.activeOverlay === null);
  const fullscreenAfterClose = await session.snapshot();
  if (positionKey(fullscreenAfterClose?.position) !== positionKey(initial?.position)
    || fullscreenMenuPosition !== positionKey(initial?.position)) {
    throw new Error(`全屏菜单开关推进了剧情：${JSON.stringify({ initial, fullscreenMenu, fullscreenAfterClose })}`);
  }

  await session.press('F11');
  const exitedNative = await readNativeFullscreen(session);
  if (exitedNative.fullScreen) throw new Error('第二次F11未使原生窗口退出全屏');
  await session.page.waitForFunction(({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    exitedNative.contentBounds, { timeout: 10000 });
  await session.waitForPresentedFrame('F11-exited');
  const exited = await session.snapshot();
  const exitedViewport = await session.viewportEvidence('after-F11-exit');
  const exitedCanvas = await session.captureCanvas('fullscreen-exited');
  const exitedMenuTarget = await session.targetBounds('rail:menu');
  const exitedTargets = (exited?.interactionTargets ?? []).map((target) => target.id);
  if (!exitedMenuTarget) throw new Error('退出 F11 后缺少 rail:menu 可点击坐标');
  await session.clickTarget('rail:menu');
  await session.waitOverlay('system-menu');
  const exitedMenu = await session.snapshot();
  await session.clickTarget('system:resume');
  await session.waitFor('退出全屏 system-menu 关闭', () => window.__surdetDebug?.activeOverlay === null);
  const exitedAfterClose = await session.snapshot();
  if (positionKey(exitedAfterClose?.position) !== positionKey(initial?.position)
    || positionKey(exitedMenu?.position) !== positionKey(initial?.position)) {
    throw new Error(`退出全屏菜单开关推进了剧情：${JSON.stringify({ initial, exitedMenu, exitedAfterClose })}`);
  }

  const viewports = [beforeViewport, enteredViewport, exitedViewport];
  for (const viewport of viewports) {
    if (!viewport.canvas || Math.abs(viewport.canvas.aspectRatio - (1280 / 720)) > 0.02) {
      throw new Error(`F11 阶段画布发生拉伸或缺失：${JSON.stringify(viewport)}`);
    }
  }
  if (!beforeTargets.includes('rail:menu') || !enteredTargets.includes('rail:menu') || !exitedTargets.includes('rail:menu')) {
    throw new Error(`F11 后交互目标缺失：${JSON.stringify({ beforeTargets, enteredTargets, exitedTargets })}`);
  }
  return {
    source: 'game',
    path: ['title:new', 'F11→page.mouse.click rail:menu→system:resume', 'F11→page.mouse.click rail:menu→system:resume'],
    initialPosition: initial?.position ?? null,
    fullscreenInput: 'Electron webContents.sendInputEvent(F11)',
    beforeNative,
    enteredNative,
    exitedNative,
    beforeViewport,
    enteredViewport,
    exitedViewport,
    beforeCanvas,
    enteredCanvas,
    exitedCanvas,
    beforeMenuTarget,
    enteredMenuTarget,
    exitedMenuTarget,
    beforeTargets,
    enteredTargets,
    exitedTargets,
    fullscreenMenuPosition,
    exitedMenuPosition: positionKey(exitedMenu?.position),
    menuClicksUsed: 2,
  };
}

async function runCase(caseId) {
  let session;
  let evidence;
  const assertions = {
    source: 'title',
    path: ['title:gallery', 'gallery:music', 'gallery:text', 'gallery:cg', 'gallery:close'],
  };
  try {
    session = await launchSession(caseId);
    await prepareSession(session);
    const finish = (assertionSnapshot) => evidence = caseEvidence(session, caseId, true, assertionSnapshot);
    if (caseId === 'C') {
      return finish(await runBacklogCase(session));
    }
    if (caseId === 'D') {
      return finish(await runRollbackCase(session));
    }
    if (caseId === 'B') {
      return finish(await runGameGalleryCase(session));
    }
    if (caseId === 'E') {
      return finish(await runSaveLoadCase(session, 'immediate'));
    }
    if (caseId === 'F') {
      return finish(await runSaveLoadRoundTripCase(session));
    }
    if (caseId === 'G') {
      return finish(await runTitleCleanupCase(session, false));
    }
    if (caseId === 'H') {
      return finish(await runTitleCleanupCase(session, true));
    }
    if (caseId === 'I') {
      return finish(await runCommandRailCase(session));
    }
    if (caseId === 'J') {
      return finish(await runFullscreenCase(session));
    }
    if (caseId !== 'A') {
      throw new Error(`Wave 4 case ${caseId} 未被路由到任何执行器。`);
    }
    await session.waitTitle();
    await session.clickTarget('title:gallery');
    await session.waitOverlay('gallery:cg');
    const cgBeforeMusic = await session.waitForStableCanvas('gallery-cg-before-music');
    assertions.cgBeforeMusic = cgBeforeMusic;
    const cgTargets = (await session.snapshot())?.interactionTargets ?? [];
    assertions.cgVisibleStructure = cgTargets.map((target) => target.id);
    await session.clickLogical(206, 43, 'gallery-music-visible-text');
    await session.waitOverlay('gallery:music');
    const musicSnapshot = await session.snapshot();
    const musicCanvas = await session.captureCanvas('gallery-music-after-click');
    assertions.musicOverlay = musicSnapshot?.activeOverlay ?? null;
    assertions.musicVisibleStructure = musicSnapshot?.interactionTargets?.map((target) => target.id) ?? [];
    assertions.musicCanvas = musicCanvas;
    if (musicSnapshot?.activeOverlay !== 'gallery:music') throw new Error('音乐标签语义状态未切换');
    if (musicCanvas.pixelHash === cgBeforeMusic.pixelHash) {
      throw new Error(`音乐标签切换后画布未刷新：pixelHash=${musicCanvas.pixelHash}`);
    }
    await session.clickLogical(270, 43, 'gallery-text-visible-text');
    await session.waitOverlay('gallery:text');
    const textSnapshot = await session.snapshot();
    const textCanvas = await session.captureCanvas('gallery-text-after-click');
    assertions.textOverlay = textSnapshot?.activeOverlay ?? null;
    assertions.textVisibleStructure = textSnapshot?.interactionTargets?.map((target) => target.id) ?? [];
    assertions.textCanvas = textCanvas;
    if (textSnapshot?.activeOverlay !== 'gallery:text') throw new Error('文本标签语义状态未切换');
    if (textCanvas.pixelHash === musicCanvas.pixelHash) {
      throw new Error(`文本标签切换后画布未刷新：pixelHash=${textCanvas.pixelHash}`);
    }
    await session.clickLogical(108, 43, 'gallery-cg-visible-text');
    await session.waitOverlay('gallery:cg');
    const cgAfterTextSnapshot = await session.snapshot();
    const cgAfterText = await session.captureCanvas('gallery-cg-after-text');
    assertions.cgAfterTextOverlay = cgAfterTextSnapshot?.activeOverlay ?? null;
    assertions.cgAfterTextVisibleStructure = cgAfterTextSnapshot?.interactionTargets?.map((target) => target.id) ?? [];
    assertions.cgAfterTextCanvas = cgAfterText;
    if (cgAfterTextSnapshot?.activeOverlay !== 'gallery:cg') throw new Error('CG 标签语义状态未恢复');
    if (cgAfterText.pixelHash !== cgBeforeMusic.pixelHash) {
      throw new Error(`CG 标签切换后画布未恢复：${cgAfterText.pixelHash} != ${cgBeforeMusic.pixelHash}`);
    }
    await session.clickLogical(1130, 43, 'gallery-close-visible-text');
    await session.waitTitle();
    const finalSnapshot = await session.snapshot();
    if (finalSnapshot?.uiSession?.base !== 'title' || finalSnapshot?.activeOverlay !== 'title') {
      throw new Error(`标题 Gallery 关闭后的 return context 错误：${JSON.stringify(finalSnapshot)}`);
    }
    return finish({ ...assertions, returnBase: finalSnapshot.uiSession.base });
  } catch (error) {
    return evidence = caseEvidence(session, caseId, false, assertions, error);
  } finally {
    await finalizeCase(session, evidence);
  }
}

function writeArtifact(cases, status, error = null) {
  const artifact = {
    schemaVersion: 1,
    status,
    head: runHead,
    sourceRoot: gameSourceRoot,
    distRoot: path.resolve(gameDist),
    isolation: { tempRoot, cases: cases.map((item) => item.id) },
    cases,
    error: error ? errorText(error) : null,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

async function main() {
  if (selectedCase && !caseIds.includes(selectedCase)) throw new Error(`未知 Wave 4 case：${selectedCase}`);
  const cases = [];
  try {
    buildFormalGame();
    if (smoke) cases.push(await runSmokeCase());
    else if (selectedCase) cases.push(await runCase(selectedCase));
    else for (const caseId of caseIds) cases.push(await runCase(caseId));
    const status = cases.length > 0 && cases.every((item) => item.ok) ? 'PASSED' : 'FAILED';
    const artifact = writeArtifact(cases, status);
    console.log(JSON.stringify({ artifact: evidencePath, sha256: sha256File(evidencePath), status: artifact.status }, null, 2));
    if (status === 'FAILED') process.exitCode = 1;
  } catch (error) {
    const artifact = writeArtifact(cases, 'FAILED', error);
    console.error(JSON.stringify({ artifact: evidencePath, sha256: sha256File(evidencePath), status: artifact.status, error: errorText(error) }, null, 2));
    process.exitCode = 1;
  }
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main();
}
