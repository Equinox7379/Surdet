import { AuthoringOperationError, stableStringify } from './change-session.js';
import type { ChangeRecord, TextHasher } from './contracts.js';
import type { ChangeDiff } from './diff.js';
import { analyzeSceneCompositionReferences, analyzeTimelineCompositionReferences } from './composition-reference-analysis.js';
import { inspectCandidateCompositionReadiness } from './candidate-readiness.js';
import { resolveOperationRequirementsAtSequence } from './candidate-composition-guard.js';
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
      const config = readWorkingJson(record, CONFIG_PATH);
      const rawRefs = analyzeSceneCompositionReferences({
        sceneId, path: scenePath(sceneId), text,
        characters: isRecord(config?.['characters']) ? config['characters'] : {},
      }).filter((reference) => reference.scope === 'candidate-external');
      if (rawRefs.some((reference) => reference.objectRef === undefined)) return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `场景 ${primaryObject} 存在无法唯一解析的引用`);
      const refs = rawRefs.map((reference) => reference.objectRef!);
      const requiredObjects = await resolveRequirements(refs, objectFacts, sealedOperations);
      if (requiredObjects === undefined) {
        const missing = [...new Set(refs)].filter((ref) => resolveRequirement(ref, objectFacts, sealedOperations) === undefined);
        return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `场景 ${primaryObject} 的依赖未在基线或更早操作中建立身份：${missing.join(', ')}。请先创建被引用对象，再补充单向引用；互相创建空骨架不能解除对象单元的依赖环。`);
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
      const rawRefs = analyzeTimelineCompositionReferences({ timelineId, path, definition });
      if (rawRefs.some((reference) => reference.objectRef === undefined)) return unavailable('DEPENDENCY_IDENTITY_UNAVAILABLE', `时间轴 ${primaryObject} 存在无法唯一解析的引用`);
      const refs = rawRefs.map((reference) => reference.objectRef!);
      const requiredObjects = await resolveRequirements(refs, objectFacts, sealedOperations);
      if (requiredObjects === undefined) {
        const missing = [...new Set(refs)].filter((ref) => resolveRequirement(ref, objectFacts, sealedOperations) === undefined);
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

async function finalProductionFingerprint(record: ChangeRecord, objectRef: string, hasher: TextHasher): Promise<string | undefined> {
  if (objectRef.startsWith('scene:')) {
    const text = record.workingFiles[scenePath(objectRef.slice('scene:'.length))];
    return text === undefined ? undefined : hasher.sha256(text);
  }
  let value: unknown;
  if (objectRef.startsWith('timeline:')) value = readWorkingJson(record, timelinePath(objectRef.slice('timeline:'.length)));
  else {
    const config = readWorkingJson(record, CONFIG_PATH);
    if (objectRef === 'config:characters') value = config?.['characters'] ?? {};
    else if (objectRef === 'config:entryScene') value = config?.['entryScene'];
    else if (objectRef.startsWith('variable:')) value = isRecord(config?.['variables']) ? config['variables'][objectRef.slice('variable:'.length)] : undefined;
    else if (objectRef.startsWith('character:')) value = isRecord(config?.['characters']) ? config['characters'][objectRef.slice('character:'.length)] : undefined;
  }
  return value === undefined ? undefined : hasher.sha256(stableStringify(value));
}

/** Recheck persisted temporal facts; final files are used only for last-production verification. */
export async function buildCompositionManifestFromRecordedFacts(
  input: BuildCompositionManifestInput, hasher: TextHasher,
): Promise<{ eligibility: 'ready'; reasons: []; manifest: CompositionManifest } | { eligibility: 'unavailable'; reasons: CompositionIneligibility[] }> {
  const readiness = inspectCandidateCompositionReadiness(input.record);
  const reasons: CompositionIneligibility[] = readiness.issues.map(({ code, operationId, message }) => ({ code, ...(operationId === undefined ? {} : { operationId }), message }));
  const operations: CompositionOperation[] = [];
  const entries = Object.entries(input.record.operations).sort((a, b) => (a[1].sequence ?? -1) - (b[1].sequence ?? -1) || a[0].localeCompare(b[0]));
  const priorOperations = entries.filter(([, item]) => item.compositionFacts !== undefined && item.sequence !== undefined)
    .map(([operationId, item]) => ({ operationId, sequence: item.sequence!, facts: item.compositionFacts! }));
  for (const [operationId, recorded] of entries) {
    const issue = (code: CompositionIneligibility['code'], message: string) => reasons.push({ code, operationId, message });
    const normalized = recorded.normalizedInput;
    let valid = true;
    if (normalized === undefined) { issue('MISSING_NORMALIZED_INPUT', '成功操作缺少规范化输入，不能重放'); valid = false; }
    else if (!isRecord(normalized) || normalized['operationId'] !== operationId || stableStringify(normalized) !== recorded.requestHash) {
      issue('OBJECT_IDENTITY_UNAVAILABLE', '规范化输入、operationId 或 requestHash 不一致'); valid = false;
    }
    const invocations = input.invocationFacts.filter((fact) => fact.ok && fact.operationId === operationId);
    if (invocations.length !== 1) {
      issue(invocations.length === 0 ? 'INVOCATION_FACT_MISSING' : 'INVOCATION_FACT_AMBIGUOUS', '需要唯一成功 invocation fact；后续 capability 身份分析受阻'); valid = false;
    }
    const invocation = invocations.length === 1 ? invocations[0] : undefined;
    const inputSha256 = await hasher.sha256(recorded.requestHash);
    if (invocation !== undefined && invocation.inputSha256 !== inputSha256) { issue('INVOCATION_FACT_MISSING', 'invocation inputSha256 与操作输入不一致'); valid = false; }
    if (invocation !== undefined && !COMPOSABLE_CAPABILITY_IDS.includes(invocation.capabilityId as ComposableCapabilityId)) { issue('UNSUPPORTED_CAPABILITY', 'capability 不在可组合白名单内'); valid = false; }
    const facts = recorded.compositionFacts;
    if (facts === undefined || facts.factsVersion !== '1.0.0' || !Array.isArray(facts.rawReferences) || !Array.isArray(facts.requiredObjects) || !Array.isArray(facts.producedObjects) || recorded.sequence === undefined) continue;
    if (invocation !== undefined && invocation.capabilityId !== facts.capabilityId) { issue('OPERATION_FACTS_INVALID', '成功 invocation capability 与时点事实不一致'); valid = false; }
    const resolved = resolveOperationRequirementsAtSequence({
      rawReferences: facts.rawReferences, sequence: recorded.sequence, baseObjects: input.objectFacts.baseObjects,
      baseAssetRefs: input.record.composition?.baseAssetRefs ?? [], priorOperations,
    });
    if (!resolved.ok) { issue('DEPENDENCY_IDENTITY_UNAVAILABLE', `依赖未在基线或更早生产者中建立：${resolved.issues.map((item) => item.objectRef ?? item.token).join('、')}`); valid = false; }
    else if (stableStringify(resolved.requiredObjects) !== stableStringify(facts.requiredObjects)) { issue('OPERATION_FACTS_INVALID', '已记录依赖与时点解析不一致，不能替换生产者或补写历史'); valid = false; }
    for (const requirement of facts.requiredObjects) {
      if (requirement.source === 'base' && requirement.objectRef.startsWith('asset:') && !input.objectFacts.workingAssetRefs.includes(requirement.objectRef)) {
        issue('DEPENDENCY_IDENTITY_UNAVAILABLE', `基线素材当前已无法解析：${requirement.objectRef}`); valid = false;
      }
    }
    if (valid && normalized !== undefined) operations.push({
      sequence: recorded.sequence, capabilityId: facts.capabilityId, sourceOperationId: operationId,
      normalizedInput: normalized, inputSha256, primaryObject: facts.primaryObject,
      ...(facts.objectFingerprintBefore === undefined ? {} : { objectFingerprintBefore: facts.objectFingerprintBefore }),
      ...(facts.objectFingerprintAfter === undefined ? {} : { objectFingerprintAfter: facts.objectFingerprintAfter }),
      requiredObjects: facts.requiredObjects.map((item) => ({ ...item })), producedObjects: facts.producedObjects.map((item) => ({ ...item })),
    });
  }
  const finalProductions = new Map<string, { operationId: string; production: ObjectProduction }>();
  for (const operation of operations) for (const production of operation.producedObjects) finalProductions.set(production.objectRef, { operationId: operation.sourceOperationId, production });
  for (const [objectRef, { operationId, production }] of finalProductions) {
    const finalFingerprint = await finalProductionFingerprint(input.record, objectRef, hasher);
    if (production.disposition === 'remove' ? finalFingerprint !== undefined : finalFingerprint === undefined || finalFingerprint !== production.finalFingerprint) {
      reasons.push({ code: 'OPERATION_FACTS_INVALID', operationId, message: `最后一个产物与最终对象不一致：${objectRef}` });
    }
  }
  if (reasons.length > 0 || operations.length !== entries.length) {
    return { eligibility: 'unavailable', reasons: reasons.sort((a, b) => (a.operationId ?? '').localeCompare(b.operationId ?? '') || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)) };
  }
  const manifest = {
    manifestVersion: '1.0.0' as const, projectIdentity: input.projectIdentity,
    baseProjectRevision: input.record.baseRevision, sourceChangeId: input.record.changeId,
    sourceWorkingRevision: input.record.workingRevision, operations,
  };
  return { eligibility: 'ready', reasons: [], manifest: { ...manifest, manifestFingerprint: await hasher.sha256(stableStringify(manifest)) } };
}

export async function buildCompositionManifest(
  input: BuildCompositionManifestInput,
  hasher: TextHasher,
): Promise<
  | { eligibility: 'ready'; reasons: []; manifest: CompositionManifest }
  | { eligibility: 'unavailable'; reasons: CompositionIneligibility[] }
> {
  if (input.record.integration === undefined && input.record.composition?.mode === 'candidate') return buildCompositionManifestFromRecordedFacts(input, hasher);
  if (input.record.integration === undefined && input.record.composition === undefined) return {
    eligibility: 'unavailable', reasons: [
      { code: 'OPERATION_FACTS_MISSING', message: '旧变更没有操作时点事实；请创建新候选。已封存 capsule 仍可读取' },
      ...Object.entries(input.record.operations).filter(([, operation]) => operation.normalizedInput === undefined).map(([operationId]) => ({
        code: 'MISSING_NORMALIZED_INPUT' as const, operationId, message: '旧操作没有规范化输入，不能从最终文件或 diff 重建',
      })),
    ],
  };
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
