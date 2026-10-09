import { describe, expect, it } from 'vitest';
import { validateProject } from '../src/validate.js';

describe('Editor diagnostic range projection', () => {
  it.each([
    ['@goto missing', 'C002', 'missing'],
    ['@jump start.missing', 'J002', 'start.missing'],
    ['@unknown x', 'W001', '@unknown'],
    ['@show "unclosed', 'L004', '"unclosed'],
  ])('preserves the range of %s from the actual validation input', async (row, code, expected) => {
    const validate = (source: string) => validateProject([{ id: 'start', key: 'start', file: 'start.gal', source }], 'start', {
      raw: { entryScene: 'start', variables: {} }, path: 'game.config.json',
    });
    const original = `@scene start\r\n  ${row}`;
    const result = await validate(original);
    const issue = result.issues.find(issue => issue.code === code)!;
    expect(issue.range).toBeDefined();
    expect(issue.range?.start.line).toBe(2);
    expect(original.split('\r\n')[1]!.slice(issue.range!.start.col - 1, issue.range!.end.col - 1)).toBe(expected);
    // A new validation owns its new positions; it must not mutate the older result.
    const next = await validate(`\r\n${original}`);
    expect(next.issues.find(issue => issue.code === code)?.range?.start.line).toBe(3);
    expect(issue.range?.start.line).toBe(2);
  });
});
