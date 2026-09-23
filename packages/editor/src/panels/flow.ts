/**
 * 流程图视图（E1a 只读导航 + E1b 交互编辑）：
 *  - 数据源：buildFlowGraph（lastValidation.scenes 编译产物 + collectConfigSceneRoots 宿主入口，
 *    与 CLI 同源；不重新解析源码）
 *  - 布局：以真实 FlowGraph 为唯一事实，投影为“场景分镜 + 剧情段落 + 正交连接”的写作者路径地图；
 *    只隐藏重复/源码顺序等技术连接的默认展示，不删除真实节点和边
 *  - 交互（E1a）：拖拽平移 / 滚轮缩放（以光标为中心）；单击场景节点 → 切到块编辑视图；
 *    单击标签节点 → 切到该场景并滚动到 @label 行；当前场景与校验状态均有文字和边界反馈
 *  - 交互（E1b）：从节点拖到另一节点 → 在源场景末尾插入 @jump/@goto（走 history 可 undo）；
 *    右键场景节点 → 重命名（引用同步改写）/ 删除（引用检查警告）
 *  - 渲染：真实节点常驻 SVG，避免平移到远端场景时出现“只剩空框”的错觉；规模目标 100 场景 / 800 标签
 */
import { state, h, setStatus } from '../state.js';
import {
  assertProjectWriteUnlocked,
  isSceneFilePathReserved,
  prepareSceneMutation,
  runProjectWriteOperation,
  sceneFileIdentity,
  sceneProjectPath,
} from '../project-io.js';
import { collectConfigSceneRoots, splitOutsideQuotes } from '@surdet/core';
import { parseProjectConfigDocument, parseSceneDocument, serializeSceneDocument } from '@surdet/authoring';
import { buildFlowGraph } from '../graph/build.js';
import type { FlowGraph, FlowNode, FlowEdge } from '../graph/build.js';
import { histories, setSceneText } from '../history.js';
import { renderSidebar } from './sidebar.js';
import {
  flowEdgeKindLabel,
  flowValidationStateLabel,
  presentFlowEdge,
} from '../flow-presentation.js';
import {
  buildNarrativeFlowLayout,
} from '../flow-narrative-layout.js';
import type {
  FlowMapMode,
  NarrativeFlowLayout,
  NarrativeLayoutOptions,
  NarrativeNodeBox,
  NarrativeNodePresentation,
  NarrativeRoute,
  NarrativeReturnMarker,
  NarrativeSceneFrame,
} from '../flow-narrative-layout.js';

/** 导航钩子（main.ts 注入）：切回块编辑标签页并可滚动到指定行；requestValidate 触发重校验 */
let openSceneHook: (sceneKey: string, line?: number) => void = () => {};
let requestValidateHook: () => void = () => {};
let renameSceneHook: (sceneId: string) => void = (sceneId) => {
  void renameScene(sceneId).then(() => refreshFlowIfVisible()).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : '当前无法重命名场景', false, 5000);
  });
};
let deleteSceneHook: (sceneId: string) => void = (sceneId) => {
  void deleteScene(sceneId).then(() => refreshFlowIfVisible()).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : '当前无法删除场景', false, 5000);
  });
};
export function bindFlowHooks(opts: {
  openScene: (sceneKey: string, line?: number) => void;
  requestValidate: () => void;
  onRenameScene?: (sceneId: string) => void;
  onDeleteScene?: (sceneId: string) => void;
}): void {
  openSceneHook = opts.openScene;
  requestValidateHook = opts.requestValidate;
  renameSceneHook = opts.onRenameScene ?? renameSceneHook;
  deleteSceneHook = opts.onDeleteScene ?? deleteSceneHook;
}

/* ============================ 纯函数助手（可单测） ============================ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function visitSceneRefs(text: string, sceneId: string, replacement?: string): { text: string; count: number } {
  let count = 0;
  const pattern = new RegExp(`^([ \\t]*@(?:jump|call)[ \\t]+)${escapeRe(sceneId)}(?=[.\\s]|$)`);
  const rewrite = (raw: string) => raw.replace(pattern, (match, prefix: string) => {
    count++;
    return replacement === undefined ? match : prefix + replacement;
  });
  const lines = parseSceneDocument(text);
  for (const line of lines) {
    if (line.kind === 'instr') line.raw = rewrite(line.raw);
    if (line.kind !== 'choice-option') continue;
    const arrow = /\s->(?:\s|$)/.exec(line.raw);
    if (!arrow) continue;
    const end = arrow.index + arrow[0].length;
    const parts = splitOutsideQuotes(line.raw.slice(end), '@');
    line.raw = line.raw.slice(0, end) + parts.map((part, index) => index === 0 ? part : rewrite(`@${part}`).slice(1)).join('@');
  }
  return { text: serializeSceneDocument(lines), count };
}

/** 同步改写普通指令和选择项内联指令，不匹配对白中的指令文字。 */
export function rewriteSceneRefs(text: string, oldId: string, newId: string): string {
  return visitSceneRefs(text, oldId, newId).text;
}

