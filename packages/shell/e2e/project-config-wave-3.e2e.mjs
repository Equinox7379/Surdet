#!/usr/bin/env node

/**
 * Stage 6 Wave 3 — project-level authoring config vertical slice.
 *
 * The runner talks to the built CLI over its JSON contract and to the formal
 * editor preview over the public postMessage protocol. Asset naming, character
 * fingerprints and entryScene semantics come from shared CLI outputs.
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
const fixtureRoot = path.join(desktopRoot, `surdet-stage6-wave3-fixture-${runToken}`);
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-project-config-wave-3-'));
const artifactPath = path.join(artifactDir, 'project-config-wave-3.json');
const agentDataDir = path.join(artifactDir, 'agent-data');
const inputDir = path.join(artifactDir, 'inputs');
const previewPort = 4173;
const preflightPort = 4174;
const evidenceClass = process.argv.includes('--diagnostic') ? 'DIAGNOSTIC' : 'FORMAL';
const starterTrackedFiles = [
  'game.config.json',
  path.join('content', 'scenario', 'ch01_01.gal'),
  path.join('content', 'assets', 'avatar', 'lynn.svg'),
];

const TARGET_SCENE_ID = 'agent_probe';
const TARGET_LABEL = 'start';
const NOVA_ID = 'nova';
const NOVA_NAME = '诺瓦';
const NOVA_LINE = '诺瓦登场台词。';

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
let characters = null;
let entryScene = null;
let speakerProfiles = [];
let dialogueProjection = null;
let advanceMethod = null;

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
  const invocation = [...args, ...(args.includes('--json') ? [] : ['--json'])];
  const result = spawnSync(process.execPath, [cliEntry, ...invocation], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SURDET_AGENT_DATA_DIR: agentDataDir,
      SURDET_GIT_HEAD: runHead ?? 'unknown',
      SURDET_ENGINE_VERSION: 'stage6-wave3',
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

function fingerprint(raw) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await readPreviewMessages(page);
    const hit = messages.slice(startIndex).find((message) => predicate(message) === true);
    if (hit !== undefined) return hit;
    assert(Date.now() < deadline, `waitPreviewMessage 超时：${predicate.toString().slice(0, 120)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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

function speakerProfilesFrom(config) {
  return Object.entries(config.characters ?? {}).flatMap(([id, raw]) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const name = typeof item.name === 'string' ? item.name : '';
    return name ? [{ id, name }] : [];
  });
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
    characters,
    entryScene,
    speakerProfiles,
    dialogueProjection,
    advanceMethod,
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

  const capabilities = success('capabilities.describe', runCli(['capabilities', 'describe']));
  for (const capability of ['character.ensure', 'character.remove', 'project.entry-scene.set']) {
    assert(capabilities.result.capabilities.includes(capability), `capabilities 缺少 ${capability}`);
  }
  const starterAssets = success('project.assets', runCli(['project', 'assets', '--project', starterRoot]));
  const lynnAvatar = starterAssets.result.avatars.find((entry) => entry.key === 'lynn');
  assert(lynnAvatar?.resolved === true, 'Starter lynn avatar 未 resolved');
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
    for (const capability of ['character.ensure', 'character.remove', 'project.entry-scene.set']) {
      assert(capabilities.result.capabilities.includes(capability), `capabilities 缺少 ${capability}`);
    }
  });

  await step('project.inspect.config', async () => {
    const inspect = success('project.inspect', runCli(['project', 'inspect', '--project', fixtureRoot]));
    assert(typeof inspect.result.title === 'string' && inspect.result.title.length > 0, 'project.inspect 缺少 title');
    assert(inspect.result.entryScene === 'ch01_01', `初始 entryScene 不是 ch01_01：${JSON.stringify(inspect.result.entryScene)}`);
    const lynn = inspect.result.characters.find((entry) => entry.id === 'lynn');
    assert(lynn?.name === '凛' && lynn?.avatar === 'lynn', `characters.lynn 结构异常：${JSON.stringify(lynn)}`);
    const assets = success('project.assets', runCli(['project', 'assets', '--project', fixtureRoot]));
    const lynnAvatar = assets.result.avatars.find((entry) => entry.key === 'lynn');
    assert(lynnAvatar?.resolved === true, `lynn avatar 未 resolved：${JSON.stringify(lynnAvatar)}`);
    assert(JSON.stringify(assets.result) === JSON.stringify(inspect.result.assets), 'project.assets 与 project.inspect.assets 逐字段不一致');
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
      operationId: 'stage6-wave3-scene-probe',
      sceneId: TARGET_SCENE_ID,
      blocks: [
        { kind: 'label', name: TARGET_LABEL },
        { kind: 'text', speaker: 'lynn', value: '开场。' },
      ],
    });
    success('scene.create', runCli(['scene', 'create', '--change', changeId, '--input', input]));
    assertTreeUnchanged(fixtureIdentity, 'afterSceneCreate');
  });

  await step('character.ensure.nova', async () => {
    const inspectChar = success('object.inspect', runCli(['object', 'inspect', '--project', fixtureRoot, '--ref', 'character:lynn', '--change', changeId]));
    assert(inspectChar.result.kind === 'character', `object.inspect 未返回 character：${JSON.stringify(inspectChar.result)}`);
    const charFingerprint = inspectChar.result.fingerprint;
    assert(/^[0-9a-f]{64}$/.test(charFingerprint), 'character 指纹不是 SHA-256 hex');
    const input = writeInput('character-nova.json', {
      operationId: 'stage6-wave3-character-nova',
      id: NOVA_ID,
      name: NOVA_NAME,
      avatar: 'lynn',
      expectedFingerprint: charFingerprint,
    });
    const body = success('character.ensure', runCli(['character', 'ensure', '--change', changeId, '--input', input]));
    assert(body.result.objectRef === `character:${NOVA_ID}`, `character.ensure objectRef 异常：${JSON.stringify(body.result)}`);
    assert(body.result.created === true, 'character.ensure 未创建新角色');
    assertTreeUnchanged(fixtureIdentity, 'afterCharacterEnsure');
  });

  await step('scene.patch.nova-line', async () => {
    const anchorRef = `scene:${TARGET_SCENE_ID}/instruction:1@${projectRevision.slice(0, 8)}-${fingerprint('@scene ' + TARGET_SCENE_ID)}`;
    const input = writeInput('scene-patch-nova.json', {
      operationId: 'stage6-wave3-scene-patch-nova',
      sceneId: TARGET_SCENE_ID,
      patch: {
        kind: 'insertAfter',
        anchor: anchorRef,
        expectedFingerprint: fingerprint('@scene ' + TARGET_SCENE_ID),
        blocks: [{ kind: 'text', speaker: NOVA_ID, value: NOVA_LINE }],
      },
    });
    success('scene.patch', runCli(['scene', 'patch', '--change', changeId, '--input', input]));
    assertTreeUnchanged(fixtureIdentity, 'afterScenePatch');
  });

  await step('entry-scene.set.agent_probe', async () => {
    const inspectEntry = success('object.inspect', runCli(['object', 'inspect', '--project', fixtureRoot, '--ref', 'config:entryScene', '--change', changeId]));
    assert(inspectEntry.result.kind === 'entry-scene', `object.inspect 未返回 entry-scene：${JSON.stringify(inspectEntry.result)}`);
    const entryFingerprint = inspectEntry.result.fingerprint;
    assert(/^[0-9a-f]{64}$/.test(entryFingerprint), 'entryScene 指纹不是 SHA-256 hex');
    const input = writeInput('entry-scene.json', {
      operationId: 'stage6-wave3-entry-scene',
      sceneId: TARGET_SCENE_ID,
      expectedFingerprint: entryFingerprint,
    });
    const body = success('project.entry-scene.set', runCli(['project', 'entry-scene', 'set', '--change', changeId, '--input', input]));
    assert(body.result.entryScene === TARGET_SCENE_ID, `entryScene 未设置为 ${TARGET_SCENE_ID}：${JSON.stringify(body.result)}`);
    assertTreeUnchanged(fixtureIdentity, 'afterEntrySceneSet');
  });

  await step('project.validate.green', async () => {
    const body = success('project.validate', runCli(['project', 'validate', '--change', changeId]));
    // 绿灯 = 无 error（placeholder 哲学允许其它场景的 speaker/资源 warning，如 Starter 的 '主角' 台词）。
    assert(body.result.ok === true, `绿灯校验仍有 error：${JSON.stringify(body.result.issues)}`);
    assert(body.result.issues.filter((issue) => issue.severity === 'error').length === 0, '校验含 error');
    // 目标场景 agent_probe 的 nova/lynn 台词 speaker 必须全部解析。
    const targetSpeakerWarnings = body.result.issues.filter((issue) => (
      issue.code === 'SPEAKER_UNRESOLVED' && issue.file.includes(`${TARGET_SCENE_ID}.gal`)
    ));
    assert(targetSpeakerWarnings.length === 0, `目标场景含未解析 speaker：${JSON.stringify(targetSpeakerWarnings)}`);
    assert(body.result.issues.filter((issue) => issue.code === 'ASSET_UNRESOLVED').length === 0, '校验含未解析资源 warning');
    assertTreeUnchanged(fixtureIdentity, 'afterGreenValidation');
  });

  await step('project.simulate.from-agent_probe', async () => {
    const body = success('project.simulate', runCli(['project', 'simulate', '--change', changeId]));
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
    assert(paths.includes('game.config.json'), `diff 缺少 game.config.json：${paths.join(', ')}`);
    assert(paths.includes(`content/scenario/${TARGET_SCENE_ID}.gal`), `diff 缺少目标场景：${paths.join(', ')}`);
    const ledgerKinds = body.result.semantic.map((entry) => entry.kind).filter((kind) => kind.startsWith('config.'));
    assert(ledgerKinds.includes('config.character.ensure'), `diff 缺少 character ledger：${JSON.stringify(ledgerKinds)}`);
    assert(ledgerKinds.includes('config.entry-scene.set'), `diff 缺少 entry-scene ledger：${JSON.stringify(ledgerKinds)}`);
    assertTreeUnchanged(fixtureIdentity, 'afterDiff');
  });

  await step('change.commit', async () => {
    const body = success('change.commit', runCli(['change', 'commit', '--change', changeId]));
    assert(body.result.status === 'COMMITTED', `commit 状态异常：${JSON.stringify(body.result)}`);
    const after = readFixtureTree();
    assert(after.sha256 !== fixtureIdentity.sha256, 'commit 后 fixture 文件树没有变化');
    treeHashes.afterCommit = after.sha256;
  });

  // ---- 正式 editor preview：显式加载 agent_probe/start，投影断言 nova 显示 ----
  const server = await step('editor.preview.server', async () => startPreviewServer());
  const previewUrl = `http://127.0.0.1:${previewPort}/preview.html`;
  const parentUrl = `http://127.0.0.1:${previewPort}/__surdet-stage6-wave3-parent.html`;
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
  speakerProfiles = speakerProfilesFrom(fixtureConfig);
  const novaProfile = speakerProfiles.find((profile) => profile.id === NOVA_ID);
  assert(novaProfile?.name === NOVA_NAME, `speakerProfiles 中 nova 显示名不是 ${NOVA_NAME}：${JSON.stringify(speakerProfiles)}`);
  characters = Object.entries(fixtureConfig.characters ?? {}).map(([id, raw]) => ({ id, ...(raw && typeof raw === 'object' ? raw : {}) }));
  entryScene = fixtureConfig.entryScene ?? null;
  assert(entryScene === TARGET_SCENE_ID, `入口场景不是 Agent 设置的 ${TARGET_SCENE_ID}：${JSON.stringify(entryScene)}`);

  const payload = {
    projectKey: fixtureRoot,
    sceneId: TARGET_SCENE_ID,
    startLabel: TARGET_LABEL,
    scenes: readFixtureScenes(),
    variables: variableDeclarations(fixtureConfig),
    speakerProfiles,
    timelines: readFixtureTimelines(),
    fast: true,
  };
  await page.evaluate((message) => {
    const iframe = document.querySelector('#stage6-preview-frame');
    if (!iframe || !iframe.contentWindow) throw new Error('正式 preview iframe 不可用');
    iframe.contentWindow.postMessage(message, '*');
  }, { type: 'surdet-preview-load', payload });

  await step('editor.preview.trace-start.scene-target', async () => {
    const startMessage = await waitPreviewMessage(page, loadStartIndex, (message) => message?.type === 'surdet-preview-trace-start', 30000);
    targetSceneId = startMessage.sceneId ?? null;
    targetLabel = startMessage.label ?? null;
    assert(targetSceneId === TARGET_SCENE_ID, `preview 实际加载场景不是 ${TARGET_SCENE_ID}：${targetSceneId}`);
    assert(targetLabel === TARGET_LABEL, `preview 实际起始标签不是 ${TARGET_LABEL}：${targetLabel}`);
  });

  await step('editor.preview.advance-to-nova', async () => {
    // 第一句是 lynn 的开场台词（awaiting-advance），推进到 nova 台词。
    await previewFrame.waitForFunction(() => window.surdetPreviewDebug?.rendererStatus === 'awaiting', undefined, { timeout: 30000 });
    // (a) 真实输入优先：真实鼠标点击画布中心获取 iframe 焦点，Space 后有界重试（≤3 次、间隔 200ms），
    //     以投影推进到 nova 台词为停止条件（headless iframe 的 window.focus() 路由不稳定，见台账 4.88）。
    const canvasBox = await previewFrame.locator('canvas').boundingBox();
    assert(canvasBox, '未读到 preview 画布几何');
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await previewFrame.evaluate(() => window.focus());
      await page.keyboard.press('Space');
      await new Promise((resolve) => setTimeout(resolve, 200));
      const dialogText = await previewFrame.evaluate(() => (
        window.surdetPreviewDebug?.runtime?.queries?.diagnostics?.projectionSnapshot?.()?.dialogue?.dialogText ?? null
      ));
      if (dialogText === NOVA_LINE) {
        advanceMethod = 'keyboard';
        break;
      }
    }
    // (b) 确定性兜底：重试后仍未推进时走公开输入入口 dispatchInput。
    if (advanceMethod === null) {
      await previewFrame.evaluate(() => window.surdetPreviewDebug?.runtime?.controller?.dispatchInput?.({ type: 'advance' }));
      advanceMethod = 'dispatch-input';
    }
    assert(advanceMethod === 'keyboard' || advanceMethod === 'dispatch-input', `推进方式未记录：${advanceMethod}`);
  });

  await step('editor.preview.dialogue-projection.nova', async () => {
    // 等待投影台词精确变为 nova 台词（第一句 lynn 开场台词已非空，不能用“非空”作为条件）。
    await previewFrame.waitForFunction((expected) => {
      const projection = window.surdetPreviewDebug?.runtime?.queries?.diagnostics?.projectionSnapshot?.();
      return projection?.dialogue?.dialogText === expected;
    }, NOVA_LINE, { timeout: 30000 });
    const projection = await previewFrame.evaluate(() => window.surdetPreviewDebug?.runtime?.queries?.diagnostics?.projectionSnapshot?.() ?? null);
    assert(projection?.dialogue?.dialogText === NOVA_LINE, `投影台词不是 nova 台词：${JSON.stringify(projection?.dialogue?.dialogText)}`);
    assert(projection?.world?.activeSpeakerId === NOVA_ID, `投影 speaker 不是 nova：${JSON.stringify(projection?.world?.activeSpeakerId)}`);
    dialogueProjection = {
      dialogText: projection?.dialogue?.dialogText ?? null,
      activeSpeakerId: projection?.world?.activeSpeakerId ?? null,
      speakerProfileName: novaProfile?.name ?? null,
    };
  });

  await step('editor.preview.trace-complete', async () => {
    await previewFrame.evaluate(() => window.focus());
    await page.keyboard.press('Space');
    const completeMessage = await waitPreviewMessage(page, loadStartIndex, (message) => message?.type === 'surdet-preview-trace-complete', 30000);
    assert(completeMessage.status === 'passed', `preview trace 未通过：${JSON.stringify(completeMessage)}`);
  });

  await step('editor.preview.error-channels', async () => verifyPreviewErrorChannels());

  await cleanupOwnedResources();
  await verifyResourceCleanup();
  assertStarterUnchanged(starterIdentity);
  fixtureIdentity = readFixtureTree();
  return { server, targetSceneId, targetLabel, speakerProfiles, dialogueProjection };
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
