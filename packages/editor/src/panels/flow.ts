/**
 * 流程图视图（E1a，只读导航版）：
 *  - 数据源：buildFlowGraph（lastValidation.scenes 编译产物 + collectConfigSceneRoots 宿主入口，
 *    与 CLI 同源；不重新解析源码）
 *  - 布局：场景维 BFS 分层为列，每场景一条泳道（入口节点 + 标签节点纵向排布）；自实现 SVG
 *  - 交互：拖拽平移 / 滚轮缩放（以光标为中心）；单击场景节点 → 切到块编辑视图；
 *    双击标签节点 → 切到该场景并滚动到 @label 行；当前场景高亮；error 红描边 / warning 黄角标
 *  - 渲染：视口裁剪（视口外节点不建 DOM；规模目标 100 场景 / 800 标签）
 */
import { state, h } from '../state.js';
import { collectConfigSceneRoots } from '@surdet/core';
import { buildFlowGraph, sceneNodeId } from '../graph/build.js';
import type { FlowGraph, FlowNode, FlowEdge } from '../graph/build.js';

/** 导航钩子（main.ts 注入：切回块编辑标签页并可滚动到指定行） */
let openSceneHook: (sceneKey: string, line?: number) => void = () => {};
export function bindFlowHooks(opts: { openScene: (sceneKey: string, line?: number) => void }): void {
  openSceneHook = opts.openScene;
}

/* ============================ 布局（纯计算） ============================ */

interface NodeBox { node: FlowNode; x: number; y: number; w: number; h: number }
interface FlowLayout { boxes: Map<string, NodeBox>; width: number; height: number }

const NODE_H = 26;
const LANE_PAD = 10;
const LANE_GAP = 36;
const COL_GAP = 90;
const NODE_PAD_X = 14;

/** 节点宽度随文本自适应（CJK 按全角估宽） */
function nodeWidth(text: string): number {
  let w = NODE_PAD_X * 2;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? 13 : 7.5;
  return Math.max(84, Math.min(260, Math.ceil(w)));
}

function nodeText(node: FlowNode): string {
  if (node.kind === 'label') return `@label ${node.label ?? ''}`;
  if (node.kind === 'host-entry') return `⚙ ${node.sceneId}（宿主入口）`;
  return node.sceneId;
}

/** 场景维 BFS 深度：entryScene 为根；宿主入口场景与不可达场景另行归列 */
function sceneDepths(graph: FlowGraph, entryScene: string): Map<string, number> {
  const sceneIds = graph.nodes.filter((n) => n.kind === 'scene').map((n) => n.sceneId);
  const adj = new Map<string, Set<string>>();
  for (const id of sceneIds) adj.set(id, new Set());
  for (const e of graph.edges) {
    if (e.kind !== 'jump' && e.kind !== 'call') continue;
    const from = graph.nodes.find((n) => n.id === e.from);
    const to = graph.nodes.find((n) => n.id === e.to);
    if (!from || !to) continue;
    if (from.sceneId === to.sceneId) continue;
    if (!adj.has(from.sceneId)) adj.set(from.sceneId, new Set());
    adj.get(from.sceneId)!.add(to.sceneId);
  }
  const depth = new Map<string, number>();
  const entry = sceneIds.includes(entryScene) ? entryScene : sceneIds[0];
  if (entry) {
    depth.set(entry, 0);
    const queue = [entry];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nx of adj.get(cur) ?? []) {
        if (!depth.has(nx)) { depth.set(nx, depth.get(cur)! + 1); queue.push(nx); }
      }
    }
  }
  const hostScenes = new Set(graph.nodes.filter((n) => n.kind === 'host-entry').map((n) => n.sceneId));
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const id of sceneIds) {
    if (!depth.has(id)) depth.set(id, hostScenes.has(id) ? 0 : maxDepth + 1);
  }
  return depth;
}

