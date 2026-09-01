import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  browserFileMapTreeIdentity,
  fakeFileSystemInit,
  fileMapForDirectory,
  hashProjectTree,
} from './support/fake-file-system.mjs';

const runnerPath = fileURLToPath(import.meta.url);
const editorRoot = path.resolve(path.dirname(runnerPath), '..');
const repoRoot = path.resolve(editorRoot, '..', '..');
const starterRoot = path.join(repoRoot, 'examples', 'starter');
const forbiddenPorts = new Set([4173, 4175]);

export const FORBIDDEN_PORTS = Object.freeze([4173, 4175]);
export const SEARCH_RANGE = Object.freeze({ from: 4331, to: 4370 });
export const MODES = Object.freeze(['preflight', 'diagnostic', 'formal']);
export const VIEWPORTS = Object.freeze([
  Object.freeze({ id: '1440', width: 1440, height: 900 }),
  Object.freeze({ id: '1024', width: 1024, height: 768 }),
  Object.freeze({ id: '800', width: 800, height: 900 }),
]);
export const MILESTONE_IDS = Object.freeze([
  'strict-isolated-port-selected',
  'isolated-vite-ready',
  'fixture-opened-through-picker',
  'asset-center-mode-opened',
  'asset-summary-matches-fixture',
  'category-rail-complete',
  'search-filter-consistent',
  'status-filter-consistent',
  'keyboard-selection',
  'image-inspector-preview',
  'audio-inspector-preview',
  'audio-preview-fallback-safe',
  'video-inspector-preview',
  'video-preview-fallback-safe',
  'missing-asset-visible',
  'duplicate-key-visible',
  'unused-asset-visible',
  'invalid-name-visible',
  'unsupported-format-visible',
  'reference-navigation',
  'layout-1440',
  'layout-1024',
  'layout-800',
  'fixture-remains-byte-identical',
  'browser-error-channels-empty',
  'isolated-process-cleanup',
]);

const REQUIRED_CHINESE_LABELS = Object.freeze([
  '素材中心',
  '素材库',
  '全部状态',
  '已引用',
  '未引用',
  '引用缺失',
  '同名冲突',
  '命名异常',
  '格式待确认',
]);

const ASSET_DOM_CONTRACT_SELECTORS = Object.freeze([
  '#asset-center-view',
  '.asset-center-header',
  '.asset-center-overview',
  '.asset-center-rail',
  '.asset-center-library',
  '.asset-center-inspector',
  '[data-asset-filter="search"]',
  '[data-asset-id]',
  '[data-asset-kind]',
  '[data-asset-status]',
  '[data-source-path]',
  '[data-source-line]',
]);
const ASSET_ROW_SELECTOR = '#asset-center-view .asset-center-items [role="option"][data-asset-id]';
const FORMAL_REQUIRED_TRACKED_PATHS = Object.freeze([
  'packages/editor/e2e/asset-center-read-only.e2e.mjs',
  'packages/editor/src/panels/asset-center.ts',
  'packages/editor/src/styles/asset-center.css',
  'packages/editor/test/asset-center-filter.test.ts',
  'packages/editor/test/asset-center-runner-contract.test.mjs',
  'packages/editor/test/editor-asset-center-contract.test.ts',
]);
const VALID_WEBM_BASE64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua6mup9eBAXPFhwKTJVjPygKDgQFV7oEBhoVWX1ZQOOCKsIEQuoEQU8CBAR9DtnUB/////////+eBAKDnobyBAAAA8AIAnQEqEAAQAAAHCIWFiJmEiAEkEBOtUB/AH9AQam9w/uyXj/5f63OC1/zAD/9+6cs2Kl/786B1oaampO6BAaWfEAIAnQEqEAAQAABHCIWFiJmEiAGiEABgawD+/7qDAKDMoayBADsAMQIAABAJIADAOf//gINT/yzUDcD+/F5n/6TRqn4+0t/9ZVfJUftmAHWhmKaW7oEBpZGxAQABEBwAGAAYWC/0AAgAAPuBAKDOoa2BAH8A8QEAABAJIADAOcBBqf+Wagh4/uyXj/5f63OC1/zAD/9+6cs2Kl/786B1oZmml+6BAaWS0QEAARANEADAAMLBf6AAQAAA+4E7oMuhqoEAvQDxAQAAEAkgAMA5/8Gp/5ZqBuD+/F5n/6TRqn4+0t/9ZVfJUftmAHWhmaaX7oEBpZLRAQABEAkgAMAAwsF/oABAAAD7gX8=';

function evidenceClassForMode(mode) {
  return `EDITOR_ASSET_CENTER_READ_ONLY_BROWSER_${mode.toUpperCase()}`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return {
    path: path.resolve(file),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function writeExclusiveJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeSync(fd, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return readFileIdentity(file);
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim() || result.status}`);
  }
  return result.stdout.trim();
}

function committedFileIdentity(revision, repoRelativePath) {
  const result = spawnSync('git', ['show', `${revision}:${repoRelativePath}`], {
    cwd: repoRoot,
    encoding: null,
    windowsHide: true,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    return {
      path: repoRelativePath,
      exists: false,
      error: Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8').trim() : String(result.stderr ?? ''),
    };
  }
  return {
    path: repoRelativePath,
    exists: true,
    bytes: result.stdout.byteLength,
    sha256: sha256(result.stdout),
  };
}

function gitEvidence() {
  const runHead = gitOutput(['rev-parse', 'HEAD']);
  const trackedCodeDiffPaths = [...new Set([
    ...gitOutput(['diff', '--name-only', '--']).split(/\r?\n/),
    ...gitOutput(['diff', '--cached', '--name-only', '--']).split(/\r?\n/),
  ])].filter(Boolean).sort();
  return { runHead, trackedCodeDiffPaths };
}

function addFixtureFile(files, filePath, bytes) {
  assert(!files.some((file) => file.path === filePath), `fixture path already exists: ${filePath}`);
  files.push({ path: filePath, bytes: Buffer.from(bytes).toString('base64') });
}

function replaceFixtureFile(files, filePath, bytes) {
  const entry = files.find((file) => file.path === filePath);
  assert(entry, `fixture file missing: ${filePath}`);
  entry.bytes = Buffer.from(bytes).toString('base64');
}

function fixtureText(files, filePath) {
  const entry = files.find((file) => file.path === filePath);
  assert(entry, `fixture text file missing: ${filePath}`);
  return Buffer.from(entry.bytes, 'base64').toString('utf8');
}

function svgBytes(label, fill = '#38536b') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="240" height="120" fill="${fill}"/><text x="16" y="64" fill="#fff" font-size="20">${label}</text></svg>`,
    'utf8',
  );
}

