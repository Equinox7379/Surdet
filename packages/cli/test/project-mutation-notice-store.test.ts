import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectMutationNoticeStore } from '../src/authoring/project-mutation-notice-store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ProjectMutationNoticeStore', () => {
  it('stores only the latest wake-up notice with a monotonic sequence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-mutation-notice-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    const store = new ProjectMutationNoticeStore({ dataRoot: path.join(root, 'data') });
    const first = await store.record(projectRoot, {
      projectRevision: 'a'.repeat(64),
      coordinationRevision: 'c'.repeat(64),
      initiator: 'external-agent',
      changedPaths: ['content/scenario/a.gal'],
      changeId: 'change-a',
    }, () => undefined);
    const second = await store.record(projectRoot, {
      projectRevision: 'b'.repeat(64),
      coordinationRevision: 'd'.repeat(64),
      initiator: 'external-agent',
      changedPaths: ['content/scenario/b.gal'],
      changeId: 'change-b',
    }, () => undefined);
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(await store.readLatest(projectRoot)).toEqual(second);
    expect(second.changedPaths).toEqual(['content/scenario/b.gal']);
  });
});
