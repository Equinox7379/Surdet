import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TextHasher } from '@surdet/authoring';
import { NodeCompositionStore } from '../src/authoring/node-composition-store.js';
import { CompositionService } from '../src/authoring/composition-service.js';
import { NodeChangeStore as NodeChangeStoreStatic } from '../src/authoring/node-change-store.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

const realHasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

interface SealedRef {
  ref: { changeId: string; capsuleId: string; artifactSha256: string };
  bytes: Buffer;
}

async function sealCandidate(
  projectRoot: string,
  name: string,
  run: (session: AgentPortSession) => Promise<void>,
): Promise<SealedRef> {
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
  return {
    ref: { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 },
    bytes: fs.readFileSync(capsule.artifactIdentity.path),
  };
}

async function setup(name: string): Promise<{
  dataDir: string;
  projectRoot: string;
  store: NodeCompositionStore;
  service: CompositionService;
  identity: string;
}> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-comp-svc-proj-${name}-`));
  temporaryRoots.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-comp-svc-data-${name}-`));
  temporaryRoots.push(dataDir);
  process.env['SURDET_AGENT_DATA_DIR'] = dataDir;
  const probe = await openAgentPortSession({ projectRoot, policy: 'stage' });
  const identity = probe.projectIdentity;
  await probe.close();
  const store = new NodeCompositionStore(path.join(dataDir, identity), identity);
  const service = new CompositionService(store, identity, projectRoot, realHasher);
  return { dataDir, projectRoot, store, service, identity };
}

