import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoringOperationError } from '@surdet/authoring';
import { parseAgentPortArgs } from '../src/agent-port/args.js';
import { allowedCapabilitiesForPolicy } from '../src/agent-port/policy.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import {
  openAgentPortSession,
  type AgentPortSession,
} from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-port-${name}-`));
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
  if (!fs.existsSync(root)) return new Map();
  return projectBytes(root);
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthoringOperationError);
    expect((error as AuthoringOperationError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

function expectFailure(value: any, code: string): void {
  expect(value.ok).toBe(false);
  expect(value.error.code).toBe(code);
}

async function open(root: string, data: string, policy: 'observe' | 'stage' | 'apply', resumeChangeId?: string): Promise<AgentPortSession> {
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy, ...(resumeChangeId === undefined ? {} : { resumeChangeId }) });
}

describe('Surdet Agent Port session and policy contract', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('requires explicit project and immutable policy', () => {
    expectCode(() => parseAgentPortArgs([]), 'INVALID_REQUEST');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--unknown']), 'INVALID_REQUEST');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--policy', 'stage']), 'INVALID_REQUEST');
    expectCode(() => parseAgentPortArgs(['--project', 'x', '--policy', 'observe', '--contract-version', '0.9.0']), 'CONTRACT_VERSION_UNSUPPORTED');
    expect(allowedCapabilitiesForPolicy('observe')).toContain('project.inspect');
    expect(allowedCapabilitiesForPolicy('observe')).not.toContain('change.begin');
  });

  it('binds one canonical project and rejects project/change injection in payload', async () => {
    const root = makeProject('binding');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    const absolute = await session.describe();
    const same = await open(path.relative(process.cwd(), root), data, 'stage');
    expect((await same.describe()).projectIdentity).toBe(absolute.projectIdentity);
    expect((await session.invoke('change.begin', {})).ok).toBe(true);

    const result = await session.invoke('scene.create', {
      operationId: 'op-injected-context',
      sceneId: 'blocked',
      projectRoot: root,
      changeId: 'forged',
    });
    expectFailure(result, 'INVALID_REQUEST');
    await session.close();
    await same.close();
  });

  it('observe cannot begin or mutate', async () => {
    const root = makeProject('observe');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const beforeData = dataBytes(data);
    const session = await open(root, data, 'observe');
    expectFailure(await session.invoke('change.begin', {}), 'POLICY_BLOCKED');
    expectFailure(await session.invoke('scene.create', { operationId: 'op-observe', sceneId: 'blocked' }), 'POLICY_BLOCKED');
    expect(projectBytes(root)).toEqual(beforeProject);
    expect(dataBytes(data)).toEqual(beforeData);
    await session.close();
  });

  it('stage cannot commit and keeps the transaction OPEN', async () => {
    const root = makeProject('stage');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    const begun = await session.invoke('change.begin', {});
    expect(begun.ok).toBe(true);
    const changeId = session.activeChangeId;
    expect(changeId).toBeDefined();
    expect((await session.invoke('scene.create', { operationId: 'op-stage', sceneId: 'staged' })).ok).toBe(true);
    expectFailure(await session.invoke('change.commit', {}), 'POLICY_BLOCKED');
    expect(projectBytes(root)).toEqual(beforeProject);
    const reopened = await session.describe();
    expect(reopened.activeChange?.status).toBe('OPEN');
    expect(reopened.activeChange?.changeId).toBe(changeId);
    await session.close();
  });

  it('apply starts without a hidden change', async () => {
    const root = makeProject('apply');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const beforeData = dataBytes(data);
    const session = await open(root, data, 'apply');
    expectFailure(await session.invoke('scene.create', { operationId: 'op-hidden', sceneId: 'blocked' }), 'SESSION_STATE_INVALID');
    expect(projectBytes(root)).toEqual(beforeProject);
    expect(dataBytes(data)).toEqual(beforeData);
    await session.close();
  });

  it('rejects resume from another project identity', async () => {
    const rootA = makeProject('owner-a');
    const rootB = makeProject('owner-b');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const sessionA = await open(rootA, data, 'stage');
    expect((await sessionA.invoke('change.begin', {})).ok).toBe(true);
    const changeId = sessionA.activeChangeId!;
    const beforeA = projectBytes(rootA);
    const beforeB = projectBytes(rootB);
    await expect(open(rootB, data, 'stage', changeId)).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_MISMATCH' });
    expect(projectBytes(rootA)).toEqual(beforeA);
    expect(projectBytes(rootB)).toEqual(beforeB);
    await sessionA.close();
  });

  it('allows one active change only', async () => {
    const root = makeProject('one-change');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const first = session.activeChangeId;
    expectFailure(await session.invoke('change.begin', {}), 'SESSION_STATE_INVALID');
    expect(session.activeChangeId).toBe(first);
    await session.close();
  });

  it('serializes concurrent invocations without losing successful mutations', async () => {
    const root = makeProject('concurrent-invocations');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;

    const results = await Promise.all([
      session.invoke('scene.create', { operationId: 'op-concurrent-a', sceneId: 'concurrent-a' }),
      session.invoke('scene.create', { operationId: 'op-concurrent-b', sceneId: 'concurrent-b' }),
      session.invoke('variable.ensure', {
        operationId: 'op-concurrent-variable',
        name: 'agent.concurrent',
        type: 'number',
        initial: 0,
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);

    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    expect(opened!.record.workingRevision).toBe(3);
    expect(Object.keys(opened!.record.operations)).toEqual([
      'op-concurrent-a',
      'op-concurrent-b',
      'op-concurrent-variable',
    ]);
    expect(opened!.record.workingFiles['content/scenario/concurrent-a.gal']).toContain('@scene concurrent-a');
    expect(opened!.record.workingFiles['content/scenario/concurrent-b.gal']).toContain('@scene concurrent-b');
    expect(JSON.parse(opened!.record.workingFiles['game.config.json']!)).toMatchObject({
      variables: { 'agent.concurrent': { type: 'number', initial: 0 } },
    });

    const invocations = (await opened!.store.readInvocations(changeId))
      .filter((invocation) => invocation.operationId?.startsWith('op-concurrent-'));
    expect(invocations.map((invocation) => [invocation.workingRevisionBefore, invocation.workingRevisionAfter])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(projectBytes(root)).toEqual(beforeProject);
    await session.close();
  });

  it('reports invocation-ledger failure truthfully and retries an idempotent operation without a second mutation', async () => {
    const root = makeProject('invocation-ledger-failure');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const writeInvocation = vi.spyOn(NodeChangeStore.prototype, 'writeInvocation')
      .mockImplementationOnce(async () => { throw new Error('simulated invocation ledger failure'); });
    try {
      const first = await session.invoke('scene.create', { operationId: 'op-ledger-retry', sceneId: 'ledger-retry' });
      expect(first.ok).toBe(false);
      if (first.ok) throw new Error('expected invocation-ledger failure');
      expect(first.error.message).toContain('调用事实记录写入失败');
      expect(first.error.details).toMatchObject({ operationMayHaveSucceeded: true, operationId: 'op-ledger-retry', changeId });

      const second = await session.invoke('scene.create', { operationId: 'op-ledger-retry', sceneId: 'ledger-retry' });
      expect(second.ok).toBe(true);
      const opened = await NodeChangeStore.openByChangeId(changeId);
      expect(opened).not.toBeNull();
      expect(opened!.record.workingRevision).toBe(1);
      expect(Object.keys(opened!.record.operations)).toEqual(['op-ledger-retry']);
      const facts = (await opened!.store.readInvocations(changeId))
        .filter((invocation) => invocation.operationId === 'op-ledger-retry');
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ workingRevisionBefore: 1, workingRevisionAfter: 1, ok: true });
    } finally {
      writeInvocation.mockRestore();
      await session.close();
    }
  });

  it('close preserves an OPEN transaction and working files', async () => {
    const root = makeProject('close');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-port-data-'));
    temporaryRoots.push(data);
    const beforeProject = projectBytes(root);
    const session = await open(root, data, 'stage');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const changeId = session.activeChangeId!;
    expect((await session.invoke('scene.create', { operationId: 'op-close', sceneId: 'kept' })).ok).toBe(true);
    await session.close();
    const resumed = await open(root, data, 'stage', changeId);
    const description = await resumed.describe();
    expect(description.activeChange?.status).toBe('OPEN');
    expect(description.activeChange?.workingRevision).toBe(1);
    expect(projectBytes(root)).toEqual(beforeProject);
    await resumed.close();
  });
});
