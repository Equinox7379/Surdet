import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { ReviewApplyController, isReviewApplyRunning } from '../src/review-apply-controller.js';
import { hasPendingReviewReceipt, hasReviewDraft, isReviewReceiptWriting } from '../src/review-workspace.js';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function between(source, begin, end) {
  const start = source.indexOf(begin), finish = source.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) throw new Error(`Missing function boundary: ${begin}`);
  return source.slice(start, finish);
}
const registration = between(main, "window.addEventListener('beforeunload', (e) => {", '\nlet suspendedWorkspaceBaseline:');
function unload(workspace = null, receiptPending = hasPendingReviewReceipt, receiptWriting = isReviewReceiptWriting) {
  let handler, busy;
  vm.runInNewContext(registration, {
    window: { surdetDesktop: { reportUnloadState(value) { busy = value; } }, addEventListener(_type, fn) { handler = fn; } },
    state: { projectLoading: false, projectWriteLock: null, reviewWorkspace: workspace, scenes: new Map(), timelines: [],
      pendingSceneDeletes: [], pendingSceneCommit: null, pendingTimelineDeletes: [], pendingTimelineRestores: new Set() },
    assetImportActionRunning: false, sceneLifecycleActionRunning: false, sceneAutosaveRecoveryPhase: 'idle',
    editorWorkspaceStatus: () => ({ saving: false }), inspectConfigDraftState: () => ({ dirty: false }),
    hasReviewDraft, hasPendingReviewReceipt: receiptPending, isReviewApplyRunning, isReviewReceiptWriting: receiptWriting,
  });
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  handler(event);
  return { busy, prevented: event.prevented };
}
const ref = { resultReviewId: 'result', approvalId: 'approval', approvalFingerprint: 'fixture-only' };
const ready = { protocolVersion: '1.0.0', approvalRef: ref, projectIdentity: 'project', integrationChangeId: 'change',
  targetPath: 'fixture', targetDisplayName: '夹具', changedPaths: [], phase: 'ready', canWrite: true, blockers: [], currentProject: 'matches-approved-base' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('unload retains a pending approved write after its panel is disposed, then releases', async () => {
  const gate = deferred();
  const controller = new ReviewApplyController(ref, request => request.action === 'write-approved-result' ? gate.promise : Promise.resolve(ready), {}, () => {});
  let writing;
  try {
    await controller.check();
    expect(unload()).toEqual({ busy: false, prevented: false });
    writing = controller.write();
    expect(unload()).toEqual({ busy: true, prevented: true });
    controller.dispose();
    expect(unload()).toEqual({ busy: true, prevented: true });
    gate.resolve(ready); await writing;
    expect(unload()).toEqual({ busy: false, prevented: false });
  } finally { gate.resolve(ready); await writing; controller.dispose(); }
});

test('an uncertain write response settles the transport without claiming success or writing twice', async () => {
  const gate = deferred(); let writes = 0;
  const controller = new ReviewApplyController(ref, request => {
    if (request.action !== 'write-approved-result') return Promise.resolve(ready);
    writes++; return gate.promise;
  }, {}, () => {});
  let writing;
  try {
    await controller.check(); writing = controller.write();
    expect(unload()).toEqual({ busy: true, prevented: true });
    gate.reject(new Error('response lost')); await writing;
    expect(controller.snapshot.status.phase).toBe('unknown');
    expect(controller.snapshot.status.canWrite).toBe(false);
    await controller.write(); expect(writes).toBe(1);
    expect(unload()).toEqual({ busy: false, prevented: false });
  } finally { gate.resolve(ready); await writing; controller.dispose(); }
});

test('a terminal receipt remains non-discardable after an uncertain response and clears on definitive rejection', async () => {
  // Execute the actual submission/pending-state functions, with transport failures only.
  // Receipt parsing and integrity are not this case's subject; a success reconciliation must never run.
  const source = readFileSync(new URL('../src/review-workspace.ts', import.meta.url), 'utf8');
  const code = between(source, 'export function hasPendingReviewReceipt(', 'export function hasReviewDraft(')
    + between(source, 'function classifyAuthorityFailure(', 'async function snapshotMatchesCommand(');
  const context = vm.createContext({
    terminalWrites: new Set(), pendingTerminalCommands: new WeakMap(), crypto: globalThis.crypto,
    record: value => value !== null && typeof value === 'object',
    authorityError: (code, message) => Object.assign(new Error(message), { code }),
    terminalClientFor: (_workspace, client) => client,
    reconcileAuthoritySnapshot: () => { throw new Error('Unexpected success reconciliation'); },
    AUTHORITY_UNAVAILABLE: 'unavailable', AUTHORITY_AVAILABLE: 'available', AUTHORITY_MISMATCH: 'mismatch', AUTHORITY_CORRUPT: 'corrupt',
  });
  vm.runInContext(stripTypeScriptTypes(code.replaceAll('export function ', 'function '), { mode: 'transform' }), context);
  const workspace = { authority: { state: 'available' }, identity: { projectIdentity: 'project', reviewId: 'review', payload: { bytes: 1, sha256: 'fixture-only' } } };
  const gate = deferred();
  const pending = context.submitTerminalCommand(workspace, 'result-approval', {}, { write: () => gate.promise });
  const outcome = pending.catch(error => error);
  try {
    expect(unload(workspace, context.hasPendingReviewReceipt)).toEqual({ busy: true, prevented: true });
    expect(unload(null, context.hasPendingReviewReceipt, context.isReviewReceiptWriting)).toEqual({ busy: true, prevented: true });
    gate.reject(Object.assign(new Error('response lost'), { code: 'REQUEST_TIMEOUT' }));
    await outcome;
    expect(context.isReviewReceiptWriting()).toBe(false);
    expect(unload(workspace, context.hasPendingReviewReceipt)).toEqual({ busy: true, prevented: true });
    workspace.authority.state = 'available'; // Existing explicit refresh/retry is a separate contract.
    await expect(context.submitTerminalCommand(workspace, 'result-approval', {}, {
      write: async () => { throw Object.assign(new Error('rejected'), { code: 'INVALID_REQUEST' }); },
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(context.hasPendingReviewReceipt(workspace)).toBe(false);
  } finally { gate.resolve(); await outcome; }
});
