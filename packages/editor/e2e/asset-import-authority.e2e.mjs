import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { hashProjectTree } from './support/fake-file-system.mjs';

const runnerPath = fileURLToPath(import.meta.url);
const editorRoot = path.resolve(path.dirname(runnerPath), '..');
const repoRoot = path.resolve(editorRoot, '..', '..');
const STARTER_RELATIVE_PATH = 'examples/starter';
const starterRoot = path.join(repoRoot, ...STARTER_RELATIVE_PATH.split('/'));
const fixtureProjectRoot = path.join(editorRoot, 'e2e', 'fixtures', 'asset-authority-project');
const forbiddenPorts = new Set([4173, 4175]);
const EXPECTED_UNDO_CONSOLE_ERROR = 'Failed to load resource: the server responded with a status of 409 (Conflict)';

export const SEARCH_RANGE = Object.freeze({ from: 4381, to: 4420 });
export const MILESTONE_IDS = Object.freeze([
  'strict-isolated-port-selected',
  'unsafe-project-tree-node-rejected',
  'wrong-directory-rejected',
  'project-bound-cleanly',
  'multi-file-selected',
  'collision-blocked-without-overwrite',
  'ready-plan-invalidated-after-target-edit',
  'multi-file-import-committed',
  'asset-facts-refreshed',
  'receipt-reopened-after-reload',
  'modified-file-undo-blocked',
  'unchanged-file-undo-succeeded',
  'undo-quarantine-retained',
  'relocation-target-collision-blocked',
  'relocation-impact-previewed',
  'referenced-asset-relocated-and-reloaded',
  'relocated-scene-previewed',
  'asset-relocation-undo-succeeded',
  'batch-relocation-impact-previewed',
  'batch-relocation-800px-readable',
  'referenced-batch-swap-committed-and-reloaded',
  'batch-swapped-scene-previewed',
  'batch-relocation-undo-succeeded',
  'repository-and-starter-unchanged',
  'browser-error-channels-empty',
  'isolated-process-cleanup',
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  if (!(error instanceof Error)) return String(error);
  return error.stack || `${error.name}: ${error.message}`;
}

function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { path: path.resolve(file), bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function writeExclusiveJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const handle = fs.openSync(file, 'wx');
  try {
    fs.writeSync(handle, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return readFileIdentity(file);
}

function gitOutput(args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding, windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  return typeof result.stdout === 'string' ? result.stdout : Buffer.from(result.stdout);
}

function repositoryTreeIdentity() {
  const head = gitOutput(['rev-parse', 'HEAD']).trim();
  const status = gitOutput(['status', '--porcelain=v1', '-uall']);
  const diff = gitOutput(['diff', '--binary', '--']);
  const cached = gitOutput(['diff', '--cached', '--binary', '--']);
  const bytes = Buffer.from(`${head}\0${status}\0${diff}\0${cached}`, 'utf8');
  return {
    head,
    statusSha256: sha256(Buffer.from(status, 'utf8')),
    diffSha256: sha256(Buffer.from(diff, 'utf8')),
    cachedDiffSha256: sha256(Buffer.from(cached, 'utf8')),
    sha256: sha256(bytes),
  };
}

function copyProjectFixture(destination, options = {}) {
  fs.cpSync(fixtureProjectRoot, destination, {
    recursive: true,
    filter(source) {
      const name = path.basename(source);
      const relative = path.relative(fixtureProjectRoot, source).split(path.sep).join('/');
      if (options.includeTests === false && (relative === 'test' || relative.startsWith('test/'))) return false;
      return !['.git', 'node_modules', 'dist', '.vite'].includes(name);
    },
  });
}

function hashCanonicalProjectTree(root, registeredRootChallengeNames = []) {
  const registeredRootChallenges = new Set(registeredRootChallengeNames);
  const files = [];
  const visit = (directory, relativeDirectory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
      const portableRelative = relative.split(path.sep).join('/');
      const isDirectory = entry.isDirectory();
      const isFile = entry.isFile();
      if (entry.isSymbolicLink() || (!isDirectory && !isFile)) {
        throw new Error(`unsupported symbolic link, junction, or other project tree node: ${portableRelative}`);
      }
      const isRegisteredRootChallenge = relativeDirectory.length === 0
        && registeredRootChallenges.has(entry.name);
      if (['.git', 'node_modules', 'dist', '.vite'].includes(entry.name)
        || isRegisteredRootChallenge
        || portableRelative === '.surdet/asset-import'
        || portableRelative === '.surdet/asset-relocation') continue;
      if (isDirectory) visit(absolute, relative);
      else if (isFile) {
        const bytes = fs.readFileSync(absolute);
        files.push({
          path: relative.split(path.sep).join('/'),
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
        });
      }
    }
  };
  visit(root, '');
  const serialized = files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join('\n');
  return {
    path: path.resolve(root),
    fileCount: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
    files,
  };
}

function svgBytes(label) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#314b60"/><text x="24" y="98" fill="#fff" font-size="24">${label}</text></svg>`,
    'utf8',
  );
}

function wavBytes(durationMs = 160, sampleRate = 8_000) {
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationMs / 1_000));
  const dataBytes = sampleCount * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

async function chooseStrictPort() {
  for (let port = SEARCH_RANGE.from; port <= SEARCH_RANGE.to; port += 1) {
    if (!forbiddenPorts.has(port) && await portIsAvailable(port)) return port;
  }
  throw new Error(`no strict isolated port available in ${SEARCH_RANGE.from}..${SEARCH_RANGE.to}`);
}

