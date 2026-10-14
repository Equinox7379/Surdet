import { describe, expect, it } from 'vitest';
import { CombatSolver } from '../src/combat/combat.js';
import type { CombatConfig, CombatSnapshot } from '../src/combat/combat.js';

const config: CombatConfig = {
  teams: ['allies', 'enemies'],
  units: [
    { id: 'sword', name: '剑士', hp: 20, atk: 5, def: 2, range: 1, move: 2, kind: 'human' },
    { id: 'archer', name: '弓手', hp: 14, atk: 4, def: 1, range: 3, move: 2, kind: 'human', skills: ['power_shot'] },
    { id: 'goblin', name: '哥布林', hp: 10, atk: 3, def: 0, range: 1, move: 1, kind: 'beast' },
    { id: 'wolf', name: '狼', hp: 16, atk: 4, def: 1, range: 1, move: 3, kind: 'beast' },
  ],
  skills: [
    { id: 'power_shot', name: '蓄力射击', power: 2, cooldown: 2, hit: 0.95 },
  ],
  elementChain: {
    human: { beast: 1.5 },
  },
  winCondition: 'all_down',
  maxTurns: 10,
  damage: { base: 'atk * 2 - def', critChance: 0, critMultiplier: 1.5 },
};

// rng 固定返回 0.5（命中 0.95 → 命中；无暴击）
const fixedRng = (): number => 0.5;

