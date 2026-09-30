import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { GalleryCgCreateInput, GalleryCgPatchInput, LedgerDiffEntry, TextHasher } from './contracts.js';
import type { OperationCompositionDraft } from './composition-contracts.js';
import { readGalleryUnlockPolicy, readGalleryReplayEntries, readGalleryEndings, compileScene, type GalleryEndingEntry, type GalleryReplayEntry, type GalleryUnlockPolicy, type VarDeclaration } from '@surdet/core';
import { sceneIdFromScenarioPath } from './scenario-identity.js';

export const GALLERY_PATH = 'content/config/gallery.json';

export interface GalleryCgEntry extends Record<string, unknown> {
  id: string;
  name: string;
  src?: string;
}

export function readGalleryDocument(text: string | undefined): { document: Record<string, unknown>; cgs: GalleryCgEntry[] } {
  const document = text === undefined ? { cgs: [], music: [] } : parseProjectConfigDocument(text, GALLERY_PATH);
  const cgs = document['cgs'] === undefined ? [] : document['cgs'];
  if (!Array.isArray(cgs)) throw new AuthoringOperationError('PROJECT_INVALID', 'gallery.json.cgs 必须是数组');
  const ids = new Set<string>();
  for (const entry of cgs) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)
      || typeof entry.id !== 'string' || entry.id.trim().length === 0
      || typeof entry.name !== 'string' || entry.name.trim().length === 0
      || ('src' in entry && (typeof entry.src !== 'string' || entry.src.trim().length === 0))) {
      throw new AuthoringOperationError('PROJECT_INVALID', 'CG 条目必须包含非空 id/name，src 若提供必须非空');
    }
    if (ids.has(entry.id)) throw new AuthoringOperationError('OBJECT_AMBIGUOUS', `CG ID 不唯一：${entry.id}`);
    ids.add(entry.id);
  }
  return { document, cgs: cgs as GalleryCgEntry[] };
}

export async function inspectGallery(text: string | undefined, hasher: TextHasher): Promise<{
  unlockPolicy: { value: unknown; effective: GalleryUnlockPolicy; fingerprint: string };
  cgs: Array<{ id: string; name: string; src?: string; objectRef: string; fingerprint: string }>;
  texts: Array<GalleryReplayEntry & { objectRef: string; fingerprint: string }>;
  endings: Array<GalleryEndingEntry & { objectRef: string; fingerprint: string }>;
}> {
  const { cgs, document } = readGalleryDocument(text);
  return { endings: await Promise.all(readGalleryEndings(document).map(async entry => ({ ...entry,
    objectRef: `gallery:endings:${entry.id}`, fingerprint: await hasher.sha256(stableStringify(entry)) }))),
    texts: await Promise.all(readGalleryReplayEntries(document).map(async entry => ({ ...entry,
    objectRef: `gallery:texts:${entry.id}`, fingerprint: await hasher.sha256(stableStringify(entry)) }))),
    unlockPolicy: await inspectGalleryUnlockPolicy(document, hasher), cgs: await Promise.all(cgs.map(async (entry) => ({
    id: entry.id, name: entry.name, ...(entry.src === undefined ? {} : { src: entry.src }),
    objectRef: `gallery:cgs:${entry.id}`, fingerprint: await hasher.sha256(stableStringify(entry)),
  }))) };
}

export async function inspectGalleryUnlockPolicy(document: Record<string, unknown>, hasher: TextHasher) {
  const value = document.unlockPolicy ?? null;
  try {
    return { value, effective: readGalleryUnlockPolicy(document), fingerprint: await hasher.sha256(stableStringify(value)) };
  } catch (error) { throw new AuthoringOperationError('PROJECT_INVALID', String(error)); }
}

export interface GalleryPolicyPatchInput {
  operationId: string;
  expectedFingerprint: string;
  patch: Partial<Record<keyof GalleryUnlockPolicy, 'save' | 'profile' | null>>;
}

