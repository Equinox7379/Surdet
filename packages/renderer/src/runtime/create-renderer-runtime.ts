import { FrameScheduler } from '../frame-scheduler.js';
import { NULL_AUDIO } from '../types.js';
import { RendererStageHost } from '../pixi-stage-host.js';
import { RenderPerformanceMonitor } from '../performance.js';
import { RendererError } from '../api/renderer-errors.js';
import { RenderLifecycle } from '../lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../services/render-asset-registry.js';
import { createPresentationPorts, type PresentationPorts } from './presentation-ports.js';
import {
  PresentationController as RuntimePresentationController,
  type PresentationControllerOptions,
} from './presentation-controller.js';
import type {
  RendererRuntime,
  RendererRuntimeOptions,
} from '../api/renderer-runtime.js';
import {
  RendererFacade,
  type RendererControllerPort,
  type RendererFacadeOptions,
  type RendererStagePort,
} from './renderer-facade.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';
import type { DialogueProjectionPort, GalleryProjectionPort, MenuProjectionPort, SystemPanelProjectionPort, WorldProjectionPort } from '../api/renderer-commands.js';
import type { RendererProjectionSnapshot } from '../api/renderer-queries.js';

export type { RendererControllerPort, RendererStagePort } from './renderer-facade.js';

export interface RendererRuntimeInternals {
  readonly canvas: HTMLCanvasElement;
  readonly stage: RendererStagePort;
  readonly controller: RendererControllerPort;
  readonly scheduler: { dispose(): void };
  readonly monitor: RenderPerformanceMonitor;
  readonly resourceSnapshot?: () => RendererResourceSnapshot;
  readonly resourceLedger?: () => import('../lifecycle/render-lifecycle.js').RenderLifecycleDiagnosticSnapshot;
  readonly assetRegistry?: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
  readonly dialogueLayer?: DialogueProjectionPort;
  readonly menuLayer?: MenuProjectionPort;
  readonly galleryLayer?: GalleryProjectionPort;
  readonly systemPanelLayer?: SystemPanelProjectionPort;
  readonly worldLayer?: WorldProjectionPort;
  readonly projectionSnapshot?: () => RendererProjectionSnapshot;
}

interface CleanupParts {
  readonly scheduler?: { dispose(): void };
  readonly controller?: { dispose(): void };
  readonly stage?: { destroy(): void };
  readonly assetRegistry?: { dispose(): void };
  readonly lifecycle?: RenderLifecycle;
  readonly facade?: { markDisposed(): void };
  readonly detachPlugin?: () => void;
}

interface CleanupAction {
  readonly name: string;
  readonly run: () => void;
}

function cleanupActions(parts: CleanupParts): CleanupAction[] {
  const actions: CleanupAction[] = [];
  if (parts.lifecycle) {
    if (parts.scheduler) {
      actions.push({
        name: 'frame-scheduler',
        run: () => { parts.lifecycle!.release('runtime', 'ticker', 'frame-scheduler'); },
      });
    }
    if (parts.controller) {
      actions.push({
        name: 'presentation-controller',
        run: () => { parts.lifecycle!.release('runtime', 'listener', 'presentation-controller'); },
      });
    }
  } else {
    if (parts.scheduler) actions.push({ name: 'frame-scheduler', run: () => parts.scheduler!.dispose() });
    if (parts.controller) actions.push({ name: 'presentation-controller', run: () => parts.controller!.dispose() });
  }
  if (parts.stage) actions.push({ name: 'stage', run: () => parts.stage!.destroy() });
  if (parts.assetRegistry) actions.push({ name: 'asset-registry', run: () => parts.assetRegistry!.dispose() });
  if (parts.lifecycle) actions.push({ name: 'lifecycle', run: () => parts.lifecycle!.dispose() });
  if (parts.detachPlugin) actions.push({ name: 'plugin-host', run: parts.detachPlugin });
  if (parts.facade) actions.push({ name: 'facade', run: () => parts.facade!.markDisposed() });
  return actions;
}

