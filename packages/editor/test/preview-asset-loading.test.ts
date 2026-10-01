import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProjectSnapshot } from '@surdet/authoring';
import { state } from '../src/state.js';
import type { DirAsset } from '../src/assets.js';
import { previewAssetPaths, readProjectFonts, readProjectImages } from '../src/panels/preview-panel.js';

const original = { dirAssets: state.dirAssets, dirHandle: state.dirHandle };
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
    exists: async key => key in files, readText: async key => ({ path: key, text: files[key]!, sha256: files[key]!, bytes: files[key]!.length }) },
  { sha256: async text => text });
}

describe('preview asset loading', () => {
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
    const result = await readProjectImages('{}', new AbortController().signal, new Set([path('bg/used.png')]));
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
    const loaded = await readProjectImages(JSON.stringify(config), new AbortController().signal, paths);
    expect(Object.keys(loaded.visuals[0]!.images).sort()).toEqual([base, alternate].sort());
    expect(loaded.backgrounds.map(asset => asset.key)).toEqual(['cover']);
  });

  it('stops after the in-flight filesystem read on cancellation; does not buffer it or start the next file', async () => {
    let complete!: (file: File) => void;
    const first = vi.fn(() => new Promise<File>(resolve => { complete = resolve; }));
    const second = vi.fn(async () => new File(['next'], 'next.png'));
    state.dirAssets = [image('bg/first.png', first), image('bg/next.png', second)];
    const controller = new AbortController();
    const reading = readProjectImages('{}', controller.signal, new Set(state.dirAssets.map(value => value.sourcePath!)));
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
    await expect(readProjectImages('{}', new AbortController().signal, paths)).rejects.toThrow('素材读取失败：content/assets/bg/used.png');
    expect((await readProjectImages('{}', new AbortController().signal, paths)).backgrounds).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('cancels font buffering and remaining roles after a pending getFile completes', async () => {
    let complete!: (file: File) => void;
    const read = vi.fn(() => new Promise<File>(resolve => { complete = resolve; }));
    state.dirHandle = { getFileHandle: async () => ({ getFile: read }) } as unknown as FileSystemDirectoryHandle;
    const controller = new AbortController();
    const reading = readProjectFonts(JSON.stringify({ font: 'body.woff2' }), controller.signal);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    controller.abort();
    const file = new File(['font'], 'body.woff2'), buffer = vi.spyOn(file, 'arrayBuffer');
    complete(file); await rejected;
    expect(buffer).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
  });
});
