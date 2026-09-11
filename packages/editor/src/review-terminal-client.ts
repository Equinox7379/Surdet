import {
  parseReviewTerminalSnapshot,
  isReviewDecisionPreview,
  parseReviewDecisionPreviewCommand,
  stableStringify,
  type ReviewDecisionPreview,
  type ReviewDecisionPreviewCommand,
  type ReviewPayloadIdentity,
  type ReviewTerminalCommand,
  type ReviewTerminalSnapshot,
} from '@surdet/authoring';

const REVIEW_AUTHORITY_PROTOCOL_VERSION = '1.0.0' as const;
const REVIEW_AUTHORITY_UNAVAILABLE = 'REVIEW_AUTHORITY_UNAVAILABLE' as const;
const REVIEW_AUTHORITY_INVALID_RESPONSE = 'REVIEW_AUTHORITY_INVALID_RESPONSE' as const;
const REVIEW_AUTHORITY_TOKEN_HEADER = 'X-Surdet-Review-Authority' as const;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TOKEN_LENGTH = 512;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const BUSINESS_ERROR_CODES = new Set([
  'INVALID_REQUEST',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'REQUEST_TOO_LARGE',
  'REQUEST_TIMEOUT',
  'REVIEW_AUTHORITY_FORBIDDEN',
  'INTERNAL_ERROR',
  'REVIEW_NOT_FOUND',
  'REVIEW_IDENTITY_MISMATCH',
  'REVIEW_FORMAT_UNSUPPORTED',
  'REVIEW_DECISION_REQUIRED',
  'REVIEW_DECISION_INVALID',
  'REVIEW_DECISION_STALE',
  'REVIEW_RESULT_NOT_READY',
  'REVIEW_APPROVAL_REQUIRED',
  'REVIEW_APPROVAL_STALE',
  'REVIEW_RETURNED',
  'REVIEW_BUSY',
  'REVIEW_TERMINAL_ALREADY_SET',
  'CHANGE_STORE_CORRUPT',
  'PATH_OUTSIDE_PROJECT',
  'LEASE_CORRUPT',
  'REVIEW_PREVIEW_UNAVAILABLE',
  'COMPOSITION_PLAN_STALE',
  'COMPOSITION_PLAN_INVALID',
  'COMPOSITION_CONFLICT_UNRESOLVED',
  'COMPOSITION_DEPENDENCY_MISSING',
]);

const TERMINAL_STATES = new Set<ReviewTerminalSnapshot['state']>([
  'decision-written',
  'approval-written',
  'returned',
  'corrupt',
]);

export interface ReviewAuthorityBrowserConfig {
  protocolVersion: typeof REVIEW_AUTHORITY_PROTOCOL_VERSION;
  endpoint: string;
  token: string;
}

export interface ReviewTerminalDescribeInput {
  projectIdentity: string;
  reviewId: string;
  reviewPayload: ReviewPayloadIdentity;
}

export interface ReviewTerminalClient {
  status(): Promise<'available' | 'unavailable'>;
  describe(input: ReviewTerminalDescribeInput): Promise<ReviewTerminalSnapshot>;
  write(command: ReviewTerminalCommand): Promise<ReviewTerminalSnapshot>;
  previewDecision?(command: ReviewDecisionPreviewCommand): Promise<ReviewDecisionPreview>;
}

export interface ReviewTerminalClientOptions {
  /** Pass null to explicitly keep a static/no-authority Editor read-only. */
  configuration?: ReviewAuthorityBrowserConfig | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class ReviewAuthorityClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReviewAuthorityClientError';
    this.code = code;
  }
}

declare global {
  // Vite injects this value into the served Editor document. There is no
  // browser write fallback when the value is absent or malformed.
  // eslint-disable-next-line no-var
  var __SURDET_REVIEW_AUTHORITY__: ReviewAuthorityBrowserConfig | undefined;
}

interface JsonResponse {
  ok: boolean;
  result?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function unavailable(message = '本机审阅服务未连接。'): ReviewAuthorityClientError {
  return new ReviewAuthorityClientError(REVIEW_AUTHORITY_UNAVAILABLE, message);
}

function invalidResponse(message = '本机审阅服务返回了无法识别的结果。'): ReviewAuthorityClientError {
  return new ReviewAuthorityClientError(REVIEW_AUTHORITY_INVALID_RESPONSE, message);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && SAFE_IDENTIFIER.test(value)
    && !CONTROL_CHARACTER.test(value);
}

function isValidPayload(value: unknown): value is ReviewPayloadIdentity {
  return isRecord(value)
    && hasExactKeys(value, ['bytes', 'sha256'])
    && typeof value.bytes === 'number'
    && Number.isSafeInteger(value.bytes)
    && value.bytes >= 0
    && typeof value.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.sha256);
}