/** Shared by the Agent operation and Editor row conversion; keeps all other data intact. */
export function patchGalleryUnlockPolicy(document: Record<string, unknown>, patch: GalleryPolicyPatchInput['patch']): Record<string, unknown> {
  readGalleryUnlockPolicy(document);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length
    || Object.keys(patch).some(key => !['cgs', 'music', 'texts', 'endings'].includes(key))) throw new AuthoringOperationError('INVALID_REQUEST', '收藏策略只接受 cgs/music/texts/endings');
  const next = { ...(document.unlockPolicy as Record<string, unknown> | undefined) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  const result = { ...document, unlockPolicy: next };
  try { readGalleryUnlockPolicy(result); }
  catch (error) { throw new AuthoringOperationError('VALIDATION_FAILED', String(error)); }
  if (!Object.keys(next).length) delete (result as Record<string, unknown>).unlockPolicy;
  return result;
}

export async function applyGalleryPolicyPatch(change: ChangeSession, input: GalleryPolicyPatchInput, hasher: TextHasher) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '收藏策略修改只支持普通 direct 草稿');
  }
  return runOperation(change, input, async record => {
    const source = record.workingFiles[GALLERY_PATH];
    const { document } = readGalleryDocument(source);
    const before = await inspectGalleryUnlockPolicy(document, hasher);
    if (before.fingerprint !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '收藏策略已变化，请重新读取 project.gallery');
    const next = patchGalleryUnlockPolicy(document, input.patch);
    const after = await inspectGalleryUnlockPolicy(next, hasher);
    return { result: { unlockPolicy: after, diffEntry: {
      kind: 'gallery.policy.patch', operationId: input.operationId,
      objectBefore: 'config:galleryPolicy', objectAfter: 'config:galleryPolicy', fingerprintBefore: before.fingerprint, fingerprintAfter: after.fingerprint,
      directChange: { path: GALLERY_PATH, before: before.value, after: after.value }, potentialImpact: [], observedImpact: [],
    } satisfies LedgerDiffEntry }, workingFiles: { ...record.workingFiles, [GALLERY_PATH]: serializeProjectConfigDocument(next, source ?? '') } };
  });
}

export interface GalleryCgOperationResult {
  id: string;
  objectRef: string;
  fingerprint: string;
  entry: GalleryCgEntry;
  diffEntry: LedgerDiffEntry;
}

export interface GalleryTextCreateInput { operationId: string; id: string; name: string; scene: string; label?: string; variables?: GalleryReplayEntry['variables'] }
export interface GalleryTextPatchInput { operationId: string; id: string; expectedFingerprint: string; patch: {
  name?: string; scene?: string; label?: string | null; variables?: GalleryReplayEntry['variables'] | null;
} }

export async function applyGalleryTextMutation(change: ChangeSession, input: GalleryTextCreateInput | GalleryTextPatchInput, hasher: TextHasher) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '回想条目修改只支持普通 direct 草稿');
  }
  return runOperation(change, input, async record => {
    const source = record.workingFiles[GALLERY_PATH];
    const { document } = readGalleryDocument(source);
    const texts = [...readGalleryReplayEntries(document)];
    const index = texts.findIndex(entry => entry.id === input.id);
    const before = texts[index];
    const patching = 'patch' in input;
    const fingerprintBefore = before ? await hasher.sha256(stableStringify(before)) : undefined;
    let entry: GalleryReplayEntry;
    if (patching) {
      if (!before) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `回想不存在：${input.id}`);
      if (fingerprintBefore !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '回想已修改，请重新读取 project.gallery');
      if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch) || !Object.keys(input.patch).length
        || Object.keys(input.patch).some(key => !['name', 'scene', 'label', 'variables'].includes(key))) throw new AuthoringOperationError('INVALID_REQUEST', '回想修改只接受 name/scene/label/variables');
      entry = { ...before };
      for (const [key, value] of Object.entries(input.patch)) {
        if (value === null && (key === 'label' || key === 'variables')) delete entry[key];
        else entry[key] = value;
      }
    } else {
      if (before) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `回想已存在：${input.id}`);
      entry = { id: input.id, name: input.name, scene: input.scene,
        ...(input.label === undefined ? {} : { label: input.label }), ...(input.variables === undefined ? {} : { variables: input.variables }) };
    }
    const config = parseProjectConfigDocument(record.workingFiles['game.config.json'] ?? '{}');
    try {
      const declarations = Object.entries((config.variables ?? {}) as Record<string, Omit<VarDeclaration, 'name'>>).map(([name, decl]) => ({ ...decl, name }));
      readGalleryReplayEntries({ texts: [entry] }, declarations);
      const targets = Object.entries(record.workingFiles).filter(([path]) => path.startsWith('content/scenario/') && /\.gal$/i.test(path) && sceneIdFromScenarioPath(path) === entry.scene);
      if (targets.length !== 1) throw new Error(`回想场景不存在或不唯一：${entry.scene}`);
      const [path, text] = targets[0]!;
      const scene = compileScene(text, path, entry.scene, (config.customInstructions ?? []) as string[]);
      if (entry.label !== undefined && !scene.labels.has(entry.label)) throw new Error(`回想标签不存在：${entry.label}`);
    } catch (error) { throw new AuthoringOperationError('VALIDATION_FAILED', String(error)); }
    if (patching) texts[index] = entry; else texts.push(entry);
    const fingerprint = await hasher.sha256(stableStringify(entry));
    const objectRef = `gallery:texts:${entry.id}`;
    return { result: { entry, objectRef, fingerprint, diffEntry: {
      kind: patching ? 'gallery.text.patch' : 'gallery.text.create', operationId: input.operationId,
      objectBefore: before ? objectRef : undefined, objectAfter: objectRef, fingerprintBefore, fingerprintAfter: fingerprint,
      directChange: { path: GALLERY_PATH, before: before ?? null, after: entry }, potentialImpact: [], observedImpact: [],
    } satisfies LedgerDiffEntry }, workingFiles: { ...record.workingFiles, [GALLERY_PATH]: serializeProjectConfigDocument({ ...document, texts }, source ?? '') } };
  });
}

