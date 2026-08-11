import type {
  PlayerBase,
  PlayerOverlay,
  PlayerOverlayFrame,
} from './player-ui.js';

export const PLAYER_SHELL_SLOT_IDS = Object.freeze([
  'title',
  'system-menu',
  'save-load',
  'settings',
  'gallery',
  'backlog',
] as const);

export type PlayerShellSlotId = typeof PLAYER_SHELL_SLOT_IDS[number];
export type PlayerShellSource = 'title' | 'game' | 'system-menu';

export type PlayerShellOpenRequest =
  | { readonly slot: 'title'; readonly source: 'title' | 'game' }
  | { readonly slot: 'system-menu'; readonly source: 'game' }
  | { readonly slot: 'save-load'; readonly source: PlayerShellSource; readonly mode: 'save' | 'load' }
  | { readonly slot: 'settings'; readonly source: PlayerShellSource }
  | { readonly slot: 'gallery'; readonly source: 'title' | 'game' }
  | { readonly slot: 'backlog'; readonly source: 'game' };

export interface PlayerShellSlotContext {
  readonly source: PlayerShellSource;
  readonly returnTo: PlayerOverlayFrame;
}

export interface PlayerShellSlotProvider {
  readonly id: string;
  open(request: PlayerShellOpenRequest, context: PlayerShellSlotContext): void;
  close(): void;
}

export interface PlayerShellSlotBindingSnapshot {
  readonly slot: PlayerShellSlotId;
  readonly providerId: string;
  readonly overridden: boolean;
}

export interface PlayerShellSlotRegistrySnapshot {
  readonly bindings: readonly PlayerShellSlotBindingSnapshot[];
}

export interface PlayerShellSlotRegistry {
  open(request: PlayerShellOpenRequest, context: PlayerShellSlotContext): void;
  close(slot: PlayerShellSlotId): void;
  snapshot(): PlayerShellSlotRegistrySnapshot;
}

export type PlayerShellSlotErrorCode =
  | 'PLAYER_SHELL_SLOT_DEFAULTS_INVALID'
  | 'PLAYER_SHELL_SLOT_UNKNOWN'
  | 'PLAYER_SHELL_SLOT_FAILED';

export class PlayerShellSlotError extends Error {
  readonly code: PlayerShellSlotErrorCode;
  override readonly cause: unknown;

  constructor(code: PlayerShellSlotErrorCode, message: string, cause?: unknown) {
    super(`${code}: ${message}`);
    this.name = 'PlayerShellSlotError';
    this.code = code;
    this.cause = cause;
  }
}

function isSlotId(value: unknown): value is PlayerShellSlotId {
  return typeof value === 'string'
    && (PLAYER_SHELL_SLOT_IDS as readonly string[]).includes(value);
}

function unknownSlot(value: unknown): never {
  throw new PlayerShellSlotError('PLAYER_SHELL_SLOT_UNKNOWN', `unknown slot=${String(value)}`);
}

function assertProvider(slot: PlayerShellSlotId, value: unknown): asserts value is PlayerShellSlotProvider {
  if (!value || typeof value !== 'object') {
    throw new PlayerShellSlotError('PLAYER_SHELL_SLOT_DEFAULTS_INVALID', `missing provider for slot=${slot}`);
  }
  const candidate = value as Partial<PlayerShellSlotProvider>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0
    || typeof candidate.open !== 'function'
    || typeof candidate.close !== 'function') {
    throw new PlayerShellSlotError('PLAYER_SHELL_SLOT_DEFAULTS_INVALID', `invalid provider for slot=${slot}`);
  }
}

function freezeSnapshot(
  providers: Readonly<Record<PlayerShellSlotId, PlayerShellSlotProvider>>,
  overridden: ReadonlySet<PlayerShellSlotId>,
): PlayerShellSlotRegistrySnapshot {
  const bindings = PLAYER_SHELL_SLOT_IDS.map((slot) => Object.freeze({
    slot,
    providerId: providers[slot].id,
    overridden: overridden.has(slot),
  }));
  return Object.freeze({ bindings: Object.freeze(bindings) });
}

export function createPlayerShellSlotRegistry(options: {
  readonly defaults: Readonly<Record<PlayerShellSlotId, PlayerShellSlotProvider>>;
  readonly overrides?: Readonly<Partial<Record<PlayerShellSlotId, PlayerShellSlotProvider>>>;
}): PlayerShellSlotRegistry {
  const defaults = options?.defaults;
  if (!defaults || typeof defaults !== 'object') {
    throw new PlayerShellSlotError('PLAYER_SHELL_SLOT_DEFAULTS_INVALID', 'defaults must be an object');
  }

  const providers = {} as Record<PlayerShellSlotId, PlayerShellSlotProvider>;
  for (const slot of PLAYER_SHELL_SLOT_IDS) {
    if (!Object.prototype.hasOwnProperty.call(defaults, slot)) {
      throw new PlayerShellSlotError('PLAYER_SHELL_SLOT_DEFAULTS_INVALID', `missing default slot=${slot}`);
    }
    assertProvider(slot, defaults[slot]);
    providers[slot] = defaults[slot];
  }

  const overrides = options.overrides;
  const overridden = new Set<PlayerShellSlotId>();
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== 'object') {
      throw new PlayerShellSlotError('PLAYER_SHELL_SLOT_UNKNOWN', 'overrides must be an object');
    }
    for (const key of Object.keys(overrides)) {
      if (!isSlotId(key)) unknownSlot(key);
      const slot = key;
      assertProvider(slot, overrides[slot]);
      providers[slot] = overrides[slot];
      overridden.add(slot);
    }
  }

  const providerFor = (value: unknown): PlayerShellSlotProvider => {
    if (!isSlotId(value)) unknownSlot(value);
    return providers[value];
  };

  return {
    open(request, context) {
      const provider = providerFor(request?.slot);
      try {
        provider.open.call(provider, request, context);
      } catch (cause) {
        throw new PlayerShellSlotError(
          'PLAYER_SHELL_SLOT_FAILED',
          `provider=${provider.id} open failed`,
          cause,
        );
      }
    },
    close(slot) {
      const provider = providerFor(slot);
      try {
        provider.close.call(provider);
      } catch (cause) {
        throw new PlayerShellSlotError(
          'PLAYER_SHELL_SLOT_FAILED',
          `provider=${provider.id} close failed`,
          cause,
        );
      }
    },
    snapshot() {
      return freezeSnapshot(providers, overridden);
    },
  };
}

export type { PlayerBase, PlayerOverlay };
