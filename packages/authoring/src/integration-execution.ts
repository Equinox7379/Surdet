import { AuthoringOperationError, type ChangeSession, type ChangeRecord } from './change-session.js';
import type { PlannedReplayOperation } from './integration-plan.js';
import type { TextHasher } from './contracts.js';
import {
  applySceneCreate,
  applyScenePatch,
  ensureVariable,
} from './operations.js';
import {
  applyCharacterEnsure,
  applyCharacterRemove,
  applyEntrySceneSet,
} from './config-operations.js';
import { applyTimelineCreate, applyTimelinePatch } from './timeline-operations.js';

export interface IntegrationReplayReceipt {
  operationIndex: number;
  integrationOperationId: string;
  sourceCapsule: import('./composition-contracts.js').CandidateCapsuleRef;
  sourceOperationId: string;
  resultFingerprint?: string;
}

export interface IntegrationMetadata {
  planId: string;
  planFingerprint: string;
  executeOperationId: string;
  sourceCapsules: import('./composition-contracts.js').CandidateCapsuleRef[];
  includedUnitIds: string[];
  deduplicatedUnits: import('./integration-plan.js').IdenticalUnitResolution[];
  conflictResolutions: import('./integration-plan.js').ConflictResolution[];
  status: 'REPLAYING' | 'READY' | 'FAILED';
  nextOperationIndex: number;
  replayedOperations: IntegrationReplayReceipt[];
  failure?: {
    code: string;
    message: string;
    operationIndex: number;
    integrationOperationId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 八项 capability 到既有 apply 函数的穷尽 switch。
 * 只把 operationId 替换为 integrationOperationId；normalizedInput 原样进入既有类型化实现。
 * 输入的 schema 严格校验在 CLI 边界（AJV validateCapabilityInput）完成；本层做结构防御。
 */
export async function replayCompositionOperation(
  change: ChangeSession,
  operation: PlannedReplayOperation,
  hasher: TextHasher,
): Promise<unknown> {
  if (!isRecord(operation.normalizedInput)) {
    throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', `replay normalizedInput 不是对象：${operation.integrationOperationId}`);
  }
  const replayInput: Record<string, unknown> = {
    ...operation.normalizedInput,
    // 只替换 operationId：integration ledger 与 resume 都以 integrationOperationId 为锚。
    operationId: operation.integrationOperationId,
  };
  switch (operation.capabilityId) {
    case 'scene.create':
      return applySceneCreate(change, replayInput as never);
    case 'scene.patch':
      return applyScenePatch(change, replayInput as never);
    case 'variable.ensure':
      return ensureVariable(change, replayInput as never);
    case 'character.ensure':
      return applyCharacterEnsure(change, replayInput as never, hasher);
    case 'character.remove':
      return applyCharacterRemove(change, replayInput as never, hasher);
    case 'timeline.create':
      return applyTimelineCreate(change, replayInput as never, hasher);
    case 'timeline.patch':
      return applyTimelinePatch(change, replayInput as never, hasher);
    case 'project.entry-scene.set':
      return applyEntrySceneSet(change, replayInput as never, hasher);
    default:
      throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', `不支持的 composition capability：${String(operation.capabilityId)}`);
  }
}
