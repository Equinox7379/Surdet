import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { InMemoryChangeRepository, beginChange } from '../src/change-session.js';
import { applySceneCreate, applyScenePatch, ensureVariable } from '../src/operations.js';

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

describe('typed authoring operations', () => {
  it('creates scenes and ensures variables without touching storage', async () => {
    const storage = fixtureStorage();
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applySceneCreate(change, {
      operationId: 'op-scene',
      sceneId: 'branch_a',
      blocks: [{ kind: 'text', speaker: '凛', value: '分支 A' }],
    });
    await ensureVariable(change, { operationId: 'op-variable', name: 'trust', type: 'number', initial: 0 });
    expect(change.record.workingFiles['content/scenario/branch_a.gal']).toContain('分支 A');
    expect(change.record.workingFiles['game.config.json']).toContain('"trust"');
    expect(await storage.exists('content/scenario/branch_a.gal')).toBe(false);
  });

  it('requires an exact fingerprint for scene patches', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await expect(applyScenePatch(change, {
      operationId: 'op-patch',
      sceneId: 'prologue',
      patch: { kind: 'replaceText', target: 'scene:prologue/text:2@bad-bad', expectedFingerprint: 'bad', value: '篡改' },
    })).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
  });
});
