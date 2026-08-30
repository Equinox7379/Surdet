import { AuthoringOperationError, evidenceFreshness, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionManifest,
  CompositionComparison,
  CompositionOperation,
  ObjectChangeUnit,
  VerifiedCompositionCandidate,
} from './composition-contracts.js';
import type { AuthoringObject, ChangeRecord, TextHasher } from './contracts.js';
import type { ChangeDiff } from './diff.js';
import type { IntegrationPlan } from './integration-plan.js';
import type {
  HumanReviewProjection,
  ReviewCandidate,
  ReviewConflict,
  ReviewDependency,
  ReviewEvidenceSummary,
  ReviewFinalResult,
  ReviewObjectSummary,
  ReviewResultFreshness,
  ReviewRuntimeTraceObservation,
  ReviewSafeGroup,
  ReviewUnitOutcome,
  ReviewWarning,
} from './review-contracts.js';
import {
  buildReviewUnitPresentation,
  metadataOnlyReviewUnitPresentation,
} from './review-presentation.js';

export interface BuildComparisonReviewProjectionInput {
  reviewId: string;
  comparison: CompositionComparison;
  candidates: Array<Pick<VerifiedCompositionCandidate,
    'candidateId' | 'ref' | 'evidenceSummary'> & {
      intent?: string;
      acceptanceCriteria: string[];
      manifest?: CompositionManifest;
    }>;
  objects: AuthoringObject[];
}

function candidateRefKey(ref: CandidateCapsuleRef): string {
  return [ref.artifactSha256, ref.changeId, ref.capsuleId].join('\u0000');
}

