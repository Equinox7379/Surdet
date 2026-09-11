import { describe, expect, it, vi } from 'vitest';
import {
  compareCandidates,
  type CandidateEvidenceSummary,
  type CompositionComparison,
  type CompositionManifest,
  type CompositionOperation,
  type TextHasher,
  type VerifiedCompositionCandidate,
} from '@surdet/authoring';
import {
  CompositionService,
  type CompositionCompareResult,
} from '../src/authoring/composition-service.js';
import type {
  CompositionArtifactIdentity,
  NodeCompositionStore,
} from '../src/authoring/node-composition-store.js';

const PROJECT = 'project-preview-service';
const BASE = 'revision-preview-service';

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

const evidence: CandidateEvidenceSummary = {
  validation: 'fresh',
  simulation: 'fresh',
  runtime: 'fresh',
  warnings: 0,
  manualReviewRequired: [],
};

function candidate(changeId: string, objectRef: string): VerifiedCompositionCandidate {
  const operation: CompositionOperation = {
    sequence: 0,
    capabilityId: 'scene.create',
    sourceOperationId: `operation-${changeId}`,
    normalizedInput: { operationId: `operation-${changeId}` },
    inputSha256: `input-${changeId}`,
    primaryObject: objectRef,
    requiredObjects: [],
    producedObjects: [{ objectRef, disposition: 'create', finalFingerprint: `fingerprint-${changeId}` }],
  };
  const manifest: CompositionManifest = {
    manifestVersion: '1.0.0',
    projectIdentity: PROJECT,
    baseProjectRevision: BASE,
    sourceChangeId: changeId,
    sourceWorkingRevision: 1,
    operations: [operation],
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
    sourceWorkingRevision: 1,
    composition: { eligibility: 'ready', reasons: [], manifest },
    evidenceSummary: evidence,
    semanticDiff: [],
  };
}

async function compareResult(): Promise<CompositionCompareResult> {
  const candidates = [candidate('a', 'scene:a'), candidate('b', 'scene:b')];
  const comparison = await compareCandidates({
    projectIdentity: PROJECT,
    currentProjectRevision: BASE,
    candidates,
  }, hasher) as CompositionComparison & { candidateManifests?: Record<string, CompositionManifest> };
  comparison.candidateManifests = Object.fromEntries(candidates.map((item) => [
    item.candidateId,
    item.composition.manifest!,
  ]));
  return { comparison, candidates, currentProjectRevision: BASE };
}

describe('CompositionService read-only plan preparation', () => {
  it('builds and dry-runs a plan without sealing or writing a plan artifact', async () => {
    const compared = await compareResult();
    const selectedUnitId = compared.comparison.units.find((unit) => unit.candidateId === 'cand-a')!.unitId;
    const identity: CompositionArtifactIdentity = {
      path: 'unused-plan.json',
      bytes: 1,
      sha256: 'a'.repeat(64),
    };
    const writePlan = vi.fn(async () => identity);
    const store = { writePlan } as unknown as NodeCompositionStore;
    const service = new CompositionService(store, PROJECT, 'unused-project-root', hasher);
    vi.spyOn(service, 'compare').mockResolvedValue(compared);
    vi.spyOn(service, 'dryRun').mockResolvedValue({
      status: 'passed',
      finalObjectFingerprints: { 'scene:a': 'result-a' },
      errors: [],
    });

    const prepared = await service.preparePlan({
      candidateRefs: compared.candidates.map((item) => item.ref),
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds: [selectedUnitId],
      conflictResolutions: [],
      review: { reviewState: 'unreviewed' },
      now: '1970-01-01T00:00:00.000Z',
    });

    expect(prepared.draft.selectedUnitIds).toEqual([selectedUnitId]);
    expect(prepared.dryRun.status).toBe('passed');
    expect(writePlan).not.toHaveBeenCalled();
  });

  it('keeps the existing formal plan path as the only writer', async () => {
    const compared = await compareResult();
    const selectedUnitId = compared.comparison.units.find((unit) => unit.candidateId === 'cand-a')!.unitId;
    const identity: CompositionArtifactIdentity = {
      path: 'sealed-plan.json',
      bytes: 123,
      sha256: 'b'.repeat(64),
    };
    const writePlan = vi.fn(async () => identity);
    const store = { writePlan } as unknown as NodeCompositionStore;
    const service = new CompositionService(store, PROJECT, 'unused-project-root', hasher);
    vi.spyOn(service, 'compare').mockResolvedValue(compared);
    vi.spyOn(service, 'dryRun').mockResolvedValue({
      status: 'passed',
      finalObjectFingerprints: { 'scene:a': 'result-a' },
      errors: [],
    });

    const result = await service.plan({
      candidateRefs: compared.candidates.map((item) => item.ref),
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds: [selectedUnitId],
      conflictResolutions: [],
      review: { reviewState: 'unreviewed' },
      now: '2026-09-11T12:00:00.000Z',
    });

    expect(writePlan).toHaveBeenCalledTimes(1);
    expect(writePlan).toHaveBeenCalledWith(result.plan);
    expect(result.identity).toEqual(identity);
  });
});
