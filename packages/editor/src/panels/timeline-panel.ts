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
  projectTimelineCueGeometry,
  timelineActionLabel,
  timelineAssetChoices,
  timelineEasingLabel,
  timelineTrackLabel,
} from '../timeline-presentation.js';
import type { TimelineAssetChoice } from '../timeline-presentation.js';

let rootContainer: HTMLElement | null = null;
let timelineZoom = 1;
let timelineRulerObserver: ResizeObserver | null = null;
let timelineLayoutObserver: ResizeObserver | null = null;
let onPreview: (timelineId: string) => void = () => {};
let onOpenAssets: () => void = () => {};
let onEdited: () => void = () => {};
let onSelectionChanged: () => void = () => {};

interface TimelineViewState {
  zoom: number;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  canvasScrollLeft: number;
  canvasScrollTop: number;
  libraryScrollTop: number;
  inspectorScrollTop: number;
  searchQuery: string;
}

const timelineViewStates = new Map<string, TimelineViewState>();

export function clearTimelineViewStates(): void {
  timelineViewStates.clear();
  timelineZoom = 1;
  timelineRulerObserver?.disconnect();
  timelineRulerObserver = null;
  timelineLayoutObserver?.disconnect();
  timelineLayoutObserver = null;
}

export function clearTimelineViewState(timelineId: string): void {
  timelineViewStates.delete(timelineId);
}

function timelineViewState(timelineId: string): TimelineViewState {
  let view = timelineViewStates.get(timelineId);
  if (!view) {
    view = {
      zoom: 1,
      libraryOpen: true,
      inspectorOpen: true,
      canvasScrollLeft: 0,
      canvasScrollTop: 0,
      libraryScrollTop: 0,
      inspectorScrollTop: 0,
      searchQuery: '',
    };
    timelineViewStates.set(timelineId, view);
  }
  return view;
}

function captureTimelineViewState(): void {
  if (!rootContainer || !rootContainer.isConnected) return;
  const timelineId = rootContainer.dataset.renderedTimelineId;
  if (!timelineId) return;
  const view = timelineViewState(timelineId);
  const canvas = rootContainer.querySelector<HTMLElement>('.timeline-scroll');
  const libraryItems = rootContainer.querySelector<HTMLElement>('.timeline-items');
  const inspectorBody = rootContainer.querySelector<HTMLElement>('.timeline-inspector-body');
  view.zoom = timelineZoom;
  view.canvasScrollLeft = canvas?.scrollLeft ?? view.canvasScrollLeft;
  view.canvasScrollTop = canvas?.scrollTop ?? view.canvasScrollTop;
  view.libraryScrollTop = libraryItems?.scrollTop ?? view.libraryScrollTop;
  view.inspectorScrollTop = inspectorBody?.scrollTop ?? view.inspectorScrollTop;
  const search = rootContainer.querySelector<HTMLInputElement>('.timeline-search');
  view.searchQuery = search?.value ?? view.searchQuery;
}

function restoreTimelineViewState(timelineId: string): void {
  if (!rootContainer) return;
  const view = timelineViewState(timelineId);
  requestAnimationFrame(() => {
    if (!rootContainer || rootContainer.dataset.renderedTimelineId !== timelineId) return;
    const canvas = rootContainer.querySelector<HTMLElement>('.timeline-scroll');
    const libraryItems = rootContainer.querySelector<HTMLElement>('.timeline-items');
    const inspectorBody = rootContainer.querySelector<HTMLElement>('.timeline-inspector-body');
    if (canvas) {
      canvas.scrollLeft = view.canvasScrollLeft;
      canvas.scrollTop = view.canvasScrollTop;
    }
    if (libraryItems) libraryItems.scrollTop = view.libraryScrollTop;
    if (inspectorBody) inspectorBody.scrollTop = view.inspectorScrollTop;
  });
}

