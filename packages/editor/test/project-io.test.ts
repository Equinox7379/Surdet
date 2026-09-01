import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindProjectIoHooks,
  loadDemoProject,
  openProjectFromHandle,
  quarantineTimelineAutosaveEntries,
  readTimelineDir,
  refreshProjectAssetIntelligence,
  repairTimelineAutosaveConflict,
  restoreTimelineAutosaveEntries,
  runProjectWriteOperation,
  saveAll,
} from '../src/project-io.js';
import { state } from '../src/state.js';
import type { SceneEntry, TimelineEntry } from '../src/state.js';
import { createTimeline, stringifyTimeline } from '../src/timeline-model.js';
import { deleteTimeline, nextTimelineId, restorePendingTimelineDeletion } from '../src/panels/timeline-panel.js';
import { pushTimelineSnapshot, takeTimelineUndo, timelineHistoryDepth } from '../src/timeline-history.js';

type FailurePoint = 'create' | 'write' | 'close';
type Eol = '\r\n' | '\n';

function fileHandle(
  failure: FailurePoint | null,
  log: string[],
  name: string,
  initialText = '',
  writes: string[] = [],
): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    isSameEntry: async () => false,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => new File([initialText], name),
    createWritable: async () => {
      log.push(`${name}:createWritable`);
      if (failure === 'create') throw new Error(`${name}:create failed`);
      return {
        write: async (value: FileSystemWriteChunkType) => {
          log.push(`${name}:write`);
          if (failure === 'write') throw new Error(`${name}:write failed`);
          writes.push(String(value));
        },
        close: async () => {
          log.push(`${name}:close`);
          if (failure === 'close') throw new Error(`${name}:close failed`);
        },
      } as unknown as FileSystemWritableFileStream;
    },
  } as unknown as FileSystemFileHandle;
}

function scene(id: string, handle: FileSystemFileHandle, dirty = true): SceneEntry {
  return { id, file: `${id}.gal`, text: `${id} text`, eol: '\n', dirty, handle };
}

function timelineText(definitionId: string, eol: Eol = '\n', durationMs = 1200): string {
  return stringifyTimeline({ ...createTimeline(definitionId), durationMs }, eol);
}

function timeline(
  id: string,
  handle: FileSystemFileHandle,
  dirty = true,
  file = `${id}.json`,
  definitionId = id,
  eol: Eol = '\n',
): TimelineEntry {
  return { id, file, text: timelineText(definitionId, eol), eol, dirty, handle };
}

function definitionCollisionConflict(): {
  target: TimelineEntry;
  conflict: ReturnType<typeof restoreTimelineAutosaveEntries>['conflicts'][number];
} {
  const helperLog: string[] = [];
  const target = timeline('claimed', fileHandle(null, helperLog, 'claimed.json'), false, 'claimed.json', 'recovered');
  state.timelines.push(target);
  const result = restoreTimelineAutosaveEntries([{
    id: 'recovered',
    file: 'recovered.json',
    text: timelineText('recovered', '\r\n', 1800),
    eol: '\r\n',
  }]);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0]).toMatchObject({ reason: 'definition-id-collision' });
  return { target, conflict: result.conflicts[0]! };
}

function timelineMutationSnapshot() {
  return {
    timelines: state.timelines.map((entry) => ({ ...entry })),
    pendingTimelineDeletes: state.pendingTimelineDeletes.map((entry) => ({ ...entry })),
    pendingTimelineRestores: [...state.pendingTimelineRestores.entries()].map(([id, restore]) => [
      id,
      {
        ...restore,
        entry: { ...restore.entry },
        previousCue: restore.previousCue ? { ...restore.previousCue } : null,
      },
    ]),
    currentTimeline: state.currentTimeline,
    currentTimelineCue: state.currentTimelineCue ? { ...state.currentTimelineCue } : null,
    history: timelineHistoryDepth(),
  };
}

function expectTimelineMutationUnchanged(before: ReturnType<typeof timelineMutationSnapshot>): void {
  expect(timelineMutationSnapshot()).toEqual(before);
}

function expectSaveAsNewRejected(
  conflict: ReturnType<typeof definitionCollisionConflict>['conflict'],
  newId: string,
): void {
  const before = timelineMutationSnapshot();
  const result = repairTimelineAutosaveConflict(conflict, { kind: 'save-as-new', newId });
  expect(result.ok).toBe(false);
  expectTimelineMutationUnchanged(before);
}