function wavBytes(durationMs = 120, sampleRate = 8_000) {
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

function buildFixture() {
  const files = fileMapForDirectory(starterRoot).map((file) => ({ ...file }));
  const normalPortrait = Buffer.from(
    files.find((file) => file.path === 'content/assets/portrait/lynn_uniform_normal.svg')?.bytes ?? '',
    'base64',
  );
  const additions = [
    { path: 'content/assets/bg/asset-center-harbor.svg', bytes: svgBytes('harbor', '#355d70'), purpose: 'referenced-image' },
    { path: 'content/assets/bg/unknown-format.xyz', bytes: Buffer.from('not a recognized media format\n', 'utf8'), purpose: 'unsupported-format' },
    { path: 'content/assets/portrait/alternate/lynn_uniform_normal.svg', bytes: normalPortrait, purpose: 'duplicate-semantic-key' },
    { path: 'content/assets/portrait/bad-portrait.svg', bytes: svgBytes('invalid', '#70434f'), purpose: 'invalid-portrait-name' },
    { path: 'content/assets/avatar/unused.svg', bytes: svgBytes('unused', '#6b5a38'), purpose: 'unused-image' },
    { path: 'content/assets/bgm/theme.wav', bytes: wavBytes(), purpose: 'referenced-audio-valid' },
    { path: 'content/assets/bgm/broken.wav', bytes: Buffer.from('broken audio fixture', 'utf8'), purpose: 'audio-fallback' },
    { path: 'content/assets/ambience/rain.ogg', bytes: Buffer.from('OggS\0surdet-asset-center-rain', 'utf8'), purpose: 'referenced-audio' },
    { path: 'content/assets/se/click.wav', bytes: Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'utf8'), purpose: 'referenced-audio' },
    { path: 'content/assets/voice/lynn_line.wav', bytes: Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'utf8'), purpose: 'referenced-audio' },
    { path: 'content/assets/video/teaser.webm', bytes: Buffer.from(VALID_WEBM_BASE64, 'base64'), purpose: 'referenced-video-valid' },
    { path: 'content/assets/video/broken.webm', bytes: Buffer.from('broken video fixture', 'utf8'), purpose: 'video-fallback' },
    { path: 'content/assets/fonts/asset-center-font.otf', bytes: Buffer.from('OTTO\0surdet-asset-center-font', 'utf8'), purpose: 'unused-font' },
  ];
  for (const addition of additions) addFixtureFile(files, addition.path, addition.bytes);

  const scenePath = 'content/scenario/ch01_02.gal';
  const originalScene = fixtureText(files, scenePath);
  const sceneEnd = originalScene.lastIndexOf('@end');
  assert(sceneEnd >= 0, `fixture scene has no @end: ${scenePath}`);
  const extraInstructions = [
    '@bg asset-center-harbor',
    '@bg missing_backdrop',
    '@bgm theme',
    '@ambience rain',
    '@se click',
    '@voice lynn_line',
    '@video teaser',
    '@show lynn:uniform normal @ left',
  ].join('\n');
  replaceFixtureFile(
    files,
    scenePath,
    `${originalScene.slice(0, sceneEnd)}${extraInstructions}\n${originalScene.slice(sceneEnd)}`,
  );

  return {
    files,
    fixtureAugmentations: additions.map((addition) => ({
      path: addition.path,
      purpose: addition.purpose,
      bytes: Buffer.byteLength(addition.bytes),
    })).concat({ path: scenePath, purpose: 'in-memory-reference-fixture' }),
  };
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function chooseStrictPort() {
  for (let port = SEARCH_RANGE.from; port <= SEARCH_RANGE.to; port += 1) {
    if (forbiddenPorts.has(port)) continue;
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`no strict Asset Center port available in ${SEARCH_RANGE.from}..${SEARCH_RANGE.to}`);
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The listener is not published yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite readiness timeout: ${url}`);
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopServer(child, cleanupFailures) {
  if (!child) return;
  const pid = child.pid;
  if (child.exitCode === null) {
    try {
      child.kill('SIGTERM');
    } catch (error) {
      cleanupFailures.push(`SIGTERM ${pid}: ${errorText(error)}`);
    }
  }
  if (await waitForExit(child)) return;
  if (process.platform === 'win32' && Number.isInteger(pid)) {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForExit(killer, 5_000);
  } else if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch (error) {
      cleanupFailures.push(`SIGKILL ${pid}: ${errorText(error)}`);
    }
  }
  if (!(await waitForExit(child))) cleanupFailures.push(`Vite child remained alive: ${pid}`);
}

function observePage(page, channels) {
  page.on('console', (message) => {
    if (message.type() === 'error') channels.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => channels.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => channels.requestFailures.push(
    `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ));
  page.on('response', (response) => {
    if (response.status() >= 400) channels.responseFailures.push(
      `${response.status()} ${response.request().method()} ${response.url()}`,
    );
  });
}

