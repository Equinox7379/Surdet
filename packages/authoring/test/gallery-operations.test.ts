import { describe, expect, it } from 'vitest';
import {
  beginChange,
  loadProjectSnapshot,
  type ChangeSession,
  type ProjectFile,
  type ProjectSnapshot,
  type ProjectStorage,
  type TextHasher,
} from '../src/index.js';
import { InMemoryChangeRepository } from '../src/change-session.js';
import {
  applyGalleryCgCreate,
  applyGalleryCgPatch,
  applyGalleryPolicyPatch,
  applyGalleryTextMutation,
  applyGalleryEndingMutation,
  applyGalleryDossierMutation,
  inspectGallery,
  GALLERY_PATH,
  type GalleryTextPatchInput,
} from '../src/gallery-operations.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const baseGallery = JSON.stringify({
  title: '保留根字段',
  customRoot: { keep: true },
  cgs: [{ id: 'base', name: '旧 CG', src: 'base_bg', unknown: { keep: 'cg' } }],
  music: [{ id: 'rain', name: '雨声' }],
  texts: [{ id: 'memory', name: '回想', scene: 'start', label: 'memory' }],
}) + '\n';

function snapshot(galleryText = baseGallery): ProjectSnapshot {
  const gallery: ProjectFile = {
    path: GALLERY_PATH,
    text: galleryText,
    bytes: Buffer.byteLength(galleryText, 'utf8'),
    sha256: digest(galleryText),
  };
  return {
    rootIdentity: 'fixture-root',
    revision: 'rev000000',
    files: [gallery],
    configFile: null,
    config: {},
    variables: {},
    scenes: [],
    timelines: [],
  };
}

async function open(galleryText = baseGallery): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const repo = new InMemoryChangeRepository();
  const change = await beginChange(snapshot(galleryText), repo);
  return { change, repo };
}

function workingGallery(change: ChangeSession): Record<string, unknown> {
  return JSON.parse(change.record.workingFiles[GALLERY_PATH]!) as Record<string, unknown>;
}

function entries(change: ChangeSession): Array<Record<string, unknown>> {
  return workingGallery(change).cgs as Array<Record<string, unknown>>;
}

async function fingerprintOf(change: ChangeSession, id: string): Promise<string> {
  const inspected = await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher);
  const item = inspected.cgs.find((entry) => entry.id === id);
  if (item === undefined) throw new Error(`missing gallery entry ${id}`);
  return item.fingerprint;
}

