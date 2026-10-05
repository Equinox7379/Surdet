import {
  approvalFingerprintOf,
  AuthoringOperationError,
  decisionFingerprintOf,
  decisionFingerprintV2Of,
  isComparisonDecisionReceiptV2,
  isReviewProjectionV2Fields,
  resultReviewFingerprintOf,
  reviewDecisionPreviewFingerprintOf,
  isReviewDecisionPreview,
  stableStringify,
  returnFingerprintOf,
  validateComparisonDecision,
  validateFinalApprovalReceipt,
  validateReturnRequest,
  type ComparisonDecisionReceipt,
  type AnyComparisonDecisionReceipt,
  type ComparisonDecisionReceiptV2,
  type ReviewDecisionIntent,
  type ReviewDecisionPreview,
  type FinalApprovalReceipt,
  type HumanReviewProjection,
  type ReviewTerminalCommand,
  type ReviewTerminalSnapshot,
  type ReturnRequestReceipt,
  type TextHasher,
} from '@surdet/authoring';
import { canSealDecision } from './review-model.js';
import {
  createReviewTerminalClient,
  ReviewAuthorityClientError,
  type ReviewTerminalClient,
} from './review-terminal-client.js';
import { refreshReviewFixtureIdentity } from './review-preview.js';

export interface ReviewWorkspaceIdentity {
  reviewVersion: '1.0.0' | '2.0.0';
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
  decisionIntent?: ReviewDecisionIntent;
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
  decisionReceipt: AnyComparisonDecisionReceipt | null;
  decisionPreview?: {
    selectionKey: string;
    status: 'loading' | 'ready' | 'blocked' | 'error';
    value?: ReviewDecisionPreview;
    message?: string;
  };
  approvalReceipt: FinalApprovalReceipt | null;
  returnReceipt: ReturnRequestReceipt | null;
  authority: {
    state: 'checking' | 'available' | 'submitting' | 'unavailable' | 'mismatch' | 'corrupt' | 'terminal';
    message: string;
  };
}

export interface ApprovalDraft {
  approvalId: string;
}

export interface ReturnDraft {
  returnId: string;
  reasonCategory: ReturnRequestReceipt['reasonCategory'];
}

const workspaceHashers = new WeakMap<ReviewWorkspaceState, TextHasher>();
const workspaceTerminalClients = new WeakMap<ReviewWorkspaceState, ReviewTerminalClient>();
const terminalWrites = new WeakSet<ReviewWorkspaceState>();
const pendingTerminalCommands = new WeakMap<ReviewWorkspaceState, ReviewTerminalCommand>();

const AUTHORITY_AVAILABLE = '本机审阅服务已连接。';
const AUTHORITY_UNAVAILABLE = '本机审阅服务未连接。内容仍可查看，但暂时不能批准或退回。请从 Surdet 正常入口重新打开。';
const AUTHORITY_MISMATCH = '本机审阅服务与当前审阅任务不一致。内容仍可查看，但终态操作已锁定。请从 Surdet 正常入口重新打开。';
const AUTHORITY_CORRUPT = '本机审阅服务检测到审阅回执损坏。内容仍可查看，但终态操作已锁定。';
const AUTHORITY_TERMINAL = '本项审阅已有正式回执，内容可查看，终态操作已锁定。';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identityError(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', message);
}

function formatError(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_FORMAT_UNSUPPORTED', message);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validCapsuleRef(value: unknown): boolean {
  return record(value)
    && nonEmptyString(value['changeId'])
    && nonEmptyString(value['capsuleId'])
    && nonEmptyString(value['artifactSha256']);
}

function validReviewUnitOutcome(value: unknown): boolean {
  if (!record(value)
    || !nonEmptyString(value['unitId'])
    || !nonEmptyString(value['candidateId'])
    || !nonEmptyString(value['primaryObject'])
    || (value['finalFingerprint'] !== undefined && typeof value['finalFingerprint'] !== 'string')
    || !Array.isArray(value['outcomes'])
    || !Array.isArray(value['potentialImpact'])
    || !Array.isArray(value['observedImpact'])
    || !record(value['evidence'])) return false;
  const evidence = value['evidence'];
  return typeof evidence['validation'] === 'string'
    && typeof evidence['simulation'] === 'string'
    && typeof evidence['runtime'] === 'string'
    && typeof evidence['warnings'] === 'number'
    && stringArray(evidence['manualReviewRequired'])
    && value['outcomes'].every((outcome) => record(outcome)
      && nonEmptyString(outcome['objectRef'])
      && nonEmptyString(outcome['disposition'])
      && (outcome['finalFingerprint'] === undefined || typeof outcome['finalFingerprint'] === 'string'));
}

function validateConflictContracts(value: Record<string, unknown>, identity: ReviewWorkspaceIdentity): void {
  const conflicts = value['conflicts'];
  if (!Array.isArray(conflicts)) throw formatError(`review payload conflicts 无效：${identity.reviewId}`);
  for (const conflict of conflicts) {
    if (!record(conflict)
      || !Array.isArray(conflict['options'])
      || !conflict['options'].every(validReviewUnitOutcome)) {
      throw formatError(`review payload conflict options 无效：${identity.reviewId}`);
    }
  }
}

