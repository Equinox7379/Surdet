import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AuthoringObject,
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionComparison,
  ObjectChangeUnit,
  TextHasher,
  VerifiedCompositionCandidate,
} from '../src/index.js';
import { buildComparisonReviewProjection } from '../src/index.js';

const hasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

function evidence(overrides: Partial<CandidateEvidenceSummary> = {}): CandidateEvidenceSummary {
  return {
    validation: 'fresh',
    simulation: 'fresh',
    runtime: 'fresh',
    warnings: 0,
    manualReviewRequired: [],
    ...overrides,
  };
}

function ref(letter: string): CandidateCapsuleRef {
  return {
    changeId: 'change-' + letter,
    capsuleId: 'capsule-' + letter,
    artifactSha256: letter.repeat(64),
  };
}

function candidate(letter: string, candidateEvidence = evidence()): VerifiedCompositionCandidate & {
  intent?: string;
  acceptanceCriteria: string[];
} {
  return {
    candidateId: 'cand-' + letter,
    ref: ref(letter),
    capsuleVersion: '2.0.0',
    projectIdentity: 'project-wave6',
    baseProjectRevision: 'rev-base',
    sourceWorkingRevision: 1,
    composition: { eligibility: 'ready', reasons: [] },
    evidenceSummary: candidateEvidence,
    semanticDiff: [],
    intent: 'Review Wave 6 composition',
    acceptanceCriteria: ['preserve authored intent'],
  };
}

function unit(
  unitId: string,
  candidateId: string,
  primaryObject: string,
  finalFingerprint: string,
  requiredUnitIds: string[] = [],
  candidateEvidence = evidence(),
): ObjectChangeUnit {
  return {
    unitId,
    candidateId,
    primaryObject,
    operationSequences: [1],
    finalFingerprint,
    requiredUnitIds,
    requiredBaseObjects: [],
    producedObjects: [{
      objectRef: primaryObject,
      disposition: 'create',
      finalFingerprint,
    }],
    potentialImpact: ['potential:' + primaryObject],
    observedImpact: ['observed:' + primaryObject],
    evidenceSummary: candidateEvidence,
  };
}

function object(objectRef: string, kind: AuthoringObject['kind'], semanticId: string): AuthoringObject {
  return {
    kind,
    semanticId,
    objectRef,
    source: { path: 'content/wave6.gal', line: 1, col: 1, raw: semanticId },
    references: [],
    referencedBy: [],
  };
}

function comparison(overrides: Partial<CompositionComparison> = {}): CompositionComparison {
  const alpha = 'fp-alpha';
  const alphaOther = 'fp-alpha-c';
  const beta = 'fp-beta';
  const timeline = 'fp-beta-timeline';
  const units = [
    unit('unit-a-alpha', 'cand-A', 'scene:wave6_alpha', alpha),
    unit('unit-a-variable', 'cand-A', 'variable:flag.alpha', 'fp-flag'),
    unit('unit-d-alpha', 'cand-D', 'scene:wave6_alpha', alpha),
    unit('unit-d-variable', 'cand-D', 'variable:flag.alpha', 'fp-flag'),
    unit('unit-c-alpha', 'cand-C', 'scene:wave6_alpha', alphaOther, [], evidence({ warnings: 1, manualReviewRequired: ['validation warning'] })),
    unit('unit-b-timeline', 'cand-B', 'timeline:wave6_beta_opening', timeline),
    unit('unit-b-beta', 'cand-B', 'scene:wave6_beta', beta, ['unit-b-timeline']),
  ];
  const conflicts: CompositionComparison['conflicts'] = [{
    conflictId: 'conflict-alpha',
    severity: 'selection-required',
    code: 'OBJECT_RESULTS_DIVERGE',
    candidateIds: ['cand-A', 'cand-C', 'cand-D'],
    unitIds: ['unit-a-alpha', 'unit-c-alpha', 'unit-d-alpha'],
    objectRefs: ['scene:wave6_alpha'],
    allowedResolutions: ['choose-unit', 'exclude-all'],
    details: {},
    repairActions: ['choose one result'],
  }, {
    conflictId: 'advisory-c',
    severity: 'advisory',
    code: 'EVIDENCE_NOT_FULLY_FRESH',
    candidateIds: ['cand-C'],
    unitIds: [],
    objectRefs: [],
    allowedResolutions: [],
    details: {},
    repairActions: ['refresh evidence'],
  }];
  return {
    comparisonVersion: '1.0.0',
    projectIdentity: 'project-wave6',
    expectedProjectRevision: 'rev-base',
    status: 'review-only',
    candidates: [ref('D'), ref('B'), ref('A'), ref('C')],
    units: [units[6]!, units[2]!, units[0]!, units[5]!, units[4]!, units[1]!, units[3]!],
    dependencyEdges: [{
      fromUnitId: 'unit-b-beta',
      toUnitId: 'unit-b-timeline',
      objectRef: 'timeline:wave6_beta_opening',
    }],
    conflicts,
    identicalGroups: [{
      groupId: 'group-variable',
      unitIds: ['unit-a-variable', 'unit-d-variable'],
      primaryObject: 'variable:flag.alpha',
      finalFingerprint: 'fp-flag',
    }, {
      groupId: 'group-alpha',
      unitIds: ['unit-a-alpha', 'unit-d-alpha'],
      primaryObject: 'scene:wave6_alpha',
      finalFingerprint: alpha,
    }],
    evidenceMatrix: [
      { candidateId: 'cand-C', summary: evidence({ warnings: 1, manualReviewRequired: ['validation warning'] }) },
      { candidateId: 'cand-A', summary: evidence() },
      { candidateId: 'cand-D', summary: evidence() },
      { candidateId: 'cand-B', summary: evidence() },
    ],
    comparisonFingerprint: 'comparison-fingerprint',
    ...overrides,
  };
}

