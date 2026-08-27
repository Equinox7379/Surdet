import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionComparison,
  CompositionConflict,
} from './composition-contracts.js';

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
  statementSource: 'candidate-intent' | 'generated-fallback';
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
}

export interface ReviewDependency {
  fromUnitId: string;
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

export interface ReviewFinalResult {
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  diffFingerprint: string;
  changedObjects: ReviewObjectSummary[];
  evidence: ReviewEvidenceBinding;
  resultTreeSha256: string;
  warnings: ReviewWarning[];
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

export interface HumanReviewProjection {
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
  evidence: ReviewEvidenceSummary;
  objects: ReviewObjectSummary[];
  finalResult?: ReviewFinalResult;
  sourceIdentity: ReviewSourceIdentity;
  reviewFingerprint: string;
}
