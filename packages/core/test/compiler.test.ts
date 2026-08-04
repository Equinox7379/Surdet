import { describe, expect, it } from 'vitest';
import { compileScene, SceneCompiler } from '../src/dsl/compiler.js';
import { Parser } from '../src/dsl/parser.js';
import { Lexer } from '../src/dsl/lexer.js';
import { DslError } from '../src/dsl/ast.js';
import type { ChoiceInstr, CondJumpInstr, CompiledScene, JumpInstr } from '../src/dsl/ast.js';

const compile = (src: string, sceneId = 'ch01_01') => compileScene(src, 'ch01_01.gal', sceneId);

describe('Parser', () => {
  it('解析基本块', () => {
    const src = `@label start\n凛：你好。\n@bg castle\n主角：哦。`;
    const ast = new Parser().parse(new Lexer().tokenize(src, 't.gal'), 'ch01_01');
    expect(ast.blocks.map((b) => b.kind)).toEqual(['label', 'text', 'instr', 'text']);
  });

  it('if 块嵌套与 elif 链', () => {
    const src = `@if a > 1\nA\n@elif b > 1\nB\n@else\nC\n@endif`;
    const ast = new Parser().parse(new Lexer().tokenize(src, 't.gal'), 's');
    expect(ast.blocks).toHaveLength(1);
    const top = ast.blocks[0]!;
    if (top.kind !== 'if') throw new Error('expect if');
    expect(top.expr).toBe('a > 1');
    expect(top.then.map((b) => b.kind)).toEqual(['text']);
    expect(top.else).toHaveLength(1);
    const nested = top.else[0]!;
    if (nested.kind !== 'if') throw new Error('expect nested if');
    expect(nested.expr).toBe('b > 1');
    expect(nested.else.map((b) => b.kind)).toEqual(['text']);
  });

  it('if 未闭合抛错', () => {
    expect(() => compile('@if x > 1\nA')).toThrow(/S003/);
  });

  it('choice 解析选项', () => {
    const src = `@choice\n  选项A -> @goto a\n  选项B [if:hasSword] -> @mod trust +2 @goto b\n  选项C`;
    const ast = new Parser().parse(new Lexer().tokenize(src, 't.gal'), 's');
    const c = ast.blocks[0]!;
    if (c.kind !== 'choice') throw new Error('expect choice');
    expect(c.options).toHaveLength(3);
    expect(c.options[0]).toMatchObject({ label: '选项A', when: null, jump: { kind: 'goto', target: 'a' } });
    expect(c.options[1]!.when).toBe('hasSword');
    expect(c.options[1]!.inline.map((i) => i.name)).toEqual(['mod']);
    expect(c.options[2]!.jump).toBeNull();
  });

  it('choice 无缩进选项抛错', () => {
    expect(() => compile('@choice\n未缩进的选项')).toThrow(/S004/);
  });
});

