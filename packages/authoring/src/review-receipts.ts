import {
  approvalBindingFingerprintOf,
  AuthoringOperationError,
  stableStringify,
  updateIntegrationMetadata,
  type ChangeSession,
} from './change-session.js';
import type {
  CandidateCapsuleRef,
} from './composition-contracts.js';
import type { ConflictResolutionInput } from './integration-plan.js';
import type { TextHasher } from './contracts.js';
import type {
  FinalApprovalReceipt,
  HumanReviewProjection,
  ResultReviewCurrentFacts,
  ReturnRequestReceipt,
  ReviewConflict,
  VerifiedReviewApproval,
} from './review-contracts.js';
import type { IntegrationMetadata } from './integration-execution.js';
import { decisionFingerprintV2Of, type ComparisonDecisionReceiptV2 } from './review-decision-receipt-v2.js';
import { isReviewDecisionIntent, reviewDecisionPreviewFingerprintOf } from './review-decision-preview.js';
import { isReviewProjectionV2Fields, resultReviewFingerprintOf } from './review-projection.js';

export interface ComparisonDecisionReceipt {
  receiptVersion: '1.0.0';
  decisionId: string;
  reviewId: string;
  comparisonFingerprint: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  candidateRefs: CandidateCapsuleRef[];
  selectedUnitIds: string[];
  conflictResolutions: Array<{
    conflictId: string;
    resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
    chosenUnitId?: string;
  }>;
  reviewerChannel: 'surdet-editor-local';
  decidedAt: string;
  decisionFingerprint: string;
}

export type AnyComparisonDecisionReceipt = ComparisonDecisionReceipt | ComparisonDecisionReceiptV2;

export type IntegrationReviewBinding =
  | { reviewState: 'unreviewed' }
  | {
      reviewState: 'human-reviewed';
      reviewId: string;
      decisionId: string;
      decisionFingerprint: string;
    };

export interface VerifiedComparisonDecision {
  receipt: AnyComparisonDecisionReceipt;
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  review: Extract<IntegrationReviewBinding, { reviewState: 'human-reviewed' }>;
}

export interface DecisionPlanSelection {
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  review: Extract<IntegrationReviewBinding, { reviewState: 'human-reviewed' }>;
}

function invalid(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_INVALID', message);
}

function stale(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_STALE', message);
}

function returned(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_RETURNED', message);
}

