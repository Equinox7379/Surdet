import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowGraph } from '../src/graph/build.js';

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NarrativeNodeBox extends Rect {
  node: FlowGraph['nodes'][number];
}

interface NarrativeSceneFrame extends Rect {
  sceneId: string;
  component: 'main' | 'secondary';
  depth: number;
  nodeIds: string[];
}

type FlowMapMode = 'focus' | 'overview';

interface NarrativeLayoutOptions {
  mode: FlowMapMode;
  focusSceneId?: string;
  technical: boolean;
  maxPredecessors?: number;
  maxSuccessors?: number;
}

interface NarrativeReturnMarker {
  edge: FlowEdge;
  sourceSceneId: string;
  targetSceneId: string;
  label: string;
}

interface NarrativeFocusOverflow {
  predecessorCount: number;
  successorCount: number;
}

interface NarrativeRoute {
  edge: FlowEdge;
  points: Point[];
  d: string;
  hiddenByDefault: boolean;
  hiddenReason?: 'host-marker' | 'choice-duplicate' | 'source-order';
  label?: string;
  conditionText?: string;
  labelX?: number;
  labelY?: number;
}

interface NarrativeNodePresentation {
  primaryText: string;
  supportingText: string;
  branchText?: string;
  conditionText?: string;
  technicalText?: string;
}

interface NarrativeFlowLayout {
  frames: Map<string, NarrativeSceneFrame>;
  boxes: Map<string, NarrativeNodeBox>;
  routes: NarrativeRoute[];
  mainSceneIds: string[];
  secondarySceneIds: string[];
  nodePresentation: Map<string, NarrativeNodePresentation>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  visibleBounds: { minX: number; minY: number; maxX: number; maxY: number };
  width: number;
  height: number;
  realNodeCount: number;
  mode?: FlowMapMode;
  focusSceneId?: string;
  focusOverflow?: NarrativeFocusOverflow;
  returnMarkers?: NarrativeReturnMarker[];
  unprojectableEdges?: Array<{
    edge: FlowEdge;
    reason: 'missing-source' | 'missing-target' | 'missing-both';
  }>;
}

interface NarrativeFlowLayoutModule {
  buildNarrativeFlowLayout: (
    graph: FlowGraph,
    entryScene: string,
    options?: NarrativeLayoutOptions,
  ) => NarrativeFlowLayout;
}

interface FlowEdgePresentation {
  kindLabel: string;
  displayText: string;
  choiceText?: string;
  conditionText?: string;
  technicalText: string;
}

interface FlowPresentationModule {
  presentFlowEdge: (edge: FlowEdge) => FlowEdgePresentation;
}

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const narrativeLayoutPath = path.join(editorRoot, 'src/flow-narrative-layout.ts');
const flowPresentationPath = path.join(editorRoot, 'src/flow-presentation.ts');
const flowPanelPath = path.join(editorRoot, 'src/panels/flow.ts');

async function loadNarrativeLayout(): Promise<NarrativeFlowLayoutModule | null> {
  if (!existsSync(narrativeLayoutPath)) return null;
  return import(/* @vite-ignore */ pathToFileURL(narrativeLayoutPath).href) as Promise<NarrativeFlowLayoutModule>;
}

async function requireNarrativeLayout(): Promise<NarrativeFlowLayoutModule> {
  const module = await loadNarrativeLayout();
  expect(
    module,
    'Wave 3A.1 must provide the pure src/flow-narrative-layout.ts narrative-map projection',
  ).not.toBeNull();
  expect(module?.buildNarrativeFlowLayout).toBeTypeOf('function');
  return module!;
}

async function loadFlowPresentation(): Promise<FlowPresentationModule> {
  return import(/* @vite-ignore */ pathToFileURL(flowPresentationPath).href) as Promise<FlowPresentationModule>;
}

function fixtureGraph(): FlowGraph {
  return {
    nodes: [
      { id: 's:intro', kind: 'scene', sceneId: 'intro' },
      { id: 'l:intro.start', kind: 'label', sceneId: 'intro', label: 'start', line: 2 },
      { id: 'l:intro.silence', kind: 'label', sceneId: 'intro', label: 'silence', line: 9 },
      { id: 'l:intro.sword', kind: 'label', sceneId: 'intro', label: 'sword', line: 16 },
      { id: 's:next', kind: 'scene', sceneId: 'next' },
      { id: 's:called', kind: 'scene', sceneId: 'called' },
      { id: 's:switched', kind: 'scene', sceneId: 'switched' },
      { id: 's:condition', kind: 'scene', sceneId: 'condition' },
      { id: 's:event', kind: 'scene', sceneId: 'event' },
      { id: 'h:event', kind: 'host-entry', sceneId: 'event' },
      { id: 's:orphan', kind: 'scene', sceneId: 'orphan' },
    ],
    edges: [
      { from: 's:intro', to: 'l:intro.start', kind: 'flow' },
      { from: 'l:intro.start', to: 'l:intro.silence', kind: 'flow' },
      { from: 'l:intro.silence', to: 'l:intro.sword', kind: 'flow' },
      { from: 'l:intro.start', to: 'l:intro.silence', kind: 'choice', label: '保持沉默' },
      { from: 'l:intro.start', to: 's:next', kind: 'choice', label: '拔出剑 [if:trust >= 10]' },
      { from: 'l:intro.silence', to: 's:next', kind: 'jump' },
      { from: 'l:intro.sword', to: 's:called', kind: 'call' },
      { from: 'l:intro.sword', to: 's:switched', kind: 'switch', label: 'route-1' },
      { from: 'l:intro.sword', to: 's:condition', kind: 'if', label: 'if trust >= 10' },
      { from: 'h:event', to: 's:event', kind: 'host' },
    ],
  };
}

