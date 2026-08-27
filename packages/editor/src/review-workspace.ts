import {
  approvalFingerprintOf,
  AuthoringOperationError,
  decisionFingerprintOf,
  stableStringify,
  type ComparisonDecisionReceipt,
  type FinalApprovalReceipt,
  type HumanReviewProjection,
  type ReturnRequestReceipt,
  type TextHasher,
} from '@surdet/authoring';
import { canSealDecision } from './review-model.js';

export interface ReviewWorkspaceIdentity {
  reviewVersion: '1.0.0';
  reviewId: string;
  kind: 'comparison' | 'integration-result';
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  planFingerprint?: string;
  integrationChangeId?: string;
  workingRevision?: number;
  payload: {
    relativePath: string;
    bytes: number;
    sha256: string;
  };
}

export interface ReviewDecisionDraft {
  decisionId: string;
  selectedUnitIds: string[];
  conflictResolutions: Array<{
    conflictId: string;
    resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
    chosenUnitId?: string;
  }>;
}

export interface ReviewWorkspaceState {
  rootHandle: FileSystemDirectoryHandle;
  identity: ReviewWorkspaceIdentity;
  projection: HumanReviewProjection;
  decisionDraft: ReviewDecisionDraft;
  selectedReviewObjectRef: string | null;
  projectHandle: FileSystemDirectoryHandle | null;
  officialResultTreeSha256: string | null;
  currentResultTreeSha256: string | null;
  fixtureChanged: boolean;
  receiptStatus: 'none' | 'decision-written' | 'approval-written' | 'returned';
}

export interface ApprovalDraft {
  approvalId: string;
}

export interface ReturnDraft {
  returnId: string;
  reasonCategory: ReturnRequestReceipt['reasonCategory'];
}

const workspaceHashers = new WeakMap<ReviewWorkspaceState, TextHasher>();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identityError(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', message);
}

function formatError(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_FORMAT_UNSUPPORTED', message);
}

function invalidReview(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_DECISION_INVALID', message);
}

