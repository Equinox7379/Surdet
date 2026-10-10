import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORING_CAPABILITY_REGISTRY,
  createEnvelopeJsonSchema,
  nativeCapabilityToMcpTool,
} from '@surdet/authoring';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';
import { allowedCapabilitiesForPolicy } from '../src/agent-port/policy.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { projectCapabilityTool } from '../src/agent-port/tool-projection.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-tools-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

function textContent(result: { content?: readonly unknown[] }): string {
  const text = result.content?.find((item): item is { type: 'text'; text: string } => (
    typeof item === 'object'
    && item !== null
    && (item as { type?: unknown }).type === 'text'
    && typeof (item as { text?: unknown }).text === 'string'
  ))?.text;
  if (text === undefined) throw new Error('MCP result did not contain a text content block');
  return text;
}

function textEnvelope(result: { content?: readonly unknown[] }): Record<string, unknown> {
  const text = textContent(result);
  return JSON.parse(text) as Record<string, unknown>;
}

async function sessionFor(policy: 'observe' | 'stage' | 'apply'): Promise<AgentPortSession> {
  const root = makeProject(policy);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-tools-data-'));
  temporaryRoots.push(data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy });
}

async function connected(policy: 'observe' | 'stage' | 'apply'): Promise<{ session: AgentPortSession; client: Client; server: ReturnType<typeof createAgentPortServer> }> {
  const session = await sessionFor(policy);
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agent-port-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { session, client, server };
}

async function connectedProject(projectRoot: string, policy: 'observe' | 'stage' | 'apply'): Promise<{ session: AgentPortSession; client: Client; server: ReturnType<typeof createAgentPortServer> }> {
  const session = await openAgentPortSession({ projectRoot, policy });
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agent-port-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { session, client, server };
}

