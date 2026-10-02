/**
 * Surdet Player Experience Wave 5A — rollback black-screen diagnostic.
 *
 * This runner is evidence collection, not a game-specific workaround. It
 * builds and loads the formal Zero dist, creates an isolated Electron session
 * for every protocol run, and uses only real keyboard/mouse input to seed and
 * consume rollback history. All screenshots and JSON remain in a fresh system
 * temporary directory.
 */
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(shellDir, '../..');
// The only formal player entry for this protocol is examples/zero-after-midnight/dist.
const gameSourceRoot = path.join(repoRoot, 'examples', 'zero-after-midnight');
const gameDist = path.join(gameSourceRoot, 'dist');
const smoke = process.argv.includes('--smoke');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-player-experience-wave-5a-'));
const evidencePath = path.join(
  tempRoot,
  smoke ? 'wave-5a-smoke.json' : `wave-5a-rollback-${Date.now()}.json`,
);

const protocol = Object.freeze({
  sessionCount: 8,
  attemptsPerSession: 20,
  cycleCount: 5,
  advancePerCycle: 4,
  rollbackPerCycle: 4,
  modes: Object.freeze(['settled', 'rapid']),
  totalAttempts: 160,
});

const buildSteps = [
  ['run', 'build', '-w', '@surdet/core'],
  ['run', 'build', '-w', '@surdet/renderer'],
  ['run', 'build', '-w', '@surdet/host'],
  ['run', 'build', '-w', '@surdet/shell'],
  ['run', 'build', '-w', 'zero-after-midnight'],
];

function npmInvocation(args) {
  const configuredNpmCli = process.env.npm_execpath;
  const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = configuredNpmCli || (fs.existsSync(bundledNpmCli) ? bundledNpmCli : null);
  return npmCli
    ? { command: process.execPath, args: [npmCli, ...args] }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

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
  const required = [
    path.join(gameDist, 'index.html'),
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) throw new Error(`正式《零点之后》缺少构建文件：${filePath}`);
  }
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function positionKey(position) {
  return position ? `${position.sceneId}:${position.pc}` : 'null';
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeLabel(label) {
  return String(label).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'capture';
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

function readPngMetrics(filePath) {
  const bytes = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) {
    return { width: null, height: null, meanLuma: null, blackPixelRatio: null, method: 'unsupported' };
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType)) {
    return { width: width || null, height: height || null, meanLuma: null, blackPixelRatio: null, method: 'unsupported' };
  }
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const rowBytes = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const previous = Buffer.alloc(rowBytes);
  let sourceOffset = 0;
  let totalLuma = 0;
  let blackPixels = 0;
  let pixels = 0;
  const paeth = (a, b, c) => {
    const estimate = a + b - c;
    const pa = Math.abs(estimate - a);
    const pb = Math.abs(estimate - b);
    const pc = Math.abs(estimate - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const rawValue = raw[sourceOffset++];
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? previous[x - channels] : 0;
      row[x] = filter === 0
        ? rawValue
        : filter === 1
          ? (rawValue + left) & 0xff
          : filter === 2
            ? (rawValue + up) & 0xff
            : filter === 3
              ? (rawValue + Math.floor((left + up) / 2)) & 0xff
              : filter === 4
                ? (rawValue + paeth(left, up, upLeft)) & 0xff
                : rawValue;
    }
    for (let x = 0; x < width; x += 1) {
      const base = x * channels;
      let r;
      let g;
      let b;
      if (colorType === 6 || colorType === 2) {
        r = row[base] / 255;
        g = row[base + 1] / 255;
        b = row[base + 2] / 255;
      } else {
        r = row[base] / 255;
        g = r;
        b = r;
      }
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLuma += luma;
      if (luma <= 0.02) blackPixels += 1;
      pixels += 1;
    }
    row.copy(previous);
  }
  return {
    width,
    height,
    meanLuma: pixels > 0 ? totalLuma / pixels : null,
    blackPixelRatio: pixels > 0 ? blackPixels / pixels : null,
    method: 'png-rgba-or-rgb-scan',
  };
}

