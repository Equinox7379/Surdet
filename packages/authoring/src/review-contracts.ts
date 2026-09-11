import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionComparison,
  CompositionConflict,
  JsonValue,
  ObjectChangeUnit,
} from './composition-contracts.js';
import type { ChangeDiff } from './diff.js';
import type { IntegrationPlan } from './integration-plan.js';
import type { ReviewDecisionIntent } from './review-decision-preview.js';

export type ReviewKind = 'comparison' | 'integration-result';

export type ReviewState =
  | 'COMPARISON_PREPARED'
  | 'DECISION_DRAFT'
  | 'DECIDED'
  | 'PLAN_PREPARED'
  | 'STAGE_READY'
  | 'OWNER_APPROVED'
  | 'APPLY_PENDING'
  | 'COMMITTED'
  | 'RETURNED'
  | 'STALE'
  | 'INVALID';

export interface ReviewArtifactIdentity {
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface ReviewSourceIdentity {
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  planFingerprint?: string;
  integrationChangeId?: string;
  workingRevision?: number;
  decisionReviewId?: string;
  decisionId?: string;
  decisionFingerprint?: string;
}

export interface ReviewTaskSummary {
  title: string;
  goal?: string;
  acceptanceCriteria: string[];
  candidateCount: number;
  objectCount: number;
  conflictCount: number;
  statementSource: 'candidate-intent' | 'generated-fallback' | 'creative-brief' | 'not-provided';
}

export interface ReviewObjectSummary {
  objectRef: string;
  kind: string;
  semanticId?: string;
  source?: { path: string; line: number; col: number };
  references: string[];
  referencedBy: string[];
  potentialImpact: unknown[];
  observedImpact: unknown[];
}

export interface ReviewCandidate {
  candidateId: string;
  ref: CandidateCapsuleRef;
  displayOrdinal: string;
  declaredIntent?: string;
  acceptanceCriteria: string[];
  evidence: CandidateEvidenceSummary;
}

export interface ReviewSafeGroup {
  groupId: string;
  primaryObject: string;
  finalFingerprint: string;
  unitIds: string[];
  candidateIds: string[];
  sourceCount: number;
  includedByDefault: true;
  collapsedByDefault: true;
  sources: ReviewUnitOutcome[];
  dependencyObjectRefs: string[];
  potentialImpact: unknown[];
  observedImpact: unknown[];
  evidence: ReviewSafeGroupEvidence;
}

export interface ReviewUnitOutcome {
  unitId: string;
  candidateId: string;
  primaryObject: string;
  finalFingerprint?: string;
  outcomes: ObjectChangeUnit['producedObjects'];
  potentialImpact: unknown[];
  observedImpact: unknown[];
  evidence: CandidateEvidenceSummary;
  /** 新 review 由 typed manifest 生成；旧 v1 payload 可省略并保持历史身份。 */
  presentation?: ReviewUnitPresentation;
}

export interface ReviewUnitPresentation {
  actionLabel: string;
  objectLabel: string;
  highlights: string[];
  completeness: 'content' | 'metadata-only';
  omittedFactCount: number;
}

export interface CreativeBriefInput {
  title?: string;
  request: string;
  acceptanceCriteria?: string[];
}

export interface ReviewCreativeBrief {
  status: 'provided' | 'not-provided';
  source: 'review-preparation-input';
  title?: string;
  request?: string;
  acceptanceCriteria: string[];
  fingerprint?: string;
}

export interface ReviewCandidateClaim {
  source: 'candidate-change-intent';
  statement?: string;
  acceptanceCriteria: string[];
}

export interface ReviewChangedObjectFact {
  objectRef: string;
  disposition: ObjectChangeUnit['producedObjects'][number]['disposition'];
  finalFingerprint?: string;
  unitId: string;
}

export interface ReviewSceneFact {
  sceneId: string;
  objectRef: string;
  unitId: string;
  action: string;
  operationSequence: number;
  highlights: string[];
}

export interface ReviewChoiceFact {
  unitId: string;
  sceneId?: string;
  label: string;
  target?: string;
  action: string;
  operationSequence: number;
}

export interface ReviewVariableFact {
  unitId: string;
  name: string;
  type?: string;
  initial?: JsonValue;
}

export interface ReviewTimelineFact {
  unitId: string;
  timelineId: string;
  durationMs?: number;
  trackCount?: number;
  trackKinds: string[];
}

export interface ReviewAssetFact {
  unitId: string;
  assetRef: string;
  kind?: string;
}

export interface ReviewRuntimePathFact {
  traceId: string;
  status: 'passed' | 'failed';
  startSceneId: string;
  visitedSceneIds: string[];
  choices: Array<{
    sceneId: string;
    optionIndex: number;
    label?: string;
  }>;
  endingSceneId?: string;
  finalVariables: Array<{
    name: string;
    value?: JsonValue;
  }>;
}

export interface ReviewRuntimeTraceInput {
  sourceChangeId: string;
  sourceWorkingRevision: number;
  traceId: string;
  events: import('./runtime-trace.js').RuntimeTraceEvent[];
  status?: 'passed' | 'failed';
}

/** Runtime traces read from the candidate's sealed evidence at review preparation time. */
export interface ReviewCandidateRuntimeInput {
  status: 'available' | 'unavailable';
  sourceChangeId: string;
  sourceWorkingRevision: number;
  traces: Array<{
    traceId: string;
    status: 'passed';
    events: import('./runtime-trace.js').RuntimeTraceEvent[];
  }>;
  limitations: string[];
}

export interface ReviewCandidateVerifiedFacts {
  source: {
    content: 'sealed-composition-manifest' | 'manifest-unavailable';
    evidence: 'sealed-capsule-evidence' | 'evidence-unavailable';
    runtime: 'sealed-runtime-trace' | 'runtime-unavailable';
  };
  /** Every unit belonging to this candidate, including units outside conflicts. */
  units: ReviewUnitOutcome[];
  content: {
    changedObjects: ReviewChangedObjectFact[];
    scenes: ReviewSceneFact[];
    choices: ReviewChoiceFact[];
    variables: ReviewVariableFact[];
    timelines: ReviewTimelineFact[];
    assets: ReviewAssetFact[];
    excerpts: string[];
    omittedFactCount: number;
    /** Final scene text reconstructed from complete sealed file diffs; operation history stays separate. */
    finalScenes?: Array<{ unitId: string; sceneId: string; source: 'sealed-capsule-diff'; paragraphs: string[] }>;
  };
  runtime: {
    status: 'verified' | 'unavailable';
    workingRevision?: number;
    paths: ReviewRuntimePathFact[];
    limitations: string[];
  };
}

export interface CandidateAdoptionPreset {
  candidateRef: CandidateCapsuleRef;
  candidateId: string;
  status: 'available' | 'blocked';
  selectedUnitIds: string[];
  conflictResolutions: import('./integration-plan.js').ConflictResolutionInput[];
  reasons: Array<{ code: string; message: string }>;
}

export interface ReviewCandidateV2 extends ReviewCandidate {
  claims: ReviewCandidateClaim;
  verifiedFacts: ReviewCandidateVerifiedFacts;
  adoptionPreset: CandidateAdoptionPreset;
}

export interface ReviewHumanFact {
  kind: string;
  label: string;
  objectRef?: string;
  unitId?: string;
  candidateId?: string;
  value?: JsonValue;
}

export interface ReviewActualResultExplanation {
  source: 'integration-result';
  decisionIntent: ReviewDecisionIntent;
  decisionFingerprint: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  runtimeTraceIds: string[];
  selectedSources: ReviewHumanFact[];
  actualIncluded: ReviewHumanFact[];
  actualDependencies: ReviewHumanFact[];
  actualExcluded: ReviewHumanFact[];
  actualChanges: ReviewHumanFact[];
  actualRuntimeOutcomes: ReviewRuntimePathFact[];
  warnings: string[];
  explanationFingerprint: string;
}

export interface ReviewSafeGroupEvidence {
  warningCount: number;
  missing: boolean;
  stale: boolean;
  failed: boolean;
  incomplete: boolean;
  manualReviewRequired: string[];
}

export interface ReviewConflict {
  conflictId: string;
  severity: CompositionConflict['severity'];
  code: string;
  unitIds: string[];
  candidateIds: string[];
  objectRefs: string[];
  allowedResolutions: CompositionConflict['allowedResolutions'];
  repairActions: string[];
  options: ReviewUnitOutcome[];
}

export interface ReviewDependency {
  fromUnitId: string;
  fromObjectRef: string;
  toUnitId: string;
  objectRef: string;
  inclusion: 'explicit' | 'implicit';
}

export interface ReviewEvidenceSummary {
  candidateMatrix: CompositionComparison['evidenceMatrix'];
  blockingCount: number;
  selectionRequiredCount: number;
  advisoryCount: number;
  canCreateDecision: boolean;
}

export interface ReviewEvidenceBinding {
  diffEvidenceId: string;
  validationEvidenceId: string;
  simulationEvidenceId: string;
  runtimeTraceIds: string[];
}

export interface ReviewWarning {
  code: string;
  message: string;
}

export type ReviewResultPlan = Pick<IntegrationPlan,
  | 'sourceCapsules'
  | 'selectedUnitIds'
  | 'implicitInclusions'
  | 'excludedUnitIds'
  | 'conflictResolutions'
  | 'deduplicatedUnits'
  | 'replayOperations'
  | 'provenance'> & {
    review: Extract<NonNullable<IntegrationPlan['review']>, { reviewState: 'human-reviewed' }>;
    sourceCandidates: Array<{ ref: CandidateCapsuleRef; displayOrdinal: string }>;
    includedUnitIds: string[];
    finalObjectFingerprints: Record<string, string>;
  };

export interface ReviewResultFreshness {
  diff: 'fresh';
  validation: 'fresh';
  simulation: 'fresh';
  runtime: 'fresh';
}

export interface ReviewRuntimeTraceObservation {
  traceId: string;
  observationKeys: string[];
}

export interface ReviewFinalResult {
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  diffFingerprint: string;
  changedObjects: ReviewObjectSummary[];
  evidence: ReviewEvidenceBinding;
  plan: ReviewResultPlan;
  diff: ChangeDiff;
  freshness: ReviewResultFreshness;
  runtimeTraceObservations: ReviewRuntimeTraceObservation[];
  resultTreeSha256: string;
  warnings: ReviewWarning[];
  /** Only v2 result reviews populate this actual, identity-bound explanation. */
  actualExplanation?: ReviewActualResultExplanation;
}

export interface ResultReviewCurrentFacts {
  projectIdentity: string;
  projectRevision: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  diffFingerprint: string;
  evidence: ReviewEvidenceBinding;
  resultTreeSha256: string;
}

export interface FinalApprovalReceipt {
  receiptVersion: '1.0.0';
  approvalId: string;
  resultReviewId: string;
  decisionFingerprint: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  projectIdentity: string;
  expectedProjectRevision: string;
  diffFingerprint: string;
  evidence: ReviewEvidenceBinding;
  resultTreeSha256: string;
  reviewerChannel: 'surdet-editor-local';
  approvedAt: string;
  approvalFingerprint: string;
}

export interface ReviewApprovalRef {
  resultReviewId: string;
  approvalId: string;
  approvalFingerprint: string;
}

export interface ReturnRequestReceipt {
  receiptVersion: '1.0.0';
  returnId: string;
  resultReviewId: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  reasonCategory: 'content' | 'presentation' | 'causal-impact' | 'validation-warning' | 'other';
  reviewerChannel: 'surdet-editor-local';
  returnedAt: string;
  returnFingerprint: string;
}

export interface VerifiedReviewApproval {
  receipt: FinalApprovalReceipt;
  bindingFingerprint: string;
}

export interface HumanReviewProjectionV1 {
  reviewVersion: '1.0.0';
  reviewId: string;
  kind: ReviewKind;
  state: ReviewState;
  projectIdentity: string;
  expectedProjectRevision: string;
  task: ReviewTaskSummary;
  candidates: ReviewCandidate[];
  safeGroups: ReviewSafeGroup[];
  conflicts: ReviewConflict[];
  dependencies: ReviewDependency[];
  defaultSelectedUnitIds: string[];
  evidence: ReviewEvidenceSummary;
  objects: ReviewObjectSummary[];
  finalResult?: ReviewFinalResult;
  sourceIdentity: ReviewSourceIdentity;
  reviewFingerprint: string;
}

export interface HumanReviewProjectionV2 extends Omit<HumanReviewProjectionV1,
  'reviewVersion' | 'candidates' | 'defaultSelectedUnitIds' | 'finalResult'> {
  reviewVersion: '2.0.0';
  candidates: ReviewCandidateV2[];
  /** v2 intentionally starts with no low-level selection. */
  defaultSelectedUnitIds: [];
  creativeBrief: ReviewCreativeBrief;
  finalResult?: ReviewFinalResult;
}

/** Public projection name shared by legacy v1 readers and Wave 9 v2 consumers. */
export type HumanReviewProjection = HumanReviewProjectionV1 | HumanReviewProjectionV2;
