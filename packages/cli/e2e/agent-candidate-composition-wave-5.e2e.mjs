
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
  // porcelain rows are `XY <path>`; never trim before slicing or the leading path
  // character is lost (the ackages/... bug). Untracked governance files stay excluded.
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.startsWith('??'))
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countFiles(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function currentChangeRecords(dataDir) {
  const headFiles = [];
  const stack = [dataDir];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name === 'record-head.json') headFiles.push(absolute);
    }
  }
  return headFiles.map((headFile) => {
    const changeDirectory = path.dirname(headFile);
    const changeId = path.basename(changeDirectory);
    const head = readJson(headFile);
    assert(head.formatVersion === 2 && Number.isInteger(head.recordVersion), `invalid record head: ${headFile}`);
    assert(typeof head.recordSha256 === 'string' && /^[0-9a-f]{64}$/i.test(head.recordSha256), `invalid record sha: ${headFile}`);
    const recordFile = path.join(changeDirectory, 'records', `${String(head.recordVersion).padStart(10, '0')}.json`);
    const recordIdentity = readFileIdentity(recordFile);
    assert(recordIdentity.sha256.toLowerCase() === head.recordSha256.toLowerCase(), `record/head SHA mismatch: ${changeId}`);
    const record = readJson(recordFile);
    assert(record.changeId === changeId && record.recordVersion === head.recordVersion, `record/head identity mismatch: ${changeId}`);
    return {
      changeId,
      status: record.status,
      recordVersion: record.recordVersion,
      recordSha256: recordIdentity.sha256,
      integration: record.integration !== undefined,
    };
  }).sort((left, right) => left.changeId.localeCompare(right.changeId));
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

/** Schema-layer rejections never reach the dispatcher: they arrive as plain MCP errors. */
async function callToolRaw(port, name, args = {}) {
  return port.client.callTool({ name, arguments: args });
}

function assertSchemaRejection(response, label) {
  assert(response?.isError === true, `${label} was not rejected at the tool boundary`);
  assert(response.structuredContent === undefined, `${label} unexpectedly carried structured content`);
  const text = response.content?.[0]?.text ?? '';
  assert(text.includes('Input validation error'), `${label} rejection text missing: ${text.slice(0, 200)}`);
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
  assert(errors.protocol.length === 0 && errors.stderrUnexpected.length === 0
    && errors.childCleanupFailures.length === 0, `${label} port errors: ${JSON.stringify(errors)}`);
  assert(capsule.changeStatus === 'OPEN', `${label} source change was not OPEN`);
  assert(capsule.projectMutation?.occurred === false, `${label} source capsule reported project mutation`);
  return { ref: { changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 }, capsule };
}

async function commitFixtureRevisionBump(fixture, dataDir, label) {
  const errors = { protocol: [], stderrUnexpected: [], childCleanupFailures: [] };
  const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'apply', dataDir }));
  let changeId;
  try {
    const begun = resultOf(await callTool(port, 'surdet_change_begin', {
      intent: `Wave5 isolated revision bump ${label}.`,
      acceptanceCriteria: ['Commit one valid isolated fixture scene.'],
      initiator: 'automation',
    }), `${label} change.begin`);
    changeId = begun.changeId;
    resultOf(await callTool(port, 'surdet_scene_create', {
      operationId: `${label}-scene`,
      sceneId: `wave5_revision_bump_${label}`,
      blocks: [
        { kind: 'label', name: 'start' },
        { kind: 'text', value: `Revision bump ${label}.` },
      ],
    }), `${label} scene.create`);
    const validation = resultOf(await callTool(port, 'surdet_project_validate'), `${label} validate`);
    const simulation = resultOf(await callTool(port, 'surdet_project_simulate', {
      sceneId: `wave5_revision_bump_${label}`,
    }), `${label} simulate`);
    const runtime = resultOf(await callTool(port, 'surdet_runtime_run_from', {
      sceneId: `wave5_revision_bump_${label}`,
      choices: [],
      seed: 905,
    }), `${label} runtime`);
    resultOf(await callTool(port, 'surdet_change_diff'), `${label} change.diff`);
    assert(validation.ok === true && simulation.status === 'passed' && runtime.status === 'passed',
      `${label} fresh evidence did not pass`);
    const committed = resultOf(await callTool(port, 'surdet_change_commit'), `${label} commit`);
    assert(committed.status === 'COMMITTED', `${label} did not commit`);
  } finally {
    await closePort(port, errors);
  }
  assert(errors.protocol.length === 0 && errors.stderrUnexpected.length === 0
    && errors.childCleanupFailures.length === 0, `${label} port errors: ${JSON.stringify(errors)}`);
  return { changeId, committed: true };
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
    const modern = await runPreflightLeg({ label: 'modern/auto', fixture: modernFixture, dataDir: modernData, versionNegotiation: { mode: 'auto' } });
    const legacy = await runPreflightLeg({ label: 'legacy/2025', fixture: legacyFixture, dataDir: legacyData, versionNegotiation: { mode: 'legacy' } });
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