function validateDependencyContracts(value: Record<string, unknown>, identity: ReviewWorkspaceIdentity): void {
  const dependencies = value['dependencies'];
  if (!Array.isArray(dependencies)
    || !dependencies.every((dependency) => record(dependency)
      && nonEmptyString(dependency['fromUnitId'])
      && nonEmptyString(dependency['fromObjectRef'])
      && nonEmptyString(dependency['toUnitId'])
      && nonEmptyString(dependency['objectRef'])
      && (dependency['inclusion'] === 'explicit' || dependency['inclusion'] === 'implicit'))) {
    throw formatError(`review payload dependencies 无效：${identity.reviewId}`);
  }
}

function validateResultPlan(value: unknown, identity: ReviewWorkspaceIdentity): void {
  if (!record(value)) throw formatError(`result review plan 无效：${identity.reviewId}`);
  const arrayKeys = [
    'sourceCapsules',
    'sourceCandidates',
    'selectedUnitIds',
    'includedUnitIds',
    'implicitInclusions',
    'excludedUnitIds',
    'conflictResolutions',
    'deduplicatedUnits',
    'replayOperations',
    'provenance',
  ] as const;
  if (arrayKeys.some((key) => !Array.isArray(value[key]))) {
    throw formatError(`result review plan 字段缺失或类型错误：${identity.reviewId}`);
  }
  const sourceCapsules = value['sourceCapsules'];
  const sourceCandidates = value['sourceCandidates'];
  if (!Array.isArray(sourceCapsules)
    || !Array.isArray(sourceCandidates)
    || !stringArray(value['selectedUnitIds'])
    || !stringArray(value['includedUnitIds'])
    || !stringArray(value['implicitInclusions'])
    || !stringArray(value['excludedUnitIds'])
    || !sourceCapsules.every(validCapsuleRef)
    || !sourceCandidates.every((candidate: unknown) => record(candidate)
      && validCapsuleRef(candidate['ref'])
      && nonEmptyString(candidate['displayOrdinal']))) {
    throw formatError(`result review plan 选择或来源字段无效：${identity.reviewId}`);
  }
  const review = value['review'];
  if (!record(review)
    || review['reviewState'] !== 'human-reviewed'
    || !nonEmptyString(review['reviewId'])
    || !nonEmptyString(review['decisionId'])
    || !nonEmptyString(review['decisionFingerprint'])) {
    throw formatError(`result review plan 审阅绑定无效：${identity.reviewId}`);
  }
  const fingerprints = value['finalObjectFingerprints'];
  if (!record(fingerprints) || Object.values(fingerprints).some((fingerprint) => typeof fingerprint !== 'string')) {
    throw formatError(`result review plan 对象指纹无效：${identity.reviewId}`);
  }
}

function validateResultDiff(value: unknown, identity: ReviewWorkspaceIdentity): void {
  if (!record(value) || !record(value['summary']) || !Array.isArray(value['semantic']) || !Array.isArray(value['files'])) {
    throw formatError(`result review diff 无效：${identity.reviewId}`);
  }
  const summary = value['summary'];
  if (typeof summary['createdScenes'] !== 'number'
    || typeof summary['modifiedScenes'] !== 'number'
    || typeof summary['changedVariables'] !== 'number'
    || !stringArray(summary['warnings'])
    || !value['files'].every((file) => record(file)
      && nonEmptyString(file['path'])
      && typeof file['unifiedDiff'] === 'string'
      && typeof file['unexpectedFormatChange'] === 'boolean')) {
    throw formatError(`result review diff 字段无效：${identity.reviewId}`);
  }
}

