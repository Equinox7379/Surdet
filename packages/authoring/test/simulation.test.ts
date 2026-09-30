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

function seededFixtureStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': JSON.stringify({ entryScene: 'seeded', variables: {
      first: { type: 'number', initial: 0 },
      second: { type: 'number', initial: 0 },
    } }),
    'content/scenario/seeded.gal': '@scene seeded\n@random first 0 100\n@random second 0 100\n@clear seeded_done\n@end\n',
  };
  return {
    rootIdentity: 'seeded-fixture',
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

function callStackIdentityFixtureStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': JSON.stringify({ entryScene: 'entry', variables: {} }),
    'content/scenario/entry.gal': [
      '@scene entry',
      '@choice',
      '  路径 A -> @jump caller_a',
      '  路径 B -> @jump caller_b',
      '@end',
    ].join('\n'),
    'content/scenario/caller_a.gal': [
      '@scene caller_a',
      '@call shared',
      '@clear safe_end',
      '@end',
    ].join('\n'),
    'content/scenario/caller_b.gal': [
      '@scene caller_b',
      '@call shared',
      '@check false',
      '@end',
    ].join('\n'),
    'content/scenario/shared.gal': [
      '@scene shared',
      '@choice',
      '  继续 -> @goto done',
      '@label done',
      '@return',
    ].join('\n'),
  };
  return {
    rootIdentity: 'simulation-call-stack-identity',
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
  it('同一个 seed 驱动固定 @random 序列，并在报告中保留实际 seed', async () => {
    const snapshot = await loadProjectSnapshot(seededFixtureStorage(), hasher);
    const first = await simulateSnapshot(snapshot, { seed: 0 });
    const second = await simulateSnapshot(snapshot, { seed: 0 });

    expect(first.seed).toBe(0);
    expect(first.paths[0]?.finalVariables).toMatchObject({ first: 26, second: 0 });
    expect(second.paths[0]?.finalVariables).toEqual(first.paths[0]?.finalVariables);

    const different = await simulateSnapshot(snapshot, { seed: 1 });
    expect(different.seed).toBe(1);
    expect(different.paths[0]?.finalVariables).toMatchObject({ first: 63, second: 0 });

    const defaultSeed = await simulateSnapshot(snapshot);
    expect(defaultSeed.seed).toBe(1592639710);
  });

  it('enumerates both choices and preserves their final variables', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 10 });

    expect(report.status).toBe('passed');
    expect(report.choiceBranches).toEqual({ total: 2, visited: 2 });
    expect(report.pathsExplored).toBe(3);
    expect(report.paths.map((path) => path.finalVariables.trust).sort()).toEqual([-1, 1]);
    expect(report.paths.every((path) => path.termination === 'ended')).toBe(true);
    expect(report.coverage.branches.map(branch => branch.status)).toEqual(['visited', 'visited']);
    expect(report.coverage.branches.map(branch => branch.location.line)).toEqual([3, 4]);
    expect(report.coverage.scenes[0]).toMatchObject({ sceneId: 'prologue', visited: true, sourceVersion: snapshot.scenes[0]!.file.sha256 });
    expect(report.coverage.stops).toEqual([]);
  });

  it('reports an exhausted path budget as incomplete', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 1 });

    expect(report.status).toBe('incomplete');
    expect(report.budgetExhausted).toBe(true);
    expect(report.pathsExplored).toBe(1);
    expect(report.pathsExplored).toBeLessThanOrEqual(1);
    expect(report.paths.some((path) => path.termination === 'budget-exhausted')).toBe(true);
    expect(report.coverage.branches.map(branch => branch.status)).toEqual(['budget-exhausted', 'budget-exhausted']);
    expect(report.coverage.stops.map(stop => stop.kind)).toEqual(['path-budget', 'path-budget']);
  });

  it('carries the step budget into each choice branch instead of resetting it', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxStepsPerPath: 2 });
    expect(report.status).toBe('incomplete');
    expect(report.paths).toHaveLength(2);
    expect(report.runtimeErrors).toEqual([]);
    expect(report.paths.every((path) => path.status === 'incomplete' && path.termination === 'budget-exhausted' && path.prunedReason === 'step-budget')).toBe(true);
    expect(report.coverage.stops.every(stop => stop.kind === 'step-budget' && stop.location !== null)).toBe(true);
    const sufficient = await simulateSnapshot(snapshot, { maxStepsPerPath: 3 });
    expect(sufficient.status).toBe('passed');
    expect(sufficient.paths).toHaveLength(2);
  });

  it('runs only the explicitly selected branch', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const report = await runExplicitPath(snapshot, { sceneId: 'prologue', choices: [1] });

    expect(report.status).toBe('passed');
    expect(report.finalVariables.trust).toBe(-1);
  });

  it('distinguishes equal position and variables when call stacks differ', async () => {
    const snapshot = await loadProjectSnapshot(callStackIdentityFixtureStorage(), hasher);
    const report = await simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });

    expect(report.status).toBe('failed');
    expect(report.runtimeErrors).toHaveLength(1);
    expect(report.runtimeErrors[0]?.scene).toBe('caller_b');
    expect(report.runtimeErrors[0]?.message).toContain('@check 断言失败');
    expect(report.endings).toEqual([{ ending: 'safe_end', times: 1 }]);
    expect(report.budgetExhausted).toBe(false);
    expect(report.coverage.stops[0]).toMatchObject({ kind: 'runtime-error', location: { sceneId: 'caller_b', line: 3 } });
    expect(report.coverage.scenes.filter(scene => scene.visited).map(scene => scene.sceneId).sort()).toEqual(['caller_a', 'caller_b', 'entry', 'shared']);
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
    expect(report.coverage.branches.every(branch => branch.status === 'visited')).toBe(true);
  });

  it('distinguishes unavailable conditional options from unreachable scenes and observes all-hidden choices', async () => {
    const files = {
      'game.config.json': JSON.stringify({ entryScene: 'start', variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/chapter/start.gal': '@scene start\n@choice\n  隐藏 [if:trust > 5] -> @jump hidden\n  显示 [if:trust == 0] -> @call shared.entry @end\n  普通 -> @end\n',
      'content/scenario/shared.gal': '@scene shared\n@label entry\n@choice\n  条件失败 [if:false] -> @end\n@return\n',
      'content/scenario/hidden.gal': '@scene hidden\n秘密正文。\n@end\n',
    };
    const storage: ProjectStorage = { rootIdentity: 'condition-coverage', listFiles: async () => Object.keys(files), exists: async path => path in files,
      readText: async path => { const text = files[path as keyof typeof files]; return { path, text, bytes: text.length, sha256: digest(text) }; } };
    const snapshot = await loadProjectSnapshot(storage, hasher), report = simulateSnapshot(snapshot);
    expect(report.status).toBe('passed');
    const start = report.coverage.branches.filter(branch => branch.location.sceneId === 'start');
    expect(start.map(branch => [branch.optionIndex, branch.status, branch.selected])).toEqual([[0, 'condition-not-met', 0], [1, 'visited', 1], [2, 'visited', 1]]);
    expect(start[1]!.location).toMatchObject({ file: 'content/scenario/chapter/start.gal', line: 4 });
    expect(report.coverage.conditions.map(condition => [condition.expression, condition.trueCount, condition.falseCount])).toEqual([
      // Restoring the real choice snapshot evaluates its conditions again for each branch.
      ['trust > 5', 0, 3], ['trust == 0', 3, 0], ['false', 0, 1],
    ]);
    expect(report.coverage.scenes.find(scene => scene.sceneId === 'hidden')?.visited).toBe(false);
    expect(report.coverage.scenes.find(scene => scene.sceneId === 'shared')?.visited).toBe(true);
    expect(report.coverage.branches.find(branch => branch.location.sceneId === 'shared')?.status).toBe('condition-not-met');
    expect(report.paths.map(path => path.choices)).toEqual([[1], [2]]);
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
    expect(explicit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        source: expect.objectContaining({ sceneId: 'prologue', op: 'exp' }),
      }),
    ]));
  });

  it('records both outcomes when a real loop changes the same choice condition', async () => {
    const files: Record<string, string> = {
      'game.config.json': JSON.stringify({ entryScene: 'start', variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/start.gal': '@scene start\n@label top\n@choice\n  下一轮 [if:trust == 0] -> @set trust = 1 @goto top\n  离开 [if:trust == 1] -> @end\n',
    };
    const storage: ProjectStorage = { rootIdentity: 'changing-condition', listFiles: async () => Object.keys(files), exists: async path => path in files,
      readText: async path => { const text = files[path]!; return { path, text, bytes: text.length, sha256: digest(text) }; } };
    const report = simulateSnapshot(await loadProjectSnapshot(storage, hasher));
    expect(report.status).toBe('passed');
    expect(report.coverage.conditions.every(condition => condition.trueCount > 0 && condition.falseCount > 0)).toBe(true);
    expect(report.coverage.branches.map(branch => branch.status)).toEqual(['visited', 'visited']);
    expect(report.paths[0]?.choices).toEqual([0, 1]);
  });

  it('keeps @exp strict when the snapshot has no growth config', async () => {
    const snapshot = await loadProjectSnapshot(growthFixtureStorage(false), hasher);
    const report = await simulateSnapshot(snapshot);

    expect(report.status).toBe('failed');
    expect(report.runtimeErrors).toHaveLength(1);
    expect(report.runtimeErrors[0]?.message).toMatch(/GrowthSystem/);

    const explicit = await runExplicitPath(snapshot, { sceneId: 'prologue', choices: [] });
    expect(explicit.status).toBe('failed');
    expect(explicit.error).toMatch(/GrowthSystem/);
    expect(explicit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        source: expect.objectContaining({ sceneId: 'prologue', op: 'exp' }),
      }),
    ]));
  });
});

