import type {
  HumanReviewProjection,
  ReviewConflict,
  ReviewRuntimePathFact,
  ReviewDecisionIntent,
} from '@surdet/authoring';
import { state, h, setStatus } from '../state.js';
import { publishEditorWorkspaceState, flushEditorWorkspaceState } from '../editor-workspace.js';
import { ReviewApplyController, type ExistingEditorSyncPort } from '../review-apply-controller.js';
import { createReviewApplyClient } from '../review-apply-client.js';
import { renderReviewApplySection } from '../review-apply-section.js';
import { renderReviewPreparation, type ReviewPreparationOptions } from '../review-preparation-section.js';
import {
  canSealDecision,
  labelForCandidate,
  labelForConflictSeverity,
  labelForDisposition,
  labelForFreshness,
  labelForObjectKind,
  labelForObjectRef,
  labelForReviewState,
  labelForUnknownCode,
  presentationForReviewUnit,
} from '../review-model.js';
import {
  markReviewFixtureChanged,
  openReviewPreview,
  refreshReviewFixtureIdentity,
  reconcileReviewTraceEvidence,
  restoreOfficialResult,
  type ReviewPreviewRequest,
} from '../review-preview.js';
import {
  openReviewWorkspace,
  pendingTerminalActionOf,
  writeApprovalReceipt,
  writeDecisionReceipt,
  writeReturnReceipt,
  canSaveReviewDecision,
  previewReviewDecision,
  type ReviewDecisionDraft,
  type ReviewWorkspaceState,
} from '../review-workspace.js';
import { renderReviewCausalPanel } from './right.js';
import { renderPreviewPanel } from './preview-panel.js';
import type { ReviewTerminalClient } from '../review-terminal-client.js';

export interface ReviewPanelOptions extends ReviewPreparationOptions {
  now?: () => string;
  onPreview?: (workspace: ReviewWorkspaceState, request: ReviewPreviewRequest) => Promise<void> | void;
  onReloadOfficialResult?: (workspace: ReviewWorkspaceState) => Promise<void> | void;
  onRefreshFixtureIdentity?: (workspace: ReviewWorkspaceState) => Promise<unknown> | unknown;
  reviewTerminalClient?: ReviewTerminalClient;
  reviewApplyEditor?: ExistingEditorSyncPort;
}

let activeApply: { workspace: ReviewWorkspaceState; approvalFingerprint: string;
  controller: ReviewApplyController; host: HTMLElement } | null = null;

export function disposeReviewApply(): void {
  activeApply?.controller.dispose();
  activeApply = null;
}

function appendApprovedApply(parent: HTMLElement, workspace: ReviewWorkspaceState, options: ReviewPanelOptions): void {
  const approval = workspace.approvalReceipt;
  if (approval === null || workspace.returnReceipt !== null || options.reviewApplyEditor === undefined) return;
  if (activeApply !== null && (activeApply.workspace !== workspace
    || activeApply.approvalFingerprint !== approval.approvalFingerprint)) disposeReviewApply();
  if (activeApply === null) {
    const host = h('div');
    const config = globalThis.__SURDET_REVIEW_AUTHORITY__;
    if (config === undefined) {
      host.appendChild(h('p', 'review-warning', '本机写回服务未连接，请从绑定项目的编辑器入口打开。'));
      parent.appendChild(host);
      return;
    }
    const client = createReviewApplyClient({ token: config.token });
    const ref = { resultReviewId: approval.resultReviewId, approvalId: approval.approvalId,
      approvalFingerprint: approval.approvalFingerprint };
    const controller = new ReviewApplyController(ref, async (request) => {
      if (request.action === 'write-approved-result') await flushEditorWorkspaceState();
      return client.execute(request);
    }, options.reviewApplyEditor, (view) => {
      if (activeApply?.controller !== controller) return;
      renderReviewApplySection(activeApply.host, view, controller);
    });
    activeApply = { workspace, approvalFingerprint: approval.approvalFingerprint, controller, host };
    renderReviewApplySection(host, controller.snapshot, controller);
    void controller.check();
  }
  parent.appendChild(activeApply.host);
}

function nowOf(options: ReviewPanelOptions): string {
  return options.now?.() ?? new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ReviewEvidenceView = HumanReviewProjection['candidates'][number]['evidence'];
type ReviewUnitView = NonNullable<ReviewConflict['options']>[number];
type ReviewSafeGroupView = HumanReviewProjection['safeGroups'][number];
type ReviewResult = NonNullable<HumanReviewProjection['finalResult']>;
type ResultPlanView = NonNullable<ReviewResult['plan']>;
type ResultDiffView = NonNullable<ReviewResult['diff']>;

function listText(values: readonly string[]): string {
  return values.length === 0 ? '无' : values.join('、');
}

function impactText(values: readonly unknown[]): string {
  if (values.length === 0) return '无';
  return values.map((value) => typeof value === 'string' ? value : '结构化影响').join('、');
}

function candidateIdForCapsule(
  projection: HumanReviewProjection,
  ref: { changeId: string; capsuleId: string; artifactSha256: string },
): string | undefined {
  return projection.candidates.find((candidate) =>
    candidate.ref.changeId === ref.changeId
    && candidate.ref.capsuleId === ref.capsuleId
    && candidate.ref.artifactSha256 === ref.artifactSha256)?.candidateId;
}

function labelForSourceCapsule(
  projection: HumanReviewProjection,
  plan: ResultPlanView,
  ref: { changeId: string; capsuleId: string; artifactSha256: string },
): string {
  const sourceCandidate = plan.sourceCandidates.find((candidate) =>
    candidate.ref.changeId === ref.changeId
    && candidate.ref.capsuleId === ref.capsuleId
    && candidate.ref.artifactSha256 === ref.artifactSha256);
  if (sourceCandidate !== undefined) return `方案 ${sourceCandidate.displayOrdinal}`;
  return labelForCandidate(projection, candidateIdForCapsule(projection, ref));
}

function candidateEvidenceSummary(evidence: ReviewEvidenceView): string {
  const statuses = [
    `校验 ${labelForFreshness(evidence.validation)}`,
    `模拟 ${labelForFreshness(evidence.simulation)}`,
    `运行 ${labelForFreshness(evidence.runtime)}`,
  ];
  if (evidence.warnings > 0) statuses.push(`${evidence.warnings} 项警告`);
  if (evidence.manualReviewRequired.length > 0) statuses.push(`人工检查：${evidence.manualReviewRequired.join('、')}`);
  return statuses.join('；');
}

function appendUnitPresentation(container: HTMLElement, unit: ReviewUnitView): void {
  const presentation = presentationForReviewUnit(unit);
  const heading = h('div', 'review-presentation-heading');
  heading.appendChild(h('strong', undefined, presentation.actionLabel));
  heading.appendChild(h('span', 'review-presentation-object', presentation.objectLabel));
  container.appendChild(heading);
  if (presentation.completeness === 'metadata-only') {
    container.appendChild(h('div', 'review-presentation-incomplete', '内容摘要不足：当前审阅包只提供可核对的对象元数据。'));
  }
  for (const highlight of presentation.highlights) {
    container.appendChild(h('div', 'review-presentation-highlight', highlight));
  }
  if (presentation.omittedFactCount > 0) {
    container.appendChild(h('div', 'review-presentation-omitted', `另有 ${presentation.omittedFactCount} 项内容未完整展示`));
  }
}

function projectionHasLegacyUnitPresentation(projection: HumanReviewProjection): boolean {
  return projection.safeGroups.some((group) => group.sources.some((source) => source.presentation === undefined))
    || projection.conflicts.some((conflict) => conflict.options.some((option) => option.presentation === undefined));
}

function safeGroupEvidenceBadges(group: ReviewSafeGroupView): string[] {
  const evidence = group.evidence;
  const badges: string[] = [];
  if (evidence.missing) badges.push('证据缺失');
  if (evidence.stale) badges.push('证据过期');
  if (evidence.failed) badges.push('证据失败');
  if (evidence.incomplete) badges.push('证据不完整');
  if (evidence.warningCount > 0) badges.push(`${evidence.warningCount} 项警告`);
  if (evidence.manualReviewRequired.length > 0) badges.push('需要人工检查');
  return badges.length === 0 ? ['证据正常'] : badges;
}

function appendFact(container: HTMLElement, label: string, value: string): void {
  container.appendChild(h('div', 'review-result-fact', `${label}：${value}`));
}

function appendTechDetails(
  container: HTMLElement,
  projection: HumanReviewProjection,
  summary = '查看技术详情',
): HTMLDetailsElement {
  const details = h('details', 'review-technical-disclosure') as HTMLDetailsElement;
  details.setAttribute('data-tech-details', '');
  details.appendChild(h('summary', undefined, summary));
  details.ontoggle = () => {
    if (!details.open || details.childElementCount > 1) return;
    const conflictCodes = projection.conflicts.map((conflict) => conflict.code).join(', ') || '无';
    const capsule = projection.candidates.map((candidate) => ({ candidateId: candidate.candidateId, ref: candidate.ref }));
    details.appendChild(h('pre', 'mono', [
      `reviewId: ${projection.reviewId}`,
      `code: ${conflictCodes}`,
      `reviewFingerprint: ${projection.reviewFingerprint}`,
      `comparisonFingerprint: ${projection.sourceIdentity.comparisonFingerprint}`,
      `source capsule: ${JSON.stringify(capsule)}`,
    ].join('\n')));
  };
  container.appendChild(details);
  return details;
}

function markReviewSection<T extends HTMLElement>(element: T, section: string): T {
  element.setAttribute('data-review-section', section);
  return element;
}

function resetDecisionIdentityIfChanged(workspace: ReviewWorkspaceState, previous: string): void {
  if (decisionContentIdentity(workspace.decisionDraft) === previous) return;
  workspace.decisionDraft.decisionId = '';
  decisionSealStates.delete(workspace);
  publishEditorWorkspaceState();
}

function safeGroupIncluded(workspace: ReviewWorkspaceState, group: ReviewSafeGroupView): boolean {
  return group.unitIds.some((unitId) => workspace.decisionDraft.selectedUnitIds.includes(unitId));
}

function setSafeGroupIncluded(
  workspace: ReviewWorkspaceState,
  group: ReviewSafeGroupView,
  included: boolean,
): void {
  const previous = decisionContentIdentity(workspace.decisionDraft);
  const selected = new Set(workspace.decisionDraft.selectedUnitIds);
  for (const unitId of group.unitIds) {
    if (included) selected.add(unitId);
    else selected.delete(unitId);
  }
  workspace.decisionDraft.selectedUnitIds = [...selected];
  if (!included) {
    const removed = new Set(group.unitIds);
    workspace.decisionDraft.conflictResolutions = workspace.decisionDraft.conflictResolutions.filter((resolution) => (
      resolution.resolution !== 'choose-unit'
      || resolution.chosenUnitId === undefined
      || !removed.has(resolution.chosenUnitId)
    ));
  }
  resetDecisionIdentityIfChanged(workspace, previous);
}

function setResolution(
  workspace: ReviewWorkspaceState,
  conflict: ReviewConflict,
  resolution: ReviewDecisionDraft['conflictResolutions'][number]['resolution'],
  chosenUnitId?: string,
): void {
  const previous = decisionContentIdentity(workspace.decisionDraft);
  const next = workspace.decisionDraft.conflictResolutions.filter((item) => item.conflictId !== conflict.conflictId);
  next.push({
    conflictId: conflict.conflictId,
    resolution,
    ...(chosenUnitId === undefined ? {} : { chosenUnitId }),
  });
  workspace.decisionDraft.conflictResolutions = next;
  if (resolution === 'choose-unit' && chosenUnitId !== undefined) {
    const selected = new Set(workspace.decisionDraft.selectedUnitIds);
    for (const unitId of conflict.unitIds) {
      if (unitId !== chosenUnitId) selected.delete(unitId);
    }
    selected.add(chosenUnitId);
    workspace.decisionDraft.selectedUnitIds = [...selected];
  }
  resetDecisionIdentityIfChanged(workspace, previous);
}

interface DecisionSealState {
  decisionId: string;
  decidedAt: string;
}

const decisionSealStates = new WeakMap<ReviewWorkspaceState, DecisionSealState>();
const decisionWrites = new WeakSet<ReviewWorkspaceState>();
const resultWrites = new WeakSet<ReviewWorkspaceState>();
const resultPreviews = new WeakSet<ReviewWorkspaceState>();
const resultFixtureOperations = new WeakSet<ReviewWorkspaceState>();

function appendReviewWorkspaceHeader(
  shell: HTMLElement,
  projection: HumanReviewProjection,
  summary: string,
): HTMLElement {
  const header = h('header', 'review-workspace-header');
  header.setAttribute('data-review-kind', projection.kind);
  const heading = h('div', 'review-workspace-heading');
  heading.appendChild(h('div', 'review-workspace-kicker', projection.kind === 'comparison' ? '候选方案校对' : '最终结果校对'));
  heading.appendChild(h('h2', undefined, projection.task.title));
  if (projection.reviewVersion === '1.0.0' && projection.task.goal) heading.appendChild(h('p', 'review-workspace-goal', projection.task.goal));
  header.appendChild(heading);
  const status = h('div', 'review-workspace-status');
  const stateLabel = h('strong', 'review-state', labelForReviewState(projection.state));
  status.appendChild(stateLabel);
  status.appendChild(h('span', 'review-workspace-summary', summary));
  header.appendChild(status);
  shell.appendChild(header);
  return stateLabel;
}

function appendAuthorityStatus(container: HTMLElement, workspace: ReviewWorkspaceState): void {
  if (workspace.authority.state === 'available') return;
  const status = h('div', `review-authority-status ${workspace.authority.state}`, workspace.authority.message);
  status.setAttribute('data-review-authority-state', workspace.authority.state);
  container.appendChild(status);
}

function terminalErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (code === 'REVIEW_BUSY') return '另一个窗口正在保存这项决定，请稍候刷新。';
  if (code === 'REVIEW_AUTHORITY_UNAVAILABLE') return '本机审阅服务未连接。请从 Surdet 正常入口重新打开。';
  if (code === 'REVIEW_TERMINAL_ALREADY_SET') return '其他窗口已经保存了正式回执，界面已按正式结果锁定。';
  if (code === 'REVIEW_IDENTITY_MISMATCH') return '本机审阅服务与当前审阅任务不一致，请重新打开审阅任务。';
  if (code === 'REVIEW_DECISION_INVALID' || code === 'INVALID_REQUEST') return '当前决定内容不完整或格式无效，请检查后再保存。';
  if (code === 'REVIEW_DECISION_STALE' || code === 'REVIEW_APPROVAL_STALE') return '审阅依据已经变化，请重新打开并核对最新结果。';
  if (code === 'REVIEW_NOT_FOUND') return '本机审阅服务找不到这项任务，请从 Surdet 正常入口重新打开。';
  if (code === 'REVIEW_FORMAT_UNSUPPORTED' || code === 'CHANGE_STORE_CORRUPT' || code === 'LEASE_CORRUPT') {
    return '本机审阅数据不完整或已损坏，终态操作已停止。';
  }
  if (code === 'REVIEW_RETURNED') return '这项结果已经退回修改，不能再次批准。';
  return '操作未完成。内容仍可查看，请重新打开审阅任务后再试。';
}

