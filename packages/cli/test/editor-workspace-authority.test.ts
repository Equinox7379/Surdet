import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorWorkspaceAuthority } from '../src/editor-workspace-authority/editor-workspace-authority.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { ProjectMutationNoticeStore } from '../src/authoring/project-mutation-notice-store.js';

const roots: string[] = [];
const authorities: EditorWorkspaceAuthority[] = [];
const identity = { workspaceSessionId: 'a09f537a-aa25-4e5f-9d64-901cb62fd8c1', browserSessionId: 'workspace-authority-test' };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-editor-workspace-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(path.join(project, 'content/scenario'), { recursive: true });
  await fs.writeFile(path.join(project, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }));
  await fs.writeFile(path.join(project, 'content/scenario/start.gal'), '@scene start\n凛：原始内容。\n@end\n');
  return { project: await fs.realpath(project), dataRoot: path.join(root, 'data') };
}

afterEach(async () => {
  for (const authority of authorities.splice(0)) await authority.close();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('bound Editor write settlement', () => {
  it('normal service shutdown releases only its own workspace sessions so reopening can save immediately', async () => {
    const { project, dataRoot } = await fixture();
    const manager = new NodeLocalLeaseManager(dataRoot);
    const first = new EditorWorkspaceAuthority(project, { leaseManager: manager });
    const other = new EditorWorkspaceAuthority(project, { leaseManager: manager });
    authorities.push(first, other);
    const state = { ...identity, workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
    await first.heartbeat(state);
    await other.heartbeat({ ...state, workspaceSessionId: 'b09f537a-aa25-4e5f-9d64-901cb62fd8c1', browserSessionId: 'other-editor' });
    await first.close();
    expect((await other.snapshot()).humanWorkspace.activeSessions).toBe(1);
    await other.close();
    const reopened = new EditorWorkspaceAuthority(project, { leaseManager: manager });
    authorities.push(reopened);
    const next = { ...state, workspaceSessionId: 'c09f537a-aa25-4e5f-9d64-901cb62fd8c1', browserSessionId: 'reopened-editor' };
    await reopened.heartbeat(next);
    const { diskBaseline } = await reopened.snapshot();
    const begun = await reopened.beginWrite({ ...next, purpose: 'save-all', expectedProjectRevision: diskBaseline.projectRevision, expectedCoordinationRevision: diskBaseline.coordinationRevision });
    expect(begun.writeLeaseId).toBeTruthy();
  });
  it.each(['modified', 'deleted', 'created'] as const)('preserves a target %s externally while its Editor text is staged', async change => {
    const { project, dataRoot } = await fixture();
    const authority = new EditorWorkspaceAuthority(project, { leaseManager: new NodeLocalLeaseManager(dataRoot) });
    authorities.push(authority);
    const { diskBaseline } = await authority.snapshot();
    const state = { ...identity, workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
    await authority.heartbeat(state);
    const begun = await authority.beginWrite({ ...state, purpose: 'save-all', expectedProjectRevision: diskBaseline.projectRevision,
      expectedCoordinationRevision: diskBaseline.coordinationRevision });
    const file = change === 'created' ? 'content/scenario/new.gal' : 'content/scenario/start.gal';
    const external = '@scene start\n旁白：暂存期间的外部版本必须保留。\n@end\n';
    const stage = NodeProjectStorage.prototype.stageText;
    vi.spyOn(NodeProjectStorage.prototype, 'stageText').mockImplementation(async function (this: NodeProjectStorage, target, text, id) {
      const staged = await stage.call(this, target, text, id);
      if (change === 'deleted') await fs.unlink(path.join(project, target));
      else await fs.writeFile(path.join(project, target), external, change === 'created' ? { flag: 'wx' } : {});
      return staged;
    });
    await expect(authority.publishFile({ ...state, writeLeaseId: begun.writeLeaseId, path: file,
      expectedSha256: diskBaseline.files.find(entry => entry.path === file)?.sha256 ?? null,
      text: '@scene start\n旧草稿不应覆盖外部版本。\n@end\n' })).rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
    if (change === 'deleted') await expect(fs.readFile(path.join(project, file))).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await fs.readFile(path.join(project, file), 'utf8')).toBe(external);
    expect((await fs.readdir(path.join(project, 'content/scenario'))).some(name => name.startsWith('.surdet-'))).toBe(false);
  });

  it('continues ordinary writes from a scene batch receipt and still rejects a real external edit', async () => {
    const { project, dataRoot } = await fixture();
    const authority = new EditorWorkspaceAuthority(project, { leaseManager: new NodeLocalLeaseManager(dataRoot) });
    authorities.push(authority);
    const { diskBaseline } = await authority.snapshot();
    const state = { ...identity, workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
    await authority.heartbeat(state);
    const begun = await authority.beginWrite({ ...state, purpose: 'save-all', expectedProjectRevision: diskBaseline.projectRevision, expectedCoordinationRevision: diskBaseline.coordinationRevision });
    const input = { ...state, writeLeaseId: begun.writeLeaseId };
    const file = 'game.config.json';
    await authority.withWriteLease(input, async () => {
      await fs.writeFile(path.join(project, file), '{"entryScene":"new"}');
      const written = await (await NodeProjectStorage.open(project)).readText(file);
      authority.recordSceneCommit(input, { writes: [{ path: file, sha256: written.sha256 }], deletedPaths: [] });
    });
    const before = await (await NodeProjectStorage.open(project)).readText(file);
    const saved = await authority.publishFile({ ...input, path: file, expectedSha256: before.sha256, text: '{"entryScene":"new","variables":{}}' });
    await fs.writeFile(path.join(project, file), '{"external":true}');
    await expect(authority.publishFile({ ...input, path: file, expectedSha256: saved.sha256, text: '{}' })).rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
    expect(await fs.readFile(path.join(project, file), 'utf8')).toBe('{"external":true}');
    await authority.finishWrite({ ...input, availability: 'clean', dirtyScopes: [] });
  });
  it('keeps baseline inspection and a completed save usable when optional notice storage fails', async () => {
    const { project, dataRoot } = await fixture();
    const noticeStore = new ProjectMutationNoticeStore({ dataRoot });
    vi.spyOn(noticeStore, 'readLatest').mockRejectedValue(new Error('private notice path'));
    vi.spyOn(noticeStore, 'record').mockRejectedValue(new Error('private notice path'));
    const authority = new EditorWorkspaceAuthority(project, { leaseManager: new NodeLocalLeaseManager(dataRoot), noticeStore });
    authorities.push(authority);
    const snapshot = await authority.snapshot();
    expect(snapshot.mutationNotice).toBeNull();
    const state = { ...identity, workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
    await authority.heartbeat(state);
    const begun = await authority.beginWrite({ ...state, purpose: 'save-all', expectedProjectRevision: snapshot.diskBaseline.projectRevision,
      expectedCoordinationRevision: snapshot.diskBaseline.coordinationRevision });
    await authority.publishFile({ ...state, writeLeaseId: begun.writeLeaseId, path: 'content/scenario/start.gal', text: '成功保存。',
      expectedSha256: snapshot.diskBaseline.files.find(file => file.path === 'content/scenario/start.gal')!.sha256 });
    const finished = await authority.finishWrite({ ...state, writeLeaseId: begun.writeLeaseId, availability: 'clean', dirtyScopes: [] });
    expect(finished.mutationNotice.status).toBe('unavailable');
    expect(JSON.stringify(finished)).not.toContain('private notice path');
    expect(await fs.readFile(path.join(project, 'content/scenario/start.gal'), 'utf8')).toBe('成功保存。');
    expect((await authority.snapshot()).humanWorkspace.availability).toBe('clean');
  });

  it('keeps the shared lease until a started publication settles and rejects late browser writes', async () => {
    const { project, dataRoot } = await fixture();
    const leaseManager = new NodeLocalLeaseManager(dataRoot);
    const authority = new EditorWorkspaceAuthority(project, { leaseManager, maxWriteMs: 100 });
    authorities.push(authority);
    const { diskBaseline } = await authority.snapshot();
    const state = { ...identity, workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
    await authority.heartbeat(state);
    const begun = await authority.beginWrite({ ...state, purpose: 'save-all',
      expectedProjectRevision: diskBaseline.projectRevision, expectedCoordinationRevision: diskBaseline.coordinationRevision });
    const input = { ...state, writeLeaseId: begun.writeLeaseId, path: 'content/scenario/start.gal',
      expectedSha256: diskBaseline.files.find(file => file.path === 'content/scenario/start.gal')!.sha256,
      text: '@scene start\n凛：人类保存的内容。\n@end\n' };
    let publishStarted!: () => void;
    const started = new Promise<void>(resolve => { publishStarted = resolve; });
    let continuePublish!: () => void;
    const paused = new Promise<void>(resolve => { continuePublish = resolve; });
    const replace = NodeProjectStorage.prototype.replaceFromStage;
    vi.spyOn(NodeProjectStorage.prototype, 'replaceFromStage').mockImplementation(async function (this: NodeProjectStorage, target, staged) {
      publishStarted();
      await paused;
      await replace.call(this, target, staged);
    });
    const publishing = authority.publishFile(input);
    await started;
    await new Promise(resolve => setTimeout(resolve, 130));
    try {
      await expect(authority.publishFile(input)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
      expect((await leaseManager.inspect('project', project)).state).toBe('owned');
    } finally {
      continuePublish();
    }
    await publishing;
    await vi.waitFor(async () => expect((await leaseManager.inspect('project', project)).state).toBe('free'));
    await fs.writeFile(path.join(project, input.path), '@scene start\n凛：后来的 Agent 内容。\n@end\n');
    await expect(authority.publishFile(input)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_STATE_CORRUPT' });
    expect(await fs.readFile(path.join(project, input.path), 'utf8')).toContain('后来的 Agent 内容');
  });

  it('checks the loaded baseline and each file before publishing, then settles a successful save', async () => {
    const { project, dataRoot } = await fixture();
    const authority = new EditorWorkspaceAuthority(project, { leaseManager: new NodeLocalLeaseManager(dataRoot) });
    authorities.push(authority);
    const { diskBaseline } = await authority.snapshot();
    const state = { ...identity, workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
    await authority.heartbeat(state);
    const begin = { ...state, purpose: 'save-all' as const, expectedProjectRevision: diskBaseline.projectRevision,
      expectedCoordinationRevision: diskBaseline.coordinationRevision };
    await expect(authority.beginWrite({ ...begin, expectedCoordinationRevision: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
    const begun = await authority.beginWrite(begin);
    const input = { ...state, writeLeaseId: begun.writeLeaseId, path: 'content/scenario/start.gal',
      expectedSha256: diskBaseline.files.find(file => file.path === 'content/scenario/start.gal')!.sha256,
      text: '@scene start\n凛：新内容。\n@end\n' };
    await expect(authority.publishFile({ ...input, expectedSha256: null })).rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
    expect(await fs.readFile(path.join(project, input.path), 'utf8')).toContain('原始内容');
    const saved = await authority.publishFile(input);
    const result = await authority.finishWrite({ ...state, writeLeaseId: begun.writeLeaseId, availability: 'clean', dirtyScopes: [] });
    expect(result.changedPaths).toEqual([input.path]);
    expect(result.diskBaseline.files.find(file => file.path === input.path)?.sha256).toBe(saved.sha256);
    expect(result.mutationNotice.status).toBe('written');
  });

  it('publishes failed-write blocking state before releasing an expired write lease', async () => {
    const { project, dataRoot } = await fixture();
    let now = Date.now();
    const workspaceStore = new HumanWorkspaceStore({ dataRoot, now: () => now });
    const leaseManager = new NodeLocalLeaseManager(dataRoot);
    const acquire = leaseManager.acquire.bind(leaseManager);
    let observed: string | undefined;
    let onReleased!: () => void;
    const released = new Promise<void>(resolve => { onReleased = resolve; });
    vi.spyOn(leaseManager, 'acquire').mockImplementation(async input => {
      const lease = await acquire(input);
      return { ...lease, release: async () => {
        observed = (await workspaceStore.inspect(project)).summary.availability;
        await lease.release();
        onReleased();
      } };
    });
    const authority = new EditorWorkspaceAuthority(project, { leaseManager, workspaceStore, now: () => now, maxWriteMs: 20 });
    authorities.push(authority);
    const { diskBaseline } = await authority.snapshot();
    await authority.heartbeat({ ...identity, workspaceGeneration: 0, availability: 'clean' });
    await authority.beginWrite({ ...identity, workspaceGeneration: 1, availability: 'dirty', dirtyScopes: ['scene'], purpose: 'save-all',
      expectedProjectRevision: diskBaseline.projectRevision, expectedCoordinationRevision: diskBaseline.coordinationRevision });
    now += 23_000;
    await released;
    expect(observed).toBe('blocked');
    expect((await leaseManager.inspect('project', project)).state).toBe('free');
  });
});
