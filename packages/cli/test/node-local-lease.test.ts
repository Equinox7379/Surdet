import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoringOperationError, normalizeAuthoringError, type ChangeRecord } from '@surdet/authoring';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import * as jsonRecords from '../src/authoring/node-json-record.js';
import {
  NodeLocalLeaseManager,
  type LeaseHandle,
  type LeaseScope,
  type NodeLocalLeaseManagerOptions,
} from '../src/authoring/node-local-lease.js';

const temporaryRoots: string[] = [];

interface TestClock {
  nowMs: number;
  advance(ms: number): void;
}

interface TestLeaseState {
  hostname: string;
  pid: number;
  alive: Map<number, boolean>;
  clock: TestClock;
  heartbeatIntervals: number[];
  heartbeatCallbacks: Array<() => Promise<void>>;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function activeLockDirectories(root: string): Promise<string[]> {
  const locksRoot = path.join(root, '.locks');
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (entry.name.endsWith('.lock')) found.push(child);
      else await visit(child);
    }
  };
  await visit(locksRoot);
  return found.sort((left, right) => left.localeCompare(right));
}

function makeClock(): TestClock {
  return {
    nowMs: Date.parse('2026-08-24T10:00:00.000Z'),
    advance(ms) {
      this.nowMs += ms;
    },
  };
}

function makeState(): TestLeaseState {
  return {
    hostname: 'surdet-test-host',
    pid: 1001,
    alive: new Map([[1001, true], [1002, true]]),
    clock: makeClock(),
    heartbeatIntervals: [],
    heartbeatCallbacks: [],
  };
}

function makeManager(root: string, state: TestLeaseState, overrides: Partial<NodeLocalLeaseManagerOptions> = {}): NodeLocalLeaseManager {
  return new NodeLocalLeaseManager(root, {
    now: () => state.clock.nowMs,
    hostname: () => state.hostname,
    pid: () => state.pid,
    isProcessAlive: (pid) => state.alive.get(pid) ?? false,
    scheduleHeartbeat: (callback, intervalMs) => {
      state.heartbeatIntervals.push(intervalMs);
      state.heartbeatCallbacks.push(callback);
      return () => {
        const index = state.heartbeatCallbacks.indexOf(callback);
        if (index >= 0) state.heartbeatCallbacks.splice(index, 1);
      };
    },
    ...overrides,
  });
}

async function flushHeartbeats(state: TestLeaseState): Promise<void> {
  await Promise.all(state.heartbeatCallbacks.map((callback) => callback()));
}

