import { describe, expect, it } from 'vitest';
import type { ObjectProduction, ObjectRequirement } from '../src/composition-contracts.js';
import { buildPrimaryObjectDependencyGraph } from '../src/composition-unit-graph.js';

function production(objectRef: string): ObjectProduction {
  return { objectRef, disposition: 'create' };
}

function requirement(objectRef: string, sequence: number): ObjectRequirement {
  return { objectRef, source: 'candidate', candidateOperationSequence: sequence };
}

describe('primary object composition graph', () => {
  it('groups operations, follows the exact producer sequence, and ignores internal edges', () => {
    const graph = buildPrimaryObjectDependencyGraph([
      { operationId: 'a-patch', sequence: 2, primaryObject: 'scene:A', requiredObjects: [requirement('scene:B', 1), requirement('scene:A', 0)], producedObjects: [production('scene:A')] },
      { operationId: 'b-create', sequence: 1, primaryObject: 'scene:B', requiredObjects: [], producedObjects: [production('scene:B')] },
      { operationId: 'a-create', sequence: 0, primaryObject: 'scene:A', requiredObjects: [], producedObjects: [production('scene:A')] },
    ]);

    expect(graph.groups).toEqual([
      { primaryObject: 'scene:A', operationSequences: [0, 2] },
      { primaryObject: 'scene:B', operationSequences: [1] },
    ]);
    expect(graph.edges).toEqual([{
      fromPrimaryObject: 'scene:A', toPrimaryObject: 'scene:B', objectRef: 'scene:B', consumerSequence: 2, producerSequence: 1,
    }]);
    expect(graph.cycles).toEqual([]);
  });

  it('returns deterministic multi unit cycles and deduplicates repeated requirements', () => {
    const graph = buildPrimaryObjectDependencyGraph([
      { operationId: 'b', sequence: 1, primaryObject: 'scene:B', requiredObjects: [requirement('scene:A', 0)], producedObjects: [production('scene:B')] },
      { operationId: 'a', sequence: 0, primaryObject: 'scene:A', requiredObjects: [requirement('scene:B', 1), requirement('scene:B', 1)], producedObjects: [production('scene:A')] },
    ]);

    expect(graph.cycles).toEqual([{
      primaryObjects: ['scene:A', 'scene:B'],
      edges: [
        { fromPrimaryObject: 'scene:A', toPrimaryObject: 'scene:B', objectRef: 'scene:B', consumerSequence: 0, producerSequence: 1 },
        { fromPrimaryObject: 'scene:B', toPrimaryObject: 'scene:A', objectRef: 'scene:A', consumerSequence: 1, producerSequence: 0 },
      ],
    }]);
  });
});
