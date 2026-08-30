/**
 * 流程图视图（E1a 只读导航 + E1b 交互编辑）：
 *  - 数据源：buildFlowGraph（lastValidation.scenes 编译产物 + collectConfigSceneRoots 宿主入口，
 *    与 CLI 同源；不重新解析源码）
 *  - 布局：场景维 BFS 分层为列，每场景一条泳道（入口节点 + 标签节点纵向排布）；自实现 SVG
 *  - 交互（E1a）：拖拽平移 / 滚轮缩放（以光标为中心）；单击场景节点 → 切到块编辑视图；
 *    单击标签节点 → 切到该场景并滚动到 @label 行；当前场景与校验状态均有文字和边界反馈
 *  - 交互（E1b）：从节点拖到另一节点 → 在源场景末尾插入 @jump/@goto（走 history 可 undo）；
 *    右键场景节点 → 重命名（引用同步改写）/ 删除（引用检查警告）
 *  - 渲染：视口裁剪（视口外节点不建 DOM；规模目标 100 场景 / 800 标签）
 */
import { state, h, setStatus } from '../state.js';
import { collectConfigSceneRoots } from '@surdet/core';
import { buildFlowGraph, sceneNodeId } from '../graph/build.js';
import type { FlowGraph, FlowNode, FlowEdge } from '../graph/build.js';
import { setSceneText } from '../history.js';
import { renderSidebar } from './sidebar.js';
import {
  flowEdgeKindLabel,
  flowValidationStateLabel,
  presentFlowEdge,
  presentFlowNode,
} from '../flow-presentation.js';

/** 导航钩子（main.ts 注入）：切回块编辑标签页并可滚动到指定行；requestValidate 触发重校验 */
let openSceneHook: (sceneKey: string, line?: number) => void = () => {};
let requestValidateHook: () => void = () => {};
export function bindFlowHooks(opts: {
  openScene: (sceneKey: string, line?: number) => void;
  requestValidate: () => void;
}): void {
  openSceneHook = opts.openScene;
  requestValidateHook = opts.requestValidate;
}

/* ============================ 纯函数助手（可单测） ============================ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 跨场景引用行级改写：只改 @jump/@call 的目标 token（行首指令位置），不误伤台词文本 */
export function rewriteSceneRefs(text: string, oldId: string, newId: string): string {
  const re = new RegExp(`^([ \\t]*@(?:jump|call)[ \\t]+)${escapeRe(oldId)}(?=[.\\s]|$)`, 'gm');
  return text.replace(re, `$1${newId}`);
}

/** 统计场景被 @jump/@call 引用次数（删除前检查用） */
export function countSceneRefs(text: string, sceneId: string): number {
  const re = new RegExp(`^[ \\t]*@(?:jump|call)[ \\t]+${escapeRe(sceneId)}(?=[.\\s]|$)`, 'gm');
  return (text.match(re) ?? []).length;
}

/** 构造拖拽建链的插入行：同场景 → @goto 标签（场景开头 → @jump 本场景）；跨场景 → @jump 场景[.标签] */
export function buildJumpLine(from: FlowNode, to: FlowNode): string {
  if (from.sceneId === to.sceneId) {
    return to.kind === 'label' ? `@goto ${to.label ?? ''}` : `@jump ${to.sceneId}`;
  }
  return to.kind === 'label' ? `@jump ${to.sceneId}.${to.label ?? ''}` : `@jump ${to.sceneId}`;
}

/** 场景文本末尾追加行：纯函数已拆至 scene-text.ts（断模块循环依赖，M4 审阅轮 Minor 1）；保留重导出稳定公开 API */
import { appendLineToScene } from '../scene-text.js';
export { appendLineToScene };

/* ============================ 布局（纯计算） ============================ */

export interface NodeBox { node: FlowNode; x: number; y: number; w: number; h: number }
interface FlowLayout { boxes: Map<string, NodeBox>; width: number; height: number }

const NODE_H = 44;
const LANE_PAD = 10;
const LANE_GAP = 36;
const COL_GAP = 90;
const NODE_PAD_X = 14;

/** 节点宽度随文本自适应（CJK 按全角估宽） */
function nodeWidth(text: string): number {
  let w = NODE_PAD_X * 2;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e7f ? 13 : 7.5;
  return Math.max(84, Math.min(280, Math.ceil(w)));
}

function visualTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.62;
  return units * fontSize;
}

function truncateTextToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (visualTextWidth(text, fontSize) <= maxWidth) return text;
  let result = '';
  for (const ch of text) {
    if (visualTextWidth(`${result}${ch}…`, fontSize) > maxWidth) break;
    result += ch;
  }
  return `${result}…`;
}

