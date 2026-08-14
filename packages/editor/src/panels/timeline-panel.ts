import type { TimelineCue, TimelineDefinition, TimelineTrack, TimelineTrackKind } from '@surdet/core';
import { state, h, setStatus } from '../state.js';
import { exportTimeline } from '../project-io.js';
import {
  cloneTimeline, createCue, createTimeline, createTrack, parseTimelineText,
  stringifyTimeline, easingPath, TIMELINE_ACTIONS, TIMELINE_EASINGS, TIMELINE_TRACKS,
} from '../timeline-model.js';

interface CueSelection {
  timelineId: string;
  trackIndex: number;
  cueIndex: number;
}

let selectedCue: CueSelection | null = null;
let rootContainer: HTMLElement | null = null;
let onPreview: (timelineId: string) => void = () => {};

export function bindTimelineHooks(opts: { onPreview: (timelineId: string) => void }): void {
  onPreview = opts.onPreview;
}

function entryFor(id = state.currentTimeline): (typeof state.timelines)[number] | undefined {
  return id ? state.timelines.find((entry) => entry.id === id) : undefined;
}

function activeDefinition(): { entry: (typeof state.timelines)[number]; definition: TimelineDefinition; issues: string[] } | null {
  const entry = entryFor();
  if (!entry) return null;
  const result = parseTimelineText(entry.text);
  return { entry, definition: result.definition ?? createTimeline(entry.id), issues: result.issues };
}

function normalizeTiming(definition: TimelineDefinition): void {
  definition.durationMs = Math.max(0, Math.min(600000, Math.round(definition.durationMs)));
  for (const track of definition.tracks) {
    for (const cue of track.cues) {
      cue.atMs = Math.max(0, Math.min(definition.durationMs, Math.round(cue.atMs)));
      cue.durationMs = Math.max(0, Math.min(definition.durationMs - cue.atMs, Math.round(cue.durationMs)));
    }
  }
}

function commit(mutator: (definition: TimelineDefinition) => void): void {
  const active = activeDefinition();
  if (!active || active.issues.length > 0) return;
  const next = cloneTimeline(active.definition);
  mutator(next);
  normalizeTiming(next);
  active.entry.text = stringifyTimeline(next);
  active.entry.dirty = true;
  renderTimelinePanel(rootContainer);
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = h('label', 'timeline-field');
  wrap.append(h('span', undefined, label), control);
  return wrap;
}

