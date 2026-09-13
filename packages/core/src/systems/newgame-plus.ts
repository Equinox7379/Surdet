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
    const clearedVars: Record<string, VarValue> = Object.create(null) as Record<string, VarValue>;
    for (const entry of this.#config.inherit) {
      const v = this.#env.getVariable(entry.variable);
      if (v !== undefined) setOwn(clearedVars, entry.variable, v);
    }
    return this.computeInheritFrom(base, clearedVars);
  }

  /** 显式通关值版本的继承计算：clearedVars 来自宿主持久化的全局通关记录
   *  （@clear 时刻的变量快照），供新周目开局时应用——不依赖活体变量表。
   *  规则：copy = 通关值覆盖初始；add = 初始 + 通关值×权重（非数值按 0）；max = 取大（非数值取初始）。 */
  computeInheritFrom(base: Record<string, VarValue>, clearedVars: Record<string, VarValue>): Record<string, VarValue> {
    const out: Record<string, VarValue> = { ...base };
    for (const entry of this.#config.inherit) {
      const cleared = hasOwn(clearedVars, entry.variable) ? clearedVars[entry.variable] : undefined;
      const current = hasOwn(base, entry.variable) ? base[entry.variable] : undefined;
      switch (entry.mode) {
        case 'copy':
          if (cleared !== undefined) setOwn(out, entry.variable, cleared);
          break;
        case 'add': {
          const w = entry.weight ?? 1;
          const add = typeof cleared === 'number' ? Math.round(cleared * w) : 0;
          const b = typeof current === 'number' ? current : 0;
          setOwn(out, entry.variable, b + add);
          break;
        }
        case 'max': {
          const b = typeof current === 'number' ? current : 0;
          const c = typeof cleared === 'number' ? cleared : b;
          setOwn(out, entry.variable, Math.max(b, c));
          break;
        }
      }
    }
    return out;
  }

  get unlockGallery(): boolean {
    return this.#config.unlockGallery;
  }

  /** 继承项清单（宿主新周目应用继承值时遍历用；副本防篡改） */
  inheritEntries(): NgpInheritEntry[] {
    return [...this.#config.inherit];
  }
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function setOwn(record: Record<string, VarValue>, key: string, value: VarValue): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}
