import { describe, expect, it } from 'vitest';
import { AchievementSystem } from '../src/systems/achievement.js';
import type { AchievementDef } from '../src/systems/achievement.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration } from '../src/state/types.js';

const decls: VarDeclaration[] = [
  { name: 'battleWon', type: 'flag', initial: false },
  { name: 'lynn.trust', type: 'number', initial: 0 },
  { name: 'cleared', type: 'flag', initial: false },
];

function makeDefs(): AchievementDef[] {
  return [
    { id: 'first_battle', name: '初战告捷', when: 'battleWon' },
    { id: 'best_friend', name: '挚友', when: 'lynn.trust >= 50' },
    { id: 'clear_game', name: '通关纪念', when: 'cleared' },
    { id: 'secret', name: '隐藏结局', hidden: true, description: '达成隐藏结局' },
  ];
}

function makeSystem() {
  const store = new VariableStore(decls);
  const ach = new AchievementSystem(makeDefs(), store);
  return { store, ach };
}

describe('AchievementSystem（成就系统）', () => {
  it('check：批量判定 when 条件，只解锁新满足的成就', () => {
    const { store, ach } = makeSystem();
    expect(ach.check()).toEqual([]); // 初始全不满足

    store.set('battleWon', true);
    const fresh = ach.check();
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ id: 'first_battle', fresh: true });
    expect(ach.isUnlocked('first_battle')).toBe(true);

    // 重复 check 不重复解锁
    expect(ach.check()).toEqual([]);
  });

  it('unlock：事件触发解锁，重复幂等（fresh=false）；未知 ID 抛错', () => {
    const { ach } = makeSystem();
    const r1 = ach.unlock('secret');
    expect(r1.fresh).toBe(true);
    expect(ach.isUnlocked('secret')).toBe(true);

    const r2 = ach.unlock('secret');
    expect(r2.fresh).toBe(false); // 幂等

    expect(() => ach.unlock('nope')).toThrow(/未知成就/);
  });

  it('进度与顺序：unlocked() 按解锁顺序返回；progress 格式 "n/total"', () => {
    const { store, ach } = makeSystem();
    ach.unlock('secret');
    store.set('battleWon', true);
    ach.check();
    store.set('lynn.trust', 60);
    ach.check();

    expect(ach.unlocked()).toEqual(['secret', 'first_battle', 'best_friend']);
    expect(ach.unlockedCount).toBe(3);
    expect(ach.total).toBe(4);
    expect(ach.progress()).toBe('3/4');
  });

  it('hidden 成就：定义可查询（展示层据此渲染 ???）', () => {
    const { ach } = makeSystem();
    const def = ach.defOf('secret');
    expect(def).not.toBeNull();
    expect(def!.hidden).toBe(true);
    expect(def!.name).toBe('隐藏结局');
    expect(ach.defOf('nope')).toBeNull();
  });

  it('条件求值严格策略：未声明变量抛错（与 @if 一致）', () => {
    const store = new VariableStore(decls);
    const ach = new AchievementSystem(
      [{ id: 'bad', name: 'x', when: 'undefinedVar > 1' }],
      store,
    );
    expect(() => ach.check()).toThrow();
  });

  it('构造防御：成就 ID 重复抛错', () => {
    const store = new VariableStore(decls);
    expect(() => new AchievementSystem(
      [{ id: 'dup', name: 'a' }, { id: 'dup', name: 'b' }],
      store,
    )).toThrow(/ID 重复/);
  });

  it('snapshot/restore 往返：解锁状态恢复；旧档含已删除成就静默忽略', () => {
    const { store, ach } = makeSystem();
    store.set('battleWon', true);
    ach.check();
    ach.unlock('secret');
    const snap = ach.snapshot();
    expect(snap).toEqual({ unlocked: ['first_battle', 'secret'] });

    // 新实例恢复（模拟读档）；快照含一个已删除成就 'removed'
    const { ach: ach2 } = makeSystem();
    ach2.restore({ unlocked: [...snap.unlocked, 'removed'] });
    expect(ach2.unlocked()).toEqual(['first_battle', 'secret']);

    // JSON 序列化往返不损坏
    const json = JSON.parse(JSON.stringify(snap)) as ReturnType<typeof ach.snapshot>;
    const { ach: ach3 } = makeSystem();
    ach3.restore(json);
    expect(ach3.unlocked()).toEqual(['first_battle', 'secret']);
  });

  it('restore 去重：旧档含重复 ID 不污染进度计数', () => {
    const { ach } = makeSystem();
    ach.restore({ unlocked: ['secret', 'secret', 'first_battle'] });
    expect(ach.unlocked()).toEqual(['secret', 'first_battle']);
    expect(ach.unlockedCount).toBe(2);
  });
});
