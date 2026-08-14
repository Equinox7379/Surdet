import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  beginChange,
  type ChangeSession,
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
