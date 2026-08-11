export type PlayerBase = 'title' | 'game';

export type PlayerOverlay =
  | 'none'
  | 'system-menu'
  | 'save-load'
  | 'settings'
  | 'gallery'
  | 'backlog';

export type PlayerOperation =
  | 'idle'
  | 'saving'
  | 'loading'
  | 'returning-title';

export interface PlayerOverlayFrame {
  readonly base: PlayerBase;
  readonly overlay: PlayerOverlay;
}

export interface PlayerUiSessionSnapshot {
  readonly base: PlayerBase;
  readonly overlay: PlayerOverlay;
  readonly operation: PlayerOperation;
  readonly interfaceHidden: boolean;
  readonly videoActive: boolean;
  readonly returnStack: readonly PlayerOverlayFrame[];
}

export interface PlayerUiSessionInitialState {
  readonly base?: PlayerBase;
  readonly overlay?: PlayerOverlay;
  readonly operation?: PlayerOperation;
  readonly interfaceHidden?: boolean;
  readonly videoActive?: boolean;
}

export interface CompletePlayerOperationOptions {
  readonly base?: PlayerBase;
  readonly overlay?: PlayerOverlay;
  readonly interfaceHidden?: boolean;
  readonly videoActive?: boolean;
}

type ActiveOverlay = Exclude<PlayerOverlay, 'none'>;
type BusyOperation = Exclude<PlayerOperation, 'idle'>;

function transitionError(message: string): Error {
  return new Error(`PLAYER_UI_INVALID_TRANSITION: ${message}`);
}

function freezeOverlayFrame(frame: PlayerOverlayFrame): PlayerOverlayFrame {
  return Object.freeze({
    base: frame.base,
    overlay: frame.overlay,
  });
}

function freezeReturnStack(
  returnStack: readonly PlayerOverlayFrame[],
): readonly PlayerOverlayFrame[] {
  return Object.freeze(returnStack.map(freezeOverlayFrame));
}

function freezeSnapshot(snapshot: PlayerUiSessionSnapshot): PlayerUiSessionSnapshot {
  return Object.freeze({
    ...snapshot,
    returnStack: freezeReturnStack(snapshot.returnStack),
  });
}

function validateSnapshot(snapshot: PlayerUiSessionSnapshot): void {
  if (snapshot.interfaceHidden && (snapshot.base !== 'game' || snapshot.overlay !== 'none')) {
    throw transitionError('interfaceHidden requires base=game and overlay=none');
  }
  if (snapshot.operation !== 'idle'
    && snapshot.operation !== 'saving'
    && snapshot.operation !== 'loading'
    && snapshot.operation !== 'returning-title') {
    throw transitionError(`unknown operation=${String(snapshot.operation)}`);
  }
  if (!Array.isArray(snapshot.returnStack)) {
    throw transitionError('returnStack must be an array');
  }
  for (const frame of snapshot.returnStack) {
    if (frame.base !== 'title' && frame.base !== 'game') {
      throw transitionError(`unknown return frame base=${String(frame.base)}`);
    }
    if (frame.overlay !== 'none'
      && frame.overlay !== 'system-menu'
      && frame.overlay !== 'save-load'
      && frame.overlay !== 'settings'
      && frame.overlay !== 'gallery'
      && frame.overlay !== 'backlog') {
      throw transitionError(`unknown return frame overlay=${String(frame.overlay)}`);
    }
  }
}

function initialSnapshot(initial: PlayerUiSessionInitialState | undefined): PlayerUiSessionSnapshot {
  const snapshot: PlayerUiSessionSnapshot = {
    base: initial?.base ?? 'title',
    overlay: initial?.overlay ?? 'none',
    operation: initial?.operation ?? 'idle',
    interfaceHidden: initial?.interfaceHidden ?? false,
    videoActive: initial?.videoActive ?? false,
    returnStack: [],
  };
  validateSnapshot(snapshot);
  return freezeSnapshot(snapshot);
}

/**
 * Shared synchronous player UI state machine.
 *
 * The host owns this coordination state; games only provide rendering and
 * storage adapters.  A busy operation records its exact origin so a failed
 * transaction can restore the complete pre-operation context.
 */
