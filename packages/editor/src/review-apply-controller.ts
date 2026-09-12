import {
  ReviewApplyError,
  isReviewApplyTargetError,
  sameApproval,
  sameBinding,
  type ReviewApprovalReference,
  type ReviewApplyRequest,
  type ReviewApplyStatus,
} from '@surdet/authoring';

export type LocalSyncState = 'not-loaded' | 'checking' | 'drafts-blocked' | 'synchronized' | 'failed';
export type ContinueWritingState = 'idle' | 'opening' | 'failed' | 'opened';
export interface ReviewApplyViewState {
  approval: ReviewApprovalReference;
  /** A confirmed commit is historical fact, not the availability of a later query. */
  status: ReviewApplyStatus | null;
  request: 'idle' | 'checking' | 'writing';
  sync: LocalSyncState;
  message: string;
  continuation: ContinueWritingState;
  continuationMessage: string;
  /** Historical success is retained, but identity/recovery conflicts must still block navigation. */
  targetBlocked: boolean;
}
export interface ExistingEditorSyncPort {
  /** MUST return the current main project identity, not the result fixture identity. */
  inspect(): Promise<{ projectIdentity: string | null; hasUnsavedDrafts: boolean; transitioning: boolean }>;
  /** Invoke the existing explicit project switch/reload path. No direct buffer replacement. */
  synchronize(projectIdentity: string): Promise<{ projectIdentity: string; loadedCurrentDisk: boolean }>;
  /** Existing script-workbench navigation; must recheck the target before switching panels. */
  continueWriting(projectIdentity: string): Promise<void>;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '暂时无法读取状态，请重试。';
}
function identityError(message: string): ReviewApplyError {
  return new ReviewApplyError('REVIEW_IDENTITY_MISMATCH', message);
}

export class ReviewApplyController {
  private readonly transport: (r: ReviewApplyRequest) => Promise<ReviewApplyStatus>;
  private readonly editor: ExistingEditorSyncPort;
  private readonly notify: (s: ReviewApplyViewState) => void;
  private epoch = 0;
  private disposed = false;
  private recheck: ReturnType<typeof setTimeout> | undefined;
  private state: ReviewApplyViewState;

  constructor(
    ref: ReviewApprovalReference,
    transport: (r: ReviewApplyRequest) => Promise<ReviewApplyStatus>,
    editor: ExistingEditorSyncPort,
    notify: (s: ReviewApplyViewState) => void,
  ) {
    this.transport = transport;
    this.editor = editor;
    this.notify = notify;
    this.state = { approval: { ...ref }, status: null, request: 'idle', sync: 'not-loaded',
      message: '', continuation: 'idle', continuationMessage: '', targetBlocked: false };
  }
  get snapshot(): ReviewApplyViewState { return structuredClone(this.state); }
  private emit(): void { if (!this.disposed) this.notify(this.snapshot); }
  private current(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }
  private editorBusy(): boolean { return this.state.sync === 'checking' || this.state.continuation === 'opening'; }
  dispose(): void { this.disposed = true; this.epoch++; clearTimeout(this.recheck); }

  async check(): Promise<void> {
    if (this.disposed || this.state.request === 'writing' || this.editorBusy()) return;
    // A newer check may supersede an older check, but cannot strand an Editor action.
    await this.request('inspect-approved-application');
  }
  async write(): Promise<void> {
    if (this.disposed || this.state.request !== 'idle' || this.editorBusy() || this.state.targetBlocked
        || this.state.status?.phase !== 'ready' || this.state.status.canWrite !== true) return;
    await this.request('write-approved-result');
  }

  private acceptStatus(result: ReviewApplyStatus, previous: ReviewApplyStatus | null): void {
    if (!sameApproval(result.approvalRef, this.state.approval)) {
      throw identityError('服务返回了另一份审阅状态，已拒绝使用。');
    }
    if (previous !== null && (result.projectIdentity !== previous.projectIdentity
        || result.integrationChangeId !== previous.integrationChangeId || result.targetPath !== previous.targetPath)) {
      throw identityError('服务返回的项目或集成身份发生变化，请重新核对原绑定审阅。');
    }
    if (result.phase === 'written') {
      const commit = result.commit;
      if (commit === undefined || commit.projectIdentity !== result.projectIdentity
          || commit.changeId !== result.integrationChangeId
          || commit.binding.integrationChangeId !== result.integrationChangeId
          || !sameApproval(commit.binding.approvalRef, this.state.approval)
          || (previous?.commit !== undefined && !sameBinding(previous.commit.binding, commit.binding))) {
        throw identityError('已写入状态缺少属于这份批准的提交事实，已拒绝使用。');
      }
    }
    if (previous?.phase === 'written' && result.phase !== 'written') {
      // A successful HTTP response saying "unknown" is still weaker evidence than a
      // commit already acknowledged in this controller's exact approval/target scope.
      const uncertain = result.phase === 'unknown';
      const targetBlocked = this.state.targetBlocked || !uncertain || result.blockers.some(isReviewApplyTargetError);
      this.state = { ...this.state,
        status: { ...previous, phase: 'written', canWrite: false, currentProject: 'unknown' },
        request: 'idle', targetBlocked,
        sync: targetBlocked ? 'not-loaded' : this.state.sync,
        message: uncertain
          ? `已确认写入；本次状态查询暂时无法确认当前情况。不会再次写回。${targetBlocked ? '请先重新核对目标。' : '仍可明确加载当前项目内容。'}`
          : result.phase === 'recovery-required'
            ? '这份结果此前已确认写入；当前存储报告需要恢复。请通过原恢复入口处理，再检查状态；这里不会再次写入。'
            : '这份结果此前已确认写入；本次查询与已确认提交不一致。请重新检查状态，暂不加载或再次写回。',
      };
      return;
    }
    const targetBlocked = result.blockers.some(isReviewApplyTargetError);
    this.state = { ...this.state, status: structuredClone(result), request: 'idle', targetBlocked,
      sync: targetBlocked ? 'not-loaded' : this.state.sync,
      message: targetBlocked ? '目标状态需要重新核对，暂不加载或进入编辑。' : '' };
  }

