import { describe, expect, it } from 'vitest';
import { RenderPerformanceMonitor } from '../src/performance.js';
import { RenderQualityController, getRenderQualitySettings } from '../src/quality.js';
import { ResourceLifecycle } from '../src/resource-lifecycle.js';
import { normalizePresentationPreferences, presentationDuration } from '../src/presentation.js';

describe('renderer runtime diagnostics', () => {
  it('records a bounded rolling performance window and budget status', () => {
    const monitor = new RenderPerformanceMonitor({ updateBudgetMs: 4, maxSlowFrames: 1, sampleWindowSize: 2 });
    monitor.record(16, 2);
    monitor.record(16, 5);
    monitor.record(16, 6);
    const snapshot = monitor.snapshot();
    expect(snapshot.frames).toBe(2);
    expect(snapshot.slowFrames).toBe(2);
    expect(snapshot.withinBudget).toBe(false);
    expect(snapshot.maxUpdateMs).toBe(6);
  });

  it('quality settings are deterministic and notify changes', () => {
    expect(getRenderQualitySettings('low').postProcess).toBe(false);
    const controller = new RenderQualityController('high');
    const seen: string[] = [];
    const off = controller.onChange((quality) => seen.push(quality));
    controller.setQuality('low');
    controller.setQuality('low');
    off();
    controller.setQuality('balanced');
    expect(seen).toEqual(['low']);
  });

  it('resource replacement and clear are idempotent', () => {
    const calls: string[] = [];
    const registry = new ResourceLifecycle();
    registry.register('a', { dispose: () => calls.push('first') });
    registry.register('a', { dispose: () => calls.push('replaced') });
    registry.clear();
    registry.clear();
    expect(calls).toEqual(['first', 'replaced']);
  });

  it('reduced motion collapses transition duration without disabling final state', () => {
    const preferences = normalizePresentationPreferences({ reducedMotion: true });
    expect(preferences.transitionScale).toBe(0);
    expect(presentationDuration(600, preferences)).toBe(1);
  });
});
