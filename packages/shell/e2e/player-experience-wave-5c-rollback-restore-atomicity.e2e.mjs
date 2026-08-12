/**
 * Surdet Player Experience Wave 5C — rollback restore atomicity diagnostic.
 *
 * This is a bounded evidence runner, not a game-specific workaround. It uses
 * the formal examples/zero-after-midnight/dist, isolated Electron userData,
 * and real player input.
 * It intentionally keeps screenshots sparse: one start and one end image per
 * case, plus at most one first-anomaly image per failure type.
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
const gameSourceRoot = path.join(repoRoot, 'examples', 'zero-after-midnight');
const gameDist = path.join(gameSourceRoot, 'dist');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-player-experience-wave-5c-'));
const evidencePath = path.join(tempRoot, 'wave-5c-rollback-restore-atomicity.json');

const protocol = Object.freeze({
  name: 'wave5c-rollback-restore-atomicity',
  phase: 2,
  maxSessions: 2,
  maxValidRollbacks: 14,
  maxRegularScreenshots: 8,
  cases: Object.freeze([
    Object.freeze({
      id: 'prologue-rapid-rollback',
      mode: 'rapid',
      rollbackCount: 12,
      advanceCount: 14,
      rollbackInput: 'rail:rollback',
    }),
    Object.freeze({
      id: 'common-0017-choice-rollback',
      mode: 'settled',
      rollbackCount: 2,
      advanceCount: 0,
      rollbackInput: 'rail:rollback',
      maxAdvanceSteps: 96,
    }),
  ]),
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
  if (result.status !== 0) throw new Error('无法读取当前 Git HEAD（exit=' + result.status + '）：' + (result.stderr || ''));
  const head = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(head)) throw new Error('git rev-parse HEAD 返回非法值：' + head);
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
    if (result.status !== 0) throw new Error('构建步骤失败：npm ' + args.join(' ') + '（exit=' + result.status + '）');
  }
  for (const required of [
    path.join(gameDist, 'index.html'),
  ]) {
    if (!fs.existsSync(required)) throw new Error('正式《零点之后》缺少构建文件：' + required);
  }
}

function errorText(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function positionKey(position) {
  return position ? String(position.sceneId) + ':' + String(position.pc) : 'null';
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
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
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    return { width: width || null, height: height || null, meanLuma: null, blackPixelRatio: null, method: 'unsupported' };
  }
  const channels = colorType === 6 ? 4 : 3;
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
      const up = previous[x] || 0;
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
      const r = row[base] / 255;
      const g = row[base + 1] / 255;
      const b = row[base + 2] / 255;
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

function emptyCanvasMetrics() {
  return {
    canvasPngHash: null,
    meanLuma: null,
    blackPixelRatio: null,
    canvasWidth: null,
    canvasHeight: null,
  };
}

function classifyConsole(events, message) {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
  else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
  else if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
  else events.consoleErrors.push(text);
}

function classifyPageError(events, error) {
  const text = errorText(error);
  if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
  else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
  else events.pageErrors.push(text);
}

async function launchSession(caseId, mode) {
  const sessionRoot = path.join(tempRoot, safeLabel(caseId));
  const tempUserData = path.join(sessionRoot, 'user-data');
  fs.mkdirSync(tempUserData, { recursive: true });
  const app = await electron.launch({
    args: ['.', '--user-data-dir=' + tempUserData],
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
  const anomalies = [];
  let closing = false;
  page.on('console', (message) => classifyConsole(events, message));
  page.on('pageerror', (error) => classifyPageError(events, error));
  page.on('requestfailed', (request) => {
    events.requestFailures.push((request.url() + ' ' + (request.failure()?.errorText || '')).trim());
  });
  page.on('close', () => {
    if (!closing) events.unexpectedWindowClosed = true;
  });
  await page.evaluate(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
      console.error('[e2e-unhandledrejection] ' + reason);
    });
  });
  const session = {
    id: caseId,
    mode,
    sessionRoot,
    tempUserData,
    app,
    page,
    events,
    screenshots,
    anomalies,
    attempts: [],
    observations: [],
    caseEvidence: null,
    identity: null,
    lastSnapshot: null,
    async waitFor(label, predicate, arg, timeoutMs) {
      if (page.isClosed()) throw new Error('窗口已关闭，无法等待：' + label);
      await page.waitForFunction(predicate, arg, { timeout: timeoutMs || 20000 });
    },
    async waitFrames(count, label) {
      if (page.isClosed()) throw new Error('窗口已关闭：' + label);
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
    async snapshot() {
      if (page.isClosed()) return null;
      const snapshot = await page.evaluate(() => {
        const debug = window.__surdetDebug;
        const presentation = debug?.presentationSnapshot || null;
        const world = presentation?.world || presentation?.stage?.world || presentation?.stage || presentation || null;
        const dialogue = debug?.dialogueProjection || null;
        const timelines = presentation?.timelines || presentation?.activeTimelines || [];
        return {
          title: document.title,
          position: debug?.position || null,
          interpreterStatus: debug?.status || null,
          rendererStatus: debug?.rendererStatus || null,
          uiSession: debug?.uiSession || null,
          activeOverlay: debug?.activeOverlay || null,
          backgroundKey: world?.backgroundKey || null,
          portraits: world?.portraits || [],
          cameraScale: world?.cameraScale ?? null,
          cameraPan: world?.cameraPan || null,
          fadeAlpha: world?.fadeAlpha ?? null,
          tint: world?.tint || null,
          worldAlpha: world?.worldAlpha ?? world?.alpha ?? 1,
          flash: world?.flash ?? world?.flashAlpha ?? null,
          wipe: world?.wipe ?? world?.wipeAlpha ?? null,
          activeTransition: world?.activeTransition || presentation?.activeTransition || null,
          particleKind: world?.particleKind ?? null,
          timelines,
          dialogueProjection: dialogue,
          choiceVisibleCount: dialogue?.visibleChoiceCount ?? 0,
          choiceLabels: dialogue?.choiceLabels || [],
          choiceBounds: dialogue?.choiceBounds || [],
          fadeTweenActive: debug?.fadeTweenActive ?? null,
          canCaptureRollbackCheckpoint: debug?.canCaptureRollbackCheckpoint ?? null,
          resourceSnapshot: debug?.resourceSnapshot || null,
          resourceLedger: debug?.resourceLedger || null,
          lastRendererError: debug?.lastRendererError || null,
        };
      });
      this.lastSnapshot = cloneJson(snapshot);
      return snapshot;
    },
    async canvasMetrics() {
      if (page.isClosed()) return emptyCanvasMetrics();
      const result = await page.evaluate(async () => {
        const canvas = document.querySelector('canvas');
        const thumbnail = window.__surdetDebug?.visualThumbnail;
        const fallback = canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '';
        const dataUrl = typeof thumbnail === 'string' && thumbnail.length > 0 ? thumbnail : fallback;
        const sourceWidth = canvas instanceof HTMLCanvasElement ? canvas.width : 0;
        const sourceHeight = canvas instanceof HTMLCanvasElement ? canvas.height : 0;
        if (!dataUrl) return { dataUrl: '', source: 'unavailable', width: sourceWidth, height: sourceHeight, meanLuma: null, blackPixelRatio: null };
        const image = new Image();
        image.src = dataUrl;
        await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
        const imageWidth = image.naturalWidth || sourceWidth || 320;
        const imageHeight = image.naturalHeight || sourceHeight || 180;
        const probe = document.createElement('canvas');
        probe.width = Math.max(1, Math.min(320, imageWidth));
        probe.height = Math.max(1, Math.min(180, imageHeight));
        const context = probe.getContext('2d');
        if (!context || !image.complete || image.naturalWidth === 0) {
          return { dataUrl, source: thumbnail ? 'visualThumbnail' : 'canvas-fallback', width: sourceWidth, height: sourceHeight, meanLuma: null, blackPixelRatio: null };
        }
        context.drawImage(image, 0, 0, probe.width, probe.height);
        const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
        let luma = 0;
        let black = 0;
        const count = probe.width * probe.height;
        for (let index = 0; index < pixels.length; index += 4) {
          const value = (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255;
          luma += value;
          if (value <= 0.02) black += 1;
        }
        return {
          dataUrl,
          source: thumbnail ? 'visualThumbnail' : 'canvas-fallback',
          width: sourceWidth,
          height: sourceHeight,
          meanLuma: count > 0 ? luma / count : null,
          blackPixelRatio: count > 0 ? black / count : null,
        };
      });
      return {
        canvasPngHash: result.dataUrl ? sha256Text(result.dataUrl) : null,
        pixelHashMethod: result.dataUrl ? `${result.source}-dataurl-sha256` : 'unavailable',
        visualSource: result.source,
        meanLuma: result.meanLuma,
        blackPixelRatio: result.blackPixelRatio,
        canvasWidth: result.width,
        canvasHeight: result.height,
      };
    },
    async captureScreenshot(label) {
      if (page.isClosed()) throw new Error('窗口已关闭，无法截图：' + label);
      const bounds = await page.locator('canvas').boundingBox();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('正式游戏画布不可见：' + label);
      const screenshotDir = path.join(sessionRoot, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, safeLabel(label) + '.png');
      await page.screenshot({ path: screenshotPath, clip: bounds, animations: 'disabled' });
      const metrics = readPngMetrics(screenshotPath);
      const screenshotSha256 = sha256File(screenshotPath);
      const evidence = {
        label,
        path: screenshotPath,
        bytes: fs.statSync(screenshotPath).size,
        screenshotSha256,
        canvasPngHash: screenshotSha256,
        pixelHash: screenshotSha256,
        pixelHashMethod: 'png-sha256-proxy',
        canvasWidth: metrics.width,
        canvasHeight: metrics.height,
        meanLuma: metrics.meanLuma,
        blackPixelRatio: metrics.blackPixelRatio,
        metricMethod: metrics.method,
      };
      screenshots.push(evidence);
      return evidence;
    },
    async waitAssetsAndTitle() {
      await this.waitFor('Renderer debug surface', () => window.__surdetDebug?.uiSession !== undefined, undefined, 30000);
      await this.waitFor('formal Zero assets', () => {
        const progress = window.__surdetDebug?.assetLoading;
        return progress?.done === true && progress.total > 0
          && progress.completed === progress.total && progress.failed === 0;
      }, undefined, 120000);
      await this.waitFor('formal Zero title', () => window.__surdetDebug?.uiSession?.base === 'title', undefined, 30000);
      await this.waitFor('title new target', () => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:new'), undefined, 30000);
      this.identity = await page.evaluate(() => ({
        title: document.title,
        href: location.href,
        sourceRoot: window.__surdetDebug?.sourceRoot || null,
        assetLoading: window.__surdetDebug?.assetLoading || null,
        activeOverlay: window.__surdetDebug?.activeOverlay || null,
      }));
    },
    async targetPoint(targetId) {
      return page.evaluate((id) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === id);
        const canvas = document.querySelector('canvas');
        if (!target || !(canvas instanceof HTMLCanvasElement)) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
          y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
        };
      }, targetId);
    },
    async clickTarget(targetId, label) {
      const point = await this.targetPoint(targetId);
      if (!point) throw new Error('找不到真实交互目标：' + targetId);
      await page.mouse.click(point.x, point.y);
      await this.waitFrames(2, label || targetId);
      return point;
    },
    async clickCanvas(x, y, label) {
      const bounds = await page.locator('canvas').boundingBox();
      if (!bounds) throw new Error('正式游戏画布不可见：' + (label || 'click'));
      await page.mouse.click(
        bounds.x + (x / 1280) * bounds.width,
        bounds.y + (y / 720) * bounds.height,
      );
      await this.waitFrames(2, label || 'canvas click');
    },
    async waitGameStable(label) {
      await this.waitFor(label + ' game stable', () => {
        const debug = window.__surdetDebug;
        return debug?.uiSession?.base === 'game'
          && debug?.uiSession?.overlay === 'none'
          && debug?.uiSession?.operation === 'idle'
          && debug?.rendererStatus !== 'typing'
          && (debug?.status === 'awaiting-advance' || debug?.status === 'choice');
      }, undefined, 30000);
    },
    async advanceOne(label) {
      await this.waitGameStable(label + ' before');
      const before = await this.snapshot();
      const canvas = await this.canvasMetrics();
      const beforeKey = positionKey(before?.position);
      const beforeText = before?.dialogueProjection?.dialogText || null;
      const key = before?.rendererStatus === 'choice' || before?.choiceVisibleCount > 0 ? '1' : 'Space';
      await page.keyboard.press(key);
      await this.waitFor(label + ' position/text change', ({ expectedKey, expectedText }) => {
        const debug = window.__surdetDebug;
        const position = debug?.position;
        const keyNow = position ? String(position.sceneId) + ':' + String(position.pc) : 'null';
        const textNow = debug?.dialogueProjection?.dialogText || null;
        return keyNow !== expectedKey || textNow !== expectedText;
      }, { expectedKey: beforeKey, expectedText: beforeText }, 10000);
      await this.waitGameStable(label + ' after');
      const after = await this.snapshot();
      return { before, after, canvas };
    },
    async waitScene(sceneId) {
      await this.waitFor('scene ' + sceneId, (expected) => window.__surdetDebug?.position?.sceneId === expected, sceneId, 30000);
    },
    async waitChoice() {
      await this.waitFor('common_0017 choice', () => {
        const projection = window.__surdetDebug?.dialogueProjection;
        return window.__surdetDebug?.position?.sceneId === 'common_0017'
          && window.__surdetDebug?.status === 'choice'
          && projection?.visibleChoiceCount === 3
          && projection?.choiceBounds?.length === 3
          && JSON.stringify(projection?.choiceLabels || []) === JSON.stringify([
            '记录她说的时间',
            '追问失踪的原因',
            '先挂断电话',
          ]);
      }, undefined, 30000);
    },
    async recordAnomaly(type, message, snapshot, canvas) {
      const anomaly = {
        type,
        message,
        snapshot: cloneJson(snapshot),
        canvas: cloneJson(canvas),
        frameSamples: [],
        screenshot: null,
      };
      if (!anomalies.some((entry) => entry.type === type)) {
        try {
          anomaly.screenshot = await this.captureScreenshot('firstAnomaly');
        } catch (error) {
          anomaly.screenshotError = errorText(error);
        }
      }
      anomalies.push(anomaly);
      return anomaly;
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

function worldSignature(value) {
  if (!value) return null;
  return {
    backgroundKey: value.backgroundKey || null,
    portraits: (value.portraits || []).map((portrait) => portrait.key || portrait.id || null).sort(),
    cameraScale: value.cameraScale,
    cameraPan: value.cameraPan || null,
    fadeAlpha: value.fadeAlpha,
    tint: value.tint || null,
    particleKind: value.particleKind || null,
  };
}

function closeNumber(left, right, tolerance) {
  return typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) <= tolerance;
}

function visualMismatch(expected, actual, expectedCanvas, actualCanvas) {
  const expectedWorld = worldSignature(expected);
  const actualWorld = worldSignature(actual);
  const targetHasVisual = Boolean(expectedWorld?.backgroundKey) || (expectedWorld?.portraits?.length || 0) > 0;
  const mismatch = {
    missingBackground: targetHasVisual && Boolean(expectedWorld?.backgroundKey) && !actualWorld?.backgroundKey,
    missingPortraits: targetHasVisual
      && (expectedWorld?.portraits?.length || 0) > 0
      && (actualWorld?.portraits?.length || 0) === 0,
    fade: !closeNumber(expectedWorld?.fadeAlpha, actualWorld?.fadeAlpha, 0.08),
    tint: JSON.stringify(expectedWorld?.tint || null) !== JSON.stringify(actualWorld?.tint || null),
    particle: expectedWorld?.particleKind !== actualWorld?.particleKind,
    dark: targetHasVisual && (actualCanvas?.blackPixelRatio || 0) >= 0.985,
    gradualDark: targetHasVisual
      && typeof expectedCanvas?.meanLuma === 'number'
      && expectedCanvas.meanLuma > 0.06
      && typeof actualCanvas?.meanLuma === 'number'
      && actualCanvas.meanLuma < expectedCanvas.meanLuma * 0.35,
  };
  return mismatch;
}

function hasMismatch(mismatch) {
  return Object.values(mismatch).some(Boolean);
}

function choiceMismatch(snapshot) {
  const labels = snapshot?.choiceLabels || [];
  const visible = Number(snapshot?.choiceVisibleCount || 0);
  const interpreterChoice = snapshot?.interpreterStatus === 'choice';
  const rendererChoice = snapshot?.rendererStatus === 'choice';
  return {
    staleVisibleWithoutPending: !interpreterChoice && visible > 0,
    labelsWithoutPending: !interpreterChoice && labels.length > 0,
    rendererChoiceWithoutVisible: rendererChoice && visible !== labels.length,
    rendererChoiceWithoutInterpreter: rendererChoice && !interpreterChoice,
  };
}

async function runPrologueCase(session) {
  await session.waitAssetsAndTitle();
  await session.clickTarget('title:new', 'title:new');
  await session.waitScene('prologue');
  await session.waitFor('active FadeTween observation', () => window.__surdetDebug?.fadeTweenActive === true, undefined, 12000);
  const activeFade = await session.snapshot();
  session.observations.push({
    kind: 'fade-active-player-path',
    fadeTweenActive: activeFade?.fadeTweenActive ?? null,
    fadeAlpha: activeFade?.fadeAlpha ?? null,
    canCaptureRollbackCheckpoint: activeFade?.canCaptureRollbackCheckpoint ?? null,
    scene: activeFade?.position?.sceneId ?? null,
    snapshot: activeFade,
  });
  await session.waitFor('stable rollback checkpoint boundary', () => {
    const debug = window.__surdetDebug;
    return debug?.fadeTweenActive === false && debug?.canCaptureRollbackCheckpoint === true;
  }, undefined, 12000);
  const stableBoundary = await session.snapshot();
  session.observations.push({
    kind: 'stable-rollback-boundary',
    fadeTweenActive: stableBoundary?.fadeTweenActive ?? null,
    fadeAlpha: stableBoundary?.fadeAlpha ?? null,
    canCaptureRollbackCheckpoint: stableBoundary?.canCaptureRollbackCheckpoint ?? null,
    scene: stableBoundary?.position?.sceneId ?? null,
    snapshot: stableBoundary,
  });
  session.caseEvidence = {
    fadeActiveObserved: activeFade?.fadeTweenActive === true,
    activeFade,
    stableBoundary,
    rollbackInput: 'rail:rollback',
  };
  const checkpoints = [];
  for (let index = 0; index < protocol.cases[0].advanceCount; index += 1) {
    const step = await session.advanceOne('prologue advance ' + (index + 1));
    checkpoints.push({ snapshot: step.before, canvas: step.canvas });
  }
  await session.captureScreenshot('start');
  for (let index = 0; index < protocol.cases[0].rollbackCount; index += 1) {
    const before = await session.snapshot();
    const beforeCanvas = await session.canvasMetrics();
    const checkpoint = checkpoints.pop();
    if (!checkpoint) throw new Error('prologue rollback 缺少合法历史检查点');
    const expectedKey = positionKey(checkpoint.snapshot?.position);
    await session.clickTarget('rail:rollback', 'rail:rollback ' + (index + 1));
    await session.waitFor('rapid rollback target ' + (index + 1), (expected) => {
      const position = window.__surdetDebug?.position;
      const current = position ? String(position.sceneId) + ':' + String(position.pc) : 'null';
      return current === expected;
    }, expectedKey, 10000);
    const after = await session.snapshot();
    const afterCanvas = await session.canvasMetrics();
    const frameSamples = [];
    for (let frame = 0; frame < 3; frame += 1) {
      await session.waitFrames(1, 'rapid rollback observation ' + (index + 1) + ':' + frame);
      frameSamples.push(await session.snapshot());
    }
    const mismatch = visualMismatch(checkpoint.snapshot, after, checkpoint.canvas, afterCanvas);
    mismatch.fadeBoundary = after?.fadeTweenActive !== false || after?.canCaptureRollbackCheckpoint !== true;
    if (hasMismatch(mismatch)) {
      await session.recordAnomaly('BLACK_SCREEN_GRADUAL_OR_INSTANT', JSON.stringify(mismatch), after, afterCanvas);
    }
    const attempt = {
      index: index + 1,
      mode: 'rapid',
      rollbackInput: 'rail:rollback',
      validHistory: positionKey(after?.position) === expectedKey,
      before,
      expected: checkpoint.snapshot,
      after,
      beforeCanvas,
      afterCanvas,
      frameSamples,
      visualMismatch: mismatch,
      choiceMismatch: choiceMismatch(after),
      pageErrors: [...session.events.pageErrors],
      consoleErrors: [...session.events.consoleErrors],
      requestFailures: [...session.events.requestFailures],
      unhandledRejections: [...session.events.unhandledRejections],
      rendererErrors: [...session.events.rendererErrors],
      releaseFailures: [...session.events.releaseFailures],
    };
    session.attempts.push(attempt);
    if (!attempt.validHistory) throw new Error('rapid rollback 未回到合法历史：' + JSON.stringify(attempt));
  }
  await session.waitGameStable('prologue end');
  await session.captureScreenshot('end');
}

async function runChoiceCase(session) {
  await session.waitAssetsAndTitle();
  await session.clickTarget('title:new', 'title:new');
  let reachedChoice = false;
  for (let index = 0; index < protocol.cases[1].maxAdvanceSteps; index += 1) {
    const current = await session.snapshot();
    if (current?.position?.sceneId === 'common_0017'
      && current?.choiceVisibleCount === 3
      && current?.interpreterStatus === 'choice') {
      reachedChoice = true;
      break;
    }
    await session.advanceOne('common_0017 advance ' + (index + 1));
  }
  if (!reachedChoice) throw new Error('未通过真实推进到达 common_0017 三选一');
  await session.waitChoice();
  await session.captureScreenshot('start');
  const choiceBefore = await session.snapshot();
  const choicePoint = await session.clickTarget('choice:0', 'real choice option choice:0');
  await session.waitFor('choice branch selected', () => window.__surdetDebug?.status !== 'choice'
    && window.__surdetDebug?.dialogueProjection?.visibleChoiceCount === 0, undefined, 10000);
  const selected = await session.snapshot();
  const branchStep = await session.advanceOne('choice branch text');
  const rollbackTargets = [branchStep.before, selected];
  const rollbackAttempts = [];
  for (let index = 0; index < protocol.cases[1].rollbackCount; index += 1) {
    const before = await session.snapshot();
    const beforeCanvas = await session.canvasMetrics();
    const expected = rollbackTargets[Math.min(index, rollbackTargets.length - 1)];
    await session.clickTarget('rail:rollback', 'choice rail:rollback ' + (index + 1));
    await session.waitFor('choice rollback target ' + (index + 1), (expectedKey) => {
      const position = window.__surdetDebug?.position;
      const currentKey = position ? String(position.sceneId) + ':' + String(position.pc) : 'null';
      return currentKey === expectedKey;
    }, positionKey(expected?.position), 10000);
    const after = await session.snapshot();
    const afterCanvas = await session.canvasMetrics();
    const frameSamples = [];
    for (let frame = 0; frame < 2; frame += 1) {
      await session.waitFrames(1, 'choice rollback observation ' + (index + 1) + ':' + frame);
      frameSamples.push(await session.snapshot());
    }
    const stale = choiceMismatch(after);
    if (Object.values(stale).some(Boolean)) {
      await session.recordAnomaly('STALE_CHOICE_UI', JSON.stringify(stale), after, afterCanvas);
    }
    const visual = visualMismatch(expected, after, null, afterCanvas);
    if (hasMismatch(visual)) {
      await session.recordAnomaly('BLACK_SCREEN_GRADUAL_OR_INSTANT', JSON.stringify(visual), after, afterCanvas);
    }
    const attempt = {
      index: index + 1,
      mode: 'settled',
      rollbackInput: 'rail:rollback',
      validHistory: positionKey(after?.position) === positionKey(expected?.position),
      before,
      expected,
      after,
      beforeCanvas,
      afterCanvas,
      frameSamples,
      visualMismatch: visual,
      choiceMismatch: stale,
      choiceBefore,
      selected,
      actualChoiceClick: { target: 'choice:0', point: choicePoint, input: 'page.mouse.click' },
      choiceBounds: choiceBefore?.choiceBounds || [],
      pageErrors: [...session.events.pageErrors],
      consoleErrors: [...session.events.consoleErrors],
      requestFailures: [...session.events.requestFailures],
      unhandledRejections: [...session.events.unhandledRejections],
      rendererErrors: [...session.events.rendererErrors],
      releaseFailures: [...session.events.releaseFailures],
    };
    session.attempts.push(attempt);
    rollbackAttempts.push(attempt);
  }

  let nextChoice = null;
  for (let index = 0; index < protocol.cases[1].maxAdvanceSteps; index += 1) {
    const current = await session.snapshot();
    if (current?.interpreterStatus === 'choice' && current.choiceVisibleCount > 0) {
      nextChoice = current;
      break;
    }
    await session.advanceOne('next real choice advance ' + (index + 1));
  }
  if (!nextChoice) throw new Error('回退后未能正常推进到新的真实 choice');
  const nextChoicePoint = await session.clickTarget('choice:0', 'next real choice option choice:0');
  await session.waitFor('next choice branch selected', () => window.__surdetDebug?.status !== 'choice'
    && window.__surdetDebug?.dialogueProjection?.visibleChoiceCount === 0, undefined, 10000);
  session.caseEvidence = {
    rollbackInput: 'rail:rollback',
    commonChoiceScene: choiceBefore?.position?.sceneId ?? null,
    initialChoice: choiceBefore,
    initialChoiceClick: { target: 'choice:0', point: choicePoint, input: 'page.mouse.click' },
    postRollbackChoice: nextChoice,
    postRollbackChoiceClick: { target: 'choice:0', point: nextChoicePoint, input: 'page.mouse.click' },
    ghostChoiceObserved: rollbackAttempts.some((attempt) => Object.values(attempt.choiceMismatch).some(Boolean)),
  };
  await session.waitGameStable('choice end');
  await session.captureScreenshot('end');
  return { choiceBefore, selected, rollbackAttempts };
}

async function runCase(caseConfig) {
  const session = await launchSession(caseConfig.id, caseConfig.mode);
  try {
    if (caseConfig.id === 'prologue-rapid-rollback') await runPrologueCase(session);
    else await runChoiceCase(session);
    return {
      id: session.id,
      mode: session.mode,
      ok: session.anomalies.length === 0 && session.attempts.every((attempt) => attempt.validHistory),
      userData: session.tempUserData,
      identity: session.identity,
      attempts: session.attempts,
      observations: session.observations,
      caseEvidence: session.caseEvidence,
      anomalies: session.anomalies,
      screenshots: session.screenshots,
      events: session.events,
      failureMessage: null,
      failureStack: null,
      lastSnapshot: cloneJson(session.lastSnapshot),
    };
  } catch (error) {
    const result = {
      id: session.id,
      mode: session.mode,
      ok: false,
      userData: session.tempUserData,
      identity: session.identity,
      attempts: session.attempts,
      observations: session.observations,
      caseEvidence: session.caseEvidence,
      anomalies: session.anomalies,
      screenshots: session.screenshots,
      events: session.events,
      failureMessage: error instanceof Error ? error.message : String(error),
      failureStack: errorText(error),
      lastSnapshot: cloneJson(session.lastSnapshot),
    };
    return result;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      session.events.consoleErrors.push('close: ' + errorText(closeError));
    }
  }
}

function aggregateEvents(cases) {
  const totals = {
    pageErrors: 0,
    consoleErrors: 0,
    requestFailures: 0,
    unhandledRejections: 0,
    rendererErrors: 0,
    releaseFailures: 0,
    unexpectedWindowClosed: 0,
  };
  for (const item of cases) {
    for (const key of Object.keys(totals)) {
      if (key === 'unexpectedWindowClosed') totals[key] += item.events?.[key] ? 1 : 0;
      else totals[key] += item.events?.[key]?.length || 0;
    }
  }
  return totals;
}

function writeArtifact(cases, status, error) {
  const artifact = {
    schemaVersion: 1,
    status,
    head: runHead,
    sourceRoot: gameSourceRoot,
    distRoot: path.resolve(gameDist),
    generatedAt: new Date().toISOString(),
    protocol,
    execution: {
      requestedCases: protocol.cases.length,
      actualSessions: cases.length,
      actualAttempts: cases.reduce((sum, item) => sum + item.attempts.length, 0),
      maxValidRollbacks: protocol.maxValidRollbacks,
      regularScreenshots: cases.reduce((sum, item) => sum + item.screenshots.length, 0),
    },
    screenshots: cases.flatMap((item) => item.screenshots),
    cases,
    eventTotals: aggregateEvents(cases),
    error: error ? errorText(error) : null,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  return artifact;
}

async function main() {
  const cases = [];
  let fatalError = null;
  try {
    buildFormalGame();
    for (const caseConfig of protocol.cases) cases.push(await runCase(caseConfig));
    const actualAttempts = cases.reduce((sum, item) => sum + item.attempts.length, 0);
    const allEventsClear = cases.every((item) => Object.entries(item.events).every(([key, value]) => key === 'unexpectedWindowClosed' ? value === false : value.length === 0));
    const allHistoryValid = cases.every((item) => item.attempts.every((attempt) => attempt.validHistory));
    const status = cases.length === protocol.cases.length
      && cases.length === protocol.maxSessions
      && actualAttempts === protocol.maxValidRollbacks
      && allHistoryValid
      && allEventsClear
      && cases.every((item) => item.caseEvidence !== null)
      && cases.every((item) => item.ok)
      ? 'PASSED'
      : 'FAILED';
    const artifact = writeArtifact(cases, status, null);
    console.log(JSON.stringify({
      artifact: evidencePath,
      sha256: sha256File(evidencePath),
      status: artifact.status,
      sessions: artifact.execution.actualSessions,
      attempts: artifact.execution.actualAttempts,
      screenshots: artifact.execution.regularScreenshots,
      eventTotals: artifact.eventTotals,
      sourceRoot: artifact.sourceRoot,
      distRoot: artifact.distRoot,
    }, null, 2));
    if (artifact.status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    fatalError = error;
    const artifact = writeArtifact(cases, 'FAILED', fatalError);
    console.error(errorText(error));
    console.error(JSON.stringify({ artifact: evidencePath, sha256: sha256File(evidencePath), status: artifact.status }, null, 2));
    process.exitCode = 1;
  }
}

await main();
