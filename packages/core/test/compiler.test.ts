import { describe, expect, it } from 'vitest';
import { compileScene, SceneCompiler, PLANNED_INSTRUCTIONS } from '../src/dsl/compiler.js';
import { findChoiceArrow, Parser } from '../src/dsl/parser.js';
import { Lexer } from '../src/dsl/lexer.js';
import { DslError } from '../src/dsl/ast.js';
import type { ChoiceInstr, CondJumpInstr, CompiledScene, JumpInstr } from '../src/dsl/ast.js';

const compile = (src: string, sceneId = 'ch01_01') => compileScene(src, 'ch01_01.gal', sceneId);

describe('Parser', () => {
  it('keeps mixed quoted condition prose and unmatched prose quotes out of action fallback bounds', () => {
    const scene = compile('@choice\n  选择 "同意 -> [if:false]" 未闭合 "文案 [if:true] -> @bg "night" @goto done\n@label done\n完成');
    const choice = scene.instructions.find(instruction => instruction.op === 'choice');
    expect(choice).toMatchObject({ options: [{ label: '选择 "同意 -> [if:false]" 未闭合 "文案', when: 'true' }] });
    expect(scene.instructions).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'instr', name: 'bg', args: ['"night"'] })]));
  });
  it.each([
    '选择 ->@set score = 1 -> @goto done',
    '选择-> @set score = 1 -> @goto done',
    'a->b 选择 ->@set score = 1 -> @goto done',
    '选择 [if:true]->@set score = 1 -> @goto done',
  ])('#63 rejects an earlier malformed arrow before a valid action: %s', row => {
    expect(() => compile(`@choice\n  ${row}\n@label done\n@end`)).toThrow(/S009/);
  });
  it.each(['选择 "->@set score = 1"', "选择 '->@set score = 1'", '选择“->@set score = 1”', '选择‘->@set score = 1’'])('#63 keeps malformed-arrow-like prose inside paired quotes: %s', label => {
    const scene = compile(`@choice\n  ${label} [if:true] -> @goto done\n@label done\n@end`);
    expect((scene.instructions.find(instruction => instruction.op === 'choice') as ChoiceInstr).options[0]).toMatchObject({ label, when: 'true' });
  });
  it.each(['@set score = 1', '@mod score 1', '@wait 1', '@video clip', '@timeline intro', '@switch score 1:done', '@loop done', '@goto done', '@jump other', '@call other', '@return', '@end'])('warns when lowering %s would discard a modifier', command => {
    const scene = compile(`${command} @unused yes\n@label done\n@end`);
    expect(scene.diagnostics.some(issue => issue.code === 'W003' && issue.message.includes('unused'))).toBe(true);
  });
  it('keeps consumed timeline blocking without warning', () => {
    expect(compile('@timeline intro @blocking\n@end').diagnostics).toEqual([]);
  });
  it.each(['@check', '@check score >'])('rejects malformed assertion expression %s at compile time', source => {
    expect(() => compile(source)).toThrow(/C005/);
  });
  it.each([
    '选择 [if:trust > 1] 后文 -> @goto done',
    '选择 [if:] -> @goto done',
    '选择 [if:trust > 1 -> @goto done',
    '选择 [if:trust > 1]-> @goto done',
    '选择-> @goto done',
    '选择 ->@goto done',
  ])('diagnoses an ignored condition or malformed action boundary: %s', row => {
    expect(() => compile(`@choice\n  ${row}\n@label done\n@end`)).toThrow(/S005|S009/);
  });
  it.each(['选择“同意 -> 继续”', '选择‘同意 -> 继续’', '显示"[if:false]"'])('keeps quoted prose literal: %s', label => {
    const scene = compile(`@choice\n  ${label} [if:true] -> @goto done\n@label done\n@end`);
    const option = (scene.instructions.find(value => value.op === 'choice') as ChoiceInstr).options[0]!;
    expect(option.label).toBe(label); expect(option.when).toBe('true');
  });
  it('rejects an action after the first choice jump rather than executing it before that jump', () => {
    expect(() => compile('@choice\n  继续 -> @set trust = 1 @goto done @set trust = 2\n@label done\n@end')).toThrow(/S010/);
  });
  it.each([
    '选 "同意 -> 继续" 这项', "选 '同意 -> 继续' 这项",
    String.raw`选 "同意 \" -> 继续" 这项`, String.raw`选 '同意 \' -> 继续' 这项`,
    '" -> @jump fake "', "Don't stop, I'm here", "James' choice",
  ])('preserves choice label %s and finds only its real action boundary', label => {
    for (const condition of ['', ' [if:" -> " == " -> "]']) {
      const row = `  ${label}${condition} -> @goto done`;
      const arrow = findChoiceArrow(row)!;
      expect(row.slice(0, arrow.index)).toBe(`  ${label}${condition}`);
      expect(row.slice(arrow.end)).toBe('@goto done');
      const scene = compile(`@choice\n${row}\n@label done\n@end`);
      expect((scene.instructions.find(value => value.op === 'choice') as ChoiceInstr).options[0]!.label).toBe(label);
    }
  });

  it('keeps quoted arrows as text without an action and rejects real malformed actions', () => {
    const label = '显示 "同意 -> 继续"';
    expect(findChoiceArrow(`  ${label}`)).toBeNull();
    expect((compile(`@choice\n  ${label}\n@end`).instructions.find(value => value.op === 'choice') as ChoiceInstr).options[0]!.label).toBe(label);
    for (const action of ['', 'not-an-instruction']) expect(() => compile(`@choice\n  ${label} -> ${action}\n@end`)).toThrow(/S009/);
    const unclosed = '未闭合的 "文案';
    expect((compile(`@choice\n  ${unclosed} -> @goto done\n@label done\n@end`).instructions.find(value => value.op === 'choice') as ChoiceInstr).options[0]!.label).toBe(unclosed);
  });

  it('rejects genuinely ambiguous prose/action boundaries with a source location', () => {
    const source = '@scene start\n@choice\n  选 " -> @bg fake " 再加 "文案 -> @bg "night" @jump accepted\n@end';
    let failure: unknown;
    try { compileScene(source, 'ambiguous.gal', 'start'); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DslError);
    expect(failure).toMatchObject({ code: 'S009', pos: { file: 'ambiguous.gal', line: 3 } });
  });

  it('still diagnoses a malformed condition after an unmatched prose quote', () => {
    expect(() => compile('@choice\n  未闭合的 "文案 [if:flag &&] -> @bg "night"\n@end')).toThrow(/S002/);
  });

  it.each(['video clip.mp4', 'loop 3 target', 'switch score 1:target'])('rejects unsupported inline control rather than emitting an inert generic instruction (%s)', instruction => {
    expect(() => compile(`@choice\n  继续 -> @${instruction}\n@label target\n@end`)).toThrow(/S010/);
  });
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
    expect(top.branches.map((branch) => ({ kind: branch.kind, expr: branch.expr }))).toEqual([
      { kind: 'if', expr: 'a > 1' },
      { kind: 'elif', expr: 'b > 1' },
      { kind: 'else', expr: null },
    ]);
    expect(top.span).toMatchObject({ start: { line: 1 }, end: { line: 7 } });
    expect(top.branches.map((branch) => [branch.span.start.line, branch.span.end.line])).toEqual([
      [1, 3], [3, 5], [5, 7],
    ]);
    expect(top.branches[1]!.bodySpan).toMatchObject({ start: { line: 4 }, end: { line: 5 } });
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
    expect(c.span).toMatchObject({ start: { line: 1 }, end: { line: 5 } });
    expect(c.options[0]!.span).toMatchObject({
      start: { line: 2 },
      end: { line: 2, col: '  选项A -> @goto a'.length + 1 },
    });
  });

  it('choice 条件字符串内的箭头不作为外层分隔符', () => {
    const ast = new Parser().parse(
      new Lexer().tokenize('@choice\n  选项 [if: route == "a -> b"] -> @goto done\n@label done\n@end', 't.gal'),
      's',
    );
    const choice = ast.blocks[0];
    if (choice?.kind !== 'choice') throw new Error('expect choice');
    expect(choice.options[0]).toMatchObject({
      label: '选项',
      when: 'route == "a -> b"',
      jump: { kind: 'goto', target: 'done' },
    });
  });

  it('choice 外层标签撇号不吞箭头，条件字符串转义仍保留边界', () => {
    const source = String.raw`@choice
  Don't stop -> @goto done
  转义条件 [if: route == "a \" -> b"] -> @goto done
@label done
@end`;
    const ast = new Parser().parse(new Lexer().tokenize(source, 't.gal'), 's');
    const choice = ast.blocks[0];
    if (choice?.kind !== 'choice') throw new Error('expect choice');
    expect(choice.options).toMatchObject([
      { label: "Don't stop", when: null, jump: { kind: 'goto', target: 'done' } },
      { label: '转义条件', when: 'route == "a \\" -> b"', jump: { kind: 'goto', target: 'done' } },
    ]);
  });

  it('nested conditions keep independent branch boundaries', () => {
    const src = [
      '@if outer',
      '// then comment',
      '@if inner',
      '内层真',
      '@else',
      '内层假',
      '@endif',
      '@elif fallback',
      '后备',
      '@else',
      '兜底',
      '@endif',
    ].join('\n');
    const ast = new Parser().parse(new Lexer().tokenize(src, 'nested.gal'), 's');
    const outer = ast.blocks[0]!;
    if (outer.kind !== 'if') throw new Error('expect outer if');
    expect(outer.branches.map((branch) => [branch.kind, branch.span.start.line, branch.span.end.line])).toEqual([
      ['if', 1, 8], ['elif', 8, 10], ['else', 10, 12],
    ]);
    const inner = outer.branches[0]!.blocks[0]!;
    if (inner.kind !== 'if') throw new Error('expect inner if');
    expect(inner.span).toMatchObject({ start: { line: 3 }, end: { line: 7 } });
    expect(inner.branches.map((branch) => [branch.kind, branch.span.start.line, branch.span.end.line])).toEqual([
      ['if', 3, 5], ['else', 5, 7],
    ]);
  });

  it('choice 无缩进选项抛错', () => {
    expect(() => compile('@choice\n未缩进的选项')).toThrow(/S004/);
  });

  it('bare CR source keeps structural line positions', () => {
    const ast = new Parser().parse(new Lexer().tokenize('@if flag\rA\r@else\rB\r@endif', 'cr.gal'), 's');
    const condition = ast.blocks[0]!;
    if (condition.kind !== 'if') throw new Error('expect if');
    expect(condition.span).toMatchObject({ start: { line: 1 }, end: { line: 5 } });
    expect(condition.branches.map((branch) => [branch.kind, branch.span.start.line, branch.span.end.line])).toEqual([
      ['if', 1, 3], ['else', 3, 5],
    ]);
  });
});

