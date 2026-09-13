import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetImportClientError, type EditorWorkspaceClient, type EditorWorkspaceSnapshot } from '../src/asset-import-client.js';
import { bindEditorWorkspaceHooks, beginEditorWorkspaceWrite, connectEditorWorkspace, disconnectEditorWorkspace,
  editorWorkspaceStatus, editorWorkspaceTextChanges, finishEditorWorkspaceWrite, pollEditorWorkspace,
  publishEditorWorkspaceFile, publishEditorWorkspaceState, readEditorWorkspaceBaseline, editorPreviewPublisher } from '../src/editor-workspace.js';

const oldBaseline = { projectRevision: '1'.repeat(64), coordinationRevision: '2'.repeat(64), files: [
  { path: 'game.config.json', sha256: '3'.repeat(64) },
  { path: 'content/scenario/start.gal', sha256: '4'.repeat(64) },
] };
const newBaseline = { projectRevision: '5'.repeat(64), coordinationRevision: '6'.repeat(64), files: [
  { path: 'game.config.json', sha256: '7'.repeat(64) },
  { path: 'content/scenario/start.gal', sha256: '8'.repeat(64) },
] };
let facts = { sceneDirty: false, timelineDirty: false, configDirty: false, reviewDirty: false,
  projectTransition: true, assetImportWriting: false, assetRelocationWriting: false,
  sceneLifecycleWriting: false, autosaveRecoveryBlocked: false };
let disk: EditorWorkspaceSnapshot;
let client: EditorWorkspaceClient;
const root = {} as FileSystemDirectoryHandle;

