import { describe, expect, it } from 'vitest';
import { checkConsumedModifiers, compileScene, decodeStageToken, parseRuleTransition, validateTimeline, type LintIssue } from '@surdet/core';
import { instructionModifiers, setInstructionModifier } from '../src/v4/script-source.js';
import { readTransition, writeEffectDuration, writeRuleReverse, writeRuleSoft, writeTransitionName } from '../src/v4/presentation-effect-source.js';
import { resolvedRuleKeys } from '../src/presentation-effects.js';
import { instructionArgumentSummary, instructionLabel } from '../src/script-presentation.js';
import { createNeutralCue, TIMELINE_ACTIONS } from '../src/timeline-model.js';
import type { DirAsset } from '../src/assets.js';

/** The line as Core compiles it: the mask options a rule transition consumes, and any modifier left unconsumed. */
function compiled(raw: string): { rule: ReturnType<typeof parseRuleTransition> | null; issues: LintIssue[] } {
  const instruction = compileScene(raw, 'effects.gal', 'effects').instructions[0]!;
  if (instruction.op !== 'instr') throw new Error('expected an instruction');
  const issues: LintIssue[] = [];
  checkConsumedModifiers(instruction, issues);
  const decoded = new Map([...instruction.modifiers].map(([key, value]) => [key, decodeStageToken(value)]));
  return { rule: decodeStageToken(instruction.args[0] ?? '') === 'rule' ? parseRuleTransition(decoded) : null, issues };
}
const asset = (sourcePath: string): DirAsset => ({ key: sourcePath.split('/').at(-1)!.replace(/\.[^.]+$/, ''), kind: 'rule', sourcePath, isImage: true, handle: null });

describe('instruction modifiers', () => {
  it('reads modifiers decoded as Core does, quoted or bare', () => {
    expect([...instructionModifiers('@transition rule 800 @rule="百叶窗 遮罩" @soft=.2 @reverse')])
      .toEqual([['rule', '百叶窗 遮罩'], ['soft', '.2'], ['reverse', '']]);
  });
  it('adds, replaces and removes one modifier, keeping the rest of the line as written', () => {
    expect(setInstructionModifier('@transition rule 800', 'rule', '百叶窗 遮罩')).toBe('@transition rule 800 @rule="百叶窗 遮罩"');
    expect(setInstructionModifier('@transition rule 800 @rule=a  @soft=.2', 'rule', 'b')).toBe('@transition rule 800 @rule=b  @soft=.2');
    expect(setInstructionModifier('@transition rule 800 @rule "a b" @soft=.2', 'rule', 'c')).toBe('@transition rule 800 @rule=c @soft=.2');
    expect(setInstructionModifier('@transition rule 800 @rule=a @soft=.2 @reverse', 'soft', null)).toBe('@transition rule 800 @rule=a @reverse');
    expect(setInstructionModifier('\t@transition rule 800 @rule=a @reverse  ', 'reverse', null)).toBe('\t@transition rule 800 @rule=a  ');
    expect(setInstructionModifier('@transition rule 800 @rule=a', 'reverse', true)).toBe('@transition rule 800 @rule=a @reverse');
    expect(setInstructionModifier('@transition rule 800 @rulex=1', 'rule', 'a')).toBe('@transition rule 800 @rulex=1 @rule=a');
    expect(setInstructionModifier('@transition fade 600', 'soft', null)).toBe('@transition fade 600');
    expect(() => setInstructionModifier('@transition rule 800 @rule=a @rule=b', 'rule', 'c')).toThrow(/多个 @rule/);
  });
});

