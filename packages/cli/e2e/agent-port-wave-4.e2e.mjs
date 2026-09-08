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
const artifactRoot = path.join(repoRoot, 'packages/cli/e2e/artifacts');
const runHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();

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

function hashTree(root, { skipBuild = true } = {}) {
  const files = [];
  function walk(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules' || (skipBuild && entry.name === 'dist')) continue;
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

function newDirectory(label) {
  fs.mkdirSync(artifactRoot, { recursive: true });
  return fs.mkdtempSync(path.join(artifactRoot, `agent-port-wave-4-${label.toLowerCase()}-`));
}

function isWithinPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function newDesktopAcceptanceDirectory() {
  const desktopRoot = path.join(os.homedir(), 'Desktop');
  assert(fs.existsSync(desktopRoot), `Desktop directory missing: ${desktopRoot}`);
  const directory = fs.mkdtempSync(path.join(desktopRoot, 'surdet-agent-port-acceptance-'));
  assert(!isWithinPath(repoRoot, directory), `acceptance prep must be outside repository: ${directory}`);
  assert(isWithinPath(desktopRoot, directory), `acceptance prep must be on Desktop: ${directory}`);
  return directory;
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
  const bytes = fs.readFileSync(artifactPath);
  const identity = { path: artifactPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
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
  assert(accepted.includes(envelope.error?.code), `${label} code ${envelope.error?.code} not in ${accepted.join(',')}`);
  return envelope;
}

async function connectPort({ projectRoot, policy, resumeChangeId, dataDir, versionNegotiation = { mode: 'auto' } }) {
  const args = [portEntry, '--project', projectRoot, '--policy', policy];
  if (resumeChangeId !== undefined) args.push('--resume-change', resumeChangeId);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: repoRoot,
    env: { ...process.env, SURDET_AGENT_DATA_DIR: dataDir, SURDET_GIT_HEAD: runHead },
    stderr: 'pipe',
  });
  const protocolErrors = [];
  transport.onerror = (error) => protocolErrors.push(String(error?.message ?? error));
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const client = new Client(
    { name: 'surdet-wave-4-evidence', version: '1.0.0' },
    { versionNegotiation },
  );
  await client.connect(transport);
  return { client, transport, protocolErrors, get stderr() { return stderr; } };
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
  if (port.transport.pid !== null) errors.childCleanupFailures.push(`child pid remained: ${port.transport.pid}`);
  for (const error of port.protocolErrors) errors.protocol.push(error);
  const unexpectedStderr = port.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Surdet Agent Port ready:'));
  errors.stderrUnexpected.push(...unexpectedStderr);
  return { stderr: port.stderr, stdoutProtocolPurity: port.protocolErrors.length === 0 };
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

async function observeReadback(port, traceId) {
  resultOf(await callTool(port, 'surdet_project_inspect'), 'observe project.inspect');
  resultOf(await callTool(port, 'surdet_change_diff'), 'observe change.diff');
  resultOf(await callTool(port, 'surdet_runtime_read_trace', { traceId }), 'observe runtime.read-trace');
  const capsule = resultOf(await callTool(port, 'surdet_delivery_capsule', { label: 'observe readback' }), 'observe delivery capsule');
  assert(capsule.projectMutation.occurred === false, 'observe capsule reported project mutation');
  return capsule;
}

const timelineDefinition = {
  version: 1,
  id: 'agent_port_intro',
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'harbor' }] },
    { kind: 'portrait', target: 'lynn:coat', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'normal', position: 'left' }] },
    { kind: 'screen', cues: [
      { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
      { atMs: 50, durationMs: 700, easing: 'inOutSine', action: 'fade', alpha: 0 },
    ] },
  ],
};

const entryBlocks = [
  { kind: 'label', name: 'start' },
  { kind: 'instruction', name: 'timeline', args: ['agent_port_intro'], modifiers: { blocking: '' } },
  { kind: 'text', speaker: 'agent_guide', value: '请选择路线。' },
  { kind: 'choice', options: [
    { label: 'A', effects: [{ name: 'set', args: ['agent.route', '=', '"A"'] }], target: { kind: 'jump', value: 'agent_port_result.path_a' } },
    { label: 'B', effects: [{ name: 'set', args: ['agent.route', '=', '"B"'] }], target: { kind: 'jump', value: 'agent_port_result.path_b' } },
  ] },
];

const resultBlocks = [
  { kind: 'label', name: 'path_a' },
  { kind: 'text', speaker: 'agent_guide', value: '路线 A。' },
  { kind: 'label', name: 'path_b' },
  { kind: 'text', speaker: 'agent_guide', value: '路线 B。' },
];

