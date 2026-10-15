import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state, type SceneEntry } from '../src/state.js';
import {
  bindFlowHooks,
  deleteSceneAtKey,
  renameSceneAtKey,
  moveSceneAtKey,
  openRenameSceneDialog,
  sceneChapterDirectory,
  resolveFlowLinkSceneKeys,
  resolveSceneKeyForOperation,
  rewriteSceneRefs,
  countSceneRefs,
} from '../src/panels/flow.js';
import type { FlowNode } from '../src/graph/build.js';
import { createScene } from '../src/panels/sidebar.js';
import { bindProjectIoHooks, workingGameConfigText } from '../src/project-io.js';
import { createEditorProjectStorage } from '../src/authoring-project-storage.js';
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
    vi.stubGlobal('window', { confirm: vi.fn() });
    state.scenes = new Map();
    histories.clear();
    state.pendingSceneDeletes = [];
    state.pendingSceneCommit = null;
    state.pendingSceneConfigWrites = [];
    state.pendingSceneConfigRenames = [];
    state.configReadErrors = {};
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

  it('尚未保存的新场景改名不抢走既有项目的隐式入口，并保留 BOM 声明', async () => {
    state.scenes.set('a_draft', { ...scene('a_draft', 'a_draft.gal', null), text: '\uFEFF@scene a_draft\r\n正文。\r\n', eol: '\r\n', pendingCreateOperationId: '11111111-1111-4111-8111-111111111111' });
    state.scenes.set('reader', scene('reader', 'reader.gal', diskHandle));
    await renameSceneAtKey('a_draft', 'z_draft');
    expect(JSON.parse(state.gameConfigText).entryScene).toBe('reader');
    expect(state.scenes.get('z_draft')?.text).toBe('\uFEFF@scene z_draft\r\n正文。\r\n');
  });

  it.each(['old.GAL', 'chapter/old.GaL', 'old.gal'].flatMap(file => ['', '\uFEFF'].map(bom => ({ file, bom }))))(
    '场景声明改名同步当前与双向历史，保留字节风格：$file / BOM=$bom', async ({ file, bom }) => {
      const key = file.replace(/\.gal$/i, '');
      const nextKey = key.replace(/old$/, 'new');
      const text = (id: string, body: string) => `${bom}\t@scene ${id}\r\n// old 不应改变\r\n旁白：${body}\r\n`;
      state.scenes.set(key, { ...scene('old', file, diskHandle), text: text('old', '当前'), eol: '\r\n' });
      histories.set(key, { past: [text('old', '过去')], future: [text('old', '未来')], lastPushAt: 0 });
      state.current = key;
      bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan: async () => ({ operationId: 'rename', planFingerprint: 'a'.repeat(64) }) });
      await renameSceneAtKey(key, 'old');
      expect(state.scenes.get(key)?.text).toBe(text('old', '当前'));
      expect(histories.get(key)?.past).toEqual([text('old', '过去')]);
      await renameSceneAtKey(key, 'new');
      expect(state.scenes.get(nextKey)?.text).toBe(text('new', '当前'));
      expect(histories.get(nextKey)?.future).toEqual([text('new', '未来')]);
      undo(); expect(state.scenes.get(nextKey)?.text).toBe(text('new', '过去'));
      redo(); expect(state.scenes.get(nextKey)?.text).toBe(text('new', '当前'));
      redo(); expect(state.scenes.get(nextKey)?.text).toBe(text('new', '未来'));
    },
  );

  it('新场景移动也保留既有磁盘入口；待删除的原入口不被静默替换', async () => {
    state.scenes.set('a_draft', scene('a_draft', 'a_draft.gal', null));
    state.scenes.set('reader', scene('reader', 'reader.gal', diskHandle));
    await moveSceneAtKey('a_draft', 'chapter');
    expect(state.scenes.get('chapter/a_draft')?.pendingEntryScene).toBe('reader');
    delete state.scenes.get('chapter/a_draft')!.pendingEntryScene;
    state.scenes.delete('reader');
    state.pendingSceneDeletes.push({ kind: 'delete', id: 'reader', file: 'reader.gal' });
    await expect(renameSceneAtKey('chapter/a_draft', 'new')).rejects.toThrow('原缺省开场场景');
    expect(state.scenes.get('chapter/a_draft')?.id).toBe('a_draft');
  });

  it.each(['past', 'future'] as const)('历史 %s 的声明失配时，场景、配置和其他历史都保持原样', async branch => {
    state.scenes.set('old', { ...scene('old', 'old.gal', null), text: '\uFEFF@scene old\r\n正文\r\n' });
    state.gameConfigText = '{"entryScene":"old"}';
    const history = { past: [] as string[], future: [] as string[], lastPushAt: 0 };
    history[branch] = ['\uFEFF@scene unexpected\r\n历史\r\n'];
    histories.set('old', history);
    const before = structuredClone([...state.scenes]);
    await expect(renameSceneAtKey('old', 'new')).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect([...state.scenes]).toEqual(before);
    expect(state.gameConfigText).toBe('{"entryScene":"old"}');
    expect(state.pendingSceneConfigRenames).toEqual([]);
    expect(histories.get('old')).toEqual(history);
  });

  it('写入保护拒绝 BOM 场景改名前不弹窗、不改变正文', async () => {
    const text = '\uFEFF@scene old\r\n';
    state.scenes.set('old', { ...scene('old', 'old.gal', null), text });
    state.projectWriteLock = 'asset-relocation';
    expect(() => openRenameSceneDialog('old')).toThrow('素材整理进行中');
    await expect(renameSceneAtKey('old', 'new')).rejects.toThrow('素材整理进行中');
    expect(state.scenes.get('old')?.text).toBe(text);
  });

  it('移动章节只改目录和历史 key，保留正文、引用、后缀与缺省入口投影', async () => {
    const planned = vi.fn(async () => ({ operationId: 'move', planFingerprint: 'f'.repeat(64) }));
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan: planned });
    const source = '@scene first\r\n// 注释\r\n旁白：正文。\r\n';
    state.gameConfigText = '{"unknown": {"keep":true}}';
    state.scenes.set('first', { ...scene('first', 'first.GAL', diskHandle), text: source, eol: '\r\n', persistedSha256: 'a'.repeat(64) });
    state.scenes.set('reader', { ...scene('reader', 'reader.gal', diskHandle), text: '@call first\n' });
    state.current = 'first';
    setCurrentText(source + '旁白：后来。\r\n');
    await moveSceneAtKey('first', '第一章/雨夜');
    expect(planned).toHaveBeenCalledWith({ kind: 'rename', sourcePath: 'content/scenario/first.GAL', targetPath: 'content/scenario/第一章/雨夜/first.GAL' });
    expect(state.current).toBe('第一章/雨夜/first');
    expect(state.scenes.get(state.current)).toMatchObject({ id: 'first', file: '第一章/雨夜/first.GAL', pendingEntryScene: 'first', dirty: true, handle: null });
    expect(state.scenes.get('reader')!.text).toBe('@call first\n');
    expect(state.gameConfigText).toBe('{"unknown": {"keep":true}}');
    expect(JSON.parse(workingGameConfigText())).toEqual({ unknown: { keep: true }, entryScene: 'first' });
    expect(JSON.parse((await createEditorProjectStorage().readText('game.config.json')).text).entryScene).toBe('first');
    undo(); expect(state.scenes.get(state.current)!.text).toBe(source);
    redo(); expect(state.scenes.get(state.current)!.text).toBe(source + '旁白：后来。\r\n');
    expect(state.pendingSceneDeletes[0]).toMatchObject({ kind: 'rename', file: 'first.GAL', replacementKey: state.current });
    await expect(moveSceneAtKey(state.current!, '第二章')).rejects.toThrow('尚未完成的改名');
    expect(planned).toHaveBeenCalledTimes(1);
  });

  it('移动已被配置引用的场景不改引用，取消/不安全目录/服务拒绝均不改内存', async () => {
    state.gameConfigText = '{"entryScene":"first","player":{"endScenes":["first"]}}';
    state.entryScene = 'first';
    state.scenes.set('first', scene('first', 'first.gal', diskHandle));
    const before = [...state.scenes].map(([key, scene]) => [key, { ...scene }]);
    await moveSceneAtKey('first', '');
    await expect(moveSceneAtKey('first', '../outside')).rejects.toThrow();
    await expect(moveSceneAtKey('first', 'chapter')).rejects.toThrow('未连接');
    expect([...state.scenes]).toEqual(before);
    expect(state.pendingSceneDeletes).toEqual([]);
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan: async () => ({ operationId: 'move', planFingerprint: 'b'.repeat(64) }) });
    await moveSceneAtKey('first', 'chapter');
    expect(state.scenes.get('chapter/first')!.pendingEntryScene).toBeUndefined();
    expect(state.gameConfigText).toBe('{"entryScene":"first","player":{"endScenes":["first"]}}');
  });

  it('恢复条目携带项目相对完整路径时，章节输入仍相对 scenario 根目录', async () => {
    state.gameConfigText = '{"entryScene":"first"}';
    state.scenes.set('chapter/first', scene('first', 'content/scenario/chapter/first.GAL', null));
    expect(sceneChapterDirectory(state.scenes.get('chapter/first')!)).toBe('chapter');
    await moveSceneAtKey('chapter/first', 'next');
    expect(state.scenes.get('next/first')).toMatchObject({ id: 'first', file: 'next/first.GAL' });
  });

  it('历史中无法安全改写的引用在改动当前场景之前拒绝，保留所有内存内容', async () => {
    state.scenes.set('old', scene('old', 'old.gal', null));
    state.scenes.set('reader', { ...scene('reader', 'reader.gal', null), text: '@scene reader\n@call old\n' });
    histories.set('reader', { past: ['@scene reader\n@call "old"\n'], future: [], lastPushAt: 0 });
    const beforeScenes = structuredClone([...state.scenes]);
    const beforeHistories = structuredClone([...histories]);
    await expect(renameSceneAtKey('old', 'new')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect([...state.scenes]).toEqual(beforeScenes);
    expect([...histories]).toEqual(beforeHistories);
    expect(state.pendingSceneDeletes).toEqual([]);
  });

  it('改名迁移正文和引用历史；新场景与既有场景一样须先保存再删除', async () => {
    state.scenes.set('old', scene('old', 'old.gal', null));
    state.scenes.set('reader', { ...scene('reader', 'reader.gal', null), text: '@scene reader\n@jump old\n' });
    state.current = 'old';
    setCurrentText('@scene old\n修改正文\n');
    state.current = 'reader';
    setCurrentText('@scene reader\n其他正文\n@jump old\n');
    state.current = 'old';
    await renameSceneAtKey('old', 'new');
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
    expect(state.scenes.has('new')).toBe(true);
    expect(status.textContent).toContain('请先保存全部再删除');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(histories.has('old')).toBe(false);
  });

  it('删除后同名新建不继承旧正文历史', async () => {
    state.scenes.set('new', scene('new', 'new.gal', null));
    state.current = 'new';
    setCurrentText('@scene new\n修改正文\n');
    vi.mocked(window.confirm).mockReturnValue(true);
    await deleteSceneAtKey('new');
    expect(state.scenes.has('new')).toBe(false);
    await createScene('new', 0);
    state.current = 'new';
    const fresh = state.scenes.get('new')!.text;
    undo();
    expect(state.scenes.get('new')!.text).toBe(fresh);
    expect(histories.has('old')).toBe(false);
  });

  it.each(['CON', 'nul', 'LPT1'])('portable scene creation and rename reject device name %s before editing', async id => {
    state.scenes.set('old', scene('old', 'old.gal', null));
    const before = [...state.scenes].map(([key, entry]) => [key, { ...entry }]);
    await expect(createScene(id)).rejects.toThrow(/Windows 设备名/);
    await expect(renameSceneAtKey('old', id)).rejects.toThrow(/Windows 设备名/);
    expect([...state.scenes]).toEqual(before);
    expect(state.pendingSceneDeletes).toEqual([]);
  });

  it('portable scene creation refuses a case alias of a nested scene', async () => {
    state.scenes.set('chapter/old', scene('old', 'chapter/old.gal', null));
    await expect(createScene('OLD')).rejects.toThrow(/已存在/);
    expect([...state.scenes.keys()]).toEqual(['chapter/old']);
  });

  it('嵌套场景重命名保持目录，改写引用并登记旧文件而不立即删除', async () => {
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

    await renameSceneAtKey('chapter/old', 'new');

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

    await expect(renameSceneAtKey('chapter/new', 'newer')).rejects.toThrow('尚未保存的改名');
    expect(state.pendingSceneDeletes).toHaveLength(1);
  });

  it('真实项目改名先冻结源与目标身份，再把新场景和引用登记为同一保存组', async () => {
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

    await renameSceneAtKey('chapter/old', 'new');

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

    const renaming = renameSceneAtKey('old', 'new');
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

    await renameSceneAtKey('a', 'a2');
    await renameSceneAtKey('b', 'b2');

    expect(state.pendingSceneDeletes[0]?.affectedSceneKeys).toEqual(['a2', 'b2']);
    expect(state.pendingSceneDeletes[1]).toMatchObject({
      kind: 'rename', file: 'b.gal', replacementKey: 'b2', affectedSceneKeys: ['b2'],
    });
    expect(state.pendingSceneDeletes.flatMap((pending) => pending.affectedSceneKeys ?? [])).not.toContain('b');
  });

  it('删除引用场景会从先前改名保存组中移除陈旧 key', async () => {
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

    await renameSceneAtKey('a', 'a2');
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
    state.scenes.set('old', scene('old', 'old.gal', diskHandle));
    state.scenes.set('reader', {
      ...scene('reader', 'reader.gal', diskHandle),
      text: '@scene reader\n@jump old\n',
    });

    await expect(renameSceneAtKey('old', 'new')).rejects.toThrow('安全保存服务未连接');

    expect(state.scenes.has('old')).toBe(true);
    expect(state.scenes.has('new')).toBe(false);
    expect(state.scenes.get('reader')?.text).toContain('@jump old');
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(requestValidate).not.toHaveBeenCalled();
  });

  it('项目入口或宿主配置仍引用场景时拒绝删除', async () => {
    const confirm = vi.mocked(window.confirm);
    state.scenes.set('chapter/entry', scene('entry', 'chapter/entry.gal', diskHandle));
    state.entryScene = 'entry';

    await deleteSceneAtKey('chapter/entry');

    expect(confirm).not.toHaveBeenCalled();
    expect(state.scenes.has('chapter/entry')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(status.textContent).toContain('请先调整对应配置中的引用');

    state.entryScene = '';
    state.configFiles.events = { events: [{ id: 'host', scene: 'entry' }] };
    await deleteSceneAtKey('chapter/entry');
    expect(state.scenes.has('chapter/entry')).toBe(true);
  });

  it('文本回想引用保护场景，不能仅因为没有普通跳转就删除', async () => {
    state.scenes.set('old', scene('old', 'old.gal', null));
    state.configFiles.gallery = { texts: [{ id: 'memory', scene: 'old', label: 'entry' }] };
    await deleteSceneAtKey('old');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(state.scenes.get('old')?.text).toBe('@scene old\n');
    expect(status.textContent).toContain('文本回想配置');
  });

  it.each(['end_a', 'chapter/end_a'])('结束配置拒绝删除 %s；改名联动正文、结束配置和历史但不提前写盘', async (key) => {
    state.scenes.set(key, scene('end_a', `${key}.gal`, diskHandle));
    state.scenes.set('start', { ...scene('start', 'start.gal', null), text: '@scene start\n@jump end_a\n' });
    state.entryScene = 'start';
    state.current = key;
    setCurrentText('@scene end_a\n还未保存的结局。\n@end\n');
    state.gameConfigText = '\uFEFF{\r\n "entryScene":"start", "player":{"endScenes":["end_a","end_b"],"custom":42}, "custom":"保留"\r\n}';
    const config = state.gameConfigText;
    const readDisk = vi.fn(async () => new File([config], 'game.config.json'));
    state.handles.gameConfig = { getFile: readDisk } as unknown as FileSystemFileHandle;
    const before = structuredClone([...state.scenes]);
    const plan = vi.fn(async () => ({ operationId: '11111111-1111-4111-8111-111111111111', planFingerprint: 'a'.repeat(64) }));
    bindProjectIoHooks({ renderAll: vi.fn(), runValidate: vi.fn(), renderSidebar: vi.fn(), onSceneMutationPlan: plan });
    vi.mocked(window.confirm).mockReturnValue(true);
    await deleteSceneAtKey(key);
    expect(status.textContent).toContain('game.config.json 的 player.endScenes');
    expect([...state.scenes]).toEqual(before);
    expect(window.confirm).not.toHaveBeenCalled();
    await renameSceneAtKey(key, 'final_a');
    const nextKey = key.replace('end_a', 'final_a');
    expect(state.current).toBe(nextKey);
    expect(state.scenes.get(nextKey)?.text).toContain('@scene final_a\n还未保存的结局');
    expect(state.scenes.get('start')?.text).toContain('@jump final_a');
    expect(JSON.parse(state.gameConfigText.replace(/^\uFEFF/, ''))).toMatchObject({ entryScene: 'start', player: { endScenes: ['final_a', 'end_b'], custom: 42 }, custom: '保留' });
    expect(state.gameConfigText.startsWith('\uFEFF')).toBe(true);
    expect(state.pendingSceneConfigWrites).toHaveLength(1);
    expect(state.pendingSceneConfigWrites[0]?.text).toBe(state.gameConfigText);
    expect(plan).toHaveBeenCalledOnce();
    undo();
    expect(state.scenes.get(nextKey)?.text).toBe('@scene final_a\n');
  });

  it.each(['{', '[]', '{"player":null}', '{"player":{"endScenes":"end_a"}}', '{"player":{"endScenes":[42]}}'])('配置不可安全读取时不把它当作无引用：%s', async (config) => {
    state.scenes.set('end_a', scene('end_a', 'end_a.gal', null));
    state.gameConfigText = config;
    expect(() => openRenameSceneDialog('end_a')).toThrow(/game.config.json/);
    await expect(renameSceneAtKey('end_a', 'final_a')).rejects.toThrow(/game.config.json/);
    await expect(deleteSceneAtKey('end_a')).rejects.toThrow(/game.config.json/);
    expect(state.scenes.has('end_a')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each(['{}', '{"player":{}}', '{"player":{"endScenes":[]}}', '{"player":{"endScenes":["other"]}}'])('无关结束配置不妨碍正常改名，原隐式入口固定为新 ID：%s', async (config) => {
    state.gameConfigText = config;
    state.scenes.set('old', scene('old', 'old.gal', null));
    state.scenes.set('reader', { ...scene('reader', 'reader.gal', null), text: '@scene reader\n@jump old\n' });
    await renameSceneAtKey('old', 'new');
    expect(state.scenes.has('new')).toBe(true);
    expect(state.scenes.get('reader')?.text).toContain('@jump new');
    expect(JSON.parse(state.gameConfigText)).toEqual({ ...JSON.parse(config), entryScene: 'new' });
  });

  it('拒绝重复 ID 重命名与仅大小写改名', async () => {
    state.scenes.set('chapter-a/shared', scene('shared', 'chapter-a/shared.gal', diskHandle));
    state.scenes.set('chapter-b/shared', scene('shared', 'chapter-b/shared.gal', diskHandle));

    expect(() => openRenameSceneDialog('chapter-a/shared')).toThrow('对应多个文件');
    await expect(renameSceneAtKey('chapter-a/shared', 'other')).rejects.toThrow('对应多个文件');
    expect(state.scenes.has('chapter-a/shared')).toBe(true);

    state.scenes.delete('chapter-b/shared');
    await expect(renameSceneAtKey('chapter-a/shared', 'SHARED')).rejects.toThrow('不能只改变场景文件名的大小写');
    expect(state.scenes.has('chapter-a/shared')).toBe(true);
    expect(state.pendingSceneDeletes).toEqual([]);
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
    state.pendingSceneDeletes = [{ kind: 'delete', id: 'old', file: 'old.gal' }];

    await expect(createScene('old')).rejects.toThrow('请先保存全部');

    expect(state.scenes.size).toBe(0);
  });

  it('同一未保存批次中的多个新场景共享稳定请求身份', async () => {
    await createScene('first');
    await createScene('second');

    const first = state.scenes.get('first')?.pendingCreateOperationId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.scenes.get('second')?.pendingCreateOperationId).toBe(first);
  });
});
