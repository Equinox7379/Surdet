import { AuthoringOperationError } from './change-session.js';

export interface ReviewPreparationReference {
  projectIdentity: string;
  reviewId: string;
  reviewPayload: { bytes: number; sha256: string };
  decisionId: string;
  decisionFingerprint: string;
}
export const REVIEW_PREPARATION_STAGES = ['plan', 'compose', 'diff', 'validate', 'simulate', 'run', 'result', 'ready'] as const;
export type ReviewPreparationStage = typeof REVIEW_PREPARATION_STAGES[number];
export interface ReviewPreparationStatus {
  protocolVersion: '1.0.0';
  decision: ReviewPreparationReference;
  started: boolean;
  working: boolean;
  stage: ReviewPreparationStage;
  resultReviewId?: string;
  error?: { code: string; message: string };
}
export type ReviewPreparationRequest = {
  protocolVersion: '1.0.0';
  action: 'inspect-preparation' | 'prepare-result';
  decision: ReviewPreparationReference;
} | {
  protocolVersion: '1.0.0';
  action: 'read-prepared-directory' | 'read-prepared-file';
  decision: ReviewPreparationReference;
  view: 'comparison' | 'result';
  path: string;
};
export type PreparedReviewContent = { kind: 'directory'; entries: { name: string; kind: 'file' | 'directory' }[] }
  | { kind: 'file'; base64: string };

/** One saved decision owns this progress; it is not another decision or approval. */
export interface ReviewPreparationRecord {
  formatVersion: 1;
  decision: ReviewPreparationReference;
  startedAt: string;
  completed: number;
  resultReviewId: string;
  plan?: { planId: string; artifactSha256: string };
  changeId?: string;
  workingRevision?: number;
  error?: { code: string; message: string };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function isReviewPreparationReference(value: unknown): value is ReviewPreparationReference {
  if (!object(value) || !keys(value, ['projectIdentity', 'reviewId', 'reviewPayload', 'decisionId', 'decisionFingerprint'])) return false;
  const payload = value['reviewPayload'];
  return typeof value['projectIdentity'] === 'string' && /^[0-9a-f]{32}$/.test(value['projectIdentity'])
    && id(value['reviewId']) && id(value['decisionId']) && hash(value['decisionFingerprint'])
    && object(payload) && keys(payload, ['bytes', 'sha256']) && Number.isSafeInteger(payload['bytes'])
    && (payload['bytes'] as number) > 0 && hash(payload['sha256']);
}
export function samePreparationReference(a: ReviewPreparationReference, b: ReviewPreparationReference): boolean {
  return a.projectIdentity === b.projectIdentity && a.reviewId === b.reviewId
    && a.decisionId === b.decisionId && a.decisionFingerprint === b.decisionFingerprint
    && a.reviewPayload.bytes === b.reviewPayload.bytes && a.reviewPayload.sha256 === b.reviewPayload.sha256;
}
export function parseReviewPreparationRequest(value: unknown): ReviewPreparationRequest {
  const invalid = () => new AuthoringOperationError('INVALID_REQUEST', '准备结果请求不完整或含有不受支持的字段。');
  if (!object(value) || value['protocolVersion'] !== '1.0.0' || !isReviewPreparationReference(value['decision'])) throw invalid();
  if (value['action'] === 'inspect-preparation' || value['action'] === 'prepare-result') {
    if (!keys(value, ['protocolVersion', 'action', 'decision'])) throw invalid();
  } else if (value['action'] === 'read-prepared-directory' || value['action'] === 'read-prepared-file') {
    if (!keys(value, ['protocolVersion', 'action', 'decision', 'view', 'path'])
      || (value['view'] !== 'comparison' && value['view'] !== 'result') || typeof value['path'] !== 'string'
      || value['path'].length > 2048 || /[\\:\x00-\x1f\x7f]/.test(value['path'])
      || (value['path'] !== '' && value['path'].split('/').some((part) => part === '' || part === '.' || part === '..'))) throw invalid();
  } else throw invalid();
  return { ...value, decision: { ...value['decision'], reviewPayload: { ...value['decision'].reviewPayload } } } as ReviewPreparationRequest;
}
export function isReviewPreparationStatus(value: unknown): value is ReviewPreparationStatus {
  return object(value) && value['protocolVersion'] === '1.0.0' && isReviewPreparationReference(value['decision'])
    && typeof value['started'] === 'boolean' && typeof value['working'] === 'boolean'
    && REVIEW_PREPARATION_STAGES.includes(value['stage'] as ReviewPreparationStage)
    && (value['resultReviewId'] === undefined || id(value['resultReviewId']))
    && (value['stage'] !== 'ready' || id(value['resultReviewId']))
    && (value['error'] === undefined || (object(value['error'])
      && typeof value['error']['code'] === 'string' && typeof value['error']['message'] === 'string'));
}
