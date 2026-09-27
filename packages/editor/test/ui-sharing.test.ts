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
