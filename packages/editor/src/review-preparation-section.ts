import { type ReviewPreparationReference, type ReviewPreparationStatus } from '@surdet/authoring';
import { h } from './state.js';
import { createReviewPreparationClient, preparationErrorMessage } from './review-preparation-client.js';
import type { ReviewWorkspaceState } from './review-workspace.js';

const labels = { plan: '核对决定并生成计划', compose: '准备隔离组合', diff: '整理实际变更',
  validate: '校验结果', simulate: '模拟运行', run: '检查实际运行路径', result: '生成结果审阅', ready: '试玩结果已准备好' };
export interface ReviewPreparationOptions {
  onOpenPreparedResult?: (source: ReviewWorkspaceState, decision: ReviewPreparationReference) => Promise<void>;
  onRememberPreparation?: (decision: ReviewPreparationReference) => void;
}
let active: { workspace: ReviewWorkspaceState; host: HTMLElement; controller: ReviewPreparationController } | null = null;

export class ReviewPreparationController {
  status: ReviewPreparationStatus | null = null;
  busy = false;
  message = '';
  errorCode = '';
  private disposed = false;
  constructor(readonly decision: ReviewPreparationReference,
    private readonly client: ReturnType<typeof createReviewPreparationClient>,
    private readonly notify: () => void,
    private readonly onOpen: () => Promise<void>,
    private readonly remember: () => void) {}
  dispose(): void { this.disposed = true; }
  private emit(): void { if (!this.disposed) this.notify(); }
  private fail(error: unknown): void {
    this.message = preparationErrorMessage(error);
    this.errorCode = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'REVIEW_PREPARATION_UNKNOWN';
  }
  async check(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.message = ''; this.errorCode = ''; this.emit();
    try { const result = await this.client.status(this.decision, 'inspect-preparation'); if (!this.disposed) this.status = result; }
    catch (error) { if (!this.disposed) this.fail(error); }
    finally { this.busy = false; this.emit(); }
  }
  async prepare(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.message = ''; this.errorCode = ''; this.emit();
    try {
      this.remember();
      // Every start/restart first reconciles persisted facts. An unknown response
      // stops the loop; it cannot become permission to create another result.
      this.status = await this.client.status(this.decision, 'inspect-preparation');
      while (!this.disposed && (this.status.stage !== 'ready' || this.status.working)) {
        if (this.status.working) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (this.disposed) return;
          this.status = await this.client.status(this.decision, 'inspect-preparation');
        } else {
          this.status = await this.client.status(this.decision, 'prepare-result');
          if (this.status.error) { this.message = this.status.error.message; this.errorCode = this.status.error.code; break; }
        }
        this.emit();
      }
      if (!this.disposed && this.status.stage === 'ready' && !this.errorCode) await this.onOpen();
    } catch (error) { if (!this.disposed) this.fail(error); }
    finally { this.busy = false; this.emit(); }
  }
  async open(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.message = ''; this.errorCode = ''; this.emit();
    try {
      this.status = await this.client.status(this.decision, 'inspect-preparation');
      if (this.status.stage === 'ready' && !this.status.working && !this.disposed) { this.remember(); await this.onOpen(); }
      else this.message = '正在核对已有操作，请稍后检查准备进度。';
    } catch (error) { if (!this.disposed) this.fail(error); }
    finally { this.busy = false; this.emit(); }
  }
}

export function disposeReviewPreparation(): void { active?.controller.dispose(); active = null; }

export function renderReviewPreparation(parent: HTMLElement, workspace: ReviewWorkspaceState | null, options: ReviewPreparationOptions): void {
  if (active && active.workspace !== workspace) disposeReviewPreparation();
  if (!workspace || workspace.projection.kind !== 'comparison' || !workspace.decisionReceipt) return;
  if (active) { parent.appendChild(active.host); return; }
  const host = h('section', 'review-section review-preparation');
  const config = globalThis.__SURDET_REVIEW_AUTHORITY__;
  if (!config || !options.onOpenPreparedResult) {
    host.appendChild(h('p', 'review-warning', '从绑定来源项目的正常编辑器入口打开，即可准备试玩结果。'));
    parent.appendChild(host); return;
  }
  const receipt = workspace.decisionReceipt;
  const decision: ReviewPreparationReference = { projectIdentity: workspace.identity.projectIdentity, reviewId: workspace.identity.reviewId,
    reviewPayload: { bytes: workspace.identity.payload.bytes, sha256: workspace.identity.payload.sha256 },
    decisionId: receipt.decisionId, decisionFingerprint: receipt.decisionFingerprint };
  const render = () => {
    const focused = host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset['action'] : undefined;
    host.replaceChildren();
    host.appendChild(h('h2', undefined, '准备试玩结果'));
    host.appendChild(h('p', undefined, '按照已保存的选择生成隔离结果，完成后直接打开；来源项目保持原样。'));
    const status = controller.status;
    const progress = h('p', 'review-preparation-progress', controller.busy
      ? `${labels[status?.stage ?? 'plan']}……` : status?.stage === 'ready' ? labels.ready
        : status?.started ? `准备停在：${labels[status.stage]}，可以继续。` : '决定已保存，可以开始准备。');
    progress.setAttribute('role', 'status'); host.appendChild(progress);
    const error = controller.message || status?.error?.message;
    host.dataset['preparationStage'] = status?.stage ?? 'unknown';
    host.dataset['preparationError'] = controller.errorCode || status?.error?.code || '';
    if (error) host.appendChild(h('p', 'review-warning', error));
    const actions = h('div', 'review-preparation-actions');
    const button = (label: string, action: string, run: () => Promise<void>) => {
      const b = h('button', undefined, label) as HTMLButtonElement;
      b.dataset['action'] = action; b.dataset['actionScope'] = 'workspace'; b.disabled = controller.busy;
      b.onclick = () => { void run(); }; actions.appendChild(b);
    };
    button('检查准备进度', 'inspect-result-preparation', () => controller.check());
    if (status?.stage === 'ready') button('打开试玩结果', 'open-prepared-result', () => controller.open());
    else button(status?.started ? '继续准备结果' : '准备试玩结果', 'prepare-review-result', () => controller.prepare());
    host.appendChild(actions);
    if (focused) host.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  };
  const controller = new ReviewPreparationController(decision, createReviewPreparationClient({ token: config.token }), render,
    () => options.onOpenPreparedResult!(workspace, decision), () => options.onRememberPreparation?.(decision));
  active = { workspace, host, controller }; parent.appendChild(host); render(); void controller.check();
}
