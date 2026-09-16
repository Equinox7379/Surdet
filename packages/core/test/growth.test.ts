import { describe, expect, it } from 'vitest';
import { GrowthSystem } from '../src/systems/growth.js';
import type { GrowthConfig } from '../src/systems/growth.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration } from '../src/state/types.js';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import type { CoreEventMap } from '../src/runtime/interpreter.js';
import { assertValidSnapshot } from '../src/save/save-manager.js';

const decls: VarDeclaration[] = [
  { name: 'lynn.atk', type: 'number', initial: 5 },
  { name: 'lynn.hp', type: 'number', initial: 20 },
];

const curve: GrowthConfig['curve'] = { base: 10, linear: 5 }; // L2=10, L3=15, L4=20 ...

function makeGrowth(overrides: Partial<GrowthConfig> = {}) {
  const store = new VariableStore(decls);
  const config: GrowthConfig = {
    curve,
    profiles: [
      { characterId: 'lynn', statGrowth: { 'lynn.atk': 2, 'lynn.hp': 10 } },
    ],
    ...overrides,
  };
  return { store, growth: new GrowthSystem(config, store) };
}

describe('GrowthSystem（角色成长）', () => {
  it.each([0, -1, 1.5, Infinity, NaN, 6])('rejects invalid restored level %s without resetting live growth', (level) => {
    const { growth } = makeGrowth({ profiles: [{ characterId: 'lynn', maxLevel: 5 }] });
    growth.gainExp('lynn', 12);
    const before = growth.snapshot();
    expect(() => growth.restore({ levels: { lynn: level }, experience: { lynn: 0 } })).toThrow();
    expect(growth.snapshot()).toEqual(before);
  });
  it.each([-1, Infinity, NaN])('rejects invalid experience %s without resetting live growth', (xp) => {
    const { growth } = makeGrowth();
    growth.gainExp('lynn', 12);
    const before = growth.snapshot();
    expect(() => growth.restore({ levels: { lynn: 1 }, experience: { lynn: xp } })).toThrow();
    expect(growth.snapshot()).toEqual(before);
  });
  it('经验累积到阈值升级，属性增量写回变量仓库', () => {
    const { store, growth } = makeGrowth();
    expect(growth.levelOf('lynn')).toBe(1);
    expect(growth.experienceOf('lynn')).toBe(0);

    const res = growth.gainExp('lynn', 12); // 需要 10 升 L2，余 2
    expect(res.levelAfter).toBe(2);
    expect(res.levelsGained).toBe(1);
    expect(res.passedLevels).toEqual([2]);
    expect(growth.experienceOf('lynn')).toBe(2);
    expect(store.get('lynn.atk')).toBe(7); // 5 + 2
    expect(store.get('lynn.hp')).toBe(30); // 20 + 10
  });

  it('单次获得大量经验可连升多级（属性增量逐级叠加）', () => {
    const { store, growth } = makeGrowth();
    const res = growth.gainExp('lynn', 30); // L2=10, L3=15 → 升两级，余 5
    expect(res.levelBefore).toBe(1);
    expect(res.levelAfter).toBe(3);
    expect(res.passedLevels).toEqual([2, 3]);
    expect(growth.experienceOf('lynn')).toBe(5);
    expect(store.get('lynn.atk')).toBe(9); // 5 + 2*2
    expect(store.get('lynn.hp')).toBe(40); // 20 + 10*2
  });

  it('maxLevel 封顶：溢出经验不再升级', () => {
    const { growth } = makeGrowth({
      profiles: [{ characterId: 'lynn', maxLevel: 2 }],
    });
    const res = growth.gainExp('lynn', 100);
    expect(res.levelAfter).toBe(2);
    expect(res.levelsGained).toBe(1);
    expect(growth.expToNext('lynn')).toBeNull();
  });

  it('显式曲线（levels 表）：超表封顶不再升级', () => {
    const store = new VariableStore(decls);
    const growth = new GrowthSystem(
      { curve: { levels: [10, 20] }, profiles: [{ characterId: 'lynn' }] },
      store,
    );
    expect(growth.expForLevel(2)).toBe(10);
    expect(growth.expForLevel(3)).toBe(20);
    expect(growth.expForLevel(4)).toBe(0); // 超表
    const res = growth.gainExp('lynn', 999);
    expect(res.levelAfter).toBe(3); // L2(10) + L3(20) 后表耗尽
  });

  it('expToNext：距下一级差额；未达阈值不升级', () => {
    const { growth } = makeGrowth();
    expect(growth.expToNext('lynn')).toBe(10);
    growth.gainExp('lynn', 6);
    expect(growth.levelOf('lynn')).toBe(1);
    expect(growth.expToNext('lynn')).toBe(4);
  });

  it('未注册角色 / 非法增量抛错（严格策略）', () => {
    const { growth } = makeGrowth();
    expect(() => growth.gainExp('ghost', 10)).toThrow(/未注册角色/);
    expect(() => growth.levelOf('ghost')).toThrow(/未注册角色/);
    expect(() => growth.gainExp('lynn', Number.NaN)).toThrow(/经验增量非法/);
  });

  it('levelEvents：达到指定等级返回事件场景（无配置返回 null）', () => {
    const { growth } = makeGrowth({
      profiles: [{ characterId: 'lynn', levelEvents: { 3: 'lynn_lv3_event' } }],
    });
    expect(growth.levelEventFor('lynn', 3)).toBe('lynn_lv3_event');
    expect(growth.levelEventFor('lynn', 2)).toBeNull();
    expect(growth.levelEventFor('ghost', 3)).toBeNull();
  });

  it('snapshot/restore 往返：等级与经验恢复；未注册角色静默忽略', () => {
    const { growth } = makeGrowth();
    growth.gainExp('lynn', 12); // L2, xp=2
    const snap = growth.snapshot();
    expect(snap).toEqual({ levels: { lynn: 2 }, experience: { lynn: 2 } });

    const { growth: g2 } = makeGrowth();
    g2.restore({ ...snap, levels: { ...snap.levels, ghost: 9 } }); // 旧档含已删除角色
    expect(g2.levelOf('lynn')).toBe(2);
    expect(g2.experienceOf('lynn')).toBe(2);
    expect(g2.has('ghost')).toBe(false);
  });

  it('JSON 序列化往返不损坏（存档管线深拷贝兼容）', () => {
    const { growth } = makeGrowth();
    growth.gainExp('lynn', 25);
    const snap = JSON.parse(JSON.stringify(growth.snapshot())) as ReturnType<typeof growth.snapshot>;
    const { growth: g2 } = makeGrowth();
    g2.restore(snap);
    expect(g2.levelOf('lynn')).toBe(growth.levelOf('lynn'));
    expect(g2.experienceOf('lynn')).toBe(growth.experienceOf('lynn'));
  });
});

