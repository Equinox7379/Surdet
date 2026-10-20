import { describe, expect, it } from 'vitest';
import { exportUiShare, readUiShare, missingUiShareAssets, copySharedFragment, type ShareAsset } from '../src/ui-sharing.js';

const frame = { x: 0, y: 0, width: 1280, height: 720 };
const root = { id: 'root', type: 'container' as const, frame, children: [
  { id: 'image', type: 'image' as const, frame, asset: 'paper' },
  { id: 'label', type: 'text' as const, frame, text: { kind: 'variable' as const, name: 'visitor' } },
] };
const config = { variables: { visitor: { type: 'string', initial: 'PRIVATE' }, unrelated: { type: 'string', initial: 'SECRET' } },
  title: 'Private title', secret: 'TOKEN', privatePath: 'C:/private/file', theme: { colors: { accent: 12 }, future: 'PRIVATE' },
  ui: { version: 1, pages: { title: root } }, fonts: { ui: 'content/assets/fonts/read.ttf' } };
const asset = (path: string, bytes: string): ShareAsset => ({ path, read: async () => new File([bytes], path.split('/').at(-1)!) });
const assets = [asset('content/assets/bg/nested/paper.png', 'image-bytes'), asset('content/assets/fonts/read.ttf', 'font'), asset('content/assets/bg/unrelated.png', 'private')];

describe('local UI sharing', () => {
  it('shares U1 image styles and checks the bundled image bytes before proposing import', async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const style = { fontWeight: 700, textShadows: [], backgroundGradient: { from: 0, to: 1, angle: 90 },
      backgroundImage: { asset: 'skin', fit: 'stretch' as const, slice: { top: 0, right: 0, bottom: 0, left: 0, fillCenter: true } } };
    const node = { id: 'panel', type: 'container' as const, frame, style };
    const source = { ui: { version: 1, pages: { title: node } } };
    const share = await exportUiShare(source, [{ path: 'content/assets/bg/skin.png', read: async () => new File([bytes], 'skin.png') }]);
    expect(share.assets.map(file => file.path)).toEqual(['content/assets/bg/skin.png']);
    expect(readUiShare(JSON.stringify(share), {})).toEqual(share);
    expect((share.config.ui as typeof source.ui).pages.title.style).toEqual(style);
    const invalid = structuredClone(share);
    (invalid.config.ui as typeof source.ui).pages.title.style.backgroundImage.slice.left = 1;
    expect(() => readUiShare(JSON.stringify(invalid), {})).toThrow('九宫格');
    invalid.assets[0]!.base64 = btoa('not an image');
    expect(() => readUiShare(JSON.stringify(invalid), {})).toThrow('九宫格');
    const fragment = await exportUiShare(source, [{ path: 'content/assets/bg/skin.png', read: async () => new File([bytes], 'skin.png') }], { page: 'title', node });
    expect(fragment.config.theme).toBeUndefined();
    expect(copySharedFragment(node, 'copy').style).toEqual(style);
  });
  it('keeps variables used only by conditions and button assignments in the dependency manifest', async () => {
    const source = { variables: { trust: { type: 'number', initial: 3 }, panelOpen: { type: 'flag', initial: false }, unused: { type: 'string', initial: 'SECRET' } },
      ui: { version: 1, pages: { hud: { id: 'open', type: 'button' as const, frame, visibleWhen: 'trust > 0', action: { kind: 'variable-set' as const, name: 'panelOpen', value: true } } } } };
    const share = await exportUiShare(source, []);
    expect(share.variables).toEqual({ trust: { type: 'number' }, panelOpen: { type: 'flag' } });
    expect(JSON.stringify(share)).not.toContain('SECRET');
    expect(() => readUiShare(JSON.stringify(share), { variables: { trust: { type: 'number', initial: 0 } } })).toThrow('同类型');
    expect(readUiShare(JSON.stringify(share), source)).toEqual(share);
  });

  it('exports only presentation fields and actual dependencies, reuses identical resources and stages only missing files', async () => {
    const share = await exportUiShare(config, assets);
    const text = JSON.stringify(share);
    expect(text).not.toMatch(/PRIVATE|SECRET|TOKEN|privatePath|unrelated/);
    expect(share.assets.map(file => file.path)).toEqual(['content/assets/bg/paper.png', 'content/assets/fonts/read.ttf']);
    expect(readUiShare(text, config)).toEqual(share);
    expect(await missingUiShareAssets(share, assets)).toEqual([]);
    const missing = await missingUiShareAssets(share, []);
    expect(missing.map(file => file.name)).toEqual(['paper.png', 'read.ttf']);
    expect(await missing[0]!.text()).toBe('image-bytes');
    await expect(missingUiShareAssets(share, [asset('content/assets/bg/paper.png', 'other')])).rejects.toThrow('冲突');
  });
  it('copies a local fragment with fresh stable IDs, inheriting the destination theme/fonts', async () => {
    const share = await exportUiShare(config, assets, { page: 'title', node: root });
    expect(share.config.fonts).toBeUndefined();
    expect(share.assets).toHaveLength(1);
    readUiShare(JSON.stringify(share), config);
    const copied = copySharedFragment(root, 'copy');
    expect(copied.id).toBe('copy_root'); expect(copied.children?.[0]?.id).toBe('copy_image');
    expect(root.id).toBe('root');
  });
  it('rejects unsupported code, outside paths, unrelated assets, missing dependencies and mismatched variables before proposing edits', async () => {
    const share = await exportUiShare(config, assets);
    for (const mutate of [
      (value: any) => { value.version = 2; },
      (value: any) => { value.config.extension = 'execute.js'; },
      (value: any) => { value.config.ui.pages.title.action = { kind: 'eval', code: 'evil' }; },
      (value: any) => { value.assets[0].path = '../secret.png'; },
      (value: any) => { value.assets.push({ path: 'content/assets/bg/unrelated.png', base64: 'eA==' }); },
      (value: any) => { value.assets = []; },
      (value: any) => { value.assets[0].base64 = '!'; },
    ]) {
      const invalid = structuredClone(share); mutate(invalid);
      expect(() => readUiShare(JSON.stringify(invalid), config)).toThrow();
    }
    expect(() => readUiShare(JSON.stringify(share), { variables: { visitor: { type: 'number' } } })).toThrow('同类型');
    expect(() => readUiShare(JSON.stringify(share), {})).toThrow('同类型');
  });
});
