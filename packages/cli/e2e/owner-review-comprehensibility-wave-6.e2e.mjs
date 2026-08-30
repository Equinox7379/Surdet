import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright';
import { prepareAcceptance } from './agent-candidate-composition-wave-5.e2e.mjs';

export const MODES = ['preflight', 'diagnostic', 'formal'];
export const DIAGNOSTIC_BUDGET = 2;
export const FORMAL_RUN_BUDGET = 1;
export const MILESTONE_IDS = Object.freeze([
  'launcher-and-baseline',
  'comparison-workspace-created',
  'localized-task-visible',
  'review-ordinal-explained',
  'identical-provenance-visible',
  'conflict-content-distinguishable',
  'technical-details-lazy',
  'decision-saved-exact-unit',
  'decision-reopened-readonly',
  'project-and-starter-unchanged',
  'cleanup-and-identity',
]);

const runnerPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(runnerPath);
const repoRoot = path.resolve(scriptDirectory, '../../..');
const portEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'agent-port', 'main.js');
const editorRoot = path.join(repoRoot, 'packages', 'editor');
const editorIndex = path.join(repoRoot, 'packages', 'editor', 'dist', 'index.html');
const editorPreview = path.join(repoRoot, 'packages', 'editor', 'dist', 'preview.html');
const starterRoot = path.join(repoRoot, 'examples', 'starter');
const runHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const codeEvidenceHead = process.env['SURDET_CODE_EVIDENCE_HEAD']?.trim() ?? '';
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(runnerPath)).digest('hex');
const allowedWorkflowTools = Object.freeze([
  'surdet_composition_compare',
  'surdet_review_prepare_comparison',
]);
const issueChannels = Object.freeze([
  'errors',
  'protocolErrors',
  'consoleErrors',
  'pageErrors',
  'requestFailures',
  'stderrLines',
  'childCleanupFailures',
  'activeLeaseDirectories',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function modeFromArgv() {
  const equal = process.argv.find((value) => value.startsWith('--mode='));
  if (equal !== undefined) return equal.slice('--mode='.length);
  const index = process.argv.indexOf('--mode');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

export function reviewSourceLabel(displayOrdinal) {
  return `方案 ${displayOrdinal}`;
}

export function blockingRunIssues(channels) {
  return issueChannels.filter((channel) => !Array.isArray(channels?.[channel]) || channels[channel].length > 0);
}

export function isFocusedEvidenceSatisfied(evidence) {
  const milestoneIds = evidence?.milestones?.map((entry) => entry?.id);
  const milestonesPass = Array.isArray(evidence?.milestones)
    && evidence.milestones.length === MILESTONE_IDS.length
    && milestoneIds.every((id, index) => id === MILESTONE_IDS[index])
    && evidence.milestones.every((entry, index) => entry?.ordinal === index + 1 && entry?.status === 'PASSED');
  const localized = evidence?.localizedTask;
  const ordinal = evidence?.ordinalEvidence;
  const identical = evidence?.identicalProvenance;
  const conflict = evidence?.conflictEvidence;
  const technical = evidence?.technicalEvidence;
  const decision = evidence?.decisionEvidence;
  const diskBefore = decision?.diskBefore;
  const diskAfter = decision?.diskAfter;
  const marker = decision?.receiptMarker;
  const issues = blockingRunIssues(evidence);
  return evidence?.status === 'PASSED'
    && milestonesPass
    && localized?.visible === true
    && localized?.title === '候选创作方案审阅'
    && ordinal?.visible === true
    && typeof ordinal?.text === 'string'
    && ordinal.text.includes('方案字母只用于本次审阅排序')
    && identical?.primaryObject === 'scene:wave5_alpha'
    && identical?.sourceCount === 2
    && sameStringSet(identical?.fixtureLabels, ['A', 'D'])
    && typeof identical?.contentVisible === 'string'
    && identical.contentVisible.includes('Alpha route A.')
    && typeof conflict?.aUnitId === 'string'
    && conflict.aUnitId.length > 0
    && typeof conflict?.cUnitId === 'string'
    && conflict.cUnitId.length > 0
    && conflict.aUnitId !== conflict.cUnitId
    && conflict?.distinguishable === true
    && typeof conflict?.aCardText === 'string'
    && conflict.aCardText.includes('lynn：Alpha route A.')
    && !conflict.aCardText.includes('Alpha route C.')
    && typeof conflict?.cCardText === 'string'
    && conflict.cCardText.includes('lynn：Alpha route C.')
    && !conflict.cCardText.includes('Alpha route A.')
    && conflict.aCardText !== conflict.cCardText
    && typeof conflict?.aButtonText === 'string'
    && conflict.aButtonText.includes('选择方案')
    && conflict.aButtonText.includes('新建场景')
    && conflict.aButtonText.includes('场景 wave5_alpha')
    && typeof conflict?.cButtonText === 'string'
    && conflict.cButtonText.includes('选择方案')
    && conflict.cButtonText.includes('新建场景')
    && conflict.cButtonText.includes('场景 wave5_alpha')
    && technical?.defaultTechnicalIdsVisible === false
    && technical?.expandedUnitId === conflict.aUnitId
    && typeof technical?.expandedCandidateId === 'string'
    && technical.expandedCandidateId.length > 0
    && typeof technical?.expandedFinalFingerprint === 'string'
    && technical.expandedFinalFingerprint.length === 64
    && typeof technical?.expandedCapsuleId === 'string'
    && technical.expandedCapsuleId.length > 0
    && decision?.chosenUnitId === conflict.aUnitId
    && Array.isArray(decision?.selectedUnitIds)
    && decision.selectedUnitIds.includes(conflict.aUnitId)
    && !decision.selectedUnitIds.includes(conflict.cUnitId)
    && decision?.excludedUnitId === conflict.cUnitId
    && typeof decision?.decisionId === 'string'
    && decision.decisionId.length > 0
    && typeof decision?.decisionFingerprint === 'string'
    && decision.decisionFingerprint.length === 64
    && Number.isInteger(diskBefore?.bytes)
    && diskBefore.bytes > 0
    && typeof diskBefore?.sha256 === 'string'
    && diskBefore.sha256.length === 64
    && diskAfter?.bytes === diskBefore.bytes
    && diskAfter?.sha256 === diskBefore.sha256
    && marker?.present === true
    && marker?.decisionId === decision.decisionId
    && marker?.decisionFingerprint === decision.decisionFingerprint
    && typeof marker?.text === 'string'
    && marker.text.includes('已读取已保存的决定')
    && decision?.restoredChoiceVisible === true
    && decision?.decisionControlsReadonly === true
    && decision?.decisionReceiptCount === 1
    && sameStringSet(evidence?.toolsCalled, allowedWorkflowTools)
    && Array.isArray(evidence?.prohibitedToolCalls)
    && evidence.prohibitedToolCalls.length === 0
    && evidence?.projectMutation?.occurred === false
    && evidence?.originalStarterUnchanged === true
    && evidence?.projectFixtureUnchanged === true
    && issues.length === 0;
}

function writeExclusiveJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const descriptor = fs.openSync(file, 'wx');
  try {
    fs.writeSync(descriptor, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return readFileIdentity(file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { path: path.resolve(file), bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function writeArtifact(directory, payload) {
  const artifactPath = path.join(directory, 'evidence.json');
  const identityPath = path.join(directory, 'identity.json');
  const identity = writeExclusiveJson(artifactPath, payload);
  writeExclusiveJson(identityPath, identity);
  const reread = readFileIdentity(artifactPath);
  assert(reread.bytes === identity.bytes && reread.sha256 === identity.sha256, 'artifact read-back identity mismatch');
  return { artifactPath, identityPath, identity };
}

function writeMilestone(directory, entry) {
  const ordinal = String(entry.ordinal).padStart(2, '0');
  return writeExclusiveJson(path.join(directory, 'milestones', `${ordinal}-${entry.id}.json`), entry);
}

function hashTree(root) {
  const files = [];
  const excluded = new Set(['.git', 'node_modules', 'dist', '.vite']);
  function visit(directory, relativeDirectory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (excluded.has(entry.name) || entry.name.startsWith('.surdet-')) continue;
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({ path: relative.split(path.sep).join('/'), bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
    }
  }
  visit(root, '');
  const serialized = files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join('\n');
  return {
    path: path.resolve(root),
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
    files,
  };
}

function copyStarter(destination) {
  fs.cpSync(starterRoot, destination, {
    recursive: true,
    filter(source) {
      const relative = path.relative(starterRoot, source);
      return relative.length === 0 || !relative.split(path.sep).some((part) => ['node_modules', 'dist', '.vite'].includes(part));
    },
  });
}

function trackedCodeDiffPaths() {
  const raw = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoRoot, encoding: 'utf8' });
  return raw.split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .sort();
}

function stagedPaths() {
  const raw = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot, encoding: 'utf8' });
  return raw.split(/\r?\n/).filter(Boolean).sort();
}

function findActiveLeaseDirectories(dataDir) {
  const result = [];
  const stack = [dataDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name === '.locks') {
        const lockStack = [full];
        while (lockStack.length > 0) {
          const lockRoot = lockStack.pop();
          let lockEntries;
          try { lockEntries = fs.readdirSync(lockRoot, { withFileTypes: true }); } catch { continue; }
          for (const lockEntry of lockEntries) {
            if (!lockEntry.isDirectory()) continue;
            const lockPath = path.join(lockRoot, lockEntry.name);
            if (['changes', 'projects', 'stale'].includes(lockEntry.name)) {
              if (lockEntry.name !== 'stale') lockStack.push(lockPath);
            } else result.push(lockPath);
          }
        }
      } else stack.push(full);
    }
  }
  return result.sort();
}

function listIntegrationChangeManifests(dataDir) {
  const manifests = [];
  const stack = [dataDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name.startsWith('chg_')) {
        const manifestPath = path.join(full, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = readJson(manifestPath);
          if (manifest.integration === true) manifests.push({ path: manifestPath, changeId: manifest.changeId });
        }
      } else stack.push(full);
    }
  }
  return manifests;
}

