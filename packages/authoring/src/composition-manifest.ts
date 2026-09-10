import { AuthoringOperationError, stableStringify } from './change-session.js';
import type { ChangeRecord, SceneDocumentLine, TextHasher } from './contracts.js';
import type { ChangeDiff } from './diff.js';
import { buildSpeakerCharacterRefs } from './object-index.js';
import { parseSceneDocument, splitInstruction } from './scene-document.js';
import {
  COMPOSABLE_CAPABILITY_IDS,
  type ComposableCapabilityId,
  type CompositionIneligibility,
  type CompositionManifest,
  type CompositionOperation,
  type ManifestObjectFacts,
  type ObjectProduction,
  type ObjectRequirement,
  type OperationInvocationFact,
} from './composition-contracts.js';

type SemanticEntry = ChangeDiff['semantic'][number];

const CONFIG_PATH = 'game.config.json';
const SCENE_INSTRUCTION_VARIABLES = new Set(['set', 'mod', 'inc', 'dec', 'toggle', 'flag', 'unflag']);
const JUMP_LIKE_INSTRUCTIONS = new Set(['jump', 'call']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringAt(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function scenePath(sceneId: string): string {
  return `content/scenario/${sceneId}.gal`;
}

function timelinePath(timelineId: string): string {
  return `content/timelines/${timelineId}.json`;
}

function readWorkingJson(record: ChangeRecord, filePath: string): Record<string, unknown> | undefined {
  const text = record.workingFiles[filePath];
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 台词 speaker（角色 ID 或显示名）到 character ref 的唯一解析表；characters 表缺失时为空。 */
function workingSpeakerRefs(record: ChangeRecord): Map<string, string> {
  const config = readWorkingJson(record, CONFIG_PATH);
  const characters = config === undefined ? {} : (isRecord(config['characters']) ? config['characters'] : {});
  return buildSpeakerCharacterRefs(characters);
}

function baseFingerprint(objectFacts: ManifestObjectFacts, objectRef: string): string | undefined {
  return objectFacts.baseObjects.find((object) => object.objectRef === objectRef)?.fingerprint;
}

function baseHas(objectFacts: ManifestObjectFacts, objectRef: string): boolean {
  return objectFacts.baseObjects.some((object) => object.objectRef === objectRef);
}

interface ResolvedRequirement {
  requirement: ObjectRequirement;
}

/**
 * 把一个引用解析为显式来源的 requirement：base 对象、或本候选更早 operation 的产物。
 * 两边都找不到时返回 undefined —— 调用方必须把整个 manifest 标记为 unavailable，
 * 不允许输出依赖身份缺失的半真 manifest。
 */
function resolveRequirement(
  objectRef: string,
  objectFacts: ManifestObjectFacts,
  sealedOperations: readonly CompositionOperation[],
): ResolvedRequirement | undefined {
  if (baseHas(objectFacts, objectRef)) {
    const fingerprint = baseFingerprint(objectFacts, objectRef);
    return {
      requirement: {
        objectRef,
        source: 'base',
        ...(fingerprint === undefined ? {} : { expectedFingerprint: fingerprint }),
      },
    };
  }
  for (const operation of sealedOperations) {
    const produced = operation.producedObjects.find((item) => item.objectRef === objectRef);
    if (produced !== undefined) {
      return {
        requirement: {
          objectRef,
          source: 'candidate',
          candidateOperationSequence: operation.sequence,
          ...(produced.finalFingerprint === undefined ? {} : { expectedFingerprint: produced.finalFingerprint }),
        },
      };
    }
  }
  return undefined;
}

async function resolveRequirements(
  refs: readonly string[],
  objectFacts: ManifestObjectFacts,
  sealedOperations: readonly CompositionOperation[],
): Promise<ObjectRequirement[] | undefined> {
  const requirements: ObjectRequirement[] = [];
  for (const objectRef of [...new Set(refs)]) {
    const resolved = resolveRequirement(objectRef, objectFacts, sealedOperations);
    if (resolved === undefined) return undefined;
    requirements.push(resolved.requirement);
  }
  return requirements;
}

function sceneBlockRefs(blocks: readonly unknown[], speakerRefs: Map<string, string>): string[] {
  const refs: string[] = [];
  for (const rawBlock of blocks) {
    if (!isRecord(rawBlock)) continue;
    const kind = rawBlock['kind'];
    if (kind === 'text') {
      const speaker = typeof rawBlock['speaker'] === 'string' ? rawBlock['speaker'].trim() : '';
      const characterRef = speaker.length > 0 ? speakerRefs.get(speaker) : undefined;
      if (characterRef !== undefined) refs.push(characterRef);
      continue;
    }
    if (kind === 'instruction') {
      const name = stringAt(rawBlock, 'name');
      const args = asArray(rawBlock['args']).map((arg) => (typeof arg === 'string' ? arg : ''));
      if (name === undefined || args.length === 0) continue;
      if (name === 'timeline' && !args[0]!.startsWith('@')) refs.push(`timeline:${args[0]}`);
      else if (JUMP_LIKE_INSTRUCTIONS.has(name)) {
        const targetScene = args.join(' ').split('.')[0] ?? '';
        if (targetScene.length > 0) refs.push(`scene:${targetScene}`);
      } else if (SCENE_INSTRUCTION_VARIABLES.has(name) && args[0]!.length > 0) {
        refs.push(`variable:${args[0]}`);
      }
      continue;
    }
    if (kind === 'choice') {
      for (const rawOption of asArray(rawBlock['options'])) {
        if (!isRecord(rawOption)) continue;
        const when = typeof rawOption['when'] === 'string' ? rawOption['when'] : '';
        const variableMatch = /^\[if:([^\]]+)\]/.exec(when.trim());
        if (variableMatch !== null && variableMatch[1]!.length > 0) refs.push(`variable:${variableMatch[1]}`);
        const target = rawOption['target'];
        if (isRecord(target) && target['kind'] === 'scene' && typeof target['value'] === 'string' && target['value'].length > 0) {
          refs.push(`scene:${target['value'].split('.')[0]}`);
        }
      }
    }
  }
  return refs;
}

function sceneDocumentRefs(document: readonly SceneDocumentLine[], speakerRefs: Map<string, string>): string[] {
  const refs: string[] = [];
  for (const line of document) {
    if (line.kind === 'text') {
      const speaker = line.speaker.trim();
      const characterRef = speaker.length > 0 ? speakerRefs.get(speaker) : undefined;
      if (characterRef !== undefined) refs.push(characterRef);
      continue;
    }
    if (line.kind === 'instr' && line.name !== 'choice') {
      const { name, args } = splitInstruction(line.raw);
      if (name === 'timeline' && args.length > 0 && !args[0]!.startsWith('@')) refs.push(`timeline:${args[0]}`);
      else if (JUMP_LIKE_INSTRUCTIONS.has(name)) {
        const targetScene = args.join(' ').split('.')[0] ?? '';
        if (targetScene.length > 0) refs.push(`scene:${targetScene}`);
      } else if (SCENE_INSTRUCTION_VARIABLES.has(name) && args[0] !== undefined && args[0].length > 0) {
        refs.push(`variable:${args[0]}`);
      }
      continue;
    }
    if (line.kind === 'choice-option') {
      const variableMatch = /^\s*\[if:([^\]]+)\]/.exec(line.raw.slice(line.raw.indexOf('[')));
      if (variableMatch !== null && variableMatch[1]!.length > 0) refs.push(`variable:${variableMatch[1]}`);
    }
  }
  return refs;
}

function timelineAssetRefs(definition: Record<string, unknown>): string[] {
  const refs: string[] = [];
  for (const rawTrack of asArray(definition['tracks'])) {
    if (!isRecord(rawTrack)) continue;
    const trackKind = stringAt(rawTrack, 'kind');
    const target = stringAt(rawTrack, 'target');
    for (const rawCue of asArray(rawTrack['cues'])) {
      if (!isRecord(rawCue)) continue;
      const action = stringAt(rawCue, 'action');
      if (trackKind === 'background' && action === 'set' && stringAt(rawCue, 'key') !== undefined) {
        refs.push(`asset:bg:${rawCue['key']}`);
        continue;
      }
      if (trackKind === 'portrait' && (action === 'show' || action === 'expression')
        && target !== undefined && stringAt(rawCue, 'expression') !== undefined) {
        const [role, outfit = ''] = target.split(':');
        if (role !== undefined && role.length > 0 && outfit.length > 0) {
          refs.push(`asset:portrait:${role}:${outfit}:${rawCue['expression']}`);
        }
      }
    }
  }
  return refs;
}

interface CapabilityFactInput {
  capabilityId: ComposableCapabilityId;
  normalizedInput: Record<string, unknown>;
  record: ChangeRecord;
  sequence: number;
  sealedOperations: readonly CompositionOperation[];
  semanticDiff: readonly SemanticEntry[];
  objectFacts: ManifestObjectFacts;
  hasher: TextHasher;
}

type CapabilityFactResult =
  | {
    ok: true;
    primaryObject: string;
    requiredObjects: ObjectRequirement[];
    producedObjects: ObjectProduction[];
    fingerprintBefore?: string;
    fingerprintAfter?: string;
  }
  | { ok: false; code: CompositionIneligibility['code']; message: string };

function diffEntryFor(semanticDiff: readonly SemanticEntry[], operationId: string): SemanticEntry | undefined {
  return semanticDiff.find((entry) => entry.operationId === operationId);
}

async function buildCapabilityFact(input: CapabilityFactInput): Promise<CapabilityFactResult> {
  const { capabilityId, normalizedInput, record, sequence, sealedOperations, semanticDiff, objectFacts, hasher } = input;
  const unavailable = (code: CompositionIneligibility['code'], message: string): CapabilityFactResult => ({ ok: false, code, message });
  const sha256Text = async (text: string) => hasher.sha256(text);

  switch (capabilityId) {
    case 'scene.create':
    case 'scene.patch': {
      const sceneId = stringAt(normalizedInput, 'sceneId');
      if (sceneId === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `scene 输入缺少合法 sceneId（operation sequence ${sequence}）`);
      const text = record.workingFiles[scenePath(sceneId)];
      if (text === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `场景工作区文本不存在：${scenePath(sceneId)}`);
      const primaryObject = `scene:${sceneId}`;
      const disposition = baseHas(objectFacts, primaryObject) ? 'update' : 'create';
      const producedObjects: ObjectProduction[] = [
        { objectRef: primaryObject, disposition, finalFingerprint: await sha256Text(text) },
      ];
      const diffEntry = diffEntryFor(semanticDiff, String(normalizedInput['operationId']));
      const speakerRefs = workingSpeakerRefs(record);
      const document = parseSceneDocument(text);
      const refs = capabilityId === 'scene.create'
        ? sceneBlockRefs(asArray(normalizedInput['blocks']), speakerRefs)
        : sceneDocumentRefs(document, speakerRefs);
      const requiredObjects = await resolveRequirements(refs, objectFacts, sealedOperations);
      if (requiredObjects === undefined) {
        const missing = [...new Set(refs)].filter((ref) => resolveRequirement(ref, objectFacts, sealedOperations) === undefined);
        return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `场景 ${primaryObject} 的依赖未在基线或更早操作中建立身份：${missing.join(', ')}。形成可组合候选时应先创建被引用对象，或先创建空场景，再用 scene.patch 填入跨场景内容。`);
      }
      return {
        ok: true,
        primaryObject,
        requiredObjects,
        producedObjects,
        ...(diffEntry?.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
        ...(diffEntry?.fingerprintAfter === undefined ? {} : { fingerprintAfter: diffEntry.fingerprintAfter }),
      };
    }

    case 'variable.ensure': {
      const name = stringAt(normalizedInput, 'name');
      if (name === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `变量输入缺少合法 name（operation sequence ${sequence}）`);
      const config = readWorkingJson(record, CONFIG_PATH);
      const variables = config === undefined ? undefined : (isRecord(config['variables']) ? config['variables'] : undefined);
      const declaration = variables?.[name];
      if (declaration === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `变量声明无法从工作区读取：${name}`);
      const primaryObject = `variable:${name}`;
      const producedObjects: ObjectProduction[] = [{
        objectRef: primaryObject,
        disposition: baseHas(objectFacts, primaryObject) ? 'update' : 'create',
        finalFingerprint: await sha256Text(stableStringify(declaration)),
      }];
      const diffEntry = diffEntryFor(semanticDiff, String(normalizedInput['operationId']));
      return {
        ok: true,
        primaryObject,
        requiredObjects: [],
        producedObjects,
        ...(diffEntry?.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
        ...(diffEntry?.fingerprintAfter === undefined ? {} : { fingerprintAfter: diffEntry.fingerprintAfter }),
      };
    }

    case 'character.ensure':
    case 'character.remove': {
      const id = stringAt(normalizedInput, 'id');
      if (id === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `角色输入缺少合法 id（operation sequence ${sequence}）`);
      const config = readWorkingJson(record, CONFIG_PATH);
      if (config === undefined || !isRecord(config['characters'])) {
        return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `角色表无法从工作区读取（operation sequence ${sequence}）`);
      }
      const characters = config['characters'];
      const tableFingerprint = await sha256Text(stableStringify(characters));
      const primaryObject = `character:${id}`;
      const producedObjects: ObjectProduction[] = [{ objectRef: 'config:characters', disposition: 'update', finalFingerprint: tableFingerprint }];
      let fingerprintBefore: string | undefined;
      let fingerprintAfter: string | undefined;
      if (capabilityId === 'character.ensure') {
        const declaration = characters[id];
        if (declaration === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `角色声明无法从工作区读取：${id}`);
        fingerprintAfter = await sha256Text(stableStringify(declaration));
        producedObjects.unshift({
          objectRef: primaryObject,
          disposition: baseHas(objectFacts, primaryObject) ? 'update' : 'create',
          finalFingerprint: fingerprintAfter,
        });
        const avatar = isRecord(declaration) ? stringAt(declaration, 'avatar') : undefined;
        const refs: string[] = [];
        if (avatar !== undefined) refs.push(`asset:avatar:${avatar}`);
        // display-name 改名在同一事务内迁移的台词场景也是 update 产物。
        const result = isRecord(record.operations[String(normalizedInput['operationId'])]?.result)
          ? record.operations[String(normalizedInput['operationId'])]!.result as Record<string, unknown>
          : undefined;
        const migratedPaths = new Set<string>();
        for (const migration of asArray(result?.['speakerMigrations'])) {
          if (!isRecord(migration) || typeof migration['path'] !== 'string') continue;
          migratedPaths.add(migration['path']);
        }
        for (const path of migratedPaths) {
          const sceneText = record.workingFiles[path];
          if (sceneText === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `speaker 迁移场景不存在：${path}`);
          const sceneId = path.startsWith('content/scenario/') && path.endsWith('.gal')
            ? path.slice('content/scenario/'.length, -'.gal'.length)
            : undefined;
          if (sceneId === undefined) continue;
          producedObjects.push({ objectRef: `scene:${sceneId}`, disposition: 'update', finalFingerprint: await sha256Text(sceneText) });
        }
        const requiredObjects = await resolveRequirements(refs, objectFacts, sealedOperations);
        if (requiredObjects === undefined) {
          return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `头像资源无法建立身份：character:${id}`);
        }
        const diffEntry = diffEntryFor(semanticDiff, String(normalizedInput['operationId']));
        return {
          ok: true,
          primaryObject,
          requiredObjects,
          producedObjects,
          ...(diffEntry?.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
        };
      }
      // character.remove
      if (baseHas(objectFacts, primaryObject) === false && sealedOperations.some((operation) => operation.producedObjects.some((item) => item.objectRef === primaryObject)) === false) {
        return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `被移除角色不在基线或更早操作中：${id}`);
      }
      producedObjects.unshift({ objectRef: primaryObject, disposition: 'remove' });
      const diffEntry = diffEntryFor(semanticDiff, String(normalizedInput['operationId']));
      return {
        ok: true,
        primaryObject,
        requiredObjects: [],
        producedObjects,
        ...(diffEntry?.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
      };
    }

    case 'timeline.create':
    case 'timeline.patch': {
      const timelineId = stringAt(normalizedInput, 'timelineId');
      if (timelineId === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `时间轴输入缺少合法 timelineId（operation sequence ${sequence}）`);
      const path = timelinePath(timelineId);
      const definition = readWorkingJson(record, path);
      if (definition === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `时间轴定义无法从工作区读取：${path}`);
      const primaryObject = `timeline:${timelineId}`;
      const disposition = capabilityId === 'timeline.create'
        ? (baseHas(objectFacts, primaryObject) ? 'update' : 'create')
        : 'update';
      const fingerprintAfter = await sha256Text(stableStringify(definition));
      const requiredObjects = await resolveRequirements(timelineAssetRefs(definition), objectFacts, sealedOperations);
      if (requiredObjects === undefined) {
        const missing = [...new Set(timelineAssetRefs(definition))].filter((ref) => resolveRequirement(ref, objectFacts, sealedOperations) === undefined);
        return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `时间轴 ${primaryObject} 的资源引用无法建立身份：${missing.join(', ')}。请用 project.assets 核对这些资源是否存在并已解析。`);
      }
      const diffEntry = diffEntryFor(semanticDiff, String(normalizedInput['operationId']));
      return {
        ok: true,
        primaryObject,
        requiredObjects,
        producedObjects: [{ objectRef: primaryObject, disposition, finalFingerprint: fingerprintAfter }],
        ...(diffEntry?.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
        ...(diffEntry?.fingerprintAfter === undefined ? {} : { fingerprintAfter: diffEntry.fingerprintAfter }),
      };
    }

    case 'project.entry-scene.set': {
      const sceneId = stringAt(normalizedInput, 'sceneId');
      if (sceneId === undefined) return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `入口输入缺少合法 sceneId（operation sequence ${sequence}）`);
      const config = readWorkingJson(record, CONFIG_PATH);
      const entryScene = config === undefined ? undefined : stringAt(config, 'entryScene');
      if (entryScene !== sceneId) {
        return unavailable('OBJECT_IDENTITY_UNAVAILABLE', `入口场景与工作区不一致：期望 ${sceneId}，实际 ${entryScene ?? '(missing)'}`);
      }
      const requiredObjects = await resolveRequirements([`scene:${sceneId}`], objectFacts, sealedOperations);
      if (requiredObjects === undefined) {
        return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `入口场景无法建立身份：scene:${sceneId}`);
      }
      const diffEntry = diffEntryFor(semanticDiff, String(normalizedInput['operationId']));
      return {
        ok: true,
        primaryObject: 'config:entryScene',
        requiredObjects,
        producedObjects: [{
          objectRef: 'config:entryScene',
          disposition: 'update',
          finalFingerprint: await sha256Text(stableStringify(entryScene)),
        }],
        ...(diffEntry?.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
        ...(diffEntry?.fingerprintAfter === undefined ? {} : { fingerprintAfter: diffEntry.fingerprintAfter }),
      };
    }
  }
}

