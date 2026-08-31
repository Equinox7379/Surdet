import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approvalFingerprintOf,
  decisionFingerprintOf,
  returnFingerprintOf,
  type ComparisonDecisionReceipt,
  type FinalApprovalReceipt,
  type HumanReviewProjection,
  type ReturnRequestReceipt,
  type ReviewTerminalCommand,
  type TextHasher,
} from '@surdet/authoring';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { ReviewTerminalAuthority } from '../src/authoring/review-terminal-authority.js';

const temporaryRoots: string[] = [];
const projectIdentity = '0123456789abcdef0123456789abcdef';
const hasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

interface Fixture {
  root: string;
  projectDirectory: string;
  store: NodeReviewStore;
  authority: ReviewTerminalAuthority;
}

async function setup(): Promise<Fixture> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-authority-'));
  temporaryRoots.push(root);
  const projectDirectory = path.join(root, projectIdentity);
  await fsp.mkdir(projectDirectory);
  return {
    root,
    projectDirectory,
    store: new NodeReviewStore(projectDirectory, projectIdentity),
    authority: new ReviewTerminalAuthority(root, undefined, hasher),
  };
}

function commonProjection(reviewId: string) {
  return {
    reviewVersion: '1.0.0',
    reviewId,
    projectIdentity,
    expectedProjectRevision: 'project-revision-1',
    task: {
      title: '人工审阅',
      acceptanceCriteria: [],
      candidateCount: 0,
      objectCount: 0,
      conflictCount: 0,
      statementSource: 'generated-fallback',
    },
    candidates: [],
    safeGroups: [],
    conflicts: [],
    dependencies: [],
    defaultSelectedUnitIds: [],
    evidence: {
      candidateMatrix: [],
      blockingCount: 0,
      selectionRequiredCount: 0,
      advisoryCount: 0,
      canCreateDecision: true,
    },
    objects: [],
    reviewFingerprint: 'review-fingerprint',
  };
}

function comparisonProjection(reviewId: string): HumanReviewProjection {
  return {
    ...commonProjection(reviewId),
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    sourceIdentity: {
      projectIdentity,
      expectedProjectRevision: 'project-revision-1',
      comparisonFingerprint: 'comparison-fingerprint',
    },
  } as unknown as HumanReviewProjection;
}

function resultProjection(reviewId: string, state: 'STAGE_READY' | 'PLAN_PREPARED' = 'STAGE_READY'): HumanReviewProjection {
  const evidence = {
    diffEvidenceId: 'diff-evidence',
    validationEvidenceId: 'validation-evidence',
    simulationEvidenceId: 'simulation-evidence',
    runtimeTraceIds: ['trace-1'],
  };
  return {
    ...commonProjection(reviewId),
    kind: 'integration-result',
    state,
    sourceIdentity: {
      projectIdentity,
      expectedProjectRevision: 'project-revision-1',
      comparisonFingerprint: 'comparison-fingerprint',
      planFingerprint: 'plan-fingerprint',
      integrationChangeId: 'chg-integration',
      workingRevision: 3,
      decisionReviewId: 'review-comparison',
      decisionId: 'decision-1',
      decisionFingerprint: 'decision-fingerprint',
    },
    finalResult: {
      planId: 'plan-1',
      planFingerprint: 'plan-fingerprint',
      integrationChangeId: 'chg-integration',
      workingRevision: 3,
      diffFingerprint: 'diff-fingerprint',
      changedObjects: [],
      evidence,
      plan: {},
      diff: {},
      freshness: {},
      runtimeTraceObservations: [],
      resultTreeSha256: 'f'.repeat(64),
      warnings: [],
    },
  } as unknown as HumanReviewProjection;
}