async function waitForHttp(child, url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev-project exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dev-project readiness timeout: ${url}`);
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child === null || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function waitForStreamClose(stream, timeoutMs = 5_000) {
  if (stream === null || stream.destroyed || stream.closed) return true;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('close', onClose);
      stream.off('error', onError);
      resolve(result);
    };
    const onClose = () => finish(true);
    const onError = () => finish(false);
    stream.once('close', onClose);
    stream.once('error', onError);
    stream.resume();
  });
}

async function drainServerStderr(child, childCleanupFailures) {
  if (child?.stderr === null || child?.stderr === undefined) return;
  if (!(await waitForStreamClose(child.stderr))) {
    childCleanupFailures.push(`server stderr stream remained open after child shutdown (${child.pid ?? 'unknown'})`);
  }
}

async function stopServer(child, childCleanupFailures) {
  if (child === null) return;
  const pid = child.pid;
  let exited = child.exitCode !== null;
  if (child.connected) {
    try { child.send({ type: 'shutdown' }); } catch (error) { childCleanupFailures.push(`IPC shutdown ${pid}: ${errorText(error)}`); }
    exited = await waitForExit(child, 10_000);
  }
  if (!exited && child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch (error) { childCleanupFailures.push(`SIGTERM ${pid}: ${errorText(error)}`); }
  }
  if (!exited) exited = await waitForExit(child);
  if (!exited && process.platform === 'win32' && Number.isInteger(pid)) {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
    await waitForExit(killer, 5_000);
    exited = await waitForExit(child);
  } else if (!exited && child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch (error) { childCleanupFailures.push(`SIGKILL ${pid}: ${errorText(error)}`); }
  }
  if (!exited) exited = await waitForExit(child);
  if (!exited) childCleanupFailures.push(`dev-project child remained alive: ${pid}`);
  await drainServerStderr(child, childCleanupFailures);
}

function resolveRootPath(root, relativePath = '') {
  assert(typeof relativePath === 'string' && !relativePath.includes('\0'), 'invalid bridge path');
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const segments = normalized.length === 0 ? [] : normalized.split('/');
  assert(segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'), 'unsafe bridge path');
  const absolute = path.resolve(root, ...segments);
  const resolvedRoot = path.resolve(root);
  assert(absolute === resolvedRoot || absolute.startsWith(`${resolvedRoot}${path.sep}`), 'bridge path escaped root');
  return absolute;
}

function createNodeFsBridge(roots) {
  return async (request) => {
    assert(request && typeof request === 'object', 'invalid node filesystem bridge request');
    const root = roots[request.rootKey];
    assert(typeof root === 'string', `unknown node filesystem root: ${String(request.rootKey)}`);
    const target = resolveRootPath(root, request.path ?? '');
    if (request.op === 'root-name') return { name: path.basename(root) };
    if (request.op === 'stat') {
      try {
        const stat = fs.lstatSync(target);
        return {
          kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
          size: stat.size,
          lastModified: stat.mtimeMs,
          symbolicLink: stat.isSymbolicLink(),
        };
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    }
    if (request.op === 'read') return { bytes: fs.readFileSync(target).toString('base64') };
    if (request.op === 'list') {
      return fs.readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }))
        .sort((left, right) => left.name.localeCompare(right.name));
    }
    if (request.op === 'mkdir') {
      fs.mkdirSync(target, { recursive: request.recursive === true });
      return { ok: true };
    }
    if (request.op === 'write') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(request.bytes, 'base64'));
      return { ok: true };
    }
    if (request.op === 'remove') {
      fs.rmSync(target, { recursive: request.recursive === true, force: false });
      return { ok: true };
    }
    throw new Error(`unsupported node filesystem bridge operation: ${String(request.op)}`);
  };
}

// Browser-init-only File System Access bridge. Every read reaches the isolated
// physical fixture, so binding probes and newly committed assets stay fresh.
const nodeBackedFileSystemInit = ({ initialRootKey }) => {
  let selectedRootKey = initialRootKey;
  const call = (request) => window.__surdetNodeFs(request);
  const fail = (message) => { throw new DOMException(message, 'NotFoundError'); };
  const normalize = (value) => String(value).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const join = (parent, name) => normalize(parent.length === 0 ? name : `${parent}/${name}`);
  const mimeFor = (name) => {
    if (name.endsWith('.json')) return 'application/json';
    if (name.endsWith('.gal')) return 'text/plain';
    if (name.endsWith('.svg')) return 'image/svg+xml';
    if (name.endsWith('.wav')) return 'audio/wav';
    return 'application/octet-stream';
  };
  const bytesFromValue = async (value) => {
    if (value?.type === 'write') return bytesFromValue(value.data);
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
    return new Uint8Array();
  };
  const toBase64 = (bytes) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const makeFile = (rootKey, filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    __surdetRootKey: rootKey,
    __surdetRelativePath: filePath,
    async getFile() {
      const stat = await call({ op: 'stat', rootKey, path: filePath });
      if (stat?.kind !== 'file' || stat.symbolicLink) fail(`missing or unsafe file ${filePath}`);
      const result = await call({ op: 'read', rootKey, path: filePath });
      const binary = Uint8Array.from(atob(result.bytes), (character) => character.charCodeAt(0));
      return new File([binary], filePath.split('/').pop(), {
        type: mimeFor(filePath), lastModified: Number(stat.lastModified) || 0,
      });
    },
    async createWritable() {
      return {
        async write(value) {
          const bytes = await bytesFromValue(value);
          await call({ op: 'write', rootKey, path: filePath, bytes: toBase64(bytes) });
        },
        async close() {},
      };
    },
    async isSameEntry(other) {
      return other?.kind === 'file'
        && other?.__surdetRootKey === rootKey
        && other?.__surdetRelativePath === filePath;
    },
  });
  const makeDirectory = (rootKey, directoryPath) => ({
    kind: 'directory',
    name: directoryPath.length === 0 ? rootKey : directoryPath.split('/').pop(),
    __surdetRootKey: rootKey,
    __surdetRelativePath: directoryPath,
    async getFileHandle(name, options = {}) {
      const child = join(directoryPath, name);
      let stat = await call({ op: 'stat', rootKey, path: child });
      if (stat === null && options.create) {
        await call({ op: 'write', rootKey, path: child, bytes: '' });
        stat = await call({ op: 'stat', rootKey, path: child });
      }
      if (stat?.kind !== 'file' || stat.symbolicLink) fail(`missing or unsafe file ${child}`);
      return makeFile(rootKey, child);
    },
    async getDirectoryHandle(name, options = {}) {
      const child = join(directoryPath, name);
      let stat = await call({ op: 'stat', rootKey, path: child });
      if (stat === null && options.create) {
        await call({ op: 'mkdir', rootKey, path: child, recursive: true });
        stat = await call({ op: 'stat', rootKey, path: child });
      }
      if (stat?.kind !== 'directory' || stat.symbolicLink) fail(`missing or unsafe directory ${child}`);
      return makeDirectory(rootKey, child);
    },
    values() {
      const iterator = async function* valuesIterator() {
        const entries = await call({ op: 'list', rootKey, path: directoryPath });
        for (const entry of entries) {
          const child = join(directoryPath, entry.name);
          yield entry.kind === 'directory' ? makeDirectory(rootKey, child) : makeFile(rootKey, child);
        }
      };
      return iterator();
    },
    async removeEntry(name, options = {}) {
      await call({ op: 'remove', rootKey, path: join(directoryPath, name), recursive: options.recursive === true });
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async isSameEntry(other) {
      return other?.kind === 'directory'
        && other?.__surdetRootKey === rootKey
        && other?.__surdetRelativePath === directoryPath;
    },
  });
  window.__surdetE2eSetPickerRoot = (rootKey) => { selectedRootKey = rootKey; };
  window.showDirectoryPicker = async () => makeDirectory(selectedRootKey, '');
};

function observePage(page, channels, tokenEvidence, phaseRef, pendingHeaderReads) {
  page.on('console', (message) => {
    if (message.type() === 'error') channels.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => channels.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => channels.requestFailures.push(
    `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  page.on('request', (request) => {
    const promise = request.allHeaders().then((headers) => {
      const phase = phaseRef.value;
      const binding = headers['x-surdet-project-binding'];
      const operation = headers['x-surdet-import-operation'];
      if (binding) tokenEvidence.bindingTokenHashes[phase].add(sha256(binding));
      if (operation) tokenEvidence.operationTokenHashes[phase].add(sha256(operation));
    }).catch((error) => channels.errors.push(`header capture: ${errorText(error)}`));
    pendingHeaderReads.push(promise);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    const record = `${response.status()} ${response.request().method()} ${pathname}`;
    if (response.status() === 409 && pathname.endsWith('/undo')) {
      channels.expectedBusinessResponses.push({ status: 409, method: response.request().method(), pathname, code: null, record });
    }
    else channels.responseFailures.push(record);
  });
}

async function openProject(page, rootKey, expectedEntryState) {
  await page.evaluate((key) => window.__surdetE2eSetPickerRoot(key), rootKey);
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => (
    window.surdetEditorDebug?.state?.assetIntelligenceState === 'ready'
      && window.surdetEditorDebug?.state?.authoringIndex !== null
  ));
  await page.waitForFunction((expected) => (
    window.surdetEditorDebug?.state?.assetImportWorkspace?.entryState === expected
  ), expectedEntryState);
}

async function openImportWorkbench(page) {
  await page.locator('[data-editor-mode="assets"]').click();
  await page.locator('#asset-center-view.asset-center').waitFor({ state: 'visible' });
  const entry = page.locator('.asset-import-entry');
  await entry.waitFor({ state: 'visible' });
  if (await entry.getAttribute('aria-expanded') !== 'true') await entry.click();
  await page.locator('#asset-import-workbench.asset-import-workbench').waitFor({ state: 'visible' });
}

