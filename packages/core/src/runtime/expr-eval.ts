import type { ExprAst } from '../dsl/expr-ast.js';
import { parseExpr } from '../dsl/expr-parser.js';
import type { VarPrimitive, VarValue } from '../state/types.js';

/** 求值环境：变量解析回调（未定义变量返回 undefined，由求值器报错） */
export interface ExprEnv {
  getVariable(name: string): VarValue | undefined;
}

/** 表达式运行时错误 */
export class ExprEvalError extends Error {
  constructor(message: string) {
    super(`表达式求值错误：${message}`);
    this.name = 'ExprEvalError';
  }
}

/**
 * 表达式求值器。支持算术/比较/逻辑/一元运算与变量引用。
 * 类型规则：
 *  - + 支持 number 与 string（字符串拼接）
 *  - 比较 ==/!= 支持 number/string/boolean；大小比较仅 number
 *  - &&/||/! 要求 boolean 操作数
 *  - 变量不存在抛 ExprEvalError（严格模式）
 */
export function evalExpr(ast: ExprAst, env: ExprEnv): VarValue {
  switch (ast.kind) {
    case 'number':
    case 'string':
    case 'bool':
      return ast.value;

    case 'var': {
      const v = env.getVariable(ast.name);
      if (v === undefined) {
        throw new ExprEvalError(`变量 '${ast.name}' 未定义`);
      }
      return v;
    }

    case 'unary': {
      if (ast.op === '!') {
        const v = evalExpr(ast.operand, env);
        if (typeof v !== 'boolean') {
          throw new ExprEvalError(`'!' 需要 boolean 操作数，得到 ${describe(v)}`);
        }
        return !v;
      }
      const v = evalExpr(ast.operand, env);
      const n = requireNumber(v, "'-'");
      return -n;
    }

    case 'binary': {
      return evalBinary(ast, env);
    }
  }
}

/** 已解析表达式 AST 缓存：condJump/choice when/visibleWhen/伤害公式等热路径
 *  对同一表达式串反复求值，避免每次都重新递归下降解析。
 *  AST 为只读树，共享引用安全；LRU 淘汰——命中即移到插入序末尾，超容量逐出最旧，
 *  避免"整体清空"导致热表达式被反复重解析（Map 插入序即近似访问序）。 */
const AST_CACHE_MAX = 1024;
const astCache = new Map<string, ExprAst>();

function parseCached(source: string): ExprAst {
  const cached = astCache.get(source);
  if (cached !== undefined) {
    astCache.delete(source);
    astCache.set(source, cached);
    return cached;
  }
  const ast = parseExpr(source);
  if (astCache.size >= AST_CACHE_MAX) {
    const oldest = astCache.keys().next().value;
    if (oldest !== undefined) astCache.delete(oldest);
  }
  astCache.set(source, ast);
  return ast;
}

/** 便捷函数：解析 + 求值（解析结果经 AST 缓存复用） */
export function evalExprString(source: string, env: ExprEnv): VarValue {
  return evalExpr(parseCached(source), env);
}

/** 便捷函数：解析 + 求值为 boolean（@if / choice when / 好感事件 when 等条件语境使用）。
 *  统一策略：条件表达式求值失败（未定义变量 / 类型错误）一律抛 ExprEvalError，
 *  不静默降级——剧本与配置数据中的条件缺陷应尽早暴露，而非悄悄跳过。 */
export function evalExprBoolean(source: string, env: ExprEnv): boolean {
  const v = evalExpr(parseCached(source), env);
  if (typeof v !== 'boolean') {
    throw new ExprEvalError(`条件表达式 '${source}' 结果不是 boolean，得到 ${describe(v)}`);
  }
  return v;
}

function evalBinary(ast: Extract<ExprAst, { kind: 'binary' }>, env: ExprEnv): VarValue {
  // 短路求值：&& / || 只对实际求值的一侧做 boolean 校验。
  // 例：false && 未定义变量 → false（右侧不求值）；true || 类型错误 → true（右侧不求值）。
  if (ast.op === '&&' || ast.op === '||') {
    const l = requireBoolean(evalExpr(ast.left, env), `'${ast.op}'`);
    if (ast.op === '&&') {
      if (!l) return false;
      return requireBoolean(evalExpr(ast.right, env), "'&&'");
    }
    if (l) return true;
    return requireBoolean(evalExpr(ast.right, env), "'||'");
  }

  const left = evalExpr(ast.left, env);
  const right = evalExpr(ast.right, env);

  switch (ast.op) {
    case '==':
      // 深比较：VariableStore.get 对数组/对象返回防御性拷贝，两侧引用必然不同，
      // 引用比较会使 `items == items` 恒为 false（隐蔽陷阱）。
      return deepEqual(left, right);
    case '!=':
      return !deepEqual(left, right);
  }

  if (ast.op === '+') {
    if (typeof left === 'string' || typeof right === 'string') {
      return `${left}${right}`;
    }
    return requireNumber(left, "'+'") + requireNumber(right, "'+'");
  }
  if (ast.op === '-') return requireNumber(left, "'-'") - requireNumber(right, "'-'");
  if (ast.op === '*') return requireNumber(left, "'*'") * requireNumber(right, "'*'");
  if (ast.op === '/') {
    const r = requireNumber(right, "'/'");
    if (r === 0) throw new ExprEvalError('除数为 0');
    return requireNumber(left, "'/'") / r;
  }

  // 大小比较：仅 number
  const l = requireNumber(left, `'${ast.op}'`);
  const r = requireNumber(right, `'${ast.op}'`);
  switch (ast.op) {
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    case '>=': return l >= r;
    default:
      throw new ExprEvalError(`未知运算符 '${ast.op as string}'`);
  }
}

function requireNumber(v: VarValue, op: string): number {
  if (typeof v !== 'number') {
    throw new ExprEvalError(`${op} 需要 number 操作数，得到 ${describe(v)}`);
  }
  return v;
}

function requireBoolean(v: VarValue, op: string): boolean {
  if (typeof v !== 'boolean') {
    throw new ExprEvalError(`${op} 需要 boolean 操作数，得到 ${describe(v)}`);
  }
  return v;
}

/** 深比较（==/!=）：基本类型值比较；数组/对象递归比较（两侧为独立深拷贝的合法写法）。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ));
  }
  return false;
}

function describe(v: VarValue): string {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === 'object' && v !== null) return 'object';
  if (typeof v === 'string') return `string "${v}"`;
  if (typeof v === 'boolean') return `boolean ${v}`;
  if (typeof v === 'number' && !Number.isFinite(v)) return 'number（非有限值）';
  return `number ${v}`;
}

export type { VarPrimitive };