describe('GrowthSystem gainExp 原子提交', () => {
  function expectNoStateMutation(
    store: VariableStore,
    growth: GrowthSystem,
    action: () => void,
  ): void {
    const beforeVariables = store.snapshot();
    const beforeGrowth = growth.snapshot();
    expect(action).toThrow();
    expect(store.snapshot()).toEqual(beforeVariables);
    expect(growth.snapshot()).toEqual(beforeGrowth);
  }

  it('未声明的后续 statGrowth 目标不会留下前一个属性的部分写入', () => {
    const store = new VariableStore(decls);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.missing': 3 },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('非 number 的后续 statGrowth 目标不会留下前一个属性的部分写入', () => {
    const store = new VariableStore([
      ...decls,
      { name: 'lynn.flag', type: 'boolean', initial: false },
    ]);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.flag': 1 },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('readonly 的后续 statGrowth 目标不会留下前一个属性的部分写入', () => {
    const store = new VariableStore([
      ...decls,
      { name: 'lynn.locked', type: 'number', initial: 4, readonly: true },
    ]);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.locked': 1 },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('非有限的后续 statGrowth 增量不会留下前一个属性的部分写入', () => {
    const store = new VariableStore(decls);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: {
            'lynn.atk': 2,
            'lynn.hp': Number.POSITIVE_INFINITY as unknown as number,
          },
        }],
      },
      store,
    );

    expectNoStateMutation(store, growth, () => growth.gainExp('lynn', 30));
  });

  it('合法连升仍按原有 clamp 规则一次性提交全部属性、等级和经验', () => {
    const store = new VariableStore([
      { name: 'lynn.atk', type: 'number', initial: 5, max: 7 },
      { name: 'lynn.hp', type: 'number', initial: 20 },
    ]);
    const growth = new GrowthSystem(
      {
        curve,
        profiles: [{
          characterId: 'lynn',
          statGrowth: { 'lynn.atk': 2, 'lynn.hp': 10 },
        }],
      },
      store,
    );

    expect(growth.gainExp('lynn', 30)).toMatchObject({
      levelBefore: 1,
      levelAfter: 3,
      levelsGained: 2,
      passedLevels: [2, 3],
    });
    expect(store.snapshot()).toEqual({ 'lynn.atk': 7, 'lynn.hp': 40 });
    expect(growth.snapshot()).toEqual({ levels: { lynn: 3 }, experience: { lynn: 5 } });
  });
});

