import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  approvalFingerprintOf,
  type ChangeRecord,
  type CompositionComparison,
  type FinalApprovalReceipt,
  type IntegrationPlan,
  type TextHasher,
} from '@surdet/authoring';
import { compositionServiceForProject } from '../src/authoring/composition-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { hashProjectTree, ReviewService } from '../src/authoring/review-service.js';

const temporaryRoots: string[] = [];
const hasher: TextHasher = {
  sha256: async (text) => text,
};

const realHasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

function comparison(projectIdentity: string, revision: string): CompositionComparison {
  return {
    comparisonVersion: '1.0.0',
    projectIdentity,
    expectedProjectRevision: revision,
    status: 'composable',
    candidates: [],
    units: [],
    dependencyEdges: [],
    conflicts: [],
    identicalGroups: [],
    evidenceMatrix: [],
    comparisonFingerprint: 'comparison-fingerprint',
  };
}

async function setup(): Promise<{ root: string; projectRoot: string; projectDirectory: string; service: ReviewService }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-service-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  await fsp.mkdir(projectRoot);
  await fsp.mkdir(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
  await fsp.writeFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  const projectIdentity = 'project-identity';
  const projectDirectory = path.join(dataRoot, projectIdentity);
  await fsp.mkdir(projectDirectory, { recursive: true });
  const reviews = new NodeReviewStore(projectDirectory, projectIdentity);
  const composition = {
    projectRoot,
    projectIdentity,
    compare: async () => ({ comparison: comparison(projectIdentity, 'revision-1'), candidates: [], currentProjectRevision: 'revision-1' }),
  } as never;
  return { root, projectRoot, projectDirectory, service: new ReviewService(reviews, composition, hasher) };
}

