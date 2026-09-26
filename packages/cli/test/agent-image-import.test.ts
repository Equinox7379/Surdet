import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import { AssetImportInjectedTermination, ProjectAssetImportAuthority } from '../src/asset-import-authority/authority.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { ProjectSceneLifecycleAuthority, SceneLifecycleInjectedTermination } from '../src/asset-import-authority/scene-lifecycle-authority.js';
import { ProjectMutationLeaseContext } from '../src/editor-workspace-authority/project-mutation-lease-context.js';

// Real persisted MCP/import workflows may cross the default 5s on Windows disks.
vi.setConfig({ testTimeout: 30_000 });
const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Y9sAAAAASUVORK5CYII=', 'base64');
const wav = Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex');
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

it('relocation is reachable through real MCP with stage/apply boundaries, exact receipts and reversible source edits', async () => {
  const f = await fixture();
  const sourcePath = 'content/assets/bgm/旧 声音.wav', targetPath = 'content/assets/bgm/新 声音.wav';
  await fs.mkdir(path.dirname(path.join(f.projectRoot, sourcePath)), { recursive: true });
  await fs.writeFile(path.join(f.projectRoot, sourcePath), wav);
  const scenePath = path.join(f.projectRoot, 'content/scenario/start.gal');
  const before = '@scene start\n@bgm "旧 声音"\n旁白：播放。\n@end\n';
  await fs.writeFile(scenePath, before);
  const stage = await f.open('stage');
  const operationId = crypto.randomUUID();
  const ready = result(await stage.invoke('asset.relocation.plan', { operationId, moves: [{ sourcePath, targetPath }] }));
  expect(ready.plan.status).toBe('ready');
  expect(await fs.readFile(scenePath, 'utf8')).toBe(before);
  expect(await fs.readFile(path.join(f.projectRoot, sourcePath))).toEqual(wav);
  const commit = { operationId, planFingerprint: ready.plan.planFingerprint };
  expect(await stage.invoke('asset.relocation.commit', commit)).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
  await stage.close();
  const session = await f.open('apply');
  const server = createAgentPortServer(session);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'relocation-author', version: '1.0.0' });
  await server.connect(st); await client.connect(ct);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return result(response.structuredContent);
    };
    expect((await client.listTools()).tools.some(tool => tool.name === 'surdet_asset_relocation_commit')).toBe(true);
    const observed = await call('surdet_asset_relocation_inspect', { operationId });
    expect(observed.plan.planFingerprint).toBe(ready.plan.planFingerprint);
    const stale = await client.callTool({ name: 'surdet_asset_relocation_commit', arguments: { ...commit, planFingerprint: '0'.repeat(64) } });
    expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
    const done = await call('surdet_asset_relocation_commit', commit);
    expect(done.operation.status).toBe('COMMITTED');
    expect(done.coordination.status).toBe('written');
    expect((await call('surdet_asset_relocation_commit', commit)).receipt).toEqual(done.receipt);
    expect(await fs.readFile(scenePath, 'utf8')).toBe(before.replace('旧 声音', '新 声音'));
    expect(await fs.readFile(path.join(f.projectRoot, targetPath))).toEqual(wav);
    const undone = await call('surdet_asset_relocation_undo', { operationId, receiptId: done.receipt.receiptId, receiptFingerprint: done.receipt.receiptFingerprint });
    expect(undone.operation.status).toBe('UNDONE');
    expect(await fs.readFile(scenePath, 'utf8')).toBe(before);
    expect(await fs.readFile(path.join(f.projectRoot, sourcePath))).toEqual(wav);
    result(await session.invoke('change.begin', { intent: 'no asset source writes inside a story draft', compositionMode: 'direct' }));
    expect(await session.invoke('asset.relocation.plan', { operationId: crypto.randomUUID(), moves: [{ sourcePath, targetPath }] })).toMatchObject({ ok: false, error: { code: 'SESSION_STATE_INVALID' } });
  } finally { await client.close(); await server.close(); await session.close(); }
});

it('relocation cancel ends only an unpublished exact plan and never grants observe write permission', async () => {
  const f = await fixture();
  const sourcePath = 'content/assets/bg/night.png', targetPath = 'content/assets/bg/dawn.png';
  await fs.mkdir(path.dirname(path.join(f.projectRoot, sourcePath)), { recursive: true });
  await fs.writeFile(path.join(f.projectRoot, sourcePath), png);
  const session = await f.open('stage'), observe = await f.open('observe');
  try {
    const operationId = crypto.randomUUID(), input = { operationId, moves: [{ sourcePath, targetPath }] };
    expect(await observe.invoke('asset.relocation.plan', input)).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    const ready = result(await session.invoke('asset.relocation.plan', input));
    const cancelled = result(await session.invoke('asset.relocation.cancel', { operationId, planFingerprint: ready.plan.planFingerprint }));
    expect(cancelled.operation.status).toBe('CANCELLED');
    expect(await fs.readFile(path.join(f.projectRoot, sourcePath))).toEqual(png);
    expect(await fs.stat(path.join(f.projectRoot, targetPath)).catch(() => null)).toBeNull();
  } finally { await session.close(); await observe.close(); }
});

