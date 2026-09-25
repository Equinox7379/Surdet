import type {
  ProjectAssetImportPlan,
  ProjectAssetImportStagedItem,
  ProjectAssetImportTargetFact,
  ProjectAssetImportTargetRequest,
  ProjectAssetRelocationBinaryBaseline,
  ProjectAssetRelocationBatchPlan,
  ProjectAssetRelocationPlan,
  ProjectAssetRelocationScannedFile,
  ProjectAssetRelocationTextChange,
} from '@surdet/authoring';

export function normalizeAssetImportSourceName(value: unknown): string {
  if (typeof value !== 'string') throw new AssetImportAuthorityError('INVALID_REQUEST', '源文件名格式无效');
  const normalized = value.normalize('NFC');
  const points = Array.from(normalized);
  if (points.length < 1 || points.length > 240 || normalized.trim() !== normalized
    || normalized === '.' || normalized === '..'
    || /[\\/:*?"<>|]/u.test(normalized)
    || points.some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '源文件名必须是安全的单个文件名');
  }
  return normalized;
}

export type AssetImportOperationStatus =
  | 'UPLOADING'
  | 'STAGED'
  | 'READY'
  | 'PUBLISHING'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'RECOVERY_REQUIRED'
  | 'COMMITTED'
  | 'UNDOING'
  | 'UNDONE'
  | 'CANCELLED';

export class AssetImportAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AssetImportAuthorityError';
  }
}

export interface ProjectRootBindingIdentity {
  canonicalRootRealPath: string;
  platform: NodeJS.Platform;
  device: string;
  inode: string;
  birthtimeNs: string;
  publicProjectIdentity: string;
}

export interface AssetImportAuthorityPaths {
  dataRoot: string;
  projectRoot: string;
  projectIdentity: string;
  projectNamespace: string;
  internalWorkspace: string;
  relocationWorkspace: string;
  rootIdentity: ProjectRootBindingIdentity;
}

export interface OperationRegistration {
  operationId: string;
  itemCount: number;
  createdAt: string;
}

export interface AssetImportOperationManifestItem {
  itemId: string;
  sourceName: string;
  declaredBytes: number;
}

export interface AssetImportOperationManifest {
  schemaVersion: 1;
  operationId: string;
  createdAt: string;
  manifestFingerprint: string;
  items: AssetImportOperationManifestItem[];
  /** Immutable source request for the Agent adapter; absent for browser uploads. */
  agentRequestFingerprint?: string;
}

export interface AssetImportOperationPlanRecord {
  schemaVersion: 1;
  operationId: string;
  targets: ProjectAssetImportTargetRequest[];
  targetFacts: ProjectAssetImportTargetFact[];
  plan: ProjectAssetImportPlan;
}

export interface AssetImportUploadIntent {
  schemaVersion: 1;
  operationId: string;
  itemId: string;
  nonce: string;
  partialFileName: string;
  createdAt: string;
}

export interface AssetImportFileIdentity {
  device: string;
  inode: string;
  birthtimeNs: string;
  size: number;
  mtimeNs: string;
}

export type AssetImportPublicationFileState =
  | 'UPLOADED'
  | 'PREPARE_INTENT'
  | 'PREPARED'
  | 'LINK_INTENT'
  | 'LINKED'
  | 'VERIFIED'
  | 'ROLLBACK_RENAME_INTENT'
  | 'ROLLBACK_QUARANTINED'
  | 'UNDO_RENAME_INTENT'
  | 'UNDO_QUARANTINED'
  | 'UNDO_VERIFIED';

export interface AssetImportPublicationFile {
  itemId: string;
  targetPath: string;
  preparedRelativePath: string;
  rollbackRelativePath: string;
  undoRelativePath: string;
  bytes: number;
  sha256: string;
  state: AssetImportPublicationFileState;
  preparedIdentity?: AssetImportFileIdentity;
  finalIdentity?: AssetImportFileIdentity;
  quarantineIdentity?: AssetImportFileIdentity;
  undoIdentity?: AssetImportFileIdentity;
}

