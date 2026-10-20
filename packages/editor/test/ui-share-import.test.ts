import { describe, expect, it } from 'vitest';
import { exportUiShare, type ShareAsset } from '../src/ui-sharing.js';
import { previewUiShareImport } from '../src/authoring-project-storage.js';

const frame = { x: 0, y: 0, width: 1280, height: 720 };
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const assets: ShareAsset[] = [
  { path: 'content/assets/bg/hover.png', read: async () => new File([png], 'hover.png') },
  { path: 'content/assets/fonts/read.ttf', read: async () => new File(['font'], 'read.ttf') },
];
const button = { id: 'button', type: 'button' as const, frame: { x: 0, y: 0, width: 180, height: 48 }, text: { kind: 'literal' as const, value: '开始' }, action: { kind: 'start' as const },
  states: { hover: { backgroundImage: { asset: 'hover', fit: 'stretch' as const, slice: { top: 0, right: 0, bottom: 0, left: 0, fillCenter: true } } }, disabled: { opacity: 0 } } };
const transition = { enter: { durationMs: 160, opacity: 0, y: 20 } };
const source = { title: 'PRIVATE_SOURCE', plugins: [{ code: 'PRIVATE_PLUGIN' }], theme: { colors: { accent: 0x123456 } }, fonts: { ui: 'content/assets/fonts/read.ttf' },
  ui: { version: 1, pages: { title: { id: 'source', type: 'container' as const, frame, transition, children: [button] },
    hud: { id: 'hud', type: 'container' as const, frame } } } };
const destination = () => ({ title: 'B', entryScene: 'start', privateField: 'KEEP', variables: { own: { type: 'number', initial: 9 } },
  plugins: [{ id: 'B_PLUGIN' }], theme: { colors: { accent: 1 }, future: 'KEEP_THEME' }, fonts: { body: 'content/assets/fonts/b.ttf' },
  player: { saveNamespace: 'B_SAVES', endScenes: ['end'], titleLogo: 'b_logo' },
  ui: { version: 1, pages: { title: { id: 'destination', type: 'container' as const, frame, children: [] as typeof button[] },
    settings: { id: 'settings', type: 'container' as const, frame } } } });

describe('U3 read-only UI share import projection', () => {
  it('projects a full U1/U2 theme without writing B or copying non-presentation source data', async () => {
    const share = await exportUiShare(source, assets), b = destination(), original = structuredClone(b);
    const preview = previewUiShareImport(JSON.stringify(share), b);
    expect(b).toEqual(original);
    expect(preview.config).toMatchObject({ title: 'B', privateField: 'KEEP', plugins: [{ id: 'B_PLUGIN' }], variables: b.variables,
      theme: { future: 'KEEP_THEME' }, player: { saveNamespace: 'B_SAVES', endScenes: ['end'] } });
    expect(JSON.stringify(preview.config)).not.toMatch(/PRIVATE_SOURCE|PRIVATE_PLUGIN/);
    expect(preview.value?.pages.title?.transition).toEqual(transition);
    expect(preview.value?.pages.title?.children?.[0]?.states).toEqual(button.states);
    expect(preview.pages.filter(page => page.change !== 'unchanged').map(({ page, change }) => [page, change])).toEqual([
      ['title', 'replace'], ['settings', 'remove'], ['hud', 'add'],
    ]);
    expect(preview.share.assets.map(asset => asset.path)).toEqual(['content/assets/bg/hover.png', 'content/assets/fonts/read.ttf']);
  });
  it('inserts a fragment using the shared patch rules while inheriting B theme and fonts', async () => {
    const share = await exportUiShare(source, assets, { page: 'title', node: button }), b = destination();
    const preview = previewUiShareImport(JSON.stringify(share), b, { page: 'title', parentId: 'destination', prefix: 'copy' });
    expect(preview.themeForm).toBeNull(); expect(preview.patch?.type).toBe('node.insert');
    expect(preview.config.theme).toEqual(b.theme); expect(preview.config.fonts).toEqual(b.fonts); expect(preview.config.player).toEqual(b.player);
    expect(preview.value?.pages.title?.children?.[0]).toMatchObject({ id: 'copy_button', states: button.states });
    expect(preview.pages.find(page => page.page === 'title')).toMatchObject({ change: 'insert', before: ['destination'], after: ['destination', 'copy_button'] });
    expect(b.ui.pages.title.children).toEqual([]);
  });
  it('rejects wrong pages, stale parents, duplicate IDs and nested root transitions before any edit', async () => {
    const share = await exportUiShare(source, assets, { page: 'title', node: button }), b = destination();
    const text = JSON.stringify(share);
    expect(() => previewUiShareImport(text, b, { page: 'settings', prefix: 'copy' })).toThrow('页面类型');
    expect(() => previewUiShareImport(text, b, { page: 'title', parentId: 'gone', prefix: 'copy' })).toThrow('父组件');
    b.ui.pages.title.children.push({ ...button, id: 'copy_button' });
    expect(() => previewUiShareImport(text, b, { page: 'title', parentId: 'destination', prefix: 'copy' })).toThrow();
    const page = await exportUiShare(source, assets, { page: 'title', node: source.ui.pages.title });
    expect(() => previewUiShareImport(JSON.stringify(page), b, { page: 'title', parentId: 'destination', prefix: 'page' })).toThrow('根');
    expect(previewUiShareImport(JSON.stringify(page), b, { page: 'title', prefix: 'page' }).value?.pages.title?.transition).toEqual(transition);
  });
  it('resets absent theme presentation fields but retains B private theme and gameplay fields', async () => {
    const b = destination(), share = await exportUiShare({}, []);
    const preview = previewUiShareImport(JSON.stringify(share), b);
    expect(preview.config.theme).toEqual({ future: 'KEEP_THEME' });
    expect(preview.config.ui).toBeUndefined(); expect(preview.config.font).toBeUndefined(); expect(preview.config.fonts).toEqual({});
    expect(preview.config.player).toEqual({ saveNamespace: 'B_SAVES', endScenes: ['end'] });
    expect(b.ui.pages.title.id).toBe('destination');
  });
});