function validateResultContracts(value: Record<string, unknown>, identity: ReviewWorkspaceIdentity): void {
  const finalResult = value['finalResult'];
  if (!record(finalResult)) throw formatError(`result review 缺少 finalResult：${identity.reviewId}`);
  validateResultPlan(finalResult['plan'], identity);
  validateResultDiff(finalResult['diff'], identity);
  const freshness = finalResult['freshness'];
  if (!record(freshness)
    || freshness['diff'] !== 'fresh'
    || freshness['validation'] !== 'fresh'
    || freshness['simulation'] !== 'fresh'
    || freshness['runtime'] !== 'fresh') {
    throw formatError(`result review freshness 无效：${identity.reviewId}`);
  }
  const observations = finalResult['runtimeTraceObservations'];
  if (!Array.isArray(observations)
    || !observations.every((observation) => record(observation)
      && nonEmptyString(observation['traceId'])
      && stringArray(observation['observationKeys']))) {
    throw formatError(`result review runtimeTraceObservations 无效：${identity.reviewId}`);
  }
  if (!nonEmptyString(finalResult['planId'])
    || !nonEmptyString(finalResult['planFingerprint'])
    || !nonEmptyString(finalResult['integrationChangeId'])
    || typeof finalResult['workingRevision'] !== 'number'
    || finalResult['planFingerprint'] !== identity.planFingerprint
    || finalResult['integrationChangeId'] !== identity.integrationChangeId
    || finalResult['workingRevision'] !== identity.workingRevision) {
    throw identityError(`result review identity 与 finalResult 不一致：${identity.reviewId}`);
  }
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
  if (value['reviewVersion'] !== '1.0.0' && value['reviewVersion'] !== '2.0.0') throw formatError(`不支持的 reviewVersion：${String(value['reviewVersion'] ?? '')}`);
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
    reviewVersion: value['reviewVersion'],
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
  if (value['reviewVersion'] !== identity.reviewVersion) throw formatError(`review payload version 不匹配：${identity.reviewId}`);
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
  if (!stringArray(value['defaultSelectedUnitIds'])) {
    throw formatError(`review payload defaultSelectedUnitIds 无效：${identity.reviewId}`);
  }
  validateConflictContracts(value, identity);
  validateDependencyContracts(value, identity);
  if (value['reviewVersion'] === '2.0.0' && !isReviewProjectionV2Fields(value)) {
    throw formatError(`review v2 事实或结果身份无效：${identity.reviewId}`);
  }
  if (identity.kind === 'integration-result') {
    if (sourceIdentity['integrationChangeId'] !== identity.integrationChangeId
      || sourceIdentity['workingRevision'] !== identity.workingRevision) {
      throw identityError(`result review source identity 与 identity sidecar 不一致：${identity.reviewId}`);
    }
    validateResultContracts(value, identity);
  }
  return value as unknown as HumanReviewProjection;
}

