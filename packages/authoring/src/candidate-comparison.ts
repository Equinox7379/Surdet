import { compareCanonicalText } from './canonical-order.js';
import { AuthoringOperationError, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
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

/** A sealed version, not its mutable source change, is the comparison candidate. */
export function candidateCapsuleIdentity(ref: CandidateCapsuleRef): string {
  return `cand-${ref.changeId}-${ref.capsuleId}`;
}

function invalidRequest(message: string): AuthoringOperationError {
  return new AuthoringOperationError('INVALID_REQUEST', message);
}

function compareByRef(left: VerifiedCompositionCandidate, right: VerifiedCompositionCandidate): number {
  return compareCanonicalText(left.ref.artifactSha256, right.ref.artifactSha256)
    || compareCanonicalText(left.ref.changeId, right.ref.changeId)
    || compareCanonicalText(left.ref.capsuleId, right.ref.capsuleId);
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

function finalUnitFootprint(unit: ObjectChangeUnit): ObjectProduction[] {
  return [...new Set(unit.producedObjects.map((item) => item.objectRef))].sort()
    .map((objectRef) => finalUnitProduction(unit, objectRef)!);
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
      for (const requirement of [...item.requiredObjects, ...item.replayStateRequirements ?? []]) {
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
      replayState: operations.flatMap((item) => item.replayStateRequirements ?? []),
    };
    built.push({
      unit: {
        unitId: '',
        candidateId: candidate.candidateId,
        primaryObject,
        operationSequences: operations.map((item) => item.sequence),
        ...(finalForPrimary?.finalFingerprint === undefined ? {} : { finalFingerprint: finalForPrimary.finalFingerprint }),
        requiredUnitIds: [],
        requiredBaseObjects: operations.flatMap((item) => [...item.requiredObjects, ...item.replayStateRequirements ?? []].filter((entry) => entry.source === 'base')),
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
  const seenCandidates = new Set<string>();
  for (const candidate of input.candidates) {
    const identity = candidateCapsuleIdentity(candidate.ref);
    if (seenCandidates.has(identity)) throw invalidRequest(`候选引用重复：${identity}`);
    seenCandidates.add(identity);
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
  const footprints = new Map(units.map((unit) => [unit.unitId, finalUnitFootprint(unit)]));
  const entryByUnit = new Map(workingUnits.map((entry) => [entry.unit.unitId, entry]));
  const signatures = new Map<string, string>();
  const signatureOf = async (unit: ObjectChangeUnit, visiting = new Set<string>()): Promise<string> => {
    const cached = signatures.get(unit.unitId);
    if (cached !== undefined) return cached;
    if (visiting.has(unit.unitId)) return `blocked-cycle:${unit.unitId}`;
    const next = new Set(visiting).add(unit.unitId);
    const requirements: string[] = [];
    for (const operation of entryByUnit.get(unit.unitId)!.operations) {
      for (const [kind, items] of [['semantic', operation.requiredObjects], ['replay-state', operation.replayStateRequirements ?? []]] as const) {
        for (const requirement of items) {
          const producer = requirement.source === 'candidate'
            ? unitByCandidateAndSequence.get(`${unit.candidateId}\u0000${requirement.candidateOperationSequence}`) : undefined;
          // Internal steps are replayed together and are not external dependency semantics.
          if (producer?.unitId === unit.unitId) continue;
          requirements.push(stableStringify({
            kind, objectRef: requirement.objectRef, source: requirement.source,
            expectedFingerprint: requirement.expectedFingerprint,
            ...(requirement.source === 'candidate' ? { producer: producer === undefined ? 'missing' : await signatureOf(producer, next) } : {}),
          }));
        }
      }
    }
    const signature = await sha256Text(stableStringify({ primaryObject: unit.primaryObject,
      footprint: footprints.get(unit.unitId), requirements: [...new Set(requirements)].sort() }));
    signatures.set(unit.unitId, signature);
    return signature;
  };
  const bySignature = new Map<string, ObjectChangeUnit[]>();
  for (const unit of units) {
    const signature = await signatureOf(unit);
    const bucket = bySignature.get(signature) ?? [];
    bucket.push(unit);
    bySignature.set(signature, bucket);
  }
  for (const [signature, bucket] of bySignature) {
    const first = bucket[0]!;
    if (bucket.length < 2 || first.finalFingerprint === undefined
      || footprints.get(first.unitId)!.some((item) => item.disposition !== 'remove' && item.finalFingerprint === undefined)) continue;
    const unitIds = bucket.map((unit) => unit.unitId).sort();
    identicalGroups.push({ groupId: (await sha256Text(stableStringify({ signature, unitIds }))).slice(0, 32),
      unitIds, primaryObject: first.primaryObject, finalFingerprint: first.finalFingerprint });
  }
  const byObject = new Map<string, ObjectChangeUnit[]>();
  for (const unit of units) {
    for (const production of footprints.get(unit.unitId)!) {
      const bucket = byObject.get(production.objectRef) ?? [];
      bucket.push(unit);
      byObject.set(production.objectRef, bucket);
    }
  }
  for (const [objectRef, writers] of byObject) {
    const candidates = new Set(writers.map((unit) => unit.candidateId));
    if (candidates.size < 2) continue;
    // A shared state chain within one candidate is ordered, never a self-conflict.
    // Split mixed buckets into cross-candidate pairs so choosing a source cannot
    // exclude another necessary writer from that same source.
    const buckets = candidates.size === writers.length ? [writers] : writers.flatMap((left, index) =>
      writers.slice(index + 1).filter((right) => left.candidateId !== right.candidateId).map((right) => [left, right]));
    for (const bucket of buckets) {
      if (identicalGroups.some((group) => bucket.every((unit) => group.unitIds.includes(unit.unitId)))) continue;
      softReviewOnly = true;
      conflicts.push(await makeConflict(hasher, {
      severity: 'selection-required',
      code: 'OBJECT_RESULTS_DIVERGE',
      candidateIds: [...new Set(bucket.map((unit) => unit.candidateId))].sort(),
      unitIds: [...bucket].sort((left, right) => compareCanonicalText(left.unitId, right.unitId)).map((unit) => unit.unitId),
      objectRefs: [objectRef],
      allowedResolutions: ['choose-unit', 'exclude-all'],
      details: {
        signatures: [...bucket]
          .sort((left, right) => compareCanonicalText(left.unitId, right.unitId))
          .map((unit) => ({ unitId: unit.unitId, signature: signatures.get(unit.unitId)! })),
      },
      repairActions: ['选择一个单元并排除其余', '全部排除后重新规划'],
      }));
    }
  }

  const removedRefs: Array<[string, ObjectChangeUnit]> = [];
  for (const unit of units) {
    for (const objectRef of new Set(unit.producedObjects.map((production) => production.objectRef))) {
      if (finalUnitProduction(unit, objectRef)?.disposition === 'remove') removedRefs.push([objectRef, unit]);
    }
  }
  for (const [objectRef, removerUnit] of removedRefs) {
    const dependent = units.filter((unit) =>
      unit.unitId !== removerUnit.unitId
      && unit.candidateId !== removerUnit.candidateId
      && unit.requiredBaseObjects.some((requirement) => requirement.objectRef === objectRef));
    if (dependent.length === 0) continue;
    softReviewOnly = true;
    // Dependents may coexist with each other: each conflicts only with removal.
    for (const dependency of dependent) {
      conflicts.push(await makeConflict(hasher, {
        severity: 'selection-required',
        code: 'REQUIRED_OBJECT_REMOVED',
        candidateIds: [removerUnit.candidateId, dependency.candidateId].sort(),
        unitIds: [removerUnit.unitId, dependency.unitId].sort(),
        objectRefs: [objectRef],
        allowedResolutions: ['choose-unit', 'exclude-all'],
        details: {},
        repairActions: ['在移除与依赖之间做出裁决', '排除移除方单元'],
      }));
    }
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
    compareCanonicalText(left.primaryObject, right.primaryObject) || compareCanonicalText(left.candidateId, right.candidateId));
  dependencyEdges.sort((left, right) =>
    compareCanonicalText(left.fromUnitId, right.fromUnitId)
    || compareCanonicalText(left.toUnitId, right.toUnitId)
    || compareCanonicalText(left.objectRef, right.objectRef));
  conflicts.sort((left, right) => compareCanonicalText(left.conflictId, right.conflictId));
  identicalGroups.sort((left, right) => compareCanonicalText(left.groupId, right.groupId));

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
