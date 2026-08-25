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
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
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
        unitChoices: [],
        reason: 'wave 5 e2e',
      });
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