function receiptIdentityMismatch(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function finalApprovalReceipt(value: unknown): value is FinalApprovalReceipt {
  if (!isRecord(value) || !isRecord(value['evidence'])) return false;
  const evidence = value['evidence'];
  return value['receiptVersion'] === '1.0.0'
    && typeof value['approvalId'] === 'string'
    && typeof value['resultReviewId'] === 'string'
    && typeof value['decisionFingerprint'] === 'string'
    && typeof value['planId'] === 'string'
    && typeof value['planFingerprint'] === 'string'
    && typeof value['integrationChangeId'] === 'string'
    && typeof value['workingRevision'] === 'number'
    && Number.isInteger(value['workingRevision'])
    && typeof value['projectIdentity'] === 'string'
    && typeof value['expectedProjectRevision'] === 'string'
    && typeof value['diffFingerprint'] === 'string'
    && typeof evidence['diffEvidenceId'] === 'string'
    && typeof evidence['validationEvidenceId'] === 'string'
    && typeof evidence['simulationEvidenceId'] === 'string'
    && isStringArray(evidence['runtimeTraceIds'])
    && typeof value['resultTreeSha256'] === 'string'
    && value['reviewerChannel'] === 'surdet-editor-local'
    && typeof value['approvedAt'] === 'string'
    && typeof value['approvalFingerprint'] === 'string';
}

export const RETURN_REASON_CATEGORIES = [
  'content',
  'presentation',
  'causal-impact',
  'validation-warning',
  'other',
] as const satisfies readonly ReturnRequestReceipt['reasonCategory'][];

function returnRequestReceipt(value: unknown): value is ReturnRequestReceipt {
  return isRecord(value)
    && value['receiptVersion'] === '1.0.0'
    && typeof value['returnId'] === 'string'
    && typeof value['resultReviewId'] === 'string'
    && typeof value['planId'] === 'string'
    && typeof value['planFingerprint'] === 'string'
    && typeof value['integrationChangeId'] === 'string'
    && typeof value['workingRevision'] === 'number'
    && Number.isInteger(value['workingRevision'])
    && RETURN_REASON_CATEGORIES.includes(value['reasonCategory'] as ReturnRequestReceipt['reasonCategory'])
    && value['reviewerChannel'] === 'surdet-editor-local'
    && typeof value['returnedAt'] === 'string'
    && typeof value['returnFingerprint'] === 'string';
}

function candidateRefKey(ref: CandidateCapsuleRef): string {
  return [ref.artifactSha256, ref.changeId, ref.capsuleId].join('\u0000');
}

function normalizeCandidateRefs(refs: readonly CandidateCapsuleRef[]): CandidateCapsuleRef[] {
  return [...refs]
    .map((ref) => ({ ...ref }))
    .sort((left, right) =>
      left.artifactSha256.localeCompare(right.artifactSha256)
      || left.changeId.localeCompare(right.changeId)
      || left.capsuleId.localeCompare(right.capsuleId));
}

function normalizeReceiptResolutions(
  resolutions: readonly ComparisonDecisionReceipt['conflictResolutions'][number][],
): Array<{ conflictId: string; resolution: string; chosenUnitId?: string }> {
  return [...resolutions]
    .map((item) => ({
      conflictId: item.conflictId,
      resolution: item.resolution,
      ...(item.chosenUnitId === undefined ? {} : { chosenUnitId: item.chosenUnitId }),
    }))
    .sort((left, right) =>
      left.conflictId.localeCompare(right.conflictId)
      || left.resolution.localeCompare(right.resolution)
      || (left.chosenUnitId ?? '').localeCompare(right.chosenUnitId ?? ''));
}

export async function decisionFingerprintOf(
  receipt: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify({
    receiptVersion: receipt.receiptVersion,
    decisionId: receipt.decisionId,
    reviewId: receipt.reviewId,
    comparisonFingerprint: receipt.comparisonFingerprint,
    projectIdentity: receipt.projectIdentity,
    expectedProjectRevision: receipt.expectedProjectRevision,
    candidateRefs: normalizeCandidateRefs(receipt.candidateRefs),
    selectedUnitIds: [...receipt.selectedUnitIds].sort(),
    conflictResolutions: normalizeReceiptResolutions(receipt.conflictResolutions),
    reviewerChannel: receipt.reviewerChannel,
  }));
}

function normalizeRuntimeTraceIds(ids: readonly string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export async function approvalFingerprintOf(
  receipt: Omit<FinalApprovalReceipt, 'approvalFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify({
    receiptVersion: receipt.receiptVersion,
    approvalId: receipt.approvalId,
    resultReviewId: receipt.resultReviewId,
    decisionFingerprint: receipt.decisionFingerprint,
    planId: receipt.planId,
    planFingerprint: receipt.planFingerprint,
    integrationChangeId: receipt.integrationChangeId,
    workingRevision: receipt.workingRevision,
    projectIdentity: receipt.projectIdentity,
    expectedProjectRevision: receipt.expectedProjectRevision,
    evidence: {
      diffEvidenceId: receipt.evidence.diffEvidenceId,
      validationEvidenceId: receipt.evidence.validationEvidenceId,
      simulationEvidenceId: receipt.evidence.simulationEvidenceId,
      runtimeTraceIds: normalizeRuntimeTraceIds(receipt.evidence.runtimeTraceIds),
    },
    diffFingerprint: receipt.diffFingerprint,
    resultTreeSha256: receipt.resultTreeSha256,
    reviewerChannel: receipt.reviewerChannel,
  }));
}

