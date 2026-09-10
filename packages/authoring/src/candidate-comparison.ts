import { AuthoringOperationError, stableStringify } from './change-session.js';
import type {
  CompositionComparison,
  CompositionConflict,
  CompositionManifest,
  CompositionOperation,
  IdenticalUnitGroup,
  ObjectChangeUnit,
  ObjectProduction,
  VerifiedCompositionCandidate,
  CandidateEvidenceSummary,
  CompositionDependencyEdge,
} from './composition-contracts.js';
import type { TextHasher } from './contracts.js';
import { buildPrimaryObjectDependencyGraph } from './composition-unit-graph.js';

const MAX_CANDIDATES = 8;
const MAX_OPERATIONS_PER_CANDIDATE = 256;
const MAX_DEPENDENCY_EDGES = 1024;

function invalidRequest(message: string): AuthoringOperationError {
  return new AuthoringOperationError('INVALID_REQUEST', message);
}

function compareByRef(left: VerifiedCompositionCandidate, right: VerifiedCompositionCandidate): number {
  return left.ref.artifactSha256.localeCompare(right.ref.artifactSha256)
    || left.ref.changeId.localeCompare(right.ref.changeId)
    || left.ref.capsuleId.localeCompare(right.ref.capsuleId);
}

interface WorkingUnit {
  unit: ObjectChangeUnit;
  /** source='candidate' 且已确认指向更早产物的依赖（用于建边）。 */
  dependencyEdges: CompositionDependencyEdge[];
  /** source='candidate' 但没有任何更早 operation 产出对应对象：结构阻断。 */
  brokenDependency: boolean;
  seed: Record<string, unknown>;
  operations: CompositionOperation[];
}

async function makeConflict(
  hasher: TextHasher,
  spec: Omit<CompositionConflict, 'conflictId'>,
): Promise<CompositionConflict> {
  return { conflictId: (await hasher.sha256(stableStringify(spec))).slice(0, 32), ...spec };
}

function collectImpacts(candidate: VerifiedCompositionCandidate): { potentialImpact: unknown[]; observedImpact: unknown[] } {
  const potentialImpact: unknown[] = [];
  const observedImpact: unknown[] = [];
  for (const entry of candidate.semanticDiff) {
    potentialImpact.push(...entry.potentialImpact);
    observedImpact.push(...entry.observedImpact);
  }
  return { potentialImpact, observedImpact };
}

function finalUnitProduction(unit: ObjectChangeUnit, objectRef: string): ObjectProduction | undefined {
  const productions = unit.producedObjects.filter((item) => item.objectRef === objectRef);
  const final = productions[productions.length - 1];
  if (final === undefined || final.disposition === 'remove') return final;
  // A create followed by patches is still one creation relative to the common base.
  return { ...final, disposition: productions[0]!.disposition === 'create' ? 'create' : 'update' };
}

