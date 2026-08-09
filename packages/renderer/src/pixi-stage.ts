import type { RenderAssetRegistry } from './services/render-asset-registry.js';
import type { RenderLifecycle } from './lifecycle/render-lifecycle.js';
import { RendererStageHost } from './pixi-stage-host.js';
import { LegacyStageAdapter } from './legacy/legacy-stage-adapter.js';

/** Keep the legacy public type path while the source of truth lives in battle-view.ts. */
export type { BattleHandlers } from './battle-view.js';
export type { FontRole } from './pixi-stage-host.js';
export { LegacyStageAdapter } from './legacy/legacy-stage-adapter.js';

/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * Compatibility is retained for Wave 2 and scheduled for removal in the next major version.
 */
export class PixiStage extends LegacyStageAdapter {
  constructor(assetRegistry?: RenderAssetRegistry, lifecycle?: RenderLifecycle) {
    super(new RendererStageHost(assetRegistry, lifecycle));
  }
}
