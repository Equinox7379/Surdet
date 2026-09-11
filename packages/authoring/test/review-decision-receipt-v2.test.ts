import { describe, expect, it } from 'vitest';
import type { TextHasher } from '../src/contracts.js';
import {
  integrationPlanContentFingerprintOf,
  type IntegrationPlan,
  type IntegrationPlanDraft,
} from '../src/integration-plan.js';
import {
  assertDecisionPlanContentFingerprint,
  decisionFingerprintV2Of,
  validateComparisonDecisionV2,
  type ComparisonDecisionReceiptV2,
} from '../src/review-decision-receipt-v2.js';
import type { ReviewDecisionPreview } from '../src/review-decision-preview.js';

const hasher: TextHasher = {
  sha256: async (text) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  },
};

const candidate = {
  candidateId: 'cand-a',
  ref: {
    changeId: 'change-a',
    capsuleId: 'capsule-a',
    artifactSha256: 'artifact-a',
  },
};

function draft(review: IntegrationPlanDraft['review']): IntegrationPlanDraft {
  return {
    planVersion: '1.0.0',
    projectIdentity: 'project-wave9',
    expectedProjectRevision: 'revision-wave9',
    comparisonFingerprint: 'comparison-wave9',
    review,
    sourceCapsules: [candidate.ref],
    selectedUnitIds: ['unit-a'],
    implicitInclusions: [],
    excludedUnitIds: ['unit-b'],
    conflictResolutions: [{
      conflictId: 'conflict-shared',
      resolution: 'choose-unit',
      chosenUnitId: 'unit-a',
      actor: 'human',
      decidedAt: '2026-09-11T12:00:00.000Z',
    }],
    deduplicatedUnits: [],
    replayOperations: [],
    provenance: [],
  };
}

const dryRun: IntegrationPlan['dryRun'] = {
  status: 'passed',
  finalObjectFingerprints: { 'scene:entry': 'result-a' },
  errors: [],
};

async function fixture(): Promise<{
  receipt: ComparisonDecisionReceiptV2;
  preview: ReviewDecisionPreview;
  unreviewedDraft: IntegrationPlanDraft;
}> {
  const unreviewedDraft = draft({ reviewState: 'unreviewed' });
  const planContentFingerprint = await integrationPlanContentFingerprintOf(
    unreviewedDraft,
    dryRun,
    hasher,
  );
  const preview: ReviewDecisionPreview = {
    previewVersion: '1.0.0',
    reviewId: 'review-wave9',
    reviewFingerprint: 'review-fingerprint-wave9',
    comparisonFingerprint: 'comparison-wave9',
    decisionIntent: { mode: 'adopt-candidate', candidate },
    status: 'ready',
    selectedUnitIds: ['unit-a'],
    conflictResolutions: [{
      conflictId: 'conflict-shared',
      resolution: 'choose-unit',
      chosenUnitId: 'unit-a',
    }],
    effectiveUnitIds: ['unit-a'],
    implicitInclusions: [],
    excludedUnitIds: ['unit-b'],
    planContentFingerprint,
    dryRun,
    previewFingerprint: 'preview-fingerprint-wave9',
  };
  const unsigned: Omit<ComparisonDecisionReceiptV2, 'decisionFingerprint'> = {
    receiptVersion: '2.0.0',
    decisionId: 'decision-wave9',
    reviewId: preview.reviewId,
    reviewFingerprint: preview.reviewFingerprint,
    comparisonFingerprint: preview.comparisonFingerprint,
    projectIdentity: 'project-wave9',
    expectedProjectRevision: 'revision-wave9',
    candidateRefs: [candidate.ref],
    decisionIntent: preview.decisionIntent,
    selectedUnitIds: [...preview.selectedUnitIds],
    conflictResolutions: preview.conflictResolutions.map((item) => ({ ...item })),
    planContentFingerprint,
    previewFingerprint: preview.previewFingerprint,
    reviewerChannel: 'surdet-editor-local',
    decidedAt: '2026-09-11T12:05:00.000Z',
  };
  return {
    preview,
    unreviewedDraft,
    receipt: {
      ...unsigned,
      decisionFingerprint: await decisionFingerprintV2Of(unsigned, hasher),
    },
  };
}

describe('Wave 9 v2 comparison decision receipt', () => {
  it('binds the high-level intent and exact recomputed preview without using planFingerprint', async () => {
    const { receipt, preview } = await fixture();
    const verified = await validateComparisonDecisionV2({
      receipt,
      preview,
      projectIdentity: 'project-wave9',
      expectedProjectRevision: 'revision-wave9',
      candidateRefs: [candidate.ref],
    }, hasher);
    expect(verified.review).toEqual({
      reviewState: 'human-reviewed',
      reviewId: receipt.reviewId,
      decisionId: receipt.decisionId,
      decisionFingerprint: receipt.decisionFingerprint,
    });
    expect(verified.selectedUnitIds).toEqual(['unit-a']);
  });

  it('rejects a receipt that claims whole A but changes the derived low-level selection', async () => {
    const { receipt, preview } = await fixture();
    const tampered = {
      ...receipt,
      selectedUnitIds: ['unit-a', 'unit-b'],
    };
    tampered.decisionFingerprint = await decisionFingerprintV2Of(tampered, hasher);
    await expect(validateComparisonDecisionV2({
      receipt: tampered,
      preview,
      projectIdentity: 'project-wave9',
      expectedProjectRevision: 'revision-wave9',
      candidateRefs: [candidate.ref],
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });
  });

  it('accepts the same content under a later human-reviewed binding and rejects changed dry-run content', async () => {
    const { receipt } = await fixture();
    const formalDraft = draft({
      reviewState: 'human-reviewed',
      reviewId: receipt.reviewId,
      decisionId: receipt.decisionId,
      decisionFingerprint: receipt.decisionFingerprint,
    });
    await expect(assertDecisionPlanContentFingerprint({
      receipt,
      draft: formalDraft,
      dryRun,
    }, hasher)).resolves.toBeUndefined();
    await expect(assertDecisionPlanContentFingerprint({
      receipt,
      draft: formalDraft,
      dryRun: {
        ...dryRun,
        finalObjectFingerprints: { 'scene:entry': 'changed-result' },
      },
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_STALE' });
  });
});
