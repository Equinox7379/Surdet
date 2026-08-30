import type { TimelineCue, TimelineDefinition, TimelineEasing, TimelineTrack, TimelineTrackKind } from '@surdet/core';
import { state, h, setStatus } from '../state.js';
import type { TimelineCueSelection } from '../state.js';
import { exportTimeline } from '../project-io.js';
import { pushTimelineSnapshot } from '../timeline-history.js';
import {
  cloneTimeline, createNeutralCue, createResourceCue, createTimeline, createTrack, parseTimelineText,
  stringifyTimeline, easingPath, TIMELINE_ACTIONS, TIMELINE_EASINGS, TIMELINE_TRACKS,
} from '../timeline-model.js';
import {
  buildTimelineTicks,
  timelineActionLabel,
  timelineAssetChoices,
  timelineEasingLabel,
  timelineTrackLabel,
} from '../timeline-presentation.js';
import type { TimelineAssetChoice } from '../timeline-presentation.js';

let rootContainer: HTMLElement | null = null;
let onPreview: (timelineId: string) => void = () => {};
let onEdited: () => void = () => {};
let onSelectionChanged: () => void = () => {};

export function bindTimelineHooks(opts: {
  onPreview: (timelineId: string) => void;
  onEdited?: () => void;
  onSelectionChanged?: () => void;
}): void {
  onPreview = opts.onPreview;
  onEdited = opts.onEdited ?? (() => {});
  onSelectionChanged = opts.onSelectionChanged ?? (() => {});
}

function entryFor(id = state.currentTimeline): (typeof state.timelines)[number] | undefined {
  return id ? state.timelines.find((entry) => entry.id === id) : undefined;
}

export function nextTimelineId(): string {
  const reserved = new Set([
    ...state.timelines.map((entry) => entry.id),
    ...state.pendingTimelineDeletes.map((entry) => entry.id),
    ...state.pendingTimelineRestores.keys(),
  ]);
  let n = state.timelines.length + state.pendingTimelineRestores.size + 1;
  let id = `timeline_${String(n).padStart(2, '0')}`;
  while (reserved.has(id)) id = `timeline_${String(++n).padStart(2, '0')}`;
  return id;
}

export function deleteTimeline(timelineId: string): boolean {
  const index = state.timelines.findIndex((entry) => entry.id === timelineId);
  if (index < 0 || state.pendingTimelineRestores.has(timelineId)) return false;
  const entry = state.timelines[index]!;
  state.pendingTimelineRestores.set(timelineId, {
    entry,
    index,
    previousTimelineId: state.currentTimeline,
    previousCue: state.currentTimelineCue ? { ...state.currentTimelineCue } : null,
  });
  if (entry.handle && !state.pendingTimelineDeletes.some((pending) => pending.id === timelineId)) {
    state.pendingTimelineDeletes.push({ id: entry.id, file: entry.file });
  }
  state.timelines.splice(index, 1);
  state.currentTimeline = state.timelines[Math.min(index, state.timelines.length - 1)]?.id ?? null;
  state.currentTimelineCue = null;
  renderTimelinePanel(rootContainer);
  onEdited();
  setStatus(`已删除时间轴 ${timelineId}，保存前可撤销`, true, 5000);
  return true;
}