async function optionalJson(rootHandle: FileSystemDirectoryHandle, name: string): Promise<unknown | null> {
  let handle: FileSystemFileHandle;
  try {
    handle = await rootHandle.getFileHandle(name);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  return (await readJson<unknown>(handle, name)).value;
}

function isNotFoundError(error: unknown): boolean {
  return record(error) && error['name'] === 'NotFoundError';
}

function reviewDirectoryState(projection: HumanReviewProjection): ReviewDecisionDraft {
  return {
    decisionId: '',
    selectedUnitIds: [...projection.defaultSelectedUnitIds],
    conflictResolutions: [],
  };
}

function decisionDraftFromReceipt(value: AnyComparisonDecisionReceipt): ReviewDecisionDraft {
  return {
    decisionId: value.decisionId,
    ...(value.receiptVersion === '2.0.0' ? { decisionIntent: value.decisionIntent } : {}),
    selectedUnitIds: [...value.selectedUnitIds],
    conflictResolutions: value.conflictResolutions.map((item) => ({ ...item })),
  };
}

async function verifiedDecisionReceipt(
  projection: HumanReviewProjection,
  value: unknown,
  hasher: TextHasher,
): Promise<AnyComparisonDecisionReceipt> {
  if (!record(value)) throw formatError(`comparison decision receipt 不是对象：${projection.reviewId}`);
  if (value['receiptVersion'] === '2.0.0' && !isComparisonDecisionReceiptV2(value)) {
    throw formatError(`comparison v2 decision receipt 结构无效：${projection.reviewId}`);
  }
  try {
    const verified = await validateComparisonDecision({
      projection,
      receipt: value as unknown as AnyComparisonDecisionReceipt,
    }, hasher);
    return verified.receipt;
  } catch (error) {
    if (error instanceof AuthoringOperationError) throw error;
    throw formatError(`comparison decision receipt 结构无效：${projection.reviewId}`);
  }
}

function authorityError(code: string, message: string): ReviewAuthorityClientError {
  return new ReviewAuthorityClientError(code, message);
}

function describeInput(workspace: ReviewWorkspaceState) {
  return {
    projectIdentity: workspace.identity.projectIdentity,
    reviewId: workspace.identity.reviewId,
    reviewPayload: {
      bytes: workspace.identity.payload.bytes,
      sha256: workspace.identity.payload.sha256,
    },
  };
}

function terminalClientFor(
  workspace: ReviewWorkspaceState,
  override?: ReviewTerminalClient,
): ReviewTerminalClient {
  const client = override ?? workspaceTerminalClients.get(workspace);
  if (client === undefined) throw authorityError('REVIEW_AUTHORITY_UNAVAILABLE', AUTHORITY_UNAVAILABLE);
  return client;
}

function receiptIdentity(workspace: ReviewWorkspaceState): { action: ReviewTerminalCommand['action']; fingerprint: string } | null {
  if (workspace.decisionReceipt !== null) {
    return { action: 'comparison-decision', fingerprint: workspace.decisionReceipt.decisionFingerprint };
  }
  if (workspace.approvalReceipt !== null) {
    return { action: 'result-approval', fingerprint: workspace.approvalReceipt.approvalFingerprint };
  }
  if (workspace.returnReceipt !== null) {
    return { action: 'result-return', fingerprint: workspace.returnReceipt.returnFingerprint };
  }
  return null;
}

function receiptFingerprint(action: ReviewTerminalCommand['action'], receipt: unknown): string | null {
  if (!record(receipt)) return null;
  const field = action === 'comparison-decision'
    ? 'decisionFingerprint'
    : action === 'result-approval' ? 'approvalFingerprint' : 'returnFingerprint';
  return typeof receipt[field] === 'string' ? receipt[field] : null;
}

async function terminalRecordIdentity(
  workspace: ReviewWorkspaceState,
  receipt: unknown,
): Promise<{ bytes: number; sha256: string }> {
  const json = JSON.stringify(receipt, null, 2);
  if (json === undefined) throw authorityError('REVIEW_FORMAT_UNSUPPORTED', AUTHORITY_CORRUPT);
  const text = `${json}\n`;
  return {
    bytes: new TextEncoder().encode(text).byteLength,
    sha256: await hasherFor(workspace).sha256(text),
  };
}

export function pendingTerminalActionOf(workspace: ReviewWorkspaceState): ReviewTerminalCommand['action'] | null {
  return pendingTerminalCommands.get(workspace)?.action ?? null;
}

export function hasPendingReviewReceipt(workspace: ReviewWorkspaceState | null): boolean {
  return workspace !== null && (pendingTerminalCommands.has(workspace) || terminalWrites.has(workspace));
}

export function hasReviewDraft(workspace: ReviewWorkspaceState | null): boolean {
  if (workspace === null) return false;
  const baseline = workspace.decisionReceipt === null ? reviewDirectoryState(workspace.projection)
    : decisionDraftFromReceipt(workspace.decisionReceipt);
  return JSON.stringify(workspace.decisionDraft) !== JSON.stringify(baseline)
    || hasPendingReviewReceipt(workspace);
}

export function discardReviewDraft(workspace: ReviewWorkspaceState): void {
  if (hasPendingReviewReceipt(workspace)) {
    throw new Error('审阅回执尚未收束，请先完成或恢复这次审阅操作。');
  }
  workspace.decisionDraft = workspace.decisionReceipt === null ? reviewDirectoryState(workspace.projection)
    : decisionDraftFromReceipt(workspace.decisionReceipt);
  delete workspace.decisionPreview;
}

async function reconcileAuthoritySnapshot(
  workspace: ReviewWorkspaceState,
  snapshot: ReviewTerminalSnapshot,
): Promise<void> {
  if (snapshot.reviewId !== workspace.identity.reviewId
    || snapshot.projectIdentity !== workspace.identity.projectIdentity) {
    workspace.authority = { state: 'mismatch', message: AUTHORITY_MISMATCH };
    throw authorityError('REVIEW_IDENTITY_MISMATCH', AUTHORITY_MISMATCH);
  }
  const local = receiptIdentity(workspace);
  if (snapshot.state === 'corrupt') {
    workspace.authority = { state: 'corrupt', message: AUTHORITY_CORRUPT };
    throw authorityError('REVIEW_IDENTITY_MISMATCH', AUTHORITY_CORRUPT);
  }
  if (snapshot.state === 'open') {
    if (local !== null) {
      workspace.authority = { state: 'mismatch', message: AUTHORITY_MISMATCH };
      throw authorityError('REVIEW_IDENTITY_MISMATCH', AUTHORITY_MISMATCH);
    }
    workspace.authority = { state: 'available', message: AUTHORITY_AVAILABLE };
    return;
  }
  const recordValue = snapshot.record;
  if (recordValue === undefined) {
    workspace.authority = { state: 'corrupt', message: AUTHORITY_CORRUPT };
    throw authorityError('REVIEW_IDENTITY_MISMATCH', AUTHORITY_CORRUPT);
  }
  const recordIdentity = await terminalRecordIdentity(workspace, recordValue.receipt);
  if (recordValue.bytes !== recordIdentity.bytes || recordValue.sha256 !== recordIdentity.sha256) {
    workspace.authority = { state: 'corrupt', message: AUTHORITY_CORRUPT };
    throw authorityError('REVIEW_FORMAT_UNSUPPORTED', AUTHORITY_CORRUPT);
  }
  const canonicalFingerprint = receiptFingerprint(recordValue.action, recordValue.receipt);
  if (canonicalFingerprint === null || (local !== null && (
    local.action !== recordValue.action || local.fingerprint !== canonicalFingerprint
  ))) {
    workspace.authority = { state: 'mismatch', message: AUTHORITY_MISMATCH };
    throw authorityError('REVIEW_IDENTITY_MISMATCH', AUTHORITY_MISMATCH);
  }

  try {
    if (snapshot.state === 'decision-written' && recordValue.action === 'comparison-decision'
      && workspace.identity.kind === 'comparison') {
      const receipt = await verifiedDecisionReceipt(workspace.projection, recordValue.receipt, hasherFor(workspace));
      workspace.decisionReceipt = receipt;
      workspace.approvalReceipt = null;
      workspace.returnReceipt = null;
      workspace.decisionDraft = decisionDraftFromReceipt(receipt);
      workspace.receiptStatus = 'decision-written';
    } else if (snapshot.state === 'approval-written' && recordValue.action === 'result-approval'
      && workspace.identity.kind === 'integration-result') {
      const receipt = await validateFinalApprovalReceipt({ projection: workspace.projection, receipt: recordValue.receipt as FinalApprovalReceipt }, hasherFor(workspace));
      workspace.decisionReceipt = null;
      workspace.approvalReceipt = receipt;
      workspace.returnReceipt = null;
      workspace.receiptStatus = 'approval-written';
    } else if (snapshot.state === 'returned' && recordValue.action === 'result-return'
      && workspace.identity.kind === 'integration-result') {
      const receipt = await validateReturnRequest({ projection: workspace.projection, receipt: recordValue.receipt as ReturnRequestReceipt }, hasherFor(workspace));
      workspace.decisionReceipt = null;
      workspace.approvalReceipt = null;
      workspace.returnReceipt = receipt;
      workspace.receiptStatus = 'returned';
    } else {
      workspace.authority = { state: 'mismatch', message: AUTHORITY_MISMATCH };
      throw authorityError('REVIEW_IDENTITY_MISMATCH', AUTHORITY_MISMATCH);
    }
  } catch (error) {
    if (workspace.authority.state === 'mismatch') throw error;
    workspace.authority = { state: 'corrupt', message: AUTHORITY_CORRUPT };
    throw authorityError('REVIEW_FORMAT_UNSUPPORTED', AUTHORITY_CORRUPT);
  }
  workspace.authority = { state: 'terminal', message: AUTHORITY_TERMINAL };
}

function classifyAuthorityFailure(workspace: ReviewWorkspaceState, error: unknown): void {
  if (workspace.authority.state === 'mismatch' || workspace.authority.state === 'corrupt') return;
  const code = record(error) && typeof error['code'] === 'string' ? error['code'] : '';
  if (code === 'REVIEW_IDENTITY_MISMATCH'
    || code === 'REVIEW_NOT_FOUND'
    || code === 'REVIEW_TERMINAL_ALREADY_SET'
    || code === 'REVIEW_RETURNED') {
    workspace.authority = { state: 'mismatch', message: AUTHORITY_MISMATCH };
  } else if (code === 'REVIEW_FORMAT_UNSUPPORTED' || code === 'CHANGE_STORE_CORRUPT' || code === 'LEASE_CORRUPT') {
    workspace.authority = { state: 'corrupt', message: AUTHORITY_CORRUPT };
  } else if (code === 'REVIEW_BUSY'
    || code === 'INVALID_REQUEST'
    || code === 'REVIEW_DECISION_INVALID'
    || code === 'REVIEW_DECISION_STALE'
    || code === 'REVIEW_RESULT_NOT_READY'
    || code === 'REVIEW_APPROVAL_STALE') {
    workspace.authority = { state: 'available', message: AUTHORITY_AVAILABLE };
  } else {
    workspace.authority = { state: 'unavailable', message: AUTHORITY_UNAVAILABLE };
  }
}

function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw authorityError('REVIEW_AUTHORITY_UNAVAILABLE', '当前浏览器不能生成安全的审阅请求 ID。');
  }
  return `review_request_${globalThis.crypto.randomUUID()}`;
}

