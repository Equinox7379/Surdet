import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS } from '@surdet/core';
import { NO_READING_TRIAL, parseReadingTrial, readingTrialScales, withReadingTrial } from '../src/preview-reading-trial.js';

describe('preview reading try-out', () => {
  it('offers Core’s text scale range in its own step', () => {
    expect(readingTrialScales()).toEqual([0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4]);
  });

  it('accepts only in-range scales and on/off motion, with null for "use the setting"', () => {
    expect(parseReadingTrial({ type: 'x', textScale: 1.4, reducedMotion: true })).toEqual({ textScale: 1.4, reducedMotion: true });
    expect(parseReadingTrial({ textScale: null, reducedMotion: null })).toEqual(NO_READING_TRIAL);
    for (const bad of [null, 'x', { textScale: 2, reducedMotion: null }, { textScale: Number.NaN, reducedMotion: null }, { textScale: null, reducedMotion: 'yes' }, {}]) {
      expect(parseReadingTrial(bad)).toBeNull();
    }
  });

  it('overrides only what the trial sets and leaves the stored settings alone', () => {
    const stored = { ...DEFAULT_GAME_SETTINGS, textScale: 1.1, reducedMotion: false, dialogueOpacity: 0.5 };
    const applied = withReadingTrial(stored, { textScale: 1.4, reducedMotion: null });
    expect(applied).toMatchObject({ textScale: 1.4, reducedMotion: false, dialogueOpacity: 0.5 });
    expect(stored.textScale).toBe(1.1);
    expect(withReadingTrial(stored, NO_READING_TRIAL)).toEqual(stored);
  });
});
