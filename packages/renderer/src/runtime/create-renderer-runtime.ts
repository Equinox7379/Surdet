import {
  EventBus,
  type CoreEventMap,
  type Unsubscribe,
} from '@surdet/core';
import { AdvRenderer, type AdvRendererOptions } from '../adv-renderer.js';
import { FrameScheduler } from '../frame-scheduler.js';
import { NULL_AUDIO } from '../types.js';
import { PixiStage } from '../pixi-stage.js';
import { RenderPerformanceMonitor } from '../performance.js';
import { RendererError } from '../api/renderer-errors.js';
import type { RendererInputAction } from '../api/renderer-input.js';
import type {
  PresentationController,
  RendererRuntime,
  RendererRuntimeOptions,
  ResetSessionOptions,
} from '../api/renderer-runtime.js';
import {
  RendererFacade,
  type RendererControllerPort,
  type RendererFacadeOptions,
  type RendererStagePort,
} from './renderer-facade.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';

export type { RendererControllerPort, RendererStagePort } from './renderer-facade.js';

export interface RendererRuntimeInternals {
  readonly canvas: HTMLCanvasElement;
  readonly stage: RendererStagePort;
  readonly controller: RendererControllerPort;
  readonly scheduler: { dispose(): void };
  readonly monitor: RenderPerformanceMonitor;
  readonly resourceSnapshot?: () => RendererResourceSnapshot;
}

/**
 * Compatibility adapter around the current AdvRenderer. It keeps the old
 * state machine intact while exposing the M1 controller port to the facade.
 */
class LegacyPresentationControllerAdapter implements RendererControllerPort {
  readonly #legacy: AdvRenderer;
  readonly #stage: RendererStagePort;
  readonly #relay = new EventBus<CoreEventMap>();
  #connectedCleanup: (() => void) | null = null;
  #relayAttached = false;
  #disposed = false;

  constructor(legacy: AdvRenderer, stage: RendererStagePort) {
    this.#legacy = legacy;
    this.#stage = stage;
  }

