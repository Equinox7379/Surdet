import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  bindResultReview,
  buildComparisonReviewProjection,
  buildObjectIndex,
  buildResultReviewProjection,
  loadProjectSnapshot,
  openChange,
  reviewTraceObservationKey,
  stableStringify,
  validateComparisonDecision,
  isComparisonDecisionReceiptV2,
  isReviewProjectionV2Fields,
  assertDecisionPlanContentFingerprint,
  validateFinalApproval,
  validateReturnRequest,
  type AuthoringObject,
  type CandidateCapsuleRef,
  type CreativeBriefInput,
  type ChangeDiff,
  type ChangeRecord,
  type AnyComparisonDecisionReceipt,
  type CompositionComparison,
  type FinalApprovalReceipt,
  type HumanReviewProjection,
  type IntegrationPlan,
  type ResultReviewCurrentFacts,
  type ReturnRequestReceipt,
  type RuntimeTraceEvent,
  type TextHasher,
  type VerifiedComparisonDecision,
  type VerifiedReviewApproval,
  type VerifiedCompositionCandidate,
  type ReviewCandidateRuntimeInput,
  type ReviewRuntimeTraceInput,
} from '@surdet/authoring';
import type { CompositionCompareResult, CompositionService } from './composition-service.js';
import { compositionServiceForProject } from './composition-service.js';
import { ChangeRecordProjectStorage } from './working-project-storage.js';
import { NodeChangeStore } from './node-change-store.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { projectIdentityFromRoot } from './project-identity.js';
import {
  NodeReviewStore,
  type ReviewWorkspaceIdentity,
} from './node-review-store.js';

export interface ReviewCompositionSource {
  readonly projectRoot: string;
  readonly projectIdentity: string;
  readonly store?: CompositionService['store'];
  compare(candidateRefs: CandidateCapsuleRef[]): Promise<CompositionCompareResult>;
  currentSnapshot?(): Promise<import('@surdet/authoring').ProjectSnapshot>;
}

export interface PreparedReviewResult {
  reviewId: string;
  projection: HumanReviewProjection;
  identity: ReviewWorkspaceIdentity;
  projectDirectory?: string;
}

export interface VerifiedReturnRequest {
  receipt: ReturnRequestReceipt;
}

type ReviewInspectionResult = VerifiedReviewApproval | VerifiedReturnRequest;

interface FixtureFile {
  relativePath: string;
  bytes: Buffer;
}

const defaultHasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

const GENERATED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'dist']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChangeDiff(value: unknown): value is ChangeDiff {
  if (!isRecord(value) || !isRecord(value['summary'])
    || !Array.isArray(value['semantic']) || !Array.isArray(value['files'])) return false;
  const summary = value['summary'];
  if (typeof summary['createdScenes'] !== 'number' || !Number.isInteger(summary['createdScenes'])
    || typeof summary['modifiedScenes'] !== 'number' || !Number.isInteger(summary['modifiedScenes'])
    || typeof summary['changedVariables'] !== 'number' || !Number.isInteger(summary['changedVariables'])
    || !Array.isArray(summary['warnings'])
    || summary['warnings'].some((warning) => typeof warning !== 'string')) return false;
  if (value['semantic'].some((entry) => !isRecord(entry)
    || typeof entry['kind'] !== 'string'
    || typeof entry['operationId'] !== 'string'
    || !Object.prototype.hasOwnProperty.call(entry, 'directChange')
    || !Array.isArray(entry['potentialImpact'])
    || !Array.isArray(entry['observedImpact'])
    || (entry['objectBefore'] !== undefined && typeof entry['objectBefore'] !== 'string')
    || (entry['objectAfter'] !== undefined && typeof entry['objectAfter'] !== 'string')
    || (entry['fingerprintBefore'] !== undefined && typeof entry['fingerprintBefore'] !== 'string')
    || (entry['fingerprintAfter'] !== undefined && typeof entry['fingerprintAfter'] !== 'string'))) return false;
  return value['files'].every((file) => isRecord(file)
    && typeof file['path'] === 'string'
    && typeof file['unifiedDiff'] === 'string'
    && typeof file['unexpectedFormatChange'] === 'boolean'
    && (file['beforeSha256'] === undefined || typeof file['beforeSha256'] === 'string')
    && (file['afterSha256'] === undefined || typeof file['afterSha256'] === 'string'));
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AuthoringOperationError ? error.code : undefined;
}

function reviewError(code: string, message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError(code, message, details);
}

