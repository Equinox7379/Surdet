import { AuthoringOperationError } from './change-session.js';

export const REVIEW_TERMINAL_PROTOCOL_VERSION = '1.0.0' as const;

export type ReviewTerminalAction =
  | 'comparison-decision'
  | 'result-approval'
  | 'result-return';

export type ReviewTerminalState =
  | 'open'
  | 'decision-written'
  | 'approval-written'
  | 'returned'
  | 'corrupt';

export interface ReviewPayloadIdentity {
  bytes: number;
  sha256: string;
}

export interface ReviewTerminalCommand {
  protocolVersion: typeof REVIEW_TERMINAL_PROTOCOL_VERSION;
  requestId: string;
  projectIdentity: string;
  reviewId: string;
  reviewPayload: ReviewPayloadIdentity;
  action: ReviewTerminalAction;
  receipt: unknown;
}

export type ReviewTerminalReceiptFile =
  | 'decision.json'
  | 'final-approval.json'
  | 'return-request.json';

export interface ReviewTerminalRecord {
  action: ReviewTerminalAction;
  file: ReviewTerminalReceiptFile;
  bytes: number;
  sha256: string;
  receipt: unknown;
}

export interface ReviewTerminalSnapshot {
  protocolVersion: typeof REVIEW_TERMINAL_PROTOCOL_VERSION;
  reviewId: string;
  projectIdentity: string;
  state: ReviewTerminalState;
  record?: ReviewTerminalRecord;
}

const COMMAND_KEYS = [
  'action',
  'projectIdentity',
  'protocolVersion',
  'receipt',
  'requestId',
  'reviewId',
  'reviewPayload',
] as const;
const PAYLOAD_KEYS = ['bytes', 'sha256'] as const;
const SNAPSHOT_KEYS_WITHOUT_RECORD = [
  'projectIdentity',
  'protocolVersion',
  'reviewId',
  'state',
] as const;
const SNAPSHOT_KEYS_WITH_RECORD = [...SNAPSHOT_KEYS_WITHOUT_RECORD, 'record'] as const;
const RECORD_KEYS = ['action', 'bytes', 'file', 'receipt', 'sha256'] as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_IDENTIFIER_LENGTH = 256;

function invalid(message: string): never {
  throw new AuthoringOperationError('INVALID_REQUEST', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parseIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim().length === 0
    || CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalid(`${label} 必须是非空、长度不超过 ${MAX_IDENTIFIER_LENGTH} 且不含控制字符的标识。`);
  }
  return value;
}

function parseSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(`${label} 必须是小写 64 位 SHA-256。`);
  }
  return value;
}

function parseBytes(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalid(`${label} 必须是非负安全整数。`);
  }
  return value;
}

function parsePayloadIdentity(value: unknown): ReviewPayloadIdentity {
  if (!isRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
    return invalid('reviewPayload 只能包含 bytes 与 sha256。');
  }
  return {
    bytes: parseBytes(value['bytes'], 'reviewPayload.bytes'),
    sha256: parseSha256(value['sha256'], 'reviewPayload.sha256'),
  };
}

function parseAction(value: unknown): ReviewTerminalAction {
  if (value !== 'comparison-decision'
    && value !== 'result-approval'
    && value !== 'result-return') {
    return invalid('action 不是受支持的审阅终态动作。');
  }
  return value;
}

function requireReceiptField(
  receipt: Record<string, unknown>,
  key: string,
  label: string,
): string {
  return parseIdentifier(receipt[key], label);
}

function requireReceiptFingerprint(
  receipt: Record<string, unknown>,
  key: string,
  label: string,
): void {
  parseSha256(receipt[key], label);
}

function validateReceiptShape(
  action: ReviewTerminalAction,
  value: unknown,
  reviewId: string,
): void {
  if (!isRecord(value) || (value['receiptVersion'] !== '1.0.0'
    && !(action === 'comparison-decision' && value['receiptVersion'] === '2.0.0'))) {
    return invalid('receipt 版本与当前审阅动作不兼容。');
  }
  if (action === 'comparison-decision') {
    requireReceiptField(value, 'decisionId', 'receipt.decisionId');
    if (requireReceiptField(value, 'reviewId', 'receipt.reviewId') !== reviewId) {
      return invalid('决定回执的 reviewId 与命令不一致。');
    }
    requireReceiptFingerprint(value, 'decisionFingerprint', 'receipt.decisionFingerprint');
    if (value['receiptVersion'] === '2.0.0') {
      requireReceiptFingerprint(value, 'reviewFingerprint', 'receipt.reviewFingerprint');
      requireReceiptFingerprint(value, 'planContentFingerprint', 'receipt.planContentFingerprint');
      requireReceiptFingerprint(value, 'previewFingerprint', 'receipt.previewFingerprint');
    }
    return;
  }
  if (action === 'result-approval') {
    requireReceiptField(value, 'approvalId', 'receipt.approvalId');
    if (requireReceiptField(value, 'resultReviewId', 'receipt.resultReviewId') !== reviewId) {
      return invalid('批准回执的 resultReviewId 与命令不一致。');
    }
    requireReceiptFingerprint(value, 'approvalFingerprint', 'receipt.approvalFingerprint');
    return;
  }
  requireReceiptField(value, 'returnId', 'receipt.returnId');
  if (requireReceiptField(value, 'resultReviewId', 'receipt.resultReviewId') !== reviewId) {
    return invalid('退回回执的 resultReviewId 与命令不一致。');
  }
  requireReceiptFingerprint(value, 'returnFingerprint', 'receipt.returnFingerprint');
}

