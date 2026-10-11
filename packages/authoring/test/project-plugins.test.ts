import { expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { inspectProject } from '../src/object-index.js';
import { simulateSnapshot, findPreviewPath, runExplicitPath } from '../src/simulation.js';
import { parseSceneDocument } from '../src/scene-document.js';
import { validateSnapshot } from '../src/validation.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';
const plugins = [{ id: 'counter', entry: 'plugins/counter.ts', apiVersion: 1, stateVersion: 1,
  instructions: [{ name: 'count', blocking: false, parameters: [{ name: 'amount', type: 'number' }] }] }];
function snapshot(text: string): ProjectSnapshot {
  const path = 'content/scenario/intro.gal';
  return { rootIdentity: 'fixture', revision: 'r', files: [], configFile: null, config: { plugins, entryScene: 'intro', variables: {} },
    variables: {}, entryScene: 'intro', timelines: [], scenes: [{ id: 'intro', path, document: parseSceneDocument(text),
      file: { path, text, sha256: 'fixture', bytes: text.length }, compiled: compileScene(text, path, 'intro', ['count']) }] };
}
it('publishes exact declarations and validates parameters without running project code', () => {
  const project = snapshot('@count bad\n之后。');
  expect(inspectProject(project).plugins).toEqual(plugins);
  expect(validateSnapshot(project).issues.filter(issue => issue.code === 'PLUGIN_ARGUMENT')).toMatchObject([{ line: 1, severity: 'error' }]);
});
it('marks plugin paths unexecuted/incomplete instead of inventing an ending or passing evidence', async () => {
  const project = snapshot('@count 2\n之后。\n@clear final\n@end');
  const report = simulateSnapshot(project);
  expect(report.status).toBe('incomplete'); expect(report.paths[0]).toMatchObject({ status: 'incomplete', termination: 'requires-extension' });
  expect(report.coverage.stops[0]).toMatchObject({ kind: 'requires-extension', location: { line: 1 } }); expect(report.endings).toEqual([]);
  const target = findPreviewPath(project, { sceneId: 'intro', line: 2 });
  expect(target.status).toBe('requires-extension'); expect(target.position).toBeNull();
  expect(findPreviewPath(project, { sceneId: 'intro', line: 1 }).status).toBe('requires-extension');
  expect(await runExplicitPath(project, { sceneId: 'intro', choices: [] })).toMatchObject({ status: 'failed', error: expect.stringContaining('PLUGIN_REQUIRED') });
});
