import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORING_CAPABILITY_REGISTRY,
  createEnvelopeJsonSchema,
  nativeCapabilityToMcpTool,
} from '@surdet/authoring';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';
import { allowedCapabilitiesForPolicy } from '../src/agent-port/policy.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { projectCapabilityTool } from '../src/agent-port/tool-projection.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-tools-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

function textContent(result: { content?: readonly unknown[] }): string {
  const text = result.content?.find((item): item is { type: 'text'; text: string } => (
    typeof item === 'object'
    && item !== null
    && (item as { type?: unknown }).type === 'text'
    && typeof (item as { text?: unknown }).text === 'string'
  ))?.text;
  if (text === undefined) throw new Error('MCP result did not contain a text content block');
  return text;
}

function textEnvelope(result: { content?: readonly unknown[] }): Record<string, unknown> {
  const text = textContent(result);
  return JSON.parse(text) as Record<string, unknown>;
}

async function sessionFor(policy: 'observe' | 'stage' | 'apply'): Promise<AgentPortSession> {
  const root = makeProject(policy);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-tools-data-'));
  temporaryRoots.push(data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy });
}

async function connected(policy: 'observe' | 'stage' | 'apply'): Promise<{ session: AgentPortSession; client: Client; server: ReturnType<typeof createAgentPortServer> }> {
  const session = await sessionFor(policy);
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agent-port-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { session, client, server };
}

