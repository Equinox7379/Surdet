/**
 * @surdet/renderer — PixiJS 渲染层。
 * 订阅内核事件总线，把 text/choice/instr 事件投影到舞台。
 */
export * from './backlog.js';
export * from './battle-view.js';
export * from './dequote.js';
export * from './gallery.js';
export * from './gamepad.js';
export * from './text-buffer.js';
export * from './transitions.js';
export type { StoryFilterSnapshot } from './story-filter.js';
export * from './timeline-player.js';
export * from './types.js';
export * from './audio-manager.js';
export * from './ruby.js';
export * from './ruby-layout.js';
export * from './settings-store.js';
export * from './text-wrap.js';
export * from './reading-diagnostics.js';
export * from './ui-views.js';
export * from './frame-scheduler.js';
export * from './performance.js';
export * from './quality.js';
export * from './resource-lifecycle.js';
export * from './lifecycle/render-lifecycle.js';
export * from './lifecycle/async-generation.js';
export * from './services/render-asset-registry.js';
export * from './presentation.js';
export * from './localization.js';
export * from './plugin-host.js';
export * from './post-process.js';
export * from './loading-progress.js';
export * from './theme.js';
export * from './project-ui-dom.js';
export * from './project-ui-style-dom.js';
export * from './loading-layer.js';
export * from './rollback-buffer.js';
export * from './transition-registry.js';
export * from './world-effects-controller.js';
export * from './layers/dialogue/dialogue-layer.js';
export * from './layers/menu/menu-layer.js';
export * from './layers/gallery/gallery-layer.js';
export * from './layers/system-panel/system-panel-layer.js';
export * from './layers/world/world-layer.js';
export * from './keybindings.js';
export * from './backlog-search-controller.js';
export * from './scene-hot-reload.js';
export * from './diagnostics/renderer-baseline.js';
export * from './diagnostics/renderer-baseline-v3.js';
export * from './api/renderer-errors.js';
export * from './api/renderer-input.js';
export * from './api/renderer-commands.js';
export * from './api/renderer-queries.js';
export * from './api/renderer-runtime.js';

/** Renderer v2 public composition root. Consumers should create one runtime per preview/game session. */
export { createRendererRuntime } from './runtime/create-renderer-runtime.js';
export { PresentationController } from './runtime/presentation-controller.js';

/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * Compatibility is retained for Wave 2 and scheduled for removal in the next major version.
 */
export {
  AdvRenderer,
  createPresentationPorts,
  parseColor,
} from './adv-renderer.js';
/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * Compatibility is retained for Wave 2 and scheduled for removal in the next major version.
 */
export type {
  AdvRendererOptions,
  PresentationPortOptions,
  PresentationPorts,
  RenderStatus,
} from './adv-renderer.js';

/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * Compatibility is retained for Wave 2 and scheduled for removal in the next major version.
 */
export { PixiStage, LegacyStageAdapter } from './pixi-stage.js';
/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * Compatibility is retained for Wave 2 and scheduled for removal in the next major version.
 */
export type { BattleHandlers, FontRole } from './pixi-stage.js';
export { isPlayerControlPointer } from './player-controls.js';
export { SystemNarrator } from './system-narrator.js';
