/// <reference lib="dom" />
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { approvalFingerprintOf, decisionFingerprintV2Of, type ComparisonDecisionReceiptV2, type ReviewPreparationReference,
  type ReviewPreparationRecord, type FinalApprovalReceipt, type HumanReviewProjection } from '@surdet/authoring';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { ReviewPreparationService } from '../src/authoring/review-preparation-service.js';
import { ReviewTerminalAuthority } from '../src/authoring/review-terminal-authority.js';
import { CompositionService, compositionServiceForProject } from '../src/authoring/composition-service.js';
import { NodeCompositionStore } from '../src/authoring/node-composition-store.js';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { createReviewAuthorityHttpHandler } from '../src/review-authority/http-handler.js';
import { createReviewPreparationClient } from '../../editor/src/review-preparation-client.js';
import { ReviewPreparationController } from '../../editor/src/review-preparation-section.js';
import { createReviewComparisonFixture } from './helpers/review-apply-fixture.js';

const roots: string[] = [];
const hasher = { sha256: async (text: string) => crypto.createHash('sha256').update(text).digest('hex') };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-preparation-')); roots.push(root);
  const f = await createReviewComparisonFixture(root, 'arrival');
  const authority = new ReviewTerminalAuthority(f.dataRoot, undefined, hasher, f.projectRoot);
  const candidate = f.comparison.projection.candidates[0]!;
  const command = { projectIdentity: f.comparison.identity.projectIdentity, reviewId: f.comparison.reviewId,
    reviewPayload: { bytes: f.comparison.identity.payload.bytes, sha256: f.comparison.identity.payload.sha256 } };
  const preview = await authority.previewDecision({ ...command, decisionIntent: {
    mode: 'adopt-candidate', candidate: { candidateId: candidate.candidateId, ref: candidate.ref } } });
  const receipt: ComparisonDecisionReceiptV2 = { receiptVersion: '2.0.0', decisionId: 'test-saved-decision',
    reviewId: command.reviewId, reviewFingerprint: f.comparison.projection.reviewFingerprint,
    comparisonFingerprint: f.comparison.projection.sourceIdentity.comparisonFingerprint,
    projectIdentity: command.projectIdentity, expectedProjectRevision: f.comparison.identity.expectedProjectRevision,
    candidateRefs: f.refs, decisionIntent: preview.decisionIntent, selectedUnitIds: preview.selectedUnitIds,
    conflictResolutions: preview.conflictResolutions, planContentFingerprint: preview.planContentFingerprint,
    previewFingerprint: preview.previewFingerprint, reviewerChannel: 'surdet-editor-local',
    decidedAt: new Date().toISOString(), decisionFingerprint: '' };
  receipt.decisionFingerprint = await decisionFingerprintV2Of(receipt, hasher);
  await authority.write({ ...command, protocolVersion: '1.0.0', requestId: receipt.decisionId, action: 'comparison-decision', receipt });
  const ref: ReviewPreparationReference = { ...command, reviewPayload: { bytes: command.reviewPayload.bytes,
    sha256: command.reviewPayload.sha256 }, decisionId: receipt.decisionId, decisionFingerprint: receipt.decisionFingerprint };
  const projectData = path.join(f.dataRoot, ref.projectIdentity);
  const progressFile = path.join(projectData, 'reviews', ref.reviewId, 'preparation.json');
  return { ...f, authority, ref, projectData, progressFile,
    source: path.join(f.projectRoot, 'content/scenario/arrival.gal'),
    progress: async () => JSON.parse(await fs.readFile(progressFile, 'utf8')) as ReviewPreparationRecord,
    service: await ReviewPreparationService.open(f.projectRoot, f.dataRoot) };
}
const request = (decision: ReviewPreparationReference, action = 'prepare-result') => ({ protocolVersion: '1.0.0' as const,
  action: action as 'prepare-result' | 'inspect-preparation', decision });

