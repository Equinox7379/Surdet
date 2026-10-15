/**
 * M6 E5-1 搜索/替换纯逻辑测试。
 */
import { describe, expect, it } from 'vitest';
import { buildMatcher, searchScenes, replaceInSceneText, previewSceneReplacement } from '../src/search.js';
import { compileScene } from '@surdet/core';
import type { SceneText } from '../src/search.js';

const scenes: SceneText[] = [
  { key: 'ch1', id: 'ch1', text: '凛：你好。\n@label start\n主角：再见。' },
  { key: 'sub/ch2', id: 'ch2', text: '凛：你好吗？\n@bg hall' },
];

it.each(['\n', '\r\n', '\r'])('#63 visible choice search and replacement preserve quoted markers and real conditions: %j', eol => {
  const text = ['@choice', '\t显示"[if:false]" [if:flag] -> @goto done', '@label done', '@end'].join(eol);
  const found = searchScenes([{ key: 's', id: 's', text }], '[if:false]', false, 'visible');
  expect(found).toHaveLength(1);
  expect(found[0]?.visible?.text).toBe('显示"[if:false]"');
  expect(searchScenes([{ key: 's', id: 's', text }], 'flag', false, 'visible')).toEqual([]);
  const next = previewSceneReplacement(text, 'false', 'true', false, 'visible')!;
  expect(next.text).toBe(text.replace('"[if:false]"', '"[if:true]"'));
  expect(next.count).toBe(1);
  const choice = compileScene(next.text, 's.gal', 's').instructions.find(instruction => instruction.op === 'choice');
  expect(choice?.op === 'choice' && choice.options[0]).toMatchObject({ label: '显示"[if:true]"', when: 'flag' });
});

describe('buildMatcher', () => {
  it('文本模式转义正则字符', () => {
    const re = buildMatcher('a.b', false);
    expect(re).not.toBeNull();
    expect(re!.test('a.b')).toBe(true);
    expect(re!.test('axb')).toBe(false);
  });
  it('正则模式原样编译；非法正则返回 null', () => {
    expect(buildMatcher('^凛', true)).not.toBeNull();
    expect(buildMatcher('[unclosed', true)).toBeNull();
  });
});

describe('searchScenes', () => {
  it('跨场景逐行匹配，带场景归属与 0 基行号', () => {
    const found = searchScenes(scenes, '你好', false, 'source');
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ sceneKey: 'ch1', sceneId: 'ch1', line: 0 });
    expect(found[1]).toMatchObject({ sceneKey: 'sub/ch2', sceneId: 'ch2', line: 0 });
  });
  it('正则搜索生效', () => {
    const found = searchScenes(scenes, '^主角', true, 'source');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sceneKey: 'ch1', line: 2 });
  });
  it('CR-only 与混合换行返回实际物理行号', () => {
    const text = '@scene first\r凛：第一句\r\n凛：第二句\n凛：第三句';
    expect(searchScenes([{ key: 'first', id: 'first', text }], '凛', false, 'source').map(r => r.line)).toEqual([1, 2, 3]);
    expect(replaceInSceneText(text, '凛', '主角', false, 'source')?.text).toBe('@scene first\r主角：第一句\r\n主角：第二句\n主角：第三句');
  });
  it('空查询返回空；上限截断', () => {
    expect(searchScenes(scenes, '', false, 'source')).toEqual([]);
    expect(searchScenes(scenes, '凛', false, 'source', 1)).toHaveLength(1);
  });
  it('终止换行不是额外编辑行，但实际空行与空文档可定位', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const text = `@scene start${eol}${eol}@end${eol}`;
      expect(searchScenes([{ key: 'start', id: 'start', text }], '^', true, 'source').map(r => r.line)).toEqual([0, 1, 2]);
    }
    expect(searchScenes([{ key: 'blank', id: 'blank', text: '' }], '^', true, 'source')).toHaveLength(1);
  });
});

