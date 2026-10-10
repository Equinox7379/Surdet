import { describe, expect, it } from 'vitest';
import { compileScene, parseInlineText } from '@surdet/core';
import { choiceLabelSpan, completionPrefix, findInDialogue, inlineCompletions, insertInlineMarker, replaceInDialogue, sourceRangeOfPlain, splitInlineDialogue, wrapInlineSelection } from '../src/v4/inline-markup.js';

const valid = (text: string): void => {
  expect(parseInlineText(text).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
};

describe('选中文字加标签', () => {
  it('包裹选区并选中原文字，结果仍是合法标记', () => {
    const result = wrapInlineSelection('你说什么？再说一遍。', 5, 9, 'color', 'accent');
    expect(result).toEqual({ ok: true, text: '你说什么？<color=accent>再说一遍</color>。', selectionStart: 19, selectionEnd: 23 });
    if (result.ok) valid(result.text);
  });

  it('在已有样式内部或包住整段都可以，跨边界拒绝', () => {
    const source = '前<b>重点内容</b>后';
    expect(wrapInlineSelection(source, 4, 6, 'i').ok).toBe(true);
    expect(wrapInlineSelection(source, 0, source.length, 'i').ok).toBe(true);
    const crossing = wrapInlineSelection(source, 0, 5, 'i');
    expect(crossing.ok).toBe(false);
    if (!crossing.ok) expect(crossing.reason).toContain('<b>');
  });

  it('选区端点落在标签或注音内部时拒绝', () => {
    const source = '看<ruby=せかい>世界</ruby>吧';
    expect(wrapInlineSelection(source, 2, 20, 'b').ok).toBe(false);
    expect(wrapInlineSelection(source, 0, source.length, 'b').ok).toBe(true);
    expect(wrapInlineSelection('<b>字</b>', 1, 4, 'i').ok).toBe(false);
  });

  it('注音的主文字里不能再有标签', () => {
    expect(wrapInlineSelection('甲<b>乙</b>丙', 0, 9, 'ruby', 'よみ').ok).toBe(false);
    const plain = wrapInlineSelection('世界和平', 0, 2, 'ruby', 'せかい');
    expect(plain.ok && plain.text).toBe('<ruby=せかい>世界</ruby>和平');
  });

  it('取值非法时用 Core 的诊断说明拒绝', () => {
    const result = wrapInlineSelection('文字', 0, 2, 'size', '9');
    expect(result.ok).toBe(false);
  });

  it('有错误标签的句子先要求修正', () => {
    const result = wrapInlineSelection('<b>没闭合', 3, 5, 'i');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('请先修正');
  });

  it('停顿只在标签外插入', () => {
    expect(insertInlineMarker('<b>等一下</b>', 6, '<w>')).toMatchObject({ ok: true, text: '<b>等一下<w></b>' });
    expect(insertInlineMarker('<b>等一下</b>', 1, '<w>').ok).toBe(false);
  });
});

describe('拆分带标签的台词', () => {
  it('没有标签时与原来一样按位置切开', () => {
    expect(splitInlineDialogue('你好世界', 2, 2)).toEqual({ ok: true, left: '你好', right: '世界', reopened: 0 });
  });

  it('在样式内部拆分时关闭再重开，两句都合法', () => {
    const source = '<color=accent>危<b>险的</b>东西</color>';
    const at = source.indexOf('的');
    const result = splitInlineDialogue(source, at, at);
    expect(result).toEqual({ ok: true, left: '<color=accent>危<b>险</b></color>', right: '<color=accent><b>的</b>东西</color>', reopened: '<color=accent><b>'.length });
    if (result.ok) { valid(result.left); valid(result.right); }
  });

  it('标签内部、注音内部、选区含标签时拒绝', () => {
    expect(splitInlineDialogue('<b>字</b>', 1, 1).ok).toBe(false);
    expect(splitInlineDialogue('<ruby=よ>夜</ruby>', 11, 11).ok).toBe(false);
    expect(splitInlineDialogue('甲<w>乙', 1, 4).ok).toBe(false);
  });
});

describe('跨标签查找与替换', () => {
  it('可见文字跨样式标签也能找到', () => {
    expect(findInDialogue('<color=accent>危</color>险', /危险/g)).toEqual({ plain: '危险', start: 0, end: 2 });
  });

  it('可见范围映射回源码区间', () => {
    const document = parseInlineText('前<b>中</b>后');
    expect(sourceRangeOfPlain(document, 1, 2)).toMatchObject({ start: 4, end: 5 });
    expect(sourceRangeOfPlain(document, 0, 3)).toMatchObject({ start: 0, end: 10 });
  });

  it('只替换不跨标签的匹配，跨标签和注音的计入跳过', () => {
    const result = replaceInDialogue('<color=accent>危</color>险，危险。<ruby=よ>夜</ruby>', /危险|夜/g, '安全');
    expect(result).toEqual({ value: '<color=accent>危</color>险，安全。<ruby=よ>夜</ruby>', count: 1, skipped: 2 });
  });

  it('不会替换进标签取值', () => {
    const result = replaceInDialogue('<color=accent>强调</color>', /accent/g, 'danger');
    expect(result).toEqual({ value: '<color=accent>强调</color>', count: 0, skipped: 0 });
  });

  it('替换内容按普通文字写入', () => {
    const result = replaceInDialogue('甲乙', /乙/g, '<b>丙');
    expect(result.value).toBe('甲\\<b>丙');
    expect(parseInlineText(result.value).plainText).toBe('甲<b>丙');
  });

  it('有错误标签的句子不替换', () => {
    expect(replaceInDialogue('<b>危险', /危险/g, '安全')).toEqual({ value: '<b>危险', count: 0, skipped: 1 });
  });
});

describe('输入 < 时的标签补全', () => {
  it('列出标签表中的标签，w 分成等待与停顿', () => {
    const keys = inlineCompletions('').map((entry) => entry.key);
    expect(keys).toEqual(['b', 'i', 'color', 'size', 'speed', 'w', 'w=', 'ruby']);
    expect(inlineCompletions('co').map((entry) => entry.snippet)).toEqual(['<color=accent></color>']);
  });

  it('只在未转义的 < 后触发', () => {
    expect(completionPrefix('文字<co', 5)).toEqual({ start: 2, prefix: 'co' });
    expect(completionPrefix('文字\\<co', 6)).toBeNull();
    expect(completionPrefix('文字<b>', 5)).toBeNull();
  });
});

describe('选项文字范围与 Core 一致', () => {
  it('取出的选项文字等于 Core 编译出的选项文本', () => {
    const rows = [
      '  <b>危</b>险 -> @goto a',
      '\t留下 [if:trust > 2] -> @goto a',
      '  <ruby=よる>夜</ruby>深   ->   @goto a',
      '  只有文字',
      '  "带->引号" -> @goto a',
      '  条件后有空格 [if:flag]   -> @goto a',
    ];
    const text = `@scene s\n@choice\n${rows.join('\n')}\n@label a\n@end\n`;
    const choice = compileScene(text, 's.gal', 's').instructions.find((instr) => instr.op === 'choice') as unknown as { options: { label: string }[] };
    expect(rows.map((row) => { const span = choiceLabelSpan(row)!; return row.slice(span.start, span.end); })).toEqual(choice.options.map((option) => option.label));
  });
  it('Core 读不出选项文字时返回 null', () => {
    expect(choiceLabelSpan('   ')).toBeNull();
    expect(choiceLabelSpan('  [if:flag] -> @goto a')).toBeNull();
  });
});