beforeEach(() => {
  facts = { sceneDirty: false, timelineDirty: false, configDirty: false, reviewDirty: false,
    projectTransition: true, assetImportWriting: false, assetRelocationWriting: false,
    sceneLifecycleWriting: false, autosaveRecoveryBlocked: false };
  disk = { projectIdentity: 'a'.repeat(32), diskBaseline: structuredClone(oldBaseline), mutationNotice: null };
  client = {
    heartbeat: vi.fn(async () => {}), snapshot: vi.fn(async () => structuredClone(disk)),
    preview: vi.fn(async ({ preview }) => ({ previewId: preview.action === 'invalidate' ? null : preview.previewId,
      previewGeneration: preview.previewGeneration })),
    begin: vi.fn(async () => ({ writeLeaseId: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-09-09T11:00:00.000Z', diskBaseline: structuredClone(disk.diskBaseline) })),
    publish: vi.fn(async () => ({ sha256: '9'.repeat(64) })), renew: vi.fn(async () => {}),
    finish: vi.fn(async () => ({ diskBaseline: structuredClone(disk.diskBaseline), changedPaths: ['game.config.json'], mutationNotice: { status: 'written' as const } })),
    abort: vi.fn(async () => {}), revoke: vi.fn(async () => {}),
  };
  bindEditorWorkspaceHooks({ facts: () => facts, onChanged: () => {} });
});

afterEach(async () => { await disconnectEditorWorkspace(); });

describe('bound Editor sequential relay', () => {
  it('publishes actual dirty facts and never sends a captured preview into a replacement binding', async () => {
    await connectEditorWorkspace(client, root);
    const publisher = editorPreviewPublisher(root)!;
    facts.sceneDirty = true;
    await publisher.publish({ action: 'invalidate', previewGeneration: 1, reason: 'source-changed' });
    expect(client.preview).toHaveBeenCalledWith(expect.objectContaining({ dirtyScopes: ['scene'] }));
    await connectEditorWorkspace(client, root);
    vi.mocked(client.preview).mockClear();
    await expect(publisher.publish({ action: 'invalidate', previewGeneration: 2, reason: 'closed' }))
      .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
    expect(client.preview).not.toHaveBeenCalled();
  });
  it('keeps the loaded baseline when reading replacement buffers fails', async () => {
    await connectEditorWorkspace(client, root);
    disk.diskBaseline = newBaseline;
    await expect(readEditorWorkspaceBaseline(async () => { throw new Error('file read failed'); }))
      .rejects.toThrow('file read failed');
    expect(editorWorkspaceStatus().baseline).toEqual(oldBaseline);
  });

  it('captures the baseline before reading buffers, so intervening writes remain external changes', async () => {
    await connectEditorWorkspace(client, root);
    await readEditorWorkspaceBaseline(async () => {
      disk.diskBaseline = newBaseline;
    });
    facts.projectTransition = false;
    await pollEditorWorkspace(true);
    expect(editorWorkspaceStatus()).toMatchObject({ baseline: oldBaseline, update: 'pending' });
  });

  it('returns the captured baseline when successful reopening replaces the old connection', async () => {
    await connectEditorWorkspace(client, root);
    const captured = await readEditorWorkspaceBaseline(async () => {
      await disconnectEditorWorkspace();
      disk.diskBaseline = newBaseline;
    });
    expect(captured).toEqual(oldBaseline);
    await connectEditorWorkspace(client, root, captured);
    expect(editorWorkspaceStatus()).toMatchObject({ baseline: oldBaseline, update: 'pending' });
  });

  it('remains busy until the service acknowledges the end of the write lease', async () => {
    await connectEditorWorkspace(client, root);
    facts.projectTransition = false;
    await beginEditorWorkspaceWrite();
    let settle!: () => void;
    vi.mocked(client.finish).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { settle = resolve; });
      return { diskBaseline: oldBaseline, changedPaths: [], mutationNotice: { status: 'written' } };
    });
    const finishing = finishEditorWorkspaceWrite();
    await vi.waitFor(() => expect(client.finish).toHaveBeenCalledOnce());
    const pendingState = editorWorkspaceStatus();
    settle();
    await finishing;
    expect(pendingState.saving).toBe(true);
    expect(editorWorkspaceStatus().saving).toBe(false);
  });

  it('publishes current dirty scopes with increasing generations and does not send draft content', async () => {
    await connectEditorWorkspace(client, root);
    facts.projectTransition = false;
    facts.configDirty = true;
    publishEditorWorkspaceState();
    await vi.waitFor(() => expect(client.heartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ availability: 'dirty', dirtyScopes: ['config'] })));
    const dirty = vi.mocked(client.heartbeat).mock.calls.at(-1)![0];
    facts.configDirty = false;
    publishEditorWorkspaceState();
    await vi.waitFor(() => expect(client.heartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ availability: 'clean', dirtyScopes: [] })));
    const clean = vi.mocked(client.heartbeat).mock.calls.at(-1)![0];
    expect(clean.workspaceGeneration).toBeGreaterThan(dirty.workspaceGeneration);
    expect(Object.keys(dirty).sort()).toEqual(['availability', 'blockedReasons', 'busyReasons', 'dirtyScopes',
      'loadedCoordinationRevision', 'loadedProjectRevision', 'workspaceGeneration', 'workspaceSessionId']);
  });

  it('compares the full loaded baseline across multiple external changes without adopting it', async () => {
    await connectEditorWorkspace(client, root);
    facts.projectTransition = false;
    disk = { projectIdentity: 'a'.repeat(32), diskBaseline: newBaseline, mutationNotice: { schemaVersion: 1, sequence: 2, projectIdentity: 'a'.repeat(64),
      projectRevision: newBaseline.projectRevision, coordinationRevision: newBaseline.coordinationRevision,
      initiator: 'external-agent', occurredAt: '2026-09-09T10:00:00.000Z', changedPaths: ['game.config.json'] } };
    await pollEditorWorkspace(true);
    expect(editorWorkspaceTextChanges()?.modified).toEqual(['content/scenario/start.gal', 'game.config.json']);
    expect(editorWorkspaceStatus().baseline).toEqual(oldBaseline);
    expect(editorWorkspaceStatus().update).toBe('pending');
    facts.sceneDirty = true;
    expect(editorWorkspaceStatus().update).toBe('conflict');
    vi.mocked(client.begin).mockRejectedValueOnce(new AssetImportClientError('EDITOR_PROJECT_BASELINE_CHANGED', 'changed'));
    await expect(beginEditorWorkspaceWrite()).rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
    expect(client.begin).toHaveBeenCalledWith(expect.objectContaining({ expectedCoordinationRevision: oldBaseline.coordinationRevision }));
    expect(client.publish).not.toHaveBeenCalled();
    expect(editorWorkspaceStatus()).toMatchObject({ dirty: true, saving: false, baseline: oldBaseline });
  });

  it('keeps typing during a successful save dirty and reports a notice warning without retrying publication', async () => {
    await connectEditorWorkspace(client, root);
    facts.projectTransition = false;
    facts.configDirty = true;
    await beginEditorWorkspaceWrite();
    await publishEditorWorkspaceFile('game.config.json', 'submitted config');
    expect(client.publish).toHaveBeenCalledWith(expect.objectContaining({ text: 'submitted config', expectedSha256: '3'.repeat(64) }));
    disk.diskBaseline = newBaseline;
    vi.mocked(client.finish).mockResolvedValueOnce({ diskBaseline: newBaseline, changedPaths: ['game.config.json'],
      mutationNotice: { status: 'unavailable', message: '文件已保存，通知不可用。' } });
    await expect(finishEditorWorkspaceWrite()).resolves.toBe('文件已保存，通知不可用。');
    expect(client.finish).toHaveBeenCalledWith(expect.objectContaining({ availability: 'dirty', dirtyScopes: ['config'], busyReasons: [] }));
    expect(editorWorkspaceStatus()).toMatchObject({ protection: 'connected', dirty: true, saving: false });
    expect(client.publish).toHaveBeenCalledTimes(1);
  });

  it('does not adopt a fresh disk baseline when reconnecting an already loaded page', async () => {
    facts.projectTransition = false;
    disk.diskBaseline = newBaseline;
    await connectEditorWorkspace(client, root, oldBaseline);
    expect(editorWorkspaceStatus()).toMatchObject({ baseline: oldBaseline, update: 'pending' });
    await disconnectEditorWorkspace();
    await connectEditorWorkspace(client, root, null);
    await expect(beginEditorWorkspaceWrite()).rejects.toThrow('尚未读取项目基线');
    expect(client.begin).not.toHaveBeenCalled();
    facts.projectTransition = true;
    await readEditorWorkspaceBaseline();
    facts.projectTransition = false;
    expect(editorWorkspaceStatus()).toMatchObject({ baseline: newBaseline, update: 'none' });
  });
});