/** 统计场景被 @jump/@call 引用次数（删除前检查用） */
export function countSceneRefs(text: string, sceneId: string): number {
  return visitSceneRefs(text, sceneId).count;
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

export type NodeBox = NarrativeNodeBox;
type FlowLayout = NarrativeFlowLayout;

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

/** 人类可读的剧情路径投影；FlowGraph 本身仍是唯一图事实。 */
export function layoutFlowGraph(
  graph: FlowGraph,
  entryScene: string,
  options?: NarrativeLayoutOptions,
): FlowLayout {
  return buildNarrativeFlowLayout(graph, entryScene, options);
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

/** 流程图只有运行时 sceneId；磁盘操作必须在唯一匹配时才可继续。 */
export function resolveSceneKeyForOperation(sceneId: string): string | null {
  const matches = [...state.scenes].filter(([, scene]) => scene.id === sceneId).map(([key]) => key);
  return matches.length === 1 ? matches[0]! : null;
}

function pendingRenameFor(sceneKey: string): boolean {
  return state.pendingSceneDeletes.some((pending) => (
    pending.kind === 'rename' && pending.replacementKey === sceneKey
  ));
}

function remapPendingSceneKey(previousKey: string, nextKey: string | null): void {
  for (const pending of state.pendingSceneDeletes) {
    if (!pending.affectedSceneKeys) continue;
    pending.affectedSceneKeys = [...new Set(pending.affectedSceneKeys.flatMap((key) => (
      key !== previousKey ? [key] : nextKey === null ? [] : [nextKey]
    )))];
  }
}

function renamedSceneFile(file: string, newId: string): string {
  const parts = file.replaceAll('\\', '/').split('/');
  parts[parts.length - 1] = `${newId}.gal`;
  return parts.join('/');
}

function renamedSceneKey(sceneKey: string, newId: string): string {
  const parts = sceneKey.split('/');
  parts[parts.length - 1] = newId;
  return parts.join('/');
}

function validSceneId(value: string): boolean {
  return value.length > 0
    && value.length <= 120
    && !/[\s.<>:"/\\|?*\u0000-\u001f]/u.test(value);
}

function sceneConfigReferences(sceneId: string): string[] {
  const references: string[] = [];
  // Use the current working text, including unsaved config, not a second disk view.
  const config = state.gameConfigText === '' && state.handles.gameConfig === null
    ? {} : parseProjectConfigDocument(state.gameConfigText);
  const player = config['player'];
  if (player !== undefined) {
    if (player === null || typeof player !== 'object' || Array.isArray(player)) {
      throw new Error('game.config.json 的 player 必须是对象；修正配置后再改名或删除场景');
    }
    const endings = (player as Record<string, unknown>)['endScenes'];
    if (endings !== undefined && (!Array.isArray(endings) || !endings.every(id => typeof id === 'string'))) {
      throw new Error('game.config.json 的 player.endScenes 必须是场景 ID 数组；修正配置后再改名或删除场景');
    }
    if (Array.isArray(endings) && endings.includes(sceneId)) references.push('game.config.json 的 player.endScenes（结束场景）');
  }
  if (state.entryScene === sceneId) references.push('项目入口');
  if (collectConfigSceneRoots(state.configFiles).includes(sceneId)) references.push('事件、成长或日历配置');
  return references;
}

function blockConfiguredSceneOperation(sceneId: string): boolean {
  const references = sceneConfigReferences(sceneId);
  if (references.length === 0) return false;
  setStatus(
    `场景“${sceneId}”仍被${references.join('和')}引用，请先调整对应配置中的引用`,
    false,
    6000,
  );
  return true;
}

/** 只更新内存与引用；旧磁盘文件由“保存全部”在新文件写成后清理。 */
async function renameSceneAtKeyUnlocked(sceneKey: string): Promise<void> {
  assertProjectWriteUnlocked();
  if (state.pendingSceneCommit !== null) {
    setStatus('上一次场景保存正在收束，请先重试“保存全部”', false, 6000);
    return;
  }
  const current = state.scenes.get(sceneKey);
  if (!current) return;
  if (pendingRenameFor(sceneKey)) {
    setStatus('该场景已有尚未保存的重命名，请先保存全部', false, 5000);
    return;
  }
  const sceneId = current.id;
  if (blockConfiguredSceneOperation(sceneId)) return;
  if ([...state.scenes.values()].filter((scene) => scene.id === sceneId).length !== 1) {
    setStatus(`场景 ID“${sceneId}”对应多个文件，请先删除重复场景再重命名`, false, 6000);
    return;
  }
  const input = window.prompt(`重命名场景 '${sceneId}'（文件名，不含 .gal）`, sceneId);
  if (!input) return;
  const newId = input.trim();
  if (!validSceneId(newId)) {
    setStatus('场景 ID 不能包含空格、点号或文件名保留字符', false, 5000);
    return;
  }
  if (newId === sceneId) return;
  if ([...state.scenes.values()].some((scene) => scene.id === newId)) {
    setStatus(`场景 '${newId}' 已存在`, false, 4000);
    return;
  }
  const targetFile = renamedSceneFile(current.file, newId);
  if (sceneFileIdentity(targetFile) === sceneFileIdentity(current.file)) {
    setStatus('Windows 下不能只改变场景文件名的大小写，请使用不同名称', false, 6000);
    return;
  }
  if (isSceneFilePathReserved(targetFile, sceneKey)) {
    setStatus('目标场景路径已存在或正等待删除，请先保存全部', false, 6000);
    return;
  }

  const authorityPlan = current.handle && state.dirHandle
    ? await prepareSceneMutation({
      kind: 'rename',
      sourcePath: sceneProjectPath(current.file),
      targetPath: sceneProjectPath(targetFile),
    })
    : null;
  // 计划请求期间正文仍可继续输入；必须基于返回时的最新文本重算，不能写回旧快照。
  const rewrites = new Map<string, string>();
  for (const [key, candidate] of state.scenes) {
    const next = rewriteSceneRefs(candidate.text, sceneId, newId);
    if (next !== candidate.text) rewrites.set(key, next);
  }
  for (const [key, next] of rewrites) {
    const candidate = state.scenes.get(key)!;
    candidate.text = next;
    candidate.dirty = true;
  }
  const refCount = rewrites.size;
  const scene = state.scenes.get(sceneKey)!;
  scene.text = scene.text.replace(
    new RegExp(`^([ \\t]*)@scene[ \\t]+${escapeRe(sceneId)}(?=\\s|$)`, 'gm'),
    `$1@scene ${newId}`,
  );
  scene.dirty = true;
  scene.id = newId;
  const oldFile = scene.file;
  scene.file = targetFile;

  const newKey = renamedSceneKey(sceneKey, newId);
  // 场景身份改变后，撤销正文仍必须属于新身份；同步历史内的跳转，不能撤回到失效文件。
  for (const [key, history] of histories) {
    const rewrite = (text: string): string => {
      const next = rewriteSceneRefs(text, sceneId, newId);
      return key === sceneKey
        ? next.replace(new RegExp(`^([ \\t]*)@scene[ \\t]+${escapeRe(sceneId)}(?=\\s|$)`, 'gm'), `$1@scene ${newId}`)
        : next;
    };
    history.past = history.past.map(rewrite);
    history.future = history.future.map(rewrite);
  }
  const history = histories.get(sceneKey);
  histories.delete(sceneKey);
  histories.delete(newKey);
  if (history) histories.set(newKey, history);
  state.scenes = new Map([...state.scenes].map(([key, value]) => (
    key === sceneKey ? [newKey, value] as const : [key, value] as const
  )));
  remapPendingSceneKey(sceneKey, newKey);
  if (state.current === sceneKey) state.current = newKey;

  if (scene.handle && state.dirHandle) {
    const affectedSceneKeys = [...new Set([
      newKey,
      ...[...rewrites.keys()].map((key) => key === sceneKey ? newKey : key),
    ])];
    state.pendingSceneDeletes.push({
      kind: 'rename',
      id: sceneId,
      file: oldFile,
      replacementKey: newKey,
      affectedSceneKeys,
      ...(authorityPlan ?? {}),
    });
    scene.handle = null;
  }

  setStatus(
    `场景已重命名 ${sceneId} → ${newId}（同步改写 ${refCount} 处引用；保存全部后写入磁盘）`,
    true,
    6000,
  );
  renderSidebar();
  requestValidateHook();
}

export async function renameSceneAtKey(sceneKey: string): Promise<void> {
  await runProjectWriteOperation(() => renameSceneAtKeyUnlocked(sceneKey));
}

export async function renameScene(sceneId: string): Promise<void> {
  const sceneKey = resolveSceneKeyForOperation(sceneId);
  if (!sceneKey) {
    setStatus(`无法从流程图唯一确定场景 '${sceneId}'，请在左侧场景目录选择精确文件`, false, 6000);
    return;
  }
  await renameSceneAtKey(sceneKey);
}

/** 精确路径进入待保存清理；不在点击按钮时直接改磁盘。 */
async function deleteSceneAtKeyUnlocked(sceneKey: string): Promise<void> {
  assertProjectWriteUnlocked();
  if (state.pendingSceneCommit !== null) {
    setStatus('上一次场景保存正在收束，请先重试“保存全部”', false, 6000);
    return;
  }
  const scene = state.scenes.get(sceneKey);
  if (!scene) return;
  if (pendingRenameFor(sceneKey)) {
    setStatus('该场景已有尚未保存的重命名，请先保存全部再删除', false, 5000);
    return;
  }
  const sceneId = scene.id;
  if (blockConfiguredSceneOperation(sceneId)) return;
  let refs = 0;
  for (const [key, candidate] of state.scenes) {
    if (key === sceneKey) continue;
    refs += countSceneRefs(candidate.text, sceneId);
  }
  const warning = refs > 0
    ? `场景“${sceneId}”被 ${refs} 处剧情跳转引用。删除后这些引用会失效。\n\n文件：${scene.file}\n\n确定标记删除吗？`
    : `确定标记删除场景“${sceneId}”吗？\n\n文件：${scene.file}\n\n磁盘文件将在“保存全部”时删除。`;
  const dirtyWarning = scene.dirty ? '\n\n该场景包含未保存内容，继续将放弃这些内容。' : '';
  if (!window.confirm(`${warning}${dirtyWarning}`)) return;

  const authorityPlan = scene.handle && state.dirHandle
    ? await prepareSceneMutation({ kind: 'delete', sourcePath: sceneProjectPath(scene.file) })
    : null;

  state.scenes.delete(sceneKey);
  histories.delete(sceneKey);
  remapPendingSceneKey(sceneKey, null);
  if (state.current === sceneKey) state.current = [...state.scenes.keys()][0] ?? null;
  if (scene.handle && state.dirHandle) {
    state.pendingSceneDeletes.push({
      kind: 'delete',
      id: sceneId,
      file: scene.file,
      ...(authorityPlan ?? {}),
    });
  }
  setStatus(
    scene.handle && state.dirHandle
      ? `已标记删除场景“${sceneId}”，保存全部后写入磁盘`
      : `已移除尚未落盘的场景“${sceneId}”`,
    true,
    5000,
  );
  renderSidebar();
  requestValidateHook();
}

export async function deleteSceneAtKey(sceneKey: string): Promise<void> {
  await runProjectWriteOperation(() => deleteSceneAtKeyUnlocked(sceneKey));
}

export async function deleteScene(sceneId: string): Promise<void> {
  const sceneKey = resolveSceneKeyForOperation(sceneId);
  if (!sceneKey) {
    setStatus(`无法从流程图唯一确定场景 '${sceneId}'，请在左侧场景目录选择精确文件`, false, 6000);
    return;
  }
  await deleteSceneAtKey(sceneKey);
}

/* ============================ 渲染 ============================ */

const NS = 'http://www.w3.org/2000/svg';
/** 视图变换（平移/缩放）：跨重渲染保持 */
type FlowViewKey = FlowMapMode | 'technical';
const flowViews: Record<FlowViewKey, { k: number; tx: number; ty: number }> = {
  focus: { k: 1, tx: 30, ty: 30 },
  overview: { k: 1, tx: 30, ty: 30 },
  technical: { k: 1, tx: 30, ty: 30 },
};
let flowViewMode: FlowMapMode = 'focus';
let view = flowViews.focus;
let pendingAutoFit = false;
let legendExpanded = false;
let technicalEdgesVisible = false;
let technicalDetailsExpanded = false;

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag);
}

/** 旧公开测试入口保留为正交几何，不再生成贝塞尔曲线。 */
export function edgeGeometry(a: NodeBox, b: NodeBox, kind: FlowEdge['kind'], sameLane: boolean, dy = 0): { d: string; lx: number; ly: number } {
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2 + dy;
  const x1 = a.x + a.w;
  const x2 = sameLane ? b.x + b.w : b.x;
  const channelX = sameLane ? Math.max(x1, x2) + 28 : (x1 + x2) / 2;
  const d = `M ${x1} ${y1} L ${channelX} ${y1} L ${channelX} ${y2} L ${x2} ${y2}`;
  return { d, lx: channelX, ly: (y1 + y2) / 2 };
}

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
  const rule = el('path');
  rule.setAttribute('d', 'M 26 0 L 0 0 L 0 26');
  rule.classList.add('flow-grid-mark');
  grid.appendChild(rule);
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
  worldMinX?: number;
  worldMinY?: number;
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
    x: intrinsicX / mapping.worldScale + (mapping.worldMinX ?? 0) - mapping.worldPadding,
    y: intrinsicY / mapping.worldScale + (mapping.worldMinY ?? 0) - mapping.worldPadding,
  };
}

