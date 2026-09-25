import type {
  ProjectAssetImportPlan,
  ProjectAssetImportStagedItem,
  ProjectAssetImportTargetRequest,
  ProjectAssetRelocationPlan,
  ProjectAssetRelocationBatchPlan,
  HumanWorkspaceReportedAvailability,
  HumanWorkspaceDirtyScope,
  HumanWorkspaceBusyReason,
  HumanWorkspaceBlockedReason,
  ProjectMutationNotice,
  PreviewPublishInput,
  PreviewPublishAck,
  PreviewContent, PreviewContentOption, PreviewContentTarget,
} from '@surdet/authoring';
import { isPreviewSourcePath, parsePreviewContentTarget, stableStringify } from '@surdet/authoring';
import type { ProjectDiskBaseline } from './project-disk-baseline';

const AUTHORITY_HEADER = 'x-surdet-asset-import-authority';
const BINDING_HEADER = 'x-surdet-project-binding';
const OPERATION_HEADER = 'x-surdet-import-operation';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const UPLOAD_IDLE_TIMEOUT_MS = 35_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
type OperationKind = 'import' | 'relocation' | 'scene' | 'workspace';

export type AssetImportOperationStatus =
  | 'UPLOADING' | 'STAGED' | 'READY' | 'PUBLISHING' | 'ROLLING_BACK'
  | 'ROLLED_BACK' | 'RECOVERY_REQUIRED' | 'COMMITTED' | 'UNDOING'
  | 'UNDONE' | 'CANCELLED';

export type AssetImportRetryDisposition =
  | 'same-request' | 'after-refresh' | 'after-human-action' | 'manual-recovery' | 'never';

export interface AssetImportAuthorityBrowserConfig {
  authorityContractVersion: 1;
  endpoint: string;
  token: string;
}

export interface AssetImportAuthorityStatus {
  authorityContractVersion: 1;
  authorityAvailable: true;
  projectIdentity: string;
  bindingRequired: true;
}

export interface AssetImportOperationSummary {
  operationId: string;
  status: AssetImportOperationStatus;
  itemCount: number;
  updatedAt: string;
  manualRecoveryRequired: boolean;
}

export interface AssetImportReceiptSummary {
  operationId: string;
  receiptId: string;
  status: 'COMMITTED' | 'UNDONE';
  fileCount: number;
  committedAt: string;
}

export interface AssetImportOperationDiscovery {
  pendingOperations: AssetImportOperationSummary[];
  recentReceipts: AssetImportReceiptSummary[];
}

export type AssetRelocationOperationStatus =
  | 'PLANNED' | 'PUBLISHING' | 'ROLLING_BACK' | 'ROLLED_BACK'
  | 'RECOVERY_REQUIRED' | 'COMMITTED' | 'UNDOING' | 'UNDONE' | 'CANCELLED';

export interface AssetRelocationFileEvidence {
  device: string;
  inode: string;
  birthtimeNs: string;
  size: number;
  mtimeNs: string;
  sha256: string;
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

export type AssetRelocationOperation = AssetRelocationOperationSummary;

export type AssetRelocationPlanDescriptor = NonNullable<ProjectAssetRelocationPlan['source']>;
export type AssetRelocationReferenceChange = ProjectAssetRelocationPlan['referenceChanges'][number];
export type AssetRelocationBlocker = ProjectAssetRelocationPlan['blockers'][number];

export interface AssetRelocationPublicPlan {
  schemaVersion: 1 | 2;
  operationId: string;
  planId: string;
  planFingerprint: string;
  status: 'ready' | 'blocked';
  source: AssetRelocationPlanDescriptor | null;
  target: AssetRelocationPlanDescriptor | null;
  moves: ProjectAssetRelocationBatchPlan['moves'];
  affectedAssetCount: number;
  affectedReferenceCount: number;
  affectedFileCount: number;
  referenceChanges: AssetRelocationReferenceChange[];
  blockers: AssetRelocationBlocker[];
}

export interface AssetRelocationRequest {
  operationId: string;
  sourcePath: string;
  targetPath: string;
  moves: AssetRelocationMoveRequest[];
}

export interface AssetRelocationMoveRequest {
  sourcePath: string;
  targetPath: string;
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
  moves: Array<AssetRelocationMoveRequest & {
    moveId: string;
    targetIdentity: AssetRelocationFileEvidence;
  }>;
  textFiles: Array<{
    path: string;
    sha256: string;
    identity: AssetRelocationFileEvidence;
  }>;
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
  moves: Array<AssetRelocationMoveRequest & {
    moveId: string;
    sourceIdentity: AssetRelocationFileEvidence;
  }>;
  restoredTextFiles: Array<{
    path: string;
    sha256: string;
    identity: AssetRelocationFileEvidence;
  }>;
  undoneAt: string;
}

export interface AssetRelocationDetail {
  request: AssetRelocationRequest;
  operation: AssetRelocationOperation;
  plan: AssetRelocationPublicPlan;
  receipt: AssetRelocationReceipt | null;
  undoReceipt: AssetRelocationUndoReceipt | null;
  allowedActions: string[];
}

export interface AssetRelocationDiscovery {
  operations: AssetRelocationOperationSummary[];
  recentReceipts: AssetRelocationReceipt[];
}

export type AssetRelocationPlanInput = {
  operationId: string;
  sourcePath: string;
  targetDirectory: string;
  fileName: string;
  moves?: never;
} | {
  operationId: string;
  moves: AssetRelocationMoveRequest[];
  sourcePath?: never;
  targetDirectory?: never;
  fileName?: never;
};

export interface AssetRelocationTokenResult {
  operationToken: string;
  expiresAt: string;
  detail: AssetRelocationDetail;
}

export interface SceneLifecyclePlanInput {
  operationId: string;
  kind: 'rename' | 'delete';
  sourcePath: string;
  targetPath?: string;
}

export interface SceneLifecyclePlanResult {
  operationId: string;
  kind: 'rename' | 'delete';
  sourcePath: string;
  targetPath: string | null;
  planFingerprint: string;
  status: 'PLANNED' | 'COMMITTED' | 'CANCELLED';
}

export interface SceneLifecycleCommitInput {
  requestId: string;
  configRenames?: Array<{ from: string; to: string }>;
  plans: Array<{ operationId: string; planFingerprint: string }>;
  writes: Array<{ path: string; text: string; expectedSha256: string | null }>;
}

export interface SceneLifecycleCommitResult {
  requestId: string;
  status: 'COMMITTED';
  writes: Array<{ path: string; sha256: string }>;
  deletedPaths: string[];
}

export interface AssetImportBindingSnapshot extends AssetImportOperationDiscovery {
  projectIdentity: string;
  projectName: string;
  bindingExpiresAt: string;
  recoveryBarrier: 'clear' | 'recoverable' | 'manual-recovery';
  pendingRelocations: AssetRelocationOperationSummary[];
  recentRelocationReceipts: AssetRelocationReceipt[];
}

export interface AssetImportReceipt {
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
    fileIdentity: { device: string; inode: string; birthtimeNs: string };
  }>;
  committedAt: string;
}

