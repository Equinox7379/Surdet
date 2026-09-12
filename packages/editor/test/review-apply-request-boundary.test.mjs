import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseReviewApplyRequest } from '@surdet/authoring';
import { ReviewApprovedApplyService } from '../../cli/src/authoring/review-approved-apply-service.js';
import { createReviewApplyClient } from '../src/review-apply-client.js';

const INSPECT = 'inspect-approved-application';
const WRITE = 'write-approved-result';
const ref = { resultReviewId: 'boundary-result', approvalId: 'boundary-approval', approvalFingerprint: 'test-fingerprint' };
const scope = { projectIdentity: 'test-project', canonicalProjectRoot: 'isolated-project', canonicalDataRoot: 'isolated-data' };
const binding = {
  approvalRef: ref, decisionFingerprint: 'decision', planId: 'plan', planFingerprint: 'plan-fp',
  integrationChangeId: 'test-change', workingRevision: 1, expectedProjectRevision: 'base', resultTreeSha256: 'tree',
};
const request = action => ({ protocolVersion: '1.0.0', action, approvalRef: { ...ref } });
const jsonRequest = action => JSON.parse(JSON.stringify(request(action)));

// Deliberately use only an in-memory backend. The production parser and service
// are real; every backend entry is counted and no project files are accessible.
function fixture() {
  const calls = { inspect: 0, commit: 0 };
  let state = {
    scope, binding, targetDisplayName: 'Isolated request-boundary fixture', changedPaths: [],
    writeState: 'unwritten', workspace: 'clean', blockers: [], currentProject: 'matches-approved-base',
  };
  const backend = {
    scope,
    async inspect() { calls.inspect++; return structuredClone(state); },
    async commit() {
      calls.commit++;
      const fact = { binding, projectIdentity: scope.projectIdentity, changeId: binding.integrationChangeId,
        changedPaths: [], coordination: 'written' };
      state = { ...state, writeState: 'committed', currentProject: 'matches-commit', commit: fact };
      return fact;
    },
  };
  return { calls, backend, service: new ReviewApprovedApplyService(backend), state: () => structuredClone(state) };
}

const invalidActions = [
  ['inspect array', [INSPECT]], ['write array', [WRITE]],
  ['nested inspect array', [[INSPECT]]], ['empty array', []], ['two actions', [INSPECT, WRITE]],
  ['object', { action: INSPECT }], ['array-like JSON object', { 0: INSPECT, length: 1 }],
  ['null', null], ['boolean', true], ['number', 0], ['missing', undefined],
  ['empty string', ''], ['unknown string', 'approve-and-write'],
  ['leading whitespace', ` ${INSPECT}`], ['trailing whitespace', `${WRITE} `],
  ['wrong case', INSPECT.toUpperCase()],
];

async function assertRejectedBeforeBackend(raw, label) {
  const f = fixture();
  const before = f.state();
  let error;
  try { await f.service.execute(raw); } catch (caught) { error = caught; }
  // Side-effect assertions come first, so the original bug reports commit=1,
  // rather than merely "expected a rejection".
  assert.equal(f.calls.commit, 0, `${label}: commit must not be invoked`);
  assert.equal(f.calls.inspect, 0, `${label}: invalid input must not reach the backend`);
  assert.equal(error?.code, 'INVALID_REQUEST', label);
  assert.deepEqual(f.state(), before, `${label}: state must remain unchanged`);
}

test('array inspect request is rejected before any backend call', async () => {
  await assertRejectedBeforeBackend(jsonRequest([INSPECT]), 'reported array inspect');
});

test('malformed action matrix is rejected by both parser and service', async () => {
  for (const [label, action] of invalidActions) {
    const raw = jsonRequest(action);
    assert.throws(() => parseReviewApplyRequest(raw), { code: 'INVALID_REQUEST' }, label);
    await assertRejectedBeforeBackend(raw, label);
  }
});

test('action validation does not call conversion hooks or accept boxed strings', async () => {
  for (const action of [INSPECT, WRITE]) {
    let conversions = 0;
    const coercible = { toString() { conversions++; return action; } };
    await assertRejectedBeforeBackend(request(coercible), 'coercible object');
    assert.equal(conversions, 0, 'action must be checked without string conversion');
    await assertRejectedBeforeBackend(request(new String(action)), 'boxed string');
  }
});

