import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FinalApprovalReceipt,
  HumanReviewProjection,
  ReturnRequestReceipt,
  ReviewObjectSummary,
  ReviewTerminalCommand,
} from '@surdet/authoring';
import {
  labelForConflictSeverity,
  labelForObjectKind,
  labelForReviewState,
} from '../src/review-model.js';
import { renderReviewPanel } from '../src/panels/review-panel.js';
import {
  markReviewFixtureChanged,
  reloadOfficialResult,
} from '../src/review-preview.js';
import type { ReviewWorkspaceState } from '../src/review-workspace.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  className = '';
  disabled = false;
  open = false;
  value = '';
  type = '';
  title = '';
  onclick: (() => void) | null = null;
  ontoggle: (() => void) | null = null;
  private ownText = '';

  set innerHTML(value: string) {
    if (value === '') {
      this.ownText = '';
      this.children.splice(0);
    }
  }

  get childElementCount(): number {
    return this.children.length;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set textContent(value: string | null) {
    this.ownText = value ?? '';
    this.children.splice(0);
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  get directTextContent(): string {
    return this.ownText;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  click(): void {
    if (!this.disabled) this.onclick?.();
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const match = (element: FakeElement): boolean => {
      if (selector === 'button') return element.tagName === 'BUTTON';
      const data = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      if (!data) return false;
      const value = element.getAttribute(`data-${data[1]}`);
      return value !== null && (data[2] === undefined || value === data[2]);
    };
    const visit = (element: FakeElement): void => {
      if (match(element)) found.push(element);
      for (const child of element.children) visit(child);
    };
    visit(this);
    return found;
  }
}

function textOf(element: FakeElement): string {
  const visible = (current: FakeElement): string => {
    if (current.tagName === 'DETAILS' && !current.open) {
      return current.children.slice(0, 1).map(visible).join('');
    }
    return current.directTextContent + current.children.map(visible).join('');
  };
  return visible(element);
}

const statusElement = new FakeElement('div');

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (text: string) => {
    const node = new FakeElement('#text');
    node.textContent = text;
    return node;
  },
  getElementById: (id: string) => id === 'status' ? statusElement : null,
};

function object(objectRef: string): ReviewObjectSummary {
  return {
    objectRef,
    kind: 'scene',
    semanticId: objectRef,
    source: { path: 'content/scenario/wave6_alpha.gal', line: 1, col: 1 },
    references: ['timeline:wave6_intro'],
    referencedBy: ['scene:root'],
    potentialImpact: ['候选影响'],
    observedImpact: ['trace-1'],
  };
}

function comparisonWorkspace(): ReviewWorkspaceState {
  const projection: HumanReviewProjection = {
    reviewVersion: '1.0.0',
    reviewId: 'review_comparison_wave6',
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    projectIdentity: 'project-1',
    expectedProjectRevision: 'revision-1',
    task: { title: '候选创作方案审阅', acceptanceCriteria: ['看清冲突'], candidateCount: 3, objectCount: 1, conflictCount: 1, statementSource: 'generated-fallback' },
    candidates: [
      { candidateId: 'candidate-a', displayOrdinal: 'A', ref: { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) }, acceptanceCriteria: [], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] } },
      { candidateId: 'candidate-c', displayOrdinal: 'C', ref: { changeId: 'change-c', capsuleId: 'capsule-c', artifactSha256: 'c'.repeat(64) }, acceptanceCriteria: [], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] } },
      { candidateId: 'candidate-d', displayOrdinal: 'D', ref: { changeId: 'change-d', capsuleId: 'capsule-d', artifactSha256: 'd'.repeat(64) }, acceptanceCriteria: [], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] } },
    ],
    safeGroups: [{
      groupId: 'group-1', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'same-result',
      unitIds: ['unit-a', 'unit-d'], candidateIds: ['candidate-a', 'candidate-d'], sourceCount: 2, includedByDefault: true, collapsedByDefault: true,
      sources: [
        { unitId: 'unit-a', candidateId: 'candidate-a', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'same-result', outcomes: [{ objectRef: 'scene:wave6_alpha', disposition: 'create', finalFingerprint: 'same-result' }], potentialImpact: ['候选影响'], observedImpact: ['trace-1'], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] }, presentation: { actionLabel: '新建场景', objectLabel: '场景 wave6_alpha', highlights: ['lynn：Alpha route A.'], completeness: 'content', omittedFactCount: 0 } },
        { unitId: 'unit-d', candidateId: 'candidate-d', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'same-result', outcomes: [{ objectRef: 'scene:wave6_alpha', disposition: 'create', finalFingerprint: 'same-result' }], potentialImpact: ['候选影响'], observedImpact: [], evidence: { validation: 'missing', simulation: 'fresh', runtime: 'fresh', warnings: 1, manualReviewRequired: ['需要补证据'] }, presentation: { actionLabel: '新建场景', objectLabel: '场景 wave6_alpha', highlights: ['lynn：Alpha route A.'], completeness: 'content', omittedFactCount: 0 } },
      ],
      dependencyObjectRefs: ['timeline:wave6_intro'],
      potentialImpact: ['候选影响'], observedImpact: ['trace-1'],
      evidence: { warningCount: 1, missing: true, stale: false, failed: false, incomplete: false, manualReviewRequired: ['需要补证据'] },
    }],
    defaultSelectedUnitIds: ['unit-a', 'unit-d', 'unit-b-scene'],
    conflicts: [{
      conflictId: 'conflict-1', severity: 'selection-required', code: 'OBJECT_RESULTS_DIVERGE',
      unitIds: ['unit-a', 'unit-c', 'unit-d'], candidateIds: ['candidate-a', 'candidate-c', 'candidate-d'], objectRefs: ['scene:wave6_alpha'],
      allowedResolutions: ['choose-unit', 'exclude-all', 'regenerate-candidate'], repairActions: ['检查对象'],
      options: [
        { unitId: 'unit-a', candidateId: 'candidate-a', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'same-result', outcomes: [{ objectRef: 'scene:wave6_alpha', disposition: 'create', finalFingerprint: 'same-result' }], potentialImpact: ['可能改变 Alpha'], observedImpact: ['已观察 Alpha'], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] }, presentation: { actionLabel: '新建场景', objectLabel: '场景 wave6_alpha', highlights: ['lynn：Alpha route A.'], completeness: 'content', omittedFactCount: 0 } },
        { unitId: 'unit-c', candidateId: 'candidate-c', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'different-result', outcomes: [{ objectRef: 'scene:wave6_alpha', disposition: 'create', finalFingerprint: 'different-result' }], potentialImpact: ['可能改写 Alpha'], observedImpact: ['已观察 C'], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] }, presentation: { actionLabel: '新建场景', objectLabel: '场景 wave6_alpha', highlights: ['lynn：Alpha route C.'], completeness: 'content', omittedFactCount: 0 } },
        { unitId: 'unit-d', candidateId: 'candidate-d', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'same-result', outcomes: [{ objectRef: 'scene:wave6_alpha', disposition: 'create', finalFingerprint: 'same-result' }], potentialImpact: ['可能改变 Alpha'], observedImpact: ['已观察 D'], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] }, presentation: { actionLabel: '新建场景', objectLabel: '场景 wave6_alpha', highlights: ['lynn：Alpha route A.'], completeness: 'content', omittedFactCount: 0 } },
      ],
    }],
    dependencies: [{
      fromUnitId: 'unit-b-scene',
      toUnitId: 'unit-b-timeline',
      fromObjectRef: 'scene:wave6_beta',
      objectRef: 'timeline:wave6_beta_opening',
      inclusion: 'implicit',
    }],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 1, advisoryCount: 0, canCreateDecision: true },
    objects: [object('scene:wave6_alpha')],
    sourceIdentity: { projectIdentity: 'project-1', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'comparison-fp' },
    reviewFingerprint: 'review-fp',
  };
  return workspaceFor(projection);
}

