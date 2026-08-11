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

  it('records read-only resource identity and release path diagnostics', () => {
    const lifecycle = new RenderLifecycle();
    lifecycle.register('dialogue', 'listener', 'hmr-pointer', () => undefined);

    const active = lifecycle.diagnostics();
    expect(active.active).toHaveLength(1);
    expect(active.active[0]).toMatchObject({
      owner: 'dialogue',
      kind: 'listener',
      key: 'hmr-pointer',
      active: true,
    });
    expect(active.active[0]?.source.length).toBeGreaterThan(0);
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.active)).toBe(true);

    lifecycle.release('dialogue', 'listener', 'hmr-pointer');
    const afterRelease = lifecycle.diagnostics();
    expect(afterRelease.active).toHaveLength(0);
    expect(afterRelease.events.at(-1)).toMatchObject({
      owner: 'dialogue',
      kind: 'listener',
      key: 'hmr-pointer',
      action: 'dispose',
      path: 'release',
      outcome: 'success',
    });
    expect(Object.isFrozen(afterRelease.events)).toBe(true);
  });

  it('bounds event history while retaining the newest event and complete active identity', () => {
    const lifecycle = new RenderLifecycle();
    const activeDisposer = vi.fn();
    lifecycle.register('runtime', 'listener', 'active', activeDisposer);

    for (let index = 0; index < 2_048; index += 1) {
      const key = `churn-${index}`;
      lifecycle.register('runtime', 'ticker', key, () => undefined);
      lifecycle.release('runtime', 'ticker', key);
    }

    const diagnostics = lifecycle.diagnostics();
    expect(diagnostics.events.length).toBe(1_024);
    expect(diagnostics.events.at(-1)).toMatchObject({
      owner: 'runtime',
      kind: 'ticker',
      key: 'churn-2047',
      action: 'dispose',
      path: 'release',
      outcome: 'success',
    });
    expect(diagnostics.events.some((event) => event.key === 'active')).toBe(false);
    expect(diagnostics.active).toEqual([
      expect.objectContaining({
        owner: 'runtime',
        kind: 'listener',
        key: 'active',
        active: true,
      }),
    ]);

    const before = JSON.stringify(diagnostics);
    expect(JSON.stringify(lifecycle.diagnostics())).toBe(before);
    expect(activeDisposer).not.toHaveBeenCalled();
  });

  it('records both sides of replacement and retains all lifecycle paths and failure causes', () => {
    const lifecycle = new RenderLifecycle();
    const firstCause = new Error('replacement disposer failed');

    lifecycle.register('runtime', 'async', 'replace-me', () => undefined);
    lifecycle.register('runtime', 'async', 'replace-me', () => undefined);
    lifecycle.forget('dialogue', 'listener', 'missing');
    lifecycle.register('dialogue', 'listener', 'forgotten', () => undefined);
    lifecycle.forget('dialogue', 'listener', 'forgotten');
    lifecycle.register('menu', 'listener', 'release-me', () => undefined);
    lifecycle.release('menu', 'listener', 'release-me');
    lifecycle.register('gallery', 'listener', 'owner-release', () => undefined);
    lifecycle.releaseOwner('gallery');
    lifecycle.register('system', 'listener', 'dispose-me', () => undefined);
    lifecycle.register('loading', 'listener', 'failure', () => { throw firstCause; });

    expect(() => lifecycle.release('loading', 'listener', 'failure')).toThrow(RendererError);
    lifecycle.dispose();

    const events = lifecycle.diagnostics().events;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: 'runtime',
        kind: 'async',
        key: 'replace-me',
        action: 'dispose',
        path: 'replace',
        outcome: 'success',
      }),
      expect.objectContaining({
        owner: 'runtime',
        kind: 'async',
        key: 'replace-me',
        action: 'register',
        path: 'replace',
        outcome: 'success',
      }),
      expect.objectContaining({ action: 'forget', path: 'forget', outcome: 'success', key: 'forgotten' }),
      expect.objectContaining({ action: 'dispose', path: 'release', outcome: 'success', key: 'release-me' }),
      expect.objectContaining({ action: 'dispose', path: 'releaseOwner', outcome: 'success', key: 'owner-release' }),
      expect.objectContaining({ action: 'dispose', path: 'dispose', outcome: 'success', key: 'dispose-me' }),
      expect.objectContaining({
        action: 'dispose',
        path: 'release',
        outcome: 'failure',
        key: 'failure',
        cause: firstCause.message,
      }),
    ]));
  });
});