export interface GalleryEndingCreateInput { operationId: string; id: string; name: string; description?: string }
export interface GalleryEndingPatchInput { operationId: string; id: string; expectedFingerprint: string; patch: { name?: string; description?: string | null } }

export async function applyGalleryEndingMutation(change: ChangeSession, input: GalleryEndingCreateInput | GalleryEndingPatchInput, hasher: TextHasher) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '结局条目修改只支持普通 direct 草稿');
  }
  return runOperation(change, input, async record => {
    const source = record.workingFiles[GALLERY_PATH];
    const { document } = readGalleryDocument(source);
    const endings = [...readGalleryEndings(document)];
    const index = endings.findIndex(entry => entry.id === input.id);
    const before = endings[index];
    const patching = 'patch' in input;
    const fingerprintBefore = before ? await hasher.sha256(stableStringify(before)) : undefined;
    let entry: GalleryEndingEntry;
    if (patching) {
      if (!before) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `结局不存在：${input.id}`);
      if (fingerprintBefore !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '结局已修改，请重新读取 project.gallery');
      if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch) || !Object.keys(input.patch).length
        || Object.keys(input.patch).some(key => !['name', 'description'].includes(key))) throw new AuthoringOperationError('INVALID_REQUEST', '结局修改只接受 name/description');
      entry = { ...before };
      if (input.patch.name !== undefined) entry.name = input.patch.name;
      if (input.patch.description === null) delete entry.description;
      else if (input.patch.description !== undefined) entry.description = input.patch.description;
    } else {
      if (before) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `结局已存在：${input.id}`);
      entry = { id: input.id, name: input.name, ...(input.description === undefined ? {} : { description: input.description }) };
    }
    try { readGalleryEndings({ endings: [entry] }); }
    catch (error) { throw new AuthoringOperationError('VALIDATION_FAILED', String(error)); }
    if (patching) endings[index] = entry; else endings.push(entry);
    const fingerprint = await hasher.sha256(stableStringify(entry));
    const objectRef = `gallery:endings:${entry.id}`;
    return { result: { entry, objectRef, fingerprint, diffEntry: {
      kind: patching ? 'gallery.ending.patch' : 'gallery.ending.create', operationId: input.operationId,
      objectBefore: before ? objectRef : undefined, objectAfter: objectRef, fingerprintBefore, fingerprintAfter: fingerprint,
      directChange: { path: GALLERY_PATH, before: before ?? null, after: entry }, potentialImpact: [], observedImpact: [],
    } satisfies LedgerDiffEntry }, workingFiles: { ...record.workingFiles, [GALLERY_PATH]: serializeProjectConfigDocument({ ...document, endings }, source ?? '') } };
  });
}

