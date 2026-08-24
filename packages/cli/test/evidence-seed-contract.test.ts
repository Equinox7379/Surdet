import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAuthoringCapability, type InvocationContext } from '../src/authoring/authoring-dispatcher.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';

const roots: string[] = [];

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-evidence-seed-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-evidence-seed-data-'));
  roots.push(root, data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({
    entryScene: 'seeded',
    variables: { first: { type: 'number', initial: 0 }, second: { type: 'number', initial: 0 } },
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'seeded.gal'), [
    '@scene seeded',
    '@random first 0 100',
    '@random second 0 100',
    '@clear seeded_done',
    '@end',
  ].join('\n'), 'utf8');
  return root;
}

function context(root: string, changeId?: string): InvocationContext {
  return {
    sessionId: 'evidence-seed-contract',
    policy: 'stage',
    projectRoot: root,
    ...(changeId === undefined ? {} : { activeChangeId: changeId }),
  };
}

describe('evidence seed contract', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('project.simulate, runtime.run-from and runtime.read-trace retain the effective seed', async () => {
    const root = makeProject();
    const service = new AuthoringService();
    const begun = await dispatchAuthoringCapability(context(root), 'change.begin', {
      intent: 'seed contract',
      acceptanceCriteria: ['seed is visible'],
      initiator: 'automation',
    }, service);
    const changeId = (begun.value.result as { changeId: string }).changeId;
    const working = context(root, changeId);

    const simulation = await dispatchAuthoringCapability(working, 'project.simulate', { seed: 0 }, service);
    expect((simulation.value.result as { seed?: number }).seed).toBe(0);

    const runtime = await dispatchAuthoringCapability(working, 'runtime.run-from', {
      sceneId: 'seeded',
      choices: [],
      seed: 0,
    }, service);
    const runtimeResult = runtime.value.result as { traceId: string; seed?: number };
    expect(runtimeResult.seed).toBe(0);

    const trace = await dispatchAuthoringCapability(working, 'runtime.read-trace', {
      traceId: runtimeResult.traceId,
      query: {},
    }, service);
    expect((trace.value.result as { seed?: number }).seed).toBe(0);
  });
});
