import { AuthoringOperationError, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
  CompositionComparison,
  CompositionConflict,
  CompositionManifest,
  CompositionOperation,
  ObjectChangeUnit,
} from './composition-contracts.js';

/** 5.5 计划、dry-run 与裁决 */
export interface ConflictResolutionInput {
  conflictId: string;
  resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
  chosenUnitId?: string;
  actor: 'human' | 'review-agent';
  reason?: string;
}

export interface ConflictResolution extends ConflictResolutionInput {
  decidedAt: string;
}

export interface IdenticalUnitResolution {
  groupId: string;
  retainedUnitId: string;
  provenanceUnitIds: string[];
}

export interface PlannedReplayOperation extends CompositionOperation {
  integrationOperationId: string;
  sourceCapsule: CandidateCapsuleRef;
  sourceUnitId: string;
}

export interface IntegrationPlan {
  planVersion: '1.0.0';
  planId: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  sourceCapsules: CandidateCapsuleRef[];
  selectedUnitIds: string[];
  implicitInclusions: string[];
  excludedUnitIds: string[];
  conflictResolutions: ConflictResolution[];
  deduplicatedUnits: IdenticalUnitResolution[];
  replayOperations: PlannedReplayOperation[];
  provenance: Array<{
    targetObject: string;
    sourceCapsule: CandidateCapsuleRef;
    sourceUnitId: string;
    sourceOperationIds: string[];
  }>;
  dryRun: {
    status: 'passed' | 'failed';
    finalObjectFingerprints: Record<string, string>;
    errors: Array<{ code: string; message: string; operationIndex?: number }>;
  };
  planFingerprint: string;
}

export type IntegrationPlanDraft = Omit<IntegrationPlan, 'planId' | 'planFingerprint' | 'dryRun'>;

/**
 * 运行时随 comparison 附带的封存 manifest 视图（candidateId→manifest）；
 * 不参与 comparisonFingerprint，也不持久化。buildIntegrationPlan 只信任这些
 * 已随候选验证过的 operations，绝不接受 caller 提供的 replay payload。
 */
export interface ComparisonWithManifests extends CompositionComparison {
  candidateManifests?: Record<string, CompositionManifest>;
}

function invalid(message: string): AuthoringOperationError {
  return new AuthoringOperationError('COMPOSITION_PLAN_INVALID', message);
}

/** 指纹校验按固定字段集挑取：运行时附加字段（如 candidateManifests）不参与。 */
const FINGERPRINT_FIELDS = [
  'comparisonVersion',
  'projectIdentity',
  'expectedProjectRevision',
  'status',
  'candidates',
  'units',
  'dependencyEdges',
  'conflicts',
  'identicalGroups',
  'evidenceMatrix',
] as const;

async function verifyComparisonFingerprint(comparison: CompositionComparison, hasher: { sha256(text: string): Promise<string> }): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const field of FINGERPRINT_FIELDS) {
    if (!(field in comparison)) throw invalid(`comparison 缺少字段 ${field}`);
    payload[field] = comparison[field];
  }
  const expected = await hasher.sha256(stableStringify(payload));
  if (expected !== comparison.comparisonFingerprint) {
    throw invalid('comparisonFingerprint 与内容不符');
  }
}

export interface BuildIntegrationPlanInput {
  comparison: CompositionComparison;
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  now: string;
}

function conflictUnresolved(message: string): AuthoringOperationError {
  return new AuthoringOperationError('COMPOSITION_CONFLICT_UNRESOLVED', message);
}

