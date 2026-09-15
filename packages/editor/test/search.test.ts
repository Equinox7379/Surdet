/**
 * M6 E5-1 搜索/替换纯逻辑测试。
 */
import { describe, expect, it } from 'vitest';
import { buildMatcher, searchScenes, replaceInSceneText } from '../src/search.js';
import type { SceneText } from '../src/search.js';

const scenes: SceneText[] = [
  { key: 'ch1', id: 'ch1', text: '凛：你好。\n@label start\n主角：再见。' },
  { key: 'sub/ch2', id: 'ch2', text: '凛：你好吗？\n@bg hall' },
];

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
    const found = searchScenes(scenes, '你好', false);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ sceneKey: 'ch1', sceneId: 'ch1', line: 0 });
    expect(found[1]).toMatchObject({ sceneKey: 'sub/ch2', sceneId: 'ch2', line: 0 });
  });
  it('正则搜索生效', () => {
    const found = searchScenes(scenes, '^主角', true);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sceneKey: 'ch1', line: 2 });
  });
  it('CR-only 与混合换行返回实际物理行号', () => {
    const text = '@scene first\r凛：第一句\r\n凛：第二句\n凛：第三句';
    expect(searchScenes([{ key: 'first', id: 'first', text }], '凛', false).map(r => r.line)).toEqual([1, 2, 3]);
    expect(replaceInSceneText(text, '凛', '主角', false)?.text).toBe('@scene first\r主角：第一句\r\n主角：第二句\n主角：第三句');
  });
  it('空查询返回空；上限截断', () => {
    expect(searchScenes(scenes, '', false)).toEqual([]);
    expect(searchScenes(scenes, '凛', false, 1)).toHaveLength(1);
  });
  it('终止换行不是额外编辑行，但实际空行与空文档可定位', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const text = `@scene start${eol}${eol}@end${eol}`;
      expect(searchScenes([{ key: 'start', id: 'start', text }], '^', true).map(r => r.line)).toEqual([0, 1, 2]);
    }
    expect(searchScenes([{ key: 'blank', id: 'blank', text: '' }], '^', true)).toHaveLength(1);
  });
});

describe('replaceInSceneText', () => {
  it.each(['\u2028', '\u2029'])('替换其他词时保留 %j 所在行与说话人', (separator) => {
    const text = `@scene start\r\n林汀：前半句${separator}后半句\n周渡：灯塔还亮着。\r@end`;
    const documents = [{ key: 'start', id: 'start', text }];
    for (const query of ['前半句', '后半句']) {
      expect(searchScenes(documents, query, false)).toEqual([
        { sceneKey: 'start', sceneId: 'start', line: 1, text: `林汀：前半句${separator}后半句` },
      ]);
    }
    for (const regex of [false, true]) {
      expect(replaceInSceneText(text, '灯塔', '邮局', regex)).toEqual({
        text: text.replace('灯塔', '邮局'), count: 1,
      });
    }
    expect(replaceInSceneText(text, '灯塔', '灯塔', false)).toEqual({ text, count: 1 });
    expect(replaceInSceneText(text, '不存在', '其他', false)).toEqual({ text, count: 0 });
  });

  it('正则逐行替换与显示匹配一致，并保留每一处原换行', () => {
    const text = 'a\r\nb\nc\r';
    expect(replaceInSceneText(text, '^', '前', true)).toEqual({ text: '前a\r\n前b\n前c\r', count: 3 });
    expect(replaceInSceneText(text, '$', '后', true)).toEqual({ text: 'a后\r\nb后\nc后\r', count: 3 });
    expect(replaceInSceneText(text, '\\r\\n', '不可替换', true)).toEqual({ text, count: 0 });
    expect(replaceInSceneText(text, '', '不可替换', false)).toEqual({ text, count: 0 });
  });
  it('文本模式全量替换并计数', () => {
    const r = replaceInSceneText('你好，你好。\n凛：你好', '你好', '再见', false);
    expect(r).not.toBeNull();
    expect(r!.count).toBe(3);
    expect(r!.text).toBe('再见，再见。\n凛：再见');
  });
  it('无匹配 count=0；非法正则返回 null', () => {
    expect(replaceInSceneText('abc', 'xyz', 'q', false)!.count).toBe(0);
    expect(replaceInSceneText('abc', '[bad', 'q', true)).toBeNull();
  });
});
