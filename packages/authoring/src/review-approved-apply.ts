/** Wave 10: application protocol, not a new Agent capability or receipt format.
 * All project writes remain inside the existing Authoring commit transaction.
 */
export interface ReviewApprovalReference {
  resultReviewId: string;
  approvalId: string;
  approvalFingerprint: string;
}
export interface ReviewApplyRequest {
  protocolVersion: '1.0.0';
  action: 'inspect-approved-application' | 'write-approved-result';
  approvalRef: ReviewApprovalReference;
}
export interface BoundProjectScope {
  /** Canonical identities supplied by the existing Node storage/binding layer. */
  projectIdentity: string;
  canonicalProjectRoot: string;
  canonicalDataRoot: string;
}
export interface ApprovedResultBinding {
  approvalRef: ReviewApprovalReference;
  decisionFingerprint: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  expectedProjectRevision: string;
  resultTreeSha256: string;
}
export type WorkspaceCondition = 'clean' | 'dirty' | 'busy' | 'lost' | 'absent';
export interface ApplyBlocker { code: string; message: string; }
/** This is a normalized read of existing record/journal facts, not a new disk record. */
export interface ApprovedApplyInspection {
  scope: BoundProjectScope;
  binding: ApprovedResultBinding;
  targetDisplayName: string;
  changedPaths: readonly string[];
  writeState: 'unwritten' | 'committing' | 'committed' | 'recovery-required' | 'unknown';
  workspace: WorkspaceCondition;
  retryAfterMs?: number;
  blockers: readonly ApplyBlocker[];
  currentProject: 'matches-approved-base' | 'matches-commit' | 'changed-after-commit' | 'unknown';
  commit?: DurableCommitFact;
}
export interface DurableCommitFact {
  binding: ApprovedResultBinding;
  projectIdentity: string;
  changeId: string;
  /** Obtain from the existing commit result/journal, never from a guessed current snapshot. */
  changedPaths: readonly string[];
  committedProjectRevision?: string;
  coordination: 'written' | 'warning' | 'not-observed';
  coordinationMessage?: string;
}
export type ReviewApplyPhase = 'ready' | 'blocked' | 'writing' | 'written' | 'unknown' | 'recovery-required';
export interface ReviewApplyStatus {
  protocolVersion: '1.0.0';
  approvalRef: ReviewApprovalReference;
  projectIdentity: string;
  integrationChangeId: string;
  targetDisplayName: string;
  /** Server-derived bound target; never accepted as a client input. */
  targetPath: string;
  changedPaths: readonly string[];
  phase: ReviewApplyPhase;
  canWrite: boolean;
  retryAfterMs?: number;
  blockers: readonly ApplyBlocker[];
  currentProject: ApprovedApplyInspection['currentProject'];
  commit?: DurableCommitFact;
}
export class ReviewApplyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name='ReviewApplyError'; this.code=code; }
}
const TARGET_BLOCKING_ERRORS = new Set([
  'REVIEW_IDENTITY_MISMATCH', 'PROJECT_IDENTITY_MISMATCH', 'REVIEW_APPROVAL_STALE',
  'REVIEW_APPROVAL_REQUIRED', 'REVIEW_RESULT_NOT_READY', 'REVIEW_FORMAT_UNSUPPORTED',
  'REVIEW_RETURNED', 'REVIEW_NOT_FOUND', 'CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN', 'CHANGE_STORE_CORRUPT',
  'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT', 'RECOVERY_AMBIGUOUS',
  'COMMIT_RECOVERY_FAILED', 'PATH_OUTSIDE_PROJECT', 'CHANGE_ID_AMBIGUOUS',
  'PROJECT_CHANGED_SINCE_BEGIN', 'LEASE_CORRUPT',
]);
export function isReviewApplyTargetError(error: unknown): boolean {
  return isRecord(error) && typeof error.code === 'string' && TARGET_BLOCKING_ERRORS.has(error.code);
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function onlyKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).every(k=>keys.includes(k)) && keys.every(k=>Object.hasOwn(v,k));
}
function nonempty(v: unknown): v is string { return typeof v==='string' && v.length>0 && v.length<=512; }
export function parseReviewApplyRequest(value: unknown): ReviewApplyRequest {
  if (!isRecord(value) || !onlyKeys(value, ['protocolVersion', 'action', 'approvalRef'])) {
    throw new ReviewApplyError('INVALID_REQUEST', '写回请求格式无效；目标项目只能由已绑定审阅服务确定。');
  }
  const { protocolVersion, action, approvalRef } = value;
  // Validate the actual discriminator, never a String(...) conversion of it.
  // A singleton array must not become a command or fall through to a write.
  if (protocolVersion !== '1.0.0'
      || typeof action !== 'string'
      || (action !== 'inspect-approved-application' && action !== 'write-approved-result')
      || !isRecord(approvalRef)
      || !onlyKeys(approvalRef, ['resultReviewId', 'approvalId', 'approvalFingerprint'])) {
    throw new ReviewApplyError('INVALID_REQUEST', '写回请求格式无效；目标项目只能由已绑定审阅服务确定。');
  }
  const { resultReviewId, approvalId, approvalFingerprint } = approvalRef;
  if (!nonempty(resultReviewId) || !nonempty(approvalId) || !nonempty(approvalFingerprint)) {
    throw new ReviewApplyError('INVALID_REQUEST', '批准引用格式无效，未执行项目写入。');
  }
  // Reconstruct only from values narrowed above; do not cast unvalidated input.
  return {
    protocolVersion,
    action,
    approvalRef: { resultReviewId, approvalId, approvalFingerprint },
  };
}
export function sameApproval(a: ReviewApprovalReference,b: ReviewApprovalReference): boolean {
  return a.resultReviewId===b.resultReviewId && a.approvalId===b.approvalId && a.approvalFingerprint===b.approvalFingerprint;
}
export function sameBinding(a: ApprovedResultBinding,b: ApprovedResultBinding): boolean {
  return sameApproval(a.approvalRef,b.approvalRef)
    && a.decisionFingerprint===b.decisionFingerprint && a.planId===b.planId
    && a.planFingerprint===b.planFingerprint && a.integrationChangeId===b.integrationChangeId
    && a.workingRevision===b.workingRevision && a.expectedProjectRevision===b.expectedProjectRevision
    && a.resultTreeSha256===b.resultTreeSha256;
}
export function assertBoundInspection(scope: BoundProjectScope, ref: ReviewApprovalReference, s: ApprovedApplyInspection): void {
  if (scope.projectIdentity!==s.scope.projectIdentity || scope.canonicalProjectRoot!==s.scope.canonicalProjectRoot
      || scope.canonicalDataRoot!==s.scope.canonicalDataRoot || !sameApproval(ref,s.binding.approvalRef)) {
    throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH','审阅、项目或数据目录不属于当前绑定，未执行写回。');
  }
  if (!Number.isSafeInteger(s.binding.workingRevision) || s.binding.workingRevision<0) {
    throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH','批准的工作版本无效。');
  }
  if (s.commit!==undefined) assertCommitMatches(scope,s.binding,s.commit);
  if (s.writeState==='committed' && s.commit===undefined) {
    throw new ReviewApplyError('CHANGE_STORE_CORRUPT','提交状态缺少可核对的持久化事实，不能宣称写回成功。');
  }
}
export function assertCommitMatches(scope:BoundProjectScope,binding:ApprovedResultBinding,commit:DurableCommitFact):void {
  if (commit.projectIdentity!==scope.projectIdentity || commit.changeId!==binding.integrationChangeId
      || !sameBinding(commit.binding,binding)) {
    throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH','持久化提交与这份批准结果不一致。');
  }
}
export function statusFromInspection(s:ApprovedApplyInspection):ReviewApplyStatus {
  let phase:ReviewApplyPhase;
  let blockers=[...s.blockers];
  if(s.writeState==='committed') phase='written';
  else if(s.writeState==='committing') phase='writing';
  else if(s.writeState==='recovery-required') phase='recovery-required';
  else if(s.writeState==='unknown') phase='unknown';
  else {
    if(s.workspace==='dirty' && !blockers.some(x=>x.code==='HUMAN_WORKSPACE_DIRTY'))
      blockers.push({code:'HUMAN_WORKSPACE_DIRTY',message:'绑定项目有未保存草稿。先保存或自行放弃草稿，再检查写回状态。'});
    if(s.workspace==='busy' && !blockers.some(x=>x.code==='HUMAN_WORKSPACE_BUSY'))
      blockers.push({code:'HUMAN_WORKSPACE_BUSY',message:'项目正在保存或切换，完成后再检查。'});
    if(s.workspace==='lost' && !blockers.some(x=>x.code==='HUMAN_WORKSPACE_STATE_CORRUPT'))
      blockers.push({code:'HUMAN_WORKSPACE_STATE_CORRUPT',message:s.retryAfterMs===undefined
        ?'工作区连接尚未确认，未执行写回。':'正在等待旧窗口连接确认，稍后会自动检查；尚未写回。'});
    if(s.currentProject!=='matches-approved-base' && !blockers.some(x=>x.code==='PROJECT_CHANGED_SINCE_BEGIN'))
      blockers.push({code:'PROJECT_CHANGED_SINCE_BEGIN',message:'项目已离开批准结果的来源基线，需要重新审阅；未覆盖现有内容。'});
    phase=blockers.length===0?'ready':'blocked';
  }
  return {
    protocolVersion:'1.0.0',approvalRef:{...s.binding.approvalRef},projectIdentity:s.scope.projectIdentity,
    integrationChangeId:s.binding.integrationChangeId,targetDisplayName:s.targetDisplayName,
    targetPath:s.scope.canonicalProjectRoot,changedPaths:[...s.changedPaths],phase,
    canWrite:phase==='ready',blockers,currentProject:s.currentProject,
    ...(phase==='blocked' && s.retryAfterMs!==undefined?{retryAfterMs:s.retryAfterMs}:{}),
    ...(s.commit===undefined?{}:{commit:s.commit}),
  };
}
