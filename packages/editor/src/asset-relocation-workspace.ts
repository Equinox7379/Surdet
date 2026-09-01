import type { ProjectAssetKind } from '@surdet/authoring';
import type { AssetRelocationDetail } from './asset-import-client.js';

export interface AssetRelocationSource {
  assetId: string;
  sourcePath: string;
  kind: Extract<ProjectAssetKind, 'background' | 'portrait' | 'avatar'>;
  targetDirectory: string;
  fileName: string;
}

export interface AssetRelocationWorkspaceProjection {
  source: AssetRelocationSource | null;
  targetDirectory: string;
  fileName: string;
  detail: AssetRelocationDetail | null;
  busy: boolean;
  message: string | null;
}

export interface AssetRelocationWorkspace {
  snapshot(): AssetRelocationWorkspaceProjection;
  subscribe(listener: (projection: AssetRelocationWorkspaceProjection) => void): () => void;
  begin(source: AssetRelocationSource): void;
  updateTarget(update: { targetDirectory?: string; fileName?: string }): void;
  setDetail(detail: AssetRelocationDetail | null): void;
  setBusy(busy: boolean): void;
  setMessage(message: string | null): void;
  reset(): void;
  dispose(): void;
}

function copyDetail(detail: AssetRelocationDetail | null): AssetRelocationDetail | null {
  if (detail === null) return null;
  return {
    ...detail,
    request: { ...detail.request },
    operation: { ...detail.operation },
    plan: {
      ...detail.plan,
      source: detail.plan.source === null ? null : { ...detail.plan.source },
      target: detail.plan.target === null ? null : { ...detail.plan.target },
      referenceChanges: detail.plan.referenceChanges.map((change) => ({ ...change })),
      blockers: detail.plan.blockers.map((blocker) => ({ ...blocker })),
    },
    receipt: detail.receipt === null ? null : {
      ...detail.receipt,
      targetIdentity: { ...detail.receipt.targetIdentity },
      textFiles: detail.receipt.textFiles.map((file) => ({
        ...file,
        identity: { ...file.identity },
      })),
    },
    undoReceipt: detail.undoReceipt === null ? null : {
      ...detail.undoReceipt,
      sourceIdentity: { ...detail.undoReceipt.sourceIdentity },
      restoredTextFiles: detail.undoReceipt.restoredTextFiles.map((file) => ({
        ...file,
        identity: { ...file.identity },
      })),
    },
    allowedActions: [...detail.allowedActions],
  };
}

function copyProjection(value: AssetRelocationWorkspaceProjection): AssetRelocationWorkspaceProjection {
  return {
    ...value,
    source: value.source === null ? null : { ...value.source },
    detail: copyDetail(value.detail),
  };
}

export function createAssetRelocationWorkspace(): AssetRelocationWorkspace {
  const listeners = new Set<(projection: AssetRelocationWorkspaceProjection) => void>();
  let disposed = false;
  let projection: AssetRelocationWorkspaceProjection = {
    source: null,
    targetDirectory: '',
    fileName: '',
    detail: null,
    busy: false,
    message: null,
  };

  const ensureActive = (): void => {
    if (disposed) throw new Error('素材整理工作区已经关闭');
  };
  const emit = (): void => {
    const snapshot = copyProjection(projection);
    for (const listener of listeners) listener(snapshot);
  };

  return {
    snapshot: () => copyProjection(projection),
    subscribe(listener) {
      ensureActive();
      listeners.add(listener);
      listener(copyProjection(projection));
      return () => { listeners.delete(listener); };
    },
    begin(source) {
      ensureActive();
      projection = {
        source: { ...source },
        targetDirectory: source.targetDirectory,
        fileName: source.fileName,
        detail: null,
        busy: false,
        message: null,
      };
      emit();
    },
    updateTarget(update) {
      ensureActive();
      if (projection.source === null || projection.busy) return;
      if (update.targetDirectory !== undefined) projection.targetDirectory = update.targetDirectory;
      if (update.fileName !== undefined) projection.fileName = update.fileName.normalize('NFC');
      projection.detail = null;
      projection.message = null;
      emit();
    },
    setDetail(detail) {
      ensureActive();
      if (detail !== null && projection.source !== null
        && (detail.request.sourcePath !== projection.source.sourcePath
          || detail.operation.operationId !== detail.request.operationId)) return;
      projection.detail = copyDetail(detail);
      emit();
    },
    setBusy(busy) {
      ensureActive();
      projection.busy = busy;
      emit();
    },
    setMessage(message) {
      ensureActive();
      projection.message = message;
      emit();
    },
    reset() {
      ensureActive();
      projection = {
        source: null,
        targetDirectory: '',
        fileName: '',
        detail: null,
        busy: false,
        message: null,
      };
      emit();
    },
    dispose() {
      if (disposed) return;
      listeners.clear();
      disposed = true;
    },
  };
}
