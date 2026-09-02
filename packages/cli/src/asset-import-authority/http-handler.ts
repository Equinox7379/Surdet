import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ProjectAssetImportStagedItem,
  ProjectAssetImportTargetRequest,
} from '@surdet/authoring';
import {
  AssetImportAuthorityError,
  type CommitOperationRequest,
  type CommitOperationResponse,
  type ConfirmBindingChallengeRequest,
  type ConfirmBindingChallengeResponse,
  type CreateBindingChallengeResponse,
  type CreateImportOperationRequest,
  type CreateImportOperationResponse,
  type ListOperationsResponse,
  type OperationDetailResponse,
  type PlanOperationRequest,
  type PlanOperationResponse,
  type RecoverOperationRequest,
  type RecoverOperationResponse,
  type SealOperationRequest,
  type SealOperationResponse,
  type UndoOperationRequest,
  type UndoOperationResponse,
  type AssetRelocationDetailResponse,
  type CommitAssetRelocationRequest,
  type ListAssetRelocationsResponse,
  type PlanAssetRelocationRequest,
  type RecoverAssetRelocationRequest,
  type SceneLifecycleCommitRequest,
  type SceneLifecycleCommitResponse,
  type SceneLifecyclePlanRequest,
  type SceneLifecyclePlanResponse,
  type UndoAssetRelocationRequest,
} from './types.js';

export const ASSET_IMPORT_AUTHORITY_BASE_PATH = '/__surdet/project-asset-import/v1' as const;
export const ASSET_IMPORT_AUTHORITY_TOKEN_HEADER = 'x-surdet-asset-import-authority' as const;
export const ASSET_IMPORT_AUTHORITY_BINDING_HEADER = 'x-surdet-project-binding' as const;
export const ASSET_IMPORT_AUTHORITY_OPERATION_HEADER = 'x-surdet-import-operation' as const;
export const ASSET_IMPORT_AUTHORITY_MAX_JSON_BYTES = 1024 * 1024;

