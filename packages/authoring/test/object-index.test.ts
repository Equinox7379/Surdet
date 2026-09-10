import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { parseSceneDocument } from '../src/scene-document.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

function fixtureSnapshotStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': '{"entryScene":"prologue","variables":{}}',
    'content/scenario/prologue.gal': '@scene prologue\n凛：一样\n凛：一样\n@end',
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

describe('revision-scoped object index', () => {
  it('gives duplicate dialogue lines distinct revision-scoped refs', async () => {
    const snapshot = await loadProjectSnapshot(fixtureSnapshotStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const texts = index.objects.filter((object) => object.kind === 'text');
    expect(texts).toHaveLength(2);
    expect(texts[0]!.objectRef).not.toBe(texts[1]!.objectRef);
    expect(texts.every((object) => object.objectRef.includes(snapshot.revision.slice(0, 8)))).toBe(true);
  });

  it('indexes choice effects and the final jump as direct relationships', async () => {
    const contents: Record<string, string> = {
      'game.config.json': '{"entryScene":"ch01_01","variables":{"trust":{"type":"number","initial":0}}}',
      'content/scenario/ch01_01.gal': [
        '@scene ch01_01',
        '凛：Agent 纵向切片起点。',
        '@choice',
        '  路径 A -> @set trust = 1 @goto path_a',
        '  路径 B -> @set trust = -1 @goto path_b',
        '@label path_a',
        '凛：Agent 路径 A 后续台词。',
        '@label path_b',
        '凛：Agent 路径 B 后续台词。',
        '@end',
      ].join('\n'),
    };
    const storage: ProjectStorage = {
      rootIdentity: 'choice-relations-fixture',
      listFiles: async () => Object.keys(contents),
      readText: async (path): Promise<ProjectFile> => {
        const text = contents[path];
        if (text === undefined) throw new Error(`missing fixture file: ${path}`);
        return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
      },
      exists: async (path) => path in contents,
    };

    const snapshot = await loadProjectSnapshot(storage, hasher);
    const index = buildObjectIndex(snapshot);
    const options = index.objects.filter((object) => object.kind === 'choice-option');
    expect(options).toHaveLength(2);
    expect(options[0]!.references).toEqual(['variable:trust', 'label:ch01_01.path_a']);
    expect(options[1]!.references).toEqual(['variable:trust', 'label:ch01_01.path_b']);
    expect(index.byRef.get('variable:trust')!.referencedBy).toEqual([
      options[0]!.objectRef,
      options[1]!.objectRef,
    ]);
    expect(index.byRef.get('label:ch01_01.path_a')!.referencedBy).toEqual([options[0]!.objectRef]);
    expect(index.byRef.get('label:ch01_01.path_b')!.referencedBy).toEqual([options[1]!.objectRef]);

    const scene = index.byRef.get('scene:ch01_01')!;
    expect(scene.childRefs).toContain('label:ch01_01.path_a');
    expect(scene.childRefs).toContain('label:ch01_01.path_b');
    const children = scene.childRefs!.map((ref) => index.byRef.get(ref)!);
    expect(children.every((child) => child.parentRef === scene.objectRef)).toBe(true);
    expect(children.filter((child) => child.kind === 'text').map((child) => child.source!.raw)).toEqual([
      '凛：Agent 纵向切片起点。',
      '凛：Agent 路径 A 后续台词。',
      '凛：Agent 路径 B 后续台词。',
    ]);
    const choice = children.find((child) => child.kind === 'choice')!;
    expect(choice.childRefs).toEqual(options.map((option) => option.objectRef));
    expect(options.every((option) => option.parentRef === choice.objectRef)).toBe(true);
    expect(scene.childRefs).not.toContain(options[0]!.objectRef);
  });

  it('keeps parseable references after a malformed choice line', async () => {
    const contents: Record<string, string> = {
      'game.config.json': '{"entryScene":"entry","variables":{}}',
      'content/scenario/entry.gal': '@scene entry\n@end',
      'content/scenario/later.gal': '@scene later\n@end',
    };
    const storage: ProjectStorage = {
      rootIdentity: 'partial-analysis-fixture',
      listFiles: async () => Object.keys(contents),
      readText: async (path): Promise<ProjectFile> => {
        const text = contents[path];
        if (text === undefined) throw new Error(`missing fixture file: ${path}`);
        return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
      },
      exists: async (path) => path in contents,
    };
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const entry = snapshot.scenes.find((scene) => scene.id === 'entry')!;
    const malformed = [
      '@scene entry',
      '@choice',
      '  Broken -> @set value = "unterminated',
      '@jump later',
      '@end',
    ].join('\n');
    entry.file = { ...entry.file, text: malformed };
    entry.document = parseSceneDocument(malformed);

    const index = buildObjectIndex(snapshot);
    const jump = index.objects.find((object) => object.source?.raw === '@jump later');
    expect(jump).toBeDefined();
    expect(jump!.references).toEqual(['scene:later']);
    const brokenOption = index.objects.find((object) => object.kind === 'choice-option');
    expect(brokenOption).toBeDefined();
    expect(brokenOption!.references).toEqual([]);
  });
});
