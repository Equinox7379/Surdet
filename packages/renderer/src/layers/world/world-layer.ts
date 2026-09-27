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
import type { ProjectStage, StageCommand, StageLayerDefinition, StagePose, StageGeometryPolicy, StageSource, StageInspection } from '../../stage-geometry.js';
import { StageMotionController, prepareStageMotions, lerpColor, type StageMotionSnapshot, type StageProperty, type StageValues } from '../../stage-motion.js';
import { PortraitVisualPlayer, PortraitVisualRoot, validatePortraitAnimation } from '../../portrait-visual-player.js';
type PortraitDisplay = Sprite | PortraitVisualRoot;

export interface WorldPresentationSnapshot {
  version: 1 | 2;
  design?: { width: number; height: number };
  layers?: readonly StageLayerDefinition[];
  motions?: StageMotionSnapshot;
  stageConfigKey?: string;
  objectSources?: [string, StageSource][];
  transitions?: {
    background?: { oldKey: string; remain: number; duration: number };
    portraits: { key: string; oldView: PortraitView; remain: number; duration: number }[];
  };
  activeSpeakerId?: string | null;
  speaking?: boolean;
  portraitSkipping?: boolean;
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
  readonly stage?: ProjectStage | null;
  readonly stageGeometry?: StageGeometryPolicy;
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
  readonly #environmentLayer = new Container();
  readonly #portraitLayer = new Container();
  readonly #foregroundLayer = new Container();
  readonly #stage: ProjectStage | null;
  readonly #stageGeometry?: StageGeometryPolicy;
  readonly #objectSources = new Map<string, StageSource>();
  readonly #stageLayers = new Map<string, { definition: StageLayerDefinition; sprite: Sprite }>();
  readonly #stageMotions = new StageMotionController((target, property) => this.#readStageProperty(target, property),
    (target, patch) => this.#writeStageProperties(target, patch));
  readonly #tintOverlay: Graphics;
  readonly #worldEffects: WorldEffectsController;
  #backgroundSprite: Sprite | null = null;
  #backgroundKey: string | null = null;
  #backgroundTransition: { old: Sprite | null; oldKey: string | null; neu: Sprite; remain: number; dur: number } | null = null;
  #portraitSprites = new Map<string, PortraitDisplay>();
  #portraitViews = new Map<string, PortraitView>();
  #portraitPlayers = new Map<PortraitDisplay, PortraitVisualPlayer>();
  #speaking = false;
  #portraitSkipping = false;
  readonly #portraitFrames = new WeakMap<PortraitDisplay, import('@surdet/core').StageRect>();
  #portraitTweens: { key: string; old: PortraitDisplay; neu: PortraitDisplay; remain: number; dur: number; oldView?: PortraitView }[] = [];
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
  #particleKind: string | null = null;
  #particlePreset: ParticlePreset | null = null;
  #particles: { sprite: Graphics; vx: number; vy: number; phase: number }[] = [];
  #moveTweens: { key: string; pos: string; sprite: PortraitDisplay; fromX: number; toX: number; remain: number; dur: number }[] = [];
  #timelineMoveStarts = new Map<object, Map<string, number>>();
  #timelineValueStarts = new Map<object, number>();
  #timelinePanStarts = new Map<object, { x: number; y: number }>();
  #timelineTintStarts = new Map<object, { color: number; alpha: number }>();