async function launchSession(sessionId, mode) {
  const sessionRoot = path.join(tempRoot, sessionId);
  const userData = path.join(sessionRoot, 'user-data');
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

  const classifyConsole = (message) => {
    const text = message.text();
    if (message.type() !== 'error') return;
    if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
    else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
    else if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
    else events.consoleErrors.push(text);
  };
  page.on('console', classifyConsole);
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
    id: sessionId,
    mode,
    sessionRoot,
    userData,
    app,
    page,
    events,
    screenshots,
    attempts: [],
    identity: null,
    lastSnapshot: null,
    failureMessage: null,
    failureStack: null,
    async snapshot() {
      if (page.isClosed()) return null;
      const snapshot = await page.evaluate(() => {
        const debug = window.__surdetDebug;
        const presentation = debug?.presentationSnapshot ?? null;
        const world = presentation?.stage ?? presentation?.world ?? null;
        const effects = world?.effects ?? presentation?.effects ?? null;
        const tint = world?.tint ?? effects?.tint ?? null;
        return {
          title: document.title,
          status: debug?.status ?? null,
          rendererStatus: debug?.rendererStatus ?? null,
          uiSession: debug?.uiSession ?? null,
          activeOverlay: debug?.activeOverlay ?? null,
          position: debug?.position ?? null,
          presentationSnapshot: presentation,
          backgroundKey: world?.backgroundKey ?? null,
          portraits: world?.portraits ?? [],
          cameraScale: world?.cameraScale ?? null,
          cameraPan: world?.cameraPan ?? null,
          fadeAlpha: world?.fadeAlpha ?? effects?.fadeAlpha ?? null,
          tint,
          particleKind: world?.particleKind ?? effects?.particleKind ?? null,
          timelines: presentation?.timelines ?? presentation?.activeTimelines ?? [],
          dialogueProjection: debug?.dialogueProjection ?? null,
          resourceSnapshot: debug?.resourceSnapshot ?? null,
          resourceLedger: debug?.resourceLedger ?? null,
          lastRendererError: debug?.lastRendererError ?? null,
          interactionTargets: debug?.interactionTargets ?? [],
        };
      });
      this.lastSnapshot = cloneJson(snapshot);
      return snapshot;
    },
    async waitFor(label, predicate, arg = undefined, timeoutMs = 20000) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法等待：${label}`);
      await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    },
    async waitFrames(count, label) {
      if (page.isClosed()) throw new Error(`窗口已关闭：${label}`);
      await page.evaluate((frameCount) => new Promise((resolve) => {
        let remaining = frameCount;
        const tick = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), count);
    },
    async waitAssetsAndTitle() {
      await this.waitFor('Renderer debug surface', () => window.__surdetDebug?.uiSession !== undefined, undefined, 30000);
      await this.waitFor('formal Zero assets', () => {
        const progress = window.__surdetDebug?.assetLoading;
        return progress?.done === true && progress.total > 0
          && progress.completed === progress.total && progress.failed === 0;
      }, undefined, 120000);
      await this.waitFor('formal Zero title', () => window.__surdetDebug?.uiSession?.base === 'title');
      await this.waitFor('title overlay', () => window.__surdetDebug?.activeOverlay === 'title');
      await this.waitFor('title new target', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:new'));
      this.identity = await page.evaluate(() => ({
        title: document.title,
        href: location.href,
        assetLoading: window.__surdetDebug?.assetLoading ?? null,
        activeOverlay: window.__surdetDebug?.activeOverlay ?? null,
      }));
    },
    async waitDialogueStable(label, expectedKey = null) {
      await this.waitFor(`${label} 对话稳定`, (key) => {
        const debug = window.__surdetDebug;
        const position = debug?.position;
        const keyNow = position ? `${position.sceneId}:${position.pc}` : 'null';
        return debug?.uiSession?.base === 'game'
          && debug?.uiSession?.overlay === 'none'
          && debug?.uiSession?.operation === 'idle'
          && debug?.activeOverlay === null
          && debug?.rendererStatus !== 'typing'
          && debug?.status === 'awaiting-advance'
          && debug?.canCaptureRollbackCheckpoint === true
          && (key === null || keyNow === key);
      }, expectedKey, 20000);
    },
    async targetPoint(targetId) {
      return page.evaluate((id) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === id);
        const canvas = document.querySelector('canvas');
        if (!target || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
          y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
        };
      }, targetId);
    },
    async clickTarget(targetId, label = targetId) {
      const point = await this.targetPoint(targetId);
      if (!point) throw new Error(`找不到真实交互目标：${targetId}`);
      await page.mouse.click(point.x, point.y);
      await this.waitFrames(2, label);
    },
    async captureCanvas(label) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法截图：${label}`);
      const bounds = await page.locator('canvas').boundingBox();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error(`正式游戏画布不可见：${label}`);
      const screenshotDir = path.join(sessionRoot, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `${safeLabel(label)}.png`);
      await page.screenshot({ path: screenshotPath, clip: bounds, animations: 'disabled' });
      const metrics = readPngMetrics(screenshotPath);
      const screenshotSha256 = sha256File(screenshotPath);
      const dataUrlHash = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const dataUrl = canvas?.toDataURL('image/png') ?? '';
        return dataUrl;
      });
      const evidence = {
        label,
        path: screenshotPath,
        bytes: fs.statSync(screenshotPath).size,
        canvasPngHash: screenshotSha256,
        screenshotSha256,
        canvasDataUrlHash: dataUrlHash
          ? crypto.createHash('sha256').update(dataUrlHash).digest('hex')
          : null,
        canvasWidth: metrics.width,
        canvasHeight: metrics.height,
        meanLuma: metrics.meanLuma,
        blackPixelRatio: metrics.blackPixelRatio,
        metricMethod: metrics.method,
      };
      screenshots.push(evidence);
      return evidence;
    },
    async advanceOne(label) {
      await this.waitDialogueStable(`${label} 输入前`);
      const before = await this.snapshot();
      const beforeCanvas = await this.captureCanvas(`${label}-before`);
      const beforeKey = positionKey(before?.position);
      const beforeText = before?.dialogueProjection?.dialogText ?? null;
      let lastInput = null;
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        await this.waitFor(`${label} 可输入`, () => {
          const debug = window.__surdetDebug;
          return debug?.uiSession?.base === 'game'
            && debug?.activeOverlay === null
            && debug?.rendererStatus !== 'typing'
            && (debug?.status === 'awaiting-advance' || debug?.status === 'choice');
        }, undefined, 20000);
        const key = await page.evaluate(() => {
          const debug = window.__surdetDebug;
          return debug?.status === 'choice' || debug?.rendererStatus === 'choice' ? '1' : 'Space';
        });
        lastInput = key;
        await page.keyboard.press(key);
        try {
          await this.waitFor(`${label} 位置或文本变化`, ({ expectedKey, expectedText }) => {
            const debug = window.__surdetDebug;
            const position = debug?.position;
            const keyNow = position ? `${position.sceneId}:${position.pc}` : 'null';
            const textNow = debug?.dialogueProjection?.dialogText ?? null;
            return keyNow !== expectedKey || textNow !== expectedText;
          }, { expectedKey: beforeKey, expectedText: beforeText }, 6000);
          const after = await this.snapshot();
          await this.waitDialogueStable(`${label} 输入后`);
          const settledAfter = await this.snapshot();
          const afterCanvas = await this.captureCanvas(`${label}-after`);
          if (positionKey(settledAfter?.position) === beforeKey
            && (settledAfter?.dialogueProjection?.dialogText ?? null) === beforeText) {
            throw new Error(`${label} 是 no-op：${JSON.stringify({ before, after: settledAfter })}`);
          }
          return {
            before,
            after: settledAfter,
            transientAfter: after,
            beforeCanvas,
            afterCanvas,
            input: lastInput,
            inputAttempts: attempt,
          };
        } catch (error) {
          if (attempt === 6) throw error;
        }
      }
      throw new Error(`${label} 没有完成真实输入：${lastInput ?? 'unknown'}`);
    },
    async close() {
      closing = true;
      try {
        await app.close();
      } catch (error) {
        if (!/closed|destroyed/i.test(errorText(error))) throw error;
      }
    },
  };
  return session;
}

