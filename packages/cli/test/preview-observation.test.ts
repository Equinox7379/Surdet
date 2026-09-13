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

it('uses real binding, HTTP, client, disk storage and MCP schemas; resolves source and never manufactures commit evidence', async () => {
  const f = await fixture();
  expect(await f.read()).toMatchObject({ status: 'unavailable', observation: null });
  await f.publish();
  await f.append();
  await f.append(); // A response-loss retry preserves the same facts and identity.
  const observed = await f.read({ limit: 1 });
  expect(observed).toMatchObject({ status: 'current', eventCount: 1, hasMore: false,
    observation: { previewId: f.begin.previewId, projectRevision: f.begin.expectedProjectRevision,
      runtimeGeneration: 5, state: 'passed', events: [{ objectRef: expect.stringMatching(/^scene:start\/text:/), presentationApplied: true }] } });
  expect((await f.read({ offset: 1 })).observation.events).toEqual([]);
  const native = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    'runtime', 'read-preview', '--project', f.project, '--input', '-', '--json'], {
    encoding: 'utf8', env: process.env, input: JSON.stringify({ previewId: f.begin.previewId, offset: 1 }),
  });
  expect(native.status, native.stdout || native.stderr).toBe(0);
  expect(JSON.parse(native.stdout)).toMatchObject({ ok: true, result: { status: 'current', observation: { previewId: f.begin.previewId, events: [] } } });
  await f.session.invoke('change.begin', { intent: 'targeted repair', acceptanceCriteria: ['preserve preview facts'], initiator: 'external-agent' });
  expect((await f.read()).view).toBe('saved-project');
  const description = await f.session.describe();
  expect(description.evidence.runtime).toMatchObject({ status: 'missing' });
  expect(await fs.readFile(path.join(f.project, 'content/scenario/chapter/start.gal'), 'utf8')).toContain('凛：开始。');
}, 20_000);

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