async function submitTerminalCommand(
  workspace: ReviewWorkspaceState,
  action: ReviewTerminalCommand['action'],
  receipt: unknown,
  terminalClient?: ReviewTerminalClient,
): Promise<{ snapshot: ReviewTerminalSnapshot; command: ReviewTerminalCommand }> {
  if (workspace.authority.state !== 'available') {
    const code = workspace.authority.state === 'unavailable' || workspace.authority.state === 'checking'
      ? 'REVIEW_AUTHORITY_UNAVAILABLE'
      : workspace.authority.state === 'submitting' ? 'REVIEW_BUSY' : 'REVIEW_TERMINAL_ALREADY_SET';
    throw authorityError(code, workspace.authority.message);
  }
  if (terminalWrites.has(workspace)) throw authorityError('REVIEW_BUSY', '另一个保存操作仍在进行，请稍候刷新。');
  const pending = pendingTerminalCommands.get(workspace);
  if (pending !== undefined && pending.action !== action) {
    throw authorityError('REVIEW_BUSY', '上一项正式审阅操作的结果仍未确认，不能改为另一种结果。');
  }
  const command: ReviewTerminalCommand = pending ?? {
    protocolVersion: '1.0.0',
    requestId: newRequestId(),
    projectIdentity: workspace.identity.projectIdentity,
    reviewId: workspace.identity.reviewId,
    reviewPayload: {
      bytes: workspace.identity.payload.bytes,
      sha256: workspace.identity.payload.sha256,
    },
    action,
    receipt,
  };
  pendingTerminalCommands.set(workspace, command);
  terminalWrites.add(workspace);
  workspace.authority = { state: 'submitting', message: '正在保存正式审阅回执…' };
  try {
    const snapshot = await terminalClientFor(workspace, terminalClient).write(command);
    await reconcileAuthoritySnapshot(workspace, snapshot);
    pendingTerminalCommands.delete(workspace);
    return { snapshot, command };
  } catch (error) {
    classifyAuthorityFailure(workspace, error);
    const code = record(error) && typeof error['code'] === 'string' ? error['code'] : '';
    const outcomeIsUncertain = workspace.authority.state === 'unavailable'
      || code === 'REVIEW_BUSY'
      || code === 'REVIEW_AUTHORITY_UNAVAILABLE'
      || code === 'REQUEST_TIMEOUT';
    if (!outcomeIsUncertain) {
      pendingTerminalCommands.delete(workspace);
    }
    throw error;
  } finally {
    terminalWrites.delete(workspace);
    if (workspace.authority.state === 'submitting') {
      workspace.authority = { state: 'available', message: AUTHORITY_AVAILABLE };
    }
  }
}