async function decision(reviewId: string, decisionId = 'decision-1'): Promise<ComparisonDecisionReceipt> {
  const unsigned: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'> = {
    receiptVersion: '1.0.0',
    decisionId,
    reviewId,
    comparisonFingerprint: 'comparison-fingerprint',
    projectIdentity,
    expectedProjectRevision: 'project-revision-1',
    candidateRefs: [],
    selectedUnitIds: [],
    conflictResolutions: [],
    reviewerChannel: 'surdet-editor-local',
    decidedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...unsigned, decisionFingerprint: await decisionFingerprintOf(unsigned, hasher) };
}

async function approval(reviewId: string): Promise<FinalApprovalReceipt> {
  const projection = resultProjection(reviewId);
  const finalResult = projection.finalResult!;
  const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
    receiptVersion: '1.0.0',
    approvalId: `approval-${reviewId}`,
    resultReviewId: reviewId,
    decisionFingerprint: 'decision-fingerprint',
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    projectIdentity,
    expectedProjectRevision: 'project-revision-1',
    diffFingerprint: finalResult.diffFingerprint,
    evidence: finalResult.evidence,
    resultTreeSha256: finalResult.resultTreeSha256,
    reviewerChannel: 'surdet-editor-local',
    approvedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...unsigned, approvalFingerprint: await approvalFingerprintOf(unsigned, hasher) };
}

async function returned(reviewId: string): Promise<ReturnRequestReceipt> {
  const unsigned: Omit<ReturnRequestReceipt, 'returnFingerprint'> = {
    receiptVersion: '1.0.0',
    returnId: `return-${reviewId}`,
    resultReviewId: reviewId,
    planId: 'plan-1',
    planFingerprint: 'plan-fingerprint',
    integrationChangeId: 'chg-integration',
    workingRevision: 3,
    reasonCategory: 'content',
    reviewerChannel: 'surdet-editor-local',
    returnedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...unsigned, returnFingerprint: await returnFingerprintOf(unsigned, hasher) };
}

async function createFixture(
  fixture: Fixture,
  projection: HumanReviewProjection,
): Promise<{ projectIdentity: string; reviewId: string; reviewPayload: { bytes: number; sha256: string } }> {
  const identity = await fixture.store.createReview(projection.reviewId, projection);
  return {
    projectIdentity,
    reviewId: projection.reviewId,
    reviewPayload: { bytes: identity.payload.bytes, sha256: identity.payload.sha256 },
  };
}

