import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const MODES = Object.freeze(['preflight', 'formal']);
export const FORBIDDEN_PORTS = Object.freeze([4173, 4175]);
export const SEARCH_RANGE = Object.freeze({ from: 4260, to: 4269 });
export const MILESTONE_IDS = Object.freeze([
  'baseline-and-capability-surface',
  'isolated-review-fixtures',
  'authority-server-identity',
  'comparison-two-process-race',
  'comparison-idempotent-retry',
  'result-approval-return-two-process-race',
  'corrupt-both-files-fail-loud',
  'editor-authority-available',
  'editor-two-context-race',
  'losing-context-reopens-winner',
  'static-editor-read-only',
  'payload-identity-mismatch',
  'project-change-review-payload-unchanged',
  'process-and-lease-cleanup',
  'evidence-identity',
]);

const runnerPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(runnerPath);
const repoRoot = path.resolve(scriptDirectory, '../../..');
const editorRoot = path.join(repoRoot, 'packages/editor');
const editorDistRoot = path.join(editorRoot, 'dist');
const workerPath = path.join(repoRoot, 'packages/cli/test/fixtures/review-terminal-worker.mjs');
const starterRoot = path.join(repoRoot, 'examples/starter');
const runnerSha256 = sha256(fs.readFileSync(runnerPath));
const runHead = gitText(['rev-parse', 'HEAD']);
const runnerHeadIdentity = runHead;
const ISSUE_CHANNELS = Object.freeze([
  'errors',
  'protocolErrors',
  'consoleErrors',
  'pageErrors',
  'requestFailures',
  'stderrLines',
  'childCleanupFailures',
  'activeReviewLeaseDirectories',
]);
const TERMINAL_FILES = Object.freeze(['decision.json', 'final-approval.json', 'return-request.json']);
const textHasher = Object.freeze({
  sha256: async (text) => sha256(Buffer.from(text, 'utf8')),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitText(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

export function parseMode(argv) {
  assert(Array.isArray(argv) && argv.length === 1, 'exactly one runner mode is required');
  const argument = argv[0];
  assert(argument === '--preflight' || argument === '--formal', `unsupported runner mode: ${argument ?? '<missing>'}`);
  return argument.slice(2);
}

export function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.byteLength, sha256: sha256(bytes) };
}

export function verifyFileIdentity(file, identity) {
  const actual = readFileIdentity(file);
  assert(actual.bytes === identity?.bytes && actual.sha256 === identity?.sha256, `file identity mismatch: ${file}`);
  return actual;
}

export function blockingRunIssues(channels) {
  return ISSUE_CHANNELS.filter((name) => !Array.isArray(channels?.[name]) || channels[name].length !== 0);
}

export function assertFormalPreconditions({ trackedCodeDiffPaths, stagingPaths, runHead: actualHead, codeEvidenceHead }) {
  assert(Array.isArray(trackedCodeDiffPaths) && trackedCodeDiffPaths.length === 0, 'FORMAL requires a clean tracked worktree');
  assert(Array.isArray(stagingPaths) && stagingPaths.length === 0, 'FORMAL requires an empty staging area');
  assert(typeof codeEvidenceHead === 'string' && /^[0-9a-f]{40}$/i.test(codeEvidenceHead), 'FORMAL requires CODE_EVIDENCE_HEAD');
  assert(actualHead === codeEvidenceHead, 'FORMAL runHead must equal CODE_EVIDENCE_HEAD');
  return true;
}

export function validateEvidenceContract(evidence) {
  assert(evidence?.runHead === runnerHeadIdentity, 'evidence runHead does not match runner HEAD');
  assert(evidence?.runnerSha256 === runnerSha256, 'evidence runnerSha256 does not match runner bytes');
  assert(Array.isArray(evidence?.agentWriterCapabilities) && evidence.agentWriterCapabilities.length === 0, 'Agent writer capability is exposed');
  assert(evidence?.projectMutation === false, 'repository project was mutated');
  assert(evidence?.starterMutation === false, 'Starter was mutated');
  assert(blockingRunIssues(evidence?.channels).length === 0, 'evidence contains blocking issue channels');
  if (evidence?.mode === 'formal') {
    assert(evidence?.runHead === evidence?.codeEvidenceHead, 'FORMAL evidence head mismatch');
    assert(Array.isArray(evidence?.trackedCodeDiffPaths) && evidence.trackedCodeDiffPaths.length === 0, 'FORMAL evidence has tracked diffs');
    assert(Array.isArray(evidence?.stagingPaths) && evidence.stagingPaths.length === 0, 'FORMAL evidence has staged paths');
    assert(Array.isArray(evidence?.milestones), 'FORMAL milestones missing');
    assert(evidence.milestones.length === MILESTONE_IDS.length, 'FORMAL milestone count mismatch');
    assert(JSON.stringify(evidence.milestones.map((entry) => entry.id)) === JSON.stringify(MILESTONE_IDS), 'FORMAL milestone order mismatch');
    assert(evidence.milestones.every((entry) => entry.status === 'PASSED'), 'FORMAL has an incomplete milestone');
    assert(evidence?.formal?.processRaceBoundary === 'ReviewTerminalAuthority', 'process races must use ReviewTerminalAuthority');
    assert(evidence?.formal?.idempotentRetryBoundary === 'ReviewTerminalAuthority', 'idempotent retry must use ReviewTerminalAuthority');
    assert(Number.isInteger(evidence?.formal?.sourceStateBefore?.files) && evidence.formal.sourceStateBefore.files >= 3, 'source change evidence baseline is missing');
    assert(JSON.stringify(evidence.formal.sourceStateBefore) === JSON.stringify(evidence?.formal?.sourceStateAfter), 'source change evidence was mutated');
    assert(Array.isArray(evidence?.formal?.unexpectedTerminalFiles) && evidence.formal.unexpectedTerminalFiles.length === 0, 'FORMAL contains unexpected terminal files');
  }
  return true;
}

function trackedCodeDiffPaths() {
  const raw = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repoRoot, encoding: 'utf8' });
  return raw.split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .sort();
}

function stagingPaths() {
  const output = gitText(['diff', '--cached', '--name-only']);
  return output.length === 0 ? [] : output.split(/\r?\n/).filter(Boolean).sort();
}

function writeExclusiveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const descriptor = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return readFileIdentity(file);
}

function writeArtifact(directory, evidence) {
  const evidenceFile = path.join(directory, 'evidence.json');
  const identityFile = path.join(directory, 'identity.json');
  const identity = writeExclusiveJson(evidenceFile, evidence);
  writeExclusiveJson(identityFile, identity);
  verifyFileIdentity(evidenceFile, identity);
  return { evidenceFile, identityFile, identity };
}