function countFilesNamed(root, name) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === name) count += 1;
    }
  }
  return count;
}

function createHarness() {
  return {
    ports: new Set(), server: null, serverStdout: '', browser: null, page: null,
    toolsCalled: [], protocolErrors: [], consoleErrors: [], pageErrors: [], requestFailures: [],
    stderrLines: [], childCleanupFailures: [],
  };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForPidExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return !pidAlive(pid);
}

function connectPort(harness, { projectRoot, dataDir, policy = 'observe' }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [portEntry, '--project', projectRoot, '--policy', policy],
    cwd: repoRoot,
    env: { ...process.env, SURDET_AGENT_DATA_DIR: dataDir },
    stderr: 'pipe',
  });
  const protocolErrors = [];
  let stderr = '';
  transport.onerror = (error) => protocolErrors.push(errorText(error));
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const client = new Client({ name: 'surdet-owner-review-comprehensibility-wave6', version: '1.0.0' });
  const port = { client, transport, protocolErrors, stderr: () => stderr, closed: false };
  harness.ports.add(port);
  port.connectPromise = client.connect(transport);
  return port;
}

async function closePort(harness, port) {
  if (port === undefined || port.closed) return;
  port.closed = true;
  try { await port.client.close(); } catch (error) { harness.childCleanupFailures.push(`client.close: ${errorText(error)}`); }
  const pid = port.transport.pid;
  try { await port.transport.close(); } catch (error) { harness.childCleanupFailures.push(`transport.close: ${errorText(error)}`); }
  if (Number.isInteger(pid) && !(await waitForPidExit(pid))) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
    if (!(await waitForPidExit(pid))) harness.childCleanupFailures.push(`MCP child remained: ${pid}`);
  }
  harness.protocolErrors.push(...port.protocolErrors);
  harness.stderrLines.push(...port.stderr().split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Surdet Agent Port ready:')));
  harness.ports.delete(port);
}