function decisionContentIdentity(draft: ReviewDecisionDraft): string {
  return JSON.stringify({
    selectedUnitIds: [...draft.selectedUnitIds].sort((left, right) => left.localeCompare(right)),
    conflictResolutions: [...draft.conflictResolutions]
      .map((resolution) => ({ ...resolution }))
      .sort((left, right) => left.conflictId.localeCompare(right.conflictId)),
  });
}

function sealDecisionState(workspace: ReviewWorkspaceState, options: ReviewPanelOptions): DecisionSealState {
  const existing = decisionSealStates.get(workspace);
  if (workspace.decisionDraft.decisionId.length === 0) {
    if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('当前浏览器不能生成决定 ID');
    workspace.decisionDraft.decisionId = globalThis.crypto.randomUUID();
  }
  if (existing !== undefined && existing.decisionId === workspace.decisionDraft.decisionId) return existing;
  const sealed = { decisionId: workspace.decisionDraft.decisionId, decidedAt: nowOf(options) };
  decisionSealStates.set(workspace, sealed);
  return sealed;
}

function appendDecisionButton(
  container: HTMLElement,
  workspace: ReviewWorkspaceState,
  label: string,
  action: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = h('button', disabled ? 'primary disabled' : 'primary', label) as HTMLButtonElement;
  button.setAttribute('data-action', action);
  button.setAttribute('data-action-scope', 'workspace');
  button.disabled = disabled;
  button.onclick = onClick;
  container.appendChild(button);
  void workspace;
  return button;
}

function renderObjectDetails(
  container: HTMLElement,
  workspace: ReviewWorkspaceState,
): HTMLElement {
  const objectPanel = h('aside', 'review-details');
  objectPanel.setAttribute('aria-label', '对象与因果');
  const update = (): void => renderReviewCausalPanel(
    objectPanel,
    workspace.projection,
    workspace.selectedReviewObjectRef,
    (objectRef) => {
      workspace.selectedReviewObjectRef = objectRef;
      state.selectedObjectRef = objectRef;
      update();
    },
  );
  update();
  container.appendChild(objectPanel);
  return objectPanel;
}

