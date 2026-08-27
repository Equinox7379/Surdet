import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getCapabilityDefinition,
  type AuthoringCapabilityId,
} from '@surdet/authoring';
import { dispatchAuthoringCapability, type InvocationContext } from '../src/authoring/authoring-dispatcher.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';

const temporaryRoots: string[] = [];

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-output-contract-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-output-contract-data-'));
  temporaryRoots.push(root, data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'assets', 'avatar'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({
    entryScene: 'start',
    variables: { trust: { type: 'number', initial: 0 } },
    characters: { lynn: { name: '凛', avatar: 'lynn' } },
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), [
    '@scene start',
    '@set trust = 1',
    '凛：开始。',
    '@end',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'assets', 'avatar', 'lynn.svg'), '<svg></svg>', 'utf8');
  return root;
}

function context(root: string, policy: 'observe' | 'stage', changeId?: string): InvocationContext {
  return {
    sessionId: 'output-contract-scan',
    policy,
    projectRoot: root,
    ...(changeId === undefined ? {} : { activeChangeId: changeId }),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('Agent Port output-schema conformance', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('scans every formal-path result and reports all registry mismatches together', async () => {
    const root = makeProject();
    const service = new AuthoringService();
    const observed: string[] = [];
    const mismatches: string[] = [];

    const scan = async (
      capability: AuthoringCapabilityId,
      variant: string,
      invocationContext: InvocationContext,
      input: Record<string, unknown>,
    ): Promise<unknown> => {
      const caseId = `${capability} [${variant}]`;
      try {
        const dispatched = await dispatchAuthoringCapability(invocationContext, capability, input, service);
        const result = dispatched.value.result;
        observed.push(caseId);
        const checked = await standardSchemaFromJson(getCapabilityDefinition(capability).outputSchema)['~standard'].validate(result);
        if (checked.issues !== undefined) {
          const resultKeys = typeof result === 'object' && result !== null && !Array.isArray(result)
            ? Object.keys(result).sort().join(',')
            : typeof result;
          mismatches.push(`${caseId}: resultKeys=[${resultKeys}]; schemaIssues=${JSON.stringify(checked.issues)}`);
        }
        return result;
      } catch (error) {
        mismatches.push(`${caseId}: invocation failed: ${errorText(error)}`);
        return undefined;
      }
    };

    await scan('capabilities.describe', 'unbound', context(root, 'observe'), {});
    await scan('project.inspect', 'project', context(root, 'observe'), {});
    await scan('project.assets', 'project', context(root, 'observe'), {});
    await scan('project.validate', 'project', context(root, 'observe'), {});
    await scan('project.simulate', 'project', context(root, 'observe'), {});
    await scan('object.inspect', 'string-details', context(root, 'observe'), { objectRef: 'config:entryScene' });
    await scan('object.inspect', 'omitted-details', context(root, 'observe'), { objectRef: 'scene:start' });

    const begun = await scan('change.begin', 'working-setup', context(root, 'stage'), {
      intent: 'scan output contracts',
      acceptanceCriteria: ['all formal capability results conform'],
      initiator: 'external-agent',
    });
    const changeId = typeof (begun as { changeId?: unknown } | undefined)?.changeId === 'string'
      ? (begun as { changeId: string }).changeId
      : undefined;
    if (changeId === undefined) mismatches.push('change.begin [working-setup]: result.changeId was not a string');
    const working = context(root, 'stage', changeId);

    await scan('change.recovery.inspect', 'working-no-journal', working, {});

    await scan('variable.ensure', 'working-setup', working, {
      operationId: 'op-contract-route',
      name: 'agent.route',
      type: 'string',
      initial: '',
    });
    const character = await scan('object.inspect', 'character-object-details', working, { objectRef: 'character:lynn' });
    const characterFingerprint = (character as { fingerprint?: unknown } | undefined)?.fingerprint;
    if (typeof characterFingerprint !== 'string') mismatches.push('object.inspect [character-object-details]: result.fingerprint was not a string');
    await scan('character.ensure', 'working-setup', working, {
      operationId: 'op-contract-character',
      id: 'agent_guide',
      name: '引路人',
      avatar: 'lynn',
      expectedFingerprint: characterFingerprint,
    });

    const timeline = await scan('timeline.create', 'working-setup', working, {
      operationId: 'op-contract-timeline',
      timelineId: 'contract_timeline',
      definition: {
        version: 1,
        id: 'contract_timeline',
        durationMs: 100,
        tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] }],
      },
    });
    const timelineFingerprint = (timeline as { fingerprint?: unknown } | undefined)?.fingerprint;
    if (typeof timelineFingerprint !== 'string') mismatches.push('timeline.create [working-setup]: result.fingerprint was not a string');
    await scan('timeline.patch', 'working-setup', working, {
      operationId: 'op-contract-timeline-patch',
      timelineId: 'contract_timeline',
      patch: { kind: 'addTrack', expectedFingerprint: timelineFingerprint, trackKind: 'background' },
    });
    await scan('object.inspect', 'nested-object-details', working, { objectRef: 'timeline:contract_timeline' });

    await scan('scene.create', 'working-setup', working, {
      operationId: 'op-contract-scene',
      sceneId: 'contract_entry',
      blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', speaker: 'agent_guide', value: '合同扫描。' }],
    });
    const entry = await scan('object.inspect', 'working-entry-string', working, { objectRef: 'config:entryScene' });
    const entryFingerprint = (entry as { fingerprint?: unknown } | undefined)?.fingerprint;
    if (typeof entryFingerprint !== 'string') mismatches.push('object.inspect [working-entry-string]: result.fingerprint was not a string');
    await scan('project.entry-scene.set', 'working-setup', working, {
      operationId: 'op-contract-entry-scene',
      sceneId: 'contract_entry',
      expectedFingerprint: entryFingerprint,
    });

    await scan('project.validate', 'working', working, {});
    await scan('project.simulate', 'working', working, { sceneId: 'start' });
    const runtime = await scan('runtime.run-from', 'working', working, { sceneId: 'start', choices: [] });
    const traceId = (runtime as { traceId?: unknown } | undefined)?.traceId;
    if (typeof traceId !== 'string') mismatches.push('runtime.run-from [working]: result.traceId was not a string');
    await scan('runtime.read-trace', 'working-nested-events', working, { traceId, query: {} });
    await scan('change.diff', 'working', working, {});
    await scan('change.commit', 'formal-apply-path', working, {});

    expect(observed).toEqual(expect.arrayContaining([
      'project.inspect [project]',
      'project.assets [project]',
      'project.validate [project]',
      'project.validate [working]',
      'project.simulate [project]',
      'project.simulate [working]',
      'runtime.run-from [working]',
      'runtime.read-trace [working-nested-events]',
      'change.diff [working]',
      'change.recovery.inspect [working-no-journal]',
      'object.inspect [string-details]',
      'object.inspect [nested-object-details]',
      'object.inspect [omitted-details]',
    ]));
    expect(mismatches).toEqual([]);
  }, 30000);
});

