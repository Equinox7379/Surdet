import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorMatrixFilter, Container } from 'pixi.js';
import { StoryFilter } from '../src/story-filter.js';
afterEach(() => vi.unstubAllGlobals());
describe('StoryFilter', () => {
  it('restores the sampled blend and finishes using only the remaining duration', () => {
    const filter = new StoryFilter(new Container(), 1280, 720);
    filter.set('grayscale', 1000); filter.update(400);
    const saved = filter.snapshot()!; expect(saved.values.grayscale).toBe(.4);
    filter.set('sepia', 0); filter.restore(StoryFilter.prepare(saved));
    expect(filter.snapshot()).toEqual(saved);
    filter.update(300); expect(filter.snapshot()!.values.grayscale).toBeCloseTo(.7);
    filter.update(300); expect(filter.snapshot()).toEqual({ values: { blur: 0, grayscale: 1, sepia: 0, vignette: 0 } });
    filter.set('off', 400); filter.update(200); expect(filter.snapshot()!.values.grayscale).toBe(.5);
    filter.settle(); expect(filter.snapshot()).toBeUndefined(); filter.destroy();
  });
  it('retains meaningful grayscale and sepia in low quality and releases owned filters', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const filter = new StoryFilter(new Container(), 1280, 720);
    filter.set('grayscale', 0); const gray = filter.project(true)[0] as ColorMatrixFilter;
    expect(gray.matrix[0]).toBeCloseTo(gray.matrix[5]!); expect(gray.matrix[1]).toBeCloseTo(gray.matrix[6]!);
    filter.set('sepia', 0); const sepia = filter.project(true)[0] as ColorMatrixFilter;
    const neutral = new ColorMatrixFilter(), identity = [...neutral.matrix]; neutral.destroy();
    expect(sepia.matrix).not.toEqual(identity);
    filter.destroy(); expect(gray.resources).toBeNull(); expect(sepia.resources).toBeNull();
  });
  it('rejects malformed values and motion before changing the current state', () => {
    const filter = new StoryFilter(new Container(), 1280, 720); filter.set('sepia', 0); const before = filter.snapshot();
    for (const raw of [null, [], { values: { blur: 2, grayscale: 0, sepia: 0, vignette: 0 } }, { ...before, motion: { target: before!.values, duration: 1, remain: 2 } }]) {
      expect(() => StoryFilter.prepare(raw)).toThrow(); expect(filter.snapshot()).toEqual(before);
    }
    filter.destroy();
  });
});
