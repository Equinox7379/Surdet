import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORING_CAPABILITY_IDS, AuthoringOperationError } from '@surdet/authoring';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-security-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

function projectBytes(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0 ? entry.name : path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) result.set(relative, fs.readFileSync(absolute, 'utf8'));
    }
  };
  walk(root, '');
  return result;
}

function dataBytes(root: string): Map<string, string> {
  return fs.existsSync(root) ? projectBytes(root) : new Map();
}

async function open(root: string, data: string, policy: 'observe' | 'stage' | 'apply', resumeChangeId?: string): Promise<AgentPortSession> {
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy, ...(resumeChangeId === undefined ? {} : { resumeChangeId }) });
}

function expectFailure(value: any, code: string): void {
  expect(value.ok).toBe(false);
  expect(value.error.code).toBe(code);
}

async function beginWithScene(session: AgentPortSession, sceneId = 'security-scene'): Promise<string> {
  expect((await session.invoke('change.begin', {})).ok).toBe(true);
  expect((await session.invoke('scene.create', { operationId: `op-${sceneId}`, sceneId })).ok).toBe(true);
  return session.activeChangeId!;
}

async function freshEvidence(session: AgentPortSession): Promise<void> {
  expect((await session.invoke('project.validate', {})).ok).toBe(true);
  expect((await session.invoke('project.simulate', {})).ok).toBe(true);
  expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
  expect((await session.invoke('change.diff', {})).ok).toBe(true);
}

async function createCommitted(root: string, data: string): Promise<string> {
  const session = await open(root, data, 'apply');
  const changeId = await beginWithScene(session, 'committed');
  await freshEvidence(session);
  expect((await session.invoke('change.commit', {})).ok).toBe(true);
  await session.close();
  return changeId;
}

async function waitForClose(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => child.once('close', () => resolve()));
}

