import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import { ProjectAssetImportAuthority } from '../src/asset-import-authority/authority.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { ProjectSceneLifecycleAuthority, SceneLifecycleInjectedTermination } from '../src/asset-import-authority/scene-lifecycle-authority.js';
import { ProjectMutationLeaseContext } from '../src/editor-workspace-authority/project-mutation-lease-context.js';

const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Y9sAAAAASUVORK5CYII=', 'base64');
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['SURDET_AGENT_DATA_DIR'];
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-agent-images-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const source = path.join(root, 'images');
  await fs.mkdir(path.join(projectRoot, 'content/scenario'), { recursive: true });
  await fs.mkdir(source);
  await fs.writeFile(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }));
  await fs.writeFile(path.join(projectRoot, 'content/scenario/start.gal'), '@scene start\n凛：开始。\n@end\n');
  await fs.writeFile(path.join(source, 'night.png'), png);
  process.env['SURDET_AGENT_DATA_DIR'] = path.join(root, 'data');
  const open = (policy: 'observe' | 'stage' | 'apply') => openAgentPortSession({ projectRoot, policy, assetSources: [source], assetImportDataRoot: path.join(root, 'asset-data') });
  return { root, source, projectRoot, open };
}
function result(envelope: any): any {
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  return envelope.result;
}
async function requestFor(session: Awaited<ReturnType<typeof openAgentPortSession>>, fileName = 'night.png', kind = 'background') {
  const sourceId = result(await session.invoke('asset.sources', {})).roots[0].sourceId;
  const file = result(await session.invoke('asset.sources', { sourceId, path: 'night.png' })).file;
  return { operationId: crypto.randomUUID(), items: [{ itemId: crypto.randomUUID(), sourceId, sourcePath: 'night.png', sha256: file.sha256, kind, fileName }] };
}

it('stages via the public port without project writes, resumes and commits exactly once, then returns usable catalog keys', async () => {
  const f = await fixture();
  const stage = await f.open('stage');
  const sources = result(await stage.invoke('asset.sources', {}));
  const sourceId = sources.roots[0].sourceId;
  const sourceFile = result(await stage.invoke('asset.sources', { sourceId, path: 'night.png' }));
  const request = { operationId: crypto.randomUUID(), items: [{ itemId: crypto.randomUUID(), sourceId, sourcePath: 'night.png', sha256: sourceFile.file.sha256, kind: 'background', fileName: 'night.png' }] };
  const ready = result(await stage.invoke('asset.import.stage', request));
  expect(ready.operation.status).toBe('READY');
  expect(await fs.stat(path.join(f.projectRoot, 'content/assets/bg/night.png')).catch(() => null)).toBeNull();
  expect(await stage.invoke('asset.import.commit', { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint })).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
  await stage.close();
  const apply = await f.open('apply');
  expect(result(await apply.invoke('asset.import.inspect', { operationId: request.operationId })).operation.status).toBe('READY');
  expect(result(await apply.invoke('asset.import.stage', request)).plan.planId).toBe(ready.plan.planId);
  const committed = result(await apply.invoke('asset.import.commit', { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint }));
  expect(committed.operation.status).toBe('COMMITTED');
  expect(committed.coordination.status).toBe('written');
  const retried = result(await apply.invoke('asset.import.commit', { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint }));
  expect(retried.receipt.receiptId).toBe(committed.receipt.receiptId);
  expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(png);
  const catalog = result(await apply.invoke('project.assets', {}));
  expect(catalog.backgrounds).toContainEqual(expect.objectContaining({ key: 'night' }));
  await apply.close();
});

it('rejects source traversal and ungranted source identifiers through structured public errors', async () => {
  const f = await fixture();
  const session = await f.open('stage');
  const sourceId = result(await session.invoke('asset.sources', {})).roots[0].sourceId;
  for (const input of [{ sourceId, path: '../project/game.config.json' }, { sourceId: 'ungranted', path: 'night.png' }]) {
    expect(await session.invoke('asset.sources', input)).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_FORBIDDEN' } });
  }
  await session.close();
});