export interface AssetImportPublicationParent {
  relativePath: string;
  state:
    | 'CREATE_INTENT'
    | 'PREEXISTING'
    | 'CREATED'
    | 'ROLLBACK_REMOVE_INTENT'
    | 'ROLLBACK_REMOVED'
    | 'ROLLBACK_PRESERVED';
  identity?: AssetImportFileIdentity;
}

export interface AssetImportPublicationRecord {
  schemaVersion: 1;
  operationId: string;
  publicationVersion: number;
  previousGenerationSha256: string | null;
  publicationSha256: string;
  planId: string;
  planFingerprint: string;
  files: AssetImportPublicationFile[];
  parents: AssetImportPublicationParent[];
  updatedAt: string;
}

export interface ProjectAssetImportReceipt {
  schemaVersion: 1;
  receiptId: string;
  receiptSha256: string;
  operationId: string;
  planId: string;
  planFingerprint: string;
  projectIdentity: string;
  status: 'COMMITTED';
  journalVersion: number;
  authorityContractVersion: 1;
  files: Array<{
    itemId: string;
    targetPath: string;
    bytes: number;
    sha256: string;
    fileIdentity: {
      device: string;
      inode: string;
      birthtimeNs: string;
    };
  }>;
  committedAt: string;
}

export interface ProjectAssetImportUndoReceipt {
  schemaVersion: 1;
  undoReceiptId: string;
  undoReceiptSha256: string;
  operationId: string;
  projectIdentity: string;
  status: 'UNDONE';
  journalVersion: number;
  removedPaths: string[];
  quarantinePaths: string[];
  undoneAt: string;
}

export interface CommitOperationRequest {
  planFingerprint: string;
}

export interface CommitOperationResponse {
  operation: AssetImportJournal;
  receipt: ProjectAssetImportReceipt;
}

export interface RecoverOperationRequest {
  action: 'resume' | 'rollback';
  /** Explicitly discard a never-sealed upload; never substitutes for a published plan. */
  manifestFingerprint?: string;
}

export interface RecoverOperationResponse {
  detail: OperationDetailResponse;
}

export interface UndoOperationRequest {
  receiptId: string;
  receiptSha256: string;
}

export interface UndoOperationResponse {
  operation: AssetImportJournal;
  undoReceipt: ProjectAssetImportUndoReceipt;
}

export interface CreateImportOperationRequest {
  operationId: string;
  items: AssetImportOperationManifestItem[];
  agentRequestFingerprint?: string;
}

export interface CreateImportOperationResponse {
  operationId: string;
  status: 'UPLOADING';
  operationToken: string;
  itemCount: number;
}

export interface PlanOperationRequest {
  targets: ProjectAssetImportTargetRequest[];
}

export interface PlanOperationResponse {
  operationId: string;
  status: 'STAGED' | 'READY';
  plan: ProjectAssetImportPlan;
}

export interface SealOperationRequest {
  planFingerprint: string;
}

export interface SealOperationResponse {
  operationId: string;
  status: 'READY';
  planId: string;
  planFingerprint: string;
}

export interface OperationDetailResponse {
  operation: AssetImportJournal;
  manifest: AssetImportOperationManifest;
  stagedItems: ProjectAssetImportStagedItem[];
  plan: ProjectAssetImportPlan | null;
  receipt: ProjectAssetImportReceipt | null;
  undoReceipt: ProjectAssetImportUndoReceipt | null;
}

export interface ListOperationsResponse {
  operations: AssetImportJournal[];
}

export type AssetRelocationOperationStatus =
  | 'PLANNED'
  | 'PUBLISHING'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'RECOVERY_REQUIRED'
  | 'COMMITTED'
  | 'UNDOING'
  | 'UNDONE'
  | 'CANCELLED';

export type AssetRelocationBinaryState =
  | 'SOURCE'
  | 'BACKUP_INTENT'
  | 'BACKUP'
  | 'TARGET_INTENT'
  | 'TARGET'
  | 'ROLLBACK_INTENT'
  | 'ROLLED_BACK'
  | 'UNDO_INTENT'
  | 'UNDONE';

