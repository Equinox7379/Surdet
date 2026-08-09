import { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { PixiStage } from '../../src/pixi-stage.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';

describe('legacy Gallery compatibility contract', () => {
  it('routes the legacy PixiStage gallery methods through one GalleryLayer port', async () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new PixiStage(assets, lifecycle);
    const showGallery = vi.spyOn(stage.galleryLayer, 'showGallery');
    const hideGallery = vi.spyOn(stage.galleryLayer, 'hideGallery');
    try {
      await assets.registerBackground('cg-1', Texture.WHITE);
      const options = {
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' }],
        music: [],
        onClose: vi.fn(),
      };
      stage.showGallery(options);

      expect(showGallery).toHaveBeenCalledOnce();
      expect(showGallery.mock.calls[0]?.[0]).toEqual(options);
      expect(stage.galleryLayer.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });

      stage.hideGallery();
      expect(hideGallery).toHaveBeenCalledOnce();
      expect(stage.galleryLayer.gallery()).toEqual({ type: 'none' });

      stage.resetSession();
      expect(stage.galleryLayer.gallery()).toEqual({ type: 'none' });
    } finally {
      stage.destroy();
      lifecycle.dispose();
    }
  });
});
