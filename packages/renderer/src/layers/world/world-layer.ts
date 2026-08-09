import {
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Texture,
} from 'pixi.js';
import type { WorldProjectionPort } from '../../api/renderer-commands.js';
import { RendererCommandError } from '../../api/renderer-errors.js';
import { AsyncGeneration } from '../../lifecycle/async-generation.js';
import { RenderLifecycle } from '../../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import { RenderQualityController, type RenderQuality } from '../../quality.js';
import {
  DEFAULT_PRESENTATION_PREFERENCES,
  normalizePresentationPreferences,
  presentationDuration,
  type PresentationPreferences,
} from '../../presentation.js';
import { DEFAULT_POST_PROCESS, normalizePostProcess, type PostProcessSettings } from '../../post-process.js';
import { WorldEffectsController, type ShakeDirection, type TransitionName } from '../../world-effects-controller.js';
import type { TimelineFrameEvent } from '../../timeline-player.js';
import type { FrameRequestHandler, PortraitView } from '../../types.js';

export interface WorldPresentationSnapshot {
  version: 1;
  backgroundKey: string | null;
  portraits: readonly { key: string; view: PortraitView }[];
  cameraScale: number;
  cameraPan: { x: number; y: number };
  fadeAlpha: number;
  tint: { color: number; alpha: number };
  particleKind: string | null;
}

/** Read-only evidence emitted for the local renderer acceptance harness. */
export interface WorldLayerDebugSnapshot {
  readonly activeSpeakerId: string | null;
  readonly backgroundKey: string | null;
  readonly particleKind: string | null;
}

export interface WorldLayerOptions {
  readonly width: number;
  readonly height: number;
  readonly assets: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
  readonly requestFrame?: FrameRequestHandler;
  readonly captureThumbnail?: () => string | null;
  readonly createBackgroundTexture?: (key: string, width: number, height: number) => Texture;
}

interface ParticlePreset {
  count: number;
  color: number;
  size: number;
  vy: number;
  sway: number;
  elongated?: boolean;
}

const PARTICLE_PRESETS: Record<string, ParticlePreset> = {
  snow: { count: 60, color: 0xffffff, size: 4, vy: 0.7, sway: 0.5 },
  rain: { count: 70, color: 0x9db8d9, size: 3, vy: 6, sway: 0.4, elongated: true },
  sakura: { count: 40, color: 0xffc4d6, size: 5, vy: 0.9, sway: 1.2 },
  sparkle: { count: 36, color: 0xfff2b0, size: 2.6, vy: -0.25, sway: 0.3 },
  fireflies: { count: 24, color: 0xd8f08a, size: 3, vy: -0.15, sway: 0.5 },
};