function nodeText(node: FlowNode): string {
  return presentFlowNode(node).primaryText;
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
  const scenesWithHostEntry = new Set(
    graph.nodes.filter((node) => node.kind === 'host-entry').map((node) => node.sceneId),
  );
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
      // 宿主入口画在目标场景上方。先在当前泳道内为它保留完整高度，
      // 避免入口节点向上侵入同列的上一条场景泳道。
      if (scenesWithHostEntry.has(sid)) y += NODE_H + 14;
      for (const n of laneNodes.get(sid)!) {
        const w = nodeWidth(nodeText(n));
        boxes.set(n.id, { node: n, x: x + (colW - w) / 2, y, w, h: NODE_H });
        y += NODE_H + 8;
      }
      y += LANE_GAP; // 泳道间距
    }
    // 宿主入口节点：置于目标场景泳道上方
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

  // 顶部越界保护（验收轮 Minor3）：宿主入口节点画在目标场景上方，列首行场景的 host 节点
  // 可能落在负坐标（默认视口下贴边/出画）；整体下移保证全部节点可见，相对布局不变
  let minY = Infinity;
  for (const b of boxes.values()) minY = Math.min(minY, b.y);
  if (Number.isFinite(minY) && minY < LANE_PAD) {
    const dy = LANE_PAD - minY;
    for (const b of boxes.values()) b.y += dy;
    totalHeight += dy;
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

/* ============================ 场景操作（E1b） ============================ */

/** 场景 Map key（相对路径）← 场景 ID 反查 */
function sceneKeyById(sceneId: string): string | null {
  for (const [key, sc] of state.scenes) if (sc.id === sceneId) return key;
  return null;
}

/** 重命名场景：内存改名 + 全部场景引用同步改写 + 句柄置空（保存时落新名）；
 *  平坦路径（content/scenario 直属）尝试删除旧盘上文件；子目录场景提示手动处理。 */
export async function renameScene(sceneId: string): Promise<void> {
  const input = window.prompt(`重命名场景 '${sceneId}'（文件名，不含 .gal）`, sceneId);
  if (!input) return;
  const newId = input.trim();
  if (!/^[^\s.]+$/.test(newId)) { setStatus('场景 ID 非法（不能含空格/点号）', false, 4000); return; }
  if (newId === sceneId) return;
  if ([...state.scenes.values()].some((s) => s.id === newId)) {
    setStatus(`场景 '${newId}' 已存在`, false, 4000);
    return;
  }
  const key = sceneKeyById(sceneId);
  if (!key) return;

  // 引用改写（含自身场景内的 @jump/@call 自引用）
  let refCount = 0;
  for (const sc of state.scenes.values()) {
    const next = rewriteSceneRefs(sc.text, sceneId, newId);
    if (next !== sc.text) { sc.text = next; sc.dirty = true; refCount++; }
  }
  const sc = state.scenes.get(key)!;
  // @scene 声明行同步（锁定行首：不误伤台词/注释中恰好出现的字面 '@scene 旧名'；验收轮 Minor2 修复）
  sc.text = sc.text.replace(new RegExp(`^([ \\t]*)@scene[ \\t]+${escapeRe(sceneId)}(?=\\s|$)`, 'gm'), `$1@scene ${newId}`);
  sc.dirty = true;
  sc.id = newId;
  sc.file = sc.file.replace(new RegExp(`${escapeRe(sceneId)}\\.gal$`), `${newId}.gal`);

  // Map 重键（保持插入顺序）
  const prefix = key.slice(0, key.length - sceneId.length);
  const newKey = prefix + newId;
  const entries = [...state.scenes.entries()].map(([k, v]) => (k === key ? [newKey, v] as const : [k, v] as const));
  state.scenes = new Map(entries);
  if (state.current === key) state.current = newKey;

  // 盘上旧文件清理（仅平坦路径；句柄置空后保存会创建新名文件）
  const flat = !key.includes('/');
  if (sc.handle && state.dirHandle && flat) {
    sc.handle = null;
    try {
      const contentDir = await state.dirHandle.getDirectoryHandle('content');
      const scenarioDir = await contentDir.getDirectoryHandle('scenario');
      await (scenarioDir as unknown as { removeEntry: (n: string) => Promise<void> }).removeEntry(`${sceneId}.gal`);
    } catch (err) {
      setStatus(`重命名已生效，但旧文件 ${sceneId}.gal 删除失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    }
  } else if (sc.handle && !flat) {
    sc.handle = null;
    setStatus(`子目录场景重命名：内存已改名，请手动重命名盘上文件 ${sceneId}.gal → ${newId}.gal`, false, 6000);
  }

  setStatus(`场景已重命名 ${sceneId} → ${newId}（同步改写 ${refCount} 处引用；保存后落盘）`, true, 5000);
  renderSidebar();
  requestValidateHook();
}

/** 删除场景：引用检查（有入边时确认）→ 移出内存 → 平坦路径删除盘上文件 */
export async function deleteScene(sceneId: string): Promise<void> {
  const key = sceneKeyById(sceneId);
  if (!key) return;
  let refs = 0;
  for (const [k, sc] of state.scenes) {
    if (k === key) continue;
    refs += countSceneRefs(sc.text, sceneId);
  }
  if (refs > 0 && !window.confirm(`场景 '${sceneId}' 被 ${refs} 处 @jump/@call 引用，删除将产生悬空引用（lint 会报 J001）。确定删除？`)) {
    return;
  }
  const sc = state.scenes.get(key)!;
  state.scenes.delete(key);
  if (state.current === key) state.current = [...state.scenes.keys()][0] ?? null;

  if (sc.handle && state.dirHandle && !key.includes('/')) {
    try {
      const contentDir = await state.dirHandle.getDirectoryHandle('content');
      const scenarioDir = await contentDir.getDirectoryHandle('scenario');
      await (scenarioDir as unknown as { removeEntry: (n: string) => Promise<void> }).removeEntry(`${sceneId}.gal`);
    } catch (err) {
      setStatus(`场景已从编辑器移除，但盘上文件删除失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    }
  }
  setStatus(`已删除场景 '${sceneId}'`, true, 4000);
  renderSidebar();
  requestValidateHook();
}

/* ============================ 渲染 ============================ */

const NS = 'http://www.w3.org/2000/svg';
/** 视图变换（平移/缩放）：跨重渲染保持 */
const view = { k: 1, tx: 30, ty: 30 };
let legendExpanded = true;

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag);
}

/** 边几何：路径 + 标签位置。
 *  sameLane 由调用方按“同一场景”判定（不能比 x：同泳道节点宽度不同居中后 x 不同，
 *  验收反馈三轮的错位根因即误判为跨列回边） */