/** 按 candidate+primaryObject 分组构建不可拆单元；unitId 只由规范种子哈希派生。 */
function buildUnitsForEligibleCandidate(
  candidate: VerifiedCompositionCandidate,
  manifest: CompositionManifest,
  graph: ReturnType<typeof buildPrimaryObjectDependencyGraph>,
): WorkingUnit[] {
  if (manifest.operations.length > MAX_OPERATIONS_PER_CANDIDATE) {
    throw invalidRequest(`候选 ${candidate.candidateId} 的 manifest operation 超过上限 ${MAX_OPERATIONS_PER_CANDIDATE}`);
  }
  const impacts = collectImpacts(candidate);
  // candidate 依赖解析必须看全 manifest 的产物（producer 常在另一个对象组里）。
  const producedBySequence = new Map<number, ObjectProduction[]>();
  for (const item of manifest.operations) producedBySequence.set(item.sequence, item.producedObjects);
  const built: WorkingUnit[] = [];
  for (const { primaryObject, operationSequences } of graph.groups) {
    const items = manifest.operations.filter((item) => operationSequences.includes(item.sequence));
    const operations = [...items].sort((left, right) => left.sequence - right.sequence);
    const finalForPrimary = [...operations]
      .reverse()
      .flatMap((item) => item.producedObjects)
      .find((production) => production.objectRef === primaryObject);

    let brokenDependency = false;
    for (const item of operations) {
      for (const requirement of item.requiredObjects) {
        if (requirement.source === 'base') continue;
        const producerSequence = requirement.candidateOperationSequence;
        const productions = producerSequence === undefined ? undefined : producedBySequence.get(producerSequence);
        if (producerSequence === undefined || producerSequence >= item.sequence || productions === undefined || !productions.some((production) => production.objectRef === requirement.objectRef && production.disposition !== 'remove')) {
          brokenDependency = true;
          continue;
        }
      }
    }

    // unitId 种子只含 artifact SHA / 对象 / 序列 / 产物与依赖事实；不含时间、label、intent、路径。
    const seed = {
      artifactSha256: candidate.ref.artifactSha256,
      primaryObject,
      operationSequences: operations.map((item) => item.sequence),
      produced: operations.flatMap((item) => item.producedObjects),
      required: operations.flatMap((item) => item.requiredObjects),
    };
    built.push({
      unit: {
        unitId: '',
        candidateId: candidate.candidateId,
        primaryObject,
        operationSequences: operations.map((item) => item.sequence),
        ...(finalForPrimary?.finalFingerprint === undefined ? {} : { finalFingerprint: finalForPrimary.finalFingerprint }),
        requiredUnitIds: [],
        requiredBaseObjects: operations.flatMap((item) => item.requiredObjects.filter((entry) => entry.source === 'base')),
        producedObjects: operations.flatMap((item) => item.producedObjects),
        ...impacts,
        evidenceSummary: candidate.evidenceSummary satisfies CandidateEvidenceSummary,
      },
      dependencyEdges: graph.edges.filter((edge) => edge.fromPrimaryObject === primaryObject),
      brokenDependency,
      seed,
      operations,
    });
  }
  return built;
}

export interface CompareCandidatesInput {
  projectIdentity: string;
  currentProjectRevision: string;
  candidates: VerifiedCompositionCandidate[];
}

