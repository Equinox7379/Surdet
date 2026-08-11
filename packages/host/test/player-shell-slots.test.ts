import { describe, expect, it } from 'vitest';
import {
  PLAYER_SHELL_SLOT_IDS,
  createPlayerShellSlotRegistry,
  type PlayerShellOpenRequest,
  type PlayerShellSlotContext,
  type PlayerShellSlotId,
  type PlayerShellSlotProvider,
} from '../src/player-shell-slots.js';

function provider(id: string, overrides: Partial<PlayerShellSlotProvider> = {}): PlayerShellSlotProvider {
  return {
    id,
    open() {},
    close() {},
    ...overrides,
  };
}

function defaults(): Record<PlayerShellSlotId, PlayerShellSlotProvider> {
  return Object.fromEntries(PLAYER_SHELL_SLOT_IDS.map((id) => [id, provider(`${id}-default`)])) as Record<
    PlayerShellSlotId,
    PlayerShellSlotProvider
  >;
}

const settingsRequest: PlayerShellOpenRequest = { slot: 'settings', source: 'game' };
const settingsContext: PlayerShellSlotContext = {
  source: 'game',
  returnTo: { base: 'game', overlay: 'system-menu' },
};

describe('fixed player shell slot registry', () => {
  it('requires all six fixed defaults and exposes a frozen ordered binding snapshot', () => {
    const registry = createPlayerShellSlotRegistry({ defaults: defaults() });
    const snapshot = registry.snapshot();

    expect(PLAYER_SHELL_SLOT_IDS).toEqual([
      'title',
      'system-menu',
      'save-load',
      'settings',
      'gallery',
      'backlog',
    ]);
    expect(snapshot.bindings.map((binding) => binding.slot)).toEqual([...PLAYER_SHELL_SLOT_IDS]);
    expect(snapshot.bindings.map((binding) => binding.providerId)).toEqual(
      PLAYER_SHELL_SLOT_IDS.map((id) => `${id}-default`),
    );
    expect(snapshot.bindings.every((binding) => !('provider' in binding))).toBe(true);
    expect(snapshot.bindings.every((binding) => !('open' in binding))).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.bindings)).toBe(true);
    expect(snapshot.bindings.every((binding) => Object.isFrozen(binding))).toBe(true);
    expect(() => {
      (snapshot.bindings as Array<unknown>).push({});
    }).toThrow();
  });

  it('rejects missing defaults and unknown override IDs', () => {
    const incomplete = defaults() as Partial<Record<PlayerShellSlotId, PlayerShellSlotProvider>>;
    delete incomplete.settings;
    expect(() => createPlayerShellSlotRegistry({
      defaults: incomplete as Record<PlayerShellSlotId, PlayerShellSlotProvider>,
    })).toThrow(/PLAYER_SHELL_SLOT_DEFAULTS_INVALID/);

    expect(() => createPlayerShellSlotRegistry({
      defaults: defaults(),
      overrides: { unknown: provider('unknown') } as never,
    })).toThrow(/PLAYER_SHELL_SLOT_UNKNOWN/);
  });

  it('allows an override only for its fixed slot and marks only that binding overridden', () => {
    const replacement = provider('settings-override');
    const registry = createPlayerShellSlotRegistry({
      defaults: defaults(),
      overrides: { settings: replacement },
    });

    expect(registry.snapshot().bindings).toEqual([
      { slot: 'title', providerId: 'title-default', overridden: false },
      { slot: 'system-menu', providerId: 'system-menu-default', overridden: false },
      { slot: 'save-load', providerId: 'save-load-default', overridden: false },
      { slot: 'settings', providerId: 'settings-override', overridden: true },
      { slot: 'gallery', providerId: 'gallery-default', overridden: false },
      { slot: 'backlog', providerId: 'backlog-default', overridden: false },
    ]);
  });

  it('calls open and close exactly once with the provider as this', () => {
    const calls: Array<{ kind: string; self: unknown; request?: PlayerShellOpenRequest; context?: PlayerShellSlotContext }> = [];
    let settings!: PlayerShellSlotProvider;
    settings = {
      id: 'settings-spy',
      open(request, context) {
        calls.push({ kind: 'open', self: this, request, context });
      },
      close() {
        calls.push({ kind: 'close', self: this });
      },
    };
    const registry = createPlayerShellSlotRegistry({
      defaults: { ...defaults(), settings },
    });

    registry.open(settingsRequest, settingsContext);
    registry.close('settings');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ kind: 'open', self: settings, request: settingsRequest, context: settingsContext });
    expect(calls[1]).toMatchObject({ kind: 'close', self: settings });
  });

  it('rejects unknown open IDs and preserves a provider failure cause', () => {
    const cause = new Error('provider exploded');
    const failing = provider('settings-failing', {
      open() {
        throw cause;
      },
    });
    const registry = createPlayerShellSlotRegistry({
      defaults: { ...defaults(), settings: failing },
    });

    expect(() => registry.open({ slot: 'unknown', source: 'game' } as never, settingsContext))
      .toThrow(/PLAYER_SHELL_SLOT_UNKNOWN/);

    let error: unknown;
    try {
      registry.open(settingsRequest, settingsContext);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'PLAYER_SHELL_SLOT_FAILED', cause });
    expect(error).toHaveProperty('message', expect.stringContaining('PLAYER_SHELL_SLOT_FAILED'));
  });
});