async function withPort(harness, options, action) {
  const port = connectPort(harness, options);
  try {
    await port.connectPromise;
    return await action(port);
  } finally {
    await closePort(harness, port);
  }
}

async function callTool(harness, port, name, args = {}) {
  harness.toolsCalled.push(name);
  const response = await port.client.callTool({ name, arguments: args });
  const envelope = response?.structuredContent;
  assert(envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope),
    `${name} returned no structuredContent; isError=${String(response?.isError)}`);
  return envelope;
}

function resultOf(envelope, label) {
  assert(envelope?.ok === true, `${label} failed: ${JSON.stringify(envelope?.error ?? envelope)}`);
  return envelope.result;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  assert(port > 0, 'failed to allocate local port');
  return port;
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = errorText(error); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Editor preview did not become ready: ${lastError}`);
}

async function startVite(harness) {
  assert(fs.existsSync(editorIndex), `Editor build entry missing: ${editorIndex}`);
  assert(fs.existsSync(editorPreview), `Editor preview entry missing: ${editorPreview}`);
  const viteEntry = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  assert(fs.existsSync(viteEntry), `Vite launcher missing: ${viteEntry}`);
  const port = await freePort();
  const child = spawn(process.execPath, [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: editorRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  harness.server = child;
  child.stdout.on('data', (chunk) => { harness.serverStdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => {
    harness.stderrLines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
  });
  await waitForHttp(`http://127.0.0.1:${port}/index.html`);
  return `http://127.0.0.1:${port}`;
}

async function closeServer(harness) {
  const child = harness.server;
  if (child === null) return;
  harness.server = null;
  const pid = child.pid;
  if (child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  if (Number.isInteger(pid) && !(await waitForPidExit(pid))) {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
    if (!(await waitForPidExit(pid))) harness.childCleanupFailures.push(`Vite child remained: ${pid}`);
  }
}

function fileMapForDirectory(root) {
  const files = [];
  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push({ path: relative.replaceAll('\\', '/'), bytes: fs.readFileSync(absolute).toString('base64') });
    }
  }
  visit(root, '');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

const fakeFileSystemInit = ({ files }) => {
  const fileMap = new Map(files.map((file) => [file.path, file.bytes]));
  const directories = new Set(['']);
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current.length === 0 ? part : `${current}/${part}`;
      directories.add(current);
    }
  }
  const failure = (message) => { throw new DOMException(message, 'NotFoundError'); };
  const bytesFromValue = async (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
    return new Uint8Array();
  };
  const mimeFor = (name) => name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  const makeFile = (filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    async getFile() {
      if (!fileMap.has(filePath)) failure(`missing file ${filePath}`);
      const binary = Uint8Array.from(atob(fileMap.get(filePath)), (character) => character.charCodeAt(0));
      return new File([binary], filePath.split('/').pop(), { type: mimeFor(filePath), lastModified: 0 });
    },
    async createWritable() {
      return {
        async write(value) {
          const bytes = await bytesFromValue(value);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          fileMap.set(filePath, btoa(binary));
        },
        async close() {},
      };
    },
  });
  const makeDirectory = (directoryPath) => ({
    kind: 'directory',
    name: directoryPath.length === 0 ? 'review-root' : directoryPath.split('/').pop(),
    async getFileHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      if (!fileMap.has(child) && !options.create) failure(`missing file ${child}`);
      if (!fileMap.has(child)) fileMap.set(child, '');
      return makeFile(child);
    },
    async getDirectoryHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      if (!directories.has(child) && !options.create) failure(`missing directory ${child}`);
      directories.add(child);
      return makeDirectory(child);
    },
    values() {
      const children = new Map();
      const prefix = directoryPath.length === 0 ? '' : `${directoryPath}/`;
      for (const directory of directories) {
        if (!directory.startsWith(prefix) || directory === directoryPath) continue;
        const rest = directory.slice(prefix.length);
        if (!rest.includes('/')) children.set(rest, makeDirectory(directory));
      }
      for (const filePath of fileMap.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest.includes('/')) children.set(rest, makeFile(filePath));
      }
      return (async function* values() {
        for (const child of [...children.values()].sort((left, right) => left.name.localeCompare(right.name))) yield child;
      }());
    },
    async removeEntry(name) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      fileMap.delete(child);
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.__surdetOwnerReviewDumpRoot = () => [...fileMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, bytes]) => ({ path: filePath, bytes }));
  window.showDirectoryPicker = async () => makeDirectory('');
};

