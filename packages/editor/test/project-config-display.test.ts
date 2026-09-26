import { describe, expect, it, afterEach } from 'vitest';
import {
  AuthoringOperationError,
  buildAssetCatalog,
  buildObjectIndex,
  loadProjectSnapshot,
} from '@surdet/authoring';
import {
  commitCharacterTable,
  createEditorProjectStorage,
  type CharacterTableEditRow,
} from '../src/authoring-project-storage.js';
import { recordAssetPath } from '../src/project-io.js';
import { describeAuthoringReference } from '../src/causal-selection.js';
import { state } from '../src/state.js';

const originalDirAssets = state.dirAssets;

afterEach(() => {
  state.dirAssets = originalDirAssets;
});

describe('project config display', () => {
  it('resolves avatar catalog entries identically to the CLI contract', () => {
    const catalog = buildAssetCatalog(['content/assets/avatar/lynn.svg', 'content/assets/avatar/nova.svg']);
    expect(catalog.avatars.map((entry) => entry.key)).toEqual(['lynn', 'nova']);
    expect(catalog.avatars[0]).toEqual({
      kind: 'avatar', key: 'lynn', sourcePath: 'content/assets/avatar/lynn.svg', format: 'svg', resolved: true,
    });
  });

  it('enumerates avatar paths from the editor directory scan without reading binaries', async () => {
    state.dirName = 'config-project';
    state.gameConfigText = JSON.stringify({ title: 'Starter', entryScene: 'ch01_01', characters: { lynn: { name: '凛', avatar: 'lynn' } }, variables: {} });
    state.scenes = new Map([['ch01_01', {
      id: 'ch01_01', file: 'ch01_01.gal', text: '@scene ch01_01\n凛：你好。\n@end\n', eol: '\n', dirty: false, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    const avatarHandle = { kind: 'file', name: 'lynn.svg' } as unknown as FileSystemFileHandle;
    recordAssetPath(avatarHandle, 'content/assets/avatar/lynn.svg');
    state.dirAssets = [{ key: 'lynn', kind: 'avatar', handle: avatarHandle, isImage: true }];
    const storage = createEditorProjectStorage();
    expect(await storage.listFiles()).toContain('content/assets/avatar/lynn.svg');
    const snapshot = await loadProjectSnapshot(storage, storage);
    expect(snapshot.files.map((file) => file.path)).not.toContain('content/assets/avatar/lynn.svg');
  });

  it('indexes speaker->character edges and describes them readably', async () => {
    const contents: Record<string, string> = {
      'game.config.json': JSON.stringify({
        title: 'Starter', entryScene: 'ch01_01',
        characters: { lynn: { name: '凛', avatar: 'lynn' }, nova: { name: '诺瓦' } },
        variables: {},
      }),
      'content/scenario/ch01_01.gal': ['@scene ch01_01', '凛：你好。', '诺瓦：登场。', '@end'].join('\n'),
    };
    const hasher = { sha256: async (text: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    } };
    const snapshot = await loadProjectSnapshot({
      rootIdentity: 'display-fixture',
      listFiles: async () => Object.keys(contents),
      readText: async (path: string) => {
        const text = contents[path];
        if (text === undefined) throw new Error('missing: ' + path);
        return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
      },
      exists: async (path: string) => path in contents,
    }, hasher);
    const index = buildObjectIndex(snapshot);
    const novaText = index.objects.find((object) => object.kind === 'text' && object.source?.raw.includes('诺瓦：登场'));
    expect(novaText?.references).toEqual(['character:nova']);
    expect(index.byRef.get('character:lynn')?.references).toEqual(['asset:avatar:lynn']);
    expect(describeAuthoringReference('character:nova')).toBe('角色 nova');
    expect(describeAuthoringReference('asset:avatar:lynn')).toBe('头像 lynn');
    expect(describeAuthoringReference('config:entryScene')).toBe('入口场景');
    expect(index.byRef.get('config:entryScene')?.references).toEqual(['scene:ch01_01']);
  });
});

/* ================= Wave 3 closure：角色表经共享 character.ensure 语义写盘 ================= */

/** 内存版文件句柄：读返回当前内容，写记录日志并更新内容（模拟真实磁盘）。 */
function memoryFileHandle(name: string, initial: string): {
  handle: FileSystemFileHandle;
  read: () => string;
  writes: string[];
} {
  let content = initial;
  const writes: string[] = [];
  const handle = {
    kind: 'file',
    name,
    getFile: async () => new File([content], name),
    createWritable: async () => ({
      write: async (data: unknown) => {
        const text = String(data);
        writes.push(text);
        content = text;
      },
      close: async () => {},
    }),
  } as unknown as FileSystemFileHandle;
  return { handle, read: () => content, writes };
}

const CHARACTER_FIXTURE_CONFIG = {
  title: 'Starter',
  entryScene: 'ch01_01',
  characters: {
    lynn: { name: '凛', avatar: 'lynn' },
    nova: { name: '诺瓦', avatar: 'lynn' },
  },
  variables: {},
};

function characterFixtureText(): string {
  return `${JSON.stringify(CHARACTER_FIXTURE_CONFIG, null, 2)}\n`;
}

/** 场景含 2 处 诺瓦 speaker 与 1 处正文“诺瓦”（不得被替换）。 */
const CHARACTER_FIXTURE_SCENE = '@scene ch01_01\n凛：你好。\n诺瓦：登场台词。\n凛：诺瓦今天没有来。\n@end\n';

describe('character table editing through shared authoring semantics', () => {
  const saved = {
    gameConfigText: state.gameConfigText,
    scenes: state.scenes,
    timelines: state.timelines,
    configFiles: state.configFiles,
    handles: state.handles,
    dirName: state.dirName,
    dirHandle: state.dirHandle,
  };

  afterEach(() => {
    state.gameConfigText = saved.gameConfigText;
    state.scenes = saved.scenes;
    state.timelines = saved.timelines;
    state.configFiles = saved.configFiles;
    state.handles = saved.handles;
    state.dirName = saved.dirName;
    state.dirHandle = saved.dirHandle;
  });

  function installFixture(diskText: string): {
    configDisk: ReturnType<typeof memoryFileHandle>;
    sceneDisk: ReturnType<typeof memoryFileHandle>;
  } {
    const configDisk = memoryFileHandle('game.config.json', diskText);
    const sceneDisk = memoryFileHandle('ch01_01.gal', CHARACTER_FIXTURE_SCENE);
    state.dirName = 'character-edit-project';
    state.dirHandle = {} as FileSystemDirectoryHandle;
    state.gameConfigText = diskText;
    state.scenes = new Map([['ch01_01', {
      id: 'ch01_01', file: 'ch01_01.gal', text: CHARACTER_FIXTURE_SCENE, eol: '\n', dirty: false, handle: sceneDisk.handle,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    state.handles = { gameConfig: configDisk.handle, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null };
    return { configDisk, sceneDisk };
  }

  it('creates the first explicitly requested character, with no implied recreation of missing old rows', async () => {
    const empty = JSON.stringify({ ...CHARACTER_FIXTURE_CONFIG, characters: {} });
    const { configDisk, sceneDisk } = installFixture(empty);
    const source = sceneDisk.read();
    state.dirAssets = [];
    await expect(commitCharacterTable([{ id: 'rin', name: '凛', avatar: '' }])).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(configDisk.writes).toEqual([]);
    const result = await commitCharacterTable([{ id: 'rin', name: '凛', avatar: '', portraits: [], create: true }]);
    expect(result.changed).toBe(1);
    expect(JSON.parse(configDisk.read()).characters).toEqual({ rin: { name: '凛' } });
    expect(sceneDisk.read()).toBe(source);
    expect((await commitCharacterTable([{ id: 'rin', name: '凛', avatar: '', portraits: [] }])).changed).toBe(0);
    configDisk.writes.length = 0;
    await expect(commitCharacterTable([{ id: 'rin', name: '别人', avatar: '', create: true }])).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(configDisk.writes).toEqual([]);
  });

  it('rejects duplicate creation rows without partially publishing either declaration', async () => {
    const { configDisk } = installFixture(JSON.stringify({ ...CHARACTER_FIXTURE_CONFIG, characters: {} }));
    const row: CharacterTableEditRow = { id: 'rin', name: '凛', avatar: '', create: true };
    await expect(commitCharacterTable([row, row])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(configDisk.writes).toEqual([]);
  });

  it('preserves scene typing that arrives while the character transaction is writing', async () => {
    const { configDisk, sceneDisk } = installFixture(characterFixtureText());
    const createWritable = configDisk.handle.createWritable.bind(configDisk.handle);
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    let resume!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    configDisk.handle.createWritable = async (...args) => {
      const writable = await createWritable(...args);
      const write = writable.write.bind(writable);
      writable.write = async data => { started(); await paused; await write(data); };
      return writable;
    };
    const committed = commitCharacterTable([{ id: 'lynn', name: '凛', avatar: 'lynn' }, { id: 'nova', name: '诺瓦测试', avatar: 'lynn' }]);
    await writing;
    state.scenes.get('ch01_01')!.text += '\n保存期间继续输入。\n';
    state.scenes.get('ch01_01')!.dirty = true;
    resume();
    await committed;
    expect(state.scenes.get('ch01_01')!.text).toContain('保存期间继续输入');
    expect(state.scenes.get('ch01_01')!.dirty).toBe(true);
    expect(sceneDisk.read()).toContain('诺瓦测试：');
    expect(sceneDisk.read()).not.toContain('保存期间继续输入');
  });

  it('saves and clears portrait rows through the shared operation, preserving unknown declaration fields', async () => {
    const configured = { ...CHARACTER_FIXTURE_CONFIG, characters: { ...CHARACTER_FIXTURE_CONFIG.characters,
      lynn: { ...CHARACTER_FIXTURE_CONFIG.characters.lynn, custom: { keep: true } } } };
    const { configDisk } = installFixture(JSON.stringify(configured));
    const sourcePath = 'content/assets/portrait/art_coat_smile.svg';
    state.dirAssets = [{ key: 'art:coat', expr: 'smile', kind: 'portrait', isImage: true, handle: null, sourcePath }];
    const row: CharacterTableEditRow = { id: 'lynn', name: '凛', avatar: 'lynn', portraits: [{ outfit: 'uniform', expression: 'smile', sourcePath }] };
    expect((await commitCharacterTable([row])).changed).toBe(1);
    expect(JSON.parse(configDisk.read()).characters.lynn).toEqual({ ...configured.characters.lynn, portraits: { uniform: { smile: sourcePath } } });
    expect((await commitCharacterTable([row])).changed).toBe(0);
    expect((await commitCharacterTable([{ ...row, portraits: [] }])).changed).toBe(1);
    expect(JSON.parse(configDisk.read()).characters.lynn).toEqual(configured.characters.lynn);
  });

  it('rejects duplicate, incomplete and missing portrait rows without changing disk or editor configuration', async () => {
    const { configDisk } = installFixture(characterFixtureText());
    const before = state.gameConfigText;
    const sourcePath = 'content/assets/portrait/art_coat_smile.svg';
    state.dirAssets = [{ key: 'art:coat', expr: 'smile', kind: 'portrait', isImage: true, handle: null, sourcePath }];
    const mapping = { outfit: 'coat', expression: 'smile', sourcePath };
    for (const portraits of [[mapping, mapping], [{ ...mapping, expression: '' }], [{ ...mapping, sourcePath: 'content/assets/portrait/missing_coat_smile.svg' }]]) {
      await expect(commitCharacterTable([{ id: 'lynn', name: '凛', avatar: 'lynn', portraits }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(configDisk.writes).toEqual([]);
      expect(state.gameConfigText).toBe(before);
    }
  });

  it('edits display name via shared character.ensure and persists after reload', async () => {
    const { configDisk, sceneDisk } = installFixture(characterFixtureText());
    const rows: CharacterTableEditRow[] = [
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '诺瓦测试', avatar: 'lynn' },
    ];

    const result = await commitCharacterTable(rows);

    expect(result.changed).toBe(1);
    // 提交后语义状态：nova.name 更新；ID 集合与其它字段不变（C/D）
    const committed = JSON.parse(configDisk.read()) as typeof CHARACTER_FIXTURE_CONFIG;
    expect(committed.characters.nova?.name).toBe('诺瓦测试');
    expect(committed.characters.nova?.avatar).toBe('lynn');
    expect(committed.characters.lynn?.name).toBe('凛');
    expect(Object.keys(committed.characters)).toEqual(['lynn', 'nova']);
    expect(committed.title).toBe('Starter');
    expect(committed.entryScene).toBe('ch01_01');
    expect(committed.variables).toEqual({});
    // editor 内存态同步为提交后的文本
    expect(state.gameConfigText).toBe(configDisk.read());
    // 同一事务内场景 speaker 令牌迁移：诺瓦 speaker → 诺瓦测试；正文“诺瓦”不动
    expect(result.speakerMigrations).toHaveLength(1);
    expect(result.speakerMigrations[0]).toMatchObject({ path: 'content/scenario/ch01_01.gal', line: 3, from: '诺瓦', to: '诺瓦测试' });
    const migratedScene = sceneDisk.read();
    expect(migratedScene).toContain('诺瓦测试：登场台词。');
    expect(migratedScene).toContain('凛：诺瓦今天没有来。');
    expect(migratedScene).not.toContain('诺瓦：登场台词。');
    // editor 场景内存态同步
    expect(state.scenes.get('ch01_01')!.text).toBe(migratedScene);
    // round-trip：重新从磁盘加载共享快照，修改仍存在（E）
    const reloaded = await loadProjectSnapshot({
      rootIdentity: 'reload-fixture',
      listFiles: async () => ['game.config.json', 'content/scenario/ch01_01.gal'],
      readText: async (path: string) => {
        const text = path === 'game.config.json' ? configDisk.read() : sceneDisk.read();
        return { path, text, bytes: text.length, sha256: `reload:${path}` };
      },
      exists: async () => true,
    }, { sha256: async (text) => `sha:${text.length}` });
    expect((reloaded.config['characters'] as Record<string, { name?: string }>)['nova']?.name).toBe('诺瓦测试');
  });

  it('updates and clears avatar through the shared editor path', async () => {
    const { configDisk } = installFixture(characterFixtureText());
    const updated = await commitCharacterTable([
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '诺瓦', avatar: 'nova2' },
    ]);
    let config = JSON.parse(configDisk.read()) as typeof CHARACTER_FIXTURE_CONFIG;
    expect(updated.changed).toBe(1);
    expect(config.characters.nova?.avatar).toBe('nova2');

    // 重新从磁盘基线出发：avatar 空串 → 共享语义 null → 属性移除
    state.gameConfigText = configDisk.read();
    const cleared = await commitCharacterTable([
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '诺瓦', avatar: '' },
    ]);
    config = JSON.parse(configDisk.read()) as typeof CHARACTER_FIXTURE_CONFIG;
    expect(cleared.changed).toBe(1);
    expect(config.characters.nova && 'avatar' in config.characters.nova).toBe(false);
  });

  it('fails loud on display-name collision through the editor path with zero writes', async () => {
    const { configDisk, sceneDisk } = installFixture(characterFixtureText());
    configDisk.writes.length = 0;
    sceneDisk.writes.length = 0;

    await expect(commitCharacterTable([
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '凛', avatar: 'lynn' },
    ])).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });

    expect(configDisk.writes).toHaveLength(0);
    expect(sceneDisk.writes).toHaveLength(0);
    expect(state.gameConfigText).toBe(characterFixtureText());
  });

  it('fails loud when the disk baseline changed externally (no silent overwrite)', async () => {
    const { configDisk } = installFixture(characterFixtureText());
    // 外部 Agent 在编辑器同步之后改写磁盘（characters 表变化）
    const external = { ...CHARACTER_FIXTURE_CONFIG, characters: { ...CHARACTER_FIXTURE_CONFIG.characters, nova: { name: '外部诺瓦', avatar: 'lynn' } } };
    configDisk.writes.length = 0;
    const externalText = `${JSON.stringify(external, null, 2)}\n`;
    // 直接改写“磁盘”内容（不经 editor 写路径）
    void await (configDisk.handle as unknown as { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }).createWritable().then(async (w) => {
      await w.write(externalText);
      await w.close();
    });
    configDisk.writes.length = 0;

    const rows: CharacterTableEditRow[] = [
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '诺瓦测试', avatar: 'lynn' },
    ];

    await expect(commitCharacterTable(rows)).rejects.toMatchObject({
      code: expect.stringMatching(/^(OBJECT_REF_STALE|PROJECT_CHANGED_SINCE_BEGIN)$/),
    });
    // fail-loud：编辑器写路径未覆盖外部内容
    expect(configDisk.writes).toHaveLength(0);
    expect(JSON.parse(configDisk.read()).characters.nova?.name).toBe('外部诺瓦');
  });

  it('rejects invalid input through shared validation and keeps disk untouched', async () => {
    const { configDisk } = installFixture(characterFixtureText());
    const rows: CharacterTableEditRow[] = [
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '   ', avatar: 'lynn' },
    ];
    configDisk.writes.length = 0;

    await expect(commitCharacterTable(rows)).rejects.toBeInstanceOf(AuthoringOperationError);
    await expect(commitCharacterTable(rows)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(configDisk.writes).toHaveLength(0);
    expect(state.gameConfigText).toBe(characterFixtureText());
  });

  it('is a no-op write when nothing changed', async () => {
    const { configDisk } = installFixture(characterFixtureText());
    const rows: CharacterTableEditRow[] = [
      { id: 'lynn', name: '凛', avatar: 'lynn' },
      { id: 'nova', name: '诺瓦', avatar: 'lynn' },
    ];

    const result = await commitCharacterTable(rows);

    expect(result.changed).toBe(0);
    expect(result.speakerMigrations).toHaveLength(0);
    expect(configDisk.writes).toHaveLength(0);
  });
});
