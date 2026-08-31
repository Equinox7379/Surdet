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
  readFileIdentity,
  validateEvidenceContract,
  verifyFileIdentity,
} from '../e2e/review-terminal-atomicity-gate.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../../..');
const runnerPath = path.resolve(testDirectory, '../e2e/review-terminal-atomicity-gate.e2e.mjs');
const source = fs.readFileSync(runnerPath, 'utf8');
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
  };
  assert.equal(validateEvidenceContract(evidence), true);
  assert.throws(() => validateEvidenceContract({ ...evidence, agentWriterCapabilities: ['review.write-decision'] }), /Agent writer capability/);
  assert.throws(() => validateEvidenceContract({ ...evidence, projectMutation: true }), /project was mutated/);
  assert.throws(() => validateEvidenceContract({
    ...evidence, channels: { ...emptyChannels(), protocolErrors: ['bad envelope'] },
  }), /blocking issue channels/);
  assert.throws(() => validateEvidenceContract({ ...evidence, milestones: evidence.milestones.slice(0, -1) }), /milestone count mismatch/);
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
