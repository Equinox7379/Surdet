import { h, state, setStatus } from '../state.js';
import { parseTimelineText } from '../timeline-model.js';
import { timelineTrackLabel, timelineActionLabel } from '../timeline-presentation.js';
import { button, navigateTimeline } from './ui.js';

/** The current timeline document, linked to its original editor. No playback projection. */
export function renderTimelineSummary(id: string): HTMLElement {
  const section = h('section', 'studio-timeline-summary');
  const entry = state.timelines.find((timeline) => timeline.id === id);
  const heading = h('div', 'studio-timeline-summary-heading');
  heading.append(h('strong', undefined, id)); section.append(heading);
  if (!entry) { section.append(h('p', 'v4-muted', '引用的时间轴不存在。')); return section; }
  const expected = entry.text;
  const open = (trackIndex?: number, cueIndex?: number): void => {
    if (!state.timelines.includes(entry) || entry.text !== expected) {
      setStatus('时间轴已变化，请重新选择步骤后定位', false, 5000); return;
    }
    navigateTimeline(id, trackIndex === undefined ? undefined : { trackIndex, cueIndex: cueIndex! });
  };
  heading.append(button('打开时间轴', () => open()));
  const { definition, issues } = parseTimelineText(expected);
  if (!definition) { section.append(h('p', 'v4-muted', `时间轴无法解析：${issues.join('；')}`)); return section; }
  section.append(h('p', 'v4-source-hint', `${(definition.durationMs / 1000).toFixed(2)} 秒 · ${entry.dirty ? '当前草稿' : '已保存'} · 点击节点编辑`));
  for (const [trackIndex, track] of definition.tracks.entries()) {
    const row = h('div', 'studio-timeline-summary-track');
    const label = h('span', 'studio-timeline-track-label', timelineTrackLabel(track.kind));
    label.title = 'target' in track ? String(track.target) : timelineTrackLabel(track.kind);
    const lane = h('div', 'studio-timeline-summary-lane');
    for (const [cueIndex, cue] of track.cues.entries()) {
      const action = timelineActionLabel(track.kind, cue.action);
      const control = button(action, () => open(trackIndex, cueIndex), 'studio-timeline-summary-cue');
      control.setAttribute('aria-label', `编辑 ${id} ${timelineTrackLabel(track.kind)} 第 ${cueIndex + 1} 个节点 ${action}`);
      control.title = `${action} · ${(cue.atMs / 1000).toFixed(2)} 秒开始 · 持续 ${(cue.durationMs / 1000).toFixed(2)} 秒`;
      const span = Math.max(1, definition.durationMs);
      control.style.left = `${Math.min(96, cue.atMs / span * 100)}%`;
      control.style.width = `${Math.min(100 - Math.min(96, cue.atMs / span * 100), Math.max(4, cue.durationMs / span * 100))}%`;
      control.dataset.trackKind = track.kind;
      lane.append(control);
    }
    if (!track.cues.length) lane.append(h('small', 'v4-muted', '空轨道'));
    row.append(label, lane); section.append(row);
  }
  return section;
}
