import { describe, expect, it } from 'vitest';
import { compileScene, parseInlineText } from '@surdet/core';
import { choiceLabelSpan, completionPrefix, findInDialogue, inlineCompletions, inlineTagAllowed, insertInlineMarker, replaceInDialogue, sourceRangeOfPlain, splitInlineDialogue, wrapInlineSelection } from '../src/v4/inline-markup.js';
import { sourceMarkupSegments, sourceMarkupSummary } from '../src/v4/source-markup.js';

const valid = (text: string): void => {
  expect(parseInlineText(text).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
};

it.each(['显示"[if:false]"', "显示'[if:false]'", '显示“[if:false]”', '显示‘[if:false]’'])('#63 keeps the complete quoted prose span with and without a trailing condition: %s', label => {
  for (const condition of ['', ' [if:route == "a]b"]']) {
    const row = `\t  ${label}${condition} -> @goto done  `;
    const span = choiceLabelSpan(row)!;
    expect(span).toEqual({ start: 3, end: 3 + label.length });
    expect(row.slice(span.start, span.end)).toBe(label);
  }
  expect(choiceLabelSpan(`  ${label} [if:true] 后文 -> @goto done`)).toBeNull();
});

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
    expect(keys).toEqual(['b', 'i', 'color', 'size', 'speed', 'w', 'w=', 'ruby', 'em', 'shake', 'wave', 'nw']);
    expect(inlineCompletions('co').map((entry) => entry.snippet)).toEqual(['<color=accent></color>']);
    // Paired tags insert both ends; the single <nw> inserts itself only.
    expect(inlineCompletions('em').map((entry) => [entry.snippet, entry.select])).toEqual([['<em></em>', [4, 4]]]);
    expect(inlineCompletions('nw').map((entry) => [entry.snippet, entry.select])).toEqual([['<nw>', [4, 4]]]);
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

describe('第二批标签', () => {
  it('着重号和逐字效果可以包裹，<nw> 不包裹文字', () => {
    expect(wrapInlineSelection('别动', 0, 2, 'shake')).toMatchObject({ ok: true, text: '<shake>别动</shake>' });
    expect(wrapInlineSelection('重点', 0, 2, 'em')).toMatchObject({ ok: true, text: '<em>重点</em>' });
    expect(wrapInlineSelection('不用等我。', 0, 2, 'nw')).toEqual({ ok: false, reason: '<nw> 不包裹文字，请放在句末' });
  });
  it('句末 <nw> 不影响包裹与拆分，拆分后留在后半句末尾', () => {
    const tail = '<em>重点</em>说完<nw>', at = tail.indexOf('说完');
    expect(wrapInlineSelection(tail, at, at + 2, 'b')).toMatchObject({ ok: true, text: '<em>重点</em><b>说完</b><nw>' });
    const line = '<wave>轻声</wave>说完了。<nw>', cut = line.indexOf('了');
    const split = splitInlineDialogue(line, cut, cut);
    expect(split).toEqual({ ok: true, left: '<wave>轻声</wave>说完', right: '了。<nw>', reopened: 0 });
    valid('<wave>轻声</wave>说完');
    valid('了。<nw>');
  });
});

describe('按 Core 的上下文提供标签（源码与选项）', () => {
  it('选项上下文只提供 Core 接受的标签，规则来自 Core 解析器', () => {
    for (const name of ['w', 'speed', 'nw', 'shake', 'wave'] as const) expect(inlineTagAllowed(name, 'choice')).toBe(false);
    for (const name of ['b', 'i', 'color', 'size', 'ruby', 'em'] as const) expect(inlineTagAllowed(name, 'choice')).toBe(true);
    expect(inlineCompletions('', 'choice').map((entry) => entry.key)).toEqual(['b', 'i', 'color', 'size', 'ruby', 'em']);
    expect(inlineCompletions('s', 'choice').map((entry) => entry.key)).toEqual(['size']);
    expect(inlineCompletions('s').map((entry) => entry.key)).toEqual(['size', 'speed', 'shake']);
  });
  it('选项里包裹不接受的标签时给出 Core 的原因，接受的标签按选项规则校验', () => {
    expect(wrapInlineSelection('先走', 0, 2, 'shake', undefined, 'choice')).toEqual({ ok: false, reason: parseInlineText('<shake>', 'choice').issues[0]!.message });
    expect(wrapInlineSelection('先走', 0, 2, 'color', 'accent', 'choice')).toMatchObject({ ok: true, text: '<color=accent>先走</color>' });
  });
});

describe('源码视图只解析对白与选项文字', () => {
  const source = [
    '@scene start',
    '// 注释 <b>不算</b>',
    '@bg <b>hall',
    '凛：你好<b>重点</b>。',
    '旁白里的《书名》和{hero}<w=200>。',
    '@choice',
    '  <color=accent>先走</color> [if:<b>] -> @goto <i>a',
    '  <shake>抖</shake> -> @goto a',
    '@label a',
    '凛：<size=9>大</size>',
    '@end',
  ].join('\n');
  const segments = sourceMarkupSegments(source);
  it('取出的范围恰好是 Core 读作对白和选项显示文字的部分，并按各自上下文解析', () => {
    expect(segments.map((segment) => [segment.line, segment.context, source.slice(segment.start, segment.end)])).toEqual([
      [3, 'dialogue', '你好<b>重点</b>。'],
      [4, 'dialogue', '旁白里的《书名》和{hero}<w=200>。'],
      [6, 'choice', '<color=accent>先走</color>'],
      [7, 'choice', '<shake>抖</shake>'],
      [9, 'dialogue', '<size=9>大</size>'],
    ]);
    expect(segments[1]!.document.issues).toEqual([]);
    expect(segments[3]!.document.issues.map((issue) => issue.code)).toEqual(['M005', 'M005']);
    expect(segments[4]!.document.issues.map((issue) => issue.code)).toContain('M004');
  });
  it('光标所在行的问题用 Core 的原话，其他行只给行号', () => {
    expect(sourceMarkupSummary(segments, 7)).toBe(`第 8 行：${segments[3]!.document.issues.map((issue) => issue.message).join('；')}。另有标签问题在第 10 行`);
    expect(sourceMarkupSummary(segments, 3)).toBe('标签问题在第 8、10 行');
    expect(sourceMarkupSummary(sourceMarkupSegments('凛：你好。\n@bg <b>'), 0)).toBe('');
  });
  it('CRLF 换成文本框的 LF 后，范围仍对应文本框里的位置', () => {
    const lf = '@scene s\n凛：<b>好</b>\n@end';
    const [segment] = sourceMarkupSegments(lf);
    expect(lf.slice(segment!.start, segment!.end)).toBe('<b>好</b>');
  });
});
