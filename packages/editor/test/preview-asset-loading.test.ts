import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProjectSnapshot } from '@surdet/authoring';
import { state } from '../src/state.js';
import type { DirAsset } from '../src/assets.js';
import { capturePreviewContent, loadPreviewResources, previewAssetPaths, readProjectFonts, readProjectImages } from '../src/panels/preview-panel.js';
import { previewTextHash, projectPreviewContent } from '../src/preview-content.js';

const original = { dirAssets: state.dirAssets, dirHandle: state.dirHandle, scenes: state.scenes, current: state.current,
  gameConfigText: state.gameConfigText, configFiles: state.configFiles, timelines: state.timelines,
  configReadErrors: state.configReadErrors, handles: state.handles };
afterEach(() => Object.assign(state, original));
const path = (name: string) => `content/assets/${name}`;
function image(name: string, getFile = vi.fn(async () => new File(['pixels'], name.split('/').at(-1)!))): DirAsset {
  return { kind: 'bg', key: name.split('/').at(-1)!.split('.')[0]!, sourcePath: path(name), isImage: true,
    handle: { getFile } as unknown as FileSystemFileHandle };
}
async function snapshot(config: object, scenes: Record<string, string>, timelines: Record<string, object> = {}) {
  const files: Record<string, string> = { 'game.config.json': JSON.stringify(config),
    ...Object.fromEntries(Object.entries(scenes).map(([id, text]) => [`content/scenario/${id}.gal`, text])),
    ...Object.fromEntries(Object.entries(timelines).map(([id, value]) => [`content/timelines/${id}.json`, JSON.stringify(value)])) };
  return loadProjectSnapshot({ rootIdentity: 'preview-test', listFiles: async () => Object.keys(files),
    exists: async key => key in files, readText: async key => ({ path: key, text: files[key]!, sha256: await previewTextHash(files[key]!), bytes: files[key]!.length }) },
  { sha256: previewTextHash });
}

