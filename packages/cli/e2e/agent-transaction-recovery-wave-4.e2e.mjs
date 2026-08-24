import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const MODES = new Set(['preflight', 'diagnostic', 'formal']);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '../../..');
const portEntry = path.join(repoRoot, 'packages/cli/dist/agent-port/main.js');
const starterRoot = path.join(repoRoot, 'examples/starter');
const runHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined;
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-transaction-wave4-'));
const artifactDirectory = path.join(runRoot, mode ?? 'invalid');
const activePorts = new Set();
const childProcesses = [];
const dataDirectories = new Set();
const harness = {
  protocol: [],
  stderrUnexpected: [],
  childCleanupFailures: [],
  textChecks: 0,
};
let modulesPromise;
const progress = {
  currentNode: 'initialization',
  lastPassedNode: 'none',
  firstFailedNode: null,
  milestones: [],
};

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
  if (!fs.existsSync(root)) {
    return { path: root, fileCount: 0, bytes: 0, sha256: sha256(Buffer.alloc(0)), files };
  }
  function walk(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules' || (skipBuild && entry.name === 'dist')) continue;
      if (entry.name === '.vite' || entry.name.startsWith('.surdet-')) continue;
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

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function assertTempPath(candidate, label) {
  assert(isWithin(os.tmpdir(), candidate), `${label} is not below the system Temp directory: ${candidate}`);
  assert(!isWithin(repoRoot, candidate), `${label} is inside the repository: ${candidate}`);
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

function writeJson(file, value, flag = 'w') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag });
}

function fileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { path: file, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function writeArtifact(value) {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const evidencePath = path.join(artifactDirectory, 'evidence.json');
  const identityPath = path.join(artifactDirectory, 'identity.json');
  writeJson(evidencePath, value, 'wx');
  const identity = fileIdentity(evidencePath);
  writeJson(identityPath, identity, 'wx');
  const reread = fs.readFileSync(evidencePath);
  assert(reread.byteLength === identity.bytes, 'evidence bytes readback mismatch');
  assert(sha256(reread) === identity.sha256, 'evidence sha256 readback mismatch');
  return { evidencePath, identityPath, identity };
}

function resultOf(envelope, label) {
  assert(envelope && envelope.ok === true, `${label} failed: ${JSON.stringify(envelope?.error ?? envelope)}`);
  return envelope.result;
}

function expectedFailure(envelope, codes, label) {
  assert(envelope && envelope.ok === false, `${label} unexpectedly succeeded`);
  const allowed = Array.isArray(codes) ? codes : [codes];
  assert(allowed.includes(envelope.error?.code), `${label} returned ${envelope.error?.code}; expected ${allowed.join(', ')}`);
  return envelope;
}

function textBlock(response, label) {
  const text = response.content?.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
  assert(typeof text === 'string', `${label} did not return an MCP text block`);
  return text;
}

function compareTextAndStructured(response, label) {
  assert(response.structuredContent && typeof response.structuredContent === 'object', `${label} did not return structuredContent`);
  const text = textBlock(response, label);
  const expected = JSON.stringify(response.structuredContent);
  assert(text === expected, `${label} text envelope is not the complete structured envelope`);
  const parsed = JSON.parse(text);
  assert(JSON.stringify(parsed) === JSON.stringify(response.structuredContent), `${label} parsed text differs from structuredContent`);
  harness.textChecks += 1;
  return response.structuredContent;
}

async function connectPort({ projectRoot, policy, dataDir, resumeChangeId }) {
  assert(fs.existsSync(portEntry), `Agent Port launcher missing: ${portEntry}`);
  dataDirectories.add(path.resolve(dataDir));
  const args = [portEntry, '--project', projectRoot, '--policy', policy];
  if (resumeChangeId !== undefined) args.push('--resume-change', resumeChangeId);
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
  env.SURDET_AGENT_DATA_DIR = dataDir;
  env.SURDET_GIT_HEAD = runHead;
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: repoRoot, env, stderr: 'pipe' });
  const record = { role: `${policy}${resumeChangeId === undefined ? '' : `:${resumeChangeId}`}`, pid: null, exited: false };
  childProcesses.push(record);
  const protocolErrors = [];
  transport.onerror = (error) => protocolErrors.push(String(error?.message ?? error));
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const client = new Client({ name: 'surdet-agent-transaction-wave4', version: '1.0.0' });
  const port = { client, transport, protocolErrors, get stderr() { return stderr; }, record, closed: false };
  activePorts.add(port);
  try {
    await client.connect(transport);
    record.pid = transport.pid;
    return port;
  } catch (error) {
    record.pid = transport.pid;
    await closePort(port);
    throw error;
  }
}

async function closePort(port) {
  if (port.closed) return;
  port.closed = true;
  try {
    await port.client.close();
  } catch (error) {
    harness.childCleanupFailures.push(`client.close: ${String(error)}`);
  }
  try {
    await port.transport.close();
  } catch (error) {
    harness.childCleanupFailures.push(`transport.close: ${String(error)}`);
  }
  if (port.transport.pid !== null) harness.childCleanupFailures.push(`child pid remained: ${port.transport.pid}`);
  port.record.exited = port.transport.pid === null;
  if (port.record.pid === null) port.record.pid = port.transport.pid;
  for (const error of port.protocolErrors) harness.protocol.push(error);
  const unexpected = port.stderr.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Surdet Agent Port ready:'));
  harness.stderrUnexpected.push(...unexpected);
  activePorts.delete(port);
}