function hashTree(root) {
  const rows = [];
  let totalBytes = 0;
  const visit = (directory, relativeDirectory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      const relative = (relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`).replaceAll('\\', '/');
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        totalBytes += bytes.byteLength;
        rows.push(`${relative}\0${bytes.byteLength}\0${sha256(bytes)}`);
      }
    }
  };
  visit(root, '');
  return { files: rows.length, bytes: totalBytes, sha256: sha256(Buffer.from(rows.join('\n'), 'utf8')) };
}

function fileMapForDirectory(root) {
  const files = [];
  const visit = (directory, relativeDirectory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push({ path: relative.replaceAll('\\', '/'), bytes: fs.readFileSync(absolute).toString('base64') });
    }
  };
  visit(root, '');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function fileIdentityOrNull(file) {
  return fs.existsSync(file) ? readFileIdentity(file) : null;
}

function terminalFilesForReview(reviewRoot) {
  return Object.fromEntries(TERMINAL_FILES.map((name) => [name, fileIdentityOrNull(path.join(reviewRoot, name))]));
}

export function unexpectedTerminalFiles(reviewRoot) {
  const allowed = new Set(['identity.json', ...TERMINAL_FILES]);
  return fs.readdirSync(reviewRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function activeReviewLeaseDirectories(dataRoot) {
  const reviewLocks = path.join(dataRoot, '.locks', 'reviews');
  if (!fs.existsSync(reviewLocks)) return [];
  return fs.readdirSync(reviewLocks, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.lock'))
    .map((entry) => path.join(reviewLocks, entry.name))
    .sort();
}

function unexpectedChangePaths(dataRoot) {
  const paths = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.name === 'changes' || entry.name.startsWith('chg_')) paths.push(absolute);
      if (entry.isDirectory() && entry.name !== '.locks' && entry.name !== '.review-terminal-worker') visit(absolute);
    }
  };
  visit(dataRoot);
  return paths.sort();
}

function createChannels() {
  return {
    errors: [],
    protocolErrors: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    stderrLines: [],
    childCleanupFailures: [],
    activeReviewLeaseDirectories: [],
  };
}

async function findAvailablePort(used = new Set()) {
  for (let port = SEARCH_RANGE.from; port <= SEARCH_RANGE.to; port += 1) {
    if (FORBIDDEN_PORTS.includes(port) || used.has(port)) continue;
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`no strict loopback port is available in ${SEARCH_RANGE.from}-${SEARCH_RANGE.to}`);
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = errorText(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`loopback server did not become ready: ${last}`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return !pidAlive(pid);
}

async function startVite(harness, dataRoot) {
  assert(fs.existsSync(path.join(editorDistRoot, 'index.html')), 'Editor dist/index.html is missing');
  const port = await findAvailablePort(harness.ports);
  harness.ports.add(port);
  const viteEntry = path.join(repoRoot, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: editorRoot,
    env: { ...process.env, SURDET_AGENT_DATA_DIR: dataRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  harness.children.add(child);
  harness.vite = child;
  harness.viteShutdownSignalSent = false;
  harness.viteClosePromise = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      const exit = { code, signal: signal ?? null, shutdownSignalSent: harness.viteShutdownSignalSent };
      harness.viteExit = exit;
      if (!exit.shutdownSignalSent) harness.channels.errors.push(`Vite exited unexpectedly: code=${code} signal=${signal ?? 'none'}`);
      resolve(exit);
    });
  });
  child.stderr.on('data', (chunk) => {
    harness.channels.stderrLines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
  });
  await waitForHttp(`http://127.0.0.1:${port}/index.html`);
  assert(child.exitCode === null, 'Vite exited before the authority became ready');
  return `http://127.0.0.1:${port}`;
}

function mimeType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function startStaticEditor(harness) {
  const port = await findAvailablePort(harness.ports);
  harness.ports.add(port);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(editorDistRoot, ...relative.split('/'));
    if (!file.startsWith(`${path.resolve(editorDistRoot)}${path.sep}`) && file !== path.join(path.resolve(editorDistRoot), 'index.html')) {
      response.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const bytes = fs.readFileSync(file);
    response.writeHead(200, { 'Content-Type': mimeType(file), 'Content-Length': bytes.byteLength, 'Cache-Control': 'no-store' });
    response.end(bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  harness.staticServers.add(server);
  return `http://127.0.0.1:${port}`;
}

async function closeHarness(harness) {
  for (const context of harness.contexts.splice(0)) {
    try { await context.close(); } catch (error) { harness.channels.childCleanupFailures.push(`browser context: ${errorText(error)}`); }
  }
  if (harness.browser !== null) {
    try { await harness.browser.close(); } catch (error) { harness.channels.childCleanupFailures.push(`browser: ${errorText(error)}`); }
    harness.browser = null;
  }
  for (const server of harness.staticServers) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        harness.channels.childCleanupFailures.push('static Editor server close timed out');
        resolve();
      }, 3_000);
      server.close((error) => {
        clearTimeout(timer);
        if (error) harness.channels.childCleanupFailures.push(`static Editor server: ${errorText(error)}`);
        resolve();
      });
    });
  }
  harness.staticServers.clear();
  if (harness.vite !== null) {
    const child = harness.vite;
    harness.vite = null;
    harness.children.delete(child);
    if (child.exitCode === null && child.signalCode === null) {
      harness.viteShutdownSignalSent = child.kill('SIGTERM');
    }
    const closed = await Promise.race([
      harness.viteClosePromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
    ]);
    if (!closed) {
      const killed = child.kill('SIGKILL');
      harness.viteShutdownSignalSent ||= killed;
      const killedAndClosed = await Promise.race([
        harness.viteClosePromise.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
      ]);
      if (!killedAndClosed) harness.channels.childCleanupFailures.push(`Vite child remained: ${child.pid}`);
    }
  }
  for (const child of harness.children) {
    const pid = child.pid;
    if (child.exitCode === null) child.kill('SIGTERM');
    if (Number.isInteger(pid) && !(await waitForPidExit(pid))) {
      child.kill('SIGKILL');
      if (!(await waitForPidExit(pid))) harness.channels.childCleanupFailures.push(`worker child remained: ${pid}`);
    }
  }
  harness.children.clear();
}

function createHarness() {
  return {
    ports: new Set(),
    vite: null,
    viteClosePromise: Promise.resolve(null),
    viteExit: null,
    viteShutdownSignalSent: false,
    staticServers: new Set(),
    browser: null,
    contexts: [],
    children: new Set(),
    authorityWriteResponses: [],
    channels: createChannels(),
  };
}

function commonProjection(projectIdentity, reviewId) {
  return {
    reviewVersion: '1.0.0',
    reviewId,
    projectIdentity,
    expectedProjectRevision: 'project-revision-atomicity',
    task: {
      title: '原子终态审阅',
      acceptanceCriteria: [],
      candidateCount: 0,
      objectCount: 0,
      conflictCount: 0,
      statementSource: 'generated-fallback',
    },
    candidates: [],
    safeGroups: [],
    conflicts: [],
    dependencies: [],
    defaultSelectedUnitIds: [],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
    objects: [],
    reviewFingerprint: 'review-fingerprint-atomicity',
  };
}

