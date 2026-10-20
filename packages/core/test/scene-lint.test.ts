import { describe, expect, it } from 'vitest';
import { parseVariableConfig, validateVarDecl, validateSceneVariables, validateTransitionInstructions, checkConsumedModifiers, type LintIssue } from '../src/scene-lint.js';
import { BUILTIN_TRANSITION_NAMES } from '../src/transition.js';
import { compileScene } from '../src/dsl/compiler.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration, VarValue } from '../src/state/types.js';

function lintDeclaration(name: string, decl: unknown): { valid: boolean; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  return { valid: validateVarDecl('game.config.json', name, decl, issues), issues };
}

describe('scene-lint 变量声明校验', () => {
  it('reports check references/types and nonnumeric mod targets before running', () => {
    const scene = compileScene('@check absent > 1\n@check 1\n@mod text 2\n@mod score 2\n@check score > 0', 'checks.gal', 'checks');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(['text', 'score']), new Map([['text', 'string'], ['score', 'number']]), new Set(), issues, true);
    expect(issues.map(issue => [issue.code, issue.line])).toEqual([['V002', 1], ['T002', 2], ['T001', 3]]);
  });
  it('accepts every shared builtin transition and rejects an unknown one', () => {
    const scene = compileScene(BUILTIN_TRANSITION_NAMES.map(name => `@transition ${name} 800${name === 'rule' ? ' @rule=mask' : ''}`).join('\n') + '\n@transition unknown', 'scene.gal', 'scene');
    const issues: LintIssue[] = []; validateTransitionInstructions(scene, issues);
    expect(issues).toHaveLength(1); expect(issues[0]).toMatchObject({ code: 'T010', line: BUILTIN_TRANSITION_NAMES.length + 1 });
    expect(issues[0]!.hint).toContain('dissolve');
  });
  it('checks references and constant condition types even when the declaration table is empty', () => {
    const scene = compileScene('@set ghost = 1\n{missing}\n@if 1\n文本\n@endif\n', 'empty.gal', 'empty');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(), new Map(), new Set(), issues, true);
    expect(issues.some(issue => issue.code === 'V001' && issue.line === 1)).toBe(true);
    expect(issues.some(issue => issue.code === 'V002' && issue.line === 2)).toBe(true);
    expect(issues.some(issue => issue.code === 'T002' && issue.line === 3)).toBe(true);
    const noConfig: LintIssue[] = [];
    validateSceneVariables(scene, new Set(), new Map(), new Set(), noConfig, false);
    expect(noConfig).toEqual([]);
  });

  it('recognizes consumed stage modifiers while still warning for ignored show modifiers', () => {
    const scene = compileScene('@show lynn normal @instance left_actor @scale 1.2 @facing left\n@pose left_actor @x 100 @duration 200\n@layer far mist @z 1\n@stage opening @keepActors true\n@show lynn @zoom 2\n', 'stage.gal', 'stage');
    const issues: LintIssue[] = [];
    for (const instruction of scene.instructions) {
      if (instruction.op === 'instr') checkConsumedModifiers(instruction, issues);
    }
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'W003', line: 5 });
    expect(issues[0]?.text).toContain('zoom');
  });
  it('checks inventory/random targets and has_item result writes', () => {
    const scene = compileScene('@add_item missing potion\n@remove_item missing potion\n@random missing 1 3\n@has_item bag potion fixed', 'scene.gal', 'scene');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(['bag', 'fixed']), new Map([['bag', 'string[]'], ['fixed', 'boolean']]), new Set(['fixed']), issues, true);
    expect(issues.filter(issue => issue.code === 'V001')).toHaveLength(3);
    expect(issues.some(issue => issue.text.includes('fixed') && issue.text.includes('readonly'))).toBe(true);
  });

  it.each(['string', 'number[]', 'object'])('A001 has_item lint 拒绝 %s 来源', (type) => {
    const scene = compileScene('@has_item bag app has', 'inventory.gal', 'inventory');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(['bag', 'has']), new Map([['bag', type], ['has', 'boolean']]), new Set(), issues, true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'T001', file: 'inventory.gal', line: 1 });
    expect(issues[0]!.text).toContain('来源');
    expect(issues[0]!.text).toContain('string[]');
  });

  it.each(['boolean', 'flag'])('A001 has_item lint 接受 string[] 来源和 %s 结果', (type) => {
    const scene = compileScene('@has_item bag apple has', 'inventory.gal', 'inventory');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(['bag', 'has']), new Map([['bag', 'string[]'], ['has', type]]), new Set(['bag']), issues, true);
    expect(issues).toEqual([]);
  });

  it('A001 has_item lint 拒绝错误类型结果并保留 readonly 和未声明诊断', () => {
    const scene = compileScene('@has_item bag apple has\n@has_item missing apple absent', 'inventory.gal', 'inventory');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(['bag', 'has']), new Map([['bag', 'string[]'], ['has', 'number']]), new Set(['has']), issues, true);
    expect(issues.filter(issue => issue.code === 'T001')).toHaveLength(1);
    expect(issues.find(issue => issue.code === 'T001')!.text).toContain('结果');
    expect(issues.filter(issue => issue.code === 'V003')).toHaveLength(1);
    expect(issues.filter(issue => issue.code === 'V001')).toHaveLength(2);
  });
  it('与 VariableStore 一致拒绝嵌套非法值，并接受合法嵌套数组对象', () => {
    const invalidValues = [
      Object.fromEntries([['nested', null]]) as unknown as VarValue,
      Object.fromEntries([['nested', Infinity]]) as unknown as VarValue,
    ];

    for (const initial of invalidValues) {
      const decl = { name: 'cfg', type: 'object', initial } as VarDeclaration;
      const lint = lintDeclaration(decl.name, decl);
      expect(lint.valid).toBe(false);
      expect(lint.issues).toHaveLength(1);
      expect(lint.issues[0]).toMatchObject({
        code: 'VAR_DECL',
        file: 'game.config.json',
        line: 0,
        col: 0,
      });
      expect(() => new VariableStore([decl])).toThrow(TypeError);
    }

    const legalInitial = Object.fromEntries([
      ['__proto__', { values: [1, 2, { ok: true }] }],
      ['nested', [{ label: 'a' }, { label: 'b' }]],
    ]) as unknown as VarValue;
    const legalDecl = { name: '__proto__', type: 'object', initial: legalInitial } as VarDeclaration;
    const legalLint = lintDeclaration(legalDecl.name, legalDecl);
    expect(legalLint.valid).toBe(true);
    expect(legalLint.issues).toEqual([]);
    expect(() => new VariableStore([legalDecl])).not.toThrow();
  });

  it('A002 与 VariableStore 一致拒绝 number 的非有限 min/max 和越界初值', () => {
    for (const bound of [
      { min: Infinity },
      { max: -Infinity },
      { min: NaN },
    ]) {
      const decl = { name: 'score', type: 'number', initial: 0, ...bound } as VarDeclaration;
      const lint = lintDeclaration(decl.name, decl);
      expect(lint.valid).toBe(false);
      expect(lint.issues[0]).toMatchObject({ code: 'VAR_DECL', file: 'game.config.json', line: 0, col: 0 });
      expect(() => new VariableStore([decl])).toThrow();
    }

    for (const decl of [
      { name: 'score', type: 'number', initial: 999, max: 100 },
      { name: 'score', type: 'number', initial: -1, min: 0 },
    ] satisfies VarDeclaration[]) {
      const lint = lintDeclaration(decl.name, decl);
      expect(lint.valid).toBe(false);
      expect(lint.issues).toHaveLength(1);
      expect(lint.issues[0]).toMatchObject({ code: 'VAR_DECL' });
      expect(lint.issues[0]!.text).toContain('initial');
      expect(() => new VariableStore([decl])).toThrow(/initial/);
    }
  });

  it('parseVariableConfig 保留合法的 __proto__ 变量名并保持问题定位', () => {
    const variables = Object.fromEntries([
      ['__proto__', { type: 'number', initial: 7 }],
      ['broken', { type: 'number', initial: 'oops' }],
    ]);
    const issues: LintIssue[] = [];
    const parsed = parseVariableConfig({ variables }, 'game.config.json', issues);

    expect(parsed.variables.has('__proto__')).toBe(true);
    expect(parsed.types.get('__proto__')).toBe('number');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'VAR_DECL',
      file: 'game.config.json',
      line: 0,
      col: 0,
    });
    expect(issues[0]?.text).toContain("变量 'broken'");
  });
});