it('public inspect of an unknown operation is read-only; a registered recovery barrier is visible in session discovery', async () => {
  const f = await fixture();
  const observe = await f.open('observe');
  expect(await observe.invoke('asset.import.inspect', { operationId: crypto.randomUUID() }))
    .toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_NOT_FOUND' } });
  expect((await observe.describe()).manualRecoveryRequired).toBe(false);
  const apply = await f.open('apply');
  const request = await requestFor(apply);
  result(await apply.invoke('asset.import.stage', request));
  const store = new AssetImportRecordStore(await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') }));
  await store.ensureOperationRecoveryBarrier(request.operationId, new Date().toISOString(), 'maintenance-fixture');
  const description = await apply.describe();
  expect(description.manualRecoveryRequired).toBe(true);
  expect(description.capabilities.find(capability => capability.id === 'asset.import.stage')?.availability).toBe('state-blocked');
  expect(description.capabilities.find(capability => capability.id === 'asset.import.commit')?.availability).toBe('state-blocked');
  expect(description.nextActions).toContain('asset.import.inspect');
});

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
}, 30_000);

it('rejects source traversal and ungranted source identifiers through structured public errors', async () => {
  const f = await fixture();
  const session = await f.open('stage');
  const sourceId = result(await session.invoke('asset.sources', {})).roots[0].sourceId;
  for (const input of [{ sourceId, path: '../project/game.config.json' }, { sourceId: 'ungranted', path: 'night.png' }]) {
    expect(await session.invoke('asset.sources', input)).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_FORBIDDEN' } });
  }
  await session.close();
});

it('imports prepared media through the same public policy, retry and real catalog path', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.source, '雨 夜'));
  await fs.writeFile(path.join(f.source, '雨 夜/声 音.WAV'), wav);
  // Existing repository font, not a fake header used as decoding evidence.
  const font = await fs.readFile(path.resolve(import.meta.dirname, '../../../examples/starter/content/assets/fonts/MiSans-Regular.otf'));
  await fs.writeFile(path.join(f.source, '雨 夜/字体.otf'), font);
  const license = Buffer.from('\uFEFFCopyright fixture author\r\n授权说明，非法律认证。\r\n');
  await fs.writeFile(path.join(f.source, '雨 夜/LICENSE-字体'), license);
  const stage = await f.open('stage');
  let apply: Awaited<ReturnType<typeof f.open>> | undefined;
  try {
    const sources = result(await stage.invoke('asset.sources', {}));
    expect(sources).toMatchObject({ validation: 'container-header-or-utf8-text', supportedFormats: expect.arrayContaining(['wav', 'ogg', 'mp3', 'mp4', 'webm', 'ttf', 'otf', 'woff2']) });
    const sourceId = sources.roots[0].sourceId;
    const listing = result(await stage.invoke('asset.sources', { sourceId, path: '雨 夜' }));
    expect(listing.entries.map((entry: any) => entry.path).sort()).toEqual(['雨 夜/声 音.WAV', '雨 夜/字体.otf', '雨 夜/LICENSE-字体'].sort());
    const audio = result(await stage.invoke('asset.sources', { sourceId, path: '雨 夜/声 音.WAV' })).file;
    const fontFact = result(await stage.invoke('asset.sources', { sourceId, path: '雨 夜/字体.otf' })).file;
    const items = ['music', 'ambience', 'sound-effect', 'voice'].map(kind => ({ itemId: crypto.randomUUID(), sourceId, sourcePath: audio.path, sha256: audio.sha256, kind, fileName: '雨 夜.wav' }));
    items.push({ itemId: crypto.randomUUID(), sourceId, sourcePath: fontFact.path, sha256: fontFact.sha256, kind: 'font', fileName: '正文.otf' });
    const licenseFact = result(await stage.invoke('asset.sources', { sourceId, path: '雨 夜/LICENSE-字体' })).file;
    items.push({ itemId: crypto.randomUUID(), sourceId, sourcePath: licenseFact.path, sha256: licenseFact.sha256, kind: 'license', fileName: 'LICENSE-正文' });
    const request = { operationId: crypto.randomUUID(), items };
    const ready = result(await stage.invoke('asset.import.stage', request));
    expect(ready.operation.status).toBe('READY');
    expect(await fs.stat(path.join(f.projectRoot, 'content/assets')).catch(() => null)).toBeNull();
    const commit = { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint };
    expect(await stage.invoke('asset.import.commit', commit)).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    await stage.close();
    apply = await f.open('apply');
    expect(result(await apply.invoke('asset.import.stage', request)).plan.planId).toBe(ready.plan.planId);
    const committed = result(await apply.invoke('asset.import.commit', commit));
    expect(result(await apply.invoke('asset.import.commit', commit)).receipt.receiptId).toBe(committed.receipt.receiptId);
    for (const directory of ['bgm', 'ambience', 'se', 'voice']) expect(await fs.readFile(path.join(f.projectRoot, `content/assets/${directory}/雨 夜.wav`))).toEqual(wav);
    expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/fonts/正文.otf'))).toEqual(font);
    expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/licenses/LICENSE-正文'))).toEqual(license);
    const catalog = result(await apply.invoke('project.assets', {}));
    expect(catalog.intelligence.items.filter((item: any) => item.physical).map((item: any) => item.kind).sort())
      .toEqual(['music', 'ambience', 'sound-effect', 'voice', 'font', 'license'].sort());
    expect(catalog.intelligence.items.find((item: any) => item.kind === 'license').issues).toEqual([]);
    result(await apply.invoke('change.begin', { compositionMode: 'direct' }));
    result(await apply.invoke('scene.create', { operationId: 'audio-chapter', sceneId: 'audio_chapter', blocks: [
      ...['bgm', 'ambience', 'se', 'voice'].map(name => ({ kind: 'instruction', name, args: ['"雨 夜"'] })),
      { kind: 'text', value: '已经导入的声音。' },
    ] }));
    const working = result(await apply.invoke('project.assets', { view: 'working' }));
    for (const kind of ['music', 'ambience', 'sound-effect', 'voice']) {
      expect(working.intelligence.items.find((item: any) => item.kind === kind).references)
        .toContainEqual(expect.objectContaining({ sourcePath: 'content/scenario/audio_chapter.gal' }));
    }
    expect(await fs.stat(path.join(f.projectRoot, 'content/scenario/audio_chapter.gal')).catch(() => null)).toBeNull();
    result(await apply.invoke('change.rollback', {}));
  } finally { await stage.close(); await apply?.close(); }
}, 30_000);

