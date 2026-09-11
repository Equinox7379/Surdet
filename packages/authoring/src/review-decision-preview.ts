import { AuthoringOperationError, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
  CompositionComparison,
  ObjectChangeUnit,
} from './composition-contracts.js';
import type { TextHasher } from './contracts.js';
import type { ReviewPayloadIdentity } from './review-terminal.js';
import {
  integrationPlanContentFingerprintOf,
  type ConflictResolutionInput,
  type IntegrationPlan,
  type IntegrationPlanDraft,
} from './integration-plan.js';

export interface ReviewDecisionCandidate {
  candidateId: string;
  ref: CandidateCapsuleRef;
}

export type ReviewDecisionIntent =
  | {
      mode: 'adopt-candidate';
      candidate: ReviewDecisionCandidate;
    }
  | {
      mode: 'custom-mix';
      baseCandidate?: ReviewDecisionCandidate;
    };

export interface ReviewDecisionResolutionInput {
  conflictId: string;
  resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
  chosenUnitId?: string;
}

export interface ReviewCustomSelectionInput {
  selectedUnitIds: string[];
  conflictResolutions: ReviewDecisionResolutionInput[];
}

export interface ReviewDecisionPreviewCommand {
  projectIdentity: string;
  reviewId: string;
  reviewPayload: ReviewPayloadIdentity;
  decisionIntent: ReviewDecisionIntent;
  customSelection?: ReviewCustomSelectionInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isReviewDecisionCandidate(value: unknown): value is ReviewDecisionCandidate {
  if (!isRecord(value) || !hasOnlyKeys(value, ['candidateId', 'ref'])
    || !identifier(value['candidateId']) || !isRecord(value['ref'])) return false;
  const ref = value['ref'];
  return hasOnlyKeys(ref, ['changeId', 'capsuleId', 'artifactSha256'])
    && identifier(ref['changeId']) && identifier(ref['capsuleId'])
    && typeof ref['artifactSha256'] === 'string' && /^[0-9a-f]{64}$/.test(ref['artifactSha256']);
}

export function isReviewDecisionIntent(value: unknown): value is ReviewDecisionIntent {
  if (!isRecord(value)) return false;
  if (value['mode'] === 'adopt-candidate') {
    return hasOnlyKeys(value, ['mode', 'candidate']) && isReviewDecisionCandidate(value['candidate']);
  }
  return value['mode'] === 'custom-mix' && hasOnlyKeys(value, ['mode', 'baseCandidate'])
    && (value['baseCandidate'] === undefined || isReviewDecisionCandidate(value['baseCandidate']));
}

export function isReviewCustomSelection(value: unknown): value is ReviewCustomSelectionInput {
  return isRecord(value) && hasOnlyKeys(value, ['selectedUnitIds', 'conflictResolutions'])
    && Array.isArray(value['selectedUnitIds']) && value['selectedUnitIds'].every(identifier)
    && new Set(value['selectedUnitIds']).size === value['selectedUnitIds'].length
    && Array.isArray(value['conflictResolutions'])
    && value['conflictResolutions'].every((resolution) => isRecord(resolution)
      && hasOnlyKeys(resolution, ['conflictId', 'resolution', 'chosenUnitId'])
      && identifier(resolution['conflictId'])
      && (resolution['resolution'] === 'choose-unit'
        ? identifier(resolution['chosenUnitId'])
        : (resolution['resolution'] === 'exclude-all' || resolution['resolution'] === 'regenerate-candidate')
          && resolution['chosenUnitId'] === undefined));
}

export function parseReviewDecisionPreviewCommand(value: unknown): ReviewDecisionPreviewCommand {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['projectIdentity', 'reviewId', 'reviewPayload', 'decisionIntent', 'customSelection'])
    || !identifier(value['projectIdentity']) || !identifier(value['reviewId'])
    || !isRecord(value['reviewPayload']) || !hasOnlyKeys(value['reviewPayload'], ['bytes', 'sha256'])
    || typeof value['reviewPayload']['bytes'] !== 'number'
    || !Number.isSafeInteger(value['reviewPayload']['bytes']) || value['reviewPayload']['bytes'] < 0
    || typeof value['reviewPayload']['sha256'] !== 'string'
    || !/^[0-9a-f]{64}$/.test(value['reviewPayload']['sha256'])
    || !isReviewDecisionIntent(value['decisionIntent'])
    || (value['decisionIntent'].mode === 'adopt-candidate'
      ? value['customSelection'] !== undefined
      : !isReviewCustomSelection(value['customSelection']))) {
    throw invalid('决定预览请求结构无效。');
  }
  return value as unknown as ReviewDecisionPreviewCommand;
}

