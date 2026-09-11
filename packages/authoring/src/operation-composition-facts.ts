import type { OperationCompositionDraft } from './composition-contracts.js';
import type { TextHasher } from './project-storage.js';
import { stableStringify } from './change-session.js';
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

export async function buildSceneOperationCompositionDraft(input: {
  capabilityId: 'scene.create' | 'scene.patch';
  sceneId: string;
  beforeText?: string;
  afterText: string;
  characters: Record<string, unknown>;
  hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `scene:${input.sceneId}`;
  const objectFingerprintAfter = await input.hasher.sha256(input.afterText);
  return {
    capabilityId: input.capabilityId, primaryObject,
    rawReferences: analyzeSceneCompositionReferences({
      sceneId: input.sceneId, path: `content/scenario/${input.sceneId}.gal`,
      text: input.afterText, characters: input.characters,
    }),
    producedObjects: [{ objectRef: primaryObject, disposition: input.capabilityId === 'scene.create' ? 'create' : 'update', finalFingerprint: objectFingerprintAfter }],
    ...(input.beforeText === undefined ? {} : { objectFingerprintBefore: await input.hasher.sha256(input.beforeText) }),
    objectFingerprintAfter,
    ...(input.beforeText === undefined ? {} : { replayStatePreconditions: [{ objectRef: primaryObject, expectedFingerprint: await input.hasher.sha256(input.beforeText) }] }),
  };
}

export async function buildTimelineOperationCompositionDraft(input: {
  capabilityId: 'timeline.create' | 'timeline.patch';
  timelineId: string;
  beforeDefinition?: unknown;
  afterDefinition: unknown;
  hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `timeline:${input.timelineId}`;
  const objectFingerprintAfter = await input.hasher.sha256(stableStringify(input.afterDefinition));
  return {
    capabilityId: input.capabilityId, primaryObject,
    rawReferences: analyzeTimelineCompositionReferences({
      timelineId: input.timelineId, path: `content/timelines/${input.timelineId}.json`, definition: input.afterDefinition,
    }),
    producedObjects: [{ objectRef: primaryObject, disposition: input.capabilityId === 'timeline.create' ? 'create' : 'update', finalFingerprint: objectFingerprintAfter }],
    ...(input.beforeDefinition === undefined ? {} : { objectFingerprintBefore: await input.hasher.sha256(stableStringify(input.beforeDefinition)) }),
    objectFingerprintAfter,
  };
}

export async function buildVariableOperationCompositionDraft(input: {
  name: string; declaration: unknown; existing?: unknown; hasher: TextHasher;
}): Promise<OperationCompositionDraft> {
  const primaryObject = `variable:${input.name}`;
  const objectFingerprintAfter = await input.hasher.sha256(stableStringify(input.declaration));
  return {
    capabilityId: 'variable.ensure', primaryObject, rawReferences: [],
    producedObjects: [{ objectRef: primaryObject, disposition: input.existing === undefined ? 'create' : 'update', finalFingerprint: objectFingerprintAfter }],
    ...(input.existing === undefined ? {} : { objectFingerprintBefore: await input.hasher.sha256(stableStringify(input.existing)) }),
    objectFingerprintAfter,
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
  return {
    capabilityId: input.capabilityId, primaryObject,
    rawReferences: input.capabilityId === 'character.remove' ? [] : analyzeCharacterCompositionReferences({
      id: input.id, ...(typeof avatar === 'string' ? { avatar } : {}),
    }),
    replayStatePreconditions: [
      { objectRef: 'config:characters', expectedFingerprint: input.charactersFingerprintBefore },
      ...await Promise.all(Object.keys(input.migratedFiles ?? {}).sort().map(async (path) => ({
        objectRef: `scene:${path.slice('content/scenario/'.length, -'.gal'.length)}`,
        expectedFingerprint: await input.hasher.sha256(input.workingFilesBefore![path]!),
      }))),
    ],
    producedObjects: [
      input.capabilityId === 'character.remove' ? { objectRef: primaryObject, disposition: 'remove' }
        : { objectRef: primaryObject, disposition: input.beforeCharacter === undefined ? 'create' : 'update', finalFingerprint: objectFingerprintAfter! },
      { objectRef: 'config:characters', disposition: 'update', finalFingerprint: await input.hasher.sha256(stableStringify(input.characters)) },
      ...await Promise.all(Object.entries(input.migratedFiles ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(async ([path, text]) => ({
        objectRef: `scene:${path.slice('content/scenario/'.length, -'.gal'.length)}`,
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
