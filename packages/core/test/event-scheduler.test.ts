import { describe, expect, it } from 'vitest';
import { EventScheduler } from '../src/systems/event-scheduler.js';
import type { ScheduledEventDef } from '../src/systems/event-scheduler.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration } from '../src/state/types.js';
import { CalendarRunner } from '../src/calendar/calendar.js';
import type { CalendarConfig } from '../src/calendar/calendar.js';

const decls: VarDeclaration[] = [
  { name: 'turn', type: 'number', initial: 1 },
  { name: 'morale', type: 'number', initial: 0 },
  { name: 'liberated', type: 'flag', initial: false },
];

function makeEvents(): ScheduledEventDef[] {
  return [
    { id: 'ev_low', characterId: 'sys', when: 'true', scene: 'ev_low_scene', priority: 1 },
    { id: 'ev_high', characterId: 'sys', when: 'turn >= 2', scene: 'ev_high_scene', priority: 10, once: true, effects: { morale: 5 } },
    { id: 'ev_cond', characterId: 'sys', when: 'liberated', scene: 'ev_cond_scene', priority: 5, effects: { liberated: false } },
  ];
}

describe('EventScheduler（兰斯式事件优先级调度）', () => {
  it('eligible 按优先级降序返回合格事件（同优先级保持声明序）', () => {
    const store = new VariableStore(decls);
    const sched = new EventScheduler(makeEvents(), store);
    // turn=1：ev_high 条件不满足，只剩 ev_low（p1）
    expect(sched.eligible().map((e) => e.id)).toEqual(['ev_low']);

    store.set('turn', 3);
    store.set('liberated', true);
    expect(sched.eligible().map((e) => e.id)).toEqual(['ev_high', 'ev_cond', 'ev_low']);
  });

  it('dispatch 触发最高优先级事件并应用 effects；once 事件不再次触发', () => {
    const store = new VariableStore(decls);
    store.set('turn', 3);
    const sched = new EventScheduler(makeEvents(), store);

    const top = sched.dispatch(store);
    expect(top?.id).toBe('ev_high'); // priority 10 最高
    expect(store.get('morale')).toBe(5); // effects 应用
    expect(sched.isFired('ev_high')).toBe(true);

    // once 事件已触发 → 下次 dispatch 落到 ev_low（ev_cond 条件不满足）
    expect(sched.dispatch(store)?.id).toBe('ev_low');
    // ev_low 非 once：可重复触发
    expect(sched.dispatch(store)?.id).toBe('ev_low');
  });

  it('条件求值严格策略：未声明变量抛错（与 @if 一致，不静默降级）', () => {
    const store = new VariableStore(decls);
    const sched = new EventScheduler(
      [{ id: 'bad', characterId: 'x', when: 'undefinedVar > 1', scene: 's' }],
      store,
    );
    expect(() => sched.eligible()).toThrow();
  });

  it('fire 拒绝非法触发（未知 ID / 已 fired 的 once / 条件不满足）', () => {
    const store = new VariableStore(decls);
    store.set('turn', 1);
    const sched = new EventScheduler(makeEvents(), store);
    expect(sched.fire('nope')).toBeNull(); // 未知
    expect(sched.fire('ev_high')).toBeNull(); // 条件不满足（turn=1）
    store.set('turn', 3);
    expect(sched.fire('ev_high')?.id).toBe('ev_high');
    expect(sched.fire('ev_high')).toBeNull(); // once 已 fired
  });

  it('快照往返：fired 集合随存档恢复', () => {
    const store = new VariableStore(decls);
    store.set('turn', 3);
    const sched = new EventScheduler(makeEvents(), store);
    sched.fire('ev_high');
    const snap = sched.snapshot();

    const sched2 = new EventScheduler(makeEvents(), new VariableStore(decls));
    sched2.restore(snap);
    expect(sched2.isFired('ev_high')).toBe(true);
    expect(sched2.fire('ev_high')).toBeNull();
    // 旧档无 eventScheduler 字段按空恢复
    const sched3 = new EventScheduler(makeEvents(), new VariableStore(decls));
    sched3.restore(undefined);
    expect(sched3.isFired('ev_high')).toBe(false);
  });
});

describe('CalendarRunner 回合头尾事件（配置已声明，宿主经 hostJump 消费）', () => {
  function makeConfig(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
    return {
      maxAp: 3,
      maxTurns: 12,
      dateTemplate: '第{turn}周',
      nodes: [{ id: 'base', name: '据点', x: 0, y: 0, isBase: true, apCost: 0 }],
      weeksPerMonth: 4,
      ...overrides,
    };
  }

  it('turnStartEventId/turnEndEventId 暴露配置（缺省 undefined）', () => {
    const store = new VariableStore([]);
    const runner = new CalendarRunner(makeConfig({ onTurnStartEventId: 'ev_turn_start', onTurnEndEventId: 'ev_turn_end' }), store);
    expect(runner.turnStartEventId).toBe('ev_turn_start');
    expect(runner.turnEndEventId).toBe('ev_turn_end');

    const plain = new CalendarRunner(makeConfig(), store);
    expect(plain.turnStartEventId).toBeUndefined();
    expect(plain.turnEndEventId).toBeUndefined();
  });
});
