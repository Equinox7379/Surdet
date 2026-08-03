import { describe, expect, it } from 'vitest';
import { parseExpr, ExprParseError } from '../src/dsl/expr-parser.js';
import { evalExprBoolean, evalExprString } from '../src/runtime/expr-eval.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration } from '../src/state/types.js';

const decls: VarDeclaration[] = [
  { name: 'lynn.trust', type: 'number', initial: 3 },
  { name: 'hasSword', type: 'flag', initial: false },
  { name: 'heroName', type: 'string', initial: '雷恩' },
];

function env() {
  return new VariableStore(decls);
}

describe('ExprParser', () => {
  it('解析字面量与变量', () => {
    expect(parseExpr('5')).toMatchObject({ kind: 'number', value: 5 });
    expect(parseExpr('"abc"')).toMatchObject({ kind: 'string', value: 'abc' });
    expect(parseExpr('true')).toMatchObject({ kind: 'bool', value: true });
    expect(parseExpr('lynn.trust')).toMatchObject({ kind: 'var', name: 'lynn.trust' });
  });

  it('优先级：乘除先于加减，比较先于逻辑', () => {
    const e = parseExpr('1 + 2 * 3 == 7 && hasSword == false');
    if (e.kind !== 'binary') throw new Error('expect binary');
    expect(e.op).toBe('&&');
  });

  it('括号与一元运算', () => {
    expect(parseExpr('(1 + 2) * 3')).toMatchObject({ kind: 'binary', op: '*' });
    expect(parseExpr('!true')).toMatchObject({ kind: 'unary', op: '!' });
    expect(parseExpr('-5')).toMatchObject({ kind: 'unary', op: '-' });
  });

  it('一元 + 无语义：直接返回操作数（+5、+x）', () => {
    expect(parseExpr('+5')).toMatchObject({ kind: 'number', value: 5 });
    expect(parseExpr('+lynn.trust')).toMatchObject({ kind: 'var', name: 'lynn.trust' });
    expect(evalExprString('+3 + 2', env())).toBe(5);
    expect(evalExprBoolean('+lynn.trust >= 3', env())).toBe(true);
  });

  it('语法错误抛 ExprParseError', () => {
    expect(() => parseExpr('1 +')).toThrow(ExprParseError);
    expect(() => parseExpr('(1 + 2')).toThrow(ExprParseError);
    expect(() => parseExpr('1 @ 2')).toThrow(ExprParseError);
    expect(() => parseExpr('"未闭合')).toThrow(ExprParseError);
  });

  it('超深括号嵌套抛 ExprParseError 而非 RangeError（深度守卫）', () => {
    const src = '('.repeat(5000) + '1' + ')'.repeat(5000);
    expect(() => parseExpr(src)).toThrow(ExprParseError);
    expect(() => parseExpr(src)).toThrow(/嵌套过深/);
  });

  it('超深一元连缀（!!!x）抛 ExprParseError 而非 RangeError', () => {
    expect(() => parseExpr('!'.repeat(10000) + 'x')).toThrow(ExprParseError);
    expect(() => parseExpr('-'.repeat(10000) + 'x')).toThrow(ExprParseError);
    expect(() => parseExpr('+'.repeat(10000) + 'x')).toThrow(ExprParseError);
    // 常规一元运算仍正常
    expect(parseExpr('!!true')).toMatchObject({ kind: 'unary', op: '!' });
    expect(evalExprString('--5', env())).toBe(5);
  });

  it('字符串转义', () => {
    expect(parseExpr('"a\\nb"')).toMatchObject({ kind: 'string', value: 'a\nb' });
  });
});

describe('ExprEval', () => {
  it('算术求值', () => {
    expect(evalExprString('1 + 2 * 3', env())).toBe(7);
    expect(evalExprString('(1 + 2) * 3', env())).toBe(9);
    expect(evalExprString('10 / 4', env())).toBe(2.5);
    expect(evalExprString('-3 + 5', env())).toBe(2);
  });

  it('字符串拼接', () => {
    expect(evalExprString('"雷恩" + "·" + "凛"', env())).toBe('雷恩·凛');
    expect(evalExprString('heroName + " 登场"', env())).toBe('雷恩 登场');
  });

  it('比较与逻辑', () => {
    expect(evalExprBoolean('lynn.trust >= 3', env())).toBe(true);
    expect(evalExprBoolean('lynn.trust > 3', env())).toBe(false);
    expect(evalExprBoolean('lynn.trust == 3 && hasSword == false', env())).toBe(true);
    expect(evalExprBoolean('!hasSword', env())).toBe(true);
    expect(evalExprBoolean('hasSword || lynn.trust == 3', env())).toBe(true);
    expect(evalExprString('1 != 2', env())).toBe(true);
  });

  it('未定义变量抛错', () => {
    expect(() => evalExprString('ghost > 1', env())).toThrow(/未定义/);
  });

  it('类型错误抛错（短路后仍对求值侧校验）', () => {
    expect(() => evalExprBoolean('"abc" > 1', env())).toThrow(/number/);
    // hasSword=false → 短路，右侧不求值也不校验
    expect(evalExprBoolean('hasSword && 1', env())).toBe(false);
    // true 侧需要校验右侧
    expect(() => evalExprBoolean('true && 1', env())).toThrow(/boolean/);
  });

  it('条件结果非 boolean 抛错', () => {
    expect(() => evalExprBoolean('1 + 1', env())).toThrow(/不是 boolean/);
  });

  it('&&/|| 短路求值：未求值侧不做类型/变量校验', () => {
    expect(evalExprBoolean('false && ghost', env())).toBe(false);
    expect(evalExprBoolean('true || ghost', env())).toBe(true);
    expect(evalExprBoolean('false && 1', env())).toBe(false);
    expect(() => evalExprBoolean('true && ghost', env())).toThrow(/未定义/);
    expect(() => evalExprBoolean('ghost || true', env())).toThrow(/未定义/);
  });

  it('数组/对象操作数报错信息可读', () => {
    const store = new VariableStore([...decls, { name: 'items', type: 'string[]', initial: [] }]);
    store.set('items', ['a']);
    expect(() => evalExprBoolean('!items', store)).toThrow(/array\[1\]/);
  });

  it('数组/对象变量 ==/!= 深比较（两侧为独立深拷贝，引用比较会恒 false）', () => {
    const store = new VariableStore([
      ...decls,
      { name: 'items', type: 'string[]', initial: [] },
      { name: 'items2', type: 'string[]', initial: [] },
      { name: 'stats', type: 'object', initial: { hp: 10 } },
    ]);
    store.set('items', ['a', 'b']);
    store.set('stats', { hp: 10, mp: 5 });

    expect(evalExprBoolean('items == items', store)).toBe(true);
    expect(evalExprBoolean('items != items', store)).toBe(false);
    expect(evalExprBoolean('stats == stats', store)).toBe(true);

    // 不同内容深比较
    store.set('items', ['a']);
    store.set('items2', ['b']);
    expect(evalExprBoolean('items == items2', store)).toBe(false);
    expect(evalExprBoolean('items != items2', store)).toBe(true);
  });
});
