import { describe, expect, it } from 'vitest';
import { compileScene, SceneRegistry, VariableStore } from '@surdet/core';
import {
  levenshtein,
  auditSpeakers,
  auditTerminology,
  auditBranches,
  auditStats,
  dryRunProject,
  declsFromConfig,
  compileAuditEntries,
} from '../src/audit.js';

function compile(id: string, src: string) {
  return compileScene(src, id + '.gal', id);
}

describe('surdet audit：内容审计', () => {
  it('levenshtein 基础', () => {
    expect(levenshtein('凛', '凛')).toBe(0);
    expect(levenshtein('凛子', '凛于')).toBe(1);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('CONSIST_TYPO：一字之差的说话人疑似笔误', () => {
    const counts = new Map([['凛子', 5], ['凛于', 1]]);
    const findings = auditSpeakers(counts, () => ({ file: 's.gal', line: 1 }));
    expect(findings.some((f) => f.code === 'CONSIST_TYPO')).toBe(true);
  });

  it('CONSIST_HONORIFIC：前缀包含识别称谓变体', () => {
    const counts = new Map([['凛', 8], ['凛大人', 2]]);
    const findings = auditSpeakers(counts, () => ({ file: 's.gal', line: 1 }));
    expect(findings.some((f) => f.code === 'CONSIST_HONORIFIC')).toBe(true);
  });

  it('TERM_VARIANT：名词表变体扫描', () => {
    const compiled = new Map([['s1', compile('s1', '凛：我们去魔王城。')]]);
    const findings = auditTerminology(compiled, [{ canonical: '魔王城', variants: ['魔王之城'] }]);
    expect(findings).toHaveLength(0);
    const compiled2 = new Map([['s1', compile('s1', '凛：我们去魔王之城。')]]);
    const findings2 = auditTerminology(compiled2, [{ canonical: '魔王城', variants: ['魔王之城'] }]);
    expect(findings2.some((f) => f.code === 'TERM_VARIANT')).toBe(true);
  });

  it('BRANCH_THIN：选项 goto 目标块文本过少', () => {
    const src = '@choice\n  走 -> @goto a\n  留 -> @goto b\n@label a\n凛：一行。\n@end\n@label b\n凛：第一行。\n凛：第二行。\n@end';
    const compiled = new Map([['s1', compile('s1', src)]]);
    const findings = auditBranches(compiled, undefined);
    expect(findings.filter((f) => f.code === 'BRANCH_THIN')).toHaveLength(1); // 仅 a 分支空心
  });

  it('BRANCH_THIN：选项块超过 32 条指令仍能找到末尾 goto', () => {
    const filler = Array.from({ length: 33 }, (_, i) => `@set filler${i} = ${i}`).join(' ');
    const scene = compile('long-choice', `@choice\n  走 -> ${filler} @goto branch\n@label branch\n凛：一行。\n@end`);
    const findings = auditBranches(new Map([['long-choice', scene]]), undefined);
    expect(findings.filter((f) => f.code === 'BRANCH_THIN')).toHaveLength(1);
  });

  it('compileAuditEntries 暴露第二遍编译失败的文件与消息', () => {
    const result = compileAuditEntries([
      { id: 'ok', file: 'ok.gal', source: '凛：正常。' },
      { id: 'bad', file: 'bad.gal', source: '@if missing' },
    ], []);
    expect(result.compiled.has('ok')).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.file).toBe('bad.gal');
    expect(result.errors[0]!.message).toMatch(/S003|endif|闭合/);
  });

  it('NO_EXIT：无 @end 且无跳转的场景给 info', () => {
    const compiled = new Map([
      ['s1', compile('s1', '凛：甲。\n@jump s2')],
      ['s2', compile('s2', '凛：乙。')],
    ]);
    // 编译器会给每个场景自动追加 end 指令，NO_EXIT 必须按源码判断 → 传 sources
    const sources = new Map([['s1', '凛：甲。\n@jump s2'], ['s2', '凛：乙。']]);
    const findings = auditBranches(compiled, 's1', sources);
    expect(findings.some((f) => f.code === 'NO_EXIT' && f.text.includes('s2'))).toBe(true);
  });

  it.each([
    ['正文中的指令文字', '旁白：画面文字含@end但没有结束指令。', true],
    ['注释中的示例', '// @end 是说明\n旁白：仍然是无出口片段。', true],
    ['真实返回', '旁白：片段结束。\n@return', false],
    ['真实显式结束', '旁白：片段结束。\n@end', false],
    ['真实选项内结束', '@choice\n  完成 -> @end', false],
  ] as const)('NO_EXIT 核对语义出口而不是源码子串：%s', (_name, source, expected) => {
    const main = '@scene main\n@call fragment\n@end';
    const compiled = new Map([['main', compile('main', main)], ['fragment', compile('fragment', source)]]);
    const findings = auditBranches(compiled, 'main', new Map([['main', main], ['fragment', source]]));
    expect(findings.some(finding => finding.code === 'NO_EXIT' && finding.file === 'fragment.gal')).toBe(expected);
  });

  it('auditStats 节奏统计', () => {
    const compiled = new Map([['s1', compile('s1', '凛：你好。\n主角：你好。\n@choice\n  走 -> @goto a\n@label a\n@end')]]);
    const { stats, totals } = auditStats(compiled);
    expect(stats[0]!.textLines).toBe(2);
    expect(stats[0]!.choices).toBe(1);
    expect(totals.scenes).toBe(1);
    expect(totals.textLines).toBe(2);
  });
});

describe('surdet audit：无头试跑', () => {
  it('文本 + 选择肢自动推进到 @end', () => {
    const registry = new SceneRegistry();
    registry.register(compile('s1', '凛：甲。\n@choice\n  走 -> @goto a\n  留 -> @goto b\n@label a\n凛：走了。\n@end\n@label b\n凛：留了。\n@end'));
    const run = dryRunProject(registry, new VariableStore([]), 's1');
    expect(run.error).toBeNull();
    expect(run.stopped).toBe('ended');
    expect(run.choicesTaken).toBe(1);
  });

  it('连续 choice 自动推进时保留 choose 内同步产生的新选项', () => {
    const registry = new SceneRegistry();
    registry.register(compile('s1', '@choice\n  First -> @goto second\n@label second\n@choice\n  Second -> @goto done\n@label done\n@end'));
    const run = dryRunProject(registry, new VariableStore([]), 's1');
    expect(run.error).toBeNull();
    expect(run.stopped).toBe('ended');
    expect(run.choicesTaken).toBe(2);
  });

  it('遇到 @battle 系统指令停在 system', () => {
    const registry = new SceneRegistry();
    registry.register(compile('s1', '凛：开战。\n@battle demo'));
    const run = dryRunProject(registry, new VariableStore([]), 's1');
    expect(run.stopped).toBe('system');
    expect(run.error).toBeNull();
  });

  it('@wait 自动结束不阻塞', () => {
    const registry = new SceneRegistry();
    registry.register(compile('s1', '凛：甲。\n@wait 99999\n凛：乙。\n@end'));
    const run = dryRunProject(registry, new VariableStore([]), 's1');
    expect(run.stopped).toBe('ended');
  });

  it('运行时坏表达式 → stall + error（验收失败项）', () => {
    const registry = new SceneRegistry();
    registry.register(compile('s1', '@set ghost = 1\n凛：甲。\n@end'));
    const run = dryRunProject(registry, new VariableStore([]), 's1');
    expect(run.stopped).toBe('stall');
    expect(run.error).not.toBeNull();
  });

  it('declsFromConfig 宽容解析变量声明', () => {
    const decls = declsFromConfig({
      variables: {
        trust: { type: 'number', initial: 0, min: 0, max: 100 },
        bad: { type: 'mystery', initial: 1 },
        noInitial: { type: 'number' },
      },
    });
    expect(decls).toHaveLength(1);
    expect(decls[0]!.name).toBe('trust');
  });

  it('带变量声明的试跑：@set 已声明变量正常推进', () => {
    const registry = new SceneRegistry();
    registry.register(compile('s1', '@set trust = 5\n凛：甲。\n@if trust >= 5\n凛：信任足够。\n@endif\n@end'));
    const store = new VariableStore(declsFromConfig({ variables: { trust: { type: 'number', initial: 0 } } }));
    const run = dryRunProject(registry, store, 's1');
    expect(run.stopped).toBe('ended');
    expect(run.error).toBeNull();
  });
});