it('resumes partial plan/result publication and lost integration acknowledgement without new identities', async () => {
  const f = await fixture();
  expect(await f.service.execute(request(f.ref, 'inspect-preparation'))).toMatchObject({ started: false, stage: 'plan' });
  expect(await fs.stat(f.progressFile).then(() => true, () => false)).toBe(false);
  const writePlan = NodeCompositionStore.prototype.writePlan;
  vi.spyOn(NodeCompositionStore.prototype, 'writePlan').mockImplementationOnce(async function (this: NodeCompositionStore, plan) {
    await writePlan.call(this, plan);
    await fs.rm(path.join(this.projectDirectory, 'composition-plans', plan.planId, 'identity.json'));
    throw new Error('interrupted after immutable plan payload');
  });
  expect(await f.service.execute(request(f.ref))).toMatchObject({ stage: 'plan', error: { code: 'REVIEW_PREPARATION_IO_FAILED' } });
  const reserved = (await f.progress()).resultReviewId;
  const planId = (await fs.readdir(path.join(f.projectData, 'composition-plans')))[0]!;
  const restarted = await ReviewPreparationService.open(f.projectRoot, f.dataRoot);
  expect(await restarted.execute(request(f.ref))).toMatchObject({ stage: 'compose' });
  const execute = CompositionService.prototype.executePlan;
  vi.spyOn(CompositionService.prototype, 'executePlan').mockImplementationOnce(async function (this: CompositionService, input) {
    await execute.call(this, input); throw new Error('lost integration acknowledgement');
  });
  expect(await restarted.execute(request(f.ref))).toMatchObject({ stage: 'compose', error: { code: 'REVIEW_PREPARATION_IO_FAILED' } });
  expect(await restarted.execute(request(f.ref))).toMatchObject({ stage: 'diff' });
  const composed = await f.progress();
  expect(composed.plan?.planId).toBe(planId);
  expect(composed.workingRevision).toBeGreaterThan(0);
  for (const stage of ['validate', 'simulate', 'run', 'result']) {
    expect(await restarted.execute(request(f.ref))).toMatchObject({ stage });
  }
  const createReview = NodeReviewStore.prototype.createReview;
  vi.spyOn(NodeReviewStore.prototype, 'createReview').mockImplementationOnce(async function (this: NodeReviewStore, reviewId, payload) {
    await createReview.call(this, reviewId, payload);
    await fs.rm(path.join(this.projectDirectory, 'reviews', reviewId, 'identity.json'));
    throw new Error('interrupted after immutable result payload');
  });
  expect(await restarted.execute(request(f.ref))).toMatchObject({ stage: 'result', error: { code: 'REVIEW_PREPARATION_IO_FAILED' } });
  const result = await restarted.execute(request(f.ref));
  expect(result).toMatchObject({ stage: 'ready', resultReviewId: reserved });
  expect(await restarted.execute(request(f.ref))).toEqual(result);
  expect((await f.progress()).changeId).toBe(composed.changeId);
  expect(await fs.readdir(path.join(f.projectData, 'composition-plans'))).toEqual([planId]);
  expect((await fs.readdir(path.join(f.projectData, 'reviews'))).sort()).toEqual([f.ref.reviewId, reserved].sort());
  const changes = (await fs.readdir(f.projectData)).filter(name => name.startsWith('chg_'));
  expect(changes).toHaveLength(3); // Two pre-existing candidates and this one integration.
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.initial);
  expect(await f.reviews.reviews.readFinalApproval(reserved)).toBeNull();
  const review = await f.reviews.reviews.readReview<HumanReviewProjection>(reserved);
  const final = review.value.finalResult!;
  const approval: FinalApprovalReceipt = { receiptVersion: '1.0.0', approvalId: 'test-final-approval',
    resultReviewId: reserved, decisionFingerprint: f.ref.decisionFingerprint, planId: final.planId,
    planFingerprint: final.planFingerprint, integrationChangeId: final.integrationChangeId,
    workingRevision: final.workingRevision, projectIdentity: f.ref.projectIdentity,
    expectedProjectRevision: review.identity.expectedProjectRevision, diffFingerprint: final.diffFingerprint,
    evidence: final.evidence, resultTreeSha256: final.resultTreeSha256, reviewerChannel: 'surdet-editor-local',
    approvedAt: new Date().toISOString(), approvalFingerprint: '' };
  approval.approvalFingerprint = await approvalFingerprintOf(approval, hasher);
  await f.authority.write({ protocolVersion: '1.0.0', requestId: 'test-approval', action: 'result-approval',
    projectIdentity: f.ref.projectIdentity, reviewId: reserved,
    reviewPayload: { bytes: review.identity.payload.bytes, sha256: review.identity.payload.sha256 }, receipt: approval });
  await f.reviews.prepareResult({ ...composed.plan!, changeId: composed.changeId! });
  expect((await f.reviews.reviews.readFinalApproval<FinalApprovalReceipt>(reserved))?.value).toEqual(approval);
  const authoring = new AuthoringService(undefined, new NodeLocalLeaseManager(f.dataRoot));
  await authoring.commit(composed.changeId!, { resultReviewId: reserved, approvalId: approval.approvalId,
    approvalFingerprint: approval.approvalFingerprint });
  expect(await restarted.execute(request(f.ref))).toMatchObject({ stage: 'ready', resultReviewId: reserved });
  const composition = await compositionServiceForProject(f.projectRoot, f.dataRoot);
  await expect(composition.executePlan({ ...composed.plan!, executeOperationId: `prepare_${f.ref.decisionFingerprint}` }))
    .rejects.toMatchObject({ code: 'COMPOSITION_PLAN_STALE' });
}, 30_000);

