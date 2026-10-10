import { describe, expect, it } from 'vitest';
import { parseRuby } from '../src/ruby.js';
import { layoutRuby } from '../src/ruby-layout.js';

const mono = {
  base: (text: string): number => text.length * 10,
  ruby: (text: string): number => text.length * 5,
};

describe('layoutRuby', () => {
  it('respects hard breaks around ruby and does not attach the preceding paragraph as its base', () => {
    const layout = layoutRuby(parseRuby('前文\n\n<ruby=うみ>海</ruby>へ\n帰る'), 100, mono, 40);
    expect(layout.map(({ base, ruby, line }) => ({ base, ruby, line }))).toEqual([
      { base: '前文', ruby: undefined, line: 0 },
      { base: '海', ruby: 'うみ', line: 2 },
      { base: 'へ', ruby: undefined, line: 2 },
      { base: '帰る', ruby: undefined, line: 3 },
    ]);
  });
  it('keeps ruby segments together and wraps them as units', () => {
    expect(layoutRuby(parseRuby('<ruby=こう>甲</ruby><ruby=おつ>乙</ruby>'), 15, mono, 40).map((item) => item.line))
      .toEqual([0, 1]);
  });

  it('allows one oversized ruby segment without looping or truncating', () => {
    expect(layoutRuby(parseRuby('<ruby=ちょうちょうご>超长语</ruby>'), 5, mono, 40)).toHaveLength(1);
  });

  it('keeps plain text lossless around ruby segments', () => {
    expect(layoutRuby(parseRuby('<ruby=こう>甲</ruby>乙'), 100, mono).map((item) => item.base).join(''))
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
