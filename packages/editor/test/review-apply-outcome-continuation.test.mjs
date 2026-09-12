import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ReviewApplyController } from '../src/review-apply-controller.js';
import { ReviewApprovedApplyService } from '../../cli/src/authoring/review-approved-apply-service.js';
import { createReviewApplyClient } from '../src/review-apply-client.js';
import { statusFromInspection } from '@surdet/authoring';

const ref = { resultReviewId: 'result-a', approvalId: 'approval-a', approvalFingerprint: 'approval-fp' };
const scope = { projectIdentity: 'project-a', canonicalProjectRoot: 'D:/test/project', canonicalDataRoot: 'D:/test/data' };
const binding = { approvalRef: ref, decisionFingerprint: 'decision-fp', planId: 'plan-a', planFingerprint: 'plan-fp',
  integrationChangeId: 'change-a', workingRevision: 4, expectedProjectRevision: 'base-r1', resultTreeSha256: 'tree-fp' };
const fact = () => ({ binding, projectIdentity: scope.projectIdentity, changeId: binding.integrationChangeId,
  changedPaths: ['content/scenario/start.gal'], committedProjectRevision: 'after-r2', coordination: 'written' });
const base = () => ({ scope, binding, targetDisplayName: '试写项目', changedPaths: ['content/scenario/start.gal'],
  writeState: 'unwritten', workspace: 'clean', blockers: [], currentProject: 'matches-approved-base' });

function fixture(Controller = ReviewApplyController) {
  const f = { stored: base(), observation: 'normal', inspectionFailure: false, navigationFailure: false,
    syncFailure: false, project: 'result-fixture', dirty: false, transitioning: false,
    calls: { backendInspect: 0, commit: 0, network: 0, inspect: 0, sync: 0, navigate: 0 }, events: [] };
  const backend = {
    scope,
    inspect: async () => {
      f.calls.backendInspect++;
      if (f.observation === 'throw') throw new Error('状态服务暂时离线');
      if (f.observation === 'unknown') {
        const { commit: _commit, ...record } = f.stored;
        return { ...record, writeState: 'unknown', currentProject: 'unknown',
          blockers: [{ code: 'WRITE_OUTCOME_UNKNOWN', message: '暂时无法确认当前状态' }] };
      }
      return structuredClone(f.stored);
    },
    commit: async () => {
      f.calls.commit++;
      f.stored = { ...f.stored, writeState: 'committed', currentProject: 'matches-commit', commit: fact() };
      return fact();
    },
  };
  const service = new ReviewApprovedApplyService(backend);
  const client = createReviewApplyClient({ token: 'isolated-outcome-test-token', fetch: async (_url, init) => {
    f.calls.network++;
    return new Response(JSON.stringify({ ok: true, result: await service.execute(JSON.parse(init.body)) }));
  } });
  const editor = {
    inspect: async () => {
      f.calls.inspect++;
      if (f.inspectionFailure) throw new Error('工作区读取失败');
      return { projectIdentity: f.project, hasUnsavedDrafts: f.dirty, transitioning: f.transitioning };
    },
    synchronize: async id => {
      f.calls.sync++;
      if (f.syncFailure) throw new Error('新内容读取失败');
      f.project = id;
      return { projectIdentity: id, loadedCurrentDisk: true };
    },
    continueWriting: async () => {
      f.calls.navigate++;
      if (f.navigationFailure) throw new Error('剧本页面跳转失败');
    },
  };
  f.editor = editor;
  f.backend = backend;
  f.service = service;
  f.controller = new Controller(ref, r => client.execute(r), editor, s => f.events.push(s));
  return f;
}
async function written(f) { await f.controller.check(); await f.controller.write(); assert.equal(f.controller.snapshot.status.phase, 'written'); }
async function loaded(f) { await written(f); await f.controller.synchronize(); assert.equal(f.controller.snapshot.sync, 'synchronized'); }

test('commit acknowledgement retains subsequent recovery and identity blockers', async () => {
  for (const mode of ['recovery-required', 'unknown-with-identity-error']) {
    const f = fixture();
    const commit = f.backend.commit;
    f.backend.commit = async () => {
      const acknowledged = await commit();
      f.stored = { ...f.stored, writeState: mode === 'recovery-required' ? mode : 'unknown',
        blockers: mode === 'recovery-required' ? [] : [{ code: 'PROJECT_IDENTITY_MISMATCH', message: 'target moved' }] };
      return acknowledged;
    };
    await written(f);
    assert.equal(f.controller.snapshot.targetBlocked, true);
    await f.controller.synchronize();
    assert.equal(f.calls.sync, 0);
    assert.equal(f.calls.commit, 1);
  }
});

