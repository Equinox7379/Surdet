import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { reviewDecisionPreviewFingerprintOf } from '@surdet/authoring';
import type {
  FinalApprovalReceipt,
  HumanReviewProjection,
  HumanReviewProjectionV2,
  ReviewDecisionPreview,
  ReviewDecisionPreviewCommand,
  ReturnRequestReceipt,
  ReviewObjectSummary,
  ReviewTerminalCommand,
} from '@surdet/authoring';
import {
  labelForConflictSeverity,
  labelForObjectKind,
  labelForReviewState,
} from '../src/review-model.js';
import { openReviewPanelWorkspace, renderReviewPanel } from '../src/panels/review-panel.js';
import * as reviewWorkspaceModule from '../src/review-workspace.js';
import { state } from '../src/state.js';
import {
  markReviewFixtureChanged,
  reloadOfficialResult,
} from '../src/review-preview.js';
import type { ReviewWorkspaceState } from '../src/review-workspace.js';
import type { PreparedReviewContent } from '@surdet/authoring';
import { AssetImportClientError } from '../src/asset-import-client.js';
import { hashReviewFixtureTree, refreshReviewFixtureIdentity } from '../src/review-preview.js';
import { openListedReviewTask, reviewTaskDirectory, reviewTaskPreviewDirectory } from '../src/panels/review-tasks.js';

const reviewReads = vi.hoisted(() => ({ bound: true, files: new Map<string, PreparedReviewContent>() }));
vi.mock('../src/editor-workspace.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/editor-workspace.js')>(),
  editorReviewTaskClient: () => reviewReads.bound ? {
    tasks: async () => { throw new Error('unused'); },
    content: async ({ kind, path }: { kind: 'file' | 'directory'; path: string }) => {
      const value = reviewReads.files.get(`${kind}:${path}`);
      if (value === undefined) throw new AssetImportClientError('OBJECT_NOT_FOUND', '不存在');
      return structuredClone(value);
    },
  } : null,
}));

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
  onchange: (() => void) | null = null;
  checked = false;
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
    task: { title: '候选创作方案审阅', goal: '选出正确的 Alpha 剧情结果', acceptanceCriteria: ['看清冲突'], candidateCount: 3, objectCount: 1, conflictCount: 1, statementSource: 'generated-fallback' },
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

function wholeWorkspace(): ReviewWorkspaceState {
  const base = comparisonWorkspace().projection;
  const projection: HumanReviewProjectionV2 = {
    ...base, reviewVersion: '2.0.0', reviewFingerprint: 'e'.repeat(64), defaultSelectedUnitIds: [],
    sourceIdentity: { ...base.sourceIdentity, comparisonFingerprint: 'f'.repeat(64) },
    creativeBrief: { status: 'provided', source: 'review-preparation-input', request: '写一段分别通向两个结局的海边故事。', acceptanceCriteria: [] },
    candidates: base.candidates.filter((candidate) => candidate.candidateId !== 'candidate-d').map((candidate) => {
      const unit = base.conflicts[0]!.options.find((item) => item.candidateId === candidate.candidateId)!;
      const unique = { ...unit, unitId: `${unit.unitId}-unique`, primaryObject: `scene:${candidate.displayOrdinal}_end`, presentation: { actionLabel: '新建场景', objectLabel: `结局 ${candidate.displayOrdinal}`, highlights: [`这是方案 ${candidate.displayOrdinal} 独有的结局。`], completeness: 'content' as const, omittedFactCount: 0 } };
      return {
        ...candidate, claims: { source: 'candidate-change-intent' as const, statement: '候选自己的主张', acceptanceCriteria: [] },
        verifiedFacts: {
          source: { content: 'sealed-composition-manifest' as const, evidence: 'sealed-capsule-evidence' as const, runtime: 'sealed-runtime-trace' as const },
          units: [unit, unique], content: { changedObjects: [], choices: [], variables: [], timelines: [], assets: [], excerpts: [], omittedFactCount: 0,
            scenes: [{ sceneId: `${candidate.displayOrdinal}_end`, objectRef: unique.primaryObject, unitId: unique.unitId, action: 'create', operationSequence: 1, highlights: ['已经替换的旧结局。'] }],
            finalSceneStatus: 'verified' as const, finalSceneLimitations: [],
            finalScenes: [{ sceneId: `${candidate.displayOrdinal}_end`, producerUnitIds: [unique.unitId], source: 'sealed-current-object-diff' as const, paragraphs: unique.presentation.highlights }] },
          runtime: { status: 'verified' as const, paths: [{ traceId: `trace-${candidate.displayOrdinal}`, status: 'passed' as const, startSceneId: 'start', visitedSceneIds: ['start', `${candidate.displayOrdinal}_end`], choices: [{ sceneId: 'start', optionIndex: 0, label: `走向结局 ${candidate.displayOrdinal}` }], endingSceneId: `${candidate.displayOrdinal}_end`, finalVariables: [{ name: 'route', value: 1 }] }], limitations: [] },
        },
        adoptionPreset: { candidateId: candidate.candidateId, candidateRef: candidate.ref, status: 'available' as const, selectedUnitIds: [unit.unitId, unique.unitId],
          conflictResolutions: [{ conflictId: 'conflict-1', resolution: 'choose-unit' as const, chosenUnitId: unit.unitId, actor: 'human' as const }], reasons: [] },
      };
    }),
  };
  return workspaceFor(projection);
}

