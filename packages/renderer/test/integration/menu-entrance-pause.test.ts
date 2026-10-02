import { describe, expect, it, vi } from 'vitest';
import { Container, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';
import { MenuLayer } from '../../src/layers/menu/menu-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { FrameScheduler } from '../../src/frame-scheduler.js';
import type { FrameRequestHandler } from '../../src/types.js';

class FakeTicker {
  running = false;
  listener: ((ticker: { deltaMS: number }) => void) | null = null;
  add(listener: (ticker: { deltaMS: number }) => void): void { this.listener = listener; }
  remove(listener: (ticker: { deltaMS: number }) => void): void {
    if (this.listener === listener) this.listener = null;
  }
  tick(deltaMS: number): void {
    if (!this.running) throw new Error('Cannot tick a stopped scheduler');
    this.listener?.({ deltaMS });
  }
}

/** 与 Pixi Ticker 一致的幂等 start/stop，便于断言真实调度行为。 */
class FakeApp {
  ticker = new FakeTicker();
  starts = 0;
  stops = 0;
  start(): void { if (!this.ticker.running) { this.ticker.running = true; this.starts += 1; } }
  stop(): void { if (this.ticker.running) { this.ticker.running = false; this.stops += 1; } }
}

/** 暂停缺陷的公共层复现与回归：真实 MenuLayer 入场 + 真实调度合同。 */
describe('paused presentation keeps the menu entrance alive', () => {
  it('projects only the current save page and suppresses background targets under overwrite confirmation', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
    const slots = Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), empty: false, label: '场景' }));
    try {
      layer.showSaveLoad({ mode: 'load', slots }, vi.fn(), vi.fn());
      const first = layer.debugSnapshot().saveLoadTargets;
      expect(first.filter(target => target.id.startsWith('slot-')).map(target => target.id))
        .toEqual(['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6']);
      const page = root.children.find(child => child.visible) as Container;
      const next = page.children.find(child => child instanceof PText && child.text === '下一页')!;
      next.emit('pointerdown', {} as FederatedPointerEvent);
      expect(layer.debugSnapshot().saveLoadTargets.filter(target => target.id.startsWith('slot-')).map(target => target.id))
        .toEqual(['slot-7', 'slot-8']);
      layer.hideSaveLoad();
      expect(layer.debugSnapshot().saveLoadTargets).toEqual([]);
      layer.showSaveLoad({ mode: 'save', slots }, vi.fn(), vi.fn());
      const visible = root.children.find(child => child.visible) as Container;
      const card = visible.children.find(child => child instanceof Container
        && child.children.some(text => text instanceof PText && text.text === '07'))!;
      card.emit('pointerdown', {} as FederatedPointerEvent);
      expect(layer.debugSnapshot().saveLoadTargets).toEqual([]);
    } finally { layer.dispose(); assets.dispose(); lifecycle.dispose(); }
  });

  it('runs the system-menu entrance through the scheduler while paused, then sleeps and resumes the world once', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    const stageSource = {
      handler: null as FrameRequestHandler | null,
      setFrameRequest(handler: FrameRequestHandler | null): void { this.handler = handler; },
    };
    const menuLayer = new MenuLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      requestFrame: () => stageSource.handler?.(),
    });
    const updateEffects = vi.fn();
    let worldNeedsUpdate = false;
    const stage = {
      needsUpdate: () => worldNeedsUpdate,
      setBackground: vi.fn(),
      setPortrait: vi.fn(),
      removePortrait: vi.fn(),
      showText: vi.fn(),
      showChoices: vi.fn(),
      hideChoices: vi.fn(),
    };
    const ports = createPresentationPorts(stage, { menuLayer });
    const controller = new PresentationController(ports.commands, ports.queries, undefined, {
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
      updateProjection: (deltaMs) => { updateEffects(deltaMs); },
      updateMenuProjection: (deltaMs) => menuLayer.update(deltaMs),
    });
    const app = new FakeApp();
    const scheduler = new FrameScheduler(app as never, controller, [stageSource]);
    try {
      expect(controller.needsUpdate).toBe(false);
      expect(app.ticker.running).toBe(false);
      expect(app.starts).toBe(0);
      // 打开系统菜单（与 Facade 的 commands.menu.showSystemMenu 相同的层入口）
      menuLayer.showSystemMenu(
        [{ id: 'resume', label: '返回游戏' }, { id: 'save', label: '存档' }],
        vi.fn(),
        vi.fn(),
      );
      expect(menuLayer.menu()).toEqual({ type: 'system-menu' });
      expect(controller.presentationPaused).toBe(true);
      const menuRoot = root.children.find((child) => child.visible)!;
      expect(menuRoot.alpha).toBe(0);
      expect(app.starts).toBe(1);
      expect(app.ticker.running).toBe(true);

      // 实际帧循环：入场期间持续推进，完成后调度器休眠
      let frames = 0;
      while (frames < 40 && app.ticker.running) {
        app.ticker.tick(16);
        frames += 1;
      }
      expect(menuRoot.alpha).toBe(1);
      expect(menuLayer.needsUpdate).toBe(false);
      expect(controller.needsUpdate).toBe(false);
      expect(app.stops).toBe(1);
      expect(app.ticker.running).toBe(false);
      expect(frames).toBeGreaterThan(1);
      expect(frames).toBeLessThanOrEqual(20);
      // 暂停期间整组演出推进（含 World.update）从未被调用
      expect(updateEffects).not.toHaveBeenCalled();

      // 关闭菜单：恢复整组演出推进；单帧只推进一次
      worldNeedsUpdate = true;
      menuLayer.hideSystemMenu();
      expect(controller.presentationPaused).toBe(false);
      expect(app.starts).toBe(2);
      expect(app.ticker.running).toBe(true);
      app.ticker.tick(16);
      expect(updateEffects).toHaveBeenCalledTimes(1);
      expect(updateEffects).toHaveBeenCalledWith(16);
      expect(controller.needsUpdate).toBe(true);

      // 销毁后不再唤醒：帧请求已解除
      const staleWake = stageSource.handler;
      expect(staleWake).toBeTypeOf('function');
      controller.dispose();
      scheduler.dispose();
      expect(stageSource.handler).toBeNull();
      expect(app.ticker.listener).toBeNull();
      const startsAfterDispose = app.starts;
      staleWake?.();
      menuLayer.showSystemMenu([{ id: 'resume', label: '返回游戏' }], vi.fn(), vi.fn());
      expect(app.starts).toBe(startsAfterDispose);
      expect(app.ticker.running).toBe(false);
    } finally {
      scheduler.dispose();
      controller.dispose();
      menuLayer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('completes the menu entrance in one paused frame when motion is reduced', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    const menuLayer = new MenuLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      presentation: () => ({ reducedMotion: true, transitionScale: 0, particleEnabled: true }),
    });
    const stage = {
      needsUpdate: () => false,
      setBackground: vi.fn(),
      setPortrait: vi.fn(),
      removePortrait: vi.fn(),
      showText: vi.fn(),
      showChoices: vi.fn(),
      hideChoices: vi.fn(),
    };
    const ports = createPresentationPorts(stage, { menuLayer });
    const controller = new PresentationController(ports.commands, ports.queries, undefined, {
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
      updateMenuProjection: (deltaMs) => menuLayer.update(deltaMs),
    });
    try {
      menuLayer.showSystemMenu([{ id: 'resume', label: '返回游戏' }], vi.fn(), vi.fn());
      expect(controller.presentationPaused).toBe(true);
      // 减少动态偏好把入场压到 1ms：一帧暂停推进后菜单必须完全可见，而不是停在透明状态
      expect(controller.needsUpdate).toBe(false);
      controller.update(16);
      const menuRoot = root.children.find((child) => child.visible)!;
      expect(menuRoot.alpha).toBe(1);
      expect(menuLayer.needsUpdate).toBe(false);
      expect(controller.needsUpdate).toBe(false);
    } finally {
      controller.dispose();
      menuLayer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });
});
