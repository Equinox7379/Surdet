import type { ChangeStatus, EvidenceFreshness } from './contracts.js';

/** 5.1 JSON 与记录操作 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 可进入确定性重放的内容 mutation；registry composable 白名单与之严格一致。 */
export type ComposableCapabilityId =
  | 'scene.create'
  | 'scene.patch'
  | 'variable.ensure'
  | 'variable.patch-initial'
  | 'character.ensure'
  | 'character.remove'
  | 'timeline.create'
  | 'timeline.patch'
  | 'gallery.cg.create'
  | 'gallery.cg.patch'
  | 'project.entry-scene.set';

/** operation ledger 记录；normalizedInput 仅新记录拥有，旧记录只读保留。 */
export interface RecordedOperation {
  requestHash: string;
  normalizedInput?: JsonValue;
  result: unknown;
  sequence?: number;
  compositionFacts?: RecordedOperationCompositionFacts;
}

export interface ChangeCompositionMetadata {
  mode: 'candidate' | 'direct';
  operationFactsVersion: '1.0.0';
  baseAssetRefs: string[];
}

export type CompositionReferenceKind =
  | 'scene' | 'label' | 'timeline' | 'variable' | 'character' | 'gallery-cg' | 'gallery-text' | 'gallery-profile' | 'gallery-term'
  | 'background-asset' | 'portrait-asset' | 'avatar-asset' | 'rule-asset' | 'audio-asset' | 'video-asset' | 'font-asset';

export interface RawCompositionReference {
  kind: CompositionReferenceKind;
  scope: 'candidate-external' | 'primary-local' | 'non-composition';
  token: string;
  objectRef?: string;
  source: {
    path: string;
    line?: number;
    blockIndex?: number;
    optionIndex?: number;
    trackIndex?: number;
    cueIndex?: number;
  };
}

export interface OperationCompositionDraft {
  capabilityId: ComposableCapabilityId;
  primaryObject: string;
  rawReferences: RawCompositionReference[];
  producedObjects: ObjectProduction[];
  objectFingerprintBefore?: string;
  objectFingerprintAfter?: string;
  /** Exact state consumed by this handler, separate from semantic references. */
  replayStatePreconditions?: ReplayStatePrecondition[];
}

export interface RecordedOperationCompositionFacts extends OperationCompositionDraft {
  factsVersion: '1.0.0';
  requiredObjects: ObjectRequirement[];
  replayStateRequirements?: ReplayStateRequirement[];
}

export interface CandidateDependencyIssue {
  code: 'OBJECT_NOT_ESTABLISHED' | 'ASSET_NOT_RESOLVED' | 'REFERENCE_TARGET_AMBIGUOUS';
  kind: CompositionReferenceKind;
  token: string;
  objectRef?: string;
  source: RawCompositionReference['source'];
  suggestedCapabilities: string[];
  repairStrategy: 'create-before-retry' | 'choose-resolved-asset' | 'inspect-and-retry';
}

export interface CompositionDependencyEdge {
  fromPrimaryObject: string;
  toPrimaryObject: string;
  objectRef: string;
  consumerSequence: number;
  producerSequence: number;
}

export interface CompositionDependencyCycle {
  primaryObjects: string[];
  edges: CompositionDependencyEdge[];
}

export interface CandidateCompositionReadiness {
  mode: 'candidate' | 'direct' | 'integration' | 'legacy-unclassified';
  status: 'ready' | 'blocked' | 'not-applicable' | 'legacy-unavailable';
  operationFactsVersion?: '1.0.0';
  operationCount: number;
  issueCount: number;
  issues: Array<{
    code: 'OPERATION_SEQUENCE_INVALID' | 'OPERATION_FACTS_MISSING' | 'OPERATION_FACTS_INVALID'
      | 'DEPENDENCY_IDENTITY_UNAVAILABLE' | 'DEPENDENCY_CYCLE';
    operationId?: string;
    message: string;
    objectRefs?: string[];
    cycle?: CompositionDependencyCycle;
  }>;
  truncated: boolean;
}

export const COMPOSABLE_CAPABILITY_IDS: readonly ComposableCapabilityId[] = [
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'variable.patch-initial',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'gallery.cg.create',
  'gallery.cg.patch',
  'project.entry-scene.set',
];

/** 5.2 Manifest 与对象关系 */
export interface ObjectRequirement {
  objectRef: string;
  source: 'base' | 'candidate';
  candidateOperationSequence?: number;
  expectedFingerprint?: string;
}

export interface ReplayStatePrecondition {
  objectRef: string;
  expectedFingerprint: string;
}

export interface ReplayStateRequirement extends ObjectRequirement {
  expectedFingerprint: string;
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
  replayStateRequirements?: ReplayStateRequirement[];
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
    | 'DIRECT_CHANGE'
    | 'LEGACY_CAPSULE'
    | 'MISSING_NORMALIZED_INPUT'
    | 'INVOCATION_FACT_MISSING'
    | 'INVOCATION_FACT_AMBIGUOUS'
    | 'UNSUPPORTED_CAPABILITY'
    | 'OBJECT_IDENTITY_UNAVAILABLE'
    | 'DEPENDENCY_IDENTITY_UNAVAILABLE'
    | 'OPERATION_SEQUENCE_INVALID'
    | 'OPERATION_FACTS_MISSING'
    | 'OPERATION_FACTS_INVALID'
    | 'DEPENDENCY_CYCLE';
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
  baseReplayStates?: ReplayStatePrecondition[];
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
  /** Original sealed claims, independent from the review preparation brief. */
  intent?: string;
  acceptanceCriteria?: string[];
  /** Only identities referenced in the sealed capsule; never populated from later traces. */
  sealedRuntimeTraceIds?: string[];
  /** Sealed freshness, checked against sourceWorkingRevision before projecting current facts. */
  objectDiffFreshness?: EvidenceFreshness;
  /** Current full file diffs from the identity-verified sealed capsule, never the mutable workspace. */
  sealedFileDiffs?: import('./diff.js').ChangeDiffFile[];
  composition: CapsuleCompositionProjection;
  evidenceSummary: CandidateEvidenceSummary;
  semanticDiff: CompositionSemanticDiffEntry[];
}
