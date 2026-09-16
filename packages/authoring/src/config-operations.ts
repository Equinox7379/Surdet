import {
  AuthoringOperationError,
  runOperation,
  stableStringify,
  type ChangeSession,
} from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type {
  CharacterEnsureInput,
  CharacterRemoveInput,
  EntrySceneSetInput,
  LedgerDiffEntry,
} from './contracts.js';
import type { TextHasher } from './project-storage.js';
import { isValidSpeakerToken, parseSceneDocument, serializeSceneDocument } from './scene-document.js';
import { buildSpeakerCharacterRefs } from './object-index.js';
import { buildCharacterOperationCompositionDraft, buildEntrySceneOperationCompositionDraft } from './operation-composition-facts.js';
import type { CompositionOperation } from './composition-contracts.js';
import { resolveUniqueScenarioPath } from './scenario-identity.js';

const CONFIG_PATH = 'game.config.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export interface CharacterOperationResult {
  id: string;
  created?: boolean;
  removed?: boolean;
  objectRef: string;
  fingerprint: string;
  diffEntry: LedgerDiffEntry;
  /** display-name 改名时在同一事务内同步迁移的台词 speaker 引用。 */
  speakerMigrations?: SpeakerMigrationImpact[];
}

/** 一次 speaker 令牌迁移的机器可读证据（进入 operation ledger 的 potentialImpact）。 */
export interface SpeakerMigrationImpact {
  path: string;
  line: number;
  from: string;
  to: string;
}

/**
 * display-name 改名的 speaker 引用迁移：只修改解析后 speaker 字段精确等于 from 的
 * 台词行（结构化 token 替换，非全文替换），value/缩进/EOL/其余行字节保持不变。
 */