describe('Surdet Agent Port security and cleanup countertests', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects observe begin and observe/stage commit without mutation', async () => {
    const root = makeProject('policy');
    const observeData = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    const stageData = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(observeData, stageData);
    const beforeProject = projectBytes(root);
    const beforeObserveData = dataBytes(observeData);
    const observe = await open(root, observeData, 'observe');
    expectFailure(await observe.invoke('change.begin', {}), 'POLICY_BLOCKED');
    expectFailure(await observe.invoke('change.commit', {}), 'POLICY_BLOCKED');
    expect(projectBytes(root)).toEqual(beforeProject);
    expect(dataBytes(observeData)).toEqual(beforeObserveData);
    await observe.close();

    const stage = await open(root, stageData, 'stage');
    await beginWithScene(stage, 'stage-policy');
    const beforeWorking = (await stage.describe()).activeChange?.workingRevision;
    expectFailure(await stage.invoke('change.commit', {}), 'POLICY_BLOCKED');
    expect((await stage.describe()).activeChange?.workingRevision).toBe(beforeWorking);
    expect(projectBytes(root)).toEqual(beforeProject);
    await stage.close();
  });

  it('rejects context, path and extra-field injection before changing the working change', async () => {
    const root = makeProject('injection');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const changeId = await beginWithScene(session, 'injection');
    const before = await NodeChangeStore.openByChangeId(changeId);
    expect(before).not.toBeNull();
    const beforeRecord = before!.record;
    const beforeProject = projectBytes(root);
    expectFailure(await session.invoke('scene.create', {
      operationId: 'op-injected',
      sceneId: 'blocked',
      projectRoot: root,
      changeId: 'forged',
      cwd: root,
      path: '../outside',
      extra: true,
    }), 'INVALID_REQUEST');
    const after = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expect(after.workingRevision).toBe(beforeRecord.workingRevision);
    expect(after.workingFiles).toEqual(beforeRecord.workingFiles);
    expect(after.operations).toEqual(beforeRecord.operations);
    expect(projectBytes(root)).toEqual(beforeProject);
    await session.close();
  });

  it('rejects an invalid typed scene candidate atomically before writing the change', async () => {
    const root = makeProject('scene-atomicity');
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({
      entryScene: 'start',
      variables: { affinity: { type: 'number', initial: 0 } },
    }), 'utf8');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const before = (await NodeChangeStore.openByChangeId(changeId))!.record;
    const beforeProject = projectBytes(root);

    const invalid = await session.invoke('scene.create', {
      operationId: 'op-invalid-set',
      sceneId: 'invalid-set',
      blocks: [{
        kind: 'choice',
        options: [{
          label: '继续',
          effects: [{ name: 'set', args: ['affinity', '2'] }],
          target: { kind: 'goto', value: 'done' },
        }],
      }, { kind: 'label', name: 'done' }],
    });
    const afterInvalid = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expectFailure(invalid, 'INVALID_REQUEST');
    if (invalid.ok) throw new Error('invalid typed scene candidate unexpectedly succeeded');
    expect(invalid.error.message).toContain('C004');
    expect(invalid.error.message).toContain('@set');
    expect(invalid.error.message).toContain('=');
    expect(afterInvalid.workingFiles).toEqual(before.workingFiles);
    expect(afterInvalid.workingRevision).toBe(before.workingRevision);
    expect(afterInvalid.operations).toEqual(before.operations);
    expect(projectBytes(root)).toEqual(beforeProject);

    const valid = await session.invoke('scene.create', {
      operationId: 'op-valid-set',
      sceneId: 'valid-set',
      blocks: [{
        kind: 'choice',
        options: [{
          label: '继续',
          effects: [{ name: 'set', args: ['affinity', '=', '2'] }],
          target: { kind: 'goto', value: 'done' },
        }],
      }, { kind: 'label', name: 'done' }],
    });
    expect(valid.ok).toBe(true);
    const afterValid = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expect(afterValid.workingRevision).toBe(before.workingRevision + 1);
    expect(afterValid.operations).toHaveProperty('op-valid-set');
    expect(afterValid.workingFiles['content/scenario/valid-set.gal']).toContain('@set affinity = 2');
    expect(projectBytes(root)).toEqual(beforeProject);
    await session.close();
  });

  it('rolls back a poisoned OPEN change without reading the project directory', async () => {
    const root = makeProject('poisoned-rollback');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    const poisoned = {
      ...opened!.record,
      recordVersion: opened!.record.recordVersion + 1,
      workingRevision: 1,
      workingFiles: {
        ...opened!.record.workingFiles,
        'content/scenario/start.gal': '@scene start\n@choice\n  继续 @set affinity 2 -> @goto start\n@end\n',
      },
    };
    await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
      await leasedStore.write(poisoned, {
        expectedRecordVersion: opened!.record.recordVersion,
        expectedStatus: 'OPEN',
      });
    });
    const beforeProject = projectBytes(root);
    const unavailableRoot = `${root}-unavailable`;
    fs.renameSync(root, unavailableRoot);
    temporaryRoots.push(unavailableRoot);

    const rolledBack = await session.invoke('change.rollback', {});
    expect(rolledBack.ok).toBe(true);
    if (rolledBack.ok === false) throw new Error(rolledBack.error.message);
    const after = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expect(after.status).toBe('ROLLED_BACK');
    expect(after.workingFiles).toEqual(after.baseContents);
    expect(rolledBack.result).toEqual({ changeId, status: 'ROLLED_BACK' });
    expect(fs.existsSync(root)).toBe(false);
    expect(projectBytes(unavailableRoot)).toEqual(beforeProject);
    await session.close();
  });

  it('rejects resuming a change owned by another project', async () => {
    const rootA = makeProject('owner-a');
    const rootB = makeProject('owner-b');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const owner = await open(rootA, data, 'stage');
    const changeId = await beginWithScene(owner, 'owned');
    const beforeA = projectBytes(rootA);
    const beforeB = projectBytes(rootB);
    await expect(open(rootB, data, 'stage', changeId)).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_MISMATCH' });
    expect(projectBytes(rootA)).toEqual(beforeA);
    expect(projectBytes(rootB)).toEqual(beforeB);
    await owner.close();
  });

  it.each(['committed', 'rolled-back', 'stale'] as const)('resumes a %s change under the terminal/recovery-only contract', async (kind) => {
    const root = makeProject(`resume-${kind}`);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'apply');
    const changeId = await beginWithScene(session, `resume-${kind}`);
    if (kind === 'committed') {
      await freshEvidence(session);
      expect((await session.invoke('change.commit', {})).ok).toBe(true);
    } else if (kind === 'rolled-back') {
      expect((await session.invoke('change.rollback', {})).ok).toBe(true);
    } else {
      await freshEvidence(session);
      fs.appendFileSync(path.join(root, 'content', 'scenario', `resume-${kind}.gal`), '# external change\n', 'utf8');
      expectFailure(await session.invoke('change.commit', {}), 'PROJECT_CHANGED_SINCE_BEGIN');
      expect((await NodeChangeStore.openByChangeId(changeId))!.record.status).toBe('STALE');
    }
    const beforeResumeRecord = (await NodeChangeStore.openByChangeId(changeId))!.record;
    const beforeResumeProject = projectBytes(root);
    await session.close();

    const resumed = await open(root, data, 'apply', changeId);
    const description = await resumed.describe();
    expect(description.activeChange?.status).toBe(kind === 'rolled-back' ? 'ROLLED_BACK' : kind === 'committed' ? 'COMMITTED' : 'STALE');
    expect(description.nextActions).not.toEqual(expect.arrayContaining([
      'project.validate', 'project.simulate', 'runtime.run-from', 'change.diff', 'change.commit', 'change.rollback',
    ]));
    expect(description.capabilities.find((item) => item.id === 'change.recovery.inspect')).toMatchObject({ availability: 'available' });
    expect(description.capabilities.find((item) => item.id === 'scene.create')).toMatchObject({ availability: 'state-blocked' });

    const inspected = await resumed.invoke('change.recovery.inspect', {});
    expect(inspected.ok).toBe(true);
    expectFailure(await resumed.invoke('scene.create', {
      operationId: `op-resume-${kind}-blocked`,
      sceneId: `resume-${kind}-blocked`,
    }), 'SESSION_STATE_INVALID');

    const afterBlockedRecord = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expect(afterBlockedRecord).toEqual(beforeResumeRecord);
    expect(afterBlockedRecord.workingFiles).toEqual(beforeResumeRecord.workingFiles);
    expect(projectBytes(root)).toEqual(beforeResumeProject);
    await resumed.close();

    const afterCloseRecord = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expect(afterCloseRecord.status).toBe(beforeResumeRecord.status);
  });

  it('rejects a second begin and preserves the first active change', async () => {
    const root = makeProject('single-begin');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const first = await beginWithScene(session, 'first');
    const before = (await NodeChangeStore.openByChangeId(first))!.record;
    expectFailure(await session.invoke('change.begin', {}), 'SESSION_STATE_INVALID');
    const after = (await NodeChangeStore.openByChangeId(first))!.record;
    expect(session.activeChangeId).toBe(first);
    expect(after.workingRevision).toBe(before.workingRevision);
    expect(after.workingFiles).toEqual(before.workingFiles);
    await session.close();
  });

  it('rejects operationId reuse with a different payload and preserves the first result', async () => {
    const root = makeProject('operation-id');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const changeId = await beginWithScene(session, 'first-operation');
    const before = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expectFailure(await session.invoke('scene.create', { operationId: 'op-first-operation', sceneId: 'different-a' }), 'OPERATION_ID_CONFLICT');
    const after = (await NodeChangeStore.openByChangeId(changeId))!.record;
    expect(after.workingRevision).toBe(before.workingRevision);
    expect(after.workingFiles).toEqual(before.workingFiles);
    expect(Object.keys(after.operations)).toEqual(Object.keys(before.operations));
    await session.close();
  });

  it('marks the change stale when the project changes externally before commit', async () => {
    const root = makeProject('external-change');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'apply');
    const changeId = await beginWithScene(session, 'external');
    await freshEvidence(session);
    const externalPath = path.join(root, 'content', 'scenario', 'external.gal');
    expect(fs.existsSync(externalPath)).toBe(false);
    fs.writeFileSync(externalPath, '@scene external\n@end\n# external change\n', 'utf8');
    const result = await session.invoke('change.commit', {});
    expectFailure(result, 'PROJECT_CHANGED_SINCE_BEGIN');
    expect(fs.readFileSync(externalPath, 'utf8')).toBe('@scene external\n@end\n# external change\n');
    expect((await NodeChangeStore.openByChangeId(changeId))!.record.status).toBe('STALE');
    await session.close();
  });

  it('returns PROJECT_BUSY without commit side effects when a live project lease is held', async () => {
    const root = makeProject('project-busy');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'apply');
    const changeId = await beginWithScene(session, 'project-busy');
    await freshEvidence(session);
    const storage = await NodeProjectStorage.open(root);
    const leaseManager = new NodeLocalLeaseManager(data);
    const beforeProject = projectBytes(root);
    const beforeOpened = await NodeChangeStore.openByChangeId(changeId);
    expect(beforeOpened).not.toBeNull();
    const beforeRecord = beforeOpened!.record;
    const beforeJournal = await beforeOpened!.store.readLatestJournal(changeId);
    const service = new AuthoringService();
    const startedAt = Date.now();

    await leaseManager.withProjectLease(storage.rootIdentity, async () => {
      let busyError: unknown;
      try {
        await service.commit(changeId);
      } catch (error) {
        busyError = error;
      }
      expect(busyError).toMatchObject({
        code: 'PROJECT_BUSY',
        details: {
          scope: 'project',
          holder: {
            pid: process.pid,
            hostname: expect.any(String),
            acquiredAt: expect.any(String),
            heartbeatAt: expect.any(String),
          },
          retryAfterMs: expect.any(Number),
        },
      });
      expect((busyError as { details?: Record<string, unknown> }).details).not.toHaveProperty('ownerToken');
    });

    expect(Date.now() - startedAt).toBeLessThan(1000);
    const afterOpened = await NodeChangeStore.openByChangeId(changeId);
    expect(afterOpened).not.toBeNull();
    expect(afterOpened!.record).toEqual(beforeRecord);
    expect(await afterOpened!.store.readLatestJournal(changeId)).toEqual(beforeJournal);
    expect(projectBytes(root)).toEqual(beforeProject);
    await session.close();
  });

  it('does not retry a recovery-failed commit or alter the post-failure state again', async () => {
    const root = makeProject('recovery');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'apply');
    const changeId = await beginWithScene(session, 'recovery-a');
    expect((await session.invoke('scene.create', { operationId: 'op-recovery-b', sceneId: 'recovery-b' })).ok).toBe(true);
    await freshEvidence(session);
    const originalReplace = NodeProjectStorage.prototype.replaceFromStage;
    let replaceCalls = 0;
    const replaceSpy = vi.spyOn(NodeProjectStorage.prototype, 'replaceFromStage').mockImplementation(async function(this: NodeProjectStorage, relativePath, stagedIdentity) {
      replaceCalls += 1;
      if (replaceCalls === 2) throw new Error('simulated locked target');
      return originalReplace.call(this, relativePath, stagedIdentity);
    });
    const removePathSpy = vi.spyOn(NodeProjectStorage.prototype, 'removePath').mockRejectedValue(new Error('simulated remove failure'));
    try {
      expectFailure(await session.invoke('change.commit', {}), 'COMMIT_RECOVERY_FAILED');
      const afterFailure = projectBytes(root);
      const afterFailureOpened = await NodeChangeStore.openByChangeId(changeId);
      if (afterFailureOpened === null) throw new Error('recovery-failed change disappeared');
      const beforeRetryRecord = afterFailureOpened.record;
      const beforeRetryJournal = await afterFailureOpened.store.readLatestJournal(changeId);
      const journal = beforeRetryJournal as any;
      expect(journal.status).toBe('RECOVERY_FAILED');
      expect(beforeRetryRecord.status).toBe('STALE');
      expectFailure(await session.invoke('change.commit', {}), 'SESSION_STATE_INVALID');
      expect(replaceCalls).toBe(2);
      expect(projectBytes(root)).toEqual(afterFailure);
      const afterRetryOpened = await NodeChangeStore.openByChangeId(changeId);
      if (afterRetryOpened === null) throw new Error('recovery-failed change disappeared after retry');
      expect(afterRetryOpened.record).toEqual(beforeRetryRecord);
      expect(await afterRetryOpened.store.readLatestJournal(changeId)).toEqual(beforeRetryJournal);
    } finally {
      replaceSpy.mockRestore();
      removePathSpy.mockRestore();
    }
    await session.close();
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('keeps %s cleanup and stdout protocol-safe', async (signal) => {
    const root = makeProject(`signal-${signal}`);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-security-data-'));
    temporaryRoots.push(data);
    const entry = path.resolve(process.cwd(), 'dist', 'agent-port', 'main.js');
    const child = spawn(process.execPath, [entry, '--project', root, '--policy', 'observe'], {
      cwd: process.cwd(),
      env: { ...process.env, SURDET_AGENT_DATA_DIR: data },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Agent Port did not become ready: ${stderr}`)), 5000);
      child.stderr.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('Surdet Agent Port ready:')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    child.kill(signal);
    await waitForClose(child);
    expect(stdout).toBe('');
    expect(stderr).toContain('Surdet Agent Port ready:');
    expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });
});

describe('Wave 6 review security boundary', () => {
  it('does not expose agent-side human receipt writers', () => {
    expect(AUTHORING_CAPABILITY_IDS).toHaveLength(35);
    expect(AUTHORING_CAPABILITY_IDS).not.toContain('review.write-decision');
    expect(AUTHORING_CAPABILITY_IDS).not.toContain('review.approve');
  });
});
