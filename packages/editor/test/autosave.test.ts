/**
 * 编辑器崩溃保险（autosave.ts）纯逻辑测试。
 * 失败用例先行：非法存储内容必须静默降级（不抛错），恢复判定必须限定同项目。
 */
import { describe, expect, it } from 'vitest';
import {
  buildAutosave,
  parseAutosave,
  pickRecoverable,
  pickRecoverableTimelines,
} from '../src/autosave.js';

describe('buildAutosave（快照构建）', () => {
  it('仅收 dirty 场景；全干净返回 null', () => {
    const scenes = new Map([
      ['a', { text: 'A改过', dirty: true }],
      ['b', { text: 'B干净', dirty: false }],
    ]);
    expect(buildAutosave('proj', scenes, [], 999)).toEqual({
      dirName: 'proj',
      savedAt: 999,
      scenes: [{ key: 'a', text: 'A改过' }],
    });
    expect(buildAutosave('proj', new Map([['b', { text: 'x', dirty: false }]]), [], 1)).toBeNull();
    expect(buildAutosave('proj', new Map(), [], 1)).toBeNull();
  });

  it('timeline-only 与 mixed 都保留精确文本/EOL；仅两类都干净才返回 null', () => {
    const dirtyTimelines = [
      { id: 'lf', file: 'lf.json', text: '{\n  "id": "lf"\n}\n', eol: '\n' as const, dirty: true },
      { id: 'crlf', file: 'crlf.json', text: '{\r\n  "id": "crlf"\r\n}\r\n', eol: '\r\n' as const, dirty: true },
      { id: 'clean', file: 'clean.json', text: '{}\n', eol: '\n' as const, dirty: false },
    ];

    expect(buildAutosave('proj', new Map(), dirtyTimelines, 10)).toEqual({
      dirName: 'proj',
      savedAt: 10,
      scenes: [],
      timelines: [
        { id: 'lf', file: 'lf.json', text: '{\n  "id": "lf"\n}\n', eol: '\n' },
        { id: 'crlf', file: 'crlf.json', text: '{\r\n  "id": "crlf"\r\n}\r\n', eol: '\r\n' },
      ],
    });

    expect(buildAutosave(
      'proj',
      new Map([['scene', { text: 'scene dirty', dirty: true }]]),
      dirtyTimelines,
      11,
    )).toEqual({
      dirName: 'proj',
      savedAt: 11,
      scenes: [{ key: 'scene', text: 'scene dirty' }],
      timelines: [
        { id: 'lf', file: 'lf.json', text: '{\n  "id": "lf"\n}\n', eol: '\n' },
        { id: 'crlf', file: 'crlf.json', text: '{\r\n  "id": "crlf"\r\n}\r\n', eol: '\r\n' },
      ],
    });

    expect(buildAutosave(
      'proj',
      new Map([['scene', { text: 'clean', dirty: false }]]),
      [{ id: 'clean', file: 'clean.json', text: '{}\n', eol: '\n', dirty: false }],
      12,
    )).toBeNull();
  });
});

describe('parseAutosave（存储内容形状校验）', () => {
  it('合法载荷往返一致', () => {
    const payload = { dirName: 'p', savedAt: 5, scenes: [{ key: 'k', text: 't' }] };
    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
  });

  it('legacy scenes-only 继续可读；timeline 条目保留 LF/CRLF 并跳过坏条目', () => {
    const legacy = { dirName: 'legacy', savedAt: 4, scenes: [{ key: 'old', text: 'scene' }] };
    expect(parseAutosave(JSON.stringify(legacy))).toEqual(legacy);

    expect(parseAutosave(JSON.stringify({
      dirName: 'p',
      savedAt: 5,
      scenes: [],
      timelines: [
        { id: 'lf', file: 'lf.json', text: '{}\n', eol: '\n' },
        { id: 'crlf', file: 'crlf.json', text: '{}\r\n', eol: '\r\n' },
        { id: 'bad-eol', file: 'bad.json', text: '{}', eol: '\r' },
        { id: 7, file: 'bad.json', text: '{}', eol: '\n' },
      ],
    }))).toEqual({
      dirName: 'p',
      savedAt: 5,
      scenes: [],
      timelines: [
        { id: 'lf', file: 'lf.json', text: '{}\n', eol: '\n' },
        { id: 'crlf', file: 'crlf.json', text: '{}\r\n', eol: '\r\n' },
      ],
    });
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

describe('pickRecoverableTimelines（时间轴恢复判定）', () => {
  const diskEntry = { id: 'disk', text: '磁盘\n', eol: '\n' as const };
  const payload = {
    dirName: 'proj',
    savedAt: 1,
    scenes: [],
    timelines: [
      { id: 'disk', file: 'disk.json', text: '备份\r\n', eol: '\r\n' as const },
      { id: 'new', file: 'new.json', text: '新建未保存\n', eol: '\n' as const },
    ],
  };

  it('选择磁盘内容不同与新建未落盘两类，且返回精确 EOL', () => {
    expect(pickRecoverableTimelines(payload, 'proj', [diskEntry])).toEqual(payload.timelines);
  });

  it('文本相同但 EOL 不同仍恢复；文本/EOL 都相同才不打扰', () => {
    const eolOnlyPayload = {
      ...payload,
      timelines: [{ id: 'disk', file: 'disk.json', text: '磁盘\n', eol: '\r\n' as const }],
    };
    expect(pickRecoverableTimelines(eolOnlyPayload, 'proj', [diskEntry])).toEqual(eolOnlyPayload.timelines);

    const exactPayload = {
      ...payload,
      timelines: [{ id: 'disk', file: 'disk.json', text: '磁盘\n', eol: '\n' as const }],
    };
    expect(pickRecoverableTimelines(exactPayload, 'proj', [diskEntry])).toEqual([]);
  });

  it('legacy/不同项目/无快照不恢复 timeline', () => {
    expect(pickRecoverableTimelines({ dirName: 'proj', savedAt: 1, scenes: [] }, 'proj', [])).toEqual([]);
    expect(pickRecoverableTimelines(payload, '别的项目', [diskEntry])).toEqual([]);
    expect(pickRecoverableTimelines(null, 'proj', [diskEntry])).toEqual([]);
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
