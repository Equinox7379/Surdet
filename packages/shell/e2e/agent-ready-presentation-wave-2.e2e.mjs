#!/usr/bin/env node

/**
 * Stage 6 Wave 2 — existing-asset presentation authoring vertical slice.
 *
 * The runner talks to the built CLI process over its JSON contract and to the
 * formal editor preview over the public postMessage protocol.  It never imports
 * authoring internals: asset naming, timeline fingerprints and stage semantics
 * come from the shared CLI outputs, not from a second local parser.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as url from 'node:url';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(shellDir, '../..');
const starterRoot = path.join(repoRoot, 'examples', 'starter');
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const editorRoot = path.join(repoRoot, 'packages', 'editor');
const editorDist = path.join(editorRoot, 'dist');
const editorPreviewHtml = path.join(editorDist, 'preview.html');
const desktopRoot = path.join(os.homedir(), 'Desktop');
const runToken = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
const fixtureRoot = path.join(desktopRoot, `surdet-stage6-wave2-fixture-${runToken}`);
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-ready-wave-2-'));
const artifactPath = path.join(artifactDir, 'agent-ready-presentation-wave-2.json');
const agentDataDir = path.join(artifactDir, 'agent-data');
const inputDir = path.join(artifactDir, 'inputs');
const previewPort = 4173;
const preflightPort = 4174;
const evidenceClass = process.argv.includes('--diagnostic') ? 'DIAGNOSTIC' : 'FORMAL';
const starterTrackedFiles = [
  'game.config.json',
  path.join('content', 'scenario', 'ch01_01.gal'),
  path.join('content', 'timelines', 'intro_cinematic.json'),
  path.join('content', 'assets', 'bg', 'night_field.svg'),
  path.join('content', 'assets', 'portrait', 'lynn_uniform_night.svg'),
];

const TARGET_SCENE_ID = 'agent_probe';
const TARGET_LABEL = 'start';
const TARGET_TIMELINE_ID = 'agent_blackout';

fs.mkdirSync(agentDataDir, { recursive: true });
fs.mkdirSync(inputDir, { recursive: true });

let runHead = null;
let previewServer = null;
let previewBrowser = null;
let previewPage = null;
let previewPageClosing = false;
let previewBrowserClosePromise = null;
let fixtureCreated = false;
let lastPassedNode = 'startup';
let firstFailedNode = null;
let projectRevision = null;
let changeId = null;
let workingRevision = 0;
let starterIdentity = null;
let fixtureIdentity = null;
let treeHashes = {};
let targetSceneId = null;
let targetLabel = null;
let stageBefore = null;
let stageAfterFirstFrame = null;
let stageAfterComplete = null;
let fadeSamples = [];
let catalog = null;

const resourceCleanup = {
  browserClosed: false,
  previewChildExitObserved: false,
  previewChildCloseObserved: false,
  previewServerReleased: false,
  previewPortFree: null,
  preflightPortFree: null,
};

const previewErrors = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  unhandledRejections: [],
  rendererErrors: [],
  releaseFailures: [],
  unexpectedWindowClosed: false,
};

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function bytesFile(filePath) {
  return fs.statSync(filePath).size;
}

function currentGitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    env: { ...process.env },
    shell: false,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`无法读取运行 HEAD（exit=${result.status}）`);
  const value = result.stdout.trim();
  assert(/^[0-9a-f]{40}$/i.test(value), `运行 HEAD 非法：${value}`);
  return value;
}

function gitBlob(filePath) {
  const result = spawnSync('git', ['hash-object', filePath], {
    cwd: repoRoot,
    env: { ...process.env },
    shell: false,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`无法读取 Starter Git blob：${filePath}`);
  const value = result.stdout.trim();
  assert(/^[0-9a-f]{40}$/i.test(value), `Starter Git blob 非法：${value}`);
  return value;
}

function starterFileIdentity(relativePath) {
  const absolute = path.join(starterRoot, relativePath);
  return {
    path: relativePath.split(path.sep).join('/'),
    bytes: bytesFile(absolute),
    sha256: sha256File(absolute),
    gitBlob: gitBlob(absolute),
  };
}

function readStarterIdentity() {
  return starterTrackedFiles.map(starterFileIdentity);
}

function assertStarterUnchanged(expected) {
  const actual = readStarterIdentity();
  assert(JSON.stringify(actual) === JSON.stringify(expected), '原始 Starter 内容身份发生变化');
  return actual;
}

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

function fixtureRelative(absolute) {
  return path.relative(fixtureRoot, absolute).split(path.sep).join('/');
}

function walkFiles(root, relative = '', output = []) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(root, entry.name);
    const next = relative.length === 0 ? entry.name : path.join(relative, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, next, output);
    else if (entry.isFile()) output.push(absolute);
    else throw new Error(`fixture 中存在非普通文件：${absolute}`);
  }
  return output;
}

function readFixtureTree() {
  const files = walkFiles(fixtureRoot).map((filePath) => ({
    path: fixtureRelative(filePath),
    bytes: bytesFile(filePath),
    sha256: sha256File(filePath),
  }));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, sha256: sha256Bytes(JSON.stringify(files)) };
}

function assertTreeUnchanged(expected, label) {
  const actual = readFixtureTree();
  assert(actual.sha256 === expected.sha256 && JSON.stringify(actual.files) === JSON.stringify(expected.files), `${label}期间 fixture 文件树发生变化`);
  treeHashes[label] = actual.sha256;
  return actual;
}

/** fixture = Starter 隔离副本（game.config.json + content/**，含 assets/timelines/scenario/config）。 */
function copyStarterFixture() {
  assert(!fs.existsSync(fixtureRoot), `目标桌面 fixture 已存在，拒绝覆盖：${fixtureRoot}`);
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.copyFileSync(path.join(starterRoot, 'game.config.json'), path.join(fixtureRoot, 'game.config.json'), fs.constants.COPYFILE_EXCL);
  fs.cpSync(path.join(starterRoot, 'content'), path.join(fixtureRoot, 'content'), { recursive: true, errorOnExist: true, force: false });
  fixtureCreated = true;
  assert(!fs.existsSync(path.join(fixtureRoot, 'node_modules')), 'fixture 不得包含 node_modules');
  assert(!fs.existsSync(path.join(fixtureRoot, 'dist')), 'fixture 不得包含 dist');
  assert(!fs.existsSync(path.join(fixtureRoot, 'src')), 'fixture 不得包含 src');
  assert(!fs.existsSync(path.join(fixtureRoot, 'test')), 'fixture 不得包含 test');
}