async function defaultHasher(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('当前浏览器不支持 SHA-256');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hasherFor(workspace: ReviewWorkspaceState): TextHasher {
  return workspaceHashers.get(workspace) ?? { sha256: defaultHasher };
}

async function readText(handle: FileSystemFileHandle): Promise<{ text: string; bytes: number }> {
  const file = await handle.getFile();
  const text = await file.text();
  return { text, bytes: new TextEncoder().encode(text).byteLength };
}

async function readJson<T>(handle: FileSystemFileHandle, label: string): Promise<{ value: T; text: string; bytes: number }> {
  const data = await readText(handle);
  try {
    return { ...data, value: JSON.parse(data.text) as T };
  } catch {
    throw identityError(`${label} 不是合法 JSON`);
  }
}

async function getFixedFile(
  rootHandle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  const parts = relativePath.split('/');
  if (parts.length !== 2 || parts.some((part) => part.length === 0 || part === '.' || part === '..' || part.includes('\\'))) {
    throw identityError(`review payload 路径不安全：${relativePath}`);
  }
  const directory = await rootHandle.getDirectoryHandle(parts[0]!);
  return directory.getFileHandle(parts[1]!);
}

function parseIdentity(value: unknown, reviewId = 'unknown'): ReviewWorkspaceIdentity {
  if (!record(value)) throw identityError(`review identity 无效：${reviewId}`);
  if (value['reviewVersion'] !== '1.0.0') throw formatError(`不支持的 reviewVersion：${String(value['reviewVersion'] ?? '')}`);
  const kind = value['kind'];
  if (kind !== 'comparison' && kind !== 'integration-result') throw identityError(`review kind 无效：${reviewId}`);
  const payload = value['payload'];
  if (typeof value['reviewId'] !== 'string'
    || value['reviewId'].length === 0
    || typeof value['projectIdentity'] !== 'string'
    || value['projectIdentity'].length === 0
    || typeof value['expectedProjectRevision'] !== 'string'
    || value['expectedProjectRevision'].length === 0
    || typeof value['comparisonFingerprint'] !== 'string'
    || value['comparisonFingerprint'].length === 0
    || !record(payload)
    || typeof payload['relativePath'] !== 'string'
    || typeof payload['bytes'] !== 'number'
    || !Number.isInteger(payload['bytes'])
    || payload['bytes'] < 0
    || typeof payload['sha256'] !== 'string'
    || !/^[0-9a-f]{64}$/.test(payload['sha256'])) {
    throw identityError(`review identity 字段不完整：${reviewId}`);
  }
  const expectedPath = kind === 'comparison' ? 'comparison/review.json' : 'result/review.json';
  if (value['reviewId'] !== reviewId && reviewId !== 'unknown') throw identityError(`reviewId 与 identity 不匹配：${reviewId}`);
  if (payload['relativePath'] !== expectedPath) throw identityError(`review payload relativePath 不匹配：${String(value['reviewId'])}`);
  if (payload['relativePath'].startsWith('/') || payload['relativePath'].includes('\\')) {
    throw identityError(`review payload 不能使用绝对路径：${String(value['reviewId'])}`);
  }
  const optionalString = (key: string): string | undefined => {
    const entry = value[key];
    if (entry === undefined) return undefined;
    if (typeof entry !== 'string' || entry.length === 0) throw identityError(`review identity ${key} 无效：${String(value['reviewId'])}`);
    return entry;
  };
  const workingRevision = value['workingRevision'];
  if (workingRevision !== undefined && (typeof workingRevision !== 'number' || !Number.isInteger(workingRevision) || workingRevision < 0)) {
    throw identityError(`review identity workingRevision 无效：${String(value['reviewId'])}`);
  }
  return {
    reviewVersion: '1.0.0',
    reviewId: value['reviewId'],
    kind,
    projectIdentity: value['projectIdentity'],
    expectedProjectRevision: value['expectedProjectRevision'],
    comparisonFingerprint: value['comparisonFingerprint'],
    ...(optionalString('planFingerprint') === undefined ? {} : { planFingerprint: optionalString('planFingerprint') }),
    ...(optionalString('integrationChangeId') === undefined ? {} : { integrationChangeId: optionalString('integrationChangeId') }),
    ...(workingRevision === undefined ? {} : { workingRevision }),
    payload: {
      relativePath: payload['relativePath'],
      bytes: payload['bytes'],
      sha256: payload['sha256'],
    },
  };
}

function validateProjection(value: unknown, identity: ReviewWorkspaceIdentity): HumanReviewProjection {
  if (!record(value)) throw identityError(`review payload 不是对象：${identity.reviewId}`);
  if (value['reviewVersion'] !== '1.0.0') throw formatError(`不支持的 review payload version：${identity.reviewId}`);
  const sourceIdentity = value['sourceIdentity'];
  if (value['reviewId'] !== identity.reviewId
    || value['kind'] !== identity.kind
    || value['projectIdentity'] !== identity.projectIdentity
    || value['expectedProjectRevision'] !== identity.expectedProjectRevision
    || !record(sourceIdentity)
    || sourceIdentity['comparisonFingerprint'] !== identity.comparisonFingerprint
    || (identity.planFingerprint !== undefined && sourceIdentity['planFingerprint'] !== identity.planFingerprint)) {
    throw identityError(`review payload 与 identity sidecar 不一致：${identity.reviewId}`);
  }
  return value as unknown as HumanReviewProjection;
}

async function optionalJson(rootHandle: FileSystemDirectoryHandle, name: string): Promise<unknown | null> {
  try {
    const handle = await rootHandle.getFileHandle(name);
    return (await readJson<unknown>(handle, name)).value;
  } catch {
    return null;
  }
}

async function writeCreateOnly<T>(
  rootHandle: FileSystemDirectoryHandle,
  name: string,
  value: T,
): Promise<T> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  let target: FileSystemFileHandle | null = null;
  try {
    target = await rootHandle.getFileHandle(name);
  } catch {
    target = null;
  }
  if (target !== null) {
    const existing = await readText(target);
    if (existing.text !== text) throw identityError(`${name} 已存在不同内容`);
    try {
      return JSON.parse(existing.text) as T;
    } catch {
      throw identityError(`${name} 不是合法 JSON`);
    }
  }
  target = await rootHandle.getFileHandle(name, { create: true });
  const raced = await readText(target);
  if (raced.bytes > 0) {
    if (raced.text !== text) throw identityError(`${name} 并发创建后内容不一致`);
    return JSON.parse(raced.text) as T;
  }
  const writable = await target.createWritable();
  await writable.write(text);
  await writable.close();
  const written = await readText(target);
  if (written.text !== text) throw identityError(`${name} 写入回读不一致`);
  return JSON.parse(written.text) as T;
}