async function panelWholePreview(command: ReviewDecisionPreviewCommand): Promise<ReviewDecisionPreview> {
  const projection = wholeWorkspace().projection as HumanReviewProjectionV2;
  const intent = command.decisionIntent;
  const candidate = intent.mode === 'adopt-candidate' ? projection.candidates.find((item) => item.candidateId === intent.candidate.candidateId)! : undefined;
  const selectedUnitIds = candidate?.adoptionPreset.selectedUnitIds ?? command.customSelection!.selectedUnitIds;
  const preview: ReviewDecisionPreview = {
    previewVersion: '1.0.0', reviewId: command.reviewId, reviewFingerprint: projection.reviewFingerprint,
    comparisonFingerprint: projection.sourceIdentity.comparisonFingerprint, decisionIntent: intent, status: 'ready', selectedUnitIds,
    conflictResolutions: candidate?.adoptionPreset.conflictResolutions.map(({ conflictId, resolution, chosenUnitId }) => ({ conflictId, resolution, chosenUnitId })) ?? command.customSelection!.conflictResolutions,
    effectiveUnitIds: selectedUnitIds, implicitInclusions: [], excludedUnitIds: projection.candidates.flatMap((item) => item.adoptionPreset.selectedUnitIds).filter((id) => !selectedUnitIds.includes(id)),
    planContentFingerprint: '1'.repeat(64), dryRun: { status: 'passed', errors: [], finalObjectFingerprints: { 'scene:actual_end': '2'.repeat(64) } }, previewFingerprint: '',
  };
  preview.previewFingerprint = await reviewDecisionPreviewFingerprintOf(preview, { sha256: async (text) => createHash('sha256').update(text).digest('hex') });
  return preview;
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
      reviewVersion: projection.reviewVersion, reviewId: projection.reviewId, kind: projection.kind,
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
  it.each(['decision', 'approval', 'return'] as const)('owns the complete receipt operation and rejects overlapping calls: %s', async kind => {
    const workspace = kind === 'decision' ? comparisonWorkspace() : resultWorkspace();
    let reject!: (error: Error) => void;
    const gate = new Promise<never>((_, no) => { reject = no; });
    const write = vi.fn(async () => gate);
    const client = { status: async () => 'available' as const, describe: async () => { throw new Error('unused'); }, write };
    const now = '2026-10-05T00:00:00.000Z';
    const start = () => kind === 'decision'
      ? reviewWorkspaceModule.writeDecisionReceipt(workspace, { decisionId: 'operation-decision', selectedUnitIds: ['unit-a'],
        conflictResolutions: [{ conflictId: 'conflict-1', resolution: 'choose-unit', chosenUnitId: 'unit-a' }] }, now, client)
      : kind === 'approval' ? reviewWorkspaceModule.writeApprovalReceipt(workspace, { approvalId: 'operation-approval' }, now, client)
        : reviewWorkspaceModule.writeReturnReceipt(workspace, { returnId: 'operation-return', reasonCategory: 'content' }, now, client);
    const pending = start();
    const result = pending.catch(error => error);
    try {
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(true);
      expect(write).not.toHaveBeenCalled();
      await expect(start()).rejects.toMatchObject({ code: 'REVIEW_BUSY' });
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(true);
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      reject(Object.assign(new Error('controlled rejection'), { code: 'INVALID_REQUEST' }));
      expect(await result).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(false);
      expect(reviewWorkspaceModule.hasPendingReviewReceipt(workspace)).toBe(false);
    } finally { reject(Object.assign(new Error('cleanup'), { code: 'INVALID_REQUEST' })); await result; }
  });

  it('releases approval preparation ownership when the actual result directory cannot be read', async () => {
    const workspace = resultWorkspace();
    workspace.projectHandle = { kind: 'directory', name: 'unreadable', async *values() {
      yield { kind: 'file', name: 'scene.gal', getFile: async () => { throw new Error('read failed'); } };
    } } as unknown as FileSystemDirectoryHandle;
    const write = vi.fn(async () => { throw Object.assign(new Error('controlled rejection'), { code: 'INVALID_REQUEST' }); });
    const client = { status: async () => 'available' as const, describe: async () => { throw new Error('unused'); }, write };
    const start = () => reviewWorkspaceModule.writeApprovalReceipt(workspace, { approvalId: 'preparation-failure' }, '2026-10-05T00:00:00.000Z', client);
    const pending = start();
    expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
    expect(write).not.toHaveBeenCalled();
    expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(false);
    expect(reviewWorkspaceModule.hasPendingReviewReceipt(workspace)).toBe(false);
    workspace.projectHandle = null;
    await expect(start()).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(write).toHaveBeenCalledOnce();
  });

  it('keeps approval preparation protected while the actual result file is still being read', async () => {
    vi.stubGlobal('document', documentStub);
    const original = { reviewWorkspace: state.reviewWorkspace, mainTab: state.mainTab,
      selectedObjectRef: state.selectedObjectRef, previewChoices: state.previewChoices, dirName: state.dirName };
    const workspace = resultWorkspace(), replacement = resultWorkspace();
    // Fixed fixture facts from the independent reproduction; no separate digest computation.
    const identity = 'd9c320f4061eff0a7cb9244ac7bba1fcb12dbb30bc3eebfd6967368ae48c0b11';
    const bytes = new TextEncoder().encode('review result fixture: unchanged source contents\n');
    let releaseFile!: () => void, finishRead!: (value: ReviewWorkspaceState) => void;
    const fileReady = new Promise<void>(resolve => { releaseFile = resolve; });
    const loaded = new Promise<ReviewWorkspaceState>(resolve => { finishRead = resolve; });
    const getFile = vi.fn(async () => { await fileReady; return { arrayBuffer: async () => bytes.slice().buffer }; });
    workspace.projectHandle = { kind: 'directory', name: 'project', async *values() {
      yield { kind: 'file', name: 'scene.gal', getFile };
    } } as unknown as FileSystemDirectoryHandle;
    workspace.officialResultTreeSha256 = workspace.currentResultTreeSha256 = identity;
    workspace.projection.finalResult!.resultTreeSha256 = identity;
    let rejectReceipt!: (error: Error) => void;
    const receipt = new Promise<never>((_, reject) => { rejectReceipt = reject; });
    void receipt.catch(() => {});
    const write = vi.fn(async () => receipt);
    const client = { status: async () => 'available' as const, describe: async () => { throw new Error('unused'); }, write };
    const open = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace').mockReturnValue(loaded);
    vi.stubGlobal('window', { showDirectoryPicker: async () => ({}) });
    state.reviewWorkspace = workspace;
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { reviewTerminalClient: client });
    const opening = openReviewPanelWorkspace();
    let clicked = false;
    try {
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
      container.querySelector('[data-action="approve-result"]')!.click(); clicked = true;
      await vi.waitFor(() => expect(getFile).toHaveBeenCalledOnce());
      expect(write).not.toHaveBeenCalled();
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(true);
      expect(reviewWorkspaceModule.hasPendingReviewReceipt(workspace)).toBe(true);
      finishRead(replacement);
      await expect(opening).rejects.toThrow('审阅操作');
      expect(state.reviewWorkspace).toBe(workspace);
      releaseFile();
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      rejectReceipt(Object.assign(new Error('response lost'), { code: 'REQUEST_TIMEOUT' }));
      await vi.waitFor(() => expect(workspace.authority.state).toBe('unavailable'));
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(false);
      expect(reviewWorkspaceModule.hasPendingReviewReceipt(state.reviewWorkspace)).toBe(true);
      open.mockResolvedValue(resultWorkspace());
      await openReviewPanelWorkspace();
      expect(state.reviewWorkspace).not.toBe(workspace);
    } finally {
      finishRead(replacement); releaseFile(); await opening.catch(() => {});
      rejectReceipt(Object.assign(new Error('response lost'), { code: 'REQUEST_TIMEOUT' }));
      if (clicked) await vi.waitFor(() => expect(statusElement.textContent).toContain('批准失败'));
      open.mockRestore(); Object.assign(state, original);
    }
  });

  it('keeps the active review when its approval starts during another review read', async () => {
    vi.stubGlobal('document', documentStub);
    const original = { reviewWorkspace: state.reviewWorkspace, mainTab: state.mainTab,
      selectedObjectRef: state.selectedObjectRef, previewChoices: state.previewChoices, dirName: state.dirName };
    const workspace = resultWorkspace(), replacement = resultWorkspace();
    let readStarted!: () => void, finishRead!: (value: ReviewWorkspaceState) => void;
    const reading = new Promise<void>(resolve => { readStarted = resolve; });
    const loaded = new Promise<ReviewWorkspaceState>(resolve => { finishRead = resolve; });
    let entered!: () => void, rejectReceipt!: (error: Error) => void;
    const submitting = new Promise<void>(resolve => { entered = resolve; });
    const receipt = new Promise<never>((_, reject) => { rejectReceipt = reject; });
    const client = { status: async () => 'available' as const, describe: async () => { throw new Error('unused'); },
      write: async () => { entered(); return receipt; } };
    const open = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace').mockImplementation(async () => { readStarted(); return loaded; });
    vi.stubGlobal('window', { showDirectoryPicker: async () => ({}) });
    state.reviewWorkspace = workspace;
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { reviewTerminalClient: client });
    const opening = openReviewPanelWorkspace();
    try {
      await reading;
      container.querySelector('[data-action="approve-result"]')!.click();
      await submitting;
      expect(workspace.authority.state).toBe('submitting');
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(true);
      finishRead(replacement);
      await expect(opening).rejects.toThrow('审阅操作');
      expect(state.reviewWorkspace).toBe(workspace);
      expect(reviewWorkspaceModule.hasPendingReviewReceipt(workspace)).toBe(true);
    } finally {
      finishRead(replacement); await opening.catch(() => {});
      rejectReceipt(Object.assign(new Error('controlled rejection'), { code: 'INVALID_REQUEST' }));
      await vi.waitFor(() => expect(workspace.authority.state).not.toBe('submitting'));
      expect(reviewWorkspaceModule.isReviewReceiptWriting()).toBe(false);
      open.mockRestore(); Object.assign(state, original);
    }
  });

  it.each(['REQUEST_TIMEOUT', 'INVALID_REQUEST'])('permits explicit review rereading after settled transport: %s', async code => {
    const original = { reviewWorkspace: state.reviewWorkspace, mainTab: state.mainTab,
      selectedObjectRef: state.selectedObjectRef, previewChoices: state.previewChoices, dirName: state.dirName };
    const workspace = resultWorkspace(), reread = resultWorkspace();
    const open = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace').mockResolvedValue(reread);
    vi.stubGlobal('window', { showDirectoryPicker: async () => ({}) });
    try {
      state.reviewWorkspace = workspace;
      await expect(reviewWorkspaceModule.writeApprovalReceipt(workspace, { approvalId: 'retry-read' }, '2026-10-05T00:00:00.000Z', {
        status: async () => 'available', describe: async () => { throw new Error('unused'); },
        write: async () => { throw Object.assign(new Error('controlled transport result'), { code }); },
      })).rejects.toMatchObject({ code });
      expect(reviewWorkspaceModule.hasPendingReviewReceipt(workspace)).toBe(code === 'REQUEST_TIMEOUT');
      await openReviewPanelWorkspace();
      expect(open).toHaveBeenCalledOnce();
      expect(state.reviewWorkspace).toBe(reread);
    } finally { open.mockRestore(); Object.assign(state, original); }
  });

  it('preserves an uncertain receipt when a different review or an unavailable reread would replace it', async () => {
    const original = state.reviewWorkspace;
    const workspace = resultWorkspace(), replacement = resultWorkspace();
    replacement.identity.reviewId = 'other-review';
    const open = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace').mockResolvedValue(replacement);
    vi.stubGlobal('window', { showDirectoryPicker: async () => ({}) });
    try {
      state.reviewWorkspace = workspace;
      await expect(reviewWorkspaceModule.writeApprovalReceipt(workspace, { approvalId: 'uncertain' }, '2026-10-05T00:00:00.000Z', {
        status: async () => 'available', describe: async () => { throw new Error('unused'); },
        write: async () => { throw Object.assign(new Error('response lost'), { code: 'REQUEST_TIMEOUT' }); },
      })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      await expect(openReviewPanelWorkspace()).rejects.toThrow('同一审阅');
      expect(state.reviewWorkspace).toBe(workspace);
      replacement.identity.reviewId = workspace.identity.reviewId;
      replacement.authority.state = 'unavailable';
      await expect(openReviewPanelWorkspace()).rejects.toThrow('核对状态');
      expect(state.reviewWorkspace).toBe(workspace);
    } finally { open.mockRestore(); state.reviewWorkspace = original; }
  });

  it('keeps the bound project name while opening review and labels unbound review sessions', async () => {
    const original = {
      dirName: state.dirName,
      dirHandle: state.dirHandle,
      reviewWorkspace: state.reviewWorkspace,
      mainTab: state.mainTab,
      selectedObjectRef: state.selectedObjectRef,
      previewChoices: state.previewChoices,
    };
    const workspace = comparisonWorkspace();
    const root = {} as FileSystemDirectoryHandle;
    const openWorkspace = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace').mockResolvedValue(workspace);
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn(async () => root) });
    try {
      state.dirName = '真实项目';
      state.dirHandle = root;
      await openReviewPanelWorkspace();
      expect(state.dirName).toBe('真实项目');
      expect(state.dirHandle).toBe(root);
      expect(state.reviewWorkspace).toBe(workspace);

      state.dirName = '';
      state.dirHandle = null;
      await openReviewPanelWorkspace();
      expect(state.dirName).toBe(`审阅：${workspace.projection.task.title}`);
      expect(state.dirHandle).toBeNull();
    } finally {
      openWorkspace.mockRestore();
      state.dirName = original.dirName;
      state.dirHandle = original.dirHandle;
      state.reviewWorkspace = original.reviewWorkspace;
      state.mainTab = original.mainTab;
      state.selectedObjectRef = original.selectedObjectRef;
      state.previewChoices = original.previewChoices;
    }
  });

  it('shows separate sources and complete unique content, then previews every whole or mix selection', async () => {
    vi.stubGlobal('document', documentStub);
    const workspace = wholeWorkspace();
    const previewDecision = vi.fn(panelWholePreview);
    const client = { previewDecision, status: async () => 'available' as const, describe: async () => { throw new Error('unused'); }, write: async () => { throw new Error('unused'); } };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { reviewTerminalClient: client });
    expect(textOf(container)).toContain('原始创作要求');
    expect(textOf(container)).toContain('候选自述');
    expect(textOf(container)).toContain('系统核对到的最终正文');
    expect(textOf(container)).toContain('与候选最终工作版本一致的封存差异');
    expect(textOf(container)).toContain('这是方案 A 独有的结局。');
    expect(textOf(container)).not.toContain('已经替换的旧结局。');
    expect(textOf(container)).toContain('走向结局 C');
    expect(textOf(container)).not.toContain('review-fp');
    expect(textOf(container)).not.toContain('unit-a');
    expect(workspace.decisionDraft.selectedUnitIds).toEqual([]);
    expect(container.querySelector('[data-action="save-decision"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-mix-unit]')).toBeNull();
    container.querySelector('[data-adopt-candidate="candidate-a"]')!.click();
    expect(container.querySelector('[data-action="save-decision"]')?.disabled).toBe(true);
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    expect(workspace.decisionDraft.selectedUnitIds).toEqual(['unit-a', 'unit-a-unique']);
    expect(container.querySelector('[data-action="save-decision"]')?.disabled).toBe(false);
    expect(textOf(container)).toContain('场景 actual_end');

    container.querySelector('[data-proposal-switch="candidate-c"]')!.click();
    expect(container.querySelector('[data-proposal="candidate-c"]')?.getAttribute('data-proposal-visible')).toBe('true');
    expect(workspace.decisionDraft.decisionIntent).toMatchObject({ mode: 'adopt-candidate', candidate: { candidateId: 'candidate-a' } });
    container.querySelector('[data-action="custom-mix"]')!.click();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    container.querySelector('[data-mix-base="candidate-c"]')!.click();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    expect(workspace.decisionDraft.selectedUnitIds).toEqual(['unit-c', 'unit-c-unique']);
    const check = container.querySelector('[data-mix-unit="unit-c-unique"]')!;
    check.checked = false; check.onchange!();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    expect(previewDecision.mock.calls.at(-1)?.[0]).toMatchObject({ decisionIntent: { mode: 'custom-mix', baseCandidate: { candidateId: 'candidate-c' } }, customSelection: { selectedUnitIds: ['unit-c'] } });
    container.querySelector('[data-mix-base="none"]')!.click();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    expect(workspace.decisionDraft.decisionIntent).toEqual({ mode: 'custom-mix' });
    expect(workspace.decisionDraft.selectedUnitIds).toEqual([]);
    expect(workspace.decisionDraft.conflictResolutions).toEqual([{ conflictId: 'conflict-1', resolution: 'exclude-all' }]);
    expect(previewDecision).toHaveBeenCalledTimes(5);
  });

  it('explains unavailable final text while retaining sealed operations, and shows secondary scene text without a primary scene unit', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = wholeWorkspace();
    const projection = workspace.projection as HumanReviewProjectionV2;
    const stale = projection.candidates[0]!.verifiedFacts;
    stale.content.finalSceneStatus = 'unavailable';
    stale.content.finalSceneLimitations = ['当前胶囊没有与最终工作版本一致的完整正文差异。'];
    stale.content.finalScenes = [];
    const secondary = projection.candidates[1]!.verifiedFacts;
    const unit = secondary.units[0]!;
    unit.primaryObject = 'character:rin';
    unit.outcomes = [{ objectRef: 'scene:secondary', disposition: 'update' }];
    unit.presentation = { actionLabel: '新建或更新角色', objectLabel: '角色 凛', highlights: ['显示名：小凛'], completeness: 'content', omittedFactCount: 0 };
    secondary.units = [unit];
    secondary.content.scenes = [];
    secondary.content.changedObjects = [{ objectRef: 'scene:secondary', disposition: 'update', unitId: unit.unitId }];
    secondary.content.finalScenes = [{ sceneId: 'secondary', producerUnitIds: [unit.unitId], source: 'sealed-current-object-diff', paragraphs: ['小凛：迁移后的正文。'] }];
    const container = new FakeElement('div'); renderReviewPanel(container as unknown as HTMLElement, workspace);
    const staleCard = container.querySelector('[data-proposal="candidate-a"]')!;
    expect(textOf(staleCard)).toContain('完整正文暂不可核对');
    expect(textOf(staleCard)).toContain('当前胶囊没有与最终工作版本一致的完整正文差异');
    expect(textOf(staleCard)).toContain('下面只展示封存操作与运行事实');
    expect(textOf(staleCard)).not.toContain('这是方案 A 独有的结局。');
    const history = staleCard.children.find((element) => element.className === 'review-story-scene')!.children.find((element) => element.className === 'review-story-history')!;
    history.open = true;
    expect(textOf(staleCard)).toContain('已经替换的旧结局。');
    expect(textOf(staleCard)).toContain('走向结局 A');
    expect(container.querySelector('[data-adopt-candidate="candidate-a"]')!.disabled).toBe(false);
    const secondaryCard = container.querySelector('[data-proposal="candidate-c"]')!;
    expect(textOf(secondaryCard)).toContain('1 个场景');
    expect(textOf(secondaryCard)).toContain('小凛：迁移后的正文。');
    expect(textOf(secondaryCard)).not.toContain('此方案没有场景文本改动');
  });

  it('puts actual decision, execution changes and runtime before the v2 approval and folded technical evidence', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const original = workspace.projection;
    const result = original.finalResult!;
    workspace.projection = {
      ...original, reviewVersion: '2.0.0', candidates: [], defaultSelectedUnitIds: [],
      creativeBrief: { status: 'not-provided', source: 'review-preparation-input', acceptanceCriteria: [] },
      finalResult: { ...result, actualExplanation: {
        source: 'integration-result', decisionIntent: { mode: 'adopt-candidate', candidate: { candidateId: 'candidate-a', ref: result.plan.sourceCandidates[0]!.ref } },
        decisionFingerprint: 'decision-fp', planId: result.planId, planFingerprint: result.planFingerprint,
        integrationChangeId: result.integrationChangeId, workingRevision: result.workingRevision, runtimeTraceIds: result.evidence.runtimeTraceIds,
        selectedSources: [], actualIncluded: [{ kind: 'included-unit', label: 'technical-unit-name', objectRef: 'scene:actual_story' }],
        actualDependencies: [{ kind: 'automatic-dependency', label: 'dependency', objectRef: 'timeline:actual_performance' }],
        actualExcluded: [{ kind: 'excluded-candidate', label: '方案 D 未纳入' }],
        actualChanges: [{ kind: 'changed-object', label: 'change', objectRef: 'scene:actual_story' }],
        actualRuntimeOutcomes: [{ traceId: 'trace-1', status: 'passed', startSceneId: 'actual_story', visitedSceneIds: ['actual_story', 'actual_ending'], choices: [{ sceneId: 'actual_story', optionIndex: 0, label: '实际结果中的选择' }], endingSceneId: 'actual_ending', finalVariables: [{ name: 'route', value: 2 }] }],
        warnings: [], explanationFingerprint: 'explanation-fp',
      } },
    };
    const container = new FakeElement('div'); renderReviewPanel(container as unknown as HTMLElement, workspace);
    const main = container.querySelector('[data-review-main="result"]')!;
    const sections = ['actual-decision', 'actual-included', 'actual-dependencies', 'actual-excluded', 'actual-changes', 'result-preview', 'result-evidence', 'result-actions', 'technical'];
    const order = sections.map((name) => main.children.indexOf(main.querySelector(`[data-review-section="${name}"]`)!));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(textOf(container)).toContain('采用整个方案 A');
    expect(textOf(container)).toContain('场景 actual_story');
    expect(textOf(container)).toContain('实际结果中的选择');
    expect(textOf(container)).toContain('route = 2');
    expect(textOf(container)).not.toContain('technical-unit-name');
    expect(textOf(container)).not.toContain('plan-fp');
    expect(textOf(container)).not.toContain('+Alpha A');
    expect(container.querySelector('[data-action="approve-result"]')?.textContent).toBe('批准这个结果');
  });
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
    expect(textOf(container)).toContain('候选方案校对');
    expect(textOf(container)).toContain('候选创作方案审阅');
    expect(textOf(container)).toContain('方案 A（本次审阅编号）');
    expect(textOf(container)).toContain('方案字母只用于本次审阅排序');
    expect(textOf(container)).toContain('2 个方案得到相同结果');
    expect(textOf(container)).toContain('场景 wave6_alpha');
    expect(textOf(container)).toContain('自动纳入');
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
    const projectionBeforeChoice = JSON.stringify(workspace.projection);
    choiceForUnit!.click();
    expect(choiceForUnit!.disabled).toBe(true);
    expect(choiceForUnit!.getAttribute('aria-pressed')).toBe('false');
    expect(textOf(container)).toContain('旧版只读审阅');
    expect(container.querySelector('[data-choice-unit="unit-d"]')!.getAttribute('aria-pressed')).toBe('false');
    const safeToggle = container.querySelector('[data-safe-group-toggle="group-1"]')!;
    expect(safeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(safeToggle.textContent).toBe('排除本组');
    expect(JSON.stringify(workspace.projection)).toBe(projectionBeforeChoice);
    expect(decisionButton?.disabled).toBe(true);
    expect(workspace.decisionDraft.conflictResolutions).toEqual([]);
  });

  it('keeps both historical conflict choices unchanged in a readonly review', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const firstConflict = workspace.projection.conflicts[0]!;
    workspace.projection.conflicts.push({
      ...firstConflict,
      conflictId: 'conflict-2',
      objectRefs: ['scene:wave6_beta'],
    });
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    const first = container.querySelector('[data-conflict-id="conflict-1"]')!;
    const second = container.querySelector('[data-conflict-id="conflict-2"]')!;
    const firstChoice = first.querySelector('[data-choice-unit="unit-a"]')!;
    const secondChoice = second.querySelector('[data-choice-unit="unit-a"]')!;

    firstChoice.click();

    expect(firstChoice.getAttribute('aria-pressed')).toBe('false');
    expect(firstChoice.disabled).toBe(true);
    expect(secondChoice.getAttribute('aria-pressed')).toBe('false');
    expect(secondChoice.textContent).not.toContain('已选择');
  });

  it('orders pending decisions before safe results and keeps the save action in that decision flow', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);

    const main = container.querySelector('[data-review-main]')!;
    const decisions = main.querySelector('[data-review-section="decisions"]')!;
    const actions = main.querySelector('[data-review-section="decision-actions"]')!;
    const safe = main.querySelector('[data-review-section="safe-results"]')!;
    const technical = main.querySelector('[data-review-section="technical"]')!;
    expect(main.children.indexOf(decisions)).toBeLessThan(main.children.indexOf(actions));
    expect(main.children.indexOf(actions)).toBeLessThan(main.children.indexOf(safe));
    expect(main.children.indexOf(safe)).toBeLessThan(main.children.indexOf(technical));
    expect(textOf(container)).toContain('选出正确的 Alpha 剧情结果');
    expect(textOf(container)).toContain('还需决定 1 项');
  });

  it('preserves a historical safe group without allowing new exclusions', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = comparisonWorkspace();
    const projectionBeforeToggle = JSON.stringify(workspace.projection);
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);
    const toggle = container.querySelector('[data-safe-group-toggle="group-1"]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('排除本组');

    toggle.click();
    expect(toggle.disabled).toBe(true);
    expect(workspace.decisionDraft.selectedUnitIds).toEqual(expect.arrayContaining(['unit-a', 'unit-d']));

    toggle.click();
    expect(workspace.decisionDraft.selectedUnitIds).toEqual(expect.arrayContaining(['unit-a', 'unit-d']));
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('排除本组');
    expect(JSON.stringify(workspace.projection)).toBe(projectionBeforeToggle);
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
    const workspace = wholeWorkspace();
    const terminalClient = {
      previewDecision: panelWholePreview,
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write: vi.fn(async (_command: ReviewTerminalCommand) => {
        throw Object.assign(new Error('forced authority write failure'), { code: 'REVIEW_BUSY' });
      }),
    };
    const container = new FakeElement('div');
    const options = { now: () => '2026-08-29T00:00:00.000Z', reviewTerminalClient: terminalClient };
    renderReviewPanel(container as unknown as HTMLElement, workspace, options);

    container.querySelector('[data-adopt-candidate="candidate-a"]')!.click();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    const save = container.querySelector('[data-action="save-decision"]')!;
    save.click();
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    const firstDecisionId = workspace.decisionDraft.decisionId;
    expect(firstDecisionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    statusElement.textContent = '';
    container.querySelector('[data-action="save-decision"]')!.click();
    expect(workspace.decisionDraft.decisionId).toBe(firstDecisionId);
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    const lockedChoice = container.querySelector('[data-adopt-candidate="candidate-c"]')!;
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
    const workspace = wholeWorkspace();
    const terminalClient = {
      previewDecision: panelWholePreview,
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write: async () => { throw new Error('ENGLISH_SECRET_DETAIL'); },
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { reviewTerminalClient: terminalClient });
    container.querySelector('[data-adopt-candidate="candidate-a"]')!.click();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    container.querySelector('[data-action="save-decision"]')!.click();
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    expect(statusElement.textContent).not.toContain('ENGLISH_SECRET_DETAIL');
    expect(statusElement.textContent).toContain('操作未完成');
  });

  it('freezes every decision control while a receipt write is pending', async () => {
    vi.stubGlobal('document', documentStub);
    const workspace = wholeWorkspace();
    let rejectWrite: ((error: Error) => void) | null = null;
    const write = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectWrite = reject;
    }));
    const terminalClient = {
      previewDecision: panelWholePreview,
      status: async () => 'available' as const,
      describe: async () => { throw new Error('not used'); },
      write,
    };
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, {
      now: () => '2026-08-29T00:00:00.000Z',
      reviewTerminalClient: terminalClient,
    });

    const choiceA = container.querySelector('[data-adopt-candidate="candidate-a"]')!;
    choiceA.click();
    await vi.waitFor(() => expect(workspace.decisionPreview?.status).toBe('ready'));
    const selectedBeforeSave = [...workspace.decisionDraft.selectedUnitIds];
    const resolutionsBeforeSave = workspace.decisionDraft.conflictResolutions.map((resolution) => ({ ...resolution }));
    const save = container.querySelector('[data-action="save-decision"]')!;
    save.click();
    save.click();
    const sealedDecisionId = workspace.decisionDraft.decisionId;

    const decisionControls = container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-adopt-candidate') !== null
      || button.getAttribute('data-action') === 'custom-mix'
      || button.getAttribute('data-action') === 'preview-decision'
      || button.getAttribute('data-action') === 'save-decision'
    ));
    for (const control of decisionControls) expect(control.disabled).toBe(true);
    container.querySelector('[data-adopt-candidate="candidate-c"]')!.click();
    expect(workspace.decisionDraft).toEqual({
      decisionId: sealedDecisionId,
      decisionIntent: { mode: 'adopt-candidate', candidate: { candidateId: 'candidate-a', ref: workspace.projection.candidates[0]!.ref } },
      selectedUnitIds: selectedBeforeSave,
      conflictResolutions: resolutionsBeforeSave,
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    rejectWrite!(Object.assign(new Error('release pending receipt write'), { code: 'REVIEW_BUSY' }));
    await vi.waitFor(() => expect(statusElement.textContent).toContain('保存决定失败'));
    for (const control of container.querySelectorAll('button').filter((button) => (
      button.getAttribute('data-adopt-candidate') !== null
      || button.getAttribute('data-action') === 'custom-mix'
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
    expect(container.querySelector('[data-action="approve-result"]')?.textContent).toContain('再次确认批准状态');
    expect(container.querySelector('[data-action="return-result"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-action="preview-result"]')?.disabled).toBe(true);
    expect(textOf(container.querySelector('[data-review-section="overview"]')!)).toContain('结果暂不能批准');
    expect(textOf(container.querySelector('[data-review-section="overview"]')!)).toContain('上一次批准结果尚未确认');
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

  it('re-enables result actions on the live page when the page was redrawn while a check ran', async () => {
    const live = new FakeElement('section');
    vi.stubGlobal('document', { ...documentStub, getElementById: (id: string) => id === 'review-view' ? live : id === 'status' ? statusElement : null });
    const original = state.reviewWorkspace;
    const workspace = resultWorkspace();
    state.reviewWorkspace = workspace;
    try {
      let finish!: () => void;
      const options = { onRefreshFixtureIdentity: () => new Promise<void>(resolve => { finish = resolve; }) };
      const started = new FakeElement('section');
      Object.assign(started, { isConnected: true });
      renderReviewPanel(started as unknown as HTMLElement, workspace, options);
      started.querySelector('[data-action="refresh-result-tree"]')!.click();
      // The page is drawn again while the check runs (as after returning to the source project).
      Object.assign(started, { isConnected: false });
      Object.assign(live, { isConnected: true });
      renderReviewPanel(live as unknown as HTMLElement, workspace, options);
      expect(live.querySelector('[data-action="approve-result"]')?.disabled).toBe(true);
      finish();
      await vi.waitFor(() => expect(live.querySelector('[data-action="refresh-result-tree"]')?.disabled).toBe(false));
      expect(live.querySelector('[data-action="preview-result"]')?.disabled).toBe(false);
    } finally {
      state.reviewWorkspace = original;
    }
  });

  it('requires confirmation before replacing an explored result copy and retains it on cancel', async () => {
    vi.stubGlobal('document', documentStub);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });
    const workspace = resultWorkspace();
    workspace.projectHandle = {} as FileSystemDirectoryHandle;
    workspace.fixtureChanged = true;
    const restore = vi.fn(async () => undefined);
    const container = new FakeElement('div');
    renderReviewPanel(container as unknown as HTMLElement, workspace, { onReloadOfficialResult: restore });
    const button = container.querySelector('[data-action="reload-official-result"]')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
    expect(workspace.fixtureChanged).toBe(true);
    confirm.mockReturnValue(true);
    button.click();
    await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
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
    const technical = container.querySelector('[data-review-section="technical"]')!;
    technical.open = true;
    expect(textOf(container)).toContain('明确选择：unit-a');
    expect(textOf(container)).toContain('实际纳入：unit-a、unit-b-timeline');
    expect(textOf(container)).toContain('自动纳入：unit-b-timeline');
    expect(textOf(container)).toContain('明确排除：unit-c');
    expect(textOf(container)).toContain('去重保留：unit-a；来源 unit-a、unit-d');
    expect(textOf(container)).toContain('方案 A');
    expect(textOf(container)).toContain('方案 D');
    expect(textOf(container)).toContain('最终对象指纹');
    expect(textOf(container)).toContain('content/scenario/wave6_alpha.gal');
    expect(textOf(container)).toContain('证据新鲜度：差异 新鲜；校验 新鲜；模拟 新鲜；运行 新鲜');
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

  it('puts result readiness, preview, and terminal actions before folded technical evidence', () => {
    vi.stubGlobal('document', documentStub);
    const workspace = resultWorkspace();
    const container = new FakeElement('div');

    renderReviewPanel(container as unknown as HTMLElement, workspace);

    const main = container.querySelector('[data-review-main]')!;
    const overview = main.querySelector('[data-review-section="overview"]')!;
    const preview = main.querySelector('[data-review-section="result-preview"]')!;
    const actions = main.querySelector('[data-review-section="result-actions"]')!;
    const summary = main.querySelector('[data-review-section="result-summary"]')!;
    const evidence = main.querySelector('[data-review-section="result-evidence"]')!;
    const technical = main.querySelector('[data-review-section="technical"]')!;
    expect(main.children.indexOf(overview)).toBeLessThan(main.children.indexOf(preview));
    expect(main.children.indexOf(preview)).toBeLessThan(main.children.indexOf(actions));
    expect(main.children.indexOf(actions)).toBeLessThan(main.children.indexOf(summary));
    expect(main.children.indexOf(summary)).toBeLessThan(main.children.indexOf(evidence));
    expect(main.children.indexOf(evidence)).toBeLessThan(main.children.indexOf(technical));
    expect(textOf(overview)).toContain('结果可以批准');
    expect(textOf(preview)).toContain('预览正式结果');
    expect(textOf(technical)).toBe('查看执行与技术详情');
    technical.open = true;
    expect(textOf(technical)).toContain('计划指纹：plan-fp');
    expect(textOf(technical)).toContain('content/scenario/wave6_alpha.gal');
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
    expect(textOf(marker!)).not.toContain('回执标识：approval-reopened');
    const receiptTechnical = marker!.querySelector('[data-result-receipt-technical]')!;
    receiptTechnical.open = true;
    expect(textOf(marker!)).toContain('回执标识：approval-reopened');
    expect(textOf(marker!)).toContain(`回执指纹：${'a'.repeat(64)}`);
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
    expect(textOf(marker!)).not.toContain('回执标识：return-reopened');
    const receiptTechnical = marker!.querySelector('[data-result-receipt-technical]')!;
    receiptTechnical.open = true;
    expect(textOf(marker!)).toContain('回执标识：return-reopened');
    expect(textOf(marker!)).toContain(`回执指纹：${'b'.repeat(64)}`);
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

describe('late result preview callbacks', () => {
  it.each(['success', 'failure'] as const)('does not redraw an old review after a switched task and %s', async outcome => {
    const old = state.reviewWorkspace;
    const current = resultWorkspace(), replacement = resultWorkspace();
    replacement.projection.task.title = 'New current review';
    replacement.identity.reviewId = replacement.projection.reviewId = 'replacement';
    const live = new FakeElement('section');
    vi.stubGlobal('document', { ...documentStub, getElementById: (id: string) => id === 'review-view' ? live : id === 'status' ? statusElement : null });
    let finish!: () => void, fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    state.reviewWorkspace = current;
    renderReviewPanel(live as unknown as HTMLElement, current, { onPreview: () => pending });
    live.querySelector('[data-action="preview-result"]')!.click();
    const read = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace').mockResolvedValue(replacement);
    try {
      await openListedReviewTask(async () => ({} as FileSystemDirectoryHandle), () => true);
      renderReviewPanel(live as unknown as HTMLElement, replacement);
      if (outcome === 'success') finish(); else fail(new Error('late failure'));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      expect(state.reviewWorkspace).toBe(replacement);
      expect(textOf(live)).toContain('New current review');
      expect(statusElement.textContent).not.toContain('late failure');
    } finally { finish(); read.mockRestore(); state.reviewWorkspace = old; }
  });

  it.each(['success', 'failure'] as const)('releases the same review preview after %s', async outcome => {
    const old = state.reviewWorkspace, workspace = resultWorkspace();
    const live = new FakeElement('section');
    vi.stubGlobal('document', { ...documentStub, getElementById: (id: string) => id === 'review-view' ? live : id === 'status' ? statusElement : null });
    let finish!: () => void, fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    state.reviewWorkspace = workspace;
    renderReviewPanel(live as unknown as HTMLElement, workspace, { onPreview: () => pending });
    live.querySelector('[data-action="preview-result"]')!.click();
    try {
      expect(live.querySelector('[data-action="preview-result"]')?.disabled).toBe(true);
      if (outcome === 'success') finish(); else fail(new Error('current failure'));
      await vi.waitFor(() => expect(live.querySelector('[data-action="preview-result"]')?.disabled).toBe(false));
      expect(state.reviewWorkspace).toBe(workspace);
      if (outcome === 'failure') expect(statusElement.textContent).toContain('current failure');
    } finally { finish(); state.reviewWorkspace = old; }
  });
});

describe('review tasks opened from the current-project list', () => {
  const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const listedResult = async () => {
    reviewReads.bound = true;
    reviewReads.files = new Map<string, PreparedReviewContent>([
      ['directory:', { kind: 'directory', entries: [{ name: 'result', kind: 'directory' }] }],
      ['directory:result', { kind: 'directory', entries: [{ name: 'project', kind: 'directory' }] }],
      ['directory:result/project', { kind: 'directory', entries: [{ name: 'scene.gal', kind: 'file' }] }],
      ['file:result/project/scene.gal', { kind: 'file', base64: base64('原来的台词。\n') }],
    ]);
    const workspace = resultWorkspace();
    workspace.rootHandle = reviewTaskDirectory({} as FileSystemDirectoryHandle, 'project-1', workspace.identity.reviewId);
    workspace.projectHandle = await (await workspace.rootHandle.getDirectoryHandle('result')).getDirectoryHandle('project');
    const official = await hashReviewFixtureTree(workspace.projectHandle);
    workspace.officialResultTreeSha256 = workspace.currentResultTreeSha256 = official;
    workspace.projection.finalResult!.resultTreeSha256 = official;
    // What a preview shows: a copy read while the source was still bound.
    const copy = reviewTaskPreviewDirectory(workspace)!;
    expect(await hashReviewFixtureTree(copy)).toBe(official);
    const write = vi.fn(async () => { throw new Error('no approval may be written'); });
    const client = { status: async () => 'available' as const, describe: async () => { throw new Error('unused'); }, write };
    return { workspace, official, copy, write, client };
  };

  it('re-reads a result changed on disk after its preview and writes no approval receipt', async () => {
    const { workspace, official, copy, write, client } = await listedResult();
    reviewReads.files.set('file:result/project/scene.gal', { kind: 'file', base64: base64('这份正式结果已在磁盘被改动，必须重新核对。\n') });
    await expect(reviewWorkspaceModule.writeApprovalReceipt(workspace, { approvalId: 'after-disk-change' }, '2026-10-08T00:00:00.000Z', client))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
    expect(write).not.toHaveBeenCalled();
    expect(workspace.fixtureChanged).toBe(true);
    await refreshReviewFixtureIdentity(workspace); // "检查探索修改" sees the change as well.
    expect(workspace.fixtureChanged).toBe(true);
    expect(workspace.currentResultTreeSha256).not.toBe(official);
    expect(await hashReviewFixtureTree(copy)).toBe(official); // The preview copy is never consulted.
  });

  it('refuses approval while the formal result cannot be read instead of trusting the preview copy', async () => {
    const { workspace, copy, official, write, client } = await listedResult();
    reviewReads.bound = false; // The result preview closed the source binding.
    expect(await hashReviewFixtureTree(copy)).toBe(official);
    await expect(reviewWorkspaceModule.writeApprovalReceipt(workspace, { approvalId: 'source-closed' }, '2026-10-08T00:00:00.000Z', client))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
    await expect(refreshReviewFixtureIdentity(workspace)).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(write).not.toHaveBeenCalled();
  });

  it('asks again before switching when the current decision changed while the next task was being read', async () => {
    const original = { reviewWorkspace: state.reviewWorkspace, mainTab: state.mainTab, selectedObjectRef: state.selectedObjectRef,
      previewChoices: state.previewChoices, dirName: state.dirName };
    const gates: Array<(value: ReviewWorkspaceState) => void> = [];
    const open = vi.spyOn(reviewWorkspaceModule, 'openReviewWorkspace')
      .mockImplementation(() => new Promise<ReviewWorkspaceState>(resolve => { gates.push(resolve); }));
    const confirm = vi.fn((_message: string) => false);
    const directory = async () => ({} as FileSystemDirectoryHandle);
    try {
      const current = comparisonWorkspace();
      state.reviewWorkspace = current;
      // Clean when clicked, then a decision is chosen while the result is still being read.
      let opening = openListedReviewTask(directory, confirm);
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      expect(confirm).not.toHaveBeenCalled();
      current.decisionDraft = { ...current.decisionDraft, selectedUnitIds: ['unit-a'] };
      gates[0]!(resultWorkspace());
      expect(await opening).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm.mock.calls[0]![0]).toContain('读取期间');
      expect(state.reviewWorkspace).toBe(current);
      expect(current.decisionDraft.selectedUnitIds).toEqual(['unit-a']);

      // A draft confirmed at the click and left as it was is not asked about twice.
      confirm.mockClear().mockReturnValue(true);
      opening = openListedReviewTask(directory, confirm);
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
      expect(confirm).toHaveBeenCalledOnce();
      const next = resultWorkspace();
      gates[1]!(next);
      expect(await opening).toBe(true);
      expect(confirm).toHaveBeenCalledOnce();
      expect(state.reviewWorkspace).toBe(next);

      // Confirmed at the click, then changed again while reading: asked again, and declining keeps it.
      const edited = comparisonWorkspace();
      edited.decisionDraft = { ...edited.decisionDraft, selectedUnitIds: ['unit-d'] };
      state.reviewWorkspace = edited;
      confirm.mockClear().mockReturnValueOnce(true).mockReturnValueOnce(false);
      opening = openListedReviewTask(directory, confirm);
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(3));
      edited.decisionDraft = { ...edited.decisionDraft, selectedUnitIds: ['unit-a'] };
      gates[2]!(resultWorkspace());
      expect(await opening).toBe(false);
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(state.reviewWorkspace).toBe(edited);
      expect(edited.decisionDraft.selectedUnitIds).toEqual(['unit-a']);
    } finally {
      open.mockRestore();
      Object.assign(state, original);
    }
  });
});
