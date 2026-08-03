import { evalExprString } from '../runtime/expr-eval.js';

/**
 * 回合制战斗系统（数据驱动）。
 * 兵种/技能/伤害公式/相克/阵型全部由 combat.json 配置，引擎只做通用求解。
 */

/** 兵种/单位定义 */
export interface CombatUnitDef {
  id: string;
  name: string;
  hp: number;
  atk: number;
  def: number;
  /** 攻击距离（1 = 近战） */
  range: number;
  /** 移动力（预留：当前求解器无移动阶段，位置仅由开局布阵决定） */
  move: number;
  /** 兵种标识（用于相克表） */
  kind: string;
  /** 技能 ID 列表 */
  skills?: string[];
}

/** 技能定义 */
export interface CombatSkillDef {
  id: string;
  name: string;
  /** 伤害倍率（power 乘到 atk 上） */
  power: number;
  /** 冷却回合 */
  cooldown: number;
  /** 命中率 0-1 */
  hit: number;
  /** 特殊效果（状态异常/治疗等，由宿主扩展） */
  effects?: string[];
}

/** 属性相克表：attacker.kind → victim.kind → 伤害倍率 */
export type ElementChain = Record<string, Record<string, number>>;

/** 伤害公式（表达式求值，变量 atk/def/power） */
export interface DamageFormula {
  /** 如 "atk * 2 - def" */
  base: string;
  /** 暴击率 0-1 */
  critChance: number;
  /** 暴击倍率 */
  critMultiplier: number;
}

/** 一场战斗的完整配置 */
export interface CombatConfig {
  units: CombatUnitDef[];
  skills: CombatSkillDef[];
  elementChain: ElementChain;
  /** 阵营列表，如 ["allies", "enemies"]，行动轮替顺序 */
  teams: string[];
  /** 胜负条件 */
  winCondition: 'all_down' | 'survive_turns' | 'flag';
  maxTurns?: number;
  /** 伤害公式（缺省 "atk - def"） */
  damage?: DamageFormula;
}

/** 战斗实例单位 */
export interface CombatUnitInstance {
  uid: string;
  defId: string;
  name: string;
  team: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  range: number;
  move: number;
  kind: string;
  skills: string[];
  cooldowns: Map<string, number>;
  alive: boolean;
  position: number;
}

/** 序列化快照中的单位（cooldowns 用普通对象，JSON 安全） */
export interface CombatUnitSnapshot {
  uid: string;
  defId: string;
  name: string;
  team: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  range: number;
  move: number;
  kind: string;
  skills: string[];
  alive: boolean;
  position: number;
  cooldowns: Record<string, number>;
}

/** 开局布阵：双方按兵种 defId 实例化 */
export interface CombatStartSetup {
  allies: string[];
  enemies: string[];
}

/** 一次行动的完整结果 */
export interface CombatAction {
  attacker: string;
  target: string;
  skill: string | null;
  rawDamage: number;
  finalDamage: number;
  crit: boolean;
  hit: boolean;
  killed: boolean;
}

/** 当前回合摘要 */
export interface CombatTurn {
  turn: number;
  actingTeam: string;
}

export interface CombatSnapshot {
  units: CombatUnitSnapshot[];
  turn: number;
  actingTeam: string;
  winner: string | null;
  finished: boolean;
}

/**
 * 战斗求解器：回合轮替行动、伤害公式、相克倍率、命中/暴击、技能冷却、胜负判定。
 * 纯逻辑可 headless 测试；rng 可注入固定值。
 */
export class CombatSolver {
  #config: CombatConfig;
  #units: CombatUnitInstance[] = [];
  #turn = 1;
  #teamIndex = 0;
  #winner: string | null = null;
  #finished = false;
  #rng: () => number;
  #lastAction: CombatAction | null = null;

  constructor(config: CombatConfig, rng: () => number = () => Math.random()) {
    this.#config = config;
    this.#rng = rng;
  }

  get units(): CombatUnitInstance[] {
    return this.#units;
  }

  get turn(): number {
    return this.#turn;
  }