const BULGE = 30;
export function edgeGeometry(a: NodeBox, b: NodeBox, kind: FlowEdge['kind'], sameLane: boolean, dy = 0): { d: string; lx: number; ly: number } {
  if (sameLane) {
    if (kind === 'flow' || kind === 'host') {
      // 同泳道相邻单元的顺序流 / 宿主入口：近直线（节点宽度不同居中 x 略差，端点取各自中点）
      const down = b.y >= a.y;
      const x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y;
      const x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + b.h;
      return { d: `M ${x1} ${y1} L ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 };
    }
    // 同泳道跨单元（choice/goto/loop/if）：向右鼓出弧线，与顺序流细线分离；标签在弧线顶点
    const x1 = a.x + a.w, y1 = a.y + a.h / 2;
    const y2 = b.y + b.h / 2;
    const cx = x1 + BULGE;
    return {
      d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${b.x + b.w} ${y2}`,
      lx: x1 + BULGE * 0.75,
      ly: (y1 + y2) / 2,
    };
  }
  if (b.x >= a.x + a.w - 1) {
    // 向右跨列：右缘中点 → 左缘中点（贝塞尔），标签在列间空隙；dy 为汇聚落点分散偏移
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2 + dy;
    const dx = Math.max(30, (x2 - x1) / 2);
    return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 };
  }
  // 跨列回边（向左）：绕下方
  const x1 = a.x + a.w / 2, y1 = a.y + a.h;
  const x2 = b.x + b.w / 2, y2 = b.y + b.h;
  const dipY = Math.max(y1, y2) + 34;
  return { d: `M ${x1} ${y1} C ${x1} ${dipY}, ${x2} ${dipY}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: dipY - 8 };
}

/** 待绘制的边标签（收集后在节点之上统一绘制，保证不被节点遮挡） */
export interface EdgeLabelDraw { lx: number; ly: number; text: string; full: string; kind: FlowEdge['kind'] }

const EDGE_KINDS: FlowEdge['kind'][] = ['flow', 'goto', 'jump', 'call', 'switch', 'loop', 'choice', 'if', 'host'];

/** 箭头与编辑台刻度均只声明结构，颜色和线型由主题 CSS 提供。 */
function buildFlowDefs(): SVGDefsElement {
  const defs = el('defs');
  for (const kind of EDGE_KINDS) {
    const m = el('marker');
    m.setAttribute('id', `flow-arrow-${kind}`);
    m.setAttribute('viewBox', '0 0 10 10');
    m.setAttribute('refX', '8.5');
    m.setAttribute('refY', '5');
    m.setAttribute('markerWidth', '7');
    m.setAttribute('markerHeight', '7');
    m.setAttribute('orient', 'auto-start-reverse');
    m.classList.add('flow-arrow', `flow-arrow--${kind}`);
    const p = el('path');
    p.setAttribute('d', 'M 0 1 L 9 5 L 0 9 z');
    p.classList.add('flow-arrow-shape');
    m.appendChild(p);
    defs.appendChild(m);
  }
  const grid = el('pattern');
  grid.setAttribute('id', 'flow-grid');
  grid.setAttribute('width', '26');
  grid.setAttribute('height', '26');
  grid.setAttribute('patternUnits', 'userSpaceOnUse');
  const dot = el('circle');
  dot.setAttribute('cx', '1.3');
  dot.setAttribute('cy', '1.3');
  dot.setAttribute('r', '1.3');
  dot.classList.add('flow-grid-mark');
  grid.appendChild(dot);
  defs.appendChild(grid);
  return defs;
}

function rerenderFlow(container: HTMLElement, focusSelector?: string): void {
  renderFlow(container);
  if (!focusSelector) return;
  const nextFocus = container.querySelector<HTMLElement>(focusSelector);
  nextFocus?.focus({ preventScroll: true });
}

export interface MinimapClientMapping {
  left: number;
  top: number;
  renderedWidth: number;
  renderedHeight: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
  worldScale: number;
  worldPadding: number;
}

/**
 * 把压缩后的小地图 CSS 坐标映射回流程世界坐标。
 * SVG 的 width/height 会在窄屏被 CSS 独立约束，不能直接拿客户端像素除以世界比例。
 */
export function minimapClientToWorld(
  clientX: number,
  clientY: number,
  mapping: MinimapClientMapping,
): { x: number; y: number } {
  const renderedWidth = Math.max(1, mapping.renderedWidth);
  const renderedHeight = Math.max(1, mapping.renderedHeight);
  const intrinsicX = ((clientX - mapping.left) / renderedWidth) * mapping.intrinsicWidth;
  const intrinsicY = ((clientY - mapping.top) / renderedHeight) * mapping.intrinsicHeight;
  return {
    x: intrinsicX / mapping.worldScale - mapping.worldPadding,
    y: intrinsicY / mapping.worldScale - mapping.worldPadding,
  };
}

/** UI 第三阶段：小地图（全节点概览 + 当前视口框；点击居中导航） */
function buildMinimap(layout: FlowLayout, cw: number, ch: number, container: HTMLElement): SVGElement | null {
  if (layout.boxes.size === 0) return null;
  const pad = 40;
  const worldW = layout.width + pad * 2;
  const worldH = layout.height + pad * 2;
  const s = Math.min(180 / worldW, 140 / worldH);
  const w = Math.max(60, worldW * s);
  const hgt = Math.max(44, worldH * s);
  const mm = el('svg');
  mm.setAttribute('width', String(Math.round(w)));
  mm.setAttribute('height', String(Math.round(hgt)));
  mm.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  mm.setAttribute('preserveAspectRatio', 'none');
  mm.classList.add('flow-minimap');
  mm.setAttribute('data-editor-region', 'flow-minimap');
  mm.setAttribute('role', 'button');
  mm.setAttribute('tabindex', '0');
  mm.setAttribute('aria-label', '流程缩略图，点击可把对应位置移到画布中央');
  const toMm = (x: number, y: number): { x: number; y: number } => ({ x: (x + pad) * s, y: (y + pad) * s });
  // 节点概览仅表达当前位置；具体颜色由语义样式提供。
  for (const b of layout.boxes.values()) {
    const r = el('rect');
    const p = toMm(b.x, b.y);
    r.setAttribute('x', String(p.x));
    r.setAttribute('y', String(p.y));
    r.setAttribute('width', String(Math.max(2, b.w * s)));
    r.setAttribute('height', String(Math.max(1.5, b.h * s)));
    const isCur = state.current !== null && b.node.kind === 'scene' && state.scenes.get(state.current)?.id === b.node.sceneId;
    r.classList.add('flow-minimap-node');
    if (isCur) r.classList.add('is-current');
    mm.appendChild(r);
  }
  // 当前视口框（屏幕窗口在世界坐标的投影）
  const vp0 = toMm(-view.tx / view.k, -view.ty / view.k);
  const vp = el('rect');
  vp.setAttribute('x', String(vp0.x));
  vp.setAttribute('y', String(vp0.y));
  vp.setAttribute('width', String((cw / view.k) * s));
  vp.setAttribute('height', String((ch / view.k) * s));
  vp.classList.add('flow-minimap-viewport');
  mm.appendChild(vp);
  const focusPoint = (clientX: number, clientY: number, restoreKeyboardFocus = false): void => {
    const rect = mm.getBoundingClientRect();
    const worldPoint = minimapClientToWorld(clientX, clientY, {
      left: rect.left,
      top: rect.top,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      intrinsicWidth: w,
      intrinsicHeight: hgt,
      worldScale: s,
      worldPadding: pad,
    });
    view.tx = cw / 2 - worldPoint.x * view.k;
    view.ty = ch / 2 - worldPoint.y * view.k;
    rerenderFlow(container, restoreKeyboardFocus ? '[data-editor-region="flow-minimap"]' : undefined);
  };
  mm.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    focusPoint(e.clientX, e.clientY);
  });
  mm.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const rect = mm.getBoundingClientRect();
    focusPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
  };
  return mm;
}

function drawEdge(world: SVGElement, edge: FlowEdge, boxes: Map<string, NodeBox>, labelsOut: EdgeLabelDraw[], dy = 0): void {
  const a = boxes.get(edge.from);
  const b = boxes.get(edge.to);
  if (!a || !b) return; // 悬空目标（未编译场景）不画，lint 会报
  // 同泳道 = 同一场景（节点宽度不同居中后 x 不同，不能用 x 判断）
  const sameLane = a.node.sceneId === b.node.sceneId && a.node.kind !== 'host-entry' && b.node.kind !== 'host-entry';
  const geo = edgeGeometry(a, b, edge.kind, sameLane, dy);
  const path = el('path');
  path.setAttribute('d', geo.d);
  path.classList.add('flow-edge', `flow-edge--${edge.kind}`);
  path.setAttribute('data-flow-edge-kind', edge.kind);
  path.setAttribute('marker-end', `url(#flow-arrow-${edge.kind})`);
  const edgePresentation = presentFlowEdge(edge);
  path.setAttribute('aria-label', `${edgePresentation.kindLabel}，${edgePresentation.technicalText}`);
  const title = el('title');
  title.textContent = `技术信息：${edgePresentation.technicalText}`;
  path.appendChild(title);
  world.appendChild(path);
  if (edge.label) {
    const text = edgePresentation.displayText;
    labelsOut.push({
      lx: geo.lx,
      ly: geo.ly,
      text,
      full: edgePresentation.technicalText,
      kind: edge.kind,
    });
  }
}

/** 边标签顶层绘制（在全部节点之后调用，保证内容可读）。 */
function drawEdgeLabels(world: SVGElement, labels: EdgeLabelDraw[]): void {
  for (const L of labels) {
    const visibleText = truncateTextToWidth(L.text, 220, 10);
    const labelW = Math.min(232, visualTextWidth(visibleText, 10) + 12);
    const bg = el('rect');
    bg.setAttribute('x', String(L.lx - labelW / 2));
    bg.setAttribute('y', String(L.ly - 8));
    bg.setAttribute('width', String(labelW));
    bg.setAttribute('height', '14');
    bg.setAttribute('rx', '4');
    bg.classList.add('flow-edge-label-surface', `flow-edge-label-surface--${L.kind}`);
    const mid = el('text');
    mid.setAttribute('x', String(L.lx));
    mid.setAttribute('y', String(L.ly + 3));
    mid.setAttribute('text-anchor', 'middle');
    mid.classList.add('flow-edge-label', `flow-edge-label--${L.kind}`);
    mid.textContent = visibleText;
    const title = el('title');
    title.textContent = `技术信息：${L.full}`;
    mid.appendChild(title);
    world.append(bg, mid);
  }
}

function currentGraph(): FlowGraph {
  const scenes = state.lastValidation?.scenes ?? new Map();
  const roots = collectConfigSceneRoots(state.configFiles);
  return buildFlowGraph(scenes, roots);
}

/** 拖拽建链的插入动作（源节点 → 目标节点；写入源场景末尾，走 history 可 undo） */
function createLink(fromNode: FlowNode, toNode: FlowNode): void {
  const sceneKey = sceneKeyById(fromNode.sceneId);
  const sc = sceneKey ? state.scenes.get(sceneKey) : undefined;
  if (!sceneKey || !sc) {
    setStatus(`无法定位源场景 '${fromNode.sceneId}'（宿主入口不可编辑）`, false, 4000);
    return;
  }
  const line = buildJumpLine(fromNode, toNode);
  setSceneText(sceneKey, appendLineToScene(sc.text, sc.eol, line));
  setStatus(`已为场景“${fromNode.sceneId}”新增剧情跳转，可撤销；校验稍后刷新`, true, 4000);
  renderSidebar();
}

/** 右键上下文菜单（简单 DOM 浮层） */
let menuOutsideHandler: ((e: PointerEvent) => void) | null = null;
let menuReturnFocus: SVGElement | null = null;

function showSceneMenu(container: HTMLElement, sceneId: string, cx: number, cy: number, returnFocus: SVGElement): void {
  closeSceneMenu();
  menuReturnFocus = returnFocus;
  const menu = h('div', 'flow-menu');
  menu.id = 'flow-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `场景 ${sceneId} 的操作`);
  const rename = h('button', undefined, '重命名场景…');
  rename.setAttribute('role', 'menuitem');
  rename.onclick = () => { closeSceneMenu(); void renameScene(sceneId).then(() => refreshFlowIfVisible()); };
  const del = h('button', undefined, '删除场景…');
  del.setAttribute('role', 'menuitem');
  del.onclick = () => { closeSceneMenu(); void deleteScene(sceneId).then(() => refreshFlowIfVisible()); };
  menu.append(rename, del);
  const rect = container.getBoundingClientRect();
  container.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(cx - rect.left, rect.width - menuRect.width - 8));
  const top = Math.max(8, Math.min(cy - rect.top, rect.height - menuRect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const items = [rename, del];
  menu.addEventListener('keydown', (e) => {
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSceneMenu(true);
      return;
    }
    const nextIndex = e.key === 'ArrowDown'
      ? (currentIndex + 1) % items.length
      : e.key === 'ArrowUp'
        ? (currentIndex - 1 + items.length) % items.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : -1;
    if (nextIndex >= 0) {
      e.preventDefault();
      items[nextIndex]!.focus();
    }
  });
  rename.focus();
  // 点菜单外部才关闭（验收反馈：原实现任意 pointerdown 都关，按钮还没收到 click 菜单就被删了）；
  // 延迟一帧绑定，避开打开菜单那次右键的 pointerdown
  setTimeout(() => {
    menuOutsideHandler = (e: PointerEvent) => {
      const m = document.getElementById('flow-menu');
      if (m && !m.contains(e.target as Node)) closeSceneMenu();
    };
    document.addEventListener('pointerdown', menuOutsideHandler);
  }, 0);
}

function closeSceneMenu(restoreFocus = false): void {
  const returnFocus = menuReturnFocus;
  document.getElementById('flow-menu')?.remove();
  if (menuOutsideHandler) {
    document.removeEventListener('pointerdown', menuOutsideHandler);
    menuOutsideHandler = null;
  }
  menuReturnFocus = null;
  if (restoreFocus) returnFocus?.focus({ preventScroll: true });
}

function openFlowNode(node: FlowNode): void {
  const key = sceneKeyById(node.sceneId);
  if (!key) {
    setStatus(`无法定位场景“${node.sceneId}”`, false, 4000);
    return;
  }
  openSceneHook(key, node.kind === 'label' ? node.line : undefined);
}

function drawNode(world: SVGElement, box: NodeBox, stats: Map<string, { errors: number; warnings: number }>, startNodeDrag: (nodeId: string, e: PointerEvent) => void): void {
  const { node } = box;
  const presentation = presentFlowNode(node);
  const g = el('g');
  g.classList.add('flow-node', `flow-node--${node.kind}`);
  g.dataset.nodeId = node.id;
  g.dataset.flowNodeKind = node.kind;
  g.dataset.sceneId = node.sceneId;
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  const rect = el('rect');
  rect.classList.add('flow-node-surface');
  rect.setAttribute('x', String(box.x));
  rect.setAttribute('y', String(box.y));
  rect.setAttribute('width', String(box.w));
  rect.setAttribute('height', String(box.h));
  rect.setAttribute('rx', '2');
  const isCurrent = state.current !== null && node.kind === 'scene' && state.scenes.get(state.current)?.id === node.sceneId;
  const issue = stats.get(node.sceneId);
  const validationState = issue && issue.errors > 0 ? 'error' : issue && issue.warnings > 0 ? 'warning' : 'ok';
  const validationLabel = flowValidationStateLabel(validationState);
  if (isCurrent) g.classList.add('is-current');
  if (validationState !== 'ok') g.classList.add(`has-${validationState}`);
  g.setAttribute('aria-current', isCurrent ? 'true' : 'false');
  g.setAttribute('data-flow-validation', validationState);
  g.setAttribute('aria-description', `${validationLabel}；技术信息：${presentation.technicalText}`);
  const issueText = validationState === 'error'
    ? `错误 ${issue?.errors ?? 0}`
    : validationState === 'warning'
      ? `警告 ${issue?.warnings ?? 0}`
      : '';
  const ariaParts = [presentation.ariaLabel, isCurrent ? '当前场景' : '', issueText].filter(Boolean);
  g.setAttribute('aria-label', ariaParts.join('，'));

  const primary = el('text');
  primary.classList.add('flow-node-primary');
  primary.setAttribute('x', String(box.x + 10));
  primary.setAttribute('y', String(box.y + 17));
  const label = presentation.primaryText;
  primary.textContent = truncateTextToWidth(label, box.w - 20, 11);

  const meta = el('text');
  meta.classList.add('flow-node-meta');
  meta.setAttribute('x', String(box.x + 10));
  meta.setAttribute('y', String(box.y + 34));
  const metaParts = [presentation.kindLabel];
  if (isCurrent) metaParts.push('当前场景');
  else if (node.kind === 'label') metaParts.push(`位于 ${node.sceneId}`);
  else metaParts.push('点击打开');
  if (issueText) metaParts.push(issueText);
  const metaText = metaParts.join(' · ');
  meta.textContent = truncateTextToWidth(metaText, box.w - 20, 9);

  const title = el('title');
  title.textContent = `${presentation.primaryText}（点击打开；拖到其他节点可新增跳转）｜技术信息：${presentation.technicalText}`;
  g.append(rect, primary, meta, title);

  // E1b：节点按下可能是拖拽建链（超过阈值）或点击导航（未移动）；
  // 注意：pointerdown 已把指针捕获到 svg，节点的 click 事件不会触发，
  // 点击导航在 svg pointerup 的“未拖动”分支里自行判定（验收反馈三轮：单击/双击失效根因）
  g.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    startNodeDrag(node.id, e);
  });
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFlowNode(node);
      return;
    }
    if (node.kind === 'scene' && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault();
      const bounds = g.getBoundingClientRect();
      const container = world.ownerSVGElement?.parentElement;
      if (container) showSceneMenu(container as HTMLElement, node.sceneId, bounds.left + 16, bounds.top + 16, g);
    }
  });
  if (node.kind === 'scene') {
    g.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const container = world.ownerSVGElement?.parentElement;
      if (container) showSceneMenu(container as HTMLElement, node.sceneId, e.clientX, e.clientY, g);
    });
  }
  world.appendChild(g);
}

