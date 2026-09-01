import type {
  ProjectAssetImportPlan,
  ProjectAssetImportStagedItem,
  ProjectAssetImportTargetFact,
  ProjectAssetImportTargetRequest,
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
  | 'ROLLBACK_QUARANTINED';

export interface AssetImportPublicationFile {
  itemId: string;
  targetPath: string;
  preparedRelativePath: string;
  rollbackRelativePath: string;
  bytes: number;
  sha256: string;
  state: AssetImportPublicationFileState;
  preparedIdentity?: AssetImportFileIdentity;
  finalIdentity?: AssetImportFileIdentity;
  quarantineIdentity?: AssetImportFileIdentity;
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

export interface CommitOperationRequest {
  planFingerprint: string;
}

export interface CommitOperationResponse {
  operation: AssetImportJournal;
  receipt: ProjectAssetImportReceipt;
}

export interface RecoverOperationRequest {
  action: 'resume' | 'rollback';
}

export interface RecoverOperationResponse {
  detail: OperationDetailResponse;
}

export interface CreateImportOperationRequest {
  operationId: string;
  items: AssetImportOperationManifestItem[];
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
}

export interface ListOperationsResponse {
  operations: AssetImportJournal[];
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
  reason: 'RECOVERY_REQUIRED';
  createdAt: string;
}

export interface RecoveryBarrierResolution {
  barrierId: string;
  incidentSha256: string;
  operationId: string;
  journalVersion: number;
  publicationVersion: number | null;
  publicationSha256: string | null;
  quarantinedPaths: string[];
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
