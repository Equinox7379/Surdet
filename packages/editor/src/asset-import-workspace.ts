import type { ProjectAssetKind } from '@surdet/authoring';
import type {
  AssetImportBindingSnapshot,
  AssetImportOperationDetail,
  AssetImportOperationSummary,
  AssetImportReceiptSummary,
} from './asset-import-client.js';

export type AssetImportEntryState =
  | 'unavailable'
  | 'unbound'
  | 'mismatch'
  | 'manual-recovery'
  | 'recoverable'
  | 'ready';

export interface AssetImportEntrySignals {
  authorityAvailable: boolean;
  bindingState: 'unbound' | 'bound' | 'mismatch';
  recoveryBarrier: 'clear' | 'recoverable' | 'manual-recovery';
  pendingOperations: readonly AssetImportOperationSummary[];
}

export function resolveAssetImportEntryState(signals: AssetImportEntrySignals): AssetImportEntryState {
  if (!signals.authorityAvailable) return 'unavailable';
  if (signals.bindingState === 'mismatch') return 'mismatch';
  if (signals.bindingState !== 'bound') return 'unbound';
  if (signals.recoveryBarrier === 'manual-recovery') return 'manual-recovery';
  if (signals.recoveryBarrier === 'recoverable' || signals.pendingOperations.length > 0) return 'recoverable';
  return 'ready';
}

export interface AssetImportDraftItem {
  itemId: string;
  file: File;
  sourceName: string;
  fileName: string;
  bytes: number;
  kind: ProjectAssetKind | null;
  previewUrl: string | null;
  upload: { loaded: number; total: number; ratio: number };
}

export interface AssetImportWorkspaceProjection {
  entryState: AssetImportEntryState;
  projectIdentity: string | null;
  projectName: string | null;
  bindingExpiresAt: string | null;
  recoveryBarrier: 'clear' | 'recoverable' | 'manual-recovery';
  pendingOperations: AssetImportOperationSummary[];
  recentReceipts: AssetImportReceiptSummary[];
  activeOperation: AssetImportOperationDetail | null;
  draftItems: AssetImportDraftItem[];
  message: string | null;
}

export interface AssetImportWorkspace {
  snapshot(): AssetImportWorkspaceProjection;
  subscribe(listener: (projection: AssetImportWorkspaceProjection) => void): () => void;
  beginBinding(): void;
  applyBinding(binding: AssetImportBindingSnapshot): void;
  markUnavailable(message?: string): void;
  markProjectMismatch(message?: string): void;
  setOperation(operation: AssetImportOperationDetail | null): void;
  setMessage(message: string | null): void;
  replaceFiles(files: readonly File[]): void;
  addFiles(files: readonly File[]): AssetImportDraftItem[];
  removeFile(itemId: string): void;
  updateFile(itemId: string, update: { fileName?: string; kind?: ProjectAssetKind | null }): void;
  updateProgress(itemId: string, loaded: number, total: number): void;
  clearDraft(): void;
  reset(): void;
  dispose(): void;
}

export interface AssetImportWorkspaceOptions {
  createUuid?: () => string;
  createObjectURL?: (file: File) => string;
  revokeObjectURL?: (url: string) => void;
}

function copyDraft(item: AssetImportDraftItem): AssetImportDraftItem {
  return { ...item, upload: { ...item.upload } };
}

function copyProjection(value: AssetImportWorkspaceProjection): AssetImportWorkspaceProjection {
  return {
    ...value,
    pendingOperations: value.pendingOperations.map((operation) => ({ ...operation })),
    recentReceipts: value.recentReceipts.map((receipt) => ({ ...receipt })),
    activeOperation: value.activeOperation === null ? null : {
      ...value.activeOperation,
      operation: { ...value.activeOperation.operation },
      allowedActions: [...value.activeOperation.allowedActions],
    },
    draftItems: value.draftItems.map(copyDraft),
  };
}