function leaseRecord(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    formatVersion: 2,
    recordVersion: 0,
    changeId: 'chg-lease',
    projectRootIdentity: 'lease-project-root',
    baseRevision: 'base-revision',
    workingRevision: 0,
    status: 'OPEN',
    baseFiles: {},
    baseContents: {},
    workingFiles: {},
    operations: {},
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('NodeLocalLeaseManager', () => {
  it('stops renewing its lease even when the release identity read fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-lease-release-read-'));
    temporaryRoots.push(root);
    const state = makeState();
    const manager = makeManager(root, state);
    const lease = await manager.acquire({ scope: 'change', resourceId: 'release-read' });
    const load = vi.spyOn(manager as any, 'loadLease').mockRejectedValueOnce(new AuthoringOperationError('LEASE_CORRUPT', 'test read failure'));
    await expect(lease.release()).rejects.toMatchObject({ code: 'LEASE_CORRUPT' });
    load.mockRestore();
    state.clock.advance(30_000);
    await flushHeartbeats(state);
    expect((await manager.inspect('change', 'release-read')).state).toBe('stale-candidate');
    await lease.release();
    expect((await manager.inspect('change', 'release-read')).state).toBe('free');
  });

  it('preserves both operation and release errors', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-lease-dual-error-'));
    temporaryRoots.push(root);
    const manager = makeManager(root, makeState());
    const operationError = new Error('operation failed');
    const releaseError = new Error('release failed');
    let handle!: LeaseHandle;
    const result = manager.withLease({ scope: 'change', resourceId: 'dual-error' }, async lease => {
      handle = lease;
      vi.spyOn(lease, 'release').mockRejectedValueOnce(releaseError);
      throw operationError;
    });
    await expect(result).rejects.toMatchObject({ errors: [operationError, releaseError], cause: operationError });
    await handle.release();
  });
  it.each([
    ['project', 'C:/canonical/project/root'],
    ['change', 'chg_heartbeat_drain'],
    ['review', 'project-1\u0000review-heartbeat-drain'],
  ] satisfies Array<[LeaseScope, string]>)('serializes and drains an in-flight %s heartbeat before release', async (scope, resourceId) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-local-lease-drain-${scope}-`));
    temporaryRoots.push(root);
    const state = makeState();
    let scheduledHeartbeat: (() => Promise<void>) | undefined;
    const cancelStarted = deferred();
    const cancelMayFinish = deferred();
    const cancelFinished = deferred();
    const manager = makeManager(root, state, {
      scheduleHeartbeat: (callback, intervalMs) => {
        state.heartbeatIntervals.push(intervalMs);
        scheduledHeartbeat = callback;
        return async () => {
          cancelStarted.resolve();
          await cancelMayFinish.promise;
          cancelFinished.resolve();
        };
      },
    });
    const handle = await manager.acquire({ scope, resourceId });
    const heartbeatEntered = deferred();
    const heartbeatMayFinish = deferred();
    const originalAssertOwned = manager.assertOwned.bind(manager);
    let heartbeatStarts = 0;
    let activeHeartbeats = 0;
    let maxActiveHeartbeats = 0;
    manager.assertOwned = async (candidate): Promise<void> => {
      heartbeatStarts += 1;
      activeHeartbeats += 1;
      maxActiveHeartbeats = Math.max(maxActiveHeartbeats, activeHeartbeats);
      heartbeatEntered.resolve();
      await heartbeatMayFinish.promise;
      try {
        await originalAssertOwned(candidate);
      } finally {
        activeHeartbeats -= 1;
      }
    };

    const heartbeat = scheduledHeartbeat;
    if (heartbeat === undefined) throw new Error('heartbeat callback was not scheduled');
    const firstHeartbeat = heartbeat();
    await heartbeatEntered.promise;
    const secondHeartbeat = heartbeat();
    let releasePromise: Promise<void> | undefined;
    try {
      expect(heartbeatStarts, '同一 lease 启动了重叠 heartbeat callback').toBe(1);
      let releaseSettled = false;
      releasePromise = handle.release().then(() => {
        releaseSettled = true;
      });
      await cancelStarted.promise;
      expect(releaseSettled, 'release 在 async cancellation 完成前提前返回').toBe(false);
      cancelMayFinish.resolve();
      await cancelFinished.promise;
      expect(releaseSettled, 'release 在已开始 heartbeat drain 前提前返回').toBe(false);
      heartbeatMayFinish.resolve();
      await Promise.all([firstHeartbeat, secondHeartbeat, releasePromise]);

      expect(maxActiveHeartbeats).toBe(1);
      expect(heartbeatStarts).toBe(1);
      expect(activeHeartbeats).toBe(0);
      expect(await manager.inspect(scope, resourceId)).toMatchObject({ state: 'free' });
      await expect(fsp.access(handle.directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await activeLockDirectories(root)).toEqual([]);

      await heartbeat();
      expect(await manager.inspect(scope, resourceId)).toMatchObject({ state: 'free' });
      await expect(fsp.access(handle.directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await activeLockDirectories(root)).toEqual([]);
    } finally {
      cancelMayFinish.resolve();
      heartbeatMayFinish.resolve();
      await Promise.allSettled([firstHeartbeat, secondHeartbeat]);
      if (releasePromise !== undefined) await Promise.allSettled([releasePromise]);
      else await handle.release().catch(() => undefined);
    }
  });

  it('uses one review namespace across managers while keeping distinct reviews independent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-review-lease-'));
    temporaryRoots.push(root);
    const state = makeState();
    const owner = makeManager(root, state);
    const contender = makeManager(root, { ...state, pid: 1002 });
    const resourceId = 'project-1\u0000review-1';
    const first = await owner.acquire({ scope: 'review', resourceId });

    expect(first.directory).toContain(path.join('.locks', 'reviews'));
    await expect(contender.acquire({ scope: 'review', resourceId })).rejects.toMatchObject({
      code: 'REVIEW_BUSY',
      details: { scope: 'review', resourceId },
    });
    await expect(contender.release({ ...first, ownerToken: 'wrong-owner' })).rejects.toMatchObject({
      code: 'REVIEW_BUSY',
    });
    expect(await contender.inspect('review', resourceId)).toMatchObject({
      state: 'owned',
      scope: 'review',
      resourceId,
      manualRecoveryRequired: false,
    });

    const distinct = await contender.acquire({
      scope: 'review',
      resourceId: 'project-1\u0000review-2',
    });
    expect(distinct.directory).not.toBe(first.directory);
    await distinct.release();
    await first.release();
    expect(await owner.inspect('review', resourceId)).toMatchObject({ state: 'free' });
  });

  it('recovers only a dead same-host review lease and preserves unexpected release evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-review-recovery-'));
    temporaryRoots.push(root);
    const state = makeState();
    const resourceId = 'project-1\u0000review-stale';
    const owner = makeManager(root, state);
    const first = await owner.acquire({ scope: 'review', resourceId });
    state.clock.advance(15_001);
    state.alive.set(1001, false);

    const replacementManager = makeManager(root, { ...state, pid: 1002 });
    const replacement = await replacementManager.acquire({ scope: 'review', resourceId });
    expect(replacement.ownerToken).not.toBe(first.ownerToken);
    const staleRoot = path.join(root, '.locks', 'stale');
    const quarantined = await fsp.readdir(staleRoot, { withFileTypes: true });
    expect(quarantined.filter((entry) => entry.isDirectory())).toHaveLength(1);

    const sentinel = path.join(replacement.directory, 'keep-review-evidence.txt');
    await fsp.writeFile(sentinel, 'keep\n', 'utf8');
    await expect(replacement.release()).rejects.toMatchObject({
      code: 'LEASE_CORRUPT',
      details: { scope: 'review', resourceId, manualRecoveryRequired: true },
    });
    await expect(fsp.readFile(sentinel, 'utf8')).resolves.toBe('keep\n');
    expect(await replacementManager.inspect('review', resourceId)).toMatchObject({ state: 'owned' });
  });

  it('waits through a review publication window and then reports REVIEW_BUSY', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-review-publish-'));
    temporaryRoots.push(root);
    const resourceId = 'project-1\u0000review-publish';
    const lockDirectory = path.join(root, '.locks', 'reviews', 'project-1_review-publish.lock');
    await fsp.mkdir(lockDirectory, { recursive: true });
    const leasePath = path.join(lockDirectory, 'lease.json');
    const state = makeState();
    let polls = 0;
    const contender = makeManager(root, { ...state, pid: 1002 }, {
      publicationDelay: async () => {
        polls += 1;
        if (polls !== 1) return;
        const nowIso = new Date(state.clock.nowMs).toISOString();
        await fsp.writeFile(leasePath, JSON.stringify({
          formatVersion: 1,
          scope: 'review',
          resourceId,
          ownerToken: 'review-owner-token',
          pid: 1001,
          hostname: 'surdet-test-host',
          acquiredAt: nowIso,
          heartbeatAt: nowIso,
        }), 'utf8');
      },
    });

    await expect(contender.acquire({ scope: 'review', resourceId })).rejects.toMatchObject({
      code: 'REVIEW_BUSY',
    });
    expect(polls).toBeGreaterThanOrEqual(1);
    await expect(fsp.access(leasePath)).resolves.toBeUndefined();
    await expect(fsp.readdir(path.join(root, '.locks', 'stale'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries acquisition when an observed review lock is normally released before lease publication is read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-review-release-race-'));
    temporaryRoots.push(root);
    const resourceId = 'project-1\u0000review-release-race';
    const lockDirectory = path.join(root, '.locks', 'reviews', 'project-1_review-release-race.lock');
    await fsp.mkdir(lockDirectory, { recursive: true });
    const state = makeState();
    let polls = 0;
    const manager = makeManager(root, state, {
      publicationDelay: async () => {
        polls += 1;
        if (polls === 1) await fsp.rmdir(lockDirectory);
      },
    });

    const acquired = await manager.acquire({ scope: 'review', resourceId });
    expect(acquired.directory).toBe(lockDirectory);
    expect(polls).toBeGreaterThanOrEqual(1);
    expect(await manager.inspect('review', resourceId)).toMatchObject({ state: 'owned' });
    await acquired.release();
    expect(await manager.inspect('review', resourceId)).toMatchObject({ state: 'free' });
  });

  it('preserves an unexpected lock occupant and reports release cleanup as manual recovery', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-release-evidence-'));
    temporaryRoots.push(root);
    const state = makeState();
    const manager = makeManager(root, state);
    const handle = await manager.acquire({ scope: 'project', resourceId: 'C:/canonical/project/root' });
    const leaseFile = path.join(handle.directory, 'lease.json');
    const leaseBefore = await fsp.readFile(leaseFile);
    const leaseSha256Before = sha256(leaseBefore);
    const sentinel = path.join(handle.directory, 'unexpected-release-evidence.txt');
    const sentinelBefore = Buffer.from('preserve-release-evidence\n', 'utf8');
    const sentinelSha256Before = sha256(sentinelBefore);
    await fsp.writeFile(sentinel, sentinelBefore);

    await expect(handle.release()).rejects.toMatchObject({
      code: 'LEASE_CORRUPT',
      details: {
        manualRecoveryRequired: true,
        path: handle.directory,
      },
    });

    const leaseAfter = await fsp.readFile(leaseFile);
    expect(leaseAfter).toEqual(leaseBefore);
    expect(sha256(leaseAfter)).toBe(leaseSha256Before);
    expect(JSON.parse(leaseAfter.toString('utf8'))).toMatchObject({ ownerToken: handle.ownerToken });
    await expect(fsp.readFile(sentinel)).resolves.toEqual(sentinelBefore);
    expect(sha256(await fsp.readFile(sentinel))).toBe(sentinelSha256Before);
    await expect(fsp.access(handle.directory)).resolves.toBeUndefined();
    expect((await fsp.readdir(handle.directory)).sort()).toEqual(['lease.json', 'unexpected-release-evidence.txt']);
    expect((await manager.inspect('project', 'C:/canonical/project/root')).state).toBe('owned');
  });

  it('enforces exclusive ownership, owner-token release, and injected heartbeat scheduling', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-owned-'));
    temporaryRoots.push(root);
    const state = makeState();
    const manager = makeManager(root, state);

    const first = await manager.acquire({ scope: 'change', resourceId: 'chg-1' });
    expect(state.heartbeatIntervals).toEqual([2000]);
    await expect(manager.acquire({ scope: 'change', resourceId: 'chg-1' })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });
    const leaseFile = path.join(first.directory, 'lease.json');
    const ownerLeaseBefore = await fsp.readFile(leaseFile);
    await expect(manager.release({ ...first, ownerToken: 'wrong' })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });
    await expect(fsp.readFile(leaseFile)).resolves.toEqual(ownerLeaseBefore);
    expect(JSON.parse((await fsp.readFile(leaseFile)).toString('utf8'))).toMatchObject({ ownerToken: first.ownerToken });
    expect(await manager.inspect('change', 'chg-1')).toMatchObject({ state: 'owned', manualRecoveryRequired: false });

    const beforeHeartbeat = (await manager.inspect('change', 'chg-1')).holder?.heartbeatAt;
    state.clock.advance(2000);
    await flushHeartbeats(state);
    const afterHeartbeat = (await manager.inspect('change', 'chg-1')).holder?.heartbeatAt;
    expect(afterHeartbeat).not.toBe(beforeHeartbeat);

    await first.release();
    expect(await manager.inspect('change', 'chg-1')).toMatchObject({ state: 'free' });
  });

  it('takes over only a same-host stale lease with a dead PID and quarantines the old directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-takeover-'));
    temporaryRoots.push(root);
    const state = makeState();
    const firstManager = makeManager(root, state);
    const first = await firstManager.acquire({ scope: 'change', resourceId: 'chg-stale' });
    state.clock.advance(15_001);
    state.alive.set(state.pid, false);

    const secondManager = makeManager(root, { ...state, pid: 1002 });
    const replacement = await secondManager.acquire({ scope: 'change', resourceId: 'chg-stale' });
    expect(replacement.ownerToken).not.toBe(first.ownerToken);
    expect(await secondManager.inspect('change', 'chg-stale')).toMatchObject({ state: 'owned' });

    const staleRoot = path.join(root, '.locks', 'stale');
    const quarantined = await fsp.readdir(staleRoot, { withFileTypes: true });
    expect(quarantined.filter((entry) => entry.isDirectory())).toHaveLength(1);
    const quarantinedLease = path.join(staleRoot, quarantined[0]!.name, 'lease.json');
    expect(JSON.parse(await fsp.readFile(quarantinedLease, 'utf8'))).toMatchObject({
      ownerToken: first.ownerToken,
      pid: 1001,
    });

    await replacement.release();
  });

  it.each([
    ['change', false], ['project', false], ['review', true], ['workspace', true],
  ] as const)('does not let a delayed %s stale contender retire a live successor (reacquired=%s)', async (scope, reacquire) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-race-'));
    temporaryRoots.push(root);
    const state = makeState();
    const resourceId = scope === 'project' ? root : 'stale-race';
    const original = await makeManager(root, state).acquire({ scope, resourceId });
    state.clock.advance(15_001);
    state.alive.set(1001, false);
    const slowEntered = deferred();
    const resumeSlow = deferred();
    const slowManager = makeManager(root, { ...state, pid: 1003 }, {
      isProcessAlive: async pid => {
        expect(pid).toBe(1001);
        slowEntered.resolve();
        await resumeSlow.promise;
        return false;
      },
    });
    const slowResult = slowManager.acquire({ scope, resourceId }).then(
      lease => ({ lease, error: undefined }),
      error => ({ lease: undefined, error }),
    );
    await slowEntered.promise;
    const fastManager = makeManager(root, { ...state, pid: 1002 });
    let successor = await fastManager.acquire({ scope, resourceId });
    await fastManager.assertOwned(successor);
    if (reacquire) {
      await successor.release();
      successor = await fastManager.acquire({ scope, resourceId });
    }
    resumeSlow.resolve();
    const outcome = await slowResult;
    expect(outcome.lease, 'a stale observation must not grant a second lease').toBeUndefined();
    expect(outcome.error).toMatchObject({ code: scope === 'change' ? 'CHANGE_BUSY' : scope === 'review' ? 'REVIEW_BUSY' : 'PROJECT_BUSY' });
    await fastManager.assertOwned(successor);
    const retired = await fsp.readdir(path.join(root, '.locks', 'stale'));
    expect(retired).toHaveLength(1);
    expect(JSON.parse(await fsp.readFile(path.join(root, '.locks', 'stale', retired[0]!, 'lease.json'), 'utf8')))
      .toMatchObject({ ownerToken: original.ownerToken, pid: 1001 });
    await successor.release();
  });

  it('can retire successive dead owners while retaining each old lease', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-successive-'));
    temporaryRoots.push(root);
    const state = makeState();
    const first = await makeManager(root, state).acquire({ scope: 'change', resourceId: 'successive' });
    state.clock.advance(15_001);
    state.alive.set(1001, false);
    const second = await makeManager(root, { ...state, pid: 1002 }).acquire({ scope: 'change', resourceId: 'successive' });
    state.clock.advance(15_001);
    state.alive.set(1002, false);
    const thirdManager = makeManager(root, { ...state, pid: 1003 });
    const third = await thirdManager.acquire({ scope: 'change', resourceId: 'successive' });
    const staleRoot = path.join(root, '.locks', 'stale');
    const retired = await fsp.readdir(staleRoot);
    expect(retired).toHaveLength(2);
    const records = await Promise.all(retired.map(async entry => JSON.parse(await fsp.readFile(path.join(staleRoot, entry, 'lease.json'), 'utf8'))));
    expect(records.map(record => record.ownerToken).sort()).toEqual([first.ownerToken, second.ownerToken].sort());
    await thirdManager.assertOwned(third);
    await third.release();
  });

  it('waits for the live successor publication after losing a stale takeover race', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-race-publish-'));
    temporaryRoots.push(root);
    const state = makeState();
    const resourceId = 'stale-publication';
    const original = await makeManager(root, state).acquire({ scope: 'change', resourceId });
    state.clock.advance(15_001);
    state.alive.set(1001, false);
    const slowEntered = deferred();
    const resumeSlow = deferred();
    const publicationEntered = deferred();
    const mayPublish = deferred();
    const pollEntered = deferred();
    const mayReadPublished = deferred();
    const slowManager = makeManager(root, { ...state, pid: 1003 }, {
      isProcessAlive: async () => {
        slowEntered.resolve();
        await resumeSlow.promise;
        return false;
      },
      publicationDelay: async () => {
        pollEntered.resolve();
        await mayReadPublished.promise;
      },
    });
    const slowResult = slowManager.acquire({ scope: 'change', resourceId }).then(
      lease => ({ lease, error: undefined }), error => ({ lease: undefined, error }),
    );
    await slowEntered.promise;
    const create = jsonRecords.createJsonRecord;
    const publishing = vi.spyOn(jsonRecords, 'createJsonRecord').mockImplementation(async (file, value) => {
      publicationEntered.resolve();
      await mayPublish.promise;
      return create(file, value);
    });
    try {
      const fastManager = makeManager(root, { ...state, pid: 1002 });
      const fastResult = fastManager.acquire({ scope: 'change', resourceId });
      await publicationEntered.promise;
      resumeSlow.resolve();
      await pollEntered.promise;
      expect(await fsp.readdir(original.directory)).toEqual([]);
      mayPublish.resolve();
      const successor = await fastResult;
      mayReadPublished.resolve();
      const outcome = await slowResult;
      expect(outcome.lease).toBeUndefined();
      expect(outcome.error).toMatchObject({ code: 'CHANGE_BUSY', details: { manualRecoveryRequired: false } });
      await fastManager.assertOwned(successor);
      expect(await fsp.readdir(path.join(root, '.locks', 'stale'))).toHaveLength(1);
      await successor.release();
    } finally {
      resumeSlow.resolve();
      mayPublish.resolve();
      mayReadPublished.resolve();
      publishing.mockRestore();
    }
  });

  it.each(['before-retirement', 'before-publication'] as const)('preserves lease evidence on a %s failure', async phase => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-interrupted-'));
    temporaryRoots.push(root);
    const state = makeState();
    const resourceId = 'interrupted';
    const original = await makeManager(root, state).acquire({ scope: 'change', resourceId });
    state.clock.advance(15_001);
    state.alive.set(1001, false);
    const interrupted = Object.assign(new Error(`test ${phase} EIO`), { code: 'EIO' });
    const contender = makeManager(root, { ...state, pid: 1002 }, {
      ...(phase === 'before-retirement' ? { isProcessAlive: async () => { throw interrupted; } } : {}),
    });
    const publishing = phase === 'before-publication'
      ? vi.spyOn(jsonRecords, 'createJsonRecord').mockRejectedValueOnce(interrupted) : undefined;
    try {
      await expect(contender.acquire({ scope: 'change', resourceId })).rejects.toBe(interrupted);
    } finally {
      publishing?.mockRestore();
    }
    const staleRoot = path.join(root, '.locks', 'stale');
    if (phase === 'before-retirement') {
      expect(JSON.parse(await fsp.readFile(path.join(original.directory, 'lease.json'), 'utf8')))
        .toMatchObject({ ownerToken: original.ownerToken });
      await expect(fsp.readdir(staleRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      const retired = await fsp.readdir(staleRoot);
      expect(retired).toHaveLength(1);
      expect(JSON.parse(await fsp.readFile(path.join(staleRoot, retired[0]!, 'lease.json'), 'utf8')))
        .toMatchObject({ ownerToken: original.ownerToken });
      expect(await fsp.readdir(original.directory)).toEqual([]);
      const next = makeManager(root, { ...state, pid: 1003 }, { publicationDelay: async () => undefined });
      await expect(next.acquire({ scope: 'change', resourceId })).rejects.toMatchObject({
        code: 'LEASE_CORRUPT', details: { manualRecoveryRequired: true },
      });
      expect(await fsp.readdir(staleRoot)).toEqual(retired);
    }
  });

  it('blocks alive, foreign-host, fresh, and corrupt leases without deleting evidence', async () => {
    const cases = [
      { suffix: 'alive', configure: (state: TestLeaseState) => { state.clock.advance(15_001); } },
      { suffix: 'foreign', configure: (state: TestLeaseState) => { state.hostname = 'other-host'; } },
      { suffix: 'fresh', configure: (state: TestLeaseState) => { state.clock.advance(1_000); state.alive.set(1001, false); } },
    ] as const;

    for (const item of cases) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-local-lease-${item.suffix}-`));
      temporaryRoots.push(root);
      const state = makeState();
      if (item.suffix === 'foreign') state.hostname = 'other-host';
      const first = await makeManager(root, state).acquire({ scope: 'change', resourceId: `chg-${item.suffix}` });
      if (item.suffix === 'alive') state.alive.set(1001, true);
      item.configure(state);
      const contender = makeManager(root, { ...state, pid: 1002, hostname: 'surdet-test-host' });
      await expect(contender.acquire({ scope: 'change', resourceId: `chg-${item.suffix}` })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });
      const inspection = await contender.inspect('change', `chg-${item.suffix}`);
      expect(inspection.state).toBe(item.suffix === 'foreign' ? 'foreign-host' : item.suffix === 'fresh' ? 'owned' : 'stale-candidate');
      expect(await fsp.stat(first.directory)).toBeDefined();
    }

    const corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-corrupt-'));
    temporaryRoots.push(corruptRoot);
    const corruptDirectory = path.join(corruptRoot, '.locks', 'changes', 'chg-corrupt.lock');
    await fsp.mkdir(corruptDirectory, { recursive: true });
    const corruptLease = path.join(corruptDirectory, 'lease.json');
    await fsp.writeFile(corruptLease, '{broken\n', 'utf8');
    const corruptManager = makeManager(corruptRoot, makeState());
    await expect(corruptManager.acquire({ scope: 'change', resourceId: 'chg-corrupt' })).rejects.toMatchObject({ code: 'LEASE_CORRUPT' });
    expect(await corruptManager.inspect('change', 'chg-corrupt')).toMatchObject({ state: 'corrupt', manualRecoveryRequired: true });
    expect(await fsp.readFile(corruptLease, 'utf8')).toBe('{broken\n');
    await expect(fsp.readdir(path.join(corruptRoot, '.locks', 'stale'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('waits through the lock-publication window and then reports the real owner as busy', async () => {
    // W5-GATE-LEASE-PUBLISH-1: the holder publishes the final .lock directory before
    // lease.json lands. A contender hitting that window must wait bounded, not fail loud.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-publish-'));
    temporaryRoots.push(root);
    const lockDirectory = path.join(root, '.locks', 'changes', 'chg-pub.lock');
    await fsp.mkdir(lockDirectory, { recursive: true });
    const leasePath = path.join(lockDirectory, 'lease.json');

    const state = makeState();
    const pollCalls: number[] = [];
    const manager = makeManager(root, state, {
      pid: () => 1002,
      publicationDelay: async () => {
        pollCalls.push(pollCalls.length + 1);
        if (pollCalls.length === 1) {
          // Holder completes publication right after the contender's first read.
          const nowIso = new Date(state.clock.nowMs).toISOString();
          await fsp.writeFile(leasePath, JSON.stringify({
            formatVersion: 1,
            scope: 'change',
            resourceId: 'chg-pub',
            ownerToken: 'owner-token-1',
            pid: 1001,
            hostname: 'surdet-test-host',
            acquiredAt: nowIso,
            heartbeatAt: nowIso,
          } satisfies Record<string, unknown>), 'utf8');
        }
      },
    } satisfies NodeLocalLeaseManagerOptions);

    const failure = await manager.acquire({ scope: 'change', resourceId: 'chg-pub' }).then(
      () => null,
      (error: unknown) => error as { code?: string; details?: Record<string, unknown> },
    );
    expect(failure?.code).toBe('CHANGE_BUSY');
    expect(pollCalls.length).toBeGreaterThanOrEqual(1);
    // The published lease and its directory must survive untouched: no takeover, no quarantine.
    expect(await fsp.stat(lockDirectory)).toBeDefined();
    const published = JSON.parse(await fsp.readFile(leasePath, 'utf8')) as { ownerToken?: string };
    expect(published['ownerToken']).toBe('owner-token-1');
    await expect(fsp.readdir(path.join(root, '.locks', 'stale'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries a structured lease read-replacement race instead of reporting corruption', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-read-race-'));
    temporaryRoots.push(root);
    const resourceId = 'chg-read-race';
    const lockDirectory = path.join(root, '.locks', 'changes', `${resourceId}.lock`);
    const leasePath = path.join(lockDirectory, 'lease.json');
    await fsp.mkdir(lockDirectory, { recursive: true });
    const state = makeState();
    const lease = {
      formatVersion: 1,
      scope: 'change',
      resourceId,
      ownerToken: 'owner-token-read-race',
      pid: 1001,
      hostname: state.hostname,
      acquiredAt: new Date(state.clock.nowMs).toISOString(),
      heartbeatAt: new Date(state.clock.nowMs).toISOString(),
    };
    await fsp.writeFile(leasePath, JSON.stringify(lease), 'utf8');
    let reads = 0;
    const manager = makeManager(root, state, {
      readLeaseRecord: async (file) => {
        reads += 1;
        if (reads === 1) {
          throw new AuthoringOperationError('CHANGE_STORE_CORRUPT', 'JSON record 读取期间发生替换', { path: file });
        }
        return { value: JSON.parse(await fsp.readFile(file, 'utf8')) as unknown };
      },
      publicationDelay: async () => undefined,
    });

    await expect(manager.acquire({ scope: 'change', resourceId })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });
    expect(reads).toBe(2);
    expect(await fsp.readFile(leasePath, 'utf8')).toBe(JSON.stringify(lease));
  });

  it('allows a durable publication to exceed the former 100 ms window', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-slow-publish-'));
    temporaryRoots.push(root);
    const resourceId = 'project-1\u0000review-slow-publish';
    const lockDirectory = path.join(root, '.locks', 'reviews', 'project-1_review-slow-publish.lock');
    await fsp.mkdir(lockDirectory, { recursive: true });
    const leasePath = path.join(lockDirectory, 'lease.json');
    const state = makeState();
    let polls = 0;
    const manager = makeManager(root, { ...state, pid: 1002 }, {
      publicationDelay: async () => {
        polls += 1;
        if (polls !== 12) return;
        const nowIso = new Date(state.clock.nowMs).toISOString();
        await fsp.writeFile(leasePath, JSON.stringify({
          formatVersion: 1,
          scope: 'review',
          resourceId,
          ownerToken: 'review-owner-token',
          pid: 1001,
          hostname: 'surdet-test-host',
          acquiredAt: nowIso,
          heartbeatAt: nowIso,
        }), 'utf8');
      },
    });

    await expect(manager.acquire({ scope: 'review', resourceId })).rejects.toMatchObject({
      code: 'REVIEW_BUSY',
    });
    expect(polls).toBe(12);
    await expect(fsp.access(leasePath)).resolves.toBeUndefined();
  });

  it('keeps fail-loud semantics once the bounded publication budget is exhausted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-missing-'));
    temporaryRoots.push(root);
    const lockDirectory = path.join(root, '.locks', 'changes', 'chg-missing.lock');
    await fsp.mkdir(lockDirectory, { recursive: true });

    const state = makeState();
    let polls = 0;
    const manager = makeManager(root, state, {
      pid: () => 1002,
      publicationDelay: async () => {
        polls += 1;
      },
    } satisfies NodeLocalLeaseManagerOptions);

    const failure = await manager.acquire({ scope: 'change', resourceId: 'chg-missing' }).then(
      () => null,
      (error: unknown) => error as { code?: string; details?: Record<string, unknown> },
    );
    expect(failure?.code).toBe('LEASE_CORRUPT');
    expect(failure?.details?.['manualRecoveryRequired']).toBe(true);
    // Bounded waiting actually happened before giving up.
    expect(polls).toBeGreaterThanOrEqual(1);
    // Directory evidence is preserved for manual inspection.
    expect(await fsp.stat(lockDirectory)).toBeDefined();
  });

  it('does not retry parse failures or invalid lease fields behind the publication wait', async () => {
    const cases = [
      { suffix: 'malformed', body: '{broken\n' },
      { suffix: 'bad-fields', body: JSON.stringify({ formatVersion: 99, scope: 'change', resourceId: 'chg-shape' }) },
      {
        suffix: 'identity-mismatch',
        body: JSON.stringify({
          formatVersion: 1, scope: 'project', resourceId: 'some-project',
          ownerToken: 'tok', pid: 1001, hostname: 'surdet-test-host',
          acquiredAt: new Date(makeClock().nowMs).toISOString(),
          heartbeatAt: new Date(makeClock().nowMs).toISOString(),
        }),
      },
    ] as const;

    for (const item of cases) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-local-lease-shape-${item.suffix}-`));
      temporaryRoots.push(root);
      const lockDirectory = path.join(root, '.locks', 'changes', `chg-shape-${item.suffix}.lock`);
      await fsp.mkdir(lockDirectory, { recursive: true });
      const leasePath = path.join(lockDirectory, 'lease.json');
      await fsp.writeFile(leasePath, item.body, 'utf8');

      const state = makeState();
      let polls = 0;
      const manager = makeManager(root, state, {
        pid: () => 1002,
          publicationDelay: async () => {
          polls += 1;
        },
      } satisfies NodeLocalLeaseManagerOptions);

      const failure = await manager.acquire({ scope: 'change', resourceId: `chg-shape-${item.suffix}` }).then(
        () => null,
        (error: unknown) => error as { code?: string },
      );
      expect(failure?.code, item.suffix).toBe('LEASE_CORRUPT');
      expect(polls, `${item.suffix} must not enter the publication wait`).toBe(0);
      expect(await fsp.readFile(leasePath, 'utf8'), item.suffix).toBe(item.body);
    }
  });

  it('keeps the process alive while the default publication delay timer is awaited', async () => {
    // W5-GATE-LEASE-WAIT-LIVENESS-2: an unref'd publication-wait timer lets the event
    // loop drain while acquire() is still awaited, so a worker can exit early. The
    // contract is that awaiting the DEFAULT delay must keep the task resumable.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-liveness-'));
    temporaryRoots.push(scratch);
    const projectRoot = path.join(scratch, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    const markerPath = path.join(scratch, 'marker.txt');
    const managerModule = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../dist/authoring/node-local-lease.js',
    );
    const probePath = path.join(scratch, 'probe.mjs');
    fs.writeFileSync(probePath, [
      "import * as fs from 'node:fs';",
      "import * as path from 'node:path';",
      "const [projectRoot, markerPath, managerUrl] = process.argv.slice(2);",
      "fs.mkdirSync(path.join(projectRoot, '.locks', 'changes', 'chg-live.lock'), { recursive: true });",
      "const { NodeLocalLeaseManager } = await import(managerUrl);",
      'const manager = new NodeLocalLeaseManager(projectRoot);',
      'try {',
      "  await manager.acquire({ scope: 'change', resourceId: 'chg-live' });",
      "  fs.writeFileSync(markerPath, 'ACQUIRED');",
      '} catch (error) {',
      "  fs.writeFileSync(markerPath, String(error && error.code ? error.code : 'UNKNOWN'));",
      '}',
      'process.exit(0);',
      '',
    ].join('\n'), 'utf8');

    const child = spawn(process.execPath, [probePath, projectRoot, markerPath, `file://${managerModule.split(path.sep).join('/')}`], {
      stdio: 'ignore',
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? -1));
    });

    // The child must run to completion and report the lease verdict itself; an
    // unref'd wait timer would let it exit before the marker is ever written.
    expect(exitCode).toBe(0);
    expect(fs.existsSync(markerPath), 'child exited before the awaited publication delay resolved').toBe(true);
    expect(fs.readFileSync(markerPath, 'utf8')).toBe('LEASE_CORRUPT');
  });

  it('uses the project scope lock namespace and releases it through withProjectLease', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-project-'));
    temporaryRoots.push(root);
    const state = makeState();
    const manager = makeManager(root, state);
    await manager.withProjectLease('project-root-identity', async (lease) => {
      expect(lease.scope).toBe('project');
      expect(lease.resourceId).toBe('project-root-identity');
      expect(path.dirname(lease.directory)).toBe(path.join(root, '.locks', 'projects'));
      expect(await manager.inspect('project', 'project-root-identity')).toMatchObject({ state: 'owned' });
    });
    expect(await manager.inspect('project', 'project-root-identity')).toMatchObject({ state: 'free' });
  });
});

