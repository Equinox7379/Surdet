import { describe, expect, it, vi } from 'vitest';
import { createConfiguredFontJobs, resolveBundledFontUrl } from '../../shared/font-jobs.js';

describe('configured project fonts', () => {
  it('releases a successfully loaded font whose owner disposed before delivery', async () => {
    let active = true;
    let release!: (registered: boolean) => void;
    const registered = new Promise<boolean>(resolve => { release = resolve; });
    const owned = new Set(['blob:existing']);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const options = { config: { fonts: { body: 'late.ttf' } }, label: 'test', fontBlobUrls: owned,
      isActive: () => active, resolveFontUrl: async () => 'blob:late',
      assets: { registerFontRole: vi.fn(() => registered), registerFont: vi.fn() } };
    try {
      const task = createConfiguredFontJobs(options)()[0]!.load();
      await Promise.resolve();
      expect(options.assets.registerFontRole).toHaveBeenCalledOnce();
      active = false;
      release(true);
      await task;
      expect([...owned]).toEqual(['blob:existing']);
      expect(revoke).toHaveBeenCalledWith('blob:late');
      expect(revoke).not.toHaveBeenCalledWith('blob:existing');
    } finally { revoke.mockRestore(); }
  });
  it('uses exact asset paths, including nested directories, case and spaces', () => {
    const files = { 'fonts/a/同名.TTF': '/a', 'fonts/b/同名.TTF': '/b' };
    expect(resolveBundledFontUrl('content/assets/fonts/b/同名.TTF', files)).toBe('/b');
    expect(resolveBundledFontUrl('content/assets/fonts/同名.TTF', files)).toBeNull();
    expect(resolveBundledFontUrl('content/assets/fonts/b/同名.ttf', files)).toBeNull();
    expect(resolveBundledFontUrl('content/assets/fonts/带 空格/字体.woff2', {}, {
      '../content/assets/fonts/带 空格/字体.woff2': '/legacy-glob',
    })).toBe('/legacy-glob');
  });

  it('loads all legacy roles, and never fills missing modern roles from legacy', async () => {
    const registerFontRole = vi.fn().mockResolvedValue(true);
    const owned = new Set<string>();
    const options = { label: 'test', fontBlobUrls: owned, isActive: () => true, resolveFontUrl: async (path: string) => `blob:${path}`,
      assets: { registerFontRole, registerFont: vi.fn() } };
    for (const job of createConfiguredFontJobs({ ...options, config: { font: 'old.ttf' } })()) await job.load();
    expect(registerFontRole.mock.calls.map(call => call[0])).toEqual(['body', 'title', 'ui']);
    expect(owned.has('blob:old.ttf')).toBe(true);
    registerFontRole.mockClear();
    for (const job of createConfiguredFontJobs({ ...options, config: { font: 'old.ttf', fonts: { body: 'new.ttf', title: '' } } })()) await job.load();
    expect(registerFontRole.mock.calls).toEqual([['body', 'blob:new.ttf']]);
    expect(createConfiguredFontJobs({ ...options, config: { font: 'old.ttf', fonts: {} } })()).toEqual([]);
  });
  it('reports a missing font path instead of counting the load as successful', async () => {
    const jobs = createConfiguredFontJobs({ config: { fonts: { body: 'content/assets/fonts/不存在.TTF' } },
      label: 'test', fontBlobUrls: new Set(), resolveFontUrl: async () => null,
      isActive: () => true,
      assets: { registerFontRole: vi.fn(), registerFont: vi.fn() } })();
    await expect(jobs[0]!.load()).rejects.toThrow('content/assets/fonts/不存在.TTF');
  });

  it('reports failed decoding and releases only its own unsuccessful blob', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const owned = new Set(['blob:existing']);
    const jobs = createConfiguredFontJobs({ config: { fonts: { title: 'content/assets/fonts/坏字体.woff2' } },
      label: 'test', fontBlobUrls: owned, resolveFontUrl: async () => 'blob:bad',
      isActive: () => true,
      assets: { registerFontRole: vi.fn().mockResolvedValue(false), registerFont: vi.fn() } })();
    try {
      await expect(jobs[0]!.load()).rejects.toThrow('content/assets/fonts/坏字体.woff2');
      expect(revoke).toHaveBeenCalledWith('blob:bad');
      expect([...owned]).toEqual(['blob:existing']);
    } finally { revoke.mockRestore(); }
  });
});