async function workspaceSnapshot(page) {
  return page.evaluate(() => {
    const value = window.surdetEditorDebug.state.assetImportWorkspace;
    return {
      entryState: value?.entryState ?? null,
      projectIdentity: value?.projectIdentity ?? null,
      projectName: value?.projectName ?? null,
      message: value?.message ?? null,
      draftItems: (value?.draftItems ?? []).map((item) => ({
        itemId: item.itemId,
        sourceName: item.sourceName,
        fileName: item.fileName,
        bytes: item.bytes,
        kind: item.kind,
      })),
      recentReceipts: value?.recentReceipts ?? [],
      operation: value?.activeOperation === null || value?.activeOperation === undefined ? null : {
        operationId: value.activeOperation.operation.operationId,
        status: value.activeOperation.operation.status,
        plan: value.activeOperation.plan,
        receipt: value.activeOperation.receipt,
        undoReceipt: value.activeOperation.undoReceipt,
      },
    };
  });
}

async function setCategory(page, index, category) {
  await page.locator('.asset-import-category').nth(index).selectOption(category);
  await page.waitForFunction(({ itemIndex, expected }) => (
    window.surdetEditorDebug.state.assetImportWorkspace?.draftItems[itemIndex]?.kind === expected
  ), { itemIndex: index, expected: category });
}

async function setFinalName(page, index, fileName) {
  const input = page.locator('.asset-import-file-name').nth(index);
  await input.fill(fileName);
  await input.blur();
  await page.waitForFunction(({ itemIndex, expected }) => (
    window.surdetEditorDebug.state.assetImportWorkspace?.draftItems[itemIndex]?.fileName === expected
  ), { itemIndex: index, expected: fileName });
}

function findActiveLeaseDirectories(dataRoot) {
  const active = [];
  if (!fs.existsSync(dataRoot)) return active;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name.endsWith('.lock') && fs.readdirSync(absolute).length > 0) active.push(absolute);
      visit(absolute);
    }
  };
  visit(dataRoot);
  return active.sort();
}