export interface AssetImportUndoReceipt {
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

export interface AssetImportOperationDetail {
  operation: AssetImportOperationSummary;
  plan: ProjectAssetImportPlan | null;
  receipt: AssetImportReceipt | null;
  undoReceipt: AssetImportUndoReceipt | null;
  allowedActions: string[];
}

export interface AssetImportCreateInput {
  operationId: string;
  items: Array<{ itemId: string; sourceName: string; declaredBytes: number }>;
}

export interface AssetImportCreateResult {
  operationId: string;
  status: 'UPLOADING';
  expiresAt: string;
}

export interface AssetImportSealResult {
  operationId: string;
  status: 'READY';
  planId: string;
  planFingerprint: string;
}

export interface AssetImportCommitResult {
  operation: AssetImportOperationSummary;
  receipt: AssetImportReceipt;
}

export interface AssetImportUploadProgress {
  loaded: number;
  total: number;
  ratio: number;
}

export interface AssetImportAuthorityClient {
  workspace: EditorWorkspaceClient;
  status(): Promise<AssetImportAuthorityStatus>;
  bindProject(handle: FileSystemDirectoryHandle): Promise<AssetImportBindingSnapshot>;
  listOperations(): Promise<AssetImportOperationDiscovery>;
  queryOperation(operationId: string): Promise<AssetImportOperationDetail>;
  createOperation(input: AssetImportCreateInput): Promise<AssetImportCreateResult>;
  uploadItem(
    operationId: string,
    itemId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<ProjectAssetImportStagedItem>;
  plan(operationId: string, input: { targets: ProjectAssetImportTargetRequest[] }): Promise<{ operationId: string; status: 'STAGED' | 'READY'; plan: ProjectAssetImportPlan }>;
  seal(operationId: string, input: { planFingerprint: string }): Promise<AssetImportSealResult>;
  commit(operationId: string, planFingerprint: string): Promise<AssetImportCommitResult>;
  cancel(operationId: string): Promise<AssetImportOperationSummary>;
  resume(operationId: string): Promise<AssetImportOperationDetail>;
  recover(operationId: string, input: { action: 'resume' | 'rollback' }): Promise<AssetImportOperationDetail>;
  undo(operationId: string, input: { receiptId: string; receiptSha256: string }): Promise<{ operation: AssetImportOperationSummary; undoReceipt: AssetImportUndoReceipt }>;
  relocationPlan(input: AssetRelocationPlanInput): Promise<AssetRelocationTokenResult>;
  relocationList(): Promise<AssetRelocationDiscovery>;
  relocationQuery(operationId: string): Promise<AssetRelocationDetail>;
  relocationResume(operationId: string): Promise<AssetRelocationTokenResult>;
  relocationCommit(operationId: string, planFingerprint: string): Promise<AssetRelocationDetail>;
  relocationCancel(operationId: string): Promise<AssetRelocationDetail>;
  relocationRecover(operationId: string, input: { action: 'resume' | 'rollback' }): Promise<AssetRelocationDetail>;
  relocationUndo(operationId: string, input: { receiptId: string; receiptFingerprint: string }): Promise<AssetRelocationDetail>;
  scenePlan(input: SceneLifecyclePlanInput, workspaceWrite?: EditorWorkspaceWrite): Promise<SceneLifecyclePlanResult>;
  sceneCommit(input: SceneLifecycleCommitInput, workspaceWrite?: EditorWorkspaceWrite): Promise<SceneLifecycleCommitResult>;
  revokeBinding(): Promise<void>;
  dispose(): void;
}

export interface EditorWorkspaceState {
  workspaceSessionId: string;
  workspaceGeneration: number;
  availability: HumanWorkspaceReportedAvailability;
  dirtyScopes: HumanWorkspaceDirtyScope[];
  busyReasons: HumanWorkspaceBusyReason[];
  blockedReasons: HumanWorkspaceBlockedReason[];
  loadedProjectRevision?: string;
  loadedCoordinationRevision?: string;
}

export interface EditorWorkspaceSnapshot {
  projectIdentity: string;
  diskBaseline: ProjectDiskBaseline;
  mutationNotice: ProjectMutationNotice | null;
}

export interface EditorWorkspaceWrite extends EditorWorkspaceState { writeLeaseId: string }
export interface EditorWorkspaceSettlement {
  diskBaseline: ProjectDiskBaseline;
  changedPaths: string[];
  mutationNotice: { status: 'none' | 'written' | 'unavailable'; message?: string };
}

export interface EditorWorkspaceClient {
  heartbeat(state: EditorWorkspaceState): Promise<void>;
  preview(state: EditorWorkspaceState & { preview: PreviewPublishInput }): Promise<PreviewPublishAck>;
  previewSources(state: EditorWorkspaceState): Promise<PreviewContentOption[]>;
  previewContent(state: EditorWorkspaceState & { target: PreviewContentTarget }): Promise<PreviewContent>;
  snapshot(workspaceSessionId: string): Promise<EditorWorkspaceSnapshot>;
  begin(state: EditorWorkspaceState & { expectedProjectRevision: string; expectedCoordinationRevision: string;
    purpose: 'save-all' | 'config-save' | 'character-save' }): Promise<{ writeLeaseId: string; expiresAt: string; diskBaseline: ProjectDiskBaseline }>;
  publish(state: EditorWorkspaceWrite & { path: string; text: string | null; expectedSha256: string | null }): Promise<{ sha256: string | null }>;
  renew(state: EditorWorkspaceWrite): Promise<void>;
  finish(state: EditorWorkspaceWrite): Promise<EditorWorkspaceSettlement>;
  abort(state: EditorWorkspaceWrite): Promise<void>;
  revoke(workspaceSessionId: string): Promise<void>;
}

export interface AssetImportAuthorityClientOptions {
  configuration?: AssetImportAuthorityBrowserConfig | null;
  fetcher?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
  timeoutMs?: number;
  createUuid?: () => string;
}

export class AssetImportClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryDisposition: AssetImportRetryDisposition = 'never',
    readonly details?: { operationId?: string; itemId?: string; field?: string },
  ) {
    super(message);
    this.name = 'AssetImportClientError';
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __SURDET_ASSET_IMPORT_AUTHORITY__: AssetImportAuthorityBrowserConfig | undefined;
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  INVALID_REQUEST: '导入请求格式不正确，请重新选择素材。',
  AUTHORITY_UNAVAILABLE: '本机素材导入服务未连接。请从项目启动器重新打开编辑器。',
  AUTHORITY_ORIGIN_REJECTED: '当前页面不是该项目授权的编辑器页面。',
  AUTHORITY_TOKEN_REJECTED: '项目导入授权已失效，请重新绑定项目。',
  PROJECT_ROOT_IDENTITY_UNAVAILABLE: '无法确认当前项目目录身份。',
  PROJECT_IDENTITY_MISMATCH: '当前打开的目录与导入服务绑定的项目不一致。',
  PROJECT_BUSY: '项目正在被另一项写入操作占用，请稍后重试。',
  IMPORT_FILESYSTEM_UNSUPPORTED: '当前文件系统不支持安全导入。',
  PATH_OUTSIDE_PROJECT: '项目包含越界路径、符号链接或目录联接。请先整理为项目内的真实文件后重试。',
  IMPORT_OPERATION_NOT_FOUND: '没有找到这次导入记录。',
  IMPORT_OPERATION_CONFLICT: '这次导入的状态已经变化，请刷新后继续。',
  IMPORT_PLAN_BLOCKED: '导入计划存在冲突，请先处理标出的文件。',
  IMPORT_PLAN_STALE: '项目内容已变化，请重新生成导入计划。',
  IMPORT_TARGET_EXISTS: '目标位置已有同名文件，Surdet 不会覆盖它。',
  IMPORT_TARGET_UNSAFE: '目标文件名或位置不安全。',
  IMPORT_UPLOAD_MISMATCH: '上传文件与选择时的大小不一致。',
  IMPORT_LIMIT_EXCEEDED: '本次导入的文件数量或大小超出限制。',
  IMPORT_RECOVERY_REQUIRED: '上一次导入未完整结束，需要人工恢复。',
  IMPORT_UNDO_BLOCKED_CHANGED: '导入后的文件已被修改，不能自动撤销。',
  IMPORT_UPLOAD_TIMEOUT: '上传长时间没有进度，请检查磁盘状态后重试。',
  IMPORT_OPERATION_NOT_AUTHORIZED: '这次导入需要重新恢复授权后才能继续。',
  AUTHORITY_INVALID_RESPONSE: '本机素材导入服务返回了无法识别的结果。',
});

const RELOCATION_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  INVALID_REQUEST: '素材整理请求格式不正确，请重新检查。',
  PROJECT_BUSY: '项目正在被另一项写入操作占用，请稍后重试。',
  IMPORT_OPERATION_NOT_FOUND: '没有找到这次素材整理记录。',
  IMPORT_OPERATION_CONFLICT: '这次素材整理的状态已经变化，请刷新后继续。',
  IMPORT_PLAN_BLOCKED: '素材整理计划存在阻断项，请先处理标出的内容。',
  IMPORT_PLAN_STALE: '项目内容已变化，请重新检查整理影响。',
  IMPORT_TARGET_EXISTS: '目标位置已有同名文件，Surdet 不会覆盖它。',
  IMPORT_TARGET_UNSAFE: '目标文件名或位置不安全。',
  IMPORT_RECOVERY_REQUIRED: '上一次素材整理未完整结束，需要人工恢复。',
  IMPORT_UNDO_BLOCKED_CHANGED: '素材整理后的文件已被修改，不能自动撤销。',
  IMPORT_OPERATION_NOT_AUTHORIZED: '这次素材整理需要重新恢复授权后才能继续。',
  ASSET_RELOCATION_SOURCE_NOT_FOUND: '没有找到要整理的源素材。',
  ASSET_RELOCATION_SOURCE_AMBIGUOUS: '源素材身份不唯一，不能自动整理。',
  ASSET_RELOCATION_TARGET_EXISTS: '目标位置已有同名文件，Surdet 不会覆盖它。',
  ASSET_RELOCATION_TARGET_UNSAFE: '目标文件名或位置不安全。',
  ASSET_RELOCATION_SCAN_INCOMPLETE: '项目内容扫描不完整，请重新检查整理影响。',
  ASSET_RELOCATION_OPAQUE_REFERENCE: '项目中存在无法安全改写的素材引用。',
  ASSET_RELOCATION_RECOVERY_REQUIRED: '上一次素材整理未完整结束，需要人工恢复。',
  ASSET_RELOCATION_UNDO_BLOCKED_CHANGED: '素材整理后的文件已被修改，不能自动撤销。',
});

const SCENE_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  ...ERROR_MESSAGES,
  INVALID_REQUEST: '场景保存请求格式不正确。',
  AUTHORITY_UNAVAILABLE: '本机场景安全保存服务未连接，请从项目启动器重新打开编辑器。',
  IMPORT_OPERATION_NOT_FOUND: '没有找到这次场景操作记录。',
  IMPORT_OPERATION_CONFLICT: '这次场景操作的状态已经变化，请重新打开项目后再试。',
  IMPORT_PLAN_STALE: '场景文件已在编辑器外发生变化，Surdet 没有覆盖它。请重新打开项目核对。',
  IMPORT_TARGET_EXISTS: '目标场景文件已被占用，Surdet 没有覆盖它。',
  IMPORT_TARGET_UNSAFE: '场景文件位置不安全。',
  IMPORT_RECOVERY_REQUIRED: '场景保存没有完整收束，请保留现场并重新打开项目。',
});

const OPERATION_STATUSES = new Set<AssetImportOperationStatus>([
  'UPLOADING', 'STAGED', 'READY', 'PUBLISHING', 'ROLLING_BACK', 'ROLLED_BACK',
  'RECOVERY_REQUIRED', 'COMMITTED', 'UNDOING', 'UNDONE', 'CANCELLED',
]);
const RELOCATION_OPERATION_STATUSES = new Set<AssetRelocationOperationStatus>([
  'PLANNED', 'PUBLISHING', 'ROLLING_BACK', 'ROLLED_BACK', 'RECOVERY_REQUIRED',
  'COMMITTED', 'UNDOING', 'UNDONE', 'CANCELLED',
]);
const ASSET_KINDS = new Set([
  'background', 'portrait', 'avatar', 'music', 'ambience',
  'sound-effect', 'voice', 'video', 'font', 'other',
]);
const PLAN_ISSUES = new Set([
  'IMPORT_NAME_INVALID', 'IMPORT_FORMAT_UNSUPPORTED', 'IMPORT_PORTRAIT_NAME_INVALID',
  'IMPORT_TARGET_DUPLICATE_IN_BATCH', 'IMPORT_TARGET_EXISTS', 'IMPORT_TARGET_UNSAFE',
  'IMPORT_ASSET_KEY_CONFLICT',
]);
const ALLOWED_ACTIONS = new Set(['upload', 'plan', 'seal', 'commit', 'cancel', 'resume', 'recover', 'undo']);
const RELOCATION_ALLOWED_ACTIONS = new Set(['commit', 'cancel', 'resume', 'recover', 'undo']);
const RETRY_DISPOSITIONS = new Set<AssetImportRetryDisposition>([
  'same-request', 'after-refresh', 'after-human-action', 'manual-recovery', 'never',
]);
const RELOCATION_REFERENCE_SOURCES = new Set(['scene', 'timeline', 'character', 'gallery', 'config']);
const RELOCATION_BLOCKERS = new Set([
  'ASSET_RELOCATION_BATCH_EMPTY',
  'ASSET_RELOCATION_BATCH_LIMIT',
  'ASSET_RELOCATION_DUPLICATE_SOURCE',
  'ASSET_RELOCATION_DUPLICATE_TARGET',
  'ASSET_RELOCATION_BATCH_KIND_MISMATCH',
  'ASSET_RELOCATION_SOURCE_NOT_FOUND',
  'ASSET_RELOCATION_SOURCE_AMBIGUOUS',
  'ASSET_RELOCATION_UNSUPPORTED_KIND',
  'ASSET_RELOCATION_TARGET_UNSAFE',
  'ASSET_RELOCATION_SCAN_INCOMPLETE',
  'ASSET_RELOCATION_TARGET_NAME_INVALID',
  'ASSET_RELOCATION_TARGET_DIRECTORY_MISSING',
  'ASSET_RELOCATION_TARGET_KIND_MISMATCH',
  'ASSET_RELOCATION_EXTENSION_CHANGED',
  'ASSET_RELOCATION_TARGET_EXISTS',
  'ASSET_RELOCATION_TARGET_KEY_DUPLICATE',
  'ASSET_RELOCATION_PORTRAIT_NAME_INVALID',
  'ASSET_RELOCATION_RESERVED_KEY',
  'ASSET_RELOCATION_OPAQUE_REFERENCE',
  'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
  'ASSET_RELOCATION_NO_CHANGE',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeText(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL_CHARACTER.test(value);
}

function isTimestamp(value: unknown): value is string {
  return isSafeText(value, 64) && Number.isFinite(Date.parse(value));
}

function isSecretToken(value: unknown): value is string {
  return isSafeText(value) && value.length >= 32 && !/\s/.test(value);
}

function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function isSha256(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }

function hasRequiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isProjectRelativePath(value: unknown, max = 1_024): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:/u.test(value)
    && !CONTROL_CHARACTER.test(value)
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isRelocationFileName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && !CONTROL_CHARACTER.test(value)
    && !/[\\/]/u.test(value)
    && value !== '.'
    && value !== '..'
    && !/[ .]$/u.test(value);
}

function invalidResponse(message = ERROR_MESSAGES.AUTHORITY_INVALID_RESPONSE): AssetImportClientError {
  return new AssetImportClientError('AUTHORITY_INVALID_RESPONSE', message!, 'never');
}

function unavailable(): AssetImportClientError {
  return new AssetImportClientError('AUTHORITY_UNAVAILABLE', ERROR_MESSAGES.AUTHORITY_UNAVAILABLE!, 'same-request');
}

function normalizeConfiguration(value: unknown): AssetImportAuthorityBrowserConfig | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['authorityContractVersion', 'endpoint', 'token'])
    || value.authorityContractVersion !== 1
    || typeof value.endpoint !== 'string'
    || !value.endpoint.startsWith('/')
    || value.endpoint.startsWith('//')
    || value.endpoint.endsWith('/')
    || value.endpoint.includes('?')
    || value.endpoint.includes('#')
    || value.endpoint.includes('\\')
    || /\s/.test(value.endpoint)
    || typeof value.token !== 'string'
    || value.token.length < 32
    || value.token.length > 512
    || /\s/.test(value.token)
    || CONTROL_CHARACTER.test(value.token)) return null;
  return { authorityContractVersion: 1, endpoint: value.endpoint, token: value.token };
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.trunc(value), MAX_TIMEOUT_MS);
}