afterEach(() => {
  delete process.env['SURDET_AGENT_DATA_DIR'];
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('ReviewService', () => {
  it('creates a comparison workspace from a fresh comparison and keeps decision writes human-gated', async () => {
    const fixture = await setup();
    const prepared = await fixture.service.prepareComparison({ candidateRefs: [] });
    expect(prepared.projection.kind).toBe('comparison');
    expect(prepared.projection.projectIdentity).toBe('project-identity');
    expect(await fsp.readFile(path.join(fixture.projectDirectory, 'reviews', prepared.reviewId, 'comparison', 'review.json'), 'utf8'))
      .toContain('comparison-fingerprint');
    await expect(fixture.service.inspectDecision({ reviewId: prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_DECISION_REQUIRED' });
  });

  it('materializes the READY working tree without mutating the original project and rechecks approval freshness', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-result-'));
    temporaryRoots.push(root);
    const projectRoot = path.join(root, 'project');
    const dataRoot = path.join(root, 'data');
    await fsp.mkdir(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
    await fsp.writeFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
    await fsp.writeFile(path.join(projectRoot, 'content', 'scenario', 'remove.gal'), '@scene remove\n@end\n', 'utf8');
    process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;

    const composition = await compositionServiceForProject(projectRoot);
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await composition.currentSnapshot();
    const baseContents = Object.fromEntries(snapshot.files.map((file) => [file.path, file.text]));
    const baseFiles = Object.fromEntries(snapshot.files.map((file) => [file.path, { sha256: file.sha256 }]));
    const workingFiles = { ...baseContents };
    delete workingFiles['content/scenario/remove.gal'];
    workingFiles['content/scenario/wave6_alpha.gal'] = '@scene wave6_alpha\n凛：结果。\n@end\n';
    const binding = {
      reviewState: 'human-reviewed' as const,
      reviewId: 'decision-review',
      decisionId: 'decision-result',
      decisionFingerprint: 'decision-fingerprint',
    };
    const plan: IntegrationPlan = {
      planVersion: '1.0.0',
      planId: 'plan_result',
      projectIdentity: composition.projectIdentity,
      expectedProjectRevision: snapshot.revision,
      comparisonFingerprint: 'comparison-fingerprint',
      review: binding,
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
    };
    const planIdentity = await composition.store.writePlan(plan);
    const changeId = 'change_result';
    const record: ChangeRecord = {
      changeId,
      formatVersion: 2,
      recordVersion: 0,
      projectRootIdentity: storage.rootIdentity,
      baseRevision: snapshot.revision,
      workingRevision: 1,
      status: 'OPEN',
      baseFiles,
      baseContents,
      workingFiles,
      operations: {},
      integration: {
        planId: plan.planId,
        planFingerprint: plan.planFingerprint,
        executeOperationId: 'execute-result',
        sourceCapsules: [],
        includedUnitIds: [],
        deduplicatedUnits: [],
        conflictResolutions: [],
        status: 'READY',
        nextOperationIndex: 0,
        replayedOperations: [],
        review: { binding },
      },
      latestDiff: { workingRevision: 1, evidenceId: 'diff-evidence' },
      latestValidation: { workingRevision: 1, evidenceId: 'validation-evidence', errors: 0 },
      latestSimulation: { workingRevision: 1, evidenceId: 'simulation-evidence', status: 'passed' },
      runtimeTraces: [{ traceId: 'runtime-trace', workingRevision: 1, status: 'passed' }],
    };
    const changeStore = await NodeChangeStore.forProject(storage.rootIdentity);
    await changeStore.create(record);
    await NodeChangeStore.withChangeLeaseForProject(changeId, storage.rootIdentity, async (leased) => {
      await leased.writeDiff(changeId, { changedFiles: ['content/scenario/wave6_alpha.gal'] });
    });

    const reviews = new NodeReviewStore(composition.store.projectDirectory, composition.projectIdentity);
    const service = new ReviewService(reviews, composition, realHasher);
    const originalBefore = await hashProjectTree(projectRoot);
    const prepared = await service.prepareResult({
      planId: plan.planId,
      artifactSha256: planIdentity.sha256,
      changeId,
    });
    expect(prepared.projectDirectory).toBeDefined();
    expect(prepared.projection.finalResult?.resultTreeSha256).toBe(await hashProjectTree(prepared.projectDirectory!));
    expect(await fsp.readFile(path.join(prepared.projectDirectory!, 'content', 'scenario', 'wave6_alpha.gal'), 'utf8'))
      .toBe(workingFiles['content/scenario/wave6_alpha.gal']);
    await expect(fsp.access(path.join(prepared.projectDirectory!, 'content', 'scenario', 'remove.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await hashProjectTree(projectRoot)).toBe(originalBefore);
    await expect(fsp.access(path.join(projectRoot, 'content', 'scenario', 'remove.gal'))).resolves.toBeUndefined();
    await expect(service.inspectApproval({ resultReviewId: prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_REQUIRED' });

    const finalResult = prepared.projection.finalResult!;
    const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
      receiptVersion: '1.0.0',
      approvalId: 'approval-result',
      resultReviewId: prepared.reviewId,
      decisionFingerprint: prepared.projection.sourceIdentity.decisionFingerprint!,
      planId: finalResult.planId,
      planFingerprint: finalResult.planFingerprint,
      integrationChangeId: finalResult.integrationChangeId,
      workingRevision: finalResult.workingRevision,
      projectIdentity: prepared.projection.projectIdentity,
      expectedProjectRevision: prepared.projection.expectedProjectRevision,
      diffFingerprint: finalResult.diffFingerprint,
      evidence: finalResult.evidence,
      resultTreeSha256: finalResult.resultTreeSha256,
      reviewerChannel: 'surdet-editor-local',
      approvedAt: '2026-08-27T00:00:00.000Z',
    };
    const approval: FinalApprovalReceipt = {
      ...unsigned,
      approvalFingerprint: await approvalFingerprintOf(unsigned, realHasher),
    };
    await reviews.createFinalApproval(prepared.reviewId, approval);
    const verified = await service.inspectApproval({ resultReviewId: prepared.reviewId, approvalId: approval.approvalId });
    if (!('approvalId' in verified.receipt) || verified.receipt.approvalId !== 'approval-result') {
      throw new Error('inspectApproval did not return the verified approval');
    }
    expect(verified.receipt.approvalId).toBe('approval-result');

    await fsp.writeFile(path.join(prepared.projectDirectory!, 'content', 'scenario', 'wave6_alpha.gal'), 'tampered\n', 'utf8');
    await expect(service.inspectApproval({ resultReviewId: prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
  });
});
