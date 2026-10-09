import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { EditorWorkspaceAuthority } from '../src/editor-workspace-authority/editor-workspace-authority.js';

const roots: string[] = [];
const authorities: EditorWorkspaceAuthority[] = [];
const state = { workspaceSessionId: 'cc537946-4af9-44f1-9a84-87c08a39a941', browserSessionId: 'review-discovery', workspaceGeneration: 1, availability: 'clean' as const };
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-review-discovery-'));
  roots.push(root);
  return { root, store: new NodeReviewStore(path.join(root, 'project-one'), 'project-one', new NodeLocalLeaseManager(root)) };
}
async function seed(store: NodeReviewStore, reviewId: string, kind: 'comparison' | 'integration-result' = 'comparison') {
  await store.createReview(reviewId, { reviewVersion: '2.0.0', reviewId, kind,
    projectIdentity: path.basename(store.projectDirectory), expectedProjectRevision: 'saved-project', comparisonFingerprint: 'comparison' });
  return store.reviewDirectoryPath(reviewId);
}
afterEach(async () => {
  for (const authority of authorities.splice(0)) await authority.close();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('surdet-review-discovery-')) throw new Error('unexpected fixture root');
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('bound project review task discovery', () => {
  it('returns an empty list without creating a missing namespace', async () => {
    const { root, store } = await fixture();
    expect(await store.listReviewTasks()).toEqual({ projectIdentity: 'project-one', tasks: [], pendingCount: 0 });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('discovers both review kinds and reports receipt presence without claiming approval', async () => {
    const { root, store } = await fixture();
    const comparison = await seed(store, 'comparison');
    const result = await seed(store, 'result', 'integration-result');
    const returned = await seed(store, 'returned', 'integration-result');
    await fs.writeFile(path.join(returned, 'return-request.json'), '{}');
    const foreign = new NodeReviewStore(path.join(root, 'project-two'), 'project-two');
    await seed(foreign, 'foreign');
    const before = await fs.readFile(path.join(comparison, 'comparison/review.json'));
    expect(await store.listReviewTasks()).toEqual({ projectIdentity: 'project-one', pendingCount: 2, tasks: [
      { reviewId: 'comparison', kind: 'comparison', status: 'pending', receiptFiles: [] },
      { reviewId: 'result', kind: 'integration-result', status: 'pending', receiptFiles: [] },
      { reviewId: 'returned', kind: 'integration-result', status: 'receipt-present', receiptFiles: ['return-request.json'] },
    ] });
    await fs.writeFile(path.join(result, 'final-approval.json'), 'not a verified receipt');
    const refreshed = await store.listReviewTasks();
    expect(refreshed.pendingCount).toBe(1);
    expect(refreshed.tasks.find(task => task.reviewId === 'result')?.status).toBe('receipt-present');
    expect(await fs.readFile(path.join(comparison, 'comparison/review.json'))).toEqual(before);
    expect(await fs.readdir(comparison)).toEqual(expect.arrayContaining(['comparison', 'identity.json']));
  });

  it('keeps healthy tasks while exposing broken identity, missing payload and conflicting receipts', async () => {
    const { store } = await fixture();
    await seed(store, 'healthy');
    const malformed = await seed(store, 'malformed');
    await fs.writeFile(path.join(malformed, 'identity.json'), '{');
    const missing = await seed(store, 'missing');
    await fs.unlink(path.join(missing, 'comparison/review.json'));
    const conflict = await seed(store, 'conflict');
    await fs.writeFile(path.join(conflict, 'decision.json'), '{}');
    await fs.writeFile(path.join(conflict, 'final-approval.json'), '{}');
    const mismatch = await seed(store, 'mismatch');
    const identityFile = path.join(mismatch, 'identity.json');
    const identity = JSON.parse(await fs.readFile(identityFile, 'utf8'));
    await fs.writeFile(identityFile, JSON.stringify({ ...identity, projectIdentity: 'another-project' }));
    const list = await store.listReviewTasks();
    expect(list.pendingCount).toBe(1);
    expect(list.tasks.find(task => task.reviewId === 'healthy')?.status).toBe('pending');
    expect(list.tasks.filter(task => task.status === 'unavailable').map(task => task.reviewId)).toEqual(['conflict', 'malformed', 'mismatch', 'missing']);
    expect(list.tasks.find(task => task.reviewId === 'malformed')?.errorCode).toBe('CHANGE_STORE_CORRUPT');
    expect(JSON.stringify(list)).not.toContain(store.projectDirectory);
  });

  it('does not follow a linked review directory', async (context) => {
    const { root, store } = await fixture();
    const review = await seed(store, 'healthy');
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'outside stays private');
    const linked = path.join(store.projectDirectory, 'reviews', 'linked');
    try { await fs.symlink(outside, linked, 'junction'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) { context.skip(); return; }
      throw error;
    }
    expect((await store.listReviewTasks()).tasks.find(task => task.reviewId === 'linked')).toMatchObject({ status: 'unavailable', errorCode: 'PATH_OUTSIDE_PROJECT' });
    expect(await fs.readFile(path.join(outside, 'private.txt'), 'utf8')).toBe('outside stays private');
    await expect(store.readPreparedContent('linked', '', 'directory')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
    expect((await fs.readdir(review)).includes('decision.json')).toBe(false);
  });

  it('requires the bound workspace session and keeps reads inside its own review namespace', async () => {
    const { root } = await fixture();
    const project = path.join(root, 'project');
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'game.config.json'), '{"entryScene":"start","variables":{}}');
    const data = path.join(root, 'agent-data');
    const manager = new NodeLocalLeaseManager(data);
    const authority = new EditorWorkspaceAuthority(await fs.realpath(project), { leaseManager: manager });
    authorities.push(authority);
    await expect(authority.reviewTasks(state)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
    await authority.heartbeat(state);
    const { projectIdentity } = await authority.snapshot();
    const store = new NodeReviewStore(path.join(data, projectIdentity), projectIdentity, manager);
    const directory = await seed(store, 'owned');
    expect((await authority.reviewTasks(state)).tasks.map(task => task.reviewId)).toEqual(['owned']);
    const read = await authority.reviewContent(state, { reviewId: 'owned', kind: 'file', path: 'comparison/review.json' });
    expect(read.kind).toBe('file');
    if (read.kind === 'file') expect(Buffer.from(read.base64, 'base64')).toEqual(await fs.readFile(path.join(directory, 'comparison/review.json')));
    await expect(authority.reviewContent(state, { reviewId: 'owned', kind: 'file', path: '../private.txt' })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
    await expect(authority.reviewContent(state, { reviewId: '../another-project', kind: 'directory', path: '' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(authority.reviewTasks({ ...state, browserSessionId: 'other' })).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
    await authority.heartbeat({ ...state, workspaceGeneration: 2 });
    await expect(authority.reviewTasks(state)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
    await authority.revoke(state.workspaceSessionId, state.browserSessionId);
    await expect(authority.reviewTasks({ ...state, workspaceGeneration: 2 })).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
  });
});
