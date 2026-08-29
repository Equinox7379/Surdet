import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AuthoringObject,
  BuildResultReviewProjectionInput,
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionComparison,
  ChangeRecord,
  IntegrationPlan,
  ObjectChangeUnit,
  TextHasher,
  VerifiedCompositionCandidate,
} from '../src/index.js';
import {
  buildComparisonReviewProjection,
  buildResultReviewProjection,
  reviewTraceObservationKey,
} from '../src/index.js';

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

function reviewedPlan(overrides: Partial<IntegrationPlan> = {}): IntegrationPlan {
  return {
    planVersion: '1.0.0',
    planId: 'plan-result',
    projectIdentity: 'project-wave6',
    expectedProjectRevision: 'rev-base',
    comparisonFingerprint: 'comparison-fingerprint',
    review: {
      reviewState: 'human-reviewed',
      reviewId: 'decision-review',
      decisionId: 'decision-result',
      decisionFingerprint: 'decision-fingerprint',
    },
    sourceCapsules: [],
    selectedUnitIds: [],
    implicitInclusions: [],
    excludedUnitIds: [],
    conflictResolutions: [],
    deduplicatedUnits: [],
    replayOperations: [],
    provenance: [],
    dryRun: { status: 'passed', finalObjectFingerprints: {}, errors: [] },
    planFingerprint: 'plan-fingerprint',
    ...overrides,
  };
}

function readyResultChange(): ChangeRecord {
  return {
    changeId: 'change-result',
    formatVersion: 2,
    recordVersion: 8,
    projectRootIdentity: 'project-wave6',
    baseRevision: 'rev-base',
    workingRevision: 3,
    status: 'OPEN',
    baseFiles: {},
    baseContents: {},
    workingFiles: {},
    operations: {},
    integration: {
      planId: 'plan-result',
      planFingerprint: 'plan-fingerprint',
      executeOperationId: 'execute-result',
      sourceCapsules: [],
      includedUnitIds: [],
      deduplicatedUnits: [],
      conflictResolutions: [],
      status: 'READY',
      nextOperationIndex: 0,
      replayedOperations: [],
      review: {
        binding: {
          reviewState: 'human-reviewed',
          reviewId: 'decision-review',
          decisionId: 'decision-result',
          decisionFingerprint: 'decision-fingerprint',
        },
      },
    },
    latestDiff: { workingRevision: 3, evidenceId: 'diff-evidence' },
    latestValidation: { workingRevision: 3, evidenceId: 'validation-evidence', errors: 0 },
    latestSimulation: { workingRevision: 3, evidenceId: 'simulation-evidence', status: 'passed' },
    runtimeTraces: [{ traceId: 'runtime-trace', workingRevision: 3, status: 'passed' }],
  } as unknown as ChangeRecord;
}

function resultReviewEvidence(): Pick<BuildResultReviewProjectionInput,
  'diff' | 'freshness' | 'runtimeTraceObservations'> {
  return {
    diff: {
      summary: { createdScenes: 0, modifiedScenes: 0, changedVariables: 0, warnings: [] },
      semantic: [],
      files: [],
    },
    freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
    runtimeTraceObservations: [{ traceId: 'runtime-trace', observationKeys: [] }],
  };
}

