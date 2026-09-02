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
  mode: 'idle' | 'single' | 'batch';
  batchEditing: boolean;
  source: AssetRelocationSource | null;
  selection: AssetRelocationSource[];
  batchKind: AssetRelocationSource['kind'] | null;
  visibleAssetIds: string[];
  targetDirectory: string;
  fileName: string;
  fileNames: Record<string, string>;
  plan: AssetRelocationDetail['plan'] | null;
  detail: AssetRelocationDetail | null;
  receipt: AssetRelocationDetail['receipt'];
  undoReceipt: AssetRelocationDetail['undoReceipt'];
  busy: boolean;
  message: string | null;
}

export interface AssetRelocationWorkspace {
  snapshot(): AssetRelocationWorkspaceProjection;
  subscribe(listener: (projection: AssetRelocationWorkspaceProjection) => void): () => void;
  begin(source: AssetRelocationSource): void;
  beginBatch(): void;
  openBatchEditor(): void;
  returnToBatchSelection(): void;
  select(source: AssetRelocationSource): void;
  unselect(assetId: string): void;
  setVisibleAssetIds(assetIds: readonly string[]): void;
  updateBatchTarget(update: { targetDirectory?: string; assetId?: string; fileName?: string }): void;
  setBatchPlan(plan: AssetRelocationDetail['plan'] | null): void;
  setBatchDetail(detail: AssetRelocationDetail | null): void;
  updateTarget(update: { targetDirectory?: string; fileName?: string }): void;
  setDetail(detail: AssetRelocationDetail | null): void;
  setBusy(busy: boolean): void;
  setMessage(message: string | null): void;
  reset(): void;
  dispose(): void;
}

function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => copyValue(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)])) as T;
  }
  return value;
}

function copyDetail(detail: AssetRelocationDetail | null): AssetRelocationDetail | null {
  return detail === null ? null : copyValue(detail);
}

function copyProjection(value: AssetRelocationWorkspaceProjection): AssetRelocationWorkspaceProjection {
  return {
    ...value,
    source: value.source === null ? null : { ...value.source },
    selection: value.selection.map((source) => ({ ...source })),
    visibleAssetIds: [...value.visibleAssetIds],
    fileNames: { ...value.fileNames },
    plan: value.plan === null ? null : copyValue(value.plan),
    detail: copyDetail(value.detail),
    receipt: value.receipt === null ? null : copyValue(value.receipt),
    undoReceipt: value.undoReceipt === null ? null : copyValue(value.undoReceipt),
  };
}