function treeSnapshot(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else entries.set(full, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  visit(root);
  return entries;
}

describe('CompositionService compare/plan/dry-run', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('compares and plans two real sealed capsules end to end', async () => {
    const fixture = await setup('e2e');
    const first = await sealCandidate(fixture.projectRoot, 'one', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-alpha', sceneId: 'alpha' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'two', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-flag', name: 'flag.wave5', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const comparisonResult = await fixture.service.compare([first.ref, second.ref]);
    expect(comparisonResult.comparison.status).toBe('composable');
    expect(comparisonResult.candidates).toHaveLength(2);
    expect(comparisonResult.comparison.candidateManifests?.['cand-' + first.ref.changeId]?.operations.length).toBeGreaterThan(0);

    const planResult = await fixture.service.plan({ candidateRefs: [first.ref, second.ref], now: '2026-08-24T12:00:00.000Z' });
    expect(planResult.plan.planVersion).toBe('1.0.0');
    expect(planResult.plan.dryRun.status).toBe('passed');
    expect(Object.keys(planResult.plan.dryRun.finalObjectFingerprints)).toContain('scene:alpha');
    // 同语义再 plan：同 planId 幂等回读首次封存。
    const again = await fixture.service.plan({ candidateRefs: [first.ref, second.ref], now: '2026-08-24T13:00:00.000Z' });
    expect(again.plan.planId).toBe(planResult.plan.planId);
  });

  it('leaves project tree, source records and capsule bytes untouched after dry-run', async () => {
    const fixture = await setup('no-mutation');
    const first = await sealCandidate(fixture.projectRoot, 'keep-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-keep-scene', sceneId: 'keep_scene' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'keep-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-keep-var', name: 'flag.keep', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const beforeProject = treeSnapshot(fixture.projectRoot);
    const beforeData = treeSnapshot(fixture.dataDir);
    const result = await fixture.service.plan({ candidateRefs: [first.ref, second.ref] });
    expect(result.plan.dryRun.status).toBe('passed');
    const afterProject = treeSnapshot(fixture.projectRoot);
    expect([...afterProject.entries()].filter(([file]) => !file.includes(`${path.sep}composition-plans${path.sep}`)))
      .toEqual([...beforeProject.entries()]);
    const afterData = treeSnapshot(fixture.dataDir);
    // 除新增 plan 目录外，data 树其余部分（含两个 source capsule）逐字节不变。
    const changed = [...afterData.entries()].filter(([file, sha]) => beforeData.get(file) !== sha);
    expect(changed.every(([file]) => file.includes(`${path.sep}composition-plans${path.sep}`))).toBe(true);
    expect(fs.readFileSync(path.join(
      fixture.dataDir, fixture.identity, first.ref.changeId, 'capsules', first.ref.capsuleId, 'payload.json',
    ))).toEqual(first.bytes);
  });

  it('matches typed replay results against plan final fingerprints', async () => {
    const fixture = await setup('fingerprints');
    const first = await sealCandidate(fixture.projectRoot, 'fp-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-fp-scene', sceneId: 'fp_scene' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'fp-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-fp-var', name: 'flag.fp', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const result = await fixture.service.plan({ candidateRefs: [first.ref, second.ref] });
    expect(result.plan.dryRun.status).toBe('passed');
    // plan 内每个 provenance 目标都能在 dry-run 指纹表中找到，且与单元封存值一致。
    expect(Object.keys(result.plan.dryRun.finalObjectFingerprints)).toContain('scene:fp_scene');
    for (const entry of result.plan.provenance) {
      if (entry.targetObject.startsWith('scene:') || entry.targetObject.startsWith('timeline:')) {
        expect(result.plan.dryRun.finalObjectFingerprints[entry.targetObject]).toBeDefined();
      }
    }
  });

  it('seals an auditable failed plan when the project has moved past the capsules', async () => {
    const fixture = await setup('stale-clash');
    const first = await sealCandidate(fixture.projectRoot, 'clash-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-clash-a', sceneId: 'clash' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'clash-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-clash-var', name: 'flag.clash', type: 'number', initial: 0 })).ok).toBe(true);
    });
    // 项目前进：apply 会话真实 commit 一个同样创建 scene:clash 的变更（不同指纹）。
    const mover = await openAgentPortSession({ projectRoot: fixture.projectRoot, policy: 'apply' });
    expect((await mover.invoke('change.begin', {})).ok).toBe(true);
    expect((await mover.invoke('scene.create', { operationId: 'op-mover', sceneId: 'clash' })).ok).toBe(true);
    expect((await mover.invoke('project.validate', {})).ok).toBe(true);
    expect((await mover.invoke('project.simulate', {})).ok).toBe(true);
    expect((await mover.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
    expect((await mover.invoke('change.diff', {})).ok).toBe(true);
    const committed = await mover.invoke('change.commit', {});
    expect(committed.ok).toBe(true);
    await mover.close();

    const planResult = await fixture.service.plan({ candidateRefs: [first.ref, second.ref] });
    // plan 可审计：已封存落盘、含失败详情；dry-run 失败即不可执行。
    expect(planResult.plan.dryRun.status).toBe('failed');
    expect(planResult.plan.dryRun.errors[0]!.code).toBe('OBJECT_PRECONDITION_FAILED');
    const readBack = await fixture.store.readPlan(planResult.plan.planId, planResult.identity.sha256);
    expect(readBack.plan.dryRun.status).toBe('failed');
    expect(readBack.plan.replayOperations.length).toBeGreaterThan(0);
  });
});

  it('resumes an interrupted integration exactly with a second service instance', async () => {
    const fixture = await setup('resume');
    const first = await sealCandidate(fixture.projectRoot, 'res-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-res-alpha', sceneId: 'alpha' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'res-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-res-flag', name: 'flag.res', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const planned = await fixture.service.plan({ candidateRefs: [first.ref, second.ref], now: '2026-08-24T14:00:00.000Z' });
    expect(planned.plan.dryRun.status).toBe('passed');

    // —— 进程 A：创建 integration change 并只推进第一项后“崩溃”——
    {
      const { InMemoryChangeRepository } = await import('@surdet/authoring');
      const snapshot = await fixture.service.currentSnapshot();
      const repository = new InMemoryChangeRepository();
      const probeSession = await import('@surdet/authoring').then((m) => m.beginChange(snapshot, repository, undefined, undefined, {
        integration: {
          planId: planned.plan.planId,
          planFingerprint: planned.plan.planFingerprint,
          executeOperationId: 'exec-1',
          sourceCapsules: planned.plan.sourceCapsules,
          includedUnitIds: planned.plan.selectedUnitIds,
          deduplicatedUnits: planned.plan.deduplicatedUnits,
          conflictResolutions: [],
          status: 'REPLAYING',
          nextOperationIndex: 0,
          replayedOperations: [],
        },
      }));
      void probeSession;
    }
    // 上面的 probe 使用内存 repo，不会留下磁盘 change；改为真实磁盘半成品：
    // 直接以 NodeChangeStore 为 repository 重建同样的 REPLAYING change 并只 replay 第一项。
    const authoring = await import('@surdet/authoring');
    const storage = await (await import('../src/authoring/node-project-storage.js')).NodeProjectStorage.open(fixture.projectRoot);
    const nodeStore = await (await import('../src/authoring/node-change-store.js')).NodeChangeStore.forProject(storage.rootIdentity);
    const snapshot2 = await fixture.service.currentSnapshot();
    // create 免租；随后持 change lease 只推进第一项（模拟崩溃点：receipt 已落盘、后续未跑）。
    const seeded = await authoring.beginChange(snapshot2, nodeStore, storage, undefined, {
      integration: {
        planId: planned.plan.planId,
        planFingerprint: planned.plan.planFingerprint,
        executeOperationId: 'exec-1',
        sourceCapsules: planned.plan.sourceCapsules,
        includedUnitIds: planned.plan.selectedUnitIds,
        deduplicatedUnits: planned.plan.deduplicatedUnits,
        conflictResolutions: [],
        status: 'REPLAYING',
        nextOperationIndex: 0,
        replayedOperations: [],
      },
    });
    const crashed = seeded;
    await NodeChangeStoreStatic.withChangeLease(seeded.record.changeId, async (leased) => {
      const reopened = await leased.read(seeded.record.changeId);
      const crashedSession = new authoring.ChangeSession(reopened!, leased, storage);
      await authoring.replayCompositionOperation(crashedSession, planned.plan.replayOperations[0]!, realHasher);
    });
    const headAfterCrash = await nodeStore.read(seeded.record.changeId);
    // 双阶段中断形态：领域结果已持久化，receipt 未写 → nextOperationIndex 仍为 0。
    expect(headAfterCrash?.integration?.nextOperationIndex).toBe(0);
    expect(Object.keys(headAfterCrash?.operations ?? {})).toContain(planned.plan.replayOperations[0]!.integrationOperationId);

    // —— 进程 B：全新 service instance，无 changeId，精确发现并完成剩余项 ——
    const serviceB = new CompositionService(
      new NodeCompositionStore(path.join(fixture.dataDir, fixture.identity), fixture.identity),
      fixture.identity,
      fixture.projectRoot,
      realHasher,
    );
    const result = await serviceB.executePlan({
      planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256,
      executeOperationId: 'exec-1',
    });
    expect(result.status).toBe('READY');
    expect(result.nextOperationIndex).toBe(planned.plan.replayOperations.length);
    expect(result.workingRevision).toBe(planned.plan.replayOperations.length);
    expect(result.changeId).toBe(crashed.record.changeId);
  });
