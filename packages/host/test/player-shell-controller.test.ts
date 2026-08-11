import { describe, expect, it } from 'vitest';
import {
  PLAYER_SHELL_SLOT_IDS,
  createPlayerShellSlotRegistry,
  type PlayerShellOpenRequest,
  type PlayerShellSlotContext,
  type PlayerShellSlotId,
  type PlayerShellSlotProvider,
} from '../src/player-shell-slots.js';
import { createPlayerUiSession, type PlayerUiSessionInitialState } from '../src/player-ui.js';
import { createPlayerShellController } from '../src/player-shell-controller.js';

type Event = {
  readonly kind: 'open' | 'close';
  readonly slot: string;
  readonly self: unknown;
};

function makeProvider(
  id: string,
  slot: PlayerShellSlotId,
  events: Event[],
  behavior: { readonly openError?: unknown; readonly closeError?: unknown } = {},
): PlayerShellSlotProvider {
  return {
    id,
    open(_request: PlayerShellOpenRequest, _context: PlayerShellSlotContext) {
      events.push({ kind: 'open', slot, self: this });
      if (behavior.openError !== undefined) throw behavior.openError;
    },
    close() {
      events.push({ kind: 'close', slot, self: this });
      if (behavior.closeError !== undefined) throw behavior.closeError;
    },
  };
}

function makeHarness(
  initial?: PlayerShellInitialState,
  behavior: Partial<Record<PlayerShellSlotId, { readonly openError?: unknown; readonly closeError?: unknown }>> = {},
  onError?: (error: unknown) => void,
) {
  const events: Event[] = [];
  const defaults = Object.fromEntries(PLAYER_SHELL_SLOT_IDS.map((slot) => [
    slot,
    makeProvider(`${slot}-provider`, slot, events, behavior[slot]),
  ])) as Record<PlayerShellSlotId, PlayerShellSlotProvider>;
  const session = createPlayerUiSession(initial);
  const slots = createPlayerShellSlotRegistry({ defaults });
  const controller = createPlayerShellController({ session, slots, onError });
  return { controller, events, session };
}

describe('PlayerShellController', () => {
  it('coordinates title/gallery and closes gallery back to title', () => {
    const { controller, events } = makeHarness({ base: 'title' });

    controller.commands.open({ slot: 'gallery', source: 'title' });
    expect(controller.queries.snapshot()).toMatchObject({
      base: 'title',
      overlay: 'gallery',
      returnStack: [{ base: 'title', overlay: 'none' }],
    });
    controller.commands.close();

    expect(controller.queries.snapshot()).toMatchObject({
      base: 'title',
      overlay: 'none',
      returnStack: [],
    });
    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual(['open:gallery', 'close:gallery']);
  });

  it('coordinates game system-menu/settings with two level return', () => {
    const { controller } = makeHarness({ base: 'game' });

    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    expect(controller.queries.snapshot()).toMatchObject({
      base: 'game',
      overlay: 'settings',
      returnStack: [
        { base: 'game', overlay: 'none' },
        { base: 'game', overlay: 'system-menu' },
      ],
    });

    controller.commands.close();
    expect(controller.queries.snapshot().overlay).toBe('system-menu');
    controller.commands.close();
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none', returnStack: [] });
  });

  it('reprojects the returned parent slot after closing a nested overlay', () => {
    const { controller, events } = makeHarness({ base: 'game' });

    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    controller.commands.close();

    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'system-menu' });
    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual([
      'open:system-menu',
      'open:settings',
      'close:settings',
      'open:system-menu',
    ]);
  });

  it('rejects an invalid source before calling the provider', () => {
    const { controller, events } = makeHarness({ base: 'game' });
    const before = controller.queries.snapshot();

    expect(() => controller.commands.open({ slot: 'backlog', source: 'title' } as never))
      .toThrow(/PLAYER_SHELL_SOURCE_INVALID/);
    expect(controller.queries.snapshot()).toEqual(before);
    expect(events).toEqual([]);
  });

  it('rolls back the session when a provider open fails', () => {
    const cause = new Error('settings open failed');
    const { controller, events } = makeHarness(
      { base: 'game' },
      { settings: { openError: cause } },
    );
    const before = controller.queries.snapshot();

    expect(() => controller.commands.open({ slot: 'settings', source: 'game' }))
      .toThrow(/PLAYER_SHELL_SLOT_FAILED/);
    expect(controller.queries.snapshot()).toEqual(before);
    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual(['open:settings']);
  });

  it('rolls back the session when a provider close fails', () => {
    const cause = new Error('gallery close failed');
    const { controller, events } = makeHarness(
      { base: 'title' },
      { gallery: { closeError: cause } },
    );
    controller.commands.open({ slot: 'gallery', source: 'title' });
    const before = controller.queries.snapshot();

    expect(() => controller.commands.close()).toThrow(/PLAYER_SHELL_SLOT_FAILED/);
    expect(controller.queries.snapshot()).toEqual(before);
    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual(['open:gallery', 'close:gallery']);
  });

  it('restores a save/load origin and reports a failed operation once', () => {
    const errors: unknown[] = [];
    const { controller } = makeHarness({ base: 'game' }, {}, (error) => errors.push(error));
    controller.commands.open({ slot: 'save-load', source: 'game', mode: 'save' });
    const origin = controller.queries.snapshot();
    controller.commands.beginOperation('saving');
    const failure = new Error('disk full');

    controller.commands.failOperation(failure);

    expect(controller.queries.snapshot()).toBe(origin);
    expect(errors).toEqual([failure]);
  });

  it('restores before rethrowing when no operation error boundary exists', () => {
    const { controller } = makeHarness({ base: 'game' });
    controller.commands.open({ slot: 'save-load', source: 'game', mode: 'load' });
    const origin = controller.queries.snapshot();
    controller.commands.beginOperation('loading');
    const failure = new Error('corrupt save');

    expect(() => controller.commands.failOperation(failure)).toThrow(failure);
    expect(controller.queries.snapshot()).toBe(origin);
  });

  it('consumes one pointer and exposes safe pure queries', () => {
    const { controller } = makeHarness({ base: 'game' });
    controller.commands.consumePointer();
    expect(controller.decidePointer({ button: 0 })).toBe('ignore');
    expect(controller.decidePointer({ button: 0 })).toBe('advance');
    expect(controller.queries.canAdvance()).toBe(true);
    expect(controller.queries.canRollback()).toBe(true);

    const snapshot = controller.queries.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.returnStack)).toBe(true);
    expect(controller.queries.slots().bindings.every((binding) => !('provider' in binding))).toBe(true);
  });
});

type PlayerShellInitialState = PlayerUiSessionInitialState;
