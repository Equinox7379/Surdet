import { describe, expect, it } from 'vitest';
import { parseInlineText } from '@surdet/core';
import { layoutInlineText, revealInlineRun } from '../src/inline-text-layout.js';

const measure = (text: string, style: { size?: number }, ruby: boolean) => Array.from(text).length * 10 * (style.size ?? 1) * (ruby ? 0.5 : 1);
describe('行内文字完整排版与局部揭示', () => {
  it('keeps large closing punctuation inside the clipped viewport by moving its preceding character', () => {
    const document = parseInlineText('<size=2>甲乙丙丁，戊己庚辛。</size>');
    const layout = layoutInlineText(document, 80, 10, measure);
    expect(layout.width).toBeLessThanOrEqual(80);
    expect(layout.runs.map(run => revealInlineRun(run, Infinity)).join('')).toBe(document.plainText);
    for (const run of layout.runs) expect(['，', '。']).not.toContain(run.units[0]!.text);
  });
  it('样式参与测量且逐字揭示不改变已确定的换行位置', () => {
    const document = parseInlineText('甲<size=2>乙丙</size>丁');
    const layout = layoutInlineText(document, 30, 10, measure);
    const initial = layout.runs.map(run => [run.x, run.y]);
    expect(layout.runs.map(run => run.units.map(unit => unit.text).join(''))).toEqual(['甲', '乙', '丙', '丁']);
    expect(layout.runs[1]!.x).toBe(10);
    expect(layout.runs[2]!.y).toBeGreaterThan(layout.runs[1]!.y);
    expect(layout.runs.map(run => revealInlineRun(run, 2)).join('')).toBe('甲乙');
    expect(layout.runs.map(run => [run.x, run.y])).toEqual(initial);
  });
  it('注音保留整组宽度和上边距，可见单元不切开主文字', () => {
    const document = parseInlineText('<ruby=せかい>世界</ruby>！');
    const layout = layoutInlineText(document, 30, 10, measure, (_style, ruby) => ruby ? 18 : 12);
    expect(layout.runs[0]!.y).toBeGreaterThanOrEqual(20);
    expect(revealInlineRun(layout.runs[0]!, 0)).toBe('');
    expect(revealInlineRun(layout.runs[0]!, 1)).toBe('世界');
  });
  it('跨样式边界保持中文避头尾、显式空行与字素', () => {
    const doc = parseInlineText('甲乙<b>，</b>丙\n\n👩‍🚀');
    const layout = layoutInlineText(doc, 20, 10, measure);
    const comma = layout.runs.find(run => run.units.some(unit => unit.text === '，'))!;
    expect(comma.x).toBeGreaterThan(0);
    expect(layout.runs.map(run => revealInlineRun(run, Infinity)).join('')).toBe('甲乙，丙👩‍🚀');
    expect(layout.runs.at(-1)!.y).toBeGreaterThan(layout.runs.at(-2)!.y + 16);
  });
});
