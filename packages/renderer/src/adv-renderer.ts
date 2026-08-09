/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * This module remains as a one-version compatibility export only.
 */
export {
  AdvRenderer,
  createPresentationPorts,
} from './legacy/legacy-renderer-adapter.js';
export type {
  AdvRendererOptions,
  PresentationPortOptions,
  PresentationPorts,
  RenderStatus,
} from './legacy/legacy-renderer-adapter.js';
export { parseColor } from './runtime/presentation-controller.js';
