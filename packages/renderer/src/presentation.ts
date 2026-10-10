/** 用户可关闭的演出偏好；只影响视觉表现，不跳过剧情事件。 */
export interface PresentationPreferences {
  reducedMotion: boolean;
  transitionScale: number;
  particleEnabled: boolean;
}

export const DEFAULT_PRESENTATION_PREFERENCES: PresentationPreferences = {
  reducedMotion: false,
  transitionScale: 1,
  particleEnabled: true,
};

export function normalizePresentationPreferences(input: Partial<PresentationPreferences> = {}): PresentationPreferences {
  const scale = Number.isFinite(input.transitionScale) ? Math.max(0, Math.min(1, input.transitionScale!)) : 1;
  return {
    reducedMotion: input.reducedMotion === true,
    transitionScale: scale,
    particleEnabled: input.particleEnabled !== false,
  };
}

export function presentationDuration(durationMs: number, preferences: PresentationPreferences): number {
  if (preferences.reducedMotion || preferences.transitionScale === 0) return 1;
  return Math.max(1, durationMs * preferences.transitionScale);
}

/** Device reading preferences; null opacity follows the current work theme. */
export interface ReadingPreferences { textScale: number; dialogueOpacity: number | null }
export const DEFAULT_READING_PREFERENCES: ReadingPreferences = { textScale: 1, dialogueOpacity: null };
export function normalizeReadingPreferences(input: Partial<ReadingPreferences>): ReadingPreferences {
  return { textScale: Number.isFinite(input.textScale) ? Math.max(.8, Math.min(1.4, input.textScale!)) : 1,
    dialogueOpacity: typeof input.dialogueOpacity === 'number' && Number.isFinite(input.dialogueOpacity) ? Math.max(0, Math.min(1, input.dialogueOpacity)) : null };
}