function resultWorkspace(): ReviewWorkspaceState {
  const projection = comparisonWorkspace().projection;
  const result: HumanReviewProjection = {
    ...projection,
    reviewId: 'review_result_wave6',
    kind: 'integration-result',
    state: 'STAGE_READY',
    candidates: [],
    defaultSelectedUnitIds: [],
    sourceIdentity: { ...projection.sourceIdentity, planFingerprint: 'plan-fp', integrationChangeId: 'change-1', workingRevision: 2, decisionReviewId: 'review_comparison_wave6', decisionId: 'decision-1', decisionFingerprint: 'decision-fp' },
    finalResult: {
      planId: 'plan-1', planFingerprint: 'plan-fp', integrationChangeId: 'change-1', workingRevision: 2, diffFingerprint: 'diff-fp',
      changedObjects: [object('scene:wave6_alpha')],
      evidence: { diffEvidenceId: 'diff-1', validationEvidenceId: 'validation-1', simulationEvidenceId: 'simulation-1', runtimeTraceIds: ['trace-1'] },
      plan: {
        review: { reviewState: 'human-reviewed', reviewId: 'review_comparison_wave6', decisionId: 'decision-1', decisionFingerprint: 'decision-fp' },
        sourceCapsules: [
          { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) },
          { changeId: 'change-d', capsuleId: 'capsule-d', artifactSha256: 'd'.repeat(64) },
        ],
        sourceCandidates: [
          { ref: { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) }, displayOrdinal: 'A' },
          { ref: { changeId: 'change-d', capsuleId: 'capsule-d', artifactSha256: 'd'.repeat(64) }, displayOrdinal: 'D' },
        ],
        selectedUnitIds: ['unit-a'], includedUnitIds: ['unit-a', 'unit-b-timeline'], implicitInclusions: ['unit-b-timeline'],
        excludedUnitIds: ['unit-c'], deduplicatedUnits: [{ groupId: 'group-1', retainedUnitId: 'unit-a', provenanceUnitIds: ['unit-a', 'unit-d'] }],
        conflictResolutions: [],
        replayOperations: [],
        provenance: [
          { targetObject: 'scene:wave6_alpha', sourceCapsule: { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) }, sourceUnitId: 'unit-a', sourceOperationIds: ['source-a'] },
          { targetObject: 'scene:wave6_alpha', sourceCapsule: { changeId: 'change-d', capsuleId: 'capsule-d', artifactSha256: 'd'.repeat(64) }, sourceUnitId: 'unit-d', sourceOperationIds: ['source-d'] },
        ],
        finalObjectFingerprints: { 'scene:wave6_alpha': 'same-result', 'timeline:wave6_intro': 'timeline-fp' },
      },
      diff: { summary: { createdScenes: 1, modifiedScenes: 0, changedVariables: 0, warnings: [] }, semantic: [], files: [{ path: 'content/scenario/wave6_alpha.gal', unifiedDiff: '+Alpha A', unexpectedFormatChange: false }] },
      freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
      runtimeTraceObservations: [{ traceId: 'trace-1', observationKeys: ['text|wave6_alpha|0|text|content/scenario/wave6_alpha.gal|2|1'] }],
      resultTreeSha256: 'tree-fp', warnings: [],
    },
  };
  return workspaceFor(projectionWithResult(result));
}

