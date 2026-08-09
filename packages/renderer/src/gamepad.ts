/**
 * 手柄适配层（M7 支柱5：一键商业化）。
 * 标准布局映射：A=推进/确认 · B/Start=菜单 · 十字键/左摇杆=选择肢导航 · RB=快进开关 · LB=关闭快进。
 * 纯函数 diffGamepad 负责边沿检测（可单测）；GamepadPoller 负责 rAF 轮询与帧间状态。
 */

export type GamepadAction =
  | 'advance' | 'cancel' | 'menu'
  | 'up' | 'down' | 'left' | 'right'
  | 'shoulderLeft' | 'shoulderRight';

/** Convert gamepad edges to Renderer actions without installing browser listeners. */
export function rendererInputForGamepadAction(action: GamepadAction): RendererInputAction | null {
  switch (action) {
    case 'advance': return { type: 'advance' };
    case 'cancel': return { type: 'escape' };
    case 'up':
    case 'left': return { type: 'choice.move', delta: -1 };
    case 'down':
    case 'right': return { type: 'choice.move', delta: 1 };
    case 'shoulderLeft':
    case 'shoulderRight': return { type: 'skip.toggle', scope: 'read' };
    case 'menu': return null;
  }
}

export interface GamepadSnapshot {
  buttons: boolean[];
  axes: number[];
}

/** 标准布局按键索引 */
const BTN_A = 0;
const BTN_B = 1;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_START = 9;
const BTN_UP = 12;
const BTN_DOWN = 13;
const BTN_LEFT = 14;
const BTN_RIGHT = 15;

/** 摇杆死区阈值 */
const AXIS_THRESHOLD = 0.5;

export function snapshotOf(pad: { buttons: readonly { pressed: boolean }[]; axes: readonly number[] }): GamepadSnapshot {
  return { buttons: pad.buttons.map((b) => b.pressed), axes: [...pad.axes] };
}

function pressed(s: GamepadSnapshot, i: number): boolean {
  return s.buttons[i] === true;
}

/** 方向来源：十字键优先，其次左摇杆（轴 0/1，超阈值） */
function directionsOf(s: GamepadSnapshot): GamepadAction[] {
  const dirs: GamepadAction[] = [];
  if (pressed(s, BTN_UP)) dirs.push('up');
  if (pressed(s, BTN_DOWN)) dirs.push('down');
  if (pressed(s, BTN_LEFT)) dirs.push('left');
  if (pressed(s, BTN_RIGHT)) dirs.push('right');
  if (dirs.length > 0) return dirs;
  const ax = s.axes[0] ?? 0;
  const ay = s.axes[1] ?? 0;
  if (ay < -AXIS_THRESHOLD) dirs.push('up');
  else if (ay > AXIS_THRESHOLD) dirs.push('down');
  if (ax < -AXIS_THRESHOLD) dirs.push('left');
  else if (ax > AXIS_THRESHOLD) dirs.push('right');
  return dirs;
}

/**
 * 边沿检测：对比上一帧快照，产出本帧新触发的动作。
 * 按键：上一帧未按 → 本帧按下才产出；方向：方向集变化时产出新增方向（按住不重复）。
 */
export function diffGamepad(prev: GamepadSnapshot | null, cur: GamepadSnapshot): GamepadAction[] {
  const actions: GamepadAction[] = [];
  const edge = (idx: number, action: GamepadAction): void => {
    if (pressed(cur, idx) && !(prev && pressed(prev, idx))) actions.push(action);
  };
  edge(BTN_A, 'advance');
  edge(BTN_B, 'cancel');
  edge(BTN_START, 'menu');
  edge(BTN_LB, 'shoulderLeft');
  edge(BTN_RB, 'shoulderRight');

  const curDirs = new Set(directionsOf(cur));
  const prevDirs = new Set(prev ? directionsOf(prev) : []);
  for (const d of curDirs) {
    if (!prevDirs.has(d)) actions.push(d);
  }
  return actions;
}

/**
 * rAF 轮询器：每帧读取第一个已连接手柄，diff 出动作后回调。
 * 无手柄/非浏览器环境时 start() 为无操作。
 */
export class GamepadPoller {
  #raf = 0;
  #prev: GamepadSnapshot | null = null;
  #running = false;

  constructor(private readonly onActions: (actions: GamepadAction[]) => void) {}

  start(): void {
    if (this.#running) return;
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    if (typeof requestAnimationFrame !== 'function') return;
    this.#running = true;
    const loop = (): void => {
      if (!this.#running) return;
      const pads = navigator.getGamepads();
      const pad = pads && [...pads].find((p) => p && p.connected);
      if (pad) {
        const cur = snapshotOf(pad);
        const actions = diffGamepad(this.#prev, cur);
        if (actions.length > 0) this.onActions(actions);
        this.#prev = cur;
      } else {
        this.#prev = null;
      }
      this.#raf = requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.#running = false;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#raf);
    this.#prev = null;
  }
}
import type { RendererInputAction } from './api/renderer-input.js';
