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
  /**
   * 冷却回合。递减时机：行动立即进入冷却，随后双方各行动一次（整回合结束）递减 1。
   * 故配置 N 的实际效果 = 当回合不可再用，之后 N-1 个整回合后恢复（见 #advance）。
   */
  cooldown: number;
  /** 命中率 0-1 */
  hit: number;
  /**
   * 特殊效果标记（扩展点，宿主可自定义消费）。引擎内置：
   *  - `'long'`：射程视为 99（无视距离攻击），见 act() 的射程判定。
   */
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
  /** 允许攻击同阵营目标（友伤）。缺省 false：act() 拒绝同阵营目标，
   *  防止宿主/AI 选目标逻辑失误时静默打到己方单位。 */
  friendlyFire?: boolean;
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

/** AI/宿主行动建议：攻击 / 移动（1D 阵列接近）/ 跳过 */
export type CombatSuggestion =
  | { kind: 'attack'; attackerUid: string; targetUid: string; skillId: string | null }
  | { kind: 'move'; uid: string; dir: -1 | 1 }
  | { kind: 'pass' };

export interface CombatSnapshot {
  units: CombatUnitSnapshot[];
  turn: number;
  actingTeam: string;
  winner: string | null;
  finished: boolean;
  /** 本回合已移动单位（移动消耗行动；旧档无此字段按空） */
  moved?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  /** 本回合已消耗移动行动的单位（整回合结束时清空） */
  #moved = new Set<string>();

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
    this.#moved = new Set<string>();

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
    // 默认禁止攻击同阵营（防宿主/AI 误选目标静默打己方）；需友伤玩法时显式配置 friendlyFire
    if (target.team === attacker.team && !this.#config.friendlyFire) {
      throw new Error(`'${attackerUid}' 不能攻击同阵营目标 '${targetUid}'（如需友伤请配置 friendlyFire）`);
    }

    const skill = skillId ? this.#skill(skillId) : null;
    // 技能归属校验（审计修复）：配置内技能不可被任意单位越权使用
    if (skillId && skill && !attacker.skills.includes(skillId)) {
      throw new Error(`单位 '${attackerUid}' 未习得技能 '${skillId}'`);
    }
    if (skillId && skill && (attacker.cooldowns.get(skillId) ?? 0) > 0) {
      throw new Error(`技能 '${skillId}' 冷却中`);
    }

    const range = skill?.effects?.includes('long') ? 99 : attacker.range;
    const dist = Math.abs(attacker.position - target.position);
    if (dist > range) {
      throw new Error(`目标超出射程（${dist} > ${range}）`);
    }

    // 命中判定统一开区间 rng() < hitRate：hit=0 恒 miss（rng() 可返回恰好 0，
    // 旧 <= 判定下会偶发命中）、hit=1 恒命中（rng() < 1 恒真），与暴击判定一致
    const hitRate = skill?.hit ?? 1;
    const hit = this.#rng() < hitRate;
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

    // 无 damage 公式（damage 缺省时）不做暴击判定（crit 恒 false）；公式存在时才按 critChance 掷骰
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

  /** 该单位是否存在可攻击的敌方目标（普攻射程内，或冷却就绪的 'long' 技能）。宿主 AI 僵局检测用。 */
  canAttackAny(unitUid: string): boolean {
    const unit = this.#unit(unitUid);
    if (!unit.alive) return false;
    for (const t of this.#units) {
      if (!t.alive || t.team === unit.team) continue;
      if (Math.abs(unit.position - t.position) <= unit.range) return true;
      // 超出普攻射程时，仅 'long' 技能（无视距离）且冷却就绪才可行动
      for (const sid of unit.skills) {
        const s = this.#config.skills.find((x) => x.id === sid);
        if (s?.effects?.includes('long') && (unit.cooldowns.get(sid) ?? 0) <= 0) return true;
      }
    }
    return false;
  }