export async function returnFingerprintOf(
  receipt: Omit<ReturnRequestReceipt, 'returnFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify({
    receiptVersion: receipt.receiptVersion,
    returnId: receipt.returnId,
    resultReviewId: receipt.resultReviewId,
    planId: receipt.planId,
    planFingerprint: receipt.planFingerprint,
    integrationChangeId: receipt.integrationChangeId,
    workingRevision: receipt.workingRevision,
    reasonCategory: receipt.reasonCategory,
    reviewerChannel: receipt.reviewerChannel,
    returnedAt: receipt.returnedAt,
  }));
}

function resultEvidenceFromFinal(finalResult: NonNullable<HumanReviewProjection['finalResult']>): {
  diffEvidenceId: string;
  validationEvidenceId: string;
  simulationEvidenceId: string;
  runtimeTraceIds: string[];
} {
  return {
    diffEvidenceId: finalResult.evidence.diffEvidenceId,
    validationEvidenceId: finalResult.evidence.validationEvidenceId,
    simulationEvidenceId: finalResult.evidence.simulationEvidenceId,
    runtimeTraceIds: normalizeRuntimeTraceIds(finalResult.evidence.runtimeTraceIds),
  };
}

function resultReviewFromFinal(finalResult: NonNullable<HumanReviewProjection['finalResult']>) {
  return {
    reviewId: '',
    resultTreeSha256: finalResult.resultTreeSha256,
    diffFingerprint: finalResult.diffFingerprint,
    evidence: resultEvidenceFromFinal(finalResult),
    workingRevision: finalResult.workingRevision,
  };
}

function approvalStale(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_APPROVAL_STALE', message);
}

export async function validateFinalApprovalReceipt(input: {
  projection: HumanReviewProjection;
  receipt: unknown;
}, hasher: TextHasher): Promise<FinalApprovalReceipt> {
  const { projection } = input;
  const finalResult = projection.finalResult;
  if (projection.kind !== 'integration-result' || projection.state !== 'STAGE_READY' || finalResult === undefined) {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', 'result projection 不是可批准的 STAGE_READY 结果');
  }
  if (!finalApprovalReceipt(input.receipt)) throw invalid('批准回执结构无效');
  const verified = await validateFinalApproval({
    projection,
    receipt: input.receipt,
    current: {
      projectIdentity: projection.sourceIdentity.projectIdentity,
      projectRevision: projection.expectedProjectRevision,
      planId: finalResult.planId,
      planFingerprint: finalResult.planFingerprint,
      integrationChangeId: finalResult.integrationChangeId,
      workingRevision: finalResult.workingRevision,
      diffFingerprint: finalResult.diffFingerprint,
      evidence: resultEvidenceFromFinal(finalResult),
      resultTreeSha256: finalResult.resultTreeSha256,
    },
  }, hasher);
  return verified.receipt;
}

export async function validateReturnRequest(input: {
  projection: HumanReviewProjection;
  receipt: unknown;
}, hasher: TextHasher): Promise<ReturnRequestReceipt> {
  const { projection } = input;
  const finalResult = projection.finalResult;
  if (projection.kind !== 'integration-result' || projection.state !== 'STAGE_READY' || finalResult === undefined) {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', 'result projection 不是可退回的 STAGE_READY 结果');
  }
  if (!returnRequestReceipt(input.receipt)) throw receiptIdentityMismatch('退回回执结构或 reasonCategory 无效');
  const receipt = input.receipt;
  if (receipt.returnId.length === 0
    || receipt.returnedAt.length === 0
    || receipt.resultReviewId !== projection.reviewId
    || receipt.planId !== finalResult.planId
    || receipt.planFingerprint !== finalResult.planFingerprint
    || receipt.integrationChangeId !== finalResult.integrationChangeId
    || receipt.workingRevision !== finalResult.workingRevision) {
    throw receiptIdentityMismatch('退回回执与 result review identity 不一致');
  }
  const expectedFingerprint = await returnFingerprintOf(receipt, hasher);
  if (receipt.returnFingerprint !== expectedFingerprint) {
    throw receiptIdentityMismatch('returnFingerprint 与退回回执内容不符');
  }
  return receipt;
}