function compareWorld(expected, actual) {
  if (!expected || !actual) return { ok: false, reason: 'missing world snapshot' };
  const expectedPortraits = (expected.portraits ?? []).map((item) => item.key).sort();
  const actualPortraits = (actual.portraits ?? []).map((item) => item.key).sort();
  const close = (a, b, tolerance = 0.02) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
  const ok = expected.backgroundKey === actual.backgroundKey
    && JSON.stringify(expectedPortraits) === JSON.stringify(actualPortraits)
    && close(expected.cameraScale, actual.cameraScale, 0.03)
    && close(expected.cameraPan?.x, actual.cameraPan?.x, 2)
    && close(expected.cameraPan?.y, actual.cameraPan?.y, 2)
    && close(expected.fadeAlpha, actual.fadeAlpha, 0.03)
    && close(expected.tint?.alpha, actual.tint?.alpha, 0.03)
    && expected.particleKind === actual.particleKind;
  return {
    ok,
    expected: {
      backgroundKey: expected.backgroundKey,
      portraits: expectedPortraits,
      cameraScale: expected.cameraScale,
      cameraPan: expected.cameraPan,
      fadeAlpha: expected.fadeAlpha,
      tint: expected.tint,
      particleKind: expected.particleKind,
    },
    actual: {
      backgroundKey: actual.backgroundKey,
      portraits: actualPortraits,
      cameraScale: actual.cameraScale,
      cameraPan: actual.cameraPan,
      fadeAlpha: actual.fadeAlpha,
      tint: actual.tint,
      particleKind: actual.particleKind,
    },
  };
}

