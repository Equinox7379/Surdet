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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-move-')); roots.push(root);
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(project, 'game.config.json'), '{"entryScene":"start","variables":{},"player":{"endScenes":["start"]}}');
  fs.writeFileSync(path.join(project, 'content/scenario/start.gal'), '@scene start\n@call visit.entry\n@clear done\n@end\n');
  fs.writeFileSync(path.join(project, 'content/scenario/visit.GAL'), '@scene visit\r\n@label entry\r\n旁白：来自片段。\r\n@return\r\n');
  process.env['SURDET_AGENT_DATA_DIR'] = path.join(root, 'data');
  return project;
}

describe('public chapter scene move', () => {
  it('discovers through MCP, previews and edits the moved draft, then commits exact paths through apply', async () => {
    const project = fixture();
    const oldPath = 'content/scenario/visit.GAL';
    const source = fs.readFileSync(path.join(project, oldPath), 'utf8');
    const caller = fs.readFileSync(path.join(project, 'content/scenario/start.gal'), 'utf8');
    const config = fs.readFileSync(path.join(project, 'game.config.json'), 'utf8');
    const session = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    const server = createAgentPortServer(session);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'scene-move', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.structuredContent, JSON.stringify(result)).toMatchObject({ ok: true });
      return (result.structuredContent as { result: any }).result;
    };
    let changeId = '';
    const movedPath = 'content/scenario/第一章/街角 雨后/visit.GAL';
    try {
      expect((await client.listTools()).tools.map(item => item.name)).toContain('surdet_scene_move');
      ({ changeId } = await call('surdet_change_begin', { compositionMode: 'direct' }));
      const old = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:visit' });
      const input = { operationId: 'move', sceneId: 'visit', directory: '第一章/街角 雨后', expectedPath: old.source.path, expectedFingerprint: old.fingerprint };
      const moved = await call('surdet_scene_move', input);
      expect(moved).toMatchObject({ path: movedPath, previousPath: oldPath, continuation: { sceneRef: 'scene:visit', workingRevision: 1 } });
      expect(await call('surdet_scene_move', input)).toEqual(moved);
      expect(await session.invoke('scene.move', { ...input, operationId: 'stale-position', directory: '第二章' })).toMatchObject({ ok: false, error: { code: 'OBJECT_REF_STALE' } });
      expect(await call('surdet_object_inspect', { view: 'project', objectRef: 'scene:visit' })).toMatchObject({ source: { path: oldPath } });
      const scene = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:visit' });
      expect(scene).toMatchObject({ source: { path: movedPath }, fingerprint: old.fingerprint });
      const beforeEdit = await new PreviewContentService().resolve(project, { kind: 'working-change', changeId });
      expect(beforeEdit.content.files[movedPath]).toBe(source);
      const children = await Promise.all(scene.childRefs.map((objectRef: string) => call('surdet_object_inspect', { view: 'working', objectRef })));
      const text = children.find(item => item.kind === 'text');
      await call('surdet_scene_patch', { operationId: 'revise', sceneId: 'visit', patch: { kind: 'replaceText', target: text.objectRef, expectedFingerprint: text.fingerprint, value: '章节移动后返修。' } });
      const preview = await new PreviewContentService().resolve(project, { kind: 'working-change', changeId });
      expect(await preview.storage.exists(oldPath)).toBe(false);
      expect(preview.content.files[movedPath]).toContain('章节移动后返修。');
      expect(preview.content.files['content/scenario/start.gal']).toBe(caller);
      expect(preview.content.files['game.config.json']).toBe(config);
      expect(fs.existsSync(path.join(project, movedPath))).toBe(false);
      expect(fs.readFileSync(path.join(project, oldPath), 'utf8')).toBe(source);
      const diff = await call('surdet_change_diff');
      expect(diff.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: oldPath, changeType: 'deleted' }), expect.objectContaining({ path: movedPath, changeType: 'created' }),
      ]));
      expect(diff.semantic).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'scene.move', objectBefore: 'scene:visit', objectAfter: 'scene:visit' })]));
      expect(await call('surdet_project_validate')).toMatchObject({ ok: true });
      expect(await call('surdet_project_simulate')).toMatchObject({ status: 'passed', endings: [{ ending: 'done', times: 1 }] });
      await call('surdet_runtime_run_from', { sceneId: 'start', choices: [] });
      expect((await generateDeliveryCapsule(session)).composition.eligibility).toBe('unavailable');
      expect(await session.invoke('change.commit', {})).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    } finally { await client.close(); await server.close(); await session.close(); }
    const apply = await openAgentPortSession({ projectRoot: project, policy: 'apply', resumeChangeId: changeId });
    try {
      expect(await apply.invoke('change.commit', {})).toMatchObject({ ok: true, result: { status: 'COMMITTED' } });
      expect(fs.existsSync(path.join(project, oldPath))).toBe(false);
      expect(fs.readFileSync(path.join(project, movedPath), 'utf8')).toContain('章节移动后返修。');
      expect(fs.readFileSync(path.join(project, 'content/scenario/start.gal'), 'utf8')).toBe(caller);
      expect(fs.readFileSync(path.join(project, 'game.config.json'), 'utf8')).toBe(config);
    } finally { await apply.close(); }
  }, 30000);

  it('rejects candidate without business changes and omits stale continuation after a second move', async () => {
    const project = fixture();
    const candidate = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    try {
      await candidate.invoke('change.begin', {});
      const before = (await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record;
      expect(await candidate.invoke('scene.move', { operationId: 'no', sceneId: 'visit', directory: 'chapter', expectedPath: 'content/scenario/visit.GAL', expectedFingerprint: 'stale' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } });
      expect((await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record).toEqual(before);
    } finally { await candidate.close(); }
    const direct = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    const invoke = async (id: 'change.begin' | 'object.inspect' | 'scene.move', args: Record<string, unknown>) => {
      const response = await direct.invoke(id, args);
      expect(response).toMatchObject({ ok: true });
      if (!response.ok) throw new Error('fixture operation failed');
      return response.result as any;
    };
    try {
      await invoke('change.begin', { compositionMode: 'direct' });
      const scene = await invoke('object.inspect', { objectRef: 'scene:visit', view: 'working' });
      const input = { operationId: 'one', sceneId: 'visit', directory: 'one', expectedPath: scene.source.path, expectedFingerprint: scene.fingerprint };
      const first = await invoke('scene.move', input);
      await invoke('scene.move', { ...input, operationId: 'two', expectedPath: first.path, directory: 'two' });
      const before = (await NodeChangeStore.openByChangeId(direct.activeChangeId!))!.record;
      const replay = await invoke('scene.move', input);
      expect(replay.path).toBe(first.path);
      expect(replay.continuation).toBeUndefined();
      expect((await NodeChangeStore.openByChangeId(direct.activeChangeId!))!.record).toEqual(before);
    } finally { await direct.close(); }
  });

  it.each([false, true])('pins an implicit entry on disk; external destination occupied=%s remains protected', async occupied => {
    const project = fixture();
    fs.writeFileSync(path.join(project, 'game.config.json'), '{"variables":{},"custom":{"keep":true}}');
    const session = await openAgentPortSession({ projectRoot: project, policy: 'apply' });
    const call = async (id: Parameters<typeof session.invoke>[0], args: Record<string, unknown> = {}) => {
      const response = await session.invoke(id, args);
      expect(response).toMatchObject({ ok: true });
      if (!response.ok) throw new Error('fixture operation failed');
      return response.result as any;
    };
    const oldPath = path.join(project, 'content/scenario/start.gal');
    const newPath = path.join(project, 'content/scenario/末章/start.gal');
    const original = fs.readFileSync(oldPath, 'utf8');
    try {
      await call('change.begin');
      const scene = await call('object.inspect', { view: 'working', objectRef: 'scene:start' });
      await call('scene.move', { operationId: 'move-entry', sceneId: 'start', directory: '末章', expectedPath: scene.source.path, expectedFingerprint: scene.fingerprint });
      expect(await call('project.validate')).toMatchObject({ ok: true });
      expect(await call('project.simulate')).toMatchObject({ status: 'passed', endings: [{ ending: 'done', times: 1 }] });
      await call('runtime.run-from', { sceneId: 'start', choices: [] });
      await call('change.diff');
      if (occupied) {
        fs.mkdirSync(path.dirname(newPath), { recursive: true });
        const externalText = '@scene start\n旁白：用户的新正文。\n@end\n';
        fs.writeFileSync(newPath, externalText);
        expect(await session.invoke('change.commit', {})).toMatchObject({ ok: false, error: { code: 'PROJECT_CHANGED_SINCE_BEGIN' } });
        expect(fs.readFileSync(newPath, 'utf8')).toBe(externalText);
        expect(fs.readFileSync(oldPath, 'utf8')).toBe(original);
        expect(JSON.parse(fs.readFileSync(path.join(project, 'game.config.json'), 'utf8')).entryScene).toBeUndefined();
      } else {
        expect(await call('change.commit')).toMatchObject({ status: 'COMMITTED' });
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.readFileSync(newPath, 'utf8')).toBe(original);
        expect(JSON.parse(fs.readFileSync(path.join(project, 'game.config.json'), 'utf8'))).toEqual({ variables: {}, custom: { keep: true }, entryScene: 'start' });
      }
    } finally { await session.close(); }
  });

  it('does not publish into an existing directory under a different case spelling', async () => {
    const project = fixture();
    // A chapter can exist without any snapshot source files, so draft-only
    // collision checks cannot discover its physical spelling.
    fs.mkdirSync(path.join(project, 'content/scenario/Chapter'));
    fs.writeFileSync(path.join(project, 'content/scenario/Chapter/readme.txt'), '用户说明');
    const session = await openAgentPortSession({ projectRoot: project, policy: 'apply' });
    const call = async (id: Parameters<typeof session.invoke>[0], args: Record<string, unknown> = {}) => {
      const response = await session.invoke(id, args);
      expect(response).toMatchObject({ ok: true });
      if (!response.ok) throw new Error('fixture operation failed');
      return response.result as any;
    };
    try {
      await call('change.begin');
      const scene = await call('object.inspect', { view: 'working', objectRef: 'scene:visit' });
      await call('scene.move', { operationId: 'move', sceneId: 'visit', directory: 'chapter', expectedPath: scene.source.path, expectedFingerprint: scene.fingerprint });
      await call('project.validate'); await call('project.simulate');
      await call('runtime.run-from', { sceneId: 'start', choices: [] }); await call('change.diff');
      expect(await session.invoke('change.commit', {})).toMatchObject({ ok: false, error: { code: 'COMMIT_FAILED_RECOVERED' } });
      expect(fs.existsSync(path.join(project, 'content/scenario/visit.GAL'))).toBe(true);
      expect(fs.readdirSync(path.join(project, 'content/scenario/Chapter'))).toEqual(['readme.txt']);
      expect(fs.readFileSync(path.join(project, 'content/scenario/Chapter/readme.txt'), 'utf8')).toBe('用户说明');
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record.status).toBe('OPEN');
      // The original source is intact; correct the unpublished organization in
      // the same draft, using fresh positions rather than bypassing the guard.
      for (const [index, directory] of ['', 'Chapter'].entries()) {
        const current = await call('object.inspect', { view: 'working', objectRef: 'scene:visit' });
        await call('scene.move', { operationId: `repair-${index}`, sceneId: 'visit', directory, expectedPath: current.source.path, expectedFingerprint: current.fingerprint });
      }
      await call('project.validate'); await call('project.simulate');
      await call('runtime.run-from', { sceneId: 'start', choices: [] }); await call('change.diff');
      expect(await call('change.commit')).toMatchObject({ status: 'COMMITTED' });
      expect(fs.existsSync(path.join(project, 'content/scenario/visit.GAL'))).toBe(false);
      expect(fs.readdirSync(path.join(project, 'content/scenario/Chapter')).sort()).toEqual(['readme.txt', 'visit.GAL']);
    } finally { await session.close(); }
  });
});
