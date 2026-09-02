import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, type SceneEntry } from '../src/state.js';
import {
  bindFlowHooks,
  deleteSceneAtKey,
  renameSceneAtKey,
  resolveFlowLinkSceneKeys,
  resolveSceneKeyForOperation,
} from '../src/panels/flow.js';
import type { FlowNode } from '../src/graph/build.js';
import { newScene } from '../src/panels/sidebar.js';

function scene(id: string, file: string, handle: FileSystemFileHandle | null): SceneEntry {
  return { id, file, text: `@scene ${id}\n`, eol: '\n', dirty: false, handle };
}

describe('场景路径安全生命周期', () => {
  const status = { textContent: '', title: '', className: '' };
  const requestValidate = vi.fn();
  const diskHandle = { kind: 'file', name: 'old.gal' } as FileSystemFileHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      getElementById: (id: string) => id === 'status' ? status : null,
    });
    vi.stubGlobal('window', { prompt: vi.fn(), confirm: vi.fn() });
    state.scenes = new Map();
    state.pendingSceneDeletes = [];
    state.current = null;
    state.dirHandle = {} as FileSystemDirectoryHandle;
    state.entryScene = '';
    state.configFiles = {
      events: null,
      growth: null,
      calendar: null,
      achievements: null,
      gallery: null,
      terminology: null,
    };
    state.projectWriteLock = null;
    status.textContent = '';
    requestValidate.mockClear();
    bindFlowHooks({ openScene: vi.fn(), requestValidate });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    state.scenes.clear();
    state.pendingSceneDeletes = [];
    state.dirHandle = null;
  });

  it('流程图只在 sceneId 对应唯一物理场景时返回操作目标', () => {
    state.scenes.set('chapter-a/shared', scene('shared', 'chapter-a/shared.gal', diskHandle));
    expect(resolveSceneKeyForOperation('shared')).toBe('chapter-a/shared');

    state.scenes.set('chapter-b/shared', scene('shared', 'chapter-b/shared.gal', diskHandle));
    expect(resolveSceneKeyForOperation('shared')).toBeNull();
    expect(resolveSceneKeyForOperation('missing')).toBeNull();
  });

  it('嵌套场景重命名保持目录，改写引用并登记旧文件而不立即删除', async () => {
    const prompt = vi.mocked(window.prompt);
    prompt.mockReturnValue('new');
    state.scenes.set('chapter/old', scene('old', 'chapter/old.gal', diskHandle));
    state.scenes.set('reader', {
      ...scene('reader', 'reader.gal', diskHandle),
      text: '@scene reader\n@jump old\n',
    });
    state.current = 'chapter/old';

    await renameSceneAtKey('chapter/old');

    expect(state.scenes.has('chapter/old')).toBe(false);
    expect(state.scenes.get('chapter/new')).toMatchObject({
      id: 'new', file: 'chapter/new.gal', dirty: true, handle: null,
    });
    expect(state.scenes.get('chapter/new')?.text).toContain('@scene new');
    expect(state.scenes.get('reader')?.text).toContain('@jump new');
    expect(state.pendingSceneDeletes).toEqual([
      { kind: 'rename', id: 'old', file: 'chapter/old.gal', replacementKey: 'chapter/new' },
    ]);
    expect(state.current).toBe('chapter/new');
    expect(requestValidate).toHaveBeenCalledOnce();

    await renameSceneAtKey('chapter/new');
    expect(prompt).toHaveBeenCalledOnce();
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('嵌套场景删除只登记精确旧路径，真正磁盘删除留给保存全部', async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    state.scenes.set('chapter/delete-me', scene('delete-me', 'chapter/delete-me.gal', diskHandle));
    state.current = 'chapter/delete-me';

    await deleteSceneAtKey('chapter/delete-me');

    expect(state.scenes.has('chapter/delete-me')).toBe(false);
    expect(state.pendingSceneDeletes).toEqual([
      { kind: 'delete', id: 'delete-me', file: 'chapter/delete-me.gal' },
    ]);
    expect(state.current).toBeNull();
    expect(requestValidate).toHaveBeenCalledOnce();
  });

  it('项目入口或宿主配置仍引用场景时拒绝改名和删除', async () => {
    const prompt = vi.mocked(window.prompt);
    const confirm = vi.mocked(window.confirm);
    state.scenes.set('chapter/entry', scene('entry', 'chapter/entry.gal', diskHandle));
    state.entryScene = 'entry';

    await renameSceneAtKey('chapter/entry');
    await deleteSceneAtKey('chapter/entry');

    expect(prompt).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(state.scenes.has('chapter/entry')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(status.textContent).toContain('请先在“配置”中改掉引用');

    state.entryScene = '';
    state.configFiles.events = { events: [{ id: 'host', scene: 'entry' }] };
    await renameSceneAtKey('chapter/entry');
    expect(prompt).not.toHaveBeenCalled();
    expect(state.scenes.has('chapter/entry')).toBe(true);
  });

  it('拒绝重复 ID 重命名与仅大小写改名', async () => {
    const prompt = vi.mocked(window.prompt);
    state.scenes.set('chapter-a/shared', scene('shared', 'chapter-a/shared.gal', diskHandle));
    state.scenes.set('chapter-b/shared', scene('shared', 'chapter-b/shared.gal', diskHandle));

    await renameSceneAtKey('chapter-a/shared');
    expect(prompt).not.toHaveBeenCalled();
    expect(state.scenes.has('chapter-a/shared')).toBe(true);

    state.scenes.delete('chapter-b/shared');
    prompt.mockReturnValue('SHARED');
    await renameSceneAtKey('chapter-a/shared');
    expect(state.scenes.has('chapter-a/shared')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(status.textContent).toContain('不能只改变场景文件名的大小写');
  });

  it('流程建链拒绝宿主入口和任一端存在重复场景 ID', () => {
    const node = (kind: FlowNode['kind'], sceneId: string): FlowNode => ({ kind, sceneId, id: `${kind}:${sceneId}` });
    state.scenes.set('source', scene('source', 'source.gal', diskHandle));
    state.scenes.set('chapter-a/target', scene('target', 'chapter-a/target.gal', diskHandle));

    expect(resolveFlowLinkSceneKeys(node('scene', 'source'), node('scene', 'target'))).toEqual({
      sourceKey: 'source',
      targetKey: 'chapter-a/target',
    });
    expect(resolveFlowLinkSceneKeys(node('host-entry', 'source'), node('scene', 'target'))).toBeNull();

    state.scenes.set('chapter-b/target', scene('target', 'chapter-b/target.gal', diskHandle));
    expect(resolveFlowLinkSceneKeys(node('scene', 'source'), node('scene', 'target'))).toBeNull();
  });

  it('待删除路径在保存前不能被同名新场景复用', () => {
    vi.mocked(window.prompt).mockReturnValueOnce('old');
    state.pendingSceneDeletes = [{ kind: 'delete', id: 'old', file: 'old.gal' }];

    newScene();

    expect(state.scenes.size).toBe(0);
    expect(window.prompt).toHaveBeenCalledOnce();
    expect(status.textContent).toContain('请先保存全部');
  });
});