export async function buildIntegrationPlan(
  input: BuildIntegrationPlanInput,
  hasher: { sha256(text: string): Promise<string> },
): Promise<IntegrationPlanDraft> {
  const { comparison } = input;
  await verifyComparisonFingerprint(comparison, hasher);

  // Step 2.2：selectedUnitIds 唯一且存在。
  const unitsById = new Map<string, ObjectChangeUnit>();
  for (const unit of comparison.units) unitsById.set(unit.unitId, unit);
  const selectedSet = new Set(input.selectedUnitIds);
  if (selectedSet.size !== input.selectedUnitIds.length) {
    throw invalid('selectedUnitIds 含重复项');
  }
  for (const unitId of selectedSet) {
    if (!unitsById.has(unitId)) throw invalid(`selectedUnitId 不存在于 comparison：${unitId}`);
  }

  // Step 2.3：requiredUnitIds 传递闭包。
  const included = new Set(selectedSet);
  const implicitInclusions: string[] = [];
  let frontier = [...selectedSet];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const unitId of frontier) {
      const unit = unitsById.get(unitId)!;
      for (const requiredId of unit.requiredUnitIds) {
        if (included.has(requiredId)) continue;
        const requiredUnit = unitsById.get(requiredId);
        if (requiredUnit === undefined) {
          throw new AuthoringOperationError('COMPOSITION_DEPENDENCY_MISSING', `选择闭包找不到必要单元：${requiredId}`);
        }
        included.add(requiredId);
        implicitInclusions.push(requiredId);
        next.push(requiredId);
      }
    }
    frontier = next;
  }
  implicitInclusions.sort();

  // Step 2.4-2.5：selection-required 裁决必须恰有一条且合法。
  const selectionConflicts = comparison.conflicts.filter((item) => item.severity === 'selection-required');
  const resolutionsByConflict = new Map<string, ConflictResolutionInput>();
  for (const resolution of input.conflictResolutions) {
    if (resolutionsByConflict.has(resolution.conflictId)) {
      throw invalid(`同一 conflict 出现多条裁决：${resolution.conflictId}`);
    }
    resolutionsByConflict.set(resolution.conflictId, resolution);
  }
  for (const conflictId of resolutionsByConflict.keys()) {
    if (!selectionConflicts.some((item) => item.conflictId === conflictId)) {
      throw invalid(`裁决指向非 selection-required 冲突：${conflictId}`);
    }
  }
  const identicalPeersByUnit = new Map<string, Set<string>>();
  for (const group of comparison.identicalGroups) {
    for (const unitId of group.unitIds) {
      const peers = identicalPeersByUnit.get(unitId) ?? new Set<string>();
      for (const peerId of group.unitIds) peers.add(peerId);
      identicalPeersByUnit.set(unitId, peers);
    }
  }
  const excluded = new Set<string>();
  for (const conflict of selectionConflicts) {
    const resolution = resolutionsByConflict.get(conflict.conflictId);
    if (resolution === undefined) {
      throw conflictUnresolved(`selection-required 冲突缺少裁决：${conflict.conflictId}`);
    }
    if (resolution.resolution === 'choose-unit') {
      if (resolution.chosenUnitId === undefined || !conflict.unitIds.includes(resolution.chosenUnitId)) {
        throw invalid(`choose-unit 的 chosenUnitId 不在该冲突允许列表中：${conflict.conflictId}`);
      }
      const equivalentUnits = identicalPeersByUnit.get(resolution.chosenUnitId) ?? new Set([resolution.chosenUnitId]);
      for (const unitId of conflict.unitIds) {
        if (!equivalentUnits.has(unitId)) excluded.add(unitId);
      }
    } else if (resolution.resolution === 'exclude-all') {
      for (const unitId of conflict.unitIds) excluded.add(unitId);
    } else {
      // regenerate-candidate：该候选全部单元出局，不伪造 replay。
      for (const unit of comparison.units) {
        if (conflict.candidateIds.includes(unit.candidateId)) excluded.add(unit.unitId);
      }
    }
  }
  for (const unitId of excluded) included.delete(unitId);

  // Step 2.7：拒绝仍含 blocking 的可执行计划。
  for (const conflict of comparison.conflicts) {
    if (conflict.severity !== 'blocking' || conflict.unitIds.length === 0) continue;
    for (const unitId of conflict.unitIds) {
      if (included.has(unitId)) {
        throw invalid(`blocking 冲突涉及的单元仍在计划内：${conflict.code} ${unitId}`);
      }
    }
  }

  const candidateRefById = new Map<string, CandidateCapsuleRef>();
  const manifestByCandidate = new Map<string, CompositionManifest>();
  const withManifests = comparison as ComparisonWithManifests;
  for (const refEntry of comparison.candidates) {
    const candidateId = `cand-${refEntry.changeId}`;
    void candidateId; // candidateId 由 units 携带；refs 按 changeId 索引即可。
  }
  for (const unit of comparison.units) {
    if (!candidateRefById.has(unit.candidateId)) {
      const changeId = unit.candidateId.startsWith('cand-') ? unit.candidateId.slice(5) : unit.candidateId;
      const refEntry = comparison.candidates.find((item) => item.changeId === changeId);
      if (refEntry !== undefined) candidateRefById.set(unit.candidateId, refEntry);
    }
  }
  if (withManifests.candidateManifests !== undefined) {
    for (const [candidateId, manifest] of Object.entries(withManifests.candidateManifests)) {
      manifestByCandidate.set(candidateId, manifest);
    }
  }

  // Step 2.6：identical group 去重——保留显式裁决者或最小 unitId，provenance 记录全体。
  const deduplicatedUnits: IdenticalUnitResolution[] = [];
  const suppressedUnits = new Set<string>();
  for (const group of comparison.identicalGroups) {
    // 组内任一成员入选即代表整个 group；其余成员既不吸入也不重复 replay。
    const present = group.unitIds.filter((unitId) => included.has(unitId));
    if (present.length === 0) continue;
    const explicit = present.find((unitId) =>
      input.conflictResolutions.some((item) => item.resolution === 'choose-unit' && item.chosenUnitId === unitId));
    const retained = explicit ?? [...present].sort()[0]!;
    deduplicatedUnits.push({ groupId: group.groupId, retainedUnitId: retained, provenanceUnitIds: [...group.unitIds].sort() });
    for (const unitId of present) {
      if (unitId !== retained) suppressedUnits.add(unitId);
    }
  }
  for (const unitId of suppressedUnits) included.delete(unitId);

  // Step 2.9 前置：拓扑排序（Kahn）；同层按 primaryObject、capsule SHA、最小 source sequence。
  const orderedUnits: ObjectChangeUnit[] = [];
  {
    const remaining = new Set(included);
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const unitId of remaining) {
      const unit = unitsById.get(unitId)!;
      const deps = unit.requiredUnitIds.filter((id) => remaining.has(id) && id !== unitId);
      inDegree.set(unitId, deps.length);
      for (const dep of deps) {
        dependents.set(dep, [...(dependents.get(dep) ?? []), unitId]);
      }
    }
    while (remaining.size > 0) {
      const layer = [...remaining]
        .filter((unitId) => (inDegree.get(unitId) ?? 0) === 0)
        .map((unitId) => unitsById.get(unitId)!)
        .sort((left, right) =>
          left.primaryObject.localeCompare(right.primaryObject)
          || (candidateRefById.get(left.candidateId)?.artifactSha256 ?? '').localeCompare(candidateRefById.get(right.candidateId)?.artifactSha256 ?? '')
          || Math.min(...left.operationSequences) - Math.min(...right.operationSequences)
          || left.unitId.localeCompare(right.unitId));
      if (layer.length === 0) throw invalid('选择闭包存在依赖环');
      for (const unit of layer) {
        orderedUnits.push(unit);
        remaining.delete(unit.unitId);
        for (const dependent of dependents.get(unit.unitId) ?? []) {
          inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
        }
      }
    }
  }

  // Step 2.8-2.9：从 comparison 内已验证 manifest 构造 replayOperations 与稳定 ID。
  const replayOperations: PlannedReplayOperation[] = [];
  for (let index = 0; index < orderedUnits.length; index += 1) {
    const unit = orderedUnits[index]!;
    const sourceCapsule = candidateRefById.get(unit.candidateId);
    if (sourceCapsule === undefined) throw invalid(`单元缺少候选引用：${unit.candidateId}`);
    const manifest = manifestByCandidate.get(unit.candidateId);
    if (manifest === undefined) {
      throw invalid(`comparison 未随附候选 manifest（candidateManifests）：${unit.candidateId}`);
    }
    const bySequence = new Map(manifest.operations.map((item) => [item.sequence, item]));
    for (const sequence of unit.operationSequences) {
      const op = bySequence.get(sequence);
      if (op === undefined) throw invalid(`manifest 缺少 operation sequence ${sequence}：${unit.candidateId}`);
      const digestSeed = stableStringify({ capsule: sourceCapsule, operation: op });
      const digest = await hasher.sha256(digestSeed);
      replayOperations.push({
        ...op,
        integrationOperationId: `cmp_${comparison.comparisonFingerprint.slice(0, 12)}_${String(index).padStart(4, '0')}_${digest.slice(0, 12)}`,
        sourceCapsule,
        sourceUnitId: unit.unitId,
      });
    }
  }

  // provenance：targetObject → 封存来源。
  const provenance: IntegrationPlanDraft['provenance'] = [];
  for (const unit of orderedUnits) {
    const sourceCapsule = candidateRefById.get(unit.candidateId)!;
    const manifest = manifestByCandidate.get(unit.candidateId)!;
    const bySequence = new Map(manifest.operations.map((item) => [item.sequence, item]));
    const seenTargets = new Map<string, string[]>();
    for (const sequence of unit.operationSequences) {
      const op = bySequence.get(sequence);
      if (op === undefined) continue;
      for (const producedItem of op.producedObjects) {
        seenTargets.set(producedItem.objectRef, [...(seenTargets.get(producedItem.objectRef) ?? []), op.sourceOperationId]);
      }
    }
    for (const targetObject of [...seenTargets.keys()].sort()) {
      provenance.push({
        targetObject,
        sourceCapsule,
        sourceUnitId: unit.unitId,
        sourceOperationIds: seenTargets.get(targetObject)!,
      });
    }
  }

  const conflictResolutions: ConflictResolution[] = input.conflictResolutions.map((item) => ({
    ...item,
    decidedAt: input.now,
  }));

  return {
    planVersion: '1.0.0',
    projectIdentity: comparison.projectIdentity,
    expectedProjectRevision: comparison.expectedProjectRevision,
    comparisonFingerprint: comparison.comparisonFingerprint,
    sourceCapsules: comparison.candidates,
    selectedUnitIds: [...selectedSet].sort(),
    implicitInclusions,
    excludedUnitIds: [...excluded].sort(),
    conflictResolutions,
    deduplicatedUnits,
    replayOperations,
    provenance,
  };
}