function renderComparisonReview(
  container: HTMLElement,
  workspace: ReviewWorkspaceState,
  options: ReviewPanelOptions,
): void {
  const projection = workspace.projection;
  if (projection.reviewVersion === '2.0.0') {
    renderWholeProposalReview(container, workspace, options);
    return;
  }
  const decisionSaved = workspace.receiptStatus === 'decision-written';
  const legacyReadOnly = projection.reviewVersion === '1.0.0';
  const authorityWritable = workspace.authority.state === 'available';
  const pendingTerminalAction = pendingTerminalActionOf(workspace);
  const decisionChoiceLocked = legacyReadOnly || decisionSaved
    || decisionWrites.has(workspace)
    || pendingTerminalAction !== null
    || !authorityWritable;
  const decisionSubmitLocked = legacyReadOnly || decisionSaved || decisionWrites.has(workspace) || !authorityWritable;
  const unresolvedCount = projection.conflicts.filter((conflict) => (
    conflict.severity === 'blocking'
    || (conflict.severity === 'selection-required'
      && !workspace.decisionDraft.conflictResolutions.some((resolution) => resolution.conflictId === conflict.conflictId))
  )).length;
  const shell = h('div', 'review-workbench');
  appendReviewWorkspaceHeader(
    shell,
    projection,
    `候选 ${projection.task.candidateCount} 个 · ${unresolvedCount > 0 ? `待决定 ${unresolvedCount} 项` : '冲突已处理'} · 自动纳入 ${projection.safeGroups.length} 组`,
  );
  const taskList = h('aside', 'review-task-list');
  taskList.setAttribute('aria-label', '审阅目录');
  taskList.appendChild(h('h2', undefined, '审阅目录'));
  taskList.appendChild(h('div', 'review-task-progress', unresolvedCount > 0 ? `还需决定 ${unresolvedCount} 项` : '所有冲突已处理'));
  if (projection.task.acceptanceCriteria.length > 0) {
    taskList.appendChild(h('h3', undefined, '验收标准'));
    for (const criterion of projection.task.acceptanceCriteria) taskList.appendChild(h('div', 'review-criterion', criterion));
  }
  taskList.appendChild(h('h3', undefined, '候选方案'));
  taskList.appendChild(h(
    'div',
    'review-ordinal-note',
    '方案字母只用于本次审阅排序；请根据内容摘要选择，系统会用稳定来源身份保存决定。',
  ));
  for (const candidate of projection.candidates) {
    const item = h('div', 'review-candidate');
    item.appendChild(h('strong', undefined, `方案 ${candidate.displayOrdinal}（本次审阅编号）`));
    if (candidate.declaredIntent) item.appendChild(h('div', undefined, `候选声明目标：${candidate.declaredIntent}`));
    taskList.appendChild(item);
  }
  shell.appendChild(taskList);

  const main = h('section', 'review-main');
  main.setAttribute('aria-label', '审阅正文');
  main.setAttribute('data-review-main', 'comparison');
  const overview = markReviewSection(h('section', 'review-section review-overview'), 'overview');
  overview.appendChild(h('div', 'review-section-kicker', '比较结果'));
  overview.appendChild(h('h2', undefined, '这次需要校对什么'));
  overview.appendChild(h('p', 'review-overview-goal', projection.task.goal ?? '核对候选内容，处理分歧后保存决定。'));
  overview.appendChild(h('p', 'review-warning', '这是旧版只读审阅；已有决定仍然有效。要作出新决定，请创建新版整案审阅。'));
  overview.appendChild(h('div', 'review-evidence-summary', `共 ${projection.task.candidateCount} 个方案，涉及 ${projection.task.objectCount} 个对象`));
  appendAuthorityStatus(overview, workspace);
  if (workspace.decisionReceipt !== null) {
    const marker = h('div', 'review-receipt-status', '已读取已保存的决定');
    marker.setAttribute('data-decision-receipt', 'written');
    marker.setAttribute('data-review-receipt-status', workspace.receiptStatus);
    marker.setAttribute('data-decision-id', workspace.decisionReceipt.decisionId);
    marker.setAttribute('data-decision-fingerprint', workspace.decisionReceipt.decisionFingerprint);
    overview.appendChild(marker);
  }
  if (projectionHasLegacyUnitPresentation(projection)) {
    overview.appendChild(h(
      'div',
      'review-warning review-legacy-presentation',
      '旧审阅包缺少内容摘要；已有决定仍可读取，未提供的内容不会被臆测。',
    ));
  }
  main.appendChild(overview);
  overview.appendChild(h('p', 'review-warning', '这是旧版逐项审阅。要使用整案采用和保存前预览，请重新生成审阅任务；已有回执仍保持有效。'));

  let decisionButton: HTMLButtonElement | null = null;
  const decisionControls: HTMLButtonElement[] = [];
  const decisionChoiceLabels = new Map<HTMLButtonElement, string>();
  const refreshDecisionControls = (): void => {
    for (const [control, baseLabel] of decisionChoiceLabels) {
      const unitId = control.getAttribute('data-choice-unit');
      const conflictId = control.getAttribute('data-choice-conflict');
      const excludeId = control.getAttribute('data-choice-exclude');
      const regenerateId = control.getAttribute('data-choice-regenerate');
      const selected = unitId !== null && conflictId !== null
        ? workspace.decisionDraft.conflictResolutions.some((resolution) => (
            resolution.conflictId === conflictId
            && resolution.resolution === 'choose-unit'
            && resolution.chosenUnitId === unitId
          ))
        : excludeId !== null
          ? workspace.decisionDraft.conflictResolutions.some((resolution) => resolution.conflictId === excludeId && resolution.resolution === 'exclude-all')
          : regenerateId !== null
            && workspace.decisionDraft.conflictResolutions.some((resolution) => resolution.conflictId === regenerateId && resolution.resolution === 'regenerate-candidate');
      control.setAttribute('data-choice-selected', selected ? 'true' : 'false');
      control.setAttribute('aria-pressed', selected ? 'true' : 'false');
      control.textContent = `${baseLabel}${selected ? ' · 已选择' : ''}`;
    }
  };
  const refreshDecisionSubmit = (): void => {
    if (decisionButton !== null) decisionButton.disabled = decisionSubmitLocked || !canSealDecision(projection, workspace.decisionDraft);
  };

  const safeSection = markReviewSection(h('section', 'review-section review-safe-section'), 'safe-results');
  safeSection.appendChild(h('h2', undefined, '将自动纳入'));
  if (projection.safeGroups.length > 0) {
    for (const group of projection.safeGroups) {
      const view = group;
      const badges = safeGroupEvidenceBadges(group);
      const entry = h('div', 'review-safe-entry');
      const item = h('details', 'review-safe-group') as HTMLDetailsElement;
      item.setAttribute('data-safe-group', group.groupId);
      const summary = h('summary', 'review-safe-summary');
      summary.appendChild(h('strong', undefined, `内容结果相同，保留 ${group.sourceCount} 个来源`));
      summary.appendChild(h('span', 'review-safe-equivalence', `${group.sourceCount} 个方案得到相同结果`));
      summary.appendChild(h('span', 'review-safe-object', labelForObjectRef(group.primaryObject)));
      summary.appendChild(h('span', 'review-safe-default', '自动纳入'));
      for (const badge of badges) summary.appendChild(h('span', badge === '证据正常' ? 'review-safe-badge ok' : 'review-safe-badge', badge));
      item.appendChild(summary);

      const toggle = h('button', 'review-safe-toggle') as HTMLButtonElement;
      toggle.type = 'button';
      toggle.setAttribute('data-safe-group-toggle', group.groupId);
      toggle.setAttribute('data-action-scope', 'workspace');
      const refreshSafeToggle = (): void => {
        const included = safeGroupIncluded(workspace, group);
        toggle.setAttribute('aria-pressed', included ? 'true' : 'false');
        toggle.textContent = included ? '排除本组' : '保留本组';
      };
      refreshSafeToggle();
      toggle.disabled = decisionChoiceLocked;
      toggle.onclick = () => {
        if (decisionChoiceLocked) return;
        setSafeGroupIncluded(workspace, group, !safeGroupIncluded(workspace, group));
        refreshSafeToggle();
        refreshDecisionControls();
        refreshDecisionSubmit();
      };
      decisionControls.push(toggle);

      const body = h('div', 'review-safe-body');
      const sources = view.sources;
      const sourceList = h('div', 'review-safe-sources');
      for (const source of sources) {
        const sourceItem = h('article', 'review-safe-source');
        sourceItem.appendChild(h('strong', undefined, labelForCandidate(projection, source.candidateId)));
        appendUnitPresentation(sourceItem, source);
        if (source.outcomes.length > 0) {
          for (const outcome of source.outcomes) {
            sourceItem.appendChild(h('div', 'review-outcome', `${labelForDisposition(outcome.disposition)} ${labelForObjectRef(outcome.objectRef)}`));
          }
        } else {
          sourceItem.appendChild(h('div', 'review-outcome', `结果 ${labelForObjectRef(source.primaryObject)}`));
        }
        sourceItem.appendChild(h('div', 'review-source-evidence', candidateEvidenceSummary(source.evidence)));
        const candidate = projection.candidates.find((item) => item.candidateId === source.candidateId);
        if (candidate !== undefined) {
          const sourceIdentity = h('details', 'review-source-identity') as HTMLDetailsElement;
          sourceIdentity.setAttribute('data-source-technical', source.unitId);
          sourceIdentity.appendChild(h('summary', undefined, '查看来源技术身份'));
          sourceIdentity.appendChild(h('pre', 'review-source-capsule mono', [
            `unitId: ${source.unitId}`,
            `candidateId: ${candidate.candidateId}`,
            `changeId: ${candidate.ref.changeId}`,
            `capsuleId: ${candidate.ref.capsuleId}`,
            `artifactSha256: ${candidate.ref.artifactSha256}`,
          ].join('\n')));
          sourceItem.appendChild(sourceIdentity);
        } else {
          sourceItem.appendChild(h('div', 'review-warning', '该来源缺少可核对的 capsule 技术身份'));
        }
        sourceList.appendChild(sourceItem);
      }
      body.appendChild(sourceList);
      const dependencyRefs = view.dependencyObjectRefs;
      body.appendChild(h('div', 'review-impact-row', dependencyRefs.length === 0
        ? '无依赖对象'
        : `依赖对象：${[...new Set(dependencyRefs)].map(labelForObjectRef).join('、')}`));
      body.appendChild(h('div', 'review-impact-row', `可能影响：${impactText(view.potentialImpact)}`));
      body.appendChild(h('div', 'review-impact-row', `实际观察：${impactText(view.observedImpact)}`));
      if (view.evidence.manualReviewRequired.length) {
        body.appendChild(h('div', 'review-warning', `人工检查：${view.evidence.manualReviewRequired.join('、')}`));
      }
      const identity = h('details', 'review-safe-identity');
      identity.appendChild(h('summary', undefined, `技术身份：${group.groupId}`));
      identity.appendChild(h('pre', 'mono', [
        `groupId: ${group.groupId}`,
        `unitIds: ${group.unitIds.join(', ')}`,
        `candidateIds: ${group.candidateIds.join(', ')}`,
        `finalFingerprint: ${group.finalFingerprint}`,
      ].join('\n')));
      body.appendChild(identity);
      item.appendChild(body);
      entry.appendChild(item);
      entry.appendChild(toggle);
      safeSection.appendChild(entry);
    }
  } else {
    safeSection.appendChild(h('p', 'review-empty-note', '没有需要自动纳入的相同结果。'));
  }

  const implicitDependencies = projection.dependencies.filter((dependency) => dependency.inclusion === 'implicit');
  const dependencySection = markReviewSection(h('section', 'review-section review-dependencies'), 'dependencies');
  dependencySection.appendChild(h('h2', undefined, '系统自动补全'));
  if (implicitDependencies.length > 0) {
    for (const dependency of implicitDependencies) {
      dependencySection.appendChild(h(
        'div',
        'review-dependency',
        `依赖自动纳入：${labelForObjectRef(dependency.fromObjectRef)} → ${labelForObjectRef(dependency.objectRef)}`,
      ));
    }
  } else {
    dependencySection.appendChild(h('p', 'review-empty-note', '没有额外的自动依赖。'));
  }

  const conflicts = projection.conflicts;
  const conflictSection = markReviewSection(h('section', 'review-section review-conflict-section'), 'decisions');
  conflictSection.appendChild(h('h2', undefined, '需要你决定'));
  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      const savedResolution = workspace.decisionDraft.conflictResolutions.find((resolution) => (
        resolution.conflictId === conflict.conflictId
      ));
      const item = h('article', `review-conflict ${conflict.severity}`);
      item.setAttribute('data-conflict-id', conflict.conflictId);
      item.appendChild(h('strong', undefined, labelForConflictSeverity(conflict.severity)));
      item.appendChild(h('div', undefined, conflict.severity === 'blocking' ? '该冲突阻止封存决定' : '请根据证据选择处理方式'));
      if (conflict.code !== 'OBJECT_RESULTS_DIVERGE') item.appendChild(h('div', 'review-unknown-code', labelForUnknownCode(conflict.code)));
      const choices = h('div', 'review-conflict-choices');
      const conflictOptions = conflict.options;
      for (const option of conflictOptions) {
        if (!conflict.allowedResolutions.includes('choose-unit')) continue;
        const candidateLabel = labelForCandidate(projection, option.candidateId);
        const presentation = presentationForReviewUnit(option);
        const highlight = presentation.highlights[0];
        const optionItem = h('article', 'review-conflict-option');
        optionItem.setAttribute('data-choice-option-unit', option.unitId);
        const selected = savedResolution?.resolution === 'choose-unit' && savedResolution.chosenUnitId === option.unitId;
        const choiceText = [
          `选择${candidateLabel}`,
          presentation.actionLabel,
          presentation.objectLabel,
          ...(highlight === undefined ? [] : [highlight]),
        ].join(' · ');
        const choice = h('button', 'review-conflict-choice', `${choiceText}${selected ? ' · 已选择' : ''}`) as HTMLButtonElement;
        choice.setAttribute('data-choice-unit', option.unitId);
        choice.setAttribute('data-choice-conflict', conflict.conflictId);
        choice.setAttribute('data-choice-selected', selected ? 'true' : 'false');
        choice.setAttribute('aria-pressed', selected ? 'true' : 'false');
        choice.title = choiceText;
        choice.disabled = decisionChoiceLocked;
        choice.onclick = () => {
          if (!authorityWritable || decisionSaved || decisionWrites.has(workspace) || pendingTerminalAction !== null || projection.state === 'RETURNED') return;
          setResolution(workspace, conflict, 'choose-unit', option.unitId);
          refreshDecisionControls();
          refreshDecisionSubmit();
        };
        decisionControls.push(choice);
        decisionChoiceLabels.set(choice, choiceText);
        optionItem.appendChild(choice);
        appendUnitPresentation(optionItem, option);
        optionItem.appendChild(h('div', 'review-impact-row', `可能影响：${impactText(option.potentialImpact)}`));
        optionItem.appendChild(h('div', 'review-impact-row', `实际观察：${impactText(option.observedImpact)}`));
        optionItem.appendChild(h('div', 'review-source-evidence', candidateEvidenceSummary(option.evidence)));
        const fingerprint = h('details', 'review-choice-fingerprint') as HTMLDetailsElement;
        fingerprint.setAttribute('data-choice-fingerprint', '');
        fingerprint.appendChild(h('summary', undefined, '查看技术详情'));
        fingerprint.appendChild(h('pre', 'mono', [
          `unitId: ${option.unitId}`,
          `candidateId: ${option.candidateId}`,
          `finalFingerprint: ${option.finalFingerprint ?? '无'}`,
        ].join('\n')));
        optionItem.appendChild(fingerprint);
        choices.appendChild(optionItem);
      }
      if (conflict.allowedResolutions.includes('exclude-all')) {
        const selected = savedResolution?.resolution === 'exclude-all';
        const exclude = h('button', undefined, `全部不要${selected ? ' · 已选择' : ''}`) as HTMLButtonElement;
        exclude.setAttribute('data-choice-exclude', conflict.conflictId);
        exclude.setAttribute('data-choice-selected', selected ? 'true' : 'false');
        exclude.setAttribute('aria-pressed', selected ? 'true' : 'false');
        exclude.disabled = decisionChoiceLocked;
        exclude.onclick = () => {
          if (!authorityWritable || decisionSaved || decisionWrites.has(workspace) || pendingTerminalAction !== null || projection.state === 'RETURNED') return;
          setResolution(workspace, conflict, 'exclude-all');
          refreshDecisionControls();
          refreshDecisionSubmit();
        };
        decisionControls.push(exclude);
        decisionChoiceLabels.set(exclude, '全部不要');
        choices.appendChild(exclude);
      }
      if (conflict.allowedResolutions.includes('regenerate-candidate')) {
        const selected = savedResolution?.resolution === 'regenerate-candidate';
        const regenerate = h('button', 'danger', `让创作助手重做${selected ? ' · 已选择' : ''}`) as HTMLButtonElement;
        regenerate.setAttribute('data-choice-regenerate', conflict.conflictId);
        regenerate.setAttribute('data-choice-selected', selected ? 'true' : 'false');
        regenerate.setAttribute('aria-pressed', selected ? 'true' : 'false');
        regenerate.disabled = decisionChoiceLocked;
        regenerate.onclick = () => {
          if (!authorityWritable || decisionSaved || decisionWrites.has(workspace) || pendingTerminalAction !== null) return;
          setResolution(workspace, conflict, 'regenerate-candidate');
          refreshDecisionControls();
          refreshDecisionSubmit();
          setStatus('已记录让创作助手重做；该项需要新候选，当前决定不能保存为可执行计划。', true, 5000);
        };
        decisionControls.push(regenerate);
        decisionChoiceLabels.set(regenerate, '让创作助手重做');
        choices.appendChild(regenerate);
      }
      item.appendChild(choices);
      conflictSection.appendChild(item);
    }
  } else {
    conflictSection.appendChild(h('p', 'review-empty-note', '没有需要人工处理的冲突。'));
  }
  refreshDecisionControls();
  const operations = markReviewSection(h('div', 'review-operations review-decision-actions'), 'decision-actions');
  operations.setAttribute('data-editor-region', 'workspace-actions');
  decisionButton = appendDecisionButton(
    operations,
    workspace,
    decisionSaved ? '决定已保存' : decisionWrites.has(workspace)
      ? '正在保存决定'
      : pendingTerminalAction === 'comparison-decision' ? '再次确认保存状态' : '保存我的决定',
    'save-decision',
    decisionSubmitLocked || !canSealDecision(projection, workspace.decisionDraft),
    () => {
      if (!authorityWritable || decisionSaved || decisionWrites.has(workspace) || decisionButton === null || decisionButton.disabled) return;
      let seal: DecisionSealState;
      try {
        seal = sealDecisionState(workspace, options);
      } catch (error) {
        setStatus(`保存决定失败：${errorMessage(error)}`, false, 6000);
        return;
      }
      const sealedDraft: ReviewDecisionDraft = {
        decisionId: workspace.decisionDraft.decisionId,
        selectedUnitIds: [...workspace.decisionDraft.selectedUnitIds],
        conflictResolutions: workspace.decisionDraft.conflictResolutions.map((resolution) => ({ ...resolution })),
      };
      decisionWrites.add(workspace);
      for (const control of decisionControls) control.disabled = true;
      decisionButton.disabled = true;
      void writeDecisionReceipt(workspace, sealedDraft, seal.decidedAt, options.reviewTerminalClient)
        .then(() => {
          decisionWrites.delete(workspace);
          try {
            renderReviewPanel(container, workspace, options);
            setStatus('已保存我的决定', true, 5000);
          } catch (error) {
            setStatus(`决定已经保存，但界面刷新失败：${errorMessage(error)}`, false, 6000);
          }
        }, (error) => {
          decisionWrites.delete(workspace);
          renderReviewPanel(container, workspace, options);
          setStatus(`保存决定失败：${terminalErrorMessage(error)}`, false, 6000);
        });
    },
  );
  main.appendChild(conflictSection);
  main.appendChild(operations);
  main.appendChild(safeSection);
  main.appendChild(dependencySection);
  const comparisonTechnical = appendTechDetails(main, projection, '查看审阅技术详情');
  comparisonTechnical.setAttribute('data-review-section', 'technical');
  shell.appendChild(main);
  renderObjectDetails(shell, workspace);
  container.appendChild(shell);
}