function numberInput(value: number, min = 0, max?: number): HTMLInputElement {
  const input = h('input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = '1';
  return input;
}

function textInput(value: string, placeholder = ''): HTMLInputElement {
  const input = h('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function selectInput(options: readonly string[], value: string): HTMLSelectElement {
  const select = h('select');
  for (const option of options) {
    const item = h('option', undefined, option);
    item.value = option;
    item.selected = option === value;
    select.appendChild(item);
  }
  return select;
}

function updateCue(selection: CueSelection, mutator: (cue: TimelineCue, track: TimelineTrack) => void): void {
  commit((definition) => {
    const track = definition.tracks[selection.trackIndex];
    const cue = track?.cues[selection.cueIndex];
    if (track && cue) mutator(cue, track);
  });
}

function renderInspector(parent: HTMLElement, definition: TimelineDefinition): void {
  const selection = selectedCue;
  const track = selection ? definition.tracks[selection.trackIndex] : undefined;
  const cue = track?.cues[selection!.cueIndex];
  if (!selection || !track || !cue) {
    parent.append(h('div', 'timeline-inspector-empty', '选择一个 cue 查看参数'));
    return;
  }

  parent.append(h('div', 'timeline-inspector-kicker', `轨道 ${selection.trackIndex + 1} · cue ${selection.cueIndex + 1}`));
  const common = h('div', 'timeline-inspector-grid');
  const at = numberInput(cue.atMs, 0, definition.durationMs);
  at.onchange = () => updateCue(selection, (next) => { next.atMs = Math.max(0, Math.round(Number(at.value) || 0)); });
  common.appendChild(field('开始（毫秒）', at));
  const duration = numberInput(cue.durationMs, 0, definition.durationMs);
  duration.onchange = () => updateCue(selection, (next) => { next.durationMs = Math.max(0, Math.round(Number(duration.value) || 0)); });
  common.appendChild(field('时长（毫秒）', duration));
  const easing = selectInput(TIMELINE_EASINGS, cue.easing);
  easing.onchange = () => updateCue(selection, (next) => { next.easing = easing.value as TimelineCue['easing']; });
  common.appendChild(field('缓动', easing));
  const actions = TIMELINE_ACTIONS[track.kind];
  const action = selectInput(actions, cue.action);
  action.onchange = () => {
    const nextCue = createCue(track.kind, action.value);
    nextCue.atMs = cue.atMs;
    nextCue.durationMs = cue.durationMs;
    nextCue.easing = cue.easing;
    commit((next) => { next.tracks[selection.trackIndex]!.cues[selection.cueIndex] = nextCue; });
  };
  common.appendChild(field('动作', action));
  parent.appendChild(common);

  const payload = h('div', 'timeline-payload-fields');
  const setString = (label: string, key: string, placeholder = '') => {
    const input = textInput(typeof cue[key] === 'string' ? cue[key] as string : '', placeholder);
    input.onchange = () => updateCue(selection, (next) => { next[key] = input.value; });
    payload.appendChild(field(label, input));
  };
  const setNumber = (label: string, key: string, min: number, max?: number, step = '1') => {
    const input = numberInput(typeof cue[key] === 'number' ? cue[key] as number : min, min, max);
    input.step = step;
    input.onchange = () => updateCue(selection, (next) => { next[key] = Number(input.value) || min; });
    payload.appendChild(field(label, input));
  };

  if (track.kind === 'background') setString('背景 key', 'key', 'castle_hall');
  if (track.kind === 'portrait') {
    const target = textInput(track.target ?? 'lynn:uniform');
    target.onchange = () => commit((next) => { next.tracks[selection.trackIndex]!.target = target.value; });
    payload.appendChild(field('角色目标', target));
    if (cue.action === 'show' || cue.action === 'expression') setString('表情', 'expression', 'normal');
    if (cue.action === 'show' || cue.action === 'move') setString('位置', 'position', 'left / center / right');
  }
  if (track.kind === 'camera') {
    if (cue.action === 'zoom') setNumber('缩放', 'scale', 0.25, 4, '0.01');
    if (cue.action === 'pan') {
      setNumber('水平偏移', 'x', -2000, 2000);
      setNumber('垂直偏移', 'y', -2000, 2000);
    }
    if (cue.action === 'shake') setNumber('震动强度', 'strength', 0, 64, '1');
  }
  if (track.kind === 'screen') {
    if (cue.action === 'fade' || cue.action === 'tint') setNumber('透明度', 'alpha', 0, 1, '0.01');
    if (cue.action === 'tint') setNumber('颜色值', 'color', 0, 0xffffff, '1');
  }
  if (track.kind === 'particle' && cue.action === 'start') setString('粒子预设', 'kind', 'sparkle');
  if (track.kind === 'audio') setString('音频 key', 'key', 'tense_01');
  if (payload.childElementCount > 0) {
    parent.append(h('h4', undefined, '动作参数'));
    parent.appendChild(payload);
  }

  const ops = h('div', 'timeline-inspector-ops');
  const remove = h('button', 'danger', '删除 cue');
  remove.onclick = () => {
    commit((next) => { next.tracks[selection.trackIndex]!.cues.splice(selection.cueIndex, 1); });
    selectedCue = null;
  };
  ops.appendChild(remove);
  parent.appendChild(ops);
}

function renderTimelineList(parent: HTMLElement): void {
  const head = h('div', 'timeline-list-head');
  head.append(h('h3', undefined, '时间轴'));
  const add = h('button', 'icon-button', '+');
  add.title = '新建时间轴';
  add.onclick = () => {
    let n = state.timelines.length + 1;
    let id = `timeline_${String(n).padStart(2, '0')}`;
    while (state.timelines.some((entry) => entry.id === id)) id = `timeline_${String(++n).padStart(2, '0')}`;
    state.timelines.push({ id, file: `${id}.json`, text: stringifyTimeline(createTimeline(id)), dirty: true, handle: null });
    state.currentTimeline = id;
    selectedCue = null;
    renderTimelinePanel(rootContainer);
    setStatus(`已创建时间轴 ${id}`, true, 3500);
  };
  head.appendChild(add);
  parent.appendChild(head);
  if (state.timelines.length === 0) {
    parent.append(h('div', 'empty', '暂无时间轴'));
    return;
  }
  for (const entry of state.timelines) {
    const button = h('button', entry.id === state.currentTimeline ? 'timeline-item active' : 'timeline-item');
    button.append(h('span', 'timeline-item-name', entry.id));
    if (entry.dirty) button.append(h('span', 'timeline-dirty', '●'));
    button.onclick = () => {
      state.currentTimeline = entry.id;
      selectedCue = null;
      renderTimelinePanel(rootContainer);
    };
    parent.appendChild(button);
  }
}

function renderRuler(parent: HTMLElement, durationMs: number): void {
  const ruler = h('div', 'timeline-ruler');
  const ticks = Math.max(4, Math.ceil(durationMs / 500));
  for (let i = 0; i <= ticks; i++) {
    const tick = h('span', 'timeline-tick', `${(Math.min(durationMs, i * 500) / 1000).toFixed(1)}s`);
    const left = durationMs > 0 ? Math.min(100, (i * 500 / durationMs) * 100) : 0;
    tick.style.left = `${left}%`;
    ruler.appendChild(tick);
  }
  parent.appendChild(ruler);
}

function renderTracks(parent: HTMLElement, definition: TimelineDefinition): void {
  const canvas = h('div', 'timeline-track-list');
  definition.tracks.forEach((track, trackIndex) => {
    const row = h('div', 'timeline-track-row');
    const head = h('div', 'timeline-track-head');
    const kind = selectInput(TIMELINE_TRACKS, track.kind);
    kind.title = '轨道类型';
    kind.onchange = () => commit((next) => { next.tracks[trackIndex] = createTrack(kind.value as TimelineTrackKind); });
    head.appendChild(kind);
    if (track.target) head.append(h('span', 'timeline-track-target', track.target));
    const addCue = h('button', 'track-add', '+ cue');
    addCue.onclick = () => {
      const cueIndex = track.cues.length;
      commit((next) => { next.tracks[trackIndex]!.cues.push(createCue(track.kind)); });
      selectedCue = { timelineId: definition.id, trackIndex, cueIndex };
      renderTimelinePanel(rootContainer);
    };
    head.appendChild(addCue);
    row.appendChild(head);
    const lane = h('div', 'timeline-lane');
    for (const [cueIndex, cue] of track.cues.entries()) {
      const block = h('button', cueIndex === selectedCue?.cueIndex && trackIndex === selectedCue.trackIndex ? 'timeline-cue selected' : 'timeline-cue');
      const updateGeometry = (atMs: number, durationMs: number): void => {
        const left = definition.durationMs > 0 ? Math.max(0, Math.min(100, atMs / definition.durationMs * 100)) : 0;
        const width = definition.durationMs > 0 ? Math.max(2, Math.min(100 - left, Math.max(1, durationMs / definition.durationMs * 100))) : 100;
        block.style.left = `${left}%`;
        block.style.width = `${width}%`;
        block.title = `${cue.action} · ${Math.round(atMs)}ms + ${Math.round(durationMs)}ms · ${cue.easing}`;
      };
      updateGeometry(cue.atMs, cue.durationMs);
      const label = document.createElement('span');
      label.className = 'timeline-cue-label';
      label.textContent = cue.action;
      block.appendChild(label);
      const curve = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      curve.classList.add('timeline-curve');
      curve.setAttribute('viewBox', '0 0 100 24');
      curve.setAttribute('preserveAspectRatio', 'none');
      curve.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', easingPath(cue.easing));
      path.setAttribute('fill', 'none');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      curve.appendChild(path);
      block.appendChild(curve);
      const resize = document.createElement('span');
      resize.className = 'timeline-cue-resize';
      resize.title = '拖动调整时长';
      resize.onpointerdown = (event) => {
        event.stopPropagation();
        const startX = event.clientX;
        const originalDuration = cue.durationMs;
        const laneWidth = Math.max(1, lane.getBoundingClientRect().width);
        let nextDuration = originalDuration;
        const move = (moveEvent: PointerEvent) => {
          const deltaMs = (moveEvent.clientX - startX) / laneWidth * definition.durationMs;
          nextDuration = Math.max(0, Math.min(definition.durationMs - cue.atMs, Math.round(originalDuration + deltaMs)));
          updateGeometry(cue.atMs, nextDuration);
        };
        const release = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', release);
          updateCue({ timelineId: definition.id, trackIndex, cueIndex }, (next) => { next.durationMs = nextDuration; });
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', release, { once: true });
        event.preventDefault();
      };
      block.appendChild(resize);
      block.title = `${cue.action} · ${cue.atMs}ms + ${cue.durationMs}ms · ${cue.easing}`;
      block.onpointerdown = (event) => {
        if (event.button !== 0) return;
        selectedCue = { timelineId: definition.id, trackIndex, cueIndex };
        const startX = event.clientX;
        const originalAt = cue.atMs;
        const laneWidth = Math.max(1, lane.getBoundingClientRect().width);
        let nextAt = originalAt;
        const move = (moveEvent: PointerEvent) => {
          const deltaMs = (moveEvent.clientX - startX) / laneWidth * definition.durationMs;
          nextAt = Math.max(0, Math.min(definition.durationMs - cue.durationMs, Math.round(originalAt + deltaMs)));
          updateGeometry(nextAt, cue.durationMs);
        };
        const release = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', release);
          updateCue({ timelineId: definition.id, trackIndex, cueIndex }, (next) => { next.atMs = nextAt; });
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', release, { once: true });
        event.preventDefault();
      };
      block.onclick = () => {
        selectedCue = { timelineId: definition.id, trackIndex, cueIndex };
        renderTimelinePanel(rootContainer);
      };
      lane.appendChild(block);
    }
    row.appendChild(lane);
    canvas.appendChild(row);
  });
  parent.appendChild(canvas);
}

function renderWorkbench(parent: HTMLElement, definition: TimelineDefinition): void {
  const workbench = h('div', 'timeline-workbench');
  const main = h('section', 'timeline-canvas');
  const canvasHead = h('div', 'timeline-canvas-head');
  const canvasTitle = h('div');
  canvasTitle.append(h('div', 'timeline-section-kicker', '演出轨道'));
  canvasTitle.append(h('div', 'timeline-canvas-hint', '拖动 cue 中段调整开始 · 拖动右端调整时长'));
  canvasHead.appendChild(canvasTitle);
  const addTrack = h('button', undefined, '+ 添加轨道');
  addTrack.onclick = () => {
    commit((next) => next.tracks.push(createTrack('screen')));
    setStatus('已添加 screen 轨道', true, 2500);
  };
  canvasHead.appendChild(addTrack);
  main.appendChild(canvasHead);
  renderRuler(main, definition.durationMs);
  renderTracks(main, definition);
  workbench.appendChild(main);

  const inspector = h('aside', 'timeline-inspector');
  inspector.append(h('div', 'timeline-section-kicker', 'Cue 检查器'));
  renderInspector(inspector, definition);
  workbench.appendChild(inspector);
  parent.appendChild(workbench);
}

export function renderTimelinePanel(container: HTMLElement | null): void {
  if (!container) return;
  rootContainer = container;
  container.innerHTML = '';
  const shell = h('div', 'timeline-shell');
  const list = h('aside', 'timeline-list');
  renderTimelineList(list);
  shell.appendChild(list);
  const content = h('section', 'timeline-content');
  const active = activeDefinition();
  if (!active) {
    content.append(h('div', 'timeline-empty', '选择或新建一个时间轴'));
    shell.appendChild(content);
    container.appendChild(shell);
    return;
  }
  const header = h('div', 'timeline-header');
  const title = h('div', 'timeline-title');
  title.append(h('div', 'timeline-section-kicker', '当前演出'));
  title.append(h('h2', undefined, active.definition.id));
  title.append(h('span', 'timeline-file', active.entry.file));
  header.appendChild(title);
  const duration = numberInput(active.definition.durationMs, 0, 600000);
  duration.title = '时间轴总时长（毫秒）';
  duration.onchange = () => commit((next) => { next.durationMs = Math.max(0, Math.round(Number(duration.value) || 0)); });
  header.append(field('总时长', duration));
  const actions = h('div', 'timeline-header-actions');
  const preview = h('button', 'primary', '▶ 直演');
  preview.disabled = active.issues.length > 0;
  preview.onclick = () => onPreview(active.definition.id);
  actions.appendChild(preview);
  const exportBtn = h('button', undefined, '↓ 导出 JSON');
  exportBtn.onclick = () => exportTimeline(active.definition.id, active.entry.text);
  actions.appendChild(exportBtn);
  const remove = h('button', 'danger', '删除');
  remove.onclick = () => {
    if (!window.confirm(`删除时间轴「${active.definition.id}」？`)) return;
    if (active.entry.handle) state.pendingTimelineDeletes.push({ id: active.entry.id, file: active.entry.file });
    state.timelines = state.timelines.filter((entry) => entry.id !== active.definition.id);
    state.currentTimeline = state.timelines[0]?.id ?? null;
    selectedCue = null;
    renderTimelinePanel(rootContainer);
  };
  actions.appendChild(remove);
  header.appendChild(actions);
  content.appendChild(header);
  if (active.issues.length > 0) {
    const issue = h('div', 'timeline-invalid');
    issue.append(h('strong', undefined, '此时间轴暂不可播放'));
    for (const message of active.issues) issue.append(h('div', undefined, message));
    const reset = h('button', undefined, '重置为可编辑模板');
    reset.onclick = () => {
      active.entry.text = stringifyTimeline(createTimeline(active.entry.id));
      active.entry.dirty = true;
      selectedCue = null;
      renderTimelinePanel(rootContainer);
    };
    issue.appendChild(reset);
    content.appendChild(issue);
  } else {
    renderWorkbench(content, active.definition);
  }
  shell.appendChild(content);
  container.appendChild(shell);
}

/** 供因果跳转使用：切到指定时间轴并选中对应 cue（trackIndex/cueIndex 可选）。 */
export function selectTimelineCue(timelineId: string, trackIndex?: number, cueIndex?: number): void {
  state.currentTimeline = timelineId;
  selectedCue = typeof trackIndex === 'number'
    ? { timelineId, trackIndex, cueIndex: typeof cueIndex === 'number' ? cueIndex : 0 }
    : null;
  renderTimelinePanel(rootContainer);
}