describe('NodeChangeStore lease binding', () => {
  it('keeps primary recovery across nested change and project lease failures', async () => {
    const manager = new NodeLocalLeaseManager('unused-for-injected-nested-lease');
    const operation = new AuthoringOperationError('COMMIT_RECOVERY_FAILED', 'commit recovery failed', { journal: 'pending' });
    const released: string[] = [];
    const acquire = vi.spyOn(manager, 'acquire').mockImplementation(async ({ scope }) => ({
      release: async () => { released.push(scope); throw new AuthoringOperationError('LEASE_CORRUPT', `${scope} release failed`); },
    } as unknown as LeaseHandle));
    try {
      const error = await manager.withLease({ scope: 'project', resourceId: 'project' }, () =>
        manager.withLease({ scope: 'change', resourceId: 'change' }, async () => { throw operation; }))
        .then(() => { throw new Error('expected failure'); }, error => error);
      expect(released).toEqual(['change', 'project']);
      expect(normalizeAuthoringError(error)).toMatchObject({
        code: 'COMMIT_RECOVERY_FAILED', retryDisposition: 'manual-recovery', details: { journal: 'pending', causes: [
          expect.objectContaining({ code: 'COMMIT_RECOVERY_FAILED' }),
          expect.objectContaining({ message: 'change release failed' }), expect.objectContaining({ message: 'project release failed' }),
        ] },
      });
    } finally { acquire.mockRestore(); }
  });

  it('keeps manual recovery classification when withLease operation and release both fail', async () => {
    const manager = new NodeLocalLeaseManager('unused-for-injected-lease');
    const operation = new AuthoringOperationError('COMMIT_RECOVERY_FAILED', 'commit recovery failed');
    const releaseError = new AuthoringOperationError('LEASE_CORRUPT', 'lease release failed');
    const release = vi.fn(async () => { throw releaseError; });
    const acquire = vi.spyOn(manager, 'acquire').mockResolvedValue({ release } as unknown as LeaseHandle);
    try {
      const error = await manager.withLease({ scope: 'change', resourceId: 'case' }, async () => { throw operation; })
        .then(() => { throw new Error('expected failure'); }, error => error);
      expect(release).toHaveBeenCalledOnce();
      expect(normalizeAuthoringError(error)).toMatchObject({
        code: 'COMMIT_RECOVERY_FAILED', retryDisposition: 'manual-recovery', details: { causes: [
          expect.objectContaining({ code: 'COMMIT_RECOVERY_FAILED' }), expect.objectContaining({ code: 'LEASE_CORRUPT' }),
        ] },
      });
    } finally { acquire.mockRestore(); }
  });

  it('keeps reads available, rejects unbound mutation, and reuses one lease in the callback', async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-change-lease-store-'));
    temporaryRoots.push(dataRoot);
    const previousDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;
    try {
      const rootIdentity = 'lease-project-root';
      const store = await NodeChangeStore.forProject(rootIdentity);
      await store.create(leaseRecord({ projectRootIdentity: rootIdentity }));
      const current = await store.read('chg-lease');
      expect(current).toMatchObject({ changeId: 'chg-lease', recordVersion: 0 });
      await expect(store.write({ ...current!, recordVersion: 1 }, {
        expectedRecordVersion: 0,
        expectedStatus: 'OPEN',
      })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });

      const result = await NodeChangeStore.withChangeLease('chg-lease', async (leased) => {
        const before = await leased.read('chg-lease');
        await leased.write({ ...before!, recordVersion: 1, workingRevision: 1 }, {
          expectedRecordVersion: 0,
          expectedStatus: 'OPEN',
        });
        return leased.read('chg-lease');
      });
      expect(result).toMatchObject({ recordVersion: 1, workingRevision: 1 });
    } finally {
      if (previousDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataRoot;
    }
  });
});
