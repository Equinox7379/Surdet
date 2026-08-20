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
    if (policy === 'stage') {
      expect(names).not.toContain('surdet_change_commit');
      expect(names).toHaveLength(21);
    }
    if (policy === 'apply') expect(names).toHaveLength(22);
    const described = await client.callTool({ name: 'surdet_session_describe', arguments: {} });
    expect(described.isError).not.toBe(true);
    expect((described.structuredContent as any).ok).toBe(true);
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
});
