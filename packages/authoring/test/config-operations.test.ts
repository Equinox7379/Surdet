import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  beginChange,
  commitChange,
  recordValidation,
  buildObjectIndex,
  loadProjectSnapshot,
  validateSnapshot,
  type ChangeSession,
  type ProjectWriteStorage,
  type TextHasher,
} from '../src/index.js';
import {
  applyCharacterEnsure,
  applyCharacterRemove,
  applyEntrySceneSet,
  charactersFingerprint,
  entrySceneFingerprint,
  type CharacterEnsureInput,
  type CharacterRemoveInput,
  type EntrySceneSetInput,
} from '../src/config-operations.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';
import { InMemoryChangeRepository } from '../src/change-session.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const baseConfig = JSON.stringify({
  title: 'Starter',
  version: '0.1.0',
  entryScene: 'ch01_01',
  characters: { lynn: { name: '凛', avatar: 'lynn' } },
  variables: {},
});

function snapshot(): ProjectSnapshot {
  return {
    rootIdentity: 'fixture-root',
    revision: 'rev000000',
    files: [],
    configFile: null,
    config: {},
    variables: {},
    scenes: [],
    timelines: [],
  };
}

async function open(): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const repo = new InMemoryChangeRepository();
  const change = await beginChange(snapshot(), repo);
  change.record.workingFiles['game.config.json'] = baseConfig;
  return { change, repo };
}

describe('character.ensure', () => {
  it('creates a new character through the isolated transaction', async () => {
    const { change } = await open();
    // 当前角色表已含 lynn：新建 nova 必须携带当前表指纹。
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    const result = await applyCharacterEnsure(change, {
      operationId: 'op-nova',
      id: 'nova',
      name: '诺瓦',
      avatar: 'lynn',
      expectedFingerprint: current,
    }, hasher);
    expect(result.objectRef).toBe('character:nova');
    expect(result.created).toBe(true);
    const parsed = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, unknown> };
    expect(parsed.characters['nova']).toEqual({ name: '诺瓦', avatar: 'lynn' });
    expect(change.record.workingRevision).toBe(1);
    expect(result.diffEntry.kind).toBe('config.character.ensure');
    expect(result.diffEntry.objectAfter).toBe('character:nova');
  });

  it('overrides an existing character only with a matching fingerprint', async () => {
    const { change } = await open();
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    const result = await applyCharacterEnsure(change, {
      operationId: 'op-rename',
      id: 'lynn',
      name: '凛·改',
      expectedFingerprint: current,
    }, hasher);
    expect(result.created).toBeUndefined();
    const parsed = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string; avatar?: string }> };
    expect(parsed.characters['lynn']!.name).toBe('凛·改');
    // avatar 未提供时保留原值。
    expect(parsed.characters['lynn']!.avatar).toBe('lynn');
  });

  it('rejects a stale fingerprint without any partial write', async () => {
    const { change } = await open();
    const before = JSON.stringify(change.record.workingFiles);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-stale',
      id: 'nova',
      name: '诺瓦',
      expectedFingerprint: 'deadbeef',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
  });

  it('rejects invalid character ids', async () => {
    const { change } = await open();
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-bad-id',
      id: '-bad',
      name: '非法',
      expectedFingerprint: current,
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-bad-id2',
      id: 'has space',
      name: '非法',
      expectedFingerprint: current,
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-bad-id3',
      id: 'bad id',
      name: '非法',
      expectedFingerprint: current,
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('creates from an empty characters table with the empty-object fingerprint', async () => {
    const repo = new InMemoryChangeRepository();
    const change = await beginChange(snapshot(), repo);
    change.record.workingFiles['game.config.json'] = JSON.stringify({ title: 'Empty' });
    const empty = await charactersFingerprint({}, hasher);
    const result = await applyCharacterEnsure(change, {
      operationId: 'op-first',
      id: 'nova',
      name: '诺瓦',
      expectedFingerprint: empty,
    }, hasher);
    expect(result.created).toBe(true);
    expect(change.record.workingRevision).toBe(1);
  });

  it('rejects structurally broken characters tables', async () => {
    const repo = new InMemoryChangeRepository();
    const change = await beginChange(snapshot(), repo);
    change.record.workingFiles['game.config.json'] = JSON.stringify({ characters: [] });
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-broken',
      id: 'nova',
      name: '诺瓦',
      expectedFingerprint: 'x',
    }, hasher)).rejects.toMatchObject({ code: 'PROJECT_INVALID' });
  });
});

