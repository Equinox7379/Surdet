import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  humanWorkspaceCommitBlock, inspectTransactionRecovery, loadProjectSnapshot, ReviewApplyError,
  type ApprovedApplyInspection, type ApprovedResultBinding, type BoundProjectScope,
  type ChangeRecord, type CommitJournal, type DurableCommitFact, type ReviewApprovalReference,
} from '@surdet/authoring';
import { AuthoringService } from './authoring-service.js';
import { HumanWorkspaceStore } from './human-workspace-store.js';
import { NodeChangeStore } from './node-change-store.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { ProjectMutationNoticeStore } from './project-mutation-notice-store.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { ChangeRecordProjectStorage } from './working-project-storage.js';
import { reviewServiceForProject, type ReviewService } from './review-service.js';
import type { ReviewApprovedApplyBackend } from './review-approved-apply-service.js';

const hasher = { sha256: async (text: string) => crypto.createHash('sha256').update(text).digest('hex') };

/** Projection of the existing approval, change and journal. All writes use AuthoringService. */
export class NodeReviewApprovedApplyBackend implements ReviewApprovedApplyBackend {
  private constructor(
    readonly scope: BoundProjectScope,
    private readonly reviews: ReviewService,
    private readonly leases: NodeLocalLeaseManager,
    private readonly authoring: AuthoringService,
  ) {}