it('concurrent preparation keeps one progress record, and later integration edits stop it', async () => {
  const f = await fixture();
  const other = await ReviewPreparationService.open(f.projectRoot, f.dataRoot);
  await Promise.all([f.service.execute(request(f.ref)), other.execute(request(f.ref))]);
  let progress = await f.progress();
  while (progress.completed < 2) { await f.service.execute(request(f.ref)); progress = await f.progress(); }
  const opened = await NodeChangeStore.openForProject(progress.changeId!, f.projectRoot, { dataRoot: f.dataRoot });
  const record = opened!.record;
  // A real persisted edit between steps, never a fabricated HTTP response.
  await NodeChangeStore.withChangeLease(record.changeId, async store => {
    const latest = (await store.read(record.changeId))!;
    await store.write({ ...latest, recordVersion: latest.recordVersion + 1, workingRevision: latest.workingRevision + 1,
      workingFiles: { ...latest.workingFiles, 'content/scenario/arrival.gal': '@scene arrival\n外部改稿。\n@end\n' } },
    { expectedRecordVersion: latest.recordVersion, expectedStatus: latest.status });
  }, new NodeLocalLeaseManager(f.dataRoot));
  await expect(other.execute(request(f.ref))).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  expect((await f.progress()).completed).toBe(2);
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.initial);
}, 30_000);

