import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
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

function fixtureStorage(
  order: 'normal' | 'reverse' = 'normal',
  growthText = JSON.stringify({ curve: { base: 10 }, profiles: [] }),
): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': '{"entryScene":"prologue","variables":{}}',
    'content/config/growth.json': growthText,
    'content/scenario/prologue.gal': '@scene prologue\n凛：一样\n凛：一样\n@end',
    'content/scenario/other.gal': '@scene other\n凛：另一场\n@end',
    'content/timelines/intro.json': '{"tracks":[]}',
    'content/ignored.txt': 'not part of a snapshot',
  };
  const paths = Object.keys(contents);
  if (order === 'reverse') paths.reverse();
  return {
    rootIdentity: 'fixture-root',
    listFiles: async () => paths,
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('project snapshot', () => {
  it('keeps project revision independent from file enumeration order', async () => {
    const normal = await loadProjectSnapshot(fixtureStorage('normal'), hasher);
    const reverse = await loadProjectSnapshot(fixtureStorage('reverse'), hasher);

    expect(normal.revision).toBe(reverse.revision);
    expect(normal.files.map((file) => file.path)).toEqual([
      'content/config/growth.json',
      'content/scenario/other.gal',
      'content/scenario/prologue.gal',
      'content/timelines/intro.json',
      'game.config.json',
    ]);
  });

  it('includes growth config in the snapshot and revision', async () => {
    const original = await loadProjectSnapshot(fixtureStorage(), hasher);
    const changed = await loadProjectSnapshot(
      fixtureStorage('normal', JSON.stringify({ curve: { base: 20 }, profiles: [] })),
      hasher,
    );

    expect(original.growthFile?.path).toBe('content/config/growth.json');
    expect(original.growthConfig).toEqual({ curve: { base: 10 }, profiles: [] });
    expect(original.revision).not.toBe(changed.revision);
  });
});
