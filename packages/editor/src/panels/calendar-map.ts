/**
 * 日历地图可视化摆放（配置页日历区块）：SVG 画布按 x/y 摆放地图节点，
 * 拖拽节点更新坐标（回写行模型 x/y），requires 前置关系画连线。
 * 纯函数（clamp/宽度/坐标解析）可单测；DOM 部分仅依赖行模型（RowMap）。
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

const NODE_H = 40;

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/**
 * 渲染地图画布。拖拽结束（pointerup）后调用 onMoved()，由调用方重渲染区块
 * （行模型 x/y 已在拖拽中原地更新）。
 */
export function renderCalendarMap(container: HTMLElement, rows: RowMap[], onMoved: () => void): void {
  container.innerHTML = '';
  const svg = el('svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('calendar-map');

  const posOf = new Map<string, { x: number; y: number }>();
  rows.forEach((row) => {
    const id = String(row.id ?? '').trim();
    if (id.length > 0) posOf.set(id, readNodePos(row));
  });

  // 前置连线（requires：前置 → 本节点）
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    const to = posOf.get(id);
    if (!to) continue;
    for (const req of readRequires(row)) {
      const from = posOf.get(req);
      if (!from) continue;
      const line = el('line');
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
      line.setAttribute('stroke', '#4a5878');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6 4');
      svg.appendChild(line);
    }
  }

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
    rect.setAttribute('stroke', isBase ? '#c8a86a' : '#3d4a6b');
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

    // 拖拽：client → viewBox 坐标换算（preserveAspectRatio=none 线性映射）
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.style.cursor = 'grabbing';
      const move = (ev: PointerEvent): void => {
        const r = svg.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const px = (ev.clientX - r.left) * (MAP_W / r.width);
        const py = (ev.clientY - r.top) * (MAP_H / r.height);
        const nx = clampCoord(px, 0, MAP_W);
        const ny = clampCoord(py, 0, MAP_H);
        row.x = String(nx);
        row.y = String(ny);
        g.setAttribute('transform', `translate(${nx}, ${ny})`);
        sub.textContent = `${id}${isBase ? '（据点）' : ''} · (${nx}, ${ny})`;
      };
      const up = (ev: PointerEvent): void => {
        g.releasePointerCapture(ev.pointerId);
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.style.cursor = 'grab';
        onMoved(); // 重渲染区块：表格 x/y 输入框同步
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
    });

    svg.appendChild(g);
  });

  if (rows.length === 0) {
    const hint = h('div', 'empty', '暂无地图节点：先在下方表格新增行。');
    container.appendChild(hint);
  }
  container.appendChild(svg);
}