async function closeAllPorts() {
  for (const port of [...activePorts]) await closePort(port);
}

function scanActiveLeaseDirectories() {
  const active = [];
  for (const dataDir of [...dataDirectories].sort((a, b) => a.localeCompare(b))) {
    for (const scope of ['changes', 'projects']) {
      const scopeDirectory = path.join(dataDir, '.locks', scope);
      if (!fs.existsSync(scopeDirectory)) continue;
      for (const entry of fs.readdirSync(scopeDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && entry.name.endsWith('.lock')) {
          active.push({ dataDir, scope, path: path.join(scopeDirectory, entry.name) });
        }
      }
    }
  }
  return active;
}

async function evidenceNode(name, action) {
  progress.currentNode = name;
  try {
    const value = await action();
    progress.lastPassedNode = name;
    progress.milestones.push({ node: name, status: 'PASSED' });
    return value;
  } catch (error) {
    if (progress.firstFailedNode === null) progress.firstFailedNode = name;
    progress.milestones.push({ node: name, status: 'FAILED', error: String(error) });
    throw error;
  }
}

async function listTools(port) {
  const response = await port.client.listTools();
  return response.tools.map((tool) => tool.name);
}

async function callTool(port, name, args = {}) {
  const response = await port.client.callTool({ name, arguments: args });
  return compareTextAndStructured(response, name);
}

async function callOk(port, name, args = {}) {
  return resultOf(await callTool(port, name, args), name);
}

async function timedCall(port, name, args = {}) {
  const startedAt = process.hrtime.bigint();
  const envelope = await callTool(port, name, args);
  const endedAt = process.hrtime.bigint();
  return { envelope, startedAt: Number(startedAt), endedAt: Number(endedAt) };
}

function windowsOverlap(left, right) {
  return left.startedAt < right.endedAt && right.startedAt < left.endedAt;
}

async function withDataDir(dataDir, callback) {
  dataDirectories.add(path.resolve(dataDir));
  const previous = process.env.SURDET_AGENT_DATA_DIR;
  process.env.SURDET_AGENT_DATA_DIR = dataDir;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
    else process.env.SURDET_AGENT_DATA_DIR = previous;
  }
}

async function loadModules() {
  if (modulesPromise === undefined) {
    const importDist = (relative) => import(pathToFileURL(path.join(repoRoot, relative)).href);
    modulesPromise = Promise.all([
      importDist('packages/cli/dist/authoring/node-change-store.js'),
      importDist('packages/cli/dist/authoring/node-project-storage.js'),
      importDist('packages/cli/dist/authoring/authoring-service.js'),
      importDist('packages/cli/dist/authoring/node-local-lease.js'),
      importDist('packages/cli/dist/authoring/project-identity.js'),
    ]).then(([store, storage, service, lease, identity]) => ({
      NodeChangeStore: store.NodeChangeStore,
      NodeProjectStorage: storage.NodeProjectStorage,
      AuthoringService: service.AuthoringService,
      NodeLocalLeaseManager: lease.NodeLocalLeaseManager,
      projectIdentityFromRoot: identity.projectIdentityFromRoot,
    }));
  }
  return modulesPromise;
}

async function beginChangeViaPort(projectRoot, dataDir, label) {
  const port = await connectPort({ projectRoot, policy: 'stage', dataDir });
  try {
    const result = await callOk(port, 'surdet_change_begin', {
      intent: `Wave 4 aggregate runner ${label}`,
      acceptanceCriteria: ['multi-process transaction evidence'],
      initiator: 'external-agent',
    });
    assert(typeof result.changeId === 'string' && result.changeId.length > 0, `${label} change.begin returned no changeId`);
    return result.changeId;
  } finally {
    await closePort(port);
  }
}

async function prepareRecoveryChange(projectRoot, dataDir) {
  return withDataDir(dataDir, async () => {
    const { AuthoringService } = await loadModules();
    const service = new AuthoringService();
    const begun = await service.begin(projectRoot, {
      intent: 'Wave 4 interrupted recovery fixture',
      acceptanceCriteria: ['recovery classification'],
      initiator: 'external-agent',
    });
    const changeId = begun.result.changeId;
    await service.sceneCreate(changeId, {
      operationId: 'runner-recovery-scene',
      sceneId: 'recovery_target',
      blocks: [{ kind: 'text', value: '恢复目标。' }],
    });
    await service.variableEnsure(changeId, {
      operationId: 'runner-recovery-variable',
      name: 'runner_recovery_marker',
      type: 'number',
      initial: 1,
    });
    const storage = await (await loadModules()).NodeProjectStorage.open(projectRoot);
    return { changeId, rootIdentity: storage.rootIdentity };
  });
}

function changeDirectory(dataRoot, modules, rootIdentity, changeId) {
  return path.join(dataRoot, modules.projectIdentityFromRoot(rootIdentity), changeId);
}