function assertRollbackVisualInvariant(expected, after, afterCanvas, context) {
  const comparison = compareWorld(expected, after);
  if (!comparison.ok) throw new Error(`${context} 表现快照未恢复：${JSON.stringify(comparison)}`);
  const targetHasVisual = expected.backgroundKey !== null || (expected.portraits?.length ?? 0) > 0;
  const targetEffectsClear = (expected.fadeAlpha ?? 0) <= 0.05 && (expected.tint?.alpha ?? 0) <= 0.05;
  if (targetHasVisual && targetEffectsClear) {
    if ((after.fadeAlpha ?? 0) >= 0.99) throw new Error(`${context} 恢复后 fadeAlpha 反向变为 1`);
    if ((afterCanvas.blackPixelRatio ?? 0) >= 0.985) throw new Error(`${context} 恢复后画布黑像素比例异常：${afterCanvas.blackPixelRatio}`);
    if (expected.backgroundKey !== null && after.backgroundKey === null) throw new Error(`${context} 恢复后背景消失`);
    if ((expected.portraits?.length ?? 0) > 0 && (after.portraits?.length ?? 0) === 0) throw new Error(`${context} 恢复后立绘消失`);
  }
  const expectedTimelines = JSON.stringify(expected.timelines ?? []);
  const actualTimelines = JSON.stringify(after.timelines ?? []);
  if (expectedTimelines !== actualTimelines) throw new Error(`${context} 恢复后时间轴不一致：${JSON.stringify({ expected: expected.timelines, actual: after.timelines })}`);
}