describe('SceneCompiler', () => {
  it('展平基础指令并索引标签', () => {
    const scene = compile(`@label start\n凛：你好。\n@bg castle`);
    expect(scene.labels.get('start')).toBe(0);
    const ops = scene.instructions.map((i) => i.op);
    expect(ops).toEqual(['label', 'text', 'instr', 'end']);
    expect(scene.instructions[0]!.index).toBe(0);
    expect(scene.instructions[3]!.op).toBe('end');
  });

  it('set 编译为 SetInstr，mod 编译为 ModifyInstr', () => {
    const scene = compile(`@set lynn.trust = 5\n@mod lynn.trust +3\n@set hasSword := true`);
    expect(scene.instructions[0]).toMatchObject({ op: 'set', varName: 'lynn.trust', setOp: '=', expr: '5' });
    expect(scene.instructions[1]).toMatchObject({ op: 'modify', varName: 'lynn.trust', delta: 3 });
    expect(scene.instructions[2]).toMatchObject({ op: 'set', varName: 'hasSword', setOp: ':=', expr: 'true' });
  });

  it('set 表达式语法错误定位', () => {
    expect(() => compile('@set x = 1 +')).toThrow(/C005/);
    expect(() => compile('@set x = 1 +')).toThrow(/ch01_01\.gal:1:1/);
  });

  it('if 编译为 condJump + 跳转回填', () => {
    const scene = compile(`@if trust >= 5\nA\n@else\nB\n@endif`);
    const ops = scene.instructions.map((i) => i.op);
    expect(ops).toEqual(['condJump', 'text', 'jump', 'text', 'end']);

    const cond = scene.instructions[0] as CondJumpInstr;
    expect(cond.expr).toBe('trust >= 5');
    // 条件为假 → 跳到 else 块（index 3 = B）
    expect(cond.target).toBe(3);

    const skip = scene.instructions[2] as JumpInstr;
    expect(skip.kind).toBe('goto');
    // else 执行完 → 跳到 end（index 4）
    expect(skip.gotoIndex).toBe(4);
  });

  it('if 无 else 时条件假直接跳 end', () => {
    const scene = compile(`@if x\nA\n@endif`);
    const cond = scene.instructions[0] as CondJumpInstr;
    expect(cond.target).toBe(2); // 跳过 A，直达 end
  });

  it('choice 编译：选项块 + 跳转回填', () => {
    const scene = compile(`@choice\n  A -> @goto a\n  B\n@label a\n凛：好。`);
    const choice = scene.instructions.find((i) => i.op === 'choice') as ChoiceInstr;
    expect(choice).toBeTruthy();
    expect(choice.options).toHaveLength(2);
    expect(choice.options[0]!.label).toBe('A');
    expect(choice.options[0]!.when).toBeNull();
    expect(choice.options[1]!.label).toBe('B');

    // A 有跳转 → 无追加跳转；B 无跳转 → 末尾追加 goto 到 choice 之后
    const ops = scene.instructions.map((i) => i.op);
    expect(ops).toContain('jump');

    // B 的块结束后落到 choice 之后（choice 指令之后第一个指令 = B 块开始）
    const blockB = choice.options[1]!.blockStart;
    expect(scene.instructions[blockB]!.op).toBe('jump'); // B 块的追加跳转
    const afterJump = scene.instructions[blockB] as JumpInstr;
    expect(afterJump.gotoIndex).toBe(blockB + 1);
  });

  it('goto 目标解析为标签索引', () => {
    const scene = compile(`@goto end\n凛：中间。\n@label end\n凛：结束。`);
    const gotoInstr = scene.instructions[0] as JumpInstr;
    expect(gotoInstr.gotoIndex).toBe(2);
  });

  it('goto 未定义标签抛错', () => {
    expect(() => compile('@goto ghost')).toThrow(/C002/);
    expect(() => compile('@goto ghost')).toThrow(/ghost/);
  });

  it('标签重复定义抛错', () => {
    expect(() => compile('@label a\n@label a')).toThrow(/C001/);
  });

  it('else/endif 游离抛错', () => {
    expect(() => compile('@else')).toThrow(/S003/);
    expect(() => compile('@endif')).toThrow(/S003/);
  });

  it('跨场景 jump 保留字符串目标', () => {
    const scene = compile('@jump ch01_02.start');
    const j = scene.instructions[0] as JumpInstr;
    expect(j.kind).toBe('jump');
    expect(j.target).toBe('ch01_02.start');
    expect(j.gotoIndex).toBeNull();
  });

  it('mod 增量非法抛错', () => {
    expect(() => compile('@mod trust abc')).toThrow(/C006/);
  });

  it('编译产物指令索引连续', () => {
    const scene: CompiledScene = compile(`@set a = 1\n@mod b +1\n凛：x\n@if a > 0\nY\n@endif`);
    scene.instructions.forEach((instr, i) => expect(instr.index).toBe(i));
  });

  it('顶层孤立 @elif 抛 S003', () => {
    expect(() => compile('@elif x > 1\nB\n@endif')).toThrow(/S003/);
  });

  it('超深 @if 嵌套抛 S008（而非 RangeError 栈溢出）', () => {
    const depth = 300;
    let src = '';
    for (let i = 0; i < depth; i++) src += '@if x > 0\n';
    src += '凛：x。\n';
    for (let i = 0; i < depth; i++) src += '@endif\n';
    expect(() => compile(src)).toThrow(/S008/);
    expect(() => compile(src)).toThrow(/嵌套过深/);
  });

  it('choice 选项内块指令抛 S007', () => {
    expect(() => compile('@choice\n  A -> @if x @mod t +1 @endif @goto a')).toThrow(/S007/);
    expect(() => compile('@choice\n  A -> @choice')).toThrow(/S007/);
  });

  it('用户显式 @end 编译为场景结束指令', () => {
    const scene = compile('凛：x\n@end');
    const last = scene.instructions[scene.instructions.length - 1]!;
    expect(last.op).toBe('end');
  });

  it('未知指令产生 W001 诊断', () => {
    const scene = compile('@choise abc');
    expect(scene.diagnostics.some((d) => d.code === 'W001')).toBe(true);
  });

  it('规划中未实现的指令产生 W002 诊断（不再静默无操作）', () => {
    const scene = compile('@wait 1000\n@shake');
    expect(scene.diagnostics.some((d) => d.code === 'W002')).toBe(true);
    expect(scene.diagnostics.some((d) => d.code === 'W001')).toBe(false);
  });

  it('已实现指令不产生告警', () => {
    const scene = compile('@bg castle\n@show lynn @ left\n@inc trust\n@unlock_cg cg1\n@battle fight_01');
    expect(scene.diagnostics).toHaveLength(0);
  });

  it('@call 编译为 call 指令，@return 编译为 end（不再产生 W002）', () => {
    const scene = compile('@call sub\n@return');
    expect(scene.diagnostics).toHaveLength(0);
    const call = scene.instructions.find((i) => i.op === 'call');
    expect(call).toMatchObject({ op: 'call', target: 'sub' });
    // @return→end + 文末自动追加 end
    const ends = scene.instructions.filter((i) => i.op === 'end');
    expect(ends.length).toBeGreaterThanOrEqual(2);
  });

  it('@call 支持 sceneId.label 目标且不带告警', () => {
    const scene = compile('@call ch01_02.extra');
    expect(scene.diagnostics).toHaveLength(0);
    expect(scene.instructions[0]).toMatchObject({ op: 'call', target: 'ch01_02.extra' });
  });

  it('choice 选项内联 @goto/@jump 空目标编译期抛 S006（与顶层一致）', () => {
    expect(() => compile('@choice\n  选项A -> @goto\n')).toThrow(/S006/);
    expect(() => compile('@choice\n  选项A -> @jump\n')).toThrow(/S006/);
  });

  it('引号内 @ 参数在编译链路不损坏（保留为字符串字面量）', () => {
    const scene = compile('@set email = "x@y.com"');
    const set = scene.instructions[0];
    expect(set).toMatchObject({ op: 'set', varName: 'email', expr: '"x@y.com"' });
    expect(() => compile('@if name == "雷恩"\nA\n@endif')).not.toThrow();
  });

  it('choice 选项内 @end 转场景结束指令', () => {
    const scene = compile('@choice\n  A -> @end\n');
    const ends = scene.instructions.filter((i) => i.op === 'end');
    expect(ends.length).toBeGreaterThanOrEqual(1);
  });

  it('自动追加的 end 指令定位到文件末尾行', () => {
    const scene = compile('凛：x\n凛：y');
    const end = scene.instructions[scene.instructions.length - 1]!;
    expect(end.op).toBe('end');
    expect(end.line).toBe(2);
  });
});
