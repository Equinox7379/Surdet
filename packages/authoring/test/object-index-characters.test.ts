import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';

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
    'game.config.json': JSON.stringify({
      title: 'Starter',
      version: '0.1.0',
      entryScene: 'ch01_01',
      characters: { lynn: { name: '凛', avatar: 'lynn' }, nova: { name: '诺瓦' } },
      variables: {},
    }),
    'content/scenario/ch01_01.gal': ['@scene ch01_01', '凛：你好。', '诺瓦：我是新的。', '@end'].join('\n'),
    'content/scenario/prologue.gal': ['@scene prologue', '凛：序章。', '@end'].join('\n'),
  };
  return {
    rootIdentity: 'fixture-root',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error('missing fixture file: ' + path);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('character object index', () => {
  it('indexes characters and their avatar references', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const lynn = index.byRef.get('character:lynn');
    expect(lynn).toBeDefined();
    expect(lynn!.kind).toBe('character');
    expect(lynn!.semanticId).toBe('character:lynn');
    expect(lynn!.source?.path).toBe('game.config.json');
    expect(lynn!.references).toEqual(['asset:avatar:lynn']);
    const avatar = index.byRef.get('asset:avatar:lynn');
    expect(avatar).toBeDefined();
    expect(avatar!.kind).toBe('asset');
    expect(avatar!.referencedBy).toContain('character:lynn');
  });

  it('links text speaker to character and keeps the reverse edge', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const lynnText = index.objects.find((object) => object.kind === 'text' && object.source?.raw.includes('凛：你好'));
    const novaText = index.objects.find((object) => object.kind === 'text' && object.source?.raw.includes('诺瓦：我是新的'));
    expect(lynnText).toBeDefined();
    expect(lynnText!.references).toEqual(['character:lynn']);
    expect(novaText!.references).toEqual(['character:nova']);
    expect(index.byRef.get('character:lynn')!.referencedBy).toContain(lynnText!.objectRef);
    expect(index.byRef.get('character:nova')!.referencedBy).toContain(novaText!.objectRef);
  });

  it('indexes the entryScene as a reference to the scene object', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const entry = index.byRef.get('config:entryScene');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('entry-scene');
    expect(entry!.references).toEqual(['scene:ch01_01']);
    expect(index.byRef.get('scene:ch01_01')!.referencedBy).toContain('config:entryScene');
  });
});