function writeInput(name, value) {
  const filePath = path.join(inputDir, name);
  assert(!fs.existsSync(filePath), `输入文件已存在，拒绝覆盖：${filePath}`);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return filePath;
}

function runCli(args, input = undefined) {
  const invocation = [
    ...args,
    ...(args.includes('--json') ? [] : ['--json']),
  ];
  const result = spawnSync(process.execPath, [cliEntry, ...invocation], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SURDET_AGENT_DATA_DIR: agentDataDir,
      SURDET_GIT_HEAD: runHead ?? 'unknown',
      SURDET_ENGINE_VERSION: 'stage6-wave2',
    },
    shell: false,
    input,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  assert(stdout.trim().length > 0, `CLI stdout 为空：${args.join(' ')}`);
  let body;
  try {
    body = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`CLI stdout 不是单一 JSON：${args.join(' ')}\n${stdout}\n${errorText(error)}`);
  }
  assert(stdout.trim() === JSON.stringify(body), `CLI stdout 存在 JSON 之外的噪声：${args.join(' ')}`);
  return { status: result.status, stdout, stderr, body };
}

function success(label, response) {
  assert(response.status === 0, `${label} exit=${response.status}：${JSON.stringify(response.body)}`);
  assert(response.body?.ok === true, `${label} 未返回 ok=true：${JSON.stringify(response.body)}`);
  assert(response.stderr === '', `${label} 默认 stderr 不为空：${response.stderr}`);
  return response.body;
}

function expectedFailure(label, response, code) {
  assert(response.status === 1, `${label} 应为 exit=1，实际=${response.status}`);
  assert(response.body?.ok === false, `${label} 未返回失败信封：${JSON.stringify(response.body)}`);
  assert(response.body?.error?.code === code, `${label} 错误代码不是 ${code}：${JSON.stringify(response.body)}`);
  assert(response.stderr === '', `${label} 默认 stderr 不为空：${response.stderr}`);
  return response.body;
}

async function step(label, action) {
  try {
    const value = await action();
    lastPassedNode = label;
    return value;
  } catch (error) {
    firstFailedNode ??= label;
    throw new Error(`[${label}] ${errorText(error)}`);
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (free) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(free);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(error?.code === 'ECONNREFUSED'));
    socket.setTimeout(500, () => finish(false));
  });
}

async function assertPortFree(port, label) {
  assert(await portIsFree(port), `${label} 端口 ${port} 已被占用或无法确认空闲，拒绝关闭未知进程`);
}

function createOwnedServerState(child, stdout = '', stderr = '') {
  const state = { child, pid: child.pid ?? null, stdout, stderr, exitObserved: false, closeObserved: false };
  child.once('exit', () => { state.exitObserved = true; });
  child.once('close', () => { state.closeObserved = true; });
  return state;
}

function waitForChildClose(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    const finish = (error = null) => {
      if (timer !== null) clearTimeout(timer);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish();
    const onError = (error) => finish(error);
    child.once('close', onClose);
    child.once('error', onError);
    timer = setTimeout(() => {
      finish(new Error(`owned child pid=${child.pid ?? 'unknown'} 未在 ${timeoutMs}ms 内退出`));
    }, timeoutMs);
  });
}

const viteCli = path.join(editorRoot, 'node_modules', 'vite', 'bin', 'vite.js');

