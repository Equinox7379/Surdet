import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { validateSnapshot } from '../src/validation.js';

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
    'game.config.json': JSON.stringify({ entryScene: 'prologue', variables: { trust: { type: 'number', initial: 0 } } }),
    'content/scenario/prologue.gal': [
      '@scene prologue',
      '@choice',
      '  正向 -> @set trust = 1 @jump prologue.missing',
      '  负向 -> @set trust = -1 @goto fallback',
      '@label fallback',
      '凛：结束。',
      '@end',
    ].join('\n'),
  };
  return {
    rootIdentity: 'validation-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('validateSnapshot', () => {
  it('reports a missing choice target with J002, objectRef and a repair action', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot));

    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'J002',
      objectRef: expect.stringContaining('choice-option'),
      action: expect.stringContaining('创建或修正标签'),
    }));
  });
});