function frameFor(layout: NarrativeFlowLayout, sceneId: string): NarrativeSceneFrame {
  const frame = layout.frames.get(sceneId);
  expect(frame, `missing scene frame for ${sceneId}`).toBeDefined();
  return frame!;
}

function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
}

function segmentCrossesRectInterior(a: Point, b: Point, rect: Rect): boolean {
  if (a.x === b.x) {
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return a.x > rect.x
      && a.x < rect.x + rect.w
      && maxY > rect.y
      && minY < rect.y + rect.h;
  }
  if (a.y === b.y) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return a.y > rect.y
      && a.y < rect.y + rect.h
      && maxX > rect.x
      && minX < rect.x + rect.w;
  }
  return true;
}

function edgeKey(edge: FlowEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.label ?? ''}`;
}

function normalizedGeometry(layout: NarrativeFlowLayout): unknown {
  return {
    frames: [...layout.frames.values()]
      .map(({ sceneId, component, depth, x, y, w, h, nodeIds }) => ({
        sceneId, component, depth, x, y, w, h, nodeIds: [...nodeIds].sort(),
      }))
      .sort((a, b) => a.sceneId.localeCompare(b.sceneId)),
    nodes: [...layout.boxes.values()]
      .map(({ node, x, y, w, h }) => ({ nodeId: node.id, sceneId: node.sceneId, x, y, w, h }))
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    routes: layout.routes
      .map((route) => ({ key: edgeKey(route.edge), points: route.points }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function corridorStressGraph(includeHiddenSourceOrder: boolean): FlowGraph {
  const edges: FlowEdge[] = [
    { from: 's:source', to: 'l:source.choice', kind: 'flow' },
    { from: 'l:source.choice', to: 'l:source.a', kind: 'choice', label: '留在原地' },
    { from: 'l:source.choice', to: 'l:source.b', kind: 'choice', label: '继续前进' },
    { from: 's:source', to: 's:blocker', kind: 'jump' },
    ...Array.from({ length: 16 }, (_, index): FlowEdge => ({
      from: 'l:source.choice',
      to: 's:target',
      kind: 'choice',
      label: `远行路线 ${String(index + 1).padStart(2, '0')}`,
    })),
  ];
  if (includeHiddenSourceOrder) {
    edges.push({ from: 'l:source.a', to: 'l:source.b', kind: 'flow' });
  }
  return {
    nodes: [
      { id: 's:source', kind: 'scene', sceneId: 'source' },
      { id: 'l:source.choice', kind: 'label', sceneId: 'source', label: 'choice', line: 2 },
      { id: 'l:source.a', kind: 'label', sceneId: 'source', label: 'a', line: 8 },
      { id: 'l:source.b', kind: 'label', sceneId: 'source', label: 'b', line: 14 },
      { id: 's:blocker', kind: 'scene', sceneId: 'blocker' },
      { id: 's:target', kind: 'scene', sceneId: 'target' },
    ],
    edges,
  };
}

function longFormFocusGraph(): FlowGraph {
  const sceneIds = [
    'entry',
    'pred-1',
    'pred-2',
    'pred-3',
    'pred-4',
    'pred-5',
    'focus',
    'succ-1',
    'succ-2',
    'succ-3',
    'succ-4',
    'succ-5',
    'succ-6',
  ];
  const ordinaryNodes = sceneIds.flatMap((sceneId) => [
    { id: `s:${sceneId}`, kind: 'scene' as const, sceneId },
    { id: `l:${sceneId}.start`, kind: 'label' as const, sceneId, label: 'start', line: 2 },
  ]);
  return {
    nodes: [
      ...ordinaryNodes,
      { id: 'l:focus.option-a', kind: 'label', sceneId: 'focus', label: 'option-a', line: 8 },
      { id: 'l:focus.option-b', kind: 'label', sceneId: 'focus', label: 'option-b', line: 12 },
    ],
    edges: [
      ...sceneIds.map((sceneId): FlowEdge => ({
        from: `s:${sceneId}`,
        to: `l:${sceneId}.start`,
        kind: 'flow',
      })),
      { from: 's:entry', to: 's:pred-1', kind: 'jump' },
      ...Array.from({ length: 5 }, (_, index): FlowEdge => ({
        from: `s:pred-${index + 1}`,
        to: 's:focus',
        kind: 'jump',
      })),
      { from: 'l:focus.start', to: 'l:focus.option-a', kind: 'choice', label: '追上列车' },
      { from: 'l:focus.start', to: 'l:focus.option-b', kind: 'choice', label: '留在站台' },
      { from: 'l:focus.option-a', to: 's:succ-1', kind: 'jump' },
      { from: 'l:focus.option-b', to: 's:succ-1', kind: 'jump' },
      ...Array.from({ length: 5 }, (_, index): FlowEdge => ({
        from: 'l:focus.start',
        to: `s:succ-${index + 2}`,
        kind: 'jump',
      })),
      { from: 'l:focus.start', to: 's:entry', kind: 'goto' },
    ],
  };
}

function sceneNodeIds(graph: FlowGraph): string[] {
  return graph.nodes.filter((node) => node.kind === 'scene').map((node) => node.id);
}

describe('Flow narrative path map contract', () => {
  it('bounds the default focus projection to one expanded scene plus stable compact neighbours', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = longFormFocusGraph();
    const options: NarrativeLayoutOptions = {
      mode: 'focus',
      focusSceneId: 'focus',
      technical: false,
      maxPredecessors: 3,
      maxSuccessors: 4,
    };
    const layout = buildNarrativeFlowLayout(graph, 'entry', options);
    const reversedEdges = buildNarrativeFlowLayout(
      { nodes: graph.nodes.map((node) => ({ ...node })), edges: [...graph.edges].reverse() },
      'entry',
      options,
    );
    const expectedScenes = [
      'pred-1', 'pred-2', 'pred-3', 'focus', 'succ-1', 'succ-2', 'succ-3', 'succ-4',
    ];

    expect(layout.mode).toBe('focus');
    expect(layout.focusSceneId).toBe('focus');
    expect([...layout.frames.keys()]).toHaveLength(8);
    expect(new Set(layout.frames.keys())).toEqual(new Set(expectedScenes));
    expect(new Set(reversedEdges.frames.keys()), 'neighbour selection must not depend on edge iteration order')
      .toEqual(new Set(expectedScenes));
    expect(layout.focusOverflow).toEqual({ predecessorCount: 2, successorCount: 2 });

    expect(frameFor(layout, 'focus').nodeIds).toEqual([
      's:focus',
      'l:focus.start',
      'l:focus.option-a',
      'l:focus.option-b',
    ]);
    for (const sceneId of expectedScenes.filter((sceneId) => sceneId !== 'focus')) {
      expect(frameFor(layout, sceneId).nodeIds, `${sceneId} must remain a compact scene-only neighbour`)
        .toEqual([`s:${sceneId}`]);
    }
  });

  it('keeps backward story edges out of the focus neighbourhood and exposes a compact return marker', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = longFormFocusGraph();
    const layout = buildNarrativeFlowLayout(graph, 'entry', {
      mode: 'focus',
      focusSceneId: 'focus',
      technical: false,
      maxPredecessors: 3,
      maxSuccessors: 4,
    });
    const technicalLayout = buildNarrativeFlowLayout(graph, 'entry', {
      mode: 'focus',
      focusSceneId: 'focus',
      technical: true,
      maxPredecessors: 3,
      maxSuccessors: 4,
    });
    const returnEdge = graph.edges.find((edge) => edge.kind === 'goto' && edge.to === 's:entry')!;
    const readableReturnRoute = layout.routes.find((route) => edgeKey(route.edge) === edgeKey(returnEdge));
    const fullReturnRoute = technicalLayout.routes.find((route) => edgeKey(route.edge) === edgeKey(returnEdge));

    expect(layout.frames.has('entry'), 'a return target must not consume a forward-neighbour slot').toBe(false);
    expect(layout.returnMarkers).toEqual([
      {
        edge: returnEdge,
        sourceSceneId: 'focus',
        targetSceneId: 'entry',
        label: '↩ 返回 entry',
      },
    ]);
    expect(readableReturnRoute, 'readable mode must replace the canvas-wide route with its marker').toBeUndefined();
    expect(fullReturnRoute, 'technical mode must retain the real business edge').toBeDefined();
  });

  it('folds same-depth backward and later-component-to-earlier-scene jumps into return markers', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph: FlowGraph = {
      nodes: [
        { id: 's:home', kind: 'scene', sceneId: 'home' },
        { id: 's:peer-a', kind: 'scene', sceneId: 'peer-a' },
        { id: 's:peer-b', kind: 'scene', sceneId: 'peer-b' },
        { id: 's:side-entry', kind: 'scene', sceneId: 'side-entry' },
        { id: 'h:side-entry', kind: 'host-entry', sceneId: 'side-entry' },
      ],
      edges: [
        { from: 's:home', to: 's:peer-a', kind: 'jump' },
        { from: 's:home', to: 's:peer-b', kind: 'jump' },
        { from: 's:peer-b', to: 's:peer-a', kind: 'goto' },
        { from: 's:side-entry', to: 's:home', kind: 'jump' },
        { from: 'h:side-entry', to: 's:side-entry', kind: 'host' },
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'home', {
      mode: 'overview',
      technical: false,
    });

    expect(layout.returnMarkers?.map((marker) => `${marker.sourceSceneId}->${marker.targetSceneId}`))
      .toEqual(['peer-b->peer-a', 'side-entry->home']);
    expect(layout.routes.some((route) => route.edge.from === 's:peer-b' && route.edge.to === 's:peer-a')).toBe(false);
    expect(layout.routes.some((route) => route.edge.from === 's:side-entry' && route.edge.to === 's:home')).toBe(false);
  });

  it('reports raw edges whose source or target cannot be projected without fabricating endpoints', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const missingTarget: FlowEdge = { from: 's:home', to: 's:missing', kind: 'jump' };
    const missingSource: FlowEdge = { from: 's:missing-source', to: 's:home', kind: 'goto' };
    const graph: FlowGraph = {
      nodes: [{ id: 's:home', kind: 'scene', sceneId: 'home' }],
      edges: [missingTarget, missingSource],
    };
    const layout = buildNarrativeFlowLayout(graph, 'home');

    expect(layout.routes).toHaveLength(0);
    expect(layout.unprojectableEdges).toEqual([
      { edge: missingTarget, reason: 'missing-target' },
      { edge: missingSource, reason: 'missing-source' },
    ]);
    const flowPanelSource = readFileSync(flowPanelPath, 'utf8');
    expect(flowPanelSource).toContain('条连接因端点缺失未显示');
  });

  it('renders overview as every real scene in a compact scene-only projection', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = longFormFocusGraph();
    const layout = buildNarrativeFlowLayout(graph, 'entry', {
      mode: 'overview',
      focusSceneId: 'focus',
      technical: false,
    });
    const expectedSceneNodes = sceneNodeIds(graph).sort();

    expect(layout.mode).toBe('overview');
    expect([...layout.frames.keys()].sort()).toEqual(
      graph.nodes.filter((node) => node.kind === 'scene').map((node) => node.sceneId).sort(),
    );
    expect([...layout.boxes.keys()].sort()).toEqual(expectedSceneNodes);
    for (const frame of layout.frames.values()) {
      expect(frame.nodeIds).toEqual([`s:${frame.sceneId}`]);
    }
    expect(layout.realNodeCount, 'compact presentation must not invent or erase business-node accounting')
      .toBe(graph.nodes.length);
  });

  it('hides attached same-scene choice routes in readable mode without inventing option nodes', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = longFormFocusGraph();
    const layout = buildNarrativeFlowLayout(graph, 'entry', {
      mode: 'focus',
      focusSceneId: 'focus',
      technical: false,
    });
    const sameSceneChoices = layout.routes.filter((route) => route.edge.kind === 'choice'
      && route.edge.from.startsWith('l:focus.')
      && route.edge.to.startsWith('l:focus.'));
    const realNodeIds = new Set(graph.nodes.map((node) => node.id));

    expect(sameSceneChoices).toHaveLength(2);
    expect(sameSceneChoices.every((route) => route.hiddenByDefault)).toBe(true);
    expect(layout.realNodeCount).toBe(graph.nodes.length);
    expect([...layout.boxes.values()].every((box) => realNodeIds.has(box.node.id))).toBe(true);
    expect(layout.returnMarkers?.every((marker) => graph.edges.includes(marker.edge))).toBe(true);
  });

  it('merges same-destination jumps into one shared outgoing trunk while preserving both real edges', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = longFormFocusGraph();
    const layout = buildNarrativeFlowLayout(graph, 'entry', {
      mode: 'focus',
      focusSceneId: 'focus',
      technical: false,
    });
    const merged = layout.routes.filter((route) => route.edge.kind === 'jump'
      && (route.edge.from === 'l:focus.option-a' || route.edge.from === 'l:focus.option-b')
      && route.edge.to === 's:succ-1');

    expect(merged).toHaveLength(2);
    expect(merged.every((route) => !route.hiddenByDefault)).toBe(true);
    expect(merged[0]!.points.length).toBeGreaterThanOrEqual(4);
    expect(
      merged[0]!.points.slice(-2),
      'same-target routes must share one final bus-to-target trunk instead of parallel ladders',
    ).toEqual(merged[1]!.points.slice(-2));
    expect(new Set(merged.map((route) => edgeKey(route.edge))).size).toBe(2);
    expect(layout.realNodeCount).toBe(graph.nodes.length);
  });

  it('groups every real scene member inside one non-overlapping scene frame', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = fixtureGraph();
    const layout = buildNarrativeFlowLayout(graph, 'intro');

    expect(layout.frames.size).toBe(7);
    for (const frame of layout.frames.values()) {
      const expectedNodeIds = graph.nodes
        .filter((node) => node.sceneId === frame.sceneId)
        .map((node) => node.id)
        .sort();
      expect([...frame.nodeIds].sort(), `scene-frame membership for ${frame.sceneId}`).toEqual(expectedNodeIds);
      for (const nodeId of expectedNodeIds) {
        const box = layout.boxes.get(nodeId);
        expect(box, `missing real node box ${nodeId}`).toBeDefined();
        expect(rectContainsRect(frame, box!), `${nodeId} must stay inside scene ${frame.sceneId}`).toBe(true);
      }
    }

    const frames = [...layout.frames.values()];
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        expect(
          rectsOverlap(frames[i]!, frames[j]!),
          `${frames[i]!.sceneId} and ${frames[j]!.sceneId} frames overlap`,
        ).toBe(false);
      }
    }
  });

  it('separates the entry component from configured and disconnected secondary roots', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const layout = buildNarrativeFlowLayout(fixtureGraph(), 'intro');

    expect(layout.mainSceneIds).toEqual(['intro', 'next', 'called', 'switched', 'condition']);
    expect(layout.secondarySceneIds).toEqual(['event', 'orphan']);
    expect(frameFor(layout, 'intro')).toMatchObject({ component: 'main', depth: 0 });
    expect(frameFor(layout, 'event')).toMatchObject({ component: 'secondary' });
    expect(frameFor(layout, 'orphan')).toMatchObject({ component: 'secondary' });

    const primaryBottom = Math.max(
      ...[...layout.frames.values()].filter((frame) => frame.component === 'main').map((frame) => frame.y + frame.h),
    );
    const secondaryTop = Math.min(
      ...[...layout.frames.values()].filter((frame) => frame.component === 'secondary').map((frame) => frame.y),
    );
    expect(secondaryTop, 'secondary roots must occupy an explicit lower region').toBeGreaterThan(primaryBottom);

    const flowPanelSource = readFileSync(flowPanelPath, 'utf8');
    expect(flowPanelSource).toContain('当前聚焦路径');
    expect(flowPanelSource).toContain('全局场景概览');
    expect(flowPanelSource).toContain('完整技术连接');
    expect(flowPanelSource).toContain('其他入口');
    expect(flowPanelSource).not.toContain('唯一主线');
  });

  it('keeps stable source/depth geometry and includes every real edge exactly once', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = fixtureGraph();
    const first = buildNarrativeFlowLayout(graph, 'intro');
    const shuffledEdges = buildNarrativeFlowLayout(
      { nodes: graph.nodes.map((node) => ({ ...node })), edges: [...graph.edges].reverse().map((edge) => ({ ...edge })) },
      'intro',
    );

    expect(normalizedGeometry(shuffledEdges)).toEqual(normalizedGeometry(first));
    expect(first.routes.map((route) => edgeKey(route.edge)).sort()).toEqual(
      graph.edges.map(edgeKey).sort(),
    );
    expect(frameFor(first, 'intro').x).toBeLessThan(frameFor(first, 'next').x);
    expect(frameFor(first, 'intro').x).toBeLessThan(frameFor(first, 'called').x);
  });

  it('routes every connection orthogonally without crossing a real node interior', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const layout = buildNarrativeFlowLayout(fixtureGraph(), 'intro');

    for (const route of layout.routes) {
      expect(route.points.length, `route ${edgeKey(route.edge)} needs at least two points`).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!;
        const to = route.points[index]!;
        expect(
          from.x === to.x || from.y === to.y,
          `route ${edgeKey(route.edge)} has a diagonal segment`,
        ).toBe(true);
        for (const box of layout.boxes.values()) {
          expect(
            segmentCrossesRectInterior(from, to, box),
            `route ${edgeKey(route.edge)} crosses node ${box.node.id}`,
          ).toBe(false);
        }
      }
    }
  });

  it('attaches real choice text to its destination or source route without an option prefix', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const presentation = await loadFlowPresentation();
    const graph = fixtureGraph();
    const layout = buildNarrativeFlowLayout(graph, 'intro');
    const sameSceneChoice = graph.edges.find((edge) => edge.kind === 'choice' && edge.to === 'l:intro.silence')!;
    const crossSceneChoice = graph.edges.find((edge) => edge.kind === 'choice' && edge.to === 's:next')!;
    const sameRoute = layout.routes.find((route) => edgeKey(route.edge) === edgeKey(sameSceneChoice))!;
    const crossRoute = layout.routes.find((route) => edgeKey(route.edge) === edgeKey(crossSceneChoice))!;

    expect(layout.nodePresentation.get('l:intro.silence')).toMatchObject({
      primaryText: '选择“保持沉默”后',
      branchText: '保持沉默',
    });
    expect(sameRoute.label).toBeUndefined();
    expect(crossRoute).toMatchObject({
      label: '拔出剑',
      conditionText: '有条件',
    });

    expect(presentation.presentFlowEdge(sameSceneChoice).displayText).toBe('保持沉默');
    expect(presentation.presentFlowEdge(sameSceneChoice).displayText).not.toContain('选项：');
    expect(presentation.presentFlowEdge(crossSceneChoice)).toMatchObject({
      displayText: '拔出剑',
      choiceText: '拔出剑',
      conditionText: '有条件',
    });
    expect(presentation.presentFlowEdge(crossSceneChoice).technicalText).toContain('trust >= 10');
  });

  it('keeps presentation-only branch descriptions out of real node identity and counts', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = fixtureGraph();
    const layout = buildNarrativeFlowLayout(graph, 'intro');
    const realNodeIds = graph.nodes.map((node) => node.id).sort();

    expect([...layout.boxes.keys()].sort()).toEqual(realNodeIds);
    expect(layout.boxes.size).toBe(graph.nodes.length);
    expect(layout.realNodeCount).toBe(graph.nodes.length);
    expect([...layout.nodePresentation.keys()].sort()).toEqual(realNodeIds);
    expect(layout.routes.filter((route) => route.edge.kind === 'choice')).toHaveLength(2);
    for (const route of layout.routes.filter((candidate) => candidate.edge.kind === 'choice')) {
      expect(layout.boxes.has(`choice:${edgeKey(route.edge)}`)).toBe(false);
    }
  });

  it('hides only source-order flow between sibling choice targets and keeps the following story flow visible', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph: FlowGraph = {
      nodes: [
        { id: 's:chapter', kind: 'scene', sceneId: 'chapter' },
        { id: 'l:chapter.choice', kind: 'label', sceneId: 'chapter', label: 'choice', line: 2 },
        { id: 'l:chapter.a', kind: 'label', sceneId: 'chapter', label: 'a', line: 8 },
        { id: 'l:chapter.b', kind: 'label', sceneId: 'chapter', label: 'b', line: 14 },
        { id: 'l:chapter.after', kind: 'label', sceneId: 'chapter', label: 'after', line: 20 },
      ],
      edges: [
        { from: 's:chapter', to: 'l:chapter.choice', kind: 'flow' },
        { from: 'l:chapter.choice', to: 'l:chapter.a', kind: 'choice', label: '坦白' },
        { from: 'l:chapter.choice', to: 'l:chapter.b', kind: 'choice', label: '沉默' },
        { from: 'l:chapter.a', to: 'l:chapter.b', kind: 'flow' },
        { from: 'l:chapter.b', to: 'l:chapter.after', kind: 'flow' },
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'chapter');
    const siblingSourceOrder = layout.routes.find((route) => route.edge.kind === 'flow'
      && route.edge.from === 'l:chapter.a'
      && route.edge.to === 'l:chapter.b');
    const ordinaryContinuation = layout.routes.find((route) => route.edge.kind === 'flow'
      && route.edge.from === 'l:chapter.b'
      && route.edge.to === 'l:chapter.after');

    expect(siblingSourceOrder).toMatchObject({
      hiddenByDefault: true,
      hiddenReason: 'source-order',
    });
    expect(ordinaryContinuation).toMatchObject({ hiddenByDefault: false });
    expect(ordinaryContinuation).not.toHaveProperty('hiddenReason');
  });

  it('preserves every real option text when multiple choices converge on one destination', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph: FlowGraph = {
      nodes: [
        { id: 's:chapter', kind: 'scene', sceneId: 'chapter' },
        { id: 'l:chapter.choice', kind: 'label', sceneId: 'chapter', label: 'choice', line: 2 },
        { id: 'l:chapter.rejoin', kind: 'label', sceneId: 'chapter', label: 'rejoin', line: 12 },
      ],
      edges: [
        { from: 'l:chapter.choice', to: 'l:chapter.rejoin', kind: 'choice', label: '保持沉默' },
        { from: 'l:chapter.choice', to: 'l:chapter.rejoin', kind: 'choice', label: '拔出剑' },
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'chapter');
    const destination = layout.nodePresentation.get('l:chapter.rejoin');

    expect(destination).toMatchObject({
      primaryText: '选择“保持沉默”或“拔出剑”后',
      branchText: '保持沉默 / 拔出剑',
    });
    expect(destination?.technicalText).toContain('保持沉默');
    expect(destination?.technicalText).toContain('拔出剑');
  });

  it('keeps both the real option label and the human condition marker on a cross-scene choice route', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph: FlowGraph = {
      nodes: [
        { id: 's:intro', kind: 'scene', sceneId: 'intro' },
        { id: 's:secret', kind: 'scene', sceneId: 'secret' },
      ],
      edges: [
        {
          from: 's:intro',
          to: 's:secret',
          kind: 'choice',
          label: '打开密门 [if:trust >= 10]',
        },
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'intro');
    const route = layout.routes.find((candidate) => candidate.edge.kind === 'choice');

    expect(route).toMatchObject({
      label: '打开密门',
      conditionText: '有条件',
      hiddenByDefault: false,
    });
    expect(route?.labelX).toBeTypeOf('number');
    expect(route?.labelY).toBeTypeOf('number');
  });

  it('keeps a crowded route corridor outside non-endpoint frames and isolates hidden lane allocation', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const withoutHidden = buildNarrativeFlowLayout(corridorStressGraph(false), 'source');
    const withHidden = buildNarrativeFlowLayout(corridorStressGraph(true), 'source');
    const crowdedRoutes = withHidden.routes.filter((route) => route.edge.kind === 'choice'
      && route.edge.from === 'l:source.choice'
      && route.edge.to === 's:target');

    expect(crowdedRoutes).toHaveLength(16);
    for (const route of withHidden.routes) {
      const fromSceneId = withHidden.boxes.get(route.edge.from)?.node.sceneId;
      const toSceneId = withHidden.boxes.get(route.edge.to)?.node.sceneId;
      for (const frame of withHidden.frames.values()) {
        if (frame.sceneId === fromSceneId || frame.sceneId === toSceneId) continue;
        for (let index = 1; index < route.points.length; index++) {
          expect(
            segmentCrossesRectInterior(route.points[index - 1]!, route.points[index]!, frame),
            `route ${edgeKey(route.edge)} crosses non-endpoint scene frame ${frame.sceneId}`,
          ).toBe(false);
        }
      }
    }

    const readableGeometry = (layout: NarrativeFlowLayout): Array<{ key: string; points: Point[] }> => layout.routes
      .filter((route) => !route.hiddenByDefault)
      .map((route) => ({ key: edgeKey(route.edge), points: route.points }))
      .sort((left, right) => left.key.localeCompare(right.key));
    expect(
      readableGeometry(withHidden),
      'a hidden technical edge must not consume a readable lane or push it toward a neighboring frame',
    ).toEqual(readableGeometry(withoutHidden));
  });

  it('keeps readable return routes and the default fit bounds left of the depth-zero scene when routing requires negative coordinates', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const returnLabels = Array.from({ length: 8 }, (_, index) => ({
      id: `l:later.return-${index}`,
      kind: 'label' as const,
      sceneId: 'later',
      label: `return-${index}`,
      line: 10 + index,
    }));
    const graph: FlowGraph = {
      nodes: [
        { id: 's:home', kind: 'scene', sceneId: 'home' },
        { id: 's:later', kind: 'scene', sceneId: 'later' },
        ...returnLabels,
      ],
      edges: [
        { from: 's:home', to: 's:later', kind: 'jump' },
        ...returnLabels.map((node): FlowEdge => ({
          from: node.id,
          to: 's:home',
          kind: 'goto',
        })),
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'home');
    const returnRoutes = layout.routes.filter((route) => route.edge.kind === 'goto');
    const negativePoints = returnRoutes.flatMap((route) => route.points).filter((point) => point.x < 0);

    expect(returnRoutes.length).toBeGreaterThanOrEqual(5);
    expect(negativePoints.length, 'the stress fixture must actually exercise left-of-canvas routing').toBeGreaterThan(0);
    const leftmostRouteX = Math.min(...negativePoints.map((point) => point.x));
    expect(layout.bounds.minX, 'full bounds must not clamp a negative technical coordinate to zero')
      .toBeLessThanOrEqual(leftmostRouteX);
    expect(layout.visibleBounds.minX, 'default-fit bounds must include every readable negative route coordinate')
      .toBeLessThanOrEqual(leftmostRouteX);
    expect(layout.visibleBounds.minX).toBeLessThan(0);
    expect(layout.width).toBe(layout.visibleBounds.maxX - layout.visibleBounds.minX);

    const flowPanelSource = readFileSync(flowPanelPath, 'utf8');
    expect(flowPanelSource).toMatch(
      /technicalEdgesVisible\s*\?\s*layout\.bounds\s*:\s*layout\.visibleBounds/,
    );
  });

  it('does not let a sorted-first hidden duplicate consume a readable lower-channel lane', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph = (includeTechnicalDuplicate: boolean): FlowGraph => ({
      nodes: [
        { id: 's:entry', kind: 'scene', sceneId: 'entry' },
        { id: 's:middle', kind: 'scene', sceneId: 'middle' },
        { id: 's:far', kind: 'scene', sceneId: 'far' },
      ],
      edges: [
        { from: 's:entry', to: 's:middle', kind: 'jump' },
        { from: 's:middle', to: 's:far', kind: 'jump' },
        ...(includeTechnicalDuplicate
          ? [{ from: 's:far', to: 's:entry', kind: 'call' as const }]
          : []),
        { from: 's:far', to: 's:entry', kind: 'choice', label: '回到开场' },
      ],
    });
    const withoutTechnicalDuplicate = buildNarrativeFlowLayout(graph(false), 'entry');
    const withTechnicalDuplicate = buildNarrativeFlowLayout(graph(true), 'entry');
    const hiddenDuplicate = withTechnicalDuplicate.routes.find((route) => route.edge.kind === 'call');
    const readableGeometry = (layout: NarrativeFlowLayout): Array<{ key: string; points: Point[]; d: string }> => layout.routes
      .filter((route) => !route.hiddenByDefault)
      .map((route) => ({ key: edgeKey(route.edge), points: route.points, d: route.d }))
      .sort((left, right) => left.key.localeCompare(right.key));

    expect(edgeKey(hiddenDuplicate!.edge).localeCompare(
      edgeKey(withTechnicalDuplicate.routes.find((route) => route.edge.kind === 'choice')!.edge),
    )).toBeLessThan(0);
    expect(hiddenDuplicate).toMatchObject({
      hiddenByDefault: true,
      hiddenReason: 'choice-duplicate',
    });
    expect(
      readableGeometry(withTechnicalDuplicate),
      'a sorted-first technical lower-channel edge must not alter readable route points or path data',
    ).toEqual(readableGeometry(withoutTechnicalDuplicate));
  });

  it('keeps a 192px adjacent-route label wholly inside the inter-scene corridor', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph: FlowGraph = {
      nodes: [
        { id: 's:origin', kind: 'scene', sceneId: 'origin' },
        { id: 's:destination', kind: 'scene', sceneId: 'destination' },
      ],
      edges: [
        {
          from: 's:origin',
          to: 's:destination',
          kind: 'choice',
          label: '这是一条需要完整显示的相邻场景选择路线',
        },
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'origin');
    const fromFrame = frameFor(layout, 'origin');
    const toFrame = frameFor(layout, 'destination');
    const route = layout.routes.find((candidate) => candidate.edge.kind === 'choice')!;
    const halfMaximumLabelWidth = 192 / 2;

    expect(route.labelX).toBeTypeOf('number');
    expect(route.labelX! - halfMaximumLabelWidth).toBeGreaterThanOrEqual(fromFrame.x + fromFrame.w);
    expect(route.labelX! + halfMaximumLabelWidth).toBeLessThanOrEqual(toFrame.x);
  });

  it('uses visibleBounds for default fit while retaining full bounds for hidden technical return routes', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const graph: FlowGraph = {
      nodes: [
        { id: 's:chapter', kind: 'scene', sceneId: 'chapter' },
        { id: 'l:chapter.start', kind: 'label', sceneId: 'chapter', label: 'start', line: 2 },
        { id: 'l:chapter.later', kind: 'label', sceneId: 'chapter', label: 'later', line: 20 },
      ],
      edges: [
        { from: 's:chapter', to: 'l:chapter.start', kind: 'flow' },
        { from: 'l:chapter.start', to: 'l:chapter.later', kind: 'flow' },
        { from: 'l:chapter.later', to: 'l:chapter.start', kind: 'choice', label: '重新考虑' },
        ...Array.from({ length: 16 }, (): FlowEdge => ({
          from: 'l:chapter.later',
          to: 'l:chapter.start',
          kind: 'goto',
        })),
      ],
    };
    const layout = buildNarrativeFlowLayout(graph, 'chapter');
    const technicalReturns = layout.routes.filter((route) => route.hiddenReason === 'choice-duplicate');

    expect(technicalReturns).toHaveLength(16);
    expect(layout.bounds.maxX).toBeGreaterThan(layout.visibleBounds.maxX);
    expect(layout.visibleBounds.minX).toBeGreaterThanOrEqual(layout.bounds.minX);
    expect(layout.visibleBounds.minY).toBeGreaterThanOrEqual(layout.bounds.minY);
    expect(layout.visibleBounds.maxY).toBeLessThanOrEqual(layout.bounds.maxY);
    expect(layout.width).toBe(layout.visibleBounds.maxX - layout.visibleBounds.minX);
    expect(layout.height).toBe(layout.visibleBounds.maxY - layout.visibleBounds.minY);

    const inside = (point: Point, bounds: NarrativeFlowLayout['bounds']): boolean => point.x >= bounds.minX
      && point.y >= bounds.minY
      && point.x <= bounds.maxX
      && point.y <= bounds.maxY;
    for (const route of layout.routes) {
      for (const point of route.points) expect(inside(point, layout.bounds)).toBe(true);
    }

    const flowPanelSource = readFileSync(flowPanelPath, 'utf8');
    expect(flowPanelSource).toMatch(
      /technicalEdgesVisible\s*\?\s*layout\.bounds\s*:\s*layout\.visibleBounds/,
    );
  });

  it('includes scene frames, orthogonal channels and attached labels in fit bounds', async () => {
    const { buildNarrativeFlowLayout } = await requireNarrativeLayout();
    const layout = buildNarrativeFlowLayout(fixtureGraph(), 'intro');
    const { bounds } = layout;
    const fitBounds: Rect = {
      x: bounds.minX,
      y: bounds.minY,
      w: bounds.maxX - bounds.minX,
      h: bounds.maxY - bounds.minY,
    };
    const insideBounds = (point: Point): boolean => point.x >= bounds.minX
      && point.y >= bounds.minY
      && point.x <= bounds.maxX
      && point.y <= bounds.maxY;

    for (const frame of layout.frames.values()) {
      expect(rectContainsRect(fitBounds, frame), `bounds omit frame ${frame.sceneId}`).toBe(true);
    }
    for (const route of layout.routes) {
      for (const point of route.points) {
        expect(insideBounds(point), `bounds omit route ${edgeKey(route.edge)}`).toBe(true);
      }
      if (route.label && route.labelX !== undefined && route.labelY !== undefined) {
        expect(insideBounds({ x: route.labelX, y: route.labelY }), `bounds omit label ${edgeKey(route.edge)}`).toBe(true);
      }
    }
  });
});
