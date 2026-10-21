import { ColorMatrixFilter, Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldLayer } from '../../src/layers/world/world-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';

afterEach(() => vi.unstubAllGlobals());

describe('World post process filter ownership', () => {
  it.each(['enabled', 'disabled', 'low quality'] as const)('destroys its allocated filter once after %s, preserving borrowed textures', async state => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const assets = new RenderAssetRegistry();
    const borrowed = new Texture({ source: new TextureSource({ width: 1280, height: 720 }) });
    const world = new WorldLayer({ width: 1280, height: 720, assets });
    try {
      await assets.registerBackground('borrowed', borrowed); world.setBackground('borrowed');
      world.setPostProcess({ enabled: true });
      const filter = (world.worldContainer.filters as ColorMatrixFilter[]).find(value => value instanceof ColorMatrixFilter)!;
      expect(filter).toBeInstanceOf(ColorMatrixFilter);
      const destroy = vi.spyOn(filter, 'destroy');
      if (state === 'disabled') world.setPostProcess({ enabled: false });
      if (state === 'low quality') world.setQuality('low');
      world.dispose(); world.dispose();
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(filter.resources).toBeNull();
      expect(borrowed.destroyed).toBe(false);
    } finally { world.dispose(); assets.dispose(); borrowed.destroy(true); }
  });
});
