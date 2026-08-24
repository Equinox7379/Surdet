import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { validateSnapshot } from '../src/validation.js';
import { compileScene } from '@surdet/core';
import { parseSceneDocument } from '../src/scene-document.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';

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
  it('reports a dotted scene ID as SCENE_ID before cross-scene indexing', () => {
    const text = '@scene my.scene\n凛：正文。\n@end\n';
    const snapshot: ProjectSnapshot = {
      rootIdentity: 'dotted-scene-fixture',
      revision: 'revision',
      files: [],
      configFile: null,
      config: {},
      variables: {},
      timelines: [],
      scenes: [{
        id: 'my.scene',
        path: 'content/scenario/my.scene.gal',
        file: { path: 'content/scenario/my.scene.gal', text, bytes: text.length, sha256: 'dotted' },
        document: parseSceneDocument(text),
        compiled: compileScene(text, 'content/scenario/my.scene.gal', 'my.scene'),
      }],
    };

    expect(validateSnapshot(snapshot).issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'SCENE_ID',
      file: 'content/scenario/my.scene.gal',
    }));
  });

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

  it('报告重复 scene ID 的两个物理路径，并保留第二个场景的独有诊断', () => {
    const firstText = '@scene duplicate\n凛：第一份。\n@end\n';
    const secondText = '@scene duplicate\n@jump duplicate.missing\n@end\n';
    const snapshot: ProjectSnapshot = {
      rootIdentity: 'duplicate-fixture',
      revision: 'revision',
      files: [],
      configFile: null,
      config: {},
      variables: {},
      timelines: [],
      scenes: [
        {
          id: 'duplicate',
          path: 'content/scenario/first.gal',
          file: { path: 'content/scenario/first.gal', text: firstText, bytes: firstText.length, sha256: 'first' },
          document: parseSceneDocument(firstText),
          compiled: compileScene(firstText, 'content/scenario/first.gal', 'duplicate'),
        },
        {
          id: 'duplicate',
          path: 'content/scenario/second.gal',
          file: { path: 'content/scenario/second.gal', text: secondText, bytes: secondText.length, sha256: 'second' },
          document: parseSceneDocument(secondText),
          compiled: compileScene(secondText, 'content/scenario/second.gal', 'duplicate'),
        },
      ],
    };

    const result = validateSnapshot(snapshot);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LINT_DUP', file: 'content/scenario/second.gal' }),
      expect.objectContaining({ code: 'J002', file: 'content/scenario/second.gal' }),
    ]));
    const duplicateIssue = result.issues.find((issue) => issue.code === 'LINT_DUP');
    expect(duplicateIssue?.text).toContain('content/scenario/first.gal');
    expect(duplicateIssue?.text).toContain('content/scenario/second.gal');
  });
});
