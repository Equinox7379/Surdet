/**
 * 编辑器崩溃保险（autosave.ts）纯逻辑测试。
 * 失败用例先行：非法存储内容必须静默降级（不抛错），恢复判定必须限定同项目。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_KEY,
  autosaveStorageKey,
  buildAutosave,
  clearAutosave,
  matchingAutosaveProjectIdentity,
  parseAutosave,
  pickRecoverable,
  pickRecoverableTimelines,
  preserveAutosaveTimelineConflicts,
  readAutosave,
  resolveAutosaveProjectIdentity,
  unresolvedAutosaveTimelineConflicts,
  writeAutosave,
} from '../src/autosave.js';

afterEach(() => vi.unstubAllGlobals());

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

  it('同 id 的恢复路径不同仍需恢复 file 身份', () => {
    const filePayload = {
      ...payload,
      timelines: [{ id: 'disk', file: 'nested/disk.json', text: '磁盘\n', eol: '\n' as const }],
    };
    expect(pickRecoverableTimelines(filePayload, 'proj', [{ ...diskEntry, file: 'disk.json' }]))
      .toEqual(filePayload.timelines);
  });

  it('legacy/不同项目/无快照不恢复 timeline', () => {
    expect(pickRecoverableTimelines({ dirName: 'proj', savedAt: 1, scenes: [] }, 'proj', [])).toEqual([]);
    expect(pickRecoverableTimelines(payload, '别的项目', [diskEntry])).toEqual([]);
    expect(pickRecoverableTimelines(null, 'proj', [diskEntry])).toEqual([]);
  });
});

describe('preserveAutosaveTimelineConflicts（冲突证据保全）', () => {
  it('即使当前没有其他 dirty 内容也跨定时 tick 保留冲突正文', () => {
    const conflict = { id: 'same', file: 'nested/same.json', text: 'recovered\n', eol: '\n' as const };
    const next = preserveAutosaveTimelineConflicts(null, 'proj', [conflict], 20);

    expect(next).toEqual({ dirName: 'proj', savedAt: 20, scenes: [], timelines: [conflict] });
    expect(parseAutosave(JSON.stringify(next))).toEqual(next);
  });

  it('与新的 dirty payload 合并且不重复同一 id/file 身份', () => {
    const conflict = { id: 'same', file: 'nested/same.json', text: 'recovered\n', eol: '\n' as const };
    const payload = { dirName: 'proj', savedAt: 10, scenes: [{ key: 'scene', text: 'dirty' }], timelines: [conflict] };
    expect(preserveAutosaveTimelineConflicts(payload, 'proj', [conflict], 21)).toEqual({
      ...payload,
      savedAt: 21,
    });
  });

  it('同 identity 已有较新 dirty 正文时不让旧冲突覆盖新编辑', () => {
    const conflict = { id: 'same', file: 'nested/same.json', text: 'old recovered\n', eol: '\n' as const };
    const fresh = { id: 'same', file: 'nested/same.json', text: 'new dirty\n', eol: '\n' as const };
    const payload = { dirName: 'proj', savedAt: 10, scenes: [], timelines: [fresh] };

    expect(preserveAutosaveTimelineConflicts(payload, 'proj', [conflict], 21)?.timelines).toEqual([fresh]);
    expect(unresolvedAutosaveTimelineConflicts([conflict], [{ id: 'same', file: 'nested/same.json' }])).toEqual([]);
  });
});

describe('autosave 项目隔离存储', () => {
  const installStorage = () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    return values;
  };

  it('项目 B 的写入和清理不会删除项目 A 的未保存正文', () => {
    const values = installStorage();
    const projectA = { dirName: 'game', projectId: 'project-a', savedAt: 1, scenes: [{ key: 'a', text: 'A dirty' }] };
    const projectB = { dirName: 'game', projectId: 'project-b', savedAt: 2, scenes: [{ key: 'b', text: 'B dirty' }] };

    writeAutosave(projectA);
    writeAutosave(projectB);
    clearAutosave('project-b', 'game');

    expect(readAutosave('project-a', 'game')).toEqual(projectA);
    expect(readAutosave('project-b', 'game')).toBeNull();
    expect(values.has(autosaveStorageKey('project-a'))).toBe(true);
  });

  it('不自动读取或删除无法证明物理项目身份的旧版单槽快照', () => {
    const values = installStorage();
    const legacy = { dirName: 'legacy', savedAt: 1, scenes: [{ key: 'a', text: 'dirty' }] };
    values.set(AUTOSAVE_KEY, JSON.stringify(legacy));

    expect(readAutosave('other-id', 'other')).toBeNull();
    expect(readAutosave('legacy-id', 'legacy')).toBeNull();
    clearAutosave('other-id', 'other');
    expect(values.has(AUTOSAVE_KEY)).toBe(true);
    clearAutosave('legacy-id', 'legacy');
    expect(values.has(AUTOSAVE_KEY)).toBe(true);
  });

  it('无法持久证明物理目录身份时 fail-closed，不按名称或内容猜测', async () => {
    await expect(resolveAutosaveProjectIdentity(null)).resolves.toBeNull();
    const payloadWithoutIdentity = { dirName: 'game', savedAt: 1, scenes: [{ key: 'a', text: 'dirty' }] };
    const values = installStorage();
    writeAutosave(payloadWithoutIdentity);
    expect(values.size).toBe(0);
  });

  it('isSameEntry 比较异常会向 resolver 传播并触发 fail-closed', async () => {
    const stored = {} as FileSystemDirectoryHandle;
    const same = { isSameEntry: vi.fn(async () => true) } as unknown as FileSystemDirectoryHandle;
    const broken = { isSameEntry: vi.fn(async () => { throw new Error('permission lost'); }) } as unknown as FileSystemDirectoryHandle;

    await expect(matchingAutosaveProjectIdentity(same, [{ id: 'physical-project', handle: stored }]))
      .resolves.toBe('physical-project');
    await expect(matchingAutosaveProjectIdentity(broken, [{ id: 'physical-project', handle: stored }]))
      .rejects.toThrow('permission lost');
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
