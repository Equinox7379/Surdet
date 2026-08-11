import type { BacklogEntry } from '../backlog.js';
import type { BattleHandlers, BattleView } from '../battle-view.js';
import type { GalleryItemView } from '../gallery.js';
import type { LoadingProgress } from '../loading-progress.js';
import type { PostProcessSettings } from '../post-process.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderQuality } from '../quality.js';
import type { SettingsRowView } from '../settings-store.js';
import type { TimelineFrameEvent } from '../timeline-player.js';
import type {
  ChoiceOptionView,
  CommandRailItem,
  FrameRequestHandler,
  PortraitView,
  SpeakerProfile,
} from '../types.js';
import type { ShakeDirection, TransitionName } from '../world-effects-controller.js';
import type {
  BasePanelView,
  MapView,
  SaveLoadView,
  SystemMenuItemView,
  TitleView,
} from '../ui-views.js';
import type { GalleryOverlayState, MenuOverlayState, SystemPanelOverlayState } from './renderer-queries.js';

/** M1 intentionally accepts URL/path strings; Pixi objects remain an internal legacy detail. */
export type RendererAssetSource = string;
export type RendererFontRole = 'title' | 'body' | 'ui';

export interface AssetCommands {
  registerBackground(key: string, source: RendererAssetSource, format?: string): Promise<void>;
  registerPortrait(charId: string, costume: string, expression: string, source: RendererAssetSource, format?: string): Promise<void>;
  registerAvatar(key: string, source: RendererAssetSource, format?: string): Promise<void>;
  registerFontRole(role: RendererFontRole, url: string, family?: string, timeoutMs?: number): Promise<boolean>;
  registerFont(url: string, family?: string, timeoutMs?: number): Promise<boolean>;
  resetFonts(): void;
  resetFont(): void;
  releaseRegisteredAssetSources(): Promise<void>;
}

export interface WorldCommands {
  setBackground(key: string | null): void;
  setPortrait(key: string, view: PortraitView): void;
  removePortrait(key: string): void;
  setFade(alpha: number): void;
  shake(durationMs?: number, strength?: number, direction?: ShakeDirection): void;
  transition(name: TransitionName | string, durationMs: number): boolean;
  flash(durationMs?: number): void;
  zoom(scale?: number, durationMs?: number): void;
  wipe(durationMs?: number): void;
  movePortrait(key: string, pos: string, durationMs?: number): void;
  setTint(color: number, alpha: number, durationMs?: number): void;
  clearTint(durationMs?: number): void;
  startParticles(kind: string): void;
  stopParticles(): void;
  applyTimelineFrame(event: TimelineFrameEvent): void;
  setPortraitFocus(characterId: string | null): void;
}

/**
 * WorldLayer's production projection port. The command surface remains the
 * same as WorldCommands; lifecycle, preference, snapshot, and frame-loop
 * capabilities are kept on the concrete world owner rather than on Facade.
 */
export interface WorldProjectionPort extends WorldCommands {
  readonly needsUpdate: boolean;
  setFrameRequest(handler: FrameRequestHandler | null): void;
  update(deltaMs: number): void;
  setQuality(quality: RenderQuality): void;
  getQuality(): RenderQuality;
  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void;
  getPresentationPreferences(): PresentationPreferences;
  setPostProcess(settings: Partial<PostProcessSettings>): void;
  getPostProcess(): PostProcessSettings;
  captureThumbnail(): string | null;
  snapshotPresentation(): unknown;
  /** Read-only validation/prepare hook used before a complete presentation commit. */
  validatePresentation?(snapshot: unknown): void;
  restorePresentation(snapshot: unknown): void;
  clearPresentation(): void;
  reset(options?: { preserveWorld?: boolean }): void;
}

export interface DialogueCommands {
  showText(speaker: string | null, value: string): void;
  /** Additive internal lifecycle command: begin a line while keeping its panel visible. */
  beginText?(speaker: string | null): void;
  /** Additive internal lifecycle command: explicitly clear and hide the current line. */
  clearText?(): void;
  showChoices(options: readonly ChoiceOptionView[]): void;
  hideChoices(): void;
  setAwaiting(awaiting: boolean): void;
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query?: string): void;
  hideBacklog(): void;
  setNvlMode(on: boolean): void;
  appendNvlText(speaker: string | null, text: string): void;
  clearNvlText(): void;
  showBanner(text: string, variant: 'chapter' | 'tip'): void;
  setChoiceHighlight(position: number): void;
  scrollBacklog(delta: number): void;
  hideInterface(hidden: boolean): void;
  setSpeakerProfiles(profiles: readonly SpeakerProfile[]): void;
  setActiveSpeaker(characterId: string | null): void;
  showCommandRail(items: readonly CommandRailItem[], onSelect: (id: string) => void): void;
  setCommandRailItems(items: readonly CommandRailItem[]): void;
  hideCommandRail(): void;
  restoreCommandRail(): void;
}

