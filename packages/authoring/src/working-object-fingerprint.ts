import { AuthoringOperationError, stableStringify } from './change-session.js';
import { parseProjectConfigDocument } from './config-document.js';
import { timelinePathFor } from './timeline-operations.js';
import type { TextHasher } from './contracts.js';
import { resolveUniqueScenarioPath } from './scenario-identity.js';
import { GALLERY_PATH, readGalleryDocument } from './gallery-operations.js';

export type ComposableObjectRef =
  | `scene:${string}`
  | `timeline:${string}`
  | `variable:${string}`
  | `character:${string}`
  | `gallery:cgs:${string}`
  | 'config:characters'
  | 'config:entryScene';

export interface WorkingObjectFingerprintResult {
  objectRef: ComposableObjectRef;
  state: 'present' | 'absent';
  fingerprint: string;
}

function assertSafeSemanticId(id: string, objectRef: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) {
    throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `已声明产物的 semantic id 非法：${objectRef}`);
  }
  return id;
}

function objectMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseConfigObject(text: string | undefined): {
  variables: Record<string, unknown>;
  characters: Record<string, unknown>;
  entryScene: unknown;
} {
  const parsed = text === undefined || text.trim().length === 0
    ? {}
    : parseProjectConfigDocument(text);
  return {
    variables: objectMap(parsed['variables']),
    characters: objectMap(parsed['characters']),
    entryScene: parsed['entryScene'],
  };
}

/**
 * Six composable object kinds share one working-file fingerprint truth.
 * The resolver never infers an object from a diff or operation result.
 */
export async function fingerprintWorkingObject(
  workingFiles: Readonly<Record<string, string>>,
  objectRef: string,
  hasher: TextHasher,
): Promise<WorkingObjectFingerprintResult> {
  const present = async (value: unknown): Promise<WorkingObjectFingerprintResult> => ({
    objectRef: objectRef as ComposableObjectRef,
    state: 'present',
    fingerprint: await hasher.sha256(stableStringify({ objectRef, state: 'present', value })),
  });
  const absent = async (): Promise<WorkingObjectFingerprintResult> => ({
    objectRef: objectRef as ComposableObjectRef,
    state: 'absent',
    fingerprint: await hasher.sha256(stableStringify({ objectRef, state: 'absent' })),
  });

  if (objectRef.startsWith('scene:')) {
    const id = assertSafeSemanticId(objectRef.slice('scene:'.length), objectRef);
    const path = resolveUniqueScenarioPath(workingFiles, id);
    const text = path === undefined ? undefined : workingFiles[path];
    return text === undefined ? absent() : present(text);
  }
  if (objectRef.startsWith('timeline:')) {
    const id = assertSafeSemanticId(objectRef.slice('timeline:'.length), objectRef);
    const text = workingFiles[timelinePathFor(id)];
    if (text === undefined) return absent();
    try {
      return await present(JSON.parse(text.replace(/^\uFEFF/, '')));
    } catch (error) {
      throw new AuthoringOperationError(
        'COMPOSITION_REPLAY_FAILED',
        `时间轴对象无法解析：${objectRef}（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
  }

  if (objectRef.startsWith('gallery:cgs:')) {
    const id = objectRef.slice('gallery:cgs:'.length);
    const entry = readGalleryDocument(workingFiles[GALLERY_PATH]).cgs.find((item) => item.id === id);
    return entry === undefined ? absent() : present(entry);
  }

  const config = parseConfigObject(workingFiles['game.config.json']);
  if (objectRef.startsWith('variable:')) {
    const id = assertSafeSemanticId(objectRef.slice('variable:'.length), objectRef);
    return Object.prototype.hasOwnProperty.call(config.variables, id)
      ? present(config.variables[id])
      : absent();
  }
  if (objectRef.startsWith('character:')) {
    const id = assertSafeSemanticId(objectRef.slice('character:'.length), objectRef);
    return Object.prototype.hasOwnProperty.call(config.characters, id)
      ? present(config.characters[id])
      : absent();
  }
  if (objectRef === 'config:characters') return present(config.characters);
  if (objectRef === 'config:entryScene') return present(config.entryScene ?? null);
  throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `不支持的已声明产物：${objectRef}`);
}
