import { describe, expect, it, vi } from 'vitest';
import { RendererError } from '../../src/api/renderer-errors.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';

describe('RenderLifecycle', () => {
  it('releases only the requested owner and reports exact counts', () => {
    const lifecycle = new RenderLifecycle();
    const disposed: string[] = [];

    lifecycle.register('dialogue', 'listener', 'choice', () => disposed.push('choice'));
    lifecycle.register('world', 'tween', 'fade', () => disposed.push('fade'));

    expect(lifecycle.snapshot()).toMatchObject({
      disposed: false,
      listeners: 1,
      activeTweens: 1,
      activeAsyncTasks: 0,
      blobUrls: 0,
      tickerCallbacks: 0,
    });

    lifecycle.releaseOwner('dialogue');
    lifecycle.releaseOwner('dialogue');

    expect(disposed).toEqual(['choice']);
    expect(lifecycle.snapshot()).toMatchObject({ listeners: 0, activeTweens: 1 });
  });

  it('replaces a composite key and disposes the old resource exactly once', () => {
    const lifecycle = new RenderLifecycle();
    const first = vi.fn();
    const second = vi.fn();

    lifecycle.register('runtime', 'async', 'asset', first);
    lifecycle.register('runtime', 'async', 'asset', second);
    lifecycle.release('runtime', 'async', 'asset');
    lifecycle.dispose();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(lifecycle.snapshot()).toMatchObject({ disposed: true, activeAsyncTasks: 0 });
  });

  it('removes entries before disposal and attempts every disposer after a failure', () => {
    const lifecycle = new RenderLifecycle();
    const calls: string[] = [];
    lifecycle.register('world', 'display', 'first', () => {
      calls.push('first');
      lifecycle.releaseOwner('world');
      throw new Error('first failed');
    });
    lifecycle.register('world', 'display', 'second', () => calls.push('second'));
    lifecycle.register('dialogue', 'listener', 'third', () => calls.push('third'));

    expect(() => lifecycle.releaseOwner('world')).toThrow(RendererError);
    expect(calls).toEqual(['first', 'second']);
    expect(lifecycle.snapshot()).toMatchObject({ displayObjectsByOwner: { world: 0 }, listeners: 1 });

    expect(() => lifecycle.dispose()).not.toThrow();
    expect(calls).toEqual(['first', 'second', 'third']);
    expect(() => lifecycle.dispose()).not.toThrow();
    expect(lifecycle.snapshot()).toMatchObject({ disposed: true, listeners: 0 });
  });

  it('reports failed resource identity and original cause for release', () => {
    const lifecycle = new RenderLifecycle();
    const cause = new Error('menu thumbnail destroy failed');
    lifecycle.register('menu', 'pool', 'thumbnail:slot-1', () => { throw cause; });

    let thrown: unknown;
    try {
      lifecycle.release('menu', 'pool', 'thumbnail:slot-1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RendererError);
    const rendererError = thrown as RendererError;
    expect(rendererError.code).toBe('COMMAND_COMMIT_FAILED');
    expect(rendererError.command).toBe('release');
    expect(rendererError.cause).toBeInstanceOf(AggregateError);
    expect((rendererError.cause as AggregateError).errors).toEqual([
      expect.objectContaining({
        owner: 'menu',
        kind: 'pool',
        key: 'thumbnail:slot-1',
        cause,
      }),
    ]);
  });

  it('preserves failed resource identities and original causes for multiple disposers', () => {
    const lifecycle = new RenderLifecycle();
    const firstCause = new Error('menu display destroy failed');
    const secondCause = new Error('menu listener detach failed');
    lifecycle.register('menu', 'display', 'menu-root', () => { throw firstCause; });
    lifecycle.register('menu', 'listener', 'menu-pointerdown', () => { throw secondCause; });

    let thrown: unknown;
    try {
      lifecycle.releaseOwner('menu');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RendererError);
    const rendererError = thrown as RendererError;
    expect(rendererError.code).toBe('COMMAND_COMMIT_FAILED');
    expect(rendererError.command).toBe('releaseOwner');
    expect(rendererError.cause).toBeInstanceOf(AggregateError);
    const failures = (rendererError.cause as AggregateError).errors;
    expect(failures).toEqual([
      expect.objectContaining({
        owner: 'menu',
        kind: 'display',
        key: 'menu-root',
        cause: firstCause,
      }),
      expect.objectContaining({
        owner: 'menu',
        kind: 'listener',
        key: 'menu-pointerdown',
        cause: secondCause,
      }),
    ]);
  });

  it('counts pooled objects by owner and key without exposing mutable internals', () => {
    const lifecycle = new RenderLifecycle();
    lifecycle.register('world', 'pool', 'ruby', () => undefined);
    lifecycle.register('world', 'pool', 'ruby-2', () => undefined);
    lifecycle.register('menu', 'pool', 'slot', () => undefined);

    const snapshot = lifecycle.snapshot();
    expect(snapshot.pooledObjects).toEqual({ 'world:ruby': 1, 'world:ruby-2': 1, 'menu:slot': 1 });
    expect(snapshot.displayObjectsByOwner).toEqual({});

    (snapshot.pooledObjects as Record<string, number>).world = 99;
    expect(lifecycle.snapshot().pooledObjects).not.toHaveProperty('world');
  });
});
