import { type CoreEventMap, type EventBus, type Unsubscribe, type PresentationSnapshotContext, type PresentationRestoreResult } from '@surdet/core';
import type { BacklogEntry } from '../backlog.js';
import { NULL_AUDIO, type AdvStage, type AudioHandle, type FrameRequestHandler } from '../types.js';
import {
  PresentationController,
  type AdvRendererOptions,
  type PresentationControllerOptions,
  type RenderStatus,
} from '../runtime/presentation-controller.js';
import { createPresentationPorts } from '../runtime/presentation-ports.js';
import type { RendererInputAction } from '../api/renderer-input.js';
import type { ResetSessionOptions } from '../api/renderer-runtime.js';

export { createPresentationPorts };
export type { PresentationPortOptions, PresentationPorts } from '../runtime/presentation-ports.js';
export type { AdvRendererOptions, RenderStatus } from '../runtime/presentation-controller.js';
export { parseColor } from '../runtime/presentation-controller.js';

/**
 * Legacy compatibility wrapper.
 *
 * AdvRenderer intentionally contains no presentation state machine. It adapts
 * the historical `(stage, audio, options)` constructor to the independent
 * PresentationController and delegates every legacy method/getter to it.
 */
/** @deprecated Use createRendererRuntime() and RendererRuntime.commands/queries. */
export class AdvRenderer {
  readonly presentationOwnsStage = true;
  readonly #controller: PresentationController;

  constructor(stage: AdvStage, audio: AudioHandle = NULL_AUDIO, options: AdvRendererOptions = {}) {
    const ports = createPresentationPorts(stage);
    options.pluginHost?.attach(stage);
    const controllerOptions: PresentationControllerOptions = {
      ...options,
      commands: ports.commands,
      queries: ports.queries,
      validateStagePresentation: ports.validateStagePresentation,
      resetProjection: (resetOptions) => stage.resetSession?.(resetOptions),
      updateProjection: (deltaMs) => {
        stage.updateContinuePulse?.(deltaMs);
        stage.updateEffects?.(deltaMs);
      },
      canScrollBacklog: () => stage.scrollBacklog !== undefined,
      bindStageCallbacks: (handlers) => {
        stage.onSelect = handlers.onSelect;
        stage.onBacklogClose = handlers.onBacklogClose;
        return () => {
          stage.onSelect = null;
          stage.onBacklogClose = null;
        };
      },
      detachPlugin: () => options.pluginHost?.detach(),
    };
    this.#controller = new PresentationController(ports.commands, ports.queries, audio, controllerOptions);
  }

  get status(): RenderStatus { return this.#controller.status; }
  get needsUpdate(): boolean { return this.#controller.needsUpdate; }
  get interfaceHidden(): boolean { return this.#controller.interfaceHidden; }
  get backlogOpen(): boolean { return this.#controller.backlogOpen; }
  get backlogSearchQuery(): string { return this.#controller.backlogSearchQuery(); }
  get skipAll(): boolean { return this.#controller.skipAll; }
  get autoPlay(): boolean { return this.#controller.autoPlay; }
  get skipMode(): boolean { return this.#controller.skipMode; }

  setFrameRequest(handler: FrameRequestHandler | null): void { this.#controller.setFrameRequest(handler); }
  connect(bus: EventBus<CoreEventMap>): Unsubscribe { return this.#controller.connect(bus); }
  disconnect(): void { this.#controller.disconnect(); }
  subscribe(bus: EventBus<CoreEventMap>): void { this.#controller.subscribe(bus); }
  destroy(): void { this.#controller.destroy(); }
  dispose(): void { this.#controller.dispose(); }
  reset(options?: ResetSessionOptions): void { this.#controller.reset(options); }
  resetSession(options?: ResetSessionOptions): void { this.#controller.resetSession(options); }
  update(deltaMs: number): void { this.#controller.update(deltaMs); }

  setTextSpeed(charsPerSecond: number): void { this.#controller.setTextSpeed(charsPerSecond); }
  setAutoWait(baseDelayMs: number, perCharMs: number): void { this.#controller.setAutoWait(baseDelayMs, perCharMs); }
  toggleBacklog(): boolean { return this.#controller.toggleBacklog(); }
  toggleHideInterface(): boolean { return this.#controller.toggleHideInterface(); }
  focusBacklogSearch(): boolean { return this.#controller.focusBacklogSearch(); }
  appendBacklogSearch(value: string): boolean { return this.#controller.appendBacklogSearch(value); }
  scrollBacklog(delta: number): boolean { return this.#controller.scrollBacklog(delta); }
  backspaceBacklogSearch(): boolean { return this.#controller.backspaceBacklogSearch(); }
  handleBacklogEscape(): boolean { return this.#controller.handleBacklogEscape(); }
  toggleAuto(): boolean { return this.#controller.toggleAuto(); }
  toggleSkip(): boolean { return this.#controller.toggleSkip(); }
  toggleSkipAll(): boolean { return this.#controller.toggleSkipAll(); }
  advance(): boolean { return this.#controller.advance(); }
  select(index: number): boolean { return this.#controller.select(index); }
  choiceUp(): void { this.#controller.choiceUp(); }
  choiceDown(): void { this.#controller.choiceDown(); }
  choiceConfirm(): boolean { return this.#controller.choiceConfirm(); }
  selectChoiceAt(position: number): boolean { return this.#controller.selectChoiceAt(position); }
  dispatchInput(action: RendererInputAction): boolean { return this.#controller.dispatchInput(action); }
  backlogEntries(): readonly BacklogEntry[] { return this.#controller.backlogEntries(); }
  snapshotPresentation(context?: PresentationSnapshotContext): unknown { return this.#controller.snapshotPresentation(context); }
  validatePresentation(snapshot: unknown): void { this.#controller.validatePresentation(snapshot); }
  clearPresentation(): void { this.#controller.clearPresentation(); }
  restorePresentation(snapshot: unknown): PresentationRestoreResult { return this.#controller.restorePresentation(snapshot); }
}