async function prepareInterruptedJournal(projectRoot, dataDir, changeId, modeName) {
  const { NodeChangeStore, NodeProjectStorage } = await loadModules();
  return withDataDir(dataDir, async () => {
    const storage = await NodeProjectStorage.open(projectRoot);
    const rootIdentity = storage.rootIdentity;
    const stagedIdentities = [];
    let changedPaths = [];
    await NodeChangeStore.withChangeLeaseForProject(changeId, rootIdentity, async (store) => {
      const record = await store.read(changeId);
      if (record === null) throw new Error(`missing recovery record ${changeId}`);
      changedPaths = Object.keys(record.workingFiles)
        .filter((filePath) => record.baseContents[filePath] !== record.workingFiles[filePath])
        .sort((a, b) => a.localeCompare(b));
      assert(changedPaths.length >= 2, `recovery fixture needs two changed files, got ${changedPaths.length}`);
      const files = [];
      for (const filePath of changedPaths) {
        const staged = await storage.stageText(filePath, record.workingFiles[filePath], changeId);
        stagedIdentities.push(staged.stagedIdentity);
        files.push({
          path: filePath,
          ...(record.baseFiles[filePath] === undefined ? {} : { originalSha256: record.baseFiles[filePath].sha256 }),
          targetSha256: staged.sha256,
          stagedIdentity: staged.stagedIdentity,
          replaced: false,
          restored: false,
        });
      }
      const write = async (journalVersion, status) => {
        await store.writeJournal(changeId, {
          formatVersion: 2,
          journalVersion,
          changeId,
          recordVersionAtCommitStart: record.recordVersion,
          projectRevisionAtCommitStart: record.baseRevision,
          status,
          files: files.map((entry) => ({ ...entry })),
        });
      };
      await write(1, 'STAGING');
      if (modeName === 'staging') return;
      await write(2, 'REPLACING');
      if (modeName === 'replacing') {
        await storage.replaceFromStage(files[0].path, files[0].stagedIdentity);
        files[0].replaced = true;
        await write(3, 'REPLACING');
        return;
      }
      for (const [index, entry] of files.entries()) {
        await storage.replaceFromStage(entry.path, entry.stagedIdentity);
        entry.replaced = true;
        await write(index + 3, 'REPLACING');
      }
      await write(files.length + 3, 'COMMITTED');
    });
    return { rootIdentity, changedPaths, stagedIdentities };
  });
}

async function recoverFixture(label, modeName, runDirectory) {
  const projectRoot = path.join(runDirectory, 'project');
  const dataDir = path.join(runDirectory, 'data');
  copyStarter(projectRoot);
  fs.mkdirSync(dataDir, { recursive: true });
  const prepared = await prepareRecoveryChange(projectRoot, dataDir);
  await prepareInterruptedJournal(projectRoot, dataDir, prepared.changeId, modeName === 'replacing' ? 'replacing' : modeName);
  const { projectIdentityFromRoot } = await loadModules();
  const changeDir = changeDirectory(dataDir, await loadModules(), prepared.rootIdentity, prepared.changeId);
  let unexpectedBeforeProject;
  let unexpectedBeforeChange;
  if (modeName === 'unexpected') {
    const first = prepared.rootIdentity === undefined ? undefined : (await loadModules()).NodeProjectStorage;
    void first;
    const projectStorage = await (await loadModules()).NodeProjectStorage.open(projectRoot);
    const firstPath = prepared.changedPaths?.[0];
    assert(typeof firstPath === 'string', 'unexpected recovery fixture has no first path');
    fs.writeFileSync(path.join(projectRoot, firstPath), Buffer.from('unexpected bytes from aggregate runner\n', 'utf8'));
    unexpectedBeforeProject = hashTree(projectRoot);
    unexpectedBeforeChange = hashTree(changeDir, { skipBuild: false });
  }
  const port = await connectPort({ projectRoot, policy: 'apply', dataDir, resumeChangeId: prepared.changeId });
  let inspected;
  let executed;
  try {
    inspected = await callTool(port, 'surdet_change_recovery_inspect');
    const inspection = resultOf(inspected, `${label} recovery.inspect`);
    if (modeName === 'staging') assert(inspection.disposition === 'REOPEN_OPEN', `${label} disposition ${inspection.disposition}`);
    if (modeName === 'replacing') assert(inspection.disposition === 'ROLL_BACK_TO_BASE', `${label} disposition ${inspection.disposition}`);
    if (modeName === 'committed') assert(inspection.disposition === 'FINALIZE_COMMITTED', `${label} disposition ${inspection.disposition}`);
    if (modeName === 'unexpected') assert(inspection.disposition === 'MANUAL_RECOVERY_REQUIRED', `${label} disposition ${inspection.disposition}`);
    if (modeName === 'unexpected') {
      executed = await callTool(port, 'surdet_change_recovery_execute', {
        operationId: `runner-recovery-${label}-execute`,
        recoveryToken: inspection.recoveryToken,
      });
      expectedFailure(executed, 'RECOVERY_AMBIGUOUS', `${label} recovery.execute`);
    } else {
      executed = await callTool(port, 'surdet_change_recovery_execute', {
        operationId: `runner-recovery-${label}-execute`,
        recoveryToken: inspection.recoveryToken,
      });
      const result = resultOf(executed, `${label} recovery.execute`);
      if (modeName === 'committed') assert(result.status === 'COMMITTED', `${label} did not finalize COMMITTED`);
      else assert(result.status === 'OPEN', `${label} did not reopen OPEN`);
    }
  } finally {
    await closePort(port);
  }
  const { NodeChangeStore } = await loadModules();
  const record = await withDataDir(dataDir, async () => (
    (await NodeChangeStore.openForProject(prepared.changeId, prepared.rootIdentity, { allowTerminal: true, allowStale: true }))?.record
  ));
  assert(record !== undefined, `${label} recovery record disappeared`);
  const projectAfter = hashTree(projectRoot);
  if (modeName === 'unexpected') {
    assert(JSON.stringify(projectAfter) === JSON.stringify(unexpectedBeforeProject), `${label} project bytes changed during manual recovery`);
    assert(JSON.stringify(hashTree(changeDir, { skipBuild: false })) === JSON.stringify(unexpectedBeforeChange), `${label} change bytes changed during manual recovery`);
  }
  return {
    label,
    inspect: { disposition: resultOf(inspected, `${label} recovery.inspect`).disposition, manualRecoveryRequired: resultOf(inspected, `${label} recovery.inspect`).manualRecoveryRequired },
    execute: executed.ok === true ? { ok: true, status: resultOf(executed, `${label} recovery.execute`).status } : { ok: false, code: executed.error.code },
    finalStatus: record.status,
    projectUnchangedForManual: modeName === 'unexpected',
    projectTreeAfter: projectAfter,
  };
}