  constructor(options: WorldLayerOptions) {
    this.#stageGeometry = options.stageGeometry;
    if (options.stage && !options.stageGeometry) throw new Error('Stage project geometry policy is required');
    this.#w = options.width;
    this.#h = options.height;
    this.#stage = options.stage == null ? null : this.#geometry().parseProjectStage(options.stage);
    if (this.#stage && (this.#stage.design.width !== this.#w || this.#stage.design.height !== this.#h)) throw new Error('舞台设计画布与 Runtime 尺寸不一致');
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#requestFrameCallback = options.requestFrame;
    this.#captureThumbnailCallback = options.captureThumbnail;
    this.#createBackgroundTexture = options.createBackgroundTexture ?? makeWorldBackgroundTexture;

    this.worldContainer = new Container();
    this.#portraitLayer.sortableChildren = true;
    this.#environmentLayer.sortableChildren = true;
    this.#foregroundLayer.sortableChildren = true;
    this.worldContainer.addChild(this.#backgroundLayer, this.#environmentLayer, this.#portraitLayer, this.#foregroundLayer);
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
    for (const [sprite, player] of this.#portraitPlayers) {
      const view = [...this.#portraitSprites].find(([, value]) => value === sprite)?.[0];
      const charId = view ? this.#portraitViews.get(view)?.charId : this.#portraitTweens.find(tween => tween.old === sprite)?.oldView?.charId;
      player.advance(deltaMs, this.#speaking && charId === this.#activeSpeakerId, !this.#presentation.reducedMotion, this.#portraitSkipping);
    }
    this.#stageMotions.update(deltaMs);
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
    for (const player of this.#portraitPlayers.values()) player.project(!this.#presentation.reducedMotion, this.#portraitSkipping);
    this.#syncEffectRegistration();
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

  setPortraitSpeaking(speaking: boolean): void {
    if (this.#speaking === speaking) return;
    this.#speaking = speaking;
    this.#syncPortraitSpeaking();
  }

  setPortraitSkipping(skipping: boolean): void {
    if (this.#portraitSkipping === skipping) return;
    this.#portraitSkipping = skipping; this.#syncPortraitSpeaking();
  }

  #syncPortraitSpeaking(): void {
    for (const [key, sprite] of this.#portraitSprites) this.#portraitPlayers.get(sprite)?.advance(0,
      this.#speaking && this.#portraitViews.get(key)?.charId === this.#activeSpeakerId, !this.#presentation.reducedMotion, this.#portraitSkipping);
    this.#syncEffectRegistration(); this.#requestFrame();
  }

  setPortraitFocus(characterId: string | null): void {
    if (this.#disposed) return;
    this.#activeSpeakerId = characterId;
    this.#syncPortraitSpeaking();
    for (const [key, sprite] of this.#portraitSprites) {
      sprite.tint = this.#portraitTint(this.#portraitViews.get(key));
    }
    for (const tween of this.#portraitTweens) {
      tween.old.tint = tween.neu.tint = this.#portraitTint(this.#portraitViews.get(tween.key));
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

  #geometry(): StageGeometryPolicy {
    if (!this.#stageGeometry) throw invalidSnapshot('This World instance does not support project stage data');
    return this.#stageGeometry;
  }

  #effectiveStage(): ProjectStage {
    return this.#stage ?? this.#geometry().parseProjectStage({ version: 1, design: { width: this.#w, height: this.#h } });
  }

  #actorKeys(target: string): string[] {
    return this.#portraitViews.has(target) ? [target]
      : [...this.#portraitViews.keys()].filter(key => key.startsWith(`${target}:`));
  }

  #readPose(key: string): StagePose {
    const view = this.#portraitViews.get(key), sprite = this.#portraitSprites.get(key);
    if (!view || !sprite) throw new Error(`舞台对象不存在：${key}`);
    if (view.pose) return { ...view.pose };
    return { x: sprite.x, y: sprite.y, scale: 1, facing: 'right', opacity: this.#portraitTweens.some(tween => tween.key === key) ? 1 : sprite.alpha, z: sprite.zIndex,
      baseHeight: Math.max(1, sprite.height), anchorX: .5, anchorY: 1 };
  }

  #promotePortrait(key: string): void {
    const view = this.#portraitViews.get(key), sprite = this.#portraitSprites.get(key);
    if (!view || !sprite || view.pose) return;
    const pose = this.#readPose(key);
    const frame = { x: 0, y: 0, width: sprite.texture.width, height: sprite.texture.height };
    this.#portraitViews.set(key, { ...view, pose, frame });
    this.#portraitFrames.set(sprite, frame);
    for (const tween of this.#portraitTweens) if (tween.key === key && tween.oldView) {
      const oldFrame = { x: 0, y: 0, width: tween.old.texture.width, height: tween.old.texture.height };
      tween.oldView = { ...tween.oldView, pose: { ...pose }, frame: oldFrame };
      this.#portraitFrames.set(tween.old, oldFrame);
    }
  }

  #explicitPoseValues(modifiers: ReadonlyMap<string, string>, pose: StagePose): StageValues {
    const names = new Set<keyof StagePose>();
    if (modifiers.has('pos')) {
      names.add('x');
      if (Object.prototype.hasOwnProperty.call(this.#effectiveStage().positions, modifiers.get('pos')!)) names.add('y');
    }
    if (modifiers.has('distance')) names.add('scale');
    if (modifiers.has('alpha')) names.add('opacity');
    for (const name of ['x', 'y', 'scale', 'opacity', 'z', 'facing', 'baseHeight', 'anchorX', 'anchorY'] as const) if (modifiers.has(name)) names.add(name);
    return Object.fromEntries([...names].map(name => [name, pose[name]]));
  }

  #promoteMove(key: string): void {
    const tween = this.#moveTweens.find(value => value.key === key);
    this.#moveTweens = this.#moveTweens.filter(value => value.key !== key);
    if (tween) this.#stageMotions.start(`portrait:${key}`, { x: tween.toX }, tween.remain, 'linear');
  }

  applyStage(command: StageCommand): void {
    if (this.#disposed) return;
    if (command.type === 'finish-timeline') { this.#stageMotions.releaseTimeline(command.runId); return; }
    if (command.type === 'skip-motions') { this.#stageMotions.skip(); this.#requestFrame(); return; }
    if (command.type === 'clear') {
      this.#invalidatePreparation(); this.#clearVisibleState(true); this.#requestFrame(); return;
    }
    const stage = this.#effectiveStage();
    if (command.source && !this.#geometry().validStageSource(command.source)) throw new Error('Invalid stage source');
    if (command.type === 'show') {
      const separator = command.target.indexOf(':');
      const charId = separator < 0 ? command.target : command.target.slice(0, separator);
      const costume = separator < 0 ? 'normal' : command.target.slice(separator + 1);
      const key = command.instance ?? command.target;
      if (!key.trim() || key.trim() !== key || /[\u0000-\u001f]/.test(key)) throw new Error('舞台实例 ID 无效');
      const modifiers = new Map(Object.entries(command.modifiers ?? {}));
      if (command.legacy && !this.#stage && command.instance === undefined && !this.#portraitViews.get(key)?.pose
        && [...modifiers.keys()].every(name => name === 'pos')) {
        this.setPortrait(key, { charId, costume, expression: command.expression, pos: modifiers.get('pos') ?? 'center' });
        if (command.source) this.#objectSources.set(`portrait:${key}`, command.source);
        return;
      }
      if (!this.#assets.resolvePortrait(charId, costume, command.expression)) throw new Error(`舞台立绘未注册：${command.target}:${command.expression}`);
      const current = this.#portraitViews.has(key) ? this.#readPose(key) : undefined;
      const pose = this.#geometry().stagePoseFromModifiers(stage, `${charId}:${costume}`, modifiers, current);
      const values = this.#explicitPoseValues(modifiers, pose);
      if (current) this.#promoteMove(key);
      this.setPortrait(key, { charId, costume, expression: command.expression,
        pos: modifiers.get('pos') ?? this.#portraitViews.get(key)?.pos ?? 'center', pose });
      if (command.source) this.#objectSources.set(`portrait:${key}`, command.source);
      if (!current) this.#stageMotions.start(`portrait:${key}`, pose, 0, 'linear', command.source);
      else if (Object.keys(values).length) this.#stageMotions.start(`portrait:${key}`, values, 0, 'linear', command.source);
    } else if (command.type === 'pose') {
      const keys = this.#actorKeys(command.target);
      if (!keys.length) throw new Error(`舞台对象不存在：${command.target}`);
      const modifiers = new Map(Object.entries(command.modifiers));
      const prepared = keys.map(key => {
        const view = this.#portraitViews.get(key)!;
        const pose = this.#geometry().stagePoseFromModifiers(stage, `${view.charId}:${view.costume}`, modifiers, this.#readPose(key));
        const values = this.#explicitPoseValues(modifiers, pose);
        if (!Object.keys(values).length) throw new Error('舞台变换至少需要一个明确属性');
        return { key, values };
      });
      const duration = command.durationMs ?? 0;
      if (!Number.isFinite(duration) || duration < 0 || duration > 600_000) throw new Error('舞台时长超出范围');
      for (const item of prepared) {
        this.#promoteMove(item.key);
        this.#stageMotions.start(`portrait:${item.key}`, item.values, duration === 0 ? 0 : presentationDuration(duration, this.#presentation), command.easing ?? 'linear', command.source);
      }
    } else if (command.type === 'layer') {
      this.#setStageLayer(this.#geometry().parseStageLayer(command.definition));
      if (command.source) this.#objectSources.set(`layer:${command.definition.id}`, command.source);
    } else if (command.type === 'layer-pose') {
      const entry = this.#stageLayers.get(command.id);
      if (!entry) throw new Error(`舞台图层不存在：${command.id}`);
      const values: StageValues = {};
      for (const [name, raw] of Object.entries(command.modifiers)) {
        if (!['x', 'y', 'scale', 'opacity', 'alpha', 'z'].includes(name)) throw new Error(`图层不支持属性 ${name}`);
        values[name === 'alpha' ? 'opacity' : name as StageProperty] = raw.trim() ? Number(raw) : NaN;
      }
      this.#geometry().parseStageLayer({ ...entry.definition, ...values });
      this.#stageMotions.start(`layer:${command.id}`, values, !command.durationMs ? 0 : presentationDuration(command.durationMs, this.#presentation), command.easing ?? 'linear', command.source);
    } else if (command.type === 'remove-layer') {
      this.#removeStageLayer(command.id);
    } else if (command.type === 'composition') {
      const composition = Object.prototype.hasOwnProperty.call(stage.compositions, command.id) ? stage.compositions[command.id] : undefined;
      if (!composition) throw new Error(`场景构图不存在：${command.id}`);
      if (composition.background != null && !this.#assets.resolveBackground(composition.background)) throw new Error(`构图背景未注册：${composition.background}`);
      for (const layer of composition.layers ?? []) if (!this.#assets.resolveBackground(layer.key)) throw new Error(`构图图层素材未注册：${layer.key}`);
      // Every referenced image is checked before replacing current visible state.
      if (composition.layers !== undefined) this.#clearStageLayers();
      if (!(command.keepActors ?? composition.keepActors)) this.#clearPortraits();
      if (composition.background !== undefined) this.setBackground(composition.background);
      if (composition.resetCamera) { this.#stageMotions.cancel('camera'); this.#zoomRemain = 0; this.worldContainer.scale.set(1); this.#cameraPanX = this.#cameraPanY = 0; this.#setWorldBasePosition(); }
      for (const layer of composition.layers ?? []) { this.#setStageLayer(layer); this.#objectSources.set(`layer:${layer.id}`, { kind: 'composition', id: command.id }); }
    }
    this.#invalidatePreparation();
    this.#syncEffectRegistration();
    this.#requestFrame();
  }

  #setStageLayer(definition: StageLayerDefinition): void {
    const texture = this.#assets.resolveBackground(definition.key);
    if (!texture) throw new Error(`图层素材未注册：${definition.key}`);
    if (!this.#stageLayers.has(definition.id) && this.#stageLayers.size >= 64) throw new Error('同时显示的独立图层不能超过 64 个');
    const sprite = new Sprite(texture);
    const entry = { definition: { ...definition }, sprite };
    this.#removeStageLayer(definition.id);
    this.#stageLayers.set(definition.id, entry);
    (definition.band === 'foreground' ? this.#foregroundLayer : this.#environmentLayer).addChild(sprite);
    this.#projectStageLayer(entry);
  }
  #projectStageLayer(entry: { definition: StageLayerDefinition; sprite: Sprite }): void {
    const { definition: layer, sprite } = entry;
    const scale = this.worldContainer.scale.x;
    sprite.position.set(layer.x + (layer.parallax - 1) * this.#cameraPanX / scale,
      layer.y + (layer.parallax - 1) * this.#cameraPanY / scale);
    sprite.scale.set(layer.scale); sprite.alpha = layer.opacity; sprite.zIndex = layer.z;
  }
  #removeStageLayer(id: string): void {
    const entry = this.#stageLayers.get(id);
    if (entry) { entry.sprite.parent?.removeChild(entry.sprite); entry.sprite.destroy(); this.#stageLayers.delete(id); }
    this.#stageMotions.cancel(`layer:${id}`); this.#objectSources.delete(`layer:${id}`);
  }
  #clearStageLayers(): void { for (const id of [...this.#stageLayers.keys()]) this.#removeStageLayer(id); }

  #readStageProperty(target: string, property: StageProperty): number | string {
    if (target === 'screen:fade') return this.fadeOverlay.alpha;
    if (target === 'screen:tint') return property === 'color' ? Number(this.#tintOverlay.tint) : this.#tintOverlay.alpha;
    if (target === 'camera') {
      if (property === 'x') return this.#cameraPanX;
      if (property === 'y') return this.#cameraPanY;
      if (property === 'scale') return this.worldContainer.scale.x;
      throw new Error(`相机不支持 ${property}`);
    }
    if (target.startsWith('portrait:') && property !== 'color') return this.#readPose(target.slice(9))[property];
    const layer = this.#stageLayers.get(target.slice(6));
    const value = layer?.definition[property as keyof StageLayerDefinition];
    if (typeof value !== 'number') throw new Error(`图层对象或属性不存在：${target}.${property}`);
    return value;
  }
  #writeStageProperties(target: string, patch: StageValues): void {
    if (target === 'screen:fade') { this.fadeOverlay.alpha = Number(patch.opacity); return; }
    if (target === 'screen:tint') {
      if (patch.opacity !== undefined) this.#tintOverlay.alpha = Number(patch.opacity);
      if (patch.color !== undefined) this.#tintOverlay.tint = Number(patch.color);
      this.#tintOverlay.visible = this.#tintOverlay.alpha > .001;
      return;
    }
    if (target === 'camera') {
      if (patch.x !== undefined) this.#cameraPanX = Number(patch.x);
      if (patch.y !== undefined) this.#cameraPanY = Number(patch.y);
      if (patch.scale !== undefined) this.worldContainer.scale.set(Number(patch.scale));
      this.#setWorldBasePosition(); return;
    }
    if (target.startsWith('portrait:')) {
      const key = target.slice(9);
      this.#promotePortrait(key);
      const view = this.#portraitViews.get(key);
      if (!view) return;
      const pose = this.#geometry().validateStagePose({ ...this.#readPose(key), ...patch });
      const next = { ...view, pose };
      this.#portraitViews.set(key, next);
      const sprite = this.#portraitSprites.get(key);
      if (sprite) this.#projectPortraitPose(sprite, next);
      for (const tween of this.#portraitTweens) if (tween.key === key) {
        if (tween.oldView) tween.oldView = { ...tween.oldView, pose: { ...pose } };
        this.#projectPortraitPose(tween.old, next); this.#projectPortraitPose(tween.neu, next);
        const p = 1 - tween.remain / tween.dur;
        tween.old.alpha = pose.opacity * (1 - p); tween.neu.alpha = pose.opacity * p;
      }
    } else {
      const layer = this.#stageLayers.get(target.slice(6));
      if (!layer) return;
      layer.definition = this.#geometry().parseStageLayer({ ...layer.definition, ...patch });
      this.#projectStageLayer(layer);
    }
  }
  #projectPortraitPose(sprite: PortraitDisplay, view: PortraitView): void {
    if (!view.pose) return;
    const pose = view.pose;
    const frame = this.#portraitFrames.get(sprite) ?? view.frame ?? { x: 0, y: 0, width: sprite.texture.width, height: sprite.texture.height };
    const scale = pose.baseHeight / frame.height * pose.scale;
    sprite.anchor.set((frame.x + frame.width * pose.anchorX) / sprite.texture.width,
      (frame.y + frame.height * pose.anchorY) / sprite.texture.height);
    sprite.scale.set(pose.facing === 'left' ? -scale : scale, scale);
    sprite.position.set(pose.x, pose.y); sprite.alpha = pose.opacity; sprite.zIndex = pose.z;
    this.#portraitPlayers.get(sprite)?.syncAnchor();
  }

  setPortrait(key: string, view: PortraitView): void {
    if (this.#disposed) return;
    const texture = this.#assets.resolvePortrait(view.charId, view.costume, view.expression)
      ?? this.#assets.getOrCreatePortrait(`${view.charId}:${view.costume}:${view.expression}`, () => makeFallbackPortraitTexture(view.charId, view.costume, view.expression));
    let previous = this.#portraitViews.get(key);
    const visual = this.#assets.resolvePortraitVisual(view.charId, view.costume, view.expression);
    if (visual && !view.pose) {
      if (previous && !previous.pose) { this.#promotePortrait(key); previous = this.#portraitViews.get(key); }
      view = { ...view, pose: previous?.pose ?? this.#geometry().stagePoseFromModifiers(this.#effectiveStage(),
        `${view.charId}:${view.costume}`, new Map([['pos', view.pos]])) };
    }
    if (view.animation) {
      if (!visual) throw new Error('静态立绘不能恢复动态播放状态');
      validatePortraitAnimation(visual, view.animation);
    }
    if (view.pose || previous?.pose) {
      const pose = this.#geometry().validateStagePose(view.pose ?? previous!.pose);
      const profile = this.#stage?.portraits[`${view.charId}:${view.costume}`];
      const pin = profile?.sources[view.expression];
      if (pin) {
        const actual = this.#assets.resolvePortraitIdentity(view.charId, view.costume, view.expression);
        if (!actual || actual.path !== pin.path || actual.sha256 !== pin.sha256 || actual.width !== pin.width || actual.height !== pin.height)
          throw new Error(`角色图片已经改变，需重新确认校准：${view.charId}:${view.costume}:${view.expression}`);
      }
      const frame = this.#geometry().validateStageFrame(view.frame ?? profile?.expressions[view.expression]
        ?? { x: 0, y: 0, width: texture.width, height: texture.height }, texture.width, texture.height);
      view = { ...view, pose, frame };
    }
    if (view.pose && previous && !previous.pose) {
      this.#promotePortrait(key);
      previous = this.#portraitViews.get(key);
    }
    this.#invalidatePreparation();
    this.#requestFrame();
    const { animation: _animation, ...liveView } = view;
    this.#portraitViews.set(key, { ...liveView, ...(view.pose ? { pose: { ...view.pose } } : {}), ...(view.frame ? { frame: { ...view.frame } } : {}) });
    const width = Math.min(this.#w * 0.48, this.#h * 1.28 * texture.width / Math.max(1, texture.height));
    const height = (texture.height / Math.max(1, texture.width)) * width;
    const x = this.#resolvePortraitX(view.pos) ?? this.#w * 0.5;
    const existing = this.#portraitSprites.get(key);
    if (!existing) {
      const sprite = this.#createPortraitSprite(texture, x, height, view);
      this.#portraitSprites.set(key, sprite);
      this.#portraitLayer.addChild(sprite);
      this.#syncEffectRegistration();
      return;
    }
    if (!view.animation && ((visual && this.#portraitPlayers.get(existing)?.asset === visual)
      || (!visual && !this.#portraitPlayers.has(existing) && existing.texture === texture))) {
      if (view.pose) {
        if (view.frame) this.#portraitFrames.set(existing, { ...view.frame });
        this.#projectPortraitPose(existing, view);
      } else existing.position.set(x, Math.max(this.#h + 10, existing.height + this.#h * 0.025));
      existing.tint = this.#portraitTint(view);
      return;
    }
    if (view.pose) {
      // One transition owns one actor's expression. A replacement supersedes the
      // old transition, not another actor that shares its texture.
      const stale = this.#portraitTweens.filter(tween => tween.key === key);
      this.#portraitTweens = this.#portraitTweens.filter(tween => tween.key !== key);
      for (const tween of stale) if (tween.old !== existing) { tween.old.parent?.removeChild(tween.old); this.#destroyPortrait(tween.old); }
      existing.alpha = view.pose.opacity;
    }
    const next = this.#createPortraitSprite(texture, x, height, view);
    next.alpha = 0;
    if (view.pose) this.#portraitLayer.addChildAt(next, this.#portraitLayer.getChildIndex(existing) + 1);
    else this.#portraitLayer.addChild(next);
    this.#portraitSprites.set(key, next);
    const dur = view.pose ? presentationDuration(260, this.#presentation) : 260;
    this.#portraitTweens.push({ key, old: existing, neu: next, remain: dur, dur,
      ...(previous ? { oldView: JSON.parse(JSON.stringify(previous)) as PortraitView } : {}) });
    this.#ensureEffectRegistration();
  }

  removePortrait(key: string): void {
    if (this.#disposed) return;
    this.#invalidatePreparation();
    this.#requestFrame();
    const keys = this.#portraitSprites.has(key)
      ? [key]
      : [...this.#portraitSprites.keys()].filter((candidate) => candidate === key || candidate.startsWith(`${key}:`));
    const removed = new Set<PortraitDisplay>();
    for (const candidate of keys) {
      const sprite = this.#portraitSprites.get(candidate);
      if (sprite) removed.add(sprite);
    }
    this.#detachPortraitSprites(removed);
    for (const candidate of keys) {
      const sprite = this.#portraitSprites.get(candidate);
      if (!sprite) continue;
      if (sprite.parent) sprite.parent.removeChild(sprite);
      this.#destroyPortrait(sprite);
      this.#portraitSprites.delete(candidate);
      this.#portraitViews.delete(candidate);
      this.#stageMotions.cancel(`portrait:${candidate}`); this.#objectSources.delete(`portrait:${candidate}`);
    }
    this.#syncEffectRegistration();
  }

  setFade(alpha: number): void {
    if (this.#disposed) return;
    const value = Math.max(0, Math.min(1, alpha));
    if (value === this.fadeOverlay.alpha && !this.#stageMotions.hasState) return;
    this.#stageMotions.start('screen:fade', { opacity: value });
    this.#requestFrame();
  }

  fade(from: number, to: number, durationMs: number): void {
    if (this.#disposed) return;
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('Invalid screen fade values or timing');
    }
    this.#stageMotions.start('screen:fade', { opacity: Math.max(0, Math.min(1, from)) });
    this.#stageMotions.start('screen:fade', { opacity: Math.max(0, Math.min(1, to)) }, durationMs, 'inOutQuad');
    this.#ensureEffectRegistration(); this.#requestFrame();
  }

  isFadeActive(): boolean { return this.#stageMotions.isActive('screen:fade'); }

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
    if (this.#stage || this.#stageMotions.hasSpatialState) {
      this.#zoomRemain = 0;
      this.#stageMotions.start('camera', { scale: Math.max(.25, Math.min(4, scale)) }, presentationDuration(durationMs, this.#presentation));
      this.#ensureEffectRegistration(); this.#requestFrame(); return;
    }
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
    if (this.#actorKeys(key).some(target => this.#portraitViews.get(target)?.pose)) {
      this.applyStage({ type: 'pose', target: key, modifiers: { pos }, durationMs });
      return;
    }
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
      this.#moveTweens.push({ key: candidate, pos, sprite, fromX: sprite.x, toX: targetX, remain: duration, dur: duration });
    }
    if (keys.length > 0) this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  setTint(color: number, alpha: number, durationMs = 400): void {
    if (this.#disposed) return;
    this.#stageMotions.start('screen:tint', { color: color & 0xffffff, opacity: Math.max(0, Math.min(1, alpha)) }, presentationDuration(durationMs, this.#presentation));
    this.#ensureEffectRegistration();
    this.#requestFrame();
  }

  clearTint(durationMs = 400): void {
    if (this.#disposed) return;
    this.#stageMotions.start('screen:tint', { opacity: 0 }, presentationDuration(durationMs, this.#presentation));
    this.#ensureEffectRegistration(); this.#requestFrame();
  }

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

  #applyOwnedTimelineFrame(event: TimelineFrameEvent): boolean {
    const cue = event.cue, target = event.target ?? '';
    const identity = `${event.runId}/${event.cueId ?? 0}`;
    if (this.#stageMotions.isCueCancelled(identity)) return true;
    if (event.track === 'screen' && (cue.action === 'fade' || cue.action === 'tint')) {
      if (cue.action === 'tint' && !this.#stageMotions.timelineTarget(identity)) {
        if (this.#tintOverlay.alpha <= .001) this.#tintOverlay.tint = Number(cue.color);
      }
      this.#stageMotions.timeline(identity, `screen:${cue.action}`, {
        opacity: Number(cue.alpha), ...(cue.action === 'tint' ? { color: Number(cue.color) } : {}),
      }, event.progress, event.source);
      return true;
    }
    // Legacy files retain their old pixel/layout interpretation until a new
    // pose or an explicit stage configuration opts this target into the new model.
    if (!this.#stage && event.definitionVersion !== 2 && !this.#stageMotions.hasSpatialState
      && !this.#actorKeys(target).some(key => this.#portraitViews.get(key)?.pose) && this.#stageLayers.size === 0) return false;
    const mods = new Map<string, string>();
    for (const name of ['x', 'y', 'scale', 'opacity', 'z', 'facing', 'baseHeight', 'anchorX', 'anchorY', 'distance'] as const)
      if (cue[name] !== undefined) mods.set(name, String(cue[name]));
    if (cue.position !== undefined) mods.set('pos', String(cue.position));
    if (event.track === 'portrait') {
      if (cue.action === 'show' && event.started) {
        const source = typeof cue.source === 'string' ? cue.source : target;
        const existed = this.#portraitViews.has(target);
        const desiredOpacity = mods.get('opacity') ?? (existed ? String(this.#readPose(target).opacity) : '1');
        this.applyStage({ type: 'show', target: source, expression: String(cue.expression ?? 'normal'),
          ...(source === target ? {} : { instance: target }), modifiers: Object.fromEntries(mods), legacy: event.definitionVersion !== 2, source: event.source });
        // The timeline owns opacity once, including a zero-opacity start for a new actor.
        if (!existed && cue.durationMs > 0) this.#stageMotions.start(`portrait:${target}`, { opacity: 0 });
        this.#stageMotions.timeline(`${identity}/${target}/show`, `portrait:${target}`, { opacity: Number(desiredOpacity) }, event.progress, event.source);
      } else if (cue.action === 'show' && this.#portraitViews.has(target)) {
        this.#stageMotions.timeline(`${identity}/${target}/show`, `portrait:${target}`,
          this.#stageMotions.timelineTarget(`${identity}/${target}/show`) ?? { opacity: Number(cue.opacity ?? 1) }, event.progress, event.source);
      } else if (cue.action === 'expression' && (event.started || event.final)) {
        const current = this.#portraitViews.get(target);
        if (!current) throw new Error(`表情切换目标不存在：${target}`);
        if (typeof cue.source === 'string' && cue.source !== `${current.charId}:${current.costume}`) throw new Error('表情轨道的素材身份与当前舞台实例不一致');
        this.setPortrait(target, { ...current, frame: undefined, expression: String(cue.expression) });
        if (event.source) this.#objectSources.set(`portrait:${target}`, event.source);
      } else if (cue.action === 'pose' || cue.action === 'move') {
        const keys = this.#actorKeys(target);
        if (!keys.length && this.#stageMotions.isCueCancelled(identity)) return true;
        if (!keys.length) throw new Error(`时间轴舞台对象不存在：${target}`);
        const entries = keys.map(key => {
          const view = this.#portraitViews.get(key)!;
          const pose = this.#geometry().stagePoseFromModifiers(this.#effectiveStage(), `${view.charId}:${view.costume}`, mods, this.#readPose(key));
          return { key, values: this.#explicitPoseValues(mods, pose) };
        });
        for (const entry of entries) {
          if (event.started) this.#promoteMove(entry.key);
          this.#stageMotions.timeline(`${identity}/${entry.key}`, `portrait:${entry.key}`, entry.values, event.progress, event.source);
        }
      } else if (cue.action === 'hide') {
        for (const key of this.#actorKeys(target)) {
          const id = `${identity}/${key}/hide`;
          this.#stageMotions.timeline(id, `portrait:${key}`, { opacity: 0 }, event.progress, event.source);
          if (event.progress >= 1 && this.#stageMotions.ownsTimeline(id, 'opacity')) this.removePortrait(key);
        }
      }
      return true;
    }
    if (event.track === 'layer') {
      if (this.#stageMotions.isCueCancelled(identity)) return true;
      if (cue.action === 'show' && event.started) {
        const definition = this.#geometry().parseStageLayer({ id: target, key: cue.key, band: cue.band ?? 'environment',
          x: cue.x ?? 0, y: cue.y ?? 0, scale: cue.scale ?? 1, opacity: cue.durationMs > 0 ? 0 : cue.opacity ?? 1,
          z: cue.z ?? 0, parallax: cue.parallax ?? 1 });
        this.#setStageLayer(definition);
        if (event.source) this.#objectSources.set(`layer:${target}`, event.source);
      }
      const entry = this.#stageLayers.get(target);
      if (!entry) { if (cue.action === 'hide') return true; throw new Error(`时间轴图层不存在：${target}`); }
      if (cue.action === 'show' || cue.action === 'hide') {
        this.#stageMotions.timeline(identity, `layer:${target}`, { opacity: cue.action === 'hide' ? 0 : Number(cue.opacity ?? 1) }, event.progress, event.source);
        if (cue.action === 'hide' && event.progress >= 1 && this.#stageMotions.ownsTimeline(identity, 'opacity')) this.#removeStageLayer(target);
      } else if (cue.action === 'pose') {
        const values: StageValues = {};
        for (const name of ['x', 'y', 'scale', 'opacity', 'z'] as const) if (cue[name] !== undefined) values[name] = Number(cue[name]);
        this.#stageMotions.timeline(identity, `layer:${target}`, values, event.progress, event.source);
      }
      return true;
    }
    if (event.track === 'camera' && (cue.action === 'pan' || cue.action === 'zoom')) {
      const values = cue.action === 'pan' ? { x: Number(cue.x), y: Number(cue.y) } : { scale: Math.max(.25, Math.min(4, Number(cue.scale))) };
      if (event.started) this.#zoomRemain = 0;
      this.#stageMotions.timeline(identity, 'camera', values, event.progress, event.source);
      return true;
    }
    return false;
  }

  applyTimelineFrame(event: TimelineFrameEvent): void {
    if (this.#disposed) return;
    if (event.runId !== undefined && this.#applyOwnedTimelineFrame(event)) {
      this.#syncEffectRegistration(); this.#requestFrame(); return;
    }
    const cue = event.cue;
    if (event.track === 'background' && cue.action === 'set' && typeof cue.key === 'string' && (event.started || event.final)) {
      this.#startTimelineBackground(cue.key, cue.durationMs);
      return;
    }
    if (event.track === 'portrait' && event.target) {
      const target = event.target;
      if (cue.action === 'show') {
        if (event.started || event.final) {
          this.setPortrait(target, {
            charId: target.split(':')[0] ?? target,
            costume: target.split(':')[1] ?? 'normal',
            expression: typeof cue.expression === 'string' ? cue.expression : 'normal',
            pos: typeof cue.position === 'string' ? cue.position : 'center',
          });
        }
        const sprite = this.#portraitSprites.get(target);
        if (sprite) {
          sprite.alpha = event.progress;
          sprite.y = Math.max(this.#h + 10, sprite.height + this.#h * 0.025) + (1 - event.progress) * 28;
        }
      } else if (cue.action === 'expression' && (event.started || event.final)) {
        const current = this.#portraitViews.get(target);
        if (current && typeof cue.expression === 'string') this.setPortrait(target, { ...current, frame: undefined, expression: cue.expression });
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
          if (event.progress >= 1) {
            this.#timelineMoveStarts.delete(cue);
            const current = this.#portraitViews.get(target);
            if (current) this.#portraitViews.set(target, { ...current, pos: cue.position as string });
          }
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
    if (event.track === 'particle' && (event.started || event.final)) {
      if (cue.action === 'start' && typeof cue.kind === 'string') this.startParticles(cue.kind);
      else if (cue.action === 'stop') this.stopParticles();
    }
    this.#syncEffectRegistration();
  }

  inspectStage(): StageInspection {
    return JSON.parse(JSON.stringify({ design: { width: this.#w, height: this.#h }, camera: { x: this.#cameraPanX, y: this.#cameraPanY, scale: this.worldContainer.scale.x },
      objects: [
        ...[...this.#portraitViews].map(([key, view]) => ({ id: `portrait:${key}`, target: key, kind: 'portrait',
          charId: view.charId, costume: view.costume, expression: view.expression, pose: this.#readPose(key),
          source: this.#objectSources.get(`portrait:${key}`) ?? null, propertySources: this.#stageMotions.sources(`portrait:${key}`) })),
        ...[...this.#stageLayers].map(([key, entry]) => ({ id: `layer:${key}`, target: key, kind: 'layer', assetKey: entry.definition.key,
          pose: { x: entry.definition.x, y: entry.definition.y, scale: entry.definition.scale, opacity: entry.definition.opacity, z: entry.definition.z },
          source: this.#objectSources.get(`layer:${key}`) ?? null, propertySources: this.#stageMotions.sources(`layer:${key}`) })),
      ] })) as StageInspection;
  }

  snapshotPresentation(): WorldPresentationSnapshot {
    const extended = this.#stage !== null || this.#stageLayers.size > 0 || this.#stageMotions.hasState || this.#portraitPlayers.size > 0 || [...this.#portraitViews.values()].some(view => view.pose !== undefined);
    return {
      version: extended ? 2 : 1,
      ...(extended ? { design: { width: this.#w, height: this.#h },
        layers: [...this.#stageLayers.values()].map(value => ({ ...value.definition })), motions: this.#stageMotions.snapshot(), stageConfigKey: this.#stage === null ? 'null' : this.#geometry().stageConfigurationKey(this.#stage),
        objectSources: [...this.#objectSources].map(([key, source]) => [key, JSON.parse(JSON.stringify(source)) as StageSource]),
        transitions: {
          ...(this.#backgroundTransition?.oldKey ? { background: { oldKey: this.#backgroundTransition.oldKey,
            remain: this.#backgroundTransition.remain, duration: this.#backgroundTransition.dur } } : {}),
          portraits: this.#portraitTweens.filter(tween => tween.oldView && (this.#portraitViews.get(tween.key)?.pose || this.#portraitPlayers.has(tween.old) || this.#portraitPlayers.has(tween.neu))).map(tween => ({ key: tween.key,
            oldView: this.#snapshotPortrait(tween.oldView!, tween.old), remain: tween.remain, duration: tween.dur })),
        } } : {}),
      activeSpeakerId: this.#activeSpeakerId,
      ...(this.#portraitPlayers.size ? { speaking: this.#speaking, portraitSkipping: this.#portraitSkipping } : {}),
      backgroundKey: this.#backgroundKey,
      portraits: [...this.#portraitViews.entries()].map(([key, view]) => ({ key, view: this.#snapshotPortrait(view, this.#portraitSprites.get(key)!) })),
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
      this.#clearStageLayers();
      this.#clearPortraits();
      this.#clearBackground();
    } else {
      this.#stopBackgroundTransition();
      this.#stopPortraitTransitions();
      this.#moveTweens = [];
    }
    this.#clearEffects({ preserveWorld });
    this.#activeSpeakerId = null;
    this.#speaking = false; this.#portraitSkipping = false;
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
    const oldKey = this.#backgroundKey;
    this.#backgroundKey = key;
    this.#backgroundSprite = next;
    this.#backgroundLayer.addChild(next);
    if (!old || durationMs <= 0) {
      old?.destroy();
      next.alpha = 1;
      return;
    }
    this.#backgroundTransition = { old, oldKey, neu: next, remain: Math.max(1, durationMs), dur: Math.max(1, durationMs) };
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

  #stopPortraitTransitions(): void {
    const live = new Set(this.#portraitSprites.values());
    const stale = new Set<PortraitDisplay>();
    for (const tween of this.#portraitTweens) {
      if (!live.has(tween.old)) stale.add(tween.old);
      if (!live.has(tween.neu)) stale.add(tween.neu);
    }
    this.#portraitTweens = [];
    for (const sprite of stale) {
      if (sprite.parent) sprite.parent.removeChild(sprite);
      this.#destroyPortrait(sprite);
    }
    this.#syncEffectRegistration();
  }

  #createPortraitSprite(texture: Texture, x: number, height: number, view: PortraitView): PortraitDisplay {
    const visual = this.#assets.resolvePortraitVisual(view.charId, view.costume, view.expression);
    const sprite = visual ? new PortraitVisualRoot(texture) : new Sprite(texture);
    sprite.width = height * texture.width / Math.max(1, texture.height);
    sprite.height = height;
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, Math.max(this.#h + 10, height + this.#h * 0.025));
    sprite.tint = this.#portraitTint(view);
    if (view.frame) this.#portraitFrames.set(sprite, { ...view.frame });
    if (view.pose) this.#projectPortraitPose(sprite, view);
    if (visual && sprite instanceof PortraitVisualRoot) {
      const player = new PortraitVisualPlayer(sprite, visual, view.animation);
      this.#portraitPlayers.set(sprite, player);
      if (!view.animation) player.advance(0, this.#speaking && view.charId === this.#activeSpeakerId, !this.#presentation.reducedMotion, this.#portraitSkipping);
      else player.project(!this.#presentation.reducedMotion, this.#portraitSkipping);
    }
    return sprite;
  }

  #snapshotPortrait(view: PortraitView, sprite: PortraitDisplay): PortraitView {
    const animation = this.#portraitPlayers.get(sprite)?.snapshot();
    return { ...view, ...(view.pose ? { pose: { ...view.pose } } : {}), ...(view.frame ? { frame: { ...view.frame } } : {}), ...(animation ? { animation } : {}) };
  }

  #destroyPortrait(sprite: PortraitDisplay): void { this.#portraitPlayers.delete(sprite); sprite.destroy({ children: true }); }

  #portraitTint(view: PortraitView | undefined): number {
    // Focus dims the drawing, not its opacity: the scenery must not show through a person.
    return !this.#activeSpeakerId || view?.charId === this.#activeSpeakerId ? 0xffffff : 0xc4cddd;
  }

  #detachPortraitSprites(removed: ReadonlySet<PortraitDisplay>): void {
    this.#moveTweens = this.#moveTweens.filter((tween) => !removed.has(tween.sprite));
    const orphaned = new Set<PortraitDisplay>();
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
      this.#destroyPortrait(sprite);
    }
  }

  #updateTransient(deltaMs: number): void {
    if (this.#moveTweens.length > 0) {
      for (let index = this.#moveTweens.length - 1; index >= 0; index--) {
        const tween = this.#moveTweens[index]!;
        tween.remain = Math.max(0, tween.remain - deltaMs);
        const progress = 1 - tween.remain / tween.dur;
        tween.sprite.x = tween.fromX + (tween.toX - tween.fromX) * progress;
        if (tween.remain === 0) {
          if (this.#portraitSprites.get(tween.key) === tween.sprite) {
            const current = this.#portraitViews.get(tween.key);
            if (current) this.#portraitViews.set(tween.key, { ...current, pos: tween.pos });
          }
          this.#moveTweens.splice(index, 1);
        }
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
      const done: { key: string; old: PortraitDisplay; neu: PortraitDisplay; remain: number; dur: number }[] = [];
      for (const tween of this.#portraitTweens) {
        tween.remain = Math.max(0, tween.remain - deltaMs);
        const progress = 1 - tween.remain / tween.dur;
        const opacity = this.#portraitViews.get(tween.key)?.pose?.opacity ?? 1;
        tween.neu.alpha = opacity * progress;
        tween.old.alpha = opacity * (1 - progress);
        if (tween.remain === 0) done.push(tween);
      }
      for (const tween of done) {
        this.#portraitLayer.removeChild(tween.old);
        this.#destroyPortrait(tween.old);
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
    for (const layer of this.#stageLayers.values()) this.#projectStageLayer(layer);
  }

  #hasEffectWork(): boolean {
    return this.#stageMotions.active || this.#worldEffects.needsUpdate
      || [...this.#portraitPlayers.values()].some(player => player.active)
      || this.#flashRemain > 0
      || this.#zoomRemain > 0
      || this.#backgroundTransition !== null
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
    for (const key of this.#portraitViews.keys()) this.#objectSources.delete(`portrait:${key}`);
    for (const key of this.#portraitViews.keys()) this.#stageMotions.cancel(`portrait:${key}`);
    const all = new Set<PortraitDisplay>([
      ...this.#portraitSprites.values(),
      ...this.#portraitTweens.flatMap((tween) => [tween.old, tween.neu]),
    ]);
    for (const sprite of all) {
      if (sprite.parent) sprite.parent.removeChild(sprite);
      this.#destroyPortrait(sprite);
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

  #clearEffects(options: { preserveWorld: boolean; cancelActiveTimelines?: boolean }): void {
    this.#stageMotions.clear(options.cancelActiveTimelines);
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
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.stopParticles();
    if (!options.preserveWorld) this.setPortraitFocus(null);
    this.fadeOverlay.alpha = 0;
    this.#syncEffectRegistration();
  }

  #clearVisibleState(cancelActiveTimelines = false): void {
    this.#speaking = false; this.#portraitSkipping = false;
    this.#clearStageLayers();
    this.#clearPortraits();
    this.#clearBackground();
    this.#clearEffects({ preserveWorld: false, cancelActiveTimelines });
    this.#syncEffectRegistration();
  }

  #prepareSnapshot(snapshot: unknown): WorldPresentationSnapshot {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) throw invalidSnapshot('Presentation snapshot must be an object');
    const raw = snapshot as Record<string, unknown>;
    if (raw.version !== 1 && raw.version !== 2) throw invalidSnapshot('Presentation snapshot version must be 1 or 2');
    const extended = raw.version === 2;
    if (extended) {
      if (raw.stageConfigKey !== (this.#stage === null ? 'null' : this.#geometry().stageConfigurationKey(this.#stage))) throw invalidSnapshot('Saved stage configuration differs from the current project');
      const design = raw.design as { width?: unknown; height?: unknown } | undefined;
      if (!design || design.width !== this.#w || design.height !== this.#h) throw invalidSnapshot('Stage design canvas differs from the saved canvas');
    }
    if (raw.activeSpeakerId !== undefined && raw.activeSpeakerId !== null && typeof raw.activeSpeakerId !== 'string') throw invalidSnapshot('activeSpeakerId is invalid');
    if (raw.speaking !== undefined && typeof raw.speaking !== 'boolean') throw invalidSnapshot('speaking is invalid');
    if (raw.portraitSkipping !== undefined && typeof raw.portraitSkipping !== 'boolean') throw invalidSnapshot('portraitSkipping is invalid');
    if (!(raw.backgroundKey === null || typeof raw.backgroundKey === 'string')) throw invalidSnapshot('backgroundKey is invalid');
    if (!Array.isArray(raw.portraits)) throw invalidSnapshot('portraits must be an array');
    const portraits: { key: string; view: PortraitView }[] = [];
    for (const item of raw.portraits) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) throw invalidSnapshot('portrait record is invalid');
      const record = item as Record<string, unknown>;
      const rawView = record.view;
      if (typeof record.key !== 'string' || record.key.length === 0 || typeof rawView !== 'object' || rawView === null || Array.isArray(rawView)) throw invalidSnapshot('portrait record is invalid');
      const candidate = rawView as Record<string, unknown>;
      if (![candidate.charId, candidate.costume, candidate.expression, candidate.pos].every((value) => typeof value === 'string')) throw invalidSnapshot('portrait view is invalid');
      if (portraits.some(value => value.key === record.key)) throw invalidSnapshot('Duplicate portrait instance identity');
      const view: PortraitView = { charId: candidate.charId as string, costume: candidate.costume as string, expression: candidate.expression as string, pos: candidate.pos as string };
      const visual = this.#assets.resolvePortraitVisual(view.charId, view.costume, view.expression);
      if (visual) {
        if (!extended || typeof raw.speaking !== 'boolean') throw invalidSnapshot('Dynamic portraits require their saved animation state');
        try { view.animation = validatePortraitAnimation(visual, candidate.animation); }
        catch (error) { throw invalidSnapshot(String(error)); }
      } else if (candidate.animation !== undefined) throw invalidSnapshot('Saved dynamic portrait is no longer registered');
      if (candidate.pose !== undefined) {
        if (!extended) throw invalidSnapshot('Stage pose requires a version 2 world snapshot');
        view.pose = this.#geometry().validateStagePose(candidate.pose);
        const texture = this.#assets.resolvePortrait(view.charId, view.costume, view.expression);
        if (!texture) throw invalidSnapshot(`Saved portrait asset is unavailable: ${view.charId}:${view.costume}:${view.expression}`);
        const pin = this.#stage?.portraits[`${view.charId}:${view.costume}`]?.sources[view.expression];
        if (pin) {
          const actual = this.#assets.resolvePortraitIdentity(view.charId, view.costume, view.expression);
          if (!actual || actual.path !== pin.path || actual.sha256 !== pin.sha256 || actual.width !== pin.width || actual.height !== pin.height)
            throw invalidSnapshot('Saved calibrated portrait bytes have changed');
        }
        view.frame = this.#geometry().validateStageFrame(candidate.frame ?? { x: 0, y: 0, width: texture.width, height: texture.height }, texture.width, texture.height);
      }
      portraits.push({ key: record.key, view });
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
    const layers: StageLayerDefinition[] = [];
    if (extended) {
      if (!Array.isArray(raw.layers) || raw.layers.length > 64) throw invalidSnapshot('Stage layers are invalid');
      for (const value of raw.layers) {
        const layer = this.#geometry().parseStageLayer(value);
        if (layers.some(existing => existing.id === layer.id)) throw invalidSnapshot('Duplicate stage layer identity');
        if (!this.#assets.resolveBackground(layer.key)) throw invalidSnapshot(`Saved layer asset is unavailable: ${layer.key}`);
        layers.push(layer);
      }
    }
    const motions = extended ? prepareStageMotions(raw.motions, new Set(['camera', 'screen:fade', 'screen:tint',
      ...portraits.map(value => `portrait:${value.key}`), ...layers.map(value => `layer:${value.id}`)])) : undefined;
    // Resolve every texture before touching visible state. A failure here leaves the old projection intact.
    if (typeof raw.backgroundKey === 'string') this.#resolveBackground(raw.backgroundKey);
    for (const record of portraits) {
      this.#assets.resolvePortrait(record.view.charId, record.view.costume, record.view.expression)
        ?? this.#assets.getOrCreatePortrait(`${record.view.charId}:${record.view.costume}:${record.view.expression}`, () => makeFallbackPortraitTexture(record.view.charId, record.view.costume, record.view.expression));
    }
    if (raw.objectSources !== undefined && (!extended || !Array.isArray(raw.objectSources) || raw.objectSources.length > portraits.length + layers.length
      || raw.objectSources.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !this.#geometry().validStageSource(entry[1])
        || ![...portraits.map(value => `portrait:${value.key}`), ...layers.map(layer => `layer:${layer.id}`)].includes(entry[0])))) throw invalidSnapshot('Invalid object source map');
    let transitions: WorldPresentationSnapshot['transitions'];
    if (extended && raw.transitions !== undefined) {
      const value = raw.transitions as NonNullable<WorldPresentationSnapshot['transitions']>;
      if (!value || typeof value !== 'object' || !Array.isArray(value.portraits) || value.portraits.length > portraits.length) throw invalidSnapshot('Invalid saved visual transitions');
      const validTime = (remain: unknown, duration: unknown): boolean => finiteNumber(remain) && finiteNumber(duration)
        && duration > 0 && duration <= 600_000 && remain > 0 && remain <= duration;
      const seen = new Set<string>();
      for (const transition of value.portraits) {
        if (!transition || typeof transition.key !== 'string' || seen.has(transition.key)
          || !portraits.some(item => item.key === transition.key) || !validTime(transition.remain, transition.duration)) throw invalidSnapshot('Invalid saved portrait transition');
        seen.add(transition.key);
        const view = transition.oldView;
        if (!view || ![view.charId, view.costume, view.expression, view.pos].every(value => typeof value === 'string')) throw invalidSnapshot('Invalid previous portrait');
        const texture = this.#assets.resolvePortrait(view.charId, view.costume, view.expression);
        if (!texture) throw invalidSnapshot('Previous expression is not registered');
        const visual = this.#assets.resolvePortraitVisual(view.charId, view.costume, view.expression);
        if (visual) { try { validatePortraitAnimation(visual, view.animation); } catch (error) { throw invalidSnapshot(String(error)); } }
        else if (view.animation !== undefined) throw invalidSnapshot('Previous dynamic expression is no longer registered');
        const pin = this.#stage?.portraits[`${view.charId}:${view.costume}`]?.sources[view.expression];
        if (pin) {
          const actual = this.#assets.resolvePortraitIdentity(view.charId, view.costume, view.expression);
          if (!actual || actual.path !== pin.path || actual.sha256 !== pin.sha256 || actual.width !== pin.width || actual.height !== pin.height)
            throw invalidSnapshot('Previous calibrated expression bytes have changed');
        }
        this.#geometry().validateStagePose(view.pose);
        if (!view.frame) throw invalidSnapshot('Previous expression is missing its calibration');
        this.#geometry().validateStageFrame(view.frame, texture.width, texture.height);
      }
      if (value.background !== undefined) {
        if (!value.background || typeof value.background.oldKey !== 'string' || raw.backgroundKey === null
          || !validTime(value.background.remain, value.background.duration) || !this.#assets.resolveBackground(value.background.oldKey)) throw invalidSnapshot('Invalid saved background transition');
      }
      transitions = JSON.parse(JSON.stringify(value)) as typeof transitions;
    }
    return {
      version: extended ? 2 : 1,
      ...(extended ? { design: { width: this.#w, height: this.#h }, layers, motions: motions!, stageConfigKey: raw.stageConfigKey as string, objectSources: JSON.parse(JSON.stringify(raw.objectSources ?? [])) as [string, StageSource][], ...(transitions ? { transitions } : {}) } : {}),
      activeSpeakerId: typeof raw.activeSpeakerId === 'string' ? raw.activeSpeakerId : null,
      ...(raw.speaking !== undefined ? { speaking: raw.speaking as boolean } : {}),
      ...(raw.portraitSkipping !== undefined ? { portraitSkipping: raw.portraitSkipping as boolean } : {}),
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
    this.#activeSpeakerId = snapshot.activeSpeakerId ?? null;
    this.#speaking = snapshot.speaking ?? false;
    this.#portraitSkipping = snapshot.portraitSkipping ?? false;
    if (snapshot.backgroundKey !== null) this.setBackground(snapshot.backgroundKey);
    for (const record of snapshot.portraits) this.setPortrait(record.key, record.view);
    for (const layer of snapshot.layers ?? []) this.#setStageLayer(layer);
    if (snapshot.transitions?.background && this.#backgroundSprite) {
      const entry = snapshot.transitions.background;
      const old = this.#createBackgroundSprite(this.#assets.resolveBackground(entry.oldKey)!);
      old.alpha = entry.remain / entry.duration;
      this.#backgroundSprite.alpha = 1 - old.alpha;
      this.#backgroundLayer.addChildAt(old, 0);
      this.#backgroundTransition = { old, oldKey: entry.oldKey, neu: this.#backgroundSprite, remain: entry.remain, dur: entry.duration };
    }
    for (const entry of snapshot.transitions?.portraits ?? []) {
      const current = this.#portraitViews.get(entry.key)!;
      const neu = this.#portraitSprites.get(entry.key)!;
      const oldView = { ...entry.oldView, pose: { ...current.pose! } };
      const texture = this.#assets.resolvePortrait(oldView.charId, oldView.costume, oldView.expression)!;
      const old = this.#createPortraitSprite(texture, oldView.pose.x, oldView.pose.baseHeight, oldView);
      const opacity = current.pose!.opacity;
      old.alpha = opacity * entry.remain / entry.duration;
      neu.alpha = opacity * (1 - entry.remain / entry.duration);
      this.#portraitLayer.addChildAt(old, this.#portraitLayer.getChildIndex(neu));
      this.#portraitTweens.push({ key: entry.key, old, neu, remain: entry.remain, dur: entry.duration, oldView });
    }
    this.#syncEffectRegistration();
    this.setPortraitFocus(snapshot.activeSpeakerId ?? null);
    this.worldContainer.scale.set(snapshot.cameraScale);
    this.#cameraPanX = snapshot.cameraPan.x;
    this.#cameraPanY = snapshot.cameraPan.y;
    this.#setWorldBasePosition();
    this.fadeOverlay.alpha = snapshot.fadeAlpha;
    this.#tintOverlay.tint = snapshot.tint.color;
    this.#tintOverlay.alpha = snapshot.tint.alpha;
    this.#tintOverlay.visible = snapshot.tint.alpha > 0.001;
    if (snapshot.particleKind !== null) this.startParticles(snapshot.particleKind);
    if (snapshot.motions) this.#stageMotions.restore(snapshot.motions);
    this.#objectSources.clear(); for (const [key, source] of snapshot.objectSources ?? []) this.#objectSources.set(key, source);
    this.#syncEffectRegistration();
  }
}
