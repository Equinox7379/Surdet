import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { InMemoryChangeRepository, beginChange, openChange } from '../src/change-session.js';
import { applySceneCreate, applyScenePatch, ensureVariable } from '../src/operations.js';
import { buildObjectIndex } from '../src/object-index.js';
import type { ScenePatchInput } from '../src/contracts.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

function fixtureStorage(configText = '{"entryScene":"prologue","variables":{}}', sceneText = '@scene prologue\n凛：开场。\n@end\n', scenePath = 'content/scenario/prologue.gal'): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': configText,
    [scenePath]: sceneText,
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
  it.each(['\n', '\r\n'])('replaces one instruction in place, preserving surrounding bytes and persistent retries (%j)', async (eol) => {
    const raw = '  @show lynn:coat hesitant @ right  ';
    const source = ['@scene prologue', '// 保留注释', raw, '', '凛：开场。', '@end'].join(eol);
    const path = 'content/scenario/chapter/prologue.gal';
    const storage = fixtureStorage(undefined, source, path);
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const object = buildObjectIndex(snapshot).objects.find((item) => item.source?.raw === raw)!;
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(snapshot, repository);
    const input: ScenePatchInput = { operationId: 'replace-show', patch: {
      kind: 'replaceInstruction', target: object.objectRef, expectedFingerprint: object.fingerprint!,
      instruction: { kind: 'instruction', name: 'show', args: ['lynn:coat', 'smile'], modifiers: { pos: 'right' } },
    } };
    const result = await applyScenePatch(change, input, hasher);
    expect(result).toEqual({ path, line: 3, kind: 'replaceInstruction' });
    expect(change.record.workingFiles[path]).toBe(source.replace(raw, '  @show lynn:coat smile @pos=right  '));
    expect((await storage.readText(path)).text).toBe(source);
    const reopened = openChange((await repository.read(change.record.changeId))!, repository);
    expect(await applyScenePatch(reopened, input, hasher)).toEqual(result);
    expect(reopened.record.workingRevision).toBe(1);
    expect(Object.keys(reopened.record.operations)).toEqual(['replace-show']);
    await expect(applyScenePatch(reopened, { ...input, operationId: 'stale-target' }, hasher))
      .rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
  });

  it.each([
    ['@bg day', 'bg', ['night']],
    ['@hide lynn', 'hide', ['lynn:coat']],
    ['@wait 10', 'wait', ['250']],
  ] as const)('replaces supported instruction %s without adding a line', async (raw, name, args) => {
    const source = `@scene prologue\n${raw}\n凛：开场。\n@end\n`;
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const object = buildObjectIndex(snapshot).objects.find((item) => item.source?.raw === raw)!;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applyScenePatch(change, { operationId: 'replace', patch: {
      kind: 'replaceInstruction', target: object.objectRef, expectedFingerprint: object.fingerprint!,
      instruction: { kind: 'instruction', name, args: [...args] },
    } }, hasher);
    expect(change.record.workingFiles['content/scenario/prologue.gal']).toBe(source.replace(raw, `@${name} ${args.join(' ')}`));
  });

  it.each([
    { label: 'wrong scene', sceneId: 'elsewhere', code: 'OBJECT_PRECONDITION_FAILED' },
    { label: 'wrong object kind', targetKind: 'text', code: 'OBJECT_PRECONDITION_FAILED' },
    { label: 'stale fingerprint', fingerprint: 'deadbeef', code: 'OBJECT_PRECONDITION_FAILED' },
    { label: 'text target', raw: '凛：开场。', code: 'OBJECT_PRECONDITION_FAILED' },
    { label: 'scene declaration', raw: '@scene prologue', code: 'OBJECT_PRECONDITION_FAILED' },
    { label: 'choice structure', raw: '@choice', code: 'OBJECT_PRECONDITION_FAILED' },
    { label: 'control flow replacement', instruction: { kind: 'instruction', name: 'end' }, code: 'INVALID_REQUEST' },
    { label: 'multiline argument', instruction: { kind: 'instruction', name: 'bg', args: ['night\n@end'] }, code: 'INVALID_REQUEST' },
    { label: 'Unicode line separator', instruction: { kind: 'instruction', name: 'bg', args: ['night\u2028@end'] }, code: 'INVALID_REQUEST' },
    { label: 'multiline modifier', instruction: { kind: 'instruction', name: 'show', args: ['lynn'], modifiers: { pos: 'right\r\n@end' } }, code: 'INVALID_REQUEST' },
    { label: 'compiler rejection', instruction: { kind: 'instruction', name: 'wait', args: ['invalid'] }, code: 'INVALID_REQUEST' },
  ])('rejects $label before any persistence', async ({ sceneId, targetKind, fingerprint, raw, instruction, code }) => {
    const source = '@scene prologue\n@show lynn hesitant\n凛：开场。\n@choice\n  继续 -> @goto done\n@label done\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const object = buildObjectIndex(snapshot).objects.find((item) => item.kind !== 'scene' && item.source?.raw === (raw ?? '@show lynn hesitant'))!;
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(snapshot, repository);
    const before = structuredClone(change.record);
    await expect(applyScenePatch(change, { operationId: 'rejected', ...(sceneId === undefined ? {} : { sceneId }), patch: {
      kind: 'replaceInstruction', target: targetKind === undefined ? object.objectRef : object.objectRef.replace('/instruction:', `/${targetKind}:`),
      expectedFingerprint: fingerprint ?? object.fingerprint!,
      instruction: instruction ?? { kind: 'instruction', name: 'show', args: ['lynn', 'smile'] },
    } } as ScenePatchInput, hasher)).rejects.toMatchObject({ code });
    expect(change.record).toEqual(before);
    expect(await repository.read(change.record.changeId)).toEqual(before);
  });

  it.each([
    ['CRLF', '\r\n'],
    ['LF', '\n'],
  ] as const)('preserves the original %s style when writing game.config.json', async (_label, eol) => {
    const source = `${JSON.stringify({ entryScene: 'prologue', variables: {} }, null, 2).replace(/\n/g, eol)}${eol}`;
    const snapshot = await loadProjectSnapshot(fixtureStorage(source), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());

    await ensureVariable(change, {
      operationId: `op-eol-${eol === '\r\n' ? 'crlf' : 'lf'}`,
      name: 'flag.alpha',
      type: 'string',
      initial: '',
    });

    const written = change.record.workingFiles['game.config.json']!;
    expect(written.endsWith(eol)).toBe(true);
    expect(written.replaceAll(eol, '')).not.toContain('\n');
    if (eol === '\n') expect(written).not.toContain('\r\n');
    expect(JSON.parse(written)).toMatchObject({
      variables: { 'flag.alpha': { type: 'string', initial: '' } },
    });
  });

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

  it('creates a variable named __proto__ as an own config property', async () => {
    const change = await beginChange(await loadProjectSnapshot(fixtureStorage(), hasher), new InMemoryChangeRepository());
    await ensureVariable(change, { operationId: 'op-prototype-variable', name: '__proto__', type: 'number', initial: 7 });
    const config = JSON.parse(change.record.workingFiles['game.config.json']!) as { variables: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(config.variables, '__proto__')).toBe(true);
    expect(config.variables['__proto__']).toEqual({ type: 'number', initial: 7 });
  });

  it('serializes typed choice effects as instructions after the arrow', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await ensureVariable(change, { operationId: 'op-choice-variable', name: 'trust', type: 'number', initial: 0 });
    await applySceneCreate(change, {
      operationId: 'op-choice-scene',
      sceneId: 'choice_effects',
      blocks: [{
        kind: 'choice',
        options: [
          { label: '路径 A', effects: [{ name: 'set', args: ['trust', '=', '1'] }], target: { kind: 'goto', value: 'path_a' } },
          { label: '路径 B', effects: [{ name: 'set', args: ['trust', '=', '-1'] }], target: { kind: 'goto', value: 'path_b' } },
        ],
      }, { kind: 'label', name: 'path_a' }, { kind: 'label', name: 'path_b' }],
    });

    const raw = change.record.workingFiles['content/scenario/choice_effects.gal'];
    expect(raw).toContain('  路径 A -> @set trust = 1 @goto path_a');
    expect(raw).toContain('  路径 B -> @set trust = -1 @goto path_b');
    expect(raw).not.toContain('  路径 A @set trust = 1 -> @goto path_a');
    expect(raw).not.toContain('  路径 B @set trust = -1 -> @goto path_b');
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

  it('validates a typed scene patch candidate before persisting working state', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(snapshot, repository);
    const sceneLine = '@scene prologue';
    const beforeFiles = { ...change.record.workingFiles };

    await expect(applyScenePatch(change, {
      operationId: 'op-invalid-patch-set',
      sceneId: 'prologue',
      patch: {
        kind: 'insertAfter',
        anchor: `scene:prologue/instr:1@${digest(sceneLine)}`,
        expectedFingerprint: digest(sceneLine),
        blocks: [{ kind: 'instruction', name: 'set', args: ['affinity', '2'] }],
      },
    })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('C004'),
    });
    expect(change.record.workingFiles).toEqual(beforeFiles);
    expect(change.record.workingRevision).toBe(0);
    expect(change.record.operations).toEqual({});
  });
});
