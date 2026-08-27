import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HumanReviewProjection, ReviewObjectSummary } from '@surdet/authoring';
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
    return current.textContent;
  };
  return visible(element);
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (text: string) => {
    const node = new FakeElement('#text');
    node.textContent = text;
    return node;
  },
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
    task: { title: 'Human review task', acceptanceCriteria: ['看清冲突'], candidateCount: 2, objectCount: 1, conflictCount: 1, statementSource: 'candidate-intent' },
    candidates: [
      { candidateId: 'candidate-a', displayOrdinal: 'A', ref: { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) }, acceptanceCriteria: [], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] } },
      { candidateId: 'candidate-d', displayOrdinal: 'D', ref: { changeId: 'change-d', capsuleId: 'capsule-d', artifactSha256: 'd'.repeat(64) }, acceptanceCriteria: [], evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] } },
    ],
    safeGroups: [{ groupId: 'group-1', primaryObject: 'scene:wave6_alpha', finalFingerprint: 'same-result', unitIds: ['unit-a', 'unit-d'], candidateIds: ['candidate-a', 'candidate-d'], sourceCount: 2, includedByDefault: true }],
    conflicts: [{ conflictId: 'conflict-1', severity: 'selection-required', code: 'OBJECT_RESULTS_DIVERGE', unitIds: ['unit-a', 'unit-d'], candidateIds: ['candidate-a', 'candidate-d'], objectRefs: ['scene:wave6_alpha'], allowedResolutions: ['choose-unit', 'exclude-all', 'regenerate-candidate'], repairActions: ['检查对象'] }],
    dependencies: [],
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
    sourceIdentity: { ...projection.sourceIdentity, planFingerprint: 'plan-fp', integrationChangeId: 'change-1', workingRevision: 2, decisionReviewId: 'review_comparison_wave6', decisionId: 'decision-1', decisionFingerprint: 'decision-fp' },
    finalResult: {
      planId: 'plan-1', planFingerprint: 'plan-fp', integrationChangeId: 'change-1', workingRevision: 2, diffFingerprint: 'diff-fp',
      changedObjects: [object('scene:wave6_alpha')],
      evidence: { diffEvidenceId: 'diff-1', validationEvidenceId: 'validation-1', simulationEvidenceId: 'simulation-1', runtimeTraceIds: ['trace-1'] },
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
    decisionDraft: { decisionId: 'decision-1', selectedUnitIds: ['unit-a', 'unit-d'], conflictResolutions: [] },
    selectedReviewObjectRef: null,
    projectHandle: projection.kind === 'integration-result' ? {} as FileSystemDirectoryHandle : null,
    officialResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    currentResultTreeSha256: projection.finalResult?.resultTreeSha256 ?? null,
    fixtureChanged: false,
    receiptStatus: 'none',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Editor review panel', () => {
  it('renders human-first comparison text, technical details, and a resolved choice', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(textOf(container)).toContain('审阅任务');
    expect(textOf(container)).toContain('方案 A');
    expect(textOf(container)).toContain('2 个方案得到相同结果');
    expect(textOf(container)).toContain('需要你决定');
    expect(textOf(container)).not.toContain('OBJECT_RESULTS_DIVERGE');

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
    choiceForUnit!.click();
    expect(decisionButton?.disabled).toBe(false);
    expect(workspace.decisionDraft.conflictResolutions).toEqual([
      { conflictId: 'conflict-1', resolution: 'choose-unit', chosenUnitId: 'unit-a' },
    ]);
  });

  it('gates result approval when exploration changes the fixture and can reload the official result', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(false);
    markReviewFixtureChanged(workspace, 'changed-tree');
    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(true);
    expect(textOf(container)).toContain('你正在查看探索性修改');
    reloadOfficialResult(workspace);
    renderReviewPanel(container as unknown as HTMLElement, workspace);
    expect(container.querySelector('[data-action="approve-result"]')?.disabled).toBe(false);
  });

  it('keeps the fixed human labels visible for the review workbench', () => {
    expect(labelForObjectKind('scene')).toBe('场景');
    expect(labelForObjectKind('timeline')).toBe('时间轴');
    expect(labelForReviewState('STAGE_READY')).toBe('结果已准备，请检查');
    expect(labelForConflictSeverity('selection-required')).toBe('需要你决定');
  });
});