it('real storage errors cross HTTP, client and page controller; malformed input never dispatches', async () => {
  const f = await fixture();
  let origin = '';
  const token = 'wave11-isolated-real-http';
  const dispatch = vi.fn((r) => f.service.execute(r));
  const server = http.createServer(createReviewAuthorityHttpHandler({ authority: f.authority, token,
    expectedOrigin: () => origin, prepareResult: dispatch }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const endpoint = `${origin}/__surdet/review-authority/v1/prepare-result`;
  try {
    for (const [body, from, auth, status] of [
      [{ ...request(f.ref), action: ['prepare-result'] }, origin, token, 400],
      [{ ...request(f.ref), projectRoot: 'other' }, origin, token, 400],
      [request(f.ref), 'http://foreign.invalid', token, 403],
      [request(f.ref), origin, 'wrong', 403],
    ] as const) {
      const response = await fetch(endpoint, { method: 'POST', headers: {
        'content-type': 'application/json', origin: from, 'x-surdet-review-authority': auth }, body: JSON.stringify(body) });
      expect(response.status).toBe(status);
    }
    expect(dispatch).not.toHaveBeenCalled();
    const client = createReviewPreparationClient({ token, endpoint,
      fetcher: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, origin } }) });
    const opened = vi.fn(async () => {});
    const controller = new ReviewPreparationController(f.ref, client, () => {}, opened, () => {});
    await fs.appendFile(f.source, '\n来源已变化。\n');
    await controller.prepare();
    expect(['REVIEW_DECISION_STALE', 'COMPOSITION_PLAN_STALE']).toContain(controller.errorCode);
    expect(controller.message).toContain('变化');
    expect(opened).not.toHaveBeenCalled();
    expect(await fs.stat(f.progressFile).then(() => true, () => false)).toBe(false);
    await fs.writeFile(f.source, f.initial);
    const candidate = f.refs[0]!;
    const capsule = path.join(f.projectData, candidate.changeId, 'capsules', candidate.capsuleId, 'payload.json');
    const originalCapsule = await fs.readFile(capsule);
    await fs.appendFile(capsule, '\n');
    await controller.prepare();
    expect(controller.errorCode).toBe('CAPSULE_IDENTITY_MISMATCH');
    expect(opened).not.toHaveBeenCalled();
    await fs.writeFile(capsule, originalCapsule);
    await client.status(f.ref, 'prepare-result');
    const bytes = await fs.readFile(f.progressFile);
    await fs.writeFile(f.progressFile, '{broken');
    await controller.prepare();
    expect(controller.errorCode).toBe('CHANGE_STORE_CORRUPT');
    expect(controller.message).toContain('不能另建结果');
    expect(await fs.readFile(f.progressFile, 'utf8')).toBe('{broken');
    await fs.writeFile(f.progressFile, bytes);
    await controller.prepare();
    expect(controller.status?.stage).toBe('ready');
    expect(opened).toHaveBeenCalledTimes(1);
    const directory = client.directory(f.ref, 'result');
    const permissions = directory as FileSystemDirectoryHandle & { queryPermission(options: { mode: string }): Promise<string> };
    expect(await permissions.queryPermission({ mode: 'readwrite' })).toBe('denied');
    await expect(directory.getFileHandle('new.json', { create: true })).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(client.execute({ protocolVersion: '1.0.0', action: 'read-prepared-file', decision: f.ref,
      view: 'result', path: '../../game.config.json' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const resultId = controller.status!.resultReviewId!;
    await expect(client.execute({ protocolVersion: '1.0.0', action: 'read-prepared-file', decision: f.ref,
      view: 'result', path: 'preparation.json' })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
    expect(await fs.readFile(f.source, 'utf8')).toBe(f.initial);
    await fs.appendFile(f.source, '\n准备完后仍改变来源。\n');
    await expect(client.status(f.ref, 'inspect-preparation')).rejects.toMatchObject({ code: 'REVIEW_DECISION_STALE' });
    expect((await f.progress()).resultReviewId).toBe(resultId);
    controller.dispose();
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}, 30_000);

it('does not recreate a terminated integration after its acknowledgement was lost', async () => {
  const f = await fixture();
  await f.service.execute(request(f.ref));
  await f.service.execute(request(f.ref));
  const progress = await f.progress();
  const leases = new NodeLocalLeaseManager(f.dataRoot);
  await NodeChangeStore.withChangeLease(progress.changeId!, async store => {
    const record = (await store.read(progress.changeId!))!;
    await store.write({ ...record, status: 'STALE', recordVersion: record.recordVersion + 1 },
      { expectedRecordVersion: record.recordVersion, expectedStatus: 'OPEN' });
  }, leases);
  const composition = await compositionServiceForProject(f.projectRoot, f.dataRoot);
  await expect(composition.executePlan({ ...progress.plan!, executeOperationId: `prepare_${f.ref.decisionFingerprint}` }))
    .rejects.toMatchObject({ code: 'CHANGE_NOT_OPEN' });
  expect((await fs.readdir(f.projectData)).filter(name => name.startsWith('chg_'))).toHaveLength(3);
}, 30_000);

it('resumes after the backend process exits before saving its completed composition step', async () => {
  const f = await fixture();
  await f.service.execute(request(f.ref));
  const before = await f.progress();
  const worker = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { ReviewPreparationService } from ${JSON.stringify(new URL('../dist/authoring/review-preparation-service.js', import.meta.url).href)};
    import { NodeReviewStore } from ${JSON.stringify(new URL('../dist/authoring/node-review-store.js', import.meta.url).href)};
    const input = JSON.parse(process.argv[1]);
    const write = NodeReviewStore.prototype.writePreparation;
    NodeReviewStore.prototype.writePreparation = async function(id, value) {
      if (value.completed === 2) process.exit(86);
      return write.call(this, id, value);
    };
    const service = await ReviewPreparationService.open(input.projectRoot, input.dataRoot);
    await service.execute(input.request);
  `, JSON.stringify({ projectRoot: f.projectRoot, dataRoot: f.dataRoot, request: request(f.ref) })],
  { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  expect(worker.stderr).toBe('');
  expect(worker.status).toBe(86);
  expect((await f.progress()).completed).toBe(1);
  const restarted = await ReviewPreparationService.open(f.projectRoot, f.dataRoot);
  expect(await restarted.execute(request(f.ref, 'inspect-preparation'))).toMatchObject({ stage: 'compose', working: true });
  // Preserve the existing lease grace interval; then the original lease manager
  // confirms the dead process and reclaims its lease on the explicit continuation.
  await expect.poll(() => restarted.execute(request(f.ref, 'inspect-preparation')),
    { timeout: 20_000, interval: 500 }).toMatchObject({ stage: 'compose', working: false });
  expect(await restarted.execute(request(f.ref))).toMatchObject({ stage: 'diff', working: false });
  expect((await f.progress()).resultReviewId).toBe(before.resultReviewId);
  expect((await fs.readdir(f.projectData)).filter(name => name.startsWith('chg_'))).toHaveLength(3);
  expect(await fs.readFile(f.source, 'utf8')).toBe(f.initial);
}, 30_000);