async function installPreviewProbe(page) {
  await page.addInitScript(() => {
    const created = [];
    const revoked = [];
    const seenElements = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = originalCreate(value);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      originalRevoke(url);
    };
    const observeMedia = () => {
      if (!document.documentElement) return;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const media = node.matches('img, audio, video') ? [node] : [...node.querySelectorAll('img, audio, video')];
            for (const element of media) {
              seenElements.push({ tag: element.tagName, ariaLabel: element.getAttribute('aria-label'), alt: element.getAttribute('alt') });
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) observeMedia();
    else addEventListener('DOMContentLoaded', observeMedia, { once: true });
    window.__surdetAssetPreviewDebug = { created, revoked, seenElements };
  });
}

// The fake picker installs window.showDirectoryPicker without touching a project.

async function takeScreenshot(page, artifactDirectory, name, screenshots) {
  const file = path.join(artifactDirectory, `${name}.png`);
  assert(!fs.existsSync(file), `screenshot already exists: ${file}`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  screenshots.push(readFileIdentity(file));
}

async function openFixture(page, expectedPhysicalCount) {
  await page.locator('[data-action="open-project"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction((expected) => (
    window.surdetEditorDebug?.state?.authoringIndex !== null
      && window.surdetEditorDebug?.state?.assetIntelligenceState === 'ready'
      && window.surdetEditorDebug?.state?.dirAssets?.length >= expected
  ), expectedPhysicalCount);
  const opened = await page.evaluate(() => ({
    projectName: document.querySelector('.editor-project-name')?.textContent ?? null,
    sceneCount: window.surdetEditorDebug?.state?.scenes?.size ?? null,
    assetCount: window.surdetEditorDebug?.state?.dirAssets?.length ?? null,
    assetState: window.surdetEditorDebug?.state?.assetIntelligenceState ?? null,
  }));
  assert(opened.projectName === 'starter', `project bar did not show Starter: ${opened.projectName}`);
  assert(opened.assetState === 'ready', `asset intelligence did not settle: ${opened.assetState}`);
  return opened;
}

async function enterAssetCenter(page) {
  await page.locator('[data-editor-mode="assets"]').click();
  await page.locator('#asset-center-view.asset-center').waitFor({ state: 'visible' });
  await page.locator('#asset-center-view .asset-center-shell').waitFor({ state: 'visible' });
  await page.waitForFunction(() => (
    document.querySelectorAll('#asset-center-view .asset-center-items [role="option"][data-asset-id]').length > 0
  ));
}

async function waitForRows(page, expectedCount) {
  await page.waitForFunction((expected) => (
    document.querySelectorAll('#asset-center-view .asset-center-items [role="option"][data-asset-id]').length === expected
  ), expectedCount);
}

async function clickRailFilter(page, label) {
  const button = page.locator('.asset-center-rail .asset-center-filter').filter({ hasText: label }).first();
  await button.waitFor({ state: 'visible' });
  await button.click();
  await page.waitForFunction((expected) => (
    [...document.querySelectorAll('.asset-center-rail .asset-center-filter')]
      .some((element) => element.textContent?.includes(expected) && element.getAttribute('aria-pressed') === 'true')
  ), label);
}

