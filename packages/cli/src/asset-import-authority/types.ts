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