describe('replaceInSceneText', () => {
  it('预览仅列出实际差异，原行号、字面替换和混合换行与应用完全一致', () => {
    const text = '\uFEFF@scene start\r\n凛：灯塔灯塔\r// 保留\n凛：灯塔';
    const preview = previewSceneReplacement(text, '灯塔', '$&<img>\n下一行', false, 'source')!;
    expect(preview.changes).toEqual([
      { line: 1, before: '凛：灯塔灯塔', after: '凛：$&<img>\n下一行$&<img>\n下一行', count: 2 },
      { line: 3, before: '凛：灯塔', after: '凛：$&<img>\n下一行', count: 1 },
    ]);
    expect(replaceInSceneText(text, '灯塔', '$&<img>\n下一行', false, 'source')).toEqual({ text: preview.text, count: 3 });
    expect(preview.text.startsWith('\uFEFF@scene start\r\n')).toBe(true);
    expect(preview.text.includes('\r// 保留\n')).toBe(true);
    expect(previewSceneReplacement(text, '灯塔', '灯塔', false, 'source')?.changes).toEqual([]);
    expect(previewSceneReplacement(text, '', '新增', true, 'source')?.changes).toEqual([]);
    expect(previewSceneReplacement(text, '[', '', true, 'source')).toBeNull();
  });
  it.each(['\u2028', '\u2029'])('替换其他词时保留 %j 所在行与说话人', (separator) => {
    const text = `@scene start\r\n林汀：前半句${separator}后半句\n周渡：灯塔还亮着。\r@end`;
    const documents = [{ key: 'start', id: 'start', text }];
    for (const query of ['前半句', '后半句']) {
      expect(searchScenes(documents, query, false, 'source')).toEqual([
        { sceneKey: 'start', sceneId: 'start', line: 1, text: `林汀：前半句${separator}后半句` },
      ]);
    }
    for (const regex of [false, true]) {
      expect(replaceInSceneText(text, '灯塔', '邮局', regex, 'source')).toEqual({
        text: text.replace('灯塔', '邮局'), count: 1,
      });
    }
    expect(replaceInSceneText(text, '灯塔', '灯塔', false, 'source')).toEqual({ text, count: 1 });
    expect(replaceInSceneText(text, '不存在', '其他', false, 'source')).toEqual({ text, count: 0 });
  });

  it('正则逐行替换与显示匹配一致，并保留每一处原换行', () => {
    const text = 'a\r\nb\nc\r';
    expect(replaceInSceneText(text, '^', '前', true, 'source')).toEqual({ text: '前a\r\n前b\n前c\r', count: 3 });
    expect(replaceInSceneText(text, '$', '后', true, 'source')).toEqual({ text: 'a后\r\nb后\nc后\r', count: 3 });
    expect(replaceInSceneText(text, '\\r\\n', '不可替换', true, 'source')).toEqual({ text, count: 0 });
    expect(replaceInSceneText(text, '', '不可替换', false, 'source')).toEqual({ text, count: 0 });
  });
  it('文本模式全量替换并计数', () => {
    const r = replaceInSceneText('你好，你好。\n凛：你好', '你好', '再见', false, 'source');
    expect(r).not.toBeNull();
    expect(r!.count).toBe(3);
    expect(r!.text).toBe('再见，再见。\n凛：再见');
  });
  it('无匹配 count=0；非法正则返回 null', () => {
    expect(replaceInSceneText('abc', 'xyz', 'q', false, 'source')!.count).toBe(0);
    expect(replaceInSceneText('abc', '[bad', 'q', true, 'source')).toBeNull();
  });
});

describe('带行内标签的查找替换', () => {
  const text = '@scene s\n凛：<color=accent>危</color>险，真的危险。\n  <b>危险</b>的路 -> @goto a\n@label a';
  it('台词按玩家看到的文字查找，跨样式标签也能找到', () => {
    const [result] = searchScenes([{ key: 's', id: 's', text }], '色险', false, 'visible').concat(searchScenes([{ key: 's', id: 's', text }], '危险，', false, 'visible'));
    expect(result).toEqual({ sceneKey: 's', sceneId: 's', line: 1, text: '凛：<color=accent>危</color>险，真的危险。', visible: { text: '危险，真的危险。', start: 0, end: 3, acrossTags: true } });
  });
  it('替换只写回不跨标签的位置，其余计入跳过且不改动', () => {
    const preview = previewSceneReplacement(text, '危险', '安全', false, 'visible')!;
    expect(preview.changes).toEqual([
      { line: 1, before: '凛：<color=accent>危</color>险，真的危险。', after: '凛：<color=accent>危</color>险，真的安全。', count: 1 },
      { line: 2, before: '  <b>危险</b>的路 -> @goto a', after: '  <b>安全</b>的路 -> @goto a', count: 1 },
    ]);
    // The match crossing </color> is left alone; text inside a span is replaced without touching its tags.
    expect(preview.skipped).toBe(1);
  });
  it('显示文字模式不替换标签取值；原文模式按原样改写，仍是合法标签', () => {
    expect(previewSceneReplacement(text, 'accent', 'danger', false, 'visible')!.changes).toEqual([]);
    expect(previewSceneReplacement(text, 'accent', 'danger', false, 'source')!.changes.map(change => change.after))
      .toEqual(['凛：<color=danger>危</color>险，真的危险。']);
  });
  it('显示文字模式写进台词的标签文字被转义，说话人不算显示文字', () => {
    const preview = previewSceneReplacement('凛：你好', '你好', '<b>好', false, 'visible')!;
    expect(preview.text).toBe('凛：\\<b>好');
    expect(previewSceneReplacement('凛：你好', '凛', '<b>林', false, 'visible')!.changes).toEqual([]);
    expect(searchScenes([{ key: 's', id: 's', text: '凛：你好' }], '凛', false, 'visible')).toEqual([]);
  });
  it('原文模式按原样写入；会让对白或选项标签出错的行不替换并计数', () => {
    const broken = previewSceneReplacement('凛：你好\n凛：再见', '你好', '<b>好', false, 'source')!;
    expect(broken).toMatchObject({ changes: [], count: 0, refused: 1 });
    const paired = previewSceneReplacement('凛：你好', '你好', '<b>好</b>', false, 'source')!;
    expect(paired).toMatchObject({ text: '凛：<b>好</b>', count: 1, refused: 0 });
    // A closing tag renamed away from its opener is refused; an unknown tag alone only shows as text and is written.
    expect(previewSceneReplacement(text, '</color>', '</colour>', false, 'source')!).toMatchObject({ changes: [], refused: 1 });
    expect(previewSceneReplacement('凛：你好', '你好', '<img>', false, 'source')!.text).toBe('凛：<img>');
    expect(searchScenes([{ key: 's', id: 's', text: '凛：你好' }], '凛', false, 'source').map(result => result.line)).toEqual([0]);
  });
});

