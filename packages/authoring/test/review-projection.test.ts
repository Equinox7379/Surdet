import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AuthoringObject,
  BuildResultReviewProjectionInput,
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionManifest,
  CompositionComparison,
  CompositionOperation,
  ChangeRecord,
  IntegrationPlan,
  ObjectChangeUnit,
  TextHasher,
  VerifiedCompositionCandidate,
} from '../src/index.js';
import {
  buildComparisonReviewProjection,
  buildReviewUnitPresentation,
  buildResultReviewProjection,
  comparisonReviewFingerprintOf,
  isReviewProjectionV2Fields,
  resultReviewFingerprintOf,
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
  manifest: CompositionManifest;
} {
  const operations = candidateOperations(letter);
  const manifest: CompositionManifest = {
    manifestVersion: '1.0.0',
    projectIdentity: 'project-wave6',
    baseProjectRevision: 'rev-base',
    sourceChangeId: 'change-' + letter,
    sourceWorkingRevision: 1,
    operations,
    manifestFingerprint: 'manifest-' + letter,
  };
  return {
    candidateId: 'cand-' + letter,
    ref: ref(letter),
    capsuleVersion: '2.0.0',
    projectIdentity: 'project-wave6',
    baseProjectRevision: 'rev-base',
    sourceWorkingRevision: 1,
    composition: { eligibility: 'ready', reasons: [], manifest },
    evidenceSummary: candidateEvidence,
    semanticDiff: [],
    intent: 'Review Wave 6 composition',
    acceptanceCriteria: ['preserve authored intent'],
    manifest,
  };
}

function operation(
  sequence: number,
  capabilityId: CompositionOperation['capabilityId'],
  normalizedInput: CompositionOperation['normalizedInput'],
  primaryObject: string,
  finalFingerprint: string,
): CompositionOperation {
  return {
    sequence,
    capabilityId,
    sourceOperationId: `source-${sequence}-${capabilityId}`,
    normalizedInput,
    inputSha256: `input-${sequence}-${capabilityId}`,
    primaryObject,
    requiredObjects: [],
    producedObjects: [{ objectRef: primaryObject, disposition: 'create', finalFingerprint }],
  };
}

function candidateOperations(letter: string): CompositionOperation[] {
  if (letter === 'A' || letter === 'D') {
    return [
      operation(0, 'scene.create', {
        operationId: `op-${letter.toLowerCase()}-alpha`,
        sceneId: 'wave6_alpha',
        blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', speaker: 'lynn', value: 'Alpha route A.' }],
      }, 'scene:wave6_alpha', 'fp-alpha'),
      operation(1, 'variable.ensure', {
        operationId: `op-${letter.toLowerCase()}-variable`,
        name: 'flag.alpha',
        type: 'string',
        initial: 'A',
      }, 'variable:flag.alpha', 'fp-flag'),
    ];
  }
  if (letter === 'C') {
    return [operation(0, 'scene.create', {
      operationId: 'op-c-alpha',
      sceneId: 'wave6_alpha',
      blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', speaker: 'lynn', value: 'Alpha route C.' }],
    }, 'scene:wave6_alpha', 'fp-alpha-c')];
  }
  return [
    operation(0, 'timeline.create', {
      operationId: 'op-b-timeline',
      timelineId: 'wave6_beta_opening',
      definition: { version: 1, id: 'wave6_beta_opening', durationMs: 900, tracks: [] },
    }, 'timeline:wave6_beta_opening', 'fp-beta-timeline'),
    {
      ...operation(1, 'scene.create', {
        operationId: 'op-b-scene',
        sceneId: 'wave6_beta',
        blocks: [{ kind: 'instruction', name: 'timeline', args: ['wave6_beta_opening'] }],
      }, 'scene:wave6_beta', 'fp-beta'),
      requiredObjects: [{ objectRef: 'timeline:wave6_beta_opening', source: 'candidate', candidateOperationSequence: 0 }],
    },
  ];
}