function directoryHandle(
  name: string,
  directories: Record<string, FileSystemDirectoryHandle> = {},
  files: Record<string, FileSystemFileHandle> = {},
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    isSameEntry: async () => false,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getDirectoryHandle: async (child: string) => {
      const value = directories[child];
      if (!value) throw new Error(`missing directory ${child}`);
      return value;
    },
    getFileHandle: async (child: string) => {
      const value = files[child];
      if (!value) throw new Error(`missing file ${child}`);
      return value;
    },
    values: async function* () {
      yield* Object.values(directories);
      yield* Object.values(files);
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('project-io saveAll 失败隔离与恢复备份语义', () => {
  const status = { textContent: '', className: '', title: '' };
  const log: string[] = [];
  const documentStub = {
    getElementById: () => status,
    createElement: () => ({ click: vi.fn(), href: '', download: '' }),
  };

  beforeEach(() => {
    vi.stubGlobal('document', documentStub);
    state.fsSupported = true;
    state.autosaveProjectId = 'test-project';
    state.dirHandle = {} as FileSystemDirectoryHandle;
    state.scenes.clear();
    state.timelines = [];
    state.pendingTimelineDeletes = [];
    state.pendingTimelineRestores.clear();
    state.current = null;
    state.currentTimeline = null;
    state.projectWriteLock = null;
    log.length = 0;
    status.textContent = '';
    status.className = '';
    status.title = '';
  });

  afterEach(() => {
    state.projectWriteLock = null;
    vi.unstubAllGlobals();
  });

  it('素材整理锁定时在首个写入前拒绝保存全部', async () => {
    const onSaveSettled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaveSettled });
    state.scenes.set('locked', scene('locked', fileHandle(null, log, 'locked.gal')));
    state.projectWriteLock = 'asset-relocation';

    await expect(saveAll()).rejects.toThrow('素材整理进行中');

    expect(log).toEqual([]);
    expect(state.scenes.get('locked')?.dirty).toBe(true);
    expect(onSaveSettled).not.toHaveBeenCalled();
  });

  it('第一个已有场景失败时继续保存第二个场景和时间轴，并保留失败 dirty', async () => {
    const onSaved = vi.fn();
    const onSaveSettled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved, onSaveSettled });
    state.scenes.set('first', scene('first', fileHandle('write', log, 'first')));
    state.scenes.set('second', scene('second', fileHandle(null, log, 'second')));
    state.timelines.push(timeline('intro', fileHandle(null, log, 'intro')));

    await expect(saveAll()).resolves.toBeUndefined();

    expect(log).toContain('second:write');
    expect(log).toContain('intro:write');
    expect(state.scenes.get('first')!.dirty).toBe(true);
    expect(state.scenes.get('second')!.dirty).toBe(false);
    expect(state.timelines[0]!.dirty).toBe(false);
    expect(status.textContent).toMatch(/部分成功/);
    expect(status.title).toBe(status.textContent);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveSettled).toHaveBeenCalledWith({
      hadPendingChanges: true,
      saved: 2,
      removed: 0,
      failures: 1,
      remainingDirty: true,
    });
  });

  it.each<FailurePoint>(['create', 'write', 'close'])('%s 失败时只保留该场景 dirty，不中断其他场景', async (failure) => {
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
    state.scenes.set('bad', scene('bad', fileHandle(failure, log, 'bad')));
    state.scenes.set('good', scene('good', fileHandle(null, log, 'good')));

    await expect(saveAll()).resolves.toBeUndefined();

    expect(state.scenes.get('bad')!.dirty).toBe(true);
    expect(state.scenes.get('good')!.dirty).toBe(false);
    expect(log).toContain('good:write');
    expect(status.textContent).toMatch(/部分成功/);
  });

  it('删除失败纳入汇总，不能调用清除恢复备份的 onSaved', async () => {
    const onSaved = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved });
    state.pendingTimelineDeletes = [{ id: 'old', file: 'old.json' }];
    state.dirHandle = {
      getDirectoryHandle: async () => ({
        getDirectoryHandle: async () => ({ removeEntry: async () => { throw new Error('delete failed'); } }),
      }),
    } as unknown as FileSystemDirectoryHandle;

    await expect(saveAll()).resolves.toBeUndefined();

    expect(state.pendingTimelineDeletes).toHaveLength(1);
    expect(status.textContent).toMatch(/失败|无待保存/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('删除后撤销会取消待删文件，下一次保存不会误删已恢复时间轴', async () => {
    const removeEntry = vi.fn();
    state.dirHandle = {
      getDirectoryHandle: async () => ({
        getDirectoryHandle: async () => ({ removeEntry }),
      }),
    } as unknown as FileSystemDirectoryHandle;
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
    state.timelines.push(timeline('keep', fileHandle(null, log, 'keep'), false));
    state.currentTimeline = 'keep';
    state.currentTimelineCue = { trackIndex: 0, cueIndex: 0 };

    expect(deleteTimeline('keep')).toBe(true);
    expect(state.pendingTimelineDeletes).toHaveLength(1);
    expect(restorePendingTimelineDeletion('keep')).toBe(true);
    expect(state.pendingTimelineDeletes).toEqual([]);

    await saveAll();

    expect(removeEntry).not.toHaveBeenCalled();
    expect(state.timelines.map((entry) => entry.id)).toEqual(['keep']);
    expect(state.currentTimelineCue).toEqual({ trackIndex: 0, cueIndex: 0 });
  });

  it('多个删除墓碑互不覆盖，且待删 id 在保存前不能被新建复用', () => {
    state.timelines.push(
      timeline('timeline_01', fileHandle(null, log, 'timeline_01'), false),
      timeline('timeline_02', fileHandle(null, log, 'timeline_02'), false),
    );
    state.currentTimeline = 'timeline_01';

    expect(deleteTimeline('timeline_01')).toBe(true);
    expect(deleteTimeline('timeline_02')).toBe(true);

    expect([...state.pendingTimelineRestores.keys()].sort()).toEqual(['timeline_01', 'timeline_02']);
    expect(nextTimelineId()).toBe('timeline_03');
    expect(restorePendingTimelineDeletion('timeline_01')).toBe(true);
    expect(restorePendingTimelineDeletion('timeline_02')).toBe(true);
    expect(state.timelines.map((entry) => entry.id).sort()).toEqual(['timeline_01', 'timeline_02']);
  });

  it('物理删除成功后清除墓碑与该 id 的旧历史', async () => {
    const removeEntry = vi.fn();
    state.dirHandle = {
      getDirectoryHandle: async () => ({
        getDirectoryHandle: async () => ({ removeEntry }),
      }),
    } as unknown as FileSystemDirectoryHandle;
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
    state.timelines.push(timeline('gone', fileHandle(null, log, 'gone'), false));
    state.currentTimeline = 'gone';
    pushTimelineSnapshot('gone', 'before');
    expect(deleteTimeline('gone')).toBe(true);

    await saveAll();

    expect(removeEntry).toHaveBeenCalledWith('gone.json');
    expect(state.pendingTimelineDeletes).toEqual([]);
    expect(state.pendingTimelineRestores.has('gone')).toBe(false);
    expect(timelineHistoryDepth('gone')).toEqual({ undo: 0, redo: 0 });
  });

  it('恢复崩溃备份时更新已有时间轴并插入未落盘新时间轴', () => {
    state.timelines.push(timeline('disk', fileHandle(null, log, 'disk'), false));

    restoreTimelineAutosaveEntries([
      { id: 'disk', file: 'disk.json', text: timelineText('disk', '\r\n', 1800), eol: '\r\n' },
      { id: 'new', file: 'nested/new.json', text: timelineText('new', '\n', 1800), eol: '\n' },
    ]);

    const disk = state.timelines.find((entry) => entry.id === 'disk')!;
    const created = state.timelines.find((entry) => entry.id === 'new')!;
    expect(disk).toMatchObject({ text: timelineText('disk', '\r\n', 1800), eol: '\r\n', dirty: true });
    expect(created).toMatchObject({
      id: 'new',
      file: 'nested/new.json',
      text: timelineText('new', '\n', 1800),
      eol: '\n',
      dirty: true,
      handle: null,
    });
  });

  it('精确三元身份恢复后保留原 handle，并通过该 handle 写入恢复正文', async () => {
    const writes: string[] = [];
    const handle = fileHandle(null, log, 'intro.json', '', writes);
    const existing = timeline('intro', handle, false, 'nested/intro.json');
    state.timelines.push(existing);
    const recovered = {
      id: 'intro',
      file: 'nested/intro.json',
      text: timelineText('intro', '\r\n', 1800),
      eol: '\r\n' as const,
    };

    const result = restoreTimelineAutosaveEntries([recovered]);

    expect(result).toMatchObject({ restored: 1, conflicts: [] });
    expect(existing).toMatchObject({
      id: 'intro',
      file: 'nested/intro.json',
      text: recovered.text,
      eol: '\r\n',
      dirty: true,
      handle,
    });
    await saveAll();
    expect(writes).toEqual([recovered.text]);
  });

  it('同一文件但外层 ID 不同返回 same-file-different-id，当前条目零 mutation 且零写入', async () => {
    const writes: string[] = [];
    const handle = fileHandle(null, log, 'shared.json', '', writes);
    const existing = timeline('current', handle, false, 'shared.json');
    const before = { ...existing };
    state.timelines.push(existing);
    state.currentTimeline = 'current';

    const result = restoreTimelineAutosaveEntries([
      { id: 'shared', file: 'shared.json', text: timelineText('shared'), eol: '\n' },
    ]);
    await saveAll();

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'same-file-different-id' });
    expect(existing).toEqual(before);
    expect(state.currentTimeline).toBe('current');
    expect(writes).toEqual([]);
  });

  it('同一外层 ID 但文件不同返回 same-id-different-file 且不改当前条目', async () => {
    const writes: string[] = [];
    const handle = fileHandle(null, log, 'same.json', '', writes);
    const existing = timeline('same', handle, false, 'same.json');
    const before = { ...existing };
    state.timelines.push(existing);
    state.currentTimeline = 'same';

    const result = restoreTimelineAutosaveEntries([
      { id: 'same', file: 'nested/same.json', text: timelineText('same', '\r\n', 1800), eol: '\r\n' },
    ]);
    await saveAll();

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'same-id-different-file' });
    expect(existing).toEqual(before);
    expect(writes).toEqual([]);
  });

  it('恢复正文内部 ID 不同返回 recovered-id-mismatch，不能插入新条目', () => {
    const result = restoreTimelineAutosaveEntries([
      { id: 'mismatch', file: 'mismatch.json', text: timelineText('definition-other'), eol: '\n' },
    ]);

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'recovered-id-mismatch' });
    expect(state.timelines).toEqual([]);
  });

  it('恢复正文不是 JSON 时返回 recovered-json-invalid 且不改变当前状态', () => {
    const result = restoreTimelineAutosaveEntries([
      { id: 'broken', file: 'broken.json', text: '{"version":1,"id":', eol: '\n' },
    ]);

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'recovered-json-invalid' });
    expect(state.timelines).toEqual([]);
    expect(state.currentTimeline).toBeNull();
  });

  it('当前精确 ID/file 的正文不是 JSON 时返回 current-json-invalid 且零 mutation/零写入', async () => {
    const writes: string[] = [];
    const handle = fileHandle(null, log, 'broken.json', '', writes);
    const existing = timeline('broken', handle, false, 'broken.json');
    existing.text = '{"version":1,"id":';
    const before = { ...existing };
    state.timelines.push(existing);
    state.currentTimeline = 'broken';

    const result = restoreTimelineAutosaveEntries([
      { id: 'broken', file: 'broken.json', text: timelineText('broken'), eol: '\n' },
    ]);
    await saveAll();

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'current-json-invalid' });
    expect(existing).toEqual(before);
    expect(writes).toEqual([]);
  });

  it('当前精确 ID/file 的内部 ID 不一致返回 current-id-mismatch 且不静默覆盖', async () => {
    const writes: string[] = [];
    const handle = fileHandle(null, log, 'current.json', '', writes);
    const existing = timeline('current', handle, false, 'current.json', 'other-definition');
    const before = { ...existing };
    state.timelines.push(existing);

    const result = restoreTimelineAutosaveEntries([
      { id: 'current', file: 'current.json', text: timelineText('current'), eol: '\n' },
    ]);
    await saveAll();

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'current-id-mismatch' });
    expect(existing).toEqual(before);
    expect(writes).toEqual([]);
  });

  it('canonical 新时间轴插入时使用 null handle 并标记 dirty', () => {
    const result = restoreTimelineAutosaveEntries([
      { id: 'new_timeline', file: 'nested/new_timeline.json', text: timelineText('new_timeline'), eol: '\n' },
    ]);

    expect(result).toMatchObject({ restored: 1, conflicts: [] });
    expect(state.timelines).toHaveLength(1);
    expect(state.timelines[0]).toMatchObject({
      id: 'new_timeline',
      file: 'nested/new_timeline.json',
      text: timelineText('new_timeline'),
      eol: '\n',
      dirty: true,
      handle: null,
    });
  });

  it('非 canonical 新时间轴返回 recovered-id-mismatch 且不插入', () => {
    const result = restoreTimelineAutosaveEntries([
      { id: 'new_timeline', file: 'nested/other-name.json', text: timelineText('new_timeline'), eol: '\n' },
    ]);

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'recovered-id-mismatch' });
    expect(state.timelines).toEqual([]);
  });

  it.each(['../unsafe.json', '/unsafe.json', 'content/timelines/unsafe.json'])(
    '不安全的自动备份 file %j 不得自动插入或进入 Save All',
    (file) => {
      const result = restoreTimelineAutosaveEntries([{
        id: 'unsafe',
        file,
        text: timelineText('unsafe'),
        eol: '\n',
      }]);

      expect(result.restored).toBe(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ reason: 'recovered-id-mismatch' });
      expect(state.timelines).toEqual([]);
    },
  );

  it('另一个当前条目声明恢复正文内部 ID 时返回 definition-id-collision 且不插入', () => {
    const handle = fileHandle(null, log, 'other.json');
    const existing = timeline('other', handle, false, 'other.json', 'claimed');
    const before = { ...existing };
    state.timelines.push(existing);

    const result = restoreTimelineAutosaveEntries([
      { id: 'claimed', file: 'claimed.json', text: timelineText('claimed'), eol: '\n' },
    ]);

    expect(result.restored).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'definition-id-collision' });
    expect(state.timelines).toHaveLength(1);
    expect(existing).toEqual(before);
  });

  it('已隔离的 canonical 备份只重建待确认记录，不会自动覆盖当前时间轴', () => {
    const existing = timeline('opening', fileHandle(null, log, 'opening.json'), false);
    state.timelines.push(existing);
    const before = timelineMutationSnapshot();
    const conflicts = quarantineTimelineAutosaveEntries([{
      id: 'opening',
      file: 'opening.json',
      text: timelineText('opening', '\n', 1800),
      eol: '\n',
    }]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      reason: 'quarantined-backup',
      current: { id: 'opening', file: 'opening.json' },
    });
    expectTimelineMutationUnchanged(before);
  });

  it('已隔离备份仍显示可证明的具体身份冲突且零 mutation', () => {
    state.timelines.push(timeline('opening', fileHandle(null, log, 'opening.json'), false));
    const before = timelineMutationSnapshot();
    const conflicts = quarantineTimelineAutosaveEntries([{
      id: 'opening',
      file: 'nested/opening.json',
      text: timelineText('opening'),
      eol: '\n',
    }]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ reason: 'same-id-different-file' });
    expectTimelineMutationUnchanged(before);
  });

  it('Replace Current 会重找唯一 target、规范化 recovered id，并保留 target 身份与 handle', () => {
    const { target, conflict } = definitionCollisionConflict();
    const replacement = { ...target };
    state.timelines[0] = replacement;
    const previousText = replacement.text;
    const undoBefore = timelineHistoryDepth('claimed').undo;

    const result = repairTimelineAutosaveConflict(conflict, { kind: 'replace-current' });

    expect(result).toEqual({ ok: true, timelineId: 'claimed' });
    expect(state.timelines).toHaveLength(1);
    expect(state.timelines[0]).toBe(replacement);
    expect(replacement).toMatchObject({
      id: 'claimed',
      file: 'claimed.json',
      eol: '\r\n',
      dirty: true,
      handle: target.handle,
    });
    expect(replacement.handle).toBe(target.handle);
    expect(JSON.parse(replacement.text)).toMatchObject({ id: 'claimed' });
    expect(replacement.text).not.toBe(conflict.recovered.text);
    expect(timelineHistoryDepth('claimed').undo).toBe(undoBefore + 1);
    expect(takeTimelineUndo('claimed', replacement.text)?.text).toBe(previousText);
  });

  it('Replace Current 遇到 stale target 时零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    const current = state.timelines[0]!;
    current.id = 'moved';
    current.file = 'moved.json';
    const before = timelineMutationSnapshot();

    const result = repairTimelineAutosaveConflict(conflict, { kind: 'replace-current' });

    expect(result.ok).toBe(false);
    expectTimelineMutationUnchanged(before);
  });

  it('Replace Current 遇到 ambiguous target 时零 mutation', () => {
    const { target, conflict } = definitionCollisionConflict();
    state.timelines.push({ ...target, handle: fileHandle(null, log, 'claimed-copy.json') });
    const before = timelineMutationSnapshot();

    const result = repairTimelineAutosaveConflict(conflict, { kind: 'replace-current' });

    expect(result.ok).toBe(false);
    expectTimelineMutationUnchanged(before);
  });

  it('Replace Current 遇到 invalid JSON 时零 mutation', () => {
    state.timelines.push(timeline('safe', fileHandle(null, log, 'safe.json'), false));
    const restore = restoreTimelineAutosaveEntries([{
      id: 'broken',
      file: 'broken.json',
      text: '{"version":1,"id":',
      eol: '\n',
    }]);
    expect(restore.conflicts).toHaveLength(1);
    expect(restore.conflicts[0]).toMatchObject({ reason: 'recovered-json-invalid' });
    const conflict = restore.conflicts[0]!;
    const before = timelineMutationSnapshot();

    expect(repairTimelineAutosaveConflict(conflict, { kind: 'replace-current' }).ok).toBe(false);
    expect(repairTimelineAutosaveConflict(conflict, { kind: 'save-as-new', newId: 'broken-copy' }).ok).toBe(false);
    expectTimelineMutationUnchanged(before);
  });

  it('Save As New 合法成功时插入 canonical dirty null-handle entry', () => {
    const { target, conflict } = definitionCollisionConflict();
    const targetBefore = { ...target };

    const result = repairTimelineAutosaveConflict(conflict, {
      kind: 'save-as-new',
      newId: 'recovered-copy',
    });

    expect(result).toEqual({ ok: true, timelineId: 'recovered-copy' });
    expect(target).toEqual(targetBefore);
    expect(state.timelines.filter((entry) => entry.id === 'recovered-copy')).toHaveLength(1);
    const created = state.timelines.find((entry) => entry.id === 'recovered-copy')!;
    expect(created).toMatchObject({
      id: 'recovered-copy',
      file: 'recovered-copy.json',
      eol: '\r\n',
      dirty: true,
      handle: null,
    });
    expect(JSON.parse(created.text)).toMatchObject({ id: 'recovered-copy' });
  });

  it('Save As New 拒绝非法 ID 且零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    expectSaveAsNewRejected(conflict, 'bad/id');
  });

  it('Save As New 拒绝当前 ID collision 且零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    state.timelines.push(timeline('taken', fileHandle(null, log, 'taken.json'), false));
    expectSaveAsNewRejected(conflict, 'taken');
  });

  it('Save As New 拒绝当前 file collision 且零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    state.timelines.push(timeline('other-file', fileHandle(null, log, 'taken.json'), false, 'taken.json', 'other-file'));
    expectSaveAsNewRejected(conflict, 'taken');
  });

  it('Save As New 拒绝当前 internal ID collision 且零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    state.timelines.push(timeline(
      'other-definition',
      fileHandle(null, log, 'other-definition.json'),
      false,
      'other-definition.json',
      'taken',
    ));
    expectSaveAsNewRejected(conflict, 'taken');
  });

  it('Save As New 拒绝 pendingTimelineDeletes collision 且零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    state.pendingTimelineDeletes = [{ id: 'taken', file: 'taken.json' }];
    expectSaveAsNewRejected(conflict, 'taken');
  });

  it('Save As New 拒绝 pendingTimelineRestores collision 且零 mutation', () => {
    const { conflict } = definitionCollisionConflict();
    state.pendingTimelineRestores.set('taken', {
      entry: timeline('taken', fileHandle(null, log, 'taken.json'), false),
      index: 0,
      previousTimelineId: null,
      previousCue: null,
    });
    expectSaveAsNewRejected(conflict, 'taken');
  });

  it('全部成功时清除 dirty、报告全部成功并调用 onSaved', async () => {
    const onSaved = vi.fn();
    const onSaveSettled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved, onSaveSettled });
    state.scenes.set('scene', scene('scene', fileHandle(null, log, 'scene')));
    state.timelines.push(timeline('timeline', fileHandle(null, log, 'timeline')));

    await saveAll();

    expect(state.scenes.get('scene')!.dirty).toBe(false);
    expect(state.timelines[0]!.dirty).toBe(false);
    expect(status.textContent).toMatch(/全部成功/);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaveSettled).toHaveBeenCalledWith({
      hadPendingChanges: true,
      saved: 2,
      removed: 0,
      failures: 0,
      remainingDirty: false,
    });
  });

  it('读取并编辑时间轴时分别保留 CRLF 与 LF 文档身份', async () => {
    const crlfWrites: string[] = [];
    const lfWrites: string[] = [];
    const crlfText = stringifyTimeline(createTimeline('crlf'), '\r\n');
    const lfText = stringifyTimeline(createTimeline('lf'), '\n');
    const timelines = directoryHandle('timelines', {}, {
      'crlf.json': fileHandle(null, log, 'crlf.json', crlfText, crlfWrites),
      'lf.json': fileHandle(null, log, 'lf.json', lfText, lfWrites),
    });
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await readTimelineDir(timelines, '');

    const crlfEntry = state.timelines.find((entry) => entry.id === 'crlf')!;
    const lfEntry = state.timelines.find((entry) => entry.id === 'lf')!;
    expect(crlfEntry.eol).toBe('\r\n');
    expect(lfEntry.eol).toBe('\n');

    crlfEntry.text = stringifyTimeline({ ...createTimeline('crlf'), durationMs: 1800 }, crlfEntry.eol);
    crlfEntry.dirty = true;
    lfEntry.text = stringifyTimeline({ ...createTimeline('lf'), durationMs: 1800 }, lfEntry.eol);
    lfEntry.dirty = true;
    await saveAll();

    expect(crlfWrites.at(-1)).not.toMatch(/(^|[^\r])\n/);
    expect(crlfWrites.at(-1)?.endsWith('\r\n')).toBe(true);
    expect(lfWrites.at(-1)).not.toContain('\r\n');
    expect(lfWrites.at(-1)?.endsWith('\n')).toBe(true);
  });

  it('演示项目下载但无法落盘时保留 dirty 且不调用 onSaved', async () => {
    const onSaved = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved });
    state.fsSupported = false;
    state.dirHandle = null;
    state.current = 'demo';
    state.scenes.set('demo', scene('demo', null as unknown as FileSystemFileHandle));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:demo', revokeObjectURL: vi.fn() });

    await saveAll();

    expect(state.scenes.get('demo')!.dirty).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('从显式目录句柄打开普通项目时清理旧 review 状态并回到块编辑', async () => {
    const sceneHandle = fileHandle(null, log, 'start.gal');
    const gameConfigHandle = fileHandle(null, log, 'game.config.json');
    const scenarioDir = directoryHandle('scenario', {}, { 'start.gal': sceneHandle });
    const contentDir = directoryHandle('content', { scenario: scenarioDir });
    const root = directoryHandle('review-reset-project', { content: contentDir }, { 'game.config.json': gameConfigHandle });
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
    state.mainTab = 'review' as never;
    (state as any).reviewWorkspace = { reviewId: 'old-review' };
    state.assetCenterFolder = 'content/assets/bg';

    await openProjectFromHandle(root);

    expect(state.dirName).toBe('review-reset-project');
    expect(state.current).toBe('start');
    expect(state.mainTab).toBe('editor');
    expect((state as any).reviewWorkspace).toBeNull();
    expect(state.assetCenterFolder).toBe('all');
  });

  it('项目切换等待已开始的写操作收束后再清理旧项目', async () => {
    const root = directoryHandle('next-project', {
      content: directoryHandle('content', { scenario: directoryHandle('scenario') }),
    }, { 'game.config.json': fileHandle(null, log, 'game.config.json', '{}') });
    const onProjectClosing = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onProjectClosing });
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      void runProjectWriteOperation(async () => {
        resolve();
        await new Promise<void>((release) => { releaseWrite = release; });
      });
    });
    await writeStarted;

    const switching = openProjectFromHandle(root);
    await Promise.resolve();
    expect(onProjectClosing).not.toHaveBeenCalled();
    expect(state.dirName).not.toBe('next-project');

    releaseWrite();
    await switching;
    expect(onProjectClosing).toHaveBeenCalledTimes(1);
    expect(state.dirName).toBe('next-project');
  });

  it('切换到演示项目时清除上一项目的素材目录筛选', () => {
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
    state.assetCenterFolder = 'content/assets/portrait';

    loadDemoProject();

    expect(state.assetCenterFolder).toBe('all');
  });

  it('项目载入回调失败时仍收束 projectLoading 与切换生命周期', async () => {
    const root = directoryHandle('settled-project', {
      content: directoryHandle('content', { scenario: directoryHandle('scenario') }),
    }, { 'game.config.json': fileHandle(null, log, 'game.config.json', '{}') });
    const onProjectClosing = vi.fn();
    const onProjectLoadSettled = vi.fn();
    bindProjectIoHooks({
      renderAll: vi.fn(),
      runValidate: vi.fn(),
      renderSidebar: vi.fn(),
      onProjectClosing,
      onProjectLoadSettled,
      onProjectLoaded: () => { throw new Error('load callback failed'); },
    });

    await expect(openProjectFromHandle(root)).rejects.toThrow('load callback failed');

    expect(onProjectClosing).toHaveBeenCalledTimes(1);
    expect(onProjectLoadSettled).toHaveBeenCalledWith(false);
    expect(state.projectLoading).toBe(false);
  });

  it('聚焦刷新只替换素材事实并保留当前编辑与审阅现场', async () => {
    const sceneHandle = fileHandle(null, log, 'kept.gal', '@scene kept\n');
    const timelineHandle = fileHandle(null, log, 'kept.json', timelineText('kept'));
    const importedHandle = fileHandle(null, log, 'rain.png', 'binary');
    const bgDir = directoryHandle('bg', {}, { 'rain.png': importedHandle });
    const assetsDir = directoryHandle('assets', { bg: bgDir });
    const contentDir = directoryHandle('content', { assets: assetsDir });
    const publicDir = directoryHandle('public');
    const root = directoryHandle('focused-refresh', { content: contentDir, public: publicDir });

    state.dirHandle = root;
    state.scenes.clear();
    state.scenes.set('kept', scene('kept', sceneHandle, true));
    state.timelines = [timeline('kept', timelineHandle, true)];
    state.current = 'kept';
    state.currentTimeline = 'kept';
    state.currentTimelineCue = { trackIndex: 2, cueIndex: 3 };
    state.mainTab = 'review' as never;
    const reviewWorkspace = { reviewId: 'review-kept' } as never;
    state.reviewWorkspace = reviewWorkspace;
    state.assetCenterQuery = '雨';
    state.assetCenterKind = 'background';
    state.assetCenterStatus = 'referenced';
    state.assetCenterView = 'grid';
    state.dirAssets = [{ key: 'old', kind: 'bg', handle: null, isImage: true }];
    const refreshedIntelligence = { items: [], summary: {}, issues: [] } as never;
    const scenes = state.scenes;
    const timelines = state.timelines;
    const sceneEntry = state.scenes.get('kept');
    const timelineEntry = state.timelines[0];

    bindProjectIoHooks({
      renderAll: vi.fn(),
      runValidate: vi.fn(),
      renderSidebar: vi.fn(),
      onAssetsRefreshed: vi.fn(async () => {
        expect(state.dirAssets.map((asset) => asset.sourcePath)).toEqual(['content/assets/bg/rain.png']);
        state.assetIntelligence = refreshedIntelligence;
        state.assetIntelligenceState = 'ready';
      }),
    });

    await refreshProjectAssetIntelligence();

    expect(state.dirAssets.map((asset) => asset.sourcePath)).toEqual(['content/assets/bg/rain.png']);
    expect(state.assetIntelligence).toBe(refreshedIntelligence);
    expect(state.assetIntelligenceState).toBe('ready');
    expect(state.scenes).toBe(scenes);
    expect(state.scenes.get('kept')).toBe(sceneEntry);
    expect(state.scenes.get('kept')?.dirty).toBe(true);
    expect(state.timelines).toBe(timelines);
    expect(state.timelines[0]).toBe(timelineEntry);
    expect(state.timelines[0]?.dirty).toBe(true);
    expect(state.current).toBe('kept');
    expect(state.currentTimeline).toBe('kept');
    expect(state.currentTimelineCue).toEqual({ trackIndex: 2, cueIndex: 3 });
    expect(state.reviewWorkspace).toBe(reviewWorkspace);
    expect(state.mainTab).toBe('review');
    expect(state.assetCenterQuery).toBe('雨');
    expect(state.assetCenterKind).toBe('background');
    expect(state.assetCenterStatus).toBe('referenced');
    expect(state.assetCenterView).toBe('grid');
  });

  it('聚焦刷新扫描失败时保留上一份完整素材事实', async () => {
    const partial = fileHandle(null, log, 'partial.png', 'partial');
    const brokenAssets = {
      ...directoryHandle('assets'),
      values: async function* () {
        yield partial;
        throw new DOMException('permission lost', 'NotAllowedError');
      },
    } as unknown as FileSystemDirectoryHandle;
    const contentDir = directoryHandle('content', { assets: brokenAssets });
    const root = directoryHandle('broken-refresh', { content: contentDir, public: directoryHandle('public') });
    const oldAssets = [{ key: 'old', kind: 'bg' as const, handle: null, isImage: true, sourcePath: 'content/assets/bg/old.png' }];
    const oldIntelligence = { items: [], summary: {}, issues: [] } as never;
    state.dirHandle = root;
    state.dirAssets = oldAssets;
    state.assetIntelligence = oldIntelligence;
    state.assetIntelligenceState = 'ready';
    const onAssetsRefreshed = vi.fn(async () => {});
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onAssetsRefreshed });

    await expect(refreshProjectAssetIntelligence()).rejects.toThrow('permission lost');

    expect(state.dirAssets).toBe(oldAssets);
    expect(state.assetIntelligence).toBe(oldIntelligence);
    expect(state.assetIntelligenceState).toBe('ready');
    expect(onAssetsRefreshed).not.toHaveBeenCalled();
  });

  it('共享素材智能重建失败时回滚素材清单与选择', async () => {
    const importedHandle = fileHandle(null, log, 'new.png', 'new');
    const assetsDir = directoryHandle('assets', {}, { 'new.png': importedHandle });
    const contentDir = directoryHandle('content', { assets: assetsDir });
    const root = directoryHandle('rebuild-failure', { content: contentDir, public: directoryHandle('public') });
    const oldAssets = [{ key: 'old', kind: 'bg' as const, handle: null, isImage: true, sourcePath: 'content/assets/bg/old.png' }];
    const oldIntelligence = { items: [], summary: {}, issues: [] } as never;
    state.dirHandle = root;
    state.dirAssets = oldAssets;
    state.assetIntelligence = oldIntelligence;
    state.assetIntelligenceState = 'ready';
    state.assetCenterSelectedId = 'file:content/assets/bg/old.png';
    bindProjectIoHooks({
      renderAll: vi.fn(),
      runValidate: vi.fn(),
      renderSidebar: vi.fn(),
      onAssetsRefreshed: vi.fn(async () => {
        state.assetIntelligence = null;
        state.assetIntelligenceState = 'error';
        state.assetCenterSelectedId = null;
        throw new Error('index rebuild failed');
      }),
    });

    await expect(refreshProjectAssetIntelligence()).rejects.toThrow('index rebuild failed');

    expect(state.dirAssets).toBe(oldAssets);
    expect(state.assetIntelligence).toBe(oldIntelligence);
    expect(state.assetIntelligenceState).toBe('ready');
    expect(state.assetCenterSelectedId).toBe('file:content/assets/bg/old.png');
  });

  it('并发聚焦刷新只接受最后一次完整扫描结果', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = fileHandle(null, log, 'first.png', 'first');
    const second = fileHandle(null, log, 'second.png', 'second');
    const firstAssets = {
      ...directoryHandle('assets'),
      values: async function* () {
        await firstGate;
        yield first;
      },
    } as unknown as FileSystemDirectoryHandle;
    const secondAssets = directoryHandle('assets', {}, { 'second.png': second });
    let contentReads = 0;
    const root = {
      ...directoryHandle('concurrent-refresh'),
      getDirectoryHandle: async (name: string) => {
        if (name === 'content') {
          contentReads += 1;
          return directoryHandle('content', { assets: contentReads === 1 ? firstAssets : secondAssets });
        }
        throw new DOMException('missing', 'NotFoundError');
      },
    } as unknown as FileSystemDirectoryHandle;
    state.dirHandle = root;
    state.dirAssets = [];
    const onAssetsRefreshed = vi.fn(async () => {
      state.assetIntelligence = { items: [], summary: {}, issues: [] } as never;
      state.assetIntelligenceState = 'ready';
    });
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onAssetsRefreshed });

    const staleRefresh = refreshProjectAssetIntelligence();
    await Promise.resolve();
    const latestRefresh = refreshProjectAssetIntelligence();
    await latestRefresh;
    releaseFirst!();
    await staleRefresh;

    expect(state.dirAssets.map((asset) => asset.sourcePath)).toEqual(['content/assets/second.png']);
    expect(onAssetsRefreshed).toHaveBeenCalledTimes(1);
  });
});