test('structured unknown with a recovery error cannot authorize loading after known success', async () => {
  const f = fixture();
  await written(f);
  f.stored = { ...f.stored, writeState: 'unknown', blockers: [{ code: 'JOURNAL_CORRUPT', message: 'invalid journal' }] };
  await f.controller.check();
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.equal(f.controller.snapshot.targetBlocked, true);
  await f.controller.synchronize();
  assert.equal(f.calls.sync, 0);
});

// These three cases were first run against the unchanged R2.1 implementation.
test('confirmed write survives a structured unknown query and still permits explicit loading', async () => {
  const f = fixture();
  await written(f);
  const commit = f.controller.snapshot.status.commit;
  f.observation = 'unknown';
  await f.controller.check();
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.deepEqual(f.controller.snapshot.status.commit, commit);
  assert.equal(f.controller.snapshot.status.currentProject, 'unknown');
  assert.equal(f.controller.snapshot.status.canWrite, false);
  assert.match(f.controller.snapshot.message, /本次.*查询|本次.*状态/);
  await f.controller.write();
  assert.equal(f.calls.commit, 1);
  await f.controller.synchronize();
  await f.controller.continueWriting();
  assert.equal(f.calls.sync, 1);
  assert.equal(f.calls.navigate, 1);
  assert.equal(f.calls.commit, 1);
});

test('continue workspace-read failure is visible and settles without an unhandled rejection', async () => {
  const f = fixture();
  await loaded(f);
  f.inspectionFailure = true;
  await assert.doesNotReject(f.controller.continueWriting());
  const failed = f.controller.snapshot;
  assert.equal(failed.status.phase, 'written');
  assert.equal(failed.continuation, 'failed');
  assert.match(failed.continuationMessage, /工作区读取失败/);
  assert.doesNotMatch(failed.message, /可以继续编辑/);
  assert.equal(f.calls.navigate, 0);
  f.inspectionFailure = false;
  await f.controller.continueWriting();
  assert.equal(f.controller.snapshot.continuation, 'opened');
  assert.equal(f.controller.snapshot.continuationMessage, '');
  assert.equal(f.calls.navigate, 1);
  assert.equal(f.calls.sync, 1);
  assert.equal(f.calls.commit, 1);
});

test('continue navigation failure is visible and an explicit retry does not rewrite or reload', async () => {
  const f = fixture();
  await loaded(f);
  f.navigationFailure = true;
  await assert.doesNotReject(f.controller.continueWriting());
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.equal(f.controller.snapshot.continuation, 'failed');
  assert.match(f.controller.snapshot.continuationMessage, /剧本页面跳转失败/);
  assert.doesNotMatch(f.controller.snapshot.message, /可以继续编辑/);
  f.navigationFailure = false;
  await f.controller.continueWriting();
  assert.equal(f.controller.snapshot.continuation, 'opened');
  assert.equal(f.controller.snapshot.continuationMessage, '');
  assert.equal(f.calls.navigate, 2);
  assert.equal(f.calls.sync, 1);
  assert.equal(f.calls.commit, 1);
});

test('unknown without any acknowledged write never manufactures success or enables loading', async () => {
  const f = fixture();
  f.observation = 'unknown';
  await f.controller.check();
  await f.controller.write();
  await f.controller.synchronize();
  await f.controller.continueWriting();
  assert.equal(f.controller.snapshot.status.phase, 'unknown');
  assert.equal(f.controller.snapshot.status.commit, undefined);
  assert.deepEqual({ writes: f.calls.commit, loads: f.calls.sync, navigations: f.calls.navigate },
    { writes: 0, loads: 0, navigations: 0 });
});

test('durable success learned from inspection is also retained after an unknown reply', async () => {
  const f = fixture();
  f.stored = { ...f.stored, writeState: 'committed', currentProject: 'matches-commit', commit: fact() };
  await f.controller.check();
  f.observation = 'unknown';
  await f.controller.check();
  await f.controller.synchronize();
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.equal(f.controller.snapshot.sync, 'synchronized');
  assert.equal(f.calls.commit, 0);
});

test('failed query after success retains commit but does not claim current disk is freshly verified', async () => {
  const f = fixture();
  await loaded(f);
  f.observation = 'throw';
  await f.controller.check();
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.equal(f.controller.snapshot.status.currentProject, 'unknown');
  assert.equal(f.controller.snapshot.sync, 'synchronized');
  assert.match(f.controller.snapshot.message, /查询暂时失败/);
  await f.controller.continueWriting();
  assert.equal(f.calls.commit, 1);
  assert.equal(f.calls.navigate, 1);
});