it('reports real name collisions, allows target repair before sealing, and never changes sealed sources or targets', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.projectRoot, 'content/assets/bg'), { recursive: true });
  const old = Buffer.from('preserved old asset');
  await fs.writeFile(path.join(f.projectRoot, 'content/assets/bg/night.png'), old);
  const session = await f.open('apply');
  const request = await requestFor(session);
  const blocked: any = await session.invoke('asset.import.stage', request);
  expect(blocked).toMatchObject({ ok: false, error: { code: 'IMPORT_PLAN_BLOCKED', details: { plan: { issues: expect.arrayContaining(['IMPORT_TARGET_EXISTS']) } } } });
  const wrongFormat = structuredClone(request);
  wrongFormat.items[0]!.fileName = 'new-night.jpg';
  expect(await session.invoke('asset.import.stage', wrongFormat)).toMatchObject({ ok: false, error: { code: 'ASSET_IMAGE_INVALID' } });
  request.items[0]!.fileName = 'new-night.png';
  const ready = result(await session.invoke('asset.import.stage', request));
  const changedTarget = structuredClone(request);
  changedTarget.items[0]!.fileName = 'another-night.png';
  expect(await session.invoke('asset.import.stage', changedTarget)).toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
  const changedSource = structuredClone(request);
  changedSource.items[0]!.sha256 = 'a'.repeat(64);
  expect(await session.invoke('asset.import.stage', changedSource)).toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
  result(await session.invoke('asset.import.commit', { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint }));
  expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(old);
  expect(await session.invoke('asset.import.commit', { operationId: request.operationId, planFingerprint: 'a'.repeat(64) })).toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
});

it('does not create a second asset with the same runtime key under a different extension or subdirectory', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.projectRoot, 'content/assets/bg/old'), { recursive: true });
  await fs.writeFile(path.join(f.projectRoot, 'content/assets/bg/old/night.webp'), 'existing');
  const session = await f.open('apply');
  const request = await requestFor(session);
  expect(await session.invoke('asset.import.stage', request)).toMatchObject({ ok: false, error: { code: 'IMPORT_PLAN_BLOCKED', details: { plan: { issues: expect.arrayContaining(['IMPORT_ASSET_KEY_CONFLICT']) } } } });
  expect(await fs.stat(path.join(f.projectRoot, 'content/assets/bg/night.png')).catch(() => null)).toBeNull();
});

it('rechecks runtime key collisions that appear after the import plan was sealed', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  const request = await requestFor(session);
  const ready = result(await session.invoke('asset.import.stage', request));
  await fs.mkdir(path.join(f.projectRoot, 'content/assets/bg'), { recursive: true });
  await fs.writeFile(path.join(f.projectRoot, 'content/assets/bg/night.webp'), 'existing');
  const committed: any = await session.invoke('asset.import.commit', {
    operationId: request.operationId, planFingerprint: ready.plan.planFingerprint,
  });
  expect(committed).toMatchObject({ ok: false, error: { code: 'IMPORT_PLAN_STALE' } });
  expect(await fs.readdir(path.join(f.projectRoot, 'content/assets/bg'))).toEqual(['night.webp']);
  expect(result(await session.invoke('asset.import.inspect', { operationId: request.operationId })).receipt).toBeNull();
  await session.close();
});

it('blocks writes while a real bound workspace is dirty and while the session has a story change', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  const request = await requestFor(session);
  const ready = result(await session.invoke('asset.import.stage', request));
  const workspace = new HumanWorkspaceStore({ dataRoot: path.join(f.root, 'data') });
  const workspaceIdentity = { workspaceSessionId: crypto.randomUUID(), browserSessionId: 'image-test', workspaceGeneration: 1 };
  await workspace.heartbeat(f.projectRoot, { ...workspaceIdentity, availability: 'dirty', dirtyScopes: ['scene'] });
  const commit = { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint };
  expect(await session.invoke('asset.import.commit', commit)).toMatchObject({ ok: false, error: { code: 'HUMAN_WORKSPACE_DIRTY' } });
  expect(result(await session.invoke('asset.import.inspect', { operationId: request.operationId })).operation.status).toBe('READY');
  await workspace.heartbeat(f.projectRoot, { ...workspaceIdentity, workspaceGeneration: 2, availability: 'clean' });
  result(await session.invoke('change.begin', {}));
  expect(await session.invoke('asset.import.commit', commit)).toMatchObject({ ok: false, error: { code: 'SESSION_STATE_INVALID' } });
  result(await session.invoke('change.rollback', {}));
  expect(result(await session.invoke('asset.import.commit', commit)).operation.status).toBe('COMMITTED');
});