const objects = [
  object('scene:wave6_alpha', 'scene', 'wave6_alpha'),
  object('variable:flag.alpha', 'variable', 'flag.alpha'),
  object('scene:wave6_beta', 'scene', 'wave6_beta'),
  object('timeline:wave6_beta_opening', 'timeline', 'wave6_beta_opening'),
];

const candidates = [
  candidate('D'),
  candidate('B'),
  candidate('A'),
  candidate('C', evidence({ warnings: 1, manualReviewRequired: ['validation warning'] })),
];

describe('comparison review projection', () => {
  it('projects A/D identical results, C conflict, B dependency, and candidate ordinals', async () => {
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-wave6',
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);

    expect(projection.kind).toBe('comparison');
    expect(projection.state).toBe('COMPARISON_PREPARED');
    expect(projection.safeGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ primaryObject: 'scene:wave6_alpha', sourceCount: 2 }),
      expect.objectContaining({ primaryObject: 'variable:flag.alpha', sourceCount: 2 }),
    ]));
    expect(projection.conflicts).toContainEqual(expect.objectContaining({
      code: 'OBJECT_RESULTS_DIVERGE',
      severity: 'selection-required',
      objectRefs: ['scene:wave6_alpha'],
      allowedResolutions: ['choose-unit', 'exclude-all'],
    }));
    expect(projection.dependencies).toContainEqual(expect.objectContaining({
      objectRef: 'timeline:wave6_beta_opening',
      inclusion: 'implicit',
    }));
    expect(projection.candidates.map((item) => item.displayOrdinal)).toEqual(['A', 'B', 'C', 'D']);
    expect(projection.task.statementSource).toBe('candidate-intent');
    expect(projection.sourceIdentity).toEqual({
      projectIdentity: 'project-wave6',
      expectedProjectRevision: 'rev-base',
      comparisonFingerprint: 'comparison-fingerprint',
    });
  });

  it('blocks decisions for blocking conflicts and keeps missing evidence visible', async () => {
    const blocked = comparison({
      status: 'blocked',
      conflicts: [{
        conflictId: 'conflict-blocking',
        severity: 'blocking',
        code: 'CANDIDATE_PROJECT_MISMATCH',
        candidateIds: ['cand-B'],
        unitIds: [],
        objectRefs: [],
        allowedResolutions: ['regenerate-candidate'],
        details: {},
        repairActions: ['regenerate'],
      }],
      evidenceMatrix: [
        { candidateId: 'cand-A', summary: evidence() },
        { candidateId: 'cand-B', summary: evidence({ validation: 'missing' }) },
        { candidateId: 'cand-C', summary: evidence() },
        { candidateId: 'cand-D', summary: evidence() },
      ],
    });
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-blocked',
      comparison: blocked,
      candidates,
      objects,
    }, hasher);

    expect(projection.evidence.canCreateDecision).toBe(false);
    expect(projection.evidence.blockingCount).toBe(1);
    expect(projection.evidence.candidateMatrix.find((item) => item.candidateId === 'cand-B')?.summary.validation)
      .toBe('missing');
    expect(projection.candidates.find((item) => item.candidateId === 'cand-B')?.evidence.validation)
      .toBe('fresh');
    expect(projection.conflicts[0]).toMatchObject({ code: 'CANDIDATE_PROJECT_MISMATCH', severity: 'blocking' });
  });

  it('is stable when comparison and input arrays are shuffled', async () => {
    const first = await buildComparisonReviewProjection({
      reviewId: 'review-stable',
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);
    const shuffled = comparison({
      candidates: [...comparison().candidates].reverse(),
      units: [...comparison().units].reverse(),
      dependencyEdges: [...comparison().dependencyEdges].reverse(),
      conflicts: [...comparison().conflicts].reverse(),
      identicalGroups: [...comparison().identicalGroups].reverse(),
      evidenceMatrix: [...comparison().evidenceMatrix].reverse(),
    });
    const second = await buildComparisonReviewProjection({
      reviewId: 'review-stable',
      comparison: shuffled,
      candidates: [...candidates].reverse(),
      objects: [...objects].reverse(),
    }, hasher);

    expect(second).toEqual(first);
    expect(second.reviewFingerprint).toBe(first.reviewFingerprint);
  });

  it('uses a generated task fallback when candidate intent is absent', async () => {
    const withoutIntent = candidates.map(({ intent, ...item }) => item);
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-fallback',
      comparison: comparison(),
      candidates: withoutIntent,
      objects,
    }, hasher);

    expect(projection.task.statementSource).toBe('generated-fallback');
    expect(projection.task.goal).toBeUndefined();
    expect(projection.task.acceptanceCriteria).toEqual([]);
  });
});
