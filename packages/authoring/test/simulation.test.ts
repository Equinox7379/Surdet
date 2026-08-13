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

function growthFixtureStorage(withGrowth: boolean): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': JSON.stringify({
      entryScene: 'prologue',
      variables: {
        'lynn.atk': { type: 'number', initial: 5 },
        'lynn.hp': { type: 'number', initial: 20 },
      },
    }),
    'content/scenario/prologue.gal': [
      '@scene prologue',
      '@exp lynn 10',
      '凛：成长完成。',
      '@end',
    ].join('\n'),
  };
  if (withGrowth) {
    contents['content/config/growth.json'] = JSON.stringify({
      curve: { base: 10, linear: 5 },
      profiles: [{
        characterId: 'lynn',
        initialLevel: 1,
        statGrowth: { 'lynn.atk': 2, 'lynn.hp': 10 },
      }],
    });
  }
  return {
    rootIdentity: withGrowth ? 'growth-fixture' : 'no-growth-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

function loopFixtureStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': JSON.stringify({ entryScene: 'prologue' }),
    'content/scenario/prologue.gal': [
      '@scene prologue',
      '@label top',
      '@choice',
      '  再来一次 -> @goto top',
      '  离开 -> @goto exit',
      '@label exit',
      '凛：再见。',
      '@clear done',
      '@end',
    ].join('\n'),
  };
  return {
    rootIdentity: 'loop-fixture',
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
    expect(report.pathsExplored).toBe(3);
    expect(report.paths.map((path) => path.finalVariables.trust).sort()).toEqual([-1, 1]);
    expect(report.paths.every((path) => path.termination === 'ended')).toBe(true);
  });

  it('reports an exhausted path budget as incomplete', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 1 });

    expect(report.status).toBe('incomplete');
    expect(report.budgetExhausted).toBe(true);
    expect(report.pathsExplored).toBe(1);
    expect(report.pathsExplored).toBeLessThanOrEqual(1);
    expect(report.paths.some((path) => path.termination === 'budget-exhausted')).toBe(true);
  });

  it('runs only the explicitly selected branch', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await runExplicitPath(snapshot, { sceneId: 'prologue', choices: [1] });

    expect(report.status).toBe('passed');
    expect(report.finalVariables.trust).toBe(-1);
  });

  it('records state-signature pruning without losing path evidence', async () => {
    const snapshot = await loadProjectSnapshot(loopFixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot);

    expect(report.status).toBe('passed');
    expect(report.runtimeErrors).toEqual([]);
    expect(report.cyclesPruned).toBeGreaterThan(0);
    expect(report.pathsExplored).toBeGreaterThan(0);
    expect(report.paths.length).toBeGreaterThan(0);
    expect(report.paths.some((path) => (
      path.status === 'passed'
      && path.termination === 'pruned'
      && path.prunedReason === 'state-signature'
    ))).toBe(true);
    expect(report.paths.some((path) => path.termination === 'ended')).toBe(true);
    expect(report.endings).toEqual([{ ending: 'done', times: 1 }]);
  });

  it('uses one GrowthSystem runtime for simulated and explicit paths', async () => {
    const snapshot = await loadProjectSnapshot(growthFixtureStorage(true), hasher);
    const report = await simulateSnapshot(snapshot);
    const explicit = await runExplicitPath(snapshot, { sceneId: 'prologue', choices: [] });

    expect(report.status).toBe('passed');
    expect(report.runtimeErrors).toEqual([]);
    expect(report.paths[0]?.finalVariables['lynn.atk']).toBe(7);
    expect(report.paths[0]?.finalVariables['lynn.hp']).toBe(30);
    expect(explicit.status).toBe('passed');
    expect(explicit.finalVariables['lynn.atk']).toBe(7);
    expect(explicit.finalVariables['lynn.hp']).toBe(30);
  });

  it('keeps @exp strict when the snapshot has no growth config', async () => {
    const snapshot = await loadProjectSnapshot(growthFixtureStorage(false), hasher);
    const report = await simulateSnapshot(snapshot);

    expect(report.status).toBe('failed');
    expect(report.runtimeErrors).toHaveLength(1);
    expect(report.runtimeErrors[0]?.message).toMatch(/GrowthSystem/);
  });
});
