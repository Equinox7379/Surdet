/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * This module remains as a one-version compatibility export only.
 */
export {
  AdvRenderer,
} from './legacy/legacy-renderer-adapter.js';
export { createPresentationPorts } from './runtime/presentation-ports.js';
export type {
  AdvRendererOptions,
  PresentationPortOptions,
  PresentationPorts,
  RenderStatus,
} from './legacy/legacy-renderer-adapter.js';
export { parseColor } from './runtime/presentation-controller.js';
