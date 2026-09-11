import { describe, expect, it } from 'vitest';
import type { HumanReviewProjectionV1, ReviewUnitOutcome } from '@surdet/authoring';
import {
  canSealDecision,
  labelForConflictSeverity,
  labelForObjectKind,
  labelForReviewState,
  labelForUnknownCode,
  presentationForReviewUnit,
} from '../src/review-model.js';

function baseProjection(overrides: Partial<HumanReviewProjectionV1> = {}): HumanReviewProjectionV1 {
  return {
    reviewVersion: '1.0.0',
    reviewId: 'review-1',
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    projectIdentity: 'project-1',
    expectedProjectRevision: 'revision-1',
    task: { title: '任务', acceptanceCriteria: [], candidateCount: 2, objectCount: 1, conflictCount: 0, statementSource: 'generated-fallback' },
    candidates: [],
    safeGroups: [],
    defaultSelectedUnitIds: [],
    conflicts: [],
    dependencies: [],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
    objects: [],
    sourceIdentity: { projectIdentity: 'project-1', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'fp' },
    reviewFingerprint: 'review-fp',
    ...overrides,
  };
}

describe('Editor review Chinese model', () => {
  it('maps stable fields to Chinese-first labels and degrades unknown codes safely', () => {
    expect(labelForObjectKind('scene')).toBe('场景');
    expect(labelForObjectKind('timeline')).toBe('时间轴');
    expect(labelForReviewState('STAGE_READY')).toBe('结果已准备，请检查');
    expect(labelForConflictSeverity('selection-required')).toBe('需要你决定');
    expect(labelForUnknownCode('X_NEW')).toBe('未识别的问题（查看技术详情）');
  });

  it('blocks decision sealing on blocking conflicts and accepts all resolved selections', () => {
    const blocking = baseProjection({
      conflicts: [{ conflictId: 'block-1', severity: 'blocking', code: 'BLOCK', unitIds: [], candidateIds: [], objectRefs: [], allowedResolutions: [], repairActions: [], options: [] }],
      evidence: { candidateMatrix: [], blockingCount: 1, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: false },
    });
    expect(canSealDecision(blocking, { selectedUnitIds: [], conflictResolutions: [] })).toBe(false);

    const selectable = baseProjection({
      conflicts: [{ conflictId: 'choose-1', severity: 'selection-required', code: 'DIVERGE', unitIds: ['unit-a'], candidateIds: ['candidate-a'], objectRefs: ['scene:start'], allowedResolutions: ['choose-unit'], repairActions: [], options: [] }],
      evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 1, advisoryCount: 0, canCreateDecision: true },
    });
    expect(canSealDecision(selectable, {
      selectedUnitIds: ['unit-a'],
      conflictResolutions: [{ conflictId: 'choose-1', resolution: 'choose-unit', chosenUnitId: 'unit-a' }],
    })).toBe(true);
  });

  it('renders shared presentation and degrades a legacy unit without guessing content', () => {
    const unit: ReviewUnitOutcome = {
      unitId: 'unit-a',
      candidateId: 'candidate-a',
      primaryObject: 'scene:alpha',
      outcomes: [],
      potentialImpact: [],
      observedImpact: [],
      evidence: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] },
      presentation: {
        actionLabel: '新建场景',
        objectLabel: '场景 alpha',
        highlights: ['lynn：Alpha route A.'],
        completeness: 'content',
        omittedFactCount: 0,
      },
    };

    expect(presentationForReviewUnit(unit).highlights).toEqual(['lynn：Alpha route A.']);
    delete unit.presentation;
    expect(presentationForReviewUnit(unit)).toEqual({
      actionLabel: '内容摘要不足',
      objectLabel: '场景 alpha',
      highlights: [],
      completeness: 'metadata-only',
      omittedFactCount: 0,
    });
  });
});
