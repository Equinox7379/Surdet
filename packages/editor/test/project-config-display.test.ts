import { describe, expect, it, afterEach } from 'vitest';
import { buildAssetCatalog, buildObjectIndex, loadProjectSnapshot } from '@surdet/authoring';
import { createEditorProjectStorage } from '../src/authoring-project-storage.js';
import { recordAssetPath } from '../src/project-io.js';
import { describeAuthoringReference } from '../src/causal-selection.js';
import { state } from '../src/state.js';

const originalDirAssets = state.dirAssets;

afterEach(() => {
  state.dirAssets = originalDirAssets;
});

describe('project config display', () => {
  it('resolves avatar catalog entries identically to the CLI contract', () => {
    const catalog = buildAssetCatalog(['content/assets/avatar/lynn.svg', 'content/assets/avatar/nova.svg']);
    expect(catalog.avatars.map((entry) => entry.key)).toEqual(['lynn', 'nova']);
    expect(catalog.avatars[0]).toEqual({
      kind: 'avatar', key: 'lynn', sourcePath: 'content/assets/avatar/lynn.svg', format: 'svg', resolved: true,
    });
  });

  it('enumerates avatar paths from the editor directory scan without reading binaries', async () => {
    state.dirName = 'config-project';
    state.gameConfigText = JSON.stringify({ title: 'Starter', entryScene: 'ch01_01', characters: { lynn: { name: '凛', avatar: 'lynn' } }, variables: {} });
    state.scenes = new Map([['ch01_01', {
      id: 'ch01_01', file: 'ch01_01.gal', text: '@scene ch01_01\n凛：你好。\n@end\n', eol: '\n', dirty: false, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    const avatarHandle = { kind: 'file', name: 'lynn.svg' } as unknown as FileSystemFileHandle;
    recordAssetPath(avatarHandle, 'content/assets/avatar/lynn.svg');
    state.dirAssets = [{ key: 'lynn', kind: 'avatar', handle: avatarHandle, isImage: true }];
    const storage = createEditorProjectStorage();
    expect(await storage.listFiles()).toContain('content/assets/avatar/lynn.svg');
    const snapshot = await loadProjectSnapshot(storage, storage);
    expect(snapshot.files.map((file) => file.path)).not.toContain('content/assets/avatar/lynn.svg');
  });

  it('indexes speaker->character edges and describes them readably', async () => {
    const contents: Record<string, string> = {
      'game.config.json': JSON.stringify({
        title: 'Starter', entryScene: 'ch01_01',
        characters: { lynn: { name: '凛', avatar: 'lynn' }, nova: { name: '诺瓦' } },
        variables: {},
      }),
      'content/scenario/ch01_01.gal': ['@scene ch01_01', '凛：你好。', '诺瓦：登场。', '@end'].join('\n'),
    };
    const hasher = { sha256: async (text: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    } };
    const snapshot = await loadProjectSnapshot({
      rootIdentity: 'display-fixture',
      listFiles: async () => Object.keys(contents),
      readText: async (path: string) => {
        const text = contents[path];
        if (text === undefined) throw new Error('missing: ' + path);
        return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
      },
      exists: async (path: string) => path in contents,
    }, hasher);
    const index = buildObjectIndex(snapshot);
    const novaText = index.objects.find((object) => object.kind === 'text' && object.source?.raw.includes('诺瓦：登场'));
    expect(novaText?.references).toEqual(['character:nova']);
    expect(index.byRef.get('character:lynn')?.references).toEqual(['asset:avatar:lynn']);
    expect(describeAuthoringReference('character:nova')).toBe('角色 nova');
    expect(describeAuthoringReference('asset:avatar:lynn')).toBe('头像 lynn');
    expect(describeAuthoringReference('config:entryScene')).toBe('入口场景');
    expect(index.byRef.get('config:entryScene')?.references).toEqual(['scene:ch01_01']);
  });
});