function acceptanceInstructions(candidateRefs) {
  const lines = [
    '# Surdet Wave 5 外部 Agent Stage 验收',
    '',
    '这是隔离项目，只允许使用 mcp-stage.json 中指定的 Surdet Agent Port。',
    '禁止使用 Shell、Git、文件系统工具，禁止调用 commit、apply 或 rollback。',
    '',
    '## 稳定候选引用',
    '',
  ];
  for (const label of ['A', 'B', 'C', 'D']) {
    lines.push(label + ': ' + JSON.stringify(candidateRefs.candidates[label]));
  }
  lines.push(
    '',
    '## 固定任务',
    '',
    '1. 调用 capabilities.describe、session.describe、project.inspect。',
    '2. 使用上面的 A/B/C/D 四个稳定引用执行 composition.compare。',
    '3. 检查 units、dependencyEdges、conflicts、identicalGroups 与 evidenceMatrix。',
    '4. 选择 A、B、D；A/C 的 scene:wave5_alpha 冲突选择 A；不得选择 C。',
    '5. 创建并检查 composition plan；确认 B 的 timeline 依赖被自动纳入，A/D 等价来源都保留 provenance。',
    '6. 执行 plan。若中断，只按 repairActions 使用同一 operationId 恢复。',
    '7. 对 integration change 运行 diff、validate、simulate。',
    '8. 分别运行 Alpha 与 Beta runtime trace。',
    '9. 创建 delivery capsule，并保持 integration change 为 OPEN。',
    '10. 汇报 changeId、planId、validation/simulation/两条 trace、capsule 路径/bytes/SHA-256、projectMutation。',
    '',
    '最终必须满足：PROJECT_MUTATION=NO，APPLY=NOT_PERFORMED，FINAL_CHANGE=OPEN。',
    '',
  );
  return lines.join('\n');
}

export function validateAcceptancePrepDirectory(root, evidence) {
  const projectRoot = path.join(root, 'project');
  const dataDir = path.join(root, 'agent-data');
  for (const directory of [projectRoot, dataDir]) {
    assert(fs.statSync(directory).isDirectory(), 'acceptance-prep directory missing: ' + directory);
  }
  for (const name of [
    'mcp-stage.json',
    'apply-resume-template.json',
    'candidate-refs.json',
    'acceptance-instructions.md',
    'evidence.json',
    'identity.json',
  ]) {
    assert(fs.existsSync(path.join(root, name)), 'acceptance-prep file missing: ' + name);
  }

  assert(evidence?.status === 'PREPARED', 'acceptance-prep status was not PREPARED');
  assert(Array.isArray(evidence.sourceCandidates) && evidence.sourceCandidates.length === 4,
    'acceptance-prep must contain four sealed source candidates');
  assert(Array.isArray(evidence.sourceChangeRecords) && evidence.sourceChangeRecords.length === 4,
    'acceptance-prep must contain four source change records');
  assert(evidence.integrationChangeCreated === false, 'acceptance-prep created an integration change');
  assert(evidence.externalAgentStarted === false, 'acceptance-prep started an external Agent');
  assert(evidence.applyAuthorized === false, 'acceptance-prep authorized apply');
  assert(evidence.projectFixtureEqualsStarterAtPrep === true, 'acceptance project did not equal Starter at prep');
  assert(evidence.originalStarterUnchanged === true, 'original Starter changed during acceptance-prep');
  assert(Array.isArray(evidence.errors) && evidence.errors.length === 0, 'acceptance-prep errors were not empty');
  assert(Array.isArray(evidence.childCleanupFailures) && evidence.childCleanupFailures.length === 0,
    'acceptance-prep child cleanup failures were not empty');
  assert(Array.isArray(evidence.activeLeaseDirectories) && evidence.activeLeaseDirectories.length === 0,
    'acceptance-prep left active lease directories');

  const refs = readJson(path.join(root, 'candidate-refs.json'));
  const labels = ['A', 'B', 'C', 'D'];
  assert(Object.keys(refs.candidates ?? {}).sort().join(',') === labels.join(','), 'candidate-refs.json must contain exactly A/B/C/D');
  const evidenceByLabel = new Map(evidence.sourceCandidates.map((candidate) => [candidate.label, candidate]));
  for (const label of labels) {
    const ref = refs.candidates[label];
    const candidate = evidenceByLabel.get(label);
    assert(candidate !== undefined, 'candidate evidence missing: ' + label);
    assert(candidate.sealed === true && candidate.changeStatus === 'OPEN', 'candidate was not sealed OPEN: ' + label);
    assert(typeof ref?.changeId === 'string' && /^chg_/.test(ref.changeId), 'invalid candidate changeId: ' + label);
    assert(typeof ref?.capsuleId === 'string' && ref.capsuleId.length > 0, 'invalid candidate capsuleId: ' + label);
    assert(typeof ref?.artifactSha256 === 'string' && /^[0-9a-f]{64}$/.test(ref.artifactSha256),
      'invalid candidate artifact SHA-256: ' + label);
    for (const key of ['changeId', 'capsuleId', 'artifactSha256']) {
      assert(candidate[key] === ref[key], 'candidate ref/evidence mismatch: ' + label + '/' + key);
    }
    const capsuleIdentity = readFileIdentity(candidate.artifact.path);
    assert(capsuleIdentity.bytes === candidate.artifact.bytes
      && capsuleIdentity.sha256 === candidate.artifact.sha256
      && capsuleIdentity.sha256 === ref.artifactSha256, 'candidate capsule disk identity mismatch: ' + label);
  }

  const sourceIds = new Set(evidence.sourceCandidates.map((candidate) => candidate.changeId));
  const records = currentChangeRecords(dataDir);
  assert(records.length === 4, 'agent-data must contain exactly four source change records');
  assert(records.every((record) => record.status === 'OPEN' && record.integration === false),
    'source changes must remain OPEN and non-integration');
  assert(records.every((record) => sourceIds.has(record.changeId)), 'agent-data contains an unexpected change record');
  assert(JSON.stringify(records) === JSON.stringify(evidence.sourceChangeRecords), 'source record disk evidence mismatch');

  const dataDirFileCount = countFiles(dataDir);
  assert(dataDirFileCount > 0, 'agent-data must not be empty');
  assert(dataDirFileCount === evidence.dataDirFileCount, 'agent-data file count mismatch');
  assert(findActiveLeaseDirectories(dataDir).length === 0, 'active lease directories remained on disk');

  const config = readJson(path.join(root, 'mcp-stage.json'));
  const server = config.mcpServers?.['Surdet Agent Port'];
  assert(server?.command === process.execPath, 'MCP stage command mismatch');
  assert(Array.isArray(server.args) && server.args[0] === portEntry, 'MCP stage launcher mismatch');
  assert(server.args.includes('--project') && server.args.includes(projectRoot), 'MCP stage project mismatch');
  assert(server.args.includes('--policy') && server.args.includes('stage'), 'MCP stage policy mismatch');
  assert(server.env?.SURDET_AGENT_DATA_DIR === dataDir, 'MCP stage data dir mismatch');

  const apply = readJson(path.join(root, 'apply-resume-template.json'));
  assert(apply.status === 'NOT_AUTHORIZED' && apply.policy === 'apply', 'apply template was not NOT_AUTHORIZED');
  assert(apply.project === projectRoot && apply.SURDET_AGENT_DATA_DIR === dataDir, 'apply template identity mismatch');
  assert(typeof apply.resumeChange === 'string' && apply.resumeChange.includes('CHANGE_ID_REQUIRED'),
    'apply template resume placeholder missing');

  const instructions = fs.readFileSync(path.join(root, 'acceptance-instructions.md'), 'utf8');
  for (const label of labels) {
    const ref = refs.candidates[label];
    assert(instructions.includes(ref.changeId) && instructions.includes(ref.capsuleId)
      && instructions.includes(ref.artifactSha256), 'acceptance instructions omitted candidate ' + label);
  }

  const projectTree = hashTree(projectRoot);
  const starterTree = hashTree(starterRoot);
  assert(projectTree.sha256 === evidence.projectTree.sha256, 'acceptance project tree evidence mismatch');
  assert(starterTree.sha256 === evidence.starterTreeAfter.sha256, 'Starter tree evidence mismatch');
  assert(projectTree.sha256 === starterTree.sha256, 'acceptance project no longer equals Starter');
  assert(evidence.starterTreeBefore.sha256 === evidence.starterTreeAfter.sha256, 'original Starter changed');

  const evidenceIdentity = readFileIdentity(path.join(root, 'evidence.json'));
  const identity = readJson(path.join(root, 'identity.json'));
  assert(identity.path === evidenceIdentity.path && identity.bytes === evidenceIdentity.bytes
    && identity.sha256 === evidenceIdentity.sha256, 'acceptance evidence identity sidecar mismatch');
  return true;
}

