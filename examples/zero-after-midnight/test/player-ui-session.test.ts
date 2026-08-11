import { describe, expect, it } from 'vitest';
import {
  canAdvance,
  canRollback,
  createPlayerUiSession,
  shouldRestoreInterfaceOnPointer,
  shouldShowCommandRail,
  type PlayerOverlay,
  type PlayerUiSessionSnapshot,
} from '../src/player-ui-session.ts';

const blockingOverlays: readonly Exclude<PlayerOverlay, 'none'>[] = [
  'system-menu',
  'save-load',
  'settings',
  'gallery',
  'backlog',
];

describe('PlayerUiSession', () => {
  it.each(blockingOverlays)('opens and closes %s as one exclusive overlay', (overlay) => {
    const session = createPlayerUiSession({ base: 'game' });

    expect(session.openOverlay(overlay)).toMatchObject({
      base: 'game',
      overlay,
      operation: 'idle',
      interfaceHidden: false,
      videoActive: false,
    });
    expect(session.closeOverlay()).toMatchObject({
      base: 'game',
      overlay: 'none',
      operation: 'idle',
    });
  });

  it('keeps title gallery and game gallery close targets distinct', () => {
    const title = createPlayerUiSession({ base: 'title' });
    title.openOverlay('gallery');
    expect(title.closeOverlay()).toMatchObject({ base: 'title', overlay: 'none' });

    const game = createPlayerUiSession({ base: 'game' });
    game.openOverlay('gallery');
    expect(game.closeOverlay()).toMatchObject({ base: 'game', overlay: 'none' });
  });

  it('rejects a second overlay instead of creating an impossible combination', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.openOverlay('system-menu');

    expect(() => session.openOverlay('gallery')).toThrowError(
      'PLAYER_UI_INVALID_TRANSITION: open-overlay requires overlay=none',
    );
  });

  it('blocks and restores a failed load transaction without changing the origin snapshot', () => {
    const session = createPlayerUiSession({ base: 'title' });
    session.openOverlay('save-load');
    const before = session.snapshot();

    session.beginOperation('loading');
    expect(session.snapshot()).toMatchObject({ overlay: 'save-load', operation: 'loading' });
    expect(canAdvance(session.snapshot())).toBe(false);
    expect(shouldShowCommandRail(session.snapshot())).toBe(false);

    expect(session.failOperation()).toEqual(before);
  });

  it('commits a successful load to game with a closed overlay', () => {
    const session = createPlayerUiSession({ base: 'title' });
    session.openOverlay('save-load');
    session.beginOperation('loading');

    expect(session.completeOperation({ base: 'game', overlay: 'none' })).toEqual({
      base: 'game',
      overlay: 'none',
      operation: 'idle',
      interfaceHidden: false,
      videoActive: false,
    });
  });

  it('derives pure input and command rail queries from one snapshot', () => {
    const visible: PlayerUiSessionSnapshot = createPlayerUiSession({ base: 'game' }).snapshot();
    expect(canAdvance(visible)).toBe(true);
    expect(canRollback(visible)).toBe(true);
    expect(shouldRestoreInterfaceOnPointer(visible)).toBe(false);
    expect(shouldShowCommandRail(visible)).toBe(true);

    const hiddenSession = createPlayerUiSession({ base: 'game' });
    hiddenSession.setInterfaceHidden(true);
    const hidden = hiddenSession.snapshot();
    expect(canAdvance(hidden)).toBe(false);
    expect(canRollback(hidden)).toBe(false);
    expect(shouldRestoreInterfaceOnPointer(hidden)).toBe(true);
    expect(shouldShowCommandRail(hidden)).toBe(false);

    const overlaySession = createPlayerUiSession({ base: 'game' });
    overlaySession.openOverlay('backlog');
    const overlay = overlaySession.snapshot();
    expect(canAdvance(overlay)).toBe(false);
    expect(canRollback(overlay)).toBe(false);
    expect(shouldRestoreInterfaceOnPointer(overlay)).toBe(false);
    expect(shouldShowCommandRail(overlay)).toBe(false);

    const videoSession = createPlayerUiSession({ base: 'game' });
    videoSession.setVideoActive(true);
    const video = videoSession.snapshot();
    expect(canAdvance(video)).toBe(false);
    expect(canRollback(video)).toBe(false);
    expect(shouldRestoreInterfaceOnPointer(video)).toBe(false);
    expect(shouldShowCommandRail(video)).toBe(false);
  });

  it('allows hidden interface only in game with no overlay', () => {
    const title = createPlayerUiSession({ base: 'title' });
    expect(() => title.setInterfaceHidden(true)).toThrowError(
      'PLAYER_UI_INVALID_TRANSITION: interfaceHidden requires base=game and overlay=none',
    );

    const game = createPlayerUiSession({ base: 'game' });
    game.openOverlay('settings');
    expect(() => game.setInterfaceHidden(true)).toThrowError(
      'PLAYER_UI_INVALID_TRANSITION: interfaceHidden requires base=game and overlay=none',
    );
  });

  it('tracks video activity and reset clears every transient state', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.setVideoActive(true);
    expect(session.snapshot().videoActive).toBe(true);
    session.setVideoActive(false);
    session.openOverlay('gallery');
    session.closeOverlay();
    session.setInterfaceHidden(true);

    expect(session.reset('title')).toEqual({
      base: 'title',
      overlay: 'none',
      operation: 'idle',
      interfaceHidden: false,
      videoActive: false,
    });
  });

  it('allows runtime video completion to clear the flag during a busy load', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.setVideoActive(true);
    session.beginOperation('loading');

    expect(session.setVideoActive(false)).toMatchObject({
      operation: 'loading',
      videoActive: false,
    });
  });

  it('supports H-equivalent toggling and immutable snapshots', () => {
    const session = createPlayerUiSession({ base: 'game' });
    const first = session.snapshot();
    expect(Object.isFrozen(first)).toBe(true);
    expect(session.toggleInterface()).toMatchObject({ interfaceHidden: true });
    expect(session.toggleInterface()).toMatchObject({ interfaceHidden: false });
    expect(first.interfaceHidden).toBe(false);
  });
});
