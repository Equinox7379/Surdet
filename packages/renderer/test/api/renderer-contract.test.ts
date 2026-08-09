import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ChoiceOptionView,
  GalleryOverlayState,
  RendererCommands,
  RendererError,
  RendererInputAction,
  RendererQueries,
  RendererRuntime,
} from '../../src/index.js';
import { RendererError as RendererErrorClass } from '../../src/index.js';

describe('Renderer v2 public contract', () => {
  it('has stable command and query domains', () => {
    const commandKeys: Array<keyof RendererCommands> = [
      'assets',
      'world',
      'dialogue',
      'menu',
      'gallery',
      'system',
      'loading',
      'preferences',
      'presentation',
    ];
    const queryKeys: Array<keyof RendererQueries> = [
      'world',
      'dialogue',
      'overlay',
      'preferences',
      'presentation',
      'diagnostics',
    ];

    expect(commandKeys).toHaveLength(9);
    expect(queryKeys).toHaveLength(6);
    expectTypeOf<RendererRuntime['dispose']>().returns.toEqualTypeOf<void>();
  });

  it('locks representative command, query, input, and error shapes', () => {
    expectTypeOf<RendererCommands['world']['setBackground']>()
      .toEqualTypeOf<(key: string | null) => void>();
    expectTypeOf<RendererCommands['dialogue']['showChoices']>()
      .toEqualTypeOf<(options: readonly ChoiceOptionView[]) => void>();
    expectTypeOf<RendererQueries['diagnostics']['isDisposed']>()
      .toEqualTypeOf<() => boolean>();
    expectTypeOf<RendererQueries['overlay']['gallery']>()
      .toEqualTypeOf<() => GalleryOverlayState>();
    expectTypeOf<RendererInputAction>().toMatchTypeOf<{ type: string }>();
    expectTypeOf<RendererError['code']>().toBeString();
    expectTypeOf<RendererError['domain']>().toBeString();
  });

  it('preserves renderer error context and cause', () => {
    const cause = new Error('root cause');
    const error = new RendererErrorClass('invalid payload', {
      code: 'INVALID_COMMAND_PAYLOAD',
      domain: 'world',
      command: 'setBackground',
      cause,
    });

    expect(error.code).toBe('INVALID_COMMAND_PAYLOAD');
    expect(error.domain).toBe('world');
    expect(error.command).toBe('setBackground');
    expect(error.cause).toBe(cause);
  });
});