export function restorePendingTimelineDeletion(timelineId: string): boolean {
  const restore = state.pendingTimelineRestores.get(timelineId);
  if (!restore || state.timelines.some((entry) => entry.id === timelineId)) return false;
  state.pendingTimelineDeletes = state.pendingTimelineDeletes.filter((pending) => pending.id !== timelineId);
  const index = Math.max(0, Math.min(restore.index, state.timelines.length));
  state.timelines.splice(index, 0, restore.entry);
  state.pendingTimelineRestores.delete(timelineId);
  state.currentTimeline = restore.previousTimelineId === timelineId ? timelineId : restore.previousTimelineId;
  if (!state.currentTimeline || !state.timelines.some((entry) => entry.id === state.currentTimeline)) {
    state.currentTimeline = timelineId;
  }
  state.currentTimelineCue = restore.previousCue ? { ...restore.previousCue } : null;
  renderTimelinePanel(rootContainer);
  onEdited();
  setStatus(`已恢复时间轴 ${timelineId}`, true, 4000);
  return true;
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
  const nextText = stringifyTimeline(next, active.entry.eol);
  if (nextText === active.entry.text) return;
  pushTimelineSnapshot(active.entry.id, active.entry.text);
  active.entry.text = nextText;
  active.entry.dirty = true;
  renderTimelinePanel(rootContainer);
  onEdited();
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

function selectInput(
  options: readonly string[],
  value: string,
  labelFor: (option: string) => string = (option) => option,
): HTMLSelectElement {
  const select = h('select');
  for (const option of options) {
    const item = h('option', undefined, labelFor(option));
    item.value = option;
    item.selected = option === value;
    select.appendChild(item);
  }
  return select;
}

type ResourceTrackKind = 'background' | 'portrait' | 'audio';

function isResourceTrackKind(kind: TimelineTrackKind): kind is ResourceTrackKind {
  return kind === 'background' || kind === 'portrait' || kind === 'audio';
}

function resourceChoicesFor(kind: ResourceTrackKind, action: string): TimelineAssetChoice[] {
  return timelineAssetChoices(state.dirAssets).filter((choice) => {
    if (choice.kind !== kind) return false;
    if (kind !== 'audio') return true;
    return choice.sourceKind === action;
  });
}

function fillResourceSelect(select: HTMLSelectElement, choices: readonly TimelineAssetChoice[], currentKey?: string): void {
  select.innerHTML = '';
  if (choices.length === 0) {
    const option = h('option', undefined, '当前项目没有可用素材');
    option.value = '';
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  choices.forEach((choice, index) => {
    const suffix = choice.expression ? ` · ${choice.expression}` : '';
    const option = h('option', undefined, `${choice.key}${suffix}`);
    option.value = String(index);
    option.selected = choice.key === currentKey;
    select.appendChild(option);
  });
}

function updateCue(selection: TimelineCueSelection, mutator: (cue: TimelineCue, track: TimelineTrack) => void): void {
  commit((definition) => {
    const track = definition.tracks[selection.trackIndex];
    const cue = track?.cues[selection.cueIndex];
    if (track && cue) mutator(cue, track);
  });
}

function renderInspector(parent: HTMLElement, definition: TimelineDefinition): void {
  const selection = state.currentTimelineCue;
  const track = selection ? definition.tracks[selection.trackIndex] : undefined;
  const cue = track?.cues[selection!.cueIndex];
  if (!selection || !track || !cue) {
    parent.append(h('div', 'timeline-inspector-empty', '选择一个演出片段查看设置'));
    return;
  }

  parent.append(h('div', 'timeline-inspector-kicker', `轨道 ${selection.trackIndex + 1} · 片段 ${selection.cueIndex + 1}`));
  const common = h('div', 'timeline-inspector-grid');
  const at = numberInput(cue.atMs, 0, definition.durationMs);
  at.onchange = () => updateCue(selection, (next) => { next.atMs = Math.max(0, Math.round(Number(at.value) || 0)); });
  common.appendChild(field('开始（毫秒）', at));
  const duration = numberInput(cue.durationMs, 0, definition.durationMs);
  duration.onchange = () => updateCue(selection, (next) => { next.durationMs = Math.max(0, Math.round(Number(duration.value) || 0)); });
  common.appendChild(field('时长（毫秒）', duration));
  const easing = selectInput(TIMELINE_EASINGS, cue.easing, (option) => timelineEasingLabel(option as TimelineEasing));
  easing.onchange = () => updateCue(selection, (next) => { next.easing = easing.value as TimelineCue['easing']; });
  common.appendChild(field('缓动', easing));
  const actions = TIMELINE_ACTIONS[track.kind];
  const action = selectInput(actions, cue.action, (option) => timelineActionLabel(track.kind, option));
  common.appendChild(field('动作', action));
  const replacementResource = isResourceTrackKind(track.kind)
    ? h('select', 'timeline-resource-select') as HTMLSelectElement
    : null;
  let replacementChoices: TimelineAssetChoice[] = [];
  const currentResourceKey = track.kind === 'portrait'
    ? track.target
    : typeof cue.key === 'string' ? cue.key : undefined;
  const refreshReplacementChoices = () => {
    if (!replacementResource || !isResourceTrackKind(track.kind)) return;
    replacementChoices = resourceChoicesFor(track.kind, action.value);
    fillResourceSelect(replacementResource, replacementChoices, currentResourceKey);
  };
  if (replacementResource) {
    refreshReplacementChoices();
    action.onchange = refreshReplacementChoices;
    common.appendChild(field('项目素材', replacementResource));
  }
  const applyAction = h('button', undefined, '应用动作');
  applyAction.onclick = () => {
    if (action.value === cue.action && (!replacementResource || replacementResource.value === '')) return;
    const selectedChoice = replacementResource && replacementResource.value !== ''
      ? replacementChoices[Number(replacementResource.value)]
      : undefined;
    const draft = isResourceTrackKind(track.kind)
      ? selectedChoice ? createResourceCue(track.kind, action.value, selectedChoice) : null
      : createNeutralCue(track.kind, action.value);
    if (!draft) {
      setStatus('请选择与动作匹配的项目素材', false, 5000);
      return;
    }
    if (!window.confirm('应用动作会重置此演出片段的动作参数，是否继续？')) return;
    draft.cue.atMs = cue.atMs;
    draft.cue.durationMs = cue.durationMs;
    draft.cue.easing = cue.easing;
    commit((next) => {
      const nextTrack = next.tracks[selection.trackIndex]!;
      if (draft.trackPatch) nextTrack.target = draft.trackPatch.target;
      nextTrack.cues[selection.cueIndex] = draft.cue;
    });
    setStatus('已应用动作，可撤销', true, 4000);
  };
  common.appendChild(applyAction);
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

  if (track.kind === 'portrait') {
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
  if (payload.childElementCount > 0) {
    parent.append(h('h4', undefined, '动作参数'));
    parent.appendChild(payload);
  }

  const ops = h('div', 'timeline-inspector-ops');
  const remove = h('button', 'danger', '删除演出片段');
  remove.onclick = () => {
    commit((next) => { next.tracks[selection.trackIndex]!.cues.splice(selection.cueIndex, 1); });
    state.currentTimelineCue = null;
    setStatus('已删除演出片段，可撤销', true, 4000);
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
    const id = nextTimelineId();
    state.timelines.push({ id, file: `${id}.json`, text: stringifyTimeline(createTimeline(id)), eol: '\n', dirty: true, handle: null });
    state.currentTimeline = id;
    state.currentTimelineCue = null;
    renderTimelinePanel(rootContainer);
    onEdited();
    setStatus(`已创建时间轴 ${id}`, true, 3500);
  };
  head.appendChild(add);
  parent.appendChild(head);
  for (const [timelineId] of state.pendingTimelineRestores) {
    const recovery = h('div', 'timeline-delete-recovery');
    recovery.append(h('span', undefined, `已删除 ${timelineId}`));
    const restore = h('button', undefined, '撤销删除');
    restore.onclick = () => { restorePendingTimelineDeletion(timelineId); };
    recovery.appendChild(restore);
    parent.appendChild(recovery);
  }
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
      state.currentTimelineCue = null;
      renderTimelinePanel(rootContainer);
      onSelectionChanged();
    };
    parent.appendChild(button);
  }
}

function renderRuler(parent: HTMLElement, durationMs: number): void {
  const ruler = h('div', 'timeline-ruler');
  const availableWidth = Math.max(320, parent.getBoundingClientRect().width || 640);
  for (const projected of buildTimelineTicks(durationMs, availableWidth)) {
    const tick = h('span', 'timeline-tick', projected.label);
    tick.style.left = `${projected.leftPercent}%`;
    tick.dataset.valueMs = String(projected.valueMs);
    ruler.appendChild(tick);
  }
  parent.appendChild(ruler);
}

function renderTracks(parent: HTMLElement, definition: TimelineDefinition): void {
  const canvas = h('div', 'timeline-track-list');
  definition.tracks.forEach((track, trackIndex) => {
    const row = h('div', 'timeline-track-row');
    const head = h('div', 'timeline-track-head');
    const kind = selectInput(TIMELINE_TRACKS, track.kind, (option) => timelineTrackLabel(option as TimelineTrackKind));
    kind.title = '轨道类型';
    kind.onchange = () => {
      const nextKind = kind.value as TimelineTrackKind;
      if (nextKind === track.kind) return;
      if (track.cues.length > 0 && !window.confirm(`更换轨道类型会清空本轨道的 ${track.cues.length} 个演出片段，是否继续？`)) {
        kind.value = track.kind;
        return;
      }
      commit((next) => { next.tracks[trackIndex] = createTrack(nextKind); });
      state.currentTimelineCue = null;
      setStatus('已更换轨道类型，可撤销', true, 4000);
    };
    head.appendChild(kind);
    if (track.target) head.append(h('span', 'timeline-track-target', track.target));
    const addAction = selectInput(
      TIMELINE_ACTIONS[track.kind],
      TIMELINE_ACTIONS[track.kind][0]!,
      (option) => timelineActionLabel(track.kind, option),
    );
    addAction.title = '新增片段动作';
    head.appendChild(addAction);
    const addResource = isResourceTrackKind(track.kind) ? h('select', 'timeline-resource-select') as HTMLSelectElement : null;
    let addChoices: TimelineAssetChoice[] = [];
    const refreshAddChoices = () => {
      if (!addResource || !isResourceTrackKind(track.kind)) return;
      addChoices = resourceChoicesFor(track.kind, addAction.value);
      fillResourceSelect(addResource, addChoices);
    };
    if (addResource) {
      refreshAddChoices();
      addAction.onchange = refreshAddChoices;
      head.appendChild(addResource);
    }
    const addCue = h('button', 'track-add', '+ 演出片段');
    addCue.onclick = () => {
      const selectedChoice = addResource && addResource.value !== ''
        ? addChoices[Number(addResource.value)]
        : undefined;
      const draft = isResourceTrackKind(track.kind)
        ? selectedChoice ? createResourceCue(track.kind, addAction.value, selectedChoice) : null
        : createNeutralCue(track.kind, addAction.value);
      if (!draft) {
        setStatus('请先选择与动作匹配的项目素材', false, 5000);
        return;
      }
      const cueIndex = track.cues.length;
      commit((next) => {
        const nextTrack = next.tracks[trackIndex]!;
        if (draft.trackPatch) nextTrack.target = draft.trackPatch.target;
        nextTrack.cues.push(draft.cue);
      });
      state.currentTimelineCue = { trackIndex, cueIndex };
      renderTimelinePanel(rootContainer);
    };
    head.appendChild(addCue);
    row.appendChild(head);
    const lane = h('div', 'timeline-lane');
    for (const [cueIndex, cue] of track.cues.entries()) {
      const selection = state.currentTimeline === definition.id ? state.currentTimelineCue : null;
      const block = h('button', cueIndex === selection?.cueIndex && trackIndex === selection.trackIndex ? 'timeline-cue selected' : 'timeline-cue');
      const updateGeometry = (atMs: number, durationMs: number): void => {
        const left = definition.durationMs > 0 ? Math.max(0, Math.min(100, atMs / definition.durationMs * 100)) : 0;
        const width = definition.durationMs > 0 ? Math.max(2, Math.min(100 - left, Math.max(1, durationMs / definition.durationMs * 100))) : 100;
        block.style.left = `${left}%`;
        block.style.width = `${width}%`;
        block.title = `${timelineActionLabel(track.kind, cue.action)} · ${Math.round(atMs)}ms + ${Math.round(durationMs)}ms · ${timelineEasingLabel(cue.easing)}`;
      };
      updateGeometry(cue.atMs, cue.durationMs);
      const label = document.createElement('span');
      label.className = 'timeline-cue-label';
      label.textContent = timelineActionLabel(track.kind, cue.action);
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
          updateCue({ trackIndex, cueIndex }, (next) => { next.durationMs = nextDuration; });
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', release, { once: true });
        event.preventDefault();
      };
      block.appendChild(resize);
      block.title = `${timelineActionLabel(track.kind, cue.action)} · ${cue.atMs}ms + ${cue.durationMs}ms · ${timelineEasingLabel(cue.easing)}`;
      block.onpointerdown = (event) => {
        if (event.button !== 0) return;
        state.currentTimelineCue = { trackIndex, cueIndex };
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
          updateCue({ trackIndex, cueIndex }, (next) => { next.atMs = nextAt; });
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', release, { once: true });
        event.preventDefault();
      };
      block.onclick = () => {
        state.currentTimelineCue = { trackIndex, cueIndex };
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
  canvasTitle.append(h('div', 'timeline-canvas-hint', '拖动片段调整开始时间 · 拖动右端调整时长'));
  canvasHead.appendChild(canvasTitle);
  const addTrack = h('button', undefined, '+ 添加轨道');
  addTrack.onclick = () => {
    commit((next) => next.tracks.push(createTrack('screen')));
    setStatus('已添加画面效果轨道', true, 2500);
  };
  canvasHead.appendChild(addTrack);
  main.appendChild(canvasHead);
  renderRuler(main, definition.durationMs);
  renderTracks(main, definition);
  workbench.appendChild(main);

  const inspector = h('aside', 'timeline-inspector');
  inspector.append(h('div', 'timeline-section-kicker', '片段设置'));
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
    deleteTimeline(active.definition.id);
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
      pushTimelineSnapshot(active.entry.id, active.entry.text);
      active.entry.text = stringifyTimeline(createTimeline(active.entry.id), active.entry.eol);
      active.entry.dirty = true;
      state.currentTimelineCue = null;
      renderTimelinePanel(rootContainer);
      onEdited();
      setStatus('已重置时间轴，可撤销', true, 4000);
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
  state.currentTimelineCue = typeof trackIndex === 'number'
    ? { trackIndex, cueIndex: typeof cueIndex === 'number' ? cueIndex : 0 }
    : null;
  renderTimelinePanel(rootContainer);
  onSelectionChanged();
}
