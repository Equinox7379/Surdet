import { describe, expect, it } from 'vitest';
import { parsePortraitVisual, portraitVisualPaths, samplePortraitVisual } from '../src/portrait-visual.js';

const image = (name: string, extension = 'png') => `content/assets/portrait/${name}.${extension}`;
const frame = (name: string, durationMs = 100) => ({ image: image(name), durationMs });
const sequence = (frames = [frame('first'), frame('second')], loop = false) => ({
  version: 1,
  kind: 'sequence',
  frames,
  loop,
});
const layer = (id = 'body') => ({
  id,
  images: { base: image(`${id}-base`), alternate: image(`${id}-alternate`) },
  default: 'base',
});
const layered = (layers: unknown[] = [layer()]) => ({ version: 1, kind: 'layered', layers });

describe('parsePortraitVisual', () => {
  it('parses each format into a detached data copy without mutating the input', () => {
    const input = {
      version: 1,
      kind: 'layered',
      layers: [{
        ...layer(),
        idle: { frames: [{ variant: 'alternate', durationMs: 25 }], loop: true },
        speaking: { frames: [{ variant: 'base', durationMs: 40 }], loop: false },
      }],
    };
    const original = JSON.stringify(input);
    const parsed = parsePortraitVisual(input);

    expect(parsed).not.toBe(input);
    expect(parsed.kind).toBe('layered');
    if (parsed.kind === 'layered') {
      expect(parsed.layers).not.toBe(input.layers);
      expect(parsed.layers[0]!.images).not.toBe(input.layers[0]!.images);
      expect(parsed.layers[0]).toEqual(input.layers[0]);
      parsed.layers[0]!.images.base = image('detached');
      expect(input.layers[0]!.images.base).toBe(image('body-base'));
    }
    expect(JSON.stringify(input)).toBe(original);
    expect(parsePortraitVisual(sequence())).toEqual(sequence());
  });

  it('accepts configured count and duration maxima', () => {
    const maxFrames = Array.from({ length: 256 }, (_, index) => frame(`frame-${index}`, 1));
    expect(parsePortraitVisual(sequence(maxFrames, true))).toMatchObject({ frames: { length: 256 } });

    const maxImages = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`v${index}`, image(`v${index}`)]));
    const maxLayers = Array.from({ length: 16 }, (_, index) => ({ id: `layer-${index}`, images: maxImages, default: 'v0' }));
    expect(parsePortraitVisual(layered(maxLayers))).toMatchObject({ layers: { length: 16 } });
    expect(parsePortraitVisual(sequence([frame('maximum', 600_000)]))).toMatchObject({ frames: [{ durationMs: 600_000 }] });
    expect(parsePortraitVisual(sequence([frame('a', 300_000), frame('b', 300_000)]))).toBeTruthy();
  });

  it('rejects out-of-range counts, durations, totals, fields, and identifiers with field paths', () => {
    const tooManyFrames = sequence(Array.from({ length: 257 }, (_, index) => frame(`f-${index}`, 1)));
    const tooManyImages = {
      ...layer(),
      images: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`v${index}`, image(`v${index}`)])),
    };
    const validImages = { base: image('base') };
    const cases: Array<[unknown, RegExp]> = [
      [sequence([]), /\$\.frames/],
      [tooManyFrames, /\$\.frames/],
      [layered([]), /\$\.layers/],
      [layered(Array.from({ length: 17 }, (_, index) => layer(`layer-${index}`))), /\$\.layers/],
      [layered([tooManyImages]), /images/],
      [sequence([frame('zero', 0)]), /durationMs/],
      [sequence([frame('fraction', 1.5)]), /durationMs/],
      [sequence([frame('too-long', 600_001)]), /durationMs/],
      [sequence([frame('a', 300_001), frame('b', 300_000)]), /\$\.frames/],
      [{ ...sequence(), typo: true }, /\$\.typo/],
      [{ ...sequence(), loop: 0 }, /\$\.loop/],
      [layered([{ id: 'bad/name', images: validImages, default: 'base' }]), /\.id/],
      [layered([{ id: 'body', images: validImages, default: 'missing' }]), /\.default/],
      [layered([layer('same'), layer('same')]), /\.id/],
      [layered([{ id: 'body', images: validImages, default: 'base', unknown: true }]), /\.unknown/],
    ];
    for (const [value, path] of cases) {
      expect(() => parsePortraitVisual(value)).toThrow(path);
    }
  });

  it('rejects malformed image paths, unsupported formats, and missing animation variants', () => {
    for (const sourcePath of [
      'content/assets/portrait\\hero.png',
      'content/assets/portrait//hero.png',
      'content/assets/portrait/./hero.png',
      'content/assets/portrait/../hero.png',
      'content/assets/portrait/hero.bmp',
      'assets/portrait/hero.png',
    ]) {
      expect(() => parsePortraitVisual(sequence([{ image: sourcePath, durationMs: 1 }]))).toThrow(/frames\[0\]\.image/);
    }
    for (const identifier of ['', ' padded', 'padded ', 'a:b', 'a/b', 'a\\b', 'a\u0001b']) {
      expect(() => parsePortraitVisual(layered([{ id: identifier, images: { base: image('base') }, default: 'base' }]))).toThrow(/\.id/);
    }
    expect(() => parsePortraitVisual({
      version: 1,
      kind: 'layered',
      layers: [{ ...layer(), idle: { frames: [{ variant: 'unknown', durationMs: 1 }], loop: false } }],
    })).toThrow(/idle\.frames\[0\]\.variant/);
    expect(() => parsePortraitVisual({ version: 2, kind: 'sequence', frames: [frame('a')], loop: false })).toThrow(/version/);
  });
});

