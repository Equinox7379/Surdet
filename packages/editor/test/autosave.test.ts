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
  inspectSceneAutosaveRecovery,
  matchingAutosaveProjectIdentity,
  parseAutosave,
  pickRecoverable,
  pickRecoverableTimelines,
  preserveAutosaveTimelineConflicts,
  readAutosave,
  resolveAutosaveProjectIdentity,
  settlePendingSceneCommit,
  unresolvedAutosaveTimelineConflicts,
  writeAutosave,
} from '../src/autosave.js';
import { createTimeline, stringifyTimeline } from '../src/timeline-model.js';

type Eol = '\r\n' | '\n';

function timelineText(definitionId: string, eol: Eol = '\n', durationMs = 1200): string {
  return stringifyTimeline({ ...createTimeline(definitionId), durationMs }, eol);
}

afterEach(() => vi.unstubAllGlobals());

describe('buildAutosave（快照构建）', () => {
  it('场景配置改名和正文一起备份/重放；缺少配置、映射或回执时不部分收束', () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const scene = { id: 'new', file: 'new.gal', text: '@scene new\n后续编辑\n', dirty: true, eol: '\n', persistedSha256: 'a'.repeat(64) };
    const pending = [{ kind: 'rename' as const, id: 'old', file: 'old.gal', replacementKey: 'new', affectedSceneKeys: ['new'], operationId, planFingerprint: 'b'.repeat(64) }];
    const configRenames = [{ from: 'old', to: 'new' }];
    const configWrites = [{ path: 'content/config/events.json', text: '{"events":[{"scene":"new"}]}', expectedSha256: 'c'.repeat(64) }];
    const writes = [{ path: 'content/scenario/new.gal', text: '@scene new\n', expectedSha256: null }, ...configWrites];
    const payload = buildAutosave('proj', new Map([['new', scene]]), [], 1, 'project', pending,
      { requestId: operationId, plans: [{ operationId, planFingerprint: 'b'.repeat(64) }], writes, deletedPaths: ['content/scenario/old.gal'], configRenames }, configWrites, configRenames)!;
    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
    const broken = structuredClone(payload);
    delete broken.sceneTransaction!.configWrites;
    expect(parseAutosave(JSON.stringify(broken))).toBeNull();
    broken.sceneTransaction!.configWrites = [];
    expect(parseAutosave(JSON.stringify(broken))).toBeNull();
    const receipt = { requestId: operationId, status: 'COMMITTED' as const, writes: writes.map(write => ({ path: write.path, sha256: 'd'.repeat(64) })), deletedPaths: ['content/scenario/old.gal'] };
    expect(settlePendingSceneCommit(payload, { ...receipt, writes: receipt.writes.slice(0, 1) })).toBeNull();
    const settled = settlePendingSceneCommit(payload, receipt)!;
    expect(settled.sceneTransaction).toBeUndefined();
    expect(settled.pendingSceneCommit).toBeUndefined();
    expect(settled.scenes[0]!.text).toBe(scene.text);
  });
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

  it('把场景改名、新场景正文与全部引用改写封装为同一恢复组', () => {
    const fingerprint = 'a'.repeat(64);
    const scenes = new Map([
      ['chapter/new', {
        id: 'new', file: 'chapter/new.gal', text: '@scene new\nNew.\n', eol: '\n',
        dirty: true, persistedSha256: fingerprint,
      }],
      ['chapter/reader', {
        id: 'reader', file: 'chapter/reader.gal', text: '@jump new\n', eol: '\n',
        dirty: true, persistedSha256: 'b'.repeat(64),
      }],
    ]);
    const pending = [{
      kind: 'rename' as const,
      id: 'old',
      file: 'chapter/old.gal',
      replacementKey: 'chapter/new',
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      planFingerprint: 'c'.repeat(64),
      affectedSceneKeys: ['chapter/new', 'chapter/reader'],
    }];

    const payload = buildAutosave('proj', scenes, [], 12, 'project', pending);
    expect(payload?.sceneTransaction).toEqual({ pendingDeletes: pending });
    expect(payload?.scenes.map((entry) => entry.key)).toEqual(['chapter/new', 'chapter/reader']);
    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
  });

  it('只有待删除计划、没有 dirty 正文时也保留自动备份', () => {
    const pending = [{
      kind: 'delete' as const,
      id: 'old',
      file: 'chapter/old.gal',
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      planFingerprint: 'c'.repeat(64),
    }];
    expect(buildAutosave('proj', new Map(), [], 13, 'project', pending)).toEqual({
      dirName: 'proj',
      projectId: 'project',
      savedAt: 13,
      scenes: [],
      sceneTransaction: { pendingDeletes: pending },
    });
  });

  it('章节移动与缺省入口一起重放，回执收束后不遗留待固定入口', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    const scene = { id: 'start', file: '第一章/start.GAL', text: '@scene start\r\n', eol: '\r\n',
      dirty: true, persistedSha256: 'a'.repeat(64), pendingEntryScene: 'start' };
    const pending = [{ kind: 'rename' as const, id: 'start', file: 'start.GAL', replacementKey: '第一章/start',
      operationId: requestId, planFingerprint: 'b'.repeat(64), affectedSceneKeys: ['第一章/start'] }];
    const writes = [
      { path: 'content/scenario/第一章/start.GAL', text: scene.text, expectedSha256: null },
      { path: 'game.config.json', text: '{"entryScene":"start"}', expectedSha256: 'c'.repeat(64) },
    ];
    const payload = buildAutosave('proj', new Map([['第一章/start', scene]]), [], 1, 'project', pending,
      { requestId, writes, plans: [{ operationId: requestId, planFingerprint: pending[0]!.planFingerprint }], deletedPaths: ['content/scenario/start.GAL'] });
    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
    const result = { requestId, status: 'COMMITTED' as const, deletedPaths: ['content/scenario/start.GAL'],
      writes: writes.map(write => ({ path: write.path, sha256: 'd'.repeat(64) })) };
    const settled = settlePendingSceneCommit(payload!, result);
    expect(settled).not.toBeNull();
    expect(settled!.scenes[0]!.pendingEntryScene).toBeUndefined();
    expect(settled!.scenes[0]!.file).toBe(scene.file);
    expect(settlePendingSceneCommit(payload!, { ...result, writes: result.writes.slice(0, 1) })).toBeNull();
  });

  it('保存回包丢失时冻结首次请求，并在回执到达后保留随后编辑', () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    const receiptSha256 = 'd'.repeat(64);
    const payload = buildAutosave('proj', new Map([['chapter/fresh', {
      id: 'fresh',
      file: 'chapter/fresh.gal',
      text: '@scene fresh\n随后编辑。\n',
      eol: '\n',
      dirty: true,
      pendingCreateOperationId: requestId,
    }]]), [], 14, 'project', [], {
      requestId,
      plans: [],
      writes: [{
        path: 'content/scenario/chapter/fresh.gal',
        text: '@scene fresh\n首次提交。\n',
        expectedSha256: null,
      }],
      deletedPaths: [],
    });

    expect(payload).not.toBeNull();
    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
    expect(settlePendingSceneCommit(payload!, {
      requestId,
      status: 'COMMITTED',
      writes: [{ path: 'content/scenario/chapter/fresh.gal', sha256: receiptSha256 }],
      deletedPaths: [],
    })).toEqual({
      dirName: 'proj',
      projectId: 'project',
      savedAt: 14,
      scenes: [{
        key: 'chapter/fresh',
        id: 'fresh',
        file: 'chapter/fresh.gal',
        text: '@scene fresh\n随后编辑。\n',
        eol: '\n',
        persistedSha256: receiptSha256,
      }],
    });
    expect(settlePendingSceneCommit(payload!, {
      requestId,
      status: 'COMMITTED',
      writes: [],
      deletedPaths: [],
    })).toBeNull();
  });

  it('改名计划与同批新场景可共享改名请求身份，不误判自动备份损坏', () => {
    const planId = '123e4567-e89b-42d3-a456-426614174000';
    const createId = '223e4567-e89b-42d3-a456-426614174000';
    const pendingDelete = {
      kind: 'rename' as const,
      id: 'old',
      file: 'old.gal',
      replacementKey: 'new',
      operationId: planId,
      planFingerprint: 'a'.repeat(64),
      affectedSceneKeys: ['new'],
    };
    const payload = buildAutosave('proj', new Map([
      ['new', {
        id: 'new', file: 'new.gal', text: '@scene new\n', eol: '\n', dirty: true,
        persistedSha256: 'b'.repeat(64),
      }],
      ['fresh', {
        id: 'fresh', file: 'fresh.gal', text: '@scene fresh\n', eol: '\n', dirty: true,
        pendingCreateOperationId: createId,
      }],
    ]), [], 15, 'project', [pendingDelete], {
      requestId: planId,
      plans: [{ operationId: planId, planFingerprint: 'a'.repeat(64) }],
      writes: [
        { path: 'content/scenario/new.gal', text: '@scene new\n', expectedSha256: null },
        { path: 'content/scenario/fresh.gal', text: '@scene fresh\n', expectedSha256: null },
      ],
      deletedPaths: ['content/scenario/old.gal'],
    });

    expect(parseAutosave(JSON.stringify(payload))).toEqual(payload);
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
        { id: 'lf', file: 'lf.json', text: timelineText('lf'), eol: '\n' },
        { id: 'crlf', file: 'crlf.json', text: timelineText('crlf', '\r\n'), eol: '\r\n' },
        { id: 'bad-eol', file: 'bad.json', text: '{}', eol: '\r' },
        { id: 7, file: 'bad.json', text: '{}', eol: '\n' },
      ],
      timelineConflicts: [
        { id: 'recovered', file: 'recovered.json', text: timelineText('recovered'), eol: '\n' },
        { id: 'bad-eol', file: 'bad.json', text: '{}', eol: '\r' },
        { id: 7, file: 'bad.json', text: '{}', eol: '\n' },
      ],
    }))).toEqual({
      dirName: 'p',
      savedAt: 5,
      scenes: [],
      timelines: [
        { id: 'lf', file: 'lf.json', text: timelineText('lf'), eol: '\n' },
        { id: 'crlf', file: 'crlf.json', text: timelineText('crlf', '\r\n'), eol: '\r\n' },
      ],
      timelineConflicts: [
        { id: 'recovered', file: 'recovered.json', text: timelineText('recovered'), eol: '\n' },
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
    expect(parseAutosave('{"dirName":"p","savedAt":1,"scenes":[],"timelineConflicts":{}}')).toBeNull();
    // 条目级容错：坏条目跳过、好条目保留
    expect(parseAutosave('{"dirName":"p","savedAt":1,"scenes":[{"key":"a","text":"t"},42,{"key":7}]}'))
      .toEqual({ dirName: 'p', savedAt: 1, scenes: [{ key: 'a', text: 't' }] });
  });
});

