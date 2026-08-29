import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProjectSnapshot } from '@surdet/authoring';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { ChangeRecordProjectStorage } from '../src/authoring/working-project-storage.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-capsule-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

async function openSession(name: string, policy: 'stage' | 'apply' = 'stage', resumeChangeId?: string, projectRoot?: string, sharedDataDirectory?: string): Promise<AgentPortSession> {
  const root = projectRoot ?? makeProject(name);
  const data = sharedDataDirectory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-capsule-data-'));
  if (sharedDataDirectory === undefined) temporaryRoots.push(data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy, ...(resumeChangeId === undefined ? {} : { resumeChangeId }) });
}

async function stageEvidence(session: AgentPortSession): Promise<void> {
  expect((await session.invoke('project.validate', {})).ok).toBe(true);
  expect((await session.invoke('project.simulate', {})).ok).toBe(true);
  expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
  expect((await session.invoke('change.diff', {})).ok).toBe(true);
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('Surdet Agent Port invocation ledger and delivery capsule', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('retains failed and repaired invocations without raw input', async () => {
    const session = await openSession('failure-retention');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const failed = await session.invoke('scene.patch', {
      operationId: 'op-stale',
      sceneId: 'start',
      patch: { kind: 'removeObject', target: 'scene:start/text:0@missing', expectedFingerprint: '0'.repeat(64) },
    });
    expect(failed.ok).toBe(false);
    expect((await session.invoke('scene.create', { operationId: 'op-repair', sceneId: 'repaired' })).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    const invocations = await opened!.store.readInvocations(changeId);
    expect(invocations).toHaveLength(3);
    expect(invocations.some((item) => item.ok === false)).toBe(true);
    for (const item of invocations) {
      expect(item.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(item).not.toHaveProperty('input');
      expect(item).not.toHaveProperty('text');
      expect(item).not.toHaveProperty('prompt');
    }
    await session.close();
  });

  it('seals an OPEN stage capsule without mutating project files', async () => {
    const session = await openSession('stage-capsule');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    expect((await session.invoke('scene.create', { operationId: 'op-stage', sceneId: 'staged' })).ok).toBe(true);
    const before = fs.readFileSync(path.join(session.projectRoot, 'game.config.json'));
    await stageEvidence(session);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.changeStatus).toBe('OPEN');
    expect(capsule.projectMutation).toEqual(expect.objectContaining({ occurred: false, expectedByPolicy: false }));
    expect(capsule.projectMutation.beforeRevision).toBe(capsule.projectMutation.afterRevision);
    expect(fs.readFileSync(path.join(session.projectRoot, 'game.config.json'))).toEqual(before);
    expect(capsule.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', code: 'SPEAKER_UNRESOLVED' }),
    ]));
    expect(capsule.manualReviewRequired).toContain('VALIDATION_WARNINGS');
    await session.close();
  });

  it('seals a committed apply capsule after explicit resume', async () => {
    const sharedDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-capsule-shared-data-'));
    temporaryRoots.push(sharedDataDirectory);
    const stage = await openSession('apply-capsule-stage', 'stage', undefined, undefined, sharedDataDirectory);
    expect((await stage.invoke('change.begin', {})).ok).toBe(true);
    expect((await stage.invoke('scene.create', { operationId: 'op-apply', sceneId: 'applied' })).ok).toBe(true);
    await stageEvidence(stage);
    const changeId = stage.activeChangeId!;
    await stage.close();
    const apply = await openSession('apply-capsule-apply', 'apply', changeId, stage.projectRoot, sharedDataDirectory);
    expect(apply.projectIdentity).toBe(stage.projectIdentity);
    const committed = await apply.invoke('change.commit', {});
    expect(committed.ok).toBe(true);
    const capsule = await generateDeliveryCapsule(apply);
    expect(capsule.changeStatus).toBe('COMMITTED');
    expect(capsule.projectMutation.occurred).toBe(true);
    expect(capsule.projectMutation.expectedByPolicy).toBe(true);
    expect(capsule.projectMutation.beforeRevision).not.toBe(capsule.projectMutation.afterRevision);
    await apply.close();
  });

  it('marks all prior evidence stale after a later mutation', async () => {
    const session = await openSession('freshness');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    await stageEvidence(session);
    expect((await session.invoke('scene.create', { operationId: 'op-after-evidence', sceneId: 'later' })).ok).toBe(true);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.validation.status).toBe('stale');
    expect(capsule.simulation.status).toBe('stale');
    expect(capsule.runtime.status).toBe('stale');
    expect((capsule.objectDiff as any).freshness?.status ?? capsule.warnings).toBeDefined();
    expect(capsule.capsuleVersion).toBe('2.0.0');
    expect(capsule.contractVersion).toBe('2.1.0');
    expect(capsule.composition.eligibility).toBe('ready');
    const manifest = capsule.composition.manifest as { operations: unknown[] } | undefined;
    expect(manifest?.operations.length).toBeGreaterThan(0);
    await session.close();
  });

  it('keeps consecutive capsules immutable and verifies disk identity', async () => {
    const session = await openSession('immutable');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const first = await generateDeliveryCapsule(session);
    const firstBytes = fs.readFileSync(first.artifactIdentity.path);
    const firstSha = sha256(first.artifactIdentity.path);
    const second = await generateDeliveryCapsule(session);
    expect(second.capsuleId).not.toBe(first.capsuleId);
    expect(second.artifactIdentity.path).not.toBe(first.artifactIdentity.path);
    expect(fs.readFileSync(first.artifactIdentity.path)).toEqual(firstBytes);
    expect(first.artifactIdentity.bytes).toBe(firstBytes.byteLength);
    expect(first.artifactIdentity.sha256).toBe(firstSha);
    const identityPath = path.join(path.dirname(first.artifactIdentity.path), 'identity.json');
    const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8')) as any;
    expect(identity.path).toBe(first.artifactIdentity.path);
    expect(identity.bytes).toBe(first.artifactIdentity.bytes);
    expect(identity.sha256).toBe(first.artifactIdentity.sha256);
    await session.close();
  });

  it('builds base and working snapshots from the same record adapter without disk writes', async () => {
    const session = await openSession('dual-view');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    expect((await session.invoke('scene.create', { operationId: 'op-dual-view', sceneId: 'dual_view' })).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    const record = opened!.record;
    const dataDir = process.env['SURDET_AGENT_DATA_DIR']!;
    const listDataFiles = (): string[] => fs.readdirSync(dataDir, { recursive: true }).map((entry) => String(entry)).sort();
    const before = listDataFiles();
    const hasher = {
      sha256: async (text: string) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
    };
    const working = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'working'), hasher);
    const base = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'base'), hasher);
    expect(working.scenes.some((scene) => scene.id === 'dual_view')).toBe(true);
    expect(base.scenes.some((scene) => scene.id === 'dual_view')).toBe(false);
    expect(listDataFiles()).toEqual(before);
    await session.close();
  });
});