function runCleanup(parts: CleanupParts): unknown[] {
  const failures: unknown[] = [];
  for (const action of cleanupActions(parts)) {
    try {
      action.run();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function aggregateFailure(message: string, command: string, failures: readonly unknown[]): RendererError {
  return new RendererError(message, {
    code: 'COMMAND_COMMIT_FAILED',
    domain: 'runtime',
    command,
    cause: new AggregateError(failures, message),
  });
}

function initializationFailure(cause: unknown, cleanupFailures: readonly unknown[]): RendererError {
  const failures = [cause, ...cleanupFailures];
  return new RendererError('Renderer runtime initialization failed', {
    code: 'LAYER_INITIALIZATION_FAILED',
    domain: 'runtime',
    command: 'initialize',
    cause: new AggregateError(failures, 'Renderer runtime initialization failed'),
  });
}

/** @internal Test-only composition root; it deliberately stays out of the package public export. */
export async function createRendererRuntimeFromInternals(
  internals: RendererRuntimeInternals,
): Promise<RendererRuntime> {
  let facade: RendererFacade | undefined;
  try {
    if (internals.lifecycle) {
      internals.lifecycle.register('runtime', 'ticker', 'frame-scheduler', () => internals.scheduler.dispose());
      internals.lifecycle.register('runtime', 'listener', 'presentation-controller', () => internals.controller.dispose());
    }
    const facadeOptions: RendererFacadeOptions = {
      stage: internals.stage,
      controller: internals.controller as RuntimePresentationController,
      monitor: internals.monitor,
      resourceSnapshot: internals.resourceSnapshot
        ?? (internals.lifecycle ? () => internals.lifecycle!.snapshot() : undefined),
      resourceLedger: internals.resourceLedger
        ?? (internals.lifecycle ? () => internals.lifecycle!.diagnostics() : undefined),
      assetRegistry: internals.assetRegistry,
      dialogueLayer: internals.dialogueLayer,
      menuLayer: internals.menuLayer,
      galleryLayer: internals.galleryLayer,
      systemPanelLayer: internals.systemPanelLayer,
      worldLayer: internals.worldLayer,
      projectionSnapshot: internals.projectionSnapshot,
    };
    facade = new RendererFacade(facadeOptions);
    let disposed = false;
    const runtime: RendererRuntime = {
      canvas: internals.canvas,
      commands: facade.commands,
      queries: facade.queries,
      controller: internals.controller as RuntimePresentationController,
      resize: () => facade!.resize(),
      resetSession: (options) => facade!.resetSession(options),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const failures = runCleanup({ ...internals, facade });
        if (failures.length > 0) {
          throw aggregateFailure('Renderer runtime disposal failed', 'dispose', failures);
        }
      },
    };
    return runtime;
  } catch (cause) {
    const cleanupFailures = runCleanup({ ...internals, facade });
    throw initializationFailure(cause, cleanupFailures);
  }
}

function notifyRuntimeError(options: RendererRuntimeOptions, cause: unknown): RendererError {
  const error = cause instanceof RendererError
    ? cause
    : initializationFailure(cause, []);
  try {
    options.onError?.(error);
  } catch {
    // Error reporting must not hide the original initialization failure.
  }
  return error;
}

function createControllerOptions(
  stage: RendererStageHost,
  ports: PresentationPorts,
  lifecycle: RenderLifecycle,
  options: RendererRuntimeOptions,
): PresentationControllerOptions {
  const previousBacklogClose = stage.onBacklogClose;
  const previousPointerConsumed = stage.onPointerConsumed;
  if (options.pluginHost) options.pluginHost.attach(stage);
  stage.onPointerConsumed = options.onPointerConsumed ?? null;
  return {
    ...(options.typewriter ? { typewriter: options.typewriter } : {}),
    ...(options.narrator ? { narrator: options.narrator } : {}),
    ...(options.backlog ? { backlog: options.backlog } : {}),
    ...(options.pluginHost ? { pluginHost: options.pluginHost } : {}),
    ...(options.onAdvance ? { onAdvance: options.onAdvance } : {}),
    ...(options.onSelect ? { onSelect: options.onSelect } : {}),
    ...(options.onWaitEnd ? { onWaitEnd: options.onWaitEnd } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    commands: ports.commands,
    queries: ports.queries,
    validateStagePresentation: ports.validateStagePresentation,
    lifecycle,
    resetProjection: (resetOptions) => stage.resetSession?.(resetOptions),
    updateProjection: (deltaMs) => {
      stage.updateContinuePulse?.(deltaMs);
      stage.updateEffects?.(deltaMs);
    },
    // 暂停期间只推进菜单与顶层提示，不经由 updateEffects 推进剧情演出。
    updateMenuProjection: (deltaMs) => stage.updateMenu?.(deltaMs),
    canScrollBacklog: () => stage.scrollBacklog !== undefined,
    bindStageCallbacks: (handlers) => {
      stage.onSelect = handlers.onSelect;
      stage.onBacklogClose = () => {
        previousBacklogClose?.();
        handlers.onBacklogClose();
        options.onBacklogClose?.();
      };
      return () => {
        stage.onSelect = null;
        stage.onBacklogClose = null;
        stage.onPointerConsumed = previousPointerConsumed;
      };
    },
    detachPlugin: () => options.pluginHost?.detach(),
  };
}

export async function createRendererRuntime(options: RendererRuntimeOptions = {}): Promise<RendererRuntime> {
  const lifecycle = new RenderLifecycle();
  let assetRegistry: RenderAssetRegistry | undefined;
  let stage: RendererStageHost | undefined;
  let scheduler: FrameScheduler | undefined;
  let controller: RuntimePresentationController | undefined;
  let compositionAttempted = false;
  try {
    assetRegistry = new RenderAssetRegistry({ lifecycle });
    stage = new RendererStageHost(assetRegistry, lifecycle, options.stage);
    await stage.init(options.canvas);
    if (options.quality !== undefined) stage.setQuality(options.quality);
    if (options.preferences !== undefined) stage.setPresentationPreferences(options.preferences);

    const ports = createPresentationPorts(stage, {
      assetRegistry,
      resourceSnapshot: () => lifecycle.snapshot(),
      worldLayer: stage.worldLayer,
      menuLayer: stage.menuLayer,
      dialogueLayer: stage.dialogueLayer,
      projectionSnapshot: () => stage!.projectionSnapshot,
    });
    const controllerOptions = createControllerOptions(stage, ports, lifecycle, options);
    controller = new RuntimePresentationController(ports.commands, ports.queries, options.audio ?? NULL_AUDIO, controllerOptions);
    const monitor = options.performanceMonitor ?? new RenderPerformanceMonitor();
    // RendererStageHost is the composition-root frame source and already aggregates
    // WorldLayer/DialogueLayer/MenuLayer update work. Registering WorldLayer
    // separately duplicates its wake-up path (WorldLayer also calls the Stage
    // callback), so keep one production scheduler source.
    scheduler = new FrameScheduler(stage.app!, controller, [stage], { monitor });
    compositionAttempted = true;
    return await createRendererRuntimeFromInternals({
      canvas: stage.app!.canvas,
      stage,
      controller,
      scheduler,
      monitor,
      assetRegistry,
      lifecycle,
      resourceSnapshot: () => lifecycle.snapshot(),
      resourceLedger: () => lifecycle.diagnostics(),
      dialogueLayer: stage.dialogueLayer,
      menuLayer: stage.menuLayer,
      galleryLayer: stage.galleryLayer,
      systemPanelLayer: stage.systemPanelLayer,
      worldLayer: stage.worldLayer,
      projectionSnapshot: () => stage!.projectionSnapshot,
    });
  } catch (cause) {
    const cleanupFailures = compositionAttempted
      ? []
      : runCleanup({
        scheduler,
        controller,
        stage,
        assetRegistry,
        lifecycle,
        detachPlugin: options.pluginHost ? () => options.pluginHost!.detach() : undefined,
      });
    throw notifyRuntimeError(options, initializationFailure(cause, cleanupFailures));
  }
}
