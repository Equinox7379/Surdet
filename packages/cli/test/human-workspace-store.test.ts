import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import * as records from '../src/authoring/node-json-record.js';
import { projectIdentityFromRoot } from '../src/authoring/project-identity.js';

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-human-workspace-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(projectRoot);
  return { projectRoot, dataRoot };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('HumanWorkspaceStore', () => {
  it.each([
    ['string generation', { workspaceGeneration: '1' }],
    ['null generation', { workspaceGeneration: null }],
    ['array session identity', { workspaceSessionId: ['11111111-1111-4111-8111-111111111111'] }],
    ['array browser identity', { browserSessionId: ['browser-1'] }],
    ['object dirty scopes', { dirtyScopes: {} }],
    ['string dirty scopes', { dirtyScopes: '' }],
    ['missing dirty scopes', { dirtyScopes: undefined }],
    ['null busy reasons', { busyReasons: null }],
    ['missing busy reasons', { busyReasons: undefined }],
    ['object blocked reasons', { blockedReasons: {} }],
    ['missing blocked reasons', { blockedReasons: undefined }],
    ['array loaded project identity', { loadedProjectRevision: ['a'.repeat(64)] }],
    ['array loaded coordination identity', { loadedCoordinationRevision: ['b'.repeat(64)] }],
    ['null root identity', { projectRootIdentity: null }],
  ])('preserves and blocks a stored record with %s instead of coercing or throwing a raw type error', async (_name, changed) => {
    const value = await fixture();
    const store = new HumanWorkspaceStore({ dataRoot: value.dataRoot });
    const workspaceSessionId = '11111111-1111-4111-8111-111111111111';
    const record = await store.heartbeat(value.projectRoot, {
      workspaceSessionId, browserSessionId: 'browser-1', workspaceGeneration: 1,
      availability: 'clean', loadedProjectRevision: 'a'.repeat(64), loadedCoordinationRevision: 'b'.repeat(64),
    });
    expect((await store.inspect(value.projectRoot)).summary.availability).toBe('clean');
    const file = path.join(value.dataRoot, 'human-workspaces', projectIdentityFromRoot(value.projectRoot), `${workspaceSessionId}.json`);
    const text = JSON.stringify({ ...record, ...changed });
    await fs.writeFile(file, text);
    await expect(store.readSession(value.projectRoot, workspaceSessionId)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
    const inspected = await store.inspect(value.projectRoot);
    expect(inspected.summary.availability).toBe('blocked');
    expect(inspected.summary.blockedReasons).toContain('workspace-state-corrupt');
    expect(await fs.readFile(file, 'utf8')).toBe(text);
  });

  it('serializes independent store writers so an older clean heartbeat cannot erase newer dirty state', async () => {
    const value = await fixture();
    const first = new HumanWorkspaceStore({ dataRoot: value.dataRoot });
    const second = new HumanWorkspaceStore({ dataRoot: value.dataRoot });
    const base = { workspaceSessionId: '11111111-1111-4111-8111-111111111111', browserSessionId: 'browser-1' };
    await first.heartbeat(value.projectRoot, { ...base, workspaceGeneration: 0, availability: 'clean' });
    const replace = records.replaceJsonRecord;
    let release!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { reached = resolve; });
    const spy = vi.spyOn(records, 'replaceJsonRecord').mockImplementation(async (file, record) => {
      if ((record as { workspaceGeneration?: number }).workspaceGeneration === 1) { reached(); await waiting; }
      return replace(file, record);
    });
    try {
      const old = first.heartbeat(value.projectRoot, { ...base, workspaceGeneration: 1, availability: 'clean' });
      await started;
      const current = second.heartbeat(value.projectRoot, { ...base, workspaceGeneration: 2, availability: 'dirty', dirtyScopes: ['scene'] });
      await Promise.race([current, new Promise(resolve => setTimeout(resolve, 100))]);
      release();
      await Promise.all([old, current]);
      expect(await second.readSession(value.projectRoot, base.workspaceSessionId)).toMatchObject({ workspaceGeneration: 2, availability: 'dirty' });
    } finally { release(); spy.mockRestore(); }
  });
  it('keeps active dirty state visible and lets it expire through grace to absent', async () => {
    const value = await fixture();
    let now = Date.parse('2026-09-09T00:00:00.000Z');
    const store = new HumanWorkspaceStore({
      dataRoot: value.dataRoot,
      now: () => now,
      activeWindowMs: 1_000,
      graceWindowMs: 3_000,
    });
    await store.heartbeat(value.projectRoot, {
      workspaceSessionId: '11111111-1111-4111-8111-111111111111',
      browserSessionId: 'browser-1',
      workspaceGeneration: 1,
      availability: 'dirty',
      loadedProjectRevision: 'a'.repeat(64),
      loadedCoordinationRevision: 'b'.repeat(64),
      dirtyScopes: ['scene'],
    });
    expect((await store.inspect(value.projectRoot)).summary.availability).toBe('dirty');
    now += 1_500;
    const grace = await store.inspect(value.projectRoot);
    expect(grace.summary.availability).toBe('blocked');
    expect(grace.summary.blockedReasons).toContain('connection-grace');
    now += 2_000;
    expect((await store.inspect(value.projectRoot)).summary.availability).toBe('absent');
  });

  it('does not allow an older generation to overwrite a newer human state', async () => {
    const value = await fixture();
    const store = new HumanWorkspaceStore({ dataRoot: value.dataRoot });
    const base = {
      workspaceSessionId: '11111111-1111-4111-8111-111111111111',
      browserSessionId: 'browser-1',
      availability: 'dirty' as const,
      dirtyScopes: ['scene'] as const,
    };
    await store.heartbeat(value.projectRoot, { ...base, workspaceGeneration: 2 });
    await expect(store.heartbeat(value.projectRoot, { ...base, workspaceGeneration: 1 }))
      .rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
  });

  it('does not let one clean record hide another dirty record', async () => {
    const value = await fixture();
    const store = new HumanWorkspaceStore({ dataRoot: value.dataRoot });
    await store.heartbeat(value.projectRoot, {
      workspaceSessionId: '11111111-1111-4111-8111-111111111111',
      browserSessionId: 'browser-1',
      workspaceGeneration: 1,
      availability: 'clean',
    });
    await store.heartbeat(value.projectRoot, {
      workspaceSessionId: '22222222-2222-4222-8222-222222222222',
      browserSessionId: 'browser-2',
      workspaceGeneration: 1,
      availability: 'dirty',
      dirtyScopes: ['config'],
    });
    expect((await store.inspect(value.projectRoot)).summary).toMatchObject({
      availability: 'dirty',
      activeSessions: 2,
      dirtyScopes: ['config'],
    });
  });
});