function appendRuntimePaths(container: HTMLElement, paths: readonly ReviewRuntimePathFact[]): void {
  for (const [index, path] of paths.entries()) {
    const item = h('article', 'review-readable-route');
    const choices = path.choices.map((choice) => choice.label ?? `选项 ${choice.optionIndex + 1}`);
    item.appendChild(h('strong', undefined, choices.length > 0 ? choices.join(' → ') : `运行路线 ${index + 1}`));
    item.appendChild(h('p', undefined, path.endingSceneId
      ? `到达结尾：${labelForObjectRef(`scene:${path.endingSceneId}`)}` : '本次运行尚未到达场景结束。'));
    if (path.finalVariables.length > 0) item.appendChild(h('div', 'review-route-state',
      path.finalVariables.map((variable) => `${variable.name} = ${JSON.stringify(variable.value)}`).join('；')));
    const detail = h('details', 'review-route-details');
    detail.appendChild(h('summary', undefined, '查看经过的场景'));
    detail.appendChild(h('p', undefined, path.visitedSceneIds.map((scene) => labelForObjectRef(`scene:${scene}`)).join(' → ')));
    item.appendChild(detail);
    container.appendChild(item);
  }
}

const visibleProposals = new WeakMap<ReviewWorkspaceState, string>();

function renderWholeProposalReview(container: HTMLElement, workspace: ReviewWorkspaceState, options: ReviewPanelOptions): void {
  const projection = workspace.projection;
  if (projection.reviewVersion !== '2.0.0') return;
  const locked = workspace.receiptStatus !== 'none' || workspace.authority.state !== 'available'
    || decisionWrites.has(workspace) || pendingTerminalActionOf(workspace) !== null;
  const saveLocked = workspace.receiptStatus !== 'none' || workspace.authority.state !== 'available' || decisionWrites.has(workspace);
  const selected = workspace.decisionDraft.decisionIntent;
  const units = projection.candidates.flatMap((candidate) => candidate.verifiedFacts.units);
  const unitById = new Map(units.map((unit) => [unit.unitId, unit]));
  const redraw = (): void => {
    const scroll = container.querySelector('.review-main')?.scrollTop ?? 0;
    const active = document.activeElement;
    const focusKey = ['data-adopt-candidate', 'data-proposal-switch', 'data-mix-base', 'data-mix-unit', 'data-action']
      .map((key) => ({ key, value: active?.getAttribute(key) }))
      .find((entry) => entry.value != null);
    renderReviewPanel(container, workspace, options);
    const next = container.querySelector('.review-main');
    if (next !== null) next.scrollTop = scroll;
    if (focusKey !== undefined) {
      const target = [...container.querySelectorAll<HTMLElement>(`[${focusKey.key}]`)]
        .find((element) => element.getAttribute(focusKey.key) === focusKey.value);
      target?.focus({ preventScroll: true });
    }
  };
  const requestPreview = (): void => {
    const request = previewReviewDecision(workspace, options.reviewTerminalClient);
    redraw();
    void request.then(redraw, () => redraw());
  };
  const changed = (): void => {
    workspace.decisionDraft.decisionId = '';
    delete workspace.decisionPreview;
    decisionSealStates.delete(workspace);
    publishEditorWorkspaceState();
  };
  const resolveMixConflicts = (): void => {
    const selection = new Set(workspace.decisionDraft.selectedUnitIds);
    workspace.decisionDraft.conflictResolutions = [];
    for (const conflict of projection.conflicts.filter((item) => item.severity === 'selection-required')) {
      const chosen = conflict.unitIds.filter((id) => selection.has(id));
      if (chosen.length === 1 && conflict.allowedResolutions.includes('choose-unit')) workspace.decisionDraft.conflictResolutions.push({ conflictId: conflict.conflictId, resolution: 'choose-unit', chosenUnitId: chosen[0]! });
      if (chosen.length === 0 && conflict.allowedResolutions.includes('exclude-all')) workspace.decisionDraft.conflictResolutions.push({ conflictId: conflict.conflictId, resolution: 'exclude-all' });
    }
  };
  const adopt = (candidate: typeof projection.candidates[number]): void => {
    if (locked || decisionWrites.has(workspace) || pendingTerminalActionOf(workspace) !== null || candidate.adoptionPreset.status !== 'available') return;
    workspace.decisionDraft = {
      decisionId: '', decisionIntent: { mode: 'adopt-candidate', candidate: { candidateId: candidate.candidateId, ref: candidate.ref } },
      selectedUnitIds: [...candidate.adoptionPreset.selectedUnitIds],
      conflictResolutions: candidate.adoptionPreset.conflictResolutions.map(({ conflictId, resolution, chosenUnitId }) => ({
        conflictId, resolution, ...(chosenUnitId === undefined ? {} : { chosenUnitId }),
      })),
    };
    changed();
    requestPreview();
  };
  const shell = h('div', 'review-workbench review-whole-workbench');
  appendReviewWorkspaceHeader(shell, projection, workspace.receiptStatus === 'decision-written' ? '决定已保存' : '阅读整案，选择后核对预计结果');
  const main = h('section', 'review-main review-whole-main');
  main.setAttribute('aria-label', '整案审阅');
  main.setAttribute('data-review-main', 'comparison');
  const brief = markReviewSection(h('section', 'review-section review-creative-brief'), 'creative-brief');
  brief.appendChild(h('h2', undefined, '原始创作要求'));
  brief.appendChild(h('p', undefined, projection.creativeBrief.status === 'provided'
    ? projection.creativeBrief.request ?? '未提供原始创作要求。' : '未提供原始创作要求。'));
  for (const criterion of projection.creativeBrief.acceptanceCriteria) brief.appendChild(h('div', 'review-criterion', criterion));
  brief.appendChild(h('p', 'review-section-intro', '这里保留本次审阅的创作要求；“候选自述”由创作者填写；内容改动与运行路线由系统从封存记录中核对。'));
  appendAuthorityStatus(brief, workspace);
  main.appendChild(brief);
  const proposals = markReviewSection(h('section', 'review-section'), 'whole-proposals');
  proposals.appendChild(h('h2', undefined, '比较完整方案'));
  proposals.appendChild(h('p', 'review-section-intro', '每个方案保留自己的场景、选项、结尾和演出。先看故事，再决定采用哪一套。'));
  const visibleId = visibleProposals.get(workspace) ?? projection.candidates[0]?.candidateId;
  const switches = h('div', 'review-proposal-switches');
  switches.setAttribute('role', 'group'); switches.setAttribute('aria-label', '切换方案全文');
  for (const candidate of projection.candidates) {
    const button = h('button', undefined, `阅读方案 ${candidate.displayOrdinal}`) as HTMLButtonElement;
    button.setAttribute('data-proposal-switch', candidate.candidateId);
    button.setAttribute('aria-pressed', String(candidate.candidateId === visibleId));
    button.onclick = () => { visibleProposals.set(workspace, candidate.candidateId); redraw(); };
    switches.appendChild(button);
  }
  proposals.appendChild(switches);
  const routeOverview = h('div', 'review-proposal-overview');
  routeOverview.setAttribute('aria-label', '各方案路线概览');
  for (const candidate of projection.candidates) {
    routeOverview.appendChild(h('p', undefined, `方案 ${candidate.displayOrdinal}：${candidate.verifiedFacts.runtime.paths
      .flatMap((path) => path.choices.map((choice) => choice.label ?? `选项 ${choice.optionIndex + 1}`)).join(' / ') || '尚无可核对的路线'}`));
  }
  proposals.appendChild(routeOverview);
  const cards = h('div', 'review-proposal-grid');
  for (const candidate of projection.candidates) {
    const active = selected?.mode === 'adopt-candidate' && selected.candidate.candidateId === candidate.candidateId;
    const card = h('article', `review-proposal-card${active ? ' selected' : ''}`);
    card.setAttribute('data-proposal', candidate.candidateId);
    card.setAttribute('data-proposal-visible', String(candidate.candidateId === visibleId));
    card.appendChild(h('h3', undefined, `方案 ${candidate.displayOrdinal}${active ? ' · 已选择' : ''}`));
    const facts = candidate.verifiedFacts;
    const finalScenes = facts.content.finalSceneStatus === 'verified' ? facts.content.finalScenes : [];
    const sceneIds = [...new Set([
      ...facts.content.changedObjects.filter((object) => object.objectRef.startsWith('scene:')).map((object) => object.objectRef.slice('scene:'.length)),
      ...facts.content.scenes.map((scene) => scene.sceneId), ...finalScenes.map((scene) => scene.sceneId),
    ])];
    card.appendChild(h('div', 'review-proposal-scope', `${sceneIds.length} 个场景 · ${facts.runtime.paths.length} 条已运行路线 · ${new Set(facts.content.timelines.map((timeline) => timeline.timelineId)).size} 段演出`));
    const claims = h('details', 'review-candidate-claims');
    claims.appendChild(h('summary', undefined, '候选自述'));
    claims.appendChild(h('p', undefined, candidate.claims.statement ?? '候选没有填写自述。'));
    for (const criterion of candidate.claims.acceptanceCriteria) claims.appendChild(h('div', 'review-criterion', criterion));
    card.appendChild(claims);
    card.appendChild(h('h4', undefined, facts.content.finalSceneStatus === 'verified' ? '系统核对到的最终正文' : '完整正文暂不可核对'));
    card.appendChild(h('p', 'review-section-intro', facts.content.finalSceneStatus === 'verified'
      ? '来源：与候选最终工作版本一致的封存差异。按已运行的场景顺序阅读。'
      : '下面只展示封存操作与运行事实。'));
    for (const limitation of facts.content.finalSceneLimitations) card.appendChild(h('p', 'review-warning', limitation));
    const sceneOrder = [...new Set(facts.runtime.paths.flatMap((path) => path.visitedSceneIds))];
    sceneIds.sort((left, right) => {
      const rank = (sceneId: string): number => { const index = sceneOrder.indexOf(sceneId); return index < 0 ? sceneOrder.length : index; };
      return rank(left) - rank(right) || left.localeCompare(right);
    });
    for (const sceneId of sceneIds) {
      const story = h('details', 'review-story-scene') as HTMLDetailsElement;
      story.open = true;
      story.appendChild(h('summary', undefined, labelForObjectRef(`scene:${sceneId}`)));
      const finalScene = finalScenes.find((scene) => scene.sceneId === sceneId);
      if (finalScene === undefined) story.appendChild(h('p', 'review-warning', '此场景没有可核对的完整正文，可展开改动记录查看已有内容。'));
      else for (const line of finalScene.paragraphs) story.appendChild(h('p', 'review-story-line', line));
      const history = h('details', 'review-story-history');
      history.appendChild(h('summary', undefined, '查看创作改动记录'));
      const sceneFacts = facts.content.scenes.filter((scene) => scene.sceneId === sceneId)
        .sort((left, right) => left.operationSequence - right.operationSequence);
      for (const fact of sceneFacts) {
        const action = ({ create: '新建场景', replaceText: '替换台词', replaceInstruction: '替换演出指令', insertAfter: '插入内容', replaceChoiceOption: '替换选项', removeObject: '移除内容' } as Record<string, string>)[fact.action] ?? '修改场景';
        history.appendChild(h('strong', 'review-story-action', action));
        for (const line of fact.highlights) history.appendChild(h('p', 'review-story-line', line));
      }
      for (const unit of facts.units.filter((unit) => unit.outcomes.some((object) => object.objectRef === `scene:${sceneId}`))) {
        if (!sceneFacts.some((fact) => fact.unitId === unit.unitId)) appendUnitPresentation(history, unit);
      }
      story.appendChild(history);
      card.appendChild(story);
    }
    if (sceneIds.length === 0 && facts.content.finalSceneStatus === 'verified') card.appendChild(h('p', undefined, '此方案没有场景文本改动。'));
    card.appendChild(h('h4', undefined, '实际运行路线'));
    if (facts.runtime.status === 'unavailable') card.appendChild(h('p', 'review-warning', '暂无可核对的运行路线。'));
    appendRuntimePaths(card, facts.runtime.paths);
    for (const limitation of facts.runtime.limitations) card.appendChild(h('p', 'review-warning', limitation));
    const other = h('details', 'review-proposal-other');
    other.appendChild(h('summary', undefined, '其他内容与验证'));
    for (const unit of facts.units.filter((unit) => !unit.primaryObject.startsWith('scene:'))) appendUnitPresentation(other, unit);
    other.appendChild(h('p', undefined, candidateEvidenceSummary(candidate.evidence)));
    card.appendChild(other);
    if (candidate.adoptionPreset.status === 'blocked') {
      for (const reason of candidate.adoptionPreset.reasons) card.appendChild(h('p', 'review-warning', reason.message));
    }
    const button = appendDecisionButton(card, workspace, `采用整个方案 ${candidate.displayOrdinal}`, 'adopt-candidate',
      locked || candidate.adoptionPreset.status !== 'available', () => adopt(candidate));
    button.setAttribute('data-adopt-candidate', candidate.candidateId);
    button.setAttribute('aria-pressed', String(active));
    cards.appendChild(card);
  }
  proposals.appendChild(cards);
  main.appendChild(proposals);
  const mix = markReviewSection(h('section', 'review-section review-custom-mix'), 'custom-mix');
  const mixButton = h('button', 'review-secondary-action', selected?.mode === 'custom-mix' ? '正在自定义组合' : '我想自定义组合') as HTMLButtonElement;
  mixButton.setAttribute('data-action', 'custom-mix');
  mixButton.disabled = locked || selected?.mode === 'custom-mix';
  mixButton.onclick = () => {
    if (locked) return;
    const intent: ReviewDecisionIntent = { mode: 'custom-mix', ...(selected?.mode === 'adopt-candidate' ? { baseCandidate: selected.candidate } : {}) };
    workspace.decisionDraft.decisionIntent = intent;
    resolveMixConflicts(); changed(); requestPreview();
  };
  mix.appendChild(mixButton);
  if (selected?.mode === 'custom-mix') {
    const bases = h('div', 'review-mix-bases');
    bases.setAttribute('role', 'group'); bases.setAttribute('aria-label', '选择组合底稿');
    for (const base of [...projection.candidates, undefined]) {
      const button = h('button', undefined, base === undefined ? '从空白开始' : `以方案 ${base.displayOrdinal} 为底稿`) as HTMLButtonElement;
      button.disabled = locked || (base !== undefined && base.adoptionPreset.status !== 'available');
      button.setAttribute('data-mix-base', base?.candidateId ?? 'none');
      button.setAttribute('aria-pressed', String(selected.baseCandidate?.candidateId === base?.candidateId));
      button.onclick = () => {
        if (button.disabled) return;
        workspace.decisionDraft = {
          decisionId: '', decisionIntent: { mode: 'custom-mix', ...(base === undefined ? {} : { baseCandidate: { candidateId: base.candidateId, ref: base.ref } }) },
          selectedUnitIds: [...(base?.adoptionPreset.selectedUnitIds ?? [])], conflictResolutions: [],
        };
        resolveMixConflicts(); changed(); requestPreview();
      };
      bases.appendChild(button);
    }
    mix.appendChild(bases);
    mix.appendChild(h('p', undefined, '选择要保留的内容。依赖会在预览中明确列出；同一处有不同版本时，需要作出选择。'));
    for (const objectRef of [...new Set(units.map((unit) => unit.primaryObject))]) {
      const group = h('fieldset', 'review-mix-candidate');
      group.appendChild(h('legend', undefined, labelForObjectRef(objectRef)));
      for (const unit of units.filter((item) => item.primaryObject === objectRef)) {
        const label = h('label', 'review-mix-unit');
        const check = document.createElement('input'); check.type = 'checkbox';
        check.checked = workspace.decisionDraft.selectedUnitIds.includes(unit.unitId); check.disabled = locked;
        check.setAttribute('data-mix-unit', unit.unitId);
        check.onchange = () => {
          if (locked) return;
          const selection = new Set(workspace.decisionDraft.selectedUnitIds);
          if (check.checked) selection.add(unit.unitId); else selection.delete(unit.unitId);
          workspace.decisionDraft.selectedUnitIds = [...selection];
          resolveMixConflicts(); changed(); requestPreview();
        };
        label.appendChild(check);
        const description = h('span');
        description.appendChild(h('strong', undefined, labelForCandidate(projection, unit.candidateId)));
        appendUnitPresentation(description, unit); label.appendChild(description);
        group.appendChild(label);
      }
      mix.appendChild(group);
    }
    for (const conflict of projection.conflicts.filter((item) => item.severity === 'selection-required'
      && !workspace.decisionDraft.conflictResolutions.some((resolution) => resolution.conflictId === item.conflictId))) {
      mix.appendChild(h('p', 'review-warning', `请为 ${conflict.objectRefs.map(labelForObjectRef).join('、')} 保留一个版本，或全部取消。`));
    }
  }
  main.appendChild(mix);
  const forecast = markReviewSection(h('section', 'review-section review-decision-forecast'), 'decision-preview');
  forecast.appendChild(h('h2', undefined, workspace.receiptStatus === 'decision-written' ? '你保存的决定' : '保存前，核对预计结果'));
  const intent = workspace.decisionReceipt?.receiptVersion === '2.0.0' ? workspace.decisionReceipt.decisionIntent : selected;
  const intentLabel = intent === undefined ? '尚未选择方案' : intent.mode === 'adopt-candidate'
    ? `采用整个${labelForCandidate(projection, intent.candidate.candidateId)}` : '自定义组合';
  forecast.appendChild(h('p', 'review-current-choice', intentLabel));
  const pending = workspace.decisionPreview;
  if (workspace.receiptStatus === 'decision-written') {
    const marker = h('div', 'review-receipt-status', '决定已保存，重新打开仍会显示同一份决定。');
    marker.setAttribute('data-decision-receipt', 'written');
    marker.setAttribute('data-decision-fingerprint', workspace.decisionReceipt!.decisionFingerprint);
    forecast.appendChild(marker);
  } else if (pending?.status === 'loading') forecast.appendChild(h('p', 'review-preview-pending', '正在核对这次选择的实际组合…'));
  else if (pending?.status === 'error') forecast.appendChild(h('p', 'review-warning', pending.message ?? '预览失败，请重新核对选择。'));
  else if (pending?.value !== undefined) {
    const preview = pending.value;
    const appendUnits = (title: string, ids: string[]): void => {
      forecast.appendChild(h('h3', undefined, `${title} · ${ids.length} 项`));
      if (ids.length === 0) forecast.appendChild(h('p', undefined, '无'));
      for (const id of ids) {
        const unit = unitById.get(id);
        if (unit === undefined) continue;
        forecast.appendChild(h('p', 'review-forecast-item', `${labelForCandidate(projection, unit.candidateId)} · ${labelForObjectRef(unit.primaryObject)}`));
      }
    };
    appendUnits('直接采用', preview.effectiveUnitIds.filter((id) => !preview.implicitInclusions.includes(id)));
    appendUnits('自动带入的依赖', preview.implicitInclusions);
    appendUnits('未纳入', preview.excludedUnitIds);
    appendUnits('相同结果的来源保留', preview.selectedUnitIds.filter((id) => !preview.effectiveUnitIds.includes(id) && !preview.excludedUnitIds.includes(id)));
    forecast.appendChild(h('h3', undefined, '预计项目变化'));
    for (const objectRef of Object.keys(preview.dryRun.finalObjectFingerprints)) forecast.appendChild(h('p', 'review-forecast-item', labelForObjectRef(objectRef)));
    forecast.appendChild(h('p', preview.status === 'ready' ? 'review-preview-ready' : 'review-warning',
      preview.status === 'ready' ? '组合试运行已通过，可以保存这次决定。' : '这次组合无法通过试运行，请调整选择。'));
    for (const error of preview.dryRun.errors) forecast.appendChild(h('p', 'review-warning', error.message));
  } else if (intent !== undefined) forecast.appendChild(h('p', undefined, '选择已更新，请查看新的组合预览。'));
  const actions = h('div', 'review-whole-actions');
  appendDecisionButton(actions, workspace, '查看组合预览', 'preview-decision', locked || selected === undefined || pending?.status === 'loading', requestPreview);
  appendDecisionButton(actions, workspace, workspace.receiptStatus === 'decision-written' ? '决定已保存'
    : pendingTerminalActionOf(workspace) === 'comparison-decision' ? '再次确认保存状态' : '保存我的决定', 'save-decision',
    saveLocked || !canSaveReviewDecision(workspace), () => {
      if (saveLocked || decisionWrites.has(workspace) || !canSaveReviewDecision(workspace)) return;
      const seal = sealDecisionState(workspace, options);
      const draft = structuredClone(workspace.decisionDraft);
      decisionWrites.add(workspace); redraw();
      void writeDecisionReceipt(workspace, draft, seal.decidedAt, options.reviewTerminalClient).then(() => {
        decisionWrites.delete(workspace); redraw(); setStatus('已保存我的决定', true, 5000);
      }, (error) => {
        decisionWrites.delete(workspace);
        if (pendingTerminalActionOf(workspace) === null) delete workspace.decisionPreview;
        redraw();
        setStatus(`保存决定失败：${terminalErrorMessage(error)}`, false, 6000);
      });
    });
  forecast.appendChild(actions);
  main.appendChild(forecast);
  appendTechDetails(main, projection, '查看对象、冲突与技术详情');
  shell.appendChild(main);
  container.appendChild(shell);
}

