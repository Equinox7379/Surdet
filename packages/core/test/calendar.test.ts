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

  it('回合超限后 canEnter/enter 拒绝进入节点', () => {
    const { runner } = makeRunner();
    for (let i = 0; i < 12; i++) runner.advanceTurn();
    expect(runner.isOver).toBe(true);
    expect(runner.canEnter('north_gate')).toBe(false);
    const r = runner.enter('north_gate');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('超限');
    expect(runner.hasVisited('north_gate')).toBe(false);
  });

  it('snapshot/restore 往返', () => {
    const { runner } = makeRunner();
    runner.enter('north_gate');
    const snap = runner.snapshot();
    expect(snap).toEqual({ turn: 1, ap: 2, visited: ['north_gate'], commandCounts: {} });

    const store = new VariableStore(decls);
    const r2 = new CalendarRunner(makeConfig(), store);
    r2.restore(snap);
    expect(r2.ap).toBe(2);
    expect(r2.hasVisited('north_gate')).toBe(true);
  });
});

describe('CalendarRunner 据点指令（兰斯式 base commands）', () => {
  function makeBaseConfig(): CalendarConfig {
    return {
      maxAp: 3,
      maxTurns: 12,
      dateTemplate: '第{turn}周',
      nodes: [{ id: 'base', name: '据点', x: 0, y: 0, apCost: 0, isBase: true }],
      baseCommands: [
        { id: 'rest', name: '休息', apCost: 1, effects: { 'lynn.hp': 5 } },
        { id: 'train', name: '训练', apCost: 2, effects: { 'lynn.atk': 1 }, perTurn: 1 },
        { id: 'drill', name: '操练', apCost: 1, perTurn: 1 },
        { id: 'scout', name: '侦察', apCost: 1, when: 'liberated', eventId: 'ev_scout' },
      ],
    };
  }

  function makeBaseRunner() {
    const store = new VariableStore(decls);
    return { store, runner: new CalendarRunner(makeBaseConfig(), store) };
  }

  it('执行据点指令：扣行动力、返回 effects/eventId', () => {
    const { runner } = makeBaseRunner();
    const r = runner.execBaseCommand('rest');
    expect(r).toEqual({ ok: true, effects: { 'lynn.hp': 5 } });
    expect(runner.ap).toBe(2);

    const r2 = runner.execBaseCommand('scout'); // when 条件不满足
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('执行条件未满足');
  });

  it('perTurn 限次：超过上限拒绝执行，回合切换后重置', () => {
    const { runner } = makeBaseRunner();
    expect(runner.execBaseCommand('drill').ok).toBe(true); // ap 3→2
    expect(runner.execBaseCommand('drill').ok).toBe(false); // 本回合已执行过
    expect(runner.execBaseCommand('drill').reason).toBe('本回合已无法再次执行该指令');

    runner.advanceTurn();
    expect(runner.execBaseCommand('drill').ok).toBe(true); // 新回合重置
  });

  it('行动力不足拒绝执行；未配置指令报错', () => {
    const { runner } = makeBaseRunner();
    runner.execBaseCommand('train'); // ap 3→1
    runner.execBaseCommand('rest'); // ap 1→0
    const r = runner.execBaseCommand('rest'); // ap 0 < 1
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('行动力不足');
    expect(runner.execBaseCommand('nope').reason).toBe("据点指令 'nope' 未配置");
  });

  it('when 条件满足后可执行并返回 eventId', () => {
    const { store, runner } = makeBaseRunner();
    expect(runner.canExecBaseCommand('scout')).toBe(false);
    store.set('liberated', true);
    expect(runner.canExecBaseCommand('scout')).toBe(true);
    expect(runner.execBaseCommand('scout')).toEqual({ ok: true, eventId: 'ev_scout' });
  });

  it('commandCounts 随存档往返（限次状态持久化）', () => {
    const { runner } = makeBaseRunner();
    runner.execBaseCommand('drill');
    const snap = runner.snapshot();
    expect(snap.commandCounts).toEqual({ drill: 1 });

    const r2 = new CalendarRunner(makeBaseConfig(), new VariableStore(decls));
    r2.restore(snap);
    expect(r2.execBaseCommand('drill').ok).toBe(false); // 限次状态恢复
    expect(r2.execBaseCommand('drill').reason).toBe('本回合已无法再次执行该指令');

    // 旧档无 commandCounts 字段按空恢复（限次指令重新可用）
    const r3 = new CalendarRunner(makeBaseConfig(), new VariableStore(decls));
    r3.restore({ turn: 1, ap: 3, visited: [] });
    expect(r3.execBaseCommand('drill').ok).toBe(true);
  });
});