describe('character.remove', () => {
  it('removes a character with a matching fingerprint', async () => {
    const { change } = await open();
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    const result = await applyCharacterRemove(change, {
      operationId: 'op-remove',
      id: 'lynn',
      expectedFingerprint: current,
    }, hasher);
    expect(result.removed).toBe(true);
    expect(result.objectRef).toBe('character:lynn');
    const parsed = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, unknown> };
    expect(parsed.characters['lynn']).toBeUndefined();
    expect(result.diffEntry.kind).toBe('config.character.remove');
    expect(result.diffEntry.objectBefore).toBe('character:lynn');
  });

  it('rejects a missing character with OBJECT_NOT_FOUND', async () => {
    const { change } = await open();
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    await expect(applyCharacterRemove(change, {
      operationId: 'op-missing',
      id: 'nobody',
      expectedFingerprint: current,
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });
});

describe('entry-scene.set', () => {
  it('sets entryScene to an existing scene with a matching fingerprint', async () => {
    const { change } = await open();
    change.record.workingFiles['content/scenario/prologue.gal'] = '@scene prologue\n@end';
    const current = await entrySceneFingerprint({ entryScene: 'ch01_01' }, hasher);
    const result = await applyEntrySceneSet(change, {
      operationId: 'op-entry',
      sceneId: 'prologue',
      expectedFingerprint: current,
    }, hasher);
    expect(result.entryScene).toBe('prologue');
    const parsed = JSON.parse(change.record.workingFiles['game.config.json']!) as { entryScene: string };
    expect(parsed.entryScene).toBe('prologue');
    expect(result.diffEntry.kind).toBe('config.entry-scene.set');
  });

  it('rejects a scene that does not exist in the working files', async () => {
    const { change } = await open();
    const current = await entrySceneFingerprint({ entryScene: 'ch01_01' }, hasher);
    await expect(applyEntrySceneSet(change, {
      operationId: 'op-missing-scene',
      sceneId: 'ghost',
      expectedFingerprint: current,
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a stale entryScene fingerprint', async () => {
    const { change } = await open();
    await expect(applyEntrySceneSet(change, {
      operationId: 'op-stale-entry',
      sceneId: 'prologue',
      expectedFingerprint: 'stale',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
  });

  it('supports the missing entryScene empty fingerprint', async () => {
    const repo = new InMemoryChangeRepository();
    const change = await beginChange(snapshot(), repo);
    change.record.workingFiles['game.config.json'] = JSON.stringify({ title: 'No entry' });
    change.record.workingFiles['content/scenario/start.gal'] = '@scene start\n@end';
    const missing = await entrySceneFingerprint({}, hasher);
    const result = await applyEntrySceneSet(change, {
      operationId: 'op-first-entry',
      sceneId: 'start',
      expectedFingerprint: missing,
    }, hasher);
    expect(result.entryScene).toBe('start');
  });
});

/* ============ Wave 3 closure blocker：display-name 改名的 speaker 引用完整性 ============ */

const SCENE_1 = [
  '@scene s1',
  '诺瓦：登场台词。',
  '凛：诺瓦今天没有来。', // 普通对白正文里的“诺瓦”不得被替换
  '诺瓦：  带缩进台词。', // speaker 后 value 前空格保持
  '@end',
].join('\n');

const SCENE_2 = [
  '@scene s2',
  '诺瓦：另一场景台词。',
  '凛：诺瓦是主角。',
  '@end',
].join('\n');

const SCENE_UNRELATED = [
  '@scene s3',
  '凛：你好。',
  '诺瓦今天没有来。', // 无 speaker 的普通文本行
  '@end',
].join('\n');

function renameFixture(): Record<string, string> {
  return {
    'game.config.json': JSON.stringify({
      title: 'Rename',
      entryScene: 's1',
      characters: { nova: { name: '诺瓦', avatar: 'nova' }, lynn: { name: '凛', avatar: 'lynn' } },
      variables: {},
    }),
    'content/scenario/s1.gal': SCENE_1,
    'content/scenario/s2.gal': SCENE_2,
    'content/scenario/s3.gal': SCENE_UNRELATED,
  };
}

async function openWithFiles(files: Record<string, string>): Promise<ChangeSession> {
  const repo = new InMemoryChangeRepository();
  const snap = snapshot();
  snap.files = Object.entries(files).map(([path, text]) => ({ path, text, bytes: text.length, sha256: digest(text) }));
  const change = await beginChange(snap, repo);
  return change;
}

async function currentTableFingerprint(change: ChangeSession): Promise<string> {
  const config = JSON.parse(change.record.workingFiles['game.config.json']!) as Record<string, unknown>;
  return charactersFingerprint(config, hasher);
}

const stagedText = new Map<string, string>();

function workingStorage(files: Record<string, string>): ProjectWriteStorage {
  return {
    rootIdentity: 'fixture-root',
    listFiles: async () => Object.keys(files).sort(),
    readText: async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`missing: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path: string) => path in files,
    stageText: async (path: string, text: string) => {
      stagedText.set(`stage:${path}`, text);
      return { stagedIdentity: `stage:${path}`, sha256: await hasher.sha256(text) };
    },
    replaceFromStage: async (path: string) => {
      const staged = stagedText.get(`stage:${path}`);
      if (staged === undefined) throw new Error(`no stage: ${path}`);
      files[path] = staged;
    },
    restoreText: async (path: string, text: string) => { files[path] = text; },
    removeStage: async (path: string) => { stagedText.delete(path); },
  };
}

describe('character.ensure display-name rename reference integrity', () => {
  it('migrates speaker tokens across scenes and leaves ordinary text untouched', async () => {
    const change = await openWithFiles(renameFixture());
    const fp = await currentTableFingerprint(change);
    const result = await applyCharacterEnsure(change, {
      operationId: 'op-rename-nova',
      id: 'nova',
      name: '诺瓦测试',
      expectedFingerprint: fp,
    }, hasher);

    // 1. config name 更新
    const config = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string; avatar?: string }> };
    expect(config.characters['nova']!.name).toBe('诺瓦测试');
    expect(config.characters['nova']!.avatar).toBe('nova');
    expect(config.characters['lynn']!.name).toBe('凛');
    // 8. character ID 仍为 nova
    expect(Object.keys(config.characters).sort()).toEqual(['lynn', 'nova']);

    // 2/3. 两个场景的 speaker token 迁移；正文中的“诺瓦”不动；value 前空格保持
    const s1 = change.record.workingFiles['content/scenario/s1.gal']!;
    expect(s1).toContain('诺瓦测试：登场台词。');
    expect(s1).toContain('诺瓦测试：  带缩进台词。');
    expect(s1).toContain('凛：诺瓦今天没有来。');
    expect(s1).not.toContain('诺瓦：登场台词。');
    const s2 = change.record.workingFiles['content/scenario/s2.gal']!;
    expect(s2).toContain('诺瓦测试：另一场景台词。');
    expect(s2).toContain('凛：诺瓦是主角。');
    // 4. 无关场景不修改
    expect(change.record.workingFiles['content/scenario/s3.gal']).toBe(SCENE_UNRELATED);

    // L. potentialImpact 精确列出迁移引用（3 个 speaker token）
    const impacts = result.diffEntry.potentialImpact as Array<{ path: string; line: number; from: string; to: string }>;
    expect(impacts).toHaveLength(3);
    expect(impacts.map((impact) => `${impact.path}:${impact.line}`).sort()).toEqual([
      'content/scenario/s1.gal:2',
      'content/scenario/s1.gal:4',
      'content/scenario/s2.gal:2',
    ]);
    for (const impact of impacts) {
      expect(impact.from).toBe('诺瓦');
      expect(impact.to).toBe('诺瓦测试');
    }
  });

  it('keeps validation green and causal edges after reload', async () => {
    const change = await openWithFiles(renameFixture());
    const fp = await currentTableFingerprint(change);
    await applyCharacterEnsure(change, {
      operationId: 'op-rename-reload',
      id: 'nova',
      name: '诺瓦测试',
      expectedFingerprint: fp,
    }, hasher);

    // J. reload 后 SPEAKER_UNRESOLVED 不出现
    const files = change.record.workingFiles;
    const reloaded = await loadProjectSnapshot({
      rootIdentity: 'reload-root',
      listFiles: async () => Object.keys(files),
      readText: async (path: string) => ({ path, text: files[path]!, bytes: files[path]!.length, sha256: await hasher.sha256(files[path]!) }),
      exists: async (path: string) => path in files,
    }, hasher);
    const validation = validateSnapshot(reloaded);
    const speakerIssues = validation.issues.filter((issue) => issue.code === 'SPEAKER_UNRESOLVED');
    expect(speakerIssues).toHaveLength(0);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);

    // K. object-index speaker -> character 边保留
    const index = buildObjectIndex(reloaded);
    const migratedTexts = index.objects.filter((object) => object.kind === 'text' && object.source?.raw.includes('诺瓦测试：'));
    expect(migratedTexts.length).toBeGreaterThanOrEqual(3);
    for (const text of migratedTexts) {
      expect(text.references).toContain('character:nova');
    }
    expect(index.byRef.get('character:nova')!.referencedBy.length).toBeGreaterThanOrEqual(3);
  });

  it('fails loud on new-name collision with another display name (zero writes)', async () => {
    const change = await openWithFiles(renameFixture());
    const before = JSON.stringify(change.record.workingFiles);
    const fp = await currentTableFingerprint(change);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-collide-name',
      id: 'nova',
      name: '凛',
      expectedFingerprint: fp,
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
  });

  it('fails loud on new-name collision with another character ID (zero writes)', async () => {
    const change = await openWithFiles(renameFixture());
    const before = JSON.stringify(change.record.workingFiles);
    const fp = await currentTableFingerprint(change);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-collide-id',
      id: 'nova',
      name: 'lynn',
      expectedFingerprint: fp,
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
  });

  it('fails loud when the old display name is ambiguous and referenced', async () => {
    const files = renameFixture();
    const config = JSON.parse(files['game.config.json']!) as { characters: Record<string, { name: string; avatar?: string }> };
    config.characters['nova2'] = { name: '诺瓦' }; // 与 nova 同名：speaker“诺瓦”无法证明归属
    files['game.config.json'] = JSON.stringify(config);
    const change = await openWithFiles(files);
    const before = JSON.stringify(change.record.workingFiles);
    const fp = await currentTableFingerprint(change);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-ambiguous-old',
      id: 'nova',
      name: '诺瓦测试',
      expectedFingerprint: fp,
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
  });

  it('rejects a stale fingerprint before touching scenes (zero writes)', async () => {
    const change = await openWithFiles(renameFixture());
    const before = JSON.stringify(change.record.workingFiles);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-stale-rename',
      id: 'nova',
      name: '诺瓦测试',
      expectedFingerprint: 'stale-fingerprint',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
  });

  it('keeps config and scenes atomic when any file replace fails at commit', async () => {
    const files = renameFixture();
    const change = await openWithFiles(renameFixture());
    const fp = await currentTableFingerprint(change);
    await applyCharacterEnsure(change, {
      operationId: 'op-atomic',
      id: 'nova',
      name: '诺瓦测试',
      expectedFingerprint: fp,
    }, hasher);
    await recordValidation(change, { evidenceId: 'ev-atomic', errors: 0 });

    const disk = { ...files };
    const storage = workingStorage(disk);
    const failing: ProjectWriteStorage = {
      ...storage,
      replaceFromStage: async (path: string, stagedIdentity: string) => {
        if (path === 'content/scenario/s2.gal') throw new Error('disk write failed');
        await storage.replaceFromStage(path, stagedIdentity);
      },
    };
    await expect(commitChange(change, failing)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
    // 全量回滚：config 与全部场景保持原文（半提交世界不存在）
    expect(disk['game.config.json']).toBe(files['game.config.json']);
    expect(disk['content/scenario/s1.gal']).toBe(SCENE_1);
    expect(disk['content/scenario/s2.gal']).toBe(SCENE_2);
    expect(disk['content/scenario/s3.gal']).toBe(SCENE_UNRELATED);
  });

  it('avatar update persists and avatar null clears on existing characters', async () => {
    const change = await openWithFiles(renameFixture());
    const fp = await currentTableFingerprint(change);
    const updated = await applyCharacterEnsure(change, {
      operationId: 'op-avatar-update',
      id: 'nova',
      name: '诺瓦',
      avatar: 'nova2',
      expectedFingerprint: fp,
    }, hasher);
    let config = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string; avatar?: string }> };
    expect(config.characters['nova']!.avatar).toBe('nova2');
    expect(updated.diffEntry.kind).toBe('config.character.ensure');

    const fp2 = await currentTableFingerprint(change);
    await applyCharacterEnsure(change, {
      operationId: 'op-avatar-clear',
      id: 'nova',
      name: '诺瓦',
      avatar: null,
      expectedFingerprint: fp2,
    }, hasher);
    config = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string; avatar?: string }> };
    expect(config.characters['nova']!.avatar).toBeUndefined();
    expect('avatar' in config.characters['nova']!).toBe(false);
    // avatar-only 变更不触发 speaker 迁移（name 未变）
    expect(change.record.workingFiles['content/scenario/s1.gal']).toBe(SCENE_1);
  });
});
