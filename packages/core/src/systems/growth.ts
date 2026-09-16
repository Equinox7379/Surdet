import type { VariableStore } from '../state/variable-store.js';

/**
 * 角色成长系统（经验/升级）。
 *
 * 设计（兰斯式 RPG 要素）：
 *  - 成长曲线配置驱动（growth.json）：固定公式（base + linear 线性增长）或显式曲线（各级所需经验表）
 *  - 升级时按 statGrowth 把属性增量写回变量仓库（如 lynn.atk += 2），剧本 @if/@set 直接可用
 *  - 等级/经验由系统内聚管理（levels/experience 快照随存档持久化），
 *    不依赖项目变量声明——宿主无需为每个角色预声明等级变量
 */

/** 成长曲线配置（二选一） */
export interface GrowthCurveConfig {
  /** 固定公式：expForLevel(L) = base + linear * max(0, L - 2)（L1→L2 = base，每级线性递增；未给显式曲线时） */
  base?: number;
  linear?: number;
  /** 显式曲线：levels[k] = 从 L(k+1) 升到 L(k+2) 所需经验（即 levels[0] 为 L1→L2 阈值）；
   *  表长耗尽后封顶不再升级 */
  levels?: number[];
}

/** 升级属性成长（变量增量） */
export interface GrowthProfile {
  characterId: string;
  /** 初始等级（未获得经验前） */
  initialLevel?: number;
  /** 等级上限（缺省不限） */
  maxLevel?: number;
  /** 升级时写回变量的增量，如 { "lynn.atk": 2, "lynn.hp": 10 } */
  statGrowth?: Record<string, number>;
  /** 达到指定等级触发的事件场景 ID（宿主在 growth 事件回调中决定跳转） */
  levelEvents?: Record<number, string>;
}

/** 成长系统配置 */
export interface GrowthConfig {
  curve: GrowthCurveConfig;
  profiles: GrowthProfile[];
}

/** 存档快照（JSON 安全；levels/experience 为普通对象） */
export interface GrowthSnapshot {
  levels: Record<string, number>;
  experience: Record<string, number>;
}

/** @exp 指令结果（宿主/渲染层展示升级演出） */
export interface GrowthResult {
  characterId: string;
  gained: number;
  levelBefore: number;
  levelAfter: number;
  levelsGained: number;
  /** 升级途中经过的等级（含最终等级），供宿主查 levelEvents */
  passedLevels: number[];
}

/**
 * 成长系统：经验累积 → 阈值判定 → 连升多级 → 属性增量写回变量仓库。
 *
 * 严格策略：未知角色 / 非法增量抛错（尽早暴露剧本缺陷，与解释器其余指令一致）。
 */
export class GrowthSystem {
  #config: GrowthConfig;
  #store: VariableStore;
  #levels = new Map<string, number>();
  #experience = new Map<string, number>();

  constructor(config: GrowthConfig, store: VariableStore) {
    this.#config = config;
    this.#store = store;
    for (const p of config.profiles) {
      this.#levels.set(p.characterId, p.initialLevel ?? 1);
      this.#experience.set(p.characterId, 0);
    }
  }

  /** 角色是否已注册（未注册的 @exp 由调用方报错） */
  has(characterId: string): boolean {
    return this.#levels.has(characterId);
  }

  levelOf(characterId: string): number {
    const lv = this.#levels.get(characterId);
    if (lv === undefined) throw new Error(`GrowthSystem: 未注册角色 '${characterId}'`);
    return lv;
  }

  experienceOf(characterId: string): number {
    const xp = this.#experience.get(characterId);
    if (xp === undefined) throw new Error(`GrowthSystem: 未注册角色 '${characterId}'`);
    return xp;
  }

  /** 升到 L 级所需经验。固定公式 base + linear*(L-2)（L1→L2 = base，每级线性递增）；
   *  显式曲线 levels[L-2]（超表/非法返回 0 = 不可再升） */
  expForLevel(level: number): number {
    const { base = 0, linear = 0, levels } = this.#config.curve;
    if (levels !== undefined) {
      if (levels.length === 0) return 0;
      if (level < 2 || level - 2 >= levels.length) return 0;
      return levels[level - 2] ?? 0;
    }
    return Math.max(0, base + linear * Math.max(0, level - 2));
  }

  /** 到下一级还差多少经验（已满级/不可再升返回 null） */
  expToNext(characterId: string): number | null {
    const lv = this.levelOf(characterId);
    const profile = this.#profile(characterId);
    if (profile.maxLevel !== undefined && lv >= profile.maxLevel) return null;
    const need = this.expForLevel(lv + 1);
    if (need <= 0) return null; // 曲线封顶（显式表耗尽或公式非正）
    return Math.max(0, need - this.experienceOf(characterId));
  }