export interface DerivedReviewDecisionSelection {
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
}

export interface ReviewDecisionPreview {
  previewVersion: '1.0.0';
  reviewId: string;
  reviewFingerprint: string;
  comparisonFingerprint: string;
  decisionIntent: ReviewDecisionIntent;
  status: 'ready' | 'blocked';
  selectedUnitIds: string[];
  conflictResolutions: ReviewDecisionResolutionInput[];
  effectiveUnitIds: string[];
  implicitInclusions: string[];
  excludedUnitIds: string[];
  planContentFingerprint: string;
  dryRun: IntegrationPlan['dryRun'];
  previewFingerprint: string;
}

export function isReviewDecisionPreview(value: unknown): value is ReviewDecisionPreview {
  if (!isRecord(value) || value['previewVersion'] !== '1.0.0'
    || !identifier(value['reviewId']) || !isReviewDecisionIntent(value['decisionIntent'])
    || !['ready', 'blocked'].includes(String(value['status']))
    || !['reviewFingerprint', 'comparisonFingerprint', 'planContentFingerprint', 'previewFingerprint']
      .every((key) => typeof value[key] === 'string' && /^[0-9a-f]{64}$/.test(value[key]))
    || !isReviewCustomSelection({ selectedUnitIds: value['selectedUnitIds'], conflictResolutions: value['conflictResolutions'] })
    || !['effectiveUnitIds', 'implicitInclusions', 'excludedUnitIds'].every((key) =>
      Array.isArray(value[key]) && value[key].every(identifier) && new Set(value[key]).size === value[key].length)
    || !isRecord(value['dryRun'])) return false;
  const dryRun = value['dryRun'];
  return ['passed', 'failed'].includes(String(dryRun['status']))
    && (value['status'] === 'ready') === (dryRun['status'] === 'passed')
    && isRecord(dryRun['finalObjectFingerprints'])
    && Object.values(dryRun['finalObjectFingerprints']).every((fingerprint) => typeof fingerprint === 'string')
    && Array.isArray(dryRun['errors']) && dryRun['errors'].every((error) =>
      isRecord(error) && typeof error['code'] === 'string' && typeof error['message'] === 'string');
}

function invalid(message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_INVALID', message, details);
}

function stale(message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_STALE', message, details);
}

function candidateRefKey(ref: CandidateCapsuleRef): string {
  return [ref.artifactSha256, ref.changeId, ref.capsuleId].join('\u0000');
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizedCandidate(candidate: ReviewDecisionCandidate): ReviewDecisionCandidate {
  return {
    candidateId: candidate.candidateId,
    ref: { ...candidate.ref },
  };
}

export function normalizeReviewDecisionIntent(intent: ReviewDecisionIntent): ReviewDecisionIntent {
  return intent.mode === 'adopt-candidate'
    ? { mode: 'adopt-candidate', candidate: normalizedCandidate(intent.candidate) }
    : {
        mode: 'custom-mix',
        ...(intent.baseCandidate === undefined
          ? {}
          : { baseCandidate: normalizedCandidate(intent.baseCandidate) }),
      };
}

function candidateIndex(
  comparison: CompositionComparison,
  candidates: readonly ReviewDecisionCandidate[],
): Map<string, ReviewDecisionCandidate> {
  const comparisonRefs = new Set(comparison.candidates.map(candidateRefKey));
  const byId = new Map<string, ReviewDecisionCandidate>();
  const refOwners = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.candidateId.length === 0) throw invalid('candidateId 不能为空');
    const key = candidateRefKey(candidate.ref);
    if (!comparisonRefs.has(key)) {
      throw stale('决定候选不属于当前 comparison', { candidateId: candidate.candidateId });
    }
    if (byId.has(candidate.candidateId)) {
      throw invalid('candidateId 在审阅候选映射中重复', { candidateId: candidate.candidateId });
    }
    const previousOwner = refOwners.get(key);
    if (previousOwner !== undefined) {
      throw invalid('同一候选引用被映射到多个 candidateId', {
        candidateId: candidate.candidateId,
        previousCandidateId: previousOwner,
      });
    }
    byId.set(candidate.candidateId, normalizedCandidate(candidate));
    refOwners.set(key, candidate.candidateId);
  }
  if (comparisonRefs.size !== refOwners.size) {
    throw stale('审阅候选映射没有覆盖当前 comparison 的全部候选');
  }
  for (const unit of comparison.units) {
    if (!byId.has(unit.candidateId)) {
      throw stale('comparison unit 引用了审阅候选映射之外的 candidateId', {
        unitId: unit.unitId,
        candidateId: unit.candidateId,
      });
    }
  }
  return byId;
}

