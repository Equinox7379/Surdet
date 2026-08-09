import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';

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

  it('releases a shared Blob source only after its last registration', async () => {
    const { registry, unload } = registryHarness();

    await registry.registerBackground('room', 'blob:shared');
    await registry.registerPortrait('lynn', 'uniform', 'normal', 'blob:shared');
    await registry.releaseRegisteredAssetSources();
    await registry.releaseRegisteredAssetSources();

    expect(unload).toHaveBeenCalledTimes(1);
    expect(unload).toHaveBeenCalledWith(['blob:shared']);
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
