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
    transitionScale: input.reducedMotion === true ? 0 : scale,
    particleEnabled: input.particleEnabled !== false,
  };
}

export function presentationDuration(durationMs: number, preferences: PresentationPreferences): number {
  if (preferences.reducedMotion || preferences.transitionScale === 0) return 1;
  return Math.max(1, durationMs * preferences.transitionScale);
}
