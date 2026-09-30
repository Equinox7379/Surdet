import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { isPreviewSourcePath, previewSourceText, type PreviewBeginInput, type PreviewTraceMessage } from '@surdet/authoring';
import { createAssetImportAuthorityClient } from '../../editor/src/asset-import-client.js';
import { assetImportAuthorityVitePlugin } from '../src/asset-import-authority/vite-plugin.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { PreviewObservationService } from '../src/authoring/preview-observation-service.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';

const cleanups: (() => Promise<unknown>)[] = [];
const sha = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
  delete process.env['SURDET_AGENT_DATA_DIR'];
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-preview-observation-'));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const dataRoot = path.join(root, 'agent-data');
  process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;
  await fs.mkdir(path.join(project, 'content/scenario/chapter'), { recursive: true });
  await fs.mkdir(path.join(project, 'content/assets/bg'), { recursive: true });
  await fs.mkdir(path.join(project, 'content/config'), { recursive: true });
  await fs.writeFile(path.join(project, 'content/config/terminology.json'), '{"terms":[{"canonical":"来源词条","variants":[]}]}');
  await fs.writeFile(path.join(project, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }, null, 2));
  await fs.writeFile(path.join(project, 'content/scenario/chapter/start.gal'), '@scene start\n凛：开始。\n@end\n');
  await fs.writeFile(path.join(project, 'content/assets/bg/night.svg'), '<svg/>');
  const plugin = assetImportAuthorityVitePlugin({ projectRoot: project, dataRoot: path.join(root, 'import-data') });
  let handler!: (request: http.IncomingMessage, response: http.ServerResponse, next: () => void) => void;
  const httpServer = http.createServer((request, response) => handler(request, response, () => { response.statusCode = 404; response.end(); }));
  plugin.configureServer({ middlewares: { use(value) { handler = value; } }, httpServer });
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => { await plugin.closeBundle(); await new Promise<void>(resolve => httpServer.close(() => resolve())); });
  await plugin.api.ready();
  const origin = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}`;
  const html = plugin.transformIndexHtml.handler('</head>', { path: '/', server: {} });
  const configuration = JSON.parse(html.match(/Object\.freeze\((\{[^<]+\})\)/)![1]!);
  const editor = createAssetImportAuthorityClient({ configuration,
    fetcher: (url, init) => fetch(new URL(String(url), origin), { ...init, headers: { ...init?.headers, Origin: origin } }) });
  const handle = { async getFileHandle(file: string) { return { async getFile() {
    const buffer = await fs.readFile(path.join(project, file));
    return { size: buffer.length, text: async () => buffer.toString('utf8') };
  } }; } } as FileSystemDirectoryHandle;
  await editor.bindProject(handle);
  const workspaceSessionId = crypto.randomUUID();
  const baseline = (await editor.workspace.snapshot(workspaceSessionId)).diskBaseline;
  const workspace = { workspaceSessionId, workspaceGeneration: 1, availability: 'clean' as const,
    dirtyScopes: [], busyReasons: [], blockedReasons: [],
    loadedProjectRevision: baseline.projectRevision, loadedCoordinationRevision: baseline.coordinationRevision };
  await editor.workspace.heartbeat(workspace);
  const storage = await NodeProjectStorage.open(project);
  const files = await Promise.all((await storage.listFiles()).filter(isPreviewSourcePath).map(async file => ({ path: file,
    sha256: sha(previewSourceText(file, (await storage.readText(file)).text)) })));
  const begin: PreviewBeginInput = { action: 'begin', previewId: `preview-${crypto.randomUUID()}`, previewGeneration: 1,
    sceneId: 'start', expectedProjectRevision: baseline.projectRevision, expectedCoordinationRevision: baseline.coordinationRevision,
    source: { files, assets: [{ path: 'content/assets/bg/night.svg', sha256: sha('<svg/>') }] } };
  const session = await openAgentPortSession({ projectRoot: project, policy: 'stage' });
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'preview-regression', version: '1.0.0' });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  cleanups.push(async () => { editor.dispose(); await mcp.close(); await server.close(); await session.close(); });
  const read = async (args: Record<string, unknown> = {}) => {
    const response = await mcp.callTool({ name: 'surdet_runtime_read_preview', arguments: args });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const envelope = response.structuredContent as any;
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
    expect(JSON.parse((response.content.find(item => item.type === 'text') as { text: string }).text)).toEqual(envelope);
    return envelope.result;
  };
  const messages: PreviewTraceMessage[] = [
    { type: 'surdet-preview-trace-start', traceId: begin.previewId, generation: 5, sceneId: begin.sceneId },
    { type: 'surdet-preview-trace-event', traceId: begin.previewId, generation: 5, sequence: 0,
      coreEmitted: true, presentationApplied: true, presentationBefore: {}, presentationAfter: { stage: { background: 'night' } },
      event: { kind: 'instruction', source: { sceneId: begin.sceneId, index: 0, op: 'text', file: 'start.gal', line: 2, col: 1 } } },
    { type: 'surdet-preview-trace-complete', traceId: begin.previewId, generation: 5, status: 'passed', eventCount: 1 },
  ];
  const publish = (preview = begin) => editor.workspace.preview({ ...workspace, preview });
  const append = (value = messages) => editor.workspace.preview({ ...workspace,
    preview: { action: 'append', previewId: begin.previewId, previewGeneration: begin.previewGeneration, messages: value } });
  return { project, dataRoot, editor, workspace, begin, messages, read, publish, append, session, mcp };
}

it('preserves history stale/conflict/corrupt errors through real binding, HTTP and the Editor client', async () => {
  const f = await fixture();
  const index = await f.editor.workspace.history(f.workspace);
  const request = { operationId: crypto.randomUUID(), label: '保存版本', expectedContentRevision: index.contentRevision };
  const saved = await f.editor.workspace.historyCheckpoint({ ...f.workspace, request });
  expect((await f.editor.workspace.history(f.workspace)).checkpoints[0]).toEqual(saved);
  await expect(f.editor.workspace.historyCheckpoint({ ...f.workspace, request: { ...request, label: '冲突' } })).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  await expect(f.editor.workspace.historyCompare({ ...f.workspace, request: { checkpointId: saved.checkpointId, expectedFingerprint: '0'.repeat(64) } }))
    .rejects.toMatchObject({ code: 'OBJECT_REF_STALE', retryDisposition: 'after-refresh', message: expect.stringContaining('历史版本已变化') });
  const compared = await f.editor.workspace.historyCompare({ ...f.workspace, request: { checkpointId: saved.checkpointId, path: 'content/scenario/chapter/start.gal' } });
  expect(compared.files[0]!.historicalText).toContain('开始');
  const store = await NodeChangeStore.forProject(await fs.realpath(f.project), f.dataRoot);
  const file = path.join(store.projectDirectory, 'content-history', `${saved.checkpointId}.json`);
  await fs.writeFile(file, '{broken');
  await expect(f.editor.workspace.history(f.workspace)).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT', retryDisposition: 'manual-recovery', message: expect.stringContaining('原文件已保留') });
  expect(await fs.readFile(file, 'utf8')).toBe('{broken');
});

it('preserves temporary and manual-recovery lease failures across preview HTTP and the browser client', async () => {
  const f = await fixture();
  await f.publish();
  for (const foreign of [false, true]) {
    const manager = new NodeLocalLeaseManager(f.dataRoot, foreign ? { hostname: () => 'preview-foreign-host' } : {});
    const lease = await manager.acquire({ scope: 'project', resourceId: await fs.realpath(f.project) });
    try {
      const record = await fs.readFile(path.join(lease.directory, 'lease.json'), 'utf8');
      await expect(f.append()).rejects.toMatchObject({ code: 'PROJECT_BUSY',
        retryDisposition: foreign ? 'manual-recovery' : 'after-refresh' });
      expect(await fs.readFile(path.join(lease.directory, 'lease.json'), 'utf8')).toBe(record);
    } finally { await lease.release(); }
  }
  await f.append();
  expect(await f.read()).toMatchObject({ status: 'current', eventCount: 1, observation: { previewId: f.begin.previewId } });
});

it('uses real binding, HTTP, client, disk storage and MCP schemas; resolves source and never manufactures commit evidence', async () => {
  const f = await fixture();
  expect(await f.read()).toMatchObject({ status: 'unavailable', observation: null });
  f.begin.seed = 0;
  const startedMessage = f.messages[0];
  const eventMessage = f.messages[1];
  if (startedMessage?.type !== 'surdet-preview-trace-start' || eventMessage?.type !== 'surdet-preview-trace-event') throw new Error('fixture trace shape changed');
  startedMessage.seed = 0;
  eventMessage.playback = { seed: 0, sceneId: 'start', choices: [], targetVisit: 1,
    target: { sceneId: 'start', kind: 'text', anchor: null, fingerprint: sha('凛：开始。') } };
  await f.publish();
  await f.append();
  await f.append(); // A response-loss retry preserves the same facts and identity.
  expect((await f.read()).observation.events[0].playback).toEqual(eventMessage.playback);
  const observed = await f.read({ limit: 1 });
  expect(observed).toMatchObject({ status: 'current', eventCount: 1, hasMore: false,
    observation: { previewId: f.begin.previewId, projectRevision: f.begin.expectedProjectRevision,
      runtimeGeneration: 5, state: 'passed', events: [{ objectRef: expect.stringMatching(/^scene:start\/text:/), presentationApplied: true }] } });
  expect((await f.read({ offset: 1 })).observation.events).toEqual([]);
  const native = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    'runtime', 'read-preview', '--project', f.project, '--input', '-', '--json'], {
    encoding: 'utf8', env: process.env, input: JSON.stringify({ previewId: f.begin.previewId, offset: 0 }),
  });
  expect(native.status, native.stdout || native.stderr).toBe(0);
  expect(JSON.parse(native.stdout)).toMatchObject({ ok: true, result: { status: 'current', observation: {
    previewId: f.begin.previewId, events: [{ playback: eventMessage.playback }],
  } } });
  await f.session.invoke('change.begin', { intent: 'targeted repair', acceptanceCriteria: ['preserve preview facts'], initiator: 'external-agent' });
  expect((await f.read()).view).toBe('saved-project');
  const description = await f.session.describe();
  expect(description.evidence.runtime).toMatchObject({ status: 'missing' });
  expect(await fs.readFile(path.join(f.project, 'content/scenario/chapter/start.gal'), 'utf8')).toContain('凛：开始。');
}, 20_000);

it('opens the immutable capsule rather than later working files, and binds its observation across HTTP and MCP', async () => {
  const f = await fixture();
  expect((await f.session.invoke('change.begin', { intent: '封存候选试玩', initiator: 'external-agent' })).ok).toBe(true);
  expect((await f.session.invoke('scene.create', { operationId: 'sealed-scene', sceneId: 'sealed', blocks: [{ kind: 'text', value: '封存时的内容。' }] })).ok).toBe(true);
  const sealed = await f.mcp.callTool({ name: 'surdet_delivery_capsule', arguments: { label: '封存试玩' } });
  expect(sealed.isError, JSON.stringify(sealed)).not.toBe(true);
  const capsule = (sealed.structuredContent as any).result;
  const target = { kind: 'candidate' as const, changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 };
  expect((await f.session.invoke('scene.create', { operationId: 'after-seal', sceneId: 'later', blocks: [{ kind: 'text', value: '封存以后的改动。' }] })).ok).toBe(true);
  const dirty = { ...f.workspace, workspaceGeneration: 2, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
  expect((await f.editor.workspace.previewSources(dirty)).some(option => JSON.stringify(option.target) === JSON.stringify(target))).toBe(true);
  const { PreviewContentService } = await import('../src/authoring/preview-content-service.js');
  await new PreviewContentService(f.dataRoot).resolve(f.project, target);
  const content = await f.editor.workspace.previewContent({ ...dirty, target });
  expect(content.files['content/scenario/sealed.gal']).toContain('封存时的内容。');
  expect(content.files['content/scenario/later.gal']).toBeUndefined();
  const preview = { ...f.begin, sceneId: 'sealed', content: { target, contentRevision: content.contentRevision }, source: {
    assets: f.begin.source.assets, files: Object.entries(content.files).map(([file, text]) => ({ path: file, sha256: sha(previewSourceText(file, text)) })),
  } };
  await f.editor.workspace.preview({ ...dirty, preview });
  expect(await f.read()).toMatchObject({ view: 'candidate', status: 'current', observation: { content: { target } } });
  await expect(f.editor.workspace.previewContent({ ...dirty, target: { ...target, artifactSha256: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'CAPSULE_IDENTITY_MISMATCH' });
  await expect(fs.stat(path.join(f.project, 'content/scenario/sealed.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.join(f.dataRoot, (await f.editor.workspace.snapshot(dirty.workspaceSessionId)).projectIdentity, 'composition-plans'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 30_000);

it('opens the same READY integration without approving or applying, rejects substituted identity and source drift', async () => {
  const f = await fixture();
  const refs = [];
  for (const [number, session, mcp] of [[1, f.session, f.mcp]] as const) {
    expect((await session.invoke('change.begin', { intent: '组合试玩A', initiator: 'external-agent' })).ok).toBe(true);
    expect((await session.invoke('scene.create', { operationId: `a${number}`, sceneId: 'first', blocks: [{ kind: 'text', value: '第一份贡献。' }] })).ok).toBe(true);
    const sealed = (await mcp.callTool({ name: 'surdet_delivery_capsule', arguments: { label: 'A' } })).structuredContent as any;
    expect(sealed.ok).toBe(true);
    refs.push({ changeId: sealed.result.changeId, capsuleId: sealed.result.capsuleId, artifactSha256: sealed.result.artifactIdentity.sha256 });
  }
  const other = await openAgentPortSession({ projectRoot: f.project, policy: 'stage' });
  const server = createAgentPortServer(other);
  const [left, right] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'integration-preview', version: '1.0.0' });
  await server.connect(right); await mcp.connect(left);
  cleanups.push(async () => { await mcp.close(); await server.close(); await other.close(); });
  expect((await other.invoke('change.begin', { intent: '组合试玩B', initiator: 'external-agent' })).ok).toBe(true);
  expect((await other.invoke('scene.create', { operationId: 'b1', sceneId: 'second', blocks: [{ kind: 'text', value: '第二份贡献。' }] })).ok).toBe(true);
  const sealed = (await mcp.callTool({ name: 'surdet_delivery_capsule', arguments: { label: 'B' } })).structuredContent as any;
  expect(sealed.ok).toBe(true);
  refs.push({ changeId: sealed.result.changeId, capsuleId: sealed.result.capsuleId, artifactSha256: sealed.result.artifactIdentity.sha256 });
  const composition = await import('../src/authoring/composition-service.js');
  const service = await composition.compositionServiceForProject(f.project, f.dataRoot);
  const { comparison } = await service.compare(refs);
  const planned = await service.plan({ candidateRefs: refs, comparisonFingerprint: comparison.comparisonFingerprint, selectedUnitIds: comparison.units.map(unit => unit.unitId) });
  const executed = await service.executePlan({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, executeOperationId: 'preview-integration' });
  const options = await f.editor.workspace.previewSources(f.workspace);
  const target = options.find(option => option.target.kind === 'integration-result' && option.target.changeId === executed.changeId)!.target;
  expect(target.kind).toBe('integration-result');
  const content = await f.editor.workspace.previewContent({ ...f.workspace, target });
  expect(content.files['content/scenario/first.gal']).toContain('第一份贡献。');
  expect(content.files['content/scenario/second.gal']).toContain('第二份贡献。');
  await f.editor.workspace.preview({ ...f.workspace, preview: { ...f.begin, sceneId: 'first', content: { target, contentRevision: content.contentRevision },
    source: { assets: f.begin.source.assets, files: Object.entries(content.files).map(([file, text]) => ({ path: file, sha256: sha(previewSourceText(file, text)) })) } } });
  expect(await f.read()).toMatchObject({ view: 'integration-result', status: 'current', observation: { content: { target } } });
  if (target.kind !== 'integration-result') throw new Error('result missing');
  await expect(f.editor.workspace.previewContent({ ...f.workspace, target: { ...target, planFingerprint: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
  await expect(fs.stat(path.join(f.project, 'content/scenario/first.gal'))).rejects.toMatchObject({ code: 'ENOENT' });

  // Existing authoring can append to the OPEN integration. It must not then
  // be presented as the sealed plan result just because planned objects match.
  const repair = await openAgentPortSession({ projectRoot: f.project, policy: 'stage', resumeChangeId: executed.changeId });
  try {
    const extra = await repair.invoke('scene.create', {
      operationId: 'outside-sealed-plan', sceneId: 'unplanned', blocks: [{ kind: 'text', value: '不属于计划的额外场景。' }],
    });
    expect(extra.ok, JSON.stringify(extra)).toBe(true);
  } finally { await repair.close(); }
  const { NodeChangeStore } = await import('../src/authoring/node-change-store.js');
  const beforeRejection = (await NodeChangeStore.openByChangeId(executed.changeId, f.dataRoot))!.record;
  const changedTarget = (await f.editor.workspace.previewSources(f.workspace))
    .find(option => option.target.kind === 'integration-result' && option.target.changeId === executed.changeId)!.target;
  await expect(f.editor.workspace.previewContent({ ...f.workspace, target: changedTarget }))
    .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
  expect((await NodeChangeStore.openByChangeId(executed.changeId, f.dataRoot))!.record).toEqual(beforeRejection);
  expect(await f.read()).toMatchObject({ view: 'integration-result', status: 'stale' });
  await expect(fs.stat(path.join(f.project, 'content/scenario/unplanned.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.appendFile(path.join(f.project, 'content/scenario/chapter/start.gal'), '// 外部修改\n');
  expect(await f.read()).toMatchObject({ view: 'integration-result', status: 'stale' });
}, 30_000);

it('rejects wrong source, mutated retries, dirty drafts and stale messages through real structured HTTP/client errors', async () => {
  const f = await fixture();
  await expect(f.publish({ ...f.begin, expectedProjectRevision: '0'.repeat(64) }))
    .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE', retryDisposition: 'after-refresh' });
  await expect(f.publish({ ...f.begin, source: { ...f.begin.source, assets: [{ path: 'content/assets/bg/missing.svg', sha256: sha('missing') }] } }))
    .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
  await expect(f.editor.workspace.preview({ ...f.workspace, workspaceGeneration: 2, availability: 'dirty', dirtyScopes: ['scene'], preview: f.begin }))
    .rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_DIRTY' });
  f.workspace.workspaceGeneration = 3;
  await f.publish();
  await expect(f.publish({ ...f.begin, label: 'changed' })).rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
  await f.append([f.messages[0]!]);
  await expect(f.append([{ ...f.messages[1]!, sequence: 1 } as PreviewTraceMessage])).rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
  await f.append(f.messages.slice(1));
  const next = { ...f.begin, previewId: `preview-${crypto.randomUUID()}`, previewGeneration: 2 };
  await f.publish(next);
  await expect(f.append()).rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_STALE' });
  expect((await f.read()).observation).toMatchObject({ previewId: next.previewId, state: 'starting', events: [] });
  expect(await f.read({ previewId: f.begin.previewId })).toMatchObject({ status: 'unavailable' });
});

it('invalidates observations after real image bytes or saved content change, and after workspace disconnect', async () => {
  const f = await fixture();
  await f.publish(); await f.append();
  await fs.writeFile(path.join(f.project, 'content/assets/bg/night.svg'), '<SVG/>');
  expect(await f.read()).toMatchObject({ status: 'stale', reasons: ['preview-source-changed'] });
  await fs.writeFile(path.join(f.project, 'content/scenario/chapter/start.gal'), '@scene start\n凛：磁盘新版本。\n@end\n');
  expect((await f.read()).reasons).toContain('saved-content-changed');
  await f.editor.workspace.revoke(f.workspace.workspaceSessionId);
  expect(await f.read()).toMatchObject({ status: 'unavailable', observation: null });
  expect(await new PreviewObservationService(f.dataRoot).read(await fs.realpath(path.dirname(f.project))))
    .toMatchObject({ status: 'unavailable', observation: null });
});

it('requires selecting a publicly returned preview when multiple bound workspaces are active', async () => {
  const f = await fixture();
  await f.publish(); await f.append();
  const secondWorkspace = { ...f.workspace, workspaceSessionId: crypto.randomUUID() };
  await f.editor.workspace.heartbeat(secondWorkspace);
  await f.editor.workspace.preview({ ...secondWorkspace, preview: { ...f.begin, previewId: `preview-${crypto.randomUUID()}` } });
  const ambiguous = await f.read();
  expect(ambiguous).toMatchObject({ status: 'ambiguous', observation: null });
  expect(ambiguous.availablePreviews).toHaveLength(2);
  expect(await f.read({ previewId: ambiguous.availablePreviews[0].previewId })).toMatchObject({ status: 'current' });
});

it('does not call an observation current if it is invalidated while reading source facts', async () => {
  const f = await fixture();
  await f.publish(); await f.append();
  const original = NodeProjectStorage.prototype.readFileFingerprint;
  vi.spyOn(NodeProjectStorage.prototype, 'readFileFingerprint').mockImplementationOnce(async function (this: NodeProjectStorage, file) {
    const fact = await original.call(this, file);
    await f.editor.workspace.preview({ ...f.workspace, preview: { action: 'invalidate', previewGeneration: 1, reason: 'reload' } });
    return fact;
  });
  expect(await f.read()).toMatchObject({ status: 'stale', reasons: ['changed-during-read'] });
  expect(await f.read()).toMatchObject({ status: 'unavailable', observation: null });
});

it('preserves corrupt observations and exposes their specific error through MCP and the real HTTP client', async () => {
  const f = await fixture();
  await f.publish(); await f.append();
  const observed = (await f.read()).observation;
  const file = path.join(f.dataRoot, 'preview-observations', observed.projectIdentity, `${f.workspace.workspaceSessionId}.json`);
  await fs.writeFile(file, '{ interrupted record');
  const response = await f.mcp.callTool({ name: 'surdet_runtime_read_preview', arguments: {} });
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toMatchObject({ ok: false, error: { code: 'PREVIEW_OBSERVATION_CORRUPT' } });
  expect(JSON.stringify(response.structuredContent)).not.toContain(f.dataRoot.replaceAll('\\', '\\\\'));
  await expect(f.publish({ ...f.begin, previewGeneration: 2 }))
    .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_CORRUPT', retryDisposition: 'manual-recovery' });
  expect(await fs.readFile(file, 'utf8')).toBe('{ interrupted record');
});

it('observes public assets and detects their byte, directory and missing-file changes', async () => {
  const f = await fixture();
  const publicRelative = 'public/bg/night.svg';
  const publicImage = path.join(f.project, publicRelative);
  await fs.mkdir(path.dirname(publicImage), { recursive: true });
  await fs.rename(path.join(f.project, 'content/assets/bg/night.svg'), publicImage);
  const baseline = (await f.editor.workspace.snapshot(f.workspace.workspaceSessionId)).diskBaseline;
  f.workspace.workspaceGeneration += 1;
  f.workspace.loadedProjectRevision = baseline.projectRevision;
  f.workspace.loadedCoordinationRevision = baseline.coordinationRevision;
  f.begin.expectedProjectRevision = baseline.projectRevision;
  f.begin.expectedCoordinationRevision = baseline.coordinationRevision;
  f.begin.source.assets = [{ path: publicRelative, sha256: sha('<svg/>') }];

  await f.publish(); await f.append();
  expect(await f.read()).toMatchObject({ status: 'current', observation: {
    previewId: f.begin.previewId, source: { assets: [{ path: publicRelative, sha256: sha('<svg/>') }] },
  } });
  await fs.writeFile(publicImage, '<SVG/>');
  const changedBytes = await f.read();
  expect(changedBytes.status).toBe('stale');
  expect(changedBytes.reasons).toContain('preview-source-changed');
  await fs.writeFile(publicImage, '<svg/>');
  expect((await f.read()).status).toBe('current');

  const addedImage = path.join(f.project, 'public/bg/another.svg');
  await fs.writeFile(addedImage, '<svg/>');
  const changedDirectory = await f.read();
  expect(changedDirectory.status).toBe('stale');
  expect(changedDirectory.reasons).toContain('preview-source-changed');
  await fs.unlink(addedImage); // Only this test's extra image.
  await fs.rename(publicImage, addedImage);
  const missingSource = await f.read();
  expect(missingSource.status).toBe('stale');
  expect(missingSource.reasons).toContain('preview-source-unavailable');
  await fs.rename(addedImage, publicImage);

  for (const unsafePath of ['public/../../outside.svg', 'private/night.svg']) {
    await expect(f.publish({ ...f.begin, previewGeneration: 2, source: {
      ...f.begin.source, assets: [{ path: unsafePath, sha256: sha('<svg/>') }],
    } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }
  expect(await f.read()).toMatchObject({ status: 'current', observation: { previewId: f.begin.previewId } });
}, 20_000);

it('plays an isolated working revision through the bound HTTP client and MCP observation without saving human drafts or source files', async () => {
  const f = await fixture();
  const sourceBefore = await fs.readFile(path.join(f.project, 'content/scenario/chapter/start.gal'), 'utf8');
  const started = await f.session.invoke('change.begin', { intent: '章节返修', initiator: 'external-agent' });
  expect(started.ok, JSON.stringify(started)).toBe(true);
  if (!started.ok) throw new Error(started.error.message);
  const changeId = (started.result as { changeId: string }).changeId;
  expect((await f.session.invoke('scene.create', { operationId: 'working-scene', sceneId: 'isolated',
    blocks: [{ kind: 'text', speaker: '凛', value: '尚未写回的章节。' }] })).ok).toBe(true);
  const dirty = { ...f.workspace, workspaceGeneration: 2, availability: 'dirty' as const, dirtyScopes: ['scene' as const] };
  const options = await f.editor.workspace.previewSources(dirty);
  expect(options).toContainEqual({ target: { kind: 'working-change', changeId }, title: expect.stringContaining('章节返修') });
  const content = await f.editor.workspace.previewContent({ ...dirty, target: { kind: 'working-change', changeId } });
  expect(content.target).toEqual({ kind: 'working-change', changeId, workingRevision: 1 });
  expect(content.files['content/scenario/isolated.gal']).toContain('尚未写回的章节。');
  expect(content.files['content/config/terminology.json']).toContain('来源词条');
  expect(content.contentRevision).not.toBe(content.projectRevision);
  const begin: PreviewBeginInput = { ...f.begin, sceneId: 'isolated',
    content: { target: content.target, contentRevision: content.contentRevision },
    source: { files: Object.entries(content.files).map(([file, text]) => ({ path: file, sha256: sha(previewSourceText(file, text)) })), assets: f.begin.source.assets } };
  await f.editor.workspace.preview({ ...dirty, preview: begin });
  await f.editor.workspace.preview({ ...dirty, preview: { action: 'append', previewId: begin.previewId, previewGeneration: 1,
    messages: [
      { type: 'surdet-preview-trace-start', traceId: begin.previewId, generation: 1, sceneId: 'isolated' },
      { type: 'surdet-preview-trace-event', traceId: begin.previewId, generation: 1, sequence: 0, coreEmitted: true,
        presentationApplied: false, presentationBefore: {}, presentationAfter: {}, event: { kind: 'instruction',
          source: { sceneId: 'isolated', index: 0, op: 'text', file: 'isolated.gal', line: 2, col: 1 } } },
    ] } });
  const observation = await f.read();
  expect(observation).toMatchObject({ view: 'working-change', status: 'current', observation: {
    content: { target: content.target, contentRevision: content.contentRevision }, events: [{ objectRef: expect.stringMatching(/^scene:isolated\/text:/) }] } });
  const target = observation.observation.events[0].objectRef;
  const inspect = await f.session.invoke('object.inspect', { objectRef: target });
  expect(inspect.ok).toBe(true);
  expect((await f.session.invoke('scene.create', { operationId: 'working-next', sceneId: 'next',
    blocks: [{ kind: 'text', value: '修改后的新版本。' }] })).ok).toBe(true);
  expect(await f.read()).toMatchObject({ view: 'working-change', status: 'stale' });
  await expect(f.editor.workspace.previewContent({ ...dirty, target: content.target }))
    .rejects.toMatchObject({ code: 'PREVIEW_CONTENT_CHANGED', message: expect.stringContaining('新修改') });
  const reloaded = await f.editor.workspace.previewContent({ ...dirty, target: { kind: 'working-change', changeId } });
  expect(reloaded.target).toMatchObject({ changeId, workingRevision: 2 });
  expect(await fs.readFile(path.join(f.project, 'content/scenario/chapter/start.gal'), 'utf8')).toBe(sourceBefore);
  await expect(fs.stat(path.join(f.project, 'content/scenario/isolated.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  const snapshot = await f.editor.workspace.snapshot(dirty.workspaceSessionId);
  expect(snapshot.diskBaseline.projectRevision).toBe(f.begin.expectedProjectRevision);
}, 20_000);
