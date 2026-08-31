import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AuthoringOperationError,
  parseReviewTerminalCommand,
  type ReviewTerminalCommand,
  type ReviewTerminalSnapshot,
} from '@surdet/authoring';
import {
  parseReviewTerminalDescribeInput,
  type ReviewTerminalDescribeInput,
} from '../authoring/review-terminal-authority.js';

export const REVIEW_AUTHORITY_BASE_PATH = '/__surdet/review-authority/v1' as const;
export const REVIEW_AUTHORITY_TOKEN_HEADER = 'x-surdet-review-authority' as const;
export const REVIEW_AUTHORITY_MAX_BODY_BYTES = 256 * 1024;

export interface ReviewAuthorityHttpTarget {
  describe(input: ReviewTerminalDescribeInput): Promise<ReviewTerminalSnapshot>;
  write(command: ReviewTerminalCommand): Promise<ReviewTerminalSnapshot>;
}

export interface ReviewAuthorityHttpHandlerOptions {
  authority: ReviewAuthorityHttpTarget;
  token: string;
  expectedOrigin(request: IncomingMessage): string | readonly string[];
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
}

class BodyTooLargeError extends Error {}
class BodyTimeoutError extends Error {}

const SAFE_BUSINESS_ERROR_CODES = new Set([
  'INVALID_REQUEST',
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
]);

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  options: { closeConnection?: boolean; afterSend?: () => void } = {},
): void {
  if (response.writableEnded || response.destroyed) return;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(JSON.stringify(body), 'utf8');
  } catch {
    status = 500;
    bytes = Buffer.from(JSON.stringify({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '本机审阅服务暂时无法完成这项请求。' },
    }), 'utf8');
  }
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(bytes.byteLength));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (options.closeConnection) response.setHeader('Connection', 'close');
  response.end(bytes, options.afterSend);
}

function errorCode(error: unknown): string {
  return error instanceof AuthoringOperationError && SAFE_BUSINESS_ERROR_CODES.has(error.code)
    ? error.code
    : 'INTERNAL_ERROR';
}

function statusForError(error: unknown): number {
  if (!(error instanceof AuthoringOperationError)) return 500;
  if (!SAFE_BUSINESS_ERROR_CODES.has(error.code)) return 500;
  if (error.code === 'INVALID_REQUEST' || error.code === 'REVIEW_DECISION_INVALID') return 400;
  if (error.code === 'REVIEW_NOT_FOUND') return 404;
  if (error.code === 'REVIEW_BUSY'
    || error.code === 'REVIEW_TERMINAL_ALREADY_SET'
    || error.code === 'REVIEW_IDENTITY_MISMATCH'
    || error.code === 'REVIEW_DECISION_STALE'
    || error.code === 'REVIEW_APPROVAL_STALE'
    || error.code === 'REVIEW_RESULT_NOT_READY'
    || error.code === 'REVIEW_RETURNED') return 409;
  return 400;
}

function sendBoundaryError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  request.pause();
  sendJson(response, status, { ok: false, error: { code, message } }, {
    closeConnection: true,
  });
}

async function readBody(request: IncomingMessage, maxBodyBytes: number, timeoutMs: number): Promise<string> {
  const contentLength = headerValue(request, 'content-length');
  if (contentLength !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'Content-Length 无效。');
    }
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed)) throw new AuthoringOperationError('INVALID_REQUEST', 'Content-Length 无效。');
    if (parsed > maxBodyBytes) {
      throw new BodyTooLargeError();
    }
  }
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('error', onError);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      request.pause();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBodyBytes) {
        fail(new BodyTooLargeError());
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onAborted = (): void => fail(new AuthoringOperationError('INVALID_REQUEST', '请求正文被中断。'));
    const onError = (error: Error): void => fail(error);
    const timer = setTimeout(() => fail(new BodyTimeoutError()), timeoutMs);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
  });
}

function parseJson(text: string): unknown {
  if (text.length === 0) throw new AuthoringOperationError('INVALID_REQUEST', '请求正文不能为空。');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthoringOperationError('INVALID_REQUEST', '请求正文不是合法 JSON。');
  }
}

