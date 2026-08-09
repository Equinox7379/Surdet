import { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { createPresentationPorts } from '../../src/adv-renderer.js';
import { PixiStage } from '../../src/pixi-stage.js';
import { RendererFacade, type RendererControllerPort } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';

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

describe('legacy World contract', () => {
  it('keeps PixiStage world methods as single delegates to WorldLayer', async () => {
    const stage = new PixiStage();
    await stage.registerBackground('hall', Texture.EMPTY);
    await stage.registerPortrait('lynn', 'uniform', 'normal', Texture.EMPTY);
    const world = stage.worldLayer;
    const background = vi.spyOn(world, 'setBackground');
    const portrait = vi.spyOn(world, 'setPortrait');
    const fade = vi.spyOn(world, 'setFade');
    const snapshot = vi.spyOn(world, 'snapshotPresentation');
    const clear = vi.spyOn(world, 'clearPresentation');
    try {
      stage.setBackground('hall');
      stage.setPortrait('lynn:uniform', { charId: 'lynn', costume: 'uniform', expression: 'normal', pos: 'left' });
      stage.setFade(0.3);
      expect(stage.snapshotPresentation()).toBeDefined();
      stage.clearPresentation();
      expect(background).toHaveBeenCalledOnce();
      expect(portrait).toHaveBeenCalledOnce();
      expect(fade).toHaveBeenCalledOnce();
      expect(snapshot).toHaveBeenCalledOnce();
      expect(clear).toHaveBeenCalledOnce();
    } finally {
      stage.destroy();
    }
  });

  it('uses the real WorldLayer on v2 Facade commands and keeps legacy fallback behavior', async () => {
    const stage = new PixiStage();
    await stage.registerBackground('hall', Texture.EMPTY);
    const world = stage.worldLayer;
    const worldBackground = vi.spyOn(world, 'setBackground');
    const legacyBackground = vi.spyOn(stage, 'setBackground');
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      worldLayer: world,
    });
    try {
      facade.commands.world.setBackground('hall');
      expect(worldBackground).toHaveBeenCalledOnce();
      expect(legacyBackground).not.toHaveBeenCalled();

      const fallback = new RendererFacade({
        stage,
        controller: makeController(),
        monitor: new RenderPerformanceMonitor(),
      });
      fallback.commands.world.setBackground('hall');
      expect(legacyBackground).toHaveBeenCalledOnce();
    } finally {
      stage.destroy();
    }
  });

  it('binds Presentation validation fallback methods to their actual owners', () => {
    const stageReceivers: unknown[] = [];
    const worldReceivers: unknown[] = [];
    const stage = {
      validatePresentation(this: unknown, _snapshot: unknown) {
        stageReceivers.push(this);
      },
      destroy: () => undefined,
    };
    const worldPort = {
      validatePresentation(this: unknown, _snapshot: unknown) {
        worldReceivers.push(this);
      },
    };
    const withWorldValidator = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      worldLayer: worldPort as never,
    });

    withWorldValidator.commands.presentation.validate({ version: 1, stage: null, timelines: [] });
    expect(worldReceivers).toEqual([worldPort]);
    expect(stageReceivers).toEqual([]);

    const withoutWorldValidator = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      worldLayer: {} as never,
    });
    withoutWorldValidator.commands.presentation.validate({ version: 1, stage: null, timelines: [] });
    expect(stageReceivers).toEqual([stage]);

    stageReceivers.length = 0;
    const withoutWorldPort = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
    });
    withoutWorldPort.commands.presentation.validate({ version: 1, stage: null, timelines: [] });
    expect(stageReceivers).toEqual([stage]);
  });

  it('passes only the stage field through the createPresentationPorts validation bridge', () => {
    const stage = {
      destroy: () => undefined,
    };
    const worldValidator = vi.fn();
    const worldPort = { validatePresentation: worldValidator };
    const ports = createPresentationPorts(stage as never, { worldLayer: worldPort as never });
    const stageSnapshot = { version: 1, backgroundKey: null, cameraScale: 1 };

    expect(() => ports.commands.presentation.validate({
      version: 1,
      stage: stageSnapshot,
      timelines: [],
    })).not.toThrow();
    expect(worldValidator).toHaveBeenCalledOnce();
    expect(worldValidator).toHaveBeenCalledWith(stageSnapshot);
    expect(worldValidator.mock.calls[0]?.[0]).not.toHaveProperty('timelines');
  });
});