  static async open(projectRoot: string, dataRoot: string): Promise<NodeReviewApprovedApplyBackend> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const canonicalDataRoot = await fs.realpath(path.resolve(dataRoot));
    const scope = { projectIdentity: projectIdentityFromRoot(storage.rootIdentity),
      canonicalProjectRoot: storage.rootIdentity, canonicalDataRoot };
    const leases = new NodeLocalLeaseManager(canonicalDataRoot);
    return new NodeReviewApprovedApplyBackend(scope,
      await reviewServiceForProject(storage.rootIdentity, canonicalDataRoot), leases,
      new AuthoringService(undefined, leases));
  }

  async inspect(ref: ReviewApprovalReference): Promise<ApprovedApplyInspection> {
    const verified = await this.reviews.inspectApproval(ref, { forApplication: true });
    if (!('bindingFingerprint' in verified)) throw new ReviewApplyError('REVIEW_RETURNED', '这份结果已退回，不能写回。');
    const receipt = verified.receipt;
    if (receipt.projectIdentity !== this.scope.projectIdentity) {
      throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH', '批准结果不属于绑定项目。');
    }
    const binding: ApprovedResultBinding = {
      approvalRef: { ...ref }, decisionFingerprint: receipt.decisionFingerprint,
      planId: receipt.planId, planFingerprint: receipt.planFingerprint,
      integrationChangeId: receipt.integrationChangeId, workingRevision: receipt.workingRevision,
      expectedProjectRevision: receipt.expectedProjectRevision, resultTreeSha256: receipt.resultTreeSha256,
    };
    const opened = await NodeChangeStore.openForProject(receipt.integrationChangeId, this.scope.canonicalProjectRoot,
      { allowTerminal: true, allowStale: true, dataRoot: this.scope.canonicalDataRoot });
    if (opened === null) throw new ReviewApplyError('CHANGE_NOT_FOUND', '批准结果的事务不存在。');
    const { record, store } = opened;
    if (record.workingRevision !== binding.workingRevision || record.baseRevision !== binding.expectedProjectRevision
      || record.integration?.planId !== binding.planId || record.integration.planFingerprint !== binding.planFingerprint
      || record.integration.review?.resultReview?.reviewId !== ref.resultReviewId) {
      throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH', '检查过程中批准结果的事务绑定发生变化。');
    }
    const journal = await store.readLatestJournal(record.changeId);
    const storage = await NodeProjectStorage.open(this.scope.canonicalProjectRoot);
    if (storage.rootIdentity !== this.scope.canonicalProjectRoot) {
      throw new ReviewApplyError('PROJECT_IDENTITY_MISMATCH', '来源项目的真实路径发生变化。');
    }
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const paths = [...new Set([...Object.keys(record.baseContents), ...Object.keys(record.workingFiles)])]
      .filter((file) => record.baseContents[file] !== record.workingFiles[file]).sort();
    const common = { scope: this.scope, binding, targetDisplayName: path.basename(storage.rootIdentity),
      changedPaths: paths, blockers: [] };
    if (record.status === 'COMMITTED') {
      const persisted = record.integration.review?.approval;
      if (persisted?.approvalId !== ref.approvalId || persisted.approvalFingerprint !== ref.approvalFingerprint
        || persisted.bindingFingerprint !== verified.bindingFingerprint) {
        throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH', '持久化提交不属于这份批准。');
      }
      await this.assertCommittedJournal(record, journal, paths);
      const committed = await loadProjectSnapshot(new ChangeRecordProjectStorage(record), hasher);
      const commit: DurableCommitFact = { binding, projectIdentity: this.scope.projectIdentity,
        changeId: record.changeId, changedPaths: paths, committedProjectRevision: committed.revision,
        coordination: 'not-observed' };
      try {
        const notice = await new ProjectMutationNoticeStore({ dataRoot: this.scope.canonicalDataRoot }).readLatest(storage.rootIdentity);
        if (notice?.changeId === record.changeId) commit.coordination = 'written';
      } catch {
        commit.coordination = 'warning';
        commit.coordinationMessage = '项目已写入，工作区通知暂不可读取。';
      }
      return { ...common, writeState: 'committed', workspace: 'absent', commit,
        currentProject: snapshot.revision === committed.revision ? 'matches-commit' : 'changed-after-commit' };
    }
    const workspace = (await new HumanWorkspaceStore({ dataRoot: this.scope.canonicalDataRoot }).inspect(storage.rootIdentity)).summary;
    const waitingForConnection = workspace.availability === 'blocked'
      && humanWorkspaceCommitBlock(workspace)?.code === 'HUMAN_WORKSPACE_BUSY';
    const changeLease = await this.leases.inspect('change', record.changeId);
    const projectLease = await this.leases.inspect('project', storage.rootIdentity);
    const lockState = changeLease.state !== 'free' ? changeLease.state : projectLease.state;
    const locked = lockState !== 'free';
    const recovery = await inspectTransactionRecovery({ record, journal, storage,
      leaseState: lockState, sha256: hasher.sha256 });
    // RECOVERED already proves rollback. A new explicit write may retry at the
    // verified base; unfinished staging/replacement still needs explicit recovery.
    const recovered = journal?.status === 'RECOVERED' && recovery.projectState === 'base' && !recovery.manualRecoveryRequired;
    const writeState = locked ? 'committing'
      : journal !== null && !recovered ? 'recovery-required' : 'unwritten';
    const blockers = record.status === 'OPEN' ? [] : [{ code: 'CHANGE_NOT_OPEN', message: '事务已关闭或失去原基线，需要重新核对结果。' }];
    if (writeState === 'unwritten' && waitingForConnection) blockers.push({ code: 'HUMAN_WORKSPACE_BUSY',
      message: '正在等待旧窗口连接确认，稍后会自动检查；尚未写回。' });
    return { ...common,
      writeState,
      workspace: waitingForConnection ? 'busy' : workspace.availability === 'blocked' ? 'lost' : workspace.availability,
      ...(workspace.retryAfterMs === undefined ? {} : { retryAfterMs: workspace.retryAfterMs }),
      currentProject: snapshot.revision === record.baseRevision ? 'matches-approved-base' : 'unknown',
      blockers,
    };
  }

  private async assertCommittedJournal(record: ChangeRecord, journal: CommitJournal | null, paths: string[]): Promise<void> {
    if (journal?.status !== 'COMMITTED' || journal.projectRevisionAtCommitStart !== record.baseRevision
      || journal.recordVersionAtCommitStart >= record.recordVersion
      || journal.files.length !== paths.length) {
      throw new ReviewApplyError('JOURNAL_CORRUPT', '已提交事务缺少一致的完成日志。');
    }
    for (const entry of journal.files) {
      const content = record.workingFiles[entry.path];
      if (!paths.includes(entry.path) || content === undefined || !entry.replaced || entry.restored
        || entry.originalSha256 !== record.baseFiles[entry.path]?.sha256
        || entry.targetSha256 !== await hasher.sha256(content)) {
        throw new ReviewApplyError('JOURNAL_CORRUPT', '提交日志与批准的文件内容不一致。');
      }
    }
  }

  async commit(binding: ApprovedResultBinding): Promise<DurableCommitFact> {
    const result = await this.authoring.commit(binding.integrationChangeId, binding.approvalRef);
    return { binding, projectIdentity: result.projectIdentity, changeId: result.result.changeId,
      changedPaths: result.result.files, committedProjectRevision: result.projectRevision,
      coordination: result.result.coordination.status,
      ...(result.result.coordination.status === 'warning' ? { coordinationMessage: result.result.coordination.message } : {}),
    };
  }
}
