import { Container, EventBoundary, FederatedEvent, FederatedPointerEvent, Rectangle } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { bindPlayerControl } from '../src/player-controls.js';

describe('player control projection', () => {
  it('keeps physical activation singular while bridging native accessible activation to the original handler', () => {
    const target = new Container();
    const activate = vi.fn();
    target.on('pointerdown', activate);
    bindPlayerControl(target, { label: '读取记录', x: -8, y: -8, width: 160, height: 48 });
    const pointer = new FederatedPointerEvent(new EventBoundary(target));
    target.emit('pointerdown', pointer);
    target.emit('click', pointer);
    expect(activate).toHaveBeenCalledTimes(1);
    target.emit('click', new FederatedEvent(new EventBoundary(target)) as FederatedPointerEvent);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(target.hitArea).toEqual(new Rectangle(-8, -8, 160, 48));
    expect(target.accessibleHint).toBe('读取记录');
    target.destroy();
  });

  it('does not dispatch an inaccessible action and exposes the reason in its accessible name', () => {
    const target = new Container(); const activate = vi.fn();
    target.on('pointerdown', activate);
    bindPlayerControl(target, { label: '尚未解锁', width: 160, height: 48, enabled: false });
    target.emit('click', new FederatedEvent(new EventBoundary(target)) as FederatedPointerEvent);
    expect(activate).not.toHaveBeenCalled();
    expect(target.accessibleHint).toContain('不可用');
    expect(target.tabIndex).toBe(-1);
    target.destroy();
  });

  it('reveals an offscreen focused control before applying its focus appearance', () => {
    const target = new Container(); const events: string[] = [];
    target.on('pointerover', () => events.push('focus'));
    bindPlayerControl(target, { label: '末项', width: 160, height: 48, reveal: () => events.push('reveal') });
    target.emit('mouseover', new FederatedEvent(new EventBoundary(target)) as FederatedPointerEvent);
    expect(events).toEqual(['reveal', 'focus']);
    target.destroy();
  });
});
