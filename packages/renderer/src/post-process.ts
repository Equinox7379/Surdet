export interface PostProcessSettings {
  enabled: boolean;
  saturation: number;
  brightness: number;
  contrast: number;
}

export const DEFAULT_POST_PROCESS: PostProcessSettings = {
  enabled: false,
  saturation: 1,
  brightness: 1,
  contrast: 1,
};

export function normalizePostProcess(input: Partial<PostProcessSettings> = {}): PostProcessSettings {
  const clamp = (value: number | undefined, min: number, max: number, fallback: number): number =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
  return {
    enabled: input.enabled === true,
    saturation: clamp(input.saturation, 0, 2, 1),
    brightness: clamp(input.brightness, 0, 2, 1),
    contrast: clamp(input.contrast, 0, 2, 1),
  };
}