  /** 当前行动方是否无任何可用攻击（双方无人够得着对方时陷入僵局，宿主应调用 pass()） */
  get actingTeamStalemate(): boolean {
    if (this.#finished) return false;
    return !this.#units.some((u) => u.team === this.actingTeam && u.alive && this.canAttackAny(u.uid));
  }

  /** 该单位当前能否移动（行动方 + 存活 + 本回合未移动过 + move>0） */
  canMove(uid: string): boolean {
    if (this.#finished) return false;
    const u = this.#units.find((x) => x.uid === uid);
    return !!u && u.alive && u.team === this.actingTeam && !this.#moved.has(uid) && u.move > 0;
  }

  /** 移动（1D 阵列定位）：按 move 值位移（不小于 0），消耗本次行动并移交行动权 */
  moveUnit(uid: string, dir: -1 | 1): void {
    if (!this.canMove(uid)) {
      throw new Error(`单位 '${uid}' 当前不能移动（非行动方/已移动过/无移动力）`);
    }
    const u = this.#unit(uid);
    u.position = Math.max(0, u.position + dir * u.move);
    this.#moved.add(uid);
    this.#advance();
  }

  /** AI 行动建议：优先攻击（最低血量目标，就绪技能优先于普攻），
   *  打不到则向最近敌人移动（需 canMove），否则 pass。敌方自动战斗/新手引导共用。 */
  suggestAction(team: string): CombatSuggestion {
    if (this.#finished) return { kind: 'pass' };
    // 行动方校验（审计修复）：宿主只能为当前行动阵营请求 AI 行动
    if (team !== this.actingTeam) {
      throw new Error(`suggestAction 只能查询当前行动阵营 '${this.actingTeam}'（收到 '${team}'）`);
    }
    for (const u of this.#units) {
      if (!u.alive || u.team !== team) continue;
      const enemies = this.#units.filter((t) => t.alive && t.team !== team);
      if (enemies.length === 0) return { kind: 'pass' };
      const inRange = enemies.filter((t) => Math.abs(u.position - t.position) <= u.range);
      const readySkills = u.skills.filter((sid) => {
        const s = this.#config.skills.find((x) => x.id === sid);
        return !!s && (u.cooldowns.get(sid) ?? 0) <= 0;
      });
      const longReady = readySkills.filter((sid) => {
        const s = this.#config.skills.find((x) => x.id === sid);
        return !!s && !!s.effects?.includes('long');
      });
      const pool = inRange.length > 0 ? inRange : longReady.length > 0 ? enemies : [];
      if (pool.length > 0) {
        const target = [...pool].sort((a, b) => a.hp - b.hp)[0]!;
        let skillId: string | null = null;
        if (inRange.includes(target)) skillId = readySkills[0] ?? null;
        else skillId = longReady[0] ?? null;
        return { kind: 'attack', attackerUid: u.uid, targetUid: target.uid, skillId };
      }
      // 够不着：向最近敌人接近（移动消耗行动）
      if (this.canMove(u.uid)) {
        const nearest = [...enemies].sort(
          (a, b) => Math.abs(a.position - u.position) - Math.abs(b.position - u.position),
        )[0]!;
        return { kind: 'move', uid: u.uid, dir: nearest.position >= u.position ? 1 : -1 };
      }
    }
    return { kind: 'pass' };
  }

  /**
   * 跳过行动（pass）：行动方无可攻击目标时（如近战单位互不在射程且无移动阶段），
   * 宿主调用本方法结束该方行动。回合照常推进——保证 maxTurns 超时判定在僵局下依然生效，
   * 否则双方互相打不到时回合永不递增，战斗将无限死锁。
   */
  pass(): void {
    if (this.#finished) {
      throw new Error('战斗已结束，无法跳过行动');
    }
    this.#lastAction = null;
    this.#advance();
  }

  /** 结束当前行动方回合，进入下一方/下一回合（冷却在整回合末递减） */
  #advance(): void {
    this.#teamIndex++;
    if (this.#teamIndex >= this.#config.teams.length) {
      this.#teamIndex = 0;
      this.#turn++;
      this.#moved.clear(); // 整回合结束：移动行动重置
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
      moved: [...this.#moved],
    };
  }

  validateSnapshot(snap: unknown): asserts snap is CombatSnapshot {
    if (!isRecord(snap)) throw new Error('战斗快照必须是对象');
    const teamSet = new Set(this.#config.teams);
    if (!Array.isArray(snap.units)) throw new Error('战斗快照 units 必须是数组');
    if (typeof snap.turn !== 'number' || !Number.isInteger(snap.turn) || snap.turn < 1) {
      throw new Error('战斗快照 turn 必须是 >= 1 的整数');
    }
    const idleWithoutTeams = snap.units.length === 0 && snap.actingTeam === '' && snap.winner === null && snap.finished === false;
    if (typeof snap.actingTeam !== 'string' || (!teamSet.has(snap.actingTeam) && !idleWithoutTeams)) {
      throw new Error(`战斗快照含非法行动阵营 '${String(snap.actingTeam)}'`);
    }
    if (snap.winner !== null && (typeof snap.winner !== 'string' || !teamSet.has(snap.winner))) {
      throw new Error(`战斗快照含非法胜者 '${String(snap.winner)}'`);
    }
    if (typeof snap.finished !== 'boolean') throw new Error('战斗快照 finished 必须是布尔值');
    const seen = new Set<string>();
    for (const raw of snap.units) {
      if (!isRecord(raw)) throw new Error('战斗快照 units 含非法单位');
      const uid = raw.uid;
      const defId = raw.defId;
      if (typeof uid !== 'string' || uid.length === 0 || seen.has(uid)) {
        throw new Error(`战斗快照单位 uid 非法或重复：${String(uid)}`);
      }
      seen.add(uid);
      if (typeof defId !== 'string' || !this.#config.units.some((def) => def.id === defId)) {
        throw new Error(`战斗快照含未知单位定义 '${String(defId)}'`);
      }
      if (typeof raw.team !== 'string' || !teamSet.has(raw.team)) {
        throw new Error(`战斗快照含非法阵营 '${String(raw.team)}'`);
      }
      if (typeof raw.name !== 'string') throw new Error(`战斗快照单位 '${uid}' name 非法`);
      if (typeof raw.kind !== 'string' || !Array.isArray(raw.skills) || raw.skills.some((id) => typeof id !== 'string')) {
        throw new Error(`战斗快照单位 '${uid}' skills/kind 非法`);
      }
      const numberField = (field: string): number => {
        const value = raw[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`战斗快照单位 '${uid}' ${field} 必须是有限数`);
        }
        return value;
      };
      const hp = numberField('hp');
      const maxHp = numberField('maxHp');
      const range = numberField('range');
      const move = numberField('move');
      numberField('atk');
      numberField('def');
      numberField('position');
      if (maxHp <= 0 || hp < 0 || hp > maxHp || range < 0 || move < 0) {
        throw new Error(`战斗快照单位 '${uid}' HP 非法或属性范围非法`);
      }
      if (typeof raw.alive !== 'boolean' || !isRecord(raw.cooldowns)) {
        throw new Error(`战斗快照单位 '${uid}' alive/cooldowns 非法`);
      }
      for (const [skillId, cooldown] of Object.entries(raw.cooldowns)) {
        if (!skillId || typeof cooldown !== 'number' || !Number.isInteger(cooldown) || cooldown < 0) {
          throw new Error(`战斗快照单位 '${uid}' cooldowns 非法`);
        }
      }
    }
    if (snap.moved !== undefined) {
      if (!Array.isArray(snap.moved) || snap.moved.some((uid) => typeof uid !== 'string' || !seen.has(uid))) {
        throw new Error('战斗快照 moved 必须引用现有单位');
      }
    }
  }

  /** 从快照恢复（战斗中途存档/读档）。快照为 JSON 安全结构，可经 JSON 序列化往返。 */
  restore(snap: CombatSnapshot): void {
    this.validateSnapshot(snap);
    this.#units = snap.units.map((u) => {
      return { ...u, cooldowns: new Map(Object.entries(u.cooldowns)) };
    });
    this.#turn = Math.max(1, snap.turn);
    const idx = this.#config.teams.indexOf(snap.actingTeam);
    this.#teamIndex = idx >= 0 ? idx : 0;
    this.#winner = snap.winner;
    this.#finished = snap.finished;
    this.#moved = new Set(snap.moved ?? []);
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
 *  ⚠️ 双重倍率陷阱：`atk` 已返回 `attacker.atk * power`（技能倍率已计入），同时单独暴露
 *  `power` 供"按功率占比"等幂等场景引用。公式里请勿再写 `power * N`（会得到 atk*power*N 的双重倍率）。
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
