/**
 * Temporary reading try-out in the Editor preview: text scale and reduced motion only.
 * It overrides what the preview applies through Renderer's preference commands and is never
 * written to the work's configuration, the preview settings or any Player device settings.
 */
import { GAME_SETTING_DEFINITIONS, type GameSettings } from '@surdet/core';

export interface ReadingTrial {
  /** null keeps the preview's own setting. */
  textScale: number | null;
  reducedMotion: boolean | null;
}

export const NO_READING_TRIAL: ReadingTrial = Object.freeze({ textScale: null, reducedMotion: null });

/** Trial text scales offered in the preview toolbar: Core's range in its own step. */
export function readingTrialScales(): number[] {
  const { min, max, step } = GAME_SETTING_DEFINITIONS.textScale;
  const scales: number[] = [];
  for (let value = min; value <= max + 1e-9; value += step) scales.push(Math.round(value * 100) / 100);
  return scales;
}

/** The `surdet-preview-reading-trial` message body, or null when it is not a valid trial. */
export function parseReadingTrial(data: unknown): ReadingTrial | null {
  if (!data || typeof data !== 'object') return null;
  const { textScale, reducedMotion } = data as Record<string, unknown>;
  const { min, max } = GAME_SETTING_DEFINITIONS.textScale;
  const scaleOk = textScale === null || (typeof textScale === 'number' && Number.isFinite(textScale) && textScale >= min && textScale <= max);
  const motionOk = reducedMotion === null || typeof reducedMotion === 'boolean';
  return scaleOk && motionOk ? { textScale: textScale as number | null, reducedMotion: reducedMotion as boolean | null } : null;
}

/** Settings as the preview applies them while a trial is active; the stored settings are untouched. */
export function withReadingTrial(settings: GameSettings, trial: ReadingTrial): GameSettings {
  return {
    ...settings,
    ...(trial.textScale === null ? {} : { textScale: trial.textScale }),
    ...(trial.reducedMotion === null ? {} : { reducedMotion: trial.reducedMotion }),
  };
}
