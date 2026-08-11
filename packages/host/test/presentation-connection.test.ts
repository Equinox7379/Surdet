import { describe, expect, it, vi } from 'vitest';
import type { Interpreter } from '@surdet/core';
import type { RendererRuntime } from '@surdet/renderer';
import { connectInterpreterPresentation } from '../src/presentation-connection.js';

describe('Interpreter Presentation connection', () => {
  it('connects public Renderer presentation query/commands and disconnects idempotently', () => {
    let hooks: {
      snapshot: () => unknown;
      validate?: (payload: unknown) => void;
      restore: (payload: unknown) => void;
    } | null = null;
    const setPresentationHooks = vi.fn((next: typeof hooks) => { hooks = next; });
    const snapshot = vi.fn(() => ({ version: 1, stage: { backgroundKey: 'night' } }));
    const validate = vi.fn();
    const restore = vi.fn();
    const renderer = {
      queries: { presentation: { snapshot } },
      commands: { presentation: { validate, restore } },
    } as unknown as Pick<RendererRuntime, 'commands' | 'queries'>;
    const connection = connectInterpreterPresentation({
      interpreter: { setPresentationHooks } as unknown as Interpreter,
      renderer,
    });

    expect(connection.connected).toBe(true);
    expect(setPresentationHooks).toHaveBeenCalledTimes(1);
    expect(hooks).not.toBeNull();
    const connectedHooks = hooks!;
    expect(connectedHooks.snapshot()).toEqual({ version: 1, stage: { backgroundKey: 'night' } });
    connectedHooks.validate?.({ version: 1 });
    connectedHooks.restore({ version: 1 });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith({ version: 1 });
    expect(restore).toHaveBeenCalledWith({ version: 1 });

    const rendererCause = new Error('RendererError: presentation validate failed');
    validate.mockImplementationOnce(() => { throw rendererCause; });
    expect(() => connectedHooks.validate?.({ version: 1 })).toThrow(rendererCause);

    connection.disconnect();
    connection.disconnect();
    expect(connection.connected).toBe(false);
    expect(setPresentationHooks).toHaveBeenLastCalledWith(null);
    expect(setPresentationHooks).toHaveBeenCalledTimes(2);
    expect(() => connectedHooks.restore({ version: 1 })).toThrow('disconnected');
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
