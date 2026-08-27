import { AuthoringOperationError, evidenceFreshness, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionComparison,
  VerifiedCompositionCandidate,
} from './composition-contracts.js';
import type { AuthoringObject, ChangeRecord, TextHasher } from './contracts.js';
import type { IntegrationPlan } from './integration-plan.js';
import type {
  HumanReviewProjection,
  ReviewCandidate,
  ReviewConflict,
  ReviewDependency,
  ReviewEvidenceSummary,
  ReviewFinalResult,
  ReviewObjectSummary,
  ReviewSafeGroup,
  ReviewWarning,
} from './review-contracts.js';

export interface BuildComparisonReviewProjectionInput {
  reviewId: string;
  comparison: CompositionComparison;
  candidates: Array<Pick<VerifiedCompositionCandidate,
    'candidateId' | 'ref' | 'evidenceSummary'> & {
      intent?: string;
      acceptanceCriteria: string[];
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
  return [...objects]
    .sort((left, right) => left.objectRef.localeCompare(right.objectRef))
    .map((object) => {
      const impact = impacts.get(object.objectRef) ?? { potentialImpact: [], observedImpact: [] };
      return {
        objectRef: object.objectRef,
        kind: object.kind,
        ...(object.semanticId === undefined ? {} : { semanticId: object.semanticId }),
        ...(object.source === undefined ? {} : {
          source: { path: object.source.path, line: object.source.line, col: object.source.col },
        }),
        references: sortedStrings(object.references),
        referencedBy: sortedStrings(object.referencedBy),
        potentialImpact: impact.potentialImpact,
        observedImpact: impact.observedImpact,
      };
    });
}

function projectSafeGroups(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
): ReviewSafeGroup[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.identicalGroups]
    .sort((left, right) => left.primaryObject.localeCompare(right.primaryObject) || left.groupId.localeCompare(right.groupId))
    .map((group) => {
      const unitIds = sortedStrings(group.unitIds);
      const candidateIds = [...new Set(unitIds
        .map((unitId) => unitsById.get(unitId)?.candidateId)
        .filter((candidateId): candidateId is string => candidateId !== undefined))]
        .sort((left, right) => compareCandidateIds(ranks, left, right));
      return {
        groupId: group.groupId,
        primaryObject: group.primaryObject,
        finalFingerprint: group.finalFingerprint,
        unitIds,
        candidateIds,
        sourceCount: candidateIds.length,
        includedByDefault: true,
      };
    });
}

function projectConflicts(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
): ReviewConflict[] {
  return [...comparison.conflicts]
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
    .map((conflict) => ({
      conflictId: conflict.conflictId,
      severity: conflict.severity,
      code: conflict.code,
      unitIds: sortedStrings(conflict.unitIds),
      candidateIds: sortedStrings(conflict.candidateIds)
        .sort((left, right) => compareCandidateIds(ranks, left, right)),
      objectRefs: sortedStrings(conflict.objectRefs),
      allowedResolutions: [...new Set(conflict.allowedResolutions)]
        .sort((left, right) => resolutionOrder(left) - resolutionOrder(right)),
      repairActions: [...conflict.repairActions],
    }));
}

function projectDependencies(comparison: CompositionComparison): ReviewDependency[] {
  return [...comparison.dependencyEdges]
    .sort((left, right) =>
      left.fromUnitId.localeCompare(right.fromUnitId)
      || left.toUnitId.localeCompare(right.toUnitId)
      || left.objectRef.localeCompare(right.objectRef))
    .map((edge) => ({
      fromUnitId: edge.fromUnitId,
      toUnitId: edge.toUnitId,
      objectRef: edge.objectRef,
      inclusion: 'implicit',
    }));
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
    }) => ({
      conflictId,
      severity,
      code,
      unitIds,
      candidateIds,
      objectRefs,
      allowedResolutions,
    })),
    dependencies: projection.dependencies,
    evidence: projection.evidence,
    objects: projection.objects.map(({ source, ...object }) => {
      void source;
      return object;
    }),
  };
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
  const safeGroups = projectSafeGroups(input.comparison, ranks);
  const conflicts = projectConflicts(input.comparison, ranks);
  const dependencies = projectDependencies(input.comparison);
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
        title: 'Candidate composition review',
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
    evidence,
    objects,
    sourceIdentity: {
      projectIdentity: input.comparison.projectIdentity,
      expectedProjectRevision: input.comparison.expectedProjectRevision,
      comparisonFingerprint: input.comparison.comparisonFingerprint,
    },
    reviewFingerprint: '',
  };
  projection.reviewFingerprint = await hasher.sha256(stableStringify(reviewFingerprintPayload(projection)));
  return projection;
}

export interface BuildResultReviewProjectionInput {
  reviewId: string;
  plan: IntegrationPlan;
  change: ChangeRecord;
  diffFingerprint: string;
  resultTreeSha256: string;
  changedObjects?: ReviewObjectSummary[];
  warnings?: ReviewWarning[];
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
    evidence: projection.finalResult?.evidence,
    finalResult: projection.finalResult,
    sourceIdentity: projection.sourceIdentity,
  };
}

function resultEvidenceOf(change: ChangeRecord): {
  evidence: ReviewFinalResult['evidence'];
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
      runtimeTraceIds: runtime.map((trace) => trace.traceId).sort((left, right) => left.localeCompare(right)),
    },
    runtimeWorkingRevision: workingRevision,
  };
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
  if (input.diffFingerprint.length === 0 || input.resultTreeSha256.length === 0) {
    throw resultNotReady('result diff 或 preview tree 缺少稳定 identity');
  }

  const resultEvidence = resultEvidenceOf(change);
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
