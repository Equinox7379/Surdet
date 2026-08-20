import {
  createEnvelopeJsonSchema,
  nativeCapabilityToMcpTool,
  type AuthoringCapabilityId,
  type CapabilityDefinition,
} from '@surdet/authoring';
import { standardSchemaFromJson } from '../authoring/schema-validator.js';

export interface ProjectedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ReturnType<typeof standardSchemaFromJson>;
  outputSchema: ReturnType<typeof standardSchemaFromJson>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: false;
  };
}

export function projectCapabilityTool(definition: CapabilityDefinition<AuthoringCapabilityId>): ProjectedTool {
  const sideEffects = new Set(definition.sideEffects);
  return {
    name: nativeCapabilityToMcpTool(definition.id),
    title: definition.title,
    description: `${definition.purpose}\nPreconditions: ${definition.preconditions.join('; ')}`,
    inputSchema: standardSchemaFromJson(definition.inputSchema),
    outputSchema: standardSchemaFromJson(createEnvelopeJsonSchema(definition.outputSchema)),
    annotations: {
      readOnlyHint: [...sideEffects].every((item) => item === 'none' || item === 'project-read' || item === 'change-store-read'),
      destructiveHint: sideEffects.has('project-write') || definition.id === 'change.rollback',
      idempotentHint: definition.idempotency !== 'non-idempotent',
      openWorldHint: false,
    },
  };
}