async function runPreflight() {
  assert(fs.existsSync(portEntry), `Agent Port launcher missing: ${portEntry}`);
  assert(fs.existsSync(starterRoot), `Starter root missing: ${starterRoot}`);
  const builds = [];
  const npm = process.platform === 'win32' ? 'npm' : 'npm';
  for (const workspace of ['@surdet/authoring', '@surdet/cli']) {
    try {
      const command = `${npm} run build -w ${workspace}`;
      const buildCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : npm;
      const buildArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['run', 'build', '-w', workspace];
      execFileSync(buildCommand, buildArgs, { cwd: repoRoot, stdio: 'pipe' });
      builds.push({ workspace, exitCode: 0 });
    } catch (error) {
      builds.push({ workspace, exitCode: error.status ?? 1, output: String(error.stdout ?? ''), error: String(error.stderr ?? error.message ?? error) });
      throw new Error(`preflight build failed for ${workspace}`);
    }
  }
  const fixture = path.join(runRoot, 'preflight', 'project');
  const dataDir = path.join(runRoot, 'preflight', 'data');
  copyStarter(fixture);
  fs.mkdirSync(dataDir, { recursive: true });
  assertTempPath(fixture, 'preflight fixture');
  assertTempPath(dataDir, 'preflight data');
  const projectBefore = hashTree(fixture);
  const dataBefore = hashTree(dataDir, { skipBuild: false });
  const starterBefore = hashTree(starterRoot);
  const port = await connectPort({ projectRoot: fixture, policy: 'observe', dataDir });
  let tools;
  try {
    tools = await listTools(port);
    assert(tools.includes('surdet_session_describe'), 'preflight session.describe missing');
    assert(tools.includes('surdet_project_inspect'), 'preflight project.inspect missing');
    assert(tools.includes('surdet_change_recovery_inspect'), 'preflight recovery.inspect missing');
    assert(!tools.includes('surdet_change_begin'), 'preflight exposed mutation capability');
    assert(!tools.includes('surdet_change_recovery_execute'), 'preflight exposed apply-only recovery execute');
    assert(!tools.includes('surdet_delivery_capsule'), 'preflight exposed unresumed delivery capsule');
    resultOf(await callTool(port, 'surdet_session_describe'), 'preflight session.describe');
    resultOf(await callTool(port, 'surdet_project_inspect'), 'preflight project.inspect');
    resultOf(await callTool(port, 'surdet_capabilities_describe'), 'preflight capabilities.describe');
  } finally {
    await closePort(port);
  }
  const projectAfter = hashTree(fixture);
  const dataAfter = hashTree(dataDir, { skipBuild: false });
  const starterAfter = hashTree(starterRoot);
  assert(JSON.stringify(projectBefore) === JSON.stringify(projectAfter), 'preflight mutated copied project');
  assert(dataAfter.fileCount === 0 && dataAfter.bytes === 0, 'preflight data directory is not empty after cleanup');
  assert(JSON.stringify(starterBefore) === JSON.stringify(starterAfter), 'preflight modified original Starter');
  assert(harness.protocol.length === 0, `preflight MCP protocol errors: ${harness.protocol.join('; ')}`);
  assert(harness.stderrUnexpected.length === 0, `preflight unexpected stderr: ${harness.stderrUnexpected.join('; ')}`);
  assert(harness.childCleanupFailures.length === 0, `preflight child cleanup failures: ${harness.childCleanupFailures.join('; ')}`);
  const activeLeases = scanActiveLeaseDirectories();
  assert(activeLeases.length === 0, `preflight left active lease directories: ${JSON.stringify(activeLeases)}`);
  const evidence = {
    schemaVersion: '1.0.0',
    status: 'PREFLIGHT_PASSED',
    evidenceClass: 'PREFLIGHT',
    runHead,
    projectRoot: fixture,
    dataDir,
    projectTreeBefore: projectBefore,
    projectTreeAfter: projectAfter,
    sameChange: { operations: [], recordVersions: [], workingRevision: 0, invocations: [] },
    differentChanges: { stageOverlapObserved: false, commitOverlapObserved: false, winner: null, staleLoser: null },
    lease: { liveBlocked: false, orphanTakenOver: false, foreignHostBlocked: false, corruptBlocked: false, released: true },
    recovery: {},
    mcp: { inspectVisible: true, executePolicyBlocked: true, executeApplyPassed: false, textEqualsStructured: harness.textChecks > 0 },
    errors: [],
    childProcesses,
    cleanup: { timersStopped: true, childrenExited: childProcesses.every((child) => child.exited), locksReleased: activeLeases.length === 0, activeLeaseDirectories: activeLeases },
    builds,
    dataBefore,
    dataAfter,
    tools,
  };
  return evidence;
}

