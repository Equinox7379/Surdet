import { fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { AuthoringOperationError, type JsonSchema } from '@surdet/authoring';

const validator = new AjvJsonSchemaValidator();

export function standardSchemaFromJson(schema: JsonSchema) {
  return fromJsonSchema(schema as JsonSchemaType, validator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function validateCapabilityInput(
  schema: JsonSchema,
  input: unknown,
): Promise<Record<string, unknown>> {
  const result = await standardSchemaFromJson(schema)['~standard'].validate(input);
  if (result.issues !== undefined) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'capability 输入不符合合同', {
      issues: result.issues,
    });
  }
  if (!isRecord(result.value)) throw new AuthoringOperationError('INVALID_REQUEST', 'capability 输入必须是 JSON object');
  return result.value;
}
