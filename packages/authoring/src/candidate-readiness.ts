import type { ChangeRecord } from './contracts.js';
import {
  COMPOSABLE_CAPABILITY_IDS,
  type CandidateCompositionReadiness,
  type JsonValue,
  type RecordedOperationCompositionFacts,
} from './composition-contracts.js';
import { buildPrimaryObjectDependencyGraph } from './composition-unit-graph.js';

/** The capability's identity shell is checked independently of its invocation ledger. */
export function compositionFactIdentityIssue(input: JsonValue | undefined, facts: RecordedOperationCompositionFacts): string | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'operation 缺少规范化输入';
  if (!COMPOSABLE_CAPABILITY_IDS.includes(facts.capabilityId)) return 'operation facts 的 capability 不在可组合白名单';
  let expected: string;
  switch (facts.capabilityId) {
    case 'scene.create':
    case 'scene.patch': {
      const patch = input['patch'];
      const target = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch['target'] ?? patch['anchor'] : undefined;
      const id = input['sceneId'] ?? (typeof target === 'string' ? /^scene:([^/]+)\//.exec(target)?.[1] : undefined);
      if (typeof id !== 'string' || id.length === 0) return 'scene facts 缺少 sceneId';
      expected = `scene:${id}`;
      break;
    }
    case 'timeline.create':
    case 'timeline.patch':
      if (typeof input['timelineId'] !== 'string') return 'timeline facts 缺少 timelineId';
      expected = `timeline:${input['timelineId']}`;
      break;
    case 'variable.ensure':
      if (typeof input['name'] !== 'string') return 'variable facts 缺少 name';
      expected = `variable:${input['name']}`;
      break;
    case 'character.ensure':
    case 'character.remove':
      if (typeof input['id'] !== 'string') return 'character facts 缺少 id';
      expected = `character:${input['id']}`;
      break;
    case 'project.entry-scene.set':
      if (typeof input['sceneId'] !== 'string') return 'entryScene facts 缺少 sceneId';
      expected = 'config:entryScene';
      break;
    case 'gallery.cg.create':
    case 'gallery.cg.patch':
      if (typeof input['id'] !== 'string') return 'CG facts 缺少 id';
      expected = `gallery:cgs:${input['id']}`;
  }
  if (facts.primaryObject !== expected) return 'operation facts 的 primaryObject 与输入身份不一致';
  const primary = facts.producedObjects.filter((item) => item.objectRef === expected);
  if (primary.length !== 1) return 'operation facts 缺少唯一主对象产物';
  if (primary[0]!.disposition === 'remove' ? facts.capabilityId !== 'character.remove'
    : !['create', 'update'].includes(primary[0]!.disposition) || facts.capabilityId === 'character.remove') return '主对象产物处置与 capability 不一致';
  if (primary[0]!.finalFingerprint !== facts.objectFingerprintAfter) return '主对象指纹与产物指纹不一致';
  const rawRefs = new Set(facts.rawReferences.filter((ref) => ref.scope === 'candidate-external').map((ref) => ref.objectRef));
  const requiredRefs = new Set(facts.requiredObjects.map((ref) => ref.objectRef));
  if (rawRefs.has(undefined) || rawRefs.size !== requiredRefs.size || [...rawRefs].some((ref) => !requiredRefs.has(ref!))) return 'raw references 与已解析依赖不一致';
  const preconditions = facts.replayStatePreconditions ?? [];
  const replay = facts.replayStateRequirements ?? [];
  if (!Array.isArray(preconditions) || !Array.isArray(replay)) return '重放状态事实形状无效';
  const expectedRefs = facts.capabilityId === 'character.ensure' || facts.capabilityId === 'character.remove'
    ? ['config:characters', ...facts.producedObjects.filter((item) => item.objectRef.startsWith('scene:')).map((item) => item.objectRef)]
    : facts.capabilityId === 'scene.patch' || facts.capabilityId === 'gallery.cg.patch' ? [facts.primaryObject] : [];
  if (expectedRefs.includes('config:characters') && facts.producedObjects.filter((item) => item.objectRef === 'config:characters' && item.disposition === 'update').length !== 1) return '角色操作缺少唯一角色表产物';
  if (preconditions.length !== expectedRefs.length || new Set(preconditions.map((item) => item.objectRef)).size !== expectedRefs.length
    || expectedRefs.some((ref) => !preconditions.some((item) => item.objectRef === ref && typeof item.expectedFingerprint === 'string'))
    || replay.length !== preconditions.length || preconditions.some((before) => replay.filter((item) => item.objectRef === before.objectRef && item.expectedFingerprint === before.expectedFingerprint).length !== 1)) return '重放状态前置事实缺失或不一致';
  if (preconditions.some((item) => item.objectRef === 'config:characters' && item.expectedFingerprint !== input['expectedFingerprint'])) return '角色表前置指纹与规范输入不一致';
  if (facts.capabilityId === 'scene.patch' && preconditions[0]?.expectedFingerprint !== facts.objectFingerprintBefore) return '场景重放前置指纹与操作前状态不一致';
  if (facts.capabilityId === 'gallery.cg.patch' && (preconditions[0]?.expectedFingerprint !== facts.objectFingerprintBefore
    || facts.objectFingerprintBefore !== input['expectedFingerprint'])) return 'CG 重放前置指纹与规范输入不一致';
  return undefined;
}