describe('Surdet Agent Port MCP tool projection', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('projects each registry definition into one typed MCP tool', () => {
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      const tool = projectCapabilityTool(definition);
      expect(tool.name).toBe(nativeCapabilityToMcpTool(definition.id));
      expect(tool.title).toBe(definition.title);
      expect(tool.description).toContain(definition.purpose);
      expect((tool.inputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' })).toEqual(definition.inputSchema);
      expect((tool.outputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' })).toEqual(createEnvelopeJsonSchema(definition.outputSchema));
      expect(tool.annotations.openWorldHint).toBe(false);
    }
    expect((standardSchemaFromJson(AUTHORING_CAPABILITY_REGISTRY[0]!.inputSchema)['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' })).toEqual(
      AUTHORING_CAPABILITY_REGISTRY[0]!.inputSchema,
    );

    const sceneCreate = projectCapabilityTool(AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'scene.create')!);
    const sceneCreateSchema = (sceneCreate.inputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' });
    const instruction = sceneCreateSchema.properties.blocks.items.oneOf.find((schema: any) => schema.properties?.kind?.const === 'instruction');
    expect(instruction.properties.name.description).toContain("exactly 'timeline'");

    const runFrom = projectCapabilityTool(AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'runtime.run-from')!);
    const runFromSchema = (runFrom.inputSchema['~standard'].jsonSchema as any).input({ target: 'draft-2020-12' });
    expect(runFromSchema.properties.label.description).toContain('in-scene @label');
  });

  it.each([
    ['observe', allowedCapabilitiesForPolicy('observe')],
    ['stage', allowedCapabilitiesForPolicy('stage')],
    ['apply', allowedCapabilitiesForPolicy('apply')],
  ] as const)('lists exactly the registry-derived %s policy tools plus session describe', async (policy, allowed) => {
    const { session, client, server } = await connected(policy);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    const capsuleExposed = policy !== 'observe';
    expect(names).toHaveLength(allowed.length + 1 + (capsuleExposed ? 1 : 0));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('surdet_session_describe');
    if (capsuleExposed) expect(names).toContain('surdet_delivery_capsule');
    for (const id of allowed) expect(names).toContain(nativeCapabilityToMcpTool(id));
    if (policy === 'observe') {
      expect(names).not.toContain('surdet_change_begin');
      expect(names).not.toContain('surdet_runtime_run_from');
      expect(names).not.toContain('surdet_change_rollback');
      expect(names).not.toContain('surdet_change_commit');
    }
    expect(names).toContain(nativeCapabilityToMcpTool('change.recovery.inspect'));
    if (policy === 'stage') {
      expect(names).not.toContain('surdet_change_commit');
      expect(names).not.toContain(nativeCapabilityToMcpTool('change.recovery.execute'));
      expect(names).toHaveLength(22);
    }
    if (policy === 'apply') {
      expect(names).toContain(nativeCapabilityToMcpTool('change.recovery.execute'));
      expect(names).toHaveLength(24);
    }
    const described = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
    expect(described.isError).not.toBe(true);
    expect((described.structuredContent as any).ok).toBe(true);
    const capabilities = await client.callTool({ name: 'surdet_capabilities_describe', arguments: {} });
    expect(capabilities.isError).not.toBe(true);
    expect((capabilities.structuredContent as any).ok).toBe(true);
    expect((capabilities.structuredContent as any).result.capabilities).toHaveLength(22);
    if (policy === 'stage') {
      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: {} });
      expect(begun.isError).not.toBe(true);
      const capsule = await client.callTool({ name: 'surdet_delivery_capsule', arguments: { label: 'tool projection test' } });
      expect(capsule.isError).not.toBe(true);
      expect((capsule.structuredContent as any).ok).toBe(true);
      expect((capsule.structuredContent as any).result.artifactIdentity.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    await client.close();
    await server.close();
    await session.close();
  });

  it('returns structured Surdet failures as tool errors and keeps protocol errors distinct', async () => {
    const { session, client, server } = await connected('stage');
    const failed = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:missing' } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toEqual(expect.objectContaining({ ok: false }));
    expect((failed.structuredContent as any).error.code).toBe('OBJECT_NOT_FOUND');
    await expect(client.callTool({ name: 'surdet_not_registered', arguments: {} })).rejects.toThrow();
    await client.close();
    await server.close();
    await session.close();
  });

  it('keeps the complete success and failure envelope visible to text-only MCP hosts', async () => {
    const { session, client, server } = await connected('stage');
    try {
      const mismatches: string[] = [];
      const compareTextEnvelope = (label: string, result: any): void => {
        try {
          expect(textContent(result)).toBe(JSON.stringify(result.structuredContent));
          expect(textEnvelope(result)).toEqual(result.structuredContent);
        } catch (error) {
          mismatches.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };

      const described = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
      compareTextEnvelope('session.describe success', described);

      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: {} });
      compareTextEnvelope('change.begin success', begun);
      const begunEnvelope = textEnvelope(begun);
      if (typeof begunEnvelope.changeId !== 'string' || begunEnvelope.changeId.length === 0) {
        mismatches.push('change.begin success: text envelope did not expose a real changeId');
      }

      const recovery = await client.callTool({ name: 'surdet_change_recovery_inspect', arguments: {} });
      compareTextEnvelope('change.recovery.inspect success', recovery);
      if (textEnvelope(recovery).ok !== true) mismatches.push('change.recovery.inspect success: text envelope was not a success envelope');

      const failed = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:missing' } });
      compareTextEnvelope('object.inspect failure', failed);
      if (textEnvelope(failed).ok !== false) mismatches.push('object.inspect failure: text envelope was not a failure envelope');

      expect(mismatches).toEqual([]);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });

  it('preserves every legal object inspection details shape over MCP', async () => {
    const { session, client, server } = await connected('stage');
    try {
      const begun = await client.callTool({ name: 'surdet_change_begin', arguments: { intent: 'inspect timeline details', acceptanceCriteria: ['structured output'], initiator: 'external-agent' } });
      expect(begun.isError).not.toBe(true);

      const entrySceneInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'config:entryScene' } });
      const ordinaryObjectInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'scene:start' } });
      const created = await client.callTool({
        name: 'surdet_timeline_create',
        arguments: {
          operationId: 'op-mcp-timeline-details',
          timelineId: 'mcp_timeline_details',
          definition: {
            version: 1,
            id: 'mcp_timeline_details',
            durationMs: 100,
            tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] }],
          },
        },
      });
      expect(created.isError).not.toBe(true);
      const timelineInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'timeline:mcp_timeline_details' } });

      expect(entrySceneInspected.isError).not.toBe(true);
      expect((entrySceneInspected.structuredContent as any).ok).toBe(true);
      expect((entrySceneInspected.structuredContent as any).result.details).toBe('start');

      expect(ordinaryObjectInspected.isError).not.toBe(true);
      expect((ordinaryObjectInspected.structuredContent as any).ok).toBe(true);
      expect((ordinaryObjectInspected.structuredContent as any).result).not.toHaveProperty('details');

      expect(timelineInspected.isError).not.toBe(true);
      expect((timelineInspected.structuredContent as any).ok).toBe(true);
      expect((timelineInspected.structuredContent as any).result.details.tracks).toHaveLength(1);
      expect((timelineInspected.structuredContent as any).result.details.tracks[0].cues).toHaveLength(1);
      expect((timelineInspected.structuredContent as any).result.childRefs).toEqual([
        'timeline:mcp_timeline_details/track:0',
      ]);

      const trackInspected = await client.callTool({ name: 'surdet_object_inspect', arguments: { objectRef: 'timeline:mcp_timeline_details/track:0' } });
      expect(trackInspected.isError).not.toBe(true);
      expect((trackInspected.structuredContent as any).result.childRefs).toEqual([
        'timeline:mcp_timeline_details/track:0/cue:0',
      ]);
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });
});