/** UI 第三阶段：小地图（全节点概览 + 当前视口框；点击居中导航） */
function buildMinimap(layout: FlowLayout, cw: number, ch: number, container: HTMLElement): SVGElement | null {
  if (layout.boxes.size === 0) return null;
  const pad = 40;
  const activeBounds = technicalEdgesVisible ? layout.bounds : layout.visibleBounds;
  const worldW = activeBounds.maxX - activeBounds.minX + pad * 2;
  const worldH = activeBounds.maxY - activeBounds.minY + pad * 2;
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
  const toMm = (x: number, y: number): { x: number; y: number } => ({
    x: (x - activeBounds.minX + pad) * s,
    y: (y - activeBounds.minY + pad) * s,
  });
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
      worldMinX: activeBounds.minX,
      worldMinY: activeBounds.minY,
    });
    view.tx = cw / 2 - worldPoint.x * view.k;
    view.ty = ch / 2 - worldPoint.y * view.k;
    rerenderFlow(container, restoreKeyboardFocus ? '[data-editor-region="flow-minimap"]' : undefined);
  };
  mm.addEventListener('click', (e) => {
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

function drawRoute(world: SVGElement, route: NarrativeRoute): void {
  const path = el('path');
  path.setAttribute('d', route.d);
  path.classList.add('flow-edge', 'flow-route', `flow-edge--${route.edge.kind}`);
  if (route.hiddenByDefault) path.classList.add('is-technical');
  path.setAttribute('data-flow-edge-kind', route.edge.kind);
  path.setAttribute('data-flow-route', 'orthogonal');
  path.setAttribute('data-flow-from', route.edge.from);
  path.setAttribute('data-flow-to', route.edge.to);
  if (route.label) path.setAttribute('data-flow-label', route.label);
  if (route.conditionText) path.setAttribute('data-flow-condition', route.conditionText);
  path.setAttribute('marker-end', `url(#flow-arrow-${route.edge.kind})`);
  const edgePresentation = presentFlowEdge(route.edge);
  if (technicalEdgesVisible) {
    path.setAttribute('role', 'img');
    path.setAttribute('aria-label', `技术连接：${edgePresentation.technicalText}`);
  } else {
    path.setAttribute('aria-hidden', 'true');
  }
  const title = el('title');
  title.textContent = `技术信息：${edgePresentation.technicalText}`;
  path.appendChild(title);
  world.appendChild(path);
}

/** 仅跨场景分支保留附着式说明；同场景选项已经写入目标段落行。 */
function drawRouteLabels(world: SVGElement, routes: readonly NarrativeRoute[]): void {
  for (const route of routes) {
    if (!route.label || route.labelX === undefined || route.labelY === undefined) continue;
    const routeText = route.conditionText ? `${route.label} · ${route.conditionText}` : route.label;
    const visibleText = truncateTextToWidth(routeText, 180, 10);
    const labelW = Math.min(192, visualTextWidth(visibleText, 10) + 18);
    const group = el('g');
    group.classList.add('flow-route-chip', `flow-route-chip--${route.edge.kind}`);
    group.setAttribute('data-flow-route-label', route.edge.kind);
    group.setAttribute('role', 'note');
    group.setAttribute('aria-label', `${flowEdgeKindLabel(route.edge.kind)}：${routeText}`);
    const bg = el('rect');
    bg.setAttribute('x', String(route.labelX - labelW / 2));
    bg.setAttribute('y', String(route.labelY - 10));
    bg.setAttribute('width', String(labelW));
    bg.setAttribute('height', '20');
    bg.setAttribute('rx', '2');
    bg.classList.add('flow-route-chip-surface');
    const mid = el('text');
    mid.setAttribute('x', String(route.labelX));
    mid.setAttribute('y', String(route.labelY + 3.5));
    mid.setAttribute('text-anchor', 'middle');
    mid.classList.add('flow-route-chip-text');
    mid.textContent = visibleText;
    const title = el('title');
    title.textContent = `技术信息：${presentFlowEdge(route.edge).technicalText}`;
    group.append(bg, mid, title);
    world.appendChild(group);
  }
}

function currentGraph(): FlowGraph {
  const scenes = state.lastValidation?.scenes ?? new Map();
  const roots = collectConfigSceneRoots(state.configFiles);
  return buildFlowGraph(scenes, roots);
}

/** 拖拽建链的插入动作（源节点 → 目标节点；写入源场景末尾，走 history 可 undo） */
function createLink(fromNode: FlowNode, toNode: FlowNode): void {
  const resolved = resolveFlowLinkSceneKeys(fromNode, toNode);
  if (!resolved) {
    setStatus('无法唯一确定剧情连接的两端，宿主入口与重复场景不可编辑', false, 5000);
    return;
  }
  const sceneKey = resolved.sourceKey;
  const sc = state.scenes.get(sceneKey)!;
  const line = buildJumpLine(fromNode, toNode);
  setSceneText(sceneKey, appendLineToScene(sc.text, sc.eol, line));
  setStatus(`已为场景“${fromNode.sceneId}”新增剧情跳转，可撤销；校验稍后刷新`, true, 4000);
  renderSidebar();
}

export function resolveFlowLinkSceneKeys(
  fromNode: FlowNode,
  toNode: FlowNode,
): { sourceKey: string; targetKey: string } | null {
  if (fromNode.kind === 'host-entry' || toNode.kind === 'host-entry') return null;
  const sourceKey = resolveSceneKeyForOperation(fromNode.sceneId);
  const targetKey = resolveSceneKeyForOperation(toNode.sceneId);
  return sourceKey && targetKey ? { sourceKey, targetKey } : null;
}

/** 右键上下文菜单（简单 DOM 浮层） */
let menuOutsideHandler: ((e: PointerEvent) => void) | null = null;
let menuBindTimer: ReturnType<typeof setTimeout> | null = null;
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
  rename.onclick = () => { closeSceneMenu(); renameSceneHook(sceneId); };
  const del = h('button', undefined, '删除场景…');
  del.setAttribute('role', 'menuitem');
  del.onclick = () => { closeSceneMenu(); deleteSceneHook(sceneId); };
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
  menuBindTimer = setTimeout(() => {
    menuBindTimer = null;
    menuOutsideHandler = (e: PointerEvent) => {
      const m = document.getElementById('flow-menu');
      if (m && !m.contains(e.target as Node)) closeSceneMenu();
    };
    document.addEventListener('pointerdown', menuOutsideHandler);
  }, 0);
}

function closeSceneMenu(restoreFocus = false): void {
  if (menuBindTimer !== null) { clearTimeout(menuBindTimer); menuBindTimer = null; }
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
  const key = resolveSceneKeyForOperation(node.sceneId);
  if (!key) {
    setStatus(`无法定位场景“${node.sceneId}”`, false, 4000);
    return;
  }
  openSceneHook(key, node.kind === 'label' ? node.line : undefined);
}

function drawSceneFrame(
  world: SVGElement,
  frame: NarrativeSceneFrame,
  currentSceneId: string | null,
  stats: Map<string, { errors: number; warnings: number }>,
): void {
  const group = el('g');
  group.classList.add('flow-scene-frame', `flow-scene-frame--${frame.component}`);
  group.setAttribute('data-flow-scene-frame', frame.sceneId);
  group.setAttribute('data-scene-id', frame.sceneId);
  group.setAttribute('data-flow-component', frame.component);
  const issue = stats.get(frame.sceneId);
  if ((issue?.errors ?? 0) > 0) group.classList.add('has-error');
  else if ((issue?.warnings ?? 0) > 0) group.classList.add('has-warning');
  if (currentSceneId === frame.sceneId) group.classList.add('is-current');

  const surface = el('rect');
  surface.classList.add('flow-scene-frame-surface');
  surface.setAttribute('x', String(frame.x));
  surface.setAttribute('y', String(frame.y));
  surface.setAttribute('width', String(frame.w));
  surface.setAttribute('height', String(frame.h));
  surface.setAttribute('rx', '2');

  const title = el('text');
  title.classList.add('flow-scene-frame-title');
  title.setAttribute('x', String(frame.x + 16));
  title.setAttribute('y', String(frame.y + 25));
  title.textContent = `场景 ${frame.sceneId}`;

  const statusParts: string[] = [];
  if (currentSceneId === frame.sceneId) statusParts.push('当前');
  if ((issue?.errors ?? 0) > 0) statusParts.push(`错误 ${issue!.errors}`);
  else if ((issue?.warnings ?? 0) > 0) statusParts.push(`警告 ${issue!.warnings}`);
  if (statusParts.length > 0) {
    const status = el('text');
    status.classList.add('flow-scene-frame-status');
    status.setAttribute('x', String(frame.x + frame.w - 16));
    status.setAttribute('y', String(frame.y + 25));
    status.setAttribute('text-anchor', 'end');
    status.textContent = statusParts.join(' · ');
    group.append(surface, title, status);
  } else {
    group.append(surface, title);
  }
  world.appendChild(group);
}

function drawComponentHeading(world: SVGElement, x: number, y: number, text: string, kind: 'main' | 'secondary'): void {
  const heading = el('text');
  heading.classList.add('flow-component-heading', `flow-component-heading--${kind}`);
  heading.setAttribute('x', String(x));
  heading.setAttribute('y', String(y));
  heading.setAttribute('data-flow-component-heading', kind);
  heading.textContent = text;
  world.appendChild(heading);
}

function drawReturnMarkers(
  world: SVGElement,
  layout: FlowLayout,
  markers: readonly NarrativeReturnMarker[],
): void {
  const bySource = new Map<string, NarrativeReturnMarker[]>();
  for (const marker of markers) {
    const group = bySource.get(marker.sourceSceneId) ?? [];
    group.push(marker);
    bySource.set(marker.sourceSceneId, group);
  }
  for (const [sourceSceneId, sourceMarkers] of bySource) {
    const frame = layout.frames.get(sourceSceneId);
    if (!frame) continue;
    sourceMarkers.forEach((marker, index) => {
      const group = el('g');
      group.classList.add('flow-return-marker');
      group.setAttribute('data-flow-return-target', marker.targetSceneId);
      group.setAttribute('role', 'link');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', marker.label);
      const y = frame.y + frame.h - 14 - (sourceMarkers.length - index) * 28;
      const surface = el('rect');
      surface.classList.add('flow-return-marker-surface');
      surface.setAttribute('x', String(frame.x + 16));
      surface.setAttribute('y', String(y));
      surface.setAttribute('width', String(frame.w - 32));
      surface.setAttribute('height', '22');
      surface.setAttribute('rx', '2');
      const text = el('text');
      text.classList.add('flow-return-marker-text');
      text.setAttribute('x', String(frame.x + 26));
      text.setAttribute('y', String(y + 15));
      text.textContent = marker.label;
      const openTarget = (): void => {
        const key = resolveSceneKeyForOperation(marker.targetSceneId);
        if (key) openSceneHook(key);
        else setStatus(`无法定位返回场景“${marker.targetSceneId}”`, false, 4000);
      };
      group.addEventListener('click', openTarget);
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openTarget();
      });
      group.append(surface, text);
      world.appendChild(group);
    });
  }
}

