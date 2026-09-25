import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindProjectIoHooks,
  loadDemoProject,
  openProjectFromHandle,
  quarantineTimelineAutosaveEntries,
  readTimelineDir,
  readScenarioDir,
  refreshProjectAssetIntelligence,
  repairTimelineAutosaveConflict,
  reloadCurrentProjectFromHandle,
  restoreTimelineAutosaveEntries,
  runProjectWriteOperation,
  saveAll,
  sceneTextSha256,
  prepareSceneConfigRename,
  prepareSceneConfigRecovery,
} from '../src/project-io.js';
import { state } from '../src/state.js';
import * as workspace from '../src/editor-workspace.js';
import { renameSceneAtKey, deleteSceneAtKey } from '../src/panels/flow.js';
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
      if (!value) throw new DOMException(`missing directory ${child}`, 'NotFoundError');
      return value;
    },
    getFileHandle: async (child: string) => {
      const value = files[child];
      if (!value) throw new DOMException(`missing file ${child}`, 'NotFoundError');
      return value;
    },
    values: async function* () {
      yield* Object.values(directories);
      yield* Object.values(files);
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('chapter scene loading', () => {
  it('reads nested scenes with mixed-case suffixes without changing identity or source bytes', async () => {
    const text = '\uFEFF@scene start\r\n// 保持空白\r\n旁白：章节中的对白。\r\n@end\r\n';
    const handle = fileHandle(null, [], 'start.GaL', text);
    const root = directoryHandle('scenario', { '第一章': directoryHandle('第一章', {}, {
      'start.GaL': handle, 'notes.txt': fileHandle(null, [], 'notes.txt', '不要导入'),
    }) });
    const scenes = new Map<string, SceneEntry>();
    await readScenarioDir(root, '', scenes);
    expect([...scenes.keys()]).toEqual(['第一章/start']);
    expect(scenes.get('第一章/start')).toMatchObject({ id: 'start', file: '第一章/start.GaL', text, eol: '\r\n', dirty: false, handle, persistedSha256: await sceneTextSha256(text) });
  });
});

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
    state.reviewPreviewReadOnly = false;
    state.configReadErrors = {};
    state.pendingSceneConfigWrites = [];
    state.pendingSceneConfigRenames = [];
    state.scenes.clear();
    state.timelines = [];
    state.pendingSceneDeletes = [];
    state.pendingSceneCommit = null;
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
    vi.restoreAllMocks();
    state.projectWriteLock = null;
    state.pendingSceneCommit = null;
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

  it('配置引用草稿保留未知字段与原指纹；恢复缺成员或外部已改时整组拒绝', async () => {
    const rootText = '\uFEFF{"entryScene":"old","player":{"endScenes":["old"]},"note":"old"}\r\n';
    const docs = {
      events: { events: [{ id: 'e', scene: 'old', note: 'old' }], scheduled: [{ id: 's', scene: 'old' }] },
      growth: { profiles: [{ levelEvents: { '2': 'old' }, note: 'old' }] },
      calendar: { nodes: [{ eventId: 'old' }], baseCommands: [{ eventId: 'old' }] },
      gallery: { texts: [{ scene: 'old', label: 'same', note: 'old' }] },
    };
    state.scenes = new Map([['old', scene('old', fileHandle(null, log, 'old.gal'))]]);
    state.gameConfigText = rootText;
    state.configFiles = { ...docs, achievements: null, terminology: null };
    state.handles = { gameConfig: fileHandle(null, log, 'game.config.json', rootText), achievements: null, terminology: null,
      events: fileHandle(null, log, 'events.json', JSON.stringify(docs.events)),
      growth: fileHandle(null, log, 'growth.json', JSON.stringify(docs.growth)),
      calendar: fileHandle(null, log, 'calendar.json', JSON.stringify(docs.calendar)),
      gallery: fileHandle(null, log, 'gallery.json', JSON.stringify(docs.gallery)),
    };
    const apply = await prepareSceneConfigRename('old', 'new', 'old');
    expect(state.gameConfigText).toBe(rootText);
    expect(state.pendingSceneConfigWrites).toEqual([]);
    expect(log).toEqual([]);
    apply();
    expect(state.configFiles).toMatchObject({
      events: { events: [{ scene: 'new', note: 'old' }], scheduled: [{ scene: 'new' }] },
      growth: { profiles: [{ levelEvents: { '2': 'new' }, note: 'old' }] },
      calendar: { nodes: [{ eventId: 'new' }], baseCommands: [{ eventId: 'new' }] },
      gallery: { texts: [{ scene: 'new', label: 'same', note: 'old' }] },
    });
    const writes = state.pendingSceneConfigWrites;
    const renames = state.pendingSceneConfigRenames;
    expect(writes).toHaveLength(5);
    expect(writes.find(write => write.path === 'game.config.json')?.expectedSha256).toBe(await sceneTextSha256(rootText));
    await expect(prepareSceneConfigRecovery(writes.slice(0, 4), renames)).rejects.toThrow('不能部分恢复');
    const restore = await prepareSceneConfigRecovery(writes, renames);
    state.gameConfigText = rootText;
    state.configFiles = { ...docs, achievements: null, terminology: null };
    restore();
    expect(state.entryScene).toBe('new');
    expect(state.gameConfigText.startsWith('\uFEFF')).toBe(true);
    state.handles.events = fileHandle(null, log, 'events.json', '{"events":[],"external":true}');
    const before = JSON.stringify(state.configFiles);
    await expect(prepareSceneConfigRecovery(writes, renames)).rejects.toThrow('不能部分恢复');
    expect(JSON.stringify(state.configFiles)).toBe(before);
    expect(log).toEqual([]);
  });

  it('项目写操作按调用顺序串行执行', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const first = runProjectWriteOperation(async () => {
      order.push('first:start');
      signalFirstStarted();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push('first:end');
    });
    await firstStarted;
    const second = runProjectWriteOperation(async () => { order.push('second'); });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
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

  it('保存全部纳入 dirty 配置区块，配置失败时不清除恢复备份', async () => {
    const onSaved = vi.fn();
    const onSaveSettled = vi.fn();
    const saveConfigDrafts = vi.fn(async () => ({ saved: 0, failures: 1, remainingDirty: true }));
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSaved, onSaveSettled,
      hasDirtyConfigDrafts: () => true, saveConfigDrafts });

    await expect(saveAll()).resolves.toBeUndefined();

    expect(saveConfigDrafts).toHaveBeenCalledTimes(1);
    expect(status.textContent).toMatch(/全部失败/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveSettled).toHaveBeenCalledWith({
      hadPendingChanges: true,
      saved: 0,
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

  it('普通句柄写入等待期间继续编辑时不会清除 dirty', async () => {
    let releaseWrite!: () => void;
    let signalWrite!: () => void;
    const writing = new Promise<void>((resolve) => { signalWrite = resolve; });
    const handle = {
      kind: 'file', name: 'live.gal',
      createWritable: async () => ({
        write: async () => {
          signalWrite();
          await new Promise<void>((resolve) => { releaseWrite = resolve; });
        },
        close: async () => undefined,
      }),
    } as unknown as FileSystemFileHandle;
    state.scenes.set('live', {
      id: 'live', file: 'live.gal', text: '提交快照', eol: '\n', dirty: true, handle,
    });
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    const saving = saveAll();
    await writing;
    state.scenes.get('live')!.text = '等待期间的新正文';
    state.scenes.get('live')!.dirty = true;
    releaseWrite();
    await saving;

    expect(state.scenes.get('live')).toMatchObject({ text: '等待期间的新正文', dirty: true });
  });

  it('时间轴写入等待期间继续编辑时不会清除 dirty', async () => {
    let releaseWrite!: () => void;
    let signalWrite!: () => void;
    const writing = new Promise<void>((resolve) => { signalWrite = resolve; });
    const handle = {
      kind: 'file', name: 'live.json',
      createWritable: async () => ({
        write: async () => {
          signalWrite();
          await new Promise<void>((resolve) => { releaseWrite = resolve; });
        },
        close: async () => undefined,
      }),
    } as unknown as FileSystemFileHandle;
    state.timelines.push(timeline('live', handle));
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    const saving = saveAll();
    await writing;
    state.timelines[0]!.text = timelineText('live', '\n', 2400);
    state.timelines[0]!.dirty = true;
    releaseWrite();
    await saving;

    expect(state.timelines[0]).toMatchObject({
      text: timelineText('live', '\n', 2400),
      dirty: true,
    });
  });

  function nestedScenarioProject(options: {
    failOpenExisting?: boolean;
  } = {}): {
    root: FileSystemDirectoryHandle;
    operations: string[];
    nestedFiles: Set<string>;
    fileTexts: Map<string, string>;
  } {
    const operations: string[] = [];
    const nestedFiles = new Set(['old.gal', 'delete-me.gal']);
    const fileTexts = new Map<string, string>([
      ['old.gal', '@scene old\n'],
      ['delete-me.gal', '@scene delete-me\n'],
    ]);
    const makeWritableFile = (name: string): FileSystemFileHandle => ({
      kind: 'file',
      name,
      isSameEntry: async () => false,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => new File([fileTexts.get(name) ?? ''], name),
      createWritable: async () => ({
        write: async () => {
          operations.push(`write:${name}`);
        },
        close: async () => { operations.push(`close:${name}`); },
      } as unknown as FileSystemWritableFileStream),
    } as unknown as FileSystemFileHandle);
    const nested = {
      kind: 'directory',
      name: 'chapter',
      getDirectoryHandle: async (name: string) => { throw new Error(`missing nested directory ${name}`); },
      getFileHandle: async (name: string, create?: FileSystemGetFileOptions) => {
        operations.push(`open:chapter/${name}`);
        if (!nestedFiles.has(name) && !create?.create) throw new Error(`missing file ${name}`);
        if (options.failOpenExisting && !create?.create) throw new Error(`cannot refresh ${name}`);
        nestedFiles.add(name);
        if (!fileTexts.has(name)) fileTexts.set(name, '');
        return makeWritableFile(name);
      },
      removeEntry: async (name: string) => {
        operations.push(`remove:chapter/${name}`);
        nestedFiles.delete(name);
        fileTexts.delete(name);
      },
    } as unknown as FileSystemDirectoryHandle;
    const scenario = directoryHandle('scenario', { chapter: nested });
    const content = directoryHandle('content', { scenario });
    return { root: directoryHandle('project', { content }), operations, nestedFiles, fileTexts };
  }

  it('移动与开场配置一起保存，回包丢失重试同一批次并保留等待期间正文', async () => {
    const fixture = nestedScenarioProject();
    let configDisk = '{"unknown":{"keep":true}}';
    const configHandle = { ...fileHandle(null, log, 'game.config.json'), getFile: async () => new File([configDisk], 'game.config.json') } as FileSystemFileHandle;
    state.dirHandle = { ...fixture.root, getFileHandle: async () => configHandle } as FileSystemDirectoryHandle;
    state.gameConfigText = configDisk;
    state.handles.gameConfig = configHandle;
    const text = '@scene first\r\n旁白：正文。\r\n';
    const hash = await sceneTextSha256(text);
    state.scenes.set('chapter/first', { id: 'first', file: 'chapter/first.GAL', text, eol: '\r\n', handle: null, dirty: true, persistedSha256: hash, pendingEntryScene: 'first' });
    state.pendingSceneDeletes = [{ kind: 'rename', id: 'first', file: 'first.GAL', replacementKey: 'chapter/first', affectedSceneKeys: ['chapter/first'], operationId: '123e4567-e89b-42d3-a456-426614174000', planFingerprint: 'a'.repeat(64) }];
    const inputs: unknown[] = [];
    const commit = vi.fn(async (input: import('../src/project-io.js').SceneMutationCommitInput) => {
      inputs.push(structuredClone(input));
      const write = input.writes.find(write => write.path === 'game.config.json')!;
      expect(write.expectedSha256).toBe(await sceneTextSha256('{"unknown":{"keep":true}}'));
      configDisk = write.text;
      const sceneWrite = input.writes.find(write => write.path.endsWith('.GAL'))!;
      fixture.fileTexts.set('first.GAL', sceneWrite.text);
      fixture.nestedFiles.add('first.GAL');
      if (inputs.length === 1) throw new Error('response lost');
      return { requestId: input.requestId, status: 'COMMITTED' as const, deletedPaths: ['content/scenario/first.GAL'],
        writes: await Promise.all(input.writes.map(async write => ({ path: write.path, sha256: await sceneTextSha256(write.text) }))) };
    });
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationCommit: commit });
    await saveAll();
    expect(state.pendingSceneCommit).not.toBeNull();
    expect(state.gameConfigText).toBe('{"unknown":{"keep":true}}');
    state.scenes.get('chapter/first')!.text += '旁白：等待期间输入。\r\n';
    await saveAll();
    expect(inputs[1]).toEqual(inputs[0]);
    expect(JSON.parse(state.gameConfigText)).toEqual({ unknown: { keep: true }, entryScene: 'first' });
    expect(state.pendingSceneCommit).toBeNull();
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(state.scenes.get('chapter/first')).toMatchObject({ dirty: true, persistedSha256: hash });
    expect(state.scenes.get('chapter/first')!.pendingEntryScene).toBeUndefined();
    expect(state.scenes.get('chapter/first')!.text).toContain('等待期间输入');
  });

  it('未连接 authority 时不退回浏览器覆盖式重命名写删', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: '@scene new\n', eol: '\n', dirty: true, handle: null,
    });
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
    }];
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await saveAll();

    expect(project.operations).toEqual([]);
    expect(project.nestedFiles.has('new.gal')).toBe(false);
    expect(project.nestedFiles.has('old.gal')).toBe(true);
    expect(state.scenes.get('chapter/new')).toMatchObject({ file: 'chapter/new.gal', dirty: true });
    expect(state.pendingSceneDeletes).toHaveLength(1);
    expect(status.textContent).toContain('安全保存服务未连接');
  });

  it('未连接 authority 时不尝试新文件写入并保留旧文件与待删除状态', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: '@scene new\n', eol: '\n', dirty: true, handle: null,
    });
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
    }];
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await saveAll();

    expect(project.operations).toEqual([]);
    expect(project.nestedFiles.has('old.gal')).toBe(true);
    expect(state.scenes.get('chapter/new')?.dirty).toBe(true);
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('有安全计划时把改名目标作为一个 authority 批次提交，不走可覆盖的浏览器写删', async () => {
    const project = nestedScenarioProject();
    project.nestedFiles.add('new.gal');
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new',
      file: 'chapter/new.gal',
      text: '@scene new\n',
      eol: '\n',
      dirty: true,
      handle: null,
      persistedSha256: 'a'.repeat(64),
    });
    state.pendingSceneDeletes = [{
      kind: 'rename',
      id: 'old',
      file: 'chapter/old.gal',
      replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new'],
      operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'b'.repeat(64),
    }];
    const submittedText = '@scene new\n';
    const submittedSha256 = await sceneTextSha256(submittedText);
    const onSceneMutationCommit = vi.fn(async () => {
      project.fileTexts.set('new.gal', submittedText);
      return {
        writes: [{ path: 'content/scenario/chapter/new.gal', sha256: submittedSha256 }],
        deletedPaths: ['content/scenario/chapter/old.gal'],
      };
    });
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationCommit,
    });

    await saveAll();

    expect(onSceneMutationCommit).toHaveBeenCalledWith({
      requestId: '11111111-1111-4111-8111-111111111111',
      plans: [{
        operationId: '11111111-1111-4111-8111-111111111111',
        planFingerprint: 'b'.repeat(64),
      }],
      writes: [{
        path: 'content/scenario/chapter/new.gal',
        text: '@scene new\n',
        expectedSha256: null,
      }],
    });
    expect(project.operations).toEqual(['open:chapter/new.gal']);
    expect(state.scenes.get('chapter/new')).toMatchObject({
      dirty: false,
      persistedSha256: submittedSha256,
    });
    expect(state.pendingSceneDeletes).toEqual([]);
  });

  it('新场景也通过 authority 独占创建，不走可覆盖的浏览器 create 写入', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    const requestId = '22222222-2222-4222-8222-222222222222';
    const submittedText = '@scene fresh\n';
    const submittedSha256 = await sceneTextSha256(submittedText);
    state.scenes.set('chapter/fresh', {
      id: 'fresh', file: 'chapter/fresh.gal', text: '@scene fresh\n', eol: '\n', dirty: true, handle: null,
      pendingCreateOperationId: requestId,
    });
    const onSceneMutationCommit = vi.fn(async () => {
      project.nestedFiles.add('fresh.gal');
      project.fileTexts.set('fresh.gal', submittedText);
      return {
        writes: [{ path: 'content/scenario/chapter/fresh.gal', sha256: submittedSha256 }],
        deletedPaths: [],
      };
    });
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationCommit,
    });

    await saveAll();

    expect(onSceneMutationCommit).toHaveBeenCalledWith({
      requestId,
      plans: [],
      writes: [{
        path: 'content/scenario/chapter/fresh.gal',
        text: '@scene fresh\n',
        expectedSha256: null,
      }],
    });
    expect(project.operations).toEqual(['open:chapter/fresh.gal']);
    expect(state.scenes.get('chapter/fresh')).toMatchObject({ dirty: false, persistedSha256: submittedSha256 });
    expect(state.scenes.get('chapter/fresh')?.pendingCreateOperationId).toBeUndefined();
  });

  it('authority 等待期间继续编辑时保留新正文 dirty，不把旧快照冒充已保存', async () => {
    const project = nestedScenarioProject();
    project.nestedFiles.add('new.gal');
    project.fileTexts.set('new.gal', '提交快照');
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: '提交快照', eol: '\n', dirty: true, handle: null,
      persistedSha256: 'a'.repeat(64),
    });
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new'], operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'b'.repeat(64),
    }];
    let resolveCommit!: (value: { writes: { path: string; sha256: string }[]; deletedPaths: string[] }) => void;
    const commit = new Promise<{ writes: { path: string; sha256: string }[]; deletedPaths: string[] }>((resolve) => {
      resolveCommit = resolve;
    });
    const onSceneMutationCommit = vi.fn(() => commit);
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationCommit,
    });

    const saving = saveAll();
    await vi.waitFor(() => expect(onSceneMutationCommit).toHaveBeenCalledOnce());
    state.scenes.get('chapter/new')!.text = '等待期间的新正文';
    state.scenes.get('chapter/new')!.dirty = true;
    resolveCommit({
      writes: [{ path: 'content/scenario/chapter/new.gal', sha256: await sceneTextSha256('提交快照') }],
      deletedPaths: ['content/scenario/chapter/old.gal'],
    });
    await saving;

    expect(state.scenes.get('chapter/new')).toMatchObject({
      text: '等待期间的新正文', dirty: true, persistedSha256: await sceneTextSha256('提交快照'),
    });
    expect(state.pendingSceneDeletes).toEqual([]);
  });

  it('authority 已提交但回包丢失时只重放首次冻结请求，并保留随后编辑', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    const submittedText = '@scene new\n首次提交。\n';
    const submittedSha256 = await sceneTextSha256(submittedText);
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: submittedText, eol: '\n', dirty: true, handle: null,
      persistedSha256: 'a'.repeat(64),
    });
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new'], operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'b'.repeat(64),
    }];
    const requests: unknown[] = [];
    let attempts = 0;
    const onSceneMutationCommit = vi.fn(async (input) => {
      requests.push(structuredClone(input));
      attempts += 1;
      if (attempts === 1) {
        project.nestedFiles.add('new.gal');
        project.fileTexts.set('new.gal', submittedText);
        project.nestedFiles.delete('old.gal');
        project.fileTexts.delete('old.gal');
        throw new Error('提交已完成，但连接在回包前中断');
      }
      return {
        writes: [{ path: 'content/scenario/chapter/new.gal', sha256: submittedSha256 }],
        deletedPaths: ['content/scenario/chapter/old.gal'],
      };
    });
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationCommit,
    });

    await saveAll();
    expect(state.pendingSceneCommit).not.toBeNull();
    expect(state.pendingSceneDeletes).toHaveLength(1);

    state.scenes.get('chapter/new')!.text = '@scene new\n首次提交。\n随后编辑。\n';
    state.scenes.get('chapter/new')!.dirty = true;
    await saveAll();

    expect(onSceneMutationCommit).toHaveBeenCalledTimes(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(state.scenes.get('chapter/new')).toMatchObject({
      text: '@scene new\n首次提交。\n随后编辑。\n',
      dirty: true,
      persistedSha256: submittedSha256,
    });
    expect(state.pendingSceneCommit).toBeNull();
    expect(state.pendingSceneDeletes).toEqual([]);
  });

  it('authority 已提交但句柄刷新失败时保持未保存提示', async () => {
    const project = nestedScenarioProject({ failOpenExisting: true });
    project.nestedFiles.add('new.gal');
    project.fileTexts.set('new.gal', '@scene new\n');
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: '@scene new\n', eol: '\n', dirty: true, handle: null,
      persistedSha256: 'a'.repeat(64),
    });
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new'], operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'b'.repeat(64),
    }];
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationCommit: vi.fn(async () => ({
        writes: [{
          path: 'content/scenario/chapter/new.gal',
          sha256: await sceneTextSha256('@scene new\n'),
        }],
        deletedPaths: ['content/scenario/chapter/old.gal'],
      })),
    });

    await saveAll();

    expect(state.scenes.get('chapter/new')).toMatchObject({
      dirty: true, handle: null, persistedSha256: 'a'.repeat(64),
    });
    expect(state.pendingSceneDeletes).toHaveLength(1);
    expect(state.pendingSceneCommit).not.toBeNull();
    expect(status.textContent).toContain('全部失败');
  });

  it('authority 拒绝场景批次时保留整组 dirty 与计划，且不退回不安全的 FSA 写入', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new',
      file: 'chapter/new.gal',
      text: '@scene new\n',
      eol: '\n',
      dirty: true,
      handle: null,
      persistedSha256: 'a'.repeat(64),
    });
    state.pendingSceneDeletes = [{
      kind: 'rename',
      id: 'old',
      file: 'chapter/old.gal',
      replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new'],
      operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'b'.repeat(64),
    }];
    bindProjectIoHooks({
      renderAll: vi.fn(),
      runValidate: vi.fn(),
      renderSidebar: vi.fn(),
      onSceneMutationCommit: vi.fn(async () => { throw new Error('目标已由外部程序创建'); }),
    });

    await saveAll();

    expect(project.operations).toEqual([]);
    expect(state.scenes.get('chapter/new')?.dirty).toBe(true);
    expect(state.pendingSceneDeletes).toHaveLength(1);
    expect(status.textContent).toContain('全部失败');
  });

  it('authority 回执缺少批次成员时不部分更新编辑器状态', async () => {
    const project = nestedScenarioProject();
    project.nestedFiles.add('new.gal');
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: '@scene new\n', eol: '\n', dirty: true, handle: null,
      persistedSha256: 'a'.repeat(64),
    });
    state.scenes.set('reader', {
      id: 'reader', file: 'reader.gal', text: '@scene reader\n@jump new\n', eol: '\n', dirty: true,
      handle: fileHandle(null, log, 'reader.gal'), persistedSha256: 'b'.repeat(64),
    });
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new', 'reader'], operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'c'.repeat(64),
    }];
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationCommit: vi.fn(async () => ({
        writes: [{ path: 'content/scenario/chapter/new.gal', sha256: 'd'.repeat(64) }],
        deletedPaths: ['content/scenario/chapter/old.gal'],
      })),
    });

    await saveAll();

    expect(state.scenes.get('chapter/new')).toMatchObject({ dirty: true, persistedSha256: 'a'.repeat(64) });
    expect(state.scenes.get('reader')).toMatchObject({ dirty: true, persistedSha256: 'b'.repeat(64) });
    expect(state.pendingSceneDeletes).toHaveLength(1);
    expect(project.operations).toEqual([]);
    expect(status.textContent).toContain('全部失败');
  });

  it('任一同步改写的场景仍保存失败时，不清理重命名前的旧文件', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.scenes.set('chapter/new', {
      id: 'new', file: 'chapter/new.gal', text: '@scene new\n', eol: '\n', dirty: true, handle: null,
    });
    state.scenes.set('reader', scene('reader', fileHandle('write', log, 'reader.gal')));
    state.pendingSceneDeletes = [{
      kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new',
    }];
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await saveAll();

    expect(project.operations).not.toContain('remove:chapter/old.gal');
    expect(project.nestedFiles.has('old.gal')).toBe(true);
    expect(state.scenes.get('chapter/new')?.dirty).toBe(true);
    expect(state.scenes.get('reader')?.dirty).toBe(true);
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('拒绝把场景写到 content/scenario 之外', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.scenes.set('escape', {
      id: 'escape', file: '../escape.gal', text: '@scene escape\n', eol: '\n', dirty: true, handle: null,
    });
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await saveAll();

    expect(project.operations).toEqual([]);
    expect(state.scenes.get('escape')?.dirty).toBe(true);
    expect(status.textContent).toContain('场景路径无效');
  });

  it('未连接 authority 时不直接删除嵌套场景并保留待处理记录', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.pendingSceneDeletes = [{ kind: 'delete', id: 'delete-me', file: 'chapter/delete-me.gal' }];
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await saveAll();

    expect(project.operations).toEqual([]);
    expect(project.nestedFiles.has('delete-me.gal')).toBe(true);
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('待删路径被当前场景重新占用时拒绝物理删除', async () => {
    const project = nestedScenarioProject();
    state.dirHandle = project.root;
    state.scenes.set('chapter/delete-me', {
      id: 'delete-me',
      file: 'chapter/delete-me.gal',
      text: '@scene delete-me\n',
      eol: '\n',
      dirty: false,
      handle: fileHandle(null, log, 'delete-me.gal'),
    });
    state.pendingSceneDeletes = [{ kind: 'delete', id: 'delete-me', file: 'chapter/delete-me.gal' }];
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });

    await saveAll();

    expect(project.operations).toEqual([]);
    expect(project.nestedFiles.has('delete-me.gal')).toBe(true);
    expect(state.pendingSceneDeletes).toHaveLength(1);
    expect(status.textContent).toContain('旧路径已被当前场景重新占用');
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
    const publish = vi.spyOn(workspace, 'publishEditorWorkspaceFile').mockResolvedValue(true);
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

    expect(publish).toHaveBeenCalledWith('content/timelines/gone.json', null);
    expect(removeEntry).not.toHaveBeenCalled();
    expect(state.pendingTimelineDeletes).toEqual([]);
    expect(state.pendingTimelineRestores.has('gone')).toBe(false);
    expect(timelineHistoryDepth('gone')).toEqual({ undo: 0, redo: 0 });
  });

  it('安全连接缺失时保留待删时间轴及撤销记录，不回退浏览器直删', async () => {
    const removeEntry = vi.fn();
    state.dirHandle = { getDirectoryHandle: async () => ({ getDirectoryHandle: async () => ({ removeEntry }) }) } as unknown as FileSystemDirectoryHandle;
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
    state.timelines.push(timeline('offline', fileHandle(null, log, 'offline'), false));
    pushTimelineSnapshot('offline', 'before');
    expect(deleteTimeline('offline')).toBe(true);
    await saveAll();
    expect(removeEntry).not.toHaveBeenCalled();
    expect(state.pendingTimelineDeletes).toEqual([{ id: 'offline', file: 'offline.json' }]);
    expect(state.pendingTimelineRestores.has('offline')).toBe(true);
    expect(timelineHistoryDepth('offline').undo).toBeGreaterThan(0);
    expect(status.title).toContain('安全保存服务未连接');
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
    const onProjectStateReset = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onProjectStateReset });
    state.mainTab = 'review' as never;
    (state as any).reviewWorkspace = { reviewId: 'old-review' };
    state.assetCenterFolder = 'content/assets/bg';
    state.lastValidation = { issues: [], scenes: new Map([['old', {} as never]]) };
    state.lastEdges = [{ from: 'old', to: 'stale', kind: 'jump' }];

    await openProjectFromHandle(root);

    expect(state.dirName).toBe('review-reset-project');
    expect(state.current).toBe('start');
    expect(state.mainTab).toBe('editor');
    expect((state as any).reviewWorkspace).toBeNull();
    expect(state.assetCenterFolder).toBe('all');
    expect(state.lastValidation).toBeNull();
    expect(state.lastEdges).toEqual([]);
    expect(onProjectStateReset).toHaveBeenCalledTimes(1);
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

  it.each(['{', '[]', '', 'null', '0'])('打开项目保留无法解析的 game.config.json 原文，场景生命周期不能将其当作无引用：%s', async (config) => {
    const root = directoryHandle('invalid-player-config', {
      content: directoryHandle('content', { scenario: directoryHandle('scenario', {}, {
        'end_a.gal': fileHandle(null, log, 'end_a.gal', '@scene end_a\n结束。\n@end\n'),
      }) }),
    }, { 'game.config.json': fileHandle(null, log, 'game.config.json', config) });
    await openProjectFromHandle(root);
    expect(state.gameConfigText).toBe(config);
    await expect(renameSceneAtKey('end_a')).rejects.toThrow(/game.config.json/);
    await expect(deleteSceneAtKey('end_a')).rejects.toThrow(/game.config.json/);
    expect(state.scenes.has('end_a')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(log).toEqual([]);
  });

  it.each(['{', '[]', '', 'null', '0'])('坏事件配置不能被当作缺失配置放行场景改名或删除：%s', async (config) => {
    const handle = fileHandle(null, log, 'events.json', config);
    const root = directoryHandle('invalid-events', { content: directoryHandle('content', {
      config: directoryHandle('config', {}, { 'events.json': handle }),
      scenario: directoryHandle('scenario', {}, {
        'end_a.gal': fileHandle(null, log, 'end_a.gal', '@scene end_a\n结束。\n@end\n'),
      }),
    }) }, { 'game.config.json': fileHandle(null, log, 'game.config.json', '{}') });
    await openProjectFromHandle(root);
    expect(state.handles.events).toBe(handle);
    await expect(renameSceneAtKey('end_a')).rejects.toThrow(/events.json/);
    await expect(deleteSceneAtKey('end_a')).rejects.toThrow(/events.json/);
    expect(state.scenes.has('end_a')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(log).toEqual([]);
  });

  it('读取带 BOM 的对象配置和成就数组，缺失配置没有错误，重开清除旧错误', async () => {
    const events = { events: [], extension: { keep: '原文' } };
    const achievements = [{ id: 'first', name: '初见' }];
    state.configReadErrors = { events: 'previous failure' };
    const root = directoryHandle('valid-configs', { content: directoryHandle('content', {
      config: directoryHandle('config', {}, {
        'events.json': fileHandle(null, log, 'events.json', '\uFEFF' + JSON.stringify(events)),
        'achievements.json': fileHandle(null, log, 'achievements.json', '\uFEFF' + JSON.stringify(achievements)),
      }),
      scenario: directoryHandle('scenario'),
    }) }, { 'game.config.json': fileHandle(null, log, 'game.config.json', '{}') });
    await openProjectFromHandle(root);
    expect(state.configReadErrors).toEqual({});
    expect(state.configFiles.events).toEqual(events);
    expect(state.configFiles.achievements).toEqual(achievements);
    expect(state.configFiles.gallery).toBeNull();
    expect(state.handles.gallery).toBeNull();
    expect(log).toEqual([]);
  });

  it('重新打开带 BOM 的开场配置保留原文并读取真实入口', async () => {
    const config = '\uFEFF{\r\n  "entryScene":"z_start","unknown":true\r\n}\r\n';
    const root = directoryHandle('bom-entry', { content: directoryHandle('content', { scenario: directoryHandle('scenario', {}, {
      'a_other.gal': fileHandle(null, log, 'a_other.gal', '@scene a_other\n@end\n'),
      'z_start.gal': fileHandle(null, log, 'z_start.gal', '@scene z_start\n@end\n'),
    }) }) }, { 'game.config.json': fileHandle(null, log, 'game.config.json', config) });
    await openProjectFromHandle(root);
    expect(state.entryScene).toBe('z_start');
    expect(state.gameConfigText).toBe(config);
    expect(log).toEqual([]);
  });

  it('只读结果不尝试绑定写服务，回到来源项目后恢复正常读取和保存入口', async () => {
    const root = directoryHandle('result');
    Object.assign(root, { queryPermission: async () => 'denied' });
    const reading = vi.fn(async (_root: FileSystemDirectoryHandle, readProject: () => Promise<void>) => readProject());
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onProjectReading: reading });
    await openProjectFromHandle(root, { source: 'review-fixture' });
    expect(state.reviewPreviewReadOnly).toBe(true);
    expect(reading).not.toHaveBeenCalled();
    await openProjectFromHandle(directoryHandle('source'));
    expect(state.reviewPreviewReadOnly).toBe(false);
    expect(reading).toHaveBeenCalledOnce();
    await openProjectFromHandle(directoryHandle('writable-result'), { source: 'review-fixture' });
    expect(state.reviewPreviewReadOnly).toBe(false);
    expect(reading).toHaveBeenCalledTimes(2);
  });

  it('写回后重新加载来源项目保留同一审阅及回执，真实读取新正文', async () => {
    const root = directoryHandle('source-project', {
      content: directoryHandle('content', { scenario: directoryHandle('scenario', {}, {
        'start.gal': fileHandle(null, log, 'start.gal', '@scene start\n写回后的正文。\n@end\n'),
      }) }),
    }, { 'game.config.json': fileHandle(null, log, 'game.config.json', '{"entryScene":"start"}') });
    const workspace = { reviewId: 'approved-review', approvalReceipt: { approvalId: 'kept-approval' } } as unknown as NonNullable<typeof state.reviewWorkspace>;
    state.reviewWorkspace = workspace;
    const settled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onProjectLoadSettled: settled });
    await openProjectFromHandle(root, { preserveReviewWorkspace: true });
    expect(state.reviewWorkspace).toBe(workspace);
    expect(state.mainTab).toBe('review');
    expect(state.scenes.get('start')?.text).toContain('写回后的正文');
    expect(settled).toHaveBeenCalledWith(true);
  });

  it.each(['config', 'game-config', 'scene', 'timeline', 'assets'])('%s 的真实读取故障不能冒充项目加载成功', async (area) => {
    const broken = fileHandle(null, log, area === 'scene' ? 'start.gal' : area === 'timeline' ? 'intro.json' : 'events.json');
    broken.getFile = async () => { throw new DOMException('read denied', 'NotAllowedError'); };
    const content = directoryHandle('content', {
      scenario: directoryHandle('scenario', {}, area === 'scene' ? { 'start.gal': broken } : {}),
      timelines: directoryHandle('timelines', {}, area === 'timeline' ? { 'intro.json': broken } : {}),
      config: directoryHandle('config', {}, area === 'config' ? { 'events.json': broken } : {}),
    });
    if (area === 'assets') {
      const getDirectory = content.getDirectoryHandle;
      content.getDirectoryHandle = async (name, options) => {
        if (name === 'assets') throw new DOMException('read denied', 'NotAllowedError');
        return getDirectory(name, options);
      };
    }
    const root = directoryHandle('unreadable-project', { content }, area === 'game-config' ? { 'game.config.json': broken } : {});
    const loaded = vi.fn(), settled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onProjectLoaded: loaded, onProjectLoadSettled: settled });
    await expect(openProjectFromHandle(root, { preserveReviewWorkspace: true })).rejects.toThrow('read denied');
    expect(loaded).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(false);
    expect(state.projectLoading).toBe(false);
  });

  it('打开项目的完整读取失败时保留旧项目事实、历史与审阅现场', async () => {
    const oldDir = directoryHandle('old-project');
    const oldSceneHandle = fileHandle(null, log, 'old.gal', '@scene old\n旧正文\n');
    const oldScene = scene('old', oldSceneHandle, false);
    const oldTimeline = timeline('old-timeline', fileHandle(null, log, 'old-timeline.json'), false);
    const oldHandles = {
      gameConfig: fileHandle(null, log, 'old-game.config.json'),
      achievements: null,
      calendar: null,
      events: null,
      growth: null,
      gallery: null,
      terminology: null,
    };
    const oldConfigFiles = {
      events: { old: true },
      growth: null,
      calendar: null,
      achievements: null,
      gallery: null,
      terminology: null,
    };
    const oldWorkspace = { reviewId: 'old-review' } as unknown as NonNullable<typeof state.reviewWorkspace>;
    const oldHistory = { past: ['旧快照'], future: [], lastPushAt: 1 };
    const oldTimelines = [oldTimeline];
    state.dirName = 'old-project';
    state.dirHandle = oldDir;
    state.scenes.set('old', oldScene);
    state.timelines = oldTimelines;
    state.current = 'old';
    state.currentTimeline = 'old-timeline';
    state.gameConfigText = '{"title":"旧配置"}';
    state.entryScene = 'old';
    state.handles = oldHandles as typeof state.handles;
    state.configFiles = oldConfigFiles as typeof state.configFiles;
    state.reviewWorkspace = oldWorkspace;
    state.mainTab = 'review';
    const oldValidation = { issues: [], scenes: new Map([['old', {} as never]]) };
    state.lastValidation = oldValidation;
    state.lastEdges = [{ from: 'old', to: 'old', kind: 'jump' }];
    const { histories } = await import('../src/history.js');
    histories.clear();
    histories.set('old', oldHistory);

    const broken = fileHandle(null, log, 'events.json');
    broken.getFile = async () => { throw new DOMException('read denied', 'NotAllowedError'); };
    const content = directoryHandle('content', {
      scenario: directoryHandle('scenario'),
      config: directoryHandle('config', {}, { 'events.json': broken }),
    });
    const root = directoryHandle('broken-project', { content });
    const onProjectClosing = vi.fn();
    const onProjectStateReset = vi.fn();
    const loaded = vi.fn();
    const settled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onProjectClosing, onProjectStateReset, onProjectLoaded: loaded, onProjectLoadSettled: settled });

    await expect(openProjectFromHandle(root, { preserveReviewWorkspace: true })).rejects.toThrow('read denied');

    expect(state.dirName).toBe('old-project');
    expect(state.dirHandle).toBe(oldDir);
    expect(state.scenes.get('old')).toBe(oldScene);
    expect(state.timelines).toBe(oldTimelines);
    expect(state.current).toBe('old');
    expect(state.currentTimeline).toBe('old-timeline');
    expect(state.gameConfigText).toBe('{"title":"旧配置"}');
    expect(state.entryScene).toBe('old');
    expect(state.handles).toBe(oldHandles);
    expect(state.configFiles).toBe(oldConfigFiles);
    expect(state.reviewWorkspace).toBe(oldWorkspace);
    expect(state.mainTab).toBe('review');
    expect(state.lastValidation).toBe(oldValidation);
    expect(state.lastEdges).toEqual([{ from: 'old', to: 'old', kind: 'jump' }]);
    expect(histories.get('old')).toBe(oldHistory);
    expect(onProjectClosing).not.toHaveBeenCalled();
    expect(onProjectStateReset).not.toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(false);
    expect(state.projectLoading).toBe(false);
  });

  it('重新加载当前项目的完整读取失败时保留可用工作区', async () => {
    const oldDir = directoryHandle('reload-project');
    const oldSceneHandle = fileHandle(null, log, 'old.gal', '@scene old\n旧正文\n');
    const oldScene = scene('old', oldSceneHandle, false);
    state.dirName = 'reload-project';
    state.dirHandle = oldDir;
    state.scenes.set('old', oldScene);
    state.current = 'old';
    state.gameConfigText = '{"title":"旧配置"}';
    state.entryScene = 'old';
    const oldHandles = state.handles;
    const oldConfigFiles = state.configFiles;
    const oldWorkspace = { reviewId: 'reload-review' } as unknown as NonNullable<typeof state.reviewWorkspace>;
    state.reviewWorkspace = oldWorkspace;
    state.mainTab = 'review';

    const broken = fileHandle(null, log, 'events.json');
    broken.getFile = async () => { throw new DOMException('read denied', 'NotAllowedError'); };
    const content = directoryHandle('content', {
      scenario: directoryHandle('scenario'),
      config: directoryHandle('config', {}, { 'events.json': broken }),
    });
    oldDir.getDirectoryHandle = async (name: string) => {
      if (name === 'content') return content;
      throw new DOMException(`missing directory ${name}`, 'NotFoundError');
    };
    const onProjectStateReset = vi.fn();
    const settled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onProjectStateReset, onProjectLoadSettled: settled });

    await expect(reloadCurrentProjectFromHandle({ preserveReviewWorkspace: true })).rejects.toThrow('read denied');

    expect(state.dirName).toBe('reload-project');
    expect(state.dirHandle).toBe(oldDir);
    expect(state.scenes.get('old')).toBe(oldScene);
    expect(state.current).toBe('old');
    expect(state.gameConfigText).toBe('{"title":"旧配置"}');
    expect(state.entryScene).toBe('old');
    expect(state.handles).toBe(oldHandles);
    expect(state.configFiles).toBe(oldConfigFiles);
    expect(state.reviewWorkspace).toBe(oldWorkspace);
    expect(state.mainTab).toBe('review');
    expect(onProjectStateReset).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(false);
    expect(state.projectLoading).toBe(false);
  });

  it('重新加载的工作区基线读取失败时不提交新项目事实', async () => {
    const oldDir = directoryHandle('baseline-project');
    const oldScene = scene('old', fileHandle(null, log, 'old.gal', '@scene old\n旧正文\n'), false);
    state.dirName = 'baseline-project';
    state.dirHandle = oldDir;
    state.scenes.set('old', oldScene);
    state.current = 'old';
    state.gameConfigText = '{"title":"旧配置"}';
    state.entryScene = 'old';
    const oldHandles = state.handles;
    const oldConfigFiles = state.configFiles;
    const oldWorkspace = { reviewId: 'baseline-review' } as unknown as NonNullable<typeof state.reviewWorkspace>;
    state.reviewWorkspace = oldWorkspace;
    state.mainTab = 'review';
    const onProjectStateReset = vi.fn();
    const settled = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onProjectStateReset,
      onProjectReading: async () => { throw new Error('workspace baseline failed'); }, onProjectLoadSettled: settled });

    await expect(reloadCurrentProjectFromHandle({ preserveReviewWorkspace: true })).rejects.toThrow('workspace baseline failed');

    expect(state.dirName).toBe('baseline-project');
    expect(state.dirHandle).toBe(oldDir);
    expect(state.scenes.get('old')).toBe(oldScene);
    expect(state.current).toBe('old');
    expect(state.gameConfigText).toBe('{"title":"旧配置"}');
    expect(state.entryScene).toBe('old');
    expect(state.handles).toBe(oldHandles);
    expect(state.configFiles).toBe(oldConfigFiles);
    expect(state.reviewWorkspace).toBe(oldWorkspace);
    expect(state.mainTab).toBe('review');
    expect(onProjectStateReset).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(false);
    expect(state.projectLoading).toBe(false);
  });

  it('场景改名或删除尚未保存时拒绝切换项目与演示项目', async () => {
    const root = directoryHandle('next-project', {
      content: directoryHandle('content', { scenario: directoryHandle('scenario') }),
    }, { 'game.config.json': fileHandle(null, log, 'game.config.json', '{}') });
    state.pendingSceneDeletes = [{ kind: 'delete', id: 'old', file: 'old.gal' }];

    await expect(openProjectFromHandle(root)).rejects.toThrow('请先保存全部');
    expect(() => loadDemoProject()).toThrow('请先保存全部');
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('切换到演示项目时清除上一项目的素材目录筛选', () => {
    const onProjectStateReset = vi.fn();
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onProjectStateReset });
    state.assetCenterFolder = 'content/assets/portrait';
    state.lastValidation = { issues: [], scenes: new Map([['old', {} as never]]) };
    state.lastEdges = [{ from: 'old', to: 'stale', kind: 'call' }];

    loadDemoProject();

    expect(state.assetCenterFolder).toBe('all');
    expect(state.lastValidation).toBeNull();
    expect(state.lastEdges).toEqual([]);
    expect(onProjectStateReset).toHaveBeenCalledTimes(1);
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
