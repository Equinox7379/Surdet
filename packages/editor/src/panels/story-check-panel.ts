import { DEFAULT_AUTHORING_EVIDENCE_SEED, type SimulationOptions, type StoryCoverage, type StoryLocation } from '@surdet/authoring';
import type { VarValue } from '@surdet/core';
import { state, h } from '../state.js';
import { assertConfigSourcesReadable } from '../config-source.js';
import { workingGameConfigText } from '../project-io.js';
import { previewTextHash } from '../preview-content.js';
import { inspectConfigDraftState } from './config.js';
import { clearStoryPreview, readStoryPreview, storyDiagnostic, storyInputKey, type StoryCheckInput, type StoryCheckResult, type StoryCheckFailure } from '../story-check.js';

let saved: { owner: unknown; input: StoryCheckInput; key: string; result: StoryCheckResult } | null = null;
let failed: { owner: unknown; input: StoryCheckInput; key: string; error: StoryCheckFailure } | null = null;
let disposeActive: (() => void) | null = null;
let refreshActive: (() => void) | null = null;
export function disposeStoryCheckPanel() { disposeActive?.(); disposeActive = null; refreshActive = null; }
export function resetStoryChecks() { disposeStoryCheckPanel(); saved = null; failed = null; clearStoryPreview(); }
export function refreshStoryChecks() { refreshActive?.(); }

