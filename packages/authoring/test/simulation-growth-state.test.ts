import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import type { ProjectSnapshot } from '../src/project-snapshot.js';
import { parseSceneDocument } from '../src/scene-document.js';
import { findPreviewPath, runExplicitPath, simulateSnapshot } from '../src/simulation.js';

function project(text: string): ProjectSnapshot {
  const file = { path: 'content/scenario/start.gal', text, bytes: text.length, sha256: 'fixture' };
  const variables = { attack: { type: 'number', initial: 0 } };
  return {
    rootIdentity: 'growth-state-test', revision: 'fixture', files: [file], configFile: null,
    config: { entryScene: 'start', variables }, entryScene: 'start', variables, timelines: [],
    growthConfig: { curve: { base: 2, linear: 0 }, profiles: [{ characterId: 'lynn', statGrowth: { attack: 1 } }] },
    scenes: [{ id: 'start', path: file.path, file, document: parseSceneDocument(text), compiled: compileScene(text, file.path, 'start') }],
  };
}

const training = [
  '@scene start', '@label train', '@choice',
  '  Train -> @goto gain', '  Exit -> @end',
  '@label gain', '@exp lynn 1', '@if attack > 0', '@check false', '@endif', '@goto train',
].join('\n');

describe('growth state in automatic exploration', () => {
  it('records the failing synchronous choice and continues the remaining sibling branch', () => {
    const snapshot = project('@scene start\n@choice\n  Fail -> @check false\n  Exit -> @end');
    const report = simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });
    expect(report).toMatchObject({ status: 'failed', budgetExhausted: false });
    expect(report.paths).toEqual([
      expect.objectContaining({ choices: [0], status: 'failed', termination: 'error', error: expect.stringContaining('@check') }),
      expect.objectContaining({ choices: [1], status: 'passed', termination: 'ended' }),
    ]);
  });

  it('finds the real failure after two training choices before exhausting the budget', async () => {
    const snapshot = project(training);
    const explicit = await runExplicitPath(snapshot, { sceneId: 'start', choices: [0, 0] });
    expect(explicit).toMatchObject({ status: 'failed', finalVariables: { attack: 1 } });
    expect(explicit.error).toContain('@check');
    const report = simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });
    expect(report.budgetExhausted).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.paths).toContainEqual(expect.objectContaining({ choices: [0, 0], status: 'failed', finalVariables: { attack: 1 } }));
  });

  it('searches to the same target reached by an explicit training path', () => {
    const snapshot = project(training);
    const target = { sceneId: 'start', line: 9, maxPaths: 20, maxStepsPerPath: 200 };
    expect(findPreviewPath(snapshot, { ...target, mode: 'path', choices: [0, 0] }))
      .toMatchObject({ status: 'reached', finalVariables: { attack: 1 } });
    expect(findPreviewPath(snapshot, target))
      .toMatchObject({ status: 'reached', choices: [0, 0], finalVariables: { attack: 1 } });
  });

  it('retains different experience at a non-looping choice convergence', async () => {
    const snapshot = project([
      '@scene start', '@choice', '  Skip -> @goto join', '  Train -> @exp lynn 1 @goto join',
      '@label join', '@choice', '  Continue -> @goto finish',
      '@label finish', '@exp lynn 1', '@if attack > 0', '@check false', '@endif', '@end',
    ].join('\n'));
    expect(await runExplicitPath(snapshot, { sceneId: 'start', choices: [0, 0] })).toMatchObject({ status: 'passed', finalVariables: { attack: 0 } });
    expect(await runExplicitPath(snapshot, { sceneId: 'start', choices: [1, 0] })).toMatchObject({ status: 'failed', finalVariables: { attack: 1 } });
    const report = simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });
    expect(report.budgetExhausted).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.paths).toContainEqual(expect.objectContaining({ choices: [1, 0], status: 'failed' }));
  });

  it('still prunes a loop with unchanged growth and reaches its exit', () => {
    const snapshot = project(training.replace('@exp lynn 1', '@exp lynn 0'));
    const report = simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });
    expect(report).toMatchObject({ status: 'passed', budgetExhausted: false, cyclesPruned: 1 });
    expect(report.paths).toContainEqual(expect.objectContaining({ choices: [1], termination: 'ended' }));
  });

  it('bounds a changing growth loop by the path budget rather than pruning it as equal', () => {
    const snapshot = project(training.replace('@check false', '@check true'));
    const report = simulateSnapshot(snapshot, { maxPaths: 5, maxStepsPerPath: 200 });
    expect(report).toMatchObject({ status: 'incomplete', budgetExhausted: true, pathsExplored: 5, cyclesPruned: 0 });
    expect(report.runtimeErrors).toEqual([]);
  });
});
