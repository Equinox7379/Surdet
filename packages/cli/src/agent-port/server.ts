import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  AUTHORING_CONTRACT_VERSION,
  AUTHORING_ENVELOPE_SCHEMA_VERSION,
  AUTHORING_CAPABILITY_REGISTRY,
  DELIVERY_CAPSULE_VERSION,
  HUMAN_WORKSPACE_SUMMARY_SCHEMA,
  PROJECT_MUTATION_NOTICE_SCHEMA,
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

const capsuleInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { label: { type: 'string', maxLength: 120 } },
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

const leaseSummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    state: { enum: ['free', 'owned', 'stale-candidate', 'corrupt', 'foreign-host'] },
    holder: {
      type: 'object',
      properties: {
        pid: { type: 'integer' },
        hostname: { type: 'string' },
        acquiredAt: { type: 'string' },
        heartbeatAt: { type: 'string' },
      },
      required: ['pid', 'hostname', 'acquiredAt', 'heartbeatAt'],
      additionalProperties: false,
    },
    retryAfterMs: { type: 'integer' },
    manualRecoveryRequired: { type: 'boolean' },
  },
  required: ['state', 'manualRecoveryRequired'],
  additionalProperties: false,
};

const journalSummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    recordState: { enum: ['missing', 'readable', 'corrupt', 'unsupported'] },
    status: { enum: ['STAGING', 'REPLACING', 'RECOVERED', 'RECOVERY_FAILED', 'COMMITTED'] },
    journalVersion: { type: 'integer' },
    errorCode: { type: 'string' },
    manualRecoveryRequired: { type: 'boolean' },
  },
  required: ['recordState', 'manualRecoveryRequired'],
  additionalProperties: false,
};

const recoverySummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    disposition: { enum: ['NO_ACTION', 'REOPEN_OPEN', 'ROLL_BACK_TO_BASE', 'FINALIZE_COMMITTED', 'MANUAL_RECOVERY_REQUIRED'] },
    journalStatus: { enum: ['STAGING', 'REPLACING', 'RECOVERED', 'RECOVERY_FAILED', 'COMMITTED'] },
    manualRecoveryRequired: { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['disposition', 'manualRecoveryRequired', 'reasons'],
  additionalProperties: false,
};

const capsuleCompositionSchema: JsonSchema = {
  type: 'object',
  properties: {
    eligibility: { enum: ['ready', 'unavailable'] },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          operationId: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['code', 'message'],
        additionalProperties: false,
      },
    },
    manifest: { type: 'object' },
  },
  required: ['eligibility', 'reasons'],
  additionalProperties: false,
};

const candidateCapsuleRefSchema: JsonSchema = {
  type: 'object',
  properties: {
    changeId: { type: 'string' },
    capsuleId: { type: 'string' },
    artifactSha256: { type: 'string' },
  },
  required: ['changeId', 'capsuleId', 'artifactSha256'],
  additionalProperties: false,
};

const integrationProvenanceSchema: JsonSchema = {
  type: 'object',
  properties: {
    planId: { type: 'string' },
    planFingerprint: { type: 'string' },
    executeOperationId: { type: 'string' },
    integrationChangeId: { type: 'string' },
    status: { enum: ['REPLAYING', 'READY', 'FAILED'] },
    nextOperationIndex: { type: 'integer' },
    operationCount: { type: 'integer' },
    sourceCapsules: { type: 'array', items: candidateCapsuleRefSchema },
    includedUnits: { type: 'array', items: { type: 'string' } },
    deduplicatedUnits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupId: { type: 'string' },
          retainedUnitId: { type: 'string' },
          provenanceUnitIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['groupId', 'retainedUnitId', 'provenanceUnitIds'],
        additionalProperties: false,
      },
    },
    conflictResolutions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          conflictId: { type: 'string' },
          resolution: { enum: ['choose-unit', 'exclude-all', 'regenerate-candidate'] },
          chosenUnitId: { type: 'string' },
          actor: { enum: ['human', 'review-agent'] },
          reason: { type: 'string' },
          decidedAt: { type: 'string' },
        },
        required: ['conflictId', 'resolution', 'actor', 'decidedAt'],
        additionalProperties: false,
      },
    },
    replayReceipts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          operationIndex: { type: 'integer' },
          integrationOperationId: { type: 'string' },
          sourceCapsule: candidateCapsuleRefSchema,
          sourceOperationId: { type: 'string' },
          resultFingerprint: { type: 'string' },
        },
        required: ['operationIndex', 'integrationOperationId', 'sourceCapsule', 'sourceOperationId'],
        additionalProperties: false,
      },
    },
    failure: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        operationIndex: { type: 'integer' },
        integrationOperationId: { type: 'string' },
      },
      required: ['code', 'message', 'operationIndex', 'integrationOperationId'],
      additionalProperties: false,
    },
    planAvailable: { type: 'boolean' },
  },
  required: [
    'planId', 'planFingerprint', 'executeOperationId', 'integrationChangeId', 'status',
    'nextOperationIndex', 'operationCount', 'sourceCapsules', 'includedUnits',
    'deduplicatedUnits', 'conflictResolutions', 'replayReceipts', 'planAvailable',
  ],
  additionalProperties: false,
};

