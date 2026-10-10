import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { BuiltinTransitionName } from '@surdet/core';
import { presentationDuration } from './presentation.js';
import { TransitionRegistry, type StageTransition } from './transition-registry.js';

export type TransitionName = BuiltinTransitionName;
export type ShakeDirection = 'both' | 'horizontal' | 'vertical' | 'diagonal';

export interface WorldEffectsControllerOptions {
  world: Container;
  screen: Container;
  width: number;
  height: number;
  getBasePosition: () => { x: number; y: number };
  setWorldPosition: (x: number, y: number) => void;
  duration: (durationMs: number) => number;
  requestFrame: () => void;
  /** A newly owned texture of the world, excluding dialogue and menus. */
  captureWorld?: () => Texture | null;
}

interface TimedOptions {
  duration: number;
  requestFrame: () => void;
}

abstract class TimedTransition implements StageTransition {
  abstract readonly name: string;
  #duration = 1;
  #elapsed = 0;
  #requestFrame: () => void;

  constructor(options: TimedOptions) {
    this.#duration = Math.max(1, options.duration);
    this.#requestFrame = options.requestFrame;
  }

  protected get progress(): number {
    return Math.max(0, Math.min(1, this.#elapsed / this.#duration));
  }

  protected get requestFrame(): () => void {
    return this.#requestFrame;
  }

  start(durationMs: number): void {
    this.#duration = Math.max(1, durationMs);
    this.#elapsed = 0;
    this.onStart();
    this.#requestFrame();
  }

  update(deltaMs: number): boolean {
    this.#elapsed = Math.min(this.#duration, this.#elapsed + Math.max(0, deltaMs));
    const done = this.#elapsed >= this.#duration;
    this.onUpdate(this.progress, done);
    if (done) this.onFinish();
    this.#requestFrame();
    return done;
  }

  cancel(): void {
    this.#elapsed = 0;
    this.onCancel();
    this.#requestFrame();
  }

  protected onStart(): void {}
  protected abstract onUpdate(progress: number, done: boolean): void;
  protected onFinish(): void {}
  protected onCancel(): void {}
}

class FadeTransition extends TimedTransition {
  override readonly name = 'fade';
  #world: Container;

  constructor(world: Container, options: TimedOptions) {
    super(options);
    this.#world = world;
  }

  protected override onStart(): void {
    this.#world.alpha = 0;
  }

  protected override onUpdate(progress: number, done: boolean): void {
    // The current world is the logical “new” scene. Fading its alpha in keeps
    // the transition independent from the dialogue/UI layers.
    this.#world.alpha = done ? 1 : progress;
  }

  protected override onFinish(): void {
    this.#world.alpha = 1;
  }

  protected override onCancel(): void {
    this.#world.alpha = 1;
  }
}

class DissolveTransition extends TimedTransition {
  override readonly name = 'dissolve';
  #overlay: Sprite | null = null;
  constructor(private readonly options: TimedOptions & {
    screen: Container; width: number; height: number; takeOldFrame: () => Texture | null;
  }) { super(options); }

  protected override onStart(): void {
    const texture = this.options.takeOldFrame();
    if (!texture) return;
    this.#overlay = new Sprite(texture);
    this.#overlay.width = this.options.width; this.#overlay.height = this.options.height;
    this.options.screen.addChild(this.#overlay);
  }

  protected override onUpdate(progress: number): void {
    if (this.#overlay) this.#overlay.alpha = 1 - progress;
  }

  protected override onFinish(): void { this.#release(); }
  protected override onCancel(): void { this.#release(); }
  #release(): void {
    const sprite = this.#overlay; this.#overlay = null;
    if (!sprite) return;
    const texture = sprite.texture;
    sprite.parent?.removeChild(sprite); sprite.destroy(); texture.destroy(true);
  }
}

class SlideTransition extends TimedTransition {
  override readonly name: string;
  #world: Container;
  #getBasePosition: () => { x: number; y: number };
  #setWorldPosition: (x: number, y: number) => void;
  #width: number;
  #direction: -1 | 1;

  constructor(
    name: 'slide-left' | 'slide-right',
    direction: -1 | 1,
    options: TimedOptions & Pick<WorldEffectsControllerOptions, 'world' | 'width' | 'getBasePosition' | 'setWorldPosition'>,
  ) {
    super(options);
    this.name = name;
    this.#world = options.world;
    this.#width = options.width;
    this.#direction = direction;
    this.#getBasePosition = options.getBasePosition;
    this.#setWorldPosition = options.setWorldPosition;
  }

  protected override onUpdate(progress: number, done: boolean): void {
    const base = this.#getBasePosition();
    const offset = done ? 0 : this.#direction * this.#width * (1 - progress);
    this.#setWorldPosition(base.x + offset, base.y);
  }

  protected override onFinish(): void {
    const base = this.#getBasePosition();
    this.#setWorldPosition(base.x, base.y);
  }

  protected override onCancel(): void {
    const base = this.#getBasePosition();
    this.#setWorldPosition(base.x, base.y);
    this.#world.alpha = 1;
  }
}

class CircleTransition extends TimedTransition {
  override readonly name = 'circle';
  #world: Container;
  #screen: Container;
  #width: number;
  #height: number;
  #mask: Graphics | null = null;

  constructor(world: Container, screen: Container, width: number, height: number, options: TimedOptions) {
    super(options);
    this.#world = world;
    this.#screen = screen;
    this.#width = width;
    this.#height = height;
  }

  protected override onStart(): void {
    this.#mask = this.#mask ?? new Graphics();
    this.#mask.clear().circle(this.#width / 2, this.#height / 2, 0).fill(0xffffff);
    if (!this.#mask.parent) this.#screen.addChild(this.#mask);
    this.#world.mask = this.#mask;
  }

  protected override onUpdate(progress: number, done: boolean): void {
    const radius = Math.hypot(this.#width, this.#height) * progress;
    this.#mask?.clear().circle(this.#width / 2, this.#height / 2, radius).fill(0xffffff);
    if (done) this.#clearMask();
  }

  protected override onFinish(): void {
    this.#clearMask();
  }

  protected override onCancel(): void {
    this.#clearMask();
  }

  destroy(): void {
    this.#clearMask();
    this.#mask?.destroy();
    this.#mask = null;
  }

  #clearMask(): void {
    this.#world.mask = null;
    if (this.#mask?.parent) this.#mask.parent.removeChild(this.#mask);
  }
}

/**
 * 统一管理转场与镜头震动，使用 AdvRenderer 的现有 updateEffects 帧链，
 * 不创建独立 ticker，也不让视觉偏移污染世界的逻辑基准位置。
 */
export class WorldEffectsController {
  readonly registry = new TransitionRegistry();
  readonly #circle: CircleTransition;
  #captureWorld?: () => Texture | null;
  #oldFrame: Texture | null = null;
  #captureNextChange = true;
  #world: Container;
  #getBasePosition: () => { x: number; y: number };
  #setWorldPosition: (x: number, y: number) => void;
  #requestFrame: () => void;
  #shakeRemain = 0;
  #shakeDuration = 1;
  #shakeStrength = 0;
  #shakeDirection: ShakeDirection = 'both';

  constructor(options: WorldEffectsControllerOptions) {
    this.#world = options.world;
    this.#getBasePosition = options.getBasePosition;
    this.#setWorldPosition = options.setWorldPosition;
    this.#requestFrame = options.requestFrame;
    this.#captureWorld = options.captureWorld;
    const timed = { duration: options.duration(600), requestFrame: options.requestFrame };
    this.registry.register(new FadeTransition(options.world, timed));
    this.registry.register(new SlideTransition('slide-left', -1, { ...options, ...timed }));
    this.registry.register(new SlideTransition('slide-right', 1, { ...options, ...timed }));
    this.#circle = new CircleTransition(options.world, options.screen, options.width, options.height, timed);
    this.registry.register(this.#circle);
    this.registry.register(new DissolveTransition({ ...timed, screen: options.screen, width: options.width, height: options.height,
      takeOldFrame: () => { const frame = this.#oldFrame; this.#oldFrame = null; return frame; } }));
  }

  /** First author/world mutation after a pause owns exactly one old frame. */
  beforeStageMutation(): void {
    if (!this.#captureNextChange || this.registry.active) return;
    this.#captureNextChange = false;
    this.#oldFrame = this.#captureWorld?.() ?? null;
  }

  markStageBoundary(): void {
    this.#oldFrame?.destroy(true); this.#oldFrame = null;
    this.#captureNextChange = true;
  }

  transition(name: string, durationMs = 600): boolean {
    if (name === 'dissolve' && !this.#oldFrame) return true;
    const started = this.registry.start(name, Math.max(1, durationMs));
    if (started && name !== 'dissolve') { this.#oldFrame?.destroy(true); this.#oldFrame = null; }
    return started;
  }

  shake(durationMs = 400, strength = 8, direction: ShakeDirection = 'both'): void {
    this.#shakeDuration = Math.max(1, durationMs);
    this.#shakeRemain = this.#shakeDuration;
    this.#shakeStrength = Math.max(0, Math.min(64, strength));
    this.#shakeDirection = direction;
    this.#requestFrame();
  }

  update(deltaMs: number): void {
    const active = this.registry.active;
    this.registry.update(deltaMs);
    if (active && !this.registry.active) this.markStageBoundary();
    if (this.#shakeRemain <= 0) return;
    this.#shakeRemain = Math.max(0, this.#shakeRemain - Math.max(0, deltaMs));
    if (this.#shakeRemain === 0) {
      const base = this.#getBasePosition();
      this.#setWorldPosition(base.x, base.y);
      return;
    }
    const t = this.#shakeRemain / this.#shakeDuration;
    const amplitude = this.#shakeStrength * t * t;
    const xSample = Math.random() * 2 - 1;
    const ySample = this.#shakeDirection === 'diagonal' ? xSample : Math.random() * 2 - 1;
    const base = this.#getBasePosition();
    const x = this.#shakeDirection === 'vertical' ? 0 : xSample * amplitude;
    const y = this.#shakeDirection === 'horizontal' ? 0 : ySample * amplitude;
    this.#setWorldPosition(base.x + x, base.y + y);
    this.#requestFrame();
  }

  reset(options: { preserveOldFrame?: boolean } = {}): void {
    if (!options.preserveOldFrame || this.registry.active?.name !== 'dissolve') this.registry.cancelActive();
    if (!options.preserveOldFrame) { this.#oldFrame?.destroy(true); this.#oldFrame = null; this.#captureNextChange = false; }
    this.#shakeRemain = 0;
    this.#world.alpha = 1;
    const base = this.#getBasePosition();
    this.#setWorldPosition(base.x, base.y);
  }

  destroy(): void {
    this.reset();
    this.#circle.destroy();
  }

  get needsUpdate(): boolean {
    return this.registry.active !== null || this.#shakeRemain > 0;
  }
}

/** 统一应用演出偏好时使用的边界函数，供宿主以同一口径调用。 */
export function normalizeEffectDuration(durationMs: number, reducedMotion: boolean, transitionScale: number): number {
  return presentationDuration(durationMs, { reducedMotion, transitionScale, particleEnabled: true });
}
