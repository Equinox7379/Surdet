import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError, REVIEW_PREPARATION_STAGES, isReviewPreparationReference,
  parseReviewPreparationRequest, samePreparationReference,
  type ReviewPreparationRecord, type ReviewPreparationReference, type ReviewPreparationRequest,
  type ReviewPreparationStatus, type PreparedReviewContent, type HumanReviewProjection,
  type EvidenceEnvelope, type SimulationReport,
} from '@surdet/authoring';
import { AuthoringService } from './authoring-service.js';
import { compositionServiceForProject, type CompositionService } from './composition-service.js';
import { NodeChangeStore } from './node-change-store.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { reviewServiceForProject, type ReviewService } from './review-service.js';

function mismatch(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', message);
}
function corrupt(message: string): AuthoringOperationError {
  return new AuthoringOperationError('CHANGE_STORE_CORRUPT', message);
}

/** Advances one durable step at a time through existing public services. No project writer. */
export class ReviewPreparationService {
  private constructor(
    readonly projectRoot: string,
    readonly projectIdentity: string,
    readonly dataRoot: string,
    private readonly reviews: ReviewService,
    private readonly composition: CompositionService,
    private readonly leases: NodeLocalLeaseManager,
    private readonly authoring: AuthoringService,
  ) {}