it('rejects a corrupt media batch before registration and allows only real format/kind combinations', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.source, 'voice.wav'), wav);
  await fs.writeFile(path.join(f.source, 'broken.webm'), 'not a video');
  const session = await f.open('apply');
  try {
    const sourceId = result(await session.invoke('asset.sources', {})).roots[0].sourceId;
    expect(await session.invoke('asset.sources', { sourceId, path: 'broken.webm' })).toMatchObject({ ok: false,
      error: { code: 'ASSET_MEDIA_INVALID', details: { fileName: 'broken.webm' } } });
    const file = result(await session.invoke('asset.sources', { sourceId, path: 'voice.wav' })).file;
    const good = { itemId: crypto.randomUUID(), sourceId, sourcePath: 'voice.wav', sha256: file.sha256, kind: 'voice', fileName: 'voice.wav' };
    const operationId = crypto.randomUUID();
    const bad = { ...good, itemId: crypto.randomUUID(), sourcePath: 'broken.webm', fileName: 'broken.webm', kind: 'video', sha256: crypto.createHash('sha256').update('not a video').digest('hex') };
    expect(await session.invoke('asset.import.stage', { operationId, items: [good, bad] })).toMatchObject({ ok: false, error: { code: 'ASSET_MEDIA_INVALID' } });
    expect(await session.invoke('asset.import.inspect', { operationId })).toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_NOT_FOUND' } });
    const badLicenseBytes = Buffer.from('Copyright\u0000binary');
    await fs.writeFile(path.join(f.source, 'NOTICE.txt'), badLicenseBytes);
    const badLicense = { ...good, itemId: crypto.randomUUID(), sourcePath: 'NOTICE.txt', fileName: 'NOTICE.txt', kind: 'license', sha256: crypto.createHash('sha256').update(badLicenseBytes).digest('hex') };
    expect(await session.invoke('asset.import.stage', { operationId, items: [good, badLicense] }))
      .toMatchObject({ ok: false, error: { code: 'ASSET_MEDIA_INVALID' } });
    expect(await session.invoke('asset.import.inspect', { operationId })).toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_NOT_FOUND' } });
    expect(await session.invoke('asset.import.stage', { operationId, items: [{ ...good, fileName: 'voice.mp3' }] }))
      .toMatchObject({ ok: false, error: { code: 'ASSET_MEDIA_INVALID', details: { sourcePath: 'voice.wav', fileName: 'voice.mp3' } } });
    expect(await session.invoke('asset.import.stage', { operationId, items: [{ ...good, kind: 'background' }] }))
      .toMatchObject({ ok: false, error: { code: 'IMPORT_PLAN_BLOCKED', details: { plan: { issues: expect.arrayContaining(['IMPORT_FORMAT_UNSUPPORTED']) } } } });
    // Same-source target repair remains possible before sealing; no new operation.
    expect(result(await session.invoke('asset.import.stage', { operationId, items: [good] })).operation.status).toBe('READY');
    expect(await fs.stat(path.join(f.projectRoot, 'content/assets')).catch(() => null)).toBeNull();
  } finally { await session.close(); }
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

