/**
 * 校验结果面板 + 校验编排（E0 拆分：原 main.ts 纯搬移，自我迭代①b）。
 * Worker 优先（不阻塞主线程），异常永久回退同步校验；结果按 seq 对齐丢弃过期回包。
 */
import { state, h, setStatus } from '../state.js';
import { validateProject } from '../validate.js';
import type { Issue } from '../validate.js';
import type { CompiledScene } from '@surdet/core';
import { renderSidebar } from './sidebar.js';
import { renderEditor } from './editor.js';
import { updateEdges, updateGraph } from './right.js';
import { refreshFlowIfVisible } from './flow.js';

let validateTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleValidate(): void {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidate, 300);
}

/** 组装校验输入（Worker 与同步回退共用；Phase 2C 接入 state.timelines，保留未保存编辑缓冲） */
function buildValidateInput(): { sources: { key: string; id: string; file: string; source: string }[]; entryScene: string | undefined; config: { raw: Record<string, unknown> | null; path: string }; timelines: { path: string; text: string }[] } {
  const sources = [...state.scenes.entries()].map(([key, sc]) => ({ key, id: sc.id, file: sc.file, source: sc.text }));
  let configRaw: Record<string, unknown> | null = null;
  if (state.gameConfigText) {
    try {
      configRaw = JSON.parse(state.gameConfigText) as Record<string, unknown>;
    } catch {
      configRaw = null;
    }
  }
  // 内存 timelines（file 相对 timelines 目录，含子目录前缀）→ 项目相对路径；不重读磁盘，未保存缓冲优先。
  const timelines = state.timelines.map((timeline) => ({
    path: timeline.file.startsWith('content/timelines/') ? timeline.file : `content/timelines/${timeline.file}`,
    text: timeline.text,
  }));
  return { sources, entryScene: state.entryScene || undefined, config: { raw: configRaw, path: 'game.config.json' }, timelines };
}

/** 应用校验结果并刷新 UI（Worker 回包与同步路径共用）。
 *  scenes 为编译产物（E1a 起保留：流程图从编译产物提取，不重新解析） */
export function applyValidation(issues: Issue[], edges: { from: string; to: string; kind: 'jump' | 'call' }[], scenes: Map<string, CompiledScene> = new Map()): void {
  state.lastValidation = { issues, scenes };
  state.lastEdges = edges;
  renderIssues();
  renderSidebar(); // 刷新脏标记
  updateEdges();   // 刷新场景引用图谱
  updateGraph();   // 刷新场景拓扑图（自我迭代⑤）
  refreshFlowIfVisible(); // 刷新流程图（E1a；仅当前在流程图标签页时）
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  setStatus(errors === 0 ? `校验通过（${warnings} 条警告）` : `${errors} 个错误 / ${warnings} 条警告`, errors === 0);
}

function runValidateSync(): void {
  const input = buildValidateInput();
  const result = validateProject(input.sources, input.entryScene, input.config, input.timelines);
  const edges: { from: string; to: string; kind: 'jump' | 'call' }[] = [];
  for (const [sceneId, scene] of result.scenes) {
    for (const instr of scene.instructions) {
      if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        edges.push({ from: sceneId, to: (instr as { target: string }).target, kind: instr.op === 'call' ? 'call' : 'jump' });
      }
    }
  }
  applyValidation(result.issues, edges, result.scenes);
}

export function runValidate(): void {
  // 优先 Worker（不阻塞主线程；自我迭代①b）；不可用/异常时同步回退
  if (validateWorker) {
    validateSeq += 1;
    const input = buildValidateInput();
    validateWorker.postMessage({ seq: validateSeq, ...input });
    return;
  }
  runValidateSync();
}

export function renderIssues(): void {
  const right = document.getElementById('right');
  if (!right) return;
  const old = document.getElementById('issues-box');
  if (old) old.remove();
  const box = h('div');
  box.id = 'issues-box';
  box.appendChild(h('h3', undefined, '校验结果'));
  const issues = state.lastValidation?.issues ?? [];
  if (issues.length === 0) {
    box.appendChild(h('div', 'empty', state.lastValidation ? '全部通过 ✓' : '等待校验…'));
  }
  for (const issue of issues.slice(0, 100)) {
    box.appendChild(renderIssue(issue));
  }
  // 插到右侧面板顶部（h3 之后）
  const firstH3 = right.querySelector('h3');
  if (firstH3 && firstH3.parentElement === right) right.insertBefore(box, firstH3.nextSibling);
  else right.prepend(box);
}

function renderIssue(issue: Issue): HTMLElement {
  const el = h('div', 'issue ' + issue.severity);
  const loc = h('div', 'loc', `${issue.file}:${issue.line}:${issue.col}`);
  const msg = h('div', undefined, issue.text);
  el.append(loc, msg);
  el.onclick = () => {
    // 跳转到对应场景与行：场景 Map 的 key 是相对路径（M4），由文件名推导 key；
    // 推导不中再按 basename 回退（部分告警以 sceneId 上报）——修复子目录场景点击失效
    let key = issue.file.replace(/\.gal$/, '');
    if (!state.scenes.has(key)) {
      const base = key.split('/').pop() ?? key;
      key = [...state.scenes.keys()].find((k) => k === base || k.endsWith('/' + base)) ?? base;
    }
    if (state.scenes.has(key)) {
      state.current = key;
      renderSidebar();
      renderEditor();
      const target = document.querySelector(`.block[data-line="${Math.max(0, issue.line - 1)}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('selected');
    }
  };
  return el;
}

/* ============================ 校验 Worker（自我迭代①b） ============================ */

let validateWorker: Worker | null = null;
let validateSeq = 0;
try {
  validateWorker = new Worker(new URL('../validate-worker.ts', import.meta.url), { type: 'module' });
  validateWorker.onmessage = (e: MessageEvent) => {
    const data = e.data as { seq: number; ok: boolean; issues?: Issue[]; edges?: { from: string; to: string; kind: 'jump' | 'call' }[]; scenes?: Map<string, CompiledScene>; error?: string };
    if (data.seq !== validateSeq) return; // 过期结果丢弃：校验永远以最新编辑快照为准
    if (data.ok && data.issues) {
      applyValidation(data.issues, data.edges ?? [], data.scenes ?? new Map());
    } else {
      // Worker 内部异常：终止并永久回退同步校验（功能不缺失）
      validateWorker?.terminate();
      validateWorker = null;
      runValidateSync();
    }
  };
  validateWorker.onerror = () => {
    validateWorker?.terminate();
    validateWorker = null; // 构造/加载失败：同步回退
  };
} catch {
  validateWorker = null;
}