export function createAssetImportWorkspace(
  options: AssetImportWorkspaceOptions = {},
): AssetImportWorkspace {
  const createUuid = options.createUuid ?? (() => globalThis.crypto.randomUUID());
  const createObjectURL = options.createObjectURL ?? ((file: File) => URL.createObjectURL(file));
  const revokeObjectURL = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  const listeners = new Set<(projection: AssetImportWorkspaceProjection) => void>();
  let disposed = false;
  let signals: AssetImportEntrySignals = {
    authorityAvailable: false,
    bindingState: 'unbound',
    recoveryBarrier: 'clear',
    pendingOperations: [],
  };
  let projection: AssetImportWorkspaceProjection = {
    entryState: 'unavailable',
    projectIdentity: null,
    projectName: null,
    bindingExpiresAt: null,
    recoveryBarrier: 'clear',
    pendingOperations: [],
    recentReceipts: [],
    activeOperation: null,
    draftItems: [],
    message: null,
  };

  const emit = (): void => {
    projection.entryState = resolveAssetImportEntryState(signals);
    const snapshot = copyProjection(projection);
    for (const listener of listeners) listener(snapshot);
  };

  const releaseDraftUrls = (): void => {
    for (const item of projection.draftItems) {
      if (item.previewUrl !== null) revokeObjectURL(item.previewUrl);
    }
  };

  const clearAuthorityProjection = (): void => {
    projection.projectIdentity = null;
    projection.projectName = null;
    projection.bindingExpiresAt = null;
    projection.recoveryBarrier = 'clear';
    projection.pendingOperations = [];
    projection.recentReceipts = [];
    projection.activeOperation = null;
  };

  const ensureActive = (): void => {
    if (disposed) throw new Error('素材导入工作台已经关闭');
  };

  return {
    snapshot: () => copyProjection(projection),
    subscribe(listener) {
      ensureActive();
      listeners.add(listener);
      listener(copyProjection(projection));
      return () => { listeners.delete(listener); };
    },
    beginBinding() {
      ensureActive();
      clearAuthorityProjection();
      signals = {
        authorityAvailable: true,
        bindingState: 'unbound',
        recoveryBarrier: 'clear',
        pendingOperations: [],
      };
      projection.message = '正在确认当前项目目录…';
      emit();
    },
    applyBinding(binding) {
      ensureActive();
      signals = {
        authorityAvailable: true,
        bindingState: 'bound',
        recoveryBarrier: binding.recoveryBarrier,
        pendingOperations: binding.pendingOperations,
      };
      projection.projectIdentity = binding.projectIdentity;
      projection.projectName = binding.projectName;
      projection.bindingExpiresAt = binding.bindingExpiresAt;
      projection.recoveryBarrier = binding.recoveryBarrier;
      projection.pendingOperations = binding.pendingOperations.map((operation) => ({ ...operation }));
      projection.recentReceipts = binding.recentReceipts.map((receipt) => ({ ...receipt }));
      projection.message = null;
      emit();
    },
    markUnavailable(message = '请从项目启动器打开编辑器后再导入素材。') {
      ensureActive();
      clearAuthorityProjection();
      signals = { ...signals, authorityAvailable: false, bindingState: 'unbound' };
      projection.message = message;
      emit();
    },
    markProjectMismatch(message = '当前目录与导入服务绑定的项目不一致。') {
      ensureActive();
      clearAuthorityProjection();
      signals = { ...signals, authorityAvailable: true, bindingState: 'mismatch' };
      projection.message = message;
      emit();
    },
    setOperation(operation) {
      ensureActive();
      projection.activeOperation = operation;
      if (operation !== null) {
        if (operation.receipt !== null
          && (operation.operation.status === 'COMMITTED' || operation.operation.status === 'UNDONE')) {
          projection.recentReceipts = [{
            operationId: operation.operation.operationId,
            receiptId: operation.receipt.receiptId,
            status: operation.operation.status,
            fileCount: operation.receipt.files.length,
            committedAt: operation.receipt.committedAt,
          }, ...projection.recentReceipts.filter((entry) => (
            entry.operationId !== operation.operation.operationId
          ))];
        }
        const pending = projection.pendingOperations.filter((entry) => entry.operationId !== operation.operation.operationId);
        if (!['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(operation.operation.status)) {
          pending.push({ ...operation.operation });
        }
        projection.pendingOperations = pending;
        signals = { ...signals, pendingOperations: pending };
      }
      emit();
    },
    setMessage(message) {
      ensureActive();
      projection.message = message;
      emit();
    },
    replaceFiles(files) {
      ensureActive();
      releaseDraftUrls();
      projection.draftItems = files.map((file) => ({
        itemId: createUuid(),
        file,
        sourceName: file.name,
        fileName: file.name.normalize('NFC'),
        bytes: file.size,
        kind: null,
        previewUrl: file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')
          ? createObjectURL(file)
          : null,
        upload: { loaded: 0, total: file.size, ratio: 0 },
      }));
      projection.message = null;
      emit();
    },
    addFiles(files) {
      ensureActive();
      const added = files.map((file) => ({
        itemId: createUuid(),
        file,
        sourceName: file.name,
        fileName: file.name.normalize('NFC'),
        bytes: file.size,
        kind: null,
        previewUrl: file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')
          ? createObjectURL(file)
          : null,
        upload: { loaded: 0, total: file.size, ratio: 0 },
      }));
      projection.draftItems.push(...added);
      projection.message = null;
      emit();
      return added.map(copyDraft);
    },
    removeFile(itemId) {
      ensureActive();
      const item = projection.draftItems.find((entry) => entry.itemId === itemId);
      if (item?.previewUrl) revokeObjectURL(item.previewUrl);
      projection.draftItems = projection.draftItems.filter((entry) => entry.itemId !== itemId);
      emit();
    },
    updateFile(itemId, update) {
      ensureActive();
      const item = projection.draftItems.find((entry) => entry.itemId === itemId);
      if (item === undefined) return;
      if (update.fileName !== undefined) item.fileName = update.fileName.normalize('NFC');
      if (update.kind !== undefined) item.kind = update.kind;
      emit();
    },
    updateProgress(itemId, loaded, total) {
      ensureActive();
      const item = projection.draftItems.find((entry) => entry.itemId === itemId);
      if (item === undefined) return;
      const safeTotal = Math.max(0, total);
      const safeLoaded = Math.max(0, Math.min(loaded, safeTotal));
      item.upload = { loaded: safeLoaded, total: safeTotal, ratio: safeTotal === 0 ? 1 : safeLoaded / safeTotal };
      emit();
    },
    clearDraft() {
      ensureActive();
      releaseDraftUrls();
      projection.draftItems = [];
      emit();
    },
    reset() {
      ensureActive();
      releaseDraftUrls();
      signals = {
        authorityAvailable: false,
        bindingState: 'unbound',
        recoveryBarrier: 'clear',
        pendingOperations: [],
      };
      projection = {
        entryState: 'unavailable',
        projectIdentity: null,
        projectName: null,
        bindingExpiresAt: null,
        recoveryBarrier: 'clear',
        pendingOperations: [],
        recentReceipts: [],
        activeOperation: null,
        draftItems: [],
        message: null,
      };
      emit();
    },
    dispose() {
      if (disposed) return;
      releaseDraftUrls();
      projection.draftItems = [];
      listeners.clear();
      disposed = true;
    },
  };
}