function appendResultPlan(
  container: HTMLElement,
  projection: HumanReviewProjection,
  plan: ResultPlanView,
): void {
  const section = h('section', 'review-result-section');
  section.appendChild(h('h3', undefined, '实际执行计划'));
  appendFact(section, '明确选择', listText(plan.selectedUnitIds));
  appendFact(section, '实际纳入', listText(plan.includedUnitIds));
  appendFact(section, '自动纳入', listText(plan.implicitInclusions));
  appendFact(section, '明确排除', listText(plan.excludedUnitIds));
  const sources = plan.sourceCapsules.map((ref) => labelForSourceCapsule(projection, plan, ref));
  appendFact(section, '来源方案', listText([...new Set(sources)]));
  section.appendChild(h('h4', undefined, '冲突裁决'));
  if (plan.conflictResolutions.length === 0) section.appendChild(h('div', 'review-result-fact', '无冲突裁决'));
  for (const resolution of plan.conflictResolutions) {
    const choice = resolution.resolution === 'choose-unit'
      ? `选择 ${resolution.chosenUnitId ?? '未知结果'}`
      : resolution.resolution === 'exclude-all' ? '全部排除' : '要求重新生成';
    section.appendChild(h('div', 'review-plan-resolution', `${resolution.conflictId}：${choice}`));
  }
  appendFact(section, '审阅绑定', `${plan.review.reviewId} / ${plan.review.decisionId}`);
  if (plan.deduplicatedUnits.length === 0) appendFact(section, '去重结果', '无');
  else {
    for (const item of plan.deduplicatedUnits) {
      appendFact(section, '去重保留', `${item.retainedUnitId}；来源 ${listText(item.provenanceUnitIds)}`);
    }
  }

  section.appendChild(h('h4', undefined, '重放操作'));
  if (plan.replayOperations.length === 0) section.appendChild(h('div', 'review-result-fact', '无重放操作'));
  for (const operation of plan.replayOperations) {
    const targetObjects = operation.producedObjects?.map((produced) => produced.objectRef) ?? [];
    section.appendChild(h('div', 'review-plan-operation', [
      labelForSourceCapsule(projection, plan, operation.sourceCapsule),
      operation.sourceUnitId,
      '→',
      targetObjects.map(labelForObjectRef).join('、') || '无目标对象',
    ].join(' ')));
  }

  section.appendChild(h('h4', undefined, '来源沿袭'));
  if (plan.provenance.length === 0) section.appendChild(h('div', 'review-result-fact', '无来源记录'));
  const provenanceByObject = new Map<string, string[]>();
  for (const entry of plan.provenance) {
    const source = `${labelForSourceCapsule(projection, plan, entry.sourceCapsule)}（${entry.sourceUnitId}）`;
    const values = provenanceByObject.get(entry.targetObject) ?? [];
    values.push(source);
    provenanceByObject.set(entry.targetObject, values);
  }
  for (const [objectRef, sources] of provenanceByObject) {
    section.appendChild(h('div', 'review-provenance', `${labelForObjectRef(objectRef)}：${[...new Set(sources)].join('、')}`));
  }

  section.appendChild(h('h4', undefined, '最终对象指纹'));
  const fingerprints = Object.entries(plan.finalObjectFingerprints);
  if (fingerprints.length === 0) section.appendChild(h('div', 'review-result-fact', '无对象指纹'));
  for (const [objectRef, fingerprint] of fingerprints) {
    section.appendChild(h('div', 'review-fingerprint-row', `${labelForObjectRef(objectRef)}：${fingerprint}`));
  }
  container.appendChild(section);
}

