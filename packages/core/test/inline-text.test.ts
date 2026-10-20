import { describe, expect, it } from 'vitest';
import { containsInlineTag, escapeInlineText, inlinePlainText, inlineStaticText, inlineTextLength, interpolateInlineText, parseInlineText } from '../src/inline-text.js';

describe('固定行内标签合同', () => {
  it('renders escaped colon punctuation and keeps physical source ranges', () => {
    const source = '记录\\：23\\:15';
    const doc = parseInlineText(source);
    expect(doc.plainText).toBe('记录：23:15');
    expect(doc.issues).toEqual([]);
    const colon = doc.units.find(unit => unit.text === '：')!;
    expect(source.slice(colon.start, colon.end)).toBe('\\：');
    expect(inlinePlainText(escapeInlineText('原文\\:路径\\：'))).toBe('原文\\:路径\\：');
  });
  it('parses emphasis/effects and final no-wait while removing motion/timing from static history', () => {
    const source = '<em><wave>甲</wave></em><speed=2><b>乙</b></speed><w=5><nw>';
    const doc = parseInlineText(source); expect(doc.issues).toEqual([]);
    expect(doc.units[0]!.style).toEqual({ emphasis: true, effect: 'wave' });
    expect(doc.controls.at(-1)!.kind).toBe('no-wait');
    expect(inlineStaticText(source)).toBe('<em>甲</em><b>乙</b>');
    expect(parseInlineText('甲<nw>乙').issues.some(issue => issue.code === 'M006')).toBe(true);
    expect(parseInlineText('<b>甲<nw></b>').issues.some(issue => issue.code === 'M006')).toBe(true);
    for (const source of ['<shake>甲</shake>', '甲<nw>']) expect(parseInlineText(source, 'choice').issues.some(issue => issue.code === 'M005')).toBe(true);
  });
  it('嵌套样式、原文范围和节奏只作用于可见文字', () => {
    const doc = parseInlineText('甲<b>乙<size=2>丙</size></b><w=500><w><speed=0.5>丁</speed>');
    expect(doc.issues).toEqual([]);
    expect(doc.plainText).toBe('甲乙丙丁');
    expect(doc.units.map(unit => unit.style)).toEqual([{}, { bold: true }, { bold: true, size: 2 }, { speed: 0.5 }]);
    expect(doc.controls.map(({ kind, at, durationMs }) => ({ kind, at, durationMs }))).toEqual([
      { kind: 'pause', at: 3, durationMs: 500 }, { kind: 'wait', at: 3, durationMs: undefined },
    ]);
    expect(doc.source.slice(doc.units[2]!.start, doc.units[2]!.end)).toBe('丙');
  });
  it('书名号原样保留，只有显式ruby产生注音', () => {
    expect(inlinePlainText('我在读《红楼梦》。')).toBe('我在读《红楼梦》。');
    const doc = parseInlineText('<b><ruby=せかい>世界</ruby></b>');
    expect(doc.units).toEqual([{ text: '世界', ruby: 'せかい', style: { bold: true }, start: 3, end: 22 }]);
    expect(inlineTextLength(doc.source)).toBe(2);
  });
  it('字素簇和转义保持原样，不拆emoji或组合字符', () => {
    const doc = parseInlineText('👩‍🚀e\u0301\\<b>\\\\ >_< <3 a < b <<标题>>');
    expect(doc.units[0]!.text).toBe('👩‍🚀'); expect(doc.units[1]!.text).toBe('e\u0301');
    expect(doc.plainText).toBe('👩‍🚀e\u0301<b>\\ >_< <3 a < b <<标题>>');
    expect(doc.issues).toEqual([]);
    expect(containsInlineTag('\\<b>正文')).toBe(false);
    expect(containsInlineTag('<b>正文')).toBe(true);
  });
  it.each(['#f00', '#FF00aa', 'accent', 'textMuted'])('允许颜色 %s', color => {
    const doc = parseInlineText(`<color=${color}>红</color>`);
    expect(doc.issues).toEqual([]); expect(doc.units[0]!.style.color).toBe(color);
  });
  it.each([
    ['<b>甲', 'M002'], ['<b><i>甲</b></i>', 'M003'], ['</size>甲', 'M003'],
    ['<size=3>甲</size>', 'M004'], ['<color={c}>甲</color>', 'M004'], ['<w=0>', 'M004'],
    ['<w=0.5>', 'M004'], ['<speed=0>甲</speed>', 'M004'], ['<color=', 'M004'],
    ['<ruby=读><b>字</b></ruby>', 'M004'],
  ])('错误标记按原文显示且无控制副作用：%s', (source, code) => {
    const doc = parseInlineText(source);
    expect(doc.issues.some(issue => issue.code === code)).toBe(true);
    expect(doc.plainText).toBe(source); expect(doc.controls).toEqual([]);
  });
  it('未知标签保留字面，选项拒绝节奏，说话人拒绝标记', () => {
    expect(parseInlineText('<colr=red>甲').issues[0]!.code).toBe('M001');
    expect(parseInlineText('等<w>', 'choice').issues[0]!.code).toBe('M005');
    expect(parseInlineText('<b>凛</b>', 'speaker').issues[0]!.code).toBe('M005');
  });
  it('变量值、变量拼出的标签、反斜杠和书名均不能注入标记', () => {
    const values: Record<string, string> = { name: '<w><b>名</b>\\《书》', tag: 'b' };
    const source = '<b>{name}</b> <{tag}>不是标签</{tag}> {{name}}';
    const rendered = interpolateInlineText(source, name => values[name], name => name in values);
    const doc = parseInlineText(rendered);
    expect(doc.plainText).toBe('<w><b>名</b>\\《书》 <b>不是标签</b> {name}');
    expect(doc.controls).toEqual([]); expect(doc.issues).toEqual([]);
    expect(doc.units[0]!.style.bold).toBe(true);
    expect(inlinePlainText(escapeInlineText('<w>\\《书》'))).toBe('<w>\\《书》');
  });
});
