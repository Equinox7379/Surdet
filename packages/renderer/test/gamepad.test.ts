/**
 * M7 支柱5：手柄边沿检测纯逻辑测试。
 */
import { describe, expect, it } from 'vitest';
import { diffGamepad, rendererInputForGamepadAction, snapshotOf } from '../src/gamepad.js';
import type { GamepadSnapshot } from '../src/gamepad.js';

function snap(buttons: number[], axes: number[] = [0, 0]): GamepadSnapshot {
  const arr = Array.from({ length: 17 }, (_, i) => buttons.includes(i));
  return { buttons: arr, axes };
}

describe('diffGamepad（边沿检测）', () => {
  it('A 键按下产出 advance；按住不重复', () => {
    const prev = snap([]);
    const cur = snap([0]);
    expect(diffGamepad(prev, cur)).toEqual(['advance']);
    expect(diffGamepad(cur, snap([0]))).toEqual([]); // 按住
    expect(diffGamepad(snap([0]), snap([]))).toEqual([]); // 松开无动作
  });

  it('B/Start/LB/RB 映射 cancel/menu/shoulderLeft/shoulderRight', () => {
    expect(diffGamepad(null, snap([1]))).toEqual(['cancel']);
    expect(diffGamepad(null, snap([9]))).toEqual(['menu']);
    expect(diffGamepad(null, snap([4]))).toEqual(['shoulderLeft']);
    expect(diffGamepad(null, snap([5]))).toEqual(['shoulderRight']);
  });

  it('十字键方向按下产出对应动作；按住不重复', () => {
    const up = snap([12]);
    expect(diffGamepad(snap([]), up)).toEqual(['up']);
    expect(diffGamepad(up, up)).toEqual([]);
    expect(diffGamepad(up, snap([13]))).toEqual(['down']); // 换向
  });

  it('左摇杆超阈值产出方向；死区内不产出', () => {
    expect(diffGamepad(snap([], [0, 0]), snap([], [0, 0.9]))).toEqual(['down']);
    expect(diffGamepad(snap([], [0, 0]), snap([], [-0.8, 0]))).toEqual(['left']);
    expect(diffGamepad(snap([], [0, 0]), snap([], [0.3, 0.3]))).toEqual([]); // 死区
  });

  it('十字键优先于摇杆（同帧只取十字键）', () => {
    expect(diffGamepad(null, snap([12], [0, 0.9]))).toEqual(['up']);
  });

  it('同帧多键齐按全部产出', () => {
    const got = diffGamepad(null, snap([0, 12, 5]));
    expect(got).toContain('advance');
    expect(got).toContain('up');
    expect(got).toContain('shoulderRight');
    expect(got).toHaveLength(3);
  });

  it('snapshotOf 快照化真实手柄形状', () => {
    const pad = {
      buttons: [{ pressed: true }, { pressed: false }],
      axes: [0.2, -0.7],
    };
    const s = snapshotOf(pad);
    expect(s.buttons).toEqual([true, false]);
    expect(s.axes).toEqual([0.2, -0.7]);
  });

  it('maps gamepad renderer actions without installing listeners', () => {
    expect(rendererInputForGamepadAction('advance')).toEqual({ type: 'advance' });
    expect(rendererInputForGamepadAction('cancel')).toEqual({ type: 'escape' });
    expect(rendererInputForGamepadAction('up')).toEqual({ type: 'choice.move', delta: -1 });
    expect(rendererInputForGamepadAction('right')).toEqual({ type: 'choice.move', delta: 1 });
    expect(rendererInputForGamepadAction('shoulderRight')).toEqual({ type: 'skip.toggle', scope: 'read' });
    expect(rendererInputForGamepadAction('shoulderRight', false)).toEqual({ type: 'skip.toggle', scope: 'read' });
    expect(rendererInputForGamepadAction('shoulderRight', true)).toBeNull();
    expect(rendererInputForGamepadAction('shoulderLeft', false)).toBeNull();
    expect(rendererInputForGamepadAction('shoulderLeft', true)).toEqual({ type: 'skip.toggle', scope: 'read' });
    expect(rendererInputForGamepadAction('menu')).toBeNull();
  });
});