function unitIndex(comparison: CompositionComparison): Map<string, ObjectChangeUnit> {
  const byId = new Map<string, ObjectChangeUnit>();
  for (const unit of comparison.units) {
    if (byId.has(unit.unitId)) throw invalid('comparison 含重复 unitId', { unitId: unit.unitId });
    byId.set(unit.unitId, unit);
  }
  return byId;
}

function assertIntentCandidate(
  intentCandidate: ReviewDecisionCandidate,
  candidatesById: ReadonlyMap<string, ReviewDecisionCandidate>,
): ReviewDecisionCandidate {
  const current = candidatesById.get(intentCandidate.candidateId);
  if (current === undefined
    || candidateRefKey(current.ref) !== candidateRefKey(intentCandidate.ref)) {
    throw stale('决定意图引用的候选已变化', { candidateId: intentCandidate.candidateId });
  }
  return current;
}

export function deriveWholeCandidateSelection(input: {
  comparison: CompositionComparison;
  candidates: readonly ReviewDecisionCandidate[];
  candidate: ReviewDecisionCandidate;
}): DerivedReviewDecisionSelection {
  const candidatesById = candidateIndex(input.comparison, input.candidates);
  const candidate = assertIntentCandidate(input.candidate, candidatesById);
  const unitsById = unitIndex(input.comparison);
  const selectedUnitIds = sortedStrings(input.comparison.units
    .filter((unit) => unit.candidateId === candidate.candidateId)
    .map((unit) => unit.unitId));
  if (selectedUnitIds.length === 0) {
    throw invalid('整案候选没有可采用的 composition unit', { candidateId: candidate.candidateId });
  }

  const conflictResolutions: ConflictResolutionInput[] = [];
  for (const conflict of [...input.comparison.conflicts]
    .filter((item) => item.severity === 'selection-required')
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))) {
    const ownedUnitIds = conflict.unitIds.filter((unitId) =>
      unitsById.get(unitId)?.candidateId === candidate.candidateId);
    if (ownedUnitIds.length === 1) {
      if (!conflict.allowedResolutions.includes('choose-unit')) {
        throw invalid('整案候选所在冲突不允许选择其单元', {
          candidateId: candidate.candidateId,
          conflictId: conflict.conflictId,
        });
      }
      conflictResolutions.push({
        conflictId: conflict.conflictId,
        resolution: 'choose-unit',
        chosenUnitId: ownedUnitIds[0]!,
        actor: 'human',
      });
      continue;
    }
    if (ownedUnitIds.length === 0) {
      if (!conflict.allowedResolutions.includes('exclude-all')) {
        throw invalid('整案候选无法排除其他候选的冲突内容', {
          candidateId: candidate.candidateId,
          conflictId: conflict.conflictId,
        });
      }
      conflictResolutions.push({
        conflictId: conflict.conflictId,
        resolution: 'exclude-all',
        actor: 'human',
      });
      continue;
    }
    throw invalid('一个冲突含有多个整案候选单元，现有低层裁决无法在不丢内容的情况下表达整案采用', {
      candidateId: candidate.candidateId,
      conflictId: conflict.conflictId,
      ownedUnitIds: sortedStrings(ownedUnitIds),
    });
  }

  return { selectedUnitIds, conflictResolutions };
}

export function deriveReviewDecisionSelection(input: {
  comparison: CompositionComparison;
  candidates: readonly ReviewDecisionCandidate[];
  intent: ReviewDecisionIntent;
  customSelection?: ReviewCustomSelectionInput;
}): DerivedReviewDecisionSelection {
  const candidatesById = candidateIndex(input.comparison, input.candidates);
  if (input.intent.mode === 'adopt-candidate') {
    if (input.customSelection !== undefined) {
      throw invalid('整案采用不能同时携带自定义低层选择');
    }
    assertIntentCandidate(input.intent.candidate, candidatesById);
    return deriveWholeCandidateSelection({
      comparison: input.comparison,
      candidates: input.candidates,
      candidate: input.intent.candidate,
    });
  }

  if (input.intent.baseCandidate !== undefined) {
    assertIntentCandidate(input.intent.baseCandidate, candidatesById);
  }
  if (input.customSelection === undefined) {
    throw invalid('自定义混合缺少低层选择');
  }
  return {
    selectedUnitIds: [...input.customSelection.selectedUnitIds]
      .sort((left, right) => left.localeCompare(right)),
    conflictResolutions: input.customSelection.conflictResolutions
      .map((resolution) => ({
        conflictId: resolution.conflictId,
        resolution: resolution.resolution,
        ...(resolution.chosenUnitId === undefined ? {} : { chosenUnitId: resolution.chosenUnitId }),
        actor: 'human' as const,
      }))
      .sort((left, right) =>
        left.conflictId.localeCompare(right.conflictId)
        || left.resolution.localeCompare(right.resolution)
        || (left.chosenUnitId ?? '').localeCompare(right.chosenUnitId ?? '')),
  };
}