function parseOperationSummary(value: unknown): AssetImportOperationSummary {
  if (!isRecord(value)
    || !hasExactKeys(value, ['itemCount', 'manualRecoveryRequired', 'operationId', 'status', 'updatedAt'])
    || !isUuid(value.operationId)
    || typeof value.status !== 'string'
    || !OPERATION_STATUSES.has(value.status as AssetImportOperationStatus)
    || !Number.isSafeInteger(value.itemCount)
    || (value.itemCount as number) < 0
    || !isTimestamp(value.updatedAt)
    || typeof value.manualRecoveryRequired !== 'boolean') throw invalidResponse();
  return value as unknown as AssetImportOperationSummary;
}

function parseReceiptSummary(value: unknown): AssetImportReceiptSummary {
  if (!isRecord(value)
    || !hasExactKeys(value, ['committedAt', 'fileCount', 'operationId', 'receiptId', 'status'])
    || !isUuid(value.operationId)
    || !isUuid(value.receiptId)
    || (value.status !== 'COMMITTED' && value.status !== 'UNDONE')
    || !Number.isSafeInteger(value.fileCount)
    || (value.fileCount as number) < 0
    || !isTimestamp(value.committedAt)) throw invalidResponse();
  return value as unknown as AssetImportReceiptSummary;
}

function parseDiscovery(value: unknown): AssetImportOperationDiscovery {
  if (!isRecord(value)
    || !hasExactKeys(value, ['pendingOperations', 'recentReceipts'])
    || !Array.isArray(value.pendingOperations)
    || !Array.isArray(value.recentReceipts)) throw invalidResponse();
  return {
    pendingOperations: value.pendingOperations.map(parseOperationSummary),
    recentReceipts: value.recentReceipts.map(parseReceiptSummary),
  };
}

function parseRelocationFileEvidence(value: unknown): AssetRelocationFileEvidence {
  if (!isRecord(value)
    || !hasExactKeys(value, ['birthtimeNs', 'device', 'inode', 'mtimeNs', 'sha256', 'size'])
    || !isSafeText(value.device, 128)
    || !isSafeText(value.inode, 128)
    || !isSafeText(value.birthtimeNs, 128)
    || !isSafeText(value.mtimeNs, 128)
    || !isSha256(value.sha256)
    || !Number.isSafeInteger(value.size)
    || (value.size as number) < 0) throw invalidResponse();
  return value as unknown as AssetRelocationFileEvidence;
}

function parseRelocationDescriptor(value: unknown): NonNullable<ProjectAssetRelocationPlan['source']> {
  if (!isRecord(value)
    || !hasRequiredKeys(value, ['directory', 'fileName', 'format', 'invalidName', 'key', 'kind', 'path'], ['variant'])
    || !isProjectRelativePath(value.path)
    || !isProjectRelativePath(value.directory)
    || !isRelocationFileName(value.fileName)
    || !isSafeText(value.format, 32)
    || !isSafeText(value.key, 256)
    || typeof value.kind !== 'string'
    || !ASSET_KINDS.has(value.kind)
    || typeof value.invalidName !== 'boolean'
    || (value.variant !== undefined && !isSafeText(value.variant, 256))) throw invalidResponse();
  return value as unknown as NonNullable<ProjectAssetRelocationPlan['source']>;
}

function parseRelocationMoveRequests(value: unknown): AssetRelocationMoveRequest[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw invalidResponse();
  return value.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ['sourcePath', 'targetPath'])
      || !isProjectRelativePath(entry.sourcePath) || !isProjectRelativePath(entry.targetPath)) throw invalidResponse();
    return { sourcePath: entry.sourcePath, targetPath: entry.targetPath };
  });
}

function parseRelocationReferenceChange(value: unknown): ProjectAssetRelocationPlan['referenceChanges'][number] {
  if (!isRecord(value)
    || !hasRequiredKeys(value, ['after', 'before', 'field', 'referenceId', 'sourceKind', 'sourceLabel', 'sourcePath'], ['line', 'moveIds'])
    || !isSafeText(value.referenceId, 256)
    || typeof value.sourceKind !== 'string'
    || !RELOCATION_REFERENCE_SOURCES.has(value.sourceKind)
    || !isSafeText(value.sourceLabel, 512)
    || !isProjectRelativePath(value.sourcePath)
    || !isSafeText(value.field, 256)
    || !isSafeText(value.before, 2_048)
    || !isSafeText(value.after, 2_048)
    || (value.moveIds !== undefined && (!Array.isArray(value.moveIds)
      || !value.moveIds.every((item) => isSafeText(item, 128))))
    || (value.line !== undefined && (!Number.isSafeInteger(value.line) || (value.line as number) < 1))) throw invalidResponse();
  return value as unknown as ProjectAssetRelocationPlan['referenceChanges'][number];
}

function parseRelocationBlocker(value: unknown): ProjectAssetRelocationPlan['blockers'][number] {
  if (!isRecord(value)
    || !hasRequiredKeys(value, ['code', 'message'], ['line', 'moveIds', 'sourcePath'])
    || typeof value.code !== 'string'
    || !RELOCATION_BLOCKERS.has(value.code)
    || !isSafeText(value.message, 1_024)
    || (value.moveIds !== undefined && (!Array.isArray(value.moveIds)
      || !value.moveIds.every((item) => isSafeText(item, 128))))
    || (value.sourcePath !== undefined && !isProjectRelativePath(value.sourcePath))
    || (value.line !== undefined && (!Number.isSafeInteger(value.line) || (value.line as number) < 1))) throw invalidResponse();
  return value as unknown as ProjectAssetRelocationPlan['blockers'][number];
}

function parseRelocationPublicPlan(value: unknown): AssetRelocationPublicPlan {
  if (!isRecord(value)
    || !isUuid(value.operationId)
    || !isSafeText(value.planId, 256)
    || !isSha256(value.planFingerprint)
    || (value.status !== 'ready' && value.status !== 'blocked')
    || (value.source !== null && !isRecord(value.source))
    || (value.target !== null && !isRecord(value.target))
    || !Number.isSafeInteger(value.affectedReferenceCount)
    || (value.affectedReferenceCount as number) < 0
    || !Number.isSafeInteger(value.affectedFileCount)
    || (value.affectedFileCount as number) < 0
    || !Array.isArray(value.referenceChanges)
    || !Array.isArray(value.blockers)) throw invalidResponse();
  const schemaVersion = value.schemaVersion;
  const legacy = schemaVersion === 1 && hasExactKeys(value, [
    'affectedFileCount', 'affectedReferenceCount', 'blockers', 'operationId', 'planFingerprint',
    'planId', 'referenceChanges', 'schemaVersion', 'source', 'status', 'target',
  ]);
  const batch = schemaVersion === 2 && hasExactKeys(value, [
    'affectedAssetCount', 'affectedFileCount', 'affectedReferenceCount', 'blockers', 'moves',
    'operationId', 'planFingerprint', 'planId', 'referenceChanges', 'schemaVersion', 'source', 'status', 'target',
  ]);
  if (!legacy && !batch) throw invalidResponse();
  const source = value.source === null ? null : parseRelocationDescriptor(value.source);
  const target = value.target === null ? null : parseRelocationDescriptor(value.target);
  const referenceChanges = value.referenceChanges.map(parseRelocationReferenceChange);
  const blockers = value.blockers.map(parseRelocationBlocker);
  const moves = batch && Array.isArray(value.moves)
    ? value.moves.map((entry) => {
      if (!isRecord(entry) || !hasExactKeys(entry, ['moveId', 'source', 'target'])
        || !isSafeText(entry.moveId, 128)) throw invalidResponse();
      return {
        moveId: entry.moveId,
        source: parseRelocationDescriptor(entry.source),
        target: parseRelocationDescriptor(entry.target),
      };
    })
    : source !== null && target !== null
      ? [{ moveId: 'relocation-move-legacy', source, target }]
      : [];
  const affectedAssetCount = batch ? value.affectedAssetCount : value.status === 'ready' ? moves.length : 0;
  if (!Number.isSafeInteger(affectedAssetCount) || (affectedAssetCount as number) < 0
    || (value.status === 'ready' && affectedAssetCount !== moves.length)
    || (value.status === 'blocked' && affectedAssetCount !== 0)) throw invalidResponse();
  if (value.affectedReferenceCount !== referenceChanges.length
    || (value.status === 'ready' && blockers.length > 0)
    || (value.status === 'blocked' && (referenceChanges.length > 0 || value.affectedReferenceCount !== 0))) throw invalidResponse();
  return {
    ...value,
    schemaVersion,
    source,
    target,
    moves,
    affectedAssetCount: affectedAssetCount as number,
    referenceChanges,
    blockers,
  } as unknown as AssetRelocationPublicPlan;
}

