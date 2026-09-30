import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  nativeCapabilityToMcpTool,
  type AuthoringCapabilityId,
} from '@surdet/authoring';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { createAgentPortServer } from '../src/agent-port/server.js';

const temporaryRoots: string[] = [];

interface GalleryFixture {
  root: string;
  data: string;
  galleryText: string;
  sceneText: string;
}

interface ConnectedSession {
  session: AgentPortSession;
  client: Client;
  server: ReturnType<typeof createAgentPortServer>;
}

function makeProject(name: string): GalleryFixture {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-gallery-${name}-`));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-gallery-data-'));
  temporaryRoots.push(root, data);

  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'assets', 'bg'), { recursive: true });

  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({
    entryScene: 'start',
    variables: {},
    characters: { '凛': { name: '凛' } },
    customInstructions: ['unlock_cg', 'unlock_music', 'unlock_text'],
  }), 'utf8');
  const sceneText = '@scene start\n@label memory\n@unlock_cg gallery_new\n@unlock_music rain\n@unlock_text memory\n凛：开始。\n@end\n';
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), sceneText, 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'assets', 'bg', 'gallery_new.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
  const galleryText = JSON.stringify({
    title: '原始根字段',
    customRoot: { keep: true },
    cgs: [],
    music: [{ id: 'rain', name: '雨声' }],
    texts: [{ id: 'memory', name: '回想', scene: 'start', label: 'memory' }],
  }) + '\n';
  fs.writeFileSync(path.join(root, 'content', 'config', 'gallery.json'), galleryText, 'utf8');
  return { root, data, galleryText, sceneText };
}

function mcpTool(id: AuthoringCapabilityId | 'session.describe'): string {
  if (id === 'session.describe') return 'surdet_session_describe';
  return nativeCapabilityToMcpTool(id);
}

function textContent(result: { content?: readonly unknown[] }): string {
  const item = result.content?.find((candidate): candidate is { type: 'text'; text: string } => (
    typeof candidate === 'object'
    && candidate !== null
    && (candidate as { type?: unknown }).type === 'text'
    && typeof (candidate as { text?: unknown }).text === 'string'
  ));
  if (item === undefined) throw new Error('MCP result did not contain a text content block');
  return item.text;
}

function envelope(result: { content?: readonly unknown[] }): Record<string, any> {
  const text = textContent(result);
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`MCP envelope parse failed: ${text}`);
  }
}

async function connected(fixture: GalleryFixture, policy: 'observe' | 'stage' | 'apply', resumeChangeId?: string): Promise<ConnectedSession> {
  process.env['SURDET_AGENT_DATA_DIR'] = fixture.data;
  const session = await openAgentPortSession({
    projectRoot: fixture.root,
    policy,
    ...(resumeChangeId === undefined ? {} : { resumeChangeId }),
  });
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agent-gallery-authoring-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { session, client, server };
}

async function closeConnected(connectedSession: ConnectedSession): Promise<void> {
  await connectedSession.client.close();
  await connectedSession.server.close();
  await connectedSession.session.close();
}

async function call(
  client: Client,
  capability: AuthoringCapabilityId | 'session.describe',
  input: Record<string, unknown> = {},
): Promise<{ raw: any; body: Record<string, any> }> {
  const raw = await client.callTool({ name: mcpTool(capability), arguments: input });
  const body = envelope(raw);
  expect(textContent(raw)).toBe(JSON.stringify(raw.structuredContent));
  return { raw, body };
}

describe('Agent Port gallery authoring', () => {
  it('exposes a strict direct-only policy patch and separate project/working reads over MCP', async () => {
    const fixture = makeProject('policy');
    const first = await connected(fixture, 'stage');
    try {
      const initial = (await call(first.client, 'project.gallery')).body.result.unlockPolicy;
      expect(initial).toMatchObject({ value: null, effective: { cgs: 'save', music: 'save' } });
      expect((await call(first.client, 'change.begin', { compositionMode: 'direct' })).body.ok).toBe(true);
      const result = await call(first.client, 'gallery.policy.patch', { operationId: 'policy', expectedFingerprint: initial.fingerprint, patch: { cgs: 'profile', music: 'profile' } });
      expect(result.body.ok, JSON.stringify(result.body)).toBe(true);
      expect((await call(first.client, 'project.gallery', { view: 'working' })).body.result.unlockPolicy.effective).toEqual({ cgs: 'profile', music: 'profile', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' });
      expect((await call(first.client, 'project.gallery', { view: 'project' })).body.result.unlockPolicy.value).toBeNull();
      const stale = await call(first.client, 'gallery.policy.patch', { operationId: 'stale', expectedFingerprint: initial.fingerprint, patch: { cgs: null } });
      expect(stale.body.error.code).toBe('OBJECT_REF_STALE');
      expect(fs.readFileSync(path.join(fixture.root, 'content/config/gallery.json'), 'utf8')).toBe(fixture.galleryText);
      expect((await call(first.client, 'change.diff')).body.ok).toBe(true);
    } finally { await closeConnected(first); }
    const candidate = await connected(fixture, 'stage');
    try {
      await call(candidate.client, 'change.begin');
      const policy = (await call(candidate.client, 'project.gallery')).body.result.unlockPolicy;
      const result = await call(candidate.client, 'gallery.policy.patch', { operationId: 'blocked', expectedFingerprint: policy.fingerprint, patch: { cgs: 'profile' } });
      expect(result.body.error.code).toBe('UNSUPPORTED_OPERATION');
    } finally { await closeConnected(candidate); }
  });
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('projects active working gallery over MCP, keeps stage isolated, and resumes it separately from project facts', async () => {
    const fixture = makeProject('stage');
    const beforeGallery = fs.readFileSync(path.join(fixture.root, 'content', 'config', 'gallery.json'), 'utf8');
    const beforeScene = fs.readFileSync(path.join(fixture.root, 'content', 'scenario', 'start.gal'), 'utf8');
    const first = await connected(fixture, 'stage');
    let changeId: string;
    try {
      const projectGallery = await call(first.client, 'project.gallery');
      expect(projectGallery.raw.isError).not.toBe(true);
      expect(projectGallery.body.ok).toBe(true);
      expect(projectGallery.body.result.view).toBe('project');
      expect(projectGallery.body.result.cgs).toEqual([]);

      const begun = await call(first.client, 'change.begin');
      expect(begun.body.ok).toBe(true);
      changeId = first.session.activeChangeId!;
      expect(changeId).toBeTruthy();

      const created = await call(first.client, 'gallery.cg.create', {
        operationId: 'op-stage-gallery-create',
        id: 'gallery_new',
        name: '新增 CG',
      });
      expect(created.raw.isError).not.toBe(true);
      expect(created.body.result.entry).toEqual({ id: 'gallery_new', name: '新增 CG' });

      const invalid = await call(first.client, 'gallery.cg.patch', {
        operationId: 'op-stage-gallery-invalid',
        id: 'gallery_new',
        expectedFingerprint: created.body.result.fingerprint,
        patch: { name: '' },
      });
      expect(invalid.raw.isError).toBe(true);
      expect(invalid.body.ok).toBe(false);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
      expect((invalid.raw.structuredContent as any).error.code).toBe('VALIDATION_FAILED');

      const workingGallery = await call(first.client, 'project.gallery');
      expect(workingGallery.body.result.view).toBe('working');
      expect(workingGallery.body.result.cgs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gallery_new', name: '新增 CG', objectRef: 'gallery:cgs:gallery_new' }),
      ]));
      const described = await call(first.client, 'session.describe');
      expect(described.body.result.activeChange.workingRevision).toBe(1);

      expect(fs.readFileSync(path.join(fixture.root, 'content', 'config', 'gallery.json'), 'utf8')).toBe(beforeGallery);
      expect(fs.readFileSync(path.join(fixture.root, 'content', 'scenario', 'start.gal'), 'utf8')).toBe(beforeScene);
    } finally {
      await closeConnected(first);
    }

    const ordinary = await connected(fixture, 'observe');
    try {
      const projectFacts = await call(ordinary.client, 'project.gallery');
      expect(projectFacts.body.result.view).toBe('project');
      expect(projectFacts.body.result.cgs).toEqual([]);
    } finally {
      await closeConnected(ordinary);
    }

    const resumed = await connected(fixture, 'stage', changeId!);
    try {
      const resumedGallery = await call(resumed.client, 'project.gallery');
      expect(resumedGallery.body.result.view).toBe('working');
      expect(resumedGallery.body.result.cgs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gallery_new', name: '新增 CG' }),
      ]));
      expect((await call(resumed.client, 'session.describe')).body.result.resumed).toBe(true);
      expect(fs.readFileSync(path.join(fixture.root, 'content', 'config', 'gallery.json'), 'utf8')).toBe(beforeGallery);
      expect(fs.readFileSync(path.join(fixture.root, 'content', 'scenario', 'start.gal'), 'utf8')).toBe(beforeScene);
      expect((await call(resumed.client, 'change.rollback')).body.result.status).toBe('ROLLED_BACK');
    } finally {
      await closeConnected(resumed);
    }
  }, 30_000);

  it('validates the unlock_cg reference, simulates, runs, commits to isolated disk, and sees the committed gallery after reopen', async () => {
    const fixture = makeProject('apply');
    const connectedSession = await connected(fixture, 'apply');
    try {
      expect((await call(connectedSession.client, 'project.gallery')).body.result.view).toBe('project');
      expect((await call(connectedSession.client, 'change.begin')).body.ok).toBe(true);
      const missingCg = await call(connectedSession.client, 'project.validate');
      expect(missingCg.body.result.ok).toBe(false);
      expect(missingCg.body.result.issues).toContainEqual(expect.objectContaining({ code: 'G006', severity: 'error' }));

      const created = await call(connectedSession.client, 'gallery.cg.create', {
        operationId: 'op-apply-gallery-create',
        id: 'gallery_new',
        name: '新增 CG',
      });
      expect(created.body.result.entry).toEqual({ id: 'gallery_new', name: '新增 CG' });
      const patched = await call(connectedSession.client, 'gallery.cg.patch', {
        operationId: 'op-apply-gallery-name', id: 'gallery_new', expectedFingerprint: created.body.result.fingerprint,
        patch: { name: '定稿 CG' },
      });
      expect(patched.body.result.entry).toEqual({ id: 'gallery_new', name: '定稿 CG' });
      const policy = (await call(connectedSession.client, 'project.gallery')).body.result.unlockPolicy;
      expect((await call(connectedSession.client, 'gallery.policy.patch', {
        operationId: 'op-policy', expectedFingerprint: policy.fingerprint, patch: { music: 'profile' },
      })).body.ok).toBe(true);

      const validated = await call(connectedSession.client, 'project.validate');
      expect(validated.body.ok).toBe(true);
      expect(validated.body.result.view).toBe('working');
      expect(validated.body.result.ok, JSON.stringify(validated.body.result.issues)).toBe(true);
      expect(validated.body.result.issues.filter((issue: any) => issue.severity === 'error')).toEqual([]);

      const simulated = await call(connectedSession.client, 'project.simulate', { sceneId: 'start', seed: 0 });
      expect(simulated.body.ok).toBe(true);
      expect(simulated.body.result.status).toBe('passed');

      const runtime = await call(connectedSession.client, 'runtime.run-from', { sceneId: 'start', choices: [], seed: 0 });
      expect(runtime.body.ok).toBe(true);
      expect(runtime.body.result.status).toBe('passed');

      const diff = await call(connectedSession.client, 'change.diff');
      expect(diff.body.ok).toBe(true);
      expect(diff.body.result.view).toBe('working');

      const capsule = await connectedSession.client.callTool({
        name: 'surdet_delivery_capsule',
        arguments: { label: 'gallery apply test' },
      });
      expect(capsule.isError).not.toBe(true);
      const capsuleBody = envelope(capsule);
      expect(capsuleBody.ok).toBe(true);
      expect(capsuleBody.result.composition).toMatchObject({ eligibility: 'unavailable', reasons: [{ code: 'DIRECT_CHANGE' }] });
      expect(capsuleBody.result.composition.manifest).toBeUndefined();

      const committed = await call(connectedSession.client, 'change.commit');
      expect(committed.body.ok).toBe(true);
      expect(committed.body.result.status).toBe('COMMITTED');
    } finally {
      await closeConnected(connectedSession);
    }

    const committedGalleryText = fs.readFileSync(path.join(fixture.root, 'content', 'config', 'gallery.json'), 'utf8');
    const committedGallery = JSON.parse(committedGalleryText) as Record<string, any>;
    expect(committedGallery.title).toBe('原始根字段');
    expect(committedGallery.customRoot).toEqual({ keep: true });
    expect(committedGallery.music).toEqual([{ id: 'rain', name: '雨声' }]);
    expect(committedGallery.texts).toEqual([{ id: 'memory', name: '回想', scene: 'start', label: 'memory' }]);
    expect(committedGallery.cgs).toEqual([{ id: 'gallery_new', name: '定稿 CG' }]);
    expect(committedGallery.unlockPolicy).toEqual({ music: 'profile' });
    expect(fs.readFileSync(path.join(fixture.root, 'content', 'scenario', 'start.gal'), 'utf8')).toBe(fixture.sceneText);

    const reopened = await connected(fixture, 'observe');
    try {
      const projectFacts = await call(reopened.client, 'project.gallery');
      expect(projectFacts.body.result.view).toBe('project');
      expect(projectFacts.body.result.unlockPolicy.effective).toEqual({ cgs: 'save', music: 'profile', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' });
      expect(projectFacts.body.result.cgs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gallery_new', name: '定稿 CG', objectRef: 'gallery:cgs:gallery_new' }),
      ]));
    } finally {
      await closeConnected(reopened);
    }
  }, 30_000);
});
