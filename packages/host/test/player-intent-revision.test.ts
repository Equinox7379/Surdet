import { describe, expect, it } from 'vitest';
import { PlayerInputGate, createPlayerUiSession } from '../src/player-ui.js';

describe('Player UI asynchronous intent revision', () => {
  it('records navigation history even when an overlay is opened then closed', () => {
    const session = createPlayerUiSession({ base: 'game' });
    const initial = session.intentRevision();
    session.openOverlay('settings'); session.closeOverlay();
    expect(session.snapshot()).toMatchObject({ base: 'game', overlay: 'none' });
    expect(session.intentRevision()).toBe(initial + 2);
    session.reset('game');
    expect(session.intentRevision()).toBe(initial + 3);
  });

  it('ignores passive video, redundant interface projections and pointer consumption', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.setVideoActive(false); session.setVideoActive(true); session.setVideoActive(false);
    session.setInterfaceHidden(false); new PlayerInputGate().consumeCurrentPointer();
    expect(session.intentRevision()).toBe(0);
    session.setInterfaceHidden(true); session.setInterfaceHidden(true); session.setInterfaceHidden(false);
    expect(session.intentRevision()).toBe(2);
  });

  it('does not consume an intent on rejected transitions', () => {
    const session = createPlayerUiSession({ base: 'game' });
    session.openOverlay('gallery'); const revision = session.intentRevision();
    expect(() => session.openOverlay('settings')).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(() => session.restore({ ...session.snapshot(), operation: 'loading' })).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(session.intentRevision()).toBe(revision);
  });

  it('publishes revisions before notifying observers, including operation failure and restore', () => {
    const observed: number[] = [];
    const session = createPlayerUiSession({ base: 'game' }, () => observed.push(session.intentRevision()));
    session.openOverlay('save-load'); const origin = session.snapshot();
    session.beginOperation('loading'); session.failOperation();
    expect(session.snapshot()).toBe(origin);
    session.restore(origin); session.beginOperation('loading'); session.completeOperation();
    expect(observed).toEqual([1, 2, 3, 4, 5, 6]);
    expect(session.intentRevision()).toBe(6);
  });
});