function migrateSceneSpeakerTokens(
  text: string,
  from: string,
  to: string,
  path: string,
): { text: string; impacts: SpeakerMigrationImpact[] } | null {
  const document = parseSceneDocument(text);
  const impacts: SpeakerMigrationImpact[] = [];
  let touched = false;
  for (let index = 0; index < document.length; index++) {
    const line = document[index]!;
    if (line.kind !== 'text' || line.speaker !== from) continue;
    const indent = line.raw.slice(0, line.raw.length - line.raw.trimStart().length);
    line.raw = `${indent}${to}${line.sep}${line.raw.slice(indent.length + from.length + line.sep.length)}`;
    touched = true;
    impacts.push({ path, line: index + 1, from, to });
  }
  if (!touched) return null;
  return { text: serializeSceneDocument(document), impacts };
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
  sealedOperation?: Pick<CompositionOperation, 'producedObjects' | 'replayStateRequirements'>,
): Promise<CharacterOperationResult> {
  return runOperation<CharacterOperationResult>(change, input, async (record) => {
    if (!validCharacterId(input.id)) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `角色 ID 非法：${input.id}`);
    }
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new AuthoringOperationError('VALIDATION_FAILED', '角色 name 必须是非空字符串');
    }
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseProjectConfigDocument(source);
    const charactersValue = config['characters'];
    if (charactersValue !== undefined && !isRecord(charactersValue)) {
      throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json.characters 必须是对象');
    }
    const characters = { ...(charactersValue as Record<string, unknown> | undefined) };
    const fingerprintBefore = await charactersFingerprint(config, hasher);
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', `characters 指纹不匹配：${input.id}`);
    }
    const hasExisting = Object.prototype.hasOwnProperty.call(characters, input.id);
    const existing = hasExisting ? characters[input.id] : undefined;
    const created = !hasExisting;
    const existingRecord = existing !== undefined && isRecord(existing) ? existing : null;
    const existingName = existingRecord !== null && typeof existingRecord['name'] === 'string' ? existingRecord['name'] : undefined;
    const nameChanges = existingName !== input.name;
    // 与 object-index speaker 解析契约一致的 canonical token（trim 后）；只用于语义判定，不格式化磁盘值。
    const oldSpeakerToken = existingName !== undefined ? existingName.trim() : undefined;
    const newSpeakerKey = input.name.trim();

    // 语义冲突前置检查（任何写入之前 fail-loud）：新显示名不得与其它角色的显示名或 ID
    // 冲突——任一情况都会让 speaker 令牌解析产生歧义或静默失配（比较用 trim 语义）。
    if (nameChanges) {
      for (const [otherId, otherRaw] of Object.entries(characters)) {
        if (otherId === input.id) continue;
        if (otherId === newSpeakerKey) {
          throw new AuthoringOperationError('OBJECT_AMBIGUOUS', `新显示名 '${input.name}' 与角色 ID '${otherId}' 冲突（speaker 解析会产生歧义）`);
        }
        const otherRecord = isRecord(otherRaw) ? otherRaw : null;
        const otherName = otherRecord !== null && typeof otherRecord['name'] === 'string' ? otherRecord['name'] as string : undefined;
        if (otherName !== undefined && otherName.trim() === newSpeakerKey) {
          throw new AuthoringOperationError('OBJECT_AMBIGUOUS', `新显示名 '${input.name}' 与角色 '${otherId}' 的显示名冲突`);
        }
      }
    }

    // display-name 改名：同一事务内同步迁移 speaker 令牌精确等于旧显示名 canonical token 的台词行。
    // 迁移结果先落在本地（handler 任何失败都不得污染 record.workingFiles）。
    const speakerMigrations: SpeakerMigrationImpact[] = [];
    const migratedFiles: Record<string, string> = {};
    // Integration consumes only the sealed scene footprint; ordinary edits still scan all scenes.
    const sceneFiles: Array<[string, string]> = [];
    if (sealedOperation !== undefined) {
      for (const produced of sealedOperation.producedObjects) {
        if (!produced.objectRef.startsWith('scene:')) continue;
        const path = resolveUniqueScenarioPath(record.workingFiles, produced.objectRef.slice('scene:'.length));
        const requirements = (sealedOperation.replayStateRequirements ?? []).filter((item) => item.objectRef === produced.objectRef);
        const text = path === undefined ? undefined : record.workingFiles[path];
        if (produced.disposition !== 'update' || produced.finalFingerprint === undefined
          || requirements.length !== 1 || path === undefined || text === undefined
          || await hasher.sha256(text) !== requirements[0]!.expectedFingerprint) {
          throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `角色迁移场景前置条件不匹配：${produced.objectRef}`);
        }
        sceneFiles.push([path, text]);
      }
    } else if (!created && nameChanges && oldSpeakerToken !== undefined) {
      sceneFiles.push(...Object.entries(record.workingFiles).filter(([path]) => path.startsWith('content/scenario/') && path.toLowerCase().endsWith('.gal')));
    }
    if (!created && nameChanges && oldSpeakerToken !== undefined) {
      const speakerRefMap = buildSpeakerCharacterRefs(characters);
      const resolved = speakerRefMap.get(oldSpeakerToken);
      if (resolved === undefined && oldSpeakerToken !== input.id) {
        // 旧显示名不唯一（或被角色 ID 遮蔽）且被台词引用时无法证明归属，拒绝猜测。
        for (const [path, text] of sceneFiles) {
          if (parseSceneDocument(text).some((line) => line.kind === 'text' && line.speaker === oldSpeakerToken)) {
            throw new AuthoringOperationError('OBJECT_AMBIGUOUS', `旧显示名 '${existingName}' 不唯一且被 ${path} 引用，无法确定 speaker 归属`);
          }
        }
      } else if (resolved === `character:${input.id}` && oldSpeakerToken !== input.id) {
        // 旧显示名经 name 路径唯一解析到本角色：迁移本次场景范围内 speaker === canonical token 的台词。
        //（若旧显示名恰等于本角色 ID，则令牌走 ID 路径，改名后仍解析到本角色，无需迁移。）
        let referenceCount = 0;
        for (const [, text] of sceneFiles) {
          for (const line of parseSceneDocument(text)) {
            if (line.kind === 'text' && line.speaker === oldSpeakerToken) referenceCount += 1;
          }
        }
        if (referenceCount > 0) {
          // F1：存在需要迁移的显示名 speaker 引用时，新名字必须能作为当前 DSL 的合法
          // speaker token 表达（与 parser 同一语法源），否则 fail-loud、零改动。
          // 无引用时不对 display name 施加 speaker 语法限制（普通人名格式合法）。
          if (!isValidSpeakerToken(input.name)) {
            throw new AuthoringOperationError(
              'VALIDATION_FAILED',
              `角色 '${input.id}' 存在 ${referenceCount} 处按显示名解析的台词 speaker 引用，但新名字 '${input.name}' 无法作为 Surdet speaker token 表达（1-24 字符、不含空白与冒号，不能以 @ 或 // 开头）；请改用可表达的名字，或先手动迁移这些台词`,
            );
          }
          for (const [path, text] of sceneFiles) {
            const migrated = migrateSceneSpeakerTokens(text, oldSpeakerToken, input.name, path);
            if (migrated !== null) {
              migratedFiles[path] = migrated.text;
              speakerMigrations.push(...migrated.impacts);
            }
          }
        }
      }
    }

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
    const compositionDraft = await buildCharacterOperationCompositionDraft({
      capabilityId: 'character.ensure', id: input.id, beforeCharacter: existing,
      afterCharacter: next, characters, migratedFiles, hasher,
      charactersFingerprintBefore: fingerprintBefore, workingFilesBefore: record.workingFiles,
    });
    if (sealedOperation !== undefined) {
      const actual = [...compositionDraft.producedObjects].sort((a, b) => a.objectRef.localeCompare(b.objectRef));
      const expected = [...sealedOperation.producedObjects].sort((a, b) => a.objectRef.localeCompare(b.objectRef));
      if (stableStringify(actual) !== stableStringify(expected)) {
        throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `角色重放产物与封存范围或指纹不匹配：character:${input.id}`);
      }
    }
    return {
      compositionDraft,
      result: {
        id: input.id,
        ...(created ? { created: true } : {}),
        objectRef: `character:${input.id}`,
        fingerprint: fingerprintAfter,
        ...(speakerMigrations.length > 0 ? { speakerMigrations } : {}),
        diffEntry: {
          kind: 'config.character.ensure',
          operationId: input.operationId,
          ...(created ? {} : { objectBefore: `character:${input.id}` }),
          objectAfter: `character:${input.id}`,
          fingerprintBefore,
          fingerprintAfter,
          directChange: { path: CONFIG_PATH, character: input.id, created },
          potentialImpact: speakerMigrations,
          observedImpact: [],
        },
      },
      workingFiles: {
        ...record.workingFiles,
        ...migratedFiles,
        [CONFIG_PATH]: serializeProjectConfigDocument(config, source),
      },
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
    const config = parseProjectConfigDocument(source);
    const charactersValue = config['characters'];
    if (charactersValue !== undefined && !isRecord(charactersValue)) {
      throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json.characters 必须是对象');
    }
    const characters = { ...(charactersValue as Record<string, unknown> | undefined) };
    const fingerprintBefore = await charactersFingerprint(config, hasher);
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', `characters 指纹不匹配：${input.id}`);
    }
    if (!Object.prototype.hasOwnProperty.call(characters, input.id)) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `角色不存在：${input.id}`);
    }
    const beforeCharacter = characters[input.id];
    delete characters[input.id];
    config['characters'] = characters;
    const fingerprintAfter = await charactersFingerprint(config, hasher);
    return {
      compositionDraft: await buildCharacterOperationCompositionDraft({
        capabilityId: 'character.remove', id: input.id, beforeCharacter, characters, hasher,
        charactersFingerprintBefore: fingerprintBefore,
      }),
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
      workingFiles: {
        ...record.workingFiles,
        [CONFIG_PATH]: serializeProjectConfigDocument(config, source),
      },
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
    const config = parseProjectConfigDocument(source);
    const fingerprintBefore = await entrySceneFingerprint(config, hasher);
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', 'entryScene 指纹不匹配');
    }
    const scenePath = resolveUniqueScenarioPath(record.workingFiles, input.sceneId);
    if (scenePath === undefined && (record.integration !== undefined || record.composition?.mode !== 'candidate')) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `入口场景不存在：${input.sceneId}`);
    }
    const beforeEntryScene = config['entryScene'];
    config['entryScene'] = input.sceneId;
    const fingerprintAfter = await entrySceneFingerprint(config, hasher);
    return {
      compositionDraft: await buildEntrySceneOperationCompositionDraft({ sceneId: input.sceneId, beforeEntryScene, hasher }),
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
      workingFiles: {
        ...record.workingFiles,
        [CONFIG_PATH]: serializeProjectConfigDocument(config, source),
      },
    };
  });
}

export type {
  CharacterEnsureInput,
  CharacterRemoveInput,
  EntrySceneSetInput,
} from './contracts.js';
