/**
 * 状态系统类型定义。
 *
 * 所有游戏变量在使用前必须在 game.config.json 的变量表中声明，
 * 声明带类型、初值、范围约束。类型安全由 VariableStore 强制执行。
 */

/** 基础变量类型 */
export type VarPrimitive = string | number | boolean;

/** 变量可接受的全部取值形态 */
export type VarValue = VarPrimitive | VarValue[] | { [key: string]: VarValue };

/** 声明中允许的类型标识 */
export type VarType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'flag'
  | 'string[]'
  | 'number[]'
  | 'object';

/** 运行时可用类型标识列表（lint 校验声明形状用） */
export const VAR_TYPES: readonly VarType[] = [
  'string',
  'number',
  'boolean',
  'flag',
  'string[]',
  'number[]',
  'object',
];

/** 判断字符串是否为合法 VarType */
export function isVarType(s: string): s is VarType {
  return (VAR_TYPES as readonly string[]).includes(s);
}

/** 变量声明 */
export interface VarDeclaration {
  /** 变量名，全局唯一（支持点号命名空间如 "lynn.trust"） */
  name: string;
  /** 类型标识 */
  type: VarType;
  /** 初始值 */
  initial: VarValue;
  /** 只读变量（引擎内部状态，如章节编号） */
  readonly?: boolean;
  /** number 类型的最小值（越界自动 clamp） */
  min?: number;
  /** number 类型的最大值（越界自动 clamp） */
  max?: number;
  /** 用途说明（供文档/工具生成） */
  description?: string;
}