function appendResultDiff(container: HTMLElement, diff: ResultDiffView): void {
  const section = h('section', 'review-result-section');
  section.appendChild(h('h3', undefined, '变更内容'));
  section.appendChild(h('div', 'review-diff-summary', [
    `新增场景 ${diff.summary.createdScenes}`,
    `修改场景 ${diff.summary.modifiedScenes}`,
    `变量变更 ${diff.summary.changedVariables}`,
  ].join('；')));
  for (const warning of diff.summary.warnings) section.appendChild(h('div', 'review-warning', warning));
  if (diff.semantic.length === 0) section.appendChild(h('div', 'review-result-fact', '语义变更：无额外条目'));
  else {
    section.appendChild(h('h4', undefined, '语义变更'));
    for (const item of diff.semantic) section.appendChild(h('pre', 'review-semantic-diff mono', JSON.stringify(item, null, 2)));
  }
  section.appendChild(h('h4', undefined, '文件差异'));
  if (diff.files.length === 0) section.appendChild(h('div', 'review-result-fact', '无文件差异'));
  for (const file of diff.files) {
    const fileItem = h('article', 'review-file-diff');
    fileItem.appendChild(h('strong', undefined, file.path));
    if (file.unexpectedFormatChange) fileItem.appendChild(h('div', 'review-warning', '包含非预期格式变化'));
    fileItem.appendChild(h('pre', 'mono', file.unifiedDiff));
    section.appendChild(fileItem);
  }
  container.appendChild(section);
}

