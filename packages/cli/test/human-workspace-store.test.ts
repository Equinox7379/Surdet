import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';

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
