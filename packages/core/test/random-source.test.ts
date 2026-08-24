import { describe, expect, it } from 'vitest';
import { assertValidRandomSeed, createSeededRandomSource } from '../src/runtime/random-source.js';

describe('mulberry32-v1 random source', () => {
  it('matches the fixed seed 0 and seed 1 vectors exactly', () => {
    const seed0 = createSeededRandomSource(0);
    expect([seed0.next(), seed0.next(), seed0.next()]).toEqual([
      0.26642920868471265,
      0.0003297457005828619,
      0.2232720274478197,
    ]);

    const seed1 = createSeededRandomSource(1);
    expect([seed1.next(), seed1.next(), seed1.next()]).toEqual([
      0.6270739405881613,
      0.002735721180215478,
      0.5274470399599522,
    ]);
  });

  it('rejects non-integer and out-of-range seeds', () => {
    for (const value of [-1, 4294967296, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertValidRandomSeed(value)).toThrow();
    }
    expect(() => assertValidRandomSeed(0)).not.toThrow();
    expect(() => assertValidRandomSeed(4294967295)).not.toThrow();
  });
});
