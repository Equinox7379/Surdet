import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { SourceError, type SourceRange } from '../src/dsl/token.js';
import { sourceErrorIssue, validateJumpTarget, validateSwitchTargets, type LintIssue } from '../src/scene-lint.js';

function excerpt(source: string, range: SourceRange | undefined): string {
  expect(range).toBeDefined();
  expect(range!.start.line).toBe(range!.end.line);
  return source.split(/\r\n|\n|\r/)[range!.start.line - 1]!.slice(range!.start.col - 1, range!.end.col - 1);
}

function failure(source: string): LintIssue {
  try { compileScene(source, 'start.gal', 'start'); }
  catch (error) {
    expect(error).toBeInstanceOf(SourceError);
    return sourceErrorIssue(error as SourceError, 'start.gal');
  }
  throw new Error('Expected a source diagnostic');
}

describe('exact diagnostic ranges', () => {
  it.each(['\n', '\r\n', '\r'])('locates goto and loop arguments with BOM, tabs and %j line endings', eol => {
    for (const instruction of ['goto', 'loop']) {
      const row = `\t  @${instruction}\t 不存在😀e\u0301  `;
      const source = `\uFEFF@scene start${eol}${row}${eol}@end`;
      const issue = failure(source);
      expect(issue).toMatchObject({ code: 'C002', line: 2, col: 4, hint: '检查拼写或补充 @label' });
      expect(excerpt(source, issue.range)).toBe('不存在😀e\u0301');
      expect(issue.range?.start.col).toBe(row.indexOf('不存在') + 1);
    }
  });

  it('separates repeated target names in choice prose, quoted args and multiple inline calls', () => {
    const row = '\t同名 missing.入口 😀 ->  @set msg = "missing.入口 @x" @call missing.入口  @call missing.入口 @jump missing.入口';
    const source = `@scene start\n@choice\n${row}\n@end`;
    const scene = compileScene(source, 'start.gal', 'start');
    const targets = scene.instructions.filter(instruction => instruction.op === 'call' || instruction.op === 'jump');
    const issues: LintIssue[] = [];
    for (const target of targets) {
      if (target.op === 'call' || target.op === 'jump') validateJumpTarget('start', target, new Map(), new Set(), issues);
    }
    expect(issues.map(issue => excerpt(source, issue.range))).toEqual(['missing.入口', 'missing.入口', 'missing.入口']);
    expect(issues.map(issue => issue.range?.start.col)).toEqual(
      [...row.matchAll(/@(call|jump) /g)].map(match => match.index + match[0].length + 1),
    );
    expect(issues.every(issue => issue.col === 2)).toBe(true); // Existing option-row anchor stays stable.
  });

  it('keeps the first effective choice goto separate from ignored extra jumps', () => {
    const source = '@choice\n  missing 😀 -> @goto missing @goto ignored';
    const issue = failure(source);
    expect(issue.code).toBe('C002');
    expect(excerpt(source, issue.range)).toBe('missing');
    expect(issue.range?.start.col).toBe(source.split('\n')[1]!.indexOf('@goto missing') + 7);
  });

  it.each([
    ['@show "未闭合 😀', 'L004', '"未闭合 😀'],
    ['@show x @ effect="未闭合 😀', 'L004', '"未闭合 😀'],
    ['@choice\n  选😀 -> @wait 1 @set msg = "未闭合', 'L004', '"未闭合'],
    ['@set score ? 1', 'C004', '?'],
    ['@set score = 1  +', 'C005', '1  +'],
    ['@if 1  +\n@endif', 'S002', '1  +'],
    ['@choice\n  选😀 [if: 1  + ] -> @end', 'S002', '1  +'],
    ['@choice\n  选😀 -> @wait nope', 'C007', 'nope'],
    ['@mod score nope', 'C006', 'nope'],
  ])('locates %s without normalizing away physical columns', (source, code, expected) => {
    const issue = failure(source);
    expect(issue.code).toBe(code);
    expect(excerpt(source, issue.range)).toBe(expected);
  });

  it('locates duplicate label names even when they also occur in the directive keyword', () => {
    const source = '@label label\n\t@label label';
    const issue = failure(source);
    expect(issue).toMatchObject({ code: 'C001', line: 2, col: 9 });
    expect(excerpt(source, issue.range)).toBe('label');
  });

  it('locates each missing switch label, not the value or the whole directive', () => {
    const source = '@switch score 1:missing 2:other';
    const scene = compileScene(source, 'start.gal', 'start');
    const issues: LintIssue[] = [];
    validateSwitchTargets(scene, issues);
    expect(issues.map(issue => excerpt(source, issue.range))).toEqual(['missing', 'other']);
  });

  it('locates unknown inline and standalone instruction names', () => {
    const source = '@unknown "@other"\n@choice\n  选😀 -> @wait 1 @other "@unknown"';
    const scene = compileScene(source, 'start.gal', 'start');
    expect(scene.diagnostics.map(issue => excerpt(source, issue.range))).toEqual(['@unknown', '@other']);
  });

  it('does not invent ranges for positions supplied without source text', () => {
    const issues: LintIssue[] = [];
    validateJumpTarget('start', { target: 'missing', file: 'start.gal', line: 1, col: 1 }, new Map(), new Set(), issues);
    expect(issues[0]).not.toHaveProperty('range');
  });
});