function parseRelocationOperationSummary(value: unknown): AssetRelocationOperationSummary {
  if (!isRecord(value)
    || !hasRequiredKeys(value, ['manualRecoveryRequired', 'operationId', 'sourcePath', 'status', 'targetPath', 'updatedAt'], ['moves'])
    || !isUuid(value.operationId)
    || typeof value.status !== 'string'
    || !RELOCATION_OPERATION_STATUSES.has(value.status as AssetRelocationOperationStatus)
    || !isProjectRelativePath(value.sourcePath)
    || !isProjectRelativePath(value.targetPath)
    || !isTimestamp(value.updatedAt)
    || typeof value.manualRecoveryRequired !== 'boolean') throw invalidResponse();
  const moves = value.moves === undefined
    ? [{ sourcePath: value.sourcePath, targetPath: value.targetPath }]
    : parseRelocationMoveRequests(value.moves);
  return { ...value, moves } as unknown as AssetRelocationOperationSummary;
}

function parseRelocationOperation(value: unknown): AssetRelocationOperation {
  return parseRelocationOperationSummary(value);
}

function parseRelocationRequest(value: unknown): AssetRelocationRequest {
  if (!isRecord(value)
    || !hasRequiredKeys(value, ['operationId', 'sourcePath', 'targetPath'], ['moves'])
    || !isUuid(value.operationId)
    || !isProjectRelativePath(value.sourcePath)
    || !isProjectRelativePath(value.targetPath)) throw invalidResponse();
  const moves = value.moves === undefined
    ? [{ sourcePath: value.sourcePath, targetPath: value.targetPath }]
    : parseRelocationMoveRequests(value.moves);
  if (moves[0]?.sourcePath !== value.sourcePath || moves[0]?.targetPath !== value.targetPath) throw invalidResponse();
  return { ...value, moves } as unknown as AssetRelocationRequest;
}

function parseRelocationReceipt(value: unknown): AssetRelocationReceipt {
  if (!isRecord(value)
    || !hasRequiredKeys(value, [
      'committedAt', 'operationId', 'planFingerprint', 'planId', 'projectIdentity', 'receiptFingerprint',
      'receiptId', 'schemaVersion', 'sourcePath', 'targetIdentity', 'targetPath', 'textFiles',
    ], ['moves'])
    || value.schemaVersion !== 1
    || !isUuid(value.receiptId)
    || !isSha256(value.receiptFingerprint)
    || !isUuid(value.operationId)
    || !isSafeText(value.planId, 256)
    || !isSha256(value.planFingerprint)
    || !isSha256(value.projectIdentity)
    || !isProjectRelativePath(value.sourcePath)
    || !isProjectRelativePath(value.targetPath)
    || !isRecord(value.targetIdentity)
    || !Array.isArray(value.textFiles)
    || !isTimestamp(value.committedAt)) throw invalidResponse();
  const textPaths = new Set<string>();
  const textFiles = value.textFiles.map((entry) => {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ['identity', 'path', 'sha256'])
      || !isProjectRelativePath(entry.path)
      || textPaths.has(entry.path as string)
      || !isSha256(entry.sha256)
      || !isRecord(entry.identity)) throw invalidResponse();
    textPaths.add(entry.path as string);
    return {
      path: entry.path as string,
      sha256: entry.sha256 as string,
      identity: parseRelocationFileEvidence(entry.identity),
    };
  });
  const targetIdentity = parseRelocationFileEvidence(value.targetIdentity);
  const moves = value.moves === undefined
    ? [{ moveId: 'relocation-move-legacy', sourcePath: value.sourcePath, targetPath: value.targetPath, targetIdentity }]
    : (() => {
      if (!Array.isArray(value.moves) || value.moves.length < 1 || value.moves.length > 100) throw invalidResponse();
      return value.moves.map((entry) => {
        if (!isRecord(entry) || !hasExactKeys(entry, ['moveId', 'sourcePath', 'targetIdentity', 'targetPath'])
          || !isSafeText(entry.moveId, 128) || !isProjectRelativePath(entry.sourcePath)
          || !isProjectRelativePath(entry.targetPath)) throw invalidResponse();
        return {
          moveId: entry.moveId,
          sourcePath: entry.sourcePath,
          targetPath: entry.targetPath,
          targetIdentity: parseRelocationFileEvidence(entry.targetIdentity),
        };
      });
    })();
  return {
    ...value,
    targetIdentity,
    moves,
    textFiles,
  } as unknown as AssetRelocationReceipt;
}

function parseRelocationUndoReceipt(value: unknown): AssetRelocationUndoReceipt {
  if (!isRecord(value)
    || !hasRequiredKeys(value, [
      'operationId', 'receiptId', 'restoredTextFiles', 'schemaVersion', 'sourceIdentity',
      'sourcePath', 'targetPath', 'undoReceiptFingerprint', 'undoReceiptId', 'undoneAt',
    ], ['moves'])
    || value.schemaVersion !== 1
    || !isUuid(value.undoReceiptId)
    || !isSha256(value.undoReceiptFingerprint)
    || !isUuid(value.operationId)
    || !isUuid(value.receiptId)
    || !isProjectRelativePath(value.sourcePath)
    || !isProjectRelativePath(value.targetPath)
    || !isRecord(value.sourceIdentity)
    || !Array.isArray(value.restoredTextFiles)
    || !isTimestamp(value.undoneAt)) throw invalidResponse();
  const restoredPaths = new Set<string>();
  const restoredTextFiles = value.restoredTextFiles.map((entry) => {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ['identity', 'path', 'sha256'])
      || !isProjectRelativePath(entry.path)
      || restoredPaths.has(entry.path as string)
      || !isSha256(entry.sha256)
      || !isRecord(entry.identity)) throw invalidResponse();
    restoredPaths.add(entry.path as string);
    return {
      path: entry.path as string,
      sha256: entry.sha256 as string,
      identity: parseRelocationFileEvidence(entry.identity),
    };
  });
  const sourceIdentity = parseRelocationFileEvidence(value.sourceIdentity);
  const moves = value.moves === undefined
    ? [{ moveId: 'relocation-move-legacy', sourcePath: value.sourcePath, targetPath: value.targetPath, sourceIdentity }]
    : (() => {
      if (!Array.isArray(value.moves) || value.moves.length < 1 || value.moves.length > 100) throw invalidResponse();
      return value.moves.map((entry) => {
        if (!isRecord(entry) || !hasExactKeys(entry, ['moveId', 'sourceIdentity', 'sourcePath', 'targetPath'])
          || !isSafeText(entry.moveId, 128) || !isProjectRelativePath(entry.sourcePath)
          || !isProjectRelativePath(entry.targetPath)) throw invalidResponse();
        return {
          moveId: entry.moveId,
          sourcePath: entry.sourcePath,
          targetPath: entry.targetPath,
          sourceIdentity: parseRelocationFileEvidence(entry.sourceIdentity),
        };
      });
    })();
  return {
    ...value,
    sourceIdentity,
    moves,
    restoredTextFiles,
  } as unknown as AssetRelocationUndoReceipt;
}

function parseRelocationDetail(value: unknown): AssetRelocationDetail {
  if (!isRecord(value)
    || !hasExactKeys(value, ['allowedActions', 'operation', 'plan', 'receipt', 'request', 'undoReceipt'])
    || !Array.isArray(value.allowedActions)
    || !value.allowedActions.every((entry) => typeof entry === 'string' && RELOCATION_ALLOWED_ACTIONS.has(entry))) throw invalidResponse();
  const request = parseRelocationRequest(value.request);
  const operation = parseRelocationOperation(value.operation);
  const plan = parseRelocationPublicPlan(value.plan);
  const receipt = value.receipt === null ? null : parseRelocationReceipt(value.receipt);
  const undoReceipt = value.undoReceipt === null ? null : parseRelocationUndoReceipt(value.undoReceipt);
  if (operation.operationId !== request.operationId
    || plan.operationId !== request.operationId
    || plan.moves.length !== request.moves.length
    || plan.moves.some((move, index) => move.source.path !== request.moves[index]?.sourcePath
      || move.target.path !== request.moves[index]?.targetPath)
    || (plan.source !== null && plan.source.path !== request.sourcePath)
    || (plan.target !== null && plan.target.path !== request.targetPath)
    || (receipt !== null && (receipt.operationId !== request.operationId
      || receipt.planId !== plan.planId
      || receipt.planFingerprint !== plan.planFingerprint
      || receipt.moves.length !== request.moves.length
      || receipt.sourcePath !== request.sourcePath
      || receipt.targetPath !== request.targetPath))
    || (undoReceipt !== null && (receipt === null
      || undoReceipt.operationId !== request.operationId
      || undoReceipt.receiptId !== receipt.receiptId
      || undoReceipt.moves.length !== request.moves.length
      || undoReceipt.sourcePath !== request.sourcePath
      || undoReceipt.targetPath !== request.targetPath))) throw invalidResponse();
  return { request, operation, plan, receipt, undoReceipt, allowedActions: [...value.allowedActions] };
}

function parseRelocationDiscovery(value: unknown): AssetRelocationDiscovery {
  if (!isRecord(value)
    || !hasExactKeys(value, ['operations', 'recentReceipts'])
    || !Array.isArray(value.operations)
    || !Array.isArray(value.recentReceipts)) throw invalidResponse();
  return {
    operations: value.operations.map(parseRelocationOperationSummary),
    recentReceipts: value.recentReceipts.map(parseRelocationReceipt),
  };
}

function parseRelocationTokenResult(value: unknown): AssetRelocationTokenResult {
  if (!isRecord(value)
    || !hasExactKeys(value, ['detail', 'expiresAt', 'operationToken'])
    || !isSecretToken(value.operationToken)
    || !isTimestamp(value.expiresAt)) throw invalidResponse();
  return {
    operationToken: value.operationToken,
    expiresAt: value.expiresAt,
    detail: parseRelocationDetail(value.detail),
  };
}

function parsePlan(value: unknown): ProjectAssetImportPlan {
  if (!isRecord(value)
    || !hasExactKeys(value, ['issues', 'items', 'manifestFingerprint', 'planFingerprint', 'planId', 'projectIdentity', 'schemaVersion', 'status', 'totalBytes'])
    || value.schemaVersion !== 1
    || !isSafeText(value.planId)
    || !isSha256(value.planFingerprint)
    || !isSha256(value.projectIdentity)
    || !isSha256(value.manifestFingerprint)
    || (value.status !== 'blocked' && value.status !== 'ready')
    || !Array.isArray(value.items)
    || !Array.isArray(value.issues)
    || !value.issues.every((issue) => typeof issue === 'string' && PLAN_ISSUES.has(issue))
    || !Number.isSafeInteger(value.totalBytes)
    || (value.totalBytes as number) < 0) throw invalidResponse();
  for (const item of value.items) {
    if (!isRecord(item)
      || !hasExactKeys(item, ['bytes', 'fileName', 'issues', 'itemId', 'kind', 'sha256', 'sourceName', 'targetPath'])
      || !isUuid(item.itemId)
      || !isSafeText(item.sourceName)
      || !Number.isSafeInteger(item.bytes)
      || (item.bytes as number) < 0
      || !isSha256(item.sha256)
      || typeof item.kind !== 'string'
      || !ASSET_KINDS.has(item.kind)
      || !isSafeText(item.fileName)
      || typeof item.targetPath !== 'string'
      || item.targetPath.length > 1_024
      || CONTROL_CHARACTER.test(item.targetPath)
      || !Array.isArray(item.issues)
      || !item.issues.every((issue) => typeof issue === 'string' && PLAN_ISSUES.has(issue))) throw invalidResponse();
  }
  return value as unknown as ProjectAssetImportPlan;
}

