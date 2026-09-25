import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { InMemoryChangeRepository, beginChange, openChange } from '../src/change-session.js';
import { applySceneCreate, applyScenePatch, ensureVariable } from '../src/operations.js';
import { buildObjectIndex } from '../src/object-index.js';
import type { SceneBlockInput, ScenePatchInput } from '../src/contracts.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

function fixtureStorage(configText = '{"entryScene":"prologue","variables":{}}', sceneText = '@scene prologue\n凛：开场。\n@end\n', scenePath = 'content/scenario/prologue.gal', extraFiles: Record<string, string> = {}): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': configText,
    [scenePath]: sceneText,
    ...extraFiles,
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
  it('protects gallery text replay entries when deleting or renaming their label', async () => {
    const gallery = '\uFEFF{\r\n  "texts": [{"id":"memory","scene":"prologue","label":"memory","name":"memory","custom":42}], "custom":{"label":"memory"}\r\n}\r\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, '@scene prologue\r\n@label memory\r\n回想。\r\n@end\r\n', undefined, { 'content/config/gallery.json': gallery, 'content/scenario/caller.gal': '@scene caller\n@call prologue.memory\n@end\n' }), hasher);
    const label = buildObjectIndex(snapshot).byRef.get('label:prologue.memory')!;
    const change = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, { composition: { mode: 'direct', operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
    const before = structuredClone(change.record);
    await expect(applyScenePatch(change, { operationId: 'delete-gallery-label', patch: { kind: 'removeLabel', target: label.objectRef, expectedFingerprint: label.fingerprint! } }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED', details: { references: expect.arrayContaining([expect.objectContaining({ path: 'content/config/gallery.json', kind: 'gallery-text', target: 'prologue.memory' }), expect.objectContaining({ path: 'content/scenario/caller.gal', kind: 'call', target: 'prologue.memory' })]) } });
    expect(change.record).toEqual(before);
    await applyScenePatch(change, { operationId: 'rename-gallery-label', patch: { kind: 'renameLabel', target: label.objectRef, expectedFingerprint: label.fingerprint!, name: 'recollection' } }, hasher);
    const rewritten = change.record.workingFiles['content/config/gallery.json']!;
    expect(rewritten.startsWith('\uFEFF')).toBe(true);
    expect(rewritten.replace(/\r\n/g, '')).not.toContain('\n');
    expect(JSON.parse(rewritten.replace(/^\uFEFF/, ''))).toEqual({ texts: [{ id: 'memory', scene: 'prologue', label: 'recollection', name: 'memory', custom: 42 }], custom: { label: 'memory' } });
  });

  it('renames direct labels across real local/cross-scene targets without rewriting prose or quoted choice text', async () => {
    const a = '@scene a\r\n  @label entry  \r\n@if false\r\n@goto entry\r\n@loop entry\r\n@switch route 1:entry 2:unused\r\n@endif\r\n已到达。\r\n@return\r\n@label unused\r\n@end\r\n';
    const b = '@scene b\n旁白：@call a.entry 是正文。\n@call a.entry\n@choice\n  甲 [if:" -> @call a.entry " == " -> @call a.entry "] -> @call a.entry @goto done\n  乙 -> @jump a.entry\n@label done\n@end\n';
    const c = '@scene c\n@label entry\n保留同名标签。\n@end\n';
    const storage = fixtureStorage('{"entryScene":"b","variables":{"route":{"type":"number","initial":1}}}', a, 'content/scenario/nested/a.gal', { 'content/scenario/b.gal': b, 'content/scenario/c.gal': c });
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const label = buildObjectIndex(snapshot).byRef.get('label:a.entry')!;
    expect(label.fingerprint).toEqual(expect.any(String));
    const change = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, { composition: { mode: 'direct', operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
    const before = structuredClone(change.record);
    await expect(applyScenePatch(change, { operationId: 'delete-used', patch: { kind: 'removeLabel', target: label.objectRef, expectedFingerprint: label.fingerprint! } } as ScenePatchInput, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED', details: { references: expect.arrayContaining([expect.objectContaining({ path: 'content/scenario/b.gal', kind: 'call', target: 'a.entry' })]) } });
    expect(change.record).toEqual(before);
    const input = { operationId: 'rename', patch: { kind: 'renameLabel', target: label.objectRef, expectedFingerprint: label.fingerprint!, name: 'arrival' } } as ScenePatchInput;
    const result = await applyScenePatch(change, input, hasher);
    expect(change.record.workingFiles['content/scenario/nested/a.gal']).toBe(a.replace('@label entry', '@label arrival').replace('@goto entry', '@goto arrival').replace('@loop entry', '@loop arrival').replace('1:entry', '1:arrival'));
    expect(change.record.workingFiles['content/scenario/b.gal']).toBe(b.replace('\n@call a.entry', '\n@call a.arrival').replace('] -> @call a.entry', '] -> @call a.arrival').replace('-> @jump a.entry', '-> @jump a.arrival'));
    expect(change.record.workingFiles['content/scenario/c.gal']).toBe(c);
    const after = structuredClone(change.record);
    expect(await applyScenePatch(change, input, hasher)).toEqual(result);
    expect(change.record).toEqual(after);
    await expect(applyScenePatch(change, { ...input, operationId: 'stale' }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    const unused = buildObjectIndex(snapshot).byRef.get('label:a.unused')!;
    await expect(applyScenePatch(change, { operationId: 'delete-switch-used', patch: { kind: 'removeLabel', target: unused.objectRef, expectedFingerprint: unused.fingerprint! } } as ScenePatchInput, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    const isolated = buildObjectIndex(snapshot).byRef.get('label:c.entry')!;
    await applyScenePatch(change, { operationId: 'delete-unused', patch: { kind: 'removeLabel', target: isolated.objectRef, expectedFingerprint: isolated.fingerprint! } } as ScenePatchInput, hasher);
    expect(change.record.workingFiles['content/scenario/c.gal']).toBe(c.replace('@label entry\n', ''));
    const candidate = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, { composition: { mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
    const candidateBefore = structuredClone(candidate.record);
    for (const patch of [input.patch, { kind: 'removeLabel', target: label.objectRef, expectedFingerprint: label.fingerprint! }]) {
      await expect(applyScenePatch(candidate, { operationId: 'candidate-blocked', patch } as ScenePatchInput, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
      expect(candidate.record).toEqual(candidateBefore);
    }
  });

  it('rejects scene creation when that semantic ID exists in a nested directory', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, undefined, 'content/scenario/chapter/prologue.GAL'), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    const before = structuredClone(change.record);
    await expect(applySceneCreate(change, { operationId: 'duplicate', sceneId: 'prologue' }, hasher))
      .rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(change.record).toEqual(before);
  });

  it('rejects inserting blocks inside a choice without changing its remaining options', async () => {
    const source = '@scene prologue\n@choice\n    甲 -> @goto done\n    乙\n    丙\n@label done\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const objects = buildObjectIndex(snapshot).objects;
    const first = objects.find(item => item.source?.raw === '    甲 -> @goto done')!;
    for (const blocks of [[{ kind: 'text' as const, value: '正文' }], [{ kind: 'instruction' as const, name: 'wait', args: ['10'] }]]) {
      const change = await beginChange(snapshot, new InMemoryChangeRepository());
      const before = structuredClone(change.record);
      await expect(applyScenePatch(change, { operationId: 'insert', patch: { kind: 'insertAfter', anchor: first.objectRef,
        expectedFingerprint: first.fingerprint!, blocks } }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
      expect(change.record).toEqual(before);
    }
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applyScenePatch(change, { operationId: 'option', patch: { kind: 'replaceChoiceOption', target: first.objectRef,
      expectedFingerprint: first.fingerprint!, option: { label: '改名', target: { kind: 'goto', value: 'done' } } } }, hasher);
    expect(change.record.workingFiles['content/scenario/prologue.gal']).toBe(source.replace('甲', '改名'));
  });

  it.each(['// 想显示的正文', '@set gold = 999', '新正文\n@set gold = 999\n@end', '正文\r@end', '正文\r\n@end', '角色：不能变成说话人', ''])('rejects text that changes DSL meaning without persisting (%j)', async (value) => {
    const source = '@scene prologue\n原文\n尾段应该保留\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const target = buildObjectIndex(snapshot).objects.find(item => item.kind === 'text' && item.source?.raw === '原文')!;
    for (const mode of ['create', 'insert', 'replace'] as const) {
      const change = await beginChange(snapshot, new InMemoryChangeRepository());
      const before = structuredClone(change.record);
      const request = mode === 'create'
        ? applySceneCreate(change, { operationId: 'text', sceneId: 'new_scene', blocks: [{ kind: 'text', value }] }, hasher)
        : applyScenePatch(change, { operationId: 'text', patch: mode === 'replace'
          ? { kind: 'replaceText', target: target.objectRef, expectedFingerprint: target.fingerprint!, value }
          : { kind: 'insertAfter', anchor: target.objectRef, expectedFingerprint: target.fingerprint!, blocks: [{ kind: 'text', value }] } }, hasher);
      await expect(request).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(change.record).toEqual(before);
    }
  });

  it.each(['\u2028', '\u2029'])('typed text preserves supported Unicode characters and the following paragraph (%j)', async separator => {
    const source = '@scene prologue\n原文\n尾段应该保留\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const target = buildObjectIndex(snapshot).objects.find(item => item.kind === 'text' && item.source?.raw === '原文')!;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    const value = `前半句${separator}后半句`;
    await applyScenePatch(change, { operationId: 'replace', patch: { kind: 'replaceText', target: target.objectRef, expectedFingerprint: target.fingerprint!, value } }, hasher);
    expect(change.record.workingFiles['content/scenario/prologue.gal']).toBe(source.replace('原文', value));
    await applySceneCreate(change, { operationId: 'create', sceneId: 'new_scene', blocks: [{ kind: 'text', speaker: '凛', value }] }, hasher);
    expect(change.record.workingFiles['content/scenario/new_scene.gal']).toContain(`凛：${value}`);
  });

  it('ensures variables in BOM configuration while preserving unrelated fields and retries', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage('\uFEFF{"entryScene":"prologue","variables":{},"custom":{"keep":true}}'), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    const input = { operationId: 'bom', name: 'score', type: 'number' as const, initial: 0 };
    expect(await ensureVariable(change, input, hasher)).toEqual({ name: 'score', created: true });
    expect(await ensureVariable(change, input, hasher)).toEqual({ name: 'score', created: true });
    expect(JSON.parse(change.record.workingFiles['game.config.json']!.replace(/^\uFEFF/, ''))).toMatchObject({ custom: { keep: true }, variables: { score: { type: 'number', initial: 0 } } });
  });
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
    ['@set trust = 1', 'mod', ['trust', '+2']],
    ['@mod trust +1', 'set', ['trust', '=', '4']],
    ['@goto destination', 'jump', ['other_scene.end']],
    ['@jump other_scene.end', 'goto', ['destination']],
    ['@transition slide 200', 'flash', ['white', '200']],
    ['@particle snow', 'mov', ['lynn:normal', 'left', '100']],
  ] as const)('replaces state, jump and representative visual instruction %s', async (raw, name, args) => {
    const source = ['@scene prologue', '@label destination', raw, '@label end', '@end'].join('\n');
    const path = 'content/scenario/prologue.gal';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source, path), hasher);
    const object = buildObjectIndex(snapshot).objects.find((item) => item.source?.raw === raw)!;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applyScenePatch(change, { operationId: `replace-${name}`, patch: {
      kind: 'replaceInstruction', target: object.objectRef, expectedFingerprint: object.fingerprint!,
      instruction: { kind: 'instruction', name, args: [...args] },
    } }, hasher);
    expect(change.record.workingFiles[path]).toContain(`@${name} ${args.join(' ')}`);
    expect(change.record.workingFiles[path]).not.toContain(raw);
  });

  it('keeps audio instructions outside the single-line replacement whitelist', async () => {
    const source = '@scene prologue\n@voice narrator\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const voice = buildObjectIndex(snapshot).objects.find((item) => item.source?.raw === '@voice narrator')!;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await expect(applyScenePatch(change, { operationId: 'replace-voice', patch: {
      kind: 'replaceInstruction', target: voice.objectRef, expectedFingerprint: voice.fingerprint!,
      instruction: { kind: 'instruction', name: 'bg', args: ['night'] },
    } }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(change.record.workingFiles['content/scenario/prologue.gal']).toBe(source);
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

  it.each<{ name: string; blocks: SceneBlockInput[]; body: string }>([
    { name: 'empty scene', blocks: [], body: '@end\n' },
    { name: 'implicit end', blocks: [{ kind: 'text', value: '终章。' }], body: '终章。\n@end\n' },
    {
      name: 'explicit end',
      blocks: [{ kind: 'text', value: '终章。' }, { kind: 'instruction', name: 'clear', args: ['done'] }, { kind: 'instruction', name: 'end' }],
      body: '终章。\n@clear done\n@end\n',
    },
    {
      name: 'separate branch endings',
      blocks: [
        { kind: 'instruction', name: 'end' }, { kind: 'label', name: 'alternate' },
        { kind: 'text', value: '另一个终点。' }, { kind: 'instruction', name: 'end' },
      ],
      body: '@end\n@label alternate\n另一个终点。\n@end\n',
    },
    {
      name: 'conditional end still needs a scene terminator',
      blocks: [{ kind: 'condition', branches: [{ kind: 'if', expr: 'false', blocks: [{ kind: 'instruction', name: 'end' }] }] }],
      body: '@if false\n  @end\n@endif\n@end\n',
    },
  ])('preserves scene termination when creating $name', async ({ blocks, body }) => {
    const storage = fixtureStorage();
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(await loadProjectSnapshot(storage, hasher), repository);
    const input = { operationId: 'create-ending', sceneId: 'ending', blocks };
    await applySceneCreate(change, input, hasher);
    expect(change.record.workingFiles['content/scenario/ending.gal']).toBe(`@scene ending\n${body}`);
    const saved = structuredClone(change.record);
    await applySceneCreate(change, input, hasher);
    expect(change.record).toEqual(saved);
    expect(await repository.read(change.record.changeId)).toEqual(saved);
    expect(await storage.exists('content/scenario/ending.gal')).toBe(false);
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

  it('replaces a complete choice group while keeping its row-level identity and separators', async () => {
    const source = [
      '@scene prologue',
      '@choice',
      '  Continue [if:trust > 0] -> @set trust = 1 @goto continue',
      '// keep separator',
      '',
      '  Leave -> @goto leave',
      '@label continue',
      '@label leave',
      '@end',
    ].join('\n');
    const storage = fixtureStorage('{"entryScene":"prologue","variables":{"trust":{"type":"number","initial":0}}}', source);
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const choice = buildObjectIndex(snapshot).objects.find((object) => object.kind === 'choice')!;
    const structure = (choice.details as { structure: { fingerprint: string } }).structure;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    const result = await applyScenePatch(change, {
      operationId: 'replace-choice-group',
      patch: {
        kind: 'replaceChoiceGroup',
        target: choice.objectRef,
        expectedFingerprint: structure.fingerprint,
        choice: {
          kind: 'choice',
          options: [
            { label: 'Leave first', effects: [{ name: 'set', args: ['trust', '=', '2'] }], target: { kind: 'goto', value: 'leave' } },
            { label: 'Continue second', when: 'trust > 0', target: { kind: 'jump', value: 'next' } },
          ],
        },
      },
    }, hasher);
    expect(result).toEqual({ path: 'content/scenario/prologue.gal', line: 2, kind: 'replaceChoiceGroup' });
    const written = change.record.workingFiles['content/scenario/prologue.gal']!;
    expect(written).toContain('@choice\n  Leave first -> @set trust = 2 @goto leave\n// keep separator\n\n  Continue second [if:trust > 0] -> @jump next');
    expect(written).not.toContain('  Continue [if:trust > 0]');
    expect(written).not.toContain('  Leave -> @goto leave');
    expect(await storage.readText('content/scenario/prologue.gal')).toMatchObject({ text: source });
    expect(change.record.workingRevision).toBe(1);
  });

  it('keeps the legacy choice-option replacement usable after transparent comment rows', async () => {
    const source = '@scene prologue\n@choice\n  First -> @goto first\n// separator\n  Second -> @goto second\n@label first\n@label second\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const option = buildObjectIndex(snapshot).objects.find((object) => object.kind === 'choice-option' && object.source?.line === 5)!;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applyScenePatch(change, {
      operationId: 'replace-choice-option-after-comment',
      patch: {
        kind: 'replaceChoiceOption',
        target: option.objectRef,
        expectedFingerprint: option.fingerprint!,
        option: { label: 'Changed', target: { kind: 'goto', value: 'second' } },
      },
    }, hasher);
    expect(change.record.workingFiles['content/scenario/prologue.gal']).toContain('// separator\n  Changed -> @goto second');
  });

  it('replaces condition branches atomically and preserves omitted sourceBranch bodies byte-for-byte', async () => {
    const source = [
      '@scene prologue',
      '@if outer',
      '// preserve outer comment',
      'A',
      '@if inner',
      'N',
      '@else',
      'M',
      '@endif',
      '@elif fallback',
      'B',
      '@else',
      '// preserve else comment',
      'C',
      '@endif',
      '@end',
    ].join('\n');
    const storage = fixtureStorage(undefined, source);
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const index = buildObjectIndex(snapshot);
    const condition = index.objects.find((object) => object.kind === 'condition' && object.source?.line === 2)!;
    const details = (condition.details as { structure: { fingerprint: string; branches: Array<{ objectRef: string }> } }).structure;
    const originalBody = ['// preserve outer comment', 'A', '@if inner', 'N', '@else', 'M', '@endif'].join('\n');
    const originalElse = ['// preserve else comment', 'C'].join('\n');
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applyScenePatch(change, {
      operationId: 'replace-condition-block',
      patch: {
        kind: 'replaceConditionBlock',
        target: condition.objectRef,
        expectedFingerprint: details.fingerprint,
        condition: {
          kind: 'condition',
          branches: [
            { kind: 'if', expr: 'outerChanged', sourceBranch: details.branches[0]!.objectRef },
            { kind: 'elif', expr: 'newFlag', blocks: [{ kind: 'text', speaker: '凛', value: 'new branch' }] },
            { kind: 'else', sourceBranch: details.branches[2]!.objectRef },
          ],
        },
      },
    }, hasher);
    const written = change.record.workingFiles['content/scenario/prologue.gal']!;
    expect(written).toContain('@if outerChanged\n' + originalBody);
    expect(written).toContain('@elif newFlag\n凛：new branch\n@else\n' + originalElse + '\n@endif');
    expect(written).not.toContain('@elif fallback');
    expect(written).not.toContain('\nB\n');
    expect(await storage.readText('content/scenario/prologue.gal')).toMatchObject({ text: source });
    expect(change.record.workingRevision).toBe(1);

    const beforeRejected = structuredClone(change.record);
    await expect(applyScenePatch(change, {
      operationId: 'stale-condition-block',
      patch: {
        kind: 'replaceConditionBlock',
        target: condition.objectRef,
        expectedFingerprint: details.fingerprint,
        condition: { kind: 'condition', branches: [{ kind: 'if', expr: 'again', blocks: [] }] },
      },
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(change.record).toEqual(beforeRejected);
  });

  it.each(['\r\n', '\r'] as const)('keeps condition edits in the source EOL style (%j)', async (eol) => {
    const source = [
      '@scene prologue',
      '@if keep',
      '// preserve this body',
      '凛：原文',
      '@else',
      '凛：备用',
      '@endif',
      '@end',
    ].join(eol) + eol;
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const condition = buildObjectIndex(snapshot).objects.find((object) => object.kind === 'condition')!;
    const details = (condition.details as { structure: { fingerprint: string; branches: Array<{ objectRef: string }> } }).structure;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applyScenePatch(change, {
      operationId: `condition-eol-${eol === '\r' ? 'cr' : 'crlf'}`,
      patch: {
        kind: 'replaceConditionBlock',
        target: condition.objectRef,
        expectedFingerprint: details.fingerprint,
        condition: {
          kind: 'condition',
          branches: [
            { kind: 'if', expr: 'keep', sourceBranch: details.branches[0]!.objectRef },
            { kind: 'elif', expr: 'new_flag', blocks: [{ kind: 'text', speaker: '凛', value: '新增正文' }] },
            { kind: 'else', sourceBranch: details.branches[1]!.objectRef },
          ],
        },
      },
    }, hasher);
    const written = change.record.workingFiles['content/scenario/prologue.gal']!;
    expect(written).toContain(`@elif new_flag${eol}凛：新增正文${eol}@else`);
    expect(written).toContain(`// preserve this body${eol}凛：原文`);
    expect(written.replaceAll(eol, '')).not.toContain('\n');
    if (eol === '\r\n') expect(written).not.toContain('\r\r');
  });

  it('rejects a nested branch reference when replacing an outer condition', async () => {
    const source = '@scene prologue\n@if outer\n@if inner\nA\n@endif\n@else\nB\n@endif\n@end\n';
    const snapshot = await loadProjectSnapshot(fixtureStorage(undefined, source), hasher);
    const index = buildObjectIndex(snapshot);
    const outer = index.objects.find((object) => object.kind === 'condition' && object.source?.line === 2)!;
    const nested = index.objects.find((object) => object.kind === 'condition' && object.source?.line === 3)!;
    const nestedBranch = index.byRef.get(nested.childRefs![0]!)!;
    const outerDetails = (outer.details as { structure: { fingerprint: string } }).structure;
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    const before = structuredClone(change.record);
    await expect(applyScenePatch(change, {
      operationId: 'nested-source-branch',
      patch: {
        kind: 'replaceConditionBlock',
        target: outer.objectRef,
        expectedFingerprint: outerDetails.fingerprint,
        condition: {
          kind: 'condition',
          branches: [{ kind: 'if', expr: 'changed', sourceBranch: nestedBranch.objectRef }],
        },
      },
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(change.record).toEqual(before);
  });

  it('creates nested condition blocks through the same typed scene operation', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const change = await beginChange(snapshot, new InMemoryChangeRepository());
    await applySceneCreate(change, {
      operationId: 'create-condition-scene',
      sceneId: 'condition_scene',
      blocks: [{
        kind: 'condition',
        branches: [
          { kind: 'if', expr: 'trust > 0', blocks: [{ kind: 'text', speaker: '凛', value: 'positive' }] },
          { kind: 'else', blocks: [{ kind: 'instruction', name: 'bg', args: ['night'] }] },
        ],
      }],
    });
    expect(change.record.workingFiles['content/scenario/condition_scene.gal']).toContain('@if trust > 0\n  凛：positive\n@else\n  @bg night\n@endif');
  });
});
