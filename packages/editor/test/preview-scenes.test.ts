/**
 * 预览多场景：collectPreviewScenes（全量场景收集，跨场景 @jump 的预览数据源）纯逻辑测试。
 */
import { describe, expect, it } from 'vitest';
import { collectPreviewScenes, listLabels, parsePreviewVariables } from '../src/panels/preview-panel.js';

describe('collectPreviewScenes（预览全量场景收集）', () => {
  it('按插入序输出 {id,text}（内存文本含未保存编辑）', () => {
    const scenes = new Map<string, { id: string; text: string }>([
      ['ch01.gal', { id: 'ch01', text: '@scene ch01' }],
      ['ch02.gal', { id: 'ch02', text: '@scene ch02' }],
    ]);
    expect(collectPreviewScenes(scenes)).toEqual([
      { id: 'ch01', text: '@scene ch01' },
      { id: 'ch02', text: '@scene ch02' },
    ]);
  });

  it('同 id 去重保留先到者；空白 id 剔除；空集合安全', () => {
    const scenes = new Map<string, { id: string; text: string }>([
      ['a.gal', { id: 'dup', text: 'first' }],
      ['sub/a.gal', { id: 'dup', text: 'second' }],
      ['b.gal', { id: '  ', text: 'x' }],
    ]);
    expect(collectPreviewScenes(scenes)).toEqual([{ id: 'dup', text: 'first' }]);
    expect(collectPreviewScenes(new Map())).toEqual([]);
  });
});

describe('listLabels（既有能力回归：从标签播放的目标列表）', () => {
  it('收集 @label 行', () => {
    expect(listLabels('@scene s\n@label start\n凛：你好\n@label end')).toEqual(['start', 'end']);
  });
});

describe('parsePreviewVariables（预览变量表提取）', () => {
  it('从 game.config.json 文本提取声明（name 并入声明体）', () => {
    const vars = parsePreviewVariables(JSON.stringify({
      variables: {
        gold: { type: 'number', initial: 100, min: 0 },
        hasSword: { type: 'flag', initial: false },
      },
    }));
    expect(vars).toEqual([
      { name: 'gold', type: 'number', initial: 100, min: 0 },
      { name: 'hasSword', type: 'flag', initial: false },
    ]);
  });

  it('容错：非法 JSON/缺 variables/非对象声明均返回可用结果不抛错', () => {
    expect(parsePreviewVariables('')).toEqual([]);
    expect(parsePreviewVariables('{bad')).toEqual([]);
    expect(parsePreviewVariables('{}')).toEqual([]);
    expect(parsePreviewVariables(JSON.stringify({ variables: [1, 2] }))).toEqual([]);
    expect(parsePreviewVariables(JSON.stringify({ variables: { a: { type: 'number', initial: 1 }, b: 42 } })))
      .toEqual([{ name: 'a', type: 'number', initial: 1 }]); // 非对象声明跳过
  });
});
