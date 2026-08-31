import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  parseReviewTerminalCommand,
  parseReviewTerminalSnapshot,
  validateComparisonDecision,
  validateFinalApproval,
  validateReturnRequest,
  type ComparisonDecisionReceipt,
  type FinalApprovalReceipt,
  type HumanReviewProjection,
  type ResultReviewCurrentFacts,
  type ReviewPayloadIdentity,
  type ReviewTerminalAction,
  type ReviewTerminalCommand,
  type ReviewTerminalRecord,
  type ReviewTerminalSnapshot,
  type TextHasher,
} from '@surdet/authoring';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeReviewStore, type ReviewWorkspaceRead } from './node-review-store.js';
import {
  isComparisonDecisionReceipt,
  isFinalApprovalReceipt,
  parseReviewProjection,
} from './review-service.js';

export interface ReviewTerminalDescribeInput {
  projectIdentity: string;
  reviewId: string;
  reviewPayload: ReviewPayloadIdentity;
}

const DESCRIBE_KEYS = ['projectIdentity', 'reviewId', 'reviewPayload'] as const;
const PAYLOAD_KEYS = ['bytes', 'sha256'] as const;
const SAFE_NAMESPACE = /^[A-Za-z0-9_-]+$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_IDENTIFIER_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function invalid(message: string): never {
  throw new AuthoringOperationError('INVALID_REQUEST', message);
}

function parseSafeNamespace(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_IDENTIFIER_LENGTH
    || !SAFE_NAMESPACE.test(value)
    || WINDOWS_RESERVED.test(value)
    || /[. ]$/.test(value)) {
    return invalid(`${label} 不是安全的本机审阅命名空间标识。`);
  }
  return value;
}

export function parseReviewTerminalDescribeInput(value: unknown): ReviewTerminalDescribeInput {
  if (!isRecord(value) || !exactKeys(value, DESCRIBE_KEYS)) {
    return invalid('审阅终态查询只能包含 projectIdentity、reviewId 与 reviewPayload。');
  }
  if (!isRecord(value['reviewPayload']) || !exactKeys(value['reviewPayload'], PAYLOAD_KEYS)) {
    return invalid('reviewPayload 只能包含 bytes 与 sha256。');
  }
  const bytes = value['reviewPayload']['bytes'];
  const sha256 = value['reviewPayload']['sha256'];
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    return invalid('reviewPayload.bytes 必须是非负安全整数。');
  }
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    return invalid('reviewPayload.sha256 必须是小写 64 位 SHA-256。');
  }
  return {
    projectIdentity: parseSafeNamespace(value['projectIdentity'], 'projectIdentity'),
    reviewId: parseSafeNamespace(value['reviewId'], 'reviewId'),
    reviewPayload: { bytes, sha256 },
  };
}

function defaultHasher(): TextHasher {
  return {
    sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
  };
}

function identityMismatch(message: string): never {
  throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', message);
}

function recordOf(
  action: ReviewTerminalAction,
  file: ReviewTerminalRecord['file'],
  read: { value: unknown; identity: { bytes: number; sha256: string } },
): ReviewTerminalRecord {
  return {
    action,
    file,
    bytes: read.identity.bytes,
    sha256: read.identity.sha256,
    receipt: read.value,
  };
}

function currentFacts(projection: HumanReviewProjection): ResultReviewCurrentFacts {
  const finalResult = projection.finalResult;
  if (finalResult === undefined) {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', 'result review 缺少可批准的最终结果。');
  }
  return {
    projectIdentity: projection.sourceIdentity.projectIdentity,
    projectRevision: projection.expectedProjectRevision,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    diffFingerprint: finalResult.diffFingerprint,
    evidence: finalResult.evidence,
    resultTreeSha256: finalResult.resultTreeSha256,
  };
}

export class ReviewTerminalAuthority {
  readonly dataRoot: string;
  private readonly leases: NodeLocalLeaseManager;
  private readonly hasher: TextHasher;

  constructor(
    dataRoot: string,
    leases?: NodeLocalLeaseManager,
    hasher: TextHasher = defaultHasher(),
  ) {
    this.dataRoot = path.resolve(dataRoot);
    this.leases = leases ?? new NodeLocalLeaseManager(this.dataRoot);
    this.hasher = hasher;
  }