describe('pickRecoverableTimelines（时间轴恢复判定）', () => {
  const diskEntry = { id: 'disk', text: '磁盘\n', eol: '\n' as const };
  const payload = {
    dirName: 'proj',
    projectId: 'project',
    savedAt: 1,
    scenes: [],
    timelines: [
      { id: 'disk', file: 'disk.json', text: '备份\r\n', eol: '\r\n' as const },
      { id: 'new', file: 'new.json', text: '新建未保存\n', eol: '\n' as const },
    ],
  };

  it('选择磁盘内容不同与新建未落盘两类，且返回精确 EOL', () => {
    expect(pickRecoverableTimelines(payload, 'project', [diskEntry])).toEqual(payload.timelines);
  });

  it('文本相同但 EOL 不同仍恢复；文本/EOL 都相同才不打扰', () => {
    const eolOnlyPayload = {
      ...payload,
      timelines: [{ id: 'disk', file: 'disk.json', text: '磁盘\n', eol: '\r\n' as const }],
    };
    expect(pickRecoverableTimelines(eolOnlyPayload, 'project', [diskEntry])).toEqual(eolOnlyPayload.timelines);

    const exactPayload = {
      ...payload,
      timelines: [{ id: 'disk', file: 'disk.json', text: '磁盘\n', eol: '\n' as const }],
    };
    expect(pickRecoverableTimelines(exactPayload, 'project', [diskEntry])).toEqual([]);
  });

  it('同 id 的恢复路径不同仍需恢复 file 身份', () => {
    const filePayload = {
      ...payload,
      timelines: [{ id: 'disk', file: 'nested/disk.json', text: '磁盘\n', eol: '\n' as const }],
    };
    expect(pickRecoverableTimelines(filePayload, 'project', [{ ...diskEntry, file: 'disk.json' }]))
      .toEqual(filePayload.timelines);
  });

  it('legacy/不同项目/无快照不恢复 timeline', () => {
    expect(pickRecoverableTimelines({ dirName: 'proj', savedAt: 1, scenes: [] }, 'project', [])).toEqual([]);
    expect(pickRecoverableTimelines(payload, 'another-project', [diskEntry])).toEqual([]);
    expect(pickRecoverableTimelines(null, 'project', [diskEntry])).toEqual([]);
  });
});

