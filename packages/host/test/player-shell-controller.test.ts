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
import { createPlayerShellController } from '../src/player-shell-controller.js';
import { enterPlayerTitleSession } from '../src/player-title-session.js';

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
  it('saving with a retained nested overlay keeps providers and their return stack', () => {
    const { controller, events } = makeHarness({ base: 'game' });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    const before = controller.queries.snapshot();
    controller.commands.beginOperation('saving');
    expect(() => controller.commands.close()).toThrow(/operation=idle/);
    controller.commands.completeOperation({ base: 'game', overlay: 'settings' });
    expect(controller.queries.snapshot()).toEqual(before);
    expect(events.filter(event => event.kind === 'close')).toEqual([]);
    controller.commands.close();
    expect(controller.queries.snapshot().overlay).toBe('system-menu');
    controller.commands.close();
    expect(controller.queries.canAdvance()).toBe(true);
  });
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
    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual([
      'open:gallery',
      'close:gallery',
    ]);
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
    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual([
      'open:gallery',
      'close:gallery',
      'open:gallery',
    ]);
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

  it('supports the public clean title boundary without reopening stale providers', () => {
    const { controller, events } = makeHarness({ base: 'game' });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    const resetSession = vi.fn();
    const openTitle = vi.fn();
    const options = { shell: controller, renderer: { resetSession }, openTitle };

    enterPlayerTitleSession(options);
    enterPlayerTitleSession(options);

    expect(events.map(({ kind, slot }) => `${kind}:${slot}`)).toEqual([
      'open:system-menu',
      'open:settings',
      'close:settings',
      'close:system-menu',
    ]);
    expect(resetSession).toHaveBeenCalledOnce();
    expect(resetSession).toHaveBeenCalledWith({ preserveWorld: false });
    expect(openTitle).toHaveBeenCalledOnce();
  });
});

type PlayerShellInitialState = PlayerUiSessionInitialState;

type ProjectionFailure = {
  readonly slot: PlayerShellSlotId;
  readonly call: number;
  readonly cause: Error;
  readonly afterSideEffect?: boolean;
};

type ProjectionHarnessOptions = {
  readonly initial?: PlayerShellInitialState;
  readonly openFailure?: ProjectionFailure;
  readonly closeFailure?: ProjectionFailure;
};

type ProjectionState = {
  visibleSlot: PlayerShellSlotId | null;
  visibleRequest: PlayerShellOpenRequest | null;
  visibleSlots: Set<PlayerShellSlotId>;
  openCalls: Map<PlayerShellSlotId, number>;
  closeCalls: Map<PlayerShellSlotId, number>;
};

function makeProjectionHarness(options: ProjectionHarnessOptions = {}) {
  const state: ProjectionState = {
    visibleSlot: null,
    visibleRequest: null,
    visibleSlots: new Set(),
    openCalls: new Map(),
    closeCalls: new Map(),
  };
  const providers = Object.fromEntries(PLAYER_SHELL_SLOT_IDS.map((slot) => [slot, {
    id: `projection-${slot}`,
    open(request: PlayerShellOpenRequest, _context: PlayerShellSlotContext) {
      const call = (state.openCalls.get(slot) ?? 0) + 1;
      state.openCalls.set(slot, call);
      if (options.openFailure?.slot === slot
        && options.openFailure.call === call
        && options.openFailure.afterSideEffect) {
        state.visibleSlot = slot;
        state.visibleRequest = request;
        state.visibleSlots.add(slot);
        throw options.openFailure.cause;
      }
      if (options.openFailure?.slot === slot
        && options.openFailure.call === call) {
        throw options.openFailure.cause;
      }
      state.visibleSlot = slot;
      state.visibleRequest = request;
      state.visibleSlots.add(slot);
    },
    close() {
      const call = (state.closeCalls.get(slot) ?? 0) + 1;
      state.closeCalls.set(slot, call);
      if (options.closeFailure?.slot === slot
        && options.closeFailure.call === call
        && options.closeFailure.afterSideEffect) {
        state.visibleSlot = null;
        state.visibleRequest = null;
        state.visibleSlots.delete(slot);
        throw options.closeFailure.cause;
      }
      if (options.closeFailure?.slot === slot
        && options.closeFailure.call === call) {
        throw options.closeFailure.cause;
      }
      if (state.visibleSlot === slot) {
        state.visibleSlot = null;
        state.visibleRequest = null;
      }
      state.visibleSlots.delete(slot);
    },
  }])) as Record<PlayerShellSlotId, PlayerShellSlotProvider>;
  const session = createPlayerUiSession(options.initial ?? { base: 'game' });
  const slots = createPlayerShellSlotRegistry({ defaults: providers });
  const controller = createPlayerShellController({ session, slots });
  return { controller, state };
}

