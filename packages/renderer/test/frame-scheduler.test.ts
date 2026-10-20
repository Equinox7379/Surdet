import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ticker } from 'pixi.js';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { FrameScheduler } from '../src/frame-scheduler.js';
import type { FrameLoopTarget, FrameRequestHandler, FrameRequestSource } from '../src/types.js';
import { RenderPerformanceMonitor } from '../src/performance.js';
import { RendererError } from '../src/api/renderer-errors.js';
import { RendererStageHost } from '../src/pixi-stage-host.js';
import { createRendererRuntime } from '../src/runtime/create-renderer-runtime.js';
import { ProjectUiMotionController } from '../src/project-ui-motion.js';

class FakeTicker {
  listener: ((ticker: { deltaMS: number }) => void) | null = null;
  add(listener: (ticker: { deltaMS: number }) => void): void { this.listener = listener; }
  remove(listener: (ticker: { deltaMS: number }) => void): void {
    if (this.listener === listener) this.listener = null;
  }
  tick(deltaMS: number): void { this.listener?.({ deltaMS }); }
}

class FakeApp {
  ticker = new FakeTicker();
  starts = 0;
  stops = 0;
  start(): void { this.starts += 1; }
  stop(): void { this.stops += 1; }
}

class FakeTarget implements FrameLoopTarget {
  active = false;
  updates: number[] = [];
  handler: FrameRequestHandler | null = null;
  get needsUpdate(): boolean { return this.active; }
  update(deltaMs: number): void { this.updates.push(deltaMs); }
  setFrameRequest(handler: FrameRequestHandler | null): void { this.handler = handler; }
}

class FakeSource implements FrameRequestSource {
  handler: FrameRequestHandler | null = null;
  setFrameRequest(handler: FrameRequestHandler | null): void { this.handler = handler; }
}

describe('FrameScheduler', () => {
  it('静态目标停止 ticker，目标或舞台状态变化可唤醒下一帧', () => {
    const app = new FakeApp();
    const target = new FakeTarget();
    const stage = new FakeSource();
    const scheduler = new FrameScheduler(app as never, target, [stage]);

    expect(app.stops).toBe(1);
    target.active = true;
    stage.handler?.();
    expect(app.starts).toBe(1);
    app.ticker.tick(16);
    expect(target.updates).toEqual([16]);
    expect(app.stops).toBe(1);

    target.active = false;
    app.ticker.tick(16);
    expect(target.updates).toEqual([16, 16]);
    expect(app.stops).toBe(2);
    scheduler.dispose();
  });

  it('dispose 会移除 ticker 与唤醒回调，重复释放幂等', () => {
    const app = new FakeApp();
    const target = new FakeTarget();
    const scheduler = new FrameScheduler(app as never, target);
    scheduler.dispose();
    scheduler.dispose();

    expect(app.ticker.listener).toBeNull();
    expect(target.handler).toBeNull();
    app.ticker.tick(16);
    expect(target.updates).toEqual([]);
  });

  it('可选性能监视器记录实际 update 耗时', () => {
    const app = new FakeApp();
    const target = new FakeTarget();
    target.active = true;
    const monitor = new RenderPerformanceMonitor({ sampleWindowSize: 4 });
    const scheduler = new FrameScheduler(app as never, target, [], { monitor });
    app.ticker.tick(16);
    expect(monitor.snapshot().frames).toBe(1);
    scheduler.dispose();
  });
});

