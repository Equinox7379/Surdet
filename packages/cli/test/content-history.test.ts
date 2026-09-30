import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { ContentHistoryService } from '../src/authoring/content-history-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { EditorWorkspaceAuthority } from '../src/editor-workspace-authority/editor-workspace-authority.js';
import { beginChange, restoreContentHistory, InMemoryChangeRepository, loadSavedContent } from '@surdet/authoring';
import { createHash } from 'node:crypto';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { PreviewContentService } from '../src/authoring/preview-content-service.js';

const roots: string[] = [];
const hash = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-history-')); roots.push(temporary);
  const root = path.join(temporary, 'project'), dataRoot = path.join(temporary, 'data');
  await fs.mkdir(path.join(root, 'content/scenario'), { recursive: true });
  await fs.mkdir(path.join(root, 'content/config'), { recursive: true });
  await fs.mkdir(path.join(root, 'content/timelines'), { recursive: true });
  await fs.writeFile(path.join(root, 'game.config.json'), '{"entryScene":"start","variables":{}}');
  await fs.writeFile(path.join(root, 'content/scenario/start.gal'), '@scene start\n旁白：历史正文。\n@end\n');
  await fs.writeFile(path.join(root, 'content/config/achievements.json'), '[{"id":"first","name":"最初"}]');
  await fs.writeFile(path.join(root, 'content/timelines/intro.json'), '{"version":1,"id":"intro","durationMs":1,"tracks":[{"kind":"screen","cues":[{"atMs":0,"durationMs":1,"easing":"linear","action":"fade","alpha":0}]}]}');
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"save-identity"}');
  vi.stubEnv('SURDET_AGENT_DATA_DIR', dataRoot);
  return { root: await fs.realpath(root), dataRoot, service: new AuthoringService() };
}
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('manual content history', () => {
  it('rejects invalid UTF-8 before creating a corrupt checkpoint or lossy direct draft', async () => {
    const { root, dataRoot, service } = await fixture();
    const index = await service.history(root);
    await fs.writeFile(path.join(root, 'content/scenario/start.gal'), Buffer.from([0xff, 0xfe, 0x00]));
    await expect(service.historyCheckpoint(root, { operationId: randomUUID(), label: '无损文本', expectedContentRevision: index.result.contentRevision })).rejects.toMatchObject({ code: 'PROJECT_INVALID' });
    await expect(service.begin(root)).rejects.toMatchObject({ code: 'PROJECT_INVALID' });
    const store = await NodeChangeStore.forProject(root, dataRoot);
    expect(await fs.readdir(path.join(store.projectDirectory, 'content-history')).catch(() => [])).toEqual([]);
    expect(await fs.readFile(path.join(root, 'content/scenario/start.gal'))).toEqual(Buffer.from([0xff, 0xfe, 0x00]));
  });
  it('pins saved content, rejects stale capture, retries the same capture and preserves damaged records', async () => {
    const { root, dataRoot, service } = await fixture();
    const index = await service.history(root);
    const input = { operationId: randomUUID(), label: '第一稿', expectedContentRevision: index.result.contentRevision };
    const first = await service.historyCheckpoint(root, input);
    const change = await service.begin(root);
    await service.variableEnsure(change.result.changeId, { operationId: 'unsaved', name: 'draftOnly', type: 'number', initial: 0 });
    expect((await service.historyCheckpoint(root, input)).result).toEqual(first.result);
    const full = await service.historyCompare(root, { checkpointId: first.result.checkpointId, path: 'game.config.json' });
    expect(full.result.files[0]!.historicalText).not.toContain('draftOnly');
    await fs.writeFile(path.join(root, 'content/scenario/start.gal'), '@scene start\n旁白：后来。\n@end\n');
    await expect(service.historyCheckpoint(root, { ...input, operationId: randomUUID() })).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await expect(service.historyCheckpoint(root, { ...input, label: '另一个名字' })).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    await expect(service.historyCompare(root, { checkpointId: first.result.checkpointId, path: 'package.json' })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    const store = await NodeChangeStore.forProject(root, dataRoot);
    const file = path.join(store.projectDirectory, 'content-history', `${first.result.checkpointId}.json`);
    await fs.writeFile(file, '{damaged');
    await expect(service.history(root)).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
    expect(await fs.readFile(file, 'utf8')).toBe('{damaged');
  });

  it('recovers malformed source through a direct draft, preserves extra files and uses the normal commit gate', async () => {
    const { root, service } = await fixture();
    const original = await fs.readFile(path.join(root, 'game.config.json'), 'utf8');
    const checkpoint = (await service.historyCheckpoint(root, { operationId: randomUUID(), label: '可用版', expectedContentRevision: (await service.history(root)).result.contentRevision })).result;
    await fs.writeFile(path.join(root, 'game.config.json'), '{broken');
    await fs.writeFile(path.join(root, 'content/config/achievements.json'), '[]');
    await fs.writeFile(path.join(root, 'content/scenario/extra.gal'), '@scene extra\n旁白：保留新文件。\n@end\n');
    const change = (await service.begin(root)).result;
    const comparison = (await service.historyCompare(root, { checkpointId: checkpoint.checkpointId }, change.changeId)).result;
    const input = { operationId: 'restore', checkpointId: checkpoint.checkpointId, expectedFingerprint: checkpoint.fingerprint,
      expectedContentRevision: comparison.contentRevision, expectedWorkingRevision: comparison.workingRevision!, paths: ['game.config.json', 'content/config/achievements.json'] };
    await expect(service.historyRestore(change.changeId, { ...input, expectedFingerprint: '0'.repeat(64) })).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await service.historyRestore(change.changeId, input);
    const preview = await new PreviewContentService().resolve(root, { kind: 'working-change', changeId: change.changeId });
    expect(preview.content.files['content/config/achievements.json']).toContain('最初');
    expect(preview.content.files['game.config.json']).toBe(original);
    expect(await fs.readFile(path.join(root, 'game.config.json'), 'utf8')).toBe('{broken');
    expect((await service.historyRestore(change.changeId, input)).workingRevision).toBe(1);
    await expect(service.historyRestore(change.changeId, { ...input, operationId: 'new-operation' })).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await expect(service.commit(change.changeId)).rejects.toMatchObject({ code: 'VALIDATION_REQUIRED' });
    await service.validate(change.changeId); await service.simulate(change.changeId); await service.runFrom(change.changeId, { sceneId: 'start', choices: [], seed: 1 });
    await service.commit(change.changeId);
    expect(await fs.readFile(path.join(root, 'game.config.json'), 'utf8')).toBe(original);
    expect(await fs.readFile(path.join(root, 'content/config/achievements.json'), 'utf8')).toContain('最初');
    expect(await fs.readFile(path.join(root, 'content/scenario/extra.gal'), 'utf8')).toContain('保留新文件');
    expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toBe('{"name":"save-identity"}');
  });

  it('rejects candidate and integration restoration before recording an operation', async () => {
    const { root, service } = await fixture();
    const history = (await service.historyCheckpoint(root, { operationId: randomUUID(), label: '基线', expectedContentRevision: (await service.history(root)).result.contentRevision })).result;
    const change = (await service.begin(root, undefined, { compositionMode: 'candidate' })).result;
    const before = (await NodeChangeStore.openByChangeId(change.changeId))!.record;
    const input = { operationId: 'refused', checkpointId: history.checkpointId, expectedFingerprint: history.fingerprint,
      expectedContentRevision: history.contentRevision, expectedWorkingRevision: 0, paths: ['game.config.json'] };
    await expect(service.historyRestore(change.changeId, input)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect((await NodeChangeStore.openByChangeId(change.changeId))!.record).toEqual(before);
    const repository = new InMemoryChangeRepository();
    const integrated = await beginChange(await loadSavedContent(await NodeProjectStorage.open(root), hash), repository);
    Object.assign(integrated.record, { integration: { status: 'READY' } });
    const read = vi.fn();
    await expect(restoreContentHistory(integrated, input, read, hash)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(read).not.toHaveBeenCalled(); expect(integrated.record.operations).toEqual({});
  });

  it('shares history with the bound Editor and rejects an external edit before compare or save', async () => {
    const { root, dataRoot, service } = await fixture();
    const authority = new EditorWorkspaceAuthority(root, { leaseManager: new NodeLocalLeaseManager(dataRoot) });
    try {
      const disk = (await authority.snapshot()).diskBaseline;
      const state = { workspaceSessionId: randomUUID(), browserSessionId: 'history-editor', workspaceGeneration: 1,
        availability: 'clean' as const, loadedProjectRevision: disk.projectRevision, loadedCoordinationRevision: disk.coordinationRevision };
      await authority.heartbeat(state);
      const checkpoint = await authority.historyCheckpoint(state, { operationId: randomUUID(), label: '编辑器版本', expectedContentRevision: (await authority.history(state)).contentRevision });
      expect((await service.history(root)).result.checkpoints[0]).toEqual(checkpoint);
      await fs.writeFile(path.join(root, 'game.config.json'), '{broken');
      await expect(authority.historyCompare(state, { checkpointId: checkpoint.checkpointId })).rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
      const updated = (await authority.snapshot()).diskBaseline;
      const next = { ...state, workspaceGeneration: 2, loadedProjectRevision: updated.projectRevision, loadedCoordinationRevision: updated.coordinationRevision };
      await authority.heartbeat(next);
      expect((await authority.historyCompare(next, { checkpointId: checkpoint.checkpointId, path: 'game.config.json' })).files[0]!.currentText).toBe('{broken');
      const writing = await authority.beginWrite({ ...next, purpose: 'save-all', expectedProjectRevision: updated.projectRevision, expectedCoordinationRevision: updated.coordinationRevision });
      const sha = updated.files.find(file => file.path === 'game.config.json')!.sha256;
      await fs.writeFile(path.join(root, 'game.config.json'), '{"external":true}');
      await expect(authority.publishFile({ ...next, writeLeaseId: writing.writeLeaseId, path: 'game.config.json', expectedSha256: sha, text: '{}' })).rejects.toMatchObject({ code: 'EDITOR_PROJECT_BASELINE_CHANGED' });
      expect(await fs.readFile(path.join(root, 'game.config.json'), 'utf8')).toBe('{"external":true}');
    } finally { await authority.close(); }
  });
});
