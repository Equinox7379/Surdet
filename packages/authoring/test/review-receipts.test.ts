import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  FinalApprovalReceipt,
  HumanReviewProjection,
  ReviewCandidate,
  ReviewConflict,
  ReviewEvidenceBinding,
  ResultReviewCurrentFacts,
  TextHasher,
} from '../src/index.js';
import {
  approvalFingerprintOf,
  decisionFingerprintOf,
  decisionToPlanSelection,
  validateFinalApproval,
  validateComparisonDecision,
  type ComparisonDecisionReceipt,
} from '../src/index.js';

const hasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

const freshEvidence: CandidateEvidenceSummary = {
  validation: 'fresh',
  simulation: 'fresh',
  runtime: 'fresh',
  warnings: 0,
  manualReviewRequired: [],
};

function candidateRef(letter: string): CandidateCapsuleRef {
  return {
    changeId: 'change-' + letter,
    capsuleId: 'capsule-' + letter,
    artifactSha256: letter.repeat(64),
  };
}

const candidates: ReviewCandidate[] = [
  {
    candidateId: 'cand-a',
    ref: candidateRef('a'),
    displayOrdinal: 'A',
    declaredIntent: 'Keep alpha',
    acceptanceCriteria: ['alpha remains playable'],
    evidence: freshEvidence,
  },
  {
    candidateId: 'cand-b',
    ref: candidateRef('b'),
    displayOrdinal: 'B',
    declaredIntent: 'Keep beta',
    acceptanceCriteria: ['beta remains playable'],
    evidence: freshEvidence,
  },
];

const conflict: ReviewConflict = {
  conflictId: 'conflict-alpha',
  severity: 'selection-required',
  code: 'OBJECT_RESULTS_DIVERGE',
  unitIds: ['unit-a', 'unit-b'],
  candidateIds: ['cand-a', 'cand-b'],
  objectRefs: ['scene:alpha'],
  allowedResolutions: ['choose-unit', 'exclude-all'],
  repairActions: ['choose a result'],
  options: ['unit-a', 'unit-b'].map((unitId, index) => ({
    unitId,
    candidateId: index === 0 ? 'cand-a' : 'cand-b',
    primaryObject: 'scene:alpha',
    finalFingerprint: index === 0 ? 'alpha-a' : 'alpha-b',
    outcomes: [{
      objectRef: 'scene:alpha',
      disposition: 'create',
      finalFingerprint: index === 0 ? 'alpha-a' : 'alpha-b',
    }],
    potentialImpact: [],
    observedImpact: [],
    evidence: freshEvidence,
  })),
};

function projection(overrides: Partial<HumanReviewProjection> = {}): HumanReviewProjection {
  return {
    reviewVersion: '1.0.0',
    reviewId: 'review-wave6',
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    projectIdentity: 'project-wave6',
    expectedProjectRevision: 'revision-1',
    task: {
      title: 'Wave 6 composition',
      acceptanceCriteria: ['alpha remains playable'],
      candidateCount: 2,
      objectCount: 1,
      conflictCount: 1,
      statementSource: 'candidate-intent',
    },
    candidates,
    safeGroups: [],
    conflicts: [conflict],
    dependencies: [],
    defaultSelectedUnitIds: [],
    evidence: {
      candidateMatrix: candidates.map((item) => ({ candidateId: item.candidateId, summary: item.evidence })),
      blockingCount: 0,
      selectionRequiredCount: 1,
      advisoryCount: 0,
      canCreateDecision: true,
    },
    objects: [{
      objectRef: 'scene:alpha',
      kind: 'scene',
      semanticId: 'alpha',
      references: [],
      referencedBy: [],
      potentialImpact: [],
      observedImpact: [],
    }],
    sourceIdentity: {
      projectIdentity: 'project-wave6',
      expectedProjectRevision: 'revision-1',
      comparisonFingerprint: 'comparison-fingerprint',
    },
    reviewFingerprint: 'review-fingerprint',
    ...overrides,
  };
}

async function receipt(
  overrides: Partial<Omit<ComparisonDecisionReceipt, 'decisionFingerprint'>> = {},
): Promise<ComparisonDecisionReceipt> {
  const unsigned: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'> = {
    receiptVersion: '1.0.0',
    decisionId: 'decision-1',
    reviewId: 'review-wave6',
    comparisonFingerprint: 'comparison-fingerprint',
    projectIdentity: 'project-wave6',
    expectedProjectRevision: 'revision-1',
    candidateRefs: candidates.map((item) => item.ref),
    selectedUnitIds: ['unit-a'],
    conflictResolutions: [{
      conflictId: 'conflict-alpha',
      resolution: 'choose-unit',
      chosenUnitId: 'unit-a',
    }],
    reviewerChannel: 'surdet-editor-local',
    decidedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
  return {
    ...unsigned,
    decisionFingerprint: await decisionFingerprintOf(unsigned, hasher),
  };
}

