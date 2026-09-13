import { describe, expect, it } from 'vitest';
import { AffectionSystem } from '../src/systems/affection.js';
import { NewGamePlus } from '../src/systems/newgame-plus.js';
import type { NewGamePlusConfig } from '../src/systems/newgame-plus.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration } from '../src/state/types.js';

const decls: VarDeclaration[] = [
  { name: 'lynn.trust', type: 'number', initial: 10 },
  { name: 'cleared', type: 'flag', initial: false },
];

const profiles = [
  {
    characterId: 'lynn',
    variable: 'lynn.trust',
    tiers: [
      { min: 0, stage: '陌生' },
      { min: 30, stage: '好感' },
      { min: 70, stage: '恋慕' },
    ],
  },
];

const events = [
  { id: 'ev_trust_30', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'ev_lynn_30', once: true },
  { id: 'ev_trust_70', characterId: 'lynn', when: 'lynn.trust >= 70', scene: 'ev_lynn_70', once: true },
];

describe('AffectionSystem', () => {
  it('按好感阈值判定阶段', () => {
    const store = new VariableStore(decls);
    const sys = new AffectionSystem(profiles, events, store);
    expect(sys.stageOf('lynn')!.stage).toBe('陌生'); // 10
    store.set('lynn.trust', 40);
    expect(sys.stageOf('lynn')!.stage).toBe('好感');
    expect(sys.tierIndex('lynn')).toBe(1);
    store.set('lynn.trust', 80);
    expect(sys.stageOf('lynn')!.stage).toBe('恋慕');
  });

  it('事件按 when 解锁且 once 可消费', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 80);
    const sys = new AffectionSystem(profiles, events, store);
    const avail = sys.availableEvents('lynn');
    expect(avail.map((e) => e.id)).toEqual(['ev_trust_30', 'ev_trust_70']);

    expect(sys.consumeEvent('ev_trust_30')).toBe(true);
    expect(sys.consumeEvent('ev_trust_30')).toBe(false); // 已消费
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_trust_70']);
  });

  it('snapshot/restore 保留消费状态', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 80);
    const sys = new AffectionSystem(profiles, events, store);
    sys.consumeEvent('ev_trust_30');
    const snap = sys.snapshot();

    const store2 = new VariableStore(decls);
    store2.set('lynn.trust', 80);
    const sys2 = new AffectionSystem(profiles, events, store2);
    sys2.restore(snap);
    expect(sys2.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_trust_70']);
  });

  it('无配置角色返回 null/-1', () => {
    const sys = new AffectionSystem(profiles, events, new VariableStore(decls));
    expect(sys.stageOf('ghost')).toBeNull();
    expect(sys.tierIndex('ghost')).toBe(-1);
  });

  it('tiers 乱序配置仍按阈值正确判定阶段（构造时自动排序）', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 80);
    const shuffled = [
      { min: 70, stage: '恋慕' },
      { min: 0, stage: '陌生' },
      { min: 30, stage: '好感' },
    ];
    const sys = new AffectionSystem([{ characterId: 'lynn', variable: 'lynn.trust', tiers: shuffled }], [], store);
    expect(sys.stageOf('lynn')!.stage).toBe('恋慕');
    expect(sys.tierIndex('lynn')).toBe(2);

    store.set('lynn.trust', 5);
    expect(sys.stageOf('lynn')!.stage).toBe('陌生');
  });

  it('M5-C once:false 事件可重复触发', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 40);
    const repeat = { id: 'ev_repeat', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'x', once: false };
    const sys = new AffectionSystem(profiles, [repeat], store);
    expect(sys.consumeEvent('ev_repeat')).toBe(true);
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_repeat']); // 不消费
    expect(sys.consumeEvent('ev_repeat')).toBe(true); // 可再次触发
  });

  it('M5-C children 事件树门控：子事件需父事件已消费', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 80);
    const tree = [
      { id: 'ev_p1', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'a', once: true, children: ['ev_c1'] },
      { id: 'ev_c1', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'b', once: true },
    ];
    const sys = new AffectionSystem(profiles, tree, store);
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_p1']); // 子未解锁
    sys.consumeEvent('ev_p1');
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_c1']); // 父消费后子可用
  });

  it('M6-A once:false 父事件也能解锁子事件', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 80);
    const tree = [
      { id: 'ev_repeat_p', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'a', once: false, children: ['ev_child'] },
      { id: 'ev_child', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'b', once: true },
    ];
    const sys = new AffectionSystem(profiles, tree, store);
    // 父事件 once:false 可重复触发，子事件在父触发后解锁
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_repeat_p']);
    expect(sys.consumeEvent('ev_repeat_p')).toBe(true);
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_repeat_p', 'ev_child']);
    // 父可再次触发（once:false），子已解锁且可消费
    expect(sys.consumeEvent('ev_repeat_p')).toBe(true);
    expect(sys.consumeEvent('ev_child')).toBe(true);
    expect(sys.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_repeat_p']);
  });

  it('M6-A snapshot 保留门控记账（everConsumed）', () => {
    const store = new VariableStore(decls);
    store.set('lynn.trust', 80);
    const tree = [
      { id: 'ev_repeat_p', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'a', once: false, children: ['ev_child'] },
      { id: 'ev_child', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'b', once: true },
    ];
    const sys = new AffectionSystem(profiles, tree, store);
    sys.consumeEvent('ev_repeat_p');
    const snap = sys.snapshot();
    expect(snap.everConsumed).toContain('ev_repeat_p');

    const store2 = new VariableStore(decls);
    store2.set('lynn.trust', 80);
    const sys2 = new AffectionSystem(profiles, tree, store2);
    sys2.restore(snap);
    expect(sys2.availableEvents('lynn').map((e) => e.id)).toEqual(['ev_repeat_p', 'ev_child']);
  });
});

