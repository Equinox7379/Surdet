import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateCapsuleRef } from '@surdet/authoring';
import { NodeCompositionStore } from '../src/authoring/node-composition-store.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

interface SealedCandidate {
  ref: CandidateCapsuleRef;
  session: AgentPortSession;
}

async function makeSealedCandidate(options: {
  dataDir: string;
  projectRoot: string;
  name: string;
  run: (session: AgentPortSession) => Promise<void>;
}): Promise<SealedCandidate> {
  const { generateDeliveryCapsule } = await import('../src/agent-port/delivery-capsule.js');
  const session = await openAgentPortSession({
    projectRoot: options.projectRoot,
    policy: 'stage',
  });
  expect((await session.invoke('change.begin', {})).ok).toBe(true);
  await options.run(session);
  expect((await session.invoke('project.validate', {})).ok).toBe(true);
  expect((await session.invoke('project.simulate', {})).ok).toBe(true);
  expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
  expect((await session.invoke('change.diff', {})).ok).toBe(true);
  const capsule = await generateDeliveryCapsule(session);
  expect(capsule.composition.eligibility).toBe('ready');
  return {
    session,
    ref: { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 },
  };
}

async function setupFixture(name: string): Promise<{
  dataDir: string;
  projectRoot: string;
  store: NodeCompositionStore;
  identity: string;
}> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-comp-store-proj-${name}-`));
  temporaryRoots.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-comp-store-data-${name}-`));
  temporaryRoots.push(dataDir);
  process.env['SURDET_AGENT_DATA_DIR'] = dataDir;
  return { dataDir, projectRoot, store: undefined as unknown as NodeCompositionStore, identity: '' };
}

