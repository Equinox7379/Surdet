import type { PresentationSnapshotContext } from '@surdet/core';
import type { BacklogEntry } from '../backlog.js';
import type { PostProcessSettings } from '../post-process.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderPerformanceSnapshot } from '../performance.js';
import type { RenderQuality } from '../quality.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';
import type { RendererFontRole } from './renderer-commands.js';
import type { RendererTheme } from '../theme.js';
import type { LayerThemeProjectionSnapshot } from '../theme-projection.js';
import type { RenderLifecycleDiagnosticSnapshot } from '../lifecycle/render-lifecycle.js';

export interface WorldQueries {
  isFadeActive?(): boolean;
  inspectStage?(): import('@surdet/core').StageInspection | null;
  /** Expensive but read-only visual capture; does not change the visible stage. */
  captureThumbnail(): string | null;
}

export interface NvlPresentationEntry {
  readonly speaker: string | null;
  readonly text: string;
}

export interface DialogueQueries {
  backlogEntries(): readonly BacklogEntry[];
  backlogSearchQuery(): string;
  nvlPresentationEntries(): readonly NvlPresentationEntry[];
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
  theme(): RendererTheme;
}

export interface PresentationQueries {
  snapshot(context?: PresentationSnapshotContext): unknown;
  /** Whether the current presentation can be captured as a stable rollback checkpoint. */
  canCaptureRollbackCheckpoint(): boolean;
}

/** Plain-data read model for the renderer's semantic projection evidence. */
export interface DialogueProjectionSnapshot {
  readonly activeSpeakerId: string | null;
  readonly projectionVersion: number;
  readonly speakerText: string;
  readonly dialogText: string;
  readonly choiceLabels: readonly string[];
  readonly choiceBounds: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
  readonly visibleChoiceCount: number;
  readonly rubyBaseCount: number;
  readonly rubyTextCount: number;
  readonly backlogVisible: boolean;
  /** True when the real Backlog overlay root renders above dialogue text. */
  readonly backlogAboveDialogueText: boolean;
  /** Real command-rail projection state; not derived from host session flags. */
  readonly commandRailVisible: boolean;
  readonly commandRailSuppressed: boolean;
  readonly nvlActive: boolean;
  readonly nvlLines: readonly string[];
  /** Current displayed text only; not certification of unplayed scenes or OS fallback fonts. */
  readonly readingDiagnostics?: readonly import('../reading-diagnostics.js').ReadingDiagnostic[];
}

export interface MenuProjectionSnapshot {
  readonly overlay: MenuOverlayState;
  readonly titleItemCount: number;
  readonly titleTargets?: readonly { id: string; x: number; y: number; width: number; height: number }[];
  readonly systemMenuItemCount: number;
  readonly settingsRowCount: number;
  readonly saveLoadSlotCount: number;
}

export interface GalleryProjectionSnapshot {
  readonly overlay: GalleryOverlayState;
  readonly cgCount: number;
  readonly musicCount: number;
  readonly textCount: number;
}

export interface SystemPanelProjectionSnapshot {
  readonly overlay: SystemPanelOverlayState;
  readonly battleUnitCount: number;
  readonly mapNodeCount: number;
  readonly shopItemCount: number;
  readonly baseCommandCount: number;
}

export interface WorldProjectionSnapshot {
  readonly activeSpeakerId: string | null;
  readonly backgroundKey: string | null;
  readonly particleKind: string | null;
}

export interface RendererProjectionSnapshot {
  readonly dialogue: DialogueProjectionSnapshot | null;
  readonly menu: MenuProjectionSnapshot | null;
  readonly gallery: GalleryProjectionSnapshot | null;
  readonly system: SystemPanelProjectionSnapshot | null;
  readonly world: WorldProjectionSnapshot | null;
  /** Real visible Pixi style evidence; contains plain data only. */
  readonly themeProjection?: RendererThemeProjectionSnapshot;
}

export interface RendererThemeProjectionSnapshot {
  readonly dialogue: LayerThemeProjectionSnapshot;
  readonly menu: LayerThemeProjectionSnapshot;
  readonly gallery: LayerThemeProjectionSnapshot;
  readonly system: LayerThemeProjectionSnapshot;
  readonly loading: LayerThemeProjectionSnapshot;
}

export interface RendererDiagnosticQueries {
  /** Inspect configured-font coverage without treating OS fallback as a portable guarantee. */
  fontText?(role: RendererFontRole, text: string, target: string): readonly import('../reading-diagnostics.js').ReadingDiagnostic[];
  resourceSnapshot(): RendererResourceSnapshot;
  /** Recursively frozen, isolated lifecycle identity ledger; never exposes disposers or display objects. */
  resourceLedger?(): RenderLifecycleDiagnosticSnapshot;
  performanceSnapshot(): RenderPerformanceSnapshot | null;
  /** Pure semantic projection read model; returns no Layer or Pixi object. */
  projectionSnapshot(): RendererProjectionSnapshot;
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