function parseReceipt(value: unknown): AssetImportReceipt {
  if (!isRecord(value)
    || !hasExactKeys(value, ['authorityContractVersion', 'committedAt', 'files', 'journalVersion', 'operationId', 'planFingerprint', 'planId', 'projectIdentity', 'receiptId', 'receiptSha256', 'schemaVersion', 'status'])
    || value.schemaVersion !== 1
    || value.authorityContractVersion !== 1
    || value.status !== 'COMMITTED'
    || !isUuid(value.receiptId)
    || !isSha256(value.receiptSha256)
    || !isUuid(value.operationId)
    || !isSafeText(value.planId)
    || !isSha256(value.planFingerprint)
    || !isSha256(value.projectIdentity)
    || !Number.isSafeInteger(value.journalVersion)
    || !Array.isArray(value.files)
    || !isTimestamp(value.committedAt)) throw invalidResponse();
  for (const file of value.files) {
    if (!isRecord(file)
      || !hasExactKeys(file, ['bytes', 'fileIdentity', 'itemId', 'sha256', 'targetPath'])
      || !isUuid(file.itemId)
      || !isSafeText(file.targetPath, 1_024)
      || !Number.isSafeInteger(file.bytes)
      || (file.bytes as number) < 0
      || !isSha256(file.sha256)
      || !isRecord(file.fileIdentity)
      || !hasExactKeys(file.fileIdentity, ['birthtimeNs', 'device', 'inode'])
      || !isSafeText(file.fileIdentity.device)
      || !isSafeText(file.fileIdentity.inode)
      || !isSafeText(file.fileIdentity.birthtimeNs)) throw invalidResponse();
  }
  return value as unknown as AssetImportReceipt;
}

function parseUndoReceipt(value: unknown): AssetImportUndoReceipt {
  if (!isRecord(value)
    || !hasExactKeys(value, ['journalVersion', 'operationId', 'projectIdentity', 'quarantinePaths', 'removedPaths', 'schemaVersion', 'status', 'undoReceiptId', 'undoReceiptSha256', 'undoneAt'])
    || value.schemaVersion !== 1
    || value.status !== 'UNDONE'
    || !isUuid(value.undoReceiptId)
    || !isSha256(value.undoReceiptSha256)
    || !isUuid(value.operationId)
    || !isSha256(value.projectIdentity)
    || !Number.isSafeInteger(value.journalVersion)
    || !Array.isArray(value.removedPaths)
    || !Array.isArray(value.quarantinePaths)
    || !value.removedPaths.every((entry) => isSafeText(entry))
    || !value.quarantinePaths.every((entry) => isSafeText(entry))
    || !isTimestamp(value.undoneAt)) throw invalidResponse();
  return value as unknown as AssetImportUndoReceipt;
}

function parseOperationDetail(value: unknown): AssetImportOperationDetail {
  if (!isRecord(value)
    || !hasExactKeys(value, ['allowedActions', 'operation', 'plan', 'receipt', 'undoReceipt'])
    || !Array.isArray(value.allowedActions)
    || !value.allowedActions.every((entry) => typeof entry === 'string' && ALLOWED_ACTIONS.has(entry))) throw invalidResponse();
  return {
    operation: parseOperationSummary(value.operation),
    plan: value.plan === null ? null : parsePlan(value.plan),
    receipt: value.receipt === null ? null : parseReceipt(value.receipt),
    undoReceipt: value.undoReceipt === null ? null : parseUndoReceipt(value.undoReceipt),
    allowedActions: [...value.allowedActions] as string[],
  };
}

function parseScenePlanResult(value: unknown): SceneLifecyclePlanResult {
  if (!isRecord(value)
    || !hasExactKeys(value, ['kind', 'operationId', 'planFingerprint', 'sourcePath', 'status', 'targetPath'])
    || !isUuid(value.operationId)
    || (value.kind !== 'rename' && value.kind !== 'delete')
    || !isSafeText(value.sourcePath, 1_024)
    || (value.targetPath !== null && !isSafeText(value.targetPath, 1_024))
    || !isSha256(value.planFingerprint)
    || !['PLANNED', 'COMMITTED', 'CANCELLED'].includes(String(value.status))) throw invalidResponse();
  if ((value.kind === 'rename') !== (typeof value.targetPath === 'string')) throw invalidResponse();
  return value as unknown as SceneLifecyclePlanResult;
}

function parseSceneCommitResult(value: unknown): SceneLifecycleCommitResult {
  if (!isRecord(value)
    || !hasExactKeys(value, ['deletedPaths', 'requestId', 'status', 'writes'])
    || !isUuid(value.requestId)
    || value.status !== 'COMMITTED'
    || !Array.isArray(value.writes)
    || !Array.isArray(value.deletedPaths)
    || !value.deletedPaths.every((entry) => isSafeText(entry, 1_024))) throw invalidResponse();
  const writes = value.writes.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ['path', 'sha256'])
      || !isSafeText(entry.path, 1_024) || !isSha256(entry.sha256)) throw invalidResponse();
    return { path: entry.path, sha256: entry.sha256 };
  });
  return {
    requestId: value.requestId,
    status: 'COMMITTED',
    writes,
    deletedPaths: [...value.deletedPaths] as string[],
  };
}

const WORKSPACE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  PREVIEW_OBSERVATION_UNAVAILABLE: '当前预览连接不可用，请从绑定项目重新播放。',
  PREVIEW_OBSERVATION_STALE: '预览或内容版本已变化，本次观察未继续发布。',
  PREVIEW_CONTENT_BASE_CHANGED: '来源项目已改变，不再匹配这份隔离内容的基线。请核对来源与候选；没有替换内容或写回项目。',
  PREVIEW_CONTENT_CHANGED: '这份工作变更已有新修改，请重新播放当前版本。',
  PREVIEW_CONTENT_INVALID: '所选版本的剧情或配置无法编译。请修正该变更后重新播放；保留的旧画面不代表新版本。',
  CAPSULE_IDENTITY_MISMATCH: '封存候选的身份或文件指纹不匹配，不能继续使用这份候选。',
  CANDIDATE_NOT_COMPOSABLE: '这份候选没有可验证的重放记录，请返回工作变更重新封装。',
  COMPOSITION_REPLAY_FAILED: '封存内容按原操作重放失败。请查看候选与依赖，不会退回来源旧内容。',
  COMPOSITION_PLAN_INVALID: '组合计划记录无法核对，请保留原记录并检查对应计划。',
  CHANGE_NOT_FOUND: '绑定项目中找不到这份工作变更，请刷新试玩列表。',
  CHANGE_NOT_OPEN: '这份工作变更已经关闭，不能继续编辑或当作当前工作版本。',
  PREVIEW_OBSERVATION_CORRUPT: '预览记录无法核对，原记录已保留。',
  PREVIEW_OBSERVATION_LIMIT: '本次预览记录已达上限，请从较近的段落标记重新播放。',
  EDITOR_PROJECT_BASELINE_CHANGED: '项目已被外部更新，未覆盖你的草稿。请先查看变化范围。',
  HUMAN_WORKSPACE_DIRTY: '另一个编辑窗口有未保存内容，请先完成接力。',
  HUMAN_WORKSPACE_BUSY: '另一个编辑窗口正在操作，请稍后保存。',
  HUMAN_WORKSPACE_STATE_CORRUPT: '工作区连接或保存状态已失效，编辑内容已保留。',
  PROJECT_BUSY: '项目正在写入，请稍后保存。',
  AUTHORITY_TOKEN_REJECTED: '项目绑定已失效，编辑内容已保留。',
};

function parseWorkspaceBaseline(value: unknown): ProjectDiskBaseline {
  if (!isRecord(value) || !hasExactKeys(value, ['projectRevision', 'coordinationRevision', 'files'])
    || !isSha256(value.projectRevision) || !isSha256(value.coordinationRevision) || !Array.isArray(value.files)) throw invalidResponse();
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file) || !hasExactKeys(file, ['path', 'sha256']) || !isProjectRelativePath(file.path)
      || !isSha256(file.sha256) || paths.has(file.path)) throw invalidResponse();
    paths.add(file.path);
  }
  return value as unknown as ProjectDiskBaseline;
}

function parseErrorEnvelope(value: unknown, operationKind: OperationKind = 'import'): AssetImportClientError {
  if (!isRecord(value)
    || value.ok !== false
    || !hasExactKeys(value, ['error', 'ok'])
    || !isRecord(value.error)) return invalidResponse();
  const error = value.error;
  if (!(['code', 'messageKey', 'retryDisposition'].every((key) => key in error))
    || Object.keys(error).some((key) => !['code', 'details', 'messageKey', 'retryDisposition'].includes(key))
    || !isSafeText(error.code, 96)
    || !isSafeText(error.messageKey, 160)
    || typeof error.retryDisposition !== 'string'
    || !RETRY_DISPOSITIONS.has(error.retryDisposition as AssetImportRetryDisposition)) return invalidResponse();
  const code = error.code;
  let details: { operationId?: string; itemId?: string; field?: string } | undefined;
  if (error.details !== undefined) {
    if (!isRecord(error.details)
      || Object.keys(error.details).some((key) => !['field', 'itemId', 'operationId'].includes(key))
      || (error.details.operationId !== undefined && !isUuid(error.details.operationId))
      || (error.details.itemId !== undefined && !isUuid(error.details.itemId))
      || (error.details.field !== undefined && !isSafeText(error.details.field, 64))) return invalidResponse();
    details = error.details as { operationId?: string; itemId?: string; field?: string };
  }
  const messages = operationKind === 'workspace' ? WORKSPACE_ERROR_MESSAGES : operationKind === 'relocation' ? RELOCATION_ERROR_MESSAGES
    : operationKind === 'scene' ? SCENE_ERROR_MESSAGES
      : ERROR_MESSAGES;
  return new AssetImportClientError(
    code,
    messages[code] ?? (operationKind === 'workspace' ? '工作区暂时不可用，编辑内容已保留。' : operationKind === 'relocation' ? '素材整理未完成，请查看技术详情。'
      : operationKind === 'scene' ? '场景保存未完成，请查看技术详情。'
        : '素材导入未完成，请查看技术详情。'),
    error.retryDisposition as AssetImportRetryDisposition,
    details,
  );
}