async function startPreviewServer(port = previewPort) {
  const serverUrl = `http://127.0.0.1:${port}/preview.html`;
  await assertPortFree(port, port === previewPort ? '正式 editor preview' : 'preflight preview');
  assert(fs.existsSync(editorPreviewHtml), `找不到 editor preview 入口：${editorPreviewHtml}`);
  assert(fs.existsSync(viteCli), `找不到 editor Vite CLI：${viteCli}`);
  const child = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', `--port=${port}`], {
    cwd: editorRoot,
    env: { ...process.env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  previewServer = createOwnedServerState(child, stdout, stderr);
  const deadline = Date.now() + 30000;
  let pageText = '';
  let status = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(serverUrl);
      status = response.status;
      pageText = await response.text();
      if (status === 200) break;
    } catch {
      // Vite is still starting; continue polling its actual HTTP endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(status === 200, `editor preview 未返回 HTTP 200（status=${status}, exit=${child.exitCode}）\n${stdout}\n${stderr}`);
  assert(/<title>Surdet 预览<\/title>/u.test(pageText), 'editor preview 标题不是“Surdet 预览”');
  return previewServer;
}

async function stopPreviewServer() {
  const server = previewServer;
  if (!server) {
    resourceCleanup.previewServerReleased = true;
    return;
  }
  const child = server.child;
  try {
    if (child.exitCode === null && child.signalCode === null) {
      let killResult = false;
      try {
        killResult = child.kill();
      } catch (error) {
        throw new Error(`请求终止 preview child pid=${server.pid ?? 'unknown'} 失败：${errorText(error)}`);
      }
      if (!killResult && child.exitCode === null && child.signalCode === null) {
        throw new Error(`请求终止 preview child pid=${server.pid ?? 'unknown'} 未生效`);
      }
      await waitForChildClose(child, 5000);
    }
    resourceCleanup.previewChildExitObserved = server.exitObserved || child.exitCode !== null || child.signalCode !== null;
    resourceCleanup.previewChildCloseObserved = server.closeObserved;
    assert(resourceCleanup.previewChildExitObserved, `preview child pid=${server.pid ?? 'unknown'} 未观察到 exit`);
    assert(resourceCleanup.previewChildCloseObserved, `preview child pid=${server.pid ?? 'unknown'} 未观察到 close`);
  } catch (error) {
    throw new Error(`PREVIEW_CLEANUP_FAILED pid=${server.pid ?? 'unknown'}：${errorText(error)}`);
  } finally {
    if (previewServer === server) {
      previewServer = null;
      resourceCleanup.previewServerReleased = true;
    }
  }
}

async function closePreviewBrowser() {
  const browser = previewBrowser;
  if (!browser) return;
  previewPageClosing = true;
  previewBrowserClosePromise ??= browser.close();
  try {
    await previewBrowserClosePromise;
    resourceCleanup.browserClosed = !browser.isConnected();
  } finally {
    if (previewBrowser === browser) previewBrowser = null;
    previewPage = null;
    previewBrowserClosePromise = null;
  }
}

async function cleanupOwnedResources() {
  const failures = [];
  try { await closePreviewBrowser(); } catch (error) { failures.push(error); }
  try { await stopPreviewServer(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new Error(failures.map(errorText).join('\n'));
}

async function verifyResourceCleanup() {
  resourceCleanup.previewPortFree = await portIsFree(previewPort);
  resourceCleanup.preflightPortFree = await portIsFree(preflightPort);
  assert(resourceCleanup.browserClosed, '资源清理后 Playwright browser 仍未确认断开');
  assert(resourceCleanup.previewServerReleased, '资源清理后 preview server 未释放');
  assert(resourceCleanup.previewPortFree, `资源清理后 preview 端口 ${previewPort} 仍被占用`);
  assert(resourceCleanup.preflightPortFree, `资源清理后 preflight 端口 ${preflightPort} 仍被占用`);
  assert(resourceCleanup.previewChildExitObserved, '资源清理后 preview child 未确认 exit');
  assert(resourceCleanup.previewChildCloseObserved, '资源清理后 preview child 未确认 close');
}

async function readPreviewMessages(page) {
  return page.evaluate(() => window.__surdetStage6Messages ?? []);
}

async function waitPreviewMessage(page, startIndex, predicate, timeoutMs = 30000) {
  const handle = await page.waitForFunction(({ start, check }) => {
    const messages = window.__surdetStage6Messages ?? [];
    const hit = messages.slice(start).find((message) => check(message) === true);
    return hit ?? null;
  }, { start: startIndex, check: predicate.toString() }, { timeout: timeoutMs });
  const value = await handle.jsonValue();
  if (!value) throw new Error('waitForFunction 未命中预期消息');
  return value;
}

async function waitForFormalPreviewFrame(page, timeoutMs = 30000) {
  const iframe = await page.waitForSelector('#stage6-preview-frame', { state: 'attached', timeout: timeoutMs });
  await page.waitForFunction(
    () => Boolean(document.querySelector('#stage6-preview-frame')?.contentWindow),
    undefined,
    { timeout: timeoutMs },
  );
  const previewFrame = await iframe.contentFrame();
  assert(previewFrame, '正式 preview iframe contentFrame 不可用');
  await previewFrame.waitForURL((value) => {
    try {
      return new URL(value).pathname === '/preview.html';
    } catch {
      return false;
    }
  }, { timeout: timeoutMs });
  await previewFrame.waitForSelector('canvas', { state: 'attached', timeout: timeoutMs });
  await page.waitForFunction(
    () => (window.__surdetStage6Messages ?? []).some((message) => message?.type === 'surdet-preview-ready'),
    undefined,
    { timeout: timeoutMs },
  );
  return previewFrame;
}

function parentHtmlFor(previewUrl) {
  return `<!doctype html><html><body style="margin:0;background:#0d0f16"><script>window.__surdetStage6Messages=[];window.addEventListener('message',(event)=>window.__surdetStage6Messages.push(event.data));<\/script><iframe id="stage6-preview-frame" src="${previewUrl}" style="width:1280px;height:720px;border:0"><\/iframe><\/body><\/html>`;
}

function bindErrorChannels(page) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.startsWith('[e2e-unhandledrejection]')) previewErrors.unhandledRejections.push(text);
    else if (/renderer resource release failed/i.test(text)) previewErrors.releaseFailures.push(text);
    else if (/renderer error/i.test(text)) previewErrors.rendererErrors.push(text);
    else previewErrors.consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    const text = errorText(error);
    if (/renderer resource release failed/i.test(text)) previewErrors.releaseFailures.push(text);
    else if (/renderer error/i.test(text)) previewErrors.rendererErrors.push(text);
    else previewErrors.pageErrors.push(text);
  });
  page.on('requestfailed', (request) => {
    previewErrors.requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('close', () => {
    if (!previewPageClosing) previewErrors.unexpectedWindowClosed = true;
  });
}

function verifyPreviewErrorChannels() {
  for (const [key, values] of Object.entries(previewErrors)) {
    if (key === 'unexpectedWindowClosed') continue;
    assert(values.length === 0, `${key} 非空：${JSON.stringify(values)}`);
  }
  assert(previewErrors.unexpectedWindowClosed === false, '正式 preview 窗口意外关闭');
}

const MIME_BY_FORMAT = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** 用 CLI 共享 catalog（不复制命名解析）构造 preview 资产载荷；二进制以 base64 进 evaluate，浏览器侧重建 ArrayBuffer。 */
function buildPreviewAssets(catalogResult) {
  const backgrounds = [];
  const portraits = [];
  for (const entry of catalogResult.backgrounds) {
    const buffer = fs.readFileSync(path.join(fixtureRoot, entry.sourcePath));
    backgrounds.push({ key: entry.key, mime: MIME_BY_FORMAT[entry.format] ?? 'application/octet-stream', b64: buffer.toString('base64') });
  }
  for (const entry of catalogResult.portraits) {
    const buffer = fs.readFileSync(path.join(fixtureRoot, entry.sourcePath));
    portraits.push({
      charId: entry.role,
      costume: entry.outfit,
      expression: entry.expression,
      mime: MIME_BY_FORMAT[entry.format] ?? 'application/octet-stream',
      b64: buffer.toString('base64'),
    });
  }
  return { backgrounds, portraits };
}

function readFixtureScenes() {
  const scenarioDir = path.join(fixtureRoot, 'content', 'scenario');
  const scenes = [];
  for (const file of fs.readdirSync(scenarioDir).sort()) {
    if (!file.endsWith('.gal')) continue;
    const id = file.slice(0, -'.gal'.length);
    scenes.push({ id, text: fs.readFileSync(path.join(scenarioDir, file), 'utf8') });
  }
  return scenes;
}

function readFixtureTimelines() {
  const timelineDir = path.join(fixtureRoot, 'content', 'timelines');
  if (!fs.existsSync(timelineDir)) return [];
  const timelines = [];
  for (const file of fs.readdirSync(timelineDir).sort()) {
    if (!file.endsWith('.json')) continue;
    timelines.push(JSON.parse(fs.readFileSync(path.join(timelineDir, file), 'utf8')));
  }
  return timelines;
}

function variableDeclarations(config) {
  return Object.entries(config.variables ?? {})
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([name, value]) => ({ name, ...value }));
}

