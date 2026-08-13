/**
 * Gallery music playback evidence runner.
 *
 * Both cases use the formal examples/zero-after-midnight dist, an independent
 * Electron process and independent userData. All player actions are real
 * keyboard or page.mouse.click input; __surdetDebug is read-only evidence.
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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-gallery-music-'));
const evidencePath = path.join(tempRoot, 'gallery-music-playback.json');
const formalEntryLabel = 'examples/zero-after-midnight';
const pathDescriptions = Object.freeze({
  title: '标题 → 鉴赏 → 音乐',
  game: '新游戏 → 系统菜单 → 鉴赏 → 音乐',
});

const protocol = Object.freeze({
  name: 'gallery-music-playback',
  sourceRoot: gameSourceRoot,
  distRoot: path.resolve(gameDist),
  cases: Object.freeze([
    Object.freeze({ id: 'title-gallery-music', source: 'title', description: pathDescriptions.title }),
    Object.freeze({ id: 'game-gallery-music', source: 'game', description: pathDescriptions.game }),
  ]),
  musicIds: Object.freeze(['old_room', 'midnight_rain']),
  input: 'page.mouse.click',
});

const buildSteps = [
  ['run', 'build', '-w', '@surdet/core'],
  ['run', 'build', '-w', '@surdet/renderer'],
  ['run', 'build', '-w', '@surdet/host'],
  ['run', 'build', '-w', '@surdet/shell'],
  ['run', 'build', '-w', 'zero-after-midnight'],
];

function errorText(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function cloneJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function currentGitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    env: { ...process.env },
    shell: false,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`无法读取当前 Git HEAD（exit=${result.status}）：${result.stderr || ''}`);
  const head = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(head)) throw new Error(`git rev-parse HEAD 返回非法值：${head}`);
  return head;
}

function npmInvocation(args) {
  const configuredNpmCli = process.env.npm_execpath;
  const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = configuredNpmCli || (fs.existsSync(bundledNpmCli) ? bundledNpmCli : null);
  return npmCli
    ? { command: process.execPath, args: [npmCli, ...args] }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
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
  const required = [
    path.join(repoRoot, 'packages', 'shell', 'dist', 'main.js'),
    path.join(repoRoot, 'packages', 'shell', 'dist', 'preload.cjs'),
    path.join(gameDist, 'index.html'),
    path.join(gameSourceRoot, 'game.config.json'),
  ];
  const missing = required.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) throw new Error(`正式《零点之后》构建缺少文件：${missing.join(', ')}`);
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

function classifyConsole(events, message) {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
  else if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
  else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
  else events.consoleErrors.push(text);
}

function classifyPageError(events, error) {
  const text = errorText(error);
  if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
  else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
  else events.pageErrors.push(text);
}

async function launchSession(caseId, source) {
  const caseRoot = path.join(tempRoot, caseId);
  const tempUserData = path.join(caseRoot, 'user-data');
  fs.mkdirSync(tempUserData, { recursive: true });
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${tempUserData}`],
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
  page.on('console', (message) => classifyConsole(events, message));
  page.on('pageerror', (error) => classifyPageError(events, error));
  page.on('requestfailed', (request) => {
    events.requestFailures.push(`${request.url()} ${(request.failure()?.errorText || '')}`.trim());
  });
  page.on('close', () => {
    if (!closing) events.unexpectedWindowClosed = true;
  });
  await page.evaluate(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error
        ? event.reason.stack || event.reason.message
        : String(event.reason);
      console.error(`[e2e-unhandledrejection] ${reason}`);
    });
  });

  const session = {
    caseId,
    source,
    caseRoot,
    tempUserData,
    app,
    page,
    events,
    screenshots,
    lastSnapshot: null,
    async waitFor(label, predicate, arg = undefined, timeoutMs = 20000) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法等待：${label}`);
      await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    },
    async waitFrame(label) {
      if (page.isClosed()) throw new Error(`窗口已关闭：${label}`);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    },
    async snapshot() {
      if (page.isClosed()) return null;
      const snapshot = await page.evaluate(() => {
        const debug = window.__surdetDebug;
        return {
          title: document.title,
          status: debug?.status ?? null,
          rendererStatus: debug?.rendererStatus ?? null,
          position: debug?.position ?? null,
          activeOverlay: debug?.activeOverlay ?? null,
          uiSession: debug?.uiSession ?? null,
          dialogueProjection: debug?.dialogueProjection ?? null,
          visibleChoiceCount: debug?.dialogueProjection?.visibleChoiceCount ?? 0,
          galleryMusicPlayback: debug?.galleryMusicPlayback ?? null,
          audioPlayback: debug?.audioPlayback ?? null,
          interactionTargets: debug?.interactionTargets ?? [],
          assetLoading: debug?.assetLoading ?? null,
          lastRendererError: debug?.lastRendererError ?? null,
        };
      });
      this.lastSnapshot = cloneJson(snapshot);
      return snapshot;
    },
    async waitAssets() {
      await this.waitFor('formal Zero debug surface', () => window.__surdetDebug?.uiSession !== undefined, undefined, 30000);
      await this.waitFor('formal Zero assets', () => {
        const progress = window.__surdetDebug?.assetLoading;
        return progress?.done === true && progress.total > 0
          && progress.completed === progress.total && progress.failed === 0;
      }, undefined, 120000);
    },
    async waitTarget(targetId, label = targetId) {
      await this.waitFor(`${label} interaction target`, (id) => window.__surdetDebug?.interactionTargets?.some((item) => item.id === id), targetId, 30000);
    },
    async clickTarget(targetId, label = targetId) {
      const point = await page.evaluate((id) => {
        const target = window.__surdetDebug?.interactionTargets?.find((item) => item.id === id);
        const canvas = document.querySelector('canvas');
        if (!target || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((target.x + target.width / 2) / 1280) * rect.width,
          y: rect.top + ((target.y + target.height / 2) / 720) * rect.height,
          logical: { x: target.x, y: target.y, width: target.width, height: target.height },
        };
      }, targetId);
      if (!point) throw new Error(`找不到真实交互目标：${targetId}`);
      await page.mouse.click(point.x, point.y);
      await this.waitFrame(label);
      return { target: targetId, x: point.x, y: point.y, logical: point.logical, input: 'page.mouse.click' };
    },
    async screenshot(label) {
      if (page.isClosed()) throw new Error(`窗口已关闭，无法截图：${label}`);
      const bounds = await page.locator('canvas').boundingBox();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error(`画布不可见：${label}`);
      const screenshotDir = path.join(caseRoot, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const safeLabel = String(label).replace(/[^a-z0-9._-]+/gi, '-');
      const screenshotPath = path.join(screenshotDir, `${safeLabel}.png`);
      await page.screenshot({ path: screenshotPath, clip: bounds, animations: 'disabled' });
      const bytes = fs.statSync(screenshotPath).size;
      const screenshotSha256 = sha256File(screenshotPath);
      const canvasDataUrl = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : null;
      });
      const record = {
        label,
        path: screenshotPath,
        bytes,
        screenshotSha256,
        canvasPngHash: canvasDataUrl ? sha256Text(canvasDataUrl) : null,
      };
      screenshots.push(record);
      return record;
    },
    async close() {
      closing = true;
      await app.close();
    },
  };
  return session;
}

function positionKey(snapshot) {
  const position = snapshot?.position;
  return position ? `${position.sceneId}:${position.pc}` : 'null';
}

async function advanceToCommonApartment(session) {
  for (let step = 1; step <= 600; step += 1) {
    const snapshot = await session.snapshot();
    if (snapshot?.position?.sceneId === 'common_apartment') return snapshot;
    if (snapshot?.status === 'awaiting-choice' || snapshot?.rendererStatus === 'choice'
      || Number(snapshot?.visibleChoiceCount ?? 0) > 0) {
      await session.waitTarget('choice:0', '真实 choice:0');
      await session.clickTarget('choice:0', '真实 choice:0');
      await session.waitFor('choice dismissed', () => {
        const debug = window.__surdetDebug;
        return debug?.status !== 'awaiting-choice'
          && debug?.rendererStatus !== 'choice'
          && (debug?.dialogueProjection?.visibleChoiceCount ?? 0) === 0;
      }, undefined, 15000);
      continue;
    }
    if (snapshot?.status === 'awaiting-advance' && snapshot?.rendererStatus !== 'choice') {
      await session.page.keyboard.press('Space');
      await session.waitFrame(`推进文本 ${step}`);
      await session.page.waitForTimeout(80);
      continue;
    }
    if (snapshot?.status === 'ended') throw new Error(`在抵达 common_apartment 前剧情已结束（step=${step}）`);
    await session.page.waitForTimeout(100);
  }
  throw new Error(`真实推进 600 步后仍未抵达 common_apartment（最后位置=${positionKey(await session.snapshot())}）`);
}

async function openGallery(session) {
  await session.waitFor('Gallery CG 页', (expected) => window.__surdetDebug?.activeOverlay === expected, 'gallery:cg');
  await session.waitTarget('gallery:music');
  await session.clickTarget('gallery:music', 'Gallery 音乐标签');
  await session.waitFor('Gallery 音乐页', (expected) => window.__surdetDebug?.activeOverlay === expected, 'gallery:music');
  await session.waitTarget('gallery:music:old_room', '已解锁 old_room');
  await session.waitTarget('gallery:music:midnight_rain', '已解锁 midnight_rain');
}

async function prepareCase(session) {
  await session.waitAssets();
  await session.waitFor('标题页', (expected) => window.__surdetDebug?.activeOverlay === expected, 'title');
  await session.waitTarget('title:new');
  await session.clickTarget('title:new', '标题开始游戏');
  await session.waitFor('新游戏已开始', () => window.__surdetDebug?.uiSession?.base === 'game'
    && window.__surdetDebug?.position !== null
    && window.__surdetDebug?.activeOverlay === null, undefined, 30000);
  await advanceToCommonApartment(session);
  await session.page.keyboard.press('Escape');
  await session.waitFor('系统菜单', (expected) => window.__surdetDebug?.activeOverlay === expected, 'system-menu');
  if (session.source === 'title') {
    await session.waitTarget('system:title');
    await session.clickTarget('system:title', '返回标题');
    await session.waitFor('返回标题页', (expected) => window.__surdetDebug?.activeOverlay === expected, 'title');
    await session.waitTarget('title:gallery');
    await session.clickTarget('title:gallery', '标题页鉴赏');
  } else {
    await session.waitTarget('system:gallery');
    await session.clickTarget('system:gallery', '游戏内鉴赏');
  }
  await openGallery(session);
}

function playbackSuccess(before, after, targetId) {
  const beforeAudio = before?.audioPlayback;
  const afterAudio = after?.audioPlayback;
  const request = after?.galleryMusicPlayback?.lastRequest;
  return afterAudio?.bgm === targetId
    && afterAudio?.bgmPlaying === true
    && Number(afterAudio?.bgmPlayCount ?? 0) > Number(beforeAudio?.bgmPlayCount ?? 0)
    && request?.id === targetId
    && request?.sourceResolved === true
    && request?.resolvedSource === afterAudio?.bgmSource;
}

function classifyAttempt(before, after, targetId, callbackReached) {
  const request = after?.galleryMusicPlayback?.lastRequest;
  const sourceResolved = request?.id === targetId
    && request?.sourceResolved === true
    && typeof request?.resolvedSource === 'string'
    && request.resolvedSource.length > 0
    && after?.audioPlayback?.bgmSource === request.resolvedSource;
  const sameSourceNoop = callbackReached
    && sourceResolved
    && after?.audioPlayback?.bgm === targetId
    && after?.audioPlayback?.bgmPlaying === true
    && Number(after?.audioPlayback?.bgmPlayCount ?? 0) === Number(before?.audioPlayback?.bgmPlayCount ?? 0);
  const howlerErrors = after?.audioPlayback?.howlerErrors ?? [];
  if (!callbackReached) return 'CALLBACK_NOT_REACHED';
  if (!sourceResolved) return 'SOURCE_NOT_RESOLVED';
  if (sameSourceNoop) return 'SAME_SOURCE_NOOP';
  if (!playbackSuccess(before, after, targetId)) return 'HOWLER_PLAYBACK_FAILED';
  return null;
}

async function clickMusic(session, targetId) {
  const before = await session.snapshot();
  const beforeScreenshot = await session.screenshot(`${targetId}-before`);
  const beforeCallbackCount = Number(before?.galleryMusicPlayback?.callbackCount ?? 0);
  const click = await session.clickTarget(`gallery:music:${targetId}`, `点击音乐 ${targetId}`);
  let callbackWaitError = null;
  try {
    await session.waitFor(`${targetId} callback`, (expected) => Number(window.__surdetDebug?.galleryMusicPlayback?.callbackCount ?? 0) > expected, beforeCallbackCount, 10000);
  } catch (error) {
    callbackWaitError = errorText(error);
  }
  let playbackWaitError = null;
  try {
    await session.waitFor(`${targetId} 实际播放`, (expected) => {
      const debug = window.__surdetDebug;
      const audio = debug?.audioPlayback;
      const request = debug?.galleryMusicPlayback?.lastRequest;
      return audio?.bgm === expected
        && audio?.bgmPlaying === true
        && request?.id === expected
        && request?.sourceResolved === true;
    }, targetId, 3000);
  } catch (error) {
    playbackWaitError = errorText(error);
  }
  const after = await session.snapshot();
  const afterScreenshot = await session.screenshot(`${targetId}-after`);
  const callbackReached = Number(after?.galleryMusicPlayback?.callbackCount ?? 0) > beforeCallbackCount;
  const classification = classifyAttempt(before, after, targetId, callbackReached);
  const howlerErrors = cloneJson(after?.audioPlayback?.howlerErrors ?? []);
  return {
    targetId,
    click,
    before,
    after,
    beforeScreenshot,
    afterScreenshot,
    callbackReached,
    sourceResolved: after?.galleryMusicPlayback?.lastRequest?.sourceResolved === true,
    actualPlayback: playbackSuccess(before, after, targetId),
    sameSourceNoop: classification === 'SAME_SOURCE_NOOP',
    howlerErrors,
    callbackWaitError,
    playbackWaitError,
    classification,
  };
}

async function runCase(caseConfig) {
  let session = null;
  try {
    session = await launchSession(caseConfig.id, caseConfig.source);
    await prepareCase(session);
    const attempts = [];
    for (const targetId of protocol.musicIds) attempts.push(await clickMusic(session, targetId));
    const eventsClear = Object.entries(session.events).every(([key, value]) => key === 'unexpectedWindowClosed' ? value === false : value.length === 0);
    const ok = attempts.every((attempt) => attempt.actualPlayback)
      && eventsClear;
    return {
      id: caseConfig.id,
      source: caseConfig.source,
      description: caseConfig.description,
      ok,
      userData: session.tempUserData,
      attempts,
      events: session.events,
      lastSnapshot: cloneJson(session.lastSnapshot),
      failureMessage: null,
      failureStack: null,
    };
  } catch (error) {
    return {
      id: caseConfig.id,
      source: caseConfig.source,
      description: caseConfig.description,
      ok: false,
      userData: session?.tempUserData ?? path.join(tempRoot, caseConfig.id, 'user-data'),
      attempts: [],
      events: session?.events ?? emptyEvents(),
      lastSnapshot: cloneJson(session?.lastSnapshot),
      failureMessage: error instanceof Error ? error.message : String(error),
      failureStack: errorText(error),
    };
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        session.events.consoleErrors.push(`close: ${errorText(error)}`);
      }
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

function writeArtifact(cases, status, error = null, runHead = null) {
  const artifact = {
    schemaVersion: 1,
    status,
    head: runHead,
    sourceRoot: gameSourceRoot,
    distRoot: path.resolve(gameDist),
    formalEntryLabel,
    generatedAt: new Date().toISOString(),
    protocol,
    environment: {
      node: process.version,
      electron: (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
        } catch {
          return null;
        }
      })(),
      lockfileSha256: sha256File(path.join(repoRoot, 'package-lock.json')),
    },
    execution: {
      actualSessions: cases.length,
      actualClicks: cases.reduce((sum, item) => sum + item.attempts.length, 0),
    },
    cases,
    eventTotals: aggregateEvents(cases),
    error: error ? errorText(error) : null,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  return artifact;
}

async function main() {
  const runHead = currentGitHead();
  let cases = [];
  try {
    buildFormalGame();
    for (const caseConfig of protocol.cases) cases.push(await runCase(caseConfig));
    const status = cases.length === protocol.cases.length
      && cases.every((item) => item.ok)
      ? 'PASSED'
      : 'FAILED';
    const artifact = writeArtifact(cases, status, null, runHead);
    console.log(JSON.stringify({
      artifact: evidencePath,
      sha256: sha256File(evidencePath),
      status: artifact.status,
      head: artifact.head,
      sessions: artifact.execution.actualSessions,
      clicks: artifact.execution.actualClicks,
      eventTotals: artifact.eventTotals,
      classifications: cases.flatMap((item) => item.attempts.map((attempt) => attempt.classification)),
    }, null, 2));
    if (status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    const artifact = writeArtifact(cases, 'FAILED', error, runHead);
    console.error(errorText(error));
    console.error(JSON.stringify({ artifact: evidencePath, sha256: sha256File(evidencePath), status: artifact.status }, null, 2));
    process.exitCode = 1;
  }
}

await main();
