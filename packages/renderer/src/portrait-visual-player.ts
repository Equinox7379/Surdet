import { Container, Sprite, type Texture } from 'pixi.js';
import { samplePortraitVisual } from '@surdet/core';
import type { RegisteredPortraitVisual } from './services/render-asset-registry.js';

export interface PortraitAnimationState { key: string; elapsedMs: number; speaking: boolean }

/** A real Pixi container keeps part transforms/tint/alpha together; sprites are leaves. */
export class PortraitVisualRoot extends Container {
  readonly image: Sprite;
  constructor(texture: Texture) { super(); this.image = new Sprite(texture); this.addChild(this.image); }
  get texture(): Texture { return this.image.texture; }
  set texture(value: Texture) { this.image.texture = value; }
  get anchor() { return this.image.anchor; }
}

export function validatePortraitAnimation(asset: RegisteredPortraitVisual, value: unknown): PortraitAnimationState {
  const state = value as PortraitAnimationState | null;
  if (!state || state.key !== asset.key || typeof state.speaking !== 'boolean'
    || !Number.isFinite(state.elapsedMs) || state.elapsedMs < 0 || state.elapsedMs > Number.MAX_SAFE_INTEGER)
    throw new Error('动态立绘存档的定义、图片或播放位置不匹配');
  return { key: state.key, elapsedMs: state.elapsedMs, speaking: state.speaking };
}

/** One displayed actor owns one clock. Textures remain owned by the registry. */
export class PortraitVisualPlayer {
  readonly asset: RegisteredPortraitVisual;
  readonly root: PortraitVisualRoot;
  readonly layers: Sprite[] = [];
  #elapsedMs = 0;
  #speaking = false;
  active = false;

  constructor(root: PortraitVisualRoot, asset: RegisteredPortraitVisual, state?: PortraitAnimationState) {
    this.root = root; this.asset = asset;
    if (state) { const saved = validatePortraitAnimation(asset, state); this.#elapsedMs = saved.elapsedMs; this.#speaking = saved.speaking; }
    const count = samplePortraitVisual(asset.definition, 0).images.length;
    for (let index = 1; index < count; index++) { const sprite = new Sprite(); root.addChild(sprite); this.layers.push(sprite); }
    this.project(true);
  }

  snapshot(): PortraitAnimationState { return { key: this.asset.key, elapsedMs: this.#elapsedMs, speaking: this.#speaking }; }

  advance(deltaMs: number, speaking: boolean, motion: boolean, skipping = false): void {
    if (speaking !== this.#speaking) { this.#speaking = speaking; if (this.asset.definition.kind === 'layered') this.#elapsedMs = 0; }
    if (skipping) this.#elapsedMs = 600000; // finite clips settle at their end; looping clips use a quiet default while skipping.
    else if (motion) this.#elapsedMs = Math.min(Number.MAX_SAFE_INTEGER, this.#elapsedMs + Math.max(0, deltaMs));
    this.project(motion, skipping);
  }

  project(motion: boolean, skipping = false): void {
    const definition = this.asset.definition;
    const frame = samplePortraitVisual(definition, this.#elapsedMs, this.#speaking, motion);
    if (skipping && motion) {
      const defaults = samplePortraitVisual(definition, 0, false, false).images;
      if (definition.kind === 'sequence' && definition.loop) frame.images = defaults;
      if (definition.kind === 'layered') definition.layers.forEach((layer, index) => {
        if ((this.#speaking ? layer.speaking ?? layer.idle : layer.idle)?.loop) frame.images[index] = defaults[index]!;
      });
    }
    this.active = !skipping && frame.active;
    this.root.texture = this.asset.images.get(frame.images[0]!)!;
    this.layers.forEach((sprite, index) => { sprite.texture = this.asset.images.get(frame.images[index + 1]!)!; });
    this.syncAnchor();
  }

  syncAnchor(): void { for (const sprite of this.layers) sprite.anchor.copyFrom(this.root.anchor); }
}