test('only exact primitive actions survive parsing; approved reads stay read-only', async () => {
  for (const action of [INSPECT, WRITE]) {
    const raw = jsonRequest(action);
    const parsed = parseReviewApplyRequest(raw);
    assert.equal(typeof parsed.action, 'string');
    assert.equal(parsed.action, action);
    assert.deepEqual(parsed, raw);
    assert.notStrictEqual(parsed, raw);
    assert.notStrictEqual(parsed.approvalRef, raw.approvalRef);
  }
  const f = fixture();
  assert.equal((await f.service.execute(jsonRequest(INSPECT))).phase, 'ready');
  assert.deepEqual(f.calls, { inspect: 1, commit: 0 });
  assert.equal((await f.service.execute(jsonRequest(WRITE))).phase, 'written');
  assert.equal(f.calls.commit, 1);
  assert.equal((await f.service.execute(jsonRequest(INSPECT))).phase, 'written');
  assert.equal(f.calls.commit, 1, 'a read after commit must not reapply');
});

test('valid write action with a malformed envelope is rejected before any backend call', async () => {
  const valid = request(WRITE);
  const cases = [
    ['protocol array', { ...valid, protocolVersion: ['1.0.0'] }],
    ['approval array', { ...valid, approvalRef: [ref] }],
    ['extra target', { ...valid, projectRoot: 'another-project' }],
    ...Object.keys(ref).map(key => [`array ${key}`, { ...valid, approvalRef: { ...ref, [key]: [ref[key]] } }]),
  ];
  for (const [label, raw] of cases) await assertRejectedBeforeBackend(raw, label);
});

test('malformed commands never join a pending legitimate write', async () => {
  const f = fixture();
  const commit = f.backend.commit;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  f.backend.commit = async () => { entered(); await gate; return commit(); };
  const pending = f.service.execute(request(WRITE));
  await started;
  const before = { ...f.calls };
  try {
    await assert.rejects(f.service.execute(jsonRequest([INSPECT])), { code: 'INVALID_REQUEST' });
    await assert.rejects(f.service.execute(jsonRequest([WRITE])), { code: 'INVALID_REQUEST' });
    assert.deepEqual(f.calls, before, 'invalid commands must not inspect or enter commit');
  } finally { release(); }
  assert.equal((await pending).phase, 'written');
  assert.equal(f.calls.commit, 1);
});

test('client rejects malformed actions before sending any network request', async () => {
  let fetchCalls = 0;
  const client = createReviewApplyClient({ token: 'isolated-boundary-token', fetch: async () => {
    fetchCalls++;
    throw new Error('invalid input reached the transport');
  } });
  for (const [label, action] of invalidActions) {
    await assert.rejects(client.execute(jsonRequest(action)), { code: 'INVALID_REQUEST' }, label);
    assert.equal(fetchCalls, 0, label);
  }
});

test('client JSON transport to the real package service preserves read/write separation', async () => {
  const f = fixture();
  const actions = [];
  const client = createReviewApplyClient({ token: 'isolated-boundary-token', fetch: async (_url, init) => {
    const raw = JSON.parse(init.body);
    actions.push(raw.action);
    const result = await f.service.execute(raw);
    return new Response(JSON.stringify({ ok: true, result }));
  } });
  assert.equal((await client.execute(request(INSPECT))).phase, 'ready');
  assert.equal(f.calls.commit, 0);
  await assert.rejects(client.execute(jsonRequest([INSPECT])), { code: 'INVALID_REQUEST' });
  assert.equal(f.calls.commit, 0);
  assert.equal((await client.execute(request(WRITE))).phase, 'written');
  assert.equal(f.calls.commit, 1);
  assert.equal((await client.execute(request(INSPECT))).phase, 'written');
  assert.equal(f.calls.commit, 1);
  assert.deepEqual(actions, [INSPECT, WRITE, INSPECT]);
});

test('response discriminants also reject array coercion, including written without a commit', async () => {
  const f = fixture();
  const ready = await f.service.execute(request(INSPECT));
  const written = await f.service.execute(request(WRITE));
  const cases = [
    { ...ready, phase: ['ready'], canWrite: false },
    { ...ready, phase: ['written'], canWrite: false },
    { ...ready, currentProject: ['matches-approved-base'] },
    { ...written, commit: { ...written.commit, coordination: ['written'] } },
  ];
  for (const result of cases) {
    let fetchCalls = 0;
    const client = createReviewApplyClient({ token: 'isolated-boundary-token', fetch: async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ ok: true, result }));
    } });
    await assert.rejects(client.execute(request(INSPECT)), /写回状态格式或审阅身份不匹配/);
    assert.equal(fetchCalls, 1, 'invalid responses must not cause an automatic retry');
  }
});
