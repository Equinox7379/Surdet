import { AuthoringOperationError, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
} from './composition-contracts.js';
import type { ConflictResolutionInput } from './integration-plan.js';
import type { TextHasher } from './contracts.js';
import type { HumanReviewProjection, ReviewConflict } from './review-contracts.js';

export interface ComparisonDecisionReceipt {
  receiptVersion: '1.0.0';
  decisionId: string;
  reviewId: string;
  comparisonFingerprint: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  candidateRefs: CandidateCapsuleRef[];
  selectedUnitIds: string[];
  conflictResolutions: Array<{
    conflictId: string;
    resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
    chosenUnitId?: string;
  }>;
  reviewerChannel: 'surdet-editor-local';
  decidedAt: string;
  decisionFingerprint: string;
}

export type IntegrationReviewBinding =
  | { reviewState: 'unreviewed' }
  | {
      reviewState: 'human-reviewed';
      reviewId: string;
      decisionId: string;
      decisionFingerprint: string;
    };

export interface VerifiedComparisonDecision {
  receipt: ComparisonDecisionReceipt;
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  review: Extract<IntegrationReviewBinding, { reviewState: 'human-reviewed' }>;
}

export interface DecisionPlanSelection {
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  review: Extract<IntegrationReviewBinding, { reviewState: 'human-reviewed' }>;
}

function invalid(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_INVALID', message);
}

function stale(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_STALE', message);
}

function returned(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_RETURNED', message);
}

function candidateRefKey(ref: CandidateCapsuleRef): string {
  return [ref.artifactSha256, ref.changeId, ref.capsuleId].join('\u0000');
}

function normalizeCandidateRefs(refs: readonly CandidateCapsuleRef[]): CandidateCapsuleRef[] {
  return [...refs]
    .map((ref) => ({ ...ref }))
    .sort((left, right) =>
      left.artifactSha256.localeCompare(right.artifactSha256)
      || left.changeId.localeCompare(right.changeId)
      || left.capsuleId.localeCompare(right.capsuleId));
}

function normalizeReceiptResolutions(
  resolutions: readonly ComparisonDecisionReceipt['conflictResolutions'][number][],
): Array<{ conflictId: string; resolution: string; chosenUnitId?: string }> {
  return [...resolutions]
    .map((item) => ({
      conflictId: item.conflictId,
      resolution: item.resolution,
      ...(item.chosenUnitId === undefined ? {} : { chosenUnitId: item.chosenUnitId }),
    }))
    .sort((left, right) =>
      left.conflictId.localeCompare(right.conflictId)
      || left.resolution.localeCompare(right.resolution)
      || (left.chosenUnitId ?? '').localeCompare(right.chosenUnitId ?? ''));
}

export async function decisionFingerprintOf(
  receipt: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify({
    receiptVersion: receipt.receiptVersion,
    decisionId: receipt.decisionId,
    reviewId: receipt.reviewId,
    comparisonFingerprint: receipt.comparisonFingerprint,
    projectIdentity: receipt.projectIdentity,
    expectedProjectRevision: receipt.expectedProjectRevision,
    candidateRefs: normalizeCandidateRefs(receipt.candidateRefs),
    selectedUnitIds: [...receipt.selectedUnitIds].sort(),
    conflictResolutions: normalizeReceiptResolutions(receipt.conflictResolutions),
    reviewerChannel: receipt.reviewerChannel,
  }));
}

function selectionConflicts(projection: HumanReviewProjection): ReviewConflict[] {
  return projection.conflicts.filter((conflict) => conflict.severity === 'selection-required');
}