it('authors real catalog examples and the first character using only public read facts', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'asset-usage-author', version: '1.0.0' });
  await server.connect(serverTransport); await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return result(response.structuredContent);
  };
  try {
    const request = await requestFor(session, '夜港 @ evening.png');
    request.items.push({ ...request.items[0]!, itemId: crypto.randomUUID(), kind: 'portrait', fileName: 'rin_coat_smile.png' });
    const staged = await call('surdet_asset_import_stage', request);
    await call('surdet_asset_import_commit', { operationId: request.operationId, planFingerprint: staged.plan.planFingerprint });
    const source = await call('surdet_project_inspect', { view: 'project' });
    expect(source.characters).toEqual([]);
    expect(source.charactersFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await call('surdet_change_begin', { compositionMode: 'direct' });
    const before = await call('surdet_project_inspect', { view: 'working' });
    await call('surdet_character_ensure', { operationId: 'first-character', id: 'rin', name: '凛', expectedFingerprint: before.charactersFingerprint });
    const changed = await call('surdet_project_inspect', { view: 'working' });
    expect(changed.charactersFingerprint).not.toBe(before.charactersFingerprint);
    expect((await call('surdet_project_inspect', { view: 'project' })).charactersFingerprint).toBe(before.charactersFingerprint);
    const stale = await client.callTool({ name: 'surdet_character_ensure', arguments: { operationId: 'stale-character', id: 'rin', name: '新名字', expectedFingerprint: before.charactersFingerprint } });
    expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'OBJECT_REF_STALE' } });
    const assets = await call('surdet_project_assets', { view: 'working' });
    const background = assets.backgrounds[0];
    const portrait = assets.portraits[0];
    await call('surdet_timeline_create', { operationId: 'arrival', timelineId: 'arrival', definition: {
      version: 1, id: 'arrival', durationMs: 0, tracks: [background.usage.timeline, portrait.usage.timeline],
    } });
    await call('surdet_scene_create', { operationId: 'shown', sceneId: 'shown', blocks: [
      background.usage.scene, portrait.usage.scene,
      { kind: 'instruction', name: 'timeline', args: ['arrival'], modifiers: { blocking: '' } },
      { kind: 'text', speaker: '凛', value: '在夜港等你。' }, { kind: 'instruction', name: 'clear', args: ['done'] },
    ] });
    expect((await call('surdet_project_validate')).ok).toBe(true);
    const trace = await call('surdet_runtime_run_from', { sceneId: 'shown', choices: [] });
    expect(trace.status).toBe('passed');
    const serialized = await fs.readFile(path.join(f.projectRoot, 'game.config.json'), 'utf8');
    expect(JSON.parse(serialized).characters).toBeUndefined();
    const scene = await call('surdet_object_inspect', { view: 'working', objectRef: 'scene:shown', fragment: {} });
    expect(JSON.stringify(scene)).toContain('夜港 @ evening');
    await call('surdet_change_diff');
    const premature = await client.callTool({ name: 'surdet_change_commit', arguments: {} });
    expect(premature.structuredContent).toMatchObject({ ok: false, error: { code: 'SIMULATION_REQUIRED' } });
    await call('surdet_project_simulate', { sceneId: 'shown' });
    await call('surdet_change_commit');
    expect(JSON.parse(await fs.readFile(path.join(f.projectRoot, 'game.config.json'), 'utf8')).characters.rin.name).toBe('凛');
  } finally { await client.close(); await server.close(); await session.close(); }
});