/* ============ Reliability Phase 1：headless runtime 必须使用真实 TimelineRegistry ============ */

const TIMELINE_DEFINITION = JSON.stringify({
  version: 1,
  id: 'intro_cine',
  durationMs: 900,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 400, easing: 'outCubic', action: 'set', key: 'hall' }] },
  ],
});

/** 场景引用指定 timeline；项目 timelines 目录恒包含合法 intro_cine（valid 与 missing 用同一 registry 内容区分）。 */
function timelineFixtureStorage(referencedTimelineId: string, definitionId: string = 'intro_cine'): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': JSON.stringify({ entryScene: 'prologue' }),
    'content/scenario/prologue.gal': [
      '@scene prologue',
      `@timeline ${referencedTimelineId} @ blocking`,
      '凛：到达。',
      '@end',
    ].join('\n'),
    'content/timelines/intro_cine.json': JSON.stringify({ ...JSON.parse(TIMELINE_DEFINITION), id: definitionId }),
  };
  return {
    rootIdentity: `timeline-fixture-${referencedTimelineId}`,
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('simulateSnapshot timeline runtime dependency', () => {
  it('passes when the referenced timeline definition is registered', async () => {
    const snapshot = await loadProjectSnapshot(timelineFixtureStorage('intro_cine'), hasher);
    const report = await simulateSnapshot(snapshot);

    expect(report.status).toBe('passed');
    expect(report.runtimeErrors).toEqual([]);
    expect(report.paths.every((path) => path.termination === 'ended')).toBe(true);
  });

  it('fails loud when a scene references a timeline missing from the project registry', async () => {
    const snapshot = await loadProjectSnapshot(timelineFixtureStorage('intro_ghost'), hasher);
    const report = await simulateSnapshot(snapshot);

    expect(report.status).toBe('failed');
    expect(report.runtimeErrors.length).toBeGreaterThan(0);
    expect(report.runtimeErrors[0]?.message).toMatch(/时间轴 'intro_ghost' 未注册/);
  });

  it('runExplicitPath fails loud for the same missing timeline', async () => {
    const snapshot = await loadProjectSnapshot(timelineFixtureStorage('intro_ghost'), hasher);
    const report = await runExplicitPath(snapshot, { sceneId: 'prologue', choices: [] });

    expect(report.status).toBe('failed');
    expect(report.error).toMatch(/时间轴 'intro_ghost' 未注册/);
  });

  it('Phase 2B: fails loud when definition.id diverges from the filename stem (identity invariant)', async () => {
    // Phase 2B 前：runtime 按 internal id 注册，@timeline other 反而 PASS（identity split，CASE C 镜像）。
    const snapshot = await loadProjectSnapshot(timelineFixtureStorage('other', 'other'), hasher);

    expect(() => simulateSnapshot(snapshot)).toThrow(/definition\.id 'other' 与文件名派生 ID 'intro_cine' 不一致/);
    await expect(runExplicitPath(snapshot, { sceneId: 'prologue', choices: [] }))
      .rejects.toThrow(/definition\.id 'other' 与文件名派生 ID 'intro_cine' 不一致/);
  });
});
