import { describe, expect, it } from 'vitest';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration, VarValue } from '../src/state/types.js';

const base: VarDeclaration[] = [
  { name: 'heroName', type: 'string', initial: '雷恩' },
  { name: 'lynn.trust', type: 'number', initial: 0, min: 0, max: 100 },
  { name: 'hasSword', type: 'flag', initial: false },
  { name: 'chapter', type: 'number', initial: 1, readonly: true },
  { name: 'items', type: 'string[]', initial: [] },
  { name: 'stats', type: 'object', initial: { hp: 10 } },
];

describe('VariableStore', () => {
  it('声明后可读取初值', () => {
    const s = new VariableStore(base);
    expect(s.getString('heroName')).toBe('雷恩');
    expect(s.getNumber('lynn.trust')).toBe(0);
    expect(s.getBoolean('hasSword')).toBe(false);
    expect(s.get<number>('chapter')).toBe(1);
  });

  it('未声明访问抛错', () => {
    const s = new VariableStore();
    expect(() => s.get('ghost')).toThrow(/Undefined variable 'ghost'/);
    expect(() => s.set('ghost', 1)).toThrow(/Undefined variable 'ghost'/);
  });

  it('重复声明抛错', () => {
    const s = new VariableStore();
    s.declare(base[0]!);
    expect(() => s.declare(base[0]!)).toThrow(/already declared/);
  });

  it('声明时 min > max 抛错', () => {
    const s = new VariableStore();
    expect(() => s.declare({ name: 'bad', type: 'number', initial: 0, min: 100, max: 0 })).toThrow(/min .* max/);
    expect(() => s.declare({ name: 'ok', type: 'number', initial: 0, min: 0, max: 100 })).not.toThrow();
  });

  it('set 类型不符抛错', () => {
    const s = new VariableStore(base);
    expect(() => s.set('heroName', 42)).toThrow(TypeError);
    expect(() => s.set('hasSword', 'yes')).toThrow(TypeError);
    expect(() => s.set('items', 'sword')).toThrow(TypeError);
    expect(() => s.set('stats', [])).toThrow(TypeError);
  });

  it('number 越界自动 clamp 到 [min,max]', () => {
    const s = new VariableStore(base);
    s.set('lynn.trust', 999);
    expect(s.getNumber('lynn.trust')).toBe(100);
    s.set('lynn.trust', -5);
    expect(s.getNumber('lynn.trust')).toBe(0);
  });

  it('modify/inc/dec 对 number 生效且 clamp', () => {
    const s = new VariableStore(base);
    s.modify('lynn.trust', 3);
    expect(s.getNumber('lynn.trust')).toBe(3);
    s.inc('lynn.trust');
    expect(s.getNumber('lynn.trust')).toBe(4);
    s.dec('lynn.trust');
    s.dec('lynn.trust');
    expect(s.getNumber('lynn.trust')).toBe(2);
    s.modify('lynn.trust', 200);
    expect(s.getNumber('lynn.trust')).toBe(100);
  });

  it('modify 溢出时沿用 set 的有限 number 错误且保留原值', () => {
    const s = new VariableStore([{ name: 'amount', type: 'number', initial: 1e308 }]);
    expect(() => s.modify('amount', 1e308)).toThrow(
      /Variable 'amount' \(value\): expected finite number/,
    );
    expect(s.getNumber('amount')).toBe(1e308);
  });

  it('toggle 只作用于 boolean/flag', () => {
    const s = new VariableStore(base);
    s.toggle('hasSword');
    expect(s.getBoolean('hasSword')).toBe(true);
    s.toggle('hasSword');
    expect(s.getBoolean('hasSword')).toBe(false);
    expect(() => s.toggle('heroName')).toThrow(/expected boolean\/flag/);
  });

  it('readonly 变量禁止修改', () => {
    const s = new VariableStore(base);
    expect(() => s.set('chapter', 2)).toThrow(/readonly/);
    expect(() => s.modify('chapter', 1)).toThrow(/readonly/);
    expect(s.getNumber('chapter')).toBe(1);
  });

  it('snapshot/restore 往返一致', () => {
    const s = new VariableStore(base);
    s.set('lynn.trust', 42);
    s.set('items', ['sword', 'shield']);
    const snap = s.snapshot();

    const s2 = new VariableStore(base);
    s2.set('lynn.trust', 0);
    s2.restore(snap);
    expect(s2.getNumber('lynn.trust')).toBe(42);
    expect(s2.get<string[]>('items')).toEqual(['sword', 'shield']);
  });

  it('recursive VarValue nested arrays/objects snapshot/restore 往返一致', () => {
    const initial: VarValue = {
      profile: { name: '凛', tags: ['夜', '雨'] },
      flags: [true, false],
      score: 7,
    };
    const s = new VariableStore([{ name: 'nested', type: 'object', initial }]);
    const snapshot = s.snapshot();
    const restored = new VariableStore([{ name: 'nested', type: 'object', initial: {} }]);
    restored.restore(snapshot);
    expect(restored.get('nested')).toEqual(initial);
  });

  it('snapshot 和深拷贝保留合法的 __proto__ 字面键', () => {
    const nested = Object.fromEntries([['__proto__', { value: 3 }]]) as unknown as VarValue;
    const s = new VariableStore([
      { name: '__proto__', type: 'number', initial: 7 },
      { name: 'cfg', type: 'object', initial: nested },
    ]);

    const snapshot = s.snapshot();
    expect(Object.prototype.hasOwnProperty.call(snapshot, '__proto__')).toBe(true);
    expect(snapshot['__proto__']).toBe(7);
    const snapshotCfg = snapshot.cfg as Record<string, VarValue>;
    expect(Object.prototype.hasOwnProperty.call(snapshotCfg, '__proto__')).toBe(true);
    expect(snapshotCfg['__proto__']).toEqual({ value: 3 });

    const restored = new VariableStore([
      { name: '__proto__', type: 'number', initial: 0 },
      { name: 'cfg', type: 'object', initial: {} },
    ]);
    restored.restore(snapshot);
    expect(restored.getNumber('__proto__')).toBe(7);
    expect(restored.get('cfg')).toEqual(nested);
  });

  it('restore 忽略未知键并对已知键重新 clamp', () => {
    const s = new VariableStore(base);
    s.restore({ ghost: 'x', 'lynn.trust': 999 });
    expect(s.getNumber('lynn.trust')).toBe(100);
    expect(s.has('ghost')).toBe(false);
  });

  it('restore 遇类型不符抛错', () => {
    const s = new VariableStore(base);
    expect(() => s.restore({ heroName: 42 })).toThrow(TypeError);
  });

  it('restore validates every declared value before committing any update', () => {
    const store = new VariableStore([
      { name: 'trust', type: 'number', initial: 1 },
      { name: 'flag', type: 'boolean', initial: false },
    ]);

    expect(() => store.restore({ trust: 999, flag: 'not-a-boolean' as never })).toThrow(/flag|boolean|类型/);
    expect(store.getNumber('trust')).toBe(1);
    expect(store.getBoolean('flag')).toBe(false);
  });

  it('R3 reset 恢复全部声明初值（新游戏）', () => {
    const s = new VariableStore(base);
    s.set('lynn.trust', 42);
    s.set('hasSword', true);
    s.set('heroName', '别人');
    s.reset();
    expect(s.getNumber('lynn.trust')).toBe(0);
    expect(s.getBoolean('hasSword')).toBe(false);
    expect(s.getString('heroName')).toBe('雷恩');
    expect(s.getNumber('chapter')).toBe(1); // readonly 一并重置
  });

  it('declare 深拷贝 object 初值，外部修改不影响 reset', () => {
    const initial = { score: 1 } as unknown as VarValue;
    const s = new VariableStore([{ name: 'cfg', type: 'object', initial }]);
    (initial as { score: number }).score = 99;

    s.reset();
    expect(s.get('cfg')).toEqual({ score: 1 });
  });

  it('declarations 返回声明表副本', () => {
    const s = new VariableStore(base);
    expect(s.declarations()).toHaveLength(base.length);
  });

  it('get 返回防御性拷贝（外部修改不影响内部状态）', () => {
    const s = new VariableStore(base);
    const arr = s.get<string[]>('items');
    arr.push('poison');
    expect(s.get<string[]>('items')).toEqual([]);
    const stats = s.get<Record<string, number>>('stats');
    stats['hp'] = 999;
    expect(s.get<Record<string, number>>('stats')).toEqual({ hp: 10 });
  });

  it('number 拒绝 Infinity/NaN', () => {
    const s = new VariableStore(base);
    expect(() => s.set('lynn.trust', Infinity)).toThrow(TypeError);
    expect(() => s.set('lynn.trust', -Infinity)).toThrow(TypeError);
    expect(() => s.modify('lynn.trust', Infinity)).toThrow();
  });

  it('number[] 运行时拒绝 NaN/Infinity 元素', () => {
    const s = new VariableStore([{ name: 'nums', type: 'number[]', initial: [] }]);
    expect(() => s.set('nums', [1, NaN])).toThrow(TypeError);
    expect(() => s.set('nums', [1, Infinity])).toThrow(TypeError);
    expect(() => s.set('nums', [1, -Infinity])).toThrow(TypeError);
    s.set('nums', [1, 2.5]);
    expect(s.get<number[]>('nums')).toEqual([1, 2.5]);
  });

  it('declarations 返回深拷贝（外部篡改不影响内部 clamp 约束）', () => {
    const s = new VariableStore(base);
    const decl = s.declarations().find((d) => d.name === 'lynn.trust')!;
    decl.max = 1000;
    s.set('lynn.trust', 999);
    expect(s.getNumber('lynn.trust')).toBe(100);
  });

  it('R1 object 变量拒绝非 JSON 安全嵌套值（存档序列化会静默丢失）', () => {
    const decl: VarDeclaration = { name: 'cfg', type: 'object', initial: {} };
    const s = new VariableStore([decl]);
    expect(() => s.set('cfg', { a: undefined } as unknown as VarValue)).toThrow(/JSON 安全/);
    expect(() => s.set('cfg', { a: NaN } as unknown as VarValue)).toThrow(/有限 number/);
    expect(() => s.set('cfg', { a: { b: () => 1 } } as unknown as VarValue)).toThrow(/JSON 安全/);
    expect(() => s.set('cfg', { a: [1, Infinity] } as unknown as VarValue)).toThrow(/有限 number/);
    // 合法嵌套（含数组/多层对象）不受影响
    expect(() => s.set('cfg', { hp: 10, tags: ['a'], sub: { ok: true } } as unknown as VarValue)).not.toThrow();
    // restore 同样校验（防篡改存档注入非法值）
    const s2 = new VariableStore([decl]);
    expect(() => s2.restore({ cfg: { a: undefined } as unknown as VarValue })).toThrow(/JSON 安全/);
  });

  it('deep clone：object 变量嵌套结构经 get 不被外部篡改', () => {
    const initial = { hp: 10, tags: ['a'] } as unknown as VarValue;
    const s = new VariableStore([{ name: 'cfg', type: 'object', initial } as VarDeclaration]);
    const first = s.get('cfg') as unknown as { hp: number; tags: string[] };
    first.hp = 999;
    first.tags.push('b');
    const second = s.get('cfg') as unknown as { hp: number; tags: string[] };
    expect(second.hp).toBe(10);
    expect(second.tags).toEqual(['a']);
  });

  it('setMany validates the whole batch before committing', () => {
    const store = new VariableStore([
      { name: 'gold', type: 'number', initial: 100 },
      { name: 'bag', type: 'string[]', initial: [] },
    ]);
    expect(() => store.setMany([
      { name: 'gold', value: 40 },
      { name: 'bag', value: 123 as never },
    ])).toThrow();
    expect(store.getNumber('gold')).toBe(100);
    expect(store.get<string[]>('bag')).toEqual([]);
  });

  it('setMany rejects duplicate names without mutation', () => {
    const store = new VariableStore([{ name: 'gold', type: 'number', initial: 100 }]);
    expect(() => store.setMany([
      { name: 'gold', value: 90 }, { name: 'gold', value: 80 },
    ])).toThrow(/重复变量/);
    expect(store.getNumber('gold')).toBe(100);
  });
});
