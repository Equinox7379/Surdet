import {
  createSnapshotHistory,
  snapshotPush,
  snapshotRedo,
  snapshotUndo,
} from './history.js';
import type { SnapshotHistory } from './history.js';
import type { TimelineCueSelection } from './state.js';

export interface TimelineHistoryDepth {
  undo: number;
  redo: number;
}

export interface TimelineHistorySnapshot {
  text: string;
  selection: TimelineCueSelection | null;
}

const timelineHistories = new Map<string, SnapshotHistory<TimelineHistorySnapshot>>();

function getOrCreateTimelineHistory(timelineId: string): SnapshotHistory<TimelineHistorySnapshot> {
  let history = timelineHistories.get(timelineId);
  if (!history) {
    history = createSnapshotHistory<TimelineHistorySnapshot>();
    timelineHistories.set(timelineId, history);
  }
  return history;
}

function snapshot(text: string, selection: TimelineCueSelection | null): TimelineHistorySnapshot {
  return { text, selection: selection ? { ...selection } : null };
}

export function pushTimelineSnapshot(
  timelineId: string,
  previousText: string,
  previousSelection: TimelineCueSelection | null = null,
): void {
  snapshotPush(getOrCreateTimelineHistory(timelineId), snapshot(previousText, previousSelection), Date.now(), false);
}

export function takeTimelineUndo(
  timelineId: string,
  currentText: string,
  currentSelection: TimelineCueSelection | null = null,
): TimelineHistorySnapshot | null {
  const history = timelineHistories.get(timelineId);
  return history ? snapshotUndo(history, snapshot(currentText, currentSelection)) : null;
}

export function takeTimelineRedo(
  timelineId: string,
  currentText: string,
  currentSelection: TimelineCueSelection | null = null,
): TimelineHistorySnapshot | null {
  const history = timelineHistories.get(timelineId);
  return history ? snapshotRedo(history, snapshot(currentText, currentSelection)) : null;
}

export function clearTimelineHistory(timelineId: string): void {
  timelineHistories.delete(timelineId);
}

export function clearTimelineHistories(): void {
  timelineHistories.clear();
}

export function timelineHistoryDepth(timelineId?: string): TimelineHistoryDepth {
  if (timelineId !== undefined) {
    const history = timelineHistories.get(timelineId);
    return history
      ? { undo: history.past.length, redo: history.future.length }
      : { undo: 0, redo: 0 };
  }

  let undo = 0;
  let redo = 0;
  for (const history of timelineHistories.values()) {
    undo += history.past.length;
    redo += history.future.length;
  }
  return { undo, redo };
}
