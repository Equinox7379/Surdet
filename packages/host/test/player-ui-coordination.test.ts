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
});
