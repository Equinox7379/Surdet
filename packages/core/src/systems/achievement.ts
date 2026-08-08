import type { ExprEnv } from '../runtime/expr-eval.js';
import { evalExprBoolean } from '../runtime/expr-eval.js';

/**
 * 成就系统（商业化标配）。
 *
 * 设计（兰斯/商业 galgame 通用形态）：
 *  - 数据驱动（achievements.json）：每条成就含展示名/描述 + 解锁途径
 *  - 解锁途径二选一或并用：
 *      when  —— 布尔表达式，宿主在状态变更后调 check() 批量判定
 *      事件  —— 宿主在特定剧情节点显式 unlock(id)（如首通、收集齐、隐藏要素）
 *  - 解锁状态随存档持久化（snapshot/restore）；跨周目累计由宿主决定（可另落全局记录，同 @clear 模式）
 *  - hidden 成就未解锁时不暴露 name/description（鉴赏界面展示"???"）
 *
 * 严格策略：未知成就 ID / 非法解锁抛错（尽早暴露配置缺陷，与引擎其余系统一致）。
 */

/** 单条成就定义 */
export interface AchievementDef {
  id: string;
  /** 展示名（hidden 未解锁时由展示层替换为 ???） */
  name: string;
  /** 解锁提示/描述 */
  description?: string;
  /** 解锁条件（布尔 DSL 表达式；缺省 = 仅事件触发） */
  when?: string;
  /** 隐藏成就：未解锁时不展示 name/description */
  hidden?: boolean;
}

/** 成就状态快照（随存档保存） */
export interface AchievementSnapshot {
  /** 已解锁成就 ID 列表（按解锁顺序） */
  unlocked: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 一次 check/unlock 的结果（宿主用于横幅/提示演出） */
export interface AchievementUnlockResult {
  id: string;
  def: AchievementDef;
  /** 是否本次新解锁（重复解锁 fresh=false） */
  fresh: boolean;
}

/**
 * 成就系统：条件判定 + 事件解锁 + 存档往返。
 */
export class AchievementSystem {
  #defs: AchievementDef[];
  #byId: Map<string, AchievementDef>;
  #env: ExprEnv;
  /** 已解锁（按解锁顺序，snapshot 保序） */
  #unlocked: string[] = [];

  constructor(defs: AchievementDef[], env: ExprEnv) {
    this.#defs = defs;
    this.#env = env;
    this.#byId = new Map();
    for (const d of defs) {
      if (this.#byId.has(d.id)) {
        throw new Error(`AchievementSystem: 成就 ID 重复 '${d.id}'`);
      }
      this.#byId.set(d.id, d);
    }
  }

  /** 成就总数 */
  get total(): number {
    return this.#defs.length;
  }

  /** 已解锁数（进度展示用） */
  get unlockedCount(): number {
    return this.#unlocked.length;
  }

  /** 是否已解锁 */
  isUnlocked(id: string): boolean {
    return this.#unlocked.includes(id);
  }

  /** 已解锁 ID 列表（按解锁顺序；防御性拷贝） */
  unlocked(): string[] {
    return [...this.#unlocked];
  }

  /** 进度字符串（如 "3/12"） */
  progress(): string {
    return `${this.#unlocked.length}/${this.#defs.length}`;
  }

  /**
   * 批量判定 when 条件，解锁所有新满足的成就。
   * 返回本次新解锁的结果列表（供宿主播放横幅；无新解锁返回空数组）。
   * 条件求值严格策略（与 @if 一致）：未定义变量/类型错误抛错，暴露配置缺陷。
   */
  check(): AchievementUnlockResult[] {
    const fresh: AchievementUnlockResult[] = [];
    for (const def of this.#defs) {
      if (def.when === undefined || this.isUnlocked(def.id)) continue;
      if (evalExprBoolean(def.when, this.#env)) {
        this.#unlocked.push(def.id);
        fresh.push({ id: def.id, def, fresh: true });
      }
    }
    return fresh;
  }

  /**
   * 事件触发解锁（宿主在剧情节点显式调用）。
   * 重复解锁返回 fresh=false（幂等，不抛错——剧本重放/读档回放安全）。
   * 未知 ID 抛错（配置缺陷尽早暴露）。
   */
  unlock(id: string): AchievementUnlockResult {
    const def = this.#byId.get(id);
    if (!def) throw new Error(`AchievementSystem: 未知成就 '${id}'`);
    if (this.isUnlocked(id)) {
      return { id, def, fresh: false };
    }
    this.#unlocked.push(id);
    return { id, def, fresh: true };
  }

  /** 成就定义查询（鉴赏界面用；未知 ID 返回 null，展示层容错） */
  defOf(id: string): AchievementDef | null {
    return this.#byId.get(id) ?? null;
  }

  /** 全部成就定义（鉴赏列表用；防御性拷贝） */
  defs(): AchievementDef[] {
    return [...this.#defs];
  }

  snapshot(): AchievementSnapshot {
    return { unlocked: [...this.#unlocked] };
  }

  validateSnapshot(snap: unknown): asserts snap is AchievementSnapshot {
    if (!isRecord(snap)) throw new Error('成就快照必须是对象');
    if (snap.unlocked !== undefined
      && (!Array.isArray(snap.unlocked) || snap.unlocked.some((id) => typeof id !== 'string'))) {
      throw new Error('成就快照 unlocked 必须是字符串数组');
    }
  }

  restore(snap: AchievementSnapshot): void {
    this.validateSnapshot(snap);
    // 读档：只恢复当前配置中仍存在的成就（旧档含已删除成就时静默忽略）；去重防旧档污染进度计数
    this.#unlocked = [...new Set((snap.unlocked ?? []).filter((id) => this.#byId.has(id)))];
  }
}