export function captureStoryCheckInput(): StoryCheckInput {
  assertConfigSourcesReadable();
  if (inspectConfigDraftState().dirty) throw new Error('请先保存或撤销配置草稿，再运行剧情检查。剧本和时间轴可使用当前未保存稿。');
  if (state.projectLoading || state.reviewWorkspace || state.reviewPreviewReadOnly) throw new Error('请先回到已打开的普通创作项目。');
  const files: Record<string, string> = { 'game.config.json': workingGameConfigText() || '{}' };
  for (const scene of state.scenes.values()) files[scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`] = scene.text;
  for (const timeline of state.timelines) files[timeline.file.startsWith('content/timelines/') ? timeline.file : `content/timelines/${timeline.file}`] = timeline.text;
  for (const [name, config] of Object.entries(state.configFiles)) if (config !== null) files[`content/config/${name}.json`] = JSON.stringify(config);
  return { files };
}
const branchNames = { visited: '已选择', unvisited: '未访问', 'condition-not-met': '本次条件未满足', 'budget-exhausted': '预算停止' };
// The headless check never runs project code; a plugin instruction stops it.
const stopNames: Record<StoryCoverage['stops'][number]['kind'], string> = {
  'runtime-error': '运行失败', 'path-budget': '路径预算停止', 'step-budget': '推进预算停止', 'requires-extension': '需要扩展，未运行',
};
function current(record: { owner: unknown; key: string } | null): boolean {
  try { return record !== null && record.owner === state.dirHandle && record.key === storyInputKey(captureStoryCheckInput()); } catch { return false; }
}

export function renderStoryCheckPanel(container: HTMLElement, onSource: (file: string, line: number) => void) {
  disposeStoryCheckPanel();
  const root = h('section', 'project-health-workspace story-check-workspace');
  root.dataset.editorRegion = 'story-check';
  root.append(h('h2', undefined, '剧情检查'), h('p', 'project-health-description', '从项目入口自动走剧情分支，记录实际访问和条件结果。按本次初值与预算检查；画面、声音和宿主玩法还需要真实试玩。'));
  const controls = h('div', 'story-check-controls');
  const number = (label: string, value: number) => {
    const wrap = h('label'); wrap.append(h('span', undefined, label)); const input = h('input'); input.type = 'number'; input.value = String(value);
    input.min = '1'; input.step = '1'; input.setAttribute('aria-label', label); wrap.append(input); controls.append(wrap); return input;
  };
  const paths = number('最多检查路径', 50), steps = number('每条路径推进预算', 2000), seed = number('随机种子', DEFAULT_AUTHORING_EVIDENCE_SEED);
  paths.max = '2000'; steps.max = '100000';
  seed.min = '0'; seed.max = String(0xffffffff);
  const extra = h('details', 'project-health-technical'); extra.append(h('summary', undefined, '测试初值（可选）'));
  const overrides = h('textarea'); overrides.rows = 3; overrides.placeholder = '{"好感":10}'; overrides.setAttribute('aria-label', '测试初值');
  extra.append(h('p', undefined, '仅用于本次模拟，留空使用项目初始值。相同内容、初值和种子可重现模拟结果。'), overrides);
  const run = h('button', undefined, '运行剧情检查'), cancel = h('button', undefined, '取消检查'), download = h('button', undefined, '导出检查与试玩诊断');
  cancel.hidden = true;
  const status = h('p', 'project-health-description'); status.setAttribute('role', 'status');
  const body = h('div', 'story-check-results');
  let worker: Worker | null = null;
  const owner = state.dirHandle;
  const mounted = () => root.isConnected && state.dirHandle === owner && !state.projectLoading;
  const stop = () => { worker?.terminate(); worker = null; run.disabled = false; cancel.hidden = true; };
  disposeActive = stop;
  const locationButton = (label: string, location: Pick<StoryLocation, 'file' | 'line'>, input: StoryCheckInput, valid: boolean) => {
    const button = h('button', 'project-health-scene-link', label); button.type = 'button'; button.disabled = !valid;
    button.onclick = () => {
      if (!mounted() || !current({ owner, key: storyInputKey(input) })) { status.textContent = '内容已修改，请重新检查后定位。'; render(); return; }
      onSource(location.file, Math.max(0, location.line - 1));
    }; return button;
  };
  const list = (title: string, items: HTMLElement[], count = items.length) => {
    const details = h('details', 'story-check-list'); details.append(h('summary', undefined, `${title}（${count}）`));
    for (const item of items.slice(0, 100)) details.append(item);
    if (count > 100) details.append(h('p', undefined, '这里显示前 100 项，完整位置与计数可导出查看。'));
    body.append(details);
  };
  const render = () => {
    if (!mounted()) return;
    body.replaceChildren();
    const record = saved?.owner === owner ? saved : null, failure = failed?.owner === owner ? failed : null;
    const valid = current(record);
    if (record) {
      const { report } = record.result, coverage = report.coverage;
      body.append(h('h3', undefined, `${report.status === 'failed' ? '发现运行失败' : report.status === 'incomplete' ? report.budgetExhausted ? '检查达到预算上限' : '检查未走完：途中需要项目插件' : '本次模拟已结束'} · ${valid ? '对应当前内容' : '内容已修改，请重新检查'}`),
        h('p', undefined, `入口 ${report.entryScene} · 路径探索计数 ${report.pathsExplored} · 场景访问 ${coverage.scenes.filter(scene => scene.visited).length}/${coverage.scenes.length} · 选项选择 ${coverage.branches.filter(branch => branch.selected > 0).length}/${coverage.branches.length}`),
        h('p', 'project-health-description', `本次参数：路径上限 ${record.result.options.maxPaths ?? 500} · 推进上限 ${record.result.options.maxStepsPerPath ?? 20000} · 随机种子 ${report.seed} · 测试初值 ${Object.keys(record.result.options.initialVariables ?? {}).length} 项`));
      if (report.budgetExhausted) body.append(h('p', undefined, '预算已用尽，以下为部分结果；未访问项不代表不可达。可调整预算后重测。'));
      if (coverage.hostInstructions.length) body.append(h('p', undefined, `本次经过 ${coverage.hostInstructions.length} 处宿主或自定义指令，模拟不驱动这些玩法结果，请在真实试玩中核对。`));
      list('场景访问', coverage.scenes.map(scene => locationButton(`${scene.visited ? '已访问' : '未访问'} · ${scene.sceneId}`, { file: scene.file, line: 1 }, record.input, valid)));
      list('选项访问', coverage.branches.map(branch => locationButton(`${branchNames[branch.status]} · ${branch.location.sceneId} 第 ${branch.location.line} 行 · ${branch.label}`, branch.location, record.input, valid)));
      list('条件观察', coverage.conditions.map(condition => locationButton(`${condition.location.sceneId} 第 ${condition.location.line} 行 · 成立 ${condition.trueCount} 次，不成立 ${condition.falseCount} 次${condition.trueCount + condition.falseCount === 0 ? '（未执行）' : ''}`, condition.location, record.input, valid)));
      list('中断与错误', coverage.stops.map(point => {
        const row = h('div', 'story-check-stop'); row.append(h('p', undefined, `${stopNames[point.kind]}：${point.message}`));
        if (point.location) row.append(locationButton(`打开 ${point.location.sceneId} 第 ${point.location.line} 行`, point.location, record.input, valid)); return row;
      }));
    }
    if (failure) {
      body.append(h('p', undefined, `检查未能启动${current(failure) ? '' : '（内容已修改）'}：${failure.error.message}`));
      if (failure.error.file && failure.error.line) body.append(locationButton('打开错误位置', { file: failure.error.file, line: failure.error.line }, failure.input, current(failure)));
    }
    const preview = readStoryPreview();
    if (preview?.owner === owner) {
      const validPreview = preview.working && preview.isCurrent();
      body.append(h('h3', undefined, `最近真实试玩 · ${preview.scope}`), h('p', undefined,
        `${preview.working ? validPreview ? '对应当前内容' : '内容已修改，记录属于旧版本' : '固定隔离版本，不与当前编辑稿合并'} · ${preview.status === 'failed' ? '试玩失败' : preview.status === 'passed' ? '本次试玩结束' : '本次试玩未结束'} · ${preview.scenes.length} 个场景 · ${preview.choices} 次真实选择 · ${preview.eventCount} 条事件`));
      const previewLocation = (label: string, location: StoryLocation) => {
        const button = h('button', 'project-health-scene-link', label); button.type = 'button'; button.disabled = !validPreview;
        button.onclick = () => {
          if (!mounted() || readStoryPreview() !== preview || !preview.isCurrent()) { status.textContent = '试玩内容已变化，请重新试玩后定位。'; render(); return; }
          onSource(location.file, Math.max(0, location.line - 1));
        }; return button;
      };
      for (const error of preview.errors) {
        body.append(h('p', undefined, `试玩失败：${error.message}`));
        if (error.location) body.append(previewLocation(`打开试玩错误 · ${error.location.sceneId} 第 ${error.location.line} 行`, error.location));
      }
      const last = preview.events.at(-1)?.location;
      if (last) body.append(previewLocation(`打开最近试玩位置 · ${last.sceneId} 第 ${last.line} 行`, last));
    }
    download.disabled = !record && !failure && preview?.owner !== owner;
    if (!record && !failure && preview?.owner !== owner) body.append(h('p', undefined, '尚未运行检查或记录真实试玩。'));
  };
  refreshActive = render;
  run.onclick = () => {
    if (!mounted() || worker) return;
    try {
      const input = captureStoryCheckInput(), key = storyInputKey(input);
      const values = [Number(paths.value), Number(steps.value), Number(seed.value)];
      if (!values.every(Number.isSafeInteger) || values[0]! < 1 || values[0]! > 2000 || values[1]! < 1 || values[1]! > 100000 || values[2]! < 0 || values[2]! > 0xffffffff)
        throw new Error('路径预算须为 1 到 2000，推进预算须为 1 到 100000 的整数；随机种子须在 0 到 4294967295 之间。');
      const initial: unknown = overrides.value.trim() ? JSON.parse(overrides.value) : undefined;
      if (initial !== undefined && (!initial || typeof initial !== 'object' || Array.isArray(initial))) throw new Error('测试初值须为变量名到数值、开关、文本或列表的配置对象。');
      const options: SimulationOptions = { maxPaths: values[0], maxStepsPerPath: values[1], seed: values[2], ...(initial === undefined ? {} : { initialVariables: initial as Record<string, VarValue> }) };
      worker = new Worker(new URL('../story-check-worker.ts', import.meta.url), { type: 'module' });
      const active = worker;
      active.onmessage = (event: MessageEvent<{ result?: StoryCheckResult; error?: StoryCheckFailure }>) => {
        if (worker !== active || !mounted()) return;
        stop();
        if (event.data.result) { saved = { owner, input, key, result: event.data.result }; failed = null; }
        else if (event.data.error) { saved = null; failed = { owner, input, key, error: event.data.error }; }
        status.textContent = '检查已结束。'; render();
      };
      active.onerror = event => { if (worker !== active || !mounted()) return; stop(); saved = null; failed = { owner, input, key, error: { message: event.message || '检查进程未能完成。', code: 'STORY_WORKER_FAILED' } }; status.textContent = '检查未完成。'; render(); };
      active.postMessage({ input, options }); run.disabled = true; cancel.hidden = false; status.textContent = '正在检查当前剧本与时间轴…';
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  };
  cancel.onclick = () => { stop(); status.textContent = '已取消，本次没有生成新检查结果。'; render(); };
  download.onclick = async () => {
    if (!mounted()) return;
    const record = saved?.owner === owner ? saved : null, failure = failed?.owner === owner ? failed : null, preview = readStoryPreview();
    try {
      // Hash the captured input even if it could not compile. Never identify an old error with the later draft.
      const inputRevision = failure ? await previewTextHash(failure.key) : null;
      if (!mounted()) return;
      const value = storyDiagnostic({ check: record?.result, checkCurrent: current(record),
        failure: failure && inputRevision ? { error: failure.error, inputRevision, current: current(failure) } : null,
        preview: preview?.owner === owner ? preview : null });
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
      const a = h('a'); a.href = url; a.download = 'surdet-story-diagnostic.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '已导出版本、位置与计数；正文、变量值、原始错误详情和画面快照未包含。';
    } catch (error) { if (mounted()) status.textContent = `诊断导出失败，请重试：${error instanceof Error ? error.message : String(error)}`; }
  };
  controls.append(run, cancel, download); root.append(controls, extra, status, body); container.append(root); render();
}