function comparisonProjection(projectIdentity, reviewId) {
  return {
    ...commonProjection(projectIdentity, reviewId),
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    sourceIdentity: {
      projectIdentity,
      expectedProjectRevision: 'project-revision-atomicity',
      comparisonFingerprint: 'comparison-fingerprint-atomicity',
    },
  };
}

function resultProjection(projectIdentity, reviewId) {
  return {
    ...commonProjection(projectIdentity, reviewId),
    kind: 'integration-result',
    state: 'STAGE_READY',
    sourceIdentity: {
      projectIdentity,
      expectedProjectRevision: 'project-revision-atomicity',
      comparisonFingerprint: 'comparison-fingerprint-atomicity',
      planFingerprint: 'plan-fingerprint-atomicity',
      integrationChangeId: 'chg_atomicity_integration',
      workingRevision: 3,
      decisionReviewId: 'review_atomicity_decision',
      decisionId: 'decision-atomicity-source',
      decisionFingerprint: 'decision-fingerprint-atomicity-source',
    },
    finalResult: {
      planId: 'plan-atomicity',
      planFingerprint: 'plan-fingerprint-atomicity',
      integrationChangeId: 'chg_atomicity_integration',
      workingRevision: 3,
      diffFingerprint: 'diff-fingerprint-atomicity',
      changedObjects: [],
      evidence: {
        diffEvidenceId: 'diff-evidence-atomicity',
        validationEvidenceId: 'validation-evidence-atomicity',
        simulationEvidenceId: 'simulation-evidence-atomicity',
        runtimeTraceIds: ['trace-atomicity'],
      },
      plan: {},
      diff: {},
      freshness: {},
      runtimeTraceObservations: [],
      resultTreeSha256: 'f'.repeat(64),
      warnings: [],
    },
  };
}

export async function prepareFixtures(root) {
  const dataRoot = path.join(root, 'agent-data');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'project-sentinel.json'), '{"unchanged":true}\n', 'utf8');
  const rootIdentity = fs.realpathSync(projectRoot);
  const { projectIdentityFromRoot } = await import('../dist/authoring/project-identity.js');
  const projectIdentity = projectIdentityFromRoot(rootIdentity);
  const { NodeReviewStore } = await import('../dist/authoring/node-review-store.js');
  const store = new NodeReviewStore(path.join(dataRoot, projectIdentity), projectIdentity);
  const previousDataRoot = process.env.SURDET_AGENT_DATA_DIR;
  process.env.SURDET_AGENT_DATA_DIR = dataRoot;
  let sourceStateRoot;
  try {
    const { NodeChangeStore } = await import('../dist/authoring/node-change-store.js');
    const { beginChange } = await import('@surdet/authoring');
    const sourceStore = await NodeChangeStore.forProject(rootIdentity);
    const sourceSession = await beginChange({
      rootIdentity,
      revision: sha256(Buffer.from('review-terminal-source-baseline', 'utf8')),
      files: [],
      configFile: null,
      config: {},
      variables: {},
      scenes: [],
      timelines: [],
    }, sourceStore, undefined, undefined, {
      integration: {
        planId: 'plan-source-canary',
        planFingerprint: 'a'.repeat(64),
        executeOperationId: 'execute-source-canary',
        sourceCapsules: [],
        includedUnitIds: [],
        deduplicatedUnits: [],
        conflictResolutions: [],
        status: 'READY',
        nextOperationIndex: 0,
        replayedOperations: [],
      },
    });
    await NodeChangeStore.withChangeLease(sourceSession.record.changeId, async (leasedStore) => {
      await leasedStore.writeCapsulePayload(sourceSession.record.changeId, 'cap_source_canary', {
        capsuleVersion: '1.0.0',
        capsuleId: 'cap_source_canary',
        changeId: sourceSession.record.changeId,
        sealed: true,
        source: 'immutable-canary',
      });
    });
    sourceStateRoot = path.join(sourceStore.projectDirectory, sourceSession.record.changeId);
    for (const required of [
      'manifest.json',
      'record-head.json',
      'capsules/cap_source_canary/payload.json',
      'capsules/cap_source_canary/identity.json',
    ]) assert(fs.existsSync(path.join(sourceStateRoot, ...required.split('/'))), `valid source canary is missing ${required}`);
  } finally {
    if (previousDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
    else process.env.SURDET_AGENT_DATA_DIR = previousDataRoot;
  }
  const specifications = {
    comparisonRace: comparisonProjection(projectIdentity, 'review_comparison_process_race'),
    resultRace: resultProjection(projectIdentity, 'review_result_process_race'),
    corruptResult: resultProjection(projectIdentity, 'review_result_corrupt_both'),
    browserRace: comparisonProjection(projectIdentity, 'review_comparison_browser_race'),
    payloadMismatch: comparisonProjection(projectIdentity, 'review_payload_identity_mismatch'),
  };
  const reviews = {};
  for (const [name, projection] of Object.entries(specifications)) {
    const identity = await store.createReview(projection.reviewId, projection);
    const reviewRoot = path.join(dataRoot, projectIdentity, 'reviews', projection.reviewId);
    const payloadFile = path.join(reviewRoot, projection.kind === 'comparison' ? 'comparison/review.json' : 'result/review.json');
    const identityFile = path.join(reviewRoot, 'identity.json');
    reviews[name] = {
      projection,
      identity: {
        projectIdentity,
        reviewId: projection.reviewId,
        reviewPayload: { bytes: identity.payload.bytes, sha256: identity.payload.sha256 },
      },
      reviewRoot,
      payloadFile,
      identityFile,
      payloadIdentity: readFileIdentity(payloadFile),
      reviewIdentity: readFileIdentity(identityFile),
    };
  }
  return { root, dataRoot, projectRoot, rootIdentity, projectIdentity, sourceStateRoot, store, reviews };
}

async function makeDecision(authoring, projectIdentity, reviewId, decisionId) {
  const unsigned = {
    receiptVersion: '1.0.0',
    decisionId,
    reviewId,
    comparisonFingerprint: 'comparison-fingerprint-atomicity',
    projectIdentity,
    expectedProjectRevision: 'project-revision-atomicity',
    candidateRefs: [],
    selectedUnitIds: [],
    conflictResolutions: [],
    reviewerChannel: 'surdet-editor-local',
    decidedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...unsigned, decisionFingerprint: await authoring.decisionFingerprintOf(unsigned, textHasher) };
}

async function makeApproval(authoring, fixture) {
  const finalResult = fixture.projection.finalResult;
  const unsigned = {
    receiptVersion: '1.0.0',
    approvalId: 'approval-atomicity-winner',
    resultReviewId: fixture.projection.reviewId,
    decisionFingerprint: 'decision-fingerprint-atomicity-source',
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    projectIdentity: fixture.projection.projectIdentity,
    expectedProjectRevision: 'project-revision-atomicity',
    diffFingerprint: finalResult.diffFingerprint,
    evidence: finalResult.evidence,
    resultTreeSha256: finalResult.resultTreeSha256,
    reviewerChannel: 'surdet-editor-local',
    approvedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...unsigned, approvalFingerprint: await authoring.approvalFingerprintOf(unsigned, textHasher) };
}