describe('comparison review projection', () => {
  it('projects comparison-created objects and their declared impacts even when the base object index does not contain them', async () => {
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-created-objects',
      comparison: comparison(),
      candidates,
      objects: [],
    }, hasher);

    expect(projection.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectRef: 'scene:wave6_alpha',
        kind: 'scene',
        semanticId: 'wave6_alpha',
        potentialImpact: expect.arrayContaining(['potential:scene:wave6_alpha']),
        observedImpact: expect.arrayContaining(['observed:scene:wave6_alpha']),
      }),
      expect.objectContaining({
        objectRef: 'variable:flag.alpha',
        kind: 'variable',
        semanticId: 'flag.alpha',
      }),
    ]));
  });

  it('keeps each safe-group source, dependency, evidence alert, and impact as reviewable facts', async () => {
    const compared = comparison();
    for (const item of compared.units.filter((entry) => entry.primaryObject === 'scene:wave6_alpha')) {
      item.requiredBaseObjects = [{ objectRef: 'config:entryScene', source: 'base' }];
    }
    const source = compared.units.find((item) => item.unitId === 'unit-d-alpha')!;
    source.evidenceSummary = evidence({ validation: 'missing', warnings: 2, manualReviewRequired: ['source warning'] });
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-safe-source-map',
      comparison: compared,
      candidates,
      objects,
    }, hasher);

    const safe = projection.safeGroups.find((item) => item.primaryObject === 'scene:wave6_alpha');
    expect(safe).toBeDefined();
    if (safe === undefined) throw new Error('safe group missing');
    expect(safe.sources).toEqual([
      expect.objectContaining({ unitId: 'unit-a-alpha', candidateId: 'cand-A', finalFingerprint: 'fp-alpha' }),
      expect.objectContaining({ unitId: 'unit-d-alpha', candidateId: 'cand-D', finalFingerprint: 'fp-alpha' }),
    ]);
    expect(safe.dependencyObjectRefs).toEqual(['config:entryScene']);
    expect(safe).toMatchObject({ includedByDefault: true, collapsedByDefault: true });
    expect(safe.potentialImpact).toContain('potential:scene:wave6_alpha');
    expect(safe.observedImpact).toContain('observed:scene:wave6_alpha');
    expect(safe.evidence).toMatchObject({ warningCount: 2, missing: true, manualReviewRequired: ['source warning'] });
  });

  it('binds every conflict option to its exact unit, candidate, fingerprint, and outcome', async () => {
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-conflict-options',
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);

    const conflict = projection.conflicts.find((item) => item.conflictId === 'conflict-alpha');
    expect(conflict).toBeDefined();
    if (conflict === undefined) throw new Error('conflict missing');
    expect(conflict.options).toEqual([
      expect.objectContaining({ unitId: 'unit-a-alpha', candidateId: 'cand-A', finalFingerprint: 'fp-alpha' }),
      expect.objectContaining({ unitId: 'unit-c-alpha', candidateId: 'cand-C', finalFingerprint: 'fp-alpha-c' }),
      expect.objectContaining({ unitId: 'unit-d-alpha', candidateId: 'cand-D', finalFingerprint: 'fp-alpha' }),
    ]);
    expect(conflict.options[0]?.outcomes).toContainEqual(expect.objectContaining({ objectRef: 'scene:wave6_alpha', disposition: 'create' }));
  });

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
      fromObjectRef: 'scene:wave6_beta',
      objectRef: 'timeline:wave6_beta_opening',
      inclusion: 'implicit',
    }));
    expect(projection.defaultSelectedUnitIds).toEqual([
      'unit-a-alpha',
      'unit-a-variable',
      'unit-b-beta',
      'unit-d-alpha',
      'unit-d-variable',
    ]);
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

  it('rejects every incomplete result-evidence state and projects READY results', async () => {
    const cases: Array<{ name: string; build: () => { plan: IntegrationPlan; change: ChangeRecord } }> = [
      {
        name: 'unreviewed plan',
        build: () => ({
          plan: reviewedPlan({ review: { reviewState: 'unreviewed' } }),
          change: readyResultChange(),
        }),
      },
      ...(['REPLAYING', 'FAILED'] as const).map((status) => ({
        name: 'integration ' + status,
        build: () => {
          const change = readyResultChange();
          change.integration!.status = status;
          return { plan: reviewedPlan(), change };
        },
      })),
      {
        name: 'diff missing',
        build: () => {
          const change = readyResultChange();
          delete change.latestDiff;
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'diff stale',
        build: () => {
          const change = readyResultChange();
          change.latestDiff = { workingRevision: 2, evidenceId: 'diff-evidence' };
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'validation missing',
        build: () => {
          const change = readyResultChange();
          delete change.latestValidation;
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'validation stale',
        build: () => {
          const change = readyResultChange();
          change.latestValidation = { workingRevision: 2, evidenceId: 'validation-evidence', errors: 0 };
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'validation failed',
        build: () => {
          const change = readyResultChange();
          change.latestValidation = { workingRevision: 3, evidenceId: 'validation-evidence', errors: 1 };
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'simulation missing',
        build: () => {
          const change = readyResultChange();
          delete change.latestSimulation;
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'simulation stale',
        build: () => {
          const change = readyResultChange();
          change.latestSimulation = { workingRevision: 2, evidenceId: 'simulation-evidence', status: 'passed' };
          return { plan: reviewedPlan(), change };
        },
      },
      ...(['incomplete', 'failed'] as const).map((status) => ({
        name: 'simulation ' + status,
        build: () => {
          const change = readyResultChange();
          change.latestSimulation = { workingRevision: 3, evidenceId: 'simulation-evidence', status };
          return { plan: reviewedPlan(), change };
        },
      })),
      {
        name: 'runtime missing',
        build: () => {
          const change = readyResultChange();
          delete change.runtimeTraces;
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'runtime stale',
        build: () => {
          const change = readyResultChange();
          change.runtimeTraces = [{ traceId: 'runtime-trace', workingRevision: 2, status: 'passed' }];
          return { plan: reviewedPlan(), change };
        },
      },
      {
        name: 'runtime failed',
        build: () => {
          const change = readyResultChange();
          change.runtimeTraces = [{ traceId: 'runtime-trace', workingRevision: 3, status: 'failed' as never }];
          return { plan: reviewedPlan(), change };
        },
      },
    ];

    for (const item of cases) {
      const built = item.build();
      await expect(buildResultReviewProjection({
        reviewId: 'result-review',
        plan: built.plan,
        change: built.change,
        diffFingerprint: 'diff-fingerprint',
        ...resultReviewEvidence(),
        resultTreeSha256: 'result-tree-sha',
      }, hasher), item.name).rejects.toMatchObject({ code: 'REVIEW_RESULT_NOT_READY' });
    }

    const change = readyResultChange();
    const resultProjection = await buildResultReviewProjection({
      reviewId: 'result-review',
      plan: reviewedPlan(),
      change,
      diffFingerprint: 'diff-fingerprint',
      ...resultReviewEvidence(),
      resultTreeSha256: 'result-tree-sha',
    }, hasher);
    expect(resultProjection.finalResult).toMatchObject({
      planId: 'plan-result',
      planFingerprint: 'plan-fingerprint',
      integrationChangeId: 'change-result',
      workingRevision: 3,
      resultTreeSha256: 'result-tree-sha',
    });
    expect(resultProjection.state).toBe('STAGE_READY');
  });

  it('projects the complete reviewed plan, decision, diff, provenance, fingerprints, and comparable runtime observations', async () => {
    const plan = reviewedPlan({
      sourceCapsules: [ref('D'), ref('A'), ref('C')],
      selectedUnitIds: ['unit-a-alpha', 'unit-b-beta'],
      implicitInclusions: ['unit-b-timeline'],
      excludedUnitIds: ['unit-c-alpha'],
      conflictResolutions: [{
        conflictId: 'conflict-alpha',
        resolution: 'choose-unit',
        chosenUnitId: 'unit-a-alpha',
        actor: 'human',
        decidedAt: '2026-08-27T00:00:00.000Z',
      }],
      deduplicatedUnits: [{ groupId: 'group-alpha', retainedUnitId: 'unit-a-alpha', provenanceUnitIds: ['unit-a-alpha', 'unit-d-alpha'] }],
      replayOperations: [{
        sequence: 1,
        capabilityId: 'scene.create',
        sourceOperationId: 'source-op-a',
        normalizedInput: {},
        inputSha256: 'a'.repeat(64),
        primaryObject: 'scene:wave6_alpha',
        objectFingerprintAfter: 'fp-alpha',
        requiredObjects: [],
        producedObjects: [{ objectRef: 'scene:wave6_alpha', disposition: 'create', finalFingerprint: 'fp-alpha' }],
        integrationOperationId: 'integration-op-a',
        sourceCapsule: ref('A'),
        sourceUnitId: 'unit-a-alpha',
      }],
      provenance: [{ targetObject: 'scene:wave6_alpha', sourceCapsule: ref('A'), sourceUnitId: 'unit-a-alpha', sourceOperationIds: ['source-op-a'] },
        { targetObject: 'scene:wave6_alpha', sourceCapsule: ref('D'), sourceUnitId: 'unit-d-alpha', sourceOperationIds: ['source-op-d'] }],
      dryRun: { status: 'passed', finalObjectFingerprints: { 'scene:wave6_alpha': 'fp-alpha', 'timeline:wave6_beta_opening': 'fp-timeline' }, errors: [] },
    });
    const change = readyResultChange();
    change.integration!.includedUnitIds = ['unit-a-alpha', 'unit-b-beta', 'unit-b-timeline'];
    const runtimeEvent = {
      kind: 'text',
      source: { sceneId: 'wave6_alpha', index: 0, op: 'text', file: 'content/scenario/wave6_alpha.gal', line: 2, col: 1 },
    };
    const projection = await buildResultReviewProjection({
      reviewId: 'result-complete-contract',
      plan,
      change,
      diffFingerprint: 'diff-fingerprint',
      diff: {
        summary: { createdScenes: 1, modifiedScenes: 0, changedVariables: 0, warnings: [] },
        semantic: [],
        files: [{
          path: 'content/scenario/wave6_alpha.gal',
          unifiedDiff: '--- wave6_alpha.gal\n+++ wave6_alpha.gal',
          unexpectedFormatChange: false,
        }],
      },
      resultTreeSha256: 'result-tree-sha',
      runtimeTraceObservations: [{ traceId: 'runtime-trace', observationKeys: ['text|wave6_alpha|0|text|content/scenario/wave6_alpha.gal|2|1'] }],
    }, hasher);

    const result = projection.finalResult;
    expect(result).toBeDefined();
    if (result === undefined) throw new Error('final result missing');
    expect(result.plan).toMatchObject({
      selectedUnitIds: ['unit-a-alpha', 'unit-b-beta'],
      includedUnitIds: ['unit-a-alpha', 'unit-b-beta', 'unit-b-timeline'],
      implicitInclusions: ['unit-b-timeline'],
      excludedUnitIds: ['unit-c-alpha'],
      finalObjectFingerprints: { 'scene:wave6_alpha': 'fp-alpha', 'timeline:wave6_beta_opening': 'fp-timeline' },
    });
    expect(result.plan.deduplicatedUnits[0]?.provenanceUnitIds).toEqual(['unit-a-alpha', 'unit-d-alpha']);
    expect(result.plan.provenance).toHaveLength(2);
    expect(result.plan.replayOperations).toHaveLength(1);
    expect(result.plan.conflictResolutions).toEqual([
      expect.objectContaining({ conflictId: 'conflict-alpha', resolution: 'choose-unit', chosenUnitId: 'unit-a-alpha' }),
    ]);
    expect(result.plan.sourceCandidates).toEqual([
      { ref: ref('A'), displayOrdinal: 'A' },
      { ref: ref('C'), displayOrdinal: 'B' },
      { ref: ref('D'), displayOrdinal: 'C' },
    ]);
    expect(result.diff).toMatchObject({ files: [{ path: 'content/scenario/wave6_alpha.gal' }] });
    expect(result.freshness).toEqual({ diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' });
    expect(result.runtimeTraceObservations).toEqual([
      { traceId: 'runtime-trace', observationKeys: ['text|wave6_alpha|0|text|content/scenario/wave6_alpha.gal|2|1'] },
    ]);
    expect(projection.sourceIdentity).toMatchObject({ decisionId: 'decision-result', decisionFingerprint: 'decision-fingerprint' });
    expect(reviewTraceObservationKey(runtimeEvent)).toBe(
      'text|wave6_alpha|0|text|content/scenario/wave6_alpha.gal|2|1',
    );
    expect(reviewTraceObservationKey({ kind: 'text', source: { sceneId: 'wave6_alpha' } })).toBeUndefined();
  });
});
