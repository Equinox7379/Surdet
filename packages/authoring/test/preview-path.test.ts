import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { findPreviewPath } from '../src/simulation.js';
import { parseSceneDocument } from '../src/scene-document.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';

function project(sources: Record<string, string>, variables: Record<string, unknown> = {}): ProjectSnapshot {
  const files = Object.entries(sources).map(([id, text]) => ({ path: `content/scenario/${id}.gal`, text, bytes: text.length, sha256: 'fixture' }));
  return { rootIdentity: 'preview-path-test', revision: 'fixture', files, configFile: null, config: {}, variables, entryScene: Object.keys(sources)[0], timelines: [],
    scenes: files.map((file, i) => ({ id: Object.keys(sources)[i]!, path: file.path, file, document: parseSceneDocument(file.text), compiled: compileScene(file.text, file.path, Object.keys(sources)[i]!) })) };
}

describe('preview target path through the real Core debugger', () => {
  const entry = '@bg harbor\n@bgm theme\n@choice\n  回家 -> @set trust = 1 @jump home\n  留下 -> @end\n@end';
  const home = '@label arrival\n@set trust += 2\n凛：回家了。\n@end';
  const vars = { trust: { type: 'number', initial: 0 } };

  it('searches across a scene and choice, stopping before the actual target with preceding variables intact', () => {
    const snapshot = project({ entry, home }, vars);
    const result = findPreviewPath(snapshot, { sceneId: 'home', line: 3 });
    expect(result.status).toBe('reached'); expect(result.choices).toEqual([0]);
    expect(result.position).toMatchObject({ sceneId: 'home', line: 3, op: 'text' });
    expect(result.finalVariables).toEqual({ trust: 3 }); expect(result.partialStage).toBe(false);
    expect(snapshot.variables.trust).toEqual({ type: 'number', initial: 0 });
    expect(result.coverage.scenes.find(scene => scene.sceneId === 'home')?.executedInstructions).toBe(2);
  });
  it('uses the supplied path and refuses missing or currently hidden choices', () => {
    const snapshot = project({ entry, home }, vars);
    expect(findPreviewPath(snapshot, { sceneId: 'home', line: 3, mode: 'path', choices: [0] }).status).toBe('reached');
    expect(findPreviewPath(snapshot, { sceneId: 'home', line: 3, mode: 'path', choices: [] }).status).toBe('path-mismatch');
    expect(findPreviewPath(project({ entry: '@choice\n  回家 [if:trust > 0] -> @jump home\n  留下 -> @end', home }, vars), { sceneId: 'home', line: 3, mode: 'path', choices: [0] }).status).toBe('path-mismatch');
  });
  it('uses the exact seed, including zero, for actual random conditions on the route', () => {
    const snapshot = project({ entry: '@random trust 0 100\n@if trust > 50\n@jump home\n@endif\n@end', home }, vars);
    expect(findPreviewPath(snapshot, { sceneId: 'home', line: 3, seed: 0 })).toMatchObject({ status: 'unreachable', seed: 0 });
    expect(findPreviewPath(snapshot, { sceneId: 'home', line: 3, seed: 1 })).toMatchObject({ status: 'reached', seed: 1, finalVariables: { trust: 65 } });
  });
  it('starts test mode at the nearest label with ephemeral typed variables, without running the earlier stage prelude', () => {
    const snapshot = project({ entry, home }, vars);
    const result = findPreviewPath(snapshot, { sceneId: 'home', line: 3, mode: 'test', variables: { trust: 8 } });
    expect(result).toMatchObject({ status: 'reached', entryScene: 'home', entryLabel: 'arrival', partialStage: true, finalVariables: { trust: 10 }, initialVariables: { trust: 8 } });
    expect(result.coverage.scenes.find(scene => scene.sceneId === 'entry')?.visited).toBe(false);
    expect(snapshot.variables.trust).toEqual({ type: 'number', initial: 0 });
    expect(() => findPreviewPath(snapshot, { sceneId: 'home', line: 3, mode: 'test', variables: { trust: 'wrong type' } })).toThrow();
  });
  it('reports unreachable and actual false conditions separately from exhausted budgets', () => {
    const snapshot = project({ entry: '@if trust > 0\n@jump home\n@endif\n@end', home }, vars);
    const result = findPreviewPath(snapshot, { sceneId: 'home', line: 3 });
    expect(result.status).toBe('unreachable'); expect(result.position).toBeNull();
    expect(result.coverage.conditions).toEqual(expect.arrayContaining([expect.objectContaining({ falseCount: 1 })]));
    expect(findPreviewPath(project({ entry, home }, vars), { sceneId: 'home', line: 3, maxPaths: 1 }).status).toBe('budget-exhausted');
    expect(findPreviewPath(project({ entry: '@label loop\n@goto loop', home }, vars), { sceneId: 'home', line: 3, maxStepsPerPath: 5 }).status).toBe('budget-exhausted');
  });
  it('resolves labels and option rows honestly, while rejecting non-executable comments', () => {
    const snapshot = project({ entry, home }, vars);
    expect(findPreviewPath(snapshot, { sceneId: 'home', line: 1 }).target).toMatchObject({ kind: 'label-entry', requestedLine: 1, line: 1 });
    expect(findPreviewPath(snapshot, { sceneId: 'entry', line: 4 }).target).toMatchObject({ kind: 'choice-group', requestedLine: 4, line: 3 });
    expect(() => findPreviewPath(project({ entry: '// comment\ntext' }), { sceneId: 'entry', line: 1 })).toThrow(/可执行/);
  });
  it('does not invent state beyond a host operation', () => {
    const result = findPreviewPath(project({ entry: '@calendar next\n后文' }), { sceneId: 'entry', line: 2 });
    expect(result.status).toBe('host-boundary'); expect(result.position).toBeNull();
  });
  it('reaches a repeated target visit on an explicit path using real choices', () => {
    const snapshot = project({ entry: '@label again\n正文\n@choice\n  再来 -> @goto again\n  结束 -> @end' });
    const result = findPreviewPath(snapshot, { sceneId: 'entry', line: 2, mode: 'path', choices: [0], targetVisit: 2 });
    expect(result).toMatchObject({ status: 'reached', targetVisit: 2, choices: [0] });
  });
});