function appendResultReceipt(
  container: HTMLElement,
  workspace: ReviewWorkspaceState,
  result: ReviewResult,
): void {
  const approval = workspace.approvalReceipt;
  const returned = workspace.returnReceipt;
  if (approval === null && returned === null) return;
  const marker = h('section', 'review-result-receipt');
  marker.setAttribute('data-result-receipt', approval === null ? 'return' : 'approval');
  if (approval !== null) {
    marker.setAttribute('data-approval-receipt', 'true');
    marker.setAttribute('data-approval-id', approval.approvalId);
    marker.setAttribute('data-approval-fingerprint', approval.approvalFingerprint);
    marker.appendChild(h('h3', undefined, '已批准'));
  } else if (returned !== null) {
    marker.setAttribute('data-return-receipt', 'true');
    marker.setAttribute('data-return-id', returned.returnId);
    marker.setAttribute('data-return-fingerprint', returned.returnFingerprint);
    marker.appendChild(h('h3', undefined, '已退回'));
  }
  marker.appendChild(h('div', 'review-receipt-summary', '正式回执已保存，原决定与选择保持不变。'));
  const technical = h('details', 'review-receipt-technical') as HTMLDetailsElement;
  technical.setAttribute('data-result-receipt-technical', '');
  technical.appendChild(h('summary', undefined, '查看回执技术身份'));
  if (approval !== null) {
    technical.appendChild(h('div', undefined, `回执 ID：${approval.approvalId}`));
    technical.appendChild(h('div', undefined, `回执 fingerprint：${approval.approvalFingerprint}`));
  } else if (returned !== null) {
    technical.appendChild(h('div', undefined, `回执 ID：${returned.returnId}`));
    technical.appendChild(h('div', undefined, `回执 fingerprint：${returned.returnFingerprint}`));
  }
  technical.appendChild(h('div', undefined, `原决定：${result.plan.review.decisionId}`));
  technical.appendChild(h('div', undefined, `原选择：${listText(result.plan.selectedUnitIds)}`));
  marker.appendChild(technical);
  container.appendChild(marker);
}

function resultEvidenceIsFresh(details: ReviewResult): boolean {
  const freshness = details.freshness;
  return [freshness.diff, freshness.validation, freshness.simulation, freshness.runtime]
      .every((value) => value === 'fresh');
}

