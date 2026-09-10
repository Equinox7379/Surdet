import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHORING_CONTRACT_VERSION, CANDIDATE_COMPOSITION_READINESS_SCHEMA, type AuthoringEnvelope, type AuthoringObject } from '@surdet/authoring';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';

const temporaryRoots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave8-project-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave8-data-'));
  temporaryRoots.push(root, data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters: {} }));
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n旁白：开始。\n@end\n');
  return { root, data };
}

function result<T>(envelope: AuthoringEnvelope<unknown>): T {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.result as T;
}

async function insertJump(session: AgentPortSession, operationId: string, sceneId: string, target: string) {
  const scene = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: `scene:${sceneId}` }));
  const anchor = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: scene.childRefs![0] }));
  return session.invoke('scene.patch', { operationId, sceneId, patch: {
    kind: 'insertAfter', anchor: anchor.objectRef, expectedFingerprint: anchor.fingerprint,
    blocks: [{ kind: 'instruction', name: 'jump', args: [target] }],
  } });
}

describe('Wave 8 candidate readiness through Agent Port', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('recovers from a missing producer and a rejected reciprocal edge in one change, then seals without project writes', async () => {
    const { root } = fixture();
    const beforeConfig = fs.readFileSync(path.join(root, 'game.config.json'));
    const beforeScene = fs.readFileSync(path.join(root, 'content', 'scenario', 'start.gal'));
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', {}));
      const initial = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const input = { operationId: 'entry', sceneId: 'entry', blocks: [{ kind: 'instruction', name: 'jump', args: ['ending'] }] };
      const missing = await session.invoke('scene.create', input);
      expect(missing).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY', retryDisposition: 'after-repair', details: {
        operationApplied: false, compositionMode: 'candidate', operationId: 'entry', capabilityId: 'scene.create',
        workingRevisionBefore: 0, workingRevisionAfter: 0,
        issues: [expect.objectContaining({ objectRef: 'scene:ending', suggestedCapabilities: ['scene.create'], repairStrategy: 'create-before-retry' })],
      } } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(initial);
      result(await session.invoke('scene.create', { operationId: 'ending', sceneId: 'ending', blocks: [{ kind: 'text', value: '抵达终点。' }] }));
      result(await session.invoke('scene.create', input));
      for (const id of ['A', 'B']) result(await session.invoke('scene.create', { operationId: `create-${id}`, sceneId: id }));
      result(await insertJump(session, 'a-to-b', 'A', 'B'));
      const beforeCycle = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const rejected = await insertJump(session, 'b-to-a', 'B', 'A');
      expect(rejected).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_CYCLE', details: { operationApplied: false, unsupportedRecovery: 'mutual-empty-skeleton' } } });
      const opened = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!;
      expect(opened.record).toEqual(beforeCycle);
      const description = await session.describe();
      expect(description.contractVersion).toBe('2.3.0');
      expect(description.candidateReadiness).toMatchObject({ mode: 'candidate', status: 'ready', operationCount: 5, issueCount: 0, truncated: false });
      result(await session.invoke('project.validate', {}));
      result(await session.invoke('project.simulate', { sceneId: 'entry' }));
      result(await session.invoke('runtime.run-from', { sceneId: 'entry', choices: [] }));
      const diff = result<{ compositionReadiness: unknown }>(await session.invoke('change.diff', {}));
      expect(diff.compositionReadiness).toEqual(description.candidateReadiness);
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility, JSON.stringify(capsule.composition.reasons)).toBe('ready');
      expect(capsule.validation.status).toBe('fresh');
      expect(capsule.simulation.status).toBe('fresh');
      expect(capsule.runtime.status).toBe('fresh');
      expect(capsule.projectMutation).toMatchObject({ occurred: false, expectedByPolicy: false });
      const invocations = await opened.store.readInvocations(opened.record.changeId);
      expect(invocations.filter((entry) => !entry.ok)).toHaveLength(2);
      for (const entry of invocations) {
        expect(entry.projectRevisionAfter, entry.capability).toBe(initial.baseRevision);
        if (entry.capability !== 'change.begin') expect(entry.projectRevisionBefore, entry.capability).toBe(initial.baseRevision);
      }
      expect(fs.readFileSync(path.join(root, 'game.config.json'))).toEqual(beforeConfig);
      expect(fs.readFileSync(path.join(root, 'content', 'scenario', 'start.gal'))).toEqual(beforeScene);
      expect(fs.readdirSync(path.join(root, 'content', 'scenario'))).toEqual(['start.gal']);
    } finally { await session.close(); }
  });

  it('keeps candidate mode through apply resume and leaves new apply/service changes direct', async () => {
    const { root } = fixture();
    const stage = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    const invalid = await stage.invoke('change.begin', { compositionMode: 'direct' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    result(await stage.invoke('change.begin', {}));
    const changeId = stage.activeChangeId!;
    await stage.close();
    const resumed = await openAgentPortSession({ projectRoot: root, policy: 'apply', resumeChangeId: changeId });
    expect((await resumed.describe()).candidateReadiness).toMatchObject({ mode: 'candidate', status: 'ready' });
    expect(await resumed.invoke('scene.create', { operationId: 'missing', sceneId: 'entry', blocks: [{ kind: 'instruction', name: 'jump', args: ['missing'] }] })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
    await resumed.close();
    const direct = await openAgentPortSession({ projectRoot: root, policy: 'apply' });
    result(await direct.invoke('change.begin', {}));
    expect((await direct.describe()).candidateReadiness).toMatchObject({ mode: 'direct', status: 'not-applicable' });
    result(await direct.invoke('scene.create', { operationId: 'direct-reference', sceneId: 'direct', blocks: [{ kind: 'instruction', name: 'jump', args: ['missing'] }] }));
    await direct.close();
    const serviceChange = await new AuthoringService().begin(root);
    expect((await NodeChangeStore.openByChangeId(serviceChange.result.changeId))!.record.composition?.mode).toBe('direct');
  });

  it('reports an old open record as unavailable without adding temporal metadata', async () => {
    const { root } = fixture();
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    result(await session.invoke('change.begin', {}));
    await NodeChangeStore.withChangeLease(session.activeChangeId!, async (store) => {
      const record = (await store.read(session.activeChangeId!))!;
      Object.assign(record.composition!, { operationFactsVersion: '2.0.0' });
      await store.write({ ...record, recordVersion: record.recordVersion + 1 }, { expectedRecordVersion: record.recordVersion, expectedStatus: record.status });
    });
    const unsupported = (await session.describe()).candidateReadiness;
    expect(unsupported).toMatchObject({ mode: 'candidate', status: 'blocked', issues: [expect.objectContaining({ code: 'OPERATION_FACTS_INVALID' })] });
    expect((await standardSchemaFromJson(CANDIDATE_COMPOSITION_READINESS_SCHEMA)['~standard'].validate(unsupported)).issues).toBeUndefined();
    await NodeChangeStore.withChangeLease(session.activeChangeId!, async (store) => {
      const record = (await store.read(session.activeChangeId!))!;
      delete record.composition;
      await store.write({ ...record, recordVersion: record.recordVersion + 1 }, { expectedRecordVersion: record.recordVersion, expectedStatus: record.status });
    });
    expect((await session.describe()).candidateReadiness).toMatchObject({ mode: 'legacy-unclassified', status: 'legacy-unavailable' });
    expect((await session.describe()).nextActions).toEqual(['change.diff', 'change.rollback']);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.composition).toMatchObject({ eligibility: 'unavailable', reasons: [expect.objectContaining({ code: 'OPERATION_FACTS_MISSING' })] });
    expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).not.toHaveProperty('composition');
    await session.close();
  });

  it('freezes resolved assets at begin instead of admitting files added later', async () => {
    const { root } = fixture();
    const assetDir = path.join(root, 'content', 'assets', 'bg');
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, 'initial.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    result(await session.invoke('change.begin', {}));
    expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record.composition).toEqual({ mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs: ['asset:bg:initial'] });
    fs.writeFileSync(path.join(assetDir, 'later.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await session.invoke('scene.create', { operationId: 'late-asset', sceneId: 'late', blocks: [{ kind: 'instruction', name: 'bg', args: ['later'] }] })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
    await session.close();
  });

  it('validates strict mode/status and nested readiness fields under contract 2.3', async () => {
    expect(AUTHORING_CONTRACT_VERSION).toBe('2.3.0');
    const schema = standardSchemaFromJson(CANDIDATE_COMPOSITION_READINESS_SCHEMA);
    const readiness = { mode: 'candidate', status: 'ready', operationFactsVersion: '1.0.0', operationCount: 0, issueCount: 0, issues: [], truncated: false };
    expect((await schema['~standard'].validate(readiness)).issues).toBeUndefined();
    expect((await schema['~standard'].validate({ ...readiness, status: 'not-applicable' })).issues).toBeDefined();
    expect((await schema['~standard'].validate({ ...readiness, extra: true })).issues).toBeDefined();
    expect((await schema['~standard'].validate({ ...readiness, issues: [{ code: 'OPERATION_FACTS_MISSING', message: 'old', extra: true }] })).issues).toBeDefined();
  });
});
