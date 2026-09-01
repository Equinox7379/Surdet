import type {
  ProjectAssetImportPlan,
  ProjectAssetImportStagedItem,
  ProjectAssetImportTargetRequest,
} from '@surdet/authoring';

const AUTHORITY_HEADER = 'x-surdet-asset-import-authority';
const BINDING_HEADER = 'x-surdet-project-binding';
const OPERATION_HEADER = 'x-surdet-import-operation';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const UPLOAD_IDLE_TIMEOUT_MS = 35_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

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

export interface AssetImportBindingSnapshot extends AssetImportOperationDiscovery {
  projectIdentity: string;
  projectName: string;
  bindingExpiresAt: string;
  recoveryBarrier: 'clear' | 'recoverable' | 'manual-recovery';
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
  revokeBinding(): Promise<void>;
  dispose(): void;
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

const OPERATION_STATUSES = new Set<AssetImportOperationStatus>([
  'UPLOADING', 'STAGED', 'READY', 'PUBLISHING', 'ROLLING_BACK', 'ROLLED_BACK',
  'RECOVERY_REQUIRED', 'COMMITTED', 'UNDOING', 'UNDONE', 'CANCELLED',
]);
const ASSET_KINDS = new Set([
  'background', 'portrait', 'avatar', 'music', 'ambience',
  'sound-effect', 'voice', 'video', 'font', 'other',
]);
const PLAN_ISSUES = new Set([
  'IMPORT_NAME_INVALID', 'IMPORT_FORMAT_UNSUPPORTED', 'IMPORT_PORTRAIT_NAME_INVALID',
  'IMPORT_TARGET_DUPLICATE_IN_BATCH', 'IMPORT_TARGET_EXISTS', 'IMPORT_TARGET_UNSAFE',
]);
const ALLOWED_ACTIONS = new Set(['upload', 'plan', 'seal', 'commit', 'cancel', 'resume', 'recover', 'undo']);
const RETRY_DISPOSITIONS = new Set<AssetImportRetryDisposition>([
  'same-request', 'after-refresh', 'after-human-action', 'manual-recovery', 'never',
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

function parseErrorEnvelope(value: unknown): AssetImportClientError {
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
  return new AssetImportClientError(
    code,
    ERROR_MESSAGES[code] ?? '素材导入未完成，请查看技术详情。',
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

  const headersFor = (operationId?: string): Record<string, string> => {
    const config = requireConfiguration();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [AUTHORITY_HEADER]: config.token,
    };
    if (bindingToken !== null) headers[BINDING_HEADER] = bindingToken;
    if (operationId !== undefined) {
      const token = operationTokens.get(operationId);
      if (token === undefined) {
        throw new AssetImportClientError('IMPORT_OPERATION_NOT_AUTHORIZED', ERROR_MESSAGES.IMPORT_OPERATION_NOT_AUTHORIZED!, 'after-refresh');
      }
      headers[OPERATION_HEADER] = token;
    }
    return headers;
  };

  const request = async <T>(
    suffix: string,
    body: unknown,
    parser: (value: unknown) => T,
    auth: { binding?: boolean; operationId?: string } = {},
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
        headers: headersFor(auth.operationId),
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const envelope = parseJson(await response.text());
      if (!response.ok) {
        const error = parseErrorEnvelope(envelope);
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
          || !hasExactKeys(value, ['bindingExpiresAt', 'bindingToken', 'pendingOperations', 'projectIdentity', 'projectName', 'recentReceipts', 'recoveryBarrier'])
          || !isSha256(value.projectIdentity)
          || !isSafeText(value.projectName)
          || !isSecretToken(value.bindingToken)
          || !isTimestamp(value.bindingExpiresAt)
          || !['clear', 'recoverable', 'manual-recovery'].includes(String(value.recoveryBarrier))) throw invalidResponse();
        const discovery = parseDiscovery({ pendingOperations: value.pendingOperations, recentReceipts: value.recentReceipts });
        return {
          bindingToken: value.bindingToken as string,
          snapshot: {
            projectIdentity: value.projectIdentity as string,
            projectName: value.projectName as string,
            bindingExpiresAt: value.bindingExpiresAt as string,
            recoveryBarrier: value.recoveryBarrier as AssetImportBindingSnapshot['recoveryBarrier'],
            ...discovery,
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
    operationTokens.set(created.operationId, created.operationToken);
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
    const operationToken = operationTokens.get(operationId);
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
            const error = parseErrorEnvelope(envelope);
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
      operationTokens.delete(operationId);
      const persisted = await queryOperation(operationId);
      if (persisted.operation.status !== 'COMMITTED' || persisted.receipt === null
        || persisted.receipt.receiptSha256 !== committed.receipt.receiptSha256) throw invalidResponse();
      return { operation: persisted.operation, receipt: persisted.receipt };
    } catch (error) {
      if (error instanceof AssetImportClientError && error.code === 'AUTHORITY_UNAVAILABLE' && bindingToken !== null) {
        const persisted = await queryOperation(operationId);
        if (persisted.operation.status === 'COMMITTED' && persisted.receipt !== null) {
          operationTokens.delete(operationId);
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
    operationTokens.delete(operationId);
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
    operationTokens.set(operationId, result.token);
    return result.detail;
  };

  const recover = async (operationId: string, input: { action: 'resume' | 'rollback' }): Promise<AssetImportOperationDetail> => {
    requireOperationId(operationId);
    const result = await request(`/operations/${operationId}/recover`, input, (value) => {
      if (!isRecord(value) || !hasExactKeys(value, ['detail'])) throw invalidResponse();
      return parseOperationDetail(value.detail);
    }, { binding: true, operationId });
    if (['COMMITTED', 'ROLLED_BACK', 'UNDONE'].includes(result.operation.status)) operationTokens.delete(operationId);
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
    operationTokens.delete(operationId);
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

  return {
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
    revokeBinding,
    dispose() { disposed = true; clearAuthorization(); },
  };
}