async function snapshotMatchesCommand(
  workspace: ReviewWorkspaceState,
  snapshot: ReviewTerminalSnapshot,
  command: ReviewTerminalCommand,
): Promise<boolean> {
  if (snapshot.record === undefined || snapshot.record.action !== command.action) return false;
  const expected = await terminalRecordIdentity(workspace, command.receipt);
  return snapshot.record.bytes === expected.bytes && snapshot.record.sha256 === expected.sha256;
}

export async function openReviewWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  hasher: TextHasher = { sha256: defaultHasher },
  terminalClient: ReviewTerminalClient = createReviewTerminalClient(),
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
  if (projection.reviewVersion === '2.0.0' && projection.kind === 'integration-result'
    && projection.reviewFingerprint !== await resultReviewFingerprintOf(projection, hasher)) {
    throw identityError('最终结果说明与审阅身份不一致，无法批准。');
  }
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
  const decisionReceipt = identity.kind === 'comparison' && decision !== null
    ? await verifiedDecisionReceipt(projection, decision, hasher)
    : null;
  const approvalReceipt = identity.kind === 'integration-result' && approval !== null
    ? await validateFinalApprovalReceipt({ projection, receipt: approval }, hasher)
    : null;
  const returnReceipt = identity.kind === 'integration-result' && returned !== null
    ? await validateReturnRequest({ projection, receipt: returned }, hasher)
    : null;
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
    decisionDraft: decisionReceipt === null ? reviewDirectoryState(projection) : decisionDraftFromReceipt(decisionReceipt),
    selectedReviewObjectRef: null,
    projectHandle,
    officialResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    currentResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    fixtureChanged: false,
    receiptStatus: identity.kind === 'comparison'
      ? decisionReceipt !== null ? 'decision-written' : 'none'
      : approvalReceipt !== null ? 'approval-written' : returnReceipt !== null ? 'returned' : 'none',
    decisionReceipt,
    approvalReceipt,
    returnReceipt,
    authority: { state: 'checking', message: '正在连接本机审阅服务…' },
  };
  workspaceHashers.set(workspace, hasher);
  workspaceTerminalClients.set(workspace, terminalClient);
  try {
    const status = await terminalClient.status();
    if (status !== 'available') {
      workspace.authority = { state: 'unavailable', message: AUTHORITY_UNAVAILABLE };
      return workspace;
    }
    const snapshot = await terminalClient.describe(describeInput(workspace));
    await reconcileAuthoritySnapshot(workspace, snapshot);
  } catch (error) {
    classifyAuthorityFailure(workspace, error);
  }
  return workspace;
}

export function reviewDecisionDraftKey(draft: ReviewDecisionDraft): string {
  return stableStringify({
    decisionIntent: draft.decisionIntent,
    selectedUnitIds: [...draft.selectedUnitIds].sort(),
    conflictResolutions: [...draft.conflictResolutions].sort((left, right) => left.conflictId.localeCompare(right.conflictId)),
  });
}

export function canSaveReviewDecision(workspace: ReviewWorkspaceState): boolean {
  if (workspace.projection.reviewVersion === '1.0.0') return canSealDecision(workspace.projection, workspace.decisionDraft);
  if (workspace.receiptStatus !== 'none' || workspace.authority.state !== 'available') return false;
  const preview = workspace.decisionPreview;
  return preview?.status === 'ready' && preview.value?.status === 'ready'
    && preview.selectionKey === reviewDecisionDraftKey(workspace.decisionDraft);
}

const pendingPreviewRequests = new WeakMap<ReviewWorkspaceState, Promise<void>>();