function newReviewId(prefix: 'comparison' | 'result'): string {
  return `review_${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathError(relativePath: string): AuthoringOperationError {
  return reviewError('PATH_OUTSIDE_PROJECT', `审阅 fixture 路径不安全：${relativePath}`);
}

function assertRelativeFilePath(relativePath: string): void {
  if (relativePath.length === 0
    || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || /^[A-Za-z]:/.test(relativePath)
    || relativePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split('/').some((segment) => segment.startsWith('.surdet-'))) {
    throw pathError(relativePath);
  }
  if (GENERATED_DIRECTORY_NAMES.has(relativePath.split('/')[0]!)) throw pathError(relativePath);
}

async function readSafeProjectTree(rootDirectory: string, rejectGeneratedDirectories: boolean): Promise<FixtureFile[]> {
  const root = await fs.realpath(rootDirectory);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw pathError('.');
  const files: FixtureFile[] = [];

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!rejectGeneratedDirectories && GENERATED_DIRECTORY_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith('.surdet-')) {
        if (rejectGeneratedDirectories) throw pathError(relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`);
        continue;
      }
      const absolute = path.join(directory, entry.name);
      const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw pathError(relativePath);
      const real = await fs.realpath(absolute).catch(() => '');
      if (real === '' || !isInside(root, real) || !samePath(real, absolute)) throw pathError(relativePath);
      if (stat.isDirectory()) {
        await visit(absolute, relativePath);
      } else if (stat.isFile()) {
        assertRelativeFilePath(relativePath);
        files.push({ relativePath, bytes: await fs.readFile(absolute) });
      } else {
        throw pathError(relativePath);
      }
    }
  };

  await visit(root, '');
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function treeIdentityInput(files: readonly FixtureFile[]): Array<{ path: string; bytes: number; sha256: string }> {
  return [...files]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((file) => ({
      path: file.relativePath,
      bytes: file.bytes.byteLength,
      sha256: crypto.createHash('sha256').update(file.bytes).digest('hex'),
  }));
}

function treeIdentityOf(files: readonly FixtureFile[]): string {
  return crypto.createHash('sha256')
    .update(Buffer.from(stableStringify(treeIdentityInput(files)), 'utf8'))
    .digest('hex');
}

export async function hashProjectTree(directory: string): Promise<string> {
  const files = await readSafeProjectTree(directory, true);
  return treeIdentityOf(files);
}

function isReviewRuntimeEvent(value: unknown): value is RuntimeTraceEvent {
  if (!isRecord(value) || reviewTraceObservationKey(value) === undefined
    || !['instruction', 'choice', 'state', 'condition', 'control-flow', 'scene-end'].includes(String(value['kind']))) return false;
  const scalar = (item: unknown): boolean => item === undefined || typeof item === 'string'
    || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
  const choice = value['choice'];
  const condition = value['condition'];
  const flow = value['controlFlow'];
  return (choice === undefined || (isRecord(choice) && Number.isInteger(choice['optionIndex'])
      && Number(choice['optionIndex']) >= 0 && typeof choice['label'] === 'string'))
    && (condition === undefined || (isRecord(condition) && typeof condition['expression'] === 'string'
      && typeof condition['result'] === 'boolean'))
    && (flow === undefined || (isRecord(flow) && typeof flow['from'] === 'string' && typeof flow['to'] === 'string'))
    && (value['stateDelta'] === undefined || (Array.isArray(value['stateDelta'])
      && value['stateDelta'].every((delta) => isRecord(delta) && typeof delta['variable'] === 'string'
        && scalar(delta['before']) && scalar(delta['after']))));
}

export function parseReviewProjection(value: unknown, reviewId: string): HumanReviewProjection {
  const states = new Set([
    'COMPARISON_PREPARED', 'DECISION_DRAFT', 'DECIDED', 'PLAN_PREPARED', 'STAGE_READY',
    'OWNER_APPROVED', 'APPLY_PENDING', 'COMMITTED', 'RETURNED', 'STALE', 'INVALID',
  ]);
  const stringArray = (candidate: unknown): candidate is string[] =>
    Array.isArray(candidate) && candidate.every((item) => typeof item === 'string');
  if (!isRecord(value)
    || (value['reviewVersion'] !== '1.0.0' && value['reviewVersion'] !== '2.0.0')
    || value['reviewId'] !== reviewId
    || (value['kind'] !== 'comparison' && value['kind'] !== 'integration-result')
    || typeof value['state'] !== 'string'
    || !states.has(value['state'])
    || typeof value['projectIdentity'] !== 'string'
    || typeof value['expectedProjectRevision'] !== 'string'
    || !isRecord(value['sourceIdentity'])
    || typeof value['sourceIdentity']['projectIdentity'] !== 'string'
    || typeof value['sourceIdentity']['expectedProjectRevision'] !== 'string'
    || typeof value['sourceIdentity']['comparisonFingerprint'] !== 'string'
    || !isRecord(value['task'])
    || !Array.isArray(value['candidates'])
    || value['candidates'].some((candidate) => !isRecord(candidate)
      || !isRecord(candidate['ref'])
      || typeof candidate['ref']['changeId'] !== 'string'
      || typeof candidate['ref']['capsuleId'] !== 'string'
      || typeof candidate['ref']['artifactSha256'] !== 'string')
    || !Array.isArray(value['safeGroups'])
    || !Array.isArray(value['conflicts'])
    || value['conflicts'].some((conflict) => !isRecord(conflict)
      || typeof conflict['conflictId'] !== 'string'
      || typeof conflict['severity'] !== 'string'
      || !stringArray(conflict['unitIds'])
      || !stringArray(conflict['allowedResolutions']))
    || !Array.isArray(value['dependencies'])
    || !stringArray(value['defaultSelectedUnitIds'])
    || !isRecord(value['evidence'])
    || typeof value['evidence']['canCreateDecision'] !== 'boolean'
    || !Array.isArray(value['objects'])) {
    throw reviewError('REVIEW_IDENTITY_MISMATCH', `review projection 身份无效：${reviewId}`);
  }
  if (value['finalResult'] !== undefined) {
    const finalResult = value['finalResult'];
    if (!isRecord(finalResult)
      || typeof finalResult['planId'] !== 'string'
      || typeof finalResult['planFingerprint'] !== 'string'
      || typeof finalResult['integrationChangeId'] !== 'string'
      || typeof finalResult['workingRevision'] !== 'number'
      || !Number.isInteger(finalResult['workingRevision'])
      || typeof finalResult['diffFingerprint'] !== 'string'
      || !isRecord(finalResult['evidence'])
      || typeof finalResult['evidence']['diffEvidenceId'] !== 'string'
      || typeof finalResult['evidence']['validationEvidenceId'] !== 'string'
      || typeof finalResult['evidence']['simulationEvidenceId'] !== 'string'
      || !stringArray(finalResult['evidence']['runtimeTraceIds'])
      || typeof finalResult['resultTreeSha256'] !== 'string') {
      throw reviewError('REVIEW_IDENTITY_MISMATCH', `review projection 最终结果身份无效：${reviewId}`);
    }
  }
  if (value['reviewVersion'] === '2.0.0' && !isReviewProjectionV2Fields(value)) {
    throw reviewError('REVIEW_IDENTITY_MISMATCH', `review v2 事实或结果身份无效：${reviewId}`);
  }
  return value as unknown as HumanReviewProjection;
}