/**
 * sealDryRunResult 对规范投影计算最终 planFingerprint：
 * draft 全部语义字段 + dryRun status/final fingerprints/error code/index；
 * 排除 planId/planFingerprint/decidedAt/reason/自然语言 message。planId 从该指纹派生。
 */
export async function sealDryRunResult(
  draft: IntegrationPlanDraft,
  dryRun: IntegrationPlan['dryRun'],
  hasher: { sha256(text: string): Promise<string> },
): Promise<IntegrationPlan> {
  const semantic = {
    planVersion: draft.planVersion,
    projectIdentity: draft.projectIdentity,
    expectedProjectRevision: draft.expectedProjectRevision,
    comparisonFingerprint: draft.comparisonFingerprint,
    sourceCapsules: draft.sourceCapsules,
    selectedUnitIds: draft.selectedUnitIds,
    implicitInclusions: draft.implicitInclusions,
    excludedUnitIds: draft.excludedUnitIds,
    conflictResolutions: draft.conflictResolutions.map(({ decidedAt, reason, ...rest }) => {
      void decidedAt;
      void reason;
      return rest;
    }),
    deduplicatedUnits: draft.deduplicatedUnits,
    replayOperations: draft.replayOperations,
    provenance: draft.provenance,
    dryRun: {
      status: dryRun.status,
      finalObjectFingerprints: dryRun.finalObjectFingerprints,
      errors: dryRun.errors.map((error) => ({
        code: error.code,
        ...(error.operationIndex === undefined ? {} : { operationIndex: error.operationIndex }),
      })),
    },
  };
  const planFingerprint = await hasher.sha256(stableStringify(semantic));
  return {
    ...draft,
    dryRun,
    planFingerprint,
    planId: `pln_${planFingerprint.slice(0, 32)}`,
  };
}
