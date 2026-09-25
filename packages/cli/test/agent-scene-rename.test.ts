import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { PreviewContentService } from '../src/authoring/preview-content-service.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';

const roots: string[] = [];
const priorData = process.env['SURDET_AGENT_DATA_DIR'];
afterEach(() => {
  if (priorData === undefined) delete process.env['SURDET_AGENT_DATA_DIR']; else process.env['SURDET_AGENT_DATA_DIR'] = priorData;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-rename-')); roots.push(root);
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'content/scenario/chapter'), { recursive: true });
  fs.writeFileSync(path.join(project, 'game.config.json'), '{"entryScene":"start","variables":{},"player":{"endScenes":["start"]}}');
  fs.writeFileSync(path.join(project, 'content/scenario/start.gal'), '@scene start\n@call old.entry\n@clear done\n@end\n');
  fs.writeFileSync(path.join(project, 'content/scenario/chapter/old.GAL'), '@scene old\r\n@label entry\r\n旁白：来自片段。\r\n@return\r\n');
  process.env['SURDET_AGENT_DATA_DIR'] = path.join(root, 'data');
  return project;
}

describe('public scene rename', () => {
  it('replays the original receipt without inventing a continuation after a later rename', async () => {
    const project = fixture();
    const session = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    const invoke = async (id: 'change.begin' | 'object.inspect' | 'scene.rename', args: Record<string, unknown>) => {
      const response = await session.invoke(id, args);
      expect(response).toMatchObject({ ok: true });
      if (!response.ok) throw new Error('fixture operation failed');
      return response.result as any;
    };
    try {
      await invoke('change.begin', { compositionMode: 'direct' });
      const old = await invoke('object.inspect', { view: 'working', objectRef: 'scene:old' });
      const first = { operationId: 'first', sceneId: 'old', newSceneId: 'arrival', expectedFingerprint: old.fingerprint };
      await invoke('scene.rename', first);
      const current = await invoke('object.inspect', { view: 'working', objectRef: 'scene:arrival' });
      await invoke('scene.rename', { operationId: 'second', sceneId: 'arrival', newSceneId: 'visit', expectedFingerprint: current.fingerprint });
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const replay = await invoke('scene.rename', first);
      expect(replay.sceneId).toBe('arrival');
      expect(replay.continuation).toBeUndefined();
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
    } finally { await session.close(); }
  });

  it('discovers via MCP, renames and revises the same draft, previews/seals then commits only with apply authority', async () => {
    const project = fixture();
    const session = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    const server = createAgentPortServer(session);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'scene-rename', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.structuredContent, JSON.stringify(result)).toMatchObject({ ok: true });
      return (result.structuredContent as { result: any }).result;
    };
    let changeId = '';
    try {
      expect((await client.listTools()).tools.map(item => item.name)).toContain('surdet_scene_rename');
      ({ changeId } = await call('surdet_change_begin', { compositionMode: 'direct' }));
      const old = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:old' });
      const renamed = await call('surdet_scene_rename', { operationId: 'rename', sceneId: 'old', newSceneId: 'arrival', expectedFingerprint: old.fingerprint });
      expect(renamed).toMatchObject({ path: 'content/scenario/chapter/arrival.GAL', continuation: { sceneRef: 'scene:arrival', workingRevision: 1 } });
      expect(renamed.affectedPaths).toEqual(['content/scenario/chapter/arrival.GAL', 'content/scenario/chapter/old.GAL', 'content/scenario/start.gal']);
      expect(await session.invoke('object.inspect', { objectRef: 'scene:old', view: 'working' })).toMatchObject({ ok: false, error: { code: 'OBJECT_NOT_FOUND' } });
      expect((await call('surdet_object_inspect', { view: 'project', objectRef: 'scene:old' })).fingerprint).toBe(old.fingerprint);
      const scene = await call('surdet_object_inspect', { view: 'working', objectRef: renamed.continuation.sceneRef });
      const children = await Promise.all(scene.childRefs.map((objectRef: string) => call('surdet_object_inspect', { view: 'working', objectRef })));
      const text = children.find(item => item.kind === 'text');
      expect(text).toBeDefined();
      await call('surdet_scene_patch', { operationId: 'revise-after-rename', sceneId: 'arrival', patch: { kind: 'replaceText', target: text.objectRef, expectedFingerprint: text.fingerprint, speaker: '旁白', value: '片段改名后继续返修。' } });
      const preview = await new PreviewContentService().resolve(project, { kind: 'working-change', changeId });
      expect(await preview.storage.exists('content/scenario/chapter/old.GAL')).toBe(false);
      expect(preview.content.files['content/scenario/chapter/arrival.GAL']).toContain('片段改名后继续返修。');
      expect(preview.content.files['content/scenario/start.gal']).toContain('@call arrival.entry');
      expect(fs.existsSync(path.join(project, 'content/scenario/chapter/arrival.GAL'))).toBe(false);
      const diff = await call('surdet_change_diff');
      expect(diff.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'content/scenario/chapter/old.GAL', changeType: 'deleted' }),
        expect.objectContaining({ path: 'content/scenario/chapter/arrival.GAL', changeType: 'created' }),
      ]));
      expect(diff.semantic).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'scene.rename', objectBefore: 'scene:old', objectAfter: 'scene:arrival' })]));
      expect(await call('surdet_project_validate')).toMatchObject({ ok: true });
      expect(await call('surdet_project_simulate')).toMatchObject({ status: 'passed', endings: [{ ending: 'done', times: 1 }] });
      await call('surdet_runtime_run_from', { sceneId: 'start', choices: [] });
      expect((await generateDeliveryCapsule(session)).composition.eligibility).toBe('unavailable');
      expect(await session.invoke('change.commit', {})).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    } finally { await client.close(); await server.close(); await session.close(); }
    const apply = await openAgentPortSession({ projectRoot: project, policy: 'apply', resumeChangeId: changeId });
    try {
      expect(await apply.invoke('change.commit', {})).toMatchObject({ ok: true, result: { status: 'COMMITTED' } });
      expect(fs.existsSync(path.join(project, 'content/scenario/chapter/old.GAL'))).toBe(false);
      expect(fs.readFileSync(path.join(project, 'content/scenario/chapter/arrival.GAL'), 'utf8')).toContain('片段改名后继续返修。');
      expect(fs.readFileSync(path.join(project, 'content/scenario/start.gal'), 'utf8')).toContain('@call arrival.entry');
    } finally { await apply.close(); }
  }, 30000);

  it('rejects candidate, stale source and changed external caller without partial publication', async () => {
    const project = fixture();
    const candidate = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    try {
      await candidate.invoke('change.begin', {});
      const before = (await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record;
      expect(await candidate.invoke('scene.rename', { operationId: 'no', sceneId: 'old', newSceneId: 'arrival', expectedFingerprint: 'stale' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } });
      expect((await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record).toEqual(before);
    } finally { await candidate.close(); }
    const direct = await openAgentPortSession({ projectRoot: project, policy: 'apply' });
    try {
      await direct.invoke('change.begin', {});
      const read = await direct.invoke('object.inspect', { objectRef: 'scene:old', view: 'working' });
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error('fixture read failed');
      const input = { operationId: 'rename', sceneId: 'old', newSceneId: 'arrival', expectedFingerprint: (read.result as { fingerprint: string }).fingerprint };
      expect(await direct.invoke('scene.rename', { ...input, expectedFingerprint: 'stale' })).toMatchObject({ ok: false, error: { code: 'OBJECT_REF_STALE' } });
      expect(await direct.invoke('scene.rename', input)).toMatchObject({ ok: true });
      expect(await direct.invoke('project.validate', {})).toMatchObject({ ok: true, result: { ok: true } });
      expect(await direct.invoke('project.simulate', {})).toMatchObject({ ok: true, result: { status: 'passed' } });
      expect(await direct.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).toMatchObject({ ok: true, result: { status: 'passed' } });
      expect(await direct.invoke('change.diff', {})).toMatchObject({ ok: true });
      const caller = path.join(project, 'content/scenario/start.gal');
      fs.appendFileSync(caller, '// 用户另行编辑\n');
      expect(await direct.invoke('change.commit', {})).toMatchObject({ ok: false, error: { code: 'PROJECT_CHANGED_SINCE_BEGIN' } });
      expect(fs.readFileSync(caller, 'utf8')).toContain('// 用户另行编辑');
      expect(fs.existsSync(path.join(project, 'content/scenario/chapter/old.GAL'))).toBe(true);
      expect(fs.existsSync(path.join(project, 'content/scenario/chapter/arrival.GAL'))).toBe(false);
    } finally { await direct.close(); }
  }, 30000);
});