describe('Wave 5 composition output-schema conformance', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('validates real dispatcher results for all four composition capabilities', async () => {
    const root = makeProject();
    const service = new AuthoringService();

    // 封存两个真实 capsule（复用 stage 会话全证据链；必须经 session.invoke 以产生
    // invocation ledger，否则 manifest 因 INVOCATION_FACT_MISSING 而 unavailable）。
    const seal = async (name: string, run: (session: Awaited<ReturnType<typeof openAgentPortSession>>) => Promise<void>): Promise<{ changeId: string; capsuleId: string; artifactSha256: string }> => {
      const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
      try {
        expect((await session.invoke('change.begin', {
          intent: `wave5 contract ${name}`, initiator: 'external-agent',
        })).ok).toBe(true);
        await run(session);
        expect((await session.invoke('project.validate', {})).ok).toBe(true);
        expect((await session.invoke('project.simulate', {})).ok).toBe(true);
        expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
        expect((await session.invoke('change.diff', {})).ok).toBe(true);
        const { generateDeliveryCapsule } = await import('../src/agent-port/delivery-capsule.js');
        const capsule = await generateDeliveryCapsule(session);

        return { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 };
      } finally {
        await session.close();
      }
    };

    const first = await seal('a', async (working) => {
      expect((await working.invoke('scene.create',
        {
          operationId: 'op-contract-cmp-alpha', sceneId: 'alpha',
          blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', speaker: 'lynn', value: 'Contract alpha.' }],
        })).ok).toBe(true);
    });
    void first;
    const second = await seal('b', async (working) => {
      expect((await working.invoke('variable.ensure',
        { operationId: 'op-contract-cmp-flag', name: 'flag.contract', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const candidateRefs = [first, second].map((ref) => ({
      changeId: ref.changeId, capsuleId: ref.capsuleId, artifactSha256: ref.artifactSha256,
    }));

    const mismatches: string[] = [];
    const scan = async (capability: AuthoringCapabilityId, input: Record<string, unknown>): Promise<unknown> => {
      const dispatched = await dispatchAuthoringCapability(context(root, 'observe'), capability, input, service);
      const result = dispatched.value.result;
      const checked = await standardSchemaFromJson(getCapabilityDefinition(capability).outputSchema)['~standard'].validate(result);
      if (checked.issues !== undefined) {
        mismatches.push(`${capability}: ${JSON.stringify(checked.issues)}`);
      }
      return result;
    };

    const comparedScan = await scan('composition.compare', { candidateRefs }) as {
      comparisonFingerprint: string; units: Array<{ unitId: string }>;
    };
    const planned = await scan('composition.plan', {
      candidateRefs,
      comparisonFingerprint: comparedScan.comparisonFingerprint,
      selectedUnitIds: comparedScan.units.map((unit) => unit.unitId),
      conflictResolutions: [],
      reason: 'contract scan',
    }) as {
      planId: string; artifactSha256: string; dryRunStatus: string;
    };
    expect(planned.dryRunStatus).toBe('passed');
    await scan('composition.inspect', { planId: planned.planId, artifactSha256: planned.artifactSha256 });
    const executed = await scan('composition.execute', {
      planId: planned.planId,
      artifactSha256: planned.artifactSha256,
      executeOperationId: 'exec-contract-1',
    }) as { integrationChangeId: string; status: string };
    expect(executed.status).toBe('READY');

    // annotations 公式断言。
    const { projectCapabilityTool } = await import('../src/agent-port/tool-projection.js');
    const { AUTHORING_CAPABILITY_REGISTRY, nativeCapabilityToMcpTool } = await import('@surdet/authoring');
    for (const id of ['composition.compare', 'composition.plan', 'composition.inspect', 'composition.execute'] as const) {
      const definition = AUTHORING_CAPABILITY_REGISTRY.find((item) => item.id === id)!;
      const tool = projectCapabilityTool(definition);
      expect(tool.name).toBe(nativeCapabilityToMcpTool(id));
      const readOnly = tool.annotations.readOnlyHint;
      if (id === 'composition.plan' || id === 'composition.execute') {
        expect(readOnly, id).toBe(false);
        expect(tool.annotations.destructiveHint, id).toBe(false);
      } else {
        expect(readOnly, id).toBe(true);
      }
      if (id === 'composition.execute') {
        expect(tool.annotations.idempotentHint, id).toBe(true);
      }
    }

    expect(mismatches).toEqual([]);
  }, 30000);
});

describe('Wave 6 human review output contracts', () => {
  it('publishes strict review tool shapes and no agent-side human receipt writers', () => {
    const reviewCases = [
      ['review.prepare-comparison', ['candidateRefs']],
      ['review.inspect-decision', ['reviewId', 'decisionId']],
      ['review.prepare-result', ['planId', 'artifactSha256', 'changeId']],
      ['review.inspect-approval', ['resultReviewId', 'approvalId']],
    ] as const;
    for (const [id, keys] of reviewCases) {
      const definition = getCapabilityDefinition(id);
      expect(definition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(Object.keys(definition.inputSchema.properties as Record<string, unknown>).sort()).toEqual([...keys].sort());
      const outputSchemas = Array.isArray(definition.outputSchema.oneOf)
        ? definition.outputSchema.oneOf as Array<Record<string, unknown>>
        : [definition.outputSchema];
      for (const outputSchema of outputSchemas) {
        expect(outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      }
      expect(JSON.stringify(definition.inputSchema)).not.toMatch(/absolutePath|receipt|actor|content/);
    }
    const plan = getCapabilityDefinition('composition.plan').inputSchema;
    expect(plan.oneOf).toHaveLength(2);
    expect((plan.oneOf as any[])[1].properties).toHaveProperty('reviewDecision');
    expect((plan.oneOf as any[])[1].properties).not.toHaveProperty('selectedUnitIds');
    expect((plan.oneOf as any[])[1].properties).not.toHaveProperty('actor');
  });
});
