import type {
  HumanReviewProjection,
  ReviewConflict,
} from '@surdet/authoring';
import { state, h, setStatus } from '../state.js';
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
  type ReviewDecisionDraft,
  type ReviewWorkspaceState,
} from '../review-workspace.js';
import { renderReviewCausalPanel } from './right.js';
import { renderPreviewPanel } from './preview-panel.js';
import type { ReviewTerminalClient } from '../review-terminal-client.js';

export interface ReviewPanelOptions {
  now?: () => string;
  onPreview?: (workspace: ReviewWorkspaceState, request: ReviewPreviewRequest) => Promise<void> | void;
  onReloadOfficialResult?: (workspace: ReviewWorkspaceState) => Promise<void> | void;
  onRefreshFixtureIdentity?: (workspace: ReviewWorkspaceState) => Promise<unknown> | unknown;
  reviewTerminalClient?: ReviewTerminalClient;
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

function appendTechDetails(container: HTMLElement, projection: HumanReviewProjection): void {
  const details = h('details') as HTMLDetailsElement;
  details.setAttribute('data-tech-details', '');
  details.appendChild(h('summary', undefined, '查看技术详情'));
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
  if (decisionContentIdentity(workspace.decisionDraft) !== previous) {
    workspace.decisionDraft.decisionId = '';
    decisionSealStates.delete(workspace);
  }
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
  const decisionSaved = workspace.receiptStatus === 'decision-written';
  const authorityWritable = workspace.authority.state === 'available';
  const pendingTerminalAction = pendingTerminalActionOf(workspace);
  const decisionChoiceLocked = decisionSaved
    || decisionWrites.has(workspace)
    || pendingTerminalAction !== null
    || !authorityWritable;
  const decisionSubmitLocked = decisionSaved || decisionWrites.has(workspace) || !authorityWritable;
  const shell = h('div', 'review-workbench');
  const taskList = h('aside', 'review-task-list');
  taskList.appendChild(h('h2', undefined, '审阅任务'));
  taskList.appendChild(h('div', 'review-task-title', projection.task.title));
  const stateLabel = h('div', 'review-state', labelForReviewState(projection.state));
  taskList.appendChild(stateLabel);
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
  main.appendChild(h('h2', undefined, '比较结果'));
  appendAuthorityStatus(main, workspace);
  main.appendChild(h('div', 'review-evidence-summary', `共 ${projection.task.candidateCount} 个方案，${projection.task.objectCount} 个对象`));
  if (workspace.decisionReceipt !== null) {
    const marker = h('div', 'review-receipt-status', '已读取已保存的决定');
    marker.setAttribute('data-decision-receipt', 'written');
    marker.setAttribute('data-review-receipt-status', workspace.receiptStatus);
    marker.setAttribute('data-decision-id', workspace.decisionReceipt.decisionId);
    marker.setAttribute('data-decision-fingerprint', workspace.decisionReceipt.decisionFingerprint);
    main.appendChild(marker);
  }
  if (projectionHasLegacyUnitPresentation(projection)) {
    main.appendChild(h(
      'div',
      'review-warning review-legacy-presentation',
      '旧审阅包缺少内容摘要；已有决定仍可读取，未提供的内容不会被臆测。',
    ));
  }
  if (projection.safeGroups.length > 0) {
    main.appendChild(h('h3', undefined, '安全结果'));
    for (const group of projection.safeGroups) {
      const view = group;
      const badges = safeGroupEvidenceBadges(group);
      const item = h('details', 'review-safe-group') as HTMLDetailsElement;
      item.setAttribute('data-safe-group', group.groupId);
      const summary = h('summary', 'review-safe-summary');
      summary.appendChild(h('strong', undefined, `内容结果相同，保留 ${group.sourceCount} 个来源`));
      summary.appendChild(h('span', 'review-safe-equivalence', `${group.sourceCount} 个方案得到相同结果`));
      summary.appendChild(h('span', 'review-safe-object', labelForObjectRef(group.primaryObject)));
      summary.appendChild(h('span', 'review-safe-default', '默认纳入'));
      for (const badge of badges) summary.appendChild(h('span', badge === '证据正常' ? 'review-safe-badge ok' : 'review-safe-badge', badge));
      item.appendChild(summary);

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
      main.appendChild(item);
    }
  }

  const implicitDependencies = projection.dependencies.filter((dependency) => dependency.inclusion === 'implicit');
  if (implicitDependencies.length > 0) {
    const dependencySection = h('section', 'review-dependencies');
    dependencySection.appendChild(h('h3', undefined, '自动依赖'));
    for (const dependency of implicitDependencies) {
      dependencySection.appendChild(h(
        'div',
        'review-dependency',
        `依赖自动纳入：${labelForObjectRef(dependency.fromObjectRef)} → ${labelForObjectRef(dependency.objectRef)}`,
      ));
    }
    main.appendChild(dependencySection);
  }

  const conflicts = projection.conflicts;
  let decisionButton: HTMLButtonElement | null = null;
  const decisionControls: HTMLButtonElement[] = [];
  if (conflicts.length > 0) {
    main.appendChild(h('h3', undefined, '需要处理的冲突'));
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
        choice.setAttribute('data-choice-selected', selected ? 'true' : 'false');
        choice.setAttribute('aria-pressed', selected ? 'true' : 'false');
        choice.title = choiceText;
        choice.disabled = decisionChoiceLocked;
        choice.onclick = () => {
          if (!authorityWritable || decisionSaved || decisionWrites.has(workspace) || pendingTerminalAction !== null || projection.state === 'RETURNED') return;
          setResolution(workspace, conflict, 'choose-unit', option.unitId);
          if (decisionButton) decisionButton.disabled = !canSealDecision(projection, workspace.decisionDraft);
        };
        decisionControls.push(choice);
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
          if (decisionButton) decisionButton.disabled = !canSealDecision(projection, workspace.decisionDraft);
        };
        decisionControls.push(exclude);
        choices.appendChild(exclude);
      }
      if (conflict.allowedResolutions.includes('regenerate-candidate')) {
        const selected = savedResolution?.resolution === 'regenerate-candidate';
        const regenerate = h('button', 'danger', `让 Agent 重做${selected ? ' · 已选择' : ''}`) as HTMLButtonElement;
        regenerate.setAttribute('data-choice-regenerate', conflict.conflictId);
        regenerate.setAttribute('data-choice-selected', selected ? 'true' : 'false');
        regenerate.setAttribute('aria-pressed', selected ? 'true' : 'false');
        regenerate.disabled = decisionChoiceLocked;
        regenerate.onclick = () => {
          if (!authorityWritable || decisionSaved || decisionWrites.has(workspace) || pendingTerminalAction !== null) return;
          setResolution(workspace, conflict, 'regenerate-candidate');
          projection.state = 'RETURNED';
          stateLabel.textContent = labelForReviewState(projection.state);
          if (decisionButton) decisionButton.disabled = true;
          setStatus('已记录让 Agent 重做；不会生成 plan-ready decision', true, 5000);
        };
        decisionControls.push(regenerate);
        choices.appendChild(regenerate);
      }
      item.appendChild(choices);
      main.appendChild(item);
    }
  }
  const operations = h('div', 'review-operations');
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
  main.appendChild(operations);
  appendTechDetails(main, projection);
  shell.appendChild(main);
  renderObjectDetails(shell, workspace);
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
    marker.appendChild(h('div', undefined, `回执 ID：${approval.approvalId}`));
    marker.appendChild(h('div', undefined, `回执 fingerprint：${approval.approvalFingerprint}`));
  } else if (returned !== null) {
    marker.setAttribute('data-return-receipt', 'true');
    marker.setAttribute('data-return-id', returned.returnId);
    marker.setAttribute('data-return-fingerprint', returned.returnFingerprint);
    marker.appendChild(h('h3', undefined, '已退回'));
    marker.appendChild(h('div', undefined, `回执 ID：${returned.returnId}`));
    marker.appendChild(h('div', undefined, `回执 fingerprint：${returned.returnFingerprint}`));
  }
  marker.appendChild(h('div', undefined, `原决定：${result.plan.review.decisionId}`));
  marker.appendChild(h('div', undefined, `原选择：${listText(result.plan.selectedUnitIds)}`));
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
  const pendingTerminalAction = pendingTerminalActionOf(workspace);
  const resultWriteLocked = resultWrites.has(workspace);
  const resultPreviewLocked = resultPreviews.has(workspace);
  const resultFixtureLocked = resultFixtureOperations.has(workspace);
  const shell = h('div', 'review-workbench');
  const taskList = h('aside', 'review-task-list');
  taskList.appendChild(h('h2', undefined, '审阅任务'));
  taskList.appendChild(h('div', 'review-task-title', projection.task.title));
  taskList.appendChild(h('div', 'review-state', labelForReviewState(projection.state)));
  taskList.appendChild(h('div', 'review-result-fact', `计划：${result.planId}`));
  taskList.appendChild(h('div', 'review-result-fact', `工作修订：${result.workingRevision}`));
  taskList.appendChild(h('div', 'review-result-fact', `项目树身份：${result.resultTreeSha256}`));
  shell.appendChild(taskList);

  const main = h('section', 'review-main');
  main.appendChild(h('h2', undefined, '结果检查'));
  appendAuthorityStatus(main, workspace);
  appendFact(main, '计划指纹', result.planFingerprint);
  appendFact(main, '变更指纹', result.diffFingerprint);
  appendResultPlan(main, projection, result.plan);
  appendResultReceipt(main, workspace, result);
  appendResultDiff(main, result.diff);
  const freshness = result.freshness;
  appendFact(main, '证据新鲜度', [
    `diff ${labelForFreshness(freshness.diff)}`,
    `校验 ${labelForFreshness(freshness.validation)}`,
    `模拟 ${labelForFreshness(freshness.simulation)}`,
    `运行 ${labelForFreshness(freshness.runtime)}`,
  ].join('；'));
  if (result.warnings.length > 0) {
    main.appendChild(h('h3', undefined, '警告'));
    for (const warning of result.warnings) main.appendChild(h('div', 'review-warning', warning.message));
  }
  const previewShell = h('div', 'review-preview-shell');
  const previewButton = h('button', 'primary', '预览这个结果') as HTMLButtonElement;
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
        if (host) renderPreviewPanel(host as HTMLElement, { embedded: true });
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
  main.appendChild(previewShell);

  const evidence = h('section', 'review-evidence');
  evidence.appendChild(h('h3', undefined, '证据'));
  evidence.appendChild(h('div', undefined, `diff：${result.evidence.diffEvidenceId}`));
  evidence.appendChild(h('div', undefined, `校验：${result.evidence.validationEvidenceId}`));
  evidence.appendChild(h('div', undefined, `模拟：${result.evidence.simulationEvidenceId}`));
  const traceEvidence = reconcileReviewTraceEvidence(projection, state.previewTrace);
  evidence.appendChild(h('div', undefined, `实际观察：${state.previewTrace.length > 0 ? `${state.previewTrace.length} 个事件` : '尚未观察'}`));
  if (traceEvidence.matched.length > 0) evidence.appendChild(h('div', undefined, `已对照运行证据：${traceEvidence.matched.join('、')}`));
  if (traceEvidence.missing.length > 0) evidence.appendChild(h('div', 'review-warning', `待对照运行证据：${traceEvidence.missing.join('、')}`));
  if (traceEvidence.unexpected.length > 0) evidence.appendChild(h('div', 'review-warning', `正式证据外观察：${traceEvidence.unexpected.length} 个事件`));
  evidence.appendChild(h('div', 'review-result-fact', `项目树身份：${result.resultTreeSha256}`));
  main.appendChild(evidence);
  const operations = h('div', 'review-operations');
  operations.setAttribute('data-editor-region', 'workspace-actions');
  const terminalReceipt = workspace.receiptStatus === 'approval-written' || workspace.receiptStatus === 'returned';
  const authorityWritable = workspace.authority.state === 'available';
  const approve = h('button', 'primary', '批准这个计划') as HTMLButtonElement;
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
  const returned = h('button', 'danger', '退回修改') as HTMLButtonElement;
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
  main.appendChild(operations);
  if (workspace.fixtureChanged) main.appendChild(h('div', 'review-warning', '你正在查看探索性修改，批准已禁用。'));
  if (!resultEvidenceIsFresh(result)) main.appendChild(h('div', 'review-warning', '证据不是全部新鲜状态，批准已禁用。'));
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
  main.appendChild(refresh);
  appendTechDetails(main, projection);
  shell.appendChild(main);
  renderObjectDetails(shell, workspace);
  container.appendChild(shell);
}

export function renderReviewPanel(
  container: HTMLElement,
  workspace: ReviewWorkspaceState | null = state.reviewWorkspace,
  options: ReviewPanelOptions = {},
): void {
  container.innerHTML = '';
  if (workspace === null) {
    container.appendChild(h('div', 'empty', '暂无审阅任务'));
    return;
  }
  if (workspace.projection.kind === 'comparison') renderComparisonReview(container, workspace, options);
  else renderResultReview(container, workspace, options);
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