function hashStr(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

export function makeWorldBackgroundTexture(key: string, width = 1280, height = 720): Texture {
  if (typeof document === 'undefined') return Texture.WHITE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Texture.WHITE;
  const hue = 190 + (hashStr(key) % 120);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `hsl(${hue}, 45%, 30%)`);
  gradient.addColorStop(0.55, `hsl(${(hue + 25) % 360}, 48%, 17%)`);
  gradient.addColorStop(1, `hsl(${(hue + 50) % 360}, 52%, 8%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.32, width / 2, height / 2, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(2,4,10,0.5)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
  let seed = hashStr(key) >>> 0;
  for (let index = 0; index < 1400; index++) {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    const x = random * width;
    seed = (seed + 0x6d2b79f5) | 0;
    value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    const y = (((value ^ (value >>> 14)) >>> 0) / 4294967296) * height;
    context.fillStyle = random > 0.5 ? 'rgba(200,225,255,0.05)' : 'rgba(0,0,0,0.08)';
    context.fillRect(x, y, 1.6, 1.6);
  }
  return Texture.from(canvas);
}

function makeFallbackPortraitTexture(charId: string, costume: string, expression: string): Texture {
  if (typeof document === 'undefined') return Texture.WHITE;
  const width = 800;
  const height = 1280;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;
  const hash = hashStr(`${charId}:${costume}`);
  const expressionHash = hashStr(expression) % 3;
  const hair = `hsl(${hash % 360}, 52%, 62%)`;
  const hairDark = `hsl(${hash % 360}, 50%, 46%)`;
  const cloth = `hsl(${(hash + 150) % 360}, 42%, 50%)`;
  const outline = `hsl(${hash % 360}, 38%, 24%)`;
  const skin = 'hsl(28, 58%, 88%)';
  const cx = width / 2;
  const headY = height * 0.3;
  const headRx = width * 0.17;
  const headRy = height * 0.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.ellipse(cx, headY, headRx * 1.22, headRy * 1.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hair;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * headRx * 1.1, headY - headRy * 0.4);
    ctx.quadraticCurveTo(cx + side * headRx * 1.5, headY + headRy, cx + side * headRx, height * 0.62);
    ctx.quadraticCurveTo(cx + side * headRx * 0.7, headY + headRy, cx + side * headRx * 0.82, headY - headRy * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = width * 0.008;
    ctx.stroke();
  }
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(width * 0.1, height);
  ctx.bezierCurveTo(width * 0.12, height * 0.72, width * 0.28, height * 0.64, cx - width * 0.08, height * 0.6);
  ctx.lineTo(cx + width * 0.08, height * 0.6);
  ctx.bezierCurveTo(width * 0.72, height * 0.64, width * 0.88, height * 0.72, width * 0.9, height);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = width * 0.008;
  ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, headY, headRx, headRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(cx - headRx * 1.05, headY - headRy * 0.15);
  ctx.quadraticCurveTo(cx - headRx * 1.1, headY - headRy * 1.15, cx, headY - headRy * 1.12);
  ctx.quadraticCurveTo(cx + headRx * 1.1, headY - headRy * 1.15, cx + headRx * 1.05, headY - headRy * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const eyeY = headY + headRy * 0.12;
  const eyeX = headRx * 0.48;
  ctx.fillStyle = outline;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * eyeX, eyeY, width * 0.045, width * (expressionHash === 2 ? 0.07 : 0.055), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = outline;
  ctx.beginPath();
  ctx.moveTo(cx - headRy * 0.12, headY + headRy * 0.58);
  ctx.quadraticCurveTo(cx, headY + headRy * (expressionHash === 1 ? 0.68 : 0.62), cx + headRy * 0.12, headY + headRy * 0.58);
  ctx.stroke();
  return Texture.from(canvas);
}

function lerpColor(a: number, b: number, progress: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * progress);
  const g = Math.round(ag + (bg - ag) * progress);
  const blue = Math.round(ab + (bb - ab) * progress);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (blue & 0xff);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function invalidSnapshot(message: string): RendererCommandError {
  return new RendererCommandError(message, {
    code: 'PRESENTATION_SNAPSHOT_INVALID',
    domain: 'world',
    command: 'restorePresentation',
  });
}

/** World-only presentation projection. It has no dependency on Dialogue or any other layer. */
export class WorldLayer implements WorldProjectionPort {
  readonly owner = 'world' as const;
  readonly worldContainer: Container;
  readonly particleContainer: Container;
  readonly screenContainer: Container;
  readonly wipeOverlay: Graphics;
  readonly fadeOverlay: Graphics;
  readonly flashOverlay: Graphics;

  readonly #w: number;
  readonly #h: number;
  readonly #assets: RenderAssetRegistry;
  readonly #lifecycle: RenderLifecycle;
  readonly #ownsLifecycle: boolean;
  readonly #requestFrameCallback?: FrameRequestHandler;
  readonly #captureThumbnailCallback?: () => string | null;
  readonly #createBackgroundTexture: (key: string, width: number, height: number) => Texture;
  readonly #generation = new AsyncGeneration();
  readonly #quality = new RenderQualityController('balanced');
  #presentation: PresentationPreferences = { ...DEFAULT_PRESENTATION_PREFERENCES };
  #postProcess: PostProcessSettings = { ...DEFAULT_POST_PROCESS };
  #colorMatrix: ColorMatrixFilter | null = null;
  #frameRequest: FrameRequestHandler | null = null;
  #disposed = false;
  #effectRegistered = false;

  readonly #backgroundLayer = new Container();
  readonly #portraitLayer = new Container();
  readonly #tintOverlay: Graphics;
  readonly #worldEffects: WorldEffectsController;
  #backgroundSprite: Sprite | null = null;
  #backgroundKey: string | null = null;
  #backgroundTransition: { old: Sprite | null; neu: Sprite; remain: number; dur: number } | null = null;
  #portraitSprites = new Map<string, Sprite>();
  #portraitViews = new Map<string, PortraitView>();
  #portraitTweens: { old: Sprite; neu: Sprite; remain: number; dur: number }[] = [];
  #activeSpeakerId: string | null = null;
  #flashRemain = 0;
  #flashDur = 1;
  #zoomFrom = 1;
  #zoomTo = 1;
  #zoomRemain = 0;
  #zoomDur = 1;
  #cameraPanX = 0;
  #cameraPanY = 0;
  #wipeRemain = 0;
  #wipeDur = 1;
  #tintFrom = { color: 0x000000, alpha: 0 };
  #tintTo = { color: 0x000000, alpha: 0 };
  #tintRemain = 0;
  #tintDur = 1;
  #particleKind: string | null = null;
  #particlePreset: ParticlePreset | null = null;
  #particles: { sprite: Graphics; vx: number; vy: number; phase: number }[] = [];
  #moveTweens: { sprite: Sprite; fromX: number; toX: number; remain: number; dur: number }[] = [];
  #timelineMoveStarts = new Map<object, Map<string, number>>();
  #timelineValueStarts = new Map<object, number>();
  #timelinePanStarts = new Map<object, { x: number; y: number }>();
  #timelineTintStarts = new Map<object, { color: number; alpha: number }>();

  constructor(options: WorldLayerOptions) {
    this.#w = options.width;
    this.#h = options.height;
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#requestFrameCallback = options.requestFrame;
    this.#captureThumbnailCallback = options.captureThumbnail;
    this.#createBackgroundTexture = options.createBackgroundTexture ?? makeWorldBackgroundTexture;

    this.worldContainer = new Container();
    this.worldContainer.addChild(this.#backgroundLayer, this.#portraitLayer);
    this.particleContainer = new Container();
    this.screenContainer = new Container();
    this.wipeOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.wipeOverlay.visible = false;
    this.fadeOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.fadeOverlay.alpha = 0;
    this.flashOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0xffffff);
    this.flashOverlay.alpha = 0;
    this.#tintOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0xffffff);
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.screenContainer.addChild(this.#tintOverlay);
    this.#worldEffects = new WorldEffectsController({
      world: this.worldContainer,
      screen: this.screenContainer,
      width: this.#w,
      height: this.#h,
      getBasePosition: () => this.#zoomBaseOffset(),
      setWorldPosition: (x, y) => this.worldContainer.position.set(x, y),
      duration: (durationMs) => presentationDuration(durationMs, this.#presentation),
      requestFrame: () => this.#requestFrame(),
    });

    this.#registerDisplay('world-container', this.worldContainer);
    this.#registerDisplay('particle-container', this.particleContainer);
    this.#registerDisplay('screen-container', this.screenContainer);
    this.#registerDisplay('wipe-overlay', this.wipeOverlay);
    this.#registerDisplay('fade-overlay', this.fadeOverlay);
    this.#registerDisplay('flash-overlay', this.flashOverlay);
  }

  get backgroundKey(): string | null { return this.#backgroundKey; }
  get needsUpdate(): boolean { return this.#hasEffectWork(); }

  /**
   * Test-only read model. It intentionally exposes no Pixi objects and has no
   * rendering or lifecycle side effects.
   */
  debugSnapshot(): WorldLayerDebugSnapshot {
    return {
      activeSpeakerId: this.#activeSpeakerId,
      backgroundKey: this.#backgroundKey,
      particleKind: this.#particleKind,
    };
  }

  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate) handler();
  }

  update(deltaMs: number): void {
    if (this.#disposed || !this.#hasEffectWork()) return;
    this.#worldEffects.update(deltaMs);
    if (this.#flashRemain > 0) {
      this.#flashRemain = Math.max(0, this.#flashRemain - deltaMs);
      this.flashOverlay.alpha = this.#flashRemain / this.#flashDur;
    }
    if (this.#zoomRemain > 0) {
      this.#zoomRemain = Math.max(0, this.#zoomRemain - deltaMs);
      const progress = 1 - this.#zoomRemain / this.#zoomDur;
      this.worldContainer.scale.set(this.#zoomFrom + (this.#zoomTo - this.#zoomFrom) * progress);
      this.#setWorldBasePosition();
    }
    if (this.#backgroundTransition) {
      const transition = this.#backgroundTransition;
      transition.remain = Math.max(0, transition.remain - deltaMs);
      const progress = 1 - transition.remain / transition.dur;
      transition.neu.alpha = progress;
      if (transition.old) transition.old.alpha = 1 - progress;
      if (transition.remain === 0) {
        if (transition.old?.parent) transition.old.parent.removeChild(transition.old);
        transition.old?.destroy();
        transition.neu.alpha = 1;
        this.#backgroundTransition = null;
      }
    }
    this.#updateTransient(deltaMs);
    this.#syncEffectRegistration();
    if (this.#hasEffectWork()) this.#requestFrame();
  }

  setQuality(quality: RenderQuality): void {
    if (quality === this.#quality.quality) return;
    const activeParticles = this.#particleKind;
    this.#quality.setQuality(quality);
    if (activeParticles) {
      this.stopParticles();
      this.startParticles(activeParticles);
    }
    this.#applyPostProcess();
    this.#requestFrame();
  }

  getQuality(): RenderQuality { return this.#quality.quality; }

  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void {
    this.#presentation = normalizePresentationPreferences({ ...this.#presentation, ...preferences });
    if (!this.#presentation.particleEnabled) this.stopParticles();
    this.#requestFrame();
  }

  getPresentationPreferences(): PresentationPreferences { return { ...this.#presentation }; }

  setPostProcess(settings: Partial<PostProcessSettings>): void {
    this.#postProcess = normalizePostProcess({ ...this.#postProcess, ...settings });
    this.#applyPostProcess();
    this.#requestFrame();
  }

  getPostProcess(): PostProcessSettings { return { ...this.#postProcess }; }

  captureThumbnail(): string | null { return this.#captureThumbnailCallback?.() ?? null; }

  async refreshBackgroundAsset(key: string): Promise<void> {
    if (this.#backgroundKey === key) this.setBackground(key);
  }

  async refreshPortraitAsset(charId: string, costume: string, expression: string): Promise<void> {
    const cacheKey = `${charId}:${costume}:${expression}`;
    for (const [key, view] of this.#portraitViews) {
      if (`${view.charId}:${view.costume}:${view.expression}` === cacheKey) this.setPortrait(key, view);
    }
  }

  setPortraitFocus(characterId: string | null): void {
    if (this.#disposed) return;
    this.#activeSpeakerId = characterId;
    for (const [key, sprite] of this.#portraitSprites) {
      sprite.alpha = !characterId || this.#portraitViews.get(key)?.charId === characterId ? 1 : 0.46;
    }
    this.#requestFrame();
  }

  setBackground(key: string | null): void {
    if (this.#disposed) return;
    this.#invalidatePreparation();
    this.#requestFrame();
    this.#stopBackgroundTransition();
    this.#backgroundKey = key;
    if (this.#backgroundSprite) {
      this.#backgroundLayer.removeChild(this.#backgroundSprite);
      this.#backgroundSprite.destroy();
      this.#backgroundSprite = null;
    }
    if (!key) return;
    const texture = this.#resolveBackground(key);
    const sprite = this.#createBackgroundSprite(texture);
    this.#backgroundSprite = sprite;
    this.#backgroundLayer.addChildAt(sprite, 0);
  }

  setPortrait(key: string, view: PortraitView): void {
    if (this.#disposed) return;
    this.#invalidatePreparation();
    this.#requestFrame();
    this.#portraitViews.set(key, { ...view });
    const texture = this.#assets.resolvePortrait(view.charId, view.costume, view.expression)
      ?? this.#assets.getOrCreatePortrait(`${view.charId}:${view.costume}:${view.expression}`, () => makeFallbackPortraitTexture(view.charId, view.costume, view.expression));
    const width = Math.min(430, this.#w * 0.36);
    const height = (texture.height / Math.max(1, texture.width)) * width;
    const x = this.#resolvePortraitX(view.pos) ?? this.#w * 0.5;
    const existing = this.#portraitSprites.get(key);
    if (!existing) {
      const sprite = this.#createPortraitSprite(texture, x, height, view);
      this.#portraitSprites.set(key, sprite);
      this.#portraitLayer.addChild(sprite);
      return;
    }
    if (existing.texture === texture) {
      existing.position.set(x, this.#h + 10);
      existing.alpha = this.#portraitAlpha(view);
      return;
    }
    const next = this.#createPortraitSprite(texture, x, height, view);
    next.alpha = 0;
    this.#portraitLayer.addChild(next);
    this.#portraitSprites.set(key, next);
    this.#portraitTweens.push({ old: existing, neu: next, remain: 260, dur: 260 });
    this.#ensureEffectRegistration();
  }

  removePortrait(key: string): void {
    if (this.#disposed) return;
    this.#invalidatePreparation();
    this.#requestFrame();
    const keys = this.#portraitSprites.has(key)
      ? [key]
      : [...this.#portraitSprites.keys()].filter((candidate) => candidate === key || candidate.startsWith(`${key}:`));
    const removed = new Set<Sprite>();
    for (const candidate of keys) {
      const sprite = this.#portraitSprites.get(candidate);
      if (sprite) removed.add(sprite);
    }
    this.#detachPortraitSprites(removed);
    for (const candidate of keys) {
      const sprite = this.#portraitSprites.get(candidate);
      if (!sprite) continue;
      if (sprite.parent) sprite.parent.removeChild(sprite);
      sprite.destroy();
      this.#portraitSprites.delete(candidate);
      this.#portraitViews.delete(candidate);
    }
    this.#syncEffectRegistration();
  }

  setFade(alpha: number): void {
    if (this.#disposed) return;
    this.fadeOverlay.alpha = Math.max(0, Math.min(1, alpha));
    this.#requestFrame();
  }

  shake(durationMs = 400, strength = 8, direction: ShakeDirection = 'both'): void {
    this.#worldEffects.shake(presentationDuration(durationMs, this.#presentation), strength, direction);
    this.#ensureEffectRegistration();
  }

  transition(name: TransitionName | string, durationMs = 600): boolean {
    const started = this.#worldEffects.transition(name, presentationDuration(durationMs, this.#presentation));
    if (started) {
      this.#ensureEffectRegistration();
      this.#requestFrame();
    }
    return started;
  }

  flash(durationMs = 300): void {
    this.#flashDur = presentationDuration(durationMs, this.#presentation);
    this.#flashRemain = this.#flashDur;
    this.flashOverlay.alpha = 1;
    this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  zoom(scale = 1, durationMs = 400): void {
    this.#zoomFrom = this.worldContainer.scale.x;
    this.#zoomTo = Math.max(0.25, Math.min(4, scale));
    this.#zoomDur = presentationDuration(durationMs, this.#presentation);
    this.#zoomRemain = this.#zoomDur;
    this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  wipe(durationMs = 600): void {
    this.#wipeDur = presentationDuration(durationMs, this.#presentation);
    this.#wipeRemain = this.#wipeDur;
    this.wipeOverlay.visible = true;
    this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  movePortrait(key: string, pos: string, durationMs = 400): void {
    const targetX = this.#resolvePortraitX(pos);
    if (targetX === null) return;
    const keys = this.#portraitSprites.has(key)
      ? [key]
      : [...this.#portraitSprites.keys()].filter((candidate) => candidate.startsWith(`${key}:`));
    const duration = presentationDuration(durationMs, this.#presentation);
    for (const candidate of keys) {
      const sprite = this.#portraitSprites.get(candidate);
      if (!sprite) continue;
      this.#moveTweens = this.#moveTweens.filter((tween) => tween.sprite !== sprite);
      this.#moveTweens.push({ sprite, fromX: sprite.x, toX: targetX, remain: duration, dur: duration });
    }
    if (keys.length > 0) this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  setTint(color: number, alpha: number, durationMs = 400): void {
    this.#tintFrom = this.#tintCurrent();
    this.#tintTo = { color: color & 0xffffff, alpha: Math.max(0, Math.min(1, alpha)) };
    this.#tintDur = presentationDuration(durationMs, this.#presentation);
    this.#tintRemain = this.#tintDur;
    this.#tintOverlay.visible = true;
    this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  clearTint(durationMs = 400): void { this.setTint(this.#tintCurrent().color, 0, durationMs); }

  startParticles(kind: string): void {
    if (this.#disposed || !this.#presentation.particleEnabled) return;
    if (this.#particleKind === kind) return;
    this.stopParticles();
    const preset = PARTICLE_PRESETS[kind];
    if (!preset) return;
    this.#particleKind = kind;
    const count = Math.min(this.#quality.settings.maxParticles, Math.max(1, Math.round(preset.count * this.#quality.settings.particleScale)));
    for (let index = 0; index < count; index++) {
      const radius = preset.size * (0.6 + Math.random() * 0.8);
      const sprite = preset.elongated
        ? new Graphics().rect(-0.8, -radius * 3, 1.6, radius * 6).fill({ color: preset.color, alpha: 0.75 })
        : new Graphics().circle(0, 0, radius).fill({ color: preset.color, alpha: 1 });
      sprite.alpha = 0.55 + Math.random() * 0.45;
      sprite.position.set(Math.random() * this.#w, Math.random() * this.#h);
      this.particleContainer.addChild(sprite);
      this.#particles.push({ sprite, vx: (Math.random() - 0.5) * preset.sway, vy: preset.vy * (0.7 + Math.random() * 0.6), phase: Math.random() * Math.PI * 2 });
    }
    this.#particlePreset = preset;
    this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  stopParticles(): void {
    for (const particle of this.#particles) {
      this.particleContainer.removeChild(particle.sprite);
      particle.sprite.destroy();
    }
    this.#particles = [];
    this.#particleKind = null;
    this.#particlePreset = null;
    this.#syncEffectRegistration();
    this.#requestFrame();
  }

  applyTimelineFrame(event: TimelineFrameEvent): void {
    const cue = event.cue;
    if (event.track === 'background' && cue.action === 'set' && typeof cue.key === 'string' && (event.started || event.final)) {
      this.#startTimelineBackground(cue.key, cue.durationMs);
      return;
    }
    if (event.track === 'portrait' && event.target) {
      const target = event.target;
      if (cue.action === 'show' && (event.started || event.final)) {
        this.setPortrait(target, {
          charId: target.split(':')[0] ?? target,
          costume: target.split(':')[1] ?? 'normal',
          expression: typeof cue.expression === 'string' ? cue.expression : 'normal',
          pos: typeof cue.position === 'string' ? cue.position : 'center',
        });
      } else if (cue.action === 'expression' && (event.started || event.final)) {
        const current = this.#portraitViews.get(target);
        if (current && typeof cue.expression === 'string') this.setPortrait(target, { ...current, expression: cue.expression });
      } else if (cue.action === 'move') {
        const sprite = this.#portraitSprites.get(target);
        const targetX = typeof cue.position === 'string' ? this.#resolvePortraitX(cue.position) : null;
        if (sprite && targetX !== null) {
          let starts = this.#timelineMoveStarts.get(cue);
          if (!starts) {
            starts = new Map([[target, sprite.x]]);
            this.#timelineMoveStarts.set(cue, starts);
          }
          sprite.x = starts.get(target)! + (targetX - starts.get(target)!) * event.progress;
          if (event.progress >= 1) this.#timelineMoveStarts.delete(cue);
        }
      } else if (cue.action === 'show') {
        const sprite = this.#portraitSprites.get(target);
        if (sprite) {
          sprite.alpha = this.#portraitAlpha(this.#portraitViews.get(target)) * event.progress;
          sprite.y = this.#h + 10 + (1 - event.progress) * 28;
        }
      } else if (cue.action === 'hide') {
        const sprite = this.#portraitSprites.get(target);
        if (sprite) sprite.alpha = 1 - event.progress;
        if (event.progress >= 1) this.removePortrait(target);
      }
      return;
    }
    if (event.track === 'camera') {
      if (cue.action === 'zoom' && typeof cue.scale === 'number') {
        let from = this.#timelineValueStarts.get(cue);
        if (from === undefined) {
          from = this.worldContainer.scale.x;
          this.#timelineValueStarts.set(cue, from);
        }
        this.worldContainer.scale.set(from + (Math.max(0.25, Math.min(4, cue.scale)) - from) * event.progress);
        this.#setWorldBasePosition();
        if (event.progress >= 1) this.#timelineValueStarts.delete(cue);
      } else if (cue.action === 'pan' && typeof cue.x === 'number' && typeof cue.y === 'number') {
        let from = this.#timelinePanStarts.get(cue);
        if (!from) {
          from = { x: this.#cameraPanX, y: this.#cameraPanY };
          this.#timelinePanStarts.set(cue, from);
        }
        this.#cameraPanX = from.x + (Math.max(-2000, Math.min(2000, cue.x)) - from.x) * event.progress;
        this.#cameraPanY = from.y + (Math.max(-2000, Math.min(2000, cue.y)) - from.y) * event.progress;
        this.#setWorldBasePosition();
        if (event.progress >= 1) this.#timelinePanStarts.delete(cue);
      } else if (cue.action === 'shake' && event.started && typeof cue.strength === 'number') {
        this.shake(cue.durationMs, cue.strength);
      }
      return;
    }
    if (event.track === 'screen') {
      if (cue.action === 'fade' && typeof cue.alpha === 'number') {
        let from = this.#timelineValueStarts.get(cue);
        if (from === undefined) {
          from = this.fadeOverlay.alpha;
          this.#timelineValueStarts.set(cue, from);
        }
        this.fadeOverlay.alpha = Math.max(0, Math.min(1, from + (cue.alpha - from) * event.progress));
        if (event.progress >= 1) this.#timelineValueStarts.delete(cue);
      } else if (cue.action === 'tint' && typeof cue.color === 'number' && typeof cue.alpha === 'number') {
        let from = this.#timelineTintStarts.get(cue);
        if (!from) {
          const alpha = this.#tintOverlay.alpha;
          from = { color: alpha <= 0.001 ? cue.color & 0xffffff : Number(this.#tintOverlay.tint ?? 0), alpha };
          this.#timelineTintStarts.set(cue, from);
        }
        this.#tintOverlay.tint = lerpColor(from.color, cue.color & 0xffffff, event.progress);
        this.#tintOverlay.alpha = Math.max(0, Math.min(1, from.alpha + (cue.alpha - from.alpha) * event.progress));
        this.#tintOverlay.visible = this.#tintOverlay.alpha > 0.001;
        if (event.progress >= 1) this.#timelineTintStarts.delete(cue);
      } else if (cue.action === 'flash' && event.started) this.flash(cue.durationMs);
      else if (cue.action === 'wipe' && event.started) this.wipe(cue.durationMs);
      return;
    }
    if (event.track === 'particle' && typeof cue.kind === 'string' && (event.started || event.final)) {
      if (cue.action === 'start') this.startParticles(cue.kind);
      else this.stopParticles();
    }
    this.#syncEffectRegistration();
  }

  snapshotPresentation(): WorldPresentationSnapshot {
    return {
      version: 1,
      backgroundKey: this.#backgroundKey,
      portraits: [...this.#portraitViews.entries()].map(([key, view]) => ({ key, view: { ...view } })),
      cameraScale: this.worldContainer.scale.x,
      cameraPan: { x: this.#cameraPanX, y: this.#cameraPanY },
      fadeAlpha: this.fadeOverlay.alpha,
      tint: { color: Number(this.#tintOverlay.tint ?? 0), alpha: this.#tintOverlay.alpha },
      particleKind: this.#particleKind,
    };
  }

  validatePresentation(snapshot: unknown): void {
    if (snapshot === null || snapshot === undefined) return;
    this.#prepareSnapshot(snapshot);
  }

  restorePresentation(snapshot: unknown): void {
    if (snapshot === null) return;
    const prepared = this.#prepareSnapshot(snapshot);
    this.#applyPreparedSnapshot(prepared);
    this.#requestFrame();
  }

  clearPresentation(): void {
    if (this.#disposed) return;
    this.#invalidatePreparation();
    this.#clearVisibleState();
    this.#requestFrame();
  }

  reset(options: { preserveWorld?: boolean } = {}): void {
    if (this.#disposed) return;
    const preserveWorld = options.preserveWorld === true;
    this.#invalidatePreparation();
    if (!preserveWorld) {
      this.#clearPortraits();
      this.#clearBackground();
    } else {
      this.#stopBackgroundTransition();
      this.#portraitTweens = [];
      this.#moveTweens = [];
    }
    this.#clearEffects({ preserveWorld });
    this.#activeSpeakerId = null;
    if (preserveWorld) this.setPortraitFocus(null);
    this.#requestFrame();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation.dispose();
    this.#clearVisibleState();
    this.#worldEffects.destroy();
    this.#frameRequest = null;
    try {
      this.#lifecycle.releaseOwner('world');
    } finally {
      if (this.#ownsLifecycle) this.#lifecycle.dispose();
    }
  }

  #applyPostProcess(): void {
    const enabled = this.#postProcess.enabled && this.#quality.settings.postProcess;
    if (!enabled || typeof document === 'undefined') {
      this.worldContainer.filters = null;
      return;
    }
    this.#colorMatrix ??= new ColorMatrixFilter();
    this.#colorMatrix.reset();
    this.#colorMatrix.saturate(this.#postProcess.saturation - 1, false);
    this.#colorMatrix.brightness(this.#postProcess.brightness, false);
    this.#colorMatrix.contrast(this.#postProcess.contrast, false);
    this.worldContainer.filters = [this.#colorMatrix];
  }

  #resolveBackground(key: string): Texture {
    return this.#assets.resolveBackground(key)
      ?? this.#assets.getOrCreateBackground(key, () => this.#createBackgroundTexture(key, this.#w, this.#h));
  }

  #createBackgroundSprite(texture: Texture): Sprite {
    const sprite = new Sprite(texture);
    const scale = Math.max(this.#w / Math.max(1, texture.width), this.#h / Math.max(1, texture.height));
    sprite.width = texture.width * scale;
    sprite.height = texture.height * scale;
    sprite.position.set((this.#w - sprite.width) / 2, (this.#h - sprite.height) / 2);
    sprite.alpha = 1;
    return sprite;
  }

  #startTimelineBackground(key: string, durationMs: number): void {
    if (this.#backgroundKey === key && this.#backgroundSprite) return;
    this.#stopBackgroundTransition();
    const next = this.#createBackgroundSprite(this.#resolveBackground(key));
    next.alpha = 0;
    const old = this.#backgroundSprite;
    this.#backgroundKey = key;
    this.#backgroundSprite = next;
    this.#backgroundLayer.addChild(next);
    if (!old || durationMs <= 0) {
      old?.destroy();
      next.alpha = 1;
      return;
    }
    this.#backgroundTransition = { old, neu: next, remain: Math.max(1, durationMs), dur: Math.max(1, durationMs) };
    this.#ensureEffectRegistration();
  }

  #stopBackgroundTransition(): void {
    const transition = this.#backgroundTransition;
    if (!transition) return;
    if (transition.old?.parent) transition.old.parent.removeChild(transition.old);
    transition.old?.destroy();
    this.#backgroundTransition = null;
    this.#syncEffectRegistration();
  }

  #createPortraitSprite(texture: Texture, x: number, height: number, view: PortraitView): Sprite {
    const sprite = new Sprite(texture);
    sprite.width = Math.min(430, this.#w * 0.36);
    sprite.height = height;
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, this.#h + 10);
    sprite.alpha = this.#portraitAlpha(view);
    return sprite;
  }

  #portraitAlpha(view: PortraitView | undefined): number {
    return !this.#activeSpeakerId || view?.charId === this.#activeSpeakerId ? 1 : 0.46;
  }

  #detachPortraitSprites(removed: ReadonlySet<Sprite>): void {
    this.#moveTweens = this.#moveTweens.filter((tween) => !removed.has(tween.sprite));
    const orphaned = new Set<Sprite>();
    this.#portraitTweens = this.#portraitTweens.filter((tween) => {
      if (!removed.has(tween.old) && !removed.has(tween.neu)) return true;
      if (!removed.has(tween.old)) orphaned.add(tween.old);
      if (!removed.has(tween.neu)) orphaned.add(tween.neu);
      return false;
    });
    const live = new Set(this.#portraitSprites.values());
    for (const sprite of orphaned) {
      if (live.has(sprite) || removed.has(sprite)) continue;
      if (sprite.parent) sprite.parent.removeChild(sprite);
      sprite.destroy();
    }
  }

  #updateTransient(deltaMs: number): void {
    if (this.#tintRemain > 0) {
      this.#tintRemain = Math.max(0, this.#tintRemain - deltaMs);
      const progress = 1 - this.#tintRemain / this.#tintDur;
      const alpha = this.#tintFrom.alpha + (this.#tintTo.alpha - this.#tintFrom.alpha) * progress;
      this.#tintOverlay.tint = lerpColor(this.#tintFrom.color, this.#tintTo.color, progress);
      this.#tintOverlay.alpha = alpha;
      if (this.#tintRemain === 0 && alpha <= 0.001) this.#tintOverlay.visible = false;
    }
    if (this.#moveTweens.length > 0) {
      for (let index = this.#moveTweens.length - 1; index >= 0; index--) {
        const tween = this.#moveTweens[index]!;
        tween.remain = Math.max(0, tween.remain - deltaMs);
        const progress = 1 - tween.remain / tween.dur;
        tween.sprite.x = tween.fromX + (tween.toX - tween.fromX) * progress;
        if (tween.remain === 0) this.#moveTweens.splice(index, 1);
      }
    }
    if (this.#particles.length > 0) {
      const frames = deltaMs / 16.667;
      for (const particle of this.#particles) {
        particle.phase += 0.02 * frames;
        particle.sprite.x += (particle.vx + Math.sin(particle.phase) * (this.#particlePreset?.sway ?? 0)) * frames;
        particle.sprite.y += particle.vy * frames;
        if (particle.sprite.y > this.#h + 12) {
          particle.sprite.y = -10;
          particle.sprite.x = Math.random() * this.#w;
        } else if (particle.sprite.y < -14) {
          particle.sprite.y = this.#h + 10;
          particle.sprite.x = Math.random() * this.#w;
        }
        if (particle.sprite.x > this.#w + 12) particle.sprite.x = -10;
        else if (particle.sprite.x < -12) particle.sprite.x = this.#w + 10;
      }
    }
    if (this.#portraitTweens.length > 0) {
      const done: { old: Sprite; neu: Sprite; remain: number; dur: number }[] = [];
      for (const tween of this.#portraitTweens) {
        tween.remain = Math.max(0, tween.remain - deltaMs);
        const progress = 1 - tween.remain / tween.dur;
        tween.neu.alpha = progress;
        tween.old.alpha = 1 - progress;
        if (tween.remain === 0) done.push(tween);
      }
      for (const tween of done) {
        this.#portraitLayer.removeChild(tween.old);
        tween.old.destroy();
        this.#portraitTweens.splice(this.#portraitTweens.indexOf(tween), 1);
      }
    }
    if (this.#wipeRemain > 0) {
      this.#wipeRemain = Math.max(0, this.#wipeRemain - deltaMs);
      const progress = 1 - this.#wipeRemain / this.#wipeDur;
      this.wipeOverlay.position.set(-this.#w + progress * this.#w * 2, 0);
      if (this.#wipeRemain === 0) {
        this.wipeOverlay.visible = false;
        this.wipeOverlay.position.set(0, 0);
      }
    }
  }

  #tintCurrent(): { color: number; alpha: number } {
    if (this.#tintRemain <= 0) return { ...this.#tintTo };
    const progress = 1 - this.#tintRemain / this.#tintDur;
    return {
      color: lerpColor(this.#tintFrom.color, this.#tintTo.color, progress),
      alpha: this.#tintFrom.alpha + (this.#tintTo.alpha - this.#tintFrom.alpha) * progress,
    };
  }

  #particlePosition(pos: string): number | null {
    if (pos === 'left') return this.#w * 0.25;
    if (pos === 'right') return this.#w * 0.75;
    if (pos === 'center') return this.#w * 0.5;
    const number = Number(pos);
    return Number.isFinite(number) ? number : null;
  }

  #resolvePortraitX(pos: string): number | null { return this.#particlePosition(pos); }

  #zoomBaseOffset(): { x: number; y: number } {
    const scale = this.worldContainer.scale.x;
    return { x: ((1 - scale) * this.#w) / 2 + this.#cameraPanX, y: ((1 - scale) * this.#h) / 2 + this.#cameraPanY };
  }

  #setWorldBasePosition(): void {
    const offset = this.#zoomBaseOffset();
    this.worldContainer.position.set(offset.x, offset.y);
  }

  #hasEffectWork(): boolean {
    return this.#worldEffects.needsUpdate
      || this.#flashRemain > 0
      || this.#zoomRemain > 0
      || this.#backgroundTransition !== null
      || this.#tintRemain > 0
      || this.#moveTweens.length > 0
      || this.#particles.length > 0
      || this.#portraitTweens.length > 0
      || this.#wipeRemain > 0;
  }

  #ensureEffectRegistration(): void {
    if (this.#disposed || this.#effectRegistered) return;
    this.#lifecycle.register('world', 'tween', 'presentation-effects', () => {
      this.#effectRegistered = false;
    });
    this.#effectRegistered = true;
  }

  #syncEffectRegistration(): void {
    if (!this.#hasEffectWork()) {
      this.#lifecycle.release('world', 'tween', 'presentation-effects');
      this.#effectRegistered = false;
    } else {
      this.#ensureEffectRegistration();
    }
  }

  #registerDisplay(key: string, display: Container | Graphics): void {
    this.#lifecycle.register('world', 'display', key, () => {
      if (display.parent) display.parent.removeChild(display as Container);
      display.destroy({ children: true });
    });
  }

  #requestFrame(): void {
    if (this.#disposed) return;
    this.#requestFrameCallback?.();
    this.#frameRequest?.();
  }

  #invalidatePreparation(): void {
    if (this.#disposed) return;
    this.#generation.advance();
  }

  #clearPortraits(): void {
    const all = new Set<Sprite>([
      ...this.#portraitSprites.values(),
      ...this.#portraitTweens.flatMap((tween) => [tween.old, tween.neu]),
    ]);
    for (const sprite of all) {
      if (sprite.parent) sprite.parent.removeChild(sprite);
      sprite.destroy();
    }
    this.#portraitSprites.clear();
    this.#portraitViews.clear();
    this.#portraitTweens = [];
    this.#moveTweens = [];
  }

  #clearBackground(): void {
    this.#stopBackgroundTransition();
    if (this.#backgroundSprite) {
      if (this.#backgroundSprite.parent) this.#backgroundSprite.parent.removeChild(this.#backgroundSprite);
      this.#backgroundSprite.destroy();
    }
    this.#backgroundSprite = null;
    this.#backgroundKey = null;
  }

  #clearEffects(options: { preserveWorld: boolean }): void {
    this.#timelineMoveStarts.clear();
    this.#timelineValueStarts.clear();
    this.#timelinePanStarts.clear();
    this.#timelineTintStarts.clear();
    this.#cameraPanX = 0;
    this.#cameraPanY = 0;
    this.worldContainer.position.set(0, 0);
    this.worldContainer.scale.set(1);
    this.#worldEffects.reset();
    this.#flashRemain = 0;
    this.#flashDur = 1;
    this.flashOverlay.alpha = 0;
    this.#zoomFrom = 1;
    this.#zoomTo = 1;
    this.#zoomRemain = 0;
    this.#wipeRemain = 0;
    this.wipeOverlay.visible = false;
    this.wipeOverlay.position.set(0, 0);
    this.#tintRemain = 0;
    this.#tintFrom = { color: 0x000000, alpha: 0 };
    this.#tintTo = { color: 0x000000, alpha: 0 };
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.stopParticles();
    if (!options.preserveWorld) this.setPortraitFocus(null);
    this.fadeOverlay.alpha = 0;
    this.#syncEffectRegistration();
  }

  #clearVisibleState(): void {
    const activeSpeakerId = this.#activeSpeakerId;
    this.#clearPortraits();
    this.#clearBackground();
    this.#clearEffects({ preserveWorld: false });
    this.#activeSpeakerId = activeSpeakerId;
    this.#syncEffectRegistration();
  }

  #prepareSnapshot(snapshot: unknown): WorldPresentationSnapshot {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) throw invalidSnapshot('Presentation snapshot must be an object');
    const raw = snapshot as Record<string, unknown>;
    if (raw.version !== 1) throw invalidSnapshot('Presentation snapshot version must be 1');
    if (!(raw.backgroundKey === null || typeof raw.backgroundKey === 'string')) throw invalidSnapshot('backgroundKey is invalid');
    if (!Array.isArray(raw.portraits)) throw invalidSnapshot('portraits must be an array');
    const portraits: { key: string; view: PortraitView }[] = [];
    for (const item of raw.portraits) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) throw invalidSnapshot('portrait record is invalid');
      const record = item as Record<string, unknown>;
      const view = record.view;
      if (typeof record.key !== 'string' || record.key.length === 0 || typeof view !== 'object' || view === null || Array.isArray(view)) throw invalidSnapshot('portrait record is invalid');
      const candidate = view as Record<string, unknown>;
      if (![candidate.charId, candidate.costume, candidate.expression, candidate.pos].every((value) => typeof value === 'string')) throw invalidSnapshot('portrait view is invalid');
      portraits.push({ key: record.key, view: { charId: candidate.charId as string, costume: candidate.costume as string, expression: candidate.expression as string, pos: candidate.pos as string } });
    }
    if (!finiteNumber(raw.cameraScale) || raw.cameraScale < 0.25 || raw.cameraScale > 4) throw invalidSnapshot('cameraScale is outside bounds');
    if (typeof raw.cameraPan !== 'object' || raw.cameraPan === null || Array.isArray(raw.cameraPan)) throw invalidSnapshot('cameraPan is invalid');
    const pan = raw.cameraPan as Record<string, unknown>;
    if (!finiteNumber(pan.x) || !finiteNumber(pan.y) || Math.abs(pan.x) > 2000 || Math.abs(pan.y) > 2000) throw invalidSnapshot('cameraPan is outside bounds');
    if (!finiteNumber(raw.fadeAlpha) || raw.fadeAlpha < 0 || raw.fadeAlpha > 1) throw invalidSnapshot('fadeAlpha is outside bounds');
    if (typeof raw.tint !== 'object' || raw.tint === null || Array.isArray(raw.tint)) throw invalidSnapshot('tint is invalid');
    const tint = raw.tint as Record<string, unknown>;
    if (!finiteNumber(tint.color) || tint.color < 0 || tint.color > 0xffffff || !Number.isInteger(tint.color) || !finiteNumber(tint.alpha) || tint.alpha < 0 || tint.alpha > 1) throw invalidSnapshot('tint is outside bounds');
    if (!(raw.particleKind === null || (typeof raw.particleKind === 'string' && raw.particleKind in PARTICLE_PRESETS))) throw invalidSnapshot('particleKind is invalid');
    // Resolve every texture before touching visible state. A failure here leaves the old projection intact.
    if (typeof raw.backgroundKey === 'string') this.#resolveBackground(raw.backgroundKey);
    for (const record of portraits) {
      this.#assets.resolvePortrait(record.view.charId, record.view.costume, record.view.expression)
        ?? this.#assets.getOrCreatePortrait(`${record.view.charId}:${record.view.costume}:${record.view.expression}`, () => makeFallbackPortraitTexture(record.view.charId, record.view.costume, record.view.expression));
    }
    return {
      version: 1,
      backgroundKey: raw.backgroundKey,
      portraits,
      cameraScale: raw.cameraScale,
      cameraPan: { x: pan.x, y: pan.y },
      fadeAlpha: raw.fadeAlpha,
      tint: { color: tint.color, alpha: tint.alpha },
      particleKind: raw.particleKind,
    };
  }

  #applyPreparedSnapshot(snapshot: WorldPresentationSnapshot): void {
    this.#invalidatePreparation();
    this.#clearVisibleState();
    if (snapshot.backgroundKey !== null) this.setBackground(snapshot.backgroundKey);
    for (const record of snapshot.portraits) this.setPortrait(record.key, record.view);
    this.worldContainer.scale.set(snapshot.cameraScale);
    this.#cameraPanX = snapshot.cameraPan.x;
    this.#cameraPanY = snapshot.cameraPan.y;
    this.#setWorldBasePosition();
    this.fadeOverlay.alpha = snapshot.fadeAlpha;
    this.#tintOverlay.tint = snapshot.tint.color;
    this.#tintOverlay.alpha = snapshot.tint.alpha;
    this.#tintOverlay.visible = snapshot.tint.alpha > 0.001;
    if (snapshot.particleKind !== null) this.startParticles(snapshot.particleKind);
  }
}
