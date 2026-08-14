import {
  AuthoringOperationError,
  runOperation,
  stableStringify,
  type ChangeSession,
} from './change-session.js';
import type {
  CharacterEnsureInput,
  CharacterRemoveInput,
  EntrySceneSetInput,
  LedgerDiffEntry,
} from './contracts.js';
import type { TextHasher } from './project-storage.js';

const CONFIG_PATH = 'game.config.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfig(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new AuthoringOperationError('PROJECT_INVALID', `game.config.json 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json 必须是 JSON 对象');
  return parsed;
}

function serializeConfig(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** 角色表（characters 字段）规范化 JSON 片段指纹；缺失时按空对象。 */
export async function charactersFingerprint(config: Record<string, unknown>, hasher: TextHasher): Promise<string> {
  const characters = config['characters'];
  const table = isRecord(characters) ? characters : {};
  return hasher.sha256(stableStringify(table));
}

/** entryScene 字段规范化 JSON 片段指纹；缺失时按 undefined。 */
export async function entrySceneFingerprint(config: Record<string, unknown>, hasher: TextHasher): Promise<string> {
  return hasher.sha256(stableStringify(config['entryScene']));
}

function validCharacterId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id);
}

function workingScenes(record: { workingFiles: Record<string, string> }): Set<string> {
  const scenes = new Set<string>();
  for (const filePath of Object.keys(record.workingFiles)) {
    if (!filePath.startsWith('content/scenario/') || !filePath.endsWith('.gal')) continue;
    const base = filePath.slice('content/scenario/'.length, -'.gal'.length);
    scenes.add(base);
  }
  return scenes;
}

export interface CharacterOperationResult {
  id: string;
  created?: boolean;
  removed?: boolean;
  objectRef: string;
  fingerprint: string;
  diffEntry: LedgerDiffEntry;
}

export interface EntrySceneSetResult {
  sceneId: string;
  entryScene: string;
  fingerprint: string;
  diffEntry: LedgerDiffEntry;
}

export async function applyCharacterEnsure(
  change: ChangeSession,
  input: CharacterEnsureInput,
  hasher: TextHasher,
): Promise<CharacterOperationResult> {
  return runOperation<CharacterOperationResult>(change, input, async (record) => {
    if (!validCharacterId(input.id)) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `角色 ID 非法：${input.id}`);
    }
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new AuthoringOperationError('VALIDATION_FAILED', '角色 name 必须是非空字符串');
    }
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseConfig(source);
    const charactersValue = config['characters'];
    if (charactersValue !== undefined && !isRecord(charactersValue)) {
      throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json.characters 必须是对象');
    }
    const characters = { ...(charactersValue as Record<string, unknown> | undefined) };
    const fingerprintBefore = await charactersFingerprint(config, hasher);
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', `characters 指纹不匹配：${input.id}`);
    }
    const existing = characters[input.id];
    const created = existing === undefined;
    const next: Record<string, unknown> = {};
    if (existing !== undefined && isRecord(existing)) Object.assign(next, existing);
    next['name'] = input.name;
    if (input.avatar === undefined) {
      // 保留原 avatar（新增角色时自然没有）。
    } else if (input.avatar === null) {
      delete next['avatar'];
    } else if (typeof input.avatar === 'string' && input.avatar.trim().length > 0) {
      next['avatar'] = input.avatar;
    } else {
      throw new AuthoringOperationError('VALIDATION_FAILED', `角色 avatar 非法：${String(input.avatar)}`);
    }
    characters[input.id] = next;
    config['characters'] = characters;
    const fingerprintAfter = await charactersFingerprint(config, hasher);
    return {
      result: {
        id: input.id,
        ...(created ? { created: true } : {}),
        objectRef: `character:${input.id}`,
        fingerprint: fingerprintAfter,
        diffEntry: {
          kind: 'config.character.ensure',
          operationId: input.operationId,
          ...(created ? {} : { objectBefore: `character:${input.id}` }),
          objectAfter: `character:${input.id}`,
          fingerprintBefore,
          fingerprintAfter,
          directChange: { path: CONFIG_PATH, character: input.id, created },
          potentialImpact: [],
          observedImpact: [],
        },
      },
      workingFiles: { ...record.workingFiles, [CONFIG_PATH]: serializeConfig(config) },
    };
  });
}

export async function applyCharacterRemove(
  change: ChangeSession,
  input: CharacterRemoveInput,
  hasher: TextHasher,
): Promise<CharacterOperationResult> {
  return runOperation<CharacterOperationResult>(change, input, async (record) => {
    if (!validCharacterId(input.id)) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `角色 ID 非法：${input.id}`);
    }
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseConfig(source);
    const charactersValue = config['characters'];
    if (charactersValue !== undefined && !isRecord(charactersValue)) {
      throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json.characters 必须是对象');
    }
    const characters = { ...(charactersValue as Record<string, unknown> | undefined) };
    const fingerprintBefore = await charactersFingerprint(config, hasher);
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', `characters 指纹不匹配：${input.id}`);
    }
    if (characters[input.id] === undefined) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `角色不存在：${input.id}`);
    }
    delete characters[input.id];
    config['characters'] = characters;
    const fingerprintAfter = await charactersFingerprint(config, hasher);
    return {
      result: {
        id: input.id,
        removed: true,
        objectRef: `character:${input.id}`,
        fingerprint: fingerprintAfter,
        diffEntry: {
          kind: 'config.character.remove',
          operationId: input.operationId,
          objectBefore: `character:${input.id}`,
          fingerprintBefore,
          fingerprintAfter,
          directChange: { path: CONFIG_PATH, character: input.id, removed: true },
          potentialImpact: [],
          observedImpact: [],
        },
      },
      workingFiles: { ...record.workingFiles, [CONFIG_PATH]: serializeConfig(config) },
    };
  });
}

export async function applyEntrySceneSet(
  change: ChangeSession,
  input: EntrySceneSetInput,
  hasher: TextHasher,
): Promise<EntrySceneSetResult> {
  return runOperation<EntrySceneSetResult>(change, input, async (record) => {
    // 并发保护优先：指纹不符（OBJECT_REF_STALE）先于业务校验（场景存在性）。
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseConfig(source);
    const fingerprintBefore = await entrySceneFingerprint(config, hasher);
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', 'entryScene 指纹不匹配');
    }
    const scenes = workingScenes(record);
    if (!scenes.has(input.sceneId)) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `入口场景不存在：${input.sceneId}`);
    }
    config['entryScene'] = input.sceneId;
    const fingerprintAfter = await entrySceneFingerprint(config, hasher);
    return {
      result: {
        sceneId: input.sceneId,
        entryScene: input.sceneId,
        fingerprint: fingerprintAfter,
        diffEntry: {
          kind: 'config.entry-scene.set',
          operationId: input.operationId,
          objectAfter: `scene:${input.sceneId}`,
          fingerprintBefore,
          fingerprintAfter,
          directChange: { path: CONFIG_PATH, entryScene: input.sceneId },
          potentialImpact: [],
          observedImpact: [],
        },
      },
      workingFiles: { ...record.workingFiles, [CONFIG_PATH]: serializeConfig(config) },
    };
  });
}

export type {
  CharacterEnsureInput,
  CharacterRemoveInput,
  EntrySceneSetInput,
} from './contracts.js';
