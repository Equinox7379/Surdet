/**
 * 独立审计修复回归测试：
 *  C1/M1 读档状态重置（stateReset 广播 + hostPaused 清理）
 *  M2    hostJump 在 text/choice 事件回调内重入不再冻结
 *  Minor readonly restore / 战斗越权 / 存档深度校验 / choice 多跳转 W008
 */
import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';
import { CombatSolver } from '../src/combat/combat.js';
import type { CombatConfig } from '../src/combat/combat.js';
import { assertValidSnapshot } from '../src/save/save-manager.js';
import type { VarDeclaration } from '../src/state/types.js';
import type { CoreEventMap } from '../src/runtime/interpreter.js';

const decls: VarDeclaration[] = [
  { name: 'trust', type: 'number', initial: 0 },
  { name: 'chapter', type: 'number', initial: 1, readonly: true },
];

function makeRuntime() {
  const store = new VariableStore(decls);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  const interp = new Interpreter(store, bus, registry);
  return { store, bus, registry, interp };
}

describe('C1/M1：读档状态重置', () => {
  it('SceneRegistry.replace 原子替换同 ID，拒绝未注册或不匹配 ID', () => {
    const registry = new SceneRegistry();
    const original = compileScene('旧文本', 's.gal', 's1');
    const replacement = compileScene('新文本', 's.gal', 's1');
    registry.register(original);
    registry.replace(replacement);
    expect(registry.get('s1')).toBe(replacement);
    expect(() => registry.replace(compileScene('x', 'x.gal', 'missing'))).toThrow(/not registered/);
    expect(() => registry.replace(compileScene('x', 'x.gal', 's1'), 'other')).toThrow(/mismatch|Cannot replace/);
  });
  it('M1：宿主暂停（战斗/地图/商店进行中）读档 → 清除 hostPaused，不残留挂起，可正常推进', () => {
    const { registry, interp } = makeRuntime();
    registry.register(compileScene('凛：甲。\n凛：乙。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    interp.advance();       // 推进到乙
    interp.pauseHost();     // 宿主暂停（战斗/地图/商店进行中）→ 内部 hostPaused=true
    interp.loadSnapshot(snap);
    // 读档必须清掉宿主暂停残留；此后推进链路完整可用（修复前 hostPaused 残留导致冻结/语义不一致）
    expect(interp.status).toBe('awaiting-advance');
    expect(() => interp.advance()).not.toThrow();
    expect(() => interp.advance()).not.toThrow();
    expect(interp.status).toBe('ended');
    // resumeHost 应是幂等无副作用（hostPaused 已被读档清除）
    expect(() => interp.resumeHost()).not.toThrow();
    expect(interp.status).toBe('ended');
  });

  it('C1：loadSnapshot 广播 stateReset（渲染层据此作废 @wait 计时）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    let resets = 0;
    bus.on('stateReset', (p) => { if (p.reason === 'load') resets++; });
    interp.start('s1');
    expect(resets).toBe(0);
    const snap = interp.saveSnapshot()!;
    interp.loadSnapshot(snap);
    expect(resets).toBe(1);
  });

  it('C1：@wait 挂起期间读"文本行"快速档 → 不再必崩，正常推进', () => {
    const { registry, interp } = makeRuntime();
    registry.register(compileScene('凛：甲。\n@wait 60000\n凛：乙。', 's.gal', 'w1'));
    interp.start('w1');                  // 挂起在 凛：甲（文本行）
    const quick = interp.saveSnapshot()!; // 快速档存档点 = 文本行
    interp.advance();                    // 进入 @wait
    expect(interp.status).toBe('awaiting-timer');
    interp.loadSnapshot(quick);          // F9 读快速档（审计复现链）
    expect(interp.status).toBe('awaiting-advance');
    expect(() => interp.advance()).not.toThrow(); // 修复前：finishWait 状态失配 → RuntimeError
    expect(interp.status).toBe('awaiting-timer'); // 再次推进到 @wait 属正常流程
  });
});

describe('M2：hostJump 事件回调重入', () => {
  it('text 回调内 hostJump → 不冻结，直接挂起到新场景文本', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：第一行。', 'a.gal', 's1'));
    registry.register(compileScene('凛：目标行。', 'b.gal', 's2'));
    const texts: string[] = [];
    bus.on('text', (p) => {
      texts.push(p.value);
      if (texts.length === 1) interp.hostJump('s2'); // 回调内跳转（回想重播场景）
    });
    interp.start('s1');
    expect(interp.status).toBe('awaiting-advance'); // 修复前：running 但主循环已退出
    expect(texts).toEqual(['第一行。', '目标行。']);
    expect(() => interp.advance()).not.toThrow(); // 修复前：抛「当前状态为 running」
    expect(interp.status).toBe('ended');
  });

  it('choice 回调内 hostJump → 不冻结', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@choice\n  走 -> @goto a\n@label a\n凛：甲。', 'a.gal', 's1'));
    registry.register(compileScene('凛：目标行。', 'b.gal', 's2'));
    bus.on('choice', () => interp.hostJump('s2'));
    interp.start('s1');
    expect(interp.status).toBe('awaiting-advance');
    expect(() => interp.advance()).not.toThrow();
    expect(interp.status).toBe('ended');
  });
});