describe('samplePortraitVisual', () => {
  it('uses half-open frame intervals, wraps loops, and holds the last non-looping frame after completion', () => {
    const looping = parsePortraitVisual(sequence([frame('first', 100), frame('second', 200)], true));
    expect(samplePortraitVisual(looping, 0)).toEqual({ images: [image('first')], active: true });
    expect(samplePortraitVisual(looping, 99.999)).toEqual({ images: [image('first')], active: true });
    expect(samplePortraitVisual(looping, 100)).toEqual({ images: [image('second')], active: true });
    expect(samplePortraitVisual(looping, 300)).toEqual({ images: [image('first')], active: true });
    expect(samplePortraitVisual(looping, 350)).toEqual({ images: [image('first')], active: true });

    const oneShot = parsePortraitVisual(sequence([frame('first', 100), frame('last', 200)]));
    expect(samplePortraitVisual(oneShot, 299)).toEqual({ images: [image('last')], active: true });
    expect(samplePortraitVisual(oneShot, 300)).toEqual({ images: [image('last')], active: false });
    expect(samplePortraitVisual(oneShot, 50_000)).toEqual({ images: [image('last')], active: false });
    expect(samplePortraitVisual(oneShot, 50, false, false)).toEqual({ images: [image('first')], active: false });
  });

  it('selects one variant per layer, switches speaking tracks, falls back to idle or defaults, and combines activity', () => {
    const definition = parsePortraitVisual(layered([
      {
        id: 'body',
        images: { neutral: image('neutral'), blink: image('blink'), talk: image('talk') },
        default: 'neutral',
        idle: { frames: [{ variant: 'neutral', durationMs: 100 }, { variant: 'blink', durationMs: 100 }], loop: true },
        speaking: { frames: [{ variant: 'talk', durationMs: 50 }, { variant: 'neutral', durationMs: 50 }], loop: false },
      },
      {
        id: 'eyes',
        images: { open: image('eyes-open'), closed: image('eyes-closed') },
        default: 'open',
        idle: { frames: [{ variant: 'closed', durationMs: 100 }], loop: false },
      },
      { id: 'badge', images: { default: image('badge') }, default: 'default' },
    ]));

    expect(samplePortraitVisual(definition, 0)).toEqual({
      images: [image('neutral'), image('eyes-closed'), image('badge')], active: true,
    });
    expect(samplePortraitVisual(definition, 100)).toEqual({
      images: [image('blink'), image('eyes-closed'), image('badge')], active: true,
    });
    expect(samplePortraitVisual(definition, 0, true)).toEqual({
      images: [image('talk'), image('eyes-closed'), image('badge')], active: true,
    });
    expect(samplePortraitVisual(definition, 100, true)).toEqual({
      images: [image('neutral'), image('eyes-closed'), image('badge')], active: false,
    });
    expect(samplePortraitVisual(definition, 100, false, false)).toEqual({
      images: [image('neutral'), image('eyes-open'), image('badge')], active: false,
    });
  });

  it('rejects non-finite and negative elapsed times', () => {
    const definition = parsePortraitVisual(sequence());
    for (const elapsedMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => samplePortraitVisual(definition, elapsedMs)).toThrow(/elapsedMs/);
    }
  });
});

describe('portraitVisualPaths', () => {
  it('deduplicates in first-seen order and includes unselected layer variants', () => {
    const definition = parsePortraitVisual(layered([
      { id: 'body', images: { base: image('shared'), unused: image('unused') }, default: 'base' },
      { id: 'eyes', images: { open: image('eyes'), closed: image('unused') }, default: 'open' },
    ]));
    expect(portraitVisualPaths(definition)).toEqual([image('shared'), image('unused'), image('eyes')]);
  });

  it('deduplicates repeated independent sequence frames in frame order', () => {
    const definition = parsePortraitVisual(sequence([frame('first'), frame('second'), frame('first')]));
    expect(portraitVisualPaths(definition)).toEqual([image('first'), image('second')]);
  });
});