export async function compareCandidates(
  input: CompareCandidatesInput,
  hasher: TextHasher,
): Promise<CompositionComparison> {
  // 规格 5.4：比较输入限制为 2..8 个候选。
  if (input.candidates.length < 2 || input.candidates.length > MAX_CANDIDATES) {
    throw invalidRequest(`候选数量必须在 2..${MAX_CANDIDATES} 之间：${input.candidates.length}`);
  }
  const sha256Text = async (text: string) => hasher.sha256(text);

  // Step 4：候选先按 artifactSha256、changeId、capsuleId 规范排序。
  const sorted = [...input.candidates].sort(compareByRef);
  const conflicts: CompositionConflict[] = [];
  const units: ObjectChangeUnit[] = [];
  const dependencyEdges: Array<{ fromUnitId: string; toUnitId: string; objectRef: string }> = [];
  const identicalGroups: IdenticalUnitGroup[] = [];

  let hardBlocked = false;
  let softReviewOnly = false;

  // ---- 第一层：身份与合成资格（规则1：manifest/artifact/project/base 无效 → blocking）----
  const eligible: Array<{ candidate: VerifiedCompositionCandidate; manifest: CompositionManifest }> = [];
  const referenceBase = sorted[0]!.baseProjectRevision;
  for (const candidate of sorted) {
    if (candidate.projectIdentity !== input.projectIdentity) {
      hardBlocked = true;
      conflicts.push(await makeConflict(hasher, {
        severity: 'blocking',
        code: 'CANDIDATE_PROJECT_MISMATCH',
        candidateIds: [candidate.candidateId],
        unitIds: [],
        objectRefs: [],
        allowedResolutions: ['regenerate-candidate'],
        details: { expected: input.projectIdentity, actual: candidate.projectIdentity },
        repairActions: ['在正确项目中重新创建候选胶囊'],
      }));
      continue;
    }
    if (candidate.baseProjectRevision !== referenceBase) {
      hardBlocked = true;
      conflicts.push(await makeConflict(hasher, {
        severity: 'blocking',
        code: 'CANDIDATE_BASE_MISMATCH',
        candidateIds: [candidate.candidateId],
        unitIds: [],
        objectRefs: [],
        allowedResolutions: ['regenerate-candidate'],
        details: { expectedBase: referenceBase, actualBase: candidate.baseProjectRevision },
        repairActions: ['在同一基线上重新创建候选'],
      }));
      continue;
    }
    if (candidate.capsuleVersion !== '2.0.0' || candidate.composition.eligibility !== 'ready'
      || candidate.composition.manifest === undefined) {
      softReviewOnly = true;
      conflicts.push(await makeConflict(hasher, {
        severity: 'blocking',
        code: 'CANDIDATE_NOT_COMPOSABLE',
        candidateIds: [candidate.candidateId],
        unitIds: [],
        objectRefs: [],
        allowedResolutions: ['regenerate-candidate'],
        details: {
          capsuleVersion: candidate.capsuleVersion,
          eligibility: candidate.composition.eligibility,
          reasonCodes: candidate.composition.reasons.map((reason) => reason.code),
        },
        repairActions: ['重新创建包含 v2 composable manifest 的候选胶囊'],
      }));
      continue;
    }
    eligible.push({ candidate, manifest: candidate.composition.manifest });
  }

  // ---- 第二层：不可拆单元；边上限在建图前保护（规则2：缺强依赖 → blocking）----
  const workingUnits: WorkingUnit[] = [];
  const candidateGraphs = eligible.map(({ candidate, manifest }) => ({ candidate, manifest, graph: buildPrimaryObjectDependencyGraph(manifest.operations.map((operation) => ({ ...operation, operationId: operation.sourceOperationId }))) }));
  for (const { candidate, manifest, graph } of candidateGraphs) {
    workingUnits.push(...buildUnitsForEligibleCandidate(candidate, manifest, graph));
  }
  let edgeBudget = 0;
  for (const entry of workingUnits) {
    edgeBudget += entry.unit.requiredBaseObjects.length + entry.dependencyEdges.length;
  }
  if (edgeBudget > MAX_DEPENDENCY_EDGES) {
    throw invalidRequest(`候选依赖边总数超过上限 ${MAX_DEPENDENCY_EDGES}：${edgeBudget}`);
  }

  const unitByCandidateAndSequence = new Map<string, ObjectChangeUnit>();
  for (const entry of workingUnits) {
    entry.unit.unitId = (await sha256Text(stableStringify(entry.seed))).slice(0, 32);
    units.push(entry.unit);
    for (const sequence of entry.unit.operationSequences) {
      unitByCandidateAndSequence.set(`${entry.unit.candidateId}\u0000${sequence}`, entry.unit);
    }
  }
  for (const entry of workingUnits) {
    if (entry.brokenDependency) {
      hardBlocked = true;
      conflicts.push(await makeConflict(hasher, {
        severity: 'blocking',
        code: 'DEPENDENCY_IDENTITY_UNAVAILABLE',
        candidateIds: [entry.unit.candidateId],
        unitIds: [entry.unit.unitId],
        objectRefs: entry.unit.producedObjects.map((item) => item.objectRef),
        allowedResolutions: ['regenerate-candidate'],
        details: {},
        repairActions: ['重新创建依赖闭合完整的候选'],
      }));
    }
    for (const link of entry.dependencyEdges) {
      const producerUnit = unitByCandidateAndSequence.get(`${entry.unit.candidateId}\u0000${link.producerSequence}`);
      if (producerUnit === undefined || producerUnit.unitId === entry.unit.unitId) continue;
      if (!entry.unit.requiredUnitIds.includes(producerUnit.unitId)) entry.unit.requiredUnitIds.push(producerUnit.unitId);
      dependencyEdges.push({
        fromUnitId: entry.unit.unitId,
        toUnitId: producerUnit.unitId,
        objectRef: link.objectRef,
      });
    }
    entry.unit.requiredUnitIds.sort();
  }
  for (const { candidate, graph } of candidateGraphs) {
    for (const cycle of graph.cycles) {
      hardBlocked = true;
      conflicts.push(await makeConflict(hasher, {
        severity: 'blocking', code: 'DEPENDENCY_CYCLE', candidateIds: [candidate.candidateId],
        unitIds: units.filter((unit) => unit.candidateId === candidate.candidateId && cycle.primaryObjects.includes(unit.primaryObject)).map((unit) => unit.unitId).sort(),
        objectRefs: cycle.primaryObjects, allowedResolutions: ['regenerate-candidate'],
        details: { primaryObjects: cycle.primaryObjects, edges: cycle.edges.map((edge) => ({ ...edge })) },
        repairActions: ['改为单向依赖后重新创建候选；互相创建空骨架不能解除对象单元的依赖环'],
      }));
    }
  }

  // ---- 第三层：对象重叠（规则3 identical / 规则4 selection-required / 规则5 remove-vs-required）----
  const byObject = new Map<string, ObjectChangeUnit[]>();
  for (const unit of units) {
    const bucket = byObject.get(unit.primaryObject) ?? [];
    bucket.push(unit);
    byObject.set(unit.primaryObject, bucket);
  }
  const signatureOf = (unit: ObjectChangeUnit, objectRef: string): string => {
    const production = finalUnitProduction(unit, objectRef);
    return `${production?.disposition ?? '?'}\u0000${production?.finalFingerprint ?? '?'}`;
  };
  for (const [objectRef, bucket] of byObject) {
    if (bucket.length < 2) continue;
    const bySignature = new Map<string, ObjectChangeUnit[]>();
    for (const unit of bucket) {
      const signature = signatureOf(unit, objectRef);
      const signatureBucket = bySignature.get(signature) ?? [];
      signatureBucket.push(unit);
      bySignature.set(signature, signatureBucket);
    }
    let wholeBucketIdentical = false;
    for (const [, signatureBucket] of [...bySignature.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const production = finalUnitProduction(signatureBucket[0]!, objectRef);
      if (signatureBucket.length < 2 || production?.finalFingerprint === undefined) continue;
      // 相同对象桶内也要按精确结果签名形成子组。A/D 相同而 C 不同时，
      // A/D 的 provenance 仍必须保留，C 则继续参与 selection-required 冲突。
      const orderedUnits = [...signatureBucket].sort((left, right) => left.unitId.localeCompare(right.unitId));
      const groupId = (await sha256Text(stableStringify({
        primaryObject: objectRef,
        finalFingerprint: production.finalFingerprint,
        unitIds: orderedUnits.map((unit) => unit.unitId),
      }))).slice(0, 32);
      identicalGroups.push({
        groupId,
        unitIds: orderedUnits.map((unit) => unit.unitId),
        primaryObject: objectRef,
        finalFingerprint: production.finalFingerprint,
      });
      wholeBucketIdentical = bySignature.size === 1 && signatureBucket.length === bucket.length;
    }
    if (wholeBucketIdentical) continue;
    softReviewOnly = true;
    conflicts.push(await makeConflict(hasher, {
      severity: 'selection-required',
      code: 'OBJECT_RESULTS_DIVERGE',
      candidateIds: [...new Set(bucket.map((unit) => unit.candidateId))].sort(),
      unitIds: [...bucket].sort((left, right) => left.unitId.localeCompare(right.unitId)).map((unit) => unit.unitId),
      objectRefs: [objectRef],
      allowedResolutions: ['choose-unit', 'exclude-all'],
      details: {
        signatures: [...bucket]
          .sort((left, right) => left.unitId.localeCompare(right.unitId))
          .map((unit) => ({ unitId: unit.unitId, signature: signatureOf(unit, objectRef) })),
      },
      repairActions: ['选择一个单元并排除其余', '全部排除后重新规划'],
    }));
  }

  const removedRefs = new Map<string, ObjectChangeUnit>();
  for (const unit of units) {
    for (const objectRef of new Set(unit.producedObjects.map((production) => production.objectRef))) {
      if (finalUnitProduction(unit, objectRef)?.disposition === 'remove') removedRefs.set(objectRef, unit);
    }
  }
  for (const [objectRef, removerUnit] of removedRefs) {
    const dependent = units.filter((unit) =>
      unit.unitId !== removerUnit.unitId
      && unit.candidateId !== removerUnit.candidateId
      && unit.requiredBaseObjects.some((requirement) => requirement.objectRef === objectRef));
    if (dependent.length === 0) continue;
    softReviewOnly = true;
    conflicts.push(await makeConflict(hasher, {
      severity: 'selection-required',
      code: 'REQUIRED_OBJECT_REMOVED',
      candidateIds: [...new Set([removerUnit.candidateId, ...dependent.map((unit) => unit.candidateId)])].sort(),
      unitIds: [removerUnit.unitId, ...dependent.map((unit) => unit.unitId)].sort(),
      objectRefs: [objectRef],
      allowedResolutions: ['choose-unit', 'exclude-all'],
      details: {},
      repairActions: ['在移除与依赖之间做出裁决', '排除移除方单元'],
    }));
  }

  // ---- 第四层：证据 advisory（规则7：不伪装结构冲突）----
  const advisoryCandidateIds: string[] = [];
  for (const { candidate } of eligible) {
    const summary = candidate.evidenceSummary;
    if (summary.validation !== 'fresh' || summary.simulation !== 'fresh' || summary.runtime !== 'fresh'
      || summary.warnings > 0 || summary.manualReviewRequired.length > 0) {
      advisoryCandidateIds.push(candidate.candidateId);
    }
  }
  for (const candidateId of advisoryCandidateIds.sort()) {
    conflicts.push(await makeConflict(hasher, {
      severity: 'advisory',
      code: 'EVIDENCE_NOT_FULLY_FRESH',
      candidateIds: [candidateId],
      unitIds: [],
      objectRefs: [],
      allowedResolutions: [],
      details: {},
      repairActions: ['集成后重新取证 diff/validate/simulate/runtime'],
    }));
  }

  // ---- 规范排序与指纹（Step 4）----
  units.sort((left, right) =>
    left.primaryObject.localeCompare(right.primaryObject) || left.candidateId.localeCompare(right.candidateId));
  dependencyEdges.sort((left, right) =>
    left.fromUnitId.localeCompare(right.fromUnitId)
    || left.toUnitId.localeCompare(right.toUnitId)
    || left.objectRef.localeCompare(right.objectRef));
  conflicts.sort((left, right) => left.conflictId.localeCompare(right.conflictId));
  identicalGroups.sort((left, right) => left.groupId.localeCompare(right.groupId));

  const status: CompositionComparison['status'] = hardBlocked
    ? 'blocked'
    : (softReviewOnly || input.currentProjectRevision !== referenceBase) ? 'review-only' : 'composable';

  const fingerprintPayload = {
    comparisonVersion: '1.0.0' as const,
    projectIdentity: input.projectIdentity,
    expectedProjectRevision: input.currentProjectRevision,
    status,
    candidates: sorted.map((candidate) => candidate.ref),
    units,
    dependencyEdges,
    conflicts,
    identicalGroups,
    evidenceMatrix: sorted.map((candidate) => ({
      candidateId: candidate.candidateId,
      summary: candidate.evidenceSummary satisfies CandidateEvidenceSummary,
    })),
  };
  return {
    ...fingerprintPayload,
    comparisonFingerprint: await sha256Text(stableStringify(fingerprintPayload)),
  };
}
