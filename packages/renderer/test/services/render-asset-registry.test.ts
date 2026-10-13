import { afterEach, describe, expect, it, vi } from 'vitest';
import { Texture, TextureSource } from 'pixi.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import * as coverageReader from '../../src/reading-diagnostics.js';

function fakeTexture(label: string): Texture {
  return {
    label,
    width: 100,
    height: 100,
    destroy: vi.fn(),
  } as unknown as Texture;
}

function registryHarness(): {
  registry: RenderAssetRegistry;
  load: ReturnType<typeof vi.fn>;
  unload: ReturnType<typeof vi.fn>;
} {
  const textures = new Map<string, Texture>();
  const load = vi.fn(async (source: string) => {
    if (source === 'bad') throw new Error('load failed');
    let texture = textures.get(source);
    if (!texture) {
      texture = fakeTexture(source);
      textures.set(source, texture);
    }
    return texture;
  });
  const unload = vi.fn(async (_sources: readonly string[]) => undefined);
  return { registry: new RenderAssetRegistry({ load, unload }), load, unload };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RenderAssetRegistry', () => {
  it('shares only concurrent immutable font bytes, while keeping roles independent and later reads fresh', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    let finish!: (bytes: ArrayBuffer) => void;
    const body = vi.fn(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: body }));
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set([0x6d77]) });
    const sources: ArrayBuffer[] = [];
    class FakeFontFace {
      constructor(readonly family: string, source: ArrayBuffer) { sources.push(source); }
      async load(): Promise<this> { return this; }
    }
    const add = vi.fn(), remove = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add, delete: remove } });
    const registry = new RenderAssetRegistry();
    try {
      const loads = (['body', 'title', 'ui'] as const).map(role => registry.registerFontRole(role, 'blob:shared', role));
      await vi.waitFor(() => expect(body).toHaveBeenCalled());
      expect(fetcher).toHaveBeenCalledTimes(1); expect(body).toHaveBeenCalledTimes(1);
      finish(bytes); expect(await Promise.all(loads)).toEqual([true, true, true]);
      expect(sources).toHaveLength(3); sources.forEach(source => expect(source).toBe(bytes));
      expect(add).toHaveBeenCalledTimes(3);
      expect(registry.fontFamily('body')).toBe('body'); expect(registry.fontFamily('title')).toBe('title');
      expect(registry.fontDiagnostics('ui', '海', 'title')).toEqual([]);
      body.mockResolvedValue(bytes);
      expect(await registry.registerFontRole('body', 'blob:shared', 'Later')).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledTimes(1);
    } finally { registry.dispose(); }
  });

  it('keeps a shared font transfer alive for the longer deadline and aborts when its last reader times out', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((resolve, reject) => {
        finish = resolve; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }));
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set() });
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      const short = registry.registerFontRole('body', 'blob:shared', 'Short', 20);
      const long = registry.registerFontRole('title', 'blob:shared', 'Long', 100);
      await vi.advanceTimersByTimeAsync(20);
      expect(await short).toBe(false); expect(signal.aborted).toBe(false);
      finish(new Response(new Uint8Array([1, 2, 3])));
      expect(await long).toBe(true); expect(registry.fontFamily('title')).toBe('Long');
      const last = registry.registerFontRole('ui', 'blob:stalled', 'Stalled', 20);
      await vi.advanceTimersByTimeAsync(20);
      expect(await last).toBe(false); expect(signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { registry.dispose(); vi.useRealTimers(); }
  });

  it('does not retain failed font bytes or reuse them across later registrations', async () => {
    let fail!: (error: Error) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set() });
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      const first = registry.registerFontRole('body', 'blob:retry');
      const second = registry.registerFontRole('title', 'blob:retry');
      fail(new Error('read failed'));
      expect(await Promise.all([first, second])).toEqual([false, false]);
      expect(await registry.registerFontRole('body', 'blob:retry')).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { registry.dispose(); }
  });

  it('reads mutable font URLs separately even while registrations overlap', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set() });
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      expect(await Promise.all([registry.registerFontRole('body', '/font.ttf'), registry.registerFontRole('ui', '/font.ttf')])).toEqual([true, true]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { registry.dispose(); }
  });

  it('keeps a failed font role separate from other roles sharing its bytes', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set() });
    class FakeFontFace {
      constructor(readonly family: string) {}
      async load() { if (this.family === 'Bad') throw new Error('decode failed'); return this; }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      await registry.registerFontRole('body', 'blob:old', 'Old');
      const result = await Promise.all([registry.registerFontRole('body', 'blob:new', 'Bad'), registry.registerFontRole('ui', 'blob:new', 'Good')]);
      expect(result).toEqual([false, true]); expect(fetcher).toHaveBeenCalledTimes(2);
      expect(registry.fontFamily('body')).toBe('Old'); expect(registry.fontFamily('ui')).toBe('Good');
    } finally { registry.dispose(); }
  });

  it('does not apply a shared read after reset or keep its bytes for the next registration', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set() });
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    const add = vi.fn(); vi.stubGlobal('document', { fonts: { add, delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      const loads = [registry.registerFontRole('body', 'blob:shared'), registry.registerFontRole('title', 'blob:shared')];
      registry.resetFonts(); finish(new Response(new Uint8Array([1, 2, 3])));
      expect(await Promise.all(loads)).toEqual([false, false]); expect(add).not.toHaveBeenCalled();
      expect(await registry.registerFontRole('body', 'blob:shared')).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2); expect(add).toHaveBeenCalledTimes(1);
    } finally { registry.dispose(); }
  });

  it('keeps rule ownership separate, preserves a failed replacement and unloads only loaded sources', async () => {
    const { registry, unload } = registryHarness();
    const caller = fakeTexture('caller-rule');
    await registry.registerRule('mask', caller);
    await expect(registry.registerRule('mask', 'bad')).rejects.toThrow('load failed');
    expect(registry.resolveRule('mask')).toBe(caller);
    await registry.registerRule('loaded', 'blob:rule');
    expect(registry.diagnosticSnapshot().rules).toEqual(['loaded', 'mask']);
    await registry.releaseRegisteredAssetSources(); registry.dispose();
    expect(unload).toHaveBeenCalledWith(['blob:rule']); expect(caller.destroy).not.toHaveBeenCalled();
  });
  it('allows a valid large font to finish beyond the old three-second total budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(coverageReader, 'readFontCoverage').mockResolvedValue({ characters: new Set([0x6d77]) });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 4000));
      return new Response(new Uint8Array([1, 2, 3]));
    }));
    class FakeFontFace { async load(): Promise<this> { return this; } }
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      const loading = registry.registerFontRole('ui', 'large-font', 'LargeCjk');
      await vi.advanceTimersByTimeAsync(4000);
      expect(await loading).toBe(true);
      expect(registry.fontFamily('ui')).toBe('LargeCjk');
      expect(vi.getTimerCount()).toBe(0);
    } finally { registry.dispose(); vi.useRealTimers(); }
  });

  it.each([undefined, 40])('aborts an unfinished font at its finite loading deadline: %s', async override => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }));
    vi.stubGlobal('FontFace', class {});
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      let settled = false;
      const loading = registry.registerFontRole('ui', 'stalled', 'Stalled', override).then(result => { settled = true; return result; });
      await vi.advanceTimersByTimeAsync((override ?? 15000) - 1);
      expect(settled).toBe(false); expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await loading).toBe(false); expect(signal?.aborted).toBe(true);
      expect(registry.fontFamily('ui')).not.toBe('Stalled');
      expect(vi.getTimerCount()).toBe(0);
    } finally { registry.dispose(); vi.useRealTimers(); }
  });

  it('does not fail a usable font when the coverage decoder times out', async () => {
    vi.useFakeTimers();
    const coverage = vi.spyOn(coverageReader, 'readFontCoverage').mockImplementationOnce(() => new Promise(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    class FakeFontFace { async load(): Promise<this> { return this; } }
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
    const registry = new RenderAssetRegistry();
    try {
      const loading = registry.registerFontRole('body', 'font', 'Usable', 30);
      await vi.waitFor(() => expect(coverage).toHaveBeenCalled(), { interval: 1 });
      await vi.advanceTimersByTimeAsync(30);
      expect(await loading).toBe(true); expect(registry.fontFamily('body')).toBe('Usable');
      expect(registry.fontDiagnostics('body', '海', 'dialogue')[0]).toMatchObject({ code: 'FONT_COVERAGE_UNAVAILABLE' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { registry.dispose(); vi.useRealTimers(); }
  });
  it('keeps font ownership on failure, rejects late reset work, and reports uninspectable coverage honestly', async () => {
    const registry = new RenderAssetRegistry();
    class FakeFontFace { async load(): Promise<this> { return this; } }
    const add = vi.fn(); const remove = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add, delete: remove } });
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    expect(await registry.registerFontRole('body', 'old', 'Old')).toBe(true);
    expect(registry.fontDiagnostics('body', '海', 'dialogue')[0]?.code).toBe('FONT_COVERAGE_UNAVAILABLE');
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect(await registry.registerFontRole('body', 'failed', 'Bad')).toBe(false);
    expect(registry.fontFamily('body')).toBe('Old'); expect(remove).not.toHaveBeenCalled();
    let complete!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const late = registry.registerFontRole('body', 'late', 'Late');
    registry.resetFonts(); complete(new Response(new Uint8Array([1, 2, 3])));
    expect(await late).toBe(false); expect(add).toHaveBeenCalledTimes(1);
    expect(registry.fontFamily('body')).not.toBe('Old');
    registry.dispose();
  });
  it('registers all visual frames atomically and preserves ownership on dimension/load failure', async () => {
    const { registry, unload } = registryHarness();
    const a = 'content/assets/portrait/rin_parts_a.png', b = 'content/assets/portrait/rin_parts_b.png';
    const definition = { version: 1 as const, kind: 'sequence' as const, loop: true, frames: [{ image: a, durationMs: 100 }, { image: b, durationMs: 100 }] };
    const first = fakeTexture('first'), second = fakeTexture('second');
    await registry.registerPortraitVisual('rin', 'coat', 'normal', definition, { [a]: { source: first }, [b]: { source: second } });
    const registered = registry.resolvePortraitVisual('rin', 'coat', 'normal');
    await expect(registry.registerPortraitVisual('rin', 'coat', 'normal', definition, { [a]: { source: first } })).rejects.toThrow('未提供');
    const wrongSize = { ...second, width: 200 } as Texture;
    await expect(registry.registerPortraitVisual('rin', 'coat', 'normal', definition, { [a]: { source: first }, [b]: { source: wrongSize } })).rejects.toThrow('画布');
    expect(registry.resolvePortraitVisual('rin', 'coat', 'normal')).toBe(registered);
    await registry.registerPortrait('rin', 'coat', 'normal', first);
    expect(registry.resolvePortraitVisual('rin', 'coat', 'normal')).toBeNull();
    expect(registry.resolvePortrait('rin', 'coat', 'normal')).toBe(first);
    registry.dispose(); expect(first.destroy).not.toHaveBeenCalled(); expect(second.destroy).not.toHaveBeenCalled(); expect(unload).not.toHaveBeenCalled();
  });

  it('pins every decoded visual image in definition order and rejects late registration after replacement/release', async () => {
    vi.stubGlobal('fetch', vi.fn(async (source: string) => new Response(source, { status: 200, headers: { 'content-type': 'image/png' } })));
    let id = 0;
    vi.stubGlobal('URL', { createObjectURL: () => `blob:part-${++id}`, revokeObjectURL: vi.fn() });
    const pending: Array<(texture: Texture) => void> = [];
    const unload = vi.fn(async () => {});
    const registry = new RenderAssetRegistry({ load: async () => new Promise(resolve => pending.push(resolve)), unload });
    const a = 'content/assets/portrait/rin_parts_a.png', b = 'content/assets/portrait/rin_parts_b.png';
    const definition = { version: 1 as const, kind: 'sequence' as const, loop: true, frames: [{ image: a, durationMs: 100 }, { image: b, durationMs: 100 }] };
    const sources = { [a]: { source: 'a' }, [b]: { source: 'b' } };
    const first = registry.registerPortraitVisual('rin', 'coat', 'normal', definition, sources);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!(fakeTexture('b')); pending[0]!(fakeTexture('a')); await first;
    const key = registry.resolvePortraitVisual('rin', 'coat', 'normal')!.key;
    const repeat = registry.registerPortraitVisual('rin', 'coat', 'normal', definition, sources);
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    pending[2]!(fakeTexture('a')); pending[3]!(fakeTexture('b')); await repeat;
    expect(registry.resolvePortraitVisual('rin', 'coat', 'normal')!.key).toBe(key);
    const late = registry.registerPortraitVisual('rin', 'coat', 'normal', definition, sources);
    const cancelled = expect(late).rejects.toThrow('取消');
    await vi.waitFor(() => expect(pending).toHaveLength(6));
    const latest = fakeTexture('static'); await registry.registerPortrait('rin', 'coat', 'normal', latest);
    pending[4]!(fakeTexture('a')); pending[5]!(fakeTexture('b')); await cancelled;
    expect(registry.resolvePortraitVisual('rin', 'coat', 'normal')).toBeNull();
    expect(registry.resolvePortrait('rin', 'coat', 'normal')).toBe(latest);
    await registry.releaseRegisteredAssetSources();
    expect(registry.diagnosticSnapshot().sources).toEqual([]);
    expect(unload).toHaveBeenCalledTimes(6);
    registry.dispose();
  });
  it('registers video URLs without texture decoding and clears only on the owning asset boundary', async () => {
    const { registry, load, unload } = registryHarness();
    await registry.registerVideo('片头', 'blob:clip', 'content/assets/video/片头.webm');
    expect(registry.resolveVideo('片头')).toEqual({ url: 'blob:clip', sourcePath: 'content/assets/video/片头.webm' });
    expect(load).not.toHaveBeenCalled();
    registry.reset();
    expect(registry.resolveVideo('片头')?.url).toBe('blob:clip');
    registry.reset({ clearAssets: true });
    expect(registry.resolveVideo('片头')).toBeNull();
    await registry.registerVideo('片头', 'blob:next');
    await registry.releaseRegisteredAssetSources();
    expect(registry.resolveVideo('片头')).toBeNull();
    expect(unload).not.toHaveBeenCalled(); // Host, not Pixi, owns video Blob URLs.
    await registry.registerVideo('片头', 'blob:last');
    registry.dispose();
    expect(registry.resolveVideo('片头')).toBeNull();
    await expect(registry.registerVideo('late', 'blob:late')).rejects.toMatchObject({ code: 'RENDERER_DISPOSED' });
  });
  it('destroys the source of its final generated texture but preserves caller textures', () => {
    const { registry } = registryHarness();
    const source = new TextureSource({ width: 1, height: 1 });
    const texture = new Texture({ source });
    registry.getOrCreateBackground('missing', () => texture);
    registry.reset();
    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
    expect(Texture.WHITE.destroyed).toBe(false);
  });
  it('keeps the latest key request when an older different URL finishes last', async () => {
    let finishOld!: (texture: Texture) => void;
    const latest = fakeTexture('latest');
    const unload = vi.fn(async () => {});
    const registry = new RenderAssetRegistry({
      load: async (source) => source === 'old' ? new Promise<Texture>(resolve => { finishOld = resolve; }) : latest,
      unload,
    });
    const old = registry.registerBackground('room', 'old');
    await registry.registerBackground('room', 'new');
    finishOld(fakeTexture('old'));
    await old;
    expect(registry.resolveBackground('room')).toBe(latest);
    expect(unload).toHaveBeenCalledWith(['old']);
    expect(unload).not.toHaveBeenCalledWith(['new']);
    await registry.releaseRegisteredAssetSources();
  });
  it('keeps the old resource when replacement preparation fails', async () => {
    const { registry } = registryHarness();
    const goodTexture = fakeTexture('good');

    await registry.registerBackground('room', goodTexture);
    await expect(registry.registerBackground('room', 'bad')).rejects.toThrow('load failed');

    expect(registry.resolveBackground('room')).toBe(goodTexture);
    expect(goodTexture.destroy).not.toHaveBeenCalled();
  });

  it('uses composite portrait keys and keeps avatars separate', async () => {
    const { registry } = registryHarness();
    const normal = fakeTexture('normal');
    const happy = fakeTexture('happy');
    const avatar = fakeTexture('avatar');

    await registry.registerPortrait('lynn', 'uniform', 'normal', normal);
    await registry.registerPortrait('lynn', 'uniform', 'happy', happy);
    await registry.registerAvatar('lynn-face', avatar);

    expect(registry.resolvePortrait('lynn', 'uniform', 'normal')).toBe(normal);
    expect(registry.resolvePortrait('lynn', 'uniform', 'happy')).toBe(happy);
    expect(registry.resolveAvatar('lynn-face')).toBe(avatar);
    expect(registry.diagnosticSnapshot()).toEqual({
      backgrounds: [],
      portraits: ['lynn:uniform:happy', 'lynn:uniform:normal'],
      avatars: ['lynn-face'],
      rules: [],
      fontFamilies: expect.any(Object),
      sources: [],
    });
  });

  it('invalidates stale loads after reset and does not commit their result', async () => {
    let finish: ((texture: Texture) => void) | undefined;
    const load = vi.fn(() => new Promise<Texture>((resolve) => { finish = resolve; }));
    const unload = vi.fn(async (_sources: readonly string[]) => undefined);
    const registry = new RenderAssetRegistry({ load, unload });

    const registration = registry.registerBackground('old', 'blob:old');
    registry.reset();
    finish?.(fakeTexture('old'));
    await registration;

    expect(registry.resolveBackground('old')).toBeNull();
    expect(unload).toHaveBeenCalledWith(['blob:old']);
  });

  it('does not commit a caller texture after a synchronous reset', async () => {
    const { registry } = registryHarness();
    const registration = registry.registerBackground('old', fakeTexture('old'));
    registry.reset({ clearAssets: true });
    await registration;
    expect(registry.resolveBackground('old')).toBeNull();
  });

  it('waits for a pending stale load and its unload before releasing source URLs', async () => {
    let finishLoad!: (texture: Texture) => void;
    let finishUnload!: () => void;
    const unload = vi.fn(() => new Promise<void>(resolve => { finishUnload = resolve; }));
    const registry = new RenderAssetRegistry({
      load: () => new Promise<Texture>(resolve => { finishLoad = resolve; }), unload,
    });
    const registration = registry.registerBackground('old', 'blob:pending');
    registry.reset({ clearAssets: true });
    let released = false;
    const release = registry.releaseRegisteredAssetSources().then(() => { released = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(released).toBe(false);
    finishLoad(fakeTexture('old'));
    await vi.waitFor(() => expect(unload).toHaveBeenCalledOnce());
    expect(released).toBe(false);
    finishUnload();
    await Promise.all([registration, release]);
    expect(registry.resolveBackground('old')).toBeNull();
    expect(registry.diagnosticSnapshot().sources).toEqual([]);
  });

  it('finishes a stale load before loading the same URL for the new session', async () => {
    let finishLoad!: (texture: Texture) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<Texture>(resolve => { finishLoad = resolve; }))
      .mockResolvedValue(fakeTexture('new'));
    const unload = vi.fn(async () => {});
    const registry = new RenderAssetRegistry({ load, unload });
    const oldRegistration = registry.registerBackground('room', 'blob:same');
    registry.reset({ clearAssets: true });
    const newRegistration = registry.registerBackground('room', 'blob:same');
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    finishLoad(fakeTexture('old'));
    await Promise.all([oldRegistration, newRegistration]);
    expect(unload).toHaveBeenCalledOnce();
    expect(registry.resolveBackground('room')?.label).toBe('new');
  });

  it('releases a shared Blob source only after its last registration', async () => {
    const { registry, unload } = registryHarness();

    await registry.registerBackground('room', 'blob:shared');
    await registry.registerPortrait('lynn', 'uniform', 'normal', 'blob:shared');
    await registry.releaseRegisteredAssetSources();
    await registry.releaseRegisteredAssetSources();

    expect(unload).toHaveBeenCalledTimes(1);
    expect(unload).toHaveBeenCalledWith(['blob:shared']);
  });

  it('waits for an unload already started by clearAssets before allowing URL revocation', async () => {
    let finish!: () => void;
    const unload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const registry = new RenderAssetRegistry({ load: async () => fakeTexture('old'), unload });
    await registry.registerBackground('room', 'blob:old');
    registry.reset({ clearAssets: true });
    let released = false;
    const release = registry.releaseRegisteredAssetSources().then(() => { released = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(false);
    expect(registry.diagnosticSnapshot().sources).toEqual(['blob:old']);
    finish();
    await release;
    expect(unload).toHaveBeenCalledTimes(1);
    expect(registry.diagnosticSnapshot().sources).toEqual([]);
  });

  it('reports unload failure and retains the source for an explicit retry', async () => {
    const unload = vi.fn().mockRejectedValueOnce(new Error('unload failed')).mockResolvedValue(undefined);
    const registry = new RenderAssetRegistry({ load: async () => fakeTexture('old'), unload });
    await registry.registerBackground('room', 'blob:old');
    await expect(registry.releaseRegisteredAssetSources()).rejects.toThrow('unload failed');
    expect(registry.diagnosticSnapshot().sources).toEqual(['blob:old']);
    await registry.releaseRegisteredAssetSources();
    expect(unload).toHaveBeenCalledTimes(2);
    expect(registry.diagnosticSnapshot().sources).toEqual([]);
  });

  it('does not reload a source while its previous texture is still being unloaded', async () => {
    let finish!: () => void;
    const load = vi.fn(async () => fakeTexture('image'));
    const unload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const registry = new RenderAssetRegistry({ load, unload });
    await registry.registerBackground('room', 'blob:shared');
    registry.reset({ clearAssets: true });
    const registration = registry.registerBackground('room', 'blob:shared');
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await registration;
    expect(load).toHaveBeenCalledTimes(2);
    expect(registry.resolveBackground('room')).not.toBeNull();
  });

  it('resets generated caches while preserving registered textures unless clearAssets is requested', async () => {
    const { registry } = registryHarness();
    const generated = fakeTexture('generated');
    const registered = fakeTexture('registered');

    registry.getOrCreateBackground('generated', () => generated);
    await registry.registerBackground('registered', registered);
    registry.reset();

    expect(generated.destroy).toHaveBeenCalledTimes(1);
    expect(registry.resolveBackground('generated')).toBeNull();
    expect(registry.resolveBackground('registered')).toBe(registered);

    registry.reset({ clearAssets: true });
    expect(registry.resolveBackground('registered')).toBeNull();
    expect(registered.destroy).not.toHaveBeenCalled();
  });

  it('shares one font role and removes it exactly once on repeated dispose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 1, 2]))));
    class FakeFontFace {
      constructor(readonly family: string, readonly source: string) {}
      async load(): Promise<this> { return this; }
    }
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add, delete: remove } });
    const registry = new RenderAssetRegistry();

    await expect(registry.registerFontRole('body', 'blob:font', 'GameBody')).resolves.toBe(true);
    expect(registry.fontFamily('body')).toBe('GameBody');
    registry.dispose();
    registry.dispose();

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('clears the font deadline once loading has completed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 1, 2]))));
    vi.useFakeTimers();
    try {
      class FakeFontFace { async load(): Promise<this> { return this; } }
      vi.stubGlobal('FontFace', FakeFontFace);
      vi.stubGlobal('document', { fonts: { add: vi.fn(), delete: vi.fn() } });
      const registry = new RenderAssetRegistry();
      expect(await registry.registerFontRole('body', 'blob:font')).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      registry.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('reports a stable disposed error for post-dispose mutations', () => {
    const { registry } = registryHarness();
    registry.dispose();

    expect(() => registry.reset()).toThrowError(expect.objectContaining({
      code: 'RENDERER_DISPOSED',
      domain: 'assets',
      command: 'reset',
    }));
  });
});
