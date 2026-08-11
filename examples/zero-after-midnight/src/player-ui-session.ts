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

export interface PlayerUiSessionSnapshot {
  readonly base: PlayerBase;
  readonly overlay: PlayerOverlay;
  readonly operation: PlayerOperation;
  readonly interfaceHidden: boolean;
  readonly videoActive: boolean;
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

function freezeSnapshot(snapshot: PlayerUiSessionSnapshot): PlayerUiSessionSnapshot {
  return Object.freeze(snapshot);
}

function validateSnapshot(snapshot: PlayerUiSessionSnapshot): void {
  if (snapshot.interfaceHidden && (snapshot.base !== 'game' || snapshot.overlay !== 'none')) {
    throw transitionError('interfaceHidden requires base=game and overlay=none');
  }
  if (snapshot.operation !== 'idle' && snapshot.operation !== 'saving' && snapshot.operation !== 'loading' && snapshot.operation !== 'returning-title') {
    throw transitionError(`unknown operation=${String(snapshot.operation)}`);
  }
}

function initialSnapshot(initial: PlayerUiSessionInitialState | undefined): PlayerUiSessionSnapshot {
  const snapshot: PlayerUiSessionSnapshot = {
    base: initial?.base ?? 'title',
    overlay: initial?.overlay ?? 'none',
    operation: initial?.operation ?? 'idle',
    interfaceHidden: initial?.interfaceHidden ?? false,
    videoActive: initial?.videoActive ?? false,
  };
  validateSnapshot(snapshot);
  return freezeSnapshot(snapshot);
}

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
    return this.#commit({ ...this.#snapshot, overlay });
  }

  closeOverlay(): PlayerUiSessionSnapshot {
    this.#requireIdle('close-overlay');
    if (this.#snapshot.overlay === 'none') {
      throw transitionError('close-overlay requires an active overlay');
    }
    return this.#commit({ ...this.#snapshot, overlay: 'none' });
  }

  enterTitle(): PlayerUiSessionSnapshot {
    this.#requireIdle('enter-title');
    if (this.#snapshot.overlay !== 'none') {
      throw transitionError('enter-title requires overlay=none');
    }
    return this.#commit({
      ...this.#snapshot,
      base: 'title',
      interfaceHidden: false,
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
      interfaceHidden: false,
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
    });
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