export function isComparisonDecisionReceipt(value: unknown, reviewId: string): value is AnyComparisonDecisionReceipt {
  if (isComparisonDecisionReceiptV2(value)) return value.reviewId === reviewId;
  if (!isRecord(value)
    || value['receiptVersion'] !== '1.0.0'
    || typeof value['decisionId'] !== 'string'
    || typeof value['reviewId'] !== 'string'
    || value['reviewId'] !== reviewId
    || typeof value['comparisonFingerprint'] !== 'string'
    || typeof value['projectIdentity'] !== 'string'
    || typeof value['expectedProjectRevision'] !== 'string'
    || !Array.isArray(value['candidateRefs'])
    || !Array.isArray(value['selectedUnitIds'])
    || !Array.isArray(value['conflictResolutions'])
    || value['reviewerChannel'] !== 'surdet-editor-local'
    || typeof value['decidedAt'] !== 'string'
    || typeof value['decisionFingerprint'] !== 'string') return false;
  if (value['candidateRefs'].some((item) => !isRecord(item)
    || typeof item['changeId'] !== 'string'
    || typeof item['capsuleId'] !== 'string'
    || typeof item['artifactSha256'] !== 'string')) return false;
  if (value['selectedUnitIds'].some((item) => typeof item !== 'string')) return false;
  return !value['conflictResolutions'].some((item) => !isRecord(item)
    || typeof item['conflictId'] !== 'string'
    || typeof item['resolution'] !== 'string'
    || (item['chosenUnitId'] !== undefined && typeof item['chosenUnitId'] !== 'string'));
}

export function isFinalApprovalReceipt(value: unknown, resultReviewId: string): value is FinalApprovalReceipt {
  if (!isRecord(value)
    || value['receiptVersion'] !== '1.0.0'
    || typeof value['approvalId'] !== 'string'
    || typeof value['resultReviewId'] !== 'string'
    || value['resultReviewId'] !== resultReviewId
    || typeof value['decisionFingerprint'] !== 'string'
    || typeof value['planId'] !== 'string'
    || typeof value['planFingerprint'] !== 'string'
    || typeof value['integrationChangeId'] !== 'string'
    || typeof value['workingRevision'] !== 'number'
    || !Number.isInteger(value['workingRevision'])
    || typeof value['projectIdentity'] !== 'string'
    || typeof value['expectedProjectRevision'] !== 'string'
    || typeof value['diffFingerprint'] !== 'string'
    || !isRecord(value['evidence'])
    || typeof value['resultTreeSha256'] !== 'string'
    || value['reviewerChannel'] !== 'surdet-editor-local'
    || typeof value['approvedAt'] !== 'string'
    || typeof value['approvalFingerprint'] !== 'string') return false;
  const evidence = value['evidence'];
  return typeof evidence['diffEvidenceId'] === 'string'
    && typeof evidence['validationEvidenceId'] === 'string'
    && typeof evidence['simulationEvidenceId'] === 'string'
    && Array.isArray(evidence['runtimeTraceIds'])
    && evidence['runtimeTraceIds'].every((item) => typeof item === 'string');
}

