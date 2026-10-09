/**
 * 校验结果面板 + 校验编排（E0 拆分：原 main.ts 纯搬移，自我迭代①b）。
 * Worker 优先（不阻塞主线程），异常永久回退主线程校验；结果按 seq 对齐丢弃过期回包。
 */
import { state, h, setStatus } from '../state.js';
import { configSourceError, configSourcePath, type ConfigSourceName } from '../config-source.js';
import { validateProject } from '../validate.js';
import type { Issue, ProjectConfig } from '../validate.js';
import { hintForCode, type CompiledScene, type SourceRange } from '@surdet/core';
import { parseProjectConfigDocument } from '@surdet/authoring';
import { renderSidebar } from './sidebar.js';
import { updateEdges, updateGraph } from './right.js';
import { refreshFlowIfVisible } from './flow.js';
import { updateProblemIndicator, type ProblemSummary } from '../shell/app-shell.js';

let validateTimer: ReturnType<typeof setTimeout> | null = null;
let onIssueJumpHook: (sceneKey: string, line: number, range?: SourceRange) => void = () => {};
let onTimelineJumpHook: (timelineId: string) => void = () => {};
let onConfigJumpHook: () => void = () => {};
let onValidationAppliedHook: () => void = () => {};

export function bindIssueNavigation(opts: {
  onJump: (sceneKey: string, line: number, range?: SourceRange) => void;
  onTimeline?: (timelineId: string) => void;
  onConfig?: () => void;
  onValidationApplied?: () => void;
}): void {
  onIssueJumpHook = opts.onJump;
  onTimelineJumpHook = opts.onTimeline ?? (() => {});
  onConfigJumpHook = opts.onConfig ?? (() => {});
  onValidationAppliedHook = opts.onValidationApplied ?? (() => {});
}

/** 项目身份切换时使旧定时器和 Worker 回包失效，禁止旧项目校验覆盖新项目。 */
export function invalidatePendingValidation(): void {
  if (validateTimer) {
    clearTimeout(validateTimer);
    validateTimer = null;
  }
  validateSeq += 1;
}

export function scheduleValidate(): void {
  if (validateTimer) clearTimeout(validateTimer);
  // Editing invalidates results immediately, including the debounce window.
  validateSeq += 1;
  validateTimer = setTimeout(runValidate, 300);
}

/** 组装校验输入（Worker 与同步回退共用；Phase 2C 接入 state.timelines，保留未保存编辑缓冲） */
function buildValidateInput(): { sources: { key: string; id: string; file: string; source: string }[]; entryScene: string | undefined; config: ProjectConfig; timelines: { path: string; text: string }[] } {
  const sources = [...state.scenes.entries()].map(([key, sc]) => ({ key, id: sc.id, file: sc.file, source: sc.text }));
  let configRaw: Record<string, unknown> | null = null;
  if (state.gameConfigText) {
    try {
      configRaw = parseProjectConfigDocument(state.gameConfigText);
    } catch {
      configRaw = null;
    }
  }
  // 内存 timelines（file 相对 timelines 目录，含子目录前缀）→ 项目相对路径；不重读磁盘，未保存缓冲优先。
  const timelines = state.timelines.map((timeline) => ({
    path: timeline.file.startsWith('content/timelines/') ? timeline.file : `content/timelines/${timeline.file}`,
    text: timeline.text,
  }));
  return { sources, entryScene: state.entryScene || undefined, config: { raw: configRaw, path: 'game.config.json',
    ...(state.configFiles.terminology === null ? {} : { terminologyText: JSON.stringify(state.configFiles.terminology) }),
    ...(state.configFiles.gallery === null ? {} : { galleryText: JSON.stringify(state.configFiles.gallery) }) }, timelines };
}

/** 应用校验结果并刷新 UI（Worker 回包与同步路径共用）。
 *  scenes 为编译产物（E1a 起保留：流程图从编译产物提取，不重新解析） */
