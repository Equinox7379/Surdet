import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { PreviewContentService } from '../src/authoring/preview-content-service.js';

const temporaryRoots: string[] = [];
const priorDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
const unusedPath = 'content/scenario/chapter/unused.GAL';
const unusedText = '@scene unused\r\n模板正文。\r\n@end\r\n';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-remove-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(path.join(projectRoot, 'content/scenario/chapter'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'game.config.json'), '{"entryScene":"start","variables":{}}');
  fs.writeFileSync(path.join(projectRoot, 'content/scenario/start.gal'), '@scene start\n开始。\n@clear done\n@end\n');
  fs.writeFileSync(path.join(projectRoot, unusedPath), unusedText);
  process.env['SURDET_AGENT_DATA_DIR'] = path.join(root, 'data');
  return projectRoot;
}

afterEach(() => {
  if (priorDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
  else process.env['SURDET_AGENT_DATA_DIR'] = priorDataRoot;
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('public direct scene removal', () => {
  it('reads the fingerprint via MCP, stages a deletion, seals it and writes it back only in apply', async () => {
    const projectRoot = fixture();
    fs.writeFileSync(path.join(projectRoot, 'game.config.json'), '{"entryScene":"unused","player":{"endScenes":["unused"]},"variables":{}}');
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    const server = createAgentPortServer(session);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'scene-remove-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    async function call(name: string, args: Record<string, unknown>) {
      const response = await client.callTool({ name, arguments: args });
      const envelope = response.structuredContent as { ok: boolean; result: any };
      expect(envelope, JSON.stringify(response)).toMatchObject({ ok: true });
      return envelope.result;
    }
    let changeId: string;
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('surdet_scene_remove');
      const begun = await call('surdet_change_begin', { compositionMode: 'direct' });
      changeId = begun.changeId;
      const object = await call('surdet_object_inspect', { objectRef: 'scene:unused', view: 'working' });
      expect(object.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(object.source.path).toBe(unusedPath);
      const input = { operationId: 'remove-template', sceneId: 'unused', expectedFingerprint: object.fingerprint };
      expect(await session.invoke('scene.remove', input)).toMatchObject({ ok: false, error: { code: 'OBJECT_PRECONDITION_FAILED' } });
      const entry = await call('surdet_object_inspect', { objectRef: 'config:entryScene', view: 'working' });
      await call('surdet_project_entry_scene_set', { operationId: 'switch-entry', sceneId: 'start', expectedFingerprint: entry.fingerprint });
      const project = await call('surdet_project_inspect', { view: 'working' });
      await call('surdet_project_player_config_patch', { operationId: 'switch-ending', expectedFingerprint: project.playerConfig.fingerprint, patch: { endScenes: ['start'] } });
      expect(await call('surdet_scene_remove', input)).toEqual({ sceneId: 'unused', path: unusedPath, removed: true });
      expect(await call('surdet_scene_remove', input)).toMatchObject({ removed: true });
      expect(fs.readFileSync(path.join(projectRoot, unusedPath), 'utf8')).toBe(unusedText);
      const preview = await new PreviewContentService().resolve(projectRoot, { kind: 'working-change', changeId });
      expect(preview.content.files[unusedPath]).toBeUndefined();
      expect(await preview.storage.exists(unusedPath)).toBe(false);
      expect(JSON.parse(preview.content.files['game.config.json']!).entryScene).toBe('start');
      expect(await session.invoke('object.inspect', { objectRef: 'scene:unused', view: 'working' })).toMatchObject({ ok: false, error: { code: 'OBJECT_NOT_FOUND' } });
      expect(await call('surdet_object_inspect', { objectRef: 'scene:unused', view: 'project' })).toMatchObject({ fingerprint: object.fingerprint });
      const diff = await call('surdet_change_diff', {});
      expect(diff.summary).toMatchObject({ removedScenes: 1, modifiedScenes: 0 });
      expect(diff.files).toHaveLength(2);
      const removedFile = diff.files.find((file: { path: string }) => file.path === unusedPath);
      expect(removedFile).toMatchObject({ path: unusedPath, changeType: 'deleted', beforeSha256: object.fingerprint });
      expect(removedFile).not.toHaveProperty('afterSha256');
      expect(removedFile.unifiedDiff).toContain('-模板正文。');
      expect((await call('surdet_project_validate', {})).ok).toBe(true);
      expect(await call('surdet_project_simulate', {})).toMatchObject({ status: 'passed', endings: [{ ending: 'done', times: 1 }] });
      await call('surdet_runtime_run_from', { sceneId: 'start', choices: [] });
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('unavailable');
      expect(capsule.objectDiff).toMatchObject({ files: expect.arrayContaining([expect.objectContaining({ path: unusedPath, changeType: 'deleted' })]) });
      expect(await session.invoke('change.commit', {})).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    } finally {
      await client.close(); await server.close(); await session.close();
    }
    const apply = await openAgentPortSession({ projectRoot, policy: 'apply', resumeChangeId: changeId! });
    try {
      expect(await apply.invoke('change.commit', {})).toMatchObject({ ok: true, result: { status: 'COMMITTED', files: [unusedPath, 'game.config.json'] } });
      expect(fs.existsSync(path.join(projectRoot, unusedPath))).toBe(false);
      const opened = await NodeChangeStore.openByChangeId(changeId!);
      expect(await opened!.store.readLatestJournal(changeId!)).toMatchObject({ status: 'COMMITTED', files: expect.arrayContaining([expect.objectContaining({ kind: 'delete', path: unusedPath })]) });
    } finally { await apply.close(); }
  }, 30000);

  it.each([
    ['double-quoted jump', '" -> " == " -> "', '@jump unused.entry'],
    ['single-quoted call', "' -> ' == ' -> '", '@call unused.entry'],
  ])('rejects a %s after a condition arrow through MCP without changing draft or source', async (_name, condition, action) => {
    const projectRoot = fixture();
    const callerPath = 'content/scenario/start.gal';
    const caller = `@scene start\n@choice\n  继续 [if:${condition}] -> ${action}\n@end\n`;
    const targetText = '@scene unused\n@label entry\n@return\n@end\n';
    fs.writeFileSync(path.join(projectRoot, callerPath), caller);
    fs.writeFileSync(path.join(projectRoot, unusedPath), targetText);
    const configBefore = fs.readFileSync(path.join(projectRoot, 'game.config.json'), 'utf8');
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    const server = createAgentPortServer(session);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'choice-reference-test', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.structuredContent).toMatchObject({ ok: true });
      return (response.structuredContent as { result: any }).result;
    };
    try {
      const { changeId } = await call('surdet_change_begin', { compositionMode: 'direct' });
      const object = await call('surdet_object_inspect', { objectRef: 'scene:unused', view: 'working' });
      const before = (await NodeChangeStore.openByChangeId(changeId))!.record;
      const response = await client.callTool({ name: 'surdet_scene_remove', arguments: {
        operationId: 'remove-referenced-scene', sceneId: 'unused', expectedFingerprint: object.fingerprint,
      } });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toMatchObject({ ok: false, error: {
        code: 'OBJECT_PRECONDITION_FAILED', details: { operationApplied: false, references: [expect.objectContaining({ path: callerPath, line: 3, target: 'unused' })] },
      } });
      expect((await NodeChangeStore.openByChangeId(changeId))!.record).toEqual(before);
      expect(object.referencedBy.some((ref: string) => ref.startsWith('scene:start/choice-option:'))).toBe(true);
      expect(fs.readFileSync(path.join(projectRoot, callerPath), 'utf8')).toBe(caller);
      expect(fs.readFileSync(path.join(projectRoot, unusedPath), 'utf8')).toBe(targetText);
      expect(fs.readFileSync(path.join(projectRoot, 'game.config.json'), 'utf8')).toBe(configBefore);
    } finally { await client.close(); await server.close(); await session.close(); }
  });

  it('rejects candidate, stale fingerprint and incoming call without mutating the draft', async () => {
    const projectRoot = fixture();
    const candidate = await openAgentPortSession({ projectRoot, policy: 'stage' });
    try {
      await candidate.invoke('change.begin', {});
      const before = (await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record;
      expect(await candidate.invoke('scene.remove', { operationId: 'no-candidate', sceneId: 'unused', expectedFingerprint: 'stale' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } });
      expect((await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record).toEqual(before);
      await candidate.invoke('change.rollback', {});
    } finally { await candidate.close(); }
    fs.writeFileSync(path.join(projectRoot, 'content/scenario/start.gal'), '@scene start\n@call unused.entry\n@end\n');
    const service = new AuthoringService();
    const begun = await service.begin(projectRoot, {}, { compositionMode: 'direct' });
    const changeId = begun.result.changeId;
    const object = await service.inspectObject(projectRoot, 'scene:unused', changeId);
    const before = (await NodeChangeStore.openByChangeId(changeId))!.record;
    await expect(service.sceneRemove(changeId, { operationId: 'stale', sceneId: 'unused', expectedFingerprint: 'stale' })).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await expect(service.sceneRemove(changeId, { operationId: 'used', sceneId: 'unused', expectedFingerprint: (object.result as { fingerprint: string }).fingerprint })).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED', details: { references: [expect.objectContaining({ path: 'content/scenario/start.gal', line: 2 })] } });
    expect((await NodeChangeStore.openByChangeId(changeId))!.record).toEqual(before);
  });

  it('blocks source changes to host entry configs before commit and can roll back an isolated deletion', async () => {
    const projectRoot = fixture();
    const service = new AuthoringService();
    const begun = await service.begin(projectRoot, {}, { compositionMode: 'direct' });
    const changeId = begun.result.changeId;
    const object = await service.inspectObject(projectRoot, 'scene:unused', changeId);
    await service.sceneRemove(changeId, { operationId: 'remove', sceneId: 'unused', expectedFingerprint: (object.result as { fingerprint: string }).fingerprint });
    fs.mkdirSync(path.join(projectRoot, 'content/config'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'content/config/events.json'), '{"events":[{"scene":"unused"}]}');
    await expect(service.commit(changeId)).rejects.toMatchObject({ code: 'PROJECT_CHANGED_SINCE_BEGIN' });
    expect(fs.readFileSync(path.join(projectRoot, unusedPath), 'utf8')).toBe(unusedText);

    fs.writeFileSync(path.join(projectRoot, 'content/config/events.json'), '{}');
    const next = await service.begin(projectRoot, {}, { compositionMode: 'direct' });
    const nextId = next.result.changeId;
    const nextObject = await service.inspectObject(projectRoot, 'scene:unused', nextId);
    await service.sceneRemove(nextId, { operationId: 'remove', sceneId: 'unused', expectedFingerprint: (nextObject.result as { fingerprint: string }).fingerprint });
    await service.rollback(nextId);
    expect(fs.readFileSync(path.join(projectRoot, unusedPath), 'utf8')).toBe(unusedText);
    expect((await NodeChangeStore.openByChangeId(nextId))!.record.workingFiles[unusedPath]).toBe(unusedText);
  });

  it('keeps the source intact if a later draft edit introduces a missing-scene reference', async () => {
    const projectRoot = fixture();
    const service = new AuthoringService();
    const changeId = (await service.begin(projectRoot, {}, { compositionMode: 'direct' })).result.changeId;
    const object = await service.inspectObject(projectRoot, 'scene:unused', changeId);
    await service.sceneRemove(changeId, { operationId: 'remove', sceneId: 'unused', expectedFingerprint: (object.result as { fingerprint: string }).fingerprint });
    await service.sceneCreate(changeId, { operationId: 'broken-caller', sceneId: 'later', blocks: [{ kind: 'instruction', name: 'jump', args: ['unused'] }] });
    expect((await service.validate(changeId)).result).toMatchObject({ ok: false });
    await expect(service.commit(changeId)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fs.readFileSync(path.join(projectRoot, unusedPath), 'utf8')).toBe(unusedText);
    expect(fs.existsSync(path.join(projectRoot, 'content/scenario/later.gal'))).toBe(false);
  });
});