  /**
   * 获得经验：累积后循环判升级（单次获得可连升多级），升级时把 statGrowth 增量写回变量仓库。
   * 返回完整结果（含途经等级，供宿主触发 levelEvents 与升级演出）。
   */
  gainExp(characterId: string, amount: number): GrowthResult {
    const profile = this.#profile(characterId);
    if (!Number.isFinite(amount)) throw new Error(`GrowthSystem: 经验增量非法（${amount}）`);
    let level = this.levelOf(characterId);
    let xp = Math.max(0, this.experienceOf(characterId) + amount); // 负增量兜底不为负
    const passed: number[] = [];

    while (xp > 0) {
      if (profile.maxLevel !== undefined && level >= profile.maxLevel) break;
      const need = this.expForLevel(level + 1);
      if (need <= 0) break; // 曲线封顶
      if (xp < need) break;
      xp -= need;
      level += 1;
      passed.push(level);
    }

    const updates = this.#prepareStatGrowthUpdates(profile, passed.length);
    this.#store.setMany(updates);
    this.#levels.set(characterId, level);
    this.#experience.set(characterId, xp);
    return {
      characterId,
      gained: amount,
      levelBefore: this.levelOf(characterId) - passed.length,
      levelAfter: level,
      levelsGained: passed.length,
      passedLevels: passed,
    };
  }

  /** 该角色达到某等级应触发的事件场景（无配置返回 null） */
  levelEventFor(characterId: string, level: number): string | null {
    const profile = this.#config.profiles.find((p) => p.characterId === characterId);
    return profile?.levelEvents?.[level] ?? null;
  }

  snapshot(): GrowthSnapshot {
    return {
      levels: Object.fromEntries(this.#levels),
      experience: Object.fromEntries(this.#experience),
    };
  }

  #prepareStatGrowthUpdates(
    profile: GrowthProfile,
    levelsGained: number,
  ): Array<{ name: string; value: number }> {
    if (levelsGained === 0) return [];

    const updates: Array<{ name: string; value: number }> = [];
    for (const [varName, delta] of Object.entries(profile.statGrowth ?? {})) {
      if (!Number.isFinite(delta)) {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 增量必须是有限 number",
        );
      }
      if (!this.#store.has(varName)) {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 未声明或非 number（growth.json 配置缺陷）",
        );
      }
      const current = this.#store.get(varName);
      if (typeof current !== 'number') {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 未声明或非 number（growth.json 配置缺陷）",
        );
      }
      const next = current + delta * levelsGained;
      if (!Number.isFinite(next)) {
        throw new Error(
          "GrowthSystem: statGrowth variable '" + varName + "' 最终值必须是有限 number",
        );
      }
      updates.push({ name: varName, value: next });
    }
    return updates;
  }

  validateSnapshot(snap: GrowthSnapshot): void {
    for (const profile of this.#config.profiles) {
      const level = snap.levels?.[profile.characterId];
      const xp = snap.experience?.[profile.characterId];
      if (level !== undefined && (!Number.isSafeInteger(level) || level < 1
        || (profile.maxLevel !== undefined && level > profile.maxLevel))) {
        throw new Error(`GrowthSystem: '${profile.characterId}' 存档等级非法`);
      }
      if (xp !== undefined && (!Number.isFinite(xp) || xp < 0)) {
        throw new Error(`GrowthSystem: '${profile.characterId}' 存档经验非法`);
      }
    }
  }

  restore(snap: GrowthSnapshot): void {
    this.validateSnapshot(snap);
    // 读档：只恢复配置中已注册角色的状态（旧档含已删除角色时静默忽略，新角色按初始等级）
    this.#levels = new Map(this.#config.profiles.map((p) => [p.characterId, p.initialLevel ?? 1]));
    this.#experience = new Map(this.#config.profiles.map((p) => [p.characterId, 0]));
    for (const [id, lv] of Object.entries(snap.levels ?? {})) {
      if (this.#levels.has(id) && typeof lv === 'number') this.#levels.set(id, lv);
    }
    for (const [id, xp] of Object.entries(snap.experience ?? {})) {
      if (this.#experience.has(id) && typeof xp === 'number') this.#experience.set(id, xp);
    }
  }

  #profile(characterId: string): GrowthProfile {
    const profile = this.#config.profiles.find((p) => p.characterId === characterId);
    if (!profile) throw new Error(`GrowthSystem: 未注册角色 '${characterId}'`);
    return profile;
  }
}
