
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const MODES = new Set(['preflight', 'diagnostic', 'formal', 'acceptance-prep']);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '../../..');
const portEntry = path.join(repoRoot, 'packages/cli/dist/agent-port/main.js');
const starterRoot = path.join(repoRoot, 'examples/starter');
const runnerPath = fileURLToPath(import.meta.url);
const artifactBase = path.join(os.tmpdir(), 'surdet-agent-candidate-composition-wave5');
const runHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const codeEvidenceHead = process.env['SURDET_CODE_EVIDENCE_HEAD'] ?? '';
const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(runnerPath)).digest('hex');

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function trackedCodeDiffPaths() {
  const raw = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('??'))
    .map((line) => line.slice(3).trim()).sort();
}

function hashTree(root) {
  const files = [];
  function walk(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (entry.name.startsWith('.surdet-')) continue;
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({ path: relative.split(path.sep).join('/'), bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
    }
  }
  walk(root, '');
  const identity = files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`).join('\n');
  return {
    path: root,
    fileCount: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: sha256(Buffer.from(identity, 'utf8')),
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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { path: file, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function writeArtifact(directory, value) {
  const artifactPath = path.join(directory, 'evidence.json');
  assert(!fs.existsSync(artifactPath), `artifact overwrite refused: ${artifactPath}`);
  writeJson(artifactPath, value);
  const identity = readFileIdentity(artifactPath);
  const identityPath = path.join(directory, 'identity.json');
  writeJson(identityPath, identity);
  const reread = fs.readFileSync(artifactPath);
  assert(reread.byteLength === identity.bytes, 'artifact bytes readback mismatch');
  assert(sha256(reread) === identity.sha256, 'artifact sha256 readback mismatch');
  return { identity, identityPath };
}

function resultOf(envelope, label) {
  assert(envelope && envelope.ok === true, `${label} failed: ${JSON.stringify(envelope?.error ?? envelope)}`);
  return envelope.result;
}

function expectedFailure(envelope, codes, label) {
  assert(envelope && envelope.ok === false, `${label} unexpectedly succeeded`);
  const accepted = Array.isArray(codes) ? codes : [codes];
  assert(accepted.includes(envelope.error?.code), `${label} code ${envelope.error?.code} not in [${accepted.join(',')}]`);
  return envelope;
}

let stderrLogPath = null;

function connectPort({ projectRoot, policy, resumeChangeId, dataDir, versionNegotiation = { mode: 'auto' } }) {
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
  transport.onerror = (error) => protocolErrors.push(String(error?.message ?? error));
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderrLogPath) fs.appendFileSync(stderrLogPath, chunk);
  });
  const client = new Client(
    { name: 'surdet-wave-5-composition', version: '1.0.0' },
    { versionNegotiation },
  );
  return { client, transport, protocolErrors, connectPromise: client.connect(transport), stderrRef: () => stderr };
}

async function awaitPort(port) {
  await port.connectPromise;
  return port;
}

async function closePort(port, errors) {
  try {
    await port.client.close();
  } catch (error) {
    errors.childCleanupFailures.push(`client.close: ${String(error)}`);
  }
  try {
    await port.transport.close();
  } catch (error) {
    errors.childCleanupFailures.push(`transport.close: ${String(error)}`);
  }
  if (port.transport.pid !== undefined && port.transport.pid !== null) {
    errors.childCleanupFailures.push(`child pid remained: ${port.transport.pid}`);
  }
  for (const error of port.protocolErrors) errors.protocol.push(error);
  const unexpectedStderr = port.stderrRef().split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Surdet Agent Port ready:'));
  errors.stderrUnexpected.push(...unexpectedStderr);
  return { stdoutProtocolPurity: port.protocolErrors.length === 0, stderrLines: unexpectedStderr.length };
}

async function listTools(port) {
  const response = await port.client.listTools();
  return response.tools.map((tool) => tool.name);
}

async function callTool(port, name, args = {}) {
  const response = await port.client.callTool({ name, arguments: args });
  const envelope = response.structuredContent;
  assert(envelope && typeof envelope === 'object', `${name} returned no structuredContent`);
  return envelope;
}

const alphaBlocksA = [
  { kind: 'label', name: 'start' },
  { kind: 'text', speaker: 'lynn', value: 'Alpha route A.' },
];
const alphaBlocksC = [
  { kind: 'label', name: 'start' },
  { kind: 'text', speaker: 'lynn', value: 'Alpha route C.' },
];
const betaBlocks = [
  { kind: 'label', name: 'start' },
  { kind: 'instruction', name: 'timeline', args: ['beta_opening'], modifiers: { blocking: '' } },
  { kind: 'text', speaker: 'lynn', value: 'Beta route.' },
];
const betaTimeline = {
  version: 1,
  id: 'beta_opening',
  durationMs: 400,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'castle_hall' }] },
  ],
};

/** Seal one v2 candidate capsule in its own stage session. */
async function sealCandidate(fixture, dataDir, label, ops) {
  const errors = { protocol: [], stderrUnexpected: [], childCleanupFailures: [] };
  const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
  let changeId;
  let capsule;
  try {
    const begun = resultOf(await callTool(port, 'surdet_change_begin', {
      intent: `Wave5 candidate ${label}.`,
      acceptanceCriteria: ['Deterministic composition candidate.'],
      initiator: 'external-agent',
    }), `${label} change.begin`);
    changeId = begun.changeId;
    let index = 0;
    for (const op of ops) {
      index += 1;
      resultOf(await callTool(port, op.tool, { operationId: `${label}-op-${index}`, ...op.args }), `${label} ${op.tool}`);
    }
    capsule = resultOf(await callTool(port, 'surdet_delivery_capsule', { label: `wave5 candidate ${label}` }), `${label} capsule`);
    assert(capsule.capsuleVersion === '2.0.0', `${label} capsule is not v2`);
    assert(capsule.composition?.eligibility === 'ready', `${label} eligibility not ready: ${JSON.stringify(capsule.composition?.reasons ?? [])}`);
  } finally {
    await closePort(port, errors);
  }
  assert(errors.protocol.length === 0, `${label} protocol errors: ${errors.protocol.join('; ')}`);
  return { ref: { changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 }, capsule };
}

async function runPreflightLeg({ label, fixture, dataDir, versionNegotiation }) {
  const errors = { protocol: [], stderrUnexpected: [], childCleanupFailures: [] };
  const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'observe', dataDir, versionNegotiation }));
  const protocolEra = port.client.getProtocolEra();
  const negotiated = port.client.getNegotiatedProtocolVersion?.();
  let close;
  try {
    const names = await listTools(port);
    assert(names.includes('surdet_session_describe'), `${label} session tool missing`);
    assert(names.includes('surdet_project_inspect'), `${label} inspect tool missing`);
    assert(names.includes('surdet_composition_compare') && names.includes('surdet_composition_plan')
      && names.includes('surdet_composition_inspect'), `${label} observe composition read tools missing`);
    assert(!names.includes('surdet_change_begin') && !names.includes('surdet_change_commit'), `${label} exposed mutation tool`);
    assert(!names.includes('surdet_delivery_capsule'), `${label} exposed unresumed capsule`);
    resultOf(await callTool(port, 'surdet_session_describe'), `${label} session.describe`);
    resultOf(await callTool(port, 'surdet_project_inspect'), `${label} project.inspect`);
    const described = resultOf(await callTool(port, 'surdet_capabilities_describe'), `${label} capabilities.describe`);
    assert(described.capabilities?.length === 26, `${label} expected 26 registry capabilities, got ${described.capabilities?.length}`);
    assert(described.contractVersion === '2.0.0', `${label} authoring contract was ${described.contractVersion}`);
    if (label === 'legacy/2025') {
      assert(protocolEra === 'legacy', `${label} protocol era was ${protocolEra}`);
      assert(negotiated === '2025-11-25', `${label} protocol version was ${negotiated}`);
    } else {
      assert(protocolEra === 'modern', `${label} protocol era was ${protocolEra}`);
    }
  } finally {
    close = await closePort(port, errors);
  }
  assert(close.stdoutProtocolPurity === true, `${label} stdout protocol purity failed`);
  assert(errors.protocol.length === 0, `${label} protocol errors: ${errors.protocol.join('; ')}`);
  assert(errors.stderrUnexpected.length === 0, `${label} unexpected stderr: ${errors.stderrUnexpected.join('; ')}`);
  assert(errors.childCleanupFailures.length === 0, `${label} cleanup errors: ${errors.childCleanupFailures.join('; ')}`);
  return { label, protocolEra, negotiatedProtocolVersion: negotiated, capabilities: 26,
    stdoutProtocolPurity: close.stdoutProtocolPurity, childCleanup: true };
}

async function runPreflight() {
  assert(fs.existsSync(portEntry), `Agent Port launcher missing: ${portEntry}`);
  const starterBefore = hashTree(starterRoot);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave5-preflight-'));
  try {
    const modernFixture = path.join(directory, 'modern-fixture');
    const legacyFixture = path.join(directory, 'legacy-fixture');
    copyStarter(modernFixture);
    copyStarter(legacyFixture);
    const modernData = path.join(directory, 'modern-data');
    const legacyData = path.join(directory, 'legacy-data');
    fs.mkdirSync(modernData, { recursive: true });
    fs.mkdirSync(legacyData, { recursive: true });
    const modern = await runPreflightLeg({ label: 'modern/auto', fixture: modernFixture, data: modernData, versionNegotiation: { mode: 'auto' } });
    const legacy = await runPreflightLeg({ label: 'legacy/2025', fixture: legacyFixture, data: legacyData, versionNegotiation: { mode: 'legacy' } });
    const starterAfter = hashTree(starterRoot);
    assert(starterBefore.sha256 === starterAfter.sha256, 'original Starter changed during preflight');
    console.log(JSON.stringify({
      status: 'PASSED', mode: 'preflight', launcher: 'packages/cli/dist/agent-port/main.js',
      cwd: repoRoot, contractVersion: '2.0.0', nativeCapabilities: 26,
      modern, legacy, starterUnchanged: true, childCleanup: true,
    }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function runAcceptancePrep() {
  const desktop = path.join(os.homedir(), 'Desktop');
  assert(fs.existsSync(desktop), `Desktop directory missing: ${desktop}`);
  const root = fs.mkdtempSync(path.join(desktop, 'surdet-wave5-acceptance-'));
  const fixture = path.join(root, 'fixture');
  const dataDir = path.join(root, 'agent-data');
  copyStarter(fixture);
  fs.mkdirSync(dataDir, { recursive: true });
  writeJson(path.join(root, 'mcp-stage.json'), {
    mcpServers: { 'Surdet Agent Port': {
      command: process.execPath,
      args: [portEntry, '--project', fixture, '--policy', 'stage'],
      env: { SURDET_AGENT_DATA_DIR: dataDir },
    } },
  });
  writeJson(path.join(root, 'apply-resume-template.json'), {
    schemaVersion: '1.0.0',
    project: fixture,
    SURDET_AGENT_DATA_DIR: dataDir,
    policy: 'apply',
    resumeChange: '<CHANGE_ID_REQUIRED_AFTER_OWNER_APPROVAL>',
    status: 'NOT_AUTHORIZED',
  });
  writeJson(path.join(root, 'identity.json'), { gitHead: runHead, runnerSha256, createdAt: new Date().toISOString() });
  console.log(JSON.stringify({ status: 'PASSED', mode: 'acceptance-prep', root }));
}

function findChangeDirectory(dataDir, changeId) {
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
      if (changeId !== '' && entry.name === changeId) return full;
      stack.push(full);
    }
  }
  return null;
}

/** Hand-write a recognizable v1 (pre-composition) capsule under an existing change. */
function writeLegacyV1Capsule(dataDir, changeId) {
  const changeDirectory = findChangeDirectory(dataDir, changeId);
  assert(changeDirectory !== null, `cannot locate change directory for v1 fixture: ${changeId}`);
  const capsuleDirectory = path.join(changeDirectory, 'capsules', 'caps_v1_legacy_audit');
  fs.mkdirSync(capsuleDirectory, { recursive: true });
  const legacyPayload = {
    schemaVersion: '1.0.0',
    label: 'wave5 v1 audit-only fixture',
    changeStatus: 'OPEN',
    projectMutation: { occurred: false },
    invocationSummary: { records: [] },
  };
  const payloadPath = path.join(capsuleDirectory, 'payload.json');
  writeJson(payloadPath, legacyPayload);
  const identity = readFileIdentity(payloadPath);
  writeJson(path.join(capsuleDirectory, 'identity.json'), identity);
  return { changeId, capsuleId: 'caps_v1_legacy_audit', artifactSha256: identity.sha256 };
}

/** Scan every persisted record for an integration mid-replay state. */
function scanForReplayingRecord(dataDir, planId) {
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
      const recordPath = path.join(full, 'record.json');
      if (!fs.existsSync(recordPath)) {
        stack.push(full);
        continue;
      }
      try {
        const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
        const integration = record.integration;
        if (!integration || integration.planId !== planId) continue;
        return {
          changeId: entry.name,
          directory: full,
          status: integration.status,
          progressIndex: integration.nextOperationIndex ?? 0,
          operationCount: integration.operationCount ?? 0,
          summary: { status: integration.status, index: integration.nextOperationIndex, count: integration.operationCount },
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function differenceFiles(before, after) {
  const beforeByPath = new Map(before.files.map((file) => [file.path, file.sha256]));
  const afterByPath = new Map(after.files.map((file) => [file.path, file.sha256]));
  const changed = [];
  for (const [filePath, digest] of afterByPath) {
    if (beforeByPath.get(filePath) !== digest) changed.push({ path: filePath });
  }
  for (const filePath of beforeByPath.keys()) {
    if (!afterByPath.has(filePath)) changed.push({ path: filePath });
  }
  return changed;
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

async function runEvidence(modeName) {

  const evidenceClass = modeName === 'formal' ? 'FORMAL' : 'DIAGNOSTIC';
  const runDirectory = fs.mkdtempSync(artifactBase + '-');
  const fixture = path.join(runDirectory, 'fixture');
  const dataDir = path.join(runDirectory, 'agent-data');
  const modeDirectory = path.join(runDirectory, modeName);
  fs.mkdirSync(fixture, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(modeDirectory, { recursive: true });
  stderrLogPath = path.join(modeDirectory, 'child-stderr.log');
  fs.writeFileSync(stderrLogPath, '', 'utf8');

  const errors = { protocol: [], stderrUnexpected: [], childCleanupFailures: [] };
  const milestones = [];
  let currentNode = 'initialization';
  let lastPassedNode = 'none';
  let firstFailedNode = null;
  const node = async (name, action) => {
    currentNode = name;
    try {
      const value = await action();
      milestones.push({ node: name, status: 'PASSED' });
      lastPassedNode = name;
      return value;
    } catch (error) {
      if (firstFailedNode === null) firstFailedNode = name;
      milestones.push({ node: name, status: 'FAILED', error: String(error).slice(0, 500) });
      throw error;
    }
  };

  const trackedDiff = trackedCodeDiffPaths();
  if (modeName === 'formal') {
    assert(trackedDiff.length === 0, `FORMAL requires a clean tracked tree: ${trackedDiff.join(', ')}`);
    assert(codeEvidenceHead !== '' && codeEvidenceHead === runHead,
      `FORMAL runHead ${runHead} must equal CODE_EVIDENCE_HEAD ${codeEvidenceHead || '(unset)'}`);
  }

  copyStarter(fixture);
  const starterBefore = hashTree(starterRoot);
  const fixtureSealed = hashTree(fixture);
  let candidateA, candidateB, candidateC, candidateD, foreignCandidate;
  let candidatesBefore, candidatesAfter, candidatesFinal;
  let selectionConflict, comparisonStatus, planResult, inspectedPlan;
  let integrationChangeId, interruptedProgressIndex, integrationResume;
  let diffAfterReady, validationAfterReady, simulationAfterReady, runtimeAlpha, runtimeBeta, traceAlpha, traceBeta;
  let stageCapsule, applyCommitted, fixtureAfterApply;

  try {
    await node('seal-four-candidates', async () => {
      const alphaOpsA = [
        { tool: 'surdet_scene_create', args: { sceneId: 'wave5_alpha', blocks: alphaBlocksA } },
        { tool: 'surdet_variable_ensure', args: { name: 'flag.alpha', type: 'string', initial: '' } },
      ];
      const betaOps = [
        { tool: 'surdet_timeline_create', args: { timelineId: 'beta_opening', definition: betaTimeline } },
        { tool: 'surdet_scene_create', args: { sceneId: 'wave5_beta', blocks: betaBlocks } },
      ];
      const alphaOpsC = [{ tool: 'surdet_scene_create', args: { sceneId: 'wave5_alpha', blocks: alphaBlocksC } }];
      candidateA = await sealCandidate(fixture, dataDir, 'alpha-a', alphaOpsA);
      candidateB = await sealCandidate(fixture, dataDir, 'beta-b', betaOps);
      candidateC = await sealCandidate(fixture, dataDir, 'alpha-c', alphaOpsC);
      candidateD = await sealCandidate(fixture, dataDir, 'alpha-d', alphaOpsA);
      candidatesBefore = hashTree(findChangeDirectory(dataDir, candidateA.ref.changeId));
    });

    await node('v1-capsule-audit-only-not-migrated', async () => {
      const v1Ref = writeLegacyV1Capsule(dataDir, candidateA.ref.changeId);
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const rejected = expectedFailure(await callTool(port, 'surdet_composition_compare', {
          candidateRefs: [candidateA.ref, v1Ref],
        }), ['CANDIDATE_NOT_COMPOSABLE'], 'v1 capsule compare');
        assert(String(rejected.error?.message ?? '').includes('v2'), 'v1 rejection should name the v2 contract');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('compare-abcd-conflicts-and-identical', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const compared = resultOf(await callTool(port, 'surdet_composition_compare', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
        }), 'composition.compare abcd');
        comparisonStatus = compared.status;
        const conflicts = compared.conflicts ?? [];
        selectionConflict = conflicts.find((conflict) => conflict.severity === 'selection-required');
        assert(selectionConflict !== undefined, 'expected selection-required conflict between A and C');
        assert((selectionConflict.unitIds ?? []).length >= 2, 'selection conflict should cover both alpha units');
        const identical = compared.identicalGroups ?? [];
        assert(identical.length >= 1, 'expected an identical group covering A and D');
        const manifests = (compared.candidates ?? []).map((candidate) => candidate?.composition?.manifest).filter(Boolean);
        const timelineEdge = manifests.some((manifest) => (manifest.operations ?? []).some((operation) =>
          (operation.requiredObjects ?? []).some((required) => String(required.objectRef ?? '').startsWith('timeline:'))));
        assert(timelineEdge, 'expected B scene to require the beta_opening timeline object');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('negative-unresolved-conflict-blocks-plan', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        expectedFailure(await callTool(port, 'surdet_composition_plan', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
          reason: 'unresolved conflict attempt',
        }), ['COMPOSITION_CONFLICT_UNRESOLVED'], 'plan without resolutions');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('negative-wrong-artifact-sha', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const forged = { changeId: candidateA.ref.changeId, capsuleId: candidateA.ref.capsuleId, artifactSha256: 'f'.repeat(64) };
        expectedFailure(await callTool(port, 'surdet_composition_compare', {
          candidateRefs: [forged, candidateB.ref],
        }), ['CAPSULE_IDENTITY_MISMATCH'], 'compare with wrong artifact sha');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('negative-cross-project-candidate', async () => {
      const foreignFixture = path.join(runDirectory, 'fixture-foreign');
      const foreignData = path.join(runDirectory, 'agent-data-foreign');
      copyStarter(foreignFixture);
      fs.mkdirSync(foreignData, { recursive: true });
      foreignCandidate = await sealCandidate(foreignFixture, foreignData, 'foreign-x', [
        { tool: 'surdet_scene_create', args: { sceneId: 'wave5_foreign', blocks: [{ kind: 'label', name: 'start' }] } },
      ]);
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        expectedFailure(await callTool(port, 'surdet_composition_compare', {
          candidateRefs: [candidateA.ref, foreignCandidate.ref],
        }), ['CANDIDATE_PROJECT_MISMATCH', 'PROJECT_IDENTITY_MISMATCH'], 'cross-project candidate');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('plan-resolved-and-inspect-fresh-process', async () => {
      const chosenUnitId = (selectionConflict.unitIds ?? [])[0];
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const planned = resultOf(await callTool(port, 'surdet_composition_plan', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
          conflictResolutions: [{
            conflictId: selectionConflict.conflictId,
            resolution: 'choose-unit',
            chosenUnitId,
            actor: 'human',
          }],
          reason: 'wave5 aggregate evidence',
        }), 'composition.plan resolved');
        assert(planned.dryRunStatus === 'passed', `dry-run did not pass: ${JSON.stringify(planned)}`);
        planResult = planned;
      } finally {
        await closePort(port, errors);
      }
      const freshPort = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const inspected = resultOf(await callTool(freshPort, 'surdet_composition_inspect', {
          planId: planResult.planId,
          artifactSha256: planResult.artifactSha256,
        }), 'composition.inspect fresh process');
        assert(inspected.plan?.planId === planResult.planId, 'inspected plan id mismatch');
        inspectedPlan = inspected.plan;
      } finally {
        await closePort(freshPort, errors);
      }
    });

    await node('negative-forged-replay-schema-rejected', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        expectedFailure(await callTool(port, 'surdet_composition_execute', {
          planId: planResult.planId,
          artifactSha256: planResult.artifactSha256,
          executeOperationId: 'exec-wave5-1',
          replayOperations: [{ forge: true }],
        }), ['INVALID_REQUEST'], 'forged replayOperations input');
      } finally {
        await closePort(port, errors);
      }
    });

await node('execute-interrupt-at-persisted-boundary', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      const pending = callTool(port, 'surdet_composition_execute', {
        planId: planResult.planId,
        artifactSha256: planResult.artifactSha256,
        executeOperationId: 'exec-wave5-1',
      }).catch(() => undefined);
      let found = null;
      for (let attempt = 0; attempt < 6000; attempt += 1) {
        found = scanForReplayingRecord(dataDir, planResult.planId);
        if (found !== null && found.status === 'REPLAYING' && found.progressIndex >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      assert(found !== null && found.status === 'REPLAYING', 'no REPLAYING integration record appeared before timeout');
      integrationChangeId = found.changeId;
      interruptedProgressIndex = found.progressIndex;
      try {
        await port.transport.close();
      } catch {
        // child already gone is fine here
      }
      try {
        await port.client.close();
      } catch {
        // best effort on a killed child
      }
      await pending;
      const afterKill = scanForReplayingRecord(dataDir, planResult.planId);
      assert(afterKill !== null, 'integration record missing after interrupt');
      integrationChangeId = afterKill.changeId;
      assert(afterKill.status === 'REPLAYING' && afterKill.progressIndex >= 1 && afterKill.progressIndex < afterKill.operationCount,
        `interrupt landed outside the persisted boundary: ${JSON.stringify(afterKill.summary)}`);
    });

    await node('negative-commit-gate-replaying', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', resumeChangeId: integrationChangeId, dataDir }));
      try {
        expectedFailure(await callTool(port, 'surdet_change_commit'), ['COMPOSITION_INCOMPLETE'], 'commit during REPLAYING');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('negative-nonmatching-resume-operation-id', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', resumeChangeId: integrationChangeId, dataDir }));
      try {
        expectedFailure(await callTool(port, 'surdet_composition_execute', {
          planId: planResult.planId,
          artifactSha256: planResult.artifactSha256,
          executeOperationId: 'exec-wave5-wrong',
        }), ['INVALID_REQUEST', 'OPERATION_IDENTITY_MISMATCH'], 'resume with wrong operation id');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('exact-resume-to-ready', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', resumeChangeId: integrationChangeId, dataDir }));
      try {
        const resumed = resultOf(await callTool(port, 'surdet_composition_execute', {
          planId: planResult.planId,
          artifactSha256: planResult.artifactSha256,
          executeOperationId: 'exec-wave5-1',
        }), 'exact resume execute');
        integrationResume = resumed;
        assert(resumed.status === 'READY', `resume did not reach READY: ${JSON.stringify(resumed)}`);
      } finally {
        await closePort(port, errors);
      }
    });

    await node('post-ready-fresh-evidence-and-runtime', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', resumeChangeId: integrationChangeId, dataDir }));
      try {
        diffAfterReady = resultOf(await callTool(port, 'surdet_change_diff'), 'integration change.diff');
        validationAfterReady = resultOf(await callTool(port, 'surdet_project_validate'), 'integration validate');
        simulationAfterReady = resultOf(await callTool(port, 'surdet_project_simulate', { sceneId: 'wave5_alpha' }), 'integration simulate alpha');
        runtimeAlpha = resultOf(await callTool(port, 'surdet_runtime_run_from', { sceneId: 'wave5_alpha', choices: [], seed: 901 }), 'runtime alpha');
        runtimeBeta = resultOf(await callTool(port, 'surdet_runtime_run_from', { sceneId: 'wave5_beta', choices: [], seed: 902 }), 'runtime beta');
        traceAlpha = resultOf(await callTool(port, 'surdet_runtime_read_trace', { traceId: runtimeAlpha.traceId }), 'trace alpha');
        traceBeta = resultOf(await callTool(port, 'surdet_runtime_read_trace', { traceId: runtimeBeta.traceId }), 'trace beta');
        assert(runtimeAlpha.status === 'passed' && runtimeBeta.status === 'passed', 'integration runtime paths failed');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('stage-capsule-provenance-no-mutation', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', resumeChangeId: integrationChangeId, dataDir }));
      try {
        stageCapsule = resultOf(await callTool(port, 'surdet_delivery_capsule', { label: 'wave5 integration stage capsule' }), 'stage integration capsule');
        const provenance = stageCapsule.integrationProvenance;
        assert(provenance && typeof provenance === 'object', 'integration capsule lacks provenance');
        assert(provenance.planId === planResult.planId, 'provenance planId mismatch');
        assert(provenance.status === 'READY', 'provenance status not READY');
        assert(stageCapsule.projectMutation.occurred === false, 'stage capsule reported mutation');
        const alphaPath = path.join(fixture, 'content', 'scenario', 'wave5_alpha.gal');
        assert(!fs.readFileSync(alphaPath, 'utf8').includes('Alpha route C.'), 'rejected candidate C text leaked into fixture');
        candidatesAfter = hashTree(findChangeDirectory(dataDir, candidateA.ref.changeId));
      } finally {
        await closePort(port, errors);
      }
    });

    await node('apply-policy-resume-and-explicit-commit', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'apply', resumeChangeId: integrationChangeId, dataDir }));
      try {
        const validation = resultOf(await callTool(port, 'surdet_project_validate'), 'apply validate');
        const simulation = resultOf(await callTool(port, 'surdet_project_simulate', { sceneId: 'wave5_alpha' }), 'apply simulate');
        assert(validation.ok === true, 'apply validation reported errors');
        assert(simulation.status === 'passed', 'apply simulation did not pass');
        const committed = resultOf(await callTool(port, 'surdet_change_commit'), 'apply explicit commit');
        assert(committed.status === 'COMMITTED', 'apply commit did not commit the integration change');
        applyCommitted = committed;
      } finally {
        await closePort(port, errors);
      }
    });

    await node('fresh-observe-and-disk-equivalence', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'observe', dataDir }));
      try {
        const inspect = resultOf(await callTool(port, 'surdet_project_inspect'), 'observe final inspect');
        assert(inspect.scenes.some((scene) => scene.id === 'wave5_alpha'), 'final project lost wave5_alpha');
        assert(inspect.scenes.some((scene) => scene.id === 'wave5_beta'), 'final project lost wave5_beta');
      } finally {
        await closePort(port, errors);
      }
      const alphaPath = path.join(fixture, 'content', 'scenario', 'wave5_alpha.gal');
      const alphaText = fs.readFileSync(alphaPath, 'utf8');
      assert(alphaText.includes('Alpha route A.'), 'chosen A text missing from disk');
      assert(!alphaText.includes('Alpha route C.'), 'C text present on disk after commit');
      fixtureAfterApply = hashTree(fixture);
      const changedOnDisk = new Set(differenceFiles(fixtureSealed, fixtureAfterApply).map((file) => file.path));
      const changedInDiff = new Set(diffAfterReady.files.map((file) => file.path));
      assert(setsEqual(changedOnDisk, changedInDiff),
        `disk mutation != integration diff: disk=[${[...changedOnDisk]}] diff=[${[...changedInDiff]}]`);
      candidatesFinal = hashTree(findChangeDirectory(dataDir, candidateA.ref.changeId));
      const starterAfter = hashTree(starterRoot);
      assert(starterBefore.sha256 === starterAfter.sha256, 'original Starter changed');
    });

    const payload = {
      schemaVersion: '1.0.0',
      evidenceClass,
      status: 'PASSED',
      mode: modeName,
      gitHead: runHead,
      runnerSha256,
      trackedCodeDiffPaths: trackedDiff,
      stageProjectMutated: false,
      formalFixtureCommitOccurred: applyCommitted?.status === 'COMMITTED',
      formalFixtureMutationMatchesIntegrationDiff: true,
      sourceCapsulesUnchanged: candidatesBefore.sha256 === candidatesFinal.sha256,
      sourceChangesUnchanged: candidatesBefore.fileCount === candidatesFinal.fileCount,
      originalStarterUnchanged: true,
      integrationStatus: integrationResume?.status ?? 'UNKNOWN',
      integrationChangeId,
      validationFresh: validationAfterReady?.ok === true,
      simulationFresh: simulationAfterReady?.status === 'passed',
      alphaTraceFresh: (traceAlpha?.count ?? 0) >= 1,
      betaTraceFresh: (traceBeta?.count ?? 0) >= 1,
      comparisonStatus,
      planId: planResult.planId,
      interruptedAtProgressIndex: interruptedProgressIndex,
      resumed: integrationResume,
      candidates: {
        a: candidateA.ref, b: candidateB.ref, c: candidateC.ref, d: candidateD.ref,
        foreign: foreignCandidate?.ref ?? null,
      },
      capsuleProvenance: {
        planId: stageCapsule.integrationProvenance.planId,
        status: stageCapsule.integrationProvenance.status,
        includedUnits: stageCapsule.integrationProvenance.includedUnits,
        deduplicatedUnits: stageCapsule.integrationProvenance.deduplicatedUnits,
        projectMutationOccurred: stageCapsule.projectMutation.occurred,
      },
      diffFiles: diffAfterReady.files.map((file) => file.path),
      fixtures: { sealedTree: fixtureSealed.sha256, appliedTree: fixtureAfterApply.sha256 },
      starterTree: { sha256: starterBefore.sha256 },
      errors,
      milestones,
      lastPassedNode,
      firstFailedNode,
    };
    const artifact = writeArtifact(modeDirectory, payload);
    console.log(JSON.stringify({ ...payload, artifactIdentity: artifact.identity }));
  } catch (error) {

    const failure = {
      schemaVersion: '1.0.0',
      evidenceClass,
      status: 'FAILED',
      mode: modeName,
      gitHead: runHead,
      runnerSha256,
      trackedCodeDiffPaths: trackedCodeDiffPaths(),
      lastPassedNode,
      firstFailedNode: firstFailedNode ?? currentNode,
      failure: String(error).slice(0, 2000),
      integrationChangeId: integrationChangeId ?? null,
      errors,
      milestones,
      nextAllowedAction: evidenceClass === 'FORMAL' ? 'STOP_NO_RERUN' : 'FIX_AND_USE_NEXT_DIAGNOSTIC',
      notRerun: true,
    };
    const artifact = writeArtifact(modeDirectory, failure);
    console.error(JSON.stringify({ ...failure, artifactIdentity: artifact.identity }));
    process.exitCode = 1;
  } finally {
    stderrLogPath = null;
  }
}

async function main() {
  if (mode === undefined || !MODES.has(mode)) {
    console.error('Usage: node packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs --mode preflight|diagnostic|formal|acceptance-prep');
    process.exitCode = 1;
    return;
  }
  if (mode === 'preflight') return runPreflight();
  if (mode === 'acceptance-prep') return runAcceptancePrep();
  return runEvidence(mode);
}

void main().catch((error) => {
  console.error(`Agent Port Wave 5 runner failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
