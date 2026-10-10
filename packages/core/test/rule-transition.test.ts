import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { decodeStageToken } from '../src/stage.js';
import { checkConsumedModifiers, type LintIssue } from '../src/scene-lint.js';
import { parseRuleTransition } from '../src/transition.js';

describe('rule transition syntax', () => {
  it.each([
    ['@rule=mask', { rule: 'mask', soft: .15, reverse: false }],
    ['@rule "遮罩 @左" @soft=0 @reverse', { rule: '遮罩 @左', soft: 0, reverse: true }],
    ["@rule='mask name' @soft 1 @reverse=false", { rule: 'mask name', soft: 1, reverse: false }],
  ])('decodes actual DSL modifiers: %s', (modifiers, expected) => {
    const instruction = compileScene(`@transition "rule" 800 ${modifiers}`, 'rule.gal', 'rule').instructions[0]!;
    expect(instruction.op).toBe('instr');
    if (instruction.op !== 'instr') throw new Error('expected instruction');
    expect(parseRuleTransition(new Map([...instruction.modifiers].map(([key, value]) => [key, decodeStageToken(value)])))).toEqual(expected);
    const issues: LintIssue[] = []; checkConsumedModifiers(instruction, issues);
    expect(issues).toEqual([]);
  });
  it.each(['', '@rule=mask @soft=', '@rule=mask @soft=NaN', '@rule=mask @soft=-1', '@rule=mask @soft=1.1', '@rule=mask @reverse=maybe'])('rejects invalid rule options: %s', modifiers => {
    expect(() => compileScene(`@transition rule 800 ${modifiers}`, 'rule.gal', 'rule')).toThrow(/遮罩|reverse/);
  });
});
