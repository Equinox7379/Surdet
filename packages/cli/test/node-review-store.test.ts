import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';

const temporaryRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workerPath = path.join(repoRoot, 'packages/cli/test/fixtures/review-terminal-worker.mjs');

interface WorkerResult {
  status: 'written' | 'rejected';
  identity?: { bytes: number; sha256: string; path: string };
  code?: string;
  message?: string;
}

interface WorkerCommand {
  dataRoot: string;
  projectIdentity: string;
  reviewId: string;
  action: 'decision' | 'approval' | 'return';
  receipt: Record<string, unknown>;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function runWorker(command: WorkerCommand): Promise<WorkerResult> {
  const child = spawn(process.execPath, [workerPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.stdin.end(JSON.stringify(command));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('review terminal worker timed out and was reaped'));
      else resolve(code);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  if (exitCode !== 0) throw new Error(`worker exit=${exitCode} stdout=${stdout} stderr=${stderr}`);
  if (stderr.length > 0) throw new Error(`worker wrote stderr: ${stderr}`);
  return JSON.parse(stdout) as WorkerResult;
}

async function activeReviewLocks(dataRoot: string): Promise<string[]> {
  const directory = path.join(dataRoot, '.locks', 'reviews');
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.lock')).map((entry) => entry.name);
}

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
    expect(['REVIEW_BUSY', 'REVIEW_TERMINAL_ALREADY_SET']).toContain(rejected[0]?.reason?.code);

    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', reviewId);
    const terminalReceipts = (await fsp.readdir(reviewDirectory))
      .filter((name) => name === 'final-approval.json' || name === 'return-request.json');
    expect(terminalReceipts).toHaveLength(1);
  });

  it('serializes approval versus return across independent Node processes', { timeout: 60_000 }, async () => {
    const fixture = await setup();
    const reviewId = 'rev_result_process_race';
    await fixture.store.createReview(reviewId, { ...payload(reviewId), kind: 'integration-result' });
    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', reviewId);
    const identityBefore = await fsp.readFile(path.join(reviewDirectory, 'identity.json'));
    const payloadBefore = await fsp.readFile(path.join(reviewDirectory, 'result', 'review.json'));
    const base = { dataRoot: fixture.root, projectIdentity: 'project-identity', reviewId };

    const commands: WorkerCommand[] = [
      { ...base, action: 'approval', receipt: { approvalId: 'approval-process-race' } },
      { ...base, action: 'return', receipt: { returnId: 'return-process-race' } },
    ];
    const results = await Promise.all(commands.map(runWorker));
    expect(results.map((result) => result.status).sort()).toEqual(['rejected', 'written']);
    const loserIndex = results.findIndex((result) => result.status === 'rejected');
    expect(['REVIEW_BUSY', 'REVIEW_TERMINAL_ALREADY_SET'])
      .toContain(results[loserIndex]?.code);
    await expect(runWorker(commands[loserIndex]!)).resolves.toMatchObject({
      status: 'rejected',
      code: 'REVIEW_TERMINAL_ALREADY_SET',
    });
    const receiptNames = (await fsp.readdir(reviewDirectory))
      .filter((name) => name === 'final-approval.json' || name === 'return-request.json');
    expect(receiptNames).toHaveLength(1);
    await expect(fsp.readFile(path.join(reviewDirectory, 'identity.json'))).resolves.toEqual(identityBefore);
    await expect(fsp.readFile(path.join(reviewDirectory, 'result', 'review.json'))).resolves.toEqual(payloadBefore);
    expect(await activeReviewLocks(fixture.root)).toEqual([]);
  });

  it('keeps one of two different decisions and returns the exact winning bytes', { timeout: 60_000 }, async () => {
    const fixture = await setup();
    const reviewId = 'rev_decision_process_race';
    await fixture.store.createReview(reviewId, payload(reviewId));
    const base = { dataRoot: fixture.root, projectIdentity: 'project-identity', reviewId };
    const receipts = [
      { decisionId: 'decision-a', chosenUnitId: 'unit-a' },
      { decisionId: 'decision-b', chosenUnitId: 'unit-b' },
    ];

    const commands: WorkerCommand[] = receipts.map((receipt) => ({
      ...base,
      action: 'decision',
      receipt,
    }));
    const results = await Promise.all(commands.map(runWorker));
    expect(results.map((result) => result.status).sort()).toEqual(['rejected', 'written']);
    const loserIndex = results.findIndex((result) => result.status === 'rejected');
    expect(['REVIEW_BUSY', 'REVIEW_TERMINAL_ALREADY_SET'])
      .toContain(results[loserIndex]?.code);
    await expect(runWorker(commands[loserIndex]!)).resolves.toMatchObject({
      status: 'rejected',
      code: 'REVIEW_TERMINAL_ALREADY_SET',
    });
    const bytes = await fsp.readFile(path.join(fixture.projectDirectory, 'reviews', reviewId, 'decision.json'));
    const written = results.find((result) => result.status === 'written');
    expect(written?.identity).toMatchObject({ bytes: bytes.byteLength, sha256: sha256(bytes) });
    expect(receipts).toContainEqual(JSON.parse(bytes.toString('utf8')));
    expect(await activeReviewLocks(fixture.root)).toEqual([]);
  });

  it('makes identical cross-process retries idempotent with one byte identity', { timeout: 60_000 }, async () => {
    const fixture = await setup();
    const reviewId = 'rev_approval_process_retry';
    await fixture.store.createReview(reviewId, { ...payload(reviewId), kind: 'integration-result' });
    const command: WorkerCommand = {
      dataRoot: fixture.root,
      projectIdentity: 'project-identity',
      reviewId,
      action: 'approval',
      receipt: { approvalId: 'approval-idempotent' },
    };

    const results = await Promise.all([runWorker(command), runWorker(command)]);
    const written = results.filter((result) => result.status === 'written');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(written.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBeLessThanOrEqual(1);
    for (const loser of rejected) expect(loser.code).toBe('REVIEW_BUSY');
    const winningIdentity = written[0]?.identity;
    expect(winningIdentity).toBeDefined();
    for (const result of written) expect(result.identity).toEqual(winningIdentity);
    const retry = await runWorker(command);
    expect(retry.status).toBe('written');
    expect(retry.identity).toEqual(winningIdentity);
    const bytes = await fsp.readFile(path.join(fixture.projectDirectory, 'reviews', reviewId, 'final-approval.json'));
    expect(retry.identity).toMatchObject({ bytes: bytes.byteLength, sha256: sha256(bytes) });
    expect(bytes.toString('utf8')).toBe(`${JSON.stringify(command.receipt, null, 2)}\n`);
    expect(await activeReviewLocks(fixture.root)).toEqual([]);
  });

  it('routes terminal writes through the shared review lease across processes', { timeout: 60_000 }, async () => {
    const fixture = await setup();
    const reviewId = 'rev_existing_process_lease';
    await fixture.store.createReview(reviewId, { ...payload(reviewId), kind: 'integration-result' });
    const leases = new NodeLocalLeaseManager(fixture.root);
    const held = await leases.acquire({
      scope: 'review',
      resourceId: `project-identity\u0000${reviewId}`,
    });
    const command: WorkerCommand = {
      dataRoot: fixture.root,
      projectIdentity: 'project-identity',
      reviewId,
      action: 'approval',
      receipt: { approvalId: 'approval-blocked-by-lease' },
    };

    try {
      const results = await Promise.all([runWorker(command), runWorker(command)]);
      expect(results).toEqual([
        expect.objectContaining({ status: 'rejected', code: 'REVIEW_BUSY' }),
        expect.objectContaining({ status: 'rejected', code: 'REVIEW_BUSY' }),
      ]);
      await expect(fsp.access(path.join(
        fixture.projectDirectory,
        'reviews',
        reviewId,
        'final-approval.json',
      ))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await held.release();
    }
    expect(await activeReviewLocks(fixture.root)).toEqual([]);
  });

  it('runs authority validation inside the same review lease used for terminal creation', async () => {
    const fixture = await setup();
    const leases = new NodeLocalLeaseManager(fixture.root);
    const store = new NodeReviewStore(fixture.projectDirectory, 'project-identity', leases);
    const reviewId = 'rev_validator_under_lease';
    await store.createReview(reviewId, payload(reviewId));
    let observedBusy = false;

    await store.writeTerminal(reviewId, 'comparison-decision', { decisionId: 'decision-under-lease' }, async (loaded) => {
      expect(loaded.identity.reviewId).toBe(reviewId);
      await expect(leases.acquire({
        scope: 'review',
        resourceId: `project-identity\u0000${reviewId}`,
      })).rejects.toMatchObject({ code: 'REVIEW_BUSY' });
      observedBusy = true;
    });

    expect(observedBusy).toBe(true);
    await expect(store.readDecision(reviewId)).resolves.toMatchObject({
      value: { decisionId: 'decision-under-lease' },
    });
    expect(await activeReviewLocks(fixture.root)).toEqual([]);
  });

  it('rejects a runtime-unknown terminal action instead of treating it as a return', async () => {
    const fixture = await setup();
    const reviewId = 'rev_unknown_action';
    await fixture.store.createReview(reviewId, { ...payload(reviewId), kind: 'integration-result' });
    await expect(fixture.store.writeTerminal(
      reviewId,
      'unexpected-action' as never,
      { returnId: 'must-not-write' },
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const reviewDirectory = path.join(fixture.projectDirectory, 'reviews', reviewId);
    expect((await fsp.readdir(reviewDirectory)).filter((name) => name.endsWith('.json')).sort())
      .toEqual(['identity.json']);
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