export class PlayerUiSession {
  #snapshot: PlayerUiSessionSnapshot;
  #operationOrigin: PlayerUiSessionSnapshot | null = null;

  constructor(initial?: PlayerUiSessionInitialState) {
    this.#snapshot = initialSnapshot(initial);
  }

  snapshot(): PlayerUiSessionSnapshot {
    return this.#snapshot;
  }

  openOverlay(overlay: ActiveOverlay): PlayerUiSessionSnapshot {
    this.#requireIdle('open-overlay');
    if (this.#snapshot.overlay !== 'none') {
      throw transitionError('open-overlay requires overlay=none');
    }
    if (this.#snapshot.interfaceHidden) {
      throw transitionError('open-overlay requires interfaceHidden=false');
    }
    if (this.#snapshot.returnStack.length !== 0) {
      throw transitionError('open-overlay requires an empty return stack');
    }
    return this.#commit({
      ...this.#snapshot,
      overlay,
      returnStack: [this.#currentFrame()],
    });
  }

  pushOverlay(overlay: ActiveOverlay): PlayerUiSessionSnapshot {
    this.#requireIdle('push-overlay');
    if (this.#snapshot.overlay === 'none') {
      throw transitionError('push-overlay requires an active overlay');
    }
    if (this.#snapshot.interfaceHidden) {
      throw transitionError('push-overlay requires interfaceHidden=false');
    }
    return this.#commit({
      ...this.#snapshot,
      overlay,
      returnStack: [...this.#snapshot.returnStack, this.#currentFrame()],
    });
  }

  closeOverlay(): PlayerUiSessionSnapshot {
    this.#requireIdle('close-overlay');
    if (this.#snapshot.overlay === 'none') {
      throw transitionError('close-overlay requires an active overlay');
    }
    const returnStack = this.#snapshot.returnStack;
    const frame = returnStack.at(-1);
    if (!frame) {
      return this.#commit({ ...this.#snapshot, overlay: 'none', returnStack: [] });
    }
    return this.#commit({
      ...this.#snapshot,
      base: frame.base,
      overlay: frame.overlay,
      returnStack: returnStack.slice(0, -1),
    });
  }

  dismissOverlays(): PlayerUiSessionSnapshot {
    this.#requireIdle('dismiss-overlays');
    return this.#commit({ ...this.#snapshot, overlay: 'none', returnStack: [] });
  }

  enterTitle(): PlayerUiSessionSnapshot {
    this.#requireIdle('enter-title');
    if (this.#snapshot.overlay !== 'none') {
      throw transitionError('enter-title requires overlay=none');
    }
    return this.#commit({
      ...this.#snapshot,
      base: 'title',
      overlay: 'none',
      interfaceHidden: false,
      returnStack: [],
    });
  }

  enterGame(): PlayerUiSessionSnapshot {
    this.#requireIdle('enter-game');
    if (this.#snapshot.overlay !== 'none') {
      throw transitionError('enter-game requires overlay=none');
    }
    return this.#commit({
      ...this.#snapshot,
      base: 'game',
      overlay: 'none',
      interfaceHidden: false,
      returnStack: [],
    });
  }

  beginOperation(operation: BusyOperation): PlayerUiSessionSnapshot {
    if (this.#snapshot.operation !== 'idle') {
      throw transitionError(`begin-operation requires operation=idle, got ${this.#snapshot.operation}`);
    }
    this.#operationOrigin = this.#snapshot;
    return this.#commit({ ...this.#snapshot, operation });
  }

  completeOperation(options: CompletePlayerOperationOptions = {}): PlayerUiSessionSnapshot {
    if (this.#snapshot.operation === 'idle') {
      throw transitionError('complete-operation requires a busy operation');
    }
    this.#operationOrigin = null;
    return this.#commit({
      ...this.#snapshot,
      base: options.base ?? this.#snapshot.base,
      overlay: options.overlay ?? 'none',
      operation: 'idle',
      interfaceHidden: options.interfaceHidden ?? false,
      videoActive: options.videoActive ?? false,
      returnStack: [],
    });
  }

  failOperation(): PlayerUiSessionSnapshot {
    if (this.#snapshot.operation === 'idle') {
      throw transitionError('fail-operation requires a busy operation');
    }
    const origin = this.#operationOrigin;
    this.#operationOrigin = null;
    if (!origin) {
      throw transitionError('fail-operation is missing its origin snapshot');
    }
    this.#snapshot = origin;
    return this.#snapshot;
  }

  setInterfaceHidden(hidden: boolean): PlayerUiSessionSnapshot {
    this.#requireIdle('set-interface-hidden');
    if (hidden && (this.#snapshot.base !== 'game' || this.#snapshot.overlay !== 'none')) {
      throw transitionError('interfaceHidden requires base=game and overlay=none');
    }
    return this.#commit({ ...this.#snapshot, interfaceHidden: hidden });
  }

  toggleInterface(): PlayerUiSessionSnapshot {
    return this.setInterfaceHidden(!this.#snapshot.interfaceHidden);
  }

  setVideoActive(active: boolean): PlayerUiSessionSnapshot {
    return this.#commit({ ...this.#snapshot, videoActive: active });
  }

  reset(base: PlayerBase = 'title'): PlayerUiSessionSnapshot {
    this.#operationOrigin = null;
    return this.#commit({
      base,
      overlay: 'none',
      operation: 'idle',
      interfaceHidden: false,
      videoActive: false,
      returnStack: [],
    });
  }

  #currentFrame(): PlayerOverlayFrame {
    return {
      base: this.#snapshot.base,
      overlay: this.#snapshot.overlay,
    };
  }

  #requireIdle(action: string): void {
    if (this.#snapshot.operation !== 'idle') {
      throw transitionError(`${action} requires operation=idle, got ${this.#snapshot.operation}`);
    }
  }

  #commit(snapshot: PlayerUiSessionSnapshot): PlayerUiSessionSnapshot {
    validateSnapshot(snapshot);
    this.#snapshot = freezeSnapshot(snapshot);
    return this.#snapshot;
  }
}

