import {
  PlayerInputGate,
  PlayerUiSession,
  canAdvance,
  canRollback,
  createPlayerUiSession,
  type CompletePlayerOperationOptions,
  type PlayerBase,
  type PlayerOverlay,
  type PlayerOperation,
  type PlayerUiSessionSnapshot,
  type PointerDecision,
  type PrimaryPointerLike,
} from './player-ui.js';
import {
  PLAYER_SHELL_SLOT_IDS,
  PlayerShellSlotError,
  type PlayerShellOpenRequest,
  type PlayerShellSlotId,
  type PlayerShellSlotContext,
  type PlayerShellSlotRegistry,
  type PlayerShellSlotRegistrySnapshot,
} from './player-shell-slots.js';

export interface PlayerShellCommands {
  open(request: PlayerShellOpenRequest): void;
  close(): void;
  beginOperation(operation: Exclude<PlayerOperation, 'idle'>): void;
  completeOperation(options?: CompletePlayerOperationOptions): void;
  failOperation(error: unknown): void;
  consumePointer(): void;
  reset(base?: PlayerBase): void;
}

export interface PlayerShellQueries {
  snapshot(): PlayerUiSessionSnapshot;
  slots(): PlayerShellSlotRegistrySnapshot;
  canAdvance(): boolean;
  canRollback(): boolean;
}

export interface PlayerShellController {
  readonly commands: PlayerShellCommands;
  readonly queries: PlayerShellQueries;
  decidePointer(pointer: PrimaryPointerLike): PointerDecision;
}

export interface PlayerShellControllerOptions {
  readonly slots: PlayerShellSlotRegistry;
  readonly session?: PlayerUiSession;
  readonly inputGate?: PlayerInputGate;
  readonly onError?: (error: unknown) => void;
}

type Source = PlayerShellOpenRequest['source'];

type ActiveProjection = Readonly<{
  readonly request: PlayerShellOpenRequest;
  readonly context: PlayerShellSlotContext;
}>;

function controllerError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function isPlayerBase(value: unknown): value is PlayerBase {
  return value === 'title' || value === 'game';
}

function isSource(value: unknown): value is Source {
  return value === 'title' || value === 'game' || value === 'system-menu';
}

function assertBaseSource(snapshot: PlayerUiSessionSnapshot, source: Source, slot: PlayerShellSlotId): void {
  if (source === 'system-menu') {
    if (snapshot.overlay !== 'system-menu') {
      throw controllerError('PLAYER_SHELL_SOURCE_INVALID', `${slot} requires system-menu source context`);
    }
    return;
  }
  if (snapshot.base !== source || (slot !== 'title' && snapshot.overlay !== 'none')) {
    throw controllerError('PLAYER_SHELL_SOURCE_INVALID', `${slot} source=${source} does not match current context`);
  }
}

function assertOpenRequest(
  request: PlayerShellOpenRequest,
  snapshot: PlayerUiSessionSnapshot,
): void {
  if (!request || typeof request !== 'object'
    || !(PLAYER_SHELL_SLOT_IDS as readonly string[]).includes((request as { slot?: unknown }).slot as string)) {
    throw controllerError('PLAYER_SHELL_SLOT_UNKNOWN', `unknown slot=${String((request as { slot?: unknown })?.slot)}`);
  }

  const source = (request as { source?: unknown }).source;
  if (!isSource(source)) {
    throw controllerError('PLAYER_SHELL_SOURCE_INVALID', `invalid source=${String(source)}`);
  }

  switch (request.slot) {
    case 'title':
      if (source === 'system-menu' || !isPlayerBase(snapshot.base)) {
        throw controllerError('PLAYER_SHELL_SOURCE_INVALID', 'title source is invalid');
      }
      return;
    case 'system-menu':
      if (source !== 'game' || snapshot.base !== 'game' || snapshot.overlay !== 'none') {
        throw controllerError('PLAYER_SHELL_SOURCE_INVALID', 'system-menu requires the game base');
      }
      return;
    case 'save-load':
      if (request.mode !== 'save' && request.mode !== 'load') {
        throw controllerError('PLAYER_SHELL_SOURCE_INVALID', 'save-load mode is invalid');
      }
      assertBaseSource(snapshot, source, request.slot);
      return;
    case 'settings':
      assertBaseSource(snapshot, source, request.slot);
      return;
    case 'gallery':
      if (source !== 'title' && source !== 'game') {
        throw controllerError('PLAYER_SHELL_SOURCE_INVALID', 'gallery source is invalid');
      }
      assertBaseSource(snapshot, source, request.slot);
      return;
    case 'backlog':
      if (source !== 'game') {
        throw controllerError('PLAYER_SHELL_SOURCE_INVALID', 'backlog requires game source');
      }
      assertBaseSource(snapshot, source, request.slot);
      return;
    default:
      throw controllerError('PLAYER_SHELL_SLOT_UNKNOWN', `unknown slot=${String((request as { slot?: unknown }).slot)}`);
  }
}

