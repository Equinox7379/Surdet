import type { ExprEnv } from '../runtime/expr-eval.js';
import { evalExprBoolean } from '../runtime/expr-eval.js';

/**
 * 后宫/关系树系统。
 * 角色好感阶段（按变量阈值）、关系事件解锁（when 表达式），由 events.json 配置。
 */

/** 关系阶段（由好感度阈值驱动） */
export interface AffectionTier {
  /** 达到该档所需好感度 */
  min: number;
  stage: string;
  /** 进入该阶段解锁的事件 ID */
  unlockEventId?: string;
}

/** 单个角色的好感度配置 */
export interface AffectionProfile {
  characterId: string;
  /** 好感度变量名（指向状态系统的 number 变量） */
  variable: string;
  tiers: AffectionTier[];
}

/** 关系事件（事件树节点） */
export interface RelationshipEvent {
  id: string;
  characterId: string;
  /** 触发条件（DSL 布尔表达式） */
  when: string;
  /** 进入的事件场景 */
  scene: string;
  /** 触发后设置/递增变量 */
  effects?: Record<string, number | boolean>;
  /** 解锁子事件 */
  children?: string[];
  /** 一次性事件 */
  once: boolean;
}

/** 解锁状态快照（随存档保存） */
export interface AffectionSnapshot {
  /** once 事件消费（防重入） */
  consumed: string[];
  /** 曾触发过的事件（事件树门控用，含 once:false 父节点） */
  everConsumed: string[];
}

/**
 * 好感系统：阶段判定 + 事件解锁。
 */
export class AffectionSystem {
  #profiles: AffectionProfile[];
  #events: RelationshipEvent[];
  #env: ExprEnv;
  /** once 事件消费（防重入） */
  #consumed = new Set<string>();
  /** 曾触发过的事件（事件树门控：父节点 once:false 也计入） */
  #everConsumed = new Set<string>();
  /** 事件树：childId → parentId（子事件需父事件已触发过才可用） */
  #parentOf = new Map<string, string>();

  constructor(profiles: AffectionProfile[], events: RelationshipEvent[] = [], env: ExprEnv) {
    // 阶段档位按 min 升序整理，保证 stageOf/tierIndex 的"取最高满足档"遍历在
    // 配置乱序时依然正确（作者无需自行保证 tiers 有序）。
    this.#profiles = profiles.map((p) => ({
      ...p,
      tiers: [...p.tiers].sort((a, b) => a.min - b.min),
    }));
    this.#events = events;
    this.#env = env;
    for (const ev of events) {
      for (const child of ev.children ?? []) {
        this.#parentOf.set(child, ev.id);
      }
    }
  }

  /** 当前好感阶段（最高满足阈值的档），无配置返回 null */
  stageOf(characterId: string): AffectionTier | null {
    const profile = this.#profiles.find((p) => p.characterId === characterId);
    if (!profile || profile.tiers.length === 0) return null;
    const value = this.#env.getVariable(profile.variable);
    if (typeof value !== 'number') return null;
    let current: AffectionTier | null = null;
    for (const tier of profile.tiers) {
      if (value >= tier.min) current = tier;
    }
    return current;
  }

  /** 阶段索引（-1 = 无配置/未达任何档） */
  tierIndex(characterId: string): number {
    const profile = this.#profiles.find((p) => p.characterId === characterId);
    if (!profile) return -1;
    const value = this.#env.getVariable(profile.variable);
    if (typeof value !== 'number') return -1;
    let idx = -1;
    profile.tiers.forEach((tier, i) => {
      if (value >= tier.min) idx = i;
    });
    return idx;
  }

  /** 全部角色当前阶段（供界面展示） */
  stages(): { characterId: string; variable: string; tier: string | null }[] {
    return this.#profiles.map((p) => ({
      characterId: p.characterId,
      variable: p.variable,
      tier: this.stageOf(p.characterId)?.stage ?? null,
    }));
  }

  /** 该角色当前可触发（when 满足、未消费、父事件已触发过）的事件 */
  availableEvents(characterId: string): RelationshipEvent[] {
    return this.#events.filter((e) => {
      if (e.characterId !== characterId || this.#consumed.has(e.id) || !this.#whenTrue(e)) {
        return false;
      }
      // 事件树门控：子事件需父事件已触发过（everConsumed，含 once:false 父节点）
      const parent = this.#parentOf.get(e.id);
      if (parent !== undefined && !this.#everConsumed.has(parent)) return false;
      return true;
    });
  }

  /** 标记事件已触发。仅 once 事件计入防重入（可重复事件不消费、始终可再次触发）；门控记账所有触发。 */
  consumeEvent(id: string): boolean {
    const ev = this.#events.find((e) => e.id === id);
    if (!ev) return false;
    this.#everConsumed.add(id);
    if (this.#consumed.has(id)) return false;
    if (ev.once) this.#consumed.add(id);
    return true;
  }

  snapshot(): AffectionSnapshot {
    return { consumed: [...this.#consumed], everConsumed: [...this.#everConsumed] };
  }

  restore(snap: AffectionSnapshot): void {
    this.#consumed = new Set(snap.consumed);
    this.#everConsumed = new Set(snap.everConsumed ?? snap.consumed);
  }

  /** 条件求值（严格策略，与解释器 @if/choice when 一致）：
   *  求值失败（未定义变量/类型错误）一律抛错，暴露配置缺陷，不做静默降级。 */
  #whenTrue(e: RelationshipEvent): boolean {
    return evalExprBoolean(e.when, this.#env);
  }
}
