import { describe, expect, it } from 'vitest';
import { normalizePostProcess } from '../src/post-process.js';

describe('post process settings', () => {
  it('clamps untrusted settings and remains disabled by default', () => {
    expect(normalizePostProcess()).toEqual({ enabled: false, saturation: 1, brightness: 1, contrast: 1 });
    expect(normalizePostProcess({ enabled: true, saturation: 9, brightness: -1, contrast: Number.NaN })).toEqual({
      enabled: true, saturation: 2, brightness: 0, contrast: 1,
    });
  });
});
