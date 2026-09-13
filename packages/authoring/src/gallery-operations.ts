import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { GalleryCgCreateInput, GalleryCgPatchInput, LedgerDiffEntry, TextHasher } from './contracts.js';
import type { OperationCompositionDraft } from './composition-contracts.js';

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
  cgs: Array<{ id: string; name: string; src?: string; objectRef: string; fingerprint: string }>;
}> {
  const { cgs } = readGalleryDocument(text);
  return { cgs: await Promise.all(cgs.map(async (entry) => ({
    id: entry.id, name: entry.name, ...(entry.src === undefined ? {} : { src: entry.src }),
    objectRef: `gallery:cgs:${entry.id}`, fingerprint: await hasher.sha256(stableStringify(entry)),
  }))) };
}

export interface GalleryCgOperationResult {
  id: string;
  objectRef: string;
  fingerprint: string;
  entry: GalleryCgEntry;
  diffEntry: LedgerDiffEntry;
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
