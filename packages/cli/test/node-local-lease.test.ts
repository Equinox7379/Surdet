import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeRecord } from '@surdet/authoring';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import {
  NodeLocalLeaseManager,
  type LeaseHandle,
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
  it('enforces exclusive ownership, owner-token release, and injected heartbeat scheduling', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-local-lease-owned-'));
    temporaryRoots.push(root);
    const state = makeState();
    const manager = makeManager(root, state);

    const first = await manager.acquire({ scope: 'change', resourceId: 'chg-1' });
    expect(state.heartbeatIntervals).toEqual([2000]);
    await expect(manager.acquire({ scope: 'change', resourceId: 'chg-1' })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });
    await expect(manager.release({ ...first, ownerToken: 'wrong' })).rejects.toMatchObject({ code: 'CHANGE_BUSY' });
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
