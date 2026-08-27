import type {
  HumanReviewProjection,
  ReviewConflict,
} from '@surdet/authoring';
import { state, h, setStatus } from '../state.js';
import {
  canSealDecision,
  labelForConflictSeverity,
  labelForObjectKind,
  labelForReviewState,
  labelForUnknownCode,
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
  writeApprovalReceipt,
  writeDecisionReceipt,
  writeReturnReceipt,
  type ReviewDecisionDraft,
  type ReviewWorkspaceState,
} from '../review-workspace.js';
import { renderReviewCausalPanel } from './right.js';
import { renderPreviewPanel } from './preview-panel.js';

export interface ReviewPanelOptions {
  now?: () => string;
  onPreview?: (workspace: ReviewWorkspaceState, request: ReviewPreviewRequest) => Promise<void> | void;
}

function nowOf(options: ReviewPanelOptions): string {
  return options.now?.() ?? new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  for (const candidate of projection.candidates) {
    const item = h('div', 'review-candidate');
    item.appendChild(h('strong', undefined, `方案 ${candidate.displayOrdinal}`));
    if (candidate.declaredIntent) item.appendChild(h('div', undefined, candidate.declaredIntent));
    taskList.appendChild(item);
  }
  shell.appendChild(taskList);

  const main = h('section', 'review-main');
  main.appendChild(h('h2', undefined, '比较结果'));
  main.appendChild(h('div', 'review-evidence-summary', `共 ${projection.task.candidateCount} 个方案，${projection.task.objectCount} 个对象`));
  if (projection.safeGroups.length > 0) {
    main.appendChild(h('h3', undefined, '安全结果'));
    for (const group of projection.safeGroups) {
      const text = `${group.sourceCount} 个方案得到相同结果`;
      const item = h('div', 'review-safe-group', text);
      item.setAttribute('data-safe-group', group.groupId);
      item.appendChild(h('div', 'mono', group.primaryObject));
      main.appendChild(item);
    }
  }

  const conflicts = projection.conflicts;
  let decisionButton: HTMLButtonElement | null = null;
  if (conflicts.length > 0) {
    main.appendChild(h('h3', undefined, '需要处理的冲突'));
    for (const conflict of conflicts) {
      const item = h('article', `review-conflict ${conflict.severity}`);
      item.setAttribute('data-conflict-id', conflict.conflictId);
      item.appendChild(h('strong', undefined, labelForConflictSeverity(conflict.severity)));
      item.appendChild(h('div', undefined, conflict.severity === 'blocking' ? '该冲突阻止封存决定' : '请根据证据选择处理方式'));
      if (conflict.code !== 'OBJECT_RESULTS_DIVERGE') item.appendChild(h('div', 'review-unknown-code', labelForUnknownCode(conflict.code)));
      const choices = h('div', 'review-conflict-choices');
      for (const unitId of conflict.unitIds) {
        if (!conflict.allowedResolutions.includes('choose-unit')) continue;
        const choice = h('button', undefined, '选择这个结果') as HTMLButtonElement;
        choice.setAttribute('data-choice-unit', unitId);
        choice.title = unitId;
        choice.onclick = () => {
          if (projection.state === 'RETURNED') return;
          setResolution(workspace, conflict, 'choose-unit', unitId);
          if (decisionButton) decisionButton.disabled = !canSealDecision(projection, workspace.decisionDraft);
        };
        choices.appendChild(choice);
      }
      if (conflict.allowedResolutions.includes('exclude-all')) {
        const exclude = h('button', undefined, '全部不要') as HTMLButtonElement;
        exclude.setAttribute('data-choice-exclude', conflict.conflictId);
        exclude.onclick = () => {
          if (projection.state === 'RETURNED') return;
          setResolution(workspace, conflict, 'exclude-all');
          if (decisionButton) decisionButton.disabled = !canSealDecision(projection, workspace.decisionDraft);
        };
        choices.appendChild(exclude);
      }
      if (conflict.allowedResolutions.includes('regenerate-candidate')) {
        const regenerate = h('button', 'danger', '让 Agent 重做') as HTMLButtonElement;
        regenerate.setAttribute('data-choice-regenerate', conflict.conflictId);
        regenerate.onclick = () => {
          setResolution(workspace, conflict, 'regenerate-candidate');
          projection.state = 'RETURNED';
          stateLabel.textContent = labelForReviewState(projection.state);
          if (decisionButton) decisionButton.disabled = true;
          setStatus('已记录让 Agent 重做；不会生成 plan-ready decision', true, 5000);
        };
        choices.appendChild(regenerate);
      }
      item.appendChild(choices);
      main.appendChild(item);
    }
  }
  const operations = h('div', 'review-operations');
  decisionButton = appendDecisionButton(
    operations,
    workspace,
    '保存我的决定',
    'save-decision',
    !canSealDecision(projection, workspace.decisionDraft),
    () => {
      void writeDecisionReceipt(workspace, workspace.decisionDraft, nowOf(options))
        .then(() => setStatus('已保存我的决定', true, 5000))
        .catch((error) => setStatus(`保存决定失败：${errorMessage(error)}`, false, 6000));
    },
  );
  main.appendChild(operations);
  appendTechDetails(main, projection);
  shell.appendChild(main);
  renderObjectDetails(shell, workspace);
  container.appendChild(shell);
}