async function startBrowser(harness, editorUrl, reviewRoot) {
  const browser = await chromium.launch({ headless: true });
  harness.browser = browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  harness.page = page;
  page.on('console', (message) => { if (message.type() === 'error') harness.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => harness.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => harness.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  await page.addInitScript(fakeFileSystemInit, { files: fileMapForDirectory(reviewRoot) });
  await page.goto(`${editorUrl}/index.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开审阅任务' }).waitFor();
  return page;
}

async function closeBrowser(harness) {
  harness.page = null;
  if (harness.browser !== null) {
    try { await harness.browser.close(); } catch (error) { harness.childCleanupFailures.push(`browser.close: ${errorText(error)}`); }
    harness.browser = null;
  }
}

async function cleanupHarness(harness) {
  await closeBrowser(harness);
  await closeServer(harness);
  for (const port of [...harness.ports]) await closePort(harness, port);
}

async function dumpBrowserRoot(page, destination) {
  const files = await page.evaluate(() => window.__surdetOwnerReviewDumpRoot());
  for (const file of files) {
    const target = path.join(destination, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.bytes, 'base64'));
  }
  return { files, tree: hashTree(destination) };
}

function sameCandidateRef(left, right) {
  return left?.changeId === right?.changeId
    && left?.capsuleId === right?.capsuleId
    && left?.artifactSha256 === right?.artifactSha256;
}

function resolveProjectedCandidates(projection, candidateRefs) {
  return Object.fromEntries(Object.entries(candidateRefs).map(([label, ref]) => {
    const matches = projection.candidates.filter((candidate) => sameCandidateRef(candidate.ref, ref));
    assert(matches.length === 1, `fixture ${label} resolved to ${matches.length} projected candidates`);
    return [label, matches[0]];
  }));
}

async function visible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) if (await locator.nth(index).isVisible()) return true;
  return false;
}

async function readDecisionMarker(page) {
  const marker = page.locator('[data-decision-receipt]').first();
  if (await marker.count() === 0) return { present: false };
  return marker.evaluate((node) => ({
    present: true,
    text: node.textContent,
    decisionId: node.getAttribute('data-decision-id'),
    decisionFingerprint: node.getAttribute('data-decision-fingerprint'),
  }));
}

async function readDecisionControls(page) {
  return page.locator([
    '[data-choice-unit]',
    '[data-choice-exclude]',
    '[data-choice-regenerate]',
    '[data-action="save-decision"]',
  ].join(',')).evaluateAll((nodes) => nodes.map((node) => ({
    action: node.getAttribute('data-action') ?? (node.hasAttribute('data-choice-unit') ? 'choose-unit' : 'other'),
    unitId: node.getAttribute('data-choice-unit'),
    disabled: node instanceof HTMLButtonElement ? node.disabled : null,
    selected: node.getAttribute('data-choice-selected'),
  })));
}

async function captureBrowserFailure(page) {
  if (page === null) return null;
  try {
    return {
      status: await page.locator('#status').textContent().catch(() => null),
      visibleText: await page.locator('body').innerText().catch(() => null),
      receipts: await page.evaluate(() => window.__surdetOwnerReviewDumpRoot?.()
        ?.filter((file) => ['decision.json', 'final-approval.json', 'return-request.json'].includes(file.path)) ?? []),
    };
  } catch (error) {
    return { captureError: errorText(error) };
  }
}

async function runWorkflow(modeName) {
  const harness = createHarness();
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-owner-review-comprehensibility-${modeName}-`));
  const artifactDirectory = path.join(runDirectory, 'artifact');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const starterBefore = hashTree(starterRoot);
  const milestones = [];
  let ordinal = 0;
  let lastPassedNode = null;
  let firstFailedNode = null;
  let failure = null;
  let fixtures = null;
  let comparison = null;
  let comparisonReview = null;
  let projectedCandidates = null;
  let sceneUnitA = null;
  let sceneUnitC = null;
  let sceneUnitD = null;
  let sceneUnitB = null;
  let timelineUnitB = null;
  let selectionConflict = null;
  let page = null;
  let reviewRoot = null;
  let localizedTask = null;
  let ordinalEvidence = null;
  let identicalProvenance = null;
  let conflictEvidence = null;
  let technicalEvidence = null;
  let decisionEvidence = null;
  let originalStarterUnchanged = false;
  let projectFixtureUnchanged = false;
  let projectMutation = { occurred: false };
  let browserFailureEvidence = null;

  const milestone = async (id, action) => {
    assert(id === MILESTONE_IDS[ordinal], `milestone order mismatch: expected ${MILESTONE_IDS[ordinal]}, got ${id}`);
    ordinal += 1;
    try {
      const detail = await action();
      const entry = { ordinal, id, status: 'PASSED', detail };
      entry.artifact = writeMilestone(artifactDirectory, entry);
      milestones.push(entry);
      lastPassedNode = id;
      return detail;
    } catch (error) {
      firstFailedNode ??= id;
      const entry = { ordinal, id, status: 'FAILED', error: errorText(error).slice(0, 4000) };
      entry.artifact = writeMilestone(artifactDirectory, entry);
      milestones.push(entry);
      throw error;
    }
  };

  try {
    await milestone('launcher-and-baseline', async () => {
      assert(path.resolve(process.cwd()) === repoRoot, `runner cwd mismatch: ${process.cwd()}`);
      assert(fs.existsSync(portEntry), `CLI dist Agent Port entry missing: ${portEntry}`);
      assert(fs.existsSync(editorIndex) && fs.existsSync(editorPreview), 'Editor build entries are missing');
      const tracked = trackedCodeDiffPaths();
      const staged = stagedPaths();
      if (modeName === 'formal') {
        assert(codeEvidenceHead.length > 0, 'FORMAL requires SURDET_CODE_EVIDENCE_HEAD');
        assert(runHead === codeEvidenceHead, `FORMAL runHead ${runHead} differs from codeEvidenceHead ${codeEvidenceHead}`);
        assert(tracked.length === 0, `FORMAL trackedCodeDiffPaths not empty: ${JSON.stringify(tracked)}`);
        assert(staged.length === 0, `FORMAL staging not empty: ${JSON.stringify(staged)}`);
      }
      return { cwd: repoRoot, portEntry, editorIndex, editorPreview, runHead, codeEvidenceHead: codeEvidenceHead || null, tracked, staged };
    });

    await milestone('comparison-workspace-created', async () => {
      fixtures = await prepareAcceptance({ baseDirectory: runDirectory, prefix: 'fixture-' });
      const refsFile = readJson(path.join(fixtures.root, 'candidate-refs.json'));
      const candidateRefs = refsFile.candidates;
      assert(Object.keys(candidateRefs).sort().join(',') === 'A,B,C,D', 'fixture did not create A/B/C/D candidates');
      const refs = Object.values(candidateRefs);
      await withPort(harness, {
        projectRoot: fixtures.evidence.projectRoot,
        dataDir: fixtures.evidence.dataDir,
      }, async (port) => {
        comparison = resultOf(await callTool(harness, port, 'surdet_composition_compare', { candidateRefs: refs }), 'composition.compare');
        comparisonReview = resultOf(await callTool(harness, port, 'surdet_review_prepare_comparison', { candidateRefs: refs }), 'review.prepare-comparison');
      });
      const projection = comparisonReview.projection;
      projectedCandidates = resolveProjectedCandidates(projection, candidateRefs);
      const candidateId = (label) => projectedCandidates[label].candidateId;
      sceneUnitA = comparison.units.find((unit) => unit.primaryObject === 'scene:wave5_alpha' && unit.candidateId === candidateId('A'));
      sceneUnitC = comparison.units.find((unit) => unit.primaryObject === 'scene:wave5_alpha' && unit.candidateId === candidateId('C'));
      sceneUnitD = comparison.units.find((unit) => unit.primaryObject === 'scene:wave5_alpha' && unit.candidateId === candidateId('D'));
      sceneUnitB = comparison.units.find((unit) => unit.primaryObject === 'scene:wave5_beta' && unit.candidateId === candidateId('B'));
      timelineUnitB = comparison.units.find((unit) => unit.primaryObject === 'timeline:beta_opening' && unit.candidateId === candidateId('B'));
      selectionConflict = comparison.conflicts.find((item) => item.severity === 'selection-required'
        && item.unitIds.includes(sceneUnitA?.unitId) && item.unitIds.includes(sceneUnitC?.unitId));
      assert(sceneUnitA && sceneUnitC && sceneUnitD && sceneUnitB && timelineUnitB && selectionConflict,
        'comparison omitted required A/B/C/D content or selection conflict');
      assert(comparison.dependencyEdges.some((edge) => edge.fromUnitId === sceneUnitB.unitId && edge.toUnitId === timelineUnitB.unitId),
        'B scene/timeline dependency missing');
      reviewRoot = path.join(fixtures.evidence.dataDir, refsFile.projectIdentity, 'reviews', comparisonReview.reviewId);
      assert(fs.existsSync(path.join(reviewRoot, 'comparison', 'review.json')), 'comparison review payload missing on disk');
      assert(fs.existsSync(path.join(reviewRoot, 'identity.json')), 'comparison review identity missing on disk');
      return {
        fixtureRoot: fixtures.root,
        projectRoot: fixtures.evidence.projectRoot,
        dataDir: fixtures.evidence.dataDir,
        reviewRoot,
        reviewId: comparisonReview.reviewId,
        comparisonFingerprint: comparison.comparisonFingerprint,
        candidateRefs,
      };
    });

    await milestone('localized-task-visible', async () => {
      const editorUrl = await startVite(harness);
      page = await startBrowser(harness, editorUrl, reviewRoot);
      await page.getByRole('button', { name: '打开审阅任务' }).click();
      await page.getByRole('heading', { name: '比较结果' }).waitFor();
      const locator = page.getByText('候选创作方案审阅', { exact: true });
      localizedTask = { visible: await visible(locator), title: comparisonReview.projection.task.title };
      assert(localizedTask.visible && localizedTask.title === '候选创作方案审阅',
        `localized fallback task is not visible: ${JSON.stringify(localizedTask)}`);
      return localizedTask;
    });

    await milestone('review-ordinal-explained', async () => {
      const expected = '方案字母只用于本次审阅排序；请根据内容摘要选择，系统会用稳定来源身份保存决定。';
      const locator = page.getByText(expected, { exact: true });
      ordinalEvidence = { visible: await visible(locator), text: await locator.first().textContent() };
      assert(ordinalEvidence.visible, 'review-local ordinal explanation is not visible');
      for (const projected of Object.values(projectedCandidates)) {
        assert(await visible(page.getByText(`方案 ${projected.displayOrdinal}（本次审阅编号）`, { exact: true })),
          `review-local ordinal ${projected.displayOrdinal} is not visible`);
      }
      return ordinalEvidence;
    });

    await milestone('identical-provenance-visible', async () => {
      const projection = comparisonReview.projection;
      const expectedCandidateIds = [projectedCandidates.A.candidateId, projectedCandidates.D.candidateId];
      const group = projection.safeGroups.find((item) => item.primaryObject === 'scene:wave5_alpha'
        && item.sourceCount === 2 && expectedCandidateIds.every((candidateId) => item.candidateIds.includes(candidateId)));
      assert(group !== undefined, 'A/D identical scene safe group missing');
      const groupLocator = page.locator(`[data-safe-group="${group.groupId}"]`);
      await groupLocator.waitFor({ state: 'visible' });
      assert(await visible(groupLocator.getByText('内容结果相同，保留 2 个来源', { exact: true })), 'A/D source-count summary missing');
      assert(await groupLocator.evaluate((node) => node instanceof HTMLDetailsElement && node.open === false),
        'A/D safe group is not folded by default');
      await groupLocator.evaluate((node) => { node.open = true; });
      for (const label of ['A', 'D']) {
        assert(await visible(groupLocator.getByText(reviewSourceLabel(projectedCandidates[label].displayOrdinal), { exact: true })),
          `fixture ${label} provenance source is not visible`);
      }
      assert(await visible(groupLocator.getByText(/Alpha route A\./)), 'A/D shared content summary is not visible');
      identicalProvenance = {
        groupId: group.groupId,
        primaryObject: group.primaryObject,
        sourceCount: group.sourceCount,
        fixtureLabels: ['A', 'D'],
        candidateIds: expectedCandidateIds,
        contentVisible: 'Alpha route A.',
      };
      return identicalProvenance;
    });

    await milestone('conflict-content-distinguishable', async () => {
      const aCard = page.locator(`[data-choice-option-unit="${sceneUnitA.unitId}"]`);
      const cCard = page.locator(`[data-choice-option-unit="${sceneUnitC.unitId}"]`);
      const aButton = aCard.locator(`[data-choice-unit="${sceneUnitA.unitId}"]`);
      const cButton = cCard.locator(`[data-choice-unit="${sceneUnitC.unitId}"]`);
      await aCard.waitFor({ state: 'visible' });
      await cCard.waitFor({ state: 'visible' });
      await aButton.waitFor({ state: 'visible' });
      await cButton.waitFor({ state: 'visible' });
      assert(await aButton.isEnabled(), 'A choice button is disabled');
      assert(await cButton.isEnabled(), 'C choice button is disabled');
      const aCardText = await aCard.innerText();
      const cCardText = await cCard.innerText();
      const aButtonText = await aButton.innerText();
      const cButtonText = await cButton.innerText();
      conflictEvidence = {
        conflictId: selectionConflict.conflictId,
        aUnitId: sceneUnitA.unitId,
        cUnitId: sceneUnitC.unitId,
        aCardText,
        cCardText,
        aButtonText,
        cButtonText,
        distinguishable: aCardText !== cCardText,
      };
      assert(aCardText.includes('lynn：Alpha route A.') && !aCardText.includes('Alpha route C.'),
        `A choice card content is not exact: ${aCardText}`);
      assert(cCardText.includes('lynn：Alpha route C.') && !cCardText.includes('Alpha route A.'),
        `C choice card content is not exact: ${cCardText}`);
      for (const actionText of ['选择方案', '新建场景', '场景 wave5_alpha']) {
        assert(aButtonText.includes(actionText), `A choice button lacks ${actionText}: ${aButtonText}`);
        assert(cButtonText.includes(actionText), `C choice button lacks ${actionText}: ${cButtonText}`);
      }
      assert(aCardText !== cCardText, 'A and C choice cards are not visibly distinguishable');
      return conflictEvidence;
    });

    await milestone('technical-details-lazy', async () => {
      const projectionOption = comparisonReview.projection.conflicts
        .flatMap((conflict) => conflict.options)
        .find((option) => option.unitId === sceneUnitA.unitId);
      assert(projectionOption !== undefined, 'A projection option missing');
      const main = page.locator('.review-main');
      const defaultText = await main.innerText();
      const forbiddenByDefault = [
        sceneUnitA.unitId,
        projectedCandidates.A.candidateId,
        projectionOption.finalFingerprint,
        projectedCandidates.A.ref.capsuleId,
        projectedCandidates.A.ref.artifactSha256,
      ].filter((value) => typeof value === 'string' && value.length > 0);
      const defaultTechnicalIdsVisible = forbiddenByDefault.some((value) => defaultText.includes(value));
      assert(defaultTechnicalIdsVisible === false,
        `technical identity leaked into default layer: ${JSON.stringify(forbiddenByDefault.filter((value) => defaultText.includes(value)))}`);

      const choiceDetails = page.locator(`[data-choice-option-unit="${sceneUnitA.unitId}"] [data-choice-fingerprint]`);
      assert(await choiceDetails.evaluate((node) => node instanceof HTMLDetailsElement && node.open === false),
        'choice technical details are open by default');
      await choiceDetails.evaluate((node) => { node.open = true; });
      const choiceTechText = await choiceDetails.innerText();
      assert(choiceTechText.includes(sceneUnitA.unitId)
        && choiceTechText.includes(projectedCandidates.A.candidateId)
        && choiceTechText.includes(projectionOption.finalFingerprint), 'expanded choice technical identity is incomplete');

      const sourceDetails = page.locator(`[data-source-technical="${sceneUnitA.unitId}"]`);
      assert(await sourceDetails.evaluate((node) => node instanceof HTMLDetailsElement && node.open === false),
        'source technical details are open by default');
      await sourceDetails.evaluate((node) => { node.open = true; });
      const sourceTechText = await sourceDetails.innerText();
      assert(sourceTechText.includes(projectedCandidates.A.ref.capsuleId)
        && sourceTechText.includes(projectedCandidates.A.ref.artifactSha256), 'expanded source capsule identity is incomplete');
      technicalEvidence = {
        defaultTechnicalIdsVisible,
        expandedUnitId: sceneUnitA.unitId,
        expandedCandidateId: projectedCandidates.A.candidateId,
        expandedFinalFingerprint: projectionOption.finalFingerprint,
        expandedCapsuleId: projectedCandidates.A.ref.capsuleId,
        expandedArtifactSha256: projectedCandidates.A.ref.artifactSha256,
      };
      return technicalEvidence;
    });

    await milestone('decision-saved-exact-unit', async () => {
      await page.locator(`[data-choice-unit="${sceneUnitA.unitId}"]`).click();
      const save = page.locator('[data-action="save-decision"]');
      assert(await save.isEnabled(), 'save decision action did not become enabled');
      await save.click();
      await page.waitForFunction(() => {
        const text = document.querySelector('#status')?.textContent ?? '';
        return text === '已保存我的决定' || text.startsWith('保存决定失败：');
      });
      const statusText = await page.locator('#status').textContent();
      assert(statusText === '已保存我的决定', statusText ?? 'decision save returned no status');
      const dumped = await dumpBrowserRoot(page, reviewRoot);
      const decisionPath = path.join(reviewRoot, 'decision.json');
      assert(fs.existsSync(decisionPath), 'decision.json was not persisted');
      const decision = readJson(decisionPath);
      const chosen = decision.conflictResolutions.find((resolution) => resolution.conflictId === selectionConflict.conflictId);
      assert(chosen?.resolution === 'choose-unit' && chosen.chosenUnitId === sceneUnitA.unitId,
        `decision did not preserve exact A unit: ${JSON.stringify(chosen)}`);
      assert(decision.selectedUnitIds.includes(sceneUnitA.unitId), 'selectedUnitIds omitted exact A unit');
      assert(!decision.selectedUnitIds.includes(sceneUnitC.unitId), 'selectedUnitIds retained divergent C unit');
      const receiptFiles = dumped.files.filter((file) => ['decision.json', 'final-approval.json', 'return-request.json'].includes(file.path));
      assert(receiptFiles.length === 1 && receiptFiles[0].path === 'decision.json', 'comparison workspace contains an unexpected terminal receipt');
      decisionEvidence = {
        chosenUnitId: sceneUnitA.unitId,
        selectedUnitIds: decision.selectedUnitIds,
        excludedUnitId: sceneUnitC.unitId,
        decisionId: decision.decisionId,
        decisionFingerprint: decision.decisionFingerprint,
        diskBefore: readFileIdentity(decisionPath),
        saveStatus: statusText,
        receiptFilesAfterSave: receiptFiles.map((file) => file.path),
      };
      return decisionEvidence;
    });

    await milestone('decision-reopened-readonly', async () => {
      const previousWorkbench = await page.locator('.review-workbench').elementHandle();
      await page.getByRole('button', { name: '打开审阅任务' }).click();
      if (previousWorkbench !== null) await page.waitForFunction((node) => !node.isConnected, previousWorkbench);
      const markerLocator = page.locator('[data-decision-receipt]').first();
      await markerLocator.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#status')?.textContent === '已打开审阅任务');
      const marker = await readDecisionMarker(page);
      const restoredChoice = page.locator(`[data-choice-unit="${sceneUnitA.unitId}"][data-choice-selected="true"]`);
      await restoredChoice.waitFor({ state: 'visible' });
      const controls = await readDecisionControls(page);
      assert(controls.length > 0 && controls.every((control) => control.disabled === true),
        `reopened decision left writable controls: ${JSON.stringify(controls)}`);
      const snapshot = await page.evaluate(() => window.__surdetOwnerReviewDumpRoot());
      const receipts = snapshot.filter((file) => ['decision.json', 'final-approval.json', 'return-request.json'].includes(file.path));
      const diskAfter = readFileIdentity(path.join(reviewRoot, 'decision.json'));
      assert(marker.present === true
        && marker.decisionId === decisionEvidence.decisionId
        && marker.decisionFingerprint === decisionEvidence.decisionFingerprint
        && marker.text.includes('已读取已保存的决定'), `reopened marker identity mismatch: ${JSON.stringify(marker)}`);
      assert(diskAfter.bytes === decisionEvidence.diskBefore.bytes && diskAfter.sha256 === decisionEvidence.diskBefore.sha256,
        'decision receipt changed during reopen');
      assert(receipts.length === 1 && receipts[0].path === 'decision.json', 'reopen created or selected another receipt');
      decisionEvidence = {
        ...decisionEvidence,
        diskAfter,
        receiptMarker: marker,
        restoredChoiceVisible: await restoredChoice.isVisible(),
        decisionControlsReadonly: controls.every((control) => control.disabled === true),
        readonlyControls: controls,
        decisionReceiptCount: receipts.length,
      };
      return decisionEvidence;
    });

    await milestone('project-and-starter-unchanged', async () => {
      const projectAfter = hashTree(fixtures.evidence.projectRoot);
      const starterAfter = hashTree(starterRoot);
      projectFixtureUnchanged = projectAfter.sha256 === fixtures.evidence.projectTree.sha256;
      originalStarterUnchanged = starterAfter.sha256 === starterBefore.sha256;
      projectMutation = { occurred: !projectFixtureUnchanged };
      const integrationChanges = listIntegrationChangeManifests(fixtures.evidence.dataDir);
      const approvalCount = countFilesNamed(fixtures.evidence.dataDir, 'final-approval.json');
      const returnCount = countFilesNamed(fixtures.evidence.dataDir, 'return-request.json');
      const prohibitedToolCalls = harness.toolsCalled.filter((name) => !allowedWorkflowTools.includes(name));
      assert(projectFixtureUnchanged, 'comparison workflow mutated the fixture project');
      assert(originalStarterUnchanged, 'comparison workflow mutated original Starter');
      assert(integrationChanges.length === 0, `comparison workflow created integration changes: ${JSON.stringify(integrationChanges)}`);
      assert(approvalCount === 0 && returnCount === 0, 'comparison workflow created a result receipt');
      assert(prohibitedToolCalls.length === 0, `comparison workflow called prohibited tools: ${prohibitedToolCalls.join(', ')}`);
      return {
        projectBefore: fixtures.evidence.projectTree,
        projectAfter,
        starterBefore,
        starterAfter,
        projectFixtureUnchanged,
        originalStarterUnchanged,
        integrationChanges,
        resultReceiptCounts: { approval: approvalCount, return: returnCount },
        toolsCalled: harness.toolsCalled,
        prohibitedToolCalls,
      };
    });
  } catch (error) {
    failure = error;
    browserFailureEvidence = await captureBrowserFailure(page);
  } finally {
    try { await cleanupHarness(harness); } catch (error) { harness.childCleanupFailures.push(`cleanupHarness: ${errorText(error)}`); }
  }

  const activeLeaseDirectories = fixtures === null ? [] : findActiveLeaseDirectories(fixtures.evidence.dataDir);
  if (failure === null) {
    try {
      await milestone('cleanup-and-identity', async () => {
        const channels = {
          errors: [], protocolErrors: harness.protocolErrors, consoleErrors: harness.consoleErrors,
          pageErrors: harness.pageErrors, requestFailures: harness.requestFailures, stderrLines: harness.stderrLines,
          childCleanupFailures: harness.childCleanupFailures, activeLeaseDirectories,
        };
        const issues = blockingRunIssues(channels);
        assert(issues.length === 0, `blocking issue channels remain: ${issues.join(', ')}`);
        return {
          runHead,
          runnerSha256,
          trackedCodeDiffPaths: trackedCodeDiffPaths(),
          stagedPaths: stagedPaths(),
          childStdoutCapturedNotForwarded: harness.serverStdout.length,
          blockingIssueChannels: issues,
        };
      });
    } catch (error) { failure = error; }
  }

  const errors = failure === null ? [] : [errorText(failure).slice(0, 4000)];
  const prohibitedToolCalls = harness.toolsCalled.filter((name) => !allowedWorkflowTools.includes(name));
  const channels = {
    errors,
    protocolErrors: harness.protocolErrors,
    consoleErrors: harness.consoleErrors,
    pageErrors: harness.pageErrors,
    requestFailures: harness.requestFailures,
    stderrLines: harness.stderrLines,
    childCleanupFailures: harness.childCleanupFailures,
    activeLeaseDirectories,
  };
  const blockingIssueChannels = blockingRunIssues(channels);
  const payload = {
    status: failure === null && blockingIssueChannels.length === 0 ? 'PASSED' : 'FAILED',
    evidenceClass: modeName === 'formal' ? 'FORMAL' : 'DIAGNOSTIC',
    mode: modeName,
    runHead,
    codeEvidenceHead: codeEvidenceHead || null,
    runnerSha256,
    trackedCodeDiffPaths: trackedCodeDiffPaths(),
    stagedPaths: stagedPaths(),
    milestones,
    lastPassedNode,
    firstFailedNode,
    localizedTask,
    ordinalEvidence,
    identicalProvenance,
    conflictEvidence,
    technicalEvidence,
    decisionEvidence,
    toolsCalled: harness.toolsCalled,
    prohibitedToolCalls,
    projectMutation,
    originalStarterUnchanged,
    projectFixtureUnchanged,
    fixture: fixtures === null ? null : {
      root: fixtures.root,
      projectRoot: fixtures.evidence.projectRoot,
      dataDir: fixtures.evidence.dataDir,
      prepEvidence: fixtures.artifactIdentity,
      sourceCandidates: fixtures.evidence.sourceCandidates,
    },
    comparisonReview: comparisonReview === null ? null : {
      reviewId: comparisonReview.reviewId,
      comparisonFingerprint: comparison?.comparisonFingerprint ?? null,
      reviewFingerprint: comparisonReview.projection?.reviewFingerprint ?? null,
      reviewRoot,
    },
    browserFailureEvidence,
    ...channels,
    blockingIssueChannels,
  };
  if (payload.status === 'PASSED' && !isFocusedEvidenceSatisfied(payload)) {
    payload.status = 'FAILED';
    payload.firstFailedNode = 'focused-evidence-contract';
    payload.errors.push('focused evidence predicate rejected the completed workflow');
    payload.blockingIssueChannels = blockingRunIssues(payload);
  }
  const artifact = writeArtifact(artifactDirectory, payload);
  return { ...payload, artifactPath: artifact.artifactPath, identityPath: artifact.identityPath, artifactIdentity: artifact.identity };
}

async function runPreflight() {
  const harness = createHarness();
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-owner-review-comprehensibility-preflight-'));
  const artifactDirectory = path.join(runDirectory, 'artifact');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const fixtureRoot = path.join(runDirectory, 'fixture');
  const dataDir = path.join(runDirectory, 'agent-data');
  const starterBefore = hashTree(starterRoot);
  let failure = null;
  let checks = null;
  try {
    assert(path.resolve(process.cwd()) === repoRoot, `preflight cwd mismatch: ${process.cwd()}`);
    assert(fs.existsSync(portEntry), `CLI dist Agent Port entry missing: ${portEntry}`);
    assert(fs.existsSync(editorIndex) && fs.existsSync(editorPreview), 'Editor build entries missing');
    copyStarter(fixtureRoot);
    fs.mkdirSync(dataDir, { recursive: true });
    const fixtureBefore = hashTree(fixtureRoot);
    const editorUrl = await startVite(harness);
    const response = await fetch(`${editorUrl}/index.html`);
    const html = await response.text();
    assert(response.ok && html.includes('<title>Surdet 剧本编辑器</title>'), 'Editor build entry did not serve expected HTML');
    const portFacts = await withPort(harness, { projectRoot: fixtureRoot, dataDir }, async (port) => {
      const listed = await port.client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      const capabilities = resultOf(await callTool(harness, port, 'surdet_capabilities_describe'), 'capabilities.describe');
      resultOf(await callTool(harness, port, 'surdet_session_describe'), 'session.describe');
      resultOf(await callTool(harness, port, 'surdet_project_inspect'), 'project.inspect');
      assert(names.includes('surdet_composition_compare') && names.includes('surdet_review_prepare_comparison'),
        'focused review tools missing from formal launcher');
      return { toolCount: names.length, contractVersion: capabilities.contractVersion, reviewToolsPresent: true };
    });
    const fixtureAfter = hashTree(fixtureRoot);
    const starterAfter = hashTree(starterRoot);
    assert(fixtureAfter.sha256 === fixtureBefore.sha256, 'preflight launcher mutated fixture');
    assert(starterAfter.sha256 === starterBefore.sha256, 'preflight mutated original Starter');
    checks = {
      cwd: repoRoot,
      portEntry,
      editorIndex,
      editorPreview,
      editorHttp: { url: `${editorUrl}/index.html`, status: response.status, expectedTitle: true },
      stdoutPurity: 'MCP_SDK_PARSED_JSONRPC_WITH_NO_PROTOCOL_ERRORS',
      portFacts,
      fixtureBefore,
      fixtureAfter,
      starterBefore,
      starterAfter,
    };
  } catch (error) { failure = error; }
  finally {
    try { await cleanupHarness(harness); } catch (error) { harness.childCleanupFailures.push(`cleanupHarness: ${errorText(error)}`); }
  }
  const activeLeaseDirectories = findActiveLeaseDirectories(dataDir);
  const errors = failure === null ? [] : [errorText(failure).slice(0, 4000)];
  const channels = {
    errors,
    protocolErrors: harness.protocolErrors,
    consoleErrors: harness.consoleErrors,
    pageErrors: harness.pageErrors,
    requestFailures: harness.requestFailures,
    stderrLines: harness.stderrLines,
    childCleanupFailures: harness.childCleanupFailures,
    activeLeaseDirectories,
  };
  const blockingIssueChannels = blockingRunIssues(channels);
  const payload = {
    status: failure === null && blockingIssueChannels.length === 0 ? 'PASSED' : 'FAILED',
    evidenceClass: 'PREFLIGHT',
    mode: 'preflight',
    runHead,
    runnerSha256,
    trackedCodeDiffPaths: trackedCodeDiffPaths(),
    stagedPaths: stagedPaths(),
    checks,
    toolsCalled: harness.toolsCalled,
    childStdoutCapturedNotForwarded: harness.serverStdout.length,
    originalStarterUnchanged: checks?.starterBefore?.sha256 === checks?.starterAfter?.sha256,
    fixtureUnchanged: checks?.fixtureBefore?.sha256 === checks?.fixtureAfter?.sha256,
    ...channels,
    blockingIssueChannels,
  };
  const artifact = writeArtifact(artifactDirectory, payload);
  return { ...payload, artifactPath: artifact.artifactPath, identityPath: artifact.identityPath, artifactIdentity: artifact.identity };
}

async function main() {
  const modeName = modeFromArgv();
  assert(MODES.includes(modeName), `unsupported mode; use --mode=${MODES.join('|')}`);
  const output = modeName === 'preflight' ? await runPreflight() : await runWorkflow(modeName);
  if (output.status === 'PASSED') console.log(JSON.stringify(output));
  else {
    console.error(JSON.stringify(output));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(runnerPath) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
