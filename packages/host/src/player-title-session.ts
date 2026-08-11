import type { RendererRuntime } from '@surdet/renderer';
import type { PlayerShellController } from './player-shell-controller.js';

export interface EnterPlayerTitleSessionOptions {
  readonly shell: PlayerShellController;
  readonly renderer: Pick<RendererRuntime, 'resetSession'>;
  readonly openTitle: () => void;
}

const completedTitleSessions = new WeakSet<object>();

function isCleanTitleSession(shell: PlayerShellController): boolean {
  const snapshot = shell.queries.snapshot();
  return snapshot.base === 'title'
    && snapshot.overlay === 'none'
    && snapshot.operation === 'idle'
    && snapshot.returnStack.length === 0;
}

/**
 * Converges the player shell and renderer to a clean title session before
 * projecting the title view. Errors deliberately propagate unchanged so a
 * caller cannot present a title projection for a partially cleaned session.
 */
export function enterPlayerTitleSession(options: EnterPlayerTitleSessionOptions): void {
  if (completedTitleSessions.has(options.shell) && isCleanTitleSession(options.shell)) return;

  options.shell.commands.reset('title');
  options.renderer.resetSession({ preserveWorld: false });
  options.openTitle();
  completedTitleSessions.add(options.shell);
}