describe('preserveAutosaveTimelineConflicts（冲突证据保全）', () => {
  const conflict = {
    id: 'same',
    file: 'same.json',
    text: timelineText('recovered', '\n', 1800),
    eol: '\n' as const,
  };
  const fresh = {
    id: 'same',
    file: 'same.json',
    text: timelineText('same', '\n', 2200),
    eol: '\n' as const,
  };

  it('即使当前没有其他 dirty 内容也跨定时 tick 保留冲突正文', () => {
    const next = preserveAutosaveTimelineConflicts(null, 'proj', [conflict], 20);

    expect(next).toMatchObject({
      dirName: 'proj',
      savedAt: 20,
      scenes: [],
      timelineConflicts: [conflict],
    });
    expect(parseAutosave(JSON.stringify(next))).toEqual(next);
  });

  it('fresh dirty 与冲突使用同一 outer tuple 时仍分别保留，不互相覆盖', () => {
    const payload = { dirName: 'proj', savedAt: 10, scenes: [{ key: 'scene', text: 'dirty' }], timelines: [fresh] };
    const next = preserveAutosaveTimelineConflicts(payload, 'proj', [conflict], 21);

    expect(next).toMatchObject({
      ...payload,
      savedAt: 21,
      timelines: [fresh],
      timelineConflicts: [conflict],
    });
  });

  it('只有 canonical exact id/file/text/eol 才能清除冲突；bytes 或内部 ID 不同仍 unresolved', () => {
    expect(unresolvedAutosaveTimelineConflicts([conflict], [{
      id: 'same',
      file: 'same.json',
      text: fresh.text,
      eol: fresh.eol,
    }])).toEqual([conflict]);
    expect(unresolvedAutosaveTimelineConflicts([conflict], [{
      id: 'same',
      file: 'same.json',
      text: timelineText('other-definition'),
      eol: '\n',
    }])).toEqual([conflict]);
    expect(unresolvedAutosaveTimelineConflicts([conflict], [{
      id: conflict.id,
      file: conflict.file,
      text: conflict.text,
      eol: conflict.eol,
    }])).toEqual([conflict]);

    const canonicalConflict = { ...conflict, text: timelineText('same', '\n', 1800) };
    expect(unresolvedAutosaveTimelineConflicts([canonicalConflict], [{
      id: canonicalConflict.id,
      file: canonicalConflict.file,
      text: canonicalConflict.text,
      eol: canonicalConflict.eol,
    }])).toEqual([]);
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
    clearAutosave('project-b');

    expect(readAutosave('project-a')).toEqual(projectA);
    expect(readAutosave('project-b')).toBeNull();
    expect(values.has(autosaveStorageKey('project-a'))).toBe(true);
  });

  it('同一物理项目改名后仍通过 isSameEntry 取回 projectId 并恢复备份', async () => {
    const values = installStorage();
    const originalHandle = { name: 'old-name' } as unknown as FileSystemDirectoryHandle;
    const renamedHandle = {
      name: 'new-name',
      isSameEntry: vi.fn(async (other: FileSystemHandle) => other === originalHandle),
    } as unknown as FileSystemDirectoryHandle;
    const payload = {
      dirName: 'old-name',
      projectId: 'physical-project',
      savedAt: 3,
      scenes: [{ key: 'scene', text: '改名前未保存正文' }],
      timelines: [{ id: 'timeline', file: 'timeline.json', text: '{}\n', eol: '\n' as const }],
    };
    writeAutosave(payload);

    const resolvedProjectId = await matchingAutosaveProjectIdentity(renamedHandle, [{
      id: 'physical-project',
      handle: originalHandle,
    }]);
    expect(resolvedProjectId).toBe('physical-project');
    expect(renamedHandle.isSameEntry).toHaveBeenCalledWith(originalHandle);
    const stored = readAutosave(resolvedProjectId!);
    expect(stored).toEqual(payload);
    expect(pickRecoverable(stored, resolvedProjectId!, new Map([
      ['scene', { text: '磁盘正文' }],
    ]))).toEqual(payload.scenes);
    expect(pickRecoverableTimelines(stored, resolvedProjectId!, [
      { id: 'timeline', file: 'timeline.json', text: '{"disk":true}\n', eol: '\n' as const },
    ])).toEqual(payload.timelines);
    expect(values.has(autosaveStorageKey('physical-project'))).toBe(true);
  });

  it('存储键与 payload.projectId 不一致时 fail-closed', () => {
    const values = installStorage();
    values.set(autosaveStorageKey('project-a'), JSON.stringify({
      dirName: 'game',
      projectId: 'project-b',
      savedAt: 4,
      scenes: [{ key: 'scene', text: '不可读' }],
    }));

    expect(readAutosave('project-a')).toBeNull();
  });

  it('不自动读取或删除无法证明物理项目身份的旧版单槽快照', () => {
    const values = installStorage();
    const legacy = { dirName: 'legacy', savedAt: 1, scenes: [{ key: 'a', text: 'dirty' }] };
    values.set(AUTOSAVE_KEY, JSON.stringify(legacy));

    expect(readAutosave('other-id')).toBeNull();
    expect(readAutosave('legacy-id')).toBeNull();
    clearAutosave('other-id');
    expect(values.has(AUTOSAVE_KEY)).toBe(true);
    clearAutosave('legacy-id');
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
  const payload = { dirName: 'proj', projectId: 'project', savedAt: 1, scenes: [{ key: 'a', text: '备份文本' }, { key: 'gone', text: 'x' }] };
  const scenesOf = (text: string): Map<string, { text: string }> => new Map([['a', { text }]]);

  it('同项目且文本不同 → 可恢复；文本相同 → 不打扰', () => {
    expect(pickRecoverable(payload, 'project', scenesOf('磁盘文本'))).toEqual([{ key: 'a', text: '备份文本' }]);
    expect(pickRecoverable(payload, 'project', scenesOf('备份文本'))).toEqual([]);
  });

  it('不同项目/无快照/场景已不存在 → 不恢复', () => {
    expect(pickRecoverable(payload, 'another-project', scenesOf('磁盘文本'))).toEqual([]);
    expect(pickRecoverable(null, 'project', scenesOf('磁盘文本'))).toEqual([]);
    expect(pickRecoverable(payload, 'project', new Map())).toEqual([]); // gone/a 都不在内存
  });
});

describe('inspectSceneAutosaveRecovery（场景路径事务整组恢复）', () => {
  const sourceSha = 'a'.repeat(64);
  const readerSha = 'b'.repeat(64);
  const pending = {
    kind: 'rename' as const,
    id: 'old',
    file: 'chapter/old.gal',
    replacementKey: 'chapter/new',
    operationId: '123e4567-e89b-42d3-a456-426614174000',
    planFingerprint: 'c'.repeat(64),
    affectedSceneKeys: ['chapter/new', 'chapter/reader'],
  };
  const payload = {
    dirName: 'proj',
    projectId: 'project',
    savedAt: 10,
    scenes: [
      {
        key: 'chapter/new', id: 'new', file: 'chapter/new.gal', eol: '\n' as const,
        text: '@scene new\nNew.\n', persistedSha256: sourceSha,
      },
      {
        key: 'chapter/reader', id: 'reader', file: 'chapter/reader.gal', eol: '\n' as const,
        text: '@jump new\n', persistedSha256: readerSha,
      },
    ],
    sceneTransaction: { pendingDeletes: [pending] },
  };
  const diskScenes = new Map([
    ['chapter/old', {
      id: 'old', file: 'chapter/old.gal', text: '@scene old\nOld.\n', persistedSha256: sourceSha,
    }],
    ['chapter/reader', {
      id: 'reader', file: 'chapter/reader.gal', text: '@jump old\n', persistedSha256: readerSha,
    }],
  ]);

  it('完整成员齐备时同时恢复新场景、引用与待提交计划', () => {
    expect(inspectSceneAutosaveRecovery(payload, 'project', diskScenes)).toEqual({
      status: 'recoverable',
      scenes: payload.scenes,
      pendingDeletes: [pending],
    });
  });

  it('新场景快照携带稳定请求身份，并只在磁盘目标仍不存在时恢复', () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    const built = buildAutosave('proj', new Map([['chapter/fresh', {
      id: 'fresh', file: 'chapter/fresh.gal', text: '@scene fresh\n', eol: '\n', dirty: true,
      pendingCreateOperationId: operationId,
    }]]), [], 12, 'project');
    expect(built?.sceneTransaction).toEqual({
      pendingDeletes: [],
      pendingCreates: [{ key: 'chapter/fresh', operationId }],
    });
    expect(inspectSceneAutosaveRecovery(built, 'project', diskScenes)).toMatchObject({
      status: 'recoverable',
      scenes: [expect.objectContaining({ key: 'chapter/fresh', pendingCreateOperationId: operationId })],
    });

    const occupied = new Map(diskScenes);
    occupied.set('chapter/fresh', {
      id: 'fresh', file: 'chapter/fresh.gal', text: '外部文件', persistedSha256: 'f'.repeat(64),
    });
    expect(inspectSceneAutosaveRecovery(built, 'project', occupied).status).toBe('blocked');
  });

  it('缺少新场景或任一引用快照时整组拒绝，不返回部分正文', () => {
    const missingTarget = { ...payload, scenes: payload.scenes.slice(1) };
    const missingReference = { ...payload, scenes: payload.scenes.slice(0, 1) };
    expect(inspectSceneAutosaveRecovery(missingTarget, 'project', diskScenes)).toEqual({
      status: 'blocked', scenes: [], pendingDeletes: [],
    });
    expect(inspectSceneAutosaveRecovery(missingReference, 'project', diskScenes)).toEqual({
      status: 'blocked', scenes: [], pendingDeletes: [],
    });
  });

  it('崩溃期间源文件或引用文件已被外部修改时整组保持封存', () => {
    const changedSource = new Map(diskScenes);
    changedSource.set('chapter/old', { ...changedSource.get('chapter/old')!, persistedSha256: 'd'.repeat(64) });
    const changedReader = new Map(diskScenes);
    changedReader.set('chapter/reader', { ...changedReader.get('chapter/reader')!, persistedSha256: 'e'.repeat(64) });
    expect(inspectSceneAutosaveRecovery(payload, 'project', changedSource).status).toBe('blocked');
    expect(inspectSceneAutosaveRecovery(payload, 'project', changedReader).status).toBe('blocked');
  });

  it('绝对路径和反斜杠路径不能进入场景恢复事务', () => {
    for (const file of ['C:/outside/old.gal', '/outside/old.gal', 'chapter\\old.gal']) {
      const unsafe = {
        ...payload,
        sceneTransaction: { pendingDeletes: [{ ...pending, file }] },
      };
      expect(inspectSceneAutosaveRecovery(unsafe, 'project', diskScenes)).toEqual({
        status: 'blocked', scenes: [], pendingDeletes: [],
      });
    }
  });

  it('旧快照含磁盘不存在的场景时不部分恢复其他引用', () => {
    const legacy = {
      dirName: 'proj', projectId: 'project', savedAt: 11,
      scenes: [{ key: 'chapter/new', text: 'new' }, { key: 'chapter/reader', text: '@jump new' }],
    };
    expect(inspectSceneAutosaveRecovery(legacy, 'project', diskScenes)).toEqual({
      status: 'blocked', scenes: [], pendingDeletes: [],
    });
  });
});