describe('FrameScheduler with the real Pixi Ticker RAF chain', () => {
  let pending: Map<number, FrameRequestCallback>;
  let now: number;
  let nextId: number;
  const schedulers: FrameScheduler[] = [];
  const tickers: Ticker[] = [];

  beforeEach(() => {
    pending = new Map();
    now = 0;
    nextId = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextId;
      pending.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
  });

  afterEach(() => {
    for (const scheduler of schedulers.splice(0)) scheduler.dispose();
    for (const ticker of tickers.splice(0)) ticker.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function appWithRealTicker() {
    const ticker = new Ticker();
    tickers.push(ticker);
    return { ticker, start: () => ticker.start(), stop: () => ticker.stop() };
  }

  function runNextFrame(): void {
    expect(pending.size).toBe(1);
    const [id, callback] = pending.entries().next().value!;
    pending.delete(id);
    now += 16;
    callback(now);
  }

  it('drives U2 pages on the existing ticker while paused, then sleeps and cancels on reset/dispose', async () => {
    const app = appWithRealTicker();
    vi.spyOn(RendererStageHost.prototype, 'init').mockImplementation(async function (this: RendererStageHost) {
      this.app = { ...app, canvas: {}, destroy: () => app.ticker.stop() } as never;
    });
    const effects = vi.spyOn(RendererStageHost.prototype, 'updateEffects');
    const motion = new ProjectUiMotionController(), complete = vi.fn(), paint = vi.fn();
    const preset = { durationMs: 32, opacity: 0, x: 12, y: 0, scale: 1, easing: 'linear' as const };
    const runtime = await createRendererRuntime({ projectUiMotion: motion });
    try {
      runtime.controller.setPresentationPaused?.(true);
      motion.play('settings', preset, 'enter', paint, complete);
      for (let i = 0; i < 4 && pending.size; i++) runNextFrame();
      expect(complete).toHaveBeenCalledOnce(); expect(paint).toHaveBeenLastCalledWith({ opacity: 1, x: 0, y: 0, scale: 1 });
      expect(effects).not.toHaveBeenCalled(); expect(app.ticker.started).toBe(false); expect(pending.size).toBe(0);
      motion.play('settings', preset, 'exit', paint, complete);
      runtime.resetSession();
      for (let i = 0; i < 4 && pending.size; i++) runNextFrame();
      expect(complete).toHaveBeenCalledOnce(); expect(motion.needsUpdate).toBe(false);
      motion.play('settings', preset, 'enter', paint, complete);
      runtime.dispose();
      expect(motion.needsUpdate).toBe(false); expect(pending.size).toBe(0);
      expect(() => motion.play('settings', preset, 'enter', paint, complete)).toThrow('disposed');
    } finally { runtime.dispose(); }
  });

  it('reports a failed update, stops the ticker, then recovers only on a new frame request', () => {
    const app = appWithRealTicker();
    const target = new FakeTarget();
    target.active = true;
    const failure = new Error('frame update failed');
    const update = vi.spyOn(target, 'update').mockImplementationOnce(() => { throw failure; });
    const onError = vi.fn();
    const onFrame = vi.fn();
    const monitor = new RenderPerformanceMonitor();
    const scheduler = new FrameScheduler(app, target, [], { onError, onFrame, monitor });
    schedulers.push(scheduler);

    expect(runNextFrame).not.toThrow();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);
    expect(onFrame).not.toHaveBeenCalled();
    expect(monitor.snapshot().frames).toBe(0);

    scheduler.requestFrame();
    scheduler.requestFrame();
    expect(pending.size).toBe(1);
    runNextFrame();
    expect(update).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(monitor.snapshot().frames).toBe(1);
    expect(pending.size).toBe(1);
  });

  it('keeps an unhandled update error visible and still allows a later wake-up', () => {
    const app = appWithRealTicker();
    const target = new FakeTarget();
    target.active = true;
    const failure = new Error('unhandled update failure');
    const update = vi.spyOn(target, 'update').mockImplementationOnce(() => { throw failure; });
    const scheduler = new FrameScheduler(app, target);
    schedulers.push(scheduler);

    expect(runNextFrame).toThrow(failure);
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);
    target.handler?.();
    runNextFrame();
    expect(update).toHaveBeenCalledTimes(2);
    expect(app.ticker.started).toBe(true);
  });

  it('sleeps when idle, wakes from a source, and disposal cancels the real RAF', () => {
    const app = appWithRealTicker();
    const target = new FakeTarget();
    const source = new FakeSource();
    const scheduler = new FrameScheduler(app, target, [source]);
    schedulers.push(scheduler);
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);

    source.handler?.();
    runNextFrame();
    expect(target.updates).toEqual([16]);
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);

    target.active = true;
    target.handler?.();
    runNextFrame();
    expect(target.updates).toEqual([16, 16]);
    expect(pending.size).toBe(1);
    const staleWake = source.handler;
    scheduler.dispose();
    scheduler.dispose();
    staleWake?.();
    scheduler.requestFrame();
    expect(source.handler).toBeNull();
    expect(target.handler).toBeNull();
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);
    expect(app.ticker.count).toBe(0);
  });

  it('stays stopped when the error reporter disposes the scheduler', () => {
    const app = appWithRealTicker();
    const target = new FakeTarget();
    target.active = true;
    vi.spyOn(target, 'update').mockImplementation(() => { throw new Error('update failed'); });
    const scheduler = new FrameScheduler(app, target, [], { onError: () => scheduler.dispose() });
    schedulers.push(scheduler);

    expect(runNextFrame).not.toThrow();
    scheduler.requestFrame();
    expect(app.ticker.started).toBe(false);
    expect(app.ticker.count).toBe(0);
    expect(pending.size).toBe(0);
  });

  it('stops even if a frame diagnostic or the error reporter throws', () => {
    const app = appWithRealTicker();
    const target = new FakeTarget();
    target.active = true;
    const failure = new Error('frame diagnostic failed');
    const reporterFailure = new Error('reporter failed');
    const onError = vi.fn(() => { throw reporterFailure; });
    const scheduler = new FrameScheduler(app, target, [], {
      onFrame: () => { throw failure; },
      onError,
    });
    schedulers.push(scheduler);

    expect(runNextFrame).toThrow(reporterFailure);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);
  });

  it.each([
    { label: 'plain error with host reporter', failure: new Error('stage update failed'), handled: true },
    { label: 'RendererError with host reporter', failure: new RendererError('world update failed', {
      code: 'COMMAND_COMMIT_FAILED', domain: 'world', command: 'update',
    }), handled: true },
    { label: 'plain error without host reporter', failure: new Error('unhandled stage update failed'), handled: false },
  ])('wires the runtime frame failure and recovers through controller input: $label', async ({ failure, handled }) => {
    const app = appWithRealTicker();
    // Replace GPU initialization and the application shell; the stage,
    // controller, composition root, scheduler and Pixi Ticker remain real.
    vi.spyOn(RendererStageHost.prototype, 'init').mockImplementation(async function (this: RendererStageHost) {
      this.app = { ...app, canvas: {}, destroy: () => app.ticker.stop() } as never;
    });
    const effects = vi.spyOn(RendererStageHost.prototype, 'updateEffects')
      .mockImplementationOnce(() => { throw failure; });
    const onError = vi.fn();
    const onWaitEnd = vi.fn();
    const runtime = await createRendererRuntime({ onWaitEnd, ...(handled ? { onError } : {}) });
    try {
      expect(pending.size).toBe(0);
      const bus = new EventBus<CoreEventMap>();
      runtime.controller.connect(bus);
      bus.emit('wait', { ms: 32 });
      if (handled) expect(runNextFrame).not.toThrow();
      else expect(runNextFrame).toThrow(failure);
      expect(app.ticker.started).toBe(false);
      expect(pending.size).toBe(0);
      expect(onWaitEnd).not.toHaveBeenCalled();
      if (handled) {
        expect(onError).toHaveBeenCalledTimes(1);
        const reported = onError.mock.calls[0]![0];
        expect(reported).toBeInstanceOf(RendererError);
        if (failure instanceof RendererError) expect(reported).toBe(failure);
        else expect(reported).toMatchObject({
          code: 'COMMAND_COMMIT_FAILED', domain: 'runtime', command: 'update', cause: failure,
        });
      } else expect(onError).not.toHaveBeenCalled();

      runtime.controller.toggleAuto();
      runNextFrame();
      expect(effects).toHaveBeenCalledTimes(2);
      expect(onWaitEnd).toHaveBeenCalledTimes(1);
      expect(app.ticker.started).toBe(false);
      expect(pending.size).toBe(0);
    } finally {
      runtime.dispose();
      runtime.dispose();
    }
    runtime.controller.toggleAuto();
    expect(app.ticker.started).toBe(false);
    expect(pending.size).toBe(0);
  });
});