async function makeReturn(authoring, fixture) {
  const unsigned = {
    receiptVersion: '1.0.0',
    returnId: 'return-atomicity-loser',
    resultReviewId: fixture.projection.reviewId,
    planId: 'plan-atomicity',
    planFingerprint: 'plan-fingerprint-atomicity',
    integrationChangeId: 'chg_atomicity_integration',
    workingRevision: 3,
    reasonCategory: 'content',
    reviewerChannel: 'surdet-editor-local',
    returnedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...unsigned, returnFingerprint: await authoring.returnFingerprintOf(unsigned, textHasher) };
}

function runWorker(harness, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] });
    harness.children.add(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`review worker timed out: ${child.pid}`));
    }, 35_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      harness.children.delete(child);
      if (stderr.trim().length > 0) harness.channels.stderrLines.push(...stderr.split(/\r?\n/).filter(Boolean));
      if (code !== 0) {
        reject(new Error(`review worker exited ${code}: ${stderr || stdout}`));
        return;
      }
      try { resolve({ pid: child.pid, ...JSON.parse(stdout) }); }
      catch (error) { reject(new Error(`review worker returned invalid JSON: ${errorText(error)}`)); }
    });
    child.stdin.end(JSON.stringify(command));
  });
}

async function runTwoWorkers(harness, fixtures, fixture, actions) {
  const commands = actions.map(({ action, receipt }) => ({
    dataRoot: fixtures.dataRoot,
    projectIdentity: fixtures.projectIdentity,
    reviewId: fixture.projection.reviewId,
    action: 'authority',
    terminalCommand: {
      protocolVersion: '1.0.0',
      requestId: `review_process_${crypto.randomUUID()}`,
      projectIdentity: fixtures.projectIdentity,
      reviewId: fixture.projection.reviewId,
      reviewPayload: { ...fixture.identity.reviewPayload },
      action: action === 'decision'
        ? 'comparison-decision'
        : action === 'approval' ? 'result-approval' : 'result-return',
      receipt,
    },
  }));
  const rawResults = await Promise.all(commands.map((command) => runWorker(harness, command)));
  const results = rawResults.map((result, index) => ({ ...result, submitted: actions[index] }));
  const barrier = path.join(fixtures.dataRoot, '.review-terminal-worker', fixture.projection.reviewId);
  fs.rmSync(barrier, { recursive: true, force: true });
  const written = results.filter((entry) => entry.status === 'written');
  const rejected = results.filter((entry) => entry.status === 'rejected');
  assert(written.length === 1 && rejected.length === 1, `race must have one winner and one loser: ${JSON.stringify(results)}`);
  assert(['REVIEW_BUSY', 'REVIEW_TERMINAL_ALREADY_SET'].includes(rejected[0].code), `unexpected race loser: ${rejected[0].code}`);
  assert(written[0].boundary === 'ReviewTerminalAuthority', 'process race bypassed ReviewTerminalAuthority');
  return { results, written: written[0], rejected: rejected[0], pids: results.map((entry) => entry.pid) };
}

async function runProbeWorkers(harness, fixtures, fixture) {
  const commands = [0, 1].map((index) => ({
    dataRoot: fixtures.dataRoot,
    projectIdentity: fixtures.projectIdentity,
    reviewId: fixture.projection.reviewId,
    action: `probe-${index}`,
    receipt: { probe: index },
  }));
  const results = await Promise.all(commands.map((command) => runWorker(harness, command)));
  const barrier = path.join(fixtures.dataRoot, '.review-terminal-worker', fixture.projection.reviewId);
  fs.rmSync(barrier, { recursive: true, force: true });
  assert(results.every((entry) => entry.status === 'rejected' && entry.code === 'WORKER_ERROR'), 'preflight worker probe did not reach the real worker boundary');
  assert(Object.values(terminalFilesForReview(fixture.reviewRoot)).every((value) => value === null), 'preflight worker probe created a terminal receipt');
  return results.map((entry) => ({ pid: entry.pid, status: entry.status, code: entry.code }));
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
  const fail = (message) => { throw new DOMException(message, 'NotFoundError'); };
  const mime = (name) => name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  const makeFile = (filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    async getFile() {
      if (!fileMap.has(filePath)) fail(`missing file ${filePath}`);
      const binary = Uint8Array.from(atob(fileMap.get(filePath)), (character) => character.charCodeAt(0));
      return new File([binary], filePath.split('/').pop(), { type: mime(filePath), lastModified: 0 });
    },
  });
  const makeDirectory = (directoryPath) => ({
    kind: 'directory',
    name: directoryPath.length === 0 ? 'review' : directoryPath.split('/').pop(),
    async getFileHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      if (!fileMap.has(child) || options.create) fail(`read-only file ${child}`);
      return makeFile(child);
    },
    async getDirectoryHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      if (!directories.has(child) || options.create) fail(`read-only directory ${child}`);
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
      for (const file of fileMap.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest.includes('/')) children.set(rest, makeFile(file));
      }
      return (async function* entries() { for (const child of children.values()) yield child; })();
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => makeDirectory('');
};

function observePage(harness, page, label) {
  page.on('console', (message) => { if (message.type() === 'error') harness.channels.consoleErrors.push(`${label}: ${message.text()}`); });
  page.on('pageerror', (error) => harness.channels.pageErrors.push(`${label}: ${errorText(error)}`));
  page.on('requestfailed', (request) => harness.channels.requestFailures.push(`${label}: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => {
    if (!response.url().endsWith('/__surdet/review-authority/v1/write')) return;
    void response.json().then((body) => {
      const validEnvelope = response.ok()
        ? body?.ok === true && body?.result !== undefined
        : body?.ok === false && typeof body?.error?.code === 'string';
      if (!validEnvelope) harness.channels.protocolErrors.push(`${label}: invalid authority write envelope (${response.status()})`);
      harness.authorityWriteResponses.push({ label, status: response.status(), body });
    }, (error) => {
      harness.channels.protocolErrors.push(`${label}: authority write response JSON failed: ${errorText(error)}`);
    });
  });
}

async function newReviewPage(harness, baseUrl, reviewRoot, label) {
  const context = await harness.browser.newContext({ viewport: { width: 1440, height: 900 } });
  harness.contexts.push(context);
  await context.addInitScript(fakeFileSystemInit, { files: fileMapForDirectory(reviewRoot) });
  const page = await context.newPage();
  observePage(harness, page, label);
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开审阅任务' }).click();
  await page.locator('[data-action="save-decision"]').waitFor({ state: 'visible' });
  return { context, page };
}

async function readAuthorityConfig(page) {
  return page.evaluate(() => window.__SURDET_REVIEW_AUTHORITY__ ?? null);
}

async function postAuthority(page, suffix, body) {
  return page.evaluate(async ({ suffix: route, body: payload }) => {
    const config = window.__SURDET_REVIEW_AUTHORITY__;
    if (!config) throw new Error('authority configuration missing');
    const response = await fetch(`${config.endpoint}/${route}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Surdet-Review-Authority': config.token },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    return { status: response.status, body: await response.json() };
  }, { suffix, body });
}

