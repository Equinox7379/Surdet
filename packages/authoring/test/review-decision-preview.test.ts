import { describe, expect, it } from 'vitest';
import { compareCandidates } from '../src/candidate-comparison.js';
import {
  buildIntegrationPlan,
  integrationPlanContentFingerprintOf,
  sealDryRunResult,
  type IntegrationPlan,
  type IntegrationPlanDraft,
} from '../src/integration-plan.js';
import {
  assertReviewDecisionPreviewFingerprint,
  assertWholeCandidatePlanIntegrity,
  buildReviewDecisionPreview,
  deriveWholeCandidateSelection,
  type ReviewDecisionCandidate,
} from '../src/review-decision-preview.js';
import type {
  CandidateEvidenceSummary,
  CompositionComparison,
  CompositionManifest,
  CompositionOperation,
  ObjectProduction,
  ObjectRequirement,
  VerifiedCompositionCandidate,
} from '../src/composition-contracts.js';
import type { TextHasher } from '../src/contracts.js';

const PROJECT = 'project-wave9';
const BASE = 'revision-wave9';
const NOW_A = '2026-09-11T12:00:00.000Z';
const NOW_B = '2026-09-11T12:30:00.000Z';

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

const freshEvidence: CandidateEvidenceSummary = {
  validation: 'fresh',
  simulation: 'fresh',
  runtime: 'fresh',
  warnings: 0,
  manualReviewRequired: [],
};

function production(
  objectRef: string,
  disposition: ObjectProduction['disposition'],
  finalFingerprint: string,
): ObjectProduction {
  return { objectRef, disposition, finalFingerprint };
}

function requirement(
  objectRef: string,
  source: ObjectRequirement['source'],
  candidateOperationSequence?: number,
): ObjectRequirement {
  return {
    objectRef,
    source,
    ...(candidateOperationSequence === undefined ? {} : { candidateOperationSequence }),
  };
}

function operation(input: {
  sequence: number;
  sourceOperationId: string;
  capabilityId: CompositionOperation['capabilityId'];
  primaryObject: string;
  finalFingerprint: string;
  requiredObjects?: ObjectRequirement[];
}): CompositionOperation {
  return {
    sequence: input.sequence,
    capabilityId: input.capabilityId,
    sourceOperationId: input.sourceOperationId,
    normalizedInput: { operationId: input.sourceOperationId },
    inputSha256: `sha-${input.sourceOperationId}`,
    primaryObject: input.primaryObject,
    requiredObjects: input.requiredObjects ?? [],
    producedObjects: [production(input.primaryObject, 'create', input.finalFingerprint)],
  };
}

function readyCandidate(
  changeId: string,
  operations: CompositionOperation[],
): VerifiedCompositionCandidate {
  const manifest: CompositionManifest = {
    manifestVersion: '1.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: BASE,
    sourceChangeId: changeId,
    sourceWorkingRevision: operations.length,
    operations,
    manifestFingerprint: `manifest-${changeId}`,
  };
  return {
    candidateId: `cand-${changeId}`,
    ref: {
      changeId,
      capsuleId: `capsule-${changeId}`,
      artifactSha256: `artifact-${changeId}`,
    },
    capsuleVersion: '2.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: BASE,
    sourceWorkingRevision: operations.length,
    composition: { eligibility: 'ready', reasons: [], manifest },
    evidenceSummary: freshEvidence,
    semanticDiff: [],
  };
}

async function comparisonOf(candidates: VerifiedCompositionCandidate[]): Promise<{
  comparison: CompositionComparison & { candidateManifests?: Record<string, CompositionManifest> };
  reviewCandidates: ReviewDecisionCandidate[];
}> {
  const comparison = await compareCandidates({
    projectIdentity: PROJECT,
    currentProjectRevision: BASE,
    candidates,
  }, hasher) as CompositionComparison & { candidateManifests?: Record<string, CompositionManifest> };
  comparison.candidateManifests = Object.fromEntries(candidates.map((candidate) => [
    candidate.candidateId,
    candidate.composition.manifest!,
  ]));
  return {
    comparison,
    reviewCandidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      ref: candidate.ref,
    })),
  };
}

function dryRun(finalObjectFingerprints: Record<string, string>): IntegrationPlan['dryRun'] {
  return { status: 'passed', finalObjectFingerprints, errors: [] };
}