export async function validateFinalApproval(input: {
  projection: HumanReviewProjection;
  receipt: FinalApprovalReceipt;
  current: ResultReviewCurrentFacts;
}, hasher: TextHasher): Promise<VerifiedReviewApproval> {
  const { projection, receipt, current } = input;
  const finalResult = projection.finalResult;
  if (projection.kind !== 'integration-result' || projection.state !== 'STAGE_READY' || finalResult === undefined) {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', 'result projection 不是可批准的 STAGE_READY 结果');
  }
  if (projection.reviewVersion === '2.0.0'
    && (!isReviewProjectionV2Fields(projection)
      || projection.reviewFingerprint !== await resultReviewFingerprintOf(projection, hasher))) {
    throw approvalStale('最终结果说明与审阅身份不一致。');
  }
  const expectedEvidence = resultEvidenceFromFinal(finalResult);
  const actualReceiptEvidence = {
    diffEvidenceId: receipt.evidence.diffEvidenceId,
    validationEvidenceId: receipt.evidence.validationEvidenceId,
    simulationEvidenceId: receipt.evidence.simulationEvidenceId,
    runtimeTraceIds: normalizeRuntimeTraceIds(receipt.evidence.runtimeTraceIds),
  };
  const currentEvidence = {
    diffEvidenceId: current.evidence.diffEvidenceId,
    validationEvidenceId: current.evidence.validationEvidenceId,
    simulationEvidenceId: current.evidence.simulationEvidenceId,
    runtimeTraceIds: normalizeRuntimeTraceIds(current.evidence.runtimeTraceIds),
  };
  if (receipt.resultReviewId !== projection.reviewId
    || receipt.decisionFingerprint !== projection.sourceIdentity.decisionFingerprint
    || receipt.planId !== finalResult.planId
    || receipt.planFingerprint !== finalResult.planFingerprint
    || receipt.integrationChangeId !== finalResult.integrationChangeId
    || receipt.workingRevision !== finalResult.workingRevision
    || receipt.projectIdentity !== projection.projectIdentity
    || receipt.expectedProjectRevision !== projection.expectedProjectRevision
    || receipt.diffFingerprint !== current.diffFingerprint
    || stableStringify(actualReceiptEvidence) !== stableStringify(expectedEvidence)
    || receipt.resultTreeSha256 !== finalResult.resultTreeSha256
    || current.projectIdentity !== projection.sourceIdentity.projectIdentity
    || current.projectRevision !== projection.expectedProjectRevision
    || current.planId !== finalResult.planId
    || current.planFingerprint !== finalResult.planFingerprint
    || current.integrationChangeId !== finalResult.integrationChangeId
    || current.workingRevision !== finalResult.workingRevision
    || current.diffFingerprint !== finalResult.diffFingerprint
    || stableStringify(currentEvidence) !== stableStringify(expectedEvidence)
    || current.resultTreeSha256 !== finalResult.resultTreeSha256) {
    throw approvalStale('批准回执与 result review 的 plan/change/revision/evidence/tree identity 不一致');
  }
  if (receipt.receiptVersion !== '1.0.0' || receipt.reviewerChannel !== 'surdet-editor-local') {
    throw invalid('批准回执版本或 reviewerChannel 非法');
  }
  if (receipt.approvalId.length === 0 || receipt.approvedAt.length === 0) {
    throw invalid('批准回执缺少 approvalId 或 approvedAt');
  }
  if (new Set(receipt.evidence.runtimeTraceIds).size !== receipt.evidence.runtimeTraceIds.length) {
    throw invalid('批准回执 runtimeTraceIds 含重复项');
  }
  const expectedFingerprint = await approvalFingerprintOf(receipt, hasher);
  if (receipt.approvalFingerprint !== expectedFingerprint) {
    throw invalid('approvalFingerprint 与批准内容不符');
  }
  const binding = {
    reviewState: 'human-reviewed' as const,
    reviewId: projection.sourceIdentity.decisionReviewId ?? projection.reviewId,
    decisionId: projection.sourceIdentity.decisionId ?? receipt.approvalId,
    decisionFingerprint: receipt.decisionFingerprint,
  };
  const resultReview = {
    ...resultReviewFromFinal(finalResult),
    reviewId: projection.reviewId,
  };
  return {
    receipt,
    bindingFingerprint: approvalBindingFingerprintOf({
      binding,
      planId: finalResult.planId,
      planFingerprint: finalResult.planFingerprint,
      integrationChangeId: finalResult.integrationChangeId,
      resultReview,
    }),
  };
}

