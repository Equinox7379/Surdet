import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  beginChange,
  commitChange,
  recordValidation,
  buildObjectIndex,
  buildAssetCatalog,
  loadProjectSnapshot,
  validateSnapshot,
  type ChangeSession,
  type ProjectWriteStorage,
  type TextHasher,
  applyThemeConfigPatch,
  inspectThemeConfig,
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

describe('theme configuration validation', () => {
  it('reads defaults, validates assets, resets fields and preserves unrelated config', async () => {
    const { change } = await open();
    change.record.composition = { ...change.record.composition!, mode: 'direct' };
    const initial = await inspectThemeConfig(JSON.parse(baseConfig), hasher);
    expect(initial.effective.tokens.colors?.accent).toBe(0x203e88);
    expect(initial.sources['colors.accent']).toBe('default');
    const input = { operationId: 'theme', expectedFingerprint: initial.fingerprint, patch: { colors: { accent: 123 }, dialogSkin: 'paper', titleLogo: 'logo' } };
    const before = structuredClone(change.record);
    await expect(applyThemeConfigPatch(change, input, hasher, buildAssetCatalog([]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(change.record).toEqual(before);
    const assets = buildAssetCatalog(['content/assets/bg/paper.png', 'content/assets/bg/logo.png']);
    const result = await applyThemeConfigPatch(change, input, hasher, assets);
    expect(result.themeConfig.sources['colors.accent']).toBe('project');
    expect(JSON.parse(change.record.workingFiles['game.config.json']!).characters).toEqual(JSON.parse(baseConfig).characters);
    await expect(applyThemeConfigPatch(change, { ...input, operationId: 'stale' }, hasher, assets)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    const cleared = await applyThemeConfigPatch(change, { operationId: 'clear', expectedFingerprint: result.themeConfig.fingerprint, patch: null }, hasher, assets);
    expect(cleared.themeConfig.value).toBeNull();
    expect(cleared.themeConfig.titleLogo).toBe('logo');
  });

  it('rejects candidate theme mutations without altering business records', async () => {
    const { change } = await open();
    change.record.composition = { ...change.record.composition!, mode: 'candidate' };
    const before = structuredClone(change.record);
    await expect(applyThemeConfigPatch(change, { operationId: 'theme', expectedFingerprint: '', patch: { dialogSkin: '' } }, hasher, buildAssetCatalog([]))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(before);
  });

  it.each([{ opacity: { panel: 2 } }, { colors: { invented: 123 } }, { typography: { bodySize: -2 } }])('rejects invalid runtime tokens without changing the draft: %j', async patch => {
    const { change } = await open();
    change.record.composition = { ...change.record.composition!, mode: 'direct' };
    const before = structuredClone(change.record);
    const current = await inspectThemeConfig(JSON.parse(baseConfig), hasher);
    await expect(applyThemeConfigPatch(change, { operationId: 'bad-theme', expectedFingerprint: current.fingerprint, patch }, hasher, buildAssetCatalog([]))).rejects.toBeDefined();
    expect(change.record).toEqual(before);
  });
});

describe('character.ensure', () => {
  it('writes visual definitions with all image dependencies and rejects missing parts/candidate mutation atomically', async () => {
    const { change } = await open();
    change.record.composition = { ...change.record.composition!, mode: 'direct' };
    const a = 'content/assets/portrait/lynn_parts_a.png', b = 'content/assets/portrait/lynn_parts_b.png';
    const visuals = { uniform: { talk: { version: 1 as const, kind: 'sequence' as const, loop: true, frames: [{ image: a, durationMs: 50 }, { image: b, durationMs: 100 }] } } };
    const input = { operationId: 'visuals', id: 'lynn', name: '凛', visuals, expectedFingerprint: await charactersFingerprint(JSON.parse(baseConfig), hasher) };
    const before = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, input, hasher, undefined, buildAssetCatalog([a]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(change.record).toEqual(before);
    const result = await applyCharacterEnsure(change, input, hasher, undefined, buildAssetCatalog([a, b]));
    const config = JSON.parse(change.record.workingFiles['game.config.json']!);
    expect(config.characters.lynn).toMatchObject({ name: '凛', avatar: 'lynn', visuals });
    const snapshotWithConfig = { ...snapshot(), config };
    const complete = buildAssetCatalog([a, b], snapshotWithConfig);
    const visual = complete.portraits.find(item => item.expression === 'talk')!;
    expect(visual).toMatchObject({ resolved: true, sourcePaths: [a, b], visual: visuals.uniform.talk });
    const partial = buildAssetCatalog([a], snapshotWithConfig);
    expect(partial.portraits.find(item => item.expression === 'talk')?.resolved).toBe(false);
    expect(partial.intelligence.items.find(item => item.sourcePath === b)).toMatchObject({ physical: false, issues: ['ASSET_REFERENCE_MISSING'] });
    change.record.composition.mode = 'candidate';
    const candidateBefore = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, { ...input, operationId: 'candidate', visuals: null, expectedFingerprint: result.fingerprint }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(candidateBefore);
  });
  it('replaces only explicit portraits in direct mode, preserves unknown data and rejects stale/missing inputs atomically', async () => {
    const { change } = await open();
    change.record.composition = { ...change.record.composition!, mode: 'direct' };
    const config = JSON.parse(baseConfig);
    config.characters.lynn.custom = { keep: true };
    change.record.workingFiles['game.config.json'] = JSON.stringify(config);
    const image = 'content/assets/portrait/art_coat_smile.svg';
    const assets = buildAssetCatalog([image]);
    const input = { operationId: 'portraits', id: 'lynn', name: '凛', portraits: { 制服: { 微笑: image } }, expectedFingerprint: await charactersFingerprint(config, hasher) };
    const result = await applyCharacterEnsure(change, input, hasher, undefined, assets);
    expect(JSON.parse(change.record.workingFiles['game.config.json']!).characters.lynn).toEqual({ name: '凛', avatar: 'lynn', custom: { keep: true }, portraits: input.portraits });
    const before = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, { ...input, operationId: 'stale' }, hasher, undefined, assets)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await expect(applyCharacterEnsure(change, { ...input, operationId: 'missing', expectedFingerprint: result.fingerprint, portraits: { a: { b: 'content/assets/portrait/no_a_b.png' } } }, hasher, undefined, assets)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(change.record).toEqual(before);
    await applyCharacterEnsure(change, { ...input, operationId: 'reset', expectedFingerprint: result.fingerprint, portraits: null }, hasher);
    expect(JSON.parse(change.record.workingFiles['game.config.json']!).characters.lynn).not.toHaveProperty('portraits');
  });

  it('rejects candidate portrait writes/removal before records change', async () => {
    const { change } = await open();
    change.record.composition = { ...change.record.composition!, mode: 'candidate' };
    const config = JSON.parse(baseConfig);
    config.characters.lynn.portraits = { normal: { normal: 'content/assets/portrait/lynn_uniform_normal.svg' } };
    change.record.workingFiles['game.config.json'] = JSON.stringify(config);
    const input = { operationId: 'forbidden', id: 'lynn', name: '凛', expectedFingerprint: await charactersFingerprint(config, hasher) };
    const before = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, { ...input, portraits: null }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    await expect(applyCharacterRemove(change, input, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(before);
  });
  it('rejects a new ID that would shadow an existing display-name speaker', async () => {
    const { change } = await open();
    const config = JSON.parse(change.record.workingFiles['game.config.json']!);
    config.characters.lynn.name = 'Alice';
    change.record.workingFiles['game.config.json'] = JSON.stringify(config);
    const before = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, { operationId: 'shadow', id: 'Alice', name: 'Bob',
      expectedFingerprint: await charactersFingerprint(config, hasher) }, hasher))
      .rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
    expect(change.record).toEqual(before);
  });

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

  it('treats a missing constructor character as new instead of inherited data', async () => {
    const { change } = await open();
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    const result = await applyCharacterEnsure(change, {
      operationId: 'op-constructor-character',
      id: 'constructor',
      name: '构造者',
      expectedFingerprint: current,
    }, hasher);
    expect(result.created).toBe(true);
    const parsed = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(parsed.characters, 'constructor')).toBe(true);
    expect(parsed.characters['constructor']).toEqual({ name: '构造者' });
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

  it('rejects a missing constructor character with OBJECT_NOT_FOUND', async () => {
    const { change } = await open();
    const current = await charactersFingerprint({ characters: { lynn: { name: '凛', avatar: 'lynn' } } }, hasher);
    await expect(applyCharacterRemove(change, {
      operationId: 'op-missing-constructor',
      id: 'constructor',
      expectedFingerprint: current,
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });
});

describe('entry-scene.set', () => {
  it.each(['content/scenario/prologue.gal', 'content/scenario/chapter/prologue.gal'])('sets entryScene to the unique scene at %s with a matching fingerprint', async (scenePath) => {
    const { change } = await open();
    change.record.workingFiles[scenePath] = '@scene prologue\n@end';
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

  it('rejects duplicate basenames without advancing the direct change', async () => {
    const { change, repo } = await open();
    change.record.workingFiles['content/scenario/a/prologue.gal'] = '@scene prologue\n@end';
    change.record.workingFiles['content/scenario/b/prologue.gal'] = '@scene prologue\n@end';
    const before = JSON.stringify(change.record);
    const persistedBefore = JSON.stringify(await repo.read(change.record.changeId));
    await expect(applyEntrySceneSet(change, {
      operationId: 'ambiguous-entry', sceneId: 'prologue',
      expectedFingerprint: await entrySceneFingerprint({ entryScene: 'ch01_01' }, hasher),
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
    expect(JSON.stringify(change.record)).toBe(before);
    expect(JSON.stringify(await repo.read(change.record.changeId))).toBe(persistedBefore);
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

/* ===== Wave 3 final closure：F1 speaker token 安全 + F2 padded 旧名 + F4 ID 同名 ===== */

/** 单场景 fixture：可自定义 nova.name 与场景内容。 */
function speakerFixture(options?: {
  novaName?: string;
  sceneText?: string;
  omitNovaSpeaker?: boolean;
}): Record<string, string> {
  const novaName = options?.novaName ?? '诺瓦';
  const sceneText = options?.omitNovaSpeaker === true
    ? '@scene s1\n凛：你好。\n@end\n'
    : (options?.sceneText ?? '@scene s1\n诺瓦：hello\n凛：你好。\n@end\n');
  return {
    'game.config.json': JSON.stringify({
      title: 'TokenSafety',
      entryScene: 's1',
      characters: { nova: { name: novaName }, lynn: { name: '凛' } },
      variables: {},
    }),
    'content/scenario/s1.gal': sceneText,
  };
}

async function renameNova(change: ChangeSession, name: string): Promise<unknown> {
  const fp = await currentTableFingerprint(change);
  return applyCharacterEnsure(change, {
    operationId: `op-token-${name.length}-${name.slice(0, 4)}`,
    id: 'nova',
    name,
    expectedFingerprint: fp,
  }, hasher);
}

describe('character.ensure speaker token safety (F1)', () => {
  it.each(['@foo', '//foo'])('rejects reserved DSL prefix %s without changing dialogue or the change record', async (name) => {
    const change = await openWithFiles(speakerFixture());
    const before = JSON.stringify(change.record);
    await expect(applyCharacterEnsure(change, {
      operationId: 'op-reserved-prefix', id: 'nova', name,
      expectedFingerprint: await currentTableFingerprint(change),
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record)).toBe(before);
  });

  it('F1-A: whitespace new name with existing refs fails loud with zero mutation', async () => {
    const change = await openWithFiles(speakerFixture());
    const before = JSON.stringify(change.record.workingFiles);
    await expect(renameNova(change, 'John Smith')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
    expect(Object.keys(change.record.operations)).toHaveLength(0);
  });

  it('F1-B: trailing whitespace new name with existing refs fails loud', async () => {
    const change = await openWithFiles(speakerFixture());
    const before = JSON.stringify(change.record.workingFiles);
    await expect(renameNova(change, '诺瓦测试 ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
  });

  it('F1-C: colon-containing new name with existing refs fails loud', async () => {
    const change = await openWithFiles(speakerFixture());
    const before = JSON.stringify(change.record.workingFiles);
    await expect(renameNova(change, '凛：里')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
  });

  it('F1-D: over-length new name (>24 chars) with existing refs fails loud', async () => {
    const change = await openWithFiles(speakerFixture());
    const before = JSON.stringify(change.record.workingFiles);
    await expect(renameNova(change, '诺'.repeat(25))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
  });

  it('F1-E: flexible display name allowed when no speaker references exist', async () => {
    const change = await openWithFiles(speakerFixture({ omitNovaSpeaker: true }));
    const result = (await renameNova(change, 'John Smith')) as { diffEntry: { potentialImpact: unknown[] }; speakerMigrations?: unknown[] };
    expect(result).toBeTruthy();
    const config = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string }> };
    expect(config.characters['nova']!.name).toBe('John Smith');
    expect(result.speakerMigrations ?? []).toHaveLength(0);
    expect(result.diffEntry.potentialImpact).toEqual([]);
    // 无引用场景不迁移
    expect(change.record.workingFiles['content/scenario/s1.gal']).toBe('@scene s1\n凛：你好。\n@end\n');
  });
});

describe('character.ensure padded legacy display name (F2)', () => {
  it('migrates refs resolved via the trimmed canonical token', async () => {
    const files = speakerFixture({ novaName: ' 诺瓦 ' });
    // 前置：object-index 语义确实能把 speaker“诺瓦”解析到 nova（trim 契约）
    const preSnapshot = await loadProjectSnapshot({
      rootIdentity: 'padded-root',
      listFiles: async () => Object.keys(files),
      readText: async (path: string) => ({ path, text: files[path]!, bytes: files[path]!.length, sha256: await hasher.sha256(files[path]!) }),
      exists: async (path: string) => path in files,
    }, hasher);
    const preIndex = buildObjectIndex(preSnapshot);
    const preText = preIndex.objects.find((object) => object.kind === 'text' && object.source?.raw.includes('诺瓦：hello'));
    expect(preText?.references).toEqual(['character:nova']);

    const change = await openWithFiles(files);
    const result = (await renameNova(change, '诺瓦测试')) as { speakerMigrations?: Array<{ path: string; line: number; from: string; to: string }> };
    const scene = change.record.workingFiles['content/scenario/s1.gal']!;
    expect(scene).toContain('诺瓦测试：hello');
    expect(scene).not.toContain('诺瓦：hello');
    expect(result.speakerMigrations ?? []).toEqual([{ path: 'content/scenario/s1.gal', line: 2, from: '诺瓦', to: '诺瓦测试' }]);

    // reload：无 SPEAKER_UNRESOLVED，因果边仍指向 nova
    const working = change.record.workingFiles;
    const reloaded = await loadProjectSnapshot({
      rootIdentity: 'padded-reload',
      listFiles: async () => Object.keys(working),
      readText: async (path: string) => ({ path, text: working[path]!, bytes: working[path]!.length, sha256: await hasher.sha256(working[path]!) }),
      exists: async (path: string) => path in working,
    }, hasher);
    const validation = validateSnapshot(reloaded);
    expect(validation.issues.filter((issue) => issue.code === 'SPEAKER_UNRESOLVED')).toHaveLength(0);
    const index = buildObjectIndex(reloaded);
    const migrated = index.objects.find((object) => object.kind === 'text' && object.source?.raw.includes('诺瓦测试：hello'));
    expect(migrated?.references).toEqual(['character:nova']);
  });
});

describe('character.ensure old name equals character id (F4 regression)', () => {
  it('keeps ID-path speaker tokens unmigrated when renaming away from name==id', async () => {
    const files = speakerFixture({ novaName: 'nova', sceneText: '@scene s1\nnova：hello\n凛：你好。\n@end\n' });
    const change = await openWithFiles(files);
    const result = (await renameNova(change, '诺瓦')) as { speakerMigrations?: unknown[] };
    const config = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string }> };
    expect(config.characters['nova']!.name).toBe('诺瓦');
    // nova 走角色 ID 解析路径，speaker token 保持 nova：不迁移
    expect(change.record.workingFiles['content/scenario/s1.gal']).toBe('@scene s1\nnova：hello\n凛：你好。\n@end\n');
    expect(result.speakerMigrations ?? []).toHaveLength(0);
  });
});

describe('character.ensure URL line not corrupted by speaker rename (N2)', () => {
  const URL_SCENE = '@scene s1\nhttps://example.com/story\n凛：你好。\n@end\n';

  function urlFixture(): Record<string, string> {
    return {
      'game.config.json': JSON.stringify({
        title: 'URL',
        entryScene: 's1',
        characters: { web: { name: 'https' }, lynn: { name: '凛', avatar: 'lynn' } },
        variables: {},
      }),
      'content/scenario/s1.gal': URL_SCENE,
    };
  }

  it('renaming a character whose display name equals a URL scheme leaves URL lines untouched', async () => {
    const change = await openWithFiles(urlFixture());
    const fp = await currentTableFingerprint(change);
    const result = await applyCharacterEnsure(change, {
      operationId: 'op-rename-https',
      id: 'web',
      name: '官网',
      expectedFingerprint: fp,
    }, hasher);

    // working scene 的 URL 行必须原样保留，绝不能变成 官网://example.com/story
    expect(change.record.workingFiles['content/scenario/s1.gal']).toBe(URL_SCENE);
    // URL 行不得被记录为 speaker migration
    const migrations = (result as { speakerMigrations?: Array<{ path: string; line: number; from: string; to: string }> }).speakerMigrations ?? [];
    expect(migrations).toHaveLength(0);
    expect(result.diffEntry.potentialImpact).toEqual([]);
    // config 改名本身成功
    const config = JSON.parse(change.record.workingFiles['game.config.json']!) as { characters: Record<string, { name: string }> };
    expect(config.characters['web']!.name).toBe('官网');
  });
});
