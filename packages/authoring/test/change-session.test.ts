import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import {
  InMemoryChangeRepository,
  beginChange,
  recordRuntimeTrace,
  recordSimulationEvidence,
} from '../src/change-session.js';
import { applySceneCreate } from '../src/operations.js';

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
});