function diffImpactsForRef(diff: unknown, ref: string): { potentialImpact: unknown[]; observedImpact: unknown[] } {
  if (!isRecord(diff) || !Array.isArray(diff['semantic'])) {
    return { potentialImpact: [], observedImpact: [] };
  }
  const potentialImpact: unknown[] = [];
  const observedImpact: unknown[] = [];
  for (const entry of diff['semantic']) {
    if (!isRecord(entry) || (entry['objectBefore'] !== ref && entry['objectAfter'] !== ref)) continue;
    if (Array.isArray(entry['potentialImpact'])) potentialImpact.push(...entry['potentialImpact']);
    if (Array.isArray(entry['observedImpact'])) observedImpact.push(...entry['observedImpact']);
  }
  return { potentialImpact, observedImpact };
}

function objectSummary(ref: string, object: AuthoringObject | undefined, diff: unknown) {
  const impacts = diffImpactsForRef(diff, ref);
  if (object === undefined) {
    return {
      objectRef: ref,
      kind: ref.split(':', 1)[0] ?? 'object',
      references: [],
      referencedBy: [],
      potentialImpact: impacts.potentialImpact,
      observedImpact: impacts.observedImpact,
    };
  }
  return {
    objectRef: object.objectRef,
    kind: object.kind,
    ...(object.semanticId === undefined ? {} : { semanticId: object.semanticId }),
    ...(object.source === undefined ? {} : { source: { path: object.source.path, line: object.source.line, col: object.source.col } }),
    references: [...object.references],
    referencedBy: [...object.referencedBy],
    potentialImpact: impacts.potentialImpact,
    observedImpact: impacts.observedImpact,
  };
}

async function runtimeTraceObservationsOf(store: NodeChangeStore, record: ChangeRecord) {
  const summaries = [...(record.runtimeTraces ?? [])]
    .sort((left, right) => left.traceId.localeCompare(right.traceId));
  const traces: ReviewRuntimeTraceInput[] = [];
  const observations = await Promise.all(summaries.map(async (summary) => {
    const trace = await store.readTrace(record.changeId, summary.traceId);
    if (!isRecord(trace) || trace['traceId'] !== summary.traceId
      || trace['changeId'] !== record.changeId || trace['projectRevision'] !== record.baseRevision
      || (trace['workingRevision'] !== undefined && trace['workingRevision'] !== record.workingRevision)
      || !Array.isArray(trace['events']) || !trace['events'].every(isReviewRuntimeEvent)) {
      throw reviewError('REVIEW_RESULT_NOT_READY', `runtime trace 记录缺失或结构无效：${summary.traceId}`, {
        changeId: record.changeId,
        traceId: summary.traceId,
      });
    }
    traces.push({ sourceChangeId: record.changeId, sourceWorkingRevision: summary.workingRevision,
      traceId: summary.traceId, status: summary.status, events: trace['events'] });
    const observationKeys = trace['events'].map((event) => reviewTraceObservationKey(event));
    if (observationKeys.some((key) => key === undefined)) {
      throw reviewError('REVIEW_RESULT_NOT_READY', `runtime trace 含不可比较事件：${summary.traceId}`, {
        changeId: record.changeId,
        traceId: summary.traceId,
      });
    }
    return {
      traceId: summary.traceId,
      observationKeys: [...new Set(observationKeys as string[])].sort((left, right) => left.localeCompare(right)),
    };
  }));
  return { observations, traces: traces.sort((left, right) => left.traceId.localeCompare(right.traceId)) };
}

function evidenceOf(record: ChangeRecord): ResultReviewCurrentFacts['evidence'] {
  const diffEvidenceId = record.latestDiff?.evidenceId;
  const validationEvidenceId = record.latestValidation?.evidenceId;
  const simulationEvidenceId = record.latestSimulation?.evidenceId;
  const traces = record.runtimeTraces ?? [];
  if (diffEvidenceId === undefined || validationEvidenceId === undefined || simulationEvidenceId === undefined
    || record.latestDiff?.workingRevision !== record.workingRevision
    || record.latestValidation?.workingRevision !== record.workingRevision
    || record.latestValidation.errors !== 0
    || record.latestSimulation?.workingRevision !== record.workingRevision
    || record.latestSimulation.status !== 'passed'
    || traces.length === 0
    || traces.some((trace) => trace.status !== 'passed' || trace.workingRevision !== record.workingRevision)) {
    throw reviewError('REVIEW_APPROVAL_STALE', '当前 integration evidence 已变化或不完整');
  }
  return {
    diffEvidenceId,
    validationEvidenceId,
    simulationEvidenceId,
    runtimeTraceIds: traces.map((trace) => trace.traceId).sort((left, right) => left.localeCompare(right)),
  };
}

function compareRecordFiles(record: ChangeRecord, snapshot: import('@surdet/authoring').ProjectSnapshot): boolean {
  const actual = new Map(snapshot.files.map((file) => [file.path, file.sha256]));
  const expected = Object.fromEntries(Object.entries(record.baseFiles).map(([file, identity]) => [file, identity.sha256]));
  const keys = [...new Set([...actual.keys(), ...Object.keys(expected)])].sort((left, right) => left.localeCompare(right));
  return keys.every((file) => actual.get(file) === expected[file]) && record.baseRevision === snapshot.revision;
}

export class ReviewService {
  private readonly hasher: TextHasher;
  private readonly leases: NodeLocalLeaseManager;

