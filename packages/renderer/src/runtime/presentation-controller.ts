import type { CoreEventMap, EventBus, Unsubscribe } from '@surdet/core';
import { AdvRenderer, type AdvRendererOptions } from '../adv-renderer.js';
import type { RendererInputAction } from '../api/renderer-input.js';
import type { ResetSessionOptions } from '../api/renderer-runtime.js';
import type { RenderLifecycle } from '../lifecycle/render-lifecycle.js';
import type { AudioHandle, AdvStage } from '../types.js';

export interface PresentationControllerOptions extends AdvRendererOptions {
  lifecycle?: RenderLifecycle;
}

/**
 * M2 presentation coordinator.
 *
 * The existing AdvRenderer remains the compatibility implementation so every
 * legacy test and constructor keeps its behavior. The runtime now constructs
 * this controller, which owns the v2 connection and normalized input boundary
 * while delegating the already-tested presentation state machine exactly once.
 */
export class PresentationController extends AdvRenderer {
  #disposed = false;
  #lifecycle?: RenderLifecycle;

  constructor(stage: AdvStage, audio?: AudioHandle, options?: PresentationControllerOptions) {
    const { lifecycle, ...legacyOptions } = options ?? {};
    super(stage, audio, legacyOptions);
    this.#lifecycle = lifecycle;
  }

  override connect(bus: EventBus<CoreEventMap>): Unsubscribe {
    if (this.#disposed) return () => undefined;
    const unsubscribe = super.connect(bus);
    if (!this.#lifecycle) return unsubscribe;
    const key = 'core-events';
    let active = true;
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      unsubscribe();
      this.#lifecycle?.forget('runtime', 'listener', key);
    };
    this.#lifecycle.register('runtime', 'listener', key, cleanup);
    return cleanup;
  }

  reset(options?: ResetSessionOptions): void {
    if (this.#disposed) return;
    this.resetSession(options);
  }

  dispatchInput(action: RendererInputAction): boolean {
    if (this.#disposed) return false;
    switch (action.type) {
      case 'advance':
        return this.advance();
      case 'choice.move':
        if (this.status !== 'choice') return false;
        if (action.delta < 0) this.choiceUp();
        else this.choiceDown();
        return true;
      case 'choice.select':
        return this.select(action.index);
      case 'backlog.toggle':
        return this.toggleBacklog();
      case 'backlog.scroll':
        return this.scrollBacklog(action.delta);
      case 'auto.toggle':
        return this.toggleAuto();
      case 'skip.toggle':
        return action.scope === 'all' ? this.toggleSkipAll() : this.toggleSkip();
      case 'interface.toggle':
        return this.toggleHideInterface();
      case 'escape':
        return this.handleBacklogEscape();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#lifecycle?.release('runtime', 'listener', 'core-events');
    this.#disposed = true;
    this.destroy();
  }
}
