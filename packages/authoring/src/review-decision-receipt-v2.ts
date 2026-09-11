import { AuthoringOperationError, stableStringify } from './change-session.js';
import type { CandidateCapsuleRef } from './composition-contracts.js';
import type { TextHasher } from './contracts.js';
import {
  integrationPlanContentFingerprintOf,
  type ConflictResolutionInput,
  type IntegrationPlan,
  type IntegrationPlanDraft,
} from './integration-plan.js';
import type { IntegrationReviewBinding } from './review-receipts.js';
import {
  assertReviewDecisionPreviewSavable,
  normalizeReviewDecisionIntent,
  isReviewDecisionIntent,
  isReviewCustomSelection,
  type ReviewDecisionIntent,
  type ReviewDecisionPreview,
  type ReviewDecisionResolutionInput,
} from './review-decision-preview.js';

export interface ComparisonDecisionReceiptV2 {
  receiptVersion: '2.0.0';
  decisionId: string;
  reviewId: string;
  reviewFingerprint: string;
  comparisonFingerprint: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  candidateRefs: CandidateCapsuleRef[];
  decisionIntent: ReviewDecisionIntent;
  selectedUnitIds: string[];
  conflictResolutions: ReviewDecisionResolutionInput[];
  planContentFingerprint: string;
  previewFingerprint: string;
  reviewerChannel: 'surdet-editor-local';
  decidedAt: string;
  decisionFingerprint: string;
}

/** Shared by Node and Editor when reading external terminal payloads. */
export function isComparisonDecisionReceiptV2(value: unknown): value is ComparisonDecisionReceiptV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const identifier = (item: unknown): item is string =>
    typeof item === 'string' && item.length > 0 && item.length <= 256 && !/[\u0000-\u001f\u007f]/.test(item);
  const fingerprint = (item: unknown): boolean => typeof item === 'string' && /^[0-9a-f]{64}$/.test(item);
  return receipt['receiptVersion'] === '2.0.0'
    && ['decisionId', 'reviewId', 'projectIdentity', 'expectedProjectRevision', 'decidedAt']
      .every((key) => identifier(receipt[key]))
    && ['reviewFingerprint', 'comparisonFingerprint', 'planContentFingerprint', 'previewFingerprint', 'decisionFingerprint']
      .every((key) => fingerprint(receipt[key]))
    && receipt['reviewerChannel'] === 'surdet-editor-local'
    && isReviewDecisionIntent(receipt['decisionIntent'])
    && isReviewCustomSelection({
      selectedUnitIds: receipt['selectedUnitIds'], conflictResolutions: receipt['conflictResolutions'],
    })
    && Array.isArray(receipt['candidateRefs']) && receipt['candidateRefs'].length > 0
    && receipt['candidateRefs'].every((item) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
      const ref = item as Record<string, unknown>;
      return identifier(ref['changeId']) && identifier(ref['capsuleId']) && fingerprint(ref['artifactSha256']);
    });
}

export interface VerifiedComparisonDecisionV2 {
  receipt: ComparisonDecisionReceiptV2;
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  review: Extract<IntegrationReviewBinding, { reviewState: 'human-reviewed' }>;
}

function invalid(message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_INVALID', message, details);
}

function stale(message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_STALE', message, details);
}

function candidateRefKey(ref: CandidateCapsuleRef): string {
  return [ref.artifactSha256, ref.changeId, ref.capsuleId].join('\u0000');
}

function normalizeCandidateRefs(refs: readonly CandidateCapsuleRef[]): CandidateCapsuleRef[] {
  return [...refs]
    .map((ref) => ({ ...ref }))
    .sort((left, right) => candidateRefKey(left).localeCompare(candidateRefKey(right)));
}

function normalizeResolutions(
  resolutions: readonly ReviewDecisionResolutionInput[],
): ReviewDecisionResolutionInput[] {
  return [...resolutions]
    .map((resolution) => ({
      conflictId: resolution.conflictId,
      resolution: resolution.resolution,
      ...(resolution.chosenUnitId === undefined ? {} : { chosenUnitId: resolution.chosenUnitId }),
    }))
    .sort((left, right) =>
      left.conflictId.localeCompare(right.conflictId)
      || left.resolution.localeCompare(right.resolution)
      || (left.chosenUnitId ?? '').localeCompare(right.chosenUnitId ?? ''));
}

function normalizedReceiptPayload(
  receipt: Omit<ComparisonDecisionReceiptV2, 'decisionFingerprint'>,
): Record<string, unknown> {
  return {
    receiptVersion: receipt.receiptVersion,
    decisionId: receipt.decisionId,
    reviewId: receipt.reviewId,
    reviewFingerprint: receipt.reviewFingerprint,
    comparisonFingerprint: receipt.comparisonFingerprint,
    projectIdentity: receipt.projectIdentity,
    expectedProjectRevision: receipt.expectedProjectRevision,
    candidateRefs: normalizeCandidateRefs(receipt.candidateRefs),
    decisionIntent: normalizeReviewDecisionIntent(receipt.decisionIntent),
    selectedUnitIds: [...receipt.selectedUnitIds].sort((left, right) => left.localeCompare(right)),
    conflictResolutions: normalizeResolutions(receipt.conflictResolutions),
    planContentFingerprint: receipt.planContentFingerprint,
    previewFingerprint: receipt.previewFingerprint,
    reviewerChannel: receipt.reviewerChannel,
  };
}

