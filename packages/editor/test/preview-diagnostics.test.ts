import { describe, expect, it } from 'vitest';
import { PreviewGeneration, normalizePreviewDiagnostic } from '../src/preview-diagnostics.js';

describe('preview diagnostics', () => {
  it('rejects malformed messages and keeps only typed fields', () => {
    expect(normalizePreviewDiagnostic({ generation: 1, level: 'error', phase: 'runtime', message: 'boom', extra: true })).toEqual({
      generation: 1, level: 'error', phase: 'runtime', message: 'boom',
    });
    expect(normalizePreviewDiagnostic({ generation: 1, level: 'error' })).toBeNull();
  });

  it('marks stale iframe generations', () => {
    const generation = new PreviewGeneration();
    const first = generation.next();
    const second = generation.next();
    expect(generation.isCurrent(first)).toBe(false);
    expect(generation.isCurrent(second)).toBe(true);
  });
});