it('does not recover or modify an interrupted Editor scene save while staging images', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  const request = await requestFor(session);
  const paths = await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') });
  const lease = await ProjectMutationLeaseContext.open(f.projectRoot);
  const sceneRequestId = crypto.randomUUID();
  const scene = new ProjectSceneLifecycleAuthority(paths, {
    assertLeaseHeld: () => lease.assertHeld(),
    faultInjector: point => { if (point === 'after_first_publish') throw new SceneLifecycleInjectedTermination(point); },
  });
  await expect(lease.run(() => scene.commit({ requestId: sceneRequestId, plans: [], writes: [
    { path: 'content/scenario/partial.gal', text: '@scene partial\n旁白：保留现场。\n@end\n', expectedSha256: null },
    { path: 'content/scenario/second.gal', text: '@scene second\n@end\n', expectedSha256: null },
  ] }))).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
  const partial = path.join(f.projectRoot, 'content/scenario/partial.gal');
  const before = await fs.readFile(partial);
  expect(await session.invoke('asset.import.stage', request)).toMatchObject({ ok: false,
    error: { code: 'IMPORT_RECOVERY_REQUIRED' } });
  expect(await fs.readFile(partial)).toEqual(before);
  expect(await fs.stat(path.join(f.projectRoot, 'content/assets')).catch(() => null)).toBeNull();
  await lease.run(() => new ProjectSceneLifecycleAuthority(paths, { assertLeaseHeld: () => lease.assertHeld() }).recoverPending());
  expect(await fs.stat(partial).catch(() => null)).toBeNull();
  expect(result(await session.invoke('asset.import.stage', request)).operation.status).toBe('READY');
  await session.close();
});

it('rejects changed image bytes and Windows junction traversal without reading outside the grant', async () => {
  const f = await fixture();
  const session = await f.open('stage');
  const request = await requestFor(session);
  const privateDirectory = path.join(f.root, 'private');
  await fs.mkdir(privateDirectory);
  await fs.writeFile(path.join(privateDirectory, 'hidden.png'), png);
  await fs.symlink(privateDirectory, path.join(f.source, 'shortcut'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(await session.invoke('asset.sources', { sourceId: request.items[0]!.sourceId, path: 'shortcut/hidden.png' })).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_FORBIDDEN' } });
  await fs.writeFile(path.join(f.source, 'night.png'), Buffer.concat([png, Buffer.from('changed')]));
  expect(await session.invoke('asset.import.stage', request)).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_CHANGED' } });
  await fs.rename(f.source, `${f.source}-original`);
  await fs.mkdir(f.source);
  await fs.writeFile(path.join(f.source, 'night.png'), png);
  expect(await session.invoke('asset.sources', { sourceId: request.items[0]!.sourceId, path: 'night.png' })).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_FORBIDDEN' } });
});

it('reconciles an interrupted multi-image upload through MCP and preserves structured failures', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  const request = await requestFor(session);
  request.items.push({ ...request.items[0]!, itemId: crypto.randomUUID(), kind: 'portrait', fileName: 'rin_uniform_smile.png' });
  request.items.push({ ...request.items[0]!, itemId: crypto.randomUUID(), kind: 'portrait', fileName: 'rin_uniform_sad.png' });
  request.items.push({ ...request.items[0]!, itemId: crypto.randomUUID(), kind: 'avatar', fileName: 'rin.png' });
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'image-regression', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const original = ProjectAssetImportAuthority.prototype.uploadItem;
    const stopped = vi.spyOn(ProjectAssetImportAuthority.prototype, 'uploadItem').mockImplementationOnce(async function (this: ProjectAssetImportAuthority, ...args) {
      await original.apply(this, args);
      throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' });
    });
    const failed = await client.callTool({ name: 'surdet_asset_import_stage', arguments: request });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ ok: false, error: { code: 'IMPORT_IO_FAILED', details: { operationId: request.operationId } } });
    const text = failed.content.find((item: any) => item.type === 'text') as { text: string };
    expect(JSON.parse(text.text)).toEqual(failed.structuredContent);
    stopped.mockRestore();
    const inspecting = await client.callTool({ name: 'surdet_asset_import_inspect', arguments: { operationId: request.operationId } });
    expect(result(inspecting.structuredContent).stagedItems).toHaveLength(1);
    const staged = await client.callTool({ name: 'surdet_asset_import_stage', arguments: request });
    const ready = result(staged.structuredContent);
    const published = await client.callTool({ name: 'surdet_asset_import_commit', arguments: { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint } });
    const done = result(published.structuredContent);
    expect(done.catalog.portraits).toContainEqual(expect.objectContaining({ timelineTarget: 'rin:uniform', expression: 'smile' }));
    expect(done.catalog.portraits).toContainEqual(expect.objectContaining({ timelineTarget: 'rin:uniform', expression: 'sad' }));
    expect(done.catalog.avatars).toContainEqual(expect.objectContaining({ key: 'rin' }));
  } finally { await client.close(); await server.close(); await session.close(); }
});