export async function previewReviewDecision(workspace: ReviewWorkspaceState, client?: ReviewTerminalClient): Promise<void> {
  const intent = workspace.decisionDraft.decisionIntent;
  if (workspace.projection.reviewVersion !== '2.0.0' || intent === undefined
    || workspace.receiptStatus !== 'none' || workspace.authority.state !== 'available') throw invalidReview('请先选择一个方案。');
  const previewClient = terminalClientFor(workspace, client);
  if (previewClient.previewDecision === undefined) throw authorityError('REVIEW_PREVIEW_UNAVAILABLE', '请从绑定项目入口打开审阅。');
  const pending: NonNullable<ReviewWorkspaceState['decisionPreview']> = {
    selectionKey: reviewDecisionDraftKey(workspace.decisionDraft), status: 'loading',
  };
  workspace.decisionPreview = pending;
  const previous = pendingPreviewRequests.get(workspace);
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  pendingPreviewRequests.set(workspace, finished);
  try {
    if (previous) await previous;
    if (workspace.decisionPreview !== pending || pending.selectionKey !== reviewDecisionDraftKey(workspace.decisionDraft)) return;
    const preview = await previewClient.previewDecision({ ...describeInput(workspace), decisionIntent: structuredClone(intent),
      ...(intent.mode === 'custom-mix' ? { customSelection: {
        selectedUnitIds: [...workspace.decisionDraft.selectedUnitIds],
        conflictResolutions: workspace.decisionDraft.conflictResolutions.map((item) => ({ ...item })),
      } } : {}),
    });
    if (workspace.decisionPreview !== pending || pending.selectionKey !== reviewDecisionDraftKey(workspace.decisionDraft)) return;
    if (!isReviewDecisionPreview(preview) || preview.reviewId !== workspace.projection.reviewId
      || stableStringify(preview.decisionIntent) !== stableStringify(intent)
      || preview.reviewFingerprint !== workspace.projection.reviewFingerprint
      || preview.comparisonFingerprint !== workspace.projection.sourceIdentity.comparisonFingerprint
      || preview.previewFingerprint !== await reviewDecisionPreviewFingerprintOf(preview, hasherFor(workspace))) {
      throw identityError('预览与当前审阅身份不一致。');
    }
    if (workspace.decisionPreview !== pending || pending.selectionKey !== reviewDecisionDraftKey(workspace.decisionDraft)) return;
    pending.status = preview.status;
    pending.value = preview;
  } catch (error) {
    if (workspace.decisionPreview !== pending || pending.selectionKey !== reviewDecisionDraftKey(workspace.decisionDraft)) return;
    pending.status = 'error';
    const code = error instanceof ReviewAuthorityClientError || error instanceof AuthoringOperationError ? error.code : '';
    const messages: Record<string, string> = {
      PROJECT_BUSY: '项目正在完成其他操作，请稍后重新预览；当前选择已保留。',
      CHANGE_BUSY: '工作变更正在处理，请稍后重新预览；当前选择已保留。',
      REVIEW_BUSY: '审阅正在处理，请稍后重新预览；当前选择已保留。',
      REVIEW_DECISION_STALE: '这份审阅已过期，请打开重新生成的审阅。',
      COMPOSITION_PLAN_STALE: '项目已变化，这份审阅已过期，请打开重新生成的审阅。',
      REVIEW_PREVIEW_UNAVAILABLE: '当前入口没有连接项目，请从绑定项目入口打开审阅。',
      REVIEW_AUTHORITY_UNAVAILABLE: '本机审阅服务未连接，暂时无法预览和保存。',
      COMPOSITION_CONFLICT_UNRESOLVED: '同一内容保留了多个版本，请保留一个版本或全部取消。',
      COMPOSITION_DEPENDENCY_MISSING: '所选内容缺少依赖，无法完成组合。',
    };
    pending.message = messages[code] ?? (error instanceof ReviewAuthorityClientError || error instanceof AuthoringOperationError
      ? error.message : '预览未完成，请重试。');
    throw error;
  } finally {
    release();
    if (pendingPreviewRequests.get(workspace) === finished) pendingPreviewRequests.delete(workspace);
  }
}

