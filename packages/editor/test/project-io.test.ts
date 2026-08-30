import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindProjectIoHooks, openProjectFromHandle, readTimelineDir, restoreTimelineAutosaveEntries, saveAll } from '../src/project-io.js';
import { state } from '../src/state.js';
import type { SceneEntry, TimelineEntry } from '../src/state.js';
import { createTimeline, stringifyTimeline } from '../src/timeline-model.js';
import { deleteTimeline, nextTimelineId, restorePendingTimelineDeletion } from '../src/panels/timeline-panel.js';
import { pushTimelineSnapshot, timelineHistoryDepth } from '../src/timeline-history.js';

type FailurePoint = 'create' | 'write' | 'close';

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

function timeline(id: string, handle: FileSystemFileHandle, dirty = true): TimelineEntry {
  return { id, file: `${id}.json`, text: `{ "id": "${id}" }`, eol: '\n', dirty, handle };
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
    state.dirHandle = {} as FileSystemDirectoryHandle;
    state.scenes.clear();
    state.timelines = [];
    state.pendingTimelineDeletes = [];
    state.pendingTimelineRestores.clear();
    state.current = null;
    state.currentTimeline = null;
    log.length = 0;
    status.textContent = '';
    status.className = '';
    status.title = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      { id: 'disk', file: 'disk.json', text: 'disk recovered\r\n', eol: '\r\n' },
      { id: 'new', file: 'nested/new.json', text: 'new recovered\n', eol: '\n' },
    ]);

    const disk = state.timelines.find((entry) => entry.id === 'disk')!;
    const created = state.timelines.find((entry) => entry.id === 'new')!;
    expect(disk).toMatchObject({ text: 'disk recovered\r\n', eol: '\r\n', dirty: true });
    expect(created).toMatchObject({ id: 'new', file: 'nested/new.json', text: 'new recovered\n', eol: '\n', dirty: true, handle: null });
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

    await openProjectFromHandle(root);

    expect(state.dirName).toBe('review-reset-project');
    expect(state.current).toBe('start');
    expect(state.mainTab).toBe('editor');
    expect((state as any).reviewWorkspace).toBeNull();
  });
});