async function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function waitForCondition(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function milestone(state, id, operation) {
  const ordinal = state.milestones.length + 1;
  assert(MILESTONE_IDS[ordinal - 1] === id, `milestone order mismatch at ${ordinal}: ${id}`);
  const startedAt = new Date().toISOString();
  try {
    const detail = await operation();
    const entry = { ordinal, id, status: 'PASSED', startedAt, finishedAt: new Date().toISOString(), detail };
    writeExclusiveJson(path.join(state.artifactRoot, 'milestones', `${String(ordinal).padStart(2, '0')}-${id}.json`), entry);
    state.milestones.push(entry);
    return detail;
  } catch (error) {
    const entry = { ordinal, id, status: 'FAILED', startedAt, finishedAt: new Date().toISOString(), error: errorText(error) };
    writeExclusiveJson(path.join(state.artifactRoot, 'milestones', `${String(ordinal).padStart(2, '0')}-${id}.json`), entry);
    state.milestones.push(entry);
    throw error;
  }
}

async function runPreflight(state, harness, fixtures, authoring) {
  const viteUrl = await startVite(harness, fixtures.dataRoot);
  const staticUrl = await startStaticEditor(harness);
  harness.browser = await chromium.launch({ headless: true });
  const authorityPage = await newReviewPage(harness, viteUrl, fixtures.reviews.browserRace.reviewRoot, 'preflight-authority');
  const config = await readAuthorityConfig(authorityPage.page);
  assert(config?.protocolVersion === '1.0.0'
    && config.endpoint === '/__surdet/review-authority/v1'
    && typeof config.token === 'string'
    && config.token.length >= 16, 'authority identity is invalid');
  const status = await authorityPage.page.evaluate(async () => {
    const current = window.__SURDET_REVIEW_AUTHORITY__;
    const response = await fetch(`${current.endpoint}/status`, { headers: { 'X-Surdet-Review-Authority': current.token } });
    return { status: response.status, body: await response.json() };
  });
  assert(status.status === 200 && status.body?.result?.status === 'available', 'authority status endpoint unavailable');
  const badToken = await fetch(`${viteUrl}${config.endpoint}/status`, { headers: { 'X-Surdet-Review-Authority': 'wrong-token-for-rejection' } });
  assert(badToken.status === 403, 'authority accepted an invalid token');
  const staticPage = await newReviewPage(harness, staticUrl, fixtures.reviews.payloadMismatch.reviewRoot, 'preflight-static');
  assert(await readAuthorityConfig(staticPage.page) === null, 'static Editor unexpectedly received authority configuration');
  assert(await staticPage.page.locator('[data-action="save-decision"]').isDisabled(), 'static Editor terminal action is writable');
  const workers = await runProbeWorkers(harness, fixtures, fixtures.reviews.payloadMismatch);
  const agentWriterCapabilities = authoring.AUTHORING_CAPABILITY_IDS.filter((id) => /^review\.(?:write|save|approve|return|decide)/.test(id));
  const before = terminalFilesForReview(fixtures.reviews.browserRace.reviewRoot);
  assert(Object.values(before).every((value) => value === null), 'preflight created a terminal receipt');
  return {
    status: 'PASSED',
    checks: {
      endpointIdentity: { baseUrl: viteUrl, endpoint: config.endpoint, protocolVersion: config.protocolVersion },
      tokenRejection: badToken.status,
      fixturePayload: fixtures.reviews.browserRace.payloadIdentity,
      workerProcesses: workers,
      browserContexts: 2,
      staticEditorReadOnly: true,
      terminalFiles: before,
    },
    agentWriterCapabilities,
  };
}

async function runFormal(state, harness, fixtures, authoring) {
  const projectTreeBefore = hashTree(fixtures.projectRoot);
  const starterBefore = hashTree(starterRoot);
  const sourceStateBefore = hashTree(fixtures.sourceStateRoot);
  const payloadBefore = Object.fromEntries(Object.entries(fixtures.reviews).map(([name, review]) => [name, {
    payload: readFileIdentity(review.payloadFile),
    identity: readFileIdentity(review.identityFile),
  }]));
  const changePathsBefore = unexpectedChangePaths(fixtures.dataRoot);
  const unexpectedTerminalFilesBefore = Object.fromEntries(Object.entries(fixtures.reviews).map(([name, review]) => [name, unexpectedTerminalFiles(review.reviewRoot)]));
  let processDecisionReceipt;
  let browserDecisionReceipt;
  let comparisonRace;
  let resultRace;
  let viteUrl;
  let staticUrl;
  let firstContext;
  let secondContext;

  await milestone(state, 'baseline-and-capability-surface', async () => {
    const agentWriterCapabilities = authoring.AUTHORING_CAPABILITY_IDS.filter((id) => /^review\.(?:write|save|approve|return|decide)/.test(id));
    assert(agentWriterCapabilities.length === 0, 'Agent review writer capability exists');
    return { runHead, codeEvidenceHead: state.codeEvidenceHead, trackedCodeDiffPaths: state.trackedCodeDiffPaths, stagingPaths: state.stagingPaths, agentWriterCapabilities };
  });

  await milestone(state, 'isolated-review-fixtures', async () => {
    assert(fixtures.root.startsWith(os.tmpdir()), 'fixture root is not isolated in the system temp directory');
    assert(!fixtures.root.startsWith(repoRoot), 'fixture root is inside the repository');
    assert(Object.values(fixtures.reviews).every((review) => review.payloadIdentity.bytes > 0 && review.payloadIdentity.sha256.length === 64), 'fixture payload identity missing');
    return { root: fixtures.root, projectIdentity: fixtures.projectIdentity, reviews: Object.fromEntries(Object.entries(fixtures.reviews).map(([name, review]) => [name, review.identity])) };
  });

  await milestone(state, 'authority-server-identity', async () => {
    viteUrl = await startVite(harness, fixtures.dataRoot);
    staticUrl = await startStaticEditor(harness);
    harness.browser = await chromium.launch({ headless: true });
    const bootstrap = await newReviewPage(harness, viteUrl, fixtures.reviews.payloadMismatch.reviewRoot, 'authority-identity');
    const config = await readAuthorityConfig(bootstrap.page);
    assert(config?.protocolVersion === '1.0.0'
      && config.endpoint === '/__surdet/review-authority/v1'
      && typeof config.token === 'string'
      && config.token.length >= 16, 'authority browser identity missing');
    const status = await bootstrap.page.evaluate(async () => {
      const current = window.__SURDET_REVIEW_AUTHORITY__;
      const response = await fetch(`${current.endpoint}/status`, { headers: { 'X-Surdet-Review-Authority': current.token } });
      return { status: response.status, body: await response.json() };
    });
    const badToken = await fetch(`${viteUrl}${config.endpoint}/status`, { headers: { 'X-Surdet-Review-Authority': 'invalid-token-rejection-control' } });
    const badOrigin = await fetch(`${viteUrl}${config.endpoint}/describe`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:1', 'Content-Type': 'application/json', 'X-Surdet-Review-Authority': config.token },
      body: JSON.stringify(fixtures.reviews.payloadMismatch.identity),
    });
    assert(status.status === 200 && status.body?.result?.status === 'available', 'authority status identity failed');
    assert(badToken.status === 403 && badOrigin.status === 403, 'authority rejection controls failed');
    await bootstrap.context.close();
    harness.contexts = harness.contexts.filter((entry) => entry !== bootstrap.context);
    return { baseUrl: viteUrl, endpoint: config.endpoint, tokenLength: config.token.length, tokenRejection: badToken.status, originRejection: badOrigin.status };
  });

  await milestone(state, 'comparison-two-process-race', async () => {
    const first = await makeDecision(authoring, fixtures.projectIdentity, fixtures.reviews.comparisonRace.projection.reviewId, 'decision-process-first');
    const second = await makeDecision(authoring, fixtures.projectIdentity, fixtures.reviews.comparisonRace.projection.reviewId, 'decision-process-second');
    comparisonRace = await runTwoWorkers(harness, fixtures, fixtures.reviews.comparisonRace, [
      { action: 'decision', receipt: first },
      { action: 'decision', receipt: second },
    ]);
    const file = path.join(fixtures.reviews.comparisonRace.reviewRoot, 'decision.json');
    processDecisionReceipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diskIdentity = readFileIdentity(file);
    const terminal = terminalFilesForReview(fixtures.reviews.comparisonRace.reviewRoot);
    assert(terminal['decision.json'] !== null && terminal['final-approval.json'] === null && terminal['return-request.json'] === null, 'comparison race did not leave exactly one decision');
    assert(JSON.stringify(processDecisionReceipt) === JSON.stringify(comparisonRace.written.submitted.receipt), 'comparison winner receipt does not match disk');
    assert(comparisonRace.written.identity?.bytes === diskIdentity.bytes && comparisonRace.written.identity?.sha256 === diskIdentity.sha256, 'comparison winner identity does not match disk');
    return { ...comparisonRace, terminal, diskIdentity, decisionId: processDecisionReceipt.decisionId };
  });

  await milestone(state, 'comparison-idempotent-retry', async () => {
    const file = path.join(fixtures.reviews.comparisonRace.reviewRoot, 'decision.json');
    const before = readFileIdentity(file);
    const { ReviewTerminalAuthority } = await import('../dist/authoring/review-terminal-authority.js');
    const authority = new ReviewTerminalAuthority(fixtures.dataRoot);
    const retrySnapshot = await authority.write({
      protocolVersion: '1.0.0',
      requestId: `review_retry_${crypto.randomUUID()}`,
      projectIdentity: fixtures.projectIdentity,
      reviewId: fixtures.reviews.comparisonRace.projection.reviewId,
      reviewPayload: { ...fixtures.reviews.comparisonRace.identity.reviewPayload },
      action: 'comparison-decision',
      receipt: processDecisionReceipt,
    });
    const retry = retrySnapshot.record;
    const after = readFileIdentity(file);
    assert(before.bytes === after.bytes && before.sha256 === after.sha256, 'idempotent retry changed decision bytes');
    assert(retry?.action === 'comparison-decision' && retry.bytes === before.bytes && retry.sha256 === before.sha256, 'idempotent retry identity differs');
    return { boundary: 'ReviewTerminalAuthority', before, after, retry: { bytes: retry.bytes, sha256: retry.sha256 } };
  });

  await milestone(state, 'result-approval-return-two-process-race', async () => {
    const approval = await makeApproval(authoring, fixtures.reviews.resultRace);
    const returned = await makeReturn(authoring, fixtures.reviews.resultRace);
    resultRace = await runTwoWorkers(harness, fixtures, fixtures.reviews.resultRace, [
      { action: 'approval', receipt: approval },
      { action: 'return', receipt: returned },
    ]);
    const terminal = terminalFilesForReview(fixtures.reviews.resultRace.reviewRoot);
    const present = Object.entries(terminal).filter(([, value]) => value !== null);
    assert(present.length === 1 && present[0][0] !== 'decision.json', 'result race did not leave exactly one result terminal');
    const expectedWinnerFile = resultRace.written.submitted.action === 'approval' ? 'final-approval.json' : 'return-request.json';
    assert(present[0][0] === expectedWinnerFile, 'result race winner file does not match the written action');
    const winnerFile = path.join(fixtures.reviews.resultRace.reviewRoot, expectedWinnerFile);
    const diskIdentity = readFileIdentity(winnerFile);
    const diskReceipt = JSON.parse(fs.readFileSync(winnerFile, 'utf8'));
    assert(JSON.stringify(diskReceipt) === JSON.stringify(resultRace.written.submitted.receipt), 'result winner receipt does not match disk');
    assert(resultRace.written.identity?.bytes === diskIdentity.bytes && resultRace.written.identity?.sha256 === diskIdentity.sha256, 'result winner identity does not match disk');
    return { ...resultRace, terminal, winnerFile: expectedWinnerFile, diskIdentity };
  });

  await milestone(state, 'corrupt-both-files-fail-loud', async () => {
    const approval = await makeApproval(authoring, fixtures.reviews.corruptResult);
    const returned = await makeReturn(authoring, fixtures.reviews.corruptResult);
    const approvalFile = path.join(fixtures.reviews.corruptResult.reviewRoot, 'final-approval.json');
    const returnFile = path.join(fixtures.reviews.corruptResult.reviewRoot, 'return-request.json');
    fs.writeFileSync(approvalFile, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
    fs.writeFileSync(returnFile, `${JSON.stringify(returned, null, 2)}\n`, 'utf8');
    const before = { approval: readFileIdentity(approvalFile), returned: readFileIdentity(returnFile) };
    const { ReviewTerminalAuthority } = await import('../dist/authoring/review-terminal-authority.js');
    const authority = new ReviewTerminalAuthority(fixtures.dataRoot);
    const snapshot = await authority.describe(fixtures.reviews.corruptResult.identity);
    const after = { approval: readFileIdentity(approvalFile), returned: readFileIdentity(returnFile) };
    assert(snapshot.state === 'corrupt', 'both result terminals were not reported corrupt');
    assert(JSON.stringify(before) === JSON.stringify(after), 'corrupt terminal evidence was modified');
    return { snapshot, before, after };
  });

  await milestone(state, 'editor-authority-available', async () => {
    firstContext = await newReviewPage(harness, viteUrl, fixtures.reviews.browserRace.reviewRoot, 'first-context');
    secondContext = await newReviewPage(harness, viteUrl, fixtures.reviews.browserRace.reviewRoot, 'second-context');
    const firstConfig = await readAuthorityConfig(firstContext.page);
    const secondConfig = await readAuthorityConfig(secondContext.page);
    const firstDisabled = await firstContext.page.locator('[data-action="save-decision"]').isDisabled();
    const secondDisabled = await secondContext.page.locator('[data-action="save-decision"]').isDisabled();
    assert(firstConfig?.endpoint === secondConfig?.endpoint && firstConfig?.token === secondConfig?.token, 'browser contexts do not share authority identity');
    assert(!firstDisabled && !secondDisabled, 'authority-backed Editor terminal action is not available');
    return { endpoint: firstConfig.endpoint, firstWritable: !firstDisabled, secondWritable: !secondDisabled, contexts: 2 };
  });

  await milestone(state, 'editor-two-context-race', async () => {
    const responseOffset = harness.authorityWriteResponses.length;
    await Promise.all([
      firstContext.page.locator('[data-action="save-decision"]').click(),
      secondContext.page.locator('[data-action="save-decision"]').click(),
    ]);
    const decisionFile = path.join(fixtures.reviews.browserRace.reviewRoot, 'decision.json');
    await waitForFile(decisionFile);
    await waitForCondition(
      () => harness.authorityWriteResponses.length - responseOffset >= 2,
      'two browser authority write responses were not observed',
    );
    const responses = harness.authorityWriteResponses.slice(responseOffset);
    assert(responses.length === 2, `browser race emitted ${responses.length} writes instead of 2`);
    assert(new Set(responses.map((entry) => entry.label)).size === 2, 'browser race did not include both contexts');
    const successes = responses.filter((entry) => entry.status === 200 && entry.body?.ok === true);
    const losers = responses.filter((entry) => entry.status === 409
      && entry.body?.ok === false
      && ['REVIEW_BUSY', 'REVIEW_TERMINAL_ALREADY_SET'].includes(entry.body?.error?.code));
    assert(successes.length === 1 && losers.length === 1, `browser race response split is invalid: ${JSON.stringify(responses)}`);
    browserDecisionReceipt = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));
    const diskIdentity = readFileIdentity(decisionFile);
    const winnerRecord = successes[0].body.result?.record;
    assert(JSON.stringify(winnerRecord?.receipt) === JSON.stringify(browserDecisionReceipt), 'browser winner response does not match disk receipt');
    assert(winnerRecord?.bytes === diskIdentity.bytes && winnerRecord?.sha256 === diskIdentity.sha256, 'browser winner identity does not match disk');
    const terminal = terminalFilesForReview(fixtures.reviews.browserRace.reviewRoot);
    assert(terminal['decision.json'] !== null && terminal['final-approval.json'] === null && terminal['return-request.json'] === null, 'browser race did not leave one decision');
    return { responses, canonicalDecisionId: browserDecisionReceipt.decisionId, diskIdentity, terminal };
  });

  await milestone(state, 'losing-context-reopens-winner', async () => {
    const reopened = [];
    for (const [label, browserContext] of [['first', firstContext], ['second', secondContext]]) {
      await browserContext.page.reload({ waitUntil: 'networkidle' });
      await browserContext.page.getByRole('button', { name: '打开审阅任务' }).click();
      const marker = browserContext.page.getByText('已读取已保存的决定', { exact: true });
      await marker.waitFor({ state: 'visible' });
      const disabled = await browserContext.page.locator('[data-action="save-decision"]').isDisabled();
      const reopenedDecisionId = await marker.getAttribute('data-decision-id');
      assert(disabled && reopenedDecisionId === browserDecisionReceipt.decisionId, `${label} context did not reopen the canonical winner`);
      reopened.push({ label, disabled, decisionIdVisible: true });
    }
    return { canonicalDecisionId: browserDecisionReceipt.decisionId, contexts: reopened };
  });

  await milestone(state, 'static-editor-read-only', async () => {
    const staticEditor = await newReviewPage(harness, staticUrl, fixtures.reviews.payloadMismatch.reviewRoot, 'static-context');
    const config = await readAuthorityConfig(staticEditor.page);
    const disabled = await staticEditor.page.locator('[data-action="save-decision"]').isDisabled();
    const stateValue = await staticEditor.page.locator('[data-review-authority-state="unavailable"]').getAttribute('data-review-authority-state');
    assert(config === null && disabled && stateValue === 'unavailable', 'static Editor terminal path is not read-only');
    return { authorityConfiguration: config, decisionDisabled: disabled, authorityState: stateValue };
  });

  await milestone(state, 'payload-identity-mismatch', async () => {
    const response = await postAuthority(firstContext.page, 'describe', {
      ...fixtures.reviews.payloadMismatch.identity,
      reviewPayload: { ...fixtures.reviews.payloadMismatch.identity.reviewPayload, sha256: '0'.repeat(64) },
    });
    assert(response.status === 409 && response.body?.error?.code === 'REVIEW_IDENTITY_MISMATCH', `payload mismatch was not rejected: ${JSON.stringify(response)}`);
    const terminal = terminalFilesForReview(fixtures.reviews.payloadMismatch.reviewRoot);
    assert(Object.values(terminal).every((value) => value === null), 'payload mismatch created a terminal receipt');
    return { status: response.status, code: response.body.error.code, terminal };
  });

  await milestone(state, 'project-change-review-payload-unchanged', async () => {
    const projectTreeAfter = hashTree(fixtures.projectRoot);
    const starterAfter = hashTree(starterRoot);
    const sourceStateAfter = hashTree(fixtures.sourceStateRoot);
    const payloadAfter = Object.fromEntries(Object.entries(fixtures.reviews).map(([name, review]) => [name, {
      payload: readFileIdentity(review.payloadFile),
      identity: readFileIdentity(review.identityFile),
    }]));
    const changePathsAfter = unexpectedChangePaths(fixtures.dataRoot);
    const unexpectedTerminalFilesAfter = Object.fromEntries(Object.entries(fixtures.reviews).map(([name, review]) => [name, unexpectedTerminalFiles(review.reviewRoot)]));
    assert(JSON.stringify(projectTreeBefore) === JSON.stringify(projectTreeAfter), 'isolated project tree changed');
    assert(JSON.stringify(starterBefore) === JSON.stringify(starterAfter), 'original Starter changed');
    assert(JSON.stringify(sourceStateBefore) === JSON.stringify(sourceStateAfter), 'source change/integration/capsule evidence changed');
    assert(JSON.stringify(payloadBefore) === JSON.stringify(payloadAfter), 'immutable review payload changed');
    assert(JSON.stringify(changePathsBefore) === JSON.stringify(changePathsAfter), 'unexpected change data was created');
    assert(JSON.stringify(unexpectedTerminalFilesBefore) === JSON.stringify(unexpectedTerminalFilesAfter)
      && Object.values(unexpectedTerminalFilesAfter).every((files) => files.length === 0), 'unexpected terminal files were created');
    return { projectTreeBefore, projectTreeAfter, starterBefore, starterAfter, sourceStateBefore, sourceStateAfter, payloadBefore, payloadAfter, changePathsBefore, changePathsAfter, unexpectedTerminalFilesBefore, unexpectedTerminalFilesAfter };
  });

  await milestone(state, 'process-and-lease-cleanup', async () => {
    const workerPids = [...(comparisonRace?.pids ?? []), ...(resultRace?.pids ?? [])];
    assert(workerPids.every((pid) => !pidAlive(pid)), 'review worker process remains alive');
    await closeHarness(harness);
    const leases = activeReviewLeaseDirectories(fixtures.dataRoot);
    harness.channels.activeReviewLeaseDirectories = leases;
    assert(leases.length === 0, 'active review lease remains after cleanup');
    assert(harness.channels.childCleanupFailures.length === 0, 'child cleanup failed');
    return { workerPids, workerProcessesExited: true, activeReviewLeaseDirectories: leases, ports: [...harness.ports].sort((left, right) => left - right) };
  });

  await milestone(state, 'evidence-identity', async () => {
    const milestoneFiles = fs.readdirSync(path.join(state.artifactRoot, 'milestones')).filter((name) => name.endsWith('.json'));
    assert(milestoneFiles.length === MILESTONE_IDS.length - 1, 'milestone evidence count before final identity is wrong');
    assert(runnerSha256 === sha256(fs.readFileSync(runnerPath)), 'runner bytes changed during execution');
    assert(runHead === state.codeEvidenceHead, 'runner HEAD identity changed during FORMAL');
    return { runnerSha256, runHead, milestoneEvidenceFilesBeforeFinal: milestoneFiles.length, exclusiveArtifactRoot: state.artifactRoot };
  });

  return {
    processRaceBoundary: 'ReviewTerminalAuthority',
    idempotentRetryBoundary: 'ReviewTerminalAuthority',
    projectTreeBefore,
    projectTreeAfter: hashTree(fixtures.projectRoot),
    starterBefore,
    starterAfter: hashTree(starterRoot),
    sourceStateBefore,
    sourceStateAfter: hashTree(fixtures.sourceStateRoot),
    unexpectedTerminalFiles: Object.values(fixtures.reviews).flatMap((review) => unexpectedTerminalFiles(review.reviewRoot)),
    payloadIdentity: payloadBefore,
    comparisonRace,
    resultRace,
    browserDecision: { decisionId: browserDecisionReceipt.decisionId, identity: readFileIdentity(path.join(fixtures.reviews.browserRace.reviewRoot, 'decision.json')) },
  };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const artifactParent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-review-terminal-atomicity-'));
  const artifactRoot = path.join(artifactParent, mode);
  fs.mkdirSync(artifactRoot, { recursive: false });
  const codeEvidenceHead = process.env.SURDET_CODE_EVIDENCE_HEAD ?? '';
  const harness = createHarness();
  let currentTrackedDiffs = [];
  let currentStagingPaths = [];
  let fixtures = null;
  let authoring = null;
  const state = {
    mode,
    artifactRoot,
    codeEvidenceHead,
    trackedCodeDiffPaths: [],
    stagingPaths: [],
    milestones: [],
  };
  let projectBefore = null;
  let starterBefore = null;
  let status = 'PASSED';
  let firstFailedNode = null;
  let result = null;
  let phase = 'git-and-formal-preconditions';
  try {
    currentTrackedDiffs = trackedCodeDiffPaths();
    currentStagingPaths = stagingPaths();
    state.trackedCodeDiffPaths = currentTrackedDiffs;
    state.stagingPaths = currentStagingPaths;
    if (mode === 'formal') {
      assertFormalPreconditions({ trackedCodeDiffPaths: currentTrackedDiffs, stagingPaths: currentStagingPaths, runHead, codeEvidenceHead });
    }
    phase = 'fixture-and-module-setup';
    fixtures = await prepareFixtures(path.join(artifactParent, 'fixture'));
    authoring = await import('@surdet/authoring');
    projectBefore = hashTree(fixtures.projectRoot);
    starterBefore = hashTree(starterRoot);
    phase = mode;
    result = mode === 'preflight'
      ? await runPreflight(state, harness, fixtures, authoring)
      : await runFormal(state, harness, fixtures, authoring);
  } catch (error) {
    status = 'FAILED';
    const failedMilestone = state.milestones.find((entry) => entry.status === 'FAILED');
    firstFailedNode = failedMilestone?.id ?? phase;
    harness.channels.errors.push(errorText(error));
  } finally {
    try { await closeHarness(harness); }
    catch (error) { harness.channels.childCleanupFailures.push(`harness close: ${errorText(error)}`); }
    harness.channels.activeReviewLeaseDirectories = fixtures === null ? [] : activeReviewLeaseDirectories(fixtures.dataRoot);
  }
  const projectAfter = fixtures === null ? null : hashTree(fixtures.projectRoot);
  const starterAfter = starterBefore === null ? null : hashTree(starterRoot);
  const agentWriterCapabilities = authoring === null
    ? null
    : authoring.AUTHORING_CAPABILITY_IDS.filter((id) => /^review\.(?:write|save|approve|return|decide)/.test(id));
  const evidence = {
    evidenceVersion: '1.0.0',
    mode,
    status,
    firstFailedNode,
    lastPassedNode: mode === 'formal'
      ? state.milestones.filter((entry) => entry.status === 'PASSED').at(-1)?.id ?? null
      : null,
    runHead,
    runnerHeadIdentity,
    codeEvidenceHead: mode === 'formal' ? codeEvidenceHead : null,
    runnerSha256,
    artifactRoot,
    trackedCodeDiffPaths: mode === 'formal' ? trackedCodeDiffPaths() : currentTrackedDiffs,
    stagingPaths: mode === 'formal' ? stagingPaths() : currentStagingPaths,
    milestones: state.milestones,
    preflight: mode === 'preflight' ? result : null,
    formal: mode === 'formal' ? result : null,
    agentWriterCapabilities,
    channels: harness.channels,
    projectTreeBefore: projectBefore,
    projectTreeAfter: projectAfter,
    starterBefore,
    starterAfter,
    projectMutation: projectBefore === null ? null : JSON.stringify(projectBefore) !== JSON.stringify(projectAfter),
    starterMutation: starterBefore === null ? null : JSON.stringify(starterBefore) !== JSON.stringify(starterAfter),
    ports: [...harness.ports].sort((left, right) => left - right),
  };
  if (status === 'PASSED') {
    try {
      validateEvidenceContract(evidence);
    } catch (error) {
      status = 'FAILED';
      firstFailedNode = 'evidence-contract';
      harness.channels.errors.push(errorText(error));
      evidence.status = status;
      evidence.firstFailedNode = firstFailedNode;
    }
  }
  const artifact = writeArtifact(artifactRoot, evidence);
  process.stdout.write(`${JSON.stringify({ status, mode, milestones: state.milestones.length, artifact }, null, 2)}\n`);
  if (status !== 'PASSED') process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === runnerPath) {
  main().catch((error) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 1;
  });
}
