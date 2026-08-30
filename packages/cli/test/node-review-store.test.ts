import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';

const temporaryRoots: string[] = [];

function payload(reviewId = 'rev_safe') {
  return {
    reviewVersion: '1.0.0',
    reviewId,
    kind: 'comparison',
    projectIdentity: 'project-identity',
    expectedProjectRevision: 'revision-1',
    comparisonFingerprint: 'comparison-fingerprint',
    task: { title: 'Review', acceptanceCriteria: [], candidateCount: 0, objectCount: 0, conflictCount: 0, statementSource: 'generated-fallback' },
    candidates: [],
    safeGroups: [],
    conflicts: [],
    dependencies: [],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: false },
    objects: [],
    sourceIdentity: { projectIdentity: 'project-identity', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'comparison-fingerprint' },
    reviewFingerprint: 'review-fingerprint',
  };
}

async function setup(): Promise<{ root: string; projectDirectory: string; store: NodeReviewStore }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-store-'));
  temporaryRoots.push(root);
  const projectDirectory = path.join(root, 'project-identity');
  await fsp.mkdir(projectDirectory);
  return { root, projectDirectory, store: new NodeReviewStore(projectDirectory, 'project-identity') };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('NodeReviewStore', () => {
  it.each(['../escape', '..\\escape', 'a/b', 'a\\b', '', 'CON', 'name.'])('rejects unsafe review id %s', async (reviewId) => {
    const fixture = await setup();
    await expect(fixture.store.createReview(reviewId, payload(reviewId))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('is idempotent for the same bytes and rejects identity reuse', async () => {
    const fixture = await setup();
    const first = await fixture.store.createReview('rev_safe', payload());
    const second = await fixture.store.createReview('rev_safe', payload());
    expect(second).toEqual(first);
    await expect(fixture.store.createReview('rev_safe', { ...payload(), comparisonFingerprint: 'changed' }))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('serializes competing approval and return writes so only one terminal receipt reaches disk', async () => {
    const fixture = await setup();
    const reviewId = 'rev_result_race';
    await fixture.store.createReview(reviewId, {
      ...payload(reviewId),
      kind: 'integration-result',
    });

    const settled = await Promise.allSettled([
      fixture.store.createFinalApproval(reviewId, { approvalId: 'approval-race' }),
      fixture.store.createReturnRequest(reviewId, { returnId: 'return-race' }),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', reviewId);
    const terminalReceipts = (await fsp.readdir(reviewDirectory))
      .filter((name) => name === 'final-approval.json' || name === 'return-request.json');
    expect(terminalReceipts).toHaveLength(1);
  });

  it('revalidates the sidecar and payload bytes on read', async () => {
    const fixture = await setup();
    await fixture.store.createReview('rev_safe', payload());
    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', 'rev_safe');
    const identityPath = path.join(reviewDirectory, 'identity.json');
    const identity = JSON.parse(await fsp.readFile(identityPath, 'utf8')) as { payload: { relativePath: string } };
    identity.payload.relativePath = path.resolve(reviewDirectory, 'comparison', 'review.json');
    await fsp.writeFile(identityPath, JSON.stringify(identity), 'utf8');
    await expect(fixture.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('preserves corrupt payload evidence and rejects it', async () => {
    const fixture = await setup();
    await fixture.store.createReview('rev_safe', payload());
    await fsp.writeFile(path.join(fixture.projectDirectory, 'reviews', 'rev_safe', 'comparison', 'review.json'), '{broken\n', 'utf8');
    await expect(fixture.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
  });

  it('rejects missing identity or payload sidecars without repairing the workspace', async () => {
    const fixture = await setup();
    await fixture.store.createReview('rev_safe', payload());
    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', 'rev_safe');
    await fsp.rm(path.join(reviewDirectory, 'identity.json'));
    await expect(fixture.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
    expect(fs.existsSync(path.join(reviewDirectory, 'comparison', 'review.json'))).toBe(true);

    const second = await setup();
    await second.store.createReview('rev_safe', payload());
    await fsp.rm(path.join(second.projectDirectory, 'reviews', 'rev_safe', 'comparison', 'review.json'));
    await expect(second.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('recomputes payload bytes and SHA instead of trusting the identity sidecar', async () => {
    const fixture = await setup();
    await fixture.store.createReview('rev_safe', payload());
    const identityPath = path.join(fixture.projectDirectory, 'reviews', 'rev_safe', 'identity.json');
    const identity = JSON.parse(await fsp.readFile(identityPath, 'utf8')) as { payload: { bytes: number; sha256: string } };
    identity.payload.bytes += 1;
    await fsp.writeFile(identityPath, JSON.stringify(identity), 'utf8');
    await expect(fixture.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const second = await setup();
    await second.store.createReview('rev_safe', payload());
    const secondIdentityPath = path.join(second.projectDirectory, 'reviews', 'rev_safe', 'identity.json');
    const secondIdentity = JSON.parse(await fsp.readFile(secondIdentityPath, 'utf8')) as { payload: { bytes: number; sha256: string } };
    secondIdentity.payload.sha256 = '0'.repeat(64);
    await fsp.writeFile(secondIdentityPath, JSON.stringify(secondIdentity), 'utf8');
    await expect(second.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('rejects an identity sidecar from another project namespace and does not expose absolute paths', async () => {
    const fixture = await setup();
    const identity = await fixture.store.createReview('rev_safe', payload());
    expect(JSON.stringify(identity)).not.toContain(fixture.projectDirectory);
    const identityPath = path.join(fixture.projectDirectory, 'reviews', 'rev_safe', 'identity.json');
    const sidecar = JSON.parse(await fsp.readFile(identityPath, 'utf8')) as { projectIdentity: string };
    sidecar.projectIdentity = 'other-project-identity';
    await fsp.writeFile(identityPath, JSON.stringify(sidecar), 'utf8');
    await expect(fixture.store.readReview('rev_safe')).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
    expect(JSON.stringify(sidecar)).not.toContain(fixture.projectDirectory);
  });

  it('rejects a project namespace whose basename is not the expected identity', async () => {
    const fixture = await setup();
    expect(() => new NodeReviewStore(path.join(fixture.root, 'other-project'), 'project-identity'))
      .toThrowError(/projectIdentity/);
  });

  it('rejects a review root symlink instead of following it', async () => {
    const fixture = await setup();
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-store-outside-'));
    temporaryRoots.push(outside);
    const reviews = path.join(fixture.projectDirectory, 'reviews');
    try {
      await fsp.symlink(outside, reviews, 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES') return;
      throw error;
    }
    await expect(fixture.store.createReview('rev_safe', payload())).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
    expect(await fsp.readdir(outside)).toEqual([]);
  });
});
