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
  it('only consumes the current event turn, not a later click after keyboard activation', async () => {
    const gate = new PlayerInputGate();
    const session = createPlayerUiSession({ base: 'game' });
    session.setInterfaceHidden(true);
    gate.consumeCurrentPointer();
    expect(gate.decidePointer(session.snapshot(), { button: 0 })).toBe('ignore');
    gate.consumeCurrentPointer();
    await Promise.resolve();
    expect(gate.decidePointer(session.snapshot(), { button: 0 })).toBe('restore-interface');
  });
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

  it.each([
    ['invalid root base', { base: 'corrupt', overlay: 'none' }],
    ['invalid root overlay', { base: 'game', overlay: 'alien' }],
    ['invalid interfaceHidden type', { base: 'game', overlay: 'none', interfaceHidden: 'false' }],
    ['invalid videoActive type', { base: 'game', overlay: 'none', videoActive: 0 }],
  ])('rejects %s in restore with the public transition error', (_label, overrides) => {
    const session = createPlayerUiSession({ base: 'game' });
    const before = session.snapshot();
    const invalid = {
      ...before,
      ...overrides,
    } as unknown as PlayerUiSessionSnapshot;

    expect(() => session.restore(invalid)).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(session.snapshot()).toBe(before);
    expect(session.snapshot()).toEqual(before);
  });

  it.each([
    ['null snapshot', null],
    ['array snapshot', []],
    ['null return frame', { base: 'game', overlay: 'none', returnStack: [null] }],
    ['invalid return frame', { base: 'game', overlay: 'none', returnStack: [{ base: 'corrupt', overlay: 'none' }] }],
  ])('rejects %s without leaking a native TypeError', (_label, value) => {
    const session = createPlayerUiSession({ base: 'game' });
    const before = session.snapshot();
    const invalid = value === null || Array.isArray(value)
      ? value
      : {
        ...before,
        ...value,
      };

    expect(() => session.restore(invalid as unknown as PlayerUiSessionSnapshot))
      .toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(session.snapshot()).toBe(before);
  });

  it('preserves an operation origin when an invalid restore is rejected', () => {
    const session = createPlayerUiSession({ base: 'game' });
    const origin = session.snapshot();
    session.beginOperation('loading');
    const before = session.snapshot();

    const invalid = {
      ...before,
      base: 'corrupt',
      operation: 'idle',
    } as unknown as PlayerUiSessionSnapshot;
    expect(() => session.restore(invalid)).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(session.snapshot()).toBe(before);
    expect(session.failOperation()).toBe(origin);
  });

  it('validates constructor input and every final commit without partial writes', () => {
    expect(() => createPlayerUiSession({ base: 'corrupt' as 'title' })).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(() => createPlayerUiSession({ overlay: 'alien' as PlayerOverlay })).toThrow(/PLAYER_UI_INVALID_TRANSITION/);

    const session = createPlayerUiSession({ base: 'game' });
    session.beginOperation('saving');
    expect(() => session.completeOperation({ overlay: 'alien' as PlayerOverlay }))
      .toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(session.snapshot().operation).toBe('saving');
    expect(session.failOperation().operation).toBe('idle');
  });

  it('restores a valid nested idle snapshot as an independent frozen value', () => {
    const session = createPlayerUiSession({ base: 'title' });
    const input = {
      base: 'game',
      overlay: 'settings',
      operation: 'idle',
      interfaceHidden: false,
      videoActive: false,
      returnStack: [
        { base: 'game', overlay: 'none' },
        { base: 'game', overlay: 'system-menu' },
      ],
    } as const;

    const restored = session.restore(input);
    expect(restored).toEqual(input);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.returnStack)).toBe(true);
    expect(restored.returnStack.every((frame) => Object.isFrozen(frame))).toBe(true);
    expect(restored.returnStack).not.toBe(input.returnStack);
    expect(restored.returnStack[0]).not.toBe(input.returnStack[0]);
  });
});
