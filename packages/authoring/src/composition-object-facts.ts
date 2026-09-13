import { buildObjectIndex } from './object-index.js';
import { buildAssetCatalog, backgroundAssetRef, portraitAssetRef, avatarAssetRef } from './asset-catalog.js';
import type { ManifestObjectFact, ManifestObjectFacts } from './composition-contracts.js';
import type { ProjectSnapshot } from './project-snapshot.js';
import type { TextHasher } from './project-storage.js';
import { stableStringify } from './change-session.js';
import type { ReplayStatePrecondition } from './composition-contracts.js';
import { GALLERY_PATH, readGalleryDocument } from './gallery-operations.js';

export async function buildReplayStateBaseObjects(snapshot: ProjectSnapshot, hasher: TextHasher): Promise<ReplayStatePrecondition[]> {
  const { cgs } = readGalleryDocument(snapshot.files.find((file) => file.path === GALLERY_PATH)?.text);
  return [
    { objectRef: 'config:characters', expectedFingerprint: await hasher.sha256(stableStringify(snapshot.config['characters'] ?? {})) },
    ...snapshot.scenes.map((scene) => ({ objectRef: `scene:${scene.id}`, expectedFingerprint: scene.file.sha256 })),
    ...await Promise.all(cgs.map(async (entry) => ({ objectRef: `gallery:cgs:${entry.id}`, expectedFingerprint: await hasher.sha256(stableStringify(entry)) }))),
  ];
}

export function resolvedCompositionAssetRefs(assetPaths: readonly string[]): string[] {
  const catalog = buildAssetCatalog(assetPaths);
  return [...new Set([
    ...catalog.backgrounds.filter((asset) => asset.resolved).map((asset) => backgroundAssetRef(asset.key)),
    ...catalog.portraits.filter((asset) => asset.resolved).map((asset) => portraitAssetRef(asset.role!, asset.outfit!, asset.expression!)),
    ...catalog.avatars.filter((asset) => asset.resolved).map((asset) => avatarAssetRef(asset.key)),
  ])].sort();
}

export function projectCompositionObjectFacts(
  baseSnapshot: ProjectSnapshot, workingSnapshot: ProjectSnapshot, assetPaths: readonly string[], frozenBaseAssetRefs?: readonly string[],
): ManifestObjectFacts {
  const workingAssetRefs = resolvedCompositionAssetRefs(assetPaths);
  const baseAssetRefs = frozenBaseAssetRefs === undefined ? workingAssetRefs : [...frozenBaseAssetRefs];
  const objectsWithAssets = (snapshot: ProjectSnapshot, assets: readonly string[]): ManifestObjectFact[] => [
    ...buildObjectIndex(snapshot).objects.filter((object) => !object.objectRef.startsWith('asset:')).map((object) => ({
      objectRef: object.objectRef, references: [...object.references],
      ...(object.fingerprint === undefined ? {} : { fingerprint: object.fingerprint }),
    })),
    ...assets.map((objectRef) => ({ objectRef, references: [] })),
  ];
  return {
    baseObjects: objectsWithAssets(baseSnapshot, baseAssetRefs), workingObjects: objectsWithAssets(workingSnapshot, workingAssetRefs),
    baseAssetRefs, workingAssetRefs,
  };
}