describe('@exp 指令（解释器集成）', () => {
  const baseDecls: VarDeclaration[] = [
    { name: 'lynn.atk', type: 'number', initial: 5 },
  ];

  function makeInterpWithGrowth() {
    const store = new VariableStore(baseDecls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const growth = new GrowthSystem(
      { curve: { base: 10 }, profiles: [{ characterId: 'lynn', statGrowth: { 'lynn.atk': 2 } }] },
      store,
    );
    const interp = new Interpreter(store, bus, registry, undefined, undefined, {}, undefined, growth);
    return { store, bus, registry, interp, growth };
  }

  it('@exp 角色 经验：驱动升级并广播 growth 事件', () => {
    const { store, bus, registry, interp } = makeInterpWithGrowth();
    registry.register(compileScene('@exp lynn 25\n凛：升级了。', 's.gal', 's1'));
    const events: unknown[] = [];
    bus.on('growth', (p) => events.push(p));

    interp.start('s1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      characterId: 'lynn',
      gained: 25,
      levelBefore: 1,
      levelAfter: 3, // base=10 固定：L2=10, L3=10
      levelsGained: 2,
    });
    expect(store.get('lynn.atk')).toBe(9); // 5 + 2*2
    expect(interp.status).toBe('awaiting-advance');
  });

  it('@exp 未注入成长系统 / 缺参数 / 未注册角色 → 运行时错误', () => {
    // 未注入 GrowthSystem
    const store = new VariableStore(baseDecls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const bare = new Interpreter(store, bus, registry);
    registry.register(compileScene('@exp lynn 10', 's.gal', 's1'));
    expect(() => bare.start('s1')).toThrow(/GrowthSystem/);

    // 缺参数
    const { registry: r2, interp: i2 } = makeInterpWithGrowth();
    r2.register(compileScene('@exp lynn', 's.gal', 's2'));
    expect(() => i2.start('s2')).toThrow(/用法/);

    // 经验值非法
    const { registry: r3, interp: i3 } = makeInterpWithGrowth();
    r3.register(compileScene('@exp lynn abc', 's.gal', 's3'));
    expect(() => i3.start('s3')).toThrow(/经验值非法/);

    // 未注册角色
    const { registry: r4, interp: i4 } = makeInterpWithGrowth();
    r4.register(compileScene('@exp ghost 10', 's.gal', 's4'));
    expect(() => i4.start('s4')).toThrow(/未注册角色/);
  });

  it('成长状态随存档往返（新解释器读档恢复等级/经验）', () => {
    const { registry, interp } = makeInterpWithGrowth();
    registry.register(compileScene('@exp lynn 12\n凛：甲。', 's.gal', 's1'));

    interp.start('s1'); // @exp → L2 xp=2，挂起在文本
    const snap = interp.saveSnapshot()!;
    expect(snap.growth).toEqual({ levels: { lynn: 2 }, experience: { lynn: 2 } });

    const { registry: r2, interp: i2, growth: g2 } = makeInterpWithGrowth();
    r2.register(compileScene('@exp lynn 12\n凛：甲。', 's.gal', 's1'));
    i2.loadSnapshot(snap);
    expect(g2.levelOf('lynn')).toBe(2);
    expect(g2.experienceOf('lynn')).toBe(2);
  });

  it('setGrowth：构造后注入（宿主延迟配置）', () => {
    const store = new VariableStore(baseDecls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interp = new Interpreter(store, bus, registry);
    expect(interp.growth).toBeNull();
    registry.register(compileScene('@exp lynn 10', 's.gal', 's1'));
    expect(() => interp.start('s1')).toThrow(/GrowthSystem/);

    const growth = new GrowthSystem(
      { curve: { base: 10 }, profiles: [{ characterId: 'lynn' }] },
      store,
    );
    interp.setGrowth(growth);
    expect(interp.growth).toBe(growth);
    interp.start('s1');
    expect(growth.levelOf('lynn')).toBe(2);
  });

  it('存档校验：growth 结构非法在读档入口拒绝', () => {
    const { registry, interp } = makeInterpWithGrowth();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;

    // levels 值非 number
    expect(() =>
      assertValidSnapshot({ ...snap, growth: { levels: { lynn: 'two' } } }),
    ).toThrow(/growth\.levels/);

    // growth 非对象
    expect(() => assertValidSnapshot({ ...snap, growth: [] })).toThrow(/growth 必须是对象/);

    // 合法结构通过（可选字段缺省）
    expect(() => assertValidSnapshot({ ...snap, growth: { levels: { lynn: 2 } } })).not.toThrow();
    expect(() => assertValidSnapshot(snap)).not.toThrow();
  });

  it('负经验兜底：经验值不为负、等级不下降', () => {
    const { growth } = makeGrowth();
    growth.gainExp('lynn', 12); // L2，xp=2
    const res = growth.gainExp('lynn', -100);
    expect(res.levelAfter).toBe(2); // 等级不下降
    expect(growth.experienceOf('lynn')).toBe(0); // 经验下限 0
  });
});
