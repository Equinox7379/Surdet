import { describe, expect, it } from 'vitest';
import {
  PlayerInputGate,
  canAdvance,
  canRollback,
  createPlayerUiSession,
  shouldRestoreInterfaceOnPointer,
  shouldShowCommandRail,
  type PlayerOverlay,
  type PlayerUiSessionSnapshot,
} from '../src/player-ui.js';

const overlays: readonly Exclude<PlayerOverlay, 'none'>[] = [
  'system-menu',
  'save-load',
  'settings',
  'gallery',
  'backlog',
];

describe('public player UI coordination', () => {
  it.each(overlays)('keeps %s as the exclusive blocking overlay', (overlay) => {
    const session = createPlayerUiSession({ base: 'game' });
    expect(session.openOverlay(overlay).overlay).toBe(overlay);
    expect(canAdvance(session.snapshot())).toBe(false);
    expect(canRollback(session.snapshot())).toBe(false);
    expect(session.closeOverlay().overlay).toBe('none');
  });

  it('rejects impossible transitions and restores a failed transaction exactly', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.openOverlay('save-load');
    const origin = session.snapshot();
    session.beginOperation('saving');
    expect(() => session.openOverlay('settings')).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(session.failOperation()).toBe(origin);
  });

  it('exposes pure state selectors for hidden UI, overlays and busy save/load', () => {
    const session = createPlayerUiSession({ base: 'game' });
    const visible = session.snapshot();
    expect(canAdvance(visible)).toBe(true);
    expect(canRollback(visible)).toBe(true);
    expect(shouldShowCommandRail(visible)).toBe(true);

    session.setInterfaceHidden(true);
    const hidden = session.snapshot();
    expect(canAdvance(hidden)).toBe(false);
    expect(shouldRestoreInterfaceOnPointer(hidden)).toBe(true);
    expect(shouldShowCommandRail(hidden)).toBe(false);

    session.setInterfaceHidden(false);
    session.beginOperation('loading');
    expect(canAdvance(session.snapshot())).toBe(false);
    expect(shouldShowCommandRail(session.snapshot())).toBe(false);
  });

  it('has a synchronous pointer consumption contract with no event leakage', () => {
    const gate = new PlayerInputGate();
    const snapshot: PlayerUiSessionSnapshot = createPlayerUiSession({ base: 'game' }).snapshot();
    expect(gate.snapshot()).toEqual({ currentPointerConsumed: false });
    gate.consumeCurrentPointer();
    expect(gate.snapshot()).toEqual({ currentPointerConsumed: true });
    expect(gate.decidePointer(snapshot, { button: 0 })).toBe('ignore');
    expect(gate.snapshot()).toEqual({ currentPointerConsumed: false });
    expect(gate.decidePointer(snapshot, { button: 0 })).toBe('advance');
  });

  it('restores nested game overlays in LIFO order', () => {
    const session = createPlayerUiSession({ base: 'game' });

    expect(session.openOverlay('system-menu')).toMatchObject({
      base: 'game',
      overlay: 'system-menu',
      returnStack: [{ base: 'game', overlay: 'none' }],
    });
    expect(session.pushOverlay('settings')).toMatchObject({
      base: 'game',
      overlay: 'settings',
      returnStack: [
        { base: 'game', overlay: 'none' },
        { base: 'game', overlay: 'system-menu' },
      ],
    });
    expect(session.closeOverlay()).toMatchObject({
      base: 'game',
      overlay: 'system-menu',
      returnStack: [{ base: 'game', overlay: 'none' }],
    });
    expect(session.closeOverlay()).toMatchObject({
      base: 'game',
      overlay: 'none',
      returnStack: [],
    });
  });

  it('returns from title gallery and can dismiss all overlays', () => {
    const session = createPlayerUiSession({ base: 'title' });
    session.openOverlay('gallery');
    expect(session.closeOverlay()).toMatchObject({
      base: 'title',
      overlay: 'none',
      returnStack: [],
    });

    session.enterGame();
    session.openOverlay('system-menu');
    session.pushOverlay('settings');
    expect(session.dismissOverlays()).toMatchObject({
      base: 'game',
      overlay: 'none',
      returnStack: [],
    });
  });

  it('restores the complete return stack on operation failure and clears it on success', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.openOverlay('system-menu');
    session.pushOverlay('settings');
    const origin = session.snapshot();

    session.beginOperation('loading');
    expect(session.failOperation()).toBe(origin);
    expect(session.snapshot()).toMatchObject({
      overlay: 'settings',
      returnStack: [
        { base: 'game', overlay: 'none' },
        { base: 'game', overlay: 'system-menu' },
      ],
    });

    session.beginOperation('saving');
    expect(session.completeOperation()).toMatchObject({
      base: 'game',
      overlay: 'none',
      operation: 'idle',
      returnStack: [],
    });
  });

  it('freezes the snapshot, return stack and every frame without exposing mutable state', () => {
    const session = createPlayerUiSession({ base: 'game' });
    const snapshot = session.openOverlay('system-menu');
    session.pushOverlay('settings');
    const nested = session.snapshot();

    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.returnStack)).toBe(true);
    expect(nested.returnStack.every((frame) => Object.isFrozen(frame))).toBe(true);
    expect(() => {
      (nested.returnStack as Array<{ base: string; overlay: string }>).push({
        base: 'title',
        overlay: 'none',
      });
    }).toThrow();
    expect(() => {
      (nested.returnStack[0] as { base: string }).base = 'title';
    }).toThrow();
    expect(session.snapshot().returnStack[0]).toEqual(snapshot.returnStack[0]);

    const reset = session.reset('title');
    expect(reset.returnStack).toEqual([]);
    expect(Object.isFrozen(reset.returnStack)).toBe(true);
  });

  it('rejects stack mutations while an operation is busy', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.openOverlay('system-menu');
    session.beginOperation('saving');

    expect(() => session.pushOverlay('settings')).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(() => session.closeOverlay()).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(() => session.dismissOverlays()).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
  });
});