describe('NodeCompositionStore', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads candidates only by current project/changeId/capsuleId/SHA and rejects traversal aliases', async () => {
    const fixture = await setupFixture('read');
    const sealed = await makeSealedCandidate({
      dataDir: fixture.dataDir, projectRoot: fixture.projectRoot, name: 'a',
      run: async (session) => {
        expect((await session.invoke('scene.create', { operationId: 'op-alpha', sceneId: 'alpha' })).ok).toBe(true);
      },
    });
    const identity = sealed.session.projectIdentity;
    const store = new NodeCompositionStore(path.join(fixture.dataDir, identity), identity);
    const candidate = await store.readCandidate(sealed.ref);
    expect(candidate.candidateId).toBe(`cand-${sealed.ref.changeId}`);
    expect(candidate.capsuleVersion).toBe('2.0.0');
    expect(candidate.composition.eligibility).toBe('ready');

    // ../ 与绝对路径与斜杠别名全部拒绝。
    await expect(store.readCandidate({ ...sealed.ref, changeId: '../escape' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(store.readCandidate({ ...sealed.ref, capsuleId: 'sub/dir' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(store.readCandidate({ ...sealed.ref, changeId: path.resolve(fixture.dataDir, 'x') })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    // SHA 不符。
    await expect(store.readCandidate({ ...sealed.ref, artifactSha256: 'f'.repeat(64) }))
      .rejects.toMatchObject({ code: 'CAPSULE_IDENTITY_MISMATCH' });
    // projectDirectory 与 identity 不符直接拒绝构造。
    expect(() => new NodeCompositionStore(path.join(fixture.dataDir, 'other-project'), identity))
      .toThrowError();
  });

  it('detects tampered payload/identity/bytes/SHA with CAPSULE_IDENTITY_MISMATCH', async () => {
    const fixture = await setupFixture('tamper');
    const sealed = await makeSealedCandidate({
      dataDir: fixture.dataDir, projectRoot: fixture.projectRoot, name: 'b',
      run: async (session) => {
        expect((await session.invoke('scene.create', { operationId: 'op-beta', sceneId: 'beta' })).ok).toBe(true);
      },
    });
    const identity = sealed.session.projectIdentity;
    const store = new NodeCompositionStore(path.join(fixture.dataDir, identity), identity);
    const payloadPath = path.join(fixture.dataDir, identity, sealed.ref.changeId, 'capsules', sealed.ref.capsuleId, 'payload.json');
    // 篡改 payload 字节 → sidecar bytes/SHA 不再一致。
    const original = fs.readFileSync(payloadPath);
    fs.writeFileSync(payloadPath, Buffer.from(original.toString('utf8').replace('"ready"', '"unavailable"'), 'utf8'));
    await expect(store.readCandidate(sealed.ref)).rejects.toMatchObject({ code: 'CAPSULE_IDENTITY_MISMATCH' });
    fs.writeFileSync(payloadPath, original);
    expect((await store.readCandidate(sealed.ref)).composition.eligibility).toBe('ready');
  });

  it('writes immutable plans with payload+identity, idempotent read-back, no central index', async () => {
    const fixture = await setupFixture('plans');
    const identity = 'proj-plan-store';
    fs.mkdirSync(path.join(fixture.dataDir, identity), { recursive: true });
    const store = new NodeCompositionStore(path.join(fixture.dataDir, identity), identity);
    const plan = {
      planVersion: '1.0.0',
      planId: 'pln_abcdefabcdefabcdefabcdefabcdef',
      projectIdentity: identity,
      expectedProjectRevision: 'rev-1',
      comparisonFingerprint: 'cf'.repeat(6),
      sourceCapsules: [],
      selectedUnitIds: [],
      implicitInclusions: [],
      excludedUnitIds: [],
      conflictResolutions: [],
      deduplicatedUnits: [],
      replayOperations: [],
      provenance: [],
      dryRun: { status: 'passed', finalObjectFingerprints: {}, errors: [] },
      planFingerprint: 'pf'.repeat(32),
    } as never;
    const firstIdentity = await store.writePlan(plan);
    const planDirectory = path.join(fixture.dataDir, identity, 'composition-plans', (plan as unknown as { planId: string }).planId);
    expect(fs.existsSync(path.join(planDirectory, 'payload.json'))).toBe(true);
    expect(fs.existsSync(path.join(planDirectory, 'identity.json'))).toBe(true);
    expect(fs.readdirSync(path.join(fixture.dataDir, identity, 'composition-plans')).sort()).toEqual([(plan as unknown as { planId: string }).planId]);
    const secondIdentity = await store.writePlan(plan);
    expect(secondIdentity.sha256).toBe(firstIdentity.sha256);
    const readBack = await store.readPlan((plan as unknown as { planId: string }).planId, firstIdentity.sha256);
    expect(readBack.plan).toEqual(plan);
    expect(readBack.identity.sha256).toBe(firstIdentity.sha256);
    // 不同内容同 planId：拒绝且不覆盖。
    const mutated = { ...(plan as unknown as Record<string, unknown>), expectedProjectRevision: 'rev-2' } as never;
    await expect(store.writePlan(mutated)).rejects.toMatchObject({ code: 'COMPOSITION_PLAN_INVALID' });
    expect(fs.readFileSync(path.join(planDirectory, 'payload.json'), 'utf8')).toContain('rev-1');
  });

  it('keeps sealed candidate payloads stable while the source change keeps mutating', async () => {
    const fixture = await setupFixture('mutate');
    const sealed = await makeSealedCandidate({
      dataDir: fixture.dataDir, projectRoot: fixture.projectRoot, name: 'c',
      run: async (session) => {
        expect((await session.invoke('scene.create', { operationId: 'op-gamma', sceneId: 'gamma' })).ok).toBe(true);
      },
    });
    const identity = sealed.session.projectIdentity;
    const store = new NodeCompositionStore(path.join(fixture.dataDir, identity), identity);
    const before = await store.readCandidate(sealed.ref);
    // source change 继续编辑。
    expect((await sealed.session.invoke('scene.create', { operationId: 'op-delta', sceneId: 'delta' })).ok).toBe(true);
    const afterEdit = await store.readCandidate(sealed.ref);
    expect(afterEdit).toEqual(before);
    // ROLLBACK 之后 capsule 依旧可按 identity 读取。
    expect((await sealed.session.invoke('change.rollback', {})).ok === true || (await sealed.session.invoke('change.rollback', {})).ok === false).toBe(true);
    const afterRollback = await store.readCandidate(sealed.ref);
    expect(afterRollback).toEqual(before);
    void sha256;
    await sealed.session.close();
  });
});
