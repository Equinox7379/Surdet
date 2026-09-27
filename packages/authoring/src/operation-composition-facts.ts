import { projectPortraitOverrides, projectStageAssetKeys, readProjectStage, resolveProjectTitleLogo, resolveProjectTheme, projectThemeAssetKeys } from '@surdet/core';
import type { OperationCompositionDraft } from './composition-contracts.js';
import type { TextHasher } from './project-storage.js';
import { stableStringify } from './change-session.js';
import { resolveUniqueScenarioPath, sceneIdFromScenarioPath } from './scenario-identity.js';
import {
  analyzeCharacterCompositionReferences,
  analyzeSceneCompositionReferences,
  analyzeTimelineCompositionReferences,
} from './composition-reference-analysis.js';

/** Scene/variable operations also run outside the Node service. */
export const compositionTextHasher: TextHasher = {
  async sha256(text) {
    const platform = globalThis as unknown as {
      crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
      TextEncoder: new () => { encode(value: string): Uint8Array };
    };
    const digest = await platform.crypto.subtle.digest('SHA-256', new platform.TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  },
};

function themeAssetReferences(config: unknown) {
  const keys = [...projectThemeAssetKeys(resolveProjectTheme(config)), resolveProjectTitleLogo(config)].filter((key): key is string => Boolean(key));
  return [...new Set(keys)].map(key => ({ kind: 'background-asset' as const, scope: 'candidate-external' as const,
    token: key, objectRef: `asset:bg:${key}`, source: { path: 'game.config.json' } }));
}

export async function buildSceneOperationCompositionDraft(input: {
  capabilityId: 'scene.create' | 'scene.patch';
  sceneId: string;
  path: string;
  beforeText?: string;
  afterText: string;
  characters: Record<string, unknown>;
  fontPaths: Partial<Record<'body' | 'title' | 'ui', string>>;
  stageConfig?: unknown;
  themeConfig?: unknown;
  titleLogo?: string | null;
  hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `scene:${input.sceneId}`;
  const objectFingerprintAfter = await input.hasher.sha256(input.afterText);
  return {
    capabilityId: input.capabilityId, primaryObject,
    rawReferences: [...themeAssetReferences({ theme: input.themeConfig, player: { titleLogo: input.titleLogo ?? undefined } }), ...analyzeSceneCompositionReferences({
      sceneId: input.sceneId, path: input.path,
      text: input.afterText, characters: input.characters,
    }), ...[...new Set(Object.values(input.fontPaths))].map(path => ({
      kind: 'font-asset' as const, scope: 'candidate-external' as const, token: path,
      objectRef: `asset:font:${path}`, source: { path: 'game.config.json' },
    })), ...projectStageAssetKeys(readProjectStage({ stage: input.stageConfig })).map(key => ({ kind: 'background-asset' as const, scope: 'candidate-external' as const, token: key, objectRef: `asset:bg:${key}`, source: { path: 'game.config.json' } }))],
    producedObjects: [{ objectRef: primaryObject, disposition: input.capabilityId === 'scene.create' ? 'create' : 'update', finalFingerprint: objectFingerprintAfter }],
    ...(input.beforeText === undefined ? {} : { objectFingerprintBefore: await input.hasher.sha256(input.beforeText) }),
    objectFingerprintAfter,
    replayStatePreconditions: [
      { objectRef: 'config:stage', expectedFingerprint: await input.hasher.sha256(stableStringify(input.stageConfig ?? null)) },
      { objectRef: 'config:fonts', expectedFingerprint: await input.hasher.sha256(stableStringify(input.fontPaths)) },
      { objectRef: 'config:theme', expectedFingerprint: await input.hasher.sha256(stableStringify({ theme: input.themeConfig ?? null, titleLogo: input.titleLogo ?? null })) },
      { objectRef: 'config:portraits', expectedFingerprint: await input.hasher.sha256(stableStringify(projectPortraitOverrides({ characters: input.characters }))) },
      ...(input.beforeText === undefined ? [] : [{ objectRef: primaryObject, expectedFingerprint: await input.hasher.sha256(input.beforeText) }]),
    ],
  };
}

export async function buildTimelineOperationCompositionDraft(input: {
  capabilityId: 'timeline.create' | 'timeline.patch';
  timelineId: string;
  path?: string;
  beforeDefinition?: unknown;
  afterDefinition: unknown;
  config: Record<string, unknown>;
  workingFiles?: Readonly<Record<string, string>>;
  hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `timeline:${input.timelineId}`;
  const objectFingerprintAfter = await input.hasher.sha256(stableStringify(input.afterDefinition));
  const dependencies = new Map<string, unknown>();
  const rawReferences = analyzeTimelineCompositionReferences({
    timelineId: input.timelineId, path: input.path ?? `content/timelines/${input.timelineId}.json`, definition: input.afterDefinition,
    lookup: id => {
      const files = Object.entries(input.workingFiles ?? {}).filter(([path]) => path.startsWith('content/timelines/') && path.replace(/\.json$/i, '').split('/').at(-1) === id);
      if (files.length !== 1) return undefined;
      const definition = JSON.parse(files[0]![1].replace(/^\uFEFF/, ''));
      dependencies.set(id, definition);
      return { path: files[0]![0], definition };
    },
  });
  return {
    capabilityId: input.capabilityId, primaryObject,
    rawReferences: [...rawReferences, ...themeAssetReferences(input.config)],
    producedObjects: [{ objectRef: primaryObject, disposition: input.capabilityId === 'timeline.create' ? 'create' : 'update', finalFingerprint: objectFingerprintAfter }],
    ...(input.beforeDefinition === undefined ? {} : { objectFingerprintBefore: await input.hasher.sha256(stableStringify(input.beforeDefinition)) }),
    objectFingerprintAfter,
    replayStatePreconditions: [
      ...(input.beforeDefinition === undefined ? [] : [{
        objectRef: primaryObject,
        expectedFingerprint: await input.hasher.sha256(stableStringify(input.beforeDefinition)),
      }]),
      ...await Promise.all([...dependencies].sort(([a], [b]) => a.localeCompare(b)).map(async ([id, definition]) => ({
        objectRef: `timeline:${id}`, expectedFingerprint: await input.hasher.sha256(stableStringify(definition)),
      }))),
      { objectRef: 'config:stage', expectedFingerprint: await input.hasher.sha256(stableStringify(input.config.stage ?? null)) },
      { objectRef: 'config:theme', expectedFingerprint: await input.hasher.sha256(stableStringify({ theme: input.config.theme ?? null, titleLogo: resolveProjectTitleLogo(input.config) })) },
      { objectRef: 'config:portraits', expectedFingerprint: await input.hasher.sha256(stableStringify(projectPortraitOverrides(input.config))) },
    ],
  };
}

export async function buildVariableOperationCompositionDraft(input: {
  capabilityId?: 'variable.ensure' | 'variable.patch-initial';
  name: string; declaration: unknown; existing?: unknown; hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `variable:${input.name}`;
  const capabilityId = input.capabilityId ?? 'variable.ensure';
  const objectFingerprintAfter = await input.hasher.sha256(stableStringify(input.declaration));
  const objectFingerprintBefore = input.existing === undefined
    ? undefined
    : await input.hasher.sha256(stableStringify(input.existing));
  return {
    capabilityId, primaryObject, rawReferences: [],
    producedObjects: [{ objectRef: primaryObject, disposition: input.existing === undefined ? 'create' : 'update', finalFingerprint: objectFingerprintAfter }],
    ...(objectFingerprintBefore === undefined ? {} : { objectFingerprintBefore }),
    objectFingerprintAfter,
    ...(capabilityId === 'variable.patch-initial' && objectFingerprintBefore !== undefined
      ? { replayStatePreconditions: [{ objectRef: primaryObject, expectedFingerprint: objectFingerprintBefore }] }
      : {}),
  };
}

export async function buildCharacterOperationCompositionDraft(input: {
  capabilityId: 'character.ensure' | 'character.remove';
  id: string; beforeCharacter?: unknown; afterCharacter?: Record<string, unknown>;
  characters: Record<string, unknown>; charactersFingerprintBefore: string;
  migratedFiles?: Record<string, string>; workingFilesBefore?: Readonly<Record<string, string>>; hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `character:${input.id}`;
  const objectFingerprintAfter = input.afterCharacter === undefined ? undefined
    : await input.hasher.sha256(stableStringify(input.afterCharacter));
  const avatar = input.afterCharacter?.['avatar'];
  const migratedScenes = Object.entries(input.migratedFiles ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => {
    const id = sceneIdFromScenarioPath(path);
    resolveUniqueScenarioPath(input.workingFilesBefore!, id);
    return { path, text, objectRef: `scene:${id}` };
  });
  return {
    capabilityId: input.capabilityId, primaryObject,
    rawReferences: input.capabilityId === 'character.remove' ? [] : analyzeCharacterCompositionReferences({
      id: input.id, ...(typeof avatar === 'string' ? { avatar } : {}),
    }),
    replayStatePreconditions: [
      { objectRef: 'config:characters', expectedFingerprint: input.charactersFingerprintBefore },
      ...await Promise.all(migratedScenes.map(async ({ path, objectRef }) => ({
        objectRef,
        expectedFingerprint: await input.hasher.sha256(input.workingFilesBefore![path]!),
      }))),
    ],
    producedObjects: [
      input.capabilityId === 'character.remove' ? { objectRef: primaryObject, disposition: 'remove' }
        : { objectRef: primaryObject, disposition: input.beforeCharacter === undefined ? 'create' : 'update', finalFingerprint: objectFingerprintAfter! },
      { objectRef: 'config:characters', disposition: 'update', finalFingerprint: await input.hasher.sha256(stableStringify(input.characters)) },
      ...await Promise.all(migratedScenes.map(async ({ text, objectRef }) => ({
        objectRef,
        disposition: 'update' as const, finalFingerprint: await input.hasher.sha256(text),
      }))),
    ],
    ...(input.beforeCharacter === undefined ? {} : { objectFingerprintBefore: await input.hasher.sha256(stableStringify(input.beforeCharacter)) }),
    ...(objectFingerprintAfter === undefined ? {} : { objectFingerprintAfter }),
  };
}

export async function buildEntrySceneOperationCompositionDraft(input: {
  sceneId: string; beforeEntryScene: unknown; hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = 'config:entryScene';
  const objectFingerprintAfter = await input.hasher.sha256(stableStringify(input.sceneId));
  return {
    capabilityId: 'project.entry-scene.set', primaryObject,
    rawReferences: [{ kind: 'scene', scope: 'candidate-external', token: input.sceneId, objectRef: `scene:${input.sceneId}`, source: { path: 'game.config.json' } }],
    producedObjects: [{ objectRef: primaryObject, disposition: 'update', finalFingerprint: objectFingerprintAfter }],
    objectFingerprintBefore: await input.hasher.sha256(stableStringify(input.beforeEntryScene)),
    objectFingerprintAfter,
  };
}
