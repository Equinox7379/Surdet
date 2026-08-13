/**
 * 右侧面板：变量 chips + 场景拓扑图 + 引用边列表（E0 拆分：原 main.ts 纯搬移）。
 */
import { state, h, setStatus } from '../state.js';
import { renderSidebar } from './sidebar.js';
import { renderEditor } from './editor.js';
import { filterTraceByObject, selectAuthoringObject, type CausalTraceEvent } from '../causal-selection.js';

export function renderRightExtras(): void {
  const right = document.getElementById('right');
  if (!right) return;
  right.appendChild(h('h3', undefined, '变量（game.config.json）'));
  const chips = h('div');
  try {
    if (state.gameConfigText) {
      const cfg = JSON.parse(state.gameConfigText) as { variables?: Record<string, { type?: string }> };
      const vars = Object.entries(cfg.variables ?? {});
      if (vars.length === 0) chips.appendChild(h('span', 'empty', '无变量声明'));
      for (const [name, decl] of vars) {
        const chip = h('span', 'chip', `${name}：${decl?.type ?? '?'}`);
        chip.title = '点击复制变量名';
        chip.onclick = () => { void navigator.clipboard?.writeText(name); setStatus(`已复制 ${name}`, true); };
        chips.appendChild(chip);
      }
    } else {
      chips.appendChild(h('span', 'empty', '未加载 game.config.json'));
    }
  } catch {
    chips.appendChild(h('span', 'empty', 'game.config.json 解析失败'));
  }
  right.appendChild(chips);

  right.appendChild(h('h3', undefined, '场景拓扑'));
  const graphBox = h('div');
  graphBox.id = 'graph-box';
  right.appendChild(graphBox);

  right.appendChild(h('h3', undefined, '场景引用'));
  const edgesBox = h('div');
  edgesBox.id = 'edges-box';
  right.appendChild(edgesBox);
  updateEdges();
  updateGraph();
  const causal = h('div');
  causal.id = 'causal-box';
  right.appendChild(causal);
  updateCausalPanel();
}

function refList(parent: HTMLElement, label: string, refs: readonly string[]): void {
  parent.appendChild(h('div', 'causal-label', label));
  if (refs.length === 0) {
    parent.appendChild(h('div', 'empty', '无'));
    return;
  }
  const list = h('div', 'causal-refs');
  for (const ref of refs) {
    const button = h('button', 'causal-ref', ref);
    button.onclick = () => {
      state.selectedObjectRef = selectAuthoringObject(ref);
      document.dispatchEvent(new CustomEvent('surdet-authoring-selection'));
    };
    list.appendChild(button);
  }
  parent.appendChild(list);
}

/** 更新紧凑因果区；观察证据只来自当前 preview trace，不以静态推断冒充运行事实。 */
export function updateCausalPanel(): void {
  const box = document.getElementById('causal-box');
  if (!box) return;
  box.innerHTML = '';
  box.appendChild(h('h3', undefined, '因果'));
  const selected = state.selectedObjectRef;
  const index = state.authoringIndex;
  const object = selected === null || index === null
    ? undefined
    : index.objects.find((candidate) => candidate.objectRef === selected || candidate.semanticId === selected);
  if (!selected) {
    box.appendChild(h('div', 'empty', '点击块或预览轨迹事件查看因果'));
    return;
  }
  if (!object) {
    box.appendChild(h('div', 'empty', '对象索引正在更新，或当前 objectRef 已过期'));
    return;
  }
  box.appendChild(h('div', 'causal-current', object.objectRef));
  refList(box, '直接引用', object.references);
  refList(box, '直接被引用', object.referencedBy);
  const potential = h('div', 'causal-impact');
  potential.appendChild(h('div', 'causal-label', 'potentialImpact'));
  potential.appendChild(h('div', undefined, object.references.length > 0 ? `可能影响 ${object.references.length} 个直接目标` : '当前对象没有直接引用目标'));
  box.appendChild(potential);
  const observed = h('div', 'causal-impact');
  observed.appendChild(h('div', 'causal-label', 'observedImpact'));
  const trace = state.previewTrace.map((event, step) => ({ step, event })) satisfies CausalTraceEvent[];
  const hits = filterTraceByObject(object.objectRef, trace, index ?? undefined);
  if (state.previewTrace.length === 0) observed.appendChild(h('div', 'empty', '尚无本次预览观察证据'));
  else if (hits.length === 0) observed.appendChild(h('div', 'empty', '当前对象未出现在本次预览轨迹中'));
  else observed.appendChild(h('div', undefined, `本次预览观察到 ${hits.length} 个事件`));
  box.appendChild(observed);
}

