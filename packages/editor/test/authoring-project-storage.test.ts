import { describe, expect, it, afterEach } from 'vitest';
import { buildObjectIndex } from '@surdet/authoring';
import { commitThemeConfiguration, createEditorProjectStorage, loadEditorProjectSnapshot } from '../src/authoring-project-storage.js';
import { state } from '../src/state.js';

const original = {
  dirName: state.dirName,
  gameConfigText: state.gameConfigText,
  scenes: state.scenes,
  timelines: state.timelines,
  configFiles: state.configFiles,
  configReadErrors: state.configReadErrors,
  dirHandle: state.dirHandle,
  handles: state.handles,
  dirAssets: state.dirAssets,
  reviewWorkspace: state.reviewWorkspace,
  reviewPreviewReadOnly: state.reviewPreviewReadOnly,
  projectLoading: state.projectLoading,
};

afterEach(() => {
  state.dirName = original.dirName;
  state.gameConfigText = original.gameConfigText;
  state.scenes = original.scenes;
  state.timelines = original.timelines;
  state.configFiles = original.configFiles;
  state.configReadErrors = original.configReadErrors;
  state.dirHandle = original.dirHandle;
  state.handles = original.handles;
  state.dirAssets = original.dirAssets;
  state.reviewWorkspace = original.reviewWorkspace;
  state.reviewPreviewReadOnly = original.reviewPreviewReadOnly;
  state.projectLoading = original.projectLoading;
});

describe('editor authoring project storage', () => {
  it('refuses an authoring snapshot with unreadable config instead of omitting its dependencies', async () => {
    state.configReadErrors = { events: 'content/config/events.json 解析失败' };
    await expect(loadEditorProjectSnapshot()).rejects.toThrow(/events.json/);
    await expect(createEditorProjectStorage({ ...state }).listFiles()).rejects.toThrow(/events.json/);
  });
  it('reads dirty in-memory scene text and computes Web Crypto SHA-256', async () => {
    state.dirName = 'memory-project';
    state.gameConfigText = JSON.stringify({ entryScene: 'intro', variables: {} });
    state.scenes = new Map([['intro', {
      id: 'intro', file: 'intro.gal', text: '@scene intro\n凛：dirty。\n@end\n', eol: '\n', dirty: true, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };

    const storage = createEditorProjectStorage();
    expect(await storage.listFiles()).toContain('content/scenario/intro.gal');
    const file = await storage.readText('content/scenario/intro.gal');
    expect(file.text).toContain('dirty');
    expect(file.bytes).toBe(new TextEncoder().encode(file.text).byteLength);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds the shared snapshot/index from the same dirty memory projection', async () => {
    state.dirName = 'memory-project';
    state.gameConfigText = JSON.stringify({ entryScene: 'intro', variables: {} });
    state.scenes = new Map([['intro', {
      id: 'intro', file: 'intro.gal', text: '@scene intro\n@label start\n凛：dirty。\n@end\n', eol: '\n', dirty: true, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };

    const snapshot = await loadEditorProjectSnapshot();
    const index = buildObjectIndex(snapshot);
    expect(snapshot.scenes[0]?.file.text).toContain('dirty');
    expect(index.objects.some((object) => object.objectRef === 'label:intro.start')).toBe(true);
  });

  it('replaces owned theme fields, clears the whole theme with an existing logo, and retains unrelated fields', async () => {
    let diskText = JSON.stringify({ entryScene: 'intro', variables: {},
      theme: { colors: { accent: 7 }, opacity: { panel: 0.5 }, future: { keep: true } },
      player: { titleLogo: 'logo', subtitle: 'untouched' } });
    const handle = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({ write: async (value: unknown) => { diskText = String(value); }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    state.dirName = 'theme-project';
    state.dirHandle = { name: 'theme-project' } as FileSystemDirectoryHandle;
    state.handles = { ...state.handles, gameConfig: handle };
    state.gameConfigText = diskText;
    state.scenes = new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@end\n', eol: '\n', dirty: false, handle: null }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    state.configReadErrors = {};
    state.dirAssets = [
      { key: 'logo', kind: 'bg', isImage: true, handle: null, sourcePath: 'content/assets/bg/logo.png', bytes: 4 },
      { key: 'mark', kind: 'bg', isImage: true, handle: null, sourcePath: 'content/assets/bg/mark.png', bytes: 4 },
      { key: 'body', kind: 'font', isImage: false, handle: null, sourcePath: 'content/assets/fonts/body.ttf', bytes: 4 },
    ];
    state.reviewWorkspace = null;
    state.reviewPreviewReadOnly = false;
    state.projectLoading = false;

    const replaced = await commitThemeConfiguration({ colors: { accent: 8 } }, 'logo', diskText);
    const afterReplace = JSON.parse(diskText) as Record<string, any>;
    expect(replaced.text).toBe(diskText);
    expect(afterReplace.theme).toEqual({ colors: { accent: 8 }, future: { keep: true } });
    expect(afterReplace.player).toEqual({ titleLogo: 'logo', subtitle: 'untouched' });

    await expect(commitThemeConfiguration('bad' as unknown as Record<string, unknown>, 'logo', diskText)).rejects.toThrow('theme 必须是对象或 null');
    await expect(commitThemeConfiguration({ future: { keep: false } }, 'logo', diskText)).rejects.toThrow('不属于当前编辑器表单');
    expect(JSON.parse(diskText)).toEqual(afterReplace);

    const cleared = await commitThemeConfiguration(null, 'mark', diskText);
    const afterClear = JSON.parse(diskText) as Record<string, any>;
    expect(cleared.text).toBe(diskText);
    expect(afterClear).not.toHaveProperty('theme');
    expect(afterClear.player).toEqual({ titleLogo: 'mark', subtitle: 'untouched' });
    expect(JSON.parse((await createEditorProjectStorage().readText('game.config.json')).text)).toEqual(afterClear);

    await commitThemeConfiguration(null, null, diskText);
    expect((JSON.parse(diskText) as Record<string, any>).player).toEqual({ subtitle: 'untouched' });
    await commitThemeConfiguration(null, null, diskText, { fonts: { body: 'content/assets/fonts/body.ttf' }, titleBackground: 'logo' });
    expect(JSON.parse(diskText).fonts).toEqual({ body: 'content/assets/fonts/body.ttf' });
    expect(JSON.parse(diskText).player).toEqual({ subtitle: 'untouched', titleBackground: 'logo' });
    const withFont = diskText;
    await expect(commitThemeConfiguration(null, null, diskText, { fonts: { body: 'missing.ttf' } })).rejects.toThrow();
    expect(diskText).toBe(withFont);
    await commitThemeConfiguration(null, null, diskText, { fonts: null, titleBackground: null });
    expect(JSON.parse(diskText)).not.toHaveProperty('fonts');
    expect(JSON.parse(diskText).player).toEqual({ subtitle: 'untouched' });
  });
});