const agentBlackoutDefinition = {
  version: 1,
  id: TARGET_TIMELINE_ID,
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
    { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'night', position: 'left' }] },
    {
      kind: 'screen',
      cues: [
        { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
        { atMs: 50, durationMs: 700, easing: 'inOutSine', action: 'fade', alpha: 0 },
      ],
    },
  ],
};

const agentProbeBlocks = [
  { kind: 'label', name: TARGET_LABEL },
  { kind: 'instruction', name: 'timeline', args: [TARGET_TIMELINE_ID], modifiers: { blocking: '' } },
];

function assertCleanStage(stage, label) {
  assert(stage && typeof stage === 'object', `${label} stage 快照缺失`);
  const portraitKeys = (stage.portraits ?? []).map((portrait) => portrait?.key);
  assert(!portraitKeys.includes('lynn:uniform'), `${label} stage.portraits 意外包含 lynn:uniform：${JSON.stringify(stage.portraits)}`);
  assert(stage.backgroundKey !== 'night_field', `${label} stage.backgroundKey 已经是 night_field：${JSON.stringify(stage.backgroundKey)}`);
  assert(stage.fadeAlpha === 0, `${label} stage.fadeAlpha 不是 0：${JSON.stringify(stage.fadeAlpha)}`);
}

function assertFinalStage(stage) {
  assert(stage && typeof stage === 'object', '播放完成后 stage 快照缺失');
  assert(stage.backgroundKey === 'night_field', `最终 backgroundKey 不是 night_field：${JSON.stringify(stage.backgroundKey)}`);
  const lynn = (stage.portraits ?? []).find((portrait) => portrait?.key === 'lynn:uniform');
  assert(lynn, `最终 stage.portraits 不含 lynn:uniform：${JSON.stringify(stage.portraits)}`);
  assert(lynn.view?.expression === 'night', `lynn 表情不是 night：${JSON.stringify(lynn.view)}`);
  assert(Math.abs((stage.fadeAlpha ?? 1) - 0) < 0.001, `播放完成后 fadeAlpha 未回到 0：${JSON.stringify(stage.fadeAlpha)}`);
}

