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

  return {
    caseId,
    caseRoot,
    userData,
    app,
    page,
    events,
    async snapshot() {
      if (page.isClosed()) return null;
      return page.evaluate(() => {
        const debug = window.__surdetDebug;
        return {
          title: document.title,
          status: debug?.status ?? null,
          position: debug?.position ?? null,
          uiSession: debug?.uiSession ?? null,
          activeOverlay: debug?.activeOverlay ?? null,
          dialogueProjection: debug?.dialogueProjection ?? null,
          commandRailVisible: debug?.dialogueProjection?.commandRailVisible ?? null,
          galleryProjection: debug?.galleryProjection ?? null,
          resources: debug?.resourceSnapshot ?? null,
          lastRendererError: debug?.lastRendererError ?? null,
          assetLoading: debug?.assetLoading ?? null,
          interactionTargets: debug?.interactionTargets ?? null,
        };
      });
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
    async waitForStableCanvas(label) {
      const first = await this.captureCanvas(`${label}-1`);
      const second = await this.captureCanvas(`${label}-2`);
      if (first.pixelHash !== second.pixelHash) {
        throw new Error(`画布在点击前未稳定：${label}（${first.pixelHash} != ${second.pixelHash}）`);
      }
      return second;
    },
    screenshots,
    async close() {
      closing = true;
      await app.close();
    },
  };
}

async function runSmokeCase() {
  let session;
  try {
    session = await launchSession('smoke');
    await session.waitTitle();
    return {
      id: 'A',
      ok: true,
      userData: session.userData,
      events: cloneJson(session.events),
      screenshots: cloneJson(session.screenshots),
      assertions: { smoke: true, formalGame: true, distRoot: path.resolve(gameDist) },
    };
  } catch (error) {
    return {
      id: 'A',
      ok: false,
      userData: session?.userData ?? path.join(tempRoot, 'smoke', 'user-data'),
      events: cloneJson(session?.events ?? emptyEvents()),
      screenshots: cloneJson(session?.screenshots ?? []),
      assertions: { smoke: true, formalGame: true, distRoot: path.resolve(gameDist) },
      error: errorText(error),
      errorStack: error instanceof Error ? error.stack ?? null : null,
    };
  } finally {
    if (session) await session.close();
  }
}

async function runCase(caseId) {
  let session;
  const assertions = {
    source: 'title',
    path: ['title:gallery', 'gallery:music', 'gallery:text', 'gallery:cg', 'gallery:close'],
  };
  try {
    session = await launchSession(caseId);
    if (caseId !== 'A') {
      throw new Error(`Wave 4 case ${caseId} 尚未实现；当前仅执行 Task 1 Case A。`);
    }
    await session.waitTitle();
    await session.clickLogical(640, 478, 'title-gallery-visible-text');
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
    return {
      id: caseId,
      ok: true,
      userData: session.userData,
      assertions: { ...assertions, returnBase: finalSnapshot.uiSession.base },
      events: cloneJson(session.events),
      screenshots: cloneJson(session.screenshots),
    };
  } catch (error) {
    return {
      id: caseId,
      ok: false,
      userData: session?.userData ?? path.join(tempRoot, caseId, 'user-data'),
      assertions,
      events: cloneJson(session?.events ?? emptyEvents()),
      screenshots: cloneJson(session?.screenshots ?? []),
      error: errorText(error),
      errorStack: error instanceof Error ? error.stack ?? null : null,
    };
  } finally {
    if (session) await session.close();
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