function overlaySlot(overlay: PlayerOverlay): PlayerShellSlotId {
  switch (overlay) {
    case 'system-menu':
    case 'save-load':
    case 'settings':
    case 'gallery':
    case 'backlog':
      return overlay;
    case 'none':
      throw controllerError('PLAYER_UI_INVALID_TRANSITION', 'close requires an active player shell overlay');
    default:
      throw controllerError('PLAYER_SHELL_SLOT_UNKNOWN', `unknown overlay=${String(overlay)}`);
  }
}

function commitAndOpen(
  session: PlayerUiSession,
  slots: PlayerShellSlotRegistry,
  request: PlayerShellOpenRequest,
  origin: PlayerUiSessionSnapshot,
): PlayerShellSlotContext {
  const context: PlayerShellSlotContext = {
    source: request.source,
    returnTo: { base: origin.base, overlay: origin.overlay },
  };
  try {
    switch (request.slot) {
      case 'title':
        session.dismissOverlays();
        session.enterTitle();
        break;
      case 'system-menu':
      case 'save-load':
      case 'settings':
      case 'gallery':
      case 'backlog':
        if (request.source === 'system-menu') session.pushOverlay(request.slot);
        else session.openOverlay(request.slot);
        break;
      default:
        throw controllerError(
          'PLAYER_SHELL_SLOT_UNKNOWN',
          `unknown slot=${String((request as { slot?: unknown }).slot)}`,
        );
    }
    slots.open(request, context);
    return context;
  } catch (error) {
    session.restore(origin);
    throw error;
  }
}

export function createPlayerShellController(
  options: PlayerShellControllerOptions,
): PlayerShellController {
  const session = options?.session ?? createPlayerUiSession();
  const inputGate = options?.inputGate ?? new PlayerInputGate();
  const slots = options?.slots;
  if (!slots) throw controllerError('PLAYER_SHELL_INVALID_OPTIONS', 'slots are required');
  let activeProjections: readonly ActiveProjection[] = [];

  const commands: PlayerShellCommands = {
    open(request) {
      const origin = session.snapshot();
      assertOpenRequest(request, origin);
      const previous = activeProjections;
      try {
        const context = commitAndOpen(session, slots, request, origin);
        activeProjections = request.slot === 'title'
          ? []
          : [...activeProjections, { request, context }];
      } catch (error) {
        activeProjections = previous;
        throw error;
      }
    },
    close() {
      const origin = session.snapshot();
      const slot = overlaySlot(origin.overlay);
      const previous = activeProjections;
      const current = previous.at(-1);
      if (!current || current.request.slot !== slot) {
        throw controllerError(
          'PLAYER_UI_INVALID_TRANSITION',
          `close has no active provider request for slot=${slot}`,
        );
      }
      let providerCloseStarted = false;
      try {
        const returned = session.closeOverlay();
        providerCloseStarted = true;
        slots.close(slot);
        const next = previous.slice(0, -1);
        const parent = next.at(-1);
        if (returned.overlay !== 'none') {
          if (!parent) {
            throw controllerError(
              'PLAYER_SHELL_SLOT_FAILED',
              `missing parent provider for returned overlay=${returned.overlay}`,
            );
          }
          slots.open(parent.request, parent.context);
        }
        activeProjections = next;
      } catch (error) {
        const compensationErrors: unknown[] = [];
        if (providerCloseStarted) {
          try {
            slots.open(current.request, current.context);
          } catch (compensationError) {
            compensationErrors.push(compensationError);
          }
        }
        try {
          session.restore(origin);
        } catch (restoreError) {
          compensationErrors.push(restoreError);
        }
        activeProjections = previous;
        if (compensationErrors.length > 0) {
          throw new PlayerShellSlotError(
            'PLAYER_SHELL_SLOT_FAILED',
            'provider close transaction compensation failed',
            new AggregateError([error, ...compensationErrors], 'player shell close transaction failed'),
          );
        }
        throw error;
      }
    },
    beginOperation(operation) {
      session.beginOperation(operation);
    },
    completeOperation(operationOptions) {
      session.completeOperation(operationOptions);
    },
    failOperation(error) {
      session.failOperation();
      if (options.onError) {
        options.onError(error);
        return;
      }
      throw error;
    },
    consumePointer() {
      inputGate.consumeCurrentPointer();
    },
    reset(base = 'title') {
      session.reset(base);
      inputGate.reset();
    },
  };

  const queries: PlayerShellQueries = {
    snapshot: () => session.snapshot(),
    slots: () => slots.snapshot(),
    canAdvance: () => canAdvance(session.snapshot()),
    canRollback: () => canRollback(session.snapshot()),
  };

  return Object.freeze({
    commands: Object.freeze(commands),
    queries: Object.freeze(queries),
    decidePointer: (pointer: PrimaryPointerLike) => inputGate.decidePointer(session.snapshot(), pointer),
  });
}