/** 场景拓扑图（自我迭代⑤）：BFS 分层布局的 SVG 小图，节点点击切换场景。
 *  数据源为 lastEdges（Worker/同步校验共用），不依赖编译产物对象。 */
export function updateGraph(): void {
  const box = document.getElementById('graph-box');
  if (!box) return;
  box.innerHTML = '';
  const ids = [...new Set([...state.scenes.values()].map((s) => s.id))];
  if (ids.length === 0) return;

  // 邻接表（边目标取场景部分：scene.label → scene）
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of state.lastEdges) {
    const to = e.to.split('.')[0]!;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(to)) adj.set(to, []);
    adj.get(e.from)!.push(to);
  }

  // BFS 分层（entryScene 为根；不可达场景排到末列）
  const depth = new Map<string, number>();
  const entry = state.entryScene && adj.has(state.entryScene) ? state.entryScene : ids[0]!;
  depth.set(entry, 0);
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nx of adj.get(cur) ?? []) {
      if (!depth.has(nx)) {
        depth.set(nx, depth.get(cur)! + 1);
        queue.push(nx);
      }
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const unreachable = [...adj.keys()].filter((id) => !depth.has(id));
  if (unreachable.length > 0) {
    maxDepth += 1;
    for (const id of unreachable) depth.set(id, maxDepth); // 不可达：末列集中展示
  }

  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  const NS = 'http://www.w3.org/2000/svg';
  const COLW = 96;
  const ROWH = 32;
  const PAD = 10;
  const NODE_W = 84;
  const NODE_H = 22;
  const cols = (maxDepth === 0 ? 0 : maxDepth) + 2;
  const maxRows = Math.max(1, ...[...byDepth.values()].map((v) => v.length));
  const width = PAD * 2 + cols * COLW;
  const height = PAD * 2 + maxRows * ROWH;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const posOf = new Map<string, { x: number; y: number }>();
  for (const [d, nodes] of byDepth) {
    nodes.forEach((id, i) => {
      posOf.set(id, { x: PAD + d * COLW + NODE_W / 2, y: PAD + i * ROWH + NODE_H / 2 });
    });
  }

  // 先画边再画节点（节点盖住线头）
  for (const e of state.lastEdges) {
    const from = posOf.get(e.from);
    const to = posOf.get(e.to.split('.')[0]!);
    if (!from || !to) continue;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(from.x + NODE_W / 2 - 6));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x - NODE_W / 2 + 2));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('stroke', e.kind === 'call' ? '#7a6aa8' : '#a9b8ca');
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
  }

  const currentId = state.current ? state.scenes.get(state.current)?.id : undefined;
  for (const [id, p] of posOf) {
    const g = document.createElementNS(NS, 'g');
    g.style.cursor = 'pointer';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(p.x - NODE_W / 2));
    rect.setAttribute('y', String(p.y - NODE_H / 2));
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', id === entry ? '#f0f6ff' : '#ffffff');
    rect.setAttribute('stroke', id === currentId ? '#0a6fd0' : '#c3cfdd'); // 当前场景：深蓝描边聚焦（用户反馈：红改蓝）
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(p.x));
    label.setAttribute('y', String(p.y + 4));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', id === currentId ? '#0a6fd0' : '#1f2d3d');
    label.textContent = id.length > 11 ? id.slice(0, 10) + '…' : id;
    g.append(rect, label);
    const title = document.createElementNS(NS, 'title');
    title.textContent = id === entry ? `${id}（入口）` : id;
    g.appendChild(title);
    g.addEventListener('click', () => {
      const key = [...state.scenes.keys()].find((k) => state.scenes.get(k)!.id === id);
      if (key) {
        state.current = key;
        renderSidebar();
        renderEditor();
        updateGraph();
      }
    });
    svg.appendChild(g);
  }
  box.appendChild(svg);
}

export function updateEdges(): void {
  const box = document.getElementById('edges-box');
  if (!box) return;
  box.innerHTML = '';
  if (state.lastEdges.length === 0) {
    box.appendChild(h('div', 'empty', '暂无数据'));
    return;
  }
  for (const e of state.lastEdges) {
    box.appendChild(h('div', 'edge', `${e.from} → ${e.to}（${e.kind}）`));
  }
}