async function runSession(sessionId, mode, cycleCount) {
  const session = await launchSession(sessionId, mode);
  try {
    await session.waitAssetsAndTitle();
    await session.clickTarget('title:new', 'title:new');
    await session.waitFor('正式 Zero 游戏入口', () => window.__surdetDebug?.uiSession?.base === 'game'
      && window.__surdetDebug?.position !== null, undefined, 30000);
    // The opening text was emitted during a fade and is intentionally absent
    // from rollback history. Seed one real capturable text boundary first.
    await session.waitDialogueStable('opening fade completed');
    session.historySeed = await session.advanceOne('capturable history seed');
    const cycles = [];
    for (let cycle = 0; cycle < cycleCount; cycle += 1) {
      const checkpoints = [];
      const progression = [];
      for (let advance = 0; advance < protocol.advancePerCycle; advance += 1) {
        const step = await session.advanceOne(`session-${sessionId}-cycle-${cycle + 1}-advance-${advance + 1}`);
        checkpoints.push({ snapshot: step.before, canvas: step.beforeCanvas });
        progression.push({
          before: step.before,
          after: step.after,
          beforeCanvas: step.beforeCanvas,
          afterCanvas: step.afterCanvas,
          input: step.input,
          inputAttempts: step.inputAttempts,
        });
      }
      const rollbacks = [];
      for (let rollback = 0; rollback < protocol.rollbackPerCycle; rollback += 1) {
        await session.waitDialogueStable(`session-${sessionId}-cycle-${cycle + 1}-rollback-${rollback + 1}-input`);
        if (mode === 'settled') await session.waitFrames(2, `settled rollback ${rollback + 1}`);
        const before = await session.snapshot();
        const beforeCanvas = await session.captureCanvas(`cycle-${cycle + 1}-rollback-${rollback + 1}-before`);
        const checkpoint = checkpoints.pop();
        if (!checkpoint) throw new Error(`cycle ${cycle + 1} rollback ${rollback + 1} 缺少合法历史检查点`);
        const expectedKey = positionKey(checkpoint.snapshot?.position);
        const inputAt = Date.now();
        await session.clickTarget('rail:rollback', `cycle-${cycle + 1}-rollback-${rollback + 1}-click`);
        await session.waitDialogueStable(`session-${sessionId}-cycle-${cycle + 1}-rollback-${rollback + 1}-restore`, expectedKey);
        await session.waitFrames(2, `cycle-${cycle + 1}-rollback-${rollback + 1}-post-frame`);
        const after = await session.snapshot();
        const afterCanvas = await session.captureCanvas(`cycle-${cycle + 1}-rollback-${rollback + 1}-after`);
        if (positionKey(after?.position) !== expectedKey) {
          throw new Error(`cycle ${cycle + 1} rollback ${rollback + 1} 未回到合法历史：${JSON.stringify({ before, expectedKey, after })}`);
        }
        assertRollbackVisualInvariant(checkpoint.snapshot, after, afterCanvas, `session ${sessionId} cycle ${cycle + 1} rollback ${rollback + 1}`);
        const attempt = {
          cycle: cycle + 1,
          rollback: rollback + 1,
          mode,
          validHistory: true,
          before,
          expected: checkpoint.snapshot,
          after,
          beforeCanvas,
          afterCanvas,
          inputAt,
          inputIntervalMs: null,
          presentationStable: true,
          pageErrors: [...session.events.pageErrors],
          consoleErrors: [...session.events.consoleErrors],
          requestFailures: [...session.events.requestFailures],
          unhandledRejections: [...session.events.unhandledRejections],
          rendererErrors: [...session.events.rendererErrors],
          releaseFailures: [...session.events.releaseFailures],
        };
        const previous = session.attempts.at(-1);
        if (previous) attempt.inputIntervalMs = inputAt - previous.inputAt;
        session.attempts.push(attempt);
        rollbacks.push(attempt);
      }
      cycles.push({ cycle: cycle + 1, progression, rollbacks });
    }
    const result = {
      id: session.id,
      mode: session.mode,
      ok: true,
      userData: session.userData,
      identity: session.identity,
      historySeed: session.historySeed ?? null,
      cycles,
      attempts: session.attempts,
      screenshots: session.screenshots,
      events: session.events,
      failureMessage: null,
      failureStack: null,
      errorStack: null,
      lastSnapshot: cloneJson(session.lastSnapshot),
    };
    await session.close();
    return result;
  } catch (error) {
    session.failureMessage = error instanceof Error ? error.message : String(error);
    session.failureStack = errorText(error);
    const result = {
      id: session.id,
      mode: session.mode,
      ok: false,
      userData: session.userData,
      identity: session.identity,
      cycles: [],
      attempts: session.attempts,
      screenshots: session.screenshots,
      events: session.events,
      failureMessage: session.failureMessage,
      failureStack: session.failureStack,
      errorStack: session.failureStack,
      lastSnapshot: cloneJson(session.lastSnapshot),
    };
    try {
      await session.close();
    } catch (closeError) {
      result.failureStack += `\nclose: ${errorText(closeError)}`;
    }
    return result;
  }
}