  get status(): PresentationController['status'] { return this.#legacy.status; }
  get autoPlay(): boolean { return this.#legacy.autoPlay; }
  get skipMode(): boolean { return this.#legacy.skipMode; }
  get skipAll(): boolean { return this.#legacy.skipAll; }
  get backlogOpen(): boolean { return this.#legacy.backlogOpen; }
  get interfaceHidden(): boolean { return this.#legacy.interfaceHidden; }
  get needsUpdate(): boolean { return this.#legacy.needsUpdate; }

  setFrameRequest(handler: (() => void) | null): void { this.#legacy.setFrameRequest(handler); }
  update(deltaMs: number): void { this.#legacy.update(deltaMs); }

  connect(bus: EventBus<CoreEventMap>): Unsubscribe {
    if (this.#disposed) return () => undefined;
    this.#connectedCleanup?.();
    if (!this.#relayAttached) {
      this.#legacy.subscribe(this.#relay);
      this.#relayAttached = true;
    }

    const unsubs: Unsubscribe[] = [
      bus.on('text', (payload) => this.#relay.emit('text', payload)),
      bus.on('choice', (payload) => this.#relay.emit('choice', payload)),
      bus.on('instr', (payload) => this.#relay.emit('instr', payload)),
      bus.on('wait', (payload) => this.#relay.emit('wait', payload)),
      bus.on('video', (payload) => this.#relay.emit('video', payload)),
      bus.on('timeline', (payload) => this.#relay.emit('timeline', payload)),
      bus.on('stateReset', (payload) => this.#relay.emit('stateReset', payload)),
    ];
    let active = true;
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      for (const unsubscribe of unsubs) unsubscribe();
      if (this.#connectedCleanup === cleanup) this.#connectedCleanup = null;
    };
    this.#connectedCleanup = cleanup;
    return cleanup;
  }

  reset(options?: ResetSessionOptions): void { this.#legacy.resetSession(options); }
  advance(): boolean { return this.#legacy.advance(); }
  select(index: number): boolean { return this.#legacy.select(index); }

  dispatchInput(action: RendererInputAction): boolean {
    if (this.#disposed) return false;
    switch (action.type) {
      case 'advance':
        return this.#legacy.advance();
      case 'choice.move':
        if (this.#legacy.status !== 'choice') return false;
        if (action.delta < 0) this.#legacy.choiceUp();
        else this.#legacy.choiceDown();
        return true;
      case 'choice.select':
        return this.#legacy.select(action.index);
      case 'backlog.toggle':
        return this.#legacy.toggleBacklog();
      case 'backlog.scroll':
        if (!this.#legacy.backlogOpen || !this.#stage.scrollBacklog) return false;
        this.#stage.scrollBacklog(action.delta);
        return true;
      case 'auto.toggle':
        return this.#legacy.toggleAuto();
      case 'skip.toggle':
        return action.scope === 'all' ? this.#legacy.toggleSkipAll() : this.#legacy.toggleSkip();
      case 'interface.toggle':
        return this.#legacy.toggleHideInterface();
      case 'escape':
        return this.#legacy.handleBacklogEscape();
    }
  }

  setTextSpeed(charsPerSecond: number): void { this.#legacy.setTextSpeed(charsPerSecond); }
  setAutoWait(baseDelayMs: number, perCharMs: number): void { this.#legacy.setAutoWait(baseDelayMs, perCharMs); }
  snapshotPresentation(): unknown { return this.#legacy.snapshotPresentation(); }
  restorePresentation(snapshot: unknown): void { this.#legacy.restorePresentation(snapshot); }
  clearPresentation(): void { this.#legacy.clearPresentation(); }
  backlogEntries(): readonly import('../backlog.js').BacklogEntry[] { return this.#legacy.backlogEntries(); }
  backlogSearchQuery(): string { return this.#legacy.backlogSearchQuery; }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#connectedCleanup?.();
    this.#connectedCleanup = null;
    this.#relay.clear();
    this.#legacy.destroy();
  }
}

/** @internal Test-only composition root; it deliberately stays out of the package public export. */
export async function createRendererRuntimeFromInternals(
  internals: RendererRuntimeInternals,
): Promise<RendererRuntime> {
  const facadeOptions: RendererFacadeOptions = {
    stage: internals.stage,
    controller: internals.controller,
    monitor: internals.monitor,
    resourceSnapshot: internals.resourceSnapshot,
  };
  const facade = new RendererFacade(facadeOptions);
  let disposed = false;
  return {
    canvas: internals.canvas,
    commands: facade.commands,
    queries: facade.queries,
    controller: internals.controller,
    resize: () => facade.resize(),
    resetSession: (options) => facade.resetSession(options),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      internals.scheduler.dispose();
      internals.controller.dispose();
      internals.stage.destroy();
      facade.markDisposed();
    },
  };
}

function notifyRuntimeError(options: RendererRuntimeOptions, cause: unknown): RendererError {
  const error = cause instanceof RendererError
    ? cause
    : new RendererError('Renderer runtime initialization failed', {
      code: 'LAYER_INITIALIZATION_FAILED',
      domain: 'runtime',
      cause,
    });
  try {
    options.onError?.(error);
  } catch {
    // Error reporting must not hide the original initialization failure.
  }
  return error;
}

export async function createRendererRuntime(options: RendererRuntimeOptions = {}): Promise<RendererRuntime> {
  const stage = new PixiStage();
  try {
    await stage.init(options.canvas);
    if (options.quality !== undefined) stage.setQuality(options.quality);
    if (options.preferences !== undefined) stage.setPresentationPreferences(options.preferences);

    const controllerOptions: AdvRendererOptions = {
      ...(options.typewriter ? { typewriter: options.typewriter } : {}),
      ...(options.backlog ? { backlog: options.backlog } : {}),
      ...(options.pluginHost ? { pluginHost: options.pluginHost } : {}),
      ...(options.onAdvance ? { onAdvance: options.onAdvance } : {}),
      ...(options.onSelect ? { onSelect: options.onSelect } : {}),
      ...(options.onWaitEnd ? { onWaitEnd: options.onWaitEnd } : {}),
    };
    const legacy = new AdvRenderer(stage, options.audio ?? NULL_AUDIO, controllerOptions);
    if (options.onBacklogClose) {
      const legacyClose = stage.onBacklogClose;
      stage.onBacklogClose = () => {
        legacyClose?.();
        options.onBacklogClose?.();
      };
    }
    const controller = new LegacyPresentationControllerAdapter(legacy, stage);
    const monitor = options.performanceMonitor ?? new RenderPerformanceMonitor();
    const scheduler = new FrameScheduler(stage.app!, controller, [stage], { monitor });
    return createRendererRuntimeFromInternals({
      canvas: stage.app!.canvas,
      stage,
      controller,
      scheduler,
      monitor,
    });
  } catch (cause) {
    stage.destroy();
    throw notifyRuntimeError(options, cause);
  }
}