function projectionWithResult(projection: HumanReviewProjection): HumanReviewProjection {
  return projection;
}

function workspaceFor(projection: HumanReviewProjection): ReviewWorkspaceState {
  return {
    rootHandle: {} as FileSystemDirectoryHandle,
    identity: {
      reviewVersion: '1.0.0', reviewId: projection.reviewId, kind: projection.kind,
      projectIdentity: projection.projectIdentity, expectedProjectRevision: projection.expectedProjectRevision,
      comparisonFingerprint: projection.sourceIdentity.comparisonFingerprint,
      payload: { relativePath: projection.kind === 'comparison' ? 'comparison/review.json' : 'result/review.json', bytes: 1, sha256: '0'.repeat(64) },
    },
    projection,
    decisionDraft: { decisionId: '', selectedUnitIds: [...projection.defaultSelectedUnitIds], conflictResolutions: [] },
    selectedReviewObjectRef: null,
    projectHandle: null,
    officialResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    currentResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    fixtureChanged: false,
    receiptStatus: 'none',
    decisionReceipt: null,
    approvalReceipt: null,
    returnReceipt: null,
    authority: { state: 'available', message: '本机审阅服务已连接。' },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  statusElement.textContent = '';
});

describe('Editor review panel', () => {
  it('keeps review content visible but disables terminal controls when the local authority is unavailable', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    Object.assign(workspace, {
      authority: {
        state: 'unavailable',
        message: '本机审阅服务未连接。内容仍可查看，但暂时不能批准或退回。请从 Surdet 正常入口重新打开。',
      },
    });
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(textOf(container)).toContain('本机审阅服务未连接');
    expect(container.querySelector('[data-action="save-decision"]')?.disabled).toBe(true);
    for (const choice of container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-choice-unit') !== null
      || button.getAttribute('data-choice-exclude') !== null
      || button.getAttribute('data-choice-regenerate') !== null
    ))) expect(choice.disabled).toBe(true);
  });

  it.each([
    ['mismatch', '本机审阅服务与当前审阅任务不一致。'],
    ['corrupt', '本机审阅服务检测到审阅回执损坏。'],
  ] as const)('keeps evidence readable and terminal controls disabled for authority %s', (authorityState, message) => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    workspace.authority = { state: authorityState, message };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(textOf(container)).toContain('比较结果');
    expect(textOf(container)).toContain(message);
    for (const control of container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-choice-unit') !== null
      || button.getAttribute('data-choice-exclude') !== null
      || button.getAttribute('data-choice-regenerate') !== null
      || button.getAttribute('data-action') === 'save-decision'
    ))) expect(control.disabled).toBe(true);
  });

  it('renders human-first comparison text, technical details, and a resolved choice', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(textOf(container)).toContain('审阅任务');
    expect(textOf(container)).toContain('候选创作方案审阅');
    expect(textOf(container)).toContain('方案 A（本次审阅编号）');
    expect(textOf(container)).toContain('方案字母只用于本次审阅排序');
    expect(textOf(container)).toContain('2 个方案得到相同结果');
    expect(textOf(container)).toContain('场景 wave6_alpha');
    expect(textOf(container)).toContain('默认纳入');
    expect(textOf(container)).toContain('证据缺失');
    expect(textOf(container)).toContain('需要你决定');
    expect(textOf(container)).toContain('Alpha route A.');
    expect(textOf(container)).toContain('Alpha route C.');
    expect(textOf(container)).not.toContain('OBJECT_RESULTS_DIVERGE');
    expect(textOf(container)).not.toContain('candidate-a');
    expect(textOf(container)).not.toContain('unit-a');
    expect(textOf(container)).not.toContain('same-result');

    const safeGroup = container.querySelector('[data-safe-group="group-1"]');
    expect(safeGroup?.tagName).toBe('DETAILS');
    expect(safeGroup?.open).toBe(false);
    expect(textOf(safeGroup!)).not.toContain('candidate-a');
    safeGroup!.open = true;
    expect(textOf(safeGroup!)).toContain('方案 A');
    expect(textOf(safeGroup!)).toContain('方案 D');
    expect(textOf(safeGroup!)).toContain('Alpha route A.');
    expect(textOf(safeGroup!)).toContain('依赖对象：时间轴 wave6_intro');
    expect(textOf(safeGroup!)).toContain('可能影响');
    expect(textOf(safeGroup!)).toContain('实际观察');
    expect(textOf(safeGroup!)).toContain('group-1');
    expect(textOf(safeGroup!)).not.toContain('changeId: change-a');
    const sourceTechnical = safeGroup!.querySelector('[data-source-technical="unit-a"]')!;
    sourceTechnical.open = true;
    expect(textOf(sourceTechnical)).toContain('changeId: change-a');
    expect(textOf(sourceTechnical)).toContain('capsuleId: capsule-a');
    expect(textOf(sourceTechnical)).toContain(`artifactSha256: ${'a'.repeat(64)}`);

    const details = container.querySelector('[data-tech-details]');
    expect(details).not.toBeNull();
    details!.open = true;
    details!.ontoggle?.();
    expect(details!.textContent).toContain('OBJECT_RESULTS_DIVERGE');
    expect(details!.textContent).toContain('comparison-fp');

    const decisionButton = container.querySelector('[data-action="save-decision"]');
    expect(decisionButton?.disabled).toBe(true);
    const choiceForUnit = container.querySelector('[data-choice-unit="unit-a"]');
    expect(choiceForUnit).not.toBeNull();
    expect(choiceForUnit!.textContent).toContain('方案 A');
    expect(choiceForUnit!.textContent).toContain('场景 wave6_alpha');
    expect(container.querySelector('[data-choice-unit="unit-d"]')!.textContent).toContain('方案 D');
    expect(container.querySelector('[data-choice-unit="unit-d"]')!.textContent).not.toBe(choiceForUnit!.textContent);
    choiceForUnit!.click();
    expect(decisionButton?.disabled).toBe(false);
    expect(workspace.decisionDraft.conflictResolutions).toEqual([
      { conflictId: 'conflict-1', resolution: 'choose-unit', chosenUnitId: 'unit-a' },
    ]);
  });

  it('shows every selection option as human-readable evidence with a folded fingerprint', () => {
    vi.stubGlobal('document', documentStub);
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, comparisonWorkspace());

    const optionA = container.querySelector('[data-choice-option-unit="unit-a"]');
    const optionD = container.querySelector('[data-choice-option-unit="unit-d"]');
    expect(optionA).not.toBeNull();
    expect(optionD).not.toBeNull();
    expect(textOf(optionA!)).toContain('方案 A');
    expect(textOf(optionA!)).toContain('场景 wave6_alpha');
    expect(textOf(optionA!)).toContain('新建场景');
    expect(textOf(optionA!)).toContain('Alpha route A.');
    expect(textOf(optionA!)).toContain('可能影响：可能改变 Alpha');
    expect(textOf(optionA!)).toContain('实际观察：已观察 Alpha');
    expect(textOf(optionA!)).toContain('校验 新鲜');
    expect(textOf(optionA!)).not.toContain('same-result');
    expect(textOf(optionD!)).toContain('方案 D');
    expect(textOf(optionD!)).toContain('Alpha route A.');
    expect(textOf(optionD!)).toContain('可能影响：可能改变 Alpha');
    const fingerprint = optionA!.querySelector('[data-choice-fingerprint]');
    expect(fingerprint?.tagName).toBe('DETAILS');
    fingerprint!.open = true;
    expect(textOf(fingerprint!)).toContain('same-result');
    expect(textOf(fingerprint!)).toContain('unitId: unit-a');
    expect(textOf(fingerprint!)).toContain('candidateId: candidate-a');
    const optionC = container.querySelector('[data-choice-option-unit="unit-c"]')!;
    expect(textOf(optionC)).toContain('Alpha route C.');
    expect(textOf(optionC)).not.toContain('Alpha route A.');
  });

  it('marks a legacy comparison option as content-summary insufficient without inventing prose', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    for (const option of workspace.projection.conflicts[0]!.options) delete (option as typeof option & { presentation?: unknown }).presentation;
    for (const source of workspace.projection.safeGroups[0]!.sources) delete (source as typeof source & { presentation?: unknown }).presentation;
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);

    expect(textOf(container)).toContain('旧审阅包缺少内容摘要');
    expect(textOf(container)).toContain('内容摘要不足');
    expect(textOf(container)).not.toContain('Alpha route A.');
    expect(textOf(container)).not.toContain('Alpha route C.');
  });

  it('shows an implicit dependency as a human-readable scene to timeline relation', () => {
    vi.stubGlobal('document', documentStub);
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, comparisonWorkspace());

    expect(textOf(container)).toContain('依赖自动纳入：场景 wave6_beta → 时间轴 wave6_beta_opening');
  });

  it('renders a persisted decision receipt, restores the choice, and freezes every decision control', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    workspace.receiptStatus = 'decision-written';
    workspace.decisionDraft = {
      decisionId: 'decision-saved-1',
      selectedUnitIds: ['unit-a', 'unit-b-scene'],
      conflictResolutions: [{ conflictId: 'conflict-1', resolution: 'choose-unit', chosenUnitId: 'unit-a' }],
    };
    workspace.decisionReceipt = {
      receiptVersion: '1.0.0',
      decisionId: 'decision-saved-1',
      reviewId: workspace.projection.reviewId,
      comparisonFingerprint: workspace.projection.sourceIdentity.comparisonFingerprint,
      projectIdentity: workspace.projection.projectIdentity,
      expectedProjectRevision: workspace.projection.expectedProjectRevision,
      candidateRefs: workspace.projection.candidates.map((candidate) => candidate.ref),
      selectedUnitIds: [...workspace.decisionDraft.selectedUnitIds],
      conflictResolutions: workspace.decisionDraft.conflictResolutions.map((resolution) => ({ ...resolution })),
      reviewerChannel: 'surdet-editor-local',
      decidedAt: '2026-08-29T00:00:00.000Z',
      decisionFingerprint: 'f'.repeat(64),
    };
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);

    const marker = container.querySelector('[data-decision-receipt]');
    expect(marker).not.toBeNull();
    expect(textOf(marker!)).toContain('已读取已保存的决定');
    expect(marker!.getAttribute('data-decision-id')).toBe('decision-saved-1');
    expect(marker!.getAttribute('data-decision-fingerprint')).toBe('f'.repeat(64));
    const selected = container.querySelector('[data-choice-unit="unit-a"]');
    expect(selected?.getAttribute('data-choice-selected')).toBe('true');
    expect(textOf(selected!)).toContain('已选择');
    for (const control of container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-choice-unit') !== null
      || button.getAttribute('data-choice-exclude') !== null
      || button.getAttribute('data-choice-regenerate') !== null
      || button.getAttribute('data-action') === 'save-decision'
    ))) {
      expect(control.disabled).toBe(true);
    }
    const save = container.querySelector('[data-action="save-decision"]');
    expect(save?.textContent).toContain('决定已保存');
    save?.click();
    expect(workspace.decisionReceipt?.decisionId).toBe('decision-saved-1');
  });

  it('generates one decision identity and reuses it after an uncertain save response', async () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const terminalClient = {
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write: vi.fn(async (_command: ReviewTerminalCommand) => {
        throw Object.assign(new Error('forced authority write failure'), { code: 'REVIEW_BUSY' });
      }),
    };
    const container = new FakeElement('div');
    const options = { now: () => '2026-08-29T00:00:00.000Z', reviewTerminalClient: terminalClient };
    renderReviewPanel(container as unknown as HTMLElement, workspace, options);

    container.querySelector('[data-choice-unit="unit-a"]')!.click();
    const save = container.querySelector('[data-action="save-decision"]')!;
    save.click();
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    const firstDecisionId = workspace.decisionDraft.decisionId;
    expect(firstDecisionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    statusElement.textContent = '';
    container.querySelector('[data-action="save-decision"]')!.click();
    expect(workspace.decisionDraft.decisionId).toBe(firstDecisionId);
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    const lockedChoice = container.querySelector('[data-choice-unit="unit-d"]')!;
    expect(lockedChoice.disabled).toBe(true);
    lockedChoice.click();
    expect(workspace.decisionDraft.decisionId).toBe(firstDecisionId);
    statusElement.textContent = '';
    container.querySelector('[data-action="save-decision"]')!.click();
    expect(workspace.decisionDraft.decisionId).toBe(firstDecisionId);
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    const commands = terminalClient.write.mock.calls.map(([command]) => command);
    expect(commands).toHaveLength(3);
    expect(new Set(commands.map((command) => command.requestId)).size).toBe(1);
    expect(commands[2]?.receipt).toEqual(commands[0]?.receipt);
  });

  it('does not expose raw transport errors in the user-facing save message', async () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const terminalClient = {
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write: async () => { throw new Error('ENGLISH_SECRET_DETAIL'); },
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { reviewTerminalClient: terminalClient });
    container.querySelector('[data-choice-unit="unit-a"]')!.click();
    container.querySelector('[data-action="save-decision"]')!.click();
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    expect(statusElement.textContent).not.toContain('ENGLISH_SECRET_DETAIL');
    expect(statusElement.textContent).toContain('操作未完成');
  });

  it('freezes every decision control while a receipt write is pending', async () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    let rejectWrite: ((error: Error) => void) | null = null;
    const write = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectWrite = reject;
    }));
    const terminalClient = {
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write,
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, {
      now: () => '2026-08-29T00:00:00.000Z',
      reviewTerminalClient: terminalClient,
    });

    const choiceA = container.querySelector('[data-choice-unit="unit-a"]')!;
    const choiceD = container.querySelector('[data-choice-unit="unit-d"]')!;
    choiceA.click();
    const selectedBeforeSave = [...workspace.decisionDraft.selectedUnitIds];
    const resolutionsBeforeSave = workspace.decisionDraft.conflictResolutions.map((resolution) => ({ ...resolution }));
    const save = container.querySelector('[data-action="save-decision"]')!;
    save.click();
    save.click();
    const sealedDecisionId = workspace.decisionDraft.decisionId;

    const decisionControls = container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-choice-unit') !== null
      || button.getAttribute('data-choice-exclude') !== null
      || button.getAttribute('data-choice-regenerate') !== null
      || button.getAttribute('data-action') === 'save-decision'
    ));
    for (const control of decisionControls) expect(control.disabled).toBe(true);
    choiceD.click();
    expect(workspace.decisionDraft).toEqual({
      decisionId: sealedDecisionId,
      selectedUnitIds: selectedBeforeSave,
      conflictResolutions: resolutionsBeforeSave,
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    rejectWrite!(Object.assign(new Error('release pending receipt write'), { code: 'REVIEW_BUSY' }));
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    for (const control of container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-choice-unit') !== null
      || button.getAttribute('data-choice-exclude') !== null
      || button.getAttribute('data-choice-regenerate') !== null
    ))) expect(control.disabled).toBe(true);
    expect(container.querySelector('[data-action="save-decision"]')?.disabled).toBe(false);
    expect(container.querySelector('[data-action="save-decision"]')?.textContent).toContain('再次确认');
  });

  it('submits only one result terminal command while approval is pending', async () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    let rejectWrite: ((error: Error) => void) | null = null;
    const write = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectWrite = reject;
    }));
    const terminalClient = {
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write,
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { reviewTerminalClient: terminalClient });

    const approve = container.querySelector('[data-action="approve-result"]')!;
    const returned = container.querySelector('[data-action="return-result"]')!;
    approve.click();
    approve.click();
    returned.click();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(approve.disabled).toBe(true);
    expect(returned.disabled).toBe(true);
    expect(container.querySelector('[data-action="preview-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="reload-official-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="refresh-result-tree"]')?.disabled).toBe(true);

    rejectWrite!(Object.assign(new Error('release pending approval'), { code: 'REVIEW_BUSY' }));
    await vi.waitFor(() => expect(statusElement.textContent).toContain('批准失败'));
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(false);
    expect(container.querySelector('[data-action="return-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="preview-result"]')?.disabled).toBe(true);
  });

  it('keeps preview and terminal result writes mutually exclusive', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const write = vi.fn(async (_command: ReviewTerminalCommand) => { throw new Error('must not write'); });
    const terminalClient = {
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write,
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, {
      reviewTerminalClient: terminalClient,
      onPreview: () => new Promise<void>(() => {}),
    });

    container.querySelector('[data-action="preview-result"]')!.click();
    const approve = container.querySelector('[data-action="approve-result"]')!;
    const returned = container.querySelector('[data-action="return-result"]')!;
    expect(approve.disabled).toBe(true);
    expect(returned.disabled).toBe(true);
    expect(container.querySelector('[data-action="reload-official-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="refresh-result-tree"]')?.disabled).toBe(true);
    approve.click();
    returned.click();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ['重新加载正式结果', 'reload-official-result', 'onReloadOfficialResult'],
    ['检查探索修改', 'refresh-result-tree', 'onRefreshFixtureIdentity'],
  ] as const)('locks every competing result action while %s is running', async (_label, action, callback) => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    let finishOperation: (() => void) | null = null;
    const pendingOperation = new Promise<void>((resolve) => { finishOperation = resolve; });
    const write = vi.fn(async (_command: ReviewTerminalCommand) => { throw new Error('must not write'); });
    const onPreview = vi.fn(async () => { throw new Error('must not preview'); });
    const terminalClient = {
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write,
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, {
      reviewTerminalClient: terminalClient,
      onPreview,
      [callback]: () => pendingOperation,
    });

    container.querySelector(`[data-action="${action}"]`)!.click();
    const competingActions = [
      'approve-result',
      'return-result',
      'preview-result',
      'reload-official-result',
      'refresh-result-tree',
    ];
    for (const competingAction of competingActions) {
      expect(container.querySelector(`[data-action="${competingAction}"]`)?.disabled).toBe(true);
      container.querySelector(`[data-action="${competingAction}"]`)?.click();
    }
    expect(write).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();

    finishOperation!();
    await vi.waitFor(() => expect(container.querySelector(`[data-action="${action}"]`)?.disabled).toBe(false));
  });

  it('keeps a healthy collapsed group explicit and names an empty dependency set', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const group = workspace.projection.safeGroups[0]!;
    group.dependencyObjectRefs = [];
    group.evidence = {
      warningCount: 0,
      missing: false,
      stale: false,
      failed: false,
      incomplete: false,
      manualReviewRequired: [],
    };
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    const safeGroup = container.querySelector('[data-safe-group="group-1"]');
    expect(textOf(safeGroup!)).toContain('证据正常');
    safeGroup!.open = true;
    expect(textOf(safeGroup!)).toContain('无依赖对象');
  });

  it('gates result approval when exploration changes the fixture and can reload the official result', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(textOf(container)).toContain('明确选择：unit-a');
    expect(textOf(container)).toContain('实际纳入：unit-a、unit-b-timeline');
    expect(textOf(container)).toContain('自动纳入：unit-b-timeline');
    expect(textOf(container)).toContain('明确排除：unit-c');
    expect(textOf(container)).toContain('去重保留：unit-a；来源 unit-a、unit-d');
    expect(textOf(container)).toContain('方案 A');
    expect(textOf(container)).toContain('方案 D');
    expect(textOf(container)).toContain('最终对象指纹');
    expect(textOf(container)).toContain('content/scenario/wave6_alpha.gal');
    expect(textOf(container)).toContain('证据新鲜度：diff 新鲜；校验 新鲜；模拟 新鲜；运行 新鲜');
    expect(textOf(container)).toContain('项目树身份：tree-fp');
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(false);
    markReviewFixtureChanged(workspace, 'changed-tree');
    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(true);
    expect(textOf(container)).toContain('你正在查看探索性修改');
    reloadOfficialResult(workspace);
    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(false);
  });

  it('renders a reopened approval as a persistent Chinese readonly terminal state', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const result = workspace.projection.finalResult!;
    const approval: FinalApprovalReceipt = {
      receiptVersion: '1.0.0',
      approvalId: 'approval-reopened',
      resultReviewId: workspace.projection.reviewId,
      decisionFingerprint: workspace.projection.sourceIdentity.decisionFingerprint!,
      planId: result.planId,
      planFingerprint: result.planFingerprint,
      integrationChangeId: result.integrationChangeId,
      workingRevision: result.workingRevision,
      projectIdentity: workspace.projection.projectIdentity,
      expectedProjectRevision: workspace.projection.expectedProjectRevision,
      diffFingerprint: result.diffFingerprint,
      evidence: result.evidence,
      resultTreeSha256: result.resultTreeSha256,
      reviewerChannel: 'surdet-editor-local',
      approvedAt: '2026-08-30T00:00:00.000Z',
      approvalFingerprint: 'a'.repeat(64),
    };
    Object.assign(workspace, { receiptStatus: 'approval-written', approvalReceipt: approval, returnReceipt: null });
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);

    const marker = container.querySelector('[data-result-receipt]');
    expect(marker).not.toBeNull();
    expect(textOf(marker!)).toContain('已批准');
    expect(textOf(marker!)).toContain('回执 ID：approval-reopened');
    expect(textOf(marker!)).toContain(`回执 fingerprint：${'a'.repeat(64)}`);
    expect(textOf(marker!)).toContain('原决定：decision-1');
    expect(textOf(marker!)).toContain('原选择：unit-a');
    expect(marker!.getAttribute('data-approval-id')).toBe('approval-reopened');
    expect(marker!.getAttribute('data-approval-fingerprint')).toBe('a'.repeat(64));
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="return-result"]')?.disabled).toBe(true);
  });

  it('renders a reopened return as a persistent Chinese readonly terminal state', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const result = workspace.projection.finalResult!;
    const returned: ReturnRequestReceipt = {
      receiptVersion: '1.0.0',
      returnId: 'return-reopened',
      resultReviewId: workspace.projection.reviewId,
      planId: result.planId,
      planFingerprint: result.planFingerprint,
      integrationChangeId: result.integrationChangeId,
      workingRevision: result.workingRevision,
      reasonCategory: 'presentation',
      reviewerChannel: 'surdet-editor-local',
      returnedAt: '2026-08-30T00:00:00.000Z',
      returnFingerprint: 'b'.repeat(64),
    };
    Object.assign(workspace, { receiptStatus: 'returned', approvalReceipt: null, returnReceipt: returned });
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);

    const marker = container.querySelector('[data-result-receipt]');
    expect(marker).not.toBeNull();
    expect(textOf(marker!)).toContain('已退回');
    expect(textOf(marker!)).toContain('回执 ID：return-reopened');
    expect(textOf(marker!)).toContain(`回执 fingerprint：${'b'.repeat(64)}`);
    expect(textOf(marker!)).toContain('原决定：decision-1');
    expect(textOf(marker!)).toContain('原选择：unit-a');
    expect(marker!.getAttribute('data-return-id')).toBe('return-reopened');
    expect(marker!.getAttribute('data-return-fingerprint')).toBe('b'.repeat(64));
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="return-result"]')?.disabled).toBe(true);
  });

  it('keeps the fixed human labels visible for the review workbench', () => {
    expect(labelForObjectKind('scene')).toBe('场景');
    expect(labelForObjectKind('timeline')).toBe('时间轴');
    expect(labelForReviewState('STAGE_READY')).toBe('结果已准备，请检查');
    expect(labelForConflictSeverity('selection-required')).toBe('需要你决定');
  });
});
