import { AuthoringOperationError, stableStringify } from './change-session.js';
import { parseProjectConfigDocument } from './config-document.js';
import { resolveUniqueTimelinePath } from './timeline-identity.js';
import type { TextHasher } from './contracts.js';
import { resolveUniqueScenarioPath } from './scenario-identity.js';
import { GALLERY_PATH, readGalleryDocument } from './gallery-operations.js';
import { projectPortraitOverrides, resolveProjectFontPaths, readGalleryReplayEntries, readGalleryEndings, readGalleryDossiers } from '@surdet/core';

export type ComposableObjectRef =
  | `scene:${string}`
  | `timeline:${string}`
  | `variable:${string}`
  | `character:${string}`
  | `gallery:cgs:${string}`
  | `gallery:texts:${string}`
  | `gallery:endings:${string}`
  | `gallery:profiles:${string}`
  | `gallery:terms:${string}`
  | 'config:characters'
  | 'config:fonts'
  | 'config:theme'
  | 'config:ui'
  | 'config:textCatalog'
  | 'config:terminology'
  | 'config:galleryPolicy'
  | 'config:galleryReplay'
  | 'config:galleryEndings'
  | 'config:galleryDossiers'
  | 'config:stage'
  | 'config:portraits'
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
 * Composable objects and configuration dependencies share one working-file fingerprint truth.
 * The resolver never infers an object from a diff or operation result.
 */
export async function fingerprintWorkingObject(
  workingFiles: Readonly<Record<string, string>>,
  objectRef: string,
  hasher: TextHasher,
): Promise<WorkingObjectFingerprintResult> {
  const content = readWorkingObject(workingFiles, objectRef);
  return { objectRef: objectRef as ComposableObjectRef, state: content.state,
    fingerprint: await hasher.sha256(stableStringify(content.state === 'absent'
      ? { objectRef, state: content.state } : { objectRef, state: content.state, value: content.value })) };
}

/** Manifest products hash raw scene text / JSON values, without plan identity wrappers. */
export async function fingerprintWorkingObjectValue(
  workingFiles: Readonly<Record<string, string>>, objectRef: string, hasher: TextHasher,
): Promise<string | undefined> {
  const content = readWorkingObject(workingFiles, objectRef);
  return content.state === 'absent' ? undefined : hasher.sha256(objectRef.startsWith('scene:')
    ? content.value as string : stableStringify(content.value));
}

function readWorkingObject(workingFiles: Readonly<Record<string, string>>, objectRef: string):
  { state: 'present'; value: unknown } | { state: 'absent' } {
  const present = (value: unknown) => ({ state: 'present' as const, value });
  const absent = () => ({ state: 'absent' as const });

  if (objectRef.startsWith('scene:')) {
    const id = assertSafeSemanticId(objectRef.slice('scene:'.length), objectRef);
    const path = resolveUniqueScenarioPath(workingFiles, id);
    const text = path === undefined ? undefined : workingFiles[path];
    return text === undefined ? absent() : present(text);
  }
  if (objectRef.startsWith('timeline:')) {
    const id = assertSafeSemanticId(objectRef.slice('timeline:'.length), objectRef);
    const path = resolveUniqueTimelinePath(workingFiles, id);
    const text = path === undefined ? undefined : workingFiles[path];
    if (text === undefined) return absent();
    try {
      return present(JSON.parse(text.replace(/^\uFEFF/, '')));
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
  if (objectRef.startsWith('gallery:texts:')) {
    const id = objectRef.slice('gallery:texts:'.length);
    const entry = readGalleryReplayEntries(readGalleryDocument(workingFiles[GALLERY_PATH]).document).find(item => item.id === id);
    return entry === undefined ? absent() : present(entry);
  }
  if (objectRef.startsWith('gallery:endings:')) {
    const entry = readGalleryEndings(readGalleryDocument(workingFiles[GALLERY_PATH]).document).find(item => item.id === objectRef.slice('gallery:endings:'.length));
    return entry === undefined ? absent() : present(entry);
  }
  if (objectRef.startsWith('gallery:profiles:') || objectRef.startsWith('gallery:terms:')) {
    const section = objectRef.startsWith('gallery:profiles:') ? 'profiles' : 'terms';
    const id = objectRef.slice(`gallery:${section}:`.length);
    const entry = readGalleryDossiers(readGalleryDocument(workingFiles[GALLERY_PATH]).document)[section].find(item => item.id === id);
    return entry === undefined ? absent() : present(entry);
  }
  const fullConfig = parseProjectConfigDocument(workingFiles['game.config.json'] ?? '{}');
  if (objectRef === 'config:stage') return present(fullConfig.stage ?? null);
  if (objectRef === 'config:theme') {
    const player = objectMap(fullConfig.player);
    return present({ theme: fullConfig.theme ?? null, titleLogo: player.titleLogo ?? null, titleBackground: player.titleBackground ?? null });
  }
  if (objectRef === 'config:ui') return present(fullConfig.ui ?? null);
  if (objectRef === 'config:textCatalog') return present(fullConfig.textCatalog ?? null);
  if (objectRef === 'config:terminology') return present(workingFiles['content/config/terminology.json'] ?? null);
  if (objectRef === 'config:galleryPolicy') return present(readGalleryDocument(workingFiles[GALLERY_PATH]).document.unlockPolicy ?? null);
  if (objectRef === 'config:galleryReplay') return present(readGalleryDocument(workingFiles[GALLERY_PATH]).document.texts ?? []);
  if (objectRef === 'config:galleryEndings') return present(readGalleryDocument(workingFiles[GALLERY_PATH]).document.endings ?? []);
  if (objectRef === 'config:galleryDossiers') { const gallery = readGalleryDocument(workingFiles[GALLERY_PATH]).document; return present({ profiles: gallery.profiles ?? [], terms: gallery.terms ?? [] }); }
  if (objectRef === 'config:fonts') return present(resolveProjectFontPaths(fullConfig));
  if (objectRef === 'config:portraits') return present(projectPortraitOverrides(fullConfig));
  if (objectRef.startsWith('variable:')) {
    const id = objectRef.slice('variable:'.length);
    return Object.prototype.hasOwnProperty.call(config.variables, id)
      ? present(config.variables[id])
      : absent();
  }
  if (objectRef.startsWith('character:')) {
    const id = objectRef.slice('character:'.length);
    return Object.prototype.hasOwnProperty.call(config.characters, id)
      ? present(config.characters[id])
      : absent();
  }
  if (objectRef === 'config:characters') return present(config.characters);
  if (objectRef === 'config:entryScene') return present(config.entryScene ?? null);
  throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `不支持的已声明产物：${objectRef}`);
}