/** 分层泳道布局：列 = BFS 深度；列内每场景一条泳道（入口 + 标签纵向） */
export function layoutFlowGraph(graph: FlowGraph, entryScene: string): FlowLayout {
  const boxes = new Map<string, NodeBox>();
  if (graph.nodes.length === 0) return { boxes, width: 0, height: 0 };

  const depth = sceneDepths(graph, entryScene);
  const sceneOrder = graph.nodes.filter((n) => n.kind === 'scene').map((n) => n.sceneId);
  const byDepth = new Map<number, string[]>();
  for (const id of sceneOrder) {
    const d = depth.get(id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  // 场景 → 场景内节点（入口 + 标签按行号）
  const laneNodes = new Map<string, FlowNode[]>();
  for (const sid of sceneOrder) {
    const ns = graph.nodes.filter((n) => n.sceneId === sid && (n.kind === 'scene' || n.kind === 'label'));
    ns.sort((a, b) => (a.kind === 'scene' ? -1 : b.kind === 'scene' ? 1 : (a.line ?? 0) - (b.line ?? 0)));
    laneNodes.set(sid, ns);
  }

  let x = LANE_PAD;
  let totalHeight = 0;
  for (const d of depths) {
    const scenes = byDepth.get(d)!;
    // 泳道宽度 = 列内最宽节点
    let colW = 0;
    for (const sid of scenes) for (const n of laneNodes.get(sid)!) colW = Math.max(colW, nodeWidth(nodeText(n)));
    let y = LANE_PAD;
    for (const sid of scenes) {
      for (const n of laneNodes.get(sid)!) {
        const w = nodeWidth(nodeText(n));
        boxes.set(n.id, { node: n, x: x + (colW - w) / 2, y, w, h: NODE_H });
        y += NODE_H + 8;
      }
      y += LANE_GAP; // 泳道间距
    }
    // 宿主入口节点：置于目标场景泳道左侧
    for (const n of graph.nodes.filter((nn) => nn.kind === 'host-entry' && depth.get(nn.sceneId) === d)) {
      const target = boxes.get(sceneNodeId(n.sceneId));
      if (target) {
        const w = nodeWidth(nodeText(n));
        boxes.set(n.id, { node: n, x: target.x, y: target.y - NODE_H - 14, w, h: NODE_H });
      }
    }
    totalHeight = Math.max(totalHeight, y);
    x += colW + COL_GAP;
  }
  return { boxes, width: x, height: totalHeight + LANE_PAD };
}

/* ============================ 校验状态映射 ============================ */

/** 场景 → error/warning 计数（issues.file 按 basename 对齐场景 ID，与 renderIssue 跳转同规则） */
function sceneIssueStats(): Map<string, { errors: number; warnings: number }> {
  const stats = new Map<string, { errors: number; warnings: number }>();
  for (const issue of state.lastValidation?.issues ?? []) {
    const base = (issue.file.replace(/\.gal$/, '').split('/').pop() ?? issue.file) || issue.file;
    const s = stats.get(base) ?? { errors: 0, warnings: 0 };
    if (issue.severity === 'error') s.errors++; else s.warnings++;
    stats.set(base, s);
  }
  return stats;
}

/* ============================ 渲染 ============================ */

const NS = 'http://www.w3.org/2000/svg';
/** 视图变换（平移/缩放）：跨重渲染保持 */
const view = { k: 1, tx: 30, ty: 30 };

const EDGE_COLORS: Record<FlowEdge['kind'], string> = {
  flow: '#39415a', goto: '#6a7ba8', jump: '#5a8fd0', call: '#7a6aa8',
  switch: '#c8a05a', loop: '#d08a4a', choice: '#4aa890', if: '#a06a8a', host: '#d0b060',
};

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag);
}