function sameEvidence(
  left: { diffEvidenceId: string; validationEvidenceId: string; simulationEvidenceId: string; runtimeTraceIds: string[] },
  right: { diffEvidenceId: string; validationEvidenceId: string; simulationEvidenceId: string; runtimeTraceIds: string[] },
): boolean {
  return stableStringify({
    ...left,
    runtimeTraceIds: normalizeRuntimeTraceIds(left.runtimeTraceIds),
  }) === stableStringify({
    ...right,
    runtimeTraceIds: normalizeRuntimeTraceIds(right.runtimeTraceIds),
  });
}

export async function bindResultReview(
  change: ChangeSession,
  projection: HumanReviewProjection,
): Promise<IntegrationMetadata> {
  const finalResult = projection.finalResult;
  const integration = change.record.integration;
  if (integration === undefined || finalResult === undefined || projection.kind !== 'integration-result'
    || projection.state !== 'STAGE_READY') {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', '无法绑定不完整的 result review');
  }
  if (integration.status !== 'READY'
    || integration.planId !== finalResult.planId
    || integration.planFingerprint !== finalResult.planFingerprint
    || finalResult.integrationChangeId !== change.record.changeId
    || finalResult.workingRevision !== change.record.workingRevision
    || integration.review?.binding.reviewState !== 'human-reviewed') {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', 'result review 与 READY reviewed integration 不匹配');
  }
  const resultReview = {
    reviewId: projection.reviewId,
    resultTreeSha256: finalResult.resultTreeSha256,
    diffFingerprint: finalResult.diffFingerprint,
    evidence: resultEvidenceFromFinal(finalResult),
    workingRevision: finalResult.workingRevision,
  };
  return updateIntegrationMetadata(change, (metadata) => ({
    ...metadata,
    review: {
      binding: metadata.review!.binding,
      resultReview,
    },
  }));
}

export async function bindVerifiedApproval(
  change: ChangeSession,
  verified: VerifiedReviewApproval,
): Promise<IntegrationMetadata> {
  const integration = change.record.integration;
  const review = integration?.review;
  const resultReview = review?.resultReview;
  if (integration === undefined || review === undefined || resultReview === undefined) {
    throw new AuthoringOperationError('REVIEW_APPROVAL_REQUIRED', '缺少可批准的 result review');
  }
  if (review.binding.reviewState !== 'human-reviewed') {
    throw new AuthoringOperationError('REVIEW_APPROVAL_REQUIRED', 'integration plan 尚未完成人类决定');
  }
  const receipt = verified.receipt;
  const expectedBindingFingerprint = approvalBindingFingerprintOf({
    binding: review.binding,
    planId: integration.planId,
    planFingerprint: integration.planFingerprint,
    integrationChangeId: change.record.changeId,
    resultReview,
  });
  if (verified.bindingFingerprint !== expectedBindingFingerprint
    || receipt.resultReviewId !== resultReview.reviewId
    || receipt.planId !== integration.planId
    || receipt.planFingerprint !== integration.planFingerprint
    || receipt.integrationChangeId !== change.record.changeId
    || receipt.workingRevision !== resultReview.workingRevision
    || receipt.expectedProjectRevision !== change.record.baseRevision
    || receipt.diffFingerprint !== resultReview.diffFingerprint
    || receipt.resultTreeSha256 !== resultReview.resultTreeSha256
    || !sameEvidence({
      diffEvidenceId: receipt.evidence.diffEvidenceId,
      validationEvidenceId: receipt.evidence.validationEvidenceId,
      simulationEvidenceId: receipt.evidence.simulationEvidenceId,
      runtimeTraceIds: receipt.evidence.runtimeTraceIds,
    }, resultReview.evidence)) {
    throw approvalStale('批准回执不能绑定当前 result review');
  }
  return updateIntegrationMetadata(change, (metadata) => ({
    ...metadata,
    review: {
      binding: metadata.review!.binding,
      resultReview: metadata.review!.resultReview,
      approval: {
        approvalId: receipt.approvalId,
        approvalFingerprint: receipt.approvalFingerprint,
        bindingFingerprint: expectedBindingFingerprint,
      },
    },
  }));
}