function artifactPayload(status, error = null) {
  let currentStarter = null;
  try {
    currentStarter = readStarterIdentity();
  } catch {
    currentStarter = null;
  }
  const originalStarter = {
    unchanged: starterIdentity !== null && currentStarter !== null && JSON.stringify(currentStarter) === JSON.stringify(starterIdentity),
    files: starterIdentity ?? [],
  };
  return {
    schemaVersion: 1,
    evidenceClass,
    status,
    runHead,
    projectRevision,
    changeId,
    workingRevision,
    targetSceneId,
    targetLabel,
    catalog,
    stageBefore,
    stageAfterFirstFrame,
    stageAfterComplete,
    fadeSamples,
    originalStarter,
    fixture: fixtureIdentity ? { path: fixtureRoot, ...fixtureIdentity } : { path: fixtureRoot },
    treeHashes,
    resourceCleanup: { ...resourceCleanup },
    errors: error === null ? [] : [errorText(error)],
    errorChannels: previewErrors,
    lastPassedNode,
    firstFailedNode,
  };
}

function writeArtifactOnce(status, error = null) {
  assert(!fs.existsSync(artifactPath), `artifact 已存在，拒绝覆盖：${artifactPath}`);
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifactPayload(status, error), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const bytes = bytesFile(artifactPath);
  const sha256 = sha256File(artifactPath);
  return { path: artifactPath, bytes, sha256, status };
}

async function runPreflight() {
  runHead = currentGitHead();
  const checks = {};
  checks.cliDist = fs.existsSync(cliEntry);
  assert(checks.cliDist, `找不到 CLI dist 入口：${cliEntry}`);
  checks.editorPreviewHtml = fs.existsSync(editorPreviewHtml);
  assert(checks.editorPreviewHtml, `找不到 editor preview 入口：${editorPreviewHtml}`);
  checks.viteCli = fs.existsSync(viteCli);
  assert(checks.viteCli, `找不到 editor Vite CLI：${viteCli}`);
  await assertPortFree(previewPort, 'preflight 正式端口');
  await assertPortFree(preflightPort, 'preflight 自检端口');
  assert(!fs.existsSync(fixtureRoot), `preflight 目标 fixture 已存在：${fixtureRoot}`);
  assert(!fs.existsSync(artifactPath), `preflight artifact 已存在：${artifactPath}`);

  // 与正式路径同 launcher/cwd/dist/入口：preflight 端口启动正式 Vite preview 并等待真实 preview.html 就绪。
  const preflightPreviewUrl = `http://127.0.0.1:${preflightPort}/preview.html`;
  const preflightParentUrl = `http://127.0.0.1:${preflightPort}/__surdet-preflight-parent.html`;
  const server = await startPreviewServer(preflightPort);
  previewBrowser = await chromium.launch({ headless: true });
  const page = await previewBrowser.newPage({ viewport: { width: 1280, height: 720 } });
  previewPage = page;
  previewPageClosing = false;
  await page.route(preflightParentUrl, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: parentHtmlFor(preflightPreviewUrl) });
  });
  await page.goto(preflightParentUrl, { waitUntil: 'domcontentloaded' });
  const frame = await waitForFormalPreviewFrame(page, 15000);
  checks.framePathname = new URL(frame.url()).pathname;
  assert(checks.framePathname === '/preview.html', `preflight frame pathname 错误：${checks.framePathname}`);
  await cleanupOwnedResources();
  await verifyResourceCleanup();

  // CLI 只读合同：能力注册与 Starter 只读 catalog（不创建 fixture/artifact）。
  const capabilities = success('capabilities.describe', runCli(['capabilities', 'describe']));
  for (const capability of ['timeline.create', 'timeline.patch', 'project.assets']) {
    assert(capabilities.result.capabilities.includes(capability), `capabilities 缺少 ${capability}`);
  }
  const starterAssets = success('project.assets', runCli(['project', 'assets', '--project', starterRoot]));
  const nightField = starterAssets.result.backgrounds.find((entry) => entry.key === 'night_field');
  const lynnNight = starterAssets.result.portraits.find((entry) => entry.role === 'lynn' && entry.expression === 'night');
  assert(nightField?.resolved === true, 'Starter night_field 未 resolved');
  assert(lynnNight?.resolved === true, 'Starter lynn night 未 resolved');
  assert(!fs.existsSync(fixtureRoot), 'preflight 不得创建 fixture');
  assert(!fs.existsSync(artifactPath), 'preflight 不得创建 artifact');
  return { status: 'PREFLIGHT_PASSED', runHead, checks };
}