async function authoringWorkflow(port, { pendingMutation = false } = {}) {
  const capabilities = resultOf(await callTool(port, 'surdet_capabilities_describe'), 'capabilities.describe');
  assert(capabilities.capabilities?.length === 20, 'capabilities.describe did not return 20 registry entries');
  resultOf(await callTool(port, 'surdet_project_inspect'), 'project.inspect');
  const assets = resultOf(await callTool(port, 'surdet_project_assets'), 'project.assets');
  assert(assets.backgrounds.some((asset) => asset.key === 'harbor' && asset.resolved), 'harbor asset missing');
  assert(assets.portraits.some((asset) => asset.role === 'lynn' && asset.expression === 'normal' && asset.resolved), 'lynn normal portrait missing');

  const begun = resultOf(await callTool(port, 'surdet_change_begin', {
    intent: 'Create the deterministic Agent Port introduction flow.',
    acceptanceCriteria: ['Both routes are reachable.', 'The approved assets and timeline validate.'],
    initiator: 'external-agent',
  }), 'change.begin');
  const changeId = begun.changeId;

  resultOf(await callTool(port, 'surdet_variable_ensure', {
    operationId: 'op-agent-route', name: 'agent.route', type: 'string', initial: '',
  }), 'variable.ensure');
  const characterBefore = resultOf(await callTool(port, 'surdet_object_inspect', { objectRef: 'character:lynn' }), 'object.inspect character');
  resultOf(await callTool(port, 'surdet_character_ensure', {
    operationId: 'op-agent-guide', id: 'agent_guide', name: '引路人', avatar: 'lynn', expectedFingerprint: characterBefore.fingerprint,
  }), 'character.ensure');
  const timelineCreated = resultOf(await callTool(port, 'surdet_timeline_create', {
    operationId: 'op-agent-timeline', timelineId: 'agent_port_intro', definition: timelineDefinition,
  }), 'timeline.create');
  const fingerprintA = timelineCreated.fingerprint;

  resultOf(await callTool(port, 'surdet_timeline_patch', {
    operationId: 'op-timeline-repair-a', timelineId: 'agent_port_intro',
    patch: { kind: 'addTrack', expectedFingerprint: fingerprintA, trackKind: 'background' },
  }), 'timeline.patch with fingerprint A');
  const stalePatch = expectedFailure(await callTool(port, 'surdet_timeline_patch', {
    operationId: 'op-timeline-stale', timelineId: 'agent_port_intro',
    patch: { kind: 'addTrack', expectedFingerprint: fingerprintA, trackKind: 'portrait' },
  }), ['OBJECT_REF_STALE', 'OBJECT_PRECONDITION_FAILED'], 'stale timeline.patch');
  assert(stalePatch.error.retryDisposition === 'after-inspect', 'stale repair disposition is not after-inspect');
  assert(stalePatch.error.repairActions.some((action) => action.capability === 'object.inspect'), 'stale repair does not point to object.inspect');
  const precondition = expectedFailure(await callTool(port, 'surdet_timeline_create', {
    operationId: 'op-timeline-precondition', timelineId: 'agent_port_intro', definition: timelineDefinition,
  }), 'OBJECT_PRECONDITION_FAILED', 'duplicate timeline.create');
  assert(precondition.error.retryDisposition === 'after-inspect', 'precondition repair disposition is not after-inspect');
  const timelineCurrent = resultOf(await callTool(port, 'surdet_object_inspect', { objectRef: 'timeline:agent_port_intro' }), 'repair object.inspect');
  resultOf(await callTool(port, 'surdet_timeline_patch', {
    operationId: 'op-timeline-repair-b', timelineId: 'agent_port_intro',
    patch: { kind: 'addTrack', expectedFingerprint: timelineCurrent.fingerprint, trackKind: 'background' },
  }), 'timeline repair with fingerprint B');

  resultOf(await callTool(port, 'surdet_scene_create', {
    operationId: 'op-agent-entry', sceneId: 'agent_port_entry', blocks: entryBlocks,
  }), 'scene.create entry');
  resultOf(await callTool(port, 'surdet_scene_create', {
    operationId: 'op-agent-result', sceneId: 'agent_port_result', blocks: resultBlocks,
  }), 'scene.create result');
  const entryBefore = resultOf(await callTool(port, 'surdet_object_inspect', { objectRef: 'config:entryScene' }), 'object.inspect entryScene');
  resultOf(await callTool(port, 'surdet_project_entry_scene_set', {
    operationId: 'op-agent-entry-scene', sceneId: 'agent_port_entry', expectedFingerprint: entryBefore.fingerprint,
  }), 'project.entry-scene.set');

  const validation = resultOf(await callTool(port, 'surdet_project_validate'), 'project.validate');
  assert(validation.ok === true && validation.issues.filter((issue) => issue.severity === 'error').length === 0, 'validation contains errors');
  const simulation = resultOf(await callTool(port, 'surdet_project_simulate', { sceneId: 'agent_port_entry' }), 'project.simulate');
  assert(simulation.status === 'passed', 'simulation did not pass');
  const runtimeA = resultOf(await callTool(port, 'surdet_runtime_run_from', { sceneId: 'agent_port_entry', choices: [0], seed: 701 }), 'runtime.run-from A');
  const runtimeB = resultOf(await callTool(port, 'surdet_runtime_run_from', { sceneId: 'agent_port_entry', choices: [1], seed: 702 }), 'runtime.run-from B');
  assert(runtimeA.status === 'passed' && runtimeB.status === 'passed', 'runtime paths did not pass');
  const trace = resultOf(await callTool(port, 'surdet_runtime_read_trace', { traceId: runtimeA.traceId }), 'runtime.read-trace');
  assert(trace.count >= 1, 'runtime trace was empty');
  const diff = resultOf(await callTool(port, 'surdet_change_diff'), 'change.diff');
  assert(diff.files.some((file) => file.path === 'content/scenario/agent_port_entry.gal'), 'entry scene missing from diff');
  const capsule = resultOf(await callTool(port, 'surdet_delivery_capsule', { label: 'formal stage capsule' }), 'delivery capsule');
  assert(capsule.changeStatus === 'OPEN', 'stage capsule status was not OPEN');
  assert(capsule.projectMutation.occurred === false, 'stage capsule reported a project mutation');
  assert(capsule.projectMutation.beforeRevision === capsule.projectMutation.afterRevision, 'stage capsule revisions differ');
  const failedInvocation = capsule.invocationSummary.records?.find((record) => record.ok === false);
  assert(failedInvocation !== undefined, 'capsule omitted the failed repair invocation');

  if (pendingMutation) {
    resultOf(await callTool(port, 'surdet_scene_create', {
      operationId: 'op-agent-pending', sceneId: 'agent_port_pending', blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', speaker: 'agent_guide', value: '待提交。' }],
    }), 'pending mutation');
  }
  return { changeId, traceId: runtimeA.traceId, runtimePaths: [runtimeA, runtimeB], validation, simulation, trace, diff, capsule, failedInvocation };
}