export type AssetRelocationTextState =
  | 'PENDING'
  | 'REPLACE_INTENT'
  | 'REPLACED'
  | 'ROLLBACK_INTENT'
  | 'ROLLED_BACK'
  | 'UNDO_INTENT'
  | 'UNDONE';

export interface AssetRelocationFileEvidence extends AssetImportFileIdentity {
  sha256: string;
}

export interface AssetRelocationRequest {
  operationId: string;
  moves: AssetRelocationMoveRequest[];
  /** 单素材兼容投影；始终等于 moves[0]。 */
  sourcePath: string;
  targetPath: string;
}

export interface AssetRelocationMoveRequest {
  sourcePath: string;
  targetPath: string;
}

export interface AssetRelocationBinaryJournalItem {
  moveId: string;
  sourcePath: string;
  targetPath: string;
  state: AssetRelocationBinaryState;
  backupRelativePath: string;
  backupIdentity: AssetRelocationFileEvidence | null;
  targetIdentity: AssetRelocationFileEvidence | null;
}

export interface AssetRelocationJournal {
  schemaVersion: 1;
  operationId: string;
  journalVersion: number;
  status: AssetRelocationOperationStatus;
  recoveryPhase: 'commit' | 'rollback' | 'undo' | null;
  binaryState: AssetRelocationBinaryState;
  binaryBackupRelativePath: string;
  binaryBackupIdentity: AssetRelocationFileEvidence | null;
  binaryTargetIdentity: AssetRelocationFileEvidence | null;
  binaryItems: AssetRelocationBinaryJournalItem[];
  textStates: AssetRelocationTextState[];
  textResultIdentities: Array<AssetRelocationFileEvidence | null>;
  updatedAt: string;
}

export interface AssetRelocationStoredText extends ProjectAssetRelocationTextChange {
  beforeIdentity: AssetRelocationFileEvidence;
  preparedRelativePath: string;
  backupRelativePath: string;
  preparedIdentity?: AssetRelocationFileEvidence;
  backupIdentity?: AssetRelocationFileEvidence;
}

export interface AssetRelocationReceipt {
  schemaVersion: 1;
  receiptId: string;
  receiptFingerprint: string;
  operationId: string;
  planId: string;
  planFingerprint: string;
  projectIdentity: string;
  sourcePath: string;
  targetPath: string;
  targetIdentity: AssetRelocationFileEvidence;
  moves: Array<{
    moveId: string;
    sourcePath: string;
    targetPath: string;
    targetIdentity: AssetRelocationFileEvidence;
  }>;
  textFiles: Array<{ path: string; sha256: string; identity: AssetRelocationFileEvidence }>;
  committedAt: string;
}

export interface AssetRelocationUndoReceipt {
  schemaVersion: 1;
  undoReceiptId: string;
  undoReceiptFingerprint: string;
  operationId: string;
  receiptId: string;
  sourcePath: string;
  targetPath: string;
  sourceIdentity: AssetRelocationFileEvidence;
  moves: Array<{
    moveId: string;
    sourcePath: string;
    targetPath: string;
    sourceIdentity: AssetRelocationFileEvidence;
  }>;
  restoredTextFiles: Array<{ path: string; sha256: string; identity: AssetRelocationFileEvidence }>;
  undoneAt: string;
}

export interface AssetRelocationStoredOperation {
  schemaVersion: 1;
  request: AssetRelocationRequest;
  plan: ProjectAssetRelocationPlan | ProjectAssetRelocationBatchPlan;
  scannedFiles: ProjectAssetRelocationScannedFile[];
  binaryBaseline: ProjectAssetRelocationBinaryBaseline;
  binaryBaselines: ProjectAssetRelocationBinaryBaseline[];
  textFiles: AssetRelocationStoredText[];
  journal: AssetRelocationJournal;
  receipt: AssetRelocationReceipt | null;
  undoReceipt: AssetRelocationUndoReceipt | null;
}

