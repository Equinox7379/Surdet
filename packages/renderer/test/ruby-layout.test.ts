import { describe, expect, it } from 'vitest';
import { parseRuby } from '../src/ruby.js';
import { layoutRuby } from '../src/ruby-layout.js';

const mono = {
  base: (text: string): number => text.length * 10,
  ruby: (text: string): number => text.length * 5,
};

describe('layoutRuby', () => {
  it('keeps ruby segments together and wraps them as units', () => {
    expect(layoutRuby(parseRuby('甲《こう》乙《おつ》'), 15, mono, 40).map((item) => item.line))
      .toEqual([0, 1]);
  });

  it('allows one oversized ruby segment without looping or truncating', () => {
    expect(layoutRuby(parseRuby('超长语《ちょうちょうご》'), 5, mono, 40)).toHaveLength(1);
  });

  it('keeps plain text lossless around ruby segments', () => {
    expect(layoutRuby(parseRuby('甲《こう》乙'), 100, mono).map((item) => item.base).join(''))
      .toBe('甲乙');
  });

  it('applies CJK line-start prohibition to plain segments', () => {
    const layout = layoutRuby(parseRuby('甲甲，乙丙'), 20, mono, 40);
    const lines = new Map<number, string>();
    for (const item of layout) lines.set(item.line, `${lines.get(item.line) ?? ''}${item.base}`);
    expect([...lines.values()].slice(1).every((line) => !'，。！？'.includes(line[0] ?? ''))).toBe(true);
    expect([...lines.values()].join('')).toBe('甲甲，乙丙');
  });
});
