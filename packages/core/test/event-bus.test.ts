import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/runtime/event-bus.js';
import type { EventMap } from '../src/runtime/event-bus.js';

/** 测试用事件映射（验证类型化总线的载荷推导） */
interface TestEvents extends EventMap {
  tick: { n: number };
}

describe('EventBus', () => {
  it('once is removed before a handler emits the same event again', () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    bus.once('tick', p => { seen.push(p.n); if (p.n === 0) bus.emit('tick', { n: 1 }); });
    bus.emit('tick', { n: 0 });
    expect(seen).toEqual([0]);
  });

  it('a handler can cancel a later subscription in the current emission', () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    bus.on('tick', () => off());
    const off = bus.on('tick', p => seen.push(p.n));
    bus.emit('tick', { n: 0 });
    expect(seen).toEqual([]);
  });
  it('订阅/发布/退订', () => {
    const bus = new EventBus<TestEvents>();
    const seen: string[] = [];
    const off = bus.on('tick', (p) => seen.push(`t${p.n}`)); // p 由事件映射推导为 { n: number }
    bus.emit('tick', { n: 1 });
    bus.emit('tick', { n: 2 });
    off();
    bus.emit('tick', { n: 3 });
    expect(seen).toEqual(['t1', 't2']);
  });

  it('once 只触发一次', () => {
    const bus = new EventBus<TestEvents>();
    let n = 0;
    bus.once('tick', () => { n++; });
    bus.emit('tick', { n: 0 });
    bus.emit('tick', { n: 0 });
    expect(n).toBe(1);
  });

  it('X4 回调抛错不中断其余订阅者且被 logger 记录', () => {
    const logs: unknown[][] = [];
    const bus = new EventBus<TestEvents>({ error: (...a: unknown[]) => logs.push(a) });
    const seen: string[] = [];
    bus.on('tick', () => { throw new Error('boom'); });
    bus.on('tick', () => { seen.push('ok'); });
    bus.emit('tick', { n: 0 });
    expect(seen).toEqual(['ok']);
    expect(logs).toHaveLength(1);
    expect(String(logs[0]![1])).toContain('boom');
  });

  it('onHandlerError 钩子在回调抛错时被调用（宿主可上报，不被静默）', () => {
    const handled: { err: unknown; event: string }[] = [];
    const bus = new EventBus<TestEvents>(undefined, { onHandlerError: (err, event) => handled.push({ err, event }) });
    bus.on('tick', () => { throw new Error('boom'); });
    bus.on('tick', () => { throw new Error('boom2'); });
    bus.emit('tick', { n: 0 });
    expect(handled).toHaveLength(2);
    expect(handled[0]!.event).toBe('tick');
    expect(String(handled[1]!.err)).toContain('boom2');
  });
});