/**
 * Public renderer port for the extracted dialogue projection.
 *
 * `activeSpeakerId` is a pure read-only projection query. It lets the Facade
 * coordinate the World focus after `showText` derives a speaker profile without
 * giving DialogueLayer any World dependency or callback.
 */
export interface DialogueProjectionPort extends DialogueCommands {
  readonly activeSpeakerId: string | null;
  /** Increments only when a non-idempotent text projection is accepted. */
  readonly projectionVersion: number;
}

export type SaveLoadSelectionResult = void | boolean | Promise<void | boolean>;
export type SaveLoadSelectionHandler = (slotId: string) => SaveLoadSelectionResult;
export type SaveLoadCompletionStrategy = 'legacy-sync' | 'host-transaction';

/**
 * Save/load completion policy.
 *
 * `legacy-sync` is the one-version compatibility default for existing callers
 * whose callbacks finish synchronously.  New hosts must explicitly choose
 * `host-transaction` and return a Promise whose settlement represents the
 * complete storage transaction; the renderer never infers async work from a
 * void or boolean return value.
 */
export interface SaveLoadCommandOptions {
  readonly completion?: SaveLoadCompletionStrategy;
  /** Receives an unhandled host-transaction failure without hiding it. */
  readonly onTransactionError?: (error: unknown) => void;
  /** Invoked after the renderer has hidden a successfully completed page. */
  readonly onTransactionComplete?: () => void;
}

export interface MenuCommands {
  showTitle(view: TitleView, onSelect: (id: string) => void): void;
  hideTitle(restoreCommandRail?: boolean): void;
  showEnding(text?: string): void;
  hideEnding(): void;
  showSystemMenu(items: readonly SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void;
  hideSystemMenu(): void;
  showSettings(rows: readonly SettingsRowView[], onChange: (id: string, direction: -1 | 1) => void, onClose: () => void): void;
  hideSettings(): void;
  showSaveLoad(
    view: SaveLoadView,
    onSelect: SaveLoadSelectionHandler,
    onClose: () => void,
    options?: SaveLoadCommandOptions,
  ): void;
  hideSaveLoad(): void;
}

/** Public M4 menu projection port; overlay reads are pure and return safe values. */
export interface MenuProjectionPort extends MenuCommands {
  menu(): MenuOverlayState;
}

export interface GalleryCommands {
  showGallery(options: {
    cgs: readonly GalleryItemView[];
    music: readonly GalleryItemView[];
    texts?: readonly GalleryItemView[];
    onPlayMusic?: (id: string, source?: string) => void;
    onReplayText?: (item: GalleryItemView) => void;
    onClose?: () => void;
  }): void;
  hideGallery(): void;
}

/** Public M5 gallery projection port; overlay reads are pure and return safe values. */
export interface GalleryProjectionPort extends GalleryCommands {
  gallery(): GalleryOverlayState;
}

export interface ShopView {
  gold: number;
  items: readonly { id: string; name: string; price: number }[];
  message?: string;
}

export interface SystemPanelCommands {
  showBattle(view: BattleView, handlers: BattleHandlers, message?: string): void;
  hideBattle(): void;
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void;
  hideMap(): void;
  showShop(view: ShopView, onBuy: (itemId: string) => void, onClose: () => void): void;
  hideShop(): void;
  showBaseCommands(view: BasePanelView, onExecute: (commandId: string) => void, onClose: () => void): void;
  hideBaseCommands(): void;
  showVideo(source: string, onEnd: () => void): void;
  hideVideo(): void;
}

/** Public M6 system-panel projection port; overlay reads are pure and safe after disposal. */
export interface SystemPanelProjectionPort extends SystemPanelCommands {
  system(): SystemPanelOverlayState;
}

export interface LoadingCommands {
  showLoading(progress: LoadingProgress): void;
  hideLoading(): void;
}

export interface PreferenceCommands {
  setQuality(quality: RenderQuality): void;
  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void;
  setPostProcess(settings: Partial<PostProcessSettings>): void;
}

export interface PresentationCommands {
  validate(snapshot: unknown): void;
  restore(snapshot: unknown): void;
  clear(): void;
}

export interface RendererCommands {
  readonly assets: AssetCommands;
  readonly world: WorldCommands;
  readonly dialogue: DialogueCommands;
  readonly menu: MenuCommands;
  readonly gallery: GalleryCommands;
  readonly system: SystemPanelCommands;
  readonly loading: LoadingCommands;
  readonly preferences: PreferenceCommands;
  readonly presentation: PresentationCommands;
}
