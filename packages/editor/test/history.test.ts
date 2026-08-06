/**
 * history.ts 撤销栈语义测试（E0：200 条上限 + 600ms 打字合并 + undo/redo 边界）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../src/state.js';
import type { SceneEntry } from '../src/state.js';
import {
  HISTORY_LIMIT, COALESCE_MS, histories, pushEdit, getHistoryFor,
  bindHistoryHooks, setCurrentText, undo, redo,
  createSnapshotHistory, snapshotPush, snapshotUndo, snapshotRedo, SNAPSHOT_HISTORY_LIMIT,
} from '../src/history.js';
import type { SceneHistory } from '../src/history.js';

function makeScene(id: string, text: string): SceneEntry {
  return { id, file: `${id}.gal`, text, eol: '\n', dirty: false, handle: null };
}

describe('history（撤销/重做）', () => {
  beforeEach(() => {
    state.scenes.clear();
    histories.clear();
    state.current = null;
    bindHistoryHooks({ onEdited: () => {}, onHistoryNav: () => {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pushEdit 纯逻辑', () => {
    it('coalesce 窗口以最近一次入栈时刻为锚（滑动）：链式快速输入持续合并', () => {
      const hist: SceneHistory = { past: [], future: [], lastPushAt: 0 };
      pushEdit(hist, 'v0', 1000, true);
      pushEdit(hist, 'v1', 1000 + COALESCE_MS - 1, true); // 窗口内，合并（锚点前移）
      pushEdit(hist, 'v2', 1000 + 2 * (COALESCE_MS - 1), true); // 距新锚点仍在窗内 → 继续合并
      expect(hist.past).toEqual(['v0']);
    });

    it('coalesce 窗口外（距锚点 ≥600ms）的编辑产生新撤销点', () => {
      const hist: SceneHistory = { past: [], future: [], lastPushAt: 0 };
      pushEdit(hist, 'v0', 1000, true);
      pushEdit(hist, 'v1', 1000 + COALESCE_MS, true); // now - lastPushAt === 600 ≥ 窗口 → 新点
      expect(hist.past).toEqual(['v0', 'v1']);
    });

    it('非 coalesce 编辑永不合并', () => {
      const hist: SceneHistory = { past: [], future: [], lastPushAt: 0 };
      pushEdit(hist, 'v0', 1000, false);
      pushEdit(hist, 'v1', 1001, false);
      expect(hist.past).toEqual(['v0', 'v1']);
    });

    it('超过 HISTORY_LIMIT 丢弃最旧撤销点', () => {
      const hist: SceneHistory = { past: [], future: [], lastPushAt: 0 };
      for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
        pushEdit(hist, `v${i}`, i * 10_000, false); // 间隔远超合并窗口
      }
      expect(hist.past).toHaveLength(HISTORY_LIMIT);
      expect(hist.past[0]).toBe('v5'); // 最旧 5 条被丢弃
      expect(hist.past[HISTORY_LIMIT - 1]).toBe(`v${HISTORY_LIMIT + 4}`);
    });

    it('新编辑清空 redo 栈', () => {
      const hist: SceneHistory = { past: ['a'], future: ['x', 'y'], lastPushAt: 0 };
      pushEdit(hist, 'b', 100_000, false);
      expect(hist.future).toEqual([]);
    });
  });

  describe('setCurrentText / undo / redo（经 state 的完整路径）', () => {
    it('setCurrentText 写入文本并置脏；打字合并窗口内只留一个撤销点', () => {
      state.scenes.set('s1', makeScene('s1', 'line0'));
      state.current = 's1';
      const now = 5000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      setCurrentText('line1', { coalesce: true });
      vi.spyOn(Date, 'now').mockReturnValue(now + 100);
      setCurrentText('line2', { coalesce: true }); // 窗口内合并

      const sc = state.scenes.get('s1')!;
      expect(sc.text).toBe('line2');
      expect(sc.dirty).toBe(true);
      expect(getHistoryFor('s1').past).toEqual(['line0']); // 合并：仅一个撤销点

      undo();
      expect(sc.text).toBe('line0'); // 一步回到合并前
    });

    it('undo 后的新编辑：合并标记归零 + redo 栈清空（撤销分叉语义）', () => {
      state.scenes.set('s1', makeScene('s1', 'a'));
      state.current = 's1';
      const now = 9000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      setCurrentText('b');
      undo();
      expect(state.scenes.get('s1')!.text).toBe('a');

      // 撤销后 lastPushAt 归零：即使紧跟 coalesce 编辑也会产生新撤销点（不与已撤销内容合并）
      vi.spyOn(Date, 'now').mockReturnValue(now + 1);
      setCurrentText('c', { coalesce: true });
      expect(getHistoryFor('s1').past).toEqual(['a']); // 新撤销点 = 编辑前文本（undo 已弹空旧栈）
      redo(); // redo 栈已被 setCurrentText('c') 清空 → 无效
      expect(state.scenes.get('s1')!.text).toBe('c');
    });

    it('空栈 undo/redo 安全无副作用', () => {
      state.scenes.set('s1', makeScene('s1', 'x'));
      state.current = 's1';
      undo();
      redo();
      expect(state.scenes.get('s1')!.text).toBe('x');
      expect(state.scenes.get('s1')!.dirty).toBe(false);
    });

    it('无当前场景时 setCurrentText/undo/redo 安全返回', () => {
      state.current = null;
      setCurrentText('whatever');
      undo();
      redo();
      expect(state.scenes.size).toBe(0);
    });

    it('多场景历史栈互不干扰', () => {
      state.scenes.set('s1', makeScene('s1', 'a1'));
      state.scenes.set('s2', makeScene('s2', 'b1'));
      state.current = 's1';
      setCurrentText('a2');
      state.current = 's2';
      setCurrentText('b2');
      undo();
      expect(state.scenes.get('s2')!.text).toBe('b1');
      expect(state.scenes.get('s1')!.text).toBe('a2'); // s1 不受影响
      state.current = 's1';
      undo();
      expect(state.scenes.get('s1')!.text).toBe('a1');
    });
  });

  describe('快照撤销栈（配置页 undo 纯逻辑）', () => {
    it('coalesce 窗口内连续快照合并为一个撤销点', () => {
      const hist = createSnapshotHistory<string>();
      snapshotPush(hist, 'v0', 1000, true);
      snapshotPush(hist, 'v1', 1000 + COALESCE_MS - 1, true);
      expect(hist.past).toEqual(['v0']);
    });

    it('结构操作（coalesce=false）永不合并；新快照清空 redo', () => {
      const hist = createSnapshotHistory<string>();
      snapshotPush(hist, 'v0', 1000, false);
      snapshotPush(hist, 'v1', 1001, false);
      expect(hist.past).toEqual(['v0', 'v1']);
      hist.future = ['x'];
      snapshotPush(hist, 'v2', 1002, false);
      expect(hist.future).toEqual([]);
    });

    it('超过 SNAPSHOT_HISTORY_LIMIT 丢弃最旧', () => {
      const hist = createSnapshotHistory<number>();
      for (let i = 0; i < SNAPSHOT_HISTORY_LIMIT + 5; i++) snapshotPush(hist, i, i * 10_000, false);
      expect(hist.past).toHaveLength(SNAPSHOT_HISTORY_LIMIT);
      expect(hist.past[0]).toBe(5);
    });

    it('undo/redo 往返：current 入对栈，恢复点正确；空栈返回 null', () => {
      const hist = createSnapshotHistory<string>();
      snapshotPush(hist, 's1', 1000, false);
      snapshotPush(hist, 's2', 2000, false);
      const u1 = snapshotUndo(hist, 'cur');
      expect(u1).toBe('s2');
      expect(hist.future).toEqual(['cur']);
      const r1 = snapshotRedo(hist, 's2');
      expect(r1).toBe('cur');
      expect(hist.past).toEqual(['s1', 's2']);
      // 空栈边界
      const empty = createSnapshotHistory<string>();
      expect(snapshotUndo(empty, 'x')).toBeNull();
      expect(snapshotRedo(empty, 'x')).toBeNull();
    });

    it('undo 后 lastPushAt 归零：紧跟的 coalesce 快照仍产生新撤销点', () => {
      const hist = createSnapshotHistory<string>();
      snapshotPush(hist, 's1', 1000, false);
      snapshotUndo(hist, 'cur');
      snapshotPush(hist, 's3', 1001, true); // 距上次入栈仅 1ms，但已归零不合并
      expect(hist.past).toEqual(['s3']);
    });
  });
});
