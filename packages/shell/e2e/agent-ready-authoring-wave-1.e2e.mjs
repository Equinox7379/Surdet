#!/usr/bin/env node

/**
 * Stage 6 Wave 1 — one aggregate external-authoring vertical slice.
 *
 * The runner deliberately talks to the built CLI process over its JSON
 * contract.  It does not import authoring internals and it never writes the
 * fixture during an open change; only change.commit may alter the fixture.
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
const editorDist = path.join(repoRoot, 'packages', 'editor', 'dist');
const desktopRoot = path.join(os.homedir(), 'Desktop');
const runToken = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
const fixtureRoot = path.join(desktopRoot, `surdet-stage6-agent-fixture-${runToken}`);
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-ready-wave-1-'));
const artifactPath = path.join(artifactDir, 'agent-ready-authoring-wave-1.json');
const agentDataDir = path.join(artifactDir, 'agent-data');
const inputDir = path.join(artifactDir, 'inputs');
const previewUrl = 'http://127.0.0.1:4173/preview.html';
const parentUrl = 'http://127.0.0.1:4173/__surdet-stage6-parent.html';
const previewPort = 4173;
const harnessSelfCheckPort = 4174;
const harnessSelfCheckParentUrl = `http://127.0.0.1:${harnessSelfCheckPort}/__surdet-harness-self-check-parent.html`;
const viteCli = path.join(repoRoot, 'packages', 'editor', 'node_modules', 'vite', 'bin', 'vite.js');
const starterTrackedFiles = [
  'game.config.json',
  path.join('content', 'scenario', 'ch01_01.gal'),
];

fs.mkdirSync(agentDataDir, { recursive: true });
fs.mkdirSync(inputDir, { recursive: true });

let runHead = null;
let previewServer = null;
let keepPreviewServer = false;
let fixtureCreated = false;
let lastPassedNode = 'startup';
let firstFailedNode = null;
let projectRevision = null;
let changeId = null;
let workingRevision = 0;
let redEvidenceId = null;
let greenEvidenceId = null;
let cliTraceIds = [];
let traceIds = [];
let stateOutcomes = [];
let choiceCoverage = { total: 0, visited: 0 };
let starterIdentity = null;
let fixtureIdentity = null;
let treeHashes = {};
let previewEvidence = null;
let previewBrowser = null;
let previewBrowserClosePromise = null;
let previewPage = null;
let previewPageClosing = false;

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
  if (result.status !== 0) throw new Error(`无法读取运行 HEAD（exit=${result.status}）：${result.stderr ?? ''}`);
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
  assert(JSON.stringify(actual) === JSON.stringify(expected), '原始 Starter scene/config 身份发生变化');
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
  return {
    files,
    sha256: sha256Bytes(JSON.stringify(files)),
  };
}

function assertTreeUnchanged(expected, label) {
  const actual = readFixtureTree();
  assert(actual.sha256 === expected.sha256 && JSON.stringify(actual.files) === JSON.stringify(expected.files), `${label}期间 fixture 文件树发生变化`);
  treeHashes[label] = actual.sha256;
  return actual;
}

function copyStarterFixture() {
  assert(!fs.existsSync(fixtureRoot), `目标桌面 fixture 已存在，拒绝覆盖：${fixtureRoot}`);
  fs.mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
  fs.copyFileSync(path.join(starterRoot, 'game.config.json'), path.join(fixtureRoot, 'game.config.json'), fs.constants.COPYFILE_EXCL);

  // The config keeps entryScene=ch01_01. Scenario files are intentionally
  // left for the public Agent scene.create calls, so the committed fixture
  // contains exactly the two Agent-created scenes and its simulation is 2/2.
  const starterContent = path.join(starterRoot, 'content');
  for (const entry of fs.readdirSync(starterContent, { withFileTypes: true })) {
    if (entry.name === 'scenario') continue;
    const source = path.join(starterContent, entry.name);
    const target = path.join(fixtureRoot, 'content', entry.name);
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  }
  fixtureCreated = true;
  const topLevel = fs.readdirSync(fixtureRoot).sort();
  assert(JSON.stringify(topLevel) === JSON.stringify(['content', 'game.config.json']), `fixture 初始范围异常：${topLevel.join(', ')}`);
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
      SURDET_ENGINE_VERSION: 'stage6-wave1',
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

function fingerprint(raw) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function variableDeclarations(config) {
  return Object.entries(config.variables ?? {})
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([name, value]) => ({ name, ...value }));
}

function sceneBlocks() {
  return [
    { kind: 'text', speaker: '凛', value: 'Agent 纵向切片起点。' },
    {
      kind: 'choice',
      options: [
        {
          label: '路径 A',
          effects: [{ name: 'set', args: ['trust', '=', '1'] }],
          target: { kind: 'goto', value: 'path_a' },
        },
        {
          label: '路径 B',
          effects: [{ name: 'set', args: ['trust', '=', '-1'] }],
          target: { kind: 'goto', value: 'path_b' },
        },
      ],
    },
    { kind: 'label', name: 'path_a' },
    { kind: 'text', speaker: '凛', value: 'Agent 路径 A 后续台词。' },
    { kind: 'instruction', name: 'end' },
    { kind: 'label', name: 'path_b' },
    { kind: 'text', speaker: '凛', value: 'Agent 路径 B 后续台词。' },
  ];
}

function badSceneBlocks() {
  const blocks = sceneBlocks();
  const choice = blocks.find((block) => block.kind === 'choice');
  assert(choice?.kind === 'choice', '无法构造 Agent choice fixture');
  choice.options[0] = {
    ...choice.options[0],
    target: { kind: 'jump', value: 'ch01_01.missing_label' },
  };
  return blocks;
}

async function readPreviewMessages(page) {
  return page.evaluate(() => window.__surdetStage6Messages ?? []);
}

async function waitPreviewMessage(page, startIndex, type, timeoutMs = 30000) {
  return page.waitForFunction(({ start, expectedType }) => {
    const messages = window.__surdetStage6Messages ?? [];
    return messages.slice(start).find((message) => message?.type === expectedType) ?? null;
  }, { start: startIndex, expectedType: type }, { timeout: timeoutMs });
}

async function waitForPreviewChoice(frame, page) {
  await frame.waitForFunction(() => {
    const debug = window.surdetPreviewDebug;
    const status = debug?.rendererStatus;
    return status === 'awaiting' || status === 'choice';
  }, undefined, { timeout: 30000 });
  const status = await frame.evaluate(() => window.surdetPreviewDebug?.rendererStatus ?? null);
  if (status === 'awaiting') {
    await frame.evaluate(() => window.focus());
    await page.keyboard.press('Space');
  }
  await frame.waitForFunction(() => {
    const debug = window.surdetPreviewDebug;
    const projection = debug?.runtime?.queries?.diagnostics?.projectionSnapshot?.();
    return debug?.rendererStatus === 'choice'
      && (projection?.dialogue?.choiceLabels?.length ?? 0) === 2
      && (projection?.dialogue?.visibleChoiceCount ?? 0) === 2;
  }, undefined, { timeout: 30000 });
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

function createOwnedServerState(child, stdout = '', stderr = '') {
  const state = {
    child,
    pid: child.pid ?? null,
    stdout,
    stderr,
    exitObserved: false,
    closeObserved: false,
  };
  child.once('exit', () => { state.exitObserved = true; });
  child.once('close', () => { state.closeObserved = true; });
  return state;
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

async function closePreviewBrowser() {
  const browser = previewBrowser;
  if (!browser) return;
  previewPageClosing = true;
  previewBrowserClosePromise ??= browser.close();
  try {
    await previewBrowserClosePromise;
  } finally {
    if (previewBrowser === browser) previewBrowser = null;
    previewPage = null;
    previewBrowserClosePromise = null;
  }
}

async function stopPreviewServer() {
  const server = previewServer;
  if (!server || keepPreviewServer) return;
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
  } catch (error) {
    throw new Error(`PREVIEW_CLEANUP_FAILED pid=${server.pid ?? 'unknown'}：${errorText(error)}`);
  } finally {
    if (previewServer === server) previewServer = null;
  }
}

async function cleanupOwnedResources() {
  const failures = [];
  try {
    await closePreviewBrowser();
  } catch (error) {
    failures.push(error);
  }
  try {
    await stopPreviewServer();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new Error(failures.map(errorText).join('\n'));
  }
}

function retainPreviewServerForManualAcceptance() {
  assert(previewServer?.child, '人工入口保留时没有本轮 preview child');
  assert(Number.isInteger(previewServer.pid), `人工入口保留时 preview PID 无效：${previewServer.pid}`);
  previewServer.child.stdout?.destroy();
  previewServer.child.stderr?.destroy();
  previewServer.child.unref();
}

async function startPreviewServer(port = previewPort) {
  const serverUrl = `http://127.0.0.1:${port}/preview.html`;
  await assertPortFree(port, port === previewPort ? '正式 editor preview' : 'harness self-check preview');
  assert(fs.existsSync(viteCli), `找不到 editor Vite CLI：${viteCli}`);
  const child = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', `--port=${port}`], {
    cwd: repoRoot,
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
  previewServer.stdout = stdout;
  previewServer.stderr = stderr;
  return previewServer;
}

async function startHarnessSelfCheckServer(port) {
  const serverUrl = `http://127.0.0.1:${port}/preview.html`;
  await assertPortFree(port, 'harness self-check');
  const html = '<!doctype html><html><head><title>Surdet 预览</title></head><body><canvas></canvas><script>window.parent.postMessage({type:"surdet-preview-ready"},"*");</script></body></html>';
  const source = `
const http = require('node:http');
const html = ${JSON.stringify(html)};
const server = http.createServer((request, response) => {
  if (request.url !== '/preview.html') {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
server.listen(${port}, '127.0.0.1');
`;
  const child = spawn(process.execPath, ['-e', source], {
    cwd: repoRoot,
    env: { ...process.env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  previewServer = createOwnedServerState(child, stdout, stderr);
  const deadline = Date.now() + 10000;
  let status = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(serverUrl);
      status = response.status;
      if (status === 200) break;
    } catch {
      // The owned self-check server is still binding its isolated port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(status === 200, `harness self-check server 未返回 HTTP 200（status=${status}, exit=${child.exitCode}）\n${stdout}\n${stderr}`);
  return previewServer;
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

async function runFormalPreview(page, fixtureConfig, fixtureSceneText) {
  const previewFrame = await waitForFormalPreviewFrame(page);

  const payload = {
    projectKey: fixtureRoot,
    sceneId: 'ch01_01',
    scenes: [
      { id: 'ch01_01', text: fixtureSceneText },
      { id: 'agent_support', text: fs.readFileSync(path.join(fixtureRoot, 'content', 'scenario', 'agent_support.gal'), 'utf8') },
    ],
    variables: variableDeclarations(fixtureConfig),
    speakerProfiles: [{ id: '凛', name: '凛' }],
    configs: {},
    fast: true,
  };

  const runPath = async (pathName, choiceIndex, mode) => {
    const startIndex = await page.evaluate(() => (window.__surdetStage6Messages ?? []).length);
    await page.evaluate((nextPayload) => {
      const iframe = document.querySelector('#stage6-preview-frame');
      if (!iframe || !iframe.contentWindow) throw new Error('正式 preview iframe 不可用');
      iframe.contentWindow.postMessage({ type: 'surdet-preview-load', payload: nextPayload }, '*');
    }, payload);
    const startMessage = await waitPreviewMessage(page, startIndex, 'surdet-preview-trace-start');
    const traceStart = await startMessage.jsonValue();
    const traceId = traceStart.traceId;
    await waitForPreviewChoice(previewFrame, page);
    if (mode === 'keyboard') {
      await previewFrame.evaluate(() => window.focus());
      await page.keyboard.press(String(choiceIndex + 1));
    } else {
      const bounds = await previewFrame.evaluate((index) => {
        const projection = window.surdetPreviewDebug?.runtime?.queries?.diagnostics?.projectionSnapshot?.();
        return projection?.dialogue?.choiceBounds?.[index] ?? null;
      }, choiceIndex);
      assert(bounds, `${pathName} 未读到选择项公开几何`);
      const canvasBox = await previewFrame.locator('canvas').boundingBox();
      assert(canvasBox, `${pathName} 未读到正式 canvas 几何`);
      await page.mouse.click(
        canvasBox.x + ((bounds.x + bounds.width / 2) / 1280) * canvasBox.width,
        canvasBox.y + ((bounds.y + bounds.height / 2) / 720) * canvasBox.height,
      );
    }
    const completeMessage = await waitPreviewMessage(page, startIndex, 'surdet-preview-trace-complete', 30000);
    const complete = await completeMessage.jsonValue();
    assert(complete.traceId === traceId, `${pathName} complete traceId 不一致`);
    assert(complete.status === 'passed', `${pathName} trace 未通过：${JSON.stringify(complete)}`);
    const messages = (await readPreviewMessages(page)).filter((message) => message?.traceId === traceId);
    const eventMessages = messages.filter((message) => message?.type === 'surdet-preview-trace-event');
    const events = eventMessages.map((message) => message.event);
    assert(events.length > 0, `${pathName} 没有 Core runtimeTrace 事件`);
    assert(events.every((event) => event && event.source && event.source.sceneId === 'ch01_01'), `${pathName} trace 缺少 source 定位`);
    assert(eventMessages.every((message) => message.coreEmitted === true), `${pathName} 存在 coreEmitted=false`);
    assert(eventMessages.some((message) => message.presentationApplied === true), `${pathName} 没有 presentationApplied=true`);
    const stateEvent = events.find((event) => event.kind === 'state' && event.stateDelta?.some((delta) => delta.variable === 'trust'));
    assert(stateEvent, `${pathName} 没有 trust state trace`);
    const trustDelta = stateEvent.stateDelta.find((delta) => delta.variable === 'trust');
    assert(trustDelta.after === (choiceIndex === 0 ? 1 : -1), `${pathName} trust 结果错误：${JSON.stringify(trustDelta)}`);
    const projection = await previewFrame.evaluate(() => window.surdetPreviewDebug?.runtime?.queries?.diagnostics?.projectionSnapshot?.() ?? null);
    const text = projection?.dialogue?.dialogText ?? '';
    assert(typeof text === 'string' && text.length > 0, `${pathName} 未读到后续可见台词投影`);
    return {
      path: pathName,
      traceId,
      events,
      eventMessages,
      outcome: trustDelta.after,
      text,
      complete,
    };
  };

  const pathA = await runPath('A', 0, 'keyboard');
  const pathB = await runPath('B', 1, 'mouse');
  assert(pathA.text !== pathB.text, `路径 A/B 后续台词投影相同：${pathA.text}`);
  return { pathA, pathB };
}

async function verifyPreviewErrorChannels(page) {
  const messages = await readPreviewMessages(page);
  const traceFailures = messages
    .filter((message) => message?.type === 'surdet-preview-trace-complete' && message.status === 'failed')
    .map((message) => message.firstError ?? JSON.stringify(message));
  previewErrors.unhandledRejections.push(...traceFailures);
  for (const [key, values] of Object.entries(previewErrors)) {
    if (key === 'unexpectedWindowClosed') continue;
    assert(values.length === 0, `${key} 非空：${JSON.stringify(values)}`);
  }
  assert(previewErrors.unexpectedWindowClosed === false, '正式 preview 窗口意外关闭');
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
  const payload = {
    schemaVersion: 1,
    status,
    runHead,
    projectRevision,
    changeId,
    workingRevision,
    redEvidenceId,
    greenEvidenceId,
    traceIds,
    cliTraceIds,
    choiceCoverage,
    stateOutcomes,
    originalStarter,
    fixture: fixtureIdentity ? { path: fixtureRoot, ...fixtureIdentity } : { path: fixtureRoot },
    treeHashes,
    preview: previewEvidence,
    errors: error === null ? [] : [errorText(error)],
    errorChannels: previewErrors,
    lastPassedNode,
    firstFailedNode,
  };
  return payload;
}

function writeArtifactOnce(status, error = null) {
  assert(!fs.existsSync(artifactPath), `artifact 已存在，拒绝覆盖：${artifactPath}`);
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifactPayload(status, error), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const bytes = bytesFile(artifactPath);
  const sha256 = sha256File(artifactPath);
  return { path: artifactPath, bytes, sha256, status };
}

async function runPreviewHarnessSelfCheck() {
  const selfCheckPreviewUrl = `http://127.0.0.1:${harnessSelfCheckPort}/preview.html`;
  const ownedBrowserState = { browser: null, child: null };
  let ownedServerState = null;
  let deliberateFailure = null;
  let reachedDeliberateFailure = false;
  assert(!fs.existsSync(fixtureRoot), `self-check fixture already exists：${fixtureRoot}`);
  assert(!fs.existsSync(artifactPath), `self-check artifact already exists：${artifactPath}`);
  await assertPortFree(harnessSelfCheckPort, 'harness self-check');

  try {
    const server = await startHarnessSelfCheckServer(harnessSelfCheckPort);
    ownedServerState = server;
    ownedBrowserState.child = server.child;
    previewBrowser = await chromium.launch({ headless: true });
    ownedBrowserState.browser = previewBrowser;
    const page = await previewBrowser.newPage({ viewport: { width: 1280, height: 720 } });
    previewPage = page;
    previewPageClosing = false;
    await page.route(harnessSelfCheckParentUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>window.__surdetStage6Messages=[];window.addEventListener('message',(event)=>window.__surdetStage6Messages.push(event.data));</script><iframe id="stage6-preview-frame"></iframe><script>setTimeout(() => { document.querySelector('#stage6-preview-frame').src = ${JSON.stringify(selfCheckPreviewUrl)}; }, 250);</script></body></html>`,
      });
    });
    await page.goto(harnessSelfCheckParentUrl, { waitUntil: 'domcontentloaded' });
    const immediateFrameUrls = page.frames().map((frame) => frame.url());
    assert(
      !immediateFrameUrls.some((frameUrl) => {
        try {
          return new URL(frameUrl).pathname === '/preview.html';
        } catch {
          return false;
        }
      }),
      `self-check 延迟导航前错误发现 preview frame：${JSON.stringify(immediateFrameUrls)}`,
    );
    assert(immediateFrameUrls.some((frameUrl) => frameUrl === '' || frameUrl === 'about:blank'), `self-check 未观察到初始空 frame URL：${JSON.stringify(immediateFrameUrls)}`);
    await page.route(selfCheckPreviewUrl, async (route) => route.continue());
    const frame = await waitForFormalPreviewFrame(page, 10000);
    assert(new URL(frame.url()).pathname === '/preview.html', `self-check frame pathname 错误：${frame.url()}`);
    assert(await frame.locator('canvas').count() === 1, 'self-check 正式 canvas 不存在');
    assert(
      await page.waitForFunction(() => (window.__surdetStage6Messages ?? []).some((message) => message?.type === 'surdet-preview-ready'), undefined, { timeout: 10000 }),
      'self-check 未观察到 surdet-preview-ready',
    );
    reachedDeliberateFailure = true;
    throw new Error('PREVIEW_HARNESS_SELF_CHECK_DELIBERATE_FAILURE');
  } catch (error) {
    deliberateFailure = error;
  } finally {
    await cleanupOwnedResources();
  }

  assert(reachedDeliberateFailure, `self-check 未到达故意失败节点：${errorText(deliberateFailure)}`);
  assert(deliberateFailure?.message === 'PREVIEW_HARNESS_SELF_CHECK_DELIBERATE_FAILURE', `self-check 故意失败被错误改写：${errorText(deliberateFailure)}`);
  assert(ownedBrowserState.browser && !ownedBrowserState.browser.isConnected(), 'self-check browser 未断开');
  assert(ownedServerState?.exitObserved === true && ownedServerState.closeObserved === true, `self-check preview child 未完成 exit/close：pid=${ownedBrowserState.child?.pid ?? 'unknown'}`);
  assert(previewBrowser === null, 'self-check cleanup 后 previewBrowser 仍存在');
  assert(previewServer === null, 'self-check cleanup 后 previewServer 仍存在');
  await assertPortFree(harnessSelfCheckPort, 'harness self-check cleanup');
  assert(!fs.existsSync(fixtureRoot), 'self-check 不得创建 Stage 6 fixture');
  assert(!fs.existsSync(artifactPath), 'self-check 不得创建正式 artifact');
  return {
    status: 'PREVIEW_HARNESS_SELF_CHECK_PASSED',
    framePathname: '/preview.html',
    delayedNavigation: true,
    browserDisconnected: true,
    childExited: true,
    port: harnessSelfCheckPort,
  };
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

  const inspect = await step('capabilities.describe-and-project.inspect', async () => {
    const capabilities = success('capabilities.describe', runCli(['capabilities', 'describe']));
    const expected = [
      'capabilities.describe', 'project.inspect', 'object.inspect', 'change.begin',
      'scene.create', 'scene.patch', 'variable.ensure', 'project.validate',
      'project.simulate', 'runtime.run-from', 'runtime.read-trace', 'change.diff',
      'change.commit', 'change.rollback',
    ];
    assert(JSON.stringify(capabilities.result.capabilities) === JSON.stringify(expected), '14 项 capabilities 顺序或内容不一致');
    const project = success('project.inspect', runCli(['project', 'inspect', '--project', fixtureRoot]));
    assert(project.result && typeof project.projectRevision === 'string', 'project.inspect 缺少 revision/result');
    return project;
  });

  const begun = await step('change.begin', async () => {
    const body = success('change.begin', runCli(['change', 'begin', '--project', fixtureRoot]));
    changeId = body.changeId;
    projectRevision = body.projectRevision;
    workingRevision = body.workingRevision;
    assert(/^chg_/.test(changeId), `changeId 非法：${changeId}`);
    assert(workingRevision === 0, `初始 workingRevision 不是 0：${workingRevision}`);
    assert(inspect.projectRevision === projectRevision, 'begin 前后 projectRevision 不一致');
    assertTreeUnchanged(fixtureIdentity, 'afterBegin');
    return body;
  });

  await step('change.write-operations-before-red', async () => {
    const trustInput = writeInput('variable-ensure.json', {
      operationId: 'stage6-variable-trust', name: 'trust', type: 'number', initial: 0,
    });
    success('variable.ensure', runCli(['variable', 'ensure', '--change', changeId, '--input', trustInput], undefined));

    const supportInput = writeInput('scene-support.json', {
      operationId: 'stage6-scene-support',
      sceneId: 'agent_support',
      blocks: [{ kind: 'text', speaker: '凛', value: 'Agent 支线背景场景。' }],
    });
    success('scene.create(agent_support)', runCli(['scene', 'create', '--change', changeId, '--input', supportInput], undefined));

    const badInput = writeInput('scene-main-bad.json', {
      operationId: 'stage6-scene-main',
      sceneId: 'ch01_01',
      blocks: badSceneBlocks(),
    });
    success('scene.create(ch01_01)', runCli(['scene', 'create', '--change', changeId, '--input', badInput], undefined));
    assertTreeUnchanged(fixtureIdentity, 'afterSceneCreateBeforeRed');
  });

  const redValidation = await step('project.validate.red', async () => {
    const response = success('project.validate(red)', runCli(['project', 'validate', '--change', changeId]));
    const issue = response.result.issues.find((candidate) => candidate.code === 'J002' && candidate.severity === 'error');
    assert(issue, `红灯校验没有 J002：${JSON.stringify(response.result.issues)}`);
    assert(typeof issue.objectRef === 'string' && issue.objectRef.length > 0, '红灯 J002 缺少 objectRef');
    assert(typeof issue.action === 'string' && issue.action.length > 0, '红灯 J002 缺少 action');
    redEvidenceId = response.result.evidenceId;
    assert(typeof redEvidenceId === 'string' && redEvidenceId.length > 0, '红灯缺少 evidenceId');
    assertTreeUnchanged(fixtureIdentity, 'afterRedValidation');
    return issue;
  });

  await step('object.inspect.readonly', async () => {
    // The current public object.inspect command reads the committed project.
    // Inspect an existing Starter variable while the new scene object remains
    // isolated; the validation objectRef is used by the typed scene.patch.
    const body = success('object.inspect', runCli(['object', 'inspect', '--project', fixtureRoot, '--ref', 'variable:gold']));
    assert(body.result?.objectRef === 'variable:gold', `object.inspect 返回错误对象：${JSON.stringify(body.result)}`);
    assert(body.result?.source?.path === 'game.config.json', 'object.inspect 未返回 game.config.json 来源');
  });

  await step('scene.patch-and-project.validate.green', async () => {
    const badRaw = '  路径 A -> @set trust = 1 @jump ch01_01.missing_label';
    const patchInput = writeInput('scene-main-patch.json', {
      operationId: 'stage6-scene-main-patch',
      sceneId: 'ch01_01',
      patch: {
        kind: 'replaceChoiceOption',
        target: redValidation.objectRef,
        expectedFingerprint: fingerprint(badRaw),
        option: {
          label: '路径 A',
          effects: [{ name: 'set', args: ['trust', '=', '1'] }],
          target: { kind: 'goto', value: 'path_a' },
        },
      },
    });
    success('scene.patch', runCli(['scene', 'patch', '--change', changeId, '--input', patchInput], undefined));
    const response = success('project.validate(green)', runCli(['project', 'validate', '--change', changeId]));
    assert(response.result.ok === true, `绿灯校验仍有 error：${JSON.stringify(response.result.issues)}`);
    assert(response.result.issues.every((issue) => issue.severity !== 'error'), '绿灯校验包含 error');
    greenEvidenceId = response.result.evidenceId;
    assert(typeof greenEvidenceId === 'string' && greenEvidenceId.length > 0, '绿灯缺少 evidenceId');
    assertTreeUnchanged(fixtureIdentity, 'afterGreenValidation');
  });

  await step('project.simulate-2-of-2', async () => {
    const response = success('project.simulate', runCli(['project', 'simulate', '--change', changeId]));
    assert(response.result.status === 'passed', `模拟状态不是 passed：${JSON.stringify(response.result)}`);
    assert(response.result.choiceBranches?.total === 2, `模拟 choice total 不是 2：${JSON.stringify(response.result.choiceBranches)}`);
    assert(response.result.choiceBranches?.visited === 2, `模拟 choice visited 不是 2：${JSON.stringify(response.result.choiceBranches)}`);
    assert(response.result.paths?.length === 2, `模拟路径数量不是 2：${JSON.stringify(response.result.paths)}`);
    choiceCoverage = response.result.choiceBranches;
  });

  const traceBodies = await step('runtime.run-from.A-and-B', async () => {
    const aInput = writeInput('runtime-a.json', { sceneId: 'ch01_01', choices: [0], seed: 601 });
    const bInput = writeInput('runtime-b.json', { sceneId: 'ch01_01', choices: [1], seed: 602 });
    const a = success('runtime.run-from(A)', runCli(['runtime', 'run-from', '--change', changeId, '--input', aInput], undefined));
    const b = success('runtime.run-from(B)', runCli(['runtime', 'run-from', '--change', changeId, '--input', bInput], undefined));
    assert(a.result.finalVariables?.trust === 1, `路径 A trust 不是 1：${JSON.stringify(a.result)}`);
    assert(b.result.finalVariables?.trust === -1, `路径 B trust 不是 -1：${JSON.stringify(b.result)}`);
    assert(a.result.traceId !== b.result.traceId, '路径 A/B traceId 重复');
    cliTraceIds = [a.result.traceId, b.result.traceId];
    stateOutcomes = [b.result.finalVariables.trust, a.result.finalVariables.trust];
    return { a, b };
  });

  await step('runtime.read-trace', async () => {
    const queryInput = writeInput('runtime-trace-query.json', {});
    const response = success('runtime.read-trace(A)', runCli([
      'runtime', 'read-trace', '--change', changeId, '--trace', cliTraceIds[0], '--query', queryInput,
    ]));
    assert(response.result.count > 0, 'runtime.read-trace 返回空轨迹');
    assert(response.result.events.some((event) => event.source?.file === 'content/scenario/ch01_01.gal'), 'runtime trace 缺少场景来源');
  });

  await step('change.diff', async () => {
    const response = success('change.diff', runCli(['change', 'diff', '--change', changeId]));
    const paths = response.result.files.map((file) => file.path).sort();
    assert(paths.includes('game.config.json'), `diff 缺少 game.config.json：${paths.join(', ')}`);
    assert(paths.includes('content/scenario/ch01_01.gal'), `diff 缺少 ch01_01.gal：${paths.join(', ')}`);
    assert(paths.includes('content/scenario/agent_support.gal'), `diff 缺少 agent_support.gal：${paths.join(', ')}`);
    assert(paths.every((value) => value === 'game.config.json' || value === 'content/scenario/ch01_01.gal' || value === 'content/scenario/agent_support.gal'), `diff 含未预期文件：${paths.join(', ')}`);
    assertTreeUnchanged(fixtureIdentity, 'afterDiff');
  });

  await step('change.commit', async () => {
    const response = success('change.commit', runCli(['change', 'commit', '--change', changeId]));
    assert(response.result.status === 'COMMITTED', `commit 状态异常：${JSON.stringify(response.result)}`);
    const after = readFixtureTree();
    assert(after.sha256 !== fixtureIdentity.sha256, 'commit 后 fixture 文件树没有变化');
    treeHashes.afterCommit = after.sha256;
    const scenarioFiles = fs.readdirSync(path.join(fixtureRoot, 'content', 'scenario')).sort();
    assert(JSON.stringify(scenarioFiles) === JSON.stringify(['agent_support.gal', 'ch01_01.gal']), `commit 后场景范围异常：${scenarioFiles.join(', ')}`);
  });

  const config = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'game.config.json'), 'utf8'));
  const sceneText = fs.readFileSync(path.join(fixtureRoot, 'content', 'scenario', 'ch01_01.gal'), 'utf8');
  const server = await step('editor.preview.server', startPreviewServer);
  previewBrowser = await chromium.launch({ headless: true });
  const page = await previewBrowser.newPage({ viewport: { width: 1280, height: 720 } });
  previewPage = page;
  previewPageClosing = false;
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
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      console.error(`[e2e-unhandledrejection] ${reason}`);
    });
  });
  await page.route(parentUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0;background:#0d0f16"><script>window.__surdetStage6Messages=[];window.addEventListener('message',(event)=>window.__surdetStage6Messages.push(event.data));</script><iframe id="stage6-preview-frame" src="${previewUrl}" style="width:1280px;height:720px;border:0"></iframe></body></html>`,
    });
  });
  await page.goto(parentUrl, { waitUntil: 'domcontentloaded' });
  const paths = await step('editor.preview.renderer.paths.A-B', () => runFormalPreview(page, config, sceneText));
  traceIds = [paths.pathA.traceId, paths.pathB.traceId];
  await step('editor.preview.error-channels', () => verifyPreviewErrorChannels(page));
  previewEvidence = {
    url: previewUrl,
    pid: server.pid,
    fixturePath: fixtureRoot,
    paths: [
      { name: paths.pathA.path, traceId: paths.pathA.traceId, trust: paths.pathA.outcome, text: paths.pathA.text, input: 'real keyboard: 1' },
      { name: paths.pathB.path, traceId: paths.pathB.traceId, trust: paths.pathB.outcome, text: paths.pathB.text, input: 'real mouse: second choice bounds' },
    ],
    cliTraceIds,
    pageErrors: previewErrors.pageErrors,
    consoleErrors: previewErrors.consoleErrors,
    requestFailures: previewErrors.requestFailures,
    unhandledRejections: previewErrors.unhandledRejections,
    rendererErrors: previewErrors.rendererErrors,
    releaseFailures: previewErrors.releaseFailures,
    unexpectedWindowClosed: previewErrors.unexpectedWindowClosed,
  };

  await step('editor.preview.manual-entry', async () => {
    const response = await fetch(previewUrl);
    assert(response.status === 200, `人工入口 URL HTTP ${response.status}`);
    const html = await response.text();
    assert(/<title>Surdet 预览<\/title>/u.test(html), '人工入口页面标题不正确');
    assert(fs.existsSync(fixtureRoot), '人工 fixture 路径不存在');
    assert(fs.existsSync(path.join(fixtureRoot, 'content', 'scenario', 'ch01_01.gal')), '人工 fixture 目标场景不存在');
  });
  keepPreviewServer = true;
  retainPreviewServerForManualAcceptance();

  fixtureIdentity = readFixtureTree();
  assertStarterUnchanged(starterIdentity);
  return { server, paths };
}

async function main() {
  if (process.argv.includes('--preview-harness-self-check')) {
    const result = await runPreviewHarnessSelfCheck();
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (process.argv.includes('--self-check')) {
    const startupStarter = readStarterIdentity();
    const startupHead = currentGitHead();
    assert(JSON.stringify(startupStarter) === JSON.stringify(starterIdentity ?? startupStarter), 'self-check Starter identity mismatch');
    assert(/^[0-9a-f]{40}$/i.test(startupHead), 'self-check HEAD invalid');
    assert(!fs.existsSync(fixtureRoot), `self-check fixture already exists：${fixtureRoot}`);
    assert(!fs.existsSync(artifactPath), `self-check artifact already exists：${artifactPath}`);
    const badBlocks = badSceneBlocks();
    const badChoice = badBlocks.find((block) => block.kind === 'choice');
    assert(badChoice?.kind === 'choice', 'self-check 无法读取故意红灯 choice');
    const badOption = badChoice.options[0];
    assert(badOption, 'self-check 无法读取故意红灯 option');
    assert(
      badOption.target.kind === 'jump' && badOption.target.value === 'ch01_01.missing_label',
      `self-check 故意红灯必须使用 project-level jump：${JSON.stringify(badOption.target)}`,
    );
    const serializedBadOption = [
      badOption.label,
      ...(badOption.when === undefined ? [] : [`[if:${badOption.when}]`]),
      '->',
      ...(badOption.effects ?? []).map((effect) => `@${effect.name} ${effect.args.join(' ')}`),
      `@${badOption.target.kind} ${badOption.target.value}`,
    ].join(' ');
    assert(
      serializedBadOption === '路径 A -> @set trust = 1 @jump ch01_01.missing_label',
      `self-check 故意红灯序列化不匹配：${serializedBadOption}`,
    );
    return { status: 'SELF_CHECK_PASSED', fixtureRoot, artifactPath, runHead: startupHead };
  }

  try {
    await run();
    await cleanupOwnedResources();
    const artifact = writeArtifactOnce('PASSED');
    console.log(JSON.stringify({ ...artifact, fixturePath: fixtureRoot, previewUrl, previewPid: previewServer?.pid ?? null }, null, 2));
    return 0;
  } catch (error) {
    if (firstFailedNode === null) firstFailedNode = 'startup';
    let cleanupError = null;
    try {
      await cleanupOwnedResources();
    } catch (errorDuringCleanup) {
      cleanupError = errorDuringCleanup;
    }
    const finalError = cleanupError === null
      ? error
      : new Error(`${errorText(error)}\n${errorText(cleanupError)}`);
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

if (process.argv.includes('--self-check')) {
  main()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error(errorText(error));
      process.exit(1);
    });
} else {
  main().then((code) => { process.exitCode = code; });
}
