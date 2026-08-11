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
  type PlayerShellOpenRequest,
  type PlayerShellSlotId,
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
): void {
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
    slots.open(request, {
      source: request.source,
      returnTo: { base: origin.base, overlay: origin.overlay },
    });
  } catch (error) {
    session.restore(origin);
    throw error;
  }
}

function returnedOverlayRequest(
  snapshot: PlayerUiSessionSnapshot,
): PlayerShellOpenRequest | null {
  switch (snapshot.overlay) {
    case 'system-menu':
      return { slot: 'system-menu', source: 'game' };
    case 'settings':
      return {
        slot: 'settings',
        source: snapshot.returnStack.at(-1)?.overlay === 'system-menu'
          ? 'system-menu'
          : snapshot.base,
      };
    case 'gallery':
      return { slot: 'gallery', source: snapshot.base };
    case 'backlog':
      return { slot: 'backlog', source: 'game' };
    case 'save-load':
      // The PlayerUiSession frame intentionally does not carry save/load
      // mode. Save/load completes through the operation transaction path;
      // there is no supported nested save/load return projection to reopen.
      return null;
    case 'none':
      return null;
    default:
      return null;
  }
}

function reopenReturnedProjection(
  slots: PlayerShellSlotRegistry,
  snapshot: PlayerUiSessionSnapshot,
): void {
  const request = returnedOverlayRequest(snapshot);
  if (!request) return;
  slots.open(request, {
    source: request.source,
    returnTo: snapshot.returnStack.at(-1) ?? { base: snapshot.base, overlay: 'none' },
  });
}

export function createPlayerShellController(
  options: PlayerShellControllerOptions,
): PlayerShellController {
  const session = options?.session ?? createPlayerUiSession();
  const inputGate = options?.inputGate ?? new PlayerInputGate();
  const slots = options?.slots;
  if (!slots) throw controllerError('PLAYER_SHELL_INVALID_OPTIONS', 'slots are required');

  const commands: PlayerShellCommands = {
    open(request) {
      const origin = session.snapshot();
      assertOpenRequest(request, origin);
      commitAndOpen(session, slots, request, origin);
    },
    close() {
      const origin = session.snapshot();
      const slot = overlaySlot(origin.overlay);
      try {
        const returned = session.closeOverlay();
        slots.close(slot);
        reopenReturnedProjection(slots, returned);
      } catch (error) {
        session.restore(origin);
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