const capsuleOutputSchema: JsonSchema = {
  type: 'object',
  properties: {
    capsuleVersion: { const: DELIVERY_CAPSULE_VERSION },
    capsuleId: { type: 'string' },
    generatedAt: { type: 'string' },
    sessionId: { type: 'string' },
    policy: { enum: ['observe', 'stage', 'apply'] },
    contractVersion: { const: AUTHORING_CONTRACT_VERSION },
    projectIdentity: { type: 'string' },
    baseProjectRevision: { type: 'string' },
    currentProjectRevision: { type: 'string' },
    changeId: { type: 'string' },
    changeStatus: { enum: ['OPEN', 'COMMITTED', 'ROLLED_BACK', 'STALE'] },
    workingRevision: { type: 'integer' },
    intent: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    operations: { type: 'array', items: {} },
    invocationSummary: {},
    objectDiff: {},
    causalImpact: { type: 'object', properties: { potentialImpact: { type: 'array', items: {} }, observedImpact: { type: 'array', items: {} } }, required: ['potentialImpact', 'observedImpact'], additionalProperties: false },
    validation: freshnessSchema,
    simulation: freshnessSchema,
    runtime: freshnessSchema,
    recovery: recoverySummarySchema,
    warnings: { type: 'array', items: {} },
    manualReviewRequired: { type: 'array', items: {} },
    projectMutation: {
      type: 'object',
      properties: {
        occurred: { type: 'boolean' },
        expectedByPolicy: { type: 'boolean' },
        beforeRevision: { type: 'string' },
        afterRevision: { type: 'string' },
      },
      required: ['occurred', 'expectedByPolicy', 'beforeRevision', 'afterRevision'],
      additionalProperties: false,
    },
    artifactIdentity: {
      type: 'object',
      properties: { path: { type: 'string' }, bytes: { type: 'integer' }, sha256: { type: 'string' } },
      required: ['path', 'bytes', 'sha256'],
      additionalProperties: false,
    },
    composition: capsuleCompositionSchema,
    integrationProvenance: integrationProvenanceSchema,
  },
  required: [
    'capsuleVersion', 'capsuleId', 'generatedAt', 'sessionId', 'policy', 'contractVersion',
    'projectIdentity', 'baseProjectRevision', 'currentProjectRevision', 'changeId', 'changeStatus',
    'acceptanceCriteria', 'operations', 'invocationSummary', 'objectDiff', 'causalImpact',
    'validation', 'simulation', 'runtime', 'recovery', 'warnings', 'manualReviewRequired', 'projectMutation',
    'artifactIdentity', 'composition',
  ],
  additionalProperties: false,
};

