import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { buildObjectIndex } from '../src/object-index.js';
import { applyScenePatch } from '../src/operations.js';
import { parseSceneDocument } from '../src/scene-document.js';
import { runExplicitPath } from '../src/simulation.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';

function snapshot(intro: string): ProjectSnapshot {
  const variables = { visited: { type: 'number', initial: 0 } }, config = { entryScene: 'intro', variables };
  const configText = JSON.stringify(config);
  const configFile = { path: 'game.config.json', text: configText, bytes: configText.length, sha256: 'fixture' };
  const scenes = Object.entries({ intro, home: '@scene home\n@set visited = 7\n@end\n' }).map(([id, text]) => {
    const file = { path: `content/scenario/${id}.gal`, text, bytes: text.length, sha256: 'fixture' };
    return { id, path: file.path, file, document: parseSceneDocument(text), compiled: compileScene(text, file.path, id) };
  });
  return { rootIdentity: 'loop-replace-test', revision: '00000000', files: [configFile, ...scenes.map(scene => scene.file)], configFile,
    config, entryScene: 'intro', variables, scenes, timelines: [] };
}

describe('shared replaceInstruction accepts a genuine literal loop source', () => {
  it.each([['loop', 'done', 2], ['goto', 'done', 2], ['jump', 'home', 7]] as const)('replaces literal loop with @%s %s and executes the new destination', async (name, target, visited) => {
    const source = '@scene intro\r\n@label a\r\nA\r\n@label b\r\nB\r\n  @loop a  \r\n@label done\r\n@set visited = 2\r\n@end\r\n';
    const original = snapshot(source);
    const object = buildObjectIndex(original).objects.find(item => item.source?.raw === '  @loop a  ')!;
    const change = await beginChange(original, new InMemoryChangeRepository());
    await applyScenePatch(change, { operationId: `retarget-${name}`, sceneId: 'intro', patch: {
      kind: 'replaceInstruction', target: object.objectRef, expectedFingerprint: object.fingerprint!,
      instruction: { kind: 'instruction', name, args: [target] },
    } });
    const after = change.record.workingFiles['content/scenario/intro.gal']!;
    expect(after).toBe(source.replace('@loop a', `@${name} ${target}`));
    expect(await runExplicitPath(snapshot(after), { sceneId: 'intro', label: 'b', choices: [], maxSteps: 40 }))
      .toMatchObject({ status: 'passed', finalVariables: { visited } });
    expect(original.scenes[0]!.file.text).toBe(source);
  });

  it('round-trips literal loop without normalizing its opcode or surrounding whitespace', async () => {
    const source = '@scene intro\r\n@label a\r\nA\r\n  @loop a  \r\n';
    const original = snapshot(source);
    const object = buildObjectIndex(original).objects.find(item => item.source?.raw === '  @loop a  ')!;
    const change = await beginChange(original, new InMemoryChangeRepository());
    await applyScenePatch(change, { operationId: 'loop-round-trip', sceneId: 'intro', patch: {
      kind: 'replaceInstruction', target: object.objectRef, expectedFingerprint: object.fingerprint!,
      instruction: { kind: 'instruction', name: 'loop', args: ['a'] },
    } });
    expect(change.record.workingFiles['content/scenario/intro.gal']).toBe(source);
    expect(compileScene(source, 'content/scenario/intro.gal', 'intro').instructions.find(item => item.line === 4))
      .toMatchObject({ op: 'jump', kind: 'goto', target: 'a' });
  });

  it('still rejects a replacement loop with no target before persisting any change', async () => {
    const source = '@scene intro\n@label a\nA\n@loop a\n';
    const original = snapshot(source);
    const object = buildObjectIndex(original).objects.find(item => item.source?.raw === '@loop a')!;
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(original, repository), before = structuredClone(change.record);
    await expect(applyScenePatch(change, { operationId: 'invalid-loop', sceneId: 'intro', patch: {
      kind: 'replaceInstruction', target: object.objectRef, expectedFingerprint: object.fingerprint!,
      instruction: { kind: 'instruction', name: 'loop', args: [] },
    } })).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: expect.stringContaining('@loop 缺少') });
    expect(change.record).toEqual(before);
    expect(await repository.read(change.record.changeId)).toEqual(before);
  });
});