describe('transition and filter source edits', () => {
  it('switches to a mask transition with a mask, and the line compiles with every option consumed', () => {
    let raw = writeTransitionName('@transition fade 600', 'rule', '百叶窗 遮罩');
    expect(raw).toBe('@transition rule 600 @rule="百叶窗 遮罩"');
    expect(compiled(raw)).toEqual({ rule: { rule: '百叶窗 遮罩', soft: .15, reverse: false }, issues: [] });
    raw = writeRuleReverse(writeRuleSoft(raw, '0.3'), true);
    expect(raw).toBe('@transition rule 600 @rule="百叶窗 遮罩" @soft=0.3 @reverse');
    expect(compiled(raw)).toEqual({ rule: { rule: '百叶窗 遮罩', soft: .3, reverse: true }, issues: [] });
    expect(readTransition(raw)).toEqual({ name: 'rule', durationMs: '600', rule: '百叶窗 遮罩', soft: '0.3', reverse: true });
    expect(writeRuleReverse(raw, false)).toBe('@transition rule 600 @rule="百叶窗 遮罩" @soft=0.3');
    // Already a mask transition: the chosen mask stays.
    expect(writeTransitionName(raw, 'rule', 'other')).toBe(raw);
  });
  it('drops the mask options for another effect, so nothing is left unconsumed', () => {
    const raw = writeTransitionName('@transition rule 600 @rule=a @soft=0.3 @reverse', 'dissolve');
    expect(raw).toBe('@transition dissolve 600');
    expect(compiled(raw)).toEqual({ rule: null, issues: [] });
  });
  it('refuses a mask transition without an imported mask, and lengths and edges out of range', () => {
    expect(() => writeTransitionName('@transition fade 600', 'rule')).toThrow(/转场遮罩/);
    expect(() => writeEffectDuration('@transition fade 600', 'fade', '0', 1, 10000)).toThrow(/1–10000/);
    expect(() => writeEffectDuration('@transition fade 600', 'fade', '10001', 1, 10000)).toThrow(/1–10000/);
    expect(() => writeEffectDuration('@transition fade 600', 'fade', '2.5', 1, 10000)).toThrow();
    expect(() => writeRuleSoft('@transition rule 600 @rule=a', '1.5')).toThrow(/0–1/);
  });
  it('writes a length as the second argument, naming the effect first when the line has none', () => {
    expect(writeEffectDuration('@transition', 'fade', '800', 1, 10000)).toBe('@transition fade 800');
    expect(writeEffectDuration('@transition dissolve 600', 'fade', '1200', 1, 10000)).toBe('@transition dissolve 1200');
    const filter = writeEffectDuration('@filter grayscale', 'off', '600', 0, 600000);
    expect(filter).toBe('@filter grayscale 600');
    expect(() => compileScene(filter, 'effects.gal', 'effects')).not.toThrow();
  });
  it('shows the effects in Chinese while the script keeps the Core values', () => {
    expect(instructionLabel('filter')).toBe('画面滤镜');
    expect(instructionArgumentSummary('transition', ['rule', '800'])).toBe('遮罩  800 毫秒');
    expect(instructionArgumentSummary('transition', ['dissolve'])).toBe('溶解');
    expect(instructionArgumentSummary('filter', ['grayscale', '600'])).toBe('灰度  600 毫秒过渡');
    expect(instructionArgumentSummary('filter', ['off', '0'])).toBe('清除');
  });
});

describe('transition masks', () => {
  it('offers only the masks project.assets.rules resolves: supported, unique images', () => {
    expect(resolvedRuleKeys([
      asset('content/assets/rule/百叶窗 遮罩.png'), asset('content/assets/rule/radial.webp'),
      asset('content/assets/rule/notes.txt'), asset('content/assets/rule/twice.png'), asset('content/assets/rule/twice.jpg'),
      { ...asset('content/assets/bg/room.png'), kind: 'bg' },
    ])).toEqual(['radial', '百叶窗 遮罩']);
  });
  it('creates timeline screen dissolve and mask cues the shared validation accepts', () => {
    expect(TIMELINE_ACTIONS.screen).toEqual(['fade', 'tint', 'flash', 'wipe', 'dissolve', 'rule']);
    expect(createNeutralCue('screen', 'rule')).toBeNull();
    const dissolve = createNeutralCue('screen', 'dissolve')!.cue, rule = createNeutralCue('screen', 'rule', '百叶窗')!.cue;
    expect(rule).toMatchObject({ action: 'rule', rule: '百叶窗' });
    const tracks = [{ kind: 'screen' as const, cues: [dissolve, { ...rule, soft: 0, reverse: true }] }];
    expect(validateTimeline({ version: 1, id: 'cut', durationMs: 1200, tracks })).toEqual([]);
  });
});