function reviewDirectoryState(projection: HumanReviewProjection): ReviewDecisionDraft {
  return {
    decisionId: '',
    selectedUnitIds: projection.safeGroups.flatMap((group) => group.unitIds),
    conflictResolutions: [],
  };
}

function decisionDraftFromReceipt(
  projection: HumanReviewProjection,
  value: unknown,
): ReviewDecisionDraft {
  if (!record(value)
    || typeof value['decisionId'] !== 'string'
    || !Array.isArray(value['selectedUnitIds'])
    || !value['selectedUnitIds'].every((item) => typeof item === 'string')
    || !Array.isArray(value['conflictResolutions'])) {
    return reviewDirectoryState(projection);
  }
  return {
    decisionId: value['decisionId'],
    selectedUnitIds: [...value['selectedUnitIds']] as string[],
    conflictResolutions: value['conflictResolutions'].flatMap((item) => {
      if (!record(item)
        || typeof item['conflictId'] !== 'string'
        || (item['resolution'] !== 'choose-unit'
          && item['resolution'] !== 'exclude-all'
          && item['resolution'] !== 'regenerate-candidate')) return [];
      return [{
        conflictId: item['conflictId'],
        resolution: item['resolution'],
        ...(typeof item['chosenUnitId'] === 'string' ? { chosenUnitId: item['chosenUnitId'] } : {}),
      }];
    }),
  };
}

export async function openReviewWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  hasher: TextHasher = { sha256: defaultHasher },
): Promise<ReviewWorkspaceState> {
  let identityFile: FileSystemFileHandle;
  try {
    identityFile = await rootHandle.getFileHandle('identity.json');
  } catch {
    throw identityError('review workspace 缺少 identity.json');
  }
  const identityRead = await readJson<unknown>(identityFile, 'identity.json');
  const identity = parseIdentity(identityRead.value);
  let payloadFile: FileSystemFileHandle;
  try {
    payloadFile = await getFixedFile(rootHandle, identity.payload.relativePath);
  } catch {
    throw identityError(`review payload 缺失：${identity.reviewId}`);
  }
  const payloadRead = await readJson<unknown>(payloadFile, identity.payload.relativePath);
  const payloadHash = await hasher.sha256(payloadRead.text);
  if (payloadRead.bytes !== identity.payload.bytes || payloadHash !== identity.payload.sha256) {
    throw identityError(`review payload bytes/SHA 与 identity sidecar 不一致：${identity.reviewId}`);
  }
  const projection = validateProjection(payloadRead.value, identity);
  const decision = await optionalJson(rootHandle, 'decision.json');
  const approval = await optionalJson(rootHandle, 'final-approval.json');
  const returned = await optionalJson(rootHandle, 'return-request.json');
  if (approval !== null && returned !== null) throw identityError(`result review 同时存在 approval 与 return request：${identity.reviewId}`);
  if (identity.kind === 'comparison' && (approval !== null || returned !== null)) {
    throw identityError(`comparison review 不能包含 result receipt：${identity.reviewId}`);
  }
  if (identity.kind === 'integration-result' && decision !== null) {
    throw identityError(`result review 不能包含 comparison decision：${identity.reviewId}`);
  }
  let projectHandle: FileSystemDirectoryHandle | null = null;
  if (identity.kind === 'integration-result') {
    try {
      const result = await rootHandle.getDirectoryHandle('result');
      projectHandle = await result.getDirectoryHandle('project');
    } catch {
      projectHandle = null;
    }
  }
  const workspace: ReviewWorkspaceState = {
    rootHandle,
    identity,
    projection,
    decisionDraft: decisionDraftFromReceipt(projection, decision),
    selectedReviewObjectRef: null,
    projectHandle,
    officialResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    currentResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    fixtureChanged: false,
    receiptStatus: identity.kind === 'comparison'
      ? decision !== null ? 'decision-written' : 'none'
      : approval !== null ? 'approval-written' : returned !== null ? 'returned' : 'none',
  };
  workspaceHashers.set(workspace, hasher);
  return workspace;
}