async function applyGalleryCgMutation(
  change: ChangeSession, input: GalleryCgCreateInput | GalleryCgPatchInput, hasher: TextHasher,
): Promise<GalleryCgOperationResult> {
  return runOperation(change, input, async (record) => {
    if (typeof input.id !== 'string' || input.id.trim().length === 0) {
      throw new AuthoringOperationError('VALIDATION_FAILED', 'CG id 必须是非空字符串');
    }
    const source = record.workingFiles[GALLERY_PATH];
    const { document, cgs } = readGalleryDocument(source);
    const index = cgs.findIndex((entry) => entry.id === input.id);
    const before = cgs[index];
    const patching = 'patch' in input;
    const objectRef = `gallery:cgs:${input.id}`;
    const fingerprintBefore = before === undefined ? undefined : await hasher.sha256(stableStringify(before));
    let entry: GalleryCgEntry;
    if (patching) {
      if (before === undefined) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `CG 不存在：${input.id}`);
      if (input.expectedFingerprint !== fingerprintBefore) throw new AuthoringOperationError('OBJECT_REF_STALE', `CG 指纹不匹配：${input.id}`);
      const patch = input.patch;
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => key !== 'name' && key !== 'src')) {
        throw new AuthoringOperationError('VALIDATION_FAILED', 'CG patch 只接受 name/src，且至少修改一个字段');
      }
      entry = { ...before };
      if (patch.name !== undefined) entry.name = patch.name;
      if (patch.src === null) delete entry.src;
      else if (patch.src !== undefined) entry.src = patch.src;
    } else {
      if (before !== undefined) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `CG 已存在：${input.id}`);
      entry = { id: input.id, name: input.name, ...(input.src === undefined ? {} : { src: input.src }) };
    }
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0
      || (entry.src !== undefined && (typeof entry.src !== 'string' || entry.src.trim().length === 0))) {
      throw new AuthoringOperationError('VALIDATION_FAILED', 'CG name/src 必须是非空字符串');
    }
    const fingerprint = await hasher.sha256(stableStringify(entry));
    const key = entry.src ?? entry.id;
    const capabilityId = patching ? 'gallery.cg.patch' : 'gallery.cg.create';
    const compositionDraft: OperationCompositionDraft = {
      capabilityId, primaryObject: objectRef,
      rawReferences: [{ kind: 'background-asset', scope: 'candidate-external', token: key, objectRef: `asset:bg:${key}`, source: { path: GALLERY_PATH } }],
      producedObjects: [{ objectRef, disposition: patching ? 'update' : 'create', finalFingerprint: fingerprint }],
      objectFingerprintAfter: fingerprint,
      ...(fingerprintBefore === undefined ? {} : {
        objectFingerprintBefore: fingerprintBefore,
        replayStatePreconditions: [{ objectRef, expectedFingerprint: fingerprintBefore }],
      }),
    };
    compositionDraft.replayStatePreconditions = [...(compositionDraft.replayStatePreconditions ?? []), {
      objectRef: 'config:galleryPolicy', expectedFingerprint: await hasher.sha256(stableStringify(document.unlockPolicy ?? null)),
    }];
    if (patching) cgs[index] = entry;
    else cgs.push(entry);
    document['cgs'] = cgs;
    return {
      compositionDraft,
      result: { id: input.id, objectRef, fingerprint, entry, diffEntry: {
        kind: capabilityId, operationId: input.operationId,
        ...(before === undefined ? {} : { objectBefore: objectRef, fingerprintBefore }),
        objectAfter: objectRef, fingerprintAfter: fingerprint,
        directChange: { path: GALLERY_PATH, id: input.id, before: before ?? null, after: entry },
        potentialImpact: [{ objectRef: `asset:bg:${key}` }], observedImpact: [],
      } },
      workingFiles: { ...record.workingFiles, [GALLERY_PATH]: serializeProjectConfigDocument(document, source ?? '') },
    };
  });
}

export function applyGalleryCgCreate(change: ChangeSession, input: GalleryCgCreateInput, hasher: TextHasher): Promise<GalleryCgOperationResult> {
  return applyGalleryCgMutation(change, input, hasher);
}

export function applyGalleryCgPatch(change: ChangeSession, input: GalleryCgPatchInput, hasher: TextHasher): Promise<GalleryCgOperationResult> {
  return applyGalleryCgMutation(change, input, hasher);
}