export function inspectCandidateCompositionReadiness(record: ChangeRecord): CandidateCompositionReadiness {
  const entries = Object.entries(record.operations);
  const mode = record.integration !== undefined ? 'integration' : record.composition?.mode ?? 'legacy-unclassified';
  const result: CandidateCompositionReadiness = {
    mode, status: mode === 'candidate' ? 'ready' : mode === 'legacy-unclassified' ? 'legacy-unavailable' : 'not-applicable',
    operationCount: entries.length, issueCount: 0, issues: [], truncated: false,
    ...(record.composition?.operationFactsVersion === '1.0.0' ? { operationFactsVersion: '1.0.0' as const } : {}),
  };
  if (mode === 'legacy-unclassified') {
    result.issues.push({ code: 'OPERATION_FACTS_MISSING', message: '旧变更未记录操作时点事实；请在新合同下新建候选' });
  } else if (mode === 'candidate') {
    const ordered = [...entries].sort((a, b) => (a[1].sequence ?? -1) - (b[1].sequence ?? -1) || a[0].localeCompare(b[0]));
    if (record.composition?.operationFactsVersion !== '1.0.0') {
      result.issues.push({ code: 'OPERATION_FACTS_INVALID', message: '候选操作事实版本不受支持' });
    }
    const valid: Array<{ operationId: string; sequence: number; facts: RecordedOperationCompositionFacts }> = [];
    for (const [index, [operationId, operation]] of ordered.entries()) {
      if (operation.sequence !== index) result.issues.push({ code: 'OPERATION_SEQUENCE_INVALID', operationId, message: '操作 sequence 必须从 0 开始唯一连续' });
      const facts = operation.compositionFacts;
      if (facts === undefined) {
        result.issues.push({ code: 'OPERATION_FACTS_MISSING', operationId, message: '成功操作缺少时点事实；不从最终文件补写历史' });
        continue;
      }
      if (facts.factsVersion !== '1.0.0' || !Array.isArray(facts.rawReferences) || !Array.isArray(facts.requiredObjects) || !Array.isArray(facts.producedObjects)) {
        result.issues.push({ code: 'OPERATION_FACTS_INVALID', operationId, message: '操作事实版本或形状无效' });
        continue;
      }
      const identityIssue = compositionFactIdentityIssue(operation.normalizedInput, facts);
      if (identityIssue !== undefined) result.issues.push({ code: 'OPERATION_FACTS_INVALID', operationId, message: identityIssue });
      if (Number.isInteger(operation.sequence) && operation.sequence! >= 0) valid.push({ operationId, sequence: operation.sequence!, facts });
    }
    for (const operation of valid) {
      for (const requirement of [...operation.facts.requiredObjects, ...operation.facts.replayStateRequirements ?? []]) {
        if (requirement.source === 'base') continue;
        const producer = valid.find((item) => item.sequence === requirement.candidateOperationSequence);
        const production = producer?.facts.producedObjects.find((item) => item.objectRef === requirement.objectRef && item.disposition !== 'remove');
        if (requirement.source !== 'candidate' || producer === undefined || producer.sequence >= operation.sequence || production === undefined
          || requirement.expectedFingerprint !== production.finalFingerprint) {
          result.issues.push({ code: 'DEPENDENCY_IDENTITY_UNAVAILABLE', operationId: operation.operationId, objectRefs: [requirement.objectRef], message: '候选依赖未指向更早的真实产物及其时点指纹' });
        }
      }
    }
    const graph = buildPrimaryObjectDependencyGraph(valid.map((item) => ({ operationId: item.operationId, sequence: item.sequence, ...item.facts })));
    for (const cycle of graph.cycles) result.issues.push({ code: 'DEPENDENCY_CYCLE', message: `不可拆对象单元形成互引环：${cycle.primaryObjects.join('、')}`, objectRefs: cycle.primaryObjects, cycle });
    if (result.issues.length > 0) result.status = 'blocked';
  }
  result.issueCount = result.issues.length;
  return result;
}
