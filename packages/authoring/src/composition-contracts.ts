import type { ChangeStatus } from './contracts.js';

/** 5.1 JSON 与记录操作 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 可进入确定性重放的八项内容 mutation；registry composable 白名单与之严格一致。 */
export type ComposableCapabilityId =
  | 'scene.create'
  | 'scene.patch'
  | 'variable.ensure'
  | 'character.ensure'
  | 'character.remove'
  | 'timeline.create'
  | 'timeline.patch'
  | 'project.entry-scene.set';

/** operation ledger 记录；normalizedInput 仅新记录拥有，旧记录只读保留。 */
export interface RecordedOperation {
  requestHash: string;
  normalizedInput?: JsonValue;
  result: unknown;
}

export const COMPOSABLE_CAPABILITY_IDS: readonly ComposableCapabilityId[] = [
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'project.entry-scene.set',
];

/** 5.2 Manifest 与对象关系 */
export interface ObjectRequirement {
  objectRef: string;
  source: 'base' | 'candidate';
  candidateOperationSequence?: number;
  expectedFingerprint?: string;
}

export interface ObjectProduction {
  objectRef: string;
  disposition: 'create' | 'update' | 'remove';
  finalFingerprint?: string;
}

export interface CompositionOperation {
  sequence: number;
  capabilityId: ComposableCapabilityId;
  sourceOperationId: string;
  normalizedInput: JsonValue;
  inputSha256: string;
  primaryObject: string;
  objectFingerprintBefore?: string;
  objectFingerprintAfter?: string;
  requiredObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
}

export interface CompositionManifest {
  manifestVersion: '1.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  sourceChangeId: string;
  sourceWorkingRevision: number;
  operations: CompositionOperation[];
  manifestFingerprint: string;
}

export interface CompositionIneligibility {
  code:
    | 'LEGACY_CAPSULE'
    | 'MISSING_NORMALIZED_INPUT'
    | 'INVOCATION_FACT_MISSING'
    | 'INVOCATION_FACT_AMBIGUOUS'
    | 'UNSUPPORTED_CAPABILITY'
    | 'OBJECT_IDENTITY_UNAVAILABLE'
    | 'DEPENDENCY_IDENTITY_UNAVAILABLE';
  operationId?: string;
  message: string;
}

export interface ManifestObjectFact {
  objectRef: string;
  references: string[];
  fingerprint?: string;
}

export interface ManifestObjectFacts {
  baseObjects: ManifestObjectFact[];
  workingObjects: ManifestObjectFact[];
  baseAssetRefs: string[];
  workingAssetRefs: string[];
}

/** CLI 将 invocation ledger 投影成的最小结构；@surdet/authoring 不导入 Node 或 MCP 类型。 */
export interface OperationInvocationFact {
  capabilityId: string;
  operationId: string;
  inputSha256: string;
  ok: boolean;
}

/** 5.3 Capsule v2 组合投影 */
export interface CapsuleCompositionProjection {
  eligibility: 'ready' | 'unavailable';
  reasons: CompositionIneligibility[];
  manifest?: CompositionManifest;
}

/** 5.4 候选引用与比较 */
export interface CandidateCapsuleRef {
  changeId: string;
  capsuleId: string;
  artifactSha256: string;
}

export interface CandidateEvidenceSummary {
  validation: 'fresh' | 'missing' | 'stale' | 'failed';
  simulation: 'fresh' | 'missing' | 'stale' | 'failed' | 'incomplete';
  runtime: 'fresh' | 'missing' | 'stale' | 'failed';
  warnings: number;
  manualReviewRequired: string[];
}

export interface ObjectChangeUnit {
  unitId: string;
  candidateId: string;
  primaryObject: string;
  operationSequences: number[];
  finalFingerprint?: string;
  requiredUnitIds: string[];
  requiredBaseObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
  potentialImpact: unknown[];
  observedImpact: unknown[];
  evidenceSummary: CandidateEvidenceSummary;
}

export interface CompositionConflict {
  conflictId: string;
  severity: 'blocking' | 'selection-required' | 'advisory';
  code: string;
  candidateIds: string[];
  unitIds: string[];
  objectRefs: string[];
  allowedResolutions: Array<'choose-unit' | 'exclude-all' | 'regenerate-candidate'>;
  details: Record<string, JsonValue>;
  repairActions: string[];
}

export interface IdenticalUnitGroup {
  groupId: string;
  unitIds: string[];
  primaryObject: string;
  finalFingerprint: string;
}

export interface CompositionComparison {
  comparisonVersion: '1.0.0';
  projectIdentity: string;
  expectedProjectRevision: string;
  status: 'composable' | 'review-only' | 'blocked';
  candidates: CandidateCapsuleRef[];
  units: ObjectChangeUnit[];
  dependencyEdges: Array<{ fromUnitId: string; toUnitId: string; objectRef: string }>;
  conflicts: CompositionConflict[];
  identicalGroups: IdenticalUnitGroup[];
  evidenceMatrix: Array<{ candidateId: string; summary: CandidateEvidenceSummary }>;
  comparisonFingerprint: string;
}

export interface CompositionSemanticDiffEntry {
  kind: string;
  operationId: string;
  objectBefore?: string;
  objectAfter?: string;
  fingerprintBefore?: string;
  fingerprintAfter?: string;
  potentialImpact: unknown[];
  observedImpact: unknown[];
}

export interface VerifiedCompositionCandidate {
  candidateId: string;
  ref: CandidateCapsuleRef;
  capsuleVersion: '1.0.0' | '2.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  sourceWorkingRevision: number;
  composition: CapsuleCompositionProjection;
  evidenceSummary: CandidateEvidenceSummary;
  semanticDiff: CompositionSemanticDiffEntry[];
}