export function applyValidation(issues: Issue[], edges: { from: string; to: string; kind: 'jump' | 'call' }[], scenes: Map<string, CompiledScene> = new Map()): void {
  appliedValidationSeq = validateSeq;
  const configIssues = (Object.keys(state.handles) as ConfigSourceName[]).flatMap(name => {
    const error = configSourceError(name);
    return error ? [{ severity: 'error' as const, code: 'CONFIG_READ_ERROR', file: configSourcePath(name), line: 1, col: 1,
      text: error, hint: '请修正文件或恢复读取权限后重新打开项目；原文件未被修改。' }] : [];
  });
  issues = [...issues, ...configIssues];
  state.lastValidation = { issues, scenes };
  state.lastEdges = edges;
  renderIssues();
  renderSidebar(); // 刷新脏标记
  updateEdges();   // 刷新场景引用图谱
  updateGraph();   // 刷新场景拓扑图（自我迭代⑤）
  refreshFlowIfVisible(); // 刷新流程图（E1a；仅当前在流程图标签页时）
  onValidationAppliedHook();
  updateProblemIndicator(problemSummary());
}

export function problemSummary(): ProblemSummary | null {
  const issues = state.lastValidation?.issues;
  if (!issues) return null;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

let problemCursor = -1;
/** F8 / Shift+F8: jump through the current problems in list order, announcing each one. */
export function stepProblem(direction: 1 | -1): void {
  if (!isValidationCurrent()) { setStatus(STALE_LOCATION, false, 4000); return; }
  const issues = state.lastValidation?.issues ?? [];
  if (issues.length === 0) { setStatus('没有需要处理的问题', true, 2500); return; }
  problemCursor = problemCursor < 0 || problemCursor >= issues.length
    ? (direction > 0 ? 0 : issues.length - 1)
    : (problemCursor + direction + issues.length) % issues.length;
  const issue = issues[problemCursor]!;
  if (!jumpToIssue(issue)) return;
  const hint = specificHint(issue);
  setStatus(`问题 ${problemCursor + 1}/${issues.length}（${issue.file}:${issue.line}）：${issueMessage(issue)}${hint ? `　建议：${hint}` : ''}`, issue.severity !== 'error', 8000);
}

const STALE_LOCATION = '内容已修改，请等待重新校验后再定位';

/** file:line:col, or the exact extent when the validation reported one. */
function issueLocation(issue: Issue): string {
  const range = issue.range;
  if (range === undefined) return `${issue.file}:${issue.line}:${issue.col}`;
  const end = range.end.line === range.start.line ? `${range.end.col}` : `${range.end.line}:${range.end.col}`;
  return `${issue.file}:${range.start.line}:${range.start.col}–${end}`;
}

/** Some lint messages repeat the location already shown beside them. */
function issueMessage(issue: Issue): string {
  const located = `${issue.file.split('/').pop()}:${issue.line}:${issue.col}:`;
  return issue.text.startsWith(located) ? issue.text.slice(located.length).trimStart() : issue.text;
}

// Unknown codes get a generic pointer to the DSL docs; only code-specific advice helps here.
const GENERIC_HINT = hintForCode('');
const specificHint = (issue: Issue): string => issue.hint && issue.hint !== GENERIC_HINT ? issue.hint : '';

async function runValidateOnMainThread(seq: number): Promise<void> {
  const input = buildValidateInput();
  const result = await validateProject(input.sources, input.entryScene, input.config, input.timelines);
  if (seq !== validateSeq) return;
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
  // 两条路径都按输入序号丢弃过期结果；摘要计算也可能跨越项目切换。
  const seq = ++validateSeq;
  if (validateWorker) {
    const input = buildValidateInput();
    validateWorker.postMessage({ seq, ...input });
    return;
  }
  void runValidateOnMainThread(seq).catch(error => {
    if (seq === validateSeq) setStatus(`校验失败：${error instanceof Error ? error.message : String(error)}`, false);
  });
}

export function renderIssues(): void {
  const right = document.getElementById('right');
  if (!right) return;
  const old = document.getElementById('issues-box');
  // Validation reruns on every edit; keep keyboard focus on the same entry across the rebuild.
  const focused = old?.contains(document.activeElement) ? [...old.querySelectorAll('button.issue')].indexOf(document.activeElement as Element) : null;
  if (old) old.remove();
  const box = h('section', 'context-section validation-section');
  box.id = 'issues-box';
  box.setAttribute('data-editor-region', 'validation-context');
  box.tabIndex = -1;
  box.appendChild(h('h2', undefined, '校验结果'));
  const issues = state.lastValidation?.issues ?? [];
  if (issues.length === 0) {
    box.appendChild(h('div', 'empty', state.lastValidation ? '全部通过 ✓' : '等待校验…'));
  } else {
    box.appendChild(h('p', 'issue-keys', 'F8 下一条 · Shift+F8 上一条'));
  }
  for (const issue of issues.slice(0, 100)) {
    box.appendChild(renderIssue(issue));
  }
  if (issues.length > 100) box.appendChild(h('p', 'empty', `当前显示前 100 条，共 ${issues.length} 条；修复后重新校验可继续查看。`));
  // 插到右侧面板顶部（h3 之后）
  const firstH3 = right.querySelector('h3');
  if (firstH3 && firstH3.parentElement === right) right.insertBefore(box, firstH3.nextSibling);
  else right.prepend(box);
  if (focused !== null) {
    const entries = box.querySelectorAll<HTMLElement>('button.issue');
    (entries[Math.min(focused, entries.length - 1)] ?? box).focus({ preventScroll: true });
  }
}

function renderIssue(issue: Issue): HTMLElement {
  const issueSeq = appliedValidationSeq;
  const el = h('button', 'issue ' + issue.severity);
  el.type = 'button';
  const loc = h('span', 'loc', issueLocation(issue));
  if (issue.code) loc.append(h('span', 'issue-code', issue.code));
  el.append(loc, h('span', 'issue-text', issueMessage(issue)));
  const hint = specificHint(issue);
  if (hint) el.append(h('span', 'issue-hint', `建议：${hint}`));
  el.onclick = () => { jumpToIssue(issue, issueSeq); };
  return el;
}

/**
 * The one jump for clicks, Enter, F8/Shift+F8 and the status bar entry. A
 * location (and its range) belongs only to the unchanged input it was
 * computed from: after an edit nothing jumps until the new validation lands,
 * and an entry from an older list never jumps.
 */
function jumpToIssue(issue: Issue, seq = appliedValidationSeq): boolean {
  if (!isValidationCurrent() || seq !== appliedValidationSeq) {
    setStatus(STALE_LOCATION, false, 4000);
    return false;
  }
  const timeline = state.timelines.find((entry) =>
    (entry.file.startsWith('content/timelines/') ? entry.file : `content/timelines/${entry.file}`) === issue.file);
  if (timeline) { onTimelineJumpHook(timeline.id); return true; }
  if (issue.file === 'game.config.json' || issue.file.startsWith('content/config/')) { onConfigJumpHook(); return true; }
  // 跳转到对应场景与行：场景 Map 的 key 是相对路径（M4），由文件名推导 key；
  // 推导不中再按 basename 回退（部分告警以 sceneId 上报）——修复子目录场景点击失效
  let key = issue.file.replace(/^content\/scenario\//, '').replace(/\.gal$/i, '');
  if (!state.scenes.has(key)) {
    const base = key.split('/').pop() ?? key;
    const matches = [...state.scenes.keys()].filter((k) => k === base || k.endsWith('/' + base));
    if (matches.length !== 1) {
      setStatus(`无法唯一定位“${issue.file}”，请从目录选择具体文件`, false, 4000);
      return false;
    }
    key = matches[0]!;
  }
  onIssueJumpHook(key, Math.max(0, issue.line - 1), issue.range);
  return true;
}

/* ============================ 校验 Worker（自我迭代①b） ============================ */

let validateWorker: Worker | null = null;
let validateSeq = 0;
let appliedValidationSeq = -1;

/** A displayed diagnostic and its range belong only to the last unchanged input. */
export function isValidationCurrent(): boolean {
  return appliedValidationSeq === validateSeq;
}
try {
  validateWorker = new Worker(new URL('../validate-worker.ts', import.meta.url), { type: 'module' });
  validateWorker.onmessage = (e: MessageEvent) => {
    const data = e.data as { seq: number; ok: boolean; issues?: Issue[]; edges?: { from: string; to: string; kind: 'jump' | 'call' }[]; scenes?: Map<string, CompiledScene>; error?: string };
    if (data.seq !== validateSeq) return; // 过期结果丢弃：校验永远以最新编辑快照为准
    if (data.ok && data.issues) {
      applyValidation(data.issues, data.edges ?? [], data.scenes ?? new Map());
    } else {
      // Worker 内部异常：终止并永久回退主线程校验（功能不缺失）
      validateWorker?.terminate();
      validateWorker = null;
      runValidate();
    }
  };
  validateWorker.onerror = () => {
    validateWorker?.terminate();
    validateWorker = null; // 构造/加载失败：同步回退
    runValidate();
  };
} catch {
  validateWorker = null;
}