  constructor(
    readonly reviews: NodeReviewStore,
    readonly composition: ReviewCompositionSource,
    hasher: TextHasher = defaultHasher,
    leases?: NodeLocalLeaseManager,
  ) {
    this.hasher = hasher;
    this.leases = leases ?? new NodeLocalLeaseManager(path.dirname(reviews.projectDirectory));
  }

  private async candidateRuntime(candidate: VerifiedCompositionCandidate): Promise<ReviewCandidateRuntimeInput> {
    const result: ReviewCandidateRuntimeInput = {
      status: 'unavailable', sourceChangeId: candidate.ref.changeId,
      sourceWorkingRevision: candidate.sourceWorkingRevision, traces: [], limitations: [],
    };
    const sealedIds = new Set(candidate.sealedRuntimeTraceIds ?? []);
    if (sealedIds.size === 0) {
      result.limitations.push('封存候选没有可核对的运行轨迹引用。');
      return result;
    }
    const opened = await NodeChangeStore.openByChangeId(candidate.ref.changeId, path.dirname(this.reviews.projectDirectory));
    if (opened === null || projectIdentityFromRoot(opened.record.projectRootIdentity) !== candidate.projectIdentity
      || opened.record.baseRevision !== candidate.baseProjectRevision) {
      throw reviewError('REVIEW_IDENTITY_MISMATCH', '候选运行来源与封存项目身份不一致。');
    }
    const summaries = (opened.record.runtimeTraces ?? []).filter((summary) => sealedIds.has(summary.traceId)
      && summary.workingRevision === candidate.sourceWorkingRevision && summary.status === 'passed');
    for (const summary of summaries) {
      let trace: unknown;
      try {
        trace = await opened.store.readTrace(candidate.ref.changeId, summary.traceId);
      } catch (error) {
        if (codeOf(error) !== 'CHANGE_STORE_CORRUPT') throw error;
        result.limitations.push(`封存运行轨迹 ${summary.traceId} 无法读取，未展示其内容。`);
        continue;
      }
      if (!isRecord(trace) || trace['traceId'] !== summary.traceId || trace['changeId'] !== candidate.ref.changeId
        || trace['projectRevision'] !== candidate.baseProjectRevision
        || (trace['workingRevision'] !== undefined && trace['workingRevision'] !== candidate.sourceWorkingRevision)
        || !Array.isArray(trace['events']) || !trace['events'].every(isReviewRuntimeEvent)) {
        result.limitations.push(`封存运行轨迹 ${summary.traceId} 无法核对，未展示其内容。`);
        continue;
      }
      result.traces.push({ traceId: summary.traceId, status: 'passed', events: trace['events'] });
    }
    result.status = result.traces.length > 0 ? 'available' : 'unavailable';
    if (result.status === 'unavailable' && result.limitations.length === 0) {
      result.limitations.push('没有与封存工作版本一致且通过的运行轨迹。');
    }
    return result;
  }

  async prepareComparison(input: { candidateRefs: CandidateCapsuleRef[]; creativeBrief?: CreativeBriefInput }): Promise<PreparedReviewResult> {
    const compared = await this.composition.compare([...input.candidateRefs]);
    const objects = this.composition.currentSnapshot === undefined
      ? []
      : buildObjectIndex(await this.composition.currentSnapshot()).objects;
    const candidates = await Promise.all(compared.candidates.map(async (candidate) => ({
      candidateId: candidate.candidateId,
      ref: candidate.ref,
      evidenceSummary: candidate.evidenceSummary,
      manifest: candidate.composition.manifest,
      ...(candidate.intent === undefined ? {} : { intent: candidate.intent }),
      acceptanceCriteria: candidate.acceptanceCriteria ?? [],
      sealedRuntimeTraceIds: candidate.sealedRuntimeTraceIds ?? [],
      sourceWorkingRevision: candidate.sourceWorkingRevision,
      ...(candidate.objectDiffFreshness === undefined ? {} : { objectDiffFreshness: candidate.objectDiffFreshness }),
      sealedFileDiffs: candidate.sealedFileDiffs ?? [],
      runtime: await this.candidateRuntime(candidate),
    })));
    const reviewId = newReviewId('comparison');
    const projection = await buildComparisonReviewProjection({
      reviewId,
      reviewVersion: '2.0.0',
      ...(input.creativeBrief === undefined ? {} : { creativeBrief: input.creativeBrief }),
      comparison: compared.comparison as CompositionComparison,
      candidates,
      objects,
    }, this.hasher);
    const identity = await this.reviews.createReview(reviewId, projection);
    return { reviewId, projection, identity, projectDirectory: this.reviews.projectDirectory };
  }

  private async readReview<T>(reviewId: string): Promise<{ value: T; identity: ReviewWorkspaceIdentity; reviewDirectory: string }> {
    try {
      return await this.reviews.readReview<T>(reviewId);
    } catch (error) {
      if (codeOf(error) === 'OBJECT_NOT_FOUND') throw reviewError('REVIEW_NOT_FOUND', `review workspace 不存在：${reviewId}`, { reviewId });
      throw error;
    }
  }

