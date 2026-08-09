import { describe, expect, it } from 'vitest';
import { RendererError } from '../../src/api/renderer-errors.js';
import { AsyncGeneration } from '../../src/lifecycle/async-generation.js';

describe('AsyncGeneration', () => {
  it('invalidates old tokens, aborts their signal, and never revives after dispose', () => {
    const generation = new AsyncGeneration();
    const first = generation.token();

    expect(first.current).toBe(true);
    expect(first.signal.aborted).toBe(false);

    const second = generation.advance();
    expect(first.current).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.current).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.id).toBeGreaterThan(first.id);

    generation.dispose();
    expect(second.current).toBe(false);
    expect(second.signal.aborted).toBe(true);
    expect(() => generation.token()).toThrowError(RendererError);
    expect(() => generation.advance()).toThrowError(expect.objectContaining({ code: 'RENDERER_DISPOSED' }));
  });

  it('makes repeated dispose and stale completion checks idempotent', () => {
    const generation = new AsyncGeneration();
    const token = generation.token();
    const seen: string[] = [];
    token.signal.addEventListener('abort', () => seen.push('aborted'));

    generation.dispose();
    generation.dispose();

    expect(seen).toEqual(['aborted']);
    expect(token.current).toBe(false);
  });
});