export async function prepareAcceptance({
  baseDirectory,
  prefix = 'surdet-agent-composition-acceptance-',
}) {
  assert(fs.existsSync(baseDirectory), 'acceptance-prep base directory missing: ' + baseDirectory);
  const root = fs.mkdtempSync(path.join(baseDirectory, prefix));
  const projectRoot = path.join(root, 'project');
  const dataDir = path.join(root, 'agent-data');
  const starterTreeBefore = hashTree(starterRoot);
  copyStarter(projectRoot);
  fs.mkdirSync(dataDir, { recursive: true });
  const projectTree = hashTree(projectRoot);
  assert(projectTree.sha256 === starterTreeBefore.sha256, 'acceptance project copy differs from Starter');

  const alphaOpsA = [
    { tool: 'surdet_scene_create', args: { sceneId: 'wave5_alpha', blocks: alphaBlocksA } },
    { tool: 'surdet_variable_ensure', args: { name: 'flag.alpha', type: 'string', initial: '' } },
  ];
  const betaOps = [
    { tool: 'surdet_timeline_create', args: { timelineId: 'beta_opening', definition: betaTimeline } },
    { tool: 'surdet_scene_create', args: { sceneId: 'wave5_beta', blocks: betaBlocks } },
  ];
  const alphaOpsC = [{ tool: 'surdet_scene_create', args: { sceneId: 'wave5_alpha', blocks: alphaBlocksC } }];
  const sealed = {
    A: await sealCandidate(projectRoot, dataDir, 'acceptance-alpha-a', alphaOpsA),
    B: await sealCandidate(projectRoot, dataDir, 'acceptance-beta-b', betaOps),
    C: await sealCandidate(projectRoot, dataDir, 'acceptance-alpha-c', alphaOpsC),
    D: await sealCandidate(projectRoot, dataDir, 'acceptance-alpha-d', alphaOpsA),
  };

  const projectIdentities = new Set(Object.values(sealed).map((candidate) => candidate.capsule.projectIdentity));
  const baseRevisions = new Set(Object.values(sealed).map((candidate) => candidate.capsule.baseProjectRevision));
  assert(projectIdentities.size === 1 && baseRevisions.size === 1, 'source candidate project identities diverged');
  const sourceChangeRecords = currentChangeRecords(dataDir);
  assert(sourceChangeRecords.length === 4
    && sourceChangeRecords.every((record) => record.status === 'OPEN' && record.integration === false),
  'source candidates were not four sealed OPEN non-integration changes');
  const sourceIds = new Set(Object.values(sealed).map((candidate) => candidate.ref.changeId));
  assert(sourceChangeRecords.every((record) => sourceIds.has(record.changeId)), 'unexpected change was created during prep');

  const candidateRefs = {
    schemaVersion: '1.0.0',
    projectRoot,
    dataDir,
    projectIdentity: [...projectIdentities][0],
    baseProjectRevision: [...baseRevisions][0],
    candidates: Object.fromEntries(Object.entries(sealed).map(([label, candidate]) => [label, candidate.ref])),
    selectionIntent: {
      selectedCandidates: ['A', 'B', 'D'],
      sceneConflictResolution: { objectRef: 'scene:wave5_alpha', chooseCandidate: 'A', excludeCandidate: 'C' },
      retainEquivalentProvenanceFrom: ['A', 'D'],
    },
  };
  const candidateRefsPath = path.join(root, 'candidate-refs.json');
  const instructionsPath = path.join(root, 'acceptance-instructions.md');
  const mcpConfigPath = path.join(root, 'mcp-stage.json');
  const applyTemplatePath = path.join(root, 'apply-resume-template.json');
  writeJson(candidateRefsPath, candidateRefs);
  fs.writeFileSync(instructionsPath, acceptanceInstructions(candidateRefs), 'utf8');
  writeJson(mcpConfigPath, {
    mcpServers: { 'Surdet Agent Port': {
      command: process.execPath,
      args: [portEntry, '--project', projectRoot, '--policy', 'stage'],
      env: { SURDET_AGENT_DATA_DIR: dataDir },
    } },
  });
  writeJson(applyTemplatePath, {
    schemaVersion: '1.0.0',
    project: projectRoot,
    SURDET_AGENT_DATA_DIR: dataDir,
    policy: 'apply',
    resumeChange: '<CHANGE_ID_REQUIRED_AFTER_OWNER_APPROVAL>',
    status: 'NOT_AUTHORIZED',
  });

  const starterTreeAfter = hashTree(starterRoot);
  assert(starterTreeAfter.sha256 === starterTreeBefore.sha256, 'original Starter changed during acceptance-prep');
  const sourceCandidates = Object.entries(sealed).map(([label, candidate]) => {
    const artifact = readFileIdentity(candidate.capsule.artifactIdentity.path);
    assert(artifact.sha256 === candidate.ref.artifactSha256
      && artifact.bytes === candidate.capsule.artifactIdentity.bytes, 'sealed candidate artifact readback mismatch: ' + label);
    return {
      label,
      ...candidate.ref,
      sealed: true,
      changeStatus: candidate.capsule.changeStatus,
      compositionEligibility: candidate.capsule.composition.eligibility,
      projectMutationOccurred: candidate.capsule.projectMutation.occurred,
      artifact,
    };
  });
  const relativeToRepo = path.relative(repoRoot, root);
  const activeLeaseDirectories = findActiveLeaseDirectories(dataDir);
  assert(activeLeaseDirectories.length === 0, 'acceptance-prep left active lease directories');
  const evidence = {
    schemaVersion: '1.0.0',
    evidenceClass: 'ACCEPTANCE_PREP',
    status: 'PREPARED',
    mode: 'acceptance-prep',
    runHead,
    gitHead: runHead,
    runnerSha256,
    createdAt: new Date().toISOString(),
    root,
    projectRoot,
    dataDir,
    preparationRootOutsideRepository: relativeToRepo.startsWith('..') || path.isAbsolute(relativeToRepo),
    sourceCandidates,
    sourceChangeRecords,
    dataDirFileCount: countFiles(dataDir),
    integrationChangeCreated: false,
    externalAgentStarted: false,
    externalAgentToolsCalled: [],
    applyAuthorized: false,
    projectFixtureEqualsStarterAtPrep: projectTree.sha256 === starterTreeBefore.sha256,
    originalStarterUnchanged: starterTreeAfter.sha256 === starterTreeBefore.sha256,
    projectTree,
    starterTreeBefore,
    starterTreeAfter,
    mcpStageConfig: readFileIdentity(mcpConfigPath),
    applyResumeTemplate: { ...readFileIdentity(applyTemplatePath), status: 'NOT_AUTHORIZED' },
    candidateRefsFile: readFileIdentity(candidateRefsPath),
    acceptanceInstructionsFile: readFileIdentity(instructionsPath),
    errors: [],
    childCleanupFailures: [],
    activeLeaseDirectories,
  };
  const artifact = writeArtifact(root, evidence);
  validateAcceptancePrepDirectory(root, evidence);
  return { status: 'PREPARED', root, evidence, artifactIdentity: artifact.identity, identityPath: artifact.identityPath };
}

