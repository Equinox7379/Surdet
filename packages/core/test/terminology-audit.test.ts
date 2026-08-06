/**
 * 术语审计下沉 core 后的纯逻辑测试（原 cli 侧测试继续覆盖 CLI 路径，本组锁定 core 本体）。
 */
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import type { CompiledScene } from '@surdet/core';
import { parseTerminology, auditTerminology, auditSpeakers } from '../src/terminology-audit.js';

describe('parseTerminology', () => {
  it('合法形状解析；非法条目跳过', () => {
    const raw = {
      terms: [
        { canonical: '星辉剑', variants: ['星辉之剑', '星剑'] },
        { canonical: 123, variants: [] },          // canonical 非字符串 → 跳过
        { canonical: '缺变体' },                     // variants 缺省 → 跳过
        { canonical: '混入非字符串', variants: ['好', 42] },
      ],
    };
    const terms = parseTerminology(raw);
    expect(terms).toHaveLength(2);
    expect(terms[0]).toEqual({ canonical: '星辉剑', variants: ['星辉之剑', '星剑'] });
    expect(terms[1]).toEqual({ canonical: '混入非字符串', variants: ['好'] });
  });
  it('非对象/无 terms/非数组均返回空表', () => {
    expect(parseTerminology(null)).toEqual([]);
    expect(parseTerminology({})).toEqual([]);
    expect(parseTerminology({ terms: 'nope' })).toEqual([]);
  });
});

describe('auditTerminology', () => {
  it('台词与选项文本中的变体都被定位（带 file:line）', () => {
    const compiled = new Map<string, CompiledScene>();
    compiled.set('ch1', compileScene(
      '@scene ch1\n凛：他拔出了星辉之剑。\n@choice\n  用星剑应战 -> @goto a\n@label a\n凛：好。\n',
      'ch1.gal', 'ch1',
    ));
    const findings = auditTerminology(compiled, [{ canonical: '星辉剑', variants: ['星辉之剑', '星剑'] }]);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.code === 'TERM_VARIANT')).toBe(true);
    expect(findings[0]!.file).toBe('ch1.gal');
    expect(findings[0]!.line).toBe(2);
    expect(findings[1]!.line).toBe(4);
  });
  it('规范词本身与空变体不报', () => {
    const compiled = new Map<string, CompiledScene>();
    compiled.set('ch1', compileScene('@scene ch1\n凛：星辉剑在手。\n', 'ch1.gal', 'ch1'));
    expect(auditTerminology(compiled, [{ canonical: '星辉剑', variants: ['星剑', ''] }])).toEqual([]);
  });
});

describe('auditSpeakers（core 本体）', () => {
  it('一字符之差报 CONSIST_TYPO；前缀称谓报 CONSIST_HONORIFIC', () => {
    const counts = new Map([['凛', 5], ['凜', 1], ['凛大人', 2]]);
    const findings = auditSpeakers(counts, (s) => ({ file: `${s}.gal`, line: 1 }));
    expect(findings.some((f) => f.code === 'CONSIST_TYPO' && f.text.includes("'凛'") && f.text.includes("'凜'"))).toBe(true);
    expect(findings.some((f) => f.code === 'CONSIST_HONORIFIC' && f.text.includes('凛大人'))).toBe(true);
  });
});
