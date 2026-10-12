import { describe, expect, it, vi } from 'vitest';
import { createConfiguredFontJobs, resolveBundledFontUrl } from '../../shared/font-jobs.js';

describe('configured project fonts', () => {
  it('shares one source read between roles in a batch, but re-reads it in the next batch', async () => {
    const resolveFontUrl = vi.fn().mockResolvedValue('blob:unexpected-repeat').mockResolvedValueOnce('blob:first').mockResolvedValueOnce('blob:second');
    const registerFontRole = vi.fn().mockResolvedValue(true);
    const owned = new Set<string>();
    const jobs = createConfiguredFontJobs({ config: { fonts: { body: 'same.ttf', title: 'same.ttf', ui: 'same.ttf' } },
      label: 'test', fontBlobUrls: owned, isActive: () => true, resolveFontUrl,
      assets: { registerFontRole, registerFont: vi.fn() } });
    await Promise.all(jobs().map(job => job.load()));
    expect(resolveFontUrl.mock.calls).toEqual([['same.ttf']]);
    expect(registerFontRole.mock.calls).toEqual([['body', 'blob:first'], ['title', 'blob:first'], ['ui', 'blob:first']]);
    await Promise.all(jobs().map(job => job.load()));
    expect(resolveFontUrl.mock.calls).toEqual([['same.ttf'], ['same.ttf']]);
    expect(registerFontRole.mock.calls.slice(3)).toEqual([['body', 'blob:second'], ['title', 'blob:second'], ['ui', 'blob:second']]);
    expect([...owned]).toEqual(['blob:first', 'blob:second']);
  });

  it.each([true, false])('does not revoke a shared source before the last role finishes (last succeeds: %s)', async success => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const owned = new Set(['blob:existing']);
    const onError = vi.fn();
    const jobs = createConfiguredFontJobs({ config: { fonts: { body: 'same.ttf', title: 'same.ttf' } },
      label: 'test', fontBlobUrls: owned, isActive: () => true, resolveFontUrl: async () => 'blob:shared', onError,
      assets: { registerFontRole: vi.fn().mockResolvedValueOnce(false).mockReturnValueOnce(pending), registerFont: vi.fn() } })();
    try {
      const first = jobs[0]!.load(); const last = jobs[1]!.load();
      const settled = Promise.allSettled([first, last]);
      await expect(first).rejects.toThrow('body');
      expect(revoke).not.toHaveBeenCalled();
      finish(success); const results = await settled;
      expect(results.map(result => result.status)).toEqual(['rejected', success ? 'fulfilled' : 'rejected']);
      expect(onError).toHaveBeenCalledTimes(success ? 1 : 2);
      if (success) { expect(revoke).not.toHaveBeenCalled(); expect(owned.has('blob:shared')).toBe(true); }
      else { expect(revoke.mock.calls).toEqual([['blob:shared']]); expect([...owned]).toEqual(['blob:existing']); }
    } finally { revoke.mockRestore(); }
  });

  it('keeps distinct files separate and retries a failed source on the next batch', async () => {
    let failBody = true;
    const resolveFontUrl = vi.fn(async (file: string) => {
      if (file === 'body.ttf' && failBody) throw new Error('读取失败');
      return `blob:${file}`;
    });
    const registerFontRole = vi.fn().mockResolvedValue(true);
    const jobs = createConfiguredFontJobs({ config: { fonts: { body: 'body.ttf', title: 'title.ttf' } }, label: 'test',
      fontBlobUrls: new Set(), isActive: () => true, resolveFontUrl, assets: { registerFontRole, registerFont: vi.fn() } });
    expect((await Promise.allSettled(jobs().map(job => job.load()))).map(value => value.status)).toEqual(['rejected', 'fulfilled']);
    failBody = false;
    await Promise.all(jobs().map(job => job.load()));
    expect(resolveFontUrl.mock.calls).toEqual([['body.ttf'], ['title.ttf'], ['body.ttf'], ['title.ttf']]);
    expect(registerFontRole.mock.calls).toEqual([['title', 'blob:title.ttf'], ['body', 'blob:body.ttf'], ['title', 'blob:title.ttf']]);
  });

  it('releases a shared source if the owner closes while the file is being read', async () => {
    let active = true; let finish!: (url: string) => void;
    const source = new Promise<string>(resolve => { finish = resolve; });
    const owned = new Set<string>(), registerFontRole = vi.fn();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const jobs = createConfiguredFontJobs({ config: { fonts: { body: 'same.ttf', title: 'same.ttf' } },
      label: 'test', fontBlobUrls: owned, isActive: () => active, resolveFontUrl: () => source,
      assets: { registerFontRole, registerFont: vi.fn() } })();
    try {
      const settled = Promise.all(jobs.map(job => job.load()));
      active = false; finish('blob:closed'); await settled;
      expect(registerFontRole).not.toHaveBeenCalled(); expect(owned.size).toBe(0);
      expect(revoke.mock.calls).toEqual([['blob:closed']]);
    } finally { revoke.mockRestore(); }
  });

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
