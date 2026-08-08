import { describe, expect, it } from 'vitest';
import { FrameScheduler } from '../src/frame-scheduler.js';
import type { FrameLoopTarget, FrameRequestHandler, FrameRequestSource } from '../src/types.js';
import { RenderPerformanceMonitor } from '../src/performance.js';

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