  private async assertFreshComparison(projection: HumanReviewProjection): Promise<void> {
    const current = await this.composition.compare(projection.candidates.map((candidate) => candidate.ref));
    if (current.comparison.projectIdentity !== projection.sourceIdentity.projectIdentity
      || current.comparison.expectedProjectRevision !== projection.sourceIdentity.expectedProjectRevision
      || current.comparison.comparisonFingerprint !== projection.sourceIdentity.comparisonFingerprint) {
      throw reviewError('REVIEW_DECISION_STALE', '当前 comparison 已离开审阅工作区的 project/revision/fingerprint 基线', {
        reviewId: projection.reviewId,
      });
    }
  }

  async inspectDecision(input: { reviewId: string; decisionId?: string }): Promise<VerifiedComparisonDecision> {
    const loaded = await this.readReview<HumanReviewProjection>(input.reviewId);
    const projection = parseReviewProjection(loaded.value, input.reviewId);
    if (projection.kind !== 'comparison') throw reviewError('REVIEW_IDENTITY_MISMATCH', `review 不是 comparison：${input.reviewId}`);
    await this.assertFreshComparison(projection);
    const decision = await this.reviews.readDecision<unknown>(input.reviewId);
    if (decision === null) throw reviewError('REVIEW_DECISION_REQUIRED', `review 尚未收到人类决定：${input.reviewId}`, { reviewId: input.reviewId });
    if (!isComparisonDecisionReceipt(decision.value, input.reviewId)) {
      throw reviewError('REVIEW_DECISION_INVALID', `决定回执结构无效：${input.reviewId}`, { reviewId: input.reviewId });
    }
    if (input.decisionId !== undefined && input.decisionId !== decision.value.decisionId) {
      throw reviewError('REVIEW_IDENTITY_MISMATCH', `decisionId 与 review receipt 不匹配：${input.reviewId}`, { reviewId: input.reviewId });
    }
    return validateComparisonDecision({ projection, receipt: decision.value }, this.hasher);
  }