export function bindTimelineHooks(opts: {
  onPreview: (timelineId: string) => void;
  onOpenAssets?: () => void;
  onEdited?: () => void;
  onSelectionChanged?: () => void;
}): void {
  onPreview = opts.onPreview;
  onOpenAssets = opts.onOpenAssets ?? (() => {});
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

function activeTimelineFocusKey(): string | null {
  const active = document.activeElement as HTMLElement | null;
  return active?.dataset.timelineFocus ?? null;
}

function restoreTimelineFocus(key: string | null): void {
  if (!key || !rootContainer) return;
  const target = [...rootContainer.querySelectorAll<HTMLElement>('[data-timeline-focus]')]
    .find((element) => element.dataset.timelineFocus === key);
  target?.focus({ preventScroll: true });
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

function commit(
  mutator: (definition: TimelineDefinition) => void,
  historySelection: TimelineCueSelection | null = state.currentTimelineCue,
): void {
  const active = activeDefinition();
  if (!active || active.issues.length > 0) return;
  const focusKey = activeTimelineFocusKey();
  const next = cloneTimeline(active.definition);
  mutator(next);
  normalizeTiming(next);
  const nextText = stringifyTimeline(next, active.entry.eol);
  if (nextText === active.entry.text) return;
  pushTimelineSnapshot(active.entry.id, active.entry.text, historySelection);
  active.entry.text = nextText;
  active.entry.dirty = true;
  renderTimelinePanel(rootContainer);
  restoreTimelineFocus(focusKey);
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

function fillResourceSelect(
  select: HTMLSelectElement,
  choices: readonly TimelineAssetChoice[],
  currentKey?: string,
  currentExpression?: string,
  requireExpressionMatch = false,
): void {
  select.innerHTML = '';
  if (choices.length === 0) {
    const option = h('option', undefined, '当前项目没有可用素材');
    option.value = '';
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  let matchedCurrent = currentKey === undefined;
  choices.forEach((choice, index) => {
    const suffix = choice.expression ? ` · ${choice.expression}` : '';
    const option = h('option', undefined, `${choice.key}${suffix}`);
    option.value = String(index);
    option.selected = !matchedCurrent
      && choice.key === currentKey
      && (!requireExpressionMatch || choice.kind !== 'portrait' || choice.expression === currentExpression);
    if (option.selected) matchedCurrent = true;
    select.appendChild(option);
  });
  if (!matchedCurrent) {
    const missing = h('option', undefined, '原素材不在项目目录，请重新选择');
    missing.value = '';
    missing.selected = true;
    missing.disabled = true;
    select.insertBefore(missing, select.firstChild);
  }
}

function updateCue(selection: TimelineCueSelection, mutator: (cue: TimelineCue, track: TimelineTrack) => void): void {
  commit((definition) => {
    const track = definition.tracks[selection.trackIndex];
    const cue = track?.cues[selection.cueIndex];
    if (track && cue) mutator(cue, track);
  });
}

function selectCueInMountedPanel(definition: TimelineDefinition, trackIndex: number, cueIndex: number): void {
  state.currentTimelineCue = { trackIndex, cueIndex };
  if (!rootContainer) return;
  for (const candidate of rootContainer.querySelectorAll<HTMLElement>('.timeline-cue')) {
    candidate.classList.toggle(
      'selected',
      Number(candidate.dataset.trackIndex) === trackIndex && Number(candidate.dataset.cueIndex) === cueIndex,
    );
  }
  const inspectorBody = rootContainer.querySelector<HTMLElement>('.timeline-inspector-body');
  if (inspectorBody) {
    inspectorBody.innerHTML = '';
    inspectorBody.append(h('div', 'timeline-section-kicker', '片段设置'));
    renderInspector(inspectorBody, definition);
  }
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
  at.dataset.timelineFocus = 'inspector-start';
  at.onchange = () => updateCue(selection, (next) => { next.atMs = Math.max(0, Math.round(Number(at.value) || 0)); });
  common.appendChild(field('开始（毫秒）', at));
  const duration = numberInput(cue.durationMs, 0, definition.durationMs);
  duration.dataset.timelineFocus = 'inspector-duration';
  duration.onchange = () => updateCue(selection, (next) => { next.durationMs = Math.max(0, Math.round(Number(duration.value) || 0)); });
  common.appendChild(field('时长（毫秒）', duration));
  const easing = selectInput(TIMELINE_EASINGS, cue.easing, (option) => timelineEasingLabel(option as TimelineEasing));
  easing.dataset.timelineFocus = 'inspector-easing';
  easing.onchange = () => updateCue(selection, (next) => { next.easing = easing.value as TimelineCue['easing']; });
  common.appendChild(field('缓动', easing));
  const actions = TIMELINE_ACTIONS[track.kind];
  const action = selectInput(actions, cue.action, (option) => timelineActionLabel(track.kind, option));
  action.dataset.timelineFocus = 'inspector-action';
  common.appendChild(field('动作', action));
  const replacementResource = isResourceTrackKind(track.kind)
    ? h('select', 'timeline-resource-select') as HTMLSelectElement
    : null;
  let replacementChoices: TimelineAssetChoice[] = [];
  const currentResourceKey = track.kind === 'portrait'
    ? track.target
    : typeof cue.key === 'string' ? cue.key : undefined;
  const currentExpression = typeof cue.expression === 'string' ? cue.expression : undefined;
  const refreshReplacementChoices = () => {
    if (!replacementResource || !isResourceTrackKind(track.kind)) return;
    replacementChoices = resourceChoicesFor(track.kind, action.value);
    const requireExpressionMatch = track.kind === 'portrait'
      && (action.value === 'show' || action.value === 'expression');
    fillResourceSelect(
      replacementResource,
      replacementChoices,
      currentResourceKey,
      currentExpression,
      requireExpressionMatch,
    );
  };
  if (replacementResource) {
    replacementResource.dataset.timelineFocus = 'inspector-resource';
    refreshReplacementChoices();
    action.onchange = refreshReplacementChoices;
    common.appendChild(field('项目素材', replacementResource));
    const openAssets = h('button', 'timeline-open-assets', '前往素材工作区');
    openAssets.onclick = onOpenAssets;
    common.appendChild(openAssets);
  }
  const applyAction = h('button', undefined, '应用动作');
  applyAction.dataset.timelineFocus = 'inspector-apply-action';
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
    input.dataset.timelineFocus = `inspector-${key}`;
    input.onchange = () => updateCue(selection, (next) => { next[key] = input.value; });
    payload.appendChild(field(label, input));
  };
  const setNumber = (label: string, key: string, min: number, max?: number, step = '1') => {
    const input = numberInput(typeof cue[key] === 'number' ? cue[key] as number : min, min, max);
    input.dataset.timelineFocus = `inspector-${key}`;
    input.step = step;
    input.onchange = () => updateCue(selection, (next) => {
      const parsed = input.value.trim() === '' ? min : Number(input.value);
      const finite = Number.isFinite(parsed) ? parsed : min;
      next[key] = max === undefined ? Math.max(min, finite) : Math.max(min, Math.min(max, finite));
    });
    payload.appendChild(field(label, input));
  };

  if (track.kind === 'portrait') {
    if (cue.action === 'show' || cue.action === 'move') {
      const currentPosition = typeof cue.position === 'string' ? cue.position : 'center';
      const namedPositions = ['left', 'center', 'right'];
      const isNamedPosition = namedPositions.includes(currentPosition);
      const labels: Record<string, string> = { left: '左侧', center: '中央', right: '右侧', custom: '自定义横坐标' };
      const position = selectInput([...namedPositions, 'custom'], isNamedPosition ? currentPosition : 'custom', (value) => labels[value] ?? value);
      position.dataset.timelineFocus = 'inspector-position';
      payload.appendChild(field('画面位置', position));
      const parsedCustomPosition = Number(currentPosition);
      const customPosition = h('input') as HTMLInputElement;
      customPosition.type = 'number';
      customPosition.step = '1';
      customPosition.value = String(Number.isFinite(parsedCustomPosition) ? parsedCustomPosition : 0);
      customPosition.dataset.timelineFocus = 'inspector-position-custom';
      const customPositionField = field('自定义横坐标', customPosition);
      customPositionField.hidden = position.value !== 'custom';
      const applyCustomPosition = () => updateCue(selection, (next) => {
        const parsed = Number(customPosition.value);
        next.position = String(Number.isFinite(parsed) ? parsed : 0);
      });
      position.onchange = () => {
        customPositionField.hidden = position.value !== 'custom';
        if (position.value === 'custom') {
          applyCustomPosition();
          customPosition.focus();
        }
        else updateCue(selection, (next) => { next.position = position.value; });
      };
      customPosition.onchange = applyCustomPosition;
      payload.appendChild(customPositionField);
    }
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

  const technical = document.createElement('details');
  technical.className = 'timeline-inspector-technical';
  technical.setAttribute('data-tech-details', '');
  const technicalSummary = document.createElement('summary');
  technicalSummary.textContent = '技术信息';
  const raw = document.createElement('pre');
  raw.textContent = JSON.stringify({
    trackKind: track.kind,
    target: track.target ?? null,
    action: cue.action,
    easing: cue.easing,
  }, null, 2);
  technical.append(technicalSummary, raw);
  parent.appendChild(technical);

  const ops = h('div', 'timeline-inspector-ops');
  const remove = h('button', 'danger', '删除演出片段');
  remove.dataset.timelineFocus = 'inspector-delete';
  remove.onclick = () => {
    const remaining = track.cues.length - 1;
    const previousSelection = { ...selection };
    state.currentTimelineCue = remaining <= 0
      ? null
      : { trackIndex: selection.trackIndex, cueIndex: Math.min(selection.cueIndex, remaining - 1) };
    const nextFocus = remaining <= 0
      ? `track-${selection.trackIndex}-add`
      : `cue-${selection.trackIndex}-${state.currentTimelineCue!.cueIndex}`;
    commit((next) => { next.tracks[selection.trackIndex]!.cues.splice(selection.cueIndex, 1); }, previousSelection);
    restoreTimelineFocus(nextFocus);
    setStatus('已删除演出片段，可撤销', true, 4000);
  };
  ops.appendChild(remove);
  parent.appendChild(ops);
}

function renderTimelineList(parent: HTMLElement): void {
  const head = h('div', 'timeline-list-head');
  const heading = h('div');
  heading.append(h('div', 'timeline-section-kicker', '演出片段库'));
  heading.append(h('h3', undefined, `${state.timelines.length} 段演出`));
  head.appendChild(heading);
  const add = h('button', 'timeline-new', '＋ 新建');
  add.title = '新建演出时间轴';
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
  const search = h('input', 'timeline-search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = '查找演出片段';
  search.setAttribute('aria-label', '查找演出片段');
  const currentView = state.currentTimeline ? timelineViewState(state.currentTimeline) : null;
  search.value = currentView?.searchQuery ?? '';
  parent.appendChild(search);
  if (state.pendingTimelineRestores.size > 0) {
    const recoveryList = h('div', 'timeline-recovery');
    recoveryList.append(h('div', 'timeline-recovery-title', '尚未保存的删除'));
    for (const [timelineId] of state.pendingTimelineRestores) {
      const recovery = h('div', 'timeline-delete-recovery');
      recovery.append(h('span', undefined, timelineId));
      const restore = h('button', undefined, '撤销删除');
      restore.onclick = () => { restorePendingTimelineDeletion(timelineId); };
      recovery.appendChild(restore);
      recoveryList.appendChild(recovery);
    }
    parent.appendChild(recoveryList);
  }
  if (state.timelines.length === 0) {
    parent.append(h('div', 'timeline-library-empty', '还没有演出片段。新建后可安排背景、角色、镜头和声音。'));
    return;
  }
  const items = h('div', 'timeline-items');
  const applySearch = () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const item of items.querySelectorAll<HTMLElement>('[data-timeline-id]')) {
      item.hidden = query.length > 0 && !item.dataset.timelineId!.toLocaleLowerCase().includes(query);
    }
  };
  search.oninput = () => {
    if (state.currentTimeline) timelineViewState(state.currentTimeline).searchQuery = search.value;
    applySearch();
  };
  for (const entry of state.timelines) {
    const button = h('button', entry.id === state.currentTimeline ? 'timeline-item active' : 'timeline-item');
    button.dataset.timelineId = entry.id;
    button.dataset.timelineFocus = `timeline-${entry.id}`;
    button.setAttribute('aria-current', entry.id === state.currentTimeline ? 'true' : 'false');
    button.append(h('span', 'timeline-item-name', entry.id));
    button.append(h('span', 'timeline-item-meta', entry.dirty ? '尚未保存' : '已保存'));
    button.onclick = () => {
      const focusKey = button.dataset.timelineFocus ?? null;
      state.currentTimeline = entry.id;
      state.currentTimelineCue = null;
      renderTimelinePanel(rootContainer);
      restoreTimelineFocus(focusKey);
      onSelectionChanged();
    };
    items.appendChild(button);
  }
  parent.appendChild(items);
  items.scrollTop = currentView?.libraryScrollTop ?? 0;
  items.addEventListener('scroll', () => {
    if (state.currentTimeline) timelineViewState(state.currentTimeline).libraryScrollTop = items.scrollTop;
  }, { passive: true });
  applySearch();
}

function updateTimelineRuler(ruler: HTMLElement, durationMs: number, availableWidth: number): void {
  ruler.innerHTML = '';
  for (const projected of buildTimelineTicks(durationMs, availableWidth)) {
    const tick = h('span', 'timeline-tick', projected.label);
    tick.style.left = `${projected.leftPercent}%`;
    tick.dataset.valueMs = String(projected.valueMs);
    ruler.appendChild(tick);
  }
}

function renderRuler(parent: HTMLElement, durationMs: number, availableWidth: number): HTMLElement {
  const ruler = h('div', 'timeline-ruler');
  updateTimelineRuler(ruler, durationMs, availableWidth);
  parent.appendChild(ruler);
  return ruler;
}

function renderTracks(parent: HTMLElement, definition: TimelineDefinition): void {
  const canvas = h('div', 'timeline-track-list timeline-tracks');
  definition.tracks.forEach((track, trackIndex) => {
    const row = h('div', 'timeline-track-row');
    const head = h('div', 'timeline-track-head');
    const kind = selectInput(TIMELINE_TRACKS, track.kind, (option) => timelineTrackLabel(option as TimelineTrackKind));
    kind.dataset.timelineFocus = `track-${trackIndex}-kind`;
    kind.title = '轨道类型';
    kind.onchange = () => {
      const nextKind = kind.value as TimelineTrackKind;
      if (nextKind === track.kind) return;
      if (track.cues.length > 0 && !window.confirm(`更换轨道类型会清空本轨道的 ${track.cues.length} 个演出片段，是否继续？`)) {
        kind.value = track.kind;
        return;
      }
      const previousSelection = state.currentTimelineCue ? { ...state.currentTimelineCue } : null;
      if (state.currentTimelineCue?.trackIndex === trackIndex) state.currentTimelineCue = null;
      commit((next) => { next.tracks[trackIndex] = createTrack(nextKind); }, previousSelection);
      setStatus('已更换轨道类型，可撤销', true, 4000);
    };
    head.appendChild(kind);
    if (track.kind !== 'audio') {
      const target = textInput(track.target ?? '', '轨道目标（可选）');
      target.className = 'timeline-track-target';
      target.dataset.timelineFocus = `track-${trackIndex}-target`;
      target.setAttribute('aria-label', `${timelineTrackLabel(track.kind)}轨道目标`);
      target.title = '轨道目标（留空以移除）';
      target.onchange = () => {
        const value = target.value.trim();
        commit((next) => {
          const nextTrack = next.tracks[trackIndex];
          if (!nextTrack) return;
          if (value.length === 0) delete nextTrack.target;
          else nextTrack.target = value;
        });
      };
      head.appendChild(target);
    } else if (track.target) {
      head.append(h('span', 'timeline-track-target', track.target));
    }
    const addAction = selectInput(
      TIMELINE_ACTIONS[track.kind],
      TIMELINE_ACTIONS[track.kind][0]!,
      (option) => timelineActionLabel(track.kind, option),
    );
    addAction.dataset.timelineFocus = `track-${trackIndex}-add-action`;
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
      addResource.dataset.timelineFocus = `track-${trackIndex}-add-resource`;
      refreshAddChoices();
      addAction.onchange = refreshAddChoices;
      head.appendChild(addResource);
      const openAssets = h('button', 'timeline-open-assets', '素材工作区');
      openAssets.onclick = onOpenAssets;
      head.appendChild(openAssets);
    }
    const addCue = h('button', 'track-add', '+ 演出片段');
    addCue.dataset.timelineFocus = `track-${trackIndex}-add`;
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
      const previousSelection = state.currentTimelineCue ? { ...state.currentTimelineCue } : null;
      state.currentTimelineCue = { trackIndex, cueIndex };
      commit((next) => {
        const nextTrack = next.tracks[trackIndex]!;
        if (draft.trackPatch) nextTrack.target = draft.trackPatch.target;
        nextTrack.cues.push(draft.cue);
      }, previousSelection);
    };
    head.appendChild(addCue);
    const removeTrack = h('button', 'track-remove', '删除轨道');
    removeTrack.disabled = definition.tracks.length <= 1;
    removeTrack.dataset.timelineFocus = `track-${trackIndex}-remove`;
    removeTrack.onclick = () => {
      if (track.cues.length > 0 && !window.confirm(`删除轨道会同时移除 ${track.cues.length} 个演出片段，是否继续？`)) return;
      const selection = state.currentTimelineCue;
      if (selection?.trackIndex === trackIndex) state.currentTimelineCue = null;
      else if (selection && selection.trackIndex > trackIndex) {
        state.currentTimelineCue = { trackIndex: selection.trackIndex - 1, cueIndex: selection.cueIndex };
      }
      const nextTrackIndex = Math.min(trackIndex, definition.tracks.length - 2);
      commit((next) => { next.tracks.splice(trackIndex, 1); }, selection ? { ...selection } : null);
      restoreTimelineFocus(`track-${nextTrackIndex}-add`);
      setStatus('已删除轨道，可撤销', true, 4000);
    };
    head.appendChild(removeTrack);
    row.appendChild(head);
    const lane = h('div', 'timeline-lane');
    for (const [cueIndex, cue] of track.cues.entries()) {
      const selection = state.currentTimeline === definition.id ? state.currentTimelineCue : null;
      const block = h('button', cueIndex === selection?.cueIndex && trackIndex === selection.trackIndex ? 'timeline-cue selected' : 'timeline-cue');
      block.classList.toggle('instant', cue.durationMs === 0);
      block.dataset.durationMs = String(cue.durationMs);
      block.dataset.trackIndex = String(trackIndex);
      block.dataset.cueIndex = String(cueIndex);
      block.dataset.timelineFocus = `cue-${trackIndex}-${cueIndex}`;
      const updateGeometry = (atMs: number, durationMs: number): void => {
        const geometry = projectTimelineCueGeometry(atMs, durationMs, definition.durationMs);
        block.classList.toggle('instant', durationMs === 0);
        block.classList.toggle('instant-at-end', geometry.anchorAtEnd);
        block.dataset.durationMs = String(durationMs);
        block.style.left = geometry.anchorAtEnd ? 'auto' : `${geometry.leftPercent}%`;
        block.style.right = geometry.anchorAtEnd ? '0' : 'auto';
        block.style.width = `${geometry.widthPercent}%`;
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
        selectCueInMountedPanel(definition, trackIndex, cueIndex);
        resize.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const originalDuration = cue.durationMs;
        const laneWidth = Math.max(1, lane.getBoundingClientRect().width);
        let nextDuration = originalDuration;
        const move = (moveEvent: PointerEvent) => {
          const deltaMs = (moveEvent.clientX - startX) / laneWidth * definition.durationMs;
          nextDuration = Math.max(0, Math.min(definition.durationMs - cue.atMs, Math.round(originalDuration + deltaMs)));
          updateGeometry(cue.atMs, nextDuration);
        };
        const finish = (endEvent: PointerEvent) => {
          resize.removeEventListener('pointermove', move);
          resize.removeEventListener('pointerup', finish);
          resize.removeEventListener('pointercancel', finish);
          if (resize.hasPointerCapture(endEvent.pointerId)) resize.releasePointerCapture(endEvent.pointerId);
          if (endEvent.type === 'pointercancel') updateGeometry(cue.atMs, originalDuration);
          else updateCue({ trackIndex, cueIndex }, (next) => { next.durationMs = nextDuration; });
        };
        resize.addEventListener('pointermove', move);
        resize.addEventListener('pointerup', finish, { once: true });
        resize.addEventListener('pointercancel', finish, { once: true });
        event.preventDefault();
      };
      block.appendChild(resize);
      block.title = `${timelineActionLabel(track.kind, cue.action)} · ${cue.atMs}ms + ${cue.durationMs}ms · ${timelineEasingLabel(cue.easing)}`;
      block.onpointerdown = (event) => {
        if (event.button !== 0) return;
        block.setPointerCapture(event.pointerId);
        selectCueInMountedPanel(definition, trackIndex, cueIndex);
        const startX = event.clientX;
        const originalAt = cue.atMs;
        const laneWidth = Math.max(1, lane.getBoundingClientRect().width);
        let nextAt = originalAt;
        const move = (moveEvent: PointerEvent) => {
          const deltaMs = (moveEvent.clientX - startX) / laneWidth * definition.durationMs;
          nextAt = Math.max(0, Math.min(definition.durationMs - cue.durationMs, Math.round(originalAt + deltaMs)));
          updateGeometry(nextAt, cue.durationMs);
        };
        const finish = (endEvent: PointerEvent) => {
          block.removeEventListener('pointermove', move);
          block.removeEventListener('pointerup', finish);
          block.removeEventListener('pointercancel', finish);
          if (block.hasPointerCapture(endEvent.pointerId)) block.releasePointerCapture(endEvent.pointerId);
          if (endEvent.type === 'pointercancel') updateGeometry(originalAt, cue.durationMs);
          else updateCue({ trackIndex, cueIndex }, (next) => { next.atMs = nextAt; });
        };
        block.addEventListener('pointermove', move);
        block.addEventListener('pointerup', finish, { once: true });
        block.addEventListener('pointercancel', finish, { once: true });
        event.preventDefault();
      };
      block.onclick = () => {
        selectCueInMountedPanel(definition, trackIndex, cueIndex);
      };
      lane.appendChild(block);
    }
    row.appendChild(lane);
    canvas.appendChild(row);
  });
  parent.appendChild(canvas);
}

function renderWorkbench(parent: HTMLElement, definition: TimelineDefinition): void {
  const view = timelineViewState(definition.id);
  timelineZoom = view.zoom;
  const workbench = h('div', 'timeline-workbench');
  const main = h('section', 'timeline-canvas');
  const toolbar = h('div', 'timeline-toolbar');
  const canvasTitle = h('div');
  canvasTitle.append(h('div', 'timeline-section-kicker', '演出轨道'));
  canvasTitle.append(h('div', 'timeline-canvas-hint', '拖动片段调整开始时间 · 拖动右端调整时长'));
  toolbar.appendChild(canvasTitle);
  const viewControls = h('div', 'timeline-view-controls');
  const fit = h('button', undefined, '适应窗口');
  fit.dataset.timelineFocus = 'view-fit';
  fit.onclick = () => { view.zoom = 1; timelineZoom = 1; renderTimelinePanel(rootContainer); restoreTimelineFocus('view-fit'); };
  const zoomOut = h('button', undefined, '－');
  zoomOut.dataset.timelineFocus = 'view-zoom-out';
  zoomOut.title = '缩小时间尺';
  zoomOut.onclick = () => { view.zoom = Math.max(0.75, timelineZoom - 0.25); timelineZoom = view.zoom; renderTimelinePanel(rootContainer); restoreTimelineFocus('view-zoom-out'); };
  const zoomValue = h('output', 'timeline-zoom-value', `${Math.round(timelineZoom * 100)}%`);
  const zoomIn = h('button', undefined, '＋');
  zoomIn.dataset.timelineFocus = 'view-zoom-in';
  zoomIn.title = '放大时间尺';
  zoomIn.onclick = () => { view.zoom = Math.min(3, timelineZoom + 0.25); timelineZoom = view.zoom; renderTimelinePanel(rootContainer); restoreTimelineFocus('view-zoom-in'); };
  viewControls.append(fit, zoomOut, zoomValue, zoomIn);
  toolbar.appendChild(viewControls);
  const trackControls = h('div', 'timeline-track-controls');
  const addKind = selectInput(TIMELINE_TRACKS, 'screen', (option) => timelineTrackLabel(option as TimelineTrackKind));
  addKind.dataset.timelineFocus = 'add-track-kind';
  addKind.setAttribute('aria-label', '新轨道类型');
  const addTrack = h('button', undefined, '＋ 添加轨道');
  addTrack.dataset.timelineFocus = 'add-track';
  addTrack.onclick = () => {
    const kind = addKind.value as TimelineTrackKind;
    commit((next) => next.tracks.push(createTrack(kind)));
    setStatus(`已添加${timelineTrackLabel(kind)}轨道`, true, 2500);
  };
  trackControls.append(addKind, addTrack);
  toolbar.appendChild(trackControls);
  main.appendChild(toolbar);
  const scroll = h('div', 'timeline-scroll');
  const rootWidth = rootContainer?.getBoundingClientRect().width || 1280;
  const sideBudget = rootWidth <= 800 ? 40 : rootWidth <= 1024 ? 488 : 560;
  const labelBudget = rootWidth <= 720 ? 156 : 196;
  const fittedLaneWidth = Math.max(360, rootWidth - sideBudget - labelBudget);
  const laneWidth = Math.round(fittedLaneWidth * timelineZoom);
  scroll.style.setProperty(
    '--timeline-lane-min-width',
    timelineZoom === 1 ? 'calc(100% - var(--timeline-track-label-width))' : `${laneWidth}px`,
  );
  scroll.addEventListener('scroll', () => {
    view.canvasScrollLeft = scroll.scrollLeft;
    view.canvasScrollTop = scroll.scrollTop;
  }, { passive: true });
  const ruler = renderRuler(scroll, definition.durationMs, laneWidth);
  renderTracks(scroll, definition);
  main.appendChild(scroll);
  timelineRulerObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    let lastWidth = 0;
    timelineRulerObserver = new ResizeObserver(() => {
      const width = ruler.getBoundingClientRect().width;
      if (width <= 0 || Math.abs(width - lastWidth) < 4) return;
      lastWidth = width;
      updateTimelineRuler(ruler, definition.durationMs, width);
    });
    timelineRulerObserver.observe(scroll);
  }
  workbench.appendChild(main);

  const inspector = document.createElement('details');
  inspector.className = 'timeline-inspector';
  inspector.open = rootWidth > 800 ? true : view.inspectorOpen;
  inspector.addEventListener('toggle', () => {
    if (inspector.dataset.responsiveSync !== 'true') view.inspectorOpen = inspector.open;
  });
  const summary = document.createElement('summary');
  summary.textContent = '片段设置';
  summary.addEventListener('click', () => {
    view.inspectorOpen = !inspector.open;
  });
  inspector.appendChild(summary);
  const inspectorBody = h('div', 'timeline-inspector-body');
  inspectorBody.append(h('div', 'timeline-section-kicker', '片段设置'));
  renderInspector(inspectorBody, definition);
  inspectorBody.addEventListener('scroll', () => { view.inspectorScrollTop = inspectorBody.scrollTop; }, { passive: true });
  inspector.appendChild(inspectorBody);
  workbench.appendChild(inspector);
  parent.appendChild(workbench);
}

