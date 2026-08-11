import { describe, expect, it, vi } from 'vitest';
import {
  PLAYER_SHELL_SLOT_IDS,
  PlayerShellSlotError,
  createPlayerShellSlotRegistry,
  type PlayerShellOpenRequest,
  type PlayerShellSlotContext,
  type PlayerShellSlotId,
  type PlayerShellSlotProvider,
} from '../src/player-shell-slots.js';
import { createPlayerUiSession, type PlayerUiSessionInitialState } from '../src/player-ui.js';
import { createPlayerShellController, type PlayerShellController } from '../src/player-shell-controller.js';
import { enterPlayerTitleSession } from '../src/player-title-session.js';

type Harness = {
  readonly shell: PlayerShellController;
  readonly closes: PlayerShellSlotId[];
};

function makeHarness(
  initial: PlayerUiSessionInitialState = { base: 'game' },
  closeFailure?: { readonly slot: PlayerShellSlotId; readonly cause: unknown },
): Harness {
  const closes: PlayerShellSlotId[] = [];
  const providers = Object.fromEntries(PLAYER_SHELL_SLOT_IDS.map((slot) => [slot, {
    id: `title-session-${slot}`,
    open(_request: PlayerShellOpenRequest, _context: PlayerShellSlotContext) {},
    close() {
      closes.push(slot);
      if (closeFailure?.slot === slot) throw closeFailure.cause;
    },
  } satisfies PlayerShellSlotProvider])) as Record<PlayerShellSlotId, PlayerShellSlotProvider>;
  const slots = createPlayerShellSlotRegistry({ defaults: providers });
  const shell = createPlayerShellController({
    slots,
    session: createPlayerUiSession(initial),
  });
  return { shell, closes };
}

describe('enterPlayerTitleSession', () => {
  it('closes active providers, clears the world, then opens title in order', () => {
    const { shell, closes } = makeHarness();
    shell.commands.open({ slot: 'system-menu', source: 'game' });
    shell.commands.open({ slot: 'settings', source: 'system-menu' });
    const resetSession = vi.fn();
    const events: string[] = [];

    enterPlayerTitleSession({
      shell,
      renderer: {
        resetSession(options) {
          events.push(`reset:${String(options?.preserveWorld)}`);
          resetSession(options);
        },
      },
      openTitle: () => events.push('open-title'),
    });

    expect(closes).toEqual(['settings', 'system-menu']);
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(resetSession).toHaveBeenCalledWith({ preserveWorld: false });
    expect(events).toEqual(['reset:false', 'open-title']);
    expect(shell.queries.snapshot()).toMatchObject({ base: 'title', overlay: 'none' });
  });

  it('closes a title gallery provider exactly once', () => {
    const { shell, closes } = makeHarness({ base: 'title' });
    shell.commands.open({ slot: 'gallery', source: 'title' });
    const resetSession = vi.fn();
    const openTitle = vi.fn();

    enterPlayerTitleSession({ shell, renderer: { resetSession }, openTitle });

    expect(closes).toHaveLength(1);
    expect(openTitle).toHaveBeenCalledOnce();
  });

  it('closes a game save-load provider exactly once', () => {
    const { shell, closes } = makeHarness();
    shell.commands.open({ slot: 'save-load', source: 'game', mode: 'load' });
    const resetSession = vi.fn();
    const openTitle = vi.fn();

    enterPlayerTitleSession({ shell, renderer: { resetSession }, openTitle });

    expect(closes).toHaveLength(1);
    expect(openTitle).toHaveBeenCalledOnce();
  });

  it('is idempotent after a successful transition', () => {
    const { shell, closes } = makeHarness();
    shell.commands.open({ slot: 'gallery', source: 'game' });
    const resetSession = vi.fn();
    const openTitle = vi.fn();
    const options = { shell, renderer: { resetSession }, openTitle };

    enterPlayerTitleSession(options);
    enterPlayerTitleSession(options);

    expect(closes).toEqual(['gallery']);
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(openTitle).toHaveBeenCalledTimes(1);
  });

  it('does not open a fake title when shell reset fails', () => {
    const cause = new Error('provider close failed');
    const { shell } = makeHarness(
      { base: 'game' },
      { slot: 'gallery', cause },
    );
    shell.commands.open({ slot: 'gallery', source: 'game' });
    const openTitle = vi.fn();

    let thrown: unknown;
    try {
      enterPlayerTitleSession({ shell, renderer: { resetSession: vi.fn() }, openTitle });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PlayerShellSlotError);
    expect((thrown as PlayerShellSlotError).cause).toBe(cause);
    expect(openTitle).not.toHaveBeenCalled();
  });

  it('does not open a fake title when renderer reset fails', () => {
    const { shell } = makeHarness();
    const cause = new Error('world reset failed');
    const resetSession = vi.fn(() => { throw cause; });
    const openTitle = vi.fn();

    expect(() => enterPlayerTitleSession({ shell, renderer: { resetSession }, openTitle }))
      .toThrow(cause);
    expect(openTitle).not.toHaveBeenCalled();
  });

  it('preserves an openTitle failure and permits a later retry', () => {
    const { shell } = makeHarness();
    const cause = new Error('title projection failed');
    const resetSession = vi.fn();
    const openTitle = vi.fn<() => void>(() => { throw cause; });

    expect(() => enterPlayerTitleSession({ shell, renderer: { resetSession }, openTitle }))
      .toThrow(cause);
    expect(resetSession).toHaveBeenCalledTimes(1);

    openTitle.mockImplementation(() => undefined);
    enterPlayerTitleSession({ shell, renderer: { resetSession }, openTitle });

    expect(resetSession).toHaveBeenCalledTimes(2);
    expect(openTitle).toHaveBeenCalledTimes(2);
  });
});