function drawNode(
  world: SVGElement,
  box: NodeBox,
  narrative: NarrativeNodePresentation | undefined,
  stats: Map<string, { errors: number; warnings: number }>,
  startNodeDrag: (nodeId: string, e: PointerEvent) => void,
): void {
  const { node } = box;
  const presentation = narrative ?? {
    primaryText: node.kind === 'scene' ? `场景 ${node.sceneId}` : node.label ?? node.sceneId,
    supportingText: node.kind === 'host-entry' ? '项目入口' : '剧情段落',
    technicalText: `${node.kind} · ${node.id}`,
  };
  const g = el('g');
  g.classList.add('flow-node', `flow-node--${node.kind}`, `flow-node-role--${box.role}`);
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
  rect.setAttribute('rx', box.role === 'entry' ? '12' : '2');
  const isCurrent = state.current !== null && node.kind === 'scene' && state.scenes.get(state.current)?.id === node.sceneId;
  const issue = stats.get(node.sceneId);
  const validationState = issue && issue.errors > 0 ? 'error' : issue && issue.warnings > 0 ? 'warning' : 'ok';
  const validationLabel = flowValidationStateLabel(validationState);
  if (isCurrent) g.classList.add('is-current');
  g.setAttribute('aria-current', isCurrent ? 'true' : 'false');
  g.setAttribute('data-flow-validation', validationState);
  g.setAttribute(
    'aria-description',
    technicalEdgesVisible ? `${validationLabel}；技术信息：${presentation.technicalText}` : validationLabel,
  );
  const issueText = validationState === 'error'
    ? `错误 ${issue?.errors ?? 0}`
    : validationState === 'warning'
      ? `警告 ${issue?.warnings ?? 0}`
      : '';
  const ariaParts = [presentation.primaryText, presentation.supportingText, isCurrent ? '当前场景' : '', issueText].filter(Boolean);
  g.setAttribute('aria-label', ariaParts.join('，'));

  const primary = el('text');
  primary.classList.add('flow-node-primary');
  primary.setAttribute('x', String(box.x + (box.role === 'entry' ? box.w / 2 : 12)));
  primary.setAttribute('y', String(box.y + (box.role === 'entry' ? 16 : 19)));
  if (box.role === 'entry') primary.setAttribute('text-anchor', 'middle');
  const label = box.role === 'scene'
    ? '场景入口'
    : box.role === 'scene-summary'
      ? '打开场景'
      : presentation.primaryText;
  primary.textContent = truncateTextToWidth(label, box.w - 24, 11);

  const meta = el('text');
  meta.classList.add('flow-node-meta');
  meta.setAttribute('x', String(box.x + 12));
  meta.setAttribute('y', String(box.y + 38));
  const metaParts = [presentation.supportingText];
  if (presentation.conditionText) metaParts.push(presentation.conditionText);
  const metaText = metaParts.join(' · ');
  meta.textContent = truncateTextToWidth(metaText, box.w - 24, 9);

  const title = el('title');
  title.textContent = `${presentation.primaryText}（点击打开；拖到其他节点可新增跳转）｜技术信息：${presentation.technicalText}`;
  if (box.role === 'entry') g.append(rect, primary, title);
  else g.append(rect, primary, meta, title);

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

/** 渲染路径地图到容器。真实节点全量留在 DOM，确保平移后无需重建也不会出现空框。 */
export function renderFlow(container: HTMLElement): void {
  container.innerHTML = '';
  closeSceneMenu();
  if (!technicalEdgesVisible) technicalDetailsExpanded = false;
  const graph = currentGraph();
  const currentSceneId = state.current === null ? null : state.scenes.get(state.current)?.id ?? null;
  const layout = layoutFlowGraph(graph, state.entryScene, {
    mode: flowViewMode,
    focusSceneId: currentSceneId ?? state.entryScene,
    technical: technicalEdgesVisible,
    maxPredecessors: 3,
    maxSuccessors: 4,
  });
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

  const workbench = h('section', 'flow-workbench');
  workbench.setAttribute('data-editor-region', 'flow-workbench');
  workbench.setAttribute('aria-label', '剧情流程工作台');

  const header = h('header', 'flow-workbench-header');
  const headingGroup = h('div', 'flow-heading-group');
  const heading = h('h2', 'flow-heading', '剧情路径地图');
  const current = h(
    'p',
    'flow-current-scene',
    `${currentSceneId ? `当前场景：${currentSceneId}` : '当前没有打开场景'} · 编辑视图，不代表唯一游玩路线`,
  );
  headingGroup.append(heading, current);

  const status = h('div', 'flow-status');
  status.setAttribute('data-editor-region', 'flow-status');
  status.setAttribute('data-flow-validation', validationState);
  status.setAttribute('aria-label', `流程状态：${flowValidationStateLabel(validationState)}`);
  const nodeCount = h('span', 'flow-stat', `场景 ${layout.frames.size}`);
  nodeCount.setAttribute('data-flow-stat', 'nodes');
  nodeCount.title = `技术信息：真实节点 ${graph.nodes.length}`;
  const edgeCount = h('span', 'flow-stat', `项目选择 ${graph.edges.filter((edge) => edge.kind === 'choice').length}`);
  edgeCount.setAttribute('data-flow-stat', 'edges');
  edgeCount.title = `技术信息：真实连接 ${graph.edges.length}；可投影 ${layout.routes.length}；未投影 ${layout.unprojectableEdges.length}`;
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
  const viewSwitch = h('div', 'flow-view-switch');
  viewSwitch.setAttribute('role', 'group');
  viewSwitch.setAttribute('aria-label', '剧情地图显示范围');
  const focusView = h('button', 'flow-view-switch-button', '聚焦路径') as HTMLButtonElement;
  focusView.type = 'button';
  focusView.setAttribute('data-flow-action', 'view-focus');
  focusView.setAttribute('aria-pressed', String(flowViewMode === 'focus' && !technicalEdgesVisible));
  const overviewView = h('button', 'flow-view-switch-button', '全局概览') as HTMLButtonElement;
  overviewView.type = 'button';
  overviewView.setAttribute('data-flow-action', 'view-overview');
  overviewView.setAttribute('aria-pressed', String(flowViewMode === 'overview' && !technicalEdgesVisible));
  viewSwitch.append(focusView, overviewView);
  const zoomOut = makeTool('缩小', '缩小流程画布');
  zoomOut.setAttribute('data-flow-action', 'zoom-out');
  const zoomIn = makeTool('放大', '放大流程画布');
  zoomIn.setAttribute('data-flow-action', 'zoom-in');
  const fitCanvas = makeTool('查看全图', '显示全部场景分镜与连接');
  fitCanvas.setAttribute('data-flow-action', 'fit-canvas');
  const focusCurrent = makeTool('回到当前', '把当前场景移到画布中央');
  focusCurrent.setAttribute('data-flow-action', 'focus-current');
  focusCurrent.disabled = currentSceneId === null;
  const toggleLegend = makeTool(legendExpanded ? '收起图例' : '展开图例', '显示或隐藏连接图例');
  toggleLegend.setAttribute('data-flow-action', 'toggle-legend');
  toggleLegend.setAttribute('aria-expanded', String(legendExpanded));
  toolbar.append(viewSwitch, zoomOut, zoomIn, fitCanvas, focusCurrent, toggleLegend);
  header.append(headingGroup, status, toolbar);

  const scopeNote = h('div', 'flow-scope-note');
  scopeNote.setAttribute('data-editor-region', 'flow-scope-note');
  if (layout.mode === 'focus') {
    const hiddenPredecessors = layout.focusOverflow?.predecessorCount ?? 0;
    const hiddenSuccessors = layout.focusOverflow?.successorCount ?? 0;
    const note = h('span', 'flow-scope-note-text', '当前仅显示聚焦场景和直接前后场景。');
    scopeNote.appendChild(note);
    if (hiddenPredecessors > 0 || hiddenSuccessors > 0) {
      note.textContent = `已收起 ${hiddenPredecessors} 个前置场景、${hiddenSuccessors} 个后续场景。`;
      const showAll = h('button', 'flow-scope-note-action', '在全局概览中查看') as HTMLButtonElement;
      showAll.type = 'button';
      showAll.setAttribute('data-flow-action', 'view-overview-overflow');
      scopeNote.appendChild(showAll);
    }
  } else if (layout.mode === 'overview') {
    scopeNote.appendChild(h('span', 'flow-scope-note-text', '全局概览只显示场景层；选择和段落在聚焦路径中展开。'));
  } else {
    scopeNote.appendChild(h('span', 'flow-scope-note-text', '技术连接显示完整可投影节点与真实连接。'));
  }
  header.appendChild(scopeNote);

  const canvas = h('div', 'flow-canvas');
  canvas.setAttribute('data-editor-region', 'flow-canvas');
  canvas.setAttribute('aria-label', '可平移、缩放并建立剧情跳转的流程画布');

  const legend = h('aside', 'flow-legend');
  legend.setAttribute('data-editor-region', 'flow-legend');
  legend.setAttribute('aria-label', '流程图例');
  legend.hidden = !legendExpanded;
  const legendHeading = h('h3', 'flow-legend-heading', '阅读说明');
  const nodeLegend = h('div', 'flow-legend-group');
  nodeLegend.append(
    h('span', 'flow-legend-title', '内容'),
    h('span', 'flow-legend-item flow-legend-scene', '场景分镜'),
    h('span', 'flow-legend-item flow-legend-label', '剧情段落'),
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
  technical.open = technicalDetailsExpanded;
  technical.addEventListener('toggle', () => {
    if (!technical.isConnected) return;
    technicalDetailsExpanded = technical.open;
  });
  const technicalSummary = document.createElement('summary');
  technicalSummary.textContent = '技术信息';
  const technicalPanel = h('div', 'flow-technical-panel');
  const technicalText = h(
    'p',
    'surdet-technical-text',
    `本页把编译结果整理成写作者可读的场景地图；稳定 ID、源码顺序与重复连接仍被保留，但默认不干扰阅读。${layout.unprojectableEdges.length > 0 ? `另有 ${layout.unprojectableEdges.length} 条连接因端点缺失未显示，请先修复校验问题。` : ''}`,
  );
  const toggleTechnical = h(
    'button',
    'flow-technical-toggle',
    technicalEdgesVisible ? '隐藏技术连接' : '显示技术连接',
  ) as HTMLButtonElement;
  toggleTechnical.type = 'button';
  toggleTechnical.setAttribute('data-flow-action', 'toggle-technical-edges');
  toggleTechnical.setAttribute('aria-pressed', String(technicalEdgesVisible));
  technicalPanel.append(technicalText, toggleTechnical);
  technical.append(technicalSummary, technicalPanel);
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
  const fitLayoutToViewport = (viewport: { width: number; height: number }): void => {
    const { minX, minY, maxX, maxY } = technicalEdgesVisible ? layout.bounds : layout.visibleBounds;
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = 56;
    const availableWidth = Math.max(1, viewport.width - padding * 2);
    const availableHeight = Math.max(1, viewport.height - padding * 2);
    view.k = Math.min(2, availableWidth / contentWidth, availableHeight / contentHeight);
    view.tx = (viewport.width - contentWidth * view.k) / 2 - minX * view.k;
    view.ty = (viewport.height - contentHeight * view.k) / 2 - minY * view.k;
  };
  if (pendingAutoFit) {
    pendingAutoFit = false;
    fitLayoutToViewport(initialViewport);
  }
  const svg = el('svg');
  svg.setAttribute('width', String(cw));
  svg.setAttribute('height', String(ch));
  svg.classList.add('flow-canvas-svg');
  svg.setAttribute('role', 'region');
  svg.setAttribute('aria-label', `剧情路径地图，${layout.frames.size} 个场景，${graph.edges.filter((edge) => edge.kind === 'choice').length} 个选择`);
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

  const mainFrames = [...layout.frames.values()].filter((frame) => frame.component === 'main');
  const secondaryFrames = [...layout.frames.values()].filter((frame) => frame.component === 'secondary');
  if (mainFrames.length > 0) {
    drawComponentHeading(
      world,
      Math.min(...mainFrames.map((frame) => frame.x)),
      Math.min(...mainFrames.map((frame) => frame.y)) - 20,
      layout.mode === 'focus'
        ? '当前聚焦路径'
        : layout.mode === 'overview'
          ? '全局场景概览'
          : '完整技术连接',
      'main',
    );
  }
  if (secondaryFrames.length > 0) {
    drawComponentHeading(
      world,
      Math.min(...secondaryFrames.map((frame) => frame.x)),
      Math.min(...secondaryFrames.map((frame) => frame.y)) - 24,
      '其他入口',
      'secondary',
    );
  }
  for (const frame of layout.frames.values()) drawSceneFrame(world, frame, currentSceneId, stats);

  // 技术连接仍属于同一份真实图，只在用户主动展开时显示。
  const renderedRoutes = layout.routes.filter((route) => technicalEdgesVisible || !route.hiddenByDefault);
  for (const route of renderedRoutes) drawRoute(world, route);

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
    drawNode(world, box, layout.nodePresentation.get(box.node.id), stats, startNodeDrag);
  }
  drawReturnMarkers(world, layout, layout.returnMarkers);
  drawRouteLabels(world, renderedRoutes);

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
  const switchViewMode = (nextMode: FlowMapMode, focusSelector: string): void => {
    flowViewMode = nextMode;
    technicalEdgesVisible = false;
    technicalDetailsExpanded = false;
    view = flowViews[nextMode];
    pendingAutoFit = true;
    rerenderFlow(container, focusSelector);
  };
  focusView.onclick = () => switchViewMode('focus', '[data-flow-action="view-focus"]');
  overviewView.onclick = () => switchViewMode('overview', '[data-flow-action="view-overview"]');
  const overflowOverview = scopeNote.querySelector<HTMLButtonElement>('[data-flow-action="view-overview-overflow"]');
  if (overflowOverview) {
    overflowOverview.onclick = () => switchViewMode('overview', '[data-flow-action="view-overview"]');
  }
  zoomOut.onclick = () => zoomAround(view.k / 1.2, undefined, undefined, '[data-flow-action="zoom-out"]');
  zoomIn.onclick = () => zoomAround(view.k * 1.2, undefined, undefined, '[data-flow-action="zoom-in"]');
  fitCanvas.onclick = () => {
    if (layout.boxes.size === 0) {
      setStatus('当前没有可适应的流程节点', false, 3000);
      return;
    }
    const viewport = currentViewportSize();
    fitLayoutToViewport(viewport);
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
  toggleTechnical.onclick = () => {
    technicalEdgesVisible = !technicalEdgesVisible;
    legendExpanded = true;
    technicalDetailsExpanded = technicalEdgesVisible;
    view = technicalEdgesVisible ? flowViews.technical : flowViews[flowViewMode];
    pendingAutoFit = true;
    rerenderFlow(container, '[data-flow-action="toggle-technical-edges"]');
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
