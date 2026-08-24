import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import {
  AuthoringOperationError,
  InMemoryChangeRepository,
  beginChange,
  recordValidation,
  recordRuntimeTrace,
  recordSimulationEvidence,
  runOperation,
} from '../src/change-session.js';
import { applySceneCreate, ensureVariable } from '../src/operations.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

function fixtureStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': '{"entryScene":"prologue","variables":{}}',
    'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
  };
  return {
    rootIdentity: 'fixture-root',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('change session operation identity', () => {
  it('replays identical operationId but rejects a different payload', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    const input = { operationId: 'op-create', sceneId: 'branch_a' };
    const first = await applySceneCreate(change, input);
    const replay = await applySceneCreate(change, input);
    expect(replay).toEqual(first);
    await expect(applySceneCreate(change, { ...input, sceneId: 'branch_b' }))
      .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    expect(change.record.workingRevision).toBe(1);
    expect(change.record.workingFiles['content/scenario/branch_a.gal']).toContain('@scene branch_a');
  });

  it('persists bounded intent metadata outside project contents', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const repository = new InMemoryChangeRepository();
    const metadata = {
      intent: '建立 Agent Port 演示分支',
      acceptanceCriteria: ['双分支可达', '使用既有背景'],
      initiator: 'external-agent' as const,
    };
    const change = await beginChange(snapshot, repository, undefined, metadata);
    expect(change.record.intent).toEqual(metadata);
    expect(change.record.workingFiles).toEqual(change.record.baseContents);
  });

  it('records simulation and runtime freshness without changing workingRevision', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(snapshot, repository);
    const revision = change.record.workingRevision;
    await recordSimulationEvidence(change, { evidenceId: 'sim-1', status: 'passed' });
    await recordRuntimeTrace(change, { traceId: 'trace-1', status: 'passed' });
    expect(change.record.workingRevision).toBe(revision);
    expect(change.record.latestSimulation).toEqual({
      evidenceId: 'sim-1', status: 'passed', workingRevision: revision,
    });
    expect(change.record.runtimeTraces).toEqual([
      { traceId: 'trace-1', status: 'passed', workingRevision: revision },
    ]);
  });

  it('increments recordVersion for content and evidence writes while workingRevision only tracks content', async () => {
    const repo = new InMemoryChangeRepository();
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, repo);
    expect(change.record).toMatchObject({ formatVersion: 2, recordVersion: 0, workingRevision: 0 });
    await applySceneCreate(change, { operationId: 'op-v2', sceneId: 'v2' });
    expect(change.record).toMatchObject({ recordVersion: 1, workingRevision: 1 });
    await recordValidation(change, { evidenceId: 'validation-v2', errors: 0 });
    expect(change.record).toMatchObject({ recordVersion: 2, workingRevision: 1 });
  });

  it('rejects a stale record precondition without changing repository content', async () => {
    const repo = new InMemoryChangeRepository();
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, repo);
    const first = JSON.parse(JSON.stringify(change.record)) as typeof change.record;
    const current = {
      ...first,
      recordVersion: 1,
      workingRevision: 1,
      workingFiles: { ...first.workingFiles, 'content/scenario/v2.gal': '@scene v2\n@end\n' },
      operations: { ...first.operations, 'op-first': { requestHash: 'first', result: true } },
    };
    await repo.write(current, { expectedRecordVersion: 0, expectedStatus: 'OPEN' });
    const beforeConflict = await repo.read(change.record.changeId);
    await expect(repo.write({
      ...current,
      recordVersion: 1,
      workingFiles: { ...current.workingFiles, 'content/scenario/stale.gal': '@scene stale\n@end\n' },
    }, { expectedRecordVersion: 0, expectedStatus: 'OPEN' }))
      .rejects.toMatchObject({ code: 'CHANGE_RECORD_CONFLICT' });
    expect(await repo.read(change.record.changeId)).toEqual(beforeConflict);
  });
});

describe('Wave 5 operation capture', () => {
  it('persists the exact normalizedInput for a successful mutation', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(snapshot, repository);
    await ensureVariable(change, {
      operationId: 'op_capture',
      name: 'agent.wave5.flag',
      type: 'int',
      initial: 0,
    });
    expect(change.record.operations.op_capture).toMatchObject({
      requestHash: expect.any(String),
      normalizedInput: {
        operationId: 'op_capture',
        name: 'agent.wave5.flag',
        type: 'int',
        initial: 0,
      },
    });
  });

  it('derives an identical requestHash for semantically identical inputs with different key insertion order', async () => {
    const begin = async () => {
      const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
      return beginChange(snapshot, new InMemoryChangeRepository());
    };
    const first = await begin();
    const second = await begin();
    await ensureVariable(first, {
      operationId: 'op_order',
      name: 'agent.wave5.order',
      type: 'int',
      initial: 0,
    });
    await ensureVariable(second, {
      initial: 0,
      type: 'int',
      name: 'agent.wave5.order',
      operationId: 'op_order',
    });
    expect(second.record.operations.op_order?.requestHash).toBeDefined();
    expect(second.record.operations.op_order?.requestHash)
      .toBe(first.record.operations.op_order?.requestHash);
  });

  it('keeps failed mutations out of the operation ledger entirely', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await expect(runOperation(change, { operationId: 'op_fail' }, () => {
      throw new AuthoringOperationError('INVALID_REQUEST', 'wave5 red fixture failure');
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(change.record.operations['op_fail']).toBeUndefined();
  });

  it('reads legacy records whose operations lack normalizedInput without rewriting them', async () => {
    const repo = new InMemoryChangeRepository();
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, repo);
    const legacy = {
      ...(JSON.parse(JSON.stringify(change.record)) as typeof change.record),
      recordVersion: 1,
      workingRevision: 1,
      workingFiles: {
        ...change.record.workingFiles,
        'content/scenario/legacy.gal': '@scene legacy\n@end\n',
      },
      operations: {
        op_legacy: { requestHash: 'legacy-hash', result: { ok: true } },
      },
    };
    await repo.write(legacy, { expectedRecordVersion: 0, expectedStatus: 'OPEN' });
    const reread = await repo.read(change.record.changeId);
    expect(reread?.operations.op_legacy).toEqual({ requestHash: 'legacy-hash', result: { ok: true } });
    expect(reread?.operations.op_legacy).not.toHaveProperty('normalizedInput');
  });
});
