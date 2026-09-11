import {
  AuthoringOperationError,
  assertReviewDecisionPreviewFingerprint,
  assertReviewDecisionPreviewSavable,
  buildReviewDecisionPreview,
  deriveReviewDecisionSelection,
  type ReviewCustomSelectionInput,
  type ReviewDecisionCandidate,
  type ReviewDecisionIntent,
  type ReviewDecisionPreview,
  type TextHasher,
} from '@surdet/authoring';
import type { CompositionService } from './composition-service.js';

export const REVIEW_PREVIEW_DECIDED_AT = '1970-01-01T00:00:00.000Z' as const;

export interface ReviewDecisionPreviewSource {
  reviewId: string;
  reviewFingerprint: string;
  comparisonFingerprint: string;
  candidates: ReviewDecisionCandidate[];
}

export interface PrepareReviewDecisionPreviewInput {
  source: ReviewDecisionPreviewSource;
  intent: ReviewDecisionIntent;
  customSelection?: ReviewCustomSelectionInput;
  expectedPreviewFingerprint?: string;
}

function stale(message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_STALE', message, details);
}

export async function prepareReviewDecisionPreview(
  composition: Pick<CompositionService, 'compare' | 'preparePlan' | 'hasher'>,
  input: PrepareReviewDecisionPreviewInput,
  hasher: TextHasher = composition.hasher,
): Promise<ReviewDecisionPreview> {
  const candidateRefs = input.source.candidates.map((candidate) => ({ ...candidate.ref }));
  const compared = await composition.compare(candidateRefs);
  if (compared.comparison.comparisonFingerprint !== input.source.comparisonFingerprint) {
    throw stale('当前 comparison 已离开审阅工作区基线', {
      reviewId: input.source.reviewId,
      expectedComparisonFingerprint: input.source.comparisonFingerprint,
      actualComparisonFingerprint: compared.comparison.comparisonFingerprint,
    });
  }

  const selection = deriveReviewDecisionSelection({
    comparison: compared.comparison,
    candidates: input.source.candidates,
    intent: input.intent,
    ...(input.customSelection === undefined ? {} : { customSelection: input.customSelection }),
  });
  const prepared = await composition.preparePlan({
    candidateRefs,
    comparisonFingerprint: input.source.comparisonFingerprint,
    selectedUnitIds: selection.selectedUnitIds,
    conflictResolutions: selection.conflictResolutions,
    review: { reviewState: 'unreviewed' },
    now: REVIEW_PREVIEW_DECIDED_AT,
  });
  const preview = await buildReviewDecisionPreview({
    reviewId: input.source.reviewId,
    reviewFingerprint: input.source.reviewFingerprint,
    comparison: prepared.comparison,
    candidates: input.source.candidates,
    intent: input.intent,
    draft: prepared.draft,
    dryRun: prepared.dryRun,
  }, hasher);
  if (input.expectedPreviewFingerprint !== undefined) {
    assertReviewDecisionPreviewFingerprint(input.expectedPreviewFingerprint, preview);
    assertReviewDecisionPreviewSavable(preview);
  }
  return preview;
}
