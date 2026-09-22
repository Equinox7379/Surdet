import type { Interpreter } from '@surdet/core';
import type { RendererRuntime } from '@surdet/renderer';

export interface InterpreterPresentationConnection {
  disconnect(): void;
  readonly connected: boolean;
}

export function connectInterpreterPresentation(options: {
  interpreter: Interpreter;
  renderer: Pick<RendererRuntime, 'commands' | 'queries'>;
}): InterpreterPresentationConnection {
  let connected = true;
  const ensureConnected = (): void => {
    if (!connected) throw new Error('Interpreter Presentation connection is disconnected');
  };

  options.interpreter.setPresentationHooks({
    snapshot: (context) => {
      ensureConnected();
      return options.renderer.queries.presentation.snapshot(context);
    },
    validate: (payload) => {
      ensureConnected();
      options.renderer.commands.presentation.validate(payload);
    },
    restore: (payload) => {
      ensureConnected();
      return options.renderer.commands.presentation.restore(payload);
    },
  });

  return {
    get connected(): boolean {
      return connected;
    },
    disconnect(): void {
      if (!connected) return;
      connected = false;
      options.interpreter.setPresentationHooks(null);
    },
  };
}
