import { describe, expect, it } from 'vitest';
import { changedLines, textLines } from '../src/line-diff.js';

const marked = (left: string[], right: string[]) => {
  const marks = changedLines(left, right);
  return { left: left.filter((_, index) => marks.left[index]), right: right.filter((_, index) => marks.right[index]) };
};

describe('history line comparison', () => {
  it('marks swapped lines even though the same texts occur on both sides', () => {
    expect(marked(['第一句对白。', '第二句对白。'], ['第二句对白。', '第一句对白。'])).toEqual({ left: ['第一句对白。'], right: ['第一句对白。'] });
  });

  it('counts repeated lines by position', () => {
    expect(marked(['@bg harbor', '凛：嗯。', '凛：嗯。', '@end'], ['@bg harbor', '凛：嗯。', '@end'])).toEqual({ left: ['凛：嗯。'], right: [] });
    expect(marked(['A', 'B', 'A'], ['B', 'A', 'B'])).toEqual({ left: ['A'], right: ['B'] });
  });

  it('marks nothing for identical text and everything against a missing side', () => {
    expect(marked(['A', 'B'], ['A', 'B'])).toEqual({ left: [], right: [] });
    expect(marked(['A', 'B'], [])).toEqual({ left: ['A', 'B'], right: [] });
  });

  it('marks the whole differing middle of very large files instead of missing a change', () => {
    const left = Array.from({ length: 2500 }, (_, index) => `L${index}`);
    const right = [...left].reverse();
    const marks = changedLines(left, right);
    expect(marks.left.every(Boolean)).toBe(true);
    expect(marks.right.every(Boolean)).toBe(true);
  });

  it('splits lines like the history view, without an empty final row', () => {
    expect(textLines('A\r\nB\n')).toEqual(['A', 'B']);
    expect(textLines('A\rB')).toEqual(['A', 'B']);
  });
});
