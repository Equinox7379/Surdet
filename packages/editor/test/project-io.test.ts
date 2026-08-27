import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindProjectIoHooks, openProjectFromHandle, saveAll } from '../src/project-io.js';
import { state } from '../src/state.js';
import type { SceneEntry, TimelineEntry } from '../src/state.js';

type FailurePoint = 'create' | 'write' | 'close';

function fileHandle(failure: FailurePoint | null, log: string[], name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    isSameEntry: async () => false,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => new File([], name),
    createWritable: async () => {
      log.push(`${name}:createWritable`);
      if (failure === 'create') throw new Error(`${name}:create failed`);
      return {
        write: async () => {
          log.push(`${name}:write`);
          if (failure === 'write') throw new Error(`${name}:write failed`);
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
  return { id, file: `${id}.json`, text: `{ "id": "${id}" }`, dirty, handle };
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
  const status = { textContent: '', className: '' };
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
    state.current = null;
    state.currentTimeline = null;
    log.length = 0;
    status.textContent = '';
    status.className = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('第一个已有场景失败时继续保存第二个场景和时间轴，并保留失败 dirty', async () => {
    const onSaved = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved });
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
    expect(onSaved).not.toHaveBeenCalled();
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

  it('全部成功时清除 dirty、报告全部成功并调用 onSaved', async () => {
    const onSaved = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved });
    state.scenes.set('scene', scene('scene', fileHandle(null, log, 'scene')));
    state.timelines.push(timeline('timeline', fileHandle(null, log, 'timeline')));

    await saveAll();

    expect(state.scenes.get('scene')!.dirty).toBe(false);
    expect(state.timelines[0]!.dirty).toBe(false);
    expect(status.textContent).toMatch(/全部成功/);
    expect(onSaved).toHaveBeenCalledTimes(1);
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