function edgePath(a: NodeBox, b: NodeBox): string {
  if (b.x >= a.x + a.w - 1) {
    // 向右：右侧中点 → 左侧中点（贝塞尔）
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    const dx = Math.max(30, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  if (Math.abs(b.x - a.x) < 2) {
    // 同列纵向（泳道内顺序流 / 宿主入口）
    const down = b.y >= a.y;
    const x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y;
    const x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + b.h;
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  // 回边（loop 等）：绕下方
  const x1 = a.x + a.w / 2, y1 = a.y + a.h;
  const x2 = b.x + b.w / 2, y2 = b.y + b.h;
  const dy = Math.max(y1, y2) + 34;
  return `M ${x1} ${y1} C ${x1} ${dy}, ${x2} ${dy}, ${x2} ${y2}`;
}

function currentGraph(): FlowGraph {
  const scenes = state.lastValidation?.scenes ?? new Map();
  const roots = collectConfigSceneRoots(state.configFiles);
  return buildFlowGraph(scenes, roots);
}

/** 场景 Map key（相对路径）← 场景 ID 反查 */
function sceneKeyById(sceneId: string): string | null {
  for (const [key, sc] of state.scenes) if (sc.id === sceneId) return key;
  return null;
}

function drawNode(world: SVGElement, box: NodeBox, stats: Map<string, { errors: number; warnings: number }>): void {
  const { node } = box;
  const g = el('g');
  g.style.cursor = 'pointer';
  const rect = el('rect');
  rect.setAttribute('x', String(box.x));
  rect.setAttribute('y', String(box.y));
  rect.setAttribute('width', String(box.w));
  rect.setAttribute('height', String(box.h));
  rect.setAttribute('rx', node.kind === 'host-entry' ? '3' : '6');
  const isCurrent = state.current !== null && state.scenes.get(state.current)?.id === node.sceneId;
  const issue = stats.get(node.sceneId);
  rect.setAttribute('fill', node.kind === 'host-entry' ? '#241f12' : node.kind === 'scene' ? '#1c2438' : '#161d2e');
  if (node.kind === 'host-entry') {
    rect.setAttribute('stroke', '#d0b060');
    rect.setAttribute('stroke-dasharray', '5 3');
  } else if (issue && issue.errors > 0) {
    rect.setAttribute('stroke', '#e06060');
    rect.setAttribute('stroke-width', '2');
  } else {
    rect.setAttribute('stroke', isCurrent ? '#ffe8c8' : '#2a3248');
    if (isCurrent) rect.setAttribute('stroke-width', '2');
  }
  const text = el('text');
  text.setAttribute('x', String(box.x + box.w / 2));
  text.setAttribute('y', String(box.y + box.h / 2 + 4));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '11');
  text.setAttribute('fill', isCurrent ? '#ffe8c8' : node.kind === 'host-entry' ? '#d0b060' : '#dfe4f0');
  const label = nodeText(node);
  text.textContent = label.length > 26 ? label.slice(0, 25) + '…' : label;
  const title = el('title');
  title.textContent = node.kind === 'label' ? `${node.sceneId} · @label ${node.label}（双击跳转）` : node.sceneId;
  g.append(rect, text, title);

  // warning 角标（error 已用红描边表达）
  if (issue && issue.errors === 0 && issue.warnings > 0) {
    const badge = el('circle');
    badge.setAttribute('cx', String(box.x + box.w - 4));
    badge.setAttribute('cy', String(box.y + 4));
    badge.setAttribute('r', '4');
    badge.setAttribute('fill', '#e0c050');
    g.appendChild(badge);
  }

  g.addEventListener('click', (e) => {
    e.stopPropagation();
    const key = sceneKeyById(node.sceneId);
    if (key) openSceneHook(key);
  });
  g.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const key = sceneKeyById(node.sceneId);
    if (key) openSceneHook(key, node.kind === 'label' ? node.line : undefined);
  });
  world.appendChild(g);
}