export interface PlanAssetRelocationRequest {
  operationId: string;
  sourcePath?: string;
  targetPath?: string;
  moves?: AssetRelocationMoveRequest[];
}

export interface CommitAssetRelocationRequest {
  planFingerprint: string;
}

export interface RecoverAssetRelocationRequest {
  action: 'resume' | 'rollback';
}

export interface UndoAssetRelocationRequest {
  receiptId: string;
  receiptFingerprint: string;
}

export interface AssetRelocationDetailResponse {
  request: AssetRelocationRequest;
  operation: AssetRelocationJournal;
  plan: ProjectAssetRelocationPlan | ProjectAssetRelocationBatchPlan;
  receipt: AssetRelocationReceipt | null;
  undoReceipt: AssetRelocationUndoReceipt | null;
}

export interface AssetRelocationOperationSummary {
  operationId: string;
  status: AssetRelocationOperationStatus;
  sourcePath: string;
  targetPath: string;
  moves: AssetRelocationMoveRequest[];
  updatedAt: string;
  manualRecoveryRequired: boolean;
}

export interface ListAssetRelocationsResponse {
  operations: AssetRelocationOperationSummary[];
  recentReceipts: AssetRelocationReceipt[];
}

export interface SceneLifecyclePlanRequest {
  operationId: string;
  kind: 'rename' | 'delete';
  sourcePath: string;
  targetPath?: string;
}

export interface SceneLifecyclePlanResponse {
  operationId: string;
  kind: 'rename' | 'delete';
  sourcePath: string;
  targetPath: string | null;
  planFingerprint: string;
  status: 'PLANNED' | 'COMMITTED' | 'CANCELLED';
}

export interface SceneLifecycleCommitRequest {
  requestId: string;
  configRenames?: Array<{ from: string; to: string }>;
  plans: Array<{ operationId: string; planFingerprint: string }>;
  writes: Array<{ path: string; text: string; expectedSha256: string | null }>;
}

export interface SceneLifecycleCommitResponse {
  requestId: string;
  status: 'COMMITTED';
  writes: Array<{ path: string; sha256: string }>;
  deletedPaths: string[];
}

export interface AssetImportJournal {
  schemaVersion: 1;
  operationId: string;
  journalVersion: number;
  previousGenerationSha256: string | null;
  status: AssetImportOperationStatus;
  itemCount: number;
  updatedAt: string;
}

export interface RecoveryBarrierIncident {
  barrierId: string;
  operationId: string;
  /** 旧记录省略时按 asset-import 解释。 */
  operationKind?: 'asset-import' | 'asset-relocation';
  reason: 'RECOVERY_REQUIRED';
  createdAt: string;
}

export interface RecoveryBarrierResolution {
  barrierId: string;
  incidentSha256: string;
  operationId: string;
  operationKind?: 'asset-import' | 'asset-relocation';
  journalVersion: number;
  publicationVersion: number | null;
  publicationSha256: string | null;
  quarantinedPaths: string[];
  terminalFingerprint?: string;
  resolvedAt: string;
}

export type AssetImportChallengeStatus = 'PROBE_CREATE_INTENT' | 'PROBE_CREATED' | 'PROBE_REMOVED';

export interface AssetImportChallengeJournal {
  schemaVersion: 1;
  challengeId: string;
  journalVersion: number;
  previousGenerationSha256: string | null;
  browserSessionId: string;
  relativeProbePath: string;
  nonceSha256: string;
  expiresAt: string;
  status: AssetImportChallengeStatus;
}

export interface CreateBindingChallengeResponse {
  challengeId: string;
  relativeProbePath: string;
  expiresAt: string;
}

export interface ConfirmBindingChallengeRequest {
  browserSessionId: string;
  nonce: string;
}

export interface ConfirmBindingChallengeResponse {
  projectIdentity: string;
  projectName: string;
  bindingToken: string;
  bindingExpiresAt: string;
  recoveryBarrier: 'clear' | 'recoverable' | 'manual-recovery';
  pendingOperations: AssetImportJournal[];
  recentReceipts: [];
}
