import { Container, Text as PText, Texture, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { PixiStage } from '../../src/pixi-stage.js';
import { RendererFacade, type RendererControllerPort, type RendererStagePort } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';

const pointerEvent = {} as FederatedPointerEvent;

function findTextInCapturedContainers(containers: Iterable<Container>, value: string): PText {
  const visit = (container: Container): PText | undefined => {
    if (container instanceof PText && container.text === value) return container;
    for (const child of container.children) {
      if (child instanceof PText && child.text === value) return child;
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const container of containers) {
    const found = visit(container);
    if (found) return found;
  }
  throw new Error(`text ${value} should be projected`);
}

function captureAddedContainers(): { readonly containers: Set<Container>; readonly restore: () => void } {
  const containers = new Set<Container>();
  const originalAddChild = Container.prototype.addChild;
  const addChild = vi.spyOn(Container.prototype, 'addChild');
  addChild.mockImplementation(function (this: Container, ...children: Parameters<typeof originalAddChild>) {
    containers.add(this);
    for (const child of children) {
      if (child instanceof Container) containers.add(child);
    }
    return originalAddChild.call(this, ...children);
  });
  return { containers, restore: () => addChild.mockRestore() };
}

function makeController(): RendererControllerPort {
  return {
    status: 'idle',
    autoPlay: false,
    skipMode: false,
    skipAll: false,
    backlogOpen: false,
    interfaceHidden: false,
    needsUpdate: false,
    update: () => undefined,
    setFrameRequest: () => undefined,
    connect: () => () => undefined,
    disconnect: () => undefined,
    reset: () => undefined,
    advance: () => false,
    select: () => false,
    dispatchInput: () => false,
    setTextSpeed: () => undefined,
    setAutoWait: () => undefined,
    dispose: () => undefined,
  } as unknown as RendererControllerPort;
}

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
      expect(showGallery.mock.calls[0]?.[0]).toMatchObject({
        cgs: options.cgs,
        music: options.music,
        onClose: expect.any(Function),
      });
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

  it('restores the command rail when a real legacy PixiStage Gallery close button is clicked', async () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new PixiStage(assets, lifecycle);
    const restoreCommandRail = vi.spyOn(stage, 'restoreCommandRail');
    const onClose = vi.fn();
    const captured = captureAddedContainers();
    try {
      await assets.registerBackground('cg-1', Texture.WHITE);
      stage.showGallery({
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' }],
        music: [],
        onClose,
      });

      findTextInCapturedContainers(captured.containers, '关闭').emit('pointerdown', pointerEvent);

      expect(stage.galleryLayer.gallery()).toEqual({ type: 'none' });
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      expect(lifecycle.snapshot().listeners).toBe(0);
    } finally {
      captured.restore();
      stage.destroy();
      lifecycle.dispose();
    }
  });

  it('restores the legacy command rail before propagating a throwing Gallery close callback', async () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new PixiStage(assets, lifecycle);
    const restoreCommandRail = vi.spyOn(stage, 'restoreCommandRail');
    const failure = new Error('legacy gallery close failure');
    const captured = captureAddedContainers();
    try {
      await assets.registerBackground('cg-1', Texture.WHITE);
      stage.showGallery({
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' }],
        music: [],
        onClose: () => { throw failure; },
      });

      expect(() => findTextInCapturedContainers(captured.containers, '关闭').emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(stage.galleryLayer.gallery()).toEqual({ type: 'none' });
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(lifecycle.snapshot().listeners).toBe(0);
    } finally {
      captured.restore();
      stage.destroy();
      lifecycle.dispose();
    }
  });

  it('clears the legacy Facade overlay cache when the real Stage close button is clicked', async () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new PixiStage(assets, lifecycle);
    const restoreCommandRail = vi.spyOn(stage, 'restoreCommandRail');
    const onClose = vi.fn();
    const captured = captureAddedContainers();
    const facade = new RendererFacade({
      stage: stage as unknown as RendererStagePort,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
    });
    try {
      await assets.registerBackground('cg-1', Texture.WHITE);
      facade.commands.gallery.showGallery({
        cgs: [{ id: 'cg-1', name: '初遇', unlocked: true, src: 'cg-1' }],
        music: [],
        onClose,
      });
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null });

      findTextInCapturedContainers(captured.containers, '关闭').emit('pointerdown', pointerEvent);

      expect(stage.galleryLayer.gallery()).toEqual({ type: 'none' });
      expect(facade.queries.overlay.gallery()).toEqual({ type: 'none' });
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      expect(lifecycle.snapshot().listeners).toBe(0);
    } finally {
      captured.restore();
      facade.markDisposed();
      stage.destroy();
      lifecycle.dispose();
    }
  });
});
