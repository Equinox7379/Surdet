import { describe, expect, it } from 'vitest';
import {
  RENDERER_BASELINE_MIN_SAMPLES,
  RENDERER_BASELINE_SCHEMA_VERSION,
  compareRendererBaseline,
  rendererMetricSummaryValue,
  summarizeRendererMetric,
  validateRendererBaseline,
} from '../../src/diagnostics/renderer-baseline.js';
import {
  RENDERER_BASELINE_V3_SCHEMA_VERSION,
  RENDERER_V3_MIN_INTERACTION_SAMPLES,
  buildRendererV3Run,
  compareRendererBaselineV3,
  summarizeRendererMetricV3,
  validateRendererBaselineV3,
} from '../../src/diagnostics/renderer-baseline-v3.js';

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

const v3Environment = {
  node: 'v24.15.0',
  npm: '11.12.1',
  os: 'win32 10.0.26220',
  platform: 'win32',
  arch: 'x64',
  cpu: 'test-cpu',
  electron: '43.2.0',
  playwright: '1.62.1',
  buildMode: 'electron-dev-shell-starter',
};

function v3Order(pairCount: number) {
  return Array.from({ length: pairCount }, (_, index) => {
    const first = index % 2 === 0 ? 'baseline' : 'current';
    const second = first === 'baseline' ? 'current' : 'baseline';
    return [
      { pair: index + 1, role: first as 'baseline' | 'current' },
      { pair: index + 1, role: second as 'baseline' | 'current' },
    ];
  }).flat();
}

function v3Run(sourceSha: string, values: {
  cold?: number;
  asset?: number;
  menu?: number;
  scene?: number;
} = {}) {
  const pairCount = RENDERER_V3_MIN_INTERACTION_SAMPLES;
  return buildRendererV3Run(sourceSha, {
    coldStartMs: Array(pairCount).fill(values.cold ?? 100),
    assetReadyMs: Array(pairCount).fill(values.asset ?? 100),
    menuOpenP95Ms: Array(pairCount).fill(values.menu ?? 100),
    sceneP95Ms: Array(pairCount).fill(values.scene ?? 100),
  });
}

describe('renderer baseline v3 paired statistics', () => {
  it('uses raw samples and an interpolated p95 with at least twenty interaction samples', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);
    const metric = summarizeRendererMetricV3('menuOpenP95Ms', samples);

    expect(RENDERER_BASELINE_V3_SCHEMA_VERSION).toBe(3);
    expect(metric.samples).toEqual(samples);
    expect(metric.sortedSamples).toEqual(samples);
    expect(metric.median).toBe(10.5);
    expect(metric.p95).toBeCloseTo(19.05, 10);
    expect(metric.p95).not.toBe(20);
    expect(() => summarizeRendererMetricV3('sceneP95Ms', samples.slice(0, 19))).toThrow(/至少需要 20 个样本/);
  });

  it('rejects invalid source SHA, environment mismatch, order mismatch, and missing samples', () => {
    expect(() => buildRendererV3Run('not-a-sha', {
      coldStartMs: [1, 2, 3, 4, 5],
      assetReadyMs: [1, 2, 3, 4, 5],
      menuOpenP95Ms: Array(20).fill(1),
      sceneP95Ms: Array(20).fill(1),
    })).toThrow(/40 位 SHA/);

    const baseline = v3Run('a'.repeat(40));
    const current = v3Run('b'.repeat(40));
    const order = v3Order(20);
    const common = {
      baselineCommit: 'a'.repeat(40),
      currentCommit: 'b'.repeat(40),
      pairCount: 20,
      warmupOrder: ['baseline', 'current'] as const,
      executionOrder: order,
      baselineEnvironment: v3Environment,
      currentEnvironment: v3Environment,
      baseline,
      current,
    };

    expect(() => compareRendererBaselineV3({
      ...common,
      executionOrder: order.slice(0, -1),
    })).toThrow(/executionOrder/);
    expect(() => compareRendererBaselineV3({
      ...common,
      currentEnvironment: { ...v3Environment, node: 'v25.0.0' },
    })).toThrow(/环境不一致/);
    expect(() => buildRendererV3Run('b'.repeat(40), {
      coldStartMs: Array(5).fill(1),
      assetReadyMs: Array(5).fill(1),
      menuOpenP95Ms: Array(19).fill(1),
      sceneP95Ms: Array(20).fill(1),
    })).toThrow(/至少需要 20 个样本/);
  });

  it('uses paired ratios, keeps thresholds unchanged, and validates the serialized candidate', () => {
    const baseline = v3Run('a'.repeat(40));
    const current = v3Run('b'.repeat(40), { cold: 110, asset: 110, menu: 115, scene: 115 });
    const candidate = compareRendererBaselineV3({
      baselineCommit: 'a'.repeat(40),
      currentCommit: 'b'.repeat(40),
      pairCount: 20,
      warmupOrder: ['baseline', 'current'],
      executionOrder: v3Order(20),
      baselineEnvironment: v3Environment,
      currentEnvironment: v3Environment,
      baseline,
      current,
    });

    expect(candidate.comparison.failures).toEqual([]);
    expect(candidate.comparison.metrics.coldStartMs.ratio).toBe(1.1);
    expect(candidate.comparison.metrics.menuOpenP95Ms.ratio).toBe(1.15);
    expect(candidate.comparison.metrics.sceneP95Ms.limit).toBe(1.15);
    expect(() => validateRendererBaselineV3(candidate)).not.toThrow();

    const failed = compareRendererBaselineV3({
      baselineCommit: 'a'.repeat(40),
      currentCommit: 'b'.repeat(40),
      pairCount: 20,
      warmupOrder: ['baseline', 'current'],
      executionOrder: v3Order(20),
      baselineEnvironment: v3Environment,
      currentEnvironment: v3Environment,
      baseline,
      current: v3Run('b'.repeat(40), { scene: 116 }),
    });
    expect(failed.comparison.failures.map((item) => item.metric)).toEqual(['sceneP95Ms']);
  });
});