  private async request(action: ReviewApplyRequest['action']): Promise<void> {
    clearTimeout(this.recheck);
    const epoch = ++this.epoch;
    const last = this.state.status;
    this.state = { ...this.state, request: action === 'write-approved-result' ? 'writing' : 'checking', message: '' };
    this.emit();
    try {
      const result = await this.transport({ protocolVersion: '1.0.0', action, approvalRef: { ...this.state.approval } });
      if (!this.current(epoch)) return;
      this.acceptStatus(result, last);
      // The existing workspace grace period can end without another UI event.
      // Re-read only; writing still requires a new explicit click.
      if (result.phase === 'blocked' && result.retryAfterMs !== undefined) {
        this.recheck = setTimeout(() => { void this.check(); }, Math.max(100, result.retryAfterMs));
      }
    } catch (error) {
      if (!this.current(epoch)) return;
      const mismatch = isReviewApplyTargetError(error);
      const status = last?.phase === 'written'
        ? { ...last, canWrite: false, currentProject: 'unknown' as const }
        : last === null ? null : { ...last, phase: 'unknown' as const, canWrite: false };
      this.state = { ...this.state, status, request: 'idle',
        targetBlocked: this.state.targetBlocked || mismatch,
        sync: mismatch ? 'not-loaded' : this.state.sync,
        message: mismatch
          ? `目标状态核对失败：${errorMessage(error)} ${last?.phase === 'written' ? '已确认的写入记录保留；' : ''}暂不加载或进入编辑。`
          : last?.phase === 'written'
            ? `已确认写入；本次查询暂时失败：${errorMessage(error)} 不会再次写回。`
            : action === 'write-approved-result'
              ? '写入响应未确认。先检查写入状态，不重复点击写回。'
              : `状态暂时不可读取：${errorMessage(error)}`,
      };
    }
    this.emit();
  }

  async synchronize(): Promise<void> {
    const target = this.state.status;
    if (this.disposed || target?.phase !== 'written' || this.state.request !== 'idle'
        || this.editorBusy() || this.state.targetBlocked) return;
    const epoch = ++this.epoch;
    this.state = { ...this.state, sync: 'checking', message: '', continuation: 'idle', continuationMessage: '' };
    this.emit();
    try {
      const workspace = await this.editor.inspect();
      if (!this.current(epoch)) return;
      if (workspace.hasUnsavedDrafts || workspace.transitioning) {
        this.state = { ...this.state, sync: 'drafts-blocked',
          message: '项目已经写入。当前编辑器有未保存内容或正在切换，请先处理；这里不会丢弃草稿。' };
        this.emit();
        return;
      }
      const loaded = await this.editor.synchronize(target.projectIdentity);
      if (!this.current(epoch)) return;
      if (loaded.projectIdentity !== target.projectIdentity || !loaded.loadedCurrentDisk) {
        throw new Error('未确认已加载目标项目的新内容。');
      }
      this.state = { ...this.state, sync: 'synchronized', message: '已加载当前项目内容，可以继续编辑。' };
    } catch (error) {
      if (!this.current(epoch)) return;
      this.state = { ...this.state, sync: 'failed',
        message: `项目已经写入，但编辑器尚未确认同步：${errorMessage(error)}` };
    }
    this.emit();
  }

  async continueWriting(): Promise<void> {
    const target = this.state.status;
    if (this.disposed || target?.phase !== 'written' || this.state.sync !== 'synchronized'
        || this.state.request !== 'idle' || this.editorBusy() || this.state.targetBlocked) return;
    const epoch = ++this.epoch;
    let stage: 'inspect' | 'navigate' | 'confirm' = 'inspect';
    this.state = { ...this.state, continuation: 'opening', continuationMessage: '', message: '' };
    this.emit();
    try {
      const current = await this.editor.inspect();
      if (!this.current(epoch)) return;
      if (current.projectIdentity !== target.projectIdentity || current.transitioning) {
        this.state = { ...this.state, sync: 'not-loaded', continuation: 'failed',
          continuationMessage: '编辑器已切换项目或正在切换，未进入剧本。请重新加载这次写入的项目。' };
        this.emit();
        return;
      }
      // Navigating within the same project must preserve even newly created drafts.
      // It is not another reload, save, commit, or approval operation.
      stage = 'navigate';
      await this.editor.continueWriting(target.projectIdentity);
      if (!this.current(epoch)) return;
      stage = 'confirm';
      const after = await this.editor.inspect();
      if (!this.current(epoch)) return;
      if (after.projectIdentity !== target.projectIdentity || after.transitioning) {
        this.state = { ...this.state, sync: 'not-loaded', continuation: 'failed',
          continuationMessage: '进入剧本期间项目发生切换，未确认在正确项目中。请重新加载目标项目。' };
        this.emit();
        return;
      }
      this.state = { ...this.state, continuation: 'opened', continuationMessage: '', message: '已回到剧本工作面。' };
    } catch (error) {
      if (!this.current(epoch)) return;
      const reason = stage === 'inspect' ? '无法读取当前工作区，尚未尝试进入剧本'
        : stage === 'navigate' ? '进入剧本未完成确认' : '无法核对导航后的工作区';
      this.state = { ...this.state, continuation: 'failed', message: '',
        continuationMessage: `${reason}：${errorMessage(error)} 项目写入不受影响，可重试进入剧本。` };
    }
    this.emit();
  }
}