  static async open(projectRoot: string, dataRoot: string): Promise<ReviewPreparationService> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const root = await fs.realpath(path.resolve(dataRoot));
    const leases = new NodeLocalLeaseManager(root);
    return new ReviewPreparationService(storage.rootIdentity, projectIdentityFromRoot(storage.rootIdentity), root,
      await reviewServiceForProject(storage.rootIdentity, root), await compositionServiceForProject(storage.rootIdentity, root),
      leases, new AuthoringService(undefined, leases));
  }

  private resource(ref: ReviewPreparationReference): string {
    return `${this.projectIdentity}\u0000${ref.reviewId}\u0000preparation`;
  }

  private async record(ref: ReviewPreparationReference): Promise<ReviewPreparationRecord | null> {
    if (ref.projectIdentity !== this.projectIdentity) throw mismatch('审阅不属于当前绑定项目。');
    const review = await this.reviews.reviews.readReview(ref.reviewId);
    if (review.identity.kind !== 'comparison' || review.identity.payload.bytes !== ref.reviewPayload.bytes
      || review.identity.payload.sha256 !== ref.reviewPayload.sha256) throw mismatch('比较审阅身份已变化，请重新核对。');
    const record = await this.reviews.reviews.readPreparation(ref.reviewId);
    if (record !== null && (record.formatVersion !== 1 || !isReviewPreparationReference(record.decision)
      || !samePreparationReference(record.decision, ref) || !Number.isInteger(record.completed)
      || record.completed < 0 || record.completed > 7 || !/^review_result_[A-Za-z0-9_-]+$/.test(record.resultReviewId)
      || !Number.isFinite(Date.parse(record.startedAt))
      || (record.completed > 0 && (!record.plan || !/^pln_[a-f0-9]+$/.test(record.plan.planId)
        || !/^[a-f0-9]{64}$/.test(record.plan.artifactSha256)))
      || (record.completed > 1 && (typeof record.changeId !== 'string' || !/^chg_[A-Za-z0-9_-]+$/.test(record.changeId)
        || !Number.isSafeInteger(record.workingRevision) || record.workingRevision! < 0)))) {
      throw corrupt('准备进度不完整或与已保存决定不一致；保留原记录，不能另建结果。');
    }
    return record;
  }

  private async verify(ref: ReviewPreparationReference, record: ReviewPreparationRecord | null, contentOnly = false) {
    const opened = record?.changeId ? await NodeChangeStore.openForProject(record.changeId, this.projectRoot,
      { dataRoot: this.dataRoot, allowTerminal: record.completed === 7, allowStale: record.completed === 7 }) : null;
    // Only an actual explicit commit makes this historical. Before writeback,
    // ready results must still reject changed source/candidate identities.
    const verified = await this.reviews.inspectDecision({ reviewId: ref.reviewId, decisionId: ref.decisionId },
      { allowStale: contentOnly || (record?.completed === 7 && opened?.record.status === 'COMMITTED') });
    if (verified.review.decisionFingerprint !== ref.decisionFingerprint) throw mismatch('保存的决定身份已变化。');
    if (record?.plan) {
      const { plan } = await this.composition.store.readPlan(record.plan.planId, record.plan.artifactSha256);
      if (plan.review?.reviewState !== 'human-reviewed' || plan.review.reviewId !== ref.reviewId
        || plan.review.decisionFingerprint !== ref.decisionFingerprint) throw mismatch('准备计划与保存决定不一致。');
    }
    if (record?.changeId) {
      const integration = opened?.record.integration;
      if (!opened || !integration || integration.planId !== record.plan?.planId
        || integration.executeOperationId !== this.operationId(ref)) throw mismatch('准备进度对应的组合结果无法核对。');
      if (record.completed > 1 && integration.status !== 'READY') throw corrupt('组合尚未完成，不能跳过已有进度。');
      if (record.completed > 1 && opened.record.workingRevision !== record.workingRevision) {
        throw mismatch('隔离结果在准备期间被另行编辑，已停止；原决定和已有结果均保留。');
      }
      if (record.completed === 7 && integration.review?.resultReview?.reviewId !== record.resultReviewId) {
        throw mismatch('已准备结果与组合绑定不一致。');
      }
    }
    return verified;
  }

  private operationId(ref: ReviewPreparationReference): string { return `prepare_${ref.decisionFingerprint}`; }

  private async status(ref: ReviewPreparationReference, record: ReviewPreparationRecord | null): Promise<ReviewPreparationStatus> {
    const lease = await this.leases.inspect('review', this.resource(ref));
    if (lease.state === 'corrupt') throw new AuthoringOperationError('LEASE_CORRUPT', '准备操作锁无法核对，已停止操作。');
    return { protocolVersion: '1.0.0', decision: ref, started: record !== null,
      working: lease.state === 'owned' || lease.state === 'foreign-host',
      stage: REVIEW_PREPARATION_STAGES[record?.completed ?? 0]!,
      ...(record?.completed === 7 ? { resultReviewId: record.resultReviewId } : {}),
      ...(record?.error ? { error: record.error } : {}) };
  }

  async execute(value: ReviewPreparationRequest): Promise<ReviewPreparationStatus | PreparedReviewContent> {
    const request = parseReviewPreparationRequest(value);
    try { return await this.executeRequest(request); }
    catch (error) {
      if ((request.action === 'inspect-preparation' || request.action === 'prepare-result')
        && error instanceof AuthoringOperationError && ['PROJECT_BUSY', 'CHANGE_BUSY', 'REVIEW_BUSY'].includes(error.code)) {
        // A known held domain lease is an in-progress observation, not a new
        // execution or a guessed failure. The client can re-inspect it.
        return { ...await this.status(request.decision, await this.record(request.decision)), working: true };
      }
      throw error;
    }
  }

  private async executeRequest(request: ReviewPreparationRequest): Promise<ReviewPreparationStatus | PreparedReviewContent> {
    const ref = request.decision;
    const record = await this.record(ref);
    if (request.action === 'read-prepared-directory' || request.action === 'read-prepared-file') {
      // Content is immutable and identity-checked. Freshness is checked by the
      // preparation/open status and the existing approval/writeback gates, not
      // by acquiring the source project lease for each parallel asset read.
      await this.verify(ref, record, true);
      const reviewId = request.view === 'comparison' ? ref.reviewId : record?.completed === 7 ? record.resultReviewId : null;
      if (reviewId === null) throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', '结果尚未准备完成。');
      if (request.view === 'result') {
        const result = await this.reviews.reviews.readReview<HumanReviewProjection>(reviewId);
        if (result.value.sourceIdentity.decisionFingerprint !== ref.decisionFingerprint
          || result.value.finalResult?.integrationChangeId !== record?.changeId) throw mismatch('结果不属于本次保存的决定。');
      }
      return this.reviews.reviews.readPreparedContent(reviewId, request.path,
        request.action === 'read-prepared-file' ? 'file' : 'directory');
    }
    if (request.action === 'inspect-preparation' || record?.completed === 7) {
      await this.verify(ref, record);
      return this.status(ref, record);
    }
    try {
      await this.leases.withLease({ scope: 'review', resourceId: this.resource(ref) }, async () => {
        let current = await this.record(ref);
        const verified = await this.verify(ref, current);
        if (current?.completed === 7) return;
        if (current === null) {
          current = { formatVersion: 1, decision: ref, startedAt: new Date().toISOString(), completed: 0,
            resultReviewId: `review_result_${crypto.randomUUID().replaceAll('-', '')}` };
          await this.reviews.reviews.writePreparation(ref.reviewId, current);
        }
        const next = structuredClone(current);
        delete next.error;
        try {
          if (current.completed === 0) {
            const planned = await this.composition.plan({ candidateRefs: verified.receipt.candidateRefs,
              comparisonFingerprint: verified.receipt.comparisonFingerprint, selectedUnitIds: verified.selectedUnitIds,
              conflictResolutions: verified.conflictResolutions, review: verified.review, now: current.startedAt,
              ...(verified.receipt.receiptVersion === '2.0.0' ? { expectedPlanContentFingerprint: verified.receipt.planContentFingerprint } : {}) });
            if (planned.plan.dryRun.status !== 'passed') throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED',
              planned.plan.dryRun.errors[0]?.message ?? '组合试运行失败，未修改来源项目。');
            next.plan = { planId: planned.plan.planId, artifactSha256: planned.identity.sha256 };
          } else if (current.completed === 1) {
            const executed = await this.composition.executePlan({ ...current.plan!, executeOperationId: this.operationId(ref),
              ...(current.changeId ? { changeId: current.changeId } : {}) });
            next.changeId = executed.changeId;
            next.workingRevision = executed.workingRevision;
            if (executed.status !== 'READY') throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', '隔离组合未完成，已有执行进度保留。');
          } else {
            const opened = await NodeChangeStore.openForProject(current.changeId!, this.projectRoot, { dataRoot: this.dataRoot });
            if (!opened) throw new AuthoringOperationError('CHANGE_NOT_FOUND', '准备中的组合不存在。');
            const change = opened.record;
            if (current.completed === 2) {
              if (change.latestDiff?.workingRevision !== change.workingRevision) await this.authoring.diff(change.changeId);
            } else if (current.completed === 3) {
              if (change.latestValidation?.workingRevision !== change.workingRevision || change.latestValidation.errors > 0) {
                const validation = await this.authoring.validate(change.changeId);
                const errors = validation.result.issues.filter((issue) => issue.severity === 'error');
                if (errors.length) throw new AuthoringOperationError('VALIDATION_FAILED', errors[0]!.text);
              }
            } else if (current.completed === 4) {
              if (change.latestSimulation?.workingRevision !== change.workingRevision || change.latestSimulation.status !== 'passed') {
                await this.authoring.simulate(change.changeId);
              }
            } else if (current.completed === 5) {
              if (!change.runtimeTraces?.some((trace) => trace.workingRevision === change.workingRevision && trace.status === 'passed')) {
                const simulation = change.latestSimulation;
                if (simulation?.workingRevision !== change.workingRevision || simulation.status !== 'passed') {
                  throw new AuthoringOperationError('SIMULATION_INCOMPLETE', '当前组合缺少本版本通过的模拟证据，已有准备进度保留。');
                }
                const evidence = await opened.store.readEvidence(change.changeId, simulation.evidenceId) as EvidenceEnvelope<SimulationReport> | null;
                const report = evidence?.result;
                if (evidence?.schemaVersion !== 1 || evidence.evidenceId !== simulation.evidenceId
                  || evidence.capability !== 'project.simulate' || evidence.status !== 'passed'
                  || evidence.changeId !== change.changeId || evidence.workingRevision !== change.workingRevision
                  || evidence.projectRevision !== change.baseRevision || report?.status !== 'passed'
                  || report.budgetExhausted !== false || typeof report.entryScene !== 'string' || !report.entryScene
                  || !Number.isInteger(report.seed) || !Array.isArray(report.paths)) {
                  throw corrupt('当前组合的模拟证据缺失、损坏或身份不匹配，不能猜测运行路径。');
                }
                // Pruned paths may be marked passed, but only an ended path can
                // supply the complete explicit choices required by runFrom.
                const completedPath = report.paths.find(candidate => candidate?.status === 'passed' && candidate.termination === 'ended');
                if (!completedPath) {
                  throw new AuthoringOperationError('SIMULATION_INCOMPLETE', '当前模拟没有正常结束的完整路径，无法准备运行检查；已有进度保留。');
                }
                if (!Array.isArray(completedPath.choices) || completedPath.choices.some(choice => !Number.isInteger(choice) || choice < 0)) {
                  throw corrupt('模拟证据中的完整路径选择序列损坏，不能猜测选项。');
                }
                await this.authoring.runFrom(change.changeId, {
                  sceneId: report.entryScene, choices: completedPath.choices, seed: report.seed,
                });
              }
            } else {
              await this.reviews.prepareResult({ ...current.plan!, changeId: change.changeId, resultReviewId: current.resultReviewId });
            }
          }
          next.completed++;
          await this.reviews.reviews.writePreparation(ref.reviewId, next);
        } catch (error) {
          // A failed acknowledgement may follow a successful side effect. Keep
          // the previous step; retry reconciles the same plan/change/result.
          current.error = error instanceof AuthoringOperationError
            ? { code: error.code, message: error.message }
            : { code: 'REVIEW_PREPARATION_IO_FAILED', message: '本机暂时无法完成这一步；已有进度保留，请检查状态后继续。' };
          await this.reviews.reviews.writePreparation(ref.reviewId, current);
        }
      });
    } catch (error) {
      if (!(error instanceof AuthoringOperationError) || error.code !== 'REVIEW_BUSY') throw error;
    }
    const latest = await this.record(ref);
    await this.verify(ref, latest);
    return this.status(ref, latest);
  }
}
