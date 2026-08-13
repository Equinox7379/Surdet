import { describe, expect, it } from 'vitest';
import { queryTrace } from '../src/runtime-trace.js';

describe('queryTrace', () => {
  it('finds causal state events by variable and source object', () => {
    const events = [
      {
        kind: 'state' as const,
        source: { sceneId: 'prologue', index: 2, op: 'set', file: 'prologue.gal', line: 3, col: 1 },
        stateDelta: [{ variable: 'trust', before: 0, after: 1 }],
      },
      {
        kind: 'instruction' as const,
        source: { sceneId: 'prologue', index: 3, op: 'text', file: 'prologue.gal', line: 4, col: 1 },
      },
    ];

    expect(queryTrace(events, { kind: 'state', variable: 'trust' })).toHaveLength(1);
    expect(queryTrace(events, { sceneId: 'prologue', op: 'text' })[0]?.source.index).toBe(3);
  });
});
