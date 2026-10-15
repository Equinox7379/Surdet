import {
  CalendarRunner,
  compileScene,
  EventBus,
  Interpreter,
  SceneRegistry,
  VariableStore,
  type BaseCommandDef,
  type CoreEventMap,
} from '@surdet/core';
import type { BasePanelView, MapView } from '@surdet/renderer';
import { describe, expect, it, vi } from 'vitest';
import { createSystemAdapters } from '../../shared/player/system-adapters.js';

function fixture(command: Partial<BaseCommandDef> = {}) {
  const store = new VariableStore([
    { name: 'hp', type: 'number', initial: 8, min: 0, max: 10 },
    { name: 'gold', type: 'number', initial: 5, min: 0 },
    { name: 'locked', type: 'number', initial: 2, readonly: true },
    { name: 'label', type: 'string', initial: '据点' },
  ]);
  const calendar = new CalendarRunner({
    nodes: [{ id: 'base', name: '据点', x: 100, y: 200, apCost: 0, isBase: true }],
    maxAp: 3,
    maxTurns: 10,
    dateTemplate: '第{turn}回合',
    baseCommands: [{ id: 'train', name: '训练', apCost: 1, perTurn: 1, ...command }],
  }, store);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  registry.register(compileScene('@set gold += 1\n训练演出。\n@end', 'trained.gal', 'trained'));
  const interpreter = new Interpreter(store, bus, registry);
  const texts: string[] = [];
  bus.on('text', ({ value }) => texts.push(value));
  let enter!: (id: string) => void;
  let execute!: (id: string) => void;
  let panel!: BasePanelView;
  const renderer = {
    showMap: vi.fn((_view: MapView, onEnter: (id: string) => void) => { enter = onEnter; }),
    hideMap: vi.fn(),
    showBaseCommands: vi.fn((view: BasePanelView, onExec: (id: string) => void) => {
      panel = view;
      execute = onExec;
    }),
    hideBaseCommands: vi.fn(),
    showBattle: vi.fn(),
    hideBattle: vi.fn(),
    showShop: vi.fn(),
    hideShop: vi.fn(),
  };
  const context = { pause: vi.fn(), resume: vi.fn(), fail: vi.fn() };
  const onAchievementsChanged = vi.fn();
  const onLog = vi.fn();
  const adapter = createSystemAdapters({
    store, calendar, interpreter, registry, renderer, onAchievementsChanged, onLog,
  }).find(({ id }) => id === 'calendar')!;
  adapter.open(undefined, context);
  enter('base');
  expect(context.fail).not.toHaveBeenCalled();
  return {
    store, calendar, context, renderer, texts, onAchievementsChanged, onLog,
    execute: (id = 'train') => execute(id),
    panel: () => panel,
  };
}

describe('Shared Player calendar base command settlement', () => {
  it.each([
    ['未声明变量', 'missing', 1, /missing/],
    ['只读变量', 'locked', 1, /readonly/],
    ['非数字变量', 'label', 1, /expected number/],
    ['非有限增量', 'gold', Infinity, /finite number/],
  ] as const)('后一个效果为%s时，恢复全部变量、AP和次数并报告错误', (_label, target, delta, error) => {
    const f = fixture({ effects: { hp: 1, [target]: delta }, eventId: 'trained' });
    const beforeStore = f.store.snapshot();
    const beforeCalendar = f.calendar.snapshot();

    f.execute();

    expect(f.store.snapshot()).toEqual(beforeStore);
    expect(f.calendar.snapshot()).toEqual(beforeCalendar);
    expect(f.calendar.baseCommandRemaining('train')).toBe(1);
    expect(f.context.fail).toHaveBeenCalledTimes(1);
    expect(String(f.context.fail.mock.calls[0]![0])).toMatch(error);
    expect(f.context.resume).not.toHaveBeenCalled();
    expect(f.renderer.hideBaseCommands).not.toHaveBeenCalled();
    expect(f.texts).toEqual([]);
    expect(f.onAchievementsChanged).not.toHaveBeenCalled();
    expect(f.renderer.showBaseCommands).toHaveBeenCalledTimes(1);
    expect(f.panel().message).toBe('选择要执行的指令。');
    expect(f.onLog).not.toHaveBeenCalledWith(expect.stringContaining('写回失败'));
  });

  it('成功执行全部效果并保留上下限截断；同回合再次执行不重复扣费或通知成就', () => {
    const f = fixture({ effects: { hp: 100, gold: -20 } });
    f.execute();

    expect(f.store.getNumber('hp')).toBe(10);
    expect(f.store.getNumber('gold')).toBe(0);
    expect(f.calendar.ap).toBe(2);
    expect(f.calendar.baseCommandRemaining('train')).toBe(0);
    expect(f.panel().message).toBe('执行了「训练」。');
    expect(f.panel().commands[0]).toMatchObject({ enabled: false, remaining: 0 });
    expect(f.onAchievementsChanged).toHaveBeenCalledTimes(1);
    const beforeStore = f.store.snapshot();
    const beforeCalendar = f.calendar.snapshot();

    f.execute();

    expect(f.store.snapshot()).toEqual(beforeStore);
    expect(f.calendar.snapshot()).toEqual(beforeCalendar);
    expect(f.panel().message).toBe('本回合已无法再次执行该指令');
    expect(f.onAchievementsChanged).toHaveBeenCalledTimes(1);
    expect(f.context.fail).not.toHaveBeenCalled();
  });

  it('成功写回后仍通过真实Interpreter跳转配置演出', () => {
    const f = fixture({ effects: { gold: 2 }, eventId: 'trained' });
    f.execute();

    expect(f.store.getNumber('gold')).toBe(8);
    expect(f.calendar.ap).toBe(2);
    expect(f.calendar.baseCommandRemaining('train')).toBe(0);
    expect(f.texts).toEqual(['训练演出。']);
    expect(f.renderer.hideBaseCommands).toHaveBeenCalledTimes(1);
    expect(f.context.resume).toHaveBeenCalledTimes(1);
    expect(f.context.fail).not.toHaveBeenCalled();
  });

  it('没有effects的成功指令仍扣费记次；行动力不足拒绝时保持已有结算', () => {
    const f = fixture({ apCost: 2, perTurn: undefined });
    f.execute();
    expect(f.calendar.ap).toBe(1);
    expect(f.calendar.snapshot().commandCounts).toEqual({ train: 1 });
    expect(f.panel().message).toBe('执行了「训练」。');
    const before = f.calendar.snapshot();

    f.execute();

    expect(f.calendar.snapshot()).toEqual(before);
    expect(f.panel().message).toBe('行动力不足');
    expect(f.onAchievementsChanged).toHaveBeenCalledTimes(1);
    expect(f.context.fail).not.toHaveBeenCalled();
  });
});