function isValidDescribeInput(value: unknown): value is ReviewTerminalDescribeInput {
  return isRecord(value)
    && hasExactKeys(value, ['projectIdentity', 'reviewId', 'reviewPayload'])
    && isSafeIdentifier(value.projectIdentity)
    && isSafeIdentifier(value.reviewId)
    && isValidPayload(value.reviewPayload);
}

function isValidEndpoint(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.endsWith('/')
    && !value.includes('?')
    && !value.includes('#')
    && !value.includes('\\')
    && !/\s/.test(value)
    && !CONTROL_CHARACTER.test(value);
}

function normalizeConfiguration(value: unknown): ReviewAuthorityBrowserConfig | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['endpoint', 'protocolVersion', 'token'])
    || value.protocolVersion !== REVIEW_AUTHORITY_PROTOCOL_VERSION
    || !isValidEndpoint(value.endpoint)
    || typeof value.token !== 'string'
    || value.token.length < 16
    || value.token.length > MAX_TOKEN_LENGTH
    || CONTROL_CHARACTER.test(value.token)
    || /\s/.test(value.token)) {
    return null;
  }
  return {
    protocolVersion: REVIEW_AUTHORITY_PROTOCOL_VERSION,
    endpoint: value.endpoint,
    token: value.token,
  };
}

function readInjectedConfiguration(): ReviewAuthorityBrowserConfig | null {
  try {
    return normalizeConfiguration(globalThis.__SURDET_REVIEW_AUTHORITY__);
  } catch {
    return null;
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_TIMEOUT_MS);
}

function parseErrorEnvelope(body: unknown): ReviewAuthorityClientError {
  if (!isRecord(body)
    || body.ok !== false
    || !hasExactKeys(body, ['error', 'ok'])
    || !isRecord(body.error)
    || !hasExactKeys(body.error, ['code', 'message'])
    || typeof body.error.code !== 'string'
    || typeof body.error.message !== 'string'
    || body.error.message.length === 0
    || body.error.message.length > 2_000
    || CONTROL_CHARACTER.test(body.error.message)
    || (!BUSINESS_ERROR_CODES.has(body.error.code) && body.error.code !== 'INTERNAL_ERROR')) {
    return invalidResponse('本机审阅服务返回了无法识别的错误。');
  }
  return new ReviewAuthorityClientError(body.error.code, body.error.message);
}

function parseStatusResult(value: unknown): 'available' | 'unavailable' {
  if (!isRecord(value)
    || !hasExactKeys(value, ['protocolVersion', 'status'])
    || value.protocolVersion !== REVIEW_AUTHORITY_PROTOCOL_VERSION
    || (value.status !== 'available' && value.status !== 'unavailable')) {
    throw invalidResponse('本机审阅服务返回了无法识别的状态。');
  }
  return value.status;
}

function parseSuccessEnvelope(body: unknown): unknown {
  if (!isRecord(body) || body.ok !== true || !hasExactKeys(body, ['ok', 'result'])) {
    throw invalidResponse();
  }
  return body.result;
}

function parseResponseBody(text: string): JsonResponse {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw invalidResponse('本机审阅服务返回的内容不是合法 JSON。');
  }
  if (!isRecord(body) || typeof body.ok !== 'boolean') throw invalidResponse();
  return body as unknown as JsonResponse;
}

function sameReviewIdentity(left: ReviewTerminalSnapshot, right: ReviewTerminalDescribeInput): boolean {
  return left.projectIdentity === right.projectIdentity && left.reviewId === right.reviewId;
}

function parseSnapshotResult(
  result: unknown,
  expected: ReviewTerminalDescribeInput,
  options: { terminalRequired?: boolean } = {},
): ReviewTerminalSnapshot {
  let snapshot: ReviewTerminalSnapshot;
  try {
    snapshot = parseReviewTerminalSnapshot(result);
  } catch (error) {
    if (error instanceof ReviewAuthorityClientError) throw error;
    throw invalidResponse();
  }
  if (!sameReviewIdentity(snapshot, expected)) {
    throw invalidResponse('本机审阅服务返回了不属于当前审阅任务的结果。');
  }
  if (options.terminalRequired === true && snapshot.state === 'open') {
    throw invalidResponse('本机审阅服务没有返回已保存的终态结果。');
  }
  return snapshot;
}

function describeInputFor(command: ReviewTerminalCommand): ReviewTerminalDescribeInput {
  return {
    projectIdentity: command.projectIdentity,
    reviewId: command.reviewId,
    reviewPayload: command.reviewPayload,
  };
}

