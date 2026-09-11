import { AuthoringOperationError, stableStringify, type OperationPrePersistHook } from './change-session.js';
import type {
  CandidateDependencyIssue, ManifestObjectFact, ObjectRequirement,
  RawCompositionReference, RecordedOperationCompositionFacts, ReplayStatePrecondition, ReplayStateRequirement,
} from './composition-contracts.js';
import { compositionFactIdentityIssue, inspectCandidateCompositionReadiness } from './candidate-readiness.js';
import { buildPrimaryObjectDependencyGraph } from './composition-unit-graph.js';

export function resolveOperationRequirementsAtSequence(input: {
  rawReferences: readonly RawCompositionReference[];
  sequence: number;
  baseObjects: readonly ManifestObjectFact[];
  baseAssetRefs: readonly string[];
  priorOperations: ReadonlyArray<{ operationId: string; sequence: number; facts: RecordedOperationCompositionFacts }>;
}): { ok: true; requiredObjects: ObjectRequirement[] } | { ok: false; issues: CandidateDependencyIssue[] } {
  const issues: CandidateDependencyIssue[] = [];
  const requirements = new Map<string, ObjectRequirement>();
  const prior = [...input.priorOperations].filter((item) => item.sequence < input.sequence).sort((a, b) => a.sequence - b.sequence);
  for (const reference of input.rawReferences) {
    if (reference.scope !== 'candidate-external') continue;
    const objectRef = reference.objectRef;
    const asset = reference.kind.endsWith('-asset');
    const base = input.baseObjects.find((item) => item.objectRef === objectRef);
    let requirement: ObjectRequirement | undefined;
    if (objectRef !== undefined) {
      if (asset ? input.baseAssetRefs.includes(objectRef) : base !== undefined) {
        requirement = { objectRef, source: 'base', ...(!asset && base?.fingerprint !== undefined ? { expectedFingerprint: base.fingerprint } : {}) };
      } else if (!asset) {
        const producer = prior.find((item) => item.facts.producedObjects.some((production) => production.objectRef === objectRef && production.disposition !== 'remove'));
        const production = producer?.facts.producedObjects.find((item) => item.objectRef === objectRef && item.disposition !== 'remove');
        if (producer !== undefined && production !== undefined) requirement = {
          objectRef, source: 'candidate', candidateOperationSequence: producer.sequence,
          ...(production.finalFingerprint === undefined ? {} : { expectedFingerprint: production.finalFingerprint }),
        };
      }
    }
    if (requirement !== undefined) {
      requirements.set(`${requirement.objectRef}|${requirement.source}|${requirement.candidateOperationSequence ?? ''}`, requirement);
    } else {
      const capability = { scene: 'scene.create', timeline: 'timeline.create', variable: 'variable.ensure', character: 'character.ensure', label: 'scene.patch' }[reference.kind as 'scene' | 'timeline' | 'variable' | 'character' | 'label'];
      issues.push({
        code: objectRef === undefined ? 'REFERENCE_TARGET_AMBIGUOUS' : asset ? 'ASSET_NOT_RESOLVED' : 'OBJECT_NOT_ESTABLISHED',
        kind: reference.kind, token: reference.token, ...(objectRef === undefined ? {} : { objectRef }), source: reference.source,
        suggestedCapabilities: objectRef === undefined ? ['project.inspect', 'object.inspect'] : asset ? ['project.assets'] : [capability ?? 'project.inspect'],
        repairStrategy: objectRef === undefined ? 'inspect-and-retry' : asset ? 'choose-resolved-asset' : 'create-before-retry',
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues: issues.sort((a, b) => stableStringify(a.source).localeCompare(stableStringify(b.source)) || a.kind.localeCompare(b.kind) || a.token.localeCompare(b.token)) };
  return { ok: true, requiredObjects: [...requirements.values()].sort((a, b) => a.objectRef.localeCompare(b.objectRef) || a.source.localeCompare(b.source) || (a.candidateOperationSequence ?? -1) - (b.candidateOperationSequence ?? -1)) };
}

export function createCandidateOperationPrePersistHook(input: {
  baseObjects: readonly ManifestObjectFact[]; baseAssetRefs: readonly string[];
  baseReplayStates?: readonly ReplayStatePrecondition[];
}): OperationPrePersistHook {
  return async ({ current, operationId, sequence, draft, normalizedInput }) => {
    if (current.integration !== undefined || current.composition?.mode !== 'candidate') return undefined;
    const readiness = inspectCandidateCompositionReadiness(current);
    if (draft === undefined || readiness.status !== 'ready') {
      throw new AuthoringOperationError('CANDIDATE_OPERATION_FACTS_REQUIRED', '候选操作的时点事实不完整或已失效；请查看变更并在新 change 中继续', {
        operationApplied: false, compositionMode: 'candidate', operationId, issues: readiness.issues,
        workingRevisionBefore: current.workingRevision, workingRevisionAfter: current.workingRevision,
        retryDisposition: 'new-change',
      });
    }
    const priorOperations = Object.entries(current.operations).map(([id, operation]) => ({ operationId: id, sequence: operation.sequence!, facts: operation.compositionFacts! }));
    const resolved = resolveOperationRequirementsAtSequence({ ...input, rawReferences: draft.rawReferences, sequence, priorOperations });
    if (!resolved.ok) throw new AuthoringOperationError('CANDIDATE_DEPENDENCY_NOT_READY', '候选依赖尚未建立；请按 issues 先建立被引用对象或选择已解析素材，再重试同一操作', {
      operationApplied: false, compositionMode: 'candidate', operationId, capabilityId: draft.capabilityId,
      workingRevisionBefore: current.workingRevision, workingRevisionAfter: current.workingRevision,
      issues: resolved.issues, retryDisposition: 'after-repair',
    });
    const replay = resolveReplayStateRequirementsAtSequence({ preconditions: draft.replayStatePreconditions ?? [], sequence, baseReplayStates: input.baseReplayStates ?? [], priorOperations });
    if (!replay.ok) throw new AuthoringOperationError('CANDIDATE_OPERATION_FACTS_REQUIRED', '操作消耗的前置状态无法归属到基线或更早的精确产物，尚未写入', {
      operationApplied: false, operationId, objectRefs: replay.missingObjects,
      workingRevisionBefore: current.workingRevision, workingRevisionAfter: current.workingRevision,
    });
    const facts: RecordedOperationCompositionFacts = { ...draft, factsVersion: '1.0.0', requiredObjects: resolved.requiredObjects, replayStateRequirements: replay.requirements };
    const identityIssue = compositionFactIdentityIssue(normalizedInput, facts);
    if (identityIssue !== undefined) throw new AuthoringOperationError('CANDIDATE_OPERATION_FACTS_REQUIRED', identityIssue, { operationApplied: false, operationId });
    const graph = buildPrimaryObjectDependencyGraph([
      ...priorOperations.map((item) => ({ operationId: item.operationId, sequence: item.sequence, ...item.facts })),
      { operationId, sequence, ...facts },
    ]);
    if (graph.cycles.length > 0) throw new AuthoringOperationError('CANDIDATE_DEPENDENCY_CYCLE', '拟写入的操作会形成不可拆对象单元的互引环，尚未写入；请改成单向依赖。互相创建空骨架不能解除此环', {
      operationApplied: false, proposedOperationId: operationId, cycles: graph.cycles,
      unsupportedRecovery: 'mutual-empty-skeleton', retryDisposition: 'after-repair',
    });
    return facts;
  };
}

export function resolveReplayStateRequirementsAtSequence(input: {
  preconditions: readonly ReplayStatePrecondition[];
  sequence: number;
  baseReplayStates: readonly ReplayStatePrecondition[];
  priorOperations: ReadonlyArray<{ sequence: number; facts: RecordedOperationCompositionFacts }>;
}): { ok: true; requirements: ReplayStateRequirement[] } | { ok: false; missingObjects: string[] } {
  const requirements: ReplayStateRequirement[] = [];
  const missingObjects: string[] = [];
  const prior = input.priorOperations.filter((item) => item.sequence < input.sequence).sort((a, b) => b.sequence - a.sequence);
  for (const precondition of input.preconditions) {
    const producer = prior.find((item) => item.facts.producedObjects.some((production) =>
      production.objectRef === precondition.objectRef && production.disposition !== 'remove' && production.finalFingerprint === precondition.expectedFingerprint));
    if (producer !== undefined) requirements.push({ ...precondition, source: 'candidate', candidateOperationSequence: producer.sequence });
    else if (input.baseReplayStates.some((base) => base.objectRef === precondition.objectRef && base.expectedFingerprint === precondition.expectedFingerprint)) requirements.push({ ...precondition, source: 'base' });
    else missingObjects.push(precondition.objectRef);
  }
  return missingObjects.length > 0 ? { ok: false, missingObjects: missingObjects.sort() }
    : { ok: true, requirements: requirements.sort((a, b) => a.objectRef.localeCompare(b.objectRef)) };
}