describe('preview asset loading', () => {
  it('A020 transfers AAC and Opus with their media type and original bytes', async () => {
    const assets: DirAsset[] = [['bgm', '音乐.aac'], ['voice', '语音.OPUS']].map(([kind, name]) => ({
      kind: kind as 'bgm' | 'voice', key: name!.split('.')[0]!, sourcePath: path(`${kind}/${name}`), isImage: false,
      handle: { getFile: async () => new File([new Uint8Array([11, 22, 33])], name!) } as unknown as FileSystemFileHandle,
    }));
    const loaded = await readProjectImages('{}', new AbortController().signal, new Set(assets.map(asset => asset.sourcePath!)), assets);
    expect(loaded.audio.map(entry => [entry.kind, entry.key, entry.file.mime, [...new Uint8Array(entry.file.buffer)]])).toEqual([
      ['bgm', '音乐', 'audio/aac', [11, 22, 33]], ['voice', '语音', 'audio/ogg', [11, 22, 33]],
    ]);
  });
  it('captures one content version and keeps its files and handles across a pending read and project switch', async () => {
    let release!: (file: File) => void;
    const font = new File([new Uint8Array([1, 2, 3])], 'body.woff2');
    const readFont = vi.fn(async () => font).mockImplementationOnce(() => new Promise<File>(resolve => { release = resolve; }));
    state.dirHandle = { getFileHandle: async () => ({ getFile: readFont }) } as unknown as FileSystemDirectoryHandle;
    state.current = 'start';
    state.scenes = new Map([['start', { id: 'start', file: 'start.gal', text: '@scene start\n@bg used\n旧正文。\n@end', eol: '\n', dirty: true, handle: null }]]);
    state.gameConfigText = '{"font":"body.woff2","theme":{"buttonSkin":"used"},"custom":{"keep":true}}';
    state.configFiles = { ...original.configFiles, events: { events: [], custom: 'old' } };
    state.configReadErrors = {};
    state.timelines = [{ id: 'shot', file: 'shot.json', text: '{"id":"shot","durationMs":0,"tracks":[]}', eol: '\n', dirty: false, handle: null }];
    state.dirAssets = [image('bg/used.png')];
    const content = capturePreviewContent();
    const reading = loadPreviewResources(content, new AbortController().signal);
    await vi.waitFor(() => expect(readFont).toHaveBeenCalledOnce());
    const wrongRead = vi.fn(async () => { throw new Error('new project must not be read'); });
    state.dirHandle = { getFileHandle: wrongRead } as unknown as FileSystemDirectoryHandle;
    state.dirAssets[0]!.handle = { getFile: wrongRead } as unknown as FileSystemFileHandle;
    state.scenes.get('start')!.text = '@scene start\n新正文。';
    state.timelines[0]!.text = '{"id":"changed"}';
    (state.configFiles.events as { custom: string }).custom = 'new';
    state.gameConfigText = '{}';
    release(font);
    const loaded = await reading;
    expect(wrongRead).not.toHaveBeenCalled();
    expect(content.scenes[0]!.text).toContain('旧正文');
    expect(content.configs.events).toEqual({ events: [], custom: 'old' });
    expect(loaded.timelineContent.definitions).toEqual([{ id: 'shot', durationMs: 0, tracks: [] }]);
    expect(loaded.assets.backgrounds.map(asset => asset.key)).toEqual(['used']);
    expect([...new Uint8Array(loaded.cachedFonts.body!.buffer)]).toEqual([1, 2, 3]);
    expect((await content.storage.readText('content/scenario/start.gal')).text).toContain('旧正文');
    expect((await content.storage.readText('game.config.json')).text).toContain('"keep":true');
  });

  it('uses the selected saved content rather than borrowing the current Editor scenes or config', async () => {
    const selected = await snapshot({ custom: 'sealed' }, { fixed: '@scene fixed\n封存正文。\n@end' });
    const files = Object.fromEntries(selected.files.map(file => [file.path, file.text]));
    const projection = await projectPreviewContent({ projectIdentity: 'preview-test', contentRevision: selected.revision, files,
      target: { kind: 'saved-project' }, title: '已保存版本', projectRevision: selected.revision, coordinationRevision: 'fixture' });
    state.gameConfigText = '{"custom":"unrelated"}';
    state.dirAssets = []; state.dirHandle = null;
    const content = capturePreviewContent(projection);
    const loaded = await loadPreviewResources(content, new AbortController().signal);
    expect(content.scenes.map(scene => scene.id)).toEqual(['fixed']);
    expect(JSON.parse(content.configText)).toEqual({ custom: 'sealed' });
    expect(loaded.assets.backgrounds).toEqual([]);
    expect(content.choices).toBeUndefined();
    expect(content.timelinePreviewId).toBeUndefined();
  });

  it('reads the transition masks a scene or a timeline cue uses for registerRule, and only those', async () => {
    const source = await snapshot({}, { start: '@scene start\n@bg room\n@transition rule 800 @rule="百叶窗 遮罩"\n凛：你好。' },
      { cut: { version: 1, id: 'cut', durationMs: 1200, tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 600, easing: 'linear', action: 'rule', rule: 'radial' }] }] } });
    const assets = [image('bg/room.png'), ...['rule/百叶窗 遮罩.png', 'rule/radial.webp', 'rule/unused.png'].map(name => ({ ...image(name), kind: 'rule' as const }))];
    const required = previewAssetPaths(source, assets);
    expect([...required].filter(value => value.includes('/rule/')).sort()).toEqual([path('rule/radial.webp'), path('rule/百叶窗 遮罩.png')]);
    const loaded = await readProjectImages('{}', new AbortController().signal, required, assets);
    expect(loaded.rules.map(mask => [mask.key, mask.image.mime, mask.image.sourcePath])).toEqual(expect.arrayContaining([
      ['百叶窗 遮罩', 'image/png', path('rule/百叶窗 遮罩.png')], ['radial', 'image/webp', path('rule/radial.webp')]]));
    expect(loaded.rules).toHaveLength(2);
    expect(loaded.backgrounds.map(background => background.key)).toEqual(['room']);
  });

  it('selects dependencies from later scenes, timeline cues, skins and implicit avatars; excludes unused images', async () => {
    const source = await snapshot({ characters: { lynn: { name: '凛' } }, theme: { buttonSkin: 'skin' } },
      { start: '@scene start\n@jump later', later: '@scene later\n@bg beach\n@voice greeting\n凛：你好。' },
      { sound: { id: 'sound', tracks: [{ kind: 'audio', cues: [{ action: 'bgm', key: 'theme' }] }] } });
    const names = ['bg/beach.png', 'bg/skin.png', 'bg/unused.png', 'voice/greeting.wav', 'bgm/theme.ogg', 'avatar/lynn.png'];
    const assets = names.map(name => ({ ...image(name), kind: name.startsWith('avatar/') ? 'avatar' as const : 'bg' as const }));
    expect([...previewAssetPaths(source, assets)].sort()).toEqual(names.filter(name => !name.includes('unused')).map(path).sort());
  });

  it('does not read unrelated files, even when their handles would fail', async () => {
    const unused = vi.fn(async () => { throw new Error('permission denied'); });
    state.dirAssets = [image('bg/unused.png', unused), image('bg/used.png')];
    const result = await readProjectImages('{}', new AbortController().signal, new Set([path('bg/used.png')]), state.dirAssets);
    expect(result.backgrounds.map(value => value.key)).toEqual(['used']);
    expect(unused).not.toHaveBeenCalled();
  });

  it('retains every dynamic portrait part and UI-only backgrounds', async () => {
    const base = path('portrait/hero_uniform_normal.png'), alternate = path('portrait/hero_uniform_smile.png');
    const config = { characters: { hero: { name: '主角', visuals: { uniform: { normal: { version: 1, kind: 'layered',
      layers: [{ id: 'body', images: { base, alternate }, default: 'base' }] } } } } },
      ui: { pages: { title: { id: 'cover', type: 'image', asset: 'cover' } } } };
    const source = await snapshot(config, { intro: '@scene intro\n@show hero:uniform normal\n主角：你好。' });
    state.dirAssets = [image('portrait/hero_uniform_normal.png'), image('portrait/hero_uniform_smile.png'), image('bg/cover.png')]
      .map(asset => ({ ...asset, kind: asset.sourcePath!.includes('/portrait/') ? 'portrait' : 'bg' }));
    const paths = previewAssetPaths(source, state.dirAssets);
    expect(paths).toEqual(new Set([base, alternate, path('bg/cover.png')]));
    const loaded = await readProjectImages(JSON.stringify(config), new AbortController().signal, paths, state.dirAssets);
    expect(Object.keys(loaded.visuals[0]!.images).sort()).toEqual([base, alternate].sort());
    expect(loaded.backgrounds.map(asset => asset.key)).toEqual(['cover']);
  });

  it('stops after the in-flight filesystem read on cancellation; does not buffer it or start the next file', async () => {
    let complete!: (file: File) => void;
    const first = vi.fn(() => new Promise<File>(resolve => { complete = resolve; }));
    const second = vi.fn(async () => new File(['next'], 'next.png'));
    state.dirAssets = [image('bg/first.png', first), image('bg/next.png', second)];
    const controller = new AbortController();
    const reading = readProjectImages('{}', controller.signal, new Set(state.dirAssets.map(value => value.sourcePath!)), state.dirAssets);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    const file = new File(['first'], 'first.png'), buffer = vi.spyOn(file, 'arrayBuffer');
    complete(file); await rejected;
    expect(buffer).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
  });

  it('reports a required file failure and rereads successfully on retry instead of returning a partial success', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue(new File(['ok'], 'used.png'));
    state.dirAssets = [image('bg/used.png', read)];
    const paths = new Set([path('bg/used.png')]);
    await expect(readProjectImages('{}', new AbortController().signal, paths, state.dirAssets)).rejects.toThrow('素材读取失败：content/assets/bg/used.png');
    expect((await readProjectImages('{}', new AbortController().signal, paths, state.dirAssets)).backgrounds).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('cancels font buffering and remaining roles after a pending getFile completes', async () => {
    let complete!: (file: File) => void;
    const read = vi.fn(() => new Promise<File>(resolve => { complete = resolve; }));
    state.dirHandle = { getFileHandle: async () => ({ getFile: read }) } as unknown as FileSystemDirectoryHandle;
    const controller = new AbortController();
    const reading = readProjectFonts(JSON.stringify({ font: 'body.woff2' }), controller.signal, state.dirHandle);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    controller.abort();
    const file = new File(['font'], 'body.woff2'), buffer = vi.spyOn(file, 'arrayBuffer');
    complete(file); await rejected;
    expect(buffer).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
  });
});