function thrownError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected action to throw');
}

describe('PlayerShellController provider projection atomicity', () => {
  it('keeps the child projection when child close itself fails', () => {
    const cause = new Error('settings close failed');
    const { controller, state } = makeProjectionHarness({
      closeFailure: { slot: 'settings', call: 1, cause },
    });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    const origin = controller.queries.snapshot();

    const error = thrownError(() => controller.commands.close());

    expect(error).toBeInstanceOf(PlayerShellSlotError);
    expect((error as PlayerShellSlotError).cause).toBe(cause);
    expect(controller.queries.snapshot()).toEqual(origin);
    expect(state.visibleSlot).toBe('settings');
  });

  it('compensates a closed child when parent reopen fails and preserves its exact request', () => {
    const cause = new Error('system menu reopen failed');
    const { controller, state } = makeProjectionHarness({
      openFailure: { slot: 'system-menu', call: 2, cause },
    });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'save-load', source: 'system-menu', mode: 'load' });
    const origin = controller.queries.snapshot();

    const error = thrownError(() => controller.commands.close());

    expect(error).toBeInstanceOf(PlayerShellSlotError);
    expect((error as PlayerShellSlotError).cause).toBe(cause);
    expect(controller.queries.snapshot()).toEqual(origin);
    expect(state.visibleSlot).toBe('save-load');
    expect(state.visibleRequest).toMatchObject({ slot: 'save-load', source: 'system-menu', mode: 'load' });

    controller.commands.close();
    expect(controller.queries.snapshot().overlay).toBe('system-menu');
    expect(state.visibleSlot).toBe('system-menu');
    controller.commands.close();
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none', returnStack: [] });
    expect(state.visibleSlot).toBeNull();
  });

  it('compensates when parent open performed a side effect before throwing', () => {
    const cause = new Error('system menu reopen completed then failed');
    const { controller, state } = makeProjectionHarness({
      openFailure: { slot: 'system-menu', call: 2, cause, afterSideEffect: true },
    });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    const origin = controller.queries.snapshot();

    expect(() => controller.commands.close()).toThrow(/PLAYER_SHELL_SLOT_FAILED/);
    expect(controller.queries.snapshot()).toEqual(origin);
    expect(state.visibleSlot).toBe('settings');
  });

  it('keeps title/gallery state consistent on a single-level close failure', () => {
    const cause = new Error('gallery close failed');
    const { controller, state } = makeProjectionHarness({
      initial: { base: 'title' },
      closeFailure: { slot: 'gallery', call: 1, cause },
    });
    controller.commands.open({ slot: 'gallery', source: 'title' });
    const origin = controller.queries.snapshot();

    const error = thrownError(() => controller.commands.close());
    expect(error).toBeInstanceOf(PlayerShellSlotError);
    expect((error as PlayerShellSlotError).cause).toBe(cause);
    expect(controller.queries.snapshot()).toEqual(origin);
    expect(state.visibleSlot).toBe('gallery');
  });

  it('returns through a normal nested close and rejects duplicate close without pollution', () => {
    const { controller, state } = makeProjectionHarness();
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    controller.commands.close();
    expect(controller.queries.snapshot().overlay).toBe('system-menu');
    expect(state.visibleSlot).toBe('system-menu');
    controller.commands.close();
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none', returnStack: [] });
    expect(state.visibleSlot).toBeNull();
    expect(() => controller.commands.close()).toThrow(/PLAYER_UI_INVALID_TRANSITION/);
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none', returnStack: [] });
    expect(state.visibleSlot).toBeNull();
  });

  it('reset closes every real projection before converging the session and starts a fresh stack', () => {
    const { controller, state } = makeProjectionHarness();
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });

    controller.commands.reset('title');

    expect(controller.queries.snapshot()).toMatchObject({
      base: 'title',
      overlay: 'none',
      operation: 'idle',
      returnStack: [],
    });
    expect(state.visibleSlot).toBeNull();
    expect(state.visibleSlots).toEqual(new Set());
    expect(state.closeCalls.get('settings')).toBe(1);
    expect(state.closeCalls.get('system-menu')).toBe(1);

    controller.commands.open({ slot: 'gallery', source: 'title' });
    controller.commands.close();
    expect(state.visibleSlots).toEqual(new Set());

    controller.commands.reset('game');
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    controller.commands.close();
    controller.commands.close();
    controller.commands.reset('game');
    expect(state.visibleSlots).toEqual(new Set());
  });

  it('does not claim reset success when a provider close fails and allows a safe retry', () => {
    const cause = new Error('settings reset close failed');
    const { controller, state } = makeProjectionHarness({
      closeFailure: { slot: 'settings', call: 1, cause },
    });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    const origin = controller.queries.snapshot();

    const error = thrownError(() => controller.commands.reset('title'));

    expect(error).toBeInstanceOf(PlayerShellSlotError);
    expect((error as PlayerShellSlotError).cause).toBe(cause);
    expect(controller.queries.snapshot()).toEqual(origin);
    expect(state.visibleSlot).toBe('settings');
    expect(state.visibleSlots).toEqual(new Set(['system-menu', 'settings']));

    controller.commands.reset('title');
    expect(controller.queries.snapshot()).toMatchObject({ base: 'title', overlay: 'none', returnStack: [] });
    expect(state.visibleSlots).toEqual(new Set());
  });

  it('preserves every cause when reset cleanup and compensation both fail', () => {
    const closeCause = new Error('system menu reset close failed after side effect');
    const compensationCause = new Error('system menu reset compensation failed');
    const { controller, state } = makeProjectionHarness({
      closeFailure: { slot: 'system-menu', call: 1, cause: closeCause, afterSideEffect: true },
      openFailure: { slot: 'system-menu', call: 2, cause: compensationCause },
    });
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    const origin = controller.queries.snapshot();

    const error = thrownError(() => controller.commands.reset('title'));

    expect(error).toBeInstanceOf(PlayerShellSlotError);
    const aggregate = (error as PlayerShellSlotError).cause;
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ cause: closeCause }),
      expect.objectContaining({ cause: compensationCause }),
    ]));
    expect(controller.queries.snapshot()).toEqual(origin);
    expect(state.visibleSlots).toEqual(new Set(['settings']));
  });

  it('closes stale projections before direct title convergence and completeOperation', () => {
    const { controller, state } = makeProjectionHarness();
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    controller.commands.open({ slot: 'title', source: 'game' });

    expect(controller.queries.snapshot()).toMatchObject({ base: 'title', overlay: 'none', returnStack: [] });
    expect(state.visibleSlots).toEqual(new Set(['title']));
    expect(state.closeCalls.get('settings')).toBe(1);
    expect(state.closeCalls.get('system-menu')).toBe(1);

    controller.commands.reset('game');
    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'save-load', source: 'system-menu', mode: 'load' });
    controller.commands.beginOperation('loading');
    controller.commands.completeOperation({ base: 'game', overlay: 'none' });

    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none', operation: 'idle', returnStack: [] });
    expect(state.visibleSlots).toEqual(new Set());
  });
});
