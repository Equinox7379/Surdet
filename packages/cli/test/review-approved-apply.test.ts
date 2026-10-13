/// <reference lib="dom" />
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeReviewApprovedApplyBackend } from '../src/authoring/node-review-approved-apply.js';
import { ReviewApprovedApplyService } from '../src/authoring/review-approved-apply-service.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { ProjectMutationNoticeStore } from '../src/authoring/project-mutation-notice-store.js';
import { createReviewApplyFixture } from './helpers/review-apply-fixture.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import { createReviewAuthorityHttpHandler } from '../src/review-authority/http-handler.js';
import { createReviewApplyClient } from '../../editor/src/review-apply-client.js';
import { ReviewApplyController } from '../../editor/src/review-apply-controller.js';

const roots: string[] = [];
const originalDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
afterEach(async () => {
  vi.restoreAllMocks();
  if (originalDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
  else process.env['SURDET_AGENT_DATA_DIR'] = originalDataRoot;
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(approve = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-approved-apply-'));
  roots.push(root);
  const f = await createReviewApplyFixture(root, approve);
  const backend = await NodeReviewApprovedApplyBackend.open(f.projectRoot, f.dataRoot);
  const service = new ReviewApprovedApplyService(backend);
  const request = { protocolVersion: '1.0.0', approvalRef: f.ref } as const;
  return { ...f, backend, service,
    inspect: () => service.execute({ ...request, action: 'inspect-approved-application' }),
    write: () => service.execute({ ...request, action: 'write-approved-result' }),
  };
}

describe('approved result apply through real authoring storage', () => {
  it('审阅写回将纯断联宽限归为忙碌，保留损坏分类且只在宽限结束后允许明确写回', async () => {
    const f = await fixture();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const store = new HumanWorkspaceStore({ dataRoot: f.dataRoot });
    const root = f.backend.scope.canonicalProjectRoot;
    const session = { workspaceSessionId: randomUUID(), browserSessionId: 'disconnected-review-editor',
      workspaceGeneration: 1, availability: 'clean' as const };
    await store.heartbeat(root, session);
    const commit = vi.spyOn(f.backend, 'commit');
    now += 12_000;
    expect(await f.inspect()).toMatchObject({ phase: 'blocked', canWrite: false, retryAfterMs: 10_000,
      blockers: [{ code: 'HUMAN_WORKSPACE_BUSY', message: expect.stringContaining('等待旧窗口连接确认') }] });
    expect(await f.write()).toMatchObject({ phase: 'blocked', canWrite: false,
      blockers: [{ code: 'HUMAN_WORKSPACE_BUSY', message: expect.any(String) }] });
    expect(commit).not.toHaveBeenCalled();
    const source = path.join(f.projectRoot, 'content/scenario/start.gal');
    expect(await fs.readFile(source, 'utf8')).toBe(f.initial);

    const past = new HumanWorkspaceStore({ dataRoot: f.dataRoot, now: () => now - 12_000 });
    await past.heartbeat(root, { ...session, workspaceGeneration: 2,
      availability: 'blocked', blockedReasons: ['autosave-recovery'] });
    expect(await f.write()).toMatchObject({ phase: 'blocked', canWrite: false,
      blockers: [{ code: 'HUMAN_WORKSPACE_STATE_CORRUPT', message: expect.any(String) }] });
    expect(commit).not.toHaveBeenCalled();
    expect(await fs.readFile(source, 'utf8')).toBe(f.initial);

    await past.heartbeat(root, { ...session, workspaceGeneration: 3 });
    now += 11_000;
    expect(await f.inspect()).toMatchObject({ phase: 'ready', canWrite: true, blockers: [] });
    expect(commit).not.toHaveBeenCalled();
    expect(await f.write()).toMatchObject({ phase: 'written', canWrite: false });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(source, 'utf8')).not.toBe(f.initial);
  }, 30_000);

  it('批准与查询不写项目；明确写回只提交一次，并在另一默认 dataRoot 下正确回读历史', async () => {
    const f = await fixture();
    const unrelatedData = path.join(f.root, 'unrelated-data');
    await fs.mkdir(unrelatedData);
    await fs.writeFile(path.join(unrelatedData, 'keep.txt'), 'unrelated data');
    process.env['SURDET_AGENT_DATA_DIR'] = unrelatedData;
    const commit = vi.spyOn(AuthoringService.prototype, 'commit');
    const before = await f.inspect();
    expect(before).toMatchObject({ phase: 'ready', canWrite: true, projectIdentity: f.result.identity.projectIdentity });
    expect(before.targetPath).toBe((await NodeProjectStorage.open(f.projectRoot)).rootIdentity);
    expect(before.targetPath).not.toBe(f.result.projectDirectory);
    const source = path.join(f.projectRoot, 'content/scenario/start.gal');
    expect(await fs.readFile(source, 'utf8')).toBe(f.initial);
    expect(commit).not.toHaveBeenCalled();
    const results = await Promise.all([f.write(), f.write()]);
    expect(results.map((result) => result.phase)).toEqual(['written', 'written']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(source, 'utf8')).not.toBe(f.initial);
    const fresh = new ReviewApprovedApplyService(await NodeReviewApprovedApplyBackend.open(f.projectRoot, f.dataRoot));
    const request = { protocolVersion: '1.0.0', action: 'write-approved-result', approvalRef: f.ref };
    expect(await fresh.execute(request)).toMatchObject({ phase: 'written', currentProject: 'matches-commit' });
    const edited = '@scene start\n这是写回后继续创作的新台词。\n@end\n';
    await fs.writeFile(source, edited);
    expect(await fresh.execute(request)).toMatchObject({ phase: 'written', currentProject: 'changed-after-commit' });
    expect(await fs.readFile(source, 'utf8')).toBe(edited);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(unrelatedData)).toEqual(['keep.txt']);
    const opened = await NodeChangeStore.openForProject(f.approval.integrationChangeId, before.targetPath,
      { dataRoot: f.dataRoot, allowTerminal: true });
    expect(opened?.record.status).toBe('COMMITTED');
    expect((await opened!.store.readLatestJournal(f.approval.integrationChangeId))?.status).toBe('COMMITTED');
  }, 30_000);

  it('未批准、伪造批准及项目外部修改均不能写入', async () => {
    const f = await fixture(false);
    const commit = vi.spyOn(AuthoringService.prototype, 'commit');
    await expect(f.write()).rejects.toMatchObject({ code: 'REVIEW_APPROVAL_REQUIRED' });
    await f.authority.write({ ...f.resultCommand, protocolVersion: '1.0.0', requestId: 'approve', action: 'result-approval', receipt: f.approval });
    await expect(f.service.execute({ protocolVersion: '1.0.0', action: 'write-approved-result',
      approvalRef: { ...f.ref, approvalFingerprint: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
    const source = path.join(f.projectRoot, 'content/scenario/start.gal');
    await fs.appendFile(source, '\n外部新增内容。\n');
    const changed = await fs.readFile(source, 'utf8');
    expect(await f.write()).toMatchObject({ phase: 'blocked', canWrite: false });
    expect(await fs.readFile(source, 'utf8')).toBe(changed);
    expect(commit).not.toHaveBeenCalled();
  }, 30_000);

  it('已提交但响应丢失或通知失败，从原日志确认成功且不重写', async () => {
    const f = await fixture();
    vi.spyOn(ProjectMutationNoticeStore.prototype, 'record').mockRejectedValue(new Error('notice unavailable'));
    const original = f.backend.commit.bind(f.backend);
    const commit = vi.spyOn(f.backend, 'commit').mockImplementation(async (binding) => {
      await original(binding);
      throw new Error('response lost');
    });
    expect(await f.write()).toMatchObject({ phase: 'written', canWrite: false });
    expect(await f.write()).toMatchObject({ phase: 'written', canWrite: false });
    expect(commit).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('真实 HTTP 拒绝错误命令；日志损坏经过 client/controller 后保留成功但阻止加载', async () => {
    const f = await fixture();
    const dispatch = vi.fn((request) => f.service.execute(request));
    const token = 'isolated-approved-apply-http-token';
    let origin = '';
    const server = http.createServer(createReviewAuthorityHttpHandler({ authority: f.authority, token,
      expectedOrigin: () => origin, applyApprovedResult: dispatch }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const route = '/__surdet/review-authority/v1/apply-approved-result';
      const request = { protocolVersion: '1.0.0', action: 'write-approved-result', approvalRef: f.ref };
      for (const [body, originHeader, auth, status] of [
        [{ ...request, action: ['inspect-approved-application'] }, origin, token, 400],
        [{ ...request, projectRoot: f.result.projectDirectory }, origin, token, 400],
        [request, 'http://foreign.invalid', token, 403],
        [request, origin, 'wrong-token', 403],
      ] as const) {
        const response = await fetch(origin + route, { method: 'POST', body: JSON.stringify(body),
          headers: { 'content-type': 'application/json', origin: originHeader, 'x-surdet-review-authority': auth } });
        expect(response.status).toBe(status);
      }
      expect(dispatch).not.toHaveBeenCalled();
      const client = createReviewApplyClient({ token, fetch: (url, init) => fetch(origin + url, {
        ...init, headers: { ...init?.headers, origin },
      }) });
      const editor = { inspect: vi.fn(async () => ({ projectIdentity: f.backend.scope.projectIdentity,
        hasUnsavedDrafts: false, transitioning: false })),
      synchronize: vi.fn(async (projectIdentity: string) => ({ projectIdentity, loadedCurrentDisk: true })),
      continueWriting: vi.fn(async () => {}) };
      const controller = new ReviewApplyController(f.ref, (r) => client.execute(r), editor, () => {});
      await controller.check();
      await controller.write();
      expect(controller.snapshot.status?.phase).toBe('written');
      const journalDirectory = path.join(f.dataRoot, f.backend.scope.projectIdentity,
        f.approval.integrationChangeId, 'journals');
      const latest = (await fs.readdir(journalDirectory)).sort().at(-1)!;
      const journalFile = path.join(journalDirectory, latest);
      const bytes = await fs.readFile(journalFile);
      await fs.writeFile(journalFile, '{bad journal');
      await controller.check();
      expect(controller.snapshot.status?.phase).toBe('written');
      expect(controller.snapshot.targetBlocked).toBe(true);
      expect(controller.snapshot.message).toContain('JOURNAL_CORRUPT');
      await controller.synchronize();
      expect(editor.synchronize).not.toHaveBeenCalled();
      await fs.writeFile(journalFile, bytes);
      await controller.check();
      await controller.synchronize();
      expect(controller.snapshot.targetBlocked).toBe(false);
      expect(editor.synchronize).toHaveBeenCalledTimes(1);
      const approvalFile = path.join(f.dataRoot, f.backend.scope.projectIdentity, 'reviews', f.result.reviewId, 'final-approval.json');
      await fs.rename(approvalFile, `${approvalFile}.held`);
      await controller.check();
      expect(controller.snapshot.status?.phase).toBe('written');
      expect(controller.snapshot.message).toContain('REVIEW_APPROVAL_REQUIRED');
      expect(controller.snapshot.targetBlocked).toBe(true);
      await controller.synchronize();
      expect(editor.synchronize).toHaveBeenCalledTimes(1);
      await fs.rename(`${approvalFile}.held`, approvalFile);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);

  it('多个真实工作区中的草稿、保存中及失联状态均阻止写回，临提交变化也受原门禁保护', async () => {
    const f = await fixture();
    const root = f.backend.scope.canonicalProjectRoot;
    const store = new HumanWorkspaceStore({ dataRoot: f.dataRoot });
    const clean = { workspaceSessionId: randomUUID(), browserSessionId: 'clean-window', workspaceGeneration: 1,
      availability: 'clean' as const };
    const active = { ...clean, workspaceSessionId: randomUUID(), browserSessionId: 'working-window' };
    await store.heartbeat(root, clean);
    const commit = vi.spyOn(AuthoringService.prototype, 'commit');
    for (const dirtyScope of ['scene', 'timeline', 'config', 'review'] as const) {
      await store.heartbeat(root, { ...active, availability: 'dirty', dirtyScopes: [dirtyScope] });
      expect(await f.write()).toMatchObject({ phase: 'blocked', blockers: expect.arrayContaining([{ code: 'HUMAN_WORKSPACE_DIRTY', message: expect.any(String) }]) });
    }
    await store.heartbeat(root, { ...active, availability: 'busy', busyReasons: ['saving'] });
    expect(await f.write()).toMatchObject({ phase: 'blocked' });
    const lost = new HumanWorkspaceStore({ dataRoot: f.dataRoot, now: () => Date.now() - 10_000 });
    await lost.heartbeat(root, active);
    expect(await f.write()).toMatchObject({ phase: 'blocked' });
    expect(commit).not.toHaveBeenCalled();
    await store.heartbeat(root, active);
    expect(await f.inspect()).toMatchObject({ phase: 'ready' });
    const originalCommit = f.backend.commit.bind(f.backend);
    vi.spyOn(f.backend, 'commit').mockImplementation(async (binding) => {
      await store.heartbeat(root, { ...active, availability: 'dirty', dirtyScopes: ['scene'] });
      return originalCommit(binding);
    });
    expect(await f.write()).toMatchObject({ phase: 'blocked' });
    expect(await fs.readFile(path.join(f.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe(f.initial);
  }, 30_000);

  it('批准结果多文件替换失败后经原恢复入口重试；两个服务重开均认出同一成功', async () => {
    const f = await fixture();
    const replace = NodeProjectStorage.prototype.replaceFromStage;
    let count = 0;
    const fault = vi.spyOn(NodeProjectStorage.prototype, 'replaceFromStage').mockImplementation(async function (this: NodeProjectStorage, file, staged) {
      if (++count === 2) throw new Error('second file failed');
      return replace.call(this, file, staged);
    });
    expect((await f.write()).phase).not.toBe('written');
    fault.mockRestore();
    expect(await fs.readFile(path.join(f.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe(f.initial);
    const recovery = await f.authoring.inspectRecovery(f.approval.integrationChangeId);
    expect(recovery.result.disposition).toBe('REOPEN_OPEN');
    await f.authoring.executeRecovery(f.approval.integrationChangeId, {
      operationId: 'approved-retry', recoveryToken: recovery.result.recoveryToken!,
    });
    const other = new ReviewApprovedApplyService(await NodeReviewApprovedApplyBackend.open(f.projectRoot, f.dataRoot));
    const request = { protocolVersion: '1.0.0', action: 'write-approved-result', approvalRef: f.ref };
    await Promise.allSettled([f.write(), other.execute(request)]);
    expect(await f.inspect()).toMatchObject({ phase: 'written', currentProject: 'matches-commit' });
    expect(await other.execute(request)).toMatchObject({ phase: 'written' });
  }, 30_000);
});