async function runSameChange(directory) {
  const projectRoot = path.join(directory, 'project');
  const dataDir = path.join(directory, 'data');
  copyStarter(projectRoot);
  fs.mkdirSync(dataDir, { recursive: true });
  const before = hashTree(projectRoot);
  const changeId = await beginChangeViaPort(projectRoot, dataDir, 'same-change');
  const first = await connectPort({ projectRoot, policy: 'stage', dataDir, resumeChangeId: changeId });
  const second = await connectPort({ projectRoot, policy: 'stage', dataDir, resumeChangeId: changeId });
  let left;
  let right;
  try {
    [left, right] = await Promise.all([
      timedCall(first, 'surdet_variable_ensure', { operationId: 'runner-same-a', name: 'runner_same_a', type: 'number', initial: 1 }),
      timedCall(second, 'surdet_variable_ensure', { operationId: 'runner-same-b', name: 'runner_same_b', type: 'number', initial: 2 }),
    ]);
  } finally {
    await Promise.all([closePort(first), closePort(second)]);
  }
  resultOf(left.envelope, 'same-change mutation A');
  resultOf(right.envelope, 'same-change mutation B');
  assert(windowsOverlap(left, right), 'same-change mutation call windows did not overlap');
  const { NodeChangeStore, NodeProjectStorage } = await loadModules();
  const facts = await withDataDir(dataDir, async () => {
    const storage = await NodeProjectStorage.open(projectRoot);
    const opened = await NodeChangeStore.openForProject(changeId, storage.rootIdentity, { allowStale: true });
    assert(opened !== null, 'same-change record missing');
    return { record: opened.record, invocations: await opened.store.readInvocations(changeId) };
  });
  const operations = Object.keys(facts.record.operations).sort();
  const mutationInvocations = facts.invocations.filter((item) => typeof item.operationId === 'string');
  assert(operations.includes('runner-same-a') && operations.includes('runner-same-b'), 'same-change lost one operation');
  assert(facts.record.workingRevision === 2, `same-change workingRevision was ${facts.record.workingRevision}`);
  assert(mutationInvocations.length === 2, `same-change mutation invocation count was ${mutationInvocations.length}`);
  assert(JSON.stringify(before) === JSON.stringify(hashTree(projectRoot)), 'same-change stage mutated project tree');
  return {
    projectRoot,
    dataDir,
    changeId,
    operations,
    recordVersions: [0, 1, facts.record.recordVersion],
    workingRevision: facts.record.workingRevision,
    invocations: facts.invocations.map((item) => ({ capability: item.capability, operationId: item.operationId, ok: item.ok })).sort((a, b) => String(a.operationId ?? '').localeCompare(String(b.operationId ?? ''))),
    mutationWindowsOverlap: windowsOverlap(left, right),
  };
}

