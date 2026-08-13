import { describe, expect, it } from 'vitest';
import { filterTraceByObject, locateObjectForTraceEvent } from '../src/causal-selection.js';

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
});