async function selectAsset(page, pathSuffix) {
  const row = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-id="file:content/assets/${pathSuffix}"]`);
  await row.waitFor({ state: 'visible' });
  const assetId = await row.getAttribute('data-asset-id');
  await row.click();
  await page.waitForFunction((expected) => (
    document.querySelector('.asset-center-inspector')?.getAttribute('data-asset-id') === expected
  ), assetId);
  return assetId;
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const inspect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector,
        position: style.position,
        display: style.display,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        visible: style.display !== 'none' && rect.width > 0 && rect.height > 0,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageWidth: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
      center: inspect('#asset-center-view.asset-center'),
      header: inspect('#asset-center-view .asset-center-header'),
      overview: inspect('#asset-center-view .asset-center-overview'),
      shell: inspect('#asset-center-view .asset-center-shell'),
      rail: inspect('#asset-center-view .asset-center-rail'),
      library: inspect('#asset-center-view .asset-center-library'),
      inspector: inspect('#asset-center-view .asset-center-inspector'),
      rowCount: document.querySelectorAll('#asset-center-view .asset-center-items [role="option"][data-asset-id]').length,
    };
  });
}

function assertLayout(layout, expectedWidth) {
  assert(layout.viewport.width === expectedWidth, `${expectedWidth}: viewport width ${layout.viewport.width}`);
  assert(layout.center?.visible, `${expectedWidth}: Asset Center is not visible`);
  assert(layout.shell?.visible, `${expectedWidth}: Asset Center shell is not visible`);
  assert(layout.library?.visible, `${expectedWidth}: asset library is not visible`);
  assert(layout.inspector?.visible, `${expectedWidth}: asset inspector is not visible`);
  assert(layout.pageWidth.scroll <= layout.pageWidth.client + 1, `${expectedWidth}: horizontal page overflow`);
  for (const region of [layout.header, layout.overview, layout.shell, layout.library, layout.inspector]) {
    assert(region.left >= -1 && region.right <= expectedWidth + 1, `${expectedWidth}: ${region.selector} escapes viewport`);
  }
  if (expectedWidth >= 1024) {
    assert(layout.rail?.visible, `${expectedWidth}: category rail is not visible`);
    assert(layout.rail.width >= 130, `${expectedWidth}: category rail is too narrow`);
    assert(layout.inspector.width >= 240, `${expectedWidth}: inspector is too narrow`);
  } else {
    assert(layout.rail?.visible, '800: compact filter rail is not visible');
    assert(layout.rail.height < 100, `800: filter rail did not collapse to a compact strip (${layout.rail.height})`);
    assert(layout.inspector.position === 'static', `800: inspector is not in document flow (${layout.inspector.position})`);
  }
}

function formatAssetBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function run() {
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-asset-center-read-only-'));
  const evidencePath = path.join(artifactDirectory, 'evidence.json');
  const identityPath = path.join(artifactDirectory, 'identity.json');
  const milestones = [];
  const screenshots = [];
  const channels = {
    errors: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseFailures: [],
    childCleanupFailures: [],
  };
  const serverStdout = [];
  const serverStderr = [];
  const starterBefore = hashProjectTree(starterRoot);
  const fixture = buildFixture();
  const fixtureTreeBefore = browserFileMapTreeIdentity(fixture.files);
  const expectedPhysicalCount = fixture.files.filter((file) => file.path.startsWith('content/assets/')).length;
  const expectedBytes = fixture.files
    .filter((file) => file.path.startsWith('content/assets/'))
    .reduce((total, file) => total + Buffer.from(file.bytes, 'base64').byteLength, 0);
  const gitBefore = gitEvidence();
  const mode = process.argv[2] ?? 'diagnostic';
  assert(MODES.includes(mode), `unsupported runner mode: ${mode}`);
  let browser = null;
  let page = null;
  let server = null;
  let port = null;
  let portReleased = false;
  let browserClosed = false;
  let failure = null;
  let fixtureTreeAfter = null;
  let starterAfter = null;

  const pass = (name, evidence = {}) => milestones.push({ name, status: 'passed', evidence });
  try {
    port = await chooseStrictPort();
    assert(!forbiddenPorts.has(port), `forbidden port selected: ${port}`);
    pass('strict-isolated-port-selected', {
      port,
      range: SEARCH_RANGE,
      forbiddenPorts: FORBIDDEN_PORTS,
      loopback: '127.0.0.1',
    });

    const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    assert(fs.existsSync(viteBin), `Vite launcher missing: ${viteBin}`);
    server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: editorRoot,
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    server.stdout.setEncoding('utf8');
    server.stderr.setEncoding('utf8');
    server.stdout.on('data', (chunk) => serverStdout.push(chunk));
    server.stderr.on('data', (chunk) => serverStderr.push(chunk));
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(server, `${baseUrl}/index.html`);
    pass('isolated-vite-ready', { baseUrl, pid: server.pid, command: [viteBin, '--strictPort'] });

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observePage(page, channels);
    await installPreviewProbe(page);
    await page.addInitScript(fakeFileSystemInit, { rootName: 'starter', files: fixture.files });
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const opened = await openFixture(page, expectedPhysicalCount);
    pass('fixture-opened-through-picker', {
      ...opened,
      fixtureTreeBefore,
      fixtureAugmentations: fixture.fixtureAugmentations,
      expectedPhysicalCount,
    });

    await enterAssetCenter(page);
    const initialRows = await page.locator(ASSET_ROW_SELECTOR).count();
    const projectionCounts = await page.evaluate(() => {
      const items = window.surdetEditorDebug.state.assetIntelligence?.items ?? [];
      return {
        total: items.length,
        physical: items.filter((item) => item.physical).length,
        missingIds: items.filter((item) => !item.physical).map((item) => item.assetId).sort(),
      };
    });
    assert(projectionCounts.physical === expectedPhysicalCount, `expected ${expectedPhysicalCount} physical rows, got ${projectionCounts.physical}`);
    assert(initialRows === projectionCounts.total, `list/projection row mismatch: ${initialRows} != ${projectionCounts.total}`);
    assert(
      projectionCounts.missingIds.includes('missing:background:missing_backdrop'),
      `fixture missing_backdrop was not represented: ${projectionCounts.missingIds.join(', ')}`,
    );
    const initialSelection = await page.locator('.asset-center-inspector').getAttribute('data-asset-id');
    const initialPreviewCount = await page.locator('.asset-center-preview').count();
    assert(initialSelection === null, `Asset Center selected before an explicit choice: ${initialSelection}`);
    assert(initialPreviewCount === 0, `Asset Center previewed before an explicit choice: ${initialPreviewCount}`);
    pass('asset-center-mode-opened', {
      mainTab: await page.evaluate(() => window.surdetEditorDebug.state.mainTab),
      rowCount: initialRows,
      modeButton: await page.locator('[data-editor-mode="assets"]').getAttribute('aria-current'),
      initialSelection,
      initialPreviewCount,
      projectionCounts,
    });

    const overviewText = await page.locator('.asset-center-overview').textContent() ?? '';
    assert(overviewText.includes(String(expectedPhysicalCount)), `overview does not show ${expectedPhysicalCount} files`);
    assert(overviewText.includes(formatAssetBytes(expectedBytes)), `overview does not show ${formatAssetBytes(expectedBytes)}`);
    const overviewData = await page.locator('.asset-center-overview').evaluate((element) => ({ ...element.dataset }));
    assert(Number(overviewData.fileCount) === expectedPhysicalCount, `stable file count is wrong: ${overviewData.fileCount}`);
    assert(Number(overviewData.measuredBytes) === expectedBytes, `stable measured bytes are wrong: ${overviewData.measuredBytes}`);
    pass('asset-summary-matches-fixture', {
      expectedPhysicalCount,
      expectedBytes,
      formattedBytes: formatAssetBytes(expectedBytes),
      text: overviewText.trim(),
      overviewData,
    });

    const categoryLabels = ['全部素材', '背景', '立绘', '头像', '音乐', '环境音', '音效', '语音', '视频', '字体', '其他'];
    const statusLabels = ['全部状态', '已引用', '未引用', '引用缺失', '同名冲突', '命名异常', '格式待确认'];
    const railText = await page.locator('.asset-center-rail').textContent() ?? '';
    const centerText = await page.locator('#asset-center-view').textContent() ?? '';
    for (const label of [...categoryLabels, ...statusLabels]) assert(railText.includes(label), `missing rail label: ${label}`);
    for (const label of REQUIRED_CHINESE_LABELS) assert(centerText.includes(label), `missing Asset Center label: ${label}`);
    pass('category-rail-complete', {
      categoryLabels,
      statusLabels,
      requiredChineseLabels: REQUIRED_CHINESE_LABELS,
      selectors: ASSET_DOM_CONTRACT_SELECTORS,
    });

    const search = page.locator('[data-asset-filter="search"]');
    await search.fill('asset-center-harbor');
    await waitForRows(page, 1);
    assert(
      await page.locator(`${ASSET_ROW_SELECTOR}[data-asset-id="file:content/assets/bg/asset-center-harbor.svg"]`).count() === 1,
      'search did not isolate harbor asset',
    );
    const filteredData = await page.locator('#asset-center-view').evaluate((element) => ({ ...element.dataset }));
    const filteredCounts = await page.locator('.asset-center-filter').evaluateAll((buttons) => Object.fromEntries(buttons.map((button) => [
      `${button.getAttribute('data-asset-filter-axis')}:${button.getAttribute('data-asset-filter-value')}`,
      Number(button.getAttribute('data-asset-filter-count')),
    ])));
    const filteredSummaryText = await page.locator('.asset-center-library-header').textContent() ?? '';
    assert(filteredData.assetQuery === 'asset-center-harbor', `stable query mismatch: ${filteredData.assetQuery}`);
    assert(Number(filteredData.visibleCount) === 1, `stable visible count mismatch: ${filteredData.visibleCount}`);
    assert(filteredCounts['kind:background'] === 1, `filtered background facet mismatch: ${filteredCounts['kind:background']}`);
    assert(filteredCounts['kind:voice'] === 0, `filtered voice facet mismatch: ${filteredCounts['kind:voice']}`);
    assert(filteredSummaryText.includes(`当前显示 1 项，共 ${projectionCounts.total} 项`), `visible search summary drifted: ${filteredSummaryText}`);
    await search.fill('');
    await waitForRows(page, projectionCounts.total);
    pass('search-filter-consistent', {
      searched: 'asset-center-harbor',
      matchedRows: 1,
      clearedRows: projectionCounts.total,
      filteredData,
      filteredCounts,
      filteredSummaryText: filteredSummaryText.trim(),
    });

    await clickRailFilter(page, '未引用');
    const unusedRows = page.locator('[data-asset-status~="unused"]');
    assert(await unusedRows.count() > 0, 'unused status filter returned no rows');
    const unusedFilterCount = await unusedRows.count();
    const unusedSummaryText = await page.locator('.asset-center-library-header').textContent() ?? '';
    assert(
      unusedSummaryText.includes(`当前显示 ${unusedFilterCount} 项，共 ${projectionCounts.total} 项`),
      `visible status summary drifted: ${unusedSummaryText}`,
    );
    await clickRailFilter(page, '全部状态');
    await waitForRows(page, projectionCounts.total);
    pass('status-filter-consistent', { unusedRows: unusedFilterCount, unusedSummaryText: unusedSummaryText.trim() });

    const keyboardId = 'file:content/assets/bg/asset-center-harbor.svg';
    const keyboardRow = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-id="${keyboardId}"]`);
    await keyboardRow.waitFor({ state: 'visible' });
    await keyboardRow.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((expected) => document.querySelector('.asset-center-inspector')?.getAttribute('data-asset-id') === expected, keyboardId);
    await page.waitForFunction((expected) => document.activeElement?.getAttribute('data-asset-id') === expected, keyboardId);
    assert(await keyboardRow.getAttribute('aria-selected') === 'true', 'Enter did not retain keyboard-selected asset');
    pass('keyboard-selection', {
      assetId: keyboardId,
      focusedElement: await page.evaluate(() => document.activeElement?.getAttribute('data-asset-id') ?? null),
    });

    await selectAsset(page, 'bg/asset-center-harbor.svg');
    await page.locator('.asset-center-preview[data-preview-state="ready"] img').waitFor({ state: 'visible' });
    pass('image-inspector-preview', await page.evaluate(() => ({
      state: document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') ?? null,
      tag: document.querySelector('.asset-center-preview img')?.tagName ?? null,
      alt: document.querySelector('.asset-center-preview img')?.getAttribute('alt') ?? null,
    })));

    await selectAsset(page, 'bgm/theme.wav');
    await page.waitForFunction(() => window.__surdetAssetPreviewDebug.seenElements.some((entry) => entry.tag === 'AUDIO'));
    await page.waitForFunction(() => {
      const preview = document.querySelector('.asset-center-preview');
      const audio = preview?.querySelector('audio');
      return preview?.getAttribute('data-preview-state') === 'ready' && audio !== null && audio.readyState >= 1;
    });
    const audioEvidence = await page.evaluate(() => ({
      state: document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') ?? null,
      tag: document.querySelector('.asset-center-preview audio')?.tagName ?? null,
      controls: document.querySelector('.asset-center-preview audio')?.hasAttribute('controls') ?? false,
      readyState: document.querySelector('.asset-center-preview audio')?.readyState ?? null,
      seen: window.__surdetAssetPreviewDebug.seenElements.filter((entry) => entry.tag === 'AUDIO'),
    }));
    assert(
      audioEvidence.state === 'ready' && audioEvidence.tag === 'AUDIO' && audioEvidence.controls && audioEvidence.readyState >= 1,
      `valid audio fixture did not reach a usable native preview: ${JSON.stringify(audioEvidence)}`,
    );
    pass('audio-inspector-preview', audioEvidence);

    await selectAsset(page, 'bgm/broken.wav');
    await page.waitForFunction(() => document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') === 'error');
    const audioFallbackEvidence = await page.evaluate(() => ({
      state: document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') ?? null,
      mediaCount: document.querySelectorAll('.asset-center-preview audio').length,
      text: document.querySelector('.asset-center-preview')?.textContent?.trim() ?? '',
    }));
    assert(
      audioFallbackEvidence.state === 'error'
        && audioFallbackEvidence.mediaCount === 0
        && audioFallbackEvidence.text.includes('无法预览'),
      `broken audio fixture did not fail safely: ${JSON.stringify(audioFallbackEvidence)}`,
    );
    pass('audio-preview-fallback-safe', audioFallbackEvidence);

    await selectAsset(page, 'video/teaser.webm');
    await page.waitForFunction(() => window.__surdetAssetPreviewDebug.seenElements.some((entry) => entry.tag === 'VIDEO'));
    await page.waitForFunction(() => {
      const preview = document.querySelector('.asset-center-preview');
      const video = preview?.querySelector('video');
      return preview?.getAttribute('data-preview-state') === 'ready' && video !== null && video.readyState >= 1;
    });
    const videoEvidence = await page.evaluate(() => ({
      state: document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') ?? null,
      tag: document.querySelector('.asset-center-preview video')?.tagName ?? null,
      controls: document.querySelector('.asset-center-preview video')?.hasAttribute('controls') ?? false,
      autoplay: document.querySelector('.asset-center-preview video')?.hasAttribute('autoplay') ?? false,
      readyState: document.querySelector('.asset-center-preview video')?.readyState ?? null,
      seen: window.__surdetAssetPreviewDebug.seenElements.filter((entry) => entry.tag === 'VIDEO'),
    }));
    assert(
      videoEvidence.state === 'ready'
        && videoEvidence.tag === 'VIDEO'
        && videoEvidence.controls
        && !videoEvidence.autoplay
        && videoEvidence.readyState >= 1,
      `valid video fixture did not reach a usable native preview: ${JSON.stringify(videoEvidence)}`,
    );
    pass('video-inspector-preview', videoEvidence);

    await selectAsset(page, 'video/broken.webm');
    await page.waitForFunction(() => document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') === 'error');
    const videoFallbackEvidence = await page.evaluate(() => ({
      state: document.querySelector('.asset-center-preview')?.getAttribute('data-preview-state') ?? null,
      mediaCount: document.querySelectorAll('.asset-center-preview video').length,
      text: document.querySelector('.asset-center-preview')?.textContent?.trim() ?? '',
    }));
    assert(
      videoFallbackEvidence.state === 'error'
        && videoFallbackEvidence.mediaCount === 0
        && videoFallbackEvidence.text.includes('无法预览'),
      `broken video fixture did not fail safely: ${JSON.stringify(videoFallbackEvidence)}`,
    );
    pass('video-preview-fallback-safe', videoFallbackEvidence);

    await clickRailFilter(page, '引用缺失');
    const missingRows = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-id^="missing:"]`);
    const missingAssetIds = (await missingRows.evaluateAll((rows) => (
      rows.map((row) => row.getAttribute('data-asset-id')).filter(Boolean)
    ))).sort();
    const expectedMissingAssetIds = [...projectionCounts.missingIds].sort();
    assert(
      missingAssetIds.length === projectionCounts.missingIds.length,
      `expected ${projectionCounts.missingIds.length} synthetic missing items, got ${missingAssetIds.length}`,
    );
    assert(
      JSON.stringify(missingAssetIds) === JSON.stringify(expectedMissingAssetIds),
      `missing item projection drifted: ${JSON.stringify({ expectedMissingAssetIds, missingAssetIds })}`,
    );
    assert(
      await missingRows.evaluateAll((rows) => rows.every((row) => (row.getAttribute('data-asset-status') ?? '').includes('missing'))),
      'missing item lacks missing status',
    );
    pass('missing-asset-visible', { assetIds: missingAssetIds });

    await clickRailFilter(page, '同名冲突');
    const duplicateRows = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-status~="duplicate"]`);
    assert(await duplicateRows.count() === 2, `expected two physical duplicate rows, got ${await duplicateRows.count()}`);
    pass('duplicate-key-visible', {
      assetIds: await duplicateRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-asset-id'))),
    });

    await clickRailFilter(page, '未引用');
    const unusedItemRows = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-status~="unused"]`);
    assert(await unusedItemRows.count() > 0, 'unused item disappeared from unused filter');
    pass('unused-asset-visible', { count: await unusedItemRows.count() });

    await clickRailFilter(page, '命名异常');
    const invalidRow = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-id="file:content/assets/portrait/bad-portrait.svg"]`);
    assert(await invalidRow.count() === 1, 'invalid portrait is not visible');
    pass('invalid-name-visible', { assetId: await invalidRow.getAttribute('data-asset-id') });

    await clickRailFilter(page, '格式待确认');
    const unsupportedRow = page.locator(`${ASSET_ROW_SELECTOR}[data-asset-id="file:content/assets/bg/unknown-format.xyz"]`);
    assert(await unsupportedRow.count() === 1, 'unsupported asset is not visible');
    pass('unsupported-format-visible', { assetId: await unsupportedRow.getAttribute('data-asset-id') });

    await clickRailFilter(page, '全部状态');
    await waitForRows(page, projectionCounts.total);
    await selectAsset(page, 'bg/asset-center-harbor.svg');
    const reference = page.locator('.asset-center-reference[data-source-path="content/scenario/ch01_02.gal"]').first();
    await reference.waitFor({ state: 'visible' });
    const sourceLine = Number(await reference.getAttribute('data-source-line'));
    assert(Number.isInteger(sourceLine) && sourceLine > 0, `reference line is not stable: ${sourceLine}`);
    await reference.click();
    await page.waitForFunction((expectedLine) => {
      const debug = window.surdetEditorDebug;
      const selected = document.querySelector('#editor .block[aria-selected="true"]');
      return debug?.state?.mainTab === 'editor'
        && debug?.state?.current === 'ch01_02'
        && selected?.getAttribute('data-line') === String(expectedLine - 1);
    }, sourceLine);
    pass('reference-navigation', await page.evaluate((expectedLine) => ({
      mainTab: window.surdetEditorDebug.state.mainTab,
      sceneId: window.surdetEditorDebug.state.current,
      selectedLine: document.querySelector('#editor .block[aria-selected="true"]')?.getAttribute('data-line') ?? null,
      expectedLine: expectedLine - 1,
      selectedObjectRef: window.surdetEditorDebug.state.selectedObjectRef,
    }), sourceLine));

    await enterAssetCenter(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const layout = await inspectLayout(page);
      assertLayout(layout, viewport.width);
      await takeScreenshot(page, artifactDirectory, `asset-center-${viewport.id}`, screenshots);
      pass(`layout-${viewport.id}`, layout);
    }

    await selectAsset(page, 'bg/asset-center-harbor.svg');
    const beforeDispose = await page.evaluate(() => ({
      ...window.__surdetAssetPreviewDebug,
      created: [...window.__surdetAssetPreviewDebug.created],
      revoked: [...window.__surdetAssetPreviewDebug.revoked],
    }));
    await page.locator('[data-editor-mode="editor"]').click();
    await page.locator('#editor-workspace').waitFor({ state: 'visible' });
    const afterDispose = await page.evaluate(() => ({
      created: [...window.__surdetAssetPreviewDebug.created],
      revoked: [...window.__surdetAssetPreviewDebug.revoked],
    }));
    assert(beforeDispose.created.length > 0, 'preview probe captured no object URLs');
    assert(afterDispose.created.every((url) => afterDispose.revoked.includes(url)), 'not every preview URL was revoked');
    fixtureTreeAfter = browserFileMapTreeIdentity(await page.evaluate(() => window.__surdetDumpFakeRoot()));
    assert(fixtureTreeAfter.sha256 === fixtureTreeBefore.sha256, `fixture tree mutated: ${fixtureTreeBefore.sha256} -> ${fixtureTreeAfter.sha256}`);
    pass('fixture-remains-byte-identical', {
      before: fixtureTreeBefore,
      after: fixtureTreeAfter,
      projectMutation: fixtureTreeAfter.sha256 !== fixtureTreeBefore.sha256,
      objectUrls: { created: afterDispose.created.length, revoked: afterDispose.revoked.length },
    });
    pass('browser-error-channels-empty', {
      errors: channels.errors,
      consoleErrors: channels.consoleErrors,
      pageErrors: channels.pageErrors,
      requestFailures: channels.requestFailures,
      responseFailures: channels.responseFailures,
    });
    assert(channels.errors.length === 0, `runner errors: ${channels.errors.join(' | ')}`);
    assert(channels.consoleErrors.length === 0, `browser console errors: ${channels.consoleErrors.join(' | ')}`);
    assert(channels.pageErrors.length === 0, `browser page errors: ${channels.pageErrors.join(' | ')}`);
    assert(channels.requestFailures.length === 0, `browser request failures: ${channels.requestFailures.join(' | ')}`);
    assert(channels.responseFailures.length === 0, `browser response failures: ${channels.responseFailures.join(' | ')}`);
  } catch (error) {
    failure = errorText(error);
    channels.errors.push(failure);
  } finally {
    if (fixtureTreeAfter === null && page !== null) {
      try {
        fixtureTreeAfter = browserFileMapTreeIdentity(await page.evaluate(() => window.__surdetDumpFakeRoot()));
      } catch {
        // The fake picker may not have been installed before the first failure.
      }
    }
    try { if (page) await page.close(); } catch (error) { channels.childCleanupFailures.push(`page close: ${errorText(error)}`); }
    try {
      if (browser) await browser.close();
      browserClosed = true;
    } catch (error) {
      channels.childCleanupFailures.push(`browser close: ${errorText(error)}`);
    }
    await stopServer(server, channels.childCleanupFailures);
    if (port !== null) portReleased = await portIsAvailable(port);
    if (!portReleased) channels.childCleanupFailures.push(`strict port remained occupied: ${port}`);
  }

  starterAfter = hashProjectTree(starterRoot);
  if (starterAfter.sha256 !== starterBefore.sha256 && failure === null) {
    failure = `original Starter changed: ${starterBefore.sha256} -> ${starterAfter.sha256}`;
    channels.errors.push(failure);
  }
  if (fixtureTreeAfter === null) fixtureTreeAfter = fixtureTreeBefore;
  if (fixtureTreeAfter && fixtureTreeAfter.sha256 !== fixtureTreeBefore.sha256 && failure === null) {
    failure = `fixture tree changed: ${fixtureTreeBefore.sha256} -> ${fixtureTreeAfter.sha256}`;
    channels.errors.push(failure);
  }
  if (channels.childCleanupFailures.length > 0 && failure === null) {
    failure = `cleanup failures: ${channels.childCleanupFailures.join(' | ')}`;
    channels.errors.push(failure);
  }

  const gitAfter = gitEvidence();
  const codeEvidenceHead = process.env.SURDET_CODE_EVIDENCE_HEAD ?? null;
  const runnerIdentity = readFileIdentity(runnerPath);
  const formalRequiredPathIdentities = codeEvidenceHead === null ? [] : FORMAL_REQUIRED_TRACKED_PATHS.map((repoRelativePath) => ({
    working: readFileIdentity(path.join(repoRoot, repoRelativePath)),
    committed: committedFileIdentity(codeEvidenceHead, repoRelativePath),
  }));
  const committedRunnerIdentity = formalRequiredPathIdentities.find(({ committed }) => committed.path === 'packages/editor/e2e/asset-center-read-only.e2e.mjs')?.committed ?? null;
  const runnerCommitMatches = committedRunnerIdentity?.exists === true
    && committedRunnerIdentity.sha256 === runnerIdentity.sha256;
  const requiredPathMismatches = formalRequiredPathIdentities.filter(({ working, committed }) => (
    committed.exists !== true || committed.sha256 !== working.sha256
  ));
  if (mode === 'formal') {
    const formalFailures = [
      !codeEvidenceHead ? 'formal mode requires SURDET_CODE_EVIDENCE_HEAD' : null,
      codeEvidenceHead && gitAfter.runHead !== codeEvidenceHead
        ? `runHead === codeEvidenceHead failed: ${gitAfter.runHead} != ${codeEvidenceHead}`
        : null,
      gitAfter.trackedCodeDiffPaths.length > 0
        ? `formal tracked diff is not empty: ${gitAfter.trackedCodeDiffPaths.join(', ')}`
        : null,
      !runnerCommitMatches
        ? `formal runner is not byte-equal to its committed blob: ${JSON.stringify({ runnerIdentity, committedRunnerIdentity })}`
        : null,
      requiredPathMismatches.length > 0
        ? `formal required tracked paths are missing or changed: ${requiredPathMismatches.map(({ committed }) => committed.path).join(', ')}`
        : null,
    ].filter(Boolean);
    if (formalFailures.length > 0 && failure === null) {
      failure = formalFailures.join(' | ');
      channels.errors.push(failure);
    }
  }
  pass('isolated-process-cleanup', {
    port,
    portReleased,
    serverPid: server?.pid ?? null,
    browserClosed,
    childCleanupFailures: channels.childCleanupFailures,
  });
  const completedMilestoneNames = milestones.filter((milestone) => milestone.status === 'passed').map((milestone) => milestone.name);
  const milestoneSequenceMatches = JSON.stringify(completedMilestoneNames) === JSON.stringify(MILESTONE_IDS);
  if (!milestoneSequenceMatches && failure === null) {
    failure = `milestone sequence mismatch: ${JSON.stringify({ expected: MILESTONE_IDS, actual: completedMilestoneNames })}`;
    channels.errors.push(failure);
  }

  const runnerSha256 = runnerIdentity.sha256;
  const evidence = {
    schemaVersion: 1,
    evidenceClass: evidenceClassForMode(mode),
    mode,
    status: failure === null && milestoneSequenceMatches ? 'PASSED' : 'FAILED',
    runner: runnerIdentity,
    runnerSha256,
    runnerPath,
    repoRoot,
    editorRoot,
    starterRoot,
    artifactDirectory,
    port,
    forbiddenPorts: FORBIDDEN_PORTS,
    searchRange: SEARCH_RANGE,
    portReleased,
    starterBefore,
    starterAfter,
    originalStarterUnchanged: starterBefore.sha256 === starterAfter.sha256,
    fixtureTreeBefore,
    fixtureTreeAfter,
    fixtureAugmentations: fixture.fixtureAugmentations,
    fixturePhysicalFileCount: expectedPhysicalCount,
    fixtureMeasuredBytes: expectedBytes,
    projectMutation: fixtureTreeAfter?.sha256 !== fixtureTreeBefore.sha256,
    screenshots,
    milestones,
    errors: channels.errors,
    consoleErrors: channels.consoleErrors,
    pageErrors: channels.pageErrors,
    requestFailures: channels.requestFailures,
    responseFailures: channels.responseFailures,
    childCleanupFailures: channels.childCleanupFailures,
    serverStdout: serverStdout.join('').split(/\r?\n/).filter(Boolean),
    serverStderr: serverStderr.join('').split(/\r?\n/).filter(Boolean),
    git: {
      runHead: gitAfter.runHead,
      codeEvidenceHead,
      trackedCodeDiffPaths: gitAfter.trackedCodeDiffPaths,
      runHeadMatchesCodeEvidence: codeEvidenceHead === null ? null : gitAfter.runHead === codeEvidenceHead,
      committedRunnerIdentity,
      runnerCommitMatches: codeEvidenceHead === null ? null : runnerCommitMatches,
      formalRequiredPathIdentities,
    },
    baselineGit: gitBefore,
  };
  const evidenceIdentity = writeExclusiveJson(evidencePath, evidence);
  const identity = writeExclusiveJson(identityPath, {
    evidence: evidenceIdentity,
    runnerSha256,
    runHead: gitAfter.runHead,
    codeEvidenceHead,
    status: evidence.status,
  });
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    mode,
    artifactDirectory,
    evidence: evidenceIdentity,
    identity,
    runHead: gitAfter.runHead,
    codeEvidenceHead,
    trackedCodeDiffPaths: gitAfter.trackedCodeDiffPaths,
    port,
    portReleased,
    milestones: milestones.map(({ name, status }) => ({ name, status })),
    screenshots,
    error: failure,
  }, null, 2)}\n`);
  if (evidence.status !== 'PASSED') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(runnerPath)) {
  await run();
}
