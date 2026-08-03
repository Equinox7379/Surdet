import type { ExprEnv } from '../runtime/expr-eval.js';
import { evalExprBoolean } from '../runtime/expr-eval.js';
import type { VarValue } from '../state/types.js';

/**
 * 周目继承系统（New Game Plus）。
 * Clear 存档 + 二周目继承项白名单，由 ngp 配置驱动。
 */

/** 继承项：变量白名单 */
export interface NgpInheritEntry {
  /** 变量名 */
  variable: string;
  /** 继承方式：复制 / 加权累加 / 保留最大值 */
  mode: 'copy' | 'add' | 'max';
  /** add/max 模式下的系数 */
  weight?: number;
}

/** 周目继承配置 */
export interface NewGamePlusConfig {
  /** 达成 Clear 的 DSL 布尔表达式 */
  clearCondition: string;
  inherit: NgpInheritEntry[];
  /** 二周目起解锁的内容（画廊等） */
  unlockGallery: boolean;
}

/**
 * 周目继承：通关判定 + 继承值计算。
 * computeInherit 返回应用到新周目变量表的值。
 */
export class NewGamePlus {
  #config: NewGamePlusConfig;
  #env: ExprEnv;

  constructor(config: NewGamePlusConfig, env: ExprEnv) {
    this.#config = config;
    this.#env = env;
  }

  /** 是否达成 Clear 条件（严格求值，失败抛错暴露配置缺陷，与解释器 @if 一致） */
  isCleared(): boolean {
    return evalExprBoolean(this.#config.clearCondition, this.#env);
  }

  /** 计算继承结果：base 为新周目初始值表，返回值合并进初始表 */
  computeInherit(base: Record<string, VarValue>): Record<string, VarValue> {
    const out: Record<string, VarValue> = { ...base };
    for (const entry of this.#config.inherit) {
      const cleared = this.#env.getVariable(entry.variable);
      const current = base[entry.variable];
      switch (entry.mode) {
        case 'copy':
          out[entry.variable] = (cleared ?? current) as VarValue;
          break;
        case 'add': {
          const w = entry.weight ?? 1;
          const add = typeof cleared === 'number' ? Math.round(cleared * w) : 0;
          const b = typeof current === 'number' ? current : 0;
          out[entry.variable] = b + add;
          break;
        }
        case 'max': {
          const b = typeof current === 'number' ? current : 0;
          const c = typeof cleared === 'number' ? cleared : b;
          out[entry.variable] = Math.max(b, c);
          break;
        }
      }
    }
    return out;
  }

  get unlockGallery(): boolean {
    return this.#config.unlockGallery;
  }
}
