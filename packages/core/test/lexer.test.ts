import { describe, expect, it } from 'vitest';
import { Lexer, LexError, parseInlineInstructions } from '../src/dsl/lexer.js';
import type { InstructionToken, TextToken } from '../src/dsl/token.js';

const lex = (src: string) => new Lexer().tokenize(src, 'test.gal');

function only<T>(tokens: T[], pred: (t: T) => boolean): T[] {
  return tokens.filter(pred);
}

describe('Lexer', () => {
  it('文本行解析说话人前缀（中文/英文冒号）', () => {
    const tokens = only(lex('凛：你来了。\nLynn: hello\n旁白\n12:30 的钟声'), (t) => t.type === 'text') as TextToken[];
    expect(tokens).toHaveLength(4);
    expect(tokens[0]!.speaker).toBe('凛');
    expect(tokens[0]!.value).toBe('你来了。');
    expect(tokens[1]!.speaker).toBe('Lynn');
    expect(tokens[1]!.value).toBe('hello');
    expect(tokens[2]!.speaker).toBeNull();
    expect(tokens[2]!.value).toBe('旁白');
    expect(tokens[3]!.speaker).toBeNull(); // 纯数字前缀不当作说话人
    expect(tokens[3]!.value).toBe('12:30 的钟声');
  });

  it('解析指令与修饰符', () => {
    const tokens = only(lex('@show lynn:armor despair @ left @ effect shake'), (t) => t.type === 'instruction') as InstructionToken[];
    const t = tokens[0]!;
    expect(t.name).toBe('show');
    expect(t.args).toEqual(['lynn:armor', 'despair']);
    expect(t.modifiers.get('left')).toBe('');
    expect(t.modifiers.get('effect')).toBe('shake');
  });

  it('解析 @mod 与 @jump 的位置参数', () => {
    const tokens = only(lex('@mod lynnTrust +2\n@jump ch01_02.start'), (t) => t.type === 'instruction') as InstructionToken[];
    expect(tokens[0]!.name).toBe('mod');
    expect(tokens[0]!.args).toEqual(['lynnTrust', '+2']);
    expect(tokens[1]!.name).toBe('jump');
    expect(tokens[1]!.args).toEqual(['ch01_02.start']);
  });

  it('解析 @label', () => {
    const tokens = only(lex('@label start'), (t) => t.type === 'label');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'label', name: 'start', line: 1 });
  });

  it('空行与注释被跳过', () => {
    const tokens = lex('\n\n// 注释\n// 注释2\n凛：你好');
    const meaningful = tokens.filter((t) => t.type !== 'eof' && t.type !== 'comment');
    expect(meaningful).toHaveLength(1);
  });

  it('行号逐行递增', () => {
    const tokens = only(lex('第一行\n第二行：x'), (t) => t.type === 'text') as TextToken[];
    expect(tokens[0]!.line).toBe(1);
    expect(tokens[1]!.line).toBe(2);
  });

  it('指令缺失名报错并定位', () => {
    expect(() => lex('@ show x')).toThrow(LexError);
    expect(() => lex('@ show x')).toThrow(/L001/);
  });

  it('@label 缺名字或尾随内容抛 L003', () => {
    expect(() => lex('@label')).toThrow(/L003/);
    expect(() => lex('@label start extra')).toThrow(/L003/);
  });

  it('引号感知参数（引号内空格与 @ 不拆开，引号保留）', () => {
    const tokens = only(lex('@set msg = "a b c"\n@set email = "x@y.com"\n@show lynn @effect "shake hard"'), (t) => t.type === 'instruction') as InstructionToken[];
    expect(tokens[0]!.args).toEqual(['msg', '=', '"a b c"']);
    expect(tokens[1]!.args).toEqual(['email', '=', '"x@y.com"']);
    expect(tokens[2]!.modifiers.get('effect')).toBe('"shake hard"');
  });

  it('修饰符 key=value 形式', () => {
    const tokens = only(lex('@show lynn @pos=left @scale=1.5'), (t) => t.type === 'instruction') as InstructionToken[];
    expect(tokens[0]!.modifiers.get('pos')).toBe('left');
    expect(tokens[0]!.modifiers.get('scale')).toBe('1.5');
  });

  it('未闭合引号抛 L004', () => {
    expect(() => lex('@set msg = "abc')).toThrow(/L004/);
    expect(() => lex('@set msg = \'abc')).toThrow(/L004/);
  });
});

describe('parseInlineInstructions', () => {
  it('解析选项内联指令序列', () => {
    const ins = parseInlineInstructions('@mod lynnTrust +2 @goto silence_path', 'x.gal', 5, 1);
    expect(ins).toHaveLength(2);
    expect(ins[0]!.name).toBe('mod');
    expect(ins[0]!.args).toEqual(['lynnTrust', '+2']);
    expect(ins[1]!.name).toBe('goto');
    expect(ins[1]!.args).toEqual(['silence_path']);
  });

  it('引号感知：引号内 @ 不拆段、引号保留', () => {
    const ins = parseInlineInstructions('@set email = "x@y.com" @goto a', 'x.gal', 5, 1);
    expect(ins).toHaveLength(2);
    expect(ins[0]!.name).toBe('set');
    expect(ins[0]!.args).toEqual(['email', '=', '"x@y.com"']);
    expect(ins[1]!.name).toBe('goto');
  });

  it('未闭合引号抛 L004', () => {
    expect(() => parseInlineInstructions('@set email = "x@y.com', 'x.gal', 5, 1)).toThrow(/L004/);
  });
});
