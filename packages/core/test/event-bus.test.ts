import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/runtime/event-bus.js';

describe('EventBus', () => {
  it('订阅/发布/退订', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on('tick', (p: { n: number }) => seen.push(`t${p.n}`));
    bus.emit('tick', { n: 1 });
    bus.emit('tick', { n: 2 });
    off();
    bus.emit('tick', { n: 3 });
    expect(seen).toEqual(['t1', 't2']);
  });

  it('once 只触发一次', () => {
    const bus = new EventBus();
    let n = 0;
    bus.once('tick', () => { n++; });
    bus.emit('tick');
    bus.emit('tick');
    expect(n).toBe(1);
  });

  it('X4 回调抛错不中断其余订阅者且被 logger 记录', () => {
    const logs: unknown[][] = [];
    const bus = new EventBus({ error: (...a: unknown[]) => logs.push(a) });
    const seen: string[] = [];
    bus.on('tick', () => { throw new Error('boom'); });
    bus.on('tick', () => { seen.push('ok'); });
    bus.emit('tick');
    expect(seen).toEqual(['ok']);
    expect(logs).toHaveLength(1);
    expect(String(logs[0]![1])).toContain('boom');
  });

  it('onHandlerError 钩子在回调抛错时被调用（宿主可上报，不被静默）', () => {
    const handled: { err: unknown; event: string }[] = [];
    const bus = new EventBus(undefined, { onHandlerError: (err, event) => handled.push({ err, event }) });
    bus.on('tick', () => { throw new Error('boom'); });
    bus.on('tick', () => { throw new Error('boom2'); });
    bus.emit('tick');
    expect(handled).toHaveLength(2);
    expect(handled[0]!.event).toBe('tick');
    expect(String(handled[1]!.err)).toContain('boom2');
  });
});