export function assertWholeCandidatePlanIntegrity(input: {
  comparison: CompositionComparison;
  candidates: readonly ReviewDecisionCandidate[];
  intent: Extract<ReviewDecisionIntent, { mode: 'adopt-candidate' }>;
  draft: IntegrationPlanDraft;
}): void {
  const candidatesById = candidateIndex(input.comparison, input.candidates);
  const candidate = assertIntentCandidate(input.intent.candidate, candidatesById);
  const unitsById = unitIndex(input.comparison);
  const expectedSelected = sortedStrings(input.comparison.units
    .filter((unit) => unit.candidateId === candidate.candidateId)
    .map((unit) => unit.unitId));
  const actualSelected = sortedStrings(input.draft.selectedUnitIds);
  if (stableStringify(actualSelected) !== stableStringify(expectedSelected)) {
    throw invalid('整案计划没有保留候选的全部有效单元', {
      candidateId: candidate.candidateId,
      expectedSelected,
      actualSelected,
    });
  }

  const excludedOwned = input.draft.excludedUnitIds.filter((unitId) =>
    unitsById.get(unitId)?.candidateId === candidate.candidateId);
  if (excludedOwned.length > 0) {
    throw invalid('整案计划排除了所选候选自身的单元', {
      candidateId: candidate.candidateId,
      excludedUnitIds: sortedStrings(excludedOwned),
    });
  }

  const foreignImplicit = input.draft.implicitInclusions.filter((unitId) =>
    unitsById.get(unitId)?.candidateId !== candidate.candidateId);
  const foreignReplay = input.draft.replayOperations.filter((operation) =>
    unitsById.get(operation.sourceUnitId)?.candidateId !== candidate.candidateId)
    .map((operation) => operation.sourceUnitId);
  const foreignProvenance = input.draft.provenance.filter((entry) =>
    unitsById.get(entry.sourceUnitId)?.candidateId !== candidate.candidateId)
    .map((entry) => entry.sourceUnitId);
  const foreignUnitIds = sortedStrings([
    ...foreignImplicit,
    ...foreignReplay,
    ...foreignProvenance,
  ]);
  if (foreignUnitIds.length > 0) {
    throw invalid('整案计划混入了其他候选的实际执行内容', {
      candidateId: candidate.candidateId,
      foreignUnitIds,
    });
  }

  const replayed = new Set(input.draft.replayOperations.map((operation) => operation.sourceUnitId));
  const lostUnitIds: string[] = [];
  for (const unitId of expectedSelected) {
    if (replayed.has(unitId)) continue;
    const deduplicated = input.draft.deduplicatedUnits.find((item) =>
      item.provenanceUnitIds.includes(unitId));
    if (deduplicated === undefined
      || unitsById.get(deduplicated.retainedUnitId)?.candidateId !== candidate.candidateId
      || !replayed.has(deduplicated.retainedUnitId)) {
      lostUnitIds.push(unitId);
    }
  }
  if (lostUnitIds.length > 0) {
    throw invalid('整案计划在去重或闭包计算后丢失了所选候选内容', {
      candidateId: candidate.candidateId,
      lostUnitIds: sortedStrings(lostUnitIds),
    });
  }
}

function publicResolutions(
  resolutions: readonly ConflictResolutionInput[],
): ReviewDecisionResolutionInput[] {
  return resolutions.map((resolution) => ({
    conflictId: resolution.conflictId,
    resolution: resolution.resolution,
    ...(resolution.chosenUnitId === undefined ? {} : { chosenUnitId: resolution.chosenUnitId }),
  }));
}

