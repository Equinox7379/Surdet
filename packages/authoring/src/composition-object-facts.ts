import { buildObjectIndex } from './object-index.js';
import { compareCanonicalText } from './canonical-order.js';
import { buildAssetCatalog, backgroundAssetRef, portraitAssetRef, avatarAssetRef } from './asset-catalog.js';
import type { ManifestObjectFact, ManifestObjectFacts } from './composition-contracts.js';
import type { ProjectSnapshot } from './project-snapshot.js';
import type { TextHasher } from './project-storage.js';
import { stableStringify } from './change-session.js';
import type { ReplayStatePrecondition } from './composition-contracts.js';
import { GALLERY_PATH, readGalleryDocument } from './gallery-operations.js';
import { timelineIdFromPath } from './timeline-identity.js';
import { parseTimelineDefinition, timelineFingerprint } from './timeline-operations.js';
import { mediaAssetCommand } from './asset-intelligence.js';
import { resolveProjectFontPaths } from '@surdet/core';

export async function buildReplayStateBaseObjects(snapshot: ProjectSnapshot, hasher: TextHasher): Promise<ReplayStatePrecondition[]> {
  const { cgs } = readGalleryDocument(snapshot.files.find((file) => file.path === GALLERY_PATH)?.text);
  const timelineObjects = await Promise.all(snapshot.timelines.map(async (timeline) => {
    const objectRef = `timeline:${timelineIdFromPath(timeline.path)}`;
    try {
      return { objectRef, expectedFingerprint: await timelineFingerprint(parseTimelineDefinition(timeline.text), hasher) };
    } catch {
      // Keep the existing file fact for malformed timelines; timeline operations
      // still reject them through the normal project validation path.
      return { objectRef, expectedFingerprint: timeline.sha256 };
    }
  }));
  return [
    { objectRef: 'config:characters', expectedFingerprint: await hasher.sha256(stableStringify(snapshot.config['characters'] ?? {})) },
    { objectRef: 'config:fonts', expectedFingerprint: await hasher.sha256(stableStringify(resolveProjectFontPaths(snapshot.config))) },
    ...snapshot.scenes.map((scene) => ({ objectRef: `scene:${scene.id}`, expectedFingerprint: scene.file.sha256 })),
    ...timelineObjects,
    ...await Promise.all(Object.entries(snapshot.variables).sort(([left], [right]) => compareCanonicalText(left, right)).map(async ([name, declaration]) => ({
      objectRef: `variable:${name}`,
      expectedFingerprint: await hasher.sha256(stableStringify(declaration)),
    }))),
    ...await Promise.all(cgs.map(async (entry) => ({ objectRef: `gallery:cgs:${entry.id}`, expectedFingerprint: await hasher.sha256(stableStringify(entry)) }))),
  ];
}

export function resolvedCompositionAssetRefs(assetPaths: readonly string[]): string[] {
  const catalog = buildAssetCatalog(assetPaths);
  const usable = catalog.intelligence.items.filter(item => item.physical && item.issues.every(issue => issue === 'ASSET_UNUSED'));
  const usablePaths = new Set(usable.map(item => item.sourcePath));
  return [...new Set([
    ...catalog.backgrounds.filter((asset) => asset.resolved && usablePaths.has(asset.sourcePath)).map((asset) => backgroundAssetRef(asset.key)),
    ...catalog.portraits.filter((asset) => asset.resolved && usablePaths.has(asset.sourcePath)).map((asset) => portraitAssetRef(asset.role!, asset.outfit!, asset.expression!)),
    ...catalog.avatars.filter((asset) => asset.resolved && usablePaths.has(asset.sourcePath)).map((asset) => avatarAssetRef(asset.key)),
    ...usable.flatMap(item => {
      if (item.kind === 'font') return [`asset:font:${item.sourcePath}`];
      const channel = mediaAssetCommand(item.kind);
      return channel && !(channel === 'ambience' && item.key === 'off')
        ? [`asset:${channel}:${item.key}`] : [];
    }),
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