function compareRefs(left: CandidateCapsuleRef, right: CandidateCapsuleRef): number {
  return left.artifactSha256.localeCompare(right.artifactSha256)
    || left.changeId.localeCompare(right.changeId)
    || left.capsuleId.localeCompare(right.capsuleId);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizedEvidence(summary: CandidateEvidenceSummary): CandidateEvidenceSummary {
  return {
    validation: summary.validation,
    simulation: summary.simulation,
    runtime: summary.runtime,
    warnings: summary.warnings,
    manualReviewRequired: sortedStrings(summary.manualReviewRequired),
  };
}

function sortedFacts(values: readonly unknown[]): unknown[] {
  const byIdentity = new Map<string, unknown>();
  for (const value of values) byIdentity.set(stableStringify(value), value);
  return [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function unitPresentation(
  unit: ObjectChangeUnit,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewUnitOutcome['presentation'] {
  const manifest = manifests.get(unit.candidateId);
  if (manifest === undefined) return metadataOnlyReviewUnitPresentation(unit.primaryObject);
  const bySequence = new Map<number, CompositionOperation>();
  for (const operation of manifest.operations) {
    if (bySequence.has(operation.sequence)) return metadataOnlyReviewUnitPresentation(unit.primaryObject);
    bySequence.set(operation.sequence, operation);
  }
  const operations: CompositionOperation[] = [];
  for (const sequence of [...unit.operationSequences].sort((left, right) => left - right)) {
    const operation = bySequence.get(sequence);
    if (operation === undefined || operation.primaryObject !== unit.primaryObject) {
      return metadataOnlyReviewUnitPresentation(unit.primaryObject);
    }
    operations.push(operation);
  }
  return buildReviewUnitPresentation(unit.primaryObject, operations);
}

function projectUnitOutcome(
  unit: ObjectChangeUnit,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewUnitOutcome {
  return {
    unitId: unit.unitId,
    candidateId: unit.candidateId,
    primaryObject: unit.primaryObject,
    ...(unit.finalFingerprint === undefined ? {} : { finalFingerprint: unit.finalFingerprint }),
    outcomes: [...unit.producedObjects]
      .sort((left, right) => left.objectRef.localeCompare(right.objectRef)
        || left.disposition.localeCompare(right.disposition)
        || (left.finalFingerprint ?? '').localeCompare(right.finalFingerprint ?? ''))
      .map((outcome) => ({ ...outcome })),
    potentialImpact: sortedFacts(unit.potentialImpact),
    observedImpact: sortedFacts(unit.observedImpact),
    evidence: normalizedEvidence(unit.evidenceSummary),
    presentation: unitPresentation(unit, manifests),
  };
}

function summarizeSafeGroupEvidence(sources: readonly ReviewUnitOutcome[]): ReviewSafeGroup['evidence'] {
  const evidence = sources.map((source) => source.evidence);
  return {
    warningCount: evidence.reduce((total, item) => total + item.warnings, 0),
    missing: evidence.some((item) => item.validation === 'missing'
      || item.simulation === 'missing'
      || item.runtime === 'missing'),
    stale: evidence.some((item) => item.validation === 'stale'
      || item.simulation === 'stale'
      || item.runtime === 'stale'),
    failed: evidence.some((item) => item.validation === 'failed'
      || item.simulation === 'failed'
      || item.runtime === 'failed'),
    incomplete: evidence.some((item) => item.simulation === 'incomplete'),
    manualReviewRequired: sortedStrings(evidence.flatMap((item) => item.manualReviewRequired)),
  };
}

function invalid(message: string): AuthoringOperationError {
  return new AuthoringOperationError('INVALID_REQUEST', message);
}

function resolutionOrder(value: ReviewConflict['allowedResolutions'][number]): number {
  return { 'choose-unit': 0, 'exclude-all': 1, 'regenerate-candidate': 2 }[value];
}

function canonicalCandidateInputs(
  comparison: CompositionComparison,
  inputs: BuildComparisonReviewProjectionInput['candidates'],
): BuildComparisonReviewProjectionInput['candidates'] {
  const byRef = new Map<string, BuildComparisonReviewProjectionInput['candidates'][number]>();
  for (const item of inputs) {
    const key = candidateRefKey(item.ref);
    if (byRef.has(key)) throw invalid('候选引用重复：' + item.candidateId);
    byRef.set(key, item);
  }
  const ordered: BuildComparisonReviewProjectionInput['candidates'] = [];
  for (const ref of [...comparison.candidates].sort(compareRefs)) {
    const item = byRef.get(candidateRefKey(ref));
    if (item === undefined) throw invalid('comparison 缺少候选的 intent/evidence：' + candidateRefKey(ref));
    ordered.push(item);
  }
  return ordered;
}

function candidateRank(candidates: readonly ReviewCandidate[]): Map<string, number> {
  return new Map(candidates.map((item, index) => [item.candidateId, index]));
}

function compareCandidateIds(ranks: Map<string, number>, left: string, right: string): number {
  return (ranks.get(left) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right);
}

function projectObjects(
  objects: readonly AuthoringObject[],
  comparison: CompositionComparison,
): ReviewObjectSummary[] {
  const impacts = new Map<string, { potentialImpact: unknown[]; observedImpact: unknown[] }>();
  const units = [...comparison.units].sort((left, right) =>
    left.primaryObject.localeCompare(right.primaryObject)
    || left.candidateId.localeCompare(right.candidateId)
    || left.unitId.localeCompare(right.unitId));
  for (const unit of units) {
    const current = impacts.get(unit.primaryObject) ?? { potentialImpact: [], observedImpact: [] };
    current.potentialImpact.push(...unit.potentialImpact);
    current.observedImpact.push(...unit.observedImpact);
    impacts.set(unit.primaryObject, current);
  }
  const objectsByRef = new Map<string, AuthoringObject | undefined>(
    objects.map((object) => [object.objectRef, object]),
  );
  for (const unit of units) {
    for (const produced of unit.producedObjects) {
      if (!objectsByRef.has(produced.objectRef)) objectsByRef.set(produced.objectRef, undefined);
    }
  }
  return [...objectsByRef.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((objectRef) => {
      const object = objectsByRef.get(objectRef);
      const separator = objectRef.indexOf(':');
      const impact = impacts.get(objectRef) ?? { potentialImpact: [], observedImpact: [] };
      return {
        objectRef,
        kind: object?.kind ?? (separator > 0 ? objectRef.slice(0, separator) : 'unknown'),
        ...(object?.semanticId !== undefined
          ? { semanticId: object.semanticId }
          : separator > 0 && separator < objectRef.length - 1
            ? { semanticId: objectRef.slice(separator + 1) }
            : {}),
        ...(object?.source === undefined ? {} : {
          source: { path: object.source.path, line: object.source.line, col: object.source.col },
        }),
        references: sortedStrings(object?.references ?? []),
        referencedBy: sortedStrings(object?.referencedBy ?? []),
        potentialImpact: sortedFacts(impact.potentialImpact),
        observedImpact: sortedFacts(impact.observedImpact),
      };
    });
}

function projectSafeGroups(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewSafeGroup[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.identicalGroups]
    .sort((left, right) => left.primaryObject.localeCompare(right.primaryObject) || left.groupId.localeCompare(right.groupId))
    .map((group) => {
      const unitIds = sortedStrings(group.unitIds);
      const groupUnits = unitIds
        .map((unitId) => unitsById.get(unitId))
        .filter((unit): unit is ObjectChangeUnit => unit !== undefined)
        .sort((left, right) => compareCandidateIds(ranks, left.candidateId, right.candidateId)
          || left.unitId.localeCompare(right.unitId));
      const sources = groupUnits.map((unit) => projectUnitOutcome(unit, manifests));
      const candidateIds = [...new Set(groupUnits.map((unit) => unit.candidateId))]
        .sort((left, right) => compareCandidateIds(ranks, left, right));
      const groupUnitIds = new Set(unitIds);
      const dependencyObjectRefs = sortedStrings([
        ...groupUnits.flatMap((unit) => unit.requiredBaseObjects.map((required) => required.objectRef)),
        ...groupUnits.flatMap((unit) => unit.requiredUnitIds
          .map((requiredUnitId) => unitsById.get(requiredUnitId)?.primaryObject)
          .filter((objectRef): objectRef is string => objectRef !== undefined)),
        ...comparison.dependencyEdges
          .filter((edge) => groupUnitIds.has(edge.fromUnitId))
          .map((edge) => edge.objectRef),
      ]);
      return {
        groupId: group.groupId,
        primaryObject: group.primaryObject,
        finalFingerprint: group.finalFingerprint,
        unitIds,
        candidateIds,
        sourceCount: candidateIds.length,
        includedByDefault: true,
        collapsedByDefault: true,
        sources,
        dependencyObjectRefs,
        potentialImpact: sortedFacts(groupUnits.flatMap((unit) => unit.potentialImpact)),
        observedImpact: sortedFacts(groupUnits.flatMap((unit) => unit.observedImpact)),
        evidence: summarizeSafeGroupEvidence(sources),
      };
    });
}

function projectConflicts(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewConflict[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.conflicts]
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
    .map((conflict) => {
      const unitIds = sortedStrings(conflict.unitIds);
      const options = unitIds
        .map((unitId) => unitsById.get(unitId))
        .filter((unit): unit is ObjectChangeUnit => unit !== undefined)
        .sort((left, right) => compareCandidateIds(ranks, left.candidateId, right.candidateId)
          || left.unitId.localeCompare(right.unitId))
        .map((unit) => projectUnitOutcome(unit, manifests));
      return {
        conflictId: conflict.conflictId,
        severity: conflict.severity,
        code: conflict.code,
        unitIds,
        candidateIds: sortedStrings(conflict.candidateIds)
          .sort((left, right) => compareCandidateIds(ranks, left, right)),
        objectRefs: sortedStrings(conflict.objectRefs),
        allowedResolutions: [...new Set(conflict.allowedResolutions)]
          .sort((left, right) => resolutionOrder(left) - resolutionOrder(right)),
        repairActions: [...conflict.repairActions],
        options,
      };
    });
}

function projectDependencies(comparison: CompositionComparison): ReviewDependency[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.dependencyEdges]
    .sort((left, right) =>
      left.fromUnitId.localeCompare(right.fromUnitId)
      || left.toUnitId.localeCompare(right.toUnitId)
      || left.objectRef.localeCompare(right.objectRef))
    .map((edge) => {
      const fromUnit = unitsById.get(edge.fromUnitId);
      if (fromUnit === undefined) {
        throw invalid(`dependency edge 引用了不存在的 fromUnitId：${edge.fromUnitId}`);
      }
      return {
        fromUnitId: edge.fromUnitId,
        fromObjectRef: fromUnit.primaryObject,
        toUnitId: edge.toUnitId,
        objectRef: edge.objectRef,
        inclusion: 'implicit',
      };
    });
}

/**
 * 比较审查的唯一默认选择规则。相同结果组是已确认安全事实，优先保留其全部来源；
 * 其余只直接选择没有 blocking/selection 冲突且不是依赖目标的根单元。
 */
function comparisonDefaultSelectedUnitIds(comparison: CompositionComparison): string[] {
  const identicalUnitIds = new Set(comparison.identicalGroups.flatMap((group) => group.unitIds));
  const dependencyTargetUnitIds = new Set(comparison.dependencyEdges.map((edge) => edge.toUnitId));
  const unresolvedUnitIds = new Set(comparison.conflicts
    .filter((conflict) => conflict.severity === 'blocking' || conflict.severity === 'selection-required')
    .flatMap((conflict) => conflict.unitIds));
  return sortedStrings(comparison.units
    .filter((unit) => identicalUnitIds.has(unit.unitId)
      || (!dependencyTargetUnitIds.has(unit.unitId) && !unresolvedUnitIds.has(unit.unitId)))
    .map((unit) => unit.unitId));
}

function projectEvidence(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
  conflicts: readonly ReviewConflict[],
): ReviewEvidenceSummary {
  const candidateMatrix = [...comparison.evidenceMatrix]
    .sort((left, right) => compareCandidateIds(ranks, left.candidateId, right.candidateId))
    .map((item) => ({ candidateId: item.candidateId, summary: normalizedEvidence(item.summary) }));
  const blockingCount = conflicts.filter((item) => item.severity === 'blocking').length;
  const selectionRequiredCount = conflicts.filter((item) => item.severity === 'selection-required').length;
  const advisoryCount = conflicts.filter((item) => item.severity === 'advisory').length;
  return {
    candidateMatrix,
    blockingCount,
    selectionRequiredCount,
    advisoryCount,
    canCreateDecision: comparison.status !== 'blocked' && blockingCount === 0,
  };
}

function reviewFingerprintPayload(projection: HumanReviewProjection): Record<string, unknown> {
  return {
    reviewVersion: projection.reviewVersion,
    kind: projection.kind,
    projectIdentity: projection.projectIdentity,
    expectedProjectRevision: projection.expectedProjectRevision,
    sourceIdentity: projection.sourceIdentity,
    candidates: projection.candidates.map(({ candidateId, ref, evidence }) => ({ candidateId, ref, evidence })),
    safeGroups: projection.safeGroups,
    conflicts: projection.conflicts.map(({
      conflictId,
      severity,
      code,
      unitIds,
      candidateIds,
      objectRefs,
      allowedResolutions,
      options,
    }) => ({
      conflictId,
      severity,
      code,
      unitIds,
      candidateIds,
      objectRefs,
      allowedResolutions,
      options,
    })),
    dependencies: projection.dependencies,
    defaultSelectedUnitIds: projection.defaultSelectedUnitIds,
    evidence: projection.evidence,
    objects: projection.objects.map(({ source, ...object }) => {
      void source;
      return object;
    }),
  };
}

/** comparison review 的唯一 identity 投影；旧 payload 缺少可选 presentation 时字段保持缺席。 */
export async function comparisonReviewFingerprintOf(
  projection: HumanReviewProjection,
  hasher: TextHasher,
): Promise<string> {
  if (projection.kind !== 'comparison') throw invalid('comparison review fingerprint 只能用于 comparison projection');
  return hasher.sha256(stableStringify(reviewFingerprintPayload(projection)));
}

export async function buildComparisonReviewProjection(
  input: BuildComparisonReviewProjectionInput,
  hasher: TextHasher,
): Promise<HumanReviewProjection> {
  const orderedInputs = canonicalCandidateInputs(input.comparison, input.candidates);
  const candidates: ReviewCandidate[] = orderedInputs.map((item, index) => ({
    candidateId: item.candidateId,
    ref: item.ref,
    displayOrdinal: String.fromCharCode('A'.charCodeAt(0) + index),
    ...(item.intent === undefined ? {} : { declaredIntent: item.intent }),
    acceptanceCriteria: [...item.acceptanceCriteria],
    evidence: normalizedEvidence(item.evidenceSummary),
  }));
  const ranks = candidateRank(candidates);
  const manifests = new Map(orderedInputs.map((item) => [item.candidateId, item.manifest]));
  const safeGroups = projectSafeGroups(input.comparison, ranks, manifests);
  const conflicts = projectConflicts(input.comparison, ranks, manifests);
  const dependencies = projectDependencies(input.comparison);
  const defaultSelectedUnitIds = comparisonDefaultSelectedUnitIds(input.comparison);
  const evidence = projectEvidence(input.comparison, ranks, conflicts);
  const objects = projectObjects(input.objects, input.comparison);
  const objectCount = new Set([
    ...objects.map((item) => item.objectRef),
    ...input.comparison.units.map((item) => item.primaryObject),
    ...input.comparison.dependencyEdges.map((item) => item.objectRef),
    ...input.comparison.conflicts.flatMap((item) => item.objectRefs),
  ]).size;
  const declared = orderedInputs.find((item) => item.intent !== undefined && item.intent.trim().length > 0);
  const task = declared === undefined
    ? {
        title: '候选创作方案审阅',
        acceptanceCriteria: [],
        candidateCount: candidates.length,
        objectCount,
        conflictCount: conflicts.length,
        statementSource: 'generated-fallback' as const,
      }
    : {
        title: declared.intent!,
        acceptanceCriteria: [...declared.acceptanceCriteria],
        candidateCount: candidates.length,
        objectCount,
        conflictCount: conflicts.length,
        statementSource: 'candidate-intent' as const,
      };
  const projection: HumanReviewProjection = {
    reviewVersion: '1.0.0',
    reviewId: input.reviewId,
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    projectIdentity: input.comparison.projectIdentity,
    expectedProjectRevision: input.comparison.expectedProjectRevision,
    task,
    candidates,
    safeGroups,
    conflicts,
    dependencies,
    defaultSelectedUnitIds,
    evidence,
    objects,
    sourceIdentity: {
      projectIdentity: input.comparison.projectIdentity,
      expectedProjectRevision: input.comparison.expectedProjectRevision,
      comparisonFingerprint: input.comparison.comparisonFingerprint,
    },
    reviewFingerprint: '',
  };
  projection.reviewFingerprint = await comparisonReviewFingerprintOf(projection, hasher);
  return projection;
}

export interface BuildResultReviewProjectionInput {
  reviewId: string;
  plan: IntegrationPlan;
  change: ChangeRecord;
  diffFingerprint: string;
  diff: ChangeDiff;
  freshness?: ReviewResultFreshness;
  runtimeTraceObservations: ReviewRuntimeTraceObservation[];
  resultTreeSha256: string;
  changedObjects?: ReviewObjectSummary[];
  warnings?: ReviewWarning[];
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Formal trace 与浏览器观察共用的可比较事件身份，不使用一次性 traceId。 */
export function reviewTraceObservationKey(value: unknown): string | undefined {
  const event = recordOf(value);
  const source = recordOf(event?.['source']);
  const kind = event?.['kind'];
  const sceneId = source?.['sceneId'];
  const index = source?.['index'];
  const op = source?.['op'];
  const file = source?.['file'];
  const line = source?.['line'];
  const col = source?.['col'];
  if (typeof kind !== 'string' || kind.length === 0
    || typeof sceneId !== 'string' || sceneId.length === 0
    || typeof index !== 'number' || !Number.isInteger(index)
    || typeof op !== 'string' || op.length === 0
    || typeof file !== 'string' || file.length === 0
    || typeof line !== 'number' || !Number.isInteger(line)
    || typeof col !== 'number' || !Number.isInteger(col)) return undefined;
  return [kind, sceneId, index, op, file.replace(/\\/g, '/'), line, col].join('|');
}

function resultNotReady(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_RESULT_NOT_READY', message);
}

function resultReviewFingerprintPayload(projection: HumanReviewProjection): Record<string, unknown> {
  return {
    reviewVersion: projection.reviewVersion,
    kind: projection.kind,
    projectIdentity: projection.projectIdentity,
    expectedProjectRevision: projection.expectedProjectRevision,
    task: projection.task,
    objects: projection.objects,
    defaultSelectedUnitIds: projection.defaultSelectedUnitIds,
    evidence: projection.finalResult?.evidence,
    finalResult: projection.finalResult,
    sourceIdentity: projection.sourceIdentity,
  };
}

function resultEvidenceOf(change: ChangeRecord): {
  evidence: ReviewFinalResult['evidence'];
  freshness: ReviewResultFreshness;
  runtimeWorkingRevision: number;
} {
  const workingRevision = change.workingRevision;
  const diff = evidenceFreshness(change.latestDiff, workingRevision);
  const validation = evidenceFreshness(change.latestValidation, workingRevision);
  const simulation = evidenceFreshness(change.latestSimulation, workingRevision);
  const runtime = change.runtimeTraces ?? [];
  if (diff.status !== 'fresh' || validation.status !== 'fresh' || simulation.status !== 'fresh') {
    throw resultNotReady('diff、validation 或 simulation evidence 不是当前 workingRevision 的 fresh/passed 事实');
  }
  if (change.latestValidation?.errors !== 0) {
    throw resultNotReady('validation evidence 仍有 error');
  }
  if (change.latestSimulation?.status !== 'passed') {
    throw resultNotReady('simulation evidence 未通过');
  }
  if (runtime.length === 0 || runtime.some((trace) =>
    trace.status !== 'passed' || trace.workingRevision !== workingRevision)) {
    throw resultNotReady('runtime trace 缺失、失败或不是当前 workingRevision 的 fresh 事实');
  }
  const runtimeTraceIds = runtime.map((trace) => trace.traceId).sort((left, right) => left.localeCompare(right));
  if (runtimeTraceIds.some((traceId) => traceId.length === 0)
    || new Set(runtimeTraceIds).size !== runtimeTraceIds.length) {
    throw resultNotReady('runtime trace identity 缺失或重复');
  }
  const diffEvidenceId = change.latestDiff?.evidenceId;
  const validationEvidenceId = change.latestValidation?.evidenceId;
  const simulationEvidenceId = change.latestSimulation?.evidenceId;
  if (diffEvidenceId === undefined || validationEvidenceId === undefined || simulationEvidenceId === undefined
    || diffEvidenceId.length === 0 || validationEvidenceId.length === 0 || simulationEvidenceId.length === 0) {
    throw resultNotReady('result evidence 缺少稳定 evidenceId');
  }
  return {
    evidence: {
      diffEvidenceId,
      validationEvidenceId,
      simulationEvidenceId,
      runtimeTraceIds,
    },
    freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
    runtimeWorkingRevision: workingRevision,
  };
}

function normalizedRuntimeTraceObservations(
  observations: readonly ReviewRuntimeTraceObservation[],
  expectedTraceIds: readonly string[],
): ReviewRuntimeTraceObservation[] {
  if (!Array.isArray(observations)) throw resultNotReady('runtime trace observations 缺失');
  const byTraceId = new Map<string, ReviewRuntimeTraceObservation>();
  for (const observation of observations) {
    if (typeof observation?.traceId !== 'string' || observation.traceId.length === 0
      || !Array.isArray(observation.observationKeys)
      || observation.observationKeys.some((key: unknown) => typeof key !== 'string' || key.length === 0)
      || byTraceId.has(observation.traceId)) {
      throw resultNotReady('runtime trace observations identity 无效或重复');
    }
    byTraceId.set(observation.traceId, {
      traceId: observation.traceId,
      observationKeys: sortedStrings(observation.observationKeys),
    });
  }
  const actualTraceIds = [...byTraceId.keys()].sort((left, right) => left.localeCompare(right));
  if (stableStringify(actualTraceIds) !== stableStringify(expectedTraceIds)) {
    throw resultNotReady('runtime trace observations 与 fresh runtime evidence 不匹配');
  }
  return actualTraceIds.map((traceId) => byTraceId.get(traceId)!);
}

export async function buildResultReviewProjection(
  input: BuildResultReviewProjectionInput,
  hasher: TextHasher,
): Promise<HumanReviewProjection> {
  const { plan, change } = input;
  const review = plan.review;
  if (review?.reviewState !== 'human-reviewed') {
    throw resultNotReady('只有 human-reviewed integration plan 才能生成结果审阅包');
  }
  const integration = change.integration;
  if (integration === undefined
    || integration.planId !== plan.planId
    || integration.planFingerprint !== plan.planFingerprint) {
    throw resultNotReady('integration change 与 reviewed plan identity 不匹配');
  }
  if (integration.status !== 'READY') {
    throw resultNotReady('integration change 尚未 READY');
  }
  // projectIdentity 是上层对真实 root identity 的稳定投影；authoring core 不知道
  // Node 的映射规则，CLI 在进入本函数前负责核对两者。这里仅校验 core 能看见的
  // change base revision，避免把两个不同层次的 identity 误作同一字符串。
  if (change.baseRevision !== plan.expectedProjectRevision) {
    throw resultNotReady('integration change 的基线 revision 已变化');
  }
  if (integration.review?.binding === undefined
    || stableStringify(integration.review.binding) !== stableStringify(review)) {
    throw resultNotReady('integration change 缺少匹配的 human review binding');
  }
  if (input.diffFingerprint.length === 0 || input.diff === undefined || input.resultTreeSha256.length === 0) {
    throw resultNotReady('result diff 或 preview tree 缺少稳定 identity');
  }

  const resultEvidence = resultEvidenceOf(change);
  if (input.freshness !== undefined
    && stableStringify(input.freshness) !== stableStringify(resultEvidence.freshness)) {
    throw resultNotReady('caller freshness 与 Authoring fresh evidence 不匹配');
  }
  const runtimeTraceObservations = normalizedRuntimeTraceObservations(
    input.runtimeTraceObservations,
    resultEvidence.evidence.runtimeTraceIds,
  );
  const orderedSourceCapsules = [...plan.sourceCapsules].sort(compareRefs);
  if (new Set(orderedSourceCapsules.map(candidateRefKey)).size !== orderedSourceCapsules.length) {
    throw resultNotReady('reviewed plan 含重复 source capsule identity');
  }
  const changedObjects = [...(input.changedObjects ?? [])]
    .sort((left, right) => left.objectRef.localeCompare(right.objectRef));
  const warnings = [...(input.warnings ?? [])];
  const finalResult: ReviewFinalResult = {
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    integrationChangeId: change.changeId,
    workingRevision: resultEvidence.runtimeWorkingRevision,
    diffFingerprint: input.diffFingerprint,
    changedObjects,
    evidence: resultEvidence.evidence,
    plan: {
      review,
      sourceCapsules: [...plan.sourceCapsules],
      sourceCandidates: orderedSourceCapsules.map((ref, index) => ({
        ref: { ...ref },
        displayOrdinal: String.fromCharCode('A'.charCodeAt(0) + index),
      })),
      selectedUnitIds: [...plan.selectedUnitIds],
      includedUnitIds: [...integration.includedUnitIds],
      implicitInclusions: [...plan.implicitInclusions],
      excludedUnitIds: [...plan.excludedUnitIds],
      conflictResolutions: [...plan.conflictResolutions],
      deduplicatedUnits: [...plan.deduplicatedUnits],
      replayOperations: [...plan.replayOperations],
      provenance: [...plan.provenance],
      finalObjectFingerprints: { ...plan.dryRun.finalObjectFingerprints },
    },
    diff: input.diff,
    freshness: resultEvidence.freshness,
    runtimeTraceObservations,
    resultTreeSha256: input.resultTreeSha256,
    warnings,
  };
  const projection: HumanReviewProjection = {
    reviewVersion: '1.0.0',
    reviewId: input.reviewId,
    kind: 'integration-result',
    state: 'STAGE_READY',
    projectIdentity: plan.projectIdentity,
    expectedProjectRevision: plan.expectedProjectRevision,
    task: {
      title: 'Integration result review',
      acceptanceCriteria: [],
      candidateCount: 0,
      objectCount: changedObjects.length,
      conflictCount: 0,
      statementSource: 'generated-fallback',
    },
    candidates: [],
    safeGroups: [],
    conflicts: [],
    dependencies: [],
    defaultSelectedUnitIds: [],
    evidence: {
      candidateMatrix: [],
      blockingCount: 0,
      selectionRequiredCount: 0,
      advisoryCount: warnings.length,
      canCreateDecision: false,
    },
    objects: changedObjects,
    finalResult,
    sourceIdentity: {
      projectIdentity: plan.projectIdentity,
      expectedProjectRevision: plan.expectedProjectRevision,
      comparisonFingerprint: plan.comparisonFingerprint,
      planFingerprint: plan.planFingerprint,
      integrationChangeId: change.changeId,
      workingRevision: change.workingRevision,
      decisionReviewId: review.reviewId,
      decisionId: review.decisionId,
      decisionFingerprint: review.decisionFingerprint,
    },
    reviewFingerprint: '',
  };
  projection.reviewFingerprint = await hasher.sha256(stableStringify(resultReviewFingerprintPayload(projection)));
  return projection;
}
