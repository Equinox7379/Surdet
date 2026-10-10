import { BlurFilter, ColorMatrixFilter, Container, Sprite, Texture, type Filter } from 'pixi.js';
import { STORY_FILTER_NAMES, type StoryFilterName } from '@surdet/core';

type Values = Record<Exclude<StoryFilterName, 'off'>, number>;
const empty = (): Values => ({ blur: 0, grayscale: 0, sepia: 0, vignette: 0 });
const keys = ['blur', 'grayscale', 'sepia', 'vignette'] as const;
export interface StoryFilterSnapshot {
  values: Values;
  motion?: { target: Values; duration: number; remain: number };
}

/** One world owner with finite state, advanced by the existing World frame loop. */
export class StoryFilter {
  #values = empty();
  #motion: { from: Values; target: Values; duration: number; remain: number } | null = null;
  #blur: BlurFilter | null = null;
  #gray: ColorMatrixFilter | null = null;
  #sepia: ColorMatrixFilter | null = null;
  #vignette: Sprite | null = null;
  #vignetteTexture: Texture | null = null;
  constructor(private readonly screen: Container, private readonly width: number, private readonly height: number) {}

  set(name: StoryFilterName, durationMs: number): void {
    if (!STORY_FILTER_NAMES.includes(name) || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600_000) throw new Error('作者滤镜参数无效');
    const target = empty(); if (name !== 'off') target[name] = 1;
    this.#motion = durationMs > 1 ? { from: { ...this.#values }, target, duration: durationMs, remain: durationMs } : null;
    if (!this.#motion) this.#values = target;
  }

  update(deltaMs: number): void {
    const motion = this.#motion; if (!motion) return;
    motion.remain = Math.max(0, motion.remain - Math.max(0, deltaMs));
    const progress = 1 - motion.remain / motion.duration;
    for (const key of keys) this.#values[key] = motion.from[key] + (motion.target[key] - motion.from[key]) * progress;
    if (motion.remain === 0) this.#motion = null;
  }

  settle(): void { if (this.#motion) this.#values = { ...this.#motion.target }; this.#motion = null; }
  get active(): boolean { return this.#motion !== null; }

  project(lowQuality: boolean): Filter[] {
    const filters: Filter[] = [], values = this.#values;
    if (values.blur > 0) {
      this.#blur ??= new BlurFilter({ strength: 8, quality: 3 });
      this.#blur.strength = values.blur * 8; this.#blur.quality = lowQuality ? 1 : 3; filters.push(this.#blur);
    }
    if (values.grayscale > 0) {
      this.#gray ??= new ColorMatrixFilter(); this.#gray.reset(); this.#gray.saturate(-values.grayscale); filters.push(this.#gray);
    }
    if (values.sepia > 0) {
      this.#sepia ??= new ColorMatrixFilter(); this.#sepia.reset(); this.#sepia.sepia(false); this.#sepia.alpha = values.sepia; filters.push(this.#sepia);
    }
    if (values.vignette > 0 && !this.#vignette) {
      const canvas = document.createElement('canvas'); canvas.width = this.width; canvas.height = this.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('作者暗角需要二维画布');
      const gradient = context.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * .18,
        this.width / 2, this.height / 2, Math.hypot(this.width, this.height) / 2);
      gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, 'rgba(0,0,0,.8)');
      context.fillStyle = gradient; context.fillRect(0, 0, this.width, this.height);
      this.#vignetteTexture = Texture.from(canvas); this.#vignette = new Sprite(this.#vignetteTexture);
      // Above tint but below the old-frame transition cover, never on the UI layer.
      this.screen.addChildAt(this.#vignette, 1);
    }
    if (this.#vignette) { this.#vignette.alpha = values.vignette; this.#vignette.visible = values.vignette > 0; }
    return filters;
  }

  snapshot(): StoryFilterSnapshot | undefined {
    if (!this.active && keys.every(key => this.#values[key] === 0)) return undefined;
    return { values: { ...this.#values }, ...(this.#motion ? { motion: { target: { ...this.#motion.target }, duration: this.#motion.remain, remain: this.#motion.remain } } : {}) };
  }

  static prepare(raw: unknown): StoryFilterSnapshot | undefined {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('滤镜快照无效');
    const value = raw as StoryFilterSnapshot;
    const validValues = (values: unknown): values is Values => !!values && typeof values === 'object' && !Array.isArray(values)
      && keys.every(key => typeof (values as Values)[key] === 'number' && Number.isFinite((values as Values)[key]) && (values as Values)[key] >= 0 && (values as Values)[key] <= 1);
    if (!validValues(value.values)) throw new Error('滤镜强度须在0–1之间');
    const motion = value.motion;
    if (motion !== undefined && (!motion || !validValues(motion.target) || !Number.isFinite(motion.duration) || motion.duration <= 0 || motion.duration > 600_000
      || !Number.isFinite(motion.remain) || motion.remain <= 0 || motion.remain > motion.duration)) throw new Error('滤镜过渡快照无效');
    const values = Object.fromEntries(keys.map(key => [key, value.values[key]])) as Values;
    return { values, ...(motion ? { motion: { target: Object.fromEntries(keys.map(key => [key, motion.target[key]])) as Values, duration: motion.duration, remain: motion.remain } } : {}) };
  }

  restore(snapshot: StoryFilterSnapshot | undefined): void {
    this.#values = snapshot ? { ...snapshot.values } : empty();
    this.#motion = snapshot?.motion ? { from: { ...this.#values }, target: { ...snapshot.motion.target }, duration: snapshot.motion.remain, remain: snapshot.motion.remain } : null;
  }
  clear(): void { this.restore(undefined); }
  destroy(): void {
    this.clear(); this.#blur?.destroy(); this.#gray?.destroy(); this.#sepia?.destroy();
    this.#vignette?.parent?.removeChild(this.#vignette); this.#vignette?.destroy(); this.#vignetteTexture?.destroy(true);
    this.#blur = null; this.#gray = null; this.#sepia = null; this.#vignette = null; this.#vignetteTexture = null;
  }
}