async function runPreflightLeg({ label, fixture, data, versionNegotiation }) {
  const errors = { protocol: [], stderrUnexpected: [], childCleanupFailures: [] };
  const port = await connectPort({ projectRoot: fixture, policy: 'observe', dataDir: data, versionNegotiation });
  const protocolEra = port.client.getProtocolEra();
  const negotiatedProtocolVersion = port.client.getNegotiatedProtocolVersion();
  let close;
  try {
    const names = await listTools(port);
    assert(names.includes('surdet_session_describe'), `${label} session tool missing`);
    assert(names.includes('surdet_project_inspect'), `${label} inspect tool missing`);
    assert(!names.includes('surdet_change_begin') && !names.includes('surdet_change_commit'), `${label} exposed mutation tool`);
    assert(!names.includes('surdet_delivery_capsule'), `${label} exposed unresumed capsule`);
    resultOf(await callTool(port, 'surdet_session_describe'), `${label} session.describe`);
    resultOf(await callTool(port, 'surdet_project_inspect'), `${label} project.inspect`);
    if (label === 'modern/auto') resultOf(await callTool(port, 'surdet_project_assets'), `${label} project.assets`);
    if (label === 'legacy/2025') {
      assert(protocolEra === 'legacy', `${label} protocol era was ${protocolEra}`);
      assert(negotiatedProtocolVersion === '2025-11-25', `${label} protocol version was ${negotiatedProtocolVersion}`);
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
  return {
    label,
    protocolEra,
    negotiatedProtocolVersion,
    toolsList: true,
    sessionDescribe: true,
    projectInspect: true,
    policyFilter: true,
    stdoutProtocolPurity: close.stdoutProtocolPurity,
    childCleanup: true,
  };
}

async function runPreflight() {
  assert(fs.existsSync(portEntry), `Agent Port launcher missing: ${portEntry}`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave-4-preflight-'));
  try {
    const modernFixture = path.join(directory, 'modern-fixture');
    const modernData = path.join(directory, 'modern-data');
    const legacyFixture = path.join(directory, 'legacy-fixture');
    const legacyData = path.join(directory, 'legacy-data');
    copyStarter(modernFixture);
    copyStarter(legacyFixture);
    fs.mkdirSync(modernData, { recursive: true });
    fs.mkdirSync(legacyData, { recursive: true });
    const modern = await runPreflightLeg({
      label: 'modern/auto', fixture: modernFixture, data: modernData, versionNegotiation: { mode: 'auto' },
    });
    const legacy = await runPreflightLeg({
      label: 'legacy/2025', fixture: legacyFixture, data: legacyData, versionNegotiation: { mode: 'legacy' },
    });
    console.log(JSON.stringify({
      status: 'PASSED', mode: 'preflight', launcher: portEntry,
      modern, legacy, policyFilter: true, stdoutProtocolPurity: true, childCleanup: true,
    }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function runAcceptancePrep() {
  const originalStarterBefore = hashTree(starterRoot);
  const directory = newDesktopAcceptanceDirectory();
  const projectRoot = path.join(directory, 'project');
  const dataDir = path.join(directory, 'agent-data');
  const stageConfigPath = path.join(directory, 'mcp-stage.json');
  const applyTemplatePath = path.join(directory, 'apply-resume-template.json');
  copyStarter(projectRoot);
  fs.mkdirSync(dataDir, { recursive: true });
  const dataBefore = hashTree(dataDir);

  const stageConfig = {
    mcpServers: {
      'Surdet Agent Port': {
        command: process.execPath,
        args: [portEntry, '--project', projectRoot, '--policy', 'stage'],
        env: { SURDET_AGENT_DATA_DIR: dataDir, SURDET_GIT_HEAD: runHead },
      },
    },
  };
  const applyResumeTemplate = {
    schemaVersion: '1.0.0',
    project: projectRoot,
    SURDET_AGENT_DATA_DIR: dataDir,
    policy: 'apply',
    resumeChange: '<CHANGE_ID_REQUIRED_AFTER_OWNER_APPROVAL>',
    status: 'NOT_AUTHORIZED',
  };
  writeJson(stageConfigPath, stageConfig);
  writeJson(applyTemplatePath, applyResumeTemplate);

  const rereadStageConfig = JSON.parse(fs.readFileSync(stageConfigPath, 'utf8'));
  const rereadApplyResumeTemplate = JSON.parse(fs.readFileSync(applyTemplatePath, 'utf8'));
  const stageServer = rereadStageConfig.mcpServers?.['Surdet Agent Port'];
  assert(stageServer !== undefined, 'stage MCP server entry missing');
  const stageProjectArgumentIndex = stageServer.args.indexOf('--project');
  const stageDataDir = stageServer.env?.SURDET_AGENT_DATA_DIR;
  const stageProject = stageServer.args[stageProjectArgumentIndex + 1];
  assert(stageServer.command === process.execPath, 'stage MCP command mismatch');
  assert(path.isAbsolute(stageServer.command), 'stage MCP command must be absolute');
  assert(path.isAbsolute(stageServer.args[0]), 'stage MCP server entry must be absolute');
  assert(stageServer.args.includes('--policy') && stageServer.args[stageServer.args.indexOf('--policy') + 1] === 'stage', 'stage MCP policy mismatch');
  assert(stageProject === projectRoot, 'stage MCP project mismatch');
  assert(path.isAbsolute(stageProject), 'stage MCP project must be absolute');
  assert(stageDataDir === dataDir, 'stage MCP data directory mismatch');
  assert(path.isAbsolute(stageDataDir), 'stage MCP data directory must be absolute');
  assert(!stageServer.args.includes('--resume-change'), 'stage MCP must not include resume-change');
  assert(rereadApplyResumeTemplate.project === projectRoot, 'apply template project mismatch');
  assert(rereadApplyResumeTemplate.SURDET_AGENT_DATA_DIR === dataDir, 'apply template data directory mismatch');
  assert(rereadApplyResumeTemplate.policy === 'apply', 'apply template policy mismatch');
  assert(rereadApplyResumeTemplate.resumeChange === '<CHANGE_ID_REQUIRED_AFTER_OWNER_APPROVAL>', 'apply template resume change placeholder mismatch');
  assert(rereadApplyResumeTemplate.status === 'NOT_AUTHORIZED', 'apply template must remain unauthorized');

  const originalStarterAfter = hashTree(starterRoot);
  const projectFixture = hashTree(projectRoot);
  const dataAfter = hashTree(dataDir);
  const prepRootOutsideRepository = !isWithinPath(repoRoot, directory);
  const prepRootOnDesktop = isWithinPath(path.join(os.homedir(), 'Desktop'), directory);
  const dataDirEmpty = dataAfter.fileCount === 0 && dataAfter.bytes === 0;
  const projectFixtureEqualsStarter = projectFixture.sha256 === originalStarterBefore.sha256;
  const checks = {
    PREP_ROOT_OUTSIDE_REPOSITORY: prepRootOutsideRepository,
    PREP_ROOT_ON_DESKTOP: prepRootOnDesktop,
    PROJECT_ROOT_EXISTS: fs.existsSync(projectRoot),
    DATA_DIR_EXISTS: fs.existsSync(dataDir),
    DATA_DIR_EMPTY: dataDirEmpty,
    STAGE_AND_APPLY_TEMPLATE_PROJECT_IDENTITY_SAME: stageProject === rereadApplyResumeTemplate.project,
    STAGE_AND_APPLY_TEMPLATE_DATA_DIR_SAME: stageDataDir === rereadApplyResumeTemplate.SURDET_AGENT_DATA_DIR,
    STAGE_POLICY: stageServer.args[stageServer.args.indexOf('--policy') + 1],
    APPLY_TEMPLATE_STATUS: rereadApplyResumeTemplate.status,
    TOOLS_CALLED: [],
    CHANGE_CREATED: false,
    ORIGINAL_STARTER_UNCHANGED: originalStarterBefore.sha256 === originalStarterAfter.sha256,
    PROJECT_FIXTURE_EQUALS_STARTER_AT_PREP: projectFixtureEqualsStarter,
  };
  assert(checks.PREP_ROOT_OUTSIDE_REPOSITORY, 'acceptance prep root is inside repository');
  assert(checks.PREP_ROOT_ON_DESKTOP, 'acceptance prep root is not on Desktop');
  assert(checks.PROJECT_ROOT_EXISTS, 'acceptance project root missing');
  assert(checks.DATA_DIR_EXISTS, 'acceptance data directory missing');
  assert(checks.DATA_DIR_EMPTY, 'acceptance data directory is not empty');
  assert(checks.STAGE_AND_APPLY_TEMPLATE_PROJECT_IDENTITY_SAME, 'stage/apply project identity mismatch');
  assert(checks.STAGE_AND_APPLY_TEMPLATE_DATA_DIR_SAME, 'stage/apply data directory mismatch');
  assert(checks.STAGE_POLICY === 'stage', 'stage policy mismatch');
  assert(checks.APPLY_TEMPLATE_STATUS === 'NOT_AUTHORIZED', 'apply template is authorized');
  assert(checks.ORIGINAL_STARTER_UNCHANGED, 'original Starter changed during acceptance preparation');
  assert(checks.PROJECT_FIXTURE_EQUALS_STARTER_AT_PREP, 'acceptance project does not equal Starter at preparation');

  const payload = {
    schemaVersion: '1.0.0', evidenceClass: 'ACCEPTANCE_PREP', status: 'PREPARED', runHead,
    acceptanceRoot: directory, projectRoot, dataDir,
    stageConfigPath, applyTemplatePath,
    originalStarter: { before: originalStarterBefore, after: originalStarterAfter, unchanged: checks.ORIGINAL_STARTER_UNCHANGED },
    projectFixture, dataDirectory: { before: dataBefore, after: dataAfter, empty: checks.DATA_DIR_EMPTY },
    stageConfig: readFileIdentity(stageConfigPath), applyResumeTemplate: readFileIdentity(applyTemplatePath),
    checks, toolsCalled: [], changeCreated: false,
  };
  const artifact = writeArtifact(directory, payload);
  const readback = {
    stageConfig: readFileIdentity(stageConfigPath),
    applyResumeTemplate: readFileIdentity(applyTemplatePath),
    evidence: readFileIdentity(path.join(directory, 'evidence.json')),
    identity: readFileIdentity(artifact.identityPath),
  };
  assert(readback.evidence.bytes === artifact.identity.bytes, 'evidence bytes readback mismatch');
  assert(readback.evidence.sha256 === artifact.identity.sha256, 'evidence sha256 readback mismatch');
  console.log(JSON.stringify({ ...payload, artifactIdentity: artifact.identity, identityPath: artifact.identityPath, readback }));
}

async function runEvidence(modeName) {
  const evidenceClass = modeName === 'formal' ? 'FORMAL' : 'DIAGNOSTIC';
  fs.mkdirSync(artifactRoot, { recursive: true });
  if (modeName === 'formal') {
    const lock = path.join(artifactRoot, 'FORMAL-RUN.lock');
    try {
      fs.writeFileSync(lock, `${runHead}\n`, { flag: 'wx' });
    } catch {
      fail('FORMAL runner refuses a second formal execution');
    }
  }
  const directory = newDirectory(evidenceClass);
  const errors = { protocol: [], domainUnexpected: [], stderrUnexpected: [], unhandledRejections: [], childCleanupFailures: [] };
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
      milestones.push({ node: name, status: 'FAILED', error: String(error) });
      throw error;
    }
  };

  const originalStarterBefore = hashTree(starterRoot);
  const stageFixture = path.join(directory, 'fixtures', 'fixture-stage');
  const applyFixture = path.join(directory, 'fixtures', 'fixture-apply');
  const stageData = path.join(directory, 'data', 'stage');
  const applyData = path.join(directory, 'data', 'apply');
  copyStarter(stageFixture);
  copyStarter(applyFixture);
  fs.mkdirSync(stageData, { recursive: true });
  fs.mkdirSync(applyData, { recursive: true });
  const stageBefore = hashTree(stageFixture);
  const applyBefore = hashTree(applyFixture);
  let stageTools = [];
  let applyTools = [];
  let stageWorkflow;
  let applyWorkflow;
  let stageObserveCapsule;
  let validationRequiredRedLight = false;
  let repeatedCommitCode;
  let applyInspect;
  let applyTimelineReadback;
  let applyTimelineDiskIdentity;
  let applyCommitStatus;
  let projectMutated = 'UNKNOWN';
  let stageClose;
  let applyClose;
  let applyObserveClose;

  try {
    await node('stage-connect-and-discover', async () => {
      const port = await connectPort({ projectRoot: stageFixture, policy: 'stage', dataDir: stageData });
      try {
        stageTools = await listTools(port);
        assert(!stageTools.includes('surdet_change_commit'), 'stage tools exposed change.commit');
        assert(stageTools.includes('surdet_delivery_capsule'), 'stage tools omitted delivery capsule');
        stageWorkflow = await authoringWorkflow(port);
      } finally {
        stageClose = await closePort(port, errors);
      }
    });
    const stageAfter = hashTree(stageFixture);
    assert(stageBefore.sha256 === stageAfter.sha256, 'stage fixture changed on disk');

    await node('observe-resume-readback', async () => {
      const port = await connectPort({ projectRoot: stageFixture, policy: 'observe', resumeChangeId: stageWorkflow.changeId, dataDir: stageData });
      try {
        const names = await listTools(port);
        assert(names.includes('surdet_delivery_capsule'), 'resumed observe omitted capsule');
        assert(!names.includes('surdet_scene_create'), 'observe exposed scene mutation');
        stageObserveCapsule = await observeReadback(port, stageWorkflow.traceId);
      } finally {
        await closePort(port, errors);
      }
    });

    await node('apply-stage-and-resume', async () => {
      const stagePort = await connectPort({ projectRoot: applyFixture, policy: 'stage', dataDir: applyData });
      try {
        applyWorkflow = await authoringWorkflow(stagePort, { pendingMutation: true });
      } finally {
        await closePort(stagePort, errors);
      }
      const applyPort = await connectPort({ projectRoot: applyFixture, policy: 'apply', resumeChangeId: applyWorkflow.changeId, dataDir: applyData });
      try {
        applyTools = await listTools(applyPort);
        assert(applyTools.includes('surdet_change_commit') && applyTools.includes('surdet_delivery_capsule'), 'apply tools missing commit/capsule');
        const staleCommit = expectedFailure(await callTool(applyPort, 'surdet_change_commit'), 'VALIDATION_REQUIRED', 'resume commit freshness gate');
        validationRequiredRedLight = staleCommit.error.code === 'VALIDATION_REQUIRED';
        const validation = resultOf(await callTool(applyPort, 'surdet_project_validate'), 'apply project.validate');
        const simulation = resultOf(await callTool(applyPort, 'surdet_project_simulate', { sceneId: 'agent_port_entry' }), 'apply project.simulate');
        const runtimeA = resultOf(await callTool(applyPort, 'surdet_runtime_run_from', { sceneId: 'agent_port_entry', choices: [0], seed: 801 }), 'apply runtime A');
        const runtimeB = resultOf(await callTool(applyPort, 'surdet_runtime_run_from', { sceneId: 'agent_port_entry', choices: [1], seed: 802 }), 'apply runtime B');
        const trace = resultOf(await callTool(applyPort, 'surdet_runtime_read_trace', { traceId: runtimeB.traceId }), 'apply runtime.read-trace');
        const diff = resultOf(await callTool(applyPort, 'surdet_change_diff'), 'apply change.diff');
        const committed = resultOf(await callTool(applyPort, 'surdet_change_commit'), 'apply change.commit');
        assert(committed.status === 'COMMITTED', 'apply commit did not commit');
        applyCommitStatus = committed.status;
        projectMutated = true;
        const repeated = expectedFailure(await callTool(applyPort, 'surdet_change_commit'), ['SESSION_STATE_INVALID', 'CHANGE_NOT_OPEN'], 'repeated apply commit');
        repeatedCommitCode = repeated.error.code;
        const capsule = resultOf(await callTool(applyPort, 'surdet_delivery_capsule', { label: 'formal committed capsule' }), 'apply delivery capsule');
        assert(capsule.changeStatus === 'COMMITTED', 'apply capsule status was not COMMITTED');
        assert(capsule.projectMutation.occurred === true && capsule.projectMutation.expectedByPolicy === true, 'apply capsule mutation proof failed');
        applyWorkflow = { ...applyWorkflow, validation, simulation, runtimePaths: [runtimeA, runtimeB], trace, diff, capsule, committed };
        applyInspect = resultOf(await callTool(applyPort, 'surdet_project_inspect'), 'apply project.inspect after commit');
        assert(applyInspect.entryScene === 'agent_port_entry', 'committed project inspect entryScene mismatch');
        assert(applyInspect.scenes.some((scene) => scene.id === 'agent_port_entry'), 'committed project inspect omitted agent_port_entry scene');
        assert(applyInspect.scenes.some((scene) => scene.id === 'agent_port_result'), 'committed project inspect omitted agent_port_result scene');
        assert(applyInspect.variables.some((variable) => variable.name === 'agent.route'), 'committed project inspect omitted agent.route variable');
        assert(applyInspect.characters.some((character) => character.id === 'agent_guide'), 'committed project inspect omitted agent_guide character');
      } finally {
        applyClose = await closePort(applyPort, errors);
      }

      const observePort = await connectPort({ projectRoot: applyFixture, policy: 'observe', dataDir: applyData });
      try {
        const observeTools = await listTools(observePort);
        assert(!observeTools.includes('surdet_change_begin') && !observeTools.includes('surdet_change_commit'), 'fresh observe exposed mutation tools');
        const timeline = resultOf(await callTool(observePort, 'surdet_object_inspect', { objectRef: 'timeline:agent_port_intro' }), 'fresh observe timeline object.inspect');
        assert(timeline.kind === 'timeline', 'fresh timeline object.inspect kind mismatch');
        assert(timeline.objectRef === 'timeline:agent_port_intro', 'fresh timeline object.inspect objectRef mismatch');
        assert(timeline.details?.id === 'agent_port_intro', 'fresh timeline object.inspect details id mismatch');
        assert(timeline.source?.path === 'content/timelines/agent_port_intro.json', 'fresh timeline object.inspect source path mismatch');
        assert(typeof timeline.fingerprint === 'string' && timeline.fingerprint.length > 0, 'fresh timeline object.inspect fingerprint missing');
        applyTimelineReadback = {
          kind: timeline.kind,
          objectRef: timeline.objectRef,
          detailsId: timeline.details.id,
          sourcePath: timeline.source.path,
          fingerprint: timeline.fingerprint,
        };
      } finally {
        applyObserveClose = await closePort(observePort, errors);
      }

      const timelinePath = path.join(applyFixture, 'content/timelines/agent_port_intro.json');
      assert(fs.existsSync(timelinePath), 'committed timeline file missing from apply fixture');
      const timelineBytes = fs.readFileSync(timelinePath);
      const timelineJson = JSON.parse(timelineBytes.toString('utf8'));
      assert(timelineJson.id === 'agent_port_intro', 'committed timeline disk id mismatch');
      const timelineRelativePath = path.relative(applyFixture, timelinePath).split(path.sep).join('/');
      applyTimelineDiskIdentity = {
        path: timelineRelativePath,
        bytes: timelineBytes.byteLength,
        sha256: sha256(timelineBytes),
        jsonId: timelineJson.id,
      };
      assert(applyTimelineDiskIdentity.sha256.length > 0, 'committed timeline disk sha256 missing');
    });

    const stageAfterFinal = hashTree(stageFixture);
    const applyAfter = hashTree(applyFixture);
    const originalStarterAfter = hashTree(starterRoot);
    assert(originalStarterBefore.sha256 === originalStarterAfter.sha256, 'original Starter changed');
    assert(stageBefore.sha256 === stageAfterFinal.sha256, 'stage fixture changed after observe readback');
    assert(applyBefore.sha256 !== applyAfter.sha256, 'apply fixture did not change after commit');
    assert(projectMutated === true, 'committed apply projectMutated was not true');
    assert(validationRequiredRedLight, 'resume validation-required red light was not observed');
    const payload = {
      schemaVersion: '1.0.0', evidenceClass, status: 'PASSED', runHead, projectMutated,
      contractVersion: '1.0.0', engineVersion: process.env.SURDET_ENGINE_VERSION ?? '0.1.0',
      launcher: { entry: 'packages/cli/dist/agent-port/main.js', transport: 'stdio', sdkServer: '2.0.0', sdkClient: '2.0.0', legacy: 'reject' },
      stage: {
        policy: 'stage', toolNames: stageTools, changeId: stageWorkflow.changeId,
        projectBeforeSha256: stageBefore.sha256, projectAfterSha256: stageAfterFinal.sha256, projectUnchanged: stageBefore.sha256 === stageAfterFinal.sha256,
        capsule: stageWorkflow.capsule, observeCapsule: stageObserveCapsule, stdoutProtocolPurity: stageClose?.stdoutProtocolPurity === true,
      },
      apply: {
        policy: 'apply', toolNames: applyTools, resumedChangeId: applyWorkflow.changeId, validationRequiredRedLight,
        repeatedCommitCode, committed: applyWorkflow.committed?.status === 'COMMITTED',
        projectBeforeSha256: applyBefore.sha256, projectAfterSha256: applyAfter.sha256, capsule: applyWorkflow.capsule,
        projectMutated, inspect: applyInspect, freshObserveTimeline: applyTimelineReadback, timelineDisk: applyTimelineDiskIdentity,
        stdoutProtocolPurity: applyClose?.stdoutProtocolPurity === true && applyObserveClose?.stdoutProtocolPurity === true,
      },
      repairChain: {
        errorCode: 'OBJECT_PRECONDITION_FAILED', retryDisposition: 'after-inspect', repairTool: 'surdet_object_inspect', repaired: true,
        staleErrorCode: 'OBJECT_REF_STALE', failedInvocationId: stageWorkflow.failedInvocation.invocationId,
      },
      validation: { stage: stageWorkflow.validation, apply: applyWorkflow.validation },
      simulation: { stage: stageWorkflow.simulation, apply: applyWorkflow.simulation },
      runtimePaths: [...stageWorkflow.runtimePaths, ...applyWorkflow.runtimePaths],
      traces: [stageWorkflow.trace, applyWorkflow.trace],
      diff: { stage: stageWorkflow.diff, apply: applyWorkflow.diff },
      originalStarter: { before: originalStarterBefore, after: originalStarterAfter, unchanged: originalStarterBefore.sha256 === originalStarterAfter.sha256 },
      fixtures: { stage: { before: stageBefore, after: stageAfterFinal }, apply: { before: applyBefore, after: applyAfter } },
      errors, milestones, lastPassedNode, firstFailedNode,
      childCleanup: { stage: stageClose, apply: applyClose, applyObserve: applyObserveClose },
      manualAcceptance: { externalAgentLowContext: 'NOT_RUN', ownerEditorPreview: 'NOT_RUN' },
    };
    const artifact = writeArtifact(directory, payload);
    console.log(JSON.stringify({ ...payload, artifactIdentity: artifact.identity, identityPath: artifact.identityPath }));
  } catch (error) {
    const applyAfterOnFailure = fs.existsSync(applyFixture) ? hashTree(applyFixture) : null;
    if (applyCommitStatus === 'COMMITTED') projectMutated = true;
    else if (applyAfterOnFailure !== null) projectMutated = applyBefore.sha256 !== applyAfterOnFailure.sha256;
    const failure = {
      schemaVersion: '1.0.0', evidenceClass, status: 'FAILED', runHead,
      lastPassedNode, firstFailedNode: firstFailedNode ?? currentNode, failure: String(error), projectMutated,
      applyCommitStatus, applyBefore, applyAfter: applyAfterOnFailure, applyInspect, freshObserveTimeline: applyTimelineReadback, timelineDisk: applyTimelineDiskIdentity,
      errors, milestones, nextAllowedAction: 'TASK_9_REVIEW', notRerun: true,
    };
    const artifact = writeArtifact(directory, failure);
    console.error(JSON.stringify({ ...failure, artifactIdentity: artifact.identity, identityPath: artifact.identityPath }));
    process.exitCode = 1;
  }
}

async function main() {
  if (mode === undefined || !MODES.has(mode)) {
    console.error('Usage: node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight|diagnostic|formal|acceptance-prep');
    process.exitCode = 1;
    return;
  }
  if (mode === 'preflight') return runPreflight();
  if (mode === 'acceptance-prep') return runAcceptancePrep();
  return runEvidence(mode);
}

void main().catch((error) => {
  console.error(`Agent Port Wave 4 runner failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