test('unknown query does not waive live draft protection during an explicit load', async () => {
  const f = fixture();
  await written(f);
  f.observation = 'unknown';
  await f.controller.check();
  f.dirty = true;
  await f.controller.synchronize();
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.equal(f.controller.snapshot.sync, 'drafts-blocked');
  assert.equal(f.calls.sync, 0);
  assert.equal(f.calls.commit, 1);
});

test('a weaker contradictory query cannot authorize a second write or hide a recovery blocker', async () => {
  for (const phase of ['ready', 'blocked', 'writing', 'recovery-required']) {
    const committed = statusFromInspection({ ...base(), writeState: 'committed', currentProject: 'matches-commit', commit: fact() });
    let reply = committed, writes = 0, loads = 0;
    const c = new ReviewApplyController(ref, async r => {
      if (r.action === 'write-approved-result') writes++;
      return structuredClone(reply);
    }, { inspect: async () => ({ projectIdentity: 'project-a', hasUnsavedDrafts: false, transitioning: false }),
      synchronize: async id => { loads++; return { projectIdentity: id, loadedCurrentDisk: true }; }, continueWriting: async () => {} }, () => {});
    await c.check();
    reply = { ...statusFromInspection(base()), phase, canWrite: phase === 'ready' };
    await c.check();
    assert.equal(c.snapshot.status.phase, 'written', phase);
    assert.equal(c.snapshot.status.canWrite, false, phase);
    assert.equal(c.snapshot.targetBlocked, true, phase);
    await c.write();
    await c.synchronize();
    assert.equal(writes, 0, phase);
    assert.equal(loads, 0, phase);
    reply = committed;
    await c.check();
    await c.synchronize();
    assert.equal(c.snapshot.targetBlocked, false, phase);
    assert.equal(loads, 1, phase);
  }
});

test('later valid project edits refresh observation without discarding the historical commit', async () => {
  const f = fixture();
  await written(f);
  f.stored = { ...f.stored, currentProject: 'changed-after-commit' };
  await f.controller.check();
  assert.equal(f.controller.snapshot.status.phase, 'written');
  assert.equal(f.controller.snapshot.status.currentProject, 'changed-after-commit');
  await f.controller.write();
  assert.equal(f.calls.commit, 1);
});

test('durable confirmation remains scoped to the exact approval, project, integration and binding', async () => {
  const good = statusFromInspection({ ...base(), writeState: 'committed', currentProject: 'matches-commit', commit: fact() });
  const variants = [
    { ...good, approvalRef: { ...ref, approvalId: 'other-approval' } },
    { ...good, projectIdentity: 'project-b' },
    { ...good, integrationChangeId: 'change-b' },
    { ...good, targetPath: 'D:/other/project' },
    { ...good, commit: { ...good.commit, binding: { ...binding, planId: 'plan-b' } } },
  ];
  for (const bad of variants) {
    let reply = good, loads = 0;
    const c = new ReviewApplyController(ref, async () => structuredClone(reply), {
      inspect: async () => ({ projectIdentity: 'project-a', hasUnsavedDrafts: false, transitioning: false }),
      synchronize: async id => { loads++; return { projectIdentity: id, loadedCurrentDisk: true }; }, continueWriting: async () => {},
    }, () => {});
    await c.check();
    reply = bad;
    await c.check();
    assert.equal(c.snapshot.status.phase, 'written');
    assert.equal(c.snapshot.status.projectIdentity, 'project-a');
    assert.deepEqual(c.snapshot.status.commit, good.commit);
    assert.equal(c.snapshot.targetBlocked, true);
    await c.synchronize();
    assert.equal(loads, 0, 'a known commit does not authorize a different target');
    reply = good;
    await c.check();
    await c.synchronize();
    assert.equal(loads, 1);
  }
});

test('a newly opened controller never inherits another controller historical success', async () => {
  const a = fixture();
  await written(a);
  a.controller.dispose();
  const b = fixture();
  b.observation = 'unknown';
  await b.controller.check();
  await b.controller.synchronize();
  assert.equal(b.controller.snapshot.status.phase, 'unknown');
  assert.equal(b.calls.sync, 0);
});