function drawEdge(world: SVGElement, edge: FlowEdge, boxes: Map<string, NodeBox>): void {
  const a = boxes.get(edge.from);
  const b = boxes.get(edge.to);
  if (!a || !b) return; // 悬空目标（未编译场景）不画，lint 会报
  const path = el('path');
  path.setAttribute('d', edgePath(a, b));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', EDGE_COLORS[edge.kind]);
  path.setAttribute('stroke-width', edge.kind === 'flow' ? '1' : '1.5');
  if (edge.kind === 'call' || edge.kind === 'host') path.setAttribute('stroke-dasharray', '6 4');
  world.appendChild(path);
  if (edge.label) {
    const mid = el('text');
    mid.setAttribute('x', String((a.x + a.w + b.x) / 2));
    mid.setAttribute('y', String((a.y + b.y) / 2 + (a.h + b.h) / 4 - 4));
    mid.setAttribute('text-anchor', 'middle');
    mid.setAttribute('font-size', '10');
    mid.setAttribute('fill', '#9fb0c8');
    const t = edge.label.length > 22 ? edge.label.slice(0, 21) + '…' : edge.label;
    mid.textContent = t;
    const title = el('title');
    title.textContent = edge.label;
    mid.appendChild(title);
    world.appendChild(mid);
  }
}

/** 渲染流程图到容器（视口裁剪：只为可见范围内的节点/边建 DOM） */
export function renderFlow(container: HTMLElement): void {
  container.innerHTML = '';
  const graph = currentGraph();
  const layout = layoutFlowGraph(graph, state.entryScene);
  const stats = sceneIssueStats();

  const cw = container.clientWidth || 800;
  const ch = container.clientHeight || 600;
  const svg = el('svg');
  svg.setAttribute('width', String(cw));
  svg.setAttribute('height', String(ch));
  svg.style.display = 'block';
  svg.style.background = '#0d1117';
  const world = el('g');
  world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
  svg.appendChild(world);

  // 视口对应的世界坐标矩形（裁剪用）
  const vx0 = -view.tx / view.k, vy0 = -view.ty / view.k;
  const vx1 = vx0 + cw / view.k, vy1 = vy0 + ch / view.k;
  const visible = (b: NodeBox): boolean => b.x + b.w >= vx0 && b.x <= vx1 && b.y + b.h >= vy0 && b.y <= vy1;

  // 先边后节点（节点盖住线头）
  for (const edge of graph.edges) {
    const a = layout.boxes.get(edge.from);
    const b = layout.boxes.get(edge.to);
    if (!a || !b) continue;
    // 边的粗略可见性：两端点包围盒与视口相交
    const ex0 = Math.min(a.x, b.x), ex1 = Math.max(a.x + a.w, b.x + b.w);
    const ey0 = Math.min(a.y, b.y), ey1 = Math.max(a.y + a.h, b.y + b.h) + 40;
    if (ex1 < vx0 || ex0 > vx1 || ey1 < vy0 || ey0 > vy1) continue;
    drawEdge(world, edge, layout.boxes);
  }
  for (const box of layout.boxes.values()) {
    if (!visible(box)) continue;
    drawNode(world, box, stats);
  }

  if (graph.nodes.length === 0) {
    const hint = h('div', 'empty', '暂无编译产物：打开项目后流程图从校验编译产物生成');
    hint.style.position = 'absolute';
    hint.style.top = '40%';
    hint.style.width = '100%';
    hint.style.textAlign = 'center';
    container.appendChild(hint);
  }

  // 滚轮缩放（以光标为中心）
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const k2 = Math.max(0.2, Math.min(3, view.k * factor));
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    // 保持光标处世界坐标不动：w = (p - t) / k
    view.tx = px - ((px - view.tx) / view.k) * k2;
    view.ty = py - ((py - view.ty) / view.k) * k2;
    view.k = k2;
    renderFlow(container);
  }, { passive: false });

  // 拖拽平移（背景按下；节点点击已 stopPropagation）
  let panning: { x: number; y: number; tx: number; ty: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    panning = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!panning) return;
    view.tx = panning.tx + (e.clientX - panning.x);
    view.ty = panning.ty + (e.clientY - panning.y);
    world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
  });
  const endPan = (): void => { panning = null; };
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);

  container.appendChild(svg);
}

/** 校验完成/切换后刷新（仅当前处于流程图标签页时） */
export function refreshFlowIfVisible(): void {
  if (state.mainTab !== 'flow') return;
  const c = document.getElementById('flow-view');
  if (c) renderFlow(c);
}
