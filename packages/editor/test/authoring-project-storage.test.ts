import { describe, expect, it, afterEach } from 'vitest';
import { buildObjectIndex, inspectTextCatalog, exportTextCatalogCsv, previewTextCatalogImport } from '@surdet/authoring';
import { commitEndScenes, commitTextCatalogPatch, commitThemeConfiguration, commitUiConfiguration, createEditorProjectStorage, loadEditorProjectSnapshot, parseThemeEditorDraft, projectThemeEditorDraft } from '../src/authoring-project-storage.js';
import type { ProjectUiDocument } from '@surdet/core';
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
  it('U1 UI save reads the real file and rejects invalid slices without writing config', async () => {
    let disk = JSON.stringify({ entryScene: 'intro', variables: {}, future: 'keep' }), writes = 0;
    let image = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>';
    const handle = { getFile: async () => new File([disk], 'game.config.json'), createWritable: async () => ({
      write: async (text: unknown) => { disk = String(text); writes++; }, close: async () => {},
    }) } as unknown as FileSystemFileHandle;
    const imageHandle = { getFile: async () => new File([image], 'paper.svg') } as FileSystemFileHandle;
    Object.assign(state, { dirName: 'ui-style', dirHandle: { name: 'ui-style' }, handles: { ...state.handles, gameConfig: handle }, gameConfigText: disk,
      scenes: new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@end\n', eol: '\n', dirty: false, handle: null }]]), timelines: [],
      configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null }, configReadErrors: {},
      dirAssets: [{ sourcePath: 'content/assets/bg/paper.svg', handle: imageHandle }], reviewWorkspace: null, reviewPreviewReadOnly: false, projectLoading: false });
    const ui: ProjectUiDocument = { version: 1, pages: { title: { id: 'panel', type: 'container', frame: { x: 0, y: 0, width: 200, height: 100 },
      style: { fontWeight: 700, backgroundImage: { asset: 'paper', fit: 'stretch', slice: { top: 10, right: 10, bottom: 10, left: 10, fillCenter: true } } } } } };
    const initial = disk;
    image = '<svg width="10" height="10"/>';
    await expect(commitUiConfiguration(ui, initial)).rejects.toThrow('九宫格'); expect(writes).toBe(0); expect(disk).toBe(initial);
    image = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"/>';
    await commitUiConfiguration(ui, initial);
    expect(writes).toBe(1); expect(JSON.parse(disk)).toMatchObject({ future: 'keep', ui });
    expect((await loadEditorProjectSnapshot()).config.ui).toEqual(ui);
  });
  it('distinguishes a missing in-memory config from an existing empty config', async () => {
    state.gameConfigText = '';
    state.handles = { ...state.handles, gameConfig: null };
    state.configReadErrors = {};
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    state.scenes = new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n旁白：内存正文。\n@end\n', eol: '\n', dirty: true, handle: null }]]);
    state.timelines = [];
    const storage = createEditorProjectStorage();
    expect(await storage.exists('game.config.json')).toBe(false);
    const snapshot = await loadEditorProjectSnapshot();
    expect(snapshot.configFile).toBeNull();
    expect(snapshot.config).toEqual({});
    expect(snapshot.scenes[0]?.file.text).toContain('内存正文');
    state.handles = { ...state.handles, gameConfig: {} as FileSystemFileHandle };
    await expect(loadEditorProjectSnapshot()).rejects.toThrow(/game.config.json/);
    expect(state.gameConfigText).toBe('');
  });
  it('saves a reviewed translation through the shared transaction and preserves disk on stale/external changes', async () => {
    let disk = JSON.stringify({ entryScene: 'intro', variables: {}, future: 'preserve' }), writes = 0;
    const handle = { getFile: async () => new File([disk], 'game.config.json'), createWritable: async () => ({
      write: async (text: unknown) => { disk = String(text); writes++; }, close: async () => {},
    }) } as unknown as FileSystemFileHandle;
    Object.assign(state, { dirName: 'texts', dirHandle: { name: 'texts' }, handles: { ...state.handles, gameConfig: handle }, gameConfigText: disk,
      scenes: new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n旁白：你好。\n@end\n', eol: '\n', dirty: false, handle: null }]]), timelines: [],
      configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null }, configReadErrors: {}, dirAssets: [],
      reviewWorkspace: null, reviewPreviewReadOnly: false, projectLoading: false });
    const hasher = createEditorProjectStorage(), first = await inspectTextCatalog(await loadEditorProjectSnapshot(), hasher);
    const binding = { operationId: 'bind', expectedRevision: first.revision, expectedFingerprint: first.fingerprint,
      patch: { type: 'bind' as const, sourceLocale: 'zh-CN', bindings: [{ key: 'hello', sourceId: first.sources[0]!.sourceId }] } };
    state.scenes.get('intro')!.dirty = true;
    await expect(commitTextCatalogPatch(binding)).rejects.toThrow('先保存剧本'); expect(writes).toBe(0);
    state.scenes.get('intro')!.dirty = false;
    await commitTextCatalogPatch(binding); expect(writes).toBe(1);
    await expect(commitTextCatalogPatch(binding)).rejects.toThrow('项目版本变化'); expect(writes).toBe(1);
    const view = await inspectTextCatalog(await loadEditorProjectSnapshot(), hasher);
    const csv = exportTextCatalogCsv(view).replace('"","untranslated"', '"Hello.","untranslated"');
    const preview = await previewTextCatalogImport(await loadEditorProjectSnapshot(), hasher, 'en', csv);
    expect(preview.ready).toBe(true); expect(writes).toBe(1);
    await commitTextCatalogPatch({ operationId: 'import', expectedRevision: preview.revision, expectedFingerprint: preview.fingerprint,
      patch: { type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint } });
    expect(writes).toBe(2); expect(JSON.parse(disk).future).toBe('preserve');
    expect((await inspectTextCatalog(await loadEditorProjectSnapshot(), hasher)).entries[0]).toMatchObject({ status: 'translated', translations: { en: { value: 'Hello.' } } });
    const saved = state.gameConfigText, fresh = await inspectTextCatalog(await loadEditorProjectSnapshot(), hasher);
    disk = JSON.stringify({ ...JSON.parse(disk), future: 'external' });
    await expect(commitTextCatalogPatch({ operationId: 'remove', expectedRevision: fresh.revision, expectedFingerprint: fresh.fingerprint, patch: { type: 'remove', keys: ['hello'] } })).rejects.toThrow();
    expect(writes).toBe(2); expect(state.gameConfigText).toBe(saved); expect(JSON.parse(disk).future).toBe('external');
  });
  it('includes terminology in revision and refuses a text binding if its actual disk source changed', async () => {
    let disk = '{"entryScene":"intro","variables":{}}', writes = 0;
    let terms = '{"terms":[{"canonical":"雾港","variants":[]}]}';
    const gameConfig = { getFile: async () => new File([disk], 'game.config.json'), createWritable: async () => ({ write: async (text: unknown) => { disk = String(text); writes++; }, close: async () => {} }) } as unknown as FileSystemFileHandle;
    const terminology = { getFile: async () => new File([terms], 'terminology.json') } as FileSystemFileHandle;
    Object.assign(state, { dirName: 'terms', dirHandle: { name: 'terms' }, handles: { ...state.handles, gameConfig, terminology }, gameConfigText: disk,
      scenes: new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@end\n', eol: '\n', dirty: false, handle: null }]]), timelines: [],
      configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: JSON.parse(terms) }, configReadErrors: {}, dirAssets: [], reviewWorkspace: null, reviewPreviewReadOnly: false, projectLoading: false });
    const hasher = createEditorProjectStorage(), snapshot = await loadEditorProjectSnapshot();
    expect(snapshot.files.some(file => file.path === 'content/config/terminology.json')).toBe(true);
    const view = await inspectTextCatalog(snapshot, hasher);
    const request = { operationId: 'term-bind', expectedRevision: view.revision, expectedFingerprint: view.fingerprint,
      patch: { type: 'bind' as const, sourceLocale: 'zh-CN', bindings: [{ key: 'term.port', sourceId: view.sources[0]!.sourceId }] } };
    terms = '{"terms":[{"canonical":"外部改稿","variants":[]}]}';
    await expect(commitTextCatalogPatch(request)).rejects.toThrow(); expect(writes).toBe(0);
    terms = '{"terms":[{"canonical":"雾港","variants":[]}]}';
    await commitTextCatalogPatch(request); expect(writes).toBe(1);
    expect(JSON.parse(disk).textCatalog.entries[0].source.objectRef).toBe('term:雾港');
  });
  it.each(['remove-all', 'replace-both', 'still-missing'] as const)('validates only the final multi-page UI repair: %s', async mode => {
    const frame = { x: 0, y: 0, width: 1280, height: 720 };
    const ui: ProjectUiDocument = { version: 1, pages: {
      title: { id: 'title-image', type: 'image', frame, asset: 'gone-title' },
      hud: { id: 'hud-image', type: 'image', frame, asset: 'gone-hud' },
    } };
    let disk = JSON.stringify({ entryScene: 'intro', variables: {}, future: 'preserve', ui });
    let writes = 0;
    const handle = { getFile: async () => new File([disk], 'game.config.json'), createWritable: async () => ({
      write: async (text: unknown) => { disk = String(text); writes++; }, close: async () => {},
    }) } as unknown as FileSystemFileHandle;
    Object.assign(state, { dirName: 'ui-repair', dirHandle: { name: 'ui-repair' }, handles: { ...state.handles, gameConfig: handle }, gameConfigText: disk,
      scenes: new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@end\n', eol: '\n', dirty: false, handle: null }]]), timelines: [],
      configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null }, configReadErrors: {}, dirAssets: [],
      reviewWorkspace: null, reviewPreviewReadOnly: false, projectLoading: false });
    const baseline = disk;
    const replacement: ProjectUiDocument | null = mode === 'remove-all' ? null : { version: 1, pages: {
      title: { id: 'hud-image', type: 'container', frame },
      hud: mode === 'still-missing' ? ui.pages.title : { id: 'title-image', type: 'container', frame },
    } };
    if (mode === 'still-missing') {
      await expect(commitUiConfiguration(replacement, baseline)).rejects.toThrow('gone-title');
      expect(disk).toBe(baseline); expect(state.gameConfigText).toBe(baseline); expect(writes).toBe(0);
    } else {
      await commitUiConfiguration(replacement, baseline);
      expect(JSON.parse(disk)).toEqual({ entryScene: 'intro', variables: {}, future: 'preserve', ...(replacement ? { ui: replacement } : {}) });
      expect(state.gameConfigText).toBe(disk); expect(writes).toBe(1);
    }
  });
  it('moves stable UI identities across pages atomically and refuses stale or invalid final documents', async () => {
    const frame = { x: 0, y: 0, width: 1280, height: 720 };
    const ui: ProjectUiDocument = { version: 1, pages: {
      title: { id: 'first', type: 'container', frame, children: [] },
      hud: { id: 'second', type: 'container', frame, children: [] },
    } };
    let disk = JSON.stringify({ entryScene: 'intro', variables: {}, future: 'preserve', ui });
    let writes = 0;
    const handle = { getFile: async () => new File([disk], 'game.config.json'), createWritable: async () => ({
      write: async (text: unknown) => { disk = String(text); writes++; }, close: async () => {},
    }) } as unknown as FileSystemFileHandle;
    Object.assign(state, { dirName: 'ui-project', dirHandle: { name: 'ui-project' }, handles: { ...state.handles, gameConfig: handle }, gameConfigText: disk,
      scenes: new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@end\n', eol: '\n', dirty: false, handle: null }]]), timelines: [],
      configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null }, configReadErrors: {}, dirAssets: [],
      reviewWorkspace: null, reviewPreviewReadOnly: false, projectLoading: false });
    const baseline = disk;
    const swapped: ProjectUiDocument = { version: 1, pages: { title: ui.pages.hud, hud: ui.pages.title } };
    await commitUiConfiguration(swapped, baseline);
    expect(JSON.parse(disk)).toEqual({ entryScene: 'intro', variables: {}, future: 'preserve', ui: swapped });
    expect(writes).toBe(1);
    const saved = disk;
    await expect(commitUiConfiguration(ui, baseline)).rejects.toThrow('配置已经改变');
    await expect(commitUiConfiguration({ version: 1, pages: { title: ui.pages.title, hud: ui.pages.title } }, saved)).rejects.toThrow('重复');
    expect(disk).toBe(saved); expect(state.gameConfigText).toBe(saved); expect(writes).toBe(1);
    disk = JSON.stringify({ ...JSON.parse(disk), future: 'external' });
    await expect(commitUiConfiguration(ui, saved)).rejects.toThrow();
    expect(JSON.parse(disk).future).toBe('external'); expect(state.gameConfigText).toBe(saved); expect(writes).toBe(1);
  });
  it.each([
    { theme: { colors: { accent: 9 } }, titleLogo: null, titleBackground: 'dock', font: null, fonts: null },
    { theme: null, titleLogo: null, titleBackground: 'dock', font: null, fonts: null },
    { theme: { colors: { accent: 9 } }, titleLogo: 'mark', titleBackground: 'mark', font: 'content/assets/fonts/body.ttf', fonts: { title: 'content/assets/fonts/body.ttf' } },
    { theme: null, titleLogo: 'mark', titleBackground: null, font: null, fonts: {} },
  ])('saves the valid final full form when the old logo is missing: %j', async form => {
    let diskText = JSON.stringify({ entryScene: 'intro', variables: {}, future: { keep: true },
      theme: { colors: { accent: 8 }, future: { keep: true } }, player: { titleLogo: 'gone', titleBackground: 'dock', subtitle: 'preserve' } });
    let writes = 0;
    const handle = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({ write: async (v: unknown) => { diskText = String(v); writes++; }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    Object.assign(state, { dirName: 'theme-repair', dirHandle: { name: 'theme-repair' }, handles: { ...state.handles, gameConfig: handle }, gameConfigText: diskText,
      scenes: new Map([['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@end\n', eol: '\n', dirty: false, handle: null }]]), timelines: [],
      configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null }, configReadErrors: {},
      dirAssets: ['bg/dock.svg', 'bg/mark.svg', 'fonts/body.ttf'].map(path => ({ key: path.split('/').at(-1)!.split('.')[0], kind: path.startsWith('bg/') ? 'bg' : 'font', isImage: path.startsWith('bg/'), handle: null, sourcePath: `content/assets/${path}`, bytes: 4 })),
      reviewWorkspace: null, reviewPreviewReadOnly: false, projectLoading: false });
    const before = diskText;
    const draft = parseThemeEditorDraft(JSON.stringify(form));
    const expected = projectThemeEditorDraft(JSON.parse(before), draft);
    await commitThemeConfiguration(draft.theme, draft.titleLogo, before, draft.playerConfig);
    expect(JSON.parse(diskText)).toEqual(expected);
    expect(state.gameConfigText).toBe(diskText);
    expect(writes).toBe(1);
    await expect(commitThemeConfiguration(draft.theme, draft.titleLogo, before, draft.playerConfig)).rejects.toThrow('配置已经改变');
    const saved = diskText;
    await expect(commitThemeConfiguration(draft.theme, 'missing-new-logo', saved, { ...draft.playerConfig, font: 'missing.ttf' })).rejects.toThrow();
    expect(diskText).toBe(saved);
    expect(state.gameConfigText).toBe(saved);
    expect(writes).toBe(1);
  });

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

    await expect(commitThemeConfiguration('bad' as unknown as Record<string, unknown>, 'logo', diskText)).rejects.toThrow('主题配置必须是对象');
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
    await commitThemeConfiguration(null, null, diskText, { fonts: { body: null, ui: 'content/assets/fonts/body.ttf' } });
    expect(JSON.parse(diskText).fonts).toEqual({ ui: 'content/assets/fonts/body.ttf' });
    await commitThemeConfiguration(null, null, diskText, { fonts: null, titleBackground: null });
    expect(JSON.parse(diskText)).not.toHaveProperty('fonts');
    expect(JSON.parse(diskText).player).toEqual({ subtitle: 'untouched' });
  });
  it('writes only player.endScenes, keeps an empty list distinct from unset and refuses unknown scenes', async () => {
    let diskText = JSON.stringify({ entryScene: 'intro', variables: {}, player: { subtitle: 'untouched', future: { keep: true } } });
    const handle = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({ write: async (value: unknown) => { diskText = String(value); }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    state.dirName = 'endings-project';
    state.dirHandle = { name: 'endings-project' } as FileSystemDirectoryHandle;
    state.handles = { ...state.handles, gameConfig: handle };
    state.gameConfigText = diskText;
    state.scenes = new Map([
      ['intro', { id: 'intro', file: 'intro.gal', text: '@scene intro\n@jump end_a\n', eol: '\n', dirty: false, handle: null }],
      ['chapter/end_a', { id: 'end_a', file: 'chapter/end_a.gal', text: '@scene end_a\n结束。\n', eol: '\n', dirty: false, handle: null }],
    ]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    state.configReadErrors = {};
    state.dirAssets = [];
    state.reviewWorkspace = null;
    state.reviewPreviewReadOnly = false;
    state.projectLoading = false;

    const set = await commitEndScenes(['end_a'], diskText);
    expect(set).toMatchObject({ before: null, after: ['end_a'], text: diskText });
    expect(JSON.parse(diskText).player).toEqual({ subtitle: 'untouched', future: { keep: true }, endScenes: ['end_a'] });
    await commitEndScenes([], diskText);
    expect(JSON.parse(diskText).player).toEqual({ subtitle: 'untouched', future: { keep: true }, endScenes: [] });
    const empty = diskText;
    await expect(commitEndScenes(['missing'], diskText)).rejects.toThrow('结束场景不存在：missing');
    await expect(commitEndScenes(['end_a'], '{}')).rejects.toThrow('项目配置已经改变');
    expect(diskText).toBe(empty);
    await commitEndScenes(null, diskText);
    expect(JSON.parse(diskText)).toEqual({ entryScene: 'intro', variables: {}, player: { subtitle: 'untouched', future: { keep: true } } });
    const unchanged = await commitEndScenes(null, diskText);
    expect(unchanged.text).toBe(diskText);
  });
});