function renderResultReview(
  container: HTMLElement,
  workspace: ReviewWorkspaceState,
  options: ReviewPanelOptions,
): void {
  const projection = workspace.projection;
  const result = projection.finalResult;
  if (result === undefined) throw new Error('integration-result 审阅缺少 finalResult');
  const actual = projection.reviewVersion === '2.0.0' ? result.actualExplanation : undefined;
  const pendingTerminalAction = pendingTerminalActionOf(workspace);
  const resultWriteLocked = resultWrites.has(workspace);
  const resultPreviewLocked = resultPreviews.has(workspace);
  const resultFixtureLocked = resultFixtureOperations.has(workspace);
  const evidenceFresh = resultEvidenceIsFresh(result);
  const terminalReceipt = workspace.receiptStatus === 'approval-written' || workspace.receiptStatus === 'returned';
  const authorityWritable = workspace.authority.state === 'available';
  const approvalReady = pendingTerminalAction === null
    && !terminalReceipt
    && authorityWritable
    && !workspace.fixtureChanged
    && evidenceFresh;
  const shell = h('div', actual === undefined ? 'review-workbench' : 'review-workbench review-whole-workbench');
  appendReviewWorkspaceHeader(
    shell,
    projection,
    terminalReceipt
      ? workspace.receiptStatus === 'approval-written' ? '正式结果已批准' : '正式结果已退回'
      : `${approvalReady ? '结果可以批准' : '结果需要处理'} · ${evidenceFresh ? '证据齐备' : '证据需要更新'}`,
  );
  const taskList = h('aside', 'review-task-list');
  taskList.setAttribute('aria-label', '审阅目录');
  taskList.appendChild(h('h2', undefined, '校对步骤'));
  taskList.appendChild(h('div', 'review-task-progress', terminalReceipt ? '正式结论已保存' : '完成三步后作出结论'));
  const steps = h('ol', 'review-step-list');
  steps.appendChild(h('li', undefined, '预览正式结果'));
  steps.appendChild(h('li', undefined, '核对变更与证据'));
  steps.appendChild(h('li', undefined, '批准或退回'));
  taskList.appendChild(steps);
  if (actual === undefined) shell.appendChild(taskList);

  const main = h('section', actual === undefined ? 'review-main' : 'review-main review-whole-main');
  main.setAttribute('aria-label', '审阅正文');
  main.setAttribute('data-review-main', 'result');
  const overview = markReviewSection(h('section', 'review-section review-overview review-result-overview'), 'overview');
  overview.appendChild(h('div', 'review-section-kicker', '结果检查'));
  overview.appendChild(h('h2', undefined, terminalReceipt
    ? workspace.receiptStatus === 'approval-written' ? '这个结果已经批准' : '这个结果已经退回'
    : approvalReady ? '结果可以批准' : '结果暂不能批准'));
  overview.appendChild(h('p', 'review-overview-goal', evidenceFresh ? '校验、模拟、运行和变更证据均已齐备。' : '部分证据需要更新，批准按钮会保持禁用。'));
  appendAuthorityStatus(overview, workspace);
  appendResultReceipt(overview, workspace, result);
  appendApprovedApply(overview, workspace, options);
  if (pendingTerminalAction !== null) {
    overview.appendChild(h(
      'div',
      'review-warning',
      pendingTerminalAction === 'result-approval'
        ? '上一次批准结果尚未确认，请在下方再次确认批准状态。'
        : '上一次退回结果尚未确认，请在下方再次确认退回状态。',
    ));
  }
  if (workspace.fixtureChanged) overview.appendChild(h('div', 'review-warning', '你正在查看探索性修改，批准已禁用。'));
  if (!evidenceFresh) overview.appendChild(h('div', 'review-warning', '证据不是全部新鲜状态，批准已禁用。'));
  main.appendChild(overview);
  if (actual !== undefined) {
    const decision = markReviewSection(h('section', 'review-section'), 'actual-decision');
    decision.appendChild(h('h2', undefined, '你最终作出的决定'));
    const intent = actual.decisionIntent;
    const chosenOrdinal = intent.mode === 'adopt-candidate' ? result.plan.sourceCandidates.find((candidate) =>
      candidate.ref.changeId === intent.candidate.ref.changeId && candidate.ref.capsuleId === intent.candidate.ref.capsuleId
      && candidate.ref.artifactSha256 === intent.candidate.ref.artifactSha256)?.displayOrdinal : undefined;
    decision.appendChild(h('p', 'review-current-choice', intent.mode === 'custom-mix' ? '自定义组合'
      : chosenOrdinal === undefined ? '采用已选的完整方案' : `采用整个方案 ${chosenOrdinal}`));
    decision.appendChild(h('p', 'review-section-intro', '以下说明来自这个结果的实际执行、项目变化和新鲜运行记录。'));
    main.appendChild(decision);
    const appendActual = (title: string, facts: typeof actual.actualIncluded, sectionName: string): void => {
      const section = markReviewSection(h('section', 'review-section'), sectionName);
      section.appendChild(h('h2', undefined, title));
      if (facts.length === 0) section.appendChild(h('p', undefined, '无'));
      const unidentified = facts.filter((fact) => fact.objectRef === undefined && fact.kind !== 'excluded-candidate');
      for (const fact of facts.filter((item) => item.objectRef !== undefined || item.kind === 'excluded-candidate')) {
        const label = fact.objectRef === undefined ? fact.label
          : fact.label.includes(fact.objectRef) ? fact.label.replace(fact.objectRef, labelForObjectRef(fact.objectRef))
            : labelForObjectRef(fact.objectRef);
        section.appendChild(h('p', 'review-result-fact', label));
      }
      if (unidentified.length > 0) section.appendChild(h('p', undefined, `${unidentified.length} 项内容，具体来源见技术详情。`));
      main.appendChild(section);
    };
    appendActual('实际采用的内容', actual.actualIncluded, 'actual-included');
    appendActual('实际自动带入', actual.actualDependencies, 'actual-dependencies');
    appendActual('实际未纳入', actual.actualExcluded, 'actual-excluded');
    appendActual('实际项目变化', actual.actualChanges, 'actual-changes');
    for (const warning of actual.warnings) overview.appendChild(h('p', 'review-warning', warning));
  }
  const freshness = result.freshness;
  const previewShell = markReviewSection(h('section', 'review-section review-preview-shell'), 'result-preview');
  previewShell.appendChild(h('h2', undefined, '预览正式结果'));
  const previewButton = h('button', 'primary', '预览正式结果') as HTMLButtonElement;
  previewButton.setAttribute('data-action', 'preview-result');
  previewButton.setAttribute('data-action-scope', 'workspace');
  previewButton.disabled = resultWriteLocked || resultPreviewLocked || resultFixtureLocked || pendingTerminalAction !== null;
  previewButton.onclick = () => {
    if (resultWrites.has(workspace) || resultPreviews.has(workspace) || resultFixtureOperations.has(workspace) || pendingTerminalActionOf(workspace) !== null) return;
    resultPreviews.add(workspace);
    previewButton.disabled = true;
    approve.disabled = true;
    returned.disabled = true;
    reload.disabled = true;
    refresh.disabled = true;
    const request: ReviewPreviewRequest = {};
    let operation: Promise<unknown> | void;
    try {
      operation = options.onPreview ? options.onPreview(workspace, request) : openReviewPreview(workspace, request);
    } catch (error) {
      resultPreviews.delete(workspace);
      renderReviewPanel(container, workspace, options);
      setStatus(`预览结果失败：${errorMessage(error)}`, false, 6000);
      return;
    }
    void Promise.resolve(operation)
      .then(() => {
        resultPreviews.delete(workspace);
        const target = document.getElementById('review-view') ?? container;
        renderReviewPanel(target, workspace, options);
        const host = target.querySelector('#review-preview-host');
        if (host) {
          renderPreviewPanel(host as HTMLElement, { embedded: true });
          host.scrollIntoView?.({ block: 'nearest' });
        }
      })
      .catch((error) => {
        resultPreviews.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus(`预览结果失败：${errorMessage(error)}`, false, 6000);
      });
  };
  previewShell.appendChild(previewButton);
  const host = h('div');
  host.id = 'review-preview-host';
  previewShell.appendChild(host);
  const operations = markReviewSection(h('div', 'review-operations review-result-actions'), 'result-actions');
  operations.setAttribute('data-editor-region', 'workspace-actions');
  const approve = h('button', 'primary', pendingTerminalAction === 'result-approval' ? '再次确认批准状态' : actual === undefined ? '批准这个计划' : '批准这个结果') as HTMLButtonElement;
  approve.setAttribute('data-action', 'approve-result');
  approve.setAttribute('data-action-scope', 'workspace');
  approve.disabled = terminalReceipt
    || !authorityWritable
    || resultWriteLocked
    || resultPreviewLocked
    || resultFixtureLocked
    || pendingTerminalAction === 'result-return'
    || workspace.fixtureChanged
    || !resultEvidenceIsFresh(result);
  approve.onclick = () => {
    if (!authorityWritable || terminalReceipt || resultWrites.has(workspace) || resultPreviews.has(workspace) || resultFixtureOperations.has(workspace) || pendingTerminalAction === 'result-return' || approve.disabled) return;
    resultWrites.add(workspace);
    approve.disabled = true;
    returned.disabled = true;
    previewButton.disabled = true;
    reload.disabled = true;
    refresh.disabled = true;
    void writeApprovalReceipt(workspace, { approvalId: `approval_${Date.now()}` }, nowOf(options), options.reviewTerminalClient)
      .then(() => {
        resultWrites.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus('已批准这个计划', true, 5000);
      })
      .catch((error) => {
        resultWrites.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus(`批准失败：${terminalErrorMessage(error)}`, false, 6000);
      });
  };
  operations.appendChild(approve);
  const returned = h('button', 'danger', pendingTerminalAction === 'result-return' ? '再次确认退回状态' : '退回修改') as HTMLButtonElement;
  returned.setAttribute('data-action', 'return-result');
  returned.setAttribute('data-action-scope', 'workspace');
  returned.disabled = terminalReceipt || !authorityWritable || resultWriteLocked || resultPreviewLocked || resultFixtureLocked || pendingTerminalAction === 'result-approval';
  returned.onclick = () => {
    if (!authorityWritable || terminalReceipt || resultWrites.has(workspace) || resultPreviews.has(workspace) || resultFixtureOperations.has(workspace) || pendingTerminalAction === 'result-approval' || returned.disabled) return;
    resultWrites.add(workspace);
    approve.disabled = true;
    returned.disabled = true;
    previewButton.disabled = true;
    reload.disabled = true;
    refresh.disabled = true;
    void writeReturnReceipt(workspace, { returnId: `return_${Date.now()}`, reasonCategory: 'other' }, nowOf(options), options.reviewTerminalClient)
      .then(() => {
        resultWrites.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus('已退回修改', true, 5000);
      })
      .catch((error) => {
        resultWrites.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus(`退回失败：${terminalErrorMessage(error)}`, false, 6000);
      });
  };
  operations.appendChild(returned);
  const reload = h('button', undefined, '重新加载正式结果') as HTMLButtonElement;
  reload.setAttribute('data-action', 'reload-official-result');
  reload.setAttribute('data-action-scope', 'workspace');
  reload.disabled = resultWriteLocked || resultPreviewLocked || resultFixtureLocked || pendingTerminalAction !== null;
  reload.onclick = () => {
    if (resultWrites.has(workspace) || resultPreviews.has(workspace) || resultFixtureOperations.has(workspace) || pendingTerminalActionOf(workspace) !== null) return;
    resultFixtureOperations.add(workspace);
    approve.disabled = true;
    returned.disabled = true;
    previewButton.disabled = true;
    reload.disabled = true;
    refresh.disabled = true;
    let operation: Promise<unknown> | unknown;
    try {
      operation = options.onReloadOfficialResult
        ? options.onReloadOfficialResult(workspace)
        : restoreOfficialResult(workspace);
    } catch (error) {
      resultFixtureOperations.delete(workspace);
      renderReviewPanel(container, workspace, options);
      setStatus(`重新加载正式结果失败：${errorMessage(error)}`, false, 6000);
      return;
    }
    void Promise.resolve(operation)
      .then(() => {
        resultFixtureOperations.delete(workspace);
        setStatus('已重新加载正式结果', true, 4000);
        renderReviewPanel(container, workspace, options);
      })
      .catch((error) => {
        resultFixtureOperations.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus(`重新加载正式结果失败：${errorMessage(error)}`, false, 6000);
      });
  };
  operations.appendChild(reload);
  const refresh = h('button', undefined, '检查探索修改') as HTMLButtonElement;
  refresh.setAttribute('data-action', 'refresh-result-tree');
  refresh.setAttribute('data-action-scope', 'workspace');
  refresh.disabled = resultWriteLocked || resultPreviewLocked || resultFixtureLocked || pendingTerminalAction !== null;
  refresh.onclick = () => {
    if (resultWrites.has(workspace) || resultPreviews.has(workspace) || resultFixtureOperations.has(workspace) || pendingTerminalActionOf(workspace) !== null) return;
    resultFixtureOperations.add(workspace);
    approve.disabled = true;
    returned.disabled = true;
    previewButton.disabled = true;
    reload.disabled = true;
    refresh.disabled = true;
    let operation: Promise<unknown> | unknown;
    try {
      operation = options.onRefreshFixtureIdentity
        ? options.onRefreshFixtureIdentity(workspace)
        : refreshReviewFixtureIdentity(workspace);
    } catch (error) {
      resultFixtureOperations.delete(workspace);
      renderReviewPanel(container, workspace, options);
      setStatus(`检查预览文件失败：${errorMessage(error)}`, false, 6000);
      return;
    }
    void Promise.resolve(operation)
      .then(() => {
        resultFixtureOperations.delete(workspace);
        renderReviewPanel(container, workspace, options);
      })
      .catch((error) => {
        resultFixtureOperations.delete(workspace);
        renderReviewPanel(container, workspace, options);
        setStatus(`检查预览文件失败：${errorMessage(error)}`, false, 6000);
      });
  };
  operations.appendChild(refresh);

  const resultSummary = markReviewSection(h('section', 'review-section review-result-summary'), 'result-summary');
  resultSummary.appendChild(h('h2', undefined, '变更摘要'));
  resultSummary.appendChild(h('p', undefined, [
    `新增场景 ${result.diff.summary.createdScenes} 个`,
    `修改场景 ${result.diff.summary.modifiedScenes} 个`,
    `变量变更 ${result.diff.summary.changedVariables} 项`,
  ].join('；')));
  if (result.diff.summary.warnings.length === 0 && result.warnings.length === 0) {
    resultSummary.appendChild(h('div', 'review-result-fact', '没有发现需要额外处理的变更警告。'));
  }
  for (const warning of result.diff.summary.warnings) {
    resultSummary.appendChild(h('div', 'review-warning', warning));
  }
  for (const warning of result.warnings) {
    resultSummary.appendChild(h('div', 'review-warning', warning.message));
  }

  const evidence = markReviewSection(h('section', 'review-section review-evidence'), 'result-evidence');
  evidence.appendChild(h('h2', undefined, actual === undefined ? '证据与观察' : '实际运行与验证'));
  if (actual !== undefined) appendRuntimePaths(evidence, actual.actualRuntimeOutcomes);
  evidence.appendChild(h('div', 'review-evidence-summary', [
    `证据新鲜度：差异 ${labelForFreshness(freshness.diff)}`,
    `校验 ${labelForFreshness(freshness.validation)}`,
    `模拟 ${labelForFreshness(freshness.simulation)}`,
    `运行 ${labelForFreshness(freshness.runtime)}`,
  ].join('；')));
  const traceEvidence = reconcileReviewTraceEvidence(projection, state.previewTrace);
  const observations = h('section', 'review-result-section');
  observations.appendChild(h('h3', undefined, '本次互动预览的记录对照'));
  observations.appendChild(h('div', undefined, `本次预览：${state.previewTrace.length > 0 ? `${state.previewTrace.length} 个事件` : '尚未运行'}`));
  if (traceEvidence.matched.length > 0) observations.appendChild(h('div', undefined, `已对照运行证据：${traceEvidence.matched.join('、')}`));
  if (traceEvidence.missing.length > 0) observations.appendChild(h('div', undefined, `本次尚未覆盖：${traceEvidence.missing.join('、')}`));
  if (traceEvidence.unexpected.length > 0) observations.appendChild(h('div', undefined, `正式证据外观察：${traceEvidence.unexpected.length} 个事件`));
  if (actual === undefined) evidence.appendChild(observations);

  const technical = markReviewSection(
    h('details', 'review-technical-disclosure review-result-technical') as HTMLDetailsElement,
    'technical',
  ) as HTMLDetailsElement;
  technical.appendChild(h('summary', undefined, '查看执行与技术详情'));
  appendFact(technical, '计划指纹', result.planFingerprint);
  appendFact(technical, '差异指纹', result.diffFingerprint);
  appendFact(technical, '计划 ID', result.planId);
  appendFact(technical, '工作版本', String(result.workingRevision));
  appendFact(technical, '项目树身份', result.resultTreeSha256);
  appendResultPlan(technical, projection, result.plan);
  appendResultDiff(technical, result.diff);
  const evidenceIdentity = h('section', 'review-result-section');
  evidenceIdentity.appendChild(h('h3', undefined, '证据身份'));
  appendFact(evidenceIdentity, '差异证据', result.evidence.diffEvidenceId);
  appendFact(evidenceIdentity, '校验证据', result.evidence.validationEvidenceId);
  appendFact(evidenceIdentity, '模拟证据', result.evidence.simulationEvidenceId);
  appendFact(evidenceIdentity, '运行轨迹', listText(result.evidence.runtimeTraceIds));
  technical.appendChild(evidenceIdentity);
  if (actual !== undefined) technical.appendChild(observations);
  appendTechDetails(technical, projection, '查看审阅包技术身份');

  main.appendChild(previewShell);
  if (actual === undefined) main.appendChild(operations);
  main.appendChild(resultSummary);
  main.appendChild(evidence);
  if (actual !== undefined) main.appendChild(operations);
  main.appendChild(technical);
  shell.appendChild(main);
  renderObjectDetails(actual === undefined ? shell : technical, workspace);
  container.appendChild(shell);
}

export function renderReviewPanel(
  container: HTMLElement,
  workspace: ReviewWorkspaceState | null = state.reviewWorkspace,
  options: ReviewPanelOptions = {},
): void {
  if (activeApply !== null && (activeApply.workspace !== workspace || workspace?.approvalReceipt === null
    || workspace?.returnReceipt !== null)) disposeReviewApply();
  container.innerHTML = '';
  if (workspace === null) {
    container.appendChild(h('div', 'empty', '暂无审阅任务'));
    return;
  }
  if (workspace.projection.kind === 'comparison') renderComparisonReview(container, workspace, options);
  else renderResultReview(container, workspace, options);
  const content = container.querySelector<HTMLElement>('.review-main') ?? container;
  renderReviewPreparation(content, workspace, options);
  const preparation = content.querySelector('.review-preparation');
  if (preparation) content.querySelector('.review-decision-forecast')?.after(preparation);
}

/** 顶层“打开审阅任务”入口；创建 review workspace 后只切换到审阅页，不自动写回任何回执。 */
export async function openReviewPanelWorkspace(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const root = await picker({ mode: 'readwrite' });
  state.reviewWorkspace = await openReviewWorkspace(root);
  state.mainTab = 'review';
  state.selectedObjectRef = null;
  state.previewChoices = null;
  state.dirName = `审阅：${state.reviewWorkspace.projection.task.title}`;
}

/** 仅供预览状态探针调用，保持变化只在当前 review workspace 内。 */
export function markReviewPreviewExploration(workspace: ReviewWorkspaceState, treeSha256: string): void {
  markReviewFixtureChanged(workspace, treeSha256);
}