describe('Minor：readonly restore / 战斗越权 / 深度校验 / W008', () => {
  it('restore 默认跳过 readonly 变量；可信恢复（读档）允许', () => {
    const store = new VariableStore(decls);
    store.restore({ chapter: 99 }); // 篡改路径：被拒绝（保持初值）
    expect(store.getNumber('chapter')).toBe(1);
    store.restore({ chapter: 3 }, { allowReadonly: true }); // 读档路径：允许
    expect(store.getNumber('chapter')).toBe(3);
  });

  const combatCfg: CombatConfig = {
    teams: ['allies', 'enemies'],
    units: [
      { id: 'a1', name: '甲', hp: 30, atk: 8, def: 2, range: 1, move: 1, kind: 'human', skills: ['slash'] },
      { id: 'e1', name: '乙', hp: 30, atk: 6, def: 2, range: 1, move: 1, kind: 'human' },
    ],
    skills: [
      { id: 'slash', name: '斩', power: 1.2, cooldown: 0, hit: 1 },
      { id: 'fireball', name: '火球', power: 1.5, cooldown: 1, hit: 1, effects: ['long'] },
    ],
    elementChain: {},
    winCondition: 'all_down',
    maxTurns: 50,
    damage: { base: 'atk * power - def', critChance: 0, critMultiplier: 1.5 },
  };

  it('act 校验技能归属：未习得的技能不可用', () => {
    const solver = new CombatSolver(combatCfg, () => 0.5);
    solver.start({ allies: ['a1'], enemies: ['e1'] });
    expect(() => solver.act('allies_0', 'enemies_0', 'fireball')).toThrow(/未习得/);
  });

  it('suggestAction 校验行动阵营：非当前行动方查询抛错', () => {
    const solver = new CombatSolver(combatCfg, () => 0.5);
    solver.start({ allies: ['a1'], enemies: ['e1'] });
    expect(solver.actingTeam).toBe('allies');
    expect(() => solver.suggestAction('enemies')).toThrow(/当前行动阵营/);
  });

  it('combat.restore 拒绝负 HP / 非法阵营快照', () => {
    const solver = new CombatSolver(combatCfg, () => 0.5);
    solver.start({ allies: ['a1'], enemies: ['e1'] });
    const snap = solver.snapshot();
    expect(() => solver.restore({ ...snap, units: snap.units.map((u) => ({ ...u, hp: -5 })) })).toThrow(/HP 非法/);
    expect(() => solver.restore({ ...snap, units: snap.units.map((u) => ({ ...u, team: 'ghost' })) })).toThrow(/非法阵营/);
  });

  it('combat 空闲快照允许无阵营配置的正式游戏恢复', () => {
    const solver = new CombatSolver({ ...combatCfg, teams: [], units: [] });
    const snapshot = JSON.parse(JSON.stringify(solver.snapshot()));
    expect(snapshot.actingTeam).toBe('');
    expect(() => solver.restore(snapshot)).not.toThrow();
  });

  it('assertValidSnapshot 拒绝畸形 callStack / gallery / systems', () => {
    const good = {
      meta: { id: '1', createdAt: 1, updatedAt: 1 },
      variables: {},
      position: null,
      kind: 'manual',
      readSet: [],
      gallery: { cgs: [], music: [] },
    };
    expect(() => assertValidSnapshot({ ...good, callStack: [{ sceneId: 's', pc: 1 }] })).not.toThrow();
    expect(() => assertValidSnapshot({ ...good, callStack: [{ bogus: true }] })).toThrow(/callStack/);
    expect(() => assertValidSnapshot({ ...good, gallery: { cgs: [1], music: [] } })).toThrow(/gallery/);
    expect(() => assertValidSnapshot({ ...good, systems: 'bad' })).toThrow(/systems/);
  });

  it('W008：choice 选项内第二个 @goto 被丢弃时给出诊断', () => {
    const scene = compileScene('@choice\n  走 -> @goto a @goto b\n@label a\n凛：甲。\n@label b\n凛：乙。', 's.gal', 's1');
    expect(scene.diagnostics.some((d) => d.code === 'W008')).toBe(true);
  });
});


describe('审计复核：退化路径覆盖闭合', () => {
  it('position=null 的退化存档同样清 hostPaused 并广播 stateReset', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interp = new Interpreter(store, bus, registry);
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    interp.pauseHost();
    let resets = 0;
    bus.on('stateReset', () => { resets++; });
    interp.loadSnapshot({ ...snap, position: null });
    expect(resets).toBe(1);        // 早退分支前已广播（修复前该路径不覆盖）
    expect(interp.status).toBe('idle');
  });
});