function resultProjection(): HumanReviewProjection {
  return projection({
    reviewId: 'result-review',
    kind: 'integration-result',
    state: 'STAGE_READY',
    finalResult: {
      planId: 'plan-1',
      planFingerprint: 'plan-fingerprint',
      integrationChangeId: 'change-1',
      workingRevision: 4,
      diffFingerprint: 'diff-fingerprint',
      changedObjects: [],
      evidence: {
        diffEvidenceId: 'diff-1',
        validationEvidenceId: 'validation-1',
        simulationEvidenceId: 'simulation-1',
        runtimeTraceIds: ['trace-1'],
      },
      plan: {
        review: {
          reviewState: 'human-reviewed',
          reviewId: 'review-wave6',
          decisionId: 'decision-1',
          decisionFingerprint: 'decision-fingerprint',
        },
        sourceCapsules: [],
        sourceCandidates: [],
        selectedUnitIds: [],
        includedUnitIds: [],
        implicitInclusions: [],
        excludedUnitIds: [],
        conflictResolutions: [],
        deduplicatedUnits: [],
        replayOperations: [],
        provenance: [],
        finalObjectFingerprints: {},
      },
      diff: {
        summary: { createdScenes: 0, modifiedScenes: 0, changedVariables: 0, warnings: [] },
        semantic: [],
        files: [],
      },
      freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
      runtimeTraceObservations: [{ traceId: 'trace-1', observationKeys: [] }],
      resultTreeSha256: 'tree-1',
      warnings: [],
    },
    sourceIdentity: {
      projectIdentity: 'project-wave6',
      expectedProjectRevision: 'revision-1',
      comparisonFingerprint: 'comparison-fingerprint',
      planFingerprint: 'plan-fingerprint',
      integrationChangeId: 'change-1',
      workingRevision: 4,
      decisionFingerprint: 'decision-fingerprint',
    },
  });
}

function currentResultFacts(overrides: Partial<ResultReviewCurrentFacts> = {}): ResultReviewCurrentFacts {
  return {
    projectIdentity: 'project-wave6',
    projectRevision: 'revision-1',
    planId: 'plan-1',
    planFingerprint: 'plan-fingerprint',
    integrationChangeId: 'change-1',
    workingRevision: 4,
    diffFingerprint: 'diff-fingerprint',
    evidence: {
      diffEvidenceId: 'diff-1',
      validationEvidenceId: 'validation-1',
      simulationEvidenceId: 'simulation-1',
      runtimeTraceIds: ['trace-1'],
    },
    resultTreeSha256: 'tree-1',
    ...overrides,
  };
}

async function approval(
  overrides: Omit<Partial<Omit<FinalApprovalReceipt, 'approvalFingerprint'>>, 'evidence'> & {
    evidence?: Omit<Partial<ReviewEvidenceBinding>, 'runtimeTraceIds'> & {
      runtimeTraceIds?: readonly string[];
    };
  } = {},
): Promise<FinalApprovalReceipt> {
  const { evidence: evidenceOverrides, ...otherOverrides } = overrides;
  const { runtimeTraceIds: evidenceRuntimeTraceIds, ...otherEvidenceOverrides } = evidenceOverrides ?? {};
  const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
    receiptVersion: '1.0.0',
    approvalId: 'approval-1',
    resultReviewId: 'result-review',
    decisionFingerprint: 'decision-fingerprint',
    planId: 'plan-1',
    planFingerprint: 'plan-fingerprint',
    integrationChangeId: 'change-1',
    workingRevision: 4,
    projectIdentity: 'project-wave6',
    expectedProjectRevision: 'revision-1',
    diffFingerprint: 'diff-fingerprint',
    evidence: {
      diffEvidenceId: 'diff-1',
      validationEvidenceId: 'validation-1',
      simulationEvidenceId: 'simulation-1',
      ...otherEvidenceOverrides,
      runtimeTraceIds: [...(evidenceRuntimeTraceIds ?? ['trace-1'])],
    },
    resultTreeSha256: 'tree-1',
    reviewerChannel: 'surdet-editor-local',
    approvedAt: '2026-08-27T00:00:00.000Z',
    ...otherOverrides,
  };
  return {
    ...unsigned,
    approvalFingerprint: await approvalFingerprintOf(unsigned, hasher),
  };
}

