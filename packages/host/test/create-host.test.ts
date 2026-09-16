import { describe, expect, it, vi } from 'vitest';
import { createDefaultHost } from '../src/create-host.js';
import type { DefaultHostOptions, HostSystemAdapter } from '../src/types.js';
import { RollbackBuffer } from '@surdet/renderer';

function makeOptions(adapters: readonly HostSystemAdapter[] = []): DefaultHostOptions & { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> } {
  const pause = vi.fn();
  const resume = vi.fn();
  return {
    interpreter: { pauseHost: pause, resumeHost: resume } as never,
    renderer: {} as never,
    stage: {} as never,
    adapters,
    pause,
    resume,
  };
}

describe('createDefaultHost', () => {
  it('finishes adapter and host reset before resuming the interpreter', async () => {
    const calls: string[] = [];
    const options = makeOptions([{ id: 'battle', open: () => {}, reset: () => { calls.push('adapter'); } }]);
    options.resume.mockImplementation(() => { calls.push('resume'); });
    const host = createDefaultHost({ ...options, onStateReset: () => { calls.push('state'); } });
    await host.routeSystem('battle', {});
    host.reset();
    expect(calls).toEqual(['adapter', 'state', 'resume']);
  });
  it('routes optional adapters and pauses before opening', async () => {
    const calls: string[] = [];
    const options = makeOptions([{
      id: 'battle',
      open: vi.fn(async (_payload, context) => { calls.push('open'); context.resume(); }),
    }]);
    options.pause.mockImplementation(() => calls.push('pause'));
    const host = createDefaultHost(options);
    expect(await host.routeSystem('battle', { seed: 1 })).toBe(true);
    expect(calls).toEqual(['pause', 'open']);
    expect(options.resume).toHaveBeenCalledOnce();
  });

  it('returns false for unknown systems and rejects duplicate IDs', async () => {
    const options = makeOptions();
    const host = createDefaultHost(options);
    expect(await host.routeSystem('missing', {})).toBe(false);
    expect(() => createDefaultHost(makeOptions([
      { id: 'shop', open: () => undefined },
      { id: 'shop', open: () => undefined },
    ]))).toThrow(/重复/);
  });

  it('resumes exactly once and recovers from async adapter failure', async () => {
    const error = new Error('adapter failed');
    const onError = vi.fn();
    const options = makeOptions([{
      id: 'map',
      open: vi.fn(async () => { throw error; }),
    }]);
    const host = createDefaultHost({ ...options, onError });
    expect(await host.routeSystem('map', {})).toBe(false);
    expect(options.resume).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('resets active adapters and is idempotent on dispose', async () => {
    const options = makeOptions([{
      id: 'battle',
      open: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    }]);
    const onStateReset = vi.fn();
    const host = createDefaultHost({ ...options, onStateReset });
    expect(await host.routeSystem('battle', {})).toBe(true);
    host.reset();
    expect(options.adapters![0]!.reset).toHaveBeenCalledOnce();
    expect(onStateReset).toHaveBeenCalledOnce();
    host.dispose();
    host.dispose();
    expect(options.adapters![0]!.dispose).toHaveBeenCalledOnce();
    expect(options.resume).toHaveBeenCalledOnce();
  });

  it('cannot roll back across a completed system interaction', async () => {
    const rollback = new RollbackBuffer<{ id: string }>(4);
    rollback.push({ snapshot: { id: 'before-system' }, presentation: null, audio: { bgm: null, ambience: null } });
    let sideEffectCount = 0;
    const phases: string[] = [];
    const options = makeOptions([{
      id: 'test-system',
      open: (_payload, context) => {
        sideEffectCount += 1;
        context.resume();
      },
    }]);
    const host = createDefaultHost({
      ...options,
      onSystemBoundary: (phase: string) => {
        phases.push(phase);
        rollback.clear();
      },
    });

    expect(await host.routeSystem('test-system', { source: 'test' })).toBe(true);
    expect(phases).toEqual(['enter', 'complete']);
    expect(sideEffectCount).toBe(1);
    expect(rollback.pop()).toBeNull();
  });

  it('closes the rollback boundary when a system adapter fails', async () => {
    const rollback = new RollbackBuffer<{ id: string }>(4);
    rollback.push({ snapshot: { id: 'before-failure' }, presentation: null, audio: { bgm: null, ambience: null } });
    const phases: string[] = [];
    const error = new Error('system failed');
    const options = makeOptions([{
      id: 'failing-system',
      open: () => { throw error; },
    }]);
    const host = createDefaultHost({
      ...options,
      onSystemBoundary: (phase: string) => {
        phases.push(phase);
        rollback.clear();
      },
      onError: vi.fn(),
    });

    expect(await host.routeSystem('failing-system', {})).toBe(false);
    expect(phases).toEqual(['enter', 'fail']);
    expect(rollback.pop()).toBeNull();
    expect(options.resume).toHaveBeenCalledOnce();
  });

  it('closes the rollback boundary on reset and dispose', async () => {
    const phases: string[] = [];
    const options = makeOptions([{
      id: 'long-system',
      open: vi.fn(),
    }]);
    const host = createDefaultHost({
      ...options,
      onSystemBoundary: (phase: string) => phases.push(phase),
    });

    expect(await host.routeSystem('long-system', {})).toBe(true);
    host.reset();
    expect(await host.routeSystem('long-system', {})).toBe(true);
    host.dispose();
    expect(phases).toEqual(['enter', 'reset', 'enter', 'dispose']);
  });
});
