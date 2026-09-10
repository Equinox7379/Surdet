import type {
  CompositionDependencyCycle,
  CompositionDependencyEdge,
  ObjectProduction,
  ObjectRequirement,
} from './composition-contracts.js';

export interface PrimaryObjectOperationFact {
  operationId: string;
  sequence: number;
  primaryObject: string;
  requiredObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
}

export interface PrimaryObjectOperationGroup {
  primaryObject: string;
  operationSequences: number[];
}

function operationOrder(left: PrimaryObjectOperationFact, right: PrimaryObjectOperationFact): number {
  return left.sequence - right.sequence || left.operationId.localeCompare(right.operationId);
}

function edgeOrder(left: CompositionDependencyEdge, right: CompositionDependencyEdge): number {
  return left.consumerSequence - right.consumerSequence
    || left.producerSequence - right.producerSequence
    || left.objectRef.localeCompare(right.objectRef)
    || left.fromPrimaryObject.localeCompare(right.fromPrimaryObject)
    || left.toPrimaryObject.localeCompare(right.toPrimaryObject);
}

export function groupCompositionOperationsByPrimaryObject(
  operations: readonly PrimaryObjectOperationFact[],
): PrimaryObjectOperationGroup[] {
  const grouped = new Map<string, number[]>();
  for (const operation of [...operations].sort(operationOrder)) {
    const sequences = grouped.get(operation.primaryObject) ?? [];
    sequences.push(operation.sequence);
    grouped.set(operation.primaryObject, sequences);
  }
  return [...grouped.entries()]
    .map(([primaryObject, operationSequences]) => ({ primaryObject, operationSequences: [...operationSequences] }))
    .sort((left, right) => left.primaryObject.localeCompare(right.primaryObject));
}

/** Find SCCs with more than one primary object and retain their internal edges. */
export function findPrimaryObjectDependencyCycles(
  edges: readonly CompositionDependencyEdge[],
): CompositionDependencyCycle[] {
  const nodes = [...new Set(edges.flatMap((edge) => [edge.fromPrimaryObject, edge.toPrimaryObject]))]
    .sort((left, right) => left.localeCompare(right));
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const edge of edges) {
    const targets = adjacency.get(edge.fromPrimaryObject)!;
    if (!targets.includes(edge.toPrimaryObject)) targets.push(edge.toPrimaryObject);
  }
  for (const targets of adjacency.values()) targets.sort((left, right) => left.localeCompare(right));

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const connect = (node: string): void => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(target)!));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    for (;;) {
      const value = stack.pop()!;
      onStack.delete(value);
      component.push(value);
      if (value === node) break;
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  };

  for (const node of nodes) if (!indices.has(node)) connect(node);
  return components
    .filter((primaryObjects) => primaryObjects.length > 1)
    .map((primaryObjects) => {
      const members = new Set(primaryObjects);
      return {
        primaryObjects,
        edges: edges.filter((edge) => members.has(edge.fromPrimaryObject) && members.has(edge.toPrimaryObject)).sort(edgeOrder),
      };
    })
    .sort((left, right) => left.primaryObjects.join('\0').localeCompare(right.primaryObjects.join('\0')));
}

export function buildPrimaryObjectDependencyGraph(
  operations: readonly PrimaryObjectOperationFact[],
): {
  groups: PrimaryObjectOperationGroup[];
  edges: CompositionDependencyEdge[];
  cycles: CompositionDependencyCycle[];
} {
  const ordered = [...operations].sort(operationOrder);
  const byProducerSequence = new Map<number, PrimaryObjectOperationFact[]>();
  for (const operation of ordered) {
    const producers = byProducerSequence.get(operation.sequence) ?? [];
    producers.push(operation);
    byProducerSequence.set(operation.sequence, producers);
  }

  const edgeKeys = new Set<string>();
  const edges: CompositionDependencyEdge[] = [];
  for (const consumer of ordered) {
    for (const requirement of consumer.requiredObjects) {
      if (requirement.source !== 'candidate' || requirement.candidateOperationSequence === undefined) continue;
      const producers = byProducerSequence.get(requirement.candidateOperationSequence) ?? [];
      for (const producer of producers) {
        if (producer.primaryObject === consumer.primaryObject) continue;
        if (!producer.producedObjects.some((production) => production.objectRef === requirement.objectRef)) continue;
        const edge: CompositionDependencyEdge = {
          fromPrimaryObject: consumer.primaryObject,
          toPrimaryObject: producer.primaryObject,
          objectRef: requirement.objectRef,
          consumerSequence: consumer.sequence,
          producerSequence: producer.sequence,
        };
        const key = `${edge.fromPrimaryObject}\0${edge.toPrimaryObject}\0${edge.objectRef}\0${edge.consumerSequence}\0${edge.producerSequence}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push(edge);
      }
    }
  }
  edges.sort(edgeOrder);
  return {
    groups: groupCompositionOperationsByPrimaryObject(ordered),
    edges,
    cycles: findPrimaryObjectDependencyCycles(edges),
  };
}
