/**
 * 日历地图可视化摆放（配置页日历区块）：SVG 画布按 x/y 摆放地图节点，
 * 拖拽节点更新坐标（回写行模型 x/y），requires 前置关系画带箭头连线。
 * 增强（日历画布三件套）：节点重叠检测（红框提示）、连线端点修剪到矩形边界 + 箭头 marker、
 * 从节点右侧连接点拖到另一节点添加 requires、点击连线删除 requires。
 * 纯函数（clamp/宽度/坐标解析/重叠/边界点/requires 增删）可单测；DOM 部分仅依赖行模型（RowMap）。
 */
import { h } from '../state.js';
import type { RowMap } from '../config-edit.js';

/** 画布逻辑尺寸（viewBox；渲染时等比拉伸） */
export const MAP_W = 800;
export const MAP_H = 520;

/** 坐标钳制（拖拽不允许拖出画布） */
export function clampCoord(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

/** 节点宽度按名称长度估算（CJK 按 14px/字 + 内边距，最小 70） */
export function mapNodeWidth(name: string): number {
  return Math.max(70, name.length * 14 + 24);
}

/** 行模型读取坐标（非法/缺省按 0） */
export function readNodePos(row: RowMap): { x: number; y: number } {
  const x = Number(String(row.x ?? '').trim());
  const y = Number(String(row.y ?? '').trim());
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** 行模型读取 requires（JSON 数组文本；非法返回空） */
export function readRequires(row: RowMap): string[] {
  const t = String(row.requires ?? '').trim();
  if (t === '') return [];
  try {
    const v: unknown = JSON.parse(t);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** 行模型追加 requires（已存在/自身引用不重复加；返回是否变更） */
export function addRequiresToRow(row: RowMap, reqId: string): boolean {
  const list = readRequires(row);
  if (reqId.trim().length === 0 || list.includes(reqId)) return false;
  list.push(reqId);
  row.requires = JSON.stringify(list);
  return true;
}

/** 行模型移除 requires（不存在返回 false） */
export function removeRequiresFromRow(row: RowMap, reqId: string): boolean {
  const list = readRequires(row);
  const idx = list.indexOf(reqId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  row.requires = JSON.stringify(list);
  return true;
}

export const NODE_H = 40;

/** 节点几何（重叠检测/碰撞命中共用） */
export interface MapNodeGeom { id: string; x: number; y: number; w: number }

/** 节点重叠检测（AABB：中心距小于半宽和且小于高 → 重叠）；返回重叠的 id 对 */
export function findOverlaps(nodes: MapNodeGeom[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < NODE_H) {
        out.push([a.id, b.id]);
      }
    }
  }
  return out;
}

/** from 中心朝 to 方向的矩形边界交点（连线端点修剪到节点边缘，箭头不被节点遮盖）；
 *  两点重合时返回 from 中心 */
export function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }, w: number, hgt: number): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
  const tx = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (hgt / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/**
 * 渲染地图画布。拖拽结束/连线变更后调用 onMoved()，由调用方重渲染区块
 * （行模型已在操作中原地更新）。opts.onDragStart 在节点拖拽开始时触发（配置撤销栈拍快照用）。
 */
export function renderCalendarMap(
  container: HTMLElement,
  rows: RowMap[],
  onMoved: () => void,
  opts?: { onDragStart?: () => void },
): void {
  container.innerHTML = '';
  const svg = el('svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('calendar-map');

  // 箭头 marker（requires 连线方向：前置 → 本节点）
  const defs = el('defs');
  const marker = el('marker');
  marker.setAttribute('id', 'map-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = el('path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', '#7d8fbb');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const posOf = new Map<string, { x: number; y: number }>();
  const widthOf = new Map<string, number>();
  const rowOf = new Map<string, RowMap>();
  rows.forEach((row) => {
    const id = String(row.id ?? '').trim();
    if (id.length === 0) return;
    posOf.set(id, readNodePos(row));
    widthOf.set(id, mapNodeWidth(String(row.name ?? '').trim() || id));
    rowOf.set(id, row);
  });

  // 重叠检测（几何基于当前行模型坐标）
  const geoms: MapNodeGeom[] = [...posOf.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, w: widthOf.get(id) ?? 70 }));
  const overlaps = findOverlaps(geoms);
  const overlapped = new Set<string>(overlaps.flat());

  // 连线端点计算（两端修剪到节点矩形边界，箭头不被节点遮盖）
  const edgeOf = (fromId: string, toId: string): { x1: number; y1: number; x2: number; y2: number } | null => {
    const from = posOf.get(fromId);
    const to = posOf.get(toId);
    if (!from || !to) return null;
    const p1 = edgePoint(from, to, widthOf.get(fromId) ?? 70, NODE_H);
    const p2 = edgePoint(to, from, widthOf.get(toId) ?? 70, NODE_H);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  };

  // 前置连线（requires：前置 → 本节点，箭头指向本节点）；点击连线删除该前置关系
  const edgeLines: { line: SVGLineElement; fromId: string; toId: string }[] = [];
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!posOf.has(id)) continue;
    for (const req of readRequires(row)) {
      const pts = edgeOf(req, id);
      if (!pts) continue;
      const line = el('line');
      line.setAttribute('x1', String(pts.x1));
      line.setAttribute('y1', String(pts.y1));
      line.setAttribute('x2', String(pts.x2));
      line.setAttribute('y2', String(pts.y2));
      line.setAttribute('stroke', '#4a5878');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6 4');
      line.setAttribute('marker-end', 'url(#map-arrow)');
      svg.appendChild(line);
      // 加宽的透明命中线（细线难点；点击删除该前置关系）
      const hit = el('line');
      hit.setAttribute('x1', String(pts.x1));
      hit.setAttribute('y1', String(pts.y1));
      hit.setAttribute('x2', String(pts.x2));
      hit.setAttribute('y2', String(pts.y2));
      hit.setAttribute('stroke', '#000');
      hit.setAttribute('stroke-opacity', '0');
      hit.setAttribute('stroke-width', '12');
      hit.setAttribute('pointer-events', 'stroke');
      hit.style.cursor = 'pointer';
      hit.addEventListener('pointerup', () => {
        const targetRow = rowOf.get(id);
        if (targetRow && removeRequiresFromRow(targetRow, req)) onMoved();
      });
      svg.appendChild(hit);
      edgeLines.push({ line, fromId: req, toId: id });
    }
  }

  /** 拖拽中同步受影响的连线端点 */
  const refreshLines = (movedId: string): void => {
    for (const e of edgeLines) {
      if (e.fromId !== movedId && e.toId !== movedId) continue;
      const pts = edgeOf(e.fromId, e.toId);
      if (!pts) continue;
      e.line.setAttribute('x1', String(pts.x1));
      e.line.setAttribute('y1', String(pts.y1));
      e.line.setAttribute('x2', String(pts.x2));
      e.line.setAttribute('y2', String(pts.y2));
    }
  };

  /** 客户端坐标 → viewBox 坐标（preserveAspectRatio=none 线性映射） */
  const toView = (ev: PointerEvent): { x: number; y: number } | null => {
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: (ev.clientX - r.left) * (MAP_W / r.width), y: (ev.clientY - r.top) * (MAP_H / r.height) };
  };

  // 节点（在连线之上）
  rows.forEach((row, i) => {
    const id = String(row.id ?? '').trim();
    const name = String(row.name ?? '').trim() || id || `节点${i + 1}`;
    const { x, y } = readNodePos(row);
    const w = mapNodeWidth(name);
    const isBase = row.isBase === true;

    const g = el('g');
    g.setAttribute('transform', `translate(${x}, ${y})`);
    g.style.cursor = 'grab';

    const rect = el('rect');
    rect.setAttribute('x', String(-w / 2));
    rect.setAttribute('y', String(-NODE_H / 2));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '8');
    rect.setAttribute('fill', isBase ? '#2c2416' : '#1c2438');
    // 重叠节点红框提示（拖拽错开后自动消失）
    rect.setAttribute('stroke', overlapped.has(id) ? '#c86a6a' : (isBase ? '#c8a86a' : '#3d4a6b'));
    rect.setAttribute('stroke-width', '2');
    g.appendChild(rect);

    const label = el('text');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('y', '-2');
    label.setAttribute('fill', '#e8d9b0');
    label.setAttribute('font-size', '14');
    label.textContent = name;
    g.appendChild(label);

    const sub = el('text');
    sub.setAttribute('text-anchor', 'middle');
    sub.setAttribute('y', '14');
    sub.setAttribute('fill', '#8b93a7');
    sub.setAttribute('font-size', '10');
    sub.textContent = `${id}${isBase ? '（据点）' : ''} · (${Math.round(x)}, ${Math.round(y)})`;
    g.appendChild(sub);

    // 连接点（右侧圆点）：拖到另一节点添加 requires（前置 = 本节点）
    const port = el('circle');
    port.setAttribute('cx', String(w / 2));
    port.setAttribute('cy', '0');
    port.setAttribute('r', '6');
    port.setAttribute('fill', '#c8a86a');
    port.setAttribute('stroke', '#0a0a12');
    port.style.cursor = 'crosshair';
    port.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 不走节点拖拽分支
      port.setPointerCapture(e.pointerId);
      const temp = el('line');
      temp.setAttribute('stroke', '#c8a86a');
      temp.setAttribute('stroke-width', '2');
      temp.setAttribute('stroke-dasharray', '4 4');
      temp.setAttribute('pointer-events', 'none');
      svg.appendChild(temp);
      const move = (ev: PointerEvent): void => {
        const p = toView(ev);
        if (!p) return;
        temp.setAttribute('x1', String(x));
        temp.setAttribute('y1', String(y));
        temp.setAttribute('x2', String(clampCoord(p.x, 0, MAP_W)));
        temp.setAttribute('y2', String(clampCoord(p.y, 0, MAP_H)));
      };
      const up = (ev: PointerEvent): void => {
        port.releasePointerCapture(ev.pointerId);
        port.removeEventListener('pointermove', move);
        port.removeEventListener('pointerup', up);
        temp.remove();
        const p = toView(ev);
        if (!p) return;
        // 命中测试：落点在哪个节点矩形内（排除自身）
        for (const geom of geoms) {
          if (geom.id === id) continue;
          if (Math.abs(p.x - geom.x) <= geom.w / 2 && Math.abs(p.y - geom.y) <= NODE_H / 2) {
            const targetRow = rowOf.get(geom.id);
            if (targetRow && addRequiresToRow(targetRow, id)) onMoved();
            return;
          }
        }
      };
      port.addEventListener('pointermove', move);
      port.addEventListener('pointerup', up);
    });
    g.appendChild(port);

    // 拖拽：移动节点（client → viewBox 坐标换算；连线实时跟随）
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      opts?.onDragStart?.();
      g.setPointerCapture(e.pointerId);
      g.style.cursor = 'grabbing';
      const move = (ev: PointerEvent): void => {
        const p = toView(ev);
        if (!p) return;
        const nx = clampCoord(p.x, 0, MAP_W);
        const ny = clampCoord(p.y, 0, MAP_H);
        row.x = String(nx);
        row.y = String(ny);
        posOf.set(id, { x: nx, y: ny });
        g.setAttribute('transform', `translate(${nx}, ${ny})`);
        sub.textContent = `${id}${isBase ? '（据点）' : ''} · (${nx}, ${ny})`;
        refreshLines(id);
      };
      const up = (ev: PointerEvent): void => {
        g.releasePointerCapture(ev.pointerId);
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.style.cursor = 'grab';
        onMoved(); // 重渲染区块：表格 x/y 输入框同步 + 重叠状态重算
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
    });

    svg.appendChild(g);
  });

  const hint = h('div', 'dim', '拖拽节点调坐标 · 从右侧圆点拖到另一节点添加前置 · 点击连线删除前置'
    + (overlaps.length > 0 ? ` · ⚠ ${overlaps.length} 对节点重叠（红框）` : ''));
  hint.style.padding = '4px 0';
  container.appendChild(hint);

  if (rows.length === 0) {
    const empty = h('div', 'empty', '暂无地图节点：先在下方表格新增行。');
    container.appendChild(empty);
  }
  container.appendChild(svg);
}