describe('Wave 9 whole-proposal decision preview', () => {
  it('keeps every selected-candidate change, including non-conflicting objects, and executes no foreign-only unit', async () => {
    const candidateA = readyCandidate('a', [
      operation({ sequence: 0, sourceOperationId: 'a-timeline', capabilityId: 'timeline.create', primaryObject: 'timeline:a-opening', finalFingerprint: 'fp-a-timeline' }),
      operation({ sequence: 1, sourceOperationId: 'a-variable', capabilityId: 'variable.ensure', primaryObject: 'variable:a-route', finalFingerprint: 'fp-a-variable' }),
      operation({
        sequence: 2,
        sourceOperationId: 'a-scene',
        capabilityId: 'scene.create',
        primaryObject: 'scene:shared-entry',
        finalFingerprint: 'fp-a-scene',
        requiredObjects: [
          requirement('timeline:a-opening', 'candidate', 0),
          requirement('variable:a-route', 'candidate', 1),
        ],
      }),
      operation({ sequence: 3, sourceOperationId: 'a-entry', capabilityId: 'project.entry-scene.set', primaryObject: 'config:entryScene', finalFingerprint: 'fp-a-entry', requiredObjects: [requirement('scene:shared-entry', 'candidate', 2)] }),
    ]);
    const candidateB = readyCandidate('b', [
      operation({ sequence: 0, sourceOperationId: 'b-timeline', capabilityId: 'timeline.create', primaryObject: 'timeline:b-opening', finalFingerprint: 'fp-b-timeline' }),
      operation({ sequence: 1, sourceOperationId: 'b-variable', capabilityId: 'variable.ensure', primaryObject: 'variable:b-route', finalFingerprint: 'fp-b-variable' }),
      operation({ sequence: 2, sourceOperationId: 'b-scene', capabilityId: 'scene.create', primaryObject: 'scene:shared-entry', finalFingerprint: 'fp-b-scene' }),
      operation({ sequence: 3, sourceOperationId: 'b-only-scene', capabilityId: 'scene.create', primaryObject: 'scene:b-only', finalFingerprint: 'fp-b-only' }),
    ]);
    const { comparison, reviewCandidates } = await comparisonOf([candidateA, candidateB]);
    const intent = { mode: 'adopt-candidate' as const, candidate: reviewCandidates[0]! };
    const selection = deriveWholeCandidateSelection({
      comparison,
      candidates: reviewCandidates,
      candidate: intent.candidate,
    });
    expect(selection.selectedUnitIds).toEqual(
      comparison.units.filter((unit) => unit.candidateId === candidateA.candidateId).map((unit) => unit.unitId).sort(),
    );

    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: selection.selectedUnitIds,
      conflictResolutions: selection.conflictResolutions,
      review: { reviewState: 'unreviewed' },
      now: NOW_A,
    }, hasher);
    expect(() => assertWholeCandidatePlanIntegrity({
      comparison,
      candidates: reviewCandidates,
      intent,
      draft,
    })).not.toThrow();
    expect(draft.replayOperations.map((item) => item.sourceOperationId).sort()).toEqual([
      'a-entry', 'a-scene', 'a-timeline', 'a-variable',
    ]);
    expect(draft.replayOperations).not.toContainEqual(expect.objectContaining({ sourceOperationId: 'b-only-scene' }));
    expect(draft.implicitInclusions.every((unitId) =>
      comparison.units.find((unit) => unit.unitId === unitId)?.candidateId === candidateA.candidateId)).toBe(true);
  });

  it('excludes conflicts owned only by other candidates instead of importing their content', async () => {
    const candidateA = readyCandidate('a-only', [
      operation({ sequence: 0, sourceOperationId: 'a-only', capabilityId: 'scene.create', primaryObject: 'scene:a-only', finalFingerprint: 'fp-a-only' }),
    ]);
    const candidateB = readyCandidate('b-foreign', [
      operation({ sequence: 0, sourceOperationId: 'b-foreign', capabilityId: 'scene.create', primaryObject: 'scene:foreign', finalFingerprint: 'fp-b-foreign' }),
    ]);
    const candidateC = readyCandidate('c-foreign', [
      operation({ sequence: 0, sourceOperationId: 'c-foreign', capabilityId: 'scene.create', primaryObject: 'scene:foreign', finalFingerprint: 'fp-c-foreign' }),
    ]);
    const { comparison, reviewCandidates } = await comparisonOf([candidateA, candidateB, candidateC]);
    const selection = deriveWholeCandidateSelection({
      comparison,
      candidates: reviewCandidates,
      candidate: reviewCandidates.find((candidate) => candidate.candidateId === candidateA.candidateId)!,
    });
    expect(selection.conflictResolutions).toContainEqual(expect.objectContaining({
      resolution: 'exclude-all',
    }));
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: selection.selectedUnitIds,
      conflictResolutions: selection.conflictResolutions,
      review: { reviewState: 'unreviewed' },
      now: NOW_A,
    }, hasher);
    expect(draft.replayOperations.map((item) => item.sourceOperationId)).toEqual(['a-only']);
  });

  it('blocks a whole-proposal preset when one low-level conflict would require dropping more than one unit from that proposal', async () => {
    const candidateA = readyCandidate('ambiguous-a', [
      operation({ sequence: 0, sourceOperationId: 'a-one', capabilityId: 'scene.create', primaryObject: 'scene:a-one', finalFingerprint: 'fp-a-one' }),
      operation({ sequence: 1, sourceOperationId: 'a-two', capabilityId: 'variable.ensure', primaryObject: 'variable:a-two', finalFingerprint: 'fp-a-two' }),
    ]);
    const candidateB = readyCandidate('ambiguous-b', [
      operation({ sequence: 0, sourceOperationId: 'b-one', capabilityId: 'scene.create', primaryObject: 'scene:b-one', finalFingerprint: 'fp-b-one' }),
    ]);
    const { comparison, reviewCandidates } = await comparisonOf([candidateA, candidateB]);
    const aUnits = comparison.units.filter((unit) => unit.candidateId === candidateA.candidateId);
    const bUnit = comparison.units.find((unit) => unit.candidateId === candidateB.candidateId)!;
    const synthetic = {
      ...comparison,
      conflicts: [{
        conflictId: 'conflict-ambiguous',
        severity: 'selection-required' as const,
        code: 'REQUIRED_OBJECT_REMOVED',
        candidateIds: [candidateA.candidateId, candidateB.candidateId],
        unitIds: [...aUnits.map((unit) => unit.unitId), bUnit.unitId],
        objectRefs: ['scene:shared'],
        allowedResolutions: ['choose-unit', 'exclude-all'] as Array<'choose-unit' | 'exclude-all'>,
        details: {},
        repairActions: [],
      }],
    };
    try {
      deriveWholeCandidateSelection({
        comparison: synthetic,
        candidates: reviewCandidates,
        candidate: reviewCandidates.find((candidate) => candidate.candidateId === candidateA.candidateId)!,
      });
      throw new Error('expected whole-candidate derivation to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'REVIEW_DECISION_INVALID' });
    }
  });

  it('uses a review-independent content fingerprint and a separate preview fingerprint, so formal decision binding cannot form a cycle', async () => {
    const candidateA = readyCandidate('fingerprint-a', [
      operation({ sequence: 0, sourceOperationId: 'fp-a', capabilityId: 'scene.create', primaryObject: 'scene:fp', finalFingerprint: 'fp-a' }),
    ]);
    const candidateB = readyCandidate('fingerprint-b', [
      operation({ sequence: 0, sourceOperationId: 'fp-b', capabilityId: 'scene.create', primaryObject: 'scene:fp', finalFingerprint: 'fp-b' }),
    ]);
    const { comparison, reviewCandidates } = await comparisonOf([candidateA, candidateB]);
    const intent = {
      mode: 'adopt-candidate' as const,
      candidate: reviewCandidates.find((candidate) => candidate.candidateId === candidateA.candidateId)!,
    };
    const selection = deriveWholeCandidateSelection({ comparison, candidates: reviewCandidates, candidate: intent.candidate });
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: selection.selectedUnitIds,
      conflictResolutions: selection.conflictResolutions,
      review: { reviewState: 'unreviewed' },
      now: NOW_A,
    }, hasher);
    const result = dryRun({ 'scene:fp': 'result-fingerprint' });
    const preview = await buildReviewDecisionPreview({
      reviewId: 'review-wave9',
      reviewFingerprint: 'review-fingerprint-wave9',
      comparison,
      candidates: reviewCandidates,
      intent,
      draft,
      dryRun: result,
    }, hasher);
    const formalDraftA: IntegrationPlanDraft = {
      ...draft,
      review: {
        reviewState: 'human-reviewed',
        reviewId: 'review-wave9',
        decisionId: 'decision-a',
        decisionFingerprint: 'decision-fingerprint-a',
      },
    };
    const formalDraftB: IntegrationPlanDraft = {
      ...draft,
      review: {
        reviewState: 'human-reviewed',
        reviewId: 'review-wave9',
        decisionId: 'decision-b',
        decisionFingerprint: 'decision-fingerprint-b',
      },
    };
    const [formalA, formalB] = await Promise.all([
      sealDryRunResult(formalDraftA, result, hasher),
      sealDryRunResult(formalDraftB, result, hasher),
    ]);
    expect(formalA.planFingerprint).not.toBe(formalB.planFingerprint);
    expect(await integrationPlanContentFingerprintOf(formalDraftA, result, hasher))
      .toBe(await integrationPlanContentFingerprintOf(formalDraftB, result, hasher));
    expect(preview.planContentFingerprint).toBe(
      await integrationPlanContentFingerprintOf(draft, result, hasher),
    );
    expect(preview.previewFingerprint).not.toBe(formalA.planFingerprint);
    expect(preview.previewFingerprint).not.toBe(formalB.planFingerprint);
  });

  it('ignores timestamps and free-form reasons but changes when the actual dry-run result changes', async () => {
    const candidateA = readyCandidate('stable-a', [
      operation({ sequence: 0, sourceOperationId: 'stable-a', capabilityId: 'scene.create', primaryObject: 'scene:stable', finalFingerprint: 'fp-stable-a' }),
    ]);
    const candidateB = readyCandidate('stable-b', [
      operation({ sequence: 0, sourceOperationId: 'stable-b', capabilityId: 'scene.create', primaryObject: 'scene:stable', finalFingerprint: 'fp-stable-b' }),
    ]);
    const { comparison, reviewCandidates } = await comparisonOf([candidateA, candidateB]);
    const candidate = reviewCandidates.find((item) => item.candidateId === candidateA.candidateId)!;
    const selection = deriveWholeCandidateSelection({ comparison, candidates: reviewCandidates, candidate });
    const withReason = selection.conflictResolutions.map((resolution) => ({
      ...resolution,
      reason: 'first explanation',
    }));
    const withoutSameReason = selection.conflictResolutions.map((resolution) => ({
      ...resolution,
      reason: 'different explanation',
    }));
    const [draftA, draftB] = await Promise.all([
      buildIntegrationPlan({ comparison, selectedUnitIds: selection.selectedUnitIds, conflictResolutions: withReason, review: { reviewState: 'unreviewed' }, now: NOW_A }, hasher),
      buildIntegrationPlan({ comparison, selectedUnitIds: selection.selectedUnitIds, conflictResolutions: withoutSameReason, review: { reviewState: 'unreviewed' }, now: NOW_B }, hasher),
    ]);
    const resultA = dryRun({ 'scene:stable': 'result-a' });
    const resultB = dryRun({ 'scene:stable': 'result-b' });
    expect(await integrationPlanContentFingerprintOf(draftA, resultA, hasher))
      .toBe(await integrationPlanContentFingerprintOf(draftB, resultA, hasher));
    expect(await integrationPlanContentFingerprintOf(draftA, resultA, hasher))
      .not.toBe(await integrationPlanContentFingerprintOf(draftA, resultB, hasher));
  });

  it('rejects save-time reuse when the recalculated preview fingerprint differs', async () => {
    try {
      assertReviewDecisionPreviewFingerprint('old', {
      previewVersion: '1.0.0',
      reviewId: 'review',
      reviewFingerprint: 'review-fingerprint',
      comparisonFingerprint: 'comparison-fingerprint',
      decisionIntent: { mode: 'custom-mix' },
      status: 'ready',
      selectedUnitIds: [],
      conflictResolutions: [],
      effectiveUnitIds: [],
      implicitInclusions: [],
      excludedUnitIds: [],
      planContentFingerprint: 'content',
      dryRun: { status: 'passed', finalObjectFingerprints: {}, errors: [] },
      previewFingerprint: 'new',
      });
      throw new Error('expected stale preview to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'REVIEW_DECISION_STALE' });
    }
  });
});
