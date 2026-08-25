import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-agent-comp-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'timelines'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n\u51db\uff1a\u5f00\u59cb\u3002\n@end\n', 'utf8');
  // Baseline opening timeline referencing night_field so the asset object
  // enters the base object index (required by manifest dependency closure).
  fs.writeFileSync(path.join(root, 'content', 'timelines', 'baseline_opening.json'), JSON.stringify({
    version: 1, id: 'baseline_opening', durationMs: 100,
    tracks: [{ kind: 'background', target: '', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'set', key: 'night_field' }] }],
  }), 'utf8');
  return root;
}

async function sealCandidate(projectRoot: string, name: string, run: (session: AgentPortSession) => Promise<void>): Promise<{ changeId: string; capsuleId: string; artifactSha256: string }> {
  const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
  expect((await session.invoke('change.begin', {})).ok).toBe(true);
  await run(session);
  expect((await session.invoke('project.validate', {})).ok).toBe(true);
  expect((await session.invoke('project.simulate', {})).ok).toBe(true);
  expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
  expect((await session.invoke('change.diff', {})).ok).toBe(true);
  const capsule = await generateDeliveryCapsule(session);
  expect(capsule.composition.eligibility).toBe('ready');
  await session.close();
  return { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 };
}

describe('composition capabilities through the agent port', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('blocks composition.execute under observe policy while compare stays available', async () => {
    const projectRoot = makeProject('observe');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-comp-data-observe-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    const session = await openAgentPortSession({ projectRoot, policy: 'observe' });
    try {
      const blocked = await session.invoke('composition.execute', {
        planId: 'pln_x',
        artifactSha256: 'a'.repeat(64),
        executeOperationId: 'exec-1',
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe('POLICY_BLOCKED');
      const described = await session.describe();
      const availability = Object.fromEntries(described.capabilities.map((item) => [item.id, item.availability]));
      expect(availability['composition.compare']).toBe('available');
      expect(availability['composition.plan']).toBe('available');
      expect(availability['composition.inspect']).toBe('available');
      expect(availability['composition.execute']).toBe('policy-blocked');
    } finally {
      await session.close();
    }
  });

  it('compares, plans and executes two sealed capsules end to end with an integration active change', async () => {
    const projectRoot = makeProject('e2e');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-comp-data-e2e-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;

    const first = await sealCandidate(projectRoot, 'a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-e2e-alpha', sceneId: 'alpha' })).ok).toBe(true);
    });
    const second = await sealCandidate(projectRoot, 'b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-e2e-flag', name: 'flag.e2e', type: 'number', initial: 0 })).ok).toBe(true);
    });

    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    try {
      const compared = await session.invoke('composition.compare', {
        candidateRefs: [
          { changeId: first.changeId, capsuleId: first.capsuleId, artifactSha256: first.artifactSha256 },
          { changeId: second.changeId, capsuleId: second.capsuleId, artifactSha256: second.artifactSha256 },
        ],
      });
      expect(compared.ok).toBe(true);

      const planned = await session.invoke('composition.plan', {
        candidateRefs: [
          { changeId: first.changeId, capsuleId: first.capsuleId, artifactSha256: first.artifactSha256 },
          { changeId: second.changeId, capsuleId: second.capsuleId, artifactSha256: second.artifactSha256 },
        ],
        conflictResolutions: [],
        reason: 'wave 5 e2e',
      });
      if (!planned.ok) console.log('DIAG-P5', JSON.stringify((planned as { error: { message: string; details?: unknown } }).error));
      expect(planned.ok).toBe(true);
      const planResult = (planned as { ok: true; result: { planId: string; artifactSha256: string; dryRunStatus: string } }).result;
      expect(planResult.dryRunStatus).toBe('passed');

      // plan 不占用 active change：session 仍可自由 begin。
      expect(session.activeChangeId).toBeUndefined();

      const executed = await session.invoke('composition.execute', {
        planId: planResult.planId,
        artifactSha256: planResult.artifactSha256,
        executeOperationId: 'exec-e2e-1',
      });
      expect(executed.ok).toBe(true);
      const executeResult = (executed as { ok: true; result: { integrationChangeId: string; status: string; operationCount: number } }).result;
      expect(executeResult.status).toBe('READY');
      expect(executeResult.operationCount).toBeGreaterThan(0);
      // execute 成功后 integration change 成为 session 的 active change。
      expect(session.activeChangeId).toBe(executeResult.integrationChangeId);

      const described = await session.describe();
      expect(described.activeChange?.integration?.planId).toBe(planResult.planId);
      expect(described.activeChange?.integration?.status).toBe('READY');
      expect(described.nextActions).toContain('change.diff');

      // 同一 executeOperationId 幂等重放：仍 READY，不产生第二个 change。
      const replayed = await session.invoke('composition.execute', {
        planId: planResult.planId,
        artifactSha256: planResult.artifactSha256,
        executeOperationId: 'exec-e2e-1',
      });
      expect(replayed.ok).toBe(true);
      expect((replayed as { ok: true; result: { integrationChangeId: string } }).result.integrationChangeId)
        .toBe(executeResult.integrationChangeId);
    } finally {
      await session.close();
    }
  });

  it('state-blocks composition.execute while an ordinary active change is open', async () => {
    const projectRoot = makeProject('busy');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-comp-data-busy-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const result = await session.invoke('composition.execute', {
        planId: 'pln_y',
        artifactSha256: 'b'.repeat(64),
        executeOperationId: 'exec-busy',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['SESSION_STATE_INVALID', 'CHANGE_BUSY']).toContain(result.error.code);
      }
      const described = await session.describe();
      const availability = Object.fromEntries(described.capabilities.map((item) => [item.id, item.availability]));
      expect(availability['composition.execute']).toBe('state-blocked');
    } finally {
      await session.close();
    }
  });
});


