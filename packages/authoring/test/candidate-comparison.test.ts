import { describe, expect, it } from 'vitest';
import { compareCandidates } from '../src/candidate-comparison.js';
import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionConflict,
  CompositionOperation,
  CompositionManifest,
  ObjectProduction,
  ObjectRequirement,
  VerifiedCompositionCandidate,
} from '../src/composition-contracts.js';
import type { TextHasher } from '../src/contracts.js';

const PROJECT = 'proj-wave5';
const BASE = 'base-revision';
const hasher: TextHasher = {
  sha256: async (text) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
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

function production(objectRef: string, disposition: ObjectProduction['disposition'], finalFingerprint?: string): ObjectProduction {
  return { objectRef, disposition, ...(finalFingerprint === undefined ? {} : { finalFingerprint }) };
}

function requirement(objectRef: string, source: ObjectRequirement['source'], sequence?: number): ObjectRequirement {
  return { objectRef, source, ...(sequence === undefined ? {} : { candidateOperationSequence: sequence }) };
}

function operation(
  sequence: number,
  sourceOperationId: string,
  capabilityId: CompositionOperation['capabilityId'],
  primaryObject: string,
  produced: ObjectProduction[],
  required: ObjectRequirement[] = [],
): CompositionOperation {
  return {
    sequence,
    capabilityId,
    sourceOperationId,
    normalizedInput: { operationId: sourceOperationId },
    inputSha256: `sha-${sourceOperationId}`,
    primaryObject,
    requiredObjects: required,
    producedObjects: produced,
  };
}

function manifest(operations: CompositionOperation[], baseRevision: string = BASE): CompositionManifest {
  return {
    manifestVersion: '1.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: baseRevision,
    sourceChangeId: `chg_${operations.length}`,
    sourceWorkingRevision: operations.length,
    operations,
    manifestFingerprint: `mfp-${operations.map((item) => item.sourceOperationId).join(',')}`,
  };
}

function ref(changeId: string): CandidateCapsuleRef {
  return { changeId, capsuleId: `cap_${changeId}`, artifactSha256: `sha-artifact-${changeId}` };
}

function candidate(
  changeId: string,
  overrides: Partial<VerifiedCompositionCandidate> = {},
): VerifiedCompositionCandidate {
  const base: VerifiedCompositionCandidate = {
    candidateId: `cand-${changeId}`,
    ref: ref(changeId),
    capsuleVersion: '2.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: BASE,
    sourceWorkingRevision: 1,
    composition: { eligibility: 'unavailable', reasons: [{ code: 'MISSING_NORMALIZED_INPUT', message: 'empty default' }] },
    evidenceSummary: freshEvidence,
    semanticDiff: [],
  };
  const merged = { ...base, ...overrides };
  if (overrides.composition?.eligibility === 'ready') {
    merged.composition = { ...overrides.composition, reasons: [] };
  }
  return merged;
}

function readyCandidate(
  changeId: string,
  operations: CompositionOperation[],
  overrides: Partial<VerifiedCompositionCandidate> = {},
): VerifiedCompositionCandidate {
  return candidate(changeId, {
    composition: { eligibility: 'ready', reasons: [], manifest: manifest(operations) },
    ...overrides,
  });
}

async function compare(candidates: VerifiedCompositionCandidate[], currentRevision: string = BASE) {
  return compareCandidates({
    projectIdentity: PROJECT,
    currentProjectRevision: currentRevision,
    candidates,
  }, hasher);
}


/** 规格 5.4 要求至少两个候选；无关候选用于单侧场景。 */
function bystander(): VerifiedCompositionCandidate {
  return readyCandidate('zz-bystander', [
    operation(0, 'op_zz', 'variable.ensure', 'variable:zz', [production('variable:zz', 'create', 'fp-zz')]),
  ]);
}

describe('Wave 5 candidate comparison', () => {
  it('blocks a legacy synthetic reciprocal primary-unit cycle even though each producer sequence is earlier', async () => {
    const result = await compare([readyCandidate('cycle', [
      operation(0, 'create-a', 'scene.create', 'scene:A', [production('scene:A', 'create', 'a0')]),
      operation(1, 'create-b', 'scene.create', 'scene:B', [production('scene:B', 'create', 'b0')]),
      operation(2, 'a-to-b', 'scene.patch', 'scene:A', [production('scene:A', 'update', 'a1')], [requirement('scene:B', 'candidate', 1)]),
      operation(3, 'b-to-a', 'scene.patch', 'scene:B', [production('scene:B', 'update', 'b1')], [requirement('scene:A', 'candidate', 0)]),
    ]), bystander()]);
    expect(result.status).toBe('blocked');
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: 'DEPENDENCY_CYCLE', severity: 'blocking', objectRefs: ['scene:A', 'scene:B'] }));
    expect(result.units.find((unit) => unit.primaryObject === 'scene:A')!.operationSequences).toEqual([0, 2]);
  });

  it('treats disjoint closures as composable with no structural conflicts', async () => {
    const result = await compare([
      readyCandidate('a', [operation(0, 'op_a', 'scene.create', 'scene:alpha', [production('scene:alpha', 'create', 'fp-alpha')])]),
      readyCandidate('b', [operation(0, 'op_b', 'timeline.create', 'timeline:beta', [production('timeline:beta', 'create', 'fp-beta')])]),
    ]);
    expect(result.status).toBe('composable');
    expect(result.units).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(result.identicalGroups).toEqual([]);
    expect(result.expectedProjectRevision).toBe(BASE);
    expect(result.candidates).toHaveLength(2);
  });

  it('keeps a create+patch chain on the same timeline as one unsplittable unit', async () => {
    const result = await compare([
      readyCandidate('b', [
        operation(0, 'op_create_t', 'timeline.create', 'timeline:beta', [production('timeline:beta', 'create', 'fp-t1')]),
        operation(1, 'op_patch_t', 'timeline.patch', 'timeline:beta', [production('timeline:beta', 'update', 'fp-t2')]),
      ]),
      bystander(),
    ]);
    expect(result.units).toHaveLength(2); // timeline 单元 + 无关 bystander 单元
    const timelineUnit = result.units.find((unit) => unit.primaryObject === 'timeline:beta')!;
    expect(timelineUnit.operationSequences).toEqual([0, 1]);
    expect(timelineUnit.finalFingerprint).toBe('fp-t2');
    expect(timelineUnit.producedObjects).toHaveLength(2);
    expect(result.status).toBe('composable');
  });

  it('groups identical results across candidates while keeping all provenance', async () => {
    const result = await compare([
      readyCandidate('a', [operation(0, 'op_same_a', 'scene.create', 'scene:same', [production('scene:same', 'create', 'fp-same')])]),
      readyCandidate('b', [operation(0, 'op_same_b', 'scene.create', 'scene:same', [production('scene:same', 'create', 'fp-same')])]),
    ]);
    expect(result.status).toBe('composable');
    expect(result.identicalGroups).toHaveLength(1);
    expect(result.identicalGroups[0]!.primaryObject).toBe('scene:same');
    expect(result.identicalGroups[0]!.finalFingerprint).toBe('fp-same');
    expect(result.identicalGroups[0]!.unitIds).toHaveLength(2);
    // provenance 保留：两个候选都还在 candidates 与 units 里。
    expect(result.candidates).toHaveLength(2);
    expect(result.units.every((unit) => unit.primaryObject === 'scene:same')).toBe(true);
  });

  it('compares final results rather than the shared initial production of two edited scenes', async () => {
    const candidates = ['a', 'b'].map((id) => readyCandidate(id, [
      operation(0, `create-${id}`, 'scene.create', 'scene:edited', [production('scene:edited', 'create', 'same-initial')]),
      operation(1, `patch-${id}`, 'scene.patch', 'scene:edited', [production('scene:edited', 'update', `final-${id}`)]),
    ]));
    const result = await compare(candidates);
    expect(result.status).toBe('review-only');
    expect(result.identicalGroups).toEqual([]);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: 'OBJECT_RESULTS_DIVERGE' }));
  });

  it('groups equal final scene results even when one candidate reached them through a patch', async () => {
    const result = await compare([
      readyCandidate('a', [
        operation(0, 'create-a', 'scene.create', 'scene:edited', [production('scene:edited', 'create', 'initial')]),
        operation(1, 'patch-a', 'scene.patch', 'scene:edited', [production('scene:edited', 'update', 'final')]),
      ]),
      readyCandidate('b', [operation(0, 'create-b', 'scene.create', 'scene:edited', [production('scene:edited', 'create', 'final')])]),
    ]);
    expect(result.status).toBe('composable');
    expect(result.identicalGroups).toHaveLength(1);
    expect(result.identicalGroups[0]!.finalFingerprint).toBe('final');
  });

  it('does not treat a removed then recreated character as absent in the final result', async () => {
    const result = await compare([
      readyCandidate('restored', [
        operation(0, 'remove', 'character.remove', 'character:old', [production('character:old', 'remove')]),
        operation(1, 'restore', 'character.ensure', 'character:old', [production('character:old', 'create', 'restored')]),
      ]),
      readyCandidate('consumer', [operation(0, 'use', 'scene.create', 'scene:uses', [production('scene:uses', 'create', 'uses')], [requirement('character:old', 'base')])]),
    ]);
    expect(result.conflicts.some((conflict) => conflict.code === 'REQUIRED_OBJECT_REMOVED')).toBe(false);
    expect(result.status).toBe('composable');
  });

  it('groups an identical signature subset while keeping a divergent peer reviewable', async () => {
    const result = await compare([
      readyCandidate('a', [operation(0, 'op_subset_a', 'scene.create', 'scene:subset', [production('scene:subset', 'create', 'fp-same')])]),
      readyCandidate('c', [operation(0, 'op_subset_c', 'scene.create', 'scene:subset', [production('scene:subset', 'create', 'fp-different')])]),
      readyCandidate('d', [operation(0, 'op_subset_d', 'scene.create', 'scene:subset', [production('scene:subset', 'create', 'fp-same')])]),
    ]);

    expect(result.status).toBe('review-only');
    const sameUnits = result.units.filter((unit) => unit.finalFingerprint === 'fp-same');
    expect(sameUnits).toHaveLength(2);
    const identical = result.identicalGroups.find((group) => group.primaryObject === 'scene:subset');
    expect(identical).toBeDefined();
    expect(identical!.finalFingerprint).toBe('fp-same');
    expect(new Set(identical!.unitIds)).toEqual(new Set(sameUnits.map((unit) => unit.unitId)));

    const conflict = result.conflicts.find((item) =>
      item.severity === 'selection-required' && item.objectRefs.includes('scene:subset'));
    expect(conflict).toBeDefined();
    expect(new Set(conflict!.unitIds)).toEqual(new Set(result.units.map((unit) => unit.unitId)));
  });

  it('requires explicit selection when the same scene has different fingerprints', async () => {
    const result = await compare([
      readyCandidate('a', [operation(0, 'op_x_a', 'scene.create', 'scene:x', [production('scene:x', 'create', 'fp-a')])]),
      readyCandidate('c', [operation(0, 'op_x_c', 'scene.create', 'scene:x', [production('scene:x', 'create', 'fp-c')])]),
    ]);
    expect(result.status).toBe('review-only');
    const conflict = result.conflicts.find((item) => item.severity === 'selection-required');
    expect(conflict).toBeDefined();
    expect(conflict!.objectRefs).toContain('scene:x');
    expect(conflict!.allowedResolutions).toContain('choose-unit');
  });

  it('requires selection when one candidate removes an object another closure requires', async () => {
    const result = await compare([
      readyCandidate('remover', [
        operation(0, 'op_remove_char', 'character.remove', 'character:old', [
          production('character:old', 'remove'),
          production('config:characters', 'update', 'fp-table-after'),
        ]),
      ]),
      readyCandidate('user', [
        operation(0, 'op_use_char', 'character.ensure', 'character:keeper', [
          production('character:keeper', 'create', 'fp-keeper'),
          production('config:characters', 'update', 'fp-table-keep'),
        ], [requirement('character:old', 'base')]),
      ]),
    ]);
    expect(result.status).toBe('review-only');
    const conflict = result.conflicts.find((item) => item.severity === 'selection-required');
    expect(conflict).toBeDefined();
    expect(conflict!.objectRefs).toContain('character:old');
  });

  it('creates a dependency edge from the requiring unit to the same-candidate producer unit', async () => {
    const timelineOps = [
      operation(0, 'op_tl', 'timeline.create', 'timeline:dep', [production('timeline:dep', 'create', 'fp-dep')]),
      operation(1, 'op_sc', 'scene.create', 'scene:uses', [production('scene:uses', 'create', 'fp-uses')], [requirement('timeline:dep', 'candidate', 0)]),
    ];
    const result = await compare([readyCandidate('chain', timelineOps), bystander()]);
    expect(result.dependencyEdges).toHaveLength(1);
    const edge = result.dependencyEdges[0]!;
    const sceneUnit = result.units.find((unit) => unit.primaryObject === 'scene:uses')!;
    const timelineUnit = result.units.find((unit) => unit.primaryObject === 'timeline:dep')!;
    expect(edge.fromUnitId).toBe(sceneUnit.unitId);
    expect(edge.toUnitId).toBe(timelineUnit.unitId);
    expect(edge.objectRef).toBe('timeline:dep');
    expect(sceneUnit.requiredUnitIds).toEqual([timelineUnit.unitId]);
    expect(result.status).toBe('composable');
  });

  it('blocks when a claimed candidate dependency is produced by no earlier operation', async () => {
    const broken = [
      operation(0, 'op_broken_scene', 'scene.create', 'scene:orphan', [production('scene:orphan', 'create', 'fp-orphan')],
        [requirement('timeline:ghost', 'candidate', 0)]),
    ];
    const result = await compare([readyCandidate('broken', broken), bystander()]);
    expect(result.status).toBe('blocked');
    const conflict = result.conflicts.find((item) => item.severity === 'blocking');
    expect(conflict).toBeDefined();
  });

  it('marks v1 or unavailable capsules as not composable and stays review-only', async () => {
    const legacy = candidate('legacy', { capsuleVersion: '1.0.0' });
    const unavailableV2 = candidate('broken-v2');
    const healthy = readyCandidate('healthy', [
      operation(0, 'op_h', 'variable.ensure', 'variable:v', [production('variable:v', 'create', 'fp-v')]),
    ]);
    const result = await compare([legacy, unavailableV2, healthy]);
    expect(result.status).toBe('review-only');
    const notComposable = result.conflicts.filter((item) => item.code === 'CANDIDATE_NOT_COMPOSABLE');
    expect(notComposable).toHaveLength(2);
    for (const conflict of notComposable) {
      expect(conflict.candidateIds).toHaveLength(1);
    }
    expect(result.units.every((unit) => unit.candidateId === 'cand-healthy')).toBe(true);
  });

  it('blocks on project identity or cross-candidate base mismatch', async () => {
    const foreignProject = candidate('foreign', { projectIdentity: 'other-project' });
    const wrongBase = readyCandidate('wrong-base', [
      operation(0, 'op_wb', 'variable.ensure', 'variable:w', [production('variable:w', 'create', 'fp-w')]),
    ], { baseProjectRevision: 'another-base' });
    const mismatched = await compare([readyCandidate('ok', [
      operation(0, 'op_ok', 'variable.ensure', 'variable:ok', [production('variable:ok', 'create', 'fp-ok')]),
    ]), wrongBase]);
    expect(mismatched.status).toBe('blocked');

    const identityResult = await compareCandidates({
      projectIdentity: PROJECT,
      currentProjectRevision: BASE,
      candidates: [foreignProject, bystander()],
    }, hasher);
    expect(identityResult.status).toBe('blocked');
    expect(identityResult.conflicts.some((item) => item.severity === 'blocking')).toBe(true);
  });

  it('allows review-only comparison when the project has left the common base but blocks plans later', async () => {
    const result = await compare([
      readyCandidate('a', [operation(0, 'op_a2', 'scene.create', 'scene:moved', [production('scene:moved', 'create', 'fp-moved')])]),
      bystander(),
    ], 'moved-on-revision');
    expect(result.status).toBe('review-only');
    expect(result.expectedProjectRevision).toBe('moved-on-revision');
    expect(result.conflicts.filter((item) => item.severity === 'selection-required')).toEqual([]);
  });

  it('reports stale or missing evidence as advisory without inventing structural conflicts', async () => {
    const staleEvidence: CandidateEvidenceSummary = {
      validation: 'stale',
      simulation: 'missing',
      runtime: 'failed',
      warnings: 2,
      manualReviewRequired: ['VALIDATION_WARNINGS'],
    };
    const result = await compare([
      readyCandidate('stale', [
        operation(0, 'op_stale', 'scene.create', 'scene:stale', [production('scene:stale', 'create', 'fp-stale')]),
      ], { evidenceSummary: staleEvidence }),
      readyCandidate('fresh', [operation(0, 'op_fresh', 'scene.create', 'scene:fresh', [production('scene:fresh', 'create', 'fp-fresh')])]),
    ]);
    const advisories = result.conflicts.filter((item) => item.severity === 'advisory');
    expect(advisories.length).toBeGreaterThan(0);
    expect(advisories.every((item) => !item.objectRefs.includes('scene:stale') || item.code.startsWith('EVIDENCE'))).toBe(true);
    expect(result.status).toBe('composable');
  });

  it('rejects bound violations with explicit INVALID_REQUEST before building any graph', async () => {
    const nine = Array.from({ length: 9 }, (_, index) => readyCandidate(`n${index}`, [
      operation(0, `op_n${index}`, 'variable.ensure', `variable:n${index}`, [production(`variable:n${index}`, 'create', `fp-n${index}`)]),
    ]));
    await expect(compare(nine)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(compare([nine[0]!])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(compare([])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const manyOps: CompositionOperation[] = Array.from({ length: 257 }, (_, index) =>
      operation(index, `op_many_${index}`, 'variable.ensure', `variable:m${index}`, [production(`variable:m${index}`, 'create', `fp-m${index}`)]));
    await expect(compare([readyCandidate('many', manyOps), bystander()])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    // 256 ops × 5 required each = 1280 potential edges > 1024：在建图前拒绝。
    const heavyRequired: CompositionOperation[] = Array.from({ length: 256 }, (_, index) =>
      operation(index, `op_edge_${index}`, 'scene.create', `scene:e${index}`, [production(`scene:e${index}`, 'create', `fp-e${index}`)], [
        requirement(`asset:bg:${index}_0`, 'base'),
        requirement(`asset:bg:${index}_1`, 'base'),
        requirement(`asset:bg:${index}_2`, 'base'),
        requirement(`asset:bg:${index}_3`, 'base'),
        requirement(`asset:bg:${index}_4`, 'base'),
      ]));
    await expect(compare([readyCandidate('edges', heavyRequired), bystander()])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('produces a byte-stable fingerprint regardless of candidate input order', async () => {
    const candidates = [
      readyCandidate('a', [operation(0, 'op_a3', 'scene.create', 'scene:alpha', [production('scene:alpha', 'create', 'fp-alpha')])]),
      readyCandidate('b', [operation(0, 'op_b3', 'timeline.create', 'timeline:beta', [production('timeline:beta', 'create', 'fp-beta')])]),
      readyCandidate('d', [operation(0, 'op_d', 'variable.ensure', 'variable:delta', [production('variable:delta', 'create', 'fp-delta')])]),
    ];
    let firstFingerprint: string | undefined;
    let firstUnitsJson: string | undefined;
    for (let round = 0; round < 10; round += 1) {
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const result = await compare(shuffled);
      if (firstFingerprint === undefined) {
        firstFingerprint = result.comparisonFingerprint;
        firstUnitsJson = JSON.stringify(result.units);
      }
      expect(result.comparisonFingerprint).toBe(firstFingerprint);
      expect(JSON.stringify(result.units)).toBe(firstUnitsJson);
      // 候选列表本身按规范键排序输出。
      const shas = result.candidates.map((item) => item.artifactSha256);
      expect(shas).toEqual([...shas].sort());
    }
  });

  it('exposes stable conflict ids across identical inputs', async () => {
    const run = () => compare([
      readyCandidate('a', [operation(0, 'op_y_a', 'scene.create', 'scene:y', [production('scene:y', 'create', 'fp-y1')])]),
      readyCandidate('c', [operation(0, 'op_y_c', 'scene.create', 'scene:y', [production('scene:y', 'create', 'fp-y2')])]),
    ]);
    const first = await run();
    const second = await run();
    const ids = (items: CompositionConflict[]) => items.map((item) => item.conflictId).sort();
    expect(ids(second.conflicts)).toEqual(ids(first.conflicts));
  });
});