  private async projectObjects(record: ChangeRecord, plan: IntegrationPlan, diff: unknown): Promise<ReturnType<typeof objectSummary>[]> {
    const semanticRefs = isRecord(diff) && Array.isArray(diff['semantic'])
      ? diff['semantic'].flatMap((entry) => (
        isRecord(entry)
          ? [entry['objectBefore'], entry['objectAfter']].filter((ref): ref is string => typeof ref === 'string')
          : []
      ))
      : [];
    try {
      const working = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'working'), this.hasher);
      const index = buildObjectIndex(working);
      const refs = [...new Set([
        ...plan.provenance.map((entry) => entry.targetObject),
        ...Object.keys(plan.dryRun.finalObjectFingerprints),
        ...semanticRefs,
      ])].sort((left, right) => left.localeCompare(right));
      return refs.map((ref) => objectSummary(ref, index.byRef.get(ref), diff));
    } catch {
      return [...new Set([
        ...plan.provenance.map((entry) => entry.targetObject),
        ...Object.keys(plan.dryRun.finalObjectFingerprints),
        ...semanticRefs,
      ])]
        .sort((left, right) => left.localeCompare(right))
        .map((ref) => objectSummary(ref, undefined, diff));
    }
  }

  private async fixtureFiles(storage: NodeProjectStorage, record: ChangeRecord): Promise<FixtureFile[]> {
    const files = new Map((await readSafeProjectTree(storage.rootIdentity, false)).map((file) => [file.relativePath, file.bytes]));
    for (const relativePath of Object.keys(record.baseContents)) {
      assertRelativeFilePath(relativePath);
      if (!Object.prototype.hasOwnProperty.call(record.workingFiles, relativePath)) files.delete(relativePath);
    }
    for (const [relativePath, text] of Object.entries(record.workingFiles)) {
      assertRelativeFilePath(relativePath);
      if (typeof text !== 'string') throw reviewError('REVIEW_RESULT_NOT_READY', `working file 不是文本：${relativePath}`);
      files.set(relativePath, Buffer.from(text, 'utf8'));
    }
    return [...files.entries()]
      .map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes) }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private async withResultChange<T>(
    changeId: string,
    callback: (storage: NodeProjectStorage, store: NodeChangeStore, record: ChangeRecord) => Promise<T>,
    options: { allowTerminal?: boolean; allowStale?: boolean } = {},
  ): Promise<T> {
    const storage = await NodeProjectStorage.open(this.composition.projectRoot);
    if (projectIdentityFromRoot(storage.rootIdentity) !== this.composition.projectIdentity) {
      throw reviewError('PROJECT_IDENTITY_MISMATCH', '当前项目 identity 与 composition service 不一致');
    }
    return NodeChangeStore.withChangeLeaseForProject(changeId, storage.rootIdentity, async (store) => (
      this.leases.withProjectLease(storage.rootIdentity, async () => {
        const record = await store.read(changeId);
        if (record === null) throw reviewError('REVIEW_RESULT_NOT_READY', `integration change 不存在：${changeId}`, { changeId });
        return callback(storage, store, record);
      })
    ), { ...options, leaseManager: this.leases });
  }

  async prepareResult(input: { planId: string; artifactSha256: string; changeId: string }): Promise<PreparedReviewResult> {
    if (this.composition.store === undefined) throw reviewError('REVIEW_RESULT_NOT_READY', 'composition store 不可用');
    const { plan } = await this.composition.store.readPlan(input.planId, input.artifactSha256);
    if (plan.review?.reviewState !== 'human-reviewed') throw reviewError('REVIEW_RESULT_NOT_READY', '最终审阅需要人类决定。');
    const source = await this.readReview<HumanReviewProjection>(plan.review.reviewId);
    const sourceProjection = parseReviewProjection(source.value, plan.review.reviewId);
    if (sourceProjection.kind !== 'comparison' || sourceProjection.projectIdentity !== plan.projectIdentity
      || sourceProjection.expectedProjectRevision !== plan.expectedProjectRevision
      || sourceProjection.sourceIdentity.comparisonFingerprint !== plan.comparisonFingerprint) {
      throw reviewError('REVIEW_IDENTITY_MISMATCH', '最终审阅的原始 comparison 与正式计划不一致。');
    }
    let decisionIntent: import('@surdet/authoring').ReviewDecisionIntent | undefined;
    if (sourceProjection.reviewVersion === '2.0.0') {
      const saved = await this.reviews.readDecision<unknown>(sourceProjection.reviewId);
      if (saved === null || !isComparisonDecisionReceiptV2(saved.value)) {
        throw reviewError('REVIEW_DECISION_REQUIRED', '最终审阅缺少原始整案决定。');
      }
      const decision = await validateComparisonDecision({ projection: sourceProjection, receipt: saved.value }, this.hasher);
      if (stableStringify(decision.review) !== stableStringify(plan.review)) {
        throw reviewError('REVIEW_IDENTITY_MISMATCH', '正式计划与保存的审阅决定不一致。');
      }
      await assertDecisionPlanContentFingerprint({ receipt: saved.value, draft: plan, dryRun: plan.dryRun }, this.hasher);
      decisionIntent = saved.value.decisionIntent;
    }
    return this.withResultChange(input.changeId, async (storage, store, record) => {
      const integration = record.integration;
      if (plan.projectIdentity !== this.composition.projectIdentity
        || integration === undefined
        || integration.planId !== plan.planId
        || integration.planFingerprint !== plan.planFingerprint
        || integration.status !== 'READY'
        || record.baseRevision !== plan.expectedProjectRevision
        || projectIdentityFromRoot(record.projectRootIdentity) !== plan.projectIdentity) {
        throw reviewError('REVIEW_RESULT_NOT_READY', 'integration change 尚未达到该 reviewed plan 的 READY 结果条件', { planId: plan.planId, changeId: record.changeId });
      }
      if (!compareRecordFiles(record, await loadProjectSnapshot(storage, this.hasher))) {
        throw reviewError('COMPOSITION_PLAN_STALE', '项目已离开 integration plan 的基线 revision', { planId: plan.planId, changeId: record.changeId });
      }
      if (stableStringify(integration.review?.binding) !== stableStringify(plan.review)) {
        throw reviewError('REVIEW_RESULT_NOT_READY', 'integration change 缺少匹配的 human review binding', { planId: plan.planId, changeId: record.changeId });
      }
      const diff = await store.readDiff(record.changeId);
      if (!isChangeDiff(diff)) throw reviewError('REVIEW_RESULT_NOT_READY', 'integration change 缺少或包含无效 diff evidence', { changeId: record.changeId });
      const diffFingerprint = await this.hasher.sha256(stableStringify(diff));
      const runtime = await runtimeTraceObservationsOf(store, record);
      const files = await this.fixtureFiles(storage, record);
      const resultTreeSha256 = treeIdentityOf(files);
      const reviewId = newReviewId('result');
      const projection = await buildResultReviewProjection({
        reviewId,
        reviewVersion: sourceProjection.reviewVersion,
        ...(decisionIntent === undefined ? {} : { decisionIntent }),
        ...(sourceProjection.reviewVersion === '2.0.0' ? {
          sourceUnitObjects: sourceProjection.candidates.flatMap((candidate) => candidate.verifiedFacts.units
            .map((unit) => ({ unitId: unit.unitId, primaryObject: unit.primaryObject, sourceCapsule: candidate.ref }))),
        } : {}),
        plan,
        change: record,
        diffFingerprint,
        diff,
        freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
        runtimeTraceObservations: runtime.observations,
        runtimeTraces: runtime.traces,
        resultTreeSha256,
        changedObjects: await this.projectObjects(record, plan, diff),
      }, this.hasher);
      const identity = await this.reviews.createReview(reviewId, projection);
      const projectDirectory = await this.reviews.createResultProject(reviewId, files);
      const actualTree = await hashProjectTree(projectDirectory);
      if (actualTree !== resultTreeSha256) {
        throw reviewError('REVIEW_FIXTURE_CHANGED', `result fixture tree identity 不一致：${reviewId}`, { reviewId });
      }
      const session = openChange(record, store, storage);
      await bindResultReview(session, projection);
      return { reviewId, projection, identity, projectDirectory };
    });
  }

  private async validateReturn(
    projection: HumanReviewProjection,
    record: ChangeRecord,
    value: unknown,
  ): Promise<VerifiedReturnRequest> {
    const receipt = await validateReturnRequest({ projection, receipt: value }, this.hasher);
    const finalResult = projection.finalResult;
    if (finalResult === undefined) throw reviewError('REVIEW_RESULT_NOT_READY', `result review 缺少最终结果：${projection.reviewId}`, { reviewId: projection.reviewId });
    if (record.integration?.planId !== receipt.planId || record.integration.planFingerprint !== receipt.planFingerprint) {
      throw reviewError('REVIEW_APPROVAL_STALE', `return request 对应的 integration 已变化：${projection.reviewId}`, { reviewId: projection.reviewId });
    }
    return { receipt };
  }

  async inspectApproval(
    input: { resultReviewId: string; approvalId?: string; approvalFingerprint?: string },
    // Application inspection verifies the original approval independently of the
    // current disk. Its adapter must inspect disk/recovery; commit uses the default.
    options: { forApplication?: boolean } = {},
  ): Promise<ReviewInspectionResult> {
    const loaded = await this.readReview<HumanReviewProjection>(input.resultReviewId);
    const projection = parseReviewProjection(loaded.value, input.resultReviewId);
    if (projection.kind !== 'integration-result' || projection.finalResult === undefined) {
      throw reviewError('REVIEW_RESULT_NOT_READY', `review 不是 integration result：${input.resultReviewId}`, { reviewId: input.resultReviewId });
    }
    const finalResult = projection.finalResult;
    return this.withResultChange(finalResult.integrationChangeId, async (storage, store, record) => {
      const integration = record.integration;
      if (integration === undefined
        || integration.planId !== finalResult.planId
        || integration.planFingerprint !== finalResult.planFingerprint
        || projectIdentityFromRoot(record.projectRootIdentity) !== projection.projectIdentity) {
        throw reviewError('REVIEW_APPROVAL_STALE', `当前 integration 与 result review 不匹配：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      }
      const committed = options.forApplication === true && record.status === 'COMMITTED';
      const projectRevision = options.forApplication === true
        ? record.baseRevision
        : (await loadProjectSnapshot(storage, this.hasher)).revision;
      const diff = await store.readDiff(record.changeId);
      if (diff === null) throw reviewError('REVIEW_APPROVAL_STALE', `当前 diff evidence 缺失：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      const resultProject = await this.reviews.resultProjectDirectory(input.resultReviewId);
      const current: ResultReviewCurrentFacts = {
        projectIdentity: projection.projectIdentity,
        projectRevision,
        planId: integration.planId,
        planFingerprint: integration.planFingerprint,
        integrationChangeId: record.changeId,
        workingRevision: record.workingRevision,
        diffFingerprint: await this.hasher.sha256(stableStringify(diff)),
        evidence: evidenceOf(record),
        resultTreeSha256: await hashProjectTree(resultProject),
      };
      const approval = await this.reviews.readFinalApproval<unknown>(input.resultReviewId);
      const returned = await this.reviews.readReturnRequest<unknown>(input.resultReviewId);
      if (approval !== null && returned !== null) {
        throw reviewError('REVIEW_IDENTITY_MISMATCH', `result review 同时存在 approval 与 return request：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      }
      if (returned !== null) {
        return this.validateReturn(projection, record, returned.value);
      }
      if (approval === null) throw reviewError('REVIEW_APPROVAL_REQUIRED', `result review 尚未收到项目所有者批准：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      if (!isFinalApprovalReceipt(approval.value, input.resultReviewId)) {
        throw reviewError('REVIEW_APPROVAL_STALE', `批准回执结构无效：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      }
      if (input.approvalId !== undefined && input.approvalId !== approval.value.approvalId) {
        throw reviewError('REVIEW_IDENTITY_MISMATCH', `approvalId 与 result review 不匹配：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      }
      const verified = await validateFinalApproval({ projection, receipt: approval.value, current }, this.hasher);
      if (input.approvalFingerprint !== undefined
        && input.approvalFingerprint !== verified.receipt.approvalFingerprint) {
        throw reviewError('REVIEW_IDENTITY_MISMATCH', `approvalFingerprint 与磁盘批准回执不匹配：${input.resultReviewId}`, { reviewId: input.resultReviewId });
      }
      if (committed) {
        const persisted = integration.review?.approval;
        if (persisted?.approvalId !== verified.receipt.approvalId
          || persisted.approvalFingerprint !== verified.receipt.approvalFingerprint
          || persisted.bindingFingerprint !== verified.bindingFingerprint) {
          throw reviewError('REVIEW_IDENTITY_MISMATCH', '已提交事务与批准回执的持久化绑定不一致');
        }
      }
      return verified;
    }, { allowTerminal: options.forApplication, allowStale: options.forApplication });
  }
}

export async function reviewServiceForProject(projectRoot: string, dataRoot?: string): Promise<ReviewService> {
  const composition = await compositionServiceForProject(projectRoot, dataRoot);
  const reviews = new NodeReviewStore(composition.store.projectDirectory, composition.projectIdentity);
  return new ReviewService(reviews, composition, composition.hasher);
}
