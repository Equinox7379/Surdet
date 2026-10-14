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

function restoreProjectionStack(
  slots: PlayerShellSlotRegistry,
  projections: readonly ActiveProjection[],
): void {
  const errors: unknown[] = [];
  for (const projection of projections) {
    try {
      slots.open(projection.request, projection.context);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'player shell projection restore failed');
  }
}

/**
 * Closes a projection stack from the top down.  The caller keeps its active
 * ledger and Session unchanged until this function returns successfully.
 * A provider is reopened when its close throws because the provider may have
 * performed its side effect before reporting the error.
 */
function closeProjectionStack(
  slots: PlayerShellSlotRegistry,
  projections: readonly ActiveProjection[],
  message: string,
): void {
  const closed: ActiveProjection[] = [];
  for (let index = projections.length - 1; index >= 0; index -= 1) {
    const projection = projections[index]!;
    try {
      slots.close(projection.request.slot);
      closed.push(projection);
    } catch (error) {
      const compensationErrors: unknown[] = [];
      try {
        slots.open(projection.request, projection.context);
      } catch (compensationError) {
        compensationErrors.push(compensationError);
      }
      try {
        restoreProjectionStack(slots, [...closed].reverse());
      } catch (compensationError) {
        compensationErrors.push(compensationError);
      }
      if (compensationErrors.length > 0) {
        throw new PlayerShellSlotError(
          'PLAYER_SHELL_SLOT_FAILED',
          message,
          new AggregateError([error, ...compensationErrors], message),
        );
      }
      throw error;
    }
  }
}

function rollbackProjectionMutation(
  slots: PlayerShellSlotRegistry,
  session: PlayerUiSession,
  origin: PlayerUiSessionSnapshot,
  projections: readonly ActiveProjection[],
  restoreProjections: boolean,
  error: unknown,
  message: string,
  failedOpen?: PlayerShellSlotId,
): never {
  const compensationErrors: unknown[] = [];
  if (failedOpen !== undefined) {
    try {
      slots.close(failedOpen);
    } catch (closeError) {
      compensationErrors.push(closeError);
    }
  }
  if (restoreProjections) {
    try {
      restoreProjectionStack(slots, projections);
    } catch (compensationError) {
      compensationErrors.push(compensationError);
    }
  }
  if (session.snapshot() !== origin && origin.operation === 'idle') {
    try {
      session.restore(origin);
    } catch (restoreError) {
      compensationErrors.push(restoreError);
    }
  }
  if (compensationErrors.length > 0) {
    throw new PlayerShellSlotError(
      'PLAYER_SHELL_SLOT_FAILED',
      message,
      new AggregateError([error, ...compensationErrors], message),
    );
  }
  throw error;
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
      if (request.slot === 'title') {
        if (origin.operation !== 'idle') {
          throw controllerError('PLAYER_UI_INVALID_TRANSITION', 'title open requires operation=idle');
        }
        let projectionsClosed = false;
        try {
          closeProjectionStack(slots, previous, 'title projection convergence failed');
          projectionsClosed = true;
          const context = commitAndOpen(session, slots, request, origin);
          activeProjections = [{ request, context }];
        } catch (error) {
          activeProjections = previous;
          rollbackProjectionMutation(
            slots,
            session,
            origin,
            previous,
            projectionsClosed,
            error,
            'title projection convergence compensation failed',
            projectionsClosed && error instanceof PlayerShellSlotError && error.code === 'PLAYER_SHELL_SLOT_FAILED'
              ? request.slot : undefined,
          );
        }
        return;
      }
      try {
        const context = commitAndOpen(session, slots, request, origin);
        activeProjections = [...activeProjections, { request, context }];
      } catch (error) {
        activeProjections = previous;
        const openFailed = error instanceof PlayerShellSlotError && error.code === 'PLAYER_SHELL_SLOT_FAILED';
        rollbackProjectionMutation(slots, session, origin, previous, openFailed, error,
          'player shell open compensation failed', openFailed ? request.slot : undefined);
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
      const returned = session.closeOverlay();
      let providerCloseStarted = false;
      try {
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
      const origin = session.snapshot();
      if (origin.operation === 'idle') {
        session.completeOperation(operationOptions);
        return;
      }
      const previous = activeProjections;
      let projectionsClosed = false;
      try {
        if (operationOptions?.overlay !== undefined && operationOptions.overlay !== 'none') {
          if (operationOptions.overlay !== origin.overlay
            || (operationOptions.base ?? origin.base) !== origin.base
            || previous.at(-1)?.request.slot !== overlaySlot(origin.overlay)) {
            throw controllerError('PLAYER_UI_INVALID_TRANSITION', 'operation cannot retain an unbound overlay');
          }
          session.completeOperation(operationOptions);
          return;
        }
        closeProjectionStack(slots, previous, 'operation completion projection cleanup failed');
        projectionsClosed = true;
        session.completeOperation(operationOptions);
        activeProjections = [];
      } catch (error) {
        activeProjections = previous;
        rollbackProjectionMutation(
          slots,
          session,
          origin,
          previous,
          projectionsClosed,
          error,
          'operation completion projection compensation failed',
        );
      }
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
      const origin = session.snapshot();
      const previous = activeProjections;
      let projectionsClosed = false;
      try {
        closeProjectionStack(slots, previous, 'player shell reset projection cleanup failed');
        projectionsClosed = true;
        session.reset(base);
        inputGate.reset();
        activeProjections = [];
      } catch (error) {
        activeProjections = previous;
        rollbackProjectionMutation(
          slots,
          session,
          origin,
          previous,
          projectionsClosed,
          error,
          'player shell reset projection compensation failed',
        );
      }
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
