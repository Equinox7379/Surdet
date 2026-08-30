import {
  createSnapshotHistory,
  snapshotPush,
  snapshotRedo,
  snapshotUndo,
} from './history.js';
import type { SnapshotHistory } from './history.js';

export interface TimelineHistoryDepth {
  undo: number;
  redo: number;
}

const timelineHistories = new Map<string, SnapshotHistory<string>>();

function getOrCreateTimelineHistory(timelineId: string): SnapshotHistory<string> {
  let history = timelineHistories.get(timelineId);
  if (!history) {
    history = createSnapshotHistory<string>();
    timelineHistories.set(timelineId, history);
  }
  return history;
}

export function pushTimelineSnapshot(timelineId: string, previousText: string): void {
  snapshotPush(getOrCreateTimelineHistory(timelineId), previousText, Date.now(), false);
}

export function takeTimelineUndo(timelineId: string, currentText: string): string | null {
  const history = timelineHistories.get(timelineId);
  return history ? snapshotUndo(history, currentText) : null;
}

export function takeTimelineRedo(timelineId: string, currentText: string): string | null {
  const history = timelineHistories.get(timelineId);
  return history ? snapshotRedo(history, currentText) : null;
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