describe('integration capsule provenance (wave 5 task 6)', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  const sealForProv = async (projectRoot: string, name: string, run: (session: AgentPortSession) => Promise<void>) => {
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    await run(session);
    expect((await session.invoke('project.validate', {})).ok).toBe(true);
    expect((await session.invoke('project.simulate', {})).ok).toBe(true);
    expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
    expect((await session.invoke('change.diff', {})).ok).toBe(true);
    const capsule = await generateDeliveryCapsule(session);
    if (capsule.composition.eligibility !== 'ready') {
      console.log('DIAG-SEAL', name, capsule.composition.eligibility, JSON.stringify(capsule.composition.reasons));
    }
    await session.close();
    return { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 };
  };

  it('preserves full provenance for a READY integration capsule across A/B/C/D candidates', async () => {
    const projectRoot = makeProject('prov');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-prov-data-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;

    // A：variable + 使用它的 scene；B：scene + opening timeline；C：同 A variable 但 scene 规范结果不同；
    // D：与 A 的 variable+scene closure 完全相同（identical group 成员）。
    const a = await sealForProv(projectRoot, 'a', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-a-var', name: 'flag.prov', type: 'number', initial: 0 })).ok).toBe(true);
      expect((await session.invoke('scene.create', { operationId: 'op-a-scene', sceneId: 'wave5_alpha' })).ok).toBe(true);
    });
    const b = await sealForProv(projectRoot, 'b', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-b-scene', sceneId: 'wave5_beta' })).ok).toBe(true);
      expect((await session.invoke('timeline.create', {
        operationId: 'op-b-timeline',
        timelineId: 'wave5_beta_opening',
        definition: { version: 1, id: 'wave5_beta_opening', durationMs: 100,
          tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'set', key: 'night_field' }] }] },
      })).ok).toBe(true);
    });
    const c = await sealForProv(projectRoot, 'c', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-c-var', name: 'flag.prov', type: 'number', initial: 0 })).ok).toBe(true);
      // C 的 scene:wave5_alpha 与 A 规范结果不同：多一个 label block。
      expect((await session.invoke('scene.create', { operationId: 'op-c-scene', sceneId: 'wave5_alpha', blocks: [{ kind: 'label', name: 'c_mark' }] })).ok).toBe(true);
    });
    const d = await sealForProv(projectRoot, 'd', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-d-var', name: 'flag.prov', type: 'number', initial: 0 })).ok).toBe(true);
      expect((await session.invoke('scene.create', { operationId: 'op-c-scene', sceneId: 'wave5_alpha' })).ok).toBe(true);
    });

    const candidateRefs = [a, b, c, d].map((ref) => ({ ...ref }));
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    try {
      // 先比较拿到 selection-required 冲突，再以 choose A 裁决后计划。
      const compared = await session.invoke('composition.compare', { candidateRefs });
      expect(compared.ok).toBe(true);
      const conflicts = (((compared as { ok: boolean; result?: { conflicts?: Array<Record<string, unknown>> } }).result?.conflicts) ?? []);
      const selectionRequired = conflicts.find((conflict) => conflict.severity === 'selection-required');
      const firstUnitId = selectionRequired === undefined ? '' : ((selectionRequired['unitIds'] as string[] | undefined) ?? [])[0] ?? '';
      const conflictResolutions = selectionRequired === undefined ? [] : [{
        conflictId: selectionRequired['conflictId'] as string,
        resolution: 'choose-unit',
        chosenUnitId: firstUnitId,
        actor: 'human',
      }];
      const planned = await session.invoke('composition.plan', {
        candidateRefs,
        conflictResolutions,
        reason: 'task6 provenance',
      });
      expect(planned.ok).toBe(true);
      const planResult = (planned as { ok: true; result: { planId: string; artifactSha256: string; dryRunStatus: string } }).result;
      expect(planResult.dryRunStatus).toBe('passed');

      const executed = await session.invoke('composition.execute', {
        planId: planResult.planId,
        artifactSha256: planResult.artifactSha256,
        executeOperationId: 'exec-prov-1',
      });
      expect(executed.ok).toBe(true);
      const execResult = (executed as { ok: true; result: { integrationChangeId: string } }).result;

      // fresh evidence：validate/simulate/runtime/diff 全部绑定 integration 当前 workingRevision 后封存。
      expect((await session.invoke('project.validate', {})).ok).toBe(true);
      expect((await session.invoke('project.simulate', {})).ok).toBe(true);
      expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
      expect((await session.invoke('change.diff', {})).ok).toBe(true);

      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.changeStatus).toBe('OPEN');
      const provenance = capsule.integrationProvenance as Record<string, unknown> | undefined;
      expect(provenance).toBeDefined();
      expect(provenance?.['planId']).toBe(planResult.planId);
      expect(provenance?.['integrationChangeId']).toBe(execResult.integrationChangeId);
      expect(provenance?.['status']).toBe('READY');
      const includedUnits = provenance?.['includedUnits'] as string[];
      expect(Array.isArray(includedUnits)).toBe(true);
      expect(includedUnits.length).toBeGreaterThan(0);
      const receipts = provenance?.['replayReceipts'] as unknown[];
      expect(receipts.length).toBeGreaterThan(0);
      const sourceCapsules = provenance?.['sourceCapsules'] as Array<{ changeId: string; capsuleId: string; artifactSha256: string }>;
      expect(sourceCapsules).toEqual(expect.arrayContaining([
        expect.objectContaining({ changeId: a.changeId, artifactSha256: a.artifactSha256 }),
        expect.objectContaining({ changeId: b.changeId, capsuleId: b.capsuleId }),
        expect.objectContaining({ changeId: c.changeId }),
        expect.objectContaining({ changeId: d.changeId }),
      ]));
      // 冲突裁决记录在案（choose-unit）。
      const resolutions = provenance?.['conflictResolutions'] as Array<Record<string, unknown>>;
      expect(resolutions.some((r) => r['resolution'] === 'choose-unit')).toBe(true);
      // dedupe：A/D 的 identical 组去重后仍有 provenance 记录。
      const dedup = provenance?.['deduplicatedUnits'] as Array<Record<string, unknown>>;
      expect(Array.isArray(dedup)).toBe(true);
      expect(dedup.length).toBeGreaterThan(0);
      // freshness 与无 mutation。
      expect(capsule.validation.status).toBeDefined();
      expect(capsule.runtime.status).toBeDefined();
      expect(capsule.projectMutation.occurred).toBe(false);
      await session.close();
    } catch (error) {
      await session.close().catch(() => undefined);
      throw error;
    }
  });
});


