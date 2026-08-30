import type { FlowEdge, FlowGraph, FlowNode } from './graph/build.js';
import { presentFlowEdge } from './flow-presentation.js';

export interface NarrativePoint {
  x: number;
  y: number;
}

export interface NarrativeNodePresentation {
  primaryText: string;
  supportingText: string;
  branchText?: string;
  conditionText?: string;
  technicalText: string;
}

export interface NarrativeNodeBox {
  node: FlowNode;
  x: number;
  y: number;
  w: number;
  h: number;
  role: 'scene' | 'scene-summary' | 'beat' | 'entry';
}

export interface NarrativeSceneFrame {
  sceneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  component: 'main' | 'secondary';
  nodeIds: string[];
  isConfiguredEntry: boolean;
}

export interface NarrativeRoute {
  edge: FlowEdge;
  points: NarrativePoint[];
  d: string;
  hiddenByDefault: boolean;
  hiddenReason?: 'host-marker' | 'choice-duplicate' | 'source-order' | 'choice-attached' | 'return-marker';
  bundleId?: string;
  label?: string;
  conditionText?: string;
  labelX?: number;
  labelY?: number;
}

export interface NarrativeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NarrativeComponent {
  id: string;
  kind: 'main' | 'secondary';
  sceneIds: string[];
}

export type FlowMapMode = 'focus' | 'overview';
export type NarrativeProjectionMode = FlowMapMode | 'technical';

export interface NarrativeLayoutOptions {
  mode: FlowMapMode;
  focusSceneId?: string;
  technical: boolean;
  maxPredecessors?: number;
  maxSuccessors?: number;
}

export interface NarrativeReturnMarker {
  edge: FlowEdge;
  sourceSceneId: string;
  targetSceneId: string;
  label: string;
}

export interface NarrativeFocusOverflow {
  predecessorCount: number;
  successorCount: number;
}

export interface NarrativeUnprojectableEdge {
  edge: FlowEdge;
  reason: 'missing-source' | 'missing-target' | 'missing-both';
}

export interface NarrativeFlowLayout {
  boxes: Map<string, NarrativeNodeBox>;
  frames: Map<string, NarrativeSceneFrame>;
  routes: NarrativeRoute[];
  components: NarrativeComponent[];
  mainSceneIds: string[];
  secondarySceneIds: string[];
  nodePresentation: Map<string, NarrativeNodePresentation>;
  visibleBounds: NarrativeBounds;
  bounds: NarrativeBounds;
  width: number;
  height: number;
  realNodeCount: number;
  mode: NarrativeProjectionMode;
  focusSceneId?: string;
  focusOverflow?: NarrativeFocusOverflow;
  returnMarkers: NarrativeReturnMarker[];
  unprojectableEdges: NarrativeUnprojectableEdge[];
}

const FRAME_WIDTH = 286;
const FRAME_INSET = 24;
const FRAME_TOP = 42;
const NODE_HEIGHT = 50;
const NODE_GAP = 10;
const FRAME_BOTTOM = 22;
const COLUMN_GAP = 236;
const FRAME_GAP = 58;
const CANVAS_PAD = 54;
const SECONDARY_GAP = 180;
const ROUTE_GAP = 28;

function stableSceneOrder(graph: FlowGraph): string[] {
  return graph.nodes.filter((node) => node.kind === 'scene').map((node) => node.sceneId);
}

function crossSceneAdjacency(graph: FlowGraph, sceneOrder: readonly string[]): Map<string, string[]> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const index = new Map(sceneOrder.map((sceneId, position) => [sceneId, position]));
  const adjacency = new Map(sceneOrder.map((sceneId) => [sceneId, new Set<string>()]));
  for (const edge of graph.edges) {
    if (edge.kind === 'host' || edge.kind === 'loop') continue;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to || from.sceneId === to.sceneId) continue;
    adjacency.get(from.sceneId)?.add(to.sceneId);
  }
  return new Map([...adjacency].map(([sceneId, targets]) => [
    sceneId,
    [...targets].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0)),
  ]));
}

