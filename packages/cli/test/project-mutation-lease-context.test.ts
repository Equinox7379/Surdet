import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { ProjectMutationLeaseContext } from '../src/editor-workspace-authority/project-mutation-lease-context.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ProjectMutationLeaseContext', () => {
  it('does not acquire a project lease merely because the authority service is open', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-mutation-lease-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    const manager = new NodeLocalLeaseManager(path.join(root, 'data'));
    const context = await ProjectMutationLeaseContext.open(projectRoot, manager);
    expect((await context.inspect()).state).toBe('free');
  });

  it('holds the shared project lease only while a mutation callback runs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-mutation-lease-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    const manager = new NodeLocalLeaseManager(path.join(root, 'data'));
    const context = await ProjectMutationLeaseContext.open(projectRoot, manager);
    await context.run(async () => {
      await context.assertHeld();
      expect((await context.inspect()).state).toBe('owned');
      await context.run(async () => context.assertHeld());
    });
    expect((await context.inspect()).state).toBe('free');
  });
});
