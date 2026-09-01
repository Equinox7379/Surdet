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