async function run() {
  starterIdentity = readStarterIdentity();
  runHead = currentGitHead();
  assert(fs.existsSync(desktopRoot), `桌面目录不存在：${desktopRoot}`);
  assert(!fs.existsSync(fixtureRoot), `目标桌面 fixture 已存在，拒绝删除或覆盖：${fixtureRoot}`);
  assert(!fs.existsSync(artifactPath), `artifact 路径已存在，拒绝覆盖：${artifactPath}`);
  lastPassedNode = 'startup.identity';

  await step('fixture.create', async () => {
    copyStarterFixture();
    assertStarterUnchanged(starterIdentity);
    fixtureIdentity = readFixtureTree();
    treeHashes.beforeBegin = fixtureIdentity.sha256;
  });

  await step('capabilities.describe', async () => {
    const capabilities = success('capabilities.describe', runCli(['capabilities', 'describe']));
    for (const capability of ['timeline.create', 'timeline.patch', 'project.assets']) {
      assert(capabilities.result.capabilities.includes(capability), `capabilities 缺少 ${capability}`);
    }
  });

  await step('project.assets.catalog', async () => {
    const assets = success('project.assets', runCli(['project', 'assets', '--project', fixtureRoot]));
    const inspect = success('project.inspect', runCli(['project', 'inspect', '--project', fixtureRoot]));
    // 资源门槛：FORMAL 使用的背景与立绘必须 resolved；CLI 内部两个入口逐字段一致。
    const nightField = assets.result.backgrounds.find((entry) => entry.key === 'night_field');
    const lynnNight = assets.result.portraits.find((entry) => entry.role === 'lynn' && entry.outfit === 'uniform' && entry.expression === 'night');
    assert(nightField?.resolved === true, `night_field 未 resolved：${JSON.stringify(nightField)}`);
    assert(lynnNight?.resolved === true, `lynn_uniform_night 未 resolved：${JSON.stringify(lynnNight)}`);
    assert(JSON.stringify(assets.result) === JSON.stringify(inspect.result.assets), 'project.assets 与 project.inspect.assets 逐字段不一致');
    catalog = assets.result;
  });

  const begun = await step('change.begin', async () => {
    const body = success('change.begin', runCli(['change', 'begin', '--project', fixtureRoot]));
    changeId = body.changeId;
    projectRevision = body.projectRevision;
    workingRevision = body.workingRevision;
    assert(/^chg_/.test(changeId), `changeId 非法：${changeId}`);
    assert(workingRevision === 0, `初始 workingRevision 不是 0：${workingRevision}`);
    assertTreeUnchanged(fixtureIdentity, 'afterBegin');
    return body;
  });

  await step('scene.create.agent_probe', async () => {
    const input = writeInput('scene-probe.json', {
      operationId: 'stage6-wave2-scene-probe',
      sceneId: TARGET_SCENE_ID,
      blocks: agentProbeBlocks,
    });
    success('scene.create', runCli(['scene', 'create', '--change', changeId, '--input', input]));
    assertTreeUnchanged(fixtureIdentity, 'afterSceneCreate');
  });

  await step('timeline.create.agent_blackout', async () => {
    const input = writeInput('timeline-create.json', {
      operationId: 'stage6-wave2-timeline-create',
      timelineId: TARGET_TIMELINE_ID,
      definition: agentBlackoutDefinition,
    });
    const body = success('timeline.create', runCli(['timeline', 'create', '--change', changeId, '--input', input]));
    assert(body.result.objectRef === `timeline:${TARGET_TIMELINE_ID}`, `timeline.create objectRef 异常：${JSON.stringify(body.result)}`);
    assert(body.result.path === `content/timelines/${TARGET_TIMELINE_ID}.json`, 'timeline.create 路径异常');
    assert(/^[0-9a-f]{64}$/.test(body.result.fingerprint), 'timeline.create 指纹不是 SHA-256 hex');
    assertTreeUnchanged(fixtureIdentity, 'afterTimelineCreate');
  });

  await step('object.inspect.timeline', async () => {
    const body = success('object.inspect', runCli(['object', 'inspect', '--project', fixtureRoot, '--ref', `timeline:${TARGET_TIMELINE_ID}`, '--change', changeId]));
    assert(body.result.kind === 'timeline', `object.inspect 未返回 timeline：${JSON.stringify(body.result)}`);
    assert(/^[0-9a-f]{64}$/.test(body.result.fingerprint), 'object.inspect timeline fingerprint 缺失');
    assert(body.result.references.includes('asset:bg:night_field'), 'timeline 未引用 night_field 资产');
    assert(body.result.references.includes('asset:portrait:lynn:uniform:night'), 'timeline 未引用 lynn night 资产');
  });

  await step('project.validate.green', async () => {
    const body = success('project.validate', runCli(['project', 'validate', '--change', changeId]));
    assert(body.result.ok === true, `绿灯校验仍有 error：${JSON.stringify(body.result.issues)}`);
    assert(body.result.issues.filter((issue) => issue.severity === 'error').length === 0, '校验含 error');
    assert(body.result.issues.filter((issue) => issue.code === 'ASSET_UNRESOLVED').length === 0, '校验含未解析资源 warning');
    assertTreeUnchanged(fixtureIdentity, 'afterGreenValidation');
  });

  await step('project.simulate.agent_probe', async () => {
    const input = writeInput('simulate.json', { sceneId: TARGET_SCENE_ID });
    const body = success('project.simulate', runCli(['project', 'simulate', '--change', changeId, '--input', input]));
    assert(body.result.entryScene === TARGET_SCENE_ID, `模拟 entryScene 不是 ${TARGET_SCENE_ID}：${JSON.stringify(body.result.entryScene)}`);
    assert(body.result.status === 'passed', `模拟状态不是 passed：${JSON.stringify(body.result)}`);
    assert(body.result.runtimeErrors.length === 0, `模拟含运行时错误：${JSON.stringify(body.result.runtimeErrors)}`);
  });

  await step('runtime.run-from.agent_probe.start', async () => {
    const input = writeInput('run-from.json', { sceneId: TARGET_SCENE_ID, label: TARGET_LABEL });
    const body = success('runtime.run-from', runCli(['runtime', 'run-from', '--change', changeId, '--input', input]));
    assert(body.result.sceneId === TARGET_SCENE_ID, `run-from sceneId 不是 ${TARGET_SCENE_ID}`);
    assert(body.result.status === 'passed', 'run-from 未通过');
  });

  await step('change.diff', async () => {
    const body = success('change.diff', runCli(['change', 'diff', '--change', changeId]));
    const paths = body.result.files.map((file) => file.path).sort();
    assert(paths.includes(`content/scenario/${TARGET_SCENE_ID}.gal`), `diff 缺少 agent_probe：${paths.join(', ')}`);
    assert(paths.includes(`content/timelines/${TARGET_TIMELINE_ID}.json`), `diff 缺少 timeline：${paths.join(', ')}`);
    const ledgerKinds = body.result.semantic.map((entry) => entry.kind).filter((kind) => kind.startsWith('timeline.'));
    assert(ledgerKinds.includes('timeline.create'), `diff 缺少 ledger timeline.create：${JSON.stringify(ledgerKinds)}`);
    assertTreeUnchanged(fixtureIdentity, 'afterDiff');
  });

  await step('change.commit', async () => {
    const body = success('change.commit', runCli(['change', 'commit', '--change', changeId]));
    assert(body.result.status === 'COMMITTED', `commit 状态异常：${JSON.stringify(body.result)}`);
    const after = readFixtureTree();
    assert(after.sha256 !== fixtureIdentity.sha256, 'commit 后 fixture 文件树没有变化');
    treeHashes.afterCommit = after.sha256;
  });

  // ---- 正式 editor preview：显式加载 agent_probe/start，帧采样 fade 轨迹 ----
  const server = await step('editor.preview.server', async () => startPreviewServer());
  const previewUrl = `http://127.0.0.1:${previewPort}/preview.html`;
  const parentUrl = `http://127.0.0.1:${previewPort}/__surdet-stage6-wave2-parent.html`;
  previewBrowser = await chromium.launch({ headless: true });
  const page = await previewBrowser.newPage({ viewport: { width: 1280, height: 720 } });
  previewPage = page;
  previewPageClosing = false;
  bindErrorChannels(page);
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      console.error(`[e2e-unhandledrejection] ${reason}`);
    });
  });
  await page.route(parentUrl, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: parentHtmlFor(previewUrl) });
  });
  await page.goto(parentUrl, { waitUntil: 'domcontentloaded' });
  const previewFrame = await step('editor.preview.frame', async () => waitForFormalPreviewFrame(page));

  const loadStartIndex = await page.evaluate(() => (window.__surdetStage6Messages ?? []).length);
  const fixtureConfig = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'game.config.json'), 'utf8'));
  const previewAssets = buildPreviewAssets(catalog);
  const payload = {
    projectKey: fixtureRoot,
    sceneId: TARGET_SCENE_ID,
    startLabel: TARGET_LABEL,
    scenes: readFixtureScenes(),
    variables: variableDeclarations(fixtureConfig),
    speakerProfiles: Object.entries(fixtureConfig.characters ?? {}).flatMap(([id, raw]) => {
      const item = raw && typeof raw === 'object' ? raw : {};
      const name = typeof item.name === 'string' ? item.name : '';
      return name ? [{ id, name }] : [];
    }),
    timelines: readFixtureTimelines(),
    fast: true,
  };
  await page.evaluate(({ base, backgrounds, portraits }) => {
    const decode = (image) => {
      const binary = atob(image.b64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return { buffer: bytes.buffer, mime: image.mime };
    };
    const decodedBackgrounds = backgrounds.map((asset) => ({ key: asset.key, image: decode(asset) }));
    const decodedPortraits = portraits.map((asset) => ({
      charId: asset.charId,
      costume: asset.costume,
      expression: asset.expression,
      image: decode(asset),
    }));
    const payload = {
      ...base,
      assets: { backgrounds: decodedBackgrounds, portraits: decodedPortraits, avatars: [], audio: [] },
    };
    const iframe = document.querySelector('#stage6-preview-frame');
    if (!iframe || !iframe.contentWindow) throw new Error('正式 preview iframe 不可用');
    const transfer = [
      ...decodedBackgrounds.map((asset) => asset.image.buffer),
      ...decodedPortraits.map((asset) => asset.image.buffer),
    ];
    iframe.contentWindow.postMessage({ type: 'surdet-preview-load', payload }, '*', transfer);
  }, { base: payload, backgrounds: previewAssets.backgrounds, portraits: previewAssets.portraits });

  await step('editor.preview.trace-start.scene-target', async () => {
    const startMessage = await waitPreviewMessage(page, loadStartIndex, (message) => message?.type === 'surdet-preview-trace-start', 30000);
    targetSceneId = startMessage.sceneId ?? null;
    targetLabel = startMessage.label ?? null;
    assert(targetSceneId === TARGET_SCENE_ID, `preview 实际加载场景不是 ${TARGET_SCENE_ID}：${targetSceneId}`);
    assert(targetLabel === TARGET_LABEL, `preview 实际起始标签不是 ${TARGET_LABEL}：${targetLabel}`);
  });

  await step('editor.preview.timeline-event.clean-baseline', async () => {
    const timelineMessage = await waitPreviewMessage(page, loadStartIndex, (message) => (
      message?.type === 'surdet-preview-trace-event' && message?.event?.source?.op === 'timeline'
    ), 30000);
    const before = timelineMessage.presentationBefore;
    const after = timelineMessage.presentationAfter;
    assert(before && typeof before === 'object' && before.stage, 'timeline 事件缺少 presentationBefore.stage');
    assertCleanStage(before.stage, '触发 agent_blackout 前');
    stageBefore = before.stage;
    stageAfterFirstFrame = after && typeof after === 'object' && after.stage ? after.stage : null;
    assert(stageAfterFirstFrame?.backgroundKey === 'night_field', `第一帧后 backgroundKey 不是 night_field：${JSON.stringify(stageAfterFirstFrame)}`);
  });

  await step('editor.preview.fade.frame-sampling', async () => {
    // 帧采样：rAF 回调以每帧粒度收集 stage.fadeAlpha（覆盖 cue2 的 700ms 淡出窗口），禁止单次固定 sleep。
    await previewFrame.evaluate(() => {
      window.__surdetWave2Samples = [];
      let frames = 0;
      const collect = () => {
        const snapshot = window.surdetPreviewDebug?.presentationSnapshot;
        const stage = snapshot && typeof snapshot === 'object' ? snapshot.stage : null;
        if (stage && typeof stage === 'object') {
          window.__surdetWave2Samples.push({
            t: performance.now(),
            fadeAlpha: stage.fadeAlpha,
            backgroundKey: stage.backgroundKey,
            portraitKeys: (stage.portraits ?? []).map((portrait) => portrait?.key),
          });
        }
        frames += 1;
        if (frames < 120) requestAnimationFrame(collect);
      };
      requestAnimationFrame(collect);
    });
    const completeMessage = await waitPreviewMessage(page, loadStartIndex, (message) => (
      message?.type === 'surdet-preview-trace-complete'
    ), 30000);
    assert(completeMessage.status === 'passed', `preview trace 未通过：${JSON.stringify(completeMessage)}`);
    await previewFrame.waitForFunction(() => (window.__surdetWave2Samples ?? []).length > 0, undefined, { timeout: 10000 });
    const samples = await previewFrame.evaluate(() => window.__surdetWave2Samples ?? []);
    fadeSamples = samples.map((sample) => ({ t: Math.round(sample.t), fadeAlpha: sample.fadeAlpha, backgroundKey: sample.backgroundKey, portraitKeys: sample.portraitKeys }));
    assert(fadeSamples.length > 0, 'fade 帧采样为空');
    const alphas = fadeSamples.map((sample) => Number(sample.fadeAlpha));
    const maxAlpha = Math.max(...alphas);
    assert(Math.abs(maxAlpha - 1) < 0.001, `fade 未达到 1（max=${maxAlpha}）`);
    assert(alphas.some((alpha) => alpha > 0 && alpha < 1), 'fade 轨迹没有 0 与 1 之间的中间值');
  });

  await step('editor.preview.final-stage', async () => {
    const stage = await previewFrame.evaluate(() => window.surdetPreviewDebug?.presentationSnapshot?.stage ?? null);
    assertFinalStage(stage);
    stageAfterComplete = stage;
    const last = fadeSamples[fadeSamples.length - 1];
    assert(last && Math.abs(Number(last.fadeAlpha) - 0) < 0.001, `播放完成后 fadeAlpha 未回到 0（last=${JSON.stringify(last)}）`);
  });

  await step('editor.preview.error-channels', async () => verifyPreviewErrorChannels());

  await cleanupOwnedResources();
  await verifyResourceCleanup();
  assertStarterUnchanged(starterIdentity);
  fixtureIdentity = readFixtureTree();
  return { server, targetSceneId, targetLabel, fadeSamples };
}

