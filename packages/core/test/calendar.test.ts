import { describe, expect, it } from 'vitest';
import { CalendarRunner } from '../src/calendar/calendar.js';
import type { CalendarConfig } from '../src/calendar/calendar.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration } from '../src/state/types.js';

const decls: VarDeclaration[] = [
  { name: 'liberated', type: 'flag', initial: false },
  { name: 'day', type: 'number', initial: 1 },
];

function makeConfig(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
  return {
    maxAp: 3,
    maxTurns: 12,
    dateTemplate: '第{month}月 第{turn}周',
    nodes: [
      { id: 'north_gate', name: '北门', x: 200, y: 100, apCost: 1, eventId: 'ev_gate' },
      { id: 'forest', name: '森林', x: 400, y: 200, apCost: 1, eventId: 'ev_forest', visibleWhen: 'liberated' },
      { id: 'castle', name: '王城', x: 600, y: 300, apCost: 2, isBase: true, eventId: 'ev_castle' },
      { id: 'tower', name: '塔', x: 800, y: 400, apCost: 1, requires: ['north_gate'] },
    ],
    ...overrides,
  };
}

function makeRunner() {
  const store = new VariableStore(decls);
  return { store, runner: new CalendarRunner(makeConfig(), store) };
}

describe('CalendarRunner', () => {
  it('初始回合/行动力/日期', () => {
    const { runner } = makeRunner();
    expect(runner.turn).toBe(1);
    expect(runner.ap).toBe(3);
    expect(runner.date).toBe('第1月 第1周');
  });

  it('进入节点扣行动力并返回事件', () => {
    const { runner } = makeRunner();
    const r = runner.enter('north_gate');
    expect(r).toEqual({ ok: true, eventId: 'ev_gate' });
    expect(runner.ap).toBe(2);
    expect(runner.hasVisited('north_gate')).toBe(true);
  });

  it('行动力不足拒绝进入', () => {
    const { runner } = makeRunner();
    runner.enter('north_gate'); // ap 2
    runner.enter('castle'); // ap 0
    const r = runner.enter('castle'); // ap 0 < 2
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('行动力不足');
  });

  it('visibleWhen 表达式控制可见性', () => {
    const { store, runner } = makeRunner();
    expect(runner.visibleNodes().map((n) => n.id)).not.toContain('forest');
    store.set('liberated', true);
    expect(runner.visibleNodes().map((n) => n.id)).toContain('forest');
  });

  it('requires 依赖节点', () => {
    const { runner } = makeRunner();
    expect(runner.isVisible(makeConfig().nodes[3]!)).toBe(false); // tower 需先访问 north_gate
    runner.enter('north_gate');
    expect(runner.isVisible(makeConfig().nodes[3]!)).toBe(true);
  });

  it('回合推进恢复行动力、月历变化', () => {
    const { runner } = makeRunner();
    runner.enter('north_gate');
    expect(runner.ap).toBe(2);
    runner.advanceTurn();
    expect(runner.turn).toBe(2);
    expect(runner.ap).toBe(3);
    expect(runner.date).toBe('第1月 第2周');
    // 5 回合后到第 2 月
    for (let i = 0; i < 3; i++) runner.advanceTurn();
    expect(runner.turn).toBe(5);
    expect(runner.month).toBe(2);
  });

  it('回合上限结束', () => {
    const { runner } = makeRunner();
    for (let i = 0; i < 12; i++) runner.advanceTurn();
    expect(runner.isOver).toBe(true);
  });

  it('snapshot/restore 往返', () => {
    const { runner } = makeRunner();
    runner.enter('north_gate');
    const snap = runner.snapshot();
    expect(snap).toEqual({ turn: 1, ap: 2, visited: ['north_gate'] });

    const store = new VariableStore(decls);
    const r2 = new CalendarRunner(makeConfig(), store);
    r2.restore(snap);
    expect(r2.ap).toBe(2);
    expect(r2.hasVisited('north_gate')).toBe(true);
  });
});
