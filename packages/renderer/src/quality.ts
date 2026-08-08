/** 引擎级画质档位；剧情和脚本不感知该设置。 */
export type RenderQuality = 'high' | 'balanced' | 'low';

export interface RenderQualitySettings {
  particleScale: number;
  maxParticles: number;
  effectScale: number;
  postProcess: boolean;
  textureScale: number;
}

const QUALITY_SETTINGS: Record<RenderQuality, RenderQualitySettings> = {
  high: { particleScale: 1, maxParticles: 160, effectScale: 1, postProcess: true, textureScale: 1 },
  balanced: { particleScale: 0.65, maxParticles: 96, effectScale: 0.85, postProcess: true, textureScale: 0.85 },
  low: { particleScale: 0.35, maxParticles: 40, effectScale: 0.65, postProcess: false, textureScale: 0.65 },
};

export function getRenderQualitySettings(quality: RenderQuality): RenderQualitySettings {
  return { ...QUALITY_SETTINGS[quality] };
}

export class RenderQualityController {
  #quality: RenderQuality;
  #listeners = new Set<(quality: RenderQuality, settings: RenderQualitySettings) => void>();

  constructor(initial: RenderQuality = 'balanced') {
    this.#quality = initial;
  }

  get quality(): RenderQuality { return this.#quality; }
  get settings(): RenderQualitySettings { return getRenderQualitySettings(this.#quality); }

  setQuality(quality: RenderQuality): void {
    if (quality === this.#quality) return;
    this.#quality = quality;
    const settings = this.settings;
    for (const listener of this.#listeners) listener(quality, settings);
  }

  onChange(listener: (quality: RenderQuality, settings: RenderQualitySettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