export async function validateComparisonDecision(input: {
  projection: HumanReviewProjection;
  receipt: ComparisonDecisionReceipt;
}, hasher: TextHasher): Promise<VerifiedComparisonDecision> {
  const { projection, receipt } = input;
  if (projection.kind !== 'comparison' || projection.state !== 'COMPARISON_PREPARED') {
    throw invalid('review projection 不是可接收决定的 comparison');
  }
  if (receipt.reviewId !== projection.reviewId
    || receipt.comparisonFingerprint !== projection.sourceIdentity.comparisonFingerprint
    || receipt.projectIdentity !== projection.sourceIdentity.projectIdentity
    || receipt.expectedProjectRevision !== projection.sourceIdentity.expectedProjectRevision) {
    throw stale('决定对应的 review/comparison/project identity 已变化');
  }
  const expectedCandidateRefs = normalizeCandidateRefs(projection.candidates.map((candidate) => candidate.ref));
  const actualCandidateRefs = normalizeCandidateRefs(receipt.candidateRefs);
  if (stableStringify(actualCandidateRefs) !== stableStringify(expectedCandidateRefs)) {
    throw stale('决定对应的 candidateRefs 已变化');
  }
  if (receipt.receiptVersion !== '1.0.0' || receipt.reviewerChannel !== 'surdet-editor-local') {
    throw invalid('决定回执版本或 reviewerChannel 非法');
  }
  if (receipt.decisionId.length === 0 || receipt.decidedAt.length === 0) {
    throw invalid('决定回执缺少 decisionId 或 decidedAt');
  }
  const expectedFingerprint = await decisionFingerprintOf(receipt, hasher);
  if (receipt.decisionFingerprint !== expectedFingerprint) {
    throw invalid('decisionFingerprint 与决定内容不符');
  }

  const selectedUnitIds = [...new Set(receipt.selectedUnitIds)];
  if (selectedUnitIds.length !== receipt.selectedUnitIds.length
    || selectedUnitIds.some((unitId) => unitId.length === 0)) {
    throw invalid('selectedUnitIds 含重复或空 ID');
  }
  if (!projection.evidence.canCreateDecision
    || projection.conflicts.some((conflict) => conflict.severity === 'blocking')) {
    throw invalid('blocking conflict 或不可决定的 review 不允许生成 plan');
  }

  const conflicts = selectionConflicts(projection);
  const conflictById = new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const resolutionById = new Map<string, ComparisonDecisionReceipt['conflictResolutions'][number]>();
  for (const resolution of receipt.conflictResolutions) {
    if (resolutionById.has(resolution.conflictId)) {
      throw invalid('同一 selection-required conflict 出现多条决定：' + resolution.conflictId);
    }
    const conflict = conflictById.get(resolution.conflictId);
    if (conflict === undefined) {
      throw invalid('决定指向未知或不可决定的 conflict：' + resolution.conflictId);
    }
    if (!conflict.allowedResolutions.includes(resolution.resolution)) {
      throw invalid('决定动作不在 conflict 允许列表：' + resolution.conflictId);
    }
    resolutionById.set(resolution.conflictId, resolution);
  }
  for (const conflict of conflicts) {
    const resolution = resolutionById.get(conflict.conflictId);
    if (resolution === undefined) {
      throw invalid('selection-required conflict 缺少决定：' + conflict.conflictId);
    }
    if (resolution.resolution === 'choose-unit') {
      if (resolution.chosenUnitId === undefined || !conflict.unitIds.includes(resolution.chosenUnitId)) {
        throw invalid('choose-unit 的 chosenUnitId 不在 conflict 单元列表：' + conflict.conflictId);
      }
      if (!selectedUnitIds.includes(resolution.chosenUnitId)) {
        throw invalid('choose-unit 的 chosenUnitId 未被 selectedUnitIds 选中：' + conflict.conflictId);
      }
    } else if (resolution.chosenUnitId !== undefined) {
      throw invalid('非 choose-unit 决定不能携带 chosenUnitId：' + conflict.conflictId);
    }
    if (resolution.resolution === 'regenerate-candidate') {
      throw returned('人类要求重新生成候选：' + conflict.conflictId);
    }
  }

  const conflictResolutions: ConflictResolutionInput[] = [...resolutionById.values()]
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
    .map((resolution) => ({
      conflictId: resolution.conflictId,
      resolution: resolution.resolution,
      ...(resolution.chosenUnitId === undefined ? {} : { chosenUnitId: resolution.chosenUnitId }),
      actor: 'human' as const,
    }));
  return {
    receipt,
    selectedUnitIds: [...selectedUnitIds].sort(),
    conflictResolutions,
    review: {
      reviewState: 'human-reviewed',
      reviewId: receipt.reviewId,
      decisionId: receipt.decisionId,
      decisionFingerprint: receipt.decisionFingerprint,
    },
  };
}

export function decisionToPlanSelection(
  verified: VerifiedComparisonDecision,
): DecisionPlanSelection {
  return {
    selectedUnitIds: [...verified.selectedUnitIds],
    conflictResolutions: verified.conflictResolutions.map((resolution) => ({
      ...resolution,
      actor: 'human' as const,
    })),
    review: { ...verified.review },
  };
}