describe('SceneCompiler', () => {
  it('@transition 保留名称与参数，供渲染层注册表消费', () => {
    const scene = compile('@transition slide-left 600');
    expect(scene.instructions[0]).toMatchObject({ op: 'instr', name: 'transition', args: ['slide-left', '600'] });
  });

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

  it('R2 @wait 编译为 WaitInstr；非法参数抛 C007', () => {
    const ok = compileScene('@wait 800', 's.gal', 'w');
    const instr = ok.instructions[0]!;
    expect(instr.op).toBe('wait');
    expect((instr as { ms?: number }).ms).toBe(800);
    // 末尾自动追加 end
    expect(ok.instructions.at(-1)!.op).toBe('end');

    for (const bad of ['@wait', '@wait abc', '@wait -5', '@wait 1.5', '@wait 99999999']) {
      expect(() => compileScene(bad, 's.gal', 'w')).toThrow(/C007/);
    }
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

  it('单个 @if 的超长 elif 链抛可定位 S008（而非 legacy else 栈溢出）', () => {
    const branchCount = 201;
    const lines: string[] = [];
    for (let i = 0; i < branchCount; i++) {
      lines.push(`${i === 0 ? '@if' : '@elif'} flag_${i}`);
      lines.push(`分支${i}`);
    }
    lines.push('@endif');
    const source = lines.join('\n');

    expect(() => compile(source)).toThrow(/S008/);
    expect(() => compile(source)).toThrow(/分支过多/);
    expect(() => compile(source)).toThrow(/ch01_01\.gal:401:1/);
  });

  it('组合 if/elif 深度超过 200 抛 S008，而不是 compiler RangeError', () => {
    const layers = 40;
    const branchesPerLayer = 120;
    const lines: string[] = [];
    for (let layer = 0; layer < layers; layer += 1) {
      for (let branch = 0; branch < branchesPerLayer; branch += 1) {
        lines.push(`${branch === 0 ? '@if' : '@elif'} layer_${layer}_${branch}`);
        if (branch < branchesPerLayer - 1) lines.push(`正文_${layer}_${branch}`);
      }
    }
    lines.push('最深正文');
    for (let layer = layers - 1; layer >= 0; layer -= 1) lines.push('@endif');

    expect(() => compile(lines.join('\n'))).toThrow(/S008/);
    expect(() => compile(lines.join('\n'))).toThrow(/组合嵌套过深/);
  });

  it('单个条件链 200 个分支仍保持原有编译语义', () => {
    const branchCount = 200;
    const lines: string[] = [];
    for (let i = 0; i < branchCount; i += 1) {
      lines.push(`${i === 0 ? '@if' : '@elif'} flag_${i}`);
      lines.push(`分支${i}`);
    }
    lines.push('@endif');
    const scene = compile(lines.join('\n'));
    expect(scene.instructions.some((instruction) => instruction.op === 'condJump')).toBe(true);
    expect(scene.instructions.at(-1)?.op).toBe('end');
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

  it('reports unsupported @ruby while retaining explicit inline ruby and declared custom commands', () => {
    expect(compile('@ruby test').diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'W001' })]));
    expect(compile('凛：<ruby=せかい>世界</ruby>和《书名》').diagnostics).toEqual([]);
    expect(compileScene('@ruby test', 'custom.gal', 'custom', ['ruby']).diagnostics).toEqual([]);
  });

  it('原规划指令（particle/mov/tint/clear）全部已实现，不再产生 W002', () => {
    const scene = compile('@particle snow\n@mov lynn left\n@tint off\n@clear good_end');
    expect(scene.diagnostics).toHaveLength(0);
    // PLANNED 集合已空：全部已知指令均有运行时行为，W002 机制保留供后续声明未实现指令
    expect(PLANNED_INSTRUCTIONS.size).toBe(0);
  });

  it('演出三件套（particle/mov/tint）已实现，不再产生告警', () => {
    const scene = compile('@particle snow\n@mov lynn left\n@tint 0xff8866 0.3');
    expect(scene.diagnostics).toHaveLength(0);
  });

  it('R2 新实现的演出指令（wait/shake/flash/zoom）不再产生告警', () => {
    const scene = compile('@wait 1000\n@shake\n@flash\n@zoom 1.2');
    expect(scene.diagnostics).toHaveLength(0);
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

  it('choice 箭头后缺少 @ 时编译期抛 S009', () => {
    expect(() => compile('@choice\n  A ->\n')).toThrow(/S009/);
    expect(() => compile('@choice\n  A -> goto target\n')).toThrow(/S009/);
    expect(() => compile('@choice\n  A -> text @goto target\n')).toThrow(/S009/);
  });

  it('choice 箭头后以 @ 开头的内联动作继续合法', () => {
    expect(() => compile('@choice\n  A -> @goto target\n@label target\n')).not.toThrow();
  });

  it('自动追加的 end 指令定位到文件末尾行', () => {
    const scene = compile('凛：x\n凛：y');
    const end = scene.instructions[scene.instructions.length - 1]!;
    expect(end.op).toBe('end');
    expect(end.line).toBe(2);
  });
});