function command(
  identity: { projectIdentity: string; reviewId: string; reviewPayload: { bytes: number; sha256: string } },
  action: ReviewTerminalCommand['action'],
  receipt: unknown,
): ReviewTerminalCommand {
  return {
    protocolVersion: '1.0.0',
    requestId: crypto.randomUUID(),
    ...identity,
    action,
    receipt,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('ReviewTerminalAuthority', () => {
  it('describes open comparison evidence and writes a validated decision without changing immutable evidence', async () => {
    const fixture = await setup();
    const identity = await createFixture(fixture, comparisonProjection('review-comparison'));
    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', identity.reviewId);
    const identityBefore = await fsp.readFile(path.join(reviewDirectory, 'identity.json'));
    const payloadBefore = await fsp.readFile(path.join(reviewDirectory, 'comparison', 'review.json'));

    await expect(fixture.authority.describe(identity)).resolves.toMatchObject({ state: 'open' });
    const receipt = await decision(identity.reviewId);
    const after = await fixture.authority.write(command(identity, 'comparison-decision', receipt));
    expect(after).toMatchObject({
      state: 'decision-written',
      record: { action: 'comparison-decision', file: 'decision.json', receipt },
    });
    await expect(fsp.readFile(path.join(reviewDirectory, 'identity.json'))).resolves.toEqual(identityBefore);
    await expect(fsp.readFile(path.join(reviewDirectory, 'comparison', 'review.json'))).resolves.toEqual(payloadBefore);
  });

  it('writes validated approval and return receipts for separate result reviews', async () => {
    const fixture = await setup();
    const approvalIdentity = await createFixture(fixture, resultProjection('review-result-approval'));
    const returnIdentity = await createFixture(fixture, resultProjection('review-result-return'));

    await expect(fixture.authority.write(command(
      approvalIdentity,
      'result-approval',
      await approval(approvalIdentity.reviewId),
    ))).resolves.toMatchObject({ state: 'approval-written' });
    await expect(fixture.authority.write(command(
      returnIdentity,
      'result-return',
      await returned(returnIdentity.reviewId),
    ))).resolves.toMatchObject({ state: 'returned' });
  });

  it('rejects path-like, project, review, and payload identity mismatches before writing', async () => {
    const fixture = await setup();
    const identity = await createFixture(fixture, comparisonProjection('review-identity'));
    await expect(fixture.authority.describe({ ...identity, projectIdentity: '../escape' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fixture.authority.describe({ ...identity, reviewId: '../escape' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fixture.authority.describe({
      ...identity,
      reviewPayload: { ...identity.reviewPayload, sha256: '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
    await expect(fixture.authority.describe({ ...identity, reviewPath: 'C:/secret' } as never))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fsp.access(path.join(fixture.projectDirectory, 'reviews', identity.reviewId, 'decision.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed receipts, invalid fingerprints, invalid return categories, and non-ready results', async () => {
    const fixture = await setup();
    const comparisonIdentity = await createFixture(fixture, comparisonProjection('review-invalid-decision'));
    await expect(fixture.authority.write(command(
      comparisonIdentity,
      'comparison-decision',
      { receiptVersion: '1.0.0' },
    ))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const invalidDecision = { ...await decision(comparisonIdentity.reviewId), decisionFingerprint: '0'.repeat(64) };
    await expect(fixture.authority.write(command(comparisonIdentity, 'comparison-decision', invalidDecision)))
      .rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });

    const returnIdentity = await createFixture(fixture, resultProjection('review-invalid-return'));
    const invalidReturn = { ...await returned(returnIdentity.reviewId), reasonCategory: 'anything' };
    await expect(fixture.authority.write(command(returnIdentity, 'result-return', invalidReturn)))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const notReadyIdentity = await createFixture(fixture, resultProjection('review-not-ready', 'PLAN_PREPARED'));
    await expect(fixture.authority.write(command(
      notReadyIdentity,
      'result-approval',
      await approval(notReadyIdentity.reviewId),
    ))).rejects.toMatchObject({ code: 'REVIEW_RESULT_NOT_READY' });
  });

  it('is idempotent for identical bytes, rejects a different terminal, and reports both-file corruption', async () => {
    const fixture = await setup();
    const comparisonIdentity = await createFixture(fixture, comparisonProjection('review-terminal-once'));
    const firstReceipt = await decision(comparisonIdentity.reviewId, 'decision-first');
    const first = await fixture.authority.write(command(comparisonIdentity, 'comparison-decision', firstReceipt));
    const retry = await fixture.authority.write(command(comparisonIdentity, 'comparison-decision', firstReceipt));
    expect(retry.record).toEqual(first.record);
    await expect(fixture.authority.write(command(
      comparisonIdentity,
      'comparison-decision',
      await decision(comparisonIdentity.reviewId, 'decision-second'),
    ))).rejects.toMatchObject({ code: 'REVIEW_TERMINAL_ALREADY_SET' });

    const resultIdentity = await createFixture(fixture, resultProjection('review-corrupt-terminal'));
    await fixture.authority.write(command(resultIdentity, 'result-approval', await approval(resultIdentity.reviewId)));
    await fsp.writeFile(
      path.join(fixture.projectDirectory, 'reviews', resultIdentity.reviewId, 'return-request.json'),
      `${JSON.stringify(await returned(resultIdentity.reviewId), null, 2)}\n`,
      'utf8',
    );
    await expect(fixture.authority.describe(resultIdentity)).resolves.toMatchObject({ state: 'corrupt' });
  });
});