async function runDifferentChanges(directory) {
  const projectRoot = path.join(directory, 'project');
  const dataDir = path.join(directory, 'data');
  copyStarter(projectRoot);
  const probePath = path.join(projectRoot, 'content', 'scenario', 'transaction_runtime_probe.gal');
  const probeContent = '@scene transaction_runtime_probe\n事务运行证据。\n@end\n';
  for (const forbidden of ['@choice', '@jump', '@call', '@exp']) {
    assert(!probeContent.includes(forbidden), `transaction runtime probe contains forbidden token: ${forbidden}`);
  }
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  fs.writeFileSync(probePath, probeContent, 'utf8');
  fs.mkdirSync(dataDir, { recursive: true });
  const before = hashTree(projectRoot);
  const alpha = await beginChangeViaPort(projectRoot, dataDir, 'different-alpha');
  const beta = await beginChangeViaPort(projectRoot, dataDir, 'different-beta');
  const alphaStage = await connectPort({ projectRoot, policy: 'stage', dataDir, resumeChangeId: alpha });
  const betaStage = await connectPort({ projectRoot, policy: 'stage', dataDir, resumeChangeId: beta });
  let alphaMutation;
  let betaMutation;
  try {
    [alphaMutation, betaMutation] = await Promise.all([
      timedCall(alphaStage, 'surdet_variable_ensure', { operationId: 'runner-different-alpha', name: 'runner_different_alpha', type: 'number', initial: 11 }),
      timedCall(betaStage, 'surdet_variable_ensure', { operationId: 'runner-different-beta', name: 'runner_different_beta', type: 'number', initial: 22 }),
    ]);
    resultOf(alphaMutation.envelope, 'different alpha stage mutation');
    resultOf(betaMutation.envelope, 'different beta stage mutation');
    for (const [port, seed] of [[alphaStage, 901], [betaStage, 902]]) {
      const validation = await callOk(port, 'surdet_project_validate');
      assert(validation.ok === true, 'different change validation failed');
      const simulation = await callOk(port, 'surdet_project_simulate', { sceneId: 'transaction_runtime_probe', seed });
      assert(simulation.status === 'passed', 'different change simulation failed');
      const runtime = await callOk(port, 'surdet_runtime_run_from', { sceneId: 'transaction_runtime_probe', choices: [], seed });
      assert(runtime.status === 'passed', 'different change runtime failed');
      await callOk(port, 'surdet_change_diff');
    }
  } finally {
    await Promise.all([closePort(alphaStage), closePort(betaStage)]);
  }
  const stageOverlapObserved = windowsOverlap(alphaMutation, betaMutation);
  assert(stageOverlapObserved, 'different change stage mutation windows did not overlap');
  const alphaApply = await connectPort({ projectRoot, policy: 'apply', dataDir, resumeChangeId: alpha });
  const betaApply = await connectPort({ projectRoot, policy: 'apply', dataDir, resumeChangeId: beta });
  let alphaCommit;
  let betaCommit;
  try {
    [alphaCommit, betaCommit] = await Promise.all([
      timedCall(alphaApply, 'surdet_change_commit'),
      timedCall(betaApply, 'surdet_change_commit'),
    ]);
  } finally {
    await Promise.all([closePort(alphaApply), closePort(betaApply)]);
  }
  const commitOverlapObserved = windowsOverlap(alphaCommit, betaCommit);
  assert(commitOverlapObserved, 'different change commit request windows did not overlap');
  const alphaWon = alphaCommit.envelope.ok === true;
  const betaWon = betaCommit.envelope.ok === true;
  assert(alphaWon !== betaWon, `different changes commit outcomes were ${alphaWon}/${betaWon}`);
  const winner = alphaWon ? alpha : beta;
  const staleLoser = alphaWon ? beta : alpha;
  const winnerCommit = alphaWon ? alphaCommit : betaCommit;
  const loserCommit = alphaWon ? betaCommit : alphaCommit;
  assert(loserCommit.envelope.error?.code === 'PROJECT_CHANGED_SINCE_BEGIN', `loser commit error was ${loserCommit.envelope.error?.code}`);
  const { NodeChangeStore, NodeProjectStorage } = await loadModules();
  const statuses = await withDataDir(dataDir, async () => {
    const storage = await NodeProjectStorage.open(projectRoot);
    const winnerRecord = (await NodeChangeStore.openForProject(winner, storage.rootIdentity, { allowTerminal: true, allowStale: true }))?.record;
    const loserRecord = (await NodeChangeStore.openForProject(staleLoser, storage.rootIdentity, { allowTerminal: true, allowStale: true }))?.record;
    assert(winnerRecord?.status === 'COMMITTED', `winner status was ${winnerRecord?.status}`);
    assert(loserRecord?.status === 'STALE', `loser status was ${loserRecord?.status}`);
    return { winner: winnerRecord.status, staleLoser: loserRecord.status };
  });
  const projectAfter = hashTree(projectRoot);
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'game.config.json'), 'utf8'));
  const winnerName = alphaWon ? 'runner_different_alpha' : 'runner_different_beta';
  const loserName = alphaWon ? 'runner_different_beta' : 'runner_different_alpha';
  assert(config.variables?.[winnerName] !== undefined, 'winner variable is absent from committed project');
  assert(config.variables?.[loserName] === undefined, 'stale loser variable reached committed project');
  const changedPaths = projectAfter.files.filter((file) => {
    const old = before.files.find((candidate) => candidate.path === file.path);
    return old === undefined || old.sha256 !== file.sha256 || old.bytes !== file.bytes;
  }).map((file) => file.path);
  assert(changedPaths.length === 1 && changedPaths[0] === 'game.config.json', `unexpected final project paths: ${changedPaths.join(', ')}`);
  return {
    projectRoot,
    dataDir,
    stageOverlapObserved,
    stageWindows: { alpha: alphaMutation, beta: betaMutation },
    commitOverlapObserved,
    commitWindows: { alpha: alphaCommit, beta: betaCommit },
    winner,
    staleLoser,
    statuses,
    winnerCommit: winnerCommit.envelope.result,
    loserError: loserCommit.envelope.error,
    projectTreeBefore: before,
    projectTreeAfter: projectAfter,
  };
}