describe('human comparison decision receipts', () => {
  it('mechanically turns a valid receipt into human resolutions', async () => {
    const current = projection();
    const currentReceipt = await receipt();
    const verified = await validateComparisonDecision({ projection: current, receipt: currentReceipt }, hasher);
    const selection = decisionToPlanSelection(verified);

    expect(selection.conflictResolutions.every((item) => item.actor === 'human')).toBe(true);
    expect(selection.review).toEqual({
      reviewState: 'human-reviewed',
      reviewId: currentReceipt.reviewId,
      decisionId: currentReceipt.decisionId,
      decisionFingerprint: currentReceipt.decisionFingerprint,
    });
  });

  it.each(['comparisonFingerprint', 'projectIdentity', 'expectedProjectRevision', 'candidateRefs'] as const)(
    'rejects stale %s',
    async (field) => {
      const currentReceipt = await receipt(field === 'candidateRefs'
        ? { candidateRefs: [candidateRef('z'), candidateRef('b')] }
        : field === 'comparisonFingerprint'
          ? { comparisonFingerprint: 'old-comparison' }
          : field === 'projectIdentity'
            ? { projectIdentity: 'other-project' }
            : { expectedProjectRevision: 'old-revision' });
      await expect(validateComparisonDecision({
        projection: projection(),
        receipt: currentReceipt,
      }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_STALE' });
    },
  );

  it('rejects missing, duplicate, or illegal conflict choices', async () => {
    await expect(validateComparisonDecision({
      projection: projection(),
      receipt: await receipt({ conflictResolutions: [] }),
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });

    await expect(validateComparisonDecision({
      projection: projection(),
      receipt: await receipt({
        conflictResolutions: [
          { conflictId: 'conflict-alpha', resolution: 'choose-unit', chosenUnitId: 'unit-a' },
          { conflictId: 'conflict-alpha', resolution: 'exclude-all' },
        ],
      }),
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });

    await expect(validateComparisonDecision({
      projection: projection(),
      receipt: await receipt({
        conflictResolutions: [{ conflictId: 'conflict-alpha', resolution: 'choose-unit', chosenUnitId: 'unit-unknown' }],
      }),
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });
  });

  it('rejects blocking reviews and returns regenerate decisions', async () => {
    const blocking: ReviewConflict = {
      ...conflict,
      conflictId: 'conflict-blocking',
      severity: 'blocking',
      allowedResolutions: ['regenerate-candidate'],
    };
    await expect(validateComparisonDecision({
      projection: projection({
        conflicts: [blocking],
        evidence: {
          ...projection().evidence,
          blockingCount: 1,
          selectionRequiredCount: 0,
          canCreateDecision: false,
        },
      }),
      receipt: await receipt({
        conflictResolutions: [{ conflictId: 'conflict-blocking', resolution: 'regenerate-candidate' }],
      }),
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });

    await expect(validateComparisonDecision({
      projection: projection({
        conflicts: [{ ...conflict, allowedResolutions: ['regenerate-candidate'] }],
      }),
      receipt: await receipt({
        selectedUnitIds: [],
        conflictResolutions: [{ conflictId: 'conflict-alpha', resolution: 'regenerate-candidate' }],
      }),
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_RETURNED' });
  });

  it('accepts only an approval bound to the exact result facts', async () => {
    const current = currentResultFacts();
    const currentApproval = await approval();
    const verified = await validateFinalApproval({
      projection: resultProjection(),
      receipt: currentApproval,
      current,
    }, hasher);
    expect(verified.receipt.approvalFingerprint).toBe(currentApproval.approvalFingerprint);
    expect(verified.bindingFingerprint).toBeTruthy();
  });

  it.each([
    ['planFingerprint', { planFingerprint: 'other-plan' }, {}],
    ['integrationChangeId', { integrationChangeId: 'other-change' }, {}],
    ['workingRevision', { workingRevision: 5 }, {}],
    ['diffFingerprint', { diffFingerprint: 'other-diff' }, {}],
    ['diffEvidenceId', { evidence: { diffEvidenceId: 'other-diff-evidence' } }, {}],
    ['validationEvidenceId', { evidence: { validationEvidenceId: 'other-validation' } }, {}],
    ['simulationEvidenceId', { evidence: { simulationEvidenceId: 'other-simulation' } }, {}],
    ['runtimeTraceIds', { evidence: { runtimeTraceIds: ['trace-2'] } }, {}],
    ['project revision', {}, { projectRevision: 'revision-2' }],
    ['resultTreeSha256', { resultTreeSha256: 'other-tree' }, {}],
  ] as const)('rejects stale approval when %s changes', async (_field, receiptChanges, currentChanges) => {
    const staleApproval = await approval(receiptChanges);
    const current = currentResultFacts(currentChanges);
    await expect(validateFinalApproval({
      projection: resultProjection(),
      receipt: staleApproval,
      current,
    }, hasher)).rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
  });
});
