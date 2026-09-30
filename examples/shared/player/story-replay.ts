import { resolveGalleryReplayVariables, SAVE_SCHEMA_VERSION, type SceneRegistry, type SaveSnapshot, type VarDeclaration } from '@surdet/core';
import type { GalleryTextDef } from '@surdet/renderer';

/** Prepare and validate before the live player is touched. This is an ordinary Core snapshot. */
export function prepareStoryReplay(entry: GalleryTextDef, declarations: readonly VarDeclaration[], scenes: SceneRegistry,
  initial: Pick<SaveSnapshot, 'systems' | 'growth'>): SaveSnapshot {
  const scene = scenes.get(entry.scene);
  if (!scene) throw new Error(`回想场景不存在：${entry.scene}`);
  const pc = entry.label === undefined ? 0 : scene.labels.get(entry.label);
  if (pc === undefined) throw new Error(`回想标签不存在：${entry.scene}.${entry.label}`);
  return {
    meta: { id: '', createdAt: 0, updatedAt: 0, schemaVersion: SAVE_SCHEMA_VERSION }, kind: 'manual',
    position: { sceneId: scene.sceneId, pc }, callStack: [],
    variables: resolveGalleryReplayVariables(declarations, entry.variables),
    readSet: [], gallery: { cgs: [], music: [], texts: [] }, clears: { endings: [] },
    ...structuredClone(initial),
  };
}
