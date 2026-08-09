import { Container, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { PixiStage } from '../../src/pixi-stage.js';
import { RendererFacade, type RendererControllerPort, type RendererStagePort } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import type { BattleView, BattleHandlers } from '../../src/battle-view.js';
import type { BasePanelView, MapView } from '../../src/ui-views.js';

const pointerEvent = {} as FederatedPointerEvent;

function battleView(): BattleView {
  return {
    turn: 1,
    actingTeam: 'heroes',
    finished: false,
    winner: null,
    units: [],
  };
}

function mapView(): MapView {
  return {
    turn: 1,
    ap: 2,
    maxAp: 3,
    date: '2026-08-09',
    nodes: [{ id: 'base', name: '据点', x: 320, y: 240, enterable: true, visited: false, apCost: 1, isBase: true }],
  };
}

function baseView(): BasePanelView {
  return {
    ap: 2,
    maxAp: 4,
    date: '2026-08-09',
    commands: [{ id: 'rest', name: '休息', apCost: 1, enabled: true, remaining: null }],
  };
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

function findParentWithText(containers: Iterable<Container>, value: string): Container {
  const visit = (container: Container): Container | undefined => {
    if (container.children.some((child) => child instanceof PText && child.text === value)) return container;
    for (const child of container.children) {
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
  throw new Error(`container containing ${value} should be projected`);
}

describe('legacy SystemPanel compatibility contract', () => {
  it('routes every legacy PixiStage system method through one SystemPanelLayer port', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new PixiStage(assets, lifecycle);
    const system = stage.systemPanelLayer;
    const methods = {
      showBattle: vi.spyOn(system, 'showBattle'),
      hideBattle: vi.spyOn(system, 'hideBattle'),
      showMap: vi.spyOn(system, 'showMap'),
      hideMap: vi.spyOn(system, 'hideMap'),
      showShop: vi.spyOn(system, 'showShop'),
      hideShop: vi.spyOn(system, 'hideShop'),
      showBaseCommands: vi.spyOn(system, 'showBaseCommands'),
      hideBaseCommands: vi.spyOn(system, 'hideBaseCommands'),
      showVideo: vi.spyOn(system, 'showVideo'),
      hideVideo: vi.spyOn(system, 'hideVideo'),
    };
    const handlers: BattleHandlers = { onAttack: vi.fn(), onPass: vi.fn() };
    const onEnter = vi.fn();
    const onEndTurn = vi.fn();
    const onBuy = vi.fn();
    const onShopClose = vi.fn();
    const onExecute = vi.fn();
    const onBaseClose = vi.fn();
    const onVideoEnd = vi.fn();
    try {
      stage.showBattle(battleView(), handlers, 'legacy');
      stage.hideBattle();
      stage.showMap(mapView(), onEnter, onEndTurn);
      stage.hideMap();
      stage.showShop({ gold: 100, items: [], message: 'legacy' }, onBuy, onShopClose);
      stage.hideShop();
      stage.showBaseCommands(baseView(), onExecute, onBaseClose);
      stage.hideBase();
      stage.showVideo('legacy.mp4', onVideoEnd);
      stage.hideVideo();

      expect(methods.showBattle).toHaveBeenCalledOnce();
      expect(methods.hideBattle).toHaveBeenCalledOnce();
      expect(methods.showMap).toHaveBeenCalledOnce();
      expect(methods.hideMap).toHaveBeenCalledOnce();
      expect(methods.showShop).toHaveBeenCalledOnce();
      expect(methods.hideShop).toHaveBeenCalledOnce();
      expect(methods.showBaseCommands).toHaveBeenCalledOnce();
      expect(methods.hideBaseCommands).toHaveBeenCalledOnce();
      expect(methods.showVideo).toHaveBeenCalledOnce();
      expect(methods.hideVideo).toHaveBeenCalledOnce();
      expect(methods.showBattle).toHaveBeenCalledWith(battleView(), handlers, 'legacy');
    } finally {
      stage.destroy();
      lifecycle.dispose();
    }
  });

  it('clears the legacy Facade system overlay cache when real map/shop/base callbacks close panels', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const stage = new PixiStage(assets, lifecycle);
    const captured = captureAddedContainers();
    const facade = new RendererFacade({
      stage: stage as unknown as RendererStagePort,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
    });
    const onEnter = vi.fn();
    const onEndTurn = vi.fn();
    const onBuy = vi.fn();
    const onShopClose = vi.fn();
    const onExecute = vi.fn();
    const onBaseClose = vi.fn();
    try {
      facade.commands.system.showMap(mapView(), onEnter, onEndTurn);
      expect(facade.queries.overlay.system()).toEqual({ type: 'map' });
      findParentWithText(captured.containers, '据点（行动力 1）').emit('pointerdown', pointerEvent);
      expect(onEnter).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.system()).toEqual({ type: 'none' });

      facade.commands.system.showShop({ gold: 100, items: [], message: 'shop' }, onBuy, onShopClose);
      expect(facade.queries.overlay.system()).toEqual({ type: 'shop' });
      findTextInCapturedContainers(captured.containers, '✕ 离开商店').emit('pointerdown', pointerEvent);
      expect(onShopClose).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.system()).toEqual({ type: 'none' });

      facade.commands.system.showBaseCommands(baseView(), onExecute, onBaseClose);
      expect(facade.queries.overlay.system()).toEqual({ type: 'base' });
      findTextInCapturedContainers(captured.containers, '◀ 返回地图').emit('pointerdown', pointerEvent);
      expect(onBaseClose).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.system()).toEqual({ type: 'none' });
    } finally {
      captured.restore();
      facade.markDisposed();
      stage.destroy();
      lifecycle.dispose();
    }
  });
});