export function renderTimelinePanel(container: HTMLElement | null): void {
  if (!container) return;
  captureTimelineViewState();
  rootContainer = container;
  timelineRulerObserver?.disconnect();
  timelineRulerObserver = null;
  timelineLayoutObserver?.disconnect();
  timelineLayoutObserver = null;
  container.innerHTML = '';
  container.setAttribute('data-editor-panel', 'timeline');
  const active = activeDefinition();
  const view = active ? timelineViewState(active.definition.id) : null;
  if (view) timelineZoom = view.zoom;
  const shell = h('div', 'timeline-shell');
  const library = document.createElement('details');
  library.className = 'timeline-list timeline-library';
  library.open = container.getBoundingClientRect().width > 800 ? true : view?.libraryOpen ?? true;
  library.addEventListener('toggle', () => {
    if (view && library.dataset.responsiveSync !== 'true') view.libraryOpen = library.open;
  });
  const librarySummary = document.createElement('summary');
  librarySummary.textContent = '演出片段库';
  librarySummary.addEventListener('click', () => {
    if (view) view.libraryOpen = !library.open;
  });
  library.appendChild(librarySummary);
  const libraryBody = h('div', 'timeline-library-body');
  renderTimelineList(libraryBody);
  library.appendChild(libraryBody);
  shell.appendChild(library);
  const content = h('section', 'timeline-content');
  if (!active) {
    const empty = h('div', 'timeline-empty');
    empty.append(h('strong', undefined, '选择一段演出开始编排'));
    empty.append(h('span', undefined, '也可以从左侧新建，随后添加轨道和演出片段。'));
    content.append(empty);
    shell.appendChild(content);
    container.appendChild(shell);
    delete container.dataset.renderedTimelineId;
    return;
  }
  const header = h('div', 'timeline-header');
  const title = h('div', 'timeline-title');
  title.append(h('div', 'timeline-section-kicker', '当前演出'));
  title.append(h('h2', undefined, active.definition.id));
  title.append(h('span', 'timeline-title-meta', `${(active.definition.durationMs / 1000).toFixed(2)} 秒 · ${active.entry.dirty ? '尚未保存' : '已保存'}`));
  const technical = document.createElement('details');
  technical.className = 'timeline-technical';
  const technicalSummary = document.createElement('summary');
  technicalSummary.textContent = '技术信息';
  const technicalValue = h('code', 'timeline-file', `${active.entry.file} · ${active.entry.eol === '\r\n' ? 'CRLF' : 'LF'}`);
  technical.append(technicalSummary, technicalValue);
  title.appendChild(technical);
  header.appendChild(title);
  const duration = numberInput(active.definition.durationMs, 0, 600000);
  duration.dataset.timelineFocus = 'timeline-duration';
  duration.title = '时间轴总时长（毫秒）';
  duration.onchange = () => commit((next) => { next.durationMs = Math.max(0, Math.round(Number(duration.value) || 0)); });
  header.append(field('总时长', duration));
  const actions = h('div', 'timeline-header-actions');
  const preview = h('button', 'primary', '▶ 预览演出');
  preview.disabled = active.issues.length > 0;
  preview.onclick = () => onPreview(active.definition.id);
  actions.appendChild(preview);
  const exportBtn = h('button', undefined, '导出演出文件');
  exportBtn.onclick = () => exportTimeline(active.definition.id, active.entry.text);
  actions.appendChild(exportBtn);
  const remove = h('button', 'danger', '删除演出');
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
      pushTimelineSnapshot(active.entry.id, active.entry.text, state.currentTimelineCue);
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
  container.dataset.renderedTimelineId = active.definition.id;
  const inspector = shell.querySelector<HTMLDetailsElement>('.timeline-inspector');
  if (typeof ResizeObserver !== 'undefined' && inspector && view) {
    let wide = container.getBoundingClientRect().width > 800;
    timelineLayoutObserver = new ResizeObserver(() => {
      const nextWide = container.getBoundingClientRect().width > 800;
      if (nextWide === wide) return;
      wide = nextWide;
      library.dataset.responsiveSync = 'true';
      inspector.dataset.responsiveSync = 'true';
      library.open = nextWide ? true : view.libraryOpen;
      inspector.open = nextWide ? true : view.inspectorOpen;
      requestAnimationFrame(() => {
        delete library.dataset.responsiveSync;
        delete inspector.dataset.responsiveSync;
      });
    });
    timelineLayoutObserver.observe(container);
  }
  restoreTimelineViewState(active.definition.id);
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