/** 拖拽状态由 svg pointerup 统一判定，无需 click 抑制 */
const DRAG_THRESHOLD = 6;

/** 渲染流程图到容器（视口裁剪：只为可见范围内的节点/边建 DOM） */
export function renderFlow(container: HTMLElement): void {
  container.innerHTML = '';
  closeSceneMenu();
  const graph = currentGraph();
  const layout = layoutFlowGraph(graph, state.entryScene);
  const stats = sceneIssueStats();

  let errorCount = 0;
  let warningCount = 0;
  for (const issue of stats.values()) {
    errorCount += issue.errors;
    warningCount += issue.warnings;
  }
  const validationState = state.lastValidation === null
    ? 'unchecked'
    : errorCount > 0
      ? 'error'
      : warningCount > 0
        ? 'warning'
        : 'ok';
  const currentSceneId = state.current === null ? null : state.scenes.get(state.current)?.id ?? null;

  const workbench = h('section', 'flow-workbench');
  workbench.setAttribute('data-editor-region', 'flow-workbench');
  workbench.setAttribute('aria-label', '剧情流程工作台');

  const header = h('header', 'flow-workbench-header');
  const headingGroup = h('div', 'flow-heading-group');
  const heading = h('h2', 'flow-heading', '剧情流程');
  const current = h('p', 'flow-current-scene', currentSceneId ? `当前场景：${currentSceneId}` : '当前没有打开场景');
  headingGroup.append(heading, current);

  const status = h('div', 'flow-status');
  status.setAttribute('data-editor-region', 'flow-status');
  status.setAttribute('data-flow-validation', validationState);
  status.setAttribute('aria-label', `流程状态：${flowValidationStateLabel(validationState)}`);
  const nodeCount = h('span', 'flow-stat', `节点 ${graph.nodes.length}`);
  nodeCount.setAttribute('data-flow-stat', 'nodes');
  const edgeCount = h('span', 'flow-stat', `连接 ${graph.edges.length}`);
  edgeCount.setAttribute('data-flow-stat', 'edges');
  const validation = h('span', 'flow-stat flow-stat-validation', flowValidationStateLabel(validationState));
  validation.setAttribute('data-flow-stat', 'validation');
  if (errorCount > 0) validation.textContent = `错误 ${errorCount}`;
  else if (warningCount > 0) validation.textContent = `警告 ${warningCount}`;
  status.append(nodeCount, edgeCount, validation);

  const toolbar = h('div', 'flow-toolbar');
  toolbar.setAttribute('data-editor-region', 'flow-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '流程画布工具');
  const makeTool = (label: string, title: string): HTMLButtonElement => {
    const button = h('button', 'flow-tool', label) as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('data-action-scope', 'workspace');
    button.title = title;
    return button;
  };
  const zoomOut = makeTool('缩小', '缩小流程画布');
  zoomOut.setAttribute('data-flow-action', 'zoom-out');
  const zoomIn = makeTool('放大', '放大流程画布');
  zoomIn.setAttribute('data-flow-action', 'zoom-in');
  const fitCanvas = makeTool('适应画布', '显示全部真实节点');
  fitCanvas.setAttribute('data-flow-action', 'fit-canvas');
  const focusCurrent = makeTool('回到当前', '把当前场景移到画布中央');
  focusCurrent.setAttribute('data-flow-action', 'focus-current');
  focusCurrent.disabled = currentSceneId === null;
  const toggleLegend = makeTool(legendExpanded ? '收起图例' : '展开图例', '显示或隐藏连接图例');
  toggleLegend.setAttribute('data-flow-action', 'toggle-legend');
  toggleLegend.setAttribute('aria-expanded', String(legendExpanded));
  toolbar.append(zoomOut, zoomIn, fitCanvas, focusCurrent, toggleLegend);
  header.append(headingGroup, status, toolbar);

  const canvas = h('div', 'flow-canvas');
  canvas.setAttribute('data-editor-region', 'flow-canvas');
  canvas.setAttribute('aria-label', '可平移、缩放并建立剧情跳转的流程画布');

  const legend = h('aside', 'flow-legend');
  legend.setAttribute('data-editor-region', 'flow-legend');
  legend.setAttribute('aria-label', '流程图例');
  legend.hidden = !legendExpanded;
  const legendHeading = h('h3', 'flow-legend-heading', '图例');
  const nodeLegend = h('div', 'flow-legend-group');
  nodeLegend.append(
    h('span', 'flow-legend-title', '节点'),
    h('span', 'flow-legend-item flow-legend-scene', '场景'),
    h('span', 'flow-legend-item flow-legend-label', '段落标记'),
    h('span', 'flow-legend-item flow-legend-entry', '项目入口'),
  );
  const edgeLegend = h('div', 'flow-legend-group');
  edgeLegend.appendChild(h('span', 'flow-legend-title', '连接'));
  for (const kind of EDGE_KINDS) {
    const item = h('span', `flow-legend-item flow-legend-edge flow-legend-edge--${kind}`, flowEdgeKindLabel(kind));
    item.setAttribute('data-flow-edge-kind', kind);
    edgeLegend.appendChild(item);
  }
  const technical = document.createElement('details');
  technical.className = 'flow-technical';
  const technicalSummary = document.createElement('summary');
  technicalSummary.textContent = '技术信息';
  const technicalText = h('p', 'surdet-technical-text', '节点和连接来自当前项目的校验编译结果；稳定场景 ID、段落指令与连接类型可在节点或连线提示中查看。');
  technical.append(technicalSummary, technicalText);
  legend.append(legendHeading, nodeLegend, edgeLegend, technical);
  workbench.append(header, canvas, legend);
  container.appendChild(workbench);

  // 浏览器窗口可以在 Flow 已经渲染后改变大小。命令必须读取此刻的画布尺寸，
  // 不能继续使用上一次 render 捕获的宽高，否则“适应画布”会按旧窗口计算并裁掉节点。
  const currentViewportSize = (): { width: number; height: number } => ({
    width: canvas.clientWidth || container.clientWidth || 800,
    height: canvas.clientHeight || Math.max(420, (container.clientHeight || 600) - 112),
  });
  const initialViewport = currentViewportSize();
  const cw = initialViewport.width;
  const ch = initialViewport.height;
  const svg = el('svg');
  svg.setAttribute('width', String(cw));
  svg.setAttribute('height', String(ch));
  svg.classList.add('flow-canvas-svg');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', `剧情流程，${graph.nodes.length} 个节点，${graph.edges.length} 条连接`);
  svg.appendChild(buildFlowDefs());
  const world = el('g');
  world.setAttribute('data-flow-world', '');
  world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
  svg.appendChild(world);
  // 编辑台刻度随 world 平移缩放，先于边和节点绘制。
  const gridRect = el('rect');
  gridRect.classList.add('flow-grid');
  gridRect.setAttribute('x', '-4000');
  gridRect.setAttribute('y', '-4000');
  gridRect.setAttribute('width', '12000');
  gridRect.setAttribute('height', '12000');
  gridRect.setAttribute('fill', 'url(#flow-grid)');
  world.appendChild(gridRect);

  // 视口对应的世界坐标矩形（裁剪用）
  const vx0 = -view.tx / view.k, vy0 = -view.ty / view.k;
  const vx1 = vx0 + cw / view.k, vy1 = vy0 + ch / view.k;
  const visible = (b: NodeBox): boolean => b.x + b.w >= vx0 && b.x <= vx1 && b.y + b.h >= vy0 && b.y <= vy1;

  // 先边后节点（节点盖住线头）；边标签收集后在最顶层绘制（不被节点遮）
  // 汇聚分散：多条跨列边落在同一目标节点时，落点沿目标左缘错开，避免曲线重叠（验收反馈：连线交叉太乱）
  const toCount = new Map<string, number>();
  for (const edge of graph.edges) {
    const a = layout.boxes.get(edge.from);
    const b = layout.boxes.get(edge.to);
    if (!a || !b) continue;
    const sl = a.node.sceneId === b.node.sceneId && a.node.kind !== 'host-entry' && b.node.kind !== 'host-entry';
    if (!sl) toCount.set(edge.to, (toCount.get(edge.to) ?? 0) + 1);
  }
  const toSeen = new Map<string, number>();
  const fanDy = (toId: string): number => {
    const total = toCount.get(toId) ?? 0;
    if (total <= 1) return 0;
    const seen = toSeen.get(toId) ?? 0;
    toSeen.set(toId, seen + 1);
    const step = Math.min(10, 4 + 16 / total);
    return (seen - (total - 1) / 2) * step;
  };
  const edgeLabels: EdgeLabelDraw[] = [];
  for (const edge of graph.edges) {
    const a = layout.boxes.get(edge.from);
    const b = layout.boxes.get(edge.to);
    if (!a || !b) continue;
    const sl = a.node.sceneId === b.node.sceneId && a.node.kind !== 'host-entry' && b.node.kind !== 'host-entry';
    drawEdge(world, edge, layout.boxes, edgeLabels, sl ? 0 : fanDy(edge.to));
  }

  /* ---- 节点拖拽建链状态 ---- */
  let nodeDrag: { fromId: string; startX: number; startY: number; dragging: boolean } | null = null;
  const linkLine = el('path');
  linkLine.classList.add('flow-link-preview');
  linkLine.setAttribute('data-flow-link-preview', '');
  linkLine.setAttribute('visibility', 'hidden');
  svg.appendChild(linkLine);

  const startNodeDrag = (nodeId: string, e: PointerEvent): void => {
    nodeDrag = { fromId: nodeId, startX: e.clientX, startY: e.clientY, dragging: false };
    svg.setPointerCapture(e.pointerId);
  };

  for (const box of layout.boxes.values()) {
    if (!visible(box)) continue;
    drawNode(world, box, stats, startNodeDrag);
  }
  // 边标签最后绘制，避免被节点覆盖。
  drawEdgeLabels(world, edgeLabels);

  canvas.appendChild(svg);
  const minimap = buildMinimap(layout, cw, ch, container);
  if (minimap) canvas.appendChild(minimap);

  if (graph.nodes.length === 0) {
    const message = state.lastValidation === null
      ? '尚未校验，暂时无法生成剧情流程'
      : '当前项目没有可显示的剧情连接';
    const hint = h('div', 'flow-empty', message);
    hint.setAttribute('role', 'status');
    canvas.appendChild(hint);
  }

  const zoomAround = (nextScale: number, px?: number, py?: number, focusSelector?: string): void => {
    const viewport = currentViewportSize();
    const centerX = px ?? viewport.width / 2;
    const centerY = py ?? viewport.height / 2;
    const minimumScale = Math.min(0.2, view.k);
    const k2 = Math.max(minimumScale, Math.min(3, nextScale));
    view.tx = centerX - ((centerX - view.tx) / view.k) * k2;
    view.ty = centerY - ((centerY - view.ty) / view.k) * k2;
    view.k = k2;
    rerenderFlow(container, focusSelector);
  };
  zoomOut.onclick = () => zoomAround(view.k / 1.2, undefined, undefined, '[data-flow-action="zoom-out"]');
  zoomIn.onclick = () => zoomAround(view.k * 1.2, undefined, undefined, '[data-flow-action="zoom-in"]');
  fitCanvas.onclick = () => {
    if (layout.boxes.size === 0) {
      setStatus('当前没有可适应的流程节点', false, 3000);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const box of layout.boxes.values()) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    }
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = 56;
    const viewport = currentViewportSize();
    const availableWidth = Math.max(1, viewport.width - padding * 2);
    const availableHeight = Math.max(1, viewport.height - padding * 2);
    view.k = Math.min(2, availableWidth / contentWidth, availableHeight / contentHeight);
    view.tx = (viewport.width - contentWidth * view.k) / 2 - minX * view.k;
    view.ty = (viewport.height - contentHeight * view.k) / 2 - minY * view.k;
    rerenderFlow(container, '[data-flow-action="fit-canvas"]');
  };
  focusCurrent.onclick = () => {
    if (!currentSceneId) return;
    const box = [...layout.boxes.values()].find((item) => item.node.kind === 'scene' && item.node.sceneId === currentSceneId);
    if (!box) {
      setStatus(`当前场景“${currentSceneId}”不在本次流程结果中`, false, 4000);
      return;
    }
    const viewport = currentViewportSize();
    view.tx = viewport.width / 2 - (box.x + box.w / 2) * view.k;
    view.ty = viewport.height / 2 - (box.y + box.h / 2) * view.k;
    rerenderFlow(container, '[data-flow-action="focus-current"]');
  };
  toggleLegend.onclick = () => {
    legendExpanded = !legendExpanded;
    rerenderFlow(container, '[data-flow-action="toggle-legend"]');
  };

  // 滚轮缩放（以光标为中心）
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    zoomAround(view.k * factor, px, py);
  }, { passive: false });

  // 拖拽平移（背景按下；节点按下走建链逻辑，已 stopPropagation）
  let panning: { x: number; y: number; tx: number; ty: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    panning = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (nodeDrag) {
      const dx = e.clientX - nodeDrag.startX;
      const dy = e.clientY - nodeDrag.startY;
      if (!nodeDrag.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) nodeDrag.dragging = true;
      if (nodeDrag.dragging) {
        const from = layout.boxes.get(nodeDrag.fromId);
        if (from) {
          const rect = svg.getBoundingClientRect();
          const x1 = (from.x + from.w / 2) * view.k + view.tx;
          const y1 = (from.y + from.h / 2) * view.k + view.ty;
          linkLine.setAttribute('d', `M ${x1} ${y1} L ${e.clientX - rect.left} ${e.clientY - rect.top}`);
          linkLine.setAttribute('visibility', 'visible');
        }
      }
      return;
    }
    if (!panning) return;
    view.tx = panning.tx + (e.clientX - panning.x);
    view.ty = panning.ty + (e.clientY - panning.y);
    world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
  });
  svg.addEventListener('pointerup', (e) => {
    if (nodeDrag) {
      const drag = nodeDrag;
      nodeDrag = null;
      linkLine.setAttribute('visibility', 'hidden');
      if (drag.dragging) {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const targetG = hit?.closest?.('[data-node-id]') as SVGGElement | null | undefined;
        const toId = targetG?.dataset?.nodeId;
        const from = layout.boxes.get(drag.fromId);
        const to = toId ? layout.boxes.get(toId) : undefined;
        if (from && to && toId !== drag.fromId) {
          createLink(from.node, to.node);
        }
      } else {
        // 未超过拖拽阈值就是点击打开；指针捕获在 svg，必须复用键盘相同的导航函数。
        const box = layout.boxes.get(drag.fromId);
        if (box) openFlowNode(box.node);
      }
      return;
    }
    panning = null;
  });
  svg.addEventListener('pointercancel', () => {
    nodeDrag = null;
    panning = null;
    linkLine.setAttribute('visibility', 'hidden');
  });
}

/** 校验完成/切换后刷新（仅当前处于流程图标签页时） */
export function refreshFlowIfVisible(): void {
  if (state.mainTab !== 'flow') return;
  const c = document.getElementById('flow-view');
  if (c) renderFlow(c);
}