async function runLeaseMatrix(directory) {
  const { NodeLocalLeaseManager } = await loadModules();
  const dataRoot = path.join(directory, 'data');
  dataDirectories.add(path.resolve(dataRoot));
  fs.mkdirSync(dataRoot, { recursive: true });
  const noTimer = () => () => undefined;
  let now = 1_000;
  const managerA = new NodeLocalLeaseManager(dataRoot, { now: () => now, hostname: () => 'wave-host-a', pid: () => 101, isProcessAlive: () => true, scheduleHeartbeat: noTimer });
  const managerB = new NodeLocalLeaseManager(dataRoot, { now: () => now, hostname: () => 'wave-host-a', pid: () => 102, isProcessAlive: () => true, scheduleHeartbeat: noTimer });
  const live = await managerA.acquire({ scope: 'change', resourceId: 'live-change' });
  let liveBlocked = false;
  try {
    await managerB.acquire({ scope: 'change', resourceId: 'live-change' });
  } catch (error) {
    liveBlocked = error?.code === 'CHANGE_BUSY';
  }
  assert(liveBlocked, 'live change lease was not blocked');
  await live.release();
  assert((await managerA.inspect('change', 'live-change')).state === 'free', 'live lease did not release');

  const orphanOld = await managerA.acquire({ scope: 'change', resourceId: 'orphan-change' });
  void orphanOld;
  now = 20_001;
  const orphanNew = new NodeLocalLeaseManager(dataRoot, { now: () => now, hostname: () => 'wave-host-a', pid: () => 103, isProcessAlive: () => false, scheduleHeartbeat: noTimer });
  const taken = await orphanNew.acquire({ scope: 'change', resourceId: 'orphan-change' });
  const staleDirectory = path.join(dataRoot, '.locks', 'stale');
  const orphanTakenOver = fs.existsSync(staleDirectory) && fs.readdirSync(staleDirectory).length > 0;
  await taken.release();
  assert(orphanTakenOver, 'orphan lease was not quarantined');

  now = 30_000;
  const foreignOld = new NodeLocalLeaseManager(dataRoot, { now: () => now, hostname: () => 'wave-host-a', pid: () => 104, isProcessAlive: () => false, scheduleHeartbeat: noTimer });
  const foreign = await foreignOld.acquire({ scope: 'change', resourceId: 'foreign-change' });
  now = 50_001;
  const foreignNew = new NodeLocalLeaseManager(dataRoot, { now: () => now, hostname: () => 'wave-host-b', pid: () => 105, isProcessAlive: () => false, scheduleHeartbeat: noTimer });
  let foreignHostBlocked = false;
  try {
    await foreignNew.acquire({ scope: 'change', resourceId: 'foreign-change' });
  } catch (error) {
    foreignHostBlocked = error?.code === 'CHANGE_BUSY';
  }
  assert(foreignHostBlocked, 'foreign-host lease was not blocked');
  assert((await foreignNew.inspect('change', 'foreign-change')).state === 'foreign-host', 'foreign-host inspection state was not preserved');
  await foreign.release();

  const corruptDirectory = path.join(dataRoot, '.locks', 'changes', 'corrupt-change.lock');
  fs.mkdirSync(corruptDirectory, { recursive: true });
  fs.writeFileSync(path.join(corruptDirectory, 'lease.json'), '{bad json\n', 'utf8');
  const corruptManager = new NodeLocalLeaseManager(dataRoot, { now: () => now, hostname: () => 'wave-host-a', pid: () => 106, isProcessAlive: () => false, scheduleHeartbeat: noTimer });
  const corruptBlocked = (await corruptManager.inspect('change', 'corrupt-change')).state === 'corrupt';
  let corruptAcquireBlocked = false;
  try {
    await corruptManager.acquire({ scope: 'change', resourceId: 'corrupt-change' });
  } catch (error) {
    corruptAcquireBlocked = error?.code === 'LEASE_CORRUPT';
  }
  assert(corruptBlocked && corruptAcquireBlocked, 'corrupt lease was not fail-loud');
  fs.rmSync(corruptDirectory, { recursive: true, force: true });
  const released = (await managerA.inspect('change', 'live-change')).state === 'free'
    && (await foreignNew.inspect('change', 'foreign-change')).state === 'free'
    && (await orphanNew.inspect('change', 'orphan-change')).state === 'free';
  assert(released, 'lease matrix left a lock behind');
  return { liveBlocked, orphanTakenOver, foreignHostBlocked, corruptBlocked, released };
}

async function runRecoveryMatrix(directory) {
  const results = {};
  results.staging = await recoverFixture('staging', 'staging', path.join(directory, 'staging'));
  results.replacing = await recoverFixture('replacing', 'replacing', path.join(directory, 'replacing'));
  results.committed = await recoverFixture('committed', 'committed', path.join(directory, 'committed'));
  results.unexpected = await recoverFixture('unexpected', 'unexpected', path.join(directory, 'unexpected'));
  return results;
}

async function runPolicyChecks(projectRoot, dataDir, changeId, recoveryEvidence) {
  const port = await connectPort({ projectRoot, policy: 'stage', dataDir, resumeChangeId: changeId });
  try {
    const tools = await listTools(port);
    assert(tools.includes('surdet_change_recovery_inspect'), 'stage policy hid recovery.inspect');
    assert(!tools.includes('surdet_change_recovery_execute'), 'stage policy exposed recovery.execute');
    const described = resultOf(await callTool(port, 'surdet_session_describe'), 'stage resumed session.describe');
    const executeCapability = described.capabilities.find((item) => item.id === 'change.recovery.execute');
    assert(executeCapability?.availability === 'policy-blocked', `stage recovery.execute availability was ${executeCapability?.availability}`);
    const inspected = resultOf(await callTool(port, 'surdet_change_recovery_inspect'), 'stage recovery.inspect');
    assert(inspected !== undefined, 'stage recovery.inspect returned no result');
    return {
      inspectVisible: true,
      executePolicyBlocked: true,
      executeApplyPassed: recoveryEvidence.staging.execute.ok === true,
      textEqualsStructured: harness.textChecks > 0,
    };
  } finally {
    await closePort(port);
  }
}

