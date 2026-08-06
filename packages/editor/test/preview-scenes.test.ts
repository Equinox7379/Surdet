/**
 * 预览多场景：collectPreviewScenes（全量场景收集，跨场景 @jump 的预览数据源）纯逻辑测试。
 */
import { describe, expect, it } from 'vitest';
import { collectPreviewScenes, listLabels } from '../src/panels/preview-panel.js';

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