function fixtureBaseRoot() {
  const configured = process.env.SURDET_E2E_TEMP_ROOT?.trim();
  const root = configured ? path.resolve(configured) : os.tmpdir();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

async function run() {
  const fixtureRoot = fs.mkdtempSync(path.join(fixtureBaseRoot(), 'surdet-asset-import-e2e-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const wrongProjectRoot = path.join(fixtureRoot, 'wrong-project');
  const dataRoot = path.join(fixtureRoot, 'agent-data');
  const sourceRoot = path.join(fixtureRoot, 'sources');
  const artifactRoot = path.join(fixtureRoot, 'artifact');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  copyProjectFixture(projectRoot, { includeTests: false });
  copyProjectFixture(wrongProjectRoot);
  const nestedChallengeLikePath = path.join(projectRoot, 'content', '.surdet-bind-nested-sentinel.txt');
  fs.mkdirSync(path.dirname(nestedChallengeLikePath), { recursive: true });
  fs.writeFileSync(nestedChallengeLikePath, 'nested challenge-like project file\n', 'utf8');

  const sourceImage = path.join(sourceRoot, 'castle_hall.svg');
  const sourceSound = path.join(sourceRoot, 'asset-import-click.wav');
  fs.writeFileSync(sourceImage, svgBytes('asset import scene'));
  fs.writeFileSync(sourceSound, wavBytes());
  const sourceIdentities = [readFileIdentity(sourceImage), readFileIdentity(sourceSound)];

  const evidencePath = path.join(artifactRoot, 'evidence.json');
  const identityPath = path.join(artifactRoot, 'identity.json');
  const registeredRootChallengeNames = new Set();
  const runnerSha256 = sha256(fs.readFileSync(runnerPath));
  const runHead = gitOutput(['rev-parse', 'HEAD']).trim();
  const repositoryTreeBefore = repositoryTreeIdentity();
  const originalStarterBefore = hashProjectTree(starterRoot);
  const projectBefore = hashCanonicalProjectTree(projectRoot, registeredRootChallengeNames);
  const milestones = [];
  const completedMilestoneNames = [];
  const channels = {
    errors: [], consoleErrors: [], pageErrors: [], requestFailures: [], responseFailures: [],
    expectedBusinessResponses: [], expectedConsoleErrors: [], unhandledErrors: [], stderrLines: [],
    childCleanupFailures: [], activeLeaseDirectories: [],
  };
  const tokenEvidence = {
    bindingTokenHashes: { 'before-reload': new Set(), 'after-reload': new Set() },
    operationTokenHashes: { 'before-reload': new Set(), 'after-reload': new Set() },
  };
  const phaseRef = { value: 'before-reload' };
  const pendingHeaderReads = [];
  const serverStdout = [];
  let server = null;
  let browser = null;
  let page = null;
  let port = null;
  let portReleased = false;
  let browserClosed = false;
  let failure = null;
  let committedProject = null;
  let projectAfter = null;
  let originalStarterAfter = null;
  let repositoryTreeAfter = null;
  let operationEvidence = null;
  let receiptReloadEvidence = null;
  let undoEvidence = null;

  const pass = (name, evidence = {}) => {
    const expected = MILESTONE_IDS[completedMilestoneNames.length];
    assert(name === expected, `milestone sequence mismatch: expected ${expected}, got ${name}`);
    completedMilestoneNames.push(name);
    milestones.push({ name, status: 'PASSED', evidence });
  };

  try {
    port = await chooseStrictPort();
    assert(port !== 4173 && port !== 4175, `reserved port selected: ${port}`);
    pass('strict-isolated-port-selected', {
      loopback: '127.0.0.1', port, range: SEARCH_RANGE, forbiddenPorts: [4173, 4175],
    });
    const unsafeTreeRoot = path.join(fixtureRoot, 'unsafe-tree-probe');
    const unsafeTreeTarget = path.join(unsafeTreeRoot, 'target');
    const unsafeTreeLink = path.join(unsafeTreeRoot, 'linked-node');
    fs.mkdirSync(unsafeTreeTarget, { recursive: true });
    fs.writeFileSync(path.join(unsafeTreeTarget, 'sentinel.txt'), 'unsafe tree sentinel\n', 'utf8');
    fs.symlinkSync(unsafeTreeTarget, unsafeTreeLink, process.platform === 'win32' ? 'junction' : 'dir');
    let unsafeTreeError = '';
    try {
      hashCanonicalProjectTree(unsafeTreeRoot);
    } catch (error) {
      unsafeTreeError = errorText(error);
    }
    assert(unsafeTreeError.includes('unsupported symbolic link, junction, or other project tree node'),
      `unsafe project tree node was not rejected: ${unsafeTreeError}`);
    pass('unsafe-project-tree-node-rejected', {
      nodeType: process.platform === 'win32' ? 'junction' : 'directory-symlink',
      relativePath: path.basename(unsafeTreeLink),
      error: unsafeTreeError,
    });
    const nestedChallengeLikeRelativePath = path.relative(projectRoot, nestedChallengeLikePath).split(path.sep).join('/');
    assert(projectBefore.files.some((file) => file.path === nestedChallengeLikeRelativePath),
      `nested challenge-like file was omitted from project evidence: ${nestedChallengeLikeRelativePath}`);

    const launcher = path.join(editorRoot, 'scripts', 'dev-project.mjs');
    const launcherBootstrap = `
      const { startDevProject } = await import(${JSON.stringify(pathToFileURL(launcher).href)});
      const server = await startDevProject(process.argv.slice(1), {
        registerSignals: false,
        cacheDir: ${JSON.stringify(path.join(fixtureRoot, 'vite-cache'))},
      });
      process.send?.({ type: 'ready' });
      let closing = false;
      process.on('message', (message) => {
        if (message?.type !== 'shutdown' || closing) return;
        closing = true;
        void server.close().then(() => process.exit(0), (error) => {
          process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error) + '\\n');
          process.exit(1);
        });
      });
    `;
    server = spawn(process.execPath, [
      '--input-type=module', '--eval', launcherBootstrap,
      '--',
      '--project', projectRoot,
      '--data-root', dataRoot,
      '--port', String(port),
    ], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', NO_UPDATE_NOTIFIER: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    server.stdout.setEncoding('utf8');
    server.stderr.setEncoding('utf8');
    server.stdout.on('data', (chunk) => serverStdout.push(chunk));
    server.stderr.on('data', (chunk) => channels.stderrLines.push(...chunk.split(/\r?\n/).filter(Boolean)));
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHttp(server, `${baseUrl}/index.html`);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observePage(page, channels, tokenEvidence, phaseRef, pendingHeaderReads);
    await page.addInitScript(() => {
      window.__surdetE2eUnhandled = [];
      const describe = (value) => ({
        name: typeof value?.name === 'string' ? value.name : null,
        message: typeof value?.message === 'string' ? value.message : String(value),
        stack: typeof value?.stack === 'string' ? value.stack : null,
      });
      window.addEventListener('error', (event) => {
        window.__surdetE2eUnhandled.push({ type: 'error', ...describe(event.error ?? event.message) });
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__surdetE2eUnhandled.push({ type: 'unhandledrejection', ...describe(event.reason) });
      });
    });
    await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({
      project: projectRoot,
      wrong: wrongProjectRoot,
    }));
    await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });

    await openProject(page, 'wrong', 'mismatch');
    const mismatch = await workspaceSnapshot(page);
    assert(mismatch.entryState === 'mismatch', `wrong directory was not rejected: ${JSON.stringify(mismatch)}`);
    pass('wrong-directory-rejected', {
      entryState: mismatch.entryState,
      message: mismatch.message,
      wrongProjectRoot: path.resolve(wrongProjectRoot),
    });

    const rejectedChallengeProbePaths = fs.readdirSync(projectRoot)
      .filter((name) => name.startsWith('.surdet-bind-'));
    assert(rejectedChallengeProbePaths.length === 1,
      `expected one rejected challenge probe before binding, got ${rejectedChallengeProbePaths}`);
    for (const challengeName of rejectedChallengeProbePaths) registeredRootChallengeNames.add(challengeName);
    const projectRootEntriesBeforeBinding = new Set(fs.readdirSync(projectRoot));
    await openProject(page, 'project', 'ready');
    const bound = await workspaceSnapshot(page);
    assert(bound.entryState === 'ready', `project did not bind: ${JSON.stringify(bound)}`);
    assert(bound.projectName === path.basename(projectRoot), `bound project name drifted: ${bound.projectName}`);
    const newProbePathsAfterBinding = fs.readdirSync(projectRoot)
      .filter((name) => name.startsWith('.surdet-bind-') && !projectRootEntriesBeforeBinding.has(name));
    assert(newProbePathsAfterBinding.length === 0,
      `successful challenge probe was not removed: ${newProbePathsAfterBinding}`);
    const retainedRootChallengePaths = fs.readdirSync(projectRoot)
      .filter((name) => name.startsWith('.surdet-bind-'));
    assert(JSON.stringify(retainedRootChallengePaths.sort()) === JSON.stringify(rejectedChallengeProbePaths.sort()),
      `rejected challenge evidence changed during successful binding: ${retainedRootChallengePaths}`);
    pass('project-bound-cleanly', {
      entryState: bound.entryState,
      projectIdentity: bound.projectIdentity,
      projectName: bound.projectName,
      successfulChallengeRemoved: true,
      rejectedChallengeProbeRetainedFailClosed: retainedRootChallengePaths,
    });

    await openImportWorkbench(page);
    const rejectedDropProbe = await page.locator('.asset-import-picker').evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.setData('text/uri-list', 'https://example.com/not-an-asset');
      const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      element.dispatchEvent(dragOver);
      element.dispatchEvent(drop);
      return {
        dragOverDefaultPrevented: dragOver.defaultPrevented,
        dropDefaultPrevented: drop.defaultPrevented,
      };
    });
    assert(rejectedDropProbe.dragOverDefaultPrevented && rejectedDropProbe.dropDefaultPrevented,
      `rejected drop was not safely contained: ${JSON.stringify(rejectedDropProbe)}`);
    assert((await workspaceSnapshot(page)).draftItems.length === 0, 'rejected drop changed the draft');
    const droppedFiles = [
      {
        name: path.basename(sourceImage),
        type: 'image/svg+xml',
        base64: fs.readFileSync(sourceImage).toString('base64'),
      },
      {
        name: path.basename(sourceSound),
        type: 'audio/wav',
        base64: fs.readFileSync(sourceSound).toString('base64'),
      },
    ];
    const dataTransfer = await page.evaluateHandle((files) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const binary = atob(file.base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      return transfer;
    }, droppedFiles);
    try {
      const dropSurface = page.locator('.asset-import-picker');
      await dropSurface.dispatchEvent('dragenter', { dataTransfer });
      await dropSurface.dispatchEvent('dragover', { dataTransfer });
      await dropSurface.dispatchEvent('drop', { dataTransfer });
    } finally {
      await dataTransfer.dispose();
    }
    await page.waitForFunction(() => window.surdetEditorDebug.state.assetImportWorkspace?.draftItems.length === 2);
    assert(await page.getByText('素材分类', { exact: true }).count() === 2, '素材分类 fields were not rendered for both files');
    assert(await page.getByText('最终名称', { exact: true }).count() === 2, '最终名称 fields were not rendered for both files');
    await setCategory(page, 0, 'background');
    await setCategory(page, 1, 'sound-effect');
    const selected = await workspaceSnapshot(page);
    assert(selected.draftItems[0]?.sourceName === 'castle_hall.svg', 'first selected source drifted');
    assert(selected.draftItems[1]?.sourceName === 'asset-import-click.wav', 'second selected source drifted');
    pass('multi-file-selected', { items: selected.draftItems, sourceIdentities });

    const existingTarget = path.join(projectRoot, 'content', 'assets', 'bg', 'castle_hall.svg');
    const existingTargetBefore = readFileIdentity(existingTarget);
    await page.locator('.asset-import-primary', { hasText: '准备导入' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.plan?.status === 'blocked'
    ));
    const blocked = await workspaceSnapshot(page);
    assert(blocked.operation.plan.issues.includes('IMPORT_TARGET_EXISTS'), 'collision did not report IMPORT_TARGET_EXISTS');
    const lockedDropProbe = await page.locator('.asset-import-picker').evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['locked'], 'locked.txt', { type: 'text/plain' }));
      const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      element.dispatchEvent(dragOver);
      element.dispatchEvent(drop);
      return {
        dragOverDefaultPrevented: dragOver.defaultPrevented,
        dropDefaultPrevented: drop.defaultPrevented,
      };
    });
    assert(lockedDropProbe.dragOverDefaultPrevented && lockedDropProbe.dropDefaultPrevented,
      `locked drop was not safely contained: ${JSON.stringify(lockedDropProbe)}`);
    assert((await workspaceSnapshot(page)).draftItems.length === 2, 'locked drop changed the draft');
    assert(readFileIdentity(existingTarget).sha256 === existingTargetBefore.sha256, 'collision overwrote existing target');
    assert((await page.locator('.asset-import-primary').textContent())?.includes('重新检查'), 'blocked plan did not expose recheck action');
    pass('collision-blocked-without-overwrite', {
      code: 'IMPORT_TARGET_EXISTS',
      issues: blocked.operation.plan.issues,
      existingTargetBefore,
      existingTargetAfter: readFileIdentity(existingTarget),
      overwritePerformed: false,
    });

    await setFinalName(page, 0, 'asset-import-scene-staged.svg');
    await page.locator('.asset-import-primary', { hasText: '准备导入' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.plan?.status === 'ready'
        && ['STAGED', 'READY'].includes(window.surdetEditorDebug.state.assetImportWorkspace.activeOperation.operation.status)
    ));
    const readyBeforeTargetEdit = await workspaceSnapshot(page);
    const readyPlanFingerprint = readyBeforeTargetEdit.operation?.plan?.planFingerprint ?? null;
    assert(readyPlanFingerprint !== null, 'ready import plan fingerprint was not exposed before target edit');
    await setFinalName(page, 0, 'asset-import-scene.svg');
    await page.waitForFunction(() => {
      const workspace = window.surdetEditorDebug.state.assetImportWorkspace;
      const primary = document.querySelector('.asset-import-primary');
      return workspace?.activeOperation?.plan === null
        && !(primary?.textContent ?? '').includes('确认导入');
    });
    const invalidated = await workspaceSnapshot(page);
    assert(invalidated.operation?.plan === null, 'editing the target kept the old import plan');
    const primaryTextAfterEdit = await page.locator('.asset-import-primary').textContent();
    assert(!primaryTextAfterEdit?.includes('确认导入'),
      'editing the target left the old confirmation entry point enabled');
    pass('ready-plan-invalidated-after-target-edit', {
      previousPlanFingerprint: readyPlanFingerprint,
      currentPlan: null,
      confirmationEntryPoint: 'disabled-until-replanned',
      editedFileName: invalidated.draftItems[0]?.fileName ?? null,
    });
    await page.locator('.asset-import-primary', { hasText: '准备导入' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.plan?.status === 'ready'
        && ['STAGED', 'READY'].includes(window.surdetEditorDebug.state.assetImportWorkspace.activeOperation.operation.status)
    ));
    const replanned = await workspaceSnapshot(page);
    assert(replanned.operation?.plan?.planFingerprint !== readyPlanFingerprint,
      'replanning after target edit reused the old plan fingerprint');
    await page.locator('.asset-import-primary', { hasText: '确认导入' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.operation?.status === 'COMMITTED'
        && window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.receipt !== null
        && window.surdetEditorDebug.state.assetImportWorkspace?.message === '导入完成'
    ));
    const committed = await workspaceSnapshot(page);
    const receipt = committed.operation.receipt;
    assert(receipt.files.length === 2, `expected two receipt files, got ${receipt.files.length}`);
    const targetByName = new Map(receipt.files.map((file) => [path.basename(file.targetPath), file]));
    const importedImage = path.join(projectRoot, ...(targetByName.get('asset-import-scene.svg').targetPath.split('/')));
    const importedSound = path.join(projectRoot, ...(targetByName.get('asset-import-click.wav').targetPath.split('/')));
    assert(readFileIdentity(importedImage).sha256 === sourceIdentities[0].sha256, 'imported image bytes drifted');
    assert(readFileIdentity(importedSound).sha256 === sourceIdentities[1].sha256, 'imported sound bytes drifted');
    committedProject = hashCanonicalProjectTree(projectRoot, registeredRootChallengeNames);
    assert(committedProject.sha256 !== projectBefore.sha256, 'commit did not change isolated project content');
    operationEvidence = {
      operationId: committed.operation.operationId,
      receiptId: receipt.receiptId,
      receiptSha256: receipt.receiptSha256,
      files: receipt.files,
      importedImage: readFileIdentity(importedImage),
      importedSound: readFileIdentity(importedSound),
    };
    pass('multi-file-import-committed', operationEvidence);

    await page.waitForFunction(() => {
      const ids = (window.surdetEditorDebug.state.assetIntelligence?.items ?? []).map((item) => item.assetId);
      return ids.includes('file:content/assets/bg/asset-import-scene.svg')
        && ids.includes('file:content/assets/se/asset-import-click.wav');
    });
    const importedAssetIds = await page.evaluate(() => (
      window.surdetEditorDebug.state.assetIntelligence.items
        .map((item) => item.assetId)
        .filter((id) => id.includes('asset-import-'))
        .sort()
    ));
    pass('asset-facts-refreshed', { importedAssetIds });

    phaseRef.value = 'after-reload';
    await page.reload({ waitUntil: 'networkidle' });
    await openProject(page, 'project', 'ready');
    await openImportWorkbench(page);
    await page.locator('.asset-import-receipt-row', { hasText: '2 个文件' }).getByRole('button', { name: '查看导入回执' }).click();
    await page.waitForFunction((operationId) => (
      window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.operation?.operationId === operationId
        && window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.receipt !== null
        && window.surdetEditorDebug.state.assetImportWorkspace?.message === '已读取导入回执。'
    ), operationEvidence.operationId);
    const reopened = await workspaceSnapshot(page);
    assert(reopened.operation.receipt.receiptSha256 === operationEvidence.receiptSha256, 'reopened receipt identity drifted');
    await Promise.all(pendingHeaderReads);
    const beforeBindings = tokenEvidence.bindingTokenHashes['before-reload'];
    const afterBindings = tokenEvidence.bindingTokenHashes['after-reload'];
    assert(beforeBindings.size > 0 && afterBindings.size > 0, 'binding token hashes were not observed on both sides of reload');
    assert([...afterBindings].every((hash) => !beforeBindings.has(hash)), 'old tokens were reused after reload');
    receiptReloadEvidence = {
      operationId: reopened.operation.operationId,
      receiptSha256: reopened.operation.receipt.receiptSha256,
      oldTokensAbsent: true,
      tokenRotated: true,
      bindingTokenHashes: {
        beforeReload: [...beforeBindings].sort(),
        afterReload: [...afterBindings].sort(),
      },
    };
    pass('receipt-reopened-after-reload', receiptReloadEvidence);

    const originalImportedImage = fs.readFileSync(importedImage);
    fs.appendFileSync(importedImage, '\n<!-- changed after import -->\n', 'utf8');
    const expectedUndoResponse = page.waitForResponse((response) => (
      response.status() === 409 && new URL(response.url()).pathname.endsWith('/undo')
    ));
    await page.getByRole('button', { name: '撤销本次导入' }).click();
    const undoResponse = await expectedUndoResponse;
    const undoEnvelope = await undoResponse.json();
    assert(undoEnvelope?.ok === false
      && undoEnvelope?.error?.code === 'IMPORT_UNDO_BLOCKED_CHANGED',
    `unexpected undo rejection envelope: ${JSON.stringify(undoEnvelope)}`);
    assert(channels.expectedBusinessResponses.length === 1, `unexpected 409 count: ${channels.expectedBusinessResponses.length}`);
    channels.expectedBusinessResponses[0].code = undoEnvelope.error.code;
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.assetImportWorkspace?.message === '导入后的文件已被修改，不能自动撤销。'
    ));
    assert(fs.existsSync(importedImage) && fs.existsSync(importedSound), 'blocked undo changed the batch');
    pass('modified-file-undo-blocked', {
      code: 'IMPORT_UNDO_BLOCKED_CHANGED',
      message: (await workspaceSnapshot(page)).message,
      batchPreserved: true,
      expectedBusinessResponses: [...channels.expectedBusinessResponses],
    });

    fs.writeFileSync(importedImage, originalImportedImage);
    await page.getByRole('button', { name: '撤销本次导入' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.operation?.status === 'UNDONE'
        && window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.undoReceipt !== null
        && window.surdetEditorDebug.state.assetImportWorkspace?.message === '已撤销，恢复副本仍由 Surdet 保留。'
    ));
    await page.waitForFunction(() => {
      const ids = (window.surdetEditorDebug.state.assetIntelligence?.items ?? []).map((item) => item.assetId);
      return !ids.includes('file:content/assets/bg/asset-import-scene.svg')
        && !ids.includes('file:content/assets/se/asset-import-click.wav');
    });
    assert(!fs.existsSync(importedImage) && !fs.existsSync(importedSound), 'successful undo left imported targets visible');
    const undone = await workspaceSnapshot(page);
    projectAfter = hashCanonicalProjectTree(projectRoot, registeredRootChallengeNames);
    assert(projectAfter.sha256 === projectBefore.sha256, 'isolated project content did not return to baseline after undo');
    undoEvidence = {
      operationId: undone.operation.operationId,
      undoReceipt: undone.operation.undoReceipt,
      targetsRemoved: true,
      assetFactsRestored: true,
      projectBefore: projectBefore.sha256,
      projectAfter: projectAfter.sha256,
    };
    pass('unchanged-file-undo-succeeded', undoEvidence);

    const quarantine = undone.operation.undoReceipt.quarantinePaths.map((relativePath) => {
      const absolute = path.join(projectRoot, ...relativePath.split('/'));
      assert(fs.existsSync(absolute), `undo quarantine missing: ${relativePath}`);
      return readFileIdentity(absolute);
    });
    const quarantineHashes = quarantine.map((entry) => entry.sha256).sort();
    assert(quarantine.length === 2, `expected two retained quarantine files, got ${quarantine.length}`);
    assert(quarantineHashes.includes(sourceIdentities[0].sha256) && quarantineHashes.includes(sourceIdentities[1].sha256), 'quarantine bytes do not match imported sources');
    pass('undo-quarantine-retained', { paths: undone.operation.undoReceipt.quarantinePaths, files: quarantine });

    const importEntry = page.locator('.asset-import-entry');
    if (await importEntry.getAttribute('aria-expanded') === 'true') await importEntry.click();
    const relocationSource = path.join(projectRoot, 'content', 'assets', 'bg', 'castle_hall.svg');
    const relocationCollision = path.join(projectRoot, 'content', 'assets', 'bg', 'night_field.svg');
    const relocationTarget = path.join(projectRoot, 'content', 'assets', 'bg', 'castle_hall_arrival.svg');
    const relocationSourceBefore = fs.readFileSync(relocationSource);
    const collisionBefore = fs.readFileSync(relocationCollision);
    await page.locator('[data-asset-id="file:content/assets/bg/castle_hall.svg"]').click();
    await page.getByRole('button', { name: '移动或重命名' }).click();
    const relocationName = page.locator('.asset-relocation-file-control input');
    await relocationName.fill('night_field');
    await page.getByRole('button', { name: '检查影响' }).click();
    await page.locator('.asset-relocation-blockers').waitFor({ state: 'visible' });
    assert((await page.locator('.asset-relocation-blockers').textContent())?.includes('目标'),
      'target collision was not explained in the relocation inspector');
    assert(fs.readFileSync(relocationSource).equals(relocationSourceBefore), 'blocked relocation changed its source');
    assert(fs.readFileSync(relocationCollision).equals(collisionBefore), 'blocked relocation changed the existing target');
    pass('relocation-target-collision-blocked', { sourcePreserved: true, targetPreserved: true });

    await page.getByRole('button', { name: '修改目标' }).click();
    await page.waitForFunction(() => {
      const input = document.querySelector('.asset-relocation-file-control input');
      return input instanceof HTMLInputElement && !input.disabled
        && document.querySelector('.asset-relocation-blockers') === null;
    });
    await relocationName.fill('castle_hall_arrival');
    await page.getByRole('button', { name: '检查影响' }).click();
    const relocationCommitButton = page.getByRole('button', { name: /移动并更新 \d+ 处引用/ });
    await relocationCommitButton.waitFor({ state: 'visible' });
    const impactText = await page.locator('.asset-relocation-impact').textContent();
    for (const label of ['场景', '时间轴', '鉴赏配置']) {
      assert(impactText?.includes(label), `relocation impact omitted ${label}`);
    }
    pass('relocation-impact-previewed', { groups: ['scene', 'timeline', 'gallery'] });

    await relocationCommitButton.click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.mainTab === 'assets'
        && window.surdetEditorDebug.state.assetCenterSelectedId === 'file:content/assets/bg/castle_hall_arrival.svg'
        && window.surdetEditorDebug.state.projectWriteLock === null
    ));
    await page.locator('.asset-relocation-result', { hasText: '素材整理完成' }).waitFor({ state: 'visible' });
    assert(!fs.existsSync(relocationSource), 'relocation source remained after commit');
    assert(fs.existsSync(relocationTarget), 'relocation target was not created');
    assert(fs.readFileSync(relocationTarget).equals(relocationSourceBefore), 'relocation changed binary bytes');
    for (const relativePath of [
      'content/scenario/ch02.gal',
      'content/timelines/intro_arrival.json',
      'content/timelines/intro_cinematic.json',
      'content/config/gallery.json',
    ]) {
      const text = fs.readFileSync(path.join(projectRoot, ...relativePath.split('/')), 'utf8');
      assert(text.includes('castle_hall_arrival'), `relocation did not update ${relativePath}`);
      assert(!text.includes('castle_hall"') && !text.includes('castle_hall\n'), `old key remained in ${relativePath}`);
    }
    pass('referenced-asset-relocated-and-reloaded', { targetPath: 'content/assets/bg/castle_hall_arrival.svg' });

    await page.locator('.asset-center-reference[data-source-path="content/scenario/ch02.gal"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug.state.current === 'ch02');
    await page.locator('[data-editor-mode="preview"]').click();
    const relocationPreviewElement = await page.locator('#preview-view .preview-frame').elementHandle();
    const relocationPreviewFrame = await relocationPreviewElement?.contentFrame();
    assert(relocationPreviewFrame, 'relocated scene preview iframe was not connected');
    await relocationPreviewFrame.waitForURL((url) => url.pathname.endsWith('/preview.html'));
    try {
      await relocationPreviewFrame.waitForFunction((backgroundKey) => (
        window.surdetPreviewDebug?.presentationSnapshot?.stage?.backgroundKey === backgroundKey
      ), 'castle_hall_arrival');
    } catch (error) {
      const previewProbe = {
        parent: await page.evaluate(() => ({
          current: window.surdetEditorDebug?.state?.current ?? null,
          trace: (window.surdetEditorDebug?.state?.previewTrace ?? []).map((event) => ({
            kind: event.kind,
            sceneId: event.source?.sceneId ?? null,
            op: event.source?.op ?? null,
            line: event.source?.line ?? null,
          })),
          diagnostics: document.querySelector('.preview-diagnostics')?.textContent ?? null,
        })),
        child: await relocationPreviewFrame.evaluate(() => ({
          href: location.href,
          readyState: document.readyState,
          debugPresent: Boolean(window.surdetPreviewDebug),
          rendererStatus: window.surdetPreviewDebug?.rendererStatus ?? null,
          presentationSnapshot: window.surdetPreviewDebug?.presentationSnapshot ?? null,
          resourceSnapshot: window.surdetPreviewDebug?.resourceSnapshot ?? null,
          canvasCount: document.querySelectorAll('#preview-root canvas').length,
          moduleScripts: [...document.querySelectorAll('script[type="module"]')].map((script) => script.src),
          unhandled: window.__surdetE2eUnhandled ?? [],
          errorText: document.querySelector('#preview-error')?.textContent ?? null,
        })),
      };
      throw new Error(`relocated scene presentation missing: ${JSON.stringify(previewProbe)}`, { cause: error });
    }
    await page.waitForFunction(() => (
      (window.surdetEditorDebug.state.previewTrace ?? []).some((event) => (
        event?.source?.sceneId === 'ch02'
          && event?.source?.op === 'instr'
          && event?.source?.line === 3
      ))
    ));
    pass('relocated-scene-previewed', { sceneId: 'ch02', backgroundKey: 'castle_hall_arrival' });

    await page.locator('[data-editor-mode="assets"]').click();
    await page.locator('.asset-relocation-result', { hasText: '素材整理完成' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '撤销本次整理' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.mainTab === 'assets'
        && window.surdetEditorDebug.state.assetCenterSelectedId === 'file:content/assets/bg/castle_hall.svg'
        && window.surdetEditorDebug.state.projectWriteLock === null
    ));
    assert(fs.existsSync(relocationSource), 'relocation undo did not restore source');
    assert(!fs.existsSync(relocationTarget), 'relocation undo left target behind');
    assert(fs.readFileSync(relocationSource).equals(relocationSourceBefore), 'relocation undo changed source bytes');
    for (const relativePath of [
      'content/scenario/ch02.gal',
      'content/timelines/intro_arrival.json',
      'content/timelines/intro_cinematic.json',
      'content/config/gallery.json',
    ]) {
      const text = fs.readFileSync(path.join(projectRoot, ...relativePath.split('/')), 'utf8');
      assert(text.includes('castle_hall'), `relocation undo did not restore ${relativePath}`);
      assert(!text.includes('castle_hall_arrival'), `relocation undo left new key in ${relativePath}`);
    }
    projectAfter = hashCanonicalProjectTree(projectRoot, registeredRootChallengeNames);
    assert(projectAfter.sha256 === projectBefore.sha256, 'relocation undo did not restore the isolated project baseline');
    pass('asset-relocation-undo-succeeded', { sourceRestored: true, targetRemoved: true, referencesRestored: true });

    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: '批量整理' }).click();
    const castleRow = page.locator('[data-asset-id="file:content/assets/bg/castle_hall.svg"]');
    const nightRow = page.locator('[data-asset-id="file:content/assets/bg/night_field.svg"]');
    await castleRow.locator('input[type="checkbox"]').check();
    await nightRow.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: '整理所选' }).click();
    await page.locator('.asset-relocation-batch-items > summary').click();
    await page.getByRole('textbox', { name: 'castle_hall.svg 整理后的文件名' }).fill('night_field');
    await page.getByRole('textbox', { name: 'night_field.svg 整理后的文件名' }).fill('castle_hall');
    await page.getByRole('button', { name: '检查整批影响' }).click();
    const batchCommitButton = page.getByRole('button', { name: /整理 2 个素材并更新 \d+ 处引用/ });
    await batchCommitButton.waitFor({ state: 'visible' });
    const batchImpactText = await page.locator('.asset-relocation-impact').textContent();
    assert(batchImpactText?.includes('将整理 2 个素材'), 'batch impact did not explain the two selected assets');
    for (const label of ['场景', '时间轴', '鉴赏配置']) {
      assert(batchImpactText?.includes(label), `batch relocation impact omitted ${label}`);
    }
    pass('batch-relocation-impact-previewed', { assets: 2, groups: ['scene', 'timeline', 'gallery'] });

    await page.setViewportSize({ width: 800, height: 900 });
    await batchCommitButton.scrollIntoViewIfNeeded();
    const narrowLayout = await page.evaluate(() => {
      const documentElement = document.documentElement;
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.includes('整理 2 个素材并更新'));
      const rect = button?.getBoundingClientRect() ?? null;
      return {
        noHorizontalOverflow: documentElement.scrollWidth <= documentElement.clientWidth,
        buttonVisible: rect !== null && rect.width > 0 && rect.height > 0
          && rect.left >= 0 && rect.right <= documentElement.clientWidth
          && rect.top >= 0 && rect.bottom <= window.innerHeight,
      };
    });
    assert(narrowLayout.noHorizontalOverflow, 'batch relocation introduced horizontal overflow at 800px');
    assert(narrowLayout.buttonVisible, 'batch relocation action was not reachable at 800px');
    pass('batch-relocation-800px-readable', narrowLayout);
    await page.setViewportSize({ width: 1440, height: 900 });

    await batchCommitButton.click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.mainTab === 'assets'
        && window.surdetEditorDebug.state.assetCenterSelectedId === 'file:content/assets/bg/night_field.svg'
        && window.surdetEditorDebug.state.projectWriteLock === null
    ));
    await page.locator('.asset-relocation-result', { hasText: '素材整理完成（2 项）' }).waitFor({ state: 'visible' });
    assert(fs.readFileSync(relocationSource).equals(collisionBefore), 'batch swap did not exchange castle_hall bytes');
    assert(fs.readFileSync(relocationCollision).equals(relocationSourceBefore), 'batch swap did not exchange night_field bytes');
    const ch02AfterSwap = fs.readFileSync(path.join(projectRoot, 'content', 'scenario', 'ch02.gal'), 'utf8');
    const ch01AfterSwap = fs.readFileSync(path.join(projectRoot, 'content', 'scenario', 'ch01_02.gal'), 'utf8');
    const ch03AfterSwap = fs.readFileSync(path.join(projectRoot, 'content', 'scenario', 'ch03_turn_event.gal'), 'utf8');
    assert(ch02AfterSwap.includes('@bg night_field'), 'batch swap did not update ch02 to night_field');
    assert(ch01AfterSwap.includes('@bg castle_hall'), 'batch swap did not update ch01_02 to castle_hall');
    assert(ch03AfterSwap.includes('@bg castle_hall'), 'batch swap did not update ch03_turn_event to castle_hall');
    for (const relativePath of ['content/timelines/intro_arrival.json', 'content/timelines/intro_cinematic.json']) {
      const timeline = fs.readFileSync(path.join(projectRoot, ...relativePath.split('/')), 'utf8');
      assert(timeline.includes('night_field'), `batch swap did not update ${relativePath}`);
      assert(!timeline.includes('castle_hall'), `batch swap left the old key in ${relativePath}`);
    }
    const galleryAfterSwap = JSON.parse(fs.readFileSync(path.join(projectRoot, 'content', 'config', 'gallery.json'), 'utf8'));
    assert(galleryAfterSwap.cgs?.find((item) => item.id === 'cg_hall')?.src === 'night_field', 'batch swap did not update the hall gallery entry');
    assert(galleryAfterSwap.cgs?.find((item) => item.id === 'cg_field')?.src === 'castle_hall', 'batch swap did not update the field gallery entry');
    pass('referenced-batch-swap-committed-and-reloaded', { assets: 2, referencesUpdated: true });

    await page.locator('.asset-center-reference[data-source-path="content/scenario/ch02.gal"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug.state.current === 'ch02');
    await page.locator('[data-editor-mode="preview"]').click();
    const batchPreviewElement = await page.locator('#preview-view .preview-frame').elementHandle();
    const batchPreviewFrame = await batchPreviewElement?.contentFrame();
    assert(batchPreviewFrame, 'batch-swapped scene preview iframe was not connected');
    await batchPreviewFrame.waitForURL((url) => url.pathname.endsWith('/preview.html'));
    await batchPreviewFrame.waitForFunction((backgroundKey) => (
      window.surdetPreviewDebug?.presentationSnapshot?.stage?.backgroundKey === backgroundKey
    ), 'night_field');
    pass('batch-swapped-scene-previewed', { sceneId: 'ch02', backgroundKey: 'night_field' });

    await page.locator('[data-editor-mode="assets"]').click();
    await page.locator('.asset-relocation-result', { hasText: '素材整理完成（2 项）' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '撤销整批整理' }).click();
    await page.waitForFunction(() => (
      window.surdetEditorDebug.state.mainTab === 'assets'
        && window.surdetEditorDebug.state.assetCenterSelectedId === 'file:content/assets/bg/castle_hall.svg'
        && window.surdetEditorDebug.state.projectWriteLock === null
    ));
    assert(fs.readFileSync(relocationSource).equals(relocationSourceBefore), 'batch relocation undo did not restore castle_hall bytes');
    assert(fs.readFileSync(relocationCollision).equals(collisionBefore), 'batch relocation undo did not restore night_field bytes');
    projectAfter = hashCanonicalProjectTree(projectRoot, registeredRootChallengeNames);
    assert(projectAfter.sha256 === projectBefore.sha256, 'batch relocation undo did not restore the isolated project baseline');
    pass('batch-relocation-undo-succeeded', { assetsRestored: true, referencesRestored: true });

    originalStarterAfter = hashProjectTree(starterRoot);
    repositoryTreeAfter = repositoryTreeIdentity();
    assert(originalStarterAfter.sha256 === originalStarterBefore.sha256, 'original Starter changed');
    assert(repositoryTreeAfter.sha256 === repositoryTreeBefore.sha256, 'repository changed during isolated runner');
    pass('repository-and-starter-unchanged', {
      originalStarterBefore,
      originalStarterAfter,
      repositoryTreeBefore,
      repositoryTreeAfter,
      projectMutation: { occurred: true, committed: true, finalCanonicalMutation: false },
    });

  } catch (error) {
    failure = error;
    channels.errors.push(errorText(error));
  } finally {
    if (page !== null) {
      for (const frame of page.frames()) {
        try {
          const frameUnhandled = await frame.evaluate(() => window.__surdetE2eUnhandled ?? []);
          channels.unhandledErrors.push(...frameUnhandled.map((entry) => ({
            frameUrl: frame.url(),
            ...entry,
          })));
        } catch (error) {
          channels.unhandledErrors.push({
            frameUrl: frame.url(),
            type: 'collection-failed',
            message: errorText(error),
          });
        }
      }
      await page.close().catch((error) => channels.childCleanupFailures.push(`page close: ${errorText(error)}`));
    }
    if (browser !== null) {
      await browser.close().then(() => { browserClosed = true; })
        .catch((error) => channels.childCleanupFailures.push(`browser close: ${errorText(error)}`));
    }
    await stopServer(server, channels.childCleanupFailures);
    if (port !== null) portReleased = await portIsAvailable(port);
    channels.activeLeaseDirectories = findActiveLeaseDirectories(dataRoot);
    await Promise.allSettled(pendingHeaderReads);
    await new Promise((resolve) => setImmediate(resolve));
    originalStarterAfter = hashProjectTree(starterRoot);
    repositoryTreeAfter = repositoryTreeIdentity();

    if (failure === null) {
      try {
        const beforeOperations = tokenEvidence.operationTokenHashes['before-reload'];
        const afterOperations = tokenEvidence.operationTokenHashes['after-reload'];
        assert(beforeOperations.size > 0 && afterOperations.size > 0,
          'operation token hashes were not observed on both sides of reload');
        assert([...afterOperations].every((hash) => !beforeOperations.has(hash)),
          'old operation token was reused after reload');
        if (channels.expectedBusinessResponses.length === 1
          && channels.expectedBusinessResponses[0]?.code === 'IMPORT_UNDO_BLOCKED_CHANGED'
          && channels.consoleErrors.length === 1
          && channels.consoleErrors[0] === EXPECTED_UNDO_CONSOLE_ERROR) {
          channels.expectedConsoleErrors.push(channels.consoleErrors.shift());
        }
        assert(channels.errors.length === 0, `runner errors: ${channels.errors.join(' | ')}`);
        assert(channels.consoleErrors.length === 0, `console errors: ${channels.consoleErrors.join(' | ')}`);
        assert(channels.pageErrors.length === 0, `page errors: ${channels.pageErrors.join(' | ')}`);
        assert(channels.requestFailures.length === 0, `request failures: ${channels.requestFailures.join(' | ')}`);
        assert(channels.responseFailures.length === 0, `response failures: ${channels.responseFailures.join(' | ')}`);
        assert(channels.unhandledErrors.length === 0,
          `unhandled browser errors: ${JSON.stringify(channels.unhandledErrors)}`);
        assert(channels.stderrLines.length === 0, `server stderr: ${channels.stderrLines.join(' | ')}`);
        assert(channels.expectedBusinessResponses.length === 1, `unexpected 409 count: ${channels.expectedBusinessResponses.length}`);
        pass('browser-error-channels-empty', {
          ...channels,
          bindingTokenHashes: {
            beforeReload: [...tokenEvidence.bindingTokenHashes['before-reload']].sort(),
            afterReload: [...tokenEvidence.bindingTokenHashes['after-reload']].sort(),
          },
          operationTokenHashes: {
            beforeReload: [...tokenEvidence.operationTokenHashes['before-reload']].sort(),
            afterReload: [...tokenEvidence.operationTokenHashes['after-reload']].sort(),
          },
          tokenRotated: true,
        });
      } catch (error) {
        failure = error;
        channels.errors.push(errorText(error));
      }
    }

    if (failure === null) {
      try {
        assert(originalStarterAfter.sha256 === originalStarterBefore.sha256, 'original Starter changed after process cleanup');
        assert(repositoryTreeAfter.sha256 === repositoryTreeBefore.sha256, 'repository changed after process cleanup');
        assert(browserClosed, 'browser did not close');
        assert(server?.exitCode !== null, 'dev-project child did not exit');
        assert(portReleased, `port ${port} was not released`);
        assert(channels.childCleanupFailures.length === 0, `cleanup failures: ${channels.childCleanupFailures.join(' | ')}`);
        assert(channels.activeLeaseDirectories.length === 0, `active leases remain: ${channels.activeLeaseDirectories.join(', ')}`);
        pass('isolated-process-cleanup', {
          browserClosed,
          serverExitCode: server?.exitCode ?? null,
          portReleased,
          activeLeaseDirectories: channels.activeLeaseDirectories,
          childCleanupFailures: channels.childCleanupFailures,
        });
      } catch (error) {
        failure = error;
        channels.errors.push(errorText(error));
      }
    }

    if (projectAfter === null) projectAfter = hashCanonicalProjectTree(projectRoot, registeredRootChallengeNames);
    const bindingTokenHashes = Object.fromEntries(Object.entries(tokenEvidence.bindingTokenHashes)
      .map(([phase, hashes]) => [phase, [...hashes].sort()]));
    const operationTokenHashes = Object.fromEntries(Object.entries(tokenEvidence.operationTokenHashes)
      .map(([phase, hashes]) => [phase, [...hashes].sort()]));
    const firstFailedNode = failure === null ? null : MILESTONE_IDS[completedMilestoneNames.length] ?? 'post-milestone-cleanup';
    const evidence = {
      schemaVersion: 1,
      evidenceClass: 'EDITOR_ASSET_IMPORT_AUTHORITY_BROWSER',
      status: failure === null ? 'PASSED' : 'FAILED',
      createdAt: new Date().toISOString(),
      runHead,
      runnerSha256,
      fixtureRoot,
      projectRoot,
      dataRoot,
      sourceRoot,
      port,
      milestones,
      completedMilestoneNames,
      lastPassedNode: completedMilestoneNames.at(-1) ?? null,
      firstFailedNode,
      failure: failure === null ? null : errorText(failure),
      operationEvidence,
      receiptReloadEvidence,
      undoEvidence,
      bindingTokenHashes,
      operationTokenHashes,
      tokenRotated: failure === null,
      channels,
      originalStarterBefore,
      originalStarterAfter,
      repositoryTreeBefore,
      repositoryTreeAfter,
      projectBefore,
      committedProject,
      projectAfter,
      projectMutation: {
        occurred: committedProject !== null && committedProject.sha256 !== projectBefore.sha256,
        finalCanonicalMutation: projectAfter.sha256 !== projectBefore.sha256,
      },
      browserClosed,
      stopServer: { attempted: server !== null, exitCode: server?.exitCode ?? null },
      portReleased,
      serverStdout,
      activeLeaseDirectories: channels.activeLeaseDirectories,
    };
    const evidenceIdentity = writeExclusiveJson(evidencePath, evidence);
    const identity = writeExclusiveJson(identityPath, {
      schemaVersion: 1,
      runHead,
      runnerSha256,
      evidence: evidenceIdentity,
    });
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      completed: `${completedMilestoneNames.length}/${MILESTONE_IDS.length}`,
      lastPassedNode: evidence.lastPassedNode,
      firstFailedNode,
      evidence: evidenceIdentity,
      identity,
    }, null, 2)}\n`);
    if (failure !== null) process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === runnerPath) {
  run().catch((error) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 1;
  });
}
