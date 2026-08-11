import {
  canAdvance,
  shouldRestoreInterfaceOnPointer,
  type PlayerUiSessionSnapshot,
} from './player-ui-session.js';

export type PointerDecision = 'advance' | 'ignore' | 'restore-interface';

export interface PrimaryPointerLike {
  readonly button: number;
}

/**
 * Synchronous pointer-consumption protocol for the game canvas.
 *
 * UI handlers mark the current event before the canvas decides whether the
 * interpreter may advance. The mark is consumed by exactly one decision and
 * cannot leak into a later pointer event.
 */
export class PlayerInputGate {
  #currentPointerConsumed = false;

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
