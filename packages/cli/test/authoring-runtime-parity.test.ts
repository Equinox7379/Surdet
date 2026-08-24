import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAuthoringCapability, type InvocationContext } from '../src/authoring/authoring-dispatcher.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';

const roots: string[] = [];

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function projectTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const entries = fs.readdirSync(root, { recursive: true }) as string[];
  for (const relative of entries) {
    const absolute = path.join(root, relative);
    if (!fs.statSync(absolute).isFile()) continue;
    result[relative.replaceAll(path.sep, '/')] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  }
  return result;
}

function growthFixture(withGrowth: boolean): { root: string; data: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-runtime-parity-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-runtime-parity-data-'));
  roots.push(root, data);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'config'), { recursive: true });
  writeJson(path.join(root, 'game.config.json'), {
    entryScene: 'prologue',
    variables: {
      'lynn.atk': { type: 'number', initial: 5 },
      'lynn.hp': { type: 'number', initial: 20 },
    },
  });
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'prologue.gal'), [
    '@scene prologue',
    '@exp lynn 10',
    '凛：成长完成。',
    '@end',
  ].join('\n') + '\n', 'utf8');
  if (withGrowth) {
    writeJson(path.join(root, 'content', 'config', 'growth.json'), {
      curve: { base: 10, linear: 5 },
      profiles: [{
        characterId: 'lynn',
        initialLevel: 1,
        statGrowth: { 'lynn.atk': 2, 'lynn.hp': 10 },
      }],
    });
  }
  return { root, data };
}

function context(root: string, changeId?: string): InvocationContext {
  return {
    sessionId: 'authoring-runtime-parity',
    policy: 'stage',
    projectRoot: root,
    ...(changeId === undefined ? {} : { activeChangeId: changeId }),
  };
}

async function workingRevision(changeId: string, data: string): Promise<number> {
  const previousDataDir = process.env['SURDET_AGENT_DATA_DIR'];
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  try {
    const opened = await NodeChangeStore.openByChangeId(changeId);
    if (opened === null) throw new Error(`change not found: ${changeId}`);
    return opened.record.workingRevision;
  } finally {
    if (previousDataDir === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
    else process.env['SURDET_AGENT_DATA_DIR'] = previousDataDir;
  }
}

describe('authoring runtime parity', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps project.simulate and runtime.run-from on the shared growth fixture', async () => {
    const { root, data } = growthFixture(true);
    const previousDataDir = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    try {
      const service = new AuthoringService();
      const begun = await dispatchAuthoringCapability(context(root), 'change.begin', {
        intent: 'runtime parity',
        acceptanceCriteria: ['shared growth runtime'],
        initiator: 'automation',
      }, service);
      const changeId = (begun.value.result as { changeId: string }).changeId;

      const simulate = await dispatchAuthoringCapability(
        context(root, changeId),
        'project.simulate',
        { sceneId: 'prologue', seed: 0 },
        service,
      );
      const simulationResult = simulate.value.result as any;
      expect(simulationResult.report.status).toBe('passed');
      expect(simulationResult.report.paths[0].finalVariables).toMatchObject({ 'lynn.atk': 7, 'lynn.hp': 30 });

      const runtime = await dispatchAuthoringCapability(
        context(root, changeId),
        'runtime.run-from',
        { sceneId: 'prologue', choices: [], seed: 0 },
        service,
      );
      const runtimeResult = runtime.value.result as any;
      expect(runtimeResult.status).toBe('passed');
      expect(runtimeResult.finalVariables).toEqual(simulationResult.report.paths[0].finalVariables);
      expect(runtimeResult.finalVariables).toMatchObject({ 'lynn.atk': 7, 'lynn.hp': 30 });

      const trace = await dispatchAuthoringCapability(
        context(root, changeId),
        'runtime.read-trace',
        { traceId: runtimeResult.traceId, query: { op: 'exp' } },
        service,
      );
      expect((trace.value.result as any).events).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'instruction', source: expect.objectContaining({ op: 'exp', sceneId: 'prologue' }) }),
      ]));
    } finally {
      if (previousDataDir === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataDir;
    }
  });

  it('keeps missing GrowthSystem fail-loud without changing project files or workingRevision', async () => {
    const { root, data } = growthFixture(false);
    const previousDataDir = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    try {
      const service = new AuthoringService();
      const begun = await dispatchAuthoringCapability(context(root), 'change.begin', {
        intent: 'runtime fail-loud',
        acceptanceCriteria: ['missing growth fails'],
        initiator: 'automation',
      }, service);
      const changeId = (begun.value.result as { changeId: string }).changeId;
      const beforeTree = projectTree(root);
      const beforeWorkingRevision = await workingRevision(changeId, data);

      let failure: unknown;
      try {
        await dispatchAuthoringCapability(
          context(root, changeId),
          'runtime.run-from',
          { sceneId: 'prologue', choices: [], seed: 0 },
          service,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'RUNTIME_FAILED' });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/GrowthSystem/);

      expect(projectTree(root)).toEqual(beforeTree);
      expect(await workingRevision(changeId, data)).toBe(beforeWorkingRevision);
    } finally {
      if (previousDataDir === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataDir;
    }
  });
});