export async function writeDecisionReceipt(
  workspace: ReviewWorkspaceState,
  draft: ReviewDecisionDraft,
  now: string,
  terminalClient?: ReviewTerminalClient,
): Promise<AnyComparisonDecisionReceipt> {
  if (workspace.identity.kind !== 'comparison') throw invalidReview('只有 comparison review 可以写入决定');
  if (draft.decisionId.length === 0 || (workspace.projection.reviewVersion === '2.0.0'
    ? !canSaveReviewDecision(workspace) || reviewDecisionDraftKey(draft) !== reviewDecisionDraftKey(workspace.decisionDraft)
    : !canSealDecision(workspace.projection, draft))) {
    throw invalidReview('当前审阅不能封存决定');
  }
  const common = {
    decisionId: draft.decisionId,
    reviewId: workspace.projection.reviewId,
    comparisonFingerprint: workspace.projection.sourceIdentity.comparisonFingerprint,
    projectIdentity: workspace.projection.projectIdentity,
    expectedProjectRevision: workspace.projection.expectedProjectRevision,
    candidateRefs: workspace.projection.candidates.map((candidate) => ({ ...candidate.ref })),
    selectedUnitIds: [...draft.selectedUnitIds],
    conflictResolutions: draft.conflictResolutions.map((resolution) => ({ ...resolution })),
    reviewerChannel: 'surdet-editor-local' as const,
    decidedAt: now,
  };
  let receipt: AnyComparisonDecisionReceipt;
  if (workspace.projection.reviewVersion === '2.0.0') {
    const preview = workspace.decisionPreview!.value!;
    const unsigned: Omit<ComparisonDecisionReceiptV2, 'decisionFingerprint'> = {
      ...common, receiptVersion: '2.0.0', reviewFingerprint: preview.reviewFingerprint,
      decisionIntent: preview.decisionIntent, selectedUnitIds: preview.selectedUnitIds,
      conflictResolutions: preview.conflictResolutions, planContentFingerprint: preview.planContentFingerprint,
      previewFingerprint: preview.previewFingerprint,
    };
    receipt = { ...unsigned, decisionFingerprint: await decisionFingerprintV2Of(unsigned, hasherFor(workspace)) };
    if (!canSaveReviewDecision(workspace) || reviewDecisionDraftKey(draft) !== reviewDecisionDraftKey(workspace.decisionDraft)) {
      throw invalidReview('选择已经改变，请重新查看预览。');
    }
  } else {
    const unsigned = { ...common, receiptVersion: '1.0.0' as const };
    receipt = { ...unsigned, decisionFingerprint: await decisionFingerprintOf(unsigned, hasherFor(workspace)) };
  }
  if (workspace.authority.state === 'terminal'
    && workspace.decisionReceipt?.decisionFingerprint === receipt.decisionFingerprint) {
    return workspace.decisionReceipt;
  }
  const { snapshot, command } = await submitTerminalCommand(workspace, 'comparison-decision', receipt, terminalClient);
  if (snapshot.state !== 'decision-written'
    || workspace.decisionReceipt?.decisionFingerprint !== receiptFingerprint(command.action, command.receipt)
    || !await snapshotMatchesCommand(workspace, snapshot, command)) {
    throw authorityError('REVIEW_TERMINAL_ALREADY_SET', '该审阅已由另一个窗口保存了不同决定，现已显示正式回执。');
  }
  return workspace.decisionReceipt;
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
  terminalClient?: ReviewTerminalClient,
): Promise<FinalApprovalReceipt> {
  const { finalResult, decisionFingerprint } = resultFacts(workspace);
  if (workspace.fixtureChanged) {
    throw new AuthoringOperationError('REVIEW_APPROVAL_STALE', '探索性修改尚未恢复，不能批准正式结果。');
  }
  const resultIdentityBefore = workspace.currentResultTreeSha256;
  if (draft.approvalId.length === 0) throw invalidReview('approvalId 不能为空');
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
  if (workspace.projectHandle !== null && workspace.officialResultTreeSha256 !== null) {
    try {
      await refreshReviewFixtureIdentity(workspace);
    } catch {
      throw new AuthoringOperationError('REVIEW_APPROVAL_STALE', '无法重新核对正式结果，请恢复后重新审阅。');
    }
  }
  if (workspace.fixtureChanged || workspace.currentResultTreeSha256 !== resultIdentityBefore) {
    throw new AuthoringOperationError('REVIEW_APPROVAL_STALE', '正式结果在批准过程中发生变化，请恢复后重新审阅。');
  }
  if (workspace.authority.state === 'terminal'
    && workspace.approvalReceipt?.approvalFingerprint === receipt.approvalFingerprint) {
    return workspace.approvalReceipt;
  }
  const { snapshot, command } = await submitTerminalCommand(workspace, 'result-approval', receipt, terminalClient);
  if (snapshot.state !== 'approval-written'
    || workspace.approvalReceipt?.approvalFingerprint !== receiptFingerprint(command.action, command.receipt)
    || !await snapshotMatchesCommand(workspace, snapshot, command)) {
    throw authorityError('REVIEW_TERMINAL_ALREADY_SET', '该审阅已由另一个窗口形成其他正式结果，现已显示正式回执。');
  }
  return workspace.approvalReceipt;
}

export async function writeReturnReceipt(
  workspace: ReviewWorkspaceState,
  draft: ReturnDraft,
  now: string,
  terminalClient?: ReviewTerminalClient,
): Promise<ReturnRequestReceipt> {
  const { finalResult } = resultFacts(workspace);
  if (draft.returnId.length === 0) throw invalidReview('returnId 不能为空');
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
    returnFingerprint: await returnFingerprintOf(unsigned, hasherFor(workspace)),
  };
  if (workspace.authority.state === 'terminal'
    && workspace.returnReceipt?.returnFingerprint === receipt.returnFingerprint) {
    return workspace.returnReceipt;
  }
  const { snapshot, command } = await submitTerminalCommand(workspace, 'result-return', receipt, terminalClient);
  if (snapshot.state !== 'returned'
    || workspace.returnReceipt?.returnFingerprint !== receiptFingerprint(command.action, command.receipt)
    || !await snapshotMatchesCommand(workspace, snapshot, command)) {
    throw authorityError('REVIEW_TERMINAL_ALREADY_SET', '该审阅已由另一个窗口形成其他正式结果，现已显示正式回执。');
  }
  return workspace.returnReceipt;
}
