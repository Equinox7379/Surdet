/**
 * 编辑器崩溃保险（autosave.ts）纯逻辑测试。
 * 失败用例先行：非法存储内容必须静默降级（不抛错），恢复判定必须限定同项目。
 */
import { describe, expect, it } from 'vitest';
import { buildAutosave, parseAutosave, pickRecoverable } from '../src/autosave.js';

describe('buildAutosave（快照构建）', () => {
  it('仅收 dirty 场景；全干净返回 null', () => {
    const scenes = new Map([
      ['a', { text: 'A改过', dirty: true }],
      ['b', { text: 'B干净', dirty: false }],
    ]);
    expect(buildAutosave('proj', scenes, 999)).toEqual({
      dirName: 'proj',
      savedAt: 999,
      scenes: [{ key: 'a', text: 'A改过' }],
    });
    expect(buildAutosave('proj', new Map([['b', { text: 'x', dirty: false }]]), 1)).toBeNull();
    expect(buildAutosave('proj', new Map(), 1)).toBeNull();
  });
});

describe('parseAutosave（存储内容形状校验）', () => {
  it('合法载荷往返一致', () => {
    const payload = { dirName: 'p', savedAt: 5, scenes: [{ key: 'k', text: 't' }] };
    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
  });

  it('非法形状/坏 JSON 一律按无快照处理（不抛错）', () => {
    expect(parseAutosave(null)).toBeNull();
    expect(parseAutosave('')).toBeNull();
    expect(parseAutosave('{bad')).toBeNull();
    expect(parseAutosave('42')).toBeNull();
    expect(parseAutosave('[]')).toBeNull();
    expect(parseAutosave('{"dirName":1,"savedAt":2,"scenes":[]}')).toBeNull();
    expect(parseAutosave('{"dirName":"p","savedAt":"x","scenes":[]}')).toBeNull();
    // 条目级容错：坏条目跳过、好条目保留
    expect(parseAutosave('{"dirName":"p","savedAt":1,"scenes":[{"key":"a","text":"t"},42,{"key":7}]}'))
      .toEqual({ dirName: 'p', savedAt: 1, scenes: [{ key: 'a', text: 't' }] });
  });
});

describe('pickRecoverable（恢复判定）', () => {
  const payload = { dirName: 'proj', savedAt: 1, scenes: [{ key: 'a', text: '备份文本' }, { key: 'gone', text: 'x' }] };
  const scenesOf = (text: string): Map<string, { text: string }> => new Map([['a', { text }]]);

  it('同项目且文本不同 → 可恢复；文本相同 → 不打扰', () => {
    expect(pickRecoverable(payload, 'proj', scenesOf('磁盘文本'))).toEqual([{ key: 'a', text: '备份文本' }]);
    expect(pickRecoverable(payload, 'proj', scenesOf('备份文本'))).toEqual([]);
  });

  it('不同项目/无快照/场景已不存在 → 不恢复', () => {
    expect(pickRecoverable(payload, '别的项目', scenesOf('磁盘文本'))).toEqual([]);
    expect(pickRecoverable(null, 'proj', scenesOf('磁盘文本'))).toEqual([]);
    expect(pickRecoverable(payload, 'proj', new Map())).toEqual([]); // gone/a 都不在内存
  });
});