it.each(['image', 'audio', 'license'])('recovers the same real stdio %s import after the server exits after writing its receipt', async (media) => {
  const f = await fixture();
  const staging = await f.open('stage');
  let request = await requestFor(staging);
  if (media === 'audio') {
    await fs.writeFile(path.join(f.source, '夜声.wav'), wav);
    const item = request.items[0]!;
    const file = result(await staging.invoke('asset.sources', { sourceId: item.sourceId, path: '夜声.wav' })).file;
    request = { ...request, items: [{ ...item, sourcePath: file.path, sha256: file.sha256, kind: 'ambience', fileName: '夜声.wav' }] };
  }
  const license = Buffer.from('\uFEFFCopyright fixture author\r\n许可原文保留。\r\n');
  if (media === 'license') {
    await fs.writeFile(path.join(f.source, 'LICENSE-字体'), license);
    const item = request.items[0]!;
    const file = result(await staging.invoke('asset.sources', { sourceId: item.sourceId, path: 'LICENSE-字体' })).file;
    request = { ...request, items: [{ ...item, sourcePath: file.path, sha256: file.sha256, kind: 'license', fileName: file.path }] };
  }
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
  const directory = media === 'image' ? 'bg' : media === 'audio' ? 'ambience' : 'licenses';
  const fileName = request.items[0]!.fileName;
  expect(await fs.readdir(path.join(f.projectRoot, 'content/assets', directory))).toEqual([fileName]);
  expect(await fs.readFile(path.join(f.projectRoot, 'content/assets', directory, fileName))).toEqual(media === 'image' ? png : media === 'audio' ? wav : license);
  await resumed.close();
}, 45_000);

it('refuses Agent recovery of a failed Editor undo while preserving explicit Editor recovery', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  try {
    const request = await requestFor(session);
    const ready = result(await session.invoke('asset.import.stage', request));
    const commit = { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint };
    const committed = result(await session.invoke('asset.import.commit', commit));
    const paths = await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') });
    const store = new AssetImportRecordStore(paths);
    const lease = await ProjectMutationLeaseContext.open(f.projectRoot);
    let obstruction: string | undefined;
    const authority = new ProjectAssetImportAuthority(paths, store, {
      textHasher: { sha256: async text => crypto.createHash('sha256').update(text).digest('hex') },
      assertLeaseHeld: () => lease.assertHeld(),
      faultInjector: async point => {
        if (point !== 'after_undo_rename_intent_before_rename') return;
        const publication = await store.readPublication(request.operationId);
        expect(publication).not.toBeNull();
        obstruction = path.join(f.projectRoot, publication!.files[0]!.undoRelativePath);
        // A real invalid filesystem node makes undo enter RECOVERY_REQUIRED.
        // The fault hook itself succeeds, so this is not a simulated journal rewrite.
        await fs.mkdir(obstruction, { recursive: true });
      },
    });
    await expect(lease.run(() => authority.undo(request.operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    }))).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(obstruction).toBeDefined();
    await fs.rmdir(obstruction!); // Remove only the obstruction created above.
    const before = result(await session.invoke('asset.import.inspect', { operationId: request.operationId }));
    expect(before.operation.status).toBe('RECOVERY_REQUIRED');
    expect(before.undoReceipt).toBeNull();
    const publicationBefore = await store.readPublication(request.operationId);
    expect(publicationBefore!.files[0]!.state).toBe('UNDO_RENAME_INTENT');
    expect(await session.invoke('asset.import.recover', commit)).toMatchObject({ ok: false,
      error: { code: 'IMPORT_OPERATION_CONFLICT' } });
    expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(png);
    expect(await store.readPublication(request.operationId)).toEqual(publicationBefore);
    const after = result(await session.invoke('asset.import.inspect', { operationId: request.operationId }));
    expect(after.operation.status).toBe('RECOVERY_REQUIRED');
    expect(after.receipt.receiptId).toBe(committed.receipt.receiptId);
    expect(after.undoReceipt).toBeNull();
    // This restriction belongs to the Agent adapter, not the existing Editor API.
    const editorRecovered = await lease.run(() => authority.recover(request.operationId, { action: 'resume' }));
    expect(editorRecovered.detail.operation.status).toBe('UNDONE');
  } finally { await session.close(); }
});