describe('CombatSolver', () => {
  it.each(['alive', 'winner', 'unfinished'] as const)('rejects contradictory %s snapshot before replacing live battle', (kind) => {
    const solver = new CombatSolver(config, fixedRng);
    solver.start({ allies: ['sword'], enemies: ['goblin'] });
    const before = solver.snapshot();
    const bad = structuredClone(before);
    if (kind === 'alive') bad.units[0]!.hp = 0;
    if (kind === 'winner') bad.winner = 'allies';
    if (kind === 'unfinished') { bad.units[1]!.hp = 0; bad.units[1]!.alive = false; }
    expect(() => solver.restore(bad)).toThrow();
    expect(solver.snapshot()).toEqual(before);
  });
  it('开局实例化并轮替行动', () => {
    const s = new CombatSolver(config, fixedRng);
    s.start({ allies: ['sword', 'archer'], enemies: ['goblin', 'wolf'] });
    expect(s.units).toHaveLength(4);
    expect(s.actingTeam).toBe('allies');
    expect(s.canAct('allies_0')).toBe(true);
    expect(s.canAct('enemies_0')).toBe(false);
  });

  it('伤害公式 + 相克倍率', () => {
    const s = new CombatSolver(config, fixedRng);
    s.start({ allies: ['sword'], enemies: ['goblin'] });
    // 剑士(atk5) 打 哥布林(def0)：base = 5*2-0 = 10，human vs beast 相克 1.5 → 15
    const action = s.act('allies_0', 'enemies_0');
    expect(action.rawDamage).toBe(10);
    expect(action.finalDamage).toBe(15);
    expect(action.killed).toBe(true); // 哥布林 hp 10，被打 15 → 击杀
    expect(s.units.find((u) => u.uid === 'enemies_0')!.hp).toBe(0);
  });

  it('伤害最低为 1', () => {
    const c: CombatConfig = { ...config, damage: { base: 'atk * 2 - def', critChance: 0, critMultiplier: 1.5 } };
    const s = new CombatSolver(c, fixedRng);
    // 用高防单位测试下限
    s.start({ allies: ['sword'], enemies: ['goblin'] });
    s.units.find((u) => u.uid === 'enemies_0')!.def = 99;
    const a = s.act('allies_0', 'enemies_0');
    expect(a.finalDamage).toBe(1);
  });

  it('技能：伤害倍率 + 冷却（整回合末递减）', () => {
    const s = new CombatSolver({ ...config, elementChain: {} }, fixedRng); // 无相克，防击杀
    s.start({ allies: ['archer'], enemies: ['wolf'] });
    const a = s.act('allies_0', 'enemies_0', 'power_shot');
    // power_shot: power 2, archer atk4 → (4*2)*2 - 1 = 15
    expect(a.skill).toBe('power_shot');
    expect(a.rawDamage).toBe(15);
    // 敌方行动 → 整回合结束，冷却 2→1
    s.act('enemies_0', 'allies_0');
    expect(s.units.find((u) => u.uid === 'allies_0')!.cooldowns.get('power_shot')).toBe(1);
    // 我方轮到，冷却中 → 拒绝
    expect(() => s.act('allies_0', 'enemies_0', 'power_shot')).toThrow(/冷却中/);
  });

  it('射程限制', () => {
    const s = new CombatSolver(config, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf', 'archer'] });
    // 剑士 range 1，敌人 archer 位置 2 → 距离 2 → 超程
    expect(() => s.act('allies_0', 'enemies_1')).toThrow(/射程/);
    // 距离 1 的 wolf 可打
    expect(s.canAct('allies_0')).toBe(true);
  });

  it('回合轮替与最大回合', () => {
    const s = new CombatSolver(config, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf'] }); // 高血量防一击击杀
    s.act('allies_0', 'enemies_0'); // sword 15 → wolf hp1
    expect(s.actingTeam).toBe('enemies');
    s.act('enemies_0', 'allies_0'); // wolf 7 → sword hp13
    expect(s.turn).toBe(2);
    expect(s.finished).toBe(false);
  });

  it('全灭判定胜负', () => {
    const s = new CombatSolver(config, fixedRng);
    s.start({ allies: ['sword'], enemies: ['goblin'] });
    // 剑士一刀 15 → 哥布林 10 血死亡
    const a = s.act('allies_0', 'enemies_0');
    expect(a.killed).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.winner).toBe('allies');
  });

  it('未命中不造成伤害且推进回合', () => {
    const s = new CombatSolver(config, () => 0.99); // power_shot 命中 0.95 → miss
    s.start({ allies: ['archer'], enemies: ['wolf'] });
    const a = s.act('allies_0', 'enemies_0', 'power_shot');
    expect(a.hit).toBe(false);
    expect(a.finalDamage).toBe(0);
    expect(s.actingTeam).toBe('enemies');
  });

  it('snapshot 捕获全部状态', () => {
    const s = new CombatSolver(config, fixedRng);
    s.start({ allies: ['sword'], enemies: ['goblin'] });
    s.act('allies_0', 'enemies_0');
    const snap = s.snapshot();
    expect(snap.turn).toBe(1);
    expect(snap.finished).toBe(true);
    expect(snap.winner).toBe('allies');
    expect(snap.units[0]!.team).toBe('allies');
  });

  it('M5-A snapshot/restore 往返（战斗中途读档）', () => {
    const s = new CombatSolver({ ...config, elementChain: {} }, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf'] });
    s.act('allies_0', 'enemies_0'); // 9 伤 → wolf hp7，轮到 enemies
    const snap = s.snapshot();

    const s2 = new CombatSolver(config, fixedRng);
    s2.restore(snap);
    expect(s2.turn).toBe(1);
    expect(s2.actingTeam).toBe('enemies');
    expect(s2.units.find((u) => u.uid === 'allies_0')!.hp).toBe(20);
    expect(s2.units.find((u) => u.uid === 'enemies_0')!.hp).toBe(7);
    expect(s2.canAct('enemies_0')).toBe(true);
  });

  it('M5-B survive_turns：超时判守方胜', () => {
    const c: CombatConfig = { ...config, winCondition: 'survive_turns', maxTurns: 1, elementChain: {} };
    const s = new CombatSolver(c, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf'] });
    s.act('allies_0', 'enemies_0'); // turn1 内，轮到 enemies
    s.act('enemies_0', 'allies_0'); // turn2 > maxTurns1 → 守方（allies）胜
    expect(s.finished).toBe(true);
    expect(s.winner).toBe('allies');
  });

  it.each([1, 2])('A003 survive_turns 守方在第 %s 回合全灭立即败，快照可恢复', (defeatTurn) => {
    const c: CombatConfig = {
      ...config, winCondition: 'survive_turns', maxTurns: 2, elementChain: {}, damage: undefined,
      units: config.units.map(unit => unit.id === 'sword' ? { ...unit, hp: 1, def: 0 } : unit),
    };
    const solver = new CombatSolver(c, fixedRng);
    solver.start({ allies: ['sword'], enemies: ['wolf'] });
    if (defeatTurn === 2) { solver.pass(); solver.pass(); }
    solver.pass();
    const action = solver.act('enemies_0', 'allies_0');
    expect(action.killed).toBe(true);
    expect(solver.finished).toBe(true);
    expect(solver.winner).toBe('enemies');
    expect(() => solver.pass()).toThrow(/已结束/);
    const snapshot = JSON.parse(JSON.stringify(solver.snapshot())) as CombatSnapshot;
    const restored = new CombatSolver(c, fixedRng);
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
  });

  it('A003 survive_turns 守方仅损失部分单位仍可存活到期胜利', () => {
    const c: CombatConfig = {
      ...config, winCondition: 'survive_turns', maxTurns: 1, elementChain: {}, damage: undefined,
      units: config.units.map(unit => unit.id === 'sword' ? { ...unit, hp: 1, def: 0 } : { ...unit, range: 99 }),
    };
    const solver = new CombatSolver(c, fixedRng);
    solver.start({ allies: ['sword', 'archer'], enemies: ['wolf'] });
    solver.pass();
    solver.act('enemies_0', 'allies_0');
    expect(solver.units.filter(unit => unit.team === 'allies' && unit.alive)).toHaveLength(1);
    expect(solver.finished).toBe(true);
    expect(solver.winner).toBe('allies');
    const restored = new CombatSolver(c, fixedRng);
    restored.restore(solver.snapshot());
    expect(restored.snapshot()).toEqual(solver.snapshot());
  });

  it('A003 survive_turns 敌方全灭仍按原规则等待到期，空闲快照可恢复', () => {
    const c: CombatConfig = { ...config, winCondition: 'survive_turns', maxTurns: 1 };
    const solver = new CombatSolver(c, fixedRng);
    const restored = new CombatSolver(c, fixedRng);
    restored.restore(solver.snapshot());
    solver.start({ allies: ['sword'], enemies: ['goblin'] });
    solver.act('allies_0', 'enemies_0');
    expect(solver.finished).toBe(false);
    expect(solver.winner).toBeNull();
    restored.restore(solver.snapshot());
    solver.pass();
    expect(solver.finished).toBe(true);
    expect(solver.winner).toBe('allies');
    restored.restore(solver.snapshot());
    expect(restored.snapshot()).toEqual(solver.snapshot());
  });

  it.each(['unfinished', 'defender-wins', 'draw'] as const)('A003 survive_turns 拒绝守方全灭的矛盾 %s 快照，不改当前战斗', (kind) => {
    const c: CombatConfig = { ...config, winCondition: 'survive_turns', maxTurns: 2 };
    const solver = new CombatSolver(c, fixedRng);
    solver.start({ allies: ['sword'], enemies: ['wolf'] });
    const before = solver.snapshot();
    const bad = structuredClone(before);
    bad.units[0]!.hp = 0;
    bad.units[0]!.alive = false;
    bad.finished = kind !== 'unfinished';
    bad.winner = kind === 'defender-wins' ? 'allies' : null;
    if (kind === 'defender-wins') bad.turn = 3;
    expect(() => solver.restore(bad)).toThrow(/结束状态/);
    expect(solver.snapshot()).toEqual(before);
  });

  it.each([undefined, 'power_shot', 'normal_shot'])('A004 缺省与显式默认公式均消费技能倍率 (%s)', (skillId) => {
    const c: CombatConfig = {
      ...config, elementChain: {}, damage: undefined,
      units: config.units.map(unit => ({ ...unit, hp: 100, skills: [...(unit.skills ?? []), 'normal_shot'] })),
      skills: [...config.skills, { id: 'normal_shot', name: '普通射击', power: 1, hit: 1, cooldown: 0 }],
    };
    const implicit = new CombatSolver(c, fixedRng);
    const explicit = new CombatSolver({ ...c, damage: { base: 'atk - def', critChance: 0, critMultiplier: 1.5 } }, fixedRng);
    for (const solver of [implicit, explicit]) solver.start({ allies: ['archer'], enemies: ['wolf'] });
    const implicitAction = implicit.act('allies_0', 'enemies_0', skillId);
    const explicitAction = explicit.act('allies_0', 'enemies_0', skillId);
    expect(implicitAction).toEqual(explicitAction);
    expect(implicitAction.rawDamage).toBe(skillId === 'power_shot' ? 7 : 3);
    expect(implicitAction.finalDamage).toBe(skillId === 'power_shot' ? 7 : 3);
    expect(implicitAction.crit).toBe(false);
  });

  it('A004 缺省公式保留最低伤害和无暴击，显式公式保留暴击倍率', () => {
    const c: CombatConfig = { ...config, elementChain: {}, damage: undefined };
    for (const damage of [undefined, { base: 'atk - def', critChance: 0, critMultiplier: 1.5 }]) {
      const solver = new CombatSolver({ ...c, damage }, () => 0);
      solver.start({ allies: ['archer'], enemies: ['wolf'] });
      solver.units.find(unit => unit.uid === 'enemies_0')!.def = 99;
      const action = solver.act('allies_0', 'enemies_0', 'power_shot');
      expect(action.finalDamage).toBe(1);
      expect(action.crit).toBe(false);
    }
    const critical = new CombatSolver({ ...c, damage: { base: 'atk - def', critChance: 1, critMultiplier: 2 } }, () => 0);
    critical.start({ allies: ['archer'], enemies: ['wolf'] });
    const action = critical.act('allies_0', 'enemies_0', 'power_shot');
    expect(action.rawDamage).toBe(7);
    expect(action.finalDamage).toBe(14);
    expect(action.crit).toBe(true);
  });

  it('M5-B flag：宿主 declareVictory 手动判胜', () => {
    const c: CombatConfig = { ...config, winCondition: 'flag', elementChain: {} };
    const s = new CombatSolver(c, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf'] });
    expect(s.finished).toBe(false);
    s.declareVictory('enemies');
    expect(s.finished).toBe(true);
    expect(s.winner).toBe('enemies');
    expect(() => s.declareVictory('ghost')).toThrow(/未知阵营/);
  });

  it('M5-E miss 同样进入冷却', () => {
    const s = new CombatSolver({ ...config, elementChain: {} }, () => 1.0); // hitRate 0.95 → miss
    s.start({ allies: ['archer'], enemies: ['wolf'] });
    s.act('allies_0', 'enemies_0', 'power_shot');
    expect(s.units.find((u) => u.uid === 'allies_0')!.cooldowns.get('power_shot')).toBe(2);
  });

  it('M7 snapshot 经 JSON 序列化往返保留冷却（cooldowns 已 JSON 安全化）', () => {
    const s = new CombatSolver({ ...config, elementChain: {} }, fixedRng);
    s.start({ allies: ['archer'], enemies: ['wolf'] });
    s.act('allies_0', 'enemies_0', 'power_shot'); // 冷却 2
    const snap = JSON.parse(JSON.stringify(s.snapshot())) as CombatSnapshot;

    const s2 = new CombatSolver(config, fixedRng);
    s2.restore(snap);
    expect(s2.units.find((u) => u.uid === 'allies_0')!.cooldowns.get('power_shot')).toBe(2);
    expect(s2.actingTeam).toBe('enemies');
  });

  it('M8 僵局检测与 pass()：互不在射程时僵局成立，pass 推进回合使 maxTurns 生效', () => {
    const c: CombatConfig = { ...config, elementChain: {}, winCondition: 'survive_turns', maxTurns: 2 };
    const s = new CombatSolver(c, fixedRng);
    s.start({ allies: ['sword'], enemies: ['goblin', 'wolf'] });
    // 开局布阵双方紧贴（敌方 basePos = 我方人数）：近战可打，无僵局
    expect(s.canAttackAny('allies_0')).toBe(true);
    expect(s.actingTeamStalemate).toBe(false);

    // 把敌方拉远 → 双方互不在射程（无移动阶段的求解器）→ 僵局
    s.units.find((u) => u.uid === 'enemies_0')!.position = 10;
    s.units.find((u) => u.uid === 'enemies_1')!.position = 11;
    expect(s.canAttackAny('allies_0')).toBe(false);
    expect(s.canAttackAny('enemies_0')).toBe(false);
    expect(s.actingTeamStalemate).toBe(true);

    s.pass(); // allies pass → enemies 行动方（同样僵局）
    expect(s.actingTeam).toBe('enemies');
    expect(s.actingTeamStalemate).toBe(true);
    s.pass(); // enemies pass → 整回合结束，turn 2（尚未超时）
    expect(s.turn).toBe(2);
    expect(s.finished).toBe(false);

    s.pass(); // turn 2 双方再 pass → turn 3 > maxTurns 2 → 守方（teams[0]）胜
    s.pass();
    expect(s.finished).toBe(true);
    expect(s.winner).toBe('allies');
    // 战斗结束后 actingTeamStalemate 恒 false，pass() 抛错
    expect(s.actingTeamStalemate).toBe(false);
    expect(() => s.pass()).toThrow(/已结束/);
  });

  it('M8 canAttackAny：普攻射程内为 true；超程时仅冷却就绪的 long 技能可行动', () => {
    const c: CombatConfig = {
      ...config,
      elementChain: {},
      skills: [...config.skills, { id: 'snipe', name: '狙击', power: 1, cooldown: 3, hit: 1, effects: ['long'] }],
      units: [...config.units, { id: 'sniper', name: '狙击手', hp: 10, atk: 4, def: 0, range: 1, move: 0, kind: 'human', skills: ['snipe'] }],
    };
    const s = new CombatSolver(c, fixedRng);
    s.start({ allies: ['sniper'], enemies: ['goblin', 'wolf'] });
    // 开局贴身：range 1 够到相邻敌人
    expect(s.canAttackAny('allies_0')).toBe(true);

    // 全部敌人拉出射程（位置 5/6/7 vs sniper 位置 0）
    const s2 = new CombatSolver(c, fixedRng);
    s2.start({ allies: ['sniper'], enemies: ['goblin', 'wolf', 'goblin'] });
    s2.units.find((u) => u.uid === 'enemies_0')!.position = 5;
    s2.units.find((u) => u.uid === 'enemies_1')!.position = 6;
    s2.units.find((u) => u.uid === 'enemies_2')!.position = 7;
    // 普攻超程但 snipe（long）冷却就绪 → 仍可行动，不判僵局
    expect(s2.canAttackAny('allies_0')).toBe(true);
    expect(s2.actingTeamStalemate).toBe(false);

    // snipe 使用后进入冷却 3 → 无 long 技能可用 → 僵局
    s2.act('allies_0', 'enemies_0', 'snipe'); // → enemies 行动
    s2.pass(); // enemies pass → 整回合末冷却 3→2，回到 allies
    expect(s2.actingTeam).toBe('allies');
    expect(s2.canAttackAny('allies_0')).toBe(false);
    expect(s2.actingTeamStalemate).toBe(true);

    // 再熬两个整回合：冷却 2→1（仍僵局）→ 1→0（long 恢复，僵局解除）
    s2.pass(); s2.pass();
    expect(s2.turn).toBe(3);
    expect(s2.canAttackAny('allies_0')).toBe(false);
    s2.pass(); s2.pass();
    expect(s2.turn).toBe(4);
    expect(s2.canAttackAny('allies_0')).toBe(true);
    expect(s2.actingTeamStalemate).toBe(false);
  });

  it('R1 默认禁止攻击同阵营目标（friendlyFire 未开启）', () => {
    const s = new CombatSolver({ ...config, elementChain: {} }, fixedRng);
    s.start({ allies: ['sword', 'archer'], enemies: ['goblin'] });
    expect(() => s.act('allies_0', 'allies_1')).toThrow(/同阵营/);
    // 开启 friendlyFire 后允许友伤
    const sf = new CombatSolver({ ...config, elementChain: {}, friendlyFire: true }, fixedRng);
    sf.start({ allies: ['sword', 'archer'], enemies: ['goblin'] });
    expect(() => sf.act('allies_0', 'allies_1')).not.toThrow();
  });

  it('R1 命中边界：hit=0 恒 miss（即使 rng 返回 0）', () => {
    const c: CombatConfig = {
      ...config,
      elementChain: {},
      skills: [{ id: 'never', name: '必失手', power: 1, cooldown: 0, hit: 0 }],
    };
    const s = new CombatSolver(c, () => 0); // rng 恰好 0：旧 <= 判定会命中
    s.start({ allies: ['archer'], enemies: ['wolf'] });
    s.units.find((u) => u.uid === 'allies_0')!.skills = ['never'];
    const a = s.act('allies_0', 'enemies_0', 'never');
    expect(a.hit).toBe(false);
  });

  it('R4 moveUnit：移动消耗行动；同回合不可重复；整回合后重置', () => {
    const c: CombatConfig = { ...config, elementChain: {}, winCondition: 'survive_turns', maxTurns: 99 };
    const s = new CombatSolver(c, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf'] });
    s.units.find((u) => u.uid === 'enemies_0')!.position = 30; // 拉远避免战斗结束
    expect(s.canMove('allies_0')).toBe(true);
    s.moveUnit('allies_0', 1); // 消耗行动 → 轮到敌方
    expect(s.actingTeam).toBe('enemies');
    expect(() => s.moveUnit('allies_0', 1)).toThrow(/不能移动/); // 非行动方
    s.moveUnit('enemies_0', 1); // 敌方移动 → 整回合结束
    expect(s.actingTeam).toBe('allies');
    expect(s.canMove('allies_0')).toBe(true); // 新回合移动已重置
  });

  it('R4 suggestAction：射程内攻击、射程外接近、无法行动 pass', () => {
    const c: CombatConfig = { ...config, elementChain: {} };
    // 贴身：建议攻击
    const s1 = new CombatSolver(c, fixedRng);
    s1.start({ allies: ['sword'], enemies: ['goblin'] });
    const sug1 = s1.suggestAction('allies');
    expect(sug1.kind).toBe('attack');
    // 拉远（剑士射程 1）：建议移动接近
    const s2 = new CombatSolver(c, fixedRng);
    s2.start({ allies: ['sword'], enemies: ['goblin'] });
    s2.units.find((u) => u.uid === 'enemies_0')!.position = 5;
    const sug2 = s2.suggestAction('allies');
    expect(sug2).toMatchObject({ kind: 'move', uid: 'allies_0', dir: 1 });
    // 无移动力单位够不着：pass
    const c3: CombatConfig = {
      ...c,
      units: config.units.map((u) => (u.id === 'sword' ? { ...u, move: 0 } : u)),
    };
    const s3 = new CombatSolver(c3, fixedRng);
    s3.start({ allies: ['sword'], enemies: ['goblin'] });
    s3.units.find((u) => u.uid === 'enemies_0')!.position = 5;
    expect(s3.suggestAction('allies').kind).toBe('pass');
  });

  it('R4 moved 随快照往返（战斗中途读档保持移动消耗状态）', () => {
    const c: CombatConfig = { ...config, elementChain: {}, winCondition: 'survive_turns', maxTurns: 99 };
    const s = new CombatSolver(c, fixedRng);
    s.start({ allies: ['sword'], enemies: ['wolf'] });
    s.units.find((u) => u.uid === 'enemies_0')!.position = 30;
    // 快照：moved 为 JSON 安全数组
    const snap = JSON.parse(JSON.stringify(s.snapshot())) as CombatSnapshot;
    expect(snap.moved).toEqual([]);
    const s2 = new CombatSolver(c, fixedRng);
    s2.restore(snap);
    expect(s2.canMove('allies_0')).toBe(true);
  });

  it('M7 伤害公式错误不再静默按 0 处理，而是抛错', () => {
    // 公式引用缺失变量：表达式求值器抛 ExprEvalError
    const c1: CombatConfig = { ...config, elementChain: {}, damage: { base: 'atk * missing_var', critChance: 0, critMultiplier: 1.5 } };
    const s1 = new CombatSolver(c1, fixedRng);
    s1.start({ allies: ['sword'], enemies: ['goblin'] });
    expect(() => s1.act('allies_0', 'enemies_0')).toThrow();

    // 公式结果为非数字：evalDamage 抛「不是有限数字」
    const c2: CombatConfig = { ...config, elementChain: {}, damage: { base: 'atk * power + "x"', critChance: 0, critMultiplier: 1.5 } };
    const s2 = new CombatSolver(c2, fixedRng);
    s2.start({ allies: ['sword'], enemies: ['goblin'] });
    expect(() => s2.act('allies_0', 'enemies_0')).toThrow(/不是有限数字/);
  });
});