test('checking server status does not erase a failed continuation or display ready-to-edit text', async () => {
  const f = fixture();
  await loaded(f);
  f.navigationFailure = true;
  await f.controller.continueWriting();
  const message = f.controller.snapshot.continuationMessage;
  await f.controller.check();
  assert.equal(f.controller.snapshot.continuation, 'failed');
  assert.equal(f.controller.snapshot.continuationMessage, message);
  assert.doesNotMatch(f.controller.snapshot.message, /可以继续编辑/);
  assert.equal(f.calls.navigate, 1, 'a query must not retry navigation');
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('continuation is serialized and query/load calls cannot strand or duplicate it', async () => {
  const f = fixture();
  await loaded(f);
  const entered = deferred(), gate = deferred();
  f.editor.continueWriting = async () => { f.calls.navigate++; entered.resolve(); await gate.promise; };
  const first = f.controller.continueWriting();
  await entered.promise;
  assert.equal(f.controller.snapshot.continuation, 'opening');
  const count = { ...f.calls };
  await f.controller.continueWriting();
  await f.controller.check();
  await f.controller.synchronize();
  await f.controller.write();
  assert.deepEqual(f.calls, count);
  gate.resolve();
  await first;
  assert.equal(f.controller.snapshot.continuation, 'opened');
  assert.equal(f.calls.navigate, 1);
  assert.equal(f.calls.commit, 1);
});

test('a status query cannot interrupt an in-flight project load and leave sync stuck checking', async () => {
  const f = fixture();
  await written(f);
  const gate = deferred(), entered = deferred();
  f.editor.synchronize = async id => { f.calls.sync++; entered.resolve(); await gate.promise;
    f.project = id; return { projectIdentity: id, loadedCurrentDisk: true }; };
  const pending = f.controller.synchronize();
  await entered.promise;
  const n = f.calls.network;
  await f.controller.check();
  assert.equal(f.calls.network, n);
  gate.resolve();
  await pending;
  assert.equal(f.controller.snapshot.sync, 'synchronized');
});

test('continuation ignores late reads or late navigation after the workspace is disposed', async () => {
  for (const phase of ['inspect', 'navigate']) {
    const f = fixture();
    await loaded(f);
    const gate = deferred(), entered = deferred();
    if (phase === 'inspect') f.editor.inspect = async () => { entered.resolve(); await gate.promise;
      return { projectIdentity: 'project-a', hasUnsavedDrafts: false, transitioning: false }; };
    else f.editor.continueWriting = async () => { f.calls.navigate++; entered.resolve(); await gate.promise; };
    const pending = f.controller.continueWriting();
    await entered.promise;
    const n = f.events.length;
    f.controller.dispose();
    gate.resolve();
    await pending;
    assert.equal(f.events.length, n, phase);
    assert.equal(f.calls.navigate, phase === 'inspect' ? 0 : 1, phase);
  }
});

test('post-navigation workspace failures and project changes are not reported as confirmed success', async () => {
  for (const condition of ['throw', 'switched']) {
    const f = fixture();
    await loaded(f);
    f.editor.continueWriting = async () => { f.calls.navigate++;
      if (condition === 'throw') f.inspectionFailure = true;
      else f.project = 'project-b'; };
    await assert.doesNotReject(f.controller.continueWriting());
    assert.equal(f.controller.snapshot.status.phase, 'written');
    assert.equal(f.controller.snapshot.continuation, 'failed');
    assert.match(f.controller.snapshot.continuationMessage, condition === 'throw' ? /核对导航后的工作区/ : /项目发生切换/);
    if (condition === 'switched') assert.equal(f.controller.snapshot.sync, 'not-loaded');
  }
});

test('continuing inside the same verified project preserves newly created drafts', async () => {
  const f = fixture();
  await loaded(f);
  f.dirty = true;
  await f.controller.continueWriting();
  assert.equal(f.controller.snapshot.continuation, 'opened');
  assert.equal(f.dirty, true);
  assert.equal(f.calls.sync, 1);
  assert.equal(f.calls.commit, 1);
});

test('load read failures are visible, retain commit, and recover only after an explicit load retry', async () => {
  for (const flag of ['inspectionFailure', 'syncFailure']) {
    const f = fixture();
    await written(f);
    f[flag] = true;
    await assert.doesNotReject(f.controller.synchronize());
    assert.equal(f.controller.snapshot.status.phase, 'written');
    assert.equal(f.controller.snapshot.sync, 'failed');
    assert.match(f.controller.snapshot.message, /尚未确认同步/);
    f[flag] = false;
    await f.controller.synchronize();
    assert.equal(f.controller.snapshot.sync, 'synchronized');
    assert.equal(f.calls.commit, 1);
  }
});