async function main() {
  if (process.argv.includes('--preflight')) {
    const result = await runPreflight();
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  try {
    await run();
    const artifact = writeArtifactOnce('PASSED');
    console.log(JSON.stringify({ ...artifact, fixturePath: fixtureRoot, previewUrl: `http://127.0.0.1:${previewPort}/preview.html` }, null, 2));
    return 0;
  } catch (error) {
    if (firstFailedNode === null) firstFailedNode = 'startup';
    let cleanupError = null;
    try {
      await cleanupOwnedResources();
      await verifyResourceCleanup();
    } catch (errorDuringCleanup) {
      cleanupError = errorDuringCleanup;
    }
    const finalError = cleanupError === null ? error : new Error(`${errorText(error)}\n${errorText(cleanupError)}`);
    let artifact;
    try {
      artifact = writeArtifactOnce('FAILED', finalError);
    } catch (artifactError) {
      console.error(`无法写入唯一失败 artifact：${errorText(artifactError)}`);
    }
    console.error(JSON.stringify({
      status: 'FAILED',
      artifact,
      fixturePath: fixtureRoot,
      error: errorText(finalError),
      lastPassedNode,
      firstFailedNode,
    }, null, 2));
    return 1;
  }
}

main().then((code) => { process.exitCode = code; });
