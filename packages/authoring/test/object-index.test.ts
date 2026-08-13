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
});
