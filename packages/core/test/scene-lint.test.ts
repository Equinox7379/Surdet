import { describe, expect, it } from 'vitest';
import { parseVariableConfig, validateVarDecl, validateSceneVariables, type LintIssue } from '../src/scene-lint.js';
import { compileScene } from '../src/dsl/compiler.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { VarDeclaration, VarValue } from '../src/state/types.js';

function lintDeclaration(name: string, decl: unknown): { valid: boolean; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  return { valid: validateVarDecl('game.config.json', name, decl, issues), issues };
}

describe('scene-lint 变量声明校验', () => {
  it('checks inventory/random targets and has_item result writes', () => {
    const scene = compileScene('@add_item missing potion\n@remove_item missing potion\n@random missing 1 3\n@has_item bag potion fixed', 'scene.gal', 'scene');
    const issues: LintIssue[] = [];
    validateSceneVariables(scene, new Set(['bag', 'fixed']), new Map([['bag', 'string[]'], ['fixed', 'boolean']]), new Set(['fixed']), issues, true);
    expect(issues.filter(issue => issue.code === 'V001')).toHaveLength(3);
    expect(issues.some(issue => issue.text.includes('fixed') && issue.text.includes('readonly'))).toBe(true);
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

  it('与 VariableStore 一致拒绝 number 的非有限 min/max，但保留初值越界行为', () => {
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

    const outOfRange = { name: 'score', type: 'number', initial: 999, max: 100 } as VarDeclaration;
    expect(lintDeclaration(outOfRange.name, outOfRange).valid).toBe(true);
    const store = new VariableStore([outOfRange]);
    expect(store.getNumber('score')).toBe(999);
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