function selectionConflicts(projection: HumanReviewProjection): ReviewConflict[] {
  return projection.conflicts.filter((conflict) => conflict.severity === 'selection-required');
}

export async function validateComparisonDecision(input: {
  projection: HumanReviewProjection;
  receipt: AnyComparisonDecisionReceipt;
}, hasher: TextHasher): Promise<VerifiedComparisonDecision> {
  const { projection, receipt } = input;
  if (projection.kind !== 'comparison' || projection.state !== 'COMPARISON_PREPARED') {
    throw invalid('review projection 不是可接收决定的 comparison');
  }
  if (receipt.reviewId !== projection.reviewId
    || receipt.comparisonFingerprint !== projection.sourceIdentity.comparisonFingerprint
    || receipt.projectIdentity !== projection.sourceIdentity.projectIdentity
    || receipt.expectedProjectRevision !== projection.sourceIdentity.expectedProjectRevision) {
    throw stale('决定对应的 review/comparison/project identity 已变化');
  }
  const expectedCandidateRefs = normalizeCandidateRefs(projection.candidates.map((candidate) => candidate.ref));
  const actualCandidateRefs = normalizeCandidateRefs(receipt.candidateRefs);
  if (stableStringify(actualCandidateRefs) !== stableStringify(expectedCandidateRefs)) {
    throw stale('决定对应的 candidateRefs 已变化');
  }
  if (receipt.receiptVersion !== projection.reviewVersion || receipt.reviewerChannel !== 'surdet-editor-local') {
    throw invalid('决定回执版本或 reviewerChannel 非法');
  }
  if (receipt.decisionId.length === 0 || receipt.decidedAt.length === 0) {
    throw invalid('决定回执缺少 decisionId 或 decidedAt');
  }
  if (receipt.receiptVersion === '2.0.0') {
    if (projection.reviewVersion !== '2.0.0') throw invalid('v2 决定必须来自 v2 审阅');
    if (receipt.reviewFingerprint !== projection.reviewFingerprint) throw stale('决定绑定的审阅内容已变化');
    if (!isReviewDecisionIntent(receipt.decisionIntent)) throw invalid('决定意图结构无效');
    const chosen = receipt.decisionIntent.mode === 'adopt-candidate'
      ? receipt.decisionIntent.candidate : receipt.decisionIntent.baseCandidate;
    if (chosen !== undefined && !projection.candidates.some((candidate) =>
      candidate.candidateId === chosen.candidateId
      && stableStringify(candidate.ref) === stableStringify(chosen.ref))) {
      throw stale('决定意图引用了当前审阅之外的候选');
    }
    const units = new Set(projection.candidates.flatMap((candidate) => candidate.verifiedFacts.units.map((unit) => unit.unitId)));
    if (receipt.selectedUnitIds.some((unitId) => !units.has(unitId))) throw invalid('决定选择了审阅之外的单元');
    if (receipt.decisionIntent.mode === 'adopt-candidate') {
      const preset = projection.candidates.find((candidate) => candidate.candidateId === chosen!.candidateId)!.adoptionPreset;
      if (preset.status !== 'available'
        || stableStringify([...receipt.selectedUnitIds].sort()) !== stableStringify([...preset.selectedUnitIds].sort())
        || stableStringify(normalizeReceiptResolutions(receipt.conflictResolutions))
          !== stableStringify(normalizeReceiptResolutions(preset.conflictResolutions))) {
        throw invalid('整案决定没有保留所选候选的完整推导结果');
      }
    }
    if (!/^[0-9a-f]{64}$/.test(receipt.planContentFingerprint)
      || receipt.previewFingerprint !== await reviewDecisionPreviewFingerprintOf(receipt, hasher)) {
      throw invalid('决定的预览身份与审阅、意图或计划内容不符');
    }
  }
  const expectedFingerprint = receipt.receiptVersion === '2.0.0'
    ? await decisionFingerprintV2Of(receipt, hasher)
    : await decisionFingerprintOf(receipt, hasher);
  if (receipt.decisionFingerprint !== expectedFingerprint) {
    throw invalid('decisionFingerprint 与决定内容不符');
  }

  const selectedUnitIds = [...new Set(receipt.selectedUnitIds)];
  if (selectedUnitIds.length !== receipt.selectedUnitIds.length
    || selectedUnitIds.some((unitId) => unitId.length === 0)) {
    throw invalid('selectedUnitIds 含重复或空 ID');
  }
  if (!projection.evidence.canCreateDecision
    || projection.conflicts.some((conflict) => conflict.severity === 'blocking')) {
    throw invalid('blocking conflict 或不可决定的 review 不允许生成 plan');
  }

  const conflicts = selectionConflicts(projection);
  const conflictById = new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const resolutionById = new Map<string, ComparisonDecisionReceipt['conflictResolutions'][number]>();
  for (const resolution of receipt.conflictResolutions) {
    if (resolutionById.has(resolution.conflictId)) {
      throw invalid('同一 selection-required conflict 出现多条决定：' + resolution.conflictId);
    }
    const conflict = conflictById.get(resolution.conflictId);
    if (conflict === undefined) {
      throw invalid('决定指向未知或不可决定的 conflict：' + resolution.conflictId);
    }
    if (!conflict.allowedResolutions.includes(resolution.resolution)) {
      throw invalid('决定动作不在 conflict 允许列表：' + resolution.conflictId);
    }
    resolutionById.set(resolution.conflictId, resolution);
  }
  for (const conflict of conflicts) {
    const resolution = resolutionById.get(conflict.conflictId);
    if (resolution === undefined) {
      throw invalid('selection-required conflict 缺少决定：' + conflict.conflictId);
    }
    if (resolution.resolution === 'choose-unit') {
      if (resolution.chosenUnitId === undefined || !conflict.unitIds.includes(resolution.chosenUnitId)) {
        throw invalid('choose-unit 的 chosenUnitId 不在 conflict 单元列表：' + conflict.conflictId);
      }
      if (!selectedUnitIds.includes(resolution.chosenUnitId)) {
        throw invalid('choose-unit 的 chosenUnitId 未被 selectedUnitIds 选中：' + conflict.conflictId);
      }
    } else if (resolution.chosenUnitId !== undefined) {
      throw invalid('非 choose-unit 决定不能携带 chosenUnitId：' + conflict.conflictId);
    }
    if (resolution.resolution === 'regenerate-candidate') {
      throw returned('人类要求重新生成候选：' + conflict.conflictId);
    }
  }

  const conflictResolutions: ConflictResolutionInput[] = [...resolutionById.values()]
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
    .map((resolution) => ({
      conflictId: resolution.conflictId,
      resolution: resolution.resolution,
      ...(resolution.chosenUnitId === undefined ? {} : { chosenUnitId: resolution.chosenUnitId }),
      actor: 'human' as const,
    }));
  return {
    receipt,
    selectedUnitIds: [...selectedUnitIds].sort(),
    conflictResolutions,
    review: {
      reviewState: 'human-reviewed',
      reviewId: receipt.reviewId,
      decisionId: receipt.decisionId,
      decisionFingerprint: receipt.decisionFingerprint,
    },
  };
}

export function decisionToPlanSelection(
  verified: VerifiedComparisonDecision,
): DecisionPlanSelection {
  return {
    selectedUnitIds: [...verified.selectedUnitIds],
    conflictResolutions: verified.conflictResolutions.map((resolution) => ({
      ...resolution,
      actor: 'human' as const,
    })),
    review: { ...verified.review },
  };
}