describe('NewGamePlus', () => {
  const ngpConfig: NewGamePlusConfig = {
    clearCondition: 'cleared',
    inherit: [
      { variable: 'lynn.trust', mode: 'copy' },
      { variable: 'gold', mode: 'add', weight: 0.5 },
      { variable: 'maxTrust', mode: 'max' },
    ],
    unlockGallery: true,
  };

  it('clear 判定', () => {
    const store = new VariableStore(decls);
    const ngp = new NewGamePlus(ngpConfig, store);
    expect(ngp.isCleared()).toBe(false);
    store.set('cleared', true);
    expect(ngp.isCleared()).toBe(true);
  });

  it('继承计算：copy/add/max', () => {
    const store = new VariableStore([
      ...decls,
      { name: 'gold', type: 'number', initial: 0 },
      { name: 'maxTrust', type: 'number', initial: 5 },
    ]);
    store.set('lynn.trust', 80);
    store.set('gold', 100);
    store.set('maxTrust', 3); // 通关值低于初始 → max 保留初始

    const ngp = new NewGamePlus(ngpConfig, store);
    const base = { 'lynn.trust': 0, gold: 10, maxTrust: 5 };
    const result = ngp.computeInherit(base);
    expect(result['lynn.trust']).toBe(80); // copy
    expect(result['gold']).toBe(60); // 10 + round(100*0.5)
    expect(result['maxTrust']).toBe(5); // max(5, 3)
  });

  it('合法原型名变量可继承，缺失变量不会读取对象原型', () => {
    const config: NewGamePlusConfig = {
      clearCondition: 'true',
      inherit: [
        { variable: '__proto__', mode: 'copy' },
        { variable: 'constructor', mode: 'copy' },
        { variable: 'toString', mode: 'copy' },
      ],
      unlockGallery: false,
    };
    const store = new VariableStore([{ name: '__proto__', type: 'number', initial: 0 }]);
    store.set('__proto__', 7);
    const result = new NewGamePlus(config, store).computeInherit({});
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(result['__proto__']).toBe(7);
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'toString')).toBe(false);
  });

  it('unlockGallery 透传', () => {
    const ngp = new NewGamePlus(ngpConfig, new VariableStore(decls));
    expect(ngp.unlockGallery).toBe(true);
  });
});
