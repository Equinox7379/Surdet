import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, type SceneEntry } from '../src/state.js';
import {
  bindFlowHooks,
  deleteSceneAtKey,
  renameSceneAtKey,
  resolveFlowLinkSceneKeys,
  resolveSceneKeyForOperation,
  rewriteSceneRefs,
  countSceneRefs,
} from '../src/panels/flow.js';
import type { FlowNode } from '../src/graph/build.js';
import { newScene } from '../src/panels/sidebar.js';
import { bindProjectIoHooks } from '../src/project-io.js';
import { histories, setCurrentText, undo, redo } from '../src/history.js';

function scene(id: string, file: string, handle: FileSystemFileHandle | null): SceneEntry {
  return { id, file, text: `@scene ${id}\n`, eol: '\n', dirty: false, handle };
}

describe('场景路径安全生命周期', () => {
  it('改名与删除检查包含选项内联跳转，保留对白、引号和换行', () => {
    const source = '@scene start\r\n旁白：文字 @jump old\r\n@choice\r\n  前往 -> @set note = "@jump old" @jump old.end\r\n  返回 -> @call old\r\n@jump old\r\n';
    expect(countSceneRefs(source, 'old')).toBe(3);
    expect(rewriteSceneRefs(source, 'old', 'new')).toBe(source.replace(' @jump old.end', ' @jump new.end').replace(' @call old', ' @call new').replace('\r\n@jump old', '\r\n@jump new'));
  });
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
    histories.clear();
    state.pendingSceneDeletes = [];
    state.pendingSceneCommit = null;
    state.current = null;
    state.dirHandle = {} as FileSystemDirectoryHandle;
    state.entryScene = '';
    state.gameConfigText = '';
    state.handles.gameConfig = null;
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
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    state.scenes.clear();
    state.pendingSceneDeletes = [];
    state.pendingSceneCommit = null;
    state.dirHandle = null;
  });

  it('流程图只在 sceneId 对应唯一物理场景时返回操作目标', () => {
    state.scenes.set('chapter-a/shared', scene('shared', 'chapter-a/shared.gal', diskHandle));
    expect(resolveSceneKeyForOperation('shared')).toBe('chapter-a/shared');

    state.scenes.set('chapter-b/shared', scene('shared', 'chapter-b/shared.gal', diskHandle));
    expect(resolveSceneKeyForOperation('shared')).toBeNull();
    expect(resolveSceneKeyForOperation('missing')).toBeNull();
  });

  it('改名迁移正文历史并同步历史中的引用，删除后同名新建不继承旧正文', async () => {
    state.scenes.set('old', scene('old', 'old.gal', null));
    state.scenes.set('reader', { ...scene('reader', 'reader.gal', null), text: '@scene reader\n@jump old\n' });
    state.current = 'old';
    setCurrentText('@scene old\n修改正文\n');
    state.current = 'reader';
    setCurrentText('@scene reader\n其他正文\n@jump old\n');
    state.current = 'old';
    vi.mocked(window.prompt).mockReturnValue('new');
    await renameSceneAtKey('old');
    undo();
    expect(state.scenes.get('new')!.text).toBe('@scene new\n');
    redo();
    expect(state.scenes.get('new')!.text).toBe('@scene new\n修改正文\n');
    state.current = 'reader';
    undo();
    expect(state.scenes.get('reader')!.text).toContain('@jump new');
    state.current = 'new';
    vi.mocked(window.confirm).mockReturnValue(true);
    await deleteSceneAtKey('new');
    vi.mocked(window.prompt).mockReturnValueOnce('new').mockReturnValueOnce('0');
    await newScene();
    state.current = 'new';
    const fresh = state.scenes.get('new')!.text;
    undo();
    expect(state.scenes.get('new')!.text).toBe(fresh);
    expect(histories.has('old')).toBe(false);
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
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationPlan: vi.fn(async () => ({
        operationId: '11111111-1111-4111-8111-111111111111',
        planFingerprint: 'a'.repeat(64),
      })),
    });

    await renameSceneAtKey('chapter/old');

    expect(state.scenes.has('chapter/old')).toBe(false);
    expect(state.scenes.get('chapter/new')).toMatchObject({
      id: 'new', file: 'chapter/new.gal', dirty: true, handle: null,
    });
    expect(state.scenes.get('chapter/new')?.text).toContain('@scene new');
    expect(state.scenes.get('reader')?.text).toContain('@jump new');
    expect(state.pendingSceneDeletes).toEqual([
      {
        kind: 'rename',
        id: 'old',
        file: 'chapter/old.gal',
        replacementKey: 'chapter/new',
        affectedSceneKeys: ['chapter/new', 'reader'],
        operationId: '11111111-1111-4111-8111-111111111111',
        planFingerprint: 'a'.repeat(64),
      },
    ]);
    expect(state.current).toBe('chapter/new');
    expect(requestValidate).toHaveBeenCalledOnce();

    await renameSceneAtKey('chapter/new');
    expect(prompt).toHaveBeenCalledOnce();
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('真实项目改名先冻结源与目标身份，再把新场景和引用登记为同一保存组', async () => {
    vi.mocked(window.prompt).mockReturnValue('new');
    state.scenes.set('chapter/old', {
      ...scene('old', 'chapter/old.gal', diskHandle),
      persistedSha256: 'a'.repeat(64),
    });
    state.scenes.set('reader', {
      ...scene('reader', 'reader.gal', diskHandle),
      text: '@scene reader\n@jump old\n',
      persistedSha256: 'b'.repeat(64),
    });
    const onSceneMutationPlan = vi.fn(async (input) => {
      expect(state.scenes.has('chapter/old')).toBe(true);
      expect(state.scenes.get('reader')?.text).toContain('@jump old');
      return {
        operationId: '11111111-1111-4111-8111-111111111111',
        planFingerprint: 'c'.repeat(64),
      };
    });
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan,
    });

    await renameSceneAtKey('chapter/old');

    expect(onSceneMutationPlan).toHaveBeenCalledWith({
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });
    expect(state.pendingSceneDeletes).toEqual([{
      kind: 'rename',
      id: 'old',
      file: 'chapter/old.gal',
      replacementKey: 'chapter/new',
      affectedSceneKeys: ['chapter/new', 'reader'],
      operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'c'.repeat(64),
    }]);
  });

  it('等待安全计划期间的最新引用编辑不会被旧快照覆盖', async () => {
    vi.mocked(window.prompt).mockReturnValue('new');
    state.scenes.set('old', {
      ...scene('old', 'old.gal', diskHandle), persistedSha256: 'a'.repeat(64),
    });
    state.scenes.set('reader', {
      ...scene('reader', 'reader.gal', diskHandle), text: '@scene reader\n@jump old\n',
      persistedSha256: 'b'.repeat(64),
    });
    let finishPlan!: (value: { operationId: string; planFingerprint: string }) => void;
    const plan = new Promise<{ operationId: string; planFingerprint: string }>((resolve) => {
      finishPlan = resolve;
    });
    const onSceneMutationPlan = vi.fn(() => plan);
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan,
    });

    const renaming = renameSceneAtKey('old');
    await vi.waitFor(() => expect(onSceneMutationPlan).toHaveBeenCalledOnce());
    state.scenes.get('reader')!.text = '@scene reader\n刚刚补写的内容。\n@jump old\n';
    state.scenes.get('reader')!.dirty = true;
    finishPlan({
      operationId: '11111111-1111-4111-8111-111111111111',
      planFingerprint: 'c'.repeat(64),
    });
    await renaming;

    expect(state.scenes.get('reader')?.text).toBe('@scene reader\n刚刚补写的内容。\n@jump new\n');
    expect(state.pendingSceneDeletes[0]?.affectedSceneKeys).toEqual(['new', 'reader']);
  });

  it('后续改名会同步更新先前保存组中的引用场景 key', async () => {
    vi.mocked(window.prompt).mockReturnValueOnce('a2').mockReturnValueOnce('b2');
    state.scenes.set('a', {
      ...scene('a', 'a.gal', diskHandle), text: '@scene a\n', persistedSha256: 'a'.repeat(64),
    });
    state.scenes.set('b', {
      ...scene('b', 'b.gal', diskHandle), text: '@scene b\n@jump a\n', persistedSha256: 'b'.repeat(64),
    });
    let sequence = 0;
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationPlan: vi.fn(async () => ({
        operationId: sequence++ === 0
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222',
        planFingerprint: 'c'.repeat(64),
      })),
    });

    await renameSceneAtKey('a');
    await renameSceneAtKey('b');

    expect(state.pendingSceneDeletes[0]?.affectedSceneKeys).toEqual(['a2', 'b2']);
    expect(state.pendingSceneDeletes[1]).toMatchObject({
      kind: 'rename', file: 'b.gal', replacementKey: 'b2', affectedSceneKeys: ['b2'],
    });
    expect(state.pendingSceneDeletes.flatMap((pending) => pending.affectedSceneKeys ?? [])).not.toContain('b');
  });

  it('删除引用场景会从先前改名保存组中移除陈旧 key', async () => {
    vi.mocked(window.prompt).mockReturnValue('a2');
    vi.mocked(window.confirm).mockReturnValue(true);
    state.scenes.set('a', {
      ...scene('a', 'a.gal', diskHandle), persistedSha256: 'a'.repeat(64),
    });
    state.scenes.set('reader', {
      ...scene('reader', 'reader.gal', diskHandle), text: '@scene reader\n@jump a\n', persistedSha256: 'b'.repeat(64),
    });
    let sequence = 0;
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationPlan: vi.fn(async () => ({
        operationId: sequence++ === 0
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222',
        planFingerprint: 'c'.repeat(64),
      })),
    });

    await renameSceneAtKey('a');
    await deleteSceneAtKey('reader');

    expect(state.pendingSceneDeletes[0]?.affectedSceneKeys).toEqual(['a2']);
    expect(state.pendingSceneDeletes[1]).toMatchObject({ kind: 'delete', file: 'reader.gal' });
  });

  it('嵌套场景删除只登记精确旧路径，真正磁盘删除留给保存全部', async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    state.scenes.set('chapter/delete-me', scene('delete-me', 'chapter/delete-me.gal', diskHandle));
    state.current = 'chapter/delete-me';
    bindProjectIoHooks({
      renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(),
      onSceneMutationPlan: vi.fn(async () => ({
        operationId: '22222222-2222-4222-8222-222222222222',
        planFingerprint: 'b'.repeat(64),
      })),
    });

    await deleteSceneAtKey('chapter/delete-me');

    expect(state.scenes.has('chapter/delete-me')).toBe(false);
    expect(state.pendingSceneDeletes).toEqual([
      {
        kind: 'delete', id: 'delete-me', file: 'chapter/delete-me.gal',
        operationId: '22222222-2222-4222-8222-222222222222',
        planFingerprint: 'b'.repeat(64),
      },
    ]);
    expect(state.current).toBeNull();
    expect(requestValidate).toHaveBeenCalledOnce();
  });

  it('真实项目缺少安全计划服务时保持场景与引用原样', async () => {
    vi.mocked(window.prompt).mockReturnValue('new');
    state.scenes.set('old', scene('old', 'old.gal', diskHandle));
    state.scenes.set('reader', {
      ...scene('reader', 'reader.gal', diskHandle),
      text: '@scene reader\n@jump old\n',
    });

    await expect(renameSceneAtKey('old')).rejects.toThrow('安全保存服务未连接');

    expect(state.scenes.has('old')).toBe(true);
    expect(state.scenes.has('new')).toBe(false);
    expect(state.scenes.get('reader')?.text).toContain('@jump old');
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(requestValidate).not.toHaveBeenCalled();
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
    expect(status.textContent).toContain('请先调整对应配置中的引用');

    state.entryScene = '';
    state.configFiles.events = { events: [{ id: 'host', scene: 'entry' }] };
    await renameSceneAtKey('chapter/entry');
    expect(prompt).not.toHaveBeenCalled();
    expect(state.scenes.has('chapter/entry')).toBe(true);
  });

  it.each(['end_a', 'chapter/end_a'])('结束配置保护语义 ID，拒绝 %s 改名或删除且不触碰正文、配置、历史与保存计划', async (key) => {
    state.scenes.set(key, scene('end_a', `${key}.gal`, diskHandle));
    state.scenes.set('start', { ...scene('start', 'start.gal', null), text: '@scene start\n@jump end_a\n' });
    state.entryScene = 'start';
    state.current = key;
    setCurrentText('@scene end_a\n还未保存的结局。\n@end\n');
    const readDisk = vi.fn(async () => ({ text: async () => '{"player":{"endScenes":[]}}' }));
    state.handles.gameConfig = { getFile: readDisk } as unknown as FileSystemFileHandle;
    state.gameConfigText = '\uFEFF{\r\n "entryScene":"start", "player":{"endScenes":["end_a","end_b"],"custom":42}, "custom":"保留"\r\n}';
    const config = state.gameConfigText;
    const before = structuredClone([...state.scenes]);
    const history = structuredClone([...histories]);
    const plan = vi.fn(async () => ({ operationId: '11111111-1111-4111-8111-111111111111', planFingerprint: 'a'.repeat(64) }));
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan: plan });
    vi.mocked(window.prompt).mockReturnValue('final_a');
    vi.mocked(window.confirm).mockReturnValue(true);
    await renameSceneAtKey(key);
    expect(status.textContent).toContain('game.config.json 的 player.endScenes');
    expect([...state.scenes]).toEqual(before);
    // 删除病例没有任何剧情引用，只剩结束配置。
    state.scenes.delete('start');
    const beforeDelete = structuredClone([...state.scenes]);
    await deleteSceneAtKey(key);
    expect([...state.scenes]).toEqual(beforeDelete);
    expect(state.gameConfigText).toBe(config);
    expect([...histories]).toEqual(history);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(state.current).toBe(key);
    expect(plan).not.toHaveBeenCalled();
    expect(readDisk).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each(['{', '[]', '{"player":null}', '{"player":{"endScenes":"end_a"}}', '{"player":{"endScenes":[42]}}'])('配置不可安全读取时不把它当作无引用：%s', async (config) => {
    state.scenes.set('end_a', scene('end_a', 'end_a.gal', null));
    state.gameConfigText = config;
    await expect(renameSceneAtKey('end_a')).rejects.toThrow(/game.config.json/);
    await expect(deleteSceneAtKey('end_a')).rejects.toThrow(/game.config.json/);
    expect(state.scenes.has('end_a')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(window.prompt).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each(['{}', '{"player":{}}', '{"player":{"endScenes":[]}}', '{"player":{"endScenes":["other"]}}'])('无关结束配置不妨碍正常改名与删除：%s', async (config) => {
    state.gameConfigText = config;
    state.scenes.set('old', scene('old', 'old.gal', null));
    state.scenes.set('reader', { ...scene('reader', 'reader.gal', null), text: '@scene reader\n@jump old\n' });
    vi.mocked(window.prompt).mockReturnValue('new');
    await renameSceneAtKey('old');
    expect(state.scenes.has('new')).toBe(true);
    expect(state.scenes.get('reader')?.text).toContain('@jump new');
    vi.mocked(window.confirm).mockReturnValue(true);
    await deleteSceneAtKey('new');
    expect(state.scenes.has('new')).toBe(false);
    expect(state.gameConfigText).toBe(config);
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

  it('待删除路径在保存前不能被同名新场景复用', async () => {
    vi.mocked(window.prompt).mockReturnValueOnce('old');
    state.pendingSceneDeletes = [{ kind: 'delete', id: 'old', file: 'old.gal' }];

    await newScene();

    expect(state.scenes.size).toBe(0);
    expect(window.prompt).toHaveBeenCalledOnce();
    expect(status.textContent).toContain('请先保存全部');
  });

  it('同一未保存批次中的多个新场景共享稳定请求身份', async () => {
    vi.mocked(window.prompt)
      .mockReturnValueOnce('first').mockReturnValueOnce(null)
      .mockReturnValueOnce('second').mockReturnValueOnce(null);

    await newScene();
    await newScene();

    const first = state.scenes.get('first')?.pendingCreateOperationId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.scenes.get('second')?.pendingCreateOperationId).toBe(first);
  });
});
