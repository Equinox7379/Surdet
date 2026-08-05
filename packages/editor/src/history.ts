/**
 * 撤销/重做（E0 拆分：原 main.ts 纯搬移，自我迭代①a）。
 * 保留 200 条上限与 600ms 打字合并语义；UI/校验联动经钩子注入（main.ts 装配），
 * 模块本身无 DOM 依赖，可单测。
 */
import { state } from './state.js';

export interface SceneHistory { past: string[]; future: string[]; lastPushAt: number }
export const histories = new Map<string, SceneHistory>();
export const HISTORY_LIMIT = 200;
/** 打字合并窗口：窗口内的连续输入只记一个撤销点 */
export const COALESCE_MS = 600;

/** 联动钩子（main.ts 注入）：文本变更后调度校验；undo/redo 后刷新编辑器与侧栏 */
let onEdited: () => void = () => {};
let onHistoryNav: () => void = () => {};

export function bindHistoryHooks(opts: { onEdited: () => void; onHistoryNav: () => void }): void {
  onEdited = opts.onEdited;
  onHistoryNav = opts.onHistoryNav;
}

export function getHistoryFor(key: string): SceneHistory {
  let hist = histories.get(key);
  if (!hist) {
    hist = { past: [], future: [], lastPushAt: 0 };
    histories.set(key, hist);
  }
  return hist;
}

function getHistory(): SceneHistory | null {
  if (!state.current) return null;
  return getHistoryFor(state.current);
}

/** 入栈纯逻辑（可测）：coalesce 窗口内不新增撤销点；超上限丢弃最旧；新编辑清空 redo */
export function pushEdit(hist: SceneHistory, prevText: string, now: number, coalesce: boolean): void {
  if (coalesce && hist.past.length > 0 && now - hist.lastPushAt < COALESCE_MS) {
    hist.lastPushAt = now; // 打字合并：不入新撤销点
    return;
  }
  hist.past.push(prevText);
  if (hist.past.length > HISTORY_LIMIT) hist.past.shift();
  hist.future = [];
  hist.lastPushAt = now;
}

export function undo(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  const hist = getHistory();
  if (!sc || !hist || hist.past.length === 0) return;
  const prev = hist.past.pop()!;
  hist.future.push(sc.text);
  hist.lastPushAt = 0; // 撤销后的新编辑不与之合并
  sc.text = prev;
  sc.dirty = true;
  onEdited();
  onHistoryNav();
}

export function redo(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  const hist = getHistory();
  if (!sc || !hist || hist.future.length === 0) return;
  const next = hist.future.pop()!;
  hist.past.push(sc.text);
  hist.lastPushAt = 0;
  sc.text = next;
  sc.dirty = true;
  onEdited();
  onHistoryNav();
}

export function setCurrentText(text: string, opts?: { coalesce?: boolean }): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  if (!sc) return;
  const hist = getHistory();
  if (hist) pushEdit(hist, sc.text, Date.now(), opts?.coalesce === true);
  sc.text = text;
  sc.dirty = true;
  onEdited();
}