function isTerminalSnapshotForCommand(
  snapshot: ReviewTerminalSnapshot,
  command: ReviewTerminalCommand,
): boolean {
  return TERMINAL_STATES.has(snapshot.state)
    && snapshot.projectIdentity === command.projectIdentity
    && snapshot.reviewId === command.reviewId;
}

function isTransportError(error: unknown): boolean {
  return error instanceof ReviewAuthorityClientError && error.code === REVIEW_AUTHORITY_UNAVAILABLE;
}

export function createReviewTerminalClient(
  options: ReviewTerminalClientOptions = {},
): ReviewTerminalClient {
  const configuration = normalizeConfiguration(
    options.configuration === undefined ? readInjectedConfiguration() : options.configuration,
  );
  const fetcher = options.fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  const request = async (suffix: 'status' | 'describe' | 'write' | 'preview-decision', body?: unknown): Promise<unknown> => {
    if (configuration === null || fetcher === null) throw unavailable();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetcher(`${configuration.endpoint}/${suffix}`, {
        method: suffix === 'status' ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          [REVIEW_AUTHORITY_TOKEN_HEADER]: configuration.token,
          ...(suffix === 'status' ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(suffix === 'status' ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const text = await response.text();
      const envelope = parseResponseBody(text);
      if (envelope.ok) {
        if (!response.ok) throw invalidResponse('本机审阅服务返回了无法识别的成功状态。');
        return parseSuccessEnvelope(envelope);
      }
      if (response.ok) throw invalidResponse('本机审阅服务返回了无法识别的错误状态。');
      throw parseErrorEnvelope(envelope);
    } catch (error) {
      if (timedOut || controller.signal.aborted || !(error instanceof ReviewAuthorityClientError)) {
        throw unavailable();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const status = async (): Promise<'available' | 'unavailable'> => {
    if (configuration === null || fetcher === null) return 'unavailable';
    try {
      return parseStatusResult(await request('status'));
    } catch (error) {
      if (isTransportError(error)) return 'unavailable';
      throw error;
    }
  };

  const describe = async (input: ReviewTerminalDescribeInput): Promise<ReviewTerminalSnapshot> => {
    if (!isValidDescribeInput(input)) {
      throw new ReviewAuthorityClientError('INVALID_REQUEST', '审阅终态查询格式无效。');
    }
    const result = await request('describe', input);
    return parseSnapshotResult(parseSuccessEnvelope({ ok: true, result }), input);
  };

  const resolveAfterUncertainWrite = async (
    command: ReviewTerminalCommand,
    originalError: ReviewAuthorityClientError,
  ): Promise<ReviewTerminalSnapshot> => {
    try {
      const snapshot = await describe(describeInputFor(command));
      if (isTerminalSnapshotForCommand(snapshot, command)) return snapshot;
      throw originalError;
    } catch (error) {
      if (error === originalError) throw error;
      if (isTransportError(error)
        && (originalError.code === 'REVIEW_BUSY'
          || originalError.code === 'REVIEW_TERMINAL_ALREADY_SET')) {
        throw originalError;
      }
      throw error;
    }
  };

  const write = async (command: ReviewTerminalCommand): Promise<ReviewTerminalSnapshot> => {
    const input = describeInputFor(command);
    if (!isValidDescribeInput(input)
      || !isRecord(command)
      || !hasExactKeys(command, [
        'action',
        'projectIdentity',
        'protocolVersion',
        'receipt',
        'requestId',
        'reviewId',
        'reviewPayload',
      ])
      || command.protocolVersion !== REVIEW_AUTHORITY_PROTOCOL_VERSION
      || !isSafeIdentifier(command.requestId)
      || (command.action !== 'comparison-decision'
        && command.action !== 'result-approval'
        && command.action !== 'result-return')) {
      throw new ReviewAuthorityClientError('INVALID_REQUEST', '审阅终态命令格式无效。');
    }
    try {
      const result = await request('write', command);
      return parseSnapshotResult(
        parseSuccessEnvelope({ ok: true, result }),
        input,
        { terminalRequired: true },
      );
    } catch (error) {
      if (!(error instanceof ReviewAuthorityClientError)) throw unavailable();
      if (error.code === 'REVIEW_BUSY'
        || error.code === 'REVIEW_TERMINAL_ALREADY_SET'
        || isTransportError(error)) {
        return resolveAfterUncertainWrite(command, error);
      }
      throw error;
    }
  };

  const previewDecision = async (command: ReviewDecisionPreviewCommand): Promise<ReviewDecisionPreview> => {
    parseReviewDecisionPreviewCommand(command);
    const result = await request('preview-decision', command);
    if (!isReviewDecisionPreview(result) || result.reviewId !== command.reviewId
      || stableStringify(result.decisionIntent) !== stableStringify(command.decisionIntent)) throw invalidResponse();
    return result;
  };
  return { status, describe, write, previewDecision };
}