it('rechecks live runtime keys when resuming an import interrupted before publication', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  try {
    const request = await requestFor(session);
    const ready = result(await session.invoke('asset.import.stage', request));
    const commit = { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint };
    const paths = await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') });
    const store = new AssetImportRecordStore(paths);
    const lease = await ProjectMutationLeaseContext.open(f.projectRoot);
    const authority = new ProjectAssetImportAuthority(paths, store, {
      textHasher: { sha256: async text => crypto.createHash('sha256').update(text).digest('hex') },
      assertLeaseHeld: () => lease.assertHeld(),
      faultInjector: point => {
        if (point === 'after_prepare_intent_before_file') throw new AssetImportInjectedTermination(point);
      },
    });
    await expect(lease.run(() => authority.commit(request.operationId, commit)))
      .rejects.toBeInstanceOf(AssetImportInjectedTermination);
    expect((await store.readOperation(request.operationId)).journal.status).toBe('PUBLISHING');
    expect((await store.readPublication(request.operationId))!.files[0]!.state).toBe('PREPARE_INTENT');
    const competingPath = path.join(f.projectRoot, 'content/assets/bg/old/night.png');
    await fs.mkdir(path.dirname(competingPath), { recursive: true });
    await fs.writeFile(competingPath, png);
    expect(await session.invoke('asset.import.recover', commit)).toMatchObject({ ok: false,
      error: { code: 'IMPORT_PLAN_STALE' } });
    expect(await fs.readFile(competingPath)).toEqual(png);
    expect(await fs.stat(path.join(f.projectRoot, 'content/assets/bg/night.png')).catch(() => null)).toBeNull();
    const blocked = result(await session.invoke('asset.import.inspect', { operationId: request.operationId }));
    expect(blocked.receipt).toBeNull();
    expect(blocked.plan.planId).toBe(ready.plan.planId);
    expect(blocked.operation.status).toBe('PUBLISHING');
    await fs.unlink(competingPath); // Remove only this test's competing image.
    const recovered = result(await session.invoke('asset.import.recover', commit));
    expect(recovered.operation).toMatchObject({ operationId: request.operationId, status: 'COMMITTED' });
    expect(recovered.plan.planId).toBe(ready.plan.planId);
    expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(png);
  } finally { await session.close(); }
});

async function interruptedUpload() {
  const f = await fixture();
  const session = await f.open('apply');
  const request = await requestFor(session);
  const createIntent = AssetImportRecordStore.prototype.createUploadIntent;
  const crash = vi.spyOn(AssetImportRecordStore.prototype, 'createUploadIntent').mockImplementationOnce(async function (this: AssetImportRecordStore, intent) {
    await createIntent.call(this, intent);
    await fs.writeFile(this.stagedItemTemporaryFile(intent.operationId, intent.itemId, intent.nonce), 'partial upload');
    throw new Error('process stopped after durable upload intent');
  });
  try { expect(await session.invoke('asset.import.stage', request)).toMatchObject({ ok: false }); }
  finally { crash.mockRestore(); await session.close(); }
  const store = new AssetImportRecordStore(await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') }));
  return { ...f, request, store, resumed: await f.open('apply') };
}

it('recovers an interrupted unpublished upload through MCP using its manifest and permits a fresh import', async () => {
  // This scenario keeps the human workspace connected; grace expiry is tested
  // separately. Slow filesystem work must not silently change that premise.
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const f = await interruptedUpload();
  const failed: any = await f.resumed.invoke('asset.import.inspect', { operationId: f.request.operationId });
  expect(failed).toMatchObject({ ok: false, error: { code: 'IMPORT_RECOVERY_REQUIRED', details: {
    manifestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), recoveryAction: 'discard-unpublished',
  } } });
  expect((await f.resumed.describe()).recoveryDisposition).toBe('MANUAL_RECOVERY_REQUIRED');
  const recovery = { operationId: f.request.operationId, manifestFingerprint: failed.error.details.manifestFingerprint };
  expect(await f.resumed.invoke('asset.import.recover', { ...recovery, manifestFingerprint: '0'.repeat(64) }))
    .toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
  expect(await f.store.listUploadIntents(recovery.operationId)).toHaveLength(1);
  const stage = await f.open('stage');
  expect(await stage.invoke('asset.import.recover', recovery)).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
  await stage.close();
  const workspace = new HumanWorkspaceStore({ dataRoot: path.join(f.root, 'data') });
  const identity = { workspaceSessionId: crypto.randomUUID(), browserSessionId: 'upload-recovery', workspaceGeneration: 1 };
  await workspace.heartbeat(f.projectRoot, { ...identity, availability: 'dirty', dirtyScopes: ['scene'] });
  expect(await f.resumed.invoke('asset.import.recover', recovery)).toMatchObject({ ok: false, error: { code: 'HUMAN_WORKSPACE_DIRTY' } });
  await workspace.heartbeat(f.projectRoot, { ...identity, workspaceGeneration: 2, availability: 'clean' });
  const server = createAgentPortServer(f.resumed);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'upload-recovery', version: '1' });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const call = () => client.callTool({ name: 'surdet_asset_import_recover', arguments: recovery });
    for (const invalid of [{ operationId: recovery.operationId }, { ...recovery, planFingerprint: 'a'.repeat(64) }]) {
      expect((await client.callTool({ name: 'surdet_asset_import_recover', arguments: invalid })).isError).toBe(true);
    }
    const writeJournal = AssetImportRecordStore.prototype.writeJournal;
    const stopped = vi.spyOn(AssetImportRecordStore.prototype, 'writeJournal').mockImplementationOnce(async function (this: AssetImportRecordStore, previous, next) {
      if (next.status === 'ROLLING_BACK') throw new Error('stopped after upload cleanup');
      return writeJournal.call(this, previous, next);
    });
    try { expect((await call()).structuredContent).toMatchObject({ ok: false, error: { code: 'IMPORT_IO_FAILED' } }); }
    finally { stopped.mockRestore(); }
    const recovered = result((await call()).structuredContent);
    expect(recovered.operation.status).toBe('ROLLED_BACK');
    expect(recovered.receipt).toBeNull();
    expect(result((await call()).structuredContent).operation).toEqual(recovered.operation);
    expect(await f.store.listUploadIntents(recovery.operationId)).toEqual([]);
    expect(await fs.readdir(path.dirname(f.store.stagedItemBinaryFile(recovery.operationId, f.request.items[0]!.itemId)))).toEqual([]);
    expect((await f.resumed.describe()).manualRecoveryRequired).toBe(false);
    expect(await fs.readFile(path.join(f.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe('@scene start\n凛：开始。\n@end\n');
    const next = await requestFor(f.resumed);
    const ready = result(await f.resumed.invoke('asset.import.stage', next));
    expect(ready.operation.status).toBe('READY');
    expect(await f.resumed.invoke('asset.import.recover', { operationId: next.operationId, manifestFingerprint: ready.manifest.manifestFingerprint }))
      .toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
    const published = result(await f.resumed.invoke('asset.import.commit', { operationId: next.operationId, planFingerprint: ready.plan.planFingerprint }));
    expect(published.operation.status).toBe('COMMITTED');
    expect(await f.resumed.invoke('asset.import.recover', { operationId: next.operationId, manifestFingerprint: ready.manifest.manifestFingerprint }))
      .toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
    expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(png);
  } finally { await client.close(); await server.close(); await f.resumed.close(); }
}, 30_000);