describe('gallery.cg authoring operations', () => {
  it('creates dossier fragments and registers canonical terms without changing unrelated data', async () => {
    const { change } = await open();
    change.record.workingFiles['game.config.json'] = JSON.stringify({ characters: { rin: { name: '凛' } } });
    change.record.workingFiles['content/config/terminology.json'] = JSON.stringify({ terms: [{ canonical: '旧词', variants: ['旧写法'], extra: 8 }], custom: true });
    const first = await applyGalleryDossierMutation(change, 'profiles', { operationId: 'profile', id: 'rin.first', character: 'rin', title: '初见', description: '车站相遇。' }, hasher);
    await applyGalleryDossierMutation(change, 'profiles', { operationId: 'secret', id: 'rin.secret', character: 'rin', title: '往事', description: '秘密。' }, hasher);
    await applyGalleryDossierMutation(change, 'terms', { operationId: 'term', id: 'port', canonical: '雾港', description: '海边的小城。' }, hasher);
    expect(JSON.parse(change.record.workingFiles['content/config/terminology.json']!)).toEqual({ terms: [{ canonical: '旧词', variants: ['旧写法'], extra: 8 }, { canonical: '雾港', variants: [] }], custom: true });
    await applyGalleryDossierMutation(change, 'profiles', { operationId: 'profile-edit', id: 'rin.first', expectedFingerprint: first.fingerprint, patch: { title: null, description: '已经修订。' } }, hasher);
    const saved = structuredClone(change.record);
    await expect(applyGalleryDossierMutation(change, 'profiles', { operationId: 'missing-character', id: 'bad', character: 'missing' }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(applyGalleryDossierMutation(change, 'profiles', { operationId: 'stale-profile', id: 'rin.first', expectedFingerprint: first.fingerprint, patch: { description: '过期稿' } }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(change.record).toEqual(saved);
    const view = await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher);
    expect(view.profiles[0]).toMatchObject({ character: 'rin', description: '已经修订。', objectRef: 'gallery:profiles:rin.first' });
    expect(view.profiles[0]).not.toHaveProperty('title');
    change.record.composition = { ...change.record.composition!, mode: 'candidate' }; const candidate = structuredClone(change.record);
    await expect(applyGalleryDossierMutation(change, 'terms', { operationId: 'candidate-term', id: 'no', canonical: '不落盘' }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(candidate);
  });
  it('creates and edits ending metadata with stale/rejected writes leaving the draft untouched', async () => {
    const { change } = await open(JSON.stringify({ ...JSON.parse(baseGallery), endings: [{ id: 'home', name: '归途', description: '旧说明', extra: 7 }] }));
    const before = (await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher)).endings[0]!;
    const edited = await applyGalleryEndingMutation(change, { operationId: 'ending-edit', id: 'home', expectedFingerprint: before.fingerprint, patch: { name: '雨后', description: null } }, hasher);
    expect(edited.entry).toEqual({ id: 'home', name: '雨后', extra: 7 });
    const saved = structuredClone(change.record);
    await expect(applyGalleryEndingMutation(change, { operationId: 'stale', id: 'home', expectedFingerprint: before.fingerprint, patch: { name: '旧稿' } }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await expect(applyGalleryEndingMutation(change, { operationId: 'bad', id: 'new', name: ' ' }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(change.record).toEqual(saved);
    const created = await applyGalleryEndingMutation(change, { operationId: 'new', id: 'night', name: '夜航', description: '两人一起回家。' }, hasher);
    expect((await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher)).endings[1]).toMatchObject({ ...created.entry, fingerprint: created.fingerprint });
    expect(workingGallery(change).customRoot).toEqual({ keep: true });
    const direct = structuredClone(change.record);
    change.record.composition = { ...change.record.composition!, mode: 'candidate' };
    const candidate = structuredClone(change.record);
    await expect(applyGalleryEndingMutation(change, { operationId: 'candidate', id: 'no', name: '不落盘' }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(candidate);
    change.record.composition = direct.composition;
  });
  it('creates and patches replay conditions while rejecting stale and invalid mutations atomically', async () => {
    const { change } = await open();
    change.record.workingFiles['game.config.json'] = JSON.stringify({ variables: { score: { type: 'number', initial: 0 } } });
    change.record.workingFiles['content/scenario/start.gal'] = '@scene start\n@label memory\n旁白：回想。\n@end\n';
    const created = await applyGalleryTextMutation(change, { operationId: 'new-text', id: 'another', name: '另一段', scene: 'start', label: 'memory', variables: { score: 2 } }, hasher);
    expect((await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher)).texts.find(entry => entry.id === 'another')).toMatchObject({ fingerprint: created.fingerprint, variables: { score: 2 } });
    expect(workingGallery(change).customRoot).toEqual({ keep: true });
    const saved = structuredClone(change.record);
    const invalidPatches: GalleryTextPatchInput['patch'][] = [{ variables: { missing: 1 } }, { variables: { score: 'bad' } }, { label: 'absent' }];
    for (const patch of invalidPatches) {
      await expect(applyGalleryTextMutation(change, { operationId: 'invalid', id: 'another', expectedFingerprint: created.fingerprint, patch }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(change.record).toEqual(saved);
    }
    await applyGalleryTextMutation(change, { operationId: 'clear-conditions', id: 'another', expectedFingerprint: created.fingerprint, patch: { label: null, variables: null } }, hasher);
    await expect(applyGalleryTextMutation(change, { operationId: 'stale-text', id: 'another', expectedFingerprint: created.fingerprint, patch: { name: '过期' } }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(workingGallery(change).texts).toContainEqual({ id: 'another', name: '另一段', scene: 'start' });
  });
  it('refuses text mutations in candidates before persistence', async () => {
    const change = await beginChange(snapshot(), new InMemoryChangeRepository(), undefined, undefined, { composition: { mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
    const original = structuredClone(change.record);
    await expect(applyGalleryTextMutation(change, { operationId: 'no', id: 'm', name: '回想', scene: 'start' }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(original);
  });
  it('reads, narrowly patches and fingerprints collection policies without rewriting gallery entries', async () => {
    const { change } = await open();
    const original = workingGallery(change);
    const before = (await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher)).unlockPolicy;
    expect(before).toMatchObject({ value: null, effective: { cgs: 'save', music: 'save' } });
    const input = { operationId: 'policy', expectedFingerprint: before.fingerprint, patch: { cgs: 'profile' as const } };
    const result = await applyGalleryPolicyPatch(change, input, hasher);
    expect(workingGallery(change)).toEqual({ ...original, unlockPolicy: { cgs: 'profile' } });
    expect(result.unlockPolicy.effective).toEqual({ cgs: 'profile', music: 'save', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' });
    await applyGalleryPolicyPatch(change, input, hasher); // idempotency
    const saved = structuredClone(change.record);
    await expect(applyGalleryPolicyPatch(change, { ...input, operationId: 'stale' }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(change.record).toEqual(saved);
    await applyGalleryPolicyPatch(change, { operationId: 'clear', expectedFingerprint: result.unlockPolicy.fingerprint, patch: { cgs: null } }, hasher);
    expect(workingGallery(change)).toEqual(original);
  });

  it('rejects candidate policies before changing content or operation records', async () => {
    const repo = new InMemoryChangeRepository();
    const change = await beginChange(snapshot(), repo, undefined, undefined, { composition: { mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
    const before = structuredClone(change.record);
    const policy = (await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher)).unlockPolicy;
    await expect(applyGalleryPolicyPatch(change, { operationId: 'blocked', expectedFingerprint: policy.fingerprint, patch: { music: 'profile' } }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(before);
  });
  it('adds and patches one CG while preserving root, sibling, music, text, and unknown fields', async () => {
    const { change } = await open();

    const created = await applyGalleryCgCreate(change, {
      operationId: 'op-create-new-cg',
      id: '夜の記憶',
      name: '夜の記憶',
    }, hasher);
    expect(created.entry).toEqual({ id: '夜の記憶', name: '夜の記憶' });

    const afterCreate = workingGallery(change);
    expect(afterCreate.title).toBe('保留根字段');
    expect(afterCreate.customRoot).toEqual({ keep: true });
    expect(afterCreate.music).toEqual([{ id: 'rain', name: '雨声' }]);
    expect(afterCreate.texts).toEqual([{ id: 'memory', name: '回想', scene: 'start', label: 'memory' }]);
    expect(entries(change).find((entry) => entry.id === 'base')).toEqual({
      id: 'base', name: '旧 CG', src: 'base_bg', unknown: { keep: 'cg' },
    });

    const renamed = await applyGalleryCgPatch(change, {
      operationId: 'op-patch-name',
      id: 'base',
      expectedFingerprint: await fingerprintOf(change, 'base'),
      patch: { name: '改名后的 CG' },
    }, hasher);
    expect(renamed.entry).toEqual({ id: 'base', name: '改名后的 CG', src: 'base_bg', unknown: { keep: 'cg' } });

    const srcCleared = await applyGalleryCgPatch(change, {
      operationId: 'op-patch-clear-src',
      id: 'base',
      expectedFingerprint: renamed.fingerprint,
      patch: { src: null },
    }, hasher);
    expect(srcCleared.entry).toEqual({ id: 'base', name: '改名后的 CG', unknown: { keep: 'cg' } });
    expect(entries(change).find((entry) => entry.id === '夜の記憶')).toEqual({ id: '夜の記憶', name: '夜の記憶' });
    expect(change.record.workingRevision).toBe(3);
  });

  it('makes repeated operations idempotent and rejects the same operationId with a different request', async () => {
    const { change, repo } = await open(JSON.stringify({ cgs: [], music: [], texts: [] }));
    const input = { operationId: 'op-idempotent-cg', id: '__proto__', name: '原型 CG' } as const;
    const first = await applyGalleryCgCreate(change, input, hasher);
    const second = await applyGalleryCgCreate(change, input, hasher);

    expect(second).toEqual(first);
    expect(change.record.workingRevision).toBe(1);
    expect(Object.keys(change.record.operations)).toEqual(['op-idempotent-cg']);
    await expect(applyGalleryCgCreate(change, { ...input, name: '另一请求' }, hasher))
      .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    expect(change.record.workingRevision).toBe(1);
    expect((await repo.read(change.record.changeId))?.workingRevision).toBe(1);
  });

  it('rejects stale fingerprints and invalid or duplicate CG requests without changing the record', async () => {
    const { change } = await open();
    const before = JSON.stringify(change.record);

    await expect(applyGalleryCgPatch(change, {
      operationId: 'op-stale-cg',
      id: 'base',
      expectedFingerprint: 'stale-fingerprint',
      patch: { name: '不应写入' },
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(change.record)).toBe(before);

    await expect(applyGalleryCgCreate(change, {
      operationId: 'op-duplicate-cg', id: 'base', name: '重复 CG',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    await expect(applyGalleryCgCreate(change, {
      operationId: 'op-invalid-cg', id: 'bad', name: '', src: '',
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(applyGalleryCgPatch(change, {
      operationId: 'op-invalid-patch', id: 'base', expectedFingerprint: await fingerprintOf(change, 'base'),
      patch: { bogus: 'field' } as never,
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(JSON.stringify(change.record)).toBe(before);
    expect(change.record.workingRevision).toBe(0);
    const duplicateSource = await open(JSON.stringify({ cgs: [
      { id: 'same', name: '一' }, { id: 'same', name: '二' },
    ], music: [] }));
    await expect(applyGalleryCgCreate(duplicateSource.change, {
      operationId: 'op-ambiguous-source', id: 'new', name: '新 CG',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });

    const nullSource = await open(JSON.stringify({ cgs: null, music: [] }));
    await expect(applyGalleryCgCreate(nullSource.change, {
      operationId: 'op-null-cgs', id: 'new', name: '新 CG',
    }, hasher)).rejects.toMatchObject({ code: 'PROJECT_INVALID' });
    expect(nullSource.change.record.workingRevision).toBe(0);
  });

  it('retains non-ASCII and prototype-shaped ids as ordinary gallery entries', async () => {
    const { change } = await open(JSON.stringify({ cgs: [], music: [] }));
    await applyGalleryCgCreate(change, { operationId: 'op-ascii-id', id: '合法非ASCII_日本語', name: '展示' }, hasher);
    await applyGalleryCgCreate(change, { operationId: 'op-constructor-id', id: 'constructor', name: '构造者' }, hasher);

    const galleryEntries = entries(change);
    expect(galleryEntries.map((entry) => entry.id)).toEqual(['合法非ASCII_日本語', 'constructor']);
    expect(galleryEntries.find((entry) => entry.id === 'constructor')).toEqual({ id: 'constructor', name: '构造者' });
    const inspected = await inspectGallery(change.record.workingFiles[GALLERY_PATH], hasher);
    expect(inspected.cgs.map((entry) => entry.objectRef)).toEqual([
      'gallery:cgs:合法非ASCII_日本語', 'gallery:cgs:constructor',
    ]);
  });

  it('includes gallery.json in the snapshot baseline and changes revision when its text changes', async () => {
    let currentGallery = JSON.stringify({ cgs: [], music: [] }) + '\n';
    const storage: ProjectStorage = {
      rootIdentity: 'snapshot-gallery-root',
      async listFiles() { return [GALLERY_PATH]; },
      async readText(path) {
        if (path !== GALLERY_PATH) throw new Error(`unexpected path ${path}`);
        const text = currentGallery;
        return { path, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: digest(text) };
      },
      async exists(path) { return path === GALLERY_PATH; },
    };

    const baseline = await loadProjectSnapshot(storage, hasher);
    expect(baseline.files.map((file) => file.path)).toEqual([GALLERY_PATH]);
    expect(baseline.files[0]?.text).toBe(currentGallery);
    currentGallery = JSON.stringify({ cgs: [{ id: 'changed', name: '变更' }], music: [] }) + '\n';
    const changed = await loadProjectSnapshot(storage, hasher);
    expect(changed.revision).not.toBe(baseline.revision);
    expect(changed.files[0]?.text).toBe(currentGallery);
  });
});