async function runAcceptancePrep() {
  const desktop = path.join(os.homedir(), 'Desktop');
  assert(fs.existsSync(desktop), 'Desktop directory missing: ' + desktop);
  const result = await prepareAcceptance({ baseDirectory: desktop });
  console.log(JSON.stringify({
    status: result.status,
    mode: 'acceptance-prep',
    root: result.root,
    evidence: result.artifactIdentity,
    identityPath: result.identityPath,
  }));
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

function hashCandidateSources(dataDir, candidates) {
  const entries = candidates.map((candidate) => {
    const changeDirectory = findChangeDirectory(dataDir, candidate.ref.changeId);
    assert(changeDirectory !== null, `cannot locate source change: ${candidate.ref.changeId}`);
    const capsuleDirectory = path.join(changeDirectory, 'capsules', candidate.ref.capsuleId);
    assert(fs.existsSync(capsuleDirectory), `cannot locate source capsule: ${candidate.ref.capsuleId}`);
    return {
      changeId: candidate.ref.changeId,
      capsuleId: candidate.ref.capsuleId,
      change: hashTree(changeDirectory),
      capsule: hashTree(capsuleDirectory),
    };
  }).sort((left, right) => left.changeId.localeCompare(right.changeId));
  const changesIdentity = entries.map((entry) =>
    `${entry.changeId}\0${entry.change.fileCount}\0${entry.change.bytes}\0${entry.change.sha256}`).join('\n');
  const capsulesIdentity = entries.map((entry) =>
    `${entry.changeId}\0${entry.capsuleId}\0${entry.capsule.fileCount}\0${entry.capsule.bytes}\0${entry.capsule.sha256}`).join('\n');
  return {
    changesSha256: sha256(Buffer.from(changesIdentity, 'utf8')),
    capsulesSha256: sha256(Buffer.from(capsulesIdentity, 'utf8')),
    entries,
  };
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

/** Scan authoritative record-head snapshots for an integration mid-replay state. */
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
      const headPath = path.join(full, 'record-head.json');
      if (fs.existsSync(headPath)) {
        try {
          const head = JSON.parse(fs.readFileSync(headPath, 'utf8'));
          assert(head?.formatVersion === 2 && Number.isInteger(head.recordVersion) && head.recordVersion >= 0,
            `invalid record head while scanning replay: ${headPath}`);
          assert(typeof head.recordSha256 === 'string' && /^[0-9a-f]{64}$/i.test(head.recordSha256),
            `invalid record head identity while scanning replay: ${headPath}`);
          const recordPath = path.join(full, 'records', `${String(head.recordVersion).padStart(10, '0')}.json`);
          const identity = readFileIdentity(recordPath);
          assert(identity.sha256 === head.recordSha256,
            `record head identity mismatch while scanning replay: ${recordPath}`);
          const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
          assert(record.recordVersion === head.recordVersion,
            `record version mismatch while scanning replay: ${recordPath}`);
          const integration = record.integration;
          if (integration?.planId === planId) {
            return {
              changeId: entry.name,
              directory: full,
              recordVersion: record.recordVersion,
              status: integration.status,
              progressIndex: integration.nextOperationIndex ?? 0,
              summary: { status: integration.status, index: integration.nextOperationIndex },
            };
          }
        } catch {
          // The head is replaced atomically, but a concurrent read can still observe
          // a transient sharing violation on Windows. Polling will retry this snapshot.
        }
      }
      stack.push(full);
    }
  }
  return null;
}

