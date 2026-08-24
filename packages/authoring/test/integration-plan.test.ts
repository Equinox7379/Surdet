import { describe, expect, it } from 'vitest';
import { compareCandidates } from '../src/candidate-comparison.js';
import { buildIntegrationPlan, sealDryRunResult } from '../src/integration-plan.js';
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
import type { ConflictResolutionInput } from '../src/integration-plan.js';

const PROJECT = 'proj-wave5';
const BASE = 'base-revision';
const NOW_A = '2026-08-24T10:00:00.000Z';
const NOW_B = '2026-08-24T11:30:00.000Z';

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

function sha256Sync(text: string): string {
  // 与 hasher 相同的 FNV 实现，用于测试内派生期望值。
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

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

function readyCandidate(
  changeId: string,
  operations: CompositionOperation[],
): VerifiedCompositionCandidate {
  const manifest: CompositionManifest = {
    manifestVersion: '1.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: BASE,
    sourceChangeId: `chg_${changeId}`,
    sourceWorkingRevision: operations.length,
    operations,
    manifestFingerprint: `mfp-${changeId}`,
  };
  return {
    candidateId: `cand-${changeId}`,
    ref: { changeId, capsuleId: `cap_${changeId}`, artifactSha256: `sha-artifact-${changeId}` },
    capsuleVersion: '2.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: BASE,
    sourceWorkingRevision: operations.length,
    composition: { eligibility: 'ready', reasons: [], manifest },
    evidenceSummary: freshEvidence,
    semanticDiff: [],
  };
}

async function compareWithManifests(candidates: VerifiedCompositionCandidate[]): Promise<{
  comparison: CompositionComparison & { candidateManifests?: Record<string, CompositionManifest> };
  manifests: Record<string, CompositionManifest>;
}> {
  const comparison = await compareCandidates({
    projectIdentity: PROJECT,
    currentProjectRevision: BASE,
    candidates,
  }, hasher) as CompositionComparison & { candidateManifests?: Record<string, CompositionManifest> };
  const manifests: Record<string, CompositionManifest> = {};
  for (const candidate of candidates) {
    if (candidate.composition.manifest !== undefined) manifests[candidate.candidateId] = candidate.composition.manifest;
  }
  comparison.candidateManifests = manifests;
  return { comparison, manifests };
}

describe('Wave 5 integration plans', () => {
  it('pulls the same-candidate required timeline into the closure automatically', async () => {
    const ops = [
      operation(0, 'op_tl', 'timeline.create', 'timeline:dep', [production('timeline:dep', 'create', 'fp-dep')]),
      operation(1, 'op_sc', 'scene.create', 'scene:uses', [production('scene:uses', 'create', 'fp-uses')],
        [requirement('timeline:dep', 'candidate', 0)]),
    ];
    const { comparison } = await compareWithManifests([readyCandidate('chain', ops), readyCandidate('other', [
      operation(0, 'op_o', 'variable.ensure', 'variable:o', [production('variable:o', 'create', 'fp-o')]),
    ])]);
    const sceneUnit = comparison.units.find((unit) => unit.primaryObject === 'scene:uses')!;
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: [sceneUnit.unitId],
      conflictResolutions: [],
      now: NOW_A,
    }, hasher);
    expect(draft.implicitInclusions).toHaveLength(1);
    expect(draft.selectedUnitIds).toEqual([sceneUnit.unitId]);
    const primaryIds = comparison.units.filter((unit) => unit.primaryObject === 'timeline:dep').map((unit) => unit.unitId);
    expect(primaryIds).toHaveLength(1);
    expect(draft.implicitInclusions).toContain(primaryIds[0]);
    // replay chain 同时覆盖 timeline 与 scene 操作。
    expect(draft.replayOperations.map((item) => item.sourceOperationId).sort()).toEqual(['op_sc', 'op_tl']);
    for (const item of draft.replayOperations) {
      expect(item.integrationOperationId).toMatch(/^cmp_[0-9a-f]{8,16}_[0-9]{4}_[0-9a-f]{8,16}$/);
    }
  });

  it('does not pull in reverse referencers that were not selected', async () => {
    const provider = readyCandidate('provider', [
      operation(0, 'op_tl_p', 'timeline.create', 'timeline:pub', [production('timeline:pub', 'create', 'fp-pub')]),
    ]);
    const consumer = readyCandidate('consumer', [
      operation(0, 'op_sc_c', 'scene.create', 'scene:c', [production('scene:c', 'create', 'fp-c')],
        [requirement('timeline:pub', 'base')]),
    ]);
    const { comparison } = await compareWithManifests([provider, consumer]);
    const consumerUnit = comparison.units.find((unit) => unit.primaryObject === 'scene:c')!;
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: [consumerUnit.unitId],
      conflictResolutions: [],
      now: NOW_A,
    }, hasher);
    expect(draft.implicitInclusions).toEqual([]);
    expect(draft.replayOperations.map((item) => item.sourceOperationId)).toEqual(['op_sc_c']);
  });

  it('rejects unresolved selection conflicts with COMPOSITION_CONFLICT_UNRESOLVED', async () => {
    const a = readyCandidate('da', [operation(0, 'op_x_a', 'scene.create', 'scene:x', [production('scene:x', 'create', 'fp-a')])]);
    const c = readyCandidate('dc', [operation(0, 'op_x_c', 'scene.create', 'scene:x', [production('scene:x', 'create', 'fp-c')])]);
    const { comparison } = await compareWithManifests([a, c]);
    await expect(buildIntegrationPlan({
      comparison,
      selectedUnitIds: [],
      conflictResolutions: [],
      now: NOW_A,
    }, hasher)).rejects.toMatchObject({ code: 'COMPOSITION_CONFLICT_UNRESOLVED' });
  });

  it('accepts choose-unit only for units listed by that conflict', async () => {
    const a = readyCandidate('ca', [operation(0, 'op_y_a', 'scene.create', 'scene:y', [production('scene:y', 'create', 'fp-y-a')])]);
    const c = readyCandidate('cc', [operation(0, 'op_y_c', 'scene.create', 'scene:y', [production('scene:y', 'create', 'fp-y-c')])]);
    const side = readyCandidate('cs', [operation(0, 'op_y_s', 'variable.ensure', 'variable:side', [production('variable:side', 'create', 'fp-side')])]);
    const { comparison } = await compareWithManifests([a, c, side]);
    const conflict = comparison.conflicts.find((item) => item.severity === 'selection-required')!;
    const outsider = comparison.units.find((unit) => !conflict.unitIds.includes(unit.unitId))!.unitId;
    await expect(buildIntegrationPlan({
      comparison,
      selectedUnitIds: [outsider],
      conflictResolutions: [{ conflictId: conflict.conflictId, resolution: 'choose-unit', chosenUnitId: outsider, actor: 'human' }],
      now: NOW_A,
    }, hasher)).rejects.toMatchObject({ code: 'COMPOSITION_PLAN_INVALID' });
  });

  it('applies exclude-all to both sides while keeping unrelated selections', async () => {
    const a = readyCandidate('ea', [operation(0, 'op_z_a', 'scene.create', 'scene:z', [production('scene:z', 'create', 'fp-z-a')])]);
    const b = readyCandidate('eb', [operation(0, 'op_z_b', 'scene.create', 'scene:z', [production('scene:z', 'create', 'fp-z-b')])]);
    const other = readyCandidate('eo', [operation(0, 'op_keep', 'variable.ensure', 'variable:keep', [production('variable:keep', 'create', 'fp-keep')])]);
    const { comparison } = await compareWithManifests([a, b, other]);
    const conflict = comparison.conflicts.find((item) => item.severity === 'selection-required')!;
    const keepUnit = comparison.units.find((unit) => unit.primaryObject === 'variable:keep')!;
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: [keepUnit.unitId],
      conflictResolutions: [{ conflictId: conflict.conflictId, resolution: 'exclude-all', actor: 'human' }],
      now: NOW_A,
    }, hasher);
    expect(new Set(draft.excludedUnitIds)).toEqual(new Set(conflict.unitIds));
    expect(draft.selectedUnitIds).toEqual([keepUnit.unitId]);
    expect(draft.replayOperations.map((item) => item.sourceOperationId)).toEqual(['op_keep']);
  });

  it('treats regenerate-candidate as non-executable without fabricating replay entries', async () => {
    const a = readyCandidate('ra', [operation(0, 'op_r_a', 'scene.create', 'scene:r', [production('scene:r', 'create', 'fp-r-a')])]);
    const c = readyCandidate('rc', [operation(0, 'op_r_c', 'scene.create', 'scene:r', [production('scene:r', 'create', 'fp-r-c')])]);
    const { comparison } = await compareWithManifests([a, c]);
    const conflict = comparison.conflicts.find((item) => item.severity === 'selection-required')!;
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: [],
      conflictResolutions: [{ conflictId: conflict.conflictId, resolution: 'regenerate-candidate', actor: 'human' }],
      now: NOW_A,
    }, hasher);
    expect(new Set(draft.excludedUnitIds)).toEqual(new Set(conflict.unitIds));
    expect(draft.replayOperations).toEqual([]);
    const sealed = await sealDryRunResult(draft, {
      status: 'failed',
      finalObjectFingerprints: {},
      errors: [{ code: 'CANDIDATE_NOT_COMPOSABLE', message: 'candidate must be regenerated' }],
    }, hasher);
    expect(sealed.dryRun.status).toBe('failed');
  });

  it('keeps one replay chain per identical group while provenance retains all units', async () => {
    const a = readyCandidate('ia', [operation(0, 'op_i_a', 'scene.create', 'scene:i', [production('scene:i', 'create', 'fp-same-i')])]);
    const b = readyCandidate('ib', [operation(0, 'op_i_b', 'scene.create', 'scene:i', [production('scene:i', 'create', 'fp-same-i')])]);
    const { comparison } = await compareWithManifests([a, b]);
    expect(comparison.identicalGroups).toHaveLength(1);
    const group = comparison.identicalGroups[0]!;
    const chosen = group.unitIds[0]!;
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: [chosen],
      conflictResolutions: [],
      now: NOW_A,
    }, hasher);
    const chainsForGroup = new Set(
      draft.replayOperations
        .filter((item) => group.unitIds.includes(item.sourceUnitId))
        .map((item) => item.sourceUnitId),
    );
    expect(chainsForGroup.size).toBe(1);
    expect(draft.deduplicatedUnits[0]!.groupId).toBe(group.groupId);
    expect(new Set(draft.deduplicatedUnits[0]!.provenanceUnitIds)).toEqual(new Set(group.unitIds));
  });

  it('has no caller-supplied replay payload entry point', async () => {
    const a = readyCandidate('na', [operation(0, 'op_n_a', 'scene.create', 'scene:n', [production('scene:n', 'create', 'fp-n-a')])]);
    const b = readyCandidate('nb', [operation(0, 'op_n_b', 'variable.ensure', 'variable:n', [production('variable:n', 'create', 'fp-n-b')])]);
    const { comparison } = await compareWithManifests([a, b]);
    const sneaky = {
      comparison,
      selectedUnitIds: comparison.units.map((unit) => unit.unitId),
      conflictResolutions: [] as ConflictResolutionInput[],
      now: NOW_A,
      callerReplayOperations: [{
        sequence: 99, capabilityId: 'scene.create' as const, sourceOperationId: 'op_evil',
        normalizedInput: { operationId: 'op_evil', sceneId: 'evil' }, inputSha256: 'evil',
        primaryObject: 'scene:evil', requiredObjects: [],
        producedObjects: [production('scene:evil', 'create', 'fp-evil')],
      }],
      replayOperations: 42 as unknown as never[],
    } as unknown as Parameters<typeof buildIntegrationPlan>[0];
    const draft = await buildIntegrationPlan(sneaky, hasher);
    expect(draft.replayOperations.map((item) => item.sourceOperationId).sort()).toEqual(['op_n_a', 'op_n_b']);
  });

  it('orders replay operations topologically then by object/capsule/source sequence', async () => {
    const chainOps = [
      operation(0, 'op_chain_tl', 'timeline.create', 'timeline:ord', [production('timeline:ord', 'create', 'fp-ord-tl')]),
      operation(1, 'op_chain_sc', 'scene.create', 'scene:ord', [production('scene:ord', 'create', 'fp-ord-sc')],
        [requirement('timeline:ord', 'candidate', 0)]),
    ];
    const alpha = readyCandidate('ord-a', chainOps);
    const beta = readyCandidate('ord-b', [
      operation(0, 'op_beta_sc', 'scene.create', 'scene:aardvark', [production('scene:aardvark', 'create', 'fp-aar')]),
    ]);
    const { comparison } = await compareWithManifests([beta, alpha]);
    const draft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: comparison.units.map((unit) => unit.unitId),
      conflictResolutions: [],
      now: NOW_A,
    }, hasher);
    const ids = draft.replayOperations.map((item) => `${item.primaryObject}:${item.sourceOperationId}`);
    // 同层(0)内按 primaryObject 字典序：scene:aardvark < timeline:ord；依赖者排在其依赖之后。
    expect(ids).toEqual([
      'scene:aardvark:op_beta_sc',
      'timeline:ord:op_chain_tl',
      'scene:ord:op_chain_sc',
    ]);
    expect(draft.replayOperations.map((item) => Number(item.integrationOperationId.split('_')[2]))).toEqual([0, 1, 2]);
  });

  it('derives the same semantic planFingerprint regardless of reason or now', async () => {
    const a = readyCandidate('fa', [operation(0, 'op_f_a', 'scene.create', 'scene:f', [production('scene:f', 'create', 'fp-f-a')])]);
    const b = readyCandidate('fb', [operation(0, 'op_f_b', 'variable.ensure', 'variable:f', [production('variable:f', 'create', 'fp-f-b')])]);
    const { comparison } = await compareWithManifests([a, b]);
    const selected = comparison.units.map((unit) => unit.unitId);
    const dryRun = {
      status: 'passed' as const,
      finalObjectFingerprints: { 'scene:f': 'fp-f-a', 'variable:f': 'fp-f-b' },
      errors: [],
    };
    const first = await sealDryRunResult(await buildIntegrationPlan({
      comparison, selectedUnitIds: selected, conflictResolutions: [], now: NOW_A,
    }, hasher), dryRun, hasher);
    const second = await sealDryRunResult(await buildIntegrationPlan({
      comparison,
      selectedUnitIds: selected,
      conflictResolutions: [],
      now: NOW_B,
    }, hasher), dryRun, hasher);
    expect(second.planFingerprint).toBe(first.planFingerprint);
    expect(second.planId).toBe(first.planId);
    expect(second.planId.startsWith('pln_')).toBe(true);
    const tampered = await sealDryRunResult(await buildIntegrationPlan({
      comparison, selectedUnitIds: selected, conflictResolutions: [], now: NOW_A,
    }, hasher), { ...dryRun, status: 'failed' as const }, hasher);
    expect(tampered.planFingerprint).not.toBe(first.planFingerprint);
  });
});
