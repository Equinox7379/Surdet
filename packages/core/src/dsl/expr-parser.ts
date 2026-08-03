import { isBinOp, BINARY_PRECEDENCE, type BinOp, type ExprAst } from './expr-ast.js';

/** 表达式解析错误（带偏移） */
export class ExprParseError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message}（偏移 ${offset}）`);
    this.name = 'ExprParseError';
    this.offset = offset;
  }
}

/** 表达式嵌套深度上限（括号/一元/二元链递归），防止恶意/病态输入触发 JS 栈溢出（RangeError）而非可定位的解析错误 */
export const MAX_EXPR_NESTING = 200;

/**
 * 递归下降表达式解析器。
 * 输入为表达式字符串（@if 的条件 / @set 的右值），产出 ExprAst。
 */
export class ExprParser {
  #src: string;
  #pos = 0;
  #nesting = 0;
  /** 一元连缀（!!!x / ---x / +++x）递归深度（括号之外的另一个栈溢出源） */
  #unaryDepth = 0;

  static parse(source: string): ExprAst {
    return new ExprParser(source).parseRoot();
  }

  constructor(source: string) {
    this.#src = source;
  }

  /** 解析完整表达式并断言已消费全部输入 */
  parseRoot(): ExprAst {
    const ast = this.parseOr();
    this.#skipWs();
    if (this.#pos < this.#src.length) {
      const rest = this.#src.slice(this.#pos);
      if (/^(==|!=|<=|>=|<|>)/.test(rest)) {
        this.#fail('不支持链式比较（如 a < b < c），请用 && 连接多个条件');
      }
      this.#fail(`意外字符 '${this.#src[this.#pos]}'`);
    }
    return ast;
  }

  private parseOr(): ExprAst {
    let left = this.parseAnd();
    while (this.#matchOp('||')) left = this.#bin('||', left, this.parseAnd());
    return left;
  }

  private parseAnd(): ExprAst {
    let left = this.parseCmp();
    while (this.#matchOp('&&')) left = this.#bin('&&', left, this.parseCmp());
    return left;
  }

  private parseCmp(): ExprAst {
    let left = this.parseAdd();
    for (const op of ['==', '!=', '<=', '>=', '<', '>'] as const) {
      if (this.#matchOp(op)) {
        left = this.#bin(op, left, this.parseAdd());
        break;
      }
    }
    return left;
  }

  private parseAdd(): ExprAst {
    let left = this.parseMul();
    for (;;) {
      if (this.#matchOp('+')) left = this.#bin('+', left, this.parseMul());
      else if (this.#matchOp('-')) left = this.#bin('-', left, this.parseMul());
      else return left;
    }
  }

  private parseMul(): ExprAst {
    let left = this.parseUnary();
    for (;;) {
      if (this.#matchOp('*')) left = this.#bin('*', left, this.parseUnary());
      else if (this.#matchOp('/')) left = this.#bin('/', left, this.parseUnary());
      else return left;
    }
  }

  private parseUnary(): ExprAst {
    this.#skipWs();
    const ch = this.#src[this.#pos];
    if (ch === '!' || ch === '-' || ch === '+') {
      this.#unaryDepth++;
      if (this.#unaryDepth > MAX_EXPR_NESTING) {
        this.#fail(`嵌套过深（超过 ${MAX_EXPR_NESTING} 层一元运算）`);
      }
      try {
        this.#pos++;
        this.#skipWs();
        if (ch === '!') return { kind: 'unary', op: '!', operand: this.parseUnary() };
        if (ch === '-') return { kind: 'unary', op: '-', operand: this.parseUnary() };
        return this.parseUnary(); // 一元正号：无语义，直接返回操作数
      } finally {
        this.#unaryDepth--;
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprAst {
    this.#skipWs();
    const ch = this.#src[this.#pos];
    if (ch === undefined) this.#fail('表达式意外结束');

    if (ch === '(') {
      this.#nesting++;
      if (this.#nesting > MAX_EXPR_NESTING) {
        this.#fail(`嵌套过深（超过 ${MAX_EXPR_NESTING} 层括号）`);
      }
      try {
        this.#pos++;
        const inner = this.parseOr();
        this.#skipWs();
        if (this.#src[this.#pos] !== ')') this.#fail('缺少右括号 )');
        this.#pos++;
        return inner;
      } finally {
        this.#nesting--;
      }
    }
    if (ch === '"' || ch === "'") return this.parseString(ch);
    if (/[0-9]/.test(ch)) return this.parseNumber();

    const word = this.parseWord();
    if (word === 'true') return { kind: 'bool', value: true };
    if (word === 'false') return { kind: 'bool', value: false };
    if (word.length === 0) this.#fail(`无法识别的标记 '${ch}'`);
    return { kind: 'var', name: word };
  }

  private parseNumber(): ExprAst {
    const m = /^[+-]?\d+(\.\d+)?/.exec(this.#src.slice(this.#pos));
    if (!m) this.#fail('非法数字');
    this.#pos += m[0].length;
    return { kind: 'number', value: parseFloat(m[0]) };
  }

  private parseString(quote: string): ExprAst {
    this.#pos++; // 跳过开引号
    let out = '';
    for (;;) {
      const c = this.#src[this.#pos];
      if (c === undefined) this.#fail('字符串未闭合');
      if (c === quote) {
        this.#pos++;
        return { kind: 'string', value: out };
      }
      if (c === '\\') {
        const next = this.#src[this.#pos + 1];
        if (next === undefined) this.#fail('字符串未闭合');
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        this.#pos += 2;
        continue;
      }
      out += c;
      this.#pos++;
    }
  }

  private parseWord(): string {
    const m = /^[A-Za-z_\u0080-\uffff][A-Za-z0-9_$.\u0080-\uffff]*/.exec(this.#src.slice(this.#pos));
    if (!m) return '';
    this.#pos += m[0].length;
    return m[0];
  }

  #bin(op: BinOp, left: ExprAst, right: ExprAst): ExprAst {
    return { kind: 'binary', op, left, right };
  }

  #skipWs(): void {
    while (this.#pos < this.#src.length && /\s/.test(this.#src[this.#pos]!)) this.#pos++;
  }

  #matchOp(op: string): boolean {
    this.#skipWs();
    if (this.#src.startsWith(op, this.#pos)) {
      this.#pos += op.length;
      this.#skipWs();
      return true;
    }
    return false;
  }

  #fail(message: string): never {
    throw new ExprParseError(message, this.#pos);
  }
}

/** 便捷函数：解析表达式，失败抛 ExprParseError */
export function parseExpr(source: string): ExprAst {
  return ExprParser.parse(source);
}

/** 语法校验（供编译器/lint 调用）；合法返回 true，非法抛 ExprParseError */
export function validateExpr(source: string): boolean {
  parseExpr(source);
  return true;
}

/** 收集表达式内全部变量引用名（去重，lint 变量声明校验用） */
export function collectVars(ast: ExprAst): string[] {
  const seen = new Set<string>();
  walk(ast);
  return [...seen];

  function walk(n: ExprAst): void {
    switch (n.kind) {
      case 'var':
        seen.add(n.name);
        return;
      case 'unary':
        walk(n.operand);
        return;
      case 'binary':
        walk(n.left);
        walk(n.right);
        return;
      default:
        return;
    }
  }
}

export type { BinOp };
export { BINARY_PRECEDENCE, isBinOp };