export async function writeDecisionReceipt(
  workspace: ReviewWorkspaceState,
  draft: ReviewDecisionDraft,
  now: string,
): Promise<ComparisonDecisionReceipt> {
  if (workspace.identity.kind !== 'comparison') throw invalidReview('只有 comparison review 可以写入决定');
  if (draft.decisionId.length === 0 || !canSealDecision(workspace.projection, draft)) {
    throw invalidReview('当前审阅不能封存决定');
  }
  const unsigned: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'> = {
    receiptVersion: '1.0.0',
    decisionId: draft.decisionId,
    reviewId: workspace.projection.reviewId,
    comparisonFingerprint: workspace.projection.sourceIdentity.comparisonFingerprint,
    projectIdentity: workspace.projection.projectIdentity,
    expectedProjectRevision: workspace.projection.expectedProjectRevision,
    candidateRefs: workspace.projection.candidates.map((candidate) => ({ ...candidate.ref })),
    selectedUnitIds: [...draft.selectedUnitIds],
    conflictResolutions: draft.conflictResolutions.map((resolution) => ({ ...resolution })),
    reviewerChannel: 'surdet-editor-local',
    decidedAt: now,
  };
  const receipt: ComparisonDecisionReceipt = {
    ...unsigned,
    decisionFingerprint: await decisionFingerprintOf(unsigned, hasherFor(workspace)),
  };
  const written = await writeCreateOnly(workspace.rootHandle, 'decision.json', receipt);
  workspace.decisionDraft = { ...draft, selectedUnitIds: [...draft.selectedUnitIds], conflictResolutions: draft.conflictResolutions.map((item) => ({ ...item })) };
  workspace.receiptStatus = 'decision-written';
  return written;
}

function resultFacts(workspace: ReviewWorkspaceState): {
  finalResult: NonNullable<HumanReviewProjection['finalResult']>;
  decisionFingerprint: string;
} {
  if (workspace.identity.kind !== 'integration-result' || workspace.projection.finalResult === undefined) {
    throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', '当前 review 没有可批准的 integration result');
  }
  const decisionFingerprint = workspace.projection.sourceIdentity.decisionFingerprint;
  if (decisionFingerprint === undefined) throw identityError('result review 缺少 decisionFingerprint');
  return { finalResult: workspace.projection.finalResult, decisionFingerprint };
}

export async function writeApprovalReceipt(
  workspace: ReviewWorkspaceState,
  draft: ApprovalDraft,
  now: string,
): Promise<FinalApprovalReceipt> {
  const { finalResult, decisionFingerprint } = resultFacts(workspace);
  if (draft.approvalId.length === 0) throw invalidReview('approvalId 不能为空');
  if ((await optionalJson(workspace.rootHandle, 'return-request.json')) !== null) {
    throw identityError('result review 已存在 return request');
  }
  const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
    receiptVersion: '1.0.0',
    approvalId: draft.approvalId,
    resultReviewId: workspace.projection.reviewId,
    decisionFingerprint,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    projectIdentity: workspace.projection.projectIdentity,
    expectedProjectRevision: workspace.projection.expectedProjectRevision,
    diffFingerprint: finalResult.diffFingerprint,
    evidence: { ...finalResult.evidence, runtimeTraceIds: [...finalResult.evidence.runtimeTraceIds] },
    resultTreeSha256: finalResult.resultTreeSha256,
    reviewerChannel: 'surdet-editor-local',
    approvedAt: now,
  };
  const receipt: FinalApprovalReceipt = {
    ...unsigned,
    approvalFingerprint: await approvalFingerprintOf(unsigned, hasherFor(workspace)),
  };
  const written = await writeCreateOnly(workspace.rootHandle, 'final-approval.json', receipt);
  workspace.receiptStatus = 'approval-written';
  return written;
}

export async function writeReturnReceipt(
  workspace: ReviewWorkspaceState,
  draft: ReturnDraft,
  now: string,
): Promise<ReturnRequestReceipt> {
  const { finalResult } = resultFacts(workspace);
  if (draft.returnId.length === 0) throw invalidReview('returnId 不能为空');
  if ((await optionalJson(workspace.rootHandle, 'final-approval.json')) !== null) {
    throw identityError('result review 已存在 final approval');
  }
  const unsigned: Omit<ReturnRequestReceipt, 'returnFingerprint'> = {
    receiptVersion: '1.0.0',
    returnId: draft.returnId,
    resultReviewId: workspace.projection.reviewId,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    reasonCategory: draft.reasonCategory,
    reviewerChannel: 'surdet-editor-local',
    returnedAt: now,
  };
  const receipt: ReturnRequestReceipt = {
    ...unsigned,
    returnFingerprint: await hasherFor(workspace).sha256(stableStringify(unsigned)),
  };
  const written = await writeCreateOnly(workspace.rootHandle, 'return-request.json', receipt);
  workspace.receiptStatus = 'returned';
  return written;
}