it('preserves unknown staging files and the recovery barrier when discarding an interrupted upload', async () => {
  const f = await interruptedUpload();
  expect(await f.resumed.invoke('asset.import.inspect', { operationId: f.request.operationId }))
    .toMatchObject({ ok: false, error: { code: 'IMPORT_RECOVERY_REQUIRED' } });
  const manifest = await f.store.readOperationManifest(f.request.operationId);
  const unknown = path.join(path.dirname(f.store.stagedItemBinaryFile(f.request.operationId, f.request.items[0]!.itemId)), 'unowned.bin');
  await fs.writeFile(unknown, 'do not delete');
  try {
    expect(await f.resumed.invoke('asset.import.recover', { operationId: f.request.operationId, manifestFingerprint: manifest.manifestFingerprint }))
      .toMatchObject({ ok: false, error: { code: 'IMPORT_RECOVERY_REQUIRED' } });
    expect(await fs.readFile(unknown, 'utf8')).toBe('do not delete');
    expect((await f.resumed.describe()).manualRecoveryRequired).toBe(true);
  } finally { await f.resumed.close(); }
}, 30_000);

it('never treats a previously sealed import with a missing plan as an unpublished upload', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  try {
    const request = await requestFor(session);
    const ready = result(await session.invoke('asset.import.stage', request));
    const store = new AssetImportRecordStore(await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') }));
    await fs.unlink(path.join(path.dirname(path.dirname(store.stagedItemBinaryFile(request.operationId, request.items[0]!.itemId))), 'plan.json'));
    expect(await session.invoke('asset.import.recover', { operationId: request.operationId, manifestFingerprint: ready.manifest.manifestFingerprint }))
      .toMatchObject({ ok: false, error: { code: 'IMPORT_OPERATION_CONFLICT' } });
    expect(await fs.readFile(store.stagedItemBinaryFile(request.operationId, request.items[0]!.itemId))).toEqual(png);
    expect((await store.readOperation(request.operationId)).journal.status).toBe('READY');
  } finally { await session.close(); }
}, 30_000);