function unit(
  unitId: string,
  candidateId: string,
  primaryObject: string,
  finalFingerprint: string,
  requiredUnitIds: string[] = [],
  candidateEvidence = evidence(),
  operationSequences: number[] = [0],
): ObjectChangeUnit {
  return {
    unitId,
    candidateId,
    primaryObject,
    operationSequences,
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
    unit('unit-a-alpha', 'cand-A', 'scene:wave6_alpha', alpha, [], evidence(), [0]),
    unit('unit-a-variable', 'cand-A', 'variable:flag.alpha', 'fp-flag', [], evidence(), [1]),
    unit('unit-d-alpha', 'cand-D', 'scene:wave6_alpha', alpha, [], evidence(), [0]),
    unit('unit-d-variable', 'cand-D', 'variable:flag.alpha', 'fp-flag', [], evidence(), [1]),
    unit('unit-c-alpha', 'cand-C', 'scene:wave6_alpha', alphaOther, [], evidence({ warnings: 1, manualReviewRequired: ['validation warning'] })),
    unit('unit-b-timeline', 'cand-B', 'timeline:wave6_beta_opening', timeline, [], evidence(), [0]),
    unit('unit-b-beta', 'cand-B', 'scene:wave6_beta', beta, ['unit-b-timeline'], evidence(), [1]),
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

  it('projects exact typed A/C scene content while preserving A/D provenance and stable bindings', async () => {
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-human-presentation',
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);
    const conflict = projection.conflicts.find((item) => item.conflictId === 'conflict-alpha')!;
    const optionA = conflict.options.find((item) => item.unitId === 'unit-a-alpha')! as unknown as {
      unitId: string;
      presentation?: { actionLabel: string; objectLabel: string; highlights: string[]; completeness: string; omittedFactCount: number };
    };
    const optionC = conflict.options.find((item) => item.unitId === 'unit-c-alpha')! as typeof optionA;
    expect(optionA.presentation).toMatchObject({
      actionLabel: '新建场景',
      objectLabel: '场景 wave6_alpha',
      completeness: 'content',
      omittedFactCount: 0,
    });
    expect(optionA.presentation?.highlights.join('\n')).toContain('Alpha route A.');
    expect(optionA.presentation?.highlights.join('\n')).not.toContain('Alpha route C.');
    expect(optionC.presentation?.highlights.join('\n')).toContain('Alpha route C.');
    expect(optionC.presentation?.highlights.join('\n')).not.toContain('Alpha route A.');
    const safe = projection.safeGroups.find((item) => item.primaryObject === 'scene:wave6_alpha')!;
    expect(safe.sources.map((source) => ({ unitId: source.unitId, candidateId: source.candidateId }))).toEqual([
      { unitId: 'unit-a-alpha', candidateId: 'cand-A' },
      { unitId: 'unit-d-alpha', candidateId: 'cand-D' },
    ]);
    expect(safe.sources.every((source) => (
      source as typeof source & { presentation?: { highlights: string[] } }
    ).presentation?.highlights.join('\n').includes('Alpha route A.'))).toBe(true);
  });

  it('uses a metadata-only presentation instead of inventing content when manifest facts are unavailable', async () => {
    const withoutManifest = candidates.map(({ manifest, composition, ...item }) => ({
      ...item,
      composition: { ...composition, manifest: undefined },
    }));
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-metadata-only',
      comparison: comparison(),
      candidates: withoutManifest,
      objects,
    }, hasher);
    const option = projection.conflicts.find((item) => item.conflictId === 'conflict-alpha')!.options[0]! as unknown as {
      presentation?: { highlights: string[]; completeness: string };
    };
    expect(option.presentation).toMatchObject({ completeness: 'metadata-only', highlights: [] });
    expect(JSON.stringify(option.presentation)).not.toContain('Alpha route');
  });

  it('includes typed presentation facts in a new review fingerprint without changing comparison identity', async () => {
    const first = await buildComparisonReviewProjection({
      reviewId: 'review-presentation-fingerprint',
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);
    const changedCandidates = candidates.map((item) => {
      if (item.candidateId !== 'cand-C') return item;
      const changedManifest = {
        ...item.manifest,
        operations: item.manifest.operations.map((entry) => entry.sequence === 0 ? {
          ...entry,
          normalizedInput: {
            operationId: 'op-c-alpha',
            sceneId: 'wave6_alpha',
            blocks: [{ kind: 'text', speaker: 'lynn', value: 'Alpha route C revised.' }],
          },
        } : entry),
      };
      return { ...item, manifest: changedManifest, composition: { ...item.composition, manifest: changedManifest } };
    });
    const second = await buildComparisonReviewProjection({
      reviewId: 'review-presentation-fingerprint',
      comparison: comparison(),
      candidates: changedCandidates,
      objects,
    }, hasher);
    expect(second.sourceIdentity.comparisonFingerprint).toBe(first.sourceIdentity.comparisonFingerprint);
    expect(second.reviewFingerprint).not.toBe(first.reviewFingerprint);
  });

  const presentationCases: Array<[
    CompositionOperation['capabilityId'],
    CompositionOperation['normalizedInput'] & { operationId: string },
    string,
    string,
    string,
  ]> = [
    ['scene.create', { operationId: 'op-scene-create', sceneId: 'alpha', blocks: [{ kind: 'text', speaker: 'lynn', value: '创建台词' }] }, 'scene:alpha', '新建场景', '创建台词'],
    ['scene.patch', { operationId: 'op-scene-patch', sceneId: 'alpha', patch: { kind: 'replaceText', target: 'hidden-target', expectedFingerprint: 'hidden-fingerprint', speaker: 'lynn', value: '修改台词' } }, 'scene:alpha', '修改场景', '修改台词'],
    ['variable.ensure', { operationId: 'op-variable', name: 'route', type: 'string', initial: 'A' }, 'variable:route', '设置变量', '初始值'],
    ['character.ensure', { operationId: 'op-character', id: 'lynn', name: '凛', expectedFingerprint: 'hidden-fingerprint' }, 'character:lynn', '新建或更新角色', '显示名：凛'],
    ['character.remove', { operationId: 'op-character-remove', id: 'lynn', expectedFingerprint: 'hidden-fingerprint' }, 'character:lynn', '移除角色', '从项目角色表中移除'],
    ['timeline.create', { operationId: 'op-timeline-create', timelineId: 'intro', definition: { version: 1, id: 'intro', durationMs: 1200, tracks: [] } }, 'timeline:intro', '新建时间轴', '时长：1200 毫秒'],
    ['timeline.patch', { operationId: 'op-timeline-patch', timelineId: 'intro', patch: { kind: 'addTrack', expectedFingerprint: 'hidden-fingerprint', trackKind: 'background' } }, 'timeline:intro', '修改时间轴', '新增 背景 轨道'],
    ['project.entry-scene.set', { operationId: 'op-entry', sceneId: 'alpha', expectedFingerprint: 'hidden-fingerprint' }, 'config:entryScene', '设置入口场景', '入口场景：alpha'],
  ];

  it.each(presentationCases)(
    'formats %s from typed normalized input without exposing operation identity',
    (capabilityId, normalizedInput, primaryObject, actionLabel, highlight) => {
      const presentation = buildReviewUnitPresentation(primaryObject, [operation(
        0,
        capabilityId,
        normalizedInput,
        primaryObject,
        'presentation-fingerprint',
      )]);
      expect(presentation).toMatchObject({ actionLabel, completeness: 'content' });
      expect(presentation.highlights.join('\n')).toContain(highlight);
      expect(JSON.stringify(presentation)).not.toContain(String(normalizedInput.operationId));
      expect(JSON.stringify(presentation)).not.toContain('hidden-fingerprint');
    },
  );

  it('bounds long typed content and reports every omitted fact', () => {
    const blocks = Array.from({ length: 12 }, (_, index) => ({
      kind: 'text' as const,
      speaker: 'lynn',
      value: `第 ${index + 1} 条台词`,
    }));
    const presentation = buildReviewUnitPresentation('scene:bounded', [operation(
      0,
      'scene.create',
      { operationId: 'op-bounded', sceneId: 'bounded', blocks },
      'scene:bounded',
      'bounded-fingerprint',
    )]);

    expect(presentation.highlights).toHaveLength(8);
    expect(presentation.omittedFactCount).toBe(4);
  });

  it('keeps full v2 scene creation and later replacements separate without dropping the final edits', async () => {
    const longLine = '后来替换的台词。'.repeat(30);
    const sourceCandidates = candidates.map((item) => {
      if (item.candidateId !== 'cand-A') return item;
      const operations = [
        operation(0, 'scene.create', { sceneId: 'wave6_alpha', blocks: [
          ...Array.from({ length: 12 }, (_, index) => ({ kind: 'text', value: `第 ${index + 1} 句` })),
          { kind: 'choice', options: [{ label: '最初的选项', target: { kind: 'scene', value: 'old_end' } }] },
        ] }, 'scene:wave6_alpha', 'fp-alpha'),
        item.manifest.operations[1]!,
        operation(2, 'scene.patch', { sceneId: 'wave6_alpha', patch: { kind: 'replaceText', target: 'text-1', value: longLine } }, 'scene:wave6_alpha', 'fp-alpha'),
        operation(3, 'scene.patch', { sceneId: 'wave6_alpha', patch: { kind: 'replaceChoiceOption', target: 'choice-1', option: { label: '封存前替换的选项', target: { kind: 'scene', value: 'new_end' } } } }, 'scene:wave6_alpha', 'fp-alpha'),
      ];
      const manifest = { ...item.manifest, operations };
      const scenePath = 'custom/story/wave6_alpha.gal';
      const sealedFileDiffs = [{ path: scenePath, unexpectedFormatChange: false,
        unifiedDiff: [`--- ${scenePath}`, `+++ ${scenePath}`, ' @scene wave6_alpha', '-最初的台词', `+${longLine}`,
          ' @choice', '-  最初的选项 -> @jump old_end', '+  封存前替换的选项 -> @jump new_end', '-已经移除的内容',
          ...Array.from({ length: 12 }, (_, index) => `+第 ${index + 1} 句`)].join('\n') }];
      return { ...item, manifest, sealedFileDiffs, composition: { ...item.composition, manifest } };
    });
    const compared = comparison();
    compared.units.find((item) => item.unitId === 'unit-a-alpha')!.operationSequences = [0, 2, 3];
    const projected = await buildComparisonReviewProjection({ reviewId: 'full-v2', reviewVersion: '2.0.0', comparison: compared, candidates: sourceCandidates, objects }, hasher);
    if (projected.reviewVersion !== '2.0.0') throw new Error('v2 missing');
    const facts = projected.candidates.find((item) => item.candidateId === 'cand-A')!.verifiedFacts;
    const scenes = [...facts.content.scenes].sort((a, b) => a.operationSequence - b.operationSequence);
    expect(scenes.map((scene) => scene.action)).toEqual(['create', 'replaceText', 'replaceChoiceOption']);
    expect(scenes[0]!.highlights).toHaveLength(13);
    expect(scenes[0]!.highlights.join('\n')).not.toContain(longLine);
    expect(scenes[1]!.highlights).toEqual([`替换台词：${longLine}`]);
    expect(scenes[2]!.highlights).toEqual(['选项：封存前替换的选项 → new_end']);
    expect(facts.content.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '最初的选项', action: 'create', operationSequence: 0 }),
      expect.objectContaining({ label: '封存前替换的选项', action: 'replaceChoiceOption', operationSequence: 3 }),
    ]));
    expect(facts.units.find((item) => item.unitId === 'unit-a-alpha')!.presentation!.highlights).toContain(`替换台词：${longLine}`);
    expect(facts.content.omittedFactCount).toBe(0);
    expect(facts.content.finalScenes).toEqual([{ unitId: 'unit-a-alpha', sceneId: 'wave6_alpha', source: 'sealed-capsule-diff',
      paragraphs: [longLine, '选项：封存前替换的选项', ...Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 句`)] }]);
    expect(JSON.stringify(facts.content.finalScenes)).not.toMatch(/最初|已经移除/);
  });

  it('recomputes a legacy projection with presentation absent without injecting new identity fields', async () => {
    const current = await buildComparisonReviewProjection({
      reviewId: 'review-legacy-fingerprint',
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);
    const legacy = structuredClone(current);
    for (const group of legacy.safeGroups) {
      for (const source of group.sources) delete source.presentation;
    }
    for (const conflict of legacy.conflicts) {
      for (const option of conflict.options) delete option.presentation;
    }
    legacy.reviewFingerprint = 'historical-stored-value';
    const first = await comparisonReviewFingerprintOf(legacy, hasher);
    const second = await comparisonReviewFingerprintOf(structuredClone(legacy), hasher);

    expect(first).toBe(second);
    expect(first).not.toBe(current.reviewFingerprint);
    expect(legacy.safeGroups.every((group) => group.sources.every((source) => source.presentation === undefined))).toBe(true);
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
      candidates: [...candidates].reverse().map((item) => {
        const manifest = { ...item.manifest, operations: [...item.manifest.operations].reverse() };
        return { ...item, manifest, composition: { ...item.composition, manifest } };
      }),
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
    expect(projection.task.title).toBe('候选创作方案审阅');
    expect(projection.task.title).not.toContain('Candidate composition review');
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

  it.each([
    { request: '' },
    { request: ' \r\n ' },
    { request: '有效创作要求', acceptanceCriteria: [' '] },
  ])('rejects empty supplied brief content before creating an unreadable review: %j', async (creativeBrief) => {
    await expect(buildComparisonReviewProjection({ reviewId: 'invalid-brief', reviewVersion: '2.0.0',
      creativeBrief, comparison: comparison(), candidates, objects }, hasher)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('keeps v2 creative brief, candidate claims, verified units, and adoption preset as separate fields', async () => {
    const projection = await buildComparisonReviewProjection({
      reviewId: 'review-v2-comparison',
      reviewVersion: '2.0.0',
      creativeBrief: {
        title: 'Wave 9 brief',
        request: 'Build the complete authored route.',
        acceptanceCriteria: ['keep authored intent'],
      },
      comparison: comparison(),
      candidates,
      objects,
    }, hasher);

    expect(projection.reviewVersion).toBe('2.0.0');
    if (projection.reviewVersion !== '2.0.0') throw new Error('v2 projection missing');
    expect(projection.creativeBrief).toMatchObject({
      status: 'provided',
      request: 'Build the complete authored route.',
    });
    expect(projection.task.statementSource).toBe('creative-brief');
    expect(projection.defaultSelectedUnitIds).toEqual([]);
    expect(projection.candidates).toHaveLength(candidates.length);
    for (const item of projection.candidates) {
      const source = candidates.find((candidateItem) => candidateItem.candidateId === item.candidateId)!;
      const expectedUnits = comparison().units.filter((unitItem) => unitItem.candidateId === item.candidateId);
      expect(item.claims.source).toBe('candidate-change-intent');
      expect(item.verifiedFacts.units.map((unitItem) => unitItem.unitId)).toEqual(
        expect.arrayContaining(expectedUnits.map((unitItem) => unitItem.unitId)),
      );
      expect(item.adoptionPreset.candidateId).toBe(source.candidateId);
      expect(item.adoptionPreset.candidateRef).toEqual(source.ref);
    }
    expect(projection.candidates.find((item) => item.candidateId === 'cand-A')?.adoptionPreset).toMatchObject({
      status: 'available',
      selectedUnitIds: ['unit-a-alpha', 'unit-a-variable'],
      conflictResolutions: [expect.objectContaining({ conflictId: 'conflict-alpha', resolution: 'choose-unit' })],
    });
    expect(projection.candidates.find((item) => item.candidateId === 'cand-B')?.adoptionPreset).toMatchObject({
      status: 'available',
      selectedUnitIds: ['unit-b-beta', 'unit-b-timeline'],
      conflictResolutions: [expect.objectContaining({ conflictId: 'conflict-alpha', resolution: 'exclude-all' })],
    });
    expect(isReviewProjectionV2Fields(projection)).toBe(true);
  });

  it('binds v2 actual result explanation to the reviewed decision and result evidence', async () => {
    const runtimeEvent = {
      kind: 'instruction' as const,
      source: { sceneId: 'wave6_alpha', index: 0, op: 'instruction', file: 'content/scenario/wave6_alpha.gal', line: 2, col: 1 },
    };
    const projection = await buildResultReviewProjection({
      reviewId: 'result-v2',
      reviewVersion: '2.0.0',
      decisionIntent: {
        mode: 'adopt-candidate',
        candidate: { candidateId: 'cand-A', ref: { ...ref('A'), artifactSha256: 'a'.repeat(64) } },
      },
      plan: reviewedPlan(),
      change: readyResultChange(),
      diffFingerprint: 'diff-fingerprint',
      ...resultReviewEvidence(),
      runtimeTraces: [{
        sourceChangeId: 'change-result',
        sourceWorkingRevision: 3,
        traceId: 'runtime-trace',
        status: 'passed',
        events: [runtimeEvent],
      }],
      resultTreeSha256: 'result-tree-sha',
    }, hasher);

    expect(projection.reviewVersion).toBe('2.0.0');
    if (projection.reviewVersion !== '2.0.0' || projection.finalResult === undefined) {
      throw new Error('v2 result projection missing');
    }
    expect(projection.finalResult.actualExplanation).toMatchObject({
      source: 'integration-result',
      decisionFingerprint: 'decision-fingerprint',
      planId: 'plan-result',
      planFingerprint: 'plan-fingerprint',
      integrationChangeId: 'change-result',
      workingRevision: 3,
      runtimeTraceIds: ['runtime-trace'],
      actualRuntimeOutcomes: [expect.objectContaining({ traceId: 'runtime-trace', status: 'passed' })],
    });
    expect(isReviewProjectionV2Fields(projection)).toBe(true);

    const changedExplanation = {
      ...projection,
      finalResult: {
        ...projection.finalResult,
        actualExplanation: {
          ...projection.finalResult.actualExplanation!,
          warnings: ['changed explanation'],
        },
      },
    } as typeof projection;
    expect(await resultReviewFingerprintOf(changedExplanation, hasher)).not.toBe(projection.reviewFingerprint);
    expect(isReviewProjectionV2Fields({
      ...projection,
      finalResult: {
        ...projection.finalResult,
        actualExplanation: {
          ...projection.finalResult.actualExplanation!,
          decisionFingerprint: 'other-decision',
        },
      },
    })).toBe(false);
  });
});