function aggregateEvents(sessions) {
  const totals = {
    pageErrors: 0,
    consoleErrors: 0,
    requestFailures: 0,
    unhandledRejections: 0,
    rendererErrors: 0,
    releaseFailures: 0,
    unexpectedWindowClosed: 0,
  };
  for (const session of sessions) {
    for (const key of Object.keys(totals)) {
      if (key === 'unexpectedWindowClosed') totals[key] += session.events?.[key] ? 1 : 0;
      else totals[key] += session.events?.[key]?.length ?? 0;
    }
  }
  return totals;
}

function writeArtifact(sessions, status, fatalError = null) {
  const artifact = {
    schemaVersion: 1,
    status,
    head: runHead,
    sourceRoot: gameSourceRoot,
    distRoot: path.resolve(gameDist),
    generatedAt: new Date().toISOString(),
    protocol,
    execution: {
      smoke,
      requestedSessions: protocol.sessionCount,
      requestedAttempts: protocol.totalAttempts,
      actualSessions: sessions.length,
      actualAttempts: sessions.reduce((total, session) => total + (session.attempts?.length ?? 0), 0),
    },
    isolation: {
      tempRoot,
      userData: sessions.map((session) => session.userData),
    },
    sessions,
    eventTotals: aggregateEvents(sessions),
    error: fatalError ? errorText(fatalError) : null,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

async function main() {
  const sessions = [];
  try {
    buildFormalGame();
    const sessionCount = smoke ? 1 : protocol.sessionCount;
    const cycleCount = smoke ? 1 : protocol.cycleCount;
    for (let sessionIndex = 0; sessionIndex < protocol.sessionCount; sessionIndex += 1) {
      if (sessionIndex >= sessionCount) break;
      const mode = sessionIndex < 4 ? 'settled' : 'rapid';
      sessions.push(await runSession(`session-${String(sessionIndex + 1).padStart(2, '0')}-${mode}`, mode, cycleCount));
    }
    const actualAttempts = sessions.reduce((total, session) => total + session.attempts.length, 0);
    const status = !smoke && sessions.length === protocol.sessionCount
      && actualAttempts === protocol.totalAttempts
      && sessions.every((session) => session.ok)
      && sessions.every((session) => Object.values(session.events).every((value) => Array.isArray(value) ? value.length === 0 : value === false))
      ? 'PASSED'
      : 'FAILED';
    const artifact = writeArtifact(sessions, status);
    const output = {
      artifact: evidencePath,
      sha256: sha256File(evidencePath),
      status: artifact.status,
      sessions: sessions.length,
      attempts: actualAttempts,
      protocolAttempts: protocol.totalAttempts,
      tempRoot,
    };
    console.log(JSON.stringify(output, null, 2));
    if (status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    const artifact = writeArtifact(sessions, 'FAILED', error);
    console.error(JSON.stringify({
      artifact: evidencePath,
      sha256: sha256File(evidencePath),
      status: artifact.status,
      error: errorText(error),
    }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
