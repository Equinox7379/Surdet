import { type CoreEventMap, type EventBus, type Unsubscribe } from '@surdet/core';
import { FrameScheduler } from '../frame-scheduler.js';
import { NULL_AUDIO } from '../types.js';
import { PixiStage } from '../pixi-stage.js';
import { RenderPerformanceMonitor } from '../performance.js';
import { RendererError } from '../api/renderer-errors.js';
import { RenderLifecycle } from '../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../services/render-asset-registry.js';
import {
  PresentationController as RuntimePresentationController,
  type PresentationControllerOptions,
} from './presentation-controller.js';
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
  readonly assetRegistry?: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
}

/**
 * Compatibility adapter around the current AdvRenderer. It keeps the old
 * state machine intact while exposing the M1 controller port to the facade.
 */
class LegacyPresentationControllerAdapter implements RendererControllerPort {
  readonly #legacy: RuntimePresentationController;
  #disposed = false;

  constructor(legacy: RuntimePresentationController) {
    this.#legacy = legacy;
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
    return this.#legacy.connect(bus);
  }

  reset(options?: ResetSessionOptions): void { this.#legacy.resetSession(options); }
  advance(): boolean { return this.#legacy.advance(); }
  select(index: number): boolean { return this.#legacy.select(index); }

  dispatchInput(action: RendererInputAction): boolean {
    return this.#disposed ? false : this.#legacy.dispatchInput(action);
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
    this.#legacy.dispose();
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
    resourceSnapshot: internals.resourceSnapshot
      ?? (internals.lifecycle ? () => internals.lifecycle!.snapshot() : undefined),
    assetRegistry: internals.assetRegistry,
  };
  if (internals.lifecycle) {
    internals.lifecycle.register('runtime', 'ticker', 'frame-scheduler', () => internals.scheduler.dispose());
    internals.lifecycle.register('runtime', 'listener', 'presentation-controller', () => internals.controller.dispose());
  }
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
      if (internals.lifecycle) {
        internals.lifecycle.release('runtime', 'ticker', 'frame-scheduler');
        internals.lifecycle.release('runtime', 'listener', 'presentation-controller');
      } else {
        internals.scheduler.dispose();
        internals.controller.dispose();
      }
      internals.stage.destroy();
      internals.assetRegistry?.dispose();
      internals.lifecycle?.dispose();
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
  const lifecycle = new RenderLifecycle();
  const assetRegistry = new RenderAssetRegistry({ lifecycle });
  const stage = new PixiStage(assetRegistry);
  try {
    await stage.init(options.canvas);
    if (options.quality !== undefined) stage.setQuality(options.quality);
    if (options.preferences !== undefined) stage.setPresentationPreferences(options.preferences);

    const controllerOptions: PresentationControllerOptions = {
      ...(options.typewriter ? { typewriter: options.typewriter } : {}),
      ...(options.backlog ? { backlog: options.backlog } : {}),
      ...(options.pluginHost ? { pluginHost: options.pluginHost } : {}),
      ...(options.onAdvance ? { onAdvance: options.onAdvance } : {}),
      ...(options.onSelect ? { onSelect: options.onSelect } : {}),
      ...(options.onWaitEnd ? { onWaitEnd: options.onWaitEnd } : {}),
      lifecycle,
    };
    const legacy = new RuntimePresentationController(stage, options.audio ?? NULL_AUDIO, controllerOptions);
    if (options.onBacklogClose) {
      const legacyClose = stage.onBacklogClose;
      stage.onBacklogClose = () => {
        legacyClose?.();
        options.onBacklogClose?.();
      };
    }
    const controller = new LegacyPresentationControllerAdapter(legacy);
    const monitor = options.performanceMonitor ?? new RenderPerformanceMonitor();
    const scheduler = new FrameScheduler(stage.app!, controller, [stage], { monitor });
    return createRendererRuntimeFromInternals({
      canvas: stage.app!.canvas,
      stage,
      controller,
      scheduler,
      monitor,
      assetRegistry,
      lifecycle,
      resourceSnapshot: () => lifecycle.snapshot(),
    });
  } catch (cause) {
    stage.destroy();
    assetRegistry.dispose();
    lifecycle.dispose();
    throw notifyRuntimeError(options, cause);
  }
}
