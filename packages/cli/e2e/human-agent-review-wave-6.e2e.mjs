import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import process from 'node:process';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright';
import { prepareAcceptance } from './agent-candidate-composition-wave-5.e2e.mjs';

export const MODES = ['preflight', 'diagnostic', 'formal', 'acceptance-prep'];
export const DIAGNOSTIC_BUDGET = 3;
export const FORMAL_RUN_BUDGET = 1;

const runnerPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(runnerPath);
const repoRoot = path.resolve(scriptDirectory, '../../..');
const portEntry = path.join(repoRoot, 'packages/cli/dist/agent-port/main.js');
const editorRoot = path.join(repoRoot, 'packages/editor');
const editorIndex = path.join(editorRoot, 'dist/index.html');
const editorPreview = path.join(editorRoot, 'dist/preview.html');
const starterRoot = path.join(repoRoot, 'examples/starter');
const runHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const codeEvidenceHead = process.env['SURDET_CODE_EVIDENCE_HEAD'] ?? '';
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(runnerPath)).digest('hex');

function modeFromArgv() {
  const equal = process.argv.find((value) => value.startsWith('--mode='));
  if (equal !== undefined) return equal.slice('--mode='.length);
  const index = process.argv.indexOf('--mode');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const RUN_ISSUE_CHANNELS = Object.freeze([
  'errors',
  'protocolErrors',
  'consoleErrors',
  'pageErrors',
  'requestFailures',
  'stderrLines',
  'childCleanupFailures',
  'activeLeaseDirectories',
]);

export function blockingRunIssues(channels) {
  return RUN_ISSUE_CHANNELS.filter((channel) => {
    const entries = channels[channel];
    return !Array.isArray(entries) || entries.length > 0;
  });
}

export function buildReviewedPreviewEvidence(rawEvidence) {
  const projectionBefore = rawEvidence?.textEvent?.projectionBefore ?? null;
  const projectionAfter = rawEvidence?.textEvent?.projectionAfter ?? null;
  const finalProjection = rawEvidence?.finalProjection ?? null;
  return {
    ...rawEvidence,
    projectionVersions: {
      before: projectionBefore?.dialogue?.projectionVersion ?? null,
      after: projectionAfter?.dialogue?.projectionVersion ?? null,
      final: finalProjection?.dialogue?.projectionVersion ?? null,
    },
  };
}

export function isReviewedPreviewEvidenceSatisfied(rawEvidence) {
  const evidence = buildReviewedPreviewEvidence(rawEvidence);
  const finalProjection = evidence?.finalProjection;
  const finalDialogue = finalProjection?.dialogue;
  const projectionVersions = evidence?.projectionVersions;
  const canvasBox = evidence?.canvasBox;
  const domEvidence = evidence?.domEvidence;
  const traceStart = evidence?.traceStart;
  const textEvent = evidence?.textEvent;
  const projectionBefore = textEvent?.projectionBefore;
  const projectionAfter = textEvent?.projectionAfter;
  const dialogueBefore = projectionBefore?.dialogue;
  const dialogueAfter = projectionAfter?.dialogue;
  const afterText = dialogueAfter?.dialogText;
  const sceneId = evidence?.sceneId;
  const traceId = evidence?.traceId;
  return typeof sceneId === 'string' && sceneId.length > 0
    && typeof traceId === 'string' && traceId.length > 0
    && evidence?.rendererStatus === 'awaiting'
    && finalDialogue?.dialogText === 'Alpha route A.'
    && finalDialogue?.dialogText !== 'Alpha route C.'
    && finalDialogue?.activeSpeakerId === 'lynn'
    && finalDialogue?.speakerText === '「凛」'
    && finalDialogue?.panelVisible === true
    && Number.isInteger(projectionVersions?.before)
    && Number.isInteger(projectionVersions?.after)
    && Number.isInteger(projectionVersions?.final)
    && projectionVersions.before === dialogueBefore?.projectionVersion
    && projectionVersions.after === dialogueAfter?.projectionVersion
    && projectionVersions.final === finalDialogue?.projectionVersion
    && projectionVersions.before < projectionVersions.after
    && projectionVersions.after < projectionVersions.final
    && dialogueBefore?.dialogText === ''
    && dialogueBefore?.activeSpeakerId === null
    && dialogueBefore?.speakerText === ''
    && dialogueBefore?.panelVisible === false
    && typeof afterText === 'string'
    && 'Alpha route A.'.startsWith(afterText)
    && afterText !== 'Alpha route C.'
    && dialogueAfter?.activeSpeakerId === 'lynn'
    && dialogueAfter?.speakerText === '「凛」'
    && dialogueAfter?.panelVisible === true
    && Number.isFinite(canvasBox?.width) && canvasBox.width > 0
    && Number.isFinite(canvasBox?.height) && canvasBox.height > 0
    && domEvidence?.host?.count === 1
    && domEvidence?.host?.visible === true
    && domEvidence?.iframe?.count === 1
    && domEvidence?.iframe?.visible === true
    && domEvidence?.iframe?.containedInHost === true
    && domEvidence?.tracePanel?.count === 1
    && domEvidence?.tracePanel?.visible === true
    && domEvidence?.tracePanel?.containedInHost === true
    && traceStart?.type === 'surdet-preview-trace-start'
    && traceStart?.traceId === traceId
    && traceStart?.sceneId === sceneId
    && textEvent?.traceId === traceId
    && textEvent?.eventKind === 'instruction'
    && textEvent?.sourceOp === 'text'
    && textEvent?.sourceSceneId === sceneId
    && textEvent?.coreEmitted === true
    && textEvent?.presentationApplied === true
    && textEvent?.attribution === 'sync-batch-correlation-not-event-exclusive';
}

function sameCandidateRef(left, right) {
  return left?.changeId === right?.changeId
    && left?.capsuleId === right?.capsuleId
    && left?.artifactSha256 === right?.artifactSha256;
}

export function resolveFixtureCandidateSources(projection, fixtureCandidates, fixtureLabels) {
  return fixtureLabels.map((fixtureLabel) => {
    const fixtureRef = fixtureCandidates[fixtureLabel];
    assert(fixtureRef !== undefined, `fixture ${fixtureLabel} has no candidate ref`);
    const matches = projection.candidates.filter((candidate) => sameCandidateRef(candidate.ref, fixtureRef));
    assert(matches.length === 1, `fixture ${fixtureLabel} candidate ref resolved to ${matches.length} projected candidates`);
    const candidate = matches[0];
    return {
      fixtureLabel,
      candidateId: candidate.candidateId,
      displayOrdinal: candidate.displayOrdinal,
      ref: candidate.ref,
    };
  });
}

export function resolveSafeGroupFixtureSources(projection, fixtureCandidates, fixtureLabels, primaryObject) {
  const sources = resolveFixtureCandidateSources(projection, fixtureCandidates, fixtureLabels);
  const candidateIds = sources.map((source) => source.candidateId);
  const matches = projection.safeGroups.filter((group) => (
    group.primaryObject === primaryObject
    && group.candidateIds.length === candidateIds.length
    && candidateIds.every((candidateId) => group.candidateIds.includes(candidateId))
  ));
  assert(matches.length === 1, `${primaryObject} logical fixtures ${fixtureLabels.join('/')} resolved to ${matches.length} safe groups`);
  return { safeGroup: matches[0], sources };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function browserFileMapTreeIdentity(files, rootPrefix) {
  const normalizedPrefix = rootPrefix.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const prefix = normalizedPrefix.length === 0 ? '' : `${normalizedPrefix}/`;
  const treeFiles = files
    .filter((file) => prefix.length === 0 || file.path.startsWith(prefix))
    .map((file) => {
      const bytes = Buffer.from(file.bytes, 'base64');
      return {
        path: prefix.length === 0 ? file.path : file.path.slice(prefix.length),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const serialized = treeFiles.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join('\n');
  return {
    root: normalizedPrefix,
    fileCount: treeFiles.length,
    bytes: treeFiles.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
    files: treeFiles,
  };
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeExclusiveJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeSync(fd, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
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
      if (relative.length === 0) return true;
      return !relative.split(path.sep).some((part) => part === 'node_modules' || part === 'dist' || part === '.vite');
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

function cleanTrackedTree() {
  return trackedCodeDiffPaths().length === 0;
}

function collectLockResidues(locksRoot, output) {
  const stack = [locksRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name === 'changes' || entry.name === 'projects' || entry.name === 'stale') {
        if (entry.name !== 'stale') stack.push(full);
      } else output.push(full);
    }
  }
}

function findActiveLeaseDirectories(dataDir) {
  const active = [];
  const stack = [dataDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name === '.locks') collectLockResidues(full, active);
      else stack.push(full);
    }
  }
  return active.sort();
}

function resultOf(envelope, label) {
  assert(envelope?.ok === true, `${label} failed: ${JSON.stringify(envelope?.error ?? envelope)}`);
  return envelope.result;
}

function expectedFailure(envelope, codes, label) {
  assert(envelope?.ok === false, `${label} unexpectedly succeeded`);
  const accepted = Array.isArray(codes) ? codes : [codes];
  assert(accepted.includes(envelope.error?.code), `${label} code ${envelope.error?.code} not in ${accepted.join(',')}`);
  return envelope;
}

function writeArtifact(directory, payload) {
  const artifactPath = path.join(directory, 'evidence.json');
  const identityPath = path.join(directory, 'identity.json');
  const identity = writeExclusiveJson(artifactPath, payload);
  writeExclusiveJson(identityPath, identity);
  const reread = readFileIdentity(artifactPath);
  assert(reread.bytes === identity.bytes && reread.sha256 === identity.sha256, 'artifact identity read-back mismatch');
  return { artifactPath, identityPath, identity };
}

function writeMilestone(directory, entry) {
  const ordinal = String(entry.ordinal).padStart(2, '0');
  const file = path.join(directory, 'milestones', `${ordinal}-${entry.id}.json`);
  return { ...entry, artifact: writeExclusiveJson(file, entry) };
}

function pidAlive(pid) {
  if (pid === undefined || pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return !pidAlive(pid);
}

function createHarness() {
  return {
    ports: new Set(),
    server: null,
    browser: null,
    page: null,
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    stderrLines: [],
    childCleanupFailures: [],
    protocolErrors: [],
    activeBrowserRootKey: null,
  };
}

function connectPort(harness, { projectRoot, policy, dataDir, resumeChangeId, versionNegotiation = { mode: 'auto' } }) {
  const args = [portEntry, '--project', projectRoot, '--policy', policy];
  if (resumeChangeId !== undefined) args.push('--resume-change', resumeChangeId);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: repoRoot,
    env: { ...process.env, SURDET_AGENT_DATA_DIR: dataDir },
    stderr: 'pipe',
  });
  const protocolErrors = [];
  let stderr = '';
  transport.onerror = (error) => protocolErrors.push(String(error?.message ?? error));
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const client = new Client(
    { name: 'surdet-human-review-wave6', version: '1.0.0' },
    { versionNegotiation },
  );
  const port = { client, transport, protocolErrors, stderrRef: () => stderr, closed: false };
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
  if (pid !== undefined && !(await waitForPidExit(pid))) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    if (!(await waitForPidExit(pid))) harness.childCleanupFailures.push(`MCP child remained: ${pid}`);
  }
  harness.protocolErrors.push(...port.protocolErrors);
  const unexpected = port.stderrRef().split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Surdet Agent Port ready:'));
  harness.stderrLines.push(...unexpected);
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

async function listTools(port) {
  const response = await port.client.listTools();
  return response.tools.map((tool) => tool.name);
}

const MCP_CONTENT_EVIDENCE_LIMIT = 1600;

function serializeMcpContentEvidence(content) {
  const seen = new WeakSet();
  let serialized;
  try {
    serialized = JSON.stringify(content, (key, value) => {
      if (['data', 'blob', 'image_url', 'audio_url'].includes(key)) {
        return typeof value === 'string' ? `[omitted ${value.length} chars]` : '[omitted]';
      }
      if (typeof value === 'bigint') return value.toString();
      if (value !== null && typeof value === 'object') {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    serialized = `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
  if (serialized === undefined) serialized = String(content);
  if (serialized.length <= MCP_CONTENT_EVIDENCE_LIMIT) return serialized;
  return `${serialized.slice(0, MCP_CONTENT_EVIDENCE_LIMIT)}[truncated]`;
}

export function buildReviewedPlanRequest({ candidateRefs, comparisonFingerprint, reviewDecision }) {
  return {
    candidateRefs,
    comparisonFingerprint,
    reviewDecision: {
      reviewId: reviewDecision.reviewId,
      decisionId: reviewDecision.decisionId,
      decisionFingerprint: reviewDecision.decisionFingerprint,
    },
  };
}

export async function callTool(port, name, args = {}) {
  const response = await port.client.callTool({ name, arguments: args });
  const structuredContentPresent = response !== null
    && typeof response === 'object'
    && Object.prototype.hasOwnProperty.call(response, 'structuredContent')
    && response.structuredContent !== undefined;
  const envelope = response?.structuredContent;
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error(
      `tool=${name}; response.isError=${String(response?.isError)}; structuredContentPresent=${structuredContentPresent}; response.content=${serializeMcpContentEvidence(response?.content)}`,
    );
  }
  return envelope;
}

async function waitForHttp(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorText(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite preview did not become ready: ${lastError}`);
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
  assert(port > 0, 'could not allocate a local port');
  return port;
}

async function startVite(harness) {
  assert(fs.existsSync(editorIndex), `Editor build entry missing: ${editorIndex}`);
  assert(fs.existsSync(editorPreview), `Editor preview entry missing: ${editorPreview}`);
  const viteEntry = path.join(repoRoot, 'node_modules/vite/bin/vite.js');
  assert(fs.existsSync(viteEntry), `Vite launcher missing: ${viteEntry}`);
  const port = await freePort();
  const child = spawn(process.execPath, [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: editorRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  harness.server = child;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  await waitForHttp(`http://127.0.0.1:${port}/index.html`);
  if (stderr.trim().length > 0) harness.stderrLines.push(...stderr.split(/\r?\n/).filter(Boolean));
  return `http://127.0.0.1:${port}`;
}

async function closeServer(harness) {
  const child = harness.server;
  if (child === null) return;
  harness.server = null;
  const pid = child.pid;
  if (child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (pid !== undefined && !(await waitForPidExit(pid))) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
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

const fakeFileSystemInit = ({ roots }) => {
  const rootMaps = new Map();
  const rootDirectories = new Map();
  const makeMap = (files) => {
    const map = new Map(files.map((file) => [file.path, file.bytes]));
    const dirs = new Set(['']);
    for (const file of files) {
      const parts = file.path.split('/');
      parts.pop();
      let current = '';
      for (const part of parts) {
        current = current.length === 0 ? part : `${current}/${part}`;
        dirs.add(current);
      }
    }
    return { map, dirs };
  };
  for (const [key, files] of Object.entries(roots)) {
    const state = makeMap(files);
    rootMaps.set(key, state.map);
    rootDirectories.set(key, state.dirs);
  }
  let selected = Object.keys(roots)[0] ?? '';

  const failure = (message) => { throw new DOMException(message, 'NotFoundError'); };
  const normalize = (value) => value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const bytesFromValue = async (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
    return new Uint8Array();
  };
  const mimeFor = (name) => name.endsWith('.json') ? 'application/json' : name.endsWith('.gal') ? 'text/plain' : 'application/octet-stream';

  const makeFile = (key, filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    async getFile() {
      const map = rootMaps.get(key);
      if (!map.has(filePath)) failure(`missing file ${filePath}`);
      const binary = Uint8Array.from(atob(map.get(filePath)), (character) => character.charCodeAt(0));
      return new File([binary], filePath.split('/').pop(), { type: mimeFor(filePath), lastModified: 0 });
    },
    async createWritable() {
      return {
        async write(value) {
          const bytes = await bytesFromValue(value);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          rootMaps.get(key).set(filePath, btoa(binary));
          const parts = filePath.split('/');
          parts.pop();
          let current = '';
          for (const part of parts) {
            current = current.length === 0 ? part : `${current}/${part}`;
            rootDirectories.get(key).add(current);
          }
        },
        async close() {},
      };
    },
  });

  const makeDirectory = (key, directoryPath) => ({
    kind: 'directory',
    name: directoryPath.length === 0 ? key : directoryPath.split('/').pop(),
    async getFileHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      const map = rootMaps.get(key);
      if (!map.has(child) && !options.create) failure(`missing file ${child}`);
      if (!map.has(child)) map.set(child, '');
      return makeFile(key, child);
    },
    async getDirectoryHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      const dirs = rootDirectories.get(key);
      if (!dirs.has(child) && !options.create) failure(`missing directory ${child}`);
      dirs.add(child);
      return makeDirectory(key, child);
    },
    values() {
      const names = new Map();
      const prefix = directoryPath.length === 0 ? '' : `${directoryPath}/`;
      const map = rootMaps.get(key);
      const dirs = rootDirectories.get(key);
      for (const directory of dirs) {
        if (!directory.startsWith(prefix) || directory === directoryPath) continue;
        const rest = directory.slice(prefix.length);
        if (!rest.includes('/')) names.set(rest, makeDirectory(key, directory));
      }
      for (const file of map.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest.includes('/')) names.set(rest, makeFile(key, file));
      }
      return (async function* entries() { for (const entry of [...names.values()].sort((left, right) => left.name.localeCompare(right.name))) yield entry; })();
    },
    async removeEntry(name) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      const map = rootMaps.get(key);
      const dirs = rootDirectories.get(key);
      map.delete(child);
      for (const file of [...map.keys()]) if (file.startsWith(`${child}/`)) map.delete(file);
      for (const directory of [...dirs]) if (directory === child || directory.startsWith(`${child}/`)) dirs.delete(directory);
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });

  const rootHandle = (key) => makeDirectory(key, '');
  window.__surdetRegisterFakeRoot = (key, files) => {
    const state = makeMap(files);
    rootMaps.set(key, state.map);
    rootDirectories.set(key, state.dirs);
  };
  window.__surdetSelectFakeRoot = (key) => { if (!rootMaps.has(key)) throw new Error(`unknown fake root ${key}`); selected = key; };
  window.__surdetDumpFakeRoot = (key) => [...rootMaps.get(key).entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, bytes]) => ({ path: filePath, bytes }));
  window.showDirectoryPicker = async () => rootHandle(selected);
};

async function startBrowser(harness, url, comparisonRoot) {
  const browser = await chromium.launch({ headless: true });
  harness.browser = browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  harness.page = page;
  page.on('console', (message) => { if (message.type() === 'error') harness.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => harness.pageErrors.push(errorText(error)));
  page.on('requestfailed', (request) => harness.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  await page.addInitScript(fakeFileSystemInit, { roots: { comparison: fileMapForDirectory(comparisonRoot) } });
  harness.activeBrowserRootKey = 'comparison';
  await page.goto(`${url}/index.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开审阅任务' }).waitFor();
  return page;
}

async function addBrowserRoot(page, key, root) {
  await page.evaluate(({ key: rootKey, files }) => window.__surdetRegisterFakeRoot(rootKey, files), {
    key,
    files: fileMapForDirectory(root),
  });
  await page.evaluate((rootKey) => window.__surdetSelectFakeRoot(rootKey), key);
}

async function dumpBrowserRoot(page, key, destination) {
  const files = await page.evaluate((rootKey) => window.__surdetDumpFakeRoot(rootKey), key);
  const expected = new Set(files.map((file) => file.path));
  const existing = fileMapForDirectory(destination).map((file) => file.path);
  for (const relative of existing) {
    if (!expected.has(relative)) fs.rmSync(path.join(destination, ...relative.split('/')), { force: true });
  }
  for (const file of files) {
    const target = path.join(destination, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.bytes, 'base64'));
  }
  return hashTree(destination);
}

function decisionWriteEvidenceFromSnapshot(fakeRootSnapshot, statusText = null) {
  const decisionFile = fakeRootSnapshot.find((file) => file.path === 'decision.json');
  let decisionJsonState = 'absent';
  if (decisionFile !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(decisionFile.bytes, 'base64').toString('utf8'));
      decisionJsonState = {
        state: 'parsed',
        decisionId: parsed.decisionId ?? null,
        decisionFingerprint: parsed.decisionFingerprint ?? null,
      };
    } catch (error) {
      decisionJsonState = { state: 'invalid-json', error: errorText(error) };
    }
  }
  return {
    statusText,
    fakeRootSnapshot,
    decisionJsonExists: decisionFile !== undefined,
    decisionJsonState,
  };
}

const RECEIPT_FILE_NAMES = Object.freeze(['decision.json', 'final-approval.json', 'return-request.json']);

function receiptIdentity(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = [
    'decisionId', 'decisionFingerprint', 'approvalId', 'approvalFingerprint',
    'returnId', 'returnFingerprint', 'reviewId', 'resultReviewId',
  ];
  return Object.fromEntries(keys
    .filter((key) => typeof value[key] === 'string')
    .map((key) => [key, value[key]]));
}

function fakeRootReceiptEvidence(rootKey, fakeRootSnapshot) {
  const filesByPath = new Map(fakeRootSnapshot.map((file) => [file.path, file]));
  return {
    rootKey,
    receipts: RECEIPT_FILE_NAMES.map((filePath) => {
      const file = filesByPath.get(filePath);
      if (file === undefined) return { path: filePath, exists: false };
      const bytes = Buffer.from(file.bytes, 'base64');
      try {
        const parsed = JSON.parse(bytes.toString('utf8'));
        return {
          path: filePath,
          exists: true,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          parsedIdentity: receiptIdentity(parsed),
        };
      } catch (error) {
        return {
          path: filePath,
          exists: true,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          parseError: errorText(error),
        };
      }
    }),
  };
}

async function readGlobalStatus(page) {
  const locator = page.locator('#status');
  if (await locator.count() === 0) return { present: false, text: null, className: null };
  return locator.first().evaluate((node) => ({
    present: true,
    text: node.textContent,
    className: node.getAttribute('class'),
  }));
}

async function readReceiptMarker(page) {
  const locator = page.locator([
    '[data-decision-receipt]',
    '[data-approval-receipt]',
    '[data-return-receipt]',
    '[data-result-receipt]',
  ].join(','));
  if (await locator.count() === 0) return { present: false };
  return locator.first().evaluate((node) => ({
    present: true,
    text: node.textContent,
    kind: node.hasAttribute('data-decision-receipt')
      ? 'decision'
      : node.hasAttribute('data-approval-receipt')
        ? 'approval'
        : node.hasAttribute('data-return-receipt') ? 'return' : 'result',
    decisionId: node.getAttribute('data-decision-id'),
    decisionFingerprint: node.getAttribute('data-decision-fingerprint'),
    approvalId: node.getAttribute('data-approval-id'),
    returnId: node.getAttribute('data-return-id'),
  }));
}

async function readReadonlyControls(page) {
  return page.locator([
    '[data-choice-unit]',
    '[data-choice-exclude]',
    '[data-choice-regenerate]',
    '[data-action="save-decision"]',
    '[data-action="approve-result"]',
    '[data-action="return-result"]',
  ].join(',')).evaluateAll((nodes) => nodes.map((node) => ({
    action: node.getAttribute('data-action')
      ?? (node.hasAttribute('data-choice-unit') ? 'choose-unit'
        : node.hasAttribute('data-choice-exclude') ? 'exclude-all' : 'regenerate-candidate'),
    unitId: node.getAttribute('data-choice-unit'),
    disabled: node instanceof HTMLButtonElement ? node.disabled : null,
    selected: node.getAttribute('data-choice-selected'),
    text: node.textContent,
  })));
}

async function captureBrowserFailureEvidence(page, rootKey) {
  const fakeRootSnapshot = await page.evaluate((key) => window.__surdetDumpFakeRoot(key), rootKey);
  const [globalStatus, receiptMarker, readonlyControls] = await Promise.all([
    readGlobalStatus(page),
    readReceiptMarker(page),
    readReadonlyControls(page),
  ]);
  const fakeRootReceiptSnapshot = fakeRootReceiptEvidence(rootKey, fakeRootSnapshot);
  return { rootKey, globalStatus, receiptMarker, readonlyControls, fakeRootReceiptSnapshot };
}

const PREVIEW_TRACE_MESSAGE_TYPES = Object.freeze([
  'surdet-preview-trace-start',
  'surdet-preview-trace-event',
  'surdet-preview-trace-complete',
]);
const PREVIEW_TRACE_MESSAGE_LIMIT = 512;

async function installPreviewMessageCollector(page) {
  return page.evaluate(({ messageTypes, limit }) => {
    if (!Array.isArray(window.__surdetWave6PreviewMessages)) window.__surdetWave6PreviewMessages = [];
    if (window.__surdetWave6PreviewCollectorInstalled !== true) {
      const accepted = new Set(messageTypes);
      window.addEventListener('message', (event) => {
        if (!accepted.has(event.data?.type)) return;
        window.__surdetWave6PreviewMessages.push(event.data);
        if (window.__surdetWave6PreviewMessages.length > limit) {
          window.__surdetWave6PreviewMessages.splice(0, window.__surdetWave6PreviewMessages.length - limit);
        }
      });
      window.__surdetWave6PreviewCollectorInstalled = true;
    }
    return window.__surdetWave6PreviewMessages.length;
  }, { messageTypes: PREVIEW_TRACE_MESSAGE_TYPES, limit: PREVIEW_TRACE_MESSAGE_LIMIT });
}

async function readPreviewTraceMessages(page, startIndex = 0) {
  return page.evaluate((start) => (window.__surdetWave6PreviewMessages ?? []).slice(start), startIndex);
}

async function waitForPreviewTraceMessage(page, startIndex, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await readPreviewTraceMessages(page, startIndex);
    const match = messages.find((message) => predicate(message) === true);
    if (match !== undefined) return match;
    assert(Date.now() < deadline, `preview trace message wait timed out: ${predicate.toString().slice(0, 160)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function capturePreviewFailureDiagnostics(page, messageStartIndex) {
  const frameLocator = page.locator('iframe[title="剧情预览"]');
  let iframeUrl = null;
  let previewError = null;
  let debugExists = false;
  let debugKeys = null;
  let rendererStatus = null;
  let projectionSnapshot = null;
  let canvasBox = null;
  try {
    const frameElement = await frameLocator.elementHandle();
    const previewFrame = frameElement === null ? null : await frameElement.contentFrame();
    if (previewFrame !== null) {
      iframeUrl = previewFrame.url();
      previewError = await previewFrame.locator('#preview-error').textContent().catch(() => null);
      canvasBox = await previewFrame.locator('canvas').boundingBox().catch(() => null);
      const probe = await previewFrame.evaluate(() => {
        const debug = window.surdetPreviewDebug ?? null;
        let projection = null;
        try {
          projection = debug?.runtime?.queries?.diagnostics?.projectionSnapshot?.() ?? null;
        } catch (error) {
          projection = { probeError: String(error) };
        }
        return {
          debugExists: debug !== null,
          debugKeys: debug === null ? null : Object.keys(debug),
          rendererStatus: debug?.rendererStatus ?? null,
          projectionSnapshot: projection,
        };
      }).catch((error) => ({
        debugExists: false,
        debugKeys: null,
        rendererStatus: null,
        projectionSnapshot: { probeError: errorText(error) },
      }));
      ({ debugExists, debugKeys, rendererStatus, projectionSnapshot } = probe);
    }
  } catch (error) {
    projectionSnapshot = { probeError: errorText(error) };
  }
  const previewTraceMessages = await readPreviewTraceMessages(page, messageStartIndex).catch(() => []);
  return {
    iframeUrl,
    previewError,
    debugExists,
    debugKeys,
    rendererStatus,
    projectionSnapshot,
    canvasBox,
    previewTraceMessages,
  };
}

async function waitForNewDecisionReceiptMarker(page, previousWorkbench) {
  if (previousWorkbench !== null) {
    await page.waitForFunction((node) => !node.isConnected, previousWorkbench);
  }
  const marker = page.locator('[data-decision-receipt]').first();
  await marker.waitFor({ state: 'visible' });
  const receiptMarker = await readReceiptMarker(page);
  const readonlyControls = await readReadonlyControls(page);
  return { receiptMarker, readonlyControls };
}

async function captureDecisionWriteEvidence(page, statusText = null) {
  const fakeRootSnapshot = await page.evaluate(() => window.__surdetDumpFakeRoot('comparison'));
  return decisionWriteEvidenceFromSnapshot(fakeRootSnapshot, statusText);
}

async function closeBrowser(harness) {
  if (harness.page !== null) harness.page = null;
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

const alphaScene = 'wave5_alpha';
const betaScene = 'wave5_beta';

async function prepareWorkflowFixtures(runDirectory, starterBefore) {
  const prepared = await prepareAcceptance({ baseDirectory: runDirectory, prefix: 'candidate-' });
  const refsFile = readJson(path.join(prepared.root, 'candidate-refs.json'));
  const candidates = refsFile.candidates;
  assert(Object.keys(candidates).sort().join(',') === 'A,B,C,D', 'fresh fixture did not create A/B/C/D');
  assert(prepared.evidence.sourceCandidates.length === 4, 'fresh fixture evidence does not contain four candidates');
  for (const label of ['A', 'B', 'C', 'D']) {
    const identity = readFileIdentity(prepared.evidence.sourceCandidates.find((item) => item.label === label).artifact.path);
    assert(identity.sha256 === candidates[label].artifactSha256, `${label} capsule identity changed before workflow`);
  }
  assert(hashTree(starterRoot).sha256 === starterBefore.sha256, 'original Starter changed while sealing candidates');
  return { prepared, refsFile, candidates };
}

function projectReviewRoot(prepared, projectIdentity, reviewId) {
  return path.join(prepared.evidence.dataDir, projectIdentity, 'reviews', reviewId);
}

async function hasVisibleMatch(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return true;
  }
  return false;
}

async function waitForVisibleMatch(locator, message) {
  await locator.first().waitFor({ state: 'visible' });
  assert(await hasVisibleMatch(locator), message);
}

async function runEditorComparison(
  harness,
  editorUrl,
  comparisonRoot,
  projection,
  selectionConflict,
  chosenUnitId,
  fixtureCandidates,
  sceneUnitB,
  timelineUnitB,
) {
  const page = await startBrowser(harness, editorUrl, comparisonRoot);
  await page.getByRole('button', { name: '打开审阅任务' }).click();
  await page.getByRole('heading', { name: '比较结果' }).waitFor();
  assert(await page.locator('[data-tech-details]').evaluate((node) => !node.open), 'technical details are not folded by default');
  await waitForVisibleMatch(page.getByText('安全结果', { exact: true }), 'safe result is not visible');
  await waitForVisibleMatch(page.getByText('需要处理的冲突', { exact: true }), 'conflict section is not visible');
  const logicalIdentical = resolveSafeGroupFixtureSources(projection, fixtureCandidates, ['A', 'D'], `scene:${alphaScene}`);
  const safeGroup = page.locator(`[data-safe-group="${logicalIdentical.safeGroup.groupId}"]`);
  await safeGroup.waitFor({ state: 'visible' });
  assert(await safeGroup.count() === 1, `safe group ${logicalIdentical.safeGroup.groupId} is not uniquely rendered`);
  const folded = await safeGroup.evaluate((node) => ({
    isDetails: node instanceof HTMLDetailsElement,
    open: node instanceof HTMLDetailsElement ? node.open : null,
  }));
  assert(folded.isDetails && folded.open === false, `safe group ${logicalIdentical.safeGroup.groupId} is not folded by default`);
  assert(await hasVisibleMatch(safeGroup.getByText(`${logicalIdentical.safeGroup.sourceCount} 个方案得到相同结果`, { exact: false })),
    `safe group ${logicalIdentical.safeGroup.groupId} source count is not visible`);
  await safeGroup.evaluate((node) => { node.open = true; });
  for (const source of logicalIdentical.sources) {
    assert(await hasVisibleMatch(safeGroup.getByText(`方案 ${source.displayOrdinal}`, { exact: false })),
      `logical fixture ${source.fixtureLabel} mapped to方案 ${source.displayOrdinal} but is not visible in safe group ${logicalIdentical.safeGroup.groupId}`);
  }
  await page.locator('[data-conflict-id]').first().waitFor({ state: 'visible' });
  assert((await page.locator('[data-conflict-id]').count()) >= 1, 'selection conflict is not visible');
  const conflictIds = projection.conflicts.filter((conflict) => conflict.severity === 'selection-required').map((conflict) => conflict.conflictId);
  assert(conflictIds.includes(selectionConflict.conflictId), 'Editor projection lost the selection conflict');
  const betaDependency = projection.dependencies.find((dependency) => (
    dependency.fromUnitId === sceneUnitB.unitId && dependency.toUnitId === timelineUnitB.unitId
  ));
  assert(betaDependency !== undefined, 'Editor projection lost the B scene/timeline dependency');
  const dependencyText = `依赖自动纳入：${betaDependency.fromObjectRef.replace(/^scene:/, '场景 ')} → ${betaDependency.objectRef.replace(/^timeline:/, '时间轴 ')}`;
  const dependencyLocator = page.getByText(dependencyText, { exact: true });
  await waitForVisibleMatch(dependencyLocator, 'comparison DOM did not show 依赖自动纳入');
  assert(await dependencyLocator.count() === 1, `comparison DOM did not uniquely show ${dependencyText}`);
  for (const conflictId of conflictIds) {
    const choices = page.locator(`[data-conflict-id="${conflictId}"] [data-choice-unit]`);
    await choices.first().waitFor({ state: 'visible' });
    const count = await choices.count();
    assert(count > 0, `Editor did not render choices for ${conflictId}`);
    let targetIndex = -1;
    for (let index = 0; index < count; index += 1) {
      if (await choices.nth(index).getAttribute('data-choice-unit') === chosenUnitId) targetIndex = index;
    }
    assert(targetIndex >= 0, `chosenUnitId ${chosenUnitId} was not rendered for conflict ${conflictId}`);
    await choices.nth(targetIndex).click();
  }
  const save = page.getByRole('button', { name: '保存我的决定' });
  assert(await save.isEnabled(), 'Editor did not enable the per-item human decision action');
  await save.click();
  const saveOutcome = await Promise.race([
    page.getByText('已保存我的决定', { exact: true }).waitFor({ timeout: 7000 })
      .then(() => ({ kind: 'saved', statusText: '已保存我的决定' })),
    page.getByText(/^保存决定失败：/).waitFor({ timeout: 7000 })
      .then(async () => ({ kind: 'failed', statusText: await page.locator('#status').textContent() })),
  ]);
  if (saveOutcome.kind === 'failed') {
    const error = new Error(saveOutcome.statusText ?? '保存决定失败：状态栏没有文本');
    error.decisionWriteEvidence = await captureDecisionWriteEvidence(page, saveOutcome.statusText);
    error.browserFailureEvidence = await captureBrowserFailureEvidence(page, 'comparison');
    throw error;
  }
  const decisionWriteEvidence = await captureDecisionWriteEvidence(page, saveOutcome.statusText);
  const tree = await dumpBrowserRoot(page, 'comparison', comparisonRoot);
  const decisionPath = path.join(comparisonRoot, 'decision.json');
  assert(fs.existsSync(decisionPath), 'Editor did not create decision receipt');
  const decision = readJson(decisionPath);
  assert(decision.reviewerChannel === 'surdet-editor-local', 'decision actor channel is not Editor-local');
  assert(decision.decisionId.length > 0 && decision.decisionFingerprint.length === 64, 'decision identity is incomplete');
  assert(tree.fileCount > 2, 'comparison workspace write-back did not persist a receipt');
  const previousWorkbench = await page.locator('.review-workbench').elementHandle();
  await page.getByRole('button', { name: '打开审阅任务' }).click();
  const { receiptMarker, readonlyControls } = await waitForNewDecisionReceiptMarker(page, previousWorkbench);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === '已打开审阅任务');
  assert(receiptMarker.present === true, 'reopened comparison did not render the persisted decision receipt');
  assert(receiptMarker.decisionId === decision.decisionId, 'reopened decisionId differs from the original disk receipt');
  assert(receiptMarker.decisionFingerprint === decision.decisionFingerprint, 'reopened decisionFingerprint differs from the original disk receipt');
  const restoredChoice = page.locator(`[data-choice-unit="${chosenUnitId}"][data-choice-selected="true"]`);
  await restoredChoice.waitFor({ state: 'visible' });
  assert(await restoredChoice.count() === 1, 'reopened comparison did not restore the exact selected choice');
  assert(readonlyControls.length > 0 && readonlyControls.every((control) => control.disabled === true),
    'reopened persisted decision left a decision control writable');
  const reopenedSnapshot = await page.evaluate(() => window.__surdetDumpFakeRoot('comparison'));
  const reopenedDecisionState = decisionWriteEvidenceFromSnapshot(reopenedSnapshot).decisionJsonState;
  assert(reopenedDecisionState?.decisionId === decision.decisionId, 'reopened fake root changed the original decisionId');
  assert(reopenedDecisionState?.decisionFingerprint === decision.decisionFingerprint,
    'reopened fake root changed the original decisionFingerprint');
  return {
    decision,
    decisionIdentity: readFileIdentity(decisionPath),
    decisionWriteEvidence: { ...decisionWriteEvidence, receiptMarker, readonlyControls },
    receiptMarker,
    readonlyControls,
    fixtureSources: logicalIdentical.sources,
    page,
  };
}

async function runEditorResult(harness, page, resultRoot, resultReview, projectRoot, fixtureSources) {
  await addBrowserRoot(page, 'result', resultRoot);
  harness.activeBrowserRootKey = 'result';
  await page.getByRole('button', { name: '打开审阅任务' }).click();
  await page.getByRole('heading', { name: '结果检查' }).waitFor();
  await waitForVisibleMatch(page.getByText('结果已准备，请检查', { exact: true }), 'result review status is not visible');
  assert(await page.locator('[data-tech-details]').evaluate((node) => !node.open), 'result technical details are not folded by default');
  const resultBody = page.locator('.review-main');
  for (const source of fixtureSources) {
    assert(await hasVisibleMatch(resultBody.getByText(`方案 ${source.displayOrdinal}`, { exact: false })),
      `result review does not visibly preserve logical fixture ${source.fixtureLabel} as方案 ${source.displayOrdinal}`);
  }
  const previewButton = page.getByRole('button', { name: '预览这个结果' });
  const previewMessageStartIndex = await installPreviewMessageCollector(page);
  try {
    await previewButton.click();
    const reviewPreviewHost = page.locator('#review-preview-host');
    await reviewPreviewHost.waitFor({ state: 'visible', timeout: 30000 });
    assert(await reviewPreviewHost.count() === 1, 'review preview host is absent or non-unique');
    const previewFrameLocator = reviewPreviewHost.locator('iframe.preview-frame[title="剧情预览"]');
    await previewFrameLocator.waitFor({ state: 'visible', timeout: 30000 });
    assert(await previewFrameLocator.count() === 1, 'review preview iframe is absent or non-unique');
    const frameElement = await previewFrameLocator.elementHandle();
    const previewFrame = frameElement === null ? null : await frameElement.contentFrame();
    assert(previewFrame !== null, 'preview iframe contentFrame is unavailable');
    const canvas = previewFrame.locator('canvas');
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    const canvasBox = await canvas.boundingBox();
    assert(canvasBox !== null, 'preview canvas bounding box is unavailable');
    assert(canvasBox.width > 0, `preview canvas width is not positive: ${JSON.stringify(canvasBox)}`);
    assert(canvasBox.height > 0, `preview canvas height is not positive: ${JSON.stringify(canvasBox)}`);

    const traceStart = await waitForPreviewTraceMessage(page, previewMessageStartIndex, (message) => (
      message?.type === 'surdet-preview-trace-start' && message.sceneId === alphaScene
    ));
    assert(typeof traceStart.traceId === 'string' && traceStart.traceId.length > 0, 'Alpha preview traceId is missing');

    await previewFrame.waitForFunction(() => {
      const debug = window.surdetPreviewDebug;
      const projection = debug?.runtime?.queries?.diagnostics?.projectionSnapshot?.();
      return debug?.rendererStatus === 'awaiting'
        && projection?.dialogue?.dialogText === 'Alpha route A.'
        && projection?.dialogue?.activeSpeakerId === 'lynn'
        && projection?.dialogue?.speakerText === '「凛」'
        && projection?.dialogue?.panelVisible === true
        && projection?.dialogue?.dialogText !== 'Alpha route C.';
    }, undefined, { timeout: 30000 });
    const previewState = await previewFrame.evaluate(() => ({
      rendererStatus: window.surdetPreviewDebug?.rendererStatus ?? null,
      projection: window.surdetPreviewDebug?.runtime?.queries?.diagnostics?.projectionSnapshot?.() ?? null,
    }));
    assert(previewState.rendererStatus === 'awaiting', `Alpha preview rendererStatus is not awaiting: ${previewState.rendererStatus}`);
    assert(previewState.projection?.dialogue?.dialogText === 'Alpha route A.', 'Alpha preview projection did not render reviewed A dialogue');
    assert(previewState.projection?.dialogue?.activeSpeakerId === 'lynn', 'Alpha preview projection speaker is not lynn');
    assert(previewState.projection?.dialogue?.speakerText === '「凛」', 'Alpha preview projection did not render the localized speaker name');
    assert(previewState.projection?.dialogue?.panelVisible === true, 'Alpha preview dialogue panel is not visible');
    assert(previewState.projection?.dialogue?.dialogText !== 'Alpha route C.', 'Alpha preview projection rendered excluded C dialogue');

    const textEventMessage = await waitForPreviewTraceMessage(page, previewMessageStartIndex, (message) => (
      message?.type === 'surdet-preview-trace-event'
      && message.traceId === traceStart.traceId
      && message.event?.kind === 'instruction'
      && message.event.source?.op === 'text'
      && message.event.source?.sceneId === alphaScene
    ));
    assert(textEventMessage.coreEmitted === true, 'Alpha text trace was not emitted by Core');
    assert(textEventMessage.presentationApplied === true, 'Alpha text trace was not applied by the presentation');

    const tracePanel = reviewPreviewHost.locator('.preview-trace');
    await tracePanel.waitFor({ state: 'visible' });
    assert(await tracePanel.count() === 1, 'review preview causal trace panel is absent or non-unique');
    assert(await page.locator('.review-task-list').evaluate((node) => getComputedStyle(node).overflowY === 'auto'), 'task list is not independently scrollable');
    assert(await page.locator('.review-main').evaluate((node) => getComputedStyle(node).overflowY === 'auto'), 'review body is not independently scrollable');
    assert(await page.locator('.review-details').evaluate((node) => getComputedStyle(node).overflowY === 'auto'), 'causal panel is not independently scrollable');

    const previewEvidence = buildReviewedPreviewEvidence({
      sceneId: traceStart.sceneId,
      traceId: traceStart.traceId,
      rendererStatus: previewState.rendererStatus,
      finalProjection: previewState.projection,
      canvasBox,
      domEvidence: {
        host: { count: await reviewPreviewHost.count(), visible: await reviewPreviewHost.isVisible() },
        iframe: { count: await previewFrameLocator.count(), visible: await previewFrameLocator.isVisible(), containedInHost: true },
        tracePanel: { count: await tracePanel.count(), visible: await tracePanel.isVisible(), containedInHost: true },
      },
      traceStart,
      textEvent: {
        traceId: textEventMessage.traceId,
        eventKind: textEventMessage.event.kind,
        sourceOp: textEventMessage.event.source.op,
        sourceSceneId: textEventMessage.event.source.sceneId,
        coreEmitted: textEventMessage.coreEmitted,
        presentationApplied: textEventMessage.presentationApplied,
        attribution: 'sync-batch-correlation-not-event-exclusive',
        projectionBefore: textEventMessage.presentationBefore?.projection ?? null,
        projectionAfter: textEventMessage.presentationAfter?.projection ?? null,
      },
    });
    assert(isReviewedPreviewEvidenceSatisfied(previewEvidence), 'Alpha preview evidence did not satisfy the strict cross-layer contract');
    return { previewEvidence, resultReview, projectRoot };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(errorText(error));
    const baseEvidence = await captureBrowserFailureEvidence(page, 'result').catch((captureError) => ({
      rootKey: 'result',
      globalStatus: { present: false, text: null, className: null },
      receiptMarker: { present: false },
      readonlyControls: [],
      fakeRootReceiptSnapshot: { rootKey: 'result', receipts: [] },
      captureError: errorText(captureError),
    }));
    failure.browserFailureEvidence = {
      ...baseEvidence,
      previewDiagnostics: await capturePreviewFailureDiagnostics(page, previewMessageStartIndex),
    };
    throw failure;
  }
}

async function runWorkflow(modeName) {
  const harness = createHarness();
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-human-review-wave6-${modeName}-`));
  const artifactDirectory = path.join(runDirectory, 'artifact');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const starterBefore = hashTree(starterRoot);
  const milestones = [];
  let ordinal = 0;
  let lastPassedNode = null;
  let firstFailedNode = null;
  let failure = null;
  let fixtures = null;
  let editorUrl = null;
  let stageProjectMutated = false;
  let integrationChangeId = null;
  let comparisonReview = null;
  let resultReview = null;
  let decision = null;
  let approval = null;
  let plan = null;
  let finalDiff = null;
  let alphaTrace = null;
  let betaTrace = null;
  let logicalIdenticalSources = [];
  let comparisonRootPath = null;
  let browserFailureEvidence = {
    captured: false,
    rootKey: null,
    globalStatus: { present: false, text: null, className: null },
    receiptMarker: { present: false },
    readonlyControls: [],
    fakeRootReceiptSnapshot: { rootKey: null, receipts: [] },
  };
  let decisionWriteEvidence = {
    statusText: null,
    fakeRootSnapshot: [],
    decisionJsonExists: false,
    decisionJsonState: 'not-attempted',
  };
  const projectMutation = { occurred: false, stageProjectMutated: false, applyProjectMutated: false };

  const milestone = async (id, action) => {
    ordinal += 1;
    try {
      const detail = await action();
      const entry = writeMilestone(artifactDirectory, { ordinal, id, status: 'PASSED', detail });
      milestones.push(entry);
      lastPassedNode = id;
      return detail;
    } catch (error) {
      firstFailedNode ??= id;
      const entry = writeMilestone(artifactDirectory, { ordinal, id, status: 'FAILED', error: errorText(error).slice(0, 4000) });
      milestones.push(entry);
      throw error;
    }
  };

  try {
    await milestone('launcher-preflight', async () => {
      assert(path.resolve(process.cwd()) === repoRoot, `runner cwd mismatch: ${process.cwd()}`);
      assert(fs.existsSync(portEntry), `Agent Port dist entry missing: ${portEntry}`);
      assert(fs.existsSync(editorIndex) && fs.existsSync(editorPreview), 'Editor Vite build entries are missing');
      return { cwd: repoRoot, portEntry, editorIndex, editorPreview };
    });

    await milestone('clean-baseline', async () => {
      if (modeName === 'formal') {
        assert(cleanTrackedTree(), `FORMAL requires clean tracked tree: ${JSON.stringify(trackedCodeDiffPaths())}`);
        assert(codeEvidenceHead !== '' && runHead === codeEvidenceHead,
          `FORMAL runHead ${runHead} !== codeEvidenceHead ${codeEvidenceHead || '(unset)'}`);
      }
      return { runHead, codeEvidenceHead: codeEvidenceHead || null, trackedCodeDiffPaths: trackedCodeDiffPaths() };
    });

    await milestone('candidate-fixtures-sealed', async () => {
      fixtures = await prepareWorkflowFixtures(runDirectory, starterBefore);
      return {
        root: fixtures.prepared.root,
        projectRoot: fixtures.prepared.evidence.projectRoot,
        dataDir: fixtures.prepared.evidence.dataDir,
        candidateRefs: fixtures.candidates,
        sourceCandidates: fixtures.prepared.evidence.sourceCandidates,
      };
    });

    const projectRoot = () => fixtures.prepared.evidence.projectRoot;
    const dataDir = () => fixtures.prepared.evidence.dataDir;
    const refs = () => Object.values(fixtures.candidates);
    const projectIdentity = () => fixtures.refsFile.projectIdentity;

    let compared = null;
    let reviewProjection = null;
    let selectionConflict = null;
    let sceneUnitA = null;
    let sceneUnitC = null;
    let sceneUnitD = null;
    let variableUnitA = null;
    let variableUnitD = null;
    let sceneUnitB = null;
    let timelineUnitB = null;
    let comparisonFingerprint = null;

    await milestone('comparison-prepared', async () => {
      const detail = await withPort(harness, { projectRoot: projectRoot(), policy: 'observe', dataDir: dataDir() }, async (port) => {
        const comparison = resultOf(await callTool(port, 'surdet_composition_compare', { candidateRefs: refs() }), 'composition.compare');
        compared = comparison;
        comparisonFingerprint = compared.comparisonFingerprint;
        assert(typeof comparisonFingerprint === 'string' && comparisonFingerprint.length === 64, 'comparison fingerprint missing');
        selectionConflict = compared.conflicts.find((conflict) => conflict.severity === 'selection-required');
        assert(selectionConflict !== undefined, 'selection-required conflict missing');
        sceneUnitA = compared.units.find((unit) => unit.primaryObject === `scene:${alphaScene}` && unit.candidateId === `cand-${fixtures.candidates.A.changeId}`);
        sceneUnitC = compared.units.find((unit) => unit.primaryObject === `scene:${alphaScene}` && unit.candidateId === `cand-${fixtures.candidates.C.changeId}`);
        sceneUnitD = compared.units.find((unit) => unit.primaryObject === `scene:${alphaScene}` && unit.candidateId === `cand-${fixtures.candidates.D.changeId}`);
        variableUnitA = compared.units.find((unit) => unit.primaryObject === 'variable:flag.alpha' && unit.candidateId === `cand-${fixtures.candidates.A.changeId}`);
        variableUnitD = compared.units.find((unit) => unit.primaryObject === 'variable:flag.alpha' && unit.candidateId === `cand-${fixtures.candidates.D.changeId}`);
        sceneUnitB = compared.units.find((unit) => unit.primaryObject === `scene:${betaScene}` && unit.candidateId === `cand-${fixtures.candidates.B.changeId}`);
        timelineUnitB = compared.units.find((unit) => unit.primaryObject === 'timeline:beta_opening' && unit.candidateId === `cand-${fixtures.candidates.B.changeId}`);
        assert(sceneUnitA && sceneUnitC && sceneUnitD && variableUnitA && variableUnitD && sceneUnitB && timelineUnitB, 'comparison omitted required A/B/C/D units');
        const review = resultOf(await callTool(port, 'surdet_review_prepare_comparison', { candidateRefs: refs() }), 'review.prepare-comparison');
        comparisonReview = review;
        reviewProjection = comparisonReview.projection;
        assert(comparisonReview.identity.kind === 'comparison', 'comparison review identity kind mismatch');
        assert(reviewProjection.sourceIdentity.comparisonFingerprint === comparisonFingerprint, 'review projection fingerprint mismatch');
        return { comparisonStatus: compared.status, reviewId: comparisonReview.reviewId, comparisonFingerprint };
      });
      return detail;
    });

    await milestone('identical-variable-visible', async () => {
      const group = compared.identicalGroups.find((candidate) => candidate.unitIds.includes(variableUnitA.unitId) && candidate.unitIds.includes(variableUnitD.unitId));
      assert(group !== undefined, 'A/D identical variable group is not visible');
      const safe = reviewProjection.safeGroups.find((candidate) => candidate.primaryObject === 'variable:flag.alpha');
      assert(safe !== undefined && safe.sourceCount >= 2, 'Editor projection did not expose A/D variable provenance');
      return { groupId: group.groupId, unitIds: group.unitIds, sourceCount: safe.sourceCount };
    });

    await milestone('identical-scene-visible', async () => {
      const group = compared.identicalGroups.find((candidate) => candidate.unitIds.includes(sceneUnitA.unitId) && candidate.unitIds.includes(sceneUnitD.unitId));
      assert(group !== undefined, 'A/D identical scene subgroup is not visible');
      const safe = reviewProjection.safeGroups.find((candidate) => candidate.primaryObject === `scene:${alphaScene}`);
      assert(safe !== undefined && safe.sourceCount >= 2, 'Editor projection did not expose A/D scene provenance');
      return { groupId: group.groupId, unitIds: group.unitIds, sourceCount: safe.sourceCount };
    });

    await milestone('divergent-c-visible', async () => {
      assert(selectionConflict.code === 'OBJECT_RESULTS_DIVERGE', `unexpected conflict code: ${selectionConflict.code}`);
      assert(selectionConflict.unitIds.includes(sceneUnitC.unitId), 'C divergent unit is not in selection conflict');
      assert(reviewProjection.conflicts.some((conflict) => conflict.code === 'OBJECT_RESULTS_DIVERGE' && conflict.severity === 'selection-required'), 'C conflict is not visible in Editor projection');
      return { conflictId: selectionConflict.conflictId, code: selectionConflict.code, cUnitId: sceneUnitC.unitId };
    });

    await milestone('beta-timeline-dependency-visible', async () => {
      assert(compared.dependencyEdges.some((edge) => edge.fromUnitId === sceneUnitB.unitId && edge.toUnitId === timelineUnitB.unitId), 'B scene/timeline dependency edge missing');
      const dependencyText = JSON.stringify(reviewProjection.dependencies ?? reviewProjection.objects ?? reviewProjection);
      assert(dependencyText.includes('beta_opening'), 'B timeline dependency is not visible in review projection');
      return { sceneUnitId: sceneUnitB.unitId, timelineUnitId: timelineUnitB.unitId };
    });

    await milestone('decision-required-error', async () => {
      const envelope = await withPort(harness, { projectRoot: projectRoot(), policy: 'observe', dataDir: dataDir() }, (port) => (
        callTool(port, 'surdet_review_inspect_decision', { reviewId: comparisonReview.reviewId })
      ));
      const rejected = expectedFailure(envelope, 'REVIEW_DECISION_REQUIRED', 'review.inspect-decision');
      return { code: rejected.error.code, after: 'human-review' };
    });

    await milestone('editor-decision-receipt-visible', async () => {
      editorUrl = await startVite(harness);
      const comparisonRoot = projectReviewRoot(fixtures.prepared, projectIdentity(), comparisonReview.reviewId);
      comparisonRootPath = comparisonRoot;
      const result = await runEditorComparison(
        harness,
        editorUrl,
        comparisonRoot,
        reviewProjection,
        selectionConflict,
        sceneUnitA.unitId,
        fixtures.candidates,
        sceneUnitB,
        timelineUnitB,
      );
      decision = result.decision;
      decisionWriteEvidence = result.decisionWriteEvidence;
      logicalIdenticalSources = result.fixtureSources;
      assert(decision.selectedUnitIds.includes(sceneUnitA.unitId), 'Editor decision did not choose A');
      assert(!decision.selectedUnitIds.includes(sceneUnitC.unitId), 'Editor decision retained C');
      assert(decision.selectedUnitIds.includes(sceneUnitB.unitId), 'Editor decision did not directly select B scene');
      assert(!decision.selectedUnitIds.includes(timelineUnitB.unitId), 'Editor decision directly selected implicit B timeline');
      return {
        identity: result.decisionIdentity,
        reviewerChannel: decision.reviewerChannel,
        selectedUnitIds: decision.selectedUnitIds,
        receiptMarker: result.receiptMarker,
        readonlyControls: result.readonlyControls,
      };
    });

    let inspectedPlan = null;
    await milestone('reviewed-plan-sealed', async () => {
      const detail = await withPort(harness, { projectRoot: projectRoot(), policy: 'stage', dataDir: dataDir() }, async (port) => {
        const planned = resultOf(await callTool(port, 'surdet_composition_plan', buildReviewedPlanRequest({
          candidateRefs: refs(),
          comparisonFingerprint,
          reviewDecision: {
            reviewId: comparisonReview.reviewId,
            decisionId: decision.decisionId,
            decisionFingerprint: decision.decisionFingerprint,
          },
        })), 'composition.plan reviewed');
        plan = planned;
        assert(plan.dryRunStatus === 'passed', `reviewed plan dry run failed: ${JSON.stringify(plan)}`);
        const inspected = resultOf(await callTool(port, 'surdet_composition_inspect', { planId: plan.planId, artifactSha256: plan.artifactSha256 }), 'composition.inspect reviewed');
        inspectedPlan = inspected.plan;
        assert(inspectedPlan.review?.reviewState === 'human-reviewed', 'reviewed plan lost human binding');
        assert(Array.isArray(inspectedPlan.selectedUnitIds), 'reviewed plan selectedUnitIds is not an array');
        assert(Array.isArray(inspectedPlan.implicitInclusions), 'reviewed plan implicitInclusions is not an array');
        assert(Array.isArray(inspectedPlan.replayOperations), 'reviewed plan replayOperations is not an array');
        assert(inspectedPlan.excludedUnitIds.includes(sceneUnitC.unitId), 'C was not excluded from reviewed plan');
        assert(inspectedPlan.selectedUnitIds.includes(sceneUnitB.unitId), 'reviewed plan did not directly select B scene');
        assert(!inspectedPlan.selectedUnitIds.includes(timelineUnitB.unitId), 'reviewed plan directly selected implicit B timeline');
        assert(inspectedPlan.implicitInclusions.includes(timelineUnitB.unitId), 'B timeline closure was not preserved');
        const canonicalClosureUnitIds = new Set([...inspectedPlan.selectedUnitIds, ...inspectedPlan.implicitInclusions]);
        assert(canonicalClosureUnitIds.has(sceneUnitB.unitId), 'canonical closure omitted B scene');
        assert(canonicalClosureUnitIds.has(timelineUnitB.unitId), 'canonical closure omitted B timeline');
        const timelineReplayIndex = inspectedPlan.replayOperations.findIndex((operation) => operation.sourceUnitId === timelineUnitB.unitId);
        const sceneReplayIndex = inspectedPlan.replayOperations.findIndex((operation) => operation.sourceUnitId === sceneUnitB.unitId);
        assert(timelineReplayIndex >= 0, 'reviewed plan replay omitted B timeline');
        assert(sceneReplayIndex >= 0, 'reviewed plan replay omitted B scene');
        assert(timelineReplayIndex < sceneReplayIndex, 'reviewed plan replay did not order B timeline before B scene');
        return { planId: plan.planId, planFingerprint: plan.planFingerprint, artifactSha256: plan.artifactSha256, reviewState: inspectedPlan.review.reviewState };
      });
      return detail;
    });

    await milestone('integration-stage-ready', async () => {
      const detail = await withPort(harness, { projectRoot: projectRoot(), policy: 'stage', dataDir: dataDir() }, async (port) => {
        const executed = resultOf(await callTool(port, 'surdet_composition_execute', {
          planId: plan.planId,
          artifactSha256: plan.artifactSha256,
          executeOperationId: 'wave6-human-review-execute-1',
        }), 'composition.execute reviewed');
        integrationChangeId = executed.integrationChangeId;
        assert(executed.status === 'READY', `integration did not reach READY: ${JSON.stringify(executed)}`);
        const described = resultOf(await callTool(port, 'surdet_session_describe'), 'session.describe ready');
        assert(described.activeChange?.integration?.status === 'READY', 'session did not report READY integration');
        return { changeId: integrationChangeId, status: executed.status, operationCount: executed.operationCount };
      });
      stageProjectMutated = hashTree(projectRoot()).sha256 !== fixtures.prepared.evidence.projectTree.sha256;
      projectMutation.stageProjectMutated = stageProjectMutated;
      assert(stageProjectMutated === false, 'stage policy mutated the actual fixture project');
      return detail;
    });

    await milestone('all-product-fingerprints-read-back', async () => {
      assert(typeof plan.planFingerprint === 'string' && plan.planFingerprint.length === 64, 'plan fingerprint missing');
      assert(typeof comparisonFingerprint === 'string' && comparisonFingerprint.length === 64, 'comparison fingerprint missing');
      assert(inspectedPlan.dryRun !== null && typeof inspectedPlan.dryRun === 'object' && !Array.isArray(inspectedPlan.dryRun), 'reviewed plan dryRun is not an object');
      assert(inspectedPlan.dryRun.status === 'passed', 'reviewed plan dryRun did not pass');
      assert(inspectedPlan.dryRun.finalObjectFingerprints !== null && typeof inspectedPlan.dryRun.finalObjectFingerprints === 'object' && !Array.isArray(inspectedPlan.dryRun.finalObjectFingerprints), 'reviewed plan finalObjectFingerprints is not an object');
      const finalObjectFingerprintCount = Object.keys(inspectedPlan.dryRun.finalObjectFingerprints).length;
      assert(finalObjectFingerprintCount > 0, 'final object fingerprints missing');
      assert(inspectedPlan.provenance.length > 0, 'plan provenance missing');
      return {
        comparisonFingerprint,
        planFingerprint: plan.planFingerprint,
        finalObjectFingerprintCount,
        provenanceCount: inspectedPlan.provenance.length,
      };
    });

    let readyPort = null;
    await milestone('fresh-diff-validation-simulation-runtime', async () => {
      const detail = await withPort(harness, { projectRoot: projectRoot(), policy: 'stage', dataDir: dataDir(), resumeChangeId: integrationChangeId }, async (port) => {
        const diff = resultOf(await callTool(port, 'surdet_change_diff'), 'change.diff fresh');
        const validation = resultOf(await callTool(port, 'surdet_project_validate'), 'project.validate fresh');
        const simulation = resultOf(await callTool(port, 'surdet_project_simulate', { sceneId: alphaScene }), 'project.simulate fresh');
        alphaTrace = resultOf(await callTool(port, 'surdet_runtime_run_from', { sceneId: alphaScene, choices: [], seed: 906 }), 'runtime Alpha fresh');
        betaTrace = resultOf(await callTool(port, 'surdet_runtime_run_from', { sceneId: betaScene, choices: [], seed: 907 }), 'runtime Beta fresh');
        const alphaRead = resultOf(await callTool(port, 'surdet_runtime_read_trace', { traceId: alphaTrace.traceId }), 'trace Alpha fresh');
        const betaRead = resultOf(await callTool(port, 'surdet_runtime_read_trace', { traceId: betaTrace.traceId }), 'trace Beta fresh');
        finalDiff = diff;
        assert(validation.ok === true && simulation.status === 'passed', 'fresh validation/simulation did not pass');
        assert(alphaTrace.status === 'passed' && betaTrace.status === 'passed', 'fresh Alpha/Beta runtime did not pass');
        assert(alphaRead.count > 0 && betaRead.count > 0, 'fresh traces were empty');
        readyPort = { traceAlpha: alphaTrace, traceBeta: betaTrace };
        return {
          diffEvidenceId: diff.evidenceId,
          validationEvidenceId: validation.evidenceId,
          simulationEvidenceId: simulation.evidenceId,
          alphaTraceId: alphaTrace.traceId,
          betaTraceId: betaTrace.traceId,
          alphaEvents: alphaRead.count,
          betaEvents: betaRead.count,
        };
      });
      return detail;
    });

    await milestone('result-review-prepared', async () => {
      const detail = await withPort(harness, { projectRoot: projectRoot(), policy: 'stage', dataDir: dataDir(), resumeChangeId: integrationChangeId }, async (port) => {
        const prepared = resultOf(await callTool(port, 'surdet_review_prepare_result', {
          planId: plan.planId,
          artifactSha256: plan.artifactSha256,
          changeId: integrationChangeId,
        }), 'review.prepare-result');
        resultReview = prepared;
        assert(resultReview.identity.kind === 'integration-result', 'result review identity kind mismatch');
        assert(resultReview.projection.finalResult.resultTreeSha256.length === 64, 'result tree identity missing');
        const capsule = resultOf(await callTool(port, 'surdet_delivery_capsule', { label: 'Wave 6 human review stage evidence' }), 'stage delivery capsule');
        assert(capsule.projectMutation.occurred === false, 'stage delivery capsule reported mutation');
        return { reviewId: resultReview.reviewId, resultTreeSha256: resultReview.projection.finalResult.resultTreeSha256, capsuleId: capsule.capsuleId, projectMutation: capsule.projectMutation };
      });
      return detail;
    });

    await milestone('approval-required-error', async () => {
      const envelope = await withPort(harness, { projectRoot: projectRoot(), policy: 'observe', dataDir: dataDir(), resumeChangeId: integrationChangeId }, (port) => (
        callTool(port, 'surdet_review_inspect_approval', { resultReviewId: resultReview.reviewId })
      ));
      const rejected = expectedFailure(envelope, 'REVIEW_APPROVAL_REQUIRED', 'review.inspect-approval');
      return { code: rejected.error.code, after: 'human-review' };
    });

    await milestone('editor-result-rendered', async () => {
      const resultRoot = projectReviewRoot(fixtures.prepared, projectIdentity(), resultReview.reviewId);
      const rendered = await runEditorResult(
        harness,
        harness.page,
        resultRoot,
        resultReview,
        path.join(resultRoot, 'result', 'project'),
        logicalIdenticalSources,
      );
      return { resultRoot, browserFileSystemAccess: 'harness-backed', previewEvidence: rendered.previewEvidence, projectRoot: rendered.projectRoot };
    });

    await milestone('exploration-invalidates-approval', async () => {
      const page = harness.page;
      const before = await page.getByRole('button', { name: '批准这个计划' }).isEnabled();
      assert(before, 'approval was disabled before exploration');
      const explorationPath = 'result/project/content/scenario/exploration.gal';
      const beforeFiles = await page.evaluate(() => window.__surdetDumpFakeRoot('result'));
      const explorationTreeBefore = browserFileMapTreeIdentity(beforeFiles, 'result/project');
      await page.evaluate(({ filePath, bytes }) => {
        window.__surdetRegisterFakeRoot('result', [
          ...window.__surdetDumpFakeRoot('result'),
          { path: filePath, bytes },
        ]);
      }, {
        filePath: explorationPath,
        bytes: Buffer.from('@label start\n@text exploratory', 'utf8').toString('base64'),
      });
      const afterFiles = await page.evaluate(() => window.__surdetDumpFakeRoot('result'));
      const explorationTreeAfter = browserFileMapTreeIdentity(afterFiles, 'result/project');
      assert(afterFiles.some((file) => file.path === explorationPath), 'exploration file was not written inside the reviewed result project');
      assert(explorationTreeAfter.sha256 !== explorationTreeBefore.sha256, 'exploration did not change the reviewed result project tree identity');
      await page.getByRole('button', { name: '检查探索修改' }).click();
      await page.getByText('你正在查看探索性修改，批准已禁用。', { exact: true }).waitFor();
      assert(!(await page.getByRole('button', { name: '批准这个计划' }).isEnabled()), 'approval remained enabled after exploration');
      return {
        approvalBefore: before,
        approvalAfter: false,
        explorationPath,
        explorationTreeBefore,
        explorationTreeAfter,
      };
    });

    await milestone('fresh-approval-inspected', async () => {
      const page = harness.page;
      const previousWorkbench = await page.locator('.review-workbench').elementHandle();
      await page.getByRole('button', { name: '重新加载正式结果' }).click();
      if (previousWorkbench !== null) {
        await page.waitForFunction((node) => !node.isConnected, previousWorkbench);
      }
      await page.waitForFunction(() => document.querySelector('#status')?.textContent === '已重新加载正式结果');
      assert(await page.getByRole('button', { name: '批准这个计划' }).isEnabled(), 'approval did not re-enable after official reload');
      await page.getByRole('button', { name: '批准这个计划' }).click();
      await page.waitForFunction(() => document.querySelector('#status')?.textContent === '已批准这个计划');
      const resultRoot = projectReviewRoot(fixtures.prepared, projectIdentity(), resultReview.reviewId);
      await dumpBrowserRoot(page, 'result', resultRoot);
      const approvalPath = path.join(resultRoot, 'final-approval.json');
      assert(fs.existsSync(approvalPath), 'Editor did not create final approval receipt');
      approval = readJson(approvalPath);
      assert(approval.reviewerChannel === 'surdet-editor-local' && approval.approvalFingerprint.length === 64, 'approval identity is incomplete');
      const inspected = await withPort(harness, { projectRoot: projectRoot(), policy: 'observe', dataDir: dataDir(), resumeChangeId: integrationChangeId }, (port) => (
        callTool(port, 'surdet_review_inspect_approval', { resultReviewId: resultReview.reviewId, approvalId: approval.approvalId })
      ));
      const verified = resultOf(inspected, 'review.inspect-approval fresh');
      assert(verified.receipt.approvalId === approval.approvalId, 'MCP approval read-back identity mismatch');
      return { identity: readFileIdentity(approvalPath), approvalId: approval.approvalId, approvalFingerprint: approval.approvalFingerprint };
    });

    await milestone('isolated-commit-applies-reviewed-result', async () => {
      const before = hashTree(projectRoot());
      const committed = await withPort(harness, { projectRoot: projectRoot(), policy: 'apply', dataDir: dataDir(), resumeChangeId: integrationChangeId }, async (port) => {
        const result = resultOf(await callTool(port, 'surdet_change_commit', {
          approvalRef: {
            resultReviewId: resultReview.reviewId,
            approvalId: approval.approvalId,
            approvalFingerprint: approval.approvalFingerprint,
          },
        }), 'change.commit isolated reviewed result');
        assert(result.status === 'COMMITTED', 'isolated reviewed result did not commit');
        return result;
      });
      const after = hashTree(projectRoot());
      projectMutation.applyProjectMutated = before.sha256 !== after.sha256;
      projectMutation.occurred = projectMutation.applyProjectMutated;
      assert(projectMutation.applyProjectMutated, 'isolated apply did not change only the fixture project');
      const alphaFile = fs.readFileSync(path.join(projectRoot(), 'content/scenario/wave5_alpha.gal'), 'utf8');
      assert(alphaFile.includes('Alpha route A.') && !alphaFile.includes('Alpha route C.'), 'isolated apply produced wrong Alpha result');
      return { changeId: integrationChangeId, status: committed.status, before, after, projectMutation: projectMutation.applyProjectMutated };
    });

    await milestone('original-starter-unchanged', async () => {
      const starterAfter = hashTree(starterRoot);
      assert(starterAfter.sha256 === starterBefore.sha256, 'original Starter changed during formal workflow');
      return { starterBefore, starterAfter, unchanged: true };
    });

  } catch (error) {
    if (error?.browserFailureEvidence !== undefined) {
      browserFailureEvidence = { captured: true, milestone: firstFailedNode, ...error.browserFailureEvidence };
    } else if (harness.page !== null && harness.activeBrowserRootKey !== null) {
      try {
        browserFailureEvidence = {
          captured: true,
          milestone: firstFailedNode,
          ...await captureBrowserFailureEvidence(harness.page, harness.activeBrowserRootKey),
        };
      } catch (captureError) {
        browserFailureEvidence = {
          captured: false,
          milestone: firstFailedNode,
          rootKey: harness.activeBrowserRootKey,
          globalStatus: { present: false, text: null, className: null },
          receiptMarker: { present: false },
          readonlyControls: [],
          fakeRootReceiptSnapshot: { rootKey: harness.activeBrowserRootKey, receipts: [] },
          captureError: errorText(captureError),
        };
      }
    }
    if (error?.decisionWriteEvidence !== undefined) {
      decisionWriteEvidence = error.decisionWriteEvidence;
    } else if (harness.page !== null
      && comparisonRootPath !== null
      && harness.activeBrowserRootKey === 'comparison') {
      try {
        const statusText = browserFailureEvidence?.globalStatus?.text ?? null;
        decisionWriteEvidence = await captureDecisionWriteEvidence(harness.page, statusText);
      } catch (captureError) {
        decisionWriteEvidence = {
          ...decisionWriteEvidence,
          decisionJsonState: { state: 'snapshot-failed', error: errorText(captureError) },
        };
      }
    }
    failure = error;
  } finally {
    try {
      await cleanupHarness(harness);
    } catch (error) {
      harness.childCleanupFailures.push(`cleanupHarness: ${errorText(error)}`);
    }
  }

  const activeLeaseDirectories = fixtures === null ? [] : findActiveLeaseDirectories(fixtures.prepared.evidence.dataDir);
  if (failure === null) {
    try {
      await milestone('cleanup-and-identity', async () => {
        const blockingIssueChannels = blockingRunIssues({
          errors: [],
          protocolErrors: harness.protocolErrors,
          consoleErrors: harness.consoleErrors,
          pageErrors: harness.pageErrors,
          requestFailures: harness.requestFailures,
          stderrLines: harness.stderrLines,
          childCleanupFailures: harness.childCleanupFailures,
          activeLeaseDirectories,
        });
        assert(blockingIssueChannels.length === 0, `run produced blocking issue channels: ${blockingIssueChannels.join(', ')}`);
        return {
          runHead,
          runnerSha256,
          trackedCodeDiffPaths: trackedCodeDiffPaths(),
          browserFileSystemAccess: 'harness-backed',
          stageProjectMutated,
          projectMutation,
          blockingIssueChannels,
        };
      });
    } catch (error) {
      failure = error;
    }
  }
  const errors = failure === null ? [] : [errorText(failure).slice(0, 4000)];
  const blockingIssueChannels = blockingRunIssues({
    errors,
    protocolErrors: harness.protocolErrors,
    consoleErrors: harness.consoleErrors,
    pageErrors: harness.pageErrors,
    requestFailures: harness.requestFailures,
    stderrLines: harness.stderrLines,
    childCleanupFailures: harness.childCleanupFailures,
    activeLeaseDirectories,
  });
  const payload = {
    status: blockingIssueChannels.length === 0 ? 'PASSED' : 'FAILED',
    evidenceClass: modeName === 'formal' ? 'FORMAL' : 'DIAGNOSTIC',
    mode: modeName,
    runHead,
    runnerSha256,
    trackedCodeDiffPaths: trackedCodeDiffPaths(),
    milestones,
    projectMutation: { ...projectMutation, stageProjectMutated },
    errors,
    protocolErrors: harness.protocolErrors,
    consoleErrors: harness.consoleErrors,
    pageErrors: harness.pageErrors,
    requestFailures: harness.requestFailures,
    stderrLines: harness.stderrLines,
    childCleanupFailures: harness.childCleanupFailures,
    activeLeaseDirectories,
    blockingIssueChannels,
    lastPassedNode,
    firstFailedNode,
    codeEvidenceHead: codeEvidenceHead || null,
    browserFileSystemAccess: 'harness-backed',
    integrationChangeId,
    comparisonReview,
    resultReview,
    decision,
    decisionWriteEvidence,
    browserFailureEvidence,
    approval,
    runtimeEvidence: { alphaTrace, betaTrace },
    finalDiff,
  };
  const artifact = writeArtifact(artifactDirectory, payload);
  const output = { ...payload, artifactIdentity: artifact.identity, artifactPath: artifact.artifactPath, identityPath: artifact.identityPath };
  if (payload.status === 'FAILED') {
    console.error(JSON.stringify(output));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(output));
  }
  return output;
}

async function runPreflight() {
  const harness = createHarness();
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-human-review-wave6-preflight-'));
  const artifactDirectory = path.join(runDirectory, 'artifact');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const starterBefore = hashTree(starterRoot);
  let failure = null;
  let modern = null;
  let legacy = null;
  let stage = null;
  try {
    assert(path.resolve(process.cwd()) === repoRoot, `preflight cwd mismatch: ${process.cwd()}`);
    assert(fs.existsSync(portEntry), `Agent Port launcher missing: ${portEntry}`);
    assert(fs.existsSync(editorIndex) && fs.existsSync(editorPreview), 'Editor build entry missing');
    const modernFixture = path.join(runDirectory, 'modern-fixture');
    const legacyFixture = path.join(runDirectory, 'legacy-fixture');
    const stageFixture = path.join(runDirectory, 'stage-fixture');
    copyStarter(modernFixture);
    copyStarter(legacyFixture);
    copyStarter(stageFixture);
    const modernData = path.join(runDirectory, 'modern-data');
    const legacyData = path.join(runDirectory, 'legacy-data');
    const stageData = path.join(runDirectory, 'stage-data');
    for (const directory of [modernData, legacyData, stageData]) fs.mkdirSync(directory, { recursive: true });
    const inspect = async (fixture, dataDir, label, versionNegotiation) => withPort(harness, {
      projectRoot: fixture, policy: 'observe', dataDir, versionNegotiation,
    }, async (port) => {
      const names = await listTools(port);
      const described = resultOf(await callTool(port, 'surdet_capabilities_describe'), `${label} capabilities.describe`);
      resultOf(await callTool(port, 'surdet_session_describe'), `${label} session.describe`);
      resultOf(await callTool(port, 'surdet_project_inspect'), `${label} project.inspect`);
      assert(names.includes('surdet_review_prepare_comparison') && names.includes('surdet_review_inspect_approval'), `${label} review tools missing`);
      assert(!names.includes('surdet_change_begin') && !names.includes('surdet_change_commit') && !names.includes('surdet_delivery_capsule'), `${label} observe policy exposed mutation/capsule`);
      assert(described.capabilities.length === 30, `${label} expected 30 capabilities, got ${described.capabilities.length}`);
      assert(described.contractVersion === '2.1.0', `${label} contract was ${described.contractVersion}`);
      const era = port.client.getProtocolEra();
      const negotiated = port.client.getNegotiatedProtocolVersion?.();
      if (label === 'legacy') {
        assert(era === 'legacy' && negotiated === '2025-11-25', `legacy protocol mismatch: ${era}/${negotiated}`);
      } else assert(era === 'modern', `${label} protocol era mismatch: ${era}`);
      return { label, era, negotiated, toolCount: names.length, capabilityCount: described.capabilities.length };
    });
    modern = await inspect(modernFixture, modernData, 'modern', { mode: 'auto' });
    legacy = await inspect(legacyFixture, legacyData, 'legacy', { mode: 'legacy' });
    stage = await withPort(harness, { projectRoot: stageFixture, policy: 'stage', dataDir: stageData }, async (port) => {
      const names = await listTools(port);
      assert(names.includes('surdet_change_begin') && names.includes('surdet_composition_execute'), 'stage policy omitted staging capabilities');
      assert(!names.includes('surdet_change_commit'), 'stage policy exposed commit');
      return { policy: 'stage', toolCount: names.length, mutationExposed: true, commitExposed: false };
    });
    assert(hashTree(starterRoot).sha256 === starterBefore.sha256, 'original Starter changed during preflight');
  } catch (error) {
    failure = error;
  } finally {
    await cleanupHarness(harness);
  }
  const payload = {
    status: failure === null ? 'PASSED' : 'FAILED',
    evidenceClass: 'PRE_FLIGHT',
    mode: 'preflight',
    runHead,
    runnerSha256,
    trackedCodeDiffPaths: trackedCodeDiffPaths(),
    milestones: [{ id: 'launcher-preflight', status: failure === null ? 'PASSED' : 'FAILED' }],
    projectMutation: { occurred: false, stageProjectMutated: false },
    errors: failure === null ? [] : [errorText(failure).slice(0, 4000)],
    consoleErrors: harness.consoleErrors,
    pageErrors: harness.pageErrors,
    requestFailures: harness.requestFailures,
    stderrLines: harness.stderrLines,
    childCleanupFailures: harness.childCleanupFailures,
    activeLeaseDirectories: [],
    protocol: { modern, legacy, stage, stdoutPurity: harness.protocolErrors.length === 0 },
    editorBuildEntries: { index: editorIndex, preview: editorPreview },
    originalStarterUnchanged: failure === null,
    browserFileSystemAccess: 'not-used-in-preflight',
  };
  const artifact = writeArtifact(artifactDirectory, payload);
  const output = { ...payload, artifactIdentity: artifact.identity, artifactPath: artifact.artifactPath, identityPath: artifact.identityPath };
  if (failure !== null) {
    console.error(JSON.stringify(output));
    process.exitCode = 1;
  } else console.log(JSON.stringify(output));
  return output;
}

async function runAcceptancePrep() {
  const desktop = path.join(os.homedir(), 'Desktop');
  assert(fs.existsSync(desktop), `Desktop directory missing: ${desktop}`);
  const result = await prepareAcceptance({ baseDirectory: desktop, prefix: 'surdet-human-review-acceptance-' });
  console.log(JSON.stringify({
    status: result.status,
    evidenceClass: 'ACCEPTANCE_PREP',
    mode: 'acceptance-prep',
    runHead,
    runnerSha256,
    trackedCodeDiffPaths: trackedCodeDiffPaths(),
    milestones: [],
    projectMutation: { occurred: false, stageProjectMutated: false },
    errors: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    stderrLines: [],
    childCleanupFailures: [],
    activeLeaseDirectories: result.evidence.activeLeaseDirectories,
    browserFileSystemAccess: 'not-used-in-acceptance-prep',
    acceptancePrep: result.artifactIdentity,
  }));
}

async function main() {
  const mode = modeFromArgv();
  if (!MODES.includes(mode)) {
    console.error('unsupported mode; use --mode=preflight|diagnostic|formal|acceptance-prep');
    process.exitCode = 2;
    return;
  }
  if (mode === 'preflight') return runPreflight();
  if (mode === 'acceptance-prep') return runAcceptancePrep();
  return runWorkflow(mode);
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === path.resolve(runnerPath)) {
  void main().catch((error) => {
    console.error(`Wave 6 human review runner failed: ${errorText(error)}`);
    process.exitCode = 1;
  });
}