function parseSuccessEnvelope(value: unknown): unknown {
  if (!isRecord(value) || value.ok !== true || !hasExactKeys(value, ['data', 'ok'])) throw invalidResponse();
  return value.data;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { throw invalidResponse(); }
}

function readInjectedConfiguration(): AssetImportAuthorityBrowserConfig | null {
  try { return normalizeConfiguration(globalThis.__SURDET_ASSET_IMPORT_AUTHORITY__); } catch { return null; }
}

function requireOperationId(value: string): void {
  if (!UUID.test(value)) throw new AssetImportClientError('INVALID_REQUEST', ERROR_MESSAGES.INVALID_REQUEST!, 'never');
}

function requireFingerprint(value: string): void {
  if (!SHA256.test(value)) throw new AssetImportClientError('INVALID_REQUEST', ERROR_MESSAGES.INVALID_REQUEST!, 'never');
}

function requireRelocationPlanInput(value: unknown): AssetRelocationPlanInput {
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'moves')) {
    if (!hasExactKeys(value, ['moves', 'operationId']) || !isUuid(value.operationId)) {
      throw new AssetImportClientError('INVALID_REQUEST', RELOCATION_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
    }
    const moves = parseRelocationMoveRequests(value.moves).map((move) => ({
      sourcePath: move.sourcePath.normalize('NFC'),
      targetPath: move.targetPath.normalize('NFC'),
    }));
    return { operationId: value.operationId, moves };
  }
  if (!isRecord(value)
    || !hasExactKeys(value, ['fileName', 'operationId', 'sourcePath', 'targetDirectory'])
    || !isUuid(value.operationId)
    || !isProjectRelativePath(value.sourcePath)
    || !isProjectRelativePath(value.targetDirectory)
    || !isRelocationFileName(value.fileName)) {
    throw new AssetImportClientError('INVALID_REQUEST', RELOCATION_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
  }
  return {
    operationId: value.operationId,
    sourcePath: value.sourcePath.normalize('NFC'),
    targetDirectory: value.targetDirectory.normalize('NFC'),
    fileName: value.fileName.normalize('NFC'),
  };
}

function requireRelocationOperationId(value: string): void {
  if (!isUuid(value)) {
    throw new AssetImportClientError('INVALID_REQUEST', RELOCATION_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
  }
}

function requireRelocationFingerprint(value: string): void {
  if (!isSha256(value)) {
    throw new AssetImportClientError('INVALID_REQUEST', RELOCATION_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
  }
}

function requireRelocationDetailOperation(detail: AssetRelocationDetail, operationId: string): AssetRelocationDetail {
  if (detail.request.operationId !== operationId || detail.operation.operationId !== operationId
    || detail.plan.operationId !== operationId) throw invalidResponse();
  return detail;
}

function operationTokenKey(operationKind: OperationKind, operationId: string): string {
  return `${operationKind}:${operationId}`;
}

export function createAssetImportAuthorityClient(
  options: AssetImportAuthorityClientOptions = {},
): AssetImportAuthorityClient {
  const configuration = normalizeConfiguration(
    options.configuration === undefined ? readInjectedConfiguration() : options.configuration,
  );
  const fetcher = options.fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const createUuid = options.createUuid ?? (() => globalThis.crypto.randomUUID());
  const browserSessionId = `browser-${createUuid()}`;
  let disposed = false;
  let bindingToken: string | null = null;
  const operationTokens = new Map<string, string>();

  const clearAuthorization = (): void => {
    bindingToken = null;
    operationTokens.clear();
  };

  const requireConfiguration = (): AssetImportAuthorityBrowserConfig => {
    if (disposed || configuration === null || fetcher === null) throw unavailable();
    return configuration;
  };

  const headersFor = (operationId?: string, operationKind: OperationKind = 'import'): Record<string, string> => {
    const config = requireConfiguration();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [AUTHORITY_HEADER]: config.token,
    };
    if (bindingToken !== null) headers[BINDING_HEADER] = bindingToken;
    if (operationId !== undefined) {
      const token = operationTokens.get(operationTokenKey(operationKind, operationId));
      if (token === undefined) {
        const messages = operationKind === 'relocation' ? RELOCATION_ERROR_MESSAGES : ERROR_MESSAGES;
        throw new AssetImportClientError(
          'IMPORT_OPERATION_NOT_AUTHORIZED',
          messages.IMPORT_OPERATION_NOT_AUTHORIZED!,
          'after-refresh',
        );
      }
      headers[OPERATION_HEADER] = token;
    }
    return headers;
  };

  const request = async <T>(
    suffix: string,
    body: unknown,
    parser: (value: unknown) => T,
    auth: { binding?: boolean; operationId?: string; operationKind?: OperationKind } = {},
  ): Promise<T> => {
    const config = requireConfiguration();
    if (auth.binding === true && bindingToken === null) {
      throw new AssetImportClientError('AUTHORITY_TOKEN_REJECTED', ERROR_MESSAGES.AUTHORITY_TOKEN_REJECTED!, 'after-refresh');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher!(`${config.endpoint}${suffix}`, {
        method: 'POST',
        headers: headersFor(auth.operationId, auth.operationKind),
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const envelope = parseJson(await response.text());
      if (!response.ok) {
        const error = parseErrorEnvelope(envelope, auth.operationKind);
        if (error.code === 'AUTHORITY_TOKEN_REJECTED' || error.code === 'PROJECT_IDENTITY_MISMATCH') clearAuthorization();
        throw error;
      }
      return parser(parseSuccessEnvelope(envelope));
    } catch (error) {
      if (error instanceof AssetImportClientError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  };

  const status = (): Promise<AssetImportAuthorityStatus> => request('/status', { browserSessionId }, (value) => {
    if (!isRecord(value)
      || !hasExactKeys(value, ['authorityAvailable', 'authorityContractVersion', 'bindingRequired', 'projectIdentity'])
      || value.authorityContractVersion !== 1
      || value.authorityAvailable !== true
      || value.bindingRequired !== true
      || !isSha256(value.projectIdentity)) throw invalidResponse();
    return value as unknown as AssetImportAuthorityStatus;
  });

  const bindProject = async (handle: FileSystemDirectoryHandle): Promise<AssetImportBindingSnapshot> => {
    clearAuthorization();
    const authorityStatus = await status();
    const challenge = await request('/binding/challenges', { browserSessionId }, (value) => {
      if (!isRecord(value)
        || !hasExactKeys(value, ['challengeId', 'expiresAt', 'relativeProbePath'])
        || !isUuid(value.challengeId)
        || value.relativeProbePath !== `.surdet-bind-${value.challengeId}.json`
        || !isTimestamp(value.expiresAt)) throw invalidResponse();
      return value as unknown as { challengeId: string; relativeProbePath: string; expiresAt: string };
    });
    let probe: unknown;
    try {
      const probeHandle = await handle.getFileHandle(challenge.relativeProbePath);
      const probeFile = await probeHandle.getFile();
      if (probeFile.size < 1 || probeFile.size > 4_096) throw new Error('challenge size invalid');
      probe = parseJson(await probeFile.text());
    } catch {
      throw new AssetImportClientError('PROJECT_IDENTITY_MISMATCH', ERROR_MESSAGES.PROJECT_IDENTITY_MISMATCH!, 'after-human-action');
    }
    if (!isRecord(probe)
      || !hasExactKeys(probe, ['authority', 'challengeId', 'expiresAt', 'nonce', 'schemaVersion'])
      || probe.schemaVersion !== 1
      || probe.authority !== 'surdet-asset-import'
      || probe.challengeId !== challenge.challengeId
      || probe.expiresAt !== challenge.expiresAt
      || !isSafeText(probe.nonce, 256)) {
      throw new AssetImportClientError('PROJECT_IDENTITY_MISMATCH', ERROR_MESSAGES.PROJECT_IDENTITY_MISMATCH!, 'after-human-action');
    }
    const confirmed = await request(
      `/binding/challenges/${challenge.challengeId}/confirm`,
      { browserSessionId, nonce: probe.nonce },
      (value) => {
        if (!isRecord(value)
          || !hasExactKeys(value, [
            'bindingExpiresAt', 'bindingToken', 'pendingOperations', 'pendingRelocations',
            'projectIdentity', 'projectName', 'recentReceipts', 'recentRelocationReceipts', 'recoveryBarrier',
          ])
          || !isSha256(value.projectIdentity)
          || !isSafeText(value.projectName)
          || !isSecretToken(value.bindingToken)
          || !isTimestamp(value.bindingExpiresAt)
          || !['clear', 'recoverable', 'manual-recovery'].includes(String(value.recoveryBarrier))) throw invalidResponse();
        const discovery = parseDiscovery({ pendingOperations: value.pendingOperations, recentReceipts: value.recentReceipts });
        const relocationDiscovery = parseRelocationDiscovery({
          operations: value.pendingRelocations,
          recentReceipts: value.recentRelocationReceipts,
        });
        return {
          bindingToken: value.bindingToken as string,
          snapshot: {
            projectIdentity: value.projectIdentity as string,
            projectName: value.projectName as string,
            bindingExpiresAt: value.bindingExpiresAt as string,
            recoveryBarrier: value.recoveryBarrier as AssetImportBindingSnapshot['recoveryBarrier'],
            ...discovery,
            pendingRelocations: relocationDiscovery.operations,
            recentRelocationReceipts: relocationDiscovery.recentReceipts,
          },
        };
      },
    );
    if (confirmed.snapshot.projectIdentity !== authorityStatus.projectIdentity) {
      clearAuthorization();
      throw new AssetImportClientError('PROJECT_IDENTITY_MISMATCH', ERROR_MESSAGES.PROJECT_IDENTITY_MISMATCH!, 'after-human-action');
    }
    bindingToken = confirmed.bindingToken;
    return confirmed.snapshot;
  };

  const listOperations = (): Promise<AssetImportOperationDiscovery> => request(
    '/operations/query', {}, parseDiscovery, { binding: true },
  );

  const queryOperation = (operationId: string): Promise<AssetImportOperationDetail> => {
    requireOperationId(operationId);
    return request(`/operations/${operationId}/query`, {}, parseOperationDetail, { binding: true });
  };

  const createOperation = async (input: AssetImportCreateInput): Promise<AssetImportCreateResult> => {
    requireOperationId(input.operationId);
    const created = await request('/operations', input, (value) => {
      if (!isRecord(value)
        || !hasExactKeys(value, ['expiresAt', 'operationId', 'operationToken', 'status'])
        || !isUuid(value.operationId)
        || value.status !== 'UPLOADING'
        || !isSecretToken(value.operationToken)
        || !isTimestamp(value.expiresAt)) throw invalidResponse();
      return value as unknown as AssetImportCreateResult & { operationToken: string };
    }, { binding: true });
    operationTokens.set(operationTokenKey('import', created.operationId), created.operationToken);
    return { operationId: created.operationId, status: created.status, expiresAt: created.expiresAt };
  };

  const uploadItem = (
    operationId: string,
    itemId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<ProjectAssetImportStagedItem> => {
    requireOperationId(operationId);
    requireOperationId(itemId);
    const config = requireConfiguration();
    if (bindingToken === null) throw new AssetImportClientError('AUTHORITY_TOKEN_REJECTED', ERROR_MESSAGES.AUTHORITY_TOKEN_REJECTED!, 'after-refresh');
    const operationToken = operationTokens.get(operationTokenKey('import', operationId));
    if (operationToken === undefined) {
      throw new AssetImportClientError('IMPORT_OPERATION_NOT_AUTHORIZED', ERROR_MESSAGES.IMPORT_OPERATION_NOT_AUTHORIZED!, 'after-refresh');
    }
    return new Promise((resolve, reject) => {
      const xhr = xhrFactory();
      let lastProgressLoaded = -1;
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const clearIdleTimer = (): void => {
        if (idleTimer !== null) clearTimeout(idleTimer);
        idleTimer = null;
      };
      const fail = (error: AssetImportClientError): void => {
        if (settled) return;
        settled = true;
        clearIdleTimer();
        reject(error);
      };
      const armIdleTimer = (): void => {
        clearIdleTimer();
        idleTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          xhr.abort();
          reject(new AssetImportClientError(
            'IMPORT_UPLOAD_TIMEOUT',
            ERROR_MESSAGES.IMPORT_UPLOAD_TIMEOUT!,
            'same-request',
          ));
        }, UPLOAD_IDLE_TIMEOUT_MS);
      };
      xhr.open('PUT', `${config.endpoint}/operations/${operationId}/items/${itemId}`, true);
      xhr.timeout = 0;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader(AUTHORITY_HEADER, config.token);
      xhr.setRequestHeader(BINDING_HEADER, bindingToken!);
      xhr.setRequestHeader(OPERATION_HEADER, operationToken);
      xhr.upload.onprogress = (event) => {
        const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
        const loaded = Math.max(lastProgressLoaded, Math.min(event.loaded, total));
        lastProgressLoaded = loaded;
        onProgress?.(loaded, total);
        armIdleTimer();
      };
      const failTransport = (): void => fail(unavailable());
      xhr.onerror = failTransport;
      xhr.ontimeout = failTransport;
      xhr.onabort = failTransport;
      xhr.onload = () => {
        if (settled) return;
        settled = true;
        clearIdleTimer();
        try {
          const envelope = parseJson(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) {
            const error = parseErrorEnvelope(envelope, 'import');
            if (error.code === 'AUTHORITY_TOKEN_REJECTED' || error.code === 'PROJECT_IDENTITY_MISMATCH') clearAuthorization();
            reject(xhr.status === 408
              ? new AssetImportClientError('IMPORT_UPLOAD_TIMEOUT', ERROR_MESSAGES.IMPORT_UPLOAD_TIMEOUT!, 'same-request')
              : error);
            return;
          }
          const value = parseSuccessEnvelope(envelope);
          if (!isRecord(value)
            || !hasExactKeys(value, ['bytes', 'itemId', 'operationId', 'sha256', 'stagedItemFingerprint'])
            || value.operationId !== operationId
            || value.itemId !== itemId
            || !Number.isSafeInteger(value.bytes)
            || !isSha256(value.sha256)
            || !isSha256(value.stagedItemFingerprint)) throw invalidResponse();
          if (lastProgressLoaded !== file.size) onProgress?.(file.size, file.size);
          resolve({
            operationId,
            itemId,
            sourceName: file.name,
            bytes: value.bytes as number,
            sha256: value.sha256,
            stagedItemFingerprint: value.stagedItemFingerprint,
          });
        } catch (error) {
          reject(error instanceof AssetImportClientError ? error : invalidResponse());
        }
      };
      armIdleTimer();
      xhr.send(file);
    });
  };

  const plan = (operationId: string, input: { targets: ProjectAssetImportTargetRequest[] }) => {
    requireOperationId(operationId);
    return request(`/operations/${operationId}/plan`, input, (value) => {
      if (!isRecord(value)
        || !hasExactKeys(value, ['operationId', 'plan', 'status'])
        || value.operationId !== operationId
        || (value.status !== 'STAGED' && value.status !== 'READY')) throw invalidResponse();
      return { operationId, status: value.status as 'STAGED' | 'READY', plan: parsePlan(value.plan) };
    }, { binding: true, operationId });
  };

  const seal = (operationId: string, input: { planFingerprint: string }): Promise<AssetImportSealResult> => {
    requireOperationId(operationId);
    requireFingerprint(input.planFingerprint);
    return request(`/operations/${operationId}/seal`, input, (value) => {
      if (!isRecord(value)
        || !hasExactKeys(value, ['operationId', 'planFingerprint', 'planId', 'status'])
        || value.operationId !== operationId
        || value.status !== 'READY'
        || !isSafeText(value.planId)
        || !isSha256(value.planFingerprint)) throw invalidResponse();
      return value as unknown as AssetImportSealResult;
    }, { binding: true, operationId });
  };

  const commit = async (operationId: string, planFingerprint: string): Promise<AssetImportCommitResult> => {
    requireOperationId(operationId);
    requireFingerprint(planFingerprint);
    try {
      const committed = await request(`/operations/${operationId}/commit`, { planFingerprint }, (value) => {
        if (!isRecord(value) || !hasExactKeys(value, ['operation', 'receipt'])) throw invalidResponse();
        return { operation: parseOperationSummary(value.operation), receipt: parseReceipt(value.receipt) };
      }, { binding: true, operationId });
      operationTokens.delete(operationTokenKey('import', operationId));
      const persisted = await queryOperation(operationId);
      if (persisted.operation.status !== 'COMMITTED' || persisted.receipt === null
        || persisted.receipt.receiptSha256 !== committed.receipt.receiptSha256) throw invalidResponse();
      return { operation: persisted.operation, receipt: persisted.receipt };
    } catch (error) {
      if (error instanceof AssetImportClientError && error.code === 'AUTHORITY_UNAVAILABLE' && bindingToken !== null) {
        const persisted = await queryOperation(operationId);
        if (persisted.operation.status === 'COMMITTED' && persisted.receipt !== null) {
          operationTokens.delete(operationTokenKey('import', operationId));
          return { operation: persisted.operation, receipt: persisted.receipt };
        }
      }
      throw error;
    }
  };

  const cancel = async (operationId: string): Promise<AssetImportOperationSummary> => {
    requireOperationId(operationId);
    const result = await request(`/operations/${operationId}/cancel`, {}, (value) => {
      if (!isRecord(value) || !hasExactKeys(value, ['operation'])) throw invalidResponse();
      return parseOperationSummary(value.operation);
    }, { binding: true, operationId });
    operationTokens.delete(operationTokenKey('import', operationId));
    return result;
  };

  const resume = async (operationId: string): Promise<AssetImportOperationDetail> => {
    requireOperationId(operationId);
    const result = await request(`/operations/${operationId}/resume`, {}, (value) => {
      if (!isRecord(value)
        || !hasExactKeys(value, ['detail', 'expiresAt', 'operationToken'])
        || !isSecretToken(value.operationToken)
        || !isTimestamp(value.expiresAt)) throw invalidResponse();
      return { token: value.operationToken as string, detail: parseOperationDetail(value.detail) };
    }, { binding: true });
    operationTokens.set(operationTokenKey('import', operationId), result.token);
    return result.detail;
  };

  const recover = async (operationId: string, input: { action: 'resume' | 'rollback' }): Promise<AssetImportOperationDetail> => {
    requireOperationId(operationId);
    const result = await request(`/operations/${operationId}/recover`, input, (value) => {
      if (!isRecord(value) || !hasExactKeys(value, ['detail'])) throw invalidResponse();
      return parseOperationDetail(value.detail);
    }, { binding: true, operationId });
    if (['COMMITTED', 'ROLLED_BACK', 'UNDONE'].includes(result.operation.status)) {
      operationTokens.delete(operationTokenKey('import', operationId));
    }
    return result;
  };

  const undo = async (operationId: string, input: { receiptId: string; receiptSha256: string }) => {
    requireOperationId(operationId);
    if (!isUuid(input.receiptId)) throw new AssetImportClientError('INVALID_REQUEST', ERROR_MESSAGES.INVALID_REQUEST!, 'never');
    requireFingerprint(input.receiptSha256);
    const result = await request(`/operations/${operationId}/undo`, input, (value) => {
      if (!isRecord(value) || !hasExactKeys(value, ['operation', 'undoReceipt'])) throw invalidResponse();
      return { operation: parseOperationSummary(value.operation), undoReceipt: parseUndoReceipt(value.undoReceipt) };
    }, { binding: true, operationId });
    operationTokens.delete(operationTokenKey('import', operationId));
    return result;
  };

  const relocationPlan = async (input: AssetRelocationPlanInput): Promise<AssetRelocationTokenResult> => {
    const normalized = requireRelocationPlanInput(input);
    const result = await request(
      '/relocations/plan',
      normalized,
      parseRelocationTokenResult,
      { binding: true, operationKind: 'relocation' },
    );
    const detail = requireRelocationDetailOperation(result.detail, normalized.operationId);
    if ('moves' in normalized && normalized.moves !== undefined) {
      if (detail.request.moves.length !== normalized.moves.length
        || detail.request.moves.some((move, index) => move.sourcePath !== normalized.moves[index]?.sourcePath
          || move.targetPath !== normalized.moves[index]?.targetPath)) throw invalidResponse();
    } else if (detail.request.sourcePath !== normalized.sourcePath
      || detail.request.targetPath !== `${normalized.targetDirectory}/${normalized.fileName}`) throw invalidResponse();
    operationTokens.set(operationTokenKey('relocation', normalized.operationId), result.operationToken);
    return { ...result, detail };
  };

  const relocationList = (): Promise<AssetRelocationDiscovery> => request(
    '/relocations/query', {}, parseRelocationDiscovery, { binding: true, operationKind: 'relocation' },
  );

  const relocationQuery = async (operationId: string): Promise<AssetRelocationDetail> => {
    requireRelocationOperationId(operationId);
    const detail = await request(
      `/relocations/${operationId}/query`,
      {},
      parseRelocationDetail,
      { binding: true, operationKind: 'relocation' },
    );
    return requireRelocationDetailOperation(detail, operationId);
  };

  const relocationResume = async (operationId: string): Promise<AssetRelocationTokenResult> => {
    requireRelocationOperationId(operationId);
    const result = await request(
      `/relocations/${operationId}/resume`,
      {},
      parseRelocationTokenResult,
      { binding: true, operationKind: 'relocation' },
    );
    const detail = requireRelocationDetailOperation(result.detail, operationId);
    operationTokens.set(operationTokenKey('relocation', operationId), result.operationToken);
    return { ...result, detail };
  };

  const relocationCommit = async (operationId: string, planFingerprint: string): Promise<AssetRelocationDetail> => {
    requireRelocationOperationId(operationId);
    requireRelocationFingerprint(planFingerprint);
    const detail = await request(
      `/relocations/${operationId}/commit`,
      { planFingerprint },
      parseRelocationDetail,
      { binding: true, operationId, operationKind: 'relocation' },
    );
    operationTokens.delete(operationTokenKey('relocation', operationId));
    return requireRelocationDetailOperation(detail, operationId);
  };

  const relocationCancel = async (operationId: string): Promise<AssetRelocationDetail> => {
    requireRelocationOperationId(operationId);
    const detail = await request(
      `/relocations/${operationId}/cancel`,
      {},
      parseRelocationDetail,
      { binding: true, operationId, operationKind: 'relocation' },
    );
    operationTokens.delete(operationTokenKey('relocation', operationId));
    return requireRelocationDetailOperation(detail, operationId);
  };

  const relocationRecover = async (
    operationId: string,
    input: { action: 'resume' | 'rollback' },
  ): Promise<AssetRelocationDetail> => {
    requireRelocationOperationId(operationId);
    if (!isRecord(input) || !hasExactKeys(input, ['action'])
      || (input.action !== 'resume' && input.action !== 'rollback')) {
      throw new AssetImportClientError('INVALID_REQUEST', RELOCATION_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
    }
    const detail = await request(
      `/relocations/${operationId}/recover`,
      { action: input.action },
      parseRelocationDetail,
      { binding: true, operationId, operationKind: 'relocation' },
    );
    const checked = requireRelocationDetailOperation(detail, operationId);
    if (['COMMITTED', 'ROLLED_BACK', 'UNDONE', 'CANCELLED'].includes(checked.operation.status)) {
      operationTokens.delete(operationTokenKey('relocation', operationId));
    }
    return checked;
  };

  const relocationUndo = async (
    operationId: string,
    input: { receiptId: string; receiptFingerprint: string },
  ): Promise<AssetRelocationDetail> => {
    requireRelocationOperationId(operationId);
    if (!isRecord(input)
      || !hasExactKeys(input, ['receiptFingerprint', 'receiptId'])
      || !isUuid(input.receiptId)
      || !isSha256(input.receiptFingerprint)) {
      throw new AssetImportClientError('INVALID_REQUEST', RELOCATION_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
    }
    const detail = await request(
      `/relocations/${operationId}/undo`,
      { receiptId: input.receiptId, receiptFingerprint: input.receiptFingerprint },
      parseRelocationDetail,
      { binding: true, operationId, operationKind: 'relocation' },
    );
    operationTokens.delete(operationTokenKey('relocation', operationId));
    return requireRelocationDetailOperation(detail, operationId);
  };

  const scenePlan = async (input: SceneLifecyclePlanInput, workspaceWrite?: EditorWorkspaceWrite): Promise<SceneLifecyclePlanResult> => {
    if (!isRecord(input) || !isUuid(input.operationId)
      || (input.kind !== 'rename' && input.kind !== 'delete')
      || !isSafeText(input.sourcePath, 1_024)
      || (input.kind === 'rename' && !isSafeText(input.targetPath, 1_024))
      || (input.kind === 'delete' && input.targetPath !== undefined)) {
      throw new AssetImportClientError('INVALID_REQUEST', SCENE_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
    }
    const result = await request('/scenes/plan', {
      operationId: input.operationId,
      kind: input.kind,
      sourcePath: input.sourcePath,
      ...(input.kind === 'rename' ? { targetPath: input.targetPath } : {}),
      ...(workspaceWrite === undefined ? {} : { workspaceWrite: { ...workspaceWrite, browserSessionId } }),
    }, parseScenePlanResult, { binding: true, operationKind: 'scene' });
    const expectedTarget = input.kind === 'rename' ? input.targetPath : null;
    if (result.operationId !== input.operationId || result.kind !== input.kind
      || result.sourcePath !== input.sourcePath || result.targetPath !== expectedTarget
      || result.status !== 'PLANNED') throw invalidResponse();
    return result;
  };

  const sceneCommit = async (input: SceneLifecycleCommitInput, workspaceWrite?: EditorWorkspaceWrite): Promise<SceneLifecycleCommitResult> => {
    if (!isRecord(input) || !isUuid(input.requestId)
      || !Array.isArray(input.plans) || !Array.isArray(input.writes)) {
      throw new AssetImportClientError('INVALID_REQUEST', SCENE_ERROR_MESSAGES.INVALID_REQUEST!, 'never');
    }
    const result = await request('/scenes/commit', { ...input,
      ...(workspaceWrite === undefined ? {} : { workspaceWrite: { ...workspaceWrite, browserSessionId } }),
    }, parseSceneCommitResult, { binding: true, operationKind: 'scene' });
    if (result.requestId !== input.requestId) throw invalidResponse();
    return result;
  };

  const revokeBinding = async (): Promise<void> => {
    if (bindingToken === null) return;
    try {
      await request('/binding/revoke', { browserSessionId }, (value) => {
        if (!isRecord(value) || !hasExactKeys(value, ['revoked']) || value.revoked !== true) throw invalidResponse();
      }, { binding: true });
    } finally {
      clearAuthorization();
    }
  };

  const workspaceRequest = <T>(action: string, body: object, parser: (value: unknown) => T): Promise<T> =>
    request(`/workspace/${action}`, { ...body, browserSessionId }, parser, { binding: true, operationKind: 'workspace' });
  const workspace: EditorWorkspaceClient = {
    heartbeat: state => workspaceRequest('heartbeat', state, value => {
      if (!isRecord(value) || !Number.isSafeInteger(value.workspaceGeneration) || !isTimestamp(value.heartbeatAt)) throw invalidResponse();
    }),
    preview: state => workspaceRequest('preview', state, value => {
      const expectedId = state.preview.action === 'invalidate' ? null : state.preview.previewId;
      if (!isRecord(value) || !hasExactKeys(value, ['previewId', 'previewGeneration'])
        || value.previewId !== expectedId || value.previewGeneration !== state.preview.previewGeneration) throw invalidResponse();
      return { previewId: expectedId, previewGeneration: state.preview.previewGeneration };
    }),
    previewSources: state => workspaceRequest('preview-sources', state, value => {
      if (!isRecord(value) || !hasExactKeys(value, ['sources']) || !Array.isArray(value.sources)) throw invalidResponse();
      return value.sources.map(item => {
        if (!isRecord(item) || !hasExactKeys(item, ['target', 'title']) || typeof item.title !== 'string') throw invalidResponse();
        try { return { target: parsePreviewContentTarget(item.target), title: item.title }; }
        catch { throw invalidResponse(); }
      });
    }),
    previewContent: state => workspaceRequest('preview-content', state, value => {
      if (!isRecord(value) || !hasExactKeys(value, ['target', 'title', 'files', 'projectIdentity', 'projectRevision', 'contentRevision', 'coordinationRevision'])
        || typeof value.title !== 'string' || typeof value.projectIdentity !== 'string' || !/^[0-9a-f]{32}$/.test(value.projectIdentity)
        || !isSha256(value.projectRevision) || !isSha256(value.contentRevision) || !isSha256(value.coordinationRevision)
        || !isRecord(value.files) || !Object.entries(value.files).every(([file, text]) => isProjectRelativePath(file) && isPreviewSourcePath(file) && typeof text === 'string')) throw invalidResponse();
      let target: PreviewContentTarget;
      try { target = parsePreviewContentTarget(value.target); } catch { throw invalidResponse(); }
      const requested = state.target;
      if (target.kind === 'working-change' ? requested.kind !== target.kind || target.changeId !== requested.changeId
        || target.workingRevision === undefined || (requested.workingRevision !== undefined && requested.workingRevision !== target.workingRevision)
        : stableStringify(target) !== stableStringify(requested)) throw invalidResponse();
      return { target, title: value.title, files: value.files as Record<string, string>, projectIdentity: value.projectIdentity,
        projectRevision: value.projectRevision, contentRevision: value.contentRevision, coordinationRevision: value.coordinationRevision };
    }),
    snapshot: workspaceSessionId => workspaceRequest('snapshot', { workspaceSessionId }, value => {
      if (!isRecord(value) || typeof value.projectIdentity !== 'string' || !/^[0-9a-f]{32}$/.test(value.projectIdentity)) throw invalidResponse();
      const diskBaseline = parseWorkspaceBaseline(value.diskBaseline);
      const notice = value.mutationNotice;
      if (notice !== null && (!isRecord(notice) || !Number.isSafeInteger(notice.sequence)
        || !isSha256(notice.projectRevision) || !isSha256(notice.coordinationRevision)
        || !Array.isArray(notice.changedPaths) || !notice.changedPaths.every(path => isProjectRelativePath(path)))) throw invalidResponse();
      return { projectIdentity: value.projectIdentity, diskBaseline, mutationNotice: notice as ProjectMutationNotice | null };
    }),
    begin: state => workspaceRequest('begin', state, value => {
      if (!isRecord(value) || !isUuid(value.writeLeaseId) || !isTimestamp(value.expiresAt)) throw invalidResponse();
      return { writeLeaseId: value.writeLeaseId, expiresAt: value.expiresAt, diskBaseline: parseWorkspaceBaseline(value.diskBaseline) };
    }),
    publish: state => workspaceRequest('publish', state, value => {
      if (!isRecord(value) || (value.sha256 !== null && !isSha256(value.sha256))) throw invalidResponse();
      return { sha256: value.sha256 };
    }),
    renew: state => workspaceRequest('renew', state, value => {
      if (!isRecord(value) || !isTimestamp(value.expiresAt)) throw invalidResponse();
    }),
    finish: state => workspaceRequest('finish', state, value => {
      if (!isRecord(value) || !Array.isArray(value.changedPaths) || !value.changedPaths.every(path => isProjectRelativePath(path))
        || !isRecord(value.mutationNotice) || !['none', 'written', 'unavailable'].includes(String(value.mutationNotice.status))) throw invalidResponse();
      return { diskBaseline: parseWorkspaceBaseline(value.diskBaseline), changedPaths: value.changedPaths,
        mutationNotice: value.mutationNotice as EditorWorkspaceSettlement['mutationNotice'] };
    }),
    abort: state => workspaceRequest('abort', state, value => {
      if (!isRecord(value) || value.aborted !== true) throw invalidResponse();
    }),
    revoke: workspaceSessionId => workspaceRequest('revoke', { workspaceSessionId }, value => {
      if (!isRecord(value) || value.revoked !== true) throw invalidResponse();
    }),
  };

  return {
    workspace,
    status,
    bindProject,
    listOperations,
    queryOperation,
    createOperation,
    uploadItem,
    plan,
    seal,
    commit,
    cancel,
    resume,
    recover,
    undo,
    relocationPlan,
    relocationList,
    relocationQuery,
    relocationResume,
    relocationCommit,
    relocationCancel,
    relocationRecover,
    relocationUndo,
    scenePlan,
    sceneCommit,
    revokeBinding,
    dispose() { disposed = true; clearAuthorization(); },
  };
}
