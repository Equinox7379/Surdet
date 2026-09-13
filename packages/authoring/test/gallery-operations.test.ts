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
  inspectGallery,
  GALLERY_PATH,
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
