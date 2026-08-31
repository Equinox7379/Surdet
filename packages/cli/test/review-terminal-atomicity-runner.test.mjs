import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_PORTS,
  MILESTONE_IDS,
  MODES,
  SEARCH_RANGE,
  assertFormalPreconditions,
  blockingRunIssues,
  parseMode,
  prepareFixtures,
  readFileIdentity,
  unexpectedTerminalFiles,
  validateEvidenceContract,
  verifyFileIdentity,
} from '../e2e/review-terminal-atomicity-gate.e2e.mjs';
import * as runnerModule from '../e2e/review-terminal-atomicity-gate.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../../..');
const runnerPath = path.resolve(testDirectory, '../e2e/review-terminal-atomicity-gate.e2e.mjs');
const workerPath = path.resolve(testDirectory, 'fixtures/review-terminal-worker.mjs');
const source = fs.readFileSync(runnerPath, 'utf8');
const workerSource = fs.readFileSync(workerPath, 'utf8');
const runHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(runnerPath)).digest('hex');

function emptyChannels() {
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

test('review terminal runner freezes exact modes, dynamic loopback policy, and milestones', () => {
  assert.deepEqual(MODES, ['preflight', 'formal']);
  assert.deepEqual(FORBIDDEN_PORTS, [4173, 4175]);
  assert.deepEqual(SEARCH_RANGE, { from: 4260, to: 4269 });
  assert.deepEqual(MILESTONE_IDS, [
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
  assert.equal(MILESTONE_IDS.length, 15);
  assert.match(source, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.match(source, /--strictPort/);
  assert.match(source, /findAvailablePort\(harness\.ports\)/);
});

test('review terminal runner rejects missing, extra, and unauthorized modes', () => {
  assert.equal(parseMode(['--preflight']), 'preflight');
  assert.equal(parseMode(['--formal']), 'formal');
  assert.throws(() => parseMode([]), /exactly one runner mode/);
  assert.throws(() => parseMode(['--formal', '--extra']), /exactly one runner mode/);
  assert.throws(() => parseMode(['--diagnostic']), /unsupported runner mode/);
});

test('review terminal runner enforces FORMAL clean-tree and frozen-head preconditions', () => {
  assert.equal(assertFormalPreconditions({ trackedCodeDiffPaths: [], stagingPaths: [], runHead, codeEvidenceHead: runHead }), true);
  assert.throws(() => assertFormalPreconditions({
    trackedCodeDiffPaths: ['packages/editor/src/index.ts'], stagingPaths: [], runHead, codeEvidenceHead: runHead,
  }), /clean tracked worktree/);
  assert.throws(() => assertFormalPreconditions({
    trackedCodeDiffPaths: [], stagingPaths: ['packages/editor/src/index.ts'], runHead, codeEvidenceHead: runHead,
  }), /empty staging area/);
  assert.throws(() => assertFormalPreconditions({
    trackedCodeDiffPaths: [], stagingPaths: [], runHead, codeEvidenceHead: '0'.repeat(40),
  }), /runHead must equal/);
});

test('review terminal runner verifies bytes and SHA-256 from disk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-runner-contract-'));
  const file = path.join(root, 'record.json');
  try {
    fs.writeFileSync(file, '{"ok":true}\n', 'utf8');
    const identity = readFileIdentity(file);
    assert.equal(identity.bytes, 12);
    assert.match(identity.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(verifyFileIdentity(file, identity), identity);
    fs.appendFileSync(file, 'x');
    assert.throws(() => verifyFileIdentity(file, identity), /file identity mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('review terminal runner treats every required error and cleanup channel as blocking', () => {
  const channels = emptyChannels();
  assert.deepEqual(blockingRunIssues(channels), []);
  for (const channel of Object.keys(channels)) {
    const candidate = emptyChannels();
    candidate[channel].push('failure');
    assert.deepEqual(blockingRunIssues(candidate), [channel]);
  }
  const missing = emptyChannels();
  delete missing.protocolErrors;
  assert.deepEqual(blockingRunIssues(missing), ['protocolErrors']);
});

test('review terminal runner exempts only explicitly proven browser-native 409 rejections', () => {
  assert.equal(typeof runnerModule.classifyBrowserConsoleErrors, 'function');
  const classify = runnerModule.classifyBrowserConsoleErrors;
  const native409 = 'Failed to load resource: the server responded with a status of 409 (Conflict)';
  const writeUrl = 'http://127.0.0.1:4260/__surdet/review-authority/v1/write';
  const describeUrl = 'http://127.0.0.1:4260/__surdet/review-authority/v1/describe';
  const validExpected = [
    { label: 'losing-context', route: 'write', url: writeUrl, method: 'POST', status: 409, code: 'REVIEW_BUSY' },
    { label: 'identity-control', route: 'describe', url: describeUrl, method: 'POST', status: 409, code: 'REVIEW_IDENTITY_MISMATCH' },
  ];
  const accepted = classify([
    { label: 'losing-context', text: native409, url: writeUrl },
    { label: 'identity-control', text: native409, url: describeUrl },
  ], validExpected);
  assert.equal(accepted.expected.length, 2);
  assert.deepEqual(accepted.blocking, []);

  const negatives = [
    {
      name: 'wrong status',
      event: { label: 'losing-context', text: native409, url: writeUrl },
      expected: [{ label: 'losing-context', route: 'write', status: 500, code: 'REVIEW_BUSY' }],
    },
    {
      name: 'wrong error code',
      event: { label: 'losing-context', text: native409, url: writeUrl },
      expected: [{ label: 'losing-context', route: 'write', status: 409, code: 'REVIEW_DECISION_INVALID' }],
    },
    {
      name: 'wrong route',
      event: { label: 'losing-context', text: native409, url: 'http://127.0.0.1:4260/unrelated' },
      expected: [validExpected[0]],
    },
    {
      name: 'no proven rejection',
      event: { label: 'losing-context', text: native409, url: writeUrl },
      expected: [],
    },
    {
      name: 'script console error',
      event: { label: 'losing-context', text: native409, url: 'http://127.0.0.1:4260/assets/main.js' },
      expected: [validExpected[0]],
    },
    {
      name: 'different console text',
      event: { label: 'losing-context', text: `${native409} unexpected`, url: writeUrl },
      expected: [validExpected[0]],
    },
    {
      name: 'wrong label',
      event: { label: 'other-context', text: native409, url: writeUrl },
      expected: [validExpected[0]],
    },
    {
      name: 'missing URL',
      event: { label: 'losing-context', text: native409, url: '' },
      expected: [validExpected[0]],
    },
    {
      name: 'query-bearing Authority URL',
      event: { label: 'losing-context', text: native409, url: `${writeUrl}?unexpected=1` },
      expected: [{ ...validExpected[0], url: `${writeUrl}?unexpected=1` }],
    },
    {
      name: 'wrong Authority port',
      event: { label: 'losing-context', text: native409, url: writeUrl.replace(':4260', ':4173') },
      expected: [{ ...validExpected[0], url: writeUrl.replace(':4260', ':4173') }],
    },
    {
      name: 'different HTTP error text',
      event: { label: 'losing-context', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)', url: writeUrl },
      expected: [validExpected[0]],
    },
  ];
  for (const negative of negatives) {
    const result = classify([negative.event], negative.expected);
    assert.equal(result.expected.length, 0, `${negative.name} was incorrectly exempted`);
    assert.equal(result.blocking.length, 1, `${negative.name} was not kept blocking`);
  }

  const duplicate = classify([
    { label: 'losing-context', text: native409, url: writeUrl },
    { label: 'losing-context', text: native409, url: writeUrl },
  ], [validExpected[0]]);
  assert.equal(duplicate.expected.length, 1);
  assert.equal(duplicate.blocking.length, 1);
});

test('review terminal runner proves the exact Authority rejection envelope and request identity', () => {
  assert.equal(typeof runnerModule.proveExpectedAuthorityRejection, 'function');
  const prove = runnerModule.proveExpectedAuthorityRejection;
  const reviewPayload = { bytes: 321, sha256: 'a'.repeat(64) };
  const writeObservation = {
    label: 'losing-context',
    route: 'write',
    url: 'http://127.0.0.1:4260/__surdet/review-authority/v1/write',
    method: 'POST',
    status: 409,
    body: { ok: false, error: { code: 'REVIEW_BUSY', message: '本机审阅服务暂时无法完成这项请求。' } },
    request: {
      protocolVersion: '1.0.0',
      requestId: 'review_request_contract',
      projectIdentity: 'project-contract',
      reviewId: 'review-contract',
      reviewPayload,
      action: 'comparison-decision',
      receipt: { decisionId: 'decision-contract' },
    },
  };
  const writeExpected = {
    label: 'losing-context',
    route: 'write',
    projectIdentity: 'project-contract',
    reviewId: 'review-contract',
    reviewPayload,
    action: 'comparison-decision',
  };
  assert.deepEqual(prove(writeObservation, writeExpected), {
    label: 'losing-context',
    route: 'write',
    url: writeObservation.url,
    method: 'POST',
    status: 409,
    code: 'REVIEW_BUSY',
    message: '本机审阅服务暂时无法完成这项请求。',
    projectIdentity: 'project-contract',
    reviewId: 'review-contract',
    reviewPayload,
    action: 'comparison-decision',
    requestId: 'review_request_contract',
  });

  const describeObservation = {
    label: 'identity-control',
    route: 'describe',
    url: 'http://127.0.0.1:4261/__surdet/review-authority/v1/describe',
    method: 'POST',
    status: 409,
    body: { ok: false, error: { code: 'REVIEW_IDENTITY_MISMATCH', message: '本机审阅服务暂时无法完成这项请求。' } },
    request: { projectIdentity: 'project-contract', reviewId: 'review-contract', reviewPayload },
  };
  const describeExpected = {
    label: 'identity-control',
    route: 'describe',
    projectIdentity: 'project-contract',
    reviewId: 'review-contract',
    reviewPayload,
  };
  assert.equal(prove(describeObservation, describeExpected).code, 'REVIEW_IDENTITY_MISMATCH');

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const negatives = [
    ['extra envelope key', (value) => { value.body.extra = true; }],
    ['missing message', (value) => { delete value.body.error.message; }],
    ['extra error key', (value) => { value.body.error.detail = 'raw'; }],
    ['control character', (value) => { value.body.error.message = 'bad\nmessage'; }],
    ['oversized message', (value) => { value.body.error.message = 'x'.repeat(257); }],
    ['wrong method', (value) => { value.method = 'GET'; }],
    ['wrong project identity', (value) => { value.request.projectIdentity = 'other-project'; }],
    ['wrong review identity', (value) => { value.request.reviewId = 'other-review'; }],
    ['wrong payload identity', (value) => { value.request.reviewPayload.sha256 = 'b'.repeat(64); }],
    ['wrong action', (value) => { value.request.action = 'result-return'; }],
    ['extra request key', (value) => { value.request.extra = true; }],
    ['wrong error code', (value) => { value.body.error.code = 'REVIEW_DECISION_INVALID'; }],
  ];
  for (const [name, mutate] of negatives) {
    const candidate = clone(writeObservation);
    mutate(candidate);
    assert.throws(() => prove(candidate, writeExpected), undefined, name);
  }
});

test('review terminal runner validates structured FORMAL evidence instead of source keywords', () => {
  const evidence = {
    mode: 'formal',
    runHead,
    codeEvidenceHead: runHead,
    runnerSha256,
    trackedCodeDiffPaths: [],
    stagingPaths: [],
    agentWriterCapabilities: [],
    projectMutation: false,
    starterMutation: false,
    channels: emptyChannels(),
    milestones: MILESTONE_IDS.map((id, index) => ({ ordinal: index + 1, id, status: 'PASSED' })),
    formal: {
      processRaceBoundary: 'ReviewTerminalAuthority',
      idempotentRetryBoundary: 'ReviewTerminalAuthority',
      sourceStateBefore: { files: 3, bytes: 42, sha256: '1'.repeat(64) },
      sourceStateAfter: { files: 3, bytes: 42, sha256: '1'.repeat(64) },
      unexpectedTerminalFiles: [],
    },
  };
  assert.equal(validateEvidenceContract(evidence), true);
  assert.throws(() => validateEvidenceContract({ ...evidence, agentWriterCapabilities: ['review.write-decision'] }), /Agent writer capability/);
  assert.throws(() => validateEvidenceContract({ ...evidence, projectMutation: true }), /project was mutated/);
  assert.throws(() => validateEvidenceContract({
    ...evidence, channels: { ...emptyChannels(), protocolErrors: ['bad envelope'] },
  }), /blocking issue channels/);
  assert.throws(() => validateEvidenceContract({ ...evidence, milestones: evidence.milestones.slice(0, -1) }), /milestone count mismatch/);
  assert.throws(() => validateEvidenceContract({
    ...evidence,
    formal: { ...evidence.formal, processRaceBoundary: 'NodeReviewStore' },
  }), /process races must use ReviewTerminalAuthority/);
  assert.throws(() => validateEvidenceContract({
    ...evidence,
    formal: { ...evidence.formal, sourceStateAfter: { ...evidence.formal.sourceStateAfter, sha256: '2'.repeat(64) } },
  }), /source change evidence was mutated/);
  assert.throws(() => validateEvidenceContract({
    ...evidence,
    formal: { ...evidence.formal, unexpectedTerminalFiles: ['terminal.json'] },
  }), /unexpected terminal files/);
});

test('review terminal runner exercises the canonical Authority and preserves seeded source evidence', () => {
  assert.match(workerSource, /ReviewTerminalAuthority/);
  assert.match(workerSource, /authority\.write\(command\.terminalCommand\)/);
  assert.match(source, /terminalCommand:/);
  assert.match(source, /processRaceBoundary:\s*'ReviewTerminalAuthority'/);
  assert.match(source, /idempotentRetryBoundary:\s*'ReviewTerminalAuthority'/);
  assert.equal((source.match(/expectedAuthorityRejections\.push\(proveExpectedAuthorityRejection/g) ?? []).length, 2);
  for (const phrase of [
    'NodeChangeStore.forProject',
    'beginChange',
    'writeCapsulePayload',
    'manifest.json',
    'record-head.json',
    'unexpectedTerminalFiles',
    'sourceStateBefore',
    'sourceStateAfter',
  ]) assert.ok(source.includes(phrase), `missing seeded source evidence contract: ${phrase}`);
});

test('review terminal runner creates a valid V2 change and rejects extra terminal files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-runner-source-contract-'));
  try {
    const fixtures = await prepareFixtures(root);
    for (const relativePath of [
      'manifest.json',
      'record-head.json',
      'capsules/cap_source_canary/payload.json',
      'capsules/cap_source_canary/identity.json',
    ]) assert.equal(fs.existsSync(path.join(fixtures.sourceStateRoot, ...relativePath.split('/'))), true);
    const reviewRoot = fixtures.reviews.comparisonRace.reviewRoot;
    assert.deepEqual(unexpectedTerminalFiles(reviewRoot), []);
    fs.writeFileSync(path.join(reviewRoot, 'terminal.json'), '{"forbidden":true}\n', 'utf8');
    assert.deepEqual(unexpectedTerminalFiles(reviewRoot), ['terminal.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('review terminal runner uses exclusive artifacts and real receipt/payload identities', () => {
  assert.match(source, /fs\.openSync\(file, 'wx'\)/);
  assert.match(source, /surdet-review-terminal-atomicity-/);
  assert.match(source, /writeArtifact\(artifactRoot, evidence\)/);
  assert.match(source, /verifyFileIdentity\(evidenceFile, identity\)/);
  for (const phrase of [
    'decision.json', 'final-approval.json', 'return-request.json', 'payloadIdentity',
    'identityFile', 'unexpectedChangePaths', 'projectTreeBefore', 'projectTreeAfter', 'starterBefore', 'starterAfter',
  ]) assert.ok(source.includes(phrase), `missing disk evidence contract: ${phrase}`);
});

test('review terminal runner performs two-process and two-context races and preserves cleanup', () => {
  assert.match(source, /Promise\.all\(commands\.map\(\(command\) => runWorker/);
  assert.match(source, /written\.length === 1 && rejected\.length === 1/);
  assert.match(source, /firstContext = await newReviewPage/);
  assert.match(source, /secondContext = await newReviewPage/);
  assert.match(source, /Promise\.all\(\[\s*firstContext\.page\.locator/);
  assert.match(source, /activeReviewLeaseDirectories\(fixtures\.dataRoot\)/);
  assert.match(source, /workerPids\.every\(\(pid\) => !pidAlive\(pid\)\)/);
  assert.match(source, /SURDET_AGENT_DATA_DIR: dataRoot/);
  assert.match(source, /static Editor terminal path is not read-only/);
  assert.match(source, /authorityWriteResponses\.length - responseOffset >= 2/);
  assert.match(source, /winner response does not match disk receipt/);
  assert.match(source, /child\.once\('close'/);
  assert.match(source, /Vite exited unexpectedly/);
  assert.match(source, /viteClosePromise/);
});