export function createAssetRelocationWorkspace(): AssetRelocationWorkspace {
  const listeners = new Set<(projection: AssetRelocationWorkspaceProjection) => void>();
  let disposed = false;
  let projection: AssetRelocationWorkspaceProjection = {
    mode: 'idle',
    batchEditing: false,
    source: null,
    selection: [],
    batchKind: null,
    visibleAssetIds: [],
    targetDirectory: '',
    fileName: '',
    fileNames: {},
    plan: null,
    detail: null,
    receipt: null,
    undoReceipt: null,
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
        mode: 'single',
        batchEditing: false,
        source: { ...source },
        selection: [{ ...source }],
        batchKind: source.kind,
        visibleAssetIds: [source.assetId],
        targetDirectory: source.targetDirectory,
        fileName: source.fileName,
        fileNames: { [source.assetId]: source.fileName },
        plan: null,
        detail: null,
        receipt: null,
        undoReceipt: null,
        busy: false,
        message: null,
      };
      emit();
    },
    beginBatch() {
      ensureActive();
      projection = {
        mode: 'batch',
        batchEditing: false,
        source: null,
        selection: [],
        batchKind: null,
        visibleAssetIds: [],
        targetDirectory: '',
        fileName: '',
        fileNames: {},
        plan: null,
        detail: null,
        receipt: null,
        undoReceipt: null,
        busy: false,
        message: null,
      };
      emit();
    },
    openBatchEditor() {
      ensureActive();
      if (projection.mode !== 'batch' || projection.selection.length === 0 || projection.busy) return;
      projection.batchEditing = true;
      projection.plan = null;
      projection.detail = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      projection.message = null;
      emit();
    },
    returnToBatchSelection() {
      ensureActive();
      if (projection.mode !== 'batch' || projection.busy || projection.detail !== null) return;
      projection.batchEditing = false;
      projection.plan = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      projection.message = null;
      emit();
    },
    select(source) {
      ensureActive();
      if (projection.busy || (projection.batchKind !== null && projection.batchKind !== source.kind)
        || projection.selection.some((item) => item.assetId === source.assetId)) return;
      projection.selection.push({ ...source });
      projection.batchKind ??= source.kind;
      projection.targetDirectory ||= source.targetDirectory;
      projection.fileNames[source.assetId] = source.fileName;
      projection.plan = null;
      projection.detail = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      projection.message = null;
      emit();
    },
    unselect(assetId) {
      ensureActive();
      if (projection.busy) return;
      projection.selection = projection.selection.filter((item) => item.assetId !== assetId);
      delete projection.fileNames[assetId];
      if (projection.selection.length === 0) {
        projection.batchKind = null;
        projection.targetDirectory = '';
      }
      projection.plan = null;
      projection.detail = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      emit();
    },
    setVisibleAssetIds(assetIds) {
      ensureActive();
      projection.visibleAssetIds = [...new Set(assetIds)];
      emit();
    },
    updateBatchTarget(update) {
      ensureActive();
      if (projection.busy || projection.selection.length === 0) return;
      if (update.targetDirectory !== undefined) projection.targetDirectory = update.targetDirectory;
      if (update.assetId !== undefined && update.fileName !== undefined
        && projection.selection.some((item) => item.assetId === update.assetId)) {
        projection.fileNames[update.assetId] = update.fileName.normalize('NFC');
      }
      projection.plan = null;
      projection.detail = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      projection.message = null;
      emit();
    },
    setBatchPlan(plan) {
      ensureActive();
      projection.plan = plan === null ? null : copyValue(plan);
      projection.detail = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      emit();
    },
    setBatchDetail(detail) {
      ensureActive();
      projection.detail = copyDetail(detail);
      projection.plan = detail?.plan === undefined || detail.plan === null ? null : copyValue(detail.plan);
      projection.receipt = detail?.receipt === undefined || detail.receipt === null ? null : copyValue(detail.receipt);
      projection.undoReceipt = detail?.undoReceipt === undefined || detail.undoReceipt === null ? null : copyValue(detail.undoReceipt);
      emit();
    },
    updateTarget(update) {
      ensureActive();
      if (projection.source === null || projection.busy) return;
      if (update.targetDirectory !== undefined) projection.targetDirectory = update.targetDirectory;
      if (update.fileName !== undefined) projection.fileName = update.fileName.normalize('NFC');
      projection.detail = null;
      projection.plan = null;
      projection.receipt = null;
      projection.undoReceipt = null;
      projection.message = null;
      emit();
    },
    setDetail(detail) {
      ensureActive();
      if (detail !== null && projection.source !== null
        && (detail.request.sourcePath !== projection.source.sourcePath
          || detail.operation.operationId !== detail.request.operationId)) return;
      projection.detail = copyDetail(detail);
      projection.plan = detail === null ? null : copyValue(detail.plan);
      projection.receipt = detail?.receipt === undefined || detail.receipt === null ? null : copyValue(detail.receipt);
      projection.undoReceipt = detail?.undoReceipt === undefined || detail.undoReceipt === null ? null : copyValue(detail.undoReceipt);
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
        mode: 'idle',
        batchEditing: false,
        source: null,
        selection: [],
        batchKind: null,
        visibleAssetIds: [],
        targetDirectory: '',
        fileName: '',
        fileNames: {},
        plan: null,
        detail: null,
        receipt: null,
        undoReceipt: null,
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
