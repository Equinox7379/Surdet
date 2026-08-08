import { describe, expect, it } from 'vitest';
import {
  RENDERER_BASELINE_MIN_SAMPLES,
  RENDERER_BASELINE_SCHEMA_VERSION,
  compareRendererBaseline,
  rendererMetricSummaryValue,
  summarizeRendererMetric,
  validateRendererBaseline,
} from '../../src/diagnostics/renderer-baseline.js';

const samples = [9, 1, 5, 3, 7];

describe('renderer baseline schema and statistics', () => {
  it('retains raw samples, requires five samples, and selects median or p95 by metric', () => {
    expect(RENDERER_BASELINE_MIN_SAMPLES).toBe(5);
    const cold = summarizeRendererMetric('coldStartMs', samples);
    const menu = summarizeRendererMetric('menuOpenP95Ms', samples);

    expect(cold.samples).toEqual([1, 3, 5, 7, 9]);
    expect(cold.median).toBe(5);
    expect(cold.p95).toBe(9);
    expect(cold.summaryStatistic).toBe('median');
    expect(rendererMetricSummaryValue('coldStartMs', cold)).toBe(5);
    expect(menu.summaryStatistic).toBe('p95');
    expect(rendererMetricSummaryValue('menuOpenP95Ms', menu)).toBe(9);
    expect(() => summarizeRendererMetric('assetReadyMs', samples.slice(0, 4))).toThrow(/至少需要 5 个样本/);
  });

  it('validates schema version, metric summaries, and optional source equivalence', () => {
    const metrics = {
      coldStartMs: summarizeRendererMetric('coldStartMs', samples),
      assetReadyMs: summarizeRendererMetric('assetReadyMs', samples),
      menuOpenP95Ms: summarizeRendererMetric('menuOpenP95Ms', samples),
      sceneP95Ms: summarizeRendererMetric('sceneP95Ms', samples),
    };
    const baseline = {
      schemaVersion: RENDERER_BASELINE_SCHEMA_VERSION,
      sourceSha: 'a'.repeat(40),
      coldStartMs: 5,
      assetReadyMs: 5,
      menuOpenP95Ms: 9,
      sceneP95Ms: 9,
      metrics,
    };

    expect(() => validateRendererBaseline(baseline)).not.toThrow();
    expect(() => validateRendererBaseline({
      ...baseline,
      schemaVersion: 1,
    })).toThrow(/schemaVersion/);
    expect(() => validateRendererBaseline({
      ...baseline,
      sourceEquivalentTo: 'b'.repeat(39),
    })).toThrow(/40 位/);
    expect(() => validateRendererBaseline({
      ...baseline,
      metrics: {
        ...metrics,
        coldStartMs: { ...metrics.coldStartMs, samples: [1, 2, 3, 4] },
      },
    })).toThrow(/至少需要 5 个样本/);
  });
});

describe('compareRendererBaseline', () => {
  it('fails timing regressions beyond the configured ratio', () => {
    const result = compareRendererBaseline(
      { coldStartMs: 1000, assetReadyMs: 1000, menuOpenP95Ms: 100, sceneP95Ms: 200 },
      { coldStartMs: 1110, assetReadyMs: 1090, menuOpenP95Ms: 116, sceneP95Ms: 229 },
    );

    expect(result.failures.map((item) => item.metric)).toEqual(['coldStartMs', 'menuOpenP95Ms']);
  });
});
