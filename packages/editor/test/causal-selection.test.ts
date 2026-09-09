import { describe, expect, it } from 'vitest';
import {
  buildReviewCausalSelection,
  describeAuthoringObject,
  describeAuthoringReference,
  dispatchPreviewTraceSelection,
  filterTraceByObject,
  listenForPreviewTraceSelection,
  locateObjectForTraceEvent,
  parseTimelineObjectRef,
  reconcileAuthoringSelection,
} from '../src/causal-selection.js';
import type { HumanReviewProjection } from '@surdet/authoring';

describe('causal selection bridge', () => {
  it('reconciles content-only object-ref changes and clears ambiguous or structural changes', () => {
    const previousObject = {
      kind: 'text' as const,
      objectRef: 'scene:alpha/text:2@old-aaaa',
      source: { path: 'content/scenario/alpha.gal', line: 2, col: 1, raw: 'lynn：旧台词' },
      references: [],
      referencedBy: [],
    };
    const replacement = {
      ...previousObject,
      objectRef: 'scene:alpha/text:2@new-bbbb',
      source: { ...previousObject.source, raw: 'lynn：新台词' },
    };
    const previousIndex = { revision: 'old', objects: [previousObject], byRef: new Map([[previousObject.objectRef, previousObject]]) };
    const nextIndex = { revision: 'new', objects: [replacement], byRef: new Map([[replacement.objectRef, replacement]]) };

    expect(reconcileAuthoringSelection(previousObject.objectRef, previousIndex, nextIndex)).toBe(replacement.objectRef);
    expect(reconcileAuthoringSelection(previousObject.objectRef, previousIndex, nextIndex, true)).toBeNull();
    expect(reconcileAuthoringSelection(replacement.objectRef, nextIndex, nextIndex)).toBe(replacement.objectRef);
    expect(reconcileAuthoringSelection(previousObject.objectRef, previousIndex, {
      ...nextIndex,
      objects: [replacement, { ...replacement, objectRef: 'scene:alpha/text:2@new-cccc' }],
    })).toBeNull();
    expect(reconcileAuthoringSelection('missing', previousIndex, nextIndex)).toBeNull();
  });

  it('keeps named objects but clears positional cue selection when an external edit changes its timeline', () => {
    const timeline = { kind: 'timeline' as const, objectRef: 'timeline:intro', semanticId: 'timeline:intro',
      details: { cues: ['same'] }, references: [], referencedBy: [] };
    const cue = { kind: 'cue' as const, objectRef: 'timeline:intro/track:0/cue:0',
      source: { path: 'content/timelines/intro.json', line: 1, col: 1, raw: 'same' }, references: [], referencedBy: [] };
    const objects = [timeline, cue];
    const previous = { revision: 'old', objects, byRef: new Map(objects.map(object => [object.objectRef, object])) };
    const updated = [{ ...timeline, details: { cues: ['same', 'same'] } }, cue];
    const next = { revision: 'new', objects: updated, byRef: new Map(updated.map(object => [object.objectRef, object])) };
    expect(reconcileAuthoringSelection(timeline.objectRef, previous, next, true)).toBe(timeline.objectRef);
    expect(reconcileAuthoringSelection(cue.objectRef, previous, next, true)).toBeNull();
    expect(reconcileAuthoringSelection(cue.objectRef, previous, previous, true)).toBe(cue.objectRef);
  });

  it('filters trace by selected object and locates source from a trace event', () => {
    const selected = 'scene:prologue/text:2@abcd';
    const trace = [
      { step: 1, sourceRef: selected, kind: 'text' },
      { step: 2, sourceRef: 'scene:prologue/choice:1@efgh', kind: 'choice' },
    ];
    expect(filterTraceByObject(selected, trace)).toEqual([trace[0]]);
    expect(locateObjectForTraceEvent(trace[1]!)).toBe('scene:prologue/choice:1@efgh');
  });

  it('uses one event channel for trace selection dispatch and listening', () => {
    const target = new EventTarget();
    const detail = {
      event: { sourceRef: 'scene:ch01_01/choice-option:5@abcd' },
      objectRef: 'scene:ch01_01/choice-option:5@abcd',
      sequence: 3,
    };
    let received: unknown = null;
    const dispose = listenForPreviewTraceSelection((value) => { received = value; }, target);

    dispatchPreviewTraceSelection(detail, target);

    expect(received).toEqual(detail);
    dispose();
    received = null;
    dispatchPreviewTraceSelection(detail, target);
    expect(received).toBeNull();
  });

  it('parses timeline/track/cue object refs for timeline panel jumps', () => {
    expect(parseTimelineObjectRef('timeline:agent_blackout')).toEqual({ timelineId: 'agent_blackout', trackIndex: null, cueIndex: null });
    expect(parseTimelineObjectRef('timeline:agent_blackout/track:2')).toEqual({ timelineId: 'agent_blackout', trackIndex: 2, cueIndex: null });
    expect(parseTimelineObjectRef('timeline:agent_blackout/track:2/cue:0')).toEqual({ timelineId: 'agent_blackout', trackIndex: 2, cueIndex: 0 });
    expect(parseTimelineObjectRef('scene:prologue/text:2@abcd')).toBeNull();
    expect(parseTimelineObjectRef('variable:trust')).toBeNull();
  });

  it('describes the current authoring object and direct references for humans', () => {
    const display = describeAuthoringObject({
      kind: 'choice-option',
      objectRef: 'scene:ch01_01/choice-option:5@abcd-1234',
      source: {
        path: 'content/scenario/ch01_01.gal',
        line: 5,
        col: 3,
        raw: '  路径 A -> @set trust = 1 @goto path_a',
      },
      references: ['variable:trust', 'label:ch01_01.path_a'],
      referencedBy: [],
    });

    expect(display).toEqual({
      title: '选项“路径 A”',
      location: 'ch01_01 · 第 5 行',
      objectRef: 'scene:ch01_01/choice-option:5@abcd-1234',
    });
    expect(describeAuthoringReference('variable:trust')).toBe('变量 trust');
    expect(describeAuthoringReference('label:ch01_01.path_a')).toBe('标签 path_a（ch01_01）');
    expect(describeAuthoringObject({
      kind: 'variable',
      semanticId: 'variable:trust',
      objectRef: 'variable:trust',
      source: { path: 'game.config.json', line: 1, col: 1, raw: '{"type":"number","initial":0}' },
      references: [],
      referencedBy: [],
    }).title).toBe('变量 trust');
  });

  it('uses the shared review projection for current object, causal links, and observed facts', () => {
    const projection: HumanReviewProjection = {
      reviewVersion: '1.0.0', reviewId: 'review-1', kind: 'comparison', state: 'COMPARISON_PREPARED',
      projectIdentity: 'project-1', expectedProjectRevision: 'revision-1',
      task: { title: 'review', acceptanceCriteria: [], candidateCount: 1, objectCount: 1, conflictCount: 0, statementSource: 'generated-fallback' },
      candidates: [], safeGroups: [], defaultSelectedUnitIds: [], conflicts: [], dependencies: [],
      evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
      objects: [{ objectRef: 'scene:wave6_alpha', kind: 'scene', references: ['timeline:wave6_intro'], referencedBy: ['scene:root'], potentialImpact: ['possible'], observedImpact: ['trace-1'] }],
      sourceIdentity: { projectIdentity: 'project-1', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'comparison-fp' },
      reviewFingerprint: 'review-fp',
    };
    expect(buildReviewCausalSelection(projection, 'scene:wave6_alpha')).toEqual({
      selectedObjectRef: 'scene:wave6_alpha',
      currentObject: projection.objects[0],
      directReferences: ['timeline:wave6_intro'],
      directReferencedBy: ['scene:root'],
      potentialImpact: ['possible'],
      observedImpact: ['trace-1'],
    });
    expect(buildReviewCausalSelection(projection, null).currentObject).toBeNull();
  });
});