export async function decisionFingerprintV2Of(
  receipt: Omit<ComparisonDecisionReceiptV2, 'decisionFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify(normalizedReceiptPayload(receipt)));
}

function sameStableValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

export async function validateComparisonDecisionV2(input: {
  receipt: ComparisonDecisionReceiptV2;
  preview: ReviewDecisionPreview;
  projectIdentity: string;
  expectedProjectRevision: string;
  candidateRefs: readonly CandidateCapsuleRef[];
}, hasher: TextHasher): Promise<VerifiedComparisonDecisionV2> {
  const { receipt, preview } = input;
  assertReviewDecisionPreviewSavable(preview);

  if (receipt.receiptVersion !== '2.0.0'
    || receipt.reviewerChannel !== 'surdet-editor-local'
    || receipt.decisionId.length === 0
    || receipt.decidedAt.length === 0) {
    throw invalid('v2 决定回执版本、渠道或必要标识无效');
  }
  if (receipt.reviewId !== preview.reviewId
    || receipt.reviewFingerprint !== preview.reviewFingerprint
    || receipt.comparisonFingerprint !== preview.comparisonFingerprint
    || receipt.projectIdentity !== input.projectIdentity
    || receipt.expectedProjectRevision !== input.expectedProjectRevision) {
    throw stale('v2 决定回执与当前 review、comparison 或项目基线不一致');
  }
  const expectedRefs = normalizeCandidateRefs(input.candidateRefs);
  const actualRefs = normalizeCandidateRefs(receipt.candidateRefs);
  if (!sameStableValue(actualRefs, expectedRefs)) {
    throw stale('v2 决定回执绑定的候选引用已变化');
  }
  if (receipt.previewFingerprint !== preview.previewFingerprint
    || receipt.planContentFingerprint !== preview.planContentFingerprint) {
    throw stale('v2 决定回执没有绑定保存时重新计算的预览内容', {
      expectedPreviewFingerprint: preview.previewFingerprint,
      actualPreviewFingerprint: receipt.previewFingerprint,
      expectedPlanContentFingerprint: preview.planContentFingerprint,
      actualPlanContentFingerprint: receipt.planContentFingerprint,
    });
  }
  if (!sameStableValue(
    normalizeReviewDecisionIntent(receipt.decisionIntent),
    normalizeReviewDecisionIntent(preview.decisionIntent),
  )) {
    throw invalid('v2 决定意图与重新计算的预览不一致');
  }

  const selectedUnitIds = [...receipt.selectedUnitIds];
  if (selectedUnitIds.some((unitId) => unitId.length === 0)
    || new Set(selectedUnitIds).size !== selectedUnitIds.length) {
    throw invalid('v2 决定回执的 selectedUnitIds 含空值或重复项');
  }
  if (!sameStableValue(
    [...selectedUnitIds].sort((left, right) => left.localeCompare(right)),
    [...preview.selectedUnitIds].sort((left, right) => left.localeCompare(right)),
  )) {
    throw invalid('v2 决定回执的低层选择与重新计算的预览不一致');
  }
  if (!sameStableValue(
    normalizeResolutions(receipt.conflictResolutions),
    normalizeResolutions(preview.conflictResolutions),
  )) {
    throw invalid('v2 决定回执的冲突裁决与重新计算的预览不一致');
  }

  const expectedFingerprint = await decisionFingerprintV2Of(receipt, hasher);
  if (receipt.decisionFingerprint !== expectedFingerprint) {
    throw invalid('v2 decisionFingerprint 与回执内容不符');
  }

  return {
    receipt,
    selectedUnitIds: [...preview.selectedUnitIds].sort((left, right) => left.localeCompare(right)),
    conflictResolutions: preview.conflictResolutions.map((resolution) => ({
      conflictId: resolution.conflictId,
      resolution: resolution.resolution,
      ...(resolution.chosenUnitId === undefined ? {} : { chosenUnitId: resolution.chosenUnitId }),
      actor: 'human' as const,
    })),
    review: {
      reviewState: 'human-reviewed',
      reviewId: receipt.reviewId,
      decisionId: receipt.decisionId,
      decisionFingerprint: receipt.decisionFingerprint,
    },
  };
}

/**
 * 正式 composition.plan 在使用 human-reviewed binding 构造并 dry-run 后调用。
 * 这里比较的是不含 review binding 的稳定组合内容，不比较正式 planFingerprint。
 */
export async function assertDecisionPlanContentFingerprint(input: {
  receipt: Pick<ComparisonDecisionReceiptV2, 'planContentFingerprint'>;
  draft: IntegrationPlanDraft;
  dryRun: IntegrationPlan['dryRun'];
}, hasher: TextHasher): Promise<void> {
  const actual = await integrationPlanContentFingerprintOf(input.draft, input.dryRun, hasher);
  if (actual !== input.receipt.planContentFingerprint) {
    throw stale('正式计划内容已经离开已保存决定的预览内容', {
      expectedPlanContentFingerprint: input.receipt.planContentFingerprint,
      actualPlanContentFingerprint: actual,
    });
  }
}
