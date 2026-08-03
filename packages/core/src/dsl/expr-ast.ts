/**
 * DSL 表达式 AST。
 * 用于 @if / @elif / @set 及 choice 选项条件、条件文本段。
 * 语法（优先级从低到高）：
 *   expr := or
 *   or   := and ('||' and)*
 *   and  := cmp ('&&' cmp)*
 *   cmp  := add (('=='|'!='|'<'|'<='|'>'|'>=') add)?
 *   add  := mul (('+'|'-') mul)*
 *   mul  := unary (('*'|'/') unary)*
 *   unary:= ('!'|'-'|'+') unary | primary
 *   primary := number | string | 'true' | 'false' | var | '(' expr ')'
 * 变量名允许点号命名空间：lynn.trust / hero.name
 * 一元 '+' 无语义（+x ≡ x），解析时直接返回操作数，不产生节点。
 */

export type BinOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export type ExprAst =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '!' | '-'; operand: ExprAst }
  | { kind: 'binary'; op: BinOp; left: ExprAst; right: ExprAst };

/** 运算符优先级表（数字越大越先结合） */
export const BINARY_PRECEDENCE: Readonly<Record<BinOp, number>> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
};

export const BINARY_OPS: readonly BinOp[] = Object.keys(BINARY_PRECEDENCE) as BinOp[];

export function isBinOp(s: string): s is BinOp {
  return (BINARY_OPS as readonly string[]).includes(s);
}