export function parseReviewTerminalCommand(value: unknown): ReviewTerminalCommand {
  if (!isRecord(value) || !hasExactKeys(value, COMMAND_KEYS)) {
    return invalid('审阅终态命令字段不合法；命令不得携带路径或额外字段。');
  }
  if (value['protocolVersion'] !== REVIEW_TERMINAL_PROTOCOL_VERSION) {
    return invalid('审阅终态协议版本不受支持。');
  }
  const requestId = parseIdentifier(value['requestId'], 'requestId');
  const projectIdentity = parseIdentifier(value['projectIdentity'], 'projectIdentity');
  const reviewId = parseIdentifier(value['reviewId'], 'reviewId');
  const action = parseAction(value['action']);
  validateReceiptShape(action, value['receipt'], reviewId);
  return {
    protocolVersion: REVIEW_TERMINAL_PROTOCOL_VERSION,
    requestId,
    projectIdentity,
    reviewId,
    reviewPayload: parsePayloadIdentity(value['reviewPayload']),
    action,
    receipt: value['receipt'],
  };
}

const RECORD_SHAPE: Readonly<Record<Exclude<ReviewTerminalState, 'open' | 'corrupt'>, {
  action: ReviewTerminalAction;
  file: ReviewTerminalReceiptFile;
}>> = {
  'decision-written': { action: 'comparison-decision', file: 'decision.json' },
  'approval-written': { action: 'result-approval', file: 'final-approval.json' },
  returned: { action: 'result-return', file: 'return-request.json' },
};

function parseState(value: unknown): ReviewTerminalState {
  if (value !== 'open'
    && value !== 'decision-written'
    && value !== 'approval-written'
    && value !== 'returned'
    && value !== 'corrupt') {
    return invalid('state 不是受支持的审阅终态。');
  }
  return value;
}

function parseRecord(
  value: unknown,
  reviewId: string,
  expected: { action: ReviewTerminalAction; file: ReviewTerminalReceiptFile },
): ReviewTerminalRecord {
  if (!isRecord(value) || !hasExactKeys(value, RECORD_KEYS)) {
    return invalid('record 必须包含精确的终态回执身份。');
  }
  const action = parseAction(value['action']);
  if (action !== expected.action || value['file'] !== expected.file) {
    return invalid('record 与 snapshot.state 的动作或文件不一致。');
  }
  validateReceiptShape(action, value['receipt'], reviewId);
  return {
    action,
    file: expected.file,
    bytes: parseBytes(value['bytes'], 'record.bytes'),
    sha256: parseSha256(value['sha256'], 'record.sha256'),
    receipt: value['receipt'],
  };
}

export function parseReviewTerminalSnapshot(value: unknown): ReviewTerminalSnapshot {
  if (!isRecord(value)) {
    return invalid('审阅终态快照必须是对象。');
  }
  const state = parseState(value['state']);
  const hasRecord = state !== 'open' && state !== 'corrupt';
  if (!hasExactKeys(value, hasRecord ? SNAPSHOT_KEYS_WITH_RECORD : SNAPSHOT_KEYS_WITHOUT_RECORD)) {
    return invalid('审阅终态快照字段与 state 不一致。');
  }
  if (value['protocolVersion'] !== REVIEW_TERMINAL_PROTOCOL_VERSION) {
    return invalid('审阅终态快照协议版本不受支持。');
  }
  const reviewId = parseIdentifier(value['reviewId'], 'reviewId');
  const projectIdentity = parseIdentifier(value['projectIdentity'], 'projectIdentity');
  if (!hasRecord) {
    return {
      protocolVersion: REVIEW_TERMINAL_PROTOCOL_VERSION,
      reviewId,
      projectIdentity,
      state,
    };
  }
  return {
    protocolVersion: REVIEW_TERMINAL_PROTOCOL_VERSION,
    reviewId,
    projectIdentity,
    state,
    record: parseRecord(value['record'], reviewId, RECORD_SHAPE[state]),
  };
}