  private storeFor(projectIdentity: string): NodeReviewStore {
    const projectDirectory = path.resolve(this.dataRoot, projectIdentity);
    const relative = path.relative(this.dataRoot, projectDirectory);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      return invalid('projectIdentity 解析结果不在绑定的 Agent data root 内。');
    }
    return new NodeReviewStore(projectDirectory, projectIdentity, this.leases);
  }

  private verifyLoadedReview(
    input: ReviewTerminalDescribeInput,
    loaded: ReviewWorkspaceRead<HumanReviewProjection>,
  ): HumanReviewProjection {
    if (loaded.identity.projectIdentity !== input.projectIdentity
      || loaded.identity.reviewId !== input.reviewId
      || loaded.identity.payload.bytes !== input.reviewPayload.bytes
      || loaded.identity.payload.sha256 !== input.reviewPayload.sha256) {
      return identityMismatch('浏览器中的审阅证据与本机权威工作区身份不一致。');
    }
    const projection = parseReviewProjection(loaded.value, input.reviewId);
    if (projection.projectIdentity !== input.projectIdentity) {
      return identityMismatch('审阅 projection 不属于请求的项目身份。');
    }
    return projection;
  }

  async describe(rawInput: ReviewTerminalDescribeInput | unknown): Promise<ReviewTerminalSnapshot> {
    const input = parseReviewTerminalDescribeInput(rawInput);
    const store = this.storeFor(input.projectIdentity);
    const loaded = await store.readReview<HumanReviewProjection>(input.reviewId);
    const projection = this.verifyLoadedReview(input, loaded);
    const [decision, approval, returned] = await Promise.all([
      store.readDecision<unknown>(input.reviewId),
      store.readFinalApproval<unknown>(input.reviewId),
      store.readReturnRequest<unknown>(input.reviewId),
    ]);
    const present = [decision, approval, returned].filter((item) => item !== null).length;
    const base = {
      protocolVersion: '1.0.0' as const,
      reviewId: input.reviewId,
      projectIdentity: input.projectIdentity,
    };
    if (present === 0) return { ...base, state: 'open' };
    if (present !== 1
      || (projection.kind === 'comparison' && decision === null)
      || (projection.kind === 'integration-result' && decision !== null)) {
      return { ...base, state: 'corrupt' };
    }
    const candidate: ReviewTerminalSnapshot = decision !== null
      ? { ...base, state: 'decision-written', record: recordOf('comparison-decision', 'decision.json', decision) }
      : approval !== null
        ? { ...base, state: 'approval-written', record: recordOf('result-approval', 'final-approval.json', approval) }
        : { ...base, state: 'returned', record: recordOf('result-return', 'return-request.json', returned!) };
    try {
      return parseReviewTerminalSnapshot(candidate);
    } catch (error) {
      if (error instanceof AuthoringOperationError && error.code === 'INVALID_REQUEST') {
        return { ...base, state: 'corrupt' };
      }
      throw error;
    }
  }

  async write(rawCommand: ReviewTerminalCommand | unknown): Promise<ReviewTerminalSnapshot> {
    const command = parseReviewTerminalCommand(rawCommand);
    const input = parseReviewTerminalDescribeInput({
      projectIdentity: command.projectIdentity,
      reviewId: command.reviewId,
      reviewPayload: command.reviewPayload,
    });
    const store = this.storeFor(input.projectIdentity);
    await store.writeTerminal<HumanReviewProjection>(
      input.reviewId,
      command.action,
      command.receipt,
      async (loaded) => {
        const projection = this.verifyLoadedReview(input, loaded);
        if (command.action === 'comparison-decision') {
          if (!isComparisonDecisionReceipt(command.receipt, input.reviewId)) {
            throw new AuthoringOperationError('REVIEW_DECISION_INVALID', '决定回执结构无效。');
          }
          await validateComparisonDecision({
            projection,
            receipt: command.receipt as ComparisonDecisionReceipt,
          }, this.hasher);
          return;
        }
        if (command.action === 'result-approval') {
          if (!isFinalApprovalReceipt(command.receipt, input.reviewId)) {
            throw new AuthoringOperationError('REVIEW_APPROVAL_STALE', '批准回执结构无效。');
          }
          await validateFinalApproval({
            projection,
            receipt: command.receipt as FinalApprovalReceipt,
            current: currentFacts(projection),
          }, this.hasher);
          return;
        }
        await validateReturnRequest({ projection, receipt: command.receipt }, this.hasher);
      },
    );
    return this.describe(input);
  }
}