function walkComponent(
  root: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  allowed: ReadonlySet<string>,
): { sceneIds: string[]; depth: Map<string, number> } {
  const sceneIds: string[] = [];
  const depth = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sceneIds.push(current);
    for (const target of adjacency.get(current) ?? []) {
      if (!allowed.has(target) || depth.has(target)) continue;
      depth.set(target, (depth.get(current) ?? 0) + 1);
      queue.push(target);
    }
  }
  return { sceneIds, depth };
}

function frameHeight(realNodes: readonly FlowNode[], hasEntry: boolean, returnMarkerCount = 0): number {
  const entryHeight = hasEntry ? 30 : 0;
  return FRAME_TOP + entryHeight + realNodes.length * NODE_HEIGHT
    + Math.max(0, realNodes.length - 1) * NODE_GAP + FRAME_BOTTOM
    + returnMarkerCount * 28;
}

function pathData(points: readonly NarrativePoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function stableEdgeKey(edge: FlowEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.label ?? ''}`;
}

function dedupePoints(points: readonly NarrativePoint[]): NarrativePoint[] {
  return points.filter((point, index) => index === 0
    || point.x !== points[index - 1]!.x
    || point.y !== points[index - 1]!.y);
}

function labelAnchor(points: readonly NarrativePoint[]): NarrativePoint | undefined {
  let best: { length: number; point: NarrativePoint } | undefined;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (!best || length > best.length) {
      best = { length, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  }
  return best?.point;
}

function expandBounds(bounds: NarrativeBounds, x: number, y: number, padding = 0): void {
  bounds.minX = Math.min(bounds.minX, x - padding);
  bounds.minY = Math.min(bounds.minY, y - padding);
  bounds.maxX = Math.max(bounds.maxX, x + padding);
  bounds.maxY = Math.max(bounds.maxY, y + padding);
}

function indexSceneNodes(graph: FlowGraph): Map<string, FlowNode[]> {
  const byScene = new Map<string, FlowNode[]>();
  for (const node of graph.nodes) {
    if (node.kind === 'host-entry') continue;
    const nodes = byScene.get(node.sceneId) ?? [];
    nodes.push(node);
    byScene.set(node.sceneId, nodes);
  }
  for (const nodes of byScene.values()) {
    nodes.sort((a, b) => {
      if (a.kind === 'scene') return -1;
      if (b.kind === 'scene') return 1;
      return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)
        || a.id.localeCompare(b.id);
    });
  }
  return byScene;
}

function buildNodePresentation(
  graph: FlowGraph,
  sceneMembers: ReadonlyMap<string, readonly FlowNode[]>,
): Map<string, NarrativeNodePresentation> {
  const inboundChoices = new Map<string, FlowEdge[]>();
  const nodeSceneById = new Map(graph.nodes.map((node) => [node.id, node.sceneId]));
  const choiceCountByScene = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'choice') continue;
    const choices = inboundChoices.get(edge.to) ?? [];
    choices.push(edge);
    inboundChoices.set(edge.to, choices);
    const sourceSceneId = nodeSceneById.get(edge.from);
    if (sourceSceneId) choiceCountByScene.set(sourceSceneId, (choiceCountByScene.get(sourceSceneId) ?? 0) + 1);
  }

  const presentation = new Map<string, NarrativeNodePresentation>();
  for (const node of graph.nodes) {
    if (node.kind === 'scene') {
      const members = sceneMembers.get(node.sceneId) ?? [];
      const labelCount = members.filter((member) => member.kind === 'label').length;
      const choiceCount = choiceCountByScene.get(node.sceneId) ?? 0;
      presentation.set(node.id, {
        primaryText: `场景 ${node.sceneId}`,
        supportingText: `${labelCount} 个段落 · ${choiceCount} 个选择`,
        technicalText: `scene · ${node.id}`,
      });
      continue;
    }
    if (node.kind === 'host-entry') {
      presentation.set(node.id, {
        primaryText: '项目入口',
        supportingText: '由项目配置触发',
        technicalText: `host-entry · ${node.id}`,
      });
      continue;
    }

    const incoming = inboundChoices.get(node.id) ?? [];
    if (incoming.length > 0) {
      const edgePresentations = incoming.map((edge) => presentFlowEdge(edge));
      const choiceTexts = [...new Set(edgePresentations.map((edge) => edge.choiceText || edge.displayText || '未命名选择'))];
      const choiceText = choiceTexts.length === 1
        ? choiceTexts[0]!
        : choiceTexts.map((text) => `“${text}”`).join('或');
      const conditional = edgePresentations.some((edge) => edge.conditionText);
      presentation.set(node.id, {
        primaryText: choiceTexts.length === 1 ? `选择“${choiceText}”后` : `选择${choiceText}后`,
        supportingText: conditional ? '包含条件选择' : '玩家选择分支',
        branchText: choiceTexts.join(' / '),
        ...(conditional ? { conditionText: '有条件' } : {}),
        technicalText: `@label ${node.label ?? ''} · ${node.id} · ${edgePresentations.map((edge) => edge.technicalText).join(' | ')}`,
      });
      continue;
    }

    const ordered = (sceneMembers.get(node.sceneId) ?? []).filter((candidate) => candidate.kind === 'label');
    const ordinal = Math.max(1, ordered.findIndex((candidate) => candidate.id === node.id) + 1);
    const isStart = node.label?.trim().toLowerCase() === 'start';
    presentation.set(node.id, {
      primaryText: isStart ? '开场' : `段落 ${ordinal}`,
      supportingText: isStart ? '进入本场景' : '剧情段落',
      technicalText: `@label ${node.label ?? ''} · ${node.id}`,
    });
  }
  return presentation;
}

function routePoints(
  edge: FlowEdge,
  from: NarrativeNodeBox,
  to: NarrativeNodeBox,
  fromFrame: NarrativeSceneFrame,
  toFrame: NarrativeSceneFrame,
  lane: number,
  lowerChannel: number,
): NarrativePoint[] {
  const y1 = from.y + from.h / 2;
  const y2 = to.y + to.h / 2;
  if (from.node.sceneId === to.node.sceneId) {
    if (edge.kind === 'flow') {
      const channelX = fromFrame.x + 12 - lane * 4;
      return dedupePoints([
        { x: from.x, y: y1 },
        { x: channelX, y: y1 },
        { x: channelX, y: y2 },
        { x: to.x, y: y2 },
      ]);
    }
    const channelX = fromFrame.x + fromFrame.w + ROUTE_GAP + lane * 10;
    return dedupePoints([
      { x: from.x + from.w, y: y1 },
      { x: channelX, y: y1 },
      { x: channelX, y: y2 },
      { x: to.x + to.w, y: y2 },
    ]);
  }

  const movingRight = toFrame.x > fromFrame.x + fromFrame.w;
  const adjacent = toFrame.depth === fromFrame.depth + 1 && fromFrame.component === toFrame.component;
  if (movingRight && adjacent) {
    const channelX = (fromFrame.x + fromFrame.w + toFrame.x) / 2 + lane * 6;
    return dedupePoints([
      { x: from.x + from.w, y: y1 },
      { x: channelX, y: y1 },
      { x: channelX, y: y2 },
      { x: to.x, y: y2 },
    ]);
  }

  const fromX = from.x + from.w;
  const toX = to.x;
  const sourceChannel = fromFrame.x + fromFrame.w + ROUTE_GAP + lane * 6;
  const targetChannel = toFrame.x - ROUTE_GAP - lane * 6;
  return dedupePoints([
    { x: fromX, y: y1 },
    { x: sourceChannel, y: y1 },
    { x: sourceChannel, y: lowerChannel },
    { x: targetChannel, y: lowerChannel },
    { x: targetChannel, y: y2 },
    { x: toX, y: y2 },
  ]);
}

export function buildNarrativeFlowLayout(
  graph: FlowGraph,
  entryScene: string,
  options?: NarrativeLayoutOptions,
): NarrativeFlowLayout {
  const boxes = new Map<string, NarrativeNodeBox>();
  const frames = new Map<string, NarrativeSceneFrame>();
  const mode: NarrativeProjectionMode = options ? (options.technical ? 'technical' : options.mode) : 'technical';
  const sceneMembers = indexSceneNodes(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const orderedRawEdges = [...graph.edges].sort((left, right) => stableEdgeKey(left).localeCompare(stableEdgeKey(right)));
  const unprojectableEdges: NarrativeUnprojectableEdge[] = orderedRawEdges.flatMap((edge) => {
    const hasSource = nodeById.has(edge.from);
    const hasTarget = nodeById.has(edge.to);
    if (hasSource && hasTarget) return [];
    return [{
      edge,
      reason: !hasSource && !hasTarget
        ? 'missing-both' as const
        : !hasSource
          ? 'missing-source' as const
          : 'missing-target' as const,
    }];
  });
  const sceneNodeByScene = new Map(
    graph.nodes
      .filter((node) => node.kind === 'scene')
      .map((node) => [node.sceneId, node] as const),
  );
  const hostEntryByScene = new Map(
    graph.nodes
      .filter((node) => node.kind === 'host-entry')
      .map((node) => [node.sceneId, node] as const),
  );
  const nodePresentation = buildNodePresentation(graph, sceneMembers);
  const sceneOrder = stableSceneOrder(graph);
  if (sceneOrder.length === 0) {
    const emptyBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
      boxes,
      frames,
      routes: [],
      components: [],
      mainSceneIds: [],
      secondarySceneIds: [],
      nodePresentation,
      visibleBounds: emptyBounds,
      bounds: emptyBounds,
      width: 0,
      height: 0,
      realNodeCount: graph.nodes.length,
      mode,
      returnMarkers: [],
      unprojectableEdges,
    };
  }

  const adjacency = crossSceneAdjacency(graph, sceneOrder);
  const allowed = new Set(sceneOrder);
  const root = allowed.has(entryScene) ? entryScene : sceneOrder[0]!;
  const main = walkComponent(root, adjacency, allowed);
  const mainSet = new Set(main.sceneIds);
  const secondarySceneIds = sceneOrder.filter((sceneId) => !mainSet.has(sceneId));
  const hostScenes = new Set(hostEntryByScene.keys());

  const components: NarrativeComponent[] = [{ id: 'main', kind: 'main', sceneIds: [...main.sceneIds] }];
  const componentDepth = new Map<string, number>(main.depth);
  const secondaryComponents: Array<{ sceneIds: string[]; depth: Map<string, number> }> = [];
  const remaining = new Set(secondarySceneIds);
  const secondaryRoots = [
    ...secondarySceneIds.filter((sceneId) => hostScenes.has(sceneId)),
    ...secondarySceneIds.filter((sceneId) => !hostScenes.has(sceneId)),
  ];
  for (const secondaryRoot of secondaryRoots) {
    if (!remaining.has(secondaryRoot)) continue;
    const component = walkComponent(secondaryRoot, adjacency, remaining);
    for (const sceneId of component.sceneIds) {
      remaining.delete(sceneId);
      componentDepth.set(sceneId, component.depth.get(sceneId) ?? 0);
    }
    secondaryComponents.push(component);
    components.push({
      id: `secondary-${secondaryComponents.length}`,
      kind: 'secondary',
      sceneIds: [...component.sceneIds],
    });
  }

  const sceneIndex = new Map(sceneOrder.map((sceneId, index) => [sceneId, index]));
  const componentIdByScene = new Map<string, string>();
  for (const component of components) {
    for (const sceneId of component.sceneIds) componentIdByScene.set(sceneId, component.id);
  }
  const sceneForNode = (nodeId: string): string | undefined => nodeById.get(nodeId)?.sceneId;
  const isReturnEdge = (edge: FlowEdge): boolean => {
    if (edge.kind !== 'goto' && edge.kind !== 'jump' && edge.kind !== 'loop') return false;
    const sourceSceneId = sceneForNode(edge.from);
    const targetSceneId = sceneForNode(edge.to);
    if (!sourceSceneId || !targetSceneId || sourceSceneId === targetSceneId) return edge.kind === 'loop';
    const sourceDepth = componentDepth.get(sourceSceneId) ?? 0;
    const targetDepth = componentDepth.get(targetSceneId) ?? 0;
    const targetPrecedesSource = (sceneIndex.get(targetSceneId) ?? 0) < (sceneIndex.get(sourceSceneId) ?? 0);
    if (componentIdByScene.get(sourceSceneId) !== componentIdByScene.get(targetSceneId)) {
      return targetPrecedesSource;
    }
    return targetDepth < sourceDepth || (targetDepth === sourceDepth && targetPrecedesSource);
  };

  const focusSceneId = options?.focusSceneId && allowed.has(options.focusSceneId)
    ? options.focusSceneId
    : root;
  let focusOverflow: NarrativeFocusOverflow | undefined;
  let projectedMainSceneIds = [...main.sceneIds];
  let projectedSecondarySceneIds = [...secondarySceneIds];
  let projectedMainDepth: ReadonlyMap<string, number> = main.depth;
  let projectedSecondaryComponents = secondaryComponents;

  if (mode === 'focus') {
    const predecessorSet = new Set<string>();
    const successorSet = new Set<string>();
    for (const edge of graph.edges) {
      if (isReturnEdge(edge)) continue;
      const sourceSceneId = sceneForNode(edge.from);
      const targetSceneId = sceneForNode(edge.to);
      if (!sourceSceneId || !targetSceneId || sourceSceneId === targetSceneId) continue;
      if (targetSceneId === focusSceneId) predecessorSet.add(sourceSceneId);
      if (sourceSceneId === focusSceneId) successorSet.add(targetSceneId);
    }
    const stable = (left: string, right: string): number => (sceneIndex.get(left) ?? 0) - (sceneIndex.get(right) ?? 0);
    const predecessors = [...predecessorSet].sort(stable);
    const successors = [...successorSet].sort(stable);
    const maxPredecessors = Math.max(0, options?.maxPredecessors ?? 3);
    const maxSuccessors = Math.max(0, options?.maxSuccessors ?? 4);
    const visiblePredecessors = predecessors.slice(0, maxPredecessors);
    const visibleSuccessors = successors.slice(0, maxSuccessors);
    projectedMainSceneIds = [...visiblePredecessors, focusSceneId, ...visibleSuccessors];
    projectedSecondarySceneIds = [];
    projectedSecondaryComponents = [];
    projectedMainDepth = new Map([
      ...visiblePredecessors.map((sceneId) => [sceneId, 0] as const),
      [focusSceneId, 1] as const,
      ...visibleSuccessors.map((sceneId) => [sceneId, 2] as const),
    ]);
    focusOverflow = {
      predecessorCount: Math.max(0, predecessors.length - visiblePredecessors.length),
      successorCount: Math.max(0, successors.length - visibleSuccessors.length),
    };
  }

  const displayedSceneIds = new Set(
    mode === 'focus' ? projectedMainSceneIds : sceneOrder,
  );
  const returnMarkers: NarrativeReturnMarker[] = mode === 'technical'
    ? []
    : [...graph.edges]
      .sort((left, right) => stableEdgeKey(left).localeCompare(stableEdgeKey(right)))
      .filter((edge) => isReturnEdge(edge))
      .flatMap((edge) => {
        const sourceSceneId = sceneForNode(edge.from);
        const targetSceneId = sceneForNode(edge.to);
        if (!sourceSceneId || !targetSceneId || !displayedSceneIds.has(sourceSceneId)) return [];
        return [{ edge, sourceSceneId, targetSceneId, label: `↩ 返回 ${targetSceneId}` }];
      });
  const returnMarkerCountByScene = new Map<string, number>();
  for (const marker of returnMarkers) {
    returnMarkerCountByScene.set(marker.sourceSceneId, (returnMarkerCountByScene.get(marker.sourceSceneId) ?? 0) + 1);
  }

  const placeComponent = (
    sceneIds: readonly string[],
    depth: ReadonlyMap<string, number>,
    component: 'main' | 'secondary',
    startY: number,
  ): number => {
    const byDepth = new Map<number, string[]>();
    for (const sceneId of sceneIds) {
      const level = depth.get(sceneId) ?? 0;
      const column = byDepth.get(level) ?? [];
      column.push(sceneId);
      byDepth.set(level, column);
    }
    let componentBottom = startY;
    for (const level of [...byDepth.keys()].sort((a, b) => a - b)) {
      const x = CANVAS_PAD + level * (FRAME_WIDTH + COLUMN_GAP);
      let y = startY;
      for (const sceneId of byDepth.get(level) ?? []) {
        const expanded = mode === 'technical' || (mode === 'focus' && sceneId === focusSceneId);
        const sceneNode = sceneNodeByScene.get(sceneId);
        const realNodes = expanded
          ? sceneMembers.get(sceneId) ?? []
          : sceneNode ? [sceneNode] : [];
        const entryNode = expanded ? hostEntryByScene.get(sceneId) : undefined;
        const returnMarkerCount = returnMarkerCountByScene.get(sceneId) ?? 0;
        const height = frameHeight(realNodes, Boolean(entryNode), returnMarkerCount);
        const nodeIds = [...realNodes.map((node) => node.id), ...(entryNode ? [entryNode.id] : [])];
        const frame: NarrativeSceneFrame = {
          sceneId,
          x,
          y,
          w: FRAME_WIDTH,
          h: height,
          depth: level,
          component,
          nodeIds,
          isConfiguredEntry: Boolean(entryNode),
        };
        frames.set(sceneId, frame);

        let nodeY = y + FRAME_TOP + (entryNode ? 30 : 0);
        if (entryNode) {
          boxes.set(entryNode.id, {
            node: entryNode,
            x: x + FRAME_WIDTH - 116,
            y: y + 12,
            w: 94,
            h: 24,
            role: 'entry',
          });
        }
        for (const node of realNodes) {
          boxes.set(node.id, {
            node,
            x: x + FRAME_INSET,
            y: nodeY,
            w: FRAME_WIDTH - FRAME_INSET * 2,
            h: NODE_HEIGHT,
            role: node.kind === 'scene' ? (expanded ? 'scene' : 'scene-summary') : 'beat',
          });
          nodeY += NODE_HEIGHT + NODE_GAP;
        }
        y += height + FRAME_GAP;
        componentBottom = Math.max(componentBottom, y - FRAME_GAP);
      }
    }
    return componentBottom;
  };

  const mainBottom = placeComponent(projectedMainSceneIds, projectedMainDepth, 'main', CANVAS_PAD + 34);
  let secondaryY = mainBottom + SECONDARY_GAP;
  for (const component of projectedSecondaryComponents) {
    secondaryY = placeComponent(component.sceneIds, component.depth, 'secondary', secondaryY) + SECONDARY_GAP;
  }

  const choicePairs = new Set(
    graph.edges.filter((edge) => edge.kind === 'choice').map((edge) => `${edge.from}\u0000${edge.to}`),
  );
  const choiceSourcesByTarget = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'choice') continue;
    const sources = choiceSourcesByTarget.get(edge.to) ?? new Set<string>();
    sources.add(edge.from);
    choiceSourcesByTarget.set(edge.to, sources);
  }
  const componentBottom = new Map<'main' | 'secondary', number>();
  for (const component of ['main', 'secondary'] as const) {
    componentBottom.set(component, Math.max(
      ...[...frames.values()]
        .filter((frame) => frame.component === component)
        .map((frame) => frame.y + frame.h),
      CANVAS_PAD,
    ));
  }
  const outsideBottom = Math.max(...componentBottom.values(), CANVAS_PAD);
  const routeLaneByCorridor = new Map<string, number>();
  const lowerLaneByRegion = new Map<string, number>();
  const routes: NarrativeRoute[] = [];
  // Route lanes are a presentation concern. Allocate them from a stable key so
  // the map never wiggles merely because an equivalent edge array was reordered.
  const orderedEdges = orderedRawEdges;
  const endpointBox = (nodeId: string): NarrativeNodeBox | undefined => {
    const direct = boxes.get(nodeId);
    if (direct) return direct;
    const sceneId = sceneForNode(nodeId);
    const sceneNode = sceneId ? sceneNodeByScene.get(sceneId) : undefined;
    return sceneNode ? boxes.get(sceneNode.id) : undefined;
  };
  const mergeKey = (edge: FlowEdge): string | undefined => {
    if (mode === 'technical' || isReturnEdge(edge)) return undefined;
    const sourceSceneId = sceneForNode(edge.from);
    const targetSceneId = sceneForNode(edge.to);
    if (!sourceSceneId || !targetSceneId || sourceSceneId === targetSceneId) return undefined;
    if (!displayedSceneIds.has(sourceSceneId) || !displayedSceneIds.has(targetSceneId)) return undefined;
    return `${sourceSceneId}\u0000${targetSceneId}`;
  };
  const mergeCount = new Map<string, number>();
  for (const edge of orderedEdges) {
    const key = mergeKey(edge);
    if (key) mergeCount.set(key, (mergeCount.get(key) ?? 0) + 1);
  }
  for (const edge of orderedEdges) {
    const sourceSceneId = sceneForNode(edge.from);
    const targetSceneId = sceneForNode(edge.to);
    if (!sourceSceneId || !targetSceneId) continue;
    if (!displayedSceneIds.has(sourceSceneId) || !displayedSceneIds.has(targetSceneId)) {
      if (mode !== 'technical') continue;
    }
    if (mode !== 'technical' && isReturnEdge(edge)) continue;
    const from = endpointBox(edge.from);
    const to = endpointBox(edge.to);
    if (!from || !to) continue;
    const fromFrame = frames.get(from.node.sceneId);
    const toFrame = frames.get(to.node.sceneId);
    if (!fromFrame || !toFrame) continue;
    if (mode !== 'technical' && fromFrame.sceneId === toFrame.sceneId
      && (mode === 'overview' || from.node.id === to.node.id)) continue;
    let hiddenReason: NarrativeRoute['hiddenReason'];
    if (edge.kind === 'host') hiddenReason = 'host-marker';
    else if (mode !== 'technical' && edge.kind === 'choice' && sourceSceneId === targetSceneId) {
      hiddenReason = 'choice-attached';
    }
    else if (edge.kind !== 'choice' && choicePairs.has(`${edge.from}\u0000${edge.to}`)) hiddenReason = 'choice-duplicate';
    else if (edge.kind === 'flow' && from.node.sceneId === to.node.sceneId) {
      const fromChoiceSources = choiceSourcesByTarget.get(edge.from);
      const toChoiceSources = choiceSourcesByTarget.get(edge.to);
      if (fromChoiceSources && toChoiceSources
        && [...fromChoiceSources].some((source) => toChoiceSources.has(source))) {
        hiddenReason = 'source-order';
      }
    }

    const needsLowerChannel = toFrame.x <= fromFrame.x || toFrame.depth > fromFrame.depth + 1
      || fromFrame.component !== toFrame.component;
    const sameScene = from.node.sceneId === to.node.sceneId;
    const corridor = sameScene
      ? `${from.node.sceneId}:${edge.kind === 'flow' ? 'left' : 'right'}`
      : needsLowerChannel
        ? `${from.node.sceneId}->${to.node.sceneId}:lower`
        : `${from.node.sceneId}->${to.node.sceneId}:between`;
    // Hidden technical edges never push the readable routes into another frame.
    const laneKey = `${hiddenReason ? 'technical' : 'readable'}:${corridor}`;
    const laneOrdinal = routeLaneByCorridor.get(laneKey) ?? 0;
    routeLaneByCorridor.set(laneKey, laneOrdinal + 1);
    const edgeMergeKey = mergeKey(edge);
    const bundleId = edgeMergeKey && (mergeCount.get(edgeMergeKey) ?? 0) >= 2 && !hiddenReason
      ? `bundle:${edgeMergeKey}`
      : undefined;
    const lane = bundleId ? 0 : laneOrdinal % 16;

    const lowerRegion = fromFrame.component === toFrame.component ? fromFrame.component : 'cross-component';
    const lowerRegionKey = `${hiddenReason ? 'technical' : 'readable'}:${lowerRegion}`;
    const lowerOrdinal = needsLowerChannel ? (lowerLaneByRegion.get(lowerRegionKey) ?? 0) : 0;
    if (needsLowerChannel) lowerLaneByRegion.set(lowerRegionKey, lowerOrdinal + 1);
    const boundedLowerOrdinal = lowerRegion === 'main' ? lowerOrdinal % 8 : lowerOrdinal;
    const lowerBase = lowerRegion === 'cross-component'
      ? outsideBottom
      : componentBottom.get(fromFrame.component) ?? outsideBottom;
    const lowerChannel = lowerBase + 48 + boundedLowerOrdinal * 16;
    const points = routePoints(edge, from, to, fromFrame, toFrame, lane, lowerChannel);
    const edgePresentation = presentFlowEdge(edge);
    const isAttachedChoice = edge.kind === 'choice' && from.node.sceneId === to.node.sceneId;
    const isAdjacentForwardRoute = toFrame.x > fromFrame.x + fromFrame.w
      && toFrame.depth === fromFrame.depth + 1
      && fromFrame.component === toFrame.component;
    const anchor = isAttachedChoice
      ? undefined
      : isAdjacentForwardRoute
        ? {
            x: (fromFrame.x + fromFrame.w + toFrame.x) / 2,
            y: (from.y + from.h / 2 + to.y + to.h / 2) / 2,
          }
        : labelAnchor(points);
    routes.push({
      edge,
      points,
      d: pathData(points),
      hiddenByDefault: Boolean(hiddenReason),
      ...(hiddenReason ? { hiddenReason } : {}),
      ...(bundleId ? { bundleId } : {}),
      ...(!isAttachedChoice && edge.label ? { label: edgePresentation.displayText } : {}),
      ...(edgePresentation.conditionText ? { conditionText: edgePresentation.conditionText } : {}),
      ...(anchor ? { labelX: anchor.x, labelY: anchor.y } : {}),
    });
  }

  const computeBounds = (includedRoutes: readonly NarrativeRoute[]): NarrativeBounds => {
    const result: NarrativeBounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    for (const frame of frames.values()) {
      expandBounds(result, frame.x, frame.y);
      expandBounds(result, frame.x + frame.w, frame.y + frame.h);
    }
    for (const route of includedRoutes) {
      for (const point of route.points) expandBounds(result, point.x, point.y, 8);
      if (route.label && route.labelX !== undefined && route.labelY !== undefined) {
        expandBounds(result, route.labelX, route.labelY, Math.min(120, 18 + route.label.length * 7));
      }
    }
    if (!Number.isFinite(result.minX)) Object.assign(result, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    result.minX -= CANVAS_PAD;
    result.minY -= CANVAS_PAD;
    result.maxX += CANVAS_PAD;
    result.maxY += CANVAS_PAD;
    return result;
  };
  const bounds = computeBounds(routes);
  const visibleBounds = computeBounds(routes.filter((route) => !route.hiddenByDefault));

  return {
    boxes,
    frames,
    routes,
    components: mode === 'focus'
      ? [{ id: 'focus', kind: 'main', sceneIds: [...projectedMainSceneIds] }]
      : components,
    mainSceneIds: [...projectedMainSceneIds],
    secondarySceneIds: [...projectedSecondarySceneIds],
    nodePresentation,
    visibleBounds,
    bounds,
    width: visibleBounds.maxX - visibleBounds.minX,
    height: visibleBounds.maxY - visibleBounds.minY,
    realNodeCount: graph.nodes.length,
    mode,
    ...(mode === 'focus' ? { focusSceneId, focusOverflow } : {}),
    returnMarkers,
    unprojectableEdges,
  };
}