export interface BuildCompositionManifestInput {
  record: ChangeRecord;
  projectIdentity: string;
  invocationFacts: OperationInvocationFact[];
  semanticDiff: ChangeDiff['semantic'];
  objectFacts: ManifestObjectFacts;
}

export async function buildCompositionManifest(
  input: BuildCompositionManifestInput,
  hasher: TextHasher,
): Promise<
  | { eligibility: 'ready'; reasons: []; manifest: CompositionManifest }
  | { eligibility: 'unavailable'; reasons: CompositionIneligibility[] }
> {
  const reasons: CompositionIneligibility[] = [];
  const operations: CompositionOperation[] = [];
  const entries = Object.entries(input.record.operations);

  for (let sequence = 0; sequence < entries.length; sequence += 1) {
    const [sourceOperationId, recorded] = entries[sequence]!;
    if (recorded.normalizedInput === undefined) {
      reasons.push({
        code: 'MISSING_NORMALIZED_INPUT',
        operationId: sourceOperationId,
        message: `旧记录缺少规范化输入，不能进入确定性重放：${sourceOperationId}`,
      });
      break;
    }
    const normalized = recorded.normalizedInput;
    if (!isRecord(normalized) || normalized['operationId'] !== sourceOperationId) {
      reasons.push({
        code: 'OBJECT_IDENTITY_UNAVAILABLE',
        operationId: sourceOperationId,
        message: `normalizedInput.operationId 与 ledger key 不一致：${sourceOperationId}`,
      });
      break;
    }
    if (stableStringify(normalized) !== recorded.requestHash) {
      reasons.push({
        code: 'OBJECT_IDENTITY_UNAVAILABLE',
        operationId: sourceOperationId,
        message: `requestHash 与 stableStringify(normalizedInput) 不一致：${sourceOperationId}`,
      });
      break;
    }

    const successFacts = input.invocationFacts.filter((fact) => fact.ok && fact.operationId === sourceOperationId);
    if (successFacts.length === 0) {
      reasons.push({
        code: 'INVOCATION_FACT_MISSING',
        operationId: sourceOperationId,
        message: `缺少唯一成功 invocation fact：${sourceOperationId}`,
      });
      break;
    }
    if (successFacts.length > 1) {
      reasons.push({
        code: 'INVOCATION_FACT_AMBIGUOUS',
        operationId: sourceOperationId,
        message: `同一 operationId 存在多个成功 invocation fact：${sourceOperationId}`,
      });
      break;
    }
    const fact = successFacts[0]!;
    const inputSha256 = await hasher.sha256(recorded.requestHash);
    if (fact.inputSha256 !== inputSha256) {
      reasons.push({
        code: 'INVOCATION_FACT_MISSING',
        operationId: sourceOperationId,
        message: `invocation fact inputSha256 与 requestHash 摘要不一致：${sourceOperationId}`,
      });
      break;
    }
    if (!COMPOSABLE_CAPABILITY_IDS.includes(fact.capabilityId as ComposableCapabilityId)) {
      reasons.push({
        code: 'UNSUPPORTED_CAPABILITY',
        operationId: sourceOperationId,
        message: `capability 不在可组合白名单内：${fact.capabilityId}`,
      });
      break;
    }

    let factResult: CapabilityFactResult;
    try {
      factResult = await buildCapabilityFact({
        capabilityId: fact.capabilityId as ComposableCapabilityId,
        normalizedInput: normalized as Record<string, unknown>,
        record: input.record,
        sequence,
        sealedOperations: operations,
        semanticDiff: input.semanticDiff,
        objectFacts: input.objectFacts,
        hasher,
      });
    } catch (error) {
      factResult = {
        ok: false,
        code: 'OBJECT_IDENTITY_UNAVAILABLE',
        message: `manifest facts 构建失败：${error instanceof AuthoringOperationError ? error.code : String(error)}`,
      };
    }
    if (!factResult.ok) {
      reasons.push({ code: factResult.code, operationId: sourceOperationId, message: factResult.message });
      break;
    }

    operations.push({
      sequence,
      capabilityId: fact.capabilityId as ComposableCapabilityId,
      sourceOperationId,
      normalizedInput: recorded.normalizedInput,
      inputSha256,
      primaryObject: factResult.primaryObject,
      ...(factResult.fingerprintBefore === undefined ? {} : { objectFingerprintBefore: factResult.fingerprintBefore }),
      ...(factResult.fingerprintAfter === undefined ? {} : { objectFingerprintAfter: factResult.fingerprintAfter }),
      requiredObjects: factResult.requiredObjects,
      producedObjects: factResult.producedObjects,
    });
  }

  if (reasons.length > 0 || operations.length !== entries.length) {
    return { eligibility: 'unavailable', reasons };
  }

  const manifestWithoutFingerprint = {
    manifestVersion: '1.0.0' as const,
    projectIdentity: input.projectIdentity,
    baseProjectRevision: input.record.baseRevision,
    sourceChangeId: input.record.changeId,
    sourceWorkingRevision: input.record.workingRevision,
    operations,
  };
  const manifestFingerprint = await hasher.sha256(stableStringify(manifestWithoutFingerprint));
  return {
    eligibility: 'ready',
    reasons: [],
    manifest: { ...manifestWithoutFingerprint, manifestFingerprint },
  };
}
