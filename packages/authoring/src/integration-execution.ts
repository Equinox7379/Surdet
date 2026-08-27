import { AuthoringOperationError, stableStringify, type ChangeSession, type ChangeRecord } from './change-session.js';
import type { PlannedReplayOperation } from './integration-plan.js';
import type { TextHasher } from './contracts.js';
import type { IntegrationReviewBinding } from './review-receipts.js';
import type { ReviewEvidenceBinding } from './review-contracts.js';
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
import { fingerprintWorkingObject } from './working-object-fingerprint.js';

export interface IntegrationReplayReceipt {
  operationIndex: number;
  integrationOperationId: string;
  sourceCapsule: import('./composition-contracts.js').CandidateCapsuleRef;
  sourceOperationId: string;
  resultFingerprint?: string;
}

export interface IntegrationReviewMetadata {
  binding: IntegrationReviewBinding;
  resultReview?: {
    reviewId: string;
    resultTreeSha256: string;
    diffFingerprint: string;
    evidence: ReviewEvidenceBinding;
    workingRevision: number;
  };
  approval?: {
    approvalId: string;
    approvalFingerprint: string;
    bindingFingerprint: string;
  };
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
  /** 旧 Wave 5 metadata 可读；execute/prepare-result 后一定补齐。 */
  review?: IntegrationReviewMetadata;
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

import {
  updateIntegrationMetadata,
  type BeginChangeOptions,
} from './change-session.js';
import type { IntegrationPlan } from './integration-plan.js';

export type { BeginChangeOptions, IntegrationPlan };


/** Step 4：这些错误不标 FAILED，原样抛出（after-refresh）。 */
const TRANSIENT_CODES = new Set(['CHANGE_RECORD_CONFLICT', 'CHANGE_BUSY', 'PROJECT_BUSY', 'LEASE_CORRUPT']);

function errorCodeOf(error: unknown): string {
  return error instanceof AuthoringOperationError ? error.code : 'COMPOSITION_REPLAY_FAILED';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 执行/恢复一个 OPEN integration change：
 * - 从 metadata.nextOperationIndex 续跑；同 integrationOperationId 由 runOperation 幂等回放，不重复 mutation；
 * - 每项双阶段：领域结果先经 runOperation 持久化，receipt 再以 recordVersion CAS 补写；
 * - 领域失败 → FAILED 持久化并抛 COMPOSITION_REPLAY_FAILED；瞬态冲突原样抛出；
 * - 全部完成后逐项核对 plan.dryRun.finalObjectFingerprints，匹配才 CAS 为 READY。
 */
export async function executeIntegrationReplay(
  change: ChangeSession,
  plan: IntegrationPlan,
  hasher: TextHasher,
): Promise<IntegrationMetadata> {
  const current = change.record.integration;
  if (current === undefined) {
    throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', 'record 缺少 integration metadata');
  }
  if (current.planId !== plan.planId || current.planFingerprint !== plan.planFingerprint) {
    throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', 'plan 与 integration change 不匹配', {
      expectedPlanId: current.planId,
      actualPlanId: plan.planId,
    });
  }
  if (change.record.status !== 'OPEN') {
    throw new AuthoringOperationError('CHANGE_NOT_OPEN', `integration change 状态为 ${change.record.status}`);
  }

  const planReview = plan.review ?? { reviewState: 'unreviewed' as const };
  let metadata: IntegrationMetadata = current;
  if (metadata.review === undefined) {
    metadata = await updateIntegrationMetadata(change, (item) => ({
      ...item,
      review: { binding: planReview },
    }));
  } else if (stableStringify(metadata.review.binding) !== stableStringify(planReview)) {
    throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', 'plan 与 integration review binding 不匹配');
  }
  for (let index = metadata.nextOperationIndex; index < plan.replayOperations.length; index += 1) {
    const operation = plan.replayOperations[index]!;
    try {
      await replayCompositionOperation(change, operation, hasher);
    } catch (error) {
      const code = errorCodeOf(error);
      if (TRANSIENT_CODES.has(code)) throw error;
      const failure = {
        code,
        message: messageOf(error),
        operationIndex: index,
        integrationOperationId: operation.integrationOperationId,
      };
      await updateIntegrationMetadata(change, (m) => ({ ...m, status: 'FAILED', failure }));
      throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', failure.message, {
        planId: plan.planId,
        operationIndex: index,
        originalCode: code,
      });
    }
    // receipt CAS：不复制完整 result，只保存来源、序号与可选结果指纹。
    const result = change.record.operations[operation.integrationOperationId]?.result;
    const resultFingerprint = isRecord(result) && typeof result['fingerprint'] === 'string'
      ? result['fingerprint']
      : (await fingerprintWorkingObject(change.record.workingFiles, operation.primaryObject, hasher)).fingerprint;
    const receipt: IntegrationReplayReceipt = {
      operationIndex: index,
      integrationOperationId: operation.integrationOperationId,
      sourceCapsule: operation.sourceCapsule,
      sourceOperationId: operation.sourceOperationId,
      ...(resultFingerprint === undefined ? {} : { resultFingerprint }),
    };
    metadata = await updateIntegrationMetadata(change, (m) => ({
      ...m,
      status: 'REPLAYING',
      nextOperationIndex: index + 1,
      replayedOperations: [...m.replayedOperations.filter((item) => item.integrationOperationId !== receipt.integrationOperationId), receipt],
    }));
  }

  if (metadata.status !== 'READY') {
    // Step 5：逐项核对 final fingerprints，全部匹配才 CAS READY。
    for (const [objectRef, expected] of Object.entries(plan.dryRun.finalObjectFingerprints)) {
      try {
        const actual = await fingerprintWorkingObject(change.record.workingFiles, objectRef, hasher);
        if (actual.fingerprint === expected) continue;
        throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `final fingerprint mismatch：${objectRef}`);
      } catch (error) {
        const failure = {
          code: errorCodeOf(error),
          message: messageOf(error),
          operationIndex: Math.max(0, metadata.nextOperationIndex - 1),
          integrationOperationId: metadata.replayedOperations.at(-1)?.integrationOperationId ?? '',
        };
        await updateIntegrationMetadata(change, (m) => ({ ...m, status: 'FAILED', failure }));
        throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', failure.message, { planId: plan.planId });
      }
    }
    metadata = await updateIntegrationMetadata(change, (m) => ({ ...m, status: 'READY' }));
  }
  return metadata;
}