describe('integration capsule failure audit (wave 5 task 6)', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('marks broken-plan integration capsules unavailable with manual review and FAILED provenance', async () => {
    const projectRoot = makeProject('broken');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-prov-data-broken-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    // 低层创建一个指向不存在 plan 的 FAILED integration change，再经 session resume 封存 capsule。
    const nodeProjectStorage = await import('../src/authoring/node-project-storage.js');
    const nodeChangeStore = await import('../src/authoring/node-change-store.js');
    const authoring = await import('@surdet/authoring');
    const storage = await nodeProjectStorage.NodeProjectStorage.open(projectRoot);
    const store = await nodeChangeStore.NodeChangeStore.forProject(storage.rootIdentity);
    const snapshot = await authoring.loadProjectSnapshot(storage, { sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex') });
    const seededSession = await authoring.beginChange(snapshot, await nodeChangeStore.NodeChangeStore.forProject(storage.rootIdentity), storage, undefined, {
      integration: {
        planId: 'pln_does_not_exist',
        planFingerprint: 'f'.repeat(64),
        executeOperationId: 'exec-broken',
        sourceCapsules: [],
        includedUnitIds: [],
        deduplicatedUnits: [],
        conflictResolutions: [],
        status: 'FAILED',
        nextOperationIndex: 0,
        replayedOperations: [],
        failure: { code: 'COMPOSITION_REPLAY_FAILED', message: 'simulated failure', operationIndex: 0, integrationOperationId: 'cmp_x_0000_x' },
      },
    });
    const changeId = seededSession.record.changeId;
    const session = await openAgentPortSession({ projectRoot, policy: 'stage', resumeChangeId: changeId });
    try {
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('unavailable');
      expect(JSON.stringify(capsule.composition.reasons)).toContain('COMPOSITION_PLAN_INVALID');
      expect(capsule.manualReviewRequired).toContain('INTEGRATION_PLAN_UNAVAILABLE');
      expect(capsule.warnings).toContain('INTEGRATION_REPLAY_FAILED');
      const provenance = capsule.integrationProvenance as Record<string, unknown>;
      expect(provenance['status']).toBe('FAILED');
      expect((provenance['failure'] as Record<string, unknown>)['code']).toBe('COMPOSITION_REPLAY_FAILED');
      await session.close();
    } catch (error) {
      await session.close().catch(() => undefined);
      throw error;
    }
  });

  it('keeps ordinary v2 capsules free of integrationProvenance', async () => {
    const projectRoot = makeProject('plain');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-prov-data-plain-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    expect((await session.invoke('scene.create', { operationId: 'op-plain', sceneId: 'plain_scene' })).ok).toBe(true);
    expect((await session.invoke('project.validate', {})).ok).toBe(true);
    expect((await session.invoke('project.simulate', {})).ok).toBe(true);
    expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
    expect((await session.invoke('change.diff', {})).ok).toBe(true);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.integrationProvenance).toBeUndefined();
    await session.close();
  });
});