  get actingTeam(): string {
    return this.#config.teams[this.#teamIndex] ?? this.#config.teams[0] ?? '';
  }

  get finished(): boolean {
    return this.#finished;
  }

  get winner(): string | null {
    return this.#winner;
  }

  get lastAction(): CombatAction | null {
    return this.#lastAction;
  }

  /** 开局布阵 */
  start(setup: CombatStartSetup): void {
    this.#units = [];
    this.#turn = 1;
    this.#teamIndex = 0;
    this.#winner = null;
    this.#finished = false;

    const spawn = (defIds: string[], team: string, basePos: number): void => {
      defIds.forEach((defId, i) => {
        const def = this.#config.units.find((u) => u.id === defId);
        if (!def) throw new Error(`战斗单位定义 '${defId}' 不存在`);
        this.#units.push({
          uid: `${team}_${i}`,
          defId: def.id,
          name: def.name,
          team,
          hp: def.hp,
          maxHp: def.hp,
          atk: def.atk,
          def: def.def,
          range: def.range,
          move: def.move,
          kind: def.kind,
          skills: def.skills ?? [],
          cooldowns: new Map(),
          alive: true,
          position: basePos + i,
        });
      });
    };

    spawn(setup.allies, this.#config.teams[0] ?? 'allies', 0);
    spawn(setup.enemies, this.#config.teams[1] ?? 'enemies', setup.allies.length);
    this.#checkEnd();
  }

  /** 轮到该单位所属队伍行动 */
  canAct(unitUid: string): boolean {
    if (this.#finished) return false;
    const unit = this.#unit(unitUid);
    return unit.alive && unit.team === this.actingTeam;
  }

  /** 执行攻击：attacker → target，可选技能 */
  act(attackerUid: string, targetUid: string, skillId?: string): CombatAction {
    if (!this.canAct(attackerUid)) {
      throw new Error(`单位 '${attackerUid}' 当前不能行动`);
    }
    const attacker = this.#unit(attackerUid);
    const target = this.#unit(targetUid);
    if (!target.alive) throw new Error(`目标 '${targetUid}' 已倒下`);

    const skill = skillId ? this.#skill(skillId) : null;
    if (skill && this.#unit(attackerUid).cooldowns.get(skillId!)! > 0) {
      throw new Error(`技能 '${skillId}' 冷却中`);
    }

    const range = skill?.effects?.includes('long') ? 99 : attacker.range;
    const dist = Math.abs(attacker.position - target.position);
    if (dist > range) {
      throw new Error(`目标超出射程（${dist} > ${range}）`);
    }

    // 命中判定（rng() <= hitRate，含边界）
    const hitRate = skill?.hit ?? 1;
    const hit = this.#rng() <= hitRate;
    if (!hit) {
      // miss 同样进入冷却（防低命中高伤技能零代价试射）
      if (skill) attacker.cooldowns.set(skill.id, skill.cooldown);
      this.#lastAction = {
        attacker: attackerUid, target: targetUid, skill: skillId ?? null,
        rawDamage: 0, finalDamage: 0, crit: false, hit: false, killed: false,
      };
      this.#advance();
      return this.#lastAction;
    }

    const power = skill?.power ?? 1;
    const formula = this.#config.damage;
    const raw = formula
      ? evalDamage(formula, attacker, target, power)
      : Math.max(1, attacker.atk - target.def);

    const chain = this.#config.elementChain[attacker.kind]?.[target.kind] ?? 1;
    let final = Math.max(1, Math.round(raw * chain));

    const crit = formula ? this.#rng() < formula.critChance : false;
    if (crit) final = Math.round(final * (formula?.critMultiplier ?? 1.5));

    target.hp = Math.max(0, target.hp - final);
    const killed = target.hp === 0;
    if (killed) target.alive = false;

    if (skill) attacker.cooldowns.set(skill.id, skill.cooldown);

    this.#lastAction = {
      attacker: attackerUid, target: targetUid, skill: skillId ?? null,
      rawDamage: raw, finalDamage: final, crit, hit: true, killed,
    };
    this.#advance();
    return this.#lastAction;
  }

  /** 结束当前行动方回合，进入下一方/下一回合（冷却在整回合末递减） */
  #advance(): void {
    this.#teamIndex++;
    if (this.#teamIndex >= this.#config.teams.length) {
      this.#teamIndex = 0;
      this.#turn++;
      for (const u of this.#units) {
        for (const [skillId, cd] of u.cooldowns) {
          if (cd > 0) u.cooldowns.set(skillId, cd - 1);
        }
      }
    }
    this.#checkEnd();
  }

  #checkEnd(): void {
    if (this.#finished) return;

    // all_down：一方全灭立即判胜
    if (this.#config.winCondition === 'all_down') {
      const aliveByTeam = new Map<string, number>();
      for (const u of this.#units) {
        if (u.alive) aliveByTeam.set(u.team, (aliveByTeam.get(u.team) ?? 0) + 1);
      }
      for (const team of this.#config.teams) {
        if (!(aliveByTeam.get(team) ?? 0)) {
          this.#finished = true;
          this.#winner = this.#config.teams.find((t) => (aliveByTeam.get(t) ?? 0) > 0) ?? null;
          return;
        }
      }
    }

    // 超时：survive_turns 判守方（teams[0]）胜，否则平局
    if (this.#config.maxTurns && this.#turn > this.#config.maxTurns) {
      this.#finished = true;
      this.#winner = this.#config.winCondition === 'survive_turns'
        ? this.#config.teams[0] ?? null
        : null;
    }
  }

  /** 宿主手动判定胜利（winCondition='flag' 时，由变量/外部条件置位后调用） */
  declareVictory(team: string): void {
    if (!this.#config.teams.includes(team)) {
      throw new Error(`未知阵营 '${team}'`);
    }
    if (this.#finished) return;
    this.#winner = team;
    this.#finished = true;
  }

  snapshot(): CombatSnapshot {
    return {
      units: this.#units.map((u) => ({
        ...u,
        cooldowns: Object.fromEntries(u.cooldowns),
      })),
      turn: this.#turn,
      actingTeam: this.actingTeam,
      winner: this.#winner,
      finished: this.#finished,
    };
  }

  /** 从快照恢复（战斗中途存档/读档）。快照为 JSON 安全结构，可经 JSON 序列化往返。 */
  restore(snap: CombatSnapshot): void {
    this.#units = snap.units.map((u) => ({
      ...u,
      cooldowns: new Map(Object.entries(u.cooldowns)),
    }));
    this.#turn = Math.max(1, snap.turn);
    const idx = this.#config.teams.indexOf(snap.actingTeam);
    this.#teamIndex = idx >= 0 ? idx : 0;
    this.#winner = snap.winner;
    this.#finished = snap.finished;
    this.#lastAction = null;
  }

  #unit(uid: string): CombatUnitInstance {
    const u = this.#units.find((x) => x.uid === uid);
    if (!u) throw new Error(`战斗单位实例 '${uid}' 不存在`);
    return u;
  }

  #skill(id: string): CombatSkillDef {
    const s = this.#config.skills.find((x) => x.id === id);
    if (!s) throw new Error(`技能 '${id}' 不存在`);
    return s;
  }
}

/** 用伤害公式求基础伤害（变量 atk/def/power；atk 含技能倍率，def 为目标防御）。
 *  与解释器 @if/@set 一致采用严格求值：公式语法错误/引用缺失变量/结果非数字一律抛错，
 *  暴露配置缺陷，不做静默降级（否则作者写坏一条公式只会悄悄变成 0 伤害）。 */
function evalDamage(formula: DamageFormula, attacker: CombatUnitInstance, target: CombatUnitInstance, power: number): number {
  const env = {
    getVariable: (name: string): number | undefined => {
      switch (name) {
        case 'atk': return attacker.atk * power;
        case 'def': return target.def;
        case 'power': return power;
        default: return undefined;
      }
    },
  };
  const value = evalExprString(formula.base, env);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`伤害公式 '${formula.base}' 结果不是有限数字，得到 ${String(value)}`);
  }
  return Math.max(0, value);
}