function emptyEvidence(evidenceClass) {
  return {
    schemaVersion: '1.0.0',
    status: 'FAILED',
    evidenceClass,
    runHead,
    projectRoot: null,
    dataDir: null,
    projectTreeBefore: null,
    projectTreeAfter: null,
    sameChange: { operations: [], recordVersions: [], workingRevision: null, invocations: [] },
    differentChanges: { stageOverlapObserved: false, commitOverlapObserved: false, winner: null, staleLoser: null },
    lease: { liveBlocked: false, orphanTakenOver: false, foreignHostBlocked: false, corruptBlocked: false, released: false },
    recovery: {},
    mcp: { inspectVisible: false, executePolicyBlocked: false, executeApplyPassed: false, textEqualsStructured: false },
    errors: [],
    childProcesses,
    cleanup: { timersStopped: true, childrenExited: false, locksReleased: false, activeLeaseDirectories: [] },
  };
}

async function runEvidence(evidenceClass) {
  if (evidenceClass === 'FORMAL') {
    const formalLock = path.join(os.tmpdir(), 'surdet-agent-transaction-wave4-FORMAL-RUN.lock');
    fs.writeFileSync(formalLock, `${runHead}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  const directory = path.join(runRoot, 'formal-or-diagnostic');
  fs.mkdirSync(directory, { recursive: true });
  const originalStarterBefore = hashTree(starterRoot);
  const same = await evidenceNode('same-change', () => runSameChange(path.join(directory, 'same')));
  const different = await evidenceNode('different-changes', () => runDifferentChanges(path.join(directory, 'different')));
  const lease = await evidenceNode('lease-matrix', () => runLeaseMatrix(path.join(directory, 'leases')));
  const recovery = await evidenceNode('recovery-matrix', () => runRecoveryMatrix(path.join(directory, 'recovery')));
  const mcp = await evidenceNode('mcp-policy-and-envelope', () => runPolicyChecks(same.projectRoot, same.dataDir, same.changeId, recovery));
  const originalStarterAfter = hashTree(starterRoot);
  assert(JSON.stringify(originalStarterBefore) === JSON.stringify(originalStarterAfter), 'original Starter changed during evidence run');
  assert(harness.protocol.length === 0, `MCP protocol errors: ${harness.protocol.join('; ')}`);
  assert(harness.stderrUnexpected.length === 0, `unexpected child stderr: ${harness.stderrUnexpected.join('; ')}`);
  assert(harness.childCleanupFailures.length === 0, `child cleanup failures: ${harness.childCleanupFailures.join('; ')}`);
  const activeLeases = scanActiveLeaseDirectories();
  assert(activeLeases.length === 0, `evidence run left active lease directories: ${JSON.stringify(activeLeases)}`);
  const projectTreeBefore = different.projectTreeBefore;
  const projectTreeAfter = different.projectTreeAfter;
  return {
    schemaVersion: '1.0.0',
    status: 'PASSED',
    evidenceClass,
    runHead,
    projectRoot: different.projectRoot,
    dataDir: different.dataDir,
    projectTreeBefore,
    projectTreeAfter,
    sameChange: same,
    differentChanges: different,
    lease,
    recovery,
    mcp,
    errors: [],
    childProcesses,
    cleanup: { timersStopped: true, childrenExited: childProcesses.every((child) => child.exited), locksReleased: activeLeases.length === 0, activeLeaseDirectories: activeLeases },
    originalStarter: { before: originalStarterBefore, after: originalStarterAfter, unchanged: true },
  };
}

async function main() {
  if (!MODES.has(mode)) fail(`usage: node ${path.basename(import.meta.url)} --mode preflight|diagnostic|formal`);
  let evidence;
  try {
    if (mode === 'preflight') evidence = await runPreflight();
    else evidence = await runEvidence(mode === 'formal' ? 'FORMAL' : 'DIAGNOSTIC');
    const artifact = writeArtifact(evidence);
    console.log(JSON.stringify({ ...evidence, artifact }));
  } catch (error) {
    await closeAllPorts();
    const failed = emptyEvidence(mode === 'formal' ? 'FORMAL' : mode === 'diagnostic' ? 'DIAGNOSTIC' : 'PREFLIGHT');
    failed.errors.push({ message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    failed.harness = {
      protocol: harness.protocol,
      stderrUnexpected: harness.stderrUnexpected,
      childCleanupFailures: harness.childCleanupFailures,
      textChecks: harness.textChecks,
    };
    failed.progress = { ...progress, milestones: [...progress.milestones] };
    failed.cleanup.childrenExited = childProcesses.every((child) => child.exited);
    const activeLeases = scanActiveLeaseDirectories();
    failed.cleanup.activeLeaseDirectories = activeLeases;
    failed.cleanup.locksReleased = activeLeases.length === 0;
    try {
      const artifact = writeArtifact(failed);
      console.error(JSON.stringify({ ...failed, artifact }));
    } catch (artifactError) {
      console.error(JSON.stringify({ ...failed, artifactError: String(artifactError) }));
    }
    process.exitCode = 1;
  }
}

await main();
