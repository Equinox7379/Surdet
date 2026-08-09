import type { BacklogEntry } from '../backlog.js';
import type { PostProcessSettings } from '../post-process.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderPerformanceSnapshot } from '../performance.js';
import type { RenderQuality } from '../quality.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';
import type { RendererFontRole } from './renderer-commands.js';

export interface WorldQueries {
  /** Expensive but read-only visual capture; does not change the visible stage. */
  captureThumbnail(): string | null;
}

export interface DialogueQueries {
  backlogEntries(): readonly BacklogEntry[];
  backlogSearchQuery(): string;
}

/** Menu overlay state is locked now; other overlay families are added by later milestones. */
export type MenuOverlayState =
  | { type: 'none' }
  | { type: 'title' }
  | { type: 'ending' }
  | { type: 'system-menu' }
  | { type: 'settings' }
  | { type: 'save-load'; mode: 'save' | 'load' };

export type GalleryOverlayState =
  | { type: 'none' }
  | { type: 'gallery'; tab: 'cg' | 'music' | 'text'; mode: 'grid' | 'viewer'; viewerKey: string | null };

export type SystemPanelOverlayState =
  | { type: 'none' }
  | { type: 'battle' }
  | { type: 'map' }
  | { type: 'shop' }
  | { type: 'base' }
  | { type: 'video' };

export interface OverlayQueries {
  menu(): MenuOverlayState;
  gallery(): GalleryOverlayState;
  system(): SystemPanelOverlayState;
}

export interface PreferenceQueries {
  quality(): RenderQuality;
  presentationPreferences(): PresentationPreferences;
  postProcess(): PostProcessSettings;
  fontFamily(role: RendererFontRole): string;
}

export interface PresentationQueries {
  snapshot(): unknown;
}

export interface RendererDiagnosticQueries {
  resourceSnapshot(): RendererResourceSnapshot;
  performanceSnapshot(): RenderPerformanceSnapshot | null;
  needsUpdate(): boolean;
  isDisposed(): boolean;
}

export interface RendererQueries {
  readonly world: WorldQueries;
  readonly dialogue: DialogueQueries;
  readonly overlay: OverlayQueries;
  readonly preferences: PreferenceQueries;
  readonly presentation: PresentationQueries;
  readonly diagnostics: RendererDiagnosticQueries;
}
