import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAuthoringCapability, type InvocationContext } from '../src/authoring/authoring-dispatcher.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { cmdSimulate } from '../src/simulate.js';

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
    const projectSimulation = await dispatchAuthoringCapability(context(root), 'project.simulate', { seed: 0 }, service);
    const projectResult = projectSimulation.value.result as {
      report?: { seed?: number; paths: { finalVariables: Record<string, unknown> }[] };
    };
    expect(projectResult.report?.seed).toBe(0);
    expect(projectResult.report?.paths[0]?.finalVariables).toMatchObject({ first: 26, second: 0 });

    const begun = await dispatchAuthoringCapability(context(root), 'change.begin', {
      intent: 'seed contract',
      acceptanceCriteria: ['seed is visible'],
      initiator: 'automation',
    }, service);
    const changeId = (begun.value.result as { changeId: string }).changeId;
    const working = context(root, changeId);

    const runtime = await dispatchAuthoringCapability(working, 'runtime.run-from', {
      sceneId: 'seeded',
      choices: [],
      seed: 0,
    }, service);
    const runtimeResult = runtime.value.result as {
      traceId: string;
      seed?: number;
      finalVariables?: Record<string, unknown>;
    };
    expect(runtimeResult.seed).toBe(0);
    expect(runtimeResult.finalVariables).toMatchObject({ first: 26, second: 0 });

    const seedOneRuntime = await dispatchAuthoringCapability(working, 'runtime.run-from', {
      sceneId: 'seeded',
      choices: [],
      seed: 1,
    }, service);
    const seedOneResult = seedOneRuntime.value.result as { finalVariables?: Record<string, unknown>; seed?: number };
    expect(seedOneResult.seed).toBe(1);
    expect(seedOneResult.finalVariables).toMatchObject({ first: 63, second: 0 });

    const seedOneProject = await dispatchAuthoringCapability(context(root), 'project.simulate', { seed: 1 }, service);
    const seedOneProjectResult = seedOneProject.value.result as {
      report?: { seed?: number; paths: { finalVariables: Record<string, unknown> }[] };
    };
    expect(seedOneProjectResult.report?.seed).toBe(1);
    expect(seedOneProjectResult.report?.paths[0]?.finalVariables).toMatchObject({ first: 63, second: 0 });

    const trace = await dispatchAuthoringCapability(working, 'runtime.read-trace', {
      traceId: runtimeResult.traceId,
      query: {},
    }, service);
    expect((trace.value.result as { seed?: number }).seed).toBe(0);
  });

  it('非 JSON 文本报告明确显示实际生效的 seed', async () => {
    const root = makeProject();
    let output = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stdout.write);
    try {
      await expect(cmdSimulate(root, ['--seed', '0'])).resolves.toBe(0);
    } finally {
      write.mockRestore();
    }
    expect(output).toContain('实际生效 seed：0');
  });
});