function renderResultReview(
  container: HTMLElement,
  workspace: ReviewWorkspaceState,
  options: ReviewPanelOptions,
): void {
  const projection = workspace.projection;
  const result = projection.finalResult;
  const shell = h('div', 'review-workbench');
  const taskList = h('aside', 'review-task-list');
  taskList.appendChild(h('h2', undefined, '审阅任务'));
  taskList.appendChild(h('div', 'review-task-title', projection.task.title));
  taskList.appendChild(h('div', 'review-state', labelForReviewState(projection.state)));
  taskList.appendChild(h('div', 'review-result-fact', `计划：${result?.planId ?? '未知'}`));
  taskList.appendChild(h('div', 'review-result-fact', `工作修订：${result?.workingRevision ?? '未知'}`));
  shell.appendChild(taskList);

  const main = h('section', 'review-main');
  main.appendChild(h('h2', undefined, '结果检查'));
  main.appendChild(h('div', 'review-result-fact', `变更指纹：${result?.diffFingerprint ?? '未知'}`));
  if (result && result.warnings.length > 0) {
    main.appendChild(h('h3', undefined, '警告'));
    for (const warning of result.warnings) main.appendChild(h('div', 'review-warning', warning.message));
  }
  const previewShell = h('div', 'review-preview-shell');
  const previewButton = h('button', 'primary', '预览这个结果') as HTMLButtonElement;
  previewButton.setAttribute('data-action', 'preview-result');
  previewButton.onclick = () => {
    const request: ReviewPreviewRequest = {};
    const operation = options.onPreview ? options.onPreview(workspace, request) : openReviewPreview(workspace, request);
    void Promise.resolve(operation)
      .then(() => {
        const target = document.getElementById('review-view') ?? container;
        renderReviewPanel(target, workspace, options);
        const host = target.querySelector('#review-preview-host');
        if (host) renderPreviewPanel(host as HTMLElement);
      })
      .catch((error) => setStatus(`预览结果失败：${errorMessage(error)}`, false, 6000));
  };
  previewShell.appendChild(previewButton);
  const host = h('div');
  host.id = 'review-preview-host';
  previewShell.appendChild(host);
  main.appendChild(previewShell);

  const evidence = h('section', 'review-evidence');
  evidence.appendChild(h('h3', undefined, '证据'));
  if (result) {
    evidence.appendChild(h('div', undefined, `diff：${result.evidence.diffEvidenceId}`));
    evidence.appendChild(h('div', undefined, `校验：${result.evidence.validationEvidenceId}`));
    evidence.appendChild(h('div', undefined, `模拟：${result.evidence.simulationEvidenceId}`));
    const observedIds = state.previewTrace.map((event) => `trace:${event.source.sceneId}:${event.source.line}`);
    const traceEvidence = reconcileReviewTraceEvidence(projection, observedIds);
    evidence.appendChild(h('div', undefined, `实际观察：${state.previewTrace.length > 0 ? `${state.previewTrace.length} 个事件` : '尚未观察'}`));
    if (traceEvidence.missing.length > 0) evidence.appendChild(h('div', 'review-warning', `待对照运行证据：${traceEvidence.missing.join('、')}`));
  }
  main.appendChild(evidence);
  const operations = h('div', 'review-operations');
  const approve = h('button', 'primary', '批准这个计划') as HTMLButtonElement;
  approve.setAttribute('data-action', 'approve-result');
  approve.disabled = workspace.fixtureChanged || workspace.receiptStatus === 'returned';
  approve.onclick = () => {
    if (result === undefined) return;
    void writeApprovalReceipt(workspace, { approvalId: `approval_${Date.now()}` }, nowOf(options))
      .then(() => setStatus('已批准这个计划', true, 5000))
      .catch((error) => setStatus(`批准失败：${errorMessage(error)}`, false, 6000));
  };
  operations.appendChild(approve);
  const returned = h('button', 'danger', '退回修改') as HTMLButtonElement;
  returned.setAttribute('data-action', 'return-result');
  returned.disabled = workspace.receiptStatus === 'approval-written';
  returned.onclick = () => {
    void writeReturnReceipt(workspace, { returnId: `return_${Date.now()}`, reasonCategory: 'other' }, nowOf(options))
      .then(() => setStatus('已退回修改', true, 5000))
      .catch((error) => setStatus(`退回失败：${errorMessage(error)}`, false, 6000));
  };
  operations.appendChild(returned);
  const reload = h('button', undefined, '重新加载正式结果') as HTMLButtonElement;
  reload.setAttribute('data-action', 'reload-official-result');
  reload.onclick = () => {
    void restoreOfficialResult(workspace)
      .then(() => {
        setStatus('已重新加载正式结果', true, 4000);
        renderReviewPanel(container, workspace, options);
      })
      .catch((error) => setStatus(`重新加载正式结果失败：${errorMessage(error)}`, false, 6000));
  };
  operations.appendChild(reload);
  main.appendChild(operations);
  if (workspace.fixtureChanged) main.appendChild(h('div', 'review-warning', '你正在查看探索性修改，批准已禁用。'));
  const refresh = h('button', undefined, '检查探索修改') as HTMLButtonElement;
  refresh.setAttribute('data-action', 'refresh-result-tree');
  refresh.onclick = () => {
    void refreshReviewFixtureIdentity(workspace)
      .then(() => renderReviewPanel(container, workspace, options))
      .catch((error) => setStatus(`检查预览文件失败：${errorMessage(error)}`, false, 6000));
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
  setStatus('已打开审阅任务', true, 4000);
}

/** 仅供预览状态探针调用，保持变化只在当前 review workspace 内。 */
export function markReviewPreviewExploration(workspace: ReviewWorkspaceState, treeSha256: string): void {
  markReviewFixtureChanged(workspace, treeSha256);
}