export function createPlayerUiSession(initial?: PlayerUiSessionInitialState): PlayerUiSession {
  return new PlayerUiSession(initial);
}

export function canAdvance(snapshot: PlayerUiSessionSnapshot): boolean {
  return snapshot.base === 'game'
    && snapshot.overlay === 'none'
    && snapshot.operation === 'idle'
    && !snapshot.interfaceHidden
    && !snapshot.videoActive;
}

export function canRollback(snapshot: PlayerUiSessionSnapshot): boolean {
  return canAdvance(snapshot);
}

export function shouldRestoreInterfaceOnPointer(snapshot: PlayerUiSessionSnapshot): boolean {
  return snapshot.base === 'game'
    && snapshot.overlay === 'none'
    && snapshot.operation === 'idle'
    && snapshot.interfaceHidden;
}

export function shouldShowCommandRail(snapshot: PlayerUiSessionSnapshot): boolean {
  return canAdvance(snapshot);
}

export type PointerDecision = 'advance' | 'ignore' | 'restore-interface';

export interface PrimaryPointerLike {
  readonly button: number;
}

export interface PlayerInputGateSnapshot {
  readonly currentPointerConsumed: boolean;
}

/**
 * Shared synchronous pointer-consumption protocol for game canvases.
 * UI handlers mark the current event before the canvas decides whether the
 * interpreter may advance; exactly one decision consumes the mark.
 */
export class PlayerInputGate {
  #currentPointerConsumed = false;

  snapshot(): PlayerInputGateSnapshot {
    return Object.freeze({ currentPointerConsumed: this.#currentPointerConsumed });
  }

  consumeCurrentPointer(): void {
    this.#currentPointerConsumed = true;
  }

  decidePointer(snapshot: PlayerUiSessionSnapshot, pointer: PrimaryPointerLike): PointerDecision {
    const consumed = this.#currentPointerConsumed;
    this.#currentPointerConsumed = false;

    if (pointer.button !== 0 || consumed) return 'ignore';
    if (shouldRestoreInterfaceOnPointer(snapshot)) return 'restore-interface';
    if (canAdvance(snapshot)) return 'advance';
    return 'ignore';
  }
}