const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_SEGMENT}$`);
const SHA256 = /^[0-9a-f]{64}$/;
const KINDS = new Set([
  'background', 'portrait', 'avatar', 'music', 'ambience',
  'sound-effect', 'voice', 'video', 'font', 'other',
]);
const PUBLIC_CODES = new Set([
  'INVALID_REQUEST',
  'AUTHORITY_ORIGIN_REJECTED',
  'AUTHORITY_TOKEN_REJECTED',
  'AUTHORITY_UNAVAILABLE',
  'PROJECT_ROOT_IDENTITY_UNAVAILABLE',
  'PROJECT_IDENTITY_MISMATCH',
  'PROJECT_BUSY',
  'IMPORT_FILESYSTEM_UNSUPPORTED',
  'IMPORT_OPERATION_NOT_FOUND',
  'IMPORT_OPERATION_CONFLICT',
  'IMPORT_PLAN_BLOCKED',
  'IMPORT_PLAN_STALE',
  'IMPORT_TARGET_EXISTS',
  'IMPORT_TARGET_UNSAFE',
  'IMPORT_UPLOAD_MISMATCH',
  'IMPORT_LIMIT_EXCEEDED',
  'IMPORT_RECOVERY_REQUIRED',
  'IMPORT_UNDO_BLOCKED_CHANGED',
]);

type EmptyObject = Record<string, never>;
type OperationSummary = {
  operationId: string;
  status: OperationDetailResponse['operation']['status'];
  itemCount: number;
  updatedAt: string;
  manualRecoveryRequired: boolean;
};
type ReceiptSummary = {
  operationId: string;
  receiptId: string;
  status: 'COMMITTED' | 'UNDONE';
  fileCount: number;
  committedAt: string;
};

export interface AssetImportAuthorityHttpTarget {
  projectIdentity: string;
  createChallenge(browserSessionId: string): Promise<CreateBindingChallengeResponse>;
  confirmChallenge(challengeId: string, request: ConfirmBindingChallengeRequest): Promise<ConfirmBindingChallengeResponse>;
  validateBinding(token: string, browserSessionId?: string): boolean | Promise<boolean>;
  revoke(browserSessionId: string): void;
  createOperation(request: CreateImportOperationRequest): Promise<CreateImportOperationResponse>;
  expectedUploadBytes(operationId: string, itemId: string): Promise<number>;
  uploadItem(operationId: string, itemId: string, body: NodeJS.ReadableStream): Promise<ProjectAssetImportStagedItem>;
  plan(operationId: string, request: PlanOperationRequest): Promise<PlanOperationResponse>;
  seal(operationId: string, request: SealOperationRequest): Promise<SealOperationResponse>;
  commit(operationId: string, request: CommitOperationRequest): Promise<CommitOperationResponse>;
  cancel(operationId: string): Promise<OperationDetailResponse>;
  list(): Promise<ListOperationsResponse>;
  query(operationId: string): Promise<OperationDetailResponse>;
  issueOperationToken(operationId: string): Promise<string>;
  recover(operationId: string, request: RecoverOperationRequest): Promise<RecoverOperationResponse>;
  undo(operationId: string, request: UndoOperationRequest): Promise<UndoOperationResponse>;
  verifyOperationToken(operationId: string, operationToken: string): void;
  relocationPlan?(request: PlanAssetRelocationRequest): Promise<AssetRelocationDetailResponse>;
  relocationList?(): Promise<ListAssetRelocationsResponse>;
  relocationQuery?(operationId: string): Promise<AssetRelocationDetailResponse>;
  relocationCommit?(operationId: string, request: CommitAssetRelocationRequest): Promise<AssetRelocationDetailResponse>;
  relocationCancel?(operationId: string): Promise<AssetRelocationDetailResponse>;
  relocationRecover?(operationId: string, request: RecoverAssetRelocationRequest): Promise<AssetRelocationDetailResponse>;
  relocationUndo?(operationId: string, request: UndoAssetRelocationRequest): Promise<AssetRelocationDetailResponse>;
  scenePlan?(request: SceneLifecyclePlanRequest): Promise<SceneLifecyclePlanResponse>;
  sceneCommit?(request: SceneLifecycleCommitRequest): Promise<SceneLifecycleCommitResponse>;
}

export interface AssetImportAuthorityHttpHandlerOptions {
  authority: AssetImportAuthorityHttpTarget;
  token: string;
  expectedOrigin(request: IncomingMessage): string | undefined;
  maxJsonBytes?: number;
  jsonTimeoutMs?: number;
  now?: () => number;
}

type Route = {
  kind: 'status' | 'challenge-create' | 'challenge-confirm' | 'binding-revoke'
    | 'operation-create' | 'operation-list' | 'upload' | 'plan' | 'seal'
    | 'commit' | 'cancel' | 'operation-query' | 'resume' | 'recover' | 'undo'
    | 'relocation-plan' | 'relocation-list' | 'relocation-query' | 'relocation-resume'
    | 'relocation-commit' | 'relocation-cancel' | 'relocation-recover' | 'relocation-undo'
    | 'scene-plan' | 'scene-commit';
  method: 'POST' | 'PUT';
  operationId?: string;
  itemId?: string;
  challengeId?: string;
  bindingRequired: boolean;
  operationTokenRequired: boolean;
  binary: boolean;
};

class BodyTooLargeError extends Error {}
class BodyTimeoutError extends Error {}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function requestFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function sendJson(response: ServerResponse, status: number, body: unknown, closeConnection = false): void {
  if (response.writableEnded || response.destroyed) return;
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(bytes.byteLength));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (closeConnection) response.setHeader('Connection', 'close');
  response.end(bytes);
}

function retryDisposition(code: string): 'same-request' | 'after-refresh' | 'after-human-action' | 'manual-recovery' | 'never' {
  if (code === 'AUTHORITY_UNAVAILABLE') return 'same-request';
  if (code === 'IMPORT_OPERATION_NOT_FOUND' || code === 'PROJECT_BUSY') return 'after-refresh';
  if (code === 'IMPORT_RECOVERY_REQUIRED') return 'manual-recovery';
  if (code === 'IMPORT_FILESYSTEM_UNSUPPORTED') return 'never';
  return 'after-human-action';
}

function statusForCode(code: string): number {
  if (code === 'AUTHORITY_TOKEN_REJECTED') return 403;
  if (code === 'AUTHORITY_ORIGIN_REJECTED') return 403;
  if (code === 'AUTHORITY_UNAVAILABLE') return 503;
  if (code === 'IMPORT_LIMIT_EXCEEDED') return 413;
  if (code === 'IMPORT_OPERATION_NOT_FOUND') return 404;
  if (code === 'IMPORT_PLAN_BLOCKED' || code === 'IMPORT_UPLOAD_MISMATCH') return 422;
  if (['PROJECT_BUSY', 'PROJECT_IDENTITY_MISMATCH', 'IMPORT_PLAN_STALE', 'IMPORT_TARGET_EXISTS',
    'IMPORT_OPERATION_CONFLICT', 'IMPORT_RECOVERY_REQUIRED', 'IMPORT_UNDO_BLOCKED_CHANGED'].includes(code)) return 409;
  return 400;
}

function publicCode(error: unknown): string {
  if (!(error instanceof AssetImportAuthorityError)) return 'AUTHORITY_UNAVAILABLE';
  if (PUBLIC_CODES.has(error.code)) return error.code;
  if (error.code === 'IMPORT_AUTH_REQUIRED') return 'AUTHORITY_TOKEN_REJECTED';
  if (error.code === 'IMPORT_AUTHORITY_NOT_READY') return 'AUTHORITY_UNAVAILABLE';
  if (error.code === 'IMPORT_PROJECT_STALE') return 'PROJECT_IDENTITY_MISMATCH';
  if (error.code === 'IMPORT_UPLOAD_BUSY') return 'IMPORT_LIMIT_EXCEEDED';
  return 'AUTHORITY_UNAVAILABLE';
}

function safeDetails(error: unknown): { operationId?: string; itemId?: string; field?: string } | undefined {
  if (!(error instanceof AssetImportAuthorityError)) return undefined;
  const result: { operationId?: string; itemId?: string; field?: string } = {};
  if (typeof error.details.operationId === 'string' && UUID.test(error.details.operationId)) {
    result.operationId = error.details.operationId;
  }
  if (typeof error.details.itemId === 'string' && UUID.test(error.details.itemId)) result.itemId = error.details.itemId;
  if (typeof error.details.field === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(error.details.field)) {
    result.field = error.details.field;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function sendError(request: IncomingMessage, response: ServerResponse, code: string, status = statusForCode(code), error?: unknown): void {
  request.pause();
  const details = safeDetails(error);
  sendJson(response, status, {
    ok: false,
    error: {
      code,
      messageKey: `assetImport.${code}`,
      retryDisposition: retryDisposition(code),
      ...(details === undefined ? {} : { details }),
    },
  }, true);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '请求必须是对象');
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '请求字段不完整或包含未知字段');
  }
  return object;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 格式无效`, { field });
  }
  return value;
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 格式无效`, { field });
  }
  return value;
}

function browserSession(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\\/]/.test(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'browserSessionId 格式无效', { field: 'browserSessionId' });
  }
  return value;
}

function parseEmpty(value: unknown): EmptyObject {
  exactObject(value, []);
  return {};
}

function parseStatus(value: unknown): { browserSessionId: string } {
  const object = exactObject(value, ['browserSessionId']);
  return { browserSessionId: browserSession(object.browserSessionId) };
}

function parseChallengeConfirm(value: unknown): ConfirmBindingChallengeRequest {
  const object = exactObject(value, ['browserSessionId', 'nonce']);
  if (typeof object.nonce !== 'string' || object.nonce.length < 1 || object.nonce.length > 256) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'nonce 格式无效', { field: 'nonce' });
  }
  return { browserSessionId: browserSession(object.browserSessionId), nonce: object.nonce };
}

function parseCreate(value: unknown): CreateImportOperationRequest {
  const object = exactObject(value, ['operationId', 'items']);
  if (!Array.isArray(object.items) || object.items.length < 1 || object.items.length > 512) {
    throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '导入文件数量超出范围');
  }
  return {
    operationId: requireUuid(object.operationId, 'operationId'),
    items: object.items.map((item) => {
      const entry = exactObject(item, ['itemId', 'sourceName', 'declaredBytes']);
      if (typeof entry.sourceName !== 'string' || !Number.isSafeInteger(entry.declaredBytes) || (entry.declaredBytes as number) < 0) {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '导入文件清单格式无效');
      }
      return {
        itemId: requireUuid(entry.itemId, 'itemId'),
        sourceName: entry.sourceName,
        declaredBytes: entry.declaredBytes as number,
      };
    }),
  };
}

function parsePlan(value: unknown): PlanOperationRequest {
  const object = exactObject(value, ['targets']);
  if (!Array.isArray(object.targets) || object.targets.length < 1 || object.targets.length > 512) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '导入目标清单格式无效');
  }
  return {
    targets: object.targets.map((target): ProjectAssetImportTargetRequest => {
      const entry = exactObject(target, ['itemId', 'kind', 'fileName']);
      if (typeof entry.kind !== 'string' || !KINDS.has(entry.kind) || typeof entry.fileName !== 'string') {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '导入目标格式无效');
      }
      return { itemId: requireUuid(entry.itemId, 'itemId'), kind: entry.kind as ProjectAssetImportTargetRequest['kind'], fileName: entry.fileName };
    }),
  };
}

function parseFingerprint(value: unknown): { planFingerprint: string } {
  const object = exactObject(value, ['planFingerprint']);
  return { planFingerprint: requireSha256(object.planFingerprint, 'planFingerprint') };
}

function parseRecover(value: unknown): RecoverOperationRequest {
  const object = exactObject(value, ['action']);
  if (object.action !== 'resume' && object.action !== 'rollback') {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '恢复动作无效', { field: 'action' });
  }
  return { action: object.action };
}

function parseUndo(value: unknown): UndoOperationRequest {
  const object = exactObject(value, ['receiptId', 'receiptSha256']);
  return {
    receiptId: requireUuid(object.receiptId, 'receiptId'),
    receiptSha256: requireSha256(object.receiptSha256, 'receiptSha256'),
  };
}

function requireProjectRelativePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_024
    || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', `${field} 格式无效`, { field });
  }
  return value.normalize('NFC');
}

function parseRelocationPlan(value: unknown): PlanAssetRelocationRequest {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'moves')) {
    const object = exactObject(value, ['moves', 'operationId']);
    if (!Array.isArray(object.moves) || object.moves.length < 1 || object.moves.length > 100) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'moves 数量必须在 1 到 100 之间', { field: 'moves' });
    }
    return {
      operationId: requireUuid(object.operationId, 'operationId'),
      moves: object.moves.map((value, index) => {
        const move = exactObject(value, ['sourcePath', 'targetPath']);
        return {
          sourcePath: requireProjectRelativePath(move.sourcePath, `moves[${index}].sourcePath`),
          targetPath: requireProjectRelativePath(move.targetPath, `moves[${index}].targetPath`),
        };
      }),
    };
  }
  const object = exactObject(value, ['fileName', 'operationId', 'sourcePath', 'targetDirectory']);
  const sourcePath = requireProjectRelativePath(object.sourcePath, 'sourcePath');
  const targetDirectory = requireProjectRelativePath(object.targetDirectory, 'targetDirectory');
  if (typeof object.fileName !== 'string') {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'fileName 格式无效', { field: 'fileName' });
  }
  const fileName = object.fileName.normalize('NFC');
  if (fileName.length < 1 || fileName.length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(fileName)
    || fileName === '.' || fileName === '..' || /[ .]$/u.test(fileName)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', 'fileName 格式无效', { field: 'fileName' });
  }
  return {
    operationId: requireUuid(object.operationId, 'operationId'),
    sourcePath,
    targetPath: `${targetDirectory}/${fileName}`,
  };
}

function parseScenePlan(value: unknown): SceneLifecyclePlanRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '场景计划格式无效');
  }
  const kind = (value as Record<string, unknown>).kind;
  const object = exactObject(value, kind === 'rename'
    ? ['kind', 'operationId', 'sourcePath', 'targetPath']
    : ['kind', 'operationId', 'sourcePath']);
  if (object.kind !== 'rename' && object.kind !== 'delete') {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '场景计划类型无效', { field: 'kind' });
  }
  return {
    operationId: requireUuid(object.operationId, 'operationId'),
    kind: object.kind,
    sourcePath: requireProjectRelativePath(object.sourcePath, 'sourcePath'),
    ...(object.kind === 'rename'
      ? { targetPath: requireProjectRelativePath(object.targetPath, 'targetPath') }
      : {}),
  };
}

function parseSceneCommit(value: unknown): SceneLifecycleCommitRequest {
  const object = exactObject(value, ['plans', 'requestId', 'writes']);
  if (!Array.isArray(object.plans) || object.plans.length > 100
    || !Array.isArray(object.writes) || object.writes.length > 512) {
    throw new AssetImportAuthorityError('INVALID_REQUEST', '场景保存批次格式无效');
  }
  return {
    requestId: requireUuid(object.requestId, 'requestId'),
    plans: object.plans.map((value, index) => {
      const plan = exactObject(value, ['operationId', 'planFingerprint']);
      return {
        operationId: requireUuid(plan.operationId, `plans[${index}].operationId`),
        planFingerprint: requireSha256(plan.planFingerprint, `plans[${index}].planFingerprint`),
      };
    }),
    writes: object.writes.map((value, index) => {
      const write = exactObject(value, ['expectedSha256', 'path', 'text']);
      if (typeof write.text !== 'string') {
        throw new AssetImportAuthorityError('INVALID_REQUEST', '场景正文格式无效', { field: `writes[${index}].text` });
      }
      return {
        path: requireProjectRelativePath(write.path, `writes[${index}].path`),
        text: write.text,
        expectedSha256: write.expectedSha256 === null
          ? null
          : requireSha256(write.expectedSha256, `writes[${index}].expectedSha256`),
      };
    }),
  };
}

function parseRelocationUndo(value: unknown): UndoAssetRelocationRequest {
  const object = exactObject(value, ['receiptFingerprint', 'receiptId']);
  return {
    receiptId: requireUuid(object.receiptId, 'receiptId'),
    receiptFingerprint: requireSha256(object.receiptFingerprint, 'receiptFingerprint'),
  };
}

function summary(operation: OperationDetailResponse['operation']): OperationSummary {
  return {
    operationId: operation.operationId,
    status: operation.status,
    itemCount: operation.itemCount,
    updatedAt: operation.updatedAt,
    manualRecoveryRequired: operation.status === 'RECOVERY_REQUIRED',
  };
}

function allowedActions(status: OperationSummary['status']): string[] {
  if (status === 'UPLOADING') return ['upload', 'cancel'];
  if (status === 'STAGED') return ['plan', 'cancel'];
  if (status === 'READY') return ['plan', 'seal', 'commit', 'cancel'];
  if (status === 'COMMITTED') return ['resume', 'undo'];
  if (status === 'PUBLISHING' || status === 'ROLLING_BACK' || status === 'UNDOING' || status === 'RECOVERY_REQUIRED') {
    return ['resume', 'recover'];
  }
  return [];
}

function publicDetail(detail: OperationDetailResponse): unknown {
  return {
    operation: summary(detail.operation),
    plan: detail.plan,
    receipt: detail.receipt,
    undoReceipt: detail.undoReceipt,
    allowedActions: allowedActions(detail.operation.status),
  };
}

async function publicList(authority: AssetImportAuthorityHttpTarget): Promise<{
  pendingOperations: OperationSummary[];
  recentReceipts: ReceiptSummary[];
}> {
  const listed = await authority.list();
  const pendingOperations: OperationSummary[] = [];
  const recentReceipts: ReceiptSummary[] = [];
  const terminalOperations: typeof listed.operations = [];
  for (const operation of listed.operations) {
    if (!['COMMITTED', 'UNDONE', 'CANCELLED', 'ROLLED_BACK'].includes(operation.status)) {
      pendingOperations.push(summary(operation));
      continue;
    }
    if (operation.status !== 'COMMITTED' && operation.status !== 'UNDONE') continue;
    terminalOperations.push(operation);
  }
  for (const operation of terminalOperations
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20)) {
    if (operation.status !== 'COMMITTED' && operation.status !== 'UNDONE') continue;
    const detail = await authority.query(operation.operationId);
    if (detail.receipt !== null) {
      recentReceipts.push({
        operationId: operation.operationId,
        receiptId: detail.receipt.receiptId,
        status: operation.status,
        fileCount: detail.receipt.files.length,
        committedAt: detail.receipt.committedAt,
      });
    }
  }
  return { pendingOperations, recentReceipts };
}

function relocationAllowedActions(status: AssetRelocationDetailResponse['operation']['status']): string[] {
  if (status === 'PLANNED') return ['commit', 'cancel'];
  if (status === 'COMMITTED') return ['resume', 'undo'];
  if (['PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED'].includes(status)) return ['resume', 'recover'];
  return [];
}

function publicRelocationDetail(detail: AssetRelocationDetailResponse): unknown {
  const { projectRevision: _projectRevision, ...plan } = detail.plan;
  return {
    request: detail.request,
    operation: {
      operationId: detail.operation.operationId,
      status: detail.operation.status,
      sourcePath: detail.request.sourcePath,
      targetPath: detail.request.targetPath,
      moves: detail.request.moves,
      updatedAt: detail.operation.updatedAt,
      manualRecoveryRequired: detail.operation.status === 'RECOVERY_REQUIRED',
    },
    plan,
    receipt: detail.receipt,
    undoReceipt: detail.undoReceipt,
    allowedActions: relocationAllowedActions(detail.operation.status),
  };
}

async function publicRelocationList(authority: AssetImportAuthorityHttpTarget): Promise<ListAssetRelocationsResponse> {
  return authority.relocationList?.() ?? { operations: [], recentReceipts: [] };
}

function parseRoute(url: string): Route | null {
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/status`) return { kind: 'status', method: 'POST', bindingRequired: false, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges`) return { kind: 'challenge-create', method: 'POST', bindingRequired: false, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/revoke`) return { kind: 'binding-revoke', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`) return { kind: 'operation-create', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/query`) return { kind: 'operation-list', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`) return { kind: 'relocation-plan', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/query`) return { kind: 'relocation-list', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`) return { kind: 'scene-plan', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  if (url === `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`) return { kind: 'scene-commit', method: 'POST', bindingRequired: true, operationTokenRequired: false, binary: false };
  const challenge = url.match(new RegExp(`^${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges/(${UUID_SEGMENT})/confirm$`));
  if (challenge) return { kind: 'challenge-confirm', method: 'POST', challengeId: challenge[1], bindingRequired: false, operationTokenRequired: false, binary: false };
  const upload = url.match(new RegExp(`^${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/(${UUID_SEGMENT})/items/(${UUID_SEGMENT})$`));
  if (upload) return { kind: 'upload', method: 'PUT', operationId: upload[1], itemId: upload[2], bindingRequired: true, operationTokenRequired: true, binary: true };
  const operation = url.match(new RegExp(`^${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/(${UUID_SEGMENT})/(plan|seal|commit|cancel|query|resume|recover|undo)$`));
  if (operation) {
    const action = operation[2]! as 'plan' | 'seal' | 'commit' | 'cancel' | 'query' | 'resume' | 'recover' | 'undo';
    return {
      kind: action === 'query' ? 'operation-query' : action,
      method: 'POST',
      operationId: operation[1],
      bindingRequired: true,
      operationTokenRequired: !['query', 'resume'].includes(action),
      binary: false,
    };
  }
  const relocation = url.match(new RegExp(`^${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/(${UUID_SEGMENT})/(commit|cancel|query|resume|recover|undo)$`));
  if (!relocation) return null;
  const relocationAction = relocation[2]! as 'commit' | 'cancel' | 'query' | 'resume' | 'recover' | 'undo';
  return {
    kind: `relocation-${relocationAction}` as Route['kind'],
    method: 'POST',
    operationId: relocation[1],
    bindingRequired: true,
    operationTokenRequired: !['query', 'resume'].includes(relocationAction),
    binary: false,
  };
}

async function isAllowedTerminalReplay(authority: AssetImportAuthorityHttpTarget, route: Route): Promise<boolean> {
  if (route.operationId === undefined) return false;
  if (route.kind.startsWith('relocation-')) {
    const allowed = route.kind === 'relocation-commit' ? ['COMMITTED']
      : route.kind === 'relocation-cancel' ? ['CANCELLED']
        : route.kind === 'relocation-undo' ? ['UNDONE']
          : route.kind === 'relocation-recover' ? ['COMMITTED', 'ROLLED_BACK', 'UNDONE']
            : [];
    if (allowed.length === 0) return false;
    try {
      if (authority.relocationQuery === undefined) return false;
      return allowed.includes((await authority.relocationQuery(route.operationId)).operation.status);
    } catch {
      return false;
    }
  }
  const allowed = route.kind === 'commit'
    ? ['COMMITTED']
    : route.kind === 'cancel'
      ? ['CANCELLED']
      : route.kind === 'undo'
        ? ['UNDONE']
        : route.kind === 'recover'
          ? ['COMMITTED', 'ROLLED_BACK', 'UNDONE']
          : [];
  if (allowed.length === 0) return false;
  try {
    const detail = await authority.query(route.operationId);
    return allowed.includes(detail.operation.status);
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<unknown> {
  const length = headerValue(request, 'content-length');
  if (length !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length))) {
      throw new AssetImportAuthorityError('INVALID_REQUEST', 'Content-Length 格式无效');
    }
    if (Number(length) > maxBytes) throw new BodyTooLargeError();
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const fail = (error: unknown): void => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) return fail(new BodyTooLargeError());
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (done) return;
      done = true;
      cleanup();
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.length === 0) throw new AssetImportAuthorityError('INVALID_REQUEST', '请求正文不能为空');
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error instanceof AssetImportAuthorityError ? error : new AssetImportAuthorityError('INVALID_REQUEST', '请求正文不是合法 JSON'));
      }
    };
    const onError = (error: Error): void => fail(error);
    const onAborted = (): void => fail(new AssetImportAuthorityError('INVALID_REQUEST', '请求正文被中断'));
    const timer = setTimeout(() => fail(new BodyTimeoutError()), timeoutMs);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

export function createAssetImportAuthorityHttpHandler(
  options: AssetImportAuthorityHttpHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const maxJsonBytes = options.maxJsonBytes ?? ASSET_IMPORT_AUTHORITY_MAX_JSON_BYTES;
  const jsonTimeoutMs = options.jsonTimeoutMs ?? 5_000;
  const now = options.now ?? (() => Date.now());
  if (options.token.length < 32) throw new Error('asset import authority token is too short');
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 1 || maxJsonBytes > ASSET_IMPORT_AUTHORITY_MAX_JSON_BYTES) {
    throw new Error('maxJsonBytes is outside the authority limit');
  }
  if (!Number.isSafeInteger(jsonTimeoutMs) || jsonTimeoutMs < 1 || jsonTimeoutMs > 30_000) {
    throw new Error('jsonTimeoutMs is outside the authority limit');
  }
  const operationBindings = new Map<string, {
    bindingToken: string;
    operationId: string;
    operationKind: 'asset-import' | 'asset-relocation';
    expiresAt: number;
    terminalReplayKind?: Route['kind'];
    terminalReplayFingerprint?: string;
    terminalReplayExpiresAt?: number;
  }>();

  return (request, response) => {
    void (async () => {
      const route = parseRoute(request.url ?? '');
      if (route === null) return sendError(request, response, 'INVALID_REQUEST', 404);
      if (request.method !== route.method) {
        response.setHeader('Allow', route.method);
        return sendError(request, response, 'INVALID_REQUEST', 405);
      }
      const localAddress = request.socket.localAddress;
      if (localAddress !== '127.0.0.1' && localAddress !== '::ffff:127.0.0.1') {
        return sendError(request, response, 'AUTHORITY_ORIGIN_REJECTED');
      }
      const expectedOrigin = options.expectedOrigin(request);
      const origin = headerValue(request, 'origin');
      if (expectedOrigin === undefined || origin !== expectedOrigin) {
        return sendError(request, response, 'AUTHORITY_ORIGIN_REJECTED');
      }
      if (!secureEqual(headerValue(request, ASSET_IMPORT_AUTHORITY_TOKEN_HEADER), options.token)) {
        return sendError(request, response, 'AUTHORITY_TOKEN_REJECTED');
      }
      const contentEncoding = headerValue(request, 'content-encoding');
      if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== 'identity') {
        return sendError(request, response, 'INVALID_REQUEST', 415);
      }
      const expectedContentType = route.binary ? 'application/octet-stream' : 'application/json';
      const contentType = headerValue(request, 'content-type') ?? '';
      const contentTypeValid = route.binary
        ? /^application\/octet-stream$/i.test(contentType)
        : /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType);
      if (!contentTypeValid) return sendError(request, response, 'INVALID_REQUEST', 415);

      let body: unknown = undefined;
      if (!route.binary) body = await readJsonBody(request, maxJsonBytes, jsonTimeoutMs);
      let browserSessionId: string | undefined;
      let requestBindingToken: string | undefined;
      let requestOperationToken: string | undefined;
      const currentRequestFingerprint = route.operationTokenRequired && !route.binary
        ? requestFingerprint(body)
        : undefined;
      if (route.kind === 'status' || route.kind === 'challenge-create' || route.kind === 'binding-revoke') {
        browserSessionId = parseStatus(body).browserSessionId;
      }
      if (route.bindingRequired) {
        requestBindingToken = headerValue(request, ASSET_IMPORT_AUTHORITY_BINDING_HEADER);
        if (requestBindingToken === undefined || !await options.authority.validateBinding(requestBindingToken, browserSessionId)) {
          if (requestBindingToken !== undefined) {
            for (const [token, scope] of operationBindings) {
              if (secureEqual(scope.bindingToken, requestBindingToken)) operationBindings.delete(token);
            }
          }
          return sendError(request, response, 'AUTHORITY_TOKEN_REJECTED');
        }
      }
      if (route.operationTokenRequired) {
        requestOperationToken = headerValue(request, ASSET_IMPORT_AUTHORITY_OPERATION_HEADER) ?? '';
        const scope = operationBindings.get(requestOperationToken);
        const expectedOperationKind = route.kind.startsWith('relocation-') ? 'asset-relocation' : 'asset-import';
        if (scope === undefined || scope.operationId !== route.operationId
          || scope.operationKind !== expectedOperationKind
          || requestBindingToken === undefined || !secureEqual(scope.bindingToken, requestBindingToken)) {
          return sendError(request, response, 'AUTHORITY_TOKEN_REJECTED');
        }
        const unexpiredTerminalReplay = scope.terminalReplayKind === route.kind
          && scope.terminalReplayFingerprint !== undefined
          && scope.terminalReplayExpiresAt !== undefined
          && now() < scope.terminalReplayExpiresAt
          && secureEqual(currentRequestFingerprint, scope.terminalReplayFingerprint);
        if (now() >= scope.expiresAt && !unexpiredTerminalReplay) {
          operationBindings.delete(requestOperationToken);
          return sendError(request, response, 'AUTHORITY_TOKEN_REJECTED');
        }
        try {
          if (scope.operationKind === 'asset-import') {
            options.authority.verifyOperationToken(route.operationId!, requestOperationToken);
          }
        } catch (error) {
          if (scope.terminalReplayKind !== route.kind
            || scope.terminalReplayFingerprint === undefined
            || !secureEqual(currentRequestFingerprint, scope.terminalReplayFingerprint)
            || !await isAllowedTerminalReplay(options.authority, route)) {
            return sendError(request, response, 'AUTHORITY_TOKEN_REJECTED', 403, error);
          }
        }
      }

      let data: unknown;
      switch (route.kind) {
        case 'status':
          data = { authorityContractVersion: 1, authorityAvailable: true, projectIdentity: options.authority.projectIdentity, bindingRequired: true };
          break;
        case 'challenge-create':
          data = await options.authority.createChallenge(browserSessionId!);
          break;
        case 'challenge-confirm': {
          const requestBody = parseChallengeConfirm(body);
          const confirmed = await options.authority.confirmChallenge(route.challengeId!, requestBody);
          const discovery = await publicList(options.authority);
          const relocationDiscovery = await publicRelocationList(options.authority);
          const discoveryRequiresRecovery = discovery.pendingOperations.some(
            (operation) => operation.manualRecoveryRequired,
          ) || relocationDiscovery.operations.some((operation) => operation.manualRecoveryRequired);
          data = {
            projectIdentity: confirmed.projectIdentity,
            projectName: confirmed.projectName,
            bindingToken: confirmed.bindingToken,
            bindingExpiresAt: confirmed.bindingExpiresAt,
            recoveryBarrier: discoveryRequiresRecovery ? 'manual-recovery' : confirmed.recoveryBarrier,
            pendingOperations: discovery.pendingOperations,
            recentReceipts: discovery.recentReceipts,
            pendingRelocations: relocationDiscovery.operations.filter((operation) => !['COMMITTED', 'CANCELLED', 'ROLLED_BACK', 'UNDONE'].includes(operation.status)),
            recentRelocationReceipts: relocationDiscovery.recentReceipts,
          };
          break;
        }
        case 'binding-revoke':
          options.authority.revoke(browserSessionId!);
          for (const [token, scope] of operationBindings) {
            if (requestBindingToken !== undefined && secureEqual(scope.bindingToken, requestBindingToken)) {
              operationBindings.delete(token);
            }
          }
          data = { revoked: true };
          break;
        case 'operation-create': {
          const created = await options.authority.createOperation(parseCreate(body));
          const expiresAt = now() + 30 * 60_000;
          operationBindings.set(created.operationToken, {
            bindingToken: requestBindingToken!, operationId: created.operationId, operationKind: 'asset-import', expiresAt,
          });
          data = {
            operationId: created.operationId,
            operationToken: created.operationToken,
            status: created.status,
            expiresAt: new Date(expiresAt).toISOString(),
          };
          break;
        }
        case 'operation-list':
          parseEmpty(body);
          data = await publicList(options.authority);
          break;
        case 'upload': {
          const expectedBytes = await options.authority.expectedUploadBytes(route.operationId!, route.itemId!);
          const length = headerValue(request, 'content-length');
          if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) !== expectedBytes)) {
            return sendError(request, response, 'IMPORT_UPLOAD_MISMATCH', 422);
          }
          const staged = await options.authority.uploadItem(route.operationId!, route.itemId!, request);
          data = {
            operationId: staged.operationId,
            itemId: staged.itemId,
            bytes: staged.bytes,
            sha256: staged.sha256,
            stagedItemFingerprint: staged.stagedItemFingerprint,
          };
          break;
        }
        case 'plan':
          data = await options.authority.plan(route.operationId!, parsePlan(body));
          break;
        case 'seal':
          data = await options.authority.seal(route.operationId!, parseFingerprint(body));
          break;
        case 'commit': {
          const committed = await options.authority.commit(route.operationId!, parseFingerprint(body));
          data = { operation: summary(committed.operation), receipt: committed.receipt };
          break;
        }
        case 'cancel': {
          parseEmpty(body);
          const cancelled = await options.authority.cancel(route.operationId!);
          data = { operation: summary(cancelled.operation) };
          break;
        }
        case 'operation-query':
          parseEmpty(body);
          data = publicDetail(await options.authority.query(route.operationId!));
          break;
        case 'resume': {
          parseEmpty(body);
          const resumedToken = await options.authority.issueOperationToken(route.operationId!);
          const expiresAt = now() + 30 * 60_000;
          operationBindings.set(resumedToken, {
            bindingToken: requestBindingToken!, operationId: route.operationId!, operationKind: 'asset-import', expiresAt,
          });
          data = {
            operationToken: resumedToken,
            expiresAt: new Date(expiresAt).toISOString(),
            detail: publicDetail(await options.authority.query(route.operationId!)),
          };
          break;
        }
        case 'recover': {
          const recovered = await options.authority.recover(route.operationId!, parseRecover(body));
          data = { detail: publicDetail(recovered.detail) };
          break;
        }
        case 'undo': {
          const undone = await options.authority.undo(route.operationId!, parseUndo(body));
          data = { operation: summary(undone.operation), undoReceipt: undone.undoReceipt };
          break;
        }
        case 'relocation-plan': {
          if (options.authority.relocationPlan === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          const planned = await options.authority.relocationPlan(parseRelocationPlan(body));
          const operationToken = crypto.randomBytes(32).toString('hex');
          const expiresAt = now() + 30 * 60_000;
          operationBindings.set(operationToken, {
            bindingToken: requestBindingToken!,
            operationId: planned.operation.operationId,
            operationKind: 'asset-relocation',
            expiresAt,
          });
          data = {
            operationToken,
            expiresAt: new Date(expiresAt).toISOString(),
            detail: publicRelocationDetail(planned),
          };
          break;
        }
        case 'relocation-list':
          parseEmpty(body);
          data = await publicRelocationList(options.authority);
          break;
        case 'relocation-query':
          parseEmpty(body);
          if (options.authority.relocationQuery === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          data = publicRelocationDetail(await options.authority.relocationQuery(route.operationId!));
          break;
        case 'relocation-resume': {
          parseEmpty(body);
          if (options.authority.relocationQuery === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          const detail = await options.authority.relocationQuery(route.operationId!);
          const operationToken = crypto.randomBytes(32).toString('hex');
          const expiresAt = now() + 30 * 60_000;
          operationBindings.set(operationToken, {
            bindingToken: requestBindingToken!,
            operationId: route.operationId!,
            operationKind: 'asset-relocation',
            expiresAt,
          });
          data = { operationToken, expiresAt: new Date(expiresAt).toISOString(), detail: publicRelocationDetail(detail) };
          break;
        }
        case 'relocation-commit':
          if (options.authority.relocationCommit === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          data = publicRelocationDetail(await options.authority.relocationCommit(route.operationId!, parseFingerprint(body)));
          break;
        case 'relocation-cancel':
          parseEmpty(body);
          if (options.authority.relocationCancel === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          data = publicRelocationDetail(await options.authority.relocationCancel(route.operationId!));
          break;
        case 'relocation-recover':
          if (options.authority.relocationRecover === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          data = publicRelocationDetail(await options.authority.relocationRecover(route.operationId!, parseRecover(body)));
          break;
        case 'relocation-undo':
          if (options.authority.relocationUndo === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '素材整理服务尚未就绪');
          data = publicRelocationDetail(await options.authority.relocationUndo(route.operationId!, parseRelocationUndo(body)));
          break;
        case 'scene-plan':
          if (options.authority.scenePlan === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '场景安全保存服务尚未就绪');
          data = await options.authority.scenePlan(parseScenePlan(body));
          break;
        case 'scene-commit':
          if (options.authority.sceneCommit === undefined) throw new AssetImportAuthorityError('AUTHORITY_UNAVAILABLE', '场景安全保存服务尚未就绪');
          data = await options.authority.sceneCommit(parseSceneCommit(body));
          break;
      }
      if (requestOperationToken !== undefined
        && ['commit', 'cancel', 'recover', 'undo', 'relocation-commit', 'relocation-cancel', 'relocation-recover', 'relocation-undo'].includes(route.kind)) {
        const scope = operationBindings.get(requestOperationToken);
        if (scope !== undefined && currentRequestFingerprint !== undefined) {
          scope.terminalReplayKind = route.kind;
          scope.terminalReplayFingerprint = currentRequestFingerprint;
          scope.terminalReplayExpiresAt = now() + 5 * 60_000;
        }
      }
      sendJson(response, 200, { ok: true, data });
    })().catch((error: unknown) => {
      if (error instanceof BodyTooLargeError) return sendError(request, response, 'IMPORT_LIMIT_EXCEEDED', 413);
      if (error instanceof BodyTimeoutError) return sendError(request, response, 'INVALID_REQUEST', 408);
      if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_UPLOAD_TIMEOUT') {
        return sendError(request, response, 'INVALID_REQUEST', 408, error);
      }
      const code = publicCode(error);
      return sendError(request, response, code, statusForCode(code), error);
    });
  };
}
