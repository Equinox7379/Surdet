import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';

const roots: string[] = [], priorData = process.env['SURDET_AGENT_DATA_DIR'];
afterEach(() => {
  if (priorData === undefined) delete process.env['SURDET_AGENT_DATA_DIR']; else process.env['SURDET_AGENT_DATA_DIR'] = priorData;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-script-import-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), '{"entryScene":"start","variables":{},"characters":{"rin":{"name":"凛"}}}');
  fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n旁白：开场。\n@end\n');
  process.env['SURDET_AGENT_DATA_DIR'] = path.join(root, 'agent-data');
  return root;
}
describe('public script import preview', () => {
  it('discovers and previews through MCP observe, with malformed input and explicit working view rejected safely', async () => {
    const project = fixture(), session = await openAgentPortSession({ projectRoot: project, policy: 'observe' });
    const server = createAgentPortServer(session), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'script-import', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('surdet_script_import_preview');
      const result = await client.callTool({ name: 'surdet_script_import_preview', arguments: { format: 'csv', source: 'speaker,text\n凛,"雨停了,走吧。"' } });
      expect(result.structuredContent, JSON.stringify(result)).toMatchObject({ ok: true, result: {
        view: 'project', ready: true, rows: [{ line: 2, characterIds: ['rin'] }], blocks: [{ kind: 'text', speaker: '凛', value: '雨停了,走吧。' }],
      } });
      expect(await session.invoke('script.import.preview', { format: 'text', source: '@jump secret', view: 'working' })).toMatchObject({ ok: false, error: { code: 'CHANGE_NOT_FOUND' } });
      expect(await session.invoke('script.import.preview', { format: 'text', source: '@jump secret' })).toMatchObject({ ok: true, result: { ready: false, blocks: [] } });
      expect(await session.invoke('script.import.preview', { format: 'csv', source: 'text\n正文', textColumn: -1 })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(fs.readdirSync(path.join(project, 'content/scenario'))).toEqual(['start.gal']);
    } finally { await client.close(); await server.close(); await session.close(); }
  });
  it('uses working characters without mutating the change, then creates an ordinary candidate through scene.create', async () => {
    const project = fixture(), session = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
    const call = async (id: Parameters<typeof session.invoke>[0], input: Record<string, unknown> = {}) => {
      const value = await session.invoke(id, input); expect(value.ok, JSON.stringify(value)).toBe(true);
      return (value as { result: any }).result;
    };
    try {
      await call('change.begin');
      const facts = await call('project.inspect', { view: 'working' });
      await call('character.ensure', { operationId: 'role', id: 'nova', name: '诺瓦', expectedFingerprint: facts.charactersFingerprint });
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const input = { format: 'text', source: '诺瓦：导入第一句。\n凛：@jump secret' };
      const preview = await call('script.import.preview', { ...input, view: 'working' });
      expect(preview).toMatchObject({ ready: true, view: 'working', rows: [{ characterIds: ['nova'] }, { characterIds: ['rin'] }] });
      expect((await call('script.import.preview', { ...input, view: 'project' })).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNKNOWN_SPEAKER' })]));
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      const create = { operationId: 'import-new', sceneId: 'imported', blocks: preview.blocks };
      const created = await call('scene.create', create); expect(await call('scene.create', create)).toEqual(created);
      const after = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      expect(after.workingFiles['content/scenario/imported.gal']).toBe('@scene imported\n诺瓦：导入第一句。\n凛：@jump secret\n@end\n');
      expect(await session.invoke('scene.create', { ...create, operationId: 'duplicate' })).toMatchObject({ ok: false, error: { code: 'OBJECT_PRECONDITION_FAILED' } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record.workingFiles).toEqual(after.workingFiles);
      await call('project.validate'); await call('runtime.run-from', { sceneId: 'imported', choices: [] });
      expect(fs.existsSync(path.join(project, 'content/scenario/imported.gal'))).toBe(false);
      expect(fs.readFileSync(path.join(project, 'game.config.json'), 'utf8')).not.toContain('nova');
    } finally { await session.close(); }
  });
  it('exposes the same read-only conversion through the native CLI JSON input', () => {
    const project = fixture();
    const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'script', 'import', 'preview', '--project', project, '--input', '-', '--json'], {
      input: JSON.stringify({ format: 'text', source: '凛：原生入口。' }), encoding: 'utf8', env: process.env,
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, result: { ready: true, blocks: [{ kind: 'text', speaker: '凛', value: '原生入口。' }] } });
    expect(fs.readdirSync(path.join(project, 'content/scenario'))).toEqual(['start.gal']);
  });
});
