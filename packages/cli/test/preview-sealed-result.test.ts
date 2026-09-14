import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decisionFingerprintV2Of,
  type ComparisonDecisionReceiptV2,
  type PreviewContentTarget,
} from '@surdet/authoring';
import { PreviewContentService } from '../src/authoring/preview-content-service.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { compositionServiceForProject } from '../src/authoring/composition-service.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../src/authoring/project-identity.js';
import { ReviewTerminalAuthority } from '../src/authoring/review-terminal-authority.js';
import { createReviewComparisonFixture } from './helpers/review-apply-fixture.js';

const hasher = {
  sha256: async (text: string) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['SURDET_AGENT_DATA_DIR'];
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function prepareHumanReviewedIntegration(root: string) {
  const fixture = await createReviewComparisonFixture(
    root,
    'start',
    Uint8Array.from([0x73, 0x65, 0x61, 0x6c, 0x65, 0x64, 0x2d, 0x62, 0x67]),
  );
  const projection = fixture.comparison.projection;
  const candidates = projection.candidates;
  if (candidates.length < 2) throw new Error('fixture must contain two candidates');
  const firstCandidate = candidates[0]!;
  const resolutions = projection.conflicts
    .filter((conflict) => conflict.severity === 'selection-required')
    .map((conflict) => {
      const chosenUnitId = conflict.options.find((option) => option.candidateId === firstCandidate.candidateId)?.unitId;
      if (chosenUnitId === undefined) throw new Error(`fixture conflict has no unit for ${firstCandidate.candidateId}`);
      return { conflictId: conflict.conflictId, resolution: 'choose-unit' as const, chosenUnitId };
    });
  const selectedUnitIds = candidates.flatMap((candidate) => (
    'adoptionPreset' in candidate ? candidate.adoptionPreset.selectedUnitIds : []
  ));
  if (selectedUnitIds.length === 0) throw new Error('fixture candidates have no selectable units');
  const command = {
    projectIdentity: projection.projectIdentity,
    reviewId: fixture.comparison.reviewId,
    reviewPayload: {
      bytes: fixture.comparison.identity.payload.bytes,
      sha256: fixture.comparison.identity.payload.sha256,
    },
  };
  const authority = new ReviewTerminalAuthority(fixture.dataRoot, undefined, hasher, fixture.projectRoot);
  const preview = await authority.previewDecision({
    ...command,
    decisionIntent: { mode: 'custom-mix' },
    customSelection: { selectedUnitIds, conflictResolutions: resolutions },
  });
  expect(preview.status).toBe('ready');

  const decision: ComparisonDecisionReceiptV2 = {
    receiptVersion: '2.0.0',
    decisionId: 'preview-sealed-result-decision',
    reviewId: fixture.comparison.reviewId,
    reviewFingerprint: projection.reviewFingerprint,
    comparisonFingerprint: projection.sourceIdentity.comparisonFingerprint,
    projectIdentity: projection.projectIdentity,
    expectedProjectRevision: projection.expectedProjectRevision,
    candidateRefs: fixture.refs,
    decisionIntent: preview.decisionIntent,
    selectedUnitIds: preview.selectedUnitIds,
    conflictResolutions: preview.conflictResolutions,
    planContentFingerprint: preview.planContentFingerprint,
    previewFingerprint: preview.previewFingerprint,
    reviewerChannel: 'surdet-editor-local',
    decidedAt: '2026-09-14T00:00:00.000Z',
    decisionFingerprint: '',
  };
  decision.decisionFingerprint = await decisionFingerprintV2Of(decision, hasher);
  await authority.write({
    ...command,
    protocolVersion: '1.0.0',
    requestId: decision.decisionId,
    action: 'comparison-decision',
    receipt: decision,
  });

  const verified = await fixture.reviews.inspectDecision({ reviewId: fixture.comparison.reviewId });
  const composition = await compositionServiceForProject(fixture.projectRoot, fixture.dataRoot);
  const planned = await composition.plan({
    candidateRefs: fixture.refs,
    comparisonFingerprint: decision.comparisonFingerprint,
    selectedUnitIds: verified.selectedUnitIds,
    conflictResolutions: verified.conflictResolutions,
    review: verified.review,
    expectedPlanContentFingerprint: decision.planContentFingerprint,
  });
  const executed = await composition.executePlan({
    planId: planned.plan.planId,
    artifactSha256: planned.identity.sha256,
    executeOperationId: 'preview-sealed-result-execute',
  });
  const authoring = new AuthoringService(undefined, new NodeLocalLeaseManager(fixture.dataRoot));
  await authoring.diff(executed.changeId);
  await authoring.validate(executed.changeId);
  await authoring.simulate(executed.changeId, {});
  await authoring.runFrom(executed.changeId, { sceneId: 'start', choices: [] });
  const prepared = await fixture.reviews.prepareResult({
    planId: planned.plan.planId,
    artifactSha256: planned.identity.sha256,
    changeId: executed.changeId,
  });
  const finalResult = prepared.projection.finalResult;
  if (finalResult === undefined || prepared.projectDirectory === undefined) {
    throw new Error('fixture did not create a result review directory');
  }
  const sourceStorage = await NodeProjectStorage.open(fixture.projectRoot);
  const projectIdentity = projectIdentityFromRoot(sourceStorage.rootIdentity);
  const reviews = new NodeReviewStore(path.join(fixture.dataRoot, projectIdentity), projectIdentity);
  return {
    ...fixture,
    prepared,
    target: {
      kind: 'integration-result',
      changeId: finalResult.integrationChangeId,
      planId: finalResult.planId,
      planFingerprint: finalResult.planFingerprint,
      workingRevision: finalResult.workingRevision,
    } satisfies PreviewContentTarget,
    reviewStore: reviews,
  };
}

describe('PreviewContentService sealed integration results', () => {
  it('reads both candidate contributions, rejects sealed/result or source drift, and never writes the source project', { timeout: 60_000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-preview-sealed-result-'));
    roots.push(root);
    const fixture = await prepareHumanReviewedIntegration(root);
    const sourceScene = path.join(fixture.projectRoot, 'content/scenario/start.gal');
    const sourceAsset = path.join(fixture.projectRoot, 'content/assets/bg/harbor.png');
    const initialScene = await fs.readFile(sourceScene);
    const initialAsset = await fs.readFile(sourceAsset);
    const commit = vi.spyOn(AuthoringService.prototype, 'commit');
    const service = new PreviewContentService(fixture.dataRoot);

    expect(await fixture.reviewStore.readFinalApproval(fixture.prepared.reviewId)).toBeNull();
    const resolved = await service.resolve(fixture.projectRoot, fixture.target);
    expect(resolved.content.files['content/scenario/ending_a.gal']).toContain('非正式试写样例');
    expect(resolved.content.files['content/scenario/ending_b.gal']).toContain('非正式试写样例');
    expect(Object.keys(resolved.content.files)).toEqual(expect.arrayContaining([
      'content/scenario/ending_a.gal',
      'content/scenario/ending_b.gal',
    ]));

    const resultScene = path.join(fixture.prepared.projectDirectory!, 'content/scenario/start.gal');
    const resultSceneBytes = await fs.readFile(resultScene);
    await fs.appendFile(resultScene, '\n正式结果树篡改。\n', 'utf8');
    await expect(service.resolve(fixture.projectRoot, fixture.target))
      .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
    await fs.writeFile(resultScene, resultSceneBytes);

    await fs.writeFile(sourceAsset, Buffer.concat([initialAsset, Buffer.from('-changed')]));
    await expect(service.resolve(fixture.projectRoot, fixture.target))
      .rejects.toMatchObject({ code: 'PREVIEW_CONTENT_BASE_CHANGED' });
    await fs.writeFile(sourceAsset, initialAsset);

    const restored = await service.resolve(fixture.projectRoot, fixture.target);
    expect(restored.content.files['content/scenario/ending_a.gal']).toContain('非正式试写样例');
    expect(restored.content.files['content/scenario/ending_b.gal']).toContain('非正式试写样例');
    expect(await fs.readFile(sourceScene)).toEqual(initialScene);
    expect(await fs.readFile(sourceAsset)).toEqual(initialAsset);
    expect(commit).not.toHaveBeenCalled();
  });
});