describe('Surdet Agent Port MCP tool projection', () => {
  it('flow insertBefore is publicly callable in a candidate and carries the real target dependency', async () => {
    const { session, client, server } = await connected('stage');
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }); expect(result.isError, textContent(result)).not.toBe(true);
      return (result.structuredContent as any).result;
    };
    try {
      await call('surdet_change_begin', { compositionMode: 'candidate' });
      await call('surdet_scene_create', { operationId: 'flow-destination', sceneId: 'destination', blocks: [{ kind: 'text', value: '已到目的地。' }] });
      const scene = await call('surdet_object_inspect', { objectRef: 'scene:start', view: 'working' });
      const children = await Promise.all(scene.childRefs.map((objectRef: string) => call('surdet_object_inspect', { objectRef, view: 'working' })));
      const end = children.find((object: any) => object.source?.raw === '@end');
      const patched = await call('surdet_scene_patch', { operationId: 'flow-connect', patch: { kind: 'insertBefore', anchor: end.objectRef,
        expectedFingerprint: end.fingerprint, blocks: [{ kind: 'instruction', name: 'jump', args: ['destination'] }] } });
      expect(patched.kind).toBe('insertBefore');
      const route = await call('surdet_project_preview_path', { view: 'working', sceneId: 'destination', line: 1 });
      expect(route.status).toBe('reached');
      expect((await session.describe()).candidateReadiness?.status).toBe('ready');
      const opened = await NodeChangeStore.openForProject(session.activeChangeId!, session.projectRoot);
      expect(opened?.record.operations['flow-connect']?.compositionFacts?.requiredObjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectRef: 'scene:destination', source: 'candidate' }),
      ]));
      expect(fs.readFileSync(path.join(session.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe('@scene start\n凛：开始。\n@end\n');
    } finally { await client.close(); await server.close(); await session.close(); }
  });
  it('preview-path distinguishes a working draft from project without writing simulation evidence', async () => {
    const { session, client, server } = await connected('stage');
    try {
      await client.callTool({ name: 'surdet_change_begin', arguments: { compositionMode: 'direct' } });
      const created = await client.callTool({ name: 'surdet_scene_create', arguments: { operationId: 'preview-path-draft', sceneId: 'draft', blocks: [{ kind: 'text', value: '草稿正文' }] } });
      expect(created.isError, textContent(created)).not.toBe(true);
      const query = { sceneId: 'draft', line: 1, mode: 'test' };
      const working = await client.callTool({ name: 'surdet_project_preview_path', arguments: { ...query, view: 'working' } });
      expect(working.isError, textContent(working)).not.toBe(true);
      expect((working.structuredContent as any).result).toMatchObject({ view: 'working', status: 'reached', partialStage: true });
      const project = await client.callTool({ name: 'surdet_project_preview_path', arguments: { ...query, view: 'project' } });
      expect((project.structuredContent as any).error.code).toBe('OBJECT_NOT_FOUND');
      expect(fs.existsSync(path.join(session.projectRoot, 'content', 'scenario', 'draft.gal'))).toBe(false);
      expect((await session.describe()).evidence.simulation?.status).toBe('missing');
    } finally { await client.close(); await server.close(); await session.close(); }
  });
  it('preview-path reads through the public observe MCP tool without authoring or simulation evidence', async () => {
    const { session, client, server } = await connected('observe');
    try {
      const root = session.projectRoot;
      const script = path.join(root, 'content', 'scenario', 'start.gal');
      const before = fs.readFileSync(script, 'utf8');
      const result = await client.callTool({ name: 'surdet_project_preview_path', arguments: { sceneId: 'start', line: 2 } });
      expect(result.isError).not.toBe(true);
      expect((result.structuredContent as any).result).toMatchObject({ view: 'project', status: 'reached', choices: [], position: { sceneId: 'start', line: 2 } });
      expect(session.activeChangeId).toBeUndefined();
      expect(fs.readFileSync(script, 'utf8')).toBe(before);
      const wrongView = await client.callTool({ name: 'surdet_project_preview_path', arguments: { sceneId: 'start', line: 2, view: 'working' } });
      expect((wrongView.structuredContent as any).error.code).toBe('CHANGE_NOT_FOUND');
    } finally { await client.close(); await server.close(); await session.close(); }
  });
  it('accepts each advertised minimal example at the actual MCP schema boundary', async () => {
    for (const capability of AUTHORING_CAPABILITY_REGISTRY) {
      const result = await standardSchemaFromJson(capability.inputSchema)['~standard'].validate(capability.minimalExample.input);
      expect(result.issues, capability.id).toBeUndefined();
    }
  });
  it('records saved history and repairs malformed content through real MCP tools before authorized writeback', async () => {
    const { session, client, server } = await connected('apply');
    const root = session.projectRoot;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, textContent(response)).not.toBe(true);
      expect(textEnvelope(response).ok).toBe(true);
      return (response.structuredContent as any).result;
    };
    try {
      const index = await call('surdet_project_history');
      const request = { operationId: '123e4567-e89b-42d3-a456-426614174001', label: 'MCP 可用版', expectedContentRevision: index.contentRevision };
      const saved = await call('surdet_project_history_checkpoint', request);
      expect(await call('surdet_project_history_checkpoint', request)).toEqual(saved);
      fs.writeFileSync(path.join(root, 'game.config.json'), '{broken');
      const begin = await call('surdet_change_begin', { compositionMode: 'direct' });
      const compared = await call('surdet_project_history_compare', { checkpointId: saved.checkpointId, view: 'working', path: 'game.config.json' });
      expect(compared.files[0].currentText).toBe('{broken');
      const restore = { operationId: 'mcp-restore', checkpointId: saved.checkpointId, expectedFingerprint: compared.checkpoint.fingerprint,
        expectedContentRevision: compared.contentRevision, expectedWorkingRevision: compared.workingRevision, paths: ['game.config.json'] };
      await call('surdet_project_history_restore', restore);
      await call('surdet_project_history_restore', restore);
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe('{broken');
      await call('surdet_change_diff'); await call('surdet_project_validate'); await call('surdet_project_simulate');
      await call('surdet_runtime_run_from', { sceneId: 'start', choices: [], seed: 1 });
      const capsule = await call('surdet_delivery_capsule', { label: '损坏来源已在草稿修复' });
      expect(capsule.composition).toMatchObject({ eligibility: 'unavailable', reasons: [{ code: 'DIRECT_CHANGE' }] });
      expect((await call('surdet_change_commit')).status).toBe('COMMITTED');
      expect(JSON.parse(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).entryScene).toBe('start');
      expect((await NodeChangeStore.openByChangeId(begin.changeId))!.record.workingRevision).toBe(1);
      const candidate = await call('surdet_change_begin', { compositionMode: 'candidate' });
      const beforeCandidate = (await NodeChangeStore.openByChangeId(candidate.changeId))!.record;
      const refused = await client.callTool({ name: 'surdet_project_history_restore', arguments: restore });
      expect(refused.isError).toBe(true);
      expect((refused.structuredContent as any).error.code).toBe('UNSUPPORTED_OPERATION');
      expect((await NodeChangeStore.openByChangeId(candidate.changeId))!.record).toEqual(beforeCandidate);
    } finally { await client.close(); await server.close(); await session.close(); }
  }, 15_000);
  it('preserves nonempty number arrays across real MCP inspection, simulation and runtime results', async () => {
    const root = makeProject('number-array-contract');
    const variables = {
      numbers: { type: 'number[]', initial: [2, 5], readonly: true },
      empty: { type: 'number[]', initial: [] },
      bag: { type: 'string[]', initial: ['车票'] },
      inventory: { type: 'object', initial: { stats: { hp: 2 }, rewards: [{ score: 5 }], numeric: [2, 5] } },
      trust: { type: 'number', initial: 0 },
      name: { type: 'string', initial: '旅人' },
      gate: { type: 'flag', initial: true },
    };
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables }));
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n@set trust = 1\n旁白：继续。\n@end\n');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-number-contract-data-'));
    temporaryRoots.push(data); process.env['SURDET_AGENT_DATA_DIR'] = data;
    const { session, client, server } = await connectedProject(root, 'stage');
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, textContent(response)).not.toBe(true);
      expect(textEnvelope(response).ok).toBe(true);
      return (response.structuredContent as any).result;
    };
    try {
      await call('surdet_change_begin', { compositionMode: 'direct' });
      const inspected = await call('surdet_project_inspect');
      expect(inspected.variables.find((entry: any) => entry.name === 'numbers').declaration.initial).toEqual([2, 5]);
      const ensured = await call('surdet_variable_ensure', { operationId: 'array-initial', name: 'extra', type: 'number[]', initial: [7, 9] });
      expect(ensured).toBeTruthy();
      const inventoryObject = await call('surdet_object_inspect', { objectRef: 'variable:inventory' });
      const inventory = { stats: { hp: 3 }, rewards: [{ score: 7 }], numeric: [5, 8] };
      await call('surdet_variable_patch_initial', { operationId: 'object-initial', name: 'inventory', expectedFingerprint: inventoryObject.fingerprint, initial: inventory });
      const expected = { numbers: [2, 5], empty: [], bag: ['车票'], inventory, trust: 1, name: '旅人', gate: true, extra: [7, 9] };
      const simulation = await call('surdet_project_simulate');
      expect(simulation.report.paths[0].finalVariables).toEqual(expected);
      const run = await call('surdet_runtime_run_from', { sceneId: 'start', choices: [] });
      expect(run.finalVariables).toEqual(expected);
      await call('surdet_runtime_read_trace', { traceId: run.traceId });
      const runSchema = AUTHORING_CAPABILITY_REGISTRY.find(item => item.id === 'runtime.run-from')!.outputSchema;
      const validator = standardSchemaFromJson(runSchema);
      for (const invalid of [{ ...run, finalVariables: { illegal: () => 1 } }, { ...run, unexpected: true }, { ...run, status: 'failed' }]) {
        expect((await validator['~standard'].validate(invalid)).issues).toBeDefined();
      }
      const rejected = await client.callTool({ name: 'surdet_runtime_run_from', arguments: { sceneId: 'start', choices: [], variables: { numbers: [[2, 5]] } } });
      expect(rejected.isError).toBe(true);
      expect(textEnvelope(rejected)).toMatchObject({ ok: false }); // JSON-safe does not bypass the declared number[] type.
      expect((await standardSchemaFromJson(createEnvelopeJsonSchema(runSchema))['~standard'].validate(rejected.structuredContent)).issues).toBeUndefined();
      const malformed = await client.callTool({ name: 'surdet_runtime_run_from', arguments: { sceneId: 'start', choices: [], unexpected: true } });
      expect(malformed.isError).toBe(true);
      expect(textContent(malformed)).toContain('Input validation error');
      expect(malformed.structuredContent).toBeUndefined(); // Protocol rejection is not a fabricated domain envelope.
    } finally { await client.close(); await server.close(); await session.close(); }
  });

  it.each([false, true])('rejects missing dossier definitions through public validation (gallery file %s)', async present => {
    const root = makeProject('missing-gallery');
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n@unlock_profile absent_profile\n@unlock_term absent_term\n@end\n');
    const galleryPath = path.join(root, 'content/config/gallery.json');
    if (present) { fs.mkdirSync(path.dirname(galleryPath), { recursive: true }); fs.writeFileSync(galleryPath, '{"cgs":[],"music":[]}'); }
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-missing-gallery-data-'));
    temporaryRoots.push(data); process.env['SURDET_AGENT_DATA_DIR'] = data;
    const { session, client, server } = await connectedProject(root, 'stage');
    try {
      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: { compositionMode: 'direct' } });
      expect(textEnvelope(begun)).toMatchObject({ ok: true, result: { compositionMode: 'direct' } });
      const response = await client.callTool({ name: 'surdet_project_validate', arguments: {} });
      expect(response.isError, textContent(response)).not.toBe(true);
      const envelope = textEnvelope(response) as { result: { ok: boolean; issues: { code: string; file: string; line: number }[] } };
      expect(envelope.result).toMatchObject({ ok: false, view: 'working' });
      expect(envelope.result.issues.filter(issue => issue.code === 'G006').map(issue => ({ file: issue.file, line: issue.line })))
        .toEqual([2, 3].map(line => ({ file: 'content/scenario/start.gal', line })));
      expect(fs.existsSync(galleryPath)).toBe(present);
    } finally { await client.close(); await server.close(); await session.close(); }
  });

  it('authors character dossiers, canonical terms and translations through the public tools', async () => {
    const { session, client, server } = await connected('apply');
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args }); expect(response.isError, textContent(response)).not.toBe(true);
      return (response.structuredContent as any).result;
    };
    try {
      await call('surdet_change_begin', { compositionMode: 'direct' });
      const config = await call('surdet_project_inspect', { view: 'working' });
      await call('surdet_character_ensure', { operationId: 'rin', id: 'rin', name: '凛', expectedFingerprint: config.charactersFingerprint });
      await call('surdet_gallery_profile_create', { operationId: 'intro', id: 'intro', character: 'rin', title: '初见', description: '在车站相遇。' });
      await call('surdet_gallery_profile_create', { operationId: 'secret', id: 'secret', character: 'rin', title: '往事', description: '隐藏资料。' });
      await call('surdet_gallery_term_create', { operationId: 'port', id: 'port', canonical: '雾港', description: '海边的小城。' });
      expect((await call('surdet_project_gallery', { view: 'project' })).profiles).toEqual([]);
      const gallery = await call('surdet_project_gallery', { view: 'working' });
      await call('surdet_gallery_profile_patch', { operationId: 'intro-edit', id: 'intro', expectedFingerprint: gallery.profiles[0].fingerprint, patch: { description: '已经修订的初见。' } });
      const stale = await client.callTool({ name: 'surdet_gallery_profile_patch', arguments: { operationId: 'stale', id: 'intro', expectedFingerprint: gallery.profiles[0].fingerprint, patch: { title: '过期' } } });
      expect(stale.structuredContent).toMatchObject({ error: { code: 'OBJECT_REF_STALE' } });
      await call('surdet_gallery_policy_patch', { operationId: 'policy', expectedFingerprint: gallery.unlockPolicy.fingerprint, patch: { profiles: 'profile', terms: 'save' } });
      const termPatch = { operationId: 'port-edit', id: 'port', expectedFingerprint: gallery.terms[0].fingerprint,
        patch: { canonical: '灯港', description: '已经修订的港口资料。' } };
      const patchedTerm = await call('surdet_gallery_term_patch', termPatch);
      expect(patchedTerm.entry).toMatchObject({ id: 'port', canonical: '灯港', description: '已经修订的港口资料。' });
      expect(await call('surdet_gallery_term_patch', termPatch)).toEqual(patchedTerm);
      const withoutDescription = await call('surdet_gallery_term_patch', { operationId: 'port-description-remove', id: 'port',
        expectedFingerprint: patchedTerm.fingerprint, patch: { description: null } });
      expect(withoutDescription.entry).not.toHaveProperty('description');
      await call('surdet_gallery_term_patch', { operationId: 'port-description-restore', id: 'port',
        expectedFingerprint: withoutDescription.fingerprint, patch: { description: '已经修订的港口资料。' } });
      expect((await call('surdet_project_gallery', { view: 'project' })).terms).toEqual([]);
      const object = await call('surdet_object_inspect', { view: 'working', objectRef: 'gallery:profiles:intro' });
      expect(object.references).toContain('character:rin');
      const known = await call('surdet_project_inspect', { view: 'working' });
      const removed = await client.callTool({ name: 'surdet_character_remove', arguments: { operationId: 'remove-rin', id: 'rin', expectedFingerprint: known.charactersFingerprint } });
      expect(removed.structuredContent).toMatchObject({ error: { code: 'OBJECT_PRECONDITION_FAILED' } });
      await call('surdet_character_ensure', { operationId: 'unused-character', id: 'unused', name: '路人', expectedFingerprint: known.charactersFingerprint });
      const removable = await call('surdet_project_inspect', { view: 'working' });
      const removal = { operationId: 'remove-unused', id: 'unused', expectedFingerprint: removable.charactersFingerprint };
      const removalResult = await call('surdet_character_remove', removal);
      expect(removalResult).toMatchObject({ id: 'unused', removed: true });
      expect(await call('surdet_character_remove', removal)).toEqual(removalResult);
      expect((await call('surdet_project_inspect', { view: 'working' })).characters.map((character: { id: string }) => character.id)).toEqual(['rin']);
      await call('surdet_scene_create', { operationId: 'dossiers', sceneId: 'dossiers', blocks: [
        { kind: 'instruction', name: 'unlock_profile', args: ['"intro"'] }, { kind: 'instruction', name: 'unlock_profile', args: ['secret'] },
        { kind: 'instruction', name: 'unlock_term', args: ['port'] }, { kind: 'text', value: '资料已解锁。' },
      ] });
      const sources = await call('surdet_project_texts', { view: 'working' });
      const description = sources.sources.find((source: any) => source.kind === 'gallery' && source.objectRef === 'gallery:terms:port' && source.field === 'description');
      expect(description).toBeDefined();
      await call('surdet_project_texts_patch', { operationId: 'bind-description', expectedRevision: sources.revision, expectedFingerprint: sources.fingerprint,
        patch: { type: 'bind', sourceLocale: 'zh-CN', bindings: [{ key: 'port.description', sourceId: description.sourceId }] } });
      const exported = await call('surdet_project_texts', { view: 'working', format: 'csv', locale: 'en' });
      const csv = exported.csv.replace('"","untranslated"', '"A seaside town.","untranslated"');
      expect(csv).not.toBe(exported.csv);
      const preview = await call('surdet_project_texts_import_preview', { view: 'working', locale: 'en', csv });
      expect(preview.ready).toBe(true);
      await call('surdet_project_texts_patch', { operationId: 'import-description', expectedRevision: preview.revision, expectedFingerprint: preview.fingerprint,
        patch: { type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint } });
      expect((await call('surdet_project_validate')).ok).toBe(true);
      await call('surdet_project_simulate'); await call('surdet_runtime_run_from', { sceneId: 'dossiers', choices: [] });
      await call('surdet_change_diff'); await call('surdet_delivery_capsule', { label: '人物与用语资料' }); await call('surdet_change_commit');
      const saved = JSON.parse(fs.readFileSync(path.join(session.projectRoot, 'content/config/gallery.json'), 'utf8'));
      expect(saved.profiles[0].description).toBe('已经修订的初见。');
      expect(saved.terms[0]).toMatchObject({ canonical: '灯港', description: '已经修订的港口资料。' });
      expect(JSON.parse(fs.readFileSync(path.join(session.projectRoot, 'content/config/terminology.json'), 'utf8')).terms).toEqual([{ canonical: '雾港', variants: [] }, { canonical: '灯港', variants: [] }]);
      const savedConfig = JSON.parse(fs.readFileSync(path.join(session.projectRoot, 'game.config.json'), 'utf8'));
      expect(savedConfig.textCatalog.entries[0].translations.en.value).toBe('A seaside town.');
      expect(savedConfig.characters).toEqual({ rin: { name: '凛' } });
    } finally { await client.close(); await server.close(); await session.close(); }
  });
  it('authors replay and ending entries through public tools, validates and commits them', async () => {
    const { session, client, server } = await connected('apply');
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, textContent(response)).not.toBe(true);
      return (response.structuredContent as any).result;
    };
    try {
      await call('surdet_change_begin', { compositionMode: 'direct' });
      await call('surdet_variable_ensure', { operationId: 'score', name: 'score', type: 'number', initial: 0 });
      await call('surdet_gallery_text_create', { operationId: 'memory', id: 'memory', name: '回想', scene: 'start', variables: { score: 3 } });
      await call('surdet_gallery_ending_create', { operationId: 'ending', id: 'home', name: '归途', description: '雨停了。' });
      expect((await call('surdet_project_gallery', { view: 'project' })).endings).toEqual([]);
      await call('surdet_scene_create', { operationId: 'unlock', sceneId: 'unlock_memory', blocks: [
        { kind: 'instruction', name: 'unlock_text', args: ['memory'] }, { kind: 'instruction', name: 'clear', args: ['home'] }, { kind: 'text', value: '回想已解锁。' },
      ] });
      const gallery = await call('surdet_project_gallery', { view: 'working' });
      expect(gallery.texts).toContainEqual(expect.objectContaining({ id: 'memory', variables: { score: 3 } }));
      const ending = gallery.endings[0];
      await call('surdet_gallery_ending_patch', { operationId: 'ending-name', id: 'home', expectedFingerprint: ending.fingerprint, patch: { name: '雨后归途' } });
      const oldEnding = await client.callTool({ name: 'surdet_gallery_ending_patch', arguments: { operationId: 'ending-stale', id: 'home', expectedFingerprint: ending.fingerprint, patch: { name: '过期' } } });
      expect(oldEnding.structuredContent).toMatchObject({ error: { code: 'OBJECT_REF_STALE' } });
      expect(await call('surdet_object_inspect', { view: 'working', objectRef: ending.objectRef })).toMatchObject({ kind: 'gallery-ending', details: { name: '雨后归途' } });
      await call('surdet_gallery_text_patch', { operationId: 'conditions', id: 'memory', expectedFingerprint: gallery.texts[0].fingerprint, patch: { variables: { score: 4 } } });
      const stale = await client.callTool({ name: 'surdet_gallery_text_patch', arguments: { operationId: 'stale', id: 'memory', expectedFingerprint: gallery.texts[0].fingerprint, patch: { name: '过期' } } });
      expect((stale.structuredContent as any).error.code).toBe('OBJECT_REF_STALE');
      await call('surdet_gallery_policy_patch', { operationId: 'policy', expectedFingerprint: gallery.unlockPolicy.fingerprint, patch: { texts: 'profile', endings: 'profile' } });
      const inspected = await call('surdet_object_inspect', { objectRef: 'gallery:texts:memory' });
      expect(inspected.references).toEqual(expect.arrayContaining(['scene:start', 'variable:score']));
      const validation = await call('surdet_project_validate');
      expect(validation.ok, JSON.stringify(validation)).toBe(true);
      await call('surdet_project_simulate'); await call('surdet_change_diff');
      await call('surdet_runtime_run_from', { sceneId: 'unlock_memory', choices: [] });
      await call('surdet_delivery_capsule', { label: '回想配置' });
      await call('surdet_change_commit');
      expect(JSON.parse(fs.readFileSync(path.join(session.projectRoot, 'content/config/gallery.json'), 'utf8'))).toMatchObject({ unlockPolicy: { texts: 'profile', endings: 'profile' }, texts: [{ variables: { score: 4 } }], endings: [{ id: 'home', name: '雨后归途', description: '雨停了。' }] });
    } finally { await client.close(); await server.close(); await session.close(); }
  });
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('authors and repairs a stage from public reads without guessing compiled instruction indices', async () => {
    const { session, client, server } = await connected('stage');
    const sourceConfig = fs.readFileSync(path.join(session.projectRoot, 'game.config.json'), 'utf8');
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, textContent(response)).not.toBe(true);
      return (response.structuredContent as any).result;
    };
    try {
      const portrait = path.join(session.projectRoot, 'content/assets/portrait/rin_coat_normal.svg');
      fs.mkdirSync(path.dirname(portrait), { recursive: true });
      fs.writeFileSync(portrait, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"/>');
      const begun = await call('surdet_change_begin', { compositionMode: 'direct' });
      const before = await call('surdet_project_inspect', { view: 'working' });
      expect(before.stageConfig.value).toBeNull();
      await call('surdet_project_stage_config_patch', { operationId: 'stage-preset', expectedFingerprint: before.stageConfig.fingerprint,
        patch: { version: 1, positions: { pier: { x: 500, y: 690 } }, distances: { close: 1.4 } } });
      expect((await call('surdet_project_inspect', { view: 'project' })).stageConfig.value).toBeNull();
      expect((await call('surdet_project_inspect', { view: 'working' })).stageConfig.effective.positions.pier.x).toBe(500);
      const stale = await client.callTool({ name: 'surdet_project_stage_config_patch', arguments: {
        operationId: 'stale-stage-preset', expectedFingerprint: before.stageConfig.fingerprint, patch: { positions: {} },
      } });
      expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'OBJECT_REF_STALE' } });
      await call('surdet_scene_create', { operationId: 'stage-scene', sceneId: 'stage_demo', blocks: [
        { kind: 'instruction', name: 'show', args: ['rin:coat', 'normal'], modifiers: { pos: 'pier', scale: '1.2' } },
        { kind: 'text', value: '同一舞台草稿。' },
      ] });
      const scene = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:stage_demo' });
      const objects = await Promise.all(scene.childRefs.map((objectRef: string) => call('surdet_object_inspect', { view: 'working', objectRef })));
      const show = objects.find(value => value.kind === 'instruction' && value.source.raw.includes('@show'));
      expect(show.details?.stageInstructions).toEqual([expect.objectContaining({ name: 'show', instructionIndex: expect.any(Number) })]);
      await call('surdet_scene_patch', { operationId: 'stage-scene-pose', patch: { kind: 'patchStageProperties',
        target: show.objectRef, expectedFingerprint: show.fingerprint, instructionIndex: show.details.stageInstructions[0].instructionIndex,
        values: { x: 710, facing: 'left' } } });
      const changed = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:stage_demo', fragment: {} });
      expect(changed.fragment.lines.some((line: { text: string }) => line.text.includes('@x=710') && line.text.includes('@facing=left'))).toBe(true);
      const opened = await NodeChangeStore.openByChangeId(begun.changeId);
      expect(opened!.record.workingRevision).toBe(3);
      expect(opened!.record.operations).not.toHaveProperty('stale-stage-preset');
      expect(fs.readFileSync(path.join(session.projectRoot, 'game.config.json'), 'utf8')).toBe(sourceConfig);
      expect(fs.existsSync(path.join(session.projectRoot, 'content/scenario/stage_demo.gal'))).toBe(false);
    } finally { await client.close(); await server.close(); await session.close(); }
  });

  it('projects each registry definition into one typed MCP tool', () => {
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      const tool = projectCapabilityTool(definition);
      expect(tool.name).toBe(nativeCapabilityToMcpTool(definition.id));
      expect(tool.title).toBe(definition.title);
      expect(tool.description).toContain(definition.purpose);
      expect((tool.inputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' })).toEqual(definition.inputSchema);
      expect((tool.outputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' })).toEqual(createEnvelopeJsonSchema(definition.outputSchema));
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    expect((standardSchemaFromJson(AUTHORING_CAPABILITY_REGISTRY[0]!.inputSchema)['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' })).toEqual(
      AUTHORING_CAPABILITY_REGISTRY[0]!.inputSchema,
    );

    const sceneCreate = projectCapabilityTool(AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'scene.create')!);
    const sceneCreateSchema = (sceneCreate.inputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' });
    const instruction = sceneCreateSchema.properties.blocks.items.oneOf.find((schema: any) => schema.properties?.kind?.const === 'instruction');
    expect(instruction.properties.name.description).toContain("exactly 'timeline'");

    const runFrom = projectCapabilityTool(AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'runtime.run-from')!);
    const runFromSchema = (runFrom.inputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' });
    expect(runFromSchema.properties.label.description).toContain('in-scene @label');
  });

  it.each([
    ['observe', allowedCapabilitiesForPolicy('observe')],
    ['stage', allowedCapabilitiesForPolicy('stage')],
    ['apply', allowedCapabilitiesForPolicy('apply')],
  ] as const)('lists exactly the registry-derived %s policy tools plus session describe', async (policy, allowed) => {
    const { session, client, server } = await connected(policy);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    const capsuleExposed = policy !== 'observe';
    expect(names).toHaveLength(allowed.length + 1 + (capsuleExposed ? 1 : 0));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('surdet_session_describe');
    if (capsuleExposed) {
      expect(names).toContain('surdet_delivery_capsule');
      expect(listed.tools.find((tool) => tool.name === 'surdet_delivery_capsule')?.annotations?.readOnlyHint).toBe(false);
    }
    for (const id of allowed) expect(names).toContain(nativeCapabilityToMcpTool(id));
    if (policy === 'observe') {
      expect(names).not.toContain('surdet_change_begin');
      expect(names).not.toContain('surdet_runtime_run_from');
      expect(names).not.toContain('surdet_change_rollback');
      expect(names).not.toContain('surdet_change_commit');
    }
    // Wave 5：observe 只暴露 compare/plan/inspect，不暴露 execute；stage/apply 全部四项。
    if (policy === 'observe') {
      expect(names).toContain('surdet_composition_compare');
      expect(names).toContain('surdet_composition_plan');
      expect(names).toContain('surdet_composition_inspect');
      expect(names).not.toContain('surdet_composition_execute');
    } else {
      for (const tool of ['surdet_composition_compare', 'surdet_composition_plan', 'surdet_composition_inspect', 'surdet_composition_execute']) {
        expect(names).toContain(tool);
      }
    }
    expect(names).toContain(nativeCapabilityToMcpTool('change.recovery.inspect'));
    if (policy === 'stage') {
      expect(names).not.toContain('surdet_change_commit');
      expect(names).not.toContain(nativeCapabilityToMcpTool('change.recovery.execute'));
      for (const action of ['commit', 'recover', 'undo'] as const) expect(names).not.toContain(nativeCapabilityToMcpTool(`asset.relocation.${action}`));
      expect(names).toHaveLength(67);
   }
   if (policy === 'apply') {
     expect(names).toContain(nativeCapabilityToMcpTool('change.recovery.execute'));
      for (const action of ['commit', 'recover', 'undo'] as const) expect(names).toContain(nativeCapabilityToMcpTool(`asset.relocation.${action}`));
      expect(names).toHaveLength(74);
   }
   const described = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
    expect(described.isError).not.toBe(true);
    expect((described.structuredContent as any).ok).toBe(true);
    const capabilities = await client.callTool({ name: 'surdet_capabilities_describe', arguments: {} });
    expect(capabilities.isError).not.toBe(true);
    expect((capabilities.structuredContent as any).ok).toBe(true);
    expect((capabilities.structuredContent as any).result.capabilities).toHaveLength(73);
    expect(names).not.toContain('surdet_review_write_decision');
    expect(names).not.toContain('surdet_review_approve');
    if (policy === 'stage') {
      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: {} });
      expect(begun.isError).not.toBe(true);
      const capsule = await client.callTool({ name: 'surdet_delivery_capsule', arguments: { label: 'tool projection test' } });
      expect(capsule.isError).not.toBe(true);
      expect((capsule.structuredContent as any).ok).toBe(true);
      expect((capsule.structuredContent as any).result.artifactIdentity.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    await client.close();
    await server.close();
    await session.close();
  });

  it('returns structured Surdet failures as tool errors and keeps protocol errors distinct', async () => {
    const { session, client, server } = await connected('stage');
    const failed = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:missing' } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toEqual(expect.objectContaining({ ok: false }));
    expect((failed.structuredContent as any).error.code).toBe('OBJECT_NOT_FOUND');
    await expect(client.callTool({ name: 'surdet_not_registered', arguments: {} })).rejects.toThrow();
    await client.close();
    await server.close();
    await session.close();
  });

  it('selects capability summaries and full definitions over MCP without granting tools', async () => {
    const { session, client, server } = await connected('observe');
    try {
      const summary = await client.callTool({ name: 'surdet_capabilities_describe', arguments: { ids: ['scene.patch', 'project.inspect'], detail: 'summary' } });
      expect(summary.isError, textContent(summary)).not.toBe(true);
      const summaries = (summary.structuredContent as any).result.capabilities;
      expect(summaries.map((item: any) => item.id)).toEqual(['project.inspect', 'scene.patch']);
      expect(summaries[1]).toMatchObject({ minimumPolicy: 'stage', mcpTool: 'surdet_scene_patch', composable: true });
      expect(summaries[1]).not.toHaveProperty('inputSchema');
      expect(summaries[1]).not.toHaveProperty('minimalExample');
      const full = await client.callTool({ name: 'surdet_capabilities_describe', arguments: { ids: ['scene.patch'] } });
      expect(full.isError, textContent(full)).not.toBe(true);
      expect((full.structuredContent as any).result.capabilities).toEqual([
        { ...AUTHORING_CAPABILITY_REGISTRY.find((item) => item.id === 'scene.patch'), mcpTool: 'surdet_scene_patch' },
      ]);
      const unknown = await client.callTool({ name: 'surdet_capabilities_describe', arguments: { ids: ['scene.missing'] } });
      expect(unknown.isError).toBe(true);
      expect((unknown.structuredContent as any).error.code).toBe('INVALID_REQUEST');
      expect((await client.listTools()).tools.map((item) => item.name)).not.toContain('surdet_scene_patch');
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('executes the published create and patch examples with discovered prerequisites and references', async () => {
    const { session, client, server } = await connected('apply');
    try {
      const invoke = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, textContent(response)).not.toBe(true);
        return (response.structuredContent as any).result;
      };
      const definitions = (await invoke('surdet_capabilities_describe')).capabilities;
      await invoke('surdet_change_begin');
      await invoke('surdet_variable_ensure', { operationId: 'trust', name: 'trust', type: 'number', initial: 2 });
      await invoke('surdet_variable_ensure', { operationId: 'route', name: 'route', type: 'string', initial: '' });
      const createExample = definitions.find((item: any) => item.id === 'scene.create').minimalExample.input;
      await invoke('surdet_scene_create', createExample);
      await invoke('surdet_project_validate');
      const createdRun = await invoke('surdet_runtime_run_from', { sceneId: createExample.sceneId, choices: [0] });
      expect(createdRun).toMatchObject({ status: 'passed', finalVariables: { trust: 1 } });

      await invoke('surdet_scene_create', { operationId: 'prepare-x', sceneId: 'x', blocks: [
        { kind: 'choice', options: [{ label: '原选项', target: { kind: 'goto', value: 'left' } }] },
        { kind: 'label', name: 'left' }, { kind: 'text', value: '左侧结局。' },
      ] });
      await invoke('surdet_scene_create', { operationId: 'prepare-right', sceneId: 'right', blocks: [{ kind: 'text', value: '右侧结局。' }] });
      const scene = await invoke('surdet_object_inspect', { objectRef: 'scene:x' });
      const children = await Promise.all(scene.childRefs.map((objectRef: string) => invoke('surdet_object_inspect', { objectRef })));
      const choice = children.find((item: any) => item.kind === 'choice');
      const patchExample = structuredClone(definitions.find((item: any) => item.id === 'scene.patch').minimalExample.input);
      // Only replace opaque placeholders with current public facts; execute the example content unchanged.
      patchExample.patch.target = choice.objectRef;
      patchExample.patch.expectedFingerprint = choice.details.structure.fingerprint;
      await invoke('surdet_scene_patch', patchExample);
      await invoke('surdet_project_validate');
      const left = await invoke('surdet_runtime_run_from', { sceneId: 'x', choices: [0] });
      expect(left).toMatchObject({ status: 'passed', finalVariables: { route: 'left' } });
      expect(await invoke('surdet_runtime_run_from', { sceneId: 'x', choices: [1] })).toMatchObject({ status: 'passed' });
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('reads explicit project/working views and rejects mixed-version scene pages', async () => {
    const { session, client, server } = await connected('apply');
    try {
      const invoke = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, textContent(response)).not.toBe(true);
        return response.structuredContent;
      };
      for (const name of ['surdet_project_inspect', 'surdet_project_assets', 'surdet_project_gallery', 'surdet_object_inspect']) {
        const missing = await client.callTool({ name, arguments: { view: 'working', ...(name === 'surdet_object_inspect' ? { objectRef: 'scene:start' } : {}) } });
        expect(missing.isError).toBe(true);
        expect(missing.structuredContent, textContent(missing)).toMatchObject({ error: { code: 'CHANGE_NOT_FOUND' } });
      }
      await invoke('surdet_change_begin');
      const input = { operationId: 'paged-scene', sceneId: 'paged', blocks: [
        { kind: 'text', value: '重复台词。' },
        { kind: 'text', value: '重复台词。' },
        { kind: 'label', name: 'last' },
        { kind: 'text', value: '结尾。' },
      ] };
      const created = await invoke('surdet_scene_create', input);
      expect(created.result.continuation).toMatchObject({ sceneRef: 'scene:paged', workingRevision: created.workingRevision });
      const disk = await invoke('surdet_project_inspect', { view: 'project' });
      const working = await invoke('surdet_project_inspect', { view: 'working' });
      expect(disk.result.scenes.map((scene: any) => scene.id)).not.toContain('paged');
      expect(disk).not.toHaveProperty('changeId');
      expect(working.result.scenes.map((scene: any) => scene.id)).toContain('paged');
      expect(working.changeId).toBe(created.changeId);
      expect((await invoke('surdet_project_inspect')).result.view).toBe('project');
      for (const name of ['surdet_project_assets', 'surdet_project_gallery']) {
        expect(await invoke(name, { view: 'project' })).not.toHaveProperty('changeId');
        expect(await invoke(name, { view: 'working' })).toMatchObject({ changeId: created.changeId, workingRevision: created.workingRevision, result: { view: 'working' } });
      }
      const first = await invoke('surdet_object_inspect', { view: 'working', objectRef: 'scene:paged', fragment: { limit: 2 } });
      const page = first.result.fragment;
      expect(page).toMatchObject({ fromLine: 1, totalLines: 6, nextLine: 3, truncated: true, revision: working.result.revision, workingRevision: first.workingRevision });
      expect(page.lines.map((line: any) => line.text)).toEqual(['@scene paged', '重复台词。']);
      const continuation = { fromLine: page.nextLine, limit: 4, expectedRevision: page.revision, expectedWorkingRevision: page.workingRevision };
      const second = await invoke('surdet_object_inspect', { view: 'working', objectRef: 'scene:paged', fragment: continuation });
      expect(second.result.fragment).toMatchObject({ fromLine: 3, truncated: false });
      expect(second.result.fragment.lines.map((line: any) => line.text)).toEqual(['重复台词。', '@label last', '结尾。', '@end']);
      expect(page.lines[1].objectRefs).not.toEqual(second.result.fragment.lines[0].objectRefs);
      const target = page.lines[1].objectRefs[0];
      const text = await invoke('surdet_object_inspect', { view: 'working', objectRef: target });
      await invoke('surdet_scene_patch', { operationId: 'shift-lines', patch: { kind: 'insertAfter', anchor: target, expectedFingerprint: text.result.fingerprint, blocks: [{ kind: 'text', value: '插入。' }] } });
      const stale = await client.callTool({ name: 'surdet_object_inspect', arguments: { view: 'working', objectRef: 'scene:paged', fragment: continuation } });
      expect(stale.isError).toBe(true);
      expect((stale.structuredContent as any).error.code).toBe('OBJECT_REF_STALE');
      const unpinned = await client.callTool({ name: 'surdet_object_inspect', arguments: { view: 'working', objectRef: 'scene:paged', fragment: { fromLine: 3 } } });
      expect(unpinned.isError).toBe(true);
      const repeated = await invoke('surdet_scene_create', input);
      expect(repeated.result.continuation.workingRevision).toBeGreaterThan(created.result.continuation.workingRevision);
      expect(repeated.result.continuation.revision).not.toBe(created.result.continuation.revision);
      const sourceObject = await invoke('surdet_object_inspect', { view: 'project', objectRef: 'scene:start', fragment: {} });
      expect(sourceObject).not.toHaveProperty('changeId');
      expect(sourceObject.result.fragment.revision).toBe(disk.result.revision);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('reports usable budgets and stores failed traces without granting passed runtime evidence', async () => {
    const { session, client, server } = await connected('apply');
    try {
      fs.writeFileSync(path.join(session.projectRoot, 'content/scenario/start.gal'), '@scene start\n第一句。\n第二句。\n@end\n');
      const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
      const incomplete = await call('surdet_project_simulate', { sceneId: 'start', maxStepsPerPath: 1 });
      expect(incomplete.structuredContent, textContent(incomplete)).toMatchObject({ ok: false, error: { code: 'SIMULATION_INCOMPLETE', retryDisposition: 'after-repair' } });
      expect((incomplete.structuredContent as any).error.details.report).toMatchObject({ status: 'incomplete', coverage: {
        scenes: [expect.objectContaining({ sceneId: 'start', visited: true })], stops: [expect.objectContaining({ kind: 'step-budget' })],
      } });
      const repair = (incomplete.structuredContent as any).error.repairActions.find((item: any) => item.capability === 'project.simulate');
      expect(repair.inputTemplate.maxStepsPerPath).toBeGreaterThan(1);
      expect((await call('surdet_project_simulate', { ...repair.inputTemplate, maxStepsPerPath: 10 })).isError).not.toBe(true);
      fs.writeFileSync(path.join(session.projectRoot, 'content/scenario/start.gal'), '@scene start\n@check false\n@end\n');
      const failedSimulation = await call('surdet_project_simulate');
      expect(failedSimulation.structuredContent, textContent(failedSimulation)).toMatchObject({ error: { code: 'RUNTIME_FAILED', details: { report: {
        status: 'failed', coverage: { stops: [expect.objectContaining({ kind: 'runtime-error', location: expect.objectContaining({ sceneId: 'start', line: 2 }) })] },
      } } } });
      fs.writeFileSync(path.join(session.projectRoot, 'content/scenario/start.gal'), '@scene start\n第一句。\n第二句。\n@end\n');
      await call('surdet_change_begin');
      const failed = await call('surdet_runtime_run_from', { sceneId: 'start', choices: [], maxSteps: 1 });
      expect(failed.structuredContent, textContent(failed)).toMatchObject({ ok: false, error: { code: 'RUNTIME_FAILED' } });
      const failure = (failed.structuredContent as any).error;
      expect(failure.details.traceId).toEqual(expect.any(String));
      const readRepair = failure.repairActions.find((item: any) => item.capability === 'runtime.read-trace');
      const trace = await call('surdet_runtime_read_trace', readRepair.inputTemplate);
      expect(trace.isError, textContent(trace)).not.toBe(true);
      expect(trace.structuredContent).toMatchObject({ result: { status: 'failed', traceWorkingRevision: 0, freshness: { status: 'failed' } } });
      expect((trace.structuredContent as any).result.events.length).toBeGreaterThan(0);
      const described = await call('surdet_session_describe');
      const changeId = (described.structuredContent as any).result.activeChange.changeId;
      const opened = await NodeChangeStore.openByChangeId(changeId);
      expect(opened!.record.runtimeTraces ?? []).toHaveLength(0);
      expect(await opened!.store.readTrace(changeId, failure.details.traceId)).toMatchObject({ status: 'failed', workingRevision: 0 });
      expect(await opened!.store.readInvocations(changeId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: 'runtime.run-from', ok: false, errorCode: 'RUNTIME_FAILED', evidenceIds: expect.arrayContaining([failure.details.traceId]) }),
      ]));
      expect((await call('surdet_project_validate')).isError).not.toBe(true);
      expect((await call('surdet_project_simulate')).isError).not.toBe(true);
      expect((await call('surdet_change_commit')).structuredContent).toMatchObject({ error: { code: 'RUNTIME_EVIDENCE_REQUIRED' } });
      const beforeStart = await call('surdet_runtime_run_from', { sceneId: 'missing', choices: [] });
      expect(beforeStart.structuredContent).toMatchObject({ error: { code: 'RUNTIME_FAILED' } });
      expect((beforeStart.structuredContent as any).error.details?.traceId).toBeUndefined();
      expect((await call('surdet_runtime_run_from', { sceneId: 'start', choices: [] })).isError).not.toBe(true);
      const boundedWorking = await call('surdet_project_simulate', { sceneId: 'start', maxPaths: 1, maxStepsPerPath: 1 });
      expect(boundedWorking.structuredContent).toMatchObject({ error: { code: 'SIMULATION_INCOMPLETE' } });
      expect((boundedWorking.structuredContent as any).error.details.report.coverage.stops[0]).toMatchObject({ kind: 'step-budget', location: { sceneId: 'start' } });
      for (const input of [{ maxPaths: 0 }, { maxStepsPerPath: 1.5 }, { maxPaths: 2001 }, { maxStepsPerPath: 100001 }]) {
        const invalid = await call('surdet_project_simulate', input);
        expect(invalid.isError).toBe(true);
        expect(textContent(invalid)).toContain(Object.keys(input)[0]);
      }
      const invalidScene = await call('surdet_scene_create', { operationId: 'invalid-scene', sceneId: 'bad', blocks: [{ kind: 'instruction', name: 'set', args: ['missing', '1'] }] });
      expect(invalidScene.structuredContent).toMatchObject({ error: { code: 'INVALID_REQUEST', retryDisposition: 'after-repair' } });
      expect((invalidScene.structuredContent as any).error.repairActions.length).toBeGreaterThan(0);
      const after = await NodeChangeStore.openByChangeId(changeId);
      expect(after!.record.workingRevision).toBe(0);
      expect(after!.record.operations).not.toHaveProperty('invalid-scene');
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('reads source coverage and original conditional indices through real project and working MCP results', async () => {
    const { session, client, server } = await connected('stage');
    try {
      fs.writeFileSync(path.join(session.projectRoot, 'content/scenario/start.gal'), '@scene start\n@choice\n  隐藏 [if:false] -> @end\n  可选 [if:true] -> @end\n');
      const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
      const project = await call('surdet_project_simulate');
      expect(project.isError, textContent(project)).not.toBe(true);
      const coverage = (project.structuredContent as any).result.report.coverage;
      expect(coverage.branches).toMatchObject([{ optionIndex: 0, status: 'condition-not-met' }, { optionIndex: 1, status: 'visited' }]);
      await call('surdet_change_begin');
      const working = await call('surdet_project_simulate');
      expect(working.isError, textContent(working)).not.toBe(true);
      expect((working.structuredContent as any).result.coverage).toEqual(coverage);
      const runtime = await call('surdet_runtime_run_from', { sceneId: 'start', choices: [1] });
      expect(runtime.isError, textContent(runtime)).not.toBe(true);
      const trace = await call('surdet_runtime_read_trace', { traceId: (runtime.structuredContent as any).result.traceId, query: {} });
      expect(trace.isError, textContent(trace)).not.toBe(true);
      expect((trace.structuredContent as any).result.events.filter((event: any) => event.condition).map((event: any) => event.condition))
        .toEqual([{ expression: 'false', result: false, optionIndex: 0 }, { expression: 'true', result: true, optionIndex: 1 }]);
    } finally { await client.close(); await server.close(); await session.close(); }
  });

  it('resumes a direct draft across real MCP processes and keeps cross-scene label edits atomic', async () => {
    const root = makeProject('stdio-label');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-stdio-label-'));
    temporaryRoots.push(data);
    const connect = async (changeId?: string) => {
      const transport = new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../dist/agent-port/main.js', import.meta.url)), '--project', root, '--policy', 'stage', ...(changeId === undefined ? [] : ['--resume-change', changeId])],
        env: { ...process.env as Record<string, string>, SURDET_AGENT_DATA_DIR: data }, stderr: 'pipe',
      });
      const client = new Client({ name: 'direct-label-restart', version: '1.0.0' });
      await client.connect(transport);
      return client;
    };
    let client = await connect();
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, textContent(response)).not.toBe(true);
      return response.structuredContent as any;
    };
    try {
      const begun = await call('surdet_change_begin', { compositionMode: 'direct' });
      const changeId = begun.result.changeId;
      await call('surdet_scene_create', { operationId: 'a', sceneId: 'a', blocks: [{ kind: 'label', name: 'entry' }, { kind: 'text', value: '从这里返回。' }, { kind: 'instruction', name: 'return' }] });
      await call('surdet_scene_create', { operationId: 'b', sceneId: 'b', blocks: [{ kind: 'instruction', name: 'call', args: ['a.entry'] }, { kind: 'text', value: '已经返回。' }] });
      const label = (await call('surdet_object_inspect', { view: 'working', objectRef: 'label:a.entry' })).result;
      const rejected = await client.callTool({ name: 'surdet_scene_patch', arguments: { operationId: 'delete', patch: { kind: 'removeLabel', target: label.objectRef, expectedFingerprint: label.fingerprint } } });
      expect(rejected.structuredContent).toMatchObject({ error: { code: 'OBJECT_PRECONDITION_FAILED', details: { references: expect.arrayContaining([expect.objectContaining({ kind: 'call', target: 'a.entry' })]) } } });
      const rename = { operationId: 'rename', patch: { kind: 'renameLabel', target: label.objectRef, expectedFingerprint: label.fingerprint, name: 'arrival' } };
      const renamed = await call('surdet_scene_patch', rename);
      expect(renamed.result.affectedScenes).toEqual(['a', 'b']);
      await client.close();
      client = await connect(changeId);
      expect((await call('surdet_session_describe')).result.activeChange).toMatchObject({ changeId, compositionMode: 'direct' });
      expect((await call('surdet_scene_patch', rename)).workingRevision).toBe(renamed.workingRevision);
      expect((await call('surdet_runtime_run_from', { sceneId: 'b', choices: [] })).result.status).toBe('passed');
      const trace = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:b', fragment: {} });
      expect(trace.result.fragment.lines.map((line: any) => line.text)).toContain('@call a.arrival');
      expect(fs.existsSync(path.join(root, 'content/scenario/a.gal'))).toBe(false);
      const capsule = await call('surdet_delivery_capsule');
      expect(capsule.result).toMatchObject({ compositionMode: 'direct', composition: { eligibility: 'unavailable' } });
    } finally { await client.close(); }
  }, 30000);

  it('reads and patches finite player configuration with current fingerprints and preserves unknown fields', async () => {
    const { session, client, server } = await connected('stage');
    try {
      const source = '\uFEFF{\r\n  "title":"Before", "entryScene":"start", "variables":{}, "custom":{"keep":true}, "player":{"custom":"keep"}\r\n}\r\n';
      fs.writeFileSync(path.join(session.projectRoot, 'game.config.json'), source);
      fs.mkdirSync(path.join(session.projectRoot, 'content/assets/bg'), { recursive: true });
      fs.writeFileSync(path.join(session.projectRoot, 'content/assets/bg/night.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, textContent(response)).not.toBe(true);
        return response.structuredContent as any;
      };
      await call('surdet_change_begin', { compositionMode: 'direct' });
      const before = (await call('surdet_project_inspect', { view: 'working' })).result.playerConfig;
      expect(before).toMatchObject({ values: { title: 'Before', subtitle: null, titleBackground: null, endScenes: null, firstRunHint: null }, fingerprint: expect.any(String) });
      const input = { operationId: 'player-settings', expectedFingerprint: before.fingerprint, patch: { title: 'After', subtitle: '序章', titleBackground: 'night', endScenes: ['start'], firstRunHint: '' } };
      const patched = await call('surdet_project_player_config_patch', input);
      const after = (await call('surdet_project_inspect', { view: 'working' })).result.playerConfig;
      expect(after).toEqual(patched.result.playerConfig);
      expect(after.values).toEqual({ ...input.patch, titleLogo: null, font: null, fonts: null });
      expect((await call('surdet_project_inspect', { view: 'project' })).result.playerConfig).toEqual(before);
      const repeated = await call('surdet_project_player_config_patch', input);
      expect(repeated.workingRevision).toBe(patched.workingRevision);
      const rejected = await client.callTool({ name: 'surdet_project_player_config_patch', arguments: { ...input, operationId: 'stale-settings', patch: { subtitle: '' } } });
      expect(rejected.structuredContent).toMatchObject({ error: { code: 'OBJECT_REF_STALE' } });
      for (const patch of [{ titleBackground: 'missing' }, { endScenes: ['missing'] }]) {
        const failed = await client.callTool({ name: 'surdet_project_player_config_patch', arguments: { operationId: 'bad-reference', expectedFingerprint: after.fingerprint, patch } });
        expect(failed.structuredContent).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      }
      const cleared = await call('surdet_project_player_config_patch', { operationId: 'clear-default', expectedFingerprint: after.fingerprint, patch: { subtitle: null, titleBackground: '', endScenes: [] } });
      expect(cleared.result.playerConfig.values).toMatchObject({ subtitle: null, titleBackground: '', endScenes: [], firstRunHint: '' });
      const opened = await NodeChangeStore.openByChangeId(session.activeChangeId!);
      const text = opened!.record.workingFiles['game.config.json']!;
      expect(text.startsWith('\uFEFF')).toBe(true);
      expect(text).toContain('\r\n');
      expect(JSON.parse(text.slice(1))).toMatchObject({ custom: { keep: true }, player: { custom: 'keep', firstRunHint: '' } });
      expect(fs.readFileSync(path.join(session.projectRoot, 'game.config.json'), 'utf8')).toBe(source);
      expect(opened!.record.operations).not.toHaveProperty('bad-reference');
      const candidate = await openAgentPortSession({ projectRoot: session.projectRoot, policy: 'stage' });
      try {
        await candidate.invoke('change.begin', {});
        expect(await candidate.invoke('project.player-config.patch', input)).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } });
        expect((await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record.workingRevision).toBe(0);
      } finally { await candidate.close(); }
    } finally {
      await client.close(); await server.close(); await session.close();
    }
  });

  it('reads and patches exact font paths without source writes or loss of unknown fields', async () => {
    const { session, client, server } = await connected('stage');
    const root = session.projectRoot;
    const paths = ['content/assets/fonts/a/同名.TTF', 'content/assets/fonts/b/同名.TTF'];
    try {
      for (const file of paths) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'font catalog fixture, not decoding evidence'); }
      const source = '\uFEFF' + JSON.stringify({ entryScene: 'start', variables: {}, font: paths[0], fonts: { custom: 'keep' }, custom: true }, null, 2).replace(/\n/g, '\r\n');
      fs.writeFileSync(path.join(root, 'game.config.json'), source);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, textContent(response)).not.toBe(true);
        return (response.structuredContent as any).result;
      };
      await call('surdet_change_begin', { compositionMode: 'direct' });
      const before = (await call('surdet_project_inspect', { view: 'working' })).playerConfig;
      expect(before.values).toMatchObject({ font: paths[0], fonts: { body: null, title: null, ui: null } });
      const patched = await call('surdet_project_player_config_patch', { operationId: 'fonts', expectedFingerprint: before.fingerprint,
        patch: { fonts: { body: paths[1], title: '', ui: paths[0] } } });
      const after = (await call('surdet_project_inspect', { view: 'working' })).playerConfig;
      expect(after).toEqual(patched.playerConfig);
      expect(after.values.fonts).toEqual({ body: paths[1], title: '', ui: paths[0] });
      expect((await call('surdet_project_inspect', { view: 'project' })).playerConfig).toEqual(before);
      const fonts = (await call('surdet_project_assets', { view: 'working' })).intelligence.items.filter((item: any) => item.kind === 'font');
      expect(fonts.map((item: any) => item.key).sort()).toEqual(paths);
      expect(fonts.every((item: any) => item.references.length === 1 && item.issues.length === 0)).toBe(true);
      const record = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      for (const [operationId, expectedFingerprint, patch, code] of [
        ['font-stale', before.fingerprint, { fonts: { body: paths[0] } }, 'OBJECT_REF_STALE'],
        ['font-missing', after.fingerprint, { fonts: { body: '同名.TTF' } }, 'VALIDATION_FAILED'],
      ] as const) {
        const failure = await client.callTool({ name: 'surdet_project_player_config_patch', arguments: { operationId, expectedFingerprint, patch } });
        expect(failure.structuredContent).toMatchObject({ ok: false, error: { code } });
        expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(record);
      }
      const cleared = await call('surdet_project_player_config_patch', { operationId: 'font-role-reset', expectedFingerprint: after.fingerprint, patch: { fonts: { ui: null } } });
      expect(cleared.playerConfig.values.fonts).toEqual({ body: paths[1], title: '', ui: null });
      const text = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record.workingFiles['game.config.json']!;
      expect(text.startsWith('\uFEFF')).toBe(true); expect(text).toContain('\r\n');
      expect(JSON.parse(text.slice(1))).toMatchObject({ custom: true, fonts: { custom: 'keep' } });
      const reset = await call('surdet_project_player_config_patch', { operationId: 'font-map-reset', expectedFingerprint: cleared.playerConfig.fingerprint, patch: { fonts: null } });
      expect(reset.playerConfig.values).toMatchObject({ font: paths[0], fonts: null });
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(source);
      const candidate = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
      try {
        await candidate.invoke('change.begin', {});
        const unchanged = (await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record;
        expect(await candidate.invoke('project.player-config.patch', { operationId: 'forbidden-font', expectedFingerprint: before.fingerprint, patch: { fonts: { body: paths[1] } } }))
          .toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } });
        expect((await NodeChangeStore.openByChangeId(candidate.activeChangeId!))!.record).toEqual(unchanged);
      } finally { await candidate.close(); }
    } finally { await client.close(); await server.close(); await session.close(); }
  });

  it('keeps an active integration summary visible through the MCP session schema', async () => {
    const { session, client, server } = await connected('stage');
    try {
      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: {} });
      expect(begun.isError).not.toBe(true);
      const changeId = session.activeChangeId!;
      await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
        const record = await leasedStore.read(changeId);
        if (record === null) throw new Error(`missing change ${changeId}`);
        await leasedStore.write({
          ...record,
          recordVersion: record.recordVersion + 1,
          integration: {
            planId: 'pln_schema_probe',
            planFingerprint: 'a'.repeat(64),
            executeOperationId: 'exec-schema-probe',
            sourceCapsules: [],
            includedUnitIds: [],
            deduplicatedUnits: [],
            conflictResolutions: [],
            status: 'REPLAYING',
            nextOperationIndex: 1,
            replayedOperations: [],
          },
        }, {
          expectedRecordVersion: record.recordVersion,
          expectedStatus: record.status,
        });
      });

      const described = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
      expect(described.isError).not.toBe(true);
      expect((described.structuredContent as any).ok).toBe(true);
      expect((described.structuredContent as any).result.activeChange.integration).toEqual({
        planId: 'pln_schema_probe',
        status: 'REPLAYING',
        nextOperationIndex: 1,
        operationCount: 0,
      });

      const capsule = await client.callTool({
        name: 'surdet_delivery_capsule',
        arguments: { label: 'integration schema probe' },
      });
      expect(capsule.isError).not.toBe(true);
      expect((capsule.structuredContent as any).ok).toBe(true);
      expect((capsule.structuredContent as any).result.integrationProvenance).toEqual(expect.objectContaining({
        planId: 'pln_schema_probe',
        integrationChangeId: changeId,
        status: 'REPLAYING',
        planAvailable: false,
      }));
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('keeps the complete success and failure envelope visible to text-only MCP hosts', async () => {
    const { session, client, server } = await connected('stage');
    try {
      const mismatches: string[] = [];
      const compareTextEnvelope = (label: string, result: any): void => {
        try {
          expect(textContent(result)).toBe(JSON.stringify(result.structuredContent));
          expect(textEnvelope(result)).toEqual(result.structuredContent);
        } catch (error) {
          mismatches.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };

      const described = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
      compareTextEnvelope('session.describe success', described);

      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: {} });
      compareTextEnvelope('change.begin success', begun);
      const begunEnvelope = textEnvelope(begun);
      if (typeof begunEnvelope.changeId !== 'string' || begunEnvelope.changeId.length === 0) {
        mismatches.push('change.begin success: text envelope did not expose a real changeId');
      }

      const recovery = await client.callTool({ name: 'surdet_change_recovery_inspect', arguments: {} });
      compareTextEnvelope('change.recovery.inspect success', recovery);
      if (textEnvelope(recovery).ok !== true) mismatches.push('change.recovery.inspect success: text envelope was not a success envelope');

      const failed = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:missing' } });
      compareTextEnvelope('object.inspect failure', failed);
      if (textEnvelope(failed).ok !== false) mismatches.push('object.inspect failure: text envelope was not a failure envelope');

      expect(mismatches).toEqual([]);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('preserves every legal object inspection details shape over MCP', async () => {
    const { session, client, server } = await connected('stage');
    try {
      fs.mkdirSync(path.join(session.projectRoot, 'content', 'assets', 'bg'), { recursive: true });
      fs.writeFileSync(path.join(session.projectRoot, 'content', 'assets', 'bg', 'night_field.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', 'utf8');
      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: { intent: 'inspect timeline details', acceptanceCriteria: ['structured output'], initiator: 'external-agent' } });
      expect(begun.isError).not.toBe(true);

      const entrySceneInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'config:entryScene' } });
      const ordinaryObjectInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:start' } });
      const created = await client.callTool({
        name: 'surdet_timeline_create',
        arguments: {
          operationId: 'op-mcp-timeline-details',
          timelineId: 'mcp_timeline_details',
          definition: {
            version: 1,
            id: 'mcp_timeline_details',
            durationMs: 100,
            tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] }],
          },
        },
      });
      expect(created.isError).not.toBe(true);
      const timelineInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'timeline:mcp_timeline_details' } });

      expect(entrySceneInspected.isError).not.toBe(true);
      expect((entrySceneInspected.structuredContent as any).ok).toBe(true);
      expect((entrySceneInspected.structuredContent as any).result.details).toBe('start');

      expect(ordinaryObjectInspected.isError).not.toBe(true);
      expect((ordinaryObjectInspected.structuredContent as any).ok).toBe(true);
      expect((ordinaryObjectInspected.structuredContent as any).result).not.toHaveProperty('details');

      expect(timelineInspected.isError).not.toBe(true);
      expect((timelineInspected.structuredContent as any).ok).toBe(true);
      expect((timelineInspected.structuredContent as any).result.details.tracks).toHaveLength(1);
      expect((timelineInspected.structuredContent as any).result.details.tracks[0].cues).toHaveLength(1);
      expect((timelineInspected.structuredContent as any).result.childRefs).toEqual([
        'timeline:mcp_timeline_details/track:0',
      ]);

      const trackInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'timeline:mcp_timeline_details/track:0' } });
      expect(trackInspected.isError).not.toBe(true);
      expect((trackInspected.structuredContent as any).result.childRefs).toEqual([
        'timeline:mcp_timeline_details/track:0/cue:0',
      ]);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('creates timeline variants through MCP, composes independent objects, and replays saved patches', async () => {
    const first = await connected('stage');
    const projectRoot = first.session.projectRoot;
    let firstRef: { changeId: string; capsuleId: string; artifactSha256: string };
    try {
      expect((await first.client.callTool({ name: 'surdet_change_begin', arguments: {} })).isError).not.toBe(true);
      const timelineId = 'mcp_timeline_shared';
      const definition = {
        version: 1,
        id: timelineId,
        durationMs: 100,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 10, easing: 'linear', action: 'fade', alpha: 0 }] }],
      };
      const created = await first.client.callTool({
        name: 'surdet_timeline_create',
        arguments: { operationId: 'op-mcp-timeline-create', timelineId, definition },
      });
      expect(created.isError).not.toBe(true);
      const createdResult = textEnvelope(created).result as Record<string, unknown>;
      const createFingerprint = createdResult.fingerprint;
      expect(typeof createFingerprint).toBe('string');

      const duration = await first.client.callTool({
        name: 'surdet_timeline_patch',
        arguments: {
          operationId: 'op-mcp-timeline-duration', timelineId,
          patch: { kind: 'setDuration', expectedFingerprint: createFingerprint, durationMs: 50 },
        },
      });
      expect(duration.isError).not.toBe(true);
      const track = await first.client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: `timeline:${timelineId}/track:0` } });
      expect(track.isError).not.toBe(true);
      const trackFingerprint = (textEnvelope(track).result as Record<string, unknown>).fingerprint;
      expect(typeof trackFingerprint).toBe('string');
      const target = await first.client.callTool({
        name: 'surdet_timeline_patch',
        arguments: {
          operationId: 'op-mcp-timeline-target', timelineId,
          patch: { kind: 'setTrackTarget', expectedFingerprint: trackFingerprint, trackRef: `timeline:${timelineId}/track:0`, target: 'screen:main' },
        },
      });
      expect(target.isError).not.toBe(true);
      expect(textEnvelope(target).workingRevision).toBe(3);

      for (const [name, arguments_] of [
        ['surdet_project_validate', {}],
        ['surdet_project_simulate', {}],
        ['surdet_runtime_run_from', { sceneId: 'start', choices: [] }],
        ['surdet_change_diff', {}],
      ] as const) {
        const result = await first.client.callTool({ name, arguments: arguments_ });
        expect(result.isError, name).not.toBe(true);
      }
      const capsule = await first.client.callTool({ name: 'surdet_delivery_capsule', arguments: { label: 'timeline MCP candidate A' } });
      expect(capsule.isError).not.toBe(true);
      const capsuleResult = textEnvelope(capsule).result as Record<string, unknown>;
      expect((capsuleResult.composition as Record<string, unknown>).eligibility).toBe('ready');
      firstRef = {
        changeId: String(capsuleResult.changeId),
        capsuleId: String(capsuleResult.capsuleId),
        artifactSha256: String((capsuleResult.artifactIdentity as Record<string, unknown>).sha256),
      };
    } finally {
      await first.client.close();
      await first.server.close();
      await first.session.close();
    }

    const second = await connectedProject(projectRoot, 'stage');
    let secondRef: { changeId: string; capsuleId: string; artifactSha256: string };
    try {
      expect((await second.client.callTool({ name: 'surdet_change_begin', arguments: {} })).isError).not.toBe(true);
      const sharedId = 'mcp_timeline_shared';
      const definitions = [
        { id: sharedId, durationMs: 80, target: 'screen:alternate' },
        { id: 'mcp_timeline_independent', durationMs: 40, target: 'screen:independent' },
      ];
      for (const [index, item] of definitions.entries()) {
        const created = await second.client.callTool({
          name: 'surdet_timeline_create',
          arguments: {
            operationId: `op-mcp-timeline-b-${index}`,
            timelineId: item.id,
            definition: {
              version: 1,
              id: item.id,
              durationMs: item.durationMs,
              tracks: [{ kind: 'screen', target: item.target, cues: [{ atMs: 0, durationMs: 10, easing: 'linear', action: 'fade', alpha: 0 }] }],
            },
          },
        });
        expect(created.isError).not.toBe(true);
      }
      for (const [name, arguments_] of [
        ['surdet_project_validate', {}],
        ['surdet_project_simulate', {}],
        ['surdet_runtime_run_from', { sceneId: 'start', choices: [] }],
        ['surdet_change_diff', {}],
      ] as const) {
        const result = await second.client.callTool({ name, arguments: arguments_ });
        expect(result.isError, name).not.toBe(true);
      }
      const capsule = await second.client.callTool({ name: 'surdet_delivery_capsule', arguments: { label: 'timeline MCP candidate B' } });
      expect(capsule.isError).not.toBe(true);
      const capsuleResult = textEnvelope(capsule).result as Record<string, unknown>;
      expect((capsuleResult.composition as Record<string, unknown>).eligibility).toBe('ready');
      secondRef = {
        changeId: String(capsuleResult.changeId),
        capsuleId: String(capsuleResult.capsuleId),
        artifactSha256: String((capsuleResult.artifactIdentity as Record<string, unknown>).sha256),
      };
    } finally {
      await second.client.close();
      await second.server.close();
      await second.session.close();
    }

    const composed = await connectedProject(projectRoot, 'stage');
    try {
      const candidateRefs = [firstRef, secondRef];
      const compared = await composed.client.callTool({ name: 'surdet_composition_compare', arguments: { candidateRefs } });
      expect(compared.isError).not.toBe(true);
      const comparison = textEnvelope(compared).result as {
        comparisonFingerprint: string;
        units: Array<{ unitId: string; candidateId: string; primaryObject: string }>;
        conflicts: Array<{ conflictId: string; severity: string }>;
      };
      const sharedA = comparison.units.find((unit) => unit.primaryObject === 'timeline:mcp_timeline_shared' && unit.candidateId === `cand-${firstRef.changeId}-${firstRef.capsuleId}`);
      const sharedB = comparison.units.find((unit) => unit.primaryObject === 'timeline:mcp_timeline_shared' && unit.candidateId === `cand-${secondRef.changeId}-${secondRef.capsuleId}`);
      const independent = comparison.units.find((unit) => unit.primaryObject === 'timeline:mcp_timeline_independent');
      expect(sharedA).toBeDefined();
      expect(sharedB).toBeDefined();
      expect(independent).toBeDefined();
      const conflict = comparison.conflicts.find((item) => item.severity === 'selection-required');
      expect(conflict).toBeDefined();

      const planned = await composed.client.callTool({
        name: 'surdet_composition_plan',
        arguments: {
          candidateRefs,
          comparisonFingerprint: comparison.comparisonFingerprint,
          selectedUnitIds: comparison.units.map((unit) => unit.unitId),
          conflictResolutions: [{ conflictId: conflict!.conflictId, resolution: 'choose-unit', chosenUnitId: sharedA!.unitId, actor: 'human' }],
          reason: 'timeline MCP candidate replay',
        },
      });
      expect(planned.isError).not.toBe(true);
      const planResult = textEnvelope(planned).result as Record<string, unknown>;
      expect(planResult.dryRunStatus).toBe('passed');
      const executed = await composed.client.callTool({
        name: 'surdet_composition_execute',
        arguments: { planId: planResult.planId, artifactSha256: planResult.artifactSha256, executeOperationId: 'exec-mcp-timeline' },
      });
      expect(executed.isError).not.toBe(true);
      expect((textEnvelope(executed).result as Record<string, unknown>).status).toBe('READY');

      const shared = await composed.client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'timeline:mcp_timeline_shared' } });
      const sharedDetails = (textEnvelope(shared).result as Record<string, any>).details;
      expect(sharedDetails).toMatchObject({ durationMs: 50, tracks: [{ target: 'screen:main' }] });
      const savedIndependent = await composed.client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'timeline:mcp_timeline_independent' } });
      expect((textEnvelope(savedIndependent).result as Record<string, any>).details.tracks[0].target).toBe('screen:independent');
    } finally {
      await composed.client.close();
      await composed.server.close();
      await composed.session.close();
    }
  }, 30_000);

  it('patches an existing baseline timeline through MCP using its replay state fact', async () => {
    const projectRoot = makeProject('timeline-baseline');
    fs.mkdirSync(path.join(projectRoot, 'content', 'timelines'), { recursive: true });
    const timelineId = 'baseline_mcp_timeline';
    fs.writeFileSync(path.join(projectRoot, 'content', 'timelines', `${timelineId}.json`), JSON.stringify({
      version: 1,
      id: timelineId,
      durationMs: 100,
      tracks: [{ kind: 'screen', target: 'screen:base', cues: [{ atMs: 0, durationMs: 10, easing: 'linear', action: 'fade', alpha: 0 }] }],
    }), 'utf8');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-tools-data-timeline-baseline-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    const { session, client, server } = await connectedProject(projectRoot, 'stage');
    try {
      expect((await client.callTool({ name: 'surdet_change_begin', arguments: {} })).isError).not.toBe(true);
      const inspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: `timeline:${timelineId}` } });
      expect(inspected.isError).not.toBe(true);
      const inspection = textEnvelope(inspected).result as Record<string, unknown>;
      expect(inspection.fingerprint).toEqual(expect.any(String));

      const patched = await client.callTool({
        name: 'surdet_timeline_patch',
        arguments: {
          operationId: 'op-mcp-baseline-timeline-patch',
          timelineId,
          patch: { kind: 'setDuration', expectedFingerprint: inspection.fingerprint, durationMs: 80 },
        },
      });
      expect(patched.isError, textContent(patched)).not.toBe(true);
      expect(textEnvelope(patched).workingRevision).toBe(1);

      const after = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: `timeline:${timelineId}` } });
      expect(after.isError).not.toBe(true);
      expect((textEnvelope(after).result as Record<string, any>).details.durationMs).toBe(80);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('discovers dialogue through scene children, patches its fingerprint and rejects stale reuse', async () => {
    const { session, client, server } = await connected('stage');
    try {
      const projectScene = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:start' } });
      expect(projectScene.isError).not.toBe(true);
      const projectSceneObject = textEnvelope(projectScene).result as Record<string, unknown>;
      expect(Array.isArray(projectSceneObject.childRefs)).toBe(true);
      const projectChildren: Record<string, unknown>[] = [];
      for (const objectRef of projectSceneObject.childRefs as string[]) {
        const child = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef } });
        expect(child.isError).not.toBe(true);
        projectChildren.push(textEnvelope(child).result as Record<string, unknown>);
      }
      const textObjectRef = projectChildren.find((child) => child.kind === 'text')?.objectRef;
      expect(typeof textObjectRef).toBe('string');

      const begun = await client.callTool({
        name: 'surdet_change_begin',
        arguments: {
          intent: 'replace a dialogue through its inspected fingerprint',
          acceptanceCriteria: ['matching fingerprint patches the dialogue', 'stale fingerprint leaves working content unchanged'],
          initiator: 'external-agent',
        },
      });
      expect(begun.isError).not.toBe(true);

      const inspected = await client.callTool({
        name: 'surdet_object_inspect',
        arguments: { objectRef: textObjectRef },
      });
      expect(inspected.isError).not.toBe(true);
      const inspectedEnvelope = textEnvelope(inspected);
      expect(inspectedEnvelope.ok).toBe(true);
      const inspectedObject = inspectedEnvelope.result as Record<string, unknown>;
      expect(inspectedObject.kind).toBe('text');
      expect(inspectedObject.objectRef).toBe(textObjectRef);
      const inspectedFingerprint = inspectedObject.fingerprint;
      expect(typeof inspectedFingerprint).toBe('string');

      const patched = await client.callTool({
        name: 'surdet_scene_patch',
        arguments: {
          operationId: 'op-mcp-dialogue-fingerprint',
          sceneId: 'start',
          patch: {
            kind: 'replaceText',
            target: textObjectRef,
            expectedFingerprint: inspectedFingerprint,
            value: '修改后的台词。',
          },
        },
      });
      expect(patched.isError).not.toBe(true);
      const patchedEnvelope = textEnvelope(patched);
      expect(patchedEnvelope.ok).toBe(true);
      expect(patchedEnvelope.workingRevision).toBe(1);

      const workingScene = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:start' } });
      expect(workingScene.isError).not.toBe(true);
      const workingSceneObject = textEnvelope(workingScene).result as Record<string, unknown>;
      expect(Array.isArray(workingSceneObject.childRefs)).toBe(true);
      const workingChildren: Record<string, unknown>[] = [];
      for (const objectRef of workingSceneObject.childRefs as string[]) {
        const child = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef } });
        expect(child.isError).not.toBe(true);
        workingChildren.push(textEnvelope(child).result as Record<string, unknown>);
      }
      const workingTextObjectRef = workingChildren.find((child) => child.kind === 'text')?.objectRef;
      expect(typeof workingTextObjectRef).toBe('string');
      expect(workingTextObjectRef).not.toBe(textObjectRef);

      const workingInspection = await client.callTool({
        name: 'surdet_object_inspect',
        arguments: { objectRef: workingTextObjectRef },
      });
      expect(workingInspection.isError).not.toBe(true);
      const workingInspectionEnvelope = textEnvelope(workingInspection);
      expect(workingInspectionEnvelope.ok).toBe(true);
      const workingObject = workingInspectionEnvelope.result as Record<string, unknown>;
      expect((workingObject.source as Record<string, unknown>).raw).toBe('凛：修改后的台词。');
      const workingFingerprint = workingObject.fingerprint;
      expect(typeof workingFingerprint).toBe('string');
      const workingRevisionBeforeStale = patchedEnvelope.workingRevision;

      const stale = await client.callTool({
        name: 'surdet_scene_patch',
        arguments: {
          operationId: 'op-mcp-dialogue-stale-fingerprint',
          sceneId: 'start',
          patch: {
            kind: 'replaceText',
            target: textObjectRef,
            expectedFingerprint: inspectedFingerprint,
            value: '不应写入。',
          },
        },
      });
      expect(stale.isError).toBe(true);
      const staleEnvelope = textEnvelope(stale);
      expect(staleEnvelope.ok).toBe(false);
      expect((staleEnvelope.error as Record<string, unknown>).code).toBe('OBJECT_PRECONDITION_FAILED');

      const afterStaleDescription = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
      expect(afterStaleDescription.isError).not.toBe(true);
      const afterStaleDescriptionEnvelope = textEnvelope(afterStaleDescription);
      expect(afterStaleDescriptionEnvelope.ok).toBe(true);
      const activeChange = (afterStaleDescriptionEnvelope.result as Record<string, unknown>).activeChange as Record<string, unknown>;
      expect(activeChange.workingRevision).toBe(workingRevisionBeforeStale);

      const afterStaleInspection = await client.callTool({
        name: 'surdet_object_inspect',
        arguments: { objectRef: workingTextObjectRef },
      });
      expect(afterStaleInspection.isError).not.toBe(true);
      const afterStaleInspectionEnvelope = textEnvelope(afterStaleInspection);
      expect(afterStaleInspectionEnvelope.ok).toBe(true);
      const afterStaleObject = afterStaleInspectionEnvelope.result as Record<string, unknown>;
      expect((afterStaleObject.source as Record<string, unknown>).raw).toBe('凛：修改后的台词。');
      expect(afterStaleObject.fingerprint).toBe(workingFingerprint);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });
});