export function createReviewAuthorityHttpHandler(
  options: ReviewAuthorityHttpHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const maxBodyBytes = options.maxBodyBytes ?? REVIEW_AUTHORITY_MAX_BODY_BYTES;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(maxBodyBytes)
    || maxBodyBytes <= 0
    || maxBodyBytes > REVIEW_AUTHORITY_MAX_BODY_BYTES) {
    throw new Error(`maxBodyBytes must be between 1 and ${REVIEW_AUTHORITY_MAX_BODY_BYTES}`);
  }
  if (!Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs <= 0 || bodyTimeoutMs > 30_000) {
    throw new Error('bodyTimeoutMs must be between 1 and 30000');
  }
  if (options.token.length < 16) throw new Error('review authority token is too short');

  return (request, response) => {
    void (async () => {
      const route = request.url ?? '';
      const statusRoute = `${REVIEW_AUTHORITY_BASE_PATH}/status`;
      const describeRoute = `${REVIEW_AUTHORITY_BASE_PATH}/describe`;
      const writeRoute = `${REVIEW_AUTHORITY_BASE_PATH}/write`;
      if (route !== statusRoute && route !== describeRoute && route !== writeRoute) {
        sendBoundaryError(request, response, 404, 'NOT_FOUND', '本机审阅服务没有这个入口。');
        return;
      }
      const expectedMethod = route === statusRoute ? 'GET' : 'POST';
      if (request.method !== expectedMethod) {
        response.setHeader('Allow', expectedMethod);
        sendBoundaryError(request, response, 405, 'METHOD_NOT_ALLOWED', '请求方式不受支持。');
        return;
      }
      if (!secureEqual(headerValue(request, REVIEW_AUTHORITY_TOKEN_HEADER), options.token)) {
        sendBoundaryError(request, response, 403, 'REVIEW_AUTHORITY_FORBIDDEN', '本机审阅服务拒绝了这项请求。');
        return;
      }
      if (route === statusRoute) {
        if (headerValue(request, 'content-length') !== undefined || headerValue(request, 'transfer-encoding') !== undefined) {
          sendBoundaryError(request, response, 400, 'INVALID_REQUEST', '状态查询不能携带请求正文。');
          return;
        }
        sendJson(response, 200, {
          ok: true,
          result: { protocolVersion: '1.0.0', status: 'available' },
        });
        return;
      }
      const allowedOrigins = options.expectedOrigin(request);
      const origin = headerValue(request, 'origin');
      const originAllowed = typeof allowedOrigins === 'string'
        ? origin === allowedOrigins
        : allowedOrigins.includes(origin ?? '');
      if (!originAllowed) {
        sendBoundaryError(request, response, 403, 'REVIEW_AUTHORITY_FORBIDDEN', '请求来源与当前 Editor 不一致。');
        return;
      }
      const contentType = headerValue(request, 'content-type') ?? '';
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
        sendBoundaryError(request, response, 415, 'UNSUPPORTED_MEDIA_TYPE', '本机审阅服务只接受 JSON。');
        return;
      }
      const contentEncoding = headerValue(request, 'content-encoding');
      if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== 'identity') {
        sendBoundaryError(request, response, 415, 'UNSUPPORTED_MEDIA_TYPE', '本机审阅服务不接受压缩请求正文。');
        return;
      }
      const body = parseJson(await readBody(request, maxBodyBytes, bodyTimeoutMs));
      const result = route === describeRoute
        ? await options.authority.describe(parseReviewTerminalDescribeInput(body))
        : await options.authority.write(parseReviewTerminalCommand(body));
      sendJson(response, 200, { ok: true, result });
    })().catch((error: unknown) => {
      if (error instanceof BodyTooLargeError) {
        sendBoundaryError(request, response, 413, 'REQUEST_TOO_LARGE', '请求正文超过本机审阅服务允许的大小。');
        return;
      }
      if (error instanceof BodyTimeoutError) {
        sendBoundaryError(request, response, 408, 'REQUEST_TIMEOUT', '请求正文读取超时。');
        return;
      }
      sendBoundaryError(
        request,
        response,
        statusForError(error),
        errorCode(error),
        '本机审阅服务暂时无法完成这项请求。',
      );
    });
  };
}