/** Collect every residual directory under any .locks root inside dataDir. */
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
      if (entry.name === '.locks') {
        collectLockResidues(full, active);
        continue;
      }
      stack.push(full);
    }
  }
  return active.sort();
}

function collectLockResidues(locksRoot, out) {
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
        // stale/ is a quarantine archive proving safe orphan takeover; it is not
        // an active lease and must never fail the activeLeaseDirectories gate.
        if (entry.name !== 'stale') stack.push(full);
        continue;
      }
      out.push(full);
    }
  }
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
  let comparedFingerprint = '';
  let sceneUnitA, sceneUnitB, sceneUnitC, sceneUnitD, timelineUnitB;
  let variableUnitA, variableUnitD, identicalVariableGroupAD, identicalSceneGroupAD;
  let selectedCandidateUnitIds = [];
  let closureEvidence = null;
  let negativeEvidence = null;
  let integrationChangeId, interruptedProgressIndex, integrationResume;
  let diffAfterReady, validationAfterReady, simulationAfterReady, runtimeAlpha, runtimeBeta, traceAlpha, traceBeta;
  let stageCapsule, applyCommitted, fixtureAfterApply;
  let stageProjectMutated = true; // proven by comparison below; starts unknown-true

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
      // Baseline only after the deliberate legacy capsule fixture has been written.
      // Every A/B/C/D source change and v2 capsule is covered, not only candidate A.
      candidatesBefore = hashCandidateSources(dataDir, [candidateA, candidateB, candidateC, candidateD]);
    });

    await node('compare-abcd-conflicts-and-identical', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const compared = resultOf(await callTool(port, 'surdet_composition_compare', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
        }), 'composition.compare abcd');
        comparisonStatus = compared.status;
        comparedFingerprint = compared.comparisonFingerprint;
        assert(typeof comparedFingerprint === 'string' && comparedFingerprint.length > 0, 'missing comparisonFingerprint');
        const conflicts = compared.conflicts ?? [];
        selectionConflict = conflicts.find((conflict) => conflict.severity === 'selection-required');
        assert(selectionConflict !== undefined, 'expected selection-required conflict between A and C');
        assert((selectionConflict.unitIds ?? []).length >= 2, 'selection conflict should cover both alpha units');
        const identical = compared.identicalGroups ?? [];
        assert(identical.length >= 1, 'expected an identical group covering A and D');

        // Explicit public-closure evidence via compared.units + compared.dependencyEdges.
        const units = compared.units ?? [];
        sceneUnitB = units.find((unit) => unit.primaryObject === 'scene:wave5_beta'
          && unit.candidateId === `cand-${candidateB.ref.changeId}`);
        timelineUnitB = units.find((unit) => unit.primaryObject === 'timeline:beta_opening'
          && unit.candidateId === `cand-${candidateB.ref.changeId}`);
        sceneUnitA = units.find((unit) => unit.primaryObject === 'scene:wave5_alpha'
          && unit.candidateId === `cand-${candidateA.ref.changeId}`);
        sceneUnitC = units.find((unit) => unit.primaryObject === 'scene:wave5_alpha'
          && unit.candidateId === `cand-${candidateC.ref.changeId}`);
        sceneUnitD = units.find((unit) => unit.primaryObject === 'scene:wave5_alpha'
          && unit.candidateId === `cand-${candidateD.ref.changeId}`);
        variableUnitA = units.find((unit) => unit.primaryObject === 'variable:flag.alpha'
          && unit.candidateId === `cand-${candidateA.ref.changeId}`);
        variableUnitD = units.find((unit) => unit.primaryObject === 'variable:flag.alpha'
          && unit.candidateId === `cand-${candidateD.ref.changeId}`);
        assert(sceneUnitB && timelineUnitB && sceneUnitA && sceneUnitC && sceneUnitD
          && variableUnitA && variableUnitD, 'expected per-candidate units in compare result');
        identicalVariableGroupAD = identical.find((group) =>
          (group.unitIds ?? []).includes(variableUnitA.unitId)
          && (group.unitIds ?? []).includes(variableUnitD.unitId));
        identicalSceneGroupAD = identical.find((group) =>
          (group.unitIds ?? []).includes(sceneUnitA.unitId)
          && (group.unitIds ?? []).includes(sceneUnitD.unitId));
        assert(identicalVariableGroupAD !== undefined, 'expected A/D variable identical group');
        assert(identicalSceneGroupAD !== undefined, 'expected A/D scene identical subgroup despite divergent C');
        selectedCandidateUnitIds = units
          .filter((unit) => unit.candidateId === `cand-${candidateA.ref.changeId}`
            || unit.candidateId === `cand-${candidateD.ref.changeId}`
            || (unit.candidateId === `cand-${candidateB.ref.changeId}` && unit.unitId !== timelineUnitB.unitId))
          .map((unit) => unit.unitId)
          .sort();
        const edges = compared.dependencyEdges ?? [];
        assert(edges.some((edge) => edge.fromUnitId === sceneUnitB.unitId && edge.toUnitId === timelineUnitB.unitId),
          'expected dependencyEdge B-scene -> B-timeline');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('negative-unresolved-conflict-blocks-plan', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        expectedFailure(await callTool(port, 'surdet_composition_plan', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
          comparisonFingerprint: comparedFingerprint,
          selectedUnitIds: [sceneUnitA.unitId, sceneUnitB.unitId, sceneUnitC.unitId],
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
      // Foreign projectRoot but the SAME dataDir namespace: the source change stays
      // visible to the store while its project identity differs.
      const foreignFixture = path.join(runDirectory, 'fixture-foreign');
      copyStarter(foreignFixture);
      foreignCandidate = await sealCandidate(foreignFixture, dataDir, 'foreign-x', [
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

    await node('negative-observe-policy-execute-blocked', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'observe', dataDir }));
      try {
        const names = await listTools(port);
        assert(!names.includes('surdet_composition_execute'), 'observe policy exposed composition.execute');
      } finally {
        await closePort(port, errors);
      }
    });

    await node('negative-stale-fingerprint-and-base-revision-mismatch', async () => {
      // A stale reviewed fingerprint is rejected before a plan can be created.
      const mainPort = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        expectedFailure(await callTool(mainPort, 'surdet_composition_plan', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
          comparisonFingerprint: '0'.repeat(64),
          selectedUnitIds: [sceneUnitA.unitId],
          reason: 'stale reviewed comparison attempt',
        }), ['COMPOSITION_PLAN_STALE'], 'stale comparison fingerprint');
      } finally {
        await closePort(mainPort, errors);
      }

      // Base-revision evidence uses a separate disposable project. Produce one
      // candidate, commit an unrelated valid revision bump through public MCP, then
      // seal another candidate and compare the two generations.
      const baseFixture = path.join(runDirectory, 'fixture-base-mismatch');
      copyStarter(baseFixture);
      const oldCandidate = await sealCandidate(baseFixture, dataDir, 'base-old', [
        { tool: 'surdet_scene_create', args: {
          sceneId: 'wave5_base_old',
          blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', value: 'Old base candidate.' }],
        } },
      ]);
      await commitFixtureRevisionBump(baseFixture, dataDir, 'base_mismatch');
      const newCandidate = await sealCandidate(baseFixture, dataDir, 'base-new', [
        { tool: 'surdet_scene_create', args: {
          sceneId: 'wave5_base_new',
          blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', value: 'New base candidate.' }],
        } },
      ]);
      const basePort = await awaitPort(connectPort({ projectRoot: baseFixture, policy: 'observe', dataDir }));
      try {
        const compared = resultOf(await callTool(basePort, 'surdet_composition_compare', {
          candidateRefs: [oldCandidate.ref, newCandidate.ref],
        }), 'base revision mismatch compare');
        const mismatch = (compared.conflicts ?? []).find((conflict) => conflict.code === 'CANDIDATE_BASE_MISMATCH');
        assert(compared.status === 'blocked' && mismatch !== undefined,
          `base mismatch did not block comparison: ${JSON.stringify(compared.conflicts ?? [])}`);
        negativeEvidence = {
          stalePlanCode: 'COMPOSITION_PLAN_STALE',
          baseRevisionMismatchCode: mismatch.code,
          observeExecuteExposed: false,
        };
      } finally {
        await closePort(basePort, errors);
      }
    });

    await node('plan-resolved-and-inspect-fresh-process', async () => {
      // Explicit selection contract per the taskbook: select every A/D unit and the B
      // scene, but deliberately omit the B timeline. Closure must add that timeline;
      // conflict resolution must exclude C/D's conflicting scene while the identical
      // A/D variable group is deduplicated with both provenance identities retained.
      const selectedUnitIds = selectedCandidateUnitIds;
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const planned = resultOf(await callTool(port, 'surdet_composition_plan', {
          candidateRefs: [candidateA.ref, candidateB.ref, candidateC.ref, candidateD.ref],
          comparisonFingerprint: comparedFingerprint,
          selectedUnitIds,
          conflictResolutions: [{
            conflictId: selectionConflict.conflictId,
            resolution: 'choose-unit',
            chosenUnitId: sceneUnitA.unitId,
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
        const selected = inspectedPlan.selectedUnitIds ?? [];
        const implicit = inspectedPlan.implicitInclusions ?? [];
        const excluded = inspectedPlan.excludedUnitIds ?? [];
        assert(selected.includes(sceneUnitB.unitId), 'B scene unit must be explicitly selected');
        assert(!selected.includes(timelineUnitB.unitId), 'B timeline must NOT be directly selected');
        assert(implicit.includes(timelineUnitB.unitId), 'B timeline must be implicitly included by closure');
        const replays = inspectedPlan.replayOperations ?? [];
        const timelineIndex = replays.findIndex((operation) => operation.sourceUnitId === timelineUnitB.unitId);
        const sceneIndex = replays.findIndex((operation) => operation.sourceUnitId === sceneUnitB.unitId);
        assert(timelineIndex >= 0 && sceneIndex >= 0, 'both B replay operations missing');
        assert(timelineIndex < sceneIndex, 'timeline must replay before the dependent scene');
        assert(selectedCandidateUnitIds.every((unitId) => selected.includes(unitId)), 'A/B/D explicit selections were not preserved');
        assert(selected.includes(sceneUnitA.unitId) && selected.includes(sceneUnitD.unitId), 'A and D scene units must be explicitly selected');
        assert(selected.includes(variableUnitA.unitId) && selected.includes(variableUnitD.unitId), 'A and D variable units must be explicitly selected');
        assert(excluded.includes(sceneUnitC.unitId), 'conflicting C scene must be excluded');
        assert(!excluded.includes(sceneUnitD.unitId), 'identical D scene provenance must not be conflict-excluded');
        const variableDedupeGroup = (inspectedPlan.deduplicatedUnits ?? [])
          .find((group) => group.groupId === identicalVariableGroupAD.groupId);
        const sceneDedupeGroup = (inspectedPlan.deduplicatedUnits ?? [])
          .find((group) => group.groupId === identicalSceneGroupAD.groupId);
        assert(variableDedupeGroup !== undefined, 'expected A/D variable dedupe provenance');
        assert(sceneDedupeGroup !== undefined, 'expected A/D scene dedupe provenance');
        assert(variableDedupeGroup.provenanceUnitIds?.includes(variableUnitA.unitId)
          && variableDedupeGroup.provenanceUnitIds?.includes(variableUnitD.unitId),
        'dedupe provenance must retain both A and D variable units');
        assert(sceneDedupeGroup.provenanceUnitIds?.includes(sceneUnitA.unitId)
          && sceneDedupeGroup.provenanceUnitIds?.includes(sceneUnitD.unitId),
        'dedupe provenance must retain both A and D scene units');
        assert([variableUnitA.unitId, variableUnitD.unitId].includes(variableDedupeGroup.retainedUnitId),
          'dedupe retained unit must come from A or D');
        assert([sceneUnitA.unitId, sceneUnitD.unitId].includes(sceneDedupeGroup.retainedUnitId),
          'scene dedupe retained unit must come from A or D');
        assert(replays.filter((operation) =>
          operation.sourceUnitId === variableUnitA.unitId || operation.sourceUnitId === variableUnitD.unitId).length === 1,
        'A/D identical variable must replay exactly once');
        assert(replays.filter((operation) =>
          operation.sourceUnitId === sceneUnitA.unitId || operation.sourceUnitId === sceneUnitD.unitId).length === 1,
        'A/D identical scene must replay exactly once');
        assert(replays.every((operation) => operation.sourceUnitId !== sceneUnitC.unitId),
          'conflict-rejected C scene leaked into replays');
        closureEvidence = {
          selectedUnitIds: selected,
          implicitInclusions: implicit,
          timelineReplayIndex: timelineIndex,
          sceneReplayIndex: sceneIndex,
          deduplicatedUnits: [variableDedupeGroup, sceneDedupeGroup],
        };
      } finally {
        await closePort(freshPort, errors);
      }
    });

    await node('negative-forged-replay-schema-rejected', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'stage', dataDir }));
      try {
        const response = await callToolRaw(port, 'surdet_composition_execute', {
          planId: planResult.planId,
          artifactSha256: planResult.artifactSha256,
          executeOperationId: 'exec-wave5-1',
          replayOperations: [{ forge: true }],
        });
        assertSchemaRejection(response, 'forged replayOperations input');
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
      const childPid = port.transport.pid;
      assert(typeof childPid === 'number', 'integration child pid unavailable for deterministic interrupt');
      try {
        process.kill(childPid, 'SIGTERM');
      } catch {
        // If execution raced to process exit, the persisted state check below will
        // reject READY and keep this from becoming false interruption evidence.
      }
      await pending;
      try {
        await port.transport.close();
      } catch {
        // A force-terminated transport may already be closed.
      }
      try {
        await port.client.close();
      } catch {
        // A force-terminated client may already be closed.
      }
      let childAlive = true;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          process.kill(childPid, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch {
          childAlive = false;
          break;
        }
      }
      assert(childAlive === false, `integration child pid remained alive: ${childPid}`);
      const afterKill = scanForReplayingRecord(dataDir, planResult.planId);
      assert(afterKill !== null, 'integration record missing after interrupt');
      integrationChangeId = afterKill.changeId;
      const operationCount = inspectedPlan.replayOperations?.length ?? 0;
      assert(afterKill.status === 'REPLAYING' && afterKill.progressIndex >= 1 && afterKill.progressIndex < operationCount,
        `interrupt landed outside the persisted boundary: ${JSON.stringify(afterKill.summary)}`);
    });

    await node('negative-commit-gate-replaying', async () => {
      const port = await awaitPort(connectPort({ projectRoot: fixture, policy: 'apply', resumeChangeId: integrationChangeId, dataDir }));
      try {
        const beforeRecovery = resultOf(await callTool(port, 'surdet_session_describe'), 'describe interrupted lease');
        const retryAfterMs = beforeRecovery.lease?.change?.retryAfterMs ?? 0;
        assert(beforeRecovery.activeChange?.integration?.status === 'REPLAYING',
          'interrupted change was not REPLAYING before lease recovery');
        assert(beforeRecovery.lease?.change?.manualRecoveryRequired === false,
          'interrupted change lease unexpectedly requires manual recovery');
        if (retryAfterMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs + 100));
        }
        const recoverable = resultOf(await callTool(port, 'surdet_session_describe'), 'describe recoverable lease');
        assert(recoverable.lease?.change?.state === 'stale-candidate' || recoverable.lease?.change?.state === 'free',
          `interrupted lease did not become recoverable: ${JSON.stringify(recoverable.lease?.change)}`);
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
        }), ['COMPOSITION_PLAN_INVALID'], 'resume with wrong operation id');
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
        const stagedDiffText = JSON.stringify(diffAfterReady);
        assert(stagedDiffText.includes('Alpha route A.'), 'selected candidate A text missing from staged diff');
        assert(!stagedDiffText.includes('Alpha route C.'), 'rejected candidate C text leaked into staged diff');
        candidatesAfter = hashCandidateSources(dataDir, [candidateA, candidateB, candidateC, candidateD]);
      } finally {
        await closePort(port, errors);
      }
    });

    await node('apply-policy-resume-and-explicit-commit', async () => {
      // stageProjectMutated must come from a real comparison, never a hard-coded false:
      // the integration replay lives inside the change store, so the fixture tree must
      // still equal the sealed snapshot before apply commits it to disk.
      const treeBeforeApply = hashTree(fixture);
      stageProjectMutated = treeBeforeApply.sha256 !== fixtureSealed.sha256;
      assert(stageProjectMutated === false, `stage policy mutated the project before apply: ${treeBeforeApply.sha256}`);
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
      candidatesFinal = hashCandidateSources(dataDir, [candidateA, candidateB, candidateC, candidateD]);
      const starterAfter = hashTree(starterRoot);
      assert(starterBefore.sha256 === starterAfter.sha256, 'original Starter changed');
    });

    // Every port is closed by now: sweep the namespace for residual lease directories.
    const activeLeaseDirectories = findActiveLeaseDirectories(dataDir);
    assert(activeLeaseDirectories.length === 0, `residual lease directories: ${JSON.stringify(activeLeaseDirectories)}`);
    assert(errors.protocol.length === 0, `protocol errors: ${JSON.stringify(errors.protocol)}`);
    assert(errors.stderrUnexpected.length === 0, `unexpected stderr: ${JSON.stringify(errors.stderrUnexpected)}`);
    assert(errors.childCleanupFailures.length === 0, `child cleanup failures: ${JSON.stringify(errors.childCleanupFailures)}`);
    assert(candidatesBefore.capsulesSha256 === candidatesAfter.capsulesSha256
      && candidatesBefore.capsulesSha256 === candidatesFinal.capsulesSha256,
    'source capsule identities changed during composition');
    assert(candidatesBefore.changesSha256 === candidatesAfter.changesSha256
      && candidatesBefore.changesSha256 === candidatesFinal.changesSha256,
    'source change identities changed during composition');

    const payload = {
      schemaVersion: '1.0.0',
      evidenceClass,
      status: 'PASSED',
      mode: modeName,
      runHead,
      gitHead: runHead,
      runnerSha256,
      trackedCodeDiffPaths: trackedDiff,
      errors: [],
      errorChannels: errors,
      childCleanupFailures: [],
      activeLeaseDirectories,
      stageProjectMutated,
      formalFixtureCommitOccurred: applyCommitted?.status === 'COMMITTED',
      formalFixtureMutationMatchesIntegrationDiff: true,
      sourceCapsulesUnchanged: candidatesBefore.capsulesSha256 === candidatesFinal.capsulesSha256,
      sourceChangesUnchanged: candidatesBefore.changesSha256 === candidatesFinal.changesSha256,
      sourceIdentity: {
        before: { capsulesSha256: candidatesBefore.capsulesSha256, changesSha256: candidatesBefore.changesSha256 },
        afterStage: { capsulesSha256: candidatesAfter.capsulesSha256, changesSha256: candidatesAfter.changesSha256 },
        final: { capsulesSha256: candidatesFinal.capsulesSha256, changesSha256: candidatesFinal.changesSha256 },
      },
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
      closureEvidence,
      negativeEvidence,
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
      runHead,
      gitHead: runHead,
      runnerSha256,
      activeLeaseDirectories: findActiveLeaseDirectories(dataDir),
      trackedCodeDiffPaths: trackedCodeDiffPaths(),
      lastPassedNode,
      firstFailedNode: firstFailedNode ?? currentNode,
      failure: String(error).slice(0, 2000),
      integrationChangeId: integrationChangeId ?? null,
      errorChannels: errors,
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

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === path.resolve(runnerPath)) {
  void main().catch((error) => {
    console.error(`Agent Port Wave 5 runner failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
