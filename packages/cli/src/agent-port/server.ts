import { McpServer, type CallToolResult, type JsonSchemaType } from '@modelcontextprotocol/server';
import {
  AUTHORING_CONTRACT_VERSION,
  AUTHORING_ENVELOPE_SCHEMA_VERSION,
  AUTHORING_CAPABILITY_REGISTRY,
  createEnvelopeJsonSchema,
  createFailureEnvelope,
  createSuccessEnvelope,
  type AuthoringEnvelope,
  type JsonSchema,
} from '@surdet/authoring';
import { standardSchemaFromJson } from '../authoring/schema-validator.js';
import { isCapabilityAllowed } from './policy.js';
import { AgentPortSession } from './session.js';
import { projectCapabilityTool, type ProjectedTool } from './tool-projection.js';

const emptyInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const freshnessSchema: JsonSchema = {
  type: 'object',
  properties: {
    evidenceId: { type: 'string' },
    status: { enum: ['missing', 'fresh', 'stale', 'failed', 'incomplete'] },
    workingRevision: { type: 'integer' },
    currentWorkingRevision: { type: 'integer' },
  },
  required: ['status'],
  additionalProperties: false,
};

const sessionDescriptionSchema: JsonSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    startedAt: { type: 'string' },
    engineVersion: { type: 'string' },
    contractVersion: { const: AUTHORING_CONTRACT_VERSION },
    projectIdentity: { type: 'string' },
    projectName: { type: 'string' },
    projectRevision: { type: 'string' },
    policy: { enum: ['observe', 'stage', 'apply'] },
    activeChange: {
      type: 'object',
      properties: {
        changeId: { type: 'string' },
        status: { enum: ['OPEN', 'COMMITTED', 'ROLLED_BACK', 'STALE'] },
        baseRevision: { type: 'string' },
        workingRevision: { type: 'integer' },
      },
      required: ['changeId', 'status', 'baseRevision', 'workingRevision'],
      additionalProperties: false,
    },
    resumed: { type: 'boolean' },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mcpTool: { type: 'string' },
          availability: { enum: ['available', 'policy-blocked', 'state-blocked'] },
          reason: { type: 'string' },
        },
        required: ['id', 'mcpTool', 'availability'],
        additionalProperties: false,
      },
    },
    evidence: {
      type: 'object',
      properties: {
        validation: freshnessSchema,
        simulation: freshnessSchema,
        runtime: freshnessSchema,
      },
      additionalProperties: false,
    },
    manualRecoveryRequired: { type: 'boolean' },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'sessionId', 'startedAt', 'engineVersion', 'contractVersion', 'projectIdentity',
    'projectName', 'projectRevision', 'policy', 'resumed', 'capabilities', 'evidence',
    'manualRecoveryRequired', 'nextActions',
  ],
  additionalProperties: false,
};

function resultForEnvelope(envelope: AuthoringEnvelope<unknown>): CallToolResult {
  return {
    isError: !envelope.ok,
    content: [{
      type: 'text',
      text: envelope.ok
        ? `${envelope.capability} completed`
        : `${envelope.error.code}: ${envelope.error.message}`,
    }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

function sessionEnvelopeSchema(): JsonSchema {
  return createEnvelopeJsonSchema(sessionDescriptionSchema);
}

function registerProjectedTool(server: McpServer, session: AgentPortSession, tool: ProjectedTool, capability: (typeof AUTHORING_CAPABILITY_REGISTRY)[number]['id']): void {
  server.registerTool(tool.name, {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
  }, async (input) => resultForEnvelope(await session.invoke(capability, input as Record<string, unknown>)));
}

export function createAgentPortServer(session: AgentPortSession): McpServer {
  const server = new McpServer(
    { name: 'surdet-agent-port', version: '0.1.0' },
    { instructions: 'Inspect the session and capabilities before authoring. Use typed Surdet tools only. The server never grants shell, git, network, or project switching.' },
  );

  server.registerTool('surdet_session_describe', {
    title: 'Describe Agent Port session',
    description: 'Return the bound project, policy, active change, evidence freshness, and capability availability.',
    inputSchema: standardSchemaFromJson(emptyInputSchema),
    outputSchema: standardSchemaFromJson(sessionEnvelopeSchema()),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      const description = await session.describe();
      const envelope = createSuccessEnvelope({
        sessionId: description.sessionId,
        capability: 'session.describe',
        projectIdentity: description.projectIdentity,
        projectRevision: description.projectRevision,
        ...(description.activeChange === undefined ? {} : {
          changeId: description.activeChange.changeId,
          workingRevision: description.activeChange.workingRevision,
        }),
      }, description);
      return resultForEnvelope(envelope);
    } catch (error) {
      return resultForEnvelope(createFailureEnvelope({
        sessionId: session.sessionId,
        capability: 'session.describe',
        projectIdentity: session.projectIdentity,
        projectRevision: session.openedProjectRevision,
      }, error));
    }
  });

  for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
    if (!isCapabilityAllowed(session.policy, definition)) continue;
    registerProjectedTool(server, session, projectCapabilityTool(definition), definition.id);
  }
  return server;
}

export { sessionDescriptionSchema };
