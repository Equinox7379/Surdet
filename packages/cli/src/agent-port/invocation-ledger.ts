import * as crypto from 'node:crypto';
import { stableStringify } from '@surdet/authoring';
import type { NodeChangeStore } from '../authoring/node-change-store.js';

export interface InvocationRecord {
  invocationId: string;
  sessionId: string;
  occurredAt: string;
  capability: string;
  operationId?: string;
  ok: boolean;
  errorCode?: string;
  projectRevisionBefore?: string;
  projectRevisionAfter?: string;
  workingRevisionBefore?: number;
  workingRevisionAfter?: number;
  inputSha256: string;
  evidenceIds: string[];
}

export interface InvocationRecordInput {
  sessionId: string;
  capability: string;
  operationId?: string;
  ok: boolean;
  errorCode?: string;
  projectRevisionBefore?: string;
  projectRevisionAfter?: string;
  workingRevisionBefore?: number;
  workingRevisionAfter?: number;
  input: unknown;
  evidenceIds: string[];
}

export function invocationInputSha256(input: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(input), 'utf8').digest('hex');
}

export async function recordInvocation(
  store: NodeChangeStore,
  changeId: string,
  input: InvocationRecordInput,
): Promise<InvocationRecord> {
  const record: InvocationRecord = {
    invocationId: crypto.randomUUID(),
    sessionId: input.sessionId,
    occurredAt: new Date().toISOString(),
    capability: input.capability,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    ok: input.ok,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(input.projectRevisionBefore === undefined ? {} : { projectRevisionBefore: input.projectRevisionBefore }),
    ...(input.projectRevisionAfter === undefined ? {} : { projectRevisionAfter: input.projectRevisionAfter }),
    ...(input.workingRevisionBefore === undefined ? {} : { workingRevisionBefore: input.workingRevisionBefore }),
    ...(input.workingRevisionAfter === undefined ? {} : { workingRevisionAfter: input.workingRevisionAfter }),
    inputSha256: invocationInputSha256(input.input),
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
  };
  await store.writeInvocation(changeId, record);
  return record;
}
