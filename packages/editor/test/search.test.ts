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
  it('空查询返回空；上限截断', () => {
    expect(searchScenes(scenes, '', false)).toEqual([]);
    expect(searchScenes(scenes, '凛', false, 1)).toHaveLength(1);
  });
});

describe('replaceInSceneText', () => {
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