it('rechecks runtime keys after files are verified but before a receipt exists, without rejecting its own target', async () => {
  const f = await fixture();
  const session = await f.open('apply');
  try {
    const request = await requestFor(session);
    const ready = result(await session.invoke('asset.import.stage', request));
    const commit = { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint };
    const paths = await openAssetImportAuthorityPaths({ projectRoot: f.projectRoot, dataRoot: path.join(f.root, 'asset-data') });
    const store = new AssetImportRecordStore(paths);
    const lease = await ProjectMutationLeaseContext.open(f.projectRoot);
    const authority = new ProjectAssetImportAuthority(paths, store, {
      textHasher: { sha256: async text => crypto.createHash('sha256').update(text).digest('hex') },
      assertLeaseHeld: () => lease.assertHeld(),
    });
    const receiptPath = path.join(paths.projectNamespace, 'operations', request.operationId, 'receipt.json');
    const writeReceipt = store.writeReceipt.bind(store);
    vi.spyOn(store, 'writeReceipt').mockImplementationOnce(async receipt => {
      await fs.mkdir(receiptPath); // A real obstruction at the receipt write boundary.
      return writeReceipt(receipt);
    });
    await expect(lease.run(() => authority.commit(request.operationId, commit)))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await fs.rmdir(receiptPath); // Remove only this test's obstruction.
    const publication = await store.readPublication(request.operationId);
    expect(publication!.files.map(file => file.state)).toEqual(['VERIFIED']);
    expect(await store.readReceipt(request.operationId)).toBeNull();
    const competingPath = path.join(f.projectRoot, 'content/assets/bg/night.webp');
    await fs.writeFile(competingPath, png);
    expect(await session.invoke('asset.import.recover', commit)).toMatchObject({ ok: false,
      error: { code: 'IMPORT_PLAN_STALE' } });
    expect(await store.readPublication(request.operationId)).toEqual(publication);
    expect(await store.readReceipt(request.operationId)).toBeNull();
    expect(await fs.readFile(competingPath)).toEqual(png);
    expect(await fs.readFile(path.join(f.projectRoot, 'content/assets/bg/night.png'))).toEqual(png);
    await fs.unlink(competingPath);
    const recovered = result(await session.invoke('asset.import.recover', commit));
    expect(recovered.operation.status).toBe('COMMITTED');
    expect(recovered.plan.planId).toBe(ready.plan.planId);
    expect(recovered.receipt.files[0].fileIdentity.inode).toBe(publication!.files[0]!.finalIdentity!.inode);
  } finally { await session.close(); }
});


it('replacement public MCP prepares permitted source bytes and uses the original apply/undo with no reference rewrite', async () => {
  const f = await fixture();
  const targetPath = 'content/assets/bgm/wind.wav';
  await fs.mkdir(path.dirname(path.join(f.projectRoot, targetPath)), { recursive: true });
  const before = Buffer.from(wav), after = Buffer.from(wav); after.writeInt16LE(1500, 44);
  await fs.writeFile(path.join(f.projectRoot, targetPath), before);
  await fs.writeFile(path.join(f.source, 'new-wind.wav'), after);
  const scene = '@scene start\n@bgm wind\n保持原键。\n@end\n';
  await fs.writeFile(path.join(f.projectRoot, 'content/scenario/start.gal'), scene);
  const stage = await f.open('stage'), observe = await f.open('observe');
  const sourceId = result(await stage.invoke('asset.sources', {})).roots[0].sourceId;
  const sha256 = crypto.createHash('sha256').update(after).digest('hex');
  const request = { operationId: crypto.randomUUID(), targetPath, source: { sourceId, path: 'new-wind.wav', sha256 } };
  try {
    expect(await observe.invoke('asset.relocation.replace', request)).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    expect(await stage.invoke('asset.relocation.replace', { ...request, source: { ...request.source, sourceId: 'ungranted' } })).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_FORBIDDEN' } });
    expect(await stage.invoke('asset.relocation.replace', { ...request, source: { ...request.source, sha256: '0'.repeat(64) } })).toMatchObject({ ok: false, error: { code: 'ASSET_SOURCE_CHANGED' } });
    const ready = result(await stage.invoke('asset.relocation.replace', request));
    expect(ready.plan.replacement.afterSha256).toBe(sha256);
    expect(await fs.readFile(path.join(f.projectRoot, targetPath))).toEqual(before);
    expect(await stage.invoke('asset.relocation.commit', { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint })).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
    await stage.close();
    const apply = await f.open('apply');
    const server = createAgentPortServer(apply), [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'replacement-regression', version: '1' });
    await server.connect(st); await client.connect(ct);
    try {
      expect((await client.listTools()).tools.some(tool => tool.name === 'surdet_asset_relocation_replace')).toBe(true);
      const committed = result((await client.callTool({ name: 'surdet_asset_relocation_commit', arguments: { operationId: request.operationId, planFingerprint: ready.plan.planFingerprint } })).structuredContent);
      expect(committed.operation.status).toBe('COMMITTED'); expect(committed.coordination.status).toBe('written');
      expect(await fs.readFile(path.join(f.projectRoot, targetPath))).toEqual(after);
      expect(await fs.readFile(path.join(f.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe(scene);
      const undone = result((await client.callTool({ name: 'surdet_asset_relocation_undo', arguments: { operationId: request.operationId,
        receiptId: committed.receipt.receiptId, receiptFingerprint: committed.receipt.receiptFingerprint } })).structuredContent);
      expect(undone.operation.status).toBe('UNDONE'); expect(await fs.readFile(path.join(f.projectRoot, targetPath))).toEqual(before);
    } finally { await client.close(); await server.close(); await apply.close(); }
  } finally { await stage.close(); await observe.close(); }
}, 30_000);
