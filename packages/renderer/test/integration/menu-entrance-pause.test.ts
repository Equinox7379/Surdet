import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';
import { MenuLayer } from '../../src/layers/menu/menu-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { FrameScheduler } from '../../src/frame-scheduler.js';
import type { AdvStage, FrameRequestHandler } from '../../src/types.js';

class FakeTicker {
  listener: ((ticker: { deltaMS: number }) => void) | null = null;
  add(listener: (ticker: { deltaMS: number }) => void): void { this.listener = listener; }
  remove(listener: (ticker: { deltaMS: number }) => void): void {
    if (this.listener === listener) this.listener = null;
  }
  tick(deltaMS: number): void { this.listener?.({ deltaMS }); }
}

/** 与 Pixi Ticker 一致的幂等 start/stop，便于断言真实调度行为。 */
class FakeApp {
  ticker = new FakeTicker();
  #started = false;
  starts = 0;
  stops = 0;
  start(): void { if (!this.#started) { this.#started = true; this.starts += 1; } }
  stop(): void { if (this.#started) { this.#started = false; this.stops += 1; } }
}

/** 暂停缺陷的公共层复现与回归：真实 MenuLayer 入场 + 真实调度合同。 */
describe('paused presentation keeps the menu entrance alive', () => {
  it('runs the system-menu entrance through the scheduler while paused, then sleeps and resumes the world once', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const root = new Container();
    let stageWake: FrameRequestHandler | null = null;
    const requestStageFrame = (): void => { (stageWake as FrameRequestHandler | null)?.(); };
    const menuLayer = new MenuLayer({
      uiLayer: root,
      width: 1280,
      height: 720,
      assets,
      lifecycle,
      requestFrame: requestStageFrame,
    });
    const updateEffects = vi.fn();
    // 整组演出推进仍可被调用的宿主（如打字/舞台效果未冻结的常规路径）
    const stage = { needsUpdate: () => true, updateEffects, updateContinuePulse: vi.fn() } as unknown as AdvStage;
    const ports = createPresentationPorts(stage, { menuLayer });
    const controller = new PresentationController(ports.commands, ports.queries, undefined, {
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
      updateProjection: (deltaMs) => { stage.updateEffects?.(deltaMs); },
      updateMenuProjection: (deltaMs) => menuLayer.update(deltaMs),
    });
    const app = new FakeApp();
    const stageSource = {
      handler: null as FrameRequestHandler | null,
      setFrameRequest(handler: FrameRequestHandler | null): void { this.handler = handler; },
    };
    const scheduler = new FrameScheduler(app as never, controller, [stageSource]);
    try {
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
      expect(app.starts).toBeGreaterThanOrEqual(1);

      // 实际帧循环：入场期间持续推进，完成后调度器休眠
      let frames = 0;
      while (frames < 40 && app.stops === 0) {
        app.ticker.tick(16);
        frames += 1;
      }
      expect(menuRoot.alpha).toBe(1);
      expect(menuLayer.needsUpdate).toBe(false);
      expect(controller.needsUpdate).toBe(false);
      expect(app.stops).toBe(1);
      expect(frames).toBeLessThanOrEqual(20);
      // 暂停期间整组演出推进（含 World.update）从未被调用
      expect(updateEffects).not.toHaveBeenCalled();

      // 关闭菜单：恢复整组演出推进；单帧只推进一次
      menuLayer.hideSystemMenu();
      expect(controller.presentationPaused).toBe(false);
      app.ticker.tick(16);
      expect(updateEffects).toHaveBeenCalledTimes(1);
      expect(updateEffects).toHaveBeenCalledWith(16);
      expect(controller.needsUpdate).toBe(true);

      // 销毁后不再唤醒：帧请求已解除
      controller.dispose();
      scheduler.dispose();
      expect(stageSource.handler).toBeNull();
      menuLayer.dispose();
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
    const stage = { needsUpdate: () => false } as unknown as AdvStage;
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
