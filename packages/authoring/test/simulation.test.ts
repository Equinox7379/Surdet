import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { runExplicitPath, simulateSnapshot } from '../src/simulation.js';

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
    'game.config.json': JSON.stringify({ entryScene: 'prologue', variables: { trust: { type: 'number', initial: 0 } } }),
    'content/scenario/prologue.gal': [
      '@scene prologue',
      '@choice',
      '  正向 -> @set trust = 1 @goto positive',
      '  负向 -> @set trust = -1 @goto negative',
      '@label positive',
      '凛：正向。',
      '@end',
      '@label negative',
      '凛：负向。',
      '@end',
    ].join('\n'),
  };
  return {
    rootIdentity: 'simulation-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('simulateSnapshot', () => {
  it('enumerates both choices and preserves their final variables', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 10 });

    expect(report.status).toBe('passed');
    expect(report.choiceBranches).toEqual({ total: 2, visited: 2 });
    expect(report.paths.map((path) => path.finalVariables.trust).sort()).toEqual([-1, 1]);
  });

  it('reports an exhausted path budget as incomplete', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 1 });

    expect(report.status).toBe('incomplete');
    expect(report.budgetExhausted).toBe(true);
  });

  it('runs only the explicitly selected branch', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await runExplicitPath(snapshot, { sceneId: 'prologue', choices: [1] });

    expect(report.status).toBe('passed');
    expect(report.finalVariables.trust).toBe(-1);
  });
});