const sessionDescriptionSchema: JsonSchema = {
  type: 'object',
  properties: {
    humanWorkspace: HUMAN_WORKSPACE_SUMMARY_SCHEMA,
    projectMutation: PROJECT_MUTATION_NOTICE_SCHEMA,
    sessionId: { type: 'string' },
    startedAt: { type: 'string' },
    engineVersion: { type: 'string' },
    contractVersion: { const: AUTHORING_CONTRACT_VERSION },
    projectIdentity: { type: 'string' },
    projectName: { type: 'string' },
    projectRevision: { type: 'string' },
    policy: { enum: ['observe', 'stage', 'apply'] },
    review: {
      type: 'object',
      properties: {
        reviewState: { enum: ['unreviewed', 'awaiting-decision', 'human-reviewed', 'awaiting-approval', 'owner-approved', 'returned', 'stale'] },
        reviewId: { type: 'string' },
        resultReviewId: { type: 'string' },
        waitingFor: { enum: ['human-decision', 'human-approval'] },
      },
      required: ['reviewState'],
      additionalProperties: false,
    },
    activeChange: {
      type: 'object',
      properties: {
        changeId: { type: 'string' },
        status: { enum: ['OPEN', 'COMMITTED', 'ROLLED_BACK', 'STALE'] },
        baseRevision: { type: 'string' },
        workingRevision: { type: 'integer' },
        recordVersion: { type: 'integer' },
        integration: {
          type: 'object',
          properties: {
            planId: { type: 'string' },
            status: { enum: ['REPLAYING', 'READY', 'FAILED'] },
            nextOperationIndex: { type: 'integer' },
            operationCount: { type: 'integer' },
          },
          required: ['planId', 'status', 'nextOperationIndex', 'operationCount'],
          additionalProperties: false,
        },
      },
      required: ['changeId', 'status', 'baseRevision', 'workingRevision', 'recordVersion'],
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
    lease: {
      type: 'object',
      properties: {
        change: leaseSummarySchema,
        project: leaseSummarySchema,
      },
      required: ['change', 'project'],
      additionalProperties: false,
    },
    journal: journalSummarySchema,
    recoveryDisposition: { enum: ['NO_ACTION', 'REOPEN_OPEN', 'ROLL_BACK_TO_BASE', 'FINALIZE_COMMITTED', 'MANUAL_RECOVERY_REQUIRED'] },
    manualRecoveryRequired: { type: 'boolean' },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'sessionId', 'startedAt', 'engineVersion', 'contractVersion', 'projectIdentity',
    'projectName', 'projectRevision', 'policy', 'resumed', 'capabilities', 'evidence',
    'lease', 'journal', 'recoveryDisposition', 'manualRecoveryRequired', 'nextActions', 'humanWorkspace',
  ],
  additionalProperties: false,
};

function resultForEnvelope(envelope: AuthoringEnvelope<unknown>): CallToolResult {
  return {
    isError: !envelope.ok,
    content: [{
      type: 'text',
      text: JSON.stringify(envelope),
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
  if (session.policy !== 'observe' || session.canExposeDeliveryCapsule()) {
    server.registerTool('surdet_delivery_capsule', {
      title: 'Seal delivery capsule',
      description: 'Persist an immutable, evidence-backed delivery capsule for the bound change.',
      inputSchema: standardSchemaFromJson(capsuleInputSchema),
      outputSchema: standardSchemaFromJson(createEnvelopeJsonSchema(capsuleOutputSchema)),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (input) => {
      try {
        const payload = input as Record<string, unknown>;
        const label = typeof payload['label'] === 'string' ? payload['label'] : undefined;
        const capsule = await session.generateDeliveryCapsule(label);
        return resultForEnvelope(createSuccessEnvelope({
          sessionId: session.sessionId,
          capability: 'surdet_delivery_capsule',
          projectIdentity: capsule.projectIdentity,
          projectRevision: capsule.currentProjectRevision,
          changeId: capsule.changeId,
          workingRevision: capsule.workingRevision,
        }, capsule));
      } catch (error) {
        return resultForEnvelope(createFailureEnvelope({
          sessionId: session.sessionId,
          capability: 'surdet_delivery_capsule',
          projectIdentity: session.projectIdentity,
          projectRevision: session.openedProjectRevision,
          ...(session.lastChangeId === undefined ? {} : { changeId: session.lastChangeId }),
        }, error));
      }
    });
  }
  return server;
}

export { sessionDescriptionSchema };
