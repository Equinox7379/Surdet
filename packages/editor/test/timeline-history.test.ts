import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTimelineHistories,
  clearTimelineHistory,
  pushTimelineSnapshot,
  takeTimelineRedo,
  takeTimelineUndo,
  timelineHistoryDepth,
} from '../src/timeline-history.js';

describe('timeline history（独立文本快照栈）', () => {
  beforeEach(() => {
    clearTimelineHistories();
  });

  it('按 timeline id 隔离历史，并逐字恢复各自文本', () => {
    const previousA = '{\r\n  "id": "timeline-a",\r\n  "unknown": true\r\n}\r\n';
    const previousB = '{\n  "id": "timeline-b"\n}\n';

    pushTimelineSnapshot('timeline-a', previousA);
    pushTimelineSnapshot('timeline-b', previousB);

    expect(takeTimelineUndo('timeline-a', '{"id":"timeline-a","duration":8}\r\n')?.text).toBe(previousA);
    expect(timelineHistoryDepth('timeline-a')).toEqual({ undo: 0, redo: 1 });
    expect(timelineHistoryDepth('timeline-b')).toEqual({ undo: 1, redo: 0 });
    expect(takeTimelineUndo('timeline-b', '{"id":"timeline-b","duration":12}\n')?.text).toBe(previousB);
  });

  it('undo 后 redo 恢复撤销前的当前文本', () => {
    pushTimelineSnapshot('timeline-a', 'before');

    expect(takeTimelineUndo('timeline-a', 'after')?.text).toBe('before');
    expect(takeTimelineRedo('timeline-a', 'before')?.text).toBe('after');
    expect(timelineHistoryDepth('timeline-a')).toEqual({ undo: 1, redo: 0 });
  });

  it('undo 后的新编辑清空 redo 分支', () => {
    pushTimelineSnapshot('timeline-a', 'before');
    expect(takeTimelineUndo('timeline-a', 'first edit')?.text).toBe('before');
    expect(timelineHistoryDepth('timeline-a')).toEqual({ undo: 0, redo: 1 });

    pushTimelineSnapshot('timeline-a', 'before');

    expect(timelineHistoryDepth('timeline-a')).toEqual({ undo: 1, redo: 0 });
    expect(takeTimelineRedo('timeline-a', 'second edit')).toBeNull();
  });

  it('clearTimelineHistory 只清除指定 timeline', () => {
    pushTimelineSnapshot('timeline-a', 'a0');
    pushTimelineSnapshot('timeline-b', 'b0');

    clearTimelineHistory('timeline-a');

    expect(timelineHistoryDepth('timeline-a')).toEqual({ undo: 0, redo: 0 });
    expect(timelineHistoryDepth('timeline-b')).toEqual({ undo: 1, redo: 0 });
    expect(takeTimelineUndo('timeline-a', 'a1')).toBeNull();
    expect(takeTimelineUndo('timeline-b', 'b1')?.text).toBe('b0');
  });

  it('撤销和重做随文本恢复共享 cue 选择', () => {
    pushTimelineSnapshot('timeline-a', 'before', { trackIndex: 1, cueIndex: 2 });

    expect(takeTimelineUndo('timeline-a', 'after', { trackIndex: 0, cueIndex: 0 })).toEqual({
      text: 'before',
      selection: { trackIndex: 1, cueIndex: 2 },
    });
    expect(takeTimelineRedo('timeline-a', 'before', { trackIndex: 1, cueIndex: 2 })).toEqual({
      text: 'after',
      selection: { trackIndex: 0, cueIndex: 0 },
    });
  });

  it('clearTimelineHistories 清除全部 timeline 历史', () => {
    pushTimelineSnapshot('timeline-a', 'a0');
    pushTimelineSnapshot('timeline-b', 'b0');
    expect(timelineHistoryDepth()).toEqual({ undo: 2, redo: 0 });

    clearTimelineHistories();

    expect(timelineHistoryDepth()).toEqual({ undo: 0, redo: 0 });
    expect(takeTimelineUndo('timeline-a', 'a1')).toBeNull();
    expect(takeTimelineUndo('timeline-b', 'b1')).toBeNull();
  });
});
