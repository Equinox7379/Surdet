import { describe, expect, it } from 'vitest';
import {
  describeAuthoringObject,
  describeAuthoringReference,
  dispatchPreviewTraceSelection,
  filterTraceByObject,
  listenForPreviewTraceSelection,
  locateObjectForTraceEvent,
  parseTimelineObjectRef,
} from '../src/causal-selection.js';

describe('causal selection bridge', () => {
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
});