describe('选项文字按 Core 读出的选项文本查找替换（16-REV-01/02）', () => {
  const scene = (body: string) => `@scene s\n凛：<b>夜</b>\n@choice\n${body}\n@label a\n@end`;
  const compiles = (text: string) => compileScene(text, 's.gal', 's');
  it('替换文字里的标签写成普通文字，对白与选项一致', () => {
    const text = scene('  <b>夜</b>来了 -> @goto a\n  夜里 -> @goto a');
    const preview = previewSceneReplacement(text, '夜', '<i>晚</i>', false, 'visible')!;
    expect(preview.changes.map(change => change.after)).toEqual(['凛：<b>\\<i>晚\\</i></b>', '  <b>\\<i>晚\\</i></b>来了 -> @goto a', '  \\<i>晚\\</i>里 -> @goto a']);
    expect(() => compiles(preview.text)).not.toThrow();
  });
  it('注音组整组跳过并计数，不制造编译错误', () => {
    const text = scene('  <ruby=よる>夜</ruby>深 -> @goto a');
    for (const replacement of ['<i>晚</i>', '早晨']) {
      const preview = previewSceneReplacement(text, '夜', replacement, false, 'visible')!;
      expect(preview.changes.map(change => change.line)).toEqual([1]);
      expect(preview.skipped).toBe(1);
      expect(() => compiles(preview.text)).not.toThrow();
    }
  });
  it('含反斜杠的替换在选项文字里转义', () => {
    const preview = previewSceneReplacement(scene('  <b>夜</b> -> @goto a'), '夜', 'a\\b', false, 'visible')!;
    expect(preview.changes[1]!.after).toBe('  <b>a\\\\b</b> -> @goto a');
  });
  it('条件与箭头后的指令不是选项文字：显示文字模式不改，原文模式按原文替换', () => {
    const text = '@scene s\n@choice\n  <b>危</b>险 [if:danger] -> @goto done\n@label done\n@end';
    expect(previewSceneReplacement(text, 'done', 'end', false, 'visible')!.changes).toEqual([]);
    expect(previewSceneReplacement(text, 'done', 'end', false, 'source')!.changes).toEqual([
      { line: 2, before: '  <b>危</b>险 [if:danger] -> @goto done', after: '  <b>危</b>险 [if:danger] -> @goto end', count: 1 },
      { line: 3, before: '@label done', after: '@label end', count: 1 },
    ]);
    expect(previewSceneReplacement(text, 'danger', '<i>x</i>', false, 'source')!.changes[0]!.after).toBe('  <b>危</b>险 [if:<i>x</i>] -> @goto done');
  });
  it('跨标签找到选项文字，并保留原稿行定位；箭头后的内容不算显示文字', () => {
    const text = '@scene s\n@choice\n  <b>危</b>险 -> @goto done\n@label done\n@end';
    expect(searchScenes([{ key: 's', id: 's', text }], '危险', false, 'visible')).toEqual([
      { sceneKey: 's', sceneId: 's', line: 2, text: '  <b>危</b>险 -> @goto done', visible: { text: '危险', start: 0, end: 2, acrossTags: true } },
    ]);
    expect(searchScenes([{ key: 's', id: 's', text }], '危险 ->', false, 'visible')).toEqual([]);
    expect(searchScenes([{ key: 's', id: 's', text }], 'goto done', false, 'visible')).toEqual([]);
    expect(searchScenes([{ key: 's', id: 's', text }], 'goto done', false, 'source').map(result => result.line)).toEqual([2]);
  });
});

describe('显示文字匹配是否跨过标签', () => {
  it('只看这一处匹配：同一行别处有同样的字不影响判断；转义字符不算标签', () => {
    const text = '@scene s\n凛：<color=accent>危</color>险，真的危险。\n凛：a\\<b危险\n@end';
    const [crossing, escaped] = searchScenes([{ key: 's', id: 's', text }], '危险', false, 'visible');
    expect(crossing!.visible).toMatchObject({ start: 0, end: 2, acrossTags: true });
    expect(escaped!.visible).toMatchObject({ text: 'a<b危险', acrossTags: false });
    expect(searchScenes([{ key: 's', id: 's', text }], '<b危', false, 'visible')[0]!.visible!.acrossTags).toBe(false);
  });
});