it('recovers the same real stdio import after the server process exits after writing its receipt', async () => {
  const f = await fixture();
  const staging = await f.open('stage');
  const request = await requestFor(staging);
  const ready = result(await staging.invoke('asset.import.stage', request));
  await staging.close();
  const repo = path.resolve(import.meta.dirname, '../../..');
  const childFile = path.join(f.root, 'interrupted-port.mjs');
  await fs.writeFile(childFile, `
import { ProjectAssetImportAuthority } from ${JSON.stringify(pathToFileURL(path.join(repo, 'packages/cli/dist/asset-import-authority/authority.js')).href)};
const commit = ProjectAssetImportAuthority.prototype.commit;
ProjectAssetImportAuthority.prototype.commit = function (...args) {
  this.faultInjector = point => { if (point === 'after_receipt_create_before_committed_journal') process.exit(73); };
  return commit.apply(this, args);
};
await import(${JSON.stringify(pathToFileURL(path.join(repo, 'packages/cli/dist/agent-port/main.js')).href)});
`);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [childFile, '--project', f.projectRoot, '--policy', 'apply', '--asset-import-data-root', path.join(f.root, 'asset-data')],
    env: { ...process.env as Record<string, string>, SURDET_AGENT_DATA_DIR: path.join(f.root, 'data') }, stderr: 'pipe',
  });
  const client = new Client({ name: 'image-restart-regression', version: '1.0.0' });
  await client.connect(transport);
  const commit = { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint };
  try {
    await expect(client.callTool({ name: 'surdet_asset_import_commit', arguments: commit })).rejects.toThrow();
  } finally { await client.close(); }
  const resumed = await f.open('apply');
  let inspection: any = await resumed.invoke('asset.import.inspect', { operationId: request.operationId });
  if (!inspection.ok) {
    expect(inspection.error.code).toBe('PROJECT_BUSY');
    await new Promise(resolve => setTimeout(resolve, 15_100));
    inspection = await resumed.invoke('asset.import.inspect', { operationId: request.operationId });
  }
  const interrupted = result(inspection);
  expect(interrupted.operation.status).toBe('PUBLISHING');
  expect(interrupted.receipt.receiptId).toBeTruthy();
  const recovered = result(await resumed.invoke('asset.import.recover', commit));
  expect(recovered.operation).toMatchObject({ operationId: request.operationId, status: 'COMMITTED' });
  expect(recovered.receipt.receiptId).toBe(interrupted.receipt.receiptId);
  expect(recovered.plan.planId).toBe(ready.plan.planId);
  expect(await fs.readdir(path.join(f.projectRoot, 'content/assets/bg'))).toEqual(['night.png']);
  expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(png);
  await resumed.close();
}, 45_000);