export async function buildReviewDecisionPreview(input: {
  reviewId: string;
  reviewFingerprint: string;
  comparison: CompositionComparison;
  candidates: readonly ReviewDecisionCandidate[];
  intent: ReviewDecisionIntent;
  draft: IntegrationPlanDraft;
  dryRun: IntegrationPlan['dryRun'];
}, hasher: TextHasher): Promise<ReviewDecisionPreview> {
  if (input.reviewId.length === 0 || input.reviewFingerprint.length === 0) {
    throw invalid('决定预览缺少 review identity');
  }
  if (input.draft.comparisonFingerprint !== input.comparison.comparisonFingerprint
    || input.draft.projectIdentity !== input.comparison.projectIdentity
    || input.draft.expectedProjectRevision !== input.comparison.expectedProjectRevision) {
    throw stale('决定预览的计划草稿已离开当前 comparison 基线');
  }
  const candidatesById = candidateIndex(input.comparison, input.candidates);
  if (input.intent.mode === 'adopt-candidate') {
    assertWholeCandidatePlanIntegrity({
      comparison: input.comparison,
      candidates: input.candidates,
      intent: input.intent,
      draft: input.draft,
    });
  } else if (input.intent.baseCandidate !== undefined) {
    assertIntentCandidate(input.intent.baseCandidate, candidatesById);
  }

  const planContentFingerprint = await integrationPlanContentFingerprintOf(
    input.draft,
    input.dryRun,
    hasher,
  );
  const decisionIntent = normalizeReviewDecisionIntent(input.intent);
  const previewFingerprint = await reviewDecisionPreviewFingerprintOf({
    reviewId: input.reviewId,
    reviewFingerprint: input.reviewFingerprint,
    comparisonFingerprint: input.comparison.comparisonFingerprint,
    decisionIntent,
    planContentFingerprint,
  }, hasher);
  const effectiveUnitIds = sortedStrings(input.draft.replayOperations.map((operation) => operation.sourceUnitId));
  const included = new Set(effectiveUnitIds);
  const requested = new Set([...input.draft.selectedUnitIds, ...input.draft.implicitInclusions]);
  for (const group of input.draft.deduplicatedUnits) {
    if (!included.has(group.retainedUnitId)) continue;
    for (const unitId of group.provenanceUnitIds) if (requested.has(unitId)) included.add(unitId);
  }

  return {
    previewVersion: '1.0.0',
    reviewId: input.reviewId,
    reviewFingerprint: input.reviewFingerprint,
    comparisonFingerprint: input.comparison.comparisonFingerprint,
    decisionIntent,
    status: input.dryRun.status === 'passed' ? 'ready' : 'blocked',
    selectedUnitIds: [...input.draft.selectedUnitIds],
    conflictResolutions: publicResolutions(input.draft.conflictResolutions),
    effectiveUnitIds,
    implicitInclusions: [...input.draft.implicitInclusions],
    excludedUnitIds: sortedStrings(input.comparison.units.filter((unit) => !included.has(unit.unitId)).map((unit) => unit.unitId)),
    planContentFingerprint,
    dryRun: {
      status: input.dryRun.status,
      finalObjectFingerprints: { ...input.dryRun.finalObjectFingerprints },
      errors: input.dryRun.errors.map((error) => ({ ...error })),
    },
    previewFingerprint,
  };
}

export async function reviewDecisionPreviewFingerprintOf(
  input: Pick<ReviewDecisionPreview, 'reviewId' | 'reviewFingerprint' | 'comparisonFingerprint'
    | 'decisionIntent' | 'planContentFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify({
    previewVersion: '1.0.0',
    reviewId: input.reviewId,
    reviewFingerprint: input.reviewFingerprint,
    comparisonFingerprint: input.comparisonFingerprint,
    decisionIntent: normalizeReviewDecisionIntent(input.decisionIntent),
    planContentFingerprint: input.planContentFingerprint,
  }));
}

export function assertReviewDecisionPreviewFingerprint(
  expectedPreviewFingerprint: string,
  recalculated: ReviewDecisionPreview,
): void {
  if (expectedPreviewFingerprint.length === 0
    || expectedPreviewFingerprint !== recalculated.previewFingerprint) {
    throw stale('决定预览已变化，不能保存旧预览对应的决定', {
      expectedPreviewFingerprint,
      actualPreviewFingerprint: recalculated.previewFingerprint,
    });
  }
}

export function assertReviewDecisionPreviewSavable(preview: ReviewDecisionPreview): void {
  if (preview.status !== 'ready' || preview.dryRun.status !== 'passed') {
    throw invalid('决定预览的内存试运行未通过，不能保存正式决定', {
      previewFingerprint: preview.previewFingerprint,
      errorCodes: preview.dryRun.errors.map((error) => error.code),
    });
  }
}
