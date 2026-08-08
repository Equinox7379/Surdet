import { describe, expect, it } from 'vitest';
import { compareRendererBaseline } from '../../src/diagnostics/renderer-baseline.js';

describe('compareRendererBaseline', () => {
  it('fails timing regressions beyond the configured ratio', () => {
    const result = compareRendererBaseline(
      { coldStartMs: 1000, assetReadyMs: 1000, menuOpenP95Ms: 100, sceneP95Ms: 200 },
      { coldStartMs: 1110, assetReadyMs: 1090, menuOpenP95Ms: 116, sceneP95Ms: 229 },
    );

    expect(result.failures.map((item) => item.metric)).toEqual(['coldStartMs', 'menuOpenP95Ms']);
  });
});
